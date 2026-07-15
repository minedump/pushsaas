// Generate a VAPID key pair for Web Push.
// Usage: npm run gen:vapid
import webpush from "web-push";

const keys = webpush.generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=", keys.publicKey);
console.log("VAPID_PRIVATE_KEY=", keys.privateKey);
