import * as XLSX from "xlsx";
import type { AttendanceRecord, Report, User, Building } from "../types/security";

function formatDuration(inTime: string, outTime: string): string {
  try {
    const i = new Date(inTime.replace(" ", "T"));
    const o = new Date(outTime.replace(" ", "T"));
    const mins = Math.round((o.getTime() - i.getTime()) / 60000);
    return `${Math.floor(mins / 60)}س ${mins % 60}د`;
  } catch { return "—"; }
}

export function exportAttendanceExcel(
  attendance: AttendanceRecord[],
  users: User[],
  buildings: Building[]
) {
  const rows = attendance.map(a => {
    const user = users.find(u => u.id === a.userId);
    const building = buildings.find(b => b.id === a.buildingId);
    return {
      "الاسم / Name": a.userName,
      "الدور / Role": user?.role === "guard" ? "حارس أمن" : user?.role === "admin" ? "إداري" : "مالك",
      "المبنى / Building": building ? `${building.nameAr} / ${building.nameEn}` : a.buildingId,
      "التاريخ / Date": a.time.split(" ")[0] ?? a.time,
      "وقت الدخول / Clock In": a.time.split(" ")[1] ?? a.time,
      "وقت الخروج / Clock Out": a.checkOut ? (a.checkOut.split(" ")[1] ?? a.checkOut) : "—",
      "المدة / Duration": a.checkOut ? formatDuration(a.time, a.checkOut) : "—",
      "الطريقة / Method": a.method === "qr" ? "QR" : "يدوي",
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 12 }, { wch: 22 }, { wch: 14 },
    { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 10 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الحضور");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `MUSTAFAQA-Attendance-${date}.xlsx`);
}

export function exportReportsExcel(
  reports: Report[],
  buildings: Building[]
) {
  const rows = reports.map(r => {
    const building = buildings.find(b => b.id === r.buildingId);
    return {
      "التاريخ / Date": r.time.split(" ")[0] ?? r.time,
      "الوقت / Time": r.time.split(" ")[1] ?? r.time,
      "المرسل / Sender": r.senderName,
      "البريد / Email": r.senderEmail,
      "الهاتف / Phone": r.senderPhone,
      "المبنى / Building": building ? `${building.nameAr} / ${building.nameEn}` : r.buildingId,
      "الحالة / Status": r.status === "normal" ? "طبيعي" : r.status === "warning" ? "تحذير" : "حرج",
      "التقرير / Report": r.text,
      "تعديل / Edited": r.editedAt ? "نعم" : "لا",
      "تعليقات / Comments": (r.comments ?? []).length.toString(),
      "صورة / Photo": r.mediaUrl && r.mediaUrl !== "__local__" ? "نعم" : "لا",
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 25 }, { wch: 15 },
    { wch: 22 }, { wch: 10 }, { wch: 40 }, { wch: 8 }, { wch: 10 }, { wch: 8 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "التقارير");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `MUSTAFAQA-Reports-${date}.xlsx`);
}

export function exportFullExcel(
  attendance: AttendanceRecord[],
  reports: Report[],
  users: User[],
  buildings: Building[]
) {
  const wb = XLSX.utils.book_new();

  // Attendance sheet
  const attRows = attendance.map(a => {
    const building = buildings.find(b => b.id === a.buildingId);
    return {
      "الاسم": a.userName,
      "المبنى": building ? building.nameAr : a.buildingId,
      "التاريخ": a.time.split(" ")[0] ?? "",
      "دخول": a.time.split(" ")[1] ?? "",
      "خروج": a.checkOut?.split(" ")[1] ?? "—",
      "المدة": a.checkOut ? formatDuration(a.time, a.checkOut) : "—",
      "QR": a.method === "qr" ? "✓" : "",
    };
  });
  const wsAtt = XLSX.utils.json_to_sheet(attRows);
  wsAtt["!cols"] = [{ wch: 20 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 6 }];
  XLSX.utils.book_append_sheet(wb, wsAtt, "الحضور");

  // Reports sheet
  const repRows = reports.map(r => {
    const building = buildings.find(b => b.id === r.buildingId);
    return {
      "التاريخ": r.time.split(" ")[0] ?? "",
      "الوقت": r.time.split(" ")[1] ?? "",
      "الحارس": r.senderName,
      "المبنى": building ? building.nameAr : r.buildingId,
      "الحالة": r.status === "normal" ? "طبيعي" : r.status === "warning" ? "تحذير" : "حرج",
      "التقرير": r.text,
    };
  });
  const wsRep = XLSX.utils.json_to_sheet(repRows);
  wsRep["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 10 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, wsRep, "التقارير");

  // Guard scores sheet
  const guardUsers = users.filter(u => u.role === "guard");
  const scoreRows = guardUsers.map(g => {
    const attCount = attendance.filter(a => a.userId === g.id).length;
    const repCount = reports.filter(r => r.senderId === g.id).length;
    const violations = g.violations ?? 0;
    const score = Math.max(0, attCount * 10 + repCount * 5 - violations * 15);
    return {
      "الحارس": g.name,
      "البريد": g.email,
      "المبنى": buildings.find(b => b.id === g.assignedBuildingId)?.nameAr ?? "—",
      "أيام حضور": attCount,
      "تقارير": repCount,
      "مخالفات": violations,
      "النقاط": score,
      "التقييم": score >= 80 ? "⭐⭐⭐⭐⭐" : score >= 60 ? "⭐⭐⭐⭐" : score >= 40 ? "⭐⭐⭐" : score >= 20 ? "⭐⭐" : "⭐",
    };
  });
  const wsScore = XLSX.utils.json_to_sheet(scoreRows);
  wsScore["!cols"] = [{ wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsScore, "تقييم الحراس");

  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `MUSTAFAQA-FullReport-${date}.xlsx`);
}
