// Login page
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { signAuthCode } from "~/lib/oidc.server";

export const meta: MetaFunction = () => [{ title: "Sign In - SSO Sample" }];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  if (!params.redirect_uri) {
    return json({ error: "No authorization request found", params: null });
  }

  return json({ error: null, params });
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = (form.get("email") as string) || "";
  const password = (form.get("password") as string) || "";
  const clientId = (form.get("client_id") as string) || "";
  const redirectUri = (form.get("redirect_uri") as string) || "";
  const scope = (form.get("scope") as string) || "openid email";
  const state = (form.get("state") as string) || "";
  const nonce = (form.get("nonce") as string) || "";
  const codeChallenge = (form.get("code_challenge") as string) || undefined;
  const codeChallengeMethod = (form.get("code_challenge_method") as string) || undefined;

  const rawSub = (form.get("sub") as string) || "";

  if (!email.trim() || !password.trim()) {
    return json({ error: "Email and password are required" });
  }
  if (!redirectUri) {
    return json({ error: "Invalid authorization request" });
  }

  // Dummy authentication: any email/password is accepted.
  // If a custom sub is provided in the form, use it directly; otherwise derive from email.
  const userId = rawSub.trim()
    ? rawSub.trim()
    : `user_${Buffer.from(email.toLowerCase()).toString("hex").slice(0, 16)}`;

  const code = await signAuthCode({
    userId,
    email,
    clientId,
    redirectUri,
    scope,
    nonce: nonce || undefined,
    codeChallenge: codeChallenge || undefined,
    codeChallengeMethod: codeChallengeMethod || undefined,
  });

  // Redirect to Shopify's callback URL
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);

  return redirect(callbackUrl.toString());
}

export default function Login() {
  const { error, params } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (error || !params) {
    return (
      <div style={containerStyle}>
        <h1>Error</h1>
        <p style={{ color: "red" }}>{error || "No authorization request found"}</p>
        <p>
          <a href="/" style={{ color: "#5c6ac4" }}>Back to home</a>
        </p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={{ marginTop: 0, color: "#202223" }}>Sign In</h1>
        <p style={{ color: "#6d7175", marginBottom: 24 }}>
          Sign in to the SSO sample site
        </p>

        {actionData?.error && (
          <div style={errorBoxStyle}>{actionData.error}</div>
        )}

        <Form method="post">
          {/* Pass OIDC parameters via hidden fields */}
          <input type="hidden" name="client_id" value={params.client_id ?? ""} />
          <input type="hidden" name="redirect_uri" value={params.redirect_uri ?? ""} />
          <input type="hidden" name="scope" value={params.scope ?? "openid email"} />
          <input type="hidden" name="state" value={params.state ?? ""} />
          <input type="hidden" name="nonce" value={params.nonce ?? ""} />
          <input type="hidden" name="code_challenge" value={params.code_challenge ?? ""} />
          <input type="hidden" name="code_challenge_method" value={params.code_challenge_method ?? ""} />

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              name="email"
              required
              style={inputStyle}
              placeholder="test@example.com"
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              name="password"
              required
              style={inputStyle}
              placeholder="any password"
            />
          </div>

          <div style={fieldStyle}>
            <label style={labelStyle} htmlFor="sub">
              Sub <span style={{ fontWeight: 400, color: "#6d7175" }}>(optional override)</span>
            </label>
            <input
              id="sub"
              type="text"
              name="sub"
              style={inputStyle}
              placeholder="Leave blank to derive from email"
            />
          </div>

          <button type="submit" style={buttonStyle}>
            Sign In
          </button>
        </Form>

        <div style={hintStyle}>
          <strong>🔧 Test hint</strong>
          <p style={{ margin: "8px 0 0" }}>
            Any email address and password will be accepted.
            <br />Example: <code>test@example.com</code> / <code>password</code>
          </p>
          <p style={{ margin: "12px 0 0" }}>
            <strong>Sub override:</strong> Leave blank to use the default{" "}
            <code>user_xxxx</code> key derived from the email. Enter any value
            to use it directly as the OIDC <code>sub</code> claim — useful for
            testing how Shopify links customers by <code>sub</code> vs email.
            <br />Examples: <code>custom-user-123</code>,{" "}
            <code>gid://shopify/Customer/12345</code>
          </p>
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  minHeight: "100vh",
  background: "#f6f6f7",
  fontFamily: "system-ui, sans-serif",
  padding: 16,
};

const cardStyle: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 32,
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: "#202223",
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #c9cccf",
  borderRadius: 6,
  fontSize: 16,
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  background: "#5c6ac4",
  color: "white",
  border: "none",
  borderRadius: 6,
  fontSize: 16,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 8,
};

const errorBoxStyle: React.CSSProperties = {
  background: "#ffd2d2",
  color: "#d72c0d",
  padding: "10px 14px",
  borderRadius: 6,
  marginBottom: 16,
  fontSize: 14,
};

const hintStyle: React.CSSProperties = {
  marginTop: 24,
  padding: 16,
  background: "#f4f6f8",
  borderRadius: 8,
  fontSize: 14,
  color: "#6d7175",
};
