import express from "express";
import fetch from "node-fetch";

const DEFAULT_CUSTOMER_ACCOUNT_SHOP_ID = "61939155027";

export default function customerCreditRouter(deps = {}) {
  const router = express.Router();
  const getRedis = deps.getRedis;
  const getFirebaseAdmin = deps.getFirebaseAdmin;

  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const API_VERSION =
    process.env.SHOPIFY_API_VERSION ||
    process.env.SHOPIFY_GQL_VERSION ||
    "2026-01";

  function assertEnv(res) {
    if (!SHOP || !TOKEN) {
      res.status(500).json({ error: "SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN ناقص" });
      return false;
    }
    return true;
  }

  async function adminGraphQL(query, variables = {}) {
    const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query, variables })
    });

    const text = await r.text();
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }

    if (!r.ok) {
      throw new Error(`Shopify GraphQL HTTP ${r.status}: ${text.slice(0, 700)}`);
    }

    if (Array.isArray(json.errors) && json.errors.length) {
      throw new Error(
        json.errors.map((e) => e?.message).filter(Boolean).join(" | ") ||
          "Shopify GraphQL error"
      );
    }

    return json.data || {};
  }

  function cleanSearch(value) {
    return String(value || "")
      .replace(/["\\(){}[\]<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function moneyNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function moneyLabel(money) {
    if (!money) return "0";
    return `${moneyNumber(money.amount).toFixed(3)} ${money.currencyCode || ""}`.trim();
  }

  function customerNumericId(customerId) {
    const raw = String(customerId || "").trim();
    return raw.includes("/") ? raw.split("/").pop() || raw : raw;
  }

  async function sendCustomerCreditPush({ customerId, amountText, balanceText }) {
    try {
      if (typeof getRedis !== "function" || typeof getFirebaseAdmin !== "function") {
        return { ok: false, skipped: true, reason: "push_not_configured" };
      }

      const r = await getRedis();
      const fa = getFirebaseAdmin();
      if (!r) return { ok: false, skipped: true, reason: "redis_not_ready" };
      if (!fa) return { ok: false, skipped: true, reason: "firebase_not_ready" };

      const numericId = customerNumericId(customerId);
      const fcmToken =
        (await r.get(`bt:user:push:${numericId}`)) ||
        (await r.get(`bt:user:push:${customerId}`));

      if (!fcmToken) {
        return { ok: false, skipped: true, reason: "no_fcm_token" };
      }

      const locale = String(
        (await r.get(`bt:user:push-locale:${numericId}`)) || ""
      ).toLowerCase();
      const lang = locale.startsWith("en") ? "en" : "ar";
      const titleAr = "\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0631\u0635\u064a\u062f \u0625\u0644\u0649 \u062d\u0633\u0627\u0628\u0643";
      const bodyAr = `\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 ${amountText || "\u0631\u0635\u064a\u062f"} \u0625\u0644\u0649 \u0631\u0635\u064a\u062f\u0643.`;
      const titleEn = "Credit added to your account";
      const bodyEn = `${amountText || "Credit"} has been added to your credit.`;
      const title = lang === "en" ? titleEn : titleAr;
      const body = lang === "en" ? bodyEn : bodyAr;
      const notificationId = `credit-${Date.now()}-${numericId}`;

      await r.lPush(
        `bt:user:notifications:${numericId}`,
        JSON.stringify({
          id: notificationId,
          title,
          body,
          seen: false,
          date: new Date().toISOString(),
          additionalData: {
            dynamic_link: "https://app.halabt.com/wallet",
            type: "customer_credit",
            customer_id: String(customerId || ""),
            amount: String(amountText || ""),
            balance: String(balanceText || ""),
            title_ar: titleAr,
            body_ar: bodyAr,
            title_en: titleEn,
            body_en: bodyEn,
            lang
          }
        })
      ).catch(() => {});
      await r.lTrim(`bt:user:notifications:${numericId}`, 0, 99).catch(() => {});
      await r.expire(`bt:user:notifications:${numericId}`, 60 * 60 * 24 * 120).catch(() => {});

      await fa.messaging().send({
        token: fcmToken,
        notification: {
          title: "تم إضافة رصيد إلى حسابك",
          body: `تمت إضافة ${amountText || "رصيد"} إلى رصيدك.`
          ,title,
          body
        },
        data: {
          id: notificationId,
          dynamic_link: "https://app.halabt.com/wallet",
          type: "customer_credit",
          customer_id: String(customerId || ""),
          amount: String(amountText || ""),
          balance: String(balanceText || ""),
          title_ar: "تم إضافة رصيد إلى حسابك",
          body_ar: `تمت إضافة ${amountText || "رصيد"} إلى رصيدك.`,
          title_en: "Credit added to your account",
          body_en: `${amountText || "Credit"} has been added to your credit.`
          ,title_ar: titleAr,
          body_ar: bodyAr,
          title_en: titleEn,
          body_en: bodyEn,
          lang
        },
        android: {
          notification: {
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            sound: "default"
          }
        },
        apns: {
          payload: {
            aps: {
              sound: "default"
            }
          }
        }
      });

      return { ok: true };
    } catch (e) {
      console.error("customer-credit push error", e?.message || e);
      return { ok: false, skipped: true, reason: e?.message || "push_failed" };
    }
  }

  function isExpired(expiresAt, now = new Date()) {
    if (!expiresAt) return false;
    const time = Date.parse(expiresAt);
    return Number.isFinite(time) && time <= now.getTime();
  }

  function mapTransaction(tx) {
    const expiresAt = tx?.expiresAt || "";
    const remainingAmount = tx?.remainingAmount || null;
    const orderName = tx?.origin?.order?.name || "";
    const rawType = tx?.type || tx?.__typename || "";
    const type =
      String(rawType).includes("Debit") && !orderName ? "revert" : rawType;
    return {
      type,
      amount: tx?.amount || null,
      amountText: moneyLabel(tx?.amount),
      balanceAfterTransaction: tx?.balanceAfterTransaction || null,
      balanceText: moneyLabel(tx?.balanceAfterTransaction),
      createdAt: tx?.createdAt || "",
      expiresAt,
      remainingAmount,
      remainingAmountText: moneyLabel(remainingAmount),
      orderName,
      expired: isExpired(expiresAt)
    };
  }

  function activeAccountBalance(account) {
    const transactions = account?.transactions?.nodes || [];
    let sawCreditRemaining = false;
    let total = 0;
    for (const tx of transactions) {
      const type = String(tx?.__typename || tx?.type || "");
      if (!type.includes("Credit")) continue;
      const remaining = tx?.remainingAmount?.amount;
      if (remaining == null) continue;
      sawCreditRemaining = true;
      if (isExpired(tx?.expiresAt)) continue;
      total += moneyNumber(remaining);
    }
    return sawCreditRemaining ? total : moneyNumber(account?.balance?.amount);
  }

  async function debitStoreCreditAccount(accountId, amount, currencyCode) {
    if (!accountId || !Number.isFinite(amount) || amount <= 0 || !currencyCode) {
      return null;
    }
    const mutation = `#graphql
      mutation StoreCreditAccountDebit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
        storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
          storeCreditAccountTransaction {
            amount {
              amount
              currencyCode
            }
            account {
              id
              balance {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const data = await adminGraphQL(mutation, {
      id: accountId,
      debitInput: {
        debitAmount: {
          amount: amount.toFixed(3),
          currencyCode
        }
      }
    });
    const payload = data?.storeCreditAccountDebit || {};
    const errors = payload.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).filter(Boolean).join(" | "));
    }
    return payload.storeCreditAccountTransaction || null;
  }

  async function creditStoreCreditCustomer(customerId, amount, currencyCode) {
    if (!customerId || !Number.isFinite(amount) || amount <= 0 || !currencyCode) {
      return null;
    }
    const mutation = `#graphql
      mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            amount {
              amount
              currencyCode
            }
            balanceAfterTransaction {
              amount
              currencyCode
            }
            account {
              id
              balance {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const data = await adminGraphQL(mutation, {
      id: customerId,
      creditInput: {
        creditAmount: {
          amount: amount.toFixed(3),
          currencyCode
        }
      }
    });
    const payload = data?.storeCreditAccountCredit || {};
    const errors = payload.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).filter(Boolean).join(" | "));
    }
    return payload.storeCreditAccountTransaction || null;
  }

  async function debitExpiredCredits(customer) {
    if (process.env.AUTO_DEBIT_EXPIRED_CUSTOMER_CREDIT !== "true") {
      return [];
    }
    const debits = [];
    const accounts = customer?.storeCreditAccounts?.nodes || [];
    for (const account of accounts) {
      const accountId = account?.id || "";
      const transactions = account?.transactions?.nodes || [];
      for (const tx of transactions) {
        const type = String(tx?.__typename || "");
        if (!type.includes("Credit")) continue;
        if (!isExpired(tx?.expiresAt)) continue;
        const amount = moneyNumber(tx?.remainingAmount?.amount);
        const currencyCode =
          tx?.remainingAmount?.currencyCode ||
          tx?.amount?.currencyCode ||
          account?.balance?.currencyCode;
        if (amount <= 0 || !currencyCode) continue;
        const debit = await debitStoreCreditAccount(accountId, amount, currencyCode);
        debits.push({
          accountId,
          amount,
          currencyCode,
          expiresAt: tx?.expiresAt || "",
          debit
        });
      }
    }
    return debits;
  }

  function mapAccount(account) {
    const currencyCode = account?.balance?.currencyCode || "OMR";
    const activeBalance = activeAccountBalance(account);
    return {
      id: account?.id || "",
      balance: account?.balance || null,
      activeBalance,
      balanceText: moneyLabel(account?.balance),
      activeBalanceText: moneyLabel({ amount: activeBalance, currencyCode }),
      transactions: (account?.transactions?.nodes || []).map(mapTransaction)
    };
  }

  function mapCustomer(customer, source = "customer") {
    return {
      id: customer?.id || "",
      displayName: customer?.displayName || "",
      firstName: customer?.firstName || "",
      lastName: customer?.lastName || "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      numberOfOrders: customer?.numberOfOrders || 0,
      amountSpent: customer?.amountSpent || null,
      amountSpentText: moneyLabel(customer?.amountSpent),
      source,
      storeCreditAccounts: (customer?.storeCreditAccounts?.nodes || []).map(mapAccount)
    };
  }

  function uniqueCustomers(customers) {
    const map = new Map();
    for (const c of customers) {
      if (!c?.id) continue;
      const old = map.get(c.id);
      if (!old || old.source !== "order") {
        map.set(c.id, c);
      }
    }
    return [...map.values()];
  }

  function creditSortValue(customer) {
    const accounts = Array.isArray(customer?.storeCreditAccounts)
      ? customer.storeCreditAccounts
      : [];
    return accounts.reduce((sum, account) => {
      return sum + moneyNumber(account?.activeBalance ?? account?.balance?.amount ?? 0);
    }, 0);
  }

  function amountSpentValue(customer) {
    return moneyNumber(customer?.amountSpent?.amount);
  }

  async function rewardSnapshot(customerId) {
    if (typeof getRedis !== "function") return { points: 0, lastRewardAt: "" };
    const r = await getRedis();
    if (!r) return { points: 0, lastRewardAt: "" };
    const numeric = customerNumericId(customerId);
    const balanceRaw = await r.get(`bt:rewards:customer:${numeric}:balance`).catch(() => "0");
    const ledgerRows = await r.lRange(`bt:rewards:customer:${numeric}:ledger`, 0, 0).catch(() => []);
    let lastRewardAt = "";
    try {
      lastRewardAt = JSON.parse(ledgerRows?.[0] || "{}")?.createdAt || "";
    } catch {
      lastRewardAt = "";
    }
    return {
      points: Number(balanceRaw || 0) || 0,
      lastRewardAt
    };
  }

  async function customerHasAppInstall(customerId) {
    if (typeof getRedis !== "function") return false;
    const r = await getRedis();
    if (!r) return false;
    const numeric = customerNumericId(customerId);
    const token =
      (await r.get(`bt:user:push:${numeric}`).catch(() => "")) ||
      (await r.get(`bt:user:push:${customerId}`).catch(() => ""));
    return !!token;
  }

  async function listAppCustomerIdsFromRedis(limit = 250) {
    if (typeof getRedis !== "function") return [];
    const r = await getRedis();
    if (!r) return [];

    const keys = [];
    if (typeof r.scanIterator === "function") {
      for await (const key of r.scanIterator({ MATCH: "bt:user:push:*", COUNT: 200 })) {
        keys.push(String(key));
        if (keys.length >= limit) break;
      }
    } else if (typeof r.keys === "function") {
      const all = await r.keys("bt:user:push:*");
      keys.push(...(all || []).slice(0, limit));
    }

    const ids = [];
    const seen = new Set();
    for (const key of keys) {
      const raw = String(key || "").replace(/^bt:user:push:/, "").trim();
      if (!raw) continue;
      const id = raw.startsWith("gid://shopify/Customer/")
        ? raw
        : `gid://shopify/Customer/${raw}`;
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  async function getCustomersByIds(ids = []) {
    const out = [];
    const cleanIds = ids
      .map((id) => String(id || "").trim())
      .filter((id) => id.startsWith("gid://shopify/Customer/"));

    for (let i = 0; i < cleanIds.length; i += 25) {
      const chunk = cleanIds.slice(i, i + 25);
      const data = await adminGraphQL(
        `#graphql
          ${CUSTOMER_FRAGMENT}
          query CustomersByIds($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Customer {
                ...CustomerCreditFields
              }
            }
          }
        `,
        { ids: chunk }
      );
      out.push(...(data?.nodes || []).filter((n) => n?.id).map((c) => mapCustomer(c, "app")));
    }

    const unique = uniqueCustomers(out);
    await Promise.all(unique.map(async (customer) => {
      customer.appInstalled = await customerHasAppInstall(customer.id);
      customer.rewards = await rewardSnapshot(customer.id);
    }));

    return unique.sort((a, b) => {
      const ba = creditSortValue(a);
      const bb = creditSortValue(b);
      if (bb !== ba) return bb - ba;
      const spentDiff = amountSpentValue(b) - amountSpentValue(a);
      if (spentDiff) return spentDiff;
      const ordersDiff = Number(b.numberOfOrders || 0) - Number(a.numberOfOrders || 0);
      if (ordersDiff) return ordersDiff;
      return String(a.displayName || a.email || "").localeCompare(String(b.displayName || b.email || ""));
    });
  }

  async function findAdminCustomer(customer) {
    const id = String(customer?.id || customer?.customerId || customer?.customer_id || "").trim();
    const email = String(customer?.email || customer?.emailAddress?.emailAddress || "").trim();

    if (id) {
      const data = await adminGraphQL(
        `#graphql
          ${CUSTOMER_FRAGMENT}
          query CustomerNode($id: ID!) {
            node(id: $id) {
              ... on Customer {
                ...CustomerCreditFields
              }
            }
          }
        `,
        { id }
      ).catch(() => null);
      if (data?.node?.id) return data.node;
    }

    if (!email) return null;
    const data = await adminGraphQL(
      `#graphql
        ${CUSTOMER_FRAGMENT}
        query CustomerByEmail($query: String!) {
          customers(first: 1, query: $query) {
            nodes {
              ...CustomerCreditFields
            }
          }
        }
      `,
      { query: `email:${email}` }
    );
    return data?.customers?.nodes?.[0] || null;
  }

  const CUSTOMER_FRAGMENT = `#graphql
    fragment CustomerCreditFields on Customer {
      id
      displayName
      firstName
      lastName
      email
      phone
      numberOfOrders
      amountSpent {
        amount
        currencyCode
      }
      storeCreditAccounts(first: 10) {
        nodes {
          id
          balance {
            amount
            currencyCode
          }
          transactions(first: 50, reverse: true) {
            nodes {
              __typename
              amount {
                amount
                currencyCode
              }
              balanceAfterTransaction {
                amount
                currencyCode
              }
              createdAt
              origin {
                __typename
                ... on OrderTransaction {
                  order {
                    name
                  }
                }
              }
              ... on StoreCreditAccountCreditTransaction {
                expiresAt
                remainingAmount {
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

  async function searchCustomers(queryText) {
    const query = `#graphql
      ${CUSTOMER_FRAGMENT}
      query SearchCustomers($query: String!, $first: Int!) {
        customers(first: $first, query: $query) {
          nodes {
            ...CustomerCreditFields
          }
        }
      }
    `;
    const data = await adminGraphQL(query, { query: queryText, first: 10 });
    return (data?.customers?.nodes || []).map((c) => mapCustomer(c, "customer"));
  }

  async function searchOrders(queryText) {
    const query = `#graphql
      ${CUSTOMER_FRAGMENT}
      query SearchOrders($query: String!, $first: Int!) {
        orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            name
            email
            phone
            customer {
              ...CustomerCreditFields
            }
          }
        }
      }
    `;
    const data = await adminGraphQL(query, { query: queryText, first: 10 });
    return (data?.orders?.nodes || [])
      .filter((o) => o?.customer?.id)
      .map((o) => ({
        ...mapCustomer(o.customer, "order"),
        matchedOrder: {
          id: o.id || "",
          name: o.name || "",
          email: o.email || "",
          phone: o.phone || ""
        }
      }));
  }

  function isDeliveredOrder(order) {
    const status = String(order?.displayFulfillmentStatus || "").toLowerCase();
    const tags = (order?.tags || []).map((tag) => String(tag || "").toLowerCase());
    if (status.includes("delivered") || status.includes("fulfilled")) return true;
    return tags.some((tag) => (
      tag.includes("delivered") ||
      tag.includes("delivered_order") ||
      tag.includes("completed") ||
      tag.includes("تم_التوصيل") ||
      tag.includes("تم التوصيل") ||
      tag.includes("استلم") ||
      tag.includes("delivered-to-customer")
    ));
  }

  async function loadDeliveredCustomerStats(limit = 250) {
    const first = Math.max(10, Math.min(Number(limit || 250) || 250, 250));
    const query = `#graphql
      query TopDeliveredOrders($first: Int!) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            name
            tags
            cancelledAt
            displayFulfillmentStatus
            processedAt
            totalPriceSet { shopMoney { amount currencyCode } }
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            customer { id }
          }
        }
      }
    `;
    const data = await adminGraphQL(query, { first });
    const map = new Map();
    for (const order of data?.orders?.nodes || []) {
      const customerId = order?.customer?.id || "";
      if (!customerId) continue;
      if (order?.cancelledAt) continue;
      if (!isDeliveredOrder(order)) continue;
      const money = order?.currentTotalPriceSet?.shopMoney || order?.totalPriceSet?.shopMoney || {};
      const amount = moneyNumber(money.amount);
      const old = map.get(customerId) || {
        customerId,
        deliveredOrders: 0,
        deliveredSpent: 0,
        deliveredSpentCurrency: money.currencyCode || "OMR",
        lastDeliveredOrderName: "",
        lastDeliveredAt: ""
      };
      old.deliveredOrders += 1;
      old.deliveredSpent += amount;
      old.deliveredSpentCurrency = money.currencyCode || old.deliveredSpentCurrency || "OMR";
      if (!old.lastDeliveredAt || String(order.processedAt || "") > old.lastDeliveredAt) {
        old.lastDeliveredAt = order.processedAt || "";
        old.lastDeliveredOrderName = order.name || "";
      }
      map.set(customerId, old);
    }
    return map;
  }

  function buildSearchQueries(raw) {
    const q = cleanSearch(raw);
    const digits = digitsOnly(q);
    const queries = new Set();

    if (q) queries.add(q);
    if (q.includes("@")) queries.add(`email:${q}`);
    if (digits.length >= 6) {
      queries.add(`phone:${digits}`);
      queries.add(digits);
      if (digits.startsWith("968") && digits.length > 8) {
        queries.add(digits.slice(3));
      }
    }
    if (/^#?\d+$/.test(q)) {
      const orderNo = q.startsWith("#") ? q : `#${q}`;
      queries.add(`name:${orderNo}`);
      queries.add(orderNo);
    }

    return [...queries].filter(Boolean).slice(0, 8);
  }

  function parseOmanExpiresAt(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
    const normalized = raw.includes("T") ? raw : raw.replace(/\s+/, "T");
    const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
      ? `${normalized}:00`
      : normalized;
    const date = new Date(hasTimezone ? withSeconds : `${withSeconds}+04:00`);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Invalid expiresAt");
    }
    return date.toISOString();
  }

  router.get("/customer-credit/search", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const q = cleanSearch(req.query.q);
      if (!q) {
        return res.status(400).json({ error: "اكتب إيميل أو رقم هاتف أو رقم طلب" });
      }

      const queries = buildSearchQueries(q);
      const customers = [];
      const errors = [];

      for (const queryText of queries) {
        try {
          customers.push(...(await searchCustomers(queryText)));
        } catch (e) {
          errors.push(`customers(${queryText}): ${e.message}`);
        }
      }

      for (const queryText of queries) {
        try {
          customers.push(...(await searchOrders(queryText)));
        } catch (e) {
          errors.push(`orders(${queryText}): ${e.message}`);
        }
      }

      const results = uniqueCustomers(customers);
      res.json({
        ok: true,
        query: q,
        count: results.length,
        customers: results,
        warnings: results.length ? [] : errors.slice(0, 3)
      });
    } catch (e) {
      console.error("customer-credit search error", e);
      res.status(500).json({ error: e.message || "Search failed" });
    }
  });

  router.get("/customer-credit/app-customers", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(250, Math.max(1, Number(req.query.limit || 120) || 120));
      const ids = await listAppCustomerIdsFromRedis(limit);
      const customers = await getCustomersByIds(ids);

      res.json({
        ok: true,
        count: customers.length,
        customers
      });
    } catch (e) {
      console.error("customer-credit app-customers error", e);
      res.status(500).json({ error: e.message || "Failed to load app customers" });
    }
  });

  router.get("/customer-credit/top-customers", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(150, Math.max(1, Number(req.query.limit || 80) || 80));
      const orderLimit = Math.min(250, Math.max(50, Number(req.query.orderLimit || 250) || 250));
      const stats = await loadDeliveredCustomerStats(orderLimit);
      const ids = [...stats.keys()];
      const customers = await getCustomersByIds(ids);

      const out = customers.map((customer) => {
        const stat = stats.get(customer.id) || {};
        return {
          ...customer,
          deliveredOrders: stat.deliveredOrders || 0,
          deliveredSpent: Number(stat.deliveredSpent || 0),
          deliveredSpentText: moneyLabel({
            amount: stat.deliveredSpent || 0,
            currencyCode: stat.deliveredSpentCurrency || customer.amountSpent?.currencyCode || "OMR"
          }),
          lastDeliveredOrderName: stat.lastDeliveredOrderName || "",
          lastDeliveredAt: stat.lastDeliveredAt || ""
        };
      }).sort((a, b) => {
        if (b.appInstalled !== a.appInstalled) return b.appInstalled ? 1 : -1;
        if (b.deliveredSpent !== a.deliveredSpent) return b.deliveredSpent - a.deliveredSpent;
        if (b.deliveredOrders !== a.deliveredOrders) return b.deliveredOrders - a.deliveredOrders;
        const rewardsDiff = Number(b.rewards?.points || 0) - Number(a.rewards?.points || 0);
        if (rewardsDiff) return rewardsDiff;
        return amountSpentValue(b) - amountSpentValue(a);
      });

      res.json({ ok: true, count: out.length, customers: out.slice(0, limit) });
    } catch (e) {
      console.error("customer-credit top-customers error", e);
      res.status(500).json({ error: e.message || "Failed to load top customers" });
    }
  });

  router.post("/customer-credit/credit", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const customerId = String(req.body?.customerId || "").trim();
      const amount = Number(req.body?.amount || 0);
      const currencyCode = String(req.body?.currencyCode || "OMR")
        .trim()
        .toUpperCase();
      const expiresAt = String(req.body?.expiresAt || "").trim();
      const notify = req.body?.notify === true;

      if (!customerId.startsWith("gid://shopify/Customer/")) {
        return res.status(400).json({ error: "customerId غير صحيح" });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "المبلغ يجب أن يكون أكبر من صفر" });
      }
      if (!/^[A-Z]{3}$/.test(currencyCode)) {
        return res.status(400).json({ error: "رمز العملة غير صحيح" });
      }

      const creditInput = {
        creditAmount: {
          amount: amount.toFixed(3),
          currencyCode
        }
      };
      if (expiresAt) {
        creditInput.expiresAt = parseOmanExpiresAt(expiresAt);
      }
      if (notify) {
        creditInput.notify = true;
      }

      const mutation = `#graphql
        mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
          storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
            storeCreditAccountTransaction {
              amount {
                amount
                currencyCode
              }
              balanceAfterTransaction {
                amount
                currencyCode
              }
              account {
                id
                balance {
                  amount
                  currencyCode
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = await adminGraphQL(mutation, {
        id: customerId,
        creditInput
      });

      const payload = data?.storeCreditAccountCredit || {};
      const errors = payload.userErrors || [];
      if (errors.length) {
        return res.status(400).json({
          error: errors.map((e) => e.message).filter(Boolean).join(" | "),
          userErrors: errors
        });
      }

      const tx = payload.storeCreditAccountTransaction || null;
      const amountText = moneyLabel(tx?.amount);
      const balanceText = moneyLabel(tx?.balanceAfterTransaction || tx?.account?.balance);
      const push = await sendCustomerCreditPush({
        customerId,
        amountText,
        balanceText
      });

      res.json({
        ok: true,
        transaction: tx,
        amountText,
        balanceText,
        push
      });
    } catch (e) {
      console.error("customer-credit credit error", e);
      res.status(500).json({ error: e.message || "Credit failed" });
    }
  });

  router.post("/customer-credit/debit", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const customerId = String(req.body?.customerId || "").trim();
      const amount = Number(req.body?.amount || 0);
      const currencyCode = String(req.body?.currencyCode || "OMR")
        .trim()
        .toUpperCase();

      if (!customerId.startsWith("gid://shopify/Customer/")) {
        return res.status(400).json({ error: "customerId غير صحيح" });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "المبلغ يجب أن يكون أكبر من صفر" });
      }
      if (!/^[A-Z]{3}$/.test(currencyCode)) {
        return res.status(400).json({ error: "رمز العملة غير صحيح" });
      }

      const customer = await findAdminCustomer({ id: customerId });
      const accounts = customer?.storeCreditAccounts?.nodes || [];
      const account =
        accounts.find((a) => (a?.balance?.currencyCode || currencyCode) === currencyCode) ||
        accounts[0];
      if (!account?.id) {
        return res.status(404).json({ error: "لا يوجد حساب رصيد لهذا العميل" });
      }

      const activeBalance = activeAccountBalance(account);
      if (activeBalance < amount) {
        return res.status(400).json({
          error: `الرصيد غير كاف. المتاح: ${moneyLabel({
            amount: activeBalance,
            currencyCode: account?.balance?.currencyCode || currencyCode
          })}`
        });
      }

      const debitCurrency = account?.balance?.currencyCode || currencyCode;
      const tx = await debitStoreCreditAccount(account.id, amount, debitCurrency);
      const balanceText = moneyLabel(tx?.account?.balance);

      res.json({
        ok: true,
        transaction: tx,
        amountText: moneyLabel({ amount, currencyCode: debitCurrency }),
        balanceText
      });
    } catch (e) {
      console.error("customer-credit debit error", e);
      res.status(500).json({ error: e.message || "Debit failed" });
    }
  });

  return router;
}

export function customerCreditPublicRouter() {
  const router = express.Router();

  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const API_VERSION =
    process.env.SHOPIFY_API_VERSION ||
    process.env.SHOPIFY_GQL_VERSION ||
    "2026-01";
  const CUSTOMER_ACCOUNT_API_VERSION =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION ||
    process.env.SHOPIFY_CUSTOMER_API_VERSION ||
    "2025-07";
  const SHOP_ID =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID ||
    process.env.SHOPIFY_SHOP_ID ||
    DEFAULT_CUSTOMER_ACCOUNT_SHOP_ID;
  let customerAccountGraphqlUrl = "";

  function assertEnv(res) {
    if (!SHOP || !TOKEN) {
      res.status(500).json({ error: "SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN missing" });
      return false;
    }
    return true;
  }

  async function adminGraphQL(query, variables = {}) {
    const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query, variables })
    });
    const text = await r.text();
    const json = JSON.parse(text || "{}");
    if (!r.ok || json?.errors?.length) {
      throw new Error(
        json?.errors?.map((e) => e.message).join(" | ") ||
          `Shopify Admin HTTP ${r.status}`
      );
    }
    return json.data || {};
  }

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

  async function customerAccountGraphQL(customerToken) {
    const url = await getCustomerAccountGraphqlUrl();
    const query = `#graphql
      query CustomerForStoreCredit {
        customer {
          id
          displayName
          emailAddress {
            emailAddress
          }
          phoneNumber {
            phoneNumber
          }
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
    const json = JSON.parse(text || "{}");
    if (!r.ok || json?.errors?.length) {
      throw new Error(
        json?.errors?.map((e) => e.message).join(" | ") ||
          `Shopify Customer Account HTTP ${r.status}`
      );
    }
    return json?.data?.customer || null;
  }

  function moneyNumber(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
  }

  function moneyLabel(money) {
    if (!money) return "0";
    return `${moneyNumber(money.amount).toFixed(3)} ${money.currencyCode || ""}`.trim();
  }

  function isExpired(expiresAt, now = new Date()) {
    if (!expiresAt) return false;
    const time = Date.parse(expiresAt);
    return Number.isFinite(time) && time <= now.getTime();
  }

  function mapTransaction(tx) {
    const expiresAt = tx?.expiresAt || "";
    const remainingAmount = tx?.remainingAmount || null;
    const orderName = tx?.origin?.order?.name || "";
    const rawType = tx?.type || tx?.__typename || "";
    const type =
      String(rawType).includes("Debit") && !orderName ? "revert" : rawType;
    return {
      type,
      amount: tx?.amount || null,
      amountText: moneyLabel(tx?.amount),
      balanceAfterTransaction: tx?.balanceAfterTransaction || null,
      balanceText: moneyLabel(tx?.balanceAfterTransaction),
      createdAt: tx?.createdAt || "",
      expiresAt,
      remainingAmount,
      remainingAmountText: moneyLabel(remainingAmount),
      orderName,
      expired: isExpired(expiresAt)
    };
  }

  function activeAccountBalance(account) {
    const transactions = account?.transactions?.nodes || [];
    let sawCreditRemaining = false;
    let total = 0;
    for (const tx of transactions) {
      const type = String(tx?.__typename || tx?.type || "");
      if (!type.includes("Credit")) continue;
      const remaining = tx?.remainingAmount?.amount;
      if (remaining == null) continue;
      sawCreditRemaining = true;
      if (isExpired(tx?.expiresAt)) continue;
      total += moneyNumber(remaining);
    }
    return sawCreditRemaining ? total : moneyNumber(account?.balance?.amount);
  }

  async function debitStoreCreditAccount(accountId, amount, currencyCode) {
    if (!accountId || !Number.isFinite(amount) || amount <= 0 || !currencyCode) {
      return null;
    }
    const mutation = `#graphql
      mutation StoreCreditAccountDebit($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
        storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
          storeCreditAccountTransaction {
            amount {
              amount
              currencyCode
            }
            account {
              id
              balance {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const data = await adminGraphQL(mutation, {
      id: accountId,
      debitInput: {
        debitAmount: {
          amount: amount.toFixed(3),
          currencyCode
        }
      }
    });
    const payload = data?.storeCreditAccountDebit || {};
    const errors = payload.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).filter(Boolean).join(" | "));
    }
    return payload.storeCreditAccountTransaction || null;
  }

  async function debitExpiredCredits(customer) {
    if (process.env.AUTO_DEBIT_EXPIRED_CUSTOMER_CREDIT !== "true") {
      return [];
    }
    const debits = [];
    const accounts = customer?.storeCreditAccounts?.nodes || [];
    for (const account of accounts) {
      const accountId = account?.id || "";
      const transactions = account?.transactions?.nodes || [];
      for (const tx of transactions) {
        const type = String(tx?.__typename || "");
        if (!type.includes("Credit")) continue;
        if (!isExpired(tx?.expiresAt)) continue;
        const amount = moneyNumber(tx?.remainingAmount?.amount);
        const currencyCode =
          tx?.remainingAmount?.currencyCode ||
          tx?.amount?.currencyCode ||
          account?.balance?.currencyCode;
        if (amount <= 0 || !currencyCode) continue;
        const debit = await debitStoreCreditAccount(accountId, amount, currencyCode);
        debits.push({
          accountId,
          amount,
          currencyCode,
          expiresAt: tx?.expiresAt || "",
          debit
        });
      }
    }
    return debits;
  }

  function extractBearer(req) {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth.toLowerCase().startsWith("bearer ")) return "";
    return auth.slice(7).trim();
  }

  function makeCustomerGid(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("gid://shopify/Customer/")) return raw;
    const numeric = raw.split("/").pop().replace(/\D+/g, "");
    return numeric ? `gid://shopify/Customer/${numeric}` : "";
  }

  async function findAdminCustomer(customer) {
    const id = makeCustomerGid(customer?.id || customer?.customer_id || customer?.customerId);
    const email = String(
      customer?.emailAddress?.emailAddress || customer?.email || ""
    ).trim();

    if (id) {
      const data = await adminGraphQL(
        `#graphql
          query CustomerNode($id: ID!) {
            node(id: $id) {
              ... on Customer {
                id
                displayName
                email
                storeCreditAccounts(first: 10) {
                  nodes {
                    id
                    balance {
                      amount
                      currencyCode
                    }
                    transactions(first: 50, reverse: true) {
                      nodes {
                        __typename
                        amount {
                          amount
                          currencyCode
                        }
                        balanceAfterTransaction {
                          amount
                          currencyCode
                        }
                        createdAt
                        origin {
                          __typename
                          ... on OrderTransaction {
                            order {
                              name
                            }
                          }
                        }
                        ... on StoreCreditAccountCreditTransaction {
                          expiresAt
                          remainingAmount {
                            amount
                            currencyCode
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `,
        { id }
      ).catch(() => null);
      if (data?.node?.id) return data.node;
    }

    if (!email) return null;
    const data = await adminGraphQL(
      `#graphql
        query CustomerByEmail($query: String!) {
          customers(first: 1, query: $query) {
            nodes {
              id
              displayName
              email
              storeCreditAccounts(first: 10) {
                nodes {
                  id
                  balance {
                    amount
                    currencyCode
                  }
                  transactions(first: 50, reverse: true) {
                    nodes {
                      __typename
                      amount {
                        amount
                        currencyCode
                      }
                      balanceAfterTransaction {
                        amount
                        currencyCode
                      }
                      createdAt
                      origin {
                        __typename
                        ... on OrderTransaction {
                          order {
                            name
                          }
                        }
                      }
                      ... on StoreCreditAccountCreditTransaction {
                        expiresAt
                        remainingAmount {
                          amount
                          currencyCode
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { query: `email:${email}` }
    );
    return data?.customers?.nodes?.[0] || null;
  }

  router.get("/customer-credit/balance", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const customerToken = extractBearer(req);
      const fallbackCustomer = {
        id:
          req.query.customer_id ||
          req.query.customerId ||
          req.query.shopify_customer_id ||
          req.headers["x-customer-id"],
        email:
          req.query.email ||
          req.query.customer_email ||
          req.headers["x-customer-email"]
      };

      let customer = null;
      if (customerToken) {
        customer = await customerAccountGraphQL(customerToken).catch((e) => {
          console.warn("customer-credit token lookup failed", e?.message || e);
          return null;
        });
      }
      if (!customer?.id && !fallbackCustomer.id && !fallbackCustomer.email) {
        return res.status(401).json({ error: "Missing customer identity" });
      }

      let adminCustomer = await findAdminCustomer(customer?.id ? customer : fallbackCustomer);
      const expiredDebits = await debitExpiredCredits(adminCustomer);
      if (expiredDebits.length) {
        adminCustomer = await findAdminCustomer(adminCustomer);
      }
      const accounts = adminCustomer?.storeCreditAccounts?.nodes || [];
      const total = accounts.reduce((sum, account) => sum + moneyNumber(account?.balance?.amount), 0);
      const currencyCode =
        accounts.find((a) => a?.balance?.currencyCode)?.balance?.currencyCode ||
        "OMR";

      res.json({
        ok: true,
        customerId: adminCustomer?.id || customer?.id || makeCustomerGid(fallbackCustomer.id),
        displayName: adminCustomer?.displayName || customer?.displayName || "",
        balance: total,
        currencyCode,
        balanceText: moneyLabel({ amount: total, currencyCode }),
        expiredDebits,
        accounts: accounts.map((account) => ({
          id: account?.id || "",
          balance: moneyNumber(account?.balance?.amount),
          rawBalance: moneyNumber(account?.balance?.amount),
          currencyCode: account?.balance?.currencyCode || currencyCode,
          balanceText: moneyLabel({
            amount: moneyNumber(account?.balance?.amount),
            currencyCode: account?.balance?.currencyCode || currencyCode
          }),
          rawBalanceText: moneyLabel(account?.balance),
          transactions: (account?.transactions?.nodes || []).map(mapTransaction)
        }))
      });
    } catch (e) {
      console.error("customer-credit app balance error", e);
      res.status(500).json({ error: e.message || "Balance failed" });
    }
  });

  async function creditStoreCreditCustomer(customerId, amount, currencyCode) {
    if (!customerId || !Number.isFinite(amount) || amount <= 0 || !currencyCode) {
      return null;
    }
    const mutation = `#graphql
      mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            amount {
              amount
              currencyCode
            }
            balanceAfterTransaction {
              amount
              currencyCode
            }
            account {
              id
              balance {
                amount
                currencyCode
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const data = await adminGraphQL(mutation, {
      id: customerId,
      creditInput: {
        creditAmount: {
          amount: amount.toFixed(3),
          currencyCode
        }
      }
    });
    const payload = data?.storeCreditAccountCredit || {};
    const errors = payload.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).filter(Boolean).join(" | "));
    }
    return payload.storeCreditAccountTransaction || null;
  }

  router.post("/customer-credit/transfer", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const customerToken = extractBearer(req);
      if (!customerToken) {
        return res.status(401).json({ error: "Missing customer token" });
      }

      const toEmail = String(req.body?.to || req.body?.email || "")
        .trim()
        .toLowerCase();
      const amount = Number(req.body?.amount || 0);
      const note = String(req.body?.note || "").trim().slice(0, 300);

      if (!toEmail || !toEmail.includes("@")) {
        return res.status(400).json({ error: "Target email is required" });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ error: "Amount must be greater than zero" });
      }

      const sourceCustomerAccount = await customerAccountGraphQL(customerToken);
      if (!sourceCustomerAccount?.id) {
        return res.status(401).json({ error: "Invalid customer token" });
      }

      const sourceEmail = String(
        sourceCustomerAccount?.emailAddress?.emailAddress || ""
      ).toLowerCase();
      if (sourceEmail && sourceEmail === toEmail) {
        return res.status(400).json({ error: "Cannot transfer credit to the same account" });
      }

      const sourceCustomer = await findAdminCustomer(sourceCustomerAccount);
      const targetCustomer = await findAdminCustomer({ email: toEmail });
      if (!sourceCustomer?.id) {
        return res.status(404).json({ error: "Source customer was not found" });
      }
      if (!targetCustomer?.id) {
        return res.status(404).json({ error: "Target customer was not found" });
      }

      const sourceAccounts = sourceCustomer?.storeCreditAccounts?.nodes || [];
      const sourceAccount = sourceAccounts.find((account) => activeAccountBalance(account) >= amount);
      if (!sourceAccount?.id) {
        return res.status(400).json({ error: "Insufficient active credit balance" });
      }

      const currencyCode = sourceAccount?.balance?.currencyCode || "OMR";
      const debit = await debitStoreCreditAccount(sourceAccount.id, amount, currencyCode);
      const credit = await creditStoreCreditCustomer(targetCustomer.id, amount, currencyCode);

      res.json({
        ok: true,
        type: "customer_credit_transfer",
        amountText: moneyLabel({ amount, currencyCode }),
        fromCustomerId: sourceCustomer.id,
        toCustomerId: targetCustomer.id,
        toEmail,
        note,
        debit,
        credit
      });
    } catch (e) {
      console.error("customer-credit transfer error", e);
      res.status(500).json({ error: e.message || "Transfer failed" });
    }
  });

  return router;
}
