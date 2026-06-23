"use strict";

/* ======================
   Icons
   ====================== */
const ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 13h6V4H4v9Z"/><path d="M14 20h6V4h-6v16Z"/><path d="M4 20h6v-3H4v3Z"/></svg>`,
   bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h11"/><path d="M9 17a3 3 0 0 0 6 0"/></svg>`,
  orders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h14l-2 7H8L7 7Z"/><path d="M7 7 6 3H3"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18v4H3z"/><path d="M5 8v12h14V8"/><path d="M10 12h4"/></svg>`,
  receipt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2v20l3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2Z"/><path d="M8 8h8"/><path d="M8 12h8"/><path d="M8 16h5"/></svg>`,
  wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M16 12h6"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>`,
  excel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h10v16H4z"/><path d="M14 4l6 6v10h-6z"/><path d="m7 9 4 6"/><path d="m11 9-4 6"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`,
  cash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01"/><path d="M18 15h.01"/></svg>`,
  amwal: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 3 7l9 5 9-5-9-5Z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>`,
  bank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h18"/><path d="M5 10V8l7-5 7 5v2"/><path d="M6 10v8"/><path d="M10 10v8"/><path d="M14 10v8"/><path d="M18 10v8"/><path d="M4 18h16"/></svg>`,
  delivery: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7h11v10H3z"/><path d="M14 11h4l3 3v3h-7z"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></svg>`,
  sum: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h12"/><path d="m7 20 5-8-5-8h10"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/></svg>`,
  up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5l-7 7h14z"/><path d="M5 19h14"/></svg>`,
  down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7H5z"/><path d="M5 5h14"/></svg>`,
  sort: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 11H3"/><path d="M12 6H3"/><path d="M12 16H3"/><path d="M21 18H14"/><path d="m19 14 2 2-2 2"/><path d="M14 6h7"/><path d="m19 10 2-2-2-2"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`
};

document.querySelectorAll("[data-ico]").forEach((el) => {
  el.innerHTML = ICONS[el.dataset.ico] || "";
});

/* ======================
   Loader
   ====================== */
const loaderEl = document.getElementById("globalLoader");
const loaderTxt = document.getElementById("globalLoaderText");

let __netPending = 0;
let __netTimer = null;

function setLoaderText(msg){
  if(loaderTxt) loaderTxt.textContent = msg || "جاري العمل… اصبر شوي";
}

function showLoader(msg){
  setLoaderText(msg);
  if(!loaderEl) return;

  if(__netTimer) clearTimeout(__netTimer);
  __netTimer = setTimeout(() => {
    if(__netPending > 0) loaderEl.classList.add("show");
  }, 180);
}

function hideLoader(){
  if(__netTimer) clearTimeout(__netTimer);
  if(loaderEl) loaderEl.classList.remove("show");
}

function netBegin(msg){
  __netPending++;
  showLoader(msg);
}

function netEnd(){
  __netPending = Math.max(0, __netPending - 1);
  if(__netPending === 0) hideLoader();
}

function inferLoaderText(url){
  const u = String(url || "");

  if(u.includes("transfer")) return "جاري الترحيل… اصبر شوي";
  if(u.includes("archive")) return "جاري جلب الأرشيف… اصبر شوي";
  if(u.includes("summary") || u.includes("orders") || u.includes("list")) return "جاري جلب الطلبات… اصبر شوي";
  if(u.includes("ledger") || u.includes("settle")) return "جاري تحديث الحسابات… اصبر شوي";
  if(u.includes("purchases")) return "جاري تحديث المشتريات… اصبر شوي";
  if(u.includes("expenses")) return "جاري تحديث الصرفيات… اصبر شوي";
  if(u.includes("debts")) return "جاري تحديث الديون… اصبر شوي";

  return "جاري العمل… اصبر شوي";
}

const __origFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  netBegin(inferLoaderText(input, init));
  try{
    return await __origFetch(input, init);
  } finally {
    netEnd();
  }
};

/* ======================
   State / API
   ====================== */
const API = {
  summary: "/api/money/v2/summary",
  transfer: "/api/money/v2/transfer",
  archive: "/api/money/v2/archive",
  shipping: "/api/money/v2/shipping",
  untransfer: "/api/money/v2/untransfer",
  ledger: "/api/money/v2/ledger",
  settle: "/api/money/v2/settle",
   manualAdd: "/api/money/v2/manual-add",

deliverySummary: "/api/money/delivery/summary",
deliverySettle: "/api/money/delivery/settle",
deliveryStatus: "/api/money/delivery/status",
deliveryCancel: "/api/money/delivery/cancel",
deliveryNote: "/api/money/delivery/note",
deliveryTag: "/api/money/delivery/tag",

localStock: "/api/money/local-stock/summary",
localStockCustomer: "/api/money/local-stock/customer",
localStockSalePrice: "/api/money/local-stock/sale-price",
localStockCustomerSettle: "/api/money/local-stock/customer/settle",

   
  debts: "/api/money/debts",
  debtAdd: "/api/money/debts/add",
  debtPay: "/api/money/debts/pay",
  debtRemove: "/api/money/debts/remove",
  debtReorder: "/api/money/debts/reorder",

  expenses: "/api/money/expenses",
  expenseAdd: "/api/money/expenses/admin-add",
  expTransfer: "/api/money/expenses/transfer",

  purchases: "/api/money/purchases",
  purchaseAdd: "/api/money/purchases/add"
};

const state = {
  activeTab: "dashboard",

  summary: {
    totals: {},
    lists: { amwal: [], bank: [], cash: [], cashMuscat: [], cashDalili: [] },
    ledger: { balances: {}, entries: [], totals: {} }
  },

  ledger: {
    balances: {},
    entries: [],
    totals: {},
    debtsTotal: 0
  },

delivery: {
  totals: {},
  lists: {
    readyToSettle: [],
    deliveredAll: [],
    outForDelivery: [],
    withDriver: [],
    settled: []
  },
  q: ""
},

localStock: {
  totals: {},
  productRows: [],
  customers: [],
  sales: []
},

   
  archive: [],

  debts: {
    items: [],
    total: 0,
    totalNet: 0
  },

  debtView: {
    q: "",
    sort: "priority",
    onlyPositive: false
  },

  expenses: {
    items: [],
    total: 0
  },

  purchases: {
    items: [],
    total: 0
  },

  selectedOrders: new Set(),
  orderSearch: "",
  loadedTabs: new Set()
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function adminKey(){
  let k = localStorage.getItem("ADMIN_KEY") || "";
  if(!k){
    k = prompt("أدخل مفتاح المدير") || "";
    k = k.trim();
    if(k) localStorage.setItem("ADMIN_KEY", k);
  }
  return k;
}

async function apiJson(url, options = {}){
  const headers = {
    "x-admin-key": adminKey(),
    ...(options.headers || {})
  };

  const res = await fetch(url, {
    ...options,
    headers
  });

  const text = await res.text();

  let json = {};
  try{
    json = JSON.parse(text || "{}");
  }catch{
    json = { raw: text };
  }

  if(!res.ok){
    if(res.status === 401) localStorage.removeItem("ADMIN_KEY");
    throw new Error(json.error || json.message || text || `HTTP ${res.status}`);
  }

  return json;
}

function qsDates(){
  const p = new URLSearchParams();

  const from = $("#dateFrom")?.value || "";
  const to = $("#dateTo")?.value || "";

  if(from) p.set("from", from);
  if(to) p.set("to", to);

  return p.toString();
}

function n(v){
  const x = Number(String(v ?? 0).replace(/,/g,""));
  return Number.isFinite(x) ? x : 0;
}

function fmt(v){
  return n(v).toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}

function isPaidSection(section){
  const s = String(section || "").toUpperCase();
  return s === "AMWAL" || s === "BANK";
}

function isExternalShippingOrder(o){
  const company = String(
    o?.shippingCompany ||
    o?.shippingTitle ||
    o?.deliveryCompany ||
    o?.shippingMethod ||
    ""
  ).toLowerCase();

  const tags = Array.isArray(o?.tags)
    ? o.tags.map((x) => String(x || "").toLowerCase())
    : String(o?.tags || "").split(",").map((x) => x.trim().toLowerCase());

  if(
    company.includes("dhl") ||
    company.includes("دي اتش") ||
    company.includes("دي إتش") ||
    company.includes("مكتب") ||
    company.includes("office")
  ){
    return true;
  }

  return tags.some((x) => {
    return [
      "dhl",
      "دي اتش ال",
      "دي إتش إل",
      "مكتب",
      "استلام من المكتب",
      "استلام مكتب"
    ].includes(x);
  });
}


function orderTransferAmount(o){
  /*
    القاعدة النهائية:

    الكاش:
    الصافي بعد خصم التوصيل.

    المدفوع مسقط/دليلي:
    قيمة الطلب كاملة بدون خصم التوصيل.

    المدفوع مكتب/DHL:
    قيمة الطلب ناقص الشحن الخارجي.
  */
  if(isPaidSection(o?.section)){
    if(isExternalShippingOrder(o)){
      return Math.max(0, n(o?.gross) - n(o?.deliveryFee));
    }

    return n(o?.gross);
  }

  return n(o?.net);
}

function externalShippingAmount(o){
  return isPaidSection(o?.section) && isExternalShippingOrder(o)
    ? n(o?.deliveryFee)
    : 0;
}

function deliveryCoveredByCashAmount(o){
  return isPaidSection(o?.section) && !isExternalShippingOrder(o)
    ? n(o?.deliveryFee)
    : 0;
}

function financeOrderTags(o){
  if(Array.isArray(o?.tags)){
    return o.tags.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  }

  return String(o?.tags || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function isMuscatDeliveryOrder(o){
  const tags = financeOrderTags(o);

  const company = String(
    o?.shippingCompany ||
    o?.shippingTitle ||
    o?.deliveryCompany ||
    o?.shippingMethod ||
    ""
  ).toLowerCase();

  return (
    tags.includes("مسقط") ||
    tags.includes("muscat") ||
    company.includes("مسقط") ||
    company.includes("muscat")
  );
}

function paidDeliveryCashSourceKey(o){
  if(!deliveryCoveredByCashAmount(o)) return "";

  return isMuscatDeliveryOrder(o)
    ? "cashMuscat"
    : "cashDalili";
}

function deliveryCoveredByCashAmountForKey(o, key){
  return paidDeliveryCashSourceKey(o) === key
    ? deliveryCoveredByCashAmount(o)
    : 0;
}

function cashMuscatCourierAmountFromTotals(){
  const settlement = state?.summary?.totals?.settlement || {};

  if(Object.prototype.hasOwnProperty.call(settlement, "cashMuscatCourierNet")){
    return n(settlement.cashMuscatCourierNet);
  }

  const cashNet = n(getTotal("cashMuscat.net") || getTotal("cash.net"));
  const paidDelivery = n(getTotal("cashMuscat.paidDeliveryCoveredByCash"));

  return cashNet - paidDelivery;
}

function cashDaliliCourierAmountFromTotals(){
  const settlement = state?.summary?.totals?.settlement || {};

  if(Object.prototype.hasOwnProperty.call(settlement, "cashDaliliCourierNet")){
    return n(settlement.cashDaliliCourierNet);
  }

  const cashNet = n(getTotal("cashDalili.net"));
  const paidDelivery = n(getTotal("cashDalili.paidDeliveryCoveredByCash"));

  return cashNet - paidDelivery;
}

function cashMuscatCourierAmountFromRows(rows){
  return (rows || []).reduce((sum, o) => {
    const section = String(o?.section || "").toUpperCase();

    if(section === "CASH_MUSCAT" || section === "CASH"){
      return sum + n(o?.net);
    }

    return sum - deliveryCoveredByCashAmountForKey(o, "cashMuscat");
  }, 0);
}

function cashDaliliCourierAmountFromRows(rows){
  return (rows || []).reduce((sum, o) => {
    const section = String(o?.section || "").toUpperCase();

    if(section === "CASH_DALILI"){
      return sum + n(o?.net);
    }

    return sum - deliveryCoveredByCashAmountForKey(o, "cashDalili");
  }, 0);
}

function finalTransferAmountFromRows(rows){
  return (rows || []).reduce((sum, o) => {
    return sum + orderTransferAmount(o) - deliveryCoveredByCashAmount(o);
  }, 0);
}

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function escAttr(s){
  return esc(s).replaceAll("`","&#096;");
}

function pad2(x){
  return String(x).padStart(2, "0");
}

function localDateInput(daysBack = 0){
  const d = new Date();

  // نثبت الساعة وسط اليوم حتى لا يدخل اختلاف UTC أو تغيير اليوم
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - Number(daysBack || 0));

  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());

  return `${y}-${m}-${day}`;
}

function today(){
  return localDateInput(0);
}

function daysAgo(d){
  return localDateInput(d);
}

const MONEY_TZ_OFFSET_MINUTES = 240; // توقيت عُمان UTC+4

function displayLocalDate(x){
  const s = String(x || "");
  if (!s) return "";

  const d = new Date(s);

  if (Number.isNaN(d.getTime())) {
    return s.slice(0, 10);
  }

  const shifted = new Date(d.getTime() + MONEY_TZ_OFFSET_MINUTES * 60 * 1000);

  const y = shifted.getUTCFullYear();
  const m = pad2(shifted.getUTCMonth() + 1);
  const day = pad2(shifted.getUTCDate());

  return `${y}-${m}-${day}`;
}

function displayLocalDateTime(x){
  const s = String(x || "");
  if (!s) return "";

  const d = new Date(s);

  if (Number.isNaN(d.getTime())) {
    return s;
  }

  const shifted = new Date(d.getTime() + MONEY_TZ_OFFSET_MINUTES * 60 * 1000);

  const y = shifted.getUTCFullYear();
  const m = pad2(shifted.getUTCMonth() + 1);
  const day = pad2(shifted.getUTCDate());
  const hh = pad2(shifted.getUTCHours());
  const mm = pad2(shifted.getUTCMinutes());

  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function selectedDateRange(){
  return {
    from: $("#dateFrom")?.value || "",
    to: $("#dateTo")?.value || ""
  };
}

function isInsideSelectedDate(value){
  const { from, to } = selectedDateRange();
  const day = displayLocalDate(value);

  if(!day) return false;
  if(from && day < from) return false;
  if(to && day > to) return false;

  return true;
}

function filterRowsBySelectedDate(rows, field = "createdAt"){
  return (rows || []).filter((x) => {
    return isInsideSelectedDate(x?.[field]);
  });
}

function toast(type, title, msg){
  const host = $("#toasts");
  if(!host) return;

  const icon =
    type === "bad" ? ICONS.x :
    type === "warn" ? ICONS.info :
    ICONS.check;

  const div = document.createElement("div");
  div.className = `toast ${type || "good"}`;
  div.innerHTML = `
    <div class="tIcon">${icon}</div>
    <div>
      <b>${esc(title || "")}</b>
      <p>${esc(msg || "")}</p>
    </div>
  `;

  host.appendChild(div);
  setTimeout(() => div.remove(), 3600);
}

/* ======================
   Modal System
   ====================== */
function openModal({ title, sub, body, footer }){
  $("#modalTitle").textContent = title || "";
  $("#modalSub").textContent = sub || "";
  $("#modalBody").innerHTML = body || "";
  $("#modalFooter").innerHTML = footer || "";
  $("#modalBackdrop").classList.add("show");
  $("#modalBackdrop").setAttribute("aria-hidden","false");
}

function closeModal(){
  $("#modalBackdrop").classList.remove("show");
  $("#modalBackdrop").setAttribute("aria-hidden","true");
}

$("#modalClose").onclick = closeModal;

$("#modalBackdrop").addEventListener("click", (e) => {
  if(e.target.id === "modalBackdrop") closeModal();
});

document.addEventListener("keydown", (e) => {
  if(e.key === "Escape") closeModal();
});

function appConfirm({
  title = "تأكيد",
  message = "هل أنت متأكد؟",
  okText = "تأكيد",
  cancelText = "إلغاء",
  danger = false,
  warn = false
} = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      sub: "",
      body: `
        <div class="proConfirm">
          <div class="proConfirmIcon ${danger ? "danger" : warn ? "warn" : ""}">
            ${danger ? ICONS.trash : warn ? ICONS.info : ICONS.check}
          </div>

          <div class="proConfirmText">
            <h4>${esc(title)}</h4>
            <p>${esc(message)}</p>
          </div>
        </div>
      `,
      footer: `
        <button class="${danger ? "dangerBtn" : "primaryBtn"}" id="confirmOk">
          ${esc(okText)}
        </button>
        <button class="ghostBtn" id="confirmCancel">
          ${esc(cancelText)}
        </button>
      `
    });

    $("#confirmOk").onclick = () => {
      closeModal();
      resolve(true);
    };

    $("#confirmCancel").onclick = () => {
      closeModal();
      resolve(false);
    };
  });
}

