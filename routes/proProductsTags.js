import express from "express";

// إذا Node < 18 ثبت node-fetch واستخدمه
// npm i node-fetch
import fetch from "node-fetch";

const router = express.Router();

/* =========================
   Shopify ENV
========================= */
const SHOP = String(process.env.SHOPIFY_SHOP || "").trim();               // your-store.myshopify.com
const TOKEN = String(process.env.SHOPIFY_ADMIN_TOKEN || "").trim();       // Admin token
const API_VERSION = String(process.env.SHOPIFY_API_VERSION || "2026-01"); // اختياري

function assertShopifyEnv() {
  const miss = [];
  if (!SHOP) miss.push("SHOPIFY_SHOP");
  if (!TOKEN) miss.push("SHOPIFY_ADMIN_TOKEN");
  if (miss.length) throw new Error(`Missing env: ${miss.join(", ")}`);
}

/* =========================
   ✅ Auth middleware (بدون ENV جديد)
   يتحقق من نفس مسار الدخول القديم:
   /api/products/staff/pending-add
========================= */
const keyCache = new Map(); // key -> { ok:true, exp:number }
const CACHE_MS = 5 * 60 * 1000; // 5 دقائق كاش

async function verifyKeyViaApi(req, key) {
  const base = `${req.protocol}://${req.get("host")}`;

  const r = await fetch(`${base}/api/products/staff/pending-add`, {
    method: "GET",
    headers: { "x-products-staff-key": key },
    cache: "no-store",
  });

  return r.ok; // 200 => صحيح، 401 => خطأ
}

async function requireProductsStaff(req, res, next) {
  const headerKey = String(req.headers["x-products-staff-key"] || "").trim();
  const auth = String(req.headers["authorization"] || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const key = headerKey || bearer;

  if (!key) return res.status(401).json({ error: "Unauthorized" });

  const now = Date.now();
  const cached = keyCache.get(key);
  if (cached?.ok && cached.exp > now) return next();

  try {
    const ok = await verifyKeyViaApi(req, key);
    if (!ok) return res.status(401).json({ error: "Unauthorized" });

    keyCache.set(key, { ok: true, exp: now + CACHE_MS });
    return next();
  } catch {
    return res.status(503).json({ error: "Auth service unavailable" });
  }
}

router.get("/debug-auth", async (req, res) => {
  const headerKey = String(req.headers["x-products-staff-key"] || "");
  const auth = String(req.headers["authorization"] || "");

  let apiOk = null;
  let apiStatus = null;
  try {
    const base = `${req.protocol}://${req.get("host")}`;
    const r = await fetch(`${base}/api/products/staff/pending-add`, {
      headers: { "x-products-staff-key": headerKey },
      method: "GET",
    });
    apiOk = r.ok;
    apiStatus = r.status;
  } catch {
    apiOk = false;
    apiStatus = "fetch_error";
  }

  res.json({
    headerReceived: headerKey.length > 0,
    headerLength: headerKey.length,
    authorizationReceived: auth.length > 0,
    apiOk,
    apiStatus,
  });
});

router.use(requireProductsStaff);

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
   Utils
========================= */
function toProductGid(productId) {
  const s = String(productId || "").trim();
  if (!s) return "";
  if (s.startsWith("gid://shopify/Product/")) return s;
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`;
  if (s.startsWith("gid://")) return s;
  return s;
}

function uniqStrings(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const v = String(x || "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function buildProductSearchQuery(qRaw) {
  const base = "status:active";
  const q = String(qRaw || "").trim();
  if (!q) return base;

  const safe = q.replace(/"/g, '\\"');
  return `${base} ${safe}`;
}

function normalizeTag(s) {
  return String(s || "").trim();
}
function tagEquals(a, b) {
  // مساواة مرنة (حروف صغيرة) عشان ما تتعب
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

/* =========================
   Cursor Cache (للتصفح صفحات)
========================= */
const cursorCache = new Map(); // key -> { pageToAfter: Map(page -> cursor|null) }

function getCacheKey(q, limit, all, tag) {
  return `${String(q || "").trim()}|${Number(limit) || 0}|${all ? 1 : 0}|${String(tag || "").trim().toLowerCase()}`;
}
function ensureCache(key) {
  if (!cursorCache.has(key)) {
    cursorCache.set(key, { pageToAfter: new Map([[1, null]]) });
  }
  return cursorCache.get(key);
}

/* =========================
   GraphQL Queries
========================= */
const PRODUCTS_PAGE_QUERY = `
  query ProductsPage($first: Int!, $after: String, $query: String!) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        cursor
        node {
          id
          title
          handle
          status
          vendor
          tags
          featuredImage { url }
        }
      }
    }
  }
