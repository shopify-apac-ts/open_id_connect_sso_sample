// OIDC Discovery Document
// GET /.well-known/openid-configuration
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getBaseUrl } from "~/lib/oidc.server";

export async function loader(_: LoaderFunctionArgs) {
  const base = getBaseUrl();

  return json(
    {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      userinfo_endpoint: `${base}/userinfo`,
      jwks_uri: `${base}/.well-known/jwks.json`,
      end_session_endpoint: `${base}/logout`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      claims_supported: ["sub", "iss", "aud", "exp", "iat", "nonce", "email", "email_verified"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: [],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    }
  );
}
