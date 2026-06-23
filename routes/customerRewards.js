import express from "express";
import fetch from "node-fetch";

const DEFAULT_SETTINGS = {
  enabled: true,
  earnPointsPerCurrency: 10,
  redeemPointsPerCurrency: 100,
  currencyCode: "OMR",
  minRedeemPoints: 100,
  maxRedeemPercent: 30,
  earnOnStatuses: ["paid", "delivered", "fulfilled"]
};

const REFERRAL_REWARD_POINTS = 500;

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

function pointsNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function moneyNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function nowIso() {
  return new Date().toISOString();
}

function rewardsKeys(customerId) {
  const id = normalizeCustomerId(customerId);
  const numeric = customerNumericId(id);
  return {
    id,
    numeric,
    balance: `bt:rewards:customer:${numeric}:balance`,
    ledger: `bt:rewards:customer:${numeric}:ledger`,
    customerIndex: "bt:rewards:customers",
    settings: "bt:rewards:settings:v1",
    tx: (txId) => `bt:rewards:tx:${String(txId || "").trim()}`
  };
}

function referralCodeKey(code) {
  return `bt:rewards:referral:code:${String(code || "").trim().toUpperCase()}`;
}

function referralCustomerKeys(customerId) {
  const id = normalizeCustomerId(customerId);
  const numeric = customerNumericId(id);
  return {
    id,
    numeric,
    code: `bt:rewards:referral:customer:${numeric}:code`,
    referredBy: `bt:rewards:referral:customer:${numeric}:referred-by`,
    invited: `bt:rewards:referral:customer:${numeric}:invited`,
    completed: `bt:rewards:referral:customer:${numeric}:completed`
  };
}

function cleanReferralCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function makeReferralCode(customerId) {
  const numeric = customerNumericId(customerId);
  const tail = numeric ? Number(numeric.slice(-8)).toString(36).toUpperCase() : "BT";
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `BT${tail}${random}`.slice(0, 14);
}

async function ensureReferralCode(redis, customerId) {
  const keys = referralCustomerKeys(customerId);
  if (!keys.numeric) {
    const err = new Error("customerId_required");
    err.status = 400;
    throw err;
  }

  const existing = cleanReferralCode(await redis.get(keys.code).catch(() => ""));
  if (existing) return existing;

  for (let i = 0; i < 8; i += 1) {
    const code = makeReferralCode(keys.id);
    const stored = await redis.set(referralCodeKey(code), keys.id, { NX: true, EX: 60 * 60 * 24 * 365 * 3 });
    if (stored) {
      await redis.set(keys.code, code);
      return code;
    }
  }

  const err = new Error("could_not_create_referral_code");
  err.status = 500;
  throw err;
}

async function getReferralSummary(redis, customerId) {
  const keys = referralCustomerKeys(customerId);
  const code = await ensureReferralCode(redis, keys.id);
  const [invitedCount, completedCount] = await Promise.all([
    redis.sCard(keys.invited).catch(() => 0),
    redis.sCard(keys.completed).catch(() => 0)
  ]);
  return {
    ok: true,
    customerId: keys.id,
    code,
    link: `https://app.halabt.com/invite/${encodeURIComponent(code)}`,
    invitedCount: Number(invitedCount || 0),
    completedCount: Number(completedCount || 0),
    pointsPerReferral: REFERRAL_REWARD_POINTS
  };
}

async function acceptReferral(redis, { code, customerId }) {
  const referralCode = cleanReferralCode(code);
  const referred = referralCustomerKeys(customerId);
  if (!referralCode || !referred.numeric) {
    const err = new Error("referral_code_and_customer_required");
    err.status = 400;
    throw err;
  }

  const referrerId = normalizeCustomerId(await redis.get(referralCodeKey(referralCode)).catch(() => ""));
  const referrer = referralCustomerKeys(referrerId);
  if (!referrer.numeric) {
    const err = new Error("referral_code_not_found");
    err.status = 404;
    throw err;
  }
  if (referrer.numeric === referred.numeric) {
    return { ok: false, skipped: "self_referral" };
  }

  const existing = await redis.get(referred.referredBy).catch(() => "");
  if (existing) {
    return {
      ok: true,
      alreadyLinked: true,
      referrerCustomerId: normalizeCustomerId(existing)
    };
  }

  await redis.set(referred.referredBy, referrer.id);
  await redis.sAdd(referrer.invited, referred.numeric);
  return { ok: true, referrerCustomerId: referrer.id, referredCustomerId: referred.id };
}

function referralOrderKey(orderId) {
  const numeric = orderNumericId(orderId);
  return numeric ? `bt:rewards:referral:order:${numeric}:awards` : "";
}

function normalizeOrderId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://shopify/Order/")) return raw;
  const numeric = raw.replace(/\D+/g, "");
  return numeric ? `gid://shopify/Order/${numeric}` : raw;
}

function orderNumericId(value) {
  const gid = normalizeOrderId(value);
  return gid.includes("/") ? gid.split("/").pop() || gid : gid;
}

function rewardOrderKeys(orderId) {
  const id = normalizeOrderId(orderId);
  const numeric = orderNumericId(id);
  return {
    id,
    numeric,
    state: `bt:rewards:order:${numeric}:state`
  };
}

function normalizeProductId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gid://shopify/Product/")) return raw;
  const numeric = raw.replace(/\D+/g, "");
  return numeric ? `gid://shopify/Product/${numeric}` : raw;
}

function productNumericId(value) {
  const gid = normalizeProductId(value);
  return gid.includes("/") ? gid.split("/").pop() || gid : gid;
}

function safeEmailKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.@-]+/g, "");
}

function reviewRewardKeys(reviewId) {
  const id = String(reviewId || "").trim();
  return {
    state: `bt:rewards:review:${id}:state`,
    tx: `review:${id}`
  };
}

function orderReviewIndexKey(orderId) {
  const numeric = orderNumericId(orderId);
  return numeric ? `bt:rewards:order:${numeric}:review-rewards` : "";
}

function reviewAbuseKey(customerId, email) {
  const customer = customerNumericId(customerId);
  if (customer) return `bt:rewards:review-abuse:customer:${customer}`;
  const emailKey = safeEmailKey(email);
  return emailKey ? `bt:rewards:review-abuse:email:${emailKey}` : "";
}

async function getSettings(redis) {
  const raw = await redis.hGetAll("bt:rewards:settings:v1").catch(() => ({}));
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    enabled: raw.enabled == null ? DEFAULT_SETTINGS.enabled : raw.enabled === "true",
    earnPointsPerCurrency:
      Number(raw.earnPointsPerCurrency ?? DEFAULT_SETTINGS.earnPointsPerCurrency) ||
      DEFAULT_SETTINGS.earnPointsPerCurrency,
    redeemPointsPerCurrency:
      Number(raw.redeemPointsPerCurrency ?? DEFAULT_SETTINGS.redeemPointsPerCurrency) ||
      DEFAULT_SETTINGS.redeemPointsPerCurrency,
    minRedeemPoints:
      Number(raw.minRedeemPoints ?? DEFAULT_SETTINGS.minRedeemPoints) ||
      DEFAULT_SETTINGS.minRedeemPoints,
    maxRedeemPercent:
      Number(raw.maxRedeemPercent ?? DEFAULT_SETTINGS.maxRedeemPercent) ||
      DEFAULT_SETTINGS.maxRedeemPercent,
    earnOnStatuses: raw.earnOnStatuses
      ? String(raw.earnOnStatuses).split(",").map((x) => x.trim()).filter(Boolean)
      : DEFAULT_SETTINGS.earnOnStatuses
  };
}

