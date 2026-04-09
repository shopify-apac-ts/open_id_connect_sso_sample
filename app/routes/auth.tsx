// Shopify App OAuth entry point (non-embedded).
// If an Admin API token is already cached for this store, renders the app home.
// Otherwise, initiates the Shopify OAuth Authorization Code Grant flow.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { createHmac } from "crypto";
import { v4 as uuidv4 } from "uuid";
import { getShopToken, hasShopToken, deleteShopToken, storePendingNonce } from "~/lib/shop-token-cache.server";
import { ADMIN_API_VERSION } from "~/lib/api-version.server";

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
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  // Validate HMAC when present (Shopify sends it on OAuth redirects)
  if (params.has("hmac") && !verifyHmac(params)) {
    console.log("[auth] HMAC verification failed for shop:", shop);
    return new Response("HMAC verification failed", { status: 403 });
  }

  // If a token is cached, verify it is still valid by querying shop.name.
  // Uninstalling the app immediately revokes the token, so a failed request
  // means the merchant has uninstalled and reinstalled — clear the cache and
  // fall through to the OAuth flow to obtain a fresh token.
  if (hasShopToken(shop)) {
    const token = getShopToken(shop)!;
    const endpoint = `https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: "{ shop { name } }" }),
      });
      const json = (await res.json()) as { data?: { shop?: { name?: string } } };
      const shopName = json.data?.shop?.name;
      if (res.ok && shopName) {
        console.log("[auth] cached token still valid for shop:", shop, "name:", shopName);
        return new Response(
          `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>SSO Sample App</title></head>
<body>
  <h2>SSO Sample App</h2>
  <p>Admin API access token is active for <strong>${shop}</strong> (${shopName}).</p>
  <p>The app is ready to resolve customer GIDs to emails via the Admin API.</p>
  <p><a href="/">Go to Top</a></p>
</body>
</html>`,
          { status: 200, headers: { "Content-Type": "text/html" } }
        );
      }
      // Token exists but query failed — treat as revoked
      console.log("[auth] cached token invalid (revoked after uninstall) for shop:", shop, "— re-authorizing");
    } catch (err) {
      console.log("[auth] token validation fetch failed:", (err as Error).message, "— re-authorizing");
    }
    deleteShopToken(shop);
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
  return redirect(authUrl.toString());
}
