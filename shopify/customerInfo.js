import fetch from "node-fetch";

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

async function shopifyGraphQL(query, variables = {}) {
  if (!SHOPIFY_SHOP) throw new Error("SHOPIFY_SHOP غير مضبوط في البيئة");
  if (!SHOPIFY_ADMIN_TOKEN) throw new Error("SHOPIFY_ADMIN_TOKEN غير مضبوط في البيئة");

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

/**
 * ✅ getOrderCustomerInfo(code)
 * يرجع:
 * phone, shipCountry, customerName, tags,
 * addressLine, cityName
 */
export async function getOrderCustomerInfo(code) {
  const input = (code || "").toString().trim();
  if (!input) throw new Error("اكتب رقم الطلب");

  const clean = input.replace("#", "").trim();
  const q = `(order_number:${clean} OR name:${clean} OR name:#${clean})`;

  const query = `
    query ($q: String!) {
      orders(first: 1, query: $q) {
        nodes {
          id
          name
          tags
          customer {
            firstName
            lastName
            phone
          }
          shippingAddress {
            phone
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            countryCodeV2
          }
          billingAddress {
            phone
            firstName
            lastName
            address1
            address2
            city
            province
            country
            zip
            countryCodeV2
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(query, { q });
  const order = data.orders?.nodes?.[0];
  if (!order) throw new Error("الطلب غير موجود");

  // ✅ الاسم: shipping ثم customer ثم billing
  const shipName = [order.shippingAddress?.firstName, order.shippingAddress?.lastName]
    .filter(Boolean).join(" ").trim();

  const custName = [order.customer?.firstName, order.customer?.lastName]
    .filter(Boolean).join(" ").trim();

  const billName = [order.billingAddress?.firstName, order.billingAddress?.lastName]
    .filter(Boolean).join(" ").trim();

  const customerName = shipName || custName || billName || "";

  // ✅ الدولة: shipping ثم billing
  const shipCountry =
    (order.shippingAddress?.countryCodeV2 || order.billingAddress?.countryCodeV2 || "")
      .toString()
      .trim();

  // ✅ الهاتف: shipping ثم customer ثم billing
  const phoneRaw =
    (order.shippingAddress?.phone ||
      order.customer?.phone ||
      order.billingAddress?.phone ||
      "")
      .toString()
      .trim();

  const phone = phoneRaw || "غير موجود";

  // ✅ العنوان + المدينة: shipping ثم billing
  const addrObj = order.shippingAddress || order.billingAddress || null;

  const addressParts = addrObj
    ? [
        addrObj.address1,
        addrObj.address2
      ].filter(Boolean).map(s => String(s).trim())
    : [];

  const addressLine = addressParts.join(" - ").trim();

  const cityName = (addrObj?.city || "").toString().trim();

  return {
    phone,
    shipCountry,
    customerName,
    tags: order.tags || [],

    // ✅ إضافات مطلوبة للرسالة
    addressLine,
    cityName
  };
}
