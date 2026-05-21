export type NotificationPayload = {
  title: string;
  body: string;
  tag?: string;
  requireInteraction?: boolean;
  data?: Record<string, string>;
};

// ─── Service Worker Registration ─────────────────────────────────────────────
export async function registerNotificationServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration;
  } catch {
    return null;
  }
}

// ─── Desktop Permission ───────────────────────────────────────────────────────
export async function requestDesktopPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

// ─── Show System Notification (foreground + background via SW) ────────────────
export async function showSystemNotification(payload: NotificationPayload): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission !== "granted") return false;
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(payload.title, {
          body: payload.body,
          tag: payload.tag,
          requireInteraction: payload.requireInteraction ?? false,
          data: payload.data ?? { url: "/" },
          badge: "/favicon.ico",
          icon: "/favicon.ico",
        });
        return true;
      }
    }
    new Notification(payload.title, { body: payload.body, tag: payload.tag, data: payload.data });
    return true;
  } catch {
    return false;
  }
}

// ─── Send notification via Service Worker even when app is in background ──────
export function sendToServiceWorker(payload: NotificationPayload) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg => {
    if (reg?.active) {
      reg.active.postMessage({ type: "SHOW_NOTIFICATION", payload });
    }
  });
}

// ─── Audio helpers ────────────────────────────────────────────────────────────
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextCtor =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    return new AudioContextCtor();
  } catch {
    return null;
  }
}

// ─── Normal / WhatsApp-style short sound ─────────────────────────────────────
export function playNormalAlertSound(enabled: boolean) {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;
  try {
    // Short ascending two-tone like WhatsApp
    const notes = [
      { freq: 783.99, start: 0, duration: 0.08 },
      { freq: 1046.5, start: 0.09, duration: 0.12 },
    ];
    notes.forEach(({ freq, start, duration }) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, context.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.4, context.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(context.currentTime + start);
      osc.stop(context.currentTime + start + duration + 0.01);
    });
    window.setTimeout(() => { try { void context.close(); } catch { /* ignore */ } }, 500);
  } catch {
    // ignore
  }
}

// ─── Emergency siren sound (loops until user stops it) ───────────────────────
let emergencyOscillators: OscillatorNode[] = [];
let emergencyContext: AudioContext | null = null;
let emergencyRunning = false;
let emergencyLoopTimer: ReturnType<typeof setTimeout> | null = null;

function playEmergencyLoop(ctx: AudioContext) {
  if (!emergencyRunning) return;
  emergencyOscillators = [];

  // Two-phase siren: high ↓ low → repeat
  const phases = [
    { startFreq: 1400, endFreq: 600, duration: 0.8 },
    { startFreq: 600,  endFreq: 1400, duration: 0.8 },
  ];

  let offset = 0;
  phases.forEach(({ startFreq, endFreq, duration }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(startFreq, ctx.currentTime + offset);
    osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + offset + duration);
    gain.gain.value = 0.9;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + duration);
    emergencyOscillators.push(osc);
    offset += duration;
  });

  const totalDuration = phases.reduce((sum, p) => sum + p.duration, 0);
  emergencyLoopTimer = setTimeout(() => {
    if (emergencyRunning) playEmergencyLoop(ctx);
  }, totalDuration * 1000);
}

export async function startEmergencySound() {
  if (emergencyRunning) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  // Resume AudioContext if suspended (browser autoplay policy)
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch { return; }
  }
  if (ctx.state !== "running") return;
  emergencyContext = ctx;
  emergencyRunning = true;
  playEmergencyLoop(ctx);
}

export function stopEmergencySound() {
  emergencyRunning = false;
  if (emergencyLoopTimer !== null) {
    clearTimeout(emergencyLoopTimer);
    emergencyLoopTimer = null;
  }
  emergencyOscillators.forEach(osc => {
    try { osc.stop(); } catch { /* ignore */ }
  });
  emergencyOscillators = [];
  if (emergencyContext) {
    try { void emergencyContext.close(); } catch { /* ignore */ }
    emergencyContext = null;
  }
}

export function isEmergencySoundRunning() {
  return emergencyRunning;
}

// ─── Legacy: generated alert sound (kept for compatibility) ──────────────────
export function playGeneratedAlertSound(enabled: boolean) {
  playNormalAlertSound(enabled);
}

// ─── Vibration ────────────────────────────────────────────────────────────────
export function vibrateDevice(pattern: number[] = [200, 100, 200]) {
  if (typeof window === "undefined") return;
  if ("navigator" in window && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

// ─── Emergency vibration pattern (long repeated) ──────────────────────────────
export function vibrateEmergency() {
  if (typeof window === "undefined") return;
  if ("navigator" in window && "vibrate" in navigator) {
    navigator.vibrate([500, 200, 500, 200, 500, 200, 500]);
  }
}
