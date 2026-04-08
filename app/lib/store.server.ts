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
      region: "Tokyo",
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

export interface AuthCodeData {
  userId: string;
  email: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  createdAt: number;
}

export interface RefreshTokenData {
  userId: string;
  email: string;
  clientId: string;
  scope: string;
}

const authCodes = new Map<string, AuthCodeData>();
const refreshTokens = new Map<string, RefreshTokenData>();

export function storeAuthCode(code: string, data: AuthCodeData) {
  authCodes.set(code, data);
  // Auto-delete after 10 minutes
  setTimeout(() => authCodes.delete(code), 10 * 60 * 1000);
}

export function getAuthCode(code: string): AuthCodeData | undefined {
  return authCodes.get(code);
}

export function deleteAuthCode(code: string) {
  authCodes.delete(code);
}

export function storeRefreshToken(token: string, data: RefreshTokenData) {
  refreshTokens.set(token, data);
  // Auto-delete after 24 hours (setTimeout max is ~24.8 days as a 32-bit signed integer)
  setTimeout(() => refreshTokens.delete(token), 24 * 60 * 60 * 1000);
}

export function getRefreshToken(token: string): RefreshTokenData | undefined {
  return refreshTokens.get(token);
}

export function deleteRefreshToken(token: string) {
  refreshTokens.delete(token);
}
