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
  const [status, setStatus] = useState<"loading" | "scanning" | "denied" | "notfound">("loading");
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const scan = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < video.HAVE_ENOUGH_DATA) {
      rafRef.current = requestAnimationFrame(scan);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
    if (code?.data) {
      stopCamera();
      onDetected(code.data);
      return;
    }
    rafRef.current = requestAnimationFrame(scan);
  }, [onDetected, stopCamera]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setStatus("loading");
    setShowManual(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;

      // Wait for video element to be in DOM
      await new Promise<void>(resolve => setTimeout(resolve, 100));

      const video = videoRef.current;
      if (!video) { stopCamera(); return; }

      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;

      await new Promise<void>((resolve, reject) => {
        video.oncanplay = () => resolve();
        video.onerror = reject;
        video.play().catch(reject);
        setTimeout(resolve, 3000); // fallback
      });

      setStatus("scanning");
      // small delay to ensure DOM is updated before scanning
      setTimeout(() => { rafRef.current = requestAnimationFrame(scan); }, 200);

    } catch (err: unknown) {
      stopCamera();
      const name = (err as Error)?.name ?? "";
      if (name === "NotFoundError" || name === "DevicesNotFoundError") setStatus("notfound");
      else setStatus("denied");
    }
  }, [stopCamera, scan]);

  useEffect(() => {
    if (!open) { stopCamera(); return; }
    setManualCode("");
    startCamera();
    return stopCamera;
  }, [open]); // eslint-disable-line

  if (!open) return null;

  const isError = status === "denied" || status === "notfound";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={e => { if (e.target === e.currentTarget) { stopCamera(); onClose(); } }}
    >
      <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] border border-white/10 bg-[#0b132b] p-5 shadow-2xl">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-white">{title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          </div>
          <button onClick={() => { stopCamera(); onClose(); }} className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">✕</button>
        </div>

        {/* Video - ALWAYS in DOM so ref works */}
        <div
          className="relative overflow-hidden rounded-2xl bg-black"
          style={{ aspectRatio: "4/3", display: isError || showManual ? "none" : "block" }}
        >
          <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
          <canvas ref={canvasRef} className="hidden" />

          {/* Loading overlay */}
          {status === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
              <div className="text-sm text-slate-400">جارٍ تشغيل الكاميرا...</div>
            </div>
          )}

          {/* Scan guide */}
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

        {/* Error state */}
        {isError && !showManual && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl">📷</span>
              <div className="text-center font-black text-red-400">
                {status === "notfound" ? "لا توجد كاميرا في الجهاز" : "الكاميرا محجوبة"}
              </div>
            </div>
            {status === "denied" && (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-300 text-center space-y-1">
                <div className="font-bold">لتفعيل الكاميرا:</div>
                <div>اضغط 🔒 في شريط العنوان ← اختر الكاميرا ← السماح</div>
              </div>
            )}
            <div className={`grid gap-2 ${allowManual ? "grid-cols-2" : "grid-cols-1"}`}>
              <button onClick={startCamera} className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black">
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

        {/* Manual input */}
        {showManual && (
          <div className="space-y-3 py-2">
            <div className="text-sm font-bold text-slate-300 text-center">أدخل رمز المبنى يدوياً</div>
            <input autoFocus value={manualCode} onChange={e => setManualCode(e.target.value)}
              placeholder="مثال: gate-1"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none text-center font-mono" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { if (manualCode.trim()) { stopCamera(); onDetected(manualCode.trim()); } }}
                disabled={!manualCode.trim()}
                className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black disabled:opacity-40">
                ✅ تأكيد
              </button>
              <button onClick={() => setShowManual(false)} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
                ← رجوع
              </button>
            </div>
          </div>
        )}

        <button onClick={() => { stopCamera(); onClose(); }} className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
