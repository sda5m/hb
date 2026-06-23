import express from "express";
import fetch from "node-fetch";

export default function trackUnifiedRoutes({ shopifyGraphQL, port, getRedis }) {
  const router = express.Router();

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanCancelReasonLine(value) {
    let line = clean(value);
    if (!line) return "";
    line = line
      .replace(/^This order was cancell?ed\.?\s*Cancellation reason:\s*/i, "")
      .replace(/^Cancellation reason:\s*/i, "")
      .replace(/^Cancel reason:\s*/i, "")
      .replace(/^\u0633\u0628\u0628\s*(?:\u0627\u0644\u0625\u0644\u063a\u0627\u0621|\u0627\u0644\u0627\u0644\u063a\u0627\u0621)\s*:\s*/i, "")
      .replace(/^\u0645\u0644\u0627\u062d\u0638\u0629\s+\u0627\u0644\u0639\u0645\u064a\u0644\s*:\s*/i, "")
      .replace(/\s*\u062a\u0645\s+\u0625?\u0631\u062c\u0627\u0639\s+.*$/i, "")
      .trim();
    return line.toLowerCase() === "shopify" ? "" : line;
  }

  function extractCancelReason(value) {
    const lines = String(value || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => cleanCancelReasonLine(line))
      .filter(Boolean);
    return lines[0] || "";
  }

  function normalizeStatus(value) {
    return clean(value).toUpperCase().replace(/\s+/g, "_");
  }

  function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function getLocalPhone(phone) {
    let digits = normalizePhone(phone);

    if (digits.startsWith("00968")) {
      digits = digits.slice(5);
    } else if (digits.startsWith("968") && digits.length > 8) {
      digits = digits.slice(3);
    }

    return digits;
  }

  function getLast3Digits(phone) {
    const local = getLocalPhone(phone);
    if (local.length < 3) return "";
    return local.slice(-3);
  }

  function maskPhone(phone) {
    const local = getLocalPhone(phone);
    if (!local) return "";

    const visiblePrefix = local.slice(0, 3);
    const hiddenCount = Math.max(local.length - 3, 0);
    return `${visiblePrefix}${"*".repeat(hiddenCount)}`;
  }

  function hasAnyTag(tags, candidates) {
    const normalizedTags = (Array.isArray(tags) ? tags : []).map((tag) =>
      clean(tag).toLowerCase()
    );

    return candidates.some((candidate) =>
      normalizedTags.includes(clean(candidate).toLowerCase())
    );
  }

  function hasExactTag(tags, target) {
    const wanted = clean(target).toLowerCase();
    return (Array.isArray(tags) ? tags : []).some(
      (tag) => clean(tag).toLowerCase() === wanted
    );
  }

  function parseDateSafe(value) {
    const time = Date.parse(String(value || ""));
    return Number.isFinite(time) ? time : 0;
  }


  function shipmentPhotoKey(orderCode) {
    return `bt:driver:shipment-photo:${String(orderCode || "").replace("#", "").trim()}`;
  }

  async function getShipmentPhotoFromServer(orderName = "") {
    try {
      if (typeof getRedis !== "function") return "";

      const r = await getRedis();
      if (!r) return "";

      const orderCode = String(orderName || "").replace("#", "").trim();
      if (!orderCode) return "";

      const row = await r.hGetAll(shipmentPhotoKey(orderCode));
      return String(row?.url || "").trim();
    } catch {
      return "";
    }
  }
  
  function isLikelyTrackingNumber(input) {
    const value = clean(input);
    if (!value) return false;
    return /[A-Za-z]/.test(value);
  }

  function detectLang(req) {
    const qLang = clean(req.query.lang).toLowerCase();
    if (qLang === "en") return "en";
    if (qLang === "ar") return "ar";

    const originalUrl = clean(req.originalUrl).toLowerCase();
    if (originalUrl.startsWith("/en/")) return "en";

    const referer = clean(req.get("referer")).toLowerCase();
    try {
      if (referer) {
        const refererUrl = new URL(referer);
        if (refererUrl.pathname.toLowerCase().startsWith("/en/")) return "en";
        if (refererUrl.searchParams.get("lang") === "en") return "en";
      }
    } catch (_) {}

    const acceptLanguage = clean(req.get("accept-language")).toLowerCase();
    if (acceptLanguage.startsWith("en")) return "en";

    return "ar";
  }

  const I18N = {
    ar: {
      errors: {
        missingInput: "يرجى ادخال رقم الطلب او رقم التتبع",
        notFound: "لم يتم العثور على الطلب او الشحنه",
        noPhoneForVerification: "لا يمكن التحقق من الطلب لان رقم الجوال غير متوفر",
        wrongLast3: "اخر 3 ارقام من رقم الجوال غير صحيحه",
        noTrackingAvailable: "الطلب موجود لكن لا يحتوي على تتبع متاح حاليا",
        internal: "حدث خطا داخلي"
      },
      verify: {
        message: "لامان الطلب، ادخل اخر 3 ارقام من رقم الجوال المسجل"
      },
      statuses: {
        delivered: "تم التسليم",
        outForDelivery: "خرج للتوصيل",
        confirmed: "تم تاكيد الطلب",
        inTransit: "قيد النقل",
        prepared: "تم تجهيز الطلب",
        cancelled: "الطلب ملغي",
        trackingCreated: "تم انشاء رقم التتبع",
        officeDhl: "تم شحن طلبك عبر DHL",
        officeBranch: "تم شحن طلبك عبر مكتب جيناكم",
        waitingShipping: "الطلب في انتظار الشحن",
        waitingConfirmation: "الطلب في انتظار التاكيد",
        confirmedWaitingShipping: "الطلب مؤكد وفي انتظار الشحن"
      },
      deliveryStates: {
        delivered: "تم التسليم",
        outForDelivery: "خرج للتوصيل",
        confirmed: "تم التاكيد",
        inTransit: "في النقل",
        cancelled: "ملغي",
        dhl: "DHL",
        office: "Office",
        waitingShipping: "في انتظار الشحن",
        waitingConfirmation: "في انتظار التاكيد"
      },
      messages: {
        cancelledWithReason: (reason) => `تم الغاء هذا الطلب. سبب الالغاء: ${reason}`,
        cancelledPlain: "الطلب ملغي",
        officeDhl:
          "سيتم ارسال رقم التتبع من شركة DHL الى رقم الواتساب المسجل في الطلب.",
        officeBranch:
          "ستصلك رساله من مكتب جيناكم عند جاهزيه الشحنه، ويرجى التوجه الى اقرب فرع حسب المنطقه المسجله في الطلب.",
        waitingShipping: "الطلب في انتظار الشحن",
        waitingConfirmation: "الطلب في انتظار التاكيد",
        confirmedWaitingShipping: "الطلب مؤكد وفي انتظار الشحن"
      },
      providers: {
        shopify: "Hala Beauty",
        dalilee: "دليلي",
        carrier: "شركة الشحن",
        dhl: "DHL",
        aramex: "Aramex",
        office: "مكتب جيناكم",
        local: "هلا بيوتي"
      }
    },

    en: {
      errors: {
        missingInput: "Please enter the order number or tracking number.",
        notFound: "Order or shipment was not found.",
        noPhoneForVerification:
          "Order verification is not possible because the phone number is unavailable.",
        wrongLast3: "The last 3 digits of the phone number are incorrect.",
        noTrackingAvailable: "The order exists, but no tracking is currently available.",
        internal: "Internal server error"
      },
      verify: {
        message:
          "For order security, enter the last 3 digits of the registered phone number."
      },
      statuses: {
        delivered: "Delivered",
        outForDelivery: "Out for delivery",
        confirmed: "Order confirmed",
        inTransit: "In transit",
        prepared: "Order prepared",
        cancelled: "Order cancelled",
        trackingCreated: "Tracking number created",
        officeDhl: "Your order has been shipped via DHL",
        officeBranch: "Your order has been shipped via Genacom Office",
        waitingShipping: "Your order is waiting to be shipped.",
        waitingConfirmation: "Your order is waiting for confirmation.",
        confirmedWaitingShipping: "Your order is confirmed and waiting to be shipped."
      },
      deliveryStates: {
        delivered: "Delivered",
        outForDelivery: "Out for delivery",
        confirmed: "Confirmed",
        inTransit: "In transit",
        cancelled: "Cancelled",
        dhl: "DHL",
        office: "Office",
        waitingShipping: "Waiting for shipping",
        waitingConfirmation: "Waiting for confirmation"
      },
      messages: {
        cancelledWithReason: (reason) =>
          `This order was cancelled. Cancellation reason: ${reason}`,
        cancelledPlain: "The order is cancelled.",
        officeDhl:
          "The DHL tracking number will be sent to the WhatsApp number registered with the order.",
        officeBranch:
          "You will receive a message from Genacom Office once the shipment is ready. Please visit the nearest branch based on the selected delivery area.",
        waitingShipping: "Your order is waiting to be shipped.",
        waitingConfirmation: "Your order is waiting for confirmation.",
        confirmedWaitingShipping:
          "Your order is confirmed and waiting to be shipped."
      },
      providers: {
        shopify: "Hala Beauty",
        dalilee: "Dalilee",
        carrier: "Carrier",
        dhl: "DHL",
        aramex: "Aramex",
        office: "Genacom Office",
        local: "Hala Beauty"
      }
    }
  };

  function t(req) {
    return I18N[detectLang(req)] || I18N.ar;
  }

  const dalileeCache = new Map();

  async function getDalileeTracking(trackingNumber, lang = "ar") {
    const tn = clean(trackingNumber);
    if (!tn) return { ok: false };

    const cacheKey = `${lang}:${tn}`;

    if (dalileeCache.has(cacheKey)) {
      const row = dalileeCache.get(cacheKey);
      if (Date.now() < row.expire) {
        return row.data;
      } else {
        dalileeCache.delete(cacheKey);
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `http://127.0.0.1:${port}/api/dalilee/track?trackingNumber=${encodeURIComponent(
          tn
        )}&lang=${encodeURIComponent(lang)}`,
        {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal
        }
      );

      clearTimeout(timeout);

      const data = await response.json().catch(() => null);
      const result = response.ok && data?.ok ? data : { ok: false };

      dalileeCache.set(cacheKey, {
        data: result,
        expire: Date.now() + 30000
      });

      return result;
    } catch (err) {
      return { ok: false };
    }
  }

  function isUsefulDalileeResult(data) {
    if (!data?.ok) return false;

    const status = clean(data?.status).toUpperCase();
    const updates = Array.isArray(data?.updates) ? data.updates : [];

    if (updates.length > 0) return true;
    if (status && status !== "UNKNOWN") return true;
    if (clean(data?.currentStatusText)) return true;
    if (clean(data?.currentDateText)) return true;
    if (clean(data?.originServiceArea)) return true;
    if (clean(data?.destinationServiceArea)) return true;

    return false;
  }

  function parseDalileeUpdateTime(item) {
    const raw =
      item?.datetime ||
      item?.happenedAt ||
      item?.date ||
      item?.createdAt ||
      "";

    const ts = Date.parse(String(raw));
    return Number.isFinite(ts) ? ts : 0;
  }

  function getLatestDalileeUpdate(updates = []) {
    const rows = Array.isArray(updates) ? [...updates] : [];
    if (!rows.length) return null;

    rows.sort((a, b) => parseDalileeUpdateTime(b) - parseDalileeUpdateTime(a));
    return rows[0] || null;
  }

  function isDalileeReturnLikeStatus(value) {
    const s = clean(value).toUpperCase();

    return (
      s.includes("BACK_TO_WAREHOUSE") ||
      s.includes("BACK TO WAREHOUSE") ||
      s.includes("NO_ANSWER") ||
      s.includes("NO ANSWER") ||
      s.includes("RESCHEDULE") ||
      s.includes("RESCHEDULED") ||
      s.includes("SCHEDULE_FOR_FUTURE") ||
      s.includes("SCHEDULE FOR FUTURE") ||
      s.includes("FAILED_DELIVERY") ||
      s.includes("FAILED DELIVERY") ||
      s.includes("EXCEPTION") ||
      s.includes("CUSTOMER_NOT_AVAILABLE") ||
      s.includes("CUSTOMER NOT AVAILABLE")
    );
  }

function isStrictDelivered(update = {}) {
  if (!update || (!update.status && !update.statusText)) {
    return false;
  }

  return (
    clean(update.status) === "Delivered" ||
    clean(update.statusText) === "Delivered"
  );
}  
function normalizeDalileeStatus(value, updates = []) {
  const base = clean(value).toUpperCase();

  const latest = getLatestDalileeUpdate(updates) || null;
  const latestStatus = clean(latest?.status).toUpperCase();
  const latestStatusText = clean(latest?.statusText).toUpperCase();

  const values = [latestStatus, latestStatusText, base].filter(Boolean);

  const hasExact = (...needles) =>
    values.some((v) => needles.some((n) => v === String(n).toUpperCase()));

  const hasContains = (...needles) =>
    values.some((v) =>
      needles.some((n) => v.includes(String(n).toUpperCase()))
    );

  // 1) حالات الفشل / الإرجاع / التأجيل أولاً
  if (
    isDalileeReturnLikeStatus(latestStatus) ||
    isDalileeReturnLikeStatus(latestStatusText) ||
    isDalileeReturnLikeStatus(base) ||
    hasExact("FAILED_DELIVERY", "RETURNED") ||
    hasContains(
      "فشل التوصيل",
      "تعذر التوصيل",
      "تم الإرجاع",
      "راجع",
      "تأجيل",
      "تاجيل",
      "تغيير الموقع",
      "تغيير العنوان",
      "لا يرد"
    )
  ) {
    if (
      hasExact("RETURNED") ||
      hasContains("تم الإرجاع", "راجع")
    ) {
      return "RETURNED";
    }

    return "FAILED_DELIVERY";
  }

  // 2) Delivered فقط إذا آخر تحديث نفسه Delivered بشكل صارم
  if (latest && isStrictDelivered(latest)) {
    return "DELIVERED";
  }

  // ممنوع الاعتماد على base لوحده في Delivered
  // لا يوجد fallback هنا إطلاقًا

  // 3) Out for delivery
  if (
    hasExact(
      "OUT_FOR_DELIVERY",
      "OUT FOR DELIVERY",
      "OFD",
      "WITH_COURIER"
    ) ||
    hasContains("خرج للتوصيل", "قيد التوصيل", "مع المندوب")
  ) {
    return "OUT_FOR_DELIVERY";
  }

  // 4) Confirmed / info received
  if (
    hasExact("INFO_RECEIVED", "CONFIRMED") ||
    hasContains("تم تاكيد الطلب", "تم تأكيد الطلب")
  ) {
    return "INFO_RECEIVED";
  }

  // 5) In transit / shipped
  if (
    hasExact("IN_TRANSIT", "SHIPPED", "ON_ROUTE", "LABEL_PURCHASED") ||
    hasContains("قيد النقل", "في النقل")
  ) {
    return "IN_TRANSIT";
  }

  // 6) Cancelled
  if (
    hasExact("CANCELLED") ||
    hasContains("ملغي", "تم الالغاء", "تم الإلغاء")
  ) {
    return "CANCELLED";
  }

  return "UNKNOWN";
}

  
  function normalizeDalileeUpdate(item, fallbackCity = "") {
    const normalizedStatus = normalizeDalileeStatus(
      item?.status || item?.statusText || "",
      [item]
    );

    return {
      status: normalizedStatus,
      statusText: clean(item?.statusText || item?.status || ""),
      date: clean(item?.date || ""),
      time: clean(item?.time || ""),
      datetime: clean(item?.datetime || item?.happenedAt || ""),
      location: clean(item?.location || fallbackCity || ""),
      note: clean(item?.note || "")
    };
  }

  function getFulfillmentTimestamp(fulfillment) {
    const latestEvent = fulfillment?.events?.nodes?.[0];
    return parseDateSafe(latestEvent?.happenedAt || fulfillment?.createdAt || "");
  }

  function pickLatestFulfillment(fulfillments = []) {
    const list = Array.isArray(fulfillments) ? [...fulfillments] : [];
    if (!list.length) return null;

    list.sort((a, b) => getFulfillmentTimestamp(b) - getFulfillmentTimestamp(a));
    return list[0];
  }

  function pickFulfillmentWithTracking(fulfillments = []) {
    const list = Array.isArray(fulfillments) ? [...fulfillments] : [];

    const tracked = list.filter((fulfillment) => {
      const trackingInfo = Array.isArray(fulfillment?.trackingInfo)
        ? fulfillment.trackingInfo
        : [];

      return trackingInfo.some((item) => clean(item?.number));
    });

    if (!tracked.length) return null;

    tracked.sort((a, b) => getFulfillmentTimestamp(b) - getFulfillmentTimestamp(a));
    return tracked[0];
  }

function mapLocalState({
  lastEventStatus = "",
  hasFulfillment = false,
  dict,
  allowDeliveredFromShopify = true
}) {
  const s = clean(lastEventStatus).toUpperCase();

  if (allowDeliveredFromShopify && s === "DELIVERED") {
    return {
      status: "DELIVERED",
      currentStatusText: dict.statuses.delivered,
      deliveryState: dict.deliveryStates.delivered
    };
  }

  if (s === "OUT_FOR_DELIVERY") {
    return {
      status: "OUT_FOR_DELIVERY",
      currentStatusText: dict.statuses.outForDelivery,
      deliveryState: dict.deliveryStates.outForDelivery
    };
  }

  if (hasFulfillment) {
    return {
      status: "IN_TRANSIT",
      currentStatusText: dict.statuses.inTransit,
      deliveryState: dict.deliveryStates.inTransit
    };
  }

  return {
    status: "WAITING_SHIPPING",
    currentStatusText: dict.statuses.waitingShipping,
    deliveryState: dict.deliveryStates.waitingShipping
  };
}
  
function mapLocalUpdates(events = [], city = "", dict, fulfillmentCreatedAt = "") {
  const rows = [];

  if (clean(fulfillmentCreatedAt)) {
    rows.push({
      datetime: clean(fulfillmentCreatedAt),
      date: clean(fulfillmentCreatedAt),
      time: "",
      location: city,
      serviceArea: city,
      statusText: dict.statuses.inTransit,
      status: "IN_TRANSIT",
      note: "تم شحن الطلب",
      reason: ""
    });
  }

  for (const ev of Array.isArray(events) ? events : []) {
    const s = clean(ev?.status).toUpperCase();

    if (s === "OUT_FOR_DELIVERY") {
      rows.push({
        datetime: clean(ev?.happenedAt),
        date: clean(ev?.happenedAt),
        time: "",
        location: city,
        serviceArea: city,
        statusText: dict.statuses.outForDelivery,
        status: "OUT_FOR_DELIVERY",
        note: "",
        reason: ""
      });
    } else if (s === "DELIVERED") {
      rows.push({
        datetime: clean(ev?.happenedAt),
        date: clean(ev?.happenedAt),
        time: "",
        location: city,
        serviceArea: city,
        statusText: dict.statuses.delivered,
        status: "DELIVERED",
        note: "",
        reason: ""
      });
    }
  }

  rows.sort((a, b) => parseDateSafe(b.datetime) - parseDateSafe(a.datetime));
  return rows;
}
  
  router.get("/tracking", (req, res) => {
  const bt =
    req.query.bt ||
    req.query.q ||
    req.query.query ||
    req.query.trackingNumber ||
    req.query.code ||
    req.query.order ||
    req.query.num ||
    "";

  const suffix = bt ? `?bt=${encodeURIComponent(String(bt))}` : "";
  return res.redirect(`/track${suffix}`);
});
  
router.get("/en/tracking", (req, res) => {
  const bt =
    req.query.bt ||
    req.query.q ||
    req.query.query ||
    req.query.trackingNumber ||
    req.query.code ||
    req.query.order ||
    req.query.num ||
    "";

  const suffix = bt ? `?bt=${encodeURIComponent(String(bt))}` : "";
  return res.redirect(`/en/track${suffix}`);
});
  
  router.get("/api/track-unified", async (req, res) => {
    const lang = detectLang(req);
    const dict = t(req);

    function makeBaseData({
      provider = "",
      trackingNumber = "",
      orderName = "",
      status = "UNKNOWN",
      currentStatusText = "",
      currentDateText = "",
      originServiceArea = "",
      destinationServiceArea = "",
      orderPhoto = "",
      orderPhotos = [],
      customerName = "",
      customerPhone = "",
      address = "",
      city = "",
      amountDue = null,
      currency = "OMR",
      deliveryState = "",
      updates = [],
      url = "",
      rawSource = "",
      minimalView = false,
      smartMessage = ""
    }) {
      return {
        provider,
        trackingNumber,
        orderName,
        status,
        currentStatusText,
        currentDateText,
        originServiceArea,
        destinationServiceArea,
        orderPhoto,
        orderPhotos,
        customerName,
        customerPhone,
        address,
        city,
        amountDue,
        currency,
        deliveryState,
        updates,
        url,
        rawSource,
        minimalView,
        smartMessage
      };
    }

    function isAramexShipment({ trackingNumber = "", carrierCompany = "", carrierUrl = "" } = {}) {
      const hay = [trackingNumber, carrierCompany, carrierUrl].map(clean).join(" ").toLowerCase();
      return /aramex|shipmentnumber|أرامكس|ارامكس/.test(hay);
    }

    function carrierProviderName({ isAramex = false, fallback = "" } = {}) {
      return isAramex ? dict.providers.aramex : fallback;
    }

function waitingShippingResponse({
  source,
  type,
  provider,
  orderName,
  customerName,
  customerPhone,
  address,
  city,
  amountDue,
  currency,
  currentStatusText,
  smartMessage,
  orderPhoto = ""
}) {
  return res.json({
    ok: true,
    source,
    type,
    requiresVerification: false,
    lang,
    data: makeBaseData({
      provider,
      trackingNumber: "",
      orderName,
      status: "WAITING_SHIPPING",
      currentStatusText,
      currentDateText: "",
      originServiceArea: "",
      destinationServiceArea: city,
      orderPhoto: orderPhoto || "",
      orderPhotos: orderPhoto ? [orderPhoto] : [],
      customerName,
      customerPhone,
      address,
      city,
      amountDue,
      currency,
      deliveryState: dict.deliveryStates.waitingShipping,
      updates: [],
      url: "",
      rawSource: source,
      minimalView: true,
      smartMessage
    })
  });
}

    try {
const input = clean(
  req.query.bt ||
    req.query.query ||
    req.query.code ||
    req.query.order ||
    req.query.num ||
    req.query.trackingNumber ||
    req.query.q ||
    ""
);
      
      if (!input) {
        return res.status(400).json({
          ok: false,
          error: dict.errors.missingInput,
          lang
        });
      }

      const normalizedInput = input.replace(/^#/, "").trim();
      const phoneLast3 = String(req.query.phoneLast3 || "")
        .replace(/\D/g, "")
        .slice(-3);

      if (isLikelyTrackingNumber(normalizedInput)) {
        const directDalilee = await getDalileeTracking(normalizedInput, lang);

        if (isUsefulDalileeResult(directDalilee)) {
          const directUpdates = Array.isArray(directDalilee.updates)
            ? directDalilee.updates.map((item) =>
                normalizeDalileeUpdate(
                  item,
                  directDalilee.destinationServiceArea || directDalilee.city || ""
                )
              )
            : [];

          const normalizedStatus = normalizeDalileeStatus(
            directDalilee.status,
            directUpdates
          );

          return res.json({
            ok: true,
            source: "dalilee",
            type: "tracking",
            requiresVerification: false,
            lang,
            data: makeBaseData({
              provider: directDalilee.provider || dict.providers.dalilee,
              trackingNumber: directDalilee.trackingNumber || normalizedInput,
              orderName: directDalilee.orderName || "",
              status: normalizedStatus,
              currentStatusText:
                directDalilee.currentStatusText ||
                directUpdates?.[0]?.statusText ||
                "",
              currentDateText:
                directDalilee.currentDateText ||
                directUpdates?.[0]?.datetime ||
                directUpdates?.[0]?.date ||
                "",
              originServiceArea: directDalilee.originServiceArea || "",
              destinationServiceArea: directDalilee.destinationServiceArea || "",
              orderPhoto: directDalilee.orderPhoto || "",
              orderPhotos: Array.isArray(directDalilee.orderPhotos)
                ? directDalilee.orderPhotos
                : [],
              customerName: directDalilee.customerName || "",
              customerPhone: directDalilee.customerPhone || "",
              address: directDalilee.address || "",
              city: directDalilee.city || "",
              amountDue: directDalilee.amountDue ?? null,
              currency: directDalilee.currency || "OMR",
              deliveryState:
                directDalilee.deliveryState ||
                directDalilee.currentStatusText ||
                directUpdates?.[0]?.statusText ||
                "",
              updates: directUpdates,
              url: directDalilee.url || "",
              rawSource: "dalilee-direct"
            })
          });
        }
      }

      const cleanOrder = normalizedInput;
      const q = `(order_number:${cleanOrder} OR name:${cleanOrder} OR name:#${cleanOrder})`;

      const query = `
        query TrackOrder($q: String!) {
          orders(first: 1, query: $q, sortKey: PROCESSED_AT, reverse: true) {
            nodes {
              id
              name
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
                  carrierIdentifier
                  code
                }
              }
              fulfillments {
                id
                createdAt
                trackingInfo {
                  number
                  company
                  url
                }
                events(first: 20, sortKey: HAPPENED_AT, reverse: true) {
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

      const shopifyData = await shopifyGraphQL(query, { q });
      const order = shopifyData?.orders?.nodes?.[0];

      if (!order) {
        return res.status(404).json({
          ok: false,
          error: dict.errors.notFound,
          lang
        });
      }

      const shipping = order.shippingAddress || {};
      const customer = order.customer || {};
      const tags = Array.isArray(order.tags) ? order.tags : [];
      const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
      const shippingLines = Array.isArray(order?.shippingLines?.nodes)
        ? order.shippingLines.nodes
        : [];

      const customerName =
        clean(shipping.name) ||
        clean([shipping.firstName, shipping.lastName].filter(Boolean).join(" ")) ||
        clean([customer.firstName, customer.lastName].filter(Boolean).join(" ")) ||
        (lang === "en" ? "Not available" : "غير متوفر");

      const customerPhone = clean(shipping.phone) || clean(customer.phone) || "";
      const localPhone = getLocalPhone(customerPhone);

      const address =
        clean([shipping.address1, shipping.address2].filter(Boolean).join(" - ")) ||
        (lang === "en" ? "Not available" : "غير متوفر");

      const city =
        clean(shipping.city) || (lang === "en" ? "Not available" : "غير متوفر");

      const amountDue = Number(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
      const currency = clean(order?.totalOutstandingSet?.shopMoney?.currencyCode || "OMR");

      const latestFulfillment = pickLatestFulfillment(fulfillments);
      const trackedFulfillment = pickFulfillmentWithTracking(fulfillments);

      const firstTracking =
        (trackedFulfillment?.trackingInfo || []).find(
          (item) => clean(item?.number) || clean(item?.company) || clean(item?.url)
        ) || {};

      const trackingNumber = clean(firstTracking?.number);
      const carrierUrl = clean(firstTracking?.url);
      
      const localShipmentPhoto = await getShipmentPhotoFromServer(order?.name || `#${cleanOrder}`);

      
      const shippingLineText = shippingLines
        .map((line) =>
          [clean(line?.title), clean(line?.carrierIdentifier), clean(line?.code)]
            .filter(Boolean)
            .join(" ")
        )
        .join(" ");

      const carrierCompany = clean(firstTracking?.company) || shippingLineText;
      const isAramex = isAramexShipment({ trackingNumber, carrierCompany, carrierUrl });
      const publicCarrierProvider = carrierProviderName({
        isAramex,
        fallback: carrierCompany || dict.providers.carrier
      });
      const publicCarrierUrl = isAramex
        ? (carrierUrl || (trackingNumber
            ? `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(trackingNumber)}`
            : ""))
        : carrierUrl;

      const isCancelled = Boolean(order?.cancelledAt || order?.cancelReason);

      const financialStatus = clean(order?.displayFinancialStatus).toUpperCase();
      const fulfillmentStatus = clean(order?.displayFulfillmentStatus).toUpperCase();

      const isPaid =
        financialStatus === "PAID" ||
        financialStatus === "AUTHORIZED" ||
        financialStatus === "PARTIALLY_PAID";

      const hasOfficeTag =
        hasExactTag(tags, "مكتب") || hasExactTag(tags, "office");

      const hasMuscatTag = hasAnyTag(tags, ["مسقط", "muscat"]);

      const hasConfirmationTag = hasAnyTag(tags, ["تاكيد", "تأكيد", "confirmation"]);

      const isDHL =
        /dhl/i.test(carrierCompany) ||
        shippingLines.some((line) =>
          /dhl/i.test(
            [clean(line?.title), clean(line?.carrierIdentifier), clean(line?.code)].join(" ")
          )
        );

      const events = latestFulfillment?.events?.nodes || [];
      const lastEventStatus = clean(events?.[0]?.status).toUpperCase();
      const hasFulfillmentEvents = Array.isArray(events) && events.length > 0;

const isActuallyShippedInShopify =
  hasFulfillmentEvents || fulfillmentStatus === "FULFILLED";

      
      const inputLooksLikeTracking = isLikelyTrackingNumber(normalizedInput);
      const expectedLast3 = getLast3Digits(customerPhone);

      if (!inputLooksLikeTracking) {
        if (!customerPhone || !expectedLast3) {
          return res.status(400).json({
            ok: false,
            error: dict.errors.noPhoneForVerification,
            lang
          });
        }

        if (!phoneLast3) {
          return res.json({
            ok: true,
            requiresVerification: true,
            lang,
            verification: {
              message: dict.verify.message,
              maskedPhone: maskPhone(customerPhone)
            }
          });
        }

        if (phoneLast3 !== expectedLast3) {
          return res.status(403).json({
            ok: false,
            error: dict.errors.wrongLast3,
            lang
          });
        }
      }

if (isCancelled) {
  const reason = extractCancelReason(order.note) || cleanCancelReasonLine(order.cancelReason);

  return res.json({
    ok: true,
    source: "shopify-cancelled",
    type: "cancelled-order",
    requiresVerification: false,
    lang,
    data: makeBaseData({
      provider: dict.providers.shopify,
      trackingNumber: "",
      orderName: order.name || `#${cleanOrder}`,
      status: "CANCELLED",
      currentStatusText: dict.statuses.cancelled,
      currentDateText: clean(order.cancelledAt),
      originServiceArea: "",
      destinationServiceArea: city,
      orderPhoto: "",
      orderPhotos: [],
      customerName,
      customerPhone: localPhone || customerPhone,
      address,
      city,
      amountDue,
      currency,
      deliveryState: dict.deliveryStates.cancelled,
      updates: [],
      url: "",
      rawSource: "shopify-cancelled",
      smartMessage: reason
        ? dict.messages.cancelledWithReason(reason)
        : dict.messages.cancelledPlain
    })
  });
}

let shippingProfile = "PENDING_CONFIRMATION";

if (hasMuscatTag) {
  shippingProfile = "MUSCAT";
} else if (hasOfficeTag && isDHL) {
  shippingProfile = "OFFICE_DHL";
} else if (hasOfficeTag) {
  shippingProfile = "OFFICE_BRANCH";
} else if (hasConfirmationTag && !hasMuscatTag && !hasOfficeTag) {
  shippingProfile = "DALILEE";
} else {
  shippingProfile = "PENDING_CONFIRMATION";
}


if (shippingProfile === "OFFICE_BRANCH" && isActuallyShippedInShopify) {
const officeLocationLine = (() => {
  const c = clean(city);
  const a = clean(address);

  if (!c && !a) return "";
  if (a && c && a.includes(c)) return a; 
  if (c && !a) return c;
  if (!c && a) return a;

  return `${c} - ${a}`;
})();

  
const officeMessage =
  `بيانات الاستلام:\n` +
  `الاسم: ${customerName}\n` +
  `رقم الهاتف: ${localPhone || customerPhone}\n` +
  `المنطقة: ${officeLocationLine}\n\n` +
  `سيتم إرسال رسالة عند وصول الشحنة إلى أقرب فرع تحتوي على تفاصيل الاستلام.`;

  
const officeMessageEn =
  `Pickup details:\n` +
  `Name: ${customerName}\n` +
  `Phone: ${localPhone || customerPhone}\n` +
  `Location: ${officeLocationLine}\n\n` +
  `You will receive a message once the shipment arrives at the nearest branch with pickup details.`;

  
  return res.json({
    ok: true,
    source: "office-branch",
    type: "office-order-branch",
    requiresVerification: false,
    lang,
    data: makeBaseData({
      provider: dict.providers.office,
      trackingNumber: "",
      orderName: order.name || `#${cleanOrder}`,
      status: "OFFICE_BRANCH",
      currentStatusText: dict.statuses.officeBranch,
      currentDateText: clean(
        trackedFulfillment?.createdAt ||
        latestFulfillment?.createdAt ||
        ""
      ),
      originServiceArea: "",
      destinationServiceArea: city,
    orderPhoto: localShipmentPhoto || "",
    orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
      customerName,
      customerPhone: localPhone || customerPhone,
      address,
      city,
      amountDue,
      currency,
      deliveryState: dict.deliveryStates.office,
      updates: [],
      url: "",
      rawSource: "office-branch",
      minimalView: true,
      smartMessage: lang === "en" ? officeMessageEn : officeMessage
    })
  });
}

if (shippingProfile === "OFFICE_DHL" && isActuallyShippedInShopify) {
  const fulfillmentCreatedAt =
    trackedFulfillment?.createdAt ||
    latestFulfillment?.createdAt ||
    "";

  const shopifyUpdates = mapLocalUpdates(
    events,
    city,
    dict,
    fulfillmentCreatedAt
  );

  const shopifyState = mapLocalState({
    lastEventStatus,
    hasFulfillment: isActuallyShippedInShopify,
    dict,
    allowDeliveredFromShopify: true
  });

  const dhlLocationLine = (() => {
    const co = clean(shipping.countryCodeV2 || "");
    const c = clean(city);
    const a = clean(address);

    if (!co && !c && !a) return "";

    let parts = [co, c, a].filter(Boolean);

    if (a) {
      parts = parts.filter((p, i) => {
        if (i === 2) return true;
        return !a.includes(p);
      });
    }

    return parts.join(" - ");
  })();

  const dhlTrackingUrl = isAramex && carrierUrl
    ? carrierUrl
    : isAramex && trackingNumber
    ? `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(trackingNumber)}`
    : trackingNumber
    ? `https://www.dhl.com/tracking?tracking-ID=${encodeURIComponent(trackingNumber)}&tracking-id=${encodeURIComponent(trackingNumber)}`
    : clean(carrierUrl);

  const dhlMessage =
    dhlTrackingUrl
      ? `الوجهة: ${dhlLocationLine}\n\nيمكنك تتبع الشحنة من الرابط المرفق.`
      : `الوجهة: ${dhlLocationLine}\n\nسيتم إرسال رسالة تحتوي على رابط تتبع الشحنة أو تفاصيل الاستلام.`;

  const dhlMessageEn =
    dhlTrackingUrl
      ? `Destination: ${dhlLocationLine}\n\nYou can track your shipment using the attached link.`
      : `Destination: ${dhlLocationLine}\n\nYou will receive a message with tracking details or pickup instructions.`;

  return res.json({
    ok: true,
    source: "office-dhl",
    type: "office-order-dhl",
    requiresVerification: false,
    lang,

    popup: {
      open: true,
      type: "dhl-tracking"
    },

    trackingDialog: {
      open: true,
      provider: isAramex ? "Aramex" : "DHL",
      trackingNumber: trackingNumber || "",
      trackingUrl: dhlTrackingUrl || ""
    },

    data: makeBaseData({
      provider: isAramex ? dict.providers.aramex : dict.providers.dhl,
      trackingNumber: trackingNumber || "",
      orderName: order.name || `#${cleanOrder}`,
      status: shopifyState.status,
      currentStatusText:
        shopifyState.currentStatusText ||
        (isAramex ? "تم شحن طلبك عبر Aramex" : dict.statuses.officeDhl),
      currentDateText: clean(
        events?.[0]?.happenedAt ||
        trackedFulfillment?.createdAt ||
        latestFulfillment?.createdAt ||
        ""
      ),
      originServiceArea: "",
      destinationServiceArea: city,
    orderPhoto: localShipmentPhoto || "",
    orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
      customerName,
      customerPhone: localPhone || customerPhone,
      address,
      city,
      amountDue,
      currency,
      deliveryState: shopifyState.deliveryState || (isAramex ? "Aramex" : dict.deliveryStates.dhl),
      updates: shopifyUpdates,
      url: dhlTrackingUrl,
      rawSource: isAramex ? "office-aramex" : "office-dhl",
      minimalView: false,
      smartMessage: lang === "en" ? dhlMessageEn : dhlMessage
    })
  });
}
      
      
      
      
      
      if (trackingNumber) {
        if (shippingProfile === "DALILEE" && /^A/i.test(trackingNumber)) {
          const dalileeByTracking = await getDalileeTracking(trackingNumber, lang);

          if (isUsefulDalileeResult(dalileeByTracking)) {
            const dalileeUpdates = Array.isArray(dalileeByTracking.updates)
              ? dalileeByTracking.updates.map((item) =>
                  normalizeDalileeUpdate(
                    item,
                    dalileeByTracking.destinationServiceArea ||
                      dalileeByTracking.city ||
                      city
                  )
                )
              : [];

            const normalizedStatus = normalizeDalileeStatus(
              dalileeByTracking.status,
              dalileeUpdates
            );

            return res.json({
              ok: true,
              source: "dalilee",
              type: "order-with-dalilee-tracking",
              requiresVerification: false,
              lang,
              data: makeBaseData({
                provider: dalileeByTracking.provider || dict.providers.dalilee,
                trackingNumber,
                orderName: dalileeByTracking.orderName || order.name || `#${cleanOrder}`,
                status: normalizedStatus,
                currentStatusText:
                  dalileeByTracking.currentStatusText ||
                  dalileeUpdates?.[0]?.statusText ||
                  "",
                currentDateText:
                  dalileeByTracking.currentDateText ||
                  dalileeUpdates?.[0]?.datetime ||
                  dalileeUpdates?.[0]?.date ||
                  "",
                originServiceArea: dalileeByTracking.originServiceArea || "",
                destinationServiceArea: dalileeByTracking.destinationServiceArea || city,
                orderPhoto: dalileeByTracking.orderPhoto || localShipmentPhoto || "",
                orderPhotos: Array.isArray(dalileeByTracking.orderPhotos) && dalileeByTracking.orderPhotos.length
                  ? dalileeByTracking.orderPhotos
                  : (dalileeByTracking.orderPhoto || localShipmentPhoto ? [dalileeByTracking.orderPhoto || localShipmentPhoto] : []),
                customerName: dalileeByTracking.customerName || customerName,
                customerPhone:
                  dalileeByTracking.customerPhone || (localPhone || customerPhone),
                address: dalileeByTracking.address || address,
                city: dalileeByTracking.city || city,
                amountDue: dalileeByTracking.amountDue ?? amountDue,
                currency: dalileeByTracking.currency || currency,
                deliveryState:
                  dalileeByTracking.deliveryState ||
                  dalileeByTracking.currentStatusText ||
                  dalileeUpdates?.[0]?.statusText ||
                  "",
                updates: dalileeUpdates,
                url: dalileeByTracking.url || carrierUrl,
                rawSource: "dalilee-from-order"
              })
            });
          }

const fulfillmentCreatedAt =
  trackedFulfillment?.createdAt ||
  latestFulfillment?.createdAt ||
  "";

const shopifyUpdates = mapLocalUpdates(
  events,
  city,
  dict,
  fulfillmentCreatedAt
);

const shopifyState = mapLocalState({
  lastEventStatus,
  hasFulfillment: isActuallyShippedInShopify,
  dict,
  allowDeliveredFromShopify: false
});
          
          
          return res.json({
            ok: true,
            source: "dalilee-shopify-fallback",
            type: "order-with-dalilee-tracking-fallback",
            requiresVerification: false,
            lang,
            data: makeBaseData({
              provider: dict.providers.dalilee,
              trackingNumber,
              orderName: order.name || `#${cleanOrder}`,
              status: shopifyState.status,
              currentStatusText:
                shopifyState.currentStatusText || dict.statuses.trackingCreated,
              currentDateText: clean(
                events?.[0]?.happenedAt ||
                  trackedFulfillment?.createdAt ||
                  latestFulfillment?.createdAt
              ),
              originServiceArea: "",
              destinationServiceArea: city,
              orderPhoto: localShipmentPhoto || "",
              orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
              customerName,
              customerPhone: localPhone || customerPhone,
              address,
              city,
              amountDue,
              currency,
              deliveryState: shopifyState.deliveryState,
              updates: shopifyUpdates,
              url: carrierUrl,
              rawSource: "dalilee-shopify-fallback"
            })
          });
        }

const fulfillmentCreatedAt =
  trackedFulfillment?.createdAt ||
  latestFulfillment?.createdAt ||
  "";

const shopifyUpdates = mapLocalUpdates(
  events,
  city,
  dict,
  fulfillmentCreatedAt
);

const shopifyState = mapLocalState({
  lastEventStatus,
  hasFulfillment: isActuallyShippedInShopify,
  dict,
  allowDeliveredFromShopify: true
});

        
        return res.json({
          ok: true,
          source: "shopify-tracked-order",
          type: "tracked-order",
          requiresVerification: false,
          lang,
          data: makeBaseData({
provider:
  shippingProfile === "MUSCAT"
    ? dict.providers.local
    : shippingProfile === "OFFICE_DHL"
    ? (isAramex ? dict.providers.aramex : dict.providers.dhl)
    : shippingProfile === "OFFICE_BRANCH"
    ? dict.providers.office
    : shippingProfile === "DALILEE"
    ? dict.providers.dalilee
    : publicCarrierProvider,
            trackingNumber,
            orderName: order.name || `#${cleanOrder}`,
            status: shopifyState.status,
            currentStatusText:
              shopifyState.currentStatusText || dict.statuses.trackingCreated,
            currentDateText: clean(
              events?.[0]?.happenedAt ||
                trackedFulfillment?.createdAt ||
                latestFulfillment?.createdAt
            ),
            originServiceArea: "",
            destinationServiceArea: city,
            orderPhoto: localShipmentPhoto || "",
            orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
            customerName,
            customerPhone: localPhone || customerPhone,
            address,
            city,
            amountDue,
            currency,
            deliveryState: shopifyState.deliveryState,
            updates: shopifyUpdates,
            url: publicCarrierUrl,
            rawSource: "shopify-tracked-order"
          })
        });
      }

      if (isActuallyShippedInShopify) {
const fulfillmentCreatedAt =
  trackedFulfillment?.createdAt ||
  latestFulfillment?.createdAt ||
  "";

const shopifyUpdates = mapLocalUpdates(
  events,
  city,
  dict,
  fulfillmentCreatedAt
);

const shopifyState = mapLocalState({
  lastEventStatus,
  hasFulfillment: isActuallyShippedInShopify,
  dict,
  allowDeliveredFromShopify: true
});
        
        
        return res.json({
          ok: true,
          source: "shopify-fulfilled-no-tracking",
          type: "fulfilled-order-no-tracking",
          requiresVerification: false,
          lang,
          data: makeBaseData({
provider:
  shippingProfile === "MUSCAT"
    ? dict.providers.local
    : shippingProfile === "OFFICE_DHL"
    ? (isAramex ? dict.providers.aramex : dict.providers.dhl)
    : shippingProfile === "OFFICE_BRANCH"
    ? dict.providers.office
    : shippingProfile === "DALILEE"
    ? dict.providers.dalilee
    : dict.providers.local,
            
            trackingNumber: "",
            orderName: order.name || `#${cleanOrder}`,
            status: shopifyState.status,
            currentStatusText: shopifyState.currentStatusText,
            currentDateText: clean(
              events?.[0]?.happenedAt || latestFulfillment?.createdAt || ""
            ),
            originServiceArea: "",
            destinationServiceArea: city,
            orderPhoto: localShipmentPhoto || "",
            orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
            customerName,
            customerPhone: localPhone || customerPhone,
            address,
            city,
            amountDue,
            currency,
            deliveryState: shopifyState.deliveryState,
            updates: shopifyUpdates,
            url: "",
            rawSource: "shopify-fulfilled-no-tracking"
          })
        });
      }

      if (shippingProfile === "MUSCAT") {
        return waitingShippingResponse({
          source: "muscat-waiting-shipping",
          type: "order-muscat-waiting-shipping",
          provider: dict.providers.local,
          orderName: order.name || `#${cleanOrder}`,
          customerName,
          customerPhone: localPhone || customerPhone,
          address,
          city,
          amountDue,
          currency,
          currentStatusText: dict.statuses.confirmedWaitingShipping,
          smartMessage: dict.messages.confirmedWaitingShipping,
          orderPhoto: localShipmentPhoto
        });
      }
      if (shippingProfile === "DALILEE") {
        return waitingShippingResponse({
          source: "dalilee-waiting-shipping",
          type: "order-dalilee-waiting-shipping",
          provider: dict.providers.dalilee,
          orderName: order.name || `#${cleanOrder}`,
          customerName,
          customerPhone: localPhone || customerPhone,
          address,
          city,
          amountDue,
          currency,
          currentStatusText: dict.statuses.waitingShipping,
          smartMessage: dict.messages.waitingShipping,
          orderPhoto: localShipmentPhoto
        });
      }

      if (shippingProfile === "OFFICE_DHL") {
        return waitingShippingResponse({
          source: "office-dhl-waiting-shipping",
          type: "office-order-dhl-waiting-shipping",
          provider: dict.providers.dhl,
          orderName: order.name || `#${cleanOrder}`,
          customerName,
          customerPhone: localPhone || customerPhone,
          address,
          city,
          amountDue,
          currency,
          currentStatusText: dict.statuses.waitingShipping,
          smartMessage: dict.messages.waitingShipping
        });
      }

      if (shippingProfile === "OFFICE_BRANCH") {
        return waitingShippingResponse({
          source: "office-branch-waiting-shipping",
          type: "office-order-branch-waiting-shipping",
          provider: dict.providers.office,
          orderName: order.name || `#${cleanOrder}`,
          customerName,
          customerPhone: localPhone || customerPhone,
          address,
          city,
          amountDue,
          currency,
          currentStatusText: dict.statuses.waitingShipping,
          smartMessage: dict.messages.waitingShipping
        });
      }

      return res.json({
        ok: true,
        source: "waiting-confirmation",
        type: "order-waiting-confirmation",
        requiresVerification: false,
        lang,
        data: makeBaseData({
          provider: dict.providers.shopify,
          trackingNumber: "",
          orderName: order.name || `#${cleanOrder}`,
          status: "WAITING_CONFIRMATION",
          currentStatusText: dict.statuses.waitingConfirmation,
          currentDateText: "",
          originServiceArea: "",
          destinationServiceArea: city,
          orderPhoto: "",
          orderPhotos: [],
          customerName,
          customerPhone: localPhone || customerPhone,
          address,
          city,
          amountDue,
          currency,
          deliveryState: dict.deliveryStates.waitingConfirmation,
          updates: [],
          url: "",
          rawSource: "waiting-confirmation",
          minimalView: true,
          smartMessage: dict.messages.waitingConfirmation
        })
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error?.message || dict.errors.internal,
        lang
      });
    }
  });

  function safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

function mapDalileeToShopifyEventStatus(status) {
  const s = normalizeStatus(status);

  if (s === "DELIVERED") return "DELIVERED";
  if (s === "OUT_FOR_DELIVERY") return "OUT_FOR_DELIVERY";
  if (s === "INFO_RECEIVED") return "CONFIRMED";
  if (s === "CONFIRMED") return "CONFIRMED";
  if (s === "LABEL_PURCHASED") return "LABEL_PURCHASED";
  if (s === "FAILED_DELIVERY") return "IN_TRANSIT";
  if (s === "RETURNED") return "IN_TRANSIT";
  if (s === "CANCELLED") return "IN_TRANSIT";

  return "IN_TRANSIT";
}
function mapDalileeStatusText(status, lang = "ar") {
  const s = clean(status).toUpperCase();

  const ar = {
    DELIVERED: "تم التسليم",
    OUT_FOR_DELIVERY: "خرج للتوصيل",
    INFO_RECEIVED: "تم تاكيد الطلب",
    IN_TRANSIT: "قيد النقل",
    LABEL_PURCHASED: "تم تجهيز الطلب",
    CANCELLED: "الطلب ملغي",
    FAILED_DELIVERY: "تعذر التوصيل",
    RETURNED: "تم الإرجاع"
  };

  const en = {
    DELIVERED: "Delivered",
    OUT_FOR_DELIVERY: "Out for delivery",
    INFO_RECEIVED: "Order confirmed",
    IN_TRANSIT: "In transit",
    LABEL_PURCHASED: "Order prepared",
    CANCELLED: "Order cancelled",
    FAILED_DELIVERY: "Delivery failed",
    RETURNED: "Returned"
  };

  const dict = lang === "en" ? en : ar;
  return dict[s] || (lang === "en" ? "In transit" : "قيد النقل");
}
  
  function extractDalileeWebhookPayload(req) {
    const body = req.body || {};
    const data = body.data || {};

    const latestUpdate = getLatestDalileeUpdate(data.updates || []);

    const trackingNumber = clean(
      body.trackingNumber ||
        body.tracking_number ||
        body.awb ||
        body.waybill ||
        body.code ||
        data.trackingNumber ||
        data.tracking_number ||
        data.awb ||
        data.waybill ||
        ""
    );

    const rawStatus = clean(
      latestUpdate?.status ||
        latestUpdate?.statusText ||
        body.status ||
        body.currentStatus ||
        body.current_status ||
        body.shipmentStatus ||
        body.shipment_status ||
        data.status ||
        data.deliveryState ||
        ""
    );

    const rawHappenedAt = clean(
      body.happenedAt ||
        body.happened_at ||
        body.timestamp ||
        body.createdAt ||
        body.updatedAt ||
        data.happenedAt ||
        data.createdAt ||
        data.updatedAt ||
        latestUpdate?.datetime ||
        ""
    );

    const parsedDate = rawHappenedAt ? new Date(rawHappenedAt) : null;
    const happenedAt =
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();

    const orderName = clean(
      body.orderName ||
        body.order_name ||
        data.orderName ||
        data.customerName ||
        ""
    );

    const note = clean(
      body.note ||
        body.message ||
        body.description ||
        data.currentStatusText ||
        latestUpdate?.statusText ||
        ""
    );

    const city = clean(
      body.city ||
        body.destinationCity ||
        body.destination_city ||
        data.city ||
        data.destinationServiceArea ||
        ""
    );

    const lang =
      clean(body.lang || data.lang || "ar").toLowerCase() === "en" ? "en" : "ar";

    return {
      trackingNumber,
      rawStatus,
      happenedAt,
      orderName,
      note,
      city,
      lang,
      rawBody: body
    };
  }

  function getMetafieldMap(order) {
    const nodes = Array.isArray(order?.metafields?.nodes) ? order.metafields.nodes : [];
    const map = {};

    for (const mf of nodes) {
      const key = `${clean(mf?.namespace)}.${clean(mf?.key)}`;
      map[key] = mf?.value ?? "";
    }

    return map;
  }

  async function findOrderByTrackingNumber(trackingNumber) {
    const normalized = String(clean(trackingNumber)).trim().toUpperCase();
    if (!normalized) return null;

    const q = `fulfillment_status:fulfilled status:any`;

    const query = `
      query FindOrderByTracking($q: String!, $after: String) {
        orders(first: 50, after: $after, query: $q, sortKey: PROCESSED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            tags
            displayFulfillmentStatus
            fulfillments {
              id
              createdAt
              trackingInfo {
                number
                company
                url
              }
              events(first: 10, sortKey: HAPPENED_AT, reverse: true) {
                nodes {
                  status
                  happenedAt
                }
              }
            }
            metafields(first: 20, namespace: "custom") {
              nodes {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    `;

    let after = null;
    let pageCount = 0;
    const maxPages = 20;

    while (pageCount < maxPages) {
      const data = await shopifyGraphQL(query, { q, after });
      const orders = Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [];

      for (const order of orders) {
        const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];

        for (const fulfillment of fulfillments) {
          const trackingInfo = Array.isArray(fulfillment?.trackingInfo)
            ? fulfillment.trackingInfo
            : [];

          const matched = trackingInfo.some(
            (t) => String(t?.number || "").trim().toUpperCase() === normalized
          );

          if (matched) {
            return { order, fulfillment };
          }
        }

        const meta = getMetafieldMap(order);
        if (
          String(meta["custom.shipping_tracking_number"] || "")
            .trim()
            .toUpperCase() === normalized
        ) {
          const fulfillment = fulfillments[0] || null;
          if (fulfillment) {
            return { order, fulfillment };
          }
        }
      }

      const hasNextPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
      const endCursor = data?.orders?.pageInfo?.endCursor || null;

      if (!hasNextPage || !endCursor) break;

      after = endCursor;
      pageCount += 1;
    }

    return null;
  }

function isDuplicateWebhookUpdate({ order, fulfillment, normalizedStatus, happenedAt }) {
  const meta = getMetafieldMap(order);

  const lastStatus = normalizeStatus(meta["custom.shipping_status"]);
  const lastAt = clean(meta["custom.shipping_status_at"]);
  const historyRaw = clean(meta["custom.shipping_status_history"]);

  const existingEvents = Array.isArray(fulfillment?.events?.nodes)
    ? fulfillment.events.nodes
    : [];

  const hasSameFulfillmentEvent = existingEvents.some((ev) => {
    return (
      normalizeStatus(ev?.status) === normalizeStatus(normalizedStatus) &&
      clean(ev?.happenedAt) === clean(happenedAt)
    );
  });

  if (lastStatus === normalizedStatus && lastAt === happenedAt && hasSameFulfillmentEvent) {
    return true;
  }

  const history = safeJsonParse(historyRaw, []);
  if (Array.isArray(history) && hasSameFulfillmentEvent) {
    const found = history.some(
      (row) =>
        normalizeStatus(row?.status) === normalizedStatus &&
        clean(row?.happenedAt) === happenedAt
    );

    if (found) return true;
  }

  return false;
}
  async function createFulfillmentEvent(fulfillmentId, eventStatus, happenedAt) {
    const mutation = `
      mutation CreateFulfillmentEvent($fulfillmentEvent: FulfillmentEventInput!) {
        fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
          fulfillmentEvent {
            id
            status
            happenedAt
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await shopifyGraphQL(mutation, {
      fulfillmentEvent: {
        fulfillmentId,
        status: eventStatus,
        happenedAt
      }
    });

    const payload = result?.fulfillmentEventCreate;
    const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];

    if (userErrors.length) {
      throw new Error(
        `Shopify fulfillmentEventCreate failed: ${userErrors
          .map((e) => clean(e?.message))
          .filter(Boolean)
          .join(" | ")}`
      );
    }

    return payload?.fulfillmentEvent || null;
  }

  async function setOrderShippingMetafields({
    orderId,
    normalizedStatus,
    statusText,
    happenedAt,
    trackingNumber,
    sourcePayload
  }) {
    const getOrderMetafieldsQuery = `
      query GetOrderMetafields($id: ID!) {
        order(id: $id) {
          id
          metafields(first: 20, namespace: "custom") {
            nodes {
              id
              namespace
              key
              value
              type
            }
          }
        }
      }
    `;

    const orderData = await shopifyGraphQL(getOrderMetafieldsQuery, { id: orderId });
    const order = orderData?.order;
    const meta = getMetafieldMap(order);

    const previousHistory = safeJsonParse(meta["custom.shipping_status_history"], []);
    const history = Array.isArray(previousHistory) ? previousHistory : [];

    const alreadyInHistory = history.some(
      (row) =>
        normalizeStatus(row?.status) === normalizedStatus &&
        clean(row?.happenedAt) === clean(happenedAt)
    );

    if (!alreadyInHistory) {
      history.unshift({
        status: normalizedStatus,
        statusText,
        happenedAt: clean(happenedAt),
        trackingNumber: clean(trackingNumber)
      });
    }

    const trimmedHistory = history.slice(0, 20);

    const mutation = `
      mutation SetOrderMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            value
            type
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      metafields: [
        {
          ownerId: orderId,
          namespace: "custom",
          key: "shipping_status",
          type: "single_line_text_field",
          value: normalizedStatus
        },
        {
          ownerId: orderId,
          namespace: "custom",
          key: "shipping_status_text",
          type: "single_line_text_field",
          value: statusText
        },
        {
          ownerId: orderId,
          namespace: "custom",
          key: "shipping_status_at",
          type: "date_time",
          value: clean(happenedAt)
        },
        {
          ownerId: orderId,
          namespace: "custom",
          key: "shipping_tracking_number",
          type: "single_line_text_field",
          value: clean(trackingNumber)
        },
        {
          ownerId: orderId,
          namespace: "custom",
          key: "shipping_status_history",
          type: "json",
          value: JSON.stringify(trimmedHistory)
        },
        {
          ownerId: orderId,
          namespace: "custom",
          key: "shipping_status_payload",
          type: "json",
          value: JSON.stringify(sourcePayload || {})
        }
      ]
    };

    const result = await shopifyGraphQL(mutation, variables);
    const payload = result?.metafieldsSet;
    const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];

    if (userErrors.length) {
      throw new Error(
        `Shopify metafieldsSet failed: ${userErrors
          .map((e) => clean(e?.message))
          .filter(Boolean)
          .join(" | ")}`
      );
    }

    return Array.isArray(payload?.metafields) ? payload.metafields : [];
  }

  function verifyDalileeWebhookSecret(req) {
    const expected = clean(process.env.DALILEE_WEBHOOK_SECRET);
    if (!expected) return true;

    const given = clean(
      req.get("x-dalilee-secret") ||
        req.get("x-api-key") ||
        req.query.secret ||
        req.body?.secret ||
        ""
    );

    return Boolean(given) && given === expected;
  }

