export default function requirePackKey(req, res, next) {
  const key = String(req.headers["x-pack-key"] || "").trim();
  const expected = String(process.env.PACK_KEY || "").trim();

  if (!expected) {
    return res.status(500).json({ error: "Missing PACK_KEY env" });
  }

  if (key !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}
