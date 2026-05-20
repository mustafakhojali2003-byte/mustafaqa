const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

// Helper: get all FCM tokens from Firestore
async function getAllTokens() {
  const snap = await db.collection("fcm_tokens").get();
  return snap.docs.map(d => d.data().token).filter(Boolean);
}

// Helper: send FCM to multiple tokens
async function sendToTokens(tokens, notification, data = {}) {
  if (!tokens.length) return;
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 500) chunks.push(tokens.slice(i, i + 500));
  for (const chunk of chunks) {
    await messaging.sendEachForMulticast({ tokens: chunk, notification, data }).catch(() => {});
  }
}

// ─── New Alert → notify everyone ─────────────────────────────────────────────
exports.onNewAlert = functions.firestore
  .document("alerts/{id}")
  .onCreate(async (snap) => {
    const alert = snap.data();
    if (!alert) return;
    const isCritical = alert.severity === "critical";
    const tokens = await getAllTokens();
    await sendToTokens(tokens, {
      title: `${isCritical ? "🚨" : "⚠️"} ${alert.status}`,
      body: alert.text || "",
    }, { type: isCritical ? "emergency" : "alert", alertId: snap.id });
  });

// ─── New SOS → notify everyone ────────────────────────────────────────────────
exports.onNewSOS = functions.firestore
  .document("sos_events/{id}")
  .onCreate(async (snap) => {
    const sos = snap.data();
    if (!sos) return;
    const tokens = await getAllTokens();
    await sendToTokens(tokens, {
      title: `🚨 SOS EMERGENCY`,
      body: `${sos.guardName} — ${sos.address || "Location unknown"}`,
    }, { type: "sos", sosId: snap.id });
  });

// ─── New Task → notify assigned guard ────────────────────────────────────────
exports.onNewTask = functions.firestore
  .document("tasks/{id}")
  .onCreate(async (snap) => {
    const task = snap.data();
    if (!task?.assignedTo) return;
    const tokenDoc = await db.collection("fcm_tokens").doc(task.assignedTo).get();
    const token = tokenDoc.data()?.token;
    if (!token) return;
    await messaging.send({
      token,
      notification: {
        title: `📋 مهمة جديدة / New Task`,
        body: task.title || "",
      },
      data: { type: "task", taskId: snap.id },
    }).catch(() => {});
  });

// ─── New Report → notify owner/admins ────────────────────────────────────────
exports.onNewReport = functions.firestore
  .document("reports/{id}")
  .onCreate(async (snap) => {
    const report = snap.data();
    if (!report) return;
    // Get admin/owner tokens only
    const usersSnap = await db.collection("approved_users")
      .where("role", "in", ["owner", "admin"]).get();
    const userIds = usersSnap.docs.map(d => d.id);
    const tokenDocs = await Promise.all(userIds.map(id => db.collection("fcm_tokens").doc(id).get()));
    const tokens = tokenDocs.map(d => d.data()?.token).filter(Boolean);
    if (!tokens.length) return;
    const emoji = report.status === "critical" ? "🚨" : report.status === "warning" ? "⚠️" : "📋";
    await sendToTokens(tokens, {
      title: `${emoji} تقرير جديد / New Report`,
      body: `${report.senderName}: ${(report.text || "").slice(0, 80)}`,
    }, { type: "report", reportId: snap.id });
  });

// ─── Pending user → notify owner ─────────────────────────────────────────────
exports.onNewPendingUser = functions.firestore
  .document("pending_users/{id}")
  .onCreate(async (snap) => {
    const user = snap.data();
    if (!user) return;
    const ownerSnap = await db.collection("approved_users").where("role", "==", "owner").get();
    const ownerIds = ownerSnap.docs.map(d => d.id);
    const tokenDocs = await Promise.all(ownerIds.map(id => db.collection("fcm_tokens").doc(id).get()));
    const tokens = tokenDocs.map(d => d.data()?.token).filter(Boolean);
    if (!tokens.length) return;
    await sendToTokens(tokens, {
      title: `⏳ طلب حساب جديد / New Account Request`,
      body: `${user.name} — ${user.email}`,
    }, { type: "pending_user" });
  });
