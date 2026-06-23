import { createClient } from "redis";

function normalizeCustomerId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://shopify/Customer/")) return raw;
  const numeric = raw.replace(/\D+/g, "");
  return numeric ? `gid://shopify/Customer/${numeric}` : raw;
}

function customerNumericId(value) {
  const gid = normalizeCustomerId(value);
  return gid.includes("/") ? gid.split("/").pop() || gid : gid;
}

function usage() {
  console.log("Usage: node scripts/show-rewards.js <customer-id> [limit]");
}

const customerId = process.argv[2];
const limit = Math.max(1, Math.min(Number(process.argv[3] || 30), 200));

if (!customerId) {
  usage();
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redis = createClient({ url: redisUrl });
redis.on("error", (e) => console.error("Redis error:", e?.message || e));

await redis.connect();

const numeric = customerNumericId(customerId);
const balanceKey = `bt:rewards:customer:${numeric}:balance`;
const ledgerKey = `bt:rewards:customer:${numeric}:ledger`;

const balance = Number(await redis.get(balanceKey) || 0);
const rows = await redis.lRange(ledgerKey, 0, limit - 1);

console.log(JSON.stringify({
  customerId: normalizeCustomerId(customerId),
  customerNumericId: numeric,
  balance,
  ledger: rows.map((row) => {
    try {
      return JSON.parse(row);
    } catch {
      return row;
    }
  })
}, null, 2));

await redis.quit();
