# Shopify SSO Sample — OpenID Connect Provider

A sample OpenID Connect (OIDC) Identity Provider for testing Shopify's Customer Account SSO integration.
Built with Node.js + Remix (React Router).

## Prerequisites

Read these first before setting up:

- [Connect a third-party identity provider](https://help.shopify.com/en/manual/customers/customer-accounts/sign-in-options/identity-provider/connect)
- [Identity provider requirements](https://help.shopify.com/en/manual/customers/customer-accounts/sign-in-options/identity-provider/requirements)
- [Customer Authentication](https://shopify.dev/docs/api/customer-authentication)
- [Customer API reference](https://shopify.dev/docs/api/customer/unstable)

## Endpoints

| Endpoint | Path | Source File |
|---|---|---|
| [OIDC Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html) | `/.well-known/openid-configuration` | [app/routes/[.]well-known.openid-configuration.tsx](app/routes/%5B.%5Dwell-known.openid-configuration.tsx) |
| [JWKS](https://datatracker.ietf.org/doc/html/rfc7517) | `/.well-known/jwks.json` | [app/routes/[.]well-known.jwks[.]json.tsx](app/routes/%5B.%5Dwell-known.jwks%5B.%5Djson.tsx) |
| [Authorization](https://openid.net/specs/openid-connect-core-1_0.html#AuthorizationEndpoint) | `/authorize` | [app/routes/authorize.tsx](app/routes/authorize.tsx) |
| [Token](https://openid.net/specs/openid-connect-core-1_0.html#TokenEndpoint) | `/token` (POST) | [app/routes/token.tsx](app/routes/token.tsx) |
| [UserInfo](https://openid.net/specs/openid-connect-core-1_0.html#UserInfo) | `/userinfo` | [app/routes/userinfo.tsx](app/routes/userinfo.tsx) |
| Login UI | `/login` | [app/routes/login.tsx](app/routes/login.tsx) |
| [End Session](https://openid.net/specs/openid-connect-rpinitiated-1_0.html) | `/logout` | [app/routes/logout.tsx](app/routes/logout.tsx) |

- **Authentication**: Dummy — any email and password are accepted
- **Signing algorithm**: RS256 (RSA key pair generated automatically at startup)
- **Token endpoint auth methods**: `client_secret_basic`, `client_secret_post`

## Core Files

| File | Role |
|---|---|
| [app/lib/oidc.server.ts](app/lib/oidc.server.ts) | OIDC helpers — ID token / access token construction |
| [app/lib/keys.server.ts](app/lib/keys.server.ts) | RSA key-pair generation and JWKS export |
| [app/lib/store.server.ts](app/lib/store.server.ts) | In-memory authorization code and profile store |
| [app/lib/session.server.ts](app/lib/session.server.ts) | Remix session management |
| [app/lib/admin-api.server.ts](app/lib/admin-api.server.ts) | Shopify Admin API helpers (GID → email, customer update) |

## Local Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with the minimum variables required for **Flow 1** (OIDC login):

```
BASE_URL=https://<your-tunnel-url>   # Must be publicly accessible — see step 3
SESSION_SECRET=<random string>
CLIENT_ID=<client ID registered in Shopify>
CLIENT_SECRET=<client secret registered in Shopify>
```

> Additional variables for Flow 0, 2, and 3 are added later — see [Optional: Shopify App Setup for Flow 0, 2, 3](#optional-shopify-app-setup-for-flow-0-2-3).

### 3. Start the development server

```bash
pnpm dev
```

Shopify makes a **server-to-server call** to `/token` during login, so the SSO server must be reachable from the internet even during local development. Use a port-forwarding tool to expose `localhost:3000`:

```bash
# Cloudflare Tunnel (no account needed for temporary URLs)
cloudflared tunnel --url http://localhost:3000

# Alternative: ngrok
ngrok http 3000
```

Set `BASE_URL` in `.env` to the public URL printed by the tunnel tool before starting the server.

## Deploying to Render

### 1. Push this repository to GitHub

```bash
git push origin main
```

### 2. Create a New Web Service in Render and connect the GitHub repository

See [Deploy a Web Service](https://docs.render.com/web-services) for details.

### 3. Set environment variables in the Render Dashboard

| Variable | Value |
|---|---|
| `BASE_URL` | The URL Render assigns (e.g. `https://your-service.onrender.com`) |
| `CLIENT_ID` | Must match exactly what you register in Shopify |
| `CLIENT_SECRET` | Must match exactly what you register in Shopify |
| `SESSION_SECRET` | Auto-generated via `render.yaml` — no action needed |
| `SHOPIFY_API_KEY` | API key of your Shopify app — required for Flow 0, 2, 3 |
| `SHOPIFY_API_SECRET` | API secret key — required for Flow 0, 2, 3 |
| `SHOPIFY_ADMIN_API_VERSION` | Admin API version (e.g. `2026-04`) — required for Flow 0, 2, 3 |
| `WEBHOOK_DATA_SYNC` | `true` to enable data writes in Flow 3 (default) |

For build and run commands, see [`render.yaml`](render.yaml).

> **Note**: The Render Free plan spins down on idle. When it wakes up, the RSA key pair is regenerated and any existing tokens become invalid. This is expected behavior for testing purposes.

## Split-Server Deployment (Optional)

By default, all OIDC endpoints (`/authorize`, `/token`, `/.well-known/*`) and the SSO login UI (`/login`) run on the same server. This section explains how to split them across two separate Render services.

### When to use this

Use split-server mode when your OIDC endpoints and login UI must live on different domains — for example, when reusing an existing SSO login page hosted elsewhere.

### How it works

`/authorize` normally redirects the browser to `/login` on the same server. When `LOGIN_SERVER_URL` is set, it redirects to `/login` on the external login server instead.

The authorization code is a **JWT** (RS256, 10-minute TTL) signed with the OIDC server's RSA private key. Both servers share the same key pair via `PRIVATE_KEY_PEM`, so the OIDC server can verify a code that the login server signed — no shared database needed.

### Setup

#### 1. Generate a shared RSA key

Run this once and save the output:

```bash
openssl genrsa 2048 | awk 'NR==1{print} NR>1{printf "%s\\n", $0}'
```

This prints the private key with literal `\n` instead of newlines — the format required for the `PRIVATE_KEY_PEM` environment variable.

#### 2. Deploy two Render services from the same repository

| Service | Role |
|---|---|
| OIDC Server | Handles `/authorize`, `/token`, `/.well-known/*`, `/userinfo` |
| Login Server | Handles `/login`, `/logout` |

Both services deploy from the same GitHub repository.

#### 3. Set environment variables

**OIDC Server:**

| Variable | Value |
|---|---|
| `BASE_URL` | `https://your-oidc-server.onrender.com` |
| `CLIENT_ID` | Same as registered in Shopify |
| `CLIENT_SECRET` | Same as registered in Shopify |
| `SESSION_SECRET` | Random string |
| `LOGIN_SERVER_URL` | `https://your-login-server.onrender.com` |
| `PRIVATE_KEY_PEM` | PEM output from step 1 (with `\n` literals) |
| `SHOPIFY_API_KEY` | API key of your Shopify app — required for Flow 0, 2, 3 |
| `SHOPIFY_API_SECRET` | API secret key — required for Flow 0, 2, 3 |
| `SHOPIFY_ADMIN_API_VERSION` | Admin API version (e.g. `2026-04`) — required for Flow 0, 2, 3 |
| `WEBHOOK_DATA_SYNC` | `true` to enable data writes in Flow 3 (default) |

**Login Server:**

| Variable | Value |
|---|---|
| `BASE_URL` | `https://your-login-server.onrender.com` |
| `SESSION_SECRET` | Random string |
| `PRIVATE_KEY_PEM` | Same PEM value as the OIDC server |

#### 4. Register the OIDC server URL in Shopify

Use the OIDC server's URL for the discovery endpoint — **not** the login server's URL:

```
https://your-oidc-server.onrender.com/.well-known/openid-configuration
```

All Shopify-to-IdP calls (`/token`, `/.well-known/jwks.json`, etc.) target the OIDC server. The browser-visible login UI (`/login`) is served by the login server.

---

## Registering in Shopify

In the Shopify admin, go to **Settings → Customer accounts → Authentication → Manage providers → Connect a provider** and enter the following settings:

| Field | Value |
|---|---|
| Discovery URL | `https://<your-render-url>/.well-known/openid-configuration` |
| Client ID | Same value as `CLIENT_ID` in your environment |
| Client Secret | Same value as `CLIENT_SECRET` in your environment |
| Additional scopes | `profile` |
| Logout redirect URI parameter name | `post_logout_redirect_uri` |

## Optional: Shopify App Setup for Flow 0, 2, 3

Flow 1 (OIDC login) works standalone with the variables above. To also test **Flow 0** (Admin API token acquisition), **Flow 2** (UI Extension profile sync), or **Flow 3** (webhook-based data overwrite), configure and deploy a Shopify app. For details on each flow, see [Architecture](#architecture).

### 1. Create an app in the Partner Dashboard

1. Log in to the [Shopify dev dashboard](https://dev.shopify.com/dashboard) and go to **Apps → Create app → Create app manually**.
2. Give the app a name and confirm. The **Client ID** and **API secret key** are shown on the app credentials page — note both for the next step.

### 2. Configure and deploy with `shopify.app.toml`

Copy the example file and fill in your values:

```bash
cp shopify.app.toml.example shopify.app.toml
```

Edit `shopify.app.toml` — replace `client_id` and all placeholder URLs with your actual values:

```toml
client_id = "your-app-client-id"                                        # from step 1
application_url = "https://your-server-url/auth"

[webhooks]
  [[webhooks.subscriptions]]
  topics = ["customers/update"]
  uri = "https://your-server-url/webhooks/customers-update"             # Flow 3

[auth]
redirect_urls = [ "https://your-server-url/auth/callback" ]
```

Deploy the app configuration and UI extension to Shopify:

```bash
shopify app deploy
```

This registers the App URL, OAuth redirect URLs, webhook subscription (Flow 3), and UI extension (Flow 2) with Shopify in one step. Then install the app on your development store by visiting:

```
https://your-server-url/auth?shop=your-store.myshopify.com
```

After approval, the server caches an Admin API token for the store — required by Flow 2 and Flow 3.

See [App configuration reference](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration) and [Subscribe to webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe) for details.

### 3. Add the additional environment variables

Add these to your local `.env`:

```
SHOPIFY_API_KEY=<Client ID from app credentials>
SHOPIFY_API_SECRET=<API secret key from app credentials>
SHOPIFY_ADMIN_API_VERSION=2026-04
WEBHOOK_DATA_SYNC=true    # Set to false to log only without writing to Shopify (Flow 3)
```

If you are hosting on Render, set the same variables in the Render Dashboard as well — see [Deploying to Render](#deploying-to-render).

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for sequence diagrams of all four flows:
- Flow 0 — App Installation OAuth
- Flow 1 — OIDC Authorization Code Flow (Login with profile sync)
- Flow 2 — Customer Account UI Extension (profile sync)
- Flow 3 — Webhook (customers/update)

## Demo

See the **[Wiki](../../wiki)** for demo videos of each scenario.

## Test Login

On the login screen, sign in with **any email address and password**. No real authentication is performed.

An optional **Sub override** field is available for testing. Leave it blank to use the default `user_xxxx` key derived from the email address. Enter any value to use it directly as the OIDC `sub` claim — useful for verifying how Shopify links customers by `sub` vs email (e.g. same email with different `sub` values, or vice versa).

## Related: Custom Login Page in Theme

For a complementary approach — adding a custom login page and account page directly inside a Shopify theme while leveraging New Customer Accounts — see:

**[theme/README.md](theme/README.md)**

This shows how to redirect customers from the theme header into a branded registration form, then hand off to the `/customer_authentication/login` endpoint with pre-filled hints.

## Disclaimer

This sample is provided for testing and educational purposes only. It is **not** an official Shopify product or endorsed solution. The author makes no warranties and accepts no responsibility for any issues, bugs, or damages arising from its use. Content and behavior may change without notice.