async function saveSettings(redis, body = {}) {
  const next = {
    ...DEFAULT_SETTINGS,
    ...body
  };
  const payload = {
    enabled: String(next.enabled !== false && next.enabled !== "false"),
    earnPointsPerCurrency: String(
      Number(next.earnPointsPerCurrency) || DEFAULT_SETTINGS.earnPointsPerCurrency
    ),
    redeemPointsPerCurrency: String(
      Number(next.redeemPointsPerCurrency) || DEFAULT_SETTINGS.redeemPointsPerCurrency
    ),
    currencyCode: String(next.currencyCode || DEFAULT_SETTINGS.currencyCode),
    minRedeemPoints: String(Number(next.minRedeemPoints) || DEFAULT_SETTINGS.minRedeemPoints),
    maxRedeemPercent: String(Number(next.maxRedeemPercent) || DEFAULT_SETTINGS.maxRedeemPercent),
    earnOnStatuses: Array.isArray(next.earnOnStatuses)
      ? next.earnOnStatuses.join(",")
      : String(next.earnOnStatuses || DEFAULT_SETTINGS.earnOnStatuses.join(","))
  };
  await redis.hSet("bt:rewards:settings:v1", payload);
  return getSettings(redis);
}

async function readBalance(redis, customerId) {
  const keys = rewardsKeys(customerId);
  const raw = await redis.get(keys.balance);
  return pointsNumber(raw);
}

async function customerUsesApp(redis, customerId) {
  const numeric = customerNumericId(customerId);
  if (!numeric) return false;
  const direct =
    (await redis.get(`bt:user:push:${numeric}`).catch(() => "")) ||
    (await redis.get(`bt:user:push:${normalizeCustomerId(customerId)}`).catch(() => ""));
  if (direct) return true;
  const locale =
    (await redis.get(`bt:user:push-locale:${numeric}`).catch(() => "")) ||
    (await redis.get(`bt:user:currency:${numeric}`).catch(() => ""));
  return !!locale;
}

async function addLedger(redis, customerId, entry) {
  const keys = rewardsKeys(customerId);
  const row = {
    id: entry.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    customerId: keys.id,
    customerNumericId: keys.numeric,
    createdAt: entry.createdAt || nowIso(),
    type: entry.type || "adjust",
    points: pointsNumber(entry.points),
    balanceAfter: pointsNumber(entry.balanceAfter),
    orderId: String(entry.orderId || ""),
    orderName: String(entry.orderName || ""),
    reason: String(entry.reason || ""),
    note: String(entry.note || ""),
    meta: entry.meta || {}
  };
  await redis.lPush(keys.ledger, JSON.stringify(row));
  await redis.lTrim(keys.ledger, 0, 499);
  await redis.sAdd(keys.customerIndex, keys.numeric);
  return row;
}

async function movePoints(redis, {
  customerId,
  points,
  type,
  reason,
  orderId,
  orderName,
  note,
  txId,
  meta,
  allowNegative = false
}) {
  const keys = rewardsKeys(customerId);
  if (!keys.numeric) {
    const err = new Error("customerId is required");
    err.status = 400;
    throw err;
  }

  const amount = pointsNumber(points);
  if (!amount) {
    const err = new Error("points must be non-zero");
    err.status = 400;
    throw err;
  }

  if (amount > 0 && meta?.source !== "admin" && !(await customerUsesApp(redis, keys.id))) {
    return {
      ok: true,
      skipped: "customer_not_app_user",
      customerId: keys.id,
      balance: await readBalance(redis, keys.id)
    };
  }

  if (txId) {
    const txKey = keys.tx(txId);
    const exists = await redis.get(txKey);
    if (exists) {
      return JSON.parse(exists);
    }
  }

  const before = await readBalance(redis, keys.id);
  const after = before + amount;
  if (after < 0 && !allowNegative) {
    const err = new Error("not_enough_points");
    err.status = 409;
    err.details = { before, requested: Math.abs(amount) };
    throw err;
  }

  await redis.set(keys.balance, String(after));
  const row = await addLedger(redis, keys.id, {
    type,
    points: amount,
    balanceAfter: after,
    reason,
    orderId,
    orderName,
    note,
    meta
  });
  const out = { ok: true, customerId: keys.id, balance: after, transaction: row };

  if (txId) {
    await redis.set(keys.tx(txId), JSON.stringify(out), { EX: 60 * 60 * 24 * 90 });
  }

  return out;
}