function appPrompt({
  title = "إدخال",
  message = "",
  label = "القيمة",
  value = "",
  type = "text",
  placeholder = "",
  okText = "حفظ"
} = {}) {
  return new Promise((resolve) => {
    openModal({
      title,
      sub: message,
      body: `
        <div class="formGrid">
          <div class="field">
            <label>${esc(label)}</label>
            <input id="promptValue" type="${escAttr(type)}" value="${escAttr(value)}" placeholder="${escAttr(placeholder)}">
          </div>
        </div>
      `,
      footer: `
        <button class="primaryBtn" id="promptOk">${esc(okText)}</button>
        <button class="ghostBtn" id="promptCancel">إلغاء</button>
      `
    });

    setTimeout(() => $("#promptValue")?.focus(), 80);

    $("#promptOk").onclick = () => {
      const v = $("#promptValue").value;
      closeModal();
      resolve(v);
    };

    $("#promptCancel").onclick = () => {
      closeModal();
      resolve(null);
    };
  });
}

function previewReceipt(url, title = "معاينة الفاتورة") {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return;

  const isImage = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(safeUrl) || safeUrl.includes("cloudinary");

  openModal({
    title,
    sub: "يمكنك فتح الصورة في تبويب جديد",
    body: `
      <div class="imagePreviewWrap">
        ${
          isImage
            ? `
              <div class="imagePreviewFrame">
                <img src="${escAttr(safeUrl)}" alt="receipt">
              </div>
            `
            : `
              <div class="imagePreviewFrame">
                <iframe src="${escAttr(safeUrl)}" style="width:100%;height:70vh;border:0;border-radius:18px;background:#fff"></iframe>
              </div>
            `
        }

        <div class="previewActions">
          <a class="softBtn" href="${escAttr(safeUrl)}" target="_blank" rel="noreferrer">
            فتح في تبويب جديد
          </a>
        </div>
      </div>
    `,
    footer: `
      <button class="ghostBtn" id="previewClose">إغلاق</button>
    `
  });

  $("#previewClose").onclick = closeModal;
}



async function loadDelivery(){
  const q = state.delivery?.q || "";
  const p = new URLSearchParams();

  if(q) p.set("q", q);

  const data = await apiJson(`${API.deliverySummary}?${p.toString()}`);
   
  state.delivery = {
    ...state.delivery,
    ...data,
    totals: data.totals || {},
    lists: data.lists || {
      readyToSettle: [],
      deliveredAll: [],
      outForDelivery: [],
      withDriver: [],
      settled: []
    }
  };

  renderDelivery();
}

function deliveryList(name){
  return state.delivery?.lists?.[name] || [];
}

function renderDelivery(){
  const ready = deliveryList("readyToSettle");
  const done = deliveryList("deliveredAll");
  const out = deliveryList("outForDelivery");
  const driver = deliveryList("withDriver");
  const settled = deliveryList("settled");

  const readyNet = ready.reduce((s, x) => s + n(x.net), 0);
  const readyFee = ready.reduce((s, x) => s + n(x.deliveryFee), 0);

  if($("#deliveryReadyNet")) $("#deliveryReadyNet").textContent = fmt(readyNet);
  if($("#deliveryReadyCount")) $("#deliveryReadyCount").textContent = `${ready.length} طلب`;
  if($("#deliveryFeeTotal")) $("#deliveryFeeTotal").textContent = fmt(readyFee);
  if($("#deliveryDoneCount")) $("#deliveryDoneCount").textContent = done.length;
  if($("#deliveryDriverCount")) $("#deliveryDriverCount").textContent = driver.length;

  if($("#deliveryReadyMeta")) $("#deliveryReadyMeta").textContent = `${ready.length} طلب`;
  if($("#deliveryDoneMeta")) $("#deliveryDoneMeta").textContent = `${done.length} طلب`;
  if($("#deliveryOutMeta")) $("#deliveryOutMeta").textContent = `${out.length} طلب`;
  if($("#deliveryDriverMeta")) $("#deliveryDriverMeta").textContent = `${driver.length} طلب`;

  renderDeliveryBucket("deliveryReadyList", ready, "ready");
  renderDeliveryBucket("deliveryDoneList", done, "done");
  renderDeliveryBucket("deliveryOutList", out, "out");
  renderDeliveryBucket("deliveryDriverList", driver, "driver");
  renderDeliveryBucket("deliverySettledList", settled, "settled");
}
function renderDeliveryBucket(id, rows, type){
  const el = document.getElementById(id);
  if(!el) return;

  if(!rows.length){
    el.innerHTML = `<div class="emptyBox">لا توجد طلبات</div>`;
    return;
  }

  el.innerHTML = rows.map((o) => deliveryOrderCard(o, type)).join("");
}

function deliveryOrderCard(o, type){
  const orderId = o.numericId || o.id || "";
  const orderName = o.orderName || "—";
  const note = String(o.note || "").trim();

  const actions =
    type === "ready"
      ? `
        <button class="miniBtn primaryMini" onclick="settleDeliveryOrder('${escAttr(orderId)}')">
          ترحيل
        </button>
      `
      : "";

  return `
    <article class="orderCard">
      <div class="orderTop">
        <div>
          <h4>${esc(orderName)}</h4>
          <p>${esc(o.customer || "—")} | ${esc(o.phone || "—")}</p>
        </div>
        <span class="statusPill">${esc(o.statusText || "—")}</span>
      </div>

      <div class="orderMeta">
        <span class="pill">الإجمالي ${fmt(o.total)}</span>
        <span class="pill">المتبقي ${fmt(o.outstanding)}</span>
        <span class="pill">التوصيل ${fmt(o.deliveryFee)}</span>
        <span class="pill">الصافي ${fmt(o.net)}</span>
      </div>

      <div class="orderMeta">
        <span class="pill">المدينة: ${esc(o.city || "—")}</span>
        <span class="pill">شركة الشحن: ${esc(o.shippingCompany || "—")}</span>
      </div>

      ${
        note
          ? `<div class="orderNote">${esc(note)}</div>`
          : ""
      }

      <div class="orderActions">
        ${actions}
        <button class="miniBtn" onclick="editDeliveryNote('${escAttr(o.id || orderId)}', '${escAttr(note)}')">
          ملاحظة
        </button>
        <button class="miniBtn dangerMini" onclick="cancelDeliveryOrder('${escAttr(o.id || orderId)}', '${escAttr(orderName)}')">
          إلغاء من مسقط
        </button>
      </div>
    </article>
  `;
}

function normalizeDeliveryTransferId(v){
  const s = String(v || "").trim();
  if(!s) return "";

  if(s.includes("gid://")) return s.split("/").pop();

  const m = s.match(/(\d+)\s*$/);
  if(m) return m[1];

  return s.replace(/^#+/, "");
}

function deliveryReadyTransferIds(orderId = ""){
  if(orderId) return [normalizeDeliveryTransferId(orderId)].filter(Boolean);

  return deliveryList("readyToSettle")
    .map((o) => normalizeDeliveryTransferId(o.numericId || o.id || o.orderId || o.orderName))
    .filter(Boolean);
}

function idsFromDeliverySettleResponse(out = {}, fallbackIds = []){
  const raw =
    out.orderIds ||
    out.settledIds ||
    out.settledOrderIds ||
    out.ids ||
    out.orders ||
    [];

  const arr = Array.isArray(raw) ? raw : [];

  const ids = arr
    .map((x) => {
      if(typeof x === "object" && x){
        return normalizeDeliveryTransferId(
          x.numericId || x.id || x.orderId || x.orderName || x.name
        );
      }

      return normalizeDeliveryTransferId(x);
    })
    .filter(Boolean);

  return ids.length ? ids : fallbackIds;
}

async function settleDeliveryOrder(orderId = ""){
  const transferIdsBefore = deliveryReadyTransferIds(orderId);

  const ok = await appConfirm({
    title: "ترحيل طلب المندوب",
    message: orderId
      ? `سيتم ترحيل هذا الطلب للمندوب وترحيله في الحسابات مباشرة: ${orderId}`
      : `سيتم ترحيل كل الطلبات الجاهزة للمندوب وترحيلها في الحسابات مباشرة. العدد: ${transferIdsBefore.length}`,
    okText: "نعم، رحّل",
    cancelText: "إلغاء",
    danger: true
  });

  if(!ok) return;

  try{
    const body = {
      from: $("#dateFrom").value,
      to: $("#dateTo").value,
      q: state.delivery?.q || ""
    };

    if(orderId) body.orderIds = [normalizeDeliveryTransferId(orderId)];

    const out = await apiJson(API.deliverySettle, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const settledCount = n(out.settledCount || out.count || 0);
    const transferIds = idsFromDeliverySettleResponse(out, transferIdsBefore);

    let transferOut = null;

    if(settledCount > 0 && transferIds.length){
      transferOut = await apiJson(API.transfer, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
body: JSON.stringify({
  type: "ALL",
  from: $("#dateFrom").value,
  to: $("#dateTo").value,
  note: "delivery_settle_auto",
  orderIds: transferIds
})
      });
    }

    const transferredCount = n(transferOut?.transferred?.count || 0);

    toast(
      "good",
      "تم الترحيل",
      `تم ترحيل المندوب ${settledCount} طلب، وترحيل الحسابات ${transferredCount} طلب`
    );

    state.selectedOrders.clear();

    await loadDelivery();
    await loadSummary();
    await loadLedger();
    await loadArchive();
  }catch(e){
    toast("bad", "خطأ", e.message);
  }
}


async function editDeliveryNote(orderId, currentNote = ""){
  const note = await appPrompt({
    title: "ملاحظة المندوب",
    message: `الطلب: ${orderId}`,
    label: "الملاحظة",
    value: currentNote || "",
    type: "text",
    placeholder: "اكتب الملاحظة",
    okText: "حفظ"
  });

  if(note === null) return;

  try{
    await apiJson(API.deliveryNote, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, note })
    });

    toast("good", "تم", "تم تحديث الملاحظة");
    await loadDelivery();
  }catch(e){
    toast("bad", "خطأ", e.message);
  }
}

async function cancelDeliveryOrder(orderId, orderName = ""){
  const ok = await appConfirm({
    title: "إلغاء من مسقط",
    message: `هل تريد إخراج الطلب ${orderName || orderId} من حساب مسقط؟`,
    okText: "نعم، إلغاء",
    cancelText: "رجوع",
    danger: true
  });

  if(!ok) return;

  try{
    await apiJson(API.deliveryCancel, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, orderName })
    });

    toast("good", "تم", "تم إلغاء الطلب من مسقط");
    await loadDelivery();
    await loadSummary();
  }catch(e){
    toast("bad", "خطأ", e.message);
  }
}
/* ======================
   Init / Load
   ====================== */
function initDates(){
  const savedFrom = localStorage.getItem("finance_from") || "";
  const savedTo = localStorage.getItem("finance_to") || "";
  $("#dateFrom").value = savedFrom || today();
  $("#dateTo").value = savedTo || today();
}

function saveDates(){
  localStorage.setItem("finance_from", $("#dateFrom").value || "");
  localStorage.setItem("finance_to", $("#dateTo").value || "");
  state.loadedTabs.clear();
}

async function loadAll(){
  saveDates();

  try{
    await loadSummary();
    await loadActiveTabData({ force: true });
     
    toast("good","تم التحديث","تم جلب الملخص بنجاح");
  }catch(e){
    toast("bad","خطأ", e.message || String(e));
  }
}

async function loadActiveTabData({ force = false } = {}){
  const tab = state.activeTab || "dashboard";
  if (!force && state.loadedTabs.has(tab)) return;

  if (tab === "ledger") {
    await loadLedger();
  } else if (tab === "archive") {
    await loadArchive();
  } else if (tab === "delivery") {
    await loadDelivery();
  } else if (tab === "localStock") {
    await loadLocalStock();
  } else if (tab === "debts") {
    await loadDebts();
  } else if (tab === "expenses") {
    await loadExpenses();
  } else if (tab === "purchases") {
    await loadPurchases();
  }

  state.loadedTabs.add(tab);
}

async function loadSummary(){
  const data = await apiJson(`${API.summary}?${qsDates()}`);
  state.summary = data;
  state.ledger = data.ledger || state.ledger;
  state.selectedOrders.clear();

  renderDashboard();
  renderOrders();
  renderLedger();
}

