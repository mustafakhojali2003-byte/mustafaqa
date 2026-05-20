importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAaAKtNlGzaAMbWnVJaSz6XytVrEE5mhHI",
  authDomain: "mustafa-app-c7174.firebaseapp.com",
  projectId: "mustafa-app-c7174",
  storageBucket: "mustafa-app-c7174.firebasestorage.app",
  messagingSenderId: "95257504490",
  appId: "1:95257504490:web:0d59629d2634f1828c8593",
});

const messaging = firebase.messaging();

// Handle background push notifications
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  const isEmergency = data.type === "emergency" || data.type === "sos";

  self.registration.showNotification(title || "MUSTAFA.QA", {
    body: body || "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: data.type || "mustafaqa",
    requireInteraction: isEmergency,
    renotify: isEmergency,
    vibrate: isEmergency ? [500, 200, 500, 200, 500] : [200, 100, 200],
    data: { url: "/", type: data.type },
    actions: isEmergency
      ? [{ action: "view", title: "عرض الطوارئ / View Emergency" }]
      : [{ action: "view", title: "فتح / Open" }],
  });
});

// Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow("/") : undefined;
    })
  );
});
