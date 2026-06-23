// /auth.js
const STORAGE_KEY = "ADMIN_KEY";

export function getAdminKey(){
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function clearAdminKey(){
  localStorage.removeItem(STORAGE_KEY);
}

export function requireAdminLogin(loginPath = "/login.html"){
  if(!getAdminKey()){
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${loginPath}?next=${next}`);
    return false;
  }
  return true;
}

export function adminHeaders(extra = {}){
  return { "x-admin-key": getAdminKey(), ...extra };
}

// fetch wrapper يضيف الهيدر تلقائياً + يتعامل مع 401
export async function authFetch(url, options = {}, loginPath="/login.html"){
  const opt = options || {};
  const headers = new Headers(opt.headers || {});
  headers.set("x-admin-key", getAdminKey());

  const r = await fetch(url, { ...opt, headers });

  if(r.status === 401){
    clearAdminKey();
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`${loginPath}?next=${next}`);
  }

  return r;
}
