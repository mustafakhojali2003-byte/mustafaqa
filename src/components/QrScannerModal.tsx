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
  const runningRef = useRef(false);
  const [phase, setPhase] = useState<"loading" | "scanning" | "denied" | "notfound">("loading");
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);

  const stop = useCallback(() => {
    runningRef.current = false;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const tick = useCallback(() => {
    if (!runningRef.current) return;
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.readyState >= 2 && v.videoWidth > 0) {
      c.width = v.videoWidth; c.height = v.videoHeight;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const result = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (result?.data) { stop(); onDetected(result.data); return; }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stop, onDetected]);

  const start = useCallback(async () => {
    stop();
    runningRef.current = true;
    setPhase("loading");
    setShowManual(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (!runningRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      v.play().catch(() => {});
      setPhase("scanning");
      rafRef.current = requestAnimationFrame(tick);
    } catch (e: unknown) {
      runningRef.current = false;
      const n = (e as Error)?.name ?? "";
      setPhase(n === "NotFoundError" ? "notfound" : "denied");
    }
  }, [stop, tick]);

  useEffect(() => {
    if (!open) { stop(); return; }
    setManual(""); setShowManual(false);
    start();
    return stop;
  }, [open]); // eslint-disable-line

  if (!open) return null;

  const isErr = phase === "denied" || phase === "notfound";

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

        {/* Video container - ALWAYS visible, error/manual overlaid on top */}
        <div className="relative overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "4/3" }}>
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            playsInline
            autoPlay
            muted
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Loading overlay */}
          {phase === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black z-10">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
              <div className="text-sm text-slate-400">جارٍ تشغيل الكاميرا...</div>
            </div>
          )}

          {/* Error overlay */}
          {isErr && !showManual && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b132b] z-10 p-4">
              <span className="text-5xl">📷</span>
              <div className="text-center font-black text-red-400">
                {phase === "notfound" ? "لا توجد كاميرا" : "تعذّر فتح الكاميرا"}
              </div>
              {phase === "denied" && (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-300 text-center w-full">
                  اضغط 🔒 في شريط العنوان ← الكاميرا ← السماح ← أعد المحاولة
                </div>
              )}
              <div className={`grid gap-2 w-full ${allowManual ? "grid-cols-2" : "grid-cols-1"}`}>
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
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-2 text-xs text-red-400 text-center w-full">
                  🔒 تسجيل الحضور يتطلب مسح QR فقط
                </div>
              )}
            </div>
          )}

          {/* Manual overlay */}
          {showManual && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b132b] z-10 p-4">
              <div className="text-sm font-bold text-slate-300 text-center">أدخل رمز المبنى يدوياً</div>
              <input autoFocus value={manual} onChange={e => setManual(e.target.value)}
                placeholder="مثال: gate-1"
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none text-center font-mono" />
              <div className="grid grid-cols-2 gap-2 w-full">
                <button onClick={() => { if (manual.trim()) { stop(); onDetected(manual.trim()); } }}
                  disabled={!manual.trim()} className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black disabled:opacity-40">
                  ✅ تأكيد
                </button>
                <button onClick={() => setShowManual(false)} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
                  ← رجوع
                </button>
              </div>
            </div>
          )}

          {/* Scan guide - only when scanning */}
          {phase === "scanning" && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
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

        <button onClick={() => { stop(); onClose(); }} className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
