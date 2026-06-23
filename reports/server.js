import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const PORT = process.env.PORT || 3000;

async function shopifyGraphQL(query, variables = {}) {
  const API_VERSION = process.env.SHOPIFY_GQL_VERSION || "2025-01";

  const response = await fetch(
    `https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const data = await response.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

app.get("/health", (req, res) => {
  const t = process.env.SHOPIFY_ADMIN_TOKEN || "";
  res.json({
    shop: process.env.SHOPIFY_SHOP || null,
    tokenLength: t.length,
    tokenLast4: t ? t.slice(-4) : null
  });
});

// ✅ API للتقرير حسب شروطك
// GET /api/reports/unshipped-products?tags=مسقط,تاكيد,مكتب&from=2026-01-25&limit=80
app.get("/api/reports/unshipped-products", async (req, res) => {
  try {
    const from = (req.query.from || "2026-01-25").toString().trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 250);

    const tags = String(req.query.tags || "مسقط,تاكيد,مكتب")
      .split(",")
      .map(t => t.trim())
      .filter(Boolean);

    const tagQuery = tags.map(t => `tag:"${t}"`).join(" OR ");

    // ✅ شروطك:
    // - OR tags
    // - Unfulfilled فقط
    // - من تاريخ from
    const q = `(${tagQuery}) AND fulfillment_status:unfulfilled AND created_at:>=${from} status:any`;

    const query = `
      query ($q: String!, $n: Int!) {
        orders(first: $n, query: $q, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            name
            tags
            createdAt
            lineItems(first: 100) {
              nodes {
                title
                quantity
                variant {
                  image { url }
                  product { featuredImage { url } }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { q, n: limit });
    const orders = data.orders?.nodes || [];

    // ✅ تجميع منتجات بدون تكرار
// ✅ تجميع منتجات بدون تكرار + مصادر الكمية (رقم الطلب)
const map = new Map();

for (const o of orders) {
  const orderName = (o.name || "").toString(); // مثل #1234

  for (const li of (o.lineItems?.nodes || [])) {
    const name = (li.title || "").toString().trim();
    if (!name) continue;

    const qty = Number(li.quantity || 0) || 0;

    const img =
      li?.variant?.image?.url ||
      li?.variant?.product?.featuredImage?.url ||
      "";

    if (!map.has(name)) {
      map.set(name, {
        name,
        quantity: 0,
        image: img,
        sources: [] // ✅ هنا نضع من أين جاءت الكمية
      });
    }

    const row = map.get(name);

    row.quantity += qty;

    // خذ صورة أول صورة متاحة
    if (!row.image && img) row.image = img;

    // ✅ سجل رقم الطلب + كمية المنتج في هذا الطلب
    row.sources.push({ order: orderName, qty });
  }
}

    const products = Array.from(map.values()).sort((a, b) => (b.quantity || 0) - (a.quantity || 0));

    return res.json({
      from,
      tags,
      ordersCount: orders.length,
      productsCount: products.length,
      products,
      debugQuery: q
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// الصفحة
app.get("/", (req, res) => {
  res.redirect("/reports.html");
});

app.listen(PORT, () => console.log("✅ Reports service running on port " + PORT));
