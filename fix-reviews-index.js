/**
 * fix-reviews-index.js
 *
 * يقرأ كل التقييمات من bt:rv:all
 * ويُعيد بناء:
 *   bt:rv:product:{productId}  ← ZSET (الذي يستخدمه التطبيق)
 *   bt:rv:summary:{productId}  ← HASH  (العدد والمتوسط)
 *
 * شغّله مرة واحدة:
 *   REDIS_URL=rediss://... node fix-reviews-index.js
 */

import { createClient } from "redis";

const REDIS_URL = String(process.env.REDIS_URL || "").trim();
if (!REDIS_URL) {
  console.error("❌  ضع REDIS_URL في البيئة أولاً");
  process.exit(1);
}

const RV_KEY_PRODUCT = (pid) => `bt:rv:product:${String(pid).trim()}`;
const RV_KEY_ITEM    = (id)  => `bt:rv:item:${String(id).trim()}`;
const RV_KEY_SUMMARY = (pid) => `bt:rv:summary:${String(pid).trim()}`;
const RV_KEY_ALL     = "bt:rv:all";

const r = createClient({ url: REDIS_URL });
r.on("error", (e) => console.error("Redis error", e));
await r.connect();

console.log("✅ Redis متصل — جاري القراءة ...");

const allIds = await r.zRange(RV_KEY_ALL, 0, -1, { REV: false });
console.log(`📦 إجمالي التقييمات في bt:rv:all: ${allIds.length}`);

// اجمع بيانات كل تقييم
const productEntries = {};   // pid → [{score, value}]
const productSums    = {};   // pid → {count, sum}
let processed = 0;
let skipped   = 0;
let noProduct = 0;

for (const id of allIds) {
  const h = await r.hGetAll(RV_KEY_ITEM(id));

  if (!h || !h.id) {
    console.warn(`  ⚠️  id "${id}" — لا يوجد hash (bt:rv:item:${id})`);
    skipped++;
    continue;
  }

  const pid = String(h.productId || "").trim();
  if (!pid) {
    console.warn(`  ⚠️  id "${id}" (${h.author}) — productId فارغ`);
    noProduct++;
    continue;
  }

  const ts    = parseInt(h.createdAt || "0", 10);
  const score = ts || Date.now();
  const rat   = parseInt(h.rating    || "0", 10);

  if (!productEntries[pid]) productEntries[pid] = [];
  if (!productSums[pid])    productSums[pid]    = { count: 0, sum: 0 };

  productEntries[pid].push({ score, value: id });
  productSums[pid].count++;
  productSums[pid].sum += rat;
  processed++;
}

console.log(`\n📊 النتيجة:`);
console.log(`   ✅ تمت معالجة : ${processed}`);
console.log(`   ⚠️  بدون hash  : ${skipped}`);
console.log(`   ⚠️  بدون pid   : ${noProduct}`);
console.log(`   🗂  منتجات    : ${Object.keys(productEntries).length}\n`);

// أعد بناء ZSET لكل منتج
for (const [pid, entries] of Object.entries(productEntries)) {
  const existing = await r.zCard(RV_KEY_PRODUCT(pid));
  if (existing === entries.length) {
    console.log(`  ⏭  ${pid} — ${entries.length} تقييم (فهرس موجود، تخطي)`);
    continue;
  }
  await r.del(RV_KEY_PRODUCT(pid));
  await r.zAdd(RV_KEY_PRODUCT(pid), entries);
  console.log(`  🔧 ${pid} — بنيت ${entries.length} تقييم (كان ${existing})`);
}

// أعد بناء SUMMARY لكل منتج
for (const [pid, { count, sum }] of Object.entries(productSums)) {
  await r.hSet(RV_KEY_SUMMARY(pid), {
    count: String(count),
    sum:   String(sum),
  });
}

console.log("\n✅ انتهى — كل فهارس المنتجات أُعيد بناؤها");
await r.quit();