async function loadArchive(){
  const data = await apiJson(`${API.archive}?${qsDates()}`);
  state.archive = data.items || [];
  renderArchive();
}

async function loadLedger(){
  const data = await apiJson(`${API.ledger}?${qsDates()}`);
  state.ledger = data;
  renderLedger();
  renderDashboard();
}

async function loadPurchases(){
  const q = qsDates();
  const data = await apiJson(`${API.purchases}${q ? "?" + q : ""}`);
  state.purchases = data;
  renderPurchases();
  renderDashboardOpsKpis();
}

async function loadDebts(){
  const data = await apiJson(API.debts);
  state.debts = data;
  renderDebts();
  renderDashboardOpsKpis();
}
async function loadExpenses(){
  const q = qsDates();
  const data = await apiJson(`${API.expenses}${q ? "?" + q : ""}`);
  state.expenses = data;
  renderExpenses();
  renderDashboardOpsKpis();
}

/* ======================
   Navigation
   ====================== */
const tabMeta = {
  dashboard: ["الملخص المالي", "متابعة كل ريال: كاش مسقط، دليلي، أموال، والبنك"],
  ledger: ["الحسابات", "دفتر الحركة والتحويلات بين دليلي / أموال / البنك"],
  orders: ["ترحيل الطلبات", "أموال / تحويل بنكي / كاش مسقط / كاش دليلي"],
  archive: ["أرشيف الترحيل", "عرض كل الدفعات المرحلة وتحميلها Excel"],
     delivery: ["صفحة المندوب", "طلبات توصيل مسقط وتسوية مبالغ المندوب"],
   localStock: ["المخزون المحلي", "اطلاع / تعديل أسعار / ترحيل كاش مسقط"],
  expenses: ["الصرفيات", "إضافة صرفيات تخصم مباشرة من الحساب"],
  purchases: ["المشتريات", "إضافة مشتريات المنتجات وخصمها من الحساب"],
  debts: ["ديون التجار", "إضافة وسداد وترتيب ديون التجار باحتراف"]
};

function setTab(tab){
  state.activeTab = tab;

  $$(".navBtn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  $$("[data-panel]").forEach((p) => {
    p.classList.toggle("show", p.dataset.panel === tab);
  });

  const [title, sub] = tabMeta[tab] || tabMeta.dashboard;

  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub;

  loadActiveTabData().catch((e) => toast("bad", "خطأ", e.message));

  document.body.classList.remove("menuOpen");
}


$$(".navBtn").forEach((b) => {
  b.addEventListener("click", () => setTab(b.dataset.tab));
});

$("#btnMobileMenu").addEventListener("click", () => {
  document.body.classList.toggle("menuOpen");
});

$("#btnGoOrders").addEventListener("click", () => setTab("orders"));

const btnGoLedger = $("#btnGoLedger");
if(btnGoLedger) btnGoLedger.addEventListener("click", () => setTab("ledger"));

/* ======================
   Dashboard
   ====================== */
function getTotal(path){
  const totals = state?.summary?.totals || {};

  return String(path || "")
    .split(".")
    .reduce((obj, key) => {
      return obj && obj[key] !== undefined ? obj[key] : 0;
    }, totals) || 0;
}

function renderDashboard(){
  const cashMuscatGross = cashMuscatCourierAmountFromTotals();
  const cashMuscatCount = n(getTotal("cashMuscat.count") || getTotal("cash.count"));

  const cashDaliliGross = cashDaliliCourierAmountFromTotals();
  const cashDaliliCount = n(getTotal("cashDalili.count"));

  const amwalGross = n(getTotal("amwal.gross"));
  const amwalCount = n(getTotal("amwal.count"));

  const bankGross = n(getTotal("bank.gross"));
  const bankCount = n(getTotal("bank.count"));

const delivery = n(getTotal("all.delivery"));
const totalBeforeDelivery = cashMuscatGross + cashDaliliGross + amwalGross + bankGross;

const settlementTransferTotal = n(getTotal("settlement.allTransferAmount"));

const totalAfterDelivery = settlementTransferTotal > 0
  ? settlementTransferTotal
  : Math.max(0, totalBeforeDelivery - delivery);

   
  $("#kpiCash").textContent = fmt(cashMuscatGross);
  $("#kpiCashCount").textContent = `${cashMuscatCount} طلب كاش مسقط + خصم توصيل المدفوع`;

  const kpiCashDalili = $("#kpiCashDalili");
  if(kpiCashDalili) kpiCashDalili.textContent = fmt(cashDaliliGross);

  const kpiCashDaliliCount = $("#kpiCashDaliliCount");
  if(kpiCashDaliliCount) kpiCashDaliliCount.textContent = `${cashDaliliCount} طلب دليلي + خصم توصيل المدفوع`;

  $("#kpiAmwal").textContent = fmt(amwalGross);
  $("#kpiAmwalCount").textContent = `${amwalCount} طلب`;

  $("#kpiBank").textContent = fmt(bankGross);
  $("#kpiBankCount").textContent = `${bankCount} طلب`;

  $("#kpiDelivery").textContent = fmt(delivery);

  $("#kpiNet").textContent = fmt(totalAfterDelivery);
  $("#kpiAllCount").textContent = `${getTotal("all.count")} طلب غير مرحّل`;

  renderLedgerMiniCards();
  renderDashboardOpsKpis();
  renderBars();
  renderRecent();
}


function renderDashboardOpsKpis(){
  const expensesItems = state.expenses?.items || [];
  const purchasesItems = state.purchases?.items || [];
  const debtItems = state.debts?.items || [];

  const expensesTotal = n(state.expenses?.total || 0);
  const purchasesTotal = n(state.purchases?.total || 0);
  const debtsTotal = n(state.debts?.total || state.ledger?.debtsTotal || 0);

  const kpiExpenses = $("#kpiExpenses");
  const kpiExpensesCount = $("#kpiExpensesCount");
  const kpiPurchases = $("#kpiPurchases");
  const kpiPurchasesCount = $("#kpiPurchasesCount");
  const kpiDebts = $("#kpiDebts");
  const kpiDebtsCount = $("#kpiDebtsCount");

  if(kpiExpenses) kpiExpenses.textContent = fmt(expensesTotal);
  if(kpiExpensesCount) kpiExpensesCount.textContent = `${expensesItems.length} صرفية`;

  if(kpiPurchases) kpiPurchases.textContent = fmt(purchasesTotal);
  if(kpiPurchasesCount) kpiPurchasesCount.textContent = `${purchasesItems.length} عملية مشتريات`;

  if(kpiDebts) kpiDebts.textContent = fmt(debtsTotal);
  if(kpiDebtsCount) kpiDebtsCount.textContent = `${debtItems.length} تاجر`;
}


function ledgerBalances(){
  return state.ledger?.balances || state.summary?.ledger?.balances || {};
}

function renderLedgerMiniCards(){
  const host = $("#ledgerBalanceCards");
  if(!host) return;

  const b = ledgerBalances();

  host.innerHTML = `
    <div class="summaryChip"><span>كاش مسقط فعلي</span><b>${fmt(b.cash_muscat)}</b></div>
    <div class="summaryChip"><span>مستحق دليلي</span><b>${fmt(b.dalili_pending)}</b></div>
    <div class="summaryChip"><span>مستحق أموال</span><b>${fmt(b.amwal_pending)}</b></div>
    <div class="summaryChip"><span>الحساب البنكي</span><b>${fmt(b.bank)}</b></div>
    <div class="summaryChip"><span>المتاح فعلياً</span><b>${fmt(b.total_available)}</b></div>
    <div class="summaryChip"><span>الإجمالي مع المستحقات</span><b>${fmt(b.total_all)}</b></div>
  `;
}

