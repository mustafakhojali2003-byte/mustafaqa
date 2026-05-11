import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from "firebase/firestore";
import type { ChatMessage, Conversation, User } from "../types/security";
import { firestore } from "./firebase";

const approvedUsersCollection = collection(firestore, "approved_users");
const pendingUsersCollection = collection(firestore, "pending_users");
const conversationsCollection = collection(firestore, "conversations");

export function subscribeApprovedUsers(callback: (users: User[]) => void) {
  return onSnapshot(approvedUsersCollection, (snapshot) => {
    const users = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })) as User[];
    callback(users);
  });
}

export function subscribePendingUsers(callback: (users: User[]) => void) {
  return onSnapshot(pendingUsersCollection, (snapshot) => {
    const users = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })) as User[];
    callback(users);
  });
}

export function subscribeConversations(callback: (conversations: Conversation[]) => void) {
  return onSnapshot(conversationsCollection, (snapshot) => {
    const conversations = snapshot.docs.map((docItem) => ({ id: docItem.id, ...docItem.data() })) as Conversation[];
    callback(conversations);
  });
}

export async function ensureRemoteSeed(users: User[], conversations: Conversation[]) {
  const usersSnapshot = await getDocs(approvedUsersCollection);
  if (usersSnapshot.empty) {
    await Promise.all(
      users.map((user) => setDoc(doc(firestore, "approved_users", user.id), user)),
    );
  }

  const conversationsSnapshot = await getDocs(conversationsCollection);
  if (conversationsSnapshot.empty) {
    await Promise.all(
      conversations.map((conversation) =>
        setDoc(doc(firestore, "conversations", conversation.id), conversation),
      ),
    );
  }
}

export function saveApprovedUser(user: User) {
  return setDoc(doc(firestore, "approved_users", user.id), user);
}

export function savePendingUser(user: User) {
  return setDoc(doc(firestore, "pending_users", user.id), user);
}

export function deletePendingUserRemote(userId: string) {
  return deleteDoc(doc(firestore, "pending_users", userId));
}

export function deleteApprovedUserRemote(userId: string) {
  return deleteDoc(doc(firestore, "approved_users", userId));
}

export function saveConversation(conversation: Conversation) {
  return setDoc(doc(firestore, "conversations", conversation.id), conversation);
}

export function deleteConversationRemote(conversationId: string) {
  return deleteDoc(doc(firestore, "conversations", conversationId));
}

export function normalizeConversation(
  conversation: Conversation,
  message?: ChatMessage,
): Conversation {
  return {
    ...conversation,
    messages: message ? [...conversation.messages, message] : conversation.messages,
  };
}
