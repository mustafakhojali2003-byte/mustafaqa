import { getMessaging, getToken, onMessage, type Messaging } from "firebase/messaging";
import { doc, setDoc } from "firebase/firestore";
import { firebaseApp, firestore } from "./firebase";

const VAPID_KEY = "BETZFbkWqKa2-oo8lavqp5r350ebPPtqZlkzt0lki5QDcbcnlPPttBVaTABVRSnMuFn4JwXZQ5qD_lOd96MjwBk";
let messaging: Messaging | null = null;

function getMessagingInstance(): Messaging | null {
  try {
    if (!messaging) messaging = getMessaging(firebaseApp);
    return messaging;
  } catch { return null; }
}

/** Request FCM permission + get token + save to Firestore */
export async function initFCM(userId: string): Promise<string | null> {
  try {
    if (!("Notification" in window)) return null;
    if (Notification.permission === "denied") return null;
    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return null;
    }
    const msg = getMessagingInstance();
    if (!msg) return null;

    // Register the Firebase messaging service worker
    const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await getToken(msg, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (token && userId) {
      // Save token to Firestore so Cloud Functions can use it
      await setDoc(doc(firestore, "fcm_tokens", userId), {
        token,
        userId,
        updatedAt: new Date().toISOString(),
      });
    }
    return token;
  } catch { return null; }
}

/** Listen to foreground messages (app open) */
export function listenForegroundMessages(
  onAlert: (title: string, body: string, type: string) => void
): () => void {
  try {
    const msg = getMessagingInstance();
    if (!msg) return () => {};
    const unsub = onMessage(msg, (payload) => {
      const title = payload.notification?.title ?? "";
      const body = payload.notification?.body ?? "";
      const type = (payload.data?.type as string) ?? "info";
      onAlert(title, body, type);
    });
    return unsub;
  } catch { return () => {}; }
}
