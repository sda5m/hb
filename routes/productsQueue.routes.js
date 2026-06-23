// routes/productsQueue.routes.js
import express from "express";
import multer from "multer";
import webpush from "web-push";
import { v2 as cloudinary } from "cloudinary";
import crypto from "crypto";

/** 
 * Redis schema:
 * - product hash:   bt:prod:{id}
 * - barcode map:    bt:prod:barcode:{barcode} -> id   (فقط للحالات النشطة + إذا barcode موجود)
 * - status zset:    bt:prod:status:{STATUS} (score=createdAtMs, member=id)
 *
 * statuses:
 * WAITING_ADD | NEED_PHOTO | PHOTO_UPLOADED | ADDED
 */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// يرفع buffer ويُرجع url + publicId
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

async function destroyCloudinary(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // تجاهل الخطأ
  }
}

const ACTIVE_FOR_BARCODE = new Set(["WAITING_ADD", "NEED_PHOTO", "PHOTO_UPLOADED"]);

function nowISO() {
  return new Date().toISOString();
}
function nowMs() {
  return Date.now();
}
function cleanBarcode(x) {
  return String(x || "").trim();
}
function safeName(s) {
  return String(s || "").trim().slice(0, 80);
}
function cleanPrice(x) {
  const v = String(x ?? "").trim();
  if (!v) return "";
  return v.slice(0, 24);
}
function jsonOrEmptyArr(x) {
  try {
    const v = JSON.parse(x || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function id() {
  return crypto.randomUUID();
}

export default function productsQueueRouter({
  getRedis,
  requireProductsStaff,
  requireAdmin,
  uploadsPublicDir,
  WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_SUBJECT,
  PUSH_AUTH_TOKEN
}) {
  if (!getRedis) throw new Error("productsQueueRouter: getRedis is required");
  if (!requireProductsStaff)
    throw new Error("productsQueueRouter: requireProductsStaff is required");
  if (!requireAdmin) throw new Error("productsQueueRouter: requireAdmin is required");

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 },
  });

  const router = express.Router();

  router.use(express.json({ limit: "1mb" }));
  router.use(express.urlencoded({ extended: true }));

  // ---------- Push setup ----------
  const pushEnabled =
    !!String(WEB_PUSH_PUBLIC_KEY || "").trim() &&
    !!String(WEB_PUSH_PRIVATE_KEY || "").trim() &&
    !!String(WEB_PUSH_SUBJECT || "").trim();

  if (pushEnabled) {
    webpush.setVapidDetails(
      String(WEB_PUSH_SUBJECT || "").trim(),
      String(WEB_PUSH_PUBLIC_KEY || "").trim(),
      String(WEB_PUSH_PRIVATE_KEY || "").trim()
    );
  }

  const kPushSubs = () => "bt:prod:push:subs";

  async function loadPushSubs(r) {
    const raw = await r.get(kPushSubs());
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async function savePushSubs(r, list) {
    await r.set(kPushSubs(), JSON.stringify(Array.isArray(list) ? list : []));
  }

  function sameSub(a, b) {
    return String(a?.endpoint || "").trim() === String(b?.endpoint || "").trim();
  }

  async function addPushSub(r, sub) {
    if (!sub?.endpoint) throw new Error("subscription غير صالح");
    const list = await loadPushSubs(r);
    const exists = list.find((x) => sameSub(x, sub));
    if (!exists) {
      list.push(sub);
      await savePushSubs(r, list);
    }
    return { ok: true, count: list.length };
  }

  async function removePushSub(r, endpoint) {
    const list = await loadPushSubs(r);
    const filtered = list.filter(
      (x) => String(x?.endpoint || "").trim() !== String(endpoint || "").trim()
    );
    await savePushSubs(r, filtered);
    return { ok: true, count: filtered.length };
  }

  async function sendPushToAll(r, payload) {
    if (!pushEnabled) return { ok: false, skipped: true, reason: "PUSH_DISABLED" };

    const list = await loadPushSubs(r);
    if (!list.length) return { ok: true, sent: 0 };

    let sent = 0;

    for (const sub of list) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent++;
      } catch (e) {
        const code = Number(e?.statusCode || 0);
        if (code === 404 || code === 410) {
          await removePushSub(r, sub?.endpoint || "");
        } else {
          console.error("products push failed:", e?.message || e);
        }
      }
    }

    return { ok: true, sent };
  }

  async function getPushCounts(r) {
    const [waitingAddCount, waitingEditCount] = await Promise.all([
      countStatus(r, "WAITING_ADD"),
      countStatus(r, "PHOTO_UPLOADED"),
    ]);

    return { waitingAddCount, waitingEditCount };
  }

  // ---------- Redis keys ----------
  const kProd = (pid) => `bt:prod:${pid}`;
  const kBarcode = (barcode) => `bt:prod:barcode:${barcode}`;
  const kZ = (st) => `bt:prod:status:${st}`;
  const kEdit = (eid) => `bt:edit:${eid}`;
  const kEditZ = (st) => `bt:edit:status:${st}`;

  async function moveStatus(r, pid, fromStatus, toStatus, scoreMs) {
    if (fromStatus) await r.zRem(kZ(fromStatus), pid);
    await r.zAdd(kZ(toStatus), [{ score: scoreMs, value: pid }]);
  }

  async function getProduct(r, pid) {
    const h = await r.hGetAll(kProd(pid));
    if (!h || !h.id) return null;

    return {
      id: h.id,
      barcode: h.barcode || "",
      noBarcode: (h.noBarcode || "") === "1",
      price: h.price || "",
      status: h.status || "WAITING_ADD",
      createdAt: h.createdAt || null,
      createdAtMs: Number(h.createdAtMs || 0) || 0,
      createdBy: h.createdBy || "",

      addedAt: h.addedAt || null,
      addedBy: h.addedBy || "",

      needPhotoAt: h.needPhotoAt || null,
      needPhotoBy: h.needPhotoBy || "",

      photoUploadedAt: h.photoUploadedAt || null,
      photoUploadedBy: h.photoUploadedBy || "",

      photoBarcodeUrl: h.photoBarcodeUrl || "",
      photoProductUrls: jsonOrEmptyArr(h.photoProductUrls),

      photoBarcodePublicId: h.photoBarcodePublicId || "",
      photoProductPublicIds: jsonOrEmptyArr(h.photoProductPublicIds),

      notes: h.notes || "",
      priority: Number(h.priority || 0) || 0,
    };
  }

  async function listByStatus(r, status, limit = 200) {
    const ids = await r.zRange(kZ(status), 0, Math.max(0, limit - 1), { REV: true });
    const rows = [];
    for (const pid of ids) {
      const p = await getProduct(r, pid);
      if (p) rows.push(p);
    }
    return rows;
  }

  async function countStatus(r, status) {
    return await r.zCard(kZ(status));
  }

  // =========================
  // PUSH endpoints
  // =========================

  router.get("/push/public-key", requireProductsStaff, async (req, res) => {
    try {
      const publicKey = String(WEB_PUSH_PUBLIC_KEY || "").trim();
      if (!publicKey) {
        return res.status(500).json({ error: "WEB_PUSH_PUBLIC_KEY غير مضبوط" });
      }
      return res.json({ publicKey });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/push/subscribe", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const sub = req.body || {};
      if (!sub?.endpoint) {
        return res.status(400).json({ error: "subscription غير صالح" });
      }
      const out = await addPushSub(r, sub);
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/push/send-test", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const out = await sendPushToAll(r, {
        title: "تجربة إشعار المنتجات",
        body: "هذا إشعار تجريبي من لوحة المنتجات",
        tag: "prod-test",
        url: "/prod/"
      });
      return res.json({ ok: true, ...out });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/push/order-created", async (req, res) => {
    try {
      const token = String(req.get("x-push-auth") || "").trim();
      if (!String(PUSH_AUTH_TOKEN || "").trim() || token !== String(PUSH_AUTH_TOKEN || "").trim()) {
        return res.status(401).json({ error: "غير مصرح" });
      }

      const r = await getRedis();
      const type = String(req.body?.type || "new_add").trim();
      const counts = await getPushCounts(r);

      const image = String(req.body?.image || "").trim() || undefined;

      if (type === "edit_request") {
        await sendPushToAll(r, {
          title: "طلب تعديل منتج",
          body: `يوجد الآن ${counts.waitingEditCount} طلبات في انتظار التعديل`,
          image,
          tag: "prod-edit-request",
          url: "/prod/"
        });
      } else {
        await sendPushToAll(r, {
          title: "طلب إضافة منتج",
          body: `يوجد الآن ${counts.waitingAddCount} طلبات في انتظار الرفع`,
          image,
          tag: "prod-new-add",
          url: "/prod/"
        });
      }

      return res.json({ ok: true, counts });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // =========================
  // STAFF endpoints
  // =========================

  router.post(
    "/staff/new-request",
    requireProductsStaff,
    upload.fields([
      { name: "productPhotos", maxCount: 8 },
      { name: "barcodePhoto", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const r = await getRedis();

        const staffName = safeName(req.body?.staffName || "staff");
        const noBarcode = String(req.body?.noBarcode || "0") === "1";
        const barcodeRaw = cleanBarcode(req.body?.barcode);
        const price = cleanPrice(req.body?.price);
        const note = String(req.body?.note || "").trim().slice(0, 400);

        const barcode = noBarcode ? "" : barcodeRaw;

        const files = req.files || {};
        const productFiles = files.productPhotos || [];
        const barcodeFiles = files.barcodePhoto || [];
        const barFileExists = !!barcodeFiles[0];

        if (!noBarcode && !barcode && !barFileExists) {
          return res.status(400).json({
            error: "أدخل/امسح الباركود أو ارفع صورة الباركود أو اختر (لا يوجد باركود)",
          });
        }

        if (!productFiles.length && !barFileExists) {
          return res.status(400).json({ error: "ارفق صور المنتج أو صورة الباركود" });
        }

        if (barcode) {
          const existingId = await r.get(kBarcode(barcode));
          if (existingId) {
            const ex = await getProduct(r, existingId);
            if (ex && ACTIVE_FOR_BARCODE.has(ex.status)) {
              return res
                .status(409)
                .json({ error: "هذا الباركود موجود مسبقًا في القائمة", product: ex });
            }
          }
        }

        const seq = await r.incr("bt:prod:seq");
        const pid = "BT-" + String(seq).padStart(3, "0");

        const createdAt = nowISO();
        const createdAtMs = nowMs();

        const productUrls = [];
        const productPublicIds = [];

        for (const f of productFiles) {
          const up = await uploadToCloudinary(f.buffer, "bt/products");
          productUrls.push(up.url);
          productPublicIds.push(up.publicId);
        }

        let barcodeUrl = "";
        let barcodePublicId = "";

        if (barcodeFiles[0]) {
          const up = await uploadToCloudinary(barcodeFiles[0].buffer, "bt/barcodes");
          barcodeUrl = up.url;
          barcodePublicId = up.publicId;
        }

        const hasAnyPhotos = productUrls.length > 0 || !!barcodeUrl;

        const prod = {
          id: pid,
          barcode: barcode || "",
          noBarcode: noBarcode ? "1" : "0",
          price: price || "",
          status: "WAITING_ADD",
          createdAt,
          createdAtMs: String(createdAtMs),
          createdBy: staffName,

          addedAt: "",
          addedBy: "",
          needPhotoAt: "",
          needPhotoBy: "",

          photoUploadedAt: hasAnyPhotos ? createdAt : "",
          photoUploadedBy: hasAnyPhotos ? staffName : "",

          photoBarcodeUrl: barcodeUrl || "",
          photoBarcodePublicId: barcodePublicId || "",

          photoProductUrls: JSON.stringify(productUrls || []),
          photoProductPublicIds: JSON.stringify(productPublicIds || []),

          notes: note || "",
        };

        await r.hSet(kProd(pid), prod);

        if (barcode) await r.set(kBarcode(barcode), pid);

        await r.zAdd(kZ("WAITING_ADD"), [{ score: createdAtMs, value: pid }]);

        const counts = await getPushCounts(r);
        const notifImage = productUrls[0] || barcodeUrl || undefined;

        await sendPushToAll(r, {
          title: "طلب إضافة منتج",
          body: `يوجد الآن ${counts.waitingAddCount} طلبات في انتظار الرفع`,
          image: notifImage,
          tag: "prod-new-add",
          url: "/prod/"
        });

        return res.json({ ok: true, product: await getProduct(r, pid) });
      } catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  router.post("/staff/new", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const barcode = cleanBarcode(req.body?.barcode);
      const createdBy = safeName(req.body?.createdBy || "staff");

      if (!barcode) return res.status(400).json({ error: "barcode مطلوب" });

      const existingId = await r.get(kBarcode(barcode));
      if (existingId) {
        const ex = await getProduct(r, existingId);
        if (ex && ACTIVE_FOR_BARCODE.has(ex.status)) {
          return res
            .status(409)
            .json({ error: "هذا الباركود موجود مسبقًا في القائمة", product: ex });
        }
      }

      const seq = await r.incr("bt:prod:seq");
      const pid = "BT-" + String(seq).padStart(3, "0");
      const createdAt = nowISO();
      const createdAtMs = nowMs();

      const prod = {
        id: pid,
        barcode,
        noBarcode: "0",
        price: "",
        status: "WAITING_ADD",
        createdAt,
        createdAtMs: String(createdAtMs),
        createdBy,

        addedAt: "",
        addedBy: "",
        needPhotoAt: "",
        needPhotoBy: "",

        photoUploadedAt: "",
        photoUploadedBy: "",
        photoBarcodeUrl: "",
        photoProductUrls: JSON.stringify([]),

        photoBarcodePublicId: "",
        photoProductPublicIds: JSON.stringify([]),

        notes: "",
      };

      await r.hSet(kProd(pid), prod);
      await r.set(kBarcode(barcode), pid);
      await r.zAdd(kZ("WAITING_ADD"), [{ score: createdAtMs, value: pid }]);

      const counts = await getPushCounts(r);
      await sendPushToAll(r, {
        title: "طلب إضافة منتج",
        body: `يوجد الآن ${counts.waitingAddCount} طلبات في انتظار الرفع`,
        tag: "prod-new-add",
        url: "/prod/"
      });

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/staff/pending-add", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const [w, p] = await Promise.all([
        listByStatus(r, "WAITING_ADD", 300),
        listByStatus(r, "PHOTO_UPLOADED", 300),
      ]);
      const rows = [...p, ...w];
      return res.json({ count: rows.length, products: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.patch("/staff/:id/priority", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      const pr = Number(req.body?.priority);
      if (!Number.isFinite(pr) || pr < 1 || pr > 9999) {
        return res.status(400).json({ error: "priority لازم رقم من 1 إلى 9999" });
      }

      const list = String(req.body?.list || p.status || "").trim();
      const ALLOWED = new Set(["WAITING_ADD", "PHOTO_UPLOADED"]);
      if (!ALLOWED.has(list)) return res.status(400).json({ error: "list غير صحيح" });

      await r.hSet(kProd(pid), { priority: String(pr) });

      const score = 1000000 - pr;
      await r.zAdd(kZ(list), [{ score, value: pid }]);

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/staff/pending-add/order", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();

      const normal = Array.isArray(req.body?.normal) ? req.body.normal : [];
      const edits  = Array.isArray(req.body?.edits)  ? req.body.edits  : [];

      let score = 1000000;
      for (const id of normal) {
        await r.zAdd(kZ("WAITING_ADD"), [{ score: score--, value: id }]);
      }

      score = 1000000;
      for (const id of edits) {
        await r.zAdd(kZ("PHOTO_UPLOADED"), [{ score: score--, value: id }]);
      }

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/staff/:id/done", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();
      const addedBy = safeName(req.body?.addedBy || "staff");

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });
      if (p.status === "ADDED") {
        return res.json({ ok: true, product: p });
      }

      const from = p.status;
      const to = "ADDED";
      const ts = nowISO();
      const tsMs = nowMs();

      await r.hSet(kProd(pid), { status: to, addedAt: ts, addedBy });

      if (from !== to) {
        await moveStatus(r, pid, from, to, tsMs);
      } else {
        await r.zAdd(kZ(to), [{ score: tsMs, value: pid }]);
      }

      if (p.barcode) await r.del(kBarcode(p.barcode));

      const ids = [];
      if (p.photoBarcodePublicId) ids.push(p.photoBarcodePublicId);
      if (Array.isArray(p.photoProductPublicIds)) ids.push(...p.photoProductPublicIds);

      for (const publicId of ids) {
        await destroyCloudinary(publicId);
      }

      await r.hSet(kProd(pid), {
        photoBarcodeUrl: "",
        photoBarcodePublicId: "",
        photoProductUrls: JSON.stringify([]),
        photoProductPublicIds: JSON.stringify([]),
        photoUploadedAt: "",
        photoUploadedBy: "",
      });

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/staff/:id/no-photo", requireProductsStaff, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();
      const needPhotoBy = safeName(req.body?.needPhotoBy || "staff");
      const reason = String(req.body?.reason || "").trim().slice(0, 200);

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      const from = p.status;
      const to = "NEED_PHOTO";
      const ts = nowISO();
      const tsMs = nowMs();

      const note = reason ? `طلب تصوير: ${reason}` : "طلب تصوير: الصور غير مناسبة للإنترنت";

      await r.hSet(kProd(pid), {
        status: to,
        needPhotoAt: ts,
        needPhotoBy,
        notes: note,
      });

      await moveStatus(r, pid, from, to, tsMs);

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // =========================
  // ADMIN endpoints
  // =========================

  router.post(
    "/admin/new",
    requireAdmin,
    upload.fields([
      { name: "productPhotos", maxCount: 8 },
      { name: "barcodePhoto", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const r = await getRedis();

        const adminName = safeName(req.body?.adminName || "admin");
        const noBarcode = String(req.body?.noBarcode || "0") === "1";
        const barcodeRaw = cleanBarcode(req.body?.barcode);
        const price = cleanPrice(req.body?.price);

        const barcode = noBarcode ? "" : barcodeRaw;

        if (!noBarcode && !barcode) {
          return res.status(400).json({ error: "أدخل الباركود أو اختر (لا يوجد باركود)" });
        }

        if (barcode) {
          const existingId = await r.get(kBarcode(barcode));
          if (existingId) {
            const ex = await getProduct(r, existingId);
            if (ex && ACTIVE_FOR_BARCODE.has(ex.status)) {
              return res
                .status(409)
                .json({ error: "هذا الباركود موجود مسبقًا في القائمة", product: ex });
            }
          }
        }

        const pid = id();
        const createdAt = nowISO();
        const createdAtMs = nowMs();

        const files = req.files || {};
        const productFiles = files.productPhotos || [];
        const barcodeFiles = files.barcodePhoto || [];

        const productUrls = [];
        const productPublicIds = [];

        for (const f of productFiles) {
          const up = await uploadToCloudinary(f.buffer, "bt/products");
          productUrls.push(up.url);
          productPublicIds.push(up.publicId);
        }

        let barcodeUrl = "";
        let barcodePublicId = "";

        if (barcodeFiles[0]) {
          const up = await uploadToCloudinary(barcodeFiles[0].buffer, "bt/barcodes");
          barcodeUrl = up.url;
          barcodePublicId = up.publicId;
        }

        const prod = {
          id: pid,
          barcode: barcode || "",
          noBarcode: noBarcode ? "1" : "0",
          price: price || "",
          status: "WAITING_ADD",
          createdAt,
          createdAtMs: String(createdAtMs),
          createdBy: adminName,

          addedAt: "",
          addedBy: "",
          needPhotoAt: "",
          needPhotoBy: "",

          photoUploadedAt: productUrls.length || barcodeUrl ? createdAt : "",
          photoUploadedBy: productUrls.length || barcodeUrl ? adminName : "",

          photoBarcodeUrl: barcodeUrl || "",
          photoBarcodePublicId: barcodePublicId || "",

          photoProductUrls: JSON.stringify(productUrls || []),
          photoProductPublicIds: JSON.stringify(productPublicIds || []),

          notes: "",
        };

        await r.hSet(kProd(pid), prod);

        if (barcode) await r.set(kBarcode(barcode), pid);

        await r.zAdd(kZ("WAITING_ADD"), [{ score: createdAtMs, value: pid }]);

        return res.json({ ok: true, product: await getProduct(r, pid) });
      } catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  router.patch("/admin/:id/status", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();
      const adminName = safeName(req.body?.adminName || "admin");

      const to = String(req.body?.status || "").trim();
      const ALLOWED = new Set(["WAITING_ADD", "NEED_PHOTO", "PHOTO_UPLOADED", "ADDED"]);
      if (!ALLOWED.has(to)) return res.status(400).json({ error: "status غير صحيح" });

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      const from = p.status;
      const ts = nowISO();
      const tsMs = nowMs();

      const patch = { status: to };

      if (to === "ADDED") {
        patch.addedAt = ts;
        patch.addedBy = adminName;
        if (p.barcode) await r.del(kBarcode(p.barcode));
      }

      if (to === "NEED_PHOTO") {
        patch.needPhotoAt = ts;
        patch.needPhotoBy = adminName;
      }

      if (to === "PHOTO_UPLOADED") {
        patch.photoUploadedAt = ts;
        patch.photoUploadedBy = adminName;
      }

      await r.hSet(kProd(pid), patch);

      if (from !== to) {
        await moveStatus(r, pid, from, to, tsMs);
      } else {
        await r.zAdd(kZ(to), [{ score: tsMs, value: pid }]);
      }

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.patch("/admin/:id/edit", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      if (p.status === "ADDED") {
        return res.status(400).json({ error: "لا يمكن تعديل طلب مكتمل" });
      }

      const noBarcode = String(req.body?.noBarcode || "") === "true" || String(req.body?.noBarcode || "") === "1";
      const barcodeRaw = cleanBarcode(req.body?.barcode);
      const barcode = noBarcode ? "" : barcodeRaw;

      const price = cleanPrice(req.body?.price);
      const note = String(req.body?.note || req.body?.notes || "").trim().slice(0, 400);

      if (barcode && barcode !== p.barcode) {
        const existingId = await r.get(kBarcode(barcode));
        if (existingId && existingId !== pid) {
          const ex = await getProduct(r, existingId);
          if (ex && ACTIVE_FOR_BARCODE.has(ex.status)) {
            return res.status(409).json({ error: "هذا الباركود موجود مسبقًا في القائمة", product: ex });
          }
        }
      }

      if (p.barcode && p.barcode !== barcode) {
        await r.del(kBarcode(p.barcode));
      }

      if (barcode && ACTIVE_FOR_BARCODE.has(p.status)) {
        await r.set(kBarcode(barcode), pid);
      }

      await r.hSet(kProd(pid), {
        noBarcode: noBarcode ? "1" : "0",
        barcode: barcode || "",
        price: price || "",
        notes: note || "",
      });

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.delete("/admin/:id/barcode-photo", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      if (p.photoBarcodePublicId) await destroyCloudinary(p.photoBarcodePublicId);

      await r.hSet(kProd(pid), {
        photoBarcodeUrl: "",
        photoBarcodePublicId: "",
      });

      const stillHas = (p.photoProductUrls?.length || 0) > 0;
      if (!stillHas && p.status === "PHOTO_UPLOADED") {
        const tsMs = nowMs();
        await r.hSet(kProd(pid), { status: "NEED_PHOTO" });
        await moveStatus(r, pid, "PHOTO_UPLOADED", "NEED_PHOTO", tsMs);
      }

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.delete("/admin/:id/product-photo/:idx", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();
      const idx = Number(req.params.idx);

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      const urls = Array.isArray(p.photoProductUrls) ? [...p.photoProductUrls] : [];
      const ids  = Array.isArray(p.photoProductPublicIds) ? [...p.photoProductPublicIds] : [];

      if (!Number.isInteger(idx) || idx < 0 || idx >= urls.length) {
        return res.status(400).json({ error: "رقم الصورة غير صحيح" });
      }

      const publicId = ids[idx];
      if (publicId) await destroyCloudinary(publicId);

      urls.splice(idx, 1);
      ids.splice(idx, 1);

      await r.hSet(kProd(pid), {
        photoProductUrls: JSON.stringify(urls),
        photoProductPublicIds: JSON.stringify(ids),
      });

      const stillHas = urls.length > 0 || !!p.photoBarcodeUrl;
      if (!stillHas && p.status === "PHOTO_UPLOADED") {
        const tsMs = nowMs();
        await r.hSet(kProd(pid), { status: "NEED_PHOTO" });
        await moveStatus(r, pid, "PHOTO_UPLOADED", "NEED_PHOTO", tsMs);
      }

      return res.json({ ok: true, product: await getProduct(r, pid) });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post(
    "/admin/:id/replace-barcode-photo",
    requireAdmin,
    upload.single("barcodePhoto"),
    async (req, res) => {
      try {
        const r = await getRedis();
        const pid = String(req.params.id || "").trim();

        const p = await getProduct(r, pid);
        if (!p) return res.status(404).json({ error: "غير موجود" });

        if (!req.file) return res.status(400).json({ error: "أرفق صورة باركود" });

        if (p.photoBarcodePublicId) await destroyCloudinary(p.photoBarcodePublicId);

        const up = await uploadToCloudinary(req.file.buffer, "bt/barcodes");

        await r.hSet(kProd(pid), {
          photoBarcodeUrl: up.url,
          photoBarcodePublicId: up.publicId,
          photoUploadedAt: nowISO(),
        });

        if (p.status !== "ADDED" && p.status !== "PHOTO_UPLOADED") {
          const tsMs = nowMs();
          await r.hSet(kProd(pid), { status: "PHOTO_UPLOADED" });
          await moveStatus(r, pid, p.status, "PHOTO_UPLOADED", tsMs);
        }

        return res.json({ ok: true, product: await getProduct(r, pid) });
      } catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  router.delete("/admin/:id", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const pid = String(req.params.id || "").trim();

      const p = await getProduct(r, pid);
      if (!p) return res.status(404).json({ error: "غير موجود" });

      const ids = [];
      if (p.photoBarcodePublicId) ids.push(p.photoBarcodePublicId);
      if (Array.isArray(p.photoProductPublicIds)) ids.push(...p.photoProductPublicIds);
      for (const publicId of ids) await destroyCloudinary(publicId);

      if (p.barcode) await r.del(kBarcode(p.barcode));
      if (p.status) await r.zRem(kZ(p.status), pid);
      await r.del(kProd(pid));

      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/admin/dashboard", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();

      const [c1, c2, c3, c4] = await Promise.all([
        countStatus(r, "WAITING_ADD"),
        countStatus(r, "NEED_PHOTO"),
        countStatus(r, "PHOTO_UPLOADED"),
        countStatus(r, "ADDED"),
      ]);

      const [waiting, needPhoto, photoUploaded, added] = await Promise.all([
        listByStatus(r, "WAITING_ADD", 50),
        listByStatus(r, "NEED_PHOTO", 50),
        listByStatus(r, "PHOTO_UPLOADED", 50),
        listByStatus(r, "ADDED", 50),
      ]);

      const report = added.map((x) => {
        const a = x.addedAt ? Date.parse(x.addedAt) : 0;
        const c = x.createdAt ? Date.parse(x.createdAt) : 0;
        const mins = a && c ? Math.round((a - c) / 60000) : null;
        return { ...x, minutesToAdd: mins };
      });

      return res.json({
        counts: { WAITING_ADD: c1, NEED_PHOTO: c2, PHOTO_UPLOADED: c3, ADDED: c4 },
        lists: { waiting, needPhoto, photoUploaded, added: report },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post(
    "/admin/:id/upload-photos",
    requireAdmin,
    upload.fields([
      { name: "productPhotos", maxCount: 8 },
      { name: "barcodePhoto", maxCount: 1 },
    ]),
    async (req, res) => {
      try {
        const r = await getRedis();
        const pid = String(req.params.id || "").trim();
        const adminName = safeName(req.body?.adminName || "admin");

        const p = await getProduct(r, pid);
        if (!p) return res.status(404).json({ error: "غير موجود" });

        if (p.status === "ADDED") {
          return res.status(400).json({ error: "لا يمكن رفع صور لطلب مكتمل" });
        }

        const files = req.files || {};
        const productFiles = files.productPhotos || [];
        const barcodeFiles = files.barcodePhoto || [];

        if (!productFiles.length && !barcodeFiles.length) {
          return res.status(400).json({ error: "ارفق صور المنتج أو صورة الباركود" });
        }

        const productUrls = [];
        const productPublicIds = [];
        for (const f of productFiles) {
          const up = await uploadToCloudinary(f.buffer, "bt/products");
          productUrls.push(up.url);
          productPublicIds.push(up.publicId);
        }

        let barcodeUrl = "";
        let barcodePublicId = "";
        if (barcodeFiles[0]) {
          const up = await uploadToCloudinary(barcodeFiles[0].buffer, "bt/barcodes");
          barcodeUrl = up.url;
          barcodePublicId = up.publicId;
        }

        const mergedUrls = [...(p.photoProductUrls || []), ...productUrls];
        const mergedIds  = [...(p.photoProductPublicIds || []), ...productPublicIds];

        const finalBarcodeUrl = barcodeUrl || (p.photoBarcodeUrl || "");
        const finalBarcodeId  = barcodePublicId || (p.photoBarcodePublicId || "");

        const from = p.status;
        const to = "PHOTO_UPLOADED";
        const ts = nowISO();
        const tsMs = nowMs();

        await r.hSet(kProd(pid), {
          status: to,
          photoUploadedAt: ts,
          photoUploadedBy: adminName,
          photoBarcodeUrl: finalBarcodeUrl,
          photoBarcodePublicId: finalBarcodeId,
          photoProductUrls: JSON.stringify(mergedUrls),
          photoProductPublicIds: JSON.stringify(mergedIds),
        });

        if (from === "NEED_PHOTO") {
          await r.hSet(kProd(pid), { needPhotoAt: "", needPhotoBy: "", notes: "" });
        }

        if (from !== to) {
          await moveStatus(r, pid, from, to, tsMs);
        } else {
          await r.zAdd(kZ(to), [{ score: tsMs, value: pid }]);
        }

if (to === "PHOTO_UPLOADED") {
  const counts = await getPushCounts(r);
  const notifImage = mergedUrls[0] || finalBarcodeUrl || undefined;

  await sendPushToAll(r, {
    title: "طلب تعديل منتج",
    body: `يوجد الآن ${counts.waitingEditCount} طلبات في انتظار التعديل`,
    image: notifImage,
    tag: "prod-edit-request",
    url: "/prod/"
  });
}
        return res.json({ ok: true, product: await getProduct(r, pid) });
      } catch (e) {
        return res.status(500).json({ error: e.message || String(e) });
      }
    }
  );

  router.post("/admin/cleanup-added", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const limit = Math.min(500, Math.max(1, Number(req.body?.limit || 200)));

      const ids = await r.zRange(kZ("ADDED"), 0, limit - 1, { REV: false });
      let deleted = 0;
      let cleanedMissing = 0;

      for (const pid of ids) {
        const p = await getProduct(r, pid);

        if (!p) {
          await r.zRem(kZ("ADDED"), pid);
          cleanedMissing++;
          continue;
        }

        await r.del(kProd(pid));
        await r.zRem(kZ("ADDED"), pid);

        if (p.barcode) await r.del(kBarcode(p.barcode));

        deleted++;
      }

      return res.json({ ok: true, deleted, cleanedMissing });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/admin/pending-waiting-add", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const rows = await listByStatus(r, "WAITING_ADD", 300);
      return res.json({ count: rows.length, products: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/admin/pending-need-photo", requireAdmin, async (req, res) => {
    try {
      const r = await getRedis();
      const rows = await listByStatus(r, "NEED_PHOTO", 300);
      return res.json({ count: rows.length, products: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  /* =========================
     VENDORS MANAGER
  ========================= */

  const VENDOR_MENU_HANDLE = "image-vendor-the4";
  const BRANDS_PAGE_HANDLE = "brands";
  const BRANDS_PAGE_TITLE_AR = "الماركات";
  const BRANDS_PAGE_TITLE_EN = "Brands";
  const BRANDS_METAFIELD_NAMESPACE = "theme";
  const BRANDS_METAFIELD_KEY = "vendor";

  function vendorOneLine(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function vendorSameText(a, b) {
    return vendorOneLine(a).toLowerCase() === vendorOneLine(b).toLowerCase();
  }

  function normalizeVendorBrandName(name) {
    return vendorOneLine(name);
  }

  function slugifyVendorHandle(input) {
    return String(input || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
  }

  function buildVendorCollectionUrl(brandName) {
    return `https://halabt.com/collections/vendors?q=${encodeURIComponent(String(brandName || "").trim())}`;
  }

  function safeVendorDescription(v) {
    const s = String(v || "").trim();
    return s || "-";
  }

  async function vendorAdminGraphQL(query, variables = {}) {
    const SHOP = String(process.env.SHOPIFY_SHOP || "").trim();
    const TOKEN = String(process.env.SHOPIFY_ADMIN_TOKEN || "").trim();
    const API_VERSION = String(process.env.SHOPIFY_API_VERSION || "2026-01").trim();

    if (!SHOP || !TOKEN) {
      throw new Error("SHOPIFY_SHOP أو SHOPIFY_ADMIN_TOKEN غير مضبوط في ENV");
    }

    const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query, variables })
    });

    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(
        json?.errors?.[0]?.message ||
        json?.error ||
        json?.message ||
        `Shopify GraphQL HTTP ${r.status}`
      );
    }

    if (Array.isArray(json?.errors) && json.errors.length) {
      throw new Error(json.errors[0]?.message || "Shopify GraphQL error");
    }

    return json.data;
  }

  const VENDOR_MENUS_QUERY = `
    query VendorMenusList {
      menus(first: 100) {
        nodes {
          id
          handle
          title
          items {
            id
            title
            type
            url
            tags
            items {
              id
              title
              type
              url
              tags
            }
          }
        }
      }
    }
  `;

  const VENDOR_MENU_UPDATE_MUTATION = `
    mutation VendorMenuUpdate($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
        menu { id handle title }
        userErrors { field message }
      }
    }
  `;

  function flattenVendorMenuItems(items) {
    const out = [];
    for (const item of items || []) {
      if (!item) continue;
      out.push({
        id: item.id || "",
        title: item.title || "",
        type: item.type || "HTTP",
        url: item.url || "",
        tags: Array.isArray(item.tags) ? item.tags : [],
        items: Array.isArray(item.items)
          ? item.items.map((sub) => ({
              id: sub.id || "",
              title: sub.title || "",
              type: sub.type || "HTTP",
              url: sub.url || "",
              tags: Array.isArray(sub.tags) ? sub.tags : []
            }))
          : []
      });
    }
    return out;
  }

  async function resolveVendorMenu() {
    const data = await vendorAdminGraphQL(VENDOR_MENUS_QUERY);
    const menus = data?.menus?.nodes || [];
    const menu = menus.find((m) => vendorSameText(m?.handle, VENDOR_MENU_HANDLE));
    if (!menu) throw new Error(`لم أجد Menu بالـ handle: ${VENDOR_MENU_HANDLE}`);
    return menu;
  }

  async function upsertBrandImageInMenu({ brandName, imageUrl }) {
    const menu = await resolveVendorMenu();
    const items = flattenVendorMenuItems(menu.items || []);
    const idx = items.findIndex((x) => vendorSameText(x?.title, brandName));

    let action = "created";

    if (idx >= 0) {
      const prev = items[idx] || {};
      items[idx] = {
        ...prev,
        title: brandName,
        type: "HTTP",
        url: imageUrl,
        tags: Array.isArray(prev.tags) ? prev.tags : [],
        items: Array.isArray(prev.items) ? prev.items : []
      };
      action = vendorSameText(prev.url, imageUrl) ? "exists" : "updated";
    } else {
      items.push({
        title: brandName,
        type: "HTTP",
        url: imageUrl,
        tags: [],
        items: []
      });
      action = "created";
    }

    const data = await vendorAdminGraphQL(VENDOR_MENU_UPDATE_MUTATION, {
      id: menu.id,
      title: menu.title,
      handle: menu.handle,
      items: items.map((x) => ({
        ...(x.id ? { id: x.id } : {}),
        title: x.title,
        type: x.type || "HTTP",
        url: x.url || "",
        tags: Array.isArray(x.tags) ? x.tags : [],
        items: Array.isArray(x.items)
          ? x.items.map((sub) => ({
              ...(sub.id ? { id: sub.id } : {}),
              title: sub.title,
              type: sub.type || "HTTP",
              url: sub.url || "",
              tags: Array.isArray(sub.tags) ? sub.tags : []
            }))
          : []
      }))
    });

    const err = data?.menuUpdate?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل تحديث المنيو");

    return {
      action,
      menuHandle: menu.handle,
      menuTitle: menu.title
    };
  }

  const STAGED_UPLOADS_CREATE_MUTATION = `
    mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }
  `;

  const FILE_CREATE_MUTATION = `
    mutation FileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          __typename
          ... on MediaImage {
            id
            fileStatus
            image { url }
          }
          ... on GenericFile {
            id
            fileStatus
            url
          }
        }
        userErrors { field message code }
      }
    }
  `;

  const FILE_NODE_QUERY = `
    query FileNode($id: ID!) {
      node(id: $id) {
        __typename
        ... on MediaImage {
          id
          fileStatus
          image { url }
        }
        ... on GenericFile {
          id
          fileStatus
          url
        }
      }
    }
  `;

  async function uploadVendorImageToShopify({ brandName, file }) {
    const filename = String(file?.originalname || `${slugifyVendorHandle(brandName) || "brand"}.png`).trim();
    const mimeType = String(file?.mimetype || "image/png").trim();
    const size = Number(file?.size || file?.buffer?.length || 0);

    if (!file?.buffer || !size) {
      throw new Error("ملف الصورة غير صالح");
    }

    const staged = await vendorAdminGraphQL(STAGED_UPLOADS_CREATE_MUTATION, {
      input: [{
        filename,
        mimeType,
        fileSize: String(size),
        resource: "FILE",
        httpMethod: "POST"
      }]
    });

    const stagedErr = staged?.stagedUploadsCreate?.userErrors?.[0];
    if (stagedErr) throw new Error(stagedErr.message || "فشل stagedUploadsCreate");

    const target = staged?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url || !target?.resourceUrl) {
      throw new Error("لم يتم الحصول على staged upload target");
    }

    const form = new FormData();
    for (const p of target.parameters || []) form.append(p.name, p.value);

    const blob = new Blob([file.buffer], { type: mimeType });
    form.append("file", blob, filename);

    const uploadRes = await fetch(target.url, { method: "POST", body: form });
    if (!uploadRes.ok) {
      const txt = await uploadRes.text().catch(() => "");
      throw new Error(`فشل رفع الملف إلى Shopify staging (${uploadRes.status}) ${txt}`);
    }

    const created = await vendorAdminGraphQL(FILE_CREATE_MUTATION, {
      files: [{
        originalSource: target.resourceUrl,
        contentType: "IMAGE",
        alt: brandName
      }]
    });

    const createErr = created?.fileCreate?.userErrors?.[0];
    if (createErr) throw new Error(createErr.message || "فشل fileCreate");

    const createdFile = created?.fileCreate?.files?.[0];
    const fileId = createdFile?.id || "";
    if (!fileId) throw new Error("لم يتم إرجاع Shopify file id");

    let imageUrl = "";
    let fileStatus = createdFile?.fileStatus || "";

    for (let i = 0; i < 15; i += 1) {
      const q = await vendorAdminGraphQL(FILE_NODE_QUERY, { id: fileId });
      const node = q?.node;

      fileStatus = node?.fileStatus || fileStatus;

      if (node?.__typename === "MediaImage" && node?.image?.url) {
        imageUrl = node.image.url;
        break;
      }
      if (node?.__typename === "GenericFile" && node?.url) {
        imageUrl = node.url;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    if (!imageUrl) {
      throw new Error("تم إنشاء الصورة في Shopify لكن لم أصل للرابط النهائي بعد");
    }

    return { fileId, imageUrl, fileStatus };
  }

  const VENDOR_DEFS_QUERY = `
    query VendorDefs {
      metaobjectDefinitions(first: 100) {
        nodes {
          id
          name
          type
          displayNameKey
          fieldDefinitions {
            key
            name
            type { name }
          }
        }
      }
    }
  `;

  const VENDOR_METAOBJECTS_QUERY = `
    query VendorMetaobjects($type: String!) {
      metaobjects(first: 250, type: $type) {
        nodes {
          id
          type
          handle
          displayName
          capabilities {
            publishable {
              status
            }
          }
          fields {
            key
            value
            reference {
              __typename
              ... on MediaImage {
                id
                image { url }
              }
              ... on Collection {
                id
                title
                handle
              }
            }
          }
        }
      }
    }
  `;

  const VENDOR_METAOBJECT_UPSERT = `
    mutation VendorMetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject {
          id
          type
          handle
          displayName
          capabilities {
            publishable {
              status
            }
          }
        }
        userErrors { field message code }
      }
    }
  `;

  const VENDOR_METAOBJECT_UPDATE = `
    mutation VendorMetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
          handle
          displayName
          capabilities {
            publishable {
              status
            }
          }
        }
        userErrors { field message code }
      }
    }
  `;

  const TRANSLATABLE_RESOURCE_QUERY = `
    query VendorTranslatableResource($resourceId: ID!, $locale: String!) {
      translatableResource(resourceId: $resourceId) {
        resourceId
        translatableContent {
          key
          value
          digest
          locale
        }
        translations(locale: $locale) {
          key
          value
          locale
          outdated
        }
      }
    }
  `;

  const TRANSLATIONS_REGISTER_MUTATION = `
    mutation VendorTranslationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
      translationsRegister(resourceId: $resourceId, translations: $translations) {
        translations {
          key
          value
          locale
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  
  async function resolveVendorDefinition() {
    const data = await vendorAdminGraphQL(VENDOR_DEFS_QUERY);
    const defs = data?.metaobjectDefinitions?.nodes || [];

    const exact = defs.find((d) => {
      const keys = new Set((d.fieldDefinitions || []).map((f) => String(f.key || "").trim()));
      return keys.has("name") && keys.has("image") && keys.has("link");
    });

    if (!exact) {
      throw new Error("لم أجد Vendor metaobject definition مناسب");
    }

    const keys = new Set((exact.fieldDefinitions || []).map((f) => String(f.key || "").trim()));
    return {
      id: exact.id,
      type: exact.type,
      name: exact.name,
      keys: {
        name: "name",
        image: "image",
        link: "link",
        description: keys.has("description") ? "description" : "",
        collection: keys.has("collection") ? "collection" : ""
      }
    };
  }

  async function ensureVendorActive(metaobjectId) {
    const data = await vendorAdminGraphQL(VENDOR_METAOBJECT_UPDATE, {
      id: metaobjectId,
      metaobject: {
        capabilities: {
          publishable: {
            status: "ACTIVE"
          }
        }
      }
    });

    const err = data?.metaobjectUpdate?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل تفعيل الـ Vendor");

    return data?.metaobjectUpdate?.metaobject || null;
  }

  async function setVendorPublishStatus(metaobjectId, status) {
    const finalStatus = String(status || "").toUpperCase() === "DRAFT" ? "DRAFT" : "ACTIVE";
    const data = await vendorAdminGraphQL(VENDOR_METAOBJECT_UPDATE, {
      id: metaobjectId,
      metaobject: {
        capabilities: {
          publishable: {
            status: finalStatus
          }
        }
      }
    });

    const err = data?.metaobjectUpdate?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل تحديث حالة الماركة");

    return data?.metaobjectUpdate?.metaobject || null;
  }

  function shopifySearchQuote(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .trim();
  }

  const VENDOR_PRODUCTS_QUERY = `
    query VendorProducts($first: Int!, $after: String, $query: String!) {
      products(first: $first, after: $after, query: $query, sortKey: TITLE) {
        nodes {
          id
          title
          vendor
          status
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

  const PRODUCT_STATUS_UPDATE = `
    mutation VendorProductStatusUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          title
          status
          vendor
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  async function listProductsByVendor(vendorName) {
    const query = `vendor:"${shopifySearchQuote(vendorName)}"`;
    const out = [];
    let after = null;

    for (let page = 0; page < 20; page++) {
      const data = await vendorAdminGraphQL(VENDOR_PRODUCTS_QUERY, {
        first: 100,
        after,
        query
      });

      const conn = data?.products || {};
      const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
      out.push(...nodes.filter((p) => vendorSameText(p?.vendor, vendorName)));

      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor || null;
      if (!after) break;
    }

    return out;
  }

  async function updateProductsVendorStatus(vendorName, status) {
    const finalStatus = String(status || "").toUpperCase() === "DRAFT" ? "DRAFT" : "ACTIVE";
    const products = await listProductsByVendor(vendorName);
    const changed = [];
    const skipped = [];
    const failed = [];

    for (const product of products) {
      if (String(product.status || "").toUpperCase() === finalStatus) {
        skipped.push({
          id: product.id,
          title: product.title || "",
          status: product.status || ""
        });
        continue;
      }

      try {
        const data = await vendorAdminGraphQL(PRODUCT_STATUS_UPDATE, {
          product: {
            id: product.id,
            status: finalStatus
          }
        });
        const err = data?.productUpdate?.userErrors?.[0];
        if (err) throw new Error(err.message || "فشل تحديث المنتج");
        const updated = data?.productUpdate?.product || {};
        changed.push({
          id: updated.id || product.id,
          title: updated.title || product.title || "",
          status: updated.status || finalStatus
        });
      } catch (e) {
        failed.push({
          id: product.id,
          title: product.title || "",
          error: e.message || String(e)
        });
      }
    }

    return {
      total: products.length,
      changed,
      skipped,
      failed
    };
  }

  function isDescriptionTranslationKey(key) {
    const k = String(key || "").trim().toLowerCase();
    return (
      k === "description" ||
      k.endsWith(".description") ||
      k.endsWith("_description") ||
      k.includes("description")
    );
  }

  async function getVendorDescriptionTranslationInfo(resourceId, locale = "en") {
    const data = await vendorAdminGraphQL(TRANSLATABLE_RESOURCE_QUERY, {
      resourceId,
      locale
    });

    const resource = data?.translatableResource || null;
    if (!resource) return null;

    const contentRows = Array.isArray(resource.translatableContent)
      ? resource.translatableContent
      : [];

    const translationRows = Array.isArray(resource.translations)
      ? resource.translations
      : [];

    const content = contentRows.find((row) => isDescriptionTranslationKey(row?.key)) || null;
    const translation = translationRows.find((row) => isDescriptionTranslationKey(row?.key)) || null;

    if (!content) {
      return {
        resourceId,
        key: "",
        digest: "",
        sourceValue: "",
        translatedValue: translation?.value || ""
      };
    }

    return {
      resourceId,
      key: content.key || "",
      digest: content.digest || "",
      sourceValue: content.value || "",
      translatedValue: translation?.value || ""
    };
  }

  async function registerVendorDescriptionTranslation({
    resourceId,
    translatedValue,
    locale = "en"
  }) {
    const value = String(translatedValue || "").trim();
    if (!value) {
      return { ok: true, skipped: true, reason: "EMPTY_TRANSLATION" };
    }

    const info = await getVendorDescriptionTranslationInfo(resourceId, locale);

    if (!info?.key || !info?.digest) {
      return { ok: true, skipped: true, reason: "DESCRIPTION_KEY_NOT_FOUND" };
    }

    const data = await vendorAdminGraphQL(TRANSLATIONS_REGISTER_MUTATION, {
      resourceId,
      translations: [{
        locale,
        key: info.key,
        value,
        translatableContentDigest: info.digest
      }]
    });

    const err = data?.translationsRegister?.userErrors?.[0];
    if (err) {
      throw new Error(err.message || "فشل حفظ الترجمة الإنجليزية");
    }

    return {
      ok: true,
      key: info.key,
      locale,
      value
    };
  }
  async function listAllVendorMetaobjects() {
    const def = await resolveVendorDefinition();
    const data = await vendorAdminGraphQL(VENDOR_METAOBJECTS_QUERY, { type: def.type });
    const nodes = data?.metaobjects?.nodes || [];

    const items = await Promise.all(
      nodes.map(async (node) => {
        const map = {};
        for (const f of node.fields || []) map[f.key] = f;

        let descriptionEn = "";
        try {
          const tr = await getVendorDescriptionTranslationInfo(node.id, "en");
          descriptionEn = tr?.translatedValue || "";
        } catch {
          descriptionEn = "";
        }

        return {
          id: node.id,
          handle: node.handle || "",
          displayName: node.displayName || "",
          type: node.type || "",
          status: node?.capabilities?.publishable?.status || "",
          name: map.name?.value || node.displayName || "",
          link: map.link?.value || "",
          description: map.description?.value || "",
          descriptionEn,
          imageUrl: map.image?.reference?.image?.url || "",
          imageId: map.image?.reference?.id || map.image?.value || "",
          collectionId: map.collection?.reference?.id || map.collection?.value || ""
        };
      })
    );

    items.sort((a, b) => a.name.localeCompare(b.name, "ar"));
    return { definition: def, items };
  }
  
  async function upsertVendorMetaobject({
    handle,
    brandName,
    imageFileId,
    brandLink,
    description
  }) {
    const def = await resolveVendorDefinition();

    const fields = [
      { key: def.keys.name, value: brandName },
      { key: def.keys.image, value: imageFileId },
      { key: def.keys.link, value: brandLink }
    ];

    if (def.keys.description) {
      fields.push({ key: def.keys.description, value: safeVendorDescription(description) });
    }

    const data = await vendorAdminGraphQL(VENDOR_METAOBJECT_UPSERT, {
      handle: {
        type: def.type,
        handle: handle || slugifyVendorHandle(brandName) || `vendor-${Date.now()}`
      },
      metaobject: { fields }
    });

    const err = data?.metaobjectUpsert?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل إنشاء/تحديث Vendor metaobject");

    const metaobject = data?.metaobjectUpsert?.metaobject || null;
    if (!metaobject?.id) throw new Error("لم يتم إرجاع metaobject id");

    const active = await ensureVendorActive(metaobject.id);
    return active || metaobject;
  }

  const PAGES_QUERY = `
    query PagesList($query: String!) {
      pages(first: 25, query: $query, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          metafield(namespace: "${BRANDS_METAFIELD_NAMESPACE}", key: "${BRANDS_METAFIELD_KEY}") {
            id
            type
            value
            references(first: 250) {
              nodes {
                ... on Metaobject {
                  id
                  handle
                  type
                  displayName
                }
              }
            }
          }
        }
      }
    }
  `;

  const METAFIELDS_SET_MUTATION = `
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          key
          namespace
          type
          value
        }
        userErrors { field message code }
      }
    }
  `;

  async function resolveBrandsPage() {
    const byHandle = await vendorAdminGraphQL(PAGES_QUERY, { query: `handle:${BRANDS_PAGE_HANDLE}` });
    const pageByHandle = (byHandle?.pages?.nodes || []).find((p) => vendorSameText(p?.handle, BRANDS_PAGE_HANDLE));
    if (pageByHandle) return pageByHandle;

    const byAr = await vendorAdminGraphQL(PAGES_QUERY, { query: `title:${BRANDS_PAGE_TITLE_AR}` });
    const pageByAr = (byAr?.pages?.nodes || []).find((p) => vendorSameText(p?.title, BRANDS_PAGE_TITLE_AR));
    if (pageByAr) return pageByAr;

    const byEn = await vendorAdminGraphQL(PAGES_QUERY, { query: `title:${BRANDS_PAGE_TITLE_EN}` });
    const pageByEn = (byEn?.pages?.nodes || []).find((p) => vendorSameText(p?.title, BRANDS_PAGE_TITLE_EN));
    if (pageByEn) return pageByEn;

    throw new Error("لم أجد صفحة الماركات");
  }

  async function ensureVendorLinkedToBrandsPage(metaobjectId) {
    const page = await resolveBrandsPage();
    const refs = page?.metafield?.references?.nodes || [];
    const already = refs.some((x) => String(x?.id || "") === String(metaobjectId || ""));
    if (already) return { action: "exists", page };

    const currentIds = refs.map((x) => String(x?.id || "")).filter(Boolean);
    const nextIds = [...new Set([...currentIds, String(metaobjectId)])];
    const mfType = String(page?.metafield?.type || "").trim() || "list.metaobject_reference";

    const set = await vendorAdminGraphQL(METAFIELDS_SET_MUTATION, {
      metafields: [{
        ownerId: page.id,
        namespace: BRANDS_METAFIELD_NAMESPACE,
        key: BRANDS_METAFIELD_KEY,
        type: mfType,
        value: JSON.stringify(nextIds)
      }]
    });

    const err = set?.metafieldsSet?.userErrors?.[0];
    if (err) throw new Error(err.message || "فشل ربط الـ Vendor بصفحة الماركات");

    return { action: "linked", page };
  }

  router.get("/staff/vendors/list", requireProductsStaff, async (req, res) => {
    try {
      const out = await listAllVendorMetaobjects();
      return res.json({
        ok: true,
        type: out.definition.type,
        items: out.items
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e.message || String(e)
      });
    }
  });

  router.post("/staff/vendors/check", requireProductsStaff, async (req, res) => {
    try {
      const brandName = normalizeVendorBrandName(req.body?.brandName);
      if (!brandName) {
        return res.status(400).json({ ok: false, error: "brandName مطلوب" });
      }

      const menu = await resolveVendorMenu();
      const items = flattenVendorMenuItems(menu.items || []);
      const found = items.find((x) => vendorSameText(x?.title, brandName)) || null;

      return res.json({
        ok: true,
        brandName,
        menuHandle: menu.handle,
        existsInMenu: !!found,
        item: found ? { title: found.title, type: found.type, url: found.url } : null
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e.message || String(e)
      });
    }
  });

  router.post(
    "/staff/vendors/create-or-sync",
    requireProductsStaff,
    upload.single("image"),
    async (req, res) => {
      try {
        const brandName = normalizeVendorBrandName(req.body?.brandName);
        const description = safeVendorDescription(req.body?.description || "");
        const descriptionEn = vendorOneLine(req.body?.descriptionEn || "");
        const customLink = vendorOneLine(req.body?.link || "");
        const brandLink = customLink || buildVendorCollectionUrl(brandName);

        if (!brandName) {
          return res.status(400).json({ ok: false, error: "brandName مطلوب" });
        }
        if (!req.file?.buffer) {
          return res.status(400).json({ ok: false, error: "image مطلوب" });
        }

        const uploaded = await uploadVendorImageToShopify({ brandName, file: req.file });

        const menu = await upsertBrandImageInMenu({
          brandName,
          imageUrl: uploaded.imageUrl
        });

        const metaobject = await upsertVendorMetaobject({
          brandName,
          imageFileId: uploaded.fileId,
          brandLink,
          description
        });

        const translationResult = await registerVendorDescriptionTranslation({
          resourceId: metaobject.id,
          translatedValue: descriptionEn,
          locale: "en"
        });

        const pageLink = await ensureVendorLinkedToBrandsPage(metaobject.id);

        return res.json({
          ok: true,
          brandName,
          uploadedTo: "shopify",
          shopifyFileId: uploaded.fileId,
          imageUrl: uploaded.imageUrl,
          fileStatus: uploaded.fileStatus,
          menu,
          vendorMetaobject: {
            id: metaobject?.id || "",
            handle: metaobject?.handle || "",
            displayName: metaobject?.displayName || "",
            status: metaobject?.capabilities?.publishable?.status || "ACTIVE",
            link: brandLink,
            description,
            descriptionEn
          },
          brandsPage: {
            action: pageLink.action,
            handle: pageLink.page?.handle || "",
            metafield: `${BRANDS_METAFIELD_NAMESPACE}.${BRANDS_METAFIELD_KEY}`
          },
          translation: translationResult
        });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: e.message || String(e)
        });
      }
    }
  );

  
  router.post(
    "/staff/vendors/update",
    requireProductsStaff,
    upload.single("image"),
    async (req, res) => {
      try {
        const metaobjectId = vendorOneLine(req.body?.id);
        const currentHandle = vendorOneLine(req.body?.handle);
        const brandName = normalizeVendorBrandName(req.body?.brandName);
        const currentImageId = vendorOneLine(req.body?.currentImageId);
        const description = safeVendorDescription(req.body?.description || "");
        const descriptionEn = vendorOneLine(req.body?.descriptionEn || "");
        const customLink = vendorOneLine(req.body?.link || "");
        const finalLink = customLink || buildVendorCollectionUrl(brandName);

        if (!metaobjectId) {
          return res.status(400).json({ ok: false, error: "id مطلوب" });
        }
        if (!brandName) {
          return res.status(400).json({ ok: false, error: "brandName مطلوب" });
        }

        let finalImageId = currentImageId;
        let finalImageUrl = "";
        let uploaded = null;

        if (req.file?.buffer) {
          uploaded = await uploadVendorImageToShopify({ brandName, file: req.file });
          finalImageId = uploaded.fileId;
          finalImageUrl = uploaded.imageUrl;
        }

        if (!finalImageId) {
          return res.status(400).json({ ok: false, error: "لا توجد صورة حالية أو جديدة" });
        }

        const metaobject = await upsertVendorMetaobject({
          handle: currentHandle || slugifyVendorHandle(brandName),
          brandName,
          imageFileId: finalImageId,
          brandLink: finalLink,
          description
        });

        if (finalImageUrl) {
          await upsertBrandImageInMenu({
            brandName,
            imageUrl: finalImageUrl
          });
        }

        const translationResult = await registerVendorDescriptionTranslation({
          resourceId: metaobject.id,
          translatedValue: descriptionEn,
          locale: "en"
        });

        const pageLink = await ensureVendorLinkedToBrandsPage(metaobject.id);

        return res.json({
          ok: true,
          vendorMetaobject: {
            id: metaobject?.id || metaobjectId,
            handle: metaobject?.handle || currentHandle,
            displayName: metaobject?.displayName || brandName,
            status: metaobject?.capabilities?.publishable?.status || "ACTIVE",
            link: finalLink,
            description,
            descriptionEn,
            imageId: finalImageId,
            imageUrl: finalImageUrl || ""
          },
          menuSynced: !!finalImageUrl,
          brandsPage: {
            action: pageLink.action,
            handle: pageLink.page?.handle || "",
            metafield: `${BRANDS_METAFIELD_NAMESPACE}.${BRANDS_METAFIELD_KEY}`
          },
          translation: translationResult
        });
      } catch (e) {
        return res.status(500).json({
          ok: false,
          error: e.message || String(e)
        });
      }
    }
  );

  router.post("/staff/vendors/status", requireProductsStaff, async (req, res) => {
    try {
      const metaobjectId = vendorOneLine(req.body?.id);
      const brandName = normalizeVendorBrandName(req.body?.brandName);
      const statusRaw = String(req.body?.status || "").trim().toUpperCase();
      const status = statusRaw === "DRAFT" ? "DRAFT" : "ACTIVE";

      if (!metaobjectId) {
        return res.status(400).json({ ok: false, error: "id مطلوب" });
      }
      if (!brandName) {
        return res.status(400).json({ ok: false, error: "brandName مطلوب" });
      }

      const [metaobject, products] = await Promise.all([
        setVendorPublishStatus(metaobjectId, status),
        updateProductsVendorStatus(brandName, status)
      ]);

      return res.json({
        ok: true,
        brandName,
        status,
        metaobject: {
          id: metaobject?.id || metaobjectId,
          handle: metaobject?.handle || "",
          displayName: metaobject?.displayName || brandName,
          status: metaobject?.capabilities?.publishable?.status || status
        },
        products
      });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: e.message || String(e)
      });
    }
  });

  
  return router;
}
