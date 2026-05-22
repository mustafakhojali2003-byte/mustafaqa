import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

type Props = {
  open: boolean;
  title: string;
  hint: string;
  closeLabel: string;
  onClose: () => void;
  onDetected: (code: string) => void;
  allowManual?: boolean;
};

export default function QrScannerModal({ open, title, hint, closeLabel, onClose, onDetected, allowManual = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const activeRef = useRef(false);
  const [status, setStatus] = useState<"loading" | "scanning" | "denied" | "notfound">("loading");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);

  const stop = useCallback(() => {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const tick = useCallback(() => {
    if (!activeRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (v && c && v.readyState >= 2 && v.videoWidth > 0) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(v, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(d.data, d.width, d.height, { inversionAttempts: "dontInvert" });
        if (code?.data) {
          stop();
          onDetected(code.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onDetected, stop]);

  const start = useCallback(async () => {
    stop();
    activeRef.current = true;
    setStatus("loading");
    setShowManual(false);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      if (!activeRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) { stream.getTracks().forEach(t => t.stop()); return; }

      v.srcObject = stream;
      v.play().catch(() => {});
      setStatus("scanning");
      rafRef.current = requestAnimationFrame(tick);

    } catch (e: unknown) {
      activeRef.current = false;
      const n = (e as Error)?.name ?? "";
      setStatus(n.includes("NotFound") || n.includes("Devices") ? "notfound" : "denied");
    }
  }, [stop, tick]);

  useEffect(() => {
    if (!open) { stop(); return; }
    setManualCode("");
    start();
    return stop;
  }, [open]); // eslint-disable-line

  if (!open) return null;

  const isErr = status === "denied" || status === "notfound";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={e => { if (e.target === e.currentTarget) { stop(); onClose(); } }}
    >
      <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] border border-white/10 bg-[#0b132b] p-5 shadow-2xl">

        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-white">{title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          </div>
          <button onClick={() => { stop(); onClose(); }} className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">✕</button>
        </div>

        {/* Video - always in DOM */}
        <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "4/3", display: isErr || showManual ? "none" : undefined }}>
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline autoPlay muted />
          <canvas ref={canvasRef} className="hidden" />
          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
              <div className="text-sm text-slate-400">جارٍ تشغيل الكاميرا...</div>
            </div>
          )}
          {status === "scanning" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="relative h-52 w-52">
                <div className="absolute top-0 left-0 h-8 w-8 border-t-4 border-l-4 border-amber-400 rounded-tl-lg" />
                <div className="absolute top-0 right-0 h-8 w-8 border-t-4 border-r-4 border-amber-400 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 border-amber-400 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 border-amber-400 rounded-br-lg" />
                <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-amber-400/70 animate-pulse" />
              </div>
            </div>
          )}
        </div>

        {isErr && !showManual && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl">📷</span>
              <div className="text-center font-black text-red-400">
                {status === "notfound" ? "لا توجد كاميرا" : "تعذّر فتح الكاميرا"}
              </div>
            </div>
            {status === "denied" && (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-300 text-center">
                اضغط 🔒 في شريط العنوان ← الكاميرا ← السماح ← أعد المحاولة
              </div>
            )}
            <div className={`grid gap-2 ${allowManual ? "grid-cols-2" : "grid-cols-1"}`}>
              <button onClick={start} className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black">
                🔄 إعادة المحاولة
              </button>
              {allowManual && (
                <button onClick={() => setShowManual(true)} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
                  ✏️ إدخال يدوي
                </button>
              )}
            </div>
            {!allowManual && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-400 text-center">
                🔒 تسجيل الحضور يتطلب مسح QR فقط
              </div>
            )}
          </div>
        )}

        {showManual && (
          <div className="space-y-3 py-2">
            <div className="text-sm font-bold text-slate-300 text-center">أدخل رمز المبنى يدوياً</div>
            <input autoFocus value={manualCode} onChange={e => setManualCode(e.target.value)}
              placeholder="مثال: gate-1"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none text-center font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { if (manualCode.trim()) { stop(); onDetected(manualCode.trim()); } }}
                disabled={!manualCode.trim()} className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black disabled:opacity-40">
                ✅ تأكيد
              </button>
              <button onClick={() => setShowManual(false)} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
                ← رجوع
              </button>
            </div>
          </div>
        )}

        <button onClick={() => { stop(); onClose(); }} className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
