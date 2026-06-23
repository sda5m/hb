import express from "express";
import fetch from "node-fetch";

export default function inventoryRouter({ getRedis }) {
  const router = express.Router();

  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-01";

  function assertEnv(res) {
    if (!SHOP || !TOKEN) {
      res.status(500).json({ error: "Missing SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN env vars" });
      return false;
    }
    return true;
  }

  async function adminGraphQL(query, variables = {}) {
    const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.errors?.[0]?.message || `Shopify GraphQL HTTP ${r.status}`);
    if (data?.errors?.length) throw new Error(data.errors[0]?.message || "Shopify GraphQL error");
    return data.data;
  }

  async function getDefaultLocationId() {
    const q = `
      query {
        locations(first: 1) {
          edges { node { id name } }
        }
      }
    `;
    const d = await adminGraphQL(q);
    const loc = d?.locations?.edges?.[0]?.node;
    if (!loc?.id) throw new Error("No locations found in this store");
    return loc.id;
  }

  function buildSoldoutQuery(qRaw) {
    const base = `inventory_quantity:<=0 AND managed_by:shopify`;

    const q = (qRaw || "").toString().trim();
    if (!q) return base;

    const qSafe = q.replace(/"/g, '\\"');

    const search =
      `(` +
      `sku:${qSafe} OR barcode:${qSafe} OR title:*${qSafe}* OR product_title:*${qSafe}*` +
      `)`;

    return `${base} AND ${search}`;
  }

  async function fetchSoldoutChunk({ queryStr, limit, after }) {
    const first = Math.min(Math.max(limit, 1), 50);

    const gql = `
      query($first:Int!, $query:String!, $after:String) {
        productVariants(first:$first, after:$after, query:$query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            cursor
            node {
              id
              title
              sku
              barcode
              inventoryQuantity
              product {
                id
                title
                handle
                featuredImage { url }
              }
              inventoryItem {
                id
                tracked
                updatedAt
              }
              image { url }
            }
          }
        }
      }
    `;

    const d = await adminGraphQL(gql, {
      first,
      query: queryStr,
      after: after || null,
    });

    const conn = d?.productVariants;

    return {
      hasNextPage: Boolean(conn?.pageInfo?.hasNextPage),
      endCursor: conn?.pageInfo?.endCursor || null,
      edges: Array.isArray(conn?.edges) ? conn.edges : [],
    };
  }

  async function getSoldoutTotal(queryStr) {
    const gql = `
      query($query:String!, $limit:Int) {
        productVariantsCount(query:$query, limit:$limit) {
          count
          precision
        }
      }
    `;
    const d = await adminGraphQL(gql, { query: queryStr, limit: 10000 });
    return Number(d?.productVariantsCount?.count ?? 0);
  }

  function mapVariantToItem(node, productNode) {
    const tracked = Boolean(node?.inventoryItem?.tracked);
    const invQty = node?.inventoryQuantity;

    return {
      variantId: node?.id,
      productId: productNode?.id || null,
      productTitle: productNode?.title || "",
      productHandle: productNode?.handle || "",
      vendor: productNode?.vendor || "",
      tags: Array.isArray(productNode?.tags) ? productNode.tags : [],
      variantTitle: node?.title || "",
      sku: node?.sku || "",
      barcode: node?.barcode || "",
      price: node?.price ?? null,
      compareAtPrice: node?.compareAtPrice ?? null,
      tracked,
      inventoryItemId: node?.inventoryItem?.id || null,
      available: tracked ? Number(invQty ?? 0) : null,
      image: node?.image?.url || productNode?.featuredImage?.url || "",
      updatedAt: node?.inventoryItem?.updatedAt || null,
    };
  }

  const pageCursorCache = new Map();
  const soldoutRankCache = new Map();
  const SOLDOUT_RANK_TTL_MS = 60 * 1000;

  function backInStockKey(targetId) {
    return `bt:backinstock:subs:${String(targetId || "").trim()}`;
  }

  async function getBackInStockQueueMapDirect() {
    const r = await getRedis();
    const map = new Map();
    if (!r) return map;

    const targetIds = await r.sMembers("bt:backinstock:index");
    if (!Array.isArray(targetIds) || !targetIds.length) return map;

    for (const targetIdRaw of targetIds) {
      const targetId = String(targetIdRaw || "").trim();
      if (!targetId) continue;

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

      const pending = list.filter(x => x && typeof x === "object" && !x.sent);
      map.set(targetId, {
        queueCount: pending.length
      });
    }

    return map;
  }

  function mapSoldoutNode(node) {
    return {
      variantId: node.id,
      productId: node.product?.id || null,
      productTitle: node.product?.title || "",
      productHandle: node.product?.handle || "",
      variantTitle: node.title || "",
      sku: node.sku || "",
      barcode: node.barcode || "",
      inventoryQuantity: Number(node.inventoryQuantity || 0),
      inventoryItemId: node.inventoryItem?.id || null,
      tracked: Boolean(node.inventoryItem?.tracked),
      available: Boolean(node.inventoryItem?.tracked)
        ? Number(node.inventoryQuantity ?? 0)
        : null,
      image: node.image?.url || node.product?.featuredImage?.url || "",
      outOfStockAt: node.inventoryItem?.updatedAt || null,
    };
  }

  async function fetchAllSoldoutForRanking(queryStr, hardLimit = 400) {
    const items = [];
    let after = null;
    let rounds = 0;

    while (items.length < hardLimit && rounds < 12) {
      rounds += 1;

      const chunk = await fetchSoldoutChunk({
        queryStr,
        limit: 50,
        after
      });

      const mapped = chunk.edges
        .map(({ node }) => mapSoldoutNode(node))
        .filter(x => x.tracked);

      items.push(...mapped);

      if (!chunk.hasNextPage) break;
      after = chunk.endCursor || null;
      if (!after) break;
    }

    return items.slice(0, hardLimit);
  }

  function rankSoldoutItems(items, queueMap) {
    const ranked = items.map((it) => {
      const variantId = String(it?.variantId || "").trim();
      const queueCount = Number(queueMap.get(variantId)?.queueCount || 0) || 0;

      return {
        ...it,
        queueCount,
        hasAlertQueue: queueCount > 0
      };
    });

    ranked.sort((a, b) => {
      const aHas = a.hasAlertQueue ? 1 : 0;
      const bHas = b.hasAlertQueue ? 1 : 0;
      if (bHas !== aHas) return bHas - aHas;

      const qDiff = Number(b.queueCount || 0) - Number(a.queueCount || 0);
      if (qDiff !== 0) return qDiff;

      const tb = b.outOfStockAt ? Date.parse(b.outOfStockAt) : 0;
      const ta = a.outOfStockAt ? Date.parse(a.outOfStockAt) : 0;
      if (tb !== ta) return tb - ta;

      return String(a.productTitle || "").localeCompare(String(b.productTitle || ""), "ar");
    });

    return ranked;
  }

  router.get("/inventory/out-of-stock", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
      const sampleSize = 100;
      const queryStr = `inventory_quantity:<=0 AND managed_by:shopify`;

      const q = `
        query($first:Int!, $query:String!) {
          productVariants(first:$first, query:$query) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                product {
                  id
                  title
                  handle
                  vendor
                  tags
                  featuredImage { url }
                }
                inventoryItem { id tracked updatedAt }
                image { url }
              }
            }
          }
        }
      `;

      const d = await adminGraphQL(q, { first: sampleSize, query: queryStr });
      const edges = d?.productVariants?.edges || [];

      let items = edges.map(({ node }) => ({
        variantId: node.id,
        productId: node.product?.id || null,
        productTitle: node.product?.title || "",
        productHandle: node.product?.handle || "",
        variantTitle: node.title || "",
        sku: node.sku || "",
        barcode: node.barcode || "",
        inventoryQuantity: Number(node.inventoryQuantity || 0),
        inventoryItemId: node.inventoryItem?.id || null,
        tracked: Boolean(node.inventoryItem?.tracked),
        image: node.image?.url || node.product?.featuredImage?.url || "",
        outOfStockAt: node.inventoryItem?.updatedAt || null,
      }));

      items = items.filter(x => x.tracked);

      items.sort((a, b) => {
        const tb = b.outOfStockAt ? Date.parse(b.outOfStockAt) : 0;
        const ta = a.outOfStockAt ? Date.parse(a.outOfStockAt) : 0;
        return tb - ta;
      });

      items = items.slice(0, limit);

      return res.json({ query: queryStr, count: items.length, items });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/inventory/search", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const qRaw = (req.query.q || "").toString().trim();
      if (!qRaw) return res.json({ q: qRaw, count: 0, items: [] });

      const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 50);
      const qSafe = qRaw.replace(/"/g, '\\"');

      const variantsQueryStr =
        `(` +
        `sku:${qSafe} OR barcode:${qSafe} OR title:*${qSafe}* OR product_title:*${qSafe}*` +
        `)`;

      const gqlVariants = `
        query($first:Int!, $query:String!) {
          productVariants(first:$first, query:$query) {
            edges {
              node {
                id
                title
                sku
                barcode
                inventoryQuantity
                product {
                  id
                  title
                  handle
                  vendor
                  tags
                  featuredImage { url }
                }
                inventoryItem { id tracked updatedAt }
                image { url }
              }
            }
          }
        }
      `;

      const dV = await adminGraphQL(gqlVariants, { first: limit, query: variantsQueryStr });
      const vEdges = dV?.productVariants?.edges || [];
      const itemsFromVariants = vEdges.map(({ node }) =>
        mapVariantToItem(node, node?.product || {})
      );

      const productQueryStr =
        `(` +
        `title:*${qSafe}* OR handle:*${qSafe}* OR vendor:*${qSafe}* OR tag:*${qSafe}*` +
        `)`;

      const gqlProducts = `
        query($first:Int!, $query:String!, $vFirst:Int!) {
          products(first:$first, query:$query) {
            edges {
              node {
                id
                title
                handle
                vendor
                tags
                featuredImage { url }
                variants(first:$vFirst) {
                  edges {
                    node {
                      id
                      title
                      sku
                      barcode
                      inventoryQuantity
                      price
                      compareAtPrice
                      inventoryItem { id tracked updatedAt }
                      image { url }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const productsFirst = Math.min(20, limit);
      const variantsPerProduct = 10;

      const dP = await adminGraphQL(gqlProducts, {
        first: productsFirst,
        query: productQueryStr,
        vFirst: variantsPerProduct,
      });

      const pEdges = dP?.products?.edges || [];
      const itemsFromProducts = [];
      for (const e of pEdges) {
        const p = e?.node;
        const v = p?.variants?.edges || [];
        for (const ve of v) {
          itemsFromProducts.push(mapVariantToItem(ve?.node, p));
        }
      }

      const all = [...itemsFromVariants, ...itemsFromProducts].filter(x => x?.variantId);

      const seen = new Set();
      const merged = [];
      for (const it of all) {
        const key = String(it.variantId);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(it);
        if (merged.length >= limit) break;
      }

      return res.json({
        q: qRaw,
        queries: {
          variants: variantsQueryStr,
          products: productQueryStr,
        },
        count: merged.length,
        items: merged,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/inventory/restock", express.json(), async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const inventoryItemId = (req.body?.inventoryItemId || "").toString().trim();
      const delta = Number(req.body?.delta);

      if (!inventoryItemId) return res.status(400).json({ error: "inventoryItemId مطلوب" });
      if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: "delta لازم يكون رقم (مثال -3 أو 5)" });

      const locationId =
        (req.body?.locationId || "").toString().trim() || (await getDefaultLocationId());

      const qTrack = `
        query($id:ID!) {
          inventoryItem(id:$id) { id tracked }
        }
      `;
      const d0 = await adminGraphQL(qTrack, { id: inventoryItemId });
      const inv = d0?.inventoryItem;
      if (!inv?.id) return res.status(404).json({ error: "InventoryItem غير موجود" });

      if (inv.tracked === false) {
        const mTrack = `
          mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem { id tracked }
              userErrors { field message }
            }
          }
        `;

        const dT = await adminGraphQL(mTrack, {
          id: inventoryItemId,
          input: { tracked: true },
        });

        const terrs = dT?.inventoryItemUpdate?.userErrors || [];
        if (terrs.length) {
          return res.status(400).json({
            error: terrs[0]?.message || "فشل تفعيل التتبع",
            userErrors: terrs
          });
        }
      }

      const m = `
        mutation($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
            userErrors { field message }
            inventoryAdjustmentGroup {
              id
              createdAt
              changes { name delta quantityAfterChange }
            }
          }
        }
      `;

      const input = {
        name: "available",
        reason: "correction",
        changes: [{ inventoryItemId, locationId, delta }],
      };

      const d = await adminGraphQL(m, { input });

      const errs = d?.inventoryAdjustQuantities?.userErrors || [];
      if (errs.length) {
        return res.status(400).json({ error: errs[0]?.message || "User error", userErrors: errs });
      }

      const changes = d?.inventoryAdjustQuantities?.inventoryAdjustmentGroup?.changes || [];
      const after = changes?.[0]?.quantityAfterChange;

      soldoutRankCache.clear();

      return res.json({
        ok: true,
        locationId,
        available: Number(after ?? null),
        result: d.inventoryAdjustQuantities.inventoryAdjustmentGroup,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/inventory/set-qty", express.json(), async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const inventoryItemId = (req.body?.inventoryItemId || "").toString().trim();
      const qty = Number(req.body?.qty);

      if (!inventoryItemId) return res.status(400).json({ error: "inventoryItemId مطلوب" });
      if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: "qty لازم يكون رقم >= 0" });

      const locationId =
        (req.body?.locationId || "").toString().trim() || (await getDefaultLocationId());

      const q = `
        query($id:ID!) {
          inventoryItem(id:$id) {
            id
            tracked
            inventoryLevels(first: 50) {
              edges {
                node {
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      `;
      const d0 = await adminGraphQL(q, { id: inventoryItemId });
      const inv = d0?.inventoryItem;
      if (!inv?.id) return res.status(404).json({ error: "InventoryItem غير موجود" });

      if (inv.tracked === false) {
        const mTrack = `
          mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
            inventoryItemUpdate(id: $id, input: $input) {
              inventoryItem { id tracked }
              userErrors { field message }
            }
          }
        `;

        const dT = await adminGraphQL(mTrack, {
          id: inventoryItemId,
          input: { tracked: true },
        });

        const terrs = dT?.inventoryItemUpdate?.userErrors || [];
        if (terrs.length) {
          return res.status(400).json({
            error: terrs[0]?.message || "فشل تفعيل التتبع",
            userErrors: terrs
          });
        }
      }

      const levels = inv?.inventoryLevels?.edges || [];
      const levelNode = levels.map(e => e.node).find(n => String(n?.location?.id) === String(locationId));
      const currentQtyObj = levelNode?.quantities?.find(x => x?.name === "available");
      const current = Number(currentQtyObj?.quantity ?? 0);

      const delta = qty - current;

      if (delta === 0) {
        return res.json({ ok: true, locationId, inventoryItemId, delta: 0, available: current });
      }

      const m = `
        mutation($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
            userErrors { field message }
            inventoryAdjustmentGroup {
              id
              createdAt
              changes { name delta quantityAfterChange }
            }
          }
        }
      `;

      const input = {
        name: "available",
        reason: "correction",
        changes: [{ inventoryItemId, locationId, delta }],
      };

      const d1 = await adminGraphQL(m, { input });

      const errs = d1?.inventoryAdjustQuantities?.userErrors || [];
      if (errs.length) {
        return res.status(400).json({ error: errs[0]?.message || "User error", userErrors: errs });
      }

      const changes = d1?.inventoryAdjustQuantities?.inventoryAdjustmentGroup?.changes || [];
      const after = changes?.[0]?.quantityAfterChange;
      const available = Number(after ?? qty);

      soldoutRankCache.clear();

      return res.json({ ok: true, locationId, inventoryItemId, delta, available });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/inventory/set-price", express.json(), async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const variantId = (req.body?.variantId || "").toString().trim();
      const priceRaw = req.body?.price;
      const compareRaw = req.body?.compareAtPrice;

      if (!variantId) return res.status(400).json({ error: "variantId مطلوب" });

      const priceNum = Number(priceRaw);
      if (!Number.isFinite(priceNum) || priceNum < 0) {
        return res.status(400).json({ error: "price لازم يكون رقم >= 0" });
      }
      const price = String(priceNum);

      let compareAtPrice = null;
      if (compareRaw !== undefined && compareRaw !== null && String(compareRaw).trim() !== "") {
        const cNum = Number(compareRaw);
        if (!Number.isFinite(cNum) || cNum < 0) {
          return res.status(400).json({ error: "compareAtPrice لازم يكون رقم >= 0" });
        }
        compareAtPrice = String(cNum);
      }

      const q = `
        query($id:ID!) {
          node(id:$id) {
            ... on ProductVariant {
              id
              product { id }
            }
          }
        }
      `;
      const d0 = await adminGraphQL(q, { id: variantId });
      const productId = d0?.node?.product?.id;
      if (!productId) return res.status(404).json({ error: "لم يتم العثور على productId لهذا الـ variantId" });

      const m = `
        mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            product { id }
            productVariants { id price compareAtPrice }
            userErrors { field message }
          }
        }
      `;

      const variants = [
        {
          id: variantId,
          price,
          ...(compareAtPrice !== null ? { compareAtPrice } : {}),
        },
      ];

      const d1 = await adminGraphQL(m, { productId, variants });

      const errs = d1?.productVariantsBulkUpdate?.userErrors || [];
      if (errs.length) {
        return res.status(400).json({
          error: errs[0]?.message || "فشل تحديث السعر",
          userErrors: errs,
        });
      }

      const updated = (d1?.productVariantsBulkUpdate?.productVariants || []).find(v => String(v.id) === String(variantId));

      return res.json({
        engine: "soldout-v2-tracked",
        ok: true,
        variantId,
        productId,
        price: updated?.price ?? price,
        compareAtPrice: updated?.compareAtPrice ?? null,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/inventory/soldout", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
      const page = Math.min(Math.max(Number(req.query.page) || 1, 1), 5000);
      const qRaw = (req.query.q || "").toString();

      const queryStr = buildSoldoutQuery(qRaw);
      const cacheKey = `${queryStr}::limit=${limit}`;

      let entry = pageCursorCache.get(cacheKey);
      if (!entry) {
        entry = { starts: new Map([[1, null]]), updatedAt: Date.now() };
        pageCursorCache.set(cacheKey, entry);
      }

      if (Date.now() - entry.updatedAt > 30 * 60 * 1000) {
        entry.starts = new Map([[1, null]]);
        entry.updatedAt = Date.now();
      }

      async function collectTrackedPage(startAfter) {
        const chunk = await fetchSoldoutChunk({
          queryStr,
          limit,
          after: startAfter || null,
        });

        const items = chunk.edges.map(({ node }) => ({
          variantId: node.id,
          productId: node.product?.id || null,
          productTitle: node.product?.title || "",
          productHandle: node.product?.handle || "",
          variantTitle: node.title || "",
          sku: node.sku || "",
          barcode: node.barcode || "",
          inventoryQuantity: Number(node.inventoryQuantity || 0),
          inventoryItemId: node.inventoryItem?.id || null,
          tracked: Boolean(node.inventoryItem?.tracked),
          available: Boolean(node.inventoryItem?.tracked)
            ? Number(node.inventoryQuantity ?? 0)
            : null,
          image: node.image?.url || node.product?.featuredImage?.url || "",
          outOfStockAt: node.inventoryItem?.updatedAt || null,
        }));

        return {
          items,
          nextStart: chunk.hasNextPage ? chunk.endCursor : null,
        };
      }

      for (let p = 1; p < page; p++) {
        if (entry.starts.has(p + 1)) continue;

        const start = entry.starts.get(p) ?? null;
        const { nextStart } = await collectTrackedPage(start);

        entry.starts.set(p + 1, nextStart);
        entry.updatedAt = Date.now();

        if (!nextStart) break;
      }

      const startAfter = entry.starts.get(page) ?? null;
      const { items, nextStart } = await collectTrackedPage(startAfter);

      if (!entry.starts.has(page + 1)) {
        entry.starts.set(page + 1, nextStart ?? null);
        entry.updatedAt = Date.now();
      }

      const total = await getSoldoutTotal(queryStr);

      return res.json({
        engine: "soldout-v2-tracked",
        q: qRaw,
        query: queryStr,
        page,
        limit,
        total,
        count: items.length,
        items,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.get("/inventory/soldout-ranked", async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
      const page = Math.min(Math.max(Number(req.query.page) || 1, 1), 5000);
      const qRaw = (req.query.q || "").toString();

      const queryStr = buildSoldoutQuery(qRaw);
      const cacheKey = `ranked::${queryStr}`;
      const now = Date.now();

      let cacheEntry = soldoutRankCache.get(cacheKey);

      if (!cacheEntry || (now - cacheEntry.updatedAt > SOLDOUT_RANK_TTL_MS)) {
        const [rawItems, queueMap] = await Promise.all([
          fetchAllSoldoutForRanking(queryStr, 400),
          getBackInStockQueueMapDirect()
        ]);

        const ranked = rankSoldoutItems(rawItems, queueMap);

        cacheEntry = {
          items: ranked,
          total: ranked.length,
          updatedAt: now
        };

        soldoutRankCache.set(cacheKey, cacheEntry);
      }

      const start = (page - 1) * limit;
      const end = start + limit;
      const pageItems = cacheEntry.items.slice(start, end);

      return res.json({
        engine: "soldout-ranked-v1",
        q: qRaw,
        query: queryStr,
        page,
        limit,
        total: cacheEntry.total,
        count: pageItems.length,
        items: pageItems
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  router.post("/inventory/set-draft", express.json(), async (req, res) => {
    try {
      if (!assertEnv(res)) return;

      const productId = (req.body?.productId || "").toString().trim();
      if (!productId) {
        return res.status(400).json({ error: "productId مطلوب" });
      }

      const mutation = `
        mutation SetProductDraft($input: ProductInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = await adminGraphQL(mutation, {
        input: {
          id: productId,
          status: "DRAFT"
        }
      });

      const errs = data?.productUpdate?.userErrors || [];
      if (errs.length) {
        return res.status(400).json({
          error: errs[0]?.message || "فشل تحويل المنتج إلى Draft",
          userErrors: errs
        });
      }

      soldoutRankCache.clear();

      return res.json({
        ok: true,
        productId,
        title: data?.productUpdate?.product?.title || "",
        status: data?.productUpdate?.product?.status || "DRAFT"
      });
    } catch (e) {
      return res.status(500).json({ error: e.message || String(e) });
    }
  });

  return router;
}
