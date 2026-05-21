# FAQ - Merchant and Partner Questions

This FAQ is written for Shopify merchants, partners, and technical stakeholders evaluating the sample.
It summarizes the questions that are most likely to come up during discovery, implementation, and troubleshooting.

## Positioning

### What does this repository demonstrate?

It demonstrates an OpenID Connect (OIDC) Identity Provider for Shopify Customer Account SSO. Shopify Customer Accounts acts as the relying party (RP), and this app acts as the OpenID Provider (OP).

The main login flow is:

1. Shopify redirects the customer to this app's `/authorize` endpoint.
2. This app sends the customer to `/login`.
3. The customer signs in on the SSO login page.
4. This app redirects the browser back to Shopify with an authorization code.
5. Shopify calls `/token` server-to-server.
6. This app returns an ID token, access token, and refresh token.

### Is this a production-ready identity provider?

No. It is a working sample for testing and education. Production use requires real authentication, persistent storage, stable key management, exact `redirect_uri` validation, required PKCE, rate limiting, monitoring, audit logging, and a real user profile source.

### Is this an official Shopify product?

No. It is a sample implementation. It is not an official Shopify product or endorsed solution.

### Do merchants need Shopify Plus to connect their own identity provider?

Yes. Shopify's third-party identity provider support for customer accounts is a Shopify Plus capability.

### Is this replacing Shopify Customer Accounts?

No. Shopify Customer Accounts remains the customer account system. This app only supplies authentication and profile claims through OIDC.

### Is this related to Multipass?

It solves a similar business need, but through the newer Customer Account SSO / OIDC model. It is not a Multipass implementation.

## Merchant Setup

### What does the merchant configure in Shopify Admin?

In Shopify Admin, the merchant connects a third-party identity provider under Customer Accounts authentication settings. The key values are:

- Discovery URL: `https://<your-server>/.well-known/openid-configuration`
- Client ID: must match `CLIENT_ID`
- Client Secret: must match `CLIENT_SECRET`
- Additional scopes: include `profile`
- Logout redirect URI parameter name: `post_logout_redirect_uri`

### Why does the local development server need a public URL?

Shopify calls `/token` from Shopify's backend, not from the customer's browser. Even during local testing, Shopify must be able to reach the SSO server over the public internet. Use a tunnel such as Cloudflare Tunnel or ngrok and set `BASE_URL` to that public URL.

### Which server URL should be registered in Shopify when using split-server mode?

Register the OIDC server URL, not the login server URL. Shopify must discover and call the OIDC endpoints on the server that owns `/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/authorize`, `/token`, and `/userinfo`.

### Does the Shopify app need to be installed for basic SSO login?

No. Flow 1, the OIDC login flow, can work with only `BASE_URL`, `CLIENT_ID`, `CLIENT_SECRET`, and `SESSION_SECRET`.

The Shopify app installation is needed for Flow 0, Flow 2, and Flow 3 because those flows need an Admin API token.

## Login Flow

### Which endpoint does Shopify call during login?

The browser starts at `/authorize`, but Shopify's backend calls `/token` after the customer returns with an authorization code. `/token` is a server-to-server endpoint.

### Does Shopify call `/userinfo` during login?

No. Login-time profile sync happens through claims in the ID token returned by `/token`. `/userinfo` is used by the Customer Account UI Extension flow after login.

### Why can `/token` use `client_secret`, but `/authorize` cannot?

`/token` is called server-to-server, so Shopify can authenticate with the client secret. `/authorize` is a front-channel browser endpoint, so a client secret cannot be safely used there.

For production, `/authorize` must validate the exact Shopify callback `redirect_uri`, require PKCE, and be rate-limited.

### Why is the `sub` claim so important?

`sub` is the OIDC subject identifier. It must be stable and unique per customer. Do not reuse one `sub` for different emails, and do not issue a new `sub` for an existing email unless the Shopify customer has been intentionally deleted or merged.

Reusing a `sub` across different people is a critical account-linking risk.

### What happens if the same email logs in with a different `sub`?

Shopify blocks the login and returns the customer to the login screen. To intentionally relink the email to a new `sub`, the existing Shopify customer record must first be deleted or merged, subject to Shopify's customer deletion and merge rules.

### What happens if the same `sub` is used with a different email?

Shopify can silently log the customer into the account that originally held that `sub`. The new email is ignored for account selection. This is why `sub` uniqueness must be treated as a security requirement.

### Why does the sample accept any email and password?

The login UI is intentionally dummy authentication so partners can test the OIDC flow quickly. A production identity provider must replace this with real authentication and email ownership verification.

## Profile Sync

### How does Shopify receive customer profile data at login?

The profile data is included as ID token claims in the `/token` response. This sample returns `email`, `email_verified`, `given_name`, `family_name`, `urn:shopify:customer:addresses`, and `urn:shopify:customer:tags`.

### What must be enabled in Shopify for ID token claims to update customer records?

The identity provider's Sync customer data setting must be enabled in Shopify Admin. If the merchant expects SSO data to replace existing Shopify data, the overwrite rule must also be set to overwrite existing customer data.

