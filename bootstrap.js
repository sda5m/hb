import { spawn } from "node:child_process";

const SHOP = String(process.env.SHOPIFY_SHOP || "0pprf1-jj.myshopify.com")
  .trim()
  .toLowerCase();
const CLIENT_ID = String(process.env.SHOPIFY_CLIENT_ID || "").trim();
const CLIENT_SECRET = String(process.env.SHOPIFY_CLIENT_SECRET || "").trim();
const RESTART_BUFFER_SECONDS = 5 * 60;

if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(SHOP)) {
  throw new Error("SHOPIFY_SHOP must be a valid *.myshopify.com domain");
}
if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error("SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required");
}

let child = null;
let stopping = false;

async function issueAccessToken() {
  const response = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }),
    signal: AbortSignal.timeout(30_000)
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.access_token) {
    const detail = payload?.error_description || payload?.error || text.slice(0, 300);
    throw new Error(`Shopify token request failed (${response.status}): ${detail}`);
  }

  return {
    accessToken: payload.access_token,
    expiresIn: Math.max(Number(payload.expires_in) || 86_400, 600)
  };
}

async function startServer() {
  const { accessToken, expiresIn } = await issueAccessToken();
  console.log(`Shopify credentials accepted for ${SHOP}; starting isolated server.`);

  child = spawn(process.execPath, ["server.js"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      SHOPIFY_SHOP: SHOP,
      SHOPIFY_ADMIN_TOKEN: accessToken
    },
    stdio: "inherit"
  });

  const restartAfterMs = Math.max(
    (expiresIn - RESTART_BUFFER_SECONDS) * 1000,
    5 * 60 * 1000
  );
  const refreshTimer = setTimeout(() => {
    if (!stopping && child) {
      console.log("Refreshing Shopify credentials with a controlled restart.");
      child.kill("SIGTERM");
    }
  }, restartAfterMs);
  refreshTimer.unref();

  child.once("exit", (code, signal) => {
    clearTimeout(refreshTimer);
    child = null;
    if (stopping) process.exit(code ?? 0);
    if (code && code !== 0) {
      console.error(`Server exited with code ${code}; retrying in 5 seconds.`);
    }
    setTimeout(() => startServer().catch(fatal), 5_000);
  });
}

function shutdown(signal) {
  stopping = true;
  if (child) child.kill(signal);
  else process.exit(0);
  setTimeout(() => process.exit(1), 15_000).unref();
}

function fatal(error) {
  console.error(error?.stack || error);
  if (!stopping) setTimeout(() => startServer().catch(fatal), 30_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
startServer().catch(fatal);
