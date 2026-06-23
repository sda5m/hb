import fetch from "node-fetch";

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

export async function shopifyGraphQL(query, variables = {}) {
  const r = await fetch(
    `https://${SHOP}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const text = await r.text();

  // ❌ مشاكل توكن / صلاحيات
  if (!r.ok) {
    console.error("❌ Shopify HTTP Error:", r.status);
    console.error(text);
    throw new Error(`HTTP ${r.status}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.error("❌ Invalid JSON from Shopify:");
    console.error(text);
    throw new Error("Invalid JSON response");
  }

  // ❌ أخطاء صلاحيات GraphQL
  if (json.errors) {
    console.error("❌ Shopify GraphQL Errors:");
    console.error(JSON.stringify(json.errors, null, 2));
    throw new Error("GraphQL access denied or query error");
  }

  return json.data;
}
