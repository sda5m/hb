import fetch from "node-fetch";
import {
  decode,
  recoverNearest,
  isShort,
  isFull
} from "@erikmichelson/open-location-code-ts";

function cleanText(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidLatLng(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function extractLatLngFromText(text) {
  const s = cleanText(text);

  let m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng, source: "direct" };
    }
  }

  m = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng, source: "url-@" };
    }
  }

  m = s.match(/[?&](?:q|query|ll|destination|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng, source: "url-query" };
    }
  }

  m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng, source: "url-place" };
    }
  }

  m = s.match(/\/search\/.*?\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidLatLng(lat, lng)) {
      return { lat, lng, source: "url-search" };
    }
  }

  return null;
}

function extractPlusCodeParts(text) {
  const s = cleanText(text).toUpperCase();
  if (!s) return null;

  const m = s.match(/([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3})/i);
  if (!m) return null;

  const code = String(m[1] || "").toUpperCase();
  const rest = cleanText(s.replace(m[1], "").replace(/^[,\s]+|[,\s]+$/g, ""));

  return { code, localityHint: rest };
}

function extractReadablePlaceFromGoogleUrl(text) {
  const s = cleanText(text);
  if (!s) return "";

  try {
    const u = new URL(s);

    const q = cleanText(
      u.searchParams.get("q") ||
      u.searchParams.get("query") ||
      u.searchParams.get("destination") ||
      u.searchParams.get("daddr") ||
      ""
    );

    if (q && !extractLatLngFromText(q)) {
      return q;
    }

    const pathname = decodeURIComponent(u.pathname || "");

    let m = pathname.match(/\/place\/([^/]+)/i);
    if (m && m[1]) {
      const place = cleanText(m[1].replace(/\+/g, " "));
      if (place) return place;
    }

    m = pathname.match(/\/search\/([^/]+)/i);
    if (m && m[1]) {
      const place = cleanText(m[1].replace(/\+/g, " "));
      if (place) return place;
    }
  } catch {}

  return "";
}

async function geocodePlace(placeText) {
  const q = cleanText(placeText);
  if (!q) return null;

  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(q);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "driver-panel-location-extractor"
    }
  });

  if (!res.ok) return null;

  const data = await res.json().catch(() => null);
  if (!Array.isArray(data) || !data.length) return null;

  const lat = safeNum(data[0]?.lat);
  const lng = safeNum(data[0]?.lon);

  if (!isValidLatLng(lat, lng)) return null;

  return {
    lat,
    lng,
    displayName: cleanText(data[0]?.display_name || q)
  };
}

async function decodePlusCode(input, fallbackArea = "") {
  const parsed = extractPlusCodeParts(input);
  if (!parsed) return null;

  const { code, localityHint } = parsed;

  try {
    if (isFull(code)) {
      const area = decode(code);
      return {
        lat: area.latitudeCenter,
        lng: area.longitudeCenter,
        source: "pluscode-full",
        fullCode: code
      };
    }

    if (isShort(code)) {
      const refText = cleanText(localityHint || fallbackArea);

      if (!refText) {
        throw new Error("الـ Plus Code المختصر يحتاج اسم منطقة أو مدينة");
      }

      const ref = await geocodePlace(refText);
      if (!ref) {
        throw new Error("تعذر تحديد المنطقة المرجعية للـ Plus Code");
      }

      const fullCode = recoverNearest(code, ref.lat, ref.lng);
      const area = decode(fullCode);

      return {
        lat: area.latitudeCenter,
        lng: area.longitudeCenter,
        source: "pluscode-short",
        fullCode,
        reference: ref.displayName
      };
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("فشل فك الـ Plus Code");
  }

  return null;
}

async function expandGoogleShortUrl(url) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "driver-panel-location-extractor"
    }
  });

  return res.url || url;
}

async function resolveGoogleExpandedUrl(expanded, fallbackArea = "") {
  const direct = extractLatLngFromText(expanded);
  if (direct) {
    return {
      ...direct,
      source: "short-expanded-direct"
    };
  }

  const plus = await decodePlusCode(expanded, fallbackArea);
  if (plus) {
    return {
      ...plus,
      source: "short-expanded-pluscode"
    };
  }

  const readablePlace = extractReadablePlaceFromGoogleUrl(expanded);
  if (readablePlace) {
    const geo = await geocodePlace(readablePlace);
    if (geo) {
      return {
        lat: geo.lat,
        lng: geo.lng,
        source: "short-expanded-place",
        reference: geo.displayName
      };
    }
  }

  return null;
}

export async function extractLocation(input, fallbackArea = "") {
  const raw = cleanText(input);
  if (!raw) {
    throw new Error("input فارغ");
  }

  const direct = extractLatLngFromText(raw);
  if (direct) return direct;

  const plus = await decodePlusCode(raw, fallbackArea);
  if (plus) return plus;

  if (/maps\.app\.goo\.gl/i.test(raw)) {
    const expanded = await expandGoogleShortUrl(raw);

    const resolved = await resolveGoogleExpandedUrl(expanded, fallbackArea);
    if (resolved) {
      return {
        ...resolved,
        expandedUrl: expanded
      };
    }

    throw new Error("فشل استخراج الإحداثية من الرابط المختصر");
  }

  if (/^https?:\/\//i.test(raw)) {
    const extracted = extractLatLngFromText(raw);
    if (extracted) return extracted;

    const plusFromUrl = await decodePlusCode(raw, fallbackArea);
    if (plusFromUrl) {
      return plusFromUrl;
    }

    const readablePlace = extractReadablePlaceFromGoogleUrl(raw);
    if (readablePlace) {
      const geo = await geocodePlace(readablePlace);
      if (geo) {
        return {
          lat: geo.lat,
          lng: geo.lng,
          source: "url-place-geocoded",
          reference: geo.displayName
        };
      }
    }

    throw new Error("الرابط لا يحتوي إحداثية مباشرة");
  }

  throw new Error("لم يتم التعرف على الموقع");
}
