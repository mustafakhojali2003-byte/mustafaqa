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

// Tab mapping for deep links
const TAB_MAP = {
  report: "reports", chat: "chat", task: "tasks",
  emergency: "sos", sos: "sos", alert: "alerts",
  visitor: "visitors", pending_user: "users",
};

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  const data = payload.data || {};
  const type = data.type || "info";
  const isEmergency = type === "emergency" || type === "sos";
  const isChat = type === "chat";
  const isTask = type === "task";
  const isReport = type === "report";
  const isVisitor = type === "visitor";

  // Unique tag per message for chat (no grouping), group for others
  const tag = isChat || isReport
    ? `qa-${type}-${Date.now()}`
    : isEmergency ? "qa-emergency" : `qa-${type}`;

  const actions = isEmergency
    ? [{ action: "stop_siren", title: "🔇 إيقاف الصفارة" }, { action: "view", title: "📱 فتح" }]
    : isChat
    ? [{ action: "reply", title: "💬 فتح الدردشة" }]
    : isReport
    ? [{ action: "view_report", title: "📋 عرض التقرير" }]
    : isTask
    ? [{ action: "view_task", title: "✅ عرض المهمة" }]
    : isVisitor
    ? [{ action: "view_visitor", title: "🎫 عرض الزائر" }]
    : [{ action: "view", title: "📱 فتح" }];

  self.registration.showNotification(title || "MUSTAFA.QA", {
    body: body || "",
    icon: "/logo.svg",
    badge: "/logo.svg",
    tag,
    requireInteraction: isEmergency || isChat || isReport,
    renotify: true,
    silent: false,
    vibrate: isEmergency
      ? [500, 200, 500, 200, 500]
      : isChat || isReport
      ? [300, 100, 300, 100, 300]
      : [200, 100, 200],
    timestamp: Date.now(),
    data: { type, tab: TAB_MAP[type] || "reports" },
    actions,
  });
});

// Handle notification click → open app at correct tab
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const action = event.action;
  const notifType = event.notification.data?.type;
  const tab = event.notification.data?.tab || "reports";

  if (action === "stop_siren") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        clients.forEach(c => c.postMessage({ type: "STOP_SIREN_FROM_NOTIFICATION" }));
      })
    );
    return;
  }

  // For all other actions → open app and navigate to tab
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // If app already open → focus and navigate
      for (const client of clients) {
        if ("focus" in client) {
          client.postMessage({ type: "NOTIFICATION_CLICKED", notifType, tab });
          return client.focus();
        }
      }
      // If app closed → open it
      const url = `https://mustafaqa.vercel.app/?tab=${tab}`;
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Show notification from app (when foreground)
self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === "SHOW_NOTIFICATION") {
    const p = data.payload || {};
    const isEmergency = p.tag === "qa-emergency" || p.requireInteraction;
    await self.registration.showNotification(p.title || "MUSTAFA.QA", {
      body: p.body || "",
      tag: p.tag || `qa-${Date.now()}`,
      requireInteraction: !!p.requireInteraction,
      renotify: isEmergency,
      icon: "/logo.svg",
      badge: "/logo.svg",
      vibrate: isEmergency ? [500, 200, 500, 200, 500] : [200, 100, 200],
      data: { type: p.notifType || "info", tab: TAB_MAP[p.notifType] || "reports" },
      actions: isEmergency
        ? [{ action: "stop_siren", title: "🔇 إيقاف الصفارة" }, { action: "view", title: "📱 فتح" }]
        : [{ action: "view", title: "📱 فتح" }],
    });
  }

  if (data.type === "CLEAR_EMERGENCY_NOTIFICATION") {
    const notifications = await self.registration.getNotifications({ tag: "qa-emergency" });
    notifications.forEach(n => n.close());
  }
});
