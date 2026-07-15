import webpush from "web-push";

export type VapidKeys = { publicKey: string; privateKey: string };

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  url?: string;
  badge?: string;
  actions?: { title: string; url: string }[];
  campaignId?: string;
  subscriberId?: string;
  api?: string;
};

export type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}

const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

// Sends one notification. VAPID details are passed per-call (not via global
// setVapidDetails) so a multi-tenant sender can use each project's own keys.
export async function sendPush(
  sub: WebPushSubscription,
  payload: PushPayload,
  vapid: VapidKeys
) {
  return webpush.sendNotification(sub, JSON.stringify(payload), {
    vapidDetails: { subject: SUBJECT, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: 60 * 60 * 24, // keep for a day if device offline
  });
}
