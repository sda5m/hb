(() => {
  const $ = (id) => document.getElementById(id);

  const LANGS = {
    ar: {
      dir: "rtl",
      pageTitle: "تتبع الطلب | هلا بيوتي",
      heroTitle: "تتبع الطلب",
      searchTitle: "ادخل رقم الطلب او التتبع",
      trackingLabel: "رقم الطلب او رقم التتبع",
      trackingPlaceholder: "مثال: 12345 او A12345678",
      searchBtn: "تتبع الطلب",
      searchBtnLoading: "قاعد ابحث عن طلبك...",
      refreshBtn: "تحديث",
      readyToTrack: "جاهز للتتبع",
      verifyTitle: "تأكيد الطلب",
      verifyText: "لامان الطلب، ادخل اخر 3 ارقام من رقم الجوال المسجل",
      verifyInputLabel: "اخر 3 ارقام",
      verifyBtn: "تأكيد الطلب",
      errorRequired: "ادخل رقم الطلب او رقم التتبع",
      errorVerifyRequired: "ادخل اخر 3 ارقام بشكل صحيح",
      summaryTrackingLabel: "رقم التتبع",
      summaryStatusLabel: "الحاله الحاليه",
      summaryLastUpdateLabel: "اخر تحديث",
      summaryProviderLabel: "شركة الشحن",
      progress1: "استلام الطلب",
      progress2: "في النقل",
      progress3: "خرج للتوصيل",
      progress4: "تم التسليم",
      statsUpdatesLabel: "عدد التحديثات",
      statsDestinationLabel: "الوجهه",
      statsAmountLabel: "المبلغ",
      statsDeliveryStateLabel: "حاله التسليم",
      shipmentPhotoTitle: "صورة الشحنه",
      timelineTitle: "السجل الزمني للشحنه",
      detailsTitle: "تفاصيل الطلب",
      labelCustomer: "العميل",
      labelPhone: "الجوال",
      labelAddress: "العنوان",
      labelCity: "المدينه",
      labelOrigin: "الانطلاق",
      labelDestination: "الوجهه",
      labelAmount: "المبلغ",
      copyBtn: "نسخ رابط التتبع",
      copiedBtn: "تم نسخ الرابط",
      latestUpdate: "احدث تحديث",
      noArea: "بدون منطقه",
      noUpdates: "ما فيه تحديثات متوفره لهذي الشحنه حاليا",
      heroNotFound: "ما حصلنا الطلب",
      heroNeedsVerify: "مطلوب تاكيد الطلب",
      loaderDefault: "جاري العمل… اصبر شوي",
      loaderSub: "لا تسوي تحديث، بنرجع لك حالا",
      loaderSearch: "اصبر بشوف طلبك وين واصل",
      loaderSearchSub: "نجمع اخر تحديثات الشحنه لك",
      loaderRefresh: "لحظه، قاعدين نحدث بيانات طلبك",
      loaderRefreshSub: "نتاكد لك من اخر حاله وصلت",
      loaderVerify: "تمام، نتحقق من بيانات الطلب",
      loaderVerifySub: "ثواني ويفتح لك التتبع",
      langToggleLabel: "English",
      copyFailed: "ما قدرت انسخ الرابط",
      imageAltPrefix: "صورة الشحنه",
      providerFallback: "شركة الشحن",
      amountDash: "—",
      detailDash: "—",
      locale: "ar-OM",
      noticeTitle: "تنبيه الطلب",
      cancelledTitle: "الطلب ملغي",
      okText: "حسنًا",
      minimalUpdateTitle: "تحديث الطلب"
    },

    en: {
      dir: "ltr",
      pageTitle: "Track Order | Hala Beauty",
      heroTitle: "Track your order",
      searchTitle: "Enter your order or tracking number",
      trackingLabel: "Order number or tracking number",
      trackingPlaceholder: "Example: 12345 or A12345678",
      searchBtn: "Track order",
      searchBtnLoading: "Checking your order...",
      refreshBtn: "Refresh",
      readyToTrack: "Ready to track",
      verifyTitle: "Verify order",
      verifyText: "For order security, enter the last 3 digits of the registered phone number.",
      verifyInputLabel: "Last 3 digits",
      verifyBtn: "Verify order",
      errorRequired: "Please enter the order or tracking number.",
      errorVerifyRequired: "Please enter the last 3 digits correctly.",
      summaryTrackingLabel: "Tracking number",
      summaryStatusLabel: "Current status",
      summaryLastUpdateLabel: "Last update",
      summaryProviderLabel: "Shipping provider",
      progress1: "Order received",
      progress2: "In transit",
      progress3: "Out for delivery",
      progress4: "Delivered",
      statsUpdatesLabel: "Updates count",
      statsDestinationLabel: "Destination",
      statsAmountLabel: "Amount",
      statsDeliveryStateLabel: "Delivery state",
      shipmentPhotoTitle: "Shipment photo",
      timelineTitle: "Shipment timeline",
      detailsTitle: "Order details",
      labelCustomer: "Customer",
      labelPhone: "Phone",
      labelAddress: "Address",
      labelCity: "City",
      labelOrigin: "Origin",
      labelDestination: "Destination",
      labelAmount: "Amount",
      copyBtn: "Copy tracking link",
      copiedBtn: "Link copied",
      latestUpdate: "Latest update",
      noArea: "No area",
      noUpdates: "No updates are available for this shipment right now.",
      heroNotFound: "Order not found",
      heroNeedsVerify: "Verification required",
      loaderDefault: "Working on it...",
      loaderSub: "Please do not refresh. We will be right back.",
      loaderSearch: "Checking where your order is now",
      loaderSearchSub: "Getting the latest shipment updates",
      loaderRefresh: "Refreshing your order details",
      loaderRefreshSub: "Checking the newest delivery status",
      loaderVerify: "Verifying your order details",
      loaderVerifySub: "One moment and your tracking will open",
      langToggleLabel: "العربيه",
      copyFailed: "Could not copy the link.",
      imageAltPrefix: "Shipment photo",
      providerFallback: "Provider",
      amountDash: "—",
      detailDash: "—",
      locale: "en-OM",
      noticeTitle: "Order notice",
      cancelledTitle: "Order cancelled",
      okText: "OK",
      minimalUpdateTitle: "Order update"
    }
  };

  const STATUS_META = {
    PENDING: { key: "PENDING", ar: "قيد الانتظار", en: "Pending", icon: "#i-clock", tone: "warning", step: 1 },
    INFO_RECEIVED: { key: "INFO_RECEIVED", ar: "تم استلام البيانات", en: "Info received", icon: "#i-box", tone: "info", step: 1 },
    IN_TRANSIT: { key: "IN_TRANSIT", ar: "في النقل", en: "In transit", icon: "#i-truck", tone: "info", step: 2 },
    OUT_FOR_DELIVERY: { key: "OUT_FOR_DELIVERY", ar: "خرج للتوصيل", en: "Out for delivery", icon: "#i-route", tone: "accent", step: 3 },
    DELIVERED: { key: "DELIVERED", ar: "تم التسليم", en: "Delivered", icon: "#i-check", tone: "success", step: 4 },
    FAILED_DELIVERY: { key: "FAILED_DELIVERY", ar: "فشل التوصيل", en: "Delivery failed", icon: "#i-alert", tone: "danger", step: 3 },
    EXCEPTION: { key: "EXCEPTION", ar: "مشكله بالشحنه", en: "Shipment issue", icon: "#i-alert", tone: "danger", step: 2 },
    RETURNED: { key: "RETURNED", ar: "تم الارجاع", en: "Returned", icon: "#i-alert", tone: "danger", step: 4 },
    CANCELLED: { key: "CANCELLED", ar: "الطلب ملغي", en: "Cancelled", icon: "#i-alert", tone: "danger", step: 1 },
    OFFICE_BRANCH: { key: "OFFICE_BRANCH", ar: "تم شحن طلبك عبر مكتب جيناكم", en: "Shipped via Genacom Office", icon: "#i-map", tone: "accent", step: 2 },
    OFFICE_DHL: { key: "OFFICE_DHL", ar: "تم شحن طلبك عبر DHL", en: "Shipped via DHL", icon: "#i-truck", tone: "info", step: 2 },
    UNKNOWN: { key: "UNKNOWN", ar: "غير معروف", en: "Unknown", icon: "#i-box", tone: "muted", step: 1 }
  };

  const PROVIDER_META = {
    dhl: {
      key: "dhl",
      nameAr: "DHL",
      nameEn: "DHL",
      logo: "https://upload.wikimedia.org/wikipedia/commons/a/ac/DHL_Logo.svg",
      bg: "#ffcc00"
    },
    gena: {
      key: "gena",
      nameAr: "مكتب جيناكم",
      nameEn: "Genacom Office",
      logo: "https://www.genacom.app/assets/media/logos/logo-letter-2.png",
      bg: "#ffffff"
    },
    dalilee: {
      key: "dalilee",
      nameAr: "دليلي",
      nameEn: "Dalilee",
      logo: "https://dalilee.om/images/dalilee-logo.png",
      bg: "#13a3dd"
    },
    btime: {
      key: "btime",
      nameAr: "هلا بيوتي المحليه",
      nameEn: "Hala Beauty Local",
      logo: "/hb-logo.png",
      bg: "#ffffff"
    }
  };

  let currentLang = detectLang();
  let lastQueryValue = "";

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function text(key) {
    return LANGS[currentLang]?.[key] ?? LANGS.ar[key] ?? key;
  }

function detectLang() {
  const params = new URL(window.location.href).searchParams;
  return params.get("lang") === "en" ? "en" : "ar";
}
function getTrackBasePath() {
  return "/bt";
}
  function getStatusMeta(status) {
    return STATUS_META[String(status || "UNKNOWN").toUpperCase()] || STATUS_META.UNKNOWN;
  }

  function getStatusLabel(status, fallback = "") {
    const meta = getStatusMeta(status);
    if (fallback) return fallback;
    return currentLang === "en" ? meta.en : meta.ar;
  }

  function getProviderMeta(provider, status, rawSource = "") {
    const p = cleanText(provider).toLowerCase();
    const s = cleanText(status).toUpperCase();
    const src = cleanText(rawSource).toLowerCase();

    if (s === "OFFICE_DHL" || /dhl/.test(p)) return PROVIDER_META.dhl;
    if (s === "OFFICE_BRANCH" || /جيناكم|gena/.test(p)) return PROVIDER_META.gena;
    if (/dalilee|دليلي/.test(p) || /dalilee/.test(src)) return PROVIDER_META.dalilee;
    if (/hala beauty|halabeauty|local|محلي/.test(p) || /halabeauty-local/.test(src)) return PROVIDER_META.btime;

    return null;
  }

  function formatDateTime(value) {
    const raw = cleanText(value);
    if (!raw) return text("detailDash");

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        return new Intl.DateTimeFormat(text("locale"), {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        }).format(parsed);
      } catch (_) {}
    }
    return raw;
  }

  function formatDateOnly(value) {
    const raw = cleanText(value);
    if (!raw) return text("detailDash");

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      try {
        return new Intl.DateTimeFormat(text("locale"), {
          year: "numeric",
          month: "long",
          day: "numeric"
        }).format(parsed);
      } catch (_) {}
    }
    return raw;
  }

  function formatMoney(amount, currency = "OMR") {
    const n = Number(amount);
    if (!Number.isFinite(n)) return text("amountDash");

    try {
      return (
        new Intl.NumberFormat(text("locale"), {
          minimumFractionDigits: 3,
          maximumFractionDigits: 3
        }).format(n) + ` ${currency}`
      );
    } catch (_) {
      return `${n.toFixed(3)} ${currency}`;
    }
  }

  function showOverlay(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }

  function hideOverlay(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add("hidden");
    el.setAttribute("aria-hidden", "true");
  }

  function showNoticeModal(message, title = text("noticeTitle")) {
    if ($("noticeModalTitle")) $("noticeModalTitle").textContent = title;
    if ($("noticeModalText")) $("noticeModalText").textContent = message || "";
    if ($("noticeModalBtn")) $("noticeModalBtn").innerHTML = `<span>${escapeHtml(text("okText"))}</span>`;
    showOverlay("noticeModal");
  }

  function hideNoticeModal() {
    hideOverlay("noticeModal");
  }

  function showError(message) {
    showNoticeModal(message || text("heroNotFound"));
  }

  function hideError() {
    hideNoticeModal();
  }

  function setLoaderMessage(type = "search") {
    const map = {
      search: { title: text("loaderSearch"), sub: text("loaderSearchSub") },
      refresh: { title: text("loaderRefresh"), sub: text("loaderRefreshSub") },
      verify: { title: text("loaderVerify"), sub: text("loaderVerifySub") },
      default: { title: text("loaderDefault"), sub: text("loaderSub") }
    };

    const data = map[type] || map.default;
    if ($("globalLoaderText")) $("globalLoaderText").textContent = data.title;
    if ($("globalLoaderSub")) $("globalLoaderSub").textContent = data.sub;
  }

  function toggleLoading(isLoading, type = "search") {
    $("skeletonSection")?.classList.toggle("hidden", !isLoading);

    if (isLoading) {
      setLoaderMessage(type);
      showOverlay("globalLoader");
    } else {
      hideOverlay("globalLoader");
    }

    ["searchBtn", "refreshBtn", "verifyBtn"].forEach((id) => {
      if ($(id)) $(id).disabled = isLoading;
    });

    const searchBtn = $("searchBtn");
    if (searchBtn) {
      searchBtn.innerHTML = isLoading
        ? `<svg><use href="#i-loader"></use></svg><span>${escapeHtml(text("searchBtnLoading"))}</span>`
        : `<svg><use href="#i-search"></use></svg><span>${escapeHtml(text("searchBtn"))}</span>`;
    }
  }

  function setHeroBadge(label, tone = "muted", icon = "#i-box") {
    const el = $("heroStatusBadge");
    if (!el) return;
    el.className = `status-pill ${tone}`;
    el.innerHTML = `<svg><use href="${icon}"></use></svg><span>${escapeHtml(label)}</span>`;
  }

  function sanitizeData(data) {
    return {
      provider: cleanText(data?.provider),
      trackingNumber: cleanText(data?.trackingNumber),
      orderName: cleanText(data?.orderName),
      status: cleanText(data?.status || "UNKNOWN").toUpperCase(),
      currentStatusText: cleanText(data?.currentStatusText),
      currentDateText: cleanText(data?.currentDateText),
      originServiceArea: cleanText(data?.originServiceArea),
      destinationServiceArea: cleanText(data?.destinationServiceArea),
      orderPhoto: cleanText(data?.orderPhoto),
      orderPhotos: Array.isArray(data?.orderPhotos) ? data.orderPhotos.map(cleanText).filter(Boolean) : [],
      customerName: cleanText(data?.customerName),
      customerPhone: cleanText(data?.customerPhone),
      address: cleanText(data?.address),
      city: cleanText(data?.city),
      amountDue: data?.amountDue ?? null,
      currency: cleanText(data?.currency || "OMR"),
      deliveryState: cleanText(data?.deliveryState),
      smartMessage: cleanText(data?.smartMessage),
      minimalView: Boolean(data?.minimalView),
      rawSource: cleanText(data?.rawSource),
      updates: Array.isArray(data?.updates)
        ? data.updates.map((item) => ({
            datetime: cleanText(item?.datetime || item?.date),
            date: cleanText(item?.date),
            time: cleanText(item?.time),
            serviceArea: cleanText(item?.serviceArea),
            statusText: cleanText(item?.statusText),
            status: cleanText(item?.status || "UNKNOWN").toUpperCase(),
            reason: cleanText(item?.reason)
          }))
        : []
    };
  }

  function getShortTrackingUrl(query, lang = currentLang) {
    const cleanQuery = cleanText(query);
    const origin = window.location.origin;
    const basePath = getTrackBasePath(lang);
    return `${origin}${basePath}?q=${encodeURIComponent(cleanQuery)}`;
  }

  function updateUrl(query) {
    const cleanQuery = cleanText(query);
    const url = new URL(window.location.href);

    url.pathname = getTrackBasePath(currentLang);
    url.searchParams.delete("trackingNumber");
    url.searchParams.delete("query");
    url.searchParams.delete("lang");
    url.searchParams.set("q", cleanQuery);

    window.history.replaceState({}, "", url.toString());
  }

  function applyLanguageToDom() {
    document.documentElement.lang = currentLang;
    document.documentElement.dir = LANGS[currentLang].dir;
    document.body.classList.toggle("is-en", currentLang === "en");
    document.title = text("pageTitle");

    const ids = {
      heroTitle: "heroTitle",
      searchTitle: "searchTitle",
      searchBtnText: "searchBtn",
      trackingLabel: "trackingLabel",
      refreshBtnText: "refreshBtn",
      verifyModalTitle: "verifyTitle",
      verifyInputLabel: "verifyInputLabel",
      verifyBtnText: "verifyBtn",
      summaryTrackingLabel: "summaryTrackingLabel",
      summaryStatusLabel: "summaryStatusLabel",
      summaryLastUpdateLabel: "summaryLastUpdateLabel",
      summaryProviderLabel: "summaryProviderLabel",
      progressLabel1: "progress1",
      progressLabel2: "progress2",
      progressLabel3: "progress3",
      progressLabel4: "progress4",
      statsUpdatesLabel: "statsUpdatesLabel",
      statsDestinationLabel: "statsDestinationLabel",
      statsAmountLabel: "statsAmountLabel",
      statsDeliveryStateLabel: "statsDeliveryStateLabel",
      shipmentPhotoTitle: "shipmentPhotoTitle",
      timelineTitle: "timelineTitle",
      detailsTitle: "detailsTitle",
      labelCustomer: "labelCustomer",
      labelPhone: "labelPhone",
      labelAddress: "labelAddress",
      labelCity: "labelCity",
      labelOrigin: "labelOrigin",
      labelDestination: "labelDestination",
      labelAmount: "labelAmount",
      copyBtnText: "copyBtn",
      langToggleLabel: "langToggleLabel"
    };

    Object.entries(ids).forEach(([id, key]) => {
      if ($(id)) $(id).textContent = text(key);
    });

    if ($("trackingInput")) $("trackingInput").placeholder = text("trackingPlaceholder");
    if ($("heroStatusBadgeText")) $("heroStatusBadgeText").textContent = text("readyToTrack");
    if ($("verifyText")) $("verifyText").textContent = text("verifyText");
    if ($("globalLoaderText")) $("globalLoaderText").textContent = text("loaderDefault");
    if ($("globalLoaderSub")) $("globalLoaderSub").textContent = text("loaderSub");
    if ($("noticeModalBtn")) $("noticeModalBtn").innerHTML = `<span>${escapeHtml(text("okText"))}</span>`;
  }

