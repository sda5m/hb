import express from "express";

const REDIS_KEY = "bt:auto-notification-templates:v1";

const DEFAULT_TEMPLATES = [
  {
    key: "order_created",
    descriptionAr: "يظهر عندما يصل طلب جديد إلى لوحة التجهيز.",
    titleAr: "طلب جديد",
    bodyAr: "وصل طلب جديد من {{customer_name}} برقم {{order_number}}.",
    titleEn: "New order",
    bodyEn: "A new order from {{customer_name}} has arrived: {{order_number}}."
  },
  {
    key: "order_shipped",
    descriptionAr: "يرسل للعميل عندما يتم شحن الطلب أو إضافة بيانات الشحن.",
    titleAr: "تم شحن طلبك",
    bodyAr: "طلبك {{order_number}} تم شحنه. يمكنك متابعة التتبع من التطبيق.",
    titleEn: "Your order has shipped",
    bodyEn: "Your order {{order_number}} has shipped. You can track it in the app."
  },
  {
    key: "out_for_delivery",
    descriptionAr: "يرسل عندما تكون الشحنة خرجت للتوصيل.",
    titleAr: "طلبك خرج للتوصيل",
    bodyAr: "طلبك {{order_number}} خرج للتوصيل وسيصلك قريباً.",
    titleEn: "Out for delivery",
    bodyEn: "Your order {{order_number}} is out for delivery and will arrive soon."
  },
  {
    key: "delivered",
    descriptionAr: "يرسل عند استلام الطلب ويستخدم أيضاً كنقطة بداية لحساب نقاط الطلب.",
    titleAr: "شكراً لاستلامك الطلب",
    bodyAr: "تم استلام طلبك {{order_number}}. حصلت على {{points}} نقطة.",
    titleEn: "Thanks for receiving your order",
    bodyEn: "Your order {{order_number}} was received. You earned {{points}} points."
  },
  {
    key: "order_cancelled",
    descriptionAr: "يرسل إذا تم إلغاء الطلب.",
    titleAr: "تم إلغاء الطلب",
    bodyAr: "تم إلغاء طلبك {{order_number}}. {{reason}}",
    titleEn: "Order cancelled",
    bodyEn: "Your order {{order_number}} was cancelled. {{reason}}"
  },
  {
    key: "wallet_credit_added",
    descriptionAr: "يرسل عند إضافة رصيد إلى محفظة العميل.",
    titleAr: "تمت إضافة رصيد",
    bodyAr: "تمت إضافة {{amount}} إلى محفظتك.",
    titleEn: "Wallet credit added",
    bodyEn: "{{amount}} was added to your wallet."
  },
  {
    key: "reward_points_added",
    descriptionAr: "يرسل عند إضافة نقاط للعميل من طلب أو تقييم.",
    titleAr: "تمت إضافة نقاط",
    bodyAr: "حصلت على {{points}} نقطة بسبب {{reason}}.",
    titleEn: "Points added",
    bodyEn: "You earned {{points}} points for {{reason}}."
  },
  {
    key: "reward_points_deducted",
    descriptionAr: "يرسل عند خصم نقاط بسبب إلغاء طلب أو عكس حركة.",
    titleAr: "تم خصم نقاط",
    bodyAr: "تم خصم {{points}} نقطة بسبب {{reason}}.",
    titleEn: "Points deducted",
    bodyEn: "{{points}} points were deducted for {{reason}}."
  },
  {
    key: "review_reward",
    descriptionAr: "يرسل عندما يحصل العميل على نقاط بسبب تقييم منتج.",
    titleAr: "شكراً على تقييمك",
    bodyAr: "حصلت على {{points}} نقطة بعد تقييم {{product_title}}.",
    titleEn: "Thanks for your review",
    bodyEn: "You earned {{points}} points for reviewing {{product_title}}."
  }
];