function renderBars(){
  const cashMuscatGross = cashMuscatCourierAmountFromTotals();
  const cashDaliliGross = cashDaliliCourierAmountFromTotals();
  const amwalGross = n(getTotal("amwal.gross"));
  const bankGross = n(getTotal("bank.gross"));

  const total = Math.max(1, cashMuscatGross + cashDaliliGross + amwalGross + bankGross);

  const rows = [
    ["كاش مسقط", cashMuscatGross],
    ["كاش دليلي", cashDaliliGross],
    ["أمـوال", amwalGross],
    ["تحويل بنكي", bankGross]
  ];

  $("#summaryBars").innerHTML = rows.map(([label, value]) => {
    const pct = Math.min(100, Math.round((n(value) / total) * 100));

    return `
      <div class="barItem">
        <div class="barTop">
          <span>${esc(label)}</span>
          <b>${fmt(value)} — ${pct}%</b>
        </div>
        <div class="barTrack">
          <div class="barFill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");
}

function allCurrentRows(){
  const l = state.summary.lists || {};

  return [
    ...(l.cashMuscat || []),
    ...(l.cashDalili || []),
    ...(l.cash || []).filter((x) => !["CASH_MUSCAT","CASH_DALILI"].includes(String(x.section || ""))),
    ...(l.amwal || []),
    ...(l.bank || [])
  ];
}
function renderRecent(){
  const rows = allCurrentRows()
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 8);

  $("#recentOrders").innerHTML = rows.length
    ? rows.map((o) => {
      const fullAmount = n(o.gross || o.total || 0);

      return `
        <div class="miniOrder">
          <div>
            <b>${esc(o.orderName)}</b>
            <small>
              ${esc(sectionName(o.section))}
              |
              ${esc(o.statusText)}
              |
              ${esc(displayLocalDate(o.createdAt))}
              |
              الشحن ${fmt(o.deliveryFee)}
            </small>
          </div>
          <b>${fmt(fullAmount)}</b>
        </div>
      `;
    }).join("")
    : `<div class="emptyState">لا توجد طلبات غير مرحلة</div>`;
}

/* ======================
   Orders
   ====================== */
function sectionName(sec){
  if(sec === "AMWAL") return "أمـوال";
  if(sec === "BANK") return "تحويل بنكي";
  if(sec === "CASH_MUSCAT") return "كاش مسقط";
  if(sec === "CASH_DALILI") return "كاش دليلي";
  if(sec === "CASH") return "كاش";
  return sec || "—";
}

function accountName(acc){
  const a = String(acc || "").toLowerCase();
  if(a === "cash_muscat" || acc === "CASH_MUSCAT") return "كاش مسقط";
  if(a === "dalili_pending" || acc === "DALILI" || acc === "CASH_DALILI") return "مستحق دليلي";
  if(a === "amwal_pending" || acc === "AMWAL") return "مستحق أموال";
  if(a === "bank" || acc === "BANK") return "الحساب البنكي";
  return acc || "";
}

function normalizeOrderSearch(v){
  return String(v || "")
    .trim()
    .replace(/^#+/, "")
    .toLowerCase();
}

function orderMatchesSearch(o, q){
  const clean = normalizeOrderSearch(q);
  if(!clean) return true;

  const orderName = String(o.orderName || "").toLowerCase();
  const orderNameNoHash = orderName.replace(/^#+/, "");
  const numericId = String(o.numericId || "").toLowerCase();
  const id = String(o.id || "").toLowerCase();

  return (
    orderName.includes(clean) ||
    orderNameNoHash.includes(clean) ||
    numericId.includes(clean) ||
    id.includes(clean)
  );
}

function filterOrdersForSearch(rows){
  return (rows || []).filter((o) => orderMatchesSearch(o, state.orderSearch || ""));
}

function renderOrders(){
  const lists = state.summary.lists || {};

  const cashAll = lists.cash || [];

  const cashMuscatBase = (lists.cashMuscat || []).length
    ? (lists.cashMuscat || [])
    : cashAll.filter((x) => String(x.section || "") === "CASH_MUSCAT" || String(x.section || "") === "CASH");

  const cashDaliliBase = (lists.cashDalili || []).length
    ? (lists.cashDalili || [])
    : cashAll.filter((x) => String(x.section || "") === "CASH_DALILI");

  const amwalRows = filterOrdersForSearch(lists.amwal || []);
  const bankRows = filterOrdersForSearch(lists.bank || []);
  const cashMuscatRows = filterOrdersForSearch(cashMuscatBase);
  const cashDaliliRows = filterOrdersForSearch(cashDaliliBase);
   
  renderBucket("AMWAL", amwalRows, "#ordersAmwal", "#amwalMeta");
  renderBucket("BANK", bankRows, "#ordersBank", "#bankMeta");
  renderBucket("CASH_MUSCAT", cashMuscatRows, "#ordersCashMuscat", "#cashMuscatMeta");
  renderBucket("CASH_DALILI", cashDaliliRows, "#ordersCashDalili", "#cashDaliliMeta");

  if(state.orderSearch){
    $("#amwalMeta").textContent += " | نتائج البحث";
    $("#bankMeta").textContent += " | نتائج البحث";
    $("#cashMuscatMeta").textContent += " | نتائج البحث";
    $("#cashDaliliMeta").textContent += " | نتائج البحث";
  }
}

function renderBucket(section, rows, bodySel, metaSel){
  rows = [...(rows || [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const transferTotal = rows.reduce((s,x) => s + orderTransferAmount(x), 0);
const delivery = rows.reduce((s,x) => s + n(x.deliveryFee), 0);
const externalShipping = rows.reduce((s,x) => s + externalShippingAmount(x), 0);
const coveredByCash = rows.reduce((s,x) => s + deliveryCoveredByCashAmount(x), 0);

$(metaSel).textContent =
  `${rows.length} طلب | مبلغ الترحيل ${fmt(transferTotal)} | توصيل محسوب من الكاش ${fmt(coveredByCash)} | شحن خارجي مخصوم ${fmt(externalShipping)} | شحن ${fmt(delivery)}`;
   
  $(bodySel).innerHTML = rows.length
    ? rows.map((o) => orderCard(o)).join("")
    : `<div class="emptyState">لا توجد طلبات</div>`;

  $$(bodySel + " .orderChk").forEach((c) => {
    c.addEventListener("change", () => {
      if(c.checked) state.selectedOrders.add(c.value);
      else state.selectedOrders.delete(c.value);

      c.closest(".orderCard")?.classList.toggle("selected", c.checked);
    });
  });
}

function orderCard(o){
  const selected = state.selectedOrders.has(String(o.numericId));
const transferAmount = orderTransferAmount(o);
const paidSection = isPaidSection(o.section);
const isExternalShipping = paidSection && isExternalShippingOrder(o);
const externalShipping = externalShippingAmount(o);
const coveredByCash = deliveryCoveredByCashAmount(o);
   
  const statusClass =
    o.financialStatus === "PAID" ? "good" :
    o.financialStatus === "PARTIALLY_PAID" ? "warn" : "bad";

  return `
    <article class="orderCard ${selected ? "selected" : ""}">
      <div class="orderTop">
        <div class="orderTitle">
          <input class="chk orderChk" type="checkbox" value="${escAttr(o.numericId)}" ${selected ? "checked" : ""}>
          <div>
            <b>${esc(o.orderName)}</b>
            <small>${esc(o.customer || "—")} | ${esc(displayLocalDateTime(o.createdAt))}</small>
          </div>
        </div>

<div class="orderAmount">
  <b>${fmt(transferAmount)}</b>
  <small>${paidSection ? "للترحيل" : "الصافي"}</small>
</div>
</div>

      <div class="orderMeta">
        <span class="pill purple">${esc(sectionName(o.section))}</span>
        <span class="pill ${statusClass}">${esc(o.statusText)}</span>
        <span class="pill">الإجمالي ${fmt(o.total)}</span>
        <span class="pill">المدفوع ${fmt(o.paid)}</span>
        <span class="pill">المتبقي ${fmt(o.outstanding)}</span>
        <span class="pill">الشحن ${fmt(o.deliveryFee)}</span>
${
  paidSection
    ? (
        isExternalShipping
          ? `<span class="pill warn">شحن خارجي مخصوم ${fmt(externalShipping)}</span>`
          : `<span class="pill good">التوصيل ${fmt(coveredByCash)} محسوب من الكاش</span>`
      )
    : ""
}

<span class="pill">شركة ${esc(o.shippingCompany || "—")}</span>
      </div>

      <div class="orderMeta">
        <span class="pill">بوابة: ${esc(o.gateway || "—")}</span>
        <span class="pill">تاقات: ${esc((o.tags || []).join(", ") || "—")}</span>
      </div>

      <div class="orderActions">
        <button class="miniBtn" onclick="editShipping('${escAttr(o.numericId)}', ${n(o.deliveryFee)})">تعديل الشحن</button>
        <button class="miniBtn primaryMini" onclick="transferSingle('${escAttr(o.numericId)}', '${escAttr(o.section)}')">ترحيل الطلب</button>
      </div>
    </article>
  `;
}

function selectedIdsBySection(section){
  const lists = state.summary.lists || {};
  const rows =
    section === "AMWAL" ? lists.amwal || [] :
    section === "BANK" ? lists.bank || [] :
    section === "CASH_MUSCAT" ? lists.cashMuscat || [] :
    section === "CASH_DALILI" ? lists.cashDalili || [] :
    section === "CASH" ? lists.cash || [] :
    allCurrentRows();


  const idsInSection = new Set(rows.map((x) => String(x.numericId)));
  return Array.from(state.selectedOrders).filter((id) => idsInSection.has(String(id)));
}

async function editShipping(orderId, currentFee){
  const v = await appPrompt({
    title: "تعديل مبلغ التوصيل",
    message: `الطلب: ${orderId}`,
    label: "مبلغ التوصيل",
    value: String(n(currentFee)),
    type: "number",
    placeholder: "0.000",
    okText: "حفظ التعديل"
  });

  if(v === null) return;

  try{
    await apiJson(API.shipping, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ orderId, fee: n(v) })
    });

    toast("good","تم","تم تعديل مبلغ التوصيل");
    await loadSummary();
  }catch(e){
    toast("bad","خطأ", e.message);
  }
}

async function transferSingle(orderId, section){
  await transferOrders(section, [orderId]);
}

async function transferOrders(type, ids = null){
  let orderIds = ids || selectedIdsBySection(type);

if (!orderIds.length && state.orderSearch) {
  const lists = state.summary.lists || {};

  const visibleRows =
    type === "AMWAL" ? filterOrdersForSearch(lists.amwal || []) :
    type === "BANK" ? filterOrdersForSearch(lists.bank || []) :
    type === "CASH_MUSCAT" ? filterOrdersForSearch(lists.cashMuscat || []) :
    type === "CASH_DALILI" ? filterOrdersForSearch(lists.cashDalili || []) :
    type === "CASH" ? filterOrdersForSearch(lists.cash || []) :
    filterOrdersForSearch(allCurrentRows());

  orderIds = visibleRows
    .map((x) => String(x.numericId))
    .filter(Boolean);
}

const lists = state.summary.lists || {};

const visibleRowsForTransfer =
  type === "AMWAL" ? (lists.amwal || []) :
  type === "BANK" ? (lists.bank || []) :
  type === "CASH_MUSCAT" ? (lists.cashMuscat || []) :
  type === "CASH_DALILI" ? (lists.cashDalili || []) :
  type === "CASH" ? (lists.cash || []) :
  allCurrentRows();

const transferRowsForMessage = orderIds.length
  ? visibleRowsForTransfer.filter((x) => orderIds.includes(String(x.numericId)))
  : visibleRowsForTransfer;

const transferTotalForMessage = transferRowsForMessage.reduce((s, x) => {
  return s + orderTransferAmount(x);
}, 0);

const externalShippingForMessage = transferRowsForMessage.reduce((s, x) => {
  return s + externalShippingAmount(x);
}, 0);

const coveredByCashForMessage = transferRowsForMessage.reduce((s, x) => {
  return s + deliveryCoveredByCashAmount(x);
}, 0);

const finalTransferForMessage = finalTransferAmountFromRows(transferRowsForMessage);
   
const message = orderIds.length
  ? `سيتم ترحيل ${orderIds.length} طلب من قسم ${sectionName(type)}. مبلغ الحسابات قبل خصم كاش المندوب: ${fmt(transferTotalForMessage)} ر.ع. توصيل يخصم من كاش مسقط: ${fmt(coveredByCashForMessage)} ر.ع. الصافي النهائي: ${fmt(finalTransferForMessage)} ر.ع. شحن خارجي مخصوم: ${fmt(externalShippingForMessage)} ر.ع.`
  : `لم تحدد طلبات، سيتم ترحيل قسم ${sectionName(type)} كامل. مبلغ الحسابات قبل خصم كاش المندوب: ${fmt(transferTotalForMessage)} ر.ع. توصيل يخصم من كاش مسقط: ${fmt(coveredByCashForMessage)} ر.ع. الصافي النهائي: ${fmt(finalTransferForMessage)} ر.ع. شحن خارجي مخصوم: ${fmt(externalShippingForMessage)} ر.ع.`;   
  const ok = await appConfirm({
    title: "تأكيد الترحيل",
    message,
    okText: "نعم، رحّل",
    cancelText: "إلغاء",
    danger: true
  });

  if(!ok) return;

  try{
    const payload = {
      type,
      from: $("#dateFrom").value,
      to: $("#dateTo").value,
      note: "manual"
    };

    if(orderIds.length) payload.orderIds = orderIds;

    const out = await apiJson(API.transfer, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    toast("good","تم الترحيل",`تم ترحيل ${out.transferred?.count || 0} طلب`);
    await loadAll();
  }catch(e){
    toast("bad","فشل الترحيل", e.message);
  }
}

$$("[data-transfer-section]").forEach((b) => {
  b.onclick = () => transferOrders(b.dataset.transferSection);
});

$$("[data-select-all]").forEach((b) => {
  b.onclick = () => {
    const sec = b.dataset.selectAll;
    const lists = state.summary.lists || {};
    let rows =
      sec === "AMWAL" ? lists.amwal || [] :
      sec === "BANK" ? lists.bank || [] :
      sec === "CASH_MUSCAT" ? lists.cashMuscat || [] :
      sec === "CASH_DALILI" ? lists.cashDalili || [] :
      lists.cash || [];

    const allSelected = rows.every((x) => state.selectedOrders.has(String(x.numericId)));

    for(const r of rows){
      if(allSelected) state.selectedOrders.delete(String(r.numericId));
      else state.selectedOrders.add(String(r.numericId));
    }

    renderOrders();
  };
});

$("#btnTransferAll").onclick = () => transferOrders("ALL");

const orderSearchInput = $("#orderSearchInput");
const btnClearOrderSearch = $("#btnClearOrderSearch");

if(orderSearchInput){
  orderSearchInput.addEventListener("input", debounce((e) => {
    state.orderSearch = e.target.value || "";
    renderOrders();
  }, 160));
}

if(btnClearOrderSearch){
  btnClearOrderSearch.onclick = () => {
    state.orderSearch = "";
    if(orderSearchInput) orderSearchInput.value = "";
    renderOrders();
  };
}

const deliverySearchInput = $("#deliverySearchInput");
const btnDeliveryClearSearch = $("#btnDeliveryClearSearch");
const btnDeliveryRefresh = $("#btnDeliveryRefresh");
const btnDeliverySettleAll = $("#btnDeliverySettleAll");
const btnDeliverySettleReady = $("#btnDeliverySettleReady");

if(deliverySearchInput){
  deliverySearchInput.addEventListener("input", debounce((e) => {
    state.delivery.q = e.target.value || "";
    loadDelivery().catch((err) => toast("bad", "خطأ", err.message));
  }, 250));

  deliverySearchInput.addEventListener("keydown", (e) => {
    if(e.key === "Enter"){
      state.delivery.q = deliverySearchInput.value || "";
      loadDelivery().catch((err) => toast("bad", "خطأ", err.message));
    }
  });
}

if(btnDeliveryClearSearch){
  btnDeliveryClearSearch.onclick = () => {
    state.delivery.q = "";
    if(deliverySearchInput) deliverySearchInput.value = "";
    loadDelivery().catch((err) => toast("bad", "خطأ", err.message));
  };
}

if(btnDeliveryRefresh){
  btnDeliveryRefresh.onclick = () => {
    loadDelivery().catch((err) => toast("bad", "خطأ", err.message));
  };
}

if(btnDeliverySettleAll){
  btnDeliverySettleAll.onclick = () => settleDeliveryOrder("");
}

if(btnDeliverySettleReady){
  btnDeliverySettleReady.onclick = () => settleDeliveryOrder("");
}


$("#btnExportCurrent").onclick = () => exportCurrent();

/* ======================
   Ledger / Accounts
   ====================== */
function movementTypeName(t){
  const x = String(t || "").toUpperCase();
if(x === "COURIER_DELIVERY_FEE") return "خصم توصيل المندوب";
  if(x === "SETTLEMENT") return "تحويل للبنك";
   if(x === "MANUAL_ADD") return "إضافة مبلغ";
  if(x === "EXPENSE") return "صرفية";
  if(x === "PURCHASE") return "مشتريات";
  if(x === "DEBT_PAY") return "سداد دين";
  return x || "حركة";
}

function renderLedger(){
  const hostSummary = $("#ledgerSummary");
  const hostTable = $("#ledgerTable");
  if(!hostSummary || !hostTable) return;

  const b = ledgerBalances();
  const totals = state.ledger?.totals || {};
  const entries = state.ledger?.entries || state.summary?.ledger?.entries || [];

  hostSummary.innerHTML = `
    <div class="summaryChip"><span>كاش مسقط</span><b>${fmt(b.cash_muscat)}</b></div>
    <div class="summaryChip"><span>مستحق دليلي</span><b>${fmt(b.dalili_pending)}</b></div>
    <div class="summaryChip"><span>مستحق أموال</span><b>${fmt(b.amwal_pending)}</b></div>
    <div class="summaryChip"><span>الحساب البنكي</span><b>${fmt(b.bank)}</b></div>
    <div class="summaryChip"><span>مصروفات الفترة</span><b>${fmt(totals.expenses)}</b></div>
    <div class="summaryChip"><span>مشتريات الفترة</span><b>${fmt(totals.purchases)}</b></div>
    <div class="summaryChip"><span>خصم توصيل المندوب</span><b>${fmt(totals.courier_delivery_fees)}</b></div>
    <div class="summaryChip"><span>إجمالي الديون الحالية</span><b>${fmt(state.ledger?.debtsTotal || state.debts?.total)}</b></div>
  `;

  hostTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>التاريخ</th>
          <th>العملية</th>
          <th>من</th>
          <th>إلى</th>
          <th>المبلغ</th>
          <th>ملاحظة</th>
        </tr>
      </thead>
      <tbody>
        ${
          entries.length
            ? entries.map((x) => `
              <tr>
                <td>${esc(displayLocalDate(x.at))}</td>
                <td>${esc(movementTypeName(x.type))}</td>
                <td>${esc(x.fromLabel || "—")}</td>
                <td>${esc(x.toLabel || "—")}</td>
                <td><b>${fmt(x.amount)}</b></td>
                <td>${esc(x.note || x.refId || "—")}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="6"><div class="emptyState">لا توجد حركات في الفترة المحددة</div></td></tr>`
        }
      </tbody>
    </table>
  `;
}

function openSettleModal(source){
  const isAmwal = source === "AMWAL";
  const title = isAmwal ? "تسجيل تحويل أموال للبنك" : "تسجيل تحويل دليلي للبنك";
  const balance = isAmwal ? ledgerBalances().amwal_pending : ledgerBalances().dalili_pending;

  openModal({
    title,
    sub: `المستحق الحالي: ${fmt(balance)}`,
    body: `
      <div class="formGrid">
        <div class="field">
          <label>المبلغ الذي وصل البنك</label>
          <input id="mSettleAmount" type="number" step="0.001" placeholder="0.000">
        </div>

        <div class="field">
          <label>ملاحظة اختيارية</label>
          <textarea id="mSettleNote" placeholder="مثلاً: تحويل دفعة يوم الأحد"></textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="primaryBtn" id="mSaveSettle">تسجيل التحويل</button>
      <button class="ghostBtn" id="mCancel">إلغاء</button>
    `
  });

  $("#mCancel").onclick = closeModal;
  $("#mSaveSettle").onclick = async () => {
    const amount = n($("#mSettleAmount").value);
    const note = ($("#mSettleNote").value || "").trim();

    if(!(amount > 0)){
      toast("warn","ناقص","أدخل مبلغ صحيح");
      return;
    }

    try{
      await apiJson(API.settle, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ source, amount, note })
      });

      closeModal();
      toast("good","تم","تم تسجيل التحويل إلى الحساب البنكي");
      await loadLedger();
    }catch(e){
      toast("bad","خطأ", e.message);
    }
  };
}

