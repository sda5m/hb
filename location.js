import fetch from "node-fetch";
import {
  decode,
  recoverNearest,
  isShort,
  isFull
} from "@erikmichelson/open-location-code-ts";

function cleanText(v) {
  return String(v || "").trim();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractLatLngFromText(text) {
  const s = cleanText(text);

  let m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), source: "direct" };

  m = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), source: "url-@" };

  m = s.match(/[?&](?:q|query|ll|destination|daddr)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), source: "url-query" };

  m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), source: "url-place" };

  return null;
}

function extractPlusCodeParts(text) {
  const s = cleanText(text).toUpperCase();

  const m = s.match(/([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3})/i);
  if (!m) return null;

  const code = m[1].toUpperCase();
  const rest = cleanText(s.replace(m[1], "").replace(/^[,\s]+|[,\s]+$/g, ""));

  return { code, localityHint: rest };
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

  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;

  return {
    lat: safeNum(data[0].lat),
    lng: safeNum(data[0].lon),
    displayName: data[0].display_name || q
  };
}

async function decodePlusCode(input, fallbackArea) {
  const parsed = extractPlusCodeParts(input);
  if (!parsed) return null;

  const { code, localityHint } = parsed;

  try {
    if (isFull(code)) {
      const area = decode(code);
      return {
        lat: area.latitudeCenter,
        lng: area.longitudeCenter,
        source: "pluscode-full"
      };
    }

    if (isShort(code)) {
      const refText = cleanText(localityHint || fallbackArea);
      const ref = await geocodePlace(refText);
      if (!ref) throw new Error("تعذر تحديد المنطقة المرجعية");

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
  } catch {
    return null;
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

  const finalUrl = res.url || url;

  try {
    const u = new URL(finalUrl);
    const nested = u.searchParams.get("link");
    if (nested) return decodeURIComponent(nested);
  } catch {}

  const m = finalUrl.match(/[?&]link=([^&]+)/i);
  if (m) return decodeURIComponent(m[1]);

  return finalUrl;
}

export async function extractLocation(input, fallbackArea = "Seeb, Muscat, Oman") {
  const raw = cleanText(input);
  if (!raw) throw new Error("input فارغ");

  const direct = extractLatLngFromText(raw);
  if (direct) return direct;

  const plus = await decodePlusCode(raw, fallbackArea);
  if (plus) return plus;

  if (/maps\.app\.goo\.gl/i.test(raw)) {
    const expanded = await expandGoogleShortUrl(raw);

    const fromExpanded = extractLatLngFromText(expanded);
    if (fromExpanded) {
      return {
        ...fromExpanded,
        source: "short-expanded"
      };
    }

    const plusFromExpanded = await decodePlusCode(expanded, fallbackArea);
    if (plusFromExpanded) {
      return {
        ...plusFromExpanded,
        source: "short-pluscode"
      };
    }

    throw new Error("فشل استخراج الإحداثية من الرابط المختصر");
  }

  if (/^https?:\/\//i.test(raw)) {
    const extracted = extractLatLngFromText(raw);
    if (extracted) return extracted;

    throw new Error("الرابط لا يحتوي إحداثية مباشرة");
  }

  throw new Error("لم يتم التعرف على الموقع");
}