function switchLanguage() {
  currentLang = currentLang === "ar" ? "en" : "ar";

  const url = new URL(window.location.href);
  url.pathname = "/bt";

  const currentQuery = cleanText($("trackingInput")?.value || lastQueryValue);

  if (currentLang === "en") {
    url.searchParams.set("lang", "en");
  } else {
    url.searchParams.delete("lang");
  }

  if (currentQuery) {
    url.searchParams.set("q", currentQuery);
  } else {
    url.searchParams.delete("q");
  }

  window.history.replaceState({}, "", url.toString());
  applyLanguageToDom();

  if (lastQueryValue) {
    const resultSectionVisible = !$("resultSection")?.classList.contains("hidden");
    if (resultSectionVisible) {
      handleTrackSubmit(false, "refresh", true);
    } else {
      setHeroBadge(text("readyToTrack"), "muted", "#i-box");
    }
  } else {
    setHeroBadge(text("readyToTrack"), "muted", "#i-box");
  }
}
  function renderProgress(status) {
    const step = getStatusMeta(status).step;
    const ids = ["progressStep1", "progressStep2", "progressStep3", "progressStep4"];

    ids.forEach((id, index) => {
      const el = $(id);
      if (!el) return;

      el.classList.remove("done", "active");

      const current = index + 1;

      if (status === "DELIVERED") {
        el.classList.add("done");
        return;
      }

      if (current < step) el.classList.add("done");
      if (current === step) el.classList.add("active");
    });
  }

  function setProviderLogo(targetPrefix, providerMeta) {
    const wrap = $(`${targetPrefix}Wrap`);
    const img = $(targetPrefix);

    if (!wrap || !img || !providerMeta) {
      if (img) img.removeAttribute("src");
      if (wrap) wrap.classList.add("hidden");
      return;
    }

    img.src = providerMeta.logo;
    img.alt = currentLang === "en" ? providerMeta.nameEn : providerMeta.nameAr;
    wrap.style.background = providerMeta.bg || "#fff";
    wrap.classList.remove("hidden");
  }

  function renderPhoto(data) {
    const image = data.orderPhoto || data.orderPhotos?.[0] || "";
    const photoCard = $("shipmentPhotoCard");
    const photo = $("shipmentPhoto");

    if (!photoCard || !photo) return;

    if (image) {
      photo.src = image;
      photo.alt = `${text("imageAltPrefix")} ${data.trackingNumber || data.orderName || ""}`.trim();
      photoCard.classList.remove("hidden");
      photo.onclick = () => openImageModal(image);
    } else {
      photo.removeAttribute("src");
      photoCard.classList.add("hidden");
      photo.onclick = null;
    }
  }

  function openImageModal(src) {
    if ($("modalImage")) $("modalImage").src = src;
    showOverlay("imageModal");
  }

  function closeImageModal() {
    if ($("modalImage")) $("modalImage").removeAttribute("src");
    hideOverlay("imageModal");
  }

  function renderTimeline(data) {
    const list = $("timelineList");
    if (!list) return;

    if (!data.updates.length) {
      list.innerHTML = `<div class="timeline-empty">${escapeHtml(text("noUpdates"))}</div>`;
      return;
    }

    list.innerHTML = data.updates.map((item, index) => {
      const meta = getStatusMeta(item.status);
      const latest = index === 0;
      const title = item.statusText || getStatusLabel(item.status);
      const latestBadge = latest
        ? `<span class="timeline-latest"><svg><use href="#i-check"></use></svg>${escapeHtml(text("latestUpdate"))}</span>`
        : "";

      return `
        <article class="timeline-card ${latest ? "latest" : ""}">
          <div class="timeline-marker ${meta.tone}">
            <svg><use href="${meta.icon}"></use></svg>
          </div>
          <div class="timeline-content">
            <div class="timeline-top">
              <h3>${escapeHtml(title)}</h3>
              ${latestBadge}
            </div>
            <div class="timeline-meta">
              <span><svg><use href="#i-calendar"></use></svg>${escapeHtml(formatDateTime(item.datetime || item.date))}</span>
              ${item.serviceArea ? `
<span><svg><use href="#i-map"></use></svg>${escapeHtml(item.serviceArea)}</span>
` : ""}
            </div>
            ${item.reason ? `
              <div class="timeline-reason">
                <svg><use href="#i-alert"></use></svg>
                <span>${escapeHtml(item.reason)}</span>
              </div>
            ` : ""}
          </div>
        </article>
      `;
    }).join("");
  }

  function setDetailedSectionsHidden(hidden) {
    document.querySelector(".summary-grid")?.classList.toggle("hidden", hidden);
    document.querySelector(".progress-panel")?.classList.toggle("hidden", hidden);
    document.querySelector(".stats-grid")?.classList.toggle("hidden", hidden);
    document.querySelector(".content-grid")?.classList.toggle("hidden", hidden);
  }

  function renderTracking(data) {
    const meta = getStatusMeta(data.status);
    const smartMessageBox = $("smartMessageBox");
    const minimalSection = $("minimalSection");
    const resultSection = $("resultSection");
    const providerMeta = getProviderMeta(data.provider, data.status, data.rawSource);

    if (resultSection) resultSection.classList.remove("hidden");

    const isMinimalMode = Boolean(data.minimalView);

    if (smartMessageBox) {
      smartMessageBox.textContent = "";
      smartMessageBox.classList.add("hidden");
    }

    if (isMinimalMode) {
      setDetailedSectionsHidden(true);
      minimalSection?.classList.remove("hidden");

      const currentStatusLabel = data.currentStatusText || getStatusLabel(data.status);

      const minimalBadge = $("minimalStatusBadge");
      if (minimalBadge) {
        minimalBadge.className = `status-pill ${meta.tone || "muted"}`;
        minimalBadge.innerHTML = `
          <svg><use href="${meta.icon || "#i-box"}"></use></svg>
          <span>${escapeHtml(currentStatusLabel)}</span>
        `;
      }

      const minimalTitle = $("minimalTitle");
      if (minimalTitle) {
        if (data.status === "CANCELLED") {
          minimalTitle.textContent = text("cancelledTitle");
        } else {
          minimalTitle.textContent = text("minimalUpdateTitle");
        }
      }

      const minimalText = $("minimalText");
      if (minimalText) {
        minimalText.textContent = data.smartMessage || currentStatusLabel || "";
      }

      setProviderLogo("minimalProviderLogo", providerMeta);
      setHeroBadge(currentStatusLabel, meta.tone || "muted", meta.icon || "#i-box");

      if (data.smartMessage) {
        showNoticeModal(
          data.smartMessage,
          data.status === "CANCELLED" ? text("cancelledTitle") : text("noticeTitle")
        );
      }

      return;
    }

    minimalSection?.classList.add("hidden");
    setDetailedSectionsHidden(false);

    if (data.smartMessage && smartMessageBox) {
      smartMessageBox.textContent = data.smartMessage;
      smartMessageBox.classList.remove("hidden");
    }

    const currentStatusLabel = data.currentStatusText || getStatusLabel(data.status);

    if ($("trackingNumberHero")) $("trackingNumberHero").textContent = data.trackingNumber || data.orderName || text("detailDash");
    if ($("heroStatusText")) $("heroStatusText").textContent = currentStatusLabel;
    if ($("lastUpdateHero")) $("lastUpdateHero").textContent = formatDateOnly(data.currentDateText);
    if ($("providerHero")) {
      const providerName =
        data.provider ||
        (providerMeta ? (currentLang === "en" ? providerMeta.nameEn : providerMeta.nameAr) : text("providerFallback"));
      $("providerHero").textContent = providerName;
    }

    if ($("destinationHero")) $("destinationHero").textContent = data.destinationServiceArea || data.city || text("detailDash");
    if ($("statsUpdatesCount")) $("statsUpdatesCount").textContent = String(data.updates.length);
    if ($("statsAmount")) $("statsAmount").textContent = formatMoney(data.amountDue, data.currency);
    if ($("overviewDeliveryState")) $("overviewDeliveryState").textContent = data.deliveryState || text("detailDash");

    if ($("overviewCustomer")) $("overviewCustomer").textContent = data.customerName || text("detailDash");
    if ($("overviewPhone")) $("overviewPhone").textContent = data.customerPhone || text("detailDash");
    if ($("overviewAddress")) $("overviewAddress").textContent = data.address || text("detailDash");
    if ($("overviewCity")) $("overviewCity").textContent = data.city || text("detailDash");
    if ($("overviewOrigin")) $("overviewOrigin").textContent = data.originServiceArea || text("detailDash");
    if ($("overviewDestination")) $("overviewDestination").textContent = data.destinationServiceArea || data.city || text("detailDash");
    if ($("overviewAmount")) $("overviewAmount").textContent = formatMoney(data.amountDue, data.currency);

    setProviderLogo("providerHeroLogo", providerMeta);
    setHeroBadge(currentStatusLabel, meta.tone, meta.icon);
    renderProgress(data.status);
    renderPhoto(data);
    renderTimeline(data);
  }

  async function requestTracking(query, phoneLast3 = "") {
    const url = new URL("/api/track-unified", window.location.origin);
    url.searchParams.set("query", query);
    url.searchParams.set("lang", currentLang);

    if (phoneLast3) url.searchParams.set("phoneLast3", phoneLast3);

    const res = await fetch(url.toString(), {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" }
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok && !json?.requiresVerification) {
      throw new Error(
        json?.error ||
          (currentLang === "en" ? "Unable to fetch shipment data." : "تعذر جلب بيانات الشحنه")
      );
    }

    return json;
  }

  async function handleTrackSubmit(useVerification = false, actionType = "search", silent = false) {
    hideError();

    const query = cleanText($("trackingInput")?.value);
    const phoneLast3 = cleanText($("phoneLast3Input")?.value).replace(/\D/g, "").slice(-3);

    if (!query) {
      showError(text("errorRequired"));
      return;
    }

    if (useVerification && phoneLast3.length !== 3) {
      showError(text("errorVerifyRequired"));
      return;
    }

    lastQueryValue = query;
    toggleLoading(true, actionType);

    try {
      const json = await requestTracking(query, useVerification ? phoneLast3 : "");

      if (json?.requiresVerification) {
        $("resultSection")?.classList.add("hidden");

        const verifyText = $("verifyText");
        if (verifyText) {
          verifyText.innerHTML = json?.maskedPhone
            ? (currentLang === "en"
                ? `For order security, enter the last 3 digits of the registered phone number <bdi dir="ltr">${escapeHtml(json.maskedPhone)}</bdi>`
                : `لامان الطلب، ادخل اخر 3 ارقام من رقم الجوال المسجل <bdi dir="ltr">${escapeHtml(json.maskedPhone)}</bdi>`)
            : escapeHtml(json?.message || text("verifyText"));
        }

        showOverlay("verifyModal");
        setHeroBadge(text("heroNeedsVerify"), "warning", "#i-phone");
        return;
      }

      if (!json?.ok || !json?.data) {
        throw new Error(json?.error || (currentLang === "en" ? "Unable to fetch tracking details." : "تعذر جلب بيانات التتبع"));
      }

      const data = sanitizeData(json.data);
      updateUrl(query);
      hideOverlay("verifyModal");
      renderTracking(data);

      if (!silent && $("phoneLast3Input")) {
        $("phoneLast3Input").value = "";
      }
    } catch (error) {
      $("resultSection")?.classList.add("hidden");
      showError(error?.message || text("heroNotFound"));
      setHeroBadge(text("heroNotFound"), "danger", "#i-alert");
    } finally {
      toggleLoading(false, actionType);
    }
  }

  function bindShareButton() {
    const copyBtn = $("copyTrackingLinkBtn");
    if (!copyBtn) return;

    copyBtn.addEventListener("click", async () => {
      try {
        const query = cleanText($("trackingInput")?.value || lastQueryValue);
        if (!query) {
          showError(text("errorRequired"));
          return;
        }

        const shortUrl = getShortTrackingUrl(query, currentLang);
        await navigator.clipboard.writeText(shortUrl);
        copyBtn.innerHTML = `<svg><use href="#i-check"></use></svg><span>${escapeHtml(text("copiedBtn"))}</span>`;

        setTimeout(() => {
          copyBtn.innerHTML = `<svg><use href="#i-copy"></use></svg><span>${escapeHtml(text("copyBtn"))}</span>`;
        }, 1600);
      } catch {
        showError(text("copyFailed"));
      }
    });
  }

  function bindModals() {
    $("closeVerifyModal")?.addEventListener("click", () => hideOverlay("verifyModal"));
    $("closeImageModal")?.addEventListener("click", closeImageModal);
    $("closeNoticeModal")?.addEventListener("click", hideNoticeModal);
    $("noticeModalBtn")?.addEventListener("click", hideNoticeModal);

    $("verifyModal")?.addEventListener("click", (e) => {
      if (e.target.id === "verifyModal") hideOverlay("verifyModal");
    });

    $("imageModal")?.addEventListener("click", (e) => {
      if (e.target.id === "imageModal") closeImageModal();
    });

    $("noticeModal")?.addEventListener("click", (e) => {
      if (e.target.id === "noticeModal") hideNoticeModal();
    });
  }

  function bindEvents() {
    $("searchBtn")?.addEventListener("click", () => handleTrackSubmit(false, "search"));
    $("refreshBtn")?.addEventListener("click", () => handleTrackSubmit(false, "refresh"));
    $("verifyBtn")?.addEventListener("click", () => handleTrackSubmit(true, "verify"));

    $("trackingInput")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleTrackSubmit(false, "search");
      }
    });

    $("phoneLast3Input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleTrackSubmit(true, "verify");
      }
    });

    $("langToggleBtn")?.addEventListener("click", switchLanguage);

    bindShareButton();
    bindModals();
  }

  function bootFromUrl() {
    const url = new URL(window.location.href);
    const tracking = cleanText(
      url.searchParams.get("q") ||
      url.searchParams.get("trackingNumber") ||
      url.searchParams.get("query") ||
      ""
    );

    if (tracking && $("trackingInput")) {
      $("trackingInput").value = tracking;
      lastQueryValue = tracking;
      handleTrackSubmit(false, "search", true);
    } else {
      setHeroBadge(text("readyToTrack"), "muted", "#i-box");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyLanguageToDom();
    bindEvents();
    bootFromUrl();
  });


  // ============================
// AUTO HEIGHT FOR IFRAME
// ============================
function sendHeightToParent() {
  try {
    const height = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight
    );

    window.parent.postMessage(
      {
        type: "BT_TRACK_HEIGHT",
        height: height
      },
      "*"
    );
  } catch (e) {}
}

window.addEventListener("load", () => {
  sendHeightToParent();
  setTimeout(sendHeightToParent, 300);
  setTimeout(sendHeightToParent, 800);
});

const observer = new MutationObserver(() => {
  sendHeightToParent();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true
});

window.addEventListener("resize", sendHeightToParent);

window.addEventListener("message", (event) => {
  if (event.data?.type === "BT_TRACK_REQUEST_HEIGHT") {
    sendHeightToParent();
  }
});

  
})();
