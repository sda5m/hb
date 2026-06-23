import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const FRESH_TTL_MS = 2 * 60 * 1000;
const STALE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CACHE_SIZE = 500;

const DEFAULT_COUNTRY = "oman";
const PROVIDER = "Dalilee";
const VERSION = "shaheen-api-v1";

const ENCRYPTION_KEY = "JpdiI6IjRwZTRMVk40ZGt4NEtqZDFsT0x4UkE9PSIsInZ";
const SHAHEEN_BASE_URL = "https://shaheenom.com/api/customer-tracking/order-details";

const cache = new Map();
const inFlight = new Map();

function clean(value = "") {
  return String(value)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeCountry(value = "") {
  const v = String(value || DEFAULT_COUNTRY).trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(v)) return DEFAULT_COUNTRY;
  return v;
}

function sanitizeTrackingNumber(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pruneCache() {
  if (cache.size <= MAX_CACHE_SIZE) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].staleUntil - b[1].staleUntil);
  const toDelete = entries.slice(0, Math.max(1, entries.length - MAX_CACHE_SIZE));
  for (const [key] of toDelete) cache.delete(key);
}

function getFreshCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.freshUntil > Date.now()) return item.data;
  return null;
}

function getStaleCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.staleUntil > Date.now()) return item.data;
  return null;
}

function setCache(key, data) {
  const now = Date.now();
  cache.set(key, {
    data,
    freshUntil: now + FRESH_TTL_MS,
    staleUntil: now + STALE_TTL_MS
  });
  pruneCache();
}

