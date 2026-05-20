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

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  const type = data.type || "info";
  const isEmergency = type === "emergency" || type === "sos";
  const isChat = type === "chat";
  const isTask = type === "task";

  const options = {
    body: body || "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag: isEmergency ? "qa-emergency" : `qa-${type}-${Date.now()}`,
    requireInteraction: isEmergency || isChat,
    renotify: true,
    vibrate: isEmergency ? [500,200,500,200,500] : isChat ? [300,100,300] : [200,100,200],
    data: { url: "/", type },
    silent: false,
    actions: isEmergency
      ? [{ action: "stop_siren", title: "🔇 إيقاف الصفارة" }, { action: "view", title: "📱 فتح" }]
      : isChat
      ? [{ action: "view", title: "💬 الرد" }]
      : isTask
      ? [{ action: "view", title: "📋 عرض المهمة" }]
      : [{ action: "view", title: "📱 فتح التطبيق" }],
  };

  self.registration.showNotification(title || "MUSTAFA.QA", options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  const type = event.notification.data?.type;

  if (action === "stop_siren") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach(c => c.postMessage({ type: "STOP_SIREN_FROM_NOTIFICATION" }));
      })
    );
    return;
  }

  const targetUrl = type === "chat" ? "/#chat" : type === "task" ? "/#tasks" : type === "sos" ? "/#sos" : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICKED", notifType: type });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