`;

const PRODUCT_TAGS_QUERY = `
  query ProductTags($id: ID!) {
    product(id: $id) {
      id
      tags
    }
  }
`;

const PRODUCT_UPDATE_TAGS_MUTATION = `
  mutation UpdateProductTags($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id tags }
      userErrors { field message }
    }
  }
`;

/* =========================
   GET /ping
========================= */
router.get("/ping", (req, res) => res.json({ ok: true }));

/* =========================
   GET /tags-stats
   ✅ يعيد أكثر/أقل التاقات (count لكل تاق)
   - خفيف: يقرأ عدد محدود من المنتجات (افتراضي 1500)
   - Query: max (اختياري)
========================= */
router.get("/tags-stats", async (req, res) => {
  const max = Math.min(5000, Math.max(200, parseInt(req.query.max, 10) || 1500));
  const queryStr = "status:active";

  try {
    const counts = new Map(); // tagLower -> { tag, count }
    let scanned = 0;
    let after = null;
    let loops = 0;

    while (scanned < max && loops < 25) {
      loops += 1;

      const data = await adminGraphQL(PRODUCTS_PAGE_QUERY, {
        first: 100, // خفيف
        after,
        query: queryStr,
      });

      const edges = data?.products?.edges || [];
      const pageInfo = data?.products?.pageInfo || {};
      after = pageInfo?.endCursor ?? null;

      for (const e of edges) {
        const p = e?.node;
        if (!p) continue;

        scanned += 1;

        const tags = Array.isArray(p.tags) ? p.tags : [];
        for (const t of tags) {
          const tag = normalizeTag(t);
          if (!tag) continue;

          const k = tag.toLowerCase();
          const obj = counts.get(k) || { tag, count: 0 };
          obj.count += 1;
          // نخلي الاسم أول مرة يظهر
          if (!counts.has(k)) counts.set(k, obj);
          else counts.set(k, obj);
        }

        if (scanned >= max) break;
      }

      if (!pageInfo?.hasNextPage || !after) break;
      if (!edges.length) break;
    }

    const items = Array.from(counts.values()).sort((a, b) => (b.count || 0) - (a.count || 0));
    res.json({ items, scanned });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* =========================
   GET /untagged
   ✅ يعرض منتجات Active فقط
   Query: page, limit, q, all=0/1, tag=اختياري
   - إذا all=0: يعرض منتجات بدون تاقات فقط
   - إذا all=1: يعرض كل المنتجات
   - إذا tag موجود: يعرض المنتجات التي تحتوي هذا التاق (حتى لو all=0)
========================= */
router.get("/untagged", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const q = String(req.query.q || "").trim();
  const all = String(req.query.all || "0") === "1";
  const tag = normalizeTag(req.query.tag || "");

  const queryStr = buildProductSearchQuery(q);

  // ✅ الكاش لازم يدخل فيه all و tag عشان ما يخلط صفحات مختلفة
  const cacheKey = getCacheKey(q, limit, all, tag);
  const cache = ensureCache(cacheKey);

  // جيب cursor للصفحة المطلوبة
  let after = cache.pageToAfter.get(page) ?? null;

  // لو ما عندنا cursor للصفحة، نبنيها تدريجيًا
  if (!cache.pageToAfter.has(page)) {
    const knownPages = Array.from(cache.pageToAfter.keys()).sort((a, b) => a - b);
    const startPage = knownPages.length ? knownPages[knownPages.length - 1] : 1;

    let curPage = startPage;
    let curAfter = cache.pageToAfter.get(startPage) ?? null;

    while (curPage < page) {
      const data = await adminGraphQL(PRODUCTS_PAGE_QUERY, {
        first: limit,
        after: curAfter,
        query: queryStr,
      });

      const endCursor = data?.products?.pageInfo?.endCursor ?? null;
      curAfter = endCursor;
      curPage += 1;
      cache.pageToAfter.set(curPage, curAfter);

      if (!data?.products?.pageInfo?.hasNextPage) break;
      if (!endCursor) break;
    }

    after = cache.pageToAfter.get(page) ?? null;
  }

  try {
    const items = [];
    let loops = 0;
    let hasNext = true;
    let currentAfter = after ?? null;

    while (items.length < limit && hasNext && loops < 12) {
      loops += 1;

      const data = await adminGraphQL(PRODUCTS_PAGE_QUERY, {
        first: limit,
        after: currentAfter,
        query: queryStr,
      });

      const edges = data?.products?.edges || [];
      const pageInfo = data?.products?.pageInfo || {};
      hasNext = Boolean(pageInfo?.hasNextPage);
      const endCursor = pageInfo?.endCursor ?? null;

      // نخزن cursor للصفحة التالية
      cache.pageToAfter.set(page + 1, endCursor);

      for (const e of edges) {
        const p = e?.node;
        if (!p) continue;

        const tags = Array.isArray(p.tags) ? p.tags : [];

        // ✅ فلترة tag
        if (tag) {
          const ok = tags.some((t) => tagEquals(t, tag));
          if (!ok) continue;
        } else {
          // ✅ السلوك القديم: بدون تاق فلتر
          if (!all && tags.length !== 0) continue;
        }

        items.push({
          productId: p.id,
          title: p.title || "",
          handle: p.handle || "",
          vendor: p.vendor || "",
          tags,
          image: p?.featuredImage?.url || "",
          status: p.status || "ACTIVE",
        });

        if (items.length >= limit) break;
      }

      currentAfter = endCursor;
      if (!endCursor) break;
      if (!edges.length) break;
    }

    // ملاحظة: total هنا “عدد العناصر الراجعة لهذه الصفحة”
    // لو تحتاج total حقيقي لكل النتائج لازم endpoint خاص—لكن ما يؤثر على عمل صفحتك الحالية.
    res.json({ items, total: items.length, page, limit });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* =========================
   POST /add-tags
   body: { productId, tags:[] }
   ✅ يضيف التاقات (يدمج مع الحالية بدون تكرار)
========================= */
router.post("/add-tags", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const productId = toProductGid(req.body?.productId);
    const tagsIn = req.body?.tags;

    if (!productId) return res.status(400).json({ error: "productId مطلوب" });
    if (!Array.isArray(tagsIn)) return res.status(400).json({ error: "tags لازم تكون Array" });

    const newTags = uniqStrings(tagsIn);
    if (!newTags.length) return res.status(400).json({ error: "لا توجد تاقات صالحة" });

    // 1) التاقات الحالية
    const pData = await adminGraphQL(PRODUCT_TAGS_QUERY, { id: productId });
    const cur = Array.isArray(pData?.product?.tags) ? pData.product.tags : [];

    // 2) دمج بدون تكرار
    const merged = uniqStrings([...cur, ...newTags]);

    // 3) تحديث
    const up = await adminGraphQL(PRODUCT_UPDATE_TAGS_MUTATION, {
      input: { id: productId, tags: merged },
    });

    const errs = up?.productUpdate?.userErrors || [];
    if (errs.length) {
      return res.status(400).json({ error: errs[0]?.message || "Shopify userErrors" });
    }

    const outTags = up?.productUpdate?.product?.tags || merged;
    return res.json({ ok: true, tags: outTags });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

/* =========================
   POST /remove-tag
   body: { productId, tag }
   ✅ يحذف تاق واحد
========================= */
router.post("/remove-tag", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    const productId = toProductGid(req.body?.productId);
    const tag = normalizeTag(req.body?.tag);

    if (!productId) return res.status(400).json({ error: "productId مطلوب" });
    if (!tag) return res.status(400).json({ error: "tag مطلوب" });

    // 1) التاقات الحالية
    const pData = await adminGraphQL(PRODUCT_TAGS_QUERY, { id: productId });
    const cur = Array.isArray(pData?.product?.tags) ? pData.product.tags : [];

    // 2) حذف
    const next = cur.filter((t) => !tagEquals(t, tag));

    // 3) تحديث
    const up = await adminGraphQL(PRODUCT_UPDATE_TAGS_MUTATION, {
      input: { id: productId, tags: next },
    });

    const errs = up?.productUpdate?.userErrors || [];
    if (errs.length) {
      return res.status(400).json({ error: errs[0]?.message || "Shopify userErrors" });
    }

    const outTags = up?.productUpdate?.product?.tags || next;
    return res.json({ ok: true, tags: outTags });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

export default router;
