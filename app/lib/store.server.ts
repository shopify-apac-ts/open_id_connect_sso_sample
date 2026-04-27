// In-memory store for testing (reset on server restart)

export interface OidcAddress {
  street_address: string;
  locality: string;
  region: string;
  postal_code: string;
  country: string;
}

export interface SsoProfile {
  given_name: string;
  family_name: string;
  address: OidcAddress;
}

// Returns a stable test profile. The address is fixed so the extension can
// detect real drift (SSO vs Customer API) without artificial churn.
export function getSsoTestProfile(_userId: string): SsoProfile {
  return {
    given_name: "Taro SSO",
    family_name: "Yamada",
    address: {
      street_address: "1-1-1 SSO Chiyoda\nChiyoda Building 101",
      locality: "Chiyoda-ku",
      region: "JP-13",
      postal_code: "100-0001",
      country: "JP",
    },
  };
}

export interface ShopifyAddress {
  address1: string;
  address2?: string;
  city: string;
  province_code: string;
  country_code: string;
  zip: string;
  first_name: string;
  last_name: string;
  phone?: string;
  company?: string;
  default: boolean;
}

export interface ShopifyClaimsProfile {
  given_name: string;
  family_name: string;
  addresses: ShopifyAddress[];
  tags?: string;
}

// Returns a fresh Shopify-format profile on every call.
// address2 contains the current ISO timestamp to make changes visible on each login.
export function getShopifyClaimsProfile(_userId: string): ShopifyClaimsProfile {
  const ts = new Date().toISOString();
  return {
    given_name: "Taro Claims",
    family_name: "Yamada",
    tags: "OIDC_SSO",
    addresses: [
      {
        address1: "1-1-1 Claims Chiyoda",
        address2: `Chiyoda Building 101 (${ts})`,
        city: "Chiyoda-ku",
        province_code: "JP-13",
        country_code: "JP",
        zip: "1000001",
        first_name: "Taro Claims",
        last_name: "Yamada",
        phone: "+81312345678",
        default: false,
      },
    ],
  };
}

