// Token Endpoint (POST only)
// Exchanges an Authorization Code or Refresh Token for an Access Token / ID Token
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { createHash } from "crypto";
import { v4 as uuidv4 } from "uuid";
import {
  getBaseUrl,
  getClientId,
  getClientSecret,
  signIdToken,
  signAccessToken,
} from "~/lib/oidc.server";
import {
  getAuthCode,
  deleteAuthCode,
  storeRefreshToken,
  getRefreshToken,
  deleteRefreshToken,
  getShopifyClaimsProfile,
} from "~/lib/store.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

function oidcError(error: string, description?: string, status = 400) {
  return json(
    { error, ...(description ? { error_description: description } : {}) },
    { status, headers: corsHeaders }
  );
}

function decodeJwtPayload(jwt: string): unknown {
  try {
    const payload = jwt.split(".")[1];
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return "(decode failed)";
  }
}

export async function action({ request }: ActionFunctionArgs) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return oidcError("method_not_allowed", undefined, 405);
  }

  // Parse application/x-www-form-urlencoded
  let params: Record<string, string> = {};
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const fd = await request.formData();
    for (const [k, v] of fd.entries()) {
      if (typeof v === "string") params[k] = v;
    }
  } else if (contentType.includes("application/json")) {
    params = await request.json();
  } else {
    // Fallback: try parsing as form-data
    try {
      const fd = await request.formData();
      for (const [k, v] of fd.entries()) {
        if (typeof v === "string") params[k] = v;
      }
    } catch {
      return oidcError("unsupported_media_type", undefined, 415);
    }
  }

  const { grant_type, code, redirect_uri, refresh_token } = params;

  // Client authentication: prefer client_secret_basic (Authorization header),
  // fall back to client_secret_post (request body)
  let client_id = params.client_id;
  let client_secret = params.client_secret;

  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx !== -1) {
      client_id = decodeURIComponent(decoded.slice(0, colonIdx));
      client_secret = decodeURIComponent(decoded.slice(colonIdx + 1));
    }
  }

  // Debug logs (visible in Render logs)
  console.log("[token] grant_type:", grant_type);
  console.log("[token] auth_method:", authHeader?.startsWith("Basic ") ? "client_secret_basic" : "client_secret_post");
  console.log("[token] client_id:", client_id, "| expected:", getClientId(), "| match:", client_id === getClientId());
  console.log("[token] client_secret match:", client_secret === getClientSecret());
  console.log("[token] code:", code);
  console.log("[token] redirect_uri:", redirect_uri);

  // Client authentication
  if (client_id !== getClientId() || client_secret !== getClientSecret()) {
    console.log("[token] ERROR: invalid_client");
    return oidcError("invalid_client", "Invalid client credentials", 401);
  }

  const baseUrl = getBaseUrl();

  // ── Authorization Code Grant ──────────────────────────────────────────────
  if (grant_type === "authorization_code") {
    if (!code) return oidcError("invalid_request", "code is required");

    const authData = getAuthCode(code);
    if (!authData) {
      console.log("[token] ERROR: invalid_grant - code not found:", code);
      return oidcError("invalid_grant", "Invalid or expired code");
    }

    console.log("[token] stored redirect_uri:", authData.redirectUri);
    console.log("[token] request redirect_uri:", redirect_uri);
    if (authData.redirectUri !== redirect_uri) {
      console.log("[token] ERROR: redirect_uri mismatch");
      return oidcError("invalid_grant", "redirect_uri mismatch");
    }

    // PKCE verification (S256)
    const codeVerifier = params.code_verifier;
    if (authData.codeChallenge) {
      if (!codeVerifier) {
        console.log("[token] ERROR: code_verifier required but missing");
        return oidcError("invalid_grant", "code_verifier required");
      }
      const computed = createHash("sha256")
        .update(codeVerifier)
        .digest("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      console.log("[token] PKCE challenge match:", computed === authData.codeChallenge);
      if (computed !== authData.codeChallenge) {
        console.log("[token] ERROR: PKCE code_verifier mismatch");
        return oidcError("invalid_grant", "code_verifier mismatch");
      }
    }

    // Authorization codes are single-use
    deleteAuthCode(code);

    const { userId, email, scope, nonce } = authData;
    const shopifyClaims = getShopifyClaimsProfile(userId);
    console.log("[token] shopifyClaims to embed:", JSON.stringify(shopifyClaims, null, 2));

    const [idToken, accessToken] = await Promise.all([
      signIdToken({ sub: userId, email, clientId: client_id, nonce, issuer: baseUrl, shopifyClaims }),
      signAccessToken({ sub: userId, email, issuer: baseUrl }),
    ]);
    const newRefreshToken = uuidv4();
    storeRefreshToken(newRefreshToken, { userId, email, clientId: client_id, scope });

    const responseBody = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idToken,
      refresh_token: newRefreshToken,
      scope,
    };
    console.log("[token] response to Shopify:", JSON.stringify({
      ...responseBody,
      access_token_payload: decodeJwtPayload(accessToken),
      id_token_payload: decodeJwtPayload(idToken),
    }, null, 2));

    return json(responseBody, { headers: corsHeaders });
  }

  // ── Refresh Token Grant ───────────────────────────────────────────────────
  if (grant_type === "refresh_token") {
    if (!refresh_token) return oidcError("invalid_request", "refresh_token is required");

    const rtData = getRefreshToken(refresh_token);
    if (!rtData) return oidcError("invalid_grant", "Invalid or expired refresh_token");

    const { userId, email, scope } = rtData;
    const shopifyClaims = getShopifyClaimsProfile(userId);
    console.log("[token] refresh shopifyClaims to embed:", JSON.stringify(shopifyClaims, null, 2));

    const [idToken, accessToken] = await Promise.all([
      signIdToken({ sub: userId, email, clientId: client_id, issuer: baseUrl, shopifyClaims }),
      signAccessToken({ sub: userId, email, issuer: baseUrl }),
    ]);

    // Rotate the refresh token
    deleteRefreshToken(refresh_token);
    const newRefreshToken = uuidv4();
    storeRefreshToken(newRefreshToken, rtData);

    const refreshResponseBody = {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      id_token: idToken,
      refresh_token: newRefreshToken,
      scope,
    };
    console.log("[token] refresh response to Shopify:", JSON.stringify({
      ...refreshResponseBody,
      access_token_payload: decodeJwtPayload(accessToken),
      id_token_payload: decodeJwtPayload(idToken),
    }, null, 2));

    return json(refreshResponseBody, { headers: corsHeaders });
  }

  return oidcError("unsupported_grant_type");
}

// GET is not supported
export async function loader() {
  return json({ error: "method_not_allowed" }, { status: 405, headers: corsHeaders });
}