function normalizeTemplate(row = {}) {
  return {
    key: String(row.key || "").trim(),
    descriptionAr: String(row.descriptionAr || "").trim(),
    titleAr: String(row.titleAr || "").trim(),
    bodyAr: String(row.bodyAr || "").trim(),
    titleEn: String(row.titleEn || "").trim(),
    bodyEn: String(row.bodyEn || "").trim()
  };
}

function mergeTemplates(saved = []) {
  const map = new Map();
  for (const item of DEFAULT_TEMPLATES) {
    map.set(item.key, normalizeTemplate(item));
  }
  for (const item of saved) {
    const tpl = normalizeTemplate(item);
    if (!tpl.key) continue;
    map.set(tpl.key, { ...(map.get(tpl.key) || {}), ...tpl });
  }
  return Array.from(map.values());
}

async function readTemplates(redis) {
  const raw = await redis.get(REDIS_KEY).catch(() => "");
  if (!raw) return mergeTemplates([]);
  try {
    const rows = JSON.parse(raw);
    return mergeTemplates(Array.isArray(rows) ? rows : []);
  } catch (_) {
    return mergeTemplates([]);
  }
}

async function writeTemplates(redis, rows) {
  const normalized = mergeTemplates(rows);
  await redis.set(REDIS_KEY, JSON.stringify(normalized));
  return normalized;
}

export async function getAutoNotificationTemplate(redis, key, locale = "ar", vars = {}) {
  const templates = await readTemplates(redis);
  const template = templates.find((item) => item.key === key);
  if (!template) return null;
  const isEn = String(locale || "").toLowerCase().startsWith("en");
  const replaceVars = (value) =>
    String(value || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
      const next = vars?.[name];
      return next === undefined || next === null ? "" : String(next);
    });
  return {
    key,
    title: replaceVars(isEn ? template.titleEn : template.titleAr),
    body: replaceVars(isEn ? template.bodyEn : template.bodyAr),
    titleAr: replaceVars(template.titleAr),
    bodyAr: replaceVars(template.bodyAr),
    titleEn: replaceVars(template.titleEn),
    bodyEn: replaceVars(template.bodyEn)
  };
}

export default function autoNotificationTemplatesRouter(deps = {}) {
  const router = express.Router();
  const getRedis = deps.getRedis;

  router.get("/auto-notifications/templates", async (req, res) => {
    try {
      if (typeof getRedis !== "function") {
        return res.status(500).json({ error: "Redis dependency is not configured" });
      }
      const redis = await getRedis();
      if (!redis) return res.status(500).json({ error: "Redis is not ready" });
      return res.json({ ok: true, templates: await readTemplates(redis) });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "Failed to load templates" });
    }
  });

  router.put("/auto-notifications/templates/:key", async (req, res) => {
    try {
      if (typeof getRedis !== "function") {
        return res.status(500).json({ error: "Redis dependency is not configured" });
      }
      const redis = await getRedis();
      if (!redis) return res.status(500).json({ error: "Redis is not ready" });
      const key = String(req.params.key || "").trim();
      const rows = await readTemplates(redis);
      const next = normalizeTemplate({ ...req.body, key });
      const index = rows.findIndex((item) => item.key === key);
      if (index >= 0) rows[index] = { ...rows[index], ...next };
      else rows.push(next);
      const templates = await writeTemplates(redis, rows);
      return res.json({ ok: true, template: templates.find((item) => item.key === key) });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "Failed to save template" });
    }
  });

  router.post("/auto-notifications/templates/reset", async (req, res) => {
    try {
      if (typeof getRedis !== "function") {
        return res.status(500).json({ error: "Redis dependency is not configured" });
      }
      const redis = await getRedis();
      if (!redis) return res.status(500).json({ error: "Redis is not ready" });
      await redis.del(REDIS_KEY);
      return res.json({ ok: true, templates: mergeTemplates([]) });
    } catch (e) {
      return res.status(500).json({ error: e?.message || "Failed to reset templates" });
    }
  });

  return router;
}
