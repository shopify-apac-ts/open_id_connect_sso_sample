// Webhook handler for customers/update topic.
// Shopify sends this when a customer's first name, last name, or addresses change
// (filtered via shopify.app.toml: filter = "first_name:* OR last_name:* OR addresses:*").
//
// HMAC verification:
//   Shopify signs the raw request body with SHOPIFY_API_SECRET using HMAC-SHA256
//   and sends the result (base64-encoded) in the X-Shopify-Hmac-Sha256 header.
//   The raw body must be read before JSON parsing to compute the correct digest.
//
// Sync directions handled here:
//   Direction A — Shopify → SSO:
//     When Shopify data changes (e.g. merchant edits a customer), update the SSO DB
//     so that the next userinfo call returns the latest data.
//     This sample has no persistent DB, so the logic is shown as pseudocode.
//
//   Direction B — SSO → Shopify:
//     Fetch the current SSO profile and overwrite Shopify customer data via Admin API.
//     This mirrors what the Customer Account extension does on login, but server-side.
//
// Note on in-memory cache:
//   The GID→email cache (gidEmailCache) is NOT invalidated here.
//   GIDs are immutable, so the cached email remains correct even after a name/address
//   change. If email itself were editable, the cache would need to be cleared here.
import type { ActionFunctionArgs } from "@remix-run/node";
import { createHmac, timingSafeEqual } from "crypto";
import { getShopToken } from "~/lib/shop-token-cache.server";
import { getSsoTestProfile } from "~/lib/store.server";
import {
  updateCustomerNameByGid,
  upsertCustomerAddressByGid,
  type WebhookAddress,
} from "~/lib/admin-api.server";

// Shopify webhook payload shape (customers/update topic, relevant fields only)
interface CustomerUpdatePayload {
  id: number;
  admin_graphql_api_id: string; // GID e.g. "gid://shopify/Customer/123"
  first_name: string;
  last_name: string;
  email: string;
  addresses: WebhookAddress[];
  default_address?: WebhookAddress;
}

function verifyWebhookHmac(rawBody: Buffer, hmacHeader: string): boolean {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Read raw body as buffer for HMAC verification
  const rawBody = Buffer.from(await request.arrayBuffer());
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256") ?? "";
  const shop = request.headers.get("X-Shopify-Shop-Domain") ?? "";
  const topic = request.headers.get("X-Shopify-Topic") ?? "";

  console.log("[webhook] received topic:", topic, "| shop:", shop);

  // Step 1: Verify HMAC — reject requests that are not from Shopify
  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    console.error("[webhook] HMAC verification failed — rejecting request");
    return new Response("Unauthorized", { status: 401 });
  }
  console.log("[webhook] HMAC verified");

  // Step 2: Parse payload
  let payload: CustomerUpdatePayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as CustomerUpdatePayload;
  } catch {
    console.error("[webhook] failed to parse JSON payload");
    return new Response("Bad Request", { status: 400 });
  }

  const gid = payload.admin_graphql_api_id;
  console.log("[webhook] payload:", JSON.stringify({
    gid,
    first_name: payload.first_name,
    last_name: payload.last_name,
    email: payload.email,
    addresses: payload.addresses,
  }));

  // Step 3: Look up the cached Admin API token for this store
  const shopToken = getShopToken(shop);
  if (!shopToken) {
    // App not yet installed/authorized for this store — skip silently.
    // Shopify will retry; the token will be available after the merchant installs the app.
    console.warn("[webhook] no Admin API token cached for shop:", shop, "— skipping");
    return new Response("OK", { status: 200 });
  }

  // ── Direction A: Shopify → SSO ─────────────────────────────────────────────
  // Shopify is the source of truth for this direction:
  // the merchant (or another app) has updated the customer record directly in Shopify.
  // The SSO identity provider's database should be updated to reflect these changes
  // so that the next /userinfo call returns the current data.
  //
  // PSEUDOCODE (no persistent DB in this sample):
  //   const ssoUser = await ssoDb.findByShopifyGid(gid);
  //   if (ssoUser) {
  //     await ssoDb.updateCustomer(ssoUser.id, {
  //       firstName: payload.first_name,
  //       lastName: payload.last_name,
  //       address: mapShopifyAddressToOidc(payload.default_address ?? payload.addresses[0]),
  //     });
  //     console.log("[webhook] Direction A: SSO DB updated for GID:", gid);
  //   }

  console.log("[webhook] Direction A (SSO DB update): skipped — no persistent DB in this sample");

  // ── Direction B: SSO → Shopify ─────────────────────────────────────────────
  // SSO is the source of truth for this direction:
  // fetch the canonical SSO profile and overwrite Shopify customer data via Admin API.
  // This is equivalent to what the Customer Account extension does on login,
  // but triggered server-side by the webhook event.
  console.log("[webhook] Direction B: overwriting Shopify customer with SSO profile");

  const ssoProfile = getSsoTestProfile(gid);
  console.log("[webhook] SSO profile:", JSON.stringify(ssoProfile));

  try {
    await updateCustomerNameByGid(
      shop,
      shopToken,
      gid,
      ssoProfile.given_name,
      ssoProfile.family_name
    );

    // Map OIDC address format to Shopify Admin API WebhookAddress shape
    const lines = ssoProfile.address.street_address.split("\n");
    const ssoAddress: WebhookAddress = {
      first_name: ssoProfile.given_name,
      last_name: ssoProfile.family_name,
      address1: lines[0] ?? "",
      address2: lines[1] ?? "",
      city: ssoProfile.address.locality,
      province_code: ssoProfile.address.region,
      country_code: ssoProfile.address.country,
      zip: ssoProfile.address.postal_code,
    };
    await upsertCustomerAddressByGid(shop, shopToken, gid, ssoAddress);

    console.log("[webhook] Direction B: Shopify customer updated from SSO profile");
  } catch (err) {
    console.error("[webhook] Direction B failed:", (err as Error).message);
    // Return 500 so Shopify retries the webhook delivery
    return new Response("Internal Server Error", { status: 500 });
  }

  // Shopify expects a 200 response within 5 seconds; any non-2xx triggers a retry
  return new Response("OK", { status: 200 });
}

// GET is not supported
export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}
