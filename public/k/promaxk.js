(() => {
  "use strict";

  /* =========================
     Routes
     ========================= */
  const API = {
    summary: "/api/money/summary",
    transferOrders: "/api/money/transfer",
    debts: "/api/money/debts",
    debtAdd: "/api/money/debts/add",
    debtPay: "/api/money/debts/pay",
    debtRemove: "/api/money/debts/remove",
    debtReorder: "/api/money/debts/reorder", // ✅ جديد
    expenses: "/api/money/expenses",
    expTransfer: "/api/money/expenses/transfer",
    reports: "/api/money/reports", // ✅ جديد للتقارير
  };
  /* =========================
     Storage Keys
     ========================= */
  const LS = {
    adminKey: "ADMIN_KEY",
    view: "bt_money_view_v2",
    vendors: "bt_money_vendors_v1",
  };

  /* =========================
     Icons
     ========================= */
  const ICONS = {
    grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>`,
    repeat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
    wallet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/><path d="M2 10h20"/><path d="M18 12h2"/></svg>`,
    receipt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>`,
    send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2Z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
    minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>`,
    warn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.3 2.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    up: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5l-7 7h14z"/><path d="M5 19h14"/></svg>`,
    down: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19l7-7H5z"/><path d="M5 5h14"/></svg>`,
    sort: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 11H3"/><path d="M12 6H3"/><path d="M12 16H3"/><path d="M21 18H14"/><path d="m19 14 2 2-2 2"/><path d="M14 6h7"/><path d="m19 10 2-2-2-2"/></svg>`,
    excel:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h10v16H4z"/><path d="M14 4l6 6v10H14z"/><path d="M7 10l4 4M11 10l-4 4"/></svg>`,
  };

/* =========================
   Global State (Fix: state is not defined)
   ========================= */
const state = {
  summary: {},
  debts: { items: [], total: 0, totalNet: 0 },
  expenses: { items: [], total: 0 },
};
    /* =========================
     XLSX (Excel) Helpers
     ========================= */
  function dayNameAR(d) {
    const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    return days[d.getDay()] || "";
  }

  function fmtDateAR(iso) {
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${da} ${hh}:${mm} (${dayNameAR(d)})`;
    } catch {
      return String(iso || "");
    }
  }

  async function exportExcel({ fileName, sheetName, rows }) {
    if (!window.XLSX) throw new Error("مكتبة XLSX غير محملة. تأكد أنك ضايفها في index.html");
    const ws = window.XLSX.utils.json_to_sheet(rows || []);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName || "تقرير");
    window.XLSX.writeFile(wb, fileName || "report.xlsx");
  }
  
  /* =========================
     DOM Helpers
     ========================= */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
function setText(sel, val){
  const el = $(sel);
  if (el) el.textContent = (val ?? "");
}
function setHtml(sel, val){
  const el = $(sel);
  if (el) el.innerHTML = (val ?? "");
}
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
  
  const money = (n) =>
    num(n).toLocaleString("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

  const dateFmt = (d) => {
    if (!d) return "—";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return String(d);
    return dt.toLocaleString("ar", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  /* =========================
     Vendors: حفظ/اقتراح أسماء التجار
     ========================= */
  function loadVendors() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS.vendors) || "[]");
      return Array.isArray(arr) ? arr.filter(Boolean).map(String) : [];
    } catch {
      return [];
    }
  }

  function saveVendors(list) {
    const clean = Array.from(
      new Set((list || []).map((x) => String(x || "").trim()).filter(Boolean))
    ).slice(0, 300);
    localStorage.setItem(LS.vendors, JSON.stringify(clean));
  }

  function addVendorToHistory(name) {
    const v = String(name || "").trim();
    if (!v) return;
    const current = loadVendors();
    const next = [v, ...current.filter((x) => x !== v)];
    saveVendors(next);
  }

  function vendorsFromStateDebts() {
    const items = state.debts?.items || [];
    return items.map((x) => String(x.vendor || "").trim()).filter(Boolean);
  }

  function getAllVendorSuggestions() {
    const a = loadVendors();
    const b = vendorsFromStateDebts();
    return Array.from(new Set([...b, ...a])).filter(Boolean);
  }

  /* =========================
     UI: Loading + Toast + Modal
     ========================= */
function showLoading(title = "جارٍ الشغل…", hint = "لحظة وبتكمل") {
  const box = $("#loading");
  if (!box) return;
  const t = $("#loadingTitle");
  const h = $("#loadingHint");
  if (t) t.textContent = title;
  if (h) h.textContent = hint;
  box.classList.add("show");
}
  
  function hideLoading() {
    $("#loading")?.classList.remove("show");
  }

  function toast(type, title, msg, ms = 3200) {
    const host = $("#toasts");
    if (!host) return;
    const el = document.createElement("div");
    el.className = `toast ${type || ""}`;

    const icon = type === "warn" ? ICONS.warn : type === "bad" ? ICONS.warn : ICONS.check;

    el.innerHTML = `
      <div class="t-ic">${icon}</div>
      <div class="t-b">
        <b>${esc(title || "")}</b>
        <p>${esc(msg || "")}</p>
      </div>
      <button class="t-x" type="button" aria-label="Close">${ICONS.x}</button>
    `;
    el.querySelector(".t-x").onclick = () => el.remove();
    host.appendChild(el);

    setTimeout(() => {
      if (!el.isConnected) return;
      el.classList.add("out");
      setTimeout(() => el.remove(), 200);
    }, ms);
  }

  function makeBtn({ cls = "btn", html = "", onClick }) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.innerHTML = html;
    if (onClick) b.onclick = onClick;
    return b;
  }

  function openModal({ iconHtml = "", title = "", sub = "", bodyHtml = "", footerActions = [], topActions = [] }) {
    $("#modalIcon").innerHTML = iconHtml;
    $("#modalTitle").textContent = title;
    $("#modalSub").textContent = sub;
    $("#modalBody").innerHTML = bodyHtml;

    const top = $("#modalTopActions");
    const foot = $("#modalFooter");

    if (top) {
      top.innerHTML = "";
      topActions.forEach((b) => top.appendChild(b));
    }
    if (foot) {
      foot.innerHTML = "";
      footerActions.forEach((b) => foot.appendChild(b));
    }

    $("#modal")?.classList.add("show");
    setTimeout(() => $("#modalBody input")?.focus(), 60);
  }

  function closeModal() {
    $("#modal")?.classList.remove("show");
  }

  function confirmModal({ title, message, okText = "نعم", cancelText = "إلغاء", danger = false }) {
    return new Promise((resolve) => {
      openModal({
        iconHtml: danger ? ICONS.warn : ICONS.check,
        title,
        sub: message,
        bodyHtml: "",
        footerActions: [
          makeBtn({
            cls: "btn",
            html: `${ICONS.x}<span> ${esc(cancelText)} </span>`,
            onClick: () => {
              closeModal();
              resolve(false);
            },
          }),
          makeBtn({
            cls: danger ? "btn danger" : "btn primary",
            html: `${ICONS.check}<span> ${esc(okText)} </span>`,
            onClick: () => {
              closeModal();
              resolve(true);
            },
          }),
        ],
      });
    });
  }

  function bindModalClose() {
    $("#modal")?.addEventListener("click", (e) => {
      if (e.target && e.target.id === "modal") closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("#modal")?.classList.contains("show")) closeModal();
    });
  }

  /* =========================
     Admin Key + Network
     ========================= */
  function ensureAdminKey() {
    let k = (localStorage.getItem(LS.adminKey) || "").trim();
    if (!k) {
      k = prompt("أدخل مفتاح المدير:") || "";
      k = k.trim();
      if (k) localStorage.setItem(LS.adminKey, k);
    }
    return k;
  }

  function clearAdminKey() {
    localStorage.removeItem(LS.adminKey);
  }

  async function apiJson(url, opts = {}, { timeoutMs = 20000, retries = 1 } = {}) {
    const key = ensureAdminKey();
    if (!key) throw new Error("401");

    let lastErr;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
const res = await fetch(url, {
  cache: "no-store",
  ...opts,
  headers: {
    Accept: "application/json",
    "x-admin-key": key,
    ...(opts.headers || {}),
  },
  signal: ctrl.signal,
});
        const text = await res.text().catch(() => "");
        let json = {};
        try {
          json = JSON.parse(text || "{}");
        } catch {
          json = { raw: text };
        }

        if (!res.ok) {
          if (res.status === 401) {
            clearAdminKey();
            throw new Error("401");
          }
          throw new Error(String(json?.error || json?.message || text || `HTTP ${res.status}`));
        }

        return json;
      } catch (e) {
        lastErr = e;

        if (String(e?.message || e) === "401") throw e;

        const isAbort = String(e?.name) === "AbortError";
        if (isAbort) lastErr = new Error("انتهت مهلة الطلب (Timeout).");

        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 450 + attempt * 350));
          continue;
        }
      } finally {
        clearTimeout(t);
      }
    }

    throw lastErr || new Error("Unknown error");
  }

  /* =========================
     Save/Load view
     ========================= */
  function loadView() {
    try {
      return JSON.parse(localStorage.getItem(LS.view) || "{}") || {};
    } catch {
      return {};
    }
  }

  function saveView(partial) {
    const cur = loadView();
    const next = { ...cur, ...partial };
    localStorage.setItem(LS.view, JSON.stringify(next));
  }

  /* =========================
     Render KPIs
     ========================= */
function renderKPIs() {
  const s = state.summary || {};
  const totals = s.totals || {};
  const lists = s.lists || {};

  const amwal = num(totals.amwal);
  const bank = num(totals.bank);
  const other = num(totals.other);

  // ✅ البنك = بنك + أخرى
  const bankTransfer = bank + other;
  const all = num(totals.all ?? (amwal + bankTransfer));

  // Safe setters (بدون ما نعتمد على وجود عناصر)
  const setText = (sel, val) => {
    const el = $(sel);
    if (el) el.textContent = (val ?? "");
  };
  const setClass = (sel, cls) => {
    const el = $(sel);
    if (el) el.className = cls;
  };

  setText("#sumAmwal", money(amwal));
  setText("#sumBank", money(bankTransfer));

  // ✅ أخرى لا تنعرض كمبلغ مستقل (لأنها داخلة في البنك)
  setText("#sumOther", money(0));

  setText("#sumAll", money(all));

  const debtTotal = num(state?.debts?.total);
  const expTotal = num(state?.expenses?.total);

  setText("#kpiDebt", money(debtTotal));
  setText("#kpiExp", money(expTotal));

  const debtBadge = $("#kpiDebtBadge");
  if (debtBadge) {
    let level = "";
    let color = "";
    if (debtTotal >= 900) { level = "مرتفع"; color = "bad"; }
    else if (debtTotal >= 500) { level = "متوسط"; color = "warn"; }
    else if (debtTotal >= 100) { level = "خفيف"; color = "good"; }
    else { level = "منخفض جدًا"; color = "good"; }
    debtBadge.textContent = level;
    debtBadge.className = "badge " + color;
  }

  const expBadge = $("#kpiExpBadge");
  if (expBadge) {
    let level = "";
    let color = "";
    if (expTotal >= 900) { level = "مرتفع"; color = "bad"; }
    else if (expTotal >= 500) { level = "متوسط"; color = "warn"; }
    else if (expTotal >= 100) { level = "خفيف"; color = "good"; }
    else { level = "منخفض جدًا"; color = "good"; }
    expBadge.textContent = level;
    expBadge.className = "badge " + color;
  }

  const ordersCount =
    (Array.isArray(lists.amwal) ? lists.amwal.length : 0) +
    (Array.isArray(lists.bank) ? lists.bank.length : 0) +
    (Array.isArray(lists.other) ? lists.other.length : 0);

  setText("#kpiOrders", String(ordersCount));
  setText("#kpiSince", s.sinceISO ? `من: ${s.sinceISO}` : "—");
}  
  /* =========================
     Render Overview + Orders (بدون تغيير)
     ========================= */
  function renderOverview() {
const q = "";
    const mode = $("#modeOverview")?.value || "all";

    saveView({ qOverview: $("#qOverview").value || "", modeOverview: mode });

    const s = state.summary || {};
    const lists = s.lists || {};

    const pick = [];
    if (mode === "all" || mode === "amwal") pick.push(["amwal", "أموال"]);
    if (mode === "all" || mode === "bank") pick.push(["bank", "بنك"]);

const chunks = pick.map(([k, title]) => {
  const arr =
    k === "bank"
      ? ([]).concat(Array.isArray(lists.bank) ? lists.bank : [])
            .concat(Array.isArray(lists.other) ? lists.other : [])
      : (Array.isArray(lists[k]) ? lists[k] : []);

  const filtered = arr.filter((o) => {
    if (!q) return true;
    const bag = `${o.orderName || ""} ${o.customer || ""} ${o.paid || ""}`.toLowerCase();
    return bag.includes(q);
  });

  const rows = filtered.slice(0, 20).map((o) => `
    <tr>
      <td data-label="الطلب">${esc(o.orderName || "")}</td>
      <td data-label="العميل" class="muted">${esc(o.customer || "—")}</td>
      <td data-label="المبلغ"><b>${money(o.paid)}</b> <span class="muted">OMR</span></td>
    </tr>
  `);

  return `
    <div style="padding:12px;border-bottom:1px solid rgba(0,0,0,.06)">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div style="font-weight:1100">${esc(title)}</div>
        <div style="color:var(--muted);font-size:12px;font-weight:900">عدد: ${filtered.length}</div>
      </div>
      <div style="margin-top:10px;border:1px solid rgba(0,0,0,.08);border-radius:14px;overflow:auto;max-height:280px">
        ${
          filtered.length
            ? `<table>
                <thead><tr><th>الطلب</th><th>العميل</th><th>المبلغ</th></tr></thead>
                <tbody>${rows.join("")}</tbody>
              </table>`
            : `<div class="empty">لا يوجد</div>`
        }
      </div>
    </div>
  `;
});

    
    $("#overviewBody").innerHTML = chunks.join("") || `<div class="empty">لا يوجد بيانات</div>`;
  }

  function renderOrders() {
    const s = state.summary || {};
    const lists = s.lists || {};

    const all = []
      .concat(Array.isArray(lists.amwal) ? lists.amwal.map((x) => ({ ...x, _g: "أموال" })) : [])
      .concat(Array.isArray(lists.bank) ? lists.bank.map((x) => ({ ...x, _g: "بنك" })) : [])
      .concat(Array.isArray(lists.other) ? lists.other.map((x) => ({ ...x, _g: "بنك" })) : []);

    $("#ordersCount").textContent = `عدد: ${all.length}`;

const limit = num($("#ordersLimit")?.value || 140);

// ✅ بدون بحث/فلترة: اعرض كل الطلبات حتى limit
const rows = all.slice(0, limit);
    
    const tb = $("#ordersTbody");
    tb.innerHTML = "";

    for (const o of rows) {
      const tr = document.createElement("tr");
      const dt = o.at || o.createdAt || o.date || "";
      tr.innerHTML = `
        <td data-label="الطلب">${esc(o.orderName || "")}</td>
        <td data-label="العميل" class="muted">${esc(o.customer || "—")}</td>
        <td data-label="المبلغ"><b>${money(o.paid)}</b> <span class="muted">OMR</span></td>
        <td data-label="البوابة">${esc(o._g || "—")}</td>
        <td data-label="التاريخ" class="muted">${esc(dt ? dateFmt(dt) : "—")}</td>
      `;
      tb.appendChild(tr);
    }

    $("#ordersEmpty").style.display = rows.length ? "none" : "";
  }

  /* =========================
     Debts (ORDER + NEGATIVE)
     ========================= */
  function renderDebts() {
    const q = ($("#qDebts").value || "").trim().toLowerCase();
    saveView({ qDebts: $("#qDebts").value || "" });

    // ✅ لا نفرز بالمبلغ هنا — السيرفر يرجّعها مرتبة حسب الأولوية
    const rows = (state.debts?.items || [])
      .filter((x) => !q || String(x.vendor || "").toLowerCase().includes(q));

    const tb = $("#debtsTbody");
    tb.innerHTML = "";

    for (const d of rows) {
      const amount = num(d.amount);

      let level = "";
      let text = "";

      // ✅ دعم السالب: معناها رصيد لك عند التاجر
      if (amount < 0) { level = "good"; text = "رصيد لك"; }
      else if (amount >= 900) { level = "bad"; text = "مرتفع"; }
      else if (amount >= 500) { level = "warn"; text = "متوسط"; }
      else if (amount >= 100) { level = "good"; text = "خفيف"; }
      else { level = "good"; text = "منخفض جدًا"; }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="التاجر">
          ${esc(d.vendor || "—")}
          <span class="badge ${level}" style="margin-inline-start:8px">${text}</span>
        </td>
        <td data-label="المبلغ"><b>${money(amount)}</b> <span class="muted">OMR</span></td>
        <td data-label="إجراءات"><div class="row-actions"></div></td>
      `;

      const actions = tr.querySelector(".row-actions");

      const btnPay = document.createElement("button");
      btnPay.className = "mini";
      btnPay.innerHTML = `${ICONS.minus}<span>سداد</span>`;
      btnPay.onclick = () => debtForm({ mode: "pay", presetVendor: d.vendor });

      const btnAdd = document.createElement("button");
      btnAdd.className = "mini gray";
      btnAdd.innerHTML = `${ICONS.plus}<span>إضافة</span>`;
      btnAdd.onclick = () => debtForm({ mode: "add", presetVendor: d.vendor });

      const btnRemove = document.createElement("button");
      btnRemove.className = "mini danger";
      btnRemove.innerHTML = `${ICONS.trash}<span>حذف</span>`;
      btnRemove.onclick = async () => {
        const ok = await confirmModal({
          title: "حذف دين",
          message: `تأكيد حذف دين التاجر: "${d.vendor}"؟`,
          danger: true,
          okText: "احذف",
          cancelText: "إلغاء",
        });
        if (!ok) return;

        await runSafe(async () => {
          await apiJson(API.debtRemove, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vendor: d.vendor }),
          });
          toast("good", "تم", "تم حذف الدين");
          await loadAll();
        }, "جارٍ الحذف…", "لحظة");
      };

      actions.appendChild(btnAdd);
      actions.appendChild(btnPay);
      actions.appendChild(btnRemove);

      tb.appendChild(tr);
    }

    $("#debtsEmpty").style.display = rows.length ? "none" : "";
  }

  function buildVendorDatalistHtml(vendors) {
    const opts = vendors.map((v) => `<option value="${esc(v)}"></option>`).join("");
    return `<datalist id="vendorList">${opts}</datalist>`;
  }

  function buildVendorSelectHtml(vendors, presetVendor) {
    const list = vendors.slice();
    const hasPreset = presetVendor && list.includes(presetVendor);
    if (presetVendor && !hasPreset) list.unshift(presetVendor);

    const options = [
      `<option value="">— اختر تاجر —</option>`,
      ...list.map((v) => `<option value="${esc(v)}"${v === presetVendor ? " selected" : ""}>${esc(v)}</option>`),
      `<option value="__new__">+ اسم جديد…</option>`,
    ].join("");

    return `
      <label style="font-weight:1100">اختيار سريع (للجوال)</label>
      <select class="select" id="mVendorPick" style="width:100%">
        ${options}
      </select>
    `;
  }

  function debtForm({ mode, presetVendor = "" }) {
    const isAdd = mode === "add";
    const vendors = getAllVendorSuggestions();

    openModal({
      iconHtml: isAdd ? ICONS.plus : ICONS.minus,
      title: isAdd ? "إضافة دين" : "سداد دين",
      sub: isAdd ? "اكتب اسم التاجر والمبلغ" : "اختر من الأسماء أو اكتب اسم جديد + المبلغ",
      bodyHtml: `
        <div style="display:grid;gap:10px">
          ${!isAdd ? buildVendorSelectHtml(vendors, presetVendor) : ""}

          <label style="font-weight:1100">اسم التاجر</label>
          <input class="input" id="mVendor" list="vendorList"
                 placeholder="مثال: يوسف / الأغبري"
                 value="${esc(presetVendor)}">

          ${buildVendorDatalistHtml(vendors)}

          <label style="font-weight:1100">المبلغ</label>
          <input class="input" id="mAmount" type="number" min="0" step="0.001" inputmode="decimal" placeholder="0.000">
        </div>
      `,
      footerActions: [
        makeBtn({
          cls: "btn",
          html: `${ICONS.x}<span>إلغاء</span>`,
          onClick: closeModal,
        }),
        makeBtn({
          cls: "btn primary",
          html: `${ICONS.check}<span>${isAdd ? "إضافة" : "سداد"}</span>`,
          onClick: async () => {
            const vendor = ($("#mVendor")?.value || "").trim();
            const amount = num($("#mAmount")?.value || 0);

            if (!vendor) return toast("warn", "ناقص", "اكتب اسم التاجر");
            if (!(amount > 0)) return toast("warn", "ناقص", "المبلغ لازم يكون أكبر من صفر");

            await runSafe(async () => {
              // 1) طلب للسيرفر
              await apiJson(isAdd ? API.debtAdd : API.debtPay, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vendor, amount }),
              });

              // 2) حفظ اسم التاجر محلياً (إضافة + سداد)
              addVendorToHistory(vendor);

              // 3) تحديث محلي سريع (Signed) ثم loadAll للتأكيد
              let existing = (state.debts.items || []).find((d) => d.vendor === vendor);

              if (isAdd) {
                if (existing) existing.amount = num(existing.amount) + amount;
                else state.debts.items.push({ vendor, amount, priority: 999999 });
                // إذا صار صفر بالضبط، نشيله من العرض
                if (existing && num(existing.amount) === 0) {
                  state.debts.items = state.debts.items.filter((d) => d.vendor !== vendor);
                }
              } else {
                if (!existing) {
                  // سمحنا بالسداد حتى لو ما كان موجود (لكن في الغالب بيكون موجود)
                  state.debts.items.push({ vendor, amount: -amount, priority: 999999 });
                } else {
                  existing.amount = num(existing.amount) - amount;
                  // ✅ لا نحذف لو صار سالب — هذا المطلوب
                  if (num(existing.amount) === 0) {
                    state.debts.items = state.debts.items.filter((d) => d.vendor !== vendor);
                  }
                }
              }

              // total (للـ KPI): مجموع الموجب فقط
              state.debts.total = (state.debts.items || []).reduce((s, d) => s + (num(d.amount) > 0 ? num(d.amount) : 0), 0);

              renderDebts();
              renderKPIs();

              toast(
                "good",
                "تم بنجاح",
                `${isAdd ? "تم إضافة" : "تم سداد"} ${money(amount)} OMR للتاجر ${vendor}`
              );

              closeModal();

              // 4) مزامنة نهائية من السيرفر (وتجيب ترتيب الأولوية الصحيح)
              await loadAll();
            }, "جارٍ التنفيذ…", "بنحدّث البيانات");
          },
        }),
      ],
    });

    const pick = $("#mVendorPick");
    if (pick) {
      pick.addEventListener("change", () => {
        const v = pick.value || "";
        if (v === "__new__") {
          $("#mVendor").value = "";
          $("#mVendor").focus();
        } else if (v) {
          $("#mVendor").value = v;
          $("#mAmount").focus();
        }
      });
    }
  }

  // ✅ ترتيب الديون (مناسب للجوال: Up/Down)
  function openDebtReorderModal() {
    const list = (state.debts.items || []).map((x) => String(x.vendor || "")).filter(Boolean);
    if (!list.length) return toast("warn", "لا يوجد", "ما عندك ديون لترتيبها");

    const renderList = (arr) => {
      return `
        <div style="display:grid;gap:8px">
          ${arr
            .map(
              (v, i) => `
            <div class="card" style="padding:10px;border:1px solid rgba(0,0,0,.08);border-radius:14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
              <div style="font-weight:1100;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v)}</div>
              <div style="display:flex;gap:8px;flex-shrink:0">
                <button class="mini gray" data-move="up" data-i="${i}" ${i === 0 ? "disabled" : ""}>${ICONS.up}<span>فوق</span></button>
                <button class="mini gray" data-move="down" data-i="${i}" ${i === arr.length - 1 ? "disabled" : ""}>${ICONS.down}<span>تحت</span></button>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
      `;
    };

    let working = list.slice();

    const draw = () => {
      $("#modalBody").innerHTML = renderList(working);

      $$("#modalBody button[data-move]").forEach((btn) => {
        btn.onclick = () => {
          const i = num(btn.getAttribute("data-i"));
          const dir = btn.getAttribute("data-move");
          const j = dir === "up" ? i - 1 : i + 1;
          if (j < 0 || j >= working.length) return;
          const tmp = working[i];
          working[i] = working[j];
          working[j] = tmp;
          draw();
        };
      });
    };

    openModal({
      iconHtml: ICONS.sort,
      title: "ترتيب الديون",
      sub: "حرّك التاجر فوق/تحت حسب الأولوية — وسيتم حفظ الترتيب في السيرفر",
      bodyHtml: renderList(working),
      footerActions: [
        makeBtn({ cls: "btn", html: `${ICONS.x}<span>إغلاق</span>`, onClick: closeModal }),
        makeBtn({
          cls: "btn primary",
          html: `${ICONS.check}<span>حفظ الترتيب</span>`,
          onClick: async () => {
            await runSafe(async () => {
              await apiJson(API.debtReorder, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ list: working }),
              });
              toast("good", "تم", "تم حفظ ترتيب الديون");
              closeModal();
              await loadAll();
            }, "جارٍ الحفظ…", "بنحدث السيرفر");
          },
        }),
      ],
    });

    draw();
  }

  // ✅ زر ترتيب: نضيفه بدون تعديل HTML
function injectDebtReorderButton() {
  if (document.getElementById("btnDebtReorder")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btnDebtReorder";
  btn.className = "btn";
  // ✅ نفس أسلوب HTML عندك (span.ic + data-ic)
  btn.innerHTML = `<span class="ic" data-ic="sort"></span>ترتيب الديون`;
  btn.addEventListener("click", openDebtReorderModal);

  const addBtn = document.getElementById("btnDebtAdd");
  if (addBtn && addBtn.parentElement) {
    addBtn.parentElement.insertBefore(btn, addBtn.nextSibling);
  } else {
    // fallback بسيط: حطه داخل أدوات الديون
    const host = document.querySelector('#panelDebts .panel-hd .tools');
    if (host) host.appendChild(btn);
    else console.warn("Debt reorder button: no host found");
  }

  // ✅ عبّي الأيقونة بنفس طريقة باقي الصفحة
  btn.querySelectorAll("[data-ic]").forEach((el) => {
    const k = el.getAttribute("data-ic");
    el.innerHTML = ICONS[k] || el.innerHTML;
  });
}
  /* =========================
     Expenses + Transfers (بدون تغيير مؤثر)
     ========================= */
function previewReceipt(url) {
  const isImage = String(url).match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const id = "mg_" + Math.random().toString(36).slice(2);

  openModal({
    iconHtml: ICONS.eye,
    title: "معاينة الفاتورة",
    sub: isImage ? "المس الصورة واسحب — العدسة فوق إصبعك" : "عرض المستند",
    bodyHtml: `
      <style>
        /* ✅ كسر أي CSS خارجي يقص الصورة داخل المودال */
        #${id}_box { max-height:82vh !important; overflow:auto !important; }
        #${id}_wrap { position:relative !important; overflow:visible !important; }
        #${id}_img  {
          width:100% !important;
          height:auto !important;
          max-width:100% !important;
          max-height:none !important;     /* ✅ يمنع القص بسبب max-height */
          object-fit:contain !important;  /* ✅ يمنع cover */
          display:block !important;
        }
      </style>

      <div id="${id}_box" style="width:100% !important; padding:6px !important;">
        ${
          isImage
            ? `
              <div id="${id}_wrap" style="margin:auto !important;">
                <img id="${id}_img"
                  src="${esc(url)}"
                  alt="receipt"
                  style="touch-action:none !important; user-select:none !important; -webkit-user-drag:none !important;"
                />

                <div id="${id}_lens"
                  style="
                    position:absolute;
                    width:160px;height:160px;
                    border-radius:50%;
                    border:2px solid rgba(0,0,0,.25);
                    box-shadow:0 10px 30px rgba(0,0,0,.18);
                    display:none;
                    pointer-events:none;
                    background-repeat:no-repeat;
                    background-image:url('${esc(url)}');
                    z-index:5;
                  "
                ></div>

                <div id="${id}_dot"
                  style="
                    position:absolute;
                    width:10px;height:10px;
                    border-radius:50%;
                    background:rgba(0,0,0,.55);
                    outline:2px solid rgba(255,255,255,.9);
                    display:none;
                    pointer-events:none;
                    z-index:6;
                  "
                ></div>

                <div style="margin-top:10px;text-align:center">
                  <a href="${esc(url)}" target="_blank" rel="noreferrer"
                     style="font-weight:1100;color:var(--bp)">فتح في تبويب</a>
                </div>
              </div>
            `
            : `
              <iframe src="${esc(url)}" style="width:100% !important;height:82vh !important;border:none !important;"></iframe>
            `
        }
      </div>
    `,
    footerActions: [
      makeBtn({ cls: "btn", html: `${ICONS.x}<span>إغلاق</span>`, onClick: closeModal }),
    ],
  });

  if (!isImage) return;

  const img  = document.getElementById(`${id}_img`);
  const lens = document.getElementById(`${id}_lens`);
  const dot  = document.getElementById(`${id}_dot`);
  if (!img || !lens || !dot) return;

  const ZOOM = 2.6;
  const LENS = 160;
  const OFFSET_Y = 120;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function updateLens(clientX, clientY) {
    const r = img.getBoundingClientRect();

    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) {
      lens.style.display = "none";
      dot.style.display = "none";
      return;
    }

    lens.style.display = "block";
    dot.style.display = "block";

    const x = clientX - r.left;
    const y = clientY - r.top;

    dot.style.left = clamp(x - 5, 0, r.width - 10) + "px";
    dot.style.top  = clamp(y - 5, 0, r.height - 10) + "px";

    const lensLeft = clamp(x - LENS / 2, 0, r.width - LENS);
    const lensTop  = clamp((y - OFFSET_Y) - LENS / 2, 0, r.height - LENS);

    lens.style.left = lensLeft + "px";
    lens.style.top  = lensTop + "px";

    lens.style.backgroundSize = `${r.width * ZOOM}px ${r.height * ZOOM}px`;
    lens.style.backgroundPosition =
      `${-(x * ZOOM - LENS / 2)}px ${-(y * ZOOM - LENS / 2)}px`;
  }

  function hide() {
    lens.style.display = "none";
    dot.style.display = "none";
  }

  function ready() {
    img.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      img.setPointerCapture?.(e.pointerId);
      updateLens(e.clientX, e.clientY);
    });
    img.addEventListener("pointermove", (e) => updateLens(e.clientX, e.clientY));
    img.addEventListener("pointerup", hide);
    img.addEventListener("pointercancel", hide);
    img.addEventListener("pointerleave", hide);
  }

  if (img.complete) ready();
  else img.onload = ready;
}
  
  function renderExpenses() {
    const q = ($("#qExp").value || "").trim().toLowerCase();
    saveView({ qExp: $("#qExp").value || "" });

    const rows = (state.expenses?.items || [])
      .filter((x) => !q || String(x.reason || "").toLowerCase().includes(q))
      .sort((a, b) => new Date(b.at || b.date || 0) - new Date(a.at || a.date || 0));

    const tb = $("#expTbody");
    tb.innerHTML = "";

    for (const ex of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td data-label="تحديد"><input type="checkbox" class="chk expChk" value="${esc(ex.id || "")}"></td>
        <td data-label="السبب">${esc(ex.reason || "—")}</td>
        <td data-label="المبلغ"><b>${money(ex.amount || 0)}</b> <span class="muted">OMR</span></td>
        <td data-label="التاريخ" class="muted">${esc(ex.at || ex.date ? dateFmt(ex.at || ex.date) : "—")}</td>
        <td data-label="المرفق"></td>
      `;

      const url = ex.receiptUrl || ex.attachment || "";
      const cell = tr.querySelector("td:last-child");

      if (url) {
        const btn = document.createElement("button");
        btn.className = "mini gray";
        btn.innerHTML = `${ICONS.eye}<span>عرض</span>`;
        btn.onclick = () => previewReceipt(url);
        cell.appendChild(btn);
      } else {
        cell.textContent = "—";
      }

      tb.appendChild(tr);
    }

    $("#expEmpty").style.display = rows.length ? "none" : "";
  }

  async function doOrdersTransfer() {
    const s = state.summary || {};
    const totals = s.totals || {};

    const availAmwal = num(totals.amwal);
    const availBank = num(totals.bank) + num(totals.other); // ✅ بنك + أخرى

const bodyHtml = `
  <div class="trForm">
    <div class="trGrid">
      <div class="trField">
        <label class="trLabel">نوع الترحيل</label>
        <select id="trType" class="trIn">
          <option value="BANK">تحويل بنكي</option>
          <option value="AMWAL">بوابة أمـوال</option>
          <option value="ALL">ترحيل الكل</option>
        </select>
      </div>

      <div class="trField">
        <label class="trLabel">مبلغ جزئي (اختياري)</label>
        <input id="trAmount" class="trIn" inputmode="decimal" placeholder="خليه فاضي لو تشتي ترحيل كامل" />
        <div class="trHint">المتاح: تحويل بنكي ${money(availBank)} — أمـوال ${money(availAmwal)}</div>
      </div>

      <div class="trField trWide">
        <label class="trLabel">ملاحظة</label>
        <input id="trNote" class="trIn" placeholder="اكتب اي ملاحظة تشتيها بتكون في التقرير..." />
      </div>
    </div>
  </div>
`;

    
    const okOpen = await new Promise((resolve) => {
      openModal({
        iconHtml: ICONS.wallet,
        title: "ترحيل",
        sub: "اختر النوع ويمكنك ترحيل جزء من المبلغ مع ملاحظة",
        bodyHtml,
        footerActions: [
          makeBtn({ cls: "btn", html: `${ICONS.x}<span>إلغاء</span>`, onClick: () => { closeModal(); resolve(false); } }),
          makeBtn({ cls: "btn primary", html: `${ICONS.check}<span>ترحيل</span>`, onClick: () => { closeModal(); resolve(true); } }),
        ],
      });
    });

    if (!okOpen) return;

    const type = ($("#trType")?.value || "BANK").trim();
    const amountRaw = ($("#trAmount")?.value || "").trim();
    const amount = amountRaw ? Number(String(amountRaw).replace(/,/g, "")) : null;
    const note = ($("#trNote")?.value || "").trim() || ($("#ordersNote")?.value || "").trim() || "manual";

const ok = await confirmModal({
  title: "تأكيد الترحيل",
  message: type === "ALL" ? "بيتم ترحيل الكل وبتبدأ فترة جديدة." : "بيتم تسجيل الترحيل (جزئي/كامل) حسب النوع.",
  okText: "ايوه رحّل",
  cancelText: "إلغاء",
  danger: true,
});
    
    if (!ok) return;

    await runSafe(async () => {
      const payload = { type, note };
      if (amount && amount > 0 && type !== "ALL") payload.amount = amount;

      await apiJson(API.transferOrders, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      toast("good", "تم", "تم تسجيل الترحيل");
      await loadAll();
    }, "جارٍ الترحيل…", "لحظة");
  }
  
  async function transferSelectedExpenses() {
    const ids = $$(".expChk")
      .filter((c) => c.checked)
      .map((c) => c.value)
      .filter(Boolean);

    if (!ids.length) return toast("warn", "ولا شي", "حدد صرفيات أول");

    const ok = await confirmModal({
      title: "ترحيل المحدد",
      message: `تأكيد ترحيل ${ids.length} صرفية؟`,
      okText: "رحّل",
      cancelText: "إلغاء",
    });
    if (!ok) return;

    await runSafe(async () => {
      try {
        await apiJson(API.expTransfer, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
      } catch {
        await apiJson(API.expTransfer, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
      }
      toast("good", "تم", "تم ترحيل المحدد");
      await loadAll();
    }, "جارٍ الترحيل…", "بنحدّث البيانات");
  }

  async function transferAllExpenses() {
    const ok = await confirmModal({
      title: "ترحيل الكل",
      message: "تأكيد ترحيل كل الصرفيات؟",
      okText: "رحّل الكل",
      cancelText: "إلغاء",
      danger: true,
    });
    if (!ok) return;

    await runSafe(async () => {
      await apiJson(API.expTransfer, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      toast("good", "تم", "تم ترحيل الصرفيات");
      await loadAll();
    }, "جارٍ الترحيل…", "لحظة");
  }
  /* =========================
     Excel Exports (لكل صفحة)
     ========================= */
  async function exportOverviewExcel() {
    const s = state.summary || {};
    const t = s.totals || {};
    const rows = [
      { "البند": "من", "القيمة": String(s.sinceISO || "—") },
      { "البند": "إجمالي أمـوال", "القيمة": num(t.amwal) },
      { "البند": "إجمالي تحويل بنكي (يشمل أخرى)", "القيمة": num(t.bank) + num(t.other) },
      { "البند": "الإجمالي", "القيمة": num(t.all ?? (num(t.amwal) + num(t.bank) + num(t.other))) },
    ];
    await exportExcel({ fileName: "تقرير-نظرة-عامة.xlsx", sheetName: "نظرة عامة", rows });
  }

  async function exportOrdersExcel() {
    const s = state.summary || {};
    const lists = s.lists || {};

    const am = (lists.amwal || []).map((o) => ({
      "النوع": "أمـوال",
      "رقم الطلب": o.orderName,
      "العميل": o.customer,
      "التاريخ": fmtDateAR(o.createdAt),
      "المدفوع": num(o.paid),
      "طريقة الدفع": o.gateway,
    }));

    // ✅ بنك + أخرى معًا
    const bankAll = [...(lists.bank || []), ...(lists.other || [])].map((o) => ({
      "النوع": "تحويل بنكي",
      "رقم الطلب": o.orderName,
      "العميل": o.customer,
      "التاريخ": fmtDateAR(o.createdAt),
      "المدفوع": num(o.paid),
      "طريقة الدفع": o.gateway,
    }));

    await exportExcel({ fileName: "تقرير-الطلبات.xlsx", sheetName: "الطلبات", rows: [...am, ...bankAll] });
  }

  async function exportDebtsExcel() {
    const items = (state.debts?.items || []).map((x) => ({
      "التاجر": x.vendor,
      "المبلغ": num(x.amount),
      "الأولوية": x.priority,
    }));
    await exportExcel({ fileName: "تقرير-الديون.xlsx", sheetName: "الديون", rows: items });
  }

  async function exportExpensesExcel() {
    const items = (state.expenses?.items || []).map((x) => ({
      "التاريخ": fmtDateAR(x.at),
      "السبب": x.reason || "",
      "المبلغ": num(x.amount),
      "الرابط": x.receiptUrl || "",
    }));
    await exportExcel({ fileName: "تقرير-الصرفيات.xlsx", sheetName: "الصرفيات", rows: items });
  }

  async function exportReportsExcel() {
    const rep = await apiJson(API.reports, {}, { retries: 1 });

    const orders = (rep.ordersTransfers || []).map((x) => ({
      "النوع": "ترحيل طلبات",
      "التاريخ": fmtDateAR(x.at),
      "العملية": x.type,
      "مبلغ أموال": num(x.transferred?.amwal?.transferred),
      "مبلغ تحويل بنكي": num(x.transferred?.bankTransfer?.transferred),
      "ملاحظة": x.note || "",
    }));

    const exp = (rep.expensesTransfers || []).map((x) => ({
      "النوع": "ترحيل صرفيات",
      "التاريخ": fmtDateAR(x.at),
      "المبلغ": num(x.total),
      "عدد": x.count,
      "ملاحظة": x.note || "",
    }));

    const debts = (rep.debtsLog || []).map((x) => ({
      "النوع": "عمليات الديون",
      "التاريخ": fmtDateAR(x.at),
      "التاجر": x.vendor || "",
      "العملية": x.action || x.type || "",
      "المبلغ": num(x.amount),
      "ملاحظة": x.note || "",
    }));

    await exportExcel({
      fileName: "تقرير-كامل-بيوتي-تايم.xlsx",
      sheetName: "التقارير",
      rows: [...orders, ...exp, ...debts],
    });
  }

  function ensureExcelButtons() {
    // زر تقرير كامل بجانب Export JSON

    // أزرار لكل تبويب لو عندك container اسمه .tabTopActions (إذا ما موجود ما يضر)
    const map = [
      { tab: "overview", text: "تنزيل اكسل - نظرة عامة", fn: exportOverviewExcel },
      { tab: "orders", text: "تنزيل اكسل - الطلبات", fn: exportOrdersExcel },
      { tab: "debts", text: "تنزيل اكسل - الديون", fn: exportDebtsExcel },
      { tab: "expenses", text: "تنزيل اكسل - الصرفيات", fn: exportExpensesExcel },
    ];

    map.forEach((x) => {
      const host = document.querySelector(`[data-tab='${x.tab}'] .tabTopActions`);
      if (!host) return;
      if (host.querySelector(`[data-xlsx='${x.tab}']`)) return;

      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.setAttribute("data-xlsx", x.tab);
      b.innerHTML = `${ICONS.down}<span>${x.text}</span>`;
      b.onclick = () => runSafe(x.fn, "جارٍ التحضير…", "لحظة");
      host.appendChild(b);
    });
  }
  /* =========================
     Safe Runner
     ========================= */
  let busy = false;

  async function runSafe(fn, title, hint) {
    if (busy) return;
    busy = true;
    showLoading(title, hint);
    disableMainButtons(true);

    try {
      await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg === "401") {
        toast("bad", "غير مصرح", "المفتاح غلط أو انتهت الصلاحية");
        clearAdminKey();
      } else {
        toast("bad", "خطأ", msg);
      }
    } finally {
      hideLoading();
      disableMainButtons(false);
      busy = false;
    }
  }

  function disableMainButtons(disabled) {
    const ids = [
      "#btnRefresh",
      "#btnExport",
      "#btnOrdersTransfer",
      "#btnTransferAmwal",
      "#btnTransferBank",
      "#btnDebtAdd",
      "#btnDebtPay",
      "#btnDebtReorder", // ✅ جديد
      "#btnExpSelectAll",
      "#btnExpTransferSelected",
      "#btnExpTransferAll",
      "#btnMenu",
    ];

    ids.forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !!disabled;
    });
  }

  /* =========================
     Load All
     ========================= */
  async function loadAll() {
    await runSafe(async () => {
      const [summary, debts, expenses] = await Promise.all([
        apiJson(API.summary, {}, { retries: 1 }),
        apiJson(API.debts, {}, { retries: 1 }),
        apiJson(API.expenses, {}, { retries: 1 }),
      ]);

      state.summary = summary || {};
      state.debts = debts || { items: [], total: 0, totalNet: 0 };
      state.expenses = expenses || { items: [], total: 0 };

      // دمج أسماء التجار من السيرفر إلى history
      const vendors = vendorsFromStateDebts();
      if (vendors.length) saveVendors([...vendors, ...loadVendors()]);

      renderKPIs();
      renderOverview();
      renderOrders();
      renderDebts();
      renderExpenses();

      injectDebtReorderButton(); // ✅ زر الترتيب يظهر الآن
  ensureExcelButtons();
      $("#kpiStatus").textContent = "محدث الآن";
      setTimeout(() => {
        if ($("#kpiStatus")) $("#kpiStatus").textContent = "جاهز";
      }, 1200);
    }, "جارٍ التحديث…", "بنجيب أحدث البيانات");
  }
  /* =========================
     Tabs
     ========================= */
function setTab(tab) {
  const t = tab || "overview";

  // زرار السايدبار
  document.querySelectorAll(".nav button[data-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === t);
  });

  // البانلز (الأقسام) في الصفحة - حسب HTML عندك
  document.querySelectorAll("[data-tabpanel]").forEach((panel) => {
    panel.style.display = panel.getAttribute("data-tabpanel") === t ? "" : "none";
  });

  // حفظ آخر تبويب (إذا دوال التخزين موجودة عندك)
  if (typeof saveView === "function") saveView({ activeTab: t });
}

