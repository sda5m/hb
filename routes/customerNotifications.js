import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";

export default function customerNotificationsRouter(deps = {}) {
  const router = express.Router();
  const getRedis = deps.getRedis;
  const getFirebaseAdmin = deps.getFirebaseAdmin;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }
  });

  function text(value, max = 500) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function customerNumericId(customerId) {
    const raw = String(customerId || "").trim();
    return raw.includes("/") ? raw.split("/").pop() || raw : raw;
  }

  function notificationKey(customerId) {
    return `bt:user:notifications:${customerNumericId(customerId)}`;
  }

  function notificationForLocale(item, payload, id) {
    const lang = String(item.locale || "").toLowerCase().startsWith("en")
      ? "en"
      : "ar";
    const title =
      lang === "en"
        ? (payload.titleEn || payload.titleAr || payload.title)
        : (payload.titleAr || payload.titleEn || payload.title);
    const body =
      lang === "en"
        ? (payload.bodyEn || payload.bodyAr || payload.body)
        : (payload.bodyAr || payload.bodyEn || payload.body);
    return {
      id,
      title,
      body,
      seen: false,
      date: new Date().toISOString(),
      additionalData: {
        type: "manual_notification",
        id: payload.id || "",
        dynamic_link: payload.link || "https://app.halabt.com/",
        title_ar: payload.titleAr || payload.title,
        body_ar: payload.bodyAr || payload.body,
        title_en: payload.titleEn || payload.title,
        body_en: payload.bodyEn || payload.body,
        image: payload.imageUrl || "",
        link: payload.link || ""
      }
    };
  }

  async function saveCustomerNotification(redis, item, payload, id) {
    const customerId = customerNumericId(item.customerId);
    if (!customerId) return;
    const data = notificationForLocale(item, payload, id);
    const key = notificationKey(customerId);
    await redis.lPush(key, JSON.stringify(data));
    await redis.lTrim(key, 0, 99);
    await redis.expire(key, 60 * 60 * 24 * 120);
  }

  async function uploadImage(file) {
    if (!file?.buffer?.length) return null;
    return await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { folder: "bt/notifications", resource_type: "image" },
          (err, result) => {
            if (err) return reject(err);
            resolve({
              url: result.secure_url,
              publicId: result.public_id
            });
          }
        )
        .end(file.buffer);
    });
  }

  async function getAllPushTokens(redis) {
    const tokens = [];
    const seen = new Set();
    let keys = [];

    if (typeof redis.scanIterator === "function") {
      for await (const key of redis.scanIterator({
        MATCH: "bt:user:push:*",
        COUNT: 500
      })) {
        keys.push(key);
      }
    } else if (typeof redis.keys === "function") {
      keys = await redis.keys("bt:user:push:*");
    }

    for (const key of keys) {
      const token = await redis.get(key).catch(() => "");
      if (!token || seen.has(token)) continue;
      seen.add(token);
      const customerId = key.replace(/^bt:user:push:/, "");
      const numericId = customerNumericId(customerId);
      const locale = await redis.get(`bt:user:push-locale:${numericId}`).catch(() => "");
      tokens.push({ key, token, customerId, locale });
    }

    return tokens;
  }

  async function getCustomerPushTokens(redis, customerId) {
    const numericId = customerNumericId(customerId);
    const keys = [
      `bt:user:push:${numericId}`,
      `bt:user:push:gid://shopify/Customer/${numericId}`,
      `bt:user:push:${customerId}`
    ];
    const tokens = [];
    const seen = new Set();

    for (const key of keys) {
      const token = await redis.get(key).catch(() => "");
      if (!token || seen.has(token)) continue;
      seen.add(token);
      const keyCustomerId = key.replace(/^bt:user:push:/, "");
      const keyNumericId = customerNumericId(keyCustomerId);
      const locale = await redis.get(`bt:user:push-locale:${keyNumericId}`).catch(() => "");
      tokens.push({ key, token, customerId: keyCustomerId, locale });
    }

    return tokens;
  }

  async function sendOne({ firebase, redis, item, payload }) {
    try {
      const lang = String(item.locale || "").toLowerCase().startsWith("en")
        ? "en"
        : "ar";
      const title =
        lang === "en"
          ? (payload.titleEn || payload.titleAr || payload.title)
          : (payload.titleAr || payload.titleEn || payload.title);
      const body =
        lang === "en"
          ? (payload.bodyEn || payload.bodyAr || payload.body)
          : (payload.bodyAr || payload.bodyEn || payload.body);
      const id = `manual-${Date.now()}-${customerNumericId(item.customerId)}-${Math.random().toString(36).slice(2, 8)}`;
      await saveCustomerNotification(redis, item, payload, id).catch(() => {});
      await firebase.messaging().send({
        token: item.token,
        notification: {
          title,
          body,
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {})
        },
        data: {
          type: "manual_notification",
          id,
          dynamic_link: payload.link || "https://app.halabt.com/",
          title_ar: payload.titleAr || payload.title,
          body_ar: payload.bodyAr || payload.body,
          title_en: payload.titleEn || payload.title,
          body_en: payload.bodyEn || payload.body,
          image: payload.imageUrl || "",
          link: payload.link || ""
        },
        android: {
          notification: {
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            sound: "default",
            ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {})
          }
        },
        apns: {
          payload: {
            aps: { sound: "default" }
          },
          fcmOptions: payload.imageUrl ? { imageUrl: payload.imageUrl } : undefined
        }
      });
      return { ok: true, key: item.key, lang };
    } catch (e) {
      const code = e?.code || "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        await redis.del(item.key).catch(() => {});
      }
      return {
        ok: false,
        key: item.key,
        error: e?.message || String(e)
      };
    }
  }

  async function sendTopic({ firebase, topic, title, body, payload }) {
    if (!title || !body) return { ok: false, topic, skipped: true };
    await firebase.messaging().send({
      topic,
      notification: {
        title,
        body,
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {})
      },
      data: {
        type: "manual_notification",
        id: payload.id || "",
        dynamic_link: payload.link || "https://app.halabt.com/",
        title_ar: payload.titleAr || payload.title,
        body_ar: payload.bodyAr || payload.body,
        title_en: payload.titleEn || payload.title,
        body_en: payload.bodyEn || payload.body,
        image: payload.imageUrl || "",
        link: payload.link || ""
      },
      android: {
        notification: {
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
          sound: "default",
          ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {})
        }
      },
      apns: {
        payload: {
          aps: { sound: "default" }
        },
        fcmOptions: payload.imageUrl ? { imageUrl: payload.imageUrl } : undefined
      }
    });
    return { ok: true, topic };
  }

  router.post("/customer-notifications/send", upload.single("image"), async (req, res) => {
    try {
      if (typeof getRedis !== "function" || typeof getFirebaseAdmin !== "function") {
        return res.status(500).json({ error: "Notification dependencies are not configured" });
      }

      const redis = await getRedis();
      const firebase = getFirebaseAdmin();
      if (!redis) return res.status(500).json({ error: "Redis غير جاهز" });
      if (!firebase) return res.status(500).json({ error: "Firebase غير جاهز" });

      const audience = text(req.body?.audience, 20) || "all";
      const customerId = text(req.body?.customerId, 120);
      const titleAr = text(req.body?.titleAr, 120);
      const bodyAr = text(req.body?.bodyAr, 600);
      const titleEn = text(req.body?.titleEn, 120);
      const bodyEn = text(req.body?.bodyEn, 600);
      const link = text(req.body?.link, 500);

      const title = titleAr || titleEn;
      const body = bodyAr || bodyEn;

      if (!title || !body) {
        return res.status(400).json({ error: "العنوان والنص مطلوبان" });
      }

      if (audience === "customer" && !customerId) {
        return res.status(400).json({ error: "اختر العميل أولاً" });
      }

      const uploaded = await uploadImage(req.file);
      const targets =
        audience === "customer"
          ? await getCustomerPushTokens(redis, customerId)
          : await getAllPushTokens(redis);

      if (audience === "customer" && !targets.length) {
        return res.json({
          ok: false,
          sent: 0,
          failed: 0,
          total: 0,
          image: uploaded,
          reason: audience === "customer" ? "no_customer_token" : "no_tokens"
        });
      }

      const payload = {
        title,
        body,
        titleAr,
        bodyAr,
        titleEn,
        bodyEn,
        link,
        imageUrl: uploaded?.url || ""
      };

      if (audience !== "customer") {
        const id = `manual-${Date.now()}-all-${Math.random().toString(36).slice(2, 8)}`;
        payload.id = id;
        await Promise.all(
          targets.map((item) => saveCustomerNotification(redis, item, payload, id).catch(() => {}))
        );
        const results = [];
        results.push(await sendTopic({
          firebase,
          topic: "all-notifications-ar",
          title: titleAr || titleEn,
          body: bodyAr || bodyEn,
          payload
        }));
        results.push(await sendTopic({
          firebase,
          topic: "all-notifications-en",
          title: titleEn || titleAr,
          body: bodyEn || bodyAr,
          payload
        }));
        const sent = results.filter((x) => x.ok).length;
        const failed = results.length - sent;
        return res.json({
          ok: sent > 0,
          sent,
          failed,
          total: results.length,
          image: uploaded,
          results
        });
      }

      const results = [];
      for (const item of targets) {
        results.push(await sendOne({ firebase, redis, item, payload }));
      }

      const sent = results.filter((x) => x.ok).length;
      const failed = results.length - sent;

      res.json({
        ok: sent > 0,
        sent,
        failed,
        total: results.length,
        image: uploaded,
        results: results.slice(0, 20)
      });
    } catch (e) {
      console.error("customer notification send error", e);
      res.status(500).json({ error: e?.message || "Notification failed" });
    }
  });

  router.get("/customer-notifications/list/:customerId", async (req, res) => {
    try {
      if (typeof getRedis !== "function") {
        return res.status(500).json({ error: "Notification dependencies are not configured" });
      }
      const redis = await getRedis();
      if (!redis) return res.status(500).json({ error: "Redis not ready" });
      const customerId = customerNumericId(req.params.customerId);
      if (!customerId) return res.status(400).json({ error: "customerId required" });
      const rows = await redis.lRange(notificationKey(customerId), 0, 99);
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
      console.error("customer notification list error", e);
      res.status(500).json({ error: e?.message || "Notification list failed" });
    }
  });

  return router;
}
