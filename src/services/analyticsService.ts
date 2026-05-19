import type { Report, Shift, Violation, SOSEvent, AttendanceRecord, Building } from "../types/security";

export interface Insight {
  type: "warning" | "info" | "critical";
  title: string; titleAr: string;
  body: string; bodyAr: string;
}

export function analyzeData(
  reports: Report[], shifts: Shift[], violations: Violation[],
  sos: SOSEvent[], attendance: AttendanceRecord[], buildings: Building[]
): Insight[] {
  const insights: Insight[] = [];

  // Critical reports spike
  const criticals = reports.filter(r => r.status === "critical");
  if (criticals.length >= 3) {
    insights.push({
      type: "critical",
      title: "High critical report frequency",
      titleAr: "تكرار عالٍ في التقارير الحرجة",
      body: `${criticals.length} critical reports detected. Immediate review recommended.`,
      bodyAr: `تم رصد ${criticals.length} تقريراً حرجاً. يُنصح بالمراجعة الفورية.`,
    });
  }

  // Building with most issues
  const buildingCount: Record<string, number> = {};
  reports.filter(r => r.status !== "normal").forEach(r => {
    buildingCount[r.buildingId] = (buildingCount[r.buildingId] || 0) + 1;
  });
  const topBuilding = Object.entries(buildingCount).sort((a, b) => b[1] - a[1])[0];
  if (topBuilding && topBuilding[1] >= 2) {
    const b = buildings.find(x => x.id === topBuilding[0]);
    insights.push({
      type: "warning",
      title: `Hotspot: ${b?.nameEn ?? topBuilding[0]}`,
      titleAr: `نقطة ساخنة: ${b?.nameAr ?? topBuilding[0]}`,
      body: `${topBuilding[1]} incidents reported at this location.`,
      bodyAr: `تم تسجيل ${topBuilding[1]} حوادث في هذا الموقع.`,
    });
  }

  // Missed shifts
  const missed = shifts.filter(s => s.status === "missed");
  if (missed.length > 0) {
    insights.push({
      type: "warning",
      title: `${missed.length} missed shift(s)`,
      titleAr: `${missed.length} نوبة فائتة`,
      body: "Some guards missed their scheduled shifts.",
      bodyAr: "بعض الحراس لم يحضروا نوباتهم المجدولة.",
    });
  }

  // SOS events
  if (sos.filter(s => !s.resolved).length > 0) {
    insights.push({
      type: "critical",
      title: "Unresolved SOS events",
      titleAr: "أحداث SOS غير محلولة",
      body: `${sos.filter(s => !s.resolved).length} SOS alert(s) still pending resolution.`,
      bodyAr: `${sos.filter(s => !s.resolved).length} تنبيه SOS لا يزال بانتظار الحل.`,
    });
  }

  // Guard with most violations
  const vMap: Record<string, number> = {};
  violations.forEach(v => { vMap[v.guardId] = (vMap[v.guardId] || 0) + 1; });
  const topGuard = Object.entries(vMap).sort((a, b) => b[1] - a[1])[0];
  if (topGuard && topGuard[1] >= 2) {
    const gName = violations.find(v => v.guardId === topGuard[0])?.guardName ?? topGuard[0];
    insights.push({
      type: "warning",
      title: `Guard needs attention: ${gName}`,
      titleAr: `حارس يحتاج متابعة: ${gName}`,
      body: `${topGuard[1]} violations recorded for this guard.`,
      bodyAr: `${topGuard[1]} مخالفات مسجلة لهذا الحارس.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      type: "info",
      title: "All systems normal",
      titleAr: "جميع الأنظمة طبيعية",
      body: "No anomalies detected in the current data.",
      bodyAr: "لا توجد حالات شاذة في البيانات الحالية.",
    });
  }

  return insights;
}
