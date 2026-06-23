import crypto from "crypto";
import express from "express";
import fetch from "node-fetch";

const DEFAULT_CUSTOMER_ACCOUNT_SHOP_ID = "61939155027";
const DEFAULT_AMWAL_BASE_URL = "https://webhook.amwalpg.com";
const DEFAULT_AMWAL_UAT_BASE_URL = "https://test.amwalpg.com:14443";
const OMR_CURRENCY_ID = 512;

export default function customerCreditAmwalRouter(deps = {}) {
  const router = express.Router();
  const getRedis = deps.getRedis;
  const getFirebaseAdmin = deps.getFirebaseAdmin;

  const SHOP = process.env.SHOPIFY_SHOP;
  const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
  const API_VERSION =
    process.env.SHOPIFY_API_VERSION ||
    process.env.SHOPIFY_GQL_VERSION ||
    "2026-01";
  const CUSTOMER_ACCOUNT_API_VERSION =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION ||
    process.env.SHOPIFY_CUSTOMER_API_VERSION ||
    "2025-07";
  const SHOP_ID =
    process.env.SHOPIFY_CUSTOMER_ACCOUNT_SHOP_ID ||
    process.env.SHOPIFY_SHOP_ID ||
    DEFAULT_CUSTOMER_ACCOUNT_SHOP_ID;

  const AMWAL_ENV = String(process.env.AMWAL_ENV || process.env.AMWAL_SDK_ENV || "PROD")
    .trim()
    .toUpperCase();
  const AMWAL_BASE_URL = String(
    process.env.AMWAL_BASE_URL ||
      (AMWAL_ENV === "UAT" ? DEFAULT_AMWAL_UAT_BASE_URL : DEFAULT_AMWAL_BASE_URL)
  ).replace(/\/+$/, "");
  const AMWAL_SDK_BASE_URL = String(
    process.env.AMWAL_SDK_BASE_URL ||
      (AMWAL_ENV === "UAT" ? DEFAULT_AMWAL_UAT_BASE_URL : AMWAL_BASE_URL)
  ).replace(/\/+$/, "");
  const AMWAL_MERCHANT_ID = String(
    process.env.AMWAL_MERCHANT_ID || "103368"
  ).trim();
  const AMWAL_TERMINAL_ID = String(
    process.env.AMWAL_TERMINAL_ID || "728148"
  ).trim();
  const AMWAL_SECURE_HASH_KEY = String(
    process.env.AMWAL_SECURE_HASH_KEY || ""
  ).trim();
  const AMWAL_MIN_AMOUNT = Number(process.env.AMWAL_WALLET_MIN_AMOUNT || 1);
  const AMWAL_MAX_AMOUNT = Number(process.env.AMWAL_WALLET_MAX_AMOUNT || 1000);
  const AMWAL_REDIRECT_URL = String(
    process.env.AMWAL_REDIRECT_URL || "https://app.halabt.com/wallet"
  ).trim();
  const AMWAL_PAYMENT_TTL_SECONDS = Math.max(
    600,
    Number(process.env.AMWAL_WALLET_PAYMENT_TTL_SECONDS || 86400)
  );

  let customerAccountGraphqlUrl = "";

  function assertEnv(res) {
    if (!SHOP || !TOKEN) {
      res.status(500).json({ ok: false, error: "SHOPIFY_SHOP / SHOPIFY_ADMIN_TOKEN missing" });
      return false;
    }
    if (!AMWAL_SECURE_HASH_KEY) {
      res.status(500).json({ ok: false, error: "AMWAL_SECURE_HASH_KEY missing" });
      return false;
    }
    return true;
  }

  function assertAmwalEnv(res) {
    if (!AMWAL_MERCHANT_ID || !AMWAL_TERMINAL_ID || !AMWAL_SECURE_HASH_KEY) {
      res.status(500).json({
        ok: false,
        error: "AMWAL_MERCHANT_ID / AMWAL_TERMINAL_ID / AMWAL_SECURE_HASH_KEY missing"
      });
      return false;
    }
    return true;
  }

  function cleanAmount(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(n.toFixed(3));
  }

  function amountOutOfRangeMessage(amount) {
    if (amount < AMWAL_MIN_AMOUNT) {
      return `\u0627\u0644\u062d\u062f \u0627\u0644\u0623\u062f\u0646\u0649 \u0644\u0634\u062d\u0646 \u0627\u0644\u0645\u062d\u0641\u0638\u0629 \u0647\u0648 ${AMWAL_MIN_AMOUNT.toFixed(3)} \u0631.\u0639. / Minimum wallet top-up is OMR ${AMWAL_MIN_AMOUNT.toFixed(3)}.`;
    }
    return `\u0627\u0644\u062d\u062f \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0634\u062d\u0646 \u0627\u0644\u0645\u062d\u0641\u0638\u0629 \u0647\u0648 ${AMWAL_MAX_AMOUNT.toFixed(3)} \u0631.\u0639. / Maximum wallet top-up is OMR ${AMWAL_MAX_AMOUNT.toFixed(3)}.`;
  }

  function walletCreditAmount(paidAmount) {
    const amount = cleanAmount(paidAmount);
    let rate = 0;
    if (amount >= 30 && amount < 50) rate = 0.02;
    if (amount >= 50 && amount < 100) rate = 0.05;
    if (amount >= 100 && amount < 200) rate = 0.10;
    if (amount >= 200) rate = 0.20;
    return Number((amount + amount * rate).toFixed(3));
  }

  function isoSeconds(date = new Date()) {
    return date.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function customerNumericId(customerId) {
    const raw = String(customerId || "").trim();
    return raw.includes("/") ? raw.split("/").pop() || raw : raw;
  }

  function makeCustomerGid(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("gid://shopify/Customer/")) return raw;
    const numeric = raw.split("/").pop().replace(/\D+/g, "");
    return numeric ? `gid://shopify/Customer/${numeric}` : "";
  }

  function extractBearer(req) {
    const auth = String(req.headers.authorization || "").trim();
    if (!auth.toLowerCase().startsWith("bearer ")) return "";
    return auth.slice(7).trim();
  }

  function redisKey(reference) {
    return `bt:wallet:amwal:${reference}`;
  }

  function processedKey(reference) {
    return `bt:wallet:amwal:processed:${reference}`;
  }

  function sortedString(params, excluded = []) {
    const skip = new Set(excluded);
    return Object.keys(params)
      .filter((key) => !skip.has(key) && params[key] !== undefined && params[key] !== null)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");
  }

  function secureHash(params, excluded = []) {
    const dataString = sortedString(params, excluded);
    return crypto
      .createHmac("sha256", Buffer.from(AMWAL_SECURE_HASH_KEY, "hex"))
      .update(dataString, "utf8")
      .digest("hex")
      .toUpperCase();
  }

  function verifyWebhookHash(body) {
    const received = String(body?.SecureHash || body?.secureHashValue || "").trim().toUpperCase();
    if (!received) return false;
    const cloudNotificationParams = {
      Amount: body?.Amount,
      AuthorizationDateTime: body?.AuthorizationDateTime,
      CurrencyId: body?.CurrencyId,
      DateTimeLocalTrxn: body?.DateTimeLocalTrxn,
      MerchantId: body?.MerchantId,
      MerchantReference: body?.MerchantReference,
      Message: body?.Message,
      PaidThrough: body?.PaidThrough,
      ResponseCode: body?.ResponseCode,
      SystemReference: body?.SystemReference,
      TerminalId: body?.TerminalId,
      TxnType: body?.TxnType
    };
    const expected = secureHash(cloudNotificationParams);
    try {
      return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  async function redisOrNull() {
    if (typeof getRedis !== "function") return null;
    return await getRedis();
  }

  async function adminGraphQL(query, variables = {}) {
    const url = `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      body: JSON.stringify({ query, variables })
    });
    const text = await r.text();
    const json = JSON.parse(text || "{}");
    if (!r.ok || json?.errors?.length) {
      throw new Error(
        json?.errors?.map((e) => e.message).join(" | ") ||
          `Shopify Admin HTTP ${r.status}`
      );
    }
    return json.data || {};
  }

  async function getCustomerAccountGraphqlUrl() {
    if (customerAccountGraphqlUrl) return customerAccountGraphqlUrl;
    const discoveryUrl = String(
      process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL ||
        "https://account.halabt.com/.well-known/customer-account-api"
    ).trim();
    const r = await fetch(discoveryUrl, {
      method: "GET",
      headers: { Accept: "application/json" }
    }).catch(() => null);
    if (r?.ok) {
      const data = await r.json().catch(() => null);
      if (data?.graphql_api) {
        customerAccountGraphqlUrl = String(data.graphql_api);
        return customerAccountGraphqlUrl;
      }
    }
    customerAccountGraphqlUrl =
      process.env.SHOPIFY_CUSTOMER_ACCOUNT_GRAPHQL_URL ||
      "https://account.halabt.com/customer/api/2026-04/graphql";
    return customerAccountGraphqlUrl;
  }

  async function customerAccountGraphQL(customerToken) {
    const url = await getCustomerAccountGraphqlUrl();
    const query = `#graphql
      query CustomerForWalletTopup {
        customer {
          id
          displayName
          emailAddress { emailAddress }
          phoneNumber { phoneNumber }
        }
      }
    `;
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${customerToken}`
      },
      body: JSON.stringify({ query })
    });
    const text = await r.text();
    const json = JSON.parse(text || "{}");
    if (!r.ok || json?.errors?.length) {
      throw new Error(
        json?.errors?.map((e) => e.message).join(" | ") ||
          `Shopify Customer Account HTTP ${r.status}`
      );
    }
    return json?.data?.customer || null;
  }

  async function findAdminCustomer(customer) {
    const id = makeCustomerGid(customer?.id || customer?.customer_id || customer?.customerId);
    const email = String(
      customer?.emailAddress?.emailAddress || customer?.email || ""
    ).trim();

    if (id) {
      const data = await adminGraphQL(
        `#graphql
          query CustomerNode($id: ID!) {
            node(id: $id) {
              ... on Customer {
                id
                displayName
                email
                phone
              }
            }
          }
        `,
        { id }
      ).catch(() => null);
      if (data?.node?.id) return data.node;
    }

    if (!email) return null;
    const data = await adminGraphQL(
      `#graphql
        query CustomerByEmail($query: String!) {
          customers(first: 1, query: $query) {
            nodes {
              id
              displayName
              email
              phone
            }
          }
        }
      `,
      { query: `email:${email}` }
    );
    return data?.customers?.nodes?.[0] || null;
  }

  async function resolveCustomer(req) {
    const customerToken = extractBearer(req);
    let customer = null;
    if (customerToken) {
      customer = await customerAccountGraphQL(customerToken).catch((e) => {
        console.warn("amwal customer token lookup failed", e?.message || e);
        return null;
      });
    }
    const fallbackCustomer = {
      id:
        req.body?.customer_id ||
        req.body?.customerId ||
        req.body?.shopify_customer_id ||
        req.headers["x-customer-id"],
      email:
        req.body?.email ||
        req.body?.customer_email ||
        req.headers["x-customer-email"]
    };
    if (!customer?.id && !fallbackCustomer.id && !fallbackCustomer.email) {
      return null;
    }
    return await findAdminCustomer(customer?.id ? customer : fallbackCustomer);
  }

  async function creditStoreCreditCustomer(customerId, amount, currencyCode) {
    const mutation = `#graphql
      mutation StoreCreditAccountCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
        storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
          storeCreditAccountTransaction {
            amount { amount currencyCode }
            balanceAfterTransaction { amount currencyCode }
            account {
              id
              balance { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }
    `;
    const data = await adminGraphQL(mutation, {
      id: makeCustomerGid(customerId),
      creditInput: {
        creditAmount: {
          amount: amount.toFixed(3),
          currencyCode
        }
      }
    });
    const payload = data?.storeCreditAccountCredit || {};
    const errors = payload.userErrors || [];
    if (errors.length) {
      throw new Error(errors.map((e) => e.message).filter(Boolean).join(" | "));
    }
    return payload.storeCreditAccountTransaction || null;
  }

  async function sendWalletPush({ customerId, amountText, reference }) {
    try {
      if (typeof getRedis !== "function" || typeof getFirebaseAdmin !== "function") {
        return null;
      }
      const redis = await getRedis();
      const firebase = getFirebaseAdmin();
      if (!redis || !firebase) return null;
      const numericId = customerNumericId(customerId);
      const token =
        (await redis.get(`bt:user:push:${numericId}`)) ||
        (await redis.get(`bt:user:push:${customerId}`));
      if (!token) return null;
      const locale = String(
        (await redis.get(`bt:user:push-locale:${numericId}`)) || ""
      ).toLowerCase();
      const lang = locale.startsWith("en") ? "en" : "ar";
      const titleAr = "\u062a\u0645 \u0625\u0636\u0627\u0641\u0629 \u0631\u0635\u064a\u062f";
      const bodyAr = `\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 ${amountText} \u0625\u0644\u0649 \u0645\u062d\u0641\u0638\u062a\u0643 \u0639\u0628\u0631 \u0623\u0645\u0648\u0627\u0644 \u0628\u0627\u064a.`;
      const titleEn = "Wallet credit added";
      const bodyEn = `${amountText} was added to your wallet through Amwal Pay.`;
      const title = lang === "en" ? titleEn : titleAr;
      const body = lang === "en" ? bodyEn : bodyAr;
      const notificationId = `amwal-credit-${Date.now()}-${numericId}`;
      await redis.lPush(
        `bt:user:notifications:${numericId}`,
        JSON.stringify({
          id: notificationId,
          title,
          body,
          seen: false,
          date: new Date().toISOString(),
          additionalData: {
            dynamic_link: "https://app.halabt.com/wallet",
            type: "customer_credit",
            provider: "amwal_pay",
            customer_id: String(customerId || ""),
            reference: String(reference || ""),
            amount: amountText,
            title_ar: titleAr,
            body_ar: bodyAr,
            title_en: titleEn,
            body_en: bodyEn,
            lang
          }
        })
      ).catch(() => {});
      await redis.lTrim(`bt:user:notifications:${numericId}`, 0, 99).catch(() => {});
      await redis.expire(`bt:user:notifications:${numericId}`, 60 * 60 * 24 * 120).catch(() => {});
      await firebase.messaging().send({
        token,
        notification: {
          title,
          body
        },
        data: {
          id: notificationId,
          dynamic_link: "https://app.halabt.com/wallet",
          type: "customer_credit",
          provider: "amwal_pay",
          customer_id: String(customerId || ""),
          reference: String(reference || ""),
          amount: amountText,
          title_ar: titleAr,
          body_ar: bodyAr,
          title_en: titleEn,
          body_en: bodyEn,
          lang
        },
        android: {
          notification: {
            clickAction: "FLUTTER_NOTIFICATION_CLICK",
            sound: "default"
          }
        },
        apns: {
          payload: { aps: { sound: "default" } }
        }
      });
      return { ok: true };
    } catch (e) {
      console.error("amwal wallet push failed", e?.message || e);
      return { ok: false, error: e?.message || "push_failed" };
    }
  }

  function isPaidSdkResponse(value) {
    let payload = value;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch (_) {
        payload = { message: payload };
      }
    }
    if (!payload || typeof payload !== "object") return false;
    const message = String(payload.message || payload.Message || "").toLowerCase();
    const status = String(payload.status || payload.Status || "").toLowerCase();
    const responseCode = String(
      payload.ResponseCode ||
        payload.responseCode ||
        payload.hostResponseData?.ResponseCode ||
        payload.hostResponseData?.responseCode ||
        ""
    ).trim();
    if (message.includes("cancel") || message.includes("fail") || message.includes("error")) {
      return false;
    }
    if (status.includes("cancel") || status.includes("fail") || status.includes("error")) {
      return false;
    }
    return (
      responseCode === "00" ||
      message.includes("paid") ||
      message.includes("approved") ||
      message.includes("success") ||
      status.includes("paid") ||
      status.includes("approved") ||
      status.includes("success") ||
      Boolean(payload.hostResponseData)
    );
  }

  async function creditStoredAmwalPayment(redis, reference, stored, paidAmount, source, payload) {
    const expectedAmount = Number(stored.amount || 0);
    const amount = cleanAmount(paidAmount || expectedAmount);
    if (Math.abs(amount - expectedAmount) > 0.0005) {
      await redis.set(
        redisKey(reference),
        JSON.stringify({
          ...stored,
          status: "amount_mismatch",
          [source]: payload,
          paidAmount: amount,
          updatedAt: new Date().toISOString()
        }),
        { EX: AMWAL_PAYMENT_TTL_SECONDS }
      );
      return { ok: false, status: 409, body: { message: "amount mismatch", success: false } };
    }

    const lock = await redis.set(processedKey(reference), "1", {
      NX: true,
      EX: 60 * 60 * 24 * 365
    });
    if (!lock) {
      return { ok: true, body: { message: "success", success: true, duplicate: true } };
    }

    const creditAmount = cleanAmount(stored.creditAmount || amount);
    const credit = await creditStoreCreditCustomer(stored.customerId, creditAmount, "OMR");
    const amountText = `${creditAmount.toFixed(3)} OMR`;
    await redis.set(
      redisKey(reference),
      JSON.stringify({
        ...stored,
        status: "credited",
        paidAt: new Date().toISOString(),
        paidAmount: amount,
        creditAmount,
        [source]: payload,
        credit
      }),
      { EX: 60 * 60 * 24 * 365 }
    );
    await sendWalletPush({
      customerId: stored.customerId,
      amountText,
      reference
    });
    return { ok: true, body: { message: "success", success: true } };
  }

  router.post("/customer-credit/amwal/sdk-session", async (req, res) => {
    try {
      if (!assertAmwalEnv(res)) return;

      const amount = cleanAmount(req.body?.amount);
      if (amount < AMWAL_MIN_AMOUNT || amount > AMWAL_MAX_AMOUNT) {
        return res.status(400).json({
          ok: false,
          error: "amount_out_of_range",
          message: amountOutOfRangeMessage(amount),
          min: AMWAL_MIN_AMOUNT,
          max: AMWAL_MAX_AMOUNT
        });
      }

      const redis = await redisOrNull().catch(() => null);
      const explicitCustomerId = String(
        req.body?.customer_id ||
          req.body?.customerId ||
          req.body?.shopify_customer_id ||
          req.headers["x-customer-id"] ||
          ""
      ).trim();
      const customer = explicitCustomerId ? null : await resolveCustomer(req);
      const customerId = customerNumericId(customer?.id || explicitCustomerId);
      const reference = `BTWT${customerId || "GUEST"}${Date.now()}`.slice(0, 40);
      const transactionId = crypto.randomUUID();
      const requestPayload = {
        merchantId: Number(AMWAL_MERCHANT_ID),
        requestDateTime: isoSeconds()
      };
      requestPayload.secureHashValue = secureHash(requestPayload);

      const amwalRes = await fetch(`${AMWAL_SDK_BASE_URL}/Membership/GetSDKSessionToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const text = await amwalRes.text();
      const json = JSON.parse(text || "{}");
      const sessionToken = String(json?.data?.sessionToken || json?.sessionToken || "").trim();

      if (!amwalRes.ok || json?.success === false || !sessionToken) {
        if (redis) {
          await redis.set(
            redisKey(reference),
            JSON.stringify({
              reference,
              status: "sdk_session_failed",
              customerId: customer?.id || explicitCustomerId || "",
              customerNumericId: customerId,
              amount,
              currencyCode: "OMR",
              environment: AMWAL_ENV,
              sdkBaseUrl: AMWAL_SDK_BASE_URL,
              error: json?.message || text || `Amwal HTTP ${amwalRes.status}`,
              amwalResponse: json,
              updatedAt: new Date().toISOString()
            }),
            { EX: AMWAL_PAYMENT_TTL_SECONDS }
          );
        }
        return res.status(502).json({
          ok: false,
          error: "amwal_sdk_session_failed",
          message: json?.message || text || `Amwal HTTP ${amwalRes.status}`,
          amwal: json
        });
      }

      const stored = {
        reference,
        transactionId,
        status: "sdk_session_created",
        customerId: customer?.id || explicitCustomerId || "",
        customerNumericId: customerId,
        amount,
        creditAmount: walletCreditAmount(amount),
        currencyCode: "OMR",
        environment: AMWAL_ENV,
        sdkBaseUrl: AMWAL_SDK_BASE_URL,
        merchantId: AMWAL_MERCHANT_ID,
        terminalId: AMWAL_TERMINAL_ID,
        createdAt: new Date().toISOString(),
        amwalResponse: json
      };
      if (redis) {
        await redis.set(redisKey(reference), JSON.stringify(stored), {
          EX: AMWAL_PAYMENT_TTL_SECONDS
        });
      }

      res.json({
        ok: true,
        reference,
        transactionId,
        merchantReference: reference,
        sessionToken,
        amount: amount.toFixed(3),
        currencyCode: "OMR",
        merchantId: AMWAL_MERCHANT_ID,
        terminalId: AMWAL_TERMINAL_ID,
        environment: AMWAL_ENV,
        sdkEnvironment: AMWAL_ENV === "UAT" ? "UAT" : "PROD",
        additionValues: {
          useBottomSheetDesign: "true",
          primaryColor: "#6B0083",
          secondaryColor: "#FDD8C2",
          ignoreReceipt: "false"
        },
        expiresInSeconds: AMWAL_PAYMENT_TTL_SECONDS
      });
    } catch (e) {
      console.error("amwal sdk session error", e);
      res.status(500).json({ ok: false, error: e.message || "amwal_sdk_session_failed" });
    }
  });

  router.post("/customer-credit/amwal/create-payment-link", async (req, res) => {
    try {
      if (!assertEnv(res)) return;
      const redis = await redisOrNull();
      if (!redis) {
        return res.status(500).json({ ok: false, error: "REDIS_URL missing" });
      }

      const amount = cleanAmount(req.body?.amount);
      if (amount < AMWAL_MIN_AMOUNT || amount > AMWAL_MAX_AMOUNT) {
        return res.status(400).json({
          ok: false,
          error: "amount_out_of_range",
          message: amountOutOfRangeMessage(amount),
          min: AMWAL_MIN_AMOUNT,
          max: AMWAL_MAX_AMOUNT
        });
      }

      const customer = await resolveCustomer(req);
      if (!customer?.id) {
        return res.status(401).json({ ok: false, error: "Missing customer identity" });
      }

      const numericId = customerNumericId(customer.id);
      const reference = `BTWT${numericId}${Date.now()}`.slice(0, 40);
      const payerName =
        String(req.body?.payerName || customer.displayName || customer.email || "Hala Beauty Customer")
          .trim()
          .slice(0, 120);
      const email = String(req.body?.email || customer.email || "").trim();
      const phone = String(req.body?.phone || customer.phone || "").trim();
      const requestPayload = {
        billerRefNumber: reference,
        payerName,
        amount: amount.toFixed(3),
        currency: OMR_CURRENCY_ID,
        paymentMethod: Number(process.env.AMWAL_PAYMENT_METHOD || 1),
        notificationMethod: email ? 1 : undefined,
        emailNotificationValue: email || undefined,
        smsNotificationValue: phone || undefined,
        terminalId: Number(AMWAL_TERMINAL_ID),
        merchantId: Number(AMWAL_MERCHANT_ID),
        expireDateTime: "",
        maxNumberOfPayment: 1,
        paymentViewType: Number(process.env.AMWAL_PAYMENT_VIEW_TYPE || 1),
        redirectUrl: AMWAL_REDIRECT_URL
      };
      requestPayload.secureHashValue = secureHash(requestPayload);

      await redis.set(
        redisKey(reference),
        JSON.stringify({
          reference,
          status: "pending",
          customerId: customer.id,
          customerNumericId: numericId,
          amount,
          creditAmount: walletCreditAmount(amount),
          currencyCode: "OMR",
          currencyId: OMR_CURRENCY_ID,
          createdAt: new Date().toISOString(),
          amwalRequest: {
            merchantId: AMWAL_MERCHANT_ID,
            terminalId: AMWAL_TERMINAL_ID
          }
        }),
        { EX: AMWAL_PAYMENT_TTL_SECONDS }
      );

      const amwalRes = await fetch(`${AMWAL_BASE_URL}/MerchantOrder/CreatePaymentLink`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const text = await amwalRes.text();
      const json = JSON.parse(text || "{}");
      if (!amwalRes.ok || json?.success === false) {
        await redis.set(
          redisKey(reference),
          JSON.stringify({
            reference,
            status: "create_failed",
            customerId: customer.id,
            amount,
            currencyCode: "OMR",
            error: json?.message || text || `Amwal HTTP ${amwalRes.status}`,
            updatedAt: new Date().toISOString()
          }),
          { EX: AMWAL_PAYMENT_TTL_SECONDS }
        );
        return res.status(502).json({
          ok: false,
          error: "amwal_create_failed",
          message: json?.message || text || `Amwal HTTP ${amwalRes.status}`,
          amwal: json
        });
      }

      const paymentUrl = String(json?.data || "").trim();
      const stored = JSON.parse((await redis.get(redisKey(reference))) || "{}");
      await redis.set(
        redisKey(reference),
        JSON.stringify({
          ...stored,
          status: "link_created",
          paymentUrl,
          amwalResponse: json,
          updatedAt: new Date().toISOString()
        }),
        { EX: AMWAL_PAYMENT_TTL_SECONDS }
      );

      res.json({
        ok: true,
        reference,
        paymentUrl,
        amount,
        currencyCode: "OMR",
        expiresInSeconds: AMWAL_PAYMENT_TTL_SECONDS
      });
    } catch (e) {
      console.error("amwal create payment link error", e);
      res.status(500).json({ ok: false, error: e.message || "amwal_create_failed" });
    }
  });

  router.get("/customer-credit/amwal/webhook", (req, res) => {
    res.json({
      ok: true,
      service: "amwal_wallet_webhook",
      method: "POST",
      message: "Amwal Pay webhook is ready"
    });
  });

  router.get("/customer-credit/amwal/return", (req, res) => {
    res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hala Beauty</title>
  <style>
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fbf7fb;color:#2d1238;display:grid;min-height:100vh;place-items:center}
    .card{width:min(88vw,380px);padding:28px 24px;border-radius:24px;background:#fff;box-shadow:0 18px 45px rgba(74,24,91,.16);text-align:center}
    .mark{width:64px;height:64px;margin:0 auto 16px;border-radius:22px;background:linear-gradient(135deg,#6b0083,#f4c5ad);display:grid;place-items:center;color:white;font-size:30px}
    h1{font-size:22px;margin:0 0 10px}
    p{font-size:15px;line-height:1.6;margin:0 0 22px;color:#6c5872}
    a{display:block;padding:14px 18px;border-radius:16px;background:#6b0083;color:white;text-decoration:none;font-weight:700}
  </style>
</head>
<body>
  <main class="card">
    <div class="mark">BT</div>
    <h1>Payment received</h1>
    <p>You can return to Hala Beauty. Your wallet will update once the payment confirmation is received.</p>
    <a href="https://app.halabt.com">Return to app</a>
  </main>
</body>
</html>`);
  });

  router.post("/customer-credit/amwal/webhook", async (req, res) => {
    try {
      if (!assertEnv(res)) return;
      const redis = await redisOrNull();
      if (!redis) {
        return res.status(500).json({ message: "redis missing", success: false });
      }

      const body = req.body || {};
      if (!verifyWebhookHash(body)) {
        console.warn("amwal webhook hash mismatch", body);
        return res.status(400).json({ message: "invalid hash", success: false });
      }

      const reference = String(body.MerchantReference || body.billerRefNumber || "").trim();
      const responseCode = String(body.ResponseCode || "").trim();
      const amount = cleanAmount(body.AmountOMR || body.Amount);
      const systemReference = String(body.SystemReference || "").trim();
      const message = String(body.Message || "").toLowerCase();
      const paid =
        responseCode === "00" ||
        message.includes("paid") ||
        message.includes("approved") ||
        message.includes("success");
      if (!reference) {
        return res.status(400).json({ message: "missing reference", success: false });
      }

      const raw = await redis.get(redisKey(reference));
      const stored = raw ? JSON.parse(raw) : null;
      if (!stored?.customerId) {
        return res.status(404).json({ message: "reference not found", success: false });
      }

      if (!paid) {
        await redis.set(
          redisKey(reference),
          JSON.stringify({
            ...stored,
            status: "failed",
            amwalWebhook: body,
            updatedAt: new Date().toISOString()
          }),
          { EX: AMWAL_PAYMENT_TTL_SECONDS }
        );
        return res.json({ message: "success", success: true });
      }

      const result = await creditStoredAmwalPayment(redis, reference, stored, amount, "amwalWebhook", {
        ...body,
        SystemReference: systemReference
      });
      if (!result.ok) {
        return res.status(result.status || 400).json(result.body);
      }
      res.json(result.body);
    } catch (e) {
      console.error("amwal webhook error", e);
      res.status(500).json({ message: e.message || "webhook failed", success: false });
    }
  });

  router.post("/customer-credit/amwal/sdk-confirm", async (req, res) => {
    try {
      const redis = await redisOrNull();
      if (!redis) {
        return res.status(500).json({ ok: false, error: "REDIS_URL missing" });
      }

      const reference = String(
        req.body?.reference ||
          req.body?.merchantReference ||
          req.body?.transactionId ||
          ""
      ).trim();
      if (!reference) {
        return res.status(400).json({ ok: false, error: "missing reference" });
      }

      const raw = await redis.get(redisKey(reference));
      const stored = raw ? JSON.parse(raw) : null;
      if (!stored?.customerId) {
        return res.status(404).json({ ok: false, error: "reference not found" });
      }

      const sdkResponse = req.body?.sdkResponse || req.body?.response || {};
      if (!isPaidSdkResponse(sdkResponse)) {
        await redis.set(
          redisKey(reference),
          JSON.stringify({
            ...stored,
            status: "sdk_not_paid",
            amwalSdkResponse: sdkResponse,
            updatedAt: new Date().toISOString()
          }),
          { EX: AMWAL_PAYMENT_TTL_SECONDS }
        );
        return res.status(409).json({ ok: false, error: "payment not approved" });
      }

      const result = await creditStoredAmwalPayment(
        redis,
        reference,
        stored,
        req.body?.amount || stored.amount,
        "amwalSdkResponse",
        sdkResponse
      );
      if (!result.ok) {
        return res.status(result.status || 400).json({ ok: false, ...result.body });
      }
      res.json({ ok: true, ...result.body });
    } catch (e) {
      console.error("amwal sdk confirm error", e);
      res.status(500).json({ ok: false, error: e.message || "sdk_confirm_failed" });
    }
  });

  router.get("/customer-credit/amwal/status/:reference", async (req, res) => {
    try {
      const redis = await redisOrNull();
      if (!redis) {
        return res.status(500).json({ ok: false, error: "REDIS_URL missing" });
      }
      const reference = String(req.params.reference || "").trim();
      const raw = reference ? await redis.get(redisKey(reference)) : "";
      if (!raw) return res.status(404).json({ ok: false, error: "not_found" });
      const data = JSON.parse(raw);
      res.json({
        ok: true,
        reference,
        status: data.status || "unknown",
        amount: data.amount,
        currencyCode: data.currencyCode || "OMR",
        paymentUrl: data.paymentUrl || "",
        paidAt: data.paidAt || ""
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "status_failed" });
    }
  });

  return router;
}
