import { generateKeyPair, exportJWK, type KeyLike } from "jose";
import { v4 as uuidv4 } from "uuid";

let _privateKey: KeyLike | undefined;
let _publicKey: KeyLike | undefined;
let _publicJwk: Record<string, unknown> | undefined;
// Generate a unique kid on each startup so relying parties (e.g. Shopify)
// that cache JWKS by kid will see a new kid and re-fetch the key set.
const KEY_ID = `sso-key-${uuidv4()}`;

let _initPromise: Promise<void> | undefined;

async function initialize() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    modulusLength: 2048,
  });
  _privateKey = privateKey;
  _publicKey = publicKey;
  const jwk = await exportJWK(publicKey);
  _publicJwk = { ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" };
}

function ensureInitialized() {
  if (!_initPromise) {
    _initPromise = initialize();
  }
  return _initPromise;
}

export async function getPrivateKey() {
  await ensureInitialized();
  return { key: _privateKey!, kid: KEY_ID };
}

export async function getPublicKey() {
  await ensureInitialized();
  return _publicKey!;
}

export async function getJWKS() {
  await ensureInitialized();
  return { keys: [_publicJwk!] };
}
