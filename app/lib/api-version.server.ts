// Shopify Admin API version — read from environment variable.
// Set SHOPIFY_ADMIN_API_VERSION in Render dashboard (e.g. "2026-04").
// Falls back to a hardcoded default so the app works without the variable set.
export const ADMIN_API_VERSION =
  process.env.SHOPIFY_ADMIN_API_VERSION ?? "2026-04";
