import { getIssuer, log } from "../lib/config.js";

export default function handler(req, res) {
  const issuer = getIssuer(req);
  log("discovery", { ua: req.headers["user-agent"] });
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
      grant_types_supported: ["authorization_code"],
      scopes_supported: ["openid", "profile", "email", "phone"],
      claims_supported: [
        "iss", "sub", "aud", "exp", "iat", "nonce",
        "email", "email_verified", "name",
        "phone_number", "phone_number_verified"
      ]
    })
  );
}
