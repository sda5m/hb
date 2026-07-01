import express from "express";
import fetch from "node-fetch";
import multer from "multer";
import puppeteer from "puppeteer";
import { v2 as cloudinary } from "cloudinary";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "fs";

import customerRoutes from "./routes/customer.routes.js";
import packRoutes from "./routes/pack.routes.js";
import prepRoutes from "./routes/prep.routes.js";
import inventoryRouter from "./routes/inventory.js";
import productVideosRouter, { productVideoStatsRouter } from "./routes/productVideos.js";
import customerCreditRouter, { customerCreditPublicRouter } from "./routes/customerCredit.js";
import customerCreditAmwalRouter from "./routes/customerCreditAmwal.js";
import customerRewardsRouter, {
  customerRewardsPublicRouter,
  awardReviewRewards,
  prepareReviewReward,
  reverseOrderRewards,
  syncDeliveredOrderRewards
} from "./routes/customerRewards.js";
import customerNotificationsRouter from "./routes/customerNotifications.js";
import appCampaignsRouter from "./routes/appCampaigns.js";
import autoNotificationTemplatesRouter from "./routes/autoNotificationTemplates.js";
import shareLinksRouter from "./routes/shareLinks.js";
import requirePackKey from "./middlewares/requirePackKey.js"; 
import ordersManageRouter from "./routes/ordersManage.js";
import productsQueueRouter from "./routes/productsQueue.routes.js";
import proProductsTagsRouter from "./routes/proProductsTags.js";
import moneyRoutes from "./routes/money.routes.js";
import packShopifyRouter from "./routes/ma5zn.js";
import dalileeRoutes from "./routes/dalilee.js";
import trackUnifiedRoutes from "./routes/trackUnified.js";
import { extractLocation } from "./extract-location.js";
import metaEmbeddedRoutes from "./routes/metaEmbedded.js";
import crypto from "crypto";
import admin from "firebase-admin";

import { createClient } from "redis";

const SHOPIFY_TOKEN_BOOTSTRAPPED = process.env.SHOPIFY_TOKEN_BOOTSTRAPPED === "1";
const SERVER_ENTRY = fileURLToPath(new URL("./server.js", import.meta.url));
const SERVER_DIR = fileURLToPath(new URL(".", import.meta.url));
const HB_LOGO_DATA_URL = `data:image/png;base64,${readFileSync(new URL("./public/hb-logo.png", import.meta.url)).toString("base64")}`;

async function issueShopifyAccessToken() {
  const shop = String(process.env.SHOPIFY_SHOP || "0pprf1-jj.myshopify.com")
    .trim()
    .toLowerCase();
  const clientId = String(process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.SHOPIFY_CLIENT_SECRET || "").trim();

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error("SHOPIFY_SHOP must be a valid *.myshopify.com domain");
  }
  if (!clientId || !clientSecret) {
    throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required when SHOPIFY_ADMIN_TOKEN is not set");
  }

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    }),
    signal: AbortSignal.timeout(30_000)
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.access_token) {
    const detail = payload?.error_description || payload?.error || text.slice(0, 300);
    throw new Error(`Shopify token request failed (${response.status}): ${detail}`);
  }

  return {
    shop,
    accessToken: payload.access_token,
    expiresIn: Math.max(Number(payload.expires_in) || 86_400, 600)
  };
}

async function runWithIssuedShopifyToken() {
  const restartBufferSeconds = 5 * 60;
  let stopping = false;

  const shutdown = (child, signal) => {
    stopping = true;
    if (child) child.kill(signal);
    setTimeout(() => process.exit(1), 15_000).unref();
  };

  while (!stopping) {
    const { shop, accessToken, expiresIn } = await issueShopifyAccessToken();
    console.log(`Shopify credentials accepted for ${shop}; starting server with a temporary Admin API token.`);

    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        SHOPIFY_SHOP: shop,
        SHOPIFY_ADMIN_TOKEN: accessToken,
        SHOPIFY_TOKEN_BOOTSTRAPPED: "1"
      },
      stdio: "inherit"
    });

    process.once("SIGTERM", () => shutdown(child, "SIGTERM"));
    process.once("SIGINT", () => shutdown(child, "SIGINT"));

    const restartAfterMs = Math.max(
      (expiresIn - restartBufferSeconds) * 1000,
      5 * 60 * 1000
    );

    const code = await new Promise((resolve) => {
      const refreshTimer = setTimeout(() => {
        if (!stopping) {
          console.log("Refreshing Shopify credentials with a controlled restart.");
          child.kill("SIGTERM");
        }
      }, restartAfterMs);
      refreshTimer.unref();

      child.once("exit", (exitCode) => {
        clearTimeout(refreshTimer);
        resolve(exitCode);
      });
    });

    if (stopping) process.exit(code ?? 0);
    if (code && code !== 0) {
      console.error(`Server exited with code ${code}; retrying in 5 seconds.`);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

if (!process.env.SHOPIFY_ADMIN_TOKEN && !SHOPIFY_TOKEN_BOOTSTRAPPED) {
  try {
    await runWithIssuedShopifyToken();
  } catch (error) {
    console.error(error?.stack || error);
    process.exit(1);
  }
}

const app = express();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Firebase Admin SDK — FCM push notifications ──
import { createRequire } from "module";
const _require = createRequire(import.meta.url);

let _fbInitialized = false;
function getFirebaseAdmin() {
  if (_fbInitialized) return admin;
  try {
    let serviceAccount = null;

    // 1) من متغير البيئة (إن وُجد)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      let raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
      // أحياناً تكون مُضمَّنة مرتين (double-stringified)
      if (raw.startsWith('"')) raw = JSON.parse(raw);
      serviceAccount = typeof raw === "string" ? JSON.parse(raw) : raw;
    }

    // 2) من ملف بجانب server.js (الأسهل — ضع الملف هنا)
    if (!serviceAccount) {
      // Independent deployment: never fall back to the original store's Firebase project.
      const paths = [
        new URL("./firebase-service-account.json", import.meta.url),
      ];
      for (const p of paths) {
        if (existsSync(p)) {
          serviceAccount = JSON.parse(readFileSync(p, "utf8"));
          break;
        }
      }
    }

    if (!serviceAccount) {
      console.warn("⚠️  Firebase: لا يوجد ملف service account — FCM معطّل");
      return null;
    }

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    _fbInitialized = true;
    console.log("✅ Firebase Admin SDK جاهز للإشعارات");
  } catch (e) {
    console.error("Firebase init error:", e.message);
    return null;
  }
  return admin;
}

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder, resource_type: "image" }, (err, result) => {
        if (err) return reject(err);
        resolve({ url: result.secure_url, publicId: result.public_id });
      })
      .end(buffer);
  });
}

const shipmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function shipmentPhotoKey(orderCode) {
  return `bt:driver:shipment-photo:${String(orderCode || "").replace("#","").trim()}`;
}

function esc(s){
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));
}

function oneLine(s){
  return String(s || "").replace(/\s+/g, " ").trim();
}

function normTags(tags){
  if (Array.isArray(tags)) return tags.map(x => String(x).trim()).filter(Boolean);
  return String(tags || "").split(",").map(x => x.trim()).filter(Boolean);
}

function hasTag(order, tag){
  return normTags(order.tags).includes(String(tag).trim());
}

function isArabic(order){
  return hasTag(order, "ar");
}

function cleanPhone(p){
  let v = oneLine(p).replace(/\s+/g, "");
  if (v.length > 8) v = v.replace(/^(\+968|968)/, "");
  return v;
}

function cleanName(name){
  const v = oneLine(name);
  if (!v) return "";
  const parts = v.split(" ").filter(Boolean);

  if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
    return parts[0];
  }

  const tooLong = v.length > 18 || parts.length > 2;
  if (tooLong) return parts[0];

  return v;
}

function cleanAddress(shippingText){
  const s = oneLine(shippingText);
  if (!s) return "";

  const parts = s.split(/,|\n|-/).map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return s;

  const a1 = parts[0].replace(/\s+/g,"").toLowerCase();
  const city = parts[1].replace(/\s+/g,"").toLowerCase();

  let out = parts;
  if (a1 === city) out = [parts[0], ...parts.slice(2)];
  return out.join(" - ");
}

function getAddressText(o){
  const direct = cleanAddress(
    o.shipping ||
    o.address ||
    [o.addressLine, o.cityName || o.city].filter(Boolean).join(", ") ||
    o.shipping_address ||
    ""
  );
  if (direct) return direct;

  const src = o.shippingAddress || o.shipping_address || o.shipping_address_obj || {};
  const parts = [
    src.address1,
    src.address2,
    src.city,
    src.province,
    src.zip
  ].map(oneLine).filter(Boolean);

  return cleanAddress(parts.join(", "));
}

function clampChars(s, max){
  const v = oneLine(s);
  if (!v) return "";
  return v.length > max ? (v.slice(0, max - 1) + "…") : v;
}

function clampLines(lines){
  return `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${lines};overflow:hidden;`;
}

function money(n){
  return Number(n || 0).toFixed(3);
}

function getOutstanding(o){
  const v = o.outstanding ?? o.amountDue ?? o.total_outstanding ?? 0;
  return Number(v || 0) || 0;
}

function getFinancialStatus(o){
  const raw = String(o.financial_status || o.displayFinancialStatus || "").toLowerCase().trim();

  if (raw === "paid") return "paid";
  if (raw === "pending") return "pending";
  if (raw === "partially_paid") return "partially_paid";

  if (raw.includes("paid")) return "paid";
  if (raw.includes("pending")) return "pending";
  if (raw.includes("partial")) return "partially_paid";

  return raw;
}

function statusLabel(o, f, unpaid){
  const ar = isArabic(o);

  if (f === "pending") return ar ? "انتظار الدفع" : "Unpaid";
  if (f === "paid") return ar ? "مدفوع" : "Paid";
  if (f === "partially_paid") return ar ? "مدفوع جزئياً" : "Part-paid";

  return unpaid > 0 ? (ar ? "انتظار الدفع" : "Pending payment") : (ar ? "مدفوع" : "Paid");
}

function paidGatewayIcon(o){
  const tx = Array.isArray(o.transactions) ? o.transactions : [];
  for (const t of tx){
    const g = String(t.gateway || "").toLowerCase();
    if (g.includes("bank") || g.includes("deposit")) return "bi-bank";
    if (g.includes("amwal")) return "bi-credit-card";
    if (g.includes("cod") || g.includes("cash")) return "bi-bank2";
  }
  return "bi-check-circle";
}

function statusIcon(o, f){
  if (f === "pending") return "bi-clock-history";
  if (f === "paid") return paidGatewayIcon(o);
  if (f === "partially_paid") return "bi-cash-stack";
  return "bi-info-circle";
}


function getCountryDialCode(o){
  let c =
    o.billingAddress?.countryCodeV2 ||
    o.billing_country_code ||
    o.billingCountryCode ||
    o.shippingAddress?.countryCodeV2 ||
    o.shipping_country_code ||
    o.shippingCountryCode ||
    "";

  c = String(c).toUpperCase();

  const map = {
    OM: "968",
    AE: "971",
    SA: "966",
    QA: "974",
    KW: "965",
    BH: "973"
  };

  return map[c] || "968";
}

function isGinacomOffice(o){
  const shippingMethod = String(o.shipping_method || "").toLowerCase();
  return hasTag(o, "مكتب") || hasTag(o, "office") || shippingMethod.includes("جيناكم") || shippingMethod.includes("ginacom");
}

function renderShipmentLabelHtml(o){
  const ar = isArabic(o);
  const dir = ar ? "rtl" : "ltr";
  const align = ar ? "right" : "left";

  const unpaid = getOutstanding(o);
  const f = getFinancialStatus(o);
  const ginacom = isGinacomOffice(o);

  const addressText = getAddressText(o);
  const noteText = String(o.note || "").trim();
  const amountText = f === "paid" ? statusLabel(o, f, unpaid) : money(unpaid);

  return `
<!DOCTYPE html>
<html lang="ar">
<head>
<meta charset="UTF-8">

<link href="https://fonts.googleapis.com/css2?family=Almarai:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css">
<link href="https://fonts.googleapis.com/icon?family=Material+Icons+Outlined" rel="stylesheet">

<style>
  html, body{
    margin:0;
    padding:0;
    background:transparent;
    width:max-content;
    height:max-content;
  }

  body{
    font-family:'Almarai', sans-serif;
    display:inline-block;
  }

  .canvas{
    display:inline-block;
    padding:0;
    box-sizing:border-box;
  }

  .label{
    width:100mm;
    height:150mm;
    background:#f9f9f9;
    border:1px solid #9b9b9b;
    border-radius:10px;
    box-shadow:0 2px 6px rgba(0,0,0,0.12);
    padding:8mm;
    box-sizing:border-box;
    overflow:hidden;
  }

  .logo-container{
    border-bottom:2px solid #000;
    padding:0 0 10px 0;
    margin-bottom:10px;
    text-align:center;
  }

  .logo{
    max-height:2cm;
    max-width:100%;
    filter:grayscale(100%);
  }

  .contact-row{
    display:flex;
    justify-content:space-between;
    margin-bottom:5px;
    gap:8px;
  }

  .contact-item{
    display:flex;
    align-items:center;
    font-weight:bold;
    font-size:15px;
    white-space:nowrap;
    line-height:1;
  }

  .large-icon{
    font-size:24px;
    line-height:1;
  }

  .info-title{
    font-size:14px;
    font-weight:bold;
    text-align:center;
    margin:10px 0;
    border-top:1px solid #000;
    padding-top:5px;
    line-height:1.35;
  }

  .table-section{
    width:100%;
    border-collapse:collapse;
    font-size:12px;
    margin-bottom:5px;
    table-layout:fixed;
  }

  .table-section td{
    border:1px dashed #000;
    width:50%;
    padding:4px 6px;
    line-height:1.1;
    vertical-align:middle;
    box-sizing:border-box;
  }

  .section-title{
    background:#f0f0f0;
    font-weight:bold;
    text-align:center;
  }

  .table-section tr:nth-child(2) td{
    height:28px;
    white-space:nowrap;
    overflow:hidden;
    text-overflow:ellipsis;
  }

  .table-section i,
  .contact-row i{
    line-height:1;
    display:inline-block;
    vertical-align:middle;
  }

  .status-box{
    border:2px dashed #000;
    padding:10px;
    border-radius:5px;
    box-sizing:border-box;
  }

  .money-box{
    text-align:center;
    border-bottom:2px dashed #000;
    padding-bottom:10px;
    margin-bottom:10px;
  }

  .money-value{
    font-size:22px;
    font-weight:bold;
  }

  .status-row{
    display:flex;
    align-items:stretch;
  }

  .status-col{
    flex:1;
    text-align:center;
    font-size:16px;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:6px;
    min-height:32px;
  }

  .status-col + .status-col{
    border-inline-start:2px dashed #000;
  }

  .combined-box{
    border:2px dashed #000;
    padding:8px;
    border-radius:8px;
    background:#fff;
    margin-top:8px;
  }

  .details-section{
    display:flex;
    gap:10px;
    justify-content:flex-start;
    align-items:center;
  }

  .details-box{
    padding:10px;
    background:#f9f9f9;
    border:1px solid #ddd;
    text-align:center;
    font-size:14px;
    font-weight:bold;
    border-radius:8px;
    display:flex;
    align-items:center;
    justify-content:center;
    gap:8px;
    min-width:0;
  }

  .address-box{
    padding:12px;
    border:2px solid #000;
    margin-top:8px;
    border-radius:8px;
    background:#fff;
    height:72px;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:16px;
    font-weight:bold;
    flex-direction:column;
    text-align:center;
    overflow:hidden;
  }

  .address-text{
    max-width:100%;
  }

  .office-line{
    font-size:14px;
    font-weight:bold;
    margin-top:8px;
  }

  .note-line{
    font-size:14px;
    font-weight:bold;
    margin-top:8px;
  }

  .amount-box{
    display:flex;
    justify-content:center;
    align-items:center;
    gap:8px;
    font-size:18px;
    font-weight:bold;
    background:#fff;
    border:2px solid #000;
    height:46px;
    margin-top:8px;
    border-radius:8px;
  }

  .barcode-section,
  .qr-code{
    width:48%;
    text-align:center;
    margin:0 auto;
  }

  .barcode-img{
    width:28mm;
    height:28mm;
    object-fit:contain;
  }

  .qr-code img{
    height:28mm;
    width:28mm;
    object-fit:contain;
  }

  .order-number{
    font-size:12px;
    font-weight:bold;
    text-align:center;
    margin-top:5px;
  }

  .address-wrap{
    line-height:1.15;
    margin:0;
    padding:0;
  }

  .sub-line{
    text-align:center;
    margin:2px 0 0 0;
    padding:0;
    font-size:14px;
    line-height:1.1;
  }

  .www-row{
    display:flex;
    align-items:center;
    margin:15px 0 0;
  }

  .www-line{
    flex:1;
    height:1px;
    background:linear-gradient(to right, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 100%);
  }

  .www-text{
    margin:0 2px;
    font-size:8px;
    letter-spacing:4px;
    color:#000;
    text-transform:uppercase;
    white-space:nowrap;
  }
</style>
</head>

<body>
  <div class="canvas">
    <div class="label" style="direction:${dir};text-align:${align}">

      <div class="logo-container">
        <img src="${HB_LOGO_DATA_URL}" class="logo" alt="Hala Beauty">
      </div>

      <div class="combined-box">
        <div class="details-section">
          <div class="details-box" style="flex-grow:1;">
            <i class="bi bi-person-circle" style="font-size:24px;"></i>
            <div>${esc(cleanName(o.customer) || (ar ? "غير معروف" : "Unknown"))}</div>
          </div>

          <div class="details-box" style="flex-grow:1;">
            <i class="bi bi-phone" style="font-size:24px;"></i>
            <div>${esc(cleanPhone(o.phone))}</div>
          </div>
        </div>
      </div>

      <div class="address-box">
        <i class="bi bi-geo-alt-fill" style="font-size:24px;"></i>
        <div class="address-text" style="${clampLines(ginacom ? 2 : 3)}">${esc(addressText)}</div>
        ${ginacom ? `<div class="office-line"><i class="bi bi-geo-alt" style="font-size:20px;"></i> ${ar ? "مكتب جيناكم" : "Ginacom Office"}</div>` : ""}
        ${noteText ? `<div class="note-line" style="${clampLines(1)}"><i class="bi bi-chat-square-text" style="font-size:20px;"></i> ${esc(clampChars(noteText,45))}</div>` : ""}
      </div>

      <div class="amount-box">
        <i class="bi bi-wallet2" style="font-size:24px;"></i>
        <span>${esc(amountText)}</span>
      </div>

      <div class="combined-box" style="display:flex;justify-content:space-between;gap:8px;">
        <div class="barcode-section">
          <img class="barcode-img" src="https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(o.name)}&code=Code128" alt="Order Barcode">
          <div class="order-number">${esc(o.name)}</div>
        </div>

        <div class="qr-code">
          ${
            ginacom
              ? `<img src="https://api.qrserver.com/v1/create-qr-code/?data=https://halabt.com/app&size=150x150" alt="QR Code">`
              : `<img src="https://api.qrserver.com/v1/create-qr-code/?data=https://wa.me/${getCountryDialCode(o)}${cleanPhone(o.phone)}&size=150x150" alt="QR Code">`
          }
        </div>
      </div>

    </div>
  </div>
</body>
</html>
  `;
}

async function labelHtmlToPngBuffer(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 1200,
      height: 1800,
      deviceScaleFactor: 2
    });

    await page.setContent(html, {
      waitUntil: ["domcontentloaded", "networkidle0"]
    });

    const element = await page.$(".canvas");
    if (!element) throw new Error("Canvas element not found");

    return await element.screenshot({
      type: "png"
    });
  } finally {
    await browser.close();
  }
}


app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://halabt.com");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});


app.post("/api/shopify/webhooks/orders-create", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const topic = String(req.get("x-shopify-topic") || "").trim().toLowerCase();

    if (topic !== "orders/create") {
      return res.status(400).send("invalid topic");
    }

    const payload = JSON.parse(
      Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "{}"
    );

    const baseUrl = `https://${req.get("host")}`;

const r = await fetch(`${baseUrl}/api/manage/push/order-created`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-push-auth": String(process.env.PUSH_AUTH_TOKEN || "")
  },
body: JSON.stringify({
  id: payload?.id || "",
  admin_graphql_api_id: payload?.admin_graphql_api_id || "",
  name: payload?.name || "",
  phone: payload?.phone || "",
  current_total_price: payload?.current_total_price || payload?.total_price || "",
  currency: payload?.currency || "OMR",
  shipping_address: payload?.shipping_address || {},
  customer: payload?.customer || {},
  customer_first_name: payload?.customer?.first_name || ""
})
});

    
    const text = await r.text().catch(() => "");
    if (!r.ok) {
      console.error("push order-created failed:", r.status, text);
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error("orders-create webhook error:", e);
    return res.status(500).send("error");
  }
});



