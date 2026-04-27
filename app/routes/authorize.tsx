// Authorization Endpoint
// Receives the redirect from Shopify and forwards to the login page
import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getClientId, getLoginServerUrl } from "~/lib/oidc.server";

function errorResponse(error: string, description: string, status = 400) {
  return new Response(
    JSON.stringify({ error, error_description: description }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const p = url.searchParams;

  const clientId = p.get("client_id");
  const redirectUri = p.get("redirect_uri");
  const responseType = p.get("response_type");

  // Validate required parameters
  if (!clientId || !redirectUri) {
    return errorResponse("invalid_request", "client_id and redirect_uri are required");
  }
  if (responseType !== "code") {
    return errorResponse("unsupported_response_type", "Only 'code' response_type is supported");
  }

  // Verify client_id
  if (clientId !== getClientId()) {
    return errorResponse("unauthorized_client", "Unknown client_id", 401);
  }

  // Log all incoming parameters from Shopify for debugging
  console.log("[authorize] incoming params:", JSON.stringify(Object.fromEntries(p.entries())));

  // Forward all parameters to the login page.
  // LOGIN_SERVER_URL overrides the origin for split-server deployments.
  const loginBase = getLoginServerUrl() || url.origin;
  const loginUrl = new URL("/login", loginBase);
  for (const [key, value] of p.entries()) {
    loginUrl.searchParams.set(key, value);
  }

  return redirect(loginUrl.toString());
}
