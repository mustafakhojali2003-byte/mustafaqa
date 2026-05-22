const CACHE_NAME = "mustafaqa-cache-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/"]).catch(() => undefined)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()),
  );
});

// ─── Fetch: network first, cache fallback ─────────────────────────────────────
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => undefined);
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? fetch(event.request))),
  );
});

// ─── Show notification from app ───────────────────────────────────────────────
self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === "SHOW_NOTIFICATION") {
    const p = data.payload || {};
    const isCritical = p.tag === "qa-emergency" || p.requireInteraction;
    await self.registration.showNotification(p.title || "MUSTAFA.QA", {
      body: p.body || "",
      tag: p.tag || `qa-${Date.now()}`,
      requireInteraction: !!p.requireInteraction,
      renotify: isCritical,
      icon: "/logo.svg",
      badge: "/logo.svg",
      vibrate: isCritical ? [500, 200, 500, 200, 500] : [200, 100, 200],
      data: { url: "/", emergency: isCritical, tag: p.tag },
      actions: isCritical
        ? [
            { action: "stop_siren", title: "🔇 إيقاف الصفارة / Stop Siren" },
            { action: "view", title: "📱 فتح / Open" },
          ]
        : [{ action: "view", title: "📱 فتح / Open" }],
    });
  }

  if (data.type === "CLEAR_EMERGENCY_NOTIFICATION") {
    const notifications = await self.registration.getNotifications({ tag: "qa-emergency" });
    notifications.forEach(n => n.close());
  }
});

// ─── Notification click / action ──────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  event.notification.close();

  if (action === "stop_siren") {
    // Notify all open app windows to stop the siren
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "STOP_SIREN_FROM_NOTIFICATION" });
        }
      })
    );
    return;
  }

  // Default: open app
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICKED", emergency: event.notification.data?.emergency });
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});
