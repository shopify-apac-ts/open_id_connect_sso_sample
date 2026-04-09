// Admin API helpers — query and mutate Shopify customer data via GraphQL.
// GID→email results are cached in-memory since GIDs are immutable.
import { getCachedEmail, setCachedEmail } from "~/lib/shop-token-cache.server";
import { ADMIN_API_VERSION } from "~/lib/api-version.server";

export interface AdminApiResult {
  email: string;
  queryStr: string;
  responseStr: string;
}

// -- Shared fetch helper --

async function adminGraphql(
  shop: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<unknown> {
  const endpoint = `https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const queryStr = `${query} variables:${JSON.stringify(variables)}`;
  console.log("[admin-api] GraphQL request → url:", endpoint, "| query:", queryStr);

  const res = await fetch(endpoint, {
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
    console.error("[admin-api] request failed:", res.status, "body:", errBody);
    throw new Error(`Admin API HTTP ${res.status}`);
  }

  const json = await res.json();
  console.log("[admin-api] GraphQL response body:", JSON.stringify(json));
  return json;
}

// -- Query: resolve GID → email --

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

  let json: unknown;
  try {
    json = await adminGraphql(shop, accessToken, query, variables);
  } catch {
    return undefined;
  }

  const typed = json as { data?: { customer?: { email?: string } }; errors?: unknown[] };
  if (typed.errors) {
    console.error("[admin-api] GraphQL errors:", JSON.stringify(typed.errors));
  }

  const email = typed.data?.customer?.email;
  if (email) {
    setCachedEmail(gid, email);
    console.log("[admin-api] GID→email resolved:", gid, "→", email);
    return { email, queryStr, responseStr: JSON.stringify(json) };
  } else {
    console.warn("[admin-api] customer not found for GID:", gid);
    return undefined;
  }
}

// -- Mutation: update customer first/last name --

export async function updateCustomerNameByGid(
  shop: string,
  accessToken: string,
  gid: string,
  firstName: string,
  lastName: string
): Promise<void> {
  const query = `mutation CustomerUpdate($input: CustomerInput!) {
    customerUpdate(input: $input) {
      customer { id firstName lastName }
      userErrors { field message }
    }
  }`;
  const variables = { input: { id: gid, firstName, lastName } };

  const json = (await adminGraphql(shop, accessToken, query, variables)) as {
    data?: { customerUpdate?: { userErrors?: { field: string; message: string }[] } };
  };

  const errors = json.data?.customerUpdate?.userErrors;
  if (errors && errors.length > 0) {
    console.error("[admin-api] customerUpdate userErrors:", JSON.stringify(errors));
  }
}

// -- Mutation: upsert customer default address --

export interface WebhookAddress {
  address1?: string;
  address2?: string;
  city?: string;
  province_code?: string;
  country_code?: string;
  zip?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export async function upsertCustomerAddressByGid(
  shop: string,
  accessToken: string,
  gid: string,
  address: WebhookAddress
): Promise<void> {
  // Look up the customer's existing addresses to find the default address ID.
  // The Admin API returns addresses as a list; the first element is the default.
  const lookupQuery = `query GetCustomerAddresses($id: ID!) {
    customer(id: $id) { addresses { id } }
  }`;
  const lookupJson = (await adminGraphql(shop, accessToken, lookupQuery, { id: gid })) as {
    data?: { customer?: { addresses?: { id: string }[] } };
  };
  const addressGid = lookupJson.data?.customer?.addresses?.[0]?.id ?? null;

  const addressInput = {
    address1: address.address1 ?? "",
    address2: address.address2 ?? "",
    city: address.city ?? "",
    provinceCode: address.province_code ?? "",
    countryCode: address.country_code ?? "",
    zip: address.zip ?? "",
    firstName: address.first_name ?? "",
    lastName: address.last_name ?? "",
    phone: address.phone ?? "",
  };

  if (addressGid) {
    // Update existing address via customerAddressUpdate
    const updateQuery = `mutation CustomerAddressUpdate($customerId: ID!, $addressId: ID!, $address: MailingAddressInput!) {
      customerAddressUpdate(customerId: $customerId, addressId: $addressId, address: $address) {
        address { id }
        userErrors { field message }
      }
    }`;
    const json = (await adminGraphql(shop, accessToken, updateQuery, {
      customerId: gid,
      addressId: addressGid,
      address: addressInput,
    })) as { data?: { customerAddressUpdate?: { address?: { id: string }; userErrors?: { field: string; message: string }[] } } };
    const errors = json.data?.customerAddressUpdate?.userErrors;
    if (errors && errors.length > 0) {
      console.error("[admin-api] customerAddressUpdate userErrors:", JSON.stringify(errors));
    }
  } else {
    // Create new address via customerAddressCreate
    const createQuery = `mutation CustomerAddressCreate($customerId: ID!, $address: MailingAddressInput!) {
      customerAddressCreate(customerId: $customerId, address: $address) {
        address { id }
        userErrors { field message }
      }
    }`;
    const json = (await adminGraphql(shop, accessToken, createQuery, {
      customerId: gid,
      address: addressInput,
    })) as { data?: { customerAddressCreate?: { address?: { id: string }; userErrors?: { field: string; message: string }[] } } };
    const errors = json.data?.customerAddressCreate?.userErrors;
    if (errors && errors.length > 0) {
      console.error("[admin-api] customerAddressCreate userErrors:", JSON.stringify(errors));
    }
  }
}
