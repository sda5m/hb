// routes/pack.routes.js
import express from "express";
import fetch from "node-fetch";
import XLSX from "xlsx";

export default function packRoutes({
  shopifyGraphQL,
  SHOPIFY_SHOP,
  SHOPIFY_ADMIN_TOKEN
}) {
  const router = express.Router();

  const API_VERSION = "2024-10";

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function getNumericId(gidOrId) {
    return String(gidOrId || "").split("/").pop().trim();
  }

  function toMoney(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function lower(value) {
    return String(value || "").toLowerCase().trim();
  }

  async function shopifyRest(path) {
    const url = `https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}${path}`;

    const response = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Shopify REST ${response.status}: ${text}`);
    }

    return response.json();
  }

  async function fetchOrdersExtraByIds(ids, options = {}) {
    const {
      batchSize = 50,
      delayMs = 350,
      includeShippingLines = true,
      includeBillingAddress = false,
      includeNote = true
    } = options;

    const extraMap = new Map();
    if (!Array.isArray(ids) || !ids.length) return extraMap;

    const fields = [
      "id",
      "financial_status",
      "total_outstanding"
    ];

    if (includeShippingLines) fields.push("shipping_lines");
    if (includeNote) fields.push("note");
    if (includeBillingAddress) fields.push("billing_address");

    for (let i = 0; i < ids.length; i += batchSize) {
      const batchIds = ids.slice(i, i + batchSize);

      const query =
        `?ids=${batchIds.join(",")}` +
        `&limit=${batchIds.length}` +
        `&status=any` +
        `&fields=${fields.join(",")}`;

      const json = await shopifyRest(`/orders.json${query}`);
      const orders = Array.isArray(json?.orders) ? json.orders : [];

      for (const o of orders) {
        extraMap.set(String(o.id), {
          financial_status: lower(o.financial_status),
          outstanding: toMoney(o.total_outstanding),
          shipping_method: o?.shipping_lines?.[0]?.title || "",
          note: o.note || "",
          billing_phone: o?.billing_address?.phone || "",
          transactions: []
        });
      }

      console.log(
        `[shopify/rest/orders] batch=${Math.floor(i / batchSize) + 1} requested=${batchIds.length} received=${orders.length}`
      );

      if (i + batchSize < ids.length) {
        await sleep(delayMs);
      }
    }

    return extraMap;
  }

  async function fetchTransactionsForOrderIds(orderIds, extraMap, options = {}) {
    const {
      batchSize = 12,
      delayMs = 700
    } = options;

    if (!Array.isArray(orderIds) || !orderIds.length) return;

    for (let i = 0; i < orderIds.length; i += batchSize) {
      const batch = orderIds.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (orderId) => {
          try {
            const json = await shopifyRest(`/orders/${orderId}/transactions.json`);
            const transactions = Array.isArray(json?.transactions) ? json.transactions : [];

            const prev = extraMap.get(orderId) || {};
            extraMap.set(orderId, {
              ...prev,
              transactions
            });
          } catch (err) {
            console.warn(
              `[shopify/rest/transactions] order=${orderId} error=${err?.message || String(err)}`
            );
          }
        })
      );

      if (i + batchSize < orderIds.length) {
        await sleep(delayMs);
      }
    }
  }

  function buildCustomerName(firstName, lastName) {
    const fn = String(firstName || "").trim();
    const ln = String(lastName || "").trim();

    if (!fn && !ln) return "";
    if (fn && ln && fn.toLowerCase() === ln.toLowerCase()) return fn;

    return [fn, ln].filter(Boolean).join(" ").trim();
  }

  function buildShippingAddress(address1, city) {
    const a1 = String(address1 || "").trim();
    const c = String(city || "").trim();

    return [a1, c].filter(Boolean).join(" - ");
  }

  function buildAddress(address1, city) {
    const a1 = String(address1 || "").trim();
    const c = String(city || "").trim();

    if (!a1 && !c) return "";
    if (a1 && c && a1.toLowerCase() === c.toLowerCase()) return a1;

    return [a1, c].filter(Boolean).join(", ");
  }

  function normalizePhoneRaw(orderNode) {
    return (
      String(orderNode?.shippingAddress?.phone || "").trim() ||
      String(orderNode?.customer?.phone || "").trim()
    );
  }

  function detectCountry(orderNode) {
    const cc = String(orderNode?.shippingAddress?.countryCodeV2 || "")
      .toUpperCase()
      .trim();

    if (cc === "OM" || cc === "AE") return cc;

    const phone = normalizePhoneRaw(orderNode).replace(/\s+/g, "");
    if (phone.startsWith("+968") || phone.startsWith("968")) return "OM";
    if (phone.startsWith("+971") || phone.startsWith("971")) return "AE";

    return null;
  }

  function cleanNumber(num, dial) {
    if (!num) return "";

    let s = String(num).trim().replace(/\s+/g, "");

    if (s.startsWith(`+${dial}`)) s = s.slice(1 + dial.length);
    else if (s.startsWith(dial)) s = s.slice(dial.length);

    s = s.replace(/\D+/g, "");

    if (dial === "971" && s.startsWith("05")) {
      s = s.slice(1);
    }

    return s.length >= 8 && s.length <= 12 ? s : "";
  }

  function calcCOD(financialStatus, outstanding) {
    const f = lower(financialStatus);
    const out = toMoney(outstanding);

    if (f === "paid") return 0;
    return out > 0 ? out : 0;
  }

  // ✅ Ping  ->  GET /api/export/ping
  router.get("/ping", (req, res) => {
    res.json({
      ok: true,
      route: "/api/export/ping",
      time: new Date().toISOString()
    });
  });

  // ✅ Orders للطباعة
  // GET /api/export/orders
  router.get("/orders", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 250);

      const START_DATE =
        String(req.query.from || "").trim() ||
        String(process.env.START_DATE || "2026-01-24").trim();

      const q =
        `(tag:"مسقط" OR tag:"مكتب" OR tag:"تاكيد" OR tag:"تأكيد") ` +
        `AND fulfillment_status:unfulfilled ` +
        `AND created_at:>=${START_DATE} status:open`;

      const gql = `
        query ($q: String!, $n: Int!) {
          orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              createdAt
              tags
              customer {
                firstName
                lastName
                phone
              }
              shippingAddress {
                address1
                city
                phone
                countryCodeV2
              }
              lineItems(first: 100) {
                nodes {
                  title
                  quantity
                  currentQuantity
                  variant {
                    id
                    barcode
                    image { url }
                    product {
                      featuredImage { url }
                    }
                  }
                }
              }
              totalOutstandingSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              displayFinancialStatus
            }
          }
        }
      `;

      const data = await shopifyGraphQL(gql, { q, n: limit });
      const nodes = (Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [])
        .filter(o => !(Array.isArray(o?.tags) ? o.tags : [])
          .some(t => String(t || "").trim() === "\u0645\u063a\u0644\u0641"));

      const ids = nodes.map(o => getNumericId(o?.id)).filter(Boolean);

      const extraMap = await fetchOrdersExtraByIds(ids, {
        batchSize: 50,
        delayMs: 350,
        includeShippingLines: true,
        includeBillingAddress: false,
        includeNote: true
      });

      console.log(
        `[print/orders] GraphQL nodes=${ids.length}, extraMap after REST=${extraMap.size}`
      );

      const restOrderIds = Array.from(extraMap.keys());
      await fetchTransactionsForOrderIds(restOrderIds, extraMap, {
        batchSize: 12,
        delayMs: 700
      });

      const orders = nodes.map((o) => {
        const numericId = getNumericId(o?.id);
        const extra = extraMap.get(numericId) || {};
        const restFound = extraMap.has(numericId);

        const customerName = buildCustomerName(
          o?.customer?.firstName,
          o?.customer?.lastName
        );

        const phone =
          String(o?.shippingAddress?.phone || "").trim() ||
          String(o?.customer?.phone || "").trim();

        const shipping = buildShippingAddress(
          o?.shippingAddress?.address1,
          o?.shippingAddress?.city
        );

        const items = (o?.lineItems?.nodes || [])
          .map(li => ({
            name: String(li?.title || "").trim(),
            qty: Number(li?.currentQuantity ?? li?.quantity ?? 0) || 0,
            image:
              li?.variant?.image?.url ||
              li?.variant?.product?.featuredImage?.url ||
              "",
            barcode: String(li?.variant?.barcode || "").trim(),
            variantId: li?.variant?.id || null
          }))
          .filter(x => x.name && x.qty > 0);

        const gqlOutstanding = toMoney(o?.totalOutstandingSet?.shopMoney?.amount);
        const gqlFinancialStatus = lower(o?.displayFinancialStatus).replace(/\s+/g, "_");

        const finalOutstanding = restFound
          ? toMoney(extra.outstanding)
          : gqlOutstanding;

        const finalFinancialStatus = restFound
          ? lower(extra.financial_status)
          : gqlFinancialStatus;

        return {
          id: o.id,
          name: o.name || "",
          createdAt: o.createdAt || null,
          tags: Array.isArray(o?.tags) ? o.tags : [],
          customer: customerName,
          phone,
          shipping,
          items,
          financial_status: finalFinancialStatus,
          outstanding: finalOutstanding,
          shipping_method: extra.shipping_method || "",
          transactions: Array.isArray(extra.transactions) ? extra.transactions : [],
          note: extra.note || "",
          _restFound: restFound
        };
      });

      const missingRestCount = orders.filter(o => !o._restFound).length;

      console.log(
        `[print/orders] done total=${orders.length} missingRest=${missingRestCount}`
      );

      return res.json({
        startDate: START_DATE,
        count: orders.length,
        missingRestCount,
        orders
      });
    } catch (e) {
      console.error("[print/orders] error:", e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // ✅ Export Dalilee (OM + AE in ONE file)
  // GET /api/export/dalilee
  router.get("/dalilee", async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 250), 1), 250);

      const START_DATE =
        String(req.query.from || "").trim() ||
        String(process.env.START_DATE || "2026-01-24").trim();

      const q =
        `(tag:"تاكيد" OR tag:"تأكيد") ` +
        `AND -tag:"مسقط" ` +
        `AND fulfillment_status:unfulfilled ` +
        `AND created_at:>=${START_DATE} status:open`;

      const gql = `
        query ($q: String!, $n: Int!) {
          orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
            nodes {
              id
              name
              customer {
                firstName
                lastName
                phone
              }
              shippingAddress {
                address1
                city
                phone
                countryCodeV2
              }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(gql, { q, n: limit });
      const nodes = Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [];

      const COUNTRY_CONFIG = {
        OM: { dial: "968", currency: "OMR" },
        AE: { dial: "971", currency: "AED" }
      };

      const targetNodes = nodes.filter(o => {
        const country = detectCountry(o);
        return country === "OM" || country === "AE";
      });

      const ids = targetNodes.map(o => getNumericId(o?.id)).filter(Boolean);

      const extraMap = await fetchOrdersExtraByIds(ids, {
        batchSize: 50,
        delayMs: 350,
        includeShippingLines: false,
        includeBillingAddress: true,
        includeNote: true
      });

      const rows = targetNodes
        .map((o) => {
          const country = detectCountry(o);
          if (!country) return null;

          const cfg = COUNTRY_CONFIG[country];
          if (!cfg) return null;

          const numericId = getNumericId(o?.id);
          const extra = extraMap.get(numericId) || {};

          const customer_name = buildCustomerName(
            o?.customer?.firstName,
            o?.customer?.lastName
          );

          const phone = normalizePhoneRaw(o);

          const address = buildAddress(
            o?.shippingAddress?.address1,
            o?.shippingAddress?.city
          );

          const orderName = String(o?.name || "").trim();
          const note = String(extra?.note || "").trim();
          const Note = note ? `${orderName} - ${note}` : orderName;

          return {
            customer_name,
            customer_country_code: cfg.dial,
            customer_number: cleanNumber(phone, cfg.dial),
            COD: calcCOD(extra.financial_status, extra.outstanding),
            "COD Currency": cfg.currency,
            external_way_bill_number: "",
            address,
            Note,
            customer_alternate_no_country_code: cfg.dial,
            alternate_number: cleanNumber(extra.billing_phone, cfg.dial),
            weight: 3
          };
        })
        .filter(Boolean)
        .filter(r => r.customer_name && r.customer_number && r.address);

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Dalilee");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const fileName = `dalilee_${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(buf);
    } catch (e) {
      console.error("[export/dalilee] error:", e);
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
}
