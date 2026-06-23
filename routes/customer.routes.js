import express from "express";
import { getOrderCustomerInfo } from "../shopify/customerInfo.js";

const router = express.Router();

/**
 * GET /api/customer-info?code=9198
 * يرجّع اسم العميل + رقم الهاتف (أفضل خيار من shipping/billing/customer/order)
 */
router.get("/api/customer-info", async (req, res) => {
  try {
    const code = (req.query.code || "").toString().trim();
    if (!code) return res.status(400).json({ error: "ضع رقم الطلب ?code=9198" });

    const result = await getOrderCustomerInfo(code);
    if (!result) return res.status(404).json({ error: "الطلب غير موجود" });

    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});

export default router;
