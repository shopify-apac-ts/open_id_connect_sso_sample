# Architecture — SSO Sample Sequence Diagrams

Four flows implemented in this sample.

---

## Flow 0 — App Installation OAuth (Admin API Token Acquisition)

The merchant installs the app via the Shopify Partner Dashboard or App Store. This flow obtains an Admin API access token and caches it server-side for subsequent Admin API calls.

```mermaid
sequenceDiagram
    actor Merchant
    participant ShopifyAdmin as Shopify Admin
    participant Auth as SSO Server<br>/auth
    participant Callback as SSO Server<br>/auth/callback
    participant ShopifyOAuth as Shopify OAuth<br>/admin/oauth/authorize

    Merchant->>ShopifyAdmin: Install app
    ShopifyAdmin->>Auth: GET /auth?shop=...&hmac=...
    Auth->>Auth: Verify HMAC signature
    Auth->>Auth: Check cached token via shop.name query
    alt Cached token still valid
        Auth->>Merchant: Show app home (token reused)
    else No token or token revoked
        Auth->>Auth: Generate nonce (UUID), store in pendingNonces
        Auth->>ShopifyOAuth: Redirect to /admin/oauth/authorize<br>(client_id, scope, redirect_uri, state=nonce)
        Merchant->>ShopifyOAuth: Approve OAuth grant
        ShopifyOAuth->>Callback: GET /auth/callback?code=...&state=nonce
        Callback->>Callback: Verify nonce (consumePendingNonce)
        Callback->>ShopifyOAuth: POST /admin/oauth/access_token<br>(client_id, client_secret, code)
        ShopifyOAuth->>Callback: access_token
        Callback->>Callback: setShopToken(shop, token) — cache in memory
        Callback->>Auth: Redirect to /auth?shop=...
        Auth->>Merchant: Show app home (token active)
    end
```

**Key points:**
- HMAC on incoming request is verified with `SHOPIFY_API_SECRET` to confirm the request is from Shopify.
- Cached tokens are validated with a live `{ shop { name } }` Admin API query — a revoked token (after uninstall) triggers re-authorization automatically.
- The nonce is single-use and auto-expires after 10 minutes to prevent replay attacks.
- The access token is stored in-memory (`Map<shopDomain, token>`); it is lost on server restart and re-acquired on the next `/auth` visit.

---

## Flow 1 — OIDC Authorization Code Flow (Login with profile sync)

Shopify Customer Account acts as the Relying Party (RP) and authenticates a customer via this SSO server acting as an OpenID Connect Provider (OP).

```mermaid
sequenceDiagram
    actor Customer
    participant RP as Shopify (Customer Account RP)
    participant OP as SSO Server (OP) /authorize /login /token

    Customer->>RP: Access protected resource
    RP->>OP: GET /authorize (client_id, redirect_uri, response_type=code, scope=openid, code_challenge, nonce)
    OP->>OP: Validate params (client_id, redirect_uri, response_type)
    OP->>Customer: 302 Redirect to /login (SSO Server login page)
    Customer->>OP: POST /login (email, password, OIDC params as hidden fields)
    OP->>OP: Authenticate, generate authorization code
    OP->>Customer: 302 Redirect to redirect_uri with code and state
    Customer->>RP: Browser arrives at Shopify callback with code
    RP->>OP: POST /token (code, client_id, client_secret, redirect_uri, code_verifier)
    Note over RP,OP: server-to-server call, not a browser redirect
    OP->>OP: Verify code and PKCE (S256), sign ID Token (RS256) and Access Token
    OP->>RP: id_token, access_token, refresh_token, expires_in
    RP->>RP: Verify ID Token claims, establish customer session
    RP->>Customer: Redirect to storefront (logged in)
```

