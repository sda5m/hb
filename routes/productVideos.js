import express from "express";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import multer from "multer";

const VIDEO_STATS_FILE = path.join(process.cwd(), "data", "product_video_stats.json");
const VIDEO_STATS_REDIS_KEY = "bt:product_video_stats";
const VIDEO_STATS_BASELINE = {
  viewsMin: 85,
  viewsMax: 260,
  likesMin: 6,
  likesMax: 24,
  sharesMin: 2,
  sharesMax: 14,
  favorites: 0
};
let videoStatsGetRedis = null;

function setVideoStatsRedis(getRedis) {
  if (typeof getRedis === "function") videoStatsGetRedis = getRedis;
}

async function readVideoStatsStoreSafe() {
  if (videoStatsGetRedis) {
    try {
      const r = await videoStatsGetRedis();
      const text = r ? await r.get(VIDEO_STATS_REDIS_KEY) : "";
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (e) {
      console.warn("[product-videos/stats] redis read failed:", e?.message || String(e));
    }
  }

  try {
    const text = await fs.readFile(VIDEO_STATS_FILE, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeVideoStatsStoreSafe(store) {
  if (videoStatsGetRedis) {
    try {
      const r = await videoStatsGetRedis();
      if (r) {
        await r.set(VIDEO_STATS_REDIS_KEY, JSON.stringify(store));
        return;
      }
    } catch (e) {
      console.warn("[product-videos/stats] redis write failed:", e?.message || String(e));
    }
  }

  await fs.mkdir(path.dirname(VIDEO_STATS_FILE), { recursive: true });
  await fs.writeFile(VIDEO_STATS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function seededVideoNumber(seed, salt, min, max) {
  const span = Math.max(1, max - min + 1);
  let h = 2166136261;
  const text = `${seed || ""}:${salt || ""}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return min + (Math.abs(h) % span);
}

function defaultVideoStatsFor(id = "") {
  return {
    views: seededVideoNumber(id, "views", VIDEO_STATS_BASELINE.viewsMin, VIDEO_STATS_BASELINE.viewsMax),
    likes: seededVideoNumber(id, "likes", VIDEO_STATS_BASELINE.likesMin, VIDEO_STATS_BASELINE.likesMax),
    favorites: VIDEO_STATS_BASELINE.favorites,
    shares: seededVideoNumber(id, "shares", VIDEO_STATS_BASELINE.sharesMin, VIDEO_STATS_BASELINE.sharesMax)
  };
}

function storedVideoStats(row = {}) {
  return {
    ...row,
    views: Math.max(0, Number(row?.views || 0) || 0),
    likes: Math.max(0, Number(row?.likes || 0) || 0),
    favorites: Math.max(0, Number(row?.favorites || 0) || 0),
    shares: Math.max(0, Number(row?.shares || 0) || 0)
  };
}

function visibleVideoStats(id = "", row = {}) {
  const defaults = defaultVideoStatsFor(id);
  const stored = storedVideoStats(row);
  return {
    ...stored,
    views: defaults.views + stored.views,
    likes: defaults.likes + stored.likes,
    favorites: defaults.favorites + stored.favorites,
    shares: defaults.shares + stored.shares
  };
}

function emptyPublicVideoStats() {
  return defaultVideoStatsFor("");
}

function cleanPublicVideoStatsId(value) {
  return String(value || "")
    .trim()
    .replace(/[^\w:./-]+/g, "_")
    .slice(0, 220);
}

async function readPublicVideoStatsStore() {
  return readVideoStatsStoreSafe();
}

async function writePublicVideoStatsStore(store) {
  await writeVideoStatsStoreSafe(store);
}

async function getPublicVideoStats(videoId) {
  const id = cleanPublicVideoStatsId(videoId);
  if (!id) return emptyPublicVideoStats();
  const store = await readPublicVideoStatsStore();
  return visibleVideoStats(id, store[id]);
}

async function recordPublicVideoEvent(videoId, event) {
  const id = cleanPublicVideoStatsId(videoId);
  if (!id) return emptyPublicVideoStats();

  const fieldByEvent = {
    view: "views",
    like: "likes",
    favorite: "favorites",
    share: "shares"
  };
  const field = fieldByEvent[String(event || "").trim()];
  if (!field) return getPublicVideoStats(id);

  const store = await readPublicVideoStatsStore();
  const current = storedVideoStats(store[id]);
  current[field] = Math.max(0, Number(current[field] || 0)) + 1;
  current.updatedAt = new Date().toISOString();
  store[id] = current;
  await writePublicVideoStatsStore(store);
  return visibleVideoStats(id, current);
}

export function productVideoStatsRouter(options = {}) {
  setVideoStatsRedis(options.getRedis);
  const router = express.Router();

  router.get("/product-videos/stats", async (req, res) => {
    try {
      res.json({
        ok: true,
        stats: await getPublicVideoStats(req.query.videoId)
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "stats_failed" });
    }
  });

  router.post("/product-videos/stats/event", express.json(), async (req, res) => {
    try {
      const videoId = req.body?.videoId || req.query.videoId;
      const event = req.body?.event || req.query.event;
      res.json({
        ok: true,
        stats: await recordPublicVideoEvent(videoId, event)
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || "stats_event_failed" });
    }
  });

  return router;
}

export default function productVideosRouter(options = {}) {
  setVideoStatsRedis(options.getRedis);
  const router = express.Router();

  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const API_VERSION =
    process.env.SHOPIFY_API_VERSION ||
    process.env.SHOPIFY_GQL_VERSION ||
    "2026-01";

  const VIDEO_TAG = "video";
  const VIDEO_DATE_TAG_PREFIX = "video_date_";
  const VIDEO_GROUP_TAG_PREFIX = "video_group_";
  const VIDEO_MAX_MB = Math.min(Math.max(Number(process.env.PRODUCT_VIDEO_MAX_MB || 500), 10), 5000);
  const VIDEO_STATS_FILE = path.join(process.cwd(), "data", "product_video_stats.json");

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: VIDEO_MAX_MB * 1024 * 1024
    }
  });

  function assertEnv(res) {
    if (!SHOP || !TOKEN) {
      res.status(500).json({ error: "ENV ناقص" });
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
    let data = {};

    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }

    if (!r.ok) {
      console.error("GraphQL HTTP", r.status, text);
      throw new Error(`HTTP ${r.status}: ${text.slice(0, 700)}`);
    }

    if (data?.errors?.length) {
      console.error("GraphQL errors", JSON.stringify(data.errors, null, 2));
      throw new Error(
        data.errors.map((x) => x.message).filter(Boolean).join(" | ") ||
        "GraphQL error"
      );
    }

    return data.data;
  }

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[أإآا]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanTerm(s) {
    return String(s || "")
      .replace(/["\\(){}[\]<>:]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeFileName(name) {
    const raw = String(name || "video").trim();
    return raw
      .replace(/[^\w.\-() ]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 160) || "video";
  }

  function mimeFromFile(file) {
    const m = String(file?.mimetype || "").trim();
    if (m && m !== "application/octet-stream") return m;

    const n = String(file?.originalname || "").toLowerCase();

    if (n.endsWith(".mp4")) return "video/mp4";
    if (n.endsWith(".m4v")) return "video/x-m4v";
    if (n.endsWith(".mov")) return "video/quicktime";
    if (n.endsWith(".webm")) return "video/webm";
    if (n.endsWith(".avi")) return "video/x-msvideo";
    if (n.endsWith(".wmv")) return "video/x-ms-wmv";
    if (n.endsWith(".mpeg") || n.endsWith(".mpg")) return "video/mpeg";
    if (n.endsWith(".3gp")) return "video/3gpp";
    if (n.endsWith(".3g2")) return "video/3gpp2";
    if (n.endsWith(".ogv")) return "video/ogg";
    if (n.endsWith(".mkv")) return "video/x-matroska";
    if (n.endsWith(".ts")) return "video/mp2t";
    if (n.endsWith(".mts") || n.endsWith(".m2ts")) return "video/mp2t";

    return "video/mp4";
  }

  function looksVideo(file) {
    const m = String(file?.mimetype || "").toLowerCase();
    const n = String(file?.originalname || "").toLowerCase();

    if (m.startsWith("video/")) return true;

    return /\.(mp4|m4v|mov|webm|avi|wmv|mpeg|mpg|3gp|3g2|ogv|mkv|ts|mts|m2ts)$/i.test(n);
  }

  function videoUrl(media) {
    const sources = Array.isArray(media?.sources) ? media.sources : [];
    const preferred =
      sources.find((s) => String(s?.mimeType || "").toLowerCase().includes("mp4")) ||
      sources.find((s) => String(s?.url || "").trim()) ||
      null;

    return preferred?.url || "";
  }

  function mapProduct(p) {
    const media = p?.media?.nodes || [];

    const videos = media
      .filter((m) => String(m?.mediaContentType || "") === "VIDEO")
      .map((m) => ({
        id: m?.id || "",
        status: m?.status || "",
        previewStatus: m?.preview?.status || "",
        previewImage: m?.preview?.image?.url || "",
        url: videoUrl(m),
        sources: Array.isArray(m?.sources) ? m.sources : []
      }));

    const variants = (p?.variants?.nodes || []).map((v) => ({
      id: v?.id || "",
      title: v?.title || "",
      sku: v?.sku || "",
      barcode: v?.barcode || ""
    }));

    return {
      id: p?.id || "",
      title: p?.title || "",
      handle: p?.handle || "",
      vendor: p?.vendor || "",
      productType: p?.productType || "",
      description: p?.description || "",
      tags: Array.isArray(p?.tags) ? p.tags : [],
      image: p?.featuredImage?.url || "",
      variants,
      videos,
      videoCount: videos.length,
      hasVideo: videos.length > 0
    };
  }

  function searchableText(p) {
    return norm([
      p.title,
      p.handle,
      p.vendor,
      p.productType,
      p.description,
      ...(Array.isArray(p.tags) ? p.tags : []),
      ...(Array.isArray(p.variants) ? p.variants.flatMap((v) => [v.title, v.sku, v.barcode]) : [])
    ].join(" "));
  }

  function matchesSearch(p, q) {
    const qq = norm(q);
    if (!qq) return true;

    const hay = searchableText(p);
    const parts = qq.split(" ").filter(Boolean);

    return parts.every((x) => hay.includes(x));
  }

  function sortProducts(a, b) {
    const bt = videoTagTimestamp(b.tags);
    const at = videoTagTimestamp(a.tags);
    if (bt !== at) return bt - at;

    const av = a.hasVideo ? 1 : 0;
    const bv = b.hasVideo ? 1 : 0;
    if (bv !== av) return bv - av;

    const vc = Number(b.videoCount || 0) - Number(a.videoCount || 0);
    if (vc !== 0) return vc;

    return String(a.title || "").localeCompare(String(b.title || ""), "ar");
  }

  function emptyVideoStats() {
    return defaultVideoStatsFor("");
  }

  function cleanVideoStatsId(value) {
    return String(value || "")
      .trim()
      .replace(/[^\w:./-]+/g, "_")
      .slice(0, 220);
  }

  async function readVideoStatsStore() {
    return readVideoStatsStoreSafe();
  }

  async function writeVideoStatsStore(store) {
    await writeVideoStatsStoreSafe(store);
  }

  async function getVideoStats(videoId) {
    const id = cleanVideoStatsId(videoId);
    if (!id) return emptyVideoStats();
    const store = await readVideoStatsStore();
    return visibleVideoStats(id, store[id]);
  }

  async function recordVideoEvent(videoId, event) {
    const id = cleanVideoStatsId(videoId);
    if (!id) return emptyVideoStats();

    const fieldByEvent = {
      view: "views",
      like: "likes",
      favorite: "favorites",
      share: "shares"
    };
    const field = fieldByEvent[String(event || "").trim()];
    if (!field) return getVideoStats(id);

    const store = await readVideoStatsStore();
    const current = storedVideoStats(store[id]);
    current[field] = Math.max(0, Number(current[field] || 0)) + 1;
    current.updatedAt = new Date().toISOString();
    store[id] = current;
    await writeVideoStatsStore(store);
    return visibleVideoStats(id, current);
  }

  function videoGroupKey(product) {
    const tags = Array.isArray(product?.tags) ? product.tags : [];
    const firstVideoUrl = Array.isArray(product?.videos)
      ? product.videos.find((video) => video?.url)?.url || ""
      : "";
    return tags.find(isVideoGroupTag) || firstVideoUrl || product?.id || "";
  }

  function groupVideoProducts(products) {
    const groups = new Map();

    for (const product of products) {
      const key = videoGroupKey(product);
      if (!key) continue;

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          ...product,
          products: [product],
          productCount: 1
        });
        continue;
      }

      if (!existing.products.some((item) => item.id === product.id)) {
        existing.products.push(product);
        existing.productCount = existing.products.length;
      }

      if (videoTagTimestamp(product.tags) > videoTagTimestamp(existing.tags)) {
        groups.set(key, {
          ...product,
          products: existing.products,
          productCount: existing.products.length
        });
      }
    }

    return Array.from(groups.values()).sort(sortProducts);
  }

  function videoDateTag(date = new Date()) {
    const stamp = date
      .toISOString()
      .replace(/\D/g, "")
      .slice(0, 14);
    return `${VIDEO_DATE_TAG_PREFIX}${stamp}`;
  }

  function videoGroupTag(date = new Date()) {
    const stamp = date
      .toISOString()
      .replace(/\D/g, "")
      .slice(0, 14);
    return `${VIDEO_GROUP_TAG_PREFIX}${stamp}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function isVideoDateTag(tag) {
    return String(tag || "").startsWith(VIDEO_DATE_TAG_PREFIX);
  }

  function isVideoGroupTag(tag) {
    return String(tag || "").startsWith(VIDEO_GROUP_TAG_PREFIX);
  }

  function videoTagTimestamp(tags) {
    const tag = (Array.isArray(tags) ? tags : []).find(isVideoDateTag);
    const raw = String(tag || "").slice(VIDEO_DATE_TAG_PREFIX.length);
    return Number(raw) || 0;
  }

  function parseProductIds(body = {}) {
    const raw = body.productIds ?? body.productId ?? "";
    let values = [];

    if (Array.isArray(raw)) {
      values = raw;
    } else if (typeof raw === "string") {
      const value = raw.trim();
      if (value.startsWith("[")) {
        try {
          values = JSON.parse(value);
        } catch {
          values = [];
        }
      } else {
        values = value.split(",");
      }
    }

    const seen = new Set();
    return values
      .map((id) => String(id || "").trim())
      .filter((id) => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }

  const PRODUCT_FIELDS = `
    id
    title
    handle
    vendor
    productType
    description
    tags
    featuredImage { url }
    variants(first: 20) {
      nodes {
        id
        title
        sku
        barcode
      }
    }
    media(first: 30) {
      nodes {
        id
        alt
        mediaContentType
        status
        preview {
          status
          image { url }
        }
        ... on Video {
          sources {
            url
            mimeType
            format
            height
            width
          }
        }
      }
    }
  `;

  async function fetchProductChunk({ queryStr, first = 12, after = null }) {
    const q = `
      query ProductVideosChunk($first: Int!, $after: String, $query: String!) {
        products(first: $first, after: $after, query: $query, sortKey: TITLE) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ${PRODUCT_FIELDS}
          }
        }
      }
    `;

    const d = await adminGraphQL(q, {
      first: Math.min(Math.max(Number(first) || 12, 1), 50),
      after: after || null,
      query: queryStr
    });

    const conn = d?.products || {};

    return {
      items: (conn.nodes || []).map(mapProduct),
      hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
      endCursor: conn?.pageInfo?.endCursor || null
    };
  }

  function buildProductSearchQuery(qRaw) {
    const q = cleanTerm(qRaw);
    if (!q) return "status:active";

    const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);

    const groups = terms.map((t) => {
      return `title:*${t}* OR handle:*${t}* OR vendor:*${t}* OR product_type:*${t}* OR tag:*${t}*`;
    });

    return `status:active AND (${groups.join(" OR ")})`;
  }

  function buildVariantSearchQuery(qRaw) {
    const q = cleanTerm(qRaw);
    if (!q) return "";

    const terms = q.split(/\s+/).filter(Boolean).slice(0, 5);

    const groups = terms.map((t) => {
      return `sku:${t} OR barcode:${t} OR title:*${t}* OR product_title:*${t}*`;
    });

    return `(${groups.join(" OR ")})`;
  }

  async function searchProducts(qRaw, limit = 24) {
    const limitSafe = Math.min(Math.max(Number(limit) || 24, 1), 50);
    const qClean = cleanTerm(qRaw);

    const found = [];

    const pQuery = buildProductSearchQuery(qClean);
    const pChunk = await fetchProductChunk({
      queryStr: pQuery,
      first: limitSafe,
      after: null
    });

    found.push(...pChunk.items);

    if (qClean) {
      const variantQuery = buildVariantSearchQuery(qClean);

      if (variantQuery) {
        const gql = `
          query ProductVideosVariantSearch($first: Int!, $query: String!) {
            productVariants(first: $first, query: $query) {
              nodes {
                product {
                  ${PRODUCT_FIELDS}
                }
              }
            }
          }
        `;

        const d = await adminGraphQL(gql, {
          first: Math.min(limitSafe, 40),
          query: variantQuery
        });

        const fromVariants = (d?.productVariants?.nodes || [])
          .map((x) => x?.product)
          .filter(Boolean)
          .map(mapProduct);

        found.push(...fromVariants);
      }
    }

    const seen = new Set();
    const merged = [];

    for (const p of found) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);

      if (qClean && !matchesSearch(p, qClean)) {
        const fallback = norm([p.title, p.handle, p.vendor, p.productType].join(" "));
        const qq = norm(qClean);
        if (!fallback.includes(qq)) continue;
      }

      merged.push(p);
      if (merged.length >= limitSafe) break;
    }

    return merged.sort(sortProducts);
  }

  async function getProduct(productId) {
    const q = `
      query ProductVideosOne($id: ID!) {
        product(id: $id) {
          ${PRODUCT_FIELDS}
        }
      }
    `;

    const d = await adminGraphQL(q, { id: productId });
    if (!d?.product?.id) return null;
    return mapProduct(d.product);
  }

  async function addVideoLabel(productId, existingTags = [], groupTag = "") {
    const tagsToRemove = (Array.isArray(existingTags) ? existingTags : [])
      .filter((tag) => isVideoDateTag(tag) || isVideoGroupTag(tag));

    if (tagsToRemove.length) {
      const removeMutation = `
        mutation RemoveOldVideoDateTags($id: ID!, $tags: [String!]!) {
          tagsRemove(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }
      `;

      const removed = await adminGraphQL(removeMutation, {
        id: productId,
        tags: tagsToRemove
      });

      const removeErr = removed?.tagsRemove?.userErrors?.[0];
      if (removeErr) {
        throw new Error(removeErr.message || "فشل حذف ترتيب الفيديو القديم");
      }
    }

    const m = `
      mutation AddVideoLabel($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }
    `;

    const d = await adminGraphQL(m, {
      id: productId,
      tags: [VIDEO_TAG, videoDateTag(), groupTag].filter(Boolean)
    });

    const err = d?.tagsAdd?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل الحفظ");
  }

  async function removeVideoLabel(productId, existingTags = []) {
    const tagsToRemove = [
      VIDEO_TAG,
      ...(Array.isArray(existingTags)
        ? existingTags.filter((tag) => isVideoDateTag(tag) || isVideoGroupTag(tag))
        : [])
    ];

    const m = `
      mutation RemoveVideoLabel($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { field message }
        }
      }
    `;

    const d = await adminGraphQL(m, {
      id: productId,
      tags: tagsToRemove
    });

    const err = d?.tagsRemove?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل الحذف");
  }

  function uploadFileName(file, index = 0) {
    const prefix = `${Date.now()}-${index + 1}`;
    return safeFileName(`${prefix}-${file?.originalname || "video.mp4"}`);
  }

  async function createStage(file, filename = safeFileName(file?.originalname)) {
    const m = `
      mutation CreateStage($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const d = await adminGraphQL(m, {
      input: [
        {
          resource: "VIDEO",
          filename,
          mimeType: mimeFromFile(file),
          fileSize: String(file.size || file.buffer?.length || 0),
          httpMethod: "POST"
        }
      ]
    });

    const err = d?.stagedUploadsCreate?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل تجهيز الرفع");

    const target = d?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!target?.url || !target?.resourceUrl) {
      throw new Error("فشل تجهيز الرفع");
    }

    return target;
  }

  async function uploadToStage(target, file, filename = safeFileName(file?.originalname)) {
    if (typeof FormData === "undefined" || typeof Blob === "undefined") {
      throw new Error("Node 18 أو أحدث مطلوب");
    }

    const form = new FormData();

    for (const p of target.parameters || []) {
      form.append(p.name, p.value);
    }

    const blob = new Blob([file.buffer], { type: mimeFromFile(file) });
    form.append("file", blob, filename);

    const r = await fetch(target.url, {
      method: "POST",
      body: form
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`فشل الرفع: ${r.status} ${text.slice(0, 500)}`);
    }
  }

  async function attachVideo(productId, resourceUrl, alt) {
    const m = `
      mutation AttachVideo($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
        productUpdate(product: $product, media: $media) {
          product { id }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const d = await adminGraphQL(m, {
      product: {
        id: productId
      },
      media: [
        {
          mediaContentType: "VIDEO",
          originalSource: resourceUrl,
          alt: alt || "video"
        }
      ]
    });

    const err = d?.productUpdate?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل الحفظ");
  }

  async function deleteMedia(productId, mediaIds) {
    const m = `
      mutation DeleteVideos($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          deletedProductImageIds
          mediaUserErrors {
            field
            message
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const d = await adminGraphQL(m, {
      productId,
      mediaIds
    });

    const err =
      d?.productDeleteMedia?.mediaUserErrors?.[0] ||
      d?.productDeleteMedia?.userErrors?.[0];

    if (err) throw new Error(err.message || "فشل الحذف");

    return d?.productDeleteMedia?.deletedMediaIds || [];
  }

  function parseVideo(req, res, next) {
    const handler = upload.single("video");

    handler(req, res, (err) => {
      if (!err) return next();

      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: `حجم الملف أكبر من ${VIDEO_MAX_MB}MB`
        });
      }

      return res.status(400).json({
        error: err.message || "فشل قراءة الملف"
      });
    });
  }

  router.get("/product-videos/feed", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(Math.max(Number(req.query.limit) || 12, 4), 24);
      const q = String(req.query.q || "").trim();

      if (q) {
        const items = await searchProducts(q, limit);
        return res.json({
          ok: true,
          mode: "search",
          items,
          hasNext: false,
          next: null,
          count: items.length
        });
      }

      const seen = new Set();
      const items = [];

      let videoAfter = String(req.query.videoAfter || "").trim() || null;
      let normalAfter = String(req.query.normalAfter || "").trim() || null;
      let videoDone = String(req.query.videoDone || "") === "1";
      let normalHasNext = true;

      if (!videoDone) {
        let rounds = 0;

        while (items.length < limit && !videoDone && rounds < 4) {
          rounds += 1;

          const chunk = await fetchProductChunk({
            queryStr: `status:active AND tag:${VIDEO_TAG}`,
            first: Math.min(limit - items.length, 20),
            after: videoAfter
          });

          for (const p of chunk.items) {
            if (!p?.id || seen.has(p.id)) continue;
            seen.add(p.id);
            items.push(p);
            if (items.length >= limit) break;
          }

          videoAfter = chunk.endCursor;
          videoDone = !chunk.hasNextPage || !videoAfter;
        }
      }

      if (items.length < limit) {
        let rounds = 0;

        while (items.length < limit && normalHasNext && rounds < 8) {
          rounds += 1;

          const chunk = await fetchProductChunk({
            queryStr: "status:active",
            first: 20,
            after: normalAfter
          });

          for (const p of chunk.items) {
            if (!p?.id || seen.has(p.id)) continue;

            const hasVideoLabel = Array.isArray(p.tags) && p.tags.includes(VIDEO_TAG);
            if (p.hasVideo || hasVideoLabel) continue;

            seen.add(p.id);
            items.push(p);
            if (items.length >= limit) break;
          }

          normalAfter = chunk.endCursor;
          normalHasNext = chunk.hasNextPage && Boolean(normalAfter);

          if (!normalHasNext) break;
        }
      }

      return res.json({
        ok: true,
        mode: "feed",
        items,
        count: items.length,
        hasNext: !videoDone || normalHasNext,
        next: {
          videoAfter,
          normalAfter,
          videoDone: videoDone ? 1 : 0
        }
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/product-videos/products", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 50);
      const q = String(req.query.q || "").trim();

      const items = q
        ? await searchProducts(q, limit)
        : (await fetchProductChunk({
            queryStr: "status:active",
            first: limit,
            after: String(req.query.after || "").trim() || null
          })).items.sort(sortProducts);

      return res.json({
        ok: true,
        count: items.length,
        items
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

router.get("/product-videos/with-video", async (req, res) => {
  try {
    if (!assertEnv(res)) return;

    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 24);
    const after = String(req.query.after || "").trim() || null;

    const chunk = await fetchProductChunk({
      queryStr: `status:active AND tag:${VIDEO_TAG}`,
      first: limit,
      after
    });

    const items = groupVideoProducts(chunk.items
      .filter((p) => p.hasVideo)
      .sort(sortProducts));

    return res.json({
      ok: true,
      count: items.length,
      items,
      hasNext: chunk.hasNextPage,
      next: chunk.endCursor || null
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || String(e)
    });
  }
});

  router.get("/product-videos/stats", async (req, res) => {
    try {
      const videoId = String(req.query.videoId || "").trim();
      if (!videoId) {
        return res.status(400).json({ error: "videoId مطلوب" });
      }

      return res.json({
        ok: true,
        stats: await getVideoStats(videoId)
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/product-videos/stats/event", express.json(), async (req, res) => {
    try {
      const videoId = String(req.body?.videoId || "").trim();
      const event = String(req.body?.event || "").trim();
      if (!videoId) {
        return res.status(400).json({ error: "videoId مطلوب" });
      }

      return res.json({
        ok: true,
        stats: await recordVideoEvent(videoId, event)
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  
  router.post("/product-videos/upload", parseVideo, async (req, res) => {
  try {
    if (!assertEnv(res)) return;

    const productIds = parseProductIds(req.body);

    if (!productIds.length) {
      return res.status(400).json({ error: "اختر المنتج" });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ error: "اختر الملف" });
    }

    if (!looksVideo(req.file)) {
      return res.status(400).json({ error: "الملف غير مدعوم" });
    }

    const replaceExisting =
      String(req.body?.replaceExisting || "").trim() === "1" ||
      String(req.body?.replaceExisting || "").trim() === "true";
    const groupTag = productIds.length > 1 ? videoGroupTag() : "";

    const updatedProducts = [];
    const failedProducts = [];
    for (const [index, productId] of productIds.entries()) {
      try {
        const product = await getProduct(productId);
        if (!product?.id) {
          failedProducts.push({ productId, error: "غير موجود" });
          continue;
        }

        if (replaceExisting && Array.isArray(product.videos) && product.videos.length) {
          const oldMediaIds = product.videos.map((v) => v.id).filter(Boolean);
          if (oldMediaIds.length) {
            await deleteMedia(productId, oldMediaIds);
          }
        }

        const filename = uploadFileName(req.file, index);
        const target = await createStage(req.file, filename);
        await uploadToStage(target, req.file, filename);
        await attachVideo(productId, target.resourceUrl, product.title || "video");
        await addVideoLabel(productId, product.tags, groupTag);

        const fresh = await getProduct(productId);
        if (fresh?.id) updatedProducts.push(fresh);
      } catch (error) {
        failedProducts.push({
          productId,
          error: error?.message || String(error)
        });
      }
    }

    if (!updatedProducts.length) {
      return res.status(500).json({
        error: failedProducts[0]?.error || "فشل رفع الفيديو",
        failedProducts
      });
    }

    return res.json({
      ok: true,
      product: updatedProducts[0],
      products: updatedProducts,
      count: updatedProducts.length,
      failedProducts
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

  router.post("/product-videos/delete", express.json(), async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const productId = String(req.body?.productId || "").trim();

      if (!productId) {
        return res.status(400).json({ error: "اختر المنتج" });
      }

      const product = await getProduct(productId);
      if (!product?.id) {
        return res.status(404).json({ error: "غير موجود" });
      }

      const mediaIds = product.videos.map((v) => v.id).filter(Boolean);

      if (mediaIds.length) {
        await deleteMedia(productId, mediaIds);
      }

      await removeVideoLabel(productId, product.tags).catch(() => null);

      const fresh = await getProduct(productId);

      return res.json({
        ok: true,
        deletedMediaIds: mediaIds,
        product: fresh
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
}