router.post("/api/dalilee/status-webhook", async (req, res) => {
  try {
    if (!verifyDalileeWebhookSecret(req)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized webhook"
      });
    }

    const {
      trackingNumber,
      rawStatus,
      happenedAt,
      orderName,
      note,
      city,
      lang,
      rawBody
    } = extractDalileeWebhookPayload(req);

    if (!trackingNumber) {
      return res.status(400).json({
        ok: false,
        error: "Missing trackingNumber"
      });
    }

    if (!rawStatus) {
      return res.status(400).json({
        ok: false,
        error: "Missing status"
      });
    }

    const webhookUpdates = Array.isArray(req.body?.data?.updates)
      ? req.body.data.updates
      : [];

    const normalizedStatus = normalizeDalileeStatus(rawStatus, webhookUpdates);
    const latestUpdate = getLatestDalileeUpdate(webhookUpdates);

    // حارس صارم: أي Delivered لا يمر إلا إذا آخر تحديث نفسه Delivered
    if (normalizedStatus === "DELIVERED") {
      if (!latestUpdate || !isStrictDelivered(latestUpdate)) {
        return res.json({
          ok: true,
          skipped: true,
          trackingNumber,
          reason: "blocked_false_delivered_strict",
          rawStatus,
          latestUpdate
        });
      }
    }

    const statusText = mapDalileeStatusText(normalizedStatus, lang);

    const found = await findOrderByTrackingNumber(trackingNumber);

    if (!found?.order || !found?.fulfillment) {
      return res.status(404).json({
        ok: false,
        error: "Order or fulfillment not found for tracking number",
        trackingNumber
      });
    }

    const { order, fulfillment } = found;

    if (
      isDuplicateWebhookUpdate({
  order,
  fulfillment,
  normalizedStatus,
  happenedAt
})
    ) {
      return res.json({
        ok: true,
        duplicate: true,
        skipped: true,
        trackingNumber,
        orderId: order.id,
        orderName: order.name || orderName || "",
        fulfillmentId: fulfillment.id,
        status: normalizedStatus
      });
    }

let fulfillmentEvent = null;
let eventStatus = null;

eventStatus = mapDalileeToShopifyEventStatus(normalizedStatus);

fulfillmentEvent = await createFulfillmentEvent(
  fulfillment.id,
  eventStatus,
  happenedAt
);
  

    await setOrderShippingMetafields({
      orderId: order.id,
      normalizedStatus,
      statusText,
      happenedAt,
      trackingNumber,
      sourcePayload: {
        ...rawBody,
        normalizedStatus,
        eventStatus,
        statusText,
        note,
        city
      }
    });

    return res.json({
      ok: true,
      duplicate: false,
      trackingNumber,
      orderId: order.id,
      orderName: order.name || orderName || "",
      fulfillmentId: fulfillment.id,
      status: normalizedStatus,
      eventStatus,
      statusText,
      happenedAt,
      fulfillmentEventId: fulfillmentEvent?.id || null
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Internal server error",
      stack: error?.stack || null
    });
  }
});
  
  function isAfterDalileeCutoff(dateString) {
    const cutoff = Date.parse("2026-03-26T00:00:00Z");
    const value = Date.parse(String(dateString || ""));
    return Number.isFinite(value) && value >= cutoff;
  }

  async function getOrdersForDalileeSync() {
    const query = `
      query DalileeSyncOrders($q: String!, $after: String) {
        orders(first: 50, after: $after, query: $q, sortKey: PROCESSED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            createdAt
            displayFulfillmentStatus
            fulfillments {
              id
              createdAt
              trackingInfo {
                number
                company
                url
              }
              events(first: 5, sortKey: HAPPENED_AT, reverse: true) {
                nodes {
                  status
                  happenedAt
                }
              }
            }
            metafields(first: 20, namespace: "custom") {
              nodes {
                id
                namespace
                key
                value
                type
              }
            }
          }
        }
      }
    `;

    const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const q = `fulfillment_status:fulfilled processed_at:>=${sinceDate} status:any`;

    let after = null;
    let pageCount = 0;
    const maxPages = 10;
    const rows = [];

    while (pageCount < maxPages) {
      const data = await shopifyGraphQL(query, { q, after });
      const orders = Array.isArray(data?.orders?.nodes) ? data.orders.nodes : [];

      for (const order of orders) {
        const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
        const fulfillment = pickFulfillmentWithTracking(fulfillments);
        if (!fulfillment) continue;
        if (!isAfterDalileeCutoff(order?.createdAt)) continue;

        const trackingInfo = Array.isArray(fulfillment?.trackingInfo)
          ? fulfillment.trackingInfo
          : [];

        const tracking = trackingInfo.find((x) => clean(x?.number));
        if (!tracking?.number) continue;

        const trackingNumber = clean(tracking.number);
        if (!isLikelyDalileeTrackingNumber(trackingNumber)) continue;

        const meta = getMetafieldMap(order);
        const lastStatus = clean(meta["custom.shipping_status"]);
        if (isTerminalShippingStatus(lastStatus)) continue;

        rows.push({
          orderId: order.id,
          orderName: order.name,
          orderCreatedAt: order.createdAt,
          fulfillmentId: fulfillment.id,
          trackingNumber,
          lastStatus,
          lastStatusAt: clean(meta["custom.shipping_status_at"])
        });
      }

      const hasNextPage = Boolean(data?.orders?.pageInfo?.hasNextPage);
      const endCursor = data?.orders?.pageInfo?.endCursor || null;

      if (!hasNextPage || !endCursor) break;

      after = endCursor;
      pageCount += 1;
    }

    return rows;
  }

  function isLikelyDalileeTrackingNumber(value) {
    const v = clean(value).toUpperCase();
    return /^A\d{6,}$/.test(v);
  }

  async function syncOneDalileeTracking(item) {
    const tn = clean(item?.trackingNumber);

    if (!tn) {
      return {
        ok: false,
        trackingNumber: "",
        skipped: true,
        reason: "missing_tracking"
      };
    }

    const savedStatus = normalizeStatus(item?.lastStatus || "");

    if (isTerminalShippingStatus(savedStatus)) {
      return {
        ok: true,
        trackingNumber: tn,
        status: savedStatus,
        skipped: true,
        reason: "already_terminal"
      };
    }

    const trackRes = await fetch(
      `http://127.0.0.1:${port}/api/dalilee/track?trackingNumber=${encodeURIComponent(tn)}`,
      {
        method: "GET",
        headers: { accept: "application/json" }
      }
    );

    const trackJson = await trackRes.json().catch(() => null);

    if (!trackRes.ok || !trackJson?.ok) {
      return {
        ok: false,
        trackingNumber: tn,
        skipped: true,
        reason: trackJson?.error || `track_failed_${trackRes.status}`
      };
    }

const incomingStatus = normalizeDalileeStatus(
  trackJson.status || "",
  Array.isArray(trackJson.updates) ? trackJson.updates : []
);

    if (savedStatus && savedStatus === incomingStatus) {
      return {
        ok: true,
        trackingNumber: tn,
        status: incomingStatus,
        skipped: true,
        reason: "same_status"
      };
    }

    const webhookPayload = {
      trackingNumber: tn,
      status: incomingStatus,
      data: {
        lang: "ar",
        currentStatusText: clean(trackJson.currentStatusText || ""),
        destinationServiceArea: clean(trackJson.destinationServiceArea || ""),
        city: clean(trackJson.city || ""),
        updates: Array.isArray(trackJson.updates) ? trackJson.updates : []
      }
    };

    const internalRes = await fetch(
      `http://127.0.0.1:${port}/api/dalilee/status-webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.DALILEE_WEBHOOK_SECRET
            ? { "x-dalilee-secret": process.env.DALILEE_WEBHOOK_SECRET }
            : {})
        },
        body: JSON.stringify(webhookPayload)
      }
    );

    const internalJson = await internalRes.json().catch(() => null);

return {
  ok: internalRes.ok,
  trackingNumber: tn,
  status: incomingStatus,
  skipped: Boolean(internalJson?.skipped),
  reason: internalJson?.reason || (internalJson?.duplicate ? "duplicate" : ""),
  result: internalJson
};
  }

  function isTerminalShippingStatus(status) {
    const s = normalizeStatus(status);
    return ["DELIVERED", "CANCELLED", "RETURNED"].includes(s);
  }

  async function runDalileeHourlySync({ limit = 15 } = {}) {
    const candidates = await getOrdersForDalileeSync();
    const items = candidates.slice(0, Math.max(1, Number(limit) || 15));

    const results = [];

    for (const item of items) {
      try {
        const r = await syncOneDalileeTracking(item);

        results.push({
          trackingNumber: item.trackingNumber,
          orderName: item.orderName,
          ok: r.ok,
          status: r.status || "",
          duplicate: Boolean(r?.result?.duplicate),
          skipped: Boolean(r?.skipped || r?.result?.skipped),
          reason: r?.reason || "",
          error: r?.error || ""
        });
      } catch (error) {
        results.push({
          trackingNumber: item.trackingNumber,
          orderName: item.orderName,
          ok: false,
          error: error?.message || "sync_failed"
        });
      }
    }

    return {
      ok: true,
      scanned: candidates.length,
      processed: items.length,
      results
    };
  }

  router.all("/api/dalilee/hourly-sync", async (req, res) => {
    try {
      const secret = clean(req.get("x-sync-secret") || req.query.secret || "");
      const expected = clean(process.env.DALILEE_SYNC_SECRET || "");

      if (expected && secret !== expected) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }

      const limit = Number(
        req.body?.limit ||
          req.query.limit ||
          process.env.DALILEE_SYNC_LIMIT ||
          15
      );

      const data = await runDalileeHourlySync({ limit });
      return res.json(data);
    } catch (error) {
      console.error("HOURLY SYNC ERROR:", error);
      return res.status(500).json({
        ok: false,
        error: error?.message || "Hourly sync failed",
        stack: error?.stack || null
      });
    }
  });

  // ── Track App — للمستخدمين المسجلين داخل التطبيق (بدون تحقق رقم الجوال) ──
  router.get("/api/track-app", async (req, res) => {
    const lang = detectLang(req);
    const dict = t(req);

    function makeBaseData({
      provider = "",
      trackingNumber = "",
      orderName = "",
      status = "UNKNOWN",
      currentStatusText = "",
      currentDateText = "",
      originServiceArea = "",
      destinationServiceArea = "",
      orderPhoto = "",
      orderPhotos = [],
      customerName = "",
      customerPhone = "",
      address = "",
      city = "",
      amountDue = null,
      currency = "OMR",
      deliveryState = "",
      updates = [],
      url = "",
      rawSource = "",
      minimalView = false,
      smartMessage = ""
    }) {
      return {
        provider, trackingNumber, orderName, status, currentStatusText,
        currentDateText, originServiceArea, destinationServiceArea,
        orderPhoto, orderPhotos, customerName, customerPhone, address, city,
        amountDue, currency, deliveryState, updates, url, rawSource,
        minimalView, smartMessage
      };
    }

    function isAramexShipment({ trackingNumber = "", carrierCompany = "", carrierUrl = "" } = {}) {
      const hay = [trackingNumber, carrierCompany, carrierUrl].map(clean).join(" ").toLowerCase();
      return /aramex|shipmentnumber|أرامكس|ارامكس/.test(hay);
    }

    function carrierProviderName({ isAramex = false, fallback = "" } = {}) {
      return isAramex ? dict.providers.aramex : fallback;
    }

    function waitingShippingResponse({
      source, type, provider, orderName, customerName, customerPhone,
      address, city, amountDue, currency, currentStatusText, smartMessage,
      orderPhoto = ""
    }) {
      return res.json({
        ok: true, source, type, requiresVerification: false, lang,
        data: makeBaseData({
          provider, trackingNumber: "", orderName, status: "WAITING_SHIPPING",
          currentStatusText, currentDateText: "", originServiceArea: "",
          destinationServiceArea: city, orderPhoto: orderPhoto || "",
          orderPhotos: orderPhoto ? [orderPhoto] : [], customerName,
          customerPhone, address, city, amountDue, currency,
          deliveryState: dict.deliveryStates.waitingShipping,
          updates: [], url: "", rawSource: source, minimalView: true, smartMessage
        })
      });
    }

    try {
      const input = clean(
        req.query.orderName || req.query.orderId || req.query.bt ||
        req.query.query || req.query.order || req.query.num || ""
      );

      if (!input) {
        return res.status(400).json({ ok: false, error: dict.errors.missingInput, lang });
      }

      const normalizedInput = input.replace(/^#/, "").trim();

      // رقم تتبع مباشر → جرب Dalilee أولاً
      if (isLikelyTrackingNumber(normalizedInput)) {
        const directDalilee = await getDalileeTracking(normalizedInput, lang);
        if (isUsefulDalileeResult(directDalilee)) {
          const directUpdates = Array.isArray(directDalilee.updates)
            ? directDalilee.updates.map((item) =>
                normalizeDalileeUpdate(item, directDalilee.destinationServiceArea || directDalilee.city || ""))
            : [];
          const normalizedStatus = normalizeDalileeStatus(directDalilee.status, directUpdates);
          return res.json({
            ok: true, source: "dalilee", type: "tracking",
            requiresVerification: false, lang,
            data: makeBaseData({
              provider: directDalilee.provider || dict.providers.dalilee,
              trackingNumber: directDalilee.trackingNumber || normalizedInput,
              orderName: directDalilee.orderName || "",
              status: normalizedStatus,
              currentStatusText: directDalilee.currentStatusText || directUpdates?.[0]?.statusText || "",
              currentDateText: directDalilee.currentDateText || directUpdates?.[0]?.datetime || directUpdates?.[0]?.date || "",
              originServiceArea: directDalilee.originServiceArea || "",
              destinationServiceArea: directDalilee.destinationServiceArea || "",
              orderPhoto: directDalilee.orderPhoto || "",
              orderPhotos: Array.isArray(directDalilee.orderPhotos) ? directDalilee.orderPhotos : [],
              customerName: directDalilee.customerName || "",
              customerPhone: directDalilee.customerPhone || "",
              address: directDalilee.address || "", city: directDalilee.city || "",
              amountDue: directDalilee.amountDue ?? null,
              currency: directDalilee.currency || "OMR",
              deliveryState: directDalilee.deliveryState || directDalilee.currentStatusText || directUpdates?.[0]?.statusText || "",
              updates: directUpdates, url: directDalilee.url || "", rawSource: "dalilee-direct"
            })
          });
        }
      }

      const cleanOrder = normalizedInput;
      const q = `(order_number:${cleanOrder} OR name:${cleanOrder} OR name:#${cleanOrder})`;
      const query = `
        query TrackOrder($q: String!) {
          orders(first: 1, query: $q, sortKey: PROCESSED_AT, reverse: true) {
            nodes {
              id name tags note cancelledAt cancelReason
              displayFinancialStatus displayFulfillmentStatus
              totalOutstandingSet { shopMoney { amount currencyCode } }
              customer { firstName lastName phone }
              shippingAddress {
                name firstName lastName phone address1 address2 city countryCodeV2
              }
              shippingLines(first: 10) {
                nodes { title carrierIdentifier code }
              }
              fulfillments {
                id createdAt
                trackingInfo { number company url }
                events(first: 20, sortKey: HAPPENED_AT, reverse: true) {
                  nodes { status happenedAt }
                }
              }
            }
          }
        }
      `;

      const shopifyData = await shopifyGraphQL(query, { q });
      const order = shopifyData?.orders?.nodes?.[0];

      if (!order) {
        return res.status(404).json({ ok: false, error: dict.errors.notFound, lang });
      }

      const shipping = order.shippingAddress || {};
      const customer = order.customer || {};
      const tags = Array.isArray(order.tags) ? order.tags : [];
      const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
      const shippingLines = Array.isArray(order?.shippingLines?.nodes) ? order.shippingLines.nodes : [];

      const customerName =
        clean(shipping.name) ||
        clean([shipping.firstName, shipping.lastName].filter(Boolean).join(" ")) ||
        clean([customer.firstName, customer.lastName].filter(Boolean).join(" ")) ||
        (lang === "en" ? "Not available" : "غير متوفر");

      const customerPhone = clean(shipping.phone) || clean(customer.phone) || "";
      const localPhone = getLocalPhone(customerPhone);
      const address = clean([shipping.address1, shipping.address2].filter(Boolean).join(" - ")) || (lang === "en" ? "Not available" : "غير متوفر");
      const city = clean(shipping.city) || (lang === "en" ? "Not available" : "غير متوفر");
      const amountDue = Number(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
      const currency = clean(order?.totalOutstandingSet?.shopMoney?.currencyCode || "OMR");

      const latestFulfillment = pickLatestFulfillment(fulfillments);
      const trackedFulfillment = pickFulfillmentWithTracking(fulfillments);
      const firstTracking =
        (trackedFulfillment?.trackingInfo || []).find(
          (item) => clean(item?.number) || clean(item?.company) || clean(item?.url)
        ) || {};

      const trackingNumber = clean(firstTracking?.number);
      const carrierUrl = clean(firstTracking?.url);
      const localShipmentPhoto = await getShipmentPhotoFromServer(order?.name || `#${cleanOrder}`);
      const shippingLineText = shippingLines
        .map((line) => [clean(line?.title), clean(line?.carrierIdentifier), clean(line?.code)].filter(Boolean).join(" "))
        .join(" ");
      const carrierCompany = clean(firstTracking?.company) || shippingLineText;
      const isAramex = isAramexShipment({ trackingNumber, carrierCompany, carrierUrl });
      const publicCarrierProvider = carrierProviderName({
        isAramex,
        fallback: carrierCompany || dict.providers.carrier
      });
      const publicCarrierUrl = isAramex
        ? (carrierUrl || (trackingNumber
            ? `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(trackingNumber)}`
            : ""))
        : carrierUrl;

      const isCancelled = Boolean(order?.cancelledAt || order?.cancelReason);
      const financialStatus = clean(order?.displayFinancialStatus).toUpperCase();
      const fulfillmentStatus = clean(order?.displayFulfillmentStatus).toUpperCase();

      const hasOfficeTag = hasExactTag(tags, "مكتب") || hasExactTag(tags, "office");
      const hasMuscatTag = hasAnyTag(tags, ["مسقط", "muscat"]);
      const hasConfirmationTag = hasAnyTag(tags, ["تاكيد", "تأكيد", "confirmation"]);
      const isDHL =
        /dhl/i.test(carrierCompany) ||
        shippingLines.some((line) =>
          /dhl/i.test([clean(line?.title), clean(line?.carrierIdentifier), clean(line?.code)].join(" "))
        );

      const events = latestFulfillment?.events?.nodes || [];
      const lastEventStatus = clean(events?.[0]?.status).toUpperCase();
      const hasFulfillmentEvents = Array.isArray(events) && events.length > 0;
      const isActuallyShippedInShopify = hasFulfillmentEvents || fulfillmentStatus === "FULFILLED";

      // *** لا phone verification هنا — المستخدم داخل حسابه ***

      let shippingProfile = "PENDING_CONFIRMATION";
      if (hasMuscatTag) {
        shippingProfile = "MUSCAT";
      } else if (hasOfficeTag && isDHL) {
        shippingProfile = "OFFICE_DHL";
      } else if (hasOfficeTag) {
        shippingProfile = "OFFICE_BRANCH";
      } else if (hasConfirmationTag && !hasMuscatTag && !hasOfficeTag) {
        shippingProfile = "DALILEE";
      } else {
        shippingProfile = "PENDING_CONFIRMATION";
      }

      if (isCancelled) {
        const reason = extractCancelReason(order.note) || cleanCancelReasonLine(order.cancelReason);
        return res.json({
          ok: true, source: "shopify-cancelled", type: "cancelled-order",
          requiresVerification: false, lang,
          data: makeBaseData({
            provider: dict.providers.shopify, trackingNumber: "",
            orderName: order.name || `#${cleanOrder}`, status: "CANCELLED",
            currentStatusText: dict.statuses.cancelled,
            currentDateText: clean(order.cancelledAt),
            originServiceArea: "", destinationServiceArea: city,
            orderPhoto: "", orderPhotos: [], customerName,
            customerPhone: localPhone || customerPhone, address, city,
            amountDue, currency, deliveryState: dict.deliveryStates.cancelled,
            updates: [], url: "", rawSource: "shopify-cancelled",
            smartMessage: reason
              ? dict.messages.cancelledWithReason(reason)
              : dict.messages.cancelledPlain
          })
        });
      }

      if (shippingProfile === "OFFICE_BRANCH" && isActuallyShippedInShopify) {
        const officeLocationLine = (() => {
          const c = clean(city); const a = clean(address);
          if (!c && !a) return "";
          if (a && c && a.includes(c)) return a;
          if (c && !a) return c; if (!c && a) return a;
          return `${c} - ${a}`;
        })();
        const officeMessage =
          `بيانات الاستلام:\nالاسم: ${customerName}\nرقم الهاتف: ${localPhone || customerPhone}\nالمنطقة: ${officeLocationLine}\n\nسيتم إرسال رسالة عند وصول الشحنة إلى أقرب فرع تحتوي على تفاصيل الاستلام.`;
        const officeMessageEn =
          `Pickup details:\nName: ${customerName}\nPhone: ${localPhone || customerPhone}\nLocation: ${officeLocationLine}\n\nYou will receive a message once the shipment arrives at the nearest branch with pickup details.`;
        return res.json({
          ok: true, source: "office-branch", type: "office-order-branch",
          requiresVerification: false, lang,
          data: makeBaseData({
            provider: dict.providers.office, trackingNumber: "",
            orderName: order.name || `#${cleanOrder}`, status: "OFFICE_BRANCH",
            currentStatusText: dict.statuses.officeBranch,
            currentDateText: clean(trackedFulfillment?.createdAt || latestFulfillment?.createdAt || ""),
            originServiceArea: "", destinationServiceArea: city,
            orderPhoto: localShipmentPhoto || "",
            orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
            customerName, customerPhone: localPhone || customerPhone, address, city,
            amountDue, currency, deliveryState: dict.deliveryStates.office,
            updates: [], url: "", rawSource: "office-branch", minimalView: true,
            smartMessage: lang === "en" ? officeMessageEn : officeMessage
          })
        });
      }

      if (shippingProfile === "OFFICE_DHL" && isActuallyShippedInShopify) {
        const dhlLocationLine = (() => {
          const co = clean(shipping.countryCodeV2 || "");
          const c = clean(city); const a = clean(address);
          if (!co && !c && !a) return "";
          let parts = [co, c, a].filter(Boolean);
          if (a) { parts = parts.filter((p, i) => { if (i === 2) return true; return !a.includes(p); }); }
          return parts.join(" - ");
        })();
        const dhlTrackingUrl = isAramex && carrierUrl
          ? carrierUrl
          : isAramex && trackingNumber
          ? `https://www.aramex.com/track/results?ShipmentNumber=${encodeURIComponent(trackingNumber)}`
          : trackingNumber
          ? `https://www.dhl.com/tracking?tracking-ID=${encodeURIComponent(trackingNumber)}&tracking-id=${encodeURIComponent(trackingNumber)}`
          : clean(carrierUrl);
        const dhlMessage = dhlTrackingUrl
          ? `الوجهة: ${dhlLocationLine}\n\nيمكنك تتبع الشحنة من الرابط المرفق.`
          : `الوجهة: ${dhlLocationLine}\n\nسيتم إرسال رسالة تحتوي على رابط تتبع الشحنة أو تفاصيل الاستلام.`;
        const dhlMessageEn = dhlTrackingUrl
          ? `Destination: ${dhlLocationLine}\n\nYou can track your shipment using the attached link.`
          : `Destination: ${dhlLocationLine}\n\nYou will receive a message with tracking details or pickup instructions.`;
        return res.json({
          ok: true, source: "office-dhl", type: "office-order-dhl",
          requiresVerification: false, lang,
          data: makeBaseData({
            provider: isAramex ? dict.providers.aramex : dict.providers.dhl,
            trackingNumber: trackingNumber || "",
            orderName: order.name || `#${cleanOrder}`, status: "OFFICE_DHL",
            currentStatusText: isAramex ? "تم شحن طلبك عبر Aramex" : dict.statuses.officeDhl,
            currentDateText: clean(trackedFulfillment?.createdAt || latestFulfillment?.createdAt || ""),
            originServiceArea: "", destinationServiceArea: city,
            orderPhoto: localShipmentPhoto || "",
            orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [],
            customerName, customerPhone: localPhone || customerPhone, address, city,
            amountDue, currency, deliveryState: isAramex ? "Aramex" : dict.deliveryStates.dhl,
            updates: [], url: dhlTrackingUrl, rawSource: isAramex ? "office-aramex" : "office-dhl", minimalView: true,
            smartMessage: lang === "en" ? dhlMessageEn : dhlMessage
          })
        });
      }

      if (trackingNumber) {
        if (shippingProfile === "DALILEE" && /^A/i.test(trackingNumber)) {
          const dalileeByTracking = await getDalileeTracking(trackingNumber, lang);
          if (isUsefulDalileeResult(dalileeByTracking)) {
            const dalileeUpdates = Array.isArray(dalileeByTracking.updates)
              ? dalileeByTracking.updates.map((item) =>
                  normalizeDalileeUpdate(item, dalileeByTracking.destinationServiceArea || dalileeByTracking.city || city))
              : [];
            const normalizedStatus = normalizeDalileeStatus(dalileeByTracking.status, dalileeUpdates);
            return res.json({
              ok: true, source: "dalilee", type: "order-with-dalilee-tracking",
              requiresVerification: false, lang,
              data: makeBaseData({
                provider: dalileeByTracking.provider || dict.providers.dalilee,
                trackingNumber, orderName: dalileeByTracking.orderName || order.name || `#${cleanOrder}`,
                status: normalizedStatus,
                currentStatusText: dalileeByTracking.currentStatusText || dalileeUpdates?.[0]?.statusText || "",
                currentDateText: dalileeByTracking.currentDateText || dalileeUpdates?.[0]?.datetime || dalileeUpdates?.[0]?.date || "",
                originServiceArea: dalileeByTracking.originServiceArea || "",
                destinationServiceArea: dalileeByTracking.destinationServiceArea || city,
                orderPhoto: dalileeByTracking.orderPhoto || localShipmentPhoto || "",
                orderPhotos: Array.isArray(dalileeByTracking.orderPhotos) && dalileeByTracking.orderPhotos.length
                  ? dalileeByTracking.orderPhotos
                  : (dalileeByTracking.orderPhoto || localShipmentPhoto ? [dalileeByTracking.orderPhoto || localShipmentPhoto] : []),
                customerName: dalileeByTracking.customerName || customerName,
                customerPhone: dalileeByTracking.customerPhone || (localPhone || customerPhone),
                address: dalileeByTracking.address || address, city: dalileeByTracking.city || city,
                amountDue: dalileeByTracking.amountDue ?? amountDue,
                currency: dalileeByTracking.currency || currency,
                deliveryState: dalileeByTracking.deliveryState || dalileeByTracking.currentStatusText || dalileeUpdates?.[0]?.statusText || "",
                updates: dalileeUpdates, url: dalileeByTracking.url || carrierUrl, rawSource: "dalilee-from-order"
              })
            });
          }

          const fulfillmentCreatedAt = trackedFulfillment?.createdAt || latestFulfillment?.createdAt || "";
          const shopifyUpdates = mapLocalUpdates(events, city, dict, fulfillmentCreatedAt);
          const shopifyState = mapLocalState({ lastEventStatus, hasFulfillment: isActuallyShippedInShopify, dict, allowDeliveredFromShopify: false });
          return res.json({
            ok: true, source: "dalilee-shopify-fallback", type: "order-with-dalilee-tracking-fallback",
            requiresVerification: false, lang,
            data: makeBaseData({
              provider: dict.providers.dalilee, trackingNumber,
              orderName: order.name || `#${cleanOrder}`, status: shopifyState.status,
              currentStatusText: shopifyState.currentStatusText || dict.statuses.trackingCreated,
              currentDateText: clean(events?.[0]?.happenedAt || trackedFulfillment?.createdAt || latestFulfillment?.createdAt),
              originServiceArea: "", destinationServiceArea: city,
              orderPhoto: localShipmentPhoto || "", orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [], customerName,
              customerPhone: localPhone || customerPhone, address, city,
              amountDue, currency, deliveryState: shopifyState.deliveryState,
              updates: shopifyUpdates, url: carrierUrl, rawSource: "dalilee-shopify-fallback"
            })
          });
        }

        const fulfillmentCreatedAt = trackedFulfillment?.createdAt || latestFulfillment?.createdAt || "";
        const shopifyUpdates = mapLocalUpdates(events, city, dict, fulfillmentCreatedAt);
        const shopifyState = mapLocalState({ lastEventStatus, hasFulfillment: isActuallyShippedInShopify, dict, allowDeliveredFromShopify: true });
        return res.json({
          ok: true, source: "shopify-tracked-order", type: "tracked-order",
          requiresVerification: false, lang,
          data: makeBaseData({
            provider:
              shippingProfile === "MUSCAT" ? dict.providers.local :
              shippingProfile === "OFFICE_DHL" ? (isAramex ? dict.providers.aramex : dict.providers.dhl) :
              shippingProfile === "OFFICE_BRANCH" ? dict.providers.office :
              shippingProfile === "DALILEE" ? dict.providers.dalilee :
              publicCarrierProvider,
            trackingNumber, orderName: order.name || `#${cleanOrder}`,
            status: shopifyState.status,
            currentStatusText: shopifyState.currentStatusText || dict.statuses.trackingCreated,
            currentDateText: clean(events?.[0]?.happenedAt || trackedFulfillment?.createdAt || latestFulfillment?.createdAt),
            originServiceArea: "", destinationServiceArea: city,
            orderPhoto: localShipmentPhoto || "",
            orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [], customerName,
            customerPhone: localPhone || customerPhone, address, city,
            amountDue, currency, deliveryState: shopifyState.deliveryState,
            updates: shopifyUpdates, url: publicCarrierUrl, rawSource: "shopify-tracked-order"
          })
        });
      }

      if (isActuallyShippedInShopify) {
        const fulfillmentCreatedAt = trackedFulfillment?.createdAt || latestFulfillment?.createdAt || "";
        const shopifyUpdates = mapLocalUpdates(events, city, dict, fulfillmentCreatedAt);
        const shopifyState = mapLocalState({ lastEventStatus, hasFulfillment: isActuallyShippedInShopify, dict, allowDeliveredFromShopify: true });
        return res.json({
          ok: true, source: "shopify-fulfilled-no-tracking", type: "fulfilled-order-no-tracking",
          requiresVerification: false, lang,
          data: makeBaseData({
            provider:
              shippingProfile === "MUSCAT" ? dict.providers.local :
              shippingProfile === "OFFICE_DHL" ? (isAramex ? dict.providers.aramex : dict.providers.dhl) :
              shippingProfile === "OFFICE_BRANCH" ? dict.providers.office :
              shippingProfile === "DALILEE" ? dict.providers.dalilee :
              dict.providers.local,
            trackingNumber: "", orderName: order.name || `#${cleanOrder}`,
            status: shopifyState.status, currentStatusText: shopifyState.currentStatusText,
            currentDateText: clean(events?.[0]?.happenedAt || latestFulfillment?.createdAt || ""),
            originServiceArea: "", destinationServiceArea: city,
            orderPhoto: localShipmentPhoto || "",
            orderPhotos: localShipmentPhoto ? [localShipmentPhoto] : [], customerName,
            customerPhone: localPhone || customerPhone, address, city,
            amountDue, currency, deliveryState: shopifyState.deliveryState,
            updates: shopifyUpdates, url: "", rawSource: "shopify-fulfilled-no-tracking"
          })
        });
      }

      if (shippingProfile === "MUSCAT") {
        return waitingShippingResponse({
          source: "muscat-waiting-shipping", type: "order-muscat-waiting-shipping",
          provider: dict.providers.local, orderName: order.name || `#${cleanOrder}`,
          customerName, customerPhone: localPhone || customerPhone, address, city,
          amountDue, currency, currentStatusText: dict.statuses.confirmedWaitingShipping,
          smartMessage: dict.messages.confirmedWaitingShipping, orderPhoto: localShipmentPhoto
        });
      }
      if (shippingProfile === "DALILEE") {
        return waitingShippingResponse({
          source: "dalilee-waiting-shipping", type: "order-dalilee-waiting-shipping",
          provider: dict.providers.dalilee, orderName: order.name || `#${cleanOrder}`,
          customerName, customerPhone: localPhone || customerPhone, address, city,
          amountDue, currency, currentStatusText: dict.statuses.waitingShipping,
          smartMessage: dict.messages.waitingShipping, orderPhoto: localShipmentPhoto
        });
      }
      if (shippingProfile === "OFFICE_DHL") {
        return waitingShippingResponse({
          source: "office-dhl-waiting-shipping", type: "office-order-dhl-waiting-shipping",
          provider: dict.providers.dhl, orderName: order.name || `#${cleanOrder}`,
          customerName, customerPhone: localPhone || customerPhone, address, city,
          amountDue, currency, currentStatusText: dict.statuses.waitingShipping,
          smartMessage: dict.messages.waitingShipping
        });
      }
      if (shippingProfile === "OFFICE_BRANCH") {
        return waitingShippingResponse({
          source: "office-branch-waiting-shipping", type: "office-order-branch-waiting-shipping",
          provider: dict.providers.office, orderName: order.name || `#${cleanOrder}`,
          customerName, customerPhone: localPhone || customerPhone, address, city,
          amountDue, currency, currentStatusText: dict.statuses.waitingShipping,
          smartMessage: dict.messages.waitingShipping
        });
      }

      return res.json({
        ok: true, source: "waiting-confirmation", type: "order-waiting-confirmation",
        requiresVerification: false, lang,
        data: makeBaseData({
          provider: dict.providers.shopify, trackingNumber: "",
          orderName: order.name || `#${cleanOrder}`, status: "WAITING_CONFIRMATION",
          currentStatusText: dict.statuses.waitingConfirmation,
          currentDateText: "", originServiceArea: "", destinationServiceArea: city,
          orderPhoto: "", orderPhotos: [], customerName,
          customerPhone: localPhone || customerPhone, address, city,
          amountDue, currency, deliveryState: dict.deliveryStates.waitingConfirmation,
          updates: [], url: "", rawSource: "waiting-confirmation", minimalView: true,
          smartMessage: dict.messages.waitingConfirmation
        })
      });

    } catch (error) {
      return res.status(500).json({
        ok: false, error: error?.message || dict.errors.internal, lang
      });
    }
  });

  return router;
}
