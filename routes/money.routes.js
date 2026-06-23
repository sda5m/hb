// routes/money.routes.js
import express from "express";
import fetch from "node-fetch";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import webpush from "web-push";
import { v2 as cloudinary } from "cloudinary";

export default function moneyRoutes({
  getRedis,
  requireAdmin,
  requirePack,
  WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_SUBJECT
}) {
  const router = express.Router();

  // =========================
  // Web Push - Expenses Notifications
  // =========================
  const K_MONEY_PUSH_SUBS = "bt:money:push:subs";

  const pushEnabled =
    !!String(WEB_PUSH_PUBLIC_KEY || "").trim() &&
    !!String(WEB_PUSH_PRIVATE_KEY || "").trim() &&
    !!String(WEB_PUSH_SUBJECT || "").trim();

  if (pushEnabled) {
    webpush.setVapidDetails(
      String(WEB_PUSH_SUBJECT || "").trim(),
      String(WEB_PUSH_PUBLIC_KEY || "").trim(),
      String(WEB_PUSH_PRIVATE_KEY || "").trim()
    );
  }

  async function loadMoneyPushSubs(r) {
    const raw = await r.get(K_MONEY_PUSH_SUBS);
    if (!raw) return [];

    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async function saveMoneyPushSubs(r, list) {
    await r.set(
      K_MONEY_PUSH_SUBS,
      JSON.stringify(Array.isArray(list) ? list : [])
    );
  }

  function samePushSub(a, b) {
    return String(a?.endpoint || "").trim() === String(b?.endpoint || "").trim();
  }

  async function addMoneyPushSub(r, sub) {
    if (!sub?.endpoint) throw new Error("subscription غير صالح");

    const list = await loadMoneyPushSubs(r);
    const exists = list.find((x) => samePushSub(x, sub));

    if (!exists) {
      list.push(sub);
      await saveMoneyPushSubs(r, list);
    }

    return {
      ok: true,
      count: list.length
    };
  }

  async function removeMoneyPushSub(r, endpoint) {
    const list = await loadMoneyPushSubs(r);

    const filtered = list.filter((x) => {
      return String(x?.endpoint || "").trim() !== String(endpoint || "").trim();
    });

    await saveMoneyPushSubs(r, filtered);

    return {
      ok: true,
      count: filtered.length
    };
  }

  async function sendMoneyPushToAll(r, payload) {
    if (!pushEnabled) {
      return {
        ok: false,
        skipped: true,
        reason: "PUSH_DISABLED"
      };
    }

    const list = await loadMoneyPushSubs(r);

    if (!list.length) {
      return {
        ok: true,
        sent: 0
      };
    }

    let sent = 0;

    for (const sub of list) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (e) {
        const code = Number(e?.statusCode || 0);

        if (code === 404 || code === 410) {
          await removeMoneyPushSub(r, sub?.endpoint || "");
        } else {
          console.error("money push failed:", e?.message || e);
        }
      }
    }

    return {
      ok: true,
      sent
    };
  }

  async function notifyMoney(r, payload = {}) {
    const clean = {
      title: safeStr(payload.title || "تنبيه مالي"),
      body: safeStr(payload.body || "تمت عملية مالية جديدة"),
      tag: safeStr(payload.tag || "money-update"),
      url: safeStr(payload.url || "/k/"),
      ...(payload.image ? { image: payload.image } : {})
    };

    try {
      return await sendMoneyPushToAll(r, clean);
    } catch (e) {
      console.error("money notify failed:", e?.message || e);
      return {
        ok: false,
        error: e?.message || String(e)
      };
    }
  }

  
  /* =========================================================
     ENV / Shopify
     ========================================================= */
  const SHOP = String(process.env.SHOPIFY_SHOP || "").trim();
  const TOKEN = String(process.env.SHOPIFY_ADMIN_TOKEN || "").trim();

  const API_VERSION = String(process.env.SHOPIFY_API_VERSION || "2024-10").trim();
  const GQL_VERSION = String(process.env.SHOPIFY_GQL_VERSION || "2025-01").trim();

const DEFAULT_FROM_DAYS = Math.min(
  Math.max(Number(process.env.MONEY_DEFAULT_FROM_DAYS || 1) || 1, 1),
  365
);

const MONEY_LOOKBACK_DAYS = Math.min(
  Math.max(Number(process.env.MONEY_LOOKBACK_DAYS || 4) || 4, 1),
  14
);
  
  const DELIVERY_FEE_MUSCAT = Number(process.env.MONEY_DELIVERY_MUSCAT || 2);
  const DELIVERY_FEE_OFFICE = Number(process.env.MONEY_DELIVERY_OFFICE || 1);
  const DELIVERY_FEE_DHL_OFFICE = Number(process.env.MONEY_DELIVERY_DHL_OFFICE || 9);

  const CASH_ENDED_TAG = String(process.env.MONEY_CASH_ENDED_TAG || "انتهت").trim();
  const CASH_PAID_TAG = String(process.env.MONEY_CASH_PAID_TAG || "مدفوع").trim();
  const FINANCE_TRANSFERRED_TAG = String(process.env.MONEY_FINANCE_TRANSFERRED_TAG || "مرحّل مالي").trim();

  const DELIVERY_MUSCAT_TAG = String(process.env.DELIVERY_MUSCAT_TAG || "مسقط").trim();
const DELIVERY_DONE_TAG = String(process.env.DELIVERY_DONE_TAG || "تم").trim();
const DELIVERY_SETTLED_TAG = String(process.env.DELIVERY_SETTLED_TAG || "مرحل").trim();
const DELIVERY_CANCEL_TAG = String(process.env.DELIVERY_CANCEL_TAG || "لم يستلم").trim();

const DELIVERY_IGNORE_TAGS = String(
  process.env.DELIVERY_IGNORE_TAGS || "لم يستلم,ملغي مسقط,مرتجع,كنسل"
)
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const DELIVERY_START_DATE = normalizeDateInput(
  process.env.DELIVERY_START_DATE || "2026-04-01"
) || "2026-04-01";
  
  function assertEnv() {
    const miss = [];

    if (!SHOP) miss.push("SHOPIFY_SHOP");
    if (!TOKEN) miss.push("SHOPIFY_ADMIN_TOKEN");

    if (miss.length) {
      throw new Error("Missing env: " + miss.join(", "));
    }
  }

  /* =========================================================
     Auth
     ========================================================= */
  function requireAdminKey(req, res, next) {
    const key = String(req.headers["x-admin-key"] || "").trim();

    if (!key || key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    next();
  }

  
// =========================
// Push endpoints - نفس الروت القديم
// =========================
router.get("/api/money/push/public-key", requireAdminKey, async (_req, res) => {
  try {
    const publicKey = String(WEB_PUSH_PUBLIC_KEY || "").trim();

    if (!publicKey) {
      return res.status(500).json({
        error: "WEB_PUSH_PUBLIC_KEY غير مضبوط"
      });
    }

    return res.json({
      publicKey
    });
  } catch (e) {
    return res.status(500).json({
      error: e?.message || String(e)
    });
  }
});

router.post(
  "/api/money/push/subscribe",
  requireAdminKey,
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) {
        return res.status(500).json({
          error: "REDIS_URL غير مضبوط"
        });
      }

      const sub = req.body || {};

      if (!sub?.endpoint) {
        return res.status(400).json({
          error: "subscription غير صالح"
        });
      }

      const out = await addMoneyPushSub(r, sub);

      return res.json(out);
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);

router.post(
  "/api/money/push/send-test",
  requireAdminKey,
  express.json({ limit: "100kb" }),
  async (_req, res) => {
    try {
      const r = await getRedis();
      if (!r) {
        return res.status(500).json({
          error: "REDIS_URL غير مضبوط"
        });
      }

      const out = await sendMoneyPushToAll(r, {
        title: "تجربة إشعار الصرفيات",
        body: "هذا إشعار تجريبي من لوحة الإدارة",
        tag: "money-test",
        url: "/k/"
      });

      return res.json({
        ok: true,
        ...out
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);

  
  /* =========================================================
     Redis Keys
     ========================================================= */
  const K_LAST_TRANSFER_AT = "bt:money:last_transfer_at";

  const K_DEBTS = "bt:money:debts";
  const K_DEBTS_PRIO = "bt:money:debts:prio";
  const K_DEBTS_PRIO_SEQ = "bt:money:debts:prio:seq";
  const K_DEBTS_LOG = "bt:money:debts:log";

  const K_EXPENSES = "bt:money:expenses";
  const K_EXPENSES_TRANSFER_LOG = "bt:money:expenses:transfer:log";

  const K_ORDERS_TRANSFER_LOG = "bt:money:orders:transfer:log";

  // New finance system
  const K_V2_TRANSFERRED_IDS = "bt:money:v2:orders:transferred:ids";
  const K_V2_ARCHIVE = "bt:money:v2:orders:archive";
  const K_V2_SHIPPING_OVERRIDES = "bt:money:v2:shipping:overrides";

  // Ledger / integrated accounts
  const K_LEDGER_BALANCES = "bt:money:v2:ledger:balances";
  const K_LEDGER_ENTRIES = "bt:money:v2:ledger:entries";
  const K_PURCHASES = "bt:money:purchases";

  /* =========================================================
     Pages
     ========================================================= */
router.get("/admin", (_req, res) => {
  res.sendFile(path.resolve("public/k/index.html"));
});

router.get("/k", (_req, res) => {
  res.redirect("/k/");
});

router.get("/k/", (_req, res) => {
  res.sendFile(path.resolve("public/k/index.html"));
});
  router.get("/pack-expenses", (_req, res) => {
    res.sendFile(path.resolve("public/a/money.html"));
  });

  /* =========================================================
     Common Helpers
     ========================================================= */
  function safeStr(x) {
    return String(x ?? "").trim();
  }

  function toNumber(x) {
    const n = Number(String(x ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function uuid() {
    return crypto.randomUUID();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function gidToNumeric(id) {
    const s = safeStr(id);
    if (!s) return "";
    return s.includes("gid://") ? s.split("/").pop() : s;
  }

  function normalizeTags(tags) {
    if (Array.isArray(tags)) return tags.map(safeStr).filter(Boolean);

    return String(tags || "")
      .split(",")
      .map(safeStr)
      .filter(Boolean);
  }

  function hasTag(tags, tag) {
    const t = safeStr(tag);
    return normalizeTags(tags).some((x) => x === t);
  }

  function hasAnyTag(tags, list) {
    return list.some((x) => hasTag(tags, x));
  }

  function lower(x) {
    return safeStr(x).toLowerCase();
  }

  function money3(n) {
    return Number(toNumber(n).toFixed(3));
  }

  function todayMinus(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function normalizeDateInput(x) {
    const s = safeStr(x);

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    return "";
  }

  function buildDateRange(req) {
    const from = normalizeDateInput(req.query?.from || req.body?.from);
    const to = normalizeDateInput(req.query?.to || req.body?.to);

    return {
      from: from || todayMinus(DEFAULT_FROM_DAYS),
      to: to || new Date().toISOString().slice(0, 10)
    };
  }

  function addOneDay(yyyy_mm_dd) {
    const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);

    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");

    return `${yy}-${mm}-${dd}`;
  }

  async function readListJSON(r, key, max = 500) {
    const limit = Math.max(1, Math.min(Number(max) || 500, 5000));
    const raw = await r.lRange(key, 0, limit - 1);

    return (raw || [])
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

const MONEY_TZ_OFFSET_MINUTES = Number(process.env.MONEY_TZ_OFFSET_MINUTES || 240);

function localDayFromISO(value) {
  const s = safeStr(value);
  if (!s) return "";

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return s.slice(0, 10);
  }

  const shifted = new Date(d.getTime() + MONEY_TZ_OFFSET_MINUTES * 60 * 1000);

  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function filterItemsByDateRange(items, { from = "", to = "" } = {}) {
  const dFrom = normalizeDateInput(from);
  const dTo = normalizeDateInput(to);

  return (items || []).filter((x) => {
    const itemDay = localDayFromISO(x?.at || x?.createdAt || x?.updatedAt);

    if (!itemDay) return false;
    if (dFrom && itemDay < dFrom) return false;
    if (dTo && itemDay > dTo) return false;

    return true;
  });
}
  
  /* =========================================================
     Ledger Helpers - الحسابات المترابطة
     ========================================================= */
  const LEDGER_ACCOUNTS = {
    CASH_MUSCAT: "cash_muscat",
    DALILI_PENDING: "dalili_pending",
    AMWAL_PENDING: "amwal_pending",
    BANK: "bank"
  };

  function ledgerAccountLabel(account) {
    const a = safeStr(account);
    if (a === LEDGER_ACCOUNTS.CASH_MUSCAT) return "كاش مسقط";
    if (a === LEDGER_ACCOUNTS.DALILI_PENDING) return "مستحق دليلي";
    if (a === LEDGER_ACCOUNTS.AMWAL_PENDING) return "مستحق أموال";
    if (a === LEDGER_ACCOUNTS.BANK) return "الحساب البنكي";
    return a || "—";
  }

  function normalizeLedgerAccount(x) {
    const s = safeStr(x).toUpperCase();

    if (["CASH", "CASH_MUSCAT", "MUSCAT", "كاش", "مسقط"].includes(s)) {
      return LEDGER_ACCOUNTS.CASH_MUSCAT;
    }

    if (["DALILI", "CASH_DALILI", "DALILI_PENDING", "دليلي"].includes(s)) {
      return LEDGER_ACCOUNTS.DALILI_PENDING;
    }

    if (["AMWAL", "AMWAL_PENDING", "أموال", "اموال"].includes(s)) {
      return LEDGER_ACCOUNTS.AMWAL_PENDING;
    }

    if (["BANK", "BANK_TRANSFER", "تحويل", "بنك", "الحساب البنكي"].includes(s)) {
      return LEDGER_ACCOUNTS.BANK;
    }

    const low = lower(x);
    if (low.includes("dalili") || low.includes("دليلي")) return LEDGER_ACCOUNTS.DALILI_PENDING;
    if (low.includes("amwal") || low.includes("أموال") || low.includes("اموال")) return LEDGER_ACCOUNTS.AMWAL_PENDING;
    if (low.includes("bank") || low.includes("بنك") || low.includes("تحويل")) return LEDGER_ACCOUNTS.BANK;
    if (low.includes("cash") || low.includes("كاش") || low.includes("مسقط")) return LEDGER_ACCOUNTS.CASH_MUSCAT;

    return "";
  }

  function normalizePaySource(x) {
    const acc = normalizeLedgerAccount(x || "BANK");
    return acc || LEDGER_ACCOUNTS.BANK;
  }

  function sectionToLedgerAccount(section) {
    const sec = safeStr(section).toUpperCase();
    if (sec === "AMWAL") return LEDGER_ACCOUNTS.AMWAL_PENDING;
    if (sec === "BANK") return LEDGER_ACCOUNTS.BANK;
    if (sec === "CASH_MUSCAT") return LEDGER_ACCOUNTS.CASH_MUSCAT;
    if (sec === "CASH_DALILI") return LEDGER_ACCOUNTS.DALILI_PENDING;
    if (sec === "CASH") return LEDGER_ACCOUNTS.CASH_MUSCAT;
    return "";
  }

  function sectionNameForPush(section) {
    const sec = safeStr(section).toUpperCase();
    if (sec === "AMWAL") return "أموال";
    if (sec === "BANK") return "تحويل بنكي";
    if (sec === "CASH_MUSCAT") return "كاش مسقط";
    if (sec === "CASH_DALILI") return "كاش دليلي";
    if (sec === "CASH") return "كاش";
    if (sec === "ALL") return "كل الأقسام";
    return sec || "عملية مالية";
  }

  function emptyLedgerBalances() {
    return {
      cash_muscat: 0,
      dalili_pending: 0,
      amwal_pending: 0,
      bank: 0
    };
  }

  async function getLedgerBalances(r) {
    const raw = await r.hGetAll(K_LEDGER_BALANCES);
    const out = emptyLedgerBalances();

    for (const k of Object.keys(out)) {
      out[k] = money3(raw?.[k] || 0);
    }

    out.total_available = money3(out.cash_muscat + out.bank);
    out.total_pending = money3(out.dalili_pending + out.amwal_pending);
    out.total_all = money3(out.total_available + out.total_pending);

    return out;
  }

  async function addLedgerMovement(r, {
    type,
    amount,
    from = "",
    to = "",
    note = "",
    refId = "",
    refType = "",
    meta = {},
    at = ""
  } = {}) {
    const val = money3(amount);
    if (!(val > 0)) throw new Error("مبلغ الحركة لازم > 0");

    const fromAcc = normalizeLedgerAccount(from);
    const toAcc = normalizeLedgerAccount(to);

    if (!fromAcc && !toAcc) {
      throw new Error("لازم تحدد حساب مصدر أو حساب وجهة");
    }

    const rec = {
      id: uuid(),
      at: at || new Date().toISOString(),
      type: safeStr(type || "MOVEMENT"),
      amount: val,
      from: fromAcc,
      fromLabel: fromAcc ? ledgerAccountLabel(fromAcc) : "",
      to: toAcc,
      toLabel: toAcc ? ledgerAccountLabel(toAcc) : "",
      note: safeStr(note),
      refId: safeStr(refId),
      refType: safeStr(refType),
      meta: meta && typeof meta === "object" ? meta : {}
    };

    const multi = r.multi();

    if (fromAcc) multi.hIncrByFloat(K_LEDGER_BALANCES, fromAcc, -val);
    if (toAcc) multi.hIncrByFloat(K_LEDGER_BALANCES, toAcc, val);

    multi.lPush(K_LEDGER_ENTRIES, JSON.stringify(rec));
    multi.lTrim(K_LEDGER_ENTRIES, 0, 5000);

    await multi.exec();

    return rec;
  }

async function readLedgerEntries(r, { from = "", to = "", limit = 1000 } = {}) {
  let items = await readListJSON(r, K_LEDGER_ENTRIES, limit);

  const dFrom = normalizeDateInput(from);
  const dTo = normalizeDateInput(to);

  items = items.filter((x) => {
    const itemDay = localDayFromISO(x?.at);

    if (!itemDay) return false;
    if (dFrom && itemDay < dFrom) return false;
    if (dTo && itemDay > dTo) return false;

    return true;
  });

  return items;
}
  
function ledgerTotals(entries = []) {
  const out = {
    order_transfer: 0,
    settlements: 0,
    expenses: 0,
    purchases: 0,
    debt_payments: 0,
    courier_delivery_fees: 0,
    manual: 0
  };

  for (const e of entries || []) {
    const t = safeStr(e.type).toUpperCase();
    const amount = toNumber(e.amount);

    if (t === "ORDER_TRANSFER") out.order_transfer += amount;
    else if (t === "SETTLEMENT") out.settlements += amount;
    else if (t === "EXPENSE") out.expenses += amount;
    else if (t === "PURCHASE") out.purchases += amount;
    else if (t === "DEBT_PAY") out.debt_payments += amount;
    else if (t === "COURIER_DELIVERY_FEE") out.courier_delivery_fees += amount;
    else out.manual += amount;
  }

  for (const k of Object.keys(out)) out[k] = money3(out[k]);
  return out;
}
  
  /* =========================================================
     Shopify REST / GraphQL
     ========================================================= */
  async function shopifyREST(urlPath, opts = {}) {
    assertEnv();

    const url = `https://${SHOP}/admin/api/${API_VERSION}${urlPath}`;

    const r = await fetch(url, {
      method: opts.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
        ...(opts.headers || {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });

    const txt = await r.text();

    let json = {};
    try {
      json = JSON.parse(txt || "{}");
    } catch {
      json = { raw: txt };
    }

    if (!r.ok) {
      const msg =
        json?.errors ||
        json?.error ||
        json?.message ||
        txt ||
        `Shopify REST ${r.status}`;

      throw new Error(String(msg));
    }

    return json;
  }

  async function shopifyGraphQL(query, variables = {}) {
        assertEnv();

    const url = `https://${SHOP}/admin/api/${GQL_VERSION}/graphql.json`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query, variables })
    });

    const text = await r.text();

    let data = {};
    try {
      data = JSON.parse(text || "{}");
    } catch {
      data = { raw: text };
    }

    if (!r.ok || data.errors) {
      throw new Error(JSON.stringify(data.errors || data || { status: r.status }));
    }

    return data.data;
  }

  async function addShopifyTag(orderGid, tag) {
    const id = safeStr(orderGid);
    const cleanTag = safeStr(tag);

    if (!id || !cleanTag) return { ok: false, skipped: true };

    const mutation = `
      mutation($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node { id }
          userErrors { field message }
        }
      }
    `;

    const data = await shopifyGraphQL(mutation, {
      id,
      tags: [cleanTag]
    });

    const err = data?.tagsAdd?.userErrors?.[0];

    if (err) {
      throw new Error(err.message || "فشل إضافة التاق");
    }

    return { ok: true };
  }
  
async function archiveShopifyOrder(orderGid) {
  const numericId = gidToNumeric(orderGid);

  if (!numericId) {
    return {
      ok: false,
      error: "Order ID غير صالح"
    };
  }

  try {
    const out = await shopifyREST(`/orders/${numericId}/close.json`, {
      method: "POST",
      body: {}
    });

    return {
      ok: true,
      response: out
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e)
    };
  }
}

  
  async function markCashOrderPaid(orderGid, amount) {
    const numericId = gidToNumeric(orderGid);
    const val = toNumber(amount);

    if (!numericId || !(val > 0)) {
      return {
        ok: true,
        skipped: true,
        reason: "NO_AMOUNT"
      };
    }

    try {
      const out = await shopifyREST(`/orders/${numericId}/transactions.json`, {
        method: "POST",
        body: {
          transaction: {
            kind: "sale",
            status: "success",
            amount: val.toFixed(3),
            gateway: "Cash"
          }
        }
      });

      return {
        ok: true,
        response: out
      };
    } catch (e) {
      return {
        ok: false,
        error: e?.message || String(e)
      };
    }
  }

  /* =========================================================
     New Finance Order Engine
     ========================================================= */

  function addDaysStr(day, amount) {
    const clean = normalizeDateInput(day);
    if (!clean) return "";

    const [y, m, d] = clean.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + Number(amount || 0));

    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");

    return `${yy}-${mm}-${dd}`;
  }

  function isLocalDayInsideRange(value, { from = "", to = "" } = {}) {
    const dFrom = normalizeDateInput(from);
    const dTo = normalizeDateInput(to);
    const day = localDayFromISO(value);

    if (!day) return false;
    if (dFrom && day < dFrom) return false;
    if (dTo && day > dTo) return false;

    return true;
  }

function makeOrdersQuery({ from, to }) {
  const parts = ["status:any"];

  /*
    للسرعة:
    نبحث في الطلبات التي حدث عليها تحديث قريب.
    الكاش يعتمد على وقت Delivered، وحدث Delivered يحدث updated_at في Shopify.
  */

  const cleanFrom = normalizeDateInput(from);
  const cleanTo = normalizeDateInput(to);

  const baseFrom = cleanFrom || todayMinus(MONEY_LOOKBACK_DAYS);
  const baseTo = cleanTo || new Date().toISOString().slice(0, 10);

  const shopFrom = addDaysStr(baseFrom, -1);
  const shopTo = addDaysStr(baseTo, 1);

  if (shopFrom) {
    parts.push(`updated_at:>=${shopFrom}`);
  }

  if (shopTo) {
    parts.push(`updated_at:<${addOneDay(shopTo)}`);
  }

  return parts.join(" ");
}  
  async function getShippingOverrides(r) {
    const map = await r.hGetAll(K_V2_SHIPPING_OVERRIDES);
    return map || {};
  }

  function getPaymentGatewayText(order) {
    const names = Array.isArray(order?.paymentGatewayNames)
      ? order.paymentGatewayNames
      : [];

    return names.map(safeStr).filter(Boolean).join(" ");
  }

  function getCustomerName(order) {
    const parts = [
      order?.customer?.firstName,
      order?.customer?.lastName
    ].map(safeStr).filter(Boolean);

    return parts.join(" ");
  }

function getShippingCompany(order) {
  const names = [];

  // 1) من بيانات التتبع داخل fulfillment
  for (const f of order?.fulfillments || []) {
    for (const t of f?.trackingInfo || []) {
      const c = safeStr(t?.company);
      if (c) names.push(c);
    }
  }

  // 2) fallback من shippingLines
  const shippingNodes = Array.isArray(order?.shippingLines?.nodes)
    ? order.shippingLines.nodes
    : [];

  for (const s of shippingNodes) {
    const title = safeStr(s?.title);
    const code = safeStr(s?.code);
    const carrier = safeStr(s?.carrierIdentifier);

    if (title) names.push(title);
    if (code) names.push(code);
    if (carrier) names.push(carrier);
  }

  // 3) fallback من التاقات لو عندك DHL كتاق
  const tags = normalizeTags(order?.tags);
  if (hasAnyTag(tags, ["DHL", "dhl", "دي اتش ال"])) {
    names.push("DHL");
  }

  return Array.from(new Set(names.filter(Boolean))).join(" ");
}
  
  function getLastFulfillmentEvent(order) {
    let best = null;
    let bestTs = -1;

    for (const f of order?.fulfillments || []) {
      const ev = f?.events?.nodes?.[0] || null;
      const status = safeStr(ev?.status);
      const happenedAt = safeStr(ev?.happenedAt);
      const fallback = safeStr(f?.createdAt);
      const ts = Date.parse(happenedAt || fallback || "") || -1;

      if (ts > bestTs) {
        bestTs = ts;
        best = {
          status,
          happenedAt,
          fulfillmentStatus: safeStr(f?.status)
        };
      }
    }

    return best || {
      status: "",
      happenedAt: "",
      fulfillmentStatus: ""
    };
  }

async function removeShopifyTag(orderGid, tag) {
  const id = safeStr(orderGid);
  const cleanTag = safeStr(tag);

  if (!id || !cleanTag) return { ok: false, skipped: true };

  const mutation = `
    mutation($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    id,
    tags: [cleanTag]
  });

  const err = data?.tagsRemove?.userErrors?.[0];

  if (err) {
    throw new Error(err.message || "فشل إزالة التاق");
  }

  return { ok: true };
}

async function updateShopifyOrderNote(orderGid, note) {
  const id = safeStr(orderGid);
  const finalNote = safeStr(note);

  if (!id) throw new Error("orderId مطلوب");

  const mutation = `
    mutation($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id note }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    input: {
      id,
      note: finalNote
    }
  });

  const err = data?.orderUpdate?.userErrors?.[0];

  if (err) {
    throw new Error(err.message || "فشل تحديث الملاحظة");
  }

  return {
    ok: true,
    note: data?.orderUpdate?.order?.note || finalNote
  };
}

async function createFulfillmentEvent(fulfillmentId, status) {
  const cleanFulfillmentId = safeStr(fulfillmentId);
  const cleanStatus = safeStr(status).toUpperCase();

  if (!cleanFulfillmentId) throw new Error("fulfillmentId مطلوب");

  if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(cleanStatus)) {
    throw new Error("status غير صحيح");
  }

  const mutation = `
    mutation($input: FulfillmentEventInput!) {
      fulfillmentEventCreate(fulfillmentEvent: $input) {
        fulfillmentEvent { id status happenedAt }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    input: {
      fulfillmentId: cleanFulfillmentId,
      status: cleanStatus
    }
  });

  const err = data?.fulfillmentEventCreate?.userErrors?.[0];

  if (err) {
    throw new Error(err.message || "فشل تحديث حالة التوصيل");
  }

  return {
    ok: true,
    event: data?.fulfillmentEventCreate?.fulfillmentEvent || null
  };
}

function deliveryDateRange(req) {
  /*
    صفحة المندوب لا نربطها باليوم أو أمس.
    تبدأ من تاريخ بداية التوصيل فقط حتى لا تختفي الطلبات.
  */
  return {
    from: DELIVERY_START_DATE,
    to: ""
  };
}

  
function deliveryOrderSearchMatches(row, q) {
  const clean = safeStr(q).replace(/^#+/, "").toLowerCase();
  if (!clean) return true;

  const name = safeStr(row.orderName).toLowerCase();
  const nameNoHash = name.replace(/^#+/, "");
  const numericId = safeStr(row.numericId).toLowerCase();

  return (
    name.includes(clean) ||
    nameNoHash.includes(clean) ||
    numericId.includes(clean)
  );
}

function deliveryStateFromOrder(order) {
  const tags = normalizeTags(order?.tags);
  const last = getLastFulfillmentEvent(order);

  const lastStatus = safeStr(last.status).toUpperCase();

  const delivered =
    lastStatus === "DELIVERED" ||
    hasTag(tags, DELIVERY_DONE_TAG) ||
    hasAnyTag(tags, ["Delivered", "DELIVERED", "تم التوصيل"]);

  const outForDelivery = !delivered && lastStatus === "OUT_FOR_DELIVERY";

  const fulfilled =
    Array.isArray(order?.fulfillments) &&
    order.fulfillments.length > 0;

  const withDriver =
    fulfilled &&
    !delivered &&
    !outForDelivery;

  return {
    delivered,
    outForDelivery,
    withDriver,
    lastStatus,
    lastAt: safeStr(last.happenedAt || last.createdAt || "")
  };
}

function makeDeliveryOrderRow(order, overrides = {}) {
  const tags = normalizeTags(order?.tags);
  const state = deliveryStateFromOrder(order);

  const id = safeStr(order?.id);
  const numericId = gidToNumeric(id);

  const total = toNumber(order?.totalPriceSet?.shopMoney?.amount);

  // نفس منطق النظام القديم:
  // يأخذ المتبقي من Shopify، ثم يخصم رسوم التوصيل من كل طلب حتى لو الطلب مدفوع بالكامل.
  const outstandingRaw = toNumber(order?.totalOutstandingSet?.shopMoney?.amount);
  const fee = calcDeliveryFee(order, overrides);
  const deliveryCollectAmount = money3(outstandingRaw - fee);

  const customer = getCustomerName(order);
  const shipping = order?.shippingAddress || {};

  const fulfillment = Array.isArray(order?.fulfillments)
    ? order.fulfillments[0]
    : null;

  const row = {
    id,
    numericId,
    orderName: safeStr(order?.name),
    createdAt: safeStr(order?.createdAt),
    updatedAt: safeStr(order?.updatedAt),
    note: safeStr(order?.note),

    tags,
    hasMuscat: hasTag(tags, DELIVERY_MUSCAT_TAG),
    settled: hasTag(tags, DELIVERY_SETTLED_TAG),
    cancelledDelivery: hasAnyTag(tags, DELIVERY_IGNORE_TAGS),

    customer: customer || safeStr(shipping?.name),
    phone: safeStr(shipping?.phone || order?.customer?.phone),
    city: safeStr(shipping?.city),
    address: [shipping?.address1, shipping?.address2].map(safeStr).filter(Boolean).join(" - "),

    financialStatus: safeStr(order?.displayFinancialStatus),
    total: money3(total),

    // هنا نخلي الظاهر والمجموع نفس النظام القديم
    outstanding: deliveryCollectAmount,
    deliveryFee: money3(fee),
    net: deliveryCollectAmount,

    fulfillmentId: safeStr(fulfillment?.id),
    delivered: state.delivered,
    outForDelivery: state.outForDelivery,
    withDriver: state.withDriver,
    lastDeliveryStatus: state.lastStatus,
    lastDeliveryAt: state.lastAt,

    shippingCompany: getShippingCompany(order) || "—"
  };

  row.statusText =
    row.cancelledDelivery ? "ملغي توصيل" :
    row.settled ? "مرحل" :
    row.delivered ? "تم التوصيل" :
    row.outForDelivery ? "خرج للتوصيل" :
    row.withDriver ? "مع المندوب" :
    "غير محدد";

  return row;
}

function deliveryBucketRows(rows, { from, to, q } = {}) {
  const filtered = (rows || [])
    .filter((x) => !x.cancelledDelivery)
    .filter((x) => x.hasMuscat)
    .filter((x) => deliveryOrderSearchMatches(x, q));

  /*
    لا نفلتر صفحة المندوب بالتاريخ.
    الطلبات قليلة ولازم تظهر كلها حسب حالتها.
  */
  const readyToSettle = filtered.filter((x) => {
    return x.delivered && !x.settled;
  });

const deliveredAll = filtered.filter((x) => {
  return x.delivered && !x.settled;
});

  
  const outForDelivery = filtered.filter((x) => {
    return x.outForDelivery;
  });

  const withDriver = filtered.filter((x) => {
    return x.withDriver;
  });

  const settled = filtered.filter((x) => {
    return x.settled;
  });

  return {
    readyToSettle,
    deliveredAll,
    outForDelivery,
    withDriver,
    settled
  };
}

  
function deliveryTotals(rows = []) {
  const count = rows.length;
  const total = rows.reduce((s, x) => s + toNumber(x.total), 0);
  const outstanding = rows.reduce((s, x) => s + toNumber(x.outstanding), 0);
  const delivery = rows.reduce((s, x) => s + toNumber(x.deliveryFee), 0);
  const net = rows.reduce((s, x) => s + toNumber(x.net), 0);

  return {
    count,
    total: money3(total),
    outstanding: money3(outstanding),
    delivery: money3(delivery),
    net: money3(net)
  };
}

async function fetchDeliveryAdminOrders(r, { from = "", to = "", q = "" } = {}) {
  const overrides = await getShippingOverrides(r);

const shopFrom = addDaysStr(from || DELIVERY_START_DATE, -1);
const shopTo = to ? addDaysStr(to, 1) : "";
  
  const queryText = [
    "status:any",
    `tag:${DELIVERY_MUSCAT_TAG}`,
    shopFrom ? `updated_at:>=${shopFrom}` : "",
    shopTo ? `updated_at:<${addOneDay(shopTo)}` : ""
  ].filter(Boolean).join(" ");

  const query = `
    query($q: String!, $n: Int!, $after: String) {
      orders(first: $n, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          note
          createdAt
          updatedAt
          cancelledAt
          closed
          tags
          displayFinancialStatus

          paymentGatewayNames

          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }

          totalOutstandingSet {
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
            countryCodeV2
          }

          shippingLines(first: 10) {
            nodes {
              title
              code
              carrierIdentifier
            }
          }

          fulfillments(first: 10) {
            id
            status
            createdAt
            trackingInfo {
              number
              company
              url
            }
            events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
              nodes {
                status
                happenedAt
              }
            }
          }
        }
      }
    }
  `;

  const allRows = [];
  let after = null;
  let pageNo = 0;

  do {
    pageNo++;

    const data = await shopifyGraphQL(query, {
      q: queryText,
      n: 250,
      after
    });

    const page = data?.orders;
    const nodes = page?.nodes || [];

    for (const order of nodes) {
      if (order?.cancelledAt) continue;

      const row = makeDeliveryOrderRow(order, overrides);

      if (!row.numericId || !row.orderName) continue;
      if (!row.hasMuscat) continue;

      allRows.push(row);
    }

    after = page?.pageInfo?.hasNextPage ? page?.pageInfo?.endCursor : null;

    if (pageNo >= 8) break;
  } while (after);

  const buckets = deliveryBucketRows(allRows, { from, to, q });

  return {
    query: queryText,
    allRows,
    buckets,
    totals: {
      readyToSettle: deliveryTotals(buckets.readyToSettle),
      deliveredAll: deliveryTotals(buckets.deliveredAll),
      outForDelivery: deliveryTotals(buckets.outForDelivery),
      withDriver: deliveryTotals(buckets.withDriver),
      settled: deliveryTotals(buckets.settled),
      all: deliveryTotals(allRows.filter((x) => !x.cancelledDelivery))
    }
  };
}


  
  function isDeliveredOrder(order) {
    const last = getLastFulfillmentEvent(order);
    const ev = safeStr(last.status).toUpperCase();

    if (ev === "DELIVERED") return true;

    const tags = normalizeTags(order?.tags);

    if (hasAnyTag(tags, ["تم", "Delivered", "DELIVERED", "تم التوصيل"])) {
      return true;
    }

    return false;
  }

  function calcDeliveryFee(order, overrideMap) {
    const id = gidToNumeric(order?.id);
    const gid = safeStr(order?.id);

    if (overrideMap && overrideMap[id] !== undefined) {
      return money3(overrideMap[id]);
    }

    if (overrideMap && overrideMap[gid] !== undefined) {
      return money3(overrideMap[gid]);
    }

    const tags = normalizeTags(order?.tags);
    const company = lower(getShippingCompany(order));

    const isOffice = hasTag(tags, "مكتب");
    const isMuscatOrConfirm = hasAnyTag(tags, ["مسقط", "تاكيد", "تأكيد"]);

    if (isOffice && company.includes("dhl")) {
      return money3(DELIVERY_FEE_DHL_OFFICE);
    }

    if (isOffice) {
      return money3(DELIVERY_FEE_OFFICE);
    }

    if (isMuscatOrConfirm) {
      return money3(DELIVERY_FEE_MUSCAT);
    }

    return 0;
  }

  function classifyFinanceOrder(order, overrideMap = {}) {
    if (order?.cancelledAt) {
  return {
    ignored: true,
    reason: "CANCELLED"
  };
}
    const tags = normalizeTags(order?.tags);
if (hasAnyTag(tags, DELIVERY_IGNORE_TAGS)) {
  return {
    ignored: true,
    reason: "DELIVERY_CANCELLED"
  };
}
    
    const id = safeStr(order?.id);
    const numericId = gidToNumeric(id);

    const gatewayText = getPaymentGatewayText(order);
    const gw = lower(gatewayText);

    const financial = safeStr(order?.displayFinancialStatus).toUpperCase();

const total = toNumber(order?.totalPriceSet?.shopMoney?.amount);
const outstanding = toNumber(order?.totalOutstandingSet?.shopMoney?.amount);

const hasBankConfirmTag = hasAnyTag(tags, [
  "مدفوع",
  "تحويل",
  "تحويل بنكي"
]);

let paid = 0;

if (hasBankConfirmTag) {
  // التاق هنا يعتبر تأكيد أن التحويل وصل
  paid = total;
} else if (financial === "PAID") {
  paid = total;
} else if (financial === "PARTIALLY_PAID") {
  paid = Math.max(0, total - outstanding);
} else {
  paid = Math.max(0, total - outstanding);
}
    const delivered = isDeliveredOrder(order);
    const lastEvent = getLastFulfillmentEvent(order);

    let section = "OTHER";

    const isAmwal =
      gw.includes("amwal") ||
      gw.includes("أموال") ||
      gw.includes("اموال");

const isBank = hasBankConfirmTag;
    
    const isCash =
      delivered &&
      (
        financial === "PENDING" ||
        financial === "UNPAID" ||
        financial === "PARTIALLY_PAID" ||
        outstanding > 0
      );

    const isMuscatCash = hasTag(tags, "مسقط");

    if (isAmwal) {
      section = "AMWAL";
    } else if (isBank) {
      section = "BANK";
    } else if (isCash && isMuscatCash) {
      section = "CASH_MUSCAT";
    } else if (isCash) {
      section = "CASH_DALILI";
    }

    const deliveryFee = calcDeliveryFee(order, overrideMap);

    const isCashSection = section === "CASH_MUSCAT" || section === "CASH_DALILI" || section === "CASH";

    const gross = isCashSection
      ? (outstanding > 0 ? outstanding : total)
      : paid;

    const net = Math.max(0, gross - deliveryFee);

    const shippingCompany = getShippingCompany(order);

    return {
      id,
      numericId,
      orderName: safeStr(order?.name),
      customer: getCustomerName(order),
      createdAt: safeStr(order?.createdAt),
updatedAt: safeStr(order?.updatedAt),
financeDateAt:
  section === "CASH_MUSCAT" || section === "CASH_DALILI" || section === "CASH"
    ? safeStr(lastEvent.happenedAt || order?.updatedAt || order?.createdAt)
    : safeStr(order?.createdAt),
      tags,
      gateway: gatewayText || "—",

      financialStatus: financial,
      statusText:
        financial === "PAID"
          ? "مدفوع"
          : financial === "PARTIALLY_PAID"
            ? "مدفوع جزئي"
            : financial === "PENDING"
              ? "غير مدفوع"
              : financial || "—",

      total: money3(total),
      paid: money3(paid),
      outstanding: money3(outstanding),

      delivered,
      lastDeliveryStatus: safeStr(lastEvent.status),
      lastDeliveryAt: safeStr(lastEvent.happenedAt),
      fulfillmentStatus: safeStr(lastEvent.fulfillmentStatus),

      shippingCompany: shippingCompany || "—",
      deliveryFee: money3(deliveryFee),

      section,
      gross: money3(gross),
      net: money3(net),

      cashAmount: section === "CASH_MUSCAT" || section === "CASH_DALILI" ? money3(gross) : 0,
      cashKind:
        section === "CASH_MUSCAT"
          ? "MUSCAT"
          : section === "CASH_DALILI"
            ? "DALILI"
            : "",
      remainingText:
        financial === "PARTIALLY_PAID"
          ? `المتبقي: ${money3(outstanding)}`
          : ""
    };
  }

  async function fetchFinanceOrders(r, {
    from,
    to,
    includeTransferred = false,
    maxPages = 20
  } = {}) {
    const overrides = await getShippingOverrides(r);

    const transferredSet = includeTransferred
      ? new Set()
      : new Set(await r.sMembers(K_V2_TRANSFERRED_IDS));

    const queryText = makeOrdersQuery({ from, to });

    const query = `
      query($q: String!, $n: Int!, $after: String) {
        orders(first: $n, after: $after, query: $q, sortKey: CREATED_AT, reverse: false) {
          pageInfo {
            hasNextPage
            endCursor
          }
nodes {
  id
  name
  createdAt
  updatedAt
  cancelledAt
  closed
  tags
  displayFinancialStatus
  paymentGatewayNames
  shippingLines(first: 10) {
  nodes {
    title
    code
    carrierIdentifier
  }
}

            customer {
              firstName
              lastName
            }

            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            totalOutstandingSet {
              shopMoney {
                amount
                currencyCode
              }
            }

            fulfillments(first: 10) {
              id
              status
              createdAt
              trackingInfo {
                number
                company
              }
              events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
                nodes {
                  status
                  happenedAt
                }
              }
            }
          }
        }
      }
    `;

    const rows = [];

    let after = null;
    let pageNo = 0;
    let fetchedFromShopify = 0;

    do {
      pageNo++;

      const data = await shopifyGraphQL(query, {
        q: queryText,
        n: 250,
        after
      });

      const page = data?.orders;
      const nodes = page?.nodes || [];

      fetchedFromShopify += nodes.length;

      for (const order of nodes) {
const row = classifyFinanceOrder(order, overrides);

if (row?.ignored) {
  continue;
}

if (!row.numericId || !row.orderName) {
  continue;
}

const dateForFinance =
  row.section === "CASH_MUSCAT" || row.section === "CASH_DALILI" || row.section === "CASH"
    ? row.financeDateAt || row.lastDeliveryAt || row.updatedAt || row.createdAt
    : row.createdAt;

if (!isLocalDayInsideRange(dateForFinance, { from, to })) {
  continue;
}

row.localCreatedDay = localDayFromISO(row.createdAt);
row.localFinanceDay = localDayFromISO(dateForFinance);
row.financeDateAt = dateForFinance;

        
if (!includeTransferred && transferredSet.has(row.numericId)) {
  continue;
}
        if (row.section === "OTHER") {
          continue;
        }

        rows.push(row);
      }

      after = page?.pageInfo?.hasNextPage ? page?.pageInfo?.endCursor : null;

      if (pageNo >= maxPages) break;
    } while (after);

    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return {
      queryText,
      fetchedFromShopify,
      rows
    };
  }

function emptyFinanceTotal() {
  return {
    count: 0,
    gross: 0,
    delivery: 0,
    net: 0,
    total: 0,
    paid: 0,
    outstanding: 0,

    // كاش المندوب الفعلي لمسقط:
    // طلبات كاش مسقط بالصافي - توصيل الطلبات المدفوعة التي يدفعها كاش مسقط
    courierCash: 0,
    paidDeliveryCoveredByCash: 0
  };
}

function buildFinanceTotals(rows) {
  const totals = {
    amwal: emptyFinanceTotal(),
    bank: emptyFinanceTotal(),
    cashMuscat: emptyFinanceTotal(),
    cashDalili: emptyFinanceTotal(),
    cash: emptyFinanceTotal(),
    all: emptyFinanceTotal()
  };

  for (const row of rows || []) {
    const key =
      row.section === "AMWAL"
        ? "amwal"
        : row.section === "BANK"
          ? "bank"
          : row.section === "CASH_MUSCAT"
            ? "cashMuscat"
            : row.section === "CASH_DALILI"
              ? "cashDalili"
              : row.section === "CASH"
                ? "cashMuscat"
                : null;

    if (!key) continue;

    totals[key].count += 1;
    totals[key].gross += toNumber(row.gross);
    totals[key].delivery += toNumber(row.deliveryFee);
    totals[key].net += toNumber(row.net);
    totals[key].total += toNumber(row.total);
    totals[key].paid += toNumber(row.paid);
    totals[key].outstanding += toNumber(row.outstanding);

const muscatEffect = cashMuscatCourierEffect(row);
const daliliEffect = cashDaliliCourierEffect(row);

if (muscatEffect !== 0) {
  totals.cashMuscat.courierCash += muscatEffect;

  if (isPaidDeliveryCoveredByCash(row) && paidDeliveryCashSourceKey(row) === "cashMuscat") {
    totals.cashMuscat.paidDeliveryCoveredByCash += toNumber(row.deliveryFee);
  }
}

if (daliliEffect !== 0) {
  totals.cashDalili.courierCash += daliliEffect;

  if (isPaidDeliveryCoveredByCash(row) && paidDeliveryCashSourceKey(row) === "cashDalili") {
    totals.cashDalili.paidDeliveryCoveredByCash += toNumber(row.deliveryFee);
  }
}
  }

  for (const k of ["cashMuscat", "cashDalili"]) {
    totals.cash.count += totals[k].count;
    totals.cash.gross += totals[k].gross;
    totals.cash.delivery += totals[k].delivery;
    totals.cash.net += totals[k].net;
    totals.cash.total += totals[k].total;
    totals.cash.paid += totals[k].paid;
    totals.cash.outstanding += totals[k].outstanding;
    totals.cash.courierCash += totals[k].courierCash;
    totals.cash.paidDeliveryCoveredByCash += totals[k].paidDeliveryCoveredByCash;
  }

  for (const k of ["amwal", "bank", "cashMuscat", "cashDalili"]) {
    totals.all.count += totals[k].count;
    totals.all.gross += totals[k].gross;
    totals.all.delivery += totals[k].delivery;
    totals.all.net += totals[k].net;
    totals.all.total += totals[k].total;
    totals.all.paid += totals[k].paid;
    totals.all.outstanding += totals[k].outstanding;
    totals.all.courierCash += totals[k].courierCash;
    totals.all.paidDeliveryCoveredByCash += totals[k].paidDeliveryCoveredByCash;
  }

  for (const group of Object.values(totals)) {
    for (const k of Object.keys(group)) {
      if (k !== "count") group[k] = money3(group[k]);
    }
  }

  return totals;
}

function isPaidFinanceSection(section) {
  const s = safeStr(section).toUpperCase();
  return s === "AMWAL" || s === "BANK";
}

function isExternalShippingOrder(row) {
  const company = lower(
    row?.shippingCompany ||
    row?.shippingTitle ||
    row?.deliveryCompany ||
    row?.shippingMethod ||
    ""
  );

  const tags = normalizeTags(row?.tags);

  if (
    company.includes("dhl") ||
    company.includes("دي اتش") ||
    company.includes("دي إتش") ||
    company.includes("مكتب") ||
    company.includes("office")
  ) {
    return true;
  }

  if (
    hasAnyTag(tags, [
      "DHL",
      "dhl",
      "دي اتش ال",
      "دي إتش إل",
      "مكتب",
      "استلام من المكتب",
      "استلام مكتب"
    ])
  ) {
    return true;
  }

  return false;
}


function isPaidDeliveryCoveredByCash(row) {
  const deliveryFee = money3(row?.deliveryFee);

  return (
    isPaidFinanceSection(row?.section) &&
    !isExternalShippingOrder(row) &&
    deliveryFee > 0
  );
}



  
function isMuscatDeliveryRow(row) {
  const tags = normalizeTags(row?.tags);
  const company = lower(
    row?.shippingCompany ||
    row?.shippingTitle ||
    row?.deliveryCompany ||
    row?.shippingMethod ||
    ""
  );

  return (
    hasTag(tags, DELIVERY_MUSCAT_TAG) ||
    hasTag(tags, "مسقط") ||
    company.includes("مسقط") ||
    company.includes("muscat")
  );
}

function paidDeliveryCashSourceKey(row) {
  if (!isPaidDeliveryCoveredByCash(row)) return "";

  return isMuscatDeliveryRow(row)
    ? "cashMuscat"
    : "cashDalili";
}

function paidDeliveryCashSourceAccount(row) {
  const key = paidDeliveryCashSourceKey(row);

  if (key === "cashMuscat") return LEDGER_ACCOUNTS.CASH_MUSCAT;
  if (key === "cashDalili") return LEDGER_ACCOUNTS.DALILI_PENDING;

  return "";
}

function courierCashEffect(row, key) {
  const section = safeStr(row?.section).toUpperCase();
  const net = money3(row?.net);
  const deliveryFee = money3(row?.deliveryFee);

  if (key === "cashMuscat" && (section === "CASH_MUSCAT" || section === "CASH")) {
    return net;
  }

  if (key === "cashDalili" && section === "CASH_DALILI") {
    return net;
  }

  if (isPaidDeliveryCoveredByCash(row) && paidDeliveryCashSourceKey(row) === key) {
    return money3(-deliveryFee);
  }

  return 0;
}

function cashMuscatCourierEffect(row) {
  return courierCashEffect(row, "cashMuscat");
}

function cashDaliliCourierEffect(row) {
  return courierCashEffect(row, "cashDalili");
}
  
  
function financeTransferAmount(row) {
  const gross = money3(row?.gross);
  const deliveryFee = money3(row?.deliveryFee);
  const net = money3(row?.net);

  
  if (isPaidFinanceSection(row?.section)) {
    if (isExternalShippingOrder(row)) {
      return money3(Math.max(0, gross - deliveryFee));
    }

    return gross;
  }

  return net;
}

  
function buildSettlementBreakdown(rows = []) {
  const out = {
    paidOrdersGross: 0,

    paidDeliveryCoveredByCash: 0,
    paidExternalShippingDeducted: 0,
    paidOrdersTransfer: 0,

    amwalGross: 0,
    amwalDeliveryCoveredByCash: 0,
    amwalExternalShippingDeducted: 0,
    amwalTransfer: 0,

    bankGross: 0,
    bankDeliveryCoveredByCash: 0,
    bankExternalShippingDeducted: 0,
    bankTransfer: 0,

    cashNet: 0,

    cashMuscatCourierNet: 0,
    cashMuscatPaidDeliveryDeducted: 0,

    cashDaliliCourierNet: 0,
    cashDaliliPaidDeliveryDeducted: 0,

    allTransferAmount: 0
  };

  for (const row of rows || []) {
    const section = safeStr(row.section).toUpperCase();
    const gross = toNumber(row.gross);
    const deliveryFee = toNumber(row.deliveryFee);
    const net = toNumber(row.net);
    const transferAmount = financeTransferAmount(row);

    const isPaid = isPaidFinanceSection(section);
    const isExternal = isPaid && isExternalShippingOrder(row);
    const paidDeliveryCoveredByCash = isPaidDeliveryCoveredByCash(row);
    const deliveryCashKey = paidDeliveryCashSourceKey(row);

    out.cashMuscatCourierNet += cashMuscatCourierEffect(row);
    out.cashDaliliCourierNet += cashDaliliCourierEffect(row);

    if (paidDeliveryCoveredByCash) {
      if (deliveryCashKey === "cashMuscat") {
        out.cashMuscatPaidDeliveryDeducted += deliveryFee;
      }

      if (deliveryCashKey === "cashDalili") {
        out.cashDaliliPaidDeliveryDeducted += deliveryFee;
      }
    }

    out.allTransferAmount += transferAmount + (paidDeliveryCoveredByCash ? -deliveryFee : 0);

    if (section === "AMWAL") {
      out.paidOrdersGross += gross;
      out.paidOrdersTransfer += transferAmount;

      out.amwalGross += gross;
      out.amwalTransfer += transferAmount;

      if (isExternal) {
        out.paidExternalShippingDeducted += deliveryFee;
        out.amwalExternalShippingDeducted += deliveryFee;
      } else {
        out.paidDeliveryCoveredByCash += deliveryFee;
        out.amwalDeliveryCoveredByCash += deliveryFee;
      }
    } else if (section === "BANK") {
      out.paidOrdersGross += gross;
      out.paidOrdersTransfer += transferAmount;

      out.bankGross += gross;
      out.bankTransfer += transferAmount;

      if (isExternal) {
        out.paidExternalShippingDeducted += deliveryFee;
        out.bankExternalShippingDeducted += deliveryFee;
      } else {
        out.paidDeliveryCoveredByCash += deliveryFee;
        out.bankDeliveryCoveredByCash += deliveryFee;
      }
    } else {
      out.cashNet += net;
    }
  }

  for (const k of Object.keys(out)) {
    out[k] = money3(out[k]);
  }

  return out;
}
  
  
  
  function splitFinanceRows(rows) {
    const cashMuscat = rows.filter((x) => x.section === "CASH_MUSCAT" || x.section === "CASH");
    const cashDalili = rows.filter((x) => x.section === "CASH_DALILI");

    return {
      amwal: rows.filter((x) => x.section === "AMWAL"),
      bank: rows.filter((x) => x.section === "BANK"),
      cashMuscat,
      cashDalili,
      cash: [...cashMuscat, ...cashDalili]
    };
  }

  function oldCompatibleSummary(v2) {
    return {
      sinceISO: v2.from || null,
      counts: {
        amwal: v2.lists.amwal.length,
        bank: v2.lists.bank.length,
        other: 0,
        cash: v2.lists.cash.length,
        manual: v2.lists.bank.length
      },
      totals: {
        amwal: v2.totals.amwal.net,
        bank: v2.totals.bank.net,
        other: 0,
        cash: v2.totals.cash.net,
        manual: v2.totals.bank.net,
        all: v2.totals.all.net
      },
      lists: {
        amwal: v2.lists.amwal.map(toOldOrderShape),
        bank: v2.lists.bank.map(toOldOrderShape),
        other: [],
        cash: v2.lists.cash.map(toOldOrderShape),
        manual: v2.lists.bank.map(toOldOrderShape)
      }
    };
  }

  function toOldOrderShape(x) {
    return {
      id: x.numericId,
      orderName: x.orderName,
      customer: x.customer,
      createdAt: x.createdAt,
      at: x.createdAt,
      financialStatus: x.financialStatus,
      paid: x.net,
      gross: x.gross,
      deliveryFee: x.deliveryFee,
      outstanding: x.outstanding,
      gateway: x.gateway,
      tags: x.tags
    };
  }

  /* =========================================================
     V2 API: Summary
     ========================================================= */
  router.get("/api/money/v2/summary", requireAdminKey, async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const { from, to } = buildDateRange(req);

      const out = await fetchFinanceOrders(r, {
        from,
        to,
        includeTransferred: false
      });

const totals = buildFinanceTotals(out.rows);
totals.settlement = buildSettlementBreakdown(out.rows);

const lists = splitFinanceRows(out.rows);

      
      const ledger = {
        balances: await getLedgerBalances(r),
        entries: await readLedgerEntries(r, { from, to, limit: 200 }),
      };
      ledger.totals = ledgerTotals(ledger.entries);

      return res.json({
        ok: true,
        from,
        to,
        query: out.queryText,
        fetchedFromShopify: out.fetchedFromShopify,
        totals,
        lists,
        ledger
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /* =========================================================
     V2 API: Ledger / Settlements
     ========================================================= */
  router.get("/api/money/v2/ledger", requireAdminKey, async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const { from, to } = buildDateRange(req);
      const entries = await readLedgerEntries(r, { from, to, limit: 1000 });

      const debtsRaw = await r.hGetAll(K_DEBTS);
      const debtTotal = Object.values(debtsRaw || {}).reduce((sum, amount) => {
                const v = toNumber(amount);
        return sum + (v > 0 ? v : 0);
      }, 0);

      return res.json({
        ok: true,
        from,
        to,
        balances: await getLedgerBalances(r),
        entries,
        totals: ledgerTotals(entries),
        accounts: {
          cash_muscat: ledgerAccountLabel(LEDGER_ACCOUNTS.CASH_MUSCAT),
          dalili_pending: ledgerAccountLabel(LEDGER_ACCOUNTS.DALILI_PENDING),
          amwal_pending: ledgerAccountLabel(LEDGER_ACCOUNTS.AMWAL_PENDING),
          bank: ledgerAccountLabel(LEDGER_ACCOUNTS.BANK)
        },
        debtsTotal: money3(debtTotal)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.post("/api/money/v2/settle", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const sourceRaw = safeStr(req.body?.source || req.body?.from);
      const amount = toNumber(req.body?.amount);
      const note = safeStr(req.body?.note);

      const fromAcc = normalizeLedgerAccount(sourceRaw);

      if (![LEDGER_ACCOUNTS.AMWAL_PENDING, LEDGER_ACCOUNTS.DALILI_PENDING].includes(fromAcc)) {
        return res.status(400).json({ error: "مصدر التحويل لازم يكون أموال أو دليلي" });
      }

      if (!(amount > 0)) {
        return res.status(400).json({ error: "المبلغ لازم > 0" });
      }

      const rec = await addLedgerMovement(r, {
        type: "SETTLEMENT",
        amount,
        from: fromAcc,
        to: LEDGER_ACCOUNTS.BANK,
        note: note || `تحويل من ${ledgerAccountLabel(fromAcc)} إلى الحساب البنكي`,
        refType: "SETTLEMENT"
      });

      const push = await notifyMoney(r, {
        title: "وصل تحويل للحساب البنكي",
        body: `تم تحويل ${money3(amount)} ر.ع من ${ledgerAccountLabel(fromAcc)} إلى الحساب البنكي`,
        tag: "money-settlement",
        url: "/k/"
      });

      return res.json({
        ok: true,
        movement: rec,
        balances: await getLedgerBalances(r),
        push
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

router.post("/api/money/v2/manual-add", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) {
      return res.status(500).json({
        error: "REDIS_URL غير مضبوط"
      });
    }

    const account = normalizeLedgerAccount(req.body?.account);
    const amount = toNumber(req.body?.amount);
    const note = safeStr(req.body?.note || req.body?.reason);

    const allowed = [
      LEDGER_ACCOUNTS.CASH_MUSCAT,
      LEDGER_ACCOUNTS.BANK
    ];

    if (!allowed.includes(account)) {
      return res.status(400).json({
        error: "اختار الحساب: كاش مسقط أو الحساب البنكي"
      });
    }

    if (!(amount > 0)) {
      return res.status(400).json({
        error: "المبلغ لازم يكون أكبر من صفر"
      });
    }

    if (!note) {
      return res.status(400).json({
        error: "اكتب السبب"
      });
    }

    const movement = await addLedgerMovement(r, {
      type: "MANUAL_ADD",
      amount,
      to: account,
      note,
      refType: "MANUAL_ADD",
      meta: {
        manual: true,
        account,
        reason: note
      }
    });

    const push = await notifyMoney(r, {
      title: "تمت إضافة مبلغ يدوي",
      body: `${money3(amount)} ر.ع إلى ${ledgerAccountLabel(account)} - السبب: ${note}`,
      tag: "manual-add",
      url: "/k/"
    });

    return res.json({
      ok: true,
      movement,
      balances: await getLedgerBalances(r),
      push
    });
  } catch (e) {
    return res.status(500).json({
      error: e?.message || String(e)
    });
  }
});

  
  /* =========================================================
     V2 API: Shipping Override
     ========================================================= */
  router.post("/api/money/v2/shipping", requireAdminKey, express.json({ limit: "300kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const orderIdRaw = safeStr(req.body?.orderId);
      const fee = toNumber(req.body?.fee);

      if (!orderIdRaw) {
        return res.status(400).json({ error: "orderId مطلوب" });
      }

      if (fee < 0) {
        return res.status(400).json({ error: "مبلغ التوصيل غير صحيح" });
      }

      const orderId = gidToNumeric(orderIdRaw);

      await r.hSet(K_V2_SHIPPING_OVERRIDES, orderId, String(money3(fee)));

      return res.json({
        ok: true,
        orderId,
        fee: money3(fee)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.delete("/api/money/v2/shipping/:orderId", requireAdminKey, async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const orderId = gidToNumeric(req.params.orderId);

      await r.hDel(K_V2_SHIPPING_OVERRIDES, orderId);

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });


async function fetchFinanceOrdersByIds(r, ids = [], { includeTransferred = false } = {}) {
  const cleanIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((x) => gidToNumeric(x))
      .filter(Boolean)
  )];

  if (!cleanIds.length) {
    return {
      queryText: "ids:",
      fetchedFromShopify: 0,
      rows: []
    };
  }

  const overrides = await getShippingOverrides(r);

  const transferredSet = includeTransferred
    ? new Set()
    : new Set(await r.sMembers(K_V2_TRANSFERRED_IDS));

  const gids = cleanIds.map((id) => `gid://shopify/Order/${id}`);

  const query = `
    query($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Order {
          id
          name
          createdAt
          updatedAt
          cancelledAt
          closed
          tags
          displayFinancialStatus
          paymentGatewayNames

          shippingLines(first: 10) {
            nodes {
              title
              code
              carrierIdentifier
            }
          }

          customer {
            firstName
            lastName
          }

          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }

          totalOutstandingSet {
            shopMoney {
              amount
              currencyCode
            }
          }

          fulfillments(first: 10) {
            id
            status
            createdAt
            trackingInfo {
              number
              company
            }
            events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
              nodes {
                status
                happenedAt
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(query, { ids: gids });
  const nodes = Array.isArray(data?.nodes) ? data.nodes.filter(Boolean) : [];

  const rows = [];

  for (const order of nodes) {
    const row = classifyFinanceOrder(order, overrides);

    if (row?.ignored) continue;
    if (!row.numericId || !row.orderName) continue;
    if (!includeTransferred && transferredSet.has(row.numericId)) continue;
    if (row.section === "OTHER") continue;

    const dateForFinance =
      row.section === "CASH_MUSCAT" || row.section === "CASH_DALILI" || row.section === "CASH"
        ? row.financeDateAt || row.lastDeliveryAt || row.updatedAt || row.createdAt
        : row.createdAt;

    row.localCreatedDay = localDayFromISO(row.createdAt);
    row.localFinanceDay = localDayFromISO(dateForFinance);
    row.financeDateAt = dateForFinance;

    rows.push(row);
  }

  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  return {
    queryText: `ids:${cleanIds.join(",")}`,
    fetchedFromShopify: nodes.length,
    rows
  };
}
  
  /* =========================================================
     V2 API: Transfer
     ========================================================= */
router.post("/api/money/v2/transfer", requireAdminKey, express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const { from, to } = buildDateRange(req);

    const typeRaw = safeStr(req.body?.type || "ALL").toUpperCase();
    const allowedTypes = ["ALL", "AMWAL", "BANK", "CASH", "CASH_MUSCAT", "CASH_DALILI"];
    const type = allowedTypes.includes(typeRaw) ? typeRaw : "ALL";

    const note = safeStr(req.body?.note);

    const selectedIds = Array.isArray(req.body?.orderIds)
      ? req.body.orderIds.map((x) => gidToNumeric(x)).filter(Boolean)
      : [];

const out = selectedIds.length
  ? await fetchFinanceOrdersByIds(r, selectedIds, {
      includeTransferred: false
    })
  : await fetchFinanceOrders(r, {
      from,
      to,
      includeTransferred: false
    });

let rows = out.rows;
    
    if (type !== "ALL") {
      if (type === "CASH") {
        rows = rows.filter((x) => x.section === "CASH_MUSCAT" || x.section === "CASH_DALILI" || x.section === "CASH");
      } else {
        rows = rows.filter((x) => x.section === type);
      }
    }

    if (selectedIds.length) {
      const set = new Set(selectedIds);
      rows = rows.filter((x) => set.has(x.numericId));
    }

    if (!rows.length) {
      return res.status(400).json({ error: "لا توجد طلبات للترحيل" });
    }

    const batchId = uuid();
    const at = new Date().toISOString();

    const failures = [];
    const actions = [];

    for (const row of rows) {
      if (row.section === "CASH_MUSCAT" || row.section === "CASH") {
        /*
          الكاش حسب طلبك:
          - يضيف تاق "انتهت"
          - يعمل Archive للطلب في Shopify
          - لا يضيف تاق "مدفوع"
          - لا يحاول تحويل الطلب إلى مدفوع
        */

        try {
          await addShopifyTag(row.id, CASH_ENDED_TAG);

          actions.push({
            orderName: row.orderName,
            action: "ADD_TAG",
            tag: CASH_ENDED_TAG,
            ok: true
          });
        } catch (e) {
          failures.push({
            orderName: row.orderName,
            step: "ADD_ENDED_TAG",
            error: e?.message || String(e)
          });
        }

        const archived = await archiveShopifyOrder(row.id);

        if (!archived.ok) {
          failures.push({
            orderName: row.orderName,
            step: "ARCHIVE_ORDER",
            error: archived.error
          });
        } else {
          actions.push({
            orderName: row.orderName,
            action: "ARCHIVE_ORDER",
            ok: true
          });
        }
      } else {
        /*
          أموال / تحويل بنكي:
          فقط نضيف تاق مرحّل مالي
          ونحفظ الطلب في أرشيف النظام
        */

        try {
          await addShopifyTag(row.id, FINANCE_TRANSFERRED_TAG);

          actions.push({
            orderName: row.orderName,
            action: "ADD_TAG",
            tag: FINANCE_TRANSFERRED_TAG,
            ok: true
          });
        } catch (e) {
          failures.push({
            orderName: row.orderName,
            step: "ADD_FINANCE_TAG",
            error: e?.message || String(e)
          });
        }
      }

      /*
        حتى لو فشل التاق أو الأرشفة في Shopify،
        نحفظ الطلب كمرحّل في النظام حتى لا يرجع في الملخص.
        إذا تريد ألا يختفي إلا عند نجاح كل العمليات، قل لي وأعدّلها.
      */
const ledgerTo = sectionToLedgerAccount(row.section);

if (ledgerTo) {
  const gross = money3(row.gross);
  const deliveryFee = money3(row.deliveryFee);
  const net = money3(row.net);
  const transferAmount = financeTransferAmount(row);

  const isPaidSection = isPaidFinanceSection(row.section);
  const isExternalShipping = isPaidSection && isExternalShippingOrder(row);
  const deliveryCoveredByCash = isPaidDeliveryCoveredByCash(row);

  const deliveryCashAccount = paidDeliveryCashSourceAccount(row);
  const deliveryCashLabel = deliveryCashAccount
    ? ledgerAccountLabel(deliveryCashAccount)
    : "الكاش";

  await addLedgerMovement(r, {
    type: "ORDER_TRANSFER",
    amount: transferAmount,
    to: ledgerTo,
    note: isPaidSection
      ? (
          isExternalShipping
            ? `ترحيل طلب مدفوع ${row.orderName}: قيمة الطلب ${gross} - شحن خارجي ${deliveryFee} = ${transferAmount}`
            : `ترحيل طلب مدفوع ${row.orderName}: قيمة الطلب ${gross} كاملة، والتوصيل ${deliveryFee} يخصم من ${deliveryCashLabel}`
        )
      : `ترحيل طلب كاش ${row.orderName}: الصافي بعد خصم التوصيل ${net}`,
    refId: row.numericId,
    refType: "ORDER",
    meta: {
      orderName: row.orderName,
      section: row.section,
      gross,
      deliveryFee,
      net,
      transferAmount,

      paidOrderFullAmount: isPaidSection && !isExternalShipping,
      deliveryCoveredByCash,
      deliveryCashSource: deliveryCashAccount,
      externalShippingDeducted: isExternalShipping,
      cashOrderDeliveryDeducted: !isPaidSection,
      cashMuscatCourierEffect: cashMuscatCourierEffect(row),
      cashDaliliCourierEffect: cashDaliliCourierEffect(row)
    }
  });

  if (deliveryCoveredByCash && deliveryCashAccount) {
    await addLedgerMovement(r, {
      type: "COURIER_DELIVERY_FEE",
      amount: deliveryFee,
      from: deliveryCashAccount,
      note: `خصم توصيل طلب مدفوع ${row.orderName} من ${deliveryCashLabel}: -${deliveryFee}`,
      refId: row.numericId,
      refType: "ORDER_DELIVERY_FEE",
      meta: {
        orderName: row.orderName,
        section: row.section,
        deliveryFee,
        deliveryCashSource: deliveryCashAccount,
        reason: "paid_order_delivery_fee_from_correct_cash_source"
      }
    });
  }
}
      
      await r.sAdd(K_V2_TRANSFERRED_IDS, row.numericId);
    }

const totals = buildFinanceTotals(rows);
totals.settlement = buildSettlementBreakdown(rows);

const rec = {
  id: batchId,
      at,
      from,
      to,
      type,
      note,
      count: rows.length,
      totals,
      orders: rows,
      failures,
      actions
    };

    await r.lPush(K_V2_ARCHIVE, JSON.stringify(rec));
    await r.lTrim(K_V2_ARCHIVE, 0, 1000);

    await r.lPush(K_ORDERS_TRANSFER_LOG, JSON.stringify({
      ...rec,
      source: "v2"
    }));

    await r.lTrim(K_ORDERS_TRANSFER_LOG, 0, 1000);

    const push = await notifyMoney(r, {
      title: "تم ترحيل طلبات مالية",
      body: `تم ترحيل ${rows.length} طلب - ${sectionNameForPush(type)} - مبلغ الترحيل ${money3(totals.settlement?.allTransferAmount || totals.all.net)} ر.ع`,
      tag: "orders-transfer",
      url: "/k/"
    });

    return res.json({
      ok: true,
      transferred: rec,
      push
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

  /* =========================================================
     V2 API: Archive
     ========================================================= */
  router.get("/api/money/v2/archive", requireAdminKey, async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const from = normalizeDateInput(req.query.from);
      const to = normalizeDateInput(req.query.to);

      const typeRaw = safeStr(req.query.type || "ALL").toUpperCase();
      const allowedTypes = ["ALL", "AMWAL", "BANK", "CASH", "CASH_MUSCAT", "CASH_DALILI"];
      const type = allowedTypes.includes(typeRaw) ? typeRaw : "ALL";

      let items = await readListJSON(r, K_V2_ARCHIVE, 1000);

items = items.filter((x) => {
  const itemDay = localDayFromISO(x?.at);

  if (from && itemDay < from) return false;
  if (to && itemDay > to) return false;
  if (type !== "ALL") {
          if (type === "CASH") {
            const batchType = safeStr(x.type).toUpperCase();
            const hasCashOrder = Array.isArray(x.orders) && x.orders.some((o) => ["CASH", "CASH_MUSCAT", "CASH_DALILI"].includes(safeStr(o.section).toUpperCase()));
            if (batchType !== "CASH" && !hasCashOrder) return false;
          } else if (x.type !== type) {
            return false;
          }
        }

        return true;
      });

      return res.json({
        ok: true,
        count: items.length,
        items
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.get("/api/money/v2/archive/:id", requireAdminKey, async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const id = safeStr(req.params.id);

      const items = await readListJSON(r, K_V2_ARCHIVE, 1000);

      const item = items.find((x) => x.id === id);

      if (!item) {
        return res.status(404).json({ error: "الأرشيف غير موجود" });
      }

      return res.json({
        ok: true,
        item
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /*
    استرجاع طلب من المرحلة.
    مفيد إذا رحّلت طلب بالغلط.
  */
  router.post("/api/money/v2/untransfer", requireAdminKey, express.json({ limit: "300kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const ids = Array.isArray(req.body?.orderIds)
        ? req.body.orderIds.map((x) => gidToNumeric(x)).filter(Boolean)
        : [];

      if (!ids.length) {
        return res.status(400).json({ error: "orderIds مطلوب" });
      }

      for (const id of ids) {
        await r.sRem(K_V2_TRANSFERRED_IDS, id);
      }

      return res.json({
        ok: true,
        removed: ids.length
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /* =========================================================
     Old Compatibility: Summary + Transfer
     حتى لا ينكسر السكربت القديم لو لا يزال يستخدمها
     ========================================================= */
  router.get("/api/money/summary", requireAdminKey, async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const { from, to } = buildDateRange(req);

      const out = await fetchFinanceOrders(r, {
        from,
        to,
        includeTransferred: false
      });

      const v2 = {
        ok: true,
        from,
        to,
        totals: buildFinanceTotals(out.rows),
        lists: splitFinanceRows(out.rows)
      };

      return res.json(oldCompatibleSummary(v2));
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

router.post("/api/money/transfer", requireAdminKey, express.json({ limit: "500kb" }), async (req, res) => {
  try {
    const typeRaw = safeStr(req.body?.type || "ALL").toUpperCase();

    let type = "ALL";
    if (typeRaw === "AMWAL") type = "AMWAL";
    else if (typeRaw === "BANK") type = "BANK";
    else if (typeRaw === "CASH") type = "CASH";
    else if (typeRaw === "CASH_MUSCAT") type = "CASH_MUSCAT";
    else if (typeRaw === "CASH_DALILI") type = "CASH_DALILI";

    const r = await getRedis();
    if (!r) {
      return res.status(500).json({ error: "REDIS_URL غير مضبوط" });
    }

    const { from, to } = buildDateRange(req);

    const out = await fetchFinanceOrders(r, {
      from,
      to,
      includeTransferred: false
    });

    let rows = out.rows || [];

    if (type !== "ALL") {
      if (type === "CASH") {
        rows = rows.filter((x) => {
          return (
            x.section === "CASH_MUSCAT" ||
            x.section === "CASH_DALILI" ||
            x.section === "CASH"
          );
        });
      } else {
        rows = rows.filter((x) => x.section === type);
      }
    }

    if (!rows.length) {
      return res.status(400).json({ error: "لا توجد طلبات للترحيل" });
    }

    const batchId = uuid();
    const at = new Date().toISOString();
    const failures = [];
    const actions = [];

    for (const row of rows) {
      const section = safeStr(row.section).toUpperCase();

      /*
        كاش مسقط فقط:
        نضيف تاق انتهت ونأرشف الطلب.
        كاش دليلي لا نأرشفه هنا حتى لا نخرب سير عمل دليلي.
      */
      if (section === "CASH_MUSCAT" || section === "CASH") {
        try {
          await addShopifyTag(row.id, CASH_ENDED_TAG);

          actions.push({
            orderName: row.orderName,
            action: "ADD_TAG",
            tag: CASH_ENDED_TAG,
            ok: true
          });
        } catch (e) {
          failures.push({
            orderName: row.orderName,
            step: "ADD_ENDED_TAG",
            error: e?.message || String(e)
          });
        }

        const archived = await archiveShopifyOrder(row.id);

        if (!archived.ok) {
          failures.push({
            orderName: row.orderName,
            step: "ARCHIVE_ORDER",
            error: archived.error
          });
        } else {
          actions.push({
            orderName: row.orderName,
            action: "ARCHIVE_ORDER",
            ok: true
          });
        }
      } else {
        try {
          await addShopifyTag(row.id, FINANCE_TRANSFERRED_TAG);

          actions.push({
            orderName: row.orderName,
            action: "ADD_TAG",
            tag: FINANCE_TRANSFERRED_TAG,
            ok: true
          });
        } catch (e) {
          failures.push({
            orderName: row.orderName,
            step: "ADD_FINANCE_TAG",
            error: e?.message || String(e)
          });
        }
      }

      /*
        الحسابات:
        - أموال / بنك: مبلغ الطلب كامل.
        - توصيل الطلب المدفوع لا يخصم من أموال أو البنك.
        - التوصيل يخصم من كاش مسقط أو كاش دليلي حسب الطلب.
        - كاش: الصافي بعد خصم التوصيل.
      */
      const ledgerTo = sectionToLedgerAccount(row.section);

      if (ledgerTo) {
        const gross = money3(row.gross);
        const deliveryFee = money3(row.deliveryFee);
        const net = money3(row.net);
        const transferAmount = financeTransferAmount(row);

        const isPaidSection = isPaidFinanceSection(row.section);
        const isExternalShipping = isPaidSection && isExternalShippingOrder(row);
        const deliveryCoveredByCash = isPaidDeliveryCoveredByCash(row);

        const deliveryCashAccount = paidDeliveryCashSourceAccount(row);
        const deliveryCashLabel = deliveryCashAccount
          ? ledgerAccountLabel(deliveryCashAccount)
          : "الكاش";

        await addLedgerMovement(r, {
          type: "ORDER_TRANSFER",
          amount: transferAmount,
          to: ledgerTo,
          note: isPaidSection
            ? (
                isExternalShipping
                  ? `ترحيل طلب مدفوع ${row.orderName}: قيمة الطلب ${gross} - شحن خارجي ${deliveryFee} = ${transferAmount}`
                  : `ترحيل طلب مدفوع ${row.orderName}: قيمة الطلب ${gross} كاملة، والتوصيل ${deliveryFee} يخصم من ${deliveryCashLabel}`
              )
            : `ترحيل طلب كاش ${row.orderName}: الصافي بعد خصم التوصيل ${net}`,
          refId: row.numericId,
          refType: "ORDER",
          meta: {
            orderName: row.orderName,
            section: row.section,
            gross,
            deliveryFee,
            net,
            transferAmount,

            paidOrderFullAmount: isPaidSection && !isExternalShipping,
            deliveryCoveredByCash,
            deliveryCashSource: deliveryCashAccount,
            externalShippingDeducted: isExternalShipping,
            cashOrderDeliveryDeducted: !isPaidSection,
            cashMuscatCourierEffect: cashMuscatCourierEffect(row),
            cashDaliliCourierEffect: cashDaliliCourierEffect(row)
          }
        });

        if (deliveryCoveredByCash && deliveryCashAccount && deliveryFee > 0) {
          await addLedgerMovement(r, {
            type: "COURIER_DELIVERY_FEE",
            amount: deliveryFee,
            from: deliveryCashAccount,
            note: `خصم توصيل طلب مدفوع ${row.orderName} من ${deliveryCashLabel}: -${deliveryFee}`,
            refId: row.numericId,
            refType: "ORDER_DELIVERY_FEE",
            meta: {
              orderName: row.orderName,
              section: row.section,
              deliveryFee,
              deliveryCashSource: deliveryCashAccount,
              reason: "paid_order_delivery_fee_from_correct_cash_source"
            }
          });
        }
      }

      await r.sAdd(K_V2_TRANSFERRED_IDS, row.numericId);
    }

    const totals = buildFinanceTotals(rows);
    totals.settlement = buildSettlementBreakdown(rows);

    const rec = {
      id: batchId,
      at,
      from,
      to,
      type,
      note: safeStr(req.body?.note),
      count: rows.length,
      totals,
      orders: rows,
      failures,
      actions
    };

    await r.lPush(K_V2_ARCHIVE, JSON.stringify(rec));
    await r.lTrim(K_V2_ARCHIVE, 0, 1000);

    await r.lPush(K_ORDERS_TRANSFER_LOG, JSON.stringify({
      ...rec,
      source: "v2-compat"
    }));

    await r.lTrim(K_ORDERS_TRANSFER_LOG, 0, 1000);

    const push = await notifyMoney(r, {
      title: "تم ترحيل طلبات مالية",
      body: `تم ترحيل ${rows.length} طلب - ${sectionNameForPush(type)} - مبلغ الترحيل ${money3(totals.settlement?.allTransferAmount || totals.all.net)} ر.ع`,
      tag: "orders-transfer",
      url: "/k/"
    });

    return res.json({
      ok: true,
      transferred: rec,
      push
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
  /* =========================================================
     Debts - نفس النظام القديم تقريبًا
     ========================================================= */
router.get("/api/money/debts", requireAdminKey, async (_req, res) => {
  try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });
      
      const [mDebts, mPrio] = await Promise.all([
        r.hGetAll(K_DEBTS),
        r.hGetAll(K_DEBTS_PRIO)
      ]);

      const items = Object.entries(mDebts || {}).map(([vendor, amount]) => {
        const pr = toNumber(mPrio?.[vendor]);

        return {
          vendor,
          amount: toNumber(amount),
          priority: Number.isFinite(pr) && pr > 0 ? pr : 999999
        };
      });

      const totalPositive = items.reduce((s, x) => {
        return s + (x.amount > 0 ? toNumber(x.amount) : 0);
      }, 0);

      const totalNet = items.reduce((s, x) => {
        return s + toNumber(x.amount);
      }, 0);

      items.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return toNumber(b.amount) - toNumber(a.amount);
      });

      return res.json({
        items,
        total: money3(totalPositive),
        totalNet: money3(totalNet)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  async function ensureVendorPriority(r, vendor) {
    const existing = await r.hGet(K_DEBTS_PRIO, vendor);
    if (existing) return toNumber(existing);

    const next = await r.incr(K_DEBTS_PRIO_SEQ);
    await r.hSet(K_DEBTS_PRIO, vendor, String(next));

    return next;
  }

  router.post("/api/money/debts/add", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const vendor = safeStr(req.body?.vendor);
      const amount = toNumber(req.body?.amount);

      if (!vendor) return res.status(400).json({ error: "اسم التاجر مطلوب" });
      if (!(amount > 0)) return res.status(400).json({ error: "المبلغ لازم > 0" });

      await ensureVendorPriority(r, vendor);

      const after = await r.hIncrByFloat(K_DEBTS, vendor, amount);

      if (toNumber(after) === 0) {
        await r.hDel(K_DEBTS, vendor);
      }

      const log = {
        id: uuid(),
        at: new Date().toISOString(),
        type: "ADD",
        vendor,
        amount,
        after: toNumber(after)
      };

      await r.lPush(K_DEBTS_LOG, JSON.stringify(log));
      await r.lTrim(K_DEBTS_LOG, 0, 500);

      const push = await notifyMoney(r, {
        title: "تمت إضافة مديونية",
        body: `التاجر: ${vendor}\nالمبلغ: ${money3(amount)} ر.ع\nالمتبقي: ${money3(after)} ر.ع`,
        tag: "debt-add",
        url: "/k/"
      });

      return res.json({
        ok: true,
        vendor,
        after: toNumber(after),
        push
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.post("/api/money/debts/pay", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const vendor = safeStr(req.body?.vendor);
      const amount = toNumber(req.body?.amount);
      const source = normalizePaySource(req.body?.source || req.body?.account || "BANK");

      if (!vendor) return res.status(400).json({ error: "اسم التاجر مطلوب" });
      if (!(amount > 0)) return res.status(400).json({ error: "المبلغ لازم > 0" });

      await ensureVendorPriority(r, vendor);

      const cur = toNumber(await r.hGet(K_DEBTS, vendor));
      const afterVal = cur - amount;

      if (afterVal === 0) {
        await r.hDel(K_DEBTS, vendor);
      } else {
        await r.hSet(K_DEBTS, vendor, String(afterVal));
      }

      const log = {
        id: uuid(),
        at: new Date().toISOString(),
        type: "PAY",
        vendor,
        amount,
        source,
        sourceLabel: ledgerAccountLabel(source),
        before: cur,
        after: afterVal
      };

      await r.lPush(K_DEBTS_LOG, JSON.stringify(log));
      await r.lTrim(K_DEBTS_LOG, 0, 500);

      const movement = await addLedgerMovement(r, {
        type: "DEBT_PAY",
        amount,
        from: source,
        note: `سداد دين ${vendor}`,
        refId: log.id,
        refType: "DEBT",
        meta: { vendor, before: cur, after: afterVal }
      });

      const push = await notifyMoney(r, {
        title: "تم سداد مديونية",
        body: `التاجر: ${vendor}\nالمبلغ: ${money3(amount)} ر.ع\nمن: ${ledgerAccountLabel(source)}\nالمتبقي: ${money3(afterVal)} ر.ع`,
        tag: "debt-pay",
        url: "/k/"
      });

      return res.json({
        ok: true,
        vendor,
        after: afterVal,
        movement,
        balances: await getLedgerBalances(r),
        push
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.post("/api/money/debts/reorder", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const incoming = Array.isArray(req.body?.vendors)
        ? req.body.vendors
        : Array.isArray(req.body?.list)
          ? req.body.list
          : Array.isArray(req.body?.items)
            ? req.body.items
            : [];

      const vendors = incoming.map(safeStr).filter(Boolean);

      if (!vendors.length) {
        return res.status(400).json({ error: "vendors/list مطلوب" });
      }

      const multi = r.multi();

      for (let i = 0; i < vendors.length; i++) {
        multi.hSet(K_DEBTS_PRIO, vendors[i], String(i + 1));
      }

      multi.set(K_DEBTS_PRIO_SEQ, String(Math.max(vendors.length, 1)));

      await multi.exec();

      const rec = {
        id: uuid(),
        at: new Date().toISOString(),
        type: "REORDER",
        count: vendors.length
      };

      await r.lPush(K_DEBTS_LOG, JSON.stringify(rec));
      await r.lTrim(K_DEBTS_LOG, 0, 500);

      const push = await notifyMoney(r, {
        title: "تم ترتيب المديونيات",
        body: `تم حفظ ترتيب ${vendors.length} تاجر`,
        tag: "debt-reorder",
        url: "/k/"
      });

      return res.json({ ok: true, push });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  router.post("/api/money/debts/remove", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const vendor = safeStr(req.body?.vendor);

      if (!vendor) {
        return res.status(400).json({ error: "اسم التاجر مطلوب" });
      }

      await r.hDel(K_DEBTS, vendor);
      await r.hDel(K_DEBTS_PRIO, vendor);

      const log = {
        id: uuid(),
        at: new Date().toISOString(),
        type: "REMOVE",
        vendor
      };

      await r.lPush(K_DEBTS_LOG, JSON.stringify(log));
      await r.lTrim(K_DEBTS_LOG, 0, 500);

      const push = await notifyMoney(r, {
        title: "تم حذف مديونية",
        body: `تم حذف مديونية التاجر: ${vendor}`,
        tag: "debt-remove",
        url: "/k/"
      });

      return res.json({ ok: true, push });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /* =========================================================
     Expenses
     ========================================================= */
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 6 * 1024 * 1024
    }
  });

  function uploadToCloudinary(buffer, opts = {}) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "expenses_receipts",
          resource_type: "image",
          ...opts
        },
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );

      stream.end(buffer);
    });
  }

  async function addExpenseHandler(req, res) {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const amount = toNumber(req.body?.amount);
      const reason = safeStr(req.body?.reason);
      const source = normalizePaySource(req.body?.source || req.body?.account || "BANK");

      if (!(amount > 0)) return res.status(400).json({ error: "المبلغ لازم > 0" });
      if (!reason) return res.status(400).json({ error: "السبب مطلوب" });

      let receiptUrl = "";

      if (req.file?.buffer) {
        const up = await uploadToCloudinary(req.file.buffer, {
          public_id: `expense_${uuid()}`
        });

        receiptUrl = up?.secure_url || up?.url || "";
      }

      const rec = {
        id: uuid(),
        at: new Date().toISOString(),
        amount,
        reason,
        source,
        sourceLabel: ledgerAccountLabel(source),
        receiptUrl
      };

await r.lPush(K_EXPENSES, JSON.stringify(rec));
await r.lTrim(K_EXPENSES, 0, 2000);

const movement = await addLedgerMovement(r, {
  type: "EXPENSE",
  amount,
  from: source,
  note: reason,
  refId: rec.id,
  refType: "EXPENSE",
  meta: { reason, receiptUrl }
});

let push = null;

try {
  push = await sendMoneyPushToAll(r, {
    title: "صرفية جديدة",
    body: `المبلغ: ${money3(amount)} ر.ع\nالسبب: ${reason}`,
    image: receiptUrl || undefined,
    tag: "expense-new",
    url: "/k/"
  });
} catch (e) {
  push = {
    ok: false,
    error: e?.message || String(e)
  };

  console.error("expense push failed:", e?.message || e);
}

return res.json({
  ok: true,
  item: rec,
  movement,
  balances: await getLedgerBalances(r),
  push
});
    
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }

  // القديم من لوحة الباك/التغليف
  router.post("/api/money/expenses/add", requirePack, upload.single("receipt"), addExpenseHandler);

  // الجديد من لوحة المدير
  router.post("/api/money/expenses/admin-add", requireAdminKey, upload.single("receipt"), addExpenseHandler);

router.get("/api/money/expenses", requireAdminKey, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) {
      return res.status(500).json({
        error: "REDIS_URL غير مضبوط"
      });
    }

    const { from, to } = buildDateRange(req);

    const raw = await r.lRange(K_EXPENSES, 0, 2000);

    const items = (raw || [])
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const filteredItems = filterItemsByDateRange(items, { from, to });

    filteredItems.sort((a, b) => {
      return String(b.at).localeCompare(String(a.at));
    });

    const total = filteredItems.reduce((s, x) => {
      return s + toNumber(x.amount);
    }, 0);

    return res.json({
      ok: true,
      from,
      to,
      items: filteredItems,
      total: money3(total),
      allCount: items.length,
      filteredCount: filteredItems.length
    });
  } catch (e) {
    return res.status(500).json({
      error: e?.message || String(e)
    });
  }
});

  
  router.post("/api/money/expenses/transfer", requireAdminKey, express.json({ limit: "200kb" }), async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const raw = await r.lRange(K_EXPENSES, 0, 2000);

      const items = (raw || [])
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const ids = Array.isArray(req.body?.ids)
        ? req.body.ids.map(String)
        : null;

      const picked = ids
        ? items.filter((x) => ids.includes(String(x.id)))
        : items.slice();

      const kept = ids
        ? items.filter((x) => !ids.includes(String(x.id)))
        : [];

      const amount = picked.reduce((s, x) => s + toNumber(x.amount), 0);

      const multi = r.multi();

      multi.del(K_EXPENSES);

      for (const x of kept.reverse()) {
        multi.lPush(K_EXPENSES, JSON.stringify(x));
      }

      await multi.exec();

      const rec = {
        id: uuid(),
        at: new Date().toISOString(),
        count: picked.length,
        amount: money3(amount),
        total: money3(amount),
        ids: picked.map((x) => x.id),
        items: picked
      };

      await r.lPush(K_EXPENSES_TRANSFER_LOG, JSON.stringify(rec));
      await r.lTrim(K_EXPENSES_TRANSFER_LOG, 0, 500);

      const push = await notifyMoney(r, {
        title: "تم ترحيل صرفيات",
        body: `تم ترحيل ${picked.length} صرفية بمبلغ ${money3(amount)} ر.ع`,
        tag: "expenses-transfer",
        url: "/k/"
      });

      return res.json({
        ok: true,
        transferred: rec,
        push
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /* =========================================================
     Purchases - مشتريات المنتجات
     ========================================================= */
async function addPurchaseHandler(req, res) {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const amount = toNumber(req.body?.amount);
    const reason = safeStr(req.body?.reason || req.body?.item || req.body?.name);
    const vendor = safeStr(req.body?.vendor);
    const source = normalizePaySource(req.body?.source || req.body?.account || "BANK");

    const purchaseTypeRaw = safeStr(
      req.body?.purchaseType || req.body?.type || req.body?.mode || "NEW"
    ).toUpperCase();

    const isDebtPayment = [
      "DEBT_PAYMENT",
      "DEBT_PAY",
      "PAY_DEBT",
      "DEBT",
      "تسديد دين"
    ].includes(purchaseTypeRaw);

    if (!(amount > 0)) return res.status(400).json({ error: "المبلغ لازم > 0" });
    if (!reason) return res.status(400).json({ error: "اسم/سبب المشتريات مطلوب" });

    if (isDebtPayment && !vendor) {
      return res.status(400).json({ error: "اختر التاجر من الديون" });
    }

    let debtBefore = 0;
    let debtAfter = 0;
    let debtLog = null;

    if (isDebtPayment) {
      debtBefore = toNumber(await r.hGet(K_DEBTS, vendor));

      if (!(debtBefore > 0)) {
        return res.status(400).json({
          error: "هذا التاجر غير موجود في الديون أو لا يوجد عليه دين حالي"
        });
      }

      debtAfter = money3(debtBefore - amount);
    }

    let receiptUrl = "";

    if (req.file?.buffer) {
      const up = await uploadToCloudinary(req.file.buffer, {
        public_id: `purchase_${uuid()}`
      });

      receiptUrl = up?.secure_url || up?.url || "";
    }

    const rec = {
      id: uuid(),
      at: new Date().toISOString(),
      amount: money3(amount),
      reason,
      vendor,
      source,
      sourceLabel: ledgerAccountLabel(source),
      receiptUrl,
      purchaseType: isDebtPayment ? "DEBT_PAYMENT" : "NEW",
      purchaseTypeLabel: isDebtPayment ? "تسديد دين" : "مشتريات جديدة",
      isDebtPayment,
      debtBefore: isDebtPayment ? money3(debtBefore) : 0,
      debtAfter: isDebtPayment ? money3(debtAfter) : 0
    };

    if (isDebtPayment) {
      await ensureVendorPriority(r, vendor);

      if (Math.abs(debtAfter) < 0.0005) {
        await r.hDel(K_DEBTS, vendor);
      } else {
        await r.hSet(K_DEBTS, vendor, String(debtAfter));
      }

      debtLog = {
        id: uuid(),
        at: rec.at,
        type: "PAY",
        vendor,
        amount: money3(amount),
        source,
        sourceLabel: ledgerAccountLabel(source),
        before: money3(debtBefore),
        after: money3(debtAfter),
        refId: rec.id,
        refType: "PURCHASE",
        note: `سداد دين من فاتورة مشتريات: ${reason}`
      };

      await r.lPush(K_DEBTS_LOG, JSON.stringify(debtLog));
      await r.lTrim(K_DEBTS_LOG, 0, 500);
    }

    await r.lPush(K_PURCHASES, JSON.stringify(rec));
    await r.lTrim(K_PURCHASES, 0, 2000);

    const movement = await addLedgerMovement(r, {
      type: isDebtPayment ? "DEBT_PAY" : "PURCHASE",
      amount,
      from: source,
      note: isDebtPayment
        ? `سداد دين ${vendor} - ${reason}`
        : vendor
          ? `${reason} - ${vendor}`
          : reason,
      refId: rec.id,
      refType: isDebtPayment ? "PURCHASE_DEBT_PAYMENT" : "PURCHASE",
      meta: {
        reason,
        vendor,
        receiptUrl,
        purchaseType: rec.purchaseType,
        debtBefore: rec.debtBefore,
        debtAfter: rec.debtAfter,
        debtLogId: debtLog?.id || ""
      }
    });

    const push = await notifyMoney(r, {
      title: isDebtPayment ? "تم سداد دين من المشتريات" : "تمت إضافة مشتريات",
      body: isDebtPayment
        ? `التاجر: ${vendor}\nالمبلغ: ${money3(amount)} ر.ع\nمن: ${ledgerAccountLabel(source)}\nالمتبقي: ${money3(debtAfter)} ر.ع`
        : `المبلغ: ${money3(amount)} ر.ع\nالبيان: ${reason}\nمن: ${ledgerAccountLabel(source)}${vendor ? `\nالتاجر: ${vendor}` : ""}`,
      tag: isDebtPayment ? "purchase-debt-pay" : "purchase-add",
      url: "/k/"
    });

    return res.json({
      ok: true,
      item: rec,
      movement,
      debtLog,
      balances: await getLedgerBalances(r),
      push
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
  router.post("/api/money/purchases/add", requireAdminKey, upload.single("receipt"), addPurchaseHandler);

router.get("/api/money/purchases", requireAdminKey, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const { from, to } = buildDateRange(req);

    const items = await readListJSON(r, K_PURCHASES, 2000);
    const filteredItems = filterItemsByDateRange(items, { from, to });

    filteredItems.sort((a, b) => String(b.at).localeCompare(String(a.at)));

    const total = filteredItems.reduce((sum, item) => {
      return sum + toNumber(item.amount);
    }, 0);

    return res.json({
      ok: true,
      from,
      to,
      items: filteredItems,
      total: money3(total),
      allCount: items.length,
      filteredCount: filteredItems.length
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
  /* =========================================================
     Reports
     ========================================================= */
  router.get("/api/money/reports", requireAdminKey, async (_req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const [
        ordersTransfers,
        expensesTransfers,
        debtsLog,
        financeArchive,
        ledgerEntries,
        purchases
      ] = await Promise.all([
        readListJSON(r, K_ORDERS_TRANSFER_LOG, 1000),
        readListJSON(r, K_EXPENSES_TRANSFER_LOG, 1000),
        readListJSON(r, K_DEBTS_LOG, 1000),
        readListJSON(r, K_V2_ARCHIVE, 1000),
        readListJSON(r, K_LEDGER_ENTRIES, 1000),
        readListJSON(r, K_PURCHASES, 1000)
      ]);

      return res.json({
        ordersTransfers,
        expensesTransfers,
        debtsLog,
        financeArchive,
        ledgerEntries,
        purchases,
        balances: await getLedgerBalances(r)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });

  /* =========================================================
     Debug / Health للماليات فقط
     ========================================================= */
  router.get("/api/money/v2/ping", requireAdminKey, async (_req, res) => {
    try {
      const r = await getRedis();

      return res.json({
        ok: true,
        redis: !!r,
        shop: SHOP || null,
        apiVersion: API_VERSION,
        gqlVersion: GQL_VERSION,
        time: new Date().toISOString()
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  });


router.get("/api/money/delivery/summary", requireAdminKey, async (req, res) => {
  try {
    const r = await getRedis();

    if (!r) {
      return res.status(500).json({
        error: "REDIS_URL غير مضبوط"
      });
    }

    const { from, to } = deliveryDateRange(req);
    const q = safeStr(req.query?.q);

    const out = await fetchDeliveryAdminOrders(r, {
      from,
      to,
      q
    });

    return res.json({
      ok: true,
      from,
      to,
      q,
      query: out.query,
      totals: out.totals,
      lists: {
        readyToSettle: out.buckets.readyToSettle,
        deliveredAll: out.buckets.deliveredAll,
        outForDelivery: out.buckets.outForDelivery,
        withDriver: out.buckets.withDriver,
        settled: out.buckets.settled
      }
    });
  } catch (e) {
    return res.status(500).json({
      error: e?.message || String(e)
    });
  }
});

router.post(
  "/api/money/delivery/status",
  requireAdminKey,
  express.json({ limit: "100kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();

      if (!r) {
        return res.status(500).json({
          error: "REDIS_URL غير مضبوط"
        });
      }

      const fulfillmentId = safeStr(req.body?.fulfillmentId);
      const orderId = safeStr(req.body?.orderId);
      const orderName = safeStr(req.body?.orderName);
      const status = safeStr(req.body?.status).toUpperCase();

      if (!fulfillmentId) {
        return res.status(400).json({
          error: "fulfillmentId مطلوب"
        });
      }

      if (!["OUT_FOR_DELIVERY", "DELIVERED"].includes(status)) {
        return res.status(400).json({
          error: "status غير صحيح"
        });
      }

      const eventOut = await createFulfillmentEvent(fulfillmentId, status);

      if (status === "DELIVERED" && orderId) {
        await addShopifyTag(orderId, DELIVERY_DONE_TAG);
      }

      const title =
        status === "DELIVERED"
          ? "تم توصيل طلب مسقط"
          : "خرج طلب مسقط للتوصيل";

      const body =
        status === "DELIVERED"
          ? `تم تسجيل الطلب ${orderName || ""} كتم التوصيل`
          : `تم تسجيل الطلب ${orderName || ""} كخرج للتوصيل`;

      const push = await notifyMoney(r, {
        title,
        body,
        tag: "delivery-status",
        url: "/k/"
      });

      return res.json({
        ok: true,
        status,
        event: eventOut.event,
        push
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);

router.post(
  "/api/money/delivery/settle",
  requireAdminKey,
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();

      if (!r) {
        return res.status(500).json({
          error: "REDIS_URL غير مضبوط"
        });
      }

      const { from, to } = deliveryDateRange(req);
      const q = safeStr(req.body?.q || req.query?.q);

      const requestedIds = Array.isArray(req.body?.orderIds)
        ? req.body.orderIds.map((x) => safeStr(x)).filter(Boolean)
        : [];

      const out = await fetchDeliveryAdminOrders(r, {
        from,
        to,
        q
      });

      let rows = out.buckets.readyToSettle || [];

      if (requestedIds.length) {
        const set = new Set(requestedIds.map(String));

        rows = rows.filter((x) => {
          return set.has(String(x.numericId)) || set.has(String(x.id));
        });
      }

      if (!rows.length) {
        return res.json({
          ok: true,
          count: 0,
          settledCount: 0,
          skippedCount: 0,
          failedCount: 0,
          rows: [],
          message: "لا توجد طلبات جاهزة للترحيل"
        });
      }

      const actions = [];
      let settledCount = 0;
      let failedCount = 0;

      for (const row of rows) {
        try {
          await addShopifyTag(row.id, DELIVERY_SETTLED_TAG);

          settledCount++;

          actions.push({
            orderName: row.orderName,
            orderId: row.numericId,
            ok: true,
            tag: DELIVERY_SETTLED_TAG
          });
        } catch (e) {
          failedCount++;

          actions.push({
            orderName: row.orderName,
            orderId: row.numericId,
            ok: false,
            error: e?.message || String(e)
          });
        }

        await sleep(120);
      }

      const totalNet = rows.reduce((s, x) => s + toNumber(x.net), 0);

      const push = await notifyMoney(r, {
        title: "تم ترحيل دفعة مندوب مسقط",
        body: `تم ترحيل ${settledCount} طلب ${DELIVERY_SETTLED_TAG} - الصافي ${money3(totalNet)} ر.ع`,
        tag: "delivery-settle",
        url: "/k/"
      });

      return res.json({
        ok: true,
        from,
        to,
        count: rows.length,
        settledCount,
        failedCount,
        skippedCount: rows.length - settledCount - failedCount,
        totals: deliveryTotals(rows),
        actions,
        push
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);

router.post(
  "/api/money/delivery/cancel",
  requireAdminKey,
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();

      if (!r) {
        return res.status(500).json({
          error: "REDIS_URL غير مضبوط"
        });
      }

      const orderId = safeStr(req.body?.orderId);
      const orderName = safeStr(req.body?.orderName);
      const note = safeStr(req.body?.note);

      if (!orderId) {
        return res.status(400).json({
          error: "orderId مطلوب"
        });
      }

      await removeShopifyTag(orderId, DELIVERY_MUSCAT_TAG);
      await addShopifyTag(orderId, DELIVERY_CANCEL_TAG);

      if (note) {
        await updateShopifyOrderNote(orderId, note);
      }

      const push = await notifyMoney(r, {
        title: "تم كنسلة طلب من مسقط",
        body: `تم إخراج الطلب ${orderName || ""} من حساب مسقط وإضافة تاق ${DELIVERY_CANCEL_TAG}`,
        tag: "delivery-cancel",
        url: "/k/"
      });

      return res.json({
        ok: true,
        orderId,
        orderName,
        removedTag: DELIVERY_MUSCAT_TAG,
        addedTag: DELIVERY_CANCEL_TAG,
        push
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);

router.post(
  "/api/money/delivery/tag",
  requireAdminKey,
  express.json({ limit: "100kb" }),
  async (req, res) => {
    try {
      const orderId = safeStr(req.body?.orderId);
      const tag = safeStr(req.body?.tag);

      if (!orderId || !tag) {
        return res.status(400).json({
          error: "orderId و tag مطلوبين"
        });
      }

      await addShopifyTag(orderId, tag);

      return res.json({
        ok: true,
        orderId,
        tag
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);

router.post(
  "/api/money/delivery/note",
  requireAdminKey,
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      const orderId = safeStr(req.body?.orderId);
      const note = safeStr(req.body?.note);

      if (!orderId) {
        return res.status(400).json({
          error: "orderId مطلوب"
        });
      }

      if (!note) {
        return res.status(400).json({
          error: "اكتب الملاحظة"
        });
      }

      const out = await updateShopifyOrderNote(orderId, note);

      return res.json({
        ok: true,
        orderId,
        note: out.note
      });
    } catch (e) {
      return res.status(500).json({
        error: e?.message || String(e)
      });
    }
  }
);



/* =========================================================
   Local Staff Sales + Finance View
   بيع محلي من مخزون الموظف + عرض مالي للمدير
   ========================================================= */

const K_LOCAL_STAFF_SALES = "bt:money:local_staff:sales";

function lsfInvQtyKey(k) {
  return `bt:inv:qty:${safeStr(k)}`;
}

function lsfInvNameKey(k) {
  return `bt:inv:name:${safeStr(k)}`;
}

function lsfInvMovesKey(k) {
  return `bt:inv:moves:${safeStr(k)}`;
}

function lsfLedgerAllKey() {
  return "bt:ledger:all";
}

function lsfLedgerProdKey(k) {
  return `bt:ledger:prod:${safeStr(k)}`;
}

function lsfNorm(x) {
  return safeStr(x)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function lsfInt(x) {
  const n = Math.floor(Number(x || 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function lsfReadSales(r, max = 5000) {
  return readListJSON(r, K_LOCAL_STAFF_SALES, max);
}

async function lsfReplaceSales(r, rows) {
  const multi = r.multi();
  multi.del(K_LOCAL_STAFF_SALES);

  for (const row of [...rows].reverse()) {
    multi.lPush(K_LOCAL_STAFF_SALES, JSON.stringify(row));
  }

  multi.lTrim(K_LOCAL_STAFF_SALES, 0, 4999);
  await multi.exec();
}

async function lsfScanInventory(r) {
  const prefix = "bt:inv:qty:";
  const keys = [];

  if (typeof r.scanIterator === "function") {
    for await (const key of r.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
      keys.push(String(key));
      if (keys.length >= 5000) break;
    }
  } else if (typeof r.keys === "function") {
    const all = await r.keys(`${prefix}*`);
    keys.push(...(all || []).slice(0, 5000));
  }

  const rows = [];

  for (const fullKey of keys) {
    const product_key = String(fullKey).slice(prefix.length);
    if (!product_key) continue;

    const qty = Math.max(0, Number(await r.get(lsfInvQtyKey(product_key)) || 0) || 0);
    const product_name = (await r.get(lsfInvNameKey(product_key))) || product_key;

    rows.push({
      product_key,
      product_name,
      qty
    });
  }

  return rows;
}

async function lsfReadProductLedger(r, { from = "", to = "" } = {}) {
  const rows = await readListJSON(r, lsfLedgerAllKey(), 20000);

  return rows.filter((x) => {
    const day = localDayFromISO(x.ts || x.at);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

async function lsfFetchShopifyVariantMeta(ids = []) {
  const cleanIds = Array.from(new Set(ids.map(safeStr).filter((x) => x.startsWith("gid://"))));
  const map = {};

  for (let i = 0; i < cleanIds.length; i += 80) {
    const chunk = cleanIds.slice(i, i + 80);

    const q = `
      query($ids:[ID!]!) {
        nodes(ids:$ids) {
          ... on ProductVariant {
            id
            title
            sku
            barcode
            image { url }
            product {
              title
              featuredImage { url }
            }
          }
        }
      }
    `;

    const d = await shopifyGraphQL(q, { ids: chunk });
    const nodes = Array.isArray(d?.nodes) ? d.nodes : [];

    for (const v of nodes) {
      if (!v?.id) continue;

      const variantTitle =
        v.title && v.title !== "Default Title"
          ? ` • ${v.title}`
          : "";

      map[v.id] = {
        product_key: v.id,
        product_name: `${safeStr(v.product?.title)}${variantTitle}`.trim() || v.id,
        image: safeStr(v.image?.url || v.product?.featuredImage?.url),
        sku: safeStr(v.sku),
        barcode: safeStr(v.barcode)
      };
    }
  }

  return map;
}

function lsfBuildProductRows({ ledgerRows, stockRows, sales, metaMap }) {
  const map = new Map();

  function getRow(product_key, fallback = {}) {
    const key = safeStr(product_key);
    if (!key) return null;

    if (!map.has(key)) {
      const meta = metaMap[key] || {};

      map.set(key, {
        product_key: key,
        product_name: safeStr(meta.product_name || fallback.product_name) || key,
        image: safeStr(meta.image || fallback.image),
        sku: safeStr(meta.sku || fallback.sku),
        barcode: safeStr(meta.barcode || fallback.barcode),

        // شراء الطلبات
        boughtForOrders: 0,
        buyUndo: 0,
        netBoughtForOrders: 0,

        // المخزون المحلي
        stockAdded: 0,
        stockConsumed: 0,
        stockReturnUndo: 0,
        rawStockConsumed: 0,

        // البيع المحلي خارج الموقع
        localSold: 0,
        localSoldAmount: 0,

        // الرصيد الحالي من Redis
        currentStock: 0,

        // أرقام الطلبات المرتبطة
        orders: []
      });
    }

    const row = map.get(key);
    const meta = metaMap[key] || {};

    if ((!row.product_name || row.product_name === key) && (meta.product_name || fallback.product_name)) {
      row.product_name = safeStr(meta.product_name || fallback.product_name) || key;
    }

    if (!row.image && (meta.image || fallback.image)) {
      row.image = safeStr(meta.image || fallback.image);
    }

    if (!row.sku && (meta.sku || fallback.sku)) {
      row.sku = safeStr(meta.sku || fallback.sku);
    }

    if (!row.barcode && (meta.barcode || fallback.barcode)) {
      row.barcode = safeStr(meta.barcode || fallback.barcode);
    }

    return row;
  }

  // الرصيد الحالي للمخزون المحلي
  for (const st of stockRows || []) {
    const row = getRow(st.product_key, st);
    if (!row) continue;

    row.currentStock = Math.max(0, Number(st.qty || 0) || 0);
  }

  // حركات صفحة الشراء والمخزون
  for (const m of ledgerRows || []) {
    const row = getRow(m.product_key, m);
    if (!row) continue;

    const type = safeStr(m.type).toUpperCase();
    const qty = Math.max(0, Number(m.qty || 0) || 0);
    const orderId = safeStr(m.order_id);

    if (!qty) continue;

    if (type === "BUY_FOR_ORDER") {
      row.boughtForOrders += qty;

      if (orderId && !row.orders.includes(orderId)) {
        row.orders.push(orderId);
      }
    }

    if (type === "BUY_UNDO") {
      row.buyUndo += qty;

      if (orderId && !row.orders.includes(orderId)) {
        row.orders.push(orderId);
      }
    }

    if (type === "STOCK_ADD") {
      row.stockAdded += qty;
    }

    if (type === "STOCK_CONSUME") {
      row.stockConsumed += qty;

      if (orderId && !row.orders.includes(orderId)) {
        row.orders.push(orderId);
      }
    }

    if (type === "STOCK_RETURN_UNDO") {
      row.stockReturnUndo += qty;

      if (orderId && !row.orders.includes(orderId)) {
        row.orders.push(orderId);
      }
    }
  }

  // البيع المحلي من صفحة الموظف
  for (const sale of sales || []) {
    const row = getRow(sale.product_key, sale);
    if (!row) continue;

    row.localSold += Number(sale.qty || 0) || 0;
    row.localSoldAmount += Number(sale.total || 0) || 0;
  }

  return [...map.values()]
    .map((x) => {
      const boughtForOrders = Number(x.boughtForOrders || 0) || 0;
      const buyUndo = Number(x.buyUndo || 0) || 0;

      const rawStockConsumed = Number(x.stockConsumed || 0) || 0;
      const stockReturnUndo = Number(x.stockReturnUndo || 0) || 0;

      return {
        ...x,

        // صافي الشراء من السوق:
        // شراء للطلبات ناقص التراجع
        netBoughtForOrders: Math.max(0, boughtForOrders - buyUndo),

        // نحفظ الرقم الخام للمراجعة فقط
        rawStockConsumed,

        // تراجع صرف المخزون
        stockReturnUndo,

        // صافي الخصم من المخزون:
        // صرف من المخزون ناقص تراجع الصرف
        stockConsumed: Math.max(0, rawStockConsumed - stockReturnUndo),

        // تنسيق مبلغ البيع المحلي
        localSoldAmount: money3(x.localSoldAmount)
      };
    })
    .sort((a, b) => {
      const byStock = Number(b.currentStock || 0) - Number(a.currentStock || 0);
      if (byStock !== 0) return byStock;

      return String(a.product_name || "").localeCompare(
        String(b.product_name || ""),
        "ar"
      );
    });
}

function lsfBuildCustomers(sales) {
  const map = new Map();

  for (const sale of sales) {
    const key = lsfNorm(sale.customer);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, {
        customer: sale.customer,
        salesCount: 0,
        qty: 0,
        total: 0,
        settled: 0,
        outstanding: 0
      });
    }

    const row = map.get(key);

    row.salesCount += 1;
    row.qty += Number(sale.qty || 0) || 0;
    row.total += Number(sale.total || 0) || 0;

    if (sale.settled) row.settled += Number(sale.total || 0) || 0;
    else row.outstanding += Number(sale.total || 0) || 0;
  }

  return [...map.values()]
    .map((x) => ({
      ...x,
      total: money3(x.total),
      settled: money3(x.settled),
      outstanding: money3(x.outstanding)
    }))
    .sort((a, b) => Number(b.outstanding || 0) - Number(a.outstanding || 0));
}

/*
  موظف المخزون يبيع محلي
  السعر اختياري، المدير يقدر يضيفه لاحقاً
*/
router.post(
  "/api/money/local-stock/staff-sale",
  requirePack,
  express.json({ limit: "500kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const product_key = safeStr(req.body?.product_key);
      const product_name = safeStr(req.body?.product_name);
      const image = safeStr(req.body?.image);
      const sku = safeStr(req.body?.sku);
      const barcode = safeStr(req.body?.barcode);

      const customer = safeStr(req.body?.customer);
      const qty = lsfInt(req.body?.qty);
      const unitPriceRaw = req.body?.unitPrice;
      const unitPrice = unitPriceRaw === "" || unitPriceRaw === null || unitPriceRaw === undefined
        ? 0
        : money3(unitPriceRaw);

      const note = safeStr(req.body?.note);

      if (!product_key) return res.status(400).json({ error: "product_key مطلوب" });
      if (!customer) return res.status(400).json({ error: "اسم الشخص مطلوب" });
      if (!qty) return res.status(400).json({ error: "الكمية لازم أكبر من 0" });
      if (unitPrice < 0) return res.status(400).json({ error: "السعر غير صحيح" });

      const saleId = uuid();
      const now = new Date().toISOString();

      const sale = {
        id: saleId,
        at: now,
        source: "STAFF_LOCAL_STOCK",

        product_key,
        product_name: product_name || (await r.get(lsfInvNameKey(product_key))) || product_key,
        image,
        sku,
        barcode,

        customer,
        qty,
        unitPrice,
        total: money3(qty * unitPrice),
        priceConfirmed: unitPrice > 0,

        note,
        settled: false,
        settledAt: "",
        settlementId: ""
      };

      const productMove = {
        id: uuid(),
        ts: now,
        product_key,
        product_name: sale.product_name,
        type: "LOCAL_SALE",
        qty,
        order_id: saleId,
        supplier: "",
        note: `بيع محلي إلى ${customer}`
      };

      const LUA_LOCAL_SALE = `
