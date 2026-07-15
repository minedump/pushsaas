import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });

mkdirSync(join(root, "keys"), { recursive: true });
writeFileSync(join(root, "keys", "private.pem"), pem);
console.log("RSA-2048 private key written to keys/private.pem");
