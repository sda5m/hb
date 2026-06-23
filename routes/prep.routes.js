import express from "express";

export default function prepRoutes({ shopifyGraphQL }) {
  const router = express.Router();

  // =========================
  // Helpers
  // =========================
  function cleanQ(s) {
    return String(s || "").trim();
  }

  function mkWideQuery(q) {
    const x = q.replace(/"/g, '\\"');
    return [
      `title:*${x}*`,
      `product_title:*${x}*`,
      `body:*${x}*`,
      `tag:*${x}*`,
      `vendor:*${x}*`,
      `sku:*${x}*`,
      `barcode:*${x}*`
    ].join(" OR ");
  }

  function pickImage(v) {
    return (
      v?.image?.url ||
      v?.product?.featuredImage?.url ||
      v?.product?.images?.nodes?.[0]?.url ||
      ""
    );
  }

  // =========================
  // 🔍 SEARCH
  // =========================
  router.get("/search", async (req, res) => {
    try {
      const q0 = cleanQ(req.query.q);
      const limit = Math.min(Math.max(Number(req.query.limit || 40), 1), 100);
      if (!q0) return res.json({ q: "", items: [] });

      const q = mkWideQuery(q0);

      const query = `
        query ($q: String!, $n: Int!) {
          productVariants(first: $n, query: $q) {
            nodes {
              id
              title
              sku
              barcode
              availableForSale
              price
              image { url altText }
              product {
                id
                title
                vendor
                tags
                featuredImage { url altText }
                images(first: 1) { nodes { url altText } }
              }
            }
          }
        }
      `;

      const data = await shopifyGraphQL(query, { q, n: limit });
      const nodes = data?.productVariants?.nodes || [];

      const items = nodes.map(v => ({
        variantId: v.id,
        variantTitle: v.title || "",
        productTitle: v.product?.title || "",
        vendor: v.product?.vendor || "",
        tags: Array.isArray(v.product?.tags) ? v.product.tags : [],
        sku: v.sku || "",
        barcode: v.barcode || "",
        available: !!v.availableForSale,
        price: v.price || "",
        image: pickImage(v)
      }));

      return res.json({ q: q0, count: items.length, items });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  // =========================
  // 🧾 CREATE ORDER (COD)
  // fields: name + phone + address + city (city required)
  // =========================
router.post("/order", async (req, res) => {
  try {
    const body = req.body || {};

    const customerName = cleanQ(body.customerName);
    const phone = cleanQ(body.phone);
    const address1 = cleanQ(body.address1);
    const city = cleanQ(body.city);

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ error: "السلة فارغة" });

    if (!customerName) return res.status(400).json({ error: "اسم العميل مطلوب" });
    if (!phone) return res.status(400).json({ error: "رقم الهاتف مطلوب" });
    if (!address1) return res.status(400).json({ error: "العنوان مطلوب" });
    if (!city) return res.status(400).json({ error: "المدينة مطلوبة" });

    const lineItems = items
      .map(x => ({
        variantId: String(x.variantId || "").trim(),
        quantity: Math.max(1, Number(x.quantity || 1) || 1)
      }))
      .filter(x => x.variantId);

    if (!lineItems.length) return res.status(400).json({ error: "lineItems غير صحيحة" });

    // ✅ تقسيم الاسم
    const parts = customerName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || customerName;
    const lastName = parts.slice(1).join(" ") || "";

    // =========================
    // 1) حاول تجيب/تنشئ Customer بالهاتف (اختياري)
    // =========================
    let customerId = null;

    // 1.a) Search customer by phone (قد يفشل إذا ما عندك read_customers)
    try {
      const findCustomerQuery = `
        query ($q: String!) {
          customers(first: 1, query: $q) {
            nodes { id }
          }
        }
      `;
      const q = `phone:${phone}`;
      const c = await shopifyGraphQL(findCustomerQuery, { q });
      customerId = c?.customers?.nodes?.[0]?.id || null;
    } catch (_) {
      customerId = null;
    }

    // 1.b) If not found -> create customer (قد يفشل إذا ما عندك write_customers)
    if (!customerId) {
      try {
        const createCustomerMutation = `
          mutation ($input: CustomerInput!) {
            customerCreate(input: $input) {
              customer { id }
              userErrors { field message }
            }
          }
        `;
        const input = {
          firstName,
          lastName: lastName || undefined,
          phone
        };

        const cr = await shopifyGraphQL(createCustomerMutation, { input });
        const er = cr?.customerCreate?.userErrors?.[0];
        if (!er) customerId = cr?.customerCreate?.customer?.id || null;
      } catch (_) {
        customerId = null;
      }
    }

    // =========================
    // 2) Create order (مع customer إذا توفر)
    // =========================
    const orderCreateMutation = `
      mutation ($order: OrderCreateOrderInput!) {
        orderCreate(order: $order) {
          order {
            id
            name
            displayFinancialStatus
            createdAt
            customer { id }
          }
          userErrors { field message }
        }
      }
    `;

    const order = {
      lineItems,
      phone,
      shippingAddress: {
        firstName,
        lastName: lastName || undefined,
        address1,
        city,
        countryCode: "OM",
        phone
      }
    };

    // ✅ اربط العميل إذا موجود
    if (customerId) {
      order.customerId = customerId;
    }

    const data = await shopifyGraphQL(orderCreateMutation, { order });
    const out = data?.orderCreate;

    const err = out?.userErrors?.[0];
    if (err) {
      // إذا سبب الخطأ customerId (صلاحيات/فورمات) نحاول مرة ثانية بدون customerId
      const msg = String(err.message || "");
      const looksCustomerRelated =
        msg.toLowerCase().includes("customer") ||
        (Array.isArray(err.field) && err.field.join(".").toLowerCase().includes("customer"));

      if (looksCustomerRelated && order.customerId) {
        delete order.customerId;

        const data2 = await shopifyGraphQL(orderCreateMutation, { order });
        const out2 = data2?.orderCreate;
        const err2 = out2?.userErrors?.[0];
        if (err2) {
          return res.status(400).json({ error: err2.message, field: err2.field || null });
        }

        return res.json({
          success: true,
          orderId: out2?.order?.id || null,
          orderName: out2?.order?.name || null,
          financialStatus: out2?.order?.displayFinancialStatus || null,
          createdAt: out2?.order?.createdAt || null,
          customerLinked: false
        });
      }

      return res.status(400).json({ error: err.message, field: err.field || null });
    }

    return res.json({
      success: true,
      orderId: out?.order?.id || null,
      orderName: out?.order?.name || null,
      financialStatus: out?.order?.displayFinancialStatus || null,
      createdAt: out?.order?.createdAt || null,
      customerLinked: !!out?.order?.customer?.id
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
});
  return router;
}
