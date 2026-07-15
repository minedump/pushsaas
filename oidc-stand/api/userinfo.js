import { jwtVerify } from "jose";
import { CLIENT_SECRET, readBody, log } from "../lib/config.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  let token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token && req.method === "POST") {
    const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
    token = body.access_token || "";
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(CLIENT_SECRET), {
      audience: "userinfo"
    });
    log("userinfo:ok", { sub: payload.uinfo.sub, ua: req.headers["user-agent"] });
    res.end(JSON.stringify(payload.uinfo));
  } catch (e) {
    log("userinfo:fail", { message: e.message, ua: req.headers["user-agent"] });
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
    res.end(JSON.stringify({ error: "invalid_token" }));
  }
}
