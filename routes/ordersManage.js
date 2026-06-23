// routes/ordersManage.js
import express from "express";
import path from "path";
import fetch from "node-fetch";
import fs from "fs";
import os from "os";
import PDFDocument from "pdfkit";
import puppeteer from "puppeteer";
import webpush from "web-push";
import { reverseOrderRewards } from "./customerRewards.js";

export default function ordersManageRouter(deps = {}) {
  const router = express.Router();

  const getRedis = deps.getRedis;
  let invoiceBrowserPromise = null;
  let invoiceBrowserIdleTimer = null;

  function scheduleInvoiceBrowserClose(browser) {
    if (invoiceBrowserIdleTimer) clearTimeout(invoiceBrowserIdleTimer);
    invoiceBrowserIdleTimer = setTimeout(async () => {
      invoiceBrowserIdleTimer = null;
      invoiceBrowserPromise = null;
      await browser.close().catch(() => {});
    }, 10 * 60 * 1000);
  }

  async function getInvoiceBrowser() {
    if (invoiceBrowserIdleTimer) {
      clearTimeout(invoiceBrowserIdleTimer);
      invoiceBrowserIdleTimer = null;
    }

    if (!invoiceBrowserPromise) {
      invoiceBrowserPromise = puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage"
        ]
      }).then((browser) => {
        browser.on("disconnected", () => {
          invoiceBrowserPromise = null;
        });
        return browser;
      }).catch((error) => {
        invoiceBrowserPromise = null;
        throw error;
      });
    }

    const browser = await invoiceBrowserPromise;
    if (!browser?.isConnected?.()) {
      invoiceBrowserPromise = null;
      return getInvoiceBrowser();
    }
    scheduleInvoiceBrowserClose(browser);
    return browser;
  }

  const WEB_PUSH_PUBLIC_KEY =
    deps.WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY || "";

  const WEB_PUSH_PRIVATE_KEY =
    deps.WEB_PUSH_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY || "";

  const WEB_PUSH_SUBJECT =
    deps.WEB_PUSH_SUBJECT || process.env.WEB_PUSH_SUBJECT || "mailto:info@halabt.com";

  const PUSH_AUTH_TOKEN =
    deps.PUSH_AUTH_TOKEN || process.env.PUSH_AUTH_TOKEN || "";

  if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY) {
    webpush.setVapidDetails(
      WEB_PUSH_SUBJECT,
      WEB_PUSH_PUBLIC_KEY,
      WEB_PUSH_PRIVATE_KEY
    );
  }

  function pushRedisKey() {
    return "btcm:push:subscriptions:v1";
  }

  function normalizePushSubscription(sub = {}) {
    const endpoint = String(sub?.endpoint || "").trim();
    const p256dh = String(sub?.keys?.p256dh || "").trim();
    const auth = String(sub?.keys?.auth || "").trim();

    if (!endpoint || !p256dh || !auth) return null;

    return {
      endpoint,
      expirationTime: sub?.expirationTime ?? null,
      keys: { p256dh, auth }
    };
  }

  async function savePushSubscription(subscription) {
    const redis = typeof getRedis === "function" ? await getRedis() : null;
    if (!redis) throw new Error("Redis غير متوفر");

    const sub = normalizePushSubscription(subscription);
    if (!sub) throw new Error("Push subscription غير صالح");

    await redis.hSet(pushRedisKey(), sub.endpoint, JSON.stringify(sub));
    return sub;
  }

  async function removePushSubscriptionByEndpoint(endpoint) {
    const redis = typeof getRedis === "function" ? await getRedis() : null;
    if (!redis) return;

    const ep = String(endpoint || "").trim();
    if (!ep) return;

    await redis.hDel(pushRedisKey(), ep);
  }

  async function getAllPushSubscriptions() {
    const redis = typeof getRedis === "function" ? await getRedis() : null;
    if (!redis) return [];

    const raw = await redis.hGetAll(pushRedisKey());

    return Object.values(raw || {})
      .map((v) => {
        try {
          return JSON.parse(v);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .map(normalizePushSubscription)
      .filter(Boolean);
  }

  async function broadcastPushToAll(payload = {}) {
    if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) {
      throw new Error("WEB_PUSH keys غير موجودة");
    }

    const subs = await getAllPushSubscriptions();

    let sent = 0;
    let failed = 0;
    let removed = 0;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (e) {
        const code = Number(e?.statusCode || 0);

        if (code === 404 || code === 410) {
          await removePushSubscriptionByEndpoint(sub.endpoint);
          removed++;
          continue;
        }

        failed++;
        console.error("push failed:", e?.message || e);
      }
    }

    return { sent, failed, removed };
  }


  
  const MAIN_HTML = path.resolve(process.cwd(), "public", "btcm", "index.html");

  // =========================
  // Serve Main Page
  // =========================
  router.get("/", (req, res) => {
    return res.sendFile(MAIN_HTML, (err) => {
      if (err) {
        res
          .status(404)
          .type("text")
          .send(
            "index.html غير موجود.\n" +
              "تأكد أن الملف في: public/btcm/index.html\n" +
              "والرابط: /"
          );
      }
    });
  });

const BLACKLIST_HTML = path.resolve(process.cwd(), "public", "btcm", "blacklist.html");

router.get("/blacklist", (req, res) => {
  return res.sendFile(BLACKLIST_HTML, (err) => {
    if (err) {
      res
        .status(404)
        .type("text")
        .send(
          "blacklist.html غير موجود.\n" +
          "تأكد أن الملف في: public/btcm/blacklist.html\n" +
          "والرابط: /blacklist"
        );
    }
  });
});

  // =========================
  // 2) Ping
  // =========================
  router.get("/api/manage/ping", (req, res) => {
    return res.json({
      ok: true,
      shop: deps.SHOPIFY_SHOP || process.env.SHOPIFY_SHOP || null,
      apiVersion: process.env.SHOPIFY_REST_VERSION || "2025-01",
    });
  });

router.get("/api/manage/push/public-key", async (req, res) => {
  try {
    if (!WEB_PUSH_PUBLIC_KEY) {
      return res.status(500).json({ error: "WEB_PUSH_PUBLIC_KEY غير موجود" });
    }

    return res.json({
      ok: true,
      publicKey: WEB_PUSH_PUBLIC_KEY
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post("/api/manage/push/subscribe", async (req, res) => {
  try {
    const sub = await savePushSubscription(req.body || {});
    return res.json({ ok: true, endpoint: sub.endpoint });
  } catch (e) {
    return res.status(400).json({ error: e?.message || String(e) });
  }
});

router.post("/api/manage/push/send-test", async (req, res) => {
  try {
    const out = await broadcastPushToAll({
      title: "تجربة إشعار",
      body: "هذا إشعار تجريبي من لوحة الطلبات",
      url: "/btcm/",
      tag: "btcm-test"
    });

    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post("/api/manage/push/order-created", async (req, res) => {
  try {
    const token = String(req.headers["x-push-auth"] || "").trim();

    if (!PUSH_AUTH_TOKEN || token !== PUSH_AUTH_TOKEN) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const rawOrder = req.body || {};

    const orderId =
      String(rawOrder?.id || "").trim() ||
      String(rawOrder?.admin_graphql_api_id || "").trim().split("/").pop() ||
      "";

    if (!orderId) {
      return res.status(400).json({ error: "order id غير موجود" });
    }

    const restOut = await shopifyRest(
      `/orders/${orderId}.json?fields=id,name,financial_status,gateway,payment_gateway_names,tags,phone,currency,current_total_price,total_price,shipping_address,customer`,
      { method: "GET" }
    );

    const order = restOut?.order || rawOrder;

    const orderName =
      String(order?.name || "").trim() ||
      `#${orderId}`;

    const financialStatus = String(order?.financial_status || "").trim().toLowerCase();

    const gatewayNames = [
      String(order?.gateway || "").trim(),
      ...(Array.isArray(order?.payment_gateway_names) ? order.payment_gateway_names : [])
    ]
      .map(x => String(x || "").trim().toLowerCase())
      .filter(Boolean);

    const gatewayText = gatewayNames.join(" | ");

    const tags = Array.isArray(order?.tags)
      ? order.tags
      : String(order?.tags || "")
          .split(",")
          .map(x => x.trim())
          .filter(Boolean);

    const normalizedTags = tags.map(t => String(t || "").trim().toLowerCase());

    const hasTag = (name) =>
      normalizedTags.includes(String(name || "").trim().toLowerCase());

    const isPaid =
      financialStatus === "paid" ||
      hasTag("تحويل");

    const isCod =
      gatewayText.includes("cash") ||
      gatewayText.includes("cod") ||
      gatewayText.includes("cash on delivery");

    const isBankTransfer =
      gatewayText.includes("bank") ||
      gatewayText.includes("transfer") ||
      gatewayText.includes("deposit");

    let orderStatusText = "انتظار الدفع";

    if (isPaid) {
      orderStatusText = "مدفوع";
    } else if (hasTag("تاكيد") || hasTag("تأكيد")) {
      orderStatusText = "في انتظار التأكيد";
    } else if (hasTag("مسقط") || hasTag("مكتب")) {
      orderStatusText = "في انتظار التأكيد";
    } else if (isCod) {
      orderStatusText = "في انتظار التأكيد";
    } else if (isBankTransfer) {
      orderStatusText = "في انتظار التحويل";
    }

    const firstName =
      String(order?.customer_first_name || "").trim() ||
      String(order?.shipping_address?.first_name || "").trim() ||
      String(order?.customer?.first_name || "").trim() ||
      String(order?.customer || "").trim().split(" ").filter(Boolean)[0] ||
      "";

    const city =
      String(order?.shipping_address?.city || "").trim() ||
      String(order?.city || "").trim() ||
      "";

    const address =
      String(order?.shipping_address?.address1 || "").trim() ||
      String(order?.address1 || "").trim() ||
      "";

    const addressCityLine = [address, city].filter(Boolean).join(" - ");

    const phone =
      String(order?.phone || "").trim() ||
      String(order?.shipping_address?.phone || "").trim() ||
      String(order?.customer?.phone || "").trim() ||
      "";

    const amountRaw =
      order?.current_total_price ??
      order?.total_price ??
      order?.total ??
      order?.amount ??
      "";

    const amountNum = Number(amountRaw);
    const currencyCode = String(order?.currency || "").trim().toUpperCase();
    const currency = currencyCode === "OMR" ? "ر.ع" : (currencyCode || "ر.ع");
    const amount = Number.isFinite(amountNum) ? `${amountNum.toFixed(3)} ${currency}` : "";

    const bodyLines = [
      orderStatusText,
      firstName,
      addressCityLine,
      amount,
      phone
    ].filter(Boolean);

    const out = await broadcastPushToAll({
      title: `طلب جديد ${orderName}`.trim(),
      body: bodyLines.join("\n") || "وصل طلب جديد",
      url: `/btcm/?openOrder=${encodeURIComponent(orderId)}`
    });

    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
function normalizePhoneForHistory(value) {
  let d = String(value || "").replace(/\D+/g, "");

  if (d.startsWith("00968")) d = d.slice(2);
  if (d.startsWith("968968")) d = d.slice(3);
  if (d.length === 8) d = "968" + d;
  if (d.length > 11) d = d.slice(-11);

  if (!/^968\d{8}$/.test(d)) return "";
  return d;
}

function mapManageOrderNode(node = {}) {
  const shipping = node.shippingAddress || {};
  const customer = node.customer || {};
  const totalOutstanding = Number(node?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
  const totalPrice = Number(node?.currentTotalPriceSet?.shopMoney?.amount || 0) || 0;
  const amountPaid = Math.max(0, totalPrice - totalOutstanding);

  const allTrackingInfo = (Array.isArray(node?.fulfillments) ? node.fulfillments : [])
    .flatMap(f => Array.isArray(f?.trackingInfo) ? f.trackingInfo : []);

  const firstTrackingWithNumber =
    allTrackingInfo.find(x => String(x?.number || "").trim()) || {};

  const firstTrackingAny =
    allTrackingInfo.find(x =>
      String(x?.number || "").trim() || String(x?.url || "").trim()
    ) || {};

  return {
    id: String(node.id || "").split("/").pop(),
    gid: node.id || "",
    name: node.name || "",
    created_at: node.createdAt || "",
    createdAt: node.createdAt || "",
    tags: Array.isArray(node.tags) ? node.tags : [],
    note: node.note || "",
    cancelled_at: node.cancelledAt || null,
    cancel_reason: node.cancelReason || null,

    financial_status: node.displayFinancialStatus || "",
    fulfillment_status: node.displayFulfillmentStatus || "",

    customer: [
      shipping.name,
      [customer.firstName, customer.lastName].filter(Boolean).join(" "),
      [shipping.firstName, shipping.lastName].filter(Boolean).join(" ")
    ].find(Boolean) || "",

    phone:
      shipping.phone ||
      customer.phone ||
      "",

    city: shipping.city || "",
    address1: shipping.address1 || "",
    shipping: [shipping.address1, shipping.address2].filter(Boolean).join(" - "),
    country: shipping.country || "",
    country_code: shipping.countryCodeV2 || "",

    trackingNumber: firstTrackingWithNumber?.number || "",
    trackingUrl: firstTrackingWithNumber?.url || firstTrackingAny?.url || "",
    trackingNumbers: allTrackingInfo
      .map(x => String(x?.number || "").trim())
      .filter(Boolean),

    total_outstanding: Number(totalOutstanding.toFixed(3)),
    amount_paid: Number(amountPaid.toFixed(3)),
    total_price: Number(totalPrice.toFixed(3)),
    currency: node?.currentTotalPriceSet?.shopMoney?.currencyCode || "OMR",
  };
}

  
// GET /api/manage/orders/by-phone?phone=9687xxxxxxx&excludeId=123456789
router.get("/api/manage/orders/by-phone", async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    const excludeId = String(req.query.excludeId || "").trim();

    if (!orderId) {
      return res.status(400).json({ error: "orderId مطلوب" });
    }

    const numericId = toNumericId(orderId);
    const orderGid = toGid("Order", numericId);

    // 1) اقرأ الطلب الحالي أولًا
    const baseData = await shopifyGraphQL(
      `
      query BaseOrderForHistory($id: ID!) {
        order(id: $id) {
          id
          name
          customer {
            id
            firstName
            lastName
            phone
          }
          shippingAddress {
            phone
          }
        }
      }
      `,
      { id: orderGid }
    );

    const baseOrder = baseData?.order;
    if (!baseOrder) {
      return res.status(404).json({ error: "الطلب غير موجود" });
    }

    const customerGid = String(baseOrder?.customer?.id || "").trim();

    const basePhone = normalizePhoneForHistory(
      baseOrder?.shippingAddress?.phone ||
      baseOrder?.customer?.phone ||
      ""
    );

    let orders = [];

    // =========================
    // 2) إذا يوجد customer.id -> هذا هو المسار الصحيح
    // =========================
    if (customerGid) {
      const customerOrdersData = await shopifyGraphQL(
        `
        query CustomerOrdersForHistory($id: ID!) {
          customer(id: $id) {
            id
            orders(first: 250, sortKey: PROCESSED_AT, reverse: true) {
              nodes {
                id
                name
                createdAt
                tags
                note
                cancelledAt
                cancelReason
                displayFinancialStatus
                displayFulfillmentStatus

                totalOutstandingSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }

                currentTotalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }

                customer {
                  firstName
                  lastName
                  phone
                }

                shippingAddress {
                  name
                  firstName
                  lastName
                  phone
                  address1
                  address2
                  city
                  country
                  countryCodeV2
                }

                fulfillments {
                  id
                  createdAt
                  trackingInfo {
                    number
                    company
                    url
                  }
                }
              }
            }
          }
        }
        `,
        { id: customerGid }
      );

      orders = Array.isArray(customerOrdersData?.customer?.orders?.nodes)
        ? customerOrdersData.customer.orders.nodes.map(mapManageOrderNode)
        : [];
    }

    // =========================
    // 3) fallback إذا ما فيه customer.id
    // =========================
    if (!orders.length && basePhone) {
      const local8 = basePhone.slice(-8);

      const candidateData = await shopifyGraphQL(
        `
        query OrdersByPhoneCandidate($q: String!) {
          orders(first: 250, query: $q, sortKey: PROCESSED_AT, reverse: true) {
            nodes {
              id
              name
              createdAt
              tags
              note
              cancelledAt
              cancelReason
              displayFinancialStatus
              displayFulfillmentStatus

              totalOutstandingSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }

              currentTotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }

              customer {
                firstName
                lastName
                phone
              }

              shippingAddress {
                name
                firstName
                lastName
                phone
                address1
                address2
                city
                country
                countryCodeV2
              }

              fulfillments {
                id
                createdAt
                trackingInfo {
                  number
                  company
                  url
                }
              }
            }
          }
        }
        `,
        { q: local8 }
      );

      const candidateNodes = Array.isArray(candidateData?.orders?.nodes)
        ? candidateData.orders.nodes
        : [];

      orders = candidateNodes
        .filter((node) => {
          const shippingPhone = normalizePhoneForHistory(node?.shippingAddress?.phone || "");
          const customerPhone = normalizePhoneForHistory(node?.customer?.phone || "");

          return shippingPhone === basePhone || customerPhone === basePhone;
        })
        .map(mapManageOrderNode);
    }

    // 4) استبعاد الطلب الحالي
    if (excludeId) {
      orders = orders.filter(o => String(o.id) !== String(toNumericId(excludeId)));
    }

    // 5) إزالة التكرار احتياط
    const seen = new Set();
    orders = orders.filter((o) => {
      const id = String(o.id || "");
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return res.json({
      ok: true,
      count: orders.length,
      orders
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});  
  // =========================
  // Shopify Helpers (REST + GraphQL)
  // =========================
  const SHOPIFY_SHOP = deps.SHOPIFY_SHOP || process.env.SHOPIFY_SHOP;
  const SHOPIFY_ADMIN_TOKEN = deps.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN;
  const API_VERSION = process.env.SHOPIFY_REST_VERSION || "2025-01";
const storefrontGraphQL = deps.storefrontGraphQL;
  
  function assertShopifyEnv() {
    if (!SHOPIFY_SHOP || !SHOPIFY_ADMIN_TOKEN) {
      throw new Error("SHOPIFY_SHOP أو SHOPIFY_ADMIN_TOKEN غير موجودة في env/deps");
    }
  }

  function toNumericId(id) {
    const s = String(id || "");
    if (!s) return "";
    if (s.includes("gid://")) return s.split("/").pop();
    return s;
  }

  function toGid(type, idOrGid) {
    const s = String(idOrGid || "");
    if (!s) return "";
    if (s.startsWith("gid://")) return s;
    const num = toNumericId(s);
    return `gid://shopify/${type}/${num}`;
  }

  function safeJsonParse(text) {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  function pickErrMessage(any) {
    if (!any) return "";
    if (typeof any === "string") return any;
    if (Array.isArray(any)) return any.map(pickErrMessage).filter(Boolean).join(" | ");
    if (typeof any === "object") {
      if (any.message) return String(any.message);
      if (any.error) return pickErrMessage(any.error);
      if (any.errors) return pickErrMessage(any.errors);
      return JSON.stringify(any);
    }
    return String(any);
  }

  async function shopifyRest(url, options = {}) {
    assertShopifyEnv();

const r = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}${url}`, {
  ...options,
  headers: {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
    ...(options.headers || {}),
  },
});
    const text = await r.text();
    const json = safeJsonParse(text);

    if (!r.ok) {
      const msg =
        pickErrMessage(json?.errors) ||
        pickErrMessage(json?.error) ||
        text ||
        "Shopify REST error";
      throw new Error(msg);
    }
    return json ?? {};
  }

  async function shopifyGraphQL(query, variables = {}) {
    assertShopifyEnv();

    const r = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await r.text();
    const json = safeJsonParse(text) || {};

    if (!r.ok) {
      throw new Error(json?.errors?.[0]?.message || text || "Shopify GraphQL HTTP error");
    }

    if (Array.isArray(json?.errors) && json.errors.length) {
      throw new Error(json.errors[0]?.message || "Shopify GraphQL error");
    }

    return json?.data;
  }

  function extractCustomerBearer(req) {
    const auth = String(req.headers?.authorization || "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) {
      return auth.slice(7).trim();
    }
    return String(
      req.headers?.["x-customer-token"] ||
      req.query?.customer_token ||
      req.body?.customer_token ||
      ""
    ).trim();
  }

  let customerAccountGraphqlUrl = "";

  async function getCustomerAccountGraphqlUrl() {
    if (customerAccountGraphqlUrl) return customerAccountGraphqlUrl;

    const discoveryUrl = String(
      process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL ||
        "https://account.halabt.com/.well-known/customer-account-api"
    ).trim();

    const r = await fetch(discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" }
    }).catch(() => null);

    if (r?.ok) {
      const data = await r.json().catch(() => null);
      if (data?.graphql_api) {
        customerAccountGraphqlUrl = String(data.graphql_api);
        return customerAccountGraphqlUrl;
      }
    }

    customerAccountGraphqlUrl =
      process.env.SHOPIFY_CUSTOMER_ACCOUNT_GRAPHQL_URL ||
      "https://account.halabt.com/customer/api/2026-04/graphql";
    return customerAccountGraphqlUrl;
  }

  async function customerAccountCustomer(customerToken) {
    const url = await getCustomerAccountGraphqlUrl();
    const query = `#graphql
      query CustomerForOrderEdit {
        customer {
          id
          displayName
          emailAddress { emailAddress }
          phoneNumber { phoneNumber }
        }
      }
    `;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ query })
    });
    const text = await r.text();
    const json = safeJsonParse(text) || {};
    if (!r.ok || json?.errors?.length) {
      throw new Error(
        json?.errors?.map((e) => e.message).join(" | ") ||
          `Shopify Customer Account HTTP ${r.status}`
      );
    }
    return json?.data?.customer || null;
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeCustomerGid(value) {
    const s = String(value || "").trim();
    if (!s) return "";
    if (s.startsWith("gid://")) return s;
    return toGid("Customer", s);
  }

  function customerTokenLooksValid(value) {
    return String(value || "").trim().startsWith("shcat");
  }

  function appCustomerIdentity(req) {
    return {
      id: normalizeCustomerGid(req.headers?.["x-customer-id"] || req.body?.customerId || ""),
      email: normalizeEmail(req.headers?.["x-customer-email"] || req.body?.customerEmail || "")
    };
  }

  async function storefrontCustomerFromAccessToken(customerAccessToken) {
    const token = String(customerAccessToken || "").trim();
    if (!token || typeof storefrontGraphQL !== "function") return null;

    const data = await storefrontGraphQL(
      `#graphql
      query CustomerByStorefrontToken($customerAccessToken: String!) {
        customer(customerAccessToken: $customerAccessToken) {
          id
          firstName
          lastName
          email
          phone
        }
      }`,
      { customerAccessToken: token }
    );

    const customer = data?.customer || null;
    if (!customer?.id && !customer?.email) return null;
    return {
      id: customer.id || "",
      firstName: customer.firstName || "",
      lastName: customer.lastName || "",
      phone: customer.phone || "",
      emailAddress: { emailAddress: customer.email || "" }
    };
  }

  async function requireCustomerOrder(req, res, orderId) {
    const customerToken = extractCustomerBearer(req);
    const fallbackIdentity = appCustomerIdentity(req);

    if (!customerToken && !fallbackIdentity.id && !fallbackIdentity.email) {
      res.status(401).json({ error: "Missing customer token" });
      return null;
    }

    let customer = null;
    if (customerTokenLooksValid(customerToken)) {
      customer = await customerAccountCustomer(customerToken);
      if (!customer?.id) {
        res.status(401).json({ error: "Invalid customer token" });
        return null;
      }
    } else if (customerToken) {
      customer = await storefrontCustomerFromAccessToken(customerToken).catch((e) => {
        console.warn("storefront customer token failed:", e?.message || e);
        return null;
      });
    }

    const orderGid = toGid("Order", orderId);
    const data = await shopifyGraphQL(
      `#graphql
      query CustomerOrderGuard($id: ID!) {
        order(id: $id) {
          id
          legacyResourceId
          name
          email
          note
          tags
          cancelledAt
          closedAt
          displayFulfillmentStatus
          displayFinancialStatus
          customer {
            id
            email
          }
        }
      }`,
      { id: orderGid }
    );

    const order = data?.order;
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return null;
    }

    const customerId = normalizeCustomerGid(customer?.id || fallbackIdentity.id);
    const orderCustomerId = normalizeCustomerGid(order?.customer?.id);
    const customerEmail = normalizeEmail(
      customer?.emailAddress?.emailAddress || fallbackIdentity.email
    );
    const orderEmail = normalizeEmail(order?.customer?.email || order?.email);

    if (
      customerId !== orderCustomerId &&
      (!customerEmail || customerEmail !== orderEmail)
    ) {
      res.status(403).json({ error: "Order does not belong to this customer" });
      return null;
    }

    return {
      customer: customer || {
        id: orderCustomerId,
        emailAddress: { emailAddress: orderEmail }
      },
      order,
      orderGid,
      numericId: toNumericId(order.id)
    };
  }

  async function getCustomerOrderTotals(orderId) {
    const numericId = toNumericId(orderId);
    const orderGid = toGid("Order", numericId);

    const rest = await shopifyRest(
      `/orders/${numericId}.json?fields=id,currency,current_total_price,total_price,total_discounts,total_tax,total_outstanding,financial_status,order_status_url`,
      { method: "GET" }
    );
    const o = rest?.order || {};

    let gqlTotal = Number(o.current_total_price || o.total_price || 0) || 0;
    let outstanding = Number(o.total_outstanding || 0) || 0;
    let currency = String(o.currency || "OMR");
    const financialStatus = String(o.financial_status || "").toLowerCase();

    try {
      const data = await shopifyGraphQL(
        `#graphql
        query CustomerOrderTotals($id: ID!) {
          order(id: $id) {
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
        }`,
        { id: orderGid }
      );
      const go = data?.order;
      gqlTotal = Number(go?.currentTotalPriceSet?.shopMoney?.amount || gqlTotal) || gqlTotal;
      outstanding = Number(go?.totalOutstandingSet?.shopMoney?.amount || outstanding) || outstanding;
      currency = String(
        go?.currentTotalPriceSet?.shopMoney?.currencyCode ||
        go?.totalOutstandingSet?.shopMoney?.currencyCode ||
        currency
      );
    } catch {}

    const shouldTreatZeroOutstandingAsUnpaid =
      ["pending", "authorized", "partially_paid"].includes(financialStatus);
    if (outstanding <= 0 && gqlTotal > 0 && shouldTreatZeroOutstandingAsUnpaid) {
      outstanding = gqlTotal;
    }

    const paid = Math.max(0, gqlTotal - outstanding);
    return {
      ok: true,
      currency,
      current_total_price: Number(gqlTotal.toFixed(3)),
      total_discounts: Number((Number(o.total_discounts || 0) || 0).toFixed(3)),
      total_tax: Number((Number(o.total_tax || 0) || 0).toFixed(3)),
      total_outstanding: Number(outstanding.toFixed(3)),
      amount_paid: Number(paid.toFixed(3)),
      financial_status: o.financial_status || null,
      payment_url: o.order_status_url || ""
    };
  }

  async function getCustomerOrderPaidAmount(orderId, fallbackTotals = {}) {
    const fallbackAmount = Math.max(0, Number(fallbackTotals.amount_paid || 0) || 0);
    const fallbackCurrency = String(fallbackTotals.currency || "OMR");

    try {
      const numericId = toNumericId(orderId);
      const data = await shopifyRest(`/orders/${numericId}/transactions.json`, {
        method: "GET"
      });
      const transactions = Array.isArray(data?.transactions) ? data.transactions : [];
      let amount = 0;
      let currencyCode = fallbackCurrency;

      for (const tx of transactions) {
        const status = String(tx?.status || "").toLowerCase();
        if (status && status !== "success") continue;

        const kind = String(tx?.kind || "").toLowerCase();
        const value = Number(tx?.amount || 0) || 0;
        if (!value) continue;

        currencyCode = String(tx?.currency || currencyCode || "OMR");
        if (["sale", "capture"].includes(kind)) {
          amount += value;
        } else if (["refund", "void"].includes(kind)) {
          amount -= value;
        }
      }

      amount = Math.max(0, amount);
      if (amount <= 0 && fallbackAmount > 0) amount = fallbackAmount;
      return {
        amount: Number(amount.toFixed(3)),
        currencyCode: currencyCode || fallbackCurrency
      };
    } catch {
      return {
        amount: Number(fallbackAmount.toFixed(3)),
        currencyCode: fallbackCurrency
      };
    }
  }

  async function creditCustomerStoreCredit(customerId, amount, currencyCode) {
    if (!customerId || !Number.isFinite(amount) || amount <= 0 || !currencyCode) {
      return null;
    }
    const data = await shopifyGraphQL(
      `#graphql
      mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            amount { amount currencyCode }
            balanceAfterTransaction { amount currencyCode }
          }
          userErrors { field message }
        }
      }`,
      {
        id: normalizeCustomerGid(customerId),
        creditInput: {
          creditAmount: {
            amount: amount.toFixed(3),
            currencyCode
          }
        }
      }
    );
    const payload = data?.storeCreditAccountCredit || {};
    const errors = payload.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).filter(Boolean).join(" | "));
    }
    return payload.storeCreditAccountTransaction || null;
  }
async function getEnglishProductTitlesByHandles(handles = []) {
  const uniqueHandles = [...new Set(
    handles
      .map(h => String(h || "").trim())
      .filter(Boolean)
  )];

  const out = {};

  for (const handle of uniqueHandles) {
    const data = await storefrontGraphQL(
      `
      query ProductTitleByHandle($handle: String!)
      @inContext(language: EN) {
        product(handle: $handle) {
          handle
          title
        }
      }
      `,
      { handle }
    );

    const product = data?.product;
    if (product?.handle) {
      out[product.handle] = String(product.title || "").trim();
    }
  }

  return out;
}
  function escPdf(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function money3(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n.toFixed(3) : "0.000";
}

function normalizePhoneForWa(raw){
  let d = String(raw || "").replace(/\D+/g, "");
  while (d.startsWith("00968")) d = d.slice(5);
  while (d.startsWith("968968")) d = d.slice(3);
  if (d.startsWith("968")) d = d.slice(3);
  if (d.length > 8) d = d.slice(-8);
  return d.length === 8 ? "968" + d : "";
}

function publicBaseUrl(req){
  return `${req.protocol}://${req.get("host")}`;
}
router.get("/api/manage/order/:id/invoice-pdf", async (req, res) => {
  try {
    const orderId = String(req.params.id || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const numericId = toNumericId(orderId);
    const orderGid = toGid("Order", numericId);

const out = await shopifyRest(
  `/orders/${numericId}.json?fields=` +
    [
  "id",
  "name",
  "created_at",
  "phone",
  "currency",
  "tags",
  "customer",
  "shipping_address",
  "billing_address",
  "financial_status",
  "gateway",
  "payment_gateway_names",
  "current_total_price",
  "current_subtotal_price",
  "subtotal_price",
  "total_discounts",
  "total_tax",
  "total_shipping_price_set",
  "discount_codes",
  "discount_applications",
  "shipping_lines"
    ].join(","),
  { method: "GET" }
);
    
const o = out?.order;
if (!o) return res.status(404).json({ error: "الطلب غير موجود" });

const tagsRaw = String(o?.tags || "");
const orderTags = tagsRaw
  .split(",")
  .map(tag => tag.trim().toLowerCase())
  .filter(Boolean);

const isArabic = orderTags.includes("ar");
const pageLang = isArabic ? "ar" : "en";
const pageDir = isArabic ? "rtl" : "ltr";
const locale = isArabic ? "ar-OM" : "en-OM";
    
    const t = isArabic
      ? {
          invoice: "فاتورة الطلب",
          brandName: "Hala Beauty",
          orderDate: "تاريخ الطلب",
          shippingDetails: "تفاصيل الشحن",
          orderDetails: "بيانات الطلب",
          name: "الاسم",
          phone: "رقم الهاتف",
          address: "العنوان",
          orderNumber: "رقم الطلب",
          paymentStatus: "حالة الدفع",
          paymentMethod: "طريقة الدفع",
          discountCoupon: "كوبون الخصم",
          noProducts: "لا توجد منتجات في هذا الطلب",
          importantLinks: "روابط مهمة",
          website: "الموقع",
          whatsapp: "واتساب 77255566",
          financialSummary: "الملخص المالي",
          subtotal: "الإجمالي الفرعي",
          shipping: "الشحن",
          paid: "المدفوع",
          grandTotal: "الإجمالي النهائي",
          product: "المنتج",
          quantity: "الكمية",
          unitPrice: "سعر الوحدة",
          total: "الإجمالي",
          paymentPaid: "مدفوع",
          paymentPending: "انتظار الدفع",
          paymentAuthorized: "مفوض",
          paymentPartiallyPaid: "مدفوع جزئياً",
          paymentPartiallyRefunded: "مسترجع جزئياً",
          paymentRefunded: "مسترجع",
          paymentVoided: "ملغي",
          cod: "الدفع عند الاستلام",
          tabby: "تابي",
          tamara: "تمارا",
          paypal: "باي بال",
          bankCard: "بطاقة بنكية",
          visa: "فيزا",
          mastercard: "ماستركارد",
          bankTransfer: "تحويل بنكي",
          productFallback: "منتج",
          pdfFileName: "فاتورة الطلب",
        discount: "الخصم",
discountApplied: "خصم مطبق",
freeShipping: "شحن مجاني",
          notAvailable: "-"
        
        }
      : {
          invoice: "Order Invoice",
          brandName: "Hala Beauty",
          orderDate: "Order Date",
          shippingDetails: "Shipping Details",
          orderDetails: "Order Details",
          name: "Name",
          phone: "Phone",
          address: "Address",
          orderNumber: "Order Number",
          paymentStatus: "Payment Status",
          paymentMethod: "Payment Method",
          discountCoupon: "Discount Coupon",
          noProducts: "No products found in this order",
          importantLinks: "Important Links",
          website: "Website",
          whatsapp: "WhatsApp 77255566",
          financialSummary: "Financial Summary",
          subtotal: "Subtotal",
          shipping: "Shipping",
          paid: "Paid",
          grandTotal: "Grand Total",
          product: "Product",
          quantity: "Quantity",
          unitPrice: "Unit Price",
          total: "Total",
          paymentPaid: "Paid",
          paymentPending: "Pending",
          paymentAuthorized: "Authorized",
          paymentPartiallyPaid: "Partially Paid",
          paymentPartiallyRefunded: "Partially Refunded",
          paymentRefunded: "Refunded",
          paymentVoided: "Voided",
          cod: "Cash on Delivery",
          tabby: "Tabby",
          tamara: "Tamara",
          paypal: "PayPal",
          bankCard: "Bank Card",
          visa: "Visa",
          mastercard: "Mastercard",
          bankTransfer: "Bank Transfer",
          productFallback: "Product",
          pdfFileName: "Order Invoice",
        discount: "Discount",
discountApplied: "Discount Applied",
freeShipping: "Free Shipping",
          notAvailable: "-"
        };


const gql = await shopifyGraphQL(
  `
  query OrderLines($id: ID!) {
  order(id: $id) {
      id
      name
lineItems(first: 250) {
  edges {
    node {
      id
      title
      quantity
      currentQuantity
      originalUnitPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      variant {
              id
              title
              image { url }
              product {
                title
                handle
                featuredImage { url }
              }
              inventoryItem {
                requiresShipping
              }
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
      currentTotalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
  }
  `,
  { id: orderGid }
);
    
const go = gql?.order;
if (!go) {
  return res.status(404).json({ error: "الطلب غير موجود في GraphQL" });
}

const SITE_URL = "https://halabt.com";
const WEBSITE_URL = isArabic ? SITE_URL : `${SITE_URL}/en`;
const APP_URL = "https://app.halabt.com";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.btime.app";
const APPLE_STORE_URL = "https://halabt.com";
const INSTAGRAM_URL = "https://halabt.com";
const LOGO_URL = "https://halabt.com/cdn/shop/files/loogo.svg";
const WHATSAPP_NUMBER = "96877255566";
const WHATSAPP_URL = `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}&app_absent=0`;

    
const lineSeeds = (go?.lineItems?.edges || []).map((e) => {
  const n = e?.node || {};
  const v = n?.variant || {};
  const p = v?.product || {};

  return {
    n,
    v,
    p,
    handle: String(p?.handle || "").trim(),
  };
});

let englishTitlesByHandle = {};
if (!isArabic) {
  try {
    englishTitlesByHandle = await getEnglishProductTitlesByHandles(
      lineSeeds.map((x) => x.handle)
    );
  } catch (err) {
    console.error("storefront english titles failed:", err);
    englishTitlesByHandle = {};
  }
}

const lines = lineSeeds
  .map(({ n, v, p, handle }) => {
    const storefrontEnglishTitle = !isArabic
      ? String(englishTitlesByHandle[handle] || "").trim()
      : "";

    const adminArabicTitle = String(p?.title || "").trim();
    const lineTitle = String(n?.title || "").trim();

    const productTitle = isArabic
      ? adminArabicTitle
      : storefrontEnglishTitle;

    const variantTitle = String(v?.title || "").trim();
    const normalizedVariantTitle = variantTitle.toLowerCase().trim();
    const normalizedBaseTitle = productTitle.toLowerCase().trim();

    let title = productTitle || lineTitle || t.productFallback;

    if (
      variantTitle &&
      normalizedVariantTitle !== "default title" &&
      normalizedVariantTitle !== normalizedBaseTitle &&
      !normalizedBaseTitle.includes(normalizedVariantTitle)
    ) {
      title = `${title} — ${variantTitle}`;
    }

    const qty = Number(n?.currentQuantity ?? n?.quantity ?? 0) || 0;
    const unitPrice = Number(n?.originalUnitPriceSet?.shopMoney?.amount || 0) || 0;
    const requiresShipping = v?.inventoryItem?.requiresShipping !== false;
    const imageUrl = v?.image?.url || p?.featuredImage?.url || "";

    const productUrl = handle
      ? isArabic
        ? `${SITE_URL}/products/${handle}`
        : `${SITE_URL}/en/products/${handle}`
      : WEBSITE_URL;

    return {
      title,
      qty,
      unitPrice,
      lineTotal: qty * unitPrice,
      requiresShipping,
      imageUrl,
      productUrl,
    };
  })
  .filter((x) =>
  x.qty > 0 &&
  String(x.title || "").trim().toLowerCase() !== "removed" &&
  String(x.title || "").trim().toLowerCase() !== "deleted"
);
    
const shippingLines = Array.isArray(o?.shipping_lines) ? o.shipping_lines : [];

const shipping = shippingLines.length
  ? shippingLines.reduce((sum, line) => {
      const discounted =
        Number(
          line?.discounted_price ??
          line?.discounted_price_set?.shop_money?.amount ??
          line?.discounted_price_set?.presentment_money?.amount
        );

      const original =
        Number(
          line?.price ??
          line?.price_set?.shop_money?.amount ??
          line?.price_set?.presentment_money?.amount
        );

      const amount = Number.isFinite(discounted)
        ? discounted
        : Number.isFinite(original)
        ? original
        : 0;

      return sum + amount;
    }, 0)
  : Number(
      o?.total_shipping_price_set?.shop_money?.amount ??
      o?.total_shipping_price_set?.presentment_money?.amount ??
      0
    ) || 0;
    
const restTotal = Number(o?.current_total_price || 0) || 0;
const gqlOutstanding = Number(go?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
const gqlTotal = Number(go?.currentTotalPriceSet?.shopMoney?.amount || 0) || 0;

const currency = String(
  go?.currentTotalPriceSet?.shopMoney?.currencyCode ||
    go?.totalOutstandingSet?.shopMoney?.currencyCode ||
    o?.currency ||
    "OMR"
);
    
    const bestTotal = gqlTotal > 0 ? gqlTotal : restTotal;
    const outstanding = gqlOutstanding > 0 ? gqlOutstanding : 0;
    const amountPaid = Math.max(0, bestTotal - outstanding);

const totalDiscounts = Number(o?.total_discounts || 0) || 0;

const manualDiscountCodes = Array.isArray(o?.discount_codes)
  ? o.discount_codes
      .map(d => String(d?.code || "").trim())
      .filter(Boolean)
  : [];

const discountApplications = Array.isArray(o?.discount_applications)
  ? o.discount_applications
  : [];

const automaticDiscountTitles = discountApplications
  .map(app => {
    const code = String(app?.code || "").trim();
    const title = String(app?.title || "").trim();
    return code || title;
  })
  .filter(Boolean);

const allDiscountLabels = [...manualDiscountCodes, ...automaticDiscountTitles]
  .map(x => String(x || "").trim())
  .filter(Boolean)
  .filter((value, index, arr) => arr.indexOf(value) === index);

const discountCodeText = allDiscountLabels.join(" + ");
const discountAmount = totalDiscounts;
const hasDiscount = discountAmount > 0;
    
    const customerName =
      [
        o?.shipping_address?.name,
        [o?.customer?.first_name, o?.customer?.last_name].filter(Boolean).join(" "),
        [o?.billing_address?.first_name, o?.billing_address?.last_name].filter(Boolean).join(" "),
      ].find(Boolean) || "";

    const customerPhone =
      o?.phone ||
      o?.shipping_address?.phone ||
      o?.billing_address?.phone ||
      o?.customer?.phone ||
      "";

    const a = o?.shipping_address || o?.billing_address || {};
    const addressText = [a?.country, a?.city, a?.address1, a?.address2, a?.zip]
      .filter(Boolean)
      .join(isArabic ? "، " : ", ");

    function esc(v) {
      return String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function money(v) {
      const n = Number(v || 0);
      return Number.isFinite(n) ? n.toFixed(3) : "0.000";
    }

    function formatDate(value) {
      try {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value || "");
        return new Intl.DateTimeFormat(locale, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }).format(d);
      } catch {
        return String(value || "");
      }
    }

    function translateFinancialStatus(status) {
      const s = String(status || "").toLowerCase().trim();

      if (s === "paid") return t.paymentPaid;
      if (s === "pending") return t.paymentPending;
      if (s === "authorized") return t.paymentAuthorized;
      if (s === "partially_paid") return t.paymentPartiallyPaid;
      if (s === "partially_refunded") return t.paymentPartiallyRefunded;
      if (s === "refunded") return t.paymentRefunded;
      if (s === "voided") return t.paymentVoided;

      return status || t.notAvailable;
    }

    function translateGatewayName(name) {
      const n = String(name || "").toLowerCase().trim();

      if (!n) return "";
      if (
        n.includes("store credit") ||
        n.includes("store_credit") ||
        n.includes("customer credit") ||
        n.includes("customer_credit") ||
        n.includes("hala beauty credit") ||
        n.includes("hala beauty credit")
      ) return isArabic ? "رصيد هلا بيوتي" : "Hala Beauty Credit";
      if (n.includes("cash") || n.includes("cod")) return t.cod;
      if (n.includes("tabby")) return t.tabby;
      if (n.includes("tamara")) return t.tamara;
      if (n.includes("paypal")) return t.paypal;
      if (n.includes("stripe")) return t.bankCard;
      if (n.includes("visa")) return t.visa;
      if (n.includes("mastercard")) return t.mastercard;
      if (n.includes("manual")) return t.cod;
      if (n.includes("bank")) return t.bankTransfer;
      if (n.includes("card")) return t.bankCard;

      return name;
    }

    const paymentStatusText = translateFinancialStatus(o?.financial_status);

    const paymentMethods = Array.isArray(o?.payment_gateway_names)
      ? o.payment_gateway_names.filter(Boolean).map(translateGatewayName).join(" + ")
      : "";

const textAlignStart = isArabic ? "right" : "left";
const textAlignEnd = isArabic ? "left" : "right";
const flexRow = isArabic ? "row" : "row-reverse";
    
    const rowsHtml = lines.length
      ? lines
          .map(
            (it, idx) => `
          <tr>
            <td class="num">${idx + 1}</td>
            <td class="product">
              <div class="product-box">
                <a class="product-thumb-link" href="${esc(it.productUrl)}" target="_blank" rel="noopener noreferrer">
                  ${
                    it.imageUrl
                      ? `<img class="product-thumb" src="${esc(it.imageUrl)}" alt="${esc(it.title)}">`
                      : `<div class="product-thumb placeholder">BT</div>`
                  }
                </a>
                <div class="product-info">
                  <a class="product-link" href="${esc(it.productUrl)}" target="_blank" rel="noopener noreferrer">
                    ${esc(it.title)}
                  </a>
                </div>
              </div>
            </td>
            <td class="num">${esc(it.qty)}</td>
            <td class="price">${money(it.unitPrice)} ${esc(currency)}</td>
            <td class="price strong">${money(it.lineTotal)} ${esc(currency)}</td>
          </tr>
        `
          )
          .join("")
      : `
        <tr>
          <td colspan="5" class="empty">${esc(t.noProducts)}</td>
        </tr>
      `;

    const html = `
      <!doctype html>
      <html lang="${pageLang}" dir="${pageDir}">
      <head>
        <meta charset="utf-8" />
        <title>${esc(t.invoice)} ${esc(o?.name || numericId)}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
@page {
  size: A4;
  margin: 7mm;
}

* {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

html,
body {
  margin: 0;
  padding: 0;
  font-family: "Cairo", sans-serif;
  background: #fbf7f4;
  color: #33263b;
}

body {
  direction: inherit;
}

a {
  color: inherit;
  text-decoration: none;
}

.page {
  width: 100%;
  background: linear-gradient(180deg, #fffdfa 0%, #fff 100%);
  border: 1px solid #eddedd;
  border-radius: 26px;
  overflow: hidden;
}

/* ===== Header ===== */
.hero {
  background: linear-gradient(90deg, #742a8b 0%, #7e2f95 45%, #ecd4ca 100%);
  padding: 18px 22px 16px;
  position: relative;
}

.hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.12), transparent 28%),
    radial-gradient(circle at bottom right, rgba(255, 255, 255, 0.10), transparent 22%);
  pointer-events: none;
}
.hero-inner {
  position: relative;
  z-index: 1;
}

.hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  flex-wrap: nowrap;
}

.brand-wrap {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  flex: 1 1 auto;
}

.brand-logo-box {
  width: 130px;
  height: 92px;
  border-radius: 20px;
  background: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px 16px;
  flex: 0 0 auto;
}

.brand-logo-box img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.brand-text {
  min-width: 0;
  flex: 1 1 auto;
}

.brand-text h1 {
  margin: 0;
  font-size: 31px;
  line-height: 1.08;
  font-weight: 800;
  color: #fff;
}

.brand-text p {
  margin: 7px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
}

.hero-side {
  min-width: 240px;
  flex: 0 0 auto;
}

.order-title {
  margin: 0;
  font-size: 25px;
  font-weight: 800;
  color: #fff;
}

.order-date {
  margin-top: 7px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.92);
}

/* ===== Content ===== */
.content {
  padding: 14px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
  break-inside: avoid;
  page-break-inside: avoid;
}

.card {
  background: #fff;
  border: 1px solid #efdfde;
  border-radius: 20px;
  padding: 16px 17px;
  break-inside: avoid;
  page-break-inside: avoid;
  min-width: 0;
}

.card h3 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 800;
  color: #742a8b;
}

.meta-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dashed #f1e3df;
  font-size: 13px;
}

.meta-line:last-child {
  border-bottom: 0;
}

.meta-label {
  color: #8b7181;
  font-weight: 700;
  flex: 0 0 auto;
}

.meta-value {
  color: #2f2236;
  font-weight: 800;
  line-height: 1.7;
  min-width: 0;
  flex: 1 1 auto;
}

/* ===== Table ===== */
.table-wrap {
  background: #fff;
  border: 1px solid #efdfde;
  border-radius: 20px;
  overflow: hidden;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead {
  display: table-header-group;
}

thead th {
  background: linear-gradient(90deg, #742a8b 0%, #87409d 100%);
  color: #fff;
  padding: 13px 10px;
  font-size: 12px;
  font-weight: 800;
  text-align: center;
}

tbody tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

tbody td {
  padding: 12px 10px;
  border-bottom: 1px solid #f5e9e6;
  font-size: 12px;
  vertical-align: middle;
  background: #fff;
}

tbody tr:nth-child(even) td {
  background: #fffaf8;
}

tbody tr:last-child td {
  border-bottom: 0;
}

.num {
  text-align: center;
  white-space: nowrap;
}

.price {
  text-align: center;
  white-space: nowrap;
  direction: ltr;
}

.strong {
  font-weight: 800;
}

.product-box {
  display: flex;
  align-items: center;
  gap: 12px;
}

.product-thumb-link {
  text-decoration: none;
  flex: 0 0 auto;
}

.product-thumb {
  width: 58px;
  height: 58px;
  border-radius: 15px;
  object-fit: cover;
  display: block;
  border: 1px solid #ecd9d7;
  background: #fff;
}

.product-thumb.placeholder {
  width: 58px;
  height: 58px;
  border-radius: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #f6e2db 0%, #f0d3d9 100%);
  color: #742a8b;
  font-weight: 800;
  border: 1px solid #ecd9d7;
}

.product-info {
  min-width: 0;
  flex: 1 1 auto;
}

.product-link {
  color: #3d2747;
  text-decoration: none;
  font-weight: 800;
  line-height: 1.7;
}

.empty {
  text-align: center;
  color: #8a7181;
  padding: 20px !important;
}

/* ===== Bottom ===== */
.bottom-grid {
  margin-top: 12px;
  break-inside: avoid;
  page-break-inside: avoid;
}

.bottom-row {
  display: table;
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 12px 0;
}

.links-box,
.totals {
  display: table-cell;
  vertical-align: top;
}

.links-box {
  width: 220px;
  min-width: 220px;
  background: #fff;
  border: 1px solid #efdfde;
  border-radius: 20px;
  padding: 12px;
}

.links-box h3,
.totals h3 {
  margin: 0 0 10px;
  color: #742a8b;
  font-size: 14px;
  font-weight: 800;
}

.links-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.link-tile {
  min-height: 82px;
  border-radius: 16px;
  border: 1px solid #efdfde;
  background: linear-gradient(180deg, #fff 0%, #fff9f8 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
  color: #2f2236;
  padding: 10px 8px;
}

.link-tile svg {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
}

.link-tile span {
  font-size: 11px;
  font-weight: 800;
  line-height: 1.4;
}

.link-tile.wide {
  grid-column: 1 / -1;
  min-height: 72px;
  flex-direction: row;
  gap: 10px;
}

.link-tile.whatsapp {
  border-color: rgba(37, 211, 102, 0.25);
  background: linear-gradient(180deg, #fff 0%, #f2fff7 100%);
  color: #1d8f49;
}

.totals {
  background: #fff;
  border: 1px solid #efdfde;
  border-radius: 20px;
  padding: 14px 16px;
}

.total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 0;
  border-bottom: 1px dashed #f1e3df;
  font-size: 13px;
}

.total-line:last-child {
  border-bottom: 0;
}

.total-line .label {
  color: #8b7181;
  font-weight: 700;
}

.total-line .value {
  color: #2f2236;
  font-weight: 800;
  direction: ltr;
  white-space: nowrap;
}

.discount-line .value {
  color: #c43b5d;
}

.grand {
  margin-top: 8px;
  padding: 13px 14px;
  border-radius: 16px;
  background: linear-gradient(90deg, #742a8b 0%, #e4c3b8 140%);
}

.grand .label,
.grand .value {
  color: #fff !important;
  font-size: 15px;
  font-weight: 800;
}

/* ===== Footer ===== */
.footer {
  padding: 10px 16px 16px;
  text-align: center;
  color: #9b7d8f;
  font-size: 11px;
}

/* ===== RTL ===== */
html[dir="rtl"] body {
  direction: rtl;
}

html[dir="rtl"] .hero-top,
html[dir="rtl"] .brand-wrap,
html[dir="rtl"] .meta-line,
html[dir="rtl"] .product-box,
html[dir="rtl"] .total-line {
  flex-direction: row;
}

html[dir="rtl"] .brand-text,
html[dir="rtl"] .product-info,
html[dir="rtl"] .links-box h3,
html[dir="rtl"] .totals h3,
html[dir="rtl"] .card h3 {
  text-align: right;
}

html[dir="rtl"] .hero-side {
  text-align: left;
}

html[dir="rtl"] .meta-value {
  text-align: left;
}

html[dir="rtl"] .meta-label {
  text-align: right;
}

html[dir="rtl"] .links-box,
html[dir="rtl"] .totals {
  direction: rtl;
}

html[dir="rtl"] .bottom-row {
  direction: ltr;
}

/* ===== LTR ===== */
html[dir="ltr"] body {
  direction: ltr;
}

html[dir="ltr"] .hero-top,
html[dir="ltr"] .brand-wrap,
html[dir="ltr"] .meta-line,
html[dir="ltr"] .product-box,
html[dir="ltr"] .total-line {
  flex-direction: row;
}

html[dir="ltr"] .brand-text,
html[dir="ltr"] .product-info,
html[dir="ltr"] .links-box h3,
html[dir="ltr"] .totals h3,
html[dir="ltr"] .card h3 {
  text-align: left;
}

html[dir="ltr"] .hero-side {
  text-align: right;
}

html[dir="ltr"] .meta-value {
  text-align: right;
}

html[dir="ltr"] .meta-label {
  text-align: left;
}

html[dir="ltr"] .links-box,
html[dir="ltr"] .totals {
  direction: ltr;
}

html[dir="ltr"] .bottom-row {
  direction: ltr;
}

/* ===== Print ===== */
.hero,
.grid,
.card,
.table-wrap,
.bottom-grid,
.bottom-row,
.links-box,
.totals {
  break-inside: avoid;
  page-break-inside: avoid;
}

@media print {
  html,
  body {
    background: #fff;
  }

  .page {
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }

  .bottom-row {
    display: table !important;
    width: 100% !important;
    table-layout: fixed !important;
    border-collapse: separate !important;
    border-spacing: 10px 0 !important;
  }

  .links-box,
  .totals {
    display: table-cell !important;
    vertical-align: top !important;
  }

  .links-box {
    width: 210px !important;
    min-width: 210px !important;
  }
}

/* ===== Mobile ===== */
@media (max-width: 900px) {
  .bottom-row {
    display: block;
  }

  .links-box,
  .totals {
    display: block;
    width: 100%;
    min-width: 0;
  }

  .links-box {
    margin-bottom: 12px;
  }
}
/* ===== Pagination Fix ===== */

/* الهيدر يظهر في بداية كل صفحة */
.hero {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* معلومات الطلب لا تنكسر */
.grid {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* المنتجات فقط هي التي تنكسر */
.table-wrap {
  break-inside: auto;
  page-break-inside: auto;
}

/* كل صف منتج لا ينكسر */
tbody tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* الفوتر لا ينكسر */
.bottom-grid {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* الفوتر يظهر فقط في آخر صفحة */
.footer {
  break-inside: avoid;
  page-break-inside: avoid;
}
</style>
      </head>
      <body>
        <div class="page">
          <section class="hero">
            <div class="hero-inner">
              <div class="hero-top">
                <div class="brand-wrap">
                  <div class="brand-logo-box">
                    <img src="${esc(LOGO_URL)}" alt="Hala Beauty">
                  </div>

                  <div class="brand-text">
                    <h1>${esc(t.invoice)}</h1>
                    <p>${esc(t.brandName)}</p>
                  </div>
                </div>

                <div class="hero-side">
                  <h2 class="order-title">${esc(o?.name || numericId)}</h2>
                  <div class="order-date">${esc(t.orderDate)}: ${esc(formatDate(o?.created_at || ""))}</div>
                </div>
              </div>
            </div>
          </section>

          <section class="content">
            <section class="grid">
              <div class="card">
                <h3>${esc(t.shippingDetails)}</h3>
                <div class="meta-line"><span class="meta-label">${esc(t.name)}</span><span class="meta-value">${esc(customerName || t.notAvailable)}</span></div>
                <div class="meta-line"><span class="meta-label">${esc(t.phone)}</span><span class="meta-value">${esc(customerPhone || t.notAvailable)}</span></div>
                <div class="meta-line"><span class="meta-label">${esc(t.address)}</span><span class="meta-value">${esc(addressText || t.notAvailable)}</span></div>
              </div>

              <div class="card">
                <h3>${esc(t.orderDetails)}</h3>
                <div class="meta-line"><span class="meta-label">${esc(t.orderNumber)}</span><span class="meta-value">${esc(o?.name || numericId)}</span></div>
                <div class="meta-line"><span class="meta-label">${esc(t.paymentStatus)}</span><span class="meta-value">${esc(paymentStatusText || t.notAvailable)}</span></div>
                <div class="meta-line"><span class="meta-label">${esc(t.paymentMethod)}</span><span class="meta-value">${esc(paymentMethods || t.notAvailable)}</span></div>
${
  hasDiscount
    ? `
  <div class="meta-line">
    <span class="meta-label">${esc(t.discountCoupon)}</span>
    <span class="meta-value">${esc(discountCodeText || t.discountApplied)}</span>
  </div>
`
    : ""
}
</div>
            </section>

            <section class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style="width:7%">#</th>
                    <th style="width:49%">${esc(t.product)}</th>
                    <th style="width:12%">${esc(t.quantity)}</th>
                    <th style="width:16%">${esc(t.unitPrice)}</th>
                    <th style="width:16%">${esc(t.total)}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </section>

            <section class="bottom-grid">
              <div class="bottom-row">
                <aside class="links-box">
                  <h3>${esc(t.importantLinks)}</h3>

                  <div class="links-grid">
                    <a class="link-tile" href="${esc(APPLE_STORE_URL)}" target="_blank" rel="noopener noreferrer" aria-label="App Store">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M16.37 12.02c.02 2.26 1.98 3.01 2 3.02-.02.05-.31 1.06-1.02 2.1-.61.9-1.25 1.79-2.25 1.81-.98.02-1.29-.58-2.41-.58-1.13 0-1.47.56-2.4.6-.97.04-1.71-.97-2.33-1.86-1.26-1.82-2.22-5.13-.93-7.38.64-1.12 1.8-1.83 3.05-1.85.95-.02 1.85.64 2.41.64.56 0 1.62-.79 2.72-.67.46.02 1.77.19 2.61 1.42-.07.04-1.56.91-1.55 2.75ZM14.8 4.3c.51-.62.86-1.48.77-2.34-.73.03-1.62.49-2.14 1.1-.47.55-.88 1.42-.77 2.25.81.06 1.63-.41 2.14-1.01Z"/>
                      </svg>
                      <span>App Store</span>
                    </a>

                    <a class="link-tile" href="${esc(GOOGLE_PLAY_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Google Play">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3 2.5v19l10.5-9.5L3 2.5Zm12.1 10.4 2.9-2.6L6 3.2l9.1 9.7Zm3.8 3.3c.7-.4 1.1-.9 1.1-1.5s-.4-1.1-1.1-1.5l-2.6-1.5-3.1 2.8 3.1 2.8 2.6-1.5Zm-12.9 4.6 12-7.1-2.9-2.6-9.1 9.7Z"/>
                      </svg>
                      <span>Google Play</span>
                    </a>

                    <a class="link-tile" href="${esc(WEBSITE_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Website">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12h18"></path>
                        <path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z"></path>
                      </svg>
                      <span>${esc(t.website)}</span>
                    </a>

                    <a class="link-tile" href="${esc(INSTAGRAM_URL)}" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 1.5A4.25 4.25 0 0 0 3.5 7.75v8.5A4.25 4.25 0 0 0 7.75 20.5h8.5a4.25 4.25 0 0 0 4.25-4.25v-8.5A4.25 4.25 0 0 0 16.25 3.5h-8.5zm8.75 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z"/>
                      </svg>
                      <span>Instagram</span>
                    </a>

                    <a class="link-tile wide whatsapp" href="${esc(WHATSAPP_URL)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t.whatsapp)}">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20.52 3.48A11.86 11.86 0 0 0 12.07 0C5.5 0 .15 5.35.15 11.92c0 2.1.55 4.15 1.6 5.95L0 24l6.31-1.65a11.9 11.9 0 0 0 5.76 1.47h.01c6.57 0 11.92-5.35 11.92-11.92 0-3.18-1.24-6.17-3.48-8.42ZM12.08 21.8h-.01a9.9 9.9 0 0 1-5.03-1.37l-.36-.21-3.74.98 1-3.65-.24-.38a9.87 9.87 0 0 1-1.52-5.26C2.18 6.47 6.64 2 12.08 2c2.65 0 5.14 1.03 7.01 2.91A9.85 9.85 0 0 1 22 11.92c0 5.44-4.47 9.88-9.92 9.88Zm5.42-7.42c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.08-.3-.15-1.25-.46-2.38-1.46-.88-.79-1.47-1.76-1.64-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.21-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.08-.79.37-.27.3-1.04 1.01-1.04 2.46s1.06 2.85 1.2 3.05c.15.2 2.08 3.18 5.03 4.46.7.3 1.25.49 1.68.62.7.22 1.34.19 1.84.12.56-.08 1.77-.72 2.02-1.42.25-.7.25-1.31.17-1.44-.07-.12-.27-.2-.57-.35Z"/>
                      </svg>
                      <span>${esc(t.whatsapp)}</span>
                    </a>
                  </div>
                </aside>

                <div class="totals">
                  <h3>${esc(t.financialSummary)}</h3>

                  <div class="total-line">
                    <span class="label">${esc(t.subtotal)}</span>
                    <span class="value">${money(Number(o?.current_subtotal_price || o?.subtotal_price || 0))} ${esc(currency)}</span>
                  </div>

<div class="total-line">
  <span class="label">${esc(t.shipping)}</span>
  <span class="value">
    ${
      shipping <= 0
  ? esc(t.freeShipping)
      : `${money(shipping)} ${esc(currency)}`
    }
  </span>
</div>
${
  hasDiscount
    ? `
  <div class="total-line discount-line">
    <span class="label">
      ${esc(
        discountCodeText
          ? `${t.discountCoupon} (${discountCodeText})`
          : (isArabic ? "إجمالي الخصم" : "Total Discount")
      )}
    </span>
    <span class="value">- ${money(discountAmount)} ${esc(currency)}</span>
  </div>
`
    : ""
}
<div class="total-line">
                    <span class="label">${esc(t.paid)}</span>
                    <span class="value">${money(amountPaid)} ${esc(currency)}</span>
                  </div>

                  <div class="total-line grand">
                    <span class="label">${esc(t.grandTotal)}</span>
                    <span class="value">${money(bestTotal)} ${esc(currency)}</span>
                  </div>
                </div>
              </div>
            </section>
          </section>

          <div class="footer">
            © Hala Beauty
          </div>
        </div>
      </body>
      </html>
    `;

    const safeOrderName = String(o?.name || numericId)
      .replace(/[\\/:*?"<>|#]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const downloadName = `${t.pdfFileName} - ${safeOrderName}.pdf`;

if (
  String(req.query?.html || "") === "1" ||
  String(req.query?.as || "") === "html"
) {
  res.setHeader("Cache-Control", "no-store");
  return res.type("html").send(html);
}
    
    const browser = await getInvoiceBrowser();
    const page = await browser.newPage();
    let pdfBuffer;
    try {
      await page.setViewport({ width: 1400, height: 1900, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle0" });

      pdfBuffer = await page.pdf({
        width: "210mm",
        height: "297mm",
        printBackground: true,
        preferCSSPageSize: true,
        margin: {
          top: "0",
          right: "0",
          bottom: "0",
          left: "0"
        }
      });
    } finally {
      await page.close().catch(() => {});
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
    );
    res.setHeader("Cache-Control", "no-store");

    return res.end(pdfBuffer);
  } catch (e) {
    console.error("invoice-pdf failed:", e);
    return res.status(500).json({
      error: e?.message || String(e)
    });
  }
});  
  
  // ================== ✅ INTERNAL ORDER NOTES (REDIS) ==================
function normalizeOrderId(id){
  const s = String(id || "").trim();

  // لو جاء بصيغة #1234
  const hash = s.match(/#(\d+)\b/);
  if(hash) return hash[1];

  // لو GID مثل gid://shopify/Order/123456
  const m = s.match(/(\d+)\s*$/);
  return m ? m[1] : s;
}

function orderNoteKey(orderId) {
  return `bt:orderNote:${normalizeOrderId(orderId)}`;
}

const requirePack = deps.requirePack;

if (!getRedis) console.warn("[ordersManage] deps.getRedis مفقود");
if (!requirePack) console.warn("[ordersManage] deps.requirePack مفقود");


  
  // ✅ GET /api/pack/order-note?orderId=...
router.get("/api/pack/order-note", requirePack, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const raw = await r.get(orderNoteKey(orderId));
    const obj = raw ? JSON.parse(raw) : null;

    return res.json({
      orderId,
      note: String(obj?.note || ""),
      updatedAt: obj?.updatedAt || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// ✅ POST /api/pack/order-note   { orderId, note }   (note فاضي = يمسح)
router.post("/api/pack/order-note", requirePack, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").trim();
    const note = String(req.body?.note ?? "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    if (!note) {
      await r.del(orderNoteKey(orderId));
      return res.json({ ok: true, cleared: true });
    }

    const payload = { note, updatedAt: new Date().toISOString() };
    await r.set(orderNoteKey(orderId), JSON.stringify(payload));

    return res.json({ ok: true, cleared: false, ...payload });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// ✅ POST /api/pack/order-notes/bulk  { orderIds:[...] } -> { map:{ id: note } }
router.post("/api/pack/order-notes/bulk", requirePack, async (req, res) => {
  try {
    const orderIds = Array.isArray(req.body?.orderIds) ? req.body.orderIds : [];
    const ids = orderIds.map(x => String(x || "").trim()).filter(Boolean);

    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    if (!ids.length) return res.json({ map: {} });

    const keys = ids.map(orderNoteKey);
    const vals = await r.mGet(keys);

    const map = {};
    for (let i = 0; i < ids.length; i++) {
      const raw = vals?.[i] || "";
      if (!raw) continue;
      try {
        const obj = JSON.parse(raw);
        const n = String(obj?.note || "").trim();
        if (n) map[ids[i]] = n;
      } catch {}
    }

    return res.json({ map });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
// =========================
// ✅ ORDER EDIT (Edit Products)
// =========================

// Helpers: read userErrors nicely
function pickUserErrors(arr){
  if(!Array.isArray(arr) || !arr.length) return "";
  return arr.map(e => e?.message).filter(Boolean).join(" | ");
}

// 1) Begin edit session
async function orderEditBegin(orderGid){
  const GQL = `
    mutation Begin($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder { id }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(GQL, { id: orderGid });

  const msg = pickUserErrors(data?.orderEditBegin?.userErrors);
  if(msg) throw new Error(msg);

  const calcId = data?.orderEditBegin?.calculatedOrder?.id;
  if(!calcId) throw new Error("لم يتم إنشاء جلسة تعديل (calculatedOrder.id مفقود)");
  return calcId;
}
  
// ✅ read calculated line items (for resolving calculatedLineItemId)
async function getCalculatedLineItems(calculatedOrderId){
  const GQL = `
    query Calc($id: ID!) {
      node(id: $id) {
        ... on CalculatedOrder {
          id
          lineItems(first: 250) {
            nodes {
              id
              title
              quantity
              variant { id }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(GQL, { id: calculatedOrderId });

  const co = data?.node; // هذا هو CalculatedOrder
  return co?.lineItems?.nodes || [];
}

// 2) Set quantity (also can remove by qty=0)
// ✅ IMPORTANT: lineItemId هنا لازم يكون CalculatedLineItem ID
async function orderEditSetQuantity(calculatedOrderId, calculatedLineItemId, quantity){
  const GQL = `
    mutation SetQty($id: ID!, $lineItemId: ID!, $quantity: Int!) {
      orderEditSetQuantity(id: $id, lineItemId: $lineItemId, quantity: $quantity) {
        calculatedOrder { id }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(GQL, {
    id: calculatedOrderId,
    lineItemId: calculatedLineItemId,
    quantity: Number(quantity),
  });

  const msg = pickUserErrors(data?.orderEditSetQuantity?.userErrors);
  if(msg) throw new Error(msg);
}

// 3) Add variant
async function orderEditAddVariant(calculatedOrderId, variantGid, quantity){
  const GQL = `
    mutation AddVar($id: ID!, $variantId: ID!, $quantity: Int!) {
      orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
        calculatedOrder { id }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(GQL, {
    id: calculatedOrderId,
    variantId: variantGid,
    quantity: Number(quantity),
  });

  const msg = pickUserErrors(data?.orderEditAddVariant?.userErrors);
  if(msg) throw new Error(msg);
}

// 4) Commit edit
async function orderEditCommit(calculatedOrderId, notifyCustomer=false, staffNote=""){
  const GQL = `
    mutation Commit($id: ID!, $notifyCustomer: Boolean!, $staffNote: String) {
      orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
        order { id name }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(GQL, {
    id: calculatedOrderId,
    notifyCustomer: !!notifyCustomer,
    staffNote: staffNote || null,
  });

  const msg = pickUserErrors(data?.orderEditCommit?.userErrors);
  if(msg) throw new Error(msg);

  return data?.orderEditCommit?.order || null;
}

/**
 * ✅ Endpoint واحد: يعدل المنتجات بالكامل
 */
router.post("/api/manage/order/edit", async (req, res) => {
  try{
    const { orderId, ops, notifyCustomer=false, staffNote="" } = req.body || {};
    if(!orderId) return res.status(400).json({ error:"orderId مطلوب" });

    const orderGid = toGid("Order", orderId);

    const listOps = Array.isArray(ops) ? ops : [];
    if(!listOps.length) return res.status(400).json({ error:"ops مطلوبة" });

    // ✅ Begin
    const calculatedOrderId = await orderEditBegin(orderGid);

    // ✅ read calculated lines and build resolver map
    const calcLines = await getCalculatedLineItems(calculatedOrderId);

    const byVariant = new Map(); // variantGid => [calculatedLineItem]
    for (const li of calcLines) {
      const vgid = li?.variant?.id || "";
      if (!vgid) continue;
      if (!byVariant.has(vgid)) byVariant.set(vgid, []);
      byVariant.get(vgid).push(li);
    }

    function resolveCalculatedLineItemId(op){
      // 1) direct (لو أرسلتها جاهزة)
      if (op?.calculatedLineItemId) return String(op.calculatedLineItemId);

      // 2) by variantGid (المعتمد)
      const vg = String(op?.variantGid || "");
      if (vg && byVariant.has(vg)) {
        const arr = byVariant.get(vg) || [];
        return String(arr[0]?.id || "");
      }

      return "";
    }

    // ✅ Apply ops in order
    for(const op of listOps){
      const type = String(op?.type || "").toLowerCase();

      if(type === "set_qty"){
        const qty = Number(op?.quantity);
        if(!Number.isFinite(qty) || qty < 0) throw new Error("set_qty quantity غير صالح");

        const calcLineId = resolveCalculatedLineItemId(op);
        if(!calcLineId) throw new Error("invalid id: لازم ترسل variantGid صحيح مع set_qty");

        await orderEditSetQuantity(calculatedOrderId, calcLineId, qty);
        continue;
      }

      if(type === "remove"){
        const calcLineId = resolveCalculatedLineItemId(op);
        if(!calcLineId) throw new Error("invalid id: لازم ترسل variantGid صحيح مع remove");

        await orderEditSetQuantity(calculatedOrderId, calcLineId, 0);
        continue;
      }

      if(type === "add"){
        const variantGid = String(op?.variantGid || "");
        const qty = Number(op?.quantity || 1);
        if(!variantGid) throw new Error("add يحتاج variantGid");
        if(!Number.isFinite(qty) || qty <= 0) throw new Error("add quantity غير صالح");

        await orderEditAddVariant(calculatedOrderId, variantGid, qty);
        continue;
      }

      throw new Error("نوع عملية غير معروف: " + type);
    }

    // ✅ Commit
    const order = await orderEditCommit(calculatedOrderId, notifyCustomer, staffNote);

    return res.json({ ok:true, orderId: toNumericId(orderId), calculatedOrderId, order });
  }catch(e){
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get("/api/customer/order/:id/lines", async (req, res) => {
  try {
    const guard = await requireCustomerOrder(req, res, req.params.id);
    if (!guard) return;

    const lang = String(req.query.lang || req.headers["x-app-lang"] || "").toLowerCase();
    const isArabic = lang ? lang.startsWith("ar") : false;

    const data = await shopifyGraphQL(
      `#graphql
      query CustomerOrderLines($id: ID!) {
        order(id: $id) {
          id
          lineItems(first: 250) {
            edges {
              node {
                id
                title
                quantity
                currentQuantity
                variant {
                  id
                  title
                  sku
                  barcode
                  price
                  image { url }
                  product {
                    title
                    handle
                    featuredImage { url }
                  }
                }
                originalUnitPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }
      }`,
      { id: guard.orderGid }
    );

    const lineSeeds = (data?.order?.lineItems?.edges || []).map((e) => {
      const n = e?.node || {};
      const v = n?.variant || {};
      const p = v?.product || {};
      return { n, v, p, handle: String(p?.handle || "").trim() };
    });

    let englishTitlesByHandle = {};
    if (!isArabic) {
      try {
        englishTitlesByHandle = await getEnglishProductTitlesByHandles(
          lineSeeds.map((x) => x.handle)
        );
      } catch {
        englishTitlesByHandle = {};
      }
    }

    const items = lineSeeds
      .map(({ n, v, p, handle }) => {
        const variantGid = String(v?.id || "");
        const variantTitle = String(v?.title || "").trim();
        const productTitle = isArabic
          ? String(p?.title || n?.title || "").trim()
          : String(englishTitlesByHandle[handle] || p?.title || n?.title || "").trim();
        const normalizedVariant = variantTitle.toLowerCase();
        let title = productTitle || String(n?.title || "Product");
        if (
          variantTitle &&
          normalizedVariant !== "default title" &&
          !title.toLowerCase().includes(normalizedVariant)
        ) {
          title = `${title} - ${variantTitle}`;
        }
        return {
          lineItemGid: String(n?.id || ""),
          title,
          qty: Number(n?.currentQuantity ?? n?.quantity ?? 0) || 0,
          variantGid,
          variantId: variantGid ? toNumericId(variantGid) : "",
          sku: String(v?.sku || ""),
          barcode: String(v?.barcode || ""),
          price: String(n?.originalUnitPriceSet?.shopMoney?.amount ?? v?.price ?? "0"),
          imageUrl: String(v?.image?.url || p?.featuredImage?.url || "")
        };
      })
      .filter((it) => it.qty > 0 && it.variantGid);

    return res.json({ ok: true, orderId: guard.numericId, items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get("/api/customer/order/:id/totals", async (req, res) => {
  try {
    const guard = await requireCustomerOrder(req, res, req.params.id);
    if (!guard) return;
    return res.json(await getCustomerOrderTotals(guard.numericId));
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get("/api/customer/order/:id/capabilities", async (req, res) => {
  try {
    const guard = await requireCustomerOrder(req, res, req.params.id);
    if (!guard) return;

    const tags = Array.isArray(guard.order?.tags) ? guard.order.tags : [];
    const normalizedTags = tags.map((tag) => String(tag || "").trim().toLowerCase());
    const editBlockedByTag =
      normalizedTags.includes("noedit") ||
      normalizedTags.includes("easysell_cod_form");
    const fulfillmentStatus = String(guard.order?.displayFulfillmentStatus || "")
      .trim()
      .toLowerCase();
    const editBlockedByFulfillment = [
      "fulfilled",
      "partially_fulfilled",
      "in_progress"
    ].includes(fulfillmentStatus);
    const canEdit =
      !guard.order?.cancelledAt &&
      !guard.order?.closedAt &&
      !editBlockedByTag &&
      !editBlockedByFulfillment;
    const canCancel =
      !guard.order?.cancelledAt &&
      !guard.order?.closedAt;

    return res.json({
      ok: true,
      orderId: guard.numericId,
      tags,
      canEdit,
      canCancel,
      isCancelled: !!guard.order?.cancelledAt,
      isShipped: editBlockedByFulfillment,
      fulfillmentStatus: guard.order?.displayFulfillmentStatus || null,
      hasNoEditTag: editBlockedByTag
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get("/api/customer/products/search", async (req, res) => {
  try {
    const token = extractCustomerBearer(req);
    const fallbackIdentity = appCustomerIdentity(req);
    if (customerTokenLooksValid(token)) {
      await customerAccountCustomer(token);
    } else if (token) {
      const customer = await storefrontCustomerFromAccessToken(token).catch((e) => {
        console.warn("storefront product search token failed:", e?.message || e);
        return null;
      });
      if (!customer?.id && !customer?.emailAddress?.emailAddress && !fallbackIdentity.id && !fallbackIdentity.email) {
        return res.status(401).json({ error: "Invalid customer token" });
      }
    } else if (!fallbackIdentity.id && !fallbackIdentity.email) {
      return res.status(401).json({ error: "Missing customer identity" });
    }

    const qRaw = String(req.query.q || "").trim();
    if (!qRaw || qRaw.length < 2) return res.json({ ok: true, items: [] });

    const limit = Math.min(25, Math.max(1, Number(req.query.limit || 12)));
    const safe = qRaw.replace(/"/g, '\\"');
    const searchQuery = `(${safe}) OR title:${safe}* OR vendor:${safe}* OR tag:${safe}*`;

    const data = await shopifyGraphQL(
      `#graphql
      query SearchCustomerProducts($first:Int!, $query:String!) {
        products(first:$first, query:$query) {
          edges {
            node {
              title
              vendor
              featuredImage { url }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    sku
                    barcode
                    price
                    image { url }
                  }
                }
              }
            }
          }
        }
      }`,
      { first: limit, query: searchQuery }
    );

    const items = [];
    for (const edge of data?.products?.edges || []) {
      const p = edge?.node || {};
      for (const ve of p?.variants?.edges || []) {
        const v = ve?.node || {};
        const variantTitle = String(v?.title || "");
        const title =
          variantTitle && variantTitle !== "Default Title"
            ? `${p?.title || ""} - ${variantTitle}`
            : String(p?.title || "");
        items.push({
          variantGid: String(v?.id || ""),
          variantId: v?.id ? toNumericId(v.id) : "",
          title,
          sku: String(v?.sku || ""),
          barcode: String(v?.barcode || ""),
          price: String(v?.price || "0"),
          vendor: String(p?.vendor || ""),
          imageUrl: String(v?.image?.url || p?.featuredImage?.url || "")
        });
      }
    }

    return res.json({ ok: true, items: items.filter((x) => x.variantGid).slice(0, limit * 3) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

function cleanCustomerCancelNoteLine(value) {
  let line = String(value || "").replace(/\s+/g, " ").trim();
  if (!line) return "";
  line = line
    .replace(/^This order was cancell?ed\.?\s*Cancellation reason:\s*/i, "")
    .replace(/^Cancellation reason:\s*/i, "")
    .replace(/^Cancel reason:\s*/i, "")
    .replace(/^\u0633\u0628\u0628\s*(?:\u0627\u0644\u0625\u0644\u063a\u0627\u0621|\u0627\u0644\u0627\u0644\u063a\u0627\u0621)\s*:\s*/i, "")
    .replace(/^\u0645\u0644\u0627\u062d\u0638\u0629\s+\u0627\u0644\u0639\u0645\u064a\u0644\s*:\s*/i, "")
    .replace(/\s*\u062a\u0645\s+\u0625?\u0631\u062c\u0627\u0639\s+.*$/i, "")
    .trim();
  return line;
}

function cleanExistingOrderNoteForCancel(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter((line) => {
      const normalized = line.toLowerCase();
      return line &&
        !/^This order was cancell?ed/i.test(line) &&
        !/^Cancellation reason:/i.test(line) &&
        !/^Cancel reason:/i.test(line) &&
        !/^\u0633\u0628\u0628\s*(?:\u0627\u0644\u0625\u0644\u063a\u0627\u0621|\u0627\u0644\u0627\u0644\u063a\u0627\u0621)\s*:/i.test(line) &&
        !/^\u0645\u0644\u0627\u062d\u0638\u0629\s+\u0627\u0644\u0639\u0645\u064a\u0644\s*:/i.test(line) &&
        !/^\u062a\u0645\s+\u0625?\u0631\u062c\u0627\u0639\s+/i.test(line) &&
        normalized !== "shopify";
    })
    .join("\n")
    .trim();
}

router.post("/api/customer/order/:id/edit", async (req, res) => {
  try {
    const guard = await requireCustomerOrder(req, res, req.params.id);
    if (!guard) return;

    if (guard.order.cancelledAt || guard.order.closedAt) {
      return res.status(400).json({ error: "Order cannot be edited" });
    }
    const fulfillmentStatus = String(guard.order?.displayFulfillmentStatus || "")
      .trim()
      .toLowerCase();
    if (["fulfilled", "partially_fulfilled", "in_progress"].includes(fulfillmentStatus)) {
      return res.status(400).json({ error: "Order cannot be edited after fulfillment" });
    }

    const beforeTotals = await getCustomerOrderTotals(guard.numericId);
    const paidBefore = Number(beforeTotals.amount_paid || 0) || 0;

    const listOps = Array.isArray(req.body?.ops) ? req.body.ops : [];
    const ops = listOps
      .map((op) => ({
        type: String(op?.type || "").toLowerCase(),
        variantGid: String(op?.variantGid || ""),
        quantity: Number(op?.quantity)
      }))
      .filter((op) => op.type && op.variantGid);

    if (!ops.length) return res.status(400).json({ error: "ops required" });

    const calculatedOrderId = await orderEditBegin(guard.orderGid);
    const calcLines = await getCalculatedLineItems(calculatedOrderId);
    const byVariant = new Map();
    for (const li of calcLines) {
      const vgid = li?.variant?.id || "";
      if (!vgid) continue;
      if (!byVariant.has(vgid)) byVariant.set(vgid, []);
      byVariant.get(vgid).push(li);
    }

    for (const op of ops) {
      if (op.type === "add") {
        if (!Number.isFinite(op.quantity) || op.quantity <= 0) {
          throw new Error("Invalid add quantity");
        }
        await orderEditAddVariant(calculatedOrderId, op.variantGid, op.quantity);
        continue;
      }

      const variantLines = byVariant.get(op.variantGid) || [];
      const activeLine =
        variantLines.find((line) => Number(line?.quantity || 0) > 0) ||
        variantLines[0] ||
        null;
      const activeQuantity = Number(activeLine?.quantity || 0) || 0;
      const calcLineId = String(activeLine?.id || "");
      if (!calcLineId) throw new Error("Invalid line item");

      if (op.type === "remove") {
        if (activeQuantity <= 0) continue;
        await orderEditSetQuantity(calculatedOrderId, calcLineId, 0);
      } else if (op.type === "set_qty") {
        if (!Number.isFinite(op.quantity) || op.quantity < 0) {
          throw new Error("Invalid quantity");
        }
        if (activeQuantity <= 0) {
          if (op.quantity > 0) {
            await orderEditAddVariant(calculatedOrderId, op.variantGid, op.quantity);
          }
          continue;
        }
        await orderEditSetQuantity(calculatedOrderId, calcLineId, op.quantity);
      } else {
        throw new Error(`Unknown op: ${op.type}`);
      }
    }

    await orderEditCommit(
      calculatedOrderId,
      true,
      `Customer order edit from mobile app (${new Date().toISOString()})`
    );

    const totals = await getCustomerOrderTotals(guard.numericId);
    const newTotal = Number(totals.current_total_price || 0) || 0;
    const creditDue = Math.max(0, paidBefore - newTotal);
    let creditTx = null;

    if (creditDue > 0.0005) {
      creditTx = await creditCustomerStoreCredit(
        guard.customer.id,
        creditDue,
        totals.currency || beforeTotals.currency || "OMR"
      );
      try {
        const existingNote = String(guard.order?.note || "").trim();
        const creditNote =
          `Credit added after customer edit: ${creditDue.toFixed(3)} ${totals.currency || "OMR"}`;
        await shopifyGraphQL(
          `#graphql
          mutation AddOrderCreditNote($input: OrderInput!) {
            orderUpdate(input: $input) {
              userErrors { field message }
            }
          }`,
          {
            input: {
              id: guard.orderGid,
              note: [existingNote, creditNote].filter(Boolean).join("\n\n")
            }
          }
        );
      } catch {}
    }

    return res.json({
      ok: true,
      orderId: guard.numericId,
      totals,
      credit_added: Number(creditDue.toFixed(3)),
      credit: creditTx,
      payment_url: totals.payment_url || ""
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post("/api/customer/order/:id/cancel-request", async (req, res) => {
  try {
    const guard = await requireCustomerOrder(req, res, req.params.id);
    if (!guard) return;

    if (guard.order.cancelledAt) {
      return res.status(400).json({ error: "Order is already canceled" });
    }

    const reason = String(req.body?.reason || "").trim();
    const note = String(req.body?.note || "").trim();
    if (!reason) return res.status(400).json({ error: "reason required" });

    const totalsBeforeCancel = await getCustomerOrderTotals(guard.numericId);
    const paidInfo = await getCustomerOrderPaidAmount(guard.numericId, totalsBeforeCancel);
    const paidAmount = Math.max(0, Number(paidInfo.amount || 0) || 0);
    const currencyCode = String(paidInfo.currencyCode || totalsBeforeCancel.currency || "OMR");

    const payload = {
      orderId: guard.numericId,
      orderName: guard.order.name || "",
      customerId: guard.customer.id,
      customerEmail: guard.customer?.emailAddress?.emailAddress || "",
      reason,
      note,
      refundedToWallet: 0,
      currencyCode,
      createdAt: new Date().toISOString()
    };

    const cancelResult = await shopifyRest(`/orders/${guard.numericId}/cancel.json`, {
      method: "POST",
      body: JSON.stringify({
        reason: "customer",
        notify_customer: false,
        restock: false,
        refund: false
      })
    });

    let creditTx = null;
    if (paidAmount > 0.0005) {
      creditTx = await creditCustomerStoreCredit(
        guard.customer.id,
        paidAmount,
        currencyCode
      );
      payload.refundedToWallet = Number(paidAmount.toFixed(3));
    }

    try {
      const existingNote = cleanExistingOrderNoteForCancel(guard.order?.note);
      const cleanReason = cleanCustomerCancelNoteLine(reason) || reason;
      const cancelNote = [
        `\u0633\u0628\u0628 \u0627\u0644\u0625\u0644\u063a\u0627\u0621: ${cleanReason}`,
        payload.refundedToWallet > 0
          ? `\u062a\u0645 \u0625\u0631\u062c\u0627\u0639 ${payload.refundedToWallet.toFixed(3)} ${currencyCode} \u0625\u0644\u0649 \u0627\u0644\u0645\u062d\u0641\u0638\u0629`
          : ""
      ].filter(Boolean).join("\n");
      await shopifyGraphQL(
        `#graphql
        mutation AddCancelRequestData($id: ID!, $tags: [String!]!, $input: OrderInput!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
          orderUpdate(input: $input) {
            userErrors { field message }
          }
        }`,
        {
          id: guard.orderGid,
          tags: ["customer-canceled"],
          input: {
            id: guard.orderGid,
            note: [existingNote, cancelNote].filter(Boolean).join("\n\n")
          }
        }
      );
    } catch (e) {
      console.error("customer cancel order note failed", e?.message || e);
    }

    const redis = typeof getRedis === "function" ? await getRedis().catch(() => null) : null;
    if (redis) {
      await reverseOrderRewards({
        redis,
        orderId: guard.orderGid,
        customerId: guard.customer.id,
        source: "customer_cancel"
      }).catch((e) => {
        console.error("customer cancel rewards reverse failed", e?.message || e);
      });
      await redis.lPush("bt:customer:order-cancel-requests:v1", JSON.stringify(payload));
      await redis.lTrim("bt:customer:order-cancel-requests:v1", 0, 999);
    }

    return res.json({
      ok: true,
      orderId: guard.numericId,
      canceled: true,
      cancelResult,
      wallet_refund: payload.refundedToWallet,
      currencyCode,
      credit: creditTx,
      request: payload
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.get("/api/manage/order-cancel-requests", async (req, res) => {
  try {
    const redis = typeof getRedis === "function" ? await getRedis().catch(() => null) : null;
    if (!redis) return res.json({ ok: true, requests: [] });

    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const rows = await redis.lRange("bt:customer:order-cancel-requests:v1", 0, limit - 1);
    const requests = rows
      .map((row) => safeJsonParse(row))
      .filter(Boolean);

    return res.json({ ok: true, count: requests.length, requests });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

  // =========================
  // 3) APIs
  // =========================

  // ✅ حالة الطلب
  router.get("/api/manage/order/:id/status", async (req, res) => {
    try {
      const orderId = req.params.id;
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

      const orderGid = toGid("Order", orderId);

      const GQL = `
        query O($id: ID!) {
          order(id: $id) {
            id
            name
            cancelledAt
            closedAt
            displayFinancialStatus
            displayFulfillmentStatus
            canMarkAsPaid
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
        }
      `;

      const data = await shopifyGraphQL(GQL, { id: orderGid });
      if (!data?.order) return res.status(404).json({ error: "الطلب غير موجود" });

      return res.json({ ok: true, order: data.order });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

// ✅ جلب الطلبات (REST)
router.get("/api/manage/orders", async (req, res) => {
  try {
    const status = String(req.query.status || "any").trim();
    const q = String(req.query.q || "").trim();
    const needsTracking = String(req.query.needsTracking || "").trim() === "1";

    // بدون بحث: خفيف وسريع
    const normalLimit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));

    // مع البحث: لا نحتاج أرقام كبيرة
const searchPageSize = Math.min(100, Math.max(20, Number(req.query.searchPageSize || 50)));
const maxSearchPages = Math.min(60, Math.max(1, Number(req.query.maxSearchPages || 30)));
    
    function normalizeSearchText(v) {
      return String(v || "")
        .toLowerCase()
        .trim()
        .replace(/[أإآ]/g, "ا")
        .replace(/ة/g, "ه")
        .replace(/ى/g, "ي")
        .replace(/ؤ/g, "و")
        .replace(/ئ/g, "ي")
        .replace(/\+/g, "")
        .replace(/[_\-./,]+/g, " ")
        .replace(/\s+/g, " ");
    }

    function digitsOnly(v) {
      return String(v || "").replace(/\D+/g, "");
    }

    function uniqueStrings(arr = []) {
      return [...new Set(
        arr
          .map(x => String(x || "").trim())
          .filter(Boolean)
      )];
    }

    function collectTrackingValues(o) {
      const fulfillments = Array.isArray(o?.fulfillments) ? o.fulfillments : [];

      return uniqueStrings([
        o?.trackingNumber,
        o?.tracking_number,
        o?.tracking,
        o?.tracking_code,
        o?.trackingCode,
        ...(Array.isArray(o?.trackingNumbers) ? o.trackingNumbers : []),
        ...(Array.isArray(o?.tracking_numbers) ? o.tracking_numbers : []),

        ...fulfillments.flatMap(f => [
          f?.tracking_number,
          f?.trackingNumber,
          f?.tracking,
          f?.tracking_code,
          f?.trackingCode,
          ...(Array.isArray(f?.tracking_numbers) ? f.tracking_numbers : []),
          ...(Array.isArray(f?.trackingNumbers) ? f.trackingNumbers : [])
        ])
      ]);
    }

    function orderMatchesQuery(o, qValue) {
      if (!qValue) return true;

      const rawQuery = String(qValue || "").trim();
      const queryText = normalizeSearchText(rawQuery);
      const queryDigits = digitsOnly(rawQuery);

      const tags = Array.isArray(o?.tags) ? o.tags : [];
      const trackingValues = collectTrackingValues(o);

      const itemValues = Array.isArray(o?.items)
        ? o.items.flatMap(it => [
            it?.title,
            it?.name,
            it?.product_title,
            it?.variant_title,
            it?.sku,
            it?.barcode,
            it?.vendor,
            it?.product_type
          ])
        : [];

      const shippingValues = [
        o?.shipping,
        o?.address1,
        o?.address2,
        o?.city,
        o?.province,
        o?.zip,
        o?.country,
        ...(Array.isArray(o?.shipping_lines)
          ? o.shipping_lines.flatMap(s => [
              s?.title,
              s?.code,
              s?.source,
              s?.carrier_identifier
            ])
          : [])
      ];

      const textFields = [
        o?.id,
        o?.gid,
        o?.name,
        o?.order_number,
        o?.customer,
        o?.phone,
        o?.email,
        o?.note,
        o?.payment_gateway,
        ...(Array.isArray(o?.payment_gateways) ? o.payment_gateways : []),
        ...tags,
        ...trackingValues,
        ...itemValues,
        ...shippingValues
      ]
        .map(x => String(x || "").trim())
        .filter(Boolean);

      const hayText = normalizeSearchText(textFields.join(" "));
      const hayDigits = digitsOnly(textFields.join(" "));

      if (queryText && hayText.includes(queryText)) return true;
      if (queryDigits && hayDigits.includes(queryDigits)) return true;

      return false;
    }

    function mapRestOrder(o = {}) {
      const customerName = o?.customer
        ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ").trim()
        : "";

      const ship = o?.shipping_address
        ? [
            o?.shipping_address?.city,
            o?.shipping_address?.address1,
            o?.shipping_address?.address2,
            o?.shipping_address?.zip,
          ]
            .filter(Boolean)
            .join(" - ")
            .trim()
        : "";

      const tags = String(o?.tags || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const phone = String(
        o?.phone ||
        o?.shipping_address?.phone ||
        o?.billing_address?.phone ||
        o?.customer?.phone ||
        ""
      ).trim();

      const gateways = Array.isArray(o?.payment_gateway_names)
        ? o.payment_gateway_names
        : [];

      const gatewayText = gateways.join(" | ");

      const items = Array.isArray(o?.line_items)
        ? o.line_items.map((it) => ({
            title: it?.title || it?.name || "",
            name: it?.name || it?.title || "",
            product_title: it?.title || "",
            variant_title: it?.variant_title || "",
            variantId: it?.variant_id ? String(it.variant_id) : "",
            product_id: it?.product_id ? String(it.product_id) : "",
            sku: String(it?.sku || "").trim(),
            barcode: String(it?.barcode || "").trim(),
            vendor: String(it?.vendor || "").trim(),
            product_type: String(it?.product_type || "").trim(),
            qty: Number(it?.quantity || 0) || 0,
            price: it?.price ? String(it.price) : "0",
          }))
        : [];

      const city = String(o?.shipping_address?.city || "").trim();
      const address1 = String(o?.shipping_address?.address1 || "").trim();
      const address2 = String(o?.shipping_address?.address2 || "").trim();
      const zip = String(o?.shipping_address?.zip || "").trim();
      const province = String(o?.shipping_address?.province || "").trim();
      const country = String(o?.shipping_address?.country || "").trim();

      const fulfillments = Array.isArray(o?.fulfillments)
        ? o.fulfillments.map((f) => ({
            id: f?.id,
            status: f?.status,
            shipment_status: f?.shipment_status,
            created_at: f?.created_at,
            updated_at: f?.updated_at,
            tracking_company: String(f?.tracking_company || "").trim(),
            tracking_number: String(f?.tracking_number || "").trim(),
            tracking_numbers: uniqueStrings(Array.isArray(f?.tracking_numbers) ? f.tracking_numbers : []),
            tracking_urls: uniqueStrings(Array.isArray(f?.tracking_urls) ? f.tracking_urls : []),
          }))
        : [];

      const trackingNumbers = uniqueStrings(
        fulfillments.flatMap((f) => [
          String(f?.tracking_number || "").trim(),
          ...(Array.isArray(f?.tracking_numbers) ? f.tracking_numbers : []),
        ])
      );

      const shippingLines = Array.isArray(o?.shipping_lines)
        ? o.shipping_lines.map((s) => ({
            title: String(s?.title || "").trim(),
            code: String(s?.code || "").trim(),
            source: String(s?.source || "").trim(),
            carrier_identifier: String(s?.carrier_identifier || "").trim(),
          }))
        : [];

      return {
        id: String(o?.id || ""),
        gid: toGid("Order", o?.id),
        name: o?.name || "",
        order_number: o?.order_number || "",

        customer: customerName,
        customerId: o?.customer?.id ? toGid("Customer", o.customer.id) : "",
        phone,
        email: String(o?.email || o?.customer?.email || "").trim(),
        note: String(o?.note || "").trim(),
        currency: String(o?.currency || "OMR").trim() || "OMR",

        shipping: ship,
        city,
        address1,
        address2,
        zip,
        province,
        country,

        tags,
        items,
        line_items: items,
        lines: items,

        payment_gateways: gateways,
        payment_gateway: gatewayText,

        shipping_lines: shippingLines,

        createdAt: o?.created_at || "",

        cancelled_at: o?.cancelled_at || null,
        closed_at: o?.closed_at || null,
        fulfillment_status: o?.fulfillment_status || null,
        financial_status: o?.financial_status || null,

        fulfillments,
        trackingNumber: trackingNumbers.join(" "),
        trackingNumbers,
      };
    }

function mapGraphOrder(node = {}) {
  const shipping = node?.shippingAddress || {};
  const customer = node?.customer || {};

  const tags = Array.isArray(node?.tags) ? node.tags : [];

  const phone = String(
    shipping?.phone ||
    customer?.phone ||
    ""
  ).trim();

  const items = Array.isArray(node?.lineItems?.nodes)
    ? node.lineItems.nodes.map((it) => ({
        title: it?.title || "",
        name: it?.title || "",
        product_title: it?.title || "",
        variant_title: it?.variantTitle || "",
        variantId: "",
        product_id: "",
        sku: String(it?.variant?.sku || "").trim(),
        barcode: String(it?.variant?.barcode || "").trim(),
        vendor: String(it?.variant?.product?.vendor || "").trim(),
        product_type: String(it?.variant?.product?.productType || "").trim(),
        qty: Number(it?.quantity || 0) || 0,
        price: String(it?.originalUnitPriceSet?.shopMoney?.amount || "0"),
      }))
    : [];

  const fulfillments = Array.isArray(node?.fulfillments)
    ? node.fulfillments.map((f) => {
        const trackingInfo = Array.isArray(f?.trackingInfo) ? f.trackingInfo : [];
        const trackingNumbers = [...new Set(
          trackingInfo.map((t) => String(t?.number || "").trim()).filter(Boolean)
        )];
        const trackingUrls = [...new Set(
          trackingInfo.map((t) => String(t?.url || "").trim()).filter(Boolean)
        )];

        return {
          id: f?.id || "",
          status: f?.status || "",
          shipment_status: f?.shipmentStatus || "",
          created_at: f?.createdAt || "",
          updated_at: f?.updatedAt || "",
          tracking_company: String(trackingInfo[0]?.company || "").trim(),
          tracking_number: trackingNumbers[0] || "",
          tracking_numbers: trackingNumbers,
          tracking_urls: trackingUrls,
        };
      })
    : [];

  const trackingNumbers = [...new Set(
    fulfillments.flatMap((f) => [
      String(f?.tracking_number || "").trim(),
      ...(Array.isArray(f?.tracking_numbers) ? f.tracking_numbers : []),
    ]).filter(Boolean)
  )];

  const shippingLines = Array.isArray(node?.shippingLines?.nodes)
    ? node.shippingLines.nodes.map((s) => ({
        title: String(s?.title || "").trim(),
        code: String(s?.code || "").trim(),
        source: "",
        carrier_identifier: "",
      }))
    : [];

  return {
    id: String(node?.id || "").split("/").pop(),
    gid: node?.id || "",
    name: node?.name || "",
    order_number: node?.legacyResourceId ? String(node.legacyResourceId) : "",

    customer: [
      shipping?.name,
      [customer?.firstName, customer?.lastName].filter(Boolean).join(" "),
      [shipping?.firstName, shipping?.lastName].filter(Boolean).join(" "),
    ].find(Boolean) || "",

    customerId: customer?.id || "",
    phone,
    email: String(node?.email || customer?.email || "").trim(),
    note: String(node?.note || "").trim(),

    shipping: [shipping?.city, shipping?.address1, shipping?.address2, shipping?.zip]
      .filter(Boolean)
      .join(" - "),
    city: String(shipping?.city || "").trim(),
    address1: String(shipping?.address1 || "").trim(),
    address2: String(shipping?.address2 || "").trim(),
    zip: String(shipping?.zip || "").trim(),
    province: String(shipping?.province || "").trim(),
    country: String(shipping?.country || "").trim(),
    country_code: String(shipping?.countryCodeV2 || "").trim(),

    tags,
    items,
    line_items: items,
    lines: items,

    payment_gateways: [],
    payment_gateway: "",

    shipping_lines: shippingLines,

    createdAt: node?.createdAt || "",

    cancelled_at: node?.cancelledAt || null,
    closed_at: null,
    fulfillment_status: node?.displayFulfillmentStatus || null,
    financial_status: node?.displayFinancialStatus || null,

    fulfillments,
    trackingNumber: trackingNumbers.join(" "),
    trackingNumbers,
  };
}

async function searchOrdersGraphQL(queryString, first = 10) {
  const data = await shopifyGraphQL(
    `
    query SearchManageOrders($first: Int!, $query: String!) {
      orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          legacyResourceId
          name
          email
          createdAt
          cancelledAt
          note
          tags
          displayFinancialStatus
          displayFulfillmentStatus

          customer {
            id
            firstName
            lastName
            phone
            email
          }

          shippingAddress {
            name
            firstName
            lastName
            phone
            address1
            address2
            city
            province
            zip
            country
            countryCodeV2
          }

          lineItems(first: 20) {
            nodes {
              title
              quantity
              variantTitle
              originalUnitPriceSet {
                shopMoney {
                  amount
                }
              }
              variant {
                sku
                barcode
                product {
                  vendor
                  productType
                }
              }
            }
          }

          shippingLines(first: 20) {
            nodes {
              title
              code
            }
          }

          fulfillments {
            id
            status
            createdAt
            updatedAt
            trackingInfo {
              company
              number
              url
            }
          }
        }
      }
    }
    `,
    { first, query: queryString }
  );

  const nodes = Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [];
  return nodes.map(mapGraphOrder);
}

async function searchNeedsTrackingOrdersGraphQL(first = 100) {
  const data = await shopifyGraphQL(
    `
    query SearchNeedsTrackingOrders($first: Int!, $query: String!) {
      orders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          legacyResourceId
          name
          email
          createdAt
          cancelledAt
          note
          tags
          displayFinancialStatus
          displayFulfillmentStatus

          customer {
            id
            firstName
            lastName
            phone
            email
          }

          shippingAddress {
            name
            firstName
            lastName
            phone
            address1
            address2
            city
            province
            zip
            country
            countryCodeV2
          }

          fulfillments {
            id
            status
            createdAt
            updatedAt
            trackingInfo {
              company
              number
              url
            }
          }
        }
      }
    }
    `,
    { first, query: "tag:\u0645\u063a\u0644\u0641 status:open" }
  );

  const nodes = Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [];
  return nodes.map(mapGraphOrder);
}

    
    async function searchOlderOrdersByRestFallback(queryValue) {
      const fields = [
        "id",
        "name",
        "order_number",
        "created_at",
        "tags",
        "phone",
        "email",
        "note",
        "cancelled_at",
        "closed_at",
        "fulfillment_status",
        "financial_status",
        "currency",
        "fulfillments",
        "payment_gateway_names",
        "shipping_lines",
        "customer",
        "shipping_address",
        "billing_address",
        "line_items"
      ].join(",");

      let results = [];
      let pageInfo = null;
      let pages = 0;

      while (pages < maxSearchPages) {
        let url =
          `/orders.json?status=any&limit=${searchPageSize}&order=created_at%20desc&fields=${encodeURIComponent(fields)}`;

        if (pageInfo?.page_info) {
          url += `&page_info=${encodeURIComponent(pageInfo.page_info)}`;
        }

        const r = await fetch(`https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}${url}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN,
          },
        });

        const text = await r.text();
        const json = safeJsonParse(text);

        if (!r.ok) {
          const msg =
            pickErrMessage(json?.errors) ||
            pickErrMessage(json?.error) ||
            text ||
            "Shopify REST error";
          throw new Error(msg);
        }

        const orders = Array.isArray(json?.orders) ? json.orders : [];
        const mapped = orders.map(mapRestOrder);
        const matched = mapped.filter(o => orderMatchesQuery(o, queryValue));

        if (matched.length) {
          results = matched;
          break;
        }

        const link = r.headers.get("link") || "";
        const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/i);

        if (!nextMatch) break;

        try {
          const nextUrl = new URL(nextMatch[1]);
          const nextPageInfo = nextUrl.searchParams.get("page_info");
          if (!nextPageInfo) break;
          pageInfo = { page_info: nextPageInfo };
        } catch {
          break;
        }

        pages += 1;
      }

      return results;
    }

    // الوضع العادي: سريع جدًا
    if (!q && needsTracking) {
      const rows = await searchNeedsTrackingOrdersGraphQL(normalLimit);
      return res.json({ ok: true, orders: rows, count: rows.length });
    }

    if (!q) {
      const fields = [
        "id",
        "name",
        "order_number",
        "created_at",
        "tags",
        "phone",
        "email",
        "note",
        "cancelled_at",
        "closed_at",
        "fulfillment_status",
        "financial_status",
        "currency",
        "fulfillments",
        "payment_gateway_names",
        "shipping_lines",
        "customer",
        "shipping_address",
        "billing_address",
        "line_items"
      ].join(",");

      const out = await shopifyRest(
        `/orders.json?status=${encodeURIComponent(status)}&limit=${normalLimit}&order=created_at%20desc&fields=${encodeURIComponent(fields)}`,
        { method: "GET" }
      );

      const orders = Array.isArray(out?.orders) ? out.orders : [];
      const mapped = orders.map(mapRestOrder);

      return res.json({ ok: true, orders: mapped, count: mapped.length });
    }

    // 1) ابحث مباشرة في Shopify أولًا
    let directResults = [];

    const searchCandidates = uniqueStrings([
      q,
      `name:${q}`,
      `email:${q}`,
      `phone:${q}`,
    ]);

    for (const candidate of searchCandidates) {
      const found = await searchOrdersGraphQL(candidate, Math.min(searchPageSize, 15));
      const matched = found.filter(o => orderMatchesQuery(o, q));

      if (matched.length) {
        directResults = matched;
        break;
      }
    }

    if (directResults.length) {
      return res.json({
        ok: true,
        orders: directResults,
        count: directResults.length
      });
    }

    // 2) fallback ذكي للطلبات القديمة أو رقم التتبع غير المفهرس
    const fallbackResults = await searchOlderOrdersByRestFallback(q);

    return res.json({
      ok: true,
      orders: fallbackResults,
      count: fallbackResults.length
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

  // ✅ lineItems عبر GraphQL (صورة + عنوان بدون تكرار)
router.get("/api/manage/order/:id/lines", async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const orderGid = toGid("Order", orderId);

    const GQL = `
      query OrderLines($id: ID!) {
        order(id: $id) {
          id
          name
lineItems(first: 250) {
  edges {
    node {
      id
      title
      quantity
      currentQuantity
      variant {
      id
                  title
                  sku
                  barcode
                  price
                  image { url }
                  product {
                    title
                    handle
                    featuredImage { url }
                  }
                }
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(GQL, { id: orderGid });
    const order = data?.order;
    if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

    const restOrder = await shopifyRest(
      `/orders/${toNumericId(orderId)}.json?fields=id,tags`,
      { method: "GET" }
    );

    const tagsRaw = String(restOrder?.order?.tags || "");
    const orderTags = tagsRaw
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean);

    const isArabic = orderTags.includes("ar");

    const lineSeeds = (order?.lineItems?.edges || []).map((e) => {
      const n = e?.node || {};
      const v = n?.variant || {};
      const p = v?.product || {};

      return {
        n,
        v,
        p,
        handle: String(p?.handle || "").trim(),
      };
    });

    let englishTitlesByHandle = {};
    if (!isArabic) {
      try {
        englishTitlesByHandle = await getEnglishProductTitlesByHandles(
          lineSeeds.map((x) => x.handle)
        );
      } catch (err) {
        console.error("storefront english titles failed:", err);
        englishTitlesByHandle = {};
      }
    }

const items = lineSeeds
  .map(({ n, v, p, handle }) => {
    const price =
      n?.originalUnitPriceSet?.shopMoney?.amount ??
      v?.price ??
      "0";

    const variantGid = v?.id || "";
    const variantId = variantGid ? toNumericId(variantGid) : "";

    const storefrontEnglishTitle = !isArabic
      ? String(englishTitlesByHandle[handle] || "").trim()
      : "";

    const adminArabicTitle = String(p?.title || "").trim();
    const lineTitle = String(n?.title || "").trim();

    const productTitle = isArabic
      ? adminArabicTitle
      : storefrontEnglishTitle;

    const variantTitle = String(v?.title || "").trim();
    const normalizedVariantTitle = variantTitle.toLowerCase().trim();
    const normalizedBaseTitle = String(productTitle || "").toLowerCase().trim();

    let title = productTitle || lineTitle || "Product";

    if (
      variantTitle &&
      normalizedVariantTitle !== "default title" &&
      normalizedVariantTitle !== normalizedBaseTitle &&
      !normalizedBaseTitle.includes(normalizedVariantTitle)
    ) {
      title = `${title} — ${variantTitle}`;
    }

    const qty = Number(n?.currentQuantity ?? n?.quantity ?? 0) || 0;

    const imageUrl =
      v?.image?.url ||
      p?.featuredImage?.url ||
      "";

    return {
      lineItemGid: String(n?.id || ""),
      title,
      qty,
      variantGid: String(variantGid || ""),
      variantId: String(variantId || ""),
      sku: String(v?.sku || ""),
      barcode: String(v?.barcode || ""),
      price: String(price || "0"),
      imageUrl: String(imageUrl || ""),
    };
  })
  .filter((it) =>
    it.qty > 0 &&
    String(it.title || "").trim().toLowerCase() !== "removed" &&
    String(it.title || "").trim().toLowerCase() !== "deleted"
  );

    
    return res.json({ ok: true, orderId: String(orderId), orderGid, items });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

  
  // ✅ بحث Variants (مصحح)
router.get("/api/manage/products/search", async (req, res) => {
  try {
    const qRaw = String(req.query.q || "").trim();
    if (!qRaw || qRaw.length < 2) return res.json({ ok: true, items: [] });

    const limit = Math.min(25, Math.max(1, Number(req.query.limit || 12)));
    const safe = qRaw.replace(/"/g, '\\"');

    // 1) "safe" لوحدها = بحث افتراضي (يشمل الوصف/حقول أخرى حسب فهرسة Shopify)
    // 2) وزدنا حقول سهلة ومباشرة: title/vendor/tag
    const searchQuery = `(${safe}) OR title:${safe}* OR vendor:${safe}* OR tag:${safe}*`;

    const GQL = `
      query SearchProducts($first:Int!, $query:String!) {
        products(first:$first, query:$query) {
          edges {
            node {
              id
              title
              vendor
              tags
              featuredImage { url }
              variants(first: 10) {
                edges {
                  node {
                    id
                    title
                    sku
                    barcode
                    price
                    image { url }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(GQL, { first: limit, query: searchQuery });
    const products = data?.products?.edges?.map(e => e.node) || [];

    // رجّع النتائج كـ variants (عشان واجهتك مبنية على variantId)
    const items = [];
    for (const p of products) {
      const vEdges = p?.variants?.edges || [];
      for (const ve of vEdges) {
        const v = ve.node;
        const variantGid = v.id;
        const numericVariantId = String(variantGid).split("/").pop();

        const productTitle = p?.title || "";
        const variantTitle = v?.title || "";
        const title =
          variantTitle && variantTitle !== "Default Title"
            ? `${productTitle} - ${variantTitle}`
            : productTitle;

        const imageUrl = v?.image?.url || p?.featuredImage?.url || "";

        items.push({
          variantId: numericVariantId,
          variantGid,
          title,
          sku: v?.sku || "",
          barcode: v?.barcode || "",
          price: String(v?.price || "0"),
          vendor: p?.vendor || "",
          tags: Array.isArray(p?.tags) ? p.tags : [],
          imageUrl
        });
      }
    }

    return res.json({ ok: true, items: items.slice(0, limit * 3) }); // اختياري
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
// ✅ إجمالي الطلب الحقيقي (بعد الخصم + بعد أي تعديل/حذف) + outstanding الصحيح
router.get("/api/manage/order/:id/totals", async (req, res) => {
  try {
    const orderId = req.params.id;
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const numericId = toNumericId(orderId);
    const orderGid = toGid("Order", numericId);

    // 1) REST totals (سريع)
    const out = await shopifyRest(
      `/orders/${numericId}.json?fields=` +
        [
          "id",
          "total_price",
          "current_total_price",
          "subtotal_price",
          "current_subtotal_price",
          "total_discounts",
          "total_tax",
          "total_shipping_price_set",
          "currency",
          "discount_codes",
          "discount_applications",
          "financial_status",
          "cancelled_at",
          "closed_at",
          // بعض المتاجر ترجعها وبعضها لا.. نطلبها على كل حال
          "total_outstanding",
        ].join(","),
      { method: "GET" }
    );

    const o = out?.order;
    if (!o) return res.status(404).json({ error: "الطلب غير موجود" });

    const codes = Array.isArray(o?.discount_codes) ? o.discount_codes : [];
    const discount_code = String(codes?.[0]?.code || "").trim();

    const currentTotal = Number(o.current_total_price || 0) || 0;
    const shipping = Number(o?.total_shipping_price_set?.shop_money?.amount || 0) || 0;

    // 2) GraphQL outstanding (الأدق)
    let gqlOutstanding = null;
    let gqlCurrency = "";
    let gqlCurrentTotal = null;

    try {
      const GQL = `
        query O($id: ID!) {
          order(id: $id) {
            totalOutstandingSet { shopMoney { amount currencyCode } }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      `;
      const data = await shopifyGraphQL(GQL, { id: orderGid });

      const go = data?.order;
      gqlOutstanding = Number(go?.totalOutstandingSet?.shopMoney?.amount || 0);
      gqlCurrency = String(go?.totalOutstandingSet?.shopMoney?.currencyCode || "");
      gqlCurrentTotal = Number(go?.currentTotalPriceSet?.shopMoney?.amount || 0);
    } catch {
      // تجاهل لو فشل
    }

    // 3) احسب outstanding بذكاء مع fallback
    let totalOutstanding = Number(o.total_outstanding || 0) || 0;

    // لو GraphQL رجع رقم اعتمد عليه
    if (Number.isFinite(gqlOutstanding)) totalOutstanding = gqlOutstanding;

    // لو REST/GraphQL رجع 0 بالغلط والطلب فعلياً غير مدفوع: اعتبر المتبقي = الإجمالي
    // (هذا يحل مشكلتك: "غير مدفوع" ولكن outstanding=0)
    const bestTotal = Number.isFinite(gqlCurrentTotal) && gqlCurrentTotal > 0 ? gqlCurrentTotal : currentTotal;

    if (totalOutstanding <= 0 && bestTotal > 0) {
      totalOutstanding = bestTotal;
    }

    const amountPaid = Math.max(0, bestTotal - totalOutstanding);

    return res.json({
      ok: true,
      id: String(o.id),
      currency: (gqlCurrency || o.currency || ""),
      discount_code,

      current_total_price: Number(bestTotal.toFixed(3)),
      current_subtotal_price: Number((Number(o.current_subtotal_price || 0) || 0).toFixed(3)),
      subtotal_price: Number((Number(o.subtotal_price || 0) || 0).toFixed(3)),
      total_price: Number((Number(o.total_price || 0) || 0).toFixed(3)),
      total_discounts: Number((Number(o.total_discounts || 0) || 0).toFixed(3)),
      total_tax: Number((Number(o.total_tax || 0) || 0).toFixed(3)),
      shipping: Number(shipping.toFixed(3)),

      // ✅ الأهم
      total_outstanding: Number(totalOutstanding.toFixed(3)),
      amount_paid: Number(amountPaid.toFixed(3)),

      // للتشخيص
      financial_status: o.financial_status || null,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


// ✅ دفع جزئي: يسجل Transaction على الطلب (REST)
// POST /api/manage/paid_partial { orderId, amount }
router.post("/api/manage/paid_partial", async (req, res) => {
  try {
    const { orderId, amount } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const numericId = toNumericId(orderId);
    const orderGid = toGid("Order", numericId);

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount غير صالح" });
    }

    // 1) اقرأ الطلب REST (للتأكد من الإلغاء/الإغلاق + total)
    const od = await shopifyRest(
      `/orders/${numericId}.json?fields=id,currency,current_total_price,cancelled_at,closed_at`,
      { method: "GET" }
    );

    const o = od?.order;
    if (!o) return res.status(404).json({ error: "الطلب غير موجود" });
    if (o.cancelled_at) return res.status(400).json({ error: "الطلب ملغي" });
    if (o.closed_at) return res.status(400).json({ error: "الطلب مغلق" });

    const restTotal = Number(o.current_total_price || 0) || 0;
    let currency = String(o.currency || "OMR");

    // 2) outstanding الحقيقي من GraphQL (أدق)
    let outstanding = 0;
    let gqlTotal = null;

    try {
      const GQL = `
        query O($id: ID!) {
          order(id: $id) {
            totalOutstandingSet { shopMoney { amount currencyCode } }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      `;
      const data = await shopifyGraphQL(GQL, { id: orderGid });
      const go = data?.order;

      outstanding = Number(go?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
      currency = String(go?.totalOutstandingSet?.shopMoney?.currencyCode || currency);
      gqlTotal = Number(go?.currentTotalPriceSet?.shopMoney?.amount || 0) || null;
    } catch {
      outstanding = 0;
    }

    const bestTotal = (Number.isFinite(gqlTotal) && gqlTotal > 0) ? gqlTotal : restTotal;

    // fallback: لو outstanding طلع 0 والطلب غير مدفوع فعلاً، اعتبره = الإجمالي
    if (outstanding <= 0 && bestTotal > 0) outstanding = bestTotal;

    if (outstanding <= 0) {
      return res.status(400).json({ error: "لا يوجد مبلغ مستحق (قد يكون مدفوع بالكامل)" });
    }

    if (amt > outstanding + 0.0005) {
      return res.status(400).json({ error: `المبلغ أكبر من المتبقي (${outstanding.toFixed(3)})` });
    }

    // 3) سجّل transaction: جرّب sale ثم fallback إلى capture عند وجود authorization
    let tx = null;

    async function createTx(payload) {
      return await shopifyRest(`/orders/${numericId}/transactions.json`, {
        method: "POST",
        body: JSON.stringify({ transaction: payload }),
      });
    }

    // 3-A: جرّب Sale يدوي
    try {
      tx = await createTx({
        kind: "sale",
        source: "external", // ✅ مهم لتسجيل دفع يدوي
        gateway: "manual",
        status: "success",
        amount: String(amt.toFixed(3)),
        currency: String(currency || "OMR"),
      });
    } catch (e) {
      const msg = String(e?.message || e);

      // 3-B: لو sale مرفوض -> حاول Capture لو فيه Authorization
      if (msg.includes("sale is not a valid transaction")) {
        const list = await shopifyRest(`/orders/${numericId}/transactions.json`, { method: "GET" });
        const txs = Array.isArray(list?.transactions) ? list.transactions : [];
        const authTx = txs.find(t => String(t?.kind || "").toLowerCase() === "authorization");

        if (!authTx?.id) {
          throw new Error(`Shopify رفض kind=sale ولا يوجد authorization لعمل capture. التفاصيل: ${msg}`);
        }

        tx = await createTx({
          kind: "capture",
          parent_id: Number(authTx.id), // ✅ لازم
          source: "external",
          gateway: "manual",
          status: "success",
          amount: String(amt.toFixed(3)),
          currency: String(currency || "OMR"),
        });
      } else {
        throw e;
      }
    }

    // 4) رجّع totals بعد الدفع (REST + GraphQL مرة ثانية)
    const od2 = await shopifyRest(
      `/orders/${numericId}.json?fields=id,currency,current_total_price`,
      { method: "GET" }
    );

    const o2 = od2?.order || {};
    const restTotal2 = Number(o2.current_total_price || 0) || 0;

    let outstanding2 = 0;
    let currency2 = String(o2.currency || currency || "OMR");
    let gqlTotal2 = null;

    try {
      const GQL2 = `
        query O($id: ID!) {
          order(id: $id) {
            totalOutstandingSet { shopMoney { amount currencyCode } }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      `;
      const data2 = await shopifyGraphQL(GQL2, { id: orderGid });
      const go2 = data2?.order;

      outstanding2 = Number(go2?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
      currency2 = String(go2?.totalOutstandingSet?.shopMoney?.currencyCode || currency2);
      gqlTotal2 = Number(go2?.currentTotalPriceSet?.shopMoney?.amount || 0) || null;
    } catch {}

    const bestTotal2 = (Number.isFinite(gqlTotal2) && gqlTotal2 > 0) ? gqlTotal2 : restTotal2;
    if (outstanding2 <= 0 && bestTotal2 > 0) outstanding2 = bestTotal2;

    const amountPaid2 = Math.max(0, bestTotal2 - outstanding2);

    return res.json({
      ok: true,
      orderId: String(numericId),
      transaction: tx?.transaction || tx,
      totals: {
        currency: currency2,
        current_total_price: Number(bestTotal2.toFixed(3)),
        total_outstanding: Number(outstanding2.toFixed(3)),
        amount_paid: Number(amountPaid2.toFixed(3)),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
  // ✅ مدفوع
  router.post("/api/manage/paid", async (req, res) => {
    try {
      const { orderId } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

      const orderGid = toGid("Order", orderId);

      const checkGQL = `
        query Check($id: ID!) {
          order(id: $id) {
            id
            cancelledAt
            closedAt
            canMarkAsPaid
            totalOutstandingSet { shopMoney { amount currencyCode } }
          }
        }
      `;
      const chk = await shopifyGraphQL(checkGQL, { id: orderGid });
      const o = chk?.order;
      if (!o) return res.status(404).json({ error: "الطلب غير موجود" });

      if (o.cancelledAt) return res.status(400).json({ error: "الطلب ملغي ❌" });
      if (o.closedAt) return res.status(400).json({ error: "الطلب مغلق ❌" });
      if (o.canMarkAsPaid === false) return res.status(400).json({ error: "Shopify يمنع وضع الطلب مدفوع" });

      const outstanding = Number(o?.totalOutstandingSet?.shopMoney?.amount || 0);
      if (outstanding <= 0) return res.status(400).json({ error: "لا يوجد مبلغ مستحق (قد يكون مدفوع بالفعل)" });

      const GQL = `
        mutation MarkPaid($input: OrderMarkAsPaidInput!) {
          orderMarkAsPaid(input: $input) {
            userErrors { field message }
            order {
              id
              name
              canMarkAsPaid
              displayFinancialStatus
              totalOutstandingSet { shopMoney { amount currencyCode } }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(GQL, { input: { id: orderGid } });
      const ue = data?.orderMarkAsPaid?.userErrors?.[0];
      if (ue) return res.status(400).json({ error: ue.message, field: ue.field });

      return res.json({ ok: true, order: data?.orderMarkAsPaid?.order || null });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ✅ كنسل (REST)
  router.post("/api/manage/cancel", async (req, res) => {
    try {
      const { orderId, reason = "customer" } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

      const numericId = toNumericId(orderId);

      const out = await shopifyRest(`/orders/${numericId}/cancel.json`, {
        method: "POST",
        body: JSON.stringify({ reason, notify_customer: false, restock: false }),
      });

      const redis = typeof getRedis === "function" ? await getRedis().catch(() => null) : null;
      if (redis) {
        await reverseOrderRewards({
          redis,
          orderId: numericId,
          source: "manage_cancel"
        }).catch((e) => {
          console.error("manage cancel rewards reverse failed", e?.message || e);
        });
      }

      return res.json({ ok: true, orderId: numericId, result: out });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });



  
  // ✅ تحديث بيانات الطلب
  router.post("/api/manage/order/update", async (req, res) => {
    try {
      const { orderId, firstName, lastName, phone, city, address1, note } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

      const numericId = toNumericId(orderId);

const od = await shopifyRest(
  `/orders/${numericId}.json?fields=id,email,customer,shipping_address,billing_address,line_items,tags,note`,
  { method: "GET" }
);
      const order = od?.order;
      if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

      const fn = String(firstName || "").trim();
      const ln = String(lastName || "").trim();
      const fullName = [fn, ln].filter(Boolean).join(" ").trim();

      const ph = String(phone || "").trim();
      const c = String(city || "").trim();
      const a1 = String(address1 || "").trim();

      const oldShip = order.shipping_address || {};
      const oldBill = order.billing_address || {};

      const newShip = {
        ...oldShip,
        first_name: fn || oldShip.first_name || "",
        last_name: ln || oldShip.last_name || "",
        name: fullName || oldShip.name || "",
        phone: ph || oldShip.phone || "",
        city: c || oldShip.city || "",
        address1: a1 || oldShip.address1 || "",
      };

      const newBill = {
        ...oldBill,
        first_name: fn || oldBill.first_name || "",
        last_name: ln || oldBill.last_name || "",
        name: fullName || oldBill.name || "",
        phone: ph || oldBill.phone || "",
        city: c || oldBill.city || "",
        address1: a1 || oldBill.address1 || "",
      };

      const orderPatch = {
        id: Number(numericId),
        phone: ph || order.phone || "",
        shipping_address: newShip,
        billing_address: newBill,
      };

      const n = String(note || "").trim();
      if (n) orderPatch.note = n;

      const out = await shopifyRest(`/orders/${numericId}.json`, {
        method: "PUT",
        body: JSON.stringify({ order: orderPatch }),
      });

      return res.json({ ok: true, orderId: numericId, shopify: out?.order || out });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // ✅ Tags add/remove (مثل ملفك)
  router.post("/api/manage/order/tag/add", async (req, res) => {
    try {
      const { orderId, tag } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });
      const t = String(tag || "").trim();
      if (!t) return res.status(400).json({ error: "tag مطلوب" });

      const numericId = toNumericId(orderId);

      const od = await shopifyRest(`/orders/${numericId}.json`, { method: "GET" });
      const order = od?.order;
      if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

      const tags = String(order.tags || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      if (!tags.includes(t)) tags.push(t);

      const out = await shopifyRest(`/orders/${numericId}.json`, {
        method: "PUT",
        body: JSON.stringify({ order: { id: Number(numericId), tags: tags.join(", ") } }),
      });

      return res.json({ ok: true, orderId: numericId, tags, shopify: out?.order || out });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.post("/api/manage/order/tag/remove", async (req, res) => {
    try {
      const { orderId, tag } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });
      const t = String(tag || "").trim();
      if (!t) return res.status(400).json({ error: "tag مطلوب" });

      const numericId = toNumericId(orderId);

      const od = await shopifyRest(`/orders/${numericId}.json`, { method: "GET" });
      const order = od?.order;
      if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

      const tags = String(order.tags || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((x) => x !== t);

      const out = await shopifyRest(`/orders/${numericId}.json`, {
        method: "PUT",
        body: JSON.stringify({ order: { id: Number(numericId), tags: tags.join(", ") } }),
      });

      return res.json({ ok: true, orderId: numericId, tags, shopify: out?.order || out });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.post("/api/manage/fulfillment/tracking", async (req, res) => {
    try {
      const { orderId, trackingNumber, carrier, notifyCustomer = true } = req.body || {};
      if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

      const tn = String(trackingNumber || "").trim();
      if (!tn) return res.status(400).json({ error: "رقم التتبع مطلوب" });

      const carrierKey = String(carrier || "dhl").trim().toLowerCase();
      const carrierName = carrierKey === "aramex" ? "Aramex" : "DHL";
      const trackingUrl = carrierKey === "aramex"
        ? `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(tn)}`
        : `https://www.dhl.com/tracking?tracking-ID=${encodeURIComponent(tn)}&tracking-id=${encodeURIComponent(tn)}`;

      const orderGid = String(orderId).startsWith("gid://")
        ? String(orderId)
        : toGid("Order", toNumericId(orderId));

      const norm = (s) => String(s || "").toUpperCase().trim();
      const hasRemaining = (fo) =>
        (fo.lineItems?.nodes || []).some((li) => Number(li.remainingQuantity || 0) > 0);

      const Q_ORDER_FOS = `
        query ($id: ID!) {
          order(id: $id) {
            id
            name
            fulfillmentOrders(first: 50) {
              nodes {
                id
                status
                requestStatus
                assignedLocation { name }
                lineItems(first: 250) {
                  nodes { id remainingQuantity totalQuantity }
                }
              }
            }
          }
        }
      `;

      const M_OPEN_FO = `
        mutation ($id: ID!) {
          fulfillmentOrderOpen(id: $id) {
            fulfillmentOrder { id status }
            userErrors { field message }
          }
        }
      `;

      const M_CREATE_FULFILLMENT = `
        mutation ($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment {
              id
              status
              trackingInfo { number company url }
            }
            userErrors { field message }
          }
        }
      `;

      const data = await shopifyGraphQL(Q_ORDER_FOS, { id: orderGid });
      const order = data?.order;
      if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

      let fosAll = order.fulfillmentOrders?.nodes || [];
      let openFos = fosAll.filter((fo) => norm(fo.status) === "OPEN" && hasRemaining(fo));
      const scheduledFos = fosAll.filter((fo) => norm(fo.status) === "SCHEDULED" && hasRemaining(fo));

      if (!openFos.length && scheduledFos.length) {
        for (const fo of scheduledFos) {
          const opened = await shopifyGraphQL(M_OPEN_FO, { id: fo.id });
          const err = opened?.fulfillmentOrderOpen?.userErrors?.[0];
          if (err) return res.status(400).json({ error: err.message, field: err.field });
        }

        const afterOpen = await shopifyGraphQL(Q_ORDER_FOS, { id: orderGid });
        fosAll = afterOpen?.order?.fulfillmentOrders?.nodes || [];
        openFos = fosAll.filter((fo) => norm(fo.status) === "OPEN" && hasRemaining(fo));
      }

      if (!openFos.length) {
        return res.status(400).json({ error: "لا توجد شحنة مفتوحة قابلة للإرسال لهذا الطلب" });
      }

      const created = await shopifyGraphQL(M_CREATE_FULFILLMENT, {
        fulfillment: {
          lineItemsByFulfillmentOrder: openFos.map((x) => ({ fulfillmentOrderId: x.id })),
          notifyCustomer: !!notifyCustomer,
          trackingInfo: {
            number: tn,
            company: carrierName,
            url: trackingUrl
          }
        }
      });

      const createErr = created?.fulfillmentCreate?.userErrors?.[0];
      if (createErr) return res.status(400).json({ error: createErr.message, field: createErr.field });

      return res.json({
        ok: true,
        orderName: order.name,
        fulfillment: created?.fulfillmentCreate?.fulfillment || null
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });
// =========================
// ✅ Duplicate -> DraftOrder (NOT complete yet)
// =========================
router.post("/api/manage/order/duplicate_draft", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const numericId = toNumericId(orderId);
    const orderGid = toGid("Order", numericId);

    // 1) اقرأ بيانات الطلب الأساسية من REST
    const od = await shopifyRest(
      `/orders/${numericId}.json?fields=id,email,customer,shipping_address,billing_address,tags,note`,
      { method: "GET" }
    );

    const o = od?.order;
    if (!o) return res.status(404).json({ error: "الطلب غير موجود" });

    // 2) اقرأ المنتجات الصحيحة من GraphQL (الأهم)
    const gql = await shopifyGraphQL(
      `
      query OrderLines($id: ID!) {
        order(id: $id) {
          id
          lineItems(first: 250) {
            edges {
              node {
                id
                title
                quantity
                currentQuantity
                variant {
                  id
                }
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }
      `,
      { id: orderGid }
    );

    const edges = gql?.order?.lineItems?.edges || [];

    const draftLineItems = edges
      .map(({ node }) => {
        const qty = Number(node?.currentQuantity ?? node?.quantity ?? 0) || 0;
        const title = String(node?.title || "").trim();
        const low = title.toLowerCase();

        // ✅ تجاهل المحذوف أو الكمية صفر
        if (qty <= 0) return null;
        if (!title) return null;
        if (low === "removed" || low === "deleted" || low === "remove" || low === "delete") return null;

        const variantGid = String(node?.variant?.id || "").trim();
        const variantId = variantGid ? Number(toNumericId(variantGid)) : null;

        if (variantId) {
          return {
            variant_id: variantId,
            quantity: qty
          };
        }

        return {
          title,
          price: String(node?.originalUnitPriceSet?.shopMoney?.amount || "0").trim(),
          quantity: qty
        };
      })
      .filter(Boolean);

    if (!draftLineItems.length) {
      return res.status(400).json({ error: "لا يمكن نسخ طلب بدون منتجات صالحة" });
    }

    const customerId = o?.customer?.id ? Number(o.customer.id) : null;

    // تنظيف note من DUP_FROM_ORDER لو موجود
    const cleanNote = String(o?.note || "")
      .split("\n")
      .filter(line => !line.trim().startsWith("DUP_FROM_ORDER:"))
      .join("\n")
      .trim();

    // tags بدون تكرار
const originalTags = String(o?.tags || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const hasArTag = originalTags.some(t => t.toLowerCase() === "ar");

// ✅ في النسخة الجديدة: احتفظ فقط بـ ar إن وجد
const tags = hasArTag ? "ar" : "";
    
    const payload = {
      draft_order: {
        ...(customerId ? { customer: { id: customerId } } : {}),
        ...(o?.email ? { email: String(o.email) } : {}),
        line_items: draftLineItems,
        ...(o?.shipping_address ? { shipping_address: o.shipping_address } : {}),
        ...(o?.billing_address ? { billing_address: o.billing_address } : {}),
        ...(cleanNote ? { note: cleanNote } : {}),
        tags,
      },
    };

    const dr = await shopifyRest(`/draft_orders.json`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const draft = dr?.draft_order;
    const draftId = draft?.id ? String(draft.id) : "";
    if (!draftId) throw new Error("فشل إنشاء Draft Order");

    return res.json({
      ok: true,
      draftId,
      draft,
      sourceOrderId: numericId,
      itemCount: draftLineItems.length
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
// =========================
// ✅ Update Draft (shipping + discount)
// =========================
router.post("/api/manage/draft/update", async (req, res) => {
  try {
    const {
      draftId,
      shippingTitle,
      shippingPrice,   // رقم مثل 0 أو 2 أو 1 أو أي قيمة
      discountCode,    // نص فقط (للعرض/التوثيق)
      discountType,    // "fixed" أو "percentage"
      discountValue    // رقم
    } = req.body || {};

    if (!draftId) return res.status(400).json({ error: "draftId مطلوب" });

    const id = String(draftId);

    const shipTitle = String(shippingTitle || "").trim();
    const shipPrice = Number(shippingPrice || 0);
    if (!Number.isFinite(shipPrice) || shipPrice < 0) {
      return res.status(400).json({ error: "shippingPrice غير صالح" });
    }

    const code = String(discountCode || "").trim();
    const dType = String(discountType || "").toLowerCase();
    const dVal = Number(discountValue || 0);

const draftPatch = { id: Number(id) };

if (shipTitle) {
  draftPatch.shipping_line = {
    title: shipTitle,
    price: String(shipPrice.toFixed(3)),
  };
}

    // ✅ خصم يدوي (manual discount) لأن “كود خصم” الحقيقي يحتاج PriceRule/DiscountCode من Shopify
    // هنا نخليك تدخل كود + نوع/قيمة، ونطبق كخصم يدوي.
    if (code && Number.isFinite(dVal) && dVal > 0) {
      const value_type = (dType === "percentage") ? "percentage" : "fixed_amount";
      draftPatch.applied_discount = {
        title: code,                 // نخزن الكود هنا
        description: code,
        value_type,
        value: String(dVal),
        amount: undefined,          // Shopify يحسبها
      };
    } else {
      // لو ما فيه خصم امسح applied_discount
      draftPatch.applied_discount = null;
    }

    // ✅ حدّث Draft
    const out = await shopifyRest(`/draft_orders/${id}.json`, {
      method: "PUT",
      body: JSON.stringify({ draft_order: draftPatch }),
    });

    return res.json({ ok: true, draft: out?.draft_order || out });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
// =========================
// ✅ Complete Draft -> creates Order
// =========================
router.post("/api/manage/draft/complete", async (req, res) => {
  try {
    const { draftId } = req.body || {};
    if (!draftId) return res.status(400).json({ error: "draftId مطلوب" });

    const id = String(draftId);

    const cr = await shopifyRest(`/draft_orders/${id}/complete.json?payment_pending=true`, {
      method: "PUT",
      body: JSON.stringify({}),
    });

    const newOrderId =
      String(cr?.order?.id || cr?.draft_order?.order_id || cr?.draft_order?.order?.id || "");

    if (!newOrderId) {
      // fallback read draft to get order_id
      const dr2 = await shopifyRest(`/draft_orders/${id}.json`, { method: "GET" });
      const fallbackNewId = String(dr2?.draft_order?.order_id || "");
      if (!fallbackNewId) throw new Error("تم الإكمال لكن لم أستطع استخراج رقم الطلب الجديد");
      return res.json({ ok: true, newOrderId: fallbackNewId });
    }

    return res.json({ ok: true, newOrderId });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
// =========================
// ✅ Draft lines (FAST) (for UI)
// =========================
router.get("/api/manage/draft/:id/lines", async (req, res) => {
  try {
    const draftId = req.params.id;
    if (!draftId) return res.status(400).json({ error: "draftId مطلوب" });

    // 1) اقرأ الدرفت (REST واحد)
    const out = await shopifyRest(
      `/draft_orders/${encodeURIComponent(draftId)}.json?fields=id,line_items`,
      { method: "GET" }
    );

    const d = out?.draft_order;
    if (!d) return res.status(404).json({ error: "Draft غير موجود" });

    const lines = Array.isArray(d.line_items) ? d.line_items : [];

    // 2) اجمع variant ids
    const variantIds = Array.from(
      new Set(
        lines
          .map(li => (li?.variant_id ? String(li.variant_id) : ""))
          .filter(Boolean)
      )
    );

    // 3) هات بيانات كل variants مرة وحدة (GraphQL واحد)
    const byVariantId = new Map(); // numericId -> info

    if (variantIds.length) {
      const gids = variantIds.map(id => toGid("ProductVariant", id));

      const GQL = `
        query VNodes($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              sku
              barcode
              price
              image { url }
              product { featuredImage { url } }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(GQL, { ids: gids });
      const nodes = Array.isArray(data?.nodes) ? data.nodes : [];

      for (const v of nodes) {
        if (!v?.id) continue;
        const numId = toNumericId(v.id);
        byVariantId.set(numId, {
          variantGid: String(v.id),
          variantId: String(numId),
          sku: String(v?.sku || ""),
          barcode: String(v?.barcode || ""),
          price: String(v?.price || "0"),
          imageUrl: String(v?.image?.url || v?.product?.featuredImage?.url || ""),
        });
      }
    }

    // 4) رجّع نفس الفورمات اللي تتوقعه الواجهة (بدون بطء)
    const mapped = lines
      .map((li) => {
        const variantId = li?.variant_id ? String(li.variant_id) : "";
        const vInfo = variantId ? byVariantId.get(String(variantId)) : null;

        const title = String(li?.title || li?.name || "").trim();
        const qty = Number(li?.quantity || 0) || 0;

        // سعر الدرفت نفسه لو موجود، وإلا خذ سعر الـ variant
        const price = String(li?.price || (vInfo?.price || "0"));

        return {
          title,
          qty,
          price,
          imageUrl: String(vInfo?.imageUrl || ""),
          variantGid: String(vInfo?.variantGid || (variantId ? toGid("ProductVariant", variantId) : "")),
          variantId: String(variantId || ""),
          lineItemGid: "", // draft line ما له GID
          sku: String(vInfo?.sku || ""),
          barcode: String(vInfo?.barcode || ""),
        };
      })
      .filter((it) => it.title);

    return res.json({ ok: true, draftId: String(d.id), items: mapped });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

router.post("/api/manage/draft/items/set", async (req, res) => {
  try {
    const { draftId, items } = req.body || {};
    if (!draftId) return res.status(400).json({ error: "draftId مطلوب" });

    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return res.status(400).json({ error: "items مطلوبة" });

    const normalizeVariantId = (v) => {
      const s = String(v || "").trim();
      if (!s) return null;

      if (/^\d+$/.test(s)) return Number(s);

      const m = s.match(/(\d+)\s*$/);
      if (m) return Number(m[1]);

      return null;
    };

    // ✅ تنظيف العناصر قبل إرسالها إلى Shopify
    const cleaned = arr
      .map((it) => {
        const qty = Number(it?.qty ?? it?.quantity ?? 0) || 0;
        const rawTitle = String(it?.title || "").trim();
        const low = rawTitle.toLowerCase();

        // أهم إصلاح: لا تحول 0 إلى 1
        if (qty <= 0) return null;

        // تجاهل المنتجات المحذوفة/الوهمية
        if (!rawTitle) return null;
        if (low === "removed" || low === "deleted" || low === "remove" || low === "delete") return null;

        const vId =
          normalizeVariantId(it?.variantId) ||
          normalizeVariantId(it?.variant_id) ||
          normalizeVariantId(it?.variantGid) ||
          normalizeVariantId(it?.variant_gid) ||
          normalizeVariantId(it?.variantGID);

        if (vId) {
          return {
            variant_id: vId,
            quantity: qty
          };
        }

        return {
          title: rawTitle,
          price: String(it?.price || "0").trim(),
          quantity: qty
        };
      })
      .filter(Boolean);

    if (!cleaned.length) {
      return res.status(400).json({ error: "لا توجد منتجات صالحة بعد التنظيف" });
    }

    const out = await shopifyRest(`/draft_orders/${encodeURIComponent(draftId)}.json`, {
      method: "PUT",
      body: JSON.stringify({
        draft_order: {
          id: Number(draftId),
          line_items: cleaned
        }
      }),
    });

    return res.json({
      ok: true,
      draft: out?.draft_order || out,
      debug: {
        receivedCount: arr.length,
        cleanedCount: cleaned.length,
        removedCount: arr.length - cleaned.length,
        variantsUsed: cleaned.filter(x => x.variant_id).length,
        customUsed: cleaned.filter(x => x.title && !x.variant_id).length
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
  // =========================
// ✅ Draft create order (update + complete)
// =========================
router.post("/api/manage/draft/create_order", async (req, res) => {
  try {
    const {
      draftId,
      shippingPrice = 0,
      discountCode = "",
      discountType = "fixed",
      discountValue = 0,
      shippingTitle = "" // اختياري لو تبغاه
    } = req.body || {};

    if (!draftId) return res.status(400).json({ error: "draftId مطلوب" });

    // 1) update draft (shipping + discount)
    await shopifyRest(`/draft_orders/${encodeURIComponent(draftId)}.json`, {
      method: "PUT",
      body: JSON.stringify({
        draft_order: {
          id: Number(draftId),
          ...(shippingTitle || Number(shippingPrice) > 0
            ? {
                shipping_line: {
                  title: String(shippingTitle || "Shipping").trim(),
                  price: String(Number(shippingPrice || 0)),
                },
              }
            : {}),
          ...(String(discountCode || "").trim() && Number(discountValue) > 0
            ? {
                applied_discount: {
                  title: String(discountCode).trim(),
                  description: String(discountCode).trim(),
                  value_type: String(discountType).toLowerCase() === "percentage"
                    ? "percentage"
                    : "fixed_amount",
                  value: String(Number(discountValue).toFixed(3)),
                },
              }
            : { applied_discount: null }),
        },
      }),
    });

    // 2) complete draft -> order
    const cr = await shopifyRest(
      `/draft_orders/${encodeURIComponent(draftId)}/complete.json?payment_pending=true`,
      { method: "PUT", body: JSON.stringify({}) }
    );

    const newOrderId =
      String(cr?.order?.id || cr?.draft_order?.order_id || "");

    if (!newOrderId) {
      return res.json({ ok: true, message: "تم الإكمال لكن لم أستطع استخراج رقم الطلب الجديد", raw: cr });
    }

    return res.json({ ok: true, newOrderId });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


router.post("/api/manage/unfulfill", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    console.log("UNFULFILL START orderId =", orderId);

    if (!orderId) {
      return res.status(400).json({ error: "orderId مطلوب" });
    }

    const orderGid = toGid("Order", orderId);
    console.log("orderGid =", orderGid);

    const data = await shopifyGraphQL(
      `
      query GetOrderForFastUnfulfill($id: ID!) {
        order(id: $id) {
          id
          name
          fulfillments {
            id
            status
            createdAt
          }
          fulfillmentOrders(first: 20) {
            nodes {
              id
              status
              requestStatus
              supportedActions {
                action
              }
              fulfillments(first: 10) {
                nodes {
                  id
                }
              }
            }
          }
        }
      }
      `,
      { id: orderGid }
    );

    console.log("UNFULFILL order data =", JSON.stringify(data, null, 2));

    const order = data?.order;
    if (!order) {
      return res.status(404).json({ error: "الطلب غير موجود" });
    }

    const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
    const fulfillmentOrders = Array.isArray(order?.fulfillmentOrders?.nodes)
      ? order.fulfillmentOrders.nodes
      : [];

    console.log("fulfillments =", fulfillments);
    console.log(
      "FULFILLMENTS DEBUG =",
      JSON.stringify(
        fulfillments.map(f => ({
          id: f?.id,
          status: f?.status,
          createdAt: f?.createdAt
        })),
        null,
        2
      )
    );

    console.log("fulfillmentOrders =", fulfillmentOrders);
    console.log(
      "FULFILLMENT ORDERS DEBUG =",
      JSON.stringify(
        fulfillmentOrders.map(x => ({
          id: x?.id,
          status: x?.status,
          requestStatus: x?.requestStatus,
          supportedActions: Array.isArray(x?.supportedActions)
            ? x.supportedActions.map(a => a?.action || a)
            : []
        })),
        null,
        2
      )
    );

if (fulfillments.length) {
  const activeFulfillment =
    [...fulfillments]
      .reverse()
      .find(f => {
        const id = String(f?.id || "").trim();
        const status = String(f?.status || "").toUpperCase().trim();

        if (!id) return false;
        if (["CANCELLED", "CANCELED", "FAILURE"].includes(status)) return false;

        return true;
      }) || null;

  const fulfillmentGid = String(activeFulfillment?.id || "").trim();

  console.log("picked active fulfillment =", activeFulfillment);
  console.log("try fulfillmentCancel", fulfillmentGid);

  if (fulfillmentGid) {
    const cancelData = await shopifyGraphQL(
      `
      mutation FulfillmentCancel($id: ID!) {
        fulfillmentCancel(id: $id) {
          fulfillment {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
      `,
      { id: fulfillmentGid }
    );

    console.log("fulfillmentCancel result =", JSON.stringify(cancelData, null, 2));

    const errs = Array.isArray(cancelData?.fulfillmentCancel?.userErrors)
      ? cancelData.fulfillmentCancel.userErrors
      : [];

    if (!errs.length) {
      const verify = await shopifyGraphQL(
        `
        query VerifyOrderAfterUnfulfill($id: ID!) {
          order(id: $id) {
            id
            name
            displayFulfillmentStatus
            fulfillments {
              id
              status
              createdAt
            }
            fulfillmentOrders(first: 20) {
              nodes {
                id
                status
                requestStatus
                supportedActions {
                  action
                }
                fulfillments(first: 10) {
                  nodes {
                    id
                    status
                    createdAt
                  }
                }
              }
            }
          }
        }
        `,
        { id: orderGid }
      );

      return res.json({
        ok: true,
        mode: "fulfillmentCancel",
        message: "تم تنفيذ fulfillmentCancel",
        cancelledFulfillment: cancelData?.fulfillmentCancel?.fulfillment || null,
        verifyOrder: verify?.order || null
      });
    }

    console.log("fulfillmentCancel userErrors =", errs);
  }
}

    
    const fo =
      [...fulfillmentOrders]
        .reverse()
        .find(x => {
          const idOk = String(x?.id || "").trim();
          if (!idOk) return false;

          const supported = Array.isArray(x?.supportedActions)
            ? x.supportedActions.map(a =>
                typeof a === "string"
                  ? a.toUpperCase()
                  : String(a?.action || "").toUpperCase()
              ).filter(Boolean)
            : [];

          const status = String(x?.status || "").toUpperCase();
          const requestStatus = String(x?.requestStatus || "").toUpperCase();

          if (status === "CANCELLED" || requestStatus === "CANCELLATION_REQUESTED") {
            return false;
          }

          return (
            supported.includes("CANCEL_FULFILLMENT_ORDER") ||
            supported.includes("CANCEL") ||
            supported.includes("REQUEST_CANCELLATION") ||
            supported.length > 0
          );
        }) || null;

    console.log("picked fulfillmentOrder =", fo);

    if (!fo?.id) {
      return res.status(400).json({ error: "لم أجد Fulfillment Order مناسب للإلغاء" });
    }

    const foId = String(fo.id);
    const supported = Array.isArray(fo.supportedActions)
      ? fo.supportedActions.map(x => {
          if (typeof x === "string") return x.toUpperCase();
          if (x?.action) return String(x.action).toUpperCase();
          return "";
        }).filter(Boolean)
      : [];

    console.log("supportedActions =", supported);

    if (supported.includes("CANCEL_FULFILLMENT_ORDER") || supported.includes("CANCEL")) {
      const cancelFO = await shopifyGraphQL(
        `
        mutation FulfillmentOrderCancel($id: ID!) {
          fulfillmentOrderCancel(id: $id) {
            fulfillmentOrder {
              id
              status
              requestStatus
            }
            replacementFulfillmentOrder {
              id
              status
              requestStatus
            }
            userErrors {
              field
              message
            }
          }
        }
        `,
        { id: foId }
      );

      console.log("fulfillmentOrderCancel result =", JSON.stringify(cancelFO, null, 2));

      const errs = Array.isArray(cancelFO?.fulfillmentOrderCancel?.userErrors)
        ? cancelFO.fulfillmentOrderCancel.userErrors
        : [];

      if (!errs.length) {
        return res.json({
          ok: true,
          mode: "fulfillmentOrderCancel",
          message: "تم إلغاء الشحن عبر Fulfillment Order",
          fulfillmentOrder: cancelFO?.fulfillmentOrderCancel?.fulfillmentOrder || null,
          replacementFulfillmentOrder: cancelFO?.fulfillmentOrderCancel?.replacementFulfillmentOrder || null
        });
      }

      console.log("fulfillmentOrderCancel userErrors =", errs);
    }

    const cancelReq = await shopifyGraphQL(
      `
      mutation FulfillmentOrderSubmitCancellationRequest($id: ID!) {
        fulfillmentOrderSubmitCancellationRequest(id: $id) {
          fulfillmentOrder {
            id
            status
            requestStatus
          }
          userErrors {
            field
            message
          }
        }
      }
      `,
      { id: foId }
    );

    console.log("cancellationRequest result =", JSON.stringify(cancelReq, null, 2));

    const reqErrs = Array.isArray(cancelReq?.fulfillmentOrderSubmitCancellationRequest?.userErrors)
      ? cancelReq.fulfillmentOrderSubmitCancellationRequest.userErrors
      : [];

    if (!reqErrs.length) {
      return res.json({
        ok: true,
        mode: "fulfillmentOrderSubmitCancellationRequest",
        message: "تم إرسال طلب إلغاء الشحن",
        fulfillmentOrder: cancelReq?.fulfillmentOrderSubmitCancellationRequest?.fulfillmentOrder || null
      });
    }

    return res.status(400).json({
      error: reqErrs.map(e => e?.message).filter(Boolean).join(" | ") || "تعذر إلغاء الشحن"
    });
  } catch (e) {
    console.error("UNFULFILL ROUTE ERROR:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// =========================
// Customer Blacklist Helpers
// =========================
function normalizeCustomerPhone(raw) {
  let d = String(raw || "").replace(/\D+/g, "");

  if (d.startsWith("00968")) d = d.slice(5);
  while (d.startsWith("968968")) d = d.slice(3);
  if (d.startsWith("968")) d = d.slice(3);

  // خذ آخر 8 أرقام فقط
  if (d.length > 8) d = d.slice(-8);

  return d; // local 8 digits
}

function normalizeCustomerTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t || "").trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function customerHasTag(customer, tag) {
  const tags = normalizeCustomerTags(customer?.tags).map((x) => x.toLowerCase());
  return tags.includes(String(tag || "").trim().toLowerCase());
}

function mapCustomerNode(node = {}) {
  const defaultAddress = node?.defaultAddress || {};
  const ordersCount = Number(node?.numberOfOrders || 0) || 0;

  const phone =
    String(defaultAddress?.phone || "").trim() ||
    String(node?.phone || "").trim();

  return {
    id: String(node?.id || "").split("/").pop(),
    gid: String(node?.id || ""),
    firstName: String(node?.firstName || "").trim(),
    lastName: String(node?.lastName || "").trim(),
    name: [
      String(node?.firstName || "").trim(),
      String(node?.lastName || "").trim(),
    ].filter(Boolean).join(" ").trim(),
    email: String(node?.email || "").trim(),
    phone,
    tags: Array.isArray(node?.tags) ? node.tags : [],
    ordersCount,
    amountSpent: String(node?.amountSpent?.amount || "0"),
    amountSpentCurrency: String(node?.amountSpent?.currencyCode || "OMR"),
    city: String(defaultAddress?.city || "").trim(),
    address1: String(defaultAddress?.address1 || "").trim(),
    createdAt: node?.createdAt || "",
    updatedAt: node?.updatedAt || "",
    blacklisted: customerHasTag(node, "blacklist"),
  };
}


function splitBulkPhones(raw) {
  return String(raw || "")
    .split(/[\n\r,;|\t ]+/)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function uniqueStrings(arr = []) {
  return [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))];
}

function chunkArray(arr = [], size = 50) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function findCustomersByPhoneRaw(rawPhone) {
  const local8 = normalizeCustomerPhone(rawPhone);
  if (!local8 || local8.length !== 8) {
    return {
      ok: false,
      rawPhone,
      local8: "",
      customers: [],
      reason: "invalid_phone"
    };
  }

  const candidates = [
    `phone:${local8}`,
    `phone:968${local8}`,
    `phone:00968${local8}`,
    `phone:+968${local8}`,
  ];

  let found = [];

  for (const q of candidates) {
    const data = await shopifyGraphQL(
      `
      query SearchCustomersByPhone($q: String!) {
        customers(first: 25, query: $q) {
          nodes {
            id
            firstName
            lastName
            email
            phone
            tags
            createdAt
            updatedAt
            numberOfOrders
            amountSpent {
              amount
              currencyCode
            }
            defaultAddress {
              address1
              city
              phone
            }
          }
        }
      }
      `,
      { q }
    );

    const nodes = Array.isArray(data?.customers?.nodes)
      ? data.customers.nodes
      : [];

    const exact = nodes.filter((node) => {
      const phones = [
        String(node?.phone || "").trim(),
        String(node?.defaultAddress?.phone || "").trim(),
      ]
        .map(normalizeCustomerPhone)
        .filter(Boolean);

      return phones.includes(local8);
    });

    if (exact.length) {
      found = exact;
      break;
    }
  }

  const seen = new Set();
  const customers = found
    .map(mapCustomerNode)
    .filter((c) => {
      if (!c?.id || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

  return {
    ok: true,
    rawPhone,
    local8,
    customers,
    reason: customers.length ? "matched" : "not_found"
  };
}


  // =========================
// Customers: bulk preview by phones
// =========================
router.post(
  "/api/manage/customers/blacklist/preview",
  express.json({ limit: "5mb" }),
  async (req, res) => {
    try {
      const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
      const rawText = String(req.body?.rawText || "").trim();

      const parsedPhones = uniqueStrings([
        ...phones,
        ...splitBulkPhones(rawText)
      ]);

      if (!parsedPhones.length) {
        return res.status(400).json({ error: "phones أو rawText مطلوب" });
      }

      const limit = Math.min(parsedPhones.length, 2000);
      const inputPhones = parsedPhones.slice(0, limit);

      const chunks = chunkArray(inputPhones, 50);
      const rows = [];

      for (const chunk of chunks) {
        const results = await Promise.all(
          chunk.map((phone) => findCustomersByPhoneRaw(phone))
        );
        rows.push(...results);
      }

      const summary = {
        totalInput: inputPhones.length,
        invalid: rows.filter((x) => x.reason === "invalid_phone").length,
        notFound: rows.filter((x) => x.reason === "not_found").length,
        matchedPhones: rows.filter((x) => x.reason === "matched").length,
        matchedCustomers: rows.reduce((n, x) => n + (Array.isArray(x.customers) ? x.customers.length : 0), 0),
        alreadyBlacklisted: rows.reduce(
          (n, x) => n + (Array.isArray(x.customers) ? x.customers.filter((c) => c.blacklisted).length : 0),
          0
        ),
        readyToBlacklist: rows.reduce(
          (n, x) => n + (Array.isArray(x.customers) ? x.customers.filter((c) => !c.blacklisted).length : 0),
          0
        ),
      };

      return res.json({
        ok: true,
        summary,
        results: rows
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);


  // =========================
// Customers: bulk add blacklist
// =========================
router.post(
  "/api/manage/customers/blacklist/bulk-add",
  express.json({ limit: "5mb" }),
  async (req, res) => {
    try {
      const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
      const rawText = String(req.body?.rawText || "").trim();

      const parsedPhones = uniqueStrings([
        ...phones,
        ...splitBulkPhones(rawText)
      ]);

      if (!parsedPhones.length) {
        return res.status(400).json({ error: "phones أو rawText مطلوب" });
      }

      const limit = Math.min(parsedPhones.length, 2000);
      const inputPhones = parsedPhones.slice(0, limit);

      const chunks = chunkArray(inputPhones, 50);

      const report = [];
      let affectedCustomers = 0;

      for (const chunk of chunks) {
        const foundRows = await Promise.all(
          chunk.map((phone) => findCustomersByPhoneRaw(phone))
        );

        for (const row of foundRows) {
          if (row.reason === "invalid_phone") {
            report.push({
              rawPhone: row.rawPhone,
              local8: "",
              status: "invalid_phone",
              customers: []
            });
            continue;
          }

          if (!row.customers.length) {
            report.push({
              rawPhone: row.rawPhone,
              local8: row.local8,
              status: "not_found",
              customers: []
            });
            continue;
          }

          const updatedCustomers = [];

          for (const customer of row.customers) {
            if (customer.blacklisted) {
              updatedCustomers.push({
                ...customer,
                action: "already_blacklisted"
              });
              continue;
            }

            const updated = await customerTagsAdd(customer.id, ["blacklist"]);
            const mapped = mapCustomerNode(updated || {});
            updatedCustomers.push({
              ...mapped,
              action: "blacklisted_now"
            });
            affectedCustomers++;
          }

          report.push({
            rawPhone: row.rawPhone,
            local8: row.local8,
            status: "processed",
            customers: updatedCustomers
          });
        }
      }

      const summary = {
        totalInput: inputPhones.length,
        invalid: report.filter((x) => x.status === "invalid_phone").length,
        notFound: report.filter((x) => x.status === "not_found").length,
        processedPhones: report.filter((x) => x.status === "processed").length,
        affectedCustomers,
        alreadyBlacklisted: report.reduce(
          (n, x) => n + (Array.isArray(x.customers) ? x.customers.filter((c) => c.action === "already_blacklisted").length : 0),
          0
        ),
        blacklistedNow: report.reduce(
          (n, x) => n + (Array.isArray(x.customers) ? x.customers.filter((c) => c.action === "blacklisted_now").length : 0),
          0
        ),
      };

      return res.json({
        ok: true,
        summary,
        results: report
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);


  
async function customerTagsAdd(customerIdOrGid, tags = []) {
  const id = String(customerIdOrGid || "").startsWith("gid://")
    ? String(customerIdOrGid)
    : toGid("Customer", customerIdOrGid);

  const tagsList = [...new Set(
    (Array.isArray(tags) ? tags : [tags])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  )];

  if (!tagsList.length) throw new Error("tags مطلوبة");

  const data = await shopifyGraphQL(
    `
    mutation CustomerTagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node {
          ... on Customer {
            id
            firstName
            lastName
            email
            phone
            tags
            createdAt
            updatedAt
            numberOfOrders
            amountSpent {
              amount
              currencyCode
            }
            defaultAddress {
              address1
              city
              phone
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    { id, tags: tagsList }
  );

  const err = data?.tagsAdd?.userErrors?.[0];
  if (err?.message) throw new Error(err.message);

  return data?.tagsAdd?.node || null;
}

async function customerTagsRemove(customerIdOrGid, tags = []) {
  const id = String(customerIdOrGid || "").startsWith("gid://")
    ? String(customerIdOrGid)
    : toGid("Customer", customerIdOrGid);

  const tagsList = [...new Set(
    (Array.isArray(tags) ? tags : [tags])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  )];

  if (!tagsList.length) throw new Error("tags مطلوبة");

  const data = await shopifyGraphQL(
    `
    mutation CustomerTagsRemove($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        node {
          ... on Customer {
            id
            firstName
            lastName
            email
            phone
            tags
            createdAt
            updatedAt
            numberOfOrders
            amountSpent {
              amount
              currencyCode
            }
            defaultAddress {
              address1
              city
              phone
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    `,
    { id, tags: tagsList }
  );

  const err = data?.tagsRemove?.userErrors?.[0];
  if (err?.message) throw new Error(err.message);

  return data?.tagsRemove?.node || null;
}

// =========================
// Customers: search by phone
// =========================
router.get("/api/manage/customers/by-phone", async (req, res) => {
  try {
    const rawPhone = String(req.query.phone || "").trim();
    if (!rawPhone) {
      return res.status(400).json({ error: "phone مطلوب" });
    }

    const local8 = normalizeCustomerPhone(rawPhone);
    if (!local8 || local8.length !== 8) {
      return res.status(400).json({ error: "رقم الهاتف غير صالح" });
    }

    const candidates = [
      `phone:${local8}`,
      `phone:968${local8}`,
      `phone:00968${local8}`,
      `phone:+968${local8}`,
    ];

    let found = [];

    for (const q of candidates) {
      const data = await shopifyGraphQL(
        `
        query SearchCustomersByPhone($q: String!) {
          customers(first: 25, query: $q) {
            nodes {
              id
              firstName
              lastName
              email
              phone
              tags
              createdAt
              updatedAt
              numberOfOrders
              amountSpent {
                amount
                currencyCode
              }
              defaultAddress {
                address1
                city
                phone
              }
            }
          }
        }
        `,
        { q }
      );

      const nodes = Array.isArray(data?.customers?.nodes)
        ? data.customers.nodes
        : [];

      const exact = nodes.filter((node) => {
        const phones = [
          String(node?.phone || "").trim(),
          String(node?.defaultAddress?.phone || "").trim(),
        ]
          .map(normalizeCustomerPhone)
          .filter(Boolean);

        return phones.includes(local8);
      });

      if (exact.length) {
        found = exact;
        break;
      }
    }

    const seen = new Set();
    const customers = found
      .map(mapCustomerNode)
      .filter((c) => {
        if (!c?.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    return res.json({
      ok: true,
      count: customers.length,
      local8,
      customers,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// =========================
// Customers: all blacklisted
// =========================
router.get("/api/manage/customers/blacklist", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 250);

    const data = await shopifyGraphQL(
      `
      query BlacklistedCustomers($n: Int!, $q: String!) {
        customers(first: $n, query: $q, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            firstName
            lastName
            email
            phone
            tags
            createdAt
            updatedAt
            numberOfOrders
            amountSpent {
              amount
              currencyCode
            }
            defaultAddress {
              address1
              city
              phone
            }
          }
        }
      }
      `,
      {
        n: limit,
        q: "tag:blacklist",
      }
    );

    const nodes = Array.isArray(data?.customers?.nodes)
      ? data.customers.nodes
      : [];

    const seen = new Set();
    const customers = nodes
      .map(mapCustomerNode)
      .filter((c) => {
        if (!c?.id || seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

    return res.json({
      ok: true,
      count: customers.length,
      customers,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});




  
// =========================
// Customers: add blacklist tag
// =========================
router.post(
  "/api/manage/customer/blacklist/add",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const customerId = String(req.body?.customerId || "").trim();
      if (!customerId) {
        return res.status(400).json({ error: "customerId مطلوب" });
      }

      const updated = await customerTagsAdd(customerId, ["blacklist"]);

      return res.json({
        ok: true,
        customer: mapCustomerNode(updated || {}),
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);

// =========================
// Customers: remove blacklist tag
// =========================
router.post(
  "/api/manage/customer/blacklist/remove",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    try {
      const customerId = String(req.body?.customerId || "").trim();
      if (!customerId) {
        return res.status(400).json({ error: "customerId مطلوب" });
      }

      const updated = await customerTagsRemove(customerId, ["blacklist"]);

      return res.json({
        ok: true,
        customer: mapCustomerNode(updated || {}),
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);




  
  return router;
}
