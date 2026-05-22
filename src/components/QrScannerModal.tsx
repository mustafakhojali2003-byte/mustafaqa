import { useEffect, useId, useRef, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  hint: string;
  closeLabel: string;
  onClose: () => void;
  onDetected: (code: string) => void;
};

export default function QrScannerModal({ open, title, hint, closeLabel, onClose, onDetected }: Props) {
  const rawId = useId();
  const mountId = `qr-reader-${rawId.replace(/[:]/g, "")}`;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerRef = useRef<any>(null);

  useEffect(() => {
    if (!open) {
      cleanup();
      setError(null);
      setLoading(true);
      setShowManual(false);
      return;
    }
    startScanner();
    return () => { cleanup(); };
  }, [open]);

  const cleanup = () => {
    try { scannerRef.current?.clear?.(); } catch { }
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch { }
    scannerRef.current = null;
    streamRef.current = null;
  };

  const startScanner = async () => {
    setLoading(true);
    setError(null);
    try {
      // Request camera permission
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      stream.getTracks().forEach(t => t.stop());

      // Dynamic import to avoid SSR issues
      const { Html5QrcodeScanner, Html5QrcodeSupportedFormats, Html5QrcodeScanType } = await import("html5-qrcode");

      const el = document.getElementById(mountId);
      if (el) el.innerHTML = "";

      const scanner = new Html5QrcodeScanner(
        mountId,
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
          showTorchButtonIfSupported: true,
          supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          videoConstraints: { facingMode: { ideal: "environment" } },
        },
        false
      );

      scanner.render(
        (text: string) => { onDetected(text); cleanup(); },
        () => undefined
      );

      scannerRef.current = scanner;
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setError("denied");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setError("notfound");
      } else {
        setError("denied");
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-t-[28px] sm:rounded-[28px] border border-white/10 bg-[#0b132b] p-5 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-white">{title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          </div>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300">✕</button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
            <div className="text-sm text-slate-400">جارٍ تشغيل الكاميرا...</div>
          </div>
        )}

        {/* Camera denied error */}
        {error && !showManual && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl">📷</span>
              <div className="text-center font-black text-red-400">
                {error === "notfound" ? "لا توجد كاميرا" : "الكاميرا محجوبة"}
              </div>
            </div>

            {error === "denied" && (
              <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs text-amber-300 text-center space-y-1">
                <div className="font-bold">لتفعيل الكاميرا:</div>
                <div>Chrome: اضغط 🔒 في شريط العنوان ← الكاميرا ← السماح</div>
                <div>Samsung: الإعدادات ← التطبيقات ← Chrome ← الأذونات ← الكاميرا</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button onClick={startScanner} className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black">
                🔄 إعادة المحاولة
              </button>
              <button onClick={() => setShowManual(true)} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
                ✏️ إدخال يدوي
              </button>
            </div>
          </div>
        )}

        {/* Manual input fallback */}
        {showManual && (
          <div className="space-y-3 py-2">
            <div className="text-sm font-bold text-slate-300 text-center">أدخل رمز المبنى يدوياً</div>
            <input
              autoFocus
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              placeholder="مثال: QA-GATE-1"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none text-center font-mono"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { if (manualCode.trim()) { onDetected(manualCode.trim()); } }}
                disabled={!manualCode.trim()}
                className="rounded-2xl bg-amber-500 py-3 text-sm font-black text-black disabled:opacity-40"
              >
                ✅ تأكيد
              </button>
              <button onClick={() => setShowManual(false)} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
                ← رجوع
              </button>
            </div>
          </div>
        )}

        {/* QR scanner mount */}
        {!error && !showManual && (
          <div id={mountId} className="overflow-hidden rounded-2xl" style={{ minHeight: loading ? 0 : 300 }} />
        )}

        <button onClick={onClose} className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300">
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
