import { getPublicJwk } from "../lib/keys.js";
import { log } from "../lib/config.js";

export default async function handler(req, res) {
  log("jwks", { ua: req.headers["user-agent"] });
  const jwk = await getPublicJwk();
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ keys: [jwk] }));
}