local qtyKey = KEYS[1]
local movesKey = KEYS[2]
local salesKey = KEYS[3]
local ledgerAllKey = KEYS[4]
local ledgerProdKey = KEYS[5]

local want = tonumber(ARGV[1])
local now = ARGV[2]
local saleId = ARGV[3]
local saleJson = ARGV[4]
local moveJson = ARGV[5]

local cur = tonumber(redis.call("GET", qtyKey) or "0")
if cur < want then
  return {0, cur}
end

local after = cur - want
redis.call("SET", qtyKey, after)

redis.call("LPUSH", movesKey, now .. "|-" .. want .. "|local_sale|" .. saleId)
redis.call("LTRIM", movesKey, 0, 199)

redis.call("LPUSH", salesKey, saleJson)
redis.call("LTRIM", salesKey, 0, 4999)

redis.call("LPUSH", ledgerAllKey, moveJson)
redis.call("LTRIM", ledgerAllKey, 0, 19999)

redis.call("LPUSH", ledgerProdKey, moveJson)
redis.call("LTRIM", ledgerProdKey, 0, 1999)

return {1, after}
`;

      const out = await r.eval(LUA_LOCAL_SALE, {
        keys: [
          lsfInvQtyKey(product_key),
          lsfInvMovesKey(product_key),
          K_LOCAL_STAFF_SALES,
          lsfLedgerAllKey(),
          lsfLedgerProdKey(product_key)
        ],
        arguments: [
          String(qty),
          now,
          saleId,
          JSON.stringify(sale),
          JSON.stringify(productMove)
        ]
      });

      const ok = Array.isArray(out) ? Number(out[0]) : 0;
      const after = Array.isArray(out) ? Number(out[1]) : 0;

      if (!ok) {
        return res.status(400).json({
          error: "المخزون غير كافي",
          available: after
        });
      }

      return res.json({
        ok: true,
        sale,
        qtyAfter: after
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);


router.get("/api/money/local-stock/customer-invoice", requireAdminKey, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const customer = safeStr(req.query?.customer);
    const includeSettled = safeStr(req.query?.includeSettled) === "1";

    if (!customer) {
      return res.status(400).json({ error: "customer مطلوب" });
    }

    const allSales = await readListJSON(r, K_LOCAL_STAFF_SALES, 5000);

    const target = lsfNorm(customer);

    const items = (allSales || [])
      .filter((x) => lsfNorm(x.customer) === target)
      .filter((x) => includeSettled ? true : !x.settled)
      .map((x) => {
        const qty = Number(x.qty || 0) || 0;
        const unitPrice = money3(x.unitPrice || 0);
        const total = money3(x.total || (qty * unitPrice));

return {
  id: safeStr(x.id),
  groupId: safeStr(x.groupId),
  at: safeStr(x.at),
  customer: safeStr(x.customer),
  product_key: safeStr(x.product_key),
  product_name: safeStr(x.product_name),
  image: safeStr(x.image),
  sku: safeStr(x.sku),
  barcode: safeStr(x.barcode),
  qty,
  unitPrice,
  total,
  priceConfirmed: !!x.priceConfirmed,
  note: safeStr(x.note),
  settled: !!x.settled,
  settledAt: safeStr(x.settledAt),
  settlementId: safeStr(x.settlementId),
  autoPurchase:
    x.autoPurchase && typeof x.autoPurchase === "object"
      ? x.autoPurchase
      : null
};
      
      })
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));

    const totalQty = items.reduce((s, x) => s + Number(x.qty || 0), 0);
    const totalAmount = items.reduce((s, x) => s + Number(x.total || 0), 0);
    const unpricedCount = items.filter((x) => !(Number(x.unitPrice || 0) > 0)).length;

    return res.json({
      ok: true,
      customer,
      includeSettled,
      count: items.length,
      totalQty,
      totalAmount: money3(totalAmount),
      unpricedCount,
      items
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
  
/*
  ملخص الإدارة المالية
*/
router.get("/api/money/local-stock/summary", requireAdminKey, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const { from, to } = buildDateRange(req);

    const [stockRows, ledgerRows, allSales] = await Promise.all([
      lsfScanInventory(r),
      lsfReadProductLedger(r, { from, to }),
      lsfReadSales(r)
    ]);

    const salesInRange = allSales.filter((x) => {
      const day = localDayFromISO(x.at);
      if (!day) return false;
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });

    const variantIds = [
      ...stockRows.map((x) => x.product_key),
      ...ledgerRows.map((x) => x.product_key),
      ...allSales.map((x) => x.product_key)
    ].filter(Boolean);

    const metaMap = await lsfFetchShopifyVariantMeta(variantIds).catch(() => ({}));

    const productRows = lsfBuildProductRows({
      ledgerRows,
      stockRows,
      sales: salesInRange,
      metaMap
    });

    const customers = lsfBuildCustomers(allSales);

    const totals = {
      products: stockRows.length,
      currentStockQty: stockRows.reduce((s, x) => s + Number(x.qty || 0), 0),
      boughtForOrders: productRows.reduce((s, x) => s + Number(x.netBoughtForOrders || 0), 0),
      stockAdded: productRows.reduce((s, x) => s + Number(x.stockAdded || 0), 0),
      localSales: money3(salesInRange.reduce((s, x) => s + Number(x.total || 0), 0)),
      localOutstanding: money3(allSales.filter((x) => !x.settled).reduce((s, x) => s + Number(x.total || 0), 0)),
      missingPriceCount: allSales.filter((x) => !x.settled && !(Number(x.unitPrice || 0) > 0)).length
    };

    return res.json({
      ok: true,
      from,
      to,
      totals,
      productRows,
      customers,
      sales: salesInRange
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

/*
  فاتورة شخص
*/
router.get("/api/money/local-stock/customer", requireAdminKey, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const customer = safeStr(req.query.customer);
    if (!customer) return res.status(400).json({ error: "customer مطلوب" });

    const allSales = await lsfReadSales(r);
    const rows = allSales.filter((x) => lsfNorm(x.customer) === lsfNorm(customer));

    const metaMap = await lsfFetchShopifyVariantMeta(rows.map((x) => x.product_key)).catch(() => ({}));

    for (const row of rows) {
      const meta = metaMap[row.product_key] || {};
      row.product_name = meta.product_name || row.product_name;
      row.image = meta.image || row.image;
      row.sku = meta.sku || row.sku;
      row.barcode = meta.barcode || row.barcode;
    }

    return res.json({
      ok: true,
      customer,
      sales: rows,
      total: money3(rows.reduce((s, x) => s + Number(x.total || 0), 0)),
      outstanding: money3(rows.filter((x) => !x.settled).reduce((s, x) => s + Number(x.total || 0), 0)),
      missingPriceCount: rows.filter((x) => !x.settled && !(Number(x.unitPrice || 0) > 0)).length
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

/*
  المدير يعدل/يضيف السعر
*/
router.patch(
  "/api/money/local-stock/sale-price",
  requireAdminKey,
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const saleId = safeStr(req.body?.saleId);
      const unitPrice = money3(req.body?.unitPrice);

      if (!saleId) return res.status(400).json({ error: "saleId مطلوب" });
      if (!(unitPrice > 0)) return res.status(400).json({ error: "السعر لازم أكبر من 0" });

      const rows = await lsfReadSales(r);
      const idx = rows.findIndex((x) => String(x.id) === saleId);

      if (idx < 0) return res.status(404).json({ error: "عملية البيع غير موجودة" });
      if (rows[idx].settled) return res.status(400).json({ error: "لا يمكن تعديل سعر عملية مرحلة" });

      rows[idx].unitPrice = unitPrice;
      rows[idx].total = money3(Number(rows[idx].qty || 0) * unitPrice);
      rows[idx].priceConfirmed = true;
      rows[idx].priceUpdatedAt = new Date().toISOString();

      await lsfReplaceSales(r, rows);

      return res.json({
        ok: true,
        sale: rows[idx]
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);

/*
  ترحيل حساب شخص إلى كاش مسقط
*/
router.post(
  "/api/money/local-stock/customer/settle",
  requireAdminKey,
  express.json({ limit: "200kb" }),
  async (req, res) => {
    try {
      const r = await getRedis();
      if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

      const customer = safeStr(req.body?.customer);
      if (!customer) return res.status(400).json({ error: "اسم الشخص مطلوب" });

      const rows = await lsfReadSales(r);

      const target = rows.filter((x) => {
        return lsfNorm(x.customer) === lsfNorm(customer) && !x.settled;
      });

      if (!target.length) {
        return res.status(400).json({ error: "لا توجد مبالغ غير مرحلة" });
      }

      const missing = target.filter((x) => !(Number(x.unitPrice || 0) > 0));

      if (missing.length) {
        return res.status(400).json({
          error: `يوجد ${missing.length} منتج بدون سعر. أضف السعر أولاً.`
        });
      }

      const amount = money3(target.reduce((s, x) => s + Number(x.total || 0), 0));

      if (!(amount > 0)) {
        return res.status(400).json({ error: "المبلغ غير صحيح" });
      }

      const movement = await addLedgerMovement(r, {
        type: "LOCAL_CUSTOMER_SETTLE",
        amount,
        to: LEDGER_ACCOUNTS.CASH_MUSCAT,
        note: `ترحيل بيع محلي كاش مسقط - ${customer}`,
        refType: "LOCAL_STAFF_SALE",
        refId: customer,
        meta: {
          customer,
          salesCount: target.length
        }
      });

      const now = new Date().toISOString();

      for (const row of rows) {
        if (lsfNorm(row.customer) === lsfNorm(customer) && !row.settled) {
          row.settled = true;
          row.settledAt = now;
          row.settlementId = movement.id;
        }
      }

      await lsfReplaceSales(r, rows);

      return res.json({
        ok: true,
        customer,
        amount,
        movement,
        balances: await getLedgerBalances(r)
      });
    } catch (e) {
      return res.status(500).json({ error: e?.message || String(e) });
    }
  }
);
  
  return router;
}
