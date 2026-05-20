import {
  collection, deleteDoc, doc, getDocs,
  onSnapshot, orderBy, query, setDoc, updateDoc,
} from "firebase/firestore";
import type {
  AlertLog, AttendanceRecord, ChatMessage, Conversation,
  Report, Shift, SOSEvent, Task, User, Violation, VisitorRecord,
} from "../types/security";
import { firestore } from "./firebase";

const noop = () => {};

// ─── Collections ──────────────────────────────────────────────────────────────
const col = (name: string) => collection(firestore, name);

// ─── Generic helpers ──────────────────────────────────────────────────────────
function subscribe<T>(
  collectionName: string,
  cb: (items: T[]) => void,
  orderField?: string,
): () => void {
  try {
    const q = orderField
      ? query(col(collectionName), orderBy(orderField, "desc"))
      : col(collectionName);
    return onSnapshot(q as any, (snap: any) => {
      cb(snap.docs.map((d: any) => ({ ...d.data(), id: d.id }) as T));
    }, () => noop());
  } catch { return noop; }
}

async function save(collectionName: string, id: string, data: object): Promise<void> {
  try { await setDoc(doc(firestore, collectionName, id), data, { merge: true }); } catch { }
}

async function remove(collectionName: string, id: string): Promise<void> {
  try { await deleteDoc(doc(firestore, collectionName, id)); } catch { }
}

async function update(collectionName: string, id: string, data: object): Promise<void> {
  try { await updateDoc(doc(firestore, collectionName, id), data as any); } catch { }
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
export async function ensureRemoteSeed(users: User[], _conversations: Conversation[]) {
  try {
    // Only seed owner account if approved_users is empty
    const usersSnap = await getDocs(col("approved_users"));
    if (usersSnap.empty) {
      const owner = users.find(u => u.role === "owner");
      if (owner) await setDoc(doc(firestore, "approved_users", owner.id), owner);
    }
    // Never seed reports/alerts/etc - those come from real usage
  } catch { }
}

// ─── Users ────────────────────────────────────────────────────────────────────
export const subscribeApprovedUsers = (cb: (u: User[]) => void) =>
  subscribe<User>("approved_users", cb);

export const subscribePendingUsers = (cb: (u: User[]) => void) =>
  subscribe<User>("pending_users", cb);

export const saveApprovedUser = (u: User) => save("approved_users", u.id, u);
export const savePendingUser = (u: User) => save("pending_users", u.id, u);
export const deleteApprovedUserRemote = (id: string) => remove("approved_users", id);
export const deletePendingUserRemote = (id: string) => remove("pending_users", id);

// ─── Conversations ────────────────────────────────────────────────────────────
export const subscribeConversations = (cb: (c: Conversation[]) => void) =>
  subscribe<Conversation>("conversations", cb);

export const saveConversation = (c: Conversation) => save("conversations", c.id, c);
export const deleteConversationRemote = (id: string) => remove("conversations", id);

export function normalizeConversation(c: Conversation, message?: ChatMessage): Conversation {
  return { ...c, messages: message ? [...c.messages, message] : c.messages };
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export const subscribeReports = (cb: (r: Report[]) => void) =>
  subscribe<Report>("reports", cb, "time");

export const saveReport = (r: Report) => {
  // Strip base64 images before saving to Firestore (1MB doc limit)
  // Store only metadata, image stays in localStorage
  const firestoreReport = { ...r };
  if (firestoreReport.mediaUrl && firestoreReport.mediaUrl.startsWith("data:")) {
    firestoreReport.mediaUrl = "__local__"; // flag that image is local only
  }
  return save("reports", r.id, firestoreReport);
};
export const deleteReportRemote = (id: string) => remove("reports", id);

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const subscribeAlerts = (cb: (a: AlertLog[]) => void) =>
  subscribe<AlertLog>("alerts", cb, "time");

export const saveAlert = (a: AlertLog) => save("alerts", a.id, a);
export const deleteAlertRemote = (id: string) => remove("alerts", id);

// ─── Visitors ─────────────────────────────────────────────────────────────────
export const subscribeVisitors = (cb: (v: VisitorRecord[]) => void) =>
  subscribe<VisitorRecord>("visitors", cb, "createdAt");

export const saveVisitor = (v: VisitorRecord) => save("visitors", v.id, v);
export const updateVisitorRemote = (id: string, data: Partial<VisitorRecord>) =>
  update("visitors", id, data);
export const deleteVisitorRemote = (id: string) => remove("visitors", id);

// ─── Attendance ───────────────────────────────────────────────────────────────
export const subscribeAttendance = (cb: (a: AttendanceRecord[]) => void) =>
  subscribe<AttendanceRecord>("attendance", cb, "time");

export const saveAttendance = (a: AttendanceRecord) => save("attendance", a.id, a);

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const subscribeTasks = (cb: (t: Task[]) => void) =>
  subscribe<Task>("tasks", cb, "createdAt");

export const saveTask = (t: Task) => save("tasks", t.id, t);
export const updateTaskRemote = (id: string, data: Partial<Task>) =>
  update("tasks", id, data);
export const deleteTaskRemote = (id: string) => remove("tasks", id);

// ─── Shifts ───────────────────────────────────────────────────────────────────
export const subscribeShifts = (cb: (s: Shift[]) => void) =>
  subscribe<Shift>("shifts", cb, "createdAt");

export const saveShift = (s: Shift) => save("shifts", s.id, s);
export const updateShiftRemote = (id: string, data: Partial<Shift>) =>
  update("shifts", id, data);

// ─── Violations ───────────────────────────────────────────────────────────────
export const subscribeViolations = (cb: (v: Violation[]) => void) =>
  subscribe<Violation>("violations", cb, "issuedAt");

export const saveViolation = (v: Violation) => save("violations", v.id, v);
export const updateViolationRemote = (id: string, data: Partial<Violation>) =>
  update("violations", id, data);

// ─── SOS Events ───────────────────────────────────────────────────────────────
export const subscribeSOSEvents = (cb: (s: SOSEvent[]) => void) =>
  subscribe<SOSEvent>("sos_events", cb, "time");

export const saveSOSEvent = (s: SOSEvent) => save("sos_events", s.id, s);
export const updateSOSEventRemote = (id: string, data: Partial<SOSEvent>) =>
  update("sos_events", id, data);