function openManualAddModal(){
  openModal({
    title: "إضافة مبلغ",
    sub: "أضف مبلغ جانبي إلى كاش مسقط أو الحساب البنكي مع السبب",
    body: `
      <div class="formGrid">
        <div class="field">
          <label>الحساب</label>
          <select id="manualAddAccount">
            <option value="CASH_MUSCAT">كاش مسقط</option>
            <option value="BANK">الحساب البنكي</option>
          </select>
        </div>

        <div class="field">
          <label>المبلغ</label>
          <input id="manualAddAmount" type="number" step="0.001" min="0" placeholder="0.000">
        </div>

        <div class="field">
          <label>السبب</label>
          <textarea id="manualAddNote" placeholder="مثلاً: مبلغ جانبي / تصحيح حساب / استرجاع"></textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="primaryBtn" id="manualAddSave">إضافة المبلغ</button>
      <button class="ghostBtn" id="manualAddCancel">إلغاء</button>
    `
  });

  $("#manualAddCancel").onclick = closeModal;

  $("#manualAddSave").onclick = async () => {
    const account = $("#manualAddAccount").value;
    const amount = n($("#manualAddAmount").value);
    const note = ($("#manualAddNote").value || "").trim();

    if(!(amount > 0)){
      toast("warn", "ناقص", "أدخل مبلغ صحيح");
      return;
    }

    if(!note){
      toast("warn", "ناقص", "اكتب سبب الإضافة");
      return;
    }

    try{
      await apiJson(API.manualAdd, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          amount,
          note
        })
      });

      closeModal();
      toast("good", "تم", "تمت إضافة المبلغ للحساب");

      await loadLedger();
      await loadSummary();
    }catch(e){
      toast("bad", "خطأ", e.message);
    }
  };
}

const btnSettleAmwal = $("#btnSettleAmwal");
if(btnSettleAmwal) btnSettleAmwal.onclick = () => openSettleModal("AMWAL");

const btnSettleDalili = $("#btnSettleDalili");
if(btnSettleDalili) btnSettleDalili.onclick = () => openSettleModal("DALILI");

const btnManualAdd = $("#btnManualAdd");
if(btnManualAdd) btnManualAdd.onclick = openManualAddModal;

const btnExportLedger = $("#btnExportLedger");
if(btnExportLedger){
  btnExportLedger.onclick = () => exportExcel("ledger-movements", ledgerRowsForExcel());
}

/* ======================
   Archive
   ====================== */
function renderArchive(){
  const rows = state.archive || [];

  $("#archiveList").innerHTML = rows.length
    ? rows.map((a) => `
      <article class="archiveCard">
        <div class="archiveTop">
          <div>
            <h4>${esc(sectionName(a.type))} — ${esc(a.id)}</h4>
            <p>${esc(a.at || "")} | من ${esc(a.from || "—")} إلى ${esc(a.to || "—")} | ${esc(a.note || "")}</p>
          </div>

          <div class="topActions">
            <button class="miniBtn" onclick="viewArchive('${escAttr(a.id)}')">
              <span class="ico">${ICONS.eye}</span>
              عرض
            </button>
            <button class="miniBtn primaryMini" onclick="exportArchiveBatch('${escAttr(a.id)}')">
              Excel
            </button>
          </div>
        </div>

        <div class="archiveStats">
          <div class="archiveStat"><span>عدد الطلبات</span><b>${n(a.count)}</b></div>
          <div class="archiveStat"><span>الإجمالي</span><b>${fmt(a.totals?.all?.gross)}</b></div>
          <div class="archiveStat"><span>التوصيل</span><b>${fmt(a.totals?.all?.delivery)}</b></div>
          <div class="archiveStat"><span>الصافي</span><b>${fmt(a.totals?.all?.net)}</b></div>
<div class="archiveStat"><span>مبلغ الترحيل النهائي</span><b>${fmt(a.totals?.settlement?.allTransferAmount || a.totals?.all?.net)}</b></div>
<div class="archiveStat"><span>كاش مسقط من المندوب</span><b>${fmt(a.totals?.settlement?.cashMuscatCourierNet)}</b></div>
<div class="archiveStat"><span>توصيل يخصم من كاش مسقط</span><b>${fmt(a.totals?.settlement?.paidDeliveryCoveredByCash)}</b></div>
<div class="archiveStat"><span>شحن خارجي مخصوم</span><b>${fmt(a.totals?.settlement?.paidExternalShippingDeducted)}</b></div>
</div>

        ${
          (a.failures || []).length
            ? `<div class="pill bad" style="margin-top:10px">ملاحظات فشل: ${a.failures.length}</div>`
            : ""
        }
      </article>
    `).join("")
    : `<div class="emptyState">لا يوجد أرشيف حسب التاريخ المحدد</div>`;
}

function viewArchive(id){
  const a = (state.archive || []).find((x) => x.id === id);
  if(!a) return;

  openModal({
    title: "تفاصيل الأرشيف",
    sub: `${sectionName(a.type)} | ${a.at}`,
    body: `
      <div class="detailsBox">
        <div class="detailRow"><span>عدد الطلبات</span><b>${n(a.count)}</b></div>
        <div class="detailRow"><span>الإجمالي</span><b>${fmt(a.totals?.all?.gross)}</b></div>
        <div class="detailRow"><span>التوصيل</span><b>${fmt(a.totals?.all?.delivery)}</b></div>
        <div class="detailRow"><span>الصافي</span><b>${fmt(a.totals?.all?.net)}</b></div>
      </div>

      <div style="height:12px"></div>

      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>الطلب</th>
              <th>القسم</th>
              <th>الحالة</th>
              <th>الإجمالي</th>
              <th>الشحن</th>
              <th>الصافي</th>
            </tr>
          </thead>
          <tbody>
            ${(a.orders || []).map((o) => `
              <tr>
                <td>${esc(o.orderName)}</td>
                <td>${esc(sectionName(o.section))}</td>
                <td>${esc(o.statusText)}</td>
                <td>${fmt(o.gross)}</td>
                <td>${fmt(o.deliveryFee)}</td>
                <td>${fmt(o.net)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      ${
        (a.failures || []).length
          ? `
            <h4>ملاحظات الفشل</h4>
            <div class="detailsBox">
              ${a.failures.map((f) => `
                <div class="detailRow">
                  <span>${esc(f.orderName)} — ${esc(f.step)}</span>
                  <b>${esc(f.error)}</b>
                </div>
              `).join("")}
            </div>
          `
          : ""
      }
    `,
    footer: `
      <button class="primaryBtn" id="mExportArchive">تحميل Excel</button>
      <button class="ghostBtn" id="mClose">إغلاق</button>
    `
  });

  $("#mClose").onclick = closeModal;
  $("#mExportArchive").onclick = () => exportArchiveBatch(id);
}

/* ======================
   Expenses
   ====================== */
function renderExpenses(){
  const rows = state.expenses.items || [];

  $("#expensesSummary").innerHTML = `
    <div class="summaryChip"><span>عدد الصرفيات</span><b>${rows.length}</b></div>
    <div class="summaryChip"><span>الإجمالي</span><b>${fmt(state.expenses.total)}</b></div>
    <div class="summaryChip"><span>تأثيرها</span><b>خصم مباشر</b></div>
  `;

  $("#expensesTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الفاتورة</th>
          <th>السبب</th>
          <th>المصدر</th>
          <th>المبلغ</th>
          <th>التاريخ</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows.map((x) => `
              <tr>
                <td>
                  ${
                    x.receiptUrl
                      ? `
                        <img
                          class="receiptThumb"
                          src="${escAttr(x.receiptUrl)}"
                          alt="receipt"
                          onclick="previewReceipt('${escAttr(x.receiptUrl)}','فاتورة: ${escAttr(x.reason || "")}')"
                        >
                      `
                      : `<div class="receiptEmpty">لا يوجد</div>`
                  }
                </td>

                <td>${esc(x.reason)}</td>
                <td>${esc(x.sourceLabel || accountName(x.source) || "الحساب البنكي")}</td>
                <td><b>${fmt(x.amount)}</b></td>
                <td>${esc(displayLocalDate(x.at))}</td>
              </tr>
            `).join("")
            : `<tr><td colspan="5"><div class="emptyState">لا توجد صرفيات</div></td></tr>`
        }
      </tbody>
    </table>
  `;
}

$("#btnAddExpense").onclick = () => {
  openModal({
    title:"إضافة صرفية",
    sub:"أدخل المبلغ والسبب ويمكنك رفع صورة إيصال",
    body: `
      <div class="formGrid">
        <div class="field">
          <label>المبلغ</label>
          <input id="mExpAmount" type="number" step="0.001" placeholder="0.000">
        </div>

        <div class="field">
          <label>مصدر الدفع</label>
          <select id="mExpSource">
            <option value="BANK" selected>الحساب البنكي</option>
            <option value="CASH_MUSCAT">كاش مسقط</option>
          </select>
        </div>

        <div class="field">
          <label>السبب</label>
          <textarea id="mExpReason" placeholder="سبب الصرفية"></textarea>
        </div>

        <div class="field">
          <label>مرفق اختياري</label>
          <input id="mExpFile" type="file" accept="image/*">
        </div>
      </div>
    `,
    footer: `
      <button class="primaryBtn" id="mSaveExpense">حفظ الصرفية</button>
      <button class="ghostBtn" id="mCancel">إلغاء</button>
    `
  });

  $("#mCancel").onclick = closeModal;
  $("#mSaveExpense").onclick = saveExpense;
};

async function saveExpense(){
  const amount = n($("#mExpAmount").value);
  const reason = ($("#mExpReason").value || "").trim();
  const file = $("#mExpFile").files?.[0];
  const source = $("#mExpSource")?.value || "BANK";

  if(!(amount > 0)){
    toast("warn","ناقص","أدخل مبلغ صحيح");
    return;
  }

  if(!reason){
    toast("warn","ناقص","أدخل سبب الصرفية");
    return;
  }

  try{
    const fd = new FormData();
    fd.append("amount", String(amount));
    fd.append("reason", reason);
    fd.append("source", source);
    if(file) fd.append("receipt", file);

    await apiJson(API.expenseAdd, {
      method:"POST",
      body: fd
    });

    closeModal();
    toast("good","تم","تمت إضافة الصرفية");
    await loadExpenses();
    await loadLedger();
  }catch(e){
    toast("bad","خطأ", e.message);
  }
}

const btnTransferSelectedExpenses = $("#btnTransferSelectedExpenses");
if(btnTransferSelectedExpenses){
  btnTransferSelectedExpenses.onclick = async () => {
    const ids = $$(".expChk").filter((c) => c.checked).map((c) => c.value);

    if(!ids.length){
      toast("warn","حدد صرفيات","اختر صرفية واحدة على الأقل");
      return;
    }

    const ok = await appConfirm({
      title: "ترحيل الصرفيات المحددة",
      message: `سيتم ترحيل ${ids.length} صرفية وحفظها في التقرير.`,
      okText: "رحّل المحدد",
      cancelText: "إلغاء",
      warn: true
    });

    if(!ok) return;

    try{
      await apiJson(API.expTransfer, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ ids })
      });

      toast("good","تم","تم ترحيل الصرفيات المحددة");
      await loadExpenses();
    }catch(e){
      toast("bad","خطأ", e.message);
    }
  };
}

const btnTransferAllExpenses = $("#btnTransferAllExpenses");
if(btnTransferAllExpenses){
  btnTransferAllExpenses.onclick = async () => {
    const ok = await appConfirm({
      title: "ترحيل كل الصرفيات",
      message: "سيتم ترحيل كل الصرفيات الحالية وإفراغ قائمة الصرفيات غير المرحلة.",
      okText: "رحّل الكل",
      cancelText: "إلغاء",
      danger: true
    });

    if(!ok) return;

    try{
      await apiJson(API.expTransfer, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({})
      });

      toast("good","تم","تم ترحيل كل الصرفيات");
      await loadExpenses();
    }catch(e){
      toast("bad","خطأ", e.message);
    }
  };
}

/* ======================
   Purchases
   ====================== */
/* ======================
   Purchases
   ====================== */
