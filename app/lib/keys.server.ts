import { generateKeyPair, exportJWK, importPKCS8, importSPKI, type KeyLike } from "jose";
import { createPublicKey } from "crypto";
import { v4 as uuidv4 } from "uuid";

let _privateKey: KeyLike | undefined;
let _publicKey: KeyLike | undefined;
let _publicJwk: Record<string, unknown> | undefined;
let _keyId: string | undefined;
let _initPromise: Promise<void> | undefined;

async function initialize() {
  const pemInput = process.env.PRIVATE_KEY_PEM;
  if (pemInput) {
    // Fixed key from env var — required for split-server deployments so both
    // the OIDC server and the Login server share the same signing key.
    const pem = pemInput.replace(/\\n/g, "\n");
    _privateKey = await importPKCS8(pem, "RS256");
    const pubPem = createPublicKey(pem).export({ type: "spki", format: "pem" }) as string;
    _publicKey = await importSPKI(pubPem, "RS256");
    _keyId = "sso-key-fixed";
  } else {
    // Auto-generate a fresh key pair on each startup (single-server default).
    // A unique kid causes JWKS-caching relying parties to re-fetch the key set.
    const { privateKey, publicKey } = await generateKeyPair("RS256", {
      modulusLength: 2048,
    });
    _privateKey = privateKey;
    _publicKey = publicKey;
    _keyId = `sso-key-${uuidv4()}`;
  }
  const jwk = await exportJWK(_publicKey!);
  _publicJwk = { ...jwk, kid: _keyId, use: "sig", alg: "RS256" };
}

function ensureInitialized() {
  if (!_initPromise) {
    _initPromise = initialize();
  }
  return _initPromise;
}

export async function getPrivateKey() {
  await ensureInitialized();
  return { key: _privateKey!, kid: _keyId! };
}

export async function getPublicKey() {
  await ensureInitialized();
  return _publicKey!;
}

export async function getJWKS() {
  await ensureInitialized();
  return { keys: [_publicJwk!] };
}
