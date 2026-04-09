# Architecture — SSO Sample Sequence Diagrams

Three core flows implemented in this sample.

---

## Flow 1 — OIDC Authorization Code Flow (Login → Authorize → Profile Sync)

A Relying Party (RP / external service) authenticates a customer via this SSO server acting as an OpenID Connect Provider (OP).

```mermaid
sequenceDiagram
    actor Customer
    participant RP as Relying Party (External App)
    participant OP as SSO Server (OP)<br>/authorize /token /userinfo
    participant Shopify as Shopify Customer Account
    participant AdminAPI as Shopify Admin API

    Customer->>RP: Access protected resource
    RP->>OP: GET /authorize<br>(client_id, redirect_uri, scope=openid, nonce)
    OP->>OP: Validate params, generate nonce
    OP->>Shopify: Redirect to Shopify Customer Account login
    Customer->>Shopify: Authenticate (email + password / SSO)
    Shopify->>OP: Redirect back with session token
    OP->>OP: Exchange session token → authorization code
    OP->>RP: Redirect to redirect_uri with code
    RP->>OP: POST /token (code, client_id, client_secret, redirect_uri)
    OP->>OP: Verify code, sign ID Token (RS256) and Access Token
    OP->>RP: ID Token + Access Token<br>(sub=GID, email, given_name, family_name, address)
    RP->>OP: GET /userinfo<br>(Authorization: Bearer access_token)
    OP->>OP: Verify token (RS256 via /jwks)
    OP->>AdminAPI: query GetCustomerEmail(id: GID)
    AdminAPI->>OP: email
    OP->>RP: UserInfo JSON<br>(sub, email, given_name, family_name, address)
```

**Key points:**
- `/authorize` generates a nonce and redirects to Shopify Customer Account login.
- `/token` issues RS256-signed ID Token and Access Token.
- `/userinfo` accepts either HS256 session tokens or RS256 access tokens.
- Customer email is resolved via Admin API (GID → email), cached in-memory.

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
```

**Key points:**
- Raw body is read as `Buffer` before JSON parsing to compute the correct HMAC.
- Direction A (Shopify → SSO DB) is shown as pseudocode — no persistent DB in this sample.
- Direction B (SSO → Shopify) mirrors what the UI Extension does, but server-side.
- Non-2xx responses trigger automatic Shopify webhook retry.
- `X-Shopify-Hmac-Sha256` is verified with `timingSafeEqual` to prevent timing attacks.
