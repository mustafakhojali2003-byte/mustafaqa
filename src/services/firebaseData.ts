import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import type { AttendanceRecord, ChatMessage, Conversation, Report, User, VisitorRecord } from "../types/security";
import { firestore } from "./firebase";

const approvedUsersCollection = collection(firestore, "approved_users");
const pendingUsersCollection = collection(firestore, "pending_users");
const conversationsCollection = collection(firestore, "conversations");

const noop = () => {};

export function subscribeApprovedUsers(callback: (users: User[]) => void) {
  try {
    return onSnapshot(approvedUsersCollection, (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as User[]);
    }, () => noop());
  } catch { return noop; }
}

export function subscribePendingUsers(callback: (users: User[]) => void) {
  try {
    return onSnapshot(pendingUsersCollection, (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as User[]);
    }, () => noop());
  } catch { return noop; }
}

export function subscribeConversations(callback: (conversations: Conversation[]) => void) {
  try {
    return onSnapshot(conversationsCollection, (snap) => {
      callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Conversation[]);
    }, () => noop());
  } catch { return noop; }
}

export async function ensureRemoteSeed(users: User[], conversations: Conversation[]) {
  try {
    const usersSnap = await getDocs(approvedUsersCollection);
    if (usersSnap.empty) {
      await Promise.all(users.map((u) => setDoc(doc(firestore, "approved_users", u.id), u)));
    }
    const convSnap = await getDocs(conversationsCollection);
    if (convSnap.empty) {
      await Promise.all(conversations.map((c) => setDoc(doc(firestore, "conversations", c.id), c)));
    }
  } catch { /* offline – ignore */ }
}

export function saveApprovedUser(user: User) {
  try { return setDoc(doc(firestore, "approved_users", user.id), user); } catch { return Promise.resolve(); }
}

export function savePendingUser(user: User) {
  try { return setDoc(doc(firestore, "pending_users", user.id), user); } catch { return Promise.resolve(); }
}

export function deletePendingUserRemote(userId: string) {
  try { return deleteDoc(doc(firestore, "pending_users", userId)); } catch { return Promise.resolve(); }
}

export function deleteApprovedUserRemote(userId: string) {
  try { return deleteDoc(doc(firestore, "approved_users", userId)); } catch { return Promise.resolve(); }
}

export function saveConversation(conversation: Conversation) {
  try { return setDoc(doc(firestore, "conversations", conversation.id), conversation); } catch { return Promise.resolve(); }
}

export function deleteConversationRemote(conversationId: string) {
  try { return deleteDoc(doc(firestore, "conversations", conversationId)); } catch { return Promise.resolve(); }
}

export function normalizeConversation(conversation: Conversation, message?: ChatMessage): Conversation {
  return {
    ...conversation,
    messages: message ? [...conversation.messages, message] : conversation.messages,
  };
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function saveReport(report: Report): Promise<void> {
  try { await setDoc(doc(firestore, "reports", report.id), report, { merge: true }); } catch { /* offline */ }
}

export async function deleteReportRemote(id: string): Promise<void> {
  try { await deleteDoc(doc(firestore, "reports", id)); } catch { /* offline */ }
}

export function subscribeReports(cb: (reports: Report[]) => void): () => void {
  try {
    const q = query(collection(firestore, "reports"), orderBy("time", "desc"));
    return onSnapshot(q, (snap) => { cb(snap.docs.map((d) => d.data() as Report)); }, () => noop());
  } catch { return noop; }
}

// ─── Visitors ─────────────────────────────────────────────────────────────────

export async function saveVisitor(visitor: VisitorRecord): Promise<void> {
  try { await setDoc(doc(firestore, "visitors", visitor.id), visitor, { merge: true }); } catch { /* offline */ }
}

export async function updateVisitorRemote(id: string, updates: Partial<VisitorRecord>): Promise<void> {
  try { await updateDoc(doc(firestore, "visitors", id), updates as Record<string, unknown>); } catch { /* offline */ }
}

export function subscribeVisitors(cb: (visitors: VisitorRecord[]) => void): () => void {
  try {
    const q = query(collection(firestore, "visitors"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => { cb(snap.docs.map((d) => d.data() as VisitorRecord)); }, () => noop());
  } catch { return noop; }
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function saveAttendance(record: AttendanceRecord): Promise<void> {
  try { await setDoc(doc(firestore, "attendance", record.id), record, { merge: true }); } catch { /* offline */ }
}

export function subscribeAttendance(cb: (records: AttendanceRecord[]) => void): () => void {
  try {
    const q = query(collection(firestore, "attendance"), orderBy("time", "desc"));
    return onSnapshot(q, (snap) => { cb(snap.docs.map((d) => d.data() as AttendanceRecord)); }, () => noop());
  } catch { return noop; }
}