function purchaseDebtVendorNames(){
  return [...new Set(
    (state.debts.items || [])
      .filter((x) => n(x.amount) > 0)
      .map((x) => String(x.vendor || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ar"));
}

function isPurchaseDebtPayment(){
  return String($("#mPurchaseType")?.value || "NEW") === "DEBT_PAYMENT";
}

function renderPurchaseDebtVendorSuggestions(input, box){
  const q = String(input.value || "").trim().toLowerCase();

  const names = purchaseDebtVendorNames().filter((name) => {
    return !q || name.toLowerCase().includes(q);
  });

  box.innerHTML = names.length
    ? names.map((name) => {
        const item = (state.debts.items || []).find((x) => String(x.vendor || "").trim() === name);
        const amount = item ? n(item.amount) : 0;

        return `
          <button type="button" class="debtVendorOption" data-vendor="${escAttr(name)}">
            ${esc(name)}
            <small style="opacity:.75;margin-inline-start:8px">الدين: ${fmt(amount)}</small>
          </button>
        `;
      }).join("")
    : `<div class="debtVendorEmpty">لا يوجد تاجر مطابق في الديون</div>`;

  box.classList.add("show");

  box.querySelectorAll("[data-vendor]").forEach((btn) => {
    btn.onclick = () => {
      input.value = btn.dataset.vendor || "";
      box.classList.remove("show");
      $("#mPurchaseAmount")?.focus();
    };
  });
}

function attachPurchaseDebtVendorPicker(){
  const input = $("#mPurchaseVendor");
  const box = $("#mPurchaseVendorSuggestions");
  if(!input || !box) return;

  const show = () => {
    if(!isPurchaseDebtPayment()) return;
    renderPurchaseDebtVendorSuggestions(input, box);
  };

  input.addEventListener("focus", show);
  input.addEventListener("click", show);
  input.addEventListener("input", show);

  document.addEventListener("click", function closePurchaseVendorBox(e){
    if(!input.contains(e.target) && !box.contains(e.target)){
      box.classList.remove("show");
      document.removeEventListener("click", closePurchaseVendorBox);
    }
  });
}

function updatePurchaseTypeUI(){
  const type = $("#mPurchaseType")?.value || "NEW";
  const isDebt = type === "DEBT_PAYMENT";

  const vendorLabel = $("#mPurchaseVendorLabel");
  const vendorInput = $("#mPurchaseVendor");
  const vendorBox = $("#mPurchaseVendorSuggestions");
  const note = $("#mPurchaseTypeNote");

  if(vendorLabel){
    vendorLabel.textContent = isDebt
      ? "اختر التاجر من الديون"
      : "التاجر / المورد اختياري";
  }

  if(vendorInput){
    vendorInput.value = "";
    vendorInput.placeholder = isDebt
      ? "اختر من التجار الموجودين في الديون"
      : "اسم التاجر";
    vendorInput.readOnly = false;
  }

  if(vendorBox){
    vendorBox.classList.remove("show");
  }

  if(note){
    note.textContent = isDebt
      ? "سيتم خصم مبلغ الفاتورة من دين التاجر تلقائيًا، مع خصم المبلغ من مصدر الدفع."
      : "لن يتم تغيير الديون. سيتم تسجيلها كمشتريات جديدة فقط.";
  }
}

function renderPurchases(){
  const rows = state.purchases.items || [];

  const hostSummary = $("#purchasesSummary");
  const hostTable = $("#purchasesTable");
  if(!hostSummary || !hostTable) return;

  const debtRows = rows.filter((x) => x.isDebtPayment || x.purchaseType === "DEBT_PAYMENT");
  const newRows = rows.filter((x) => !(x.isDebtPayment || x.purchaseType === "DEBT_PAYMENT"));

  const debtTotal = debtRows.reduce((s, x) => s + n(x.amount), 0);
  const newTotal = newRows.reduce((s, x) => s + n(x.amount), 0);

  hostSummary.innerHTML = `
    <div class="summaryChip"><span>عدد المشتريات</span><b>${rows.length}</b></div>
    <div class="summaryChip"><span>إجمالي المشتريات الجديدة</span><b>${fmt(newTotal)}</b></div>
    <div class="summaryChip"><span>إجمالي تسديد الديون</span><b>${fmt(debtTotal)}</b></div>
    <div class="summaryChip"><span>الإجمالي</span><b>${fmt(state.purchases.total)}</b></div>
  `;

  hostTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الفاتورة</th>
          <th>النوع</th>
          <th>البيان</th>
          <th>التاجر</th>
          <th>المصدر</th>
          <th>المبلغ</th>
          <th>التاريخ</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows.map((x) => {
                const isDebt = x.isDebtPayment || x.purchaseType === "DEBT_PAYMENT";

                return `
                  <tr>
                    <td>
                      ${
                        x.receiptUrl
                          ? `
                            <img
                              class="receiptThumb"
                              src="${escAttr(x.receiptUrl)}"
                              alt="receipt"
                              onclick="previewReceipt('${escAttr(x.receiptUrl)}','فاتورة مشتريات: ${escAttr(x.reason || "")}')"
                            >
                          `
                          : `<div class="receiptEmpty">لا يوجد</div>`
                      }
                    </td>
                    <td>
                      <b>${isDebt ? "تسديد دين" : "مشتريات جديدة"}</b>
                      ${
                        isDebt
                          ? `<div style="font-size:12px;opacity:.75">بعد السداد: ${fmt(x.debtAfter)}</div>`
                          : ""
                      }
                    </td>
                    <td>${esc(x.reason || "—")}</td>
                    <td>${esc(x.vendor || "—")}</td>
                    <td>${esc(x.sourceLabel || accountName(x.source) || "الحساب البنكي")}</td>
                    <td><b>${fmt(x.amount)}</b></td>
                    <td>${esc(displayLocalDate(x.at))}</td>
                  </tr>
                `;
              }).join("")
            : `<tr><td colspan="7"><div class="emptyState">لا توجد مشتريات</div></td></tr>`
        }
      </tbody>
    </table>
  `;
}

const btnAddPurchase = $("#btnAddPurchase");
if(btnAddPurchase){
  btnAddPurchase.onclick = async () => {
    try{
      await loadDebts();
    }catch(e){
      console.warn("debts load failed before purchase modal", e);
    }

    openModal({
      title:"إضافة مشتريات",
      sub:"اختر هل العملية مشتريات جديدة أو تسديد دين لتاجر موجود في الديون",
      body: `
        <div class="formGrid">
          <div class="field">
            <label>نوع العملية</label>
            <select id="mPurchaseType">
              <option value="NEW" selected>مشتريات جديدة</option>
              <option value="DEBT_PAYMENT">تسديد دين</option>
            </select>
            <small id="mPurchaseTypeNote" style="display:block;margin-top:6px;opacity:.75">
              لن يتم تغيير الديون. سيتم تسجيلها كمشتريات جديدة فقط.
            </small>
          </div>

          <div class="field">
            <label>المبلغ</label>
            <input id="mPurchaseAmount" type="number" step="0.001" placeholder="0.000">
          </div>

          <div class="field">
            <label>مصدر الدفع</label>
            <select id="mPurchaseSource">
              <option value="BANK" selected>الحساب البنكي</option>
              <option value="CASH_MUSCAT">كاش مسقط</option>
            </select>
          </div>

          <div class="field">
            <label>البيان / المنتج</label>
            <textarea id="mPurchaseReason" placeholder="مثلاً: شراء منتجات من المورد أو سداد فاتورة قديمة"></textarea>
          </div>

          <div class="field debtVendorField">
            <label id="mPurchaseVendorLabel">التاجر / المورد اختياري</label>
            <input id="mPurchaseVendor" placeholder="اسم التاجر" autocomplete="off">
            <div id="mPurchaseVendorSuggestions" class="debtVendorSuggestions"></div>
          </div>

          <div class="field">
            <label>مرفق اختياري</label>
            <input id="mPurchaseFile" type="file" accept="image/*">
          </div>
        </div>
      `,
      footer: `
        <button class="primaryBtn" id="mSavePurchase">حفظ المشتريات</button>
        <button class="ghostBtn" id="mCancel">إلغاء</button>
      `
    });

    $("#mCancel").onclick = closeModal;
    $("#mPurchaseType").onchange = updatePurchaseTypeUI;
    attachPurchaseDebtVendorPicker();
    updatePurchaseTypeUI();
    $("#mSavePurchase").onclick = savePurchase;
  };
}

async function savePurchase(){
  const amount = n($("#mPurchaseAmount").value);
  const source = $("#mPurchaseSource")?.value || "BANK";
  const reason = ($("#mPurchaseReason").value || "").trim();
  const vendor = ($("#mPurchaseVendor").value || "").trim();
  const purchaseType = $("#mPurchaseType")?.value || "NEW";
  const isDebt = purchaseType === "DEBT_PAYMENT";
  const file = $("#mPurchaseFile").files?.[0];

  if(!(amount > 0)){
    toast("warn","ناقص","أدخل مبلغ صحيح");
    return;
  }

  if(!reason){
    toast("warn","ناقص","أدخل بيان المشتريات");
    return;
  }

  if(isDebt){
    if(!vendor){
      toast("warn","ناقص","اختر التاجر من الديون");
      return;
    }

    const allowed = purchaseDebtVendorNames();
    if(!allowed.includes(vendor)){
      toast("warn","تنبيه","اختر تاجر موجود في الديون");
      return;
    }
  }

  try{
    const fd = new FormData();
    fd.append("amount", String(amount));
    fd.append("source", source);
    fd.append("reason", reason);
    fd.append("vendor", vendor);
    fd.append("purchaseType", purchaseType);
    if(file) fd.append("receipt", file);

    await apiJson(API.purchaseAdd, {
      method:"POST",
      body: fd
    });

    closeModal();

    toast(
      "good",
      "تم",
      isDebt
        ? "تمت إضافة الفاتورة وخصمها من دين التاجر"
        : "تمت إضافة المشتريات بدون تعديل الديون"
    );

    await loadPurchases();
    await loadDebts();
    await loadLedger();
  }catch(e){
    toast("bad","خطأ", e.message);
  }
}

const btnExportPurchases = $("#btnExportPurchases");
if(btnExportPurchases){
  btnExportPurchases.onclick = () => exportExcel("purchases-report", purchaseRowsForExcel());
}

/* ======================
   Debts - Pro Version
   ====================== */
function debtLevel(amount){
  const a = n(amount);

  if(a < 0){
    return {
      text: "رصيد لك",
      cls: "good",
      icon: ICONS.check,
      rank: 0
    };
  }

  if(a >= 900){
    return {
      text: "مرتفع",
      cls: "bad",
      icon: ICONS.info,
      rank: 4
    };
  }

  if(a >= 500){
    return {
      text: "متوسط",
      cls: "warn",
      icon: ICONS.info,
      rank: 3
    };
  }

  if(a >= 100){
    return {
      text: "خفيف",
      cls: "good",
      icon: ICONS.info,
      rank: 2
    };
  }

  if(a > 0){
    return {
      text: "منخفض جدًا",
      cls: "good",
      icon: ICONS.info,
      rank: 1
    };
  }

  return {
    text: "صفر",
    cls: "",
    icon: ICONS.info,
    rank: 0
  };
}

function debtRowsFiltered(){
  const q = (state.debtView.q || "").trim().toLowerCase();

  let rows = [...(state.debts.items || [])];

  if(q){
    rows = rows.filter((x) => String(x.vendor || "").toLowerCase().includes(q));
  }

  if(state.debtView.onlyPositive){
    rows = rows.filter((x) => n(x.amount) > 0);
  }

  const sort = state.debtView.sort;

  rows.sort((a,b) => {
    if(sort === "amountDesc") return n(b.amount) - n(a.amount);
    if(sort === "amountAsc") return n(a.amount) - n(b.amount);
    if(sort === "name") return String(a.vendor || "").localeCompare(String(b.vendor || ""), "ar");
    if(sort === "level"){
      const la = debtLevel(a.amount).rank;
      const lb = debtLevel(b.amount).rank;
      if(lb !== la) return lb - la;
      return n(b.amount) - n(a.amount);
    }

    const pa = Number.isFinite(n(a.priority)) && n(a.priority) > 0 ? n(a.priority) : 999999;
    const pb = Number.isFinite(n(b.priority)) && n(b.priority) > 0 ? n(b.priority) : 999999;

    if(pa !== pb) return pa - pb;
    return n(b.amount) - n(a.amount);
  });

  return rows;
}

function renderDebts(){
  const all = state.debts.items || [];
  const rows = debtRowsFiltered();

  const positive = all.reduce((s,x) => s + (n(x.amount) > 0 ? n(x.amount) : 0), 0);
  const credits = all.reduce((s,x) => s + (n(x.amount) < 0 ? Math.abs(n(x.amount)) : 0), 0);
  const highCount = all.filter((x) => n(x.amount) >= 900).length;

  $("#debtsSummary").innerHTML = `
    <div class="summaryChip">
      <span>عدد التجار</span>
      <b>${all.length}</b>
    </div>

    <div class="summaryChip">
      <span>إجمالي الديون</span>
      <b>${fmt(positive)}</b>
    </div>

    <div class="summaryChip">
      <span>رصيد لك</span>
      <b>${fmt(credits)}</b>
    </div>

    <div class="summaryChip">
      <span>ديون مرتفعة</span>
      <b>${highCount}</b>
    </div>
  `;

  $("#debtsTable").innerHTML = `
    <div class="debtToolbar">
      <div class="debtSearch">
        <span class="ico">${ICONS.search}</span>
        <input id="debtSearchInput" placeholder="ابحث باسم التاجر..." value="${escAttr(state.debtView.q)}">
      </div>

      <select id="debtSortSelect" class="debtSelect">
        <option value="priority" ${state.debtView.sort === "priority" ? "selected" : ""}>حسب الترتيب اليدوي</option>
        <option value="amountDesc" ${state.debtView.sort === "amountDesc" ? "selected" : ""}>الأعلى مبلغًا</option>
        <option value="amountAsc" ${state.debtView.sort === "amountAsc" ? "selected" : ""}>الأقل مبلغًا</option>
        <option value="level" ${state.debtView.sort === "level" ? "selected" : ""}>حسب الخطورة</option>
        <option value="name" ${state.debtView.sort === "name" ? "selected" : ""}>حسب الاسم</option>
      </select>

      <button id="btnDebtOnlyPositive" class="miniBtn ${state.debtView.onlyPositive ? "primaryMini" : ""}">
        الديون فقط
      </button>

      <button id="btnDebtReorder" class="miniBtn">
        <span class="ico">${ICONS.sort}</span>
        ترتيب
      </button>

      <button id="btnDebtExcel" class="miniBtn">
        <span class="ico">${ICONS.excel}</span>
        Excel
      </button>
    </div>

    <div class="debtListPro">
      ${
        rows.length
          ? rows.map((x, index) => debtCard(x, index, rows.length)).join("")
          : `<div class="emptyState">لا توجد ديون مطابقة</div>`
      }
    </div>
  `;

  $("#debtSearchInput").oninput = debounce((e) => {
    state.debtView.q = e.target.value || "";
    renderDebts();
  }, 180);

  $("#debtSortSelect").onchange = (e) => {
    state.debtView.sort = e.target.value;
    renderDebts();
  };

  $("#btnDebtOnlyPositive").onclick = () => {
    state.debtView.onlyPositive = !state.debtView.onlyPositive;
    renderDebts();
  };

  $("#btnDebtReorder").onclick = openDebtReorderModal;
  $("#btnDebtExcel").onclick = exportDebtsExcel;
}

function debtCard(x, index, total){
  const amount = n(x.amount);
  const level = debtLevel(amount);

  return `
    <article class="debtCardPro">
      <div class="debtRank">
        <span>${index + 1}</span>
      </div>

      <div class="debtMain">
        <div class="debtTitleLine">
          <div>
            <h4>${esc(x.vendor || "—")}</h4>
            <p>أولوية: ${esc(x.priority ?? "—")}</p>
          </div>

          <span class="debtBadge ${level.cls}">
            ${level.icon}
            ${esc(level.text)}
          </span>
        </div>

        <div class="debtMeter">
          <div
            class="debtMeterFill ${level.cls}"
            style="width:${Math.min(100, Math.round(Math.abs(amount) / 1000 * 100))}%"
          ></div>
        </div>

        <div class="debtBottom">
          <div>
            <span>المبلغ</span>
            <b class="${amount < 0 ? "creditText" : ""}">${fmt(amount)}</b>
          </div>

          <div class="debtActionsPro">
            <button class="miniBtn" onclick="debtQuick('add','${escAttr(x.vendor)}')">
              <span class="ico">${ICONS.plus}</span>
              إضافة
            </button>

            <button class="miniBtn" onclick="debtQuick('pay','${escAttr(x.vendor)}')">
              <span class="ico">${ICONS.minus}</span>
              سداد
            </button>

            <button class="miniBtn" onclick="removeDebt('${escAttr(x.vendor)}')">
              <span class="ico">${ICONS.trash}</span>
              حذف
            </button>
          </div>
        </div>
      </div>
    </article>
  `;
}

$("#btnDebtAdd").onclick = () => debtQuick("add","");
$("#btnDebtPay").onclick = () => debtQuick("pay","");

function debtVendorNames(){
  return [...new Set(
    (state.debts.items || [])
      .map((x) => String(x.vendor || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "ar"));
}

function renderDebtVendorSuggestions(input, box){
  const q = String(input.value || "").trim().toLowerCase();
  const names = debtVendorNames().filter((name) =>
    !q || name.toLowerCase().includes(q)
  );

  box.innerHTML = names.length
    ? names.map((name) => `
        <button type="button" class="debtVendorOption" data-vendor="${escAttr(name)}">
          ${esc(name)}
        </button>
      `).join("")
    : `<div class="debtVendorEmpty">اكتب اسم تاجر جديد</div>`;

  box.classList.add("show");

  box.querySelectorAll("[data-vendor]").forEach((btn) => {
    btn.onclick = () => {
      input.value = btn.dataset.vendor || "";
      box.classList.remove("show");
      $("#mDebtAmount")?.focus();
    };
  });
}

function attachDebtVendorPicker(){
  const input = $("#mDebtVendor");
  const box = $("#mDebtVendorSuggestions");
  if(!input || !box) return;

  const show = () => renderDebtVendorSuggestions(input, box);

  input.addEventListener("focus", show);
  input.addEventListener("click", show);
  input.addEventListener("input", show);

  document.addEventListener("click", function closeVendorBox(e){
    if(!input.contains(e.target) && !box.contains(e.target)){
      box.classList.remove("show");
      document.removeEventListener("click", closeVendorBox);
    }
  });
}

function debtQuick(mode, vendor){
  openModal({
    title: mode === "add" ? "إضافة دين" : "سداد دين",
    sub: mode === "add"
      ? "سجّل دين جديد على التاجر"
      : "سجّل مبلغ تم سداده للتاجر",
    body: `
      <div class="formGrid">
        <div class="proFormTwo">
          <div class="field debtVendorField">
            <label>اسم التاجر</label>
            <input
              id="mDebtVendor"
              value="${escAttr(vendor || "")}"
              placeholder="اختر تاجر أو اكتب اسم جديد يوسف او الاغبري"
              autocomplete="off"
            >
            <div id="mDebtVendorSuggestions" class="debtVendorSuggestions"></div>
          </div>

          <div class="field">
            <label>المبلغ</label>
            <input id="mDebtAmount" type="number" step="0.001" placeholder="0.000">
          </div>

          ${
            mode === "pay"
              ? `
                <div class="field">
                  <label>مصدر السداد</label>
                  <select id="mDebtSource">
                    <option value="BANK" selected>الحساب البنكي</option>
                    <option value="CASH_MUSCAT">كاش مسقط</option>
                  </select>
                </div>
              `
              : ""
          }
        </div>
      </div>
    `,
    footer: `
      <button class="primaryBtn" id="mSaveDebt">
        ${mode === "add" ? "إضافة الدين" : "تسجيل السداد"}
      </button>
      <button class="ghostBtn" id="mCancel">إلغاء</button>
    `
  });

  $("#mCancel").onclick = closeModal;
  attachDebtVendorPicker();
  $("#mSaveDebt").onclick = () => saveDebt(mode);
}

async function saveDebt(mode){
  const vendor = ($("#mDebtVendor").value || "").trim();
  const amount = n($("#mDebtAmount").value);
  const source = $("#mDebtSource")?.value || "BANK";

  if(!vendor){
    toast("warn","ناقص","أدخل اسم التاجر");
    return;
  }

  if(!(amount > 0)){
    toast("warn","ناقص","أدخل مبلغ صحيح");
    return;
  }

  try{
    await apiJson(mode === "add" ? API.debtAdd : API.debtPay, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ vendor, amount, source })
    });

    closeModal();
    toast("good","تم","تم حفظ العملية");
    await loadDebts();
    await loadLedger();
  }catch(e){
    toast("bad","خطأ", e.message);
  }
}

async function removeDebt(vendor){
  const ok = await appConfirm({
    title: "حذف دين",
    message: `هل تريد حذف دين التاجر: ${vendor}؟`,
    okText: "حذف",
    cancelText: "إلغاء",
    danger: true
  });

  if(!ok) return;

  try{
    await apiJson(API.debtRemove, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ vendor })
    });

    toast("good","تم","تم حذف الدين");
    await loadDebts();
  }catch(e){
    toast("bad","خطأ", e.message);
  }
}

function openDebtReorderModal(){
  const list = (state.debts.items || [])
    .slice()
    .sort((a,b) => {
      const pa = n(a.priority) > 0 ? n(a.priority) : 999999;
      const pb = n(b.priority) > 0 ? n(b.priority) : 999999;
      return pa - pb;
    })
    .map((x) => x.vendor)
    .filter(Boolean);

  if(!list.length){
    toast("warn","لا يوجد","لا توجد ديون لترتيبها");
    return;
  }

  let working = [...list];

  function draw(){
    $("#modalBody").innerHTML = `
      <div class="reorderList">
        ${working.map((vendor, i) => `
          <div class="reorderItem">
            <div>
              <b>${esc(vendor)}</b>
              <small>ترتيب ${i + 1}</small>
            </div>

            <div class="reorderActions">
              <button class="miniBtn" data-up="${i}" ${i === 0 ? "disabled" : ""}>
                <span class="ico">${ICONS.up}</span>
              </button>
              <button class="miniBtn" data-down="${i}" ${i === working.length - 1 ? "disabled" : ""}>
                <span class="ico">${ICONS.down}</span>
              </button>
            </div>
          </div>
        `).join("")}
      </div>
    `;

    $$("[data-up]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.up);
        if(i <= 0) return;
        const tmp = working[i - 1];
        working[i - 1] = working[i];
        working[i] = tmp;
        draw();
      };
    });

    $$("[data-down]").forEach((b) => {
      b.onclick = () => {
        const i = Number(b.dataset.down);
        if(i >= working.length - 1) return;
        const tmp = working[i + 1];
        working[i + 1] = working[i];
        working[i] = tmp;
        draw();
      };
    });
  }

  openModal({
    title: "ترتيب الديون",
    sub: "حرّك التجار حسب الأولوية، وهذا الترتيب يبقى محفوظًا في السيرفر",
    body: `<div class="emptyState">جاري التحضير...</div>`,
    footer: `
      <button id="mSaveReorder" class="primaryBtn">حفظ الترتيب</button>
      <button id="mCancel" class="ghostBtn">إلغاء</button>
    `
  });

  draw();

  $("#mCancel").onclick = closeModal;

  $("#mSaveReorder").onclick = async () => {
    try{
      await apiJson(API.debtReorder, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ list: working })
      });

      closeModal();
      toast("good","تم","تم حفظ ترتيب الديون");
      await loadDebts();
    }catch(e){
      toast("bad","خطأ", e.message);
    }
  };
}

/* ======================
   Export
   ====================== */
function currentRowsForExcel(){
  return allCurrentRows().map((o) => ({
    "القسم": sectionName(o.section),
    "الطلب": o.orderName,
    "العميل": o.customer,
    "التاريخ": o.createdAt,
    "الحالة": o.statusText,
    "البوابة": o.gateway,
    "شركة الشحن": o.shippingCompany,
    "الإجمالي": o.total,
    "المدفوع": o.paid,
    "المتبقي": o.outstanding,
    "مبلغ التوصيل": o.deliveryFee,
    "الصافي": o.net,
"مبلغ الحساب": orderTransferAmount(o),
"توصيل يخصم من كاش مسقط": deliveryCoveredByCashAmount(o),
"الأثر النهائي": orderTransferAmount(o) - deliveryCoveredByCashAmount(o),
"شحن خارجي مخصوم": externalShippingAmount(o),
     "التاقات": (o.tags || []).join(", ")
  }));
}


function archiveRowsForExcel(){
  return (state.archive || []).flatMap((a) => {
    return (a.orders || []).map((o) => ({
      "رقم الدفعة": a.id,
      "تاريخ الترحيل": a.at,
      "نوع الترحيل": sectionName(a.type),
      "من تاريخ": a.from,
      "إلى تاريخ": a.to,
      "الطلب": o.orderName,
      "العميل": o.customer,
      "الحالة": o.statusText,
      "البوابة": o.gateway,
      "الإجمالي": o.gross,
      "الشحن": o.deliveryFee,
      "الصافي": o.net,
"مبلغ الحساب": orderTransferAmount(o),
"توصيل يخصم من كاش مسقط": deliveryCoveredByCashAmount(o),
"الأثر النهائي": orderTransferAmount(o) - deliveryCoveredByCashAmount(o),
"شحن خارجي مخصوم": externalShippingAmount(o),
       "التاقات": (o.tags || []).join(", ")
    }));
  });
}


function expensesRowsForExcel(){
  return (state.expenses.items || []).map((x, i) => ({
    "م": i + 1,
    "التاريخ": x.at || "",
    "السبب": x.reason || "",
    "المصدر": x.sourceLabel || accountName(x.source) || "",
    "المبلغ": n(x.amount),
    "رابط الفاتورة": x.receiptUrl || ""
  }));
}

function ledgerRowsForExcel(){
  return (state.ledger.entries || []).map((x, i) => ({
    "م": i + 1,
    "التاريخ": x.at || "",
    "العملية": movementTypeName(x.type),
    "من": x.fromLabel || "",
    "إلى": x.toLabel || "",
    "المبلغ": n(x.amount),
    "ملاحظة": x.note || "",
    "مرجع": x.refId || ""
  }));
}

function purchaseRowsForExcel(){
  return (state.purchases.items || []).map((x, i) => ({
    "م": i + 1,
    "التاريخ": x.at || "",
    "البيان": x.reason || "",
    "التاجر": x.vendor || "",
    "المصدر": x.sourceLabel || accountName(x.source) || "",
    "المبلغ": n(x.amount),
    "رابط الفاتورة": x.receiptUrl || ""
  }));
}

function debtRowsForExcel(){
  return debtRowsFiltered().map((x, i) => ({
    "الترتيب": i + 1,
    "التاجر": x.vendor,
    "المبلغ": n(x.amount),
    "التصنيف": debtLevel(x.amount).text,
    "الأولوية": x.priority
  }));
}

function exportExcel(fileName, rows){
  if(!window.XLSX){
    toast("bad","خطأ","مكتبة Excel غير محملة");
    return;
  }

  const ws = XLSX.utils.json_to_sheet(rows || []);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}

function exportCurrent(){
  exportExcel("finance-current-orders", currentRowsForExcel());
}

function exportArchiveBatch(id){
  const a = (state.archive || []).find((x) => x.id === id);
  if(!a) return;

  const rows = (a.orders || []).map((o) => ({
    "رقم الدفعة": a.id,
    "تاريخ الترحيل": a.at,
    "نوع الترحيل": sectionName(a.type),
    "الطلب": o.orderName,
    "العميل": o.customer,
    "الحالة": o.statusText,
    "البوابة": o.gateway,
    "الإجمالي": o.gross,
    "الشحن": o.deliveryFee,
    "الصافي": o.net,
"مبلغ الحساب": orderTransferAmount(o),
"توصيل يخصم من كاش مسقط": deliveryCoveredByCashAmount(o),
"الأثر النهائي": orderTransferAmount(o) - deliveryCoveredByCashAmount(o),
"شحن خارجي مخصوم": externalShippingAmount(o),
     "المتبقي": o.outstanding,
    "التاقات": (o.tags || []).join(", ")
  }));

  exportExcel(`archive-${id}`, rows);
}

function exportDebtsExcel(){
  exportExcel("debts-report", debtRowsForExcel());
}

$("#btnExportArchive").onclick = () => {
  exportExcel("finance-archive", archiveRowsForExcel());
};

const btnExportExpenses = $("#btnExportExpenses");

if(btnExportExpenses){
  btnExportExpenses.onclick = () => {
    exportExcel("expenses-current", expensesRowsForExcel());
  };
}

/* ======================
   Helpers
   ====================== */
function debounce(fn, ms = 200){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function setQuickRange(days){
  const d = Number(days);

  if(d <= 1){
    $("#dateFrom").value = localDateInput(0);
    $("#dateTo").value = localDateInput(0);
  } else {
    $("#dateFrom").value = localDateInput(d - 1);
    $("#dateTo").value = localDateInput(0);
  }

  saveDates();
  loadAll();
}

/* ======================
   Events
   ====================== */
$("#btnRefresh").onclick = loadAll;
$("#btnApplyDates").onclick = loadAll;

function setSingleDayRange(daysBack){
  const d = localDateInput(Number(daysBack) || 0);

  $("#dateFrom").value = d;
  $("#dateTo").value = d;

  saveDates();
  loadAll();
}

const btnTodayRange = $("#btnTodayRange");
const btnYesterdayRange = $("#btnYesterdayRange");
const btnBeforeYesterdayRange = $("#btnBeforeYesterdayRange");
const btnWeekRange = $("#btnWeekRange");

if(btnTodayRange){
  btnTodayRange.onclick = () => setSingleDayRange(0);
}

if(btnYesterdayRange){
  btnYesterdayRange.onclick = () => setSingleDayRange(1);
}

if(btnBeforeYesterdayRange){
  btnBeforeYesterdayRange.onclick = () => setSingleDayRange(2);
}

if(btnWeekRange){
  btnWeekRange.onclick = () => setQuickRange(7);
}

$("#btnClearDates").onclick = () => {
  setQuickRange(30);
};


async function loadLocalStock(){
  const q = qsDates();
  const data = await apiJson(`${API.localStock}${q ? "?" + q : ""}`);

  state.localStock = {
    totals: data.totals || {},
    productRows: data.productRows || [],
    customers: data.customers || [],
    sales: data.sales || []
  };

  renderLocalStock();
}

function renderLocalStock(){
  renderLocalStockSummary();
  renderLocalStockProducts();
  renderLocalStockCustomers();
}

function renderLocalStockSummary(){
  const el = $("#localStockSummary");
  if(!el) return;

  const t = state.localStock.totals || {};

  el.innerHTML = `
    <div class="sumCard">
      <span>أصناف بالمخزون</span>
      <b>${t.products || 0}</b>
      <small>منتجات لها كمية محلية</small>
    </div>

    <div class="sumCard">
      <span>كمية المخزون الحالية</span>
      <b>${t.currentStockQty || 0}</b>
      <small>إجمالي القطع المتبقية</small>
    </div>

    <div class="sumCard">
      <span>شراء للطلبات</span>
      <b>${t.boughtForOrders || 0}</b>
      <small>من صفحة شراء المنتجات</small>
    </div>

    <div class="sumCard">
      <span>إضافة للمخزون</span>
      <b>${t.stockAdded || 0}</b>
      <small>زيادات دخلت المخزون المحلي</small>
    </div>

    <div class="sumCard">
      <span>بيع محلي</span>
      <b>${fmt(t.localSales || 0)}</b>
      <small>حسب الفترة المختارة</small>
    </div>

    <div class="sumCard">
      <span>غير مرحل</span>
      <b>${fmt(t.localOutstanding || 0)}</b>
      <small>${t.missingPriceCount || 0} بدون سعر</small>
    </div>
  `;
}

function renderLocalStockProducts(){
  const el = $("#localStockProductsTable");
  if(!el) return;

  const rows = state.localStock.productRows || [];

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>المنتج</th>
          <th>شراء للطلبات</th>
          <th>إضافة للمخزون</th>
          <th>خصم للطلبات</th>
          <th>بيع محلي</th>
          <th>المتبقي</th>
          <th>أرقام الطلبات</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows.map((x) => `
              <tr>
                <td>
                  <div class="prodMiniCell">
                    ${
                      x.image
                        ? `<img src="${esc(x.image)}" alt="">`
                        : `<div class="prodMiniNoImg">—</div>`
                    }
                    <div>
                      <b>${esc(x.product_name || "—")}</b>
                      <small>
                        ${x.sku ? `SKU: ${esc(x.sku)} ` : ""}
                        ${x.barcode ? `باركود: ${esc(x.barcode)}` : ""}
                      </small>
                    </div>
                  </div>
                </td>

                <td><b>${x.netBoughtForOrders || 0}</b></td>
                <td>${x.stockAdded || 0}</td>
                <td>${x.stockConsumed || 0}</td>
                <td>
                  <b>${x.localSold || 0}</b>
                  <small>${fmt(x.localSoldAmount || 0)}</small>
                </td>
                <td><b>${x.currentStock || 0}</b></td>
                <td>
                  ${
                    (x.orders || []).length
                      ? x.orders.slice(0, 12).map((o) => `<span class="miniTag">${esc(o)}</span>`).join("")
                      : "—"
                  }
                </td>
              </tr>
            `).join("")
            : `<tr><td colspan="7"><div class="emptyBox">لا توجد بيانات</div></td></tr>`
        }
      </tbody>
    </table>
  `;
}

function renderLocalStockCustomers(){
  const el = $("#localStockCustomersTable");
  if(!el) return;

  const rows = state.localStock.customers || [];

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>الشخص</th>
          <th>عدد العمليات</th>
          <th>الكمية</th>
          <th>الإجمالي</th>
          <th>مرحّل</th>
          <th>متبقي</th>
          <th>إجراء</th>
        </tr>
      </thead>
      <tbody>
        ${
          rows.length
            ? rows.map((x) => {
                const customerCode = encodeURIComponent(x.customer || "");

                return `
                  <tr>
                    <td><b>${esc(x.customer || "—")}</b></td>
                    <td>${x.salesCount || 0}</td>
                    <td>${x.qty || 0}</td>
                    <td>${fmt(x.total || 0)}</td>
                    <td>${fmt(x.settled || 0)}</td>
                    <td><b>${fmt(x.outstanding || 0)}</b></td>
                    <td>
                      <div class="topActions">
                        <button class="softBtn" type="button" onclick="openLocalCustomerInvoice('${customerCode}')">
                          فاتورة
                        </button>

                        <button class="softBtn" type="button" onclick="openLocalCustomerPrices('${customerCode}')">
                          تعديل الأسعار
                        </button>

                        ${
                          Number(x.outstanding || 0) > 0
                            ? `<button class="primaryBtn" type="button" onclick="settleLocalCustomer('${customerCode}')">ترحيل كاش</button>`
                            : ""
                        }
                      </div>
                    </td>
                  </tr>
                `;
              }).join("")
            : `<tr><td colspan="7"><div class="emptyBox">لا توجد مبيعات محلية</div></td></tr>`
        }
      </tbody>
    </table>
  `;
}

window.openLocalCustomerInvoice = function(customerEncoded){
  const customer = decodeURIComponent(customerEncoded || "").trim();

  if(!customer){
    toast("bad", "خطأ", "اسم الشخص غير موجود");
    return;
  }

const url = `local-invoice.html?customer=${encodeURIComponent(customer)}`;
   window.open(url, "_blank", "noopener,noreferrer");
};

window.openLocalCustomerPrices = async function(customerEncoded){
  const customer = decodeURIComponent(customerEncoded || "").trim();

  if(!customer){
    toast("bad", "خطأ", "اسم الشخص غير موجود");
    return;
  }

  try{
    const data = await apiJson(`${API.localStockCustomer}?customer=${encodeURIComponent(customer)}`);
    const sales = Array.isArray(data.sales) ? data.sales : [];

    const body = sales.length
      ? sales.map((s) => `
        <div class="invoiceSaleBox">
          <div class="invoiceSaleHead">
            <b>${esc(displayLocalDateTime(s.at))}</b>
            <span class="miniTag ${s.settled ? "good" : "warn"}">
              ${s.settled ? "مرحّل" : "غير مرحّل"}
            </span>
          </div>

          <div class="prodMiniCell">
            ${
              s.image
                ? `<img src="${escAttr(s.image)}" alt="">`
                : `<div class="prodMiniNoImg">—</div>`
            }

            <div>
              <b>${esc(s.product_name || s.product_key || "منتج")}</b>
              <small>
                الكمية: ${n(s.qty)}
                ${s.sku ? ` | SKU: ${esc(s.sku)}` : ""}
                ${s.barcode ? ` | باركود: ${esc(s.barcode)}` : ""}
              </small>
            </div>
          </div>

          <div class="priceEditRow">
            <label>سعر القطعة</label>
            <input
              type="number"
              step="0.001"
              min="0"
              value="${n(s.unitPrice || 0)}"
              data-sale-price="${escAttr(s.id)}"
              ${s.settled ? "disabled" : ""}
            >

            ${
              s.settled
                ? `<span class="miniTag good">مرحّل</span>`
                : `<button class="miniBtn primaryMini" type="button" onclick="saveLocalSalePrice('${escAttr(s.id)}')">حفظ السعر</button>`
            }
          </div>

          <div class="invoiceTotalLine">
            المجموع: <b>${fmt(s.total || 0)} ر.ع</b>
          </div>
        </div>
      `).join("")
      : `<div class="emptyBox">لا توجد منتجات لهذا الشخص</div>`;

    openModal({
      title: `تعديل أسعار ${customer}`,
      sub: "عدّل الأسعار هنا، ثم افتح الفاتورة للتصوير والإرسال",
      body,
      footer: `
        <button class="primaryBtn" id="mOpenPrettyInvoice" type="button">
          فتح الفاتورة
        </button>

        <button class="ghostBtn" id="mCloseLocalPrices" type="button">
          إغلاق
        </button>
      `
    });

    $("#mCloseLocalPrices").onclick = closeModal;

    $("#mOpenPrettyInvoice").onclick = () => {
      window.openLocalCustomerInvoice(encodeURIComponent(customer));
    };
  }catch(e){
    toast("bad", "خطأ", e.message);
  }
};

window.saveLocalSalePrice = async function(saleId){
  const input = document.querySelector(`[data-sale-price="${CSS.escape(saleId)}"]`);
  const unitPrice = Number(input?.value || 0);

  if(!(unitPrice > 0)){
    toast("warn", "تنبيه", "اكتب سعر صحيح");
    return;
  }

  try{
    await apiJson(API.localStockSalePrice, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleId, unitPrice })
    });

    toast("good", "تم", "تم حفظ السعر");
    await loadLocalStock();
  }catch(e){
    toast("bad", "خطأ", e.message);
  }
};

window.settleLocalCustomer = async function(customerEncoded){
  const customer = decodeURIComponent(customerEncoded || "");

  const ok = await appConfirm({
    title: "ترحيل كاش مسقط",
    message: `سيتم ترحيل المبالغ غير المرحلة على ${customer} إلى كاش مسقط.`,
    okText: "ترحيل",
    cancelText: "إلغاء",
    warn: true
  });

  if(!ok) return;

  try{
    const out = await apiJson(API.localStockCustomerSettle, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer })
    });

    toast("good", "تم", `تم ترحيل ${fmt(out.amount || 0)} ر.ع إلى كاش مسقط`);

    await loadLocalStock();
    await loadLedger();
    renderDashboard();
  }catch(e){
    toast("bad", "خطأ", e.message);
  }
};

$("#btnLocalStockRefresh")?.addEventListener("click", () => {
  loadLocalStock().catch((e) => toast("bad", "خطأ", e.message));
});

function btMoney(n){
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return "0.000";
  return v.toFixed(3);
}

function btDateTime(v){
  if (!v) return "—";
  try{
    return new Date(v).toLocaleString("ar-OM", {
      year:"numeric",
      month:"2-digit",
      day:"2-digit",
      hour:"2-digit",
      minute:"2-digit"
    });
  }catch{
    return String(v);
  }
}

function btEsc(s){
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));
}

function btEscAttr(s){
  return btEsc(s).replace(/`/g, "&#096;");
}

function btOpenModal(title, sub, bodyHtml, footerHtml){
  const backdrop = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalSub = document.getElementById("modalSub");
  const modalBody = document.getElementById("modalBody");
  const modalFooter = document.getElementById("modalFooter");

  if (!backdrop || !modalTitle || !modalBody || !modalFooter) return;

  modalTitle.textContent = title || "";
  if (modalSub) modalSub.textContent = sub || "";
  modalBody.innerHTML = bodyHtml || "";
  modalFooter.innerHTML = footerHtml || "";

  backdrop.classList.add("show");
  backdrop.setAttribute("aria-hidden", "false");
}

function btCloseModal(){
  const backdrop = document.getElementById("modalBackdrop");
  if (!backdrop) return;

  backdrop.classList.remove("show");
  backdrop.setAttribute("aria-hidden", "true");
}

async function openLocalStockInvoice(customer){
  customer = String(customer || "").trim();

  if (!customer) {
    toast("bad", "خطأ", "اسم الشخص غير موجود");
    return;
  }

  try{
    const r = await fetch(
      "/api/money/local-stock/customer-invoice?customer=" + encodeURIComponent(customer),
      {
        headers: {
          "x-admin-key": adminKey()
        },
        cache: "no-store"
      }
    );

    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(d.error || "فشل تحميل الفاتورة");
    }

    const items = Array.isArray(d.items) ? d.items : [];

    if (!items.length) {
      toast("warn", "لا توجد فاتورة", "لا توجد منتجات غير مرحلة لهذا الشخص");
      return;
    }

    const invoiceNo = "LS-" + Date.now().toString().slice(-7);
    const nowText = btDateTime(new Date().toISOString());

    const rowsHtml = items.map((x, idx) => {
      const img = x.image || "";
      const unit = Number(x.unitPrice || 0) || 0;
      const total = Number(x.total || 0) || 0;
      const qty = Number(x.qty || 0) || 0;

      const priceText = unit > 0
        ? `${btMoney(unit)} ر.ع`
        : "لم يحدد";

      const totalText = total > 0
        ? `${btMoney(total)} ر.ع`
        : "بانتظار السعر";

      return `
        <div class="localInvoiceItem">
          <div class="localInvoiceIndex">${idx + 1}</div>

          <div class="localInvoiceImg">
            ${
              img
                ? `<img src="${btEscAttr(img)}" alt="" onerror="this.style.display='none';this.parentElement.classList.add('noImg');this.parentElement.textContent='صورة';">`
                : `صورة`
            }
          </div>

          <div class="localInvoiceInfo">
            <b>${btEsc(x.product_name || "منتج")}</b>
            <small>
              ${x.sku ? `SKU: ${btEsc(x.sku)} • ` : ""}
              ${x.barcode ? `باركود: ${btEsc(x.barcode)}` : ""}
            </small>
            <em>${btDateTime(x.at)}</em>
          </div>

          <div class="localInvoiceQty">
            <span>الكمية</span>
            <b>${qty}</b>
          </div>

          <div class="localInvoicePrice">
            <span>السعر</span>
            <b>${priceText}</b>
          </div>

          <div class="localInvoiceLineTotal">
            <span>المجموع</span>
            <b>${totalText}</b>
          </div>
        </div>
      `;
    }).join("");

    const unpricedNotice = Number(d.unpricedCount || 0) > 0
      ? `
        <div class="localInvoiceNotice">
          يوجد ${Number(d.unpricedCount || 0)} منتج بدون سعر. عدّل الأسعار قبل إرسال الفاتورة النهائية.
        </div>
      `
      : "";

    const body = `
      <div class="localInvoiceShot" id="localInvoiceShot">
        <div class="localInvoiceHeader">
          <div>
            <div class="localInvoiceBrand">Hala Beauty</div>
            <div class="localInvoiceSub">فاتورة بيع محلي</div>
          </div>

          <div class="localInvoiceLogo">
            <img src="/hb-logo.png" alt="">
          </div>
        </div>

        <div class="localInvoiceMeta">
          <div>
            <span>اسم الشخص</span>
            <b>${btEsc(d.customer || customer)}</b>
          </div>
          <div>
            <span>رقم الفاتورة</span>
            <b>${invoiceNo}</b>
          </div>
          <div>
            <span>وقت الفاتورة</span>
            <b>${nowText}</b>
          </div>
          <div>
            <span>عدد المنتجات</span>
            <b>${Number(d.totalQty || 0)}</b>
          </div>
        </div>

        ${unpricedNotice}

        <div class="localInvoiceItems">
          ${rowsHtml}
        </div>

        <div class="localInvoiceTotalBox">
          <span>الإجمالي المطلوب</span>
          <b>${btMoney(d.totalAmount)} ر.ع</b>
        </div>

        <div class="localInvoiceFooterText">
          شكرًا لتعاملكم مع Hala Beauty
        </div>
      </div>
    `;

    const footer = `
      <button class="primaryBtn" type="button" onclick="window.print()">
        طباعة / حفظ PDF
      </button>

      <button class="softBtn" type="button" onclick="btCloseModal()">
        إغلاق
      </button>
    `;

    btOpenModal(
      "فاتورة البيع المحلي",
      "صممت لتصوير الشاشة وإرسالها للشخص",
      body,
      footer
    );
  }catch(e){
    toast("bad", "خطأ", e.message || String(e));
  }
}

window.openLocalStockInvoice = openLocalStockInvoice;
window.btCloseModal = btCloseModal;

/* ======================
   Boot
   ====================== */
initDates();
loadAll();

/* expose */

window.previewReceipt = previewReceipt;
window.editShipping = editShipping;
window.transferSingle = transferSingle;
window.viewArchive = viewArchive;
window.exportArchiveBatch = exportArchiveBatch;
window.settleDeliveryOrder = settleDeliveryOrder;
window.editDeliveryNote = editDeliveryNote;
window.cancelDeliveryOrder = cancelDeliveryOrder;
window.debtQuick = debtQuick;
window.removeDebt = removeDebt;
