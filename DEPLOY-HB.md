# HB independent Shopify service

This folder is an independent copy for `0pprf1-jj.myshopify.com`.

## Required deployment settings

1. Deploy this folder as a separate Node service with `npm start`.
2. Copy every required environment variable from the original service, then replace
   the Shopify, domain, Redis, security-key, webhook, Firebase, and push values with
   values dedicated to this service.
3. Set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` as secret environment values.
4. Do not set `SHOPIFY_ADMIN_TOKEN`; `bootstrap.js` requests and refreshes it.
5. Use a separate Redis instance, or a separate Redis logical database URL when the
   provider guarantees isolation.
6. Point the new domain to this service and configure that domain in the Shopify app.
7. Register the app webhooks against the new domain only.
8. Set `FIREBASE_SERVICE_ACCOUNT` to a separate Firebase project if push
   notifications are required. The original store's bundled Firebase file is disabled.

## Hala Beauty domains

- Storefront: `https://halabt.com`
- Application service: `https://app.halabt.com`

The process intentionally restarts the inner server shortly before the Shopify token
expires because several legacy route modules read the token once during startup.
