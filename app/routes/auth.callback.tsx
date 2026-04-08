// Shopify OAuth callback — exchanges authorization code for Admin API access token.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { createHmac } from "crypto";
import { consumePendingNonce, setShopToken } from "~/lib/shop-token-cache.server";

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

function encodeShopifyParam(s: string): string {
  return s.replace(/%/g, "%25").replace(/&/g, "%26");
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const shop = params.get("shop");
  const code = params.get("code");
  const state = params.get("state");

  if (!shop || !code || !state) {
    return new Response("Missing required parameters", { status: 400 });
  }

  // Verify HMAC
  if (!verifyHmac(params)) {
    console.log("[auth/callback] HMAC verification failed for shop:", shop);
    return new Response("HMAC verification failed", { status: 403 });
  }

  // Verify state (nonce) and extract the associated shop
  const expectedShop = consumePendingNonce(state);
  if (!expectedShop || expectedShop !== shop) {
    console.log("[auth/callback] invalid or expired state for shop:", shop);
    return new Response("Invalid or expired state parameter", { status: 403 });
  }

  // Exchange authorization code for permanent access token
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error("[auth/callback] App credentials not configured");
    return new Response("App credentials not configured", { status: 500 });
  }

  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[auth/callback] token exchange failed:", tokenRes.status, body);
    return new Response("Token exchange failed", { status: 502 });
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };
  setShopToken(shop, access_token);
  console.log("[auth/callback] stored Admin API token for shop:", shop);

  return new Response(
    `<html><body><p>App successfully installed for <strong>${shop}</strong>. You can close this window.</p></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}
