import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import { createClient } from "redis";

const router = express.Router();

/* =========================
   Shopify ENV
========================= */
const SHOP = String(process.env.SHOPIFY_SHOP || "").trim();               // your-store.myshopify.com
const TOKEN = String(process.env.SHOPIFY_ADMIN_TOKEN || "").trim();       // Admin token
const API_VERSION = String(process.env.SHOPIFY_API_VERSION || "2026-01").trim();

function assertShopifyEnv() {
  const miss = [];
  if (!SHOP) miss.push("SHOPIFY_SHOP");
  if (!TOKEN) miss.push("SHOPIFY_ADMIN_TOKEN");
  if (miss.length) throw new Error(`Missing env: ${miss.join(", ")}`);
}

/* =========================
   Auth: PACK_KEY (نفس سكربت المخزون)
========================= */
const PACK_KEY = String(process.env.PACK_KEY || "").trim();

function requirePack(req, res, next) {
  const key = String(req.headers["x-pack-key"] || "").trim();
  if (!PACK_KEY) return res.status(500).json({ error: "PACK_KEY غير مضبوط في ENV" });
  if (key !== PACK_KEY) return res.status(401).json({ error: "غير مصرح" });
  next();
}

router.use(requirePack);
router.use(express.json({ limit: "1mb" }));

/* =========================
   Shopify GraphQL helper
========================= */
async function adminGraphQL(query, variables = {}) {
  assertShopifyEnv();

  const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await r.json().catch(() => ({}));

  if (!r.ok) {
    const msg =
      json?.errors?.[0]?.message ||
      json?.error ||
      json?.message ||
      `Shopify GraphQL HTTP ${r.status}`;
    throw new Error(msg);
  }
  if (Array.isArray(json?.errors) && json.errors.length) {
    throw new Error(json.errors[0]?.message || "Shopify GraphQL error");
  }
  return json.data;
}

/* =========================
   Cursor Cache (Pagination)
========================= */
const cursorCache = new Map(); // key -> { pageToAfter: Map(page -> cursor|null) }

function getCacheKey(mode, q, limit) {
  return `${mode}|${String(q || "").trim().toLowerCase()}|${Number(limit) || 0}`;
}
function ensureCache(key) {
  if (!cursorCache.has(key)) cursorCache.set(key, { pageToAfter: new Map([[1, null]]) });
  return cursorCache.get(key);
}

/* =========================
   GraphQL Queries
========================= */

// 1) عرض المنتجات (Active) مع Variants
const PRODUCTS_PAGE_QUERY = `
  query ProductsPage($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id
          title
          status
          featuredImage { url }
          variants(first: 50) {
            nodes {
              id
              title
              barcode
              sku
            }
          }
        }
      }
    }
  }
`;

// 2) بحث بالباركود/sku عبر productVariants
const VARIANTS_PAGE_QUERY = `
  query VariantsPage($first: Int!, $after: String, $query: String!) {
    productVariants(first: $first, after: $after, query: $query) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id
          title
          barcode
          sku
          image { url }
          product {
            id
            title
            status
            featuredImage { url }
          }
        }
      }
    }
  }
`;
function safeStr(x) {
  return String(x ?? "").trim();
}


/* =========================
   Local Stock Employee Sales
   يكتب في نفس مفاتيح الإدارة المالية
========================= */

const K_LOCAL_STAFF_SALES = "bt:money:local_staff:sales";
const K_PURCHASES = "bt:money:purchases";
const K_LEDGER_BALANCES = "bt:money:v2:ledger:balances";
const K_LEDGER_ENTRIES = "bt:money:v2:ledger:entries";

const LEDGER_ACCOUNTS = {
  CASH_MUSCAT: "cash_muscat",
  BANK: "bank"
};

let __redisClient = null;

async function getRedisLocal() {
  const REDIS_URL = String(process.env.REDIS_URL || "").trim();

  if (!REDIS_URL) {
    throw new Error("REDIS_URL غير مضبوط");
  }

  if (__redisClient && __redisClient.isOpen) {
    return __redisClient;
  }

  __redisClient = createClient({ url: REDIS_URL });

  __redisClient.on("error", (e) => {
    console.error("pack-shopify redis error:", e?.message || e);
  });

  await __redisClient.connect();

  return __redisClient;
}

