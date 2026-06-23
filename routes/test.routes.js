import express from "express";
import { getOrderWithCustomer } from "../shopify/orderTest.js";

const router = express.Router();

router.get("/order-test", async (req, res) => {
  try {
    const code = req.query.code;

    if (!code) {
      return res.json({ error: "ضع رقم الطلب ?code=1023" });
    }

    const order = await getOrderWithCustomer(code);

    if (!order) {
      return res.json({ error: "الطلب غير موجود" });
    }

    const ship = order.shippingAddress;
    const bill = order.billingAddress;
    const cust = order.customer;

    const customerName =
      ship?.name ||
      bill?.name ||
      cust?.displayName ||
      "غير موجود";

    const phone =
      ship?.phone ||
      bill?.phone ||
      cust?.phone ||
      order.phone ||
      "غير موجود";

    res.json({
      orderName: order.name,
      customerName,
      phone,
      email: order.email || cust?.email || "غير موجود",
      financialStatus: order.displayFinancialStatus,
      total: order.totalPriceSet.shopMoney.amount,
      currency: order.totalPriceSet.shopMoney.currencyCode
    });

  } catch (e) {
    console.error("❌ order-test error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
