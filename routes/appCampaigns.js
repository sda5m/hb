import express from "express";
import multer from "multer";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v2 as cloudinary } from "cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.join(DATA_DIR, "app_campaigns.json");

const DEFAULT_DATA = {
  update: {
    enabled: true,
    minBuild: 0,
    latestBuild: 0,
    androidMinBuild: 0,
    androidLatestBuild: 0,
    iosMinBuild: 0,
    iosLatestBuild: 0,
    forceUpdate: false,
    androidUrl: "https://play.google.com/store/apps/details?id=com.btime.app",
    iosUrl: "https://halabt.com",
    titleAr: "\u062a\u062d\u062f\u064a\u062b \u062c\u062f\u064a\u062f \u0645\u062a\u0648\u0641\u0631",
    bodyAr: "\u062d\u062f\u0651\u062b \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0644\u0644\u0627\u0633\u062a\u0641\u0627\u062f\u0629 \u0645\u0646 \u0627\u0644\u062e\u062f\u0645\u0627\u062a \u0627\u0644\u062c\u062f\u064a\u062f\u0629 \u0648\u062a\u062c\u0631\u0628\u0629 \u0623\u0633\u0631\u0639 \u0648\u0623\u0643\u062b\u0631 \u0633\u0644\u0627\u0633\u0629.",
    titleEn: "New update available",
    bodyEn: "Update the app to enjoy the latest services and improvements."
  },
  campaigns: []
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function clean(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function customerNumericId(value) {
  const raw = String(value || "").trim();
  return raw.includes("/") ? raw.split("/").pop() || raw : raw;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isActive(campaign, now = new Date()) {
  if (!campaign?.enabled) return false;
  const startAt = parseDate(campaign.startAt);
  const endAt = parseDate(campaign.endAt);
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

function matchesAudience(campaign, query) {
  const audience = campaign.audience || "all";
  if (audience === "all") return true;

  const customerId = clean(query.customerId || query.customer_id, 140);
  const customerEmail = clean(query.email || query.customerEmail, 200).toLowerCase();
  const country = clean(query.country || query.countryCode, 8).toUpperCase();

  if (audience === "customer") {
    const targetId = clean(campaign.customerId, 140);
    const targetEmail = clean(campaign.customerEmail, 200).toLowerCase();
    return (
      (targetId && customerNumericId(targetId) === customerNumericId(customerId)) ||
      (targetEmail && targetEmail === customerEmail)
    );
  }

  if (audience === "country") {
    return clean(campaign.countryCode, 8).toUpperCase() === country;
  }

  return false;
}

async function readData() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return {
      ...DEFAULT_DATA,
      ...data,
      update: { ...DEFAULT_DATA.update, ...(data.update || {}) },
      campaigns: Array.isArray(data.campaigns) ? data.campaigns : []
    };
  } catch {
    return { ...DEFAULT_DATA, campaigns: [] };
  }
}

async function writeData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

async function uploadImage(file) {
  if (!file?.buffer?.length) return null;
  return await new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        { folder: "bt/app-campaigns", resource_type: "image" },
        (err, result) => {
          if (err) return reject(err);
          resolve({ url: result.secure_url, publicId: result.public_id });
        }
      )
      .end(file.buffer);
  });
}

