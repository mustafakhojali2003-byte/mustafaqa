import QRCode from "qrcode";

export async function generateQRDataUrl(data: string, size = 200): Promise<string> {
  try {
    return await QRCode.toDataURL(data, {
      width: size, margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    });
  } catch { return ""; }
}

export async function generateVisitorQR(passCode: string, guestName: string): Promise<string> {
  const payload = JSON.stringify({ type: "visitor", passCode, guestName, ts: Date.now() });
  return generateQRDataUrl(payload);
}

export async function generateBuildingQR(buildingId: string, buildingName: string): Promise<string> {
  const payload = JSON.stringify({ type: "building", buildingId, buildingName });
  return generateQRDataUrl(payload);
}
