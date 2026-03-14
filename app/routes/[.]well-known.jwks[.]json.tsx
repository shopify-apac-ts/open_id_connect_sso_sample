// JWKS (JSON Web Key Set) Endpoint
// GET /.well-known/jwks.json
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getJWKS } from "~/lib/keys.server";

export async function loader(_: LoaderFunctionArgs) {
  const jwks = await getJWKS();

  return json(jwks, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