// ── capture raw body لجميع Shopify webhooks قبل express.json() ──
// مهم: يجب أن يكون قبل express.json() وإلا يُستهلك الـ stream
app.use('/api/shopify/webhooks/', (req, res, next) => {
  if (req.headers['content-type']?.includes('application/json')) {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    next();
  }
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


app.use("/api/meta", metaEmbeddedRoutes());
app.use("/api", customerCreditPublicRouter());
app.use("/api", customerCreditAmwalRouter({ getRedis, getFirebaseAdmin }));
app.use("/api", customerRewardsPublicRouter({ getRedis, getFirebaseAdmin }));
app.use("/api", appCampaignsRouter());

app.get(["/invite/:code", "/en/invite/:code", "/ar/invite/:code"], (req, res) => {
  const code = String(req.params.code || "").trim().replace(/[^A-Za-z0-9]+/g, "").toUpperCase();
  const pathLang = req.path.startsWith("/en/") ? "en" : req.path.startsWith("/ar/") ? "ar" : "";
  const acceptLang = String(req.get("accept-language") || "").toLowerCase();
  const lang = pathLang || (acceptLang.startsWith("en") ? "en" : "ar");
  const isEn = lang === "en";
  const dir = isEn ? "ltr" : "rtl";
  const storeLink = isEn ? "https://halabt.com/en" : "https://halabt.com";
  const pageTitle = isEn ? "Hala Beauty Invite" : "دعوة هلا بيوتي";
  const message = isEn
    ? "Opening Hala Beauty. If the app is not installed, you will be redirected to the store."
    : "جاري فتح هلا بيوتي. إذا لم يكن التطبيق مثبتًا، سيتم تحويلك للمتجر.";
  const codeLabel = isEn ? "Invite code" : "\u0643\u0648\u062f \u0627\u0644\u062f\u0639\u0648\u0629";
  const fallback = isEn ? "Continue to store" : "\u0627\u0644\u0645\u062a\u0627\u0628\u0639\u0629 \u0644\u0644\u0645\u062a\u062c\u0631";
  const ogDescription = isEn
    ? "Join Hala Beauty from this invite link."
    : "\u0627\u0646\u0636\u0645\u064a \u0625\u0644\u0649 \u0647\u0644\u0627 \u0628\u064a\u0648\u062a\u064a \u0639\u0628\u0631 \u0631\u0627\u0628\u0637 \u0627\u0644\u062f\u0639\u0648\u0629.";

  res.set("Cache-Control", "no-store");
  res.type("html").send(`<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${pageTitle}</title>
  <meta property="og:title" content="Hala Beauty">
  <meta property="og:description" content="${ogDescription}">
  <script>window.setTimeout(function(){ window.location.replace(${JSON.stringify(storeLink)}); }, 2600);</script>
  <style>
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:linear-gradient(160deg,#fff7f4 0%,#f7edf7 52%,#fff 100%);color:#2c1238;display:grid;min-height:100vh;place-items:center}
    main{width:min(430px,calc(100% - 32px));text-align:center;padding:22px 18px 24px;border-radius:28px;background:rgba(255,255,255,.78);box-shadow:0 22px 60px rgba(76,19,100,.16);border:1px solid rgba(123,11,143,.10);backdrop-filter:blur(12px)}
    .logoWrap{width:112px;height:112px;margin:0 auto 14px;border-radius:28px;overflow:hidden;box-shadow:0 18px 38px rgba(87,23,98,.22)}
    img{display:block;width:100%;height:100%;object-fit:cover}
    h1{margin:0 0 8px;font-size:23px;font-weight:900;letter-spacing:.1px}
    p{margin:0 auto 16px;max-width:320px;line-height:1.7;color:#6c5574;font-size:14px}
    .code{display:inline-flex;align-items:center;gap:8px;margin:0 0 16px;padding:8px 12px;border-radius:999px;background:rgba(123,11,143,.08);color:#7b0b8f;font-weight:800;font-size:12px;direction:ltr}
    .loader{width:44px;height:44px;margin:2px auto 16px;border-radius:50%;border:3px solid rgba(123,11,143,.12);border-top-color:#7b0b8f;animation:spin .8s linear infinite}
    a{display:inline-block;text-decoration:none;color:#7b0b8f;font-weight:800;font-size:13px}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <main>
    <div class="logoWrap"><img src="/btcm/logoinf.png" alt="Hala Beauty"></div>
    <h1>Hala Beauty</h1>
    <p>${message}</p>
    <div class="code">${codeLabel}: ${code}</div>
    <div class="loader" aria-label="loading"></div>
    <a href="${storeLink}">${fallback}</a>
  </main>
</body>
</html>`);
});
app.use(express.static("public"));

app.use(dalileeRoutes);

app.use("/pro/products", proProductsTagsRouter);
app.use("/pro", productVideoStatsRouter({ getRedis }));
app.use("/pro", requirePackKey, inventoryRouter({ getRedis }));
app.use("/pro", requirePackKey, productVideosRouter({ getRedis }));
app.use("/pro", requirePackKey, customerCreditRouter({ getRedis, getFirebaseAdmin }));
app.use("/pro", requirePackKey, customerRewardsRouter({ getRedis, getFirebaseAdmin }));
app.use("/pro", requirePackKey, customerNotificationsRouter({ getRedis, getFirebaseAdmin }));
app.use("/pro", requirePackKey, autoNotificationTemplatesRouter({ getRedis }));
app.use("/pro", requirePackKey, appCampaignsRouter({ admin: true }));
app.use("/api/pack-shopify", packShopifyRouter);

app.use(moneyRoutes({
  getRedis,
  requireAdmin,
  requirePack,
  WEB_PUSH_PUBLIC_KEY: process.env.WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY: process.env.WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_SUBJECT: process.env.WEB_PUSH_SUBJECT
}));

const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP;
const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN || "";
const PORT = process.env.PORT || 3000;

async function shopifyGraphQL(query, variables = {}) {
  const API_VERSION = process.env.SHOPIFY_GQL_VERSION || "2025-01";

  const response = await fetch(
    `https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const data = await response.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function storefrontGraphQL(query, variables = {}) {
  if (!SHOPIFY_STOREFRONT_TOKEN) {
    throw new Error("SHOPIFY_STOREFRONT_TOKEN غير موجود في Render ENV");
  }

  const API_VERSION = process.env.SHOPIFY_GQL_VERSION || "2025-01";

  const response = await fetch(
    `https://${SHOPIFY_SHOP}/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN
      },
      body: JSON.stringify({ query, variables })
    }
  );

  const data = await response.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

const deps = {
  shopifyGraphQL,
  storefrontGraphQL,
  SHOPIFY_SHOP,
  SHOPIFY_ADMIN_TOKEN,
  SHOPIFY_STOREFRONT_TOKEN
};

app.use(trackUnifiedRoutes({ shopifyGraphQL, port: PORT, getRedis }));


// ✅ صفحة إدارة الطلبات + APIs (راوتر واحد)
app.use(ordersManageRouter({
  ...deps,
  getRedis,
  requirePack: requirePackKey,
  WEB_PUSH_PUBLIC_KEY: process.env.WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY: process.env.WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_SUBJECT: process.env.WEB_PUSH_SUBJECT,
  PUSH_AUTH_TOKEN: process.env.PUSH_AUTH_TOKEN
}));




app.get("/api/debug/tracking/:tn", async (req, res) => {
  try {
    const tn = String(req.params.tn || "").trim().toUpperCase();

    const q = `fulfillment_status:fulfilled status:any`;

    const query = `
      query ($q: String!) {
        orders(first: 50, query: $q, sortKey: PROCESSED_AT, reverse: true) {
          nodes {
            name
            id
            fulfillments {
              id
              trackingInfo {
                number
                company
                url
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { q });
    const orders = data?.orders?.nodes || [];

    const hits = [];

    for (const order of orders) {
      for (const f of order.fulfillments || []) {
        for (const t of f.trackingInfo || []) {
          if (String(t?.number || "").trim().toUpperCase() === tn) {
            hits.push({
              orderName: order.name,
              orderId: order.id,
              fulfillmentId: f.id,
              trackingNumber: t.number
            });
          }
        }
      }
    }

    return res.json({ tn, hitsCount: hits.length, hits });

  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
// باقي الراوترات
app.use(customerRoutes);
app.use("/api/prep", prepRoutes(deps));
app.use("/api/print", packRoutes(deps));
app.use("/api/export", packRoutes(deps));

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.redirect("https://halabt.com/app");
});

// فحص سريع
app.get("/health", (req, res) => {
  const t = process.env.SHOPIFY_ADMIN_TOKEN || "";
  res.json({
    shop: process.env.SHOPIFY_SHOP || null,
    tokenLength: t.length,
    tokenLast4: t ? t.slice(-4) : null
  });
});
// ================== ✅ LOCATION EXTRACT ==================
app.post("/api/location/extract", async (req, res) => {
  try {
    const input = String(req.body?.input || "").trim();
    const fallbackArea = String(req.body?.fallbackArea || "").trim();

    if (!input) {
      return res.status(400).json({
        ok: false,
        error: "input مطلوب"
      });
    }

    const result = await extractLocation(input, fallbackArea);

    return res.json({
      ok: true,
      lat: result.lat,
      lng: result.lng,
      googleMaps: `https://www.google.com/maps?q=${result.lat},${result.lng}`,
      source: result.source || "unknown",
      fullCode: result.fullCode || null,
      reference: result.reference || null,
      expandedUrl: result.expandedUrl || null
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: e.message || String(e)
    });
  }
});
/**
 * GET /api/order?code=1023
 * فلتر: مسقط + fulfilled
 * ويرجع:
 * - الاسم
 * - الرقم
 * - العنوان
 * - المدينة
 * - حالة التوصيل
 */
