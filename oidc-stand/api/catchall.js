import { log } from "../lib/config.js";

// Ловит все запросы, не попавшие в известные маршруты — чтобы видеть,
// куда именно стучится InSales (кривой issuer, неожиданные пути и т.п.)
export default function handler(req, res) {
  log("catchall", {
    method: req.method,
    url: req.url,
    ua: req.headers["user-agent"],
    referer: req.headers.referer || ""
  });
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "not_found", path: req.url }));
}
