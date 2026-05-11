import { useEffect, useId, useRef } from "react";
import {
  Html5QrcodeScanner,
  Html5QrcodeSupportedFormats,
  Html5QrcodeScanType,
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

  useEffect(() => {
    if (!open) return;

    const element = document.getElementById(mountId);
    if (element) {
      element.innerHTML = "";
    }

    const scanner = new Html5QrcodeScanner(
      mountId,
      {
        fps: 10,
        qrbox: { width: 260, height: 260 },
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true,
        supportedScanTypes: [
          Html5QrcodeScanType.SCAN_TYPE_CAMERA,
        ],
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      },
      false,
    );

    scanner.render(
      (decodedText) => {
        onDetected(decodedText);
        void scanner.clear().catch(() => undefined);
        scannerRef.current = null;
      },
      () => undefined,
    );

    scannerRef.current = scanner;

    return () => {
      const current = scannerRef.current;
      scannerRef.current = null;
      if (current) {
        void current.clear().catch(() => undefined);
      }
      const mount = document.getElementById(mountId);
      if (mount) {
        mount.innerHTML = "";
      }
    };
  }, [mountId, onDetected, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[32px] border border-white/10 bg-[#091128] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-white">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">{hint}</p>
            <p className="mt-1 text-xs text-slate-500">Camera only / الكاميرا فقط</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10"
          >
            {closeLabel}
          </button>
        </div>

        <div className="rounded-[24px] border border-white/10 bg-white p-3 text-slate-900">
          <div id={mountId} />
        </div>
      </div>
    </div>
  );
}
