# Shopify SSO Sample — OpenID Connect Provider

A sample OpenID Connect (OIDC) Identity Provider for testing Shopify's Customer Account SSO integration.
Built with Node.js + Remix (React Router).

## Endpoints

| Endpoint | Path |
|---|---|
| OIDC Discovery | `/.well-known/openid-configuration` |
| JWKS | `/.well-known/jwks.json` |
| Authorization | `/authorize` |
| Token | `/token` (POST) |
| UserInfo | `/userinfo` |
| End Session | `/logout` |

- **Authentication**: Dummy — any email and password are accepted
- **Signing algorithm**: RS256 (RSA key pair generated automatically at startup)
- **Token endpoint auth methods**: `client_secret_basic`, `client_secret_post`

## Local Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```
BASE_URL=http://localhost:3000   # Change to your Render URL after deployment
SESSION_SECRET=<random string>
CLIENT_ID=<client ID registered in Shopify>
CLIENT_SECRET=<client secret registered in Shopify>
SHOPIFY_API_SECRET=<API secret key of your Shopify app>
```

### 3. Start the development server

```bash
pnpm dev
```

## Deploying to Render

1. Push this repository to GitHub (`shopify-apac-ts/open_id_connect_sso_sample`)
2. In Render, create a **New Web Service** and connect the GitHub repository
3. Set the following environment variables in Render:
   - `BASE_URL`: The URL Render assigns to your service (e.g. `https://your-service.onrender.com`)
   - `CLIENT_ID`: Any string — must match exactly what you register in Shopify
   - `CLIENT_SECRET`: Any string — must match exactly what you register in Shopify
   - `SHOPIFY_API_SECRET`: API secret key of your Shopify app (used to verify session tokens in `/userinfo`)
   - `SESSION_SECRET`: Auto-generated via `render.yaml` (no action needed)

> **Note**: The Render Free plan spins down on idle. When it wakes up, the RSA key pair is regenerated and any existing tokens become invalid. This is expected behavior for testing purposes.

## Registering in Shopify

In the Shopify admin or Partner Dashboard, enter the following SSO provider settings:

| Field | Value |
|---|---|
| Discovery URL | `https://<your-render-url>/.well-known/openid-configuration` |
| Client ID | Same value as `CLIENT_ID` in your environment |
| Client Secret | Same value as `CLIENT_SECRET` in your environment |
| Additional scopes | `profile` |
| Logout redirect URI parameter name | `post_logout_redirect_uri` |

## Demo

See the **[Wiki](../../wiki)** for demo videos of each scenario.

## Test Login

On the login screen, sign in with **any email address and password**. No real authentication is performed.

An optional **Sub override** field is available for testing. Leave it blank to use the default `user_xxxx` key derived from the email address. Enter any value to use it directly as the OIDC `sub` claim — useful for verifying how Shopify links customers by `sub` vs email (e.g. same email with different `sub` values, or vice versa).

## Related: Custom Login Page in Theme

For a complementary approach — adding a custom login page and account page directly inside a Shopify theme while leveraging New Customer Accounts — see:

**[theme/README.md](theme/README.md)**

This shows how to redirect customers from the theme header into a branded registration form, then hand off to the `/customer_authentication/login` endpoint with pre-filled hints.