### What happens to existing Shopify customer tags?

This sample sends `urn:shopify:customer:tags` with `OIDC_SSO`. When Shopify overwrite behavior is enabled, existing Shopify tags are replaced by the tags from the ID token.

### Why does the sample include `email_verified: true`?

Shopify requires the identity provider to verify that the customer owns the email address. If `email_verified` is missing or false, authentication can fail.

### Can the sample sync arbitrary custom fields?

Not through the current OIDC claim flow. The sample focuses on supported customer profile fields such as name, address, and tags. Additional merchant-specific data usually requires a Shopify app, Customer Account API, Admin API, metafields, or metaobjects depending on the use case.

### Why does `/userinfo` need the Admin API?

The Customer Account UI Extension calls `/userinfo` with a Shopify session token. That session token identifies the customer by Shopify Customer GID, not by the OIDC `sub` or email. The server uses the Admin API to resolve the GID to an email address, then maps that email to the SSO profile.

### What happens if the Shopify app has not been installed?

The server has no cached Admin API token. Flow 1 can still work, but `/userinfo` cannot resolve the real customer email through the Admin API, and webhook-based sync cannot write customer updates.

### Why does `/userinfo` require CORS but `/token` usually does not?

`/userinfo` is called from the customer's browser by a Customer Account UI Extension, so it needs CORS headers and `OPTIONS` preflight handling. `/token` is called server-to-server by Shopify, so it is not a browser CORS flow.

## Sessions and Tokens

### How long does the customer session last?

The sample returns access tokens with a one-hour lifetime and refresh tokens with a 90-day lifetime. Shopify uses the refresh token grant to keep the customer session alive.

### Can we force customers to sign in again after one hour?

Yes. Do not return a `refresh_token` from `/token`. Without a refresh token, Shopify cannot renew the access token and will end the customer session when the access token expires.

### Why do tokens become invalid after a Render Free instance restarts?

If `PRIVATE_KEY_PEM` is not set, the sample generates a new RSA key pair at startup. Existing tokens signed by the old key become invalid. Production deployments should use stable signing keys.

### Are refresh tokens stored in a database?

No. The sample uses self-contained RS256 JWT refresh tokens. Production systems may choose persistent refresh token storage if they need revocation, replay detection, device tracking, or audit history.

## Split-Server Mode

### Can the login UI live on a different domain from the OIDC endpoints?

Yes. Set `LOGIN_SERVER_URL` on the OIDC server. `/authorize` will send the browser to `/login` on the external login server.

### What must both servers share?

Both servers must share `PRIVATE_KEY_PEM` so the login server can sign authorization codes and the OIDC server can verify them. `SESSION_SECRET` may differ because the current routes do not share cookie sessions.

### Does split-server mode remove the need for shared user profile data?

No. In production, the OIDC server still needs access to the customer's profile data when `/token` or `/userinfo` responds. Use a shared database or an internal API from the login server. The sample's profile helpers are placeholders.

## Webhooks and Batch Sync

### What is Flow 3 for?

Flow 3 listens for Shopify `customers/update` webhooks and can overwrite Shopify customer data with the canonical SSO profile. It demonstrates server-side sync after Shopify-side changes.

### Can webhook writes be disabled for testing?

Yes. Set `WEBHOOK_DATA_SYNC=false` to make the webhook handler log only and skip SSO-to-Shopify writes.

### Should high-volume merchants use webhooks or a batch job?

For high-volume stores, a scheduled batch job can be safer than webhook-driven writes. Query customers updated since the last run with the Admin GraphQL `customers` query and an `updated_at` filter, then apply SSO overwrites sequentially.

## Theme Login Page

### Can merchants build a branded login or registration page in the theme?

Yes, but the theme sample is a handoff pattern. It uses a theme page and then redirects customers into `/customer_authentication/login`.

### Do the theme registration form fields create or update Shopify customers?

No. The sample's first name, last name, and terms checkbox are cosmetic/demo-only. The JavaScript only passes the email to Shopify as `login_hint`. Persisting name, address, consent, or other fields requires app-side logic.

### Can a theme control where customers land after sign-in?

Yes. Use `/customer_authentication/login?return_to=<relative-path>`. The `return_to` target should be a relative URL.

### Does `login_hint` authenticate the customer?

No. `login_hint` pre-fills or advances the email step. Shopify still runs the Customer Accounts authentication flow.

## Production Readiness

### What are the main production gaps?

Before production use, replace or add:

- Real authentication and account recovery
- Email ownership verification before setting `email_verified: true`
- Persistent user, profile, authorization code, and token storage where needed
- Stable RSA keys and key rotation
- Exact `redirect_uri` allowlisting
- Required PKCE
- Rate limiting and abuse protection
- Observability, alerting, and audit logs
- Secure Admin API token storage
- A real profile source for split-server mode

### What should partners validate in a merchant workshop?

Validate the merchant's identity provider capabilities, customer identifier strategy, email verification process, profile fields to sync, overwrite expectations, tag ownership, session lifetime requirements, and whether post-login updates should be handled by ID token claims, UI extension sync, webhook sync, or batch sync.
