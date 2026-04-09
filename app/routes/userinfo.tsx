// UserInfo Endpoint (OIDC Core 1.0, Section 5.3)
// Accepts both:
//   - Shopify session tokens (HS256, signed with SHOPIFY_API_SECRET)
//   - OIDC access tokens (RS256, signed with this server's RSA private key)
//
// When a Shopify session token is used, the customer GID (sub claim) and shop
// domain (dest claim) are extracted. The shop's Admin API token is looked up
// from the in-memory cache and used to resolve the real email via Admin API.
import type { LoaderFunctionArgs } from "@remix-run/node";
import { jwtVerify } from "jose";
import { getPublicKey } from "~/lib/keys.server";
import { getBaseUrl } from "~/lib/oidc.server";
import { getSsoTestProfile } from "~/lib/store.server";
import { getShopToken } from "~/lib/shop-token-cache.server";
import { fetchEmailByGid } from "~/lib/admin-api.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function unauthorized() {
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      "WWW-Authenticate": 'Bearer error="invalid_token"',
    },
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const authHeader = request.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return unauthorized();
  }

  const token = authHeader.slice(7);

  let sub: string | undefined;
  let email: string | undefined;
  let adminQueryStr: string | undefined;
  let adminResponseStr: string | undefined;

  // Path 1: Shopify session token — HS256 signed with SHOPIFY_API_SECRET
  const shopifySecret = process.env.SHOPIFY_API_SECRET;
  if (shopifySecret) {
    try {
      const secretKey = new TextEncoder().encode(shopifySecret);
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ["HS256"],
      });
      const p = payload as Record<string, unknown>;
      // sub is the customer GID (e.g. "gid://shopify/Customer/12345")
      sub = payload.sub as string | undefined;
      const dest = p.dest as string | undefined;
      console.log("[userinfo] verified via HS256 | sub:", sub, "| dest (raw):", JSON.stringify(dest));

      // Resolve real email via Admin API if we have the shop token cached
      if (sub && dest) {
        try {
          // dest may or may not include a protocol prefix
          const normalized = dest.startsWith("http") ? dest : `https://${dest}`;
          const shopDomain = new URL(normalized).hostname;
          const shopToken = getShopToken(shopDomain);
          if (shopToken) {
            const result = await fetchEmailByGid(shopDomain, shopToken, sub);
            if (result) {
              email = result.email;
              adminQueryStr = result.queryStr;
              adminResponseStr = result.responseStr;
            } else {
              console.warn("[userinfo] Admin API returned no email for GID:", sub);
            }
          } else {
            console.warn("[userinfo] no Admin API token cached for shop:", shopDomain, "— install the app first via /auth?shop=<domain>");
          }
        } catch (err) {
          console.warn("[userinfo] failed to resolve email via Admin API:", (err as Error).message);
        }
      }
    } catch (err) {
      console.log("[userinfo] HS256 verification failed, falling back to RS256 |", (err as Error).message);
    }
  } else {
    console.log("[userinfo] SHOPIFY_API_SECRET not set — skipping HS256 path");
  }

  // Path 2: OIDC access token — RS256 signed with this server's RSA key
  if (!sub) {
    try {
      const publicKey = await getPublicKey();
      const baseUrl = getBaseUrl();
      const { payload } = await jwtVerify(token, publicKey, {
        issuer: baseUrl,
      });
      sub = payload.sub;
      email = (payload as Record<string, unknown>).email as string | undefined;
      console.log("[userinfo] verified via RS256 (OIDC access token) | sub:", sub);
    } catch (err) {
      console.log("[userinfo] RS256 verification failed |", (err as Error).message);
      return unauthorized();
    }
  }

  if (!sub) {
    return unauthorized();
  }

  // Fall back to a placeholder email if Admin API resolution was unavailable
  if (!email) {
    email = `${sub}@test.invalid`;
    console.warn("[userinfo] using fallback email:", email);
  }

  const profile = getSsoTestProfile(sub);

  // Embed Admin API query and response into address1/address2 for demo visibility.
  // address1 (lines[0]): base street + " | Admin API query: ..."
  // address2 (lines[1]): "Admin API response: ..."
  // This ensures profileMatchesCustomer detects a diff and upsertAddress writes
  // the values into Customer API on every sync.
  const baseLines = profile.address.street_address.split("\n");
  const street_address = adminQueryStr && adminResponseStr
    ? `${baseLines[0]} | Admin API query: ${adminQueryStr}\nAdmin API response: ${adminResponseStr}`
    : profile.address.street_address;

  const responseBody = {
    sub,
    email,
    email_verified: true,
    given_name: profile.given_name,
    family_name: profile.family_name,
    address: { ...profile.address, street_address },
  };
  console.log("[userinfo] response:", JSON.stringify(responseBody));

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
