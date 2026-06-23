/**
 * diagnose-reviews.js
 * يطبع كل تقييم مع اسم المؤلف والـ productId المحفوظ
 * شغّله: REDIS_URL=$REDIS_URL node diagnose-reviews.js
 */

import { createClient } from "redis";

const REDIS_URL = String(process.env.REDIS_URL || "").trim();
if (!REDIS_URL) { console.error("ضع REDIS_URL أولاً"); process.exit(1); }

const r = createClient({ url: REDIS_URL });
r.on("error", (e) => console.error("Redis error", e));
await r.connect();

const allIds = await r.zRange("bt:rv:all", 0, -1, { REV: true });
console.log(`\nإجمالي التقييمات: ${allIds.length}\n`);
console.log("author".padEnd(30), "productId");
console.log("─".repeat(80));

for (const id of allIds) {
  const h = await r.hGetAll(`bt:rv:item:${id}`);
  if (!h?.id) continue;
  const inProductIndex = await r.zScore(`bt:rv:product:${h.productId}`, id);
  const flag = inProductIndex !== null ? "✅" : "❌ مفقود من فهرس المنتج";
  console.log(
    String(h.author || "").padEnd(30),
    String(h.productId || "").padEnd(35),
    flag
  );
}

await r.quit();
