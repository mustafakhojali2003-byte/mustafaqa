import jsPDF from "jspdf";
import type { Report, User, AttendanceRecord, Shift, Violation, AppSnapshot } from "../types/security";

function addArabicText(doc: jsPDF, text: string, x: number, y: number) {
  doc.text(text, x, y, { align: "right" });
}

export function exportReportsPDF(reports: Report[], users: User[], orgName = "MUSTAFA.QA") {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(orgName + " - Security Reports", 105, 20, { align: "center" });
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 28, { align: "center" });
  doc.line(10, 32, 200, 32);

  let y = 40;
  reports.forEach((r, i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    const statusColor = r.status === "critical" ? [220, 38, 38] : r.status === "warning" ? [217, 119, 6] : [5, 150, 105];
    doc.setFillColor(...statusColor as [number, number, number]);
    doc.rect(10, y - 4, 4, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(`#${i + 1} - ${r.senderName}`, 18, y + 3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(`${r.time} | Status: ${r.status.toUpperCase()}`, 18, y + 9);
    const lines = doc.splitTextToSize(r.text, 170);
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    doc.text(lines, 18, y + 16);
    y += 16 + lines.length * 5 + 6;
    doc.setDrawColor(220, 220, 220);
    doc.line(10, y, 200, y);
    y += 4;
  });

  doc.save(`${orgName}-reports-${Date.now()}.pdf`);
}

export function exportShiftReportPDF(shift: Shift, guardName: string, orgName = "MUSTAFA.QA") {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(orgName, 105, 20, { align: "center" });
  doc.setFontSize(14);
  doc.text("End of Shift Report", 105, 30, { align: "center" });
  doc.line(10, 35, 200, 35);

  const fields = [
    ["Guard Name", guardName],
    ["Date", shift.date],
    ["Shift Start", shift.startTime],
    ["Shift End", shift.endTime],
    ["Check In", shift.checkInTime || "—"],
    ["Check Out", shift.checkOutTime || "—"],
    ["Status", shift.status.toUpperCase()],
    ["Overtime", shift.overtimeMinutes ? `${shift.overtimeMinutes} min` : "None"],
  ];

  let y = 45;
  fields.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(label + ":", 15, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, 80, y);
    y += 8;
  });

  if (shift.endOfShiftReport) {
    y += 5;
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text("Shift Notes:", 15, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const lines = doc.splitTextToSize(shift.endOfShiftReport, 175);
    doc.text(lines, 15, y);
  }

  doc.save(`shift-report-${shift.id}.pdf`);
}

export function exportFullDashboardPDF(snap: AppSnapshot, orgName = "MUSTAFA.QA") {
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text(orgName, 105, 25, { align: "center" });
  doc.setFontSize(12);
  doc.text("Monthly Security Summary", 105, 35, { align: "center" });
  doc.setFontSize(9);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 43, { align: "center" });
  doc.line(10, 47, 200, 47);

  let y = 57;
  const stats = [
    ["Total Guards", snap.users.filter(u => u.role === "guard" && u.status === "approved").length.toString()],
    ["Total Reports", snap.reports.length.toString()],
    ["Critical Reports", snap.reports.filter(r => r.status === "critical").length.toString()],
    ["Total Visitors", snap.visitors.length.toString()],
    ["Total Shifts", snap.shifts.length.toString()],
    ["Violations", snap.violations.length.toString()],
    ["SOS Events", snap.sosEvents.length.toString()],
  ];

  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("Key Statistics", 15, y); y += 8;
  stats.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(11);
    doc.text(`• ${label}: ${value}`, 20, y); y += 7;
  });

  doc.save(`${orgName}-dashboard-${Date.now()}.pdf`);
}