async function readLedger(redis, customerId, limit = 50) {
  const keys = rewardsKeys(customerId);
  const rows = await redis.lRange(keys.ledger, 0, Math.max(0, Math.min(Number(limit) || 50, 200) - 1));
  return rows.map((row) => {
    try {
      return JSON.parse(row);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function rewardValue(points, settings) {
  const p = pointsNumber(points);
  const rate = Number(settings.redeemPointsPerCurrency || 0) || DEFAULT_SETTINGS.redeemPointsPerCurrency;
  return p / rate;
}

function moneyLabel(amount, currencyCode) {
  return `${moneyNumber(amount).toFixed(3)} ${currencyCode || ""}`.trim();
}

async function shopifyGraphQL(query, variables = {}) {
  const shop = String(process.env.SHOPIFY_SHOP || "").trim();
  const token = String(process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
  const apiVersion =
    process.env.SHOPIFY_API_VERSION ||
    process.env.SHOPIFY_GQL_VERSION ||
    "2026-01";

  if (!shop || !token) {
    const err = new Error("SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN missing");
    err.status = 500;
    throw err;
  }

  const res = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });
  const text = await res.text();
  const json = JSON.parse(text || "{}");
  if (!res.ok || json?.errors?.length) {
    const err = new Error(
      json?.errors?.map((e) => e.message).join(" | ") ||
        `Shopify GraphQL HTTP ${res.status}`
    );
    err.status = 500;
    throw err;
  }
  return json.data || {};
}

function cleanAdminSearch(value) {
  return String(value || "")
    .replace(/["\\(){}[\]<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

async function fetchRewardCustomers(ids = []) {
  const cleanIds = ids
    .map((id) => normalizeCustomerId(id))
    .filter((id) => id.startsWith("gid://shopify/Customer/"));
  const map = new Map();
  for (let i = 0; i < cleanIds.length; i += 25) {
    const chunk = cleanIds.slice(i, i + 25);
    const data = await shopifyGraphQL(
      `#graphql
        query RewardCustomers($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Customer {
              id
              displayName
              firstName
              lastName
              email
              phone
              numberOfOrders
              amountSpent { amount currencyCode }
            }
          }
        }
      `,
      { ids: chunk }
    );
    for (const customer of data?.nodes || []) {
      if (customer?.id) map.set(customer.id, customer);
    }
  }
  return map;
}

function rewardCustomerMatches(row, q) {
  if (!q) return true;
  const haystack = [
    row.customerId,
    row.customerNumericId,
    row.displayName,
    row.email,
    row.phone,
    row.lastOrderName,
    row.lastReason
  ].join(" ").toLowerCase();
  return haystack.includes(q);
}

async function creditCustomerStoreCredit(customerId, amount, currencyCode) {
  const customerGid = normalizeCustomerId(customerId);
  const query = `
    mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
      storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
        storeCreditAccountTransaction {
          amount { amount currencyCode }
          balanceAfterTransaction { amount currencyCode }
        }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphQL(query, {
    id: customerGid,
    creditInput: {
      creditAmount: {
        amount: String(Number(amount || 0).toFixed(3)),
        currencyCode: currencyCode || "OMR"
      }
    }
  });
  const out = data?.storeCreditAccountCredit;
  const errors = out?.userErrors || [];
  if (errors.length) {
    const err = new Error(errors.map((e) => e.message).join(" | "));
    err.status = 400;
    throw err;
  }
  return out?.storeCreditAccountTransaction || null;
}

function earnedPoints(orderAmount, settings) {
  const amount = moneyNumber(orderAmount);
  const rate = Number(settings.earnPointsPerCurrency || 0) || DEFAULT_SETTINGS.earnPointsPerCurrency;
  return Math.floor(amount * rate);
}

function pickOrderAmount(order) {
  return moneyNumber(
    order?.currentTotalPriceSet?.shopMoney?.amount ??
      order?.totalPriceSet?.shopMoney?.amount ??
      order?.current_total_price ??
      order?.total_price ??
      order?.total
  );
}

function pickOrderCurrency(order, fallback = "OMR") {
  return String(
    order?.currentTotalPriceSet?.shopMoney?.currencyCode ??
      order?.totalPriceSet?.shopMoney?.currencyCode ??
      order?.currency ??
      order?.currencyCode ??
      fallback
  );
}

function pickOrderCustomerId(order) {
  return normalizeCustomerId(
    order?.customer?.id ??
      order?.customer?.admin_graphql_api_id ??
      order?.customer_id ??
      ""
  );
}

async function fetchOrderForRewards(orderId, gql = shopifyGraphQL) {
  const id = normalizeOrderId(orderId);
  if (!id) {
    const err = new Error("orderId is required");
    err.status = 400;
    throw err;
  }

  const query = `
    query RewardsOrder($id: ID!) {
      order(id: $id) {
        id
        name
        cancelledAt
        cancelReason
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id }
        fulfillments(first: 10) {
          events(first: 10, sortKey: HAPPENED_AT, reverse: true) {
            nodes { status }
          }
        }
      }
    }
  `;
  const data = await gql(query, { id });
  const order = data?.order;
  if (!order) {
    const err = new Error("order_not_found");
    err.status = 404;
    throw err;
  }
  return order;
}

async function awardReferralForDeliveredOrder({
  redis,
  order,
  orderId,
  shopifyGraphQL: gql = shopifyGraphQL,
  source = "delivery"
}) {
  if (!redis) return { ok: false, skipped: "redis_not_ready" };

  const fetchedOrder = order || await fetchOrderForRewards(orderId, gql);
  if (!fetchedOrder || fetchedOrder.cancelledAt) {
    return { ok: true, skipped: "order_cancelled_or_missing" };
  }

  const referredCustomerId = pickOrderCustomerId(fetchedOrder);
  const referred = referralCustomerKeys(referredCustomerId);
  if (!referred.numeric) return { ok: true, skipped: "no_referred_customer" };

  const referrerId = normalizeCustomerId(await redis.get(referred.referredBy).catch(() => ""));
  const referrer = referralCustomerKeys(referrerId);
  if (!referrer.numeric || referrer.numeric === referred.numeric) {
    return { ok: true, skipped: "no_referrer" };
  }

  const orderKeys = rewardOrderKeys(fetchedOrder.id || orderId);
  const awardStateKey = `bt:rewards:referral:referred:${referred.numeric}:award`;
  const existingAward = await redis.hGetAll(awardStateKey).catch(() => ({}));
  if (existingAward?.status === "awarded") {
    return { ok: true, changed: false, skipped: "already_awarded", state: existingAward };
  }

  const orderName = String(fetchedOrder?.name || "").replace(/^#+/, "");
  const out = await movePoints(redis, {
    customerId: referrer.id,
    points: REFERRAL_REWARD_POINTS,
    type: "referral_earn",
    reason: "referral_delivered_order",
    orderId: orderKeys.id,
    orderName,
    txId: `referral:${referred.numeric}:${orderKeys.numeric}`,
    meta: {
      referredCustomerId: referred.id,
      referrerCustomerId: referrer.id,
      orderName,
      source
    }
  });

  await redis.hSet(awardStateKey, {
    status: "awarded",
    referrerCustomerId: referrer.id,
    referredCustomerId: referred.id,
    orderId: orderKeys.id,
    orderNumericId: orderKeys.numeric,
    orderName,
    points: String(REFERRAL_REWARD_POINTS),
    transactionId: String(out?.transaction?.id || ""),
    source,
    updatedAt: nowIso()
  });
  await redis.sAdd(referrer.completed, referred.numeric).catch(() => {});
  if (orderKeys.numeric) {
    await redis.sAdd(referralOrderKey(orderKeys.id), referred.numeric).catch(() => {});
  }

  return { ...out, changed: true, referral: true, referrerCustomerId: referrer.id, referredCustomerId: referred.id };
}

async function reverseReferralRewardsForOrder({ redis, orderId, source = "cancel" }) {
  if (!redis) return { ok: false, skipped: "redis_not_ready" };
  const orderKeys = rewardOrderKeys(orderId);
  const indexKey = referralOrderKey(orderKeys.id || orderId);
  if (!indexKey) return { ok: true, changed: false, reversed: [] };

  const referredIds = await redis.sMembers(indexKey).catch(() => []);
  const reversed = [];
  for (const referredNumeric of referredIds) {
    const referredId = normalizeCustomerId(referredNumeric);
    const referred = referralCustomerKeys(referredId);
    const awardStateKey = `bt:rewards:referral:referred:${referred.numeric}:award`;
    const state = await redis.hGetAll(awardStateKey).catch(() => ({}));
    if (state?.status !== "awarded") continue;
    const points = pointsNumber(state.points || REFERRAL_REWARD_POINTS);
    const referrerCustomerId = normalizeCustomerId(state.referrerCustomerId);
    if (!points || !referrerCustomerId) continue;

    const out = await movePoints(redis, {
      customerId: referrerCustomerId,
      points: -Math.abs(points),
      type: "referral_reverse",
      reason: "referral_order_cancelled",
      orderId: state.orderId || orderKeys.id,
      orderName: state.orderName || "",
      txId: `referral-cancel:${referred.numeric}:${orderKeys.numeric}:${points}`,
      allowNegative: true,
      meta: {
        referredCustomerId: referred.id,
        source
      }
    });
    await redis.hSet(awardStateKey, {
      ...state,
      status: "cancelled",
      reversedAt: nowIso(),
      reverseSource: source
    });
    reversed.push(out.transaction);
  }

  return { ok: true, changed: reversed.length > 0, reversed };
}

function orderHasDeliveredEvent(order) {
  const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
  return fulfillments.some((fulfillment) => {
    const nodes = Array.isArray(fulfillment?.events?.nodes)
      ? fulfillment.events.nodes
      : [];
    return nodes.some((event) => String(event?.status || "").toUpperCase() === "DELIVERED");
  });
}

function orderLineProductIds(order) {
  const nodes = Array.isArray(order?.lineItems?.nodes) ? order.lineItems.nodes : [];
  const ids = new Set();
  for (const item of nodes) {
    const productId = item?.product?.id || item?.productId || "";
    const numeric = productNumericId(productId);
    if (numeric) {
      ids.add(numeric);
      ids.add(`gid://shopify/Product/${numeric}`);
    }
  }
  return ids;
}

function orderMatchesProduct(order, productId) {
  const numeric = productNumericId(productId);
  if (!numeric) return false;
  const ids = orderLineProductIds(order);
  return ids.has(numeric) || ids.has(`gid://shopify/Product/${numeric}`);
}

async function fetchOrderForReview(orderRef, gql = shopifyGraphQL) {
  const raw = String(orderRef || "").trim();
  if (!raw) return null;

  const fragment = `
    id
    name
    cancelledAt
    displayFulfillmentStatus
    customer { id email }
    fulfillments(first: 10) {
      events(first: 10, sortKey: HAPPENED_AT, reverse: true) {
        nodes { status }
      }
    }
    lineItems(first: 100) {
      nodes {
        title
        product { id }
      }
    }
  `;

  if (raw.startsWith("gid://shopify/Order/")) {
    const data = await gql(`query ReviewOrderById($id: ID!) { order(id: $id) { ${fragment} } }`, {
      id: raw
    });
    return data?.order || null;
  }

  const name = raw.replace(/^#+/, "");
  const queries = [`name:#${name}`, `name:${name}`];
  for (const query of queries) {
    const data = await gql(
      `query ReviewOrderByName($query: String!) { orders(first: 1, query: $query) { nodes { ${fragment} } } }`,
      { query }
    );
    const order = data?.orders?.nodes?.[0];
    if (order) return order;
  }

  return null;
}

async function fetchCustomerByEmail(email, gql = shopifyGraphQL) {
  const safe = safeEmailKey(email);
  if (!safe) return "";
  const data = await gql(
    `query ReviewCustomerByEmail($query: String!) { customers(first: 1, query: $query) { nodes { id } } }`,
    { query: `email:${safe}` }
  ).catch(() => null);
  return normalizeCustomerId(data?.customers?.nodes?.[0]?.id || "");
}

export async function prepareReviewReward({
  redis,
  productId,
  orderId,
  email,
  rating,
  photoCount = 0,
  shopifyGraphQL: gql = shopifyGraphQL
}) {
  const ratingInt = pointsNumber(rating);
  const photos = Math.max(0, pointsNumber(photoCount));
  const productGid = normalizeProductId(productId);
  const order = orderId ? await fetchOrderForReview(orderId, gql).catch(() => null) : null;
  const delivered =
    !!order &&
    !order.cancelledAt &&
    (String(order.displayFulfillmentStatus || "").toUpperCase() === "DELIVERED" ||
      orderHasDeliveredEvent(order));
  const deliveredProduct = delivered && orderMatchesProduct(order, productGid);
  const customerId =
    normalizeCustomerId(order?.customer?.id || "") ||
    (await fetchCustomerByEmail(email, gql).catch(() => ""));
  const negative = ratingInt > 0 && ratingInt <= 2;
  const abuseKey = reviewAbuseKey(customerId, email);
  const previousAbuse = abuseKey && redis ? pointsNumber(await redis.get(abuseKey).catch(() => "0")) : 0;

  if (!deliveredProduct && negative && previousAbuse >= 3) {
    const err = new Error("review_blocked_negative_unverified");
    err.status = 429;
    err.reviewBlocked = true;
    throw err;
  }

  const points = deliveredProduct ? (photos > 0 ? 20 : 10) : 1;
  return {
    customerId,
    productId: productGid,
    orderId: order?.id || normalizeOrderId(orderId),
    orderName: String(order?.name || orderId || ""),
    deliveredProduct,
    negative,
    abuseKey,
    points
  };
}

export async function awardReviewRewards({
  redis,
  reviewContext,
  reviewId,
  productId,
  orderId,
  productName,
  email,
  rating,
  photoCount = 0,
  shopifyGraphQL: gql = shopifyGraphQL
}) {
  if (!redis) return { ok: true, skipped: "redis_not_ready" };
  const ctx =
    reviewContext ||
    (await prepareReviewReward({
      redis,
      productId,
      orderId,
      email,
      rating,
      photoCount,
      shopifyGraphQL: gql
    }));

  if (!ctx.customerId) return { ok: true, skipped: "no_customer" };

  if (ctx.negative && !ctx.deliveredProduct && ctx.abuseKey) {
    await redis.incr(ctx.abuseKey).catch(() => {});
    await redis.expire(ctx.abuseKey, 60 * 60 * 24 * 365).catch(() => {});
  }

  const keys = reviewRewardKeys(reviewId);
  const result = await movePoints(redis, {
    customerId: ctx.customerId,
    points: ctx.points,
    type: ctx.deliveredProduct ? "review_verified_earn" : "review_unverified_earn",
    reason: ctx.deliveredProduct ? "verified_product_review" : "product_review",
    orderId: ctx.orderId,
    orderName: ctx.orderName,
    txId: keys.tx,
    meta: {
      reviewId,
      productId: ctx.productId || normalizeProductId(productId),
      productName: String(productName || ""),
      rating: pointsNumber(rating),
      photoCount: Math.max(0, pointsNumber(photoCount)),
      deliveredProduct: !!ctx.deliveredProduct
    }
  });

  await redis.hSet(keys.state, {
    reviewId: String(reviewId || ""),
    customerId: normalizeCustomerId(ctx.customerId),
    points: String(ctx.points),
    orderId: String(ctx.orderId || ""),
    orderName: String(ctx.orderName || ""),
    productId: String(ctx.productId || normalizeProductId(productId)),
    productName: String(productName || ""),
    status: "active",
    updatedAt: nowIso()
  }).catch(() => {});

  const indexKey = orderReviewIndexKey(ctx.orderId);
  if (indexKey) {
    await redis.sAdd(indexKey, String(reviewId || "")).catch(() => {});
    await redis.expire(indexKey, 60 * 60 * 24 * 365).catch(() => {});
  }

  return { ...result, reviewPoints: ctx.points, reviewContext: ctx };
}

export async function reverseOrderReviewRewards({
  redis,
  orderId,
  source = "cancel"
}) {
  if (!redis) return { ok: true, skipped: "redis_not_ready" };
  const indexKey = orderReviewIndexKey(orderId);
  if (!indexKey) return { ok: true, changed: false, skipped: "no_order" };

  const reviewIds = await redis.sMembers(indexKey).catch(() => []);
  let reversedPoints = 0;
  const reversed = [];
  for (const reviewId of reviewIds) {
    const keys = reviewRewardKeys(reviewId);
    const state = await redis.hGetAll(keys.state).catch(() => ({}));
    const points = pointsNumber(state.points);
    const customerId = normalizeCustomerId(state.customerId);
    if (!points || !customerId || state.status === "cancelled") continue;
    const out = await movePoints(redis, {
      customerId,
      points: -Math.abs(points),
      type: "review_reverse",
      reason: "cancelled_order_review_reward",
      orderId: state.orderId || orderId,
      orderName: state.orderName || "",
      txId: `cancel-review:${reviewId}:${points}`,
      allowNegative: true,
      meta: {
        reviewId,
        productId: state.productId || "",
        productName: state.productName || "",
        source
      }
    });
    await redis.hSet(keys.state, {
      points: "0",
      status: "cancelled",
      updatedAt: nowIso()
    }).catch(() => {});
    reversedPoints += Math.abs(points);
    reversed.push(out.transaction);
  }

  return { ok: true, changed: reversedPoints > 0, reversedPoints, reversed };
}

export async function syncDeliveredOrderRewards({
  redis,
  orderId,
  order,
  shopifyGraphQL: gql = shopifyGraphQL,
  forceDelivered = false,
  source = "delivery"
}) {
  if (!redis) {
    const err = new Error("redis_not_ready");
    err.status = 500;
    throw err;
  }

  const settings = await getSettings(redis);
  if (!settings.enabled) return { ok: true, skipped: "rewards_disabled" };

  const fetchedOrder = order || await fetchOrderForRewards(orderId, gql);
  if (fetchedOrder?.cancelledAt) {
    return reverseOrderRewards({
      redis,
      orderId: fetchedOrder.id || orderId,
      customerId: pickOrderCustomerId(fetchedOrder),
      source: "cancelled_delivered_sync"
    });
  }

  const delivered =
    forceDelivered ||
    String(fetchedOrder?.displayFulfillmentStatus || "").toUpperCase() === "DELIVERED" ||
    orderHasDeliveredEvent(fetchedOrder);

  if (!delivered) return { ok: true, skipped: "not_delivered" };

  const customerId = pickOrderCustomerId(fetchedOrder);
  if (!customerId) return { ok: true, skipped: "no_customer" };

  const amount = pickOrderAmount(fetchedOrder);
  const targetPoints = earnedPoints(amount, settings);
  const keys = rewardOrderKeys(fetchedOrder.id || orderId);
  const previous = await redis.hGetAll(keys.state).catch(() => ({}));
  const previousPoints = pointsNumber(previous.points);
  const delta = targetPoints - previousPoints;

  if (!delta) {
    await redis.hSet(keys.state, {
      orderId: keys.id,
      orderNumericId: keys.numeric,
      customerId,
      points: String(targetPoints),
      orderAmount: String(amount),
      currencyCode: pickOrderCurrency(fetchedOrder, settings.currencyCode),
      orderName: String(fetchedOrder?.name || ""),
      status: "delivered",
      source,
      updatedAt: nowIso()
    });
    const referralReward = await awardReferralForDeliveredOrder({
      redis,
      order: fetchedOrder,
      orderId: keys.id,
      shopifyGraphQL: gql,
      source
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
    return { ok: true, changed: !!referralReward?.changed, customerId, orderId: keys.id, points: targetPoints, referralReward };
  }

  const result = await movePoints(redis, {
    customerId,
    points: delta,
    type: delta > 0 ? "order_earn" : "order_adjust",
    reason: "delivered_order_reward",
    orderId: keys.id,
    orderName: String(fetchedOrder?.name || ""),
    txId: `delivered:${keys.numeric}:${previousPoints}->${targetPoints}`,
    allowNegative: delta < 0,
    meta: {
      orderAmount: amount,
      orderName: String(fetchedOrder?.name || ""),
      previousPoints,
      targetPoints,
      earnPointsPerCurrency: settings.earnPointsPerCurrency,
      source
    }
  });

  await redis.hSet(keys.state, {
    orderId: keys.id,
    orderNumericId: keys.numeric,
    customerId,
    points: String(targetPoints),
    orderAmount: String(amount),
    currencyCode: pickOrderCurrency(fetchedOrder, settings.currencyCode),
    orderName: String(fetchedOrder?.name || ""),
    status: "delivered",
    source,
    updatedAt: nowIso()
  });

  return {
    ...result,
    orderId: keys.id,
    orderAmount: amount,
    previousPoints,
    targetPoints,
    delta,
    referralReward: await awardReferralForDeliveredOrder({
      redis,
      order: fetchedOrder,
      orderId: keys.id,
      shopifyGraphQL: gql,
      source
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }))
  };
}

export async function reverseOrderRewards({
  redis,
  orderId,
  customerId,
  source = "cancel"
}) {
  if (!redis) {
    const err = new Error("redis_not_ready");
    err.status = 500;
    throw err;
  }

  const keys = rewardOrderKeys(orderId);
  const previous = await redis.hGetAll(keys.state).catch(() => ({}));
  const previousPoints = pointsNumber(previous.points);
  const resolvedCustomerId = normalizeCustomerId(customerId || previous.customerId);

  if (!previousPoints || !resolvedCustomerId) {
    if (keys.numeric) {
      await redis.hSet(keys.state, {
        orderId: keys.id,
        orderNumericId: keys.numeric,
        customerId: resolvedCustomerId || "",
        points: "0",
        status: "cancelled",
        source,
        updatedAt: nowIso()
      });
    }
    const reviewReverse = await reverseOrderReviewRewards({
      redis,
      orderId: keys.id || orderId,
      source
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
    const referralReverse = await reverseReferralRewardsForOrder({
      redis,
      orderId: keys.id || orderId,
      source
    }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
    return { ok: true, changed: !!(reviewReverse?.changed || referralReverse?.changed), skipped: "no_points_to_reverse", reviewReverse, referralReverse };
  }

  const out = await movePoints(redis, {
    customerId: resolvedCustomerId,
    points: -Math.abs(previousPoints),
    type: "order_reverse",
    reason: "cancelled_order_reward",
    orderId: keys.id,
    txId: `cancel:${keys.numeric}:${previousPoints}`,
    allowNegative: true,
    meta: {
      previousPoints,
      source
    }
  });

  await redis.hSet(keys.state, {
    orderId: keys.id,
    orderNumericId: keys.numeric,
    customerId: resolvedCustomerId,
    points: "0",
    status: "cancelled",
    source,
    updatedAt: nowIso()
  });

  const reviewReverse = await reverseOrderReviewRewards({
    redis,
    orderId: keys.id || orderId,
    source
  }).catch((e) => ({ ok: false, error: e?.message || String(e) }));
  const referralReverse = await reverseReferralRewardsForOrder({
    redis,
    orderId: keys.id || orderId,
    source
  }).catch((e) => ({ ok: false, error: e?.message || String(e) }));

  return { ...out, reversedPoints: previousPoints, orderId: keys.id, reviewReverse, referralReverse };
}

export default function customerRewardsRouter(deps = {}) {
  const router = express.Router();
  const getRedis = deps.getRedis;
  const getFirebaseAdmin = deps.getFirebaseAdmin;

  async function saveAndSendAdminAdjustNotification(redis, {
    customerId,
    points,
    balanceAfter
  }) {
    const numericId = customerNumericId(customerId);
    if (!redis || !numericId || !points) return;

    const locale = String(
      (await redis.get(`bt:user:push-locale:${numericId}`).catch(() => "")) || ""
    ).toLowerCase();
    const lang = locale.startsWith("en") ? "en" : "ar";
    const added = Number(points) > 0;
    const absPoints = Math.abs(pointsNumber(points));
    const titleAr = added
      ? "\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0646\u0642\u0627\u0637"
      : "\u062a\u0645 \u062e\u0635\u0645 \u0646\u0642\u0627\u0637";
    const bodyAr = added
      ? `\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 ${absPoints} \u0646\u0642\u0637\u0629 \u0625\u0644\u0649 \u062d\u0633\u0627\u0628\u0643.`
      : `\u062a\u0645 \u062e\u0635\u0645 ${absPoints} \u0646\u0642\u0637\u0629 \u0645\u0646 \u062d\u0633\u0627\u0628\u0643.`;
    const titleEn = added ? "Points added" : "Points deducted";
    const bodyEn = added
      ? `${absPoints} points were added to your account.`
      : `${absPoints} points were deducted from your account.`;
    const title = lang === "en" ? titleEn : titleAr;
    const body = lang === "en" ? bodyEn : bodyAr;
    const notificationId = `rewards-adjust-${Date.now()}-${numericId}`;
    const data = {
      type: "customer_rewards",
      dynamic_link: "https://app.halabt.com/rewards",
      customer_id: String(customerId || ""),
      points: String(points),
      balance_after: String(balanceAfter ?? ""),
      lang,
      title_ar: titleAr,
      body_ar: bodyAr,
      title_en: titleEn,
      body_en: bodyEn
    };

    await redis.lPush(
      `bt:user:notifications:${numericId}`,
      JSON.stringify({
        id: notificationId,
        title,
        body,
        seen: false,
        date: nowIso(),
        additionalData: data
      })
    ).catch(() => {});
    await redis.lTrim(`bt:user:notifications:${numericId}`, 0, 99).catch(() => {});
    await redis.expire(`bt:user:notifications:${numericId}`, 60 * 60 * 24 * 120).catch(() => {});

    const firebase = typeof getFirebaseAdmin === "function" ? getFirebaseAdmin() : null;
    const token =
      (await redis.get(`bt:user:push:${numericId}`).catch(() => "")) ||
      (await redis.get(`bt:user:push:${customerId}`).catch(() => ""));
    if (!firebase || !token) return;

    await firebase.messaging().send({
      token,
      notification: { title, body },
      data: {
        id: notificationId,
        ...data
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default"
        }
      },
      apns: {
        payload: { aps: { sound: "default" } }
      }
    }).catch(() => {});
  }

  async function saveAndSendWalletConvertNotification(redis, {
    customerId,
    amountText,
    value,
    currencyCode,
    points,
    balanceAfter
  }) {
    const numericId = customerNumericId(customerId);
    if (!redis || !numericId || !value) return;

    const locale = String(
      (await redis.get(`bt:user:push-locale:${numericId}`).catch(() => "")) || ""
    ).toLowerCase();
    const lang = locale.startsWith("en") ? "en" : "ar";
    const titleAr = "\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0631\u0635\u064a\u062f";
    const bodyAr = `\u062a\u0645 \u062a\u062d\u0648\u064a\u0644 \u0646\u0642\u0627\u0637\u0643 \u0648\u0625\u0636\u0627\u0641\u0629 ${amountText} \u0625\u0644\u0649 \u0645\u062d\u0641\u0638\u062a\u0643.`;
    const titleEn = "Wallet credit added";
    const bodyEn = `Your points were converted and ${amountText} was added to your wallet.`;
    const title = lang === "en" ? titleEn : titleAr;
    const body = lang === "en" ? bodyEn : bodyAr;
    const notificationId = `points-wallet-${Date.now()}-${numericId}`;
    const data = {
      dynamic_link: "https://app.halabt.com/wallet",
      type: "customer_credit",
      source: "points_to_wallet",
      customer_id: String(customerId || ""),
      amount: amountText,
      value: String(value),
      currency_code: String(currencyCode || ""),
      points: String(points || ""),
      balance_after: String(balanceAfter ?? ""),
      lang,
      title_ar: titleAr,
      body_ar: bodyAr,
      title_en: titleEn,
      body_en: bodyEn
    };

    await redis.lPush(
      `bt:user:notifications:${numericId}`,
      JSON.stringify({
        id: notificationId,
        title,
        body,
        seen: false,
        date: nowIso(),
        additionalData: data
      })
    ).catch(() => {});
    await redis.lTrim(`bt:user:notifications:${numericId}`, 0, 99).catch(() => {});
    await redis.expire(`bt:user:notifications:${numericId}`, 60 * 60 * 24 * 120).catch(() => {});

    const firebase = typeof getFirebaseAdmin === "function" ? getFirebaseAdmin() : null;
    const token =
      (await redis.get(`bt:user:push:${numericId}`).catch(() => "")) ||
      (await redis.get(`bt:user:push:${customerId}`).catch(() => ""));
    if (!firebase || !token) return;

    await firebase.messaging().send({
      token,
      notification: { title, body },
      data: {
        id: notificationId,
        ...data
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default"
        }
      },
      apns: {
        payload: { aps: { sound: "default" } }
      }
    }).catch(() => {});
  }

  async function redisOrThrow() {
    const redis = typeof getRedis === "function" ? await getRedis() : null;
    if (!redis) {
      const err = new Error("redis_not_ready");
      err.status = 500;
      throw err;
    }
    return redis;
  }

  router.get("/rewards/settings", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      res.json({ ok: true, settings: await getSettings(redis) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post("/rewards/settings", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      res.json({ ok: true, settings: await saveSettings(redis, req.body || {}) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.get("/rewards/customer/:customerId", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const customerId = normalizeCustomerId(req.params.customerId);
      const settings = await getSettings(redis);
      const balance = await readBalance(redis, customerId);
      const ledger = req.query.ledger === "1"
        ? await readLedger(redis, customerId, req.query.limit)
        : undefined;
      res.json({
        ok: true,
        customerId,
        balance,
        value: Number(rewardValue(balance, settings).toFixed(3)),
        currencyCode: settings.currencyCode,
        ledger
      });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  router.get("/rewards/customers", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const q = cleanAdminSearch(req.query.q);
      const appFilter = String(req.query.app || "").trim();
      const limit = Math.max(1, Math.min(Number(req.query.limit || 200) || 200, 500));
      const ids = await redis.sMembers("bt:rewards:customers");
      const customerMap = await fetchRewardCustomers(ids);
      const settings = await getSettings(redis);
      const out = [];
      for (const id of ids) {
        const customerId = normalizeCustomerId(id);
        const balance = await readBalance(redis, id);
        if (!q && balance <= 0) continue;
        const ledger = await readLedger(redis, id, 8);
        const last = ledger[0] || {};
        const customer = customerMap.get(customerId) || {};
        const appInstalled = await customerUsesApp(redis, customerId);
        if (appFilter === "1" && !appInstalled) continue;
        if (appFilter === "0" && appInstalled) continue;
        const row = {
          customerId,
          customerNumericId: customerNumericId(id),
          appInstalled,
          displayName: customer.displayName || "",
          email: customer.email || "",
          phone: customer.phone || "",
          numberOfOrders: customer.numberOfOrders || 0,
          amountSpent: customer.amountSpent || null,
          amountSpentText: moneyLabel(customer.amountSpent),
          balance,
          value: Number(rewardValue(balance, settings).toFixed(3)),
          currencyCode: settings.currencyCode,
          lastActivityAt: last.createdAt || "",
          lastReason: last.reason || "",
          lastOrderName: last.orderName || last.orderId || "",
          ledger
        };
        if (!rewardCustomerMatches(row, q)) continue;
        out.push({
          ...row
        });
      }
      out.sort((a, b) => {
        if (b.balance !== a.balance) return b.balance - a.balance;
        const spentDiff = moneyNumber(b.amountSpent?.amount) - moneyNumber(a.amountSpent?.amount);
        if (spentDiff) return spentDiff;
        return Number(b.numberOfOrders || 0) - Number(a.numberOfOrders || 0);
      });
      res.json({ ok: true, count: out.length, customers: out.slice(0, limit) });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post("/rewards/adjust", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const points = pointsNumber(req.body?.points);
      const out = await movePoints(redis, {
        customerId: req.body?.customerId,
        points,
        type: points >= 0 ? "admin_add" : "admin_deduct",
        reason: req.body?.reason || "manual_adjustment",
        orderId: req.body?.orderId,
        note: req.body?.note,
        txId: req.body?.txId,
        meta: { source: "admin" }
      });
      await saveAndSendAdminAdjustNotification(redis, {
        customerId: out.customerId || req.body?.customerId,
        points,
        balanceAfter: out.balance
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  router.post("/rewards/earn-order", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const settings = await getSettings(redis);
      if (!settings.enabled) return res.status(409).json({ ok: false, error: "rewards_disabled" });
      const points = earnedPoints(req.body?.orderAmount, settings);
      const out = await movePoints(redis, {
        customerId: req.body?.customerId,
        points,
        type: "order_earn",
        reason: req.body?.reason || "order_reward",
        orderId: req.body?.orderId,
        txId: req.body?.txId || (req.body?.orderId ? `earn:${req.body.orderId}` : ""),
        meta: {
          orderAmount: moneyNumber(req.body?.orderAmount),
          earnPointsPerCurrency: settings.earnPointsPerCurrency
        }
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  router.post("/rewards/reverse-order", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const settings = await getSettings(redis);
      const points = req.body?.points != null
        ? pointsNumber(req.body.points)
        : earnedPoints(req.body?.orderAmount, settings);
      const out = await movePoints(redis, {
        customerId: req.body?.customerId,
        points: -Math.abs(points),
        type: "order_reverse",
        reason: req.body?.reason || "order_cancelled",
        orderId: req.body?.orderId,
        txId: req.body?.txId || (req.body?.orderId ? `reverse:${req.body.orderId}` : ""),
        meta: { orderAmount: moneyNumber(req.body?.orderAmount) }
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  router.post("/rewards/convert-wallet", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const settings = await getSettings(redis);
      if (!settings.enabled) return res.status(409).json({ ok: false, error: "rewards_disabled" });

      const points = pointsNumber(req.body?.points);
      const customerId = normalizeCustomerId(req.body?.customerId || req.body?.customer_id);
      if (points < pointsNumber(settings.minRedeemPoints)) {
        return res.status(400).json({ ok: false, error: "below_minimum_points" });
      }

      const value = Number(rewardValue(points, settings).toFixed(3));
      if (value < 1) {
        return res.status(400).json({
          ok: false,
          error: "below_minimum_wallet_value",
          minimumValue: 1,
          value,
          currencyCode: settings.currencyCode
        });
      }

      const txId = req.body?.txId || `wallet-convert:${customerNumericId(customerId)}:${points}:${Date.now()}`;
      const debit = await movePoints(redis, {
        customerId,
        points: -Math.abs(points),
        type: "wallet_convert",
        reason: req.body?.reason || "points_to_wallet",
        orderId: req.body?.orderId,
        txId,
        meta: { value, currencyCode: settings.currencyCode }
      });

      try {
        const credit = await creditCustomerStoreCredit(customerId, value, settings.currencyCode);
        await addLedger(redis, customerId, {
          type: "wallet_credit",
          points: 0,
          balanceAfter: debit.balance,
          reason: "wallet_credit_from_points",
          orderId: req.body?.orderId,
          note: `${moneyLabel(value, settings.currencyCode)} added to wallet`,
          meta: { value, currencyCode: settings.currencyCode, credit }
        });
        await saveAndSendWalletConvertNotification(redis, {
          customerId,
          amountText: moneyLabel(value, settings.currencyCode),
          value,
          currencyCode: settings.currencyCode,
          points,
          balanceAfter: debit.balance
        });
        return res.json({
          ...debit,
          wallet: {
            credited: true,
            amount: value,
            amountText: moneyLabel(value, settings.currencyCode),
            currencyCode: settings.currencyCode,
            credit
          }
        });
      } catch (creditError) {
        await movePoints(redis, {
          customerId,
          points: Math.abs(points),
          type: "wallet_convert_rollback",
          reason: "wallet_credit_failed",
          orderId: req.body?.orderId,
          note: creditError.message || "wallet credit failed",
          txId: `${txId}:rollback`,
          meta: { value, currencyCode: settings.currencyCode }
        });
        throw creditError;
      }
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  return router;
}

export function customerRewardsPublicRouter(deps = {}) {
  const router = express.Router();
  const getRedis = deps.getRedis;
  const getFirebaseAdmin = deps.getFirebaseAdmin;

  async function saveAndSendWalletConvertNotification(redis, {
    customerId,
    amountText,
    value,
    currencyCode,
    points,
    balanceAfter
  }) {
    const numericId = customerNumericId(customerId);
    if (!redis || !numericId || !value) return;

    const locale = String(
      (await redis.get(`bt:user:push-locale:${numericId}`).catch(() => "")) || ""
    ).toLowerCase();
    const lang = locale.startsWith("en") ? "en" : "ar";
    const titleAr = "\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0631\u0635\u064a\u062f";
    const bodyAr = `\u062a\u0645 \u062a\u062d\u0648\u064a\u0644 \u0646\u0642\u0627\u0637\u0643 \u0648\u0625\u0636\u0627\u0641\u0629 ${amountText} \u0625\u0644\u0649 \u0645\u062d\u0641\u0638\u062a\u0643.`;
    const titleEn = "Wallet credit added";
    const bodyEn = `Your points were converted and ${amountText} was added to your wallet.`;
    const title = lang === "en" ? titleEn : titleAr;
    const body = lang === "en" ? bodyEn : bodyAr;
    const notificationId = `points-wallet-${Date.now()}-${numericId}`;
    const data = {
      dynamic_link: "https://app.halabt.com/wallet",
      type: "customer_credit",
      source: "points_to_wallet",
      customer_id: String(customerId || ""),
      amount: amountText,
      value: String(value),
      currency_code: String(currencyCode || ""),
      points: String(points || ""),
      balance_after: String(balanceAfter ?? ""),
      lang,
      title_ar: titleAr,
      body_ar: bodyAr,
      title_en: titleEn,
      body_en: bodyEn
    };

    await redis.lPush(
      `bt:user:notifications:${numericId}`,
      JSON.stringify({
        id: notificationId,
        title,
        body,
        seen: false,
        date: nowIso(),
        additionalData: data
      })
    ).catch(() => {});
    await redis.lTrim(`bt:user:notifications:${numericId}`, 0, 99).catch(() => {});
    await redis.expire(`bt:user:notifications:${numericId}`, 60 * 60 * 24 * 120).catch(() => {});

    const firebase = typeof getFirebaseAdmin === "function" ? getFirebaseAdmin() : null;
    const token =
      (await redis.get(`bt:user:push:${numericId}`).catch(() => "")) ||
      (await redis.get(`bt:user:push:${customerId}`).catch(() => ""));
    if (!firebase || !token) return;

    await firebase.messaging().send({
      token,
      notification: { title, body },
      data: {
        id: notificationId,
        ...data
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default"
        }
      },
      apns: {
        payload: { aps: { sound: "default" } }
      }
    }).catch(() => {});
  }

  async function redisOrThrow() {
    const redis = typeof getRedis === "function" ? await getRedis() : null;
    if (!redis) {
      const err = new Error("redis_not_ready");
      err.status = 500;
      throw err;
    }
    return redis;
  }

  router.get("/customer/rewards", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const customerId = normalizeCustomerId(
        req.query.customerId || req.query.customer_id || req.query.id
      );
      if (!customerId) return res.status(400).json({ ok: false, error: "customerId_required" });
      const settings = await getSettings(redis);
      const balance = await readBalance(redis, customerId);
      const ledger = await readLedger(redis, customerId, req.query.limit || 30);
      res.json({
        ok: true,
        enabled: settings.enabled,
        customerId,
        balance,
        value: Number(rewardValue(balance, settings).toFixed(3)),
        currencyCode: settings.currencyCode,
        settings,
        ledger
      });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.get("/customer/rewards/referral", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const customerId = normalizeCustomerId(
        req.query.customerId || req.query.customer_id || req.query.id
      );
      if (!customerId) return res.status(400).json({ ok: false, error: "customerId_required" });
      res.json(await getReferralSummary(redis, customerId));
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post("/customer/rewards/referral/accept", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const out = await acceptReferral(redis, {
        code: req.body?.code || req.body?.referralCode || req.body?.referral_code,
        customerId: req.body?.customerId || req.body?.customer_id
      });
      res.json(out);
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post("/customer/rewards/quote", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const settings = await getSettings(redis);
      const points = pointsNumber(req.body?.points);
      const cartTotal = moneyNumber(req.body?.cartTotal);
      const value = rewardValue(points, settings);
      const maxByPercent = cartTotal > 0
        ? cartTotal * (Number(settings.maxRedeemPercent) || 100) / 100
        : value;
      res.json({
        ok: true,
        points,
        value: Number(Math.min(value, maxByPercent).toFixed(3)),
        currencyCode: settings.currencyCode,
        allowed:
          settings.enabled &&
          points >= pointsNumber(settings.minRedeemPoints) &&
          value <= maxByPercent
      });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message });
    }
  });

  router.post("/customer/rewards/redeem", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const settings = await getSettings(redis);
      if (!settings.enabled) return res.status(409).json({ ok: false, error: "rewards_disabled" });
      const points = pointsNumber(req.body?.points);
      if (points < pointsNumber(settings.minRedeemPoints)) {
        return res.status(400).json({ ok: false, error: "below_minimum_points" });
      }
      const out = await movePoints(redis, {
        customerId: req.body?.customerId || req.body?.customer_id,
        points: -Math.abs(points),
        type: "redeem",
        reason: req.body?.reason || "redeemed_in_app",
        orderId: req.body?.orderId,
        txId: req.body?.txId,
        meta: {
          value: Number(rewardValue(points, settings).toFixed(3)),
          currencyCode: settings.currencyCode
        }
      });
      res.json({
        ...out,
        value: Number(rewardValue(points, settings).toFixed(3)),
        currencyCode: settings.currencyCode
      });
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  router.post("/customer/rewards/convert-wallet", async (req, res) => {
    try {
      const redis = await redisOrThrow();
      const settings = await getSettings(redis);
      if (!settings.enabled) return res.status(409).json({ ok: false, error: "rewards_disabled" });
      const points = pointsNumber(req.body?.points);
      const customerId = normalizeCustomerId(req.body?.customerId || req.body?.customer_id);
      if (!customerId) return res.status(400).json({ ok: false, error: "customerId_required" });
      if (points < pointsNumber(settings.minRedeemPoints)) {
        return res.status(400).json({ ok: false, error: "below_minimum_points" });
      }

      const value = Number(rewardValue(points, settings).toFixed(3));
      if (value < 1) {
        return res.status(400).json({
          ok: false,
          error: "below_minimum_wallet_value",
          minimumValue: 1,
          value,
          currencyCode: settings.currencyCode
        });
      }

      const txId = req.body?.txId || `app-wallet-convert:${customerNumericId(customerId)}:${points}:${Date.now()}`;
      const debit = await movePoints(redis, {
        customerId,
        points: -Math.abs(points),
        type: "wallet_convert",
        reason: "points_to_wallet",
        txId,
        meta: { value, currencyCode: settings.currencyCode, source: "app" }
      });

      try {
        const credit = await creditCustomerStoreCredit(customerId, value, settings.currencyCode);
        await addLedger(redis, customerId, {
          type: "wallet_credit",
          points: 0,
          balanceAfter: debit.balance,
          reason: "wallet_credit_from_points",
          note: `${moneyLabel(value, settings.currencyCode)} added to wallet`,
          meta: { value, currencyCode: settings.currencyCode, credit }
        });
        await saveAndSendWalletConvertNotification(redis, {
          customerId,
          amountText: moneyLabel(value, settings.currencyCode),
          value,
          currencyCode: settings.currencyCode,
          points,
          balanceAfter: debit.balance
        });
        return res.json({
          ...debit,
          wallet: {
            credited: true,
            amount: value,
            amountText: moneyLabel(value, settings.currencyCode),
            currencyCode: settings.currencyCode
          }
        });
      } catch (creditError) {
        await movePoints(redis, {
          customerId,
          points: Math.abs(points),
          type: "wallet_convert_rollback",
          reason: "wallet_credit_failed",
          note: creditError.message || "wallet credit failed",
          txId: `${txId}:rollback`,
          meta: { value, currencyCode: settings.currencyCode, source: "app" }
        });
        throw creditError;
      }
    } catch (e) {
      res.status(e.status || 500).json({ ok: false, error: e.message, details: e.details });
    }
  });

  return router;
}
