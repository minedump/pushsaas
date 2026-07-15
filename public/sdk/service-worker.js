/* PushSaaS universal service worker.
 * Host this file at the ROOT of your domain: https://your-site.com/service-worker.js
 * It is generic — the notification content comes from the push payload, so the
 * same file works for every project. Do not rename the path (scope must be "/").
 */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Уведомление", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Уведомление";
  const actions = Array.isArray(data.actions) ? data.actions.slice(0, 2) : [];
  const actionUrls = {};
  actions.forEach((a, i) => {
    actionUrls["a" + i] = a.url;
  });

  const options = {
    body: data.body || "",
    icon: data.icon || undefined,
    image: data.image || undefined,
    badge: data.badge || undefined,
    actions: actions.map((a, i) => ({ action: "a" + i, title: a.title })),
    data: {
      url: data.url || "/",
      actionUrls: actionUrls,
      campaignId: data.campaignId,
      subscriberId: data.subscriberId,
      api: data.api,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  let target = (event.action && d.actionUrls && d.actionUrls[event.action]) || d.url || "/";

  // tag the opened URL with the campaign id so the page's tracking script
  // (if attribution is enabled for this project) can set a last-click cookie
  if (d.campaignId) {
    try {
      const u = new URL(target, self.location.origin);
      u.searchParams.set("pss_c", d.campaignId);
      target = u.toString();
    } catch (e) {
      /* relative/invalid URL — leave target as-is */
    }
  }

  event.waitUntil(
    (async () => {
      // fire-and-forget click tracking
      if (d.api && d.campaignId) {
        try {
          await fetch(d.api + "/api/public/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "clicked", campaignId: d.campaignId, subscriberId: d.subscriberId }),
            keepalive: true,
          });
        } catch (e) {
          /* ignore */
        }
      }
      // focus an existing tab if one is open, else open a new one
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url === target && "focus" in c) return c.focus();
      }
      return clients.openWindow(target);
    })()
  );
});