function uuid() {
  return crypto.randomUUID();
}

function toNumber(x) {
  const n = Number(String(x ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function money3(x) {
  return Number(toNumber(x).toFixed(3));
}

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

function ledgerAccountLabel(account) {
  const a = safeStr(account);

  if (a === LEDGER_ACCOUNTS.CASH_MUSCAT) return "كاش مسقط";
  if (a === LEDGER_ACCOUNTS.BANK) return "الحساب البنكي";

  return a || "—";
}

function normalizePaySource(x) {
  const s = safeStr(x).toUpperCase();

  if (["CASH", "CASH_MUSCAT", "MUSCAT", "كاش", "مسقط"].includes(s)) {
    return LEDGER_ACCOUNTS.CASH_MUSCAT;
  }

  if (["BANK", "BANK_TRANSFER", "تحويل", "بنك", "الحساب البنكي"].includes(s)) {
    return LEDGER_ACCOUNTS.BANK;
  }

  return "";
}

async function getLocalQty(r, product_key) {
  return Math.max(
    0,
    Math.floor(Number(await r.get(lsfInvQtyKey(product_key)) || 0)) || 0
  );
}

async function addLocalPurchaseToFinance(r, {
  amount,
  source,
  vendor,
  reason,
  at,
  meta = {}
}) {
  const cleanAmount = money3(amount);
  const account = normalizePaySource(source);

  if (!(cleanAmount > 0)) {
    return null;
  }

  const purchase = {
    id: uuid(),
    at: at || new Date().toISOString(),
    amount: cleanAmount,
    reason: safeStr(reason),
    vendor: safeStr(vendor),
    source: account || "UNKNOWN",
    sourceLabel: account ? ledgerAccountLabel(account) : "غير محدد",
    receiptUrl: "",
    purchaseType: "LOCAL_STOCK_AUTO_PURCHASE",
    purchaseTypeLabel: "شراء فوري للمخزون المحلي",
    isDebtPayment: false,
    localStockAuto: true,
    meta: meta && typeof meta === "object" ? meta : {}
  };

  const multi = r.multi();

  multi.lPush(K_PURCHASES, JSON.stringify(purchase));
  multi.lTrim(K_PURCHASES, 0, 2000);

  let movement = null;

  if (account) {
    movement = {
      id: uuid(),
      at: purchase.at,
      type: "PURCHASE",
      amount: cleanAmount,
      from: account,
      fromLabel: ledgerAccountLabel(account),
      to: "",
      toLabel: "",
      note: purchase.vendor
        ? `${purchase.reason} - ${purchase.vendor}`
        : purchase.reason,
      refId: purchase.id,
      refType: "LOCAL_STOCK_AUTO_PURCHASE",
      meta: {
        ...purchase.meta,
        vendor: purchase.vendor,
        purchaseType: purchase.purchaseType
      }
    };

    multi.hIncrByFloat(K_LEDGER_BALANCES, account, -cleanAmount);
    multi.lPush(K_LEDGER_ENTRIES, JSON.stringify(movement));
    multi.lTrim(K_LEDGER_ENTRIES, 0, 5000);
  }

  await multi.exec();

  return {
    purchase,
    movement
  };
}

function normalizeUnitPrice(raw) {
  const s = String(raw ?? "").trim();

  if (!s) return 0;

  const n = money3(s);

  if (n < 0) {
    throw new Error("سعر البيع غير صحيح");
  }

  return n;
}

function normalizePurchaseCost(raw) {
  const s = String(raw ?? "").trim();

  if (!s) return 0;

  const n = money3(s);

  if (n < 0) {
    throw new Error("تكلفة الشراء غير صحيحة");
  }

  return n;
}

async function createLocalStockSale(r, {
  product_key,
  product_name,
  image,
  sku,
  barcode,
  customer,
  qty,
  unitPrice,
  note,
  allowAutoPurchase = false,
  purchaseVendor = "",
  purchaseSource = "",
  purchaseUnitCost = "",
  purchaseNote = "",
  groupId = ""
}) {
  const key = safeStr(product_key);
  const cleanCustomer = safeStr(customer);
  const cleanName = safeStr(product_name) || key;
  const cleanQty = Math.max(1, Math.floor(Number(qty || 0)) || 0);
  const cleanUnitPrice = normalizeUnitPrice(unitPrice);

  if (!key) {
    const err = new Error("product_key مطلوب");
    err.status = 400;
    throw err;
  }

  if (!cleanCustomer) {
    const err = new Error("اسم الشخص مطلوب");
    err.status = 400;
    throw err;
  }

  if (!(cleanQty > 0)) {
    const err = new Error("الكمية لازم أكبر من 0");
    err.status = 400;
    throw err;
  }

  const currentQty = await getLocalQty(r, key);
  const shortage = Math.max(0, cleanQty - currentQty);

  if (shortage > 0 && !allowAutoPurchase) {
    const err = new Error("المخزون غير كافي");
    err.status = 400;
    err.available = currentQty;
    throw err;
  }

  let autoPurchase = null;

  if (shortage > 0) {
    const vendor = safeStr(purchaseVendor);
    const source = safeStr(purchaseSource || "UNKNOWN");
    const unitCost = normalizePurchaseCost(purchaseUnitCost);

    if (!vendor) {
      const err = new Error(`اكتب التاجر / الشخص الذي تم الشراء منه للمنتج: ${cleanName}`);
      err.status = 400;
      throw err;
    }

    autoPurchase = {
      qty: shortage,
      vendor,
      source,
      unitCost,
      amount: money3(unitCost * shortage),
      note: safeStr(purchaseNote),
      at: new Date().toISOString()
    };
  }

  const saleId = uuid();
  const now = new Date().toISOString();

  const sale = {
    id: saleId,
    groupId: safeStr(groupId),
    at: now,
    source: "STAFF_LOCAL_STOCK",

    product_key: key,
    product_name: cleanName,
    image: safeStr(image),
    sku: safeStr(sku),
    barcode: safeStr(barcode),

    customer: cleanCustomer,
    qty: cleanQty,
    unitPrice: cleanUnitPrice,
    total: money3(cleanQty * cleanUnitPrice),
    priceConfirmed: cleanUnitPrice > 0,

    note: safeStr(note),
    settled: false,
    settledAt: "",
    settlementId: "",

    autoPurchase
  };

  const afterQty = Math.max(0, currentQty + shortage - cleanQty);

  const multi = r.multi();

  multi.set(lsfInvNameKey(key), cleanName);
  multi.set(lsfInvQtyKey(key), String(afterQty));

  if (shortage > 0) {
    const addMove = {
      id: uuid(),
      ts: now,
      at: now,
      product_key: key,
      product_name: cleanName,
      image: safeStr(image),
      sku: safeStr(sku),
      barcode: safeStr(barcode),
      type: "STOCK_ADD",
      qty: shortage,
      order_id: saleId,
      supplier: autoPurchase.vendor,
      note: `شراء فوري للبيع المحلي إلى ${cleanCustomer}`,
      autoPurchase
    };

    multi.lPush(
      lsfInvMovesKey(key),
      `${now}|+${shortage}|auto_local_purchase|${saleId}`
    );
    multi.lTrim(lsfInvMovesKey(key), 0, 199);

    multi.lPush(lsfLedgerAllKey(), JSON.stringify(addMove));
    multi.lTrim(lsfLedgerAllKey(), 0, 19999);

    multi.lPush(lsfLedgerProdKey(key), JSON.stringify(addMove));
    multi.lTrim(lsfLedgerProdKey(key), 0, 1999);
  }

  const saleMove = {
    id: uuid(),
    ts: now,
    at: now,
    product_key: key,
    product_name: cleanName,
    image: safeStr(image),
    sku: safeStr(sku),
    barcode: safeStr(barcode),
    type: "LOCAL_SALE",
    qty: cleanQty,
    order_id: saleId,
    supplier: "",
    note: `بيع محلي إلى ${cleanCustomer}`,
    customer: cleanCustomer,
    saleId,
    groupId: sale.groupId,
    autoPurchase
  };

  multi.lPush(
    lsfInvMovesKey(key),
    `${now}|-${cleanQty}|local_sale|${saleId}`
  );
  multi.lTrim(lsfInvMovesKey(key), 0, 199);

  multi.lPush(K_LOCAL_STAFF_SALES, JSON.stringify(sale));
  multi.lTrim(K_LOCAL_STAFF_SALES, 0, 4999);

  multi.lPush(lsfLedgerAllKey(), JSON.stringify(saleMove));
  multi.lTrim(lsfLedgerAllKey(), 0, 19999);

  multi.lPush(lsfLedgerProdKey(key), JSON.stringify(saleMove));
  multi.lTrim(lsfLedgerProdKey(key), 0, 1999);

  await multi.exec();

  let purchaseFinance = null;

  if (autoPurchase && autoPurchase.amount > 0) {
    purchaseFinance = await addLocalPurchaseToFinance(r, {
      amount: autoPurchase.amount,
      source: autoPurchase.source,
      vendor: autoPurchase.vendor,
      reason: `شراء فوري للمخزون المحلي: ${cleanName} | للعميل ${cleanCustomer}`,
      at: now,
      meta: {
        customer: cleanCustomer,
        product_key: key,
        product_name: cleanName,
        qty: autoPurchase.qty,
        unitCost: autoPurchase.unitCost,
        saleId,
        groupId: sale.groupId,
        note: autoPurchase.note
      }
    });
  }

  return {
    sale,
    qtyAfter: afterQty,
    shortage,
    purchaseFinance
  };
}


function isLikelyBarcode(q) {
  const s = safeStr(q);
  if (!s) return false;
  // باركود غالباً أرقام/شرطات
  return /^[0-9\-]{4,}$/.test(s);
}

/* =========================
   GET /ping
========================= */
router.get("/ping", (req, res) => res.json({ ok: true }));

/* =========================
   GET /active
   يعرض كل المنتجات النشطة مع Pagination + بحث
   Query: page, limit(<=25), q
   - إذا q يبدو باركود/sku: يستخدم productVariants query
   - غير كذا: يستخدم products query بالاسم
========================= */
router.get("/active", async (req, res) => {
  try {
    const limit = Math.min(25, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const qRaw = safeStr(req.query.q);

    // ✅ Cursor القادم من الفرونت
    // إذا وصل after فاضي "" نخليه null
    const afterRaw = req.query.after;
    const after = (afterRaw === undefined || afterRaw === null || String(afterRaw).trim() === "")
      ? null
      : String(afterRaw);

    const useVariantsSearch = isLikelyBarcode(qRaw);
    const mode = useVariantsSearch ? "variants" : "products";

    // ✅ جلب صفحة واحدة مباشرة من Shopify حسب after
    const data = await adminGraphQL(
      useVariantsSearch ? VARIANTS_PAGE_QUERY : PRODUCTS_PAGE_QUERY,
      {
        first: limit,
        after,
        query: buildQuery(useVariantsSearch, qRaw),
      }
    );

    const pi = useVariantsSearch
      ? data?.productVariants?.pageInfo
      : data?.products?.pageInfo;

    const hasNextPage = Boolean(pi?.hasNextPage);
    const endCursor = pi?.endCursor ?? null;

    // تجهيز Items (نرجع “Variants rows” دائماً عشان الفرونت موحد)
    const items = [];

    if (useVariantsSearch) {
      const edges = data?.productVariants?.edges || [];
      for (const e of edges) {
        const v = e?.node;
        if (!v) continue;

        const p = v.product;
        const pStatus = String(p?.status || "").toUpperCase();
        if (pStatus !== "ACTIVE") continue;

        items.push({
          variantId: v.id,
          productId: p?.id || null,
          productTitle: p?.title || "",
          variantTitle: v.title || "",
          barcode: safeStr(v.barcode),
          sku: safeStr(v.sku),
          image:
            v?.image?.url ||
            p?.featuredImage?.url ||
            "",
        });
      }
    } else {
      const edges = data?.products?.edges || [];
      for (const e of edges) {
        const p = e?.node;
        if (!p) continue;

        const pStatus = String(p?.status || "").toUpperCase();
        if (pStatus !== "ACTIVE") continue;

        const img = p?.featuredImage?.url || "";
        const variants = p?.variants?.nodes || [];

        for (const v of variants) {
          items.push({
            variantId: v?.id || null,
            productId: p.id,
            productTitle: p.title || "",
            variantTitle: v?.title || "",
            barcode: safeStr(v?.barcode),
            sku: safeStr(v?.sku),
            image: img,
          });
        }
      }
    }

    return res.json({
      limit,
      q: qRaw || "",
      mode,
      hasNextPage,
      nextCursor: endCursor || null,   // ✅ هذا المهم لزر "التالي"
      items,
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

function buildQuery(useVariantsSearch, qRaw) {
  const q = safeStr(qRaw);

  if (useVariantsSearch) {
    // بحث variants: الأفضل باركود/sku (ونخليها مرنة)
    // Shopify syntax غالباً يدعم barcode: و sku:
    // بنجرب OR بينهم
    const safe = q.replace(/"/g, '\\"');
    return `(barcode:${safe} OR sku:${safe})`;
  }

  // بحث products: Active + الاسم
  if (!q) return "status:active";
  const safe = q.replace(/"/g, '\\"');
  return `status:active ${safe}`;
}


/* =========================
   Employee Local Stock Invoice / Prices
   عرض الفواتير وتعديل الأسعار للموظف
========================= */

function lsfNorm(x) {
  return safeStr(x)
    .toLowerCase()
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

async function readListJSONLocal(r, key, max = 5000) {
  const limit = Math.max(1, Math.min(Number(max) || 5000, 10000));
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

async function lsfReadStaffSales(r) {
  return readListJSONLocal(r, K_LOCAL_STAFF_SALES, 5000);
}

async function lsfReplaceStaffSales(r, rows) {
  const cleanRows = Array.isArray(rows) ? rows : [];
  const multi = r.multi();

  multi.del(K_LOCAL_STAFF_SALES);

  if (cleanRows.length) {
    multi.rPush(
      K_LOCAL_STAFF_SALES,
      cleanRows.map((x) => JSON.stringify(x))
    );
    multi.lTrim(K_LOCAL_STAFF_SALES, 0, 4999);
  }

  await multi.exec();
}

function lsfInvoiceItem(x) {
  const qty = Number(x.qty || 0) || 0;
  const unitPrice = money3(x.unitPrice || 0);
  const total = money3(x.total || qty * unitPrice);

  return {
    id: safeStr(x.id),
    groupId: safeStr(x.groupId),
    at: safeStr(x.at),
    source: safeStr(x.source),

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
}

function buildEmployeeCustomerRows(sales = []) {
  const map = new Map();

  for (const sale of sales || []) {
    const customerKey = lsfNorm(sale.customer);
    if (!customerKey) continue;

    if (!map.has(customerKey)) {
      map.set(customerKey, {
        customer: safeStr(sale.customer),
        salesCount: 0,
        qty: 0,
        total: 0,
        outstanding: 0,
        settled: 0,
        missingPriceCount: 0,
        lastAt: ""
      });
    }

    const row = map.get(customerKey);
    const total = money3(sale.total || 0);

    row.salesCount += 1;
    row.qty += Number(sale.qty || 0) || 0;
    row.total += total;

    if (sale.settled) {
      row.settled += total;
    } else {
      row.outstanding += total;
    }

    if (!sale.settled && !(Number(sale.unitPrice || 0) > 0)) {
      row.missingPriceCount += 1;
    }

    if (!row.lastAt || String(sale.at || "") > String(row.lastAt || "")) {
      row.lastAt = safeStr(sale.at);
    }
  }

  return [...map.values()]
    .map((x) => ({
      ...x,
      total: money3(x.total),
      outstanding: money3(x.outstanding),
      settled: money3(x.settled)
    }))
    .sort((a, b) => {
      const missing = Number(b.missingPriceCount || 0) - Number(a.missingPriceCount || 0);
      if (missing !== 0) return missing;

      const outstanding = Number(b.outstanding || 0) - Number(a.outstanding || 0);
      if (outstanding !== 0) return outstanding;

      return String(b.lastAt || "").localeCompare(String(a.lastAt || ""));
    });
}

function buildEmployeeInvoiceItems(sales = [], includeSettled = false) {
  return (sales || [])
    .filter((x) => includeSettled ? true : !x.settled)
    .map(lsfInvoiceItem)
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

/* =========================
   Employee Local Stock Sale - single
   البيع بالحبة مثل النظام القديم
========================= */
router.post("/local-stock/staff-sale", async (req, res) => {
  try {
    const r = await getRedisLocal();

    const out = await createLocalStockSale(r, {
      product_key: req.body?.product_key,
      product_name: req.body?.product_name,
      image: req.body?.image,
      sku: req.body?.sku,
      barcode: req.body?.barcode,
      customer: req.body?.customer,
      qty: req.body?.qty,
      unitPrice: req.body?.unitPrice,
      note: req.body?.note,
      allowAutoPurchase: false
    });

    return res.json({
      ok: true,
      sale: out.sale,
      qtyAfter: out.qtyAfter
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || String(e),
      available: e?.available
    });
  }
});

/* =========================
   Employee Local Stock Sale - cart
   السلة: إذا ناقص يضيف مخزون تلقائي ثم يخصم
========================= */
router.post("/local-stock/staff-sale-bulk", async (req, res) => {
  try {
    const r = await getRedisLocal();

    const customer = safeStr(req.body?.customer);
    const note = safeStr(req.body?.note);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!customer) {
      return res.status(400).json({ error: "اسم الشخص مطلوب" });
    }

    if (!items.length) {
      return res.status(400).json({ error: "السلة فارغة" });
    }

    const groupId = uuid();
    const qtyAfterMap = {};
    const saleIds = [];
    const sales = [];

    let totalAmount = 0;
    let missingPriceCount = 0;
    let autoPurchaseCount = 0;
    let autoPurchaseAmount = 0;

    for (const raw of items) {
      const out = await createLocalStockSale(r, {
        product_key: raw?.product_key,
        product_name: raw?.product_name,
        image: raw?.image,
        sku: raw?.sku,
        barcode: raw?.barcode,
        customer,
        qty: raw?.qty,
        unitPrice: raw?.unitPrice,
        note,
        allowAutoPurchase: true,

        purchaseVendor: raw?.purchaseVendor,
        purchaseSource: raw?.purchaseSource,
        purchaseUnitCost: raw?.purchaseUnitCost,
        purchaseNote: raw?.purchaseNote,

        groupId
      });

      saleIds.push(out.sale.id);
      sales.push(out.sale);
      qtyAfterMap[out.sale.product_key] = out.qtyAfter;

      if (Number(out.sale.unitPrice || 0) > 0) {
        totalAmount += Number(out.sale.total || 0) || 0;
      } else {
        missingPriceCount += 1;
      }

      if (out.sale.autoPurchase) {
        autoPurchaseCount += 1;
        autoPurchaseAmount += Number(out.sale.autoPurchase.amount || 0) || 0;
      }
    }

    return res.json({
      ok: true,
      groupId,
      saleIds,
      sales,
      qtyAfterMap,
      totalAmount: money3(totalAmount),
      missingPriceCount,
      autoPurchaseCount,
      autoPurchaseAmount: money3(autoPurchaseAmount)
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || String(e),
      available: e?.available
    });
  }
});


/* =========================
   Employee: Local Stock Customers
   عرض الأشخاص للموظف
========================= */
router.get("/local-stock/customers", async (_req, res) => {
  try {
    const r = await getRedisLocal();
    const sales = await lsfReadStaffSales(r);

    return res.json({
      ok: true,
      customers: buildEmployeeCustomerRows(sales)
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || String(e)
    });
  }
});

/* =========================
   Employee: Customer Sales
   عرض حساب شخص للموظف
========================= */
router.get("/local-stock/customer", async (req, res) => {
  try {
    const r = await getRedisLocal();

    const customer = safeStr(req.query?.customer);
    const includeSettled = safeStr(req.query?.includeSettled) === "1";

    if (!customer) {
      return res.status(400).json({ error: "customer مطلوب" });
    }

    const allSales = await lsfReadStaffSales(r);

    const rows = allSales.filter((x) => {
      return lsfNorm(x.customer) === lsfNorm(customer);
    });

    const sales = buildEmployeeInvoiceItems(rows, includeSettled);

    return res.json({
      ok: true,
      customer,
      includeSettled,
      sales,
      count: sales.length,
      totalQty: sales.reduce((s, x) => s + Number(x.qty || 0), 0),
      totalAmount: money3(sales.reduce((s, x) => s + Number(x.total || 0), 0)),
      outstanding: money3(
        sales
          .filter((x) => !x.settled)
          .reduce((s, x) => s + Number(x.total || 0), 0)
      ),
      unpricedCount: sales.filter((x) => !(Number(x.unitPrice || 0) > 0)).length
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || String(e)
    });
  }
});

/* =========================
   Employee: Customer Invoice
   فاتورة شخص للموظف
========================= */
router.get("/local-stock/customer-invoice", async (req, res) => {
  try {
    const r = await getRedisLocal();

    const customer = safeStr(req.query?.customer);
    const includeSettled = safeStr(req.query?.includeSettled) === "1";

    if (!customer) {
      return res.status(400).json({ error: "customer مطلوب" });
    }

    const allSales = await lsfReadStaffSales(r);

    const rows = allSales.filter((x) => {
      return lsfNorm(x.customer) === lsfNorm(customer);
    });

    const items = buildEmployeeInvoiceItems(rows, includeSettled);

    return res.json({
      ok: true,
      customer,
      includeSettled,
      count: items.length,
      totalQty: items.reduce((s, x) => s + Number(x.qty || 0), 0),
      totalAmount: money3(items.reduce((s, x) => s + Number(x.total || 0), 0)),
      unpricedCount: items.filter((x) => !(Number(x.unitPrice || 0) > 0)).length,
      items
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || String(e)
    });
  }
});

/* =========================
   Employee: Update Sale Price
   تعديل سعر منتج في فاتورة الشخص
========================= */
router.patch("/local-stock/sale-price", async (req, res) => {
  try {
    const r = await getRedisLocal();

    const saleId = safeStr(req.body?.saleId);
    const unitPrice = money3(req.body?.unitPrice);

    if (!saleId) {
      return res.status(400).json({ error: "saleId مطلوب" });
    }

    if (!(unitPrice > 0)) {
      return res.status(400).json({ error: "السعر لازم أكبر من 0" });
    }

    const rows = await lsfReadStaffSales(r);
    const idx = rows.findIndex((x) => safeStr(x.id) === saleId);

    if (idx < 0) {
      return res.status(404).json({ error: "عملية البيع غير موجودة" });
    }

    if (rows[idx].settled) {
      return res.status(400).json({ error: "لا يمكن تعديل سعر عملية مرحلة" });
    }

    const qty = Number(rows[idx].qty || 0) || 0;

    rows[idx].unitPrice = unitPrice;
    rows[idx].total = money3(qty * unitPrice);
    rows[idx].priceConfirmed = true;
    rows[idx].priceUpdatedAt = new Date().toISOString();
    rows[idx].priceUpdatedBy = "PACK_EMPLOYEE";

    await lsfReplaceStaffSales(r, rows);

    return res.json({
      ok: true,
      sale: lsfInvoiceItem(rows[idx])
    });
  } catch (e) {
    return res.status(e?.status || 500).json({
      error: e?.message || String(e)
    });
  }
});

export default router;
