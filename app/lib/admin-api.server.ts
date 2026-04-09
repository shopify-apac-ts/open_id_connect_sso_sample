// Admin API helper — resolves a Shopify customer GID to an email address.
// Results are cached in-memory since GIDs are immutable.
import { getCachedEmail, setCachedEmail } from "~/lib/shop-token-cache.server";
import { ADMIN_API_VERSION } from "~/lib/api-version.server";

export interface AdminApiResult {
  email: string;
  queryStr: string;
  responseStr: string;
}

export async function fetchEmailByGid(
  shop: string,
  accessToken: string,
  gid: string
): Promise<AdminApiResult | undefined> {
  const cached = getCachedEmail(gid);
  if (cached) {
    console.log("[admin-api] GID→email cache hit:", gid, "→", cached);
    // Return cached email without query/response strings (already resolved previously)
    return { email: cached, queryStr: "(cached)", responseStr: "(cached)" };
  }

  const query = `query GetCustomerEmail($id: ID!) { customer(id: $id) { email } }`;
  const variables = { id: gid };
  const queryStr = `${query} variables:${JSON.stringify(variables)}`;
  console.log("[admin-api] GraphQL request → shop:", shop, "|", queryStr);

  const res = await fetch(`https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  console.log("[admin-api] GraphQL response status:", res.status);

  if (!res.ok) {
    const errBody = await res.text();
    console.error("[admin-api] GraphQL request failed:", res.status, "body:", errBody);
    return undefined;
  }

  const json = (await res.json()) as {
    data?: { customer?: { email?: string } };
    errors?: unknown[];
  };

  const responseStr = JSON.stringify(json);
  console.log("[admin-api] GraphQL response body:", responseStr);

  if (json.errors) {
    console.error("[admin-api] GraphQL errors:", responseStr);
  }

  const email = json.data?.customer?.email;
  if (email) {
    setCachedEmail(gid, email);
    console.log("[admin-api] GID→email resolved:", gid, "→", email);
    return { email, queryStr, responseStr };
  } else {
    console.warn("[admin-api] customer not found for GID:", gid);
    return undefined;
  }
}
