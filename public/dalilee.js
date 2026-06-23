const cheerio = require("cheerio");

// إذا كنت على Node أقل من 18، فك التعليق عن السطر التالي:
// const fetch = require("node-fetch");

function normalizeText(text = "") {
  return String(text)
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function mapDalileeStatus(rawStatus) {
  const s = normalizeText(rawStatus).toLowerCase();

  if (s.includes("delivered") || s.includes("تم التوصيل")) {
    return "DELIVERED";
  }

  if (
    s.includes("out for delivery") ||
    s.includes("with courier") ||
    s.includes("خرج للتوصيل")
  ) {
    return "OUT_FOR_DELIVERY";
  }

  if (
    s.includes("picked up by driver") ||
    s.includes("picked up") ||
    s.includes("transit") ||
    s.includes("received at") ||
    s.includes("in transit")
  ) {
    return "IN_TRANSIT";
  }

  return "UNKNOWN";
}

async function getDalileeTracking(trackingNumber, country = "oman") {
  if (!trackingNumber) {
    throw new Error("trackingNumber is required");
  }

  const url = `https://trader.dalilee.om/trackshipment/${encodeURIComponent(country)}/${encodeURIComponent(trackingNumber)}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(`Dalilee HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const pageText = normalizeText($.root().text());

  // تحقق أولي أن الصفحة صفحة تتبع فعلًا
  const hasTrackingContext =
    pageText.includes("Tracking Code") ||
    pageText.includes("All Shipment Updates") ||
    pageText.includes("Dalilee");

  if (!hasTrackingContext) {
    return {
      ok: false,
      trackingNumber,
      provider: "Dalilee",
      status: "UNKNOWN",
      currentStatusText: "",
      updates: [],
      error: "Tracking page structure not recognized"
    };
  }

  // 1) الحالة الحالية من heading-div
  let currentStatusText = "";
  $(".heading-div").each((_, el) => {
    const txt = normalizeText($(el).text());
    if (
      txt &&
      !/all shipment updates/i.test(txt) &&
      !/tracking order/i.test(txt)
    ) {
      if (
        /delivered|out for delivery|received|transit|picked up|shipment/i.test(
          txt.toLowerCase()
        )
      ) {
        currentStatusText = txt;
        return false;
      }
    }
  });

  // 2) استخراج التحديثات الزمنية
  const updates = [];
  const seen = new Set();

  // نلتقط العناصر النصية التي تحمل اسم الحالة
  $(
    ".received-text, .delivered-text, .shipment-status, .status-text, .heading-div, .tracking-status"
  ).each((_, el) => {
    const txt = normalizeText($(el).text());
    if (!txt) return;

    const lower = txt.toLowerCase();

    const looksLikeStatus =
      lower.includes("delivered") ||
      lower.includes("out for delivery") ||
      lower.includes("received at") ||
      lower.includes("transit") ||
      lower.includes("picked up by driver") ||
      lower.includes("picked up") ||
      lower.includes("shipment created") ||
      lower.includes("in transit");

    if (looksLikeStatus && !seen.has(txt)) {
      seen.add(txt);
      updates.push({ text: txt });
    }
  });

  // إذا لم نجد الحالة الحالية من heading، نأخذ أول تحديث
  if (!currentStatusText && updates.length > 0) {
    currentStatusText = updates[0].text;
  }

  const status = mapDalileeStatus(currentStatusText);

  return {
    ok: true,
    trackingNumber,
    provider: "Dalilee",
    url,
    status,
    currentStatusText,
    updates,
    rawHtmlLength: html.length
  };
}

module.exports = {
  getDalileeTracking,
  mapDalileeStatus
};
