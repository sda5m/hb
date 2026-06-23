// /btcm/auth.js  (لوحة التجهيز)
const KEY = "PACK_KEY_BTCM";

export function getPackKey(){
  return localStorage.getItem(KEY) || "";
}

export function saveKey(key){
  localStorage.setItem(KEY, String(key || "").trim());
}

export function clearPackKey(){
  localStorage.removeItem(KEY);
}

export function packHeaders(extra = {}){
  return { "x-pack-key": getPackKey(), ...extra };
}

export function requirePackLogin(){
  if(!getPackKey()){
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace("/btcm/login.html?next=" + next);
    return false;
  }
  return true;
}

export async function authFetch(url, options = {}){
  const headers = new Headers(options.headers || {});
  headers.set("x-pack-key", getPackKey());

  const r = await fetch(url, { ...options, headers });

  if(r.status === 401){
    clearPackKey();
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace("/btcm/login.html?next=" + next);
  }

  return r;
}