**Key points:**
- Shopify Customer Account is the OIDC Relying Party (RP); this SSO server is the OpenID Provider (OP).
- `/authorize` validates `client_id`, `redirect_uri`, and `response_type`, then redirects the browser to the SSO Server's own `/login` page — not to any Shopify endpoint.
- `/login` is the SSO Server's login UI. The customer enters credentials here, the server generates an authorization code, and redirects the browser back to Shopify's callback URL.
- `/token` is called **server-to-server** by Shopify's backend (not a browser redirect), per [RFC 6749 §4.1.3](https://datatracker.ietf.org/doc/html/rfc6749#section-4.1.3) and [OpenID Connect Core §3.1.3](https://openid.net/specs/openid-connect-core-1_0.html#TokenEndpoint). The user's browser waits at the callback URL while this exchange completes.
- **`/token` (and all IdP endpoints) must respond within 1 second.** Shopify will time out the request and fail the login flow if this is exceeded. Ensure the server is hosted in a low-latency environment. See [Shopify IdP Requirements](https://help.shopify.com/en/manual/customers/customer-accounts/sign-in-options/identity-provider/requirements).
- Shopify reads customer identity directly from the ID Token claims (`sub`, `email`, etc.) — `/userinfo` is **not** called during login. See Flow 2 for userinfo usage.

---

## Flow 2 — Customer Account UI Extension (userinfo → Customer Data Overwrite)

Runs on every page load (Profile page and Order Index page). Fetches the SSO profile and overwrites Shopify customer data if it differs.

```mermaid
sequenceDiagram
    actor Customer
    participant Extension as UI Extension<br>(Profile / Order Index page, Preact)
    participant SessionToken as Shopify Session Token
    participant CustAPI as Customer Account API<br>(shopify://customer-account/...)
    participant OP as SSO Server<br>/userinfo
    participant AdminAPI as Shopify Admin API

    Customer->>Extension: View Profile or Order Index page
    Extension->>Extension: Check merchant setting sync_enabled
    par Parallel fetch
        Extension->>SessionToken: shopify.sessionToken.get()
        SessionToken-->>Extension: HS256 JWT (sub=GID, dest=shop)
    and
        Extension->>CustAPI: query GetCustomer<br>(id, firstName, lastName, defaultAddress)
        CustAPI-->>Extension: CustomerData
    end
    Extension->>OP: GET /userinfo<br>(Authorization: Bearer session_token)
    OP->>OP: Verify HS256 with SHOPIFY_API_SECRET<br>Extract GID and shop domain
    OP->>AdminAPI: query GetCustomerEmail(id: GID)
    AdminAPI->>OP: email
    OP->>Extension: SsoProfile<br>(sub, email, given_name, family_name, address)
    Extension->>Extension: profileMatchesCustomer(ssoProfile, customerData)?
    alt SSO profile differs from customer data
        Extension->>CustAPI: mutation CustomerUpdate<br>(firstName, lastName)
        alt Default address exists
            Extension->>CustAPI: mutation CustomerAddressUpdate<br>(addressId, address, defaultAddress=true)
        else No address on file
            Extension->>CustAPI: mutation CustomerAddressCreate<br>(address, defaultAddress=true)
        end
        Extension->>Customer: Show "Profile Synced" success banner
    else Data already in sync
        Extension->>Customer: Render nothing (silent)
    end
```

**Key points:**
- Session token fetch and customer query run in parallel to minimize latency.
- `/userinfo` response embeds the Admin API query/response in `street_address` for demo visibility.
- All API calls are logged to browser DevTools console with URL, query, and response body.

---

## Flow 3 — Webhook (Shopify customers/update → SSO → Shopify Overwrite)

Triggered by Shopify when any customer record is updated. The SSO server overwrites Shopify with the canonical SSO profile (Direction B).

```mermaid
sequenceDiagram
    participant Shopify as Shopify Platform
    participant Webhook as SSO Server<br>/webhooks/customers-update
    participant Store as SSO Profile Store<br>(in-memory, getSsoTestProfile)
    participant AdminAPI as Shopify Admin API

    Shopify->>Webhook: POST /webhooks/customers-update<br>(X-Shopify-Hmac-Sha256, X-Shopify-Shop-Domain)
    Webhook->>Webhook: Read raw body as Buffer
    Webhook->>Webhook: HMAC-SHA256 verify<br>(timingSafeEqual — timing-attack safe)
    alt HMAC invalid
        Webhook->>Shopify: 401 Unauthorized
    else HMAC valid
        Webhook->>Webhook: Parse JSON payload<br>(admin_graphql_api_id = GID, name, email, addresses)
        Webhook->>Webhook: Look up cached Admin API token for shop
        alt No token cached (app not installed)
            Webhook->>Shopify: 200 OK (skip silently, Shopify will retry)
        else Token available
            Note over Webhook: Direction A — Shopify → SSO (pseudocode)<br>Update SSO DB from webhook payload<br>(no persistent DB in this sample)
            Note over Webhook: Direction B — SSO → Shopify overwrite
            Webhook->>Store: getSsoTestProfile(GID)
            Store->>Webhook: SSO profile (given_name, family_name, address)
            alt WEBHOOK_DATA_SYNC=false
                Webhook->>Shopify: 200 OK (log-only, no data written)
            else WEBHOOK_DATA_SYNC=true (default)
                Webhook->>AdminAPI: mutation CustomerUpdate<br>(id, firstName, lastName)
                Webhook->>AdminAPI: query GetCustomerAddresses(id: GID)
                AdminAPI->>Webhook: addresses[0].id (addressGid)
                alt Address exists
                    Webhook->>AdminAPI: mutation CustomerAddressUpdate<br>(customerId, addressId, address)
                else No address on file
                    Webhook->>AdminAPI: mutation CustomerAddressCreate<br>(customerId, address)
                end
                Webhook->>Shopify: 200 OK
            end
        end
    end
```

**Key points:**
- Raw body is read as `Buffer` before JSON parsing to compute the correct HMAC.
- `WEBHOOK_DATA_SYNC=false` disables Direction B data writes (log-only mode). Default (unset) is `true`.
- Direction A (Shopify → SSO DB) is shown as pseudocode — no persistent DB in this sample.
- Direction B (SSO → Shopify) mirrors what the UI Extension does, but server-side.
- Non-2xx responses trigger automatic Shopify webhook retry.
- `X-Shopify-Hmac-Sha256` is verified with `timingSafeEqual` to prevent timing attacks.
