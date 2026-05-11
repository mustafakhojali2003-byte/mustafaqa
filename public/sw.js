const CACHE_NAME = "qa-security-cache-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/"]).catch(() => undefined)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

// ─── Fetch: network first, cache fallback (for offline support) ───────────────
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

// ─── Message: show notification from app ─────────────────────────────────────
self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "SHOW_NOTIFICATION") {
    const payload = data.payload || {};
    await self.registration.showNotification(payload.title || "QA SECURITY", {
      body: payload.body || "",
      tag: payload.tag || `qa-${Date.now()}`,
      requireInteraction: !!payload.requireInteraction,
      data: payload.data || { url: "/", emergency: false },
      badge: "/favicon.ico",
      icon: "/favicon.ico",
    });
  }

  if (data.type === "SHOW_EMERGENCY_NOTIFICATION") {
    const payload = data.payload || {};
    // Show a persistent emergency notification that requires interaction
    await self.registration.showNotification(
      `🚨 ${payload.title || "EMERGENCY / طوارئ"}`,
      {
        body: payload.body || "",
        tag: "qa-emergency",
        requireInteraction: true,
        renotify: true,
        data: { url: "/", emergency: true },
        badge: "/favicon.ico",
        icon: "/favicon.ico",
      },
    );
  }

  if (data.type === "SHOW_VISITOR_NOTIFICATION") {
    const payload = data.payload || {};
    await self.registration.showNotification(
      `🔔 ${payload.title || "Visitor Alert / تنبيه زائر"}`,
      {
        body: payload.body || "",
        tag: payload.tag || `qa-visitor-${Date.now()}`,
        requireInteraction: false,
        data: { url: "/", emergency: false },
        badge: "/favicon.ico",
        icon: "/favicon.ico",
      },
    );
  }
});

// ─── Notification click ───────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  const isEmergency = event.notification.data?.emergency === true;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.postMessage({
              type: isEmergency ? "EMERGENCY_CLICKED" : "NOTIFICATION_CLICKED",
              url: targetUrl,
            });
            return client.focus();
          }
        }
        return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
      }),
  );
});
