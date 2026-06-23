import express from "express";

export default function metaEmbeddedRoutes() {
  const router = express.Router();

  router.get("/config", async (req, res) => {
    try {
      return res.json({
        ok: true,
        appId: String(process.env.META_APP_ID || "").trim(),
        configId: String(process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || "").trim()
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
}