function bindTabs() {
  document.querySelectorAll(".nav button[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tab");
      setTab(t);
    });
  });

  // استرجاع آخر تبويب
  let last = "overview";
  if (typeof loadView === "function") {
    const v = loadView();
    if (v && v.activeTab) last = v.activeTab;
  }
  setTab(last);
}
  
  /* =========================
     Bindings
     ========================= */
  function debounce(fn, ms = 220) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function restoreView() {
    const v = loadView();
    if (typeof v.qOverview === "string") $("#qOverview").value = v.qOverview;
    if (typeof v.modeOverview === "string" && $("#modeOverview")) $("#modeOverview").value = v.modeOverview;
    if (typeof v.qDebts === "string") $("#qDebts").value = v.qDebts;
    if (typeof v.qExp === "string") $("#qExp").value = v.qExp;
  }


function bindAll() {
  // تعبئة كل الأيقونات
  $$("[data-ic]").forEach((el) => {
    const k = el.getAttribute("data-ic");
    el.innerHTML = ICONS[k] || el.innerHTML;
  });

  bindTabs();
  setTab("overview");

  // زر التحديث
  const btnRefresh = $("#btnRefresh");
  if (btnRefresh) btnRefresh.onclick = loadAll;

  // زر أعلى الصفحة: تقرير (Excel)
  const btnExport = $("#btnExport");
  if (btnExport) {
    btnExport.innerHTML = `<span class="ic" data-ic="download"></span><span>تقرير</span>`;
    btnExport.querySelectorAll("[data-ic]").forEach((el) => {
      const k = el.getAttribute("data-ic");
      el.innerHTML = ICONS[k] || el.innerHTML;
    });
    btnExport.onclick = () => runSafe(exportReportsExcel, "جارٍ التجهيز…", "بنجهز الملف");
  }

  // أزرار تحميل التقارير داخل الأقسام (IDs)
  const btnXlsxOverview = $("#btnXlsxOverview");
  if (btnXlsxOverview) btnXlsxOverview.onclick = () => runSafe(exportOverviewExcel, "جارٍ التجهيز…", "بنجهز تقرير الملخص");

  const btnXlsxOrders = $("#btnXlsxOrders");
  if (btnXlsxOrders) btnXlsxOrders.onclick = () => runSafe(exportOrdersExcel, "جارٍ التجهيز…", "بنجهز تقرير الطلبات");

  const btnXlsxDebts = $("#btnXlsxDebts");
  if (btnXlsxDebts) btnXlsxDebts.onclick = () => runSafe(exportDebtsExcel, "جارٍ التجهيز…", "بنجهز تقرير الديون");

  const btnXlsxExpenses = $("#btnXlsxExpenses");
  if (btnXlsxExpenses) btnXlsxExpenses.onclick = () => runSafe(exportExpensesExcel, "جارٍ التجهيز…", "بنجهز تقرير الصرفيات");

  // تعبئة أيقونات أزرار التقارير (احتياط)
  [btnXlsxOverview, btnXlsxOrders, btnXlsxDebts, btnXlsxExpenses].forEach((b) => {
    if (!b) return;
    b.querySelectorAll("[data-ic]").forEach((el) => {
      const k = el.getAttribute("data-ic");
      el.innerHTML = ICONS[k] || el.innerHTML;
    });
  });

  // ترحيل الطلبات
  const btnOrdersTransfer = $("#btnOrdersTransfer");
  if (btnOrdersTransfer) btnOrdersTransfer.onclick = doOrdersTransfer;

  // حد الطلبات
  const ordersLimit = $("#ordersLimit");
  if (ordersLimit) {
    ordersLimit.addEventListener("change", () => {
      renderOverview();
      renderOrders();
    });
  }

  // بحث الملخص
  const qOverview = $("#qOverview");
  if (qOverview) {
    qOverview.addEventListener("input", debounce(() => {
      renderOverview();
      renderOrders();
    }));
  }

  // فلتر بوابة الدفع
  const modeOverview = $("#modeOverview");
  if (modeOverview) {
    modeOverview.addEventListener("change", () => {
      renderOverview();
      renderOrders();
    });
  }

  // ديون: إضافة/سداد
  const btnDebtAdd = $("#btnDebtAdd");
  if (btnDebtAdd) btnDebtAdd.onclick = () => debtForm({ mode: "add" });

  const btnDebtPay = $("#btnDebtPay");
  if (btnDebtPay) btnDebtPay.onclick = () => debtForm({ mode: "pay" });

  // بحث الديون
  const qDebts = $("#qDebts");
  if (qDebts) qDebts.addEventListener("input", debounce(renderDebts));

  // بحث الصرفيات
  const qExp = $("#qExp");
  if (qExp) qExp.addEventListener("input", debounce(renderExpenses));

  // أزرار الصرفيات (كانت عندك خارج bindAll بالغلط)
  const btnExpSelectAll = $("#btnExpSelectAll");
  if (btnExpSelectAll) btnExpSelectAll.onclick = () => $$(".expChk").forEach((x) => (x.checked = true));

  const btnExpTransferSelected = $("#btnExpTransferSelected");
  if (btnExpTransferSelected) btnExpTransferSelected.onclick = transferSelectedExpenses;

  const btnExpTransferAll = $("#btnExpTransferAll");
  if (btnExpTransferAll) btnExpTransferAll.onclick = transferAllExpenses;

  // تحديد الكل للصرفيات
  const expHeadChk = $("#expHeadChk");
  if (expHeadChk) {
    expHeadChk.onchange = function () {
      const c = this.checked;
      $$(".expChk").forEach((x) => (x.checked = c));
    };
  }

  // مزامنة checkbox الرأس
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains("expChk")) {
      const all = $$(".expChk");
      const checked = all.filter((x) => x.checked);
      const head = $("#expHeadChk");
      if (head) head.checked = all.length && checked.length === all.length;
    }
  });

  // اختصارات الكيبورد (كانت برضه خارج bindAll بالغلط)
  document.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName?.toLowerCase?.() || "";
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if (!typing && (e.key === "r" || e.key === "R")) loadAll();
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      $("#qOverview")?.focus?.();
    }
  });
}
    
  /* ===== Mobile Menu Toggle ===== */
  function isMobileMenu() {
    return window.matchMedia("(max-width: 980px)").matches;
  }
  function openMenu() {
    document.body.classList.add("menu-open");
    const b = document.getElementById("btnMenu");
    if (b) b.setAttribute("aria-expanded", "true");
    const ov = document.getElementById("sideOverlay");
    if (ov) ov.setAttribute("aria-hidden", "false");
  }
  function closeMenu() {
    document.body.classList.remove("menu-open");
    const b = document.getElementById("btnMenu");
    if (b) b.setAttribute("aria-expanded", "false");
    const ov = document.getElementById("sideOverlay");
    if (ov) ov.setAttribute("aria-hidden", "true");
  }
  function toggleMenu() {
    if (document.body.classList.contains("menu-open")) closeMenu();
    else openMenu();
  }
  function bindMobileMenu() {
    const btn = document.getElementById("btnMenu");
    const ov = document.getElementById("sideOverlay");

    if (btn) btn.addEventListener("click", toggleMenu);
    if (ov) ov.addEventListener("click", closeMenu);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

    document.querySelectorAll(".nav button[data-tab]").forEach((b) => {
      b.addEventListener("click", () => {
        if (isMobileMenu()) closeMenu();
      });
    });

    window.addEventListener("resize", () => {
      if (!isMobileMenu()) closeMenu();
    });
  }

  /* =========================
     Start
     ========================= */
  bindMobileMenu();
  bindModalClose();
  restoreView();
  bindAll();
  loadAll();
})();
