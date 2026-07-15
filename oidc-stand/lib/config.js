export const CLIENT_ID = process.env.STAND_CLIENT_ID || "pushsaas-stand";
export const CLIENT_SECRET = process.env.STAND_CLIENT_SECRET || "stand-secret-dev";
export const KID = "stand-key-1";
export const FAKE_OTP = "1234";

// Issuer выводится из хоста запроса — стенд работает на любом vercel-домене без конфига
export function getIssuer(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function log(tag, obj) {
  console.log(`[stand:${tag}]`, JSON.stringify(obj));
}