function normalizeCampaign(body, image) {
  const existing = body.existing ? JSON.parse(body.existing) : {};
  const id =
    clean(body.id, 80) ||
    existing.id ||
    `camp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    ...existing,
    id,
    enabled: bool(body.enabled, existing.enabled ?? true),
    type: clean(body.type, 30) || existing.type || "bottom_notice",
    audience: clean(body.audience, 30) || existing.audience || "all",
    customerId: clean(body.customerId, 140) || "",
    customerEmail: clean(body.customerEmail, 200) || "",
    countryCode: clean(body.countryCode, 8).toUpperCase(),
    titleAr: clean(body.titleAr, 140),
    bodyAr: clean(body.bodyAr, 900),
    titleEn: clean(body.titleEn, 140),
    bodyEn: clean(body.bodyEn, 900),
    buttonAr: clean(body.buttonAr, 80),
    buttonEn: clean(body.buttonEn, 80),
    scratchHintAr: clean(body.scratchHintAr, 80),
    scratchHintEn: clean(body.scratchHintEn, 80),
    copiedTextAr: clean(body.copiedTextAr, 80),
    copiedTextEn: clean(body.copiedTextEn, 80),
    link: clean(body.link, 500),
    coupon: clean(body.coupon, 80).toUpperCase(),
    imageUrl: image?.url || clean(body.imageUrl, 500) || existing.imageUrl || "",
    imagePublicId: image?.publicId || existing.imagePublicId || "",
    imageHeight: number(body.imageHeight, existing.imageHeight || 150),
    scratchHeight: number(body.scratchHeight, existing.scratchHeight || 84),
    position: clean(body.position, 20) || existing.position || "bottom",
    backgroundColor: clean(body.backgroundColor, 20) || existing.backgroundColor || "#6B0083",
    panelColor: clean(body.panelColor, 20) || existing.panelColor || "#FFFFFF",
    textColor: clean(body.textColor, 20) || existing.textColor || "#FFFFFF",
    iconBackgroundColor:
      clean(body.iconBackgroundColor, 20) || existing.iconBackgroundColor || "#FDD8C2",
    iconColor: clean(body.iconColor, 20) || existing.iconColor || "#6B0083",
    opacity: Math.max(0.35, Math.min(1, number(body.opacity, existing.opacity || 1))),
    panelOpacity: Math.max(0.05, Math.min(1, number(body.panelOpacity, existing.panelOpacity || 1))),
    panelRadius: Math.max(8, Math.min(34, number(body.panelRadius, existing.panelRadius || 22))),
    panelPadding: Math.max(0, Math.min(28, number(body.panelPadding, existing.panelPadding || 14))),
    modalWidth: Math.max(260, Math.min(430, number(body.modalWidth, existing.modalWidth || 360))),
    imageTopTilt: Math.max(-42, Math.min(42, number(body.imageTopTilt, existing.imageTopTilt || 0))),
    imageBottomTilt: Math.max(-42, Math.min(42, number(body.imageBottomTilt, existing.imageBottomTilt || 0))),
    startAt: clean(body.startAt, 40),
    endAt: clean(body.endAt, 40),
    showRule: clean(body.showRule, 40) || existing.showRule || "once_per_campaign",
    priority: number(body.priority, existing.priority || 0),
    updatedAt: nowIso(),
    createdAt: existing.createdAt || nowIso()
  };
}

export default function appCampaignsRouter({ admin = false } = {}) {
  const router = express.Router();

  router.get("/app-campaigns", async (req, res) => {
    try {
      const data = await readData();
      const lang = clean(req.query.lang, 8) || "ar";
      const build = number(req.query.build, 0);
      const platform = clean(req.query.platform, 32).toLowerCase();
      const activeCampaigns = data.campaigns
        .filter((campaign) => isActive(campaign))
        .filter((campaign) => matchesAudience(campaign, req.query))
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
        .slice(0, 5);

      const updateData = data.update || {};
      const isIos = platform.includes("ios");
      const minBuild = isIos
        ? number(updateData.iosMinBuild, number(updateData.minBuild, 0))
        : number(updateData.androidMinBuild, number(updateData.minBuild, 0));
      const latestBuild = isIos
        ? number(updateData.iosLatestBuild, number(updateData.latestBuild, 0))
        : number(updateData.androidLatestBuild, number(updateData.latestBuild, 0));
      const update = data.update?.enabled
        ? {
            ...data.update,
            minBuild,
            latestBuild,
            required: build > 0 && minBuild > build,
            available: build > 0 && latestBuild > build,
            lang
          }
        : { enabled: false, required: false, available: false };

      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        serverTime: nowIso(),
        update,
        campaigns: activeCampaigns
      });
    } catch (e) {
      console.error("app-campaigns public error", e);
      res.status(500).json({ ok: false, error: e?.message || "failed" });
    }
  });

  if (admin) {
    router.get("/app-campaigns/admin", async (_req, res) => {
      const data = await readData();
      res.json({ ok: true, ...data });
    });

    router.post("/app-campaigns/update", async (req, res) => {
      const data = await readData();
      data.update = {
        ...data.update,
        enabled: bool(req.body.enabled, data.update.enabled),
        minBuild: number(req.body.minBuild, data.update.minBuild),
        latestBuild: number(req.body.latestBuild, data.update.latestBuild),
        androidMinBuild: number(req.body.androidMinBuild, data.update.androidMinBuild ?? data.update.minBuild),
        androidLatestBuild: number(req.body.androidLatestBuild, data.update.androidLatestBuild ?? data.update.latestBuild),
        iosMinBuild: number(req.body.iosMinBuild, data.update.iosMinBuild ?? data.update.minBuild),
        iosLatestBuild: number(req.body.iosLatestBuild, data.update.iosLatestBuild ?? data.update.latestBuild),
        forceUpdate: bool(req.body.forceUpdate, data.update.forceUpdate),
        androidUrl: clean(req.body.androidUrl, 500) || data.update.androidUrl,
        iosUrl: clean(req.body.iosUrl, 500) || data.update.iosUrl,
        titleAr: clean(req.body.titleAr, 160) || data.update.titleAr,
        bodyAr: clean(req.body.bodyAr, 900) || data.update.bodyAr,
        titleEn: clean(req.body.titleEn, 160) || data.update.titleEn,
        bodyEn: clean(req.body.bodyEn, 900) || data.update.bodyEn,
        updatedAt: nowIso()
      };
      await writeData(data);
      res.json({ ok: true, update: data.update });
    });

    router.post("/app-campaigns/campaign", upload.single("image"), async (req, res) => {
      const data = await readData();
      const image = await uploadImage(req.file);
      const campaign = normalizeCampaign(req.body, image);
      const index = data.campaigns.findIndex((item) => item.id === campaign.id);
      if (index >= 0) {
        data.campaigns[index] = campaign;
      } else {
        data.campaigns.unshift(campaign);
      }
      await writeData(data);
      res.json({ ok: true, campaign });
    });

    router.post("/app-campaigns/campaign/:id/delete", async (req, res) => {
      const data = await readData();
      const id = clean(req.params.id, 100);
      data.campaigns = data.campaigns.filter((item) => item.id !== id);
      await writeData(data);
      res.json({ ok: true });
    });
  }

  router.post("/app-campaigns/event", async (req, res) => {
    const data = await readData();
    const campaignId = clean(req.body?.campaignId, 100);
    const event = clean(req.body?.event, 40) || "view";
    const campaign = data.campaigns.find((item) => item.id === campaignId);
    if (campaign) {
      campaign.stats = campaign.stats || {};
      campaign.stats[event] = Number(campaign.stats[event] || 0) + 1;
      campaign.stats.lastEventAt = nowIso();
      await writeData(data);
    }
    res.json({ ok: true });
  });

  return router;
}
