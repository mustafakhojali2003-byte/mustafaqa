import { useEffect, useId, useRef } from "react";
import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats,
  Html5QrcodeScanType,
  Html5Qrcode,
} from "html5-qrcode";

type Props = {
  open: boolean;
  title: string;
  hint: string;
  closeLabel: string;
  onClose: () => void;
  onDetected: (code: string) => void;
};

export default function QrScannerModal({
  open,
  title,
  hint,
  closeLabel,
  onClose,
  onDetected,
}: Props) {
  const rawId = useId();
  const mountId = `qr-reader-${rawId.replace(/[:]/g, "")}`;
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const html5QrRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!open) {
      // cleanup
      scannerRef.current?.clear().catch(() => undefined);
      scannerRef.current = null;
      html5QrRef.current?.stop().catch(() => undefined);
      html5QrRef.current = null;
      return;
    }

    const el = document.getElementById(mountId);
    if (el) el.innerHTML = "";

    // Request camera permission explicitly first
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } })
      .then(stream => {
        // stop the test stream immediately
        stream.getTracks().forEach(t => t.stop());

        const scanner = new Html5QrcodeScanner(
          mountId,
          {
            fps: 10,
            qrbox: { width: 260, height: 260 },
            rememberLastUsedCamera: true,
            showTorchButtonIfSupported: true,
            supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            videoConstraints: { facingMode: { ideal: "environment" } },
          },
          false
        );

        scanner.render(
          (text) => {
            onDetected(text);
            scanner.clear().catch(() => undefined);
            scannerRef.current = null;
          },
          () => undefined
        );

        scannerRef.current = scanner;
      })
      .catch(() => {
        // Camera denied - show message in mount element
        const el2 = document.getElementById(mountId);
        if (el2) {
          el2.innerHTML = `
            <div style="text-align:center;padding:32px;color:#f87171;">
              <div style="font-size:48px;margin-bottom:12px;">📷</div>
              <div style="font-weight:bold;margin-bottom:8px;">تعذر الوصول للكاميرا</div>
              <div style="font-size:13px;opacity:0.7;">اسمح للمتصفح بالوصول للكاميرا ثم أعد المحاولة</div>
            </div>`;
        }
      });

    return () => {
      scannerRef.current?.clear().catch(() => undefined);
      scannerRef.current = null;
    };
  }, [open, mountId, onDetected]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-[28px] border border-white/10 bg-[#0b132b] p-5 shadow-2xl"
        style={{ margin: "16px" }}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-white">{title}</div>
            <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        {/* QR scanner mount */}
        <div
          id={mountId}
          className="overflow-hidden rounded-2xl"
          style={{ minHeight: 300 }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm font-bold text-slate-300 hover:bg-white/10 transition"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
}