function normalizeStatus(raw = "") {
  const s = clean(raw).toLowerCase();

if (
  s === "delivered" ||
  s === "shipment delivered" ||
  s === "delivered to customer" ||
  s === "تم التسليم" ||
  s === "تم التوصيل"
) {
  return "DELIVERED";
}
  
  if (
    s.includes("out for delivery") ||
    s.includes("خرج للتوصيل") ||
    s.includes("with courier")
  ) {
    return "OUT_FOR_DELIVERY";
  }

  if (
    s.includes("confirmed") ||
    s.includes("info received") ||
    s.includes("تم تاكيد الطلب") ||
    s.includes("تم تأكيد الطلب")
  ) {
    return "INFO_RECEIVED";
  }

  if (
    s.includes("cancelled") ||
    s.includes("canceled") ||
    s.includes("ملغي") ||
    s.includes("تم الالغاء") ||
    s.includes("تم الإلغاء")
  ) {
    return "CANCELLED";
  }

  if (
    s.includes("returned") ||
    s.includes("تم الإرجاع")
  ) {
    return "RETURNED";
  }

  if (
    s.includes("failed") ||
    s.includes("exception") ||
    s.includes("back to warehouse") ||
    s.includes("rescheduled")
  ) {
    return "EXCEPTION";
  }

  if (s) return "IN_TRANSIT";
  return "UNKNOWN";
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pick(...values) {
  for (const value of values) {
    const v = clean(value);
    if (v) return v;
  }
  return "";
}

function normalizeActivity(item = {}) {
  const statusText = pick(
    item.status_name,
    item.status_text,
    item.status,
    item.activity_name,
    item.title,
    item.description
  );

  const datetime = pick(
    item.datetime,
    item.created_at,
    item.updated_at,
    item.date
  );

  return {
    status: normalizeStatus(statusText || item.status || ""),
    statusText,
    date: pick(item.date, datetime),
    time: pick(item.time),
    datetime,
    location: pick(
      item.branch_name,
      item.service_area,
      item.location,
      item.city,
      item.wilaya_name
    ),
    note: pick(item.note, item.notes, item.description)
  };
}

function normalizeShaheenResponse(json, fallbackTrackingNumber, url) {
  const root = json?.data || json || {};
  const order =
    root.order ||
    root.shipment ||
    root.details ||
    root;

  const rawActivities =
    (Array.isArray(root.activities) && root.activities) ||
    (Array.isArray(order?.activities) && order.activities) ||
    (Array.isArray(root.updates) && root.updates) ||
    [];

  const updates = rawActivities.map(normalizeActivity).filter((item) => item.statusText || item.datetime);
  const latest = updates[0] || {};

  const currentStatusText = pick(
    order?.status_name,
    order?.status_text,
    root?.status_name,
    root?.status_text,
    latest.statusText
  );

  const currentDateText = pick(
    order?.delivery_date,
    order?.updated_at,
    order?.created_at,
    root?.delivery_date,
    latest.datetime,
    latest.date
  );

  const destination = pick(
    order?.collection_branch_name,
    order?.area_branch_name,
    order?.wilaya_name,
    order?.city
  );

  const result = {
    ok: true,
    version: VERSION,
    provider: pick(order?.provider_name, root?.provider_name) || PROVIDER,
    trackingNumber: pick(
      order?.tracking_no,
      order?.trackingNumber,
      order?.tracking_number,
      root?.tracking_no,
      root?.trackingNumber,
      fallbackTrackingNumber
    ),
    orderName: pick(
      order?.order_id,
      order?.order_no,
      order?.orderNumber,
      root?.order_id,
      root?.order_no
    ),
    url,
    status: normalizeStatus(
      pick(order?.status_code, order?.status, root?.status, currentStatusText)
    ),
    currentStatusText,
    currentDateText,
    originServiceArea: pick(order?.pickup_branch_name, order?.origin_service_area),
    destinationServiceArea: destination,
    orderPhoto: pick(order?.pickup_image, order?.image),
    orderPhotos: [],
    customerName: pick(order?.customer_name, order?.customerName),
    customerPhone: pick(
      order?.customer_mobile,
      order?.customerPhone,
      order?.driver?.mobile
    ),
    address: pick(order?.address),
    city: pick(order?.wilaya_name, order?.city),
    amountDue: toNumberOrNull(
      order?.cod_amount ?? order?.amount_due ?? order?.amount
    ),
    currency: pick(order?.currency) || "OMR",
    deliveryState: pick(order?.status_name, order?.delivery_state, currentStatusText),
    updates,
    rawSource: "shaheen-api"
  };

  if (!result.currentStatusText && !result.updates.length && !result.trackingNumber && !result.orderName) {
    return {
      ok: false,
      version: VERSION,
      provider: PROVIDER,
      trackingNumber: fallbackTrackingNumber,
      url,
      status: "UNKNOWN",
      currentStatusText: "",
      currentDateText: "",
      originServiceArea: "",
      destinationServiceArea: "",
      updates: [],
      error: "Tracking data not recognized from Shaheen API"
    };
  }

  return result;
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        encryptionkeycode: ENCRYPTION_KEY,
        pageName: "tracking"
      },
      signal: controller.signal
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const msg =
        clean(json?.message) ||
        clean(json?.error) ||
        `HTTP ${response.status}`;
      throw new Error(msg);
    }

    if (!json) {
      throw new Error("Empty JSON response");
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

export async function getDalileeTracking(trackingNumber, country = DEFAULT_COUNTRY) {
  const cleanTrackingNumber = sanitizeTrackingNumber(trackingNumber);
  const cleanCountry = sanitizeCountry(country);

  if (!cleanTrackingNumber) {
    throw new Error("trackingNumber is required");
  }

  const key = `${cleanCountry}:${cleanTrackingNumber}`;
  const fresh = getFreshCache(key);
  if (fresh) {
    return { ...fresh, cached: true, stale: false };
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    const url = new URL(SHAHEEN_BASE_URL);

    // هذا هو الافتراض الحالي
    url.searchParams.set("order_id", cleanTrackingNumber);

    try {
      const json = await fetchJson(url.toString(), {
        timeoutMs: REQUEST_TIMEOUT_MS
      });

      const data = normalizeShaheenResponse(json, cleanTrackingNumber, url.toString());

      if (data.ok) setCache(key, data);

      return { ...data, cached: false, stale: false };
    } catch (error) {
      const stale = getStaleCache(key);
      if (stale) {
        return {
          ...stale,
          cached: true,
          stale: true,
          warning: "Showing cached tracking data because upstream request failed"
        };
      }
      throw error;
    }
  })();

  inFlight.set(key, promise);

  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

router.get("/api/dalilee/track", async (req, res) => {
  try {
    const trackingNumber = sanitizeTrackingNumber(
      req.query.trackingNumber || req.query.num || req.query.code || ""
    );
    const country = sanitizeCountry(req.query.country || DEFAULT_COUNTRY);

    if (!trackingNumber) {
      return res.status(400).json({
        ok: false,
        error: "trackingNumber is required"
      });
    }

    const data = await getDalileeTracking(trackingNumber, country);
    return res.json(data);
  } catch (error) {
    const message = error?.message || String(error);
    const isTimeout = /abort|timeout/i.test(message);

    return res.status(isTimeout ? 504 : 500).json({
      ok: false,
      error: message
    });
  }
});

export default router;
