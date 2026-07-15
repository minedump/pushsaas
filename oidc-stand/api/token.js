import { jwtVerify, SignJWT } from "jose";
import { CLIENT_ID, CLIENT_SECRET, KID, getIssuer, readBody, log } from "../lib/config.js";
import { getPrivateKey } from "../lib/keys.js";

function clientCreds(req, body) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Basic ")) {
    const [id, secret] = Buffer.from(h.slice(6), "base64").toString().split(":");
    return { id: decodeURIComponent(id), secret: decodeURIComponent(secret) };
  }
  return { id: body.client_id, secret: body.client_secret };
}

function buildClaims({ variant, phone, email, name }, issuerHost) {
  const digits = String(phone || "").replace(/\D/g, "");
  const base = { name: name || undefined };
  switch (variant) {
    case "phone_only":
      return { ...base, sub: `ph-${digits}`, phone_number: `+${digits}`, phone_number_verified: true };
    case "phone_synth_email":
      return {
        ...base, sub: `ph-${digits}`,
        phone_number: `+${digits}`, phone_number_verified: true,
        email: `${digits}@id.${issuerHost}`, email_verified: true
      };
    case "phone_real_email":
      return {
        ...base, sub: `ph-${digits}`,
        phone_number: `+${digits}`, phone_number_verified: true,
        email, email_verified: true
      };
    case "email_only":
    default:
      return { ...base, sub: `em-${email}`, email, email_verified: true };
  }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "invalid_request" }));
    return;
  }

  const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
  const creds = clientCreds(req, body);
  log("token:req", {
    grant_type: body.grant_type,
    client_id: creds.id,
    auth_via: req.headers.authorization ? "basic" : "post",
    ua: req.headers["user-agent"]
  });

  if (creds.id !== CLIENT_ID || creds.secret !== CLIENT_SECRET) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "invalid_client" }));
    return;
  }
  if (body.grant_type !== "authorization_code" || !body.code) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "unsupported_grant_type" }));
    return;
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(body.code, new TextEncoder().encode(CLIENT_SECRET), {
      audience: CLIENT_ID
    }));
  } catch (e) {
    log("token:bad_code", { message: e.message });
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "invalid_grant" }));
    return;
  }

  const issuer = getIssuer(req);
  const claims = buildClaims(payload, new URL(issuer).host);
  const idToken = await new SignJWT({
    ...claims,
    ...(payload.nonce ? { nonce: payload.nonce } : {})
  })
    .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(CLIENT_ID)
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(await getPrivateKey());

  // access_token — тоже JWT с claims, чтобы /userinfo мог их отдать без БД
  const accessToken = await new SignJWT({ uinfo: claims })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("userinfo")
    .setExpirationTime("1h")
    .setIssuedAt()
    .sign(new TextEncoder().encode(CLIENT_SECRET));

  log("token:issued", { variant: payload.variant, sub: claims.sub, claims: Object.keys(claims) });
  res.end(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email phone",
      id_token: idToken
    })
  );
}
