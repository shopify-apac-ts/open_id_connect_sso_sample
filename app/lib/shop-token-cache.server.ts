// In-memory caches for Shopify Admin API access tokens and GID→email mappings.
// Tokens have no TTL — they remain valid until the app is uninstalled.
// GIDs are immutable, so email cache entries never need invalidation.

// Map<shopDomain, accessToken>
const shopTokens = new Map<string, string>();

// Map<customerGid, email>
const gidEmailCache = new Map<string, string>();

// Map<nonce, shopDomain> — temporary store for OAuth state validation
const pendingNonces = new Map<string, string>();

export function getShopToken(shop: string): string | undefined {
  return shopTokens.get(shop);
}

export function setShopToken(shop: string, token: string): void {
  shopTokens.set(shop, token);
}

export function hasShopToken(shop: string): boolean {
  return shopTokens.has(shop);
}

export function getCachedEmail(gid: string): string | undefined {
  return gidEmailCache.get(gid);
}

export function setCachedEmail(gid: string, email: string): void {
  gidEmailCache.set(gid, email);
}

export function storePendingNonce(nonce: string, shop: string): void {
  pendingNonces.set(nonce, shop);
  // Auto-expire after 10 minutes
  setTimeout(() => pendingNonces.delete(nonce), 10 * 60 * 1000);
}

// Returns the shop domain associated with the nonce, then removes it (single-use).
export function consumePendingNonce(nonce: string): string | undefined {
  const shop = pendingNonces.get(nonce);
  pendingNonces.delete(nonce);
  return shop;
}
