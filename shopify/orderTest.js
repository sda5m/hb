import { shopifyGraphQL } from "./client.js";

export async function getOrderWithCustomer(code) {
  const clean = code.replace("#", "").trim();

  const q = `
    (order_number:${clean} OR name:${clean} OR name:#${clean})
  `;

  const query = `
    query ($q: String!) {
      orders(first: 1, query: $q) {
        nodes {
          id
          name
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }

          customer {
            displayName
            phone
            email
          }

          shippingAddress {
            name
            phone
            address1
            address2
            city
            province
            country
          }

          billingAddress {
            name
            phone
            address1
            address2
            city
            province
            country
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(query, { q });
  return data.orders?.nodes?.[0] || null;
}
