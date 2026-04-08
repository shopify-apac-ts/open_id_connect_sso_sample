// Shopify App OAuth entry point.
// If an Admin API token is already cached for this store, renders the app home.
// Otherwise, initiates the Shopify OAuth Authorization Code Grant flow.
//
// All HTML responses must include:
//   Content-Security-Policy: frame-ancestors https://admin.shopify.com https://<shop>.myshopify.com;
// to allow Shopify Admin to embed this app in an iframe.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { createHmac } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { hasShopToken, storePendingNonce } from "~/lib/shop-token-cache.server";

function frameAncestorsHeader(shop: string | null): string {
  const shopOrigin = shop ? `https://${shop}` : "";
  return `frame-ancestors https://admin.shopify.com${shopOrigin ? ` ${shopOrigin}` : ""};`;
}

// Verify Shopify HMAC signature on incoming query params.
// All params except "hmac" are sorted and joined, then signed with SHOPIFY_API_SECRET.
function verifyHmac(params: URLSearchParams): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;
  const hmac = params.get("hmac");
  if (!hmac) return false;

  const entries: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hmac") continue;
    entries.push(`${encodeShopifyParam(k)}=${encodeShopifyParam(v)}`);
  }
  entries.sort();
  const message = entries.join("&");

  const computed = createHmac("sha256", secret).update(message).digest("hex");
  return computed === hmac;
}

// Shopify escapes % and & in values before HMAC
function encodeShopifyParam(s: string): string {
  return s.replace(/%/g, "%25").replace(/&/g, "%26");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const shop = params.get("shop");

  if (!shop) {
    return new Response(
      `<html><body><p>Please install this app from the Shopify Partner Dashboard.</p></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html", "Content-Security-Policy": "frame-ancestors 'none';" } }
    );
  }

  // Validate HMAC when present (Shopify sends it on OAuth redirects)
  if (params.has("hmac") && !verifyHmac(params)) {
    console.log("[auth] HMAC verification failed for shop:", shop);
    return new Response("HMAC verification failed", { status: 403 });
  }

  // Admin API token already cached for this store — render app home inside Shopify Admin iframe
  if (hasShopToken(shop)) {
    console.log("[auth] shop already authorized:", shop);
    const csp = frameAncestorsHeader(shop);
    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SSO Sample App</title>
  <meta name="shopify-api-key" content="${process.env.SHOPIFY_API_KEY ?? ""}" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
</head>
<body>
  <h2>SSO Sample App</h2>
  <p>Admin API access token is active for <strong>${shop}</strong>.</p>
  <p>The app is ready to resolve customer GIDs to emails via the Admin API.</p>
</body>
</html>`,
      { status: 200, headers: { "Content-Type": "text/html", "Content-Security-Policy": csp } }
    );
  }

  // Initiate OAuth Authorization Code Grant
  const apiKey = process.env.SHOPIFY_API_KEY;
  if (!apiKey) {
    console.error("[auth] SHOPIFY_API_KEY not configured");
    return new Response("SHOPIFY_API_KEY not configured", { status: 500 });
  }

  const nonce = uuidv4();
  storePendingNonce(nonce, shop);

  // Strip trailing slash to avoid double-slash in redirect_uri
  const baseUrl = (process.env.BASE_URL ?? url.origin).replace(/\/$/, "");
  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", apiKey);
  authUrl.searchParams.set("scope", "read_customers");
  authUrl.searchParams.set("redirect_uri", `${baseUrl}/auth/callback`);
  authUrl.searchParams.set("state", nonce);

  console.log("[auth] initiating OAuth for shop:", shop, "→", authUrl.toString());

  // Shopify's OAuth page has frame-ancestors 'none' so a server-side redirect inside
  // the Admin iframe would be blocked by the browser. Use window.top.location to
  // break out of the iframe and perform a top-level navigation instead.
  const csp = frameAncestorsHeader(shop);
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="shopify-api-key" content="${apiKey}" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <script>
    (window.top || window).location.assign(${JSON.stringify(authUrl.toString())});
  </script>
</head>
<body><p>Redirecting to Shopify authorization...</p></body>
</html>`,
    { status: 200, headers: { "Content-Type": "text/html", "Content-Security-Policy": csp } }
  );
}
