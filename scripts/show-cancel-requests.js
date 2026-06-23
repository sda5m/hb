const baseUrl = process.env.BTIME_APP_URL || "https://app.halabt.com";
const limit = process.argv[2] || "100";

const url = `${baseUrl}/api/manage/order-cancel-requests?limit=${encodeURIComponent(limit)}`;

const response = await fetch(url, {
  headers: { Accept: "application/json" }
});

const data = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(data.error || `HTTP ${response.status}`);
  process.exit(1);
}

const requests = Array.isArray(data.requests) ? data.requests : [];

if (!requests.length) {
  console.log("No customer cancel requests found.");
  process.exit(0);
}

for (const item of requests) {
  console.log("--------------------------------------------------");
  console.log(`Order: ${item.orderName || item.orderId || ""}`);
  console.log(`Customer: ${item.customerEmail || item.customerId || ""}`);
  console.log(`Reason: ${item.reason || ""}`);
  if (item.note) console.log(`Note: ${item.note}`);
  console.log(`Created: ${item.createdAt || ""}`);
}