app.get("/api/order", async (req, res) => {
  try {
    const input = (req.query.code || "").toString().trim();
    if (!input) return res.status(400).json({ error: "اكتب رقم الطلب" });

    const clean = input.replace("#", "").trim();
    let shipmentPhotoUrl = "";
    const q =
      `(order_number:${clean} OR name:${clean} OR name:#${clean}) ` +
      `AND tag:مسقط AND fulfillment_status:fulfilled`;

    const query = `
      query ($q: String!) {
        orders(first: 1, query: $q) {
          nodes {
            id
            name
            note
            tags

            displayFinancialStatus
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

            fulfillments {
              id
              events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
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

    const data = await shopifyGraphQL(query, { q });
    const order = data.orders?.nodes?.[0];

    if (!order) {
      return res.status(404).json({
        error: "الطلب ليس في مسقط أو لم يتم الشحن بعد"
      });
    }

    const fulfillment = order.fulfillments?.[0];
    if (!fulfillment) {
      return res.status(400).json({ error: "الطلب غير جاهز للتوصيل" });
    }

    const lastEvent = fulfillment.events?.nodes?.[0]?.status || "";

    let deliveryState = "WAITING";
    if (lastEvent === "OUT_FOR_DELIVERY") deliveryState = "OUT";
    if (lastEvent === "DELIVERED") deliveryState = "DONE";

    const outstanding = Number(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
    const currency = (order?.totalOutstandingSet?.shopMoney?.currencyCode || "OMR").toString();

    const shipping = order.shippingAddress || {};
    const customer = order.customer || {};

    const customerName =
      (shipping.name || "").trim() ||
      [shipping.firstName || "", shipping.lastName || ""].join(" ").trim() ||
      [customer.firstName || "", customer.lastName || ""].join(" ").trim() ||
      "غير موجود";

    const customerPhone =
      (shipping.phone || "").toString().trim() ||
      (customer.phone || "").toString().trim() ||
      "غير موجود";

    const addressLine = [
      shipping.address1 || "",
      shipping.address2 || ""
    ].filter(Boolean).join(" - ").trim() || "غير موجود";

    const cityName = (shipping.city || "").toString().trim() || "غير موجود";
    const shipCountry = (shipping.countryCodeV2 || "").toString().trim() || "";
        try {
      const r = await getRedis();
      if (r) {
        const photo = await r.hGetAll(shipmentPhotoKey(clean));
        shipmentPhotoUrl = String(photo?.url || "").trim();
      }
    } catch {}

return res.json({
  orderId: order.id,
  orderName: order.name,
  fulfillmentId: fulfillment.id,

  deliveryState,
  lastEvent,

  note: order.note || "",

  tags: order.tags || [],
  paymentState: order.displayFinancialStatus || "",
  amountDue: outstanding,
  currency,

  customerName,
  customerPhone,
  phone: customerPhone,
  addressLine,
  address: addressLine,
  cityName,
  city: cityName,
  shipCountry,
    shipmentPhotoUrl
});
  
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});


/**
 * POST /api/status
 * { fulfillmentId, status, orderId }
 * status = OUT_FOR_DELIVERY | DELIVERED
 * عند DELIVERED يضيف tag "تم"
 */
app.post("/api/status", async (req, res) => {
  try {
    const { fulfillmentId, status, orderId } = req.body || {};
    if (!fulfillmentId) return res.status(400).json({ error: "fulfillmentId مطلوب" });

    const allowed = ["OUT_FOR_DELIVERY", "DELIVERED"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "status غير صحيح" });

    const mutation = `
      mutation ($input: FulfillmentEventInput!) {
        fulfillmentEventCreate(fulfillmentEvent: $input) {
          fulfillmentEvent { id status }
          userErrors { message }
        }
      }
    `;

    const data = await shopifyGraphQL(mutation, {
      input: { fulfillmentId, status }
    });

    const err = data.fulfillmentEventCreate.userErrors?.[0];
    if (err) return res.status(400).json({ error: err.message });

    if (status === "DELIVERED" && orderId) {
      try {
        await addTag(orderId, "تم");
      } catch (e) {
        return res.json({
          success: true,
          warn: "تم تحديث الحالة لكن فشل إضافة التاق: " + (e.message || e)
        });
      }
      try {
        const redis = await getRedis();
        await syncDeliveredOrderRewards({
          redis,
          orderId,
          shopifyGraphQL,
          forceDelivered: true,
          source: "driver_status"
        });
      } catch (rewardError) {
        console.error("rewards delivered sync failed:", rewardError?.message || rewardError);
      }
    }

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});


app.post("/api/driver/move-to-confirm", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const mutation = `
      mutation ($id: ID!, $remove: [String!]!, $add: [String!]!) {
        tagsRemove(id: $id, tags: $remove) {
          userErrors { message }
        }
        tagsAdd(id: $id, tags: $add) {
          userErrors { message }
        }
      }
    `;

    const data = await shopifyGraphQL(mutation, {
      id: orderId,
      remove: ["مسقط"],
      add: ["تاكيد"]
    });

    const err1 = data?.tagsRemove?.userErrors?.[0];
    if (err1) return res.status(400).json({ error: err1.message });

    const err2 = data?.tagsAdd?.userErrors?.[0];
    if (err2) return res.status(400).json({ error: err2.message });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
/**
 * POST /api/tag
 * { orderId, tag }
 */
app.post("/api/tag", async (req, res) => {
  try {
    const { orderId, tag } = req.body || {};
    if (!orderId || !tag) return res.status(400).json({ error: "orderId و tag مطلوبين" });

    await addTag(orderId, tag);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post("/api/tag/remove", async (req, res) => {
  try {
    const { orderId, tag } = req.body || {};
    if (!orderId || !tag) return res.status(400).json({ error: "orderId and tag required" });

    await removeTag(orderId, tag);
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

async function addTag(orderId, tag) {
  const mutation = `
    mutation ($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    id: orderId,
    tags: [tag]
  });

  const err = data.tagsAdd.userErrors?.[0];
  if (err) throw new Error(err.message);
}

/**
 * POST /api/note
 * { orderId, note }
 */
async function removeTag(orderId, tag) {
  const mutation = `
    mutation ($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        node { id }
        userErrors { message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    id: orderId,
    tags: [tag]
  });

  const err = data.tagsRemove.userErrors?.[0];
  if (err) throw new Error(err.message);
}

app.post("/api/note", async (req, res) => {
  try {
    const { orderId, note } = req.body || {};

    if (!orderId) {
      return res.status(400).json({ error: "orderId مطلوب" });
    }

    const finalNote = String(note || "").trim();

    if (!finalNote) {
      return res.status(400).json({ error: "اكتب الملاحظة" });
    }

    const mutation = `
      mutation ($input: OrderInput!) {
        orderUpdate(input: $input) {
          order {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await shopifyGraphQL(mutation, {
      input: {
        id: orderId,
        note: finalNote
      }
    });

    const err = data?.orderUpdate?.userErrors?.[0];
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    return res.json({
      success: true,
      note: data?.orderUpdate?.order?.note || finalNote
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
const PACK_KEY = String(process.env.PACK_KEY || "").trim();

function requirePack(req, res, next) {
  const key = String(req.headers["x-pack-key"] || "").trim();
  if (!PACK_KEY) return res.status(500).json({ error: "PACK_KEY غير مضبوط في ENV" });
  if (key !== PACK_KEY) return res.status(401).json({ error: "غير مصرح" });
  next();
}
// ================== ✅ BOUGHT STATE (PACK SYNC) ==================
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
let redis = null;

async function getRedis() {
  if (!REDIS_URL) return null;
  if (redis) return redis;

  redis = createClient({ url: REDIS_URL });
  redis.on("error", (e) => console.error("Redis error", e));
  await redis.connect();
  return redis;
}

function backInStockKey(targetId) {
  return `bt:backinstock:subs:${String(targetId || "").trim()}`;
}

function backInStockPushKey(targetId) {
  return `bt:backinstock:push:${String(targetId || "").trim()}`;
}

function backInStockProductLink(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;

  const clean = v
    .replace(/^\/+/, "")
    .replace(/^products\//i, "")
    .trim();

  return clean ? `https://app.halabt.com/products/${clean}` : "";
}

function normalizeLocale(locale) {
  const v = String(locale || "").trim().toLowerCase();
  return v === "en" ? "en" : "ar";
}

function normalizePhone(phone, countryCode = "") {
  let v = String(phone || "").replace(/\D+/g, "").trim();
  const cc = String(countryCode || "").trim().toUpperCase();

  const dialMap = {
    OM: "968",
    AE: "971",
    SA: "966",
    QA: "974",
    BH: "973",
    KW: "965"
  };

  const dialCode = dialMap[cc] || "";

  if (dialCode && v.startsWith(dialCode)) {
    v = v.slice(dialCode.length);
  }

  return v;
}

app.post("/api/back-in-stock/subscribe", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) {
      return res.status(500).json({ error: "REDIS_URL غير مضبوط" });
    }

    const targetId = String(
      req.body?.targetId || req.body?.variantId || ""
    ).trim();

    const countryCode = String(
      req.body?.countryCode || "OM"
    ).trim().toUpperCase();

    const phone = normalizePhone(req.body?.phone || "", countryCode);
    const locale = normalizeLocale(req.body?.locale || "ar");

    const productHandle = backInStockProductLink(req.body?.productHandle || "");
    const productTitle = String(req.body?.productTitle || "").trim();
    const productImage = String(
      req.body?.productImage ||
      req.body?.image ||
      req.body?.imageUrl ||
      req.body?.featuredImage ||
      ""
    ).trim();

    if (!targetId) {
      return res.status(400).json({ error: "targetId مطلوب" });
    }

    if (!phone) {
      return res.status(400).json({ error: "phone مطلوب" });
    }

    const key = backInStockKey(targetId);
    const now = new Date().toISOString();

    let list = [];
    const raw = await r.get(key);

      if (raw) {
        try {
          list = JSON.parse(raw);
          if (!Array.isArray(list)) list = [];
        } catch {
          list = [];
        }
      }

      let listDirty = false;
      list = list.map((x) => {
        if (!x || typeof x !== "object") return x;
        const normalized = backInStockProductLink(x.productHandle || "");
        if (normalized && normalized !== String(x.productHandle || "").trim()) {
          listDirty = true;
          return { ...x, productHandle: normalized };
        }
        return x;
      });

    list = list.filter(
      (x) => x && typeof x === "object" && String(x.phone || "").trim()
    );

    const exists = list.find((x) => {
      const itemPhone = normalizePhone(x.phone || "", x.countryCode || "");
      return itemPhone === phone;
    });

    if (exists) {
      exists.locale = locale;
      exists.countryCode = countryCode;
      exists.productHandle = productHandle || exists.productHandle || "";
      exists.productTitle = productTitle || exists.productTitle || "";
      exists.productImage = productImage || exists.productImage || "";
      exists.updatedAt = now;
      exists.sent = false;
      delete exists.sentAt;
    } else {
      list.push({
        phone,
        countryCode,
        locale,
        productHandle,
        productTitle,
        productImage,
        createdAt: now,
        updatedAt: now,
        sent: false
      });
    }

    await r.set(key, JSON.stringify(list));
    await r.sAdd("bt:backinstock:index", targetId);

    return res.json({
      ok: true,
      targetId,
      count: list.filter((x) => !x.sent).length
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || String(e)
    });
  }
});

// ── تسجيل FCM token للإشعار عند توفر المنتج ──
app.post("/api/back-in-stock/subscribe-push", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const targetId    = String(req.body?.variantId || req.body?.targetId || "").trim();
    const fcmToken    = String(req.body?.fcmToken || "").trim();
    if (!targetId)  return res.status(400).json({ error: "variantId مطلوب" });
    if (!fcmToken)  return res.status(400).json({ error: "fcmToken مطلوب" });

    const productHandle = backInStockProductLink(req.body?.productHandle || "");
    const productTitle  = String(req.body?.productTitle  || "").trim();
    const productImage  = String(req.body?.productImage  || "").trim();
    const locale        = normalizeLocale(req.body?.locale || "ar");
    const now           = new Date().toISOString();
    const key           = backInStockPushKey(targetId);

    let list = [];
    const raw = await r.get(key);
    if (raw) {
      try { list = JSON.parse(raw); if (!Array.isArray(list)) list = []; } catch { list = []; }
    }

    const exists = list.find(x => x.fcmToken === fcmToken);
    if (exists) {
      exists.locale        = locale;
      exists.productHandle = productHandle || exists.productHandle;
      exists.productTitle  = productTitle  || exists.productTitle;
      exists.productImage  = productImage  || exists.productImage;
      exists.updatedAt     = now;
      exists.sent          = false;
      delete exists.sentAt;
    } else {
      list.push({ fcmToken, targetId, productHandle, productTitle, productImage, locale, createdAt: now, sent: false });
    }

    await r.set(key, JSON.stringify(list));
    await r.sAdd("bt:backinstock:push:index", targetId);
    return res.json({ ok: true, targetId });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ── تسجيل FCM token للمستخدم المسجّل — إشعارات حالة الطلب ──
app.post("/api/users/register-push-token", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const rawId      = String(req.body?.customerId || "").trim();
    const fcmToken   = String(req.body?.fcmToken   || "").trim();
    const locale     = String(req.body?.locale || req.body?.lang || "").trim().toLowerCase();
    if (!rawId)    return res.status(400).json({ error: "customerId مطلوب" });
    if (!fcmToken) return res.status(400).json({ error: "fcmToken مطلوب" });

    // Normalize: gid://shopify/Customer/7234567890 → 7234567890
    const customerId = rawId.includes('/') ? (rawId.split('/').pop() || rawId) : rawId;

    // نحفظ آخر token للعميل (مفتاح بسيط — يُحدَّث عند كل دخول)
    await r.set(`bt:user:push:${customerId}`, fcmToken, { EX: 60 * 60 * 24 * 90 }); // 90 يوماً
    if (locale) {
      await r.set(`bt:user:push-locale:${customerId}`, locale.startsWith("en") ? "en" : "ar", { EX: 60 * 60 * 24 * 90 });
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/customer-notifications/list/:customerId", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "Redis not ready" });
    const rawId = String(req.params.customerId || "").trim();
    const customerId = rawId.includes("/") ? (rawId.split("/").pop() || rawId) : rawId;
    if (!customerId) return res.status(400).json({ error: "customerId required" });
    const rows = await r.lRange(`bt:user:notifications:${customerId}`, 0, 99);
    const notifications = rows
      .map((row) => {
        try {
          return JSON.parse(row);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
    return res.json({ ok: true, notifications });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/back-in-stock/list", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const targetId = String(req.query?.targetId || req.query?.variantId || "").trim();
    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });

    const raw = await r.get(backInStockKey(targetId));

    let list = [];
    if (raw) {
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }

    return res.json({
      ok: true,
      targetId,
      count: list.length,
      items: list
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/back-in-stock/pull", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const targetId = String(req.body?.targetId || req.body?.variantId || "").trim();
    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });

    const raw = await r.get(backInStockKey(targetId));

    let list = [];
    if (raw) {
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }

    const pending = list.filter(x => !x.sent);

    console.log("BACK_IN_STOCK_PULL", {
      targetId,
      count: pending.length,
      items: pending
    });

    return res.json({
      ok: true,
      targetId,
      count: pending.length,
      items: pending
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/back-in-stock/manual-pull", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const targetId = String(req.body?.targetId || req.body?.variantId || "").trim();
    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });

    const raw = await r.get(backInStockKey(targetId));

    let list = [];
    if (raw) {
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }

    const pending = list.filter(x => !x.sent);

    console.log("BACK_IN_STOCK_MANUAL_PULL", {
      targetId,
      count: pending.length,
      items: pending
    });

    return res.json({
      ok: true,
      targetId,
      count: pending.length,
      items: pending
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/back-in-stock/mark-sent", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const targetId = String(req.body?.targetId || req.body?.variantId || "").trim();
    const phone = normalizePhone(req.body?.phone || "", req.body?.countryCode || "");

    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });
    if (!phone) return res.status(400).json({ error: "phone مطلوب" });

    const key = backInStockKey(targetId);
    const raw = await r.get(key);

    let list = [];
    if (raw) {
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }

let found = false;

for (const item of list) {
  const itemPhone = normalizePhone(item.phone || "", item.countryCode || "");
  if (itemPhone === phone) {
    item.sent = true;
    item.sentAt = new Date().toISOString();
    found = true;
  }
}
    await r.set(key, JSON.stringify(list));

    return res.json({
      ok: true,
      targetId,
      phone,
      found
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/back-in-stock/remove", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط" });

    const targetId = String(req.body?.targetId || req.body?.variantId || "").trim();
    const phone = normalizePhone(req.body?.phone || "", req.body?.countryCode || "");

    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });
    if (!phone) return res.status(400).json({ error: "phone مطلوب" });

    const key = backInStockKey(targetId);
    const raw = await r.get(key);

    let list = [];
    if (raw) {
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }
    }

    list = list.filter(x => x && typeof x === "object" && String(x.phone || "").trim());

    const filtered = list.filter(x => {
      const itemPhone = normalizePhone(x.phone || "", x.countryCode || "");
      return itemPhone !== phone;
    });

    if (!filtered.length) {
      await r.del(key);
      await r.sRem("bt:backinstock:index", targetId);
    } else {
      await r.set(key, JSON.stringify(filtered));
      await r.sAdd("bt:backinstock:index", targetId);
    }

    return res.json({
      ok: true,
      targetId,
      count: filtered.filter(x => !x.sent).length
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});



const BACKINSTOCK_QUEUE_SET_KEY = "bt:backinstock:queue:active";
const BACKINSTOCK_QUEUE_DELAY_MINUTES = Number(process.env.BACKINSTOCK_QUEUE_DELAY_MINUTES || 30);

function backInStockStateKey(targetId) {
  return `bt:backinstock:state:${String(targetId || "").trim()}`;
}

function fullPhone(phone, countryCode = "") {
  const local = normalizePhone(phone, countryCode);
  const cc = String(countryCode || "").trim().toUpperCase();

  const dialMap = {
    OM: "968",
    AE: "971",
    SA: "966",
    QA: "974",
    BH: "973",
    KW: "965"
  };

  const dialCode = dialMap[cc] || "";
  if (!local) return "";
  return dialCode ? `+${dialCode}${local}` : local;
}

async function backInStockLoadList(targetId) {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");

  const raw = await r.get(backInStockKey(targetId));

  let list = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }

  return list;
}

async function backInStockSaveList(targetId, list) {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");
  await r.set(backInStockKey(targetId), JSON.stringify(Array.isArray(list) ? list : []));
}

async function backInStockLoadState(targetId) {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");

  const raw = await r.get(backInStockStateKey(targetId));

  let state = {
    active: false,
    nextAt: 0,
    lastSentAt: null,
    updatedAt: null
  };

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = {
          ...state,
          ...parsed
        };
      }
    } catch {
      // ignore
    }
  }

  return state;
}

async function backInStockSaveState(targetId, state) {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");
  await r.set(
    backInStockStateKey(targetId),
    JSON.stringify({
      active: !!state.active,
      nextAt: Number(state.nextAt || 0),
      lastSentAt: state.lastSentAt || null,
      updatedAt: new Date().toISOString()
    })
  );
}

async function backInStockActivateQueue(targetId) {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");

  const list = await backInStockLoadList(targetId);
  const pending = list.filter(x => !x.sent);

  if (!pending.length) {
    return {
      ok: true,
      targetId,
      activated: false,
      reason: "NO_PENDING"
    };
  }

  const state = await backInStockLoadState(targetId);
  state.active = true;

  if (!state.nextAt || Number(state.nextAt) <= 0) {
    state.nextAt = Date.now();
  }

  await backInStockSaveState(targetId, state);
  await r.sAdd(BACKINSTOCK_QUEUE_SET_KEY, targetId);

  return {
    ok: true,
    targetId,
    activated: true,
    pendingCount: pending.length,
    nextAt: state.nextAt
  };
}

async function backInStockDeactivateQueue(targetId) {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");

  const state = await backInStockLoadState(targetId);
  state.active = false;
  await backInStockSaveState(targetId, state);
  await r.sRem(BACKINSTOCK_QUEUE_SET_KEY, targetId);
}

async function backInStockPendingItems(targetId) {
  const list = await backInStockLoadList(targetId);

  return list
    .filter(x => !x.sent)
    .sort((a, b) => {
      const at = new Date(a.createdAt || 0).getTime();
      const bt = new Date(b.createdAt || 0).getTime();
      return at - bt;
    });
}

// إذا اسم دالة الجراف كيو إل عندك مختلف، بدّل هذا السطر فقط
async function backInStockVariantAvailability(targetId) {
  const query = `
    query BackInStockVariant($id: ID!) {
      productVariant(id: $id) {
        id
        availableForSale
        inventoryQuantity
      }
    }
  `;

  const data = await shopifyGraphQL(query, { id: targetId });
  const variant = data?.productVariant;

  if (!variant) {
    return {
      ok: false,
      available: false,
      inventoryQuantity: 0
    };
  }

  const qty = Number(variant.inventoryQuantity || 0);
  const available = !!variant.availableForSale && qty > 0;

  return {
    ok: true,
    available,
    inventoryQuantity: qty
  };
}

async function backInStockPickNextReady() {
  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");

  const targetIds = await r.sMembers(BACKINSTOCK_QUEUE_SET_KEY);
  const now = Date.now();

  const ordered = [];

  for (const targetId of targetIds) {
    const state = await backInStockLoadState(targetId);
    ordered.push({
      targetId,
      nextAt: Number(state.nextAt || 0),
      active: !!state.active
    });
  }

  ordered.sort((a, b) => a.nextAt - b.nextAt);

  for (const row of ordered) {
    const targetId = row.targetId;
    const state = await backInStockLoadState(targetId);

    if (!state.active) {
      await r.sRem(BACKINSTOCK_QUEUE_SET_KEY, targetId);
      continue;
    }

    if (Number(state.nextAt || 0) > now) {
      continue;
    }

    const pending = await backInStockPendingItems(targetId);

    if (!pending.length) {
      await backInStockDeactivateQueue(targetId);
      continue;
    }

    const availability = await backInStockVariantAvailability(targetId);

    if (!availability.ok || !availability.available) {
      await backInStockDeactivateQueue(targetId);
      continue;
    }

    const first = pending[0];

    return {
      ok: true,
      count: 1,
      targetId,
      phone: first.phone || "",
      fullPhone: fullPhone(first.phone || "", first.countryCode || ""),
      countryCode: String(first.countryCode || "").toUpperCase(),
      locale: first.locale || "ar",
      productHandle: first.productHandle || "",
      productTitle: first.productTitle || ""
    };
  }

  return {
    ok: true,
    count: 0
  };
}

async function backInStockAckSent(targetId, phone, countryCode = "") {
  const normalized = normalizePhone(phone || "", countryCode || "");
  if (!normalized) {
    return { ok: false, found: false };
  }

  const list = await backInStockLoadList(targetId);

  let found = false;

  for (const item of list) {
    const itemPhone = normalizePhone(item.phone || "", item.countryCode || "");
    if (itemPhone === normalized && !item.sent) {
      item.sent = true;
      item.sentAt = new Date().toISOString();
      found = true;
      break;
    }
  }

  await backInStockSaveList(targetId, list);

  const pending = await backInStockPendingItems(targetId);

  if (!pending.length) {
    await backInStockDeactivateQueue(targetId);
    return {
      ok: true,
      found,
      targetId,
      pendingCount: 0,
      active: false
    };
  }

  const availability = await backInStockVariantAvailability(targetId);

  if (!availability.ok || !availability.available) {
    await backInStockDeactivateQueue(targetId);
    return {
      ok: true,
      found,
      targetId,
      pendingCount: pending.length,
      active: false
    };
  }

  const state = await backInStockLoadState(targetId);
  state.active = true;
  state.lastSentAt = new Date().toISOString();
  state.nextAt = Date.now() + (BACKINSTOCK_QUEUE_DELAY_MINUTES * 60 * 1000);

  await backInStockSaveState(targetId, state);

  const r = await getRedis();
  if (!r) throw new Error("REDIS_URL غير مضبوط");
  await r.sAdd(BACKINSTOCK_QUEUE_SET_KEY, targetId);

  return {
    ok: true,
    found,
    targetId,
    pendingCount: pending.length,
    active: true,
    nextAt: state.nextAt
  };
}

// ── إرسال FCM push لكل المشتركين بإشعار التطبيق لهذا المنتج ──
async function sendFcmPushToSubscribers(targetId, productHandle, productTitle) {
  const fa = getFirebaseAdmin();
  if (!fa) return { ok: false, reason: "firebase_not_initialized" };

  const r = await getRedis();
  if (!r) return { ok: false, reason: "redis_not_connected" };

  const key = backInStockPushKey(targetId);
  const raw = await r.get(key);
  if (!raw) return { ok: true, sent: 0 };

  let list = [];
  try { list = JSON.parse(raw); if (!Array.isArray(list)) list = []; } catch { list = []; }

  const pending = list.filter(x => !x.sent);
  if (!pending.length) return { ok: true, sent: 0 };

  let sentCount = 0;

  for (const item of pending) {
    try {
      const imageUrl = item.productImage || "";
      // استخدم الـ permalink المحفوظ مباشرة (هو رابط كامل)
      // أو ابنِ رابطاً من الـ handle إذا لم يكن الـ permalink رابطاً كاملاً
      const deepLink = backInStockProductLink(item.productHandle || productHandle || "");
      await fa.messaging().send({
        token: item.fcmToken,
        notification: {
          title: item.locale === "en" ? "Back in stock! 🎉" : "المنتج متوفر الآن! 🎉",
          body:  item.productTitle || productTitle || "",
          ...(imageUrl ? { imageUrl } : {}),
        },
        data:    { dynamic_link: deepLink },
        android: {
          notification: {
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            ...(imageUrl ? { imageUrl } : {}),
          },
        },
        ...(imageUrl ? {
          apns: {
            payload: { aps: { "mutable-content": 1 } },
            fcmOptions: { imageUrl },
          },
        } : {}),
      });
      item.sent   = true;
      item.sentAt = new Date().toISOString();
      sentCount++;
    } catch (e) {
      // token منتهي الصلاحية — نحذفه تلقائياً
      if (e.code === "messaging/registration-token-not-registered") item.invalid = true;
      console.error("FCM send error:", e.message);
    }
  }

  // احفظ القائمة وأزِل الـ tokens غير الصالحة
  await r.set(key, JSON.stringify(list.filter(x => !x.invalid)));
  return { ok: true, sent: sentCount };
}

app.post("/api/back-in-stock/activate", async (req, res) => {
  try {
    const targetId      = String(req.body?.targetId || req.body?.variantId || "").trim();
    const productHandle = String(req.body?.productHandle || "").trim();
    const productTitle  = String(req.body?.productTitle  || "").trim();
    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });

    const [result, pushResult] = await Promise.all([
      backInStockActivateQueue(targetId),
      sendFcmPushToSubscribers(targetId, productHandle, productTitle),
    ]);
    return res.json({ ...result, push: pushResult });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/back-in-stock/next-ready", async (req, res) => {
  try {
    const result = await backInStockPickNextReady();
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/back-in-stock/ack-sent", async (req, res) => {
  try {
    const targetId = String(req.body?.targetId || req.body?.variantId || "").trim();
    const countryCode = String(req.body?.countryCode || "").trim().toUpperCase();
    const phone = String(req.body?.phone || "").trim();

    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });
    if (!phone) return res.status(400).json({ error: "phone مطلوب" });

    const result = await backInStockAckSent(targetId, phone, countryCode);
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/back-in-stock/queue-status", async (req, res) => {
  try {
    const targetId = String(req.query?.targetId || req.query?.variantId || "").trim();
    if (!targetId) return res.status(400).json({ error: "targetId مطلوب" });

    const state = await backInStockLoadState(targetId);
    const pending = await backInStockPendingItems(targetId);

    return res.json({
      ok: true,
      targetId,
      active: !!state.active,
      nextAt: Number(state.nextAt || 0),
      lastSentAt: state.lastSentAt || null,
      pendingCount: pending.length,
      delayMinutes: BACKINSTOCK_QUEUE_DELAY_MINUTES
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ================== BACK IN STOCK DASHBOARD ==================
app.get("/api/back-in-stock/dashboard", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) {
      return res.status(500).json({ error: "REDIS_URL غير مضبوط" });
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 300), 1), 1000);

    const [phoneTargetIds, pushTargetIds] = await Promise.all([
      r.sMembers("bt:backinstock:index"),
      r.sMembers("bt:backinstock:push:index")
    ]);

    const targetIds = [...new Set([
      ...(Array.isArray(phoneTargetIds) ? phoneTargetIds : []),
      ...(Array.isArray(pushTargetIds) ? pushTargetIds : [])
    ].map((id) => String(id || "").trim()).filter(Boolean))];

    if (!Array.isArray(targetIds) || !targetIds.length) {
      return res.json({
        ok: true,
        count: 0,
        items: []
      });
    }

    const selectedTargetIds = targetIds.slice(0, limit);
    const keys = selectedTargetIds.map(
      (id) => `bt:backinstock:subs:${String(id || "").trim()}`
    );
    const pushKeys = selectedTargetIds.map(
      (id) => `bt:backinstock:push:${String(id || "").trim()}`
    );

    const [vals, pushVals] = await Promise.all([
      r.mGet(keys),
      r.mGet(pushKeys)
    ]);
    const items = [];

    for (let i = 0; i < selectedTargetIds.length; i++) {
      const targetId = String(selectedTargetIds[i] || "").trim();
      if (!targetId) continue;

      let list = [];
      try {
        list = JSON.parse(vals?.[i] || "[]");
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }

      let listDirty = false;
      list = list.map((x) => {
        if (!x || typeof x !== "object") return x;
        const normalized = backInStockProductLink(x.productHandle || "");
        if (normalized && normalized !== String(x.productHandle || "").trim()) {
          listDirty = true;
          return { ...x, productHandle: normalized };
        }
        return x;
      });

      list = list.filter(
        (x) => x && typeof x === "object" && String(x.phone || "").trim()
      );

      const pending = list.filter((x) => !x?.sent);

      let pushList = [];
      try {
        pushList = JSON.parse(pushVals?.[i] || "[]");
        if (!Array.isArray(pushList)) pushList = [];
      } catch {
        pushList = [];
      }

      let pushListDirty = false;
      pushList = pushList.map((x) => {
        if (!x || typeof x !== "object") return x;
        const normalized = backInStockProductLink(x.productHandle || "");
        if (normalized && normalized !== String(x.productHandle || "").trim()) {
          pushListDirty = true;
          return { ...x, productHandle: normalized };
        }
        return x;
      });

      if (listDirty) {
        await r.set(keys[i], JSON.stringify(list));
      }

      if (pushListDirty) {
        await r.set(pushKeys[i], JSON.stringify(pushList));
      }

      pushList = pushList.filter(
        (x) => x && typeof x === "object" && String(x.fcmToken || "").trim()
      );

      const pendingPush = pushList.filter((x) => !x?.sent);
      if (!pending.length && !pendingPush.length) continue;

      const first = pending[0] || pendingPush[0] || {};

      items.push({
        targetId,
        productId: null,
        inventoryItemId: null,
        tracked: false,
        updatedAt: null,
        productTitle: String(first.productTitle || "").trim(),
        productHandle: backInStockProductLink(first.productHandle || ""),
        image: String(
          first.productImage ||
          first.image ||
          first.imageUrl ||
          first.featuredImage ||
          ""
        ).trim(),
        availableQty: 0,
        queueCount: pending.length + pendingPush.length,
        subscribers: pending.map((x, idx) => ({
          id: `${targetId}:${String(x.phone || "").trim()}:${idx}`,
          phone: String(x.phone || "").trim(),
          countryCode: String(x.countryCode || "OM").trim().toUpperCase(),
          locale: String(x.locale || "ar").trim().toLowerCase(),
          createdAt: x.createdAt || null,
          updatedAt: x.updatedAt || null,
          sent: !!x.sent,
          sentAt: x.sentAt || null
        })),
        pushSubscribers: pendingPush.map((x, idx) => ({
          id: `${targetId}:push:${idx}`,
          type: "push",
          fcmTokenTail: String(x.fcmToken || "").trim().slice(-8),
          locale: String(x.locale || "ar").trim().toLowerCase(),
          createdAt: x.createdAt || null,
          updatedAt: x.updatedAt || null,
          sent: !!x.sent,
          sentAt: x.sentAt || null
        }))
      });
    }

    const idsToFetch = items.map((x) => x.targetId).filter(Boolean);

    if (idsToFetch.length) {
      const query = `
        query BackInStockDashboardNodes($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              title
              inventoryQuantity
              image {
                url
              }
              inventoryItem {
                id
                tracked
                updatedAt
              }
              product {
                id
                title
                handle
                featuredImage {
                  url
                }
              }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(query, { ids: idsToFetch });
      const nodes = Array.isArray(data?.nodes) ? data.nodes : [];

      const byId = new Map();
      for (const node of nodes) {
        if (!node?.id) continue;
        byId.set(String(node.id), node);
      }

      for (const item of items) {
        const node = byId.get(String(item.targetId || ""));
        if (!node) continue;

        const shopifyTitle =
          String(node?.product?.title || "").trim() ||
          String(node?.title || "").trim();

        const shopifyHandle = String(node?.product?.handle || "").trim();

        const shopifyImage = String(
          node?.image?.url ||
          node?.product?.featuredImage?.url ||
          ""
        ).trim();

        const inventoryItemId = String(node?.inventoryItem?.id || "").trim();
        const availableQty = Number(node?.inventoryQuantity || 0) || 0;
        const tracked = !!node?.inventoryItem?.tracked;
        const updatedAt = node?.inventoryItem?.updatedAt || null;
        const productId = String(node?.product?.id || "").trim();

        if (!item.productTitle || item.productTitle === item.targetId) {
          item.productTitle = shopifyTitle || item.productTitle || item.targetId;
        }

        if (!item.productHandle) {
          item.productHandle = backInStockProductLink(shopifyHandle || "");
        }

        if (!item.image) {
          item.image = shopifyImage || "";
        }

        item.productId = productId || null;
        item.inventoryItemId = inventoryItemId || null;
        item.availableQty = tracked ? availableQty : 0;
        item.tracked = tracked;
        item.updatedAt = updatedAt;
      }
    }

    items.sort((a, b) => {
      const q = Number(b.queueCount || 0) - Number(a.queueCount || 0);
      if (q !== 0) return q;

      return String(a.productTitle || "").localeCompare(
        String(b.productTitle || ""),
        "ar"
      );
    });

    return res.json({
      ok: true,
      count: items.length,
      items
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || String(e)
    });
  }
});


// ✅ مفتاح ثابت: كل الأجهزة تشوف نفس الحالة
function packStateKey() {
  return "bt:pack:bought:global";
}

// ✅ GET /api/pack/bought-state
app.get("/api/pack/bought-state", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const raw = await r.get(packStateKey());
    const map = raw ? JSON.parse(raw) : {};
    return res.json({ map });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
// ✅ GET /api/inv/all
// يرجع كل أصناف المخزون (qty > 0)
// اختياري: ?min=1  و ?limit=2000
app.get("/api/inv/all", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const min = Math.max(0, Number(req.query.min || 1) || 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 2000) || 2000, 1), 10000);

    const items = [];
    let cursor = "0";

    do {
      const out = await r.scan(cursor, { MATCH: "bt:inv:qty:*", COUNT: 200 });
      cursor = out.cursor;
      const keys = out.keys || [];
      if (!keys.length) continue;

      // اقرأ الكميات دفعة واحدة
      const qtyVals = await r.mGet(keys);

      // جهّز مفاتيح الأسماء لنفس الـ product_key
      const productKeys = keys.map(k => k.replace("bt:inv:qty:", ""));
      const nameKeys = productKeys.map(pk => invNameKey(pk));
      const nameVals = await r.mGet(nameKeys);

      for (let i = 0; i < keys.length; i++) {
        const pk = productKeys[i];
        const qty = Math.max(0, Number(qtyVals?.[i] || 0) || 0);
        if (qty < min) continue;

        const name = String(nameVals?.[i] || pk).trim();

        items.push({
          product_key: pk,
          product_name: name,
          qty
        });

        if (items.length >= limit) break;
      }

      if (items.length >= limit) break;

    } while (cursor !== "0");

    // ترتيب: الأكبر أولاً
    items.sort((a, b) => (b.qty || 0) - (a.qty || 0));

    return res.json({ count: items.length, items });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});


function normalizeBoughtEntry(e){
  if (!e || typeof e !== "object") {
    return { byOrder:{}, hist:[], sig:"" };
  }

  return {
    byOrder: e.byOrder && typeof e.byOrder === "object" ? e.byOrder : {},
    hist: Array.isArray(e.hist) ? e.hist : [],
    sig: typeof e.sig === "string" ? e.sig : ""
  };
}

function mergeBoughtEntry(oldEntry, newEntry){
  const oldE = normalizeBoughtEntry(oldEntry);
  const newE = normalizeBoughtEntry(newEntry);

  const out = {
    byOrder: { ...oldE.byOrder },
    hist: Array.isArray(oldE.hist) ? [...oldE.hist] : [],
    sig: newE.sig || oldE.sig || ""
  };

  for (const [orderId, qty] of Object.entries(newE.byOrder || {})) {
    const b = Number(qty || 0) || 0;

    // يحفظ آخر حالة للطلب نفسه: شراء أو تراجع
    out.byOrder[orderId] = Math.max(0, b);
  }

const seen = new Set();

const mergedHist = [
  ...(Array.isArray(oldE.hist) ? oldE.hist : []),
  ...(Array.isArray(newE.hist) ? newE.hist : [])
].filter((h) => {
  if (!h || typeof h !== "object") return false;

  const id = [
    h.ts || "",
    h.orderId || h.order_id || "",
    h.qty || "",
    h.type || "",
    h.product_key || ""
  ].join("|");

  if (seen.has(id)) return false;
  seen.add(id);
  return true;
});

// لا تخلي سجل كل منتج يكبر جدًا
out.hist = mergedHist.slice(-100);
  
  return out;
}



// ✅ POST /api/pack/bought-state  { map: {...} }
app.post("/api/pack/bought-state", requirePack, async (req, res) => {
  try {
    const r = await getRedis();

    if (!r) {
      return res.status(500).json({
        ok: false,
        error: "REDIS_URL غير مضبوط في ENV"
      });
    }

    const incoming = req.body?.map;

    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return res.status(400).json({
        ok: false,
        error: "map لازم يكون object"
      });
    }

    const incomingJson = JSON.stringify(incoming);

    if (incomingJson.length > 8_000_000) {
      return res.status(413).json({
        ok: false,
        error: "حجم بيانات الشراء كبير جدًا"
      });
    }

    const rawOld = await r.get(packStateKey());

    let oldMap = {};

    if (rawOld) {
      try {
        oldMap = JSON.parse(rawOld);

        if (!oldMap || typeof oldMap !== "object" || Array.isArray(oldMap)) {
          oldMap = {};
        }
      } catch {
        oldMap = {};
      }
    }

    const merged = { ...oldMap };

    for (const [key, value] of Object.entries(incoming)) {
      if (!key) continue;
      merged[key] = mergeBoughtEntry(oldMap[key], value);
    }

    await r.set(packStateKey(), JSON.stringify(merged));

    return res.json({
      ok: true,
      count: Object.keys(merged).length
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || String(e)
    });
  }
});


// ================== ✅ INVENTORY (REDIS) ==================

// مفاتيح Redis للمخزون
function invQtyKey(k)   { return `bt:inv:qty:${k}`; }
function invNameKey(k)  { return `bt:inv:name:${k}`; }
function invMovesKey(k) { return `bt:inv:moves:${k}`; }
// ================== ✅ LEDGER (MOVEMENTS) ==================
function ledgerAllKey() { return "bt:ledger:all"; }
function ledgerProdKey(k){ return `bt:ledger:prod:${k}`; }

const LEDGER_MAX = Math.min(Math.max(Number(process.env.LEDGER_MAX || 20000), 1000), 200000);
const LEDGER_PROD_MAX = Math.min(Math.max(Number(process.env.LEDGER_PROD_MAX || 2000), 200), 50000);

const LEDGER_TYPES = new Set([
  "BUY_FOR_ORDER",
  "BUY_UNDO",
  "STOCK_ADD",
  "STOCK_CONSUME",
  "STOCK_RETURN_UNDO",
  "VENDOR_BUY",
  "LOCAL_SALE"
]);

function safeStr(x){ return String(x ?? "").trim(); }
function safeQty(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const q = Math.floor(n);
  return q > 0 ? q : null;
}

async function ledgerPush(r, move){
  const id = crypto.randomUUID();
  const ts = move.ts || new Date().toISOString();

  const rec = {
    id,
    ts,
    product_key: safeStr(move.product_key),
    product_name: safeStr(move.product_name),
    type: safeStr(move.type),
    qty: Number(move.qty || 0) || 0,
    order_id: safeStr(move.order_id),
    supplier: safeStr(move.supplier),
    note: safeStr(move.note)
  };

  const json = JSON.stringify(rec);

  const multi = r.multi();
  multi.lPush(ledgerAllKey(), json);
  multi.lTrim(ledgerAllKey(), 0, LEDGER_MAX - 1);

  if (rec.product_key) {
    multi.lPush(ledgerProdKey(rec.product_key), json);
    multi.lTrim(ledgerProdKey(rec.product_key), 0, LEDGER_PROD_MAX - 1);
  }

  await multi.exec();
  return rec;
}

// Lua: خصم آمن (Atomic) — يمنع الخصم المكرر لو جهازين ضغطوا
const LUA_INV_CONSUME = `
local qtyKey = KEYS[1]
local movesKey = KEYS[2]
local want = tonumber(ARGV[1])
local orderId = ARGV[2] or ""
local now = ARGV[3] or ""

local cur = tonumber(redis.call("GET", qtyKey) or "0")
if cur < want then
  return {0, cur}
end

local after = cur - want
redis.call("SET", qtyKey, after)

if movesKey and movesKey ~= "" then
  redis.call("LPUSH", movesKey, now .. "|-" .. want .. "|consume|" .. orderId)
  redis.call("LTRIM", movesKey, 0, 199)
end

return {1, after}
`;

// ✅ GET /api/inv?keys=key1,key2
app.get("/api/inv", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const raw = (req.query.keys || "").toString().trim();
    if (!raw) return res.json({ map: {} });

    const keys = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (!keys.length) return res.json({ map: {} });

    const multi = r.multi();
    for (const k of keys) multi.get(invQtyKey(k));
    const out = await multi.exec();

    const map = {};
    keys.forEach((k, i) => {
      // node-redis v4: exec() returns array of values (not [err,val])
      const v = out?.[i];
      const n = Number(v || 0) || 0;
      map[k] = n < 0 ? 0 : n;
    });

    return res.json({ map });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ✅ POST /api/inv/add  { product_key, product_name, qty }
app.post("/api/inv/add", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const product_key  = (req.body?.product_key  || "").toString().trim();
    const product_name = (req.body?.product_name || "").toString().trim();
    const qty = Number(req.body?.qty);

    if (!product_key) return res.status(400).json({ error: "product_key مطلوب" });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "qty لازم رقم > 0" });

    const q = Math.floor(qty);
    const now = new Date().toISOString();

    const newQty = await r.incrBy(invQtyKey(product_key), q);

    if (product_name) await r.set(invNameKey(product_key), product_name);

    await r.lPush(invMovesKey(product_key), `${now}|+${q}|add|`);
    await r.lTrim(invMovesKey(product_key), 0, 199);

    await ledgerPush(r, {
      ts: now,
      product_key,
      product_name: product_name || (await r.get(invNameKey(product_key))) || product_key,
      type: "STOCK_ADD",
      qty: q,
      note: "إضافة للمخزون"
    });

    return res.json({ ok: true, product_key, qtyAfter: Number(newQty || 0) });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.get("/api/inv/local-list", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const prefix = "bt:inv:qty:";
    const keys = [];

    if (typeof r.scanIterator === "function") {
      for await (const key of r.scanIterator({
        MATCH: `${prefix}*`,
        COUNT: 200
      })) {
        keys.push(String(key));
        if (keys.length >= 5000) break;
      }
    } else if (typeof r.keys === "function") {
      const all = await r.keys(`${prefix}*`);
      keys.push(...(all || []).slice(0, 5000));
    }

    const rows = [];

    for (const fullKey of keys) {
      const variantId = String(fullKey).slice(prefix.length);
      if (!variantId) continue;

      const qty = Math.max(0, Number(await r.get(invQtyKey(variantId)) || 0) || 0);
      if (qty <= 0) continue;

      const localName = (await r.get(invNameKey(variantId))) || variantId;

      rows.push({
        variantId,
        productTitle: localName,
        variantTitle: "",
        sku: "",
        barcode: "",
        image: "",
        localQty: qty
      });
    }

    // يحاول يجيب الصورة و SKU والباركود من Shopify لو product_key هو Variant GID
    if (typeof shopifyGraphQL === "function") {
      const ids = rows
        .map((x) => x.variantId)
        .filter((x) => String(x || "").startsWith("gid://shopify/ProductVariant/"));

      const metaMap = {};

      for (let i = 0; i < ids.length; i += 80) {
        const chunk = ids.slice(i, i + 80);

        const q = `
          query($ids:[ID!]!) {
            nodes(ids:$ids) {
              ... on ProductVariant {
                id
                title
                sku
                barcode
                image { url }
                product {
                  title
                  featuredImage { url }
                }
              }
            }
          }
        `;

        try {
          const d = await shopifyGraphQL(q, { ids: chunk });
          const nodes = Array.isArray(d?.nodes) ? d.nodes : [];

          for (const v of nodes) {
            if (!v?.id) continue;

            metaMap[v.id] = {
              productTitle: v.product?.title || "",
              variantTitle: v.title && v.title !== "Default Title" ? v.title : "",
              sku: v.sku || "",
              barcode: v.barcode || "",
              image: v.image?.url || v.product?.featuredImage?.url || ""
            };
          }
        } catch (e) {
          console.warn("local inventory Shopify enrich failed", e?.message || e);
        }
      }

      for (const row of rows) {
        const meta = metaMap[row.variantId];
        if (!meta) continue;

        row.productTitle = meta.productTitle || row.productTitle;
        row.variantTitle = meta.variantTitle || "";
        row.sku = meta.sku || "";
        row.barcode = meta.barcode || "";
        row.image = meta.image || "";
      }
    }

    rows.sort((a, b) => {
      const q = Number(b.localQty || 0) - Number(a.localQty || 0);
      if (q !== 0) return q;
      return String(a.productTitle || "").localeCompare(String(b.productTitle || ""), "ar");
    });

    return res.json({
      ok: true,
      count: rows.length,
      items: rows
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});


app.post("/api/inv/return-undo", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const product_key = safeStr(req.body?.product_key);
    const product_name = safeStr(req.body?.product_name);
    const image = safeStr(req.body?.image);
    const order_id = safeStr(req.body?.order_id);

    const qty = Math.floor(Number(req.body?.qty || 0));

    if (!product_key) {
      return res.status(400).json({ error: "product_key مطلوب" });
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: "qty لازم رقم أكبر من 0" });
    }

    const now = new Date().toISOString();

    const newQty = await r.incrBy(invQtyKey(product_key), qty);

    if (product_name) {
      await r.set(invNameKey(product_key), product_name);
    }

    await r.lPush(invMovesKey(product_key), `${now}|+${qty}|undo_stock_consume|${order_id}`);
    await r.lTrim(invMovesKey(product_key), 0, 199);

    if (typeof ledgerPush === "function") {
      await ledgerPush(r, {
        ts: now,
        product_key,
        product_name,
        image,
        type: "STOCK_RETURN_UNDO",
        qty,
        order_id,
        note: "تراجع صرف من المخزون - رجعت القطعة للمخزون المحلي"
      });
    }

    return res.json({
      ok: true,
      product_key,
      qtyAfter: Number(newQty || 0)
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

// ✅ POST /api/inv/consume  { product_key, qty, order_id? }
app.post("/api/inv/consume", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const product_key = (req.body?.product_key || "").toString().trim();
    const qty = Number(req.body?.qty);
    const order_id = (req.body?.order_id || "").toString().trim() || "";

    if (!product_key) return res.status(400).json({ error: "product_key مطلوب" });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "qty لازم رقم > 0" });

    const q = Math.floor(qty);
    const now = new Date().toISOString();

    const result = await r.eval(LUA_INV_CONSUME, {
      keys: [invQtyKey(product_key), invMovesKey(product_key)],
      arguments: [String(q), order_id, now],
    });

    const ok = Array.isArray(result) ? Number(result[0]) : 0;
    const num = Array.isArray(result) ? Number(result[1]) : 0;

    if (!ok) {
      return res.status(400).json({ error: "المخزون غير كافي", available: num });
    }
// ✅ Ledger
await ledgerPush(r, {
  ts: now,
  product_key,
  product_name: (await r.get(invNameKey(product_key))) || product_key,
  type: "STOCK_CONSUME",
  qty: q,
  order_id,
  note: order_id ? "خصم مخزون على طلب" : "خصم مخزون"
});

    return res.json({ ok: true, product_key, qtyAfter: num });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
app.use("/api/pack", requirePack);
app.use("/api/print", requirePack);
app.use("/api/export", requirePack);


const PRODUCTS_STAFF_KEY = String(process.env.PRODUCTS_STAFF_KEY || "").trim();

function requireProductsStaff(req, res, next) {
  const key = String(req.headers["x-products-staff-key"] || "").trim();
  if (!PRODUCTS_STAFF_KEY) return res.status(500).json({ error: "PRODUCTS_STAFF_KEY غير مضبوط في ENV" });
  if (key !== PRODUCTS_STAFF_KEY) return res.status(401).json({ error: "غير مصرح" });
  next();
}

// ================== ADMIN PASSWORD ==================
const ADMIN_KEY = String(process.env.ADMIN_KEY || "").trim();

function requireAdmin(req, res, next) {
  const key = String(req.headers["x-admin-key"] || "").trim();
  if (!ADMIN_KEY) return res.status(500).json({ error: "ADMIN_KEY غير مضبوط في ENV" });
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "غير مصرح" });
  next();
}


app.use("/api/products", productsQueueRouter({
  getRedis,
  requireProductsStaff,
  requireAdmin,
  uploadsPublicDir: "public/uploads/products",

  WEB_PUSH_PUBLIC_KEY: process.env.WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY: process.env.WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_SUBJECT: process.env.WEB_PUSH_SUBJECT,
  PUSH_AUTH_TOKEN: process.env.PUSH_AUTH_TOKEN
}));
// ================== DRIVER PASSWORD ==================
const DRIVER_KEY = String(process.env.DRIVER_KEY || "").trim();

function requireDriver(req, res, next) {
  const key = String(req.headers["x-driver-key"] || "").trim();
  if (!DRIVER_KEY) return res.status(500).json({ error: "DRIVER_KEY غير مضبوط في ENV" });
  if (key !== DRIVER_KEY) return res.status(401).json({ error: "غير مصرح" });
  next();
}
app.use("/api/driver", requireDriver);
app.post("/api/driver/shipment-photo", shipmentUpload.single("photo"), async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const orderCode = String(req.body?.orderCode || "").replace("#", "").trim();
    if (!orderCode) {
      return res.status(400).json({ error: "orderCode مطلوب" });
    }

    if (!req.file?.buffer) {
      return res.status(400).json({ error: "الصوره مطلوبه" });
    }

    const up = await uploadToCloudinary(req.file.buffer, "bt/shipment-photos");

    await r.hSet(shipmentPhotoKey(orderCode), {
      url: up.url || "",
      publicId: up.publicId || "",
      updatedAt: new Date().toISOString()
    });

    return res.json({
      ok: true,
      shipmentPhotoUrl: up.url || ""
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/driver/shipment-photo-from-label", async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const input = String(req.body?.orderCode || "").replace("#", "").trim();
    if (!input) {
      return res.status(400).json({ error: "orderCode مطلوب" });
    }

const q =
  `(order_number:${input} OR name:${input} OR name:#${input}) ` +
  `AND (tag:مسقط OR tag:مكتب)`;

    
    const query = `
      query ($q: String!) {
        orders(first: 1, query: $q) {
          nodes {
            id
            name
            note
            tags
            createdAt
            shippingLines(first: 10) {
              nodes {
                title
              }
            }
            displayFinancialStatus
            transactions {
              gateway
            }
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
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { q });
    const order = data?.orders?.nodes?.[0];

    if (!order) {
      return res.status(404).json({ error: "الطلب غير موجود" });
    }

    const shipping = order.shippingAddress || {};
    const customer = order.customer || {};

    const customerName =
      (shipping.name || "").trim() ||
      [shipping.firstName || "", shipping.lastName || ""].join(" ").trim() ||
      [customer.firstName || "", customer.lastName || ""].join(" ").trim() ||
      "غير موجود";

    const customerPhone =
      (shipping.phone || "").trim() ||
      (customer.phone || "").trim() ||
      "";

    const addressLine = [
      shipping.address1 || "",
      shipping.address2 || ""
    ].filter(Boolean).join(" - ").trim();

    const shippingMethod =
      order?.shippingLines?.nodes?.map(x => x?.title || "").filter(Boolean).join(" | ") || "";

    const labelOrder = {
      name: order.name || "",
      note: order.note || "",
      tags: order.tags || [],
      createdAt: order.createdAt || "",
      displayFinancialStatus: order.displayFinancialStatus || "",
      transactions: order.transactions || [],
      amountDue: Number(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0,
      total_outstanding: Number(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0,
      customer: customerName,
      phone: customerPhone,
      shipping: [addressLine, shipping.city || ""].filter(Boolean).join(", "),
      shipping_method: shippingMethod,
      shippingAddress: shipping,
      customerObj: customer
    };

    const html = renderShipmentLabelHtml(labelOrder);
    const buffer = await labelHtmlToPngBuffer(html);

    const up = await uploadToCloudinary(buffer, "bt/shipment-photos");

    await r.hSet(shipmentPhotoKey(input), {
      url: up.url || "",
      publicId: up.publicId || "",
      updatedAt: new Date().toISOString()
    });

    return res.json({
      ok: true,
      shipmentPhotoUrl: up.url || "",
      orderCode: input
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ✅ DRIVER PING
app.get("/api/driver/ping", (req, res) => res.json({ ok: true }));
// ✅ حماية المسارات القديمة أيضاً (توافق مع الفرونت الحالي)
app.use("/api/order", requireDriver);
app.use("/api/status", requireDriver);
app.use("/api/note", requireDriver);
app.use("/api/tag", requireDriver);

// ===== Admin Orders (طلبات جاهزة للتسوية) =====
app.get("/api/admin/orders", async (req, res) => {
  try {
    const REQUIRED_TAG = process.env.REQUIRED_TAG || "تم";
    const EXCLUDE_TAG  = process.env.EXCLUDE_TAG  || "مرحل";
    const START_DATE   = process.env.START_DATE   || "2026-01-24";
    const DELIVERY_FEE = Number(process.env.DELIVERY_FEE || "2");
    const API_VERSION  = process.env.SHOPIFY_API_VERSION || "2024-10";

    const qSearch = (req.query.q || "").toString().trim();
    const date    = (req.query.date || "").toString().trim();

    let query = `tag:"${REQUIRED_TAG}" -tag:"${EXCLUDE_TAG}" created_at:>=${START_DATE} status:any`;

    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const next = addOneDay(date);
      query += ` AND created_at:>=${date} AND created_at:<${next}`;
    }

    if (qSearch) {
      const clean = qSearch.replace("#", "").trim();
      query += ` AND (name:${clean} OR order_number:${clean} OR email:${clean})`;
    }

    let url =
      `https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/orders.json` +
      `?limit=250&status=any` +
      `&fields=id,name,tags,financial_status,total_price,total_outstanding,email` +
      `&query=${encodeURIComponent(query)}`;

    const orders = [];

    while (url) {
      const r = await fetch(url, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN }
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Shopify ${r.status}: ${t}`);
      }

      const data = await r.json();
      (data.orders || []).forEach(o => orders.push(o));
      url = getNextLink(r.headers.get("link"));
    }

    const rows = orders.map(o => {
      let outstandingRaw = parseFloat(o.total_outstanding || 0);
      if (isNaN(outstandingRaw)) outstandingRaw = 0;

      const total = parseFloat(o.total_price || 0) || 0;
      const fee = DELIVERY_FEE;
      const remaining = outstandingRaw - fee;

      return {
        orderName: o.name || "",
        status: translateStatus(o.financial_status),
        total,
        fee,
        outstanding: remaining,
        net: remaining,
        orderId: String(o.id || "")
      };
    });

    return res.json({ count: rows.length, orders: rows, debugQuery: query });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ===== Admin: ترحيل الدفعة =====
app.post("/api/admin/settle", async (req, res) => {
  try {
    const REQUIRED_TAG = process.env.REQUIRED_TAG || "تم";
    const EXCLUDE_TAG  = process.env.EXCLUDE_TAG  || "مرحل";
    const START_DATE   = process.env.START_DATE   || "2026-01-01";
    const API_VERSION  = process.env.SHOPIFY_API_VERSION || "2024-10";

    const date    = (req.query.date || "").toString().trim();
    const qSearch = (req.query.q || "").toString().trim();

    let query = `tag:"${REQUIRED_TAG}" -tag:"${EXCLUDE_TAG}" created_at:>=${START_DATE} status:any`;

    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const next = addOneDay(date);
      query += ` AND created_at:>=${date} AND created_at:<${next}`;
    }

    if (qSearch) {
      const clean = qSearch.replace("#", "").trim();
      query += ` AND (name:${clean} OR order_number:${clean} OR email:${clean})`;
    }

    let url =
      `https://${SHOPIFY_SHOP}/admin/api/${API_VERSION}/orders.json` +
      `?limit=250&status=any` +
      `&fields=id,name,tags` +
      `&query=${encodeURIComponent(query)}`;

    const orders = [];
    while (url) {
      const r = await fetch(url, {
        headers: { "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN }
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Shopify ${r.status}: ${t}`);
      }

      const data = await r.json();
      (data.orders || []).forEach(o => orders.push(o));
      url = getNextLink(r.headers.get("link"));
    }

    if (!orders.length) {
      return res.json({
        success: true,
        matchedCount: 0,
        archivedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        debugQuery: query
      });
    }

    let archivedCount = 0;
    let skippedCount = 0;
    const failed = [];

    for (const o of orders) {
      const numericId = String(o.id || "");
      const tagsStr = (o.tags || "").trim();
      const tagsArr = tagsStr
        ? tagsStr.split(",").map(s => s.trim()).filter(Boolean)
        : [];

      if (tagsArr.includes(EXCLUDE_TAG)) {
        skippedCount++;
        continue;
      }

      const gid = `gid://shopify/Order/${numericId}`;

      try {
        await addTag(gid, EXCLUDE_TAG);
        archivedCount++;
      } catch (e) {
        failed.push({ id: numericId, name: o.name, error: e.message || String(e) });
      }
    }

    return res.json({
      success: true,
      matchedCount: orders.length,
      archivedCount,
      skippedCount,
      failedCount: failed.length,
      failed: failed.slice(0, 20),
      debugQuery: query
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ===== Admin: Muscat OUT_FOR_DELIVERY =====
app.get("/api/admin/out", async (req, res) => {
  try {
    const q = `tag:مسقط AND fulfillment_status:fulfilled`;

    const query = `
      query ($q: String!) {
        orders(first: 250, query: $q, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            name
            note
            displayFinancialStatus
            totalOutstandingSet { shopMoney { amount } }
            fulfillments(first: 5) {
              id
              createdAt
              events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
                nodes { status happenedAt }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { q });
    const nodes = data.orders?.nodes || [];

    const out = [];
    for (const o of nodes) {
      const f = o.fulfillments?.[0];
      const last = f?.events?.nodes?.[0];
      const lastEvent = (last?.status || "").trim().toUpperCase();

      if (lastEvent === "OUT_FOR_DELIVERY") {
        const outstanding = Number(o?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;

        out.push({
          orderName: o.name || "",
          note: (o.note || "").trim(),
          outAt: last?.happenedAt || null,
          financial: o.displayFinancialStatus || "",
          outstanding
        });
      }
    }

    return res.json({ count: out.length, orders: out });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ===== Admin: shipped-no-tracking =====
app.get("/api/admin/shipped-no-tracking", async (req, res) => {
  try {
    const EXCLUDE_TAG = process.env.EXCLUDE_TAG || "مرحل";
    const WAIT_TAG    = process.env.WAIT_TAG || "انتظار";
    const START_DATE  = "2026-01-22";

    const qNew = `tag:مسقط -tag:${EXCLUDE_TAG} AND fulfillment_status:fulfilled AND created_at:>=${START_DATE}`;
    const qOldWait = `tag:مسقط tag:${WAIT_TAG} -tag:${EXCLUDE_TAG} AND fulfillment_status:fulfilled AND created_at:<${START_DATE}`;

    const query = `
      query ($q: String!) {
        orders(first: 250, query: $q, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            name
            note
            displayFinancialStatus
            totalOutstandingSet { shopMoney { amount } }
            fulfillments(first: 5) {
              id
              createdAt
              trackingInfo { number company url }
              events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
                nodes { status happenedAt }
              }
            }
          }
        }
      }
    `;

    const [d1, d2] = await Promise.all([
      shopifyGraphQL(query, { q: qNew }),
      shopifyGraphQL(query, { q: qOldWait })
    ]);

    const nodes = [
      ...(d1?.orders?.nodes || []),
      ...(d2?.orders?.nodes || [])
    ];

    const byId = new Map();
    for (const o of nodes) byId.set(String(o.id), o);
    const uniq = Array.from(byId.values());

    const out = [];
    for (const o of uniq) {
      const f = o.fulfillments?.[0];
      if (!f) continue;

      const lastEvent = (f?.events?.nodes?.[0]?.status || "").trim().toUpperCase();
      if (lastEvent === "DELIVERED" || lastEvent === "OUT_FOR_DELIVERY") continue;

const t0 = Array.isArray(f?.trackingInfo)
  ? f.trackingInfo.find(x => String(x?.number || "").trim())
  : null;

const trackingNumber = String(t0?.number || "").trim();

const outstanding = Number(o?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;

out.push({
  orderName: o.name || "",
  note: (o.note || "").trim(),
  lastEvent,
  handedAt: f?.createdAt || null,
  financial: o.displayFinancialStatus || "",
  outstanding,

  // ✅ معلومات التتبع اختيارية، لكنها لا تمنع احتساب الطلب
  trackingNumber,
  trackingCompany: String(t0?.company || "").trim(),
  trackingUrl: String(t0?.url || "").trim(),
  hasTracking: Boolean(trackingNumber)
});
    }

    return res.json({ count: out.length, orders: out, debugQuery: { qNew, qOldWait } });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ===== Driver Dashboard =====
app.get("/api/driver/dashboard", async (req, res) => {
  try {
    const DELIVERY_FEE = Number(process.env.DELIVERY_FEE || "2");
    const EXCLUDE_TAG  = process.env.EXCLUDE_TAG || "مرحل";
    const WAIT_TAG     = process.env.WAIT_TAG || "انتظار";
    const START_DATE   = process.env.DRIVER_START_DATE || "2026-01-22";

    // ✅ فقط لطلبات مسقط غير المشحونة من تاريخ 2026-04-10
    const MUSCAT_PENDING_START_DATE = "2026-03-10";

    // ✅ طلبات مسقط غير المشحونة
    const qMuscatPending =
  `tag:مسقط -tag:${EXCLUDE_TAG} AND fulfillment_status:unfulfilled AND created_at:>=${MUSCAT_PENDING_START_DATE} status:open`;

    // ✅ الطلبات المشحونة الخاصة بالمندوب
    const qNew =
      `tag:مسقط -tag:${EXCLUDE_TAG} AND fulfillment_status:fulfilled AND created_at:>=${START_DATE}`;

    const qOldWait =
      `tag:مسقط tag:${WAIT_TAG} -tag:${EXCLUDE_TAG} AND fulfillment_status:fulfilled AND created_at:<${START_DATE}`;

    const query = `
      query ($q: String!) {
        orders(first: 100, query: $q, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id
            name
            tags
            displayFinancialStatus

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

            fulfillments(first: 10) {
              id
              createdAt
              trackingInfo {
                number
                company
                url
              }
              events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
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

    const [dMuscatPending, d1, d2] = await Promise.all([
      shopifyGraphQL(query, { q: qMuscatPending }),
      shopifyGraphQL(query, { q: qNew }),
      shopifyGraphQL(query, { q: qOldWait })
    ]);

    const pendingNodes = dMuscatPending?.orders?.nodes || [];
    const shippedNodes = [
      ...(d1?.orders?.nodes || []),
      ...(d2?.orders?.nodes || [])
    ];

    const byPendingId = new Map();
    for (const o of pendingNodes) {
      byPendingId.set(String(o.id), o);
    }
    const uniqPending = Array.from(byPendingId.values());

    const byShippedId = new Map();
    for (const o of shippedNodes) {
      byShippedId.set(String(o.id), o);
    }
    const uniq = Array.from(byShippedId.values());

    function pickLatestFulfillment(fulfillments = []) {
      let best = null;
      let bestTs = -1;

      for (const f of (fulfillments || [])) {
        const ev = f?.events?.nodes?.[0];
        const tsStr = ev?.happenedAt || f?.createdAt || null;
        const ts = tsStr ? Date.parse(tsStr) : -1;

        if (ts > bestTs) {
          bestTs = ts;
          best = f;
        }
      }

      return best;
    }

    function getLastEventUpper(f) {
      return (f?.events?.nodes?.[0]?.status || "")
        .toString()
        .trim()
        .toUpperCase();
    }

function getTrackingInfo(f) {
  const arr = Array.isArray(f?.trackingInfo) ? f.trackingInfo : [];
  const t = arr.find(x => String(x?.number || "").trim()) || null;

  return {
    trackingNumber: String(t?.number || "").trim(),
    trackingCompany: String(t?.company || "").trim(),
    trackingUrl: String(t?.url || "").trim()
  };
}
    
    function buildRow(o) {
      const orderName = (o.name || "").toString();
      const code = orderName.replace("#", "").trim();

      const outstanding = Number(o?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
      const currency = (o?.totalOutstandingSet?.shopMoney?.currencyCode || "OMR").toString();
      const financial = (o.displayFinancialStatus || "").toString();

      const shipping = o.shippingAddress || {};
      const customer = o.customer || {};

      const customerName =
        (shipping.name || "").trim() ||
        [shipping.firstName || "", shipping.lastName || ""].join(" ").trim() ||
        [customer.firstName || "", customer.lastName || ""].join(" ").trim() ||
        "غير موجود";

      const customerPhone =
        (shipping.phone || "").toString().trim() ||
        (customer.phone || "").toString().trim() ||
        "";

      const addressLine = [
        shipping.address1 || "",
        shipping.address2 || ""
      ].filter(Boolean).join(" - ").trim();

      const cityName = (shipping.city || "").toString().trim();
      const shipCountry = (shipping.countryCodeV2 || "").toString().trim();

      return {
        orderId: o.id,
        orderName,
        code,
        tags: o.tags || [],
        outstanding,
        currency,
        financial,
        customerName,
        customerPhone,
        phone: customerPhone,
        addressLine,
        cityName,
        shipCountry
      };
    }

    const muscatPending = [];
    const waiting = [];
    const out = [];
    const done = [];
    let totalToAdmin = 0;

    // ✅ طلبات مسقط غير المشحونة
    for (const o of uniqPending) {
      muscatPending.push(buildRow(o));
    }

    // ✅ الطلبات المشحونة الحالية
    for (const o of uniq) {
      const f = pickLatestFulfillment(o.fulfillments || []);
      if (!f) continue;

const lastEvent = getLastEventUpper(f);
const trackingInfo = getTrackingInfo(f);

const row = {
  ...buildRow(o),
  ...trackingInfo,
  hasTracking: Boolean(trackingInfo.trackingNumber)
};

if (lastEvent === "OUT_FOR_DELIVERY") {
  out.push(row);
  continue;
}

if (lastEvent === "DELIVERED") {
  done.push(row);
  totalToAdmin += (row.outstanding - DELIVERY_FEE);
  continue;
}

// ✅ أي طلب مشحون ولم يخرج/ينتهي يدخل في بانتظار التوصيل
// سواء فيه رقم تتبع أو بدون رقم تتبع
waiting.push(row);
    }

    // ✅ لا تدخل الطلبات غير المشحونة في الإحصائيات العليا
    const all = [...waiting, ...out, ...done];
    const totalOrders = all.length;
    const paidCount = all.filter(x => Number(x.outstanding || 0) <= 0).length;
    const unpaidCount = totalOrders - paidCount;

    return res.json({
      summary: {
        totalOrders,
        paidCount,
        unpaidCount,
        totalToAdmin,
        fee: DELIVERY_FEE
      },
      lists: {
        muscatPending,
        waiting,
        out,
        done
      },
      debugQuery: {
        START_DATE,
        MUSCAT_PENDING_START_DATE,
        qMuscatPending,
        qNew,
        qOldWait
      }
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || String(e)
    });
  }
});

// ================== HELPERS ==================
function addOneDay(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function getNextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

function translateStatus(s) {
  if (s === "paid") return "مدفوع";
  if (s === "pending") return "غير مدفوع";
  if (s === "partially_paid") return "مدفوع جزئي";
  if (s === "authorized") return "مفوض";
  if (s === "refunded") return "مسترجع";
  if (s === "voided") return "ملغي";
  return s || "";
}

// ================== ✅ REPORTS ROUTES (ADD HERE BEFORE FALLBACK) ==================
function normalizeTags(raw) {
  return String(raw || "مسقط,تاكيد,مكتب")
    .split(",")
    .map(t => t.trim())
    .filter(Boolean);
}

// ✅ تقرير المنتجات المجمّعة من الطلبات غير المشحونة
// GET /api/reports/unshipped-products?tags=مسقط,تاكيد,مكتب&limit=50
app.get("/api/reports/unshipped-products", async (req, res) => {
  try {
    const tags = normalizeTags(req.query.tags);
    const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 250);

    const START_DATE = process.env.START_DATE || "2026-01-25";
    const tagQuery = tags.map(t => `tag:"${t}"`).join(" OR ");

    // tags OR + unfulfilled + from date + open
    const q = `(${tagQuery}) AND fulfillment_status:unfulfilled AND created_at:>=${START_DATE} status:open`;

    // ✅ أضفنا variant { id } عشان نستخدمه كمفتاح ثابت للدمج
    const query = `
      query ($q: String!, $n: Int!) {
        orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            name
            email
            createdAt
            tags
            lineItems(first: 100) {
              nodes {
                title
                quantity
                currentQuantity
                variant {
                  id
                  image { url altText }
                  product { featuredImage { url altText } }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { q, n: limit });
    const orders = data?.orders?.nodes || [];

    // ✅ تجميع المنتجات بمفتاح ثابت: variant.id
    const map = new Map();

    for (const o of orders) {
      const orderName = (o?.name || "").toString().trim(); // مثل #1234
      const items = o?.lineItems?.nodes || [];

      for (const li of items) {
        const title = (li?.title || "").toString().trim();
        if (!title) continue;

        const qty = Number(li?.currentQuantity ?? li?.quantity ?? 0) || 0;
        if (qty <= 0) continue;

        const variantId = (li?.variant?.id || "").toString().trim();

        const img =
          li?.variant?.image?.url ||
          li?.variant?.product?.featuredImage?.url ||
          "";

        // ✅ مفتاح الدمج: variantId (إن وجد) وإلا fallback للعنوان
        const key = variantId || title;

        if (!map.has(key)) {
          map.set(key, {
            name: title,            // اسم العرض
            invKey: variantId || "",// ✅ ID ثابت للفرونت (يساعد الدمج بين عربي/إنجليزي)
            quantity: 0,
            image: img,
            sources: []             // {order, qty, variantId}
          });
        }

        const row = map.get(key);

        // ✅ إذا كان الاسم الحالي "أفضل" (اختياري) — نخليه كما هو
        // إذا تبغى تثبيت اسم أول واحد فقط احذف الشرط هذا
        if (!row.name && title) row.name = title;

        row.quantity += qty;
        if (!row.image && img) row.image = img;

        // ✅ دمج داخل نفس الطلب + نفس الـ variant
        const found = row.sources.find(x =>
          x.order === orderName && String(x.variantId || "") === String(variantId || "")
        );

        if (found) {
          found.qty += qty;
        } else {
          row.sources.push({
            order: orderName,
            qty,
            variantId: variantId || ""
          });
        }
      }
    }

    const products = Array.from(map.values()).sort(
      (a, b) => (Number(b.quantity || 0) - Number(a.quantity || 0))
    );

    return res.json({
      tags,
      startDate: START_DATE,
      ordersCount: orders.length,
      productsCount: products.length,
      products,
      debugQuery: q
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});
// ✅ عرض الطلبات غير المشحونة (بدون تجميع منتجات)
// GET /api/reports/unshipped-orders?tags=مسقط,تاكيد,مكتب&limit=50
// ✅ تقرير: الطلبات حسب التاقات + Pagination
// GET /api/reports/unshipped-orders?tags=مسقط,تاكيد,مكتب&limit=1000&mode=incomplete&from=2026-01-01
app.get("/api/reports/unshipped-orders", async (req, res) => {
  try {
    const tags = normalizeTags(req.query.tags);
    const limitTotal = Math.min(Math.max(Number(req.query.limit || 300), 1), 2000); // نجمع عبر صفحات
    const mode = String(req.query.mode || "incomplete").trim().toLowerCase(); // incomplete | unfulfilled
    const FROM = String(req.query.from || "").trim(); // اختياري

    const tagQuery = tags.length ? tags.map(t => `tag:"${t}"`).join(" OR ") : null;

    // لا تحط status:open هنا عشان ما تخفي الطلبات القديمة (closed/archived)
    const qParts = [];
    if (tagQuery) qParts.push(`(${tagQuery})`);
    if (FROM) qParts.push(`created_at:>=${FROM}`);
    const q = qParts.join(" AND ") || "";

    const query = `
      query ($q: String!, $n: Int!, $after: String) {
        orders(first: $n, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            name
            tags
            createdAt
            updatedAt
            displayFulfillmentStatus
            fulfillments(first: 10) {
              id
              status
              createdAt
              events(first: 1, sortKey: HAPPENED_AT, reverse: true) {
                nodes { status happenedAt }
              }
            }
          }
        }
      }
    `;

    let after = null;
    let fetched = 0;
    let kept = [];

    // نجيب صفحات لين نوصل limitTotal أو تخلص النتائج
    while (kept.length < limitTotal) {
      const pageSize = Math.min(250, limitTotal - kept.length);
      const data = await shopifyGraphQL(query, { q, n: pageSize, after });
      const chunk = data?.orders?.nodes || [];
      const pi = data?.orders?.pageInfo;

      fetched += chunk.length;

      for (const o of chunk) {
        const f = (o.fulfillments || [])[0];
        const last = f?.events?.nodes?.[0] || null;
        const lastEvent = String(last?.status || "").trim().toUpperCase();
        const disp = String(o.displayFulfillmentStatus || "").trim().toUpperCase();

        // mode=unfulfilled: فقط غير مشحون/جزئي
        if (mode === "unfulfilled") {
          if (!(disp === "UNFULFILLED" || disp === "PARTIALLY_FULFILLED")) continue;
        } else {
          // mode=incomplete: استبعد المسلّم/خرج للتوصيل
          if (lastEvent === "OUT_FOR_DELIVERY" || lastEvent === "DELIVERED") continue;
        }

        kept.push({
          orderId: o.id,
          orderName: o.name,
          tags: o.tags || [],
          createdAt: o.createdAt || null,
          updatedAt: o.updatedAt || null,
          displayFulfillmentStatus: disp || null,
          lastEvent: lastEvent || null,
          happenedAt: last?.happenedAt || null
        });

        if (kept.length >= limitTotal) break;
      }

      if (!pi?.hasNextPage) break;
      after = pi.endCursor;
      if (!after) break;
    }

    return res.json({
      tags,
      mode,
      from: FROM || null,
      fetchedFromShopify: fetched,
      ordersCount: kept.length,
      orders: kept,
      debugQuery: q
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
// ================== ✅ PACKING ROUTES (INDEPENDENT) ==================

app.get("/api/pack/orders", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 120), 1), 250);

    const START_DATE = (req.query.from || "").toString().trim()
      || (process.env.START_DATE || "2026-01-24");

    const q =
      `(tag:"مسقط" OR tag:"مكتب" OR tag:"تاكيد" OR tag:"تأكيد") ` +
      `AND -tag:"مغلف" AND fulfillment_status:unfulfilled AND created_at:>=${START_DATE} status:open`;

    const query = `
      query ($q: String!, $n: Int!) {
        orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id
            name
            email
            createdAt
            tags
            displayFinancialStatus
            totalOutstandingSet {
              shopMoney { amount currencyCode }
            }

            customer {
              firstName
              lastName
              phone
              email
              tags
            }

            shippingAddress {
              address1
              city
              phone
            }

            shippingLines(first: 10) {
              nodes {
                title
                code
                carrierIdentifier
                source
              }
            }

            lineItems(first: 100) {
              nodes {
                title
                quantity
                currentQuantity
                variant {
                  id
                  barcode
                  image { url altText }
                  product { featuredImage { url altText } }
                }
              }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { q, n: limit });
    const nodes = data?.orders?.nodes || [];

    const orders = nodes.map(o => {
      const customerName = [
        o?.customer?.firstName || "",
        o?.customer?.lastName || ""
      ].join(" ").trim();

      const phone =
        (o?.shippingAddress?.phone || "").toString().trim() ||
        (o?.customer?.phone || "").toString().trim();

      const a1 = (o?.shippingAddress?.address1 || "").toString().trim();
      const city = (o?.shippingAddress?.city || "").toString().trim();
      const shipping = [a1, city].filter(Boolean).join(" - ");
      const shippingLines = (o?.shippingLines?.nodes || []).map(s => ({
        title: (s?.title || "").toString().trim(),
        code: (s?.code || "").toString().trim(),
        carrier_identifier: (s?.carrierIdentifier || "").toString().trim(),
        source: (s?.source || "").toString().trim()
      }));

      const items = (o?.lineItems?.nodes || []).map(li => {
        const img =
          li?.variant?.image?.url ||
          li?.variant?.product?.featuredImage?.url ||
          "";

        const barcode = (li?.variant?.barcode || "").toString().trim();

        return {
          name: (li?.title || "").toString().trim(),
          // ✅ currentQuantity = الكمية الحالية بعد الحذف/التعديل
          qty: Number(li?.currentQuantity ?? li?.quantity ?? 0) || 0,
          image: img,
          barcode,
          variantId: li?.variant?.id || null
        };
      }).filter(x => x.name && x.qty > 0);

      return {
        id: o.id,
        name: o.name || "",
        createdAt: o.createdAt || null,
        tags: o.tags || [],
        financial_status: o.displayFinancialStatus || "",
        total_outstanding: Number(o?.totalOutstandingSet?.shopMoney?.amount || 0) || 0,
        customer_tags: Array.isArray(o?.customer?.tags) ? o.customer.tags : [],
        customer: customerName,
        phone,
        email: (o?.email || o?.customer?.email || "").toString().trim(),
        shipping,
        shipping_lines: shippingLines,
        items
      };
    });

    return res.json({
      startDate: START_DATE,
      count: orders.length,
      orders,
      debugQuery: q
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
// ================== ✅ PACK: SHIP ORDER (FULFILLMENT) ==================
// POST /api/pack/ship
// body: { orderId, trackingNumber, trackingCompany, trackingUrl, notifyCustomer }
// orderId لازم يكون GID مثل: gid://shopify/Order/...
app.get("/api/pack/customer-blacklist", async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    const query = `
      query ($id: ID!) {
        order(id: $id) {
          id
          displayFinancialStatus
          totalOutstandingSet {
            shopMoney { amount }
          }
          customer {
            tags
          }
        }
      }
    `;

    const data = await shopifyGraphQL(query, { id: orderId });
    const order = data?.order || {};
    const tags = Array.isArray(order?.customer?.tags) ? order.customer.tags : [];
    const low = tags.map(t => String(t || "").trim().toLowerCase());
    const outstanding = Number(order?.totalOutstandingSet?.shopMoney?.amount || 0) || 0;
    const financial = String(order?.displayFinancialStatus || "").trim().toLowerCase();

    return res.json({
      blacklisted: low.includes("blacklist"),
      unpaid: outstanding > 0 || (!!financial && financial !== "paid"),
      customer_tags: tags,
      financial_status: order?.displayFinancialStatus || "",
      total_outstanding: outstanding
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

app.post("/api/pack/ship", async (req, res) => {
  try {
    const { orderId, trackingNumber, trackingCompany, trackingUrl, notifyCustomer } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId مطلوب" });

    const tn = (trackingNumber || "").toString().trim();
    const tc = (trackingCompany || "").toString().trim();
    const notify = !!notifyCustomer;

    // ✅ رابط التتبع لصفحتك
const finalTrackingUrl = (trackingUrl || "").toString().trim() || (
  tn ? `https://halabt.com/track?bt=${encodeURIComponent(tn)}` : ""
);
    // ======================
    // Helpers
    // ======================
    const norm = (s) => String(s || "").toUpperCase().trim();

    // ✅ Shopify: الحقل الصحيح هو remainingQuantity
    const hasRemaining = (fo) =>
      (fo.lineItems?.nodes || []).some((li) => Number(li.remainingQuantity || 0) > 0);

    // ======================
    // Queries / Mutations
    // ======================
    const Q_ORDER_FOS = `
      query ($id: ID!) {
        order(id: $id) {
          id
          name
          fulfillmentOrders(first: 50) {
            nodes {
              id
              status
              requestStatus
              assignedLocation { name }
              lineItems(first: 250) {
                nodes {
                  id
                  remainingQuantity
                  totalQuantity
                }
              }
            }
          }
        }
      }
    `;

    const M_OPEN_FO = `
      mutation ($id: ID!) {
        fulfillmentOrderOpen(id: $id) {
          fulfillmentOrder { id status }
          userErrors { field message }
        }
      }
    `;

    const M_CREATE_FULFILLMENT = `
      mutation ($fulfillment: FulfillmentInput!) {
        fulfillmentCreate(fulfillment: $fulfillment) {
          fulfillment {
            id
            status
            trackingInfo {
              number
              company
              url
            }
          }
          userErrors { field message }
        }
      }
    `;

    // ======================
    // 1) Fetch order + fulfillment orders
    // ======================
    const d1 = await shopifyGraphQL(Q_ORDER_FOS, { id: orderId });
    const order = d1?.order;
    if (!order) return res.status(404).json({ error: "الطلب غير موجود" });

    let fosAll = order.fulfillmentOrders?.nodes || [];

    // ======================
    // 2) Pick OPEN FOs that have remainingQuantity > 0
    // ======================
    let openFos = fosAll.filter((fo) => norm(fo.status) === "OPEN" && hasRemaining(fo));
    const scheduledFos = fosAll.filter((fo) => norm(fo.status) === "SCHEDULED" && hasRemaining(fo));

    // ======================
    // 3) If no OPEN but have SCHEDULED, open them then refetch
    // ======================
    if (!openFos.length && scheduledFos.length) {
      for (const fo of scheduledFos) {
        const rOpen = await shopifyGraphQL(M_OPEN_FO, { id: fo.id });
        const ueOpen = rOpen?.fulfillmentOrderOpen?.userErrors?.[0];
        if (ueOpen) return res.status(400).json({ error: ueOpen.message, field: ueOpen.field });
      }

      // refetch after open
      const d2 = await shopifyGraphQL(Q_ORDER_FOS, { id: orderId });
      const order2 = d2?.order;
      fosAll = order2?.fulfillmentOrders?.nodes || [];
      openFos = fosAll.filter((fo) => norm(fo.status) === "OPEN" && hasRemaining(fo));
    }

    // ======================
    // 4) Still nothing -> debug
    // ======================
    if (!openFos.length) {
      return res.status(400).json({
        error: "لا توجد Fulfillment Orders قابلة للشحن (OPEN) لهذه الطلبية",
        debug: fosAll.map((x) => ({
          id: x.id,
          status: x.status,
          requestStatus: x.requestStatus,
          location: x.assignedLocation?.name || null,
          remainingSum: (x.lineItems?.nodes || []).reduce(
            (s, li) => s + Number(li.remainingQuantity || 0),
            0
          )
        }))
      });
    }

    // ======================
    // 5) Create fulfillment (ship)
    // ======================
    const fulfillmentInput = {
      lineItemsByFulfillmentOrder: openFos.map((x) => ({
        fulfillmentOrderId: x.id
      })),
      notifyCustomer: notify
    };

    if (tn) {
      fulfillmentInput.trackingInfo = {
        number: tn,
        company: tc || null,
        url: finalTrackingUrl
      };
    }

    const d3 = await shopifyGraphQL(M_CREATE_FULFILLMENT, { fulfillment: fulfillmentInput });

    const ue = d3?.fulfillmentCreate?.userErrors?.[0];
    if (ue) return res.status(400).json({ error: ue.message, field: ue.field });

    return res.json({
      success: true,
      orderName: order.name,
      fulfillmentId: d3?.fulfillmentCreate?.fulfillment?.id || null,
      fulfillmentStatus: d3?.fulfillmentCreate?.fulfillment?.status || null,
      trackingInfo: d3?.fulfillmentCreate?.fulfillment?.trackingInfo || null,
      usedFulfillmentOrders: openFos.map((x) => ({
        id: x.id,
        status: x.status,
        location: x.assignedLocation?.name || null
      }))
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

// ================== ✅ PACK: UPDATE PRODUCT BARCODE (Shopify Variant.barcode) ==================
app.post("/api/pack/product/barcode", async (req, res) => {
  try {
    const { variantId, barcode } = req.body || {};

    const shop = (SHOPIFY_SHOP || "").trim();
    const token = (SHOPIFY_ADMIN_TOKEN || "").trim();
    const apiVersion = (process.env.SHOPIFY_API_VERSION || "2024-10").trim();

    if (!shop) return res.status(500).json({ error: "ENV SHOPIFY_SHOP مفقود" });
    if (!token) return res.status(500).json({ error: "ENV SHOPIFY_ADMIN_TOKEN مفقود" });

    const vidRaw = (variantId || "").toString().trim();
    if (!vidRaw) return res.status(400).json({ error: "variantId مطلوب" });

    // يدعم gid أو رقم
    const vid = vidRaw.includes("gid://")
      ? vidRaw.split("/").pop()
      : vidRaw;

    if (!/^\d+$/.test(vid)) {
      return res.status(400).json({ error: "variantId غير صالح (لازم رقم أو gid صحيح)" });
    }

    const bc = (barcode ?? "").toString().trim(); // يسمح فاضي = يمسح

    const url = `https://${shop}/admin/api/${apiVersion}/variants/${vid}.json`;

    const r = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token
      },
      body: JSON.stringify({
        variant: { id: Number(vid), barcode: bc || null }
      })
    });

    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ error: d?.errors || d || "فشل تحديث الباركود" });
    }

    return res.json({
      success: true,
      variantId: d?.variant?.id || Number(vid),
      barcode: d?.variant?.barcode || null
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
// ✅ POST /api/ledger/add
// body: { product_key, product_name, type, qty, order_id?, supplier?, note? }
app.post("/api/ledger/add", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const product_key  = safeStr(req.body?.product_key);
    const product_name = safeStr(req.body?.product_name);
    const type         = safeStr(req.body?.type);
    const qty          = safeQty(req.body?.qty);

    const order_id = safeStr(req.body?.order_id);
    const supplier = safeStr(req.body?.supplier);
    const note     = safeStr(req.body?.note);

    if (!product_key) return res.status(400).json({ error: "product_key مطلوب" });
    if (!LEDGER_TYPES.has(type)) return res.status(400).json({ error: "type غير صحيح" });
    if (!qty) return res.status(400).json({ error: "qty لازم رقم > 0" });

    // لو ما وصل اسم المنتج، حاول من المخزون
    const finalName =
      product_name ||
      (await r.get(invNameKey(product_key))) ||
      product_key;

    const rec = await ledgerPush(r, {
      ts: new Date().toISOString(),
      product_key,
      product_name: finalName,
      type,
      qty,
      order_id,
      supplier,
      note
    });

    return res.json({ ok: true, item: rec });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
// ✅ GET /api/ledger/list?from=2026-01-25&to=2026-02-19&type=all&q=...&keys=a,b&limit=5000
app.get("/api/ledger/list", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ error: "REDIS_URL غير مضبوط في ENV" });

    const from = safeStr(req.query.from);
    const to   = safeStr(req.query.to);

    const type = safeStr(req.query.type || "all");
    const q    = safeStr(req.query.q).toLowerCase();

    const keysRaw = safeStr(req.query.keys);
    const keys = keysRaw
      ? keysRaw.split(",").map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase())
      : null;

    const limit = Math.min(Math.max(Number(req.query.limit || 5000) || 5000, 1), 20000);

    // نقرأ من global ledger (آخر LEDGER_MAX)
    const raw = await r.lRange(ledgerAllKey(), 0, LEDGER_MAX - 1);

    const fromTs = from && /^\d{4}-\d{2}-\d{2}/.test(from) ? Date.parse(from + "T00:00:00.000Z") : null;
    const toTs   = to   && /^\d{4}-\d{2}-\d{2}/.test(to)   ? Date.parse(to   + "T23:59:59.999Z") : null;

    const out = [];
    let scanned = 0;

    for (const s of raw) {
      scanned++;
      let m = null;
      try { m = JSON.parse(s); } catch { continue; }
      if (!m) continue;

      const ts = m.ts ? Date.parse(m.ts) : null;
      if (fromTs && ts && ts < fromTs) continue;
      if (toTs && ts && ts > toTs) continue;

      if (type !== "all" && safeStr(m.type) !== type) continue;

      const k = safeStr(m.product_key).toLowerCase();
      if (keys && keys.length && !keys.includes(k)) continue;

      if (q) {
        const hay = [
          m.product_name, m.product_key, m.order_id, m.supplier, m.note, m.type
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) continue;
      }

      out.push(m);
      if (out.length >= limit) break;
    }

    // ✅ Build images map from Shopify report (name -> image)
    let imgMap = {};
    try {
      const tags = normalizeTags(req.query.tags || "مسقط,تاكيد,مكتب");
      const limitImg = 250;

      const START_DATE = process.env.START_DATE || "2026-01-25";
      const tagQuery = tags.map(t => 'tag:"' + t + '"').join(" OR ");
      const qImg = "(" + tagQuery + ") AND fulfillment_status:unfulfilled AND created_at:>=" + START_DATE + " status:open";

      const queryImg =
        'query ($q: String!, $n: Int!) {' +
          'orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true) {' +
            'nodes {' +
              'lineItems(first: 100) {' +
                'nodes {' +
                  'title ' +
                  'variant {' +
                    'image { url } ' +
                    'product { featuredImage { url } } ' +
                  '}' +
                '}' +
              '}' +
            '}' +
          '}' +
        '}';

      const dataImg = await shopifyGraphQL(queryImg, { q: qImg, n: limitImg });

      const orders = (dataImg && dataImg.orders && dataImg.orders.nodes) ? dataImg.orders.nodes : [];
      for (const o of orders) {
        const lines = o && o.lineItems && o.lineItems.nodes ? o.lineItems.nodes : [];
        for (const li of lines) {
          const name = (li && li.title ? li.title : "").toString().trim().toLowerCase();
          const img =
            (li && li.variant && li.variant.image && li.variant.image.url) ||
            (li && li.variant && li.variant.product && li.variant.product.featuredImage && li.variant.product.featuredImage.url) ||
            "";
          if (name && img && !imgMap[name]) imgMap[name] = img;
        }
      }
    } catch (e) {
      imgMap = {};
    }

    // ✅ attach image to each ledger item using product_name
    const itemsWithImg = out.map(m => {
      const nm = (m.product_name || "").toString().trim().toLowerCase();
      return { ...m, image: imgMap[nm] || "" };
    });

    return res.json({
      ok: true,
      count: itemsWithImg.length,
      scanned,
      from: from || null,
      to: to || null,
      type,
      items: itemsWithImg
    });

  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});




// ─────────────────────────────────────────────────────────────────────────────
// إشعارات FCM لحالة الطلب
// يعرض الإشعار بالعربي فقط مثل الكود الأصلي
// ويحفظ العربي والإنجليزي داخل data لو التطبيق يحتاجهم لاحقًا
//
// يدعم:
// orders/fulfilled
// orders/partially_fulfilled
// orders/updated
// fulfillments/update
// fulfillment_events/create
// ─────────────────────────────────────────────────────────────────────────────


function parseShopifyWebhookBody(body) {
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return {};
    }
  }

  if (body && typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeShopifyStatus(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
    .replace(/\s+/g, "_");

  if (!status || status === "null" || status === "undefined") return "";

  // Shopify أحياناً يعطي partial على مستوى الطلب
  if (status === "partial") return "partially_fulfilled";

  return status;
}

function getFulfillmentObjects(payload) {
  const list = [];

  if (Array.isArray(payload?.fulfillments)) {
    list.push(...payload.fulfillments);
  }

  if (Array.isArray(payload?.order?.fulfillments)) {
    list.push(...payload.order.fulfillments);
  }

  if (payload?.fulfillment && typeof payload.fulfillment === "object") {
    list.push(payload.fulfillment);
  }

  // في fulfillments/update قد يكون الـ fulfillment نفسه هو الـ payload
  if (
    payload &&
    typeof payload === "object" &&
    (payload.shipment_status ||
      payload.tracking_number ||
      payload.tracking_company)
  ) {
    list.push(payload);
  }

  return list;
}

function resolveOrderShippingStatus(payload, topic) {
  // مهم جدًا:
  // orders/fulfilled يعني الطلب انشحن، لا نقرأ shipment_status هنا
  // عشان ما يظهر "تم التوصيل" بالغلط وقت الشحن.
  if (topic === "orders/fulfilled") {
    return "fulfilled";
  }

  if (topic === "fulfillments/create") {
    return "fulfilled";
  }

  if (topic === "orders/partially_fulfilled") {
    return "partially_fulfilled";
  }

  // في fulfillment_events/create الحالة غالبًا تأتي في payload.status
  // مثل: in_transit / out_for_delivery / delivered
  if (topic === "fulfillment_events/create") {
    const eventStatus = normalizeShopifyStatus(payload?.status);
    if (eventStatus) return eventStatus;
  }

  const fulfillments = getFulfillmentObjects(payload);

  // في fulfillments/update و orders/updated نقرأ shipment_status
  const latestWithShipmentStatus = [...fulfillments]
    .reverse()
    .find((f) => f?.shipment_status);

  const shipmentStatus = normalizeShopifyStatus(
    latestWithShipmentStatus?.shipment_status
  );

  if (shipmentStatus) return shipmentStatus;

  const rootShipmentStatus = normalizeShopifyStatus(payload?.shipment_status);
  if (rootShipmentStatus) return rootShipmentStatus;

  const orderFulfillmentStatus = normalizeShopifyStatus(
    payload?.fulfillment_status || payload?.order?.fulfillment_status
  );

  if (orderFulfillmentStatus) return orderFulfillmentStatus;

  return "";
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function parseOrderTags(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((t) => String(t || "").trim())
      .filter(Boolean);
  }

  return String(rawTags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function getOrderTagsInfo(payload) {
  // نقرأ تاقات الطلب فقط، وليس تاقات العميل
  // لأن القاعدة المطلوبة: الطلب اللي فيه tag ar يكون عربي.
  let hasTagsField = false;
  let rawTags = "";

  if (hasOwn(payload, "tags")) {
    hasTagsField = true;
    rawTags = payload.tags;
  } else if (payload?.order && hasOwn(payload.order, "tags")) {
    hasTagsField = true;
    rawTags = payload.order.tags;
  }

  const tags = parseOrderTags(rawTags);

  return {
    hasTagsField,
    tags,
  };
}

function getLangFromOrderTags(payload) {
  const info = getOrderTagsInfo(payload);

  if (!info.hasTagsField) {
    return "";
  }

  const normalizedTags = info.tags.map((tag) =>
    String(tag || "").trim().toLowerCase()
  );

  // إذا فيه تاق ar بالضبط → عربي
  if (normalizedTags.includes("ar")) {
    return "ar";
  }

  // إذا فيه تاقات وما فيها ar، أو tags فاضية → إنجليزي
  return "en";
}

async function resolveNotificationLang(r, payload, orderId) {
  const langFromTags = getLangFromOrderTags(payload);

  // إذا الـ webhook فيه tags، نعتمد عليها ونخزن اللغة للطلب
  if (langFromTags === "ar" || langFromTags === "en") {
    if (orderId) {
      await r.set(`bt:order:lang:${orderId}`, langFromTags, {
        EX: 60 * 60 * 24 * 90,
      });
    }

    return langFromTags;
  }

  // إذا الـ webhook ما فيه tags، مثل fulfillments/update غالبًا،
  // نحاول نجيب اللغة المخزنة من طلب سابق.
  if (orderId) {
    const savedLang = String(
      (await r.get(`bt:order:lang:${orderId}`)) || ""
    )
      .trim()
      .toLowerCase();

    if (savedLang === "ar" || savedLang === "en") {
      return savedLang;
    }
  }

  // الافتراضي إذا ما حصلنا tag ar ولا لغة مخزنة = إنجليزي
  return "en";
}

function buildOrderNotification(status, orderName) {
  const name = String(orderName || "").trim();
  const arOrder = name ? `طلبك ${name}` : "طلبك";
  const enOrder = name ? `Order ${name}` : "Your order";

  const messages = {
    fulfilled: {
      ar: {
title: "🚚 تم شحن طلبك",
body: `${arOrder} أصبح الآن في طريقه إليك بعد تجهيزه وشحنه بعناية. ترقّب التحديثات القادمة.`,
      },
      en: {
title: "🚚 The journey has begun",
body: `${enOrder} has been carefully prepared and is now on its way to you. Stay tuned for the next update.`,
      },
    },

    partially_fulfilled: {
      ar: {
        title: "📦 أول دفعة في الطريق",
        body: `جزء من ${arOrder} غادر الآن، والباقي نجهّزه لك ونخبرك فور انطلاقه.`,
      },
      en: {
        title: "📦 First batch on the way",
        body: `Part of ${enOrder.toLowerCase()} has just left. We are preparing the rest and will update you as soon as it moves.`,
      },
    },

    in_transit: {
      ar: {
        title: "✨ يقترب منك الآن",
        body: `${arOrder} يتحرك باتجاهك الآن. افتح التتبع وشاهد آخر خطوة في الرحلة.`,
      },
      en: {
        title: "✨ Getting closer now",
        body: `${enOrder} is moving your way. Open tracking to follow the latest step in its journey.`,
      },
    },

    out_for_delivery: {
      ar: {
        title: "🛵 خرج للتوصيل",
        body: `${arOrder} مع المندوب الآن. خلك قريب، اللمسة الأخيرة قبل ما يوصل لبابك.`,
      },
      en: {
        title: "🛵 Out for delivery",
        body: `${enOrder} is with the driver now. Stay close, the final stop is your door.`,
      },
    },

    delivered: {
      ar: {
        title: "🎉 وصل طلبك",
        body: `${arOrder} وصل بنجاح. استمتع بتجربتك، وسعداء إننا كنا جزءًا من يومك.`,
      },
      en: {
        title: "🎉 Delivered to you",
        body: `${enOrder} has arrived safely. Enjoy the experience, and thank you for letting us be part of your day.`,
      },
    },
  };

  return messages[status] || messages.fulfilled;
}

function buildRewardsNotification(points, orderName) {
  const safePoints = Number(points || 0);
  const name = String(orderName || "").trim().replace(/^#+/, "");
  const arOrder = name ? `\u0637\u0644\u0628\u0643 ${name}` : "\u0637\u0644\u0628\u0643";
  const enOrder = name ? `Order ${name}` : "your order";
  return {
    ar: {
      title: "\u0634\u0643\u0631\u064b\u0627 \u0644\u0627\u0633\u062a\u0644\u0627\u0645\u0643 \u0627\u0644\u0637\u0644\u0628",
      body: `\u0644\u0642\u062f \u062d\u0635\u0644\u062a \u0639\u0644\u0649 ${safePoints} \u0646\u0642\u0637\u0629 \u0645\u0646 ${arOrder}.`
    },
    en: {
      title: "Thanks for receiving your order",
      body: `You earned ${safePoints} points from ${enOrder}.`
    }
  };
}

function buildReviewRewardsNotification(points, productName, verified) {
  const safePoints = Number(points || 0);
  const safeName = String(productName || "").trim();
  const arProduct = safeName ? `\u0645\u0646\u062a\u062c ${safeName}` : "\u0627\u0644\u0645\u0646\u062a\u062c";
  const enProduct = safeName ? safeName : "the product";
  return {
    ar: {
      title: "\u0634\u0643\u0631\u064b\u0627 \u0644\u062a\u0642\u064a\u064a\u0645\u0643",
      body: verified
        ? `\u062d\u0635\u0644\u062a \u0639\u0644\u0649 ${safePoints} \u0646\u0642\u0637\u0629 \u0644\u062a\u0642\u064a\u064a\u0645 ${arProduct}.`
        : `\u062d\u0635\u0644\u062a \u0639\u0644\u0649 ${safePoints} \u0646\u0642\u0637\u0629 \u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0631\u0623\u064a\u0643.`
    },
    en: {
      title: "Thanks for your review",
      body: verified
        ? `You earned ${safePoints} points for reviewing ${enProduct}.`
        : `You earned ${safePoints} point for sharing your opinion.`
    }
  };
}

function buildReviewReverseNotification(points, productName) {
  const safePoints = Number(points || 0);
  const safeName = String(productName || "").trim();
  const arProduct = safeName ? `\u0645\u0646\u062a\u062c ${safeName}` : "\u0627\u0644\u0645\u0646\u062a\u062c";
  const enProduct = safeName ? safeName : "the product";
  return {
    ar: {
      title: "\u062a\u0645 \u062e\u0635\u0645 \u0646\u0642\u0627\u0637 \u0627\u0644\u062a\u0642\u064a\u064a\u0645",
      body: `\u062a\u0645 \u062e\u0635\u0645 ${safePoints} \u0646\u0642\u0637\u0629 \u0644\u0623\u0646 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u0631\u062a\u0628\u0637 \u0628\u062a\u0642\u064a\u064a\u0645 ${arProduct} \u062a\u0645 \u0625\u0644\u063a\u0627\u0624\u0647.`
    },
    en: {
      title: "Review points deducted",
      body: `${safePoints} points were deducted because the order linked to your review of ${enProduct} was cancelled.`
    }
  };
}

function buildReferralRewardsNotification(points) {
  const safePoints = Number(points || 0);
  return {
    ar: {
      title: "\u0645\u0643\u0627\u0641\u0623\u0629 \u062f\u0639\u0648\u0629 \u062c\u062f\u064a\u062f\u0629",
      body: `\u062d\u0635\u0644\u062a \u0639\u0644\u0649 ${safePoints} \u0646\u0642\u0637\u0629 \u0644\u0623\u0646 \u0639\u0645\u064a\u0644\u0627\u064b \u062f\u0639\u0648\u062a\u0647 \u0627\u0633\u062a\u0644\u0645 \u0637\u0644\u0628\u0647.`
    },
    en: {
      title: "New referral reward",
      body: `You earned ${safePoints} points because an invited customer received an order.`
    }
  };
}

function buildReferralReverseNotification(points) {
  const safePoints = Number(points || 0);
  return {
    ar: {
      title: "\u062a\u0645 \u062e\u0635\u0645 \u0646\u0642\u0627\u0637 \u062f\u0639\u0648\u0629",
      body: `\u062a\u0645 \u062e\u0635\u0645 ${safePoints} \u0646\u0642\u0637\u0629 \u0644\u0623\u0646 \u0637\u0644\u0628 \u0627\u0644\u0639\u0645\u064a\u0644 \u0627\u0644\u0645\u062f\u0639\u0648 \u062a\u0645 \u0625\u0644\u063a\u0627\u0624\u0647.`
    },
    en: {
      title: "Referral points deducted",
      body: `${safePoints} points were deducted because the invited customer's order was cancelled.`
    }
  };
}

async function sendReferralRewardsNotification({
  r,
  customerId,
  points,
  lang,
  reverse = false
}) {
  const safePoints = Math.abs(Number(points || 0));
  if (!r || !customerId || !safePoints) return false;
  const rawCustomerId = String(customerId || "");
  const numericCustomerId = rawCustomerId.includes("/")
    ? rawCustomerId.split("/").pop()
    : rawCustomerId;
  const notificationCustomerId = numericCustomerId || rawCustomerId;
  const fcmToken =
    (await r.get(`bt:user:push:${notificationCustomerId}`)) ||
    (await r.get(`bt:user:push:${rawCustomerId}`)) ||
    (await r.get(`bt:user:push:gid://shopify/Customer/${notificationCustomerId}`));
  if (!fcmToken) return false;
  const fa = getFirebaseAdmin();
  if (!fa) return false;

  const savedLocale = String(
    (await r.get(`bt:user:push-locale:${notificationCustomerId}`).catch(() => "")) || ""
  ).toLowerCase();
  const notificationLang = savedLocale
    ? (savedLocale.startsWith("en") ? "en" : "ar")
    : (lang === "ar" ? "ar" : "en");
  const msg = reverse
    ? buildReferralReverseNotification(safePoints)
    : buildReferralRewardsNotification(safePoints);
  const localized = msg[notificationLang] || msg.en;
  const notificationId = `referral-rewards-${Date.now()}-${notificationCustomerId}-${safePoints}`;
  const data = {
    type: "customer_rewards",
    dynamic_link: "https://app.halabt.com/rewards",
    points: String(reverse ? -safePoints : safePoints),
    lang: notificationLang,
    title_ar: String(msg.ar.title || ""),
    body_ar: String(msg.ar.body || ""),
    title_en: String(msg.en.title || ""),
    body_en: String(msg.en.body || "")
  };

  try {
    await r.lPush(
      `bt:user:notifications:${notificationCustomerId}`,
      JSON.stringify({
        id: notificationId,
        title: localized.title,
        body: localized.body,
        seen: false,
        date: new Date().toISOString(),
        additionalData: data
      })
    ).catch(() => {});
    await r.lTrim(`bt:user:notifications:${notificationCustomerId}`, 0, 99).catch(() => {});
    await r.expire(`bt:user:notifications:${notificationCustomerId}`, 60 * 60 * 24 * 120).catch(() => {});
    await fa.messaging().send({
      token: fcmToken,
      notification: {
        title: localized.title,
        body: localized.body
      },
      data: {
        id: notificationId,
        ...data
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default"
        }
      },
      apns: {
        payload: { aps: { sound: "default" } }
      }
    });
    return true;
  } catch (err) {
    console.error("referral rewards notification failed:", err?.message || err);
    return false;
  }
}

async function sendReviewRewardsNotification({
  r,
  customerId,
  points,
  productName,
  lang,
  verified,
  reverse = false
}) {
  const safePoints = Math.abs(Number(points || 0));
  if (!r || !customerId || !safePoints) return false;
  const rawCustomerId = String(customerId || "");
  const numericCustomerId = rawCustomerId.includes("/")
    ? rawCustomerId.split("/").pop()
    : rawCustomerId;
  const notificationCustomerId = numericCustomerId || rawCustomerId;

  const fcmToken =
    (await r.get(`bt:user:push:${notificationCustomerId}`)) ||
    (await r.get(`bt:user:push:${rawCustomerId}`)) ||
    (await r.get(`bt:user:push:gid://shopify/Customer/${notificationCustomerId}`));

  if (!fcmToken) return false;

  const fa = getFirebaseAdmin();
  if (!fa) return false;

  const notificationLang = lang === "ar" ? "ar" : "en";
  const msg = reverse
    ? buildReviewReverseNotification(safePoints, productName)
    : buildReviewRewardsNotification(safePoints, productName, verified);
  const localized = msg[notificationLang] || msg.en;
  const notificationId = `review-rewards-${Date.now()}-${customerId}-${safePoints}`;
  const data = {
    type: "customer_rewards",
    dynamic_link: "https://app.halabt.com/rewards",
    points: String(reverse ? -safePoints : safePoints),
    lang: notificationLang,
    title_ar: String(msg.ar.title || ""),
    body_ar: String(msg.ar.body || ""),
    title_en: String(msg.en.title || ""),
    body_en: String(msg.en.body || "")
  };

  try {
    await r.lPush(
      `bt:user:notifications:${notificationCustomerId}`,
      JSON.stringify({
        id: notificationId,
        title: localized.title,
        body: localized.body,
        seen: false,
        date: new Date().toISOString(),
        additionalData: data
      })
    ).catch(() => {});
    await r.lTrim(`bt:user:notifications:${notificationCustomerId}`, 0, 99).catch(() => {});
    await r.expire(`bt:user:notifications:${notificationCustomerId}`, 60 * 60 * 24 * 120).catch(() => {});
    await fa.messaging().send({
      token: fcmToken,
      notification: {
        title: localized.title,
        body: localized.body
      },
      data: {
        id: notificationId,
        ...data
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default"
        }
      },
      apns: {
        payload: {
          aps: {
            sound: "default"
          }
        }
      }
    });
    return true;
  } catch (e) {
    console.error("review rewards notification failed:", e?.message || e);
    return false;
  }
}

async function sendRewardsNotification({
  r,
  customerId,
  orderId,
  orderName,
  points,
  lang
}) {
  const safePoints = Number(points || 0);
  if (!r || !customerId || !safePoints || safePoints <= 0) return false;

  const fcmToken =
    (await r.get(`bt:user:push:${customerId}`)) ||
    (await r.get(`bt:user:push:gid://shopify/Customer/${customerId}`));

  if (!fcmToken) return false;

  const fa = getFirebaseAdmin();
  if (!fa) return false;

  const notificationLang = lang === "ar" ? "ar" : "en";
  const msg = buildRewardsNotification(safePoints, orderName);
  const localized = msg[notificationLang] || msg.en;
  const dedupeKey = `bt:rewards:notified:${orderId || customerId}:${safePoints}`;
  const claimed = await r.set(dedupeKey, "1", {
    EX: 60 * 60 * 24 * 90,
    NX: true
  });

  if (!claimed) return false;

  try {
    const notificationId = `rewards-${Date.now()}-${customerId}-${safePoints}`;
    await r.lPush(
      `bt:user:notifications:${customerId}`,
      JSON.stringify({
        id: notificationId,
        title: localized.title,
        body: localized.body,
        seen: false,
        date: new Date().toISOString(),
        additionalData: {
          type: "customer_rewards",
          dynamic_link: "https://app.halabt.com/rewards",
          order_name: String(orderName || ""),
          order_id: String(orderId || ""),
          points: String(safePoints),
          lang: notificationLang,
          title_ar: String(msg.ar.title || ""),
          body_ar: String(msg.ar.body || ""),
          title_en: String(msg.en.title || ""),
          body_en: String(msg.en.body || "")
        }
      })
    ).catch(() => {});
    await r.lTrim(`bt:user:notifications:${customerId}`, 0, 99).catch(() => {});
    await r.expire(`bt:user:notifications:${customerId}`, 60 * 60 * 24 * 120).catch(() => {});
    await fa.messaging().send({
      token: fcmToken,
      notification: {
        title: localized.title,
        body: localized.body
      },
      data: {
        id: notificationId,
        type: "customer_rewards",
        dynamic_link: "https://app.halabt.com/rewards",
        order_name: String(orderName || ""),
        order_id: String(orderId || ""),
        points: String(safePoints),
        lang: notificationLang,
        title_ar: String(msg.ar.title || ""),
        body_ar: String(msg.ar.body || ""),
        title_en: String(msg.en.title || ""),
        body_en: String(msg.en.body || "")
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default"
        }
      },
      apns: {
        payload: {
          aps: {
            sound: "default"
          }
        }
      }
    });
    return true;
  } catch (e) {
    await r.del(dedupeKey);
    console.error("rewards notification failed:", e?.message || e);
    return false;
  }
}

app.post("/api/shopify/webhooks/orders-fulfillment", async (req, res) => {
  console.log(
    `[orders-fulfillment] ← HIT topic="${req.get("x-shopify-topic")}" bodyType=${typeof req.body} isBuffer=${Buffer.isBuffer(req.body)}`
  );

  try {
    const topic = String(req.get("x-shopify-topic") || "")
      .trim()
      .toLowerCase();

    const allowed = [
      "orders/fulfilled",
      "orders/partially_fulfilled",
      "orders/updated",
      "fulfillments/create",
      "fulfillments/update",
      "fulfillment_events/create",
    ];

    if (!allowed.includes(topic)) {
      console.log(`[orders-fulfillment] topic not handled: "${topic}"`);
      return res.status(200).send("topic not handled");
    }

    const payload = parseShopifyWebhookBody(req.body);

    const r = await getRedis();
    if (!r) return res.status(200).send("redis not ready");

    const orderId = String(
      payload?.order_id ||
        payload?.order?.id ||
        (topic.startsWith("orders/") ? payload?.id : "") ||
        ""
    ).trim();

    const fulfillmentId = String(
      payload?.fulfillment_id ||
        payload?.fulfillment?.id ||
        (!topic.startsWith("orders/") ? payload?.id : "") ||
        ""
    ).trim();

    let orderName = String(
      payload?.name ||
        payload?.order_name ||
        payload?.order?.name ||
        payload?.order_number ||
        ""
    ).trim();

    let customerId = String(
      payload?.customer?.id ||
        payload?.customer_id ||
        payload?.order?.customer?.id ||
        payload?.order?.customer_id ||
        ""
    ).trim();

    // نخزن علاقة الطلب بالعميل عشان fulfillments/update غالباً ما يرسل customer.id
    if (orderId && customerId) {
      await r.set(`bt:order:customer:${orderId}`, customerId, {
        EX: 60 * 60 * 24 * 90,
      });
    }

    if (orderId && orderName) {
      await r.set(`bt:order:name:${orderId}`, orderName, {
        EX: 60 * 60 * 24 * 90,
      });
    }

    // إذا جاء fulfillment webhook بدون customerId، نحاول نجيبه من Redis
    if (!customerId && orderId) {
      customerId = String(
        (await r.get(`bt:order:customer:${orderId}`)) || ""
      ).trim();
    }

    // إذا جاء fulfillment webhook بدون orderName، نحاول نجيبه من Redis
    if (!orderName && orderId) {
      orderName = String(
        (await r.get(`bt:order:name:${orderId}`)) || ""
      ).trim();
    }

    console.log(
      `[orders-fulfillment] topic=${topic} customer=${customerId || "-"} orderId=${orderId || "-"} order=${orderName || "-"} fulfillmentId=${fulfillmentId || "-"}`
    );

    const notificationLang = await resolveNotificationLang(r, payload, orderId);

    const cancelledAt = String(
      payload?.cancelled_at ||
        payload?.cancelledAt ||
        payload?.order?.cancelled_at ||
        payload?.order?.cancelledAt ||
        ""
    ).trim();

    if (cancelledAt && orderId) {
      try {
        const reverseResult = await reverseOrderRewards({
          redis: r,
          orderId,
          customerId,
          source: `shopify_webhook:${topic}`
        });
        const reversedReviews = Array.isArray(reverseResult?.reviewReverse?.reversed)
          ? reverseResult.reviewReverse.reversed
          : [];
        for (const tx of reversedReviews) {
          await sendReviewRewardsNotification({
            r,
            customerId: tx?.customerId,
            points: Math.abs(Number(tx?.points || 0)),
            productName: tx?.meta?.productName || "",
            lang: notificationLang,
            reverse: true
          });
        }
        const reversedReferrals = Array.isArray(reverseResult?.referralReverse?.reversed)
          ? reverseResult.referralReverse.reversed
          : [];
        for (const tx of reversedReferrals) {
          await sendReferralRewardsNotification({
            r,
            customerId: tx?.customerId,
            points: Math.abs(Number(tx?.points || 0)),
            lang: notificationLang,
            reverse: true
          });
        }
      } catch (rewardError) {
        console.error("rewards cancel reverse failed:", rewardError?.message || rewardError);
      }
    }

    if (!customerId) {
      console.log("[orders-fulfillment] no customer id");
      return res.status(200).send("no customer");
    }

    const fulfillmentStatus = resolveOrderShippingStatus(payload, topic);

    const shipmentStatuses = getFulfillmentObjects(payload)
      .map((f) => f?.shipment_status)
      .filter(Boolean)
      .join(",");

    console.log(
      `[orders-fulfillment] resolvedStatus=${fulfillmentStatus || "-"} topic=${topic} orderFulfillmentStatus=${payload?.fulfillment_status || payload?.order?.fulfillment_status || "-"} shipmentStatuses=${shipmentStatuses || "-"}`
    );

    if (fulfillmentStatus === "delivered" && orderId) {
      try {
        const rewardResult = await syncDeliveredOrderRewards({
          redis: r,
          orderId,
          shopifyGraphQL,
          forceDelivered: true,
          source: `shopify_webhook:${topic}`
        });
        const earnedPoints = Number(rewardResult?.transaction?.points || 0);
        if (earnedPoints > 0) {
          await sendRewardsNotification({
            r,
            customerId,
            orderId,
            orderName,
            points: earnedPoints,
            lang: notificationLang
          });
        }
        const referralPoints = Number(rewardResult?.referralReward?.transaction?.points || 0);
        if (referralPoints > 0) {
          await sendReferralRewardsNotification({
            r,
            customerId: rewardResult?.referralReward?.referrerCustomerId,
            points: referralPoints,
            lang: notificationLang
          });
        }
      } catch (rewardError) {
        console.error("rewards delivered sync failed:", rewardError?.message || rewardError);
      }
    }

    const relevantStatuses = [
      "fulfilled",
      "partially_fulfilled",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ];

    if (!relevantStatuses.includes(fulfillmentStatus)) {
      return res.status(200).send("status not relevant");
    }

    const notificationMsg = buildOrderNotification(
      fulfillmentStatus,
      orderName
    );

    const localizedNotification =
      notificationMsg[notificationLang] || notificationMsg.en;

    // حماية طويلة: نفس الطلب ونفس الحالة لا يطلع لها إشعار إلا مرة واحدة.
    const dedupeOrderKey = orderId || orderName || fulfillmentId || customerId;
    const dedupeKey = `bt:order:notified:${dedupeOrderKey}:${fulfillmentStatus}`;

    // ابحث بالرقم البسيط أولاً، ثم بصيغة GID للتوافق مع التسجيلات القديمة
    const fcmToken =
      (await r.get(`bt:user:push:${customerId}`)) ||
      (await r.get(`bt:user:push:gid://shopify/Customer/${customerId}`));

    if (!fcmToken) {
      console.log(`[orders-fulfillment] no token for customer ${customerId}`);
      return res.status(200).send("no token for customer");
    }

    const fa = getFirebaseAdmin();
    if (!fa) {
      return res.status(200).send("firebase not ready");
    }

    const deepLink = "https://app.halabt.com/orders";

    try {
      const claimed = await r.set(dedupeKey, "1", {
        EX: 60 * 60 * 24 * 90,
        NX: true,
      });

      if (!claimed) {
        return res.status(200).send("already notified");
      }

      const notificationId = `order-${Date.now()}-${customerId}-${fulfillmentStatus}`;
      await r.lPush(
        `bt:user:notifications:${customerId}`,
        JSON.stringify({
          id: notificationId,
          title: localizedNotification.title,
          body: localizedNotification.body,
          seen: false,
          date: new Date().toISOString(),
          additionalData: {
            dynamic_link: deepLink,
            order_name: String(orderName || ""),
            order_id: String(orderId || ""),
            fulfillment_id: String(fulfillmentId || ""),
            fulfillment_status: String(fulfillmentStatus || ""),
            lang: String(notificationLang || "en"),
            title_ar: String(notificationMsg.ar.title || ""),
            body_ar: String(notificationMsg.ar.body || ""),
            title_en: String(notificationMsg.en.title || ""),
            body_en: String(notificationMsg.en.body || "")
          }
        })
      ).catch(() => {});
      await r.lTrim(`bt:user:notifications:${customerId}`, 0, 99).catch(() => {});
      await r.expire(`bt:user:notifications:${customerId}`, 60 * 60 * 24 * 120).catch(() => {});

      await fa.messaging().send({
        token: fcmToken,

        // الإشعار الظاهر للمستخدم: لغة واحدة فقط
        // ar tag = عربي
        // بدون ar tag = إنجليزي
        notification: {
          title: localizedNotification.title,
          body: localizedNotification.body,
        },

        // نخزن النسختين في data لو التطبيق يحتاجها لاحقاً
        data: {
          id: notificationId,
          dynamic_link: deepLink,
          order_name: String(orderName || ""),
          order_id: String(orderId || ""),
          fulfillment_id: String(fulfillmentId || ""),
          fulfillment_status: String(fulfillmentStatus || ""),
          lang: String(notificationLang || "en"),

          title_ar: String(notificationMsg.ar.title || ""),
          body_ar: String(notificationMsg.ar.body || ""),
          title_en: String(notificationMsg.en.title || ""),
          body_en: String(notificationMsg.en.body || ""),
        },

        android: {
          notification: {
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            sound: "default",
          },
        },

        apns: {
          payload: {
            aps: {
              sound: "default",
            },
          },
        },
      });

      console.log(
        `✅ FCM order push sent → customer ${customerId} | order=${orderName || orderId || "-"} | topic=${topic} | status=${fulfillmentStatus} | lang=${notificationLang}`
      );
    } catch (fcmErr) {
      await r.del(dedupeKey);

      const code = String(fcmErr?.code || "");

      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        await r.del(`bt:user:push:${customerId}`);
        await r.del(`bt:user:push:gid://shopify/Customer/${customerId}`);
      }

      console.error("FCM order push error:", fcmErr?.message || fcmErr);
    }

    return res.status(200).send("ok");
  } catch (e) {
    console.error("orders-fulfillment webhook error:", e);
    return res.status(500).send("error");
  }
});

// ================== API JSON FALLBACKS ==================
app.get("/api/pack/ping", (req, res) => {
  res.json({ ok: true, from: "server.js", time: new Date().toISOString() });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/bt-reviews")) {
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found: " + req.path });
  }
  next();
});

app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ error: err.message || String(err) });
  }
  next(err);
});



// ── Redirect app.halabt.com links → Shopify (fallback for browsers) ──
app.use(shareLinksRouter());

// ── Android App Links ─────────────────────────────────────────

// ── iOS Universal Links ────────────────────────────────────────




// ── Cart Share Deep Link ────────────────────────────────────────
// Example:
// https://app.halabt.com/cart/44558064255059:1

function btCartIsValidItems(items) {
  return /^[0-9]+:[1-9][0-9]*(,[0-9]+:[1-9][0-9]*)*$/.test(String(items || ""));
}

function btCartEsc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function btCartGetMeta(req) {
  const lang = String(
    req.query.lang || req.headers["accept-language"] || ""
  ).toLowerCase();

  const isEn = lang.includes("en");

  return {
    siteName: isEn ? "Hala Beauty" : "هلا بيوتي",
    title: isEn ? "Your cart | Hala Beauty" : "سلتك | هلا بيوتي",
    description: isEn
      ? "Your selected items are ready in the cart"
      : "منتجاتك المختارة جاهزة في السلة",
    image: "https://halabt.com/cdn/shop/files/cart.png"
  };
}

function btCartBuildShopifyUrl(items, description) {
  const encodedDescription = encodeURIComponent(description);

  return `https://halabt.com/?openCart=1&i=${items}&t=${encodedDescription}` +
         `#openCart=1&i=${items}`;
}

function btCartIsPreviewBot(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();

  return (
    ua.includes("facebookexternalhit") ||
    ua.includes("facebot") ||
    ua.includes("twitterbot") ||
    ua.includes("whatsapp") ||
    ua.includes("telegrambot") ||
    ua.includes("slackbot") ||
    ua.includes("discordbot") ||
    ua.includes("linkedinbot") ||
    ua.includes("pinterest") ||
    ua.includes("googlebot")
  );
}

function btCartRenderPage(req, res, rawItems) {
  try {
    const items = decodeURIComponent(String(rawItems || "")).trim();

    if (!btCartIsValidItems(items)) {
      return res.status(400).send("Invalid cart link");
    }

    const meta = btCartGetMeta(req);
    const shopifyUrl = btCartBuildShopifyUrl(items, meta.description);
    const currentUrl = `https://app.halabt.com${req.originalUrl}`;

    // ✅ المستخدم العادي يتحول مباشرة بدون صفحة "جاري فتح السلة"
    if (!btCartIsPreviewBot(req)) {
      return res.redirect(302, shopifyUrl);
    }

    // ✅ البوتات فقط تشوف Meta Tags حتى تظهر صورة ووصف المشاركة
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, s-maxage=300"
    );

    return res.status(200).send(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${btCartEsc(meta.title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <link rel="canonical" href="${btCartEsc(currentUrl)}">

  <meta property="og:site_name" content="${btCartEsc(meta.siteName)}">
  <meta property="og:url" content="${btCartEsc(currentUrl)}">
  <meta property="og:title" content="${btCartEsc(meta.title)}">
  <meta property="og:type" content="website">
  <meta property="og:description" content="${btCartEsc(meta.description)}">
  <meta property="og:image" content="${btCartEsc(meta.image)}">
  <meta property="og:image:secure_url" content="${btCartEsc(meta.image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${btCartEsc(meta.title)}">
  <meta name="twitter:description" content="${btCartEsc(meta.description)}">
  <meta name="twitter:image" content="${btCartEsc(meta.image)}">
</head>
<body></body>
</html>`);
  } catch (e) {
    console.error("Cart deep link error:", e);
    return res.redirect(302, "https://halabt.com");
  }
}
app.get(/^\/cart\/(.+)$/, (req, res) => {
  return btCartRenderPage(req, res, req.params[0]);
});

app.get("/cart", (req, res) => {
  return btCartRenderPage(req, res, req.query.i);
});



// ════════════════════════════════════════════════════════════════════════════
// 🌟 BT REVIEWS — نظام تقييم المنتجات (نجوم + تعليق + صور)
// ════════════════════════════════════════════════════════════════════════════

const REVIEWS_I18N = {
  ar: {
    missingProduct: "معرّف المنتج مطلوب",
    invalidRating: "التقييم يجب أن يكون بين 1 و 5 نجوم",
    missingAuthor: "الاسم مطلوب",
    notFound: "التقييم غير موجود",
    redisDown: "خدمة التخزين غير متاحة",
    saved: "تم حفظ تقييمك",
    deleted: "تم حذف التقييم",
    updated: "تم تحديث التقييم",
    uploadFailed: "تعذر رفع الصورة",
    serverError: "خطأ داخلي في الخادم"
  },
  en: {
    missingProduct: "Product ID is required",
    invalidRating: "Rating must be between 1 and 5 stars",
    missingAuthor: "Name is required",
    notFound: "Review not found",
    redisDown: "Storage service unavailable",
    saved: "Your review has been saved",
    deleted: "Review deleted",
    updated: "Review updated",
    uploadFailed: "Failed to upload image",
    serverError: "Internal server error"
  }
};

function reviewsDict(req) {
  const lang = String(req.query.lang || req.body?.lang || "ar").toLowerCase();
  return REVIEWS_I18N[lang === "en" ? "en" : "ar"];
}
function reviewsLang(req) {
  const lang = String(req.query.lang || req.body?.lang || "ar").toLowerCase();
  return lang === "en" ? "en" : "ar";
}

// مفاتيح Redis
const RV_KEY_PRODUCT = (pid) => `bt:rv:product:${String(pid).trim()}`;       // ZSET: reviewId -> timestamp
const RV_KEY_ITEM    = (id)  => `bt:rv:item:${String(id).trim()}`;            // HASH: review data
const RV_KEY_SUMMARY = (pid) => `bt:rv:summary:${String(pid).trim()}`;        // HASH: count, sum
const RV_KEY_ALL     = `bt:rv:all`;                                            // ZSET: all reviewIds (admin)

// مفتاح dedup — يمنع تكرار نفس التقييم عند الاستيراد
function RV_KEY_DEDUP(productId, author, comment) {
  const str = `${String(productId).trim()}|${String(author).trim().toLowerCase()}|${String(comment).trim().toLowerCase().slice(0, 120)}`;
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `bt:rv:dedup:${hash}`;
}

function reviewProductAliases(productId) {
  const raw = String(productId || "").trim();
  if (!raw) return [];
  const out = new Set([raw]);
  const numeric = raw.split("/").pop();
  if (/^\d+$/.test(numeric)) {
    out.add(numeric);
    out.add(`gid://shopify/Product/${numeric}`);
  }
  return [...out];
}

// uploader للتقييم — حتى 4 صور × 5MB
const reviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 4 }
});

function reviewIdGen() {
  return `rv_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

// ── POST /api/bt-reviews — إنشاء تقييم ──
app.post("/api/bt-reviews", reviewUpload.array("images", 4), async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const productId = String(req.body?.productId || "").trim();
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || "").trim().slice(0, 2000);
    const author = String(req.body?.author || "").trim().slice(0, 80);
    const email = String(req.body?.email || "").trim().slice(0, 150);
    const orderId = String(req.body?.orderId || "").trim();
    const productName = String(req.body?.productName || "").trim().slice(0, 200);
    let reviewRewardContext = null;

    if (!productId) return res.status(400).json({ ok: false, error: dict.missingProduct, lang });
    if (!Number.isFinite(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ ok: false, error: dict.invalidRating, lang });
    if (!author) return res.status(400).json({ ok: false, error: dict.missingAuthor, lang });

    try {
      reviewRewardContext = await prepareReviewReward({
        redis: r,
        productId,
        orderId,
        email,
        rating,
        photoCount: (req.files || []).length,
        shopifyGraphQL
      });
    } catch (rewardGuardError) {
      if (rewardGuardError?.reviewBlocked) {
        return res.status(429).json({
          ok: false,
          error: lang === "en"
            ? "Reviews are temporarily limited because several negative reviews were submitted for products not linked to delivered orders."
            : "\u062a\u0645 \u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u062a\u0642\u064a\u064a\u0645\u0627\u062a \u0645\u0624\u0642\u062a\u064b\u0627 \u0628\u0633\u0628\u0628 \u062a\u0643\u0631\u0627\u0631 \u062a\u0642\u064a\u064a\u0645\u0627\u062a \u0633\u0644\u0628\u064a\u0629 \u0644\u0645\u0646\u062a\u062c\u0627\u062a \u063a\u064a\u0631 \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0637\u0644\u0628\u0627\u062a \u0645\u0633\u062a\u0644\u0645\u0629.",
          lang
        });
      }
      console.error("review reward guard failed:", rewardGuardError?.message || rewardGuardError);
    }

    // ارفع الصور (إن وجدت)
    const photos = [];
    for (const file of (req.files || [])) {
      try {
        const up = await uploadToCloudinary(file.buffer, "bt-reviews");
        photos.push({ url: up.url, publicId: up.publicId });
      } catch (e) {
        return res.status(500).json({ ok: false, error: dict.uploadFailed, lang });
      }
    }

    const id = reviewIdGen();
    const ts = Date.now();
    const ratingInt = Math.round(rating);

    const data = {
      id, productId, productName,
      rating: String(ratingInt),
      comment, author, email, orderId,
      photos: JSON.stringify(photos),
      // مؤثق = أضافه الإدارة صراحةً، أو لديه orderId
      verified: (req.body?.verified === "true" || !!orderId) ? "true" : "false",
      createdAt: String(ts),
      updatedAt: String(ts),
      status: "approved"
    };

    await r.hSet(RV_KEY_ITEM(id), data);
    await r.zAdd(RV_KEY_PRODUCT(productId), { score: ts, value: id });
    await r.zAdd(RV_KEY_ALL, { score: ts, value: id });
    await r.hIncrBy(RV_KEY_SUMMARY(productId), "count", 1);
    await r.hIncrBy(RV_KEY_SUMMARY(productId), "sum", ratingInt);

    let reward = null;
    try {
      reward = await awardReviewRewards({
        redis: r,
        reviewContext: reviewRewardContext,
        reviewId: id,
        productId,
        orderId,
        productName,
        email,
        rating: ratingInt,
        photoCount: photos.length,
        shopifyGraphQL
      });
      const earnedPoints = Number(reward?.transaction?.points || reward?.reviewPoints || 0);
      if (earnedPoints > 0 && reward?.customerId) {
        await sendReviewRewardsNotification({
          r,
          customerId: reward.customerId,
          points: earnedPoints,
          productName,
          lang,
          verified: !!reward?.reviewContext?.deliveredProduct
        });
      }
    } catch (rewardError) {
      console.error("review rewards award failed:", rewardError?.message || rewardError);
    }

    return res.json({
      ok: true,
      message: dict.saved,
      lang,
      reward,
      review: { ...data, photos, rating: ratingInt, createdAt: ts, updatedAt: ts }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── GET /api/bt-reviews?productId=X&page=1&limit=20 — قائمة تقييمات منتج ──
app.get("/api/bt-reviews", async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const productId = String(req.query.productId || "").trim();
    if (!productId) return res.status(400).json({ ok: false, error: dict.missingProduct, lang });

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    const aliases = reviewProductAliases(productId);
    const allIds = [];
    const seenIds = new Set();
    for (const alias of aliases) {
      const aliasIds = await r.zRange(RV_KEY_PRODUCT(alias), 0, -1, { REV: true });
      for (const id of aliasIds) {
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allIds.push(id);
        }
      }
    }
    const ids = allIds.slice(start, end + 1);
    const total = allIds.length;

    const items = [];
    for (const id of ids) {
      const h = await r.hGetAll(RV_KEY_ITEM(id));
      if (!h || !h.id) continue;
      const isVerified = h.verified === "true";
      // أضف "✓ مؤثق / Verified" لاسم الكاتب مباشرة — يظهر في التطبيق بدون تعديل Flutter
      const verifiedSuffix = isVerified
        ? (lang === 'ar' ? ' · مؤثق ✓' : ' · Verified ✓')
        : '';
      items.push({
        id: h.id,
        productId: h.productId,
        productName: h.productName || "",
        rating: parseInt(h.rating || "0", 10),
        comment: h.comment || "",
        author: (h.author || "") + verifiedSuffix,
        photos: h.photos ? JSON.parse(h.photos) : [],
        verified: isVerified,
        createdAt: parseInt(h.createdAt || "0", 10),
        updatedAt: parseInt(h.updatedAt || "0", 10)
      });
    }

    // الملخص
    let count = 0;
    let sum = 0;
    for (const alias of aliases) {
      const sumH = await r.hGetAll(RV_KEY_SUMMARY(alias));
      count += parseInt(sumH?.count || "0", 10);
      sum += parseInt(sumH?.sum || "0", 10);
    }
    const average = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

    return res.json({
      ok: true, lang,
      productId, page, limit, total,
      summary: { count, average },
      reviews: items
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── GET /api/bt-reviews/summary?productIds=A,B,C — ملخصات دفعة (للقوائم) ──
app.get("/api/bt-reviews/summary", async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const raw = String(req.query.productIds || "").trim();
    if (!raw) return res.json({ ok: true, lang, summaries: {} });

    const ids = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);
    const out = {};
    for (const pid of ids) {
      let count = 0;
      let sum = 0;
      for (const alias of reviewProductAliases(pid)) {
        const h = await r.hGetAll(RV_KEY_SUMMARY(alias));
        count += parseInt(h?.count || "0", 10);
        sum += parseInt(h?.sum || "0", 10);
      }
      // فقط منتجات لها تقييم
      if (count > 0) {
        out[pid] = { count, average: Math.round((sum / count) * 10) / 10 };
      }
    }
    return res.json({ ok: true, lang, summaries: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── GET /api/bt-reviews/admin/products-with-reviews — كل المنتجات التي عندها تقييمات ──
app.get("/api/bt-reviews/admin/products-with-reviews", requirePack, async (req, res) => {
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: "Redis unavailable" });

    // اجمع كل مفاتيح السّمري
    const keys = await r.keys('bt:rv:summary:*');
    const products = [];

    for (const key of keys) {
      const productId = key.replace('bt:rv:summary:', '');
      const sumH = await r.hGetAll(key);
      const count = parseInt(sumH?.count || '0', 10);
      if (count === 0) continue;
      const sum   = parseInt(sumH?.sum   || '0', 10);
      const avg   = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;

      // اجلب اسم المنتج وصورته من أحدث تقييم
      const ids = await r.zRange(RV_KEY_PRODUCT(productId), -1, -1, { REV: false });
      let productName = '', productImage = '';
      if (ids.length) {
        const h = await r.hGetAll(RV_KEY_ITEM(ids[0]));
        productName  = h?.productName || '';
        // حاول جلب صورة المنتج من Shopify metadata إذا مُخزّنة
        try {
          const imgs = h?.photos ? JSON.parse(h.photos) : [];
          // لا نريد صورة التقييم — نريد صورة المنتج، تُترك فارغة هنا
        } catch {}
      }

      // أحدث تقييم timestamp
      const latestScores = await r.zRange(RV_KEY_PRODUCT(productId), -1, -1, { REV: false, withScores: true });
      const latestTs = latestScores?.[0]?.score || 0;

      products.push({ productId, productName, count, average: avg, latestTs });
    }

    // رتّب حسب أحدث نشاط
    products.sort((a, b) => b.latestTs - a.latestTs);

    return res.json({ ok: true, products });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message });
  }
});

// ── GET /api/bt-reviews/admin/all — كل التقييمات للوحة الإدارة ──
app.get("/api/bt-reviews/admin/all", requirePack, async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const productId = String(req.query.productId || "").trim();

    let ids = [];
    let total = 0;
    if (productId) {
      const allIds = [];
      const seenIds = new Set();
      for (const alias of reviewProductAliases(productId)) {
        const aliasIds = await r.zRange(RV_KEY_PRODUCT(alias), 0, -1, { REV: true });
        for (const id of aliasIds) {
          if (!seenIds.has(id)) {
            seenIds.add(id);
            allIds.push(id);
          }
        }
      }
      total = allIds.length;
      ids = allIds.slice(start, end + 1);
    } else {
      ids = await r.zRange(RV_KEY_ALL, start, end, { REV: true });
      total = await r.zCard(RV_KEY_ALL);
    }

    const items = [];
    for (const id of ids) {
      const h = await r.hGetAll(RV_KEY_ITEM(id));
      if (!h || !h.id) continue;
      items.push({
        id: h.id,
        productId: h.productId,
        productName: h.productName || "",
        rating: parseInt(h.rating || "0", 10),
        comment: h.comment || "",
        author: h.author || "",
        email: h.email || "",
        orderId: h.orderId || "",
        photos: h.photos ? JSON.parse(h.photos) : [],
        verified: h.verified === "true",
        createdAt: parseInt(h.createdAt || "0", 10),
        updatedAt: parseInt(h.updatedAt || "0", 10),
        status: h.status || "approved"
      });
    }

    return res.json({ ok: true, lang, page, limit, total, reviews: items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── GET /api/bt-reviews/admin/products/search?q=... — بحث منتجات لإضافة تقييم يدوي ──
app.get("/api/bt-reviews/admin/products/search", requirePack, async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const qRaw = String(req.query.q || "").trim();
    if (!qRaw || qRaw.length < 2) {
      return res.json({ ok: true, lang, products: [] });
    }

    const limit = Math.min(30, Math.max(1, Number(req.query.limit || 12)));
    const safe = qRaw.replace(/"/g, '\\"');
    const query = `(${safe}) OR title:${safe}* OR vendor:${safe}* OR tag:${safe}*`;

    const GQL = `
      query SearchReviewProducts($first:Int!, $query:String!) {
        products(first:$first, query:$query) {
          edges {
            node {
              id
              title
              handle
              vendor
              featuredImage { url }
            }
          }
        }
      }
    `;

    const data = await shopifyGraphQL(GQL, { first: limit, query });
    const products = (data?.products?.edges || []).map((edge) => {
      const p = edge?.node || {};
      const gid = String(p.id || "");
      return {
        id: gid.split("/").pop(),
        gid,
        title: p.title || "",
        handle: p.handle || "",
        vendor: p.vendor || "",
        imageUrl: p.featuredImage?.url || ""
      };
    }).filter((p) => p.id && p.title);

    return res.json({ ok: true, lang, products });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── POST /api/bt-reviews/admin/repair-product-names — إصلاح أسماء المنتجات المستوردة من Judge.me ──
app.post("/api/bt-reviews/admin/repair-product-names", requirePack, async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const reviewIds = await r.zRange(RV_KEY_ALL, 0, -1, { REV: true });
    const reviews = [];
    const productGids = new Set();

    for (const id of reviewIds) {
      const h = await r.hGetAll(RV_KEY_ITEM(id));
      if (!h?.id || !h.productId) continue;
      const currentName = String(h.productName || "").trim();
      const looksLikeHandle = currentName && !/\s/.test(currentName) && currentName.includes("-");
      if (currentName && !looksLikeHandle && currentName !== h.productId) continue;

      const numeric = String(h.productId).split("/").pop();
      if (!/^\d+$/.test(numeric)) continue;
      const gid = `gid://shopify/Product/${numeric}`;
      productGids.add(gid);
      reviews.push({ reviewId: id, productId: h.productId, gid });
    }

    const titleByGid = {};
    const gids = [...productGids];
    for (let i = 0; i < gids.length; i += 50) {
      const chunk = gids.slice(i, i + 50);
      const GQL = `
        query ReviewProductTitles($ids:[ID!]!) {
          nodes(ids:$ids) {
            ... on Product { id title }
          }
        }
      `;
      const data = await shopifyGraphQL(GQL, { ids: chunk });
      for (const node of (data?.nodes || [])) {
        if (node?.id && node?.title) titleByGid[node.id] = node.title;
      }
    }

    let updated = 0;
    for (const item of reviews) {
      const title = titleByGid[item.gid];
      if (!title) continue;
      await r.hSet(RV_KEY_ITEM(item.reviewId), {
        productName: String(title).slice(0, 200),
        updatedAt: String(Date.now())
      });
      updated += 1;
    }

    return res.json({ ok: true, lang, scanned: reviewIds.length, updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── PATCH /api/bt-reviews/admin/:id — تعديل (admin) ──
app.patch("/api/bt-reviews/admin/:id", requirePack, reviewUpload.array("images", 4), async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const id = String(req.params.id || "").trim();
    const h = await r.hGetAll(RV_KEY_ITEM(id));
    if (!h || !h.id) return res.status(404).json({ ok: false, error: dict.notFound, lang });

    const productId = h.productId;
    const oldRating = parseInt(h.rating || "0", 10);
    const updates = {};

    if (req.body.rating !== undefined) {
      const newRating = Number(req.body.rating);
      if (!Number.isFinite(newRating) || newRating < 1 || newRating > 5)
        return res.status(400).json({ ok: false, error: dict.invalidRating, lang });
      const ri = Math.round(newRating);
      updates.rating = String(ri);
      // عدّل المجموع
      const diff = ri - oldRating;
      if (diff !== 0) await r.hIncrBy(RV_KEY_SUMMARY(productId), "sum", diff);
    }
    if (req.body.comment !== undefined)
      updates.comment = String(req.body.comment).slice(0, 2000);
    if (req.body.author !== undefined)
      updates.author = String(req.body.author).slice(0, 80);
    if (req.body.productName !== undefined)
      updates.productName = String(req.body.productName).slice(0, 200);
    if (req.body.status !== undefined)
      updates.status = String(req.body.status).slice(0, 20);

    if (req.body.existingPhotos !== undefined || (req.files || []).length) {
      const currentPhotos = h.photos ? JSON.parse(h.photos) : [];
      let keptPhotos = currentPhotos;

      if (req.body.existingPhotos !== undefined) {
        try {
          const parsed = JSON.parse(String(req.body.existingPhotos || "[]"));
          const currentIds = new Set(currentPhotos.map((p) => String(p?.publicId || p?.url || "")));
          keptPhotos = Array.isArray(parsed)
            ? parsed.filter((p) => currentIds.has(String(p?.publicId || p?.url || "")))
            : [];
        } catch {
          keptPhotos = currentPhotos;
        }
      }

      const keptIds = new Set(keptPhotos.map((p) => String(p?.publicId || p?.url || "")));
      for (const p of currentPhotos) {
        const key = String(p?.publicId || p?.url || "");
        if (!keptIds.has(key) && p?.publicId) {
          try { await cloudinary.uploader.destroy(p.publicId); } catch {}
        }
      }

      const addedPhotos = [];
      for (const file of (req.files || [])) {
        try {
          const up = await uploadToCloudinary(file.buffer, "bt-reviews");
          addedPhotos.push({ url: up.url, publicId: up.publicId });
        } catch (e) {
          return res.status(500).json({ ok: false, error: dict.uploadFailed, lang });
        }
      }

      updates.photos = JSON.stringify([...keptPhotos, ...addedPhotos].slice(0, 4));
    }

    updates.updatedAt = String(Date.now());
    await r.hSet(RV_KEY_ITEM(id), updates);

    return res.json({ ok: true, lang, message: dict.updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});

// ── DELETE /api/bt-reviews/admin/:id — حذف (admin) ──
app.delete("/api/bt-reviews/admin/:id", requirePack, async (req, res) => {
  const dict = reviewsDict(req);
  const lang = reviewsLang(req);
  try {
    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: dict.redisDown, lang });

    const id = String(req.params.id || "").trim();
    const h = await r.hGetAll(RV_KEY_ITEM(id));
    if (!h || !h.id) return res.status(404).json({ ok: false, error: dict.notFound, lang });

    const productId = h.productId;
    const rating = parseInt(h.rating || "0", 10);
    const photos = h.photos ? JSON.parse(h.photos) : [];

    // احذف الصور من Cloudinary
    for (const p of photos) {
      if (p?.publicId) {
        try { await cloudinary.uploader.destroy(p.publicId); } catch {}
      }
    }

    await r.del(RV_KEY_ITEM(id));
    await r.zRem(RV_KEY_PRODUCT(productId), id);
    await r.zRem(RV_KEY_ALL, id);
    await r.hIncrBy(RV_KEY_SUMMARY(productId), "count", -1);
    await r.hIncrBy(RV_KEY_SUMMARY(productId), "sum", -rating);

    // نظّف إذا أصبح العدد 0
    const sumH = await r.hGetAll(RV_KEY_SUMMARY(productId));
    if (parseInt(sumH?.count || "0", 10) <= 0) {
      await r.del(RV_KEY_SUMMARY(productId));
    }

    return res.json({ ok: true, lang, message: dict.deleted });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || dict.serverError, lang });
  }
});



// ── headers مشتركة لطلبات fetch ──
const SCRAPE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ar-SA,ar;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

// ── scrapeAmazonReviews — fetch فقط، بدون Puppeteer ──
async function scrapeAmazonReviews(productUrl, maxCount) {
  const debugInfo = {};
  const reviews   = [];

  const asin   = productUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1]
              || productUrl.match(/\/([A-Z0-9]{10})(?:[/?]|$)/)?.[1];
  const domain = productUrl.match(/amazon\.(\w{2,3})/)?.[1] || 'sa';

  if (!asin) return { reviews: [], debug: { error: 'ASIN not found in URL' } };

  let pageUrl = `https://www.amazon.${domain}/product-reviews/${asin}?pageSize=10&sortBy=recent`;
  debugInfo.reviewsUrl = pageUrl;

  for (let pageNum = 1; pageNum <= 5 && reviews.length < maxCount; pageNum++) {
    let html;
    try {
      const res = await fetch(pageUrl, {
        headers: { ...SCRAPE_HEADERS, 'Referer': `https://www.amazon.${domain}/` },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      debugInfo[`p${pageNum}_status`] = res.status;
      if (!res.ok) break;
      html = await res.text();
    } catch (e) {
      debugInfo[`p${pageNum}_error`] = e.message;
      break;
    }

    // هل CAPTCHA؟
    if (html.includes('captcha') || html.includes('Type the characters')) {
      debugInfo.blocked = 'CAPTCHA';
      break;
    }

    // استخرج بيانات التقييمات من HTML بـ regex
    // كل تقييم محاط بـ data-hook="review"
    const reviewBlocks = html.split('data-hook="review"').slice(1);
    debugInfo[`p${pageNum}_blocks`] = reviewBlocks.length;

    for (const block of reviewBlocks) {
      if (reviews.length >= maxCount) break;
      // المؤلف
      const authorM = block.match(/class="a-profile-name"[^>]*>([^<]+)</);
      const author  = authorM?.[1]?.trim() || '';
      // التقييم: "X.0 out of 5 stars" أو "X من 5"
      const starM  = block.match(/(\d(?:\.\d)?)\s*(?:out of 5|من 5)/i)
                  || block.match(/a-icon-alt">([^<]+)</);
      const rating = parseFloat(starM?.[1] || '5') || 5;
      // النص
      const bodyM  = block.match(/data-hook="review-body"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/);
      const comment = (bodyM?.[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      // الصور
      const imgMatches = [...block.matchAll(/data-src="(https:\/\/m\.media-amazon\.com\/images\/[^"]+)"/g)];
      const images = imgMatches.map(m => m[1].replace(/_SL\d+_/, '_SL500_'));

      if (author || comment) reviews.push({ author, rating, comment, images, daysAgo: 0 });
    }

    // الصفحة التالية
    const nextM = html.match(/class="a-last"[^>]*>[\s\S]*?<a href="([^"]+)"/);
    if (!nextM) break;
    pageUrl = `https://www.amazon.${domain}${nextM[1].replace(/&amp;/g, '&')}`;
  }

  return { reviews: reviews.slice(0, maxCount), debug: debugInfo };
}

// ── scrapeNoonReviews — يستدعي Catalog API مباشرة (بدون Puppeteer) ──
async function scrapeNoonReviews(productUrl, maxCount) {
  const debugInfo = {};
  const capturedReviews = [];

  // ── استخرج SKU + locale من الرابط ──
  const skuMatch = productUrl.match(/\/reviews\/([A-Z][A-Z0-9]{10,})/i)
                || productUrl.match(/\/([A-Z][A-Z0-9]{10,})\/?(?:p\/|\?|$)/i);
  const sku = skuMatch?.[1]?.toUpperCase() || null;
  const localeMatch = productUrl.match(/noon\.com\/([\w-]+)\//);
  const urlLocale = localeMatch?.[1] || 'saudi-ar';

  debugInfo.detectedSku = sku;
  debugInfo.urlLocale = urlLocale;

  if (!sku) {
    debugInfo.error = 'Could not extract SKU from URL';
    return { reviews: [], debug: debugInfo };
  }

  // ── حوّل locale من رابط الموقع إلى صيغة API ──
  const LOCALE_MAP = {
    'saudi-ar': 'ar-sa', 'saudi-en': 'en-sa',
    'uae-ar':   'ar-ae', 'uae-en':   'en-ae',
    'egypt-ar': 'ar-eg', 'egypt-en': 'en-eg',
    'oman-ar':  'ar-om', 'oman-en':  'en-om',
    'kuwait-ar':'ar-kw', 'kuwait-en':'en-kw',
    'bahrain-ar':'ar-bh','bahrain-en':'en-bh',
    'jordan-ar':'ar-jo', 'jordan-en':'en-jo',
  };
  const apiLocale = LOCALE_MAP[urlLocale] || 'ar-sa';
  const pageSize  = Math.min(maxCount, 50);
  debugInfo.apiLocale = apiLocale;

  const referer = `https://www.noon.com/${urlLocale}/reviews/${sku}/`;
  const apiHeaders = {
    'User-Agent': SCRAPE_HEADERS['User-Agent'],
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'ar,en;q=0.9',
    'Referer': referer,
    'Origin': 'https://www.noon.com',
    'Cache-Control': 'no-cache',
  };

  // ── محاولة 1: Catalog API الرسمية ──
  const catalogUrl = `https://catalog.noon.com/v3/${apiLocale}/pdp/reviews/${sku}?page=1&pageSize=${pageSize}&sortBy=recent`;
  debugInfo.catalogUrl = catalogUrl;
  try {
    const res = await fetch(catalogUrl, {
      headers: apiHeaders,
      signal: AbortSignal.timeout(15000),
    });
    debugInfo.catalogStatus = res.status;
    if (res.ok) {
      const data = await res.json();
      debugInfo.catalogKeys = Object.keys(data || {});
      const rvArr = extractNoonReviewsFromData(data);
      if (rvArr.length > 0) {
        debugInfo.source = 'catalog-api';
        for (const rv of rvArr) {
          if (capturedReviews.length >= maxCount) break;
          capturedReviews.push(normalizeNoonReview(rv, apiLocale));
        }
      } else {
        debugInfo.catalogSample = JSON.stringify(data).slice(0, 400);
      }
    } else {
      debugInfo.catalogBody = await res.text().then(t => t.slice(0, 200)).catch(() => '');
    }
  } catch (e) {
    debugInfo.catalogError = e.message;
  }

  // ── محاولة 2: noon.com internal API route ──
  if (capturedReviews.length === 0) {
    // يجرّب مسارات API الداخلية المختلفة
    const internalUrls = [
      `https://www.noon.com/api/catalog/pdp/reviews/${sku}?page=1&pageSize=${pageSize}`,
      `https://www.noon.com/api/pdp/reviews?sku=${sku}&page=1&pageSize=${pageSize}&locale=${apiLocale}`,
      `https://www.noon.com/api/reviews?modelId=${sku}&page=1&pageSize=${pageSize}`,
    ];
    for (const apiUrl of internalUrls) {
      if (capturedReviews.length >= maxCount) break;
      try {
        debugInfo.tried = (debugInfo.tried || '') + apiUrl.split('/api/')[1]?.split('?')[0] + '; ';
        const res = await fetch(apiUrl, {
          headers: { ...apiHeaders, 'x-requested-with': 'XMLHttpRequest' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const rvArr = extractNoonReviewsFromData(data);
        if (rvArr.length > 0) {
          debugInfo.source = apiUrl;
          for (const rv of rvArr) {
            if (capturedReviews.length >= maxCount) break;
            capturedReviews.push(normalizeNoonReview(rv, apiLocale));
          }
          break;
        }
      } catch {}
    }
  }

  // ── محاولة 3: HTML fallback — ابحث في RSC stream عن بيانات التقييمات ──
  if (capturedReviews.length === 0) {
    try {
      const res = await fetch(referer, {
        headers: { ...SCRAPE_HEADERS, 'Referer': 'https://www.noon.com/' },
        signal: AbortSignal.timeout(20000),
        redirect: 'follow',
      });
      debugInfo.htmlStatus = res.status;
      if (res.ok) {
        const html = await res.text();
        debugInfo.htmlLength = html.length;
        // ابحث في RSC stream عن JSON يحتوي تقييمات
        const rscChunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)];
        debugInfo.rscChunks = rscChunks.length;
        for (const chunk of rscChunks) {
          try {
            const decoded = chunk[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            if (!decoded.includes('"rating"') && !decoded.includes('"review"')) continue;
            // جرب استخراج JSON من الـ RSC chunk
            const jsonMatches = decoded.matchAll(/(\{[^{}]{20,}"(?:rating|score)"[^{}]{0,500}\})/g);
            for (const jm of jsonMatches) {
              try {
                const obj = JSON.parse(jm[1]);
                if (obj.rating && (obj.body || obj.comment || obj.review || obj.text)) {
                  capturedReviews.push(normalizeNoonReview(obj, apiLocale));
                  if (capturedReviews.length >= maxCount) break;
                }
              } catch {}
            }
            if (capturedReviews.length > 0) {
              debugInfo.source = 'rsc-stream';
              break;
            }
          } catch {}
        }
        if (capturedReviews.length === 0) {
          // أظهر معلومات تشخيصية
          const lc = html.toLowerCase();
          const ri = lc.indexOf('"rating"');
          debugInfo.ratingContext = ri >= 0 ? html.slice(Math.max(0, ri-30), ri+200) : 'not found';
          debugInfo.htmlSnippet = html.slice(0, 600);
        }
      }
    } catch (e) {
      debugInfo.htmlError = e.message;
    }
  }

  debugInfo.reviewsFound = capturedReviews.length;
  return { reviews: capturedReviews.slice(0, maxCount), debug: debugInfo };
}

// ── استخرج مصفوفة التقييمات من أي بنية استجابة Noon ──
function extractNoonReviewsFromData(data) {
  if (!data || typeof data !== 'object') return [];
  // جرّب مسارات شائعة في Catalog API
  const candidates = [
    data?.results?.reviews,
    data?.data?.reviews,
    data?.reviews,
    data?.catalog?.reviews?.items,
    data?.catalog?.reviews,
    data?.results?.items,
    data?.items,
    data?.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      const f = c[0];
      if (f && typeof f === 'object' &&
          ('rating' in f || 'score' in f || 'stars' in f ||
           'review' in f || 'body' in f || 'comment' in f)) {
        return c;
      }
    }
  }
  return [];
}

// ── تطبيع تقييم Noon من Catalog API أو أي بنية JSON ──
function normalizeNoonReview(rv, apiLocale) {
  const rating  = parseFloat(rv.rating ?? rv.score ?? rv.stars ?? rv.rate ?? rv.value ?? 5);
  const author  = String(
    rv.author ?? rv.authorName ?? rv.name ?? rv.userName
    ?? rv.user?.name ?? rv.user?.displayName ?? rv.reviewer
    ?? rv.customer ?? rv.displayName ?? 'عميل'
  ).trim();
  const comment = String(
    rv.body ?? rv.comment ?? rv.review ?? rv.text
    ?? rv.content ?? rv.description ?? rv.message ?? ''
  ).trim();

  // صور التقييم — Noon Catalog يعيدها كـ keys تُبنى مع CDN
  const CDN_BASE = 'https://f.nooncdn.com/review/';
  const rawImgs = rv.images ?? rv.photos ?? rv.attachments ?? rv.media ?? rv.pictures ?? [];
  const images  = (Array.isArray(rawImgs) ? rawImgs : [])
    .map(i => {
      if (typeof i === 'string') {
        // إذا كان key فقط (بدون http) أضف CDN base
        return i.startsWith('http') ? i : CDN_BASE + i;
      }
      const raw = i?.url ?? i?.src ?? i?.path ?? i?.uri ?? i?.key ?? '';
      return raw.startsWith('http') ? raw : (raw ? CDN_BASE + raw : '');
    })
    .filter(Boolean);

  return { author, rating, comment, images, daysAgo: 0 };
}

// ── scrapeJsonLdReviews — يستخرج التقييمات من JSON-LD في أي صفحة منتج ──
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeExternalImageUrl(raw, baseUrl = "") {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function parseReviewDateTimestamp(value) {
  const normalized = String(value || "").trim().replace(/\//g, "-");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

async function scrapeNiceOneReviews(productUrl, maxCount) {
  const debugInfo = { method: "niceone-puppeteer" };
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    await page.setBypassCSP(true);
    await page.setViewport({ width: 1366, height: 2200, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "ar-SA,ar;q=0.9,en;q=0.8" });
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 45000 });

    await page.addScriptTag({
      content: `
        window.__btExtractNiceOneReviews = function(limit) {
          const dateRe = /\\b20\\d{2}[\\/-]\\d{1,2}[\\/-]\\d{1,2}\\b/;
          const controls = ['مفيد', 'ارسال رد', 'إرسال رد', 'عرض المزيد', 'اكتب تقيمك', 'اكتب تقييمك', 'الرجاء تحديد', 'Helpful', 'Reply', 'Show more', 'Load more'];
          const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
          const linesOf = (el) => (el.innerText || '').split(/\\n+/).map(clean).filter(Boolean);
          const isControl = (s) => controls.some((w) => s.includes(w)) || /^\\(\\d+\\)\\(\\d+\\)$/.test(s);
          const nodes = [...document.querySelectorAll('article,li,section,div')];
          const candidates = nodes.filter((el) => {
            const text = el.innerText || '';
            return dateRe.test(text) && (text.includes('مفيد') || text.includes('ارسال رد') || text.includes('Helpful') || text.includes('Reply'));
          });
          const cards = candidates.filter((el) => ![...el.children].some((child) => dateRe.test(child.innerText || '')));
          const out = [];
          const seen = new Set();
          for (const card of cards) {
            const lines = linesOf(card);
            const dateIndex = lines.findIndex((line) => dateRe.test(line));
            if (dateIndex < 1) continue;
            const date = lines[dateIndex].match(dateRe)?.[0] || '';
            let author = '';
            for (let i = dateIndex - 1; i >= 0; i--) {
              if (!isControl(lines[i]) && !dateRe.test(lines[i])) { author = lines[i]; break; }
            }
            const commentLines = [];
            for (let i = dateIndex + 1; i < lines.length; i++) {
              if (isControl(lines[i]) || dateRe.test(lines[i])) break;
              commentLines.push(lines[i]);
            }
            const comment = clean(commentLines.join(' '));
            if (!author && !comment) continue;
            const images = [...card.querySelectorAll('img')]
              .map((img) => img.currentSrc || img.src || img.getAttribute('data-src') || '')
              .filter((src) => /\\/image\\/reviews\\//i.test(src));
            const key = clean(author).toLowerCase() + '|' + comment.slice(0, 120).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ author, rating: 5, comment, images: [...new Set(images)], date, daysAgo: 0 });
            if (out.length >= limit) break;
          }
          return out;
        };
      `
    });

    let previousCount = 0;
    let stagnantRounds = 0;
    for (let round = 0; round < 24; round++) {
      const count = await page.evaluate((limit) => window.__btExtractNiceOneReviews(limit).length, maxCount);
      debugInfo[`round${round}_count`] = count;
      if (count >= maxCount) break;

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(650);

      const clicked = await page.evaluate(() => {
        const words = ["عرض المزيد", "Show more", "Load more", "View more"];
        const nodes = [...document.querySelectorAll("button,a,div[role='button']")];
        const btn = nodes.find((el) => {
          const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
          if (!text) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && words.some((w) => text.includes(w));
        });
        if (!btn) return false;
        btn.scrollIntoView({ block: "center" });
        btn.click();
        return true;
      });
      debugInfo[`round${round}_clicked`] = clicked;
      await sleep(clicked ? 1200 : 700);

      const nextCount = await page.evaluate((limit) => window.__btExtractNiceOneReviews(limit).length, maxCount);
      if (nextCount <= previousCount) stagnantRounds += 1;
      else stagnantRounds = 0;
      previousCount = nextCount;
      if (!clicked && stagnantRounds >= 2) break;
    }

    const reviews = await page.evaluate((limit) => window.__btExtractNiceOneReviews(limit), maxCount);
    debugInfo.reviewsFound = reviews.length;
    return {
      reviews: reviews.slice(0, maxCount).map((rv) => ({
        ...rv,
        images: (rv.images || []).map((u) => normalizeExternalImageUrl(u, productUrl)).filter(Boolean),
        dateTimestamp: parseReviewDateTimestamp(rv.date)
      })),
      debug: debugInfo
    };
  } catch (e) {
    debugInfo.error = e.message;
    return { reviews: [], debug: debugInfo };
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
}

async function scrapeJsonLdReviews(productUrl, maxCount) {
  const debugInfo = { method: 'json-ld' };
  const reviews = [];

  let html = '';
  try {
    const res = await fetch(productUrl, {
      headers: { ...SCRAPE_HEADERS, 'Accept': 'text/html,application/xhtml+xml,*/*' },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });
    debugInfo.httpStatus = res.status;
    if (!res.ok) {
      debugInfo.error = `HTTP ${res.status}`;
      return { reviews: [], debug: debugInfo };
    }
    html = await res.text();
  } catch (e) {
    debugInfo.fetchError = e.message;
    return { reviews: [], debug: debugInfo };
  }

  debugInfo.htmlLength = html.length;

  // ── استخرج كل كتل JSON-LD ──
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  debugInfo.jsonLdBlocks = blocks.length;

  for (const block of blocks) {
    let data;
    try { data = JSON.parse(block[1].trim()); } catch { continue; }

    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      // قبل Product مباشرة، جرّب أيضاً Graph
      const candidates = item['@type'] === 'Product'
        ? [item]
        : (item['@graph'] || []).filter(n => n['@type'] === 'Product');

      for (const product of candidates) {
        const rvArr = Array.isArray(product.review)
          ? product.review
          : product.review ? [product.review] : [];

        debugInfo.productName = product.name || '';
        debugInfo.reviewsInJsonLd = rvArr.length;

        for (const rv of rvArr) {
          if (reviews.length >= maxCount) break;
          const rating  = parseFloat(rv.reviewRating?.ratingValue ?? rv.starRating?.ratingValue ?? 5);
          const author  = String(rv.author?.name ?? rv.author ?? rv.name ?? 'عميل').trim();
          const comment = String(rv.reviewBody ?? rv.description ?? rv.text ?? '').trim();

          // ── تحويل datePublished → timestamp (يدعم 2026/04/18 و 2026-04-18) ──
          const dateStr = rv.datePublished ?? rv.dateCreated ?? rv.date ?? null;
          let dateTimestamp = null;
          if (dateStr) {
            const normalized = String(dateStr).replace(/\//g, '-');
            const parsed = Date.parse(normalized);
            if (!isNaN(parsed)) dateTimestamp = parsed;
          }

          // ── استخرج صور التقييم إن وُجدت ──
          const rawImages = [];
          if (rv.image) {
            const imgs = Array.isArray(rv.image) ? rv.image : [rv.image];
            for (const img of imgs) {
              const imgUrl = typeof img === 'string' ? img : (img?.url ?? img?.contentUrl ?? '');
              if (imgUrl && imgUrl.startsWith('http')) rawImages.push(imgUrl);
            }
          }

          reviews.push({
            author,
            rating: isNaN(rating) ? 5 : rating,
            comment,
            images: rawImages,
            daysAgo: 0,
            dateTimestamp,
            verified: false,
          });
        }
        if (reviews.length > 0) break;
      }
      if (reviews.length > 0) break;
    }
    if (reviews.length > 0) break;
  }

  // تشخيص إذا لم نجد شيئاً
  if (reviews.length === 0) {
    const lc = html.toLowerCase();
    const ri = lc.indexOf('"reviewbody"');
    debugInfo.reviewContext = ri >= 0 ? html.slice(Math.max(0, ri - 30), ri + 200) : 'not found';
    debugInfo.htmlSnippet = html.slice(0, 500);
  }

  debugInfo.reviewsFound = reviews.length;
  return { reviews: reviews.slice(0, maxCount), debug: debugInfo };
}

// ── POST /api/bt-reviews/admin/scrape ──
app.post("/api/bt-reviews/admin/scrape", requirePack, express.json(), async (req, res) => {
  const { productId, productName, url, maxCount = 20 } = req.body || {};
  if (!productId || !url) {
    return res.status(400).json({ ok: false, error: "productId and url are required" });
  }

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch {
    return res.status(400).json({ ok: false, error: "Invalid URL" });
  }

  const isAmazon = parsedUrl.hostname.includes('amazon');
  const isNoon   = parsedUrl.hostname.includes('noon');
  // أي موقع آخر → نجرّب JSON-LD

  try {
    const cap = Math.min(Math.max(1, parseInt(maxCount) || 20), 50);
    const result = isAmazon
      ? await scrapeAmazonReviews(url, cap)
      : isNoon
      ? await scrapeNoonReviews(url, cap)
      : await scrapeJsonLdReviews(url, cap);

    const scraped = result.reviews || [];
    const debugInfo = result.debug || {};

    if (!scraped.length) {
      return res.json({ ok: true, reviews: [], debug: debugInfo });
    }

    const r = await getRedis();
    if (!r) return res.status(500).json({ ok: false, error: "Redis unavailable" });

    // ── بناء بصمات الموجودين للكشف عن المكررة ──
    const existingIds = await r.zRange(RV_KEY_PRODUCT(String(productId)), 0, -1);
    const existingFingerprints = new Set();
    for (const eid of existingIds) {
      const eh = await r.hGetAll(RV_KEY_ITEM(eid));
      if (!eh) continue;
      const fp = `${String(eh.author||'').trim().toLowerCase()}|${String(eh.comment||'').trim().toLowerCase().slice(0,120)}`;
      existingFingerprints.add(fp);
    }

    // ── أرجع التقييمات مع علامة duplicate — بدون حفظ ──
    const previews = scraped.map(rv => {
      const author  = String(rv.author  || "");
      const comment = String(rv.comment || "");
      const fp = `${author.trim().toLowerCase()}|${comment.trim().toLowerCase().slice(0,120)}`;
      return {
        author, comment,
        rating:        rv.rating || 5,
        images:        rv.images || [],
        dateTimestamp: rv.dateTimestamp || null,
        duplicate:     existingFingerprints.has(fp),
      };
    });

    return res.json({ ok: true, reviews: previews, debug: debugInfo });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Scrape failed" });
  }
});

// ── POST /api/bt-reviews/admin/scrape/save — حفظ التقييمات المختارة ──
app.post("/api/bt-reviews/admin/scrape/save", requirePack, express.json(), async (req, res) => {
  const { productId, productName, reviews: selected } = req.body || {};
  if (!productId || !Array.isArray(selected) || !selected.length)
    return res.status(400).json({ ok: false, error: "productId and reviews[] required" });

  const r = await getRedis();
  if (!r) return res.status(500).json({ ok: false, error: "Redis unavailable" });

  // بناء بصمات الموجودين (ضمان عدم التكرار حتى لو أُرسل نفس التقييم مرتين)
  const existingIds = await r.zRange(RV_KEY_PRODUCT(String(productId)), 0, -1);
  const existingFingerprints = new Set();
  for (const eid of existingIds) {
    const eh = await r.hGetAll(RV_KEY_ITEM(eid));
    if (!eh) continue;
    const fp = `${String(eh.author||'').trim().toLowerCase()}|${String(eh.comment||'').trim().toLowerCase().slice(0,120)}`;
    existingFingerprints.add(fp);
  }

  const saved = [];
  const skipped = [];

  for (const rv of selected) {
    const author  = String(rv.author  || "").trim();
    const comment = String(rv.comment || "").trim();
    const fp      = `${author.toLowerCase()}|${comment.toLowerCase().slice(0,120)}`;
    const dedupKey = RV_KEY_DEDUP(productId, author, comment);

    if (existingFingerprints.has(fp) || await r.exists(dedupKey)) {
      skipped.push(author);
      continue;
    }

    // رفع الصور إلى Cloudinary
    const photos = [];
    for (const rawImgUrl of (rv.images || [])) {
      try {
        const imgUrl = normalizeExternalImageUrl(rawImgUrl);
        if (!imgUrl) continue;
        const imgRes = await fetch(imgUrl, {
          headers: {
            ...SCRAPE_HEADERS,
            Referer: "https://niceonesa.com/"
          },
          signal: AbortSignal.timeout(15000),
          redirect: "follow"
        });
        if (!imgRes.ok) continue;
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const up  = await uploadToCloudinary(buf, "bt-reviews");
        photos.push({ url: up.url, publicId: up.publicId });
      } catch {}
    }

    const id       = reviewIdGen();
    const ts       = rv.dateTimestamp || Date.now();
    const ratingInt = Math.max(1, Math.min(5, Math.round(Number(rv.rating) || 5)));

    const data = {
      id,
      productId:   String(productId),
      productName: String(productName || ""),
      rating:      String(ratingInt),
      comment, author,
      email: "", orderId: "",
      photos:    JSON.stringify(photos),
      verified:  "true",
      createdAt: String(ts),
      updatedAt: String(Date.now()),
      status:    "approved"
    };

    await r.hSet(RV_KEY_ITEM(id), data);
    await r.zAdd(RV_KEY_PRODUCT(String(productId)), { score: ts, value: id });
    await r.zAdd(RV_KEY_ALL, { score: ts, value: id });
    await r.hIncrBy(RV_KEY_SUMMARY(String(productId)), "count", 1);
    await r.hIncrBy(RV_KEY_SUMMARY(String(productId)), "sum", ratingInt);
    await r.set(dedupKey, '1');
    existingFingerprints.add(fp);

    saved.push({ id, author, rating: ratingInt });
  }

  return res.json({ ok: true, saved: saved.length, skipped: skipped.length });
});

app.listen(PORT, () => {
  console.log("✅ Driver panel running on port " + PORT);
});
 
