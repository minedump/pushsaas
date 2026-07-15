import { importPKCS8, exportJWK } from "jose";
import { KID } from "./config.js";

function pem() {
  const raw = process.env.OIDC_PRIVATE_KEY_PEM;
  if (!raw) throw new Error("OIDC_PRIVATE_KEY_PEM is not set");
  // env может прийти с литеральными \n
  return raw.includes("-----BEGIN") && raw.includes("\n")
    ? raw
    : raw.replace(/\\n/g, "\n");
}

export async function getPrivateKey() {
  return importPKCS8(pem(), "RS256");
}

export async function getPublicJwk() {
  const key = await getPrivateKey();
  const jwk = await exportJWK(key);
  // оставляем только публичную часть
  return { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", use: "sig", kid: KID };
}
