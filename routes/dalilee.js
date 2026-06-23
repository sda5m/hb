import express from "express";

const router = express.Router();

const CACHE_TTL = 20 * 1000;
const cache = new Map();
const inFlight = new Map();

const DALILEE_API_BASE = "https://shaheenom.com/api";
const DALILEE_ENCRYPTION_KEY = "JpdiI6IjRwZTRMVk40ZGt4NEtqZDFsT0x4UkE9PSIsInZ";
const DALILEE_PAGE_NAME = "tracking";

function clean(v = "") {
  return String(v)
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL,
  });
}

function normalizeStatus(text = "") {
  const s = clean(text).toLowerCase();

  if (
    s.includes("delivered") ||
    s.includes("تم التوصيل")
  ) {
    return "DELIVERED";
  }

  if (
    s.includes("out for delivery") ||
    s.includes("ofd") ||
    s.includes("خرج للتوصيل")
  ) {
    return "OUT_FOR_DELIVERY";
  }

  if (
    s.includes("in transit") ||
    s.includes("transit") ||
    s.includes("arrived") ||
    s.includes("picked up") ||
    s.includes("received")
  ) {
    return "IN_TRANSIT";
  }

  if (
    s.includes("back to warehouse") ||
    s.includes("no answer") ||
    s.includes("self pick") ||
    s.includes("self pickup") ||
    s.includes("exception")
  ) {
    return "EXCEPTION";
  }

  return "UNKNOWN";
}

function splitDateTime(value = "") {
  const text = clean(value);
  if (!text) {
    return {
      datetime: "",
      date: "",
      time: "",
    };
  }

  const parts = text.split(",");
  if (parts.length >= 2) {
    return {
      datetime: text,
      date: clean(parts[0]),
      time: clean(parts.slice(1).join(",")),
    };
  }

  return {
    datetime: text,
    date: text,
    time: "",
  };
}

function mapActivities(activities = []) {
  return (Array.isArray(activities) ? activities : []).map((item) => {
    const statusText = clean(item?.log || item?.status || item?.reason || "");
    const dt = splitDateTime(item?.created_at || "");

    return {
      datetime: dt.datetime,
      date: dt.date,
      time: dt.time,
      serviceArea: clean(item?.service_area || ""),
      statusText,
      status: normalizeStatus(statusText),
      reason: clean(item?.reason || ""),
    };
  });
}

function buildResponse(trackingNumber, json) {
  const order = json?.order || {};
  const updates = mapActivities(json?.activities || []);

  const currentStatusText =
    clean(order?.status_name || "") ||
    updates[updates.length - 1]?.statusText ||
    "";

  const currentDateText =
    clean(order?.delivery_date || "") ||
    updates[updates.length - 1]?.datetime ||
    "";

  const orderPhoto = clean(order?.pickup_image || "");

  const amountRaw = order?.price;
  const amountDue =
    typeof amountRaw === "number"
      ? amountRaw
      : Number.isFinite(Number(amountRaw))
      ? Number(amountRaw)
      : null;

  return {
    ok: true,
    provider: "Dalilee",
    trackingNumber: clean(order?.order_id || trackingNumber),
    orderName: clean(order?.name || ""),
    status: normalizeStatus(currentStatusText || order?.status || ""),
    currentStatusText,
    currentDateText,
    originServiceArea: clean(order?.collection_branch_name || ""),
    destinationServiceArea:
      clean(order?.area?.name || "") || clean(order?.wilaya_name || ""),
    orderPhoto,
    orderPhotos: orderPhoto ? [orderPhoto] : [],
    customerName: clean(order?.name || ""),
    customerPhone: clean(order?.phone || ""),
    address: clean(order?.address || ""),
    city: clean(order?.wilaya_name || ""),
    amountDue,
    currency: clean(order?.cod_currency || "OMR"),
    deliveryState: clean(order?.status_name || order?.status || ""),
    updates,
    rawSource: "customer-tracking/order-details",
  };
}

async function fetchOrderDetails(trackingNumber, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const url = `${DALILEE_API_BASE}/customer-tracking/order-details?order_id=${encodeURIComponent(
      trackingNumber
    )}`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        encryptionkeycode: DALILEE_ENCRYPTION_KEY,
        pageName: DALILEE_PAGE_NAME,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(`Bad response: ${res.status}`);
    }

    if (!json || json.status !== 1 || !json.order) {
      throw new Error(clean(json?.message || "Tracking not found"));
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function getTracking(trackingNumber) {
  const normalized = clean(trackingNumber);
  if (!normalized) {
    return {
      ok: false,
      error: "trackingNumber is required",
    };
  }

  const cacheKey = normalized;
  const cached = getCache(cacheKey);
  if (cached) {
    return {
      ...cached,
      cached: true,
    };
  }

  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const json = await fetchOrderDetails(normalized);
      const data = buildResponse(normalized, json);

      setCache(cacheKey, data);

      return {
        ...data,
        cached: false,
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err?.name === "AbortError"
            ? "Timeout while requesting Dalilee"
            : clean(err?.message || "Tracking request failed"),
      };
    }
  })();

  inFlight.set(cacheKey, promise);

  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

router.get("/api/dalilee/track", async (req, res) => {
  try {
    const trackingNumber = clean(req.query.trackingNumber || "");

    if (!trackingNumber) {
      return res.status(400).json({
        ok: false,
        error: "trackingNumber is required",
      });
    }

    const result = await getTracking(trackingNumber);
    return res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
    });
  }
});

export default router;
