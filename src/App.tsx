import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import AuthScreen from "./components/AuthScreen";
import QrScannerModal from "./components/QrScannerModal";
import VisitorManagementModal from "./components/VisitorManagementModal";
import { playNormalAlertSound, registerNotificationServiceWorker, sendToServiceWorker, showSystemNotification, startEmergencySound, stopEmergencySound, vibrateDevice, vibrateEmergency } from "./services/notificationService";
import { deleteAlertRemote, deleteApprovedUserRemote, deletePendingUserRemote, ensureRemoteSeed, saveApprovedUser, savePendingUser, subscribeApprovedUsers, subscribeConversations, subscribePendingUsers, saveConversation, subscribeReports, saveReport, deleteReportRemote, subscribeAlerts, saveAlert, subscribeVisitors, saveVisitor, updateVisitorRemote, subscribeAttendance, saveAttendance, subscribeTasks, saveTask, updateTaskRemote, deleteTaskRemote, subscribeShifts, saveShift, updateShiftRemote, subscribeViolations, saveViolation, updateViolationRemote, subscribeSOSEvents, saveSOSEvent, updateSOSEventRemote } from "./services/firebaseData";
import { exportReportsPDF, exportShiftReportPDF, exportFullDashboardPDF } from "./services/pdfService";
import { generateVisitorQR, generateBuildingQR } from "./services/qrService";
import { analyzeData } from "./services/analyticsService";
import { exportFullExcel, exportAttendanceExcel, exportReportsExcel } from "./services/excelService";
import type { PatrolRound, PatrolRoute, PatrolCheckpoint } from "./types/security";
import { initFCM, listenForegroundMessages, sendPushViaWorker } from "./services/fcmService";
import { validateEmail } from "./services/emailVerification";
import type { AlertLog, AppSnapshot, AttendanceRecord, AuditEntry, AuditSeverity, Building, ChatMessage, Conversation, Language, NewAccountPayload, Pair, Report, ReportComment, ReportStatus, Role, Shift, SOSEvent, Tab, Task, Toast, ToastTone, User, Violation, VisitorFormPayload, VisitorRecord } from "./types/security";

const STORAGE_KEY = "mustafaqa-v1";
const SESSION_KEY = "mustafaqa-session-v1";
const OWNER_ID = "owner-mustafa-2024"; // owner is immutable
const LANGUAGE_KEY = "mustafaqa-lang-v1";
const SYNC_KEY = "mustafaqa-sync-v1";
const ACTIVE_KEY = "mustafaqa-active-v1";
const REPORTS_PER_PAGE = 6;
const VISITOR_REMINDER_MINUTES = 30;
const VISITOR_ARRIVAL_REMIND_MINUTES = 15;
const APP_NAME = "QGuard";

const roleLabels: Record<Role, Pair> = {
  owner: { ar: "المالك / المشرف العام", en: "Owner / Super Admin" },
  admin: { ar: "إداري", en: "Admin" },
  guard: { ar: "حارس أمن", en: "Security Guard" },
};

const tabLabels: Partial<Record<Tab, Pair>> = {
  dashboard: { ar: "لوحة التحكم", en: "Dashboard" },
  reports: { ar: "التقارير", en: "Reports" },
  alerts: { ar: "التنبيهات", en: "Alerts" },
  buildings: { ar: "المباني", en: "Buildings" },
  users: { ar: "المستخدمون", en: "Users" },
  visitors: { ar: "الزوار", en: "Visitors" },
  attendance: { ar: "الحضور", en: "Attendance" },
  tasks: { ar: "المهام", en: "Tasks" },
  chat: { ar: "الدردشة", en: "Chat" },
  analytics: { ar: "التحليلات", en: "Analytics" },
  audit: { ar: "سجل التدقيق", en: "Audit" },
  system: { ar: "إعدادات النظام", en: "System" },
  settings: { ar: "الإعدادات", en: "Settings" },
  violations: { ar: "المخالفات", en: "Violations" },
  map: { ar: "الخريطة", en: "Map" },
  sos: { ar: "طوارئ 🚨", en: "SOS 🚨" },
  scores: { ar: "التقييمات", en: "Scores" },
  patrol: { ar: "الجولات", en: "Patrol" },
};

const reportStatusLabels: Record<ReportStatus, Pair> = {
  normal: { ar: "طبيعي", en: "Normal" },
  warning: { ar: "تحذير", en: "Warning" },
  critical: { ar: "حرج", en: "Critical" },
};

const permissionLabels: Record<string, Pair> = {
  reports: { ar: "إرسال التقارير", en: "Send Reports" },
  alerts: { ar: "إرسال التنبيهات", en: "Send Alerts" },
  attendance: { ar: "الحضور والانصراف", en: "Clock In/Out" },
  chat: { ar: "المحادثة المباشرة", en: "Direct Chat" },
  buildings: { ar: "الوصول للمباني", en: "Access Buildings" },
  viewReports: { ar: "عرض التقارير", en: "View Reports" },
  visitors: { ar: "إدارة الزوار", en: "Manage Visitors" },
  violations: { ar: "المخالفات", en: "Violations" },
  sos: { ar: "SOS", en: "SOS" },
};

function pair(language: Language, value: Pair): string { return value[language]; }
function normalizeCode(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, "-"); }
function hashPassword(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i);
  return `h${(hash >>> 0).toString(16)}`;
}
function formatTime(dateStr: string, use24h: boolean): string {
  try {
    const d = new Date(dateStr.replace(" ", "T"));
    if (isNaN(d.getTime())) return dateStr;
    // Always use en-US for numbers (no Arabic-Indic numerals)
    const day   = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year  = d.getFullYear();
    const date  = `${year}/${month}/${day}`;
    const time  = d.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: !use24h,
    });
    return `${date} · ${time}`;
  } catch { return dateStr; }
}

function formatTimeOnly(dateStr: string, use24h: boolean): string {
  try {
    const d = new Date(dateStr.replace(" ", "T"));
    if (isNaN(d.getTime())) return dateStr.split(" ")[1] ?? dateStr;
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", hour12: !use24h,
    });
  } catch { return dateStr.split(" ")[1] ?? dateStr; }
}

function sanitize(input: string): string {
  return input.replace(/<script[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/[<>]/g, "").trim().slice(0, 1000);
}

function nowStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")} ${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}`;
}
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")}`;
}
function chatTime(language: Language): string {
  return new Date().toLocaleTimeString(language === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" });
}
function generatePassCode(): string { return `VIS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; }
function securityNumber(userId: string): string { return `SEC-${userId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase().padStart(4, "0")}`; }
function getRoleBadgeClass(role: Role): string {
  if (role === "owner") return "border-amber-400/30 bg-amber-500/15 text-amber-300";
  if (role === "admin") return "border-sky-400/30 bg-sky-500/15 text-sky-300";
  return "border-emerald-400/30 bg-emerald-500/15 text-emerald-300";
}
function getStatusBadgeClass(status: ReportStatus): string {
  if (status === "critical") return "border-red-400/30 bg-red-500/15 text-red-300";
  if (status === "warning") return "border-amber-400/30 bg-amber-500/15 text-amber-300";
  return "border-emerald-400/30 bg-emerald-500/15 text-emerald-300";
}
function getToastClass(tone: ToastTone): string {
  if (tone === "danger") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (tone === "info") return "border-sky-500/30 bg-sky-500/10 text-sky-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}
function formatBuilding(building: Building | undefined, language: Language): string {
  if (!building) return "—";
  return language === "ar" ? building.nameAr : building.nameEn;
}
function createAuditEntry(actor: User | null, action: string, target: string, details: string, severity: AuditSeverity = "info"): AuditEntry {
  return { id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, actorId: actor?.id ?? "system", actorName: actor?.name ?? "System", action, target, details, severity, time: nowStamp() };
}
async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}
function loadJson<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}

function buildSeedBuildings(): Building[] {
  return ([
    ["gate-1",      "البوابة 1",         "GATE 1",      "Gate Zone",    "QA-GATE-1"],
    ["gate-2",      "البوابة 2",         "GATE 2",      "Gate Zone",    "QA-GATE-2"],
    ["reception",   "الاستقبال",          "RECEPTION",   "Front Desk",   "QA-REC"],
    ["building-2",  "المبنى 2",           "BUILDING 2",  "Building Zone","QA-B2"],
    ["building-3",  "المبنى 3",           "BUILDING 3",  "Building Zone","QA-B3"],
    ["building-4",  "المبنى 4",           "BUILDING 4",  "Building Zone","QA-B4"],
    ["building-5",  "المبنى 5",           "BUILDING 5",  "Building Zone","QA-B5"],
    ["building-6",  "المبنى 6",           "BUILDING 6",  "Building Zone","QA-B6"],
    ["building-7",  "المبنى 7",           "BUILDING 7",  "Building Zone","QA-B7"],
    ["building-8",  "المبنى 8",           "BUILDING 8",  "Building Zone","QA-B8"],
    ["building-9",  "المبنى 9",           "BUILDING 9",  "Building Zone","QA-B9"],
    ["building-10", "المبنى 10",          "BUILDING 10", "Building Zone","QA-B10"],
    ["building-11", "المبنى 11",          "BUILDING 11", "Building Zone","QA-B11"],
    ["building-12", "المبنى 12",          "BUILDING 12", "Building Zone","QA-B12"],
    ["store-1",     "المخزن 1",           "STORE 1",     "Storage Zone", "QA-ST1"],
    ["store-2",     "المخزن 2",           "STORE 2",     "Storage Zone", "QA-ST2"],
    ["pump-room",   "غرفة المضخة",        "PUMP ROOM",   "Utility Zone", "QA-PUMP"],
    ["back-s1",     "المخزن الخلفي 1",    "BACK S1",     "Back Storage", "QA-BS1"],
    ["back-s2",     "المخزن الخلفي 2",    "BACK S2",     "Back Storage", "QA-BS2"],
    ["back-s3",     "المخزن الخلفي 3",    "BACK S3",     "Back Storage", "QA-BS3"],
    ["back-s4",     "المخزن الخلفي 4",    "BACK S4",     "Back Storage", "QA-BS4"],
    ["cctv-room",   "غرفة الكاميرات",     "CCTV ROOM",   "Control Room", "QA-CCTV"],
  ] as [string,string,string,string,string][]).map(([id,nameAr,nameEn,area,qrCode]) => ({ id, nameAr, nameEn, area, qrCode }));
}

function buildSeedState(): AppSnapshot {
  const buildings = buildSeedBuildings();
  const allPerms = Object.keys(permissionLabels);
  const users: User[] = [
    { id: "owner-1", name: "Mustafa Khojali", email: "mustafakhojali884@gmail.com", phone: "0555555555", role: "owner", status: "approved", permissions: allPerms, rating: 5, passwordHash: hashPassword("mus2003kh"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: true, createdAt: "2026-05-01 08:00", violations: 0 },
    { id: "admin-1", name: "Abeer Al-Harbi", email: "abeer.admin@qguard", phone: "", role: "admin", status: "approved", permissions: ["reports", "alerts", "attendance", "buildings", "viewReports", "chat", "visitors", "shifts"], rating: 4.8, passwordHash: hashPassword("admin123"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: true, createdAt: "2026-05-01 08:10", violations: 0 },
    { id: "guard-1", name: "Fatuma Osman", email: "fatuma@qguard", phone: "0507788991", role: "guard", status: "approved", assignedBuildingId: "gate-1", permissions: ["reports", "attendance", "chat", "buildings", "visitors", "sos"], rating: 4.9, passwordHash: hashPassword("guard123"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: false, createdAt: "2026-05-01 08:18", violations: 0 },
    { id: "guard-2", name: "Ayman Saeed", email: "ayman@qguard", phone: "0503344551", role: "guard", status: "approved", assignedBuildingId: "gate-2", permissions: ["reports", "attendance", "chat", "buildings", "visitors", "sos"], rating: 4.6, passwordHash: hashPassword("guard456"), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: "2026-05-01 08:20", violations: 1 },
  ];

  const todayStr = today();
  const shifts: Shift[] = [
    { id: "s1", guardId: "guard-1", guardName: "Fatuma Osman", buildingId: "gate-1", date: todayStr, startTime: "07:00", endTime: "19:00", status: "active", checkInTime: "07:02", createdAt: nowStamp() },
    { id: "s2", guardId: "guard-2", guardName: "Ayman Saeed", buildingId: "gate-2", date: todayStr, startTime: "07:00", endTime: "19:00", status: "active", checkInTime: "07:10", createdAt: nowStamp() },
  ];
  const violations: Violation[] = [
    { id: "v1", guardId: "guard-2", guardName: "Ayman Saeed", type: "Late Arrival", description: "Guard arrived 30 minutes late without notice.", severity: "minor", buildingId: "gate-2", date: "2026-05-06", acknowledged: false, createdBy: "Mustafa Khojali", createdAt: "2026-05-06 08:35" },
  ];
  const sosEvents: SOSEvent[] = [];

  return {
    buildings, users,
    reports: [
      { id: "r1", buildingId: "gate-1", text: "حركة الدخول طبيعية وتم التحقق من الهويات.", senderId: "guard-2", senderName: "Ayman Saeed", senderEmail: "ayman@qguard", senderPhone: "0503344551", time: "2026-05-06 08:43", status: "normal" },
      { id: "r2", buildingId: "gate-1", text: "ازدحام بسيط عند البوابة تم تنظيمه.", senderId: "guard-1", senderName: "Fatuma Osman", senderEmail: "fatuma@qguard", senderPhone: "0507788991", time: "2026-05-06 08:45", status: "warning" },
    ],
    alerts: [{ id: "a1", status: "Visitor / زائر", target: "Guards only / الحراس فقط", text: "تمت إضافة زائر مجدول لهذا اليوم.", sender: "Mustafa Khojali", time: "2026-05-05 08:15", severity: "info" }],
    attendance: [
      { id: "at1", userId: "guard-1", userName: "Fatuma Osman", buildingId: "gate-1", method: "manual", time: `${todayStr} 07:02` },
      { id: "at2", userId: "guard-2", userName: "Ayman Saeed", buildingId: "gate-2", method: "manual", time: `${todayStr} 07:10` },
    ],
    tasks: [
      { id: "t1", title: "فحص الكاميرات الخارجية", details: "تأكد من عمل جميع كاميرات البوابة 1.", assignedTo: "guard-1", assignedName: "Fatuma Osman", status: "pending", createdAt: nowStamp(), priority: "high" },
    ],
    visitors: [
      { id: "vis1", guestName: "خالد السبيعي", company: "شركة الصيانة", purpose: "جولة صيانة", identityNumber: "1010101010", buildingId: "gate-1", arrivalDate: todayStr, arrivalTime: "09:30", createdBy: "Mustafa Khojali", createdAt: nowStamp(), passCode: generatePassCode(), status: "scheduled", reminderSent: false, preNotified: true },
    ],
    conversations: [
      { id: "c1", participantId: "guard-1", participantName: "Fatuma Osman", participantRole: "guard", messages: [{ id: "m1", senderId: "owner-1", kind: "text", text: "أهلاً فاطمة، يمكنك رفع أي ملاحظة عاجلة هنا.", time: "08:10" }] },
      { id: "c2", participantId: "guard-2", participantName: "Ayman Saeed", participantRole: "guard", messages: [{ id: "m3", senderId: "guard-2", kind: "text", text: "تم فحص البوابة 2 ولا توجد ملاحظات.", time: "08:22" }] },
    ],
    auditLog: [createAuditEntry(null, "system_seed", "platform", "تم تهيئة بيانات QGuard", "info")],
    systemSettings: {
      emergencyContact: "999", welcomeAr: "يرجى الالتزام بجميع تعليمات النوبة.", welcomeEn: "Please comply with shift instructions.", criticalEmail: "security@qguard", criticalSms: "+97455555555", visitorReminderMinutes: VISITOR_REMINDER_MINUTES, orgName: APP_NAME, shiftStartHour: 7, shiftEndHour: 19,
    },
    shifts, violations, sosEvents,
  };
}

function loadSnapshot(): AppSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedState();
    const parsed = JSON.parse(raw) as AppSnapshot;
    const seed = buildSeedState();
    return { ...seed, ...parsed, buildings: seed.buildings, shifts: parsed.shifts ?? seed.shifts, violations: parsed.violations ?? seed.violations, sosEvents: parsed.sosEvents ?? seed.sosEvents };
  } catch { return buildSeedState(); }
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.35)] ${className}`}>{children}</div>;
}
function Lbl({ children }: { children: ReactNode }) { return <label className="mb-2 block text-sm font-semibold text-slate-400">{children}</label>; }
function TxtInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none placeholder:text-slate-500 focus:border-amber-400/60 ${props.className ?? ""}`} />;
}
function SelInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none focus:border-amber-400/60 ${props.className ?? ""}`} />;
}
function TxtArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-amber-400/60 ${props.className ?? ""}`} />;
}
function Btn({ children, className = "", variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "sos" }) {
  const cls = variant === "secondary" ? "border border-white/10 bg-white/5 text-white hover:bg-white/10" : variant === "danger" ? "bg-red-600 text-white hover:bg-red-500" : variant === "sos" ? "bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-500 hover:to-red-400 animate-pulse" : "bg-gradient-to-r from-amber-500 to-orange-400 text-black hover:from-amber-400 hover:to-orange-300";
  return <button {...props} className={`inline-flex h-11 items-center justify-center rounded-2xl px-5 text-sm font-bold transition ${cls} ${className}`}>{children}</button>;
}
function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${className}`}>{children}</span>;
}
function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="mb-4"><h2 className="text-xl font-black text-white">{title}</h2>{subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}</div>;
}
function StatCard({ label, value, color = "text-white" }: { label: string; value: string | number; color?: string }) {
  return <Panel className="min-h-[120px]"><div className="mb-6 text-sm font-semibold text-slate-400">{label}</div><div className={`text-4xl font-black ${color}`}>{value}</div></Panel>;
}
function EmptyMsg({ title, text }: { title: string; text: string }) {
  return <div className="flex min-h-[180px] flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/5 px-6 text-center"><h3 className="text-lg font-bold text-white">{title}</h3><p className="mt-2 max-w-md text-sm text-slate-400">{text}</p></div>;
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-bold text-white">{value || "—"}</div></div>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>(() => loadSnapshot());
  const [language, setLanguage] = useState<Language>(() => {
    const saved = loadJson<Language>(LANGUAGE_KEY, "ar");
    // Apply dir immediately on load
    document.documentElement.dir = saved === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = saved;
    return saved;
  });
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => window.localStorage.getItem(SESSION_KEY) || null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [toast, setToast] = useState<Toast | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncQueue, setSyncQueue] = useState<string[]>(() => loadJson<string[]>(SYNC_KEY, []));
  const [activeUserIds, setActiveUserIds] = useState<string[]>(() => loadJson<string[]>(ACTIVE_KEY, []));
  const [remoteApprovedUsers, setRemoteApprovedUsers] = useState<User[]>([]);
  const [remotePendingUsers, setRemotePendingUsers] = useState<User[]>([]);
  const [remoteConversations, setRemoteConversations] = useState<Conversation[]>([]);
  const [remoteReports, setRemoteReports] = useState<Report[]>([]);
  const [remoteAlerts, setRemoteAlerts] = useState<AlertLog[]>([]);
  const [remoteVisitors, setRemoteVisitors] = useState<VisitorRecord[]>([]);
  const [remoteAttendance, setRemoteAttendance] = useState<AttendanceRecord[]>([]);
  const [remoteTasks, setRemoteTasks] = useState<Task[]>([]);
  const [remoteShifts, setRemoteShifts] = useState<Shift[]>([]);
  const [remoteViolations, setRemoteViolations] = useState<Violation[]>([]);
  const [remoteSOSEvents, setRemoteSOSEvents] = useState<SOSEvent[]>([]);
  const [notificationPermission, setNotificationPermission] = useState("default");
  const [visitorModalOpen, setVisitorModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrContext, setQrContext] = useState<"attendance" | "report" | "patrol" | null>(null);
  const [visitorSearch, setVisitorSearch] = useState("");
  const [visitorStatusFilter, setVisitorStatusFilter] = useState<VisitorRecord["status"] | "all">("all");
  const [userFilter, setUserFilter] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const [conversationId, setConversationId] = useState("c1");
  const [isRecording, setIsRecording] = useState(false);
  const [emergencyActive, setEmergencyActive] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMediaUploading, setChatMediaUploading] = useState(false);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [buildingSearch, setBuildingSearch] = useState("");
  const [activePatrol, setActivePatrol] = useState<PatrolRound | null>(null);
  const [patrolRoutes, setPatrolRoutes] = useState<PatrolRoute[]>([]);
  const [remotePatrolRoutes, setRemotePatrolRoutes] = useState<PatrolRoute[]>([]);
  const [showCreateRoute, setShowCreateRoute] = useState(false);
  const [newRouteName, setNewRouteName] = useState({ ar: "", en: "" });
  const [selectedRouteBuildings, setSelectedRouteBuildings] = useState<string[]>([]);
  const [editRouteId, setEditRouteId] = useState<string | null>(null);
  const [newRouteGuardId, setNewRouteGuardId] = useState("");
  const [newRouteTime, setNewRouteTime] = useState("");
  const [newRouteNotes, setNewRouteNotes] = useState("");
  const [qrModalBuilding, setQrModalBuilding] = useState<string | null>(null);
  const [stoppedAlertIds, setStoppedAlertIds] = useState<Set<string>>(new Set());
  const [hiddenAlertIds, setHiddenAlertIds] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem("mustafaqa-hidden-alerts") ?? "[]") as string[])
  );
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [deletedUserIds, setDeletedUserIds] = useState<Set<string>>(new Set());
  const [pendingUserId, setPendingUserId] = useState<string | null>(() => window.localStorage.getItem("mustafaqa-pending-id") || null);
  const [loginAttempts, setLoginAttempts] = useState<number>(0);

  // Unlock AudioContext + request permissions on first interaction
  useEffect(() => {
    const unlock = async () => {
      // Unlock audio
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) { const ctx = new AudioCtx(); ctx.resume().then(() => ctx.close()); }
      } catch { /* ignore */ }
    };
    document.addEventListener("touchstart", unlock, { once: true });
    document.addEventListener("click", unlock, { once: true });
    return () => {
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("click", unlock);
    };
  }, []);

  // Request permissions after login (not on load - conflicts with QR scanner)
  // Handled by requestAllPermissions() called after sign-in
  const [loginLockedUntil, setLoginLockedUntil] = useState<number>(0);
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [editReportId, setEditReportId] = useState<string | null>(null);
  const [editReportForm, setEditReportForm] = useState({ text: "", status: "normal" as ReportStatus });
  const [commentingReportId, setCommentingReportId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [reportAddingPhotoId, setReportAddingPhotoId] = useState<string | null>(null);
  const reportEditPhotoRef = useRef<HTMLInputElement | null>(null);
  const [buildingQrImages, setBuildingQrImages] = useState<Record<string, string>>({});
  const [showAddBuilding, setShowAddBuilding] = useState(false);
  const [addBuildingForm, setAddBuildingForm] = useState({ nameAr: "", nameEn: "", area: "" });
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [directAddForm, setDirectAddForm] = useState({ name: "", email: "", phone: "", password: "", role: "guard" as Role, buildingId: "" });
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editUserForm, setEditUserForm] = useState({ name: "", phone: "", buildingId: "", role: "guard" as Role });
  const [changePwForm, setChangePwForm] = useState({ current: "", newPw: "", confirm: "" });
  const [use24h, setUse24h] = useState<boolean>(() => {
    try { return window.localStorage.getItem("mustafaqa-24h") === "true"; } catch { return false; }
  });
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [changePwError, setChangePwError] = useState("");
  const deviceId = typeof window !== "undefined" ? (window.localStorage.getItem("mustafaqa-device-id") || (() => { const id = "DEV-" + Math.random().toString(36).slice(2,8).toUpperCase(); window.localStorage.setItem("mustafaqa-device-id", id); return id; })()) : "—";
  const chatFileRef = useRef<HTMLInputElement | null>(null);
  const [visitorQrMap, setVisitorQrMap] = useState<Record<string, string>>({});
  const [shiftFilter, setShiftFilter] = useState<"all" | "today">("today");
  const [violationForm, setViolationForm] = useState({ guardId: "", type: "", description: "", severity: "minor" as Violation["severity"], buildingId: "" });
  const [shiftForm, setShiftForm] = useState({
    shiftType: "morning" as "morning" | "evening",
    guardId: "",
    buildingId: "",
    eveningRole: "gate" as "gate" | "patrol",
    date: today(),
    notes: "",
  });
  const [showShiftScheduler, setShowShiftScheduler] = useState(false);
  const [scoresPeriod, setScoresPeriod] = useState<"today"|"week"|"month"|"all">("all");
  const [attendanceFilter, setAttendanceFilter] = useState<"today"|"week"|"month"|"all">("today");
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [attendanceView, setAttendanceView] = useState<"list"|"grid">("list");
  const [endShiftNote, setEndShiftNote] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  const [reportForm, setReportForm] = useState({ buildingId: buildSeedBuildings()[0].id, text: "", status: "normal" as ReportStatus, mediaUrl: "", mediaKind: "" as "" | "image" | "video", fileName: "" });
  const [alertForm, setAlertForm] = useState({ status: "fire", target: "all", text: "", customStatus: "", specificUserId: "" });
  const [taskForm, setTaskForm] = useState({ title: "", details: "", assignedTo: "all", priority: "medium" as Task["priority"], dueDate: "" });
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", phone: "", password: "", role: "guard" as Role, buildingId: buildSeedBuildings()[0].id });

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const reportPhotoRef = useRef<HTMLInputElement | null>(null);
  const [reportScannedBuilding, setReportScannedBuilding] = useState<string>("");
  const reportMediaInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const toastTimer = useRef<number | null>(null);
  const prevAlertCount = useRef(0);
  const initialAlerts = useRef(true);

  // ─── Derived state ───────────────────────────────────────────────────────────
  const approvedUsers = useMemo(() => {
    const map = new Map<string, User>();
    snapshot.users.filter(u => u.status === "approved").forEach(u => map.set(u.id, u));
    remoteApprovedUsers.forEach(u => map.set(u.id, u));
    // Filter out users that were deleted this session
    return Array.from(map.values()).filter(u => !deletedUserIds.has(u.id));
  }, [remoteApprovedUsers, snapshot.users]);

  const pendingUsers = useMemo(() => {
    const map = new Map<string, User>();
    snapshot.users.filter(u => u.status === "pending").forEach(u => map.set(u.id, u));
    remotePendingUsers.forEach(u => map.set(u.id, u));
    return Array.from(map.values());
  }, [remotePendingUsers, snapshot.users]);

  const currentUser = useMemo(() => approvedUsers.find(u => u.id === currentUserId) ?? null, [approvedUsers, currentUserId]);
  const role = currentUser?.role ?? null;
  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const isGuard = role === "guard";
  const guardUsers = useMemo(() => approvedUsers.filter(u => u.role === "guard"), [approvedUsers]);

  const visibleTabs = useMemo((): Tab[] => {
    if (isGuard) return ["reports", "alerts", "buildings", "visitors", "attendance", "tasks", "chat", "patrol", "settings"];  // no violations, no scores
    if (isAdmin) return [
      "dashboard", "reports", "alerts", "buildings", "users", "visitors", "tasks", "chat",
      ...(currentUser?.permissions?.includes("violations") ? ["violations" as Tab] : []),
      ...(currentUser?.permissions?.includes("scores") ? ["scores" as Tab] : []),
      "patrol", "settings"
    ];
    return ["dashboard", "reports", "alerts", "buildings", "users", "visitors", "attendance", "tasks", "chat", "analytics", "audit", "violations", "scores", "patrol", "system", "settings"];
  }, [isAdmin, isGuard, currentUser]);

  // ─── Merge remote + local for ALL collections ─────────────────────────────
  const mergedReports = useMemo(() => {
    const map = new Map<string, Report>();
    snapshot.reports.forEach(r => map.set(r.id, r));
    remoteReports.forEach(r => map.set(r.id, r));
    return Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time));
  }, [snapshot.reports, remoteReports]);

  const mergedAlerts = useMemo(() => {
    const map = new Map<string, AlertLog>();
    snapshot.alerts.forEach(a => map.set(a.id, a));
    remoteAlerts.forEach(a => map.set(a.id, a));
    return Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time));
  }, [snapshot.alerts, remoteAlerts]);

  const mergedVisitors = useMemo(() => {
    const map = new Map<string, VisitorRecord>();
    snapshot.visitors.forEach(v => map.set(v.id, v));
    remoteVisitors.forEach(v => map.set(v.id, v));
    return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [snapshot.visitors, remoteVisitors]);

  const mergedAttendance = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    snapshot.attendance.forEach(a => map.set(a.id, a));
    remoteAttendance.forEach(a => map.set(a.id, a));
    return Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time));
  }, [snapshot.attendance, remoteAttendance]);

  const mergedTasks = useMemo(() => {
    const map = new Map<string, Task>();
    snapshot.tasks.forEach(t => map.set(t.id, t));
    remoteTasks.forEach(t => map.set(t.id, t));
    return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [snapshot.tasks, remoteTasks]);

  const mergedShifts = useMemo(() => {
    const map = new Map<string, Shift>();
    snapshot.shifts.forEach(s => map.set(s.id, s));
    remoteShifts.forEach(s => map.set(s.id, s));
    return Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [snapshot.shifts, remoteShifts]);

  const mergedViolations = useMemo(() => {
    const map = new Map<string, Violation>();
    snapshot.violations.forEach(v => map.set(v.id, v));
    remoteViolations.forEach(v => map.set(v.id, v));
    return Array.from(map.values()).sort((a, b) => (b.createdAt ?? b.issuedAt ?? "").localeCompare(a.createdAt ?? a.issuedAt ?? ""));
  }, [snapshot.violations, remoteViolations]);

  const mergedSOSEvents = useMemo(() => {
    const map = new Map<string, SOSEvent>();
    snapshot.sosEvents.forEach(s => map.set(s.id, s));
    remoteSOSEvents.forEach(s => map.set(s.id, s));
    return Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time));
  }, [snapshot.sosEvents, remoteSOSEvents]);

  const visibleReports = useMemo(() => isGuard && currentUser ? mergedReports.filter(r => r.senderId === currentUser.id) : mergedReports.slice().sort((a,b) => b.time.localeCompare(a.time)), [currentUser, isGuard, mergedReports]);
  const pagedReports = useMemo(() => visibleReports.slice((reportPage - 1) * REPORTS_PER_PAGE, reportPage * REPORTS_PER_PAGE), [reportPage, visibleReports]);
  const filteredUsers = useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    if (!q) return approvedUsers;
    return approvedUsers.filter(u =>
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      securityNumber(u.id).toLowerCase().includes(q)
    );
  }, [approvedUsers, userFilter]);
  const filteredVisitors = useMemo(() => {
    const q = visitorSearch.trim().toLowerCase();
    return mergedVisitors.filter(v => visitorStatusFilter === "all" || v.status === visitorStatusFilter).filter(v => !q || `${v.guestName} ${v.company} ${v.identityNumber ?? ""}`.toLowerCase().includes(q));
  }, [snapshot.visitors, visitorSearch, visitorStatusFilter]);

  const conversationsSource = useMemo(() => {
    const map = new Map<string, Conversation>();
    snapshot.conversations.forEach(c => map.set(c.id, c));
    remoteConversations.forEach(c => map.set(c.id, c));
    return Array.from(map.values());
  }, [remoteConversations, snapshot.conversations]);

  const visibleConversations = useMemo(() => {
    if (!currentUser) return [];
    // Owner: sees all users
    if (currentUser.role === "owner") {
      const activeUsers = approvedUsers
        .filter(u => u.id !== currentUser.id && !deletedUserIds.has(u.id) && !blockedUserIds.has(u.id));
      
      // Map each user to their conversation (or create empty one)
      // deduplicate by participantId
      const seen = new Set<string>();
      return activeUsers
        .filter(u => { if (seen.has(u.id)) return false; seen.add(u.id); return true; })
        .map(u => {
          // Find existing conversation from Firebase for this user
          const existing = conversationsSource.find(c => c.participantId === u.id);
          if (existing) return { ...existing, participantName: u.name, participantRole: u.role as Role };
          return { id: `c-${u.id}`, participantId: u.id, participantName: u.name, participantRole: u.role as Role, messages: [] };
        })
        .sort((a, b) => {
          // Sort by last message time (most recent first)
          const aTime = a.messages?.[a.messages.length - 1]?.time ?? "";
          const bTime = b.messages?.[b.messages.length - 1]?.time ?? "";
          return bTime.localeCompare(aTime);
        });
    }
    // Admin: sees only owner (not guards)
    if (currentUser.role === "admin") {
      const owner = approvedUsers.find(u => u.role === "owner");
      if (!owner) return [];
      const existing = conversationsSource.find(c => c.participantId === owner.id);
      const conv = existing ?? { id: `c-${owner.id}`, participantId: owner.id, participantName: owner.name, participantRole: "owner" as Role, messages: [] };
      return [{ ...conv, participantName: owner.name, participantRole: "owner" as Role }];
    }
    // Guard: ONLY conversation with owner
    const owner = approvedUsers.find(u => u.role === "owner");
    if (!owner) return [];
    const existing = conversationsSource.find(c => c.participantId === currentUser.id);
    const conv = existing ?? { id: `c-${currentUser.id}`, participantId: currentUser.id, participantName: currentUser.name, participantRole: currentUser.role, messages: [] };
    return [{ ...conv, participantName: owner.name, participantRole: "owner" as Role }];
  }, [approvedUsers, conversationsSource, currentUser]);

  const activeConversation = useMemo(() => visibleConversations.find(c => c.id === conversationId) ?? visibleConversations[0], [conversationId, visibleConversations]);
  const visibleTasks = useMemo(() => isGuard && currentUser ? mergedTasks.filter(t => t.assignedTo === currentUser.id) : snapshot.tasks, [currentUser, isGuard, snapshot.tasks]);

  const todayShifts = useMemo(() => {
    const base = isGuard && currentUser
      ? mergedShifts.filter(s => s.guardId === currentUser.id)
      : mergedShifts;
    return shiftFilter === "today" ? base.filter(s => s.date === today()) : base;
  }, [mergedShifts, shiftFilter, isGuard, currentUser]);
  const myShift = useMemo(() => isGuard && currentUser ? mergedShifts.find(s => s.guardId === currentUser.id && s.date === today()) : null, [currentUser, isGuard, mergedShifts]);
  const hasActiveEmergency = useMemo(() => {
    // Only active (emergencyActive flag set) AND not stopped alerts
    const hasActiveAlert = emergencyActive && mergedAlerts.some(a =>
      !(a as AlertLog & { stopped?: boolean }).stopped &&
      !stoppedAlertIds.has(a.id)
    );
    const hasActiveSOS = mergedSOSEvents.some(s => !s.resolved);
    return hasActiveAlert || hasActiveSOS;
  }, [mergedAlerts, mergedSOSEvents, emergencyActive, stoppedAlertIds]);

  const insights = useMemo(() => analyzeData(mergedReports, mergedShifts, mergedViolations, mergedSOSEvents, mergedAttendance, snapshot.buildings), [mergedReports, mergedShifts, mergedViolations, mergedSOSEvents, mergedAttendance, snapshot.buildings]);

  // ─── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.title = `${APP_NAME} | ${language === "ar" ? "نظام الأمن المتكامل" : "Integrated Security System"}`;
  }, [language]);

  // Handle deep link from notification click (when app was closed)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as Tab | null;
    const validTabs: Tab[] = ["reports","alerts","chat","tasks","sos","visitors","users","buildings","dashboard","attendance","analytics","audit","system","settings","violations","scores","patrol","map"];
    if (tab && validTabs.includes(tab)) {
      setActiveTab(tab);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // Show permission modal if user is logged in but hasn't granted permission yet
  // Runs on every app open, not just login
  useEffect(() => {
    if (!currentUser) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      // Permission already granted — just ensure FCM token is saved
      void initFCM(currentUser.id);
      return;
    }
    if (Notification.permission === "denied") return; // User explicitly denied, don't ask again
    // Permission is "default" → show modal
    const timer = setTimeout(() => {
      setShowPermissionModal(true);
    }, 1500); // small delay so app loads first
    return () => clearTimeout(timer);
  }, [currentUser]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    window.localStorage.setItem(LANGUAGE_KEY, language);
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(syncQueue));
    window.localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeUserIds));
    if (currentUserId) window.localStorage.setItem(SESSION_KEY, currentUserId);
    else window.localStorage.removeItem(SESSION_KEY);
  }, [activeUserIds, currentUserId, language, snapshot, syncQueue]);

  useEffect(() => {
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    void registerNotificationServiceWorker();

    // Listen for messages from service worker
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === "STOP_SIREN_FROM_NOTIFICATION") {
        stopEmergencySound();
        setEmergencyActive(false);
      }
      if (event.data?.type === "NOTIFICATION_CLICKED") {
        const t = event.data?.notifType;
        if (t === "chat") setActiveTab("chat");
        else if (t === "task") setActiveTab("tasks");
        else if (t === "sos" || t === "emergency") setActiveTab("sos");
        else if (t === "report") setActiveTab("reports");
        else if (t === "alert") setActiveTab("alerts");
        else if (t === "pending_user") setActiveTab("users");
        else if (t === "visitor") setActiveTab("visitors");
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSWMessage);
    void ensureRemoteSeed(snapshot.users.filter(u => u.status === "approved"), snapshot.conversations);

    const unsubApproved = subscribeApprovedUsers(setRemoteApprovedUsers);
    const unsubPending = subscribePendingUsers(setRemotePendingUsers);
    const unsubConversations = subscribeConversations(setRemoteConversations);
    const unsubReports = subscribeReports(setRemoteReports);
    const unsubAlerts = subscribeAlerts(setRemoteAlerts);
    const unsubVisitors = subscribeVisitors(setRemoteVisitors);
    const unsubAttendance = subscribeAttendance(setRemoteAttendance);
    const unsubTasks = subscribeTasks(setRemoteTasks);
    const unsubShifts = subscribeShifts(setRemoteShifts);
    const unsubViolations = subscribeViolations(setRemoteViolations);
    const unsubSOS = subscribeSOSEvents(setRemoteSOSEvents);

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      unsubApproved(); unsubPending(); unsubConversations();
      unsubReports(); unsubAlerts(); unsubVisitors(); unsubAttendance();
      unsubTasks(); unsubShifts(); unsubViolations(); unsubSOS();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      navigator.serviceWorker?.removeEventListener("message", handleSWMessage);
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    setActiveUserIds(prev => Array.from(new Set([...prev.filter(id => id !== currentUserId), currentUserId])));

    // FCM + permission handled by the global effect below

    // Listen to foreground FCM messages
    const unsubFCM = listenForegroundMessages((title, body, type) => {
      const isCritical = type === "emergency" || type === "sos";
      showToast(`${title}: ${body}`, isCritical ? "danger" : "info");
      if (isCritical) { void startEmergencySound(); setEmergencyActive(true); vibrateEmergency(); }
      else { playNormalAlertSound(true); vibrateDevice(); }
    });

    return () => {
      setActiveUserIds(prev => prev.filter(id => id !== currentUserId));
      unsubFCM();
    };
  }, [currentUserId]);

  // ─── Sync Firebase → snapshot (so all devices see same data) ──────────────
  useEffect(() => {
    if (remoteReports.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.reports.map(r => [r.id, r]));
        remoteReports.forEach(r => map.set(r.id, r));
        return { ...prev, reports: Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time)) };
      });
  }, [remoteReports]);

  useEffect(() => {
    if (remoteAlerts.length > 0) {
      // Sync stopped state from Firebase on every update
      const remoteStoppedIds = remoteAlerts
        .filter(a => (a as AlertLog & { stopped?: boolean }).stopped === true)
        .map(a => a.id);
      if (remoteStoppedIds.length > 0) {
        setStoppedAlertIds(prev => {
          const next = new Set([...prev, ...remoteStoppedIds]);
          return next;
        });
        // Stop siren if all critical alerts are stopped in Firebase
        const allActiveStopped = remoteAlerts
          .filter(a => !(a as AlertLog & { stopped?: boolean }).stopped)
          .length === 0;
        if (allActiveStopped || remoteStoppedIds.length > 0) {
          stopEmergencySound();
          setEmergencyActive(false);
        }
      }
      setSnapshot(prev => {
        const map = new Map(prev.alerts.map(a => [a.id, a]));
        remoteAlerts.forEach(a => map.set(a.id, a));
        return { ...prev, alerts: Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time)) };
      });
    }
  }, [remoteAlerts]);

  useEffect(() => {
    if (remoteVisitors.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.visitors.map(v => [v.id, v]));
        remoteVisitors.forEach(v => map.set(v.id, v));
        return { ...prev, visitors: Array.from(map.values()) };
      });
  }, [remoteVisitors]);

  useEffect(() => {
    if (remoteAttendance.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.attendance.map(a => [a.id, a]));
        remoteAttendance.forEach(a => map.set(a.id, a));
        return { ...prev, attendance: Array.from(map.values()) };
      });
  }, [remoteAttendance]);

  useEffect(() => {
    if (remoteTasks.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.tasks.map(t => [t.id, t]));
        remoteTasks.forEach(t => map.set(t.id, t));
        return { ...prev, tasks: Array.from(map.values()) };
      });
  }, [remoteTasks]);

  useEffect(() => {
    if (remoteShifts.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.shifts.map(s => [s.id, s]));
        remoteShifts.forEach(s => map.set(s.id, s));
        return { ...prev, shifts: Array.from(map.values()) };
      });
  }, [remoteShifts]);

  useEffect(() => {
    if (remoteViolations.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.violations.map(v => [v.id, v]));
        remoteViolations.forEach(v => map.set(v.id, v));
        return { ...prev, violations: Array.from(map.values()) };
      });
  }, [remoteViolations]);

  useEffect(() => {
    if (remoteSOSEvents.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.sosEvents.map(s => [s.id, s]));
        remoteSOSEvents.forEach(s => map.set(s.id, s));
        return { ...prev, sosEvents: Array.from(map.values()) };
      });
  }, [remoteSOSEvents]);

  useEffect(() => {
    if (remoteApprovedUsers.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.users.map(u => [u.id, u]));
        remoteApprovedUsers.forEach(u => map.set(u.id, u));
        return { ...prev, users: Array.from(map.values()) };
      });
  }, [remoteApprovedUsers]);

  useEffect(() => {
    if (remotePendingUsers.length > 0)
      setSnapshot(prev => {
        const localPending = prev.users.filter(u => u.status === "pending");
        const map = new Map(localPending.map(u => [u.id, u]));
        remotePendingUsers.forEach(u => map.set(u.id, u));
        const nonPending = prev.users.filter(u => u.status !== "pending");
        return { ...prev, users: [...nonPending, ...Array.from(map.values())] };
      });
  }, [remotePendingUsers]);

  useEffect(() => {
    if (!currentUser) return;
    if (initialAlerts.current) { initialAlerts.current = false; prevAlertCount.current = mergedAlerts.length; return; }
    if (mergedAlerts.length > prevAlertCount.current) {
      const latest = mergedAlerts[0];
      const isCritical = latest.severity === "critical";
      const isWarn = latest.severity === "warning";
      // Fire = siren. Flood/Other = normal sound only
      // ALL alerts trigger siren for EVERYONE including sender
      void startEmergencySound();
      setEmergencyActive(true);
      vibrateEmergency();
      // Push notification for everyone
      sendToServiceWorker({
        title: `${isCritical ? "🚨" : isWarn ? "⚠️" : "📢"} ${latest.status}`,
        body: latest.text,
        tag: latest.id,
        requireInteraction: isCritical,
      });
    }
    prevAlertCount.current = mergedAlerts.length;
  }, [currentUser, mergedAlerts]);

  // ─── Request all permissions after login ────────────────────────────────────
  const requestAllPermissions = async () => {
    // 1. Notifications - ask if not granted
    if ("Notification" in window && Notification.permission !== "granted") {
      try {
        const p = await Notification.requestPermission();
        if (p === "granted" && currentUser) void initFCM(currentUser.id);
      } catch { /* ignore */ }
    }

    await new Promise(r => setTimeout(r, 300));

    // 2. Microphone - ask if not granted (prompt OR denied = ask again)
    try {
      const micPerm = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (micPerm.state !== "granted") {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
      }
    } catch { /* denied - browser shows blocked icon */ }

    await new Promise(r => setTimeout(r, 300));

    // 3. Camera - ask if not granted
    try {
      const camPerm = await navigator.permissions.query({ name: "camera" as PermissionName });
      if (camPerm.state !== "granted") {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach(t => t.stop());
      }
    } catch { /* denied */ }
  };

  // ─── Auto-logout if current user deleted from Firebase ──────────────────────
  useEffect(() => {
    if (!currentUserId) return;
    if (currentUserId === OWNER_ID) return; // owner cannot be deleted
    // Check if current user still exists in remote Firebase data
    const existsInRemote = remoteApprovedUsers.some(u => u.id === currentUserId);
    const existsInLocal = snapshot.users.some(u => u.id === currentUserId && u.status === "approved");
    // If remoteApprovedUsers has loaded (not empty) and user is gone → logout
    if (remoteApprovedUsers.length > 0 && !existsInRemote && !existsInLocal) {
      // Force logout - clear session
      window.localStorage.removeItem(SESSION_KEY);
      setCurrentUserId(null);
      showToast(language === "ar" ? "⚠️ تم حذف حسابك — تم تسجيل خروجك تلقائياً" : "⚠️ Your account was deleted — logged out automatically", "danger");
    }
  }, [remoteApprovedUsers, currentUserId, snapshot.users]);

  // ─── Auto-stop siren if no active critical alerts ────────────────────────────
  useEffect(() => {
    if (emergencyActive && !hasActiveEmergency) {
      stopEmergencySound();
      setEmergencyActive(false);
    }
  }, [hasActiveEmergency, emergencyActive]);

  // ─── Real-time task notifications ────────────────────────────────────────────
  const prevTaskCount = useRef(0);
  const initialTasks = useRef(true);
  useEffect(() => {
    if (!currentUser || !isGuard) return;
    const myTasks = mergedTasks.filter(t => t.assignedTo === currentUser.id);
    if (initialTasks.current) { initialTasks.current = false; prevTaskCount.current = myTasks.length; return; }
    if (myTasks.length > prevTaskCount.current) {
      const latest = myTasks[0];
      playNormalAlertSound(currentUser.soundEnabled);
      vibrateDevice();
      sendToServiceWorker({
        title: `📋 ${language === "ar" ? "مهمة جديدة" : "New Task"}`,
        body: latest.title,
        tag: latest.id,
        requireInteraction: false,
      });
    }
    prevTaskCount.current = myTasks.length;
  }, [currentUser, isGuard, language, mergedTasks]);

  useEffect(() => { const allowedTabIds = visibleTabs as string[]; if (!allowedTabIds.includes(activeTab)) setActiveTab(isGuard ? "reports" : "dashboard"); }, [activeTab, isGuard, visibleTabs]);
  useEffect(() => { if (!visibleConversations.length) return; if (!visibleConversations.find(c => c.id === conversationId)) setConversationId(visibleConversations[0].id); }, [conversationId, visibleConversations]);
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); recorderRef.current?.stop(); streamRef.current?.getTracks().forEach(t => t.stop()); }, []);

  // ─── Actions ─────────────────────────────────────────────────────────────────
  const showToast = useCallback((text: string, tone: ToastTone = "success") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const mutate = useCallback((updater: (prev: AppSnapshot) => AppSnapshot, successMsg?: string) => {
    try { setSnapshot(prev => updater(prev)); if (successMsg) showToast(successMsg); } catch { showToast(language === "ar" ? "تعذر إكمال العملية" : "Operation failed", "danger"); }
  }, [language, showToast]);

  const pushSync = useCallback((action: string) => setSyncQueue(prev => [...prev, `${nowStamp()}|${action}`]), []);

  // Auth
  const handleSignIn = async (email: string, password: string) => {
    setAuthError(null); setAuthInfo(null);
    const user = snapshot.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) return setAuthError(language === "ar" ? "الحساب غير موجود" : "Account not found");
    if (user.status === "pending") return setAuthInfo(language === "ar" ? "الحساب بانتظار موافقة المالك" : "Account pending approval");
    if (user.passwordHash !== hashPassword(password)) return setAuthError(language === "ar" ? "كلمة المرور غير صحيحة" : "Incorrect password");
    setCurrentUserId(user.id);
    setActiveTab(user.role === "guard" ? "reports" : "dashboard");
    mutate(prev => ({ ...prev, auditLog: [createAuditEntry(user, "login", "session", "تسجيل دخول", "info"), ...prev.auditLog] }));
    // Show permission modal after login (handled by useEffect watching currentUserId)
    // But if already granted, init FCM immediately
    if ("Notification" in window && Notification.permission === "granted") {
      void initFCM(user.id);
    }
  };

  const handleCreateAccount = async (payload: NewAccountPayload) => {
    try {
    setAuthError(null); setAuthInfo(null);
    const emailCheck = validateEmail(payload.email);
    if (!emailCheck.valid) return setAuthError(language === "ar" ? (emailCheck.errorAr ?? "بريد غير صحيح") : (emailCheck.errorEn ?? "Invalid email"));
    const allUsers = [
      ...snapshot.users,
      ...(remotePendingUsers ?? []),
      ...(remoteApprovedUsers ?? []),
    ].filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i); // dedupe
    const emailExists = allUsers.some(u =>
      u.email.toLowerCase() === payload.email.trim().toLowerCase() &&
      !deletedUserIds.has(u.id)
    );
    if (emailExists)
      return setAuthError(language === "ar" ? "البريد مستخدم بالفعل" : "Email already registered");
    if (emailCheck.suggestion) setAuthInfo(emailCheck.suggestion);
    const newUser: User = {
      id: `user-${Date.now()}`, name: payload.name.trim(), email: payload.email.trim(),
      phone: payload.role === "admin" ? "" : payload.phone.trim(),
      securityNumber: payload.securityNumber?.trim() || undefined,
      role: payload.role, status: "pending",
      assignedBuildingId: payload.role === "admin" ? undefined : payload.buildingId,
      permissions: payload.role === "admin" ? ["reports", "attendance", "buildings", "viewReports", "chat", "visitors", "shifts"] : ["reports", "attendance", "chat", "buildings", "visitors", "sos"],
      rating: 4, passwordHash: hashPassword(payload.password), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: nowStamp(), violations: 0,
    };
    // Save to Firebase so owner sees it on ANY device
    try {
      await savePendingUser(newUser);
      mutate(prev => ({ ...prev, users: [newUser, ...prev.users], auditLog: [createAuditEntry(null, "account_request", newUser.email, "طلب حساب جديد", "warning"), ...prev.auditLog] }));
      setPendingUserId(newUser.id);
      window.localStorage.setItem("mustafaqa-pending-id", newUser.id);
      setAuthInfo(language === "ar" ? "✅ تم إرسال الطلب — ستدخل التطبيق تلقائياً عند موافقة المالك" : "✅ Request submitted — you will be logged in automatically when approved");
      // Request notification permission after registration
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => undefined);
      }
      // Notify owner via Worker
      const owner = approvedUsers.find(u => u.role === "owner");
      if (owner) void sendPushViaWorker("⏳ طلب حساب جديد", `${newUser.name} — ${newUser.email}`, "pending_user", owner.id);
    } catch (innerErr) {
      mutate(prev => ({ ...prev, users: [newUser, ...prev.users] }));
      setAuthInfo(language === "ar" ? "تم الإرسال (وضع أوفلاين)" : "Submitted (offline mode)");
    }
    } catch (outerErr) {
      setAuthError(language === "ar" ? "حدث خطأ، حاول مرة أخرى" : "An error occurred, please try again");
      console.error("Create account error:", outerErr);
    }
  };

  // SOS
  const triggerSOS = useCallback(async () => {
    if (!currentUser) return;
    setSosActive(true);
    void startEmergencySound(); setEmergencyActive(true); vibrateEmergency();
    let lat: number | undefined; let lng: number | undefined; let address: string | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 }));
      lat = pos.coords.latitude; lng = pos.coords.longitude;
      address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch { address = currentUser.assignedBuildingId ?? "Unknown"; }
    const sos: SOSEvent = {
      id: `sos-${Date.now()}`, guardId: currentUser.id, guardName: currentUser.name,
      buildingId: currentUser.assignedBuildingId, lat, lng, address, time: nowStamp(), resolved: false,
    };
    const sosAlert: AlertLog = { id: `sos-alert-${Date.now()}`, status: "🚨 SOS EMERGENCY", target: "Everyone", text: `SOS من ${currentUser.name} — ${address}`, sender: currentUser.name, time: nowStamp(), severity: "critical" };
    mutate(prev => ({ ...prev, sosEvents: [sos, ...prev.sosEvents], alerts: [sosAlert, ...prev.alerts], auditLog: [createAuditEntry(currentUser, "sos_trigger", currentUser.name, `SOS activated at ${address}`, "critical"), ...prev.auditLog] }), language === "ar" ? "🚨 تم إرسال نداء الاستغاثة!" : "🚨 SOS Alert Sent!");
    void saveSOSEvent(sos);
    void saveAlert(sosAlert);
    // Push SOS to ALL devices via Cloudflare Worker
    void sendPushViaWorker(
      "🚨 SOS EMERGENCY",
      `${currentUser.name} — ${address}`,
      "sos"
    );
    sendToServiceWorker({ title: `🚨 SOS: ${currentUser.name}`, body: `Emergency at ${address}`, tag: sos.id, requireInteraction: true });
  }, [currentUser, language, mutate]);

  const resolveSOS = (id: string) => {
    if (!currentUser) return;
    mutate(prev => ({ ...prev, sosEvents: prev.sosEvents.map(s => s.id === id ? { ...s, resolved: true, resolvedAt: nowStamp(), resolvedBy: currentUser.name } : s) }), language === "ar" ? "تم إغلاق حادثة SOS" : "SOS resolved");
    void updateSOSEventRemote(id, { resolved: true, resolvedAt: nowStamp(), resolvedBy: currentUser?.name });
    stopEmergencySound(); setEmergencyActive(false); setSosActive(false);
  };

  // Reports
  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !approvedUsers.some(u => u.id === currentUser.id) && currentUser.email !== "mustafakhojali884@gmail.com") {
      setAuthError(language === "ar" ? "حسابك غير نشط" : "Account inactive"); setCurrentUserId(null); return;
    }
    if (!currentUser || !reportForm.text.trim()) return;
    // Use QR-scanned building if available, else form selection
    const buildingId = reportScannedBuilding || reportForm.buildingId;
    const report: Report = {
      id: `r-${Date.now()}`,
      buildingId,
      text: reportForm.text.trim(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderEmail: currentUser.email,
      senderPhone: currentUser.phone,
      time: nowStamp(),
      status: reportForm.status,
      mediaUrl: reportForm.mediaUrl || undefined,
      mediaKind: reportForm.mediaKind || undefined,
      fileName: reportForm.fileName || undefined,
    };
    void saveReport(report);
    mutate(prev => ({ ...prev, reports: [report, ...prev.reports] }), language === "ar" ? "✅ تم إرسال التقرير" : "✅ Report sent");
    pushSync("report");
    // Push new report to owner & admins with full content
    const rEmoji = report.status === "critical" ? "🚨" : report.status === "warning" ? "⚠️" : "📋";
    const rBuilding = snapshot.buildings.find(b => b.id === report.buildingId);
    const rBuildingName = rBuilding ? (language === "ar" ? rBuilding.nameAr : rBuilding.nameEn) : "";
    approvedUsers.filter(u => u.role === "owner" || u.role === "admin").forEach(u => {
      void sendPushViaWorker(
        `${rEmoji} ${currentUser?.name} — ${rBuildingName}`,
        report.text.slice(0, 200),
        "report",
        u.id
      );
    });
    setReportForm(prev => ({ ...prev, text: "", status: "normal", mediaUrl: "", mediaKind: "", fileName: "" }));
    setReportScannedBuilding("");
  };

  // Shifts - see new addShift in renderShifts section
  // This is a placeholder - actual addShift is defined below
  const _addShiftPlaceholder = null;

  const endShift = (shiftId: string) => {
    if (!currentUser) return;
    const updates = { status: "completed" as const, checkOutTime: nowStamp(), endOfShiftReport: endShiftNote || "النوبة انتهت بشكل طبيعي." };
    mutate(prev => ({ ...prev, shifts: prev.shifts.map(s => s.id === shiftId ? { ...s, ...updates } : s) }), language === "ar" ? "تم إنهاء النوبة" : "Shift ended");
    void updateShiftRemote(shiftId, updates);
    const shift = snapshot.shifts.find(s => s.id === shiftId);
    if (shift) { try { exportShiftReportPDF({ ...shift, status: "completed", checkOutTime: nowStamp(), endOfShiftReport: endShiftNote }, currentUser.name, APP_NAME); } catch { /* ignore */ } }
    setEndShiftNote(""); setSelectedShiftId(null);
  };

  // Violations
  const addViolation = (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !violationForm.guardId || !violationForm.type) return;
    const guard = approvedUsers.find(u => u.id === violationForm.guardId);
    if (!guard) return;
    const v: Violation = { id: `viol-${Date.now()}`, guardId: violationForm.guardId, guardName: guard.name, type: violationForm.type, description: violationForm.description, severity: violationForm.severity, buildingId: violationForm.buildingId || "", date: today(), createdBy: currentUser.name, createdAt: nowStamp(), acknowledged: false };
    mutate(prev => ({
      ...prev, violations: [v, ...prev.violations],
      users: prev.users.map(u => u.id === violationForm.guardId ? { ...u, violations: (u.violations ?? 0) + 1 } : u),
      auditLog: [createAuditEntry(currentUser, "violation_issued", guard.name, `مخالفة: ${violationForm.type}`, "warning"), ...prev.auditLog],
    }), language === "ar" ? "تم تسجيل المخالفة" : "Violation recorded");
    setViolationForm({ guardId: "", type: "", description: "", severity: "minor", buildingId: "" });
  };

  // Visitors
  const createVisitor = async (payload: VisitorFormPayload) => {
    if (!currentUser || (!isOwner && !isAdmin)) return;
    const visitor: VisitorRecord = { id: `v-${Date.now()}`, guestName: payload.guestName.trim(), company: payload.company.trim(), purpose: payload.purpose.trim(), identityNumber: payload.identityNumber?.trim() ?? "", buildingId: payload.buildingId, arrivalDate: payload.arrivalDate, arrivalTime: payload.arrivalTime, createdBy: currentUser.name, createdAt: nowStamp(), passCode: generatePassCode(), status: "scheduled", reminderSent: false, preNotified: true, notes: payload.notes };
    const qrData = await generateVisitorQR(visitor.passCode, visitor.guestName).catch(() => "");
    const fullVisitor = { ...visitor, qrData };
    const visitorAlert: AlertLog = { id: `va-${Date.now()}`, status: language === "ar" ? "إشعار زائر" : "Visitor Notice", target: language === "ar" ? "جميع الحراس" : "All Guards", text: `${visitor.guestName} - ${visitor.company} - ${visitor.arrivalDate} ${visitor.arrivalTime}`, sender: currentUser.name, time: nowStamp(), severity: "info" };
    mutate(prev => ({ ...prev, visitors: [fullVisitor, ...prev.visitors], alerts: [visitorAlert, ...prev.alerts] }), language === "ar" ? "تمت إضافة الزائر" : "Visitor added");
    void saveVisitor(fullVisitor);
    void saveAlert(visitorAlert);
    // Push visitor notification to all guards
    guardUsers.forEach(g => {
      void sendPushViaWorker(
        `🎫 ${language === "ar" ? "زائر جديد" : "New Visitor"} — ${visitor.guestName}`,
        `${visitor.company} · ${visitor.arrivalDate} ${visitor.arrivalTime} · ${language === "ar" ? "رمز الدخول" : "Pass"}: ${fullVisitor.passCode}`,
        "alert",
        g.id
      );
    });
    setVisitorModalOpen(false);
  };

  // Attendance
  const clockIn = () => {
    if (!currentUser) return;
    const record: AttendanceRecord = { id: `at-${Date.now()}`, userId: currentUser.id, userName: currentUser.name, buildingId: currentUser.assignedBuildingId ?? snapshot.buildings[0]?.id ?? "", method: "manual", time: nowStamp() };
    void saveAttendance(record);
    mutate(prev => ({ ...prev, attendance: [record, ...prev.attendance] }), language === "ar" ? "تم تسجيل الحضور" : "Checked in");
    pushSync("attendance");
  };

  // Chat
  const sendMessage = (text: string) => {
    if (!currentUser || !activeConversation || !text.trim()) return;
    const msg: ChatMessage = { id: `msg-${Date.now()}`, senderId: currentUser.id, kind: "text", text: text.trim(), time: chatTime(language) };
    // Use conversationsSource (includes Firebase data) to find existing conversation
    const existingInSource = conversationsSource.find(c => c.id === activeConversation.id);
    const baseConv = existingInSource ?? activeConversation;
    const updated = { ...baseConv, messages: [...(baseConv.messages ?? []), msg] };
    // Save to Firebase immediately
    void saveConversation(updated);
    // Push notification to recipient via Worker
    const recipientId = currentUser.role === "owner" || currentUser.role === "admin"
      ? activeConversation.participantId
      : approvedUsers.find(u => u.role === "owner")?.id;
    if (recipientId) {
      void sendPushViaWorker(
        `💬 ${currentUser.name}`,
        text.trim().slice(0, 100),
        "chat",
        recipientId
      );
    }
    // Update local state
    mutate(prev => {
      const localExists = prev.conversations.find(c => c.id === activeConversation.id);
      if (localExists) return { ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? updated : c) };
      return { ...prev, conversations: [updated, ...prev.conversations] };
    });
  };

  // Approve/reject user
  const approveUser = async (userId: string) => {
    if (!currentUser) return;
    const approvedUser = [...snapshot.users, ...remotePendingUsers].find(u => u.id === userId);
    if (!approvedUser) return;
    const updatedUser = { ...approvedUser, status: "approved" as const };
    // Save to approved_users in Firebase
    await saveApprovedUser(updatedUser);
    // Delete from pending
    void deletePendingUserRemote(userId);
    // Write auto-login signal so user's device logs in immediately
    try {
      const { setDoc, doc } = await import("firebase/firestore");
      const { firestore } = await import("./services/firebase");
      await setDoc(doc(firestore, "login_approved", userId), {
        userId, approvedAt: nowStamp(), approvedBy: currentUser.name
      });
    } catch { /* offline */ }
    mutate(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === userId ? updatedUser : u),
      auditLog: [createAuditEntry(currentUser, "approve_user", userId, "تمت الموافقة على المستخدم", "info"), ...prev.auditLog],
    }));
    showToast(language === "ar" ? `✅ تمت الموافقة على ${approvedUser.name} — سيدخل التطبيق تلقائياً` : `✅ ${approvedUser.name} approved — will login automatically`, "success");
    // Send push notification to approved user
    void sendPushViaWorker("✅ تمت الموافقة على حسابك", language === "ar" ? "يمكنك الآن تسجيل الدخول" : "You can now login", "task", userId);
  };

  const rejectUser = (userId: string) => {
    mutate(prev => ({ ...prev, users: prev.users.filter(u => u.id !== userId) }), language === "ar" ? "تم الرفض" : "Rejected");
    void deletePendingUserRemote(userId);
  };

  const deleteUser = async (userId: string) => {
    if (!currentUser || userId === currentUser.id) return;
    // Delete from Firebase FIRST
    await deleteApprovedUserRemote(userId);
    await deletePendingUserRemote(userId);
    // Update local state immediately
    mutate(prev => ({
      ...prev,
      users: prev.users.filter(u => u.id !== userId),
      auditLog: [createAuditEntry(currentUser, "delete_user", userId, "تم حذف المستخدم", "warning"), ...prev.auditLog],
    }));
    setDeletedUserIds(prev => new Set([...prev, userId]));
// Account deleted - not blocked (can re-register)
    // Delete FCM tokens + write forced logout marker
    try {
      const { deleteDoc, setDoc, doc, collection, getDocs, query, where } = await import("firebase/firestore");
      const { firestore } = await import("./services/firebase");
      // Delete FCM tokens
      const tokSnap = await getDocs(query(collection(firestore, "fcm_tokens"), where("userId", "==", userId)));
      tokSnap.forEach(d => deleteDoc(d.ref));
      // Write forced logout - device checks this on every render
      await setDoc(doc(firestore, "forced_logouts", userId), {
        userId, deletedAt: nowStamp(), deletedBy: currentUser?.name ?? "owner"
      });
    } catch { /* ignore */ }
    showToast(language === "ar" ? "✅ تم حذف المستخدم وسيتم تسجيل خروجه فوراً" : "✅ User deleted — will be logged out immediately", "success");
  };

  const blockUser = async (userId: string, userName: string) => {
    if (!currentUser) return;
    try {
      const { setDoc, doc } = await import("firebase/firestore");
      const { firestore } = await import("./services/firebase");
      await setDoc(doc(firestore, "blocked_users", userId), {
        blockedAt: nowStamp(), blockedBy: currentUser.name, userId, userName, reason: "manual_block"
      });
      setBlockedUserIds(prev => new Set([...prev, userId]));
      showToast(language === "ar" ? `🚫 تم حظر ${userName} — لن يستطيع الدخول حتى ترفع الحظر` : `🚫 ${userName} blocked — cannot login until unblocked`, "success");
    } catch { showToast(language === "ar" ? "خطأ في الحظر" : "Block failed", "danger"); }
  };

  const unblockUser = async (userId: string, userName: string) => {
    if (!currentUser) return;
    try {
      const { deleteDoc, doc } = await import("firebase/firestore");
      const { firestore } = await import("./services/firebase");
      await deleteDoc(doc(firestore, "blocked_users", userId));
      setBlockedUserIds(prev => { const n = new Set(prev); n.delete(userId); return n; });
      showToast(language === "ar" ? `✅ تم رفع الحظر عن ${userName}` : `✅ ${userName} unblocked`, "success");
    } catch { showToast(language === "ar" ? "خطأ" : "Error", "danger"); }
  };

  const requestDesktopNotification = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotificationPermission(perm);
    showToast(perm === "granted" ? (language === "ar" ? "تم منح الإذن" : "Permission granted") : (language === "ar" ? "تم رفض الإذن" : "Permission denied"), perm === "granted" ? "success" : "danger");
  };

  const handleQrDetected = (code: string) => {
    setQrModalOpen(false);
    try {
      const data = JSON.parse(code);
      if (data.type === "building" && qrContext === "patrol") {
        scanPatrolCheckpoint(data.buildingId || snapshot.buildings.find(b => b.qrCode === data.qrCode)?.id || "");
      } else if (data.type === "building" && qrContext === "report") {
        // QR scan for report - match by id OR qrCode OR buildingName
        const building = snapshot.buildings.find(b =>
          b.id === data.buildingId ||
          b.qrCode === data.buildingId ||
          b.qrCode === data.qrCode ||
          b.nameEn === data.buildingName
        );
        if (building) {
          setReportScannedBuilding(building.id);
          showToast(language === "ar" ? `✅ ${building.nameAr} — يمكنك الآن إرسال التقرير` : `✅ ${building.nameEn} — You can now submit the report`, "success");
        } else {
          showToast(language === "ar" ? "❌ رمز QR غير معروف — تأكد أنه QR مبنى" : "❌ Unknown QR — make sure it's a building QR", "danger");
        }
      } else if (data.type === "building" && qrContext === "attendance") {
        // Match building by id OR qrCode OR name
        const building = snapshot.buildings.find(b =>
          b.id === data.buildingId ||
          b.qrCode === data.buildingId ||
          b.qrCode === data.qrCode ||
          b.nameEn === data.buildingName
        );
        if (!building || !currentUser) { showToast(language === "ar" ? "❌ مبنى غير معروف" : "❌ Unknown building", "danger"); return; }
        // STRICT: must match assigned building
        if (!currentUser.assignedBuildingId) {
          showToast(language === "ar" ? "⚠️ لا يوجد مبنى مخصص لك — تواصل مع المالك" : "⚠️ No building assigned — contact owner", "danger"); return;
        }
        if (currentUser.assignedBuildingId !== building.id) {
          const myB = snapshot.buildings.find(b => b.id === currentUser.assignedBuildingId);
          showToast(language === "ar" ? `❌ مبناك: ${myB?.nameAr ?? "—"} — هذا QR لـ ${building.nameAr}` : `❌ Your building: ${myB?.nameEn ?? "—"} — this QR is for ${building.nameEn}`, "danger"); return;
        }
        // Toggle: find today's last record
        const todayStr = today();
        const myRecs = [...mergedAttendance, ...snapshot.attendance]
          .filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i) // dedupe
          .filter(a => a.userId === currentUser.id && a.time.startsWith(todayStr))
          .sort((a, b) => b.time.localeCompare(a.time));
        const lastRec = myRecs[0];
        const isIn = lastRec && !lastRec.checkOut;
        // BLOCK: if already clocked IN + OUT today → reject 3rd scan
        if (lastRec?.checkOut) {
          showToast(
            language === "ar"
              ? "🔒 لقد سجلت دخولك وخروجك اليوم — لا يمكن المسح مرة أخرى"
              : "🔒 You already clocked in & out today — no more scans allowed",
            "danger"
          );
          return;
        }
        if (isIn) {
          // CLOCK OUT
          const checkOutTime = nowStamp();
          const updated = { ...lastRec, checkOut: checkOutTime };
          mutate(prev => ({ ...prev, attendance: prev.attendance.map(a => a.id === lastRec.id ? updated : a) }));
          void saveAttendance(updated);
          const inTime = new Date(lastRec.time.replace(" ","T"));
          const outTime = new Date(checkOutTime.replace(" ","T"));
          const diffMins = Math.round((outTime.getTime() - inTime.getTime()) / 60000);
          const dur = `${Math.floor(diffMins/60)}س ${diffMins%60}د`;
          showToast(language === "ar" ? `🔴 تسجيل خروج — ${building.nameAr} · المدة: ${dur}` : `🔴 Clocked OUT — ${building.nameEn} · ${dur}`, "info");
        } else {
          // CLOCK IN
          const record: AttendanceRecord = { id: `at-${Date.now()}`, userId: currentUser.id, userName: currentUser.name, buildingId: building.id, method: "qr", time: nowStamp() };
          mutate(prev => ({ ...prev, attendance: [record, ...prev.attendance] }));
          void saveAttendance(record);
          showToast(language === "ar" ? `🟢 تسجيل دخول — ${building.nameAr}` : `🟢 Clocked IN — ${building.nameEn}`, "success");
        }
      } else if (data.type === "visitor") {
        const visitor = snapshot.visitors.find(v => v.passCode === data.passCode);
        if (visitor) { mutate(prev => ({ ...prev, visitors: prev.visitors.map(v => v.id === visitor.id ? { ...v, status: "arrived", checkInTime: nowStamp() } : v) }), language === "ar" ? `✅ تم استقبال ${visitor.guestName}` : `✅ ${visitor.guestName} checked in`); void updateVisitorRemote(visitor.id, { status: "arrived", checkInTime: nowStamp() }); }
      }
    } catch { showToast(language === "ar" ? "رمز غير معروف" : "Unknown QR", "danger"); }
    setQrContext(null);
  };

  // ─── Render Sections ──────────────────────────────────────────────────────────

  // ─── Guard Score Calculation ──────────────────────────────────────────────
  const calcGuardScore = (guardId: string): { score: number; stars: number; breakdown: { att: number; rep: number; viol: number } } => {
    const attDays = new Set(mergedAttendance.filter(a => a.userId === guardId).map(a => a.time.split(" ")[0])).size;
    const repCount = mergedReports.filter(r => r.senderId === guardId).length;
    const violations = approvedUsers.find(u => u.id === guardId)?.violations ?? 0;
    const att = attDays * 10;
    const rep = repCount * 5;
    const viol = violations * 15;
    const score = Math.max(0, att + rep - viol);
    const stars = score >= 100 ? 5 : score >= 70 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1;
    return { score, stars, breakdown: { att, rep, viol } };
  };

  // ─── Patrol Functions ─────────────────────────────────────────────────────
  const startPatrol = (route: PatrolRoute) => {
    if (!currentUser) return;
    const checkpoints: PatrolCheckpoint[] = route.buildingIds.map((bId, i) => {
      const b = snapshot.buildings.find(x => x.id === bId);
      return { buildingId: bId, buildingName: b ? (language === "ar" ? b.nameAr : b.nameEn) : bId, order: i + 1 };
    });
    const patrol: PatrolRound = {
      id: `patrol-${Date.now()}`, guardId: currentUser.id, guardName: currentUser.name,
      startedAt: nowStamp(), checkpoints, status: "active",
    };
    setActivePatrol(patrol);
    showToast(language === "ar" ? `🚶 بدأت الجولة — ${checkpoints.length} نقطة` : `🚶 Patrol started — ${checkpoints.length} checkpoints`, "success");
  };

  const scanPatrolCheckpoint = (buildingId: string) => {
    if (!activePatrol) return;
    const building = snapshot.buildings.find(b => b.id === buildingId);
    if (!building) return;
    const updatedCheckpoints = activePatrol.checkpoints.map(cp =>
      cp.buildingId === buildingId && !cp.scannedAt ? { ...cp, scannedAt: nowStamp() } : cp
    );
    const allDone = updatedCheckpoints.every(cp => cp.scannedAt);
    const updated: PatrolRound = {
      ...activePatrol, checkpoints: updatedCheckpoints,
      status: allDone ? "completed" : "active",
      completedAt: allDone ? nowStamp() : undefined,
    };
    setActivePatrol(allDone ? null : updated);
    if (allDone) {
      showToast(language === "ar" ? "✅ اكتملت الجولة الأمنية!" : "✅ Patrol completed!", "success");
    } else {
      const next = updatedCheckpoints.find(cp => !cp.scannedAt);
      showToast(language === "ar" ? `✅ ${building.nameAr} · التالي: ${next?.buildingName ?? "—"}` : `✅ ${building.nameEn} · Next: ${next?.buildingName ?? "—"}`, "success");
    }
  };

  const renderDashboard = () => {
    const todayStr = today();
    const todayReports = mergedReports.filter(r => r.time.startsWith(todayStr));
    const next24hVisitors = mergedVisitors.filter(v => v.arrivalDate === todayStr && v.status === "scheduled");
    const onlineGuards = guardUsers.filter(u => activeUserIds.includes(u.id));
    // Emergency only if: alert within last 24h AND not stopped
    const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
    const hasEmergency = (emergencyActive && mergedAlerts.some(a =>
      !(a as AlertLog & { stopped?: boolean }).stopped &&
      !stoppedAlertIds.has(a.id) &&
      a.time >= now24h
    )) || mergedSOSEvents.some(s => !s.resolved);

    // Guard-specific simplified dashboard
    if (isGuard && currentUser) {
      const myTasks = mergedTasks.filter(t => t.assignedTo === currentUser.id && t.status !== "done");
      const myTodayReports = mergedReports.filter(r => r.senderId === currentUser.id && r.time.startsWith(todayStr));
      const myShiftToday = mergedShifts.find(s => s.guardId === currentUser.id && s.date === todayStr);
      const welcome = language === "ar" ? snapshot.systemSettings.welcomeAr : snapshot.systemSettings.welcomeEn;
      return (
        <div className="space-y-5">
          {/* Welcome */}
          <Panel className="border-amber-400/20">
            <div className="flex items-center gap-4">
              <div className="text-4xl">👮</div>
              <div>
                <div className="text-xl font-black text-white">{language === "ar" ? `مرحباً ${currentUser.name}` : `Welcome, ${currentUser.name}`}</div>
                <div className="text-sm text-slate-400 mt-1">{welcome}</div>
              </div>
            </div>
          </Panel>

          {/* Quick stats */}
          <div className="grid gap-3 grid-cols-3">
            <Panel className="min-h-0 p-4 text-center">
              <div className="text-2xl font-black text-amber-400">{myTasks.length}</div>
              <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "مهام معلقة" : "Pending Tasks"}</div>
            </Panel>
            <Panel className="min-h-0 p-4 text-center">
              <div className="text-2xl font-black text-sky-400">{myTodayReports.length}</div>
              <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "تقارير اليوم" : "Today Reports"}</div>
            </Panel>
            <Panel className="min-h-0 p-4 text-center">
              <div className={`text-2xl font-black ${myShiftToday ? "text-emerald-400" : "text-slate-500"}`}>{myShiftToday ? "✅" : "—"}</div>
              <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "نوبة اليوم" : "Shift Today"}</div>
            </Panel>
          </div>

          {/* My pending tasks */}
          {myTasks.length > 0 && (
            <Panel>
              <div className="mb-3 font-black text-white">📋 {language === "ar" ? "مهامي المعلقة" : "My Pending Tasks"}</div>
              <div className="space-y-2">
                {myTasks.slice(0, 5).map(t => (
                  <div key={t.id} className={`rounded-2xl border p-3 ${t.priority === "high" ? "border-red-500/20 bg-red-500/5" : "border-white/10 bg-white/5"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-white text-sm">{t.title}</div>
                        {t.dueDate && <div className="text-xs text-slate-400">{language === "ar" ? "الاستحقاق:" : "Due:"} {t.dueDate}</div>}
                      </div>
                      <Badge className={t.priority === "high" ? "border-red-400/30 bg-red-500/15 text-red-300" : t.priority === "medium" ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>{t.priority}</Badge>
                    </div>
                  </div>
                ))}
              </div>
              <Btn variant="secondary" className="mt-3 w-full" onClick={() => setActiveTab("tasks")}>{language === "ar" ? "عرض جميع المهام" : "View All Tasks"}</Btn>
            </Panel>
          )}

          {/* Quick actions */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Btn className="h-16 text-base" onClick={() => setActiveTab("reports")}>📝 {language === "ar" ? "رفع تقرير" : "Submit Report"}</Btn>
            <Btn variant="sos" className="h-16 text-base" onClick={() => setActiveTab("sos")}>🚨 SOS</Btn>
            <Btn variant="secondary" className="h-14" onClick={() => setActiveTab("attendance")}>📷 {language === "ar" ? "تسجيل الحضور" : "Clock In"}</Btn>
            <Btn variant="secondary" className="h-14" onClick={() => setActiveTab("chat")}>💬 {language === "ar" ? "الدردشة" : "Chat"}</Btn>
          </div>
        </div>
      );
    }

    // Owner / Admin dashboard
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHead title={language === "ar" ? "مركز العمليات الأمنية" : "Security Operations Center"} subtitle={APP_NAME} />
          <Btn variant="secondary" onClick={() => { try { exportFullDashboardPDF(snapshot, APP_NAME); showToast(language === "ar" ? "تم تصدير PDF" : "PDF exported"); } catch { showToast("PDF failed", "danger"); } }}>📄 PDF</Btn>
        </div>

        {/* ── Emergency active banner ── */}
        {hasEmergency && (
          <div className="rounded-2xl border border-red-500/50 bg-red-600/20 p-4 animate-pulse flex items-center gap-4">
            <span className="text-3xl">🚨</span>
            <div className="flex-1">
              <div className="font-black text-red-200 text-lg">{language === "ar" ? "وضع الطوارئ نشط" : "Emergency Mode Active"}</div>
              <div className="text-sm text-red-300">{language === "ar" ? "صفارة الإنذار تعمل — تحقق من التنبيهات فوراً" : "Siren is active — check Alerts immediately"}</div>
            </div>
            {emergencyActive && (
              <Btn variant="danger" onClick={() => { stopEmergencySound(); setEmergencyActive(false); }}>🔇 {language === "ar" ? "إيقاف الصفارة" : "Stop Siren"}</Btn>
            )}
          </div>
        )}

        {/* ── AI Insights ── */}
        {insights.some(i => i.type !== "info") && (
          <div className="space-y-2">
            {insights.filter(i => i.type !== "info").map((ins, i) => (
              <div key={i} className={`rounded-2xl border px-4 py-3 text-sm flex items-start gap-3 ${ins.type === "critical" ? "border-red-500/30 bg-red-500/10" : "border-amber-500/30 bg-amber-500/10"}`}>
                <span className="text-lg flex-shrink-0">{ins.type === "critical" ? "🚨" : "⚠️"}</span>
                <div>
                  <div className="font-black text-white">{language === "ar" ? ins.titleAr : ins.title}</div>
                  <div className="text-slate-300 mt-0.5">{language === "ar" ? ins.bodyAr : ins.body}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Summary Cards ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Guards online */}
          <div className={`rounded-[28px] border bg-[#0b132b]/90 p-5 min-h-0 cursor-pointer hover:border-emerald-400/30 transition ${onlineGuards.length > 0 ? "border-emerald-500/20" : "border-white/10"}`} onClick={() => setActiveTab("users")}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-black text-emerald-400">{onlineGuards.length}<span className="text-slate-500 text-lg font-normal">/{guardUsers.length}</span></div>
                <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "حراس متصلون / إجمالي" : "Guards Online / Total"}</div>
              </div>
              <span className="text-2xl">👮</span>
            </div>
            {onlineGuards.length > 0 && <div className="mt-2 text-xs text-emerald-400">● {language === "ar" ? "نشط الآن" : "Active now"}</div>}
          </div>

          {/* Today reports */}
          <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-5 min-h-0 cursor-pointer hover:border-sky-400/30 transition" onClick={() => setActiveTab("reports")}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-black text-sky-400">{todayReports.length}</div>
                <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "تقارير اليوم" : "Today's Reports"}</div>
              </div>
              <span className="text-2xl">📋</span>
            </div>
            {todayReports.filter(r => r.status === "critical").length > 0 && (
              <div className="mt-2 text-xs text-red-400">🚨 {todayReports.filter(r => r.status === "critical").length} {language === "ar" ? "حرج" : "critical"}</div>
            )}
          </div>

          {/* Today visitors */}
          <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-5 min-h-0 cursor-pointer hover:border-amber-400/30 transition" onClick={() => setActiveTab("visitors")}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-3xl font-black text-amber-400">{next24hVisitors.length}</div>
                <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "زوار مجدولون اليوم" : "Scheduled Visitors Today"}</div>
              </div>
              <span className="text-2xl">🎫</span>
            </div>
          </div>

          {/* Pending accounts (owner only) / Open violations (admin) */}
          {isOwner ? (
            <div className={`rounded-[28px] border bg-[#0b132b]/90 p-5 min-h-0 cursor-pointer transition ${pendingUsers.length > 0 ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-400/60 animate-pulse" : "border-white/10 hover:border-white/20"}`} onClick={() => setActiveTab("users")}>
              <div className="flex items-start justify-between">
                <div>
                  <div className={`text-3xl font-black ${pendingUsers.length > 0 ? "text-amber-400" : "text-slate-500"}`}>{pendingUsers.length}</div>
                  <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "طلبات حسابات معلقة" : "Pending Account Requests"}</div>
                </div>
                <span className="text-2xl">⏳</span>
              </div>
              {pendingUsers.length > 0 && <div className="mt-2 text-xs text-amber-400">{language === "ar" ? "تحتاج موافقتك" : "Awaiting your approval"}</div>}
            </div>
          ) : (
            <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-5 min-h-0 cursor-pointer hover:border-white/20 transition" onClick={() => setActiveTab("violations")}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-3xl font-black text-amber-400">{mergedViolations.filter(v => !v.acknowledged).length}</div>
                  <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "مخالفات مفتوحة" : "Open Violations"}</div>
                </div>
                <span className="text-2xl">⚠️</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Secondary stats ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-4 min-h-0 cursor-pointer hover:border-white/20 transition" onClick={() => setActiveTab("settings")}>
            <div className="text-2xl font-black text-white">{mergedShifts.filter(s => s.date === todayStr).length}</div>
            <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "نوبات اليوم" : "Today Shifts"}</div>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-4 min-h-0 cursor-pointer hover:border-white/20 transition" onClick={() => setActiveTab("alerts")}>
            <div className="text-2xl font-black text-red-400">{mergedSOSEvents.filter(s => !s.resolved).length}</div>
            <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "SOS نشط" : "Active SOS"}</div>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-4 min-h-0 cursor-pointer hover:border-white/20 transition" onClick={() => setActiveTab("reports")}>
            <div className="text-2xl font-black text-amber-400">{mergedReports.filter(r => r.status === "warning").length}</div>
            <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "تحذيرات" : "Warnings"}</div>
          </div>
          <div className="rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-4 min-h-0 cursor-pointer hover:border-white/20 transition" onClick={() => setActiveTab("reports")}>
            <div className="text-2xl font-black text-red-300">{mergedReports.filter(r => r.status === "critical").length}</div>
            <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "تقارير حرجة" : "Critical Reports"}</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Live users (owner only) ── */}
          {isOwner && (
            <Panel>
              <div className="mb-3 flex items-center justify-between">
                <div className="font-black text-white">{language === "ar" ? "المتصلون الآن" : "Online Now"}</div>
                <Badge className="border-emerald-400/30 bg-emerald-500/15 text-emerald-300">{activeUserIds.length}</Badge>
              </div>
              {activeUserIds.length === 0
                ? <div className="text-sm text-slate-500 text-center py-4">{language === "ar" ? "لا أحد متصل" : "No one online"}</div>
                : approvedUsers.filter(u => activeUserIds.includes(u.id)).map(u => (
                  <div key={u.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-emerald-500/10 bg-emerald-500/5 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white text-sm truncate">{u.name}</div>
                      <div className="text-xs text-slate-400">{pair(language, roleLabels[u.role])}</div>
                    </div>
                    <Badge className={getRoleBadgeClass(u.role)} >{u.role === "owner" ? "👑" : u.role === "admin" ? "🛡️" : "👮"}</Badge>
                  </div>
                ))
              }
            </Panel>
          )}

          {/* ── Latest reports ── */}
          <Panel className={isOwner ? "" : "lg:col-span-2"}>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-black text-white">{language === "ar" ? "آخر التقارير" : "Latest Reports"}</div>
              <Btn variant="secondary" className="h-7 px-3 text-xs" onClick={() => setActiveTab("reports")}>{language === "ar" ? "عرض الكل" : "View All"}</Btn>
            </div>
            {mergedReports.length === 0
              ? <EmptyMsg title={language === "ar" ? "لا تقارير" : "No Reports"} text="" />
              : mergedReports.slice(0, 5).map(r => (
                <div key={r.id} className={`mb-2 rounded-2xl border p-3 ${r.status === "critical" ? "border-red-500/20 bg-red-500/5" : r.status === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
                  <div className="flex items-start gap-3">
                    <Badge className={getStatusBadgeClass(r.status)}>{r.status}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white">{r.senderName} <span className="text-slate-500 font-normal">· {formatBuilding(snapshot.buildings.find(b => b.id === r.buildingId), language)}</span></div>
                      <div className="text-xs text-slate-400 truncate">{r.text}</div>
                      <div className="text-xs text-slate-600 mt-0.5">{r.time}</div>
                    </div>
                  </div>
                </div>
              ))
            }
          </Panel>

          {/* ── Latest SOS ── */}
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <div className="font-black text-white">{language === "ar" ? "آخر أحداث SOS" : "Latest SOS"}</div>
              <Btn variant="secondary" className="h-7 px-3 text-xs" onClick={() => setActiveTab("sos")}>{language === "ar" ? "عرض الكل" : "View All"}</Btn>
            </div>
            {mergedSOSEvents.length === 0
              ? <EmptyMsg title={language === "ar" ? "لا أحداث" : "No SOS"} text="" />
              : mergedSOSEvents.slice(0, 4).map(s => (
                <div key={s.id} className={`mb-2 rounded-2xl border p-3 ${s.resolved ? "border-emerald-500/10 bg-emerald-500/5" : "border-red-500/30 bg-red-500/10 animate-pulse"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-white text-sm">{s.guardName}</div>
                      <div className="text-xs text-slate-400">{s.time}</div>
                    </div>
                    <Badge className={s.resolved ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                      {s.resolved ? "✅" : "🚨"}
                    </Badge>
                  </div>
                </div>
              ))
            }
          </Panel>
        </div>

        {/* ── Alert distribution chart ── */}
        <Panel>
          <div className="mb-4 font-black text-white">{language === "ar" ? "توزيع التنبيهات والتقارير" : "Alert & Report Distribution"}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Reports breakdown */}
            <div>
              <div className="text-xs text-slate-400 mb-3">{language === "ar" ? "التقارير حسب الحالة" : "Reports by Status"}</div>
              {(["normal","warning","critical"] as const).map(s => {
                const count = mergedReports.filter(r => r.status === s).length;
                const pct = mergedReports.length > 0 ? Math.round((count / mergedReports.length) * 100) : 0;
                return (
                  <div key={s} className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">{pair(language, { ar: s === "normal" ? "طبيعي" : s === "warning" ? "تحذير" : "حرج", en: s.charAt(0).toUpperCase() + s.slice(1) })}</span>
                      <span className="text-slate-400">{count} ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10">
                      <div className={`h-2 rounded-full transition-all ${s === "critical" ? "bg-red-500" : s === "warning" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Guard performance */}
            <div>
              <div className="text-xs text-slate-400 mb-3">{language === "ar" ? "أداء الحراس (التقارير)" : "Guard Performance (Reports)"}</div>
              {guardUsers.slice(0, 5).map(g => {
                const gReports = mergedReports.filter(r => r.senderId === g.id).length;
                const max = Math.max(...guardUsers.map(u => mergedReports.filter(r => r.senderId === u.id).length), 1);
                return (
                  <div key={g.id} className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 truncate max-w-[120px]">{g.name}</span>
                      <span className="text-slate-400">{gReports} {language === "ar" ? "تقرير" : "reports"}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10">
                      <div className="h-2 rounded-full bg-sky-500 transition-all" style={{ width: `${Math.round((gReports / max) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* ── Quick actions ── */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {isOwner && <Btn onClick={() => setActiveTab("users")} variant="secondary" className="h-12">{language === "ar" ? "👥 إدارة المستخدمين" : "👥 Manage Users"}</Btn>}
          <Btn onClick={() => setActiveTab("alerts")} variant="secondary" className="h-12">{language === "ar" ? "🚨 إرسال إنذار" : "🚨 Send Alert"}</Btn>
          <Btn onClick={() => setActiveTab("visitors")} variant="secondary" className="h-12">{language === "ar" ? "🎫 إضافة زائر" : "🎫 Add Visitor"}</Btn>

        </div>
      </div>
    );
  };

  const renderSOS = () => (
    <div className="space-y-6">
      <SectionHead title="SOS" subtitle={language === "ar" ? "زر الطوارئ الفوري" : "Emergency Button"} />

      {/* Stop siren button - always visible if emergency active */}
      {(emergencyActive || hasActiveEmergency) && (
        <div className="rounded-2xl border border-red-500/50 bg-red-600/20 p-4 flex flex-wrap items-center gap-4">
          <span className="text-3xl animate-pulse">🚨</span>
          <div className="flex-1">
            <div className="font-black text-red-200 text-lg">{language === "ar" ? "صفارة الإنذار تعمل!" : "Siren is Active!"}</div>
          </div>
          <Btn variant="danger" onClick={() => { stopEmergencySound(); setEmergencyActive(false); }}>
            🔇 {language === "ar" ? "إيقاف الصفارة" : "Stop Siren"}
          </Btn>
          {isOwner && (
            <Btn variant="danger" onClick={() => {
              stopEmergencySound(); setEmergencyActive(false);
              const critAlerts = mergedAlerts.filter(a => a.severity === "critical" && (a.status.includes("🔥") || a.status.includes("Fire") || a.status.includes("حريق")));
              critAlerts.forEach(a => void saveAlert({ ...a, stopped: true } as AlertLog));
              setStoppedAlertIds(prev => new Set([...prev, ...critAlerts.map(a => a.id)]));
              navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_EMERGENCY_NOTIFICATION" });
              showToast(language === "ar" ? "🔇 تم إيقاف جميع الإنذارات" : "🔇 All alerts stopped", "info");
            }}>🔇 {language === "ar" ? "إيقاف الكل" : "Stop All"}</Btn>
          )}
        </div>
      )}

      {/* SOS Button - for ALL users */}
      {(
        <Panel>
          <div className="flex flex-col items-center gap-6 py-4">
            <div className="text-6xl">🚨</div>
            <p className="text-center text-slate-300 max-w-xs">{language === "ar" ? "اضغط الزر عند وجود خطر فوري. سيتم إرسال موقعك تلقائياً." : "Press the button when in immediate danger. Your location will be sent automatically."}</p>
            <Btn variant="sos" className="h-24 w-48 text-xl rounded-3xl" onClick={() => {
              if (!currentUser) return;
              setSosActive(true);
              void startEmergencySound();
              setEmergencyActive(true);
              navigator.geolocation?.getCurrentPosition(pos => {
                const address = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
                const sos: SOSEvent = { id: `sos-${Date.now()}`, guardId: currentUser.id, guardName: currentUser.name, time: nowStamp(), address, resolved: false };
                const sosAlert: AlertLog = { id: `sos-alert-${Date.now()}`, status: "🚨 SOS EMERGENCY", target: "Everyone", text: `SOS من ${currentUser.name} — ${address}`, sender: currentUser.name, time: nowStamp(), severity: "critical" };
                mutate(prev => ({ ...prev, sosEvents: [sos, ...prev.sosEvents], alerts: [sosAlert, ...prev.alerts] }));
                void saveSOSEvent(sos); void saveAlert(sosAlert);
                void sendPushViaWorker("🚨 SOS EMERGENCY", `${currentUser.name} — ${address}`, "sos");
                showToast(language === "ar" ? "🚨 تم إرسال SOS" : "🚨 SOS Sent", "danger");
              }, () => {
                const sos: SOSEvent = { id: `sos-${Date.now()}`, guardId: currentUser.id, guardName: currentUser.name, time: nowStamp(), address: "Location unavailable", resolved: false };
                mutate(prev => ({ ...prev, sosEvents: [sos, ...prev.sosEvents] }));
                void saveSOSEvent(sos);
                void sendPushViaWorker("🚨 SOS", currentUser.name, "sos");
                showToast("🚨 SOS Sent", "danger");
              });
            }}>SOS 🚨</Btn>
            {sosActive && (
              <Btn variant="secondary" onClick={() => { stopEmergencySound(); setEmergencyActive(false); setSosActive(false); showToast(language === "ar" ? "تم إيقاف SOS" : "SOS stopped", "info"); }}>
                🔇 {language === "ar" ? "إيقاف SOS" : "Stop SOS"}
              </Btn>
            )}
          </div>
        </Panel>
      )}

      {/* SOS Events log */}
      <Panel>
        <div className="mb-3 font-black text-white">{language === "ar" ? "سجل أحداث SOS" : "SOS Events Log"}</div>
        {mergedSOSEvents.length === 0
          ? <EmptyMsg title={language === "ar" ? "لا أحداث" : "No SOS Events"} text={language === "ar" ? "لم يُبلَّغ عن أي حوادث" : "No SOS events reported"} />
          : mergedSOSEvents.map(s => (
            <div key={s.id} className={`mb-3 rounded-2xl border p-4 ${s.resolved ? "border-emerald-500/10 bg-emerald-500/5" : "border-red-500/30 bg-red-500/10 animate-pulse"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-black text-white">{s.guardName}</div>
                  <div className="text-sm text-slate-400 mt-1">{s.address}</div>
                  <div className="text-xs text-slate-500">{formatTime(s.time, use24h)}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge className={s.resolved ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                    {s.resolved ? (language === "ar" ? "✅ محلول" : "✅ Resolved") : (language === "ar" ? "🚨 نشط" : "🚨 Active")}
                  </Badge>
                  {!s.resolved && (isOwner || isAdmin) && (
                    <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                      mutate(prev => ({ ...prev, sosEvents: prev.sosEvents.map(x => x.id === s.id ? { ...x, resolved: true } : x) }));
                      void updateSOSEventRemote(s.id, { resolved: true });
                      stopEmergencySound(); setEmergencyActive(false);
                      showToast(language === "ar" ? "✅ تم حل SOS" : "✅ SOS Resolved", "success");
                    }}>{language === "ar" ? "حل" : "Resolve"}</Btn>
                  )}
                </div>
              </div>
            </div>
          ))
        }
      </Panel>
    </div>
  );

    const renderShifts = () => {
    const todayStr = today();
    const todayMorning = mergedShifts.filter(s => s.date === todayStr && s.startTime === "04:00" && s.endTime === "16:00");
    const todayEvening = mergedShifts.filter(s => s.date === todayStr && s.startTime === "16:00");
    const myShifts = isGuard && currentUser ? mergedShifts.filter(s => s.guardId === currentUser.id) : mergedShifts;

    return (
      <div className="space-y-6">
        <SectionHead title={language === "ar" ? "إدارة النوبات" : "Shift Management"} />

        {/* Today overview - owner/admin */}
        {!isGuard && (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Morning shift */}
            <Panel>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-2xl">☀️</span>
                <div>
                  <div className="font-black text-amber-300">{language === "ar" ? "الشفت الصباحي" : "Morning Shift"}</div>
                  <div className="text-xs text-slate-400">4:00 AM → 4:00 PM</div>
                </div>
              </div>
              {todayMorning.length === 0
                ? <div className="text-sm text-slate-500">{language === "ar" ? "لا نوبات صباحية اليوم" : "No morning shifts today"}</div>
                : todayMorning.map(s => {
                  const attToday = mergedAttendance.find(a => a.userId === s.guardId && a.time.startsWith(todayStr));
                  const b = snapshot.buildings.find(x => x.id === s.buildingId);
                  return (
                    <div key={s.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                      <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${attToday ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                      <div className="flex-1">
                        <div className="font-bold text-white text-sm">{s.guardName}</div>
                        <div className="text-xs text-slate-400">{b ? (language === "ar" ? b.nameAr : b.nameEn) : "—"}</div>
                      </div>
                      <Badge className={attToday ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-slate-400/30 bg-slate-500/15 text-slate-400"}>
                        {attToday ? (language === "ar" ? "🟢 حاضر" : "🟢 Present") : (language === "ar" ? "⭕ غائب" : "⭕ Absent")}
                      </Badge>
                    </div>
                  );
                })
              }
            </Panel>

            {/* Evening shift */}
            <Panel>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-2xl">🌙</span>
                <div>
                  <div className="font-black text-sky-300">{language === "ar" ? "الشفت المسائي" : "Evening Shift"}</div>
                  <div className="text-xs text-slate-400">4:00 PM → 4:00 AM <span className="text-amber-400">(±1h)</span></div>
                </div>
              </div>
              {/* Roles breakdown */}
              <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400 space-y-1">
                <div>👥 2 {language === "ar" ? "حراس على البوابة" : "guards at gate"}</div>
                <div>🚶 1 {language === "ar" ? "حارس دورية" : "guard on patrol"}</div>
                <div className="text-amber-400">⚠️ {language === "ar" ? "التوقيت مرن ±1 ساعة بسبب الباصات" : "Flexible timing ±1h (bus schedule)"}</div>
              </div>
              {todayEvening.length === 0
                ? <div className="text-sm text-slate-500">{language === "ar" ? "لا نوبات مسائية اليوم" : "No evening shifts today"}</div>
                : todayEvening.map(s => {
                  const isGate = s.buildingId === "gate-1" || s.buildingId === "gate-2";
                  return (
                    <div key={s.id} className="mb-2 flex items-center gap-3 rounded-2xl border border-sky-500/10 bg-sky-500/5 p-3">
                      <span className="text-lg">{isGate ? "🚪" : "🚶"}</span>
                      <div className="flex-1">
                        <div className="font-bold text-white text-sm">{s.guardName}</div>
                        <div className="text-xs text-slate-400">{isGate ? (language === "ar" ? "بوابة" : "Gate") : (language === "ar" ? "دورية" : "Patrol")}</div>
                      </div>
                      <Badge className="border-sky-400/30 bg-sky-500/15 text-sky-300">{s.startTime}</Badge>
                    </div>
                  );
                })
              }
            </Panel>
          </div>
        )}

        {/* Add shift form - owner/admin */}
        {(isOwner || isAdmin) && (
          <Panel>
            <div className="mb-4 font-black text-white">+ {language === "ar" ? "إضافة نوبة" : "Add Shift"}</div>
            <form onSubmit={e => { e.preventDefault(); }} className="space-y-4">
              {/* Shift type */}
              <div>
                <Lbl>{language === "ar" ? "نوع الشفت" : "Shift Type"}</Lbl>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: "morning", label: language === "ar" ? "☀️ صباحي (4ص-4م)" : "☀️ Morning (4AM-4PM)" },
                    { key: "evening", label: language === "ar" ? "🌙 مسائي (4م-4ص)" : "🌙 Evening (4PM-4AM)" },
                  ] as const).map(({ key, label }) => (
                    <button key={key} type="button" onClick={() => setShiftForm(p => ({ ...p, shiftType: key }))}
                      className={`rounded-2xl border p-3 text-sm font-bold transition ${shiftForm.shiftType === key ? (key === "morning" ? "border-amber-400/40 bg-amber-500/10 text-amber-200 scale-105" : "border-sky-400/40 bg-sky-500/10 text-sky-200 scale-105") : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Evening role */}
              {shiftForm.shiftType === "evening" && (
                <div>
                  <Lbl>{language === "ar" ? "الدور في الشفت المسائي" : "Evening Role"}</Lbl>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setShiftForm(p => ({ ...p, eveningRole: "gate" }))}
                      className={`rounded-2xl border p-3 text-sm font-bold transition ${shiftForm.eveningRole === "gate" ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200 scale-105" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                      🚪 {language === "ar" ? "بوابة" : "Gate"}
                    </button>
                    <button type="button" onClick={() => setShiftForm(p => ({ ...p, eveningRole: "patrol" }))}
                      className={`rounded-2xl border p-3 text-sm font-bold transition ${shiftForm.eveningRole === "patrol" ? "border-purple-400/40 bg-purple-500/10 text-purple-200 scale-105" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                      🚶 {language === "ar" ? "دورية" : "Patrol"}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Lbl>{language === "ar" ? "الحارس" : "Guard"}</Lbl>
                  <SelInput required value={shiftForm.guardId} onChange={e => setShiftForm(p => ({ ...p, guardId: e.target.value }))}>
                    <option value="">{language === "ar" ? "— اختر الحارس —" : "— Select guard —"}</option>
                    {guardUsers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </SelInput>
                </div>

                {/* Morning: show assigned building or override */}
                {shiftForm.shiftType === "morning" && shiftForm.guardId && (
                  <div>
                    <Lbl>{language === "ar" ? "المبنى المخصص" : "Assigned Building"}</Lbl>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
                      {formatBuilding(snapshot.buildings.find(b => b.id === approvedUsers.find(u => u.id === shiftForm.guardId)?.assignedBuildingId), language) || (language === "ar" ? "— لا يوجد مبنى مخصص —" : "— No building assigned —")}
                    </div>
                  </div>
                )}

                <div>
                  <Lbl>{language === "ar" ? "التاريخ" : "Date"}</Lbl>
                  <TxtInput type="date" required value={shiftForm.date} onChange={e => setShiftForm(p => ({ ...p, date: e.target.value }))} />
                </div>
              </div>

              <div>
                <Lbl>{language === "ar" ? "ملاحظات (اختياري)" : "Notes (optional)"}</Lbl>
                <TxtInput value={shiftForm.notes} onChange={e => setShiftForm(p => ({ ...p, notes: e.target.value }))} placeholder={language === "ar" ? "مثال: تأخر متوقع بسبب الباص..." : "e.g. Expected delay due to bus..."} />
              </div>

              <Btn type="submit" className="w-full h-12">{language === "ar" ? "✅ إضافة النوبة" : "✅ Add Shift"}</Btn>
            </form>
          </Panel>
        )}

        {/* Shift list */}
        <Panel>
          <div className="mb-3 font-black text-white">{language === "ar" ? "جدول النوبات" : "Shift Schedule"}</div>
          {(isGuard ? myShifts : mergedShifts).length === 0
            ? <EmptyMsg title={language === "ar" ? "لا نوبات" : "No Shifts"} text="" />
            : (isGuard ? myShifts : mergedShifts).slice().sort((a,b) => b.date.localeCompare(a.date)).slice(0, 30).map(s => {
              const isMorn = s.startTime === "04:00" && s.endTime === "16:00";
              const isEve = s.startTime === "16:00";
              const isGate = s.buildingId === "gate-1" || s.buildingId === "gate-2";
              const b = snapshot.buildings.find(x => x.id === s.buildingId);
              return (
                <div key={s.id} className={`mb-2 flex flex-wrap items-start justify-between gap-3 rounded-2xl border p-4 ${isMorn ? "border-amber-500/20 bg-amber-500/5" : "border-sky-500/20 bg-sky-500/5"}`}>
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{isMorn ? "☀️" : isGate ? "🌙🚪" : "🌙🚶"}</span>
                    <div>
                      <div className="font-black text-white">{s.guardName}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        📅 {s.date} · {s.startTime} → {s.endTime}
                        {isEve && <span className="text-amber-400 ms-1">±1h</span>}
                      </div>
                      {s.notes && <div className="text-xs text-slate-500 mt-1 italic">{s.notes}</div>}
                      {b && <div className="text-xs text-slate-400 mt-0.5">📍 {language === "ar" ? b.nameAr : b.nameEn}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={isMorn ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-sky-400/30 bg-sky-500/15 text-sky-300"}>
                      {isMorn ? (language === "ar" ? "صباحي" : "Morning") : isGate ? (language === "ar" ? "مسائي · بوابة" : "Evening · Gate") : (language === "ar" ? "مسائي · دورية" : "Evening · Patrol")}
                    </Badge>
                    {(isOwner || isAdmin) && (
                      <Btn variant="danger" className="h-7 px-2 text-xs" onClick={() => {
                        mutate(prev => ({ ...prev, shifts: prev.shifts.filter(x => x.id !== s.id) }));
                      }}>✕</Btn>
                    )}
                  </div>
                </div>
              );
            })
          }
        </Panel>
      </div>
    );
  };

    const renderScores = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead title={language === "ar" ? "تقييم الحراس" : "Guard Ratings"} subtitle={language === "ar" ? "نقاط تلقائية" : "Auto-calculated"} />
        {isOwner && (
          <Btn variant="secondary" onClick={() => exportFullExcel(mergedAttendance, mergedReports, approvedUsers, snapshot.buildings)}>
            📊 {language === "ar" ? "تصدير Excel كامل" : "Export Full Excel"}
          </Btn>
        )}
      </div>

      {/* Export buttons */}
      {(isOwner || isAdmin) && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Btn variant="secondary" className="h-12" onClick={() => exportAttendanceExcel(mergedAttendance, approvedUsers, snapshot.buildings)}>
            📥 {language === "ar" ? "Excel الحضور" : "Attendance Excel"}
          </Btn>
          <Btn variant="secondary" className="h-12" onClick={() => exportReportsExcel(mergedReports, snapshot.buildings)}>
            📥 {language === "ar" ? "Excel التقارير" : "Reports Excel"}
          </Btn>
          <Btn variant="secondary" className="h-12" onClick={() => exportFullExcel(mergedAttendance, mergedReports, approvedUsers, snapshot.buildings)}>
            📥 {language === "ar" ? "Excel الكامل" : "Full Excel"}
          </Btn>
        </div>
      )}

      {/* Score formula */}
      <Panel>
        <div className="mb-3 font-black text-white">{language === "ar" ? "نظام النقاط" : "Scoring System"}</div>
        <div className="grid gap-2 sm:grid-cols-3 text-center text-sm">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="text-2xl font-black text-emerald-400">+10</div>
            <div className="text-slate-400 mt-1">{language === "ar" ? "لكل يوم حضور" : "per attendance day"}</div>
          </div>
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-3">
            <div className="text-2xl font-black text-sky-400">+5</div>
            <div className="text-slate-400 mt-1">{language === "ar" ? "لكل تقرير" : "per report"}</div>
          </div>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
            <div className="text-2xl font-black text-red-400">-15</div>
            <div className="text-slate-400 mt-1">{language === "ar" ? "لكل مخالفة" : "per violation"}</div>
          </div>
        </div>
      </Panel>

      {/* Leaderboard */}
      <Panel>
        <div className="mb-4 font-black text-white">🏆 {language === "ar" ? "ترتيب الحراس" : "Guard Leaderboard"}</div>
        <div className="space-y-3">
          {guardUsers
            .map(g => ({ ...g, ...calcGuardScore(g.id) }))
            .sort((a, b) => b.score - a.score)
            .map((g, idx) => {
              const building = snapshot.buildings.find(b => b.id === g.assignedBuildingId);
              return (
                <div key={g.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${idx === 0 ? "border-amber-400/40 bg-amber-500/10" : idx === 1 ? "border-slate-400/20 bg-slate-500/5" : "border-white/10 bg-white/5"}`}>
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl text-lg font-black ${idx === 0 ? "bg-amber-500 text-black" : idx === 1 ? "bg-slate-500 text-white" : "bg-white/10 text-slate-400"}`}>
                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx + 1}`}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-black text-white">{g.name}</div>
                    <div className="text-xs text-slate-400">{building ? (language === "ar" ? building.nameAr : building.nameEn) : "—"}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      🟢 {g.breakdown.att}{language === "ar" ? "ن (حضور)" : "pts (att)"} ·
                      📋 {g.breakdown.rep}{language === "ar" ? "ن (تقارير)" : "pts (rep)"} ·
                      {g.breakdown.viol > 0 && <span className="text-red-400"> -{g.breakdown.viol}{language === "ar" ? "ن (مخالفات)" : "pts (viol)"}</span>}
                    </div>
                  </div>
                  <div className="text-end flex-shrink-0">
                    <div className="text-2xl font-black text-amber-400">{g.score}</div>
                    <div className="text-sm">{"⭐".repeat(g.stars)}</div>
                  </div>
                </div>
              );
            })}
          {guardUsers.length === 0 && <EmptyMsg title={language === "ar" ? "لا حراس" : "No guards"} text="" />}
        </div>
      </Panel>
    </div>
  );

  const renderPatrol = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "جدول الجولات الأمنية" : "Security Patrol Schedule"} />

      {/* Guard: my assigned route */}
      {isGuard && currentUser && (() => {
        // Merge remote (Firebase) + local routes, deduplicate by id
      const allRoutes = [...remotePatrolRoutes, ...patrolRoutes]
        .filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
        .filter(r => r.sentToGuard === true);  // Guard only sees routes sent to them
      const myRoute = allRoutes.find(r =>
        (r.assignedGuardId === currentUser.id || r.assignedGuardId === currentUser.email) &&
        r.active !== false
      );
        return myRoute ? (
          <Panel className="border-amber-400/20">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-black text-amber-300 text-lg">{language === "ar" ? myRoute.nameAr : myRoute.name}</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {myRoute.scheduleTime && `🕐 ${myRoute.scheduleTime} · `}
                  {myRoute.buildingIds.length} {language === "ar" ? "نقطة تفتيش" : "checkpoints"}
                </div>
                {myRoute.notes && <div className="text-xs text-slate-500 mt-1 italic">{myRoute.notes}</div>}
              </div>
              <Btn onClick={() => startPatrol(myRoute)}>
                🚶 {language === "ar" ? "ابدأ الجولة" : "Start Patrol"}
              </Btn>
            </div>
            <div className="flex flex-wrap gap-2">
              {myRoute.buildingIds.map((bId, i) => {
                const b = snapshot.buildings.find(x => x.id === bId);
                return (
                  <span key={bId} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
                    {i + 1}. {b ? (language === "ar" ? b.nameAr : b.nameEn) : bId}
                  </span>
                );
              })}
            </div>
          </Panel>
        ) : (
          <Panel>
            <div className="text-center py-4 text-slate-500">
              <div className="text-3xl mb-2">🚶</div>
              <div>{language === "ar" ? "لا يوجد مسار مخصص لك حالياً" : "No patrol route assigned to you yet"}</div>
            </div>
          </Panel>
        );
      })()}

      {/* Active patrol progress */}
      {isGuard && activePatrol && (
        <Panel className="border-emerald-500/30">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-black text-emerald-300">🚶 {language === "ar" ? "جولة نشطة" : "Active Patrol"}</div>
            <div className="text-xs text-slate-400">{activePatrol.startedAt}</div>
          </div>
          <div className="space-y-2">
            {activePatrol.checkpoints.map((cp, i) => {
              const isNext = i === activePatrol.checkpoints.findIndex(x => !x.scannedAt);
              return (
                <div key={cp.buildingId} className={`flex items-center gap-3 rounded-2xl border p-3 ${cp.scannedAt ? "border-emerald-500/30 bg-emerald-500/10" : isNext ? "border-amber-400/40 bg-amber-500/10" : "border-white/10 bg-white/5"}`}>
                  <span className="text-xl flex-shrink-0">{cp.scannedAt ? "✅" : isNext ? "📍" : "⭕"}</span>
                  <div className="flex-1">
                    <div className="font-bold text-white text-sm">{cp.order}. {cp.buildingName}</div>
                    {cp.scannedAt && <div className="text-xs text-emerald-400">{cp.scannedAt.split(" ")[1]}</div>}
                  </div>
                  {isNext && (
                    <Btn className="h-8 px-3 text-xs" onClick={() => { setQrContext("patrol"); setQrModalOpen(true); }}>
                      📷 QR
                    </Btn>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-slate-500 text-center">
            {activePatrol.checkpoints.filter(c => c.scannedAt).length}/{activePatrol.checkpoints.length} {language === "ar" ? "نقطة مكتملة" : "completed"}
          </div>
        </Panel>
      )}

      {/* Other available routes for guard */}
      {isGuard && !activePatrol && (
        <Panel>
          <div className="mb-3 font-black text-white">{language === "ar" ? "مسارات متاحة" : "Available Routes"}</div>
          {(() => {
            const allRoutes = [...remotePatrolRoutes, ...patrolRoutes.filter(r => !remotePatrolRoutes.some(x => x.id === r.id))];
            return allRoutes;
          })().filter(r => r.active).length === 0
            ? <div className="text-sm text-slate-500 text-center py-2">{language === "ar" ? "لا مسارات نشطة" : "No active routes"}</div>
            : [...remotePatrolRoutes, ...patrolRoutes.filter(r => !remotePatrolRoutes.some(x => x.id === r.id))].filter(r => r.active).map(r => (
              <div key={r.id} className="mb-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-3">
                <div>
                  <div className="font-bold text-white">{language === "ar" ? r.nameAr : r.name}</div>
                  <div className="text-xs text-slate-400">{r.buildingIds.length} {language === "ar" ? "نقطة" : "points"}{r.scheduleTime ? ` · ${r.scheduleTime}` : ""}</div>
                </div>
                <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => startPatrol(r)}>▶ {language === "ar" ? "بدء" : "Start"}</Btn>
              </div>
            ))
          }
        </Panel>
      )}

      {/* Owner/Admin: route management table */}
      {(isOwner || isAdmin) && (
        <>
          <Panel>
            <div className="mb-4 flex items-center justify-between">
              <div className="font-black text-white">📋 {language === "ar" ? "جدول المسارات الدائم" : "Permanent Route Schedule"}</div>
              <Btn onClick={() => setShowCreateRoute(p => !p)}>
                {showCreateRoute ? (language === "ar" ? "إلغاء" : "Cancel") : ("+ " + (language === "ar" ? "مسار جديد" : "New Route"))}
              </Btn>
            </div>

            {/* Create route form */}
            {showCreateRoute && (
              <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4 space-y-4">
                <div className="font-black text-amber-300">{language === "ar" ? "إنشاء مسار جديد" : "Create New Route"}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Lbl>{language === "ar" ? "اسم المسار (عربي)" : "Name (Arabic)"}</Lbl><TxtInput value={newRouteName.ar} onChange={e => setNewRouteName(p => ({ ...p, ar: e.target.value }))} /></div>
                  <div><Lbl>{language === "ar" ? "اسم المسار (English)" : "Name (English)"}</Lbl><TxtInput value={newRouteName.en} onChange={e => setNewRouteName(p => ({ ...p, en: e.target.value }))} /></div>
                  <div><Lbl>{language === "ar" ? "الحارس المخصص" : "Assigned Guard"}</Lbl>
                    <SelInput value={newRouteGuardId} onChange={e => setNewRouteGuardId(e.target.value)}>
                      <option value="">{language === "ar" ? "— اختياري —" : "— Optional —"}</option>
                      {guardUsers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </SelInput>
                  </div>
                  <div><Lbl>{language === "ar" ? "وقت الجولة" : "Patrol Time"}</Lbl>
                    <TxtInput type="time" value={newRouteTime} onChange={e => setNewRouteTime(e.target.value)} placeholder="22:00" />
                  </div>
                  <div className="sm:col-span-2"><Lbl>{language === "ar" ? "ملاحظات" : "Notes"}</Lbl>
                    <TxtInput value={newRouteNotes} onChange={e => setNewRouteNotes(e.target.value)} placeholder={language === "ar" ? "مثال: جولة ليلية..." : "e.g. Night patrol..."} />
                  </div>
                </div>
                <div>
                  <Lbl>{language === "ar" ? "نقاط التفتيش (بالترتيب)" : "Checkpoints (in order)"}</Lbl>
                  <div className="max-h-40 overflow-y-auto space-y-1 mt-2">
                    {snapshot.buildings.map(b => {
                      const idx = selectedRouteBuildings.indexOf(b.id);
                      return (
                        <button key={b.id} type="button" onClick={() => setSelectedRouteBuildings(prev => prev.includes(b.id) ? prev.filter(x => x !== b.id) : [...prev, b.id])}
                          className={`w-full rounded-xl border px-3 py-2 text-sm text-start transition ${idx >= 0 ? "border-amber-400/40 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                          {idx >= 0 && <span className="font-black me-2">{idx + 1}.</span>}
                          {language === "ar" ? b.nameAr : b.nameEn}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Btn className="w-full" onClick={() => {
                  if (!newRouteName.ar.trim() || selectedRouteBuildings.length < 1) {
                    showToast(language === "ar" ? "أدخل الاسم واختر نقطة واحدة على الأقل" : "Enter name and select at least 1 checkpoint", "danger"); return;
                  }
                  const guard = newRouteGuardId ? guardUsers.find(g => g.id === newRouteGuardId) : undefined;
                  const route: PatrolRoute = {
                    id: `route-${Date.now()}`, name: newRouteName.en.trim() || newRouteName.ar.trim(),
                    nameAr: newRouteName.ar.trim(), buildingIds: selectedRouteBuildings,
                    createdBy: currentUser?.id ?? "", active: true,
                    assignedGuardId: guard?.id, assignedGuardName: guard?.name,
                    scheduleTime: newRouteTime || undefined, notes: newRouteNotes || undefined,
                  };
                  setPatrolRoutes(prev => [...prev, route]);
                  // Save to Firebase + notify assigned guard
                  (async () => {
                    try {
                      const { setDoc, doc } = await import("firebase/firestore");
                      const { firestore } = await import("./services/firebase");
                      await setDoc(doc(firestore, "patrol_routes", route.id), route);
                      // Send push notification to assigned guard
                      if (route.assignedGuardId && route.assignedGuardName) {
                        void sendPushViaWorker(
                          language === "ar" ? `🚶 مسار جولة جديد: ${route.nameAr}` : `🚶 New Patrol Route: ${route.name}`,
                          language === "ar"
                            ? `تم تخصيص مسار جولة لك${route.scheduleTime ? ` · ${route.scheduleTime}` : ""}`
                            : `A patrol route has been assigned to you${route.scheduleTime ? ` · ${route.scheduleTime}` : ""}`,
                          "task",
                          route.assignedGuardId
                        );
                      }
                    } catch { /* offline - local only */ }
                  })();
                  setNewRouteName({ ar: "", en: "" }); setSelectedRouteBuildings([]);
                  setNewRouteGuardId(""); setNewRouteTime(""); setNewRouteNotes("");
                  setShowCreateRoute(false);
                  showToast(language === "ar" ? "✅ تم إنشاء المسار وإشعار الحارس" : "✅ Route created and guard notified", "success");
                }}>{language === "ar" ? "✅ إنشاء المسار" : "✅ Create Route"}</Btn>
              </div>
            )}

            {/* Routes table */}
            {(() => {
              const allRoutesTable = [...remotePatrolRoutes, ...patrolRoutes.filter(r => !remotePatrolRoutes.some(x => x.id === r.id))];
              return allRoutesTable.length === 0
                ? <div className="text-center py-6 text-slate-500">{language === "ar" ? "لا مسارات بعد — أضف مسارك الأول" : "No routes yet — create your first route"}</div>
                : <div className="space-y-3">
                  {allRoutesTable.map(r => {
                    const guard = r.assignedGuardId ? guardUsers.find(g => g.id === r.assignedGuardId) : null;
                    const isEditing = editRouteId === r.id;
                    return (
                      <div key={r.id} className={`rounded-2xl border p-4 ${r.active ? "border-white/10 bg-white/5" : "border-white/5 bg-white/3 opacity-60"}`}>
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div><Lbl>{language === "ar" ? "الاسم (عربي)" : "Name (AR)"}</Lbl><TxtInput defaultValue={r.nameAr} id={`edit-name-ar-${r.id}`} /></div>
                              <div><Lbl>{language === "ar" ? "الاسم (EN)" : "Name (EN)"}</Lbl><TxtInput defaultValue={r.name} id={`edit-name-en-${r.id}`} /></div>
                              <div><Lbl>{language === "ar" ? "الحارس المخصص" : "Assigned Guard"}</Lbl>
                                <SelInput defaultValue={r.assignedGuardId ?? ""} id={`edit-guard-${r.id}`}>
                                  <option value="">{language === "ar" ? "— بدون تخصيص —" : "— Unassigned —"}</option>
                                  {guardUsers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </SelInput>
                              </div>
                              <div><Lbl>{language === "ar" ? "وقت الجولة" : "Patrol Time"}</Lbl>
                                <TxtInput type="time" defaultValue={r.scheduleTime ?? ""} id={`edit-time-${r.id}`} />
                              </div>
                              <div className="sm:col-span-2"><Lbl>{language === "ar" ? "ملاحظات" : "Notes"}</Lbl>
                                <TxtInput defaultValue={r.notes ?? ""} id={`edit-notes-${r.id}`} />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Btn className="flex-1" onClick={() => {
                                const nameAr = (document.getElementById(`edit-name-ar-${r.id}`) as HTMLInputElement)?.value || r.nameAr;
                                const nameEn = (document.getElementById(`edit-name-en-${r.id}`) as HTMLInputElement)?.value || r.name;
                                const guardId = (document.getElementById(`edit-guard-${r.id}`) as HTMLSelectElement)?.value;
                                const time = (document.getElementById(`edit-time-${r.id}`) as HTMLInputElement)?.value;
                                const notes = (document.getElementById(`edit-notes-${r.id}`) as HTMLInputElement)?.value;
                                const guard = guardId ? guardUsers.find(g => g.id === guardId) : undefined;
                                const updatedRoute = { ...r, nameAr, name: nameEn, assignedGuardId: guard?.id, assignedGuardName: guard?.name, scheduleTime: time || undefined, notes: notes || undefined };
                                setPatrolRoutes(prev => prev.map(x => x.id === r.id ? updatedRoute : x));
                                (async () => {
                                  try {
                                    const { setDoc, doc } = await import("firebase/firestore");
                                    const { firestore } = await import("./services/firebase");
                                    await setDoc(doc(firestore, "patrol_routes", r.id), updatedRoute);
                                  } catch { }
                                })();
                                setEditRouteId(null);
                                showToast(language === "ar" ? "✅ تم التحديث" : "✅ Updated", "success");
                              }}>{language === "ar" ? "💾 حفظ" : "💾 Save"}</Btn>
                              <Btn variant="secondary" onClick={() => setEditRouteId(null)}>{language === "ar" ? "إلغاء" : "Cancel"}</Btn>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <div className="font-black text-white">{language === "ar" ? r.nameAr : r.name}</div>
                                {!r.active && <Badge className="border-slate-400/30 bg-slate-500/15 text-slate-400 text-xs">{language === "ar" ? "معطّل" : "Inactive"}</Badge>}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
                                {guard && <span>👮 {guard.name}</span>}
                                {r.scheduleTime && <span>🕐 {r.scheduleTime}</span>}
                                <span>📍 {r.buildingIds.length} {language === "ar" ? "نقطة" : "pts"}</span>
                                {r.notes && <span className="italic">{r.notes}</span>}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {r.buildingIds.map((bId, i) => {
                                  const b = snapshot.buildings.find(x => x.id === bId);
                                  return <span key={bId} className="rounded-lg border border-white/10 px-2 py-0.5 text-xs text-slate-400">{i+1}. {b ? (language === "ar" ? b.nameAr : b.nameEn) : bId}</span>;
                                })}
                              </div>
                            </div>
                            <div className="flex gap-2 flex-shrink-0">
                              <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => setEditRouteId(r.id)}>✏️ {language === "ar" ? "تعديل" : "Edit"}</Btn>
                              <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => { setPatrolRoutes(prev => prev.map(x => x.id === r.id ? { ...x, active: !x.active } : x)); showToast(r.active ? (language === "ar" ? "تم إيقاف المسار" : "Route deactivated") : (language === "ar" ? "تم تفعيل المسار" : "Route activated"), "info"); }}>
                                {r.active ? (language === "ar" ? "إيقاف" : "Disable") : (language === "ar" ? "تفعيل" : "Enable")}
                              </Btn>
                              <Btn variant="danger" className="h-8 px-3 text-xs" onClick={async () => {
                              setPatrolRoutes(prev => prev.filter(x => x.id !== r.id));
                              try {
                                const { deleteDoc, doc } = await import("firebase/firestore");
                                const { firestore } = await import("./services/firebase");
                                await deleteDoc(doc(firestore, "patrol_routes", r.id));
                              } catch { }
                              showToast(language === "ar" ? "تم الحذف" : "Deleted", "info");
                            }}>🗑</Btn>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>;
            })()}
          </Panel>
        </>
      )}
    </div>
  );

    const renderMap = () => (
    <div className="space-y-4">
      <SectionHead title={language === "ar" ? "الخريطة" : "Map"} />
      <Panel>
        <div className="overflow-hidden rounded-2xl" style={{ height: 420 }}>
          <iframe title="map" width="100%" height="100%" style={{ border: 0 }}
            src="https://www.openstreetmap.org/export/embed.html?bbox=51.48%2C25.25%2C51.56%2C25.32&layer=mapnik&marker=25.2854%2C51.5310" />
        </div>
      </Panel>
    </div>
  );

  const renderAnalytics = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "التحليلات الذكية" : "Smart Analytics"} />
      <Panel>
        <div className="mb-4 font-black text-white">{language === "ar" ? "التشخيص الذكي" : "AI Insights"}</div>
        <div className="space-y-3">
          {insights.map((ins, i) => (
            <div key={i} className={`rounded-2xl border p-4 ${ins.type === "critical" ? "border-red-500/30 bg-red-500/10" : ins.type === "warning" ? "border-amber-500/30 bg-amber-500/10" : "border-sky-500/30 bg-sky-500/10"}`}>
              <div className="font-black text-white">{language === "ar" ? ins.titleAr : ins.title}</div>
              <div className="mt-1 text-sm text-slate-300">{language === "ar" ? ins.bodyAr : ins.body}</div>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Panel><div className="mb-2 text-sm text-slate-400">{language === "ar" ? "تقارير طبيعية" : "Normal Reports"}</div><div className="text-4xl font-black text-emerald-400">{snapshot.reports.filter(r => r.status === "normal").length}</div></Panel>
        <Panel><div className="mb-2 text-sm text-slate-400">{language === "ar" ? "تقارير تحذير" : "Warning Reports"}</div><div className="text-4xl font-black text-amber-400">{mergedReports.filter(r => r.status === "warning").length}</div></Panel>
        <Panel><div className="mb-2 text-sm text-slate-400">{language === "ar" ? "تقارير حرجة" : "Critical Reports"}</div><div className="text-4xl font-black text-red-400">{mergedReports.filter(r => r.status === "critical").length}</div></Panel>
        <Panel><div className="mb-2 text-sm text-slate-400">{language === "ar" ? "نوبات مكتملة" : "Completed Shifts"}</div><div className="text-4xl font-black text-sky-400">{mergedShifts.filter(s => s.status === "completed").length}</div></Panel>
        <Panel><div className="mb-2 text-sm text-slate-400">{language === "ar" ? "مجموع المخالفات" : "Total Violations"}</div><div className="text-4xl font-black text-amber-400">{mergedViolations.length}</div></Panel>
        <Panel><div className="mb-2 text-sm text-slate-400">{language === "ar" ? "زوار وصلوا" : "Arrived Visitors"}</div><div className="text-4xl font-black text-emerald-400">{mergedVisitors.filter(v => v.status === "arrived").length}</div></Panel>
      </div>
      <Btn variant="secondary" onClick={() => { try { exportFullDashboardPDF(snapshot, APP_NAME); showToast(language === "ar" ? "تم تصدير PDF" : "PDF exported"); } catch { showToast("PDF failed", "danger"); } }}>📄 {language === "ar" ? "تصدير تقرير شامل PDF" : "Export Full Report PDF"}</Btn>
    </div>
  );

  const saveReportEdit = (reportId: string) => {
    if (!currentUser) return;
    mutate(prev => ({
      ...prev,
      reports: prev.reports.map(r => r.id === reportId
        ? { ...r, text: sanitize(editReportForm.text), status: editReportForm.status, editedAt: nowStamp() }
        : r
      ),
    }), language === "ar" ? "✅ تم تعديل التقرير" : "✅ Report updated");
    void saveReport({ ...mergedReports.find(r => r.id === reportId)!, text: sanitize(editReportForm.text), status: editReportForm.status, editedAt: nowStamp() });
    setEditReportId(null);
  };

  const addComment = (reportId: string) => {
    if (!currentUser || !commentText.trim()) return;
    const comment: ReportComment = {
      id: `cmt-${Date.now()}`, authorId: currentUser.id,
      authorName: currentUser.name, text: commentText.trim(), time: nowStamp(),
    };
    mutate(prev => ({
      ...prev,
      reports: prev.reports.map(r => r.id === reportId
        ? { ...r, comments: [...(r.comments ?? []), comment] }
        : r
      ),
    }));
    const rep = mergedReports.find(r => r.id === reportId);
    if (rep) void saveReport({ ...rep, comments: [...(rep.comments ?? []), comment] });
    setCommentingReportId(null);
    setCommentText("");
    showToast(language === "ar" ? "✅ تم إضافة التعليق" : "✅ Comment added", "success");
  };

  const renderReports = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead title={language === "ar" ? "التقارير" : "Reports"} />
        <Btn variant="secondary" onClick={() => { try { exportReportsPDF(visibleReports, approvedUsers, APP_NAME); showToast(language === "ar" ? "تم تصدير PDF" : "PDF exported"); } catch { showToast("PDF failed", "danger"); } }}>📄 PDF</Btn>
      </div>
      {(isGuard || isAdmin || isOwner) && (
        <Panel>
          {/* Camera capture input */}
          <input ref={reportPhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            setReportForm(p => ({ ...p, mediaUrl: dataUrl, mediaKind: "image", fileName: file.name }));
            e.target.value = "";
          }} />
          {/* Gallery upload input */}
          <input ref={reportMediaInputRef} type="file" accept="image/*" className="hidden" onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            setReportForm(p => ({ ...p, mediaUrl: dataUrl, mediaKind: "image", fileName: file.name }));
            e.target.value = "";
          }} />
          {/* Step 1: Building */}
          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${reportScannedBuilding ? "bg-emerald-500 text-white" : "bg-amber-500 text-black"}`}>1</span>
              <Lbl>{language === "ar" ? "المبنى" : "Building"}</Lbl>
            </div>
            {reportScannedBuilding ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <span className="text-2xl">🏢</span>
                <div className="flex-1">
                  <div className="font-black text-emerald-300 text-base">{formatBuilding(snapshot.buildings.find(b => b.id === reportScannedBuilding), language)}</div>
                  <div className="text-xs text-slate-400 mt-0.5">✅ {language === "ar" ? "تم المسح بـ QR" : "Scanned via QR"} · {formatTime(nowStamp(), use24h)}</div>
                </div>
                <button type="button" onClick={() => setReportScannedBuilding("")} className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20">✕</button>
              </div>
            ) : (
              <div className="space-y-2">
                <Btn type="button" className="w-full h-14 text-base" onClick={() => { setQrContext("report"); setQrModalOpen(true); }}>
                  📷 {language === "ar" ? "مسح QR الخاص بالمبنى" : "Scan Building QR Code"}
                </Btn>
                <div className="flex items-center gap-2 my-1">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-xs text-slate-500">{language === "ar" ? "أو اختر يدوياً" : "or select manually"}</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>
                <SelInput value={reportForm.buildingId} onChange={e => setReportForm(p => ({ ...p, buildingId: e.target.value }))}>
                  {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{language === "ar" ? b.nameAr : b.nameEn}</option>)}
                </SelInput>
              </div>
            )}
          </div>

          <form onSubmit={e => { void submitReport(e); }} className="space-y-4">
            {/* Step 2: Status */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-black">2</span>
                <Lbl>{language === "ar" ? "حالة الموقع" : "Site Status"}</Lbl>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(reportStatusLabels) as ReportStatus[]).map(s => (
                  <button key={s} type="button" onClick={() => setReportForm(p => ({ ...p, status: s }))}
                    className={`rounded-2xl border py-3 text-sm font-bold transition ${reportForm.status === s
                      ? s === "critical" ? "border-red-500/50 bg-red-500/15 text-red-200 scale-105"
                        : s === "warning" ? "border-amber-500/50 bg-amber-500/15 text-amber-200 scale-105"
                        : "border-emerald-500/50 bg-emerald-500/15 text-emerald-200 scale-105"
                      : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                    {s === "normal" ? "🟢 " : s === "warning" ? "🟡 " : "🔴 "}
                    {pair(language, reportStatusLabels[s])}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Photo */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-black">3</span>
                <Lbl>{language === "ar" ? "إرفاق صورة (اختياري)" : "Attach Photo (optional)"}</Lbl>
              </div>
              {reportForm.mediaUrl ? (
                <div className="relative">
                  <img src={reportForm.mediaUrl} alt="preview" className="max-h-48 w-full rounded-2xl object-cover border border-white/10" />
                  <button type="button" onClick={() => setReportForm(p => ({ ...p, mediaUrl: "", mediaKind: "", fileName: "" }))} className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-500 text-white text-xs font-black">✕</button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => reportPhotoRef.current?.click()}
                    className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 py-5 text-slate-400 hover:border-amber-400/40 hover:bg-white/10 transition">
                    <span className="text-3xl">📸</span>
                    <span className="text-xs font-bold">{language === "ar" ? "التقاط صورة" : "Take Photo"}</span>
                  </button>
                  <button type="button" onClick={() => reportMediaInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 py-5 text-slate-400 hover:border-amber-400/40 hover:bg-white/10 transition">
                    <span className="text-3xl">🖼️</span>
                    <span className="text-xs font-bold">{language === "ar" ? "من المعرض" : "From Gallery"}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Step 4: Comment */}
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-black">4</span>
                <Lbl>{language === "ar" ? "تفاصيل التقرير" : "Report Details"}</Lbl>
              </div>
              <TxtArea rows={4} required value={reportForm.text} onChange={e => setReportForm(p => ({ ...p, text: e.target.value }))} placeholder={language === "ar" ? "اكتب تفاصيل ما تراه في الموقع..." : "Describe what you observe at the site..."} />
            </div>

            {/* Preview */}
            {(reportScannedBuilding || reportForm.buildingId) && reportForm.text.trim() && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-1 text-xs">
                <div className="font-black text-slate-300 text-sm mb-2">👁 {language === "ar" ? "معاينة التقرير" : "Report Preview"}</div>
                <div className="text-slate-400">📍 {formatBuilding(snapshot.buildings.find(b => b.id === (reportScannedBuilding || reportForm.buildingId)), language)}</div>
                <div className="text-slate-400">🕐 {formatTime(nowStamp(), use24h)}</div>
                <div className="text-slate-400">👤 {currentUser?.name}</div>
                <div>{reportForm.status === "normal" ? "🟢" : reportForm.status === "warning" ? "🟡" : "🔴"} {pair(language, reportStatusLabels[reportForm.status])}</div>
                <div className="italic text-slate-300 mt-1">"{reportForm.text.slice(0, 100)}{reportForm.text.length > 100 ? "..." : ""}"</div>
              </div>
            )}

            <Btn type="submit" className="w-full h-14 text-lg font-black">
              📤 {language === "ar" ? "إرسال التقرير" : "Submit Report"}
            </Btn>
          </form>
        </Panel>
      )}
      {/* Hidden file input for adding photo to existing report */}
      <input ref={reportEditPhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => {
        const file = e.target.files?.[0];
        if (!file || !reportAddingPhotoId) return;
        const dataUrl = await fileToDataUrl(file);
        const rep = mergedReports.find(r => r.id === reportAddingPhotoId);
        if (!rep) return;
        const updated = { ...rep, mediaUrl: dataUrl, mediaKind: "image" as const, fileName: file.name };
        mutate(prev => ({ ...prev, reports: prev.reports.map(r => r.id === reportAddingPhotoId ? updated : r) }));
        void saveReport(updated);
        setReportAddingPhotoId(null);
        showToast(language === "ar" ? "✅ تمت إضافة الصورة" : "✅ Photo added", "success");
        e.target.value = "";
      }} />

      <div className="space-y-4">
        {pagedReports.length === 0
          ? <EmptyMsg title={language === "ar" ? "لا تقارير" : "No Reports"} text="" />
          : pagedReports.map(r => {
            const canEdit = isOwner || r.senderId === currentUser?.id;
            const isEditing = editReportId === r.id;
            const isCommenting = commentingReportId === r.id;
            const building = snapshot.buildings.find(b => b.id === r.buildingId);
            return (
              <Panel key={r.id}>
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={getStatusBadgeClass(r.status)}>{pair(language, reportStatusLabels[r.status])}</Badge>
                    <span className="font-black text-white">{r.senderName}</span>
                    {r.editedAt && <span className="text-xs text-slate-500 italic">{language === "ar" ? "معدّل" : "edited"}</span>}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-400">{r.time}</div>
                    {building && <div className="text-xs text-amber-400 mt-0.5">📍 {language === "ar" ? building.nameAr : building.nameEn}</div>}
                  </div>
                </div>

                {/* Edit mode */}
                {isEditing ? (
                  <div className="space-y-3 mb-3">
                    <div className="grid grid-cols-3 gap-2">
                      {(Object.keys(reportStatusLabels) as ReportStatus[]).map(s => (
                        <button key={s} type="button" onClick={() => setEditReportForm(p => ({ ...p, status: s }))}
                          className={`rounded-2xl border py-2 text-xs font-bold transition ${editReportForm.status === s ? getStatusBadgeClass(s) : "border-white/10 bg-white/5 text-slate-400"}`}>
                          {s === "normal" ? "🟢 " : s === "warning" ? "🟡 " : "🔴 "}{pair(language, reportStatusLabels[s])}
                        </button>
                      ))}
                    </div>
                    <TxtArea rows={4} value={editReportForm.text} onChange={e => setEditReportForm(p => ({ ...p, text: e.target.value }))} />
                    <div className="flex gap-2">
                      <Btn className="flex-1" onClick={() => saveReportEdit(r.id)}>{language === "ar" ? "💾 حفظ" : "💾 Save"}</Btn>
                      <Btn variant="secondary" className="flex-1" onClick={() => setEditReportId(null)}>{language === "ar" ? "إلغاء" : "Cancel"}</Btn>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-300 mb-3">{r.text}</p>
                )}

                {/* Photo - thumbnail with lightbox */}
                {r.mediaUrl && r.mediaUrl !== "__local__" && (
                  <div className="mb-3 flex items-start gap-3">
                    <button
                      onClick={() => setLightboxUrl(r.mediaUrl!)}
                      className="group relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-2xl border border-white/10 hover:border-amber-400/50 transition"
                    >
                      <img src={r.mediaUrl} alt="report" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition">
                        <span className="opacity-0 group-hover:opacity-100 text-white text-lg transition">🔍</span>
                      </div>
                    </button>
                    <div className="text-xs text-slate-400 mt-1">اضغط لتكبير الصورة</div>
                  </div>
                )}

                {/* Comments */}
                {(r.comments ?? []).length > 0 && (
                  <div className="mb-3 space-y-2 border-t border-white/10 pt-3">
                    {(r.comments ?? []).map(c => (
                      <div key={c.id} className="rounded-xl bg-white/5 px-3 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-amber-300">{c.authorName}</span>
                          <span className="text-xs text-slate-500">{c.time}</span>
                        </div>
                        <p className="text-xs text-slate-300">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add comment input */}
                {isCommenting && (
                  <div className="mb-3 space-y-2">
                    <TxtArea rows={2} value={commentText} onChange={e => setCommentText(e.target.value)} placeholder={language === "ar" ? "اكتب تعليقاً..." : "Write a comment..."} />
                    <div className="flex gap-2">
                      <Btn className="flex-1" onClick={() => addComment(r.id)}>{language === "ar" ? "إرسال" : "Send"}</Btn>
                      <Btn variant="secondary" onClick={() => { setCommentingReportId(null); setCommentText(""); }}>{language === "ar" ? "إلغاء" : "Cancel"}</Btn>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
                  {/* Comment - all can comment */}
                  <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                    setCommentingReportId(isCommenting ? null : r.id);
                    setCommentText("");
                  }}>
                    💬 {(r.comments ?? []).length > 0 ? `${(r.comments ?? []).length}` : ""} {language === "ar" ? "تعليق" : "Comment"}
                  </Btn>

                  {/* Add photo */}
                  {canEdit && !r.mediaUrl && (
                    <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                      setReportAddingPhotoId(r.id);
                      reportEditPhotoRef.current?.click();
                    }}>📷 {language === "ar" ? "إضافة صورة" : "Add Photo"}</Btn>
                  )}

                  {/* Edit */}
                  {canEdit && !isEditing && (
                    <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                      setEditReportId(r.id);
                      setEditReportForm({ text: r.text, status: r.status });
                    }}>✏️ {language === "ar" ? "تعديل" : "Edit"}</Btn>
                  )}

                  {/* Delete - owner or sender */}
                  {(isOwner || r.senderId === currentUser?.id) && (
                    <Btn variant="danger" className="h-8 px-3 text-xs ms-auto" onClick={() => {
                      mutate(prev => ({ ...prev, reports: prev.reports.filter(x => x.id !== r.id) }), language === "ar" ? "تم الحذف" : "Deleted");
                      void deleteReportRemote(r.id);
                    }}>🗑 {language === "ar" ? "حذف" : "Delete"}</Btn>
                  )}
                </div>
              </Panel>
            );
          })
        }
      </div>
      {visibleReports.length > REPORTS_PER_PAGE && (
        <div className="flex justify-center gap-2">
          <Btn variant="secondary" onClick={() => setReportPage(p => Math.max(1, p - 1))} disabled={reportPage === 1}>{language === "ar" ? "السابق" : "Prev"}</Btn>
          <span className="flex items-center text-slate-400">{reportPage} / {Math.ceil(visibleReports.length / REPORTS_PER_PAGE)}</span>
          <Btn variant="secondary" onClick={() => setReportPage(p => Math.min(Math.ceil(visibleReports.length / REPORTS_PER_PAGE), p + 1))} disabled={reportPage === Math.ceil(visibleReports.length / REPORTS_PER_PAGE)}>{language === "ar" ? "التالي" : "Next"}</Btn>
        </div>
      )}
    </div>
  );

  const renderVisitors = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead title={language === "ar" ? "الزوار" : "Visitors"} />
        {(isOwner || isAdmin) && <Btn onClick={() => setVisitorModalOpen(true)}>+ {language === "ar" ? "إضافة زائر" : "Add Visitor"}</Btn>}
      </div>
      <div className="flex flex-wrap gap-3">
        <TxtInput className="max-w-xs" placeholder={language === "ar" ? "بحث..." : "Search..."} value={visitorSearch} onChange={e => setVisitorSearch(e.target.value)} />
        <SelInput className="w-40" value={visitorStatusFilter} onChange={e => setVisitorStatusFilter(e.target.value as VisitorRecord["status"] | "all")}>
          <option value="all">{language === "ar" ? "الكل" : "All"}</option>
          {(["scheduled", "arrived", "departed", "cancelled"] as const).map(s => <option key={s} value={s}>{s}</option>)}
        </SelInput>
      </div>
      <div className="space-y-3">
        {filteredVisitors.length === 0 ? <EmptyMsg title={language === "ar" ? "لا زوار" : "No Visitors"} text="" /> : filteredVisitors.map(v => (
          <Panel key={v.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-white">{v.guestName}</span>
                  <Badge className={v.status === "arrived" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : v.status === "cancelled" ? "border-red-400/30 bg-red-500/15 text-red-300" : "border-amber-400/30 bg-amber-500/15 text-amber-300"}>{v.status}</Badge>
                </div>
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <InfoRow label={language === "ar" ? "الشركة" : "Company"} value={v.company} />
                  <InfoRow label={language === "ar" ? "الوصول" : "Arrival"} value={`${v.arrivalDate} ${v.arrivalTime}`} />
                  <InfoRow label={language === "ar" ? "رمز الدخول" : "Pass Code"} value={v.passCode} />
                </div>
              </div>
              {v.qrData && (
                <div className="flex-shrink-0">
                  <img src={v.qrData} alt="QR" className="h-20 w-20 rounded-xl" />
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {v.status === "scheduled" && (isOwner || isAdmin) && <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => { mutate(prev => ({ ...prev, visitors: prev.visitors.map(x => x.id === v.id ? { ...x, status: "arrived", checkInTime: nowStamp() } : x) }), language === "ar" ? "وصل الزائر" : "Visitor arrived"); void updateVisitorRemote(v.id, { status: "arrived", checkInTime: nowStamp() }); }}>{language === "ar" ? "وصل" : "Arrived"}</Btn>}
              {v.status === "arrived" && (isOwner || isAdmin) && <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => { mutate(prev => ({ ...prev, visitors: prev.visitors.map(x => x.id === v.id ? { ...x, status: "departed", checkOutTime: nowStamp() } : x) }), language === "ar" ? "غادر الزائر" : "Visitor departed"); void updateVisitorRemote(v.id, { status: "departed", checkOutTime: nowStamp() }); }}>{language === "ar" ? "غادر" : "Departed"}</Btn>}
              {v.status === "scheduled" && (isOwner || isAdmin) && <Btn variant="danger" className="h-8 px-3 text-xs" onClick={() => { mutate(prev => ({ ...prev, visitors: prev.visitors.map(x => x.id === v.id ? { ...x, status: "cancelled" } : x) }), language === "ar" ? "تم الإلغاء" : "Cancelled"); void updateVisitorRemote(v.id, { status: "cancelled" }); }}>{language === "ar" ? "إلغاء" : "Cancel"}</Btn>}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );

  const saveUserEdit = (userId: string) => {
    const u = approvedUsers.find(x => x.id === userId);
    if (!u) return;
    const updated = { ...u, name: editUserForm.name || u.name, phone: editUserForm.phone || u.phone, assignedBuildingId: editUserForm.buildingId || u.assignedBuildingId, role: editUserForm.role };
    mutate(prev => ({ ...prev, users: prev.users.map(x => x.id === userId ? updated : x) }), language === "ar" ? "تم تحديث البيانات" : "Updated");
    void saveApprovedUser(updated);
    setEditUserId(null);
  };

  const addUserDirectly = (e: FormEvent) => {
    e.preventDefault();
    if (!directAddForm.name.trim() || !directAddForm.email.trim() || !directAddForm.password.trim()) return;
    const emailCheck = validateEmail(directAddForm.email);
    if (!emailCheck.valid) { showToast(language === "ar" ? (emailCheck.errorAr ?? "بريد غير صحيح") : (emailCheck.errorEn ?? "Invalid email"), "danger"); return; }
    if (approvedUsers.some(u => u.email.toLowerCase() === directAddForm.email.trim().toLowerCase())) { showToast(language === "ar" ? "البريد مستخدم بالفعل" : "Email already exists", "danger"); return; }
    const newUser: User = {
      id: `user-${Date.now()}`, name: directAddForm.name.trim(), email: directAddForm.email.trim(),
      phone: directAddForm.phone.trim(), role: directAddForm.role, status: "approved",
      assignedBuildingId: directAddForm.buildingId || undefined,
      permissions: directAddForm.role === "admin"
        ? ["reports","alerts","attendance","buildings","viewReports","chat","visitors","shifts"]
        : ["reports","attendance","chat","buildings","visitors","sos"],
      rating: 4, passwordHash: hashPassword(directAddForm.password),
      soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false,
      createdAt: nowStamp(), violations: 0,
    };
    void saveApprovedUser(newUser);
    mutate(prev => ({ ...prev, users: [newUser, ...prev.users], auditLog: [createAuditEntry(currentUser, "direct_add_user", newUser.email, `تمت إضافة ${newUser.name} مباشرة`, "info"), ...prev.auditLog] }), language === "ar" ? "✅ تمت إضافة المستخدم" : "✅ User added");
    setDirectAddForm({ name: "", email: "", phone: "", password: "", role: "guard", buildingId: "" });
    setShowAddUserForm(false);
  };

  const renderUsers = () => {
    if (isGuard) return <EmptyMsg title={language === "ar" ? "غير مصرح" : "Not Authorized"} text={language === "ar" ? "هذه الصفحة للإدارة فقط" : "This page is for administrators only"} />;
    return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead title={language === "ar" ? "إدارة المستخدمين" : "User Management"} subtitle={`${approvedUsers.length} ${language === "ar" ? "مستخدم" : "users"}`} />
        {isOwner && (
          <Btn onClick={() => setShowAddUserForm(p => !p)}>
            {showAddUserForm ? (language === "ar" ? "إلغاء" : "Cancel") : ("+ " + (language === "ar" ? "إضافة مباشر" : "Add Directly"))}
          </Btn>
        )}
      </div>

      {/* Direct add user form - owner only */}
      {isOwner && showAddUserForm && (
        <Panel>
          <div className="mb-4 font-black text-white">{language === "ar" ? "إضافة مستخدم مباشرة" : "Add User Directly"}</div>
          <form onSubmit={addUserDirectly} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div><Lbl>{language === "ar" ? "الاسم الكامل" : "Full Name"}</Lbl><TxtInput required value={directAddForm.name} onChange={e => setDirectAddForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Lbl>{language === "ar" ? "البريد الإلكتروني" : "Email"}</Lbl><TxtInput required type="email" value={directAddForm.email} onChange={e => setDirectAddForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Lbl>{language === "ar" ? "رقم الهاتف" : "Phone"}</Lbl><TxtInput value={directAddForm.phone} onChange={e => setDirectAddForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div><Lbl>{language === "ar" ? "كلمة السر" : "Password"}</Lbl><TxtInput required type="password" value={directAddForm.password} onChange={e => setDirectAddForm(p => ({ ...p, password: e.target.value }))} /></div>
              <div><Lbl>{language === "ar" ? "الدور" : "Role"}</Lbl>
                <SelInput value={directAddForm.role} onChange={e => setDirectAddForm(p => ({ ...p, role: e.target.value as Role }))}>
                  <option value="guard">{language === "ar" ? "حارس أمن" : "Guard"}</option>
                  <option value="admin">{language === "ar" ? "إداري" : "Admin"}</option>
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "المبنى المخصص" : "Assigned Building"}</Lbl>
                <SelInput value={directAddForm.buildingId} onChange={e => setDirectAddForm(p => ({ ...p, buildingId: e.target.value }))}>
                  <option value="">{language === "ar" ? "— اختياري —" : "— Optional —"}</option>
                  {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{language === "ar" ? b.nameAr : b.nameEn}</option>)}
                </SelInput>
              </div>
            </div>
            <Btn type="submit" className="w-full">{language === "ar" ? "إضافة المستخدم" : "Add User"}</Btn>
          </form>
        </Panel>
      )}

      {/* Pending requests */}
      {pendingUsers.length > 0 && (
        <Panel>
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-black text-black">{pendingUsers.length}</span>
            <div className="font-black text-amber-400">{language === "ar" ? "طلبات انتظار" : "Pending Requests"}</div>
          </div>
          <div className="space-y-3">
            {pendingUsers.map(u => (
              <div key={u.id} className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{u.name}</div>
                    <div className="text-sm text-slate-400">{u.email}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge className={getRoleBadgeClass(u.role)}>{pair(language, roleLabels[u.role])}</Badge>
                      {u.assignedBuildingId && <Badge className="border-sky-400/30 bg-sky-500/15 text-sky-300">{formatBuilding(snapshot.buildings.find(b => b.id === u.assignedBuildingId), language)}</Badge>}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{language === "ar" ? "طلب في:" : "Requested:"} {u.createdAt}</div>
                  </div>
                  <div className="flex gap-2">
                    <Btn onClick={() => {
                      approveUser(u.id);
                      sendToServiceWorker({ title: "✅ " + (language === "ar" ? "تمت الموافقة" : "Approved"), body: u.name, tag: u.id });
                    }}>{language === "ar" ? "✅ موافقة" : "✅ Approve"}</Btn>
                    <Btn variant="danger" onClick={() => rejectUser(u.id)}>{language === "ar" ? "رفض" : "Reject"}</Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Search bar */}
      <TxtInput
        className="max-w-sm"
        placeholder={language === "ar" ? "🔍 بحث بالاسم أو رقم الأمان SEC-XXXX..." : "🔍 Search by name or SEC number..."}
        value={userFilter}
        onChange={e => setUserFilter(e.target.value)}
      />

      {/* Stats row */}
      <div className="grid gap-3 grid-cols-3">
        <Panel className="min-h-0 p-4 text-center">
          <div className="text-2xl font-black text-emerald-400">{approvedUsers.filter(u => u.role === "guard").length}</div>
          <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "حراس" : "Guards"}</div>
        </Panel>
        <Panel className="min-h-0 p-4 text-center">
          <div className="text-2xl font-black text-sky-400">{approvedUsers.filter(u => u.role === "admin").length}</div>
          <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "إداريون" : "Admins"}</div>
        </Panel>
        <Panel className="min-h-0 p-4 text-center">
          <div className="text-2xl font-black text-amber-400">{activeUserIds.length}</div>
          <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "متصلون الآن" : "Online Now"}</div>
        </Panel>
      </div>

      {/* User list */}
      <div className="space-y-3">
        {filteredUsers.length === 0
          ? <EmptyMsg title={language === "ar" ? "لا نتائج" : "No results"} text="" />
          : filteredUsers.map(u => {
            const isOnlineUser = activeUserIds.includes(u.id);
            const isEditing = editUserId === u.id;
            const isSelf = u.id === currentUser?.id;
            const secNum = securityNumber(u.id);
            const assignedBuilding = snapshot.buildings.find(b => b.id === u.assignedBuildingId);
            // Admin sees limited data for guards
            const canSeeFullData = isOwner || u.showFullToAdmin || u.role !== "guard";

            return (
              <Panel key={u.id} className={isOnlineUser ? "border-emerald-500/20" : ""}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* User info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Online indicator */}
                      <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${isOnlineUser ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                      <Badge className={getRoleBadgeClass(u.role)}>{pair(language, roleLabels[u.role])}</Badge>
                      <span className="font-black text-white">{u.name}</span>
                      {isSelf && <Badge className="border-amber-400/30 bg-amber-500/15 text-amber-300">{language === "ar" ? "أنت" : "You"}</Badge>}
                      {(u.violations ?? 0) > 0 && <Badge className="border-red-400/30 bg-red-500/15 text-red-300">⚠️ {u.violations}</Badge>}
                    </div>
                    <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      <div className="text-slate-500">{language === "ar" ? "رقم الأمان" : "Security No."}: <span className="text-amber-400 font-mono font-bold">{secNum}</span></div>
                      {canSeeFullData
                        ? <>
                            <div className="text-slate-400">{language === "ar" ? "البريد" : "Email"}: {u.email}</div>
                            <div className="text-slate-400">{language === "ar" ? "الهاتف" : "Phone"}: {u.phone || "—"}</div>
                          </>
                        : <div className="text-slate-600 italic col-span-2">{language === "ar" ? "البيانات الحساسة مخفية (رؤية إدارية)" : "Sensitive data hidden (admin view)"}</div>
                      }
                      <div className="text-slate-400">{language === "ar" ? "المبنى" : "Building"}: {assignedBuilding ? (language === "ar" ? assignedBuilding.nameAr : assignedBuilding.nameEn) : "—"}</div>
                      <div className="text-slate-400">{language === "ar" ? "انضم" : "Joined"}: {u.createdAt?.slice(0, 10) ?? "—"}</div>
                    </div>
                  </div>

                  {/* Owner controls */}
                  {isOwner && !isSelf && (
                    <div className="flex flex-shrink-0 flex-col items-end gap-2">
                      <div className="flex gap-2">
                        <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                          if (isEditing) { setEditUserId(null); return; }
                          setEditUserId(u.id);
                          setEditUserForm({ name: u.name, phone: u.phone, buildingId: u.assignedBuildingId ?? "", role: u.role });
                        }}>{isEditing ? (language === "ar" ? "إلغاء" : "Cancel") : (language === "ar" ? "✏️ تعديل" : "✏️ Edit")}</Btn>
                        {/* Restore sound button */}
                        <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                          mutate(prev => ({ ...prev, users: prev.users.map(x => x.id === u.id ? { ...x, soundEnabled: true } : x) }));
                          void saveApprovedUser({ ...u, soundEnabled: true });
                          showToast(language === "ar" ? "🔊 تم تفعيل الصوت" : "🔊 Sound restored", "success");
                        }} title={language === "ar" ? "إعادة تفعيل الصوت" : "Restore Sound"}>🔊</Btn>
                        <Btn variant="danger" className="h-8 px-3 text-xs" onClick={() => deleteUser(u.id)}>{language === "ar" ? "حذف" : "Delete"}</Btn>
                      </div>
                    </div>
                  )}
                </div>

                {/* Edit form - owner only */}
                {isOwner && isEditing && (
                  <div className="mt-4 border-t border-white/10 pt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div><Lbl>{language === "ar" ? "الاسم" : "Name"}</Lbl><TxtInput value={editUserForm.name} onChange={e => setEditUserForm(p => ({ ...p, name: e.target.value }))} /></div>
                      <div><Lbl>{language === "ar" ? "الهاتف" : "Phone"}</Lbl><TxtInput value={editUserForm.phone} onChange={e => setEditUserForm(p => ({ ...p, phone: e.target.value }))} /></div>
                      <div><Lbl>{language === "ar" ? "الدور" : "Role"}</Lbl>
                        <SelInput value={editUserForm.role} onChange={e => setEditUserForm(p => ({ ...p, role: e.target.value as Role }))}>
                          <option value="guard">{language === "ar" ? "حارس أمن" : "Guard"}</option>
                          <option value="admin">{language === "ar" ? "إداري" : "Admin"}</option>
                          <option value="owner">{language === "ar" ? "مالك" : "Owner"}</option>
                        </SelInput>
                      </div>
                      <div className="sm:col-span-2"><Lbl>{language === "ar" ? "المبنى المخصص" : "Assigned Building"}</Lbl>
                        <SelInput value={editUserForm.buildingId} onChange={e => setEditUserForm(p => ({ ...p, buildingId: e.target.value }))}>
                          <option value="">{language === "ar" ? "— بدون تخصيص —" : "— None —"}</option>
                          {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{language === "ar" ? b.nameAr : b.nameEn}</option>)}
                        </SelInput>
                      </div>
                    </div>
                    {/* Permissions */}
                    <div>
                      <Lbl>{language === "ar" ? "الصلاحيات" : "Permissions"}</Lbl>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.keys(permissionLabels).map(p => {
                          const hasPerm = (u.permissions ?? []).includes(p);
                          return (
                            <button key={p} type="button" onClick={() => {
                              const newPerms = hasPerm ? u.permissions.filter(x => x !== p) : [...(u.permissions ?? []), p];
                              mutate(prev => ({ ...prev, users: prev.users.map(x => x.id === u.id ? { ...x, permissions: newPerms } : x) }));
                              void saveApprovedUser({ ...u, permissions: newPerms });
                            }} className={`rounded-full border px-2.5 py-1 text-xs font-bold transition ${hasPerm ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-500 hover:bg-white/10"}`}>
                              {pair(language, permissionLabels[p])}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <Btn onClick={() => saveUserEdit(u.id)} className="w-full">{language === "ar" ? "💾 حفظ التغييرات" : "💾 Save Changes"}</Btn>
                  </div>
                )}
              </Panel>
            );
          })
        }
      </div>
    </div>
  );
  };

  const sendChatMedia = async (file: File) => {
    if (!currentUser || !activeConversation) return;
    setChatMediaUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const kind: ChatMessage["kind"] = file.type.startsWith("video") ? "image" : "image";
      const msg: ChatMessage = { id: `msg-${Date.now()}`, senderId: currentUser.id, kind, imageUrl: dataUrl, time: chatTime(language) };
      mutate(prev => {
        const existingSource = conversationsSource.find(c => c.id === activeConversation.id);
        const baseConv = existingSource ?? activeConversation;
        const updated = { ...baseConv, messages: [...(baseConv.messages ?? []), msg] };
        void saveConversation(updated);
        const localExists = prev.conversations.find(c => c.id === activeConversation.id);
        if (localExists) return { ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? updated : c) };
        return { ...prev, conversations: [updated, ...prev.conversations] };
      });
    } catch { showToast(language === "ar" ? "فشل رفع الملف" : "Upload failed", "danger"); }
    setChatMediaUploading(false);
  };

  const startVoiceRecord = async () => {
    try {
      // Check if microphone is blocked
      if (navigator.permissions) {
        try {
          const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (perm.state === "denied") {
            showToast(
              language === "ar"
                ? "🎙️ الميكروفون محجوب — اضغط على أيقونة القفل 🔒 في شريط العنوان وأذن بالوصول"
                : "🎙️ Mic blocked — tap the lock 🔒 in address bar to allow access",
              "danger"
            );
            return;
          }
        } catch { /* ignore */ }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
      });
      streamRef.current = stream;

      // Pick best supported format
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "audio/mp4",
      ].find(t => MediaRecorder.isTypeSupported(t)) ?? "";

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorderChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recorderChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (!currentUser || !activeConversation) return;

        const chunks = recorderChunksRef.current;
        if (chunks.length === 0) {
          showToast(language === "ar" ? "لم يُسجَّل صوت — حاول مرة أخرى" : "No audio — try again", "danger");
          return;
        }

        const finalMime = mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: finalMime });

        if (blob.size < 500) {
          showToast(language === "ar" ? "التسجيل قصير جداً" : "Recording too short", "danger");
          return;
        }

        const ext = finalMime.includes("ogg") ? "ogg" : finalMime.includes("mp4") ? "mp4" : "webm";
        const audioUrl = await fileToDataUrl(new File([blob], `voice-${Date.now()}.${ext}`, { type: finalMime }));

        const elapsed = Math.round((Date.now() - recordingStartTime) / 1000);
        const msg: ChatMessage = {
          id: `msg-${Date.now()}`, senderId: currentUser.id,
          kind: "audio", audioUrl,
          text: `🎙️ ${elapsed}s`,
          time: chatTime(language),
        };

        mutate(prev => {
          const srcConv = conversationsSource.find(c => c.id === activeConversation.id);
          const baseC = srcConv ?? activeConversation;
          const updated = { ...baseC, messages: [...(baseC.messages ?? []), msg] };
          void saveConversation(updated);
          const locEx = prev.conversations.find(c => c.id === activeConversation.id);
          if (locEx) return { ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? updated : c) };
          return { ...prev, conversations: [updated, ...prev.conversations] };
        });
        // Send push notification to recipient
        const conv = activeConversation;
        const recipientId = conv.participantId;
        void sendPushViaWorker("🎙️ رسالة صوتية", `${currentUser.name}`, "chat", recipientId);
      };

      recorder.start(250); // chunk every 250ms for reliability
      setIsRecording(true);
      setRecordingStartTime(Date.now());
      showToast(language === "ar" ? "🔴 يُسجَّل... اضغط ⏹️ للإرسال" : "🔴 Recording... tap ⏹️ to send", "info");
    } catch (err: unknown) {
      const name = (err as Error)?.name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        showToast(
          language === "ar"
            ? "🎙️ الميكروفون محجوب — اضغط 🔒 في شريط العنوان ← إعدادات الموقع ← الميكروفون ← السماح"
            : "🎙️ Mic blocked — tap 🔒 in address bar → Site Settings → Microphone → Allow",
          "danger"
        );
      } else if (name === "NotFoundError") {
        showToast(language === "ar" ? "🎙️ لا يوجد ميكروفون في الجهاز" : "🎙️ No microphone found", "danger");
      } else {
        showToast(language === "ar" ? "🎙️ تعذر الوصول للميكروفون" : "🎙️ Microphone unavailable", "danger");
      }
    }
  };

  const stopVoiceRecord = () => {
    const elapsed = Date.now() - recordingStartTime;
    if (elapsed < 500) {
      showToast(language === "ar" ? "اضغط واستمر للتسجيل" : "Hold longer to record", "info");
      recorderRef.current?.stop();
      recorderChunksRef.current = [];
      setIsRecording(false);
      return;
    }
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  const renderChat = () => {
    return (
      <div className="space-y-4">
        <SectionHead title={language === "ar" ? "الدردشة" : "Chat"} />
        <input ref={chatFileRef} type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={async e => { if (e.target.files?.[0]) { await sendChatMedia(e.target.files[0]); e.target.value = ""; } }} />
        <div className="flex flex-col gap-4 lg:flex-row">
          <Panel className="lg:w-72 lg:flex-shrink-0">
            <div className="mb-3 font-black text-white">{language === "ar" ? "المحادثات" : "Conversations"}</div>
            <div className="space-y-2">
              {visibleConversations.map(c => (
                <button key={c.id} onClick={() => setConversationId(c.id)} className={`w-full rounded-2xl p-3 text-start transition ${c.id === conversationId ? "border border-amber-400/40 bg-amber-500/10" : "border border-transparent bg-white/5 hover:bg-white/10"}`}>
                  <div className="font-bold text-white">{c.participantName}</div>
                  <div className="text-xs text-slate-400">{pair(language, roleLabels[c.participantRole])}</div>
                  {c.messages.length > 0 && <div className="mt-1 truncate text-xs text-slate-500">{(c.messages[c.messages.length - 1].text ?? (c.messages[c.messages.length - 1].kind === "audio" ? "🎙️ Voice" : "📷 Media"))?.slice(0, 30)}</div>}
                </button>
              ))}
            </div>
          </Panel>
          <Panel className="flex-1">
            {activeConversation ? (
              <div className="flex h-[520px] flex-col">
                <div className="mb-4 border-b border-white/10 pb-3 font-black text-white">{activeConversation.participantName}</div>
                <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                  {activeConversation.messages.length === 0
                    ? <div className="flex h-full items-center justify-center text-slate-500">{language === "ar" ? "لا رسائل بعد" : "No messages yet"}</div>
                    : activeConversation.messages.map(m => {
                        const isMine = m.senderId === currentUser?.id;
                        return (
                          <div key={m.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[78%] rounded-2xl px-4 py-2 text-sm ${isMine ? "bg-amber-500/20 text-amber-100" : "bg-white/10 text-white"}`}>
                              {m.kind === "text" && <p>{m.text}</p>}
                              {m.kind === "image" && m.imageUrl && <img src={m.imageUrl} alt="media" className="max-h-48 rounded-xl object-cover" />}
                              {m.kind === "audio" && m.audioUrl && (
                              <div className="flex items-center gap-2">
                                <audio controls src={m.audioUrl} className="max-w-[200px] h-8" style={{ filter: "invert(0.1) sepia(1) saturate(5) hue-rotate(10deg)" }} />
                                {m.text && <span className="text-xs opacity-60">{m.text}</span>}
                              </div>
                            )}
                              <div className="mt-1 text-xs opacity-50">{m.time}</div>
                            </div>
                          </div>
                        );
                      })
                  }
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <TxtInput
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(chatInput); setChatInput(""); } }}
                    placeholder={language === "ar" ? "اكتب رسالة..." : "Type a message..."}
                    className="flex-1"
                  />
                  <button title="صورة/فيديو" onClick={() => chatFileRef.current?.click()} className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-lg hover:bg-white/10">
                    {chatMediaUploading ? "⏳" : "📷"}
                  </button>
                  <button
                    title={isRecording ? (language === "ar" ? "اضغط لإيقاف وإرسال" : "Tap to stop & send") : (language === "ar" ? "اضغط لبدء التسجيل" : "Tap to record")}
                    onClick={() => { if (isRecording) { stopVoiceRecord(); } else { void startVoiceRecord(); } }}
                    className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border text-lg transition ${isRecording ? "border-red-500/50 bg-red-500/20 animate-pulse scale-110" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                  >
                    {isRecording ? "⏹️" : "🎙️"}
                  </button>
                  <Btn onClick={() => { sendMessage(chatInput); setChatInput(""); }}>{language === "ar" ? "إرسال" : "Send"}</Btn>
                </div>
                {isRecording && <div className="mt-2 flex items-center justify-center gap-2 text-xs text-red-400"><span className="animate-pulse">⏺</span>{language === "ar" ? "جارٍ التسجيل... اضغط ⏹️ لإيقاف وإرسال" : "Recording... tap ⏹️ to stop & send"}<span className="animate-pulse">⏺</span></div>}
              </div>
            ) : <EmptyMsg title={language === "ar" ? "اختر محادثة" : "Select a conversation"} text="" />}
          </Panel>
        </div>
      </div>
    );
  };

  const sendAlert = (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser || !alertForm.text.trim()) return;
    if (alertForm.status === "other" && !alertForm.customStatus.trim()) return;
    const typeLabels: Record<string, {ar:string;en:string;severity:AlertLog["severity"]}> = {
      fire:    { ar: "🔥 حريق",           en: "🔥 Fire",    severity: "critical" },
      medical: { ar: "🚑 إسعاف طبي",      en: "🚑 Medical", severity: "critical" },
      flood:   { ar: "🌊 سيول / فيضانات", en: "🌊 Flood",   severity: "warning"  },
      other:   { ar: `✏️ ${alertForm.customStatus}`, en: `✏️ ${alertForm.customStatus}`, severity: "info" },
    };
    const typeInfo = typeLabels[alertForm.status] ?? typeLabels.other;
    const isCritical = typeInfo.severity === "critical";
    const statusLabel = language === "ar" ? typeInfo.ar : typeInfo.en;
    const targetLabel = alertForm.target === "all"
      ? (language === "ar" ? "الجميع" : "Everyone")
      : (language === "ar" ? "الحراس فقط" : "Guards only");
    const alert: AlertLog = {
      id: `a-${Date.now()}`,
      status: statusLabel,
      target: targetLabel,
      text: alertForm.text.trim(),
      sender: currentUser.name,
      senderRole: currentUser.role,
      time: nowStamp(),
      severity: typeInfo.severity,
    };
    void saveAlert(alert);
    mutate(prev => ({ ...prev, alerts: [alert, ...prev.alerts] }));
    // Siren + vibration + push notification
    // Play siren immediately for the sender too
    void startEmergencySound();
    if (isCritical) {
      setEmergencyActive(true);
      vibrateEmergency();
    } else {
      playNormalAlertSound(true);
      vibrateDevice();
    }
    sendToServiceWorker({
      title: `${isCritical ? "🚨" : "⚠️"} ${statusLabel}`,
      body: `${alertForm.text} — ${language === "ar" ? "بواسطة" : "by"}: ${currentUser.name}`,
      tag: alert.id,
      requireInteraction: isCritical,
    });
    showToast(language === "ar" ? "✅ تم إرسال التنبيه" : "✅ Alert sent", isCritical ? "danger" : "success");
    setAlertForm(p => ({ ...p, text: "", customStatus: "" }));
  };

  const renderAlerts = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "نظام الإنذارات" : "Alert System"} />

      {/* Send alert form - owner, admin, AND guard */}
      <Panel>
        <div className="mb-4 font-black text-white">
          {isGuard
            ? `👮 ${language === "ar" ? "إرسال تنبيه للإدارة" : "Send Alert to Management"}`
            : `📢 ${language === "ar" ? "إرسال إنذار" : "Send Alert"}`}
        </div>
        <form onSubmit={sendAlert} className="space-y-4">

          {/* Alert type - 3 options only */}
          <div>
            <Lbl>{language === "ar" ? "نوع الحالة" : "Situation Type"}</Lbl>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "fire",  label: "🔥 " + (language === "ar" ? "حريق" : "Fire"),  cls: "border-red-500/40 bg-red-500/10 text-red-200",    desc: language === "ar" ? "سيُشغّل الصفارة" : "Triggers siren" },
                { key: "flood", label: "🌊 " + (language === "ar" ? "سيول" : "Flood"), cls: "border-amber-500/40 bg-amber-500/10 text-amber-200", desc: language === "ar" ? "تحذير فقط" : "Warning only" },
                { key: "other", label: "✏️ " + (language === "ar" ? "أخرى" : "Other"), cls: "border-slate-500/40 bg-slate-500/10 text-slate-200",  desc: language === "ar" ? "اكتب النوع" : "Specify type" },
              ] as const).map(({ key, label, cls, desc }) => (
                <button key={key} type="button" onClick={() => setAlertForm(p => ({ ...p, status: key }))}
                  className={`rounded-2xl border p-3 text-center transition ${alertForm.status === key ? cls + " ring-2 ring-white/20 scale-105" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                  <div className="text-sm font-black">{label}</div>
                  <div className="text-xs opacity-60 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom type field */}
          {alertForm.status === "other" && (
            <div>
              <Lbl>{language === "ar" ? "اكتب نوع الحالة" : "Specify Alert Type"}</Lbl>
              <TxtInput required value={alertForm.customStatus} onChange={e => setAlertForm(p => ({ ...p, customStatus: e.target.value }))} placeholder={language === "ar" ? "مثال: اقتحام، تهديد أمني..." : "e.g. Security breach, intrusion..."} />
            </div>
          )}

          {/* Target - owner/admin see full options, guard sends to management only */}
          {!isGuard && (
            <div>
              <Lbl>{language === "ar" ? "الجهة المستهدفة" : "Target"}</Lbl>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { key: "all",      label: language === "ar" ? "📢 الجميع" : "📢 Everyone" },
                  { key: "guards",   label: language === "ar" ? "👮 الحراس فقط" : "👮 Guards only" },
                  { key: "specific", label: language === "ar" ? "👤 شخص محدد" : "👤 Specific person" },
                ] as const).map(({ key, label }) => (
                  <button key={key} type="button" onClick={() => setAlertForm(p => ({ ...p, target: key, specificUserId: "" }))}
                    className={`rounded-2xl border p-3 text-sm font-bold transition ${alertForm.target === key ? "border-amber-400/40 bg-amber-500/10 text-amber-200 ring-2 ring-amber-400/20" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {alertForm.target === "specific" && (
                <div className="mt-3">
                  <Lbl>{language === "ar" ? "اختر المستخدم" : "Select User"}</Lbl>
                  <SelInput value={alertForm.specificUserId} onChange={e => setAlertForm(p => ({ ...p, specificUserId: e.target.value }))}>
                    <option value="">{language === "ar" ? "— اختر —" : "— Select —"}</option>
                    {approvedUsers.filter(u => u.id !== currentUser?.id).map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({pair(language, roleLabels[u.role])})</option>
                    ))}
                  </SelInput>
                </div>
              )}
            </div>
          )}

          {/* Message */}
          <div>
            <Lbl>{language === "ar" ? "نص التنبيه" : "Alert Message"}</Lbl>
            <TxtArea rows={3} required value={alertForm.text} onChange={e => setAlertForm(p => ({ ...p, text: e.target.value }))} placeholder={language === "ar" ? "اكتب تفاصيل الحالة..." : "Describe the situation..."} />
          </div>

          <Btn type="submit" variant={alertForm.status === "fire" ? "danger" : "primary"} className="w-full h-14 text-lg font-black">
            {alertForm.status === "fire"
              ? (language === "ar" ? "🚨 إرسال إنذار حريق + تفعيل الصفارة" : "🚨 Send Fire Alert + Siren")
              : (language === "ar" ? "📢 إرسال التنبيه" : "📢 Send Alert")}
          </Btn>
        </form>
      </Panel>

      {/* Active critical banner + master stop */}
      {hasActiveEmergency && (
        <div className="rounded-2xl border border-red-500/50 bg-red-600/20 p-4 flex flex-wrap items-center gap-3">
          <span className="text-3xl animate-pulse">🚨</span>
          <div className="flex-1">
            <div className="font-black text-red-200">{language === "ar" ? "صفارة الإنذار تعمل!" : "Siren Active!"}</div>
            <div className="text-sm text-red-400">{mergedAlerts.find(a => a.severity === "critical")?.status}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {emergencyActive && (
              <Btn variant="danger" onClick={() => { stopEmergencySound(); setEmergencyActive(false); }}>
                🔇 {language === "ar" ? "إيقاف صفارتي" : "Stop My Siren"}
              </Btn>
            )}
            {isOwner && (
              <Btn variant="danger" onClick={() => {
                stopEmergencySound();
                setEmergencyActive(false);
                // Mark all critical alerts as stopped - save to Firebase for all devices
                const critAlerts = mergedAlerts.filter(a => a.severity === "critical");
                critAlerts.forEach(a => {
                  const updated = { ...a, stopped: true } as AlertLog & { stopped?: boolean };
                  void saveAlert(updated as AlertLog);
                });
                const critIds = new Set(critAlerts.map(a => a.id));
                setStoppedAlertIds(prev => new Set([...prev, ...critIds]));
                // Notify all devices to stop siren via Service Worker
                navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_EMERGENCY_NOTIFICATION" });
                showToast(language === "ar" ? "🔇 تم إيقاف جميع الإنذارات على جميع الأجهزة" : "🔇 All alerts stopped on all devices", "info");
              }}>
                🔇 {language === "ar" ? "إيقاف الكل" : "Stop All"}
              </Btn>
            )}
          </div>
        </div>
      )}

      {/* Alert log */}
      <Panel>
        <div className="mb-3 font-black text-white">{language === "ar" ? "سجل التنبيهات" : "Alert Log"}</div>
        {mergedAlerts.length === 0
          ? <EmptyMsg title={language === "ar" ? "لا تنبيهات" : "No Alerts"} text="" />
          : mergedAlerts.map(a => {
            const isCrit = a.severity === "critical";
            const isWarn = a.severity === "warning";
            return (
              <div key={a.id} className={`mb-3 rounded-2xl border p-4 ${stoppedAlertIds.has(a.id) ? "border-slate-500/20 bg-slate-500/5 opacity-60" : isCrit ? "border-red-500/40 bg-red-500/10 " + (a === mergedAlerts[0] ? "animate-pulse" : "") : isWarn ? "border-amber-500/30 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl mt-0.5">{isCrit ? "🚨" : isWarn ? "⚠️" : "📢"}</span>
                    <div>
                      <div className="font-black text-white">{a.status}</div>
                      <p className="mt-1 text-sm text-slate-300">{a.text}</p>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                        {/* Only show sender if: viewer is not a guard, OR sender is not a guard */}
                        {(!isGuard || (a as AlertLog & { senderRole?: string }).senderRole !== "guard") && (
                          <span>👤 {a.sender}</span>
                        )}
                        <span>🕐 {formatTime(a.time, use24h)}</span>
                        <span>📍 {a.target}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex flex-col items-end gap-1">
                    <Badge className={isCrit && !stoppedAlertIds.has(a.id) ? "border-red-400/30 bg-red-500/15 text-red-300" : isWarn ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>
                      {stoppedAlertIds.has(a.id) ? (language === "ar" ? "🔇 موقوف" : "🔇 Stopped") : isCrit ? (language === "ar" ? "حرج 🔥" : "Critical 🔥") : isWarn ? (language === "ar" ? "تحذير" : "Warning") : (language === "ar" ? "معلومة" : "Info")}
                    </Badge>
                    {isOwner && (
                      <Btn variant="danger" className="h-6 px-2 text-xs" onClick={async () => {
                        // Delete from Firebase → removed for ALL users
                        void deleteAlertRemote(a.id);
                        mutate(prev => ({ ...prev, alerts: prev.alerts.filter(x => x.id !== a.id) }));
                        if (!mergedAlerts.filter(x => x.id !== a.id).some(x => !(x as any).stopped && !stoppedAlertIds.has(x.id))) {
                          stopEmergencySound(); setEmergencyActive(false);
                        }
                        showToast(language === "ar" ? "🗑 تم حذف التنبيه للجميع" : "🗑 Alert deleted for everyone", "info");
                      }}>🗑</Btn>
                    )}
                  </div>
                    {/* Stop button: sender can stop their own, owner can stop any */}
                    {!stoppedAlertIds.has(a.id) && !(a as AlertLog & { stopped?: boolean }).stopped && (isOwner || isAdmin || a.sender === currentUser?.name) && (
                      <Btn variant="secondary" className="h-7 px-3 text-xs" onClick={() => {
                        setStoppedAlertIds(prev => new Set([...prev, a.id]));
                        if (emergencyActive) { stopEmergencySound(); setEmergencyActive(false); }
                        // Save stopped state to Firebase so all devices know
                        void saveAlert({ ...a, stopped: true } as AlertLog);
                        showToast(language === "ar" ? "🔇 تم إيقاف الإنذار" : "🔇 Alert stopped", "info");
                      }}>🔇 {language === "ar" ? "إيقاف" : "Stop"}</Btn>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        }
      </Panel>
    </div>
  );

  const archiveAndDeleteOldAttendance = async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const oldRecords = mergedAttendance.filter(a => a.time.slice(0, 10) < cutoffStr);
      if (oldRecords.length === 0) {
        showToast(language === "ar" ? "لا سجلات قديمة للحذف" : "No old records to archive", "info");
        return;
      }
      // Export to Excel first
      exportAttendanceExcel(oldRecords, approvedUsers, snapshot.buildings);
      // Wait a moment then delete from Firebase + local
      await new Promise(r => setTimeout(r, 1500));
      for (const rec of oldRecords) {
        try {
          const { deleteDoc, doc } = await import("firebase/firestore");
          const { firestore } = await import("./services/firebase");
          await deleteDoc(doc(firestore, "attendance", rec.id));
        } catch { /* ignore */ }
      }
      mutate(prev => ({
        ...prev,
        attendance: prev.attendance.filter(a => a.time.slice(0, 10) >= cutoffStr),
      }));
      showToast(
        language === "ar"
          ? `✅ تم تصدير وحذف ${oldRecords.length} سجل قديم (أكثر من 90 يوم)`
          : `✅ Exported & deleted ${oldRecords.length} old records (90+ days)`,
        "success"
      );
    };

  const renderAttendance = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "الحضور" : "Attendance"} subtitle={language === "ar" ? "مسح QR المبنى المخصص لك فقط" : "Scan your assigned building QR only"} />
      {/* Today's status */}
      {isGuard && currentUser && (() => {
        const todayStr = today();
        const myRecs = mergedAttendance.filter(a => a.userId === currentUser.id && a.time.startsWith(todayStr)).sort((a,b) => b.time.localeCompare(a.time));
        const last = myRecs[0];
        const isCheckedIn = last && !last.checkOut;
        return (
          <div className={`rounded-2xl border p-5 ${isCheckedIn ? "border-emerald-500/40 bg-emerald-500/10" : last ? "border-slate-500/20 bg-white/5" : "border-slate-500/10 bg-white/3"}`}>
            <div className="flex items-center gap-4">
              <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-3xl ${isCheckedIn ? "bg-emerald-500/20" : "bg-slate-500/10"}`}>
                {isCheckedIn ? "🟢" : last ? "🔴" : "⭕"}
              </div>
              <div className="flex-1">
                <div className={`text-lg font-black ${isCheckedIn ? "text-emerald-300" : last ? "text-red-300" : "text-slate-500"}`}>
                  {isCheckedIn
                    ? (language === "ar" ? "مسجل دخول" : "CLOCKED IN")
                    : last
                    ? (language === "ar" ? "مسجل خروج" : "CLOCKED OUT")
                    : (language === "ar" ? "لم تسجل اليوم" : "NOT REGISTERED TODAY")}
                </div>
                {last && (
                  <div className="mt-1 text-sm text-slate-400">
                    {isCheckedIn
                      ? `${language === "ar" ? "⏰ دخول:" : "⏰ In:"} ${last.time}`
                      : `${language === "ar" ? "⏰ خروج:" : "⏰ Out:"} ${last.checkOut}`}
                  </div>
                )}
                {last?.checkOut && last?.time && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    {(() => {
                      try {
                        const inT = new Date(last.time.replace(" ", "T"));
                        const outT = new Date((last.checkOut ?? "").replace(" ", "T"));
                        const diff = Math.round((outT.getTime() - inT.getTime()) / 60000);
                        const h = Math.floor(diff / 60); const m = diff % 60;
                        return language === "ar" ? `المدة: ${h}س ${m}د` : `Duration: ${h}h ${m}m`;
                      } catch { return ""; }
                    })()}
                  </div>
                )}
              </div>
              <div className={`rounded-xl border px-3 py-1 text-xs font-black ${isCheckedIn ? "border-emerald-400/30 text-emerald-300" : "border-red-400/30 text-red-300"}`}>
                {isCheckedIn ? (language === "ar" ? "داخل" : "IN") : (language === "ar" ? "خارج" : "OUT")}
              </div>
            </div>
          </div>
        );
      })()}
      <Panel>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="text-6xl">📷</div>
          <p className="text-center text-slate-300 text-sm max-w-sm">
            {language === "ar"
              ? `امسح رمز QR الخاص بـ ${formatBuilding(snapshot.buildings.find(b => b.id === currentUser?.assignedBuildingId), language)} لتسجيل حضورك`
              : `Scan the QR code of ${formatBuilding(snapshot.buildings.find(b => b.id === currentUser?.assignedBuildingId), language)} to clock in`}
          </p>
          {/* Show assigned building */}
          {currentUser?.assignedBuildingId ? (
            <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4 text-center">
              <div className="text-xs text-slate-400 mb-1">{language === "ar" ? "مبناك المخصص" : "Your Assigned Building"}</div>
              <div className="font-black text-sky-300 text-lg">{formatBuilding(snapshot.buildings.find(b => b.id === currentUser.assignedBuildingId), language)}</div>
            </div>
          ) : (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-center text-sm text-red-300">
              ⚠️ {language === "ar" ? "لا يوجد مبنى مخصص لك — تواصل مع المالك" : "No building assigned — contact the owner"}
            </div>
          )}

          {/* QR Scan button - shows next action clearly */}
          {currentUser?.assignedBuildingId && (() => {
            const todayStr2 = today();
            const myRecs2 = mergedAttendance.filter(a => a.userId === currentUser.id && a.time.startsWith(todayStr2)).sort((a,b) => b.time.localeCompare(a.time));
            const lastRec2 = myRecs2[0];
            const isIn2 = lastRec2 && !lastRec2.checkOut;
            return (
              <Btn
                onClick={() => { setQrContext("attendance"); setQrModalOpen(true); }}
                variant={isIn2 ? "secondary" : "primary"}
                className="h-16 w-full text-lg"
              >
                {isIn2
                  ? `📷 ${language === "ar" ? "مسح QR لتسجيل الخروج 🔴" : "Scan QR to Clock OUT 🔴"}`
                  : `📷 ${language === "ar" ? "مسح QR لتسجيل الدخول 🟢" : "Scan QR to Clock IN 🟢"}`}
              </Btn>
            );
          })()}

          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-center text-xs text-amber-400">
            🔒 {language === "ar"
              ? "يجب مسح رمز QR الخاص بمبناك فقط — لن يُقبل QR أي مبنى آخر"
              : "You must scan your assigned building's QR only — other buildings will be rejected"}
          </div>
        </div>
      </Panel>
      {/* Owner/Admin: live guard status table */}
      {!isGuard && (
        <Panel>
          <div className="mb-4 font-black text-white">
            📊 {language === "ar" ? "حالة الحراس اليوم" : "Guards Status Today"}
          </div>
          <div className="space-y-2">
            {guardUsers.length === 0
              ? <EmptyMsg title={language === "ar" ? "لا حراس" : "No guards"} text="" />
              : guardUsers.map(g => {
                  const todayStr = today();
                  const gRecs = mergedAttendance
                    .filter(a => a.userId === g.id && a.time.startsWith(todayStr))
                    .sort((a, b) => b.time.localeCompare(a.time));
                  const lastRec = gRecs[0];
                  const isIn = lastRec && !lastRec.checkOut;
                  const building = snapshot.buildings.find(b => b.id === g.assignedBuildingId);
                  let duration = "";
                  if (lastRec?.checkOut) {
                    try {
                      const inT = new Date(lastRec.time.replace(" ", "T"));
                      const outT = new Date(lastRec.checkOut.replace(" ", "T"));
                      const diff = Math.round((outT.getTime() - inT.getTime()) / 60000);
                      duration = `${Math.floor(diff/60)}س ${diff%60}د`;
                    } catch { /* ignore */ }
                  }
                  return (
                    <div key={g.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${isIn ? "border-emerald-500/20 bg-emerald-500/5" : lastRec ? "border-red-500/10 bg-red-500/5" : "border-white/10 bg-white/5"}`}>
                      {/* Status dot */}
                      <span className={`h-3 w-3 rounded-full flex-shrink-0 ${isIn ? "bg-emerald-400 animate-pulse" : lastRec ? "bg-red-400" : "bg-slate-600"}`} />
                      {/* Guard info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-black text-white text-sm">{g.name}</div>
                        <div className="text-xs text-slate-400">{building ? (language === "ar" ? building.nameAr : building.nameEn) : "—"}</div>
                      </div>
                      {/* Status */}
                      <div className="text-right flex-shrink-0">
                        <Badge className={isIn ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : lastRec ? "border-red-400/30 bg-red-500/15 text-red-300" : "border-slate-400/30 bg-slate-500/15 text-slate-400"}>
                          {isIn ? (language === "ar" ? "🟢 داخل" : "🟢 IN") : lastRec ? (language === "ar" ? "🔴 خارج" : "🔴 OUT") : (language === "ar" ? "⭕ لم يسجل" : "⭕ None")}
                        </Badge>
                        {lastRec && (
                          <div className="text-xs text-slate-500 mt-1">
                            {isIn
                              ? `${language === "ar" ? "دخل:" : "In:"} ${lastRec.time.split(" ")[1] ?? lastRec.time}`
                              : `${language === "ar" ? "خرج:" : "Out:"} ${(lastRec.checkOut ?? "").split(" ")[1]} ${duration ? `· ${duration}` : ""}`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </Panel>
      )}

      {/* Attendance log - with filters + grid/list toggle */}
      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="font-black text-white">{language === "ar" ? "سجل الحضور" : "Attendance Log"}</div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* View toggle - for everyone */}
            <div className="flex rounded-xl border border-white/10 overflow-hidden">
              <button onClick={() => setAttendanceView("list")} className={`px-3 py-1.5 text-xs font-bold transition ${attendanceView === "list" ? "bg-amber-500 text-black" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>☰ {language === "ar" ? "قائمة" : "List"}</button>
              <button onClick={() => setAttendanceView("grid")} className={`px-3 py-1.5 text-xs font-bold transition ${attendanceView === "grid" ? "bg-amber-500 text-black" : "bg-white/5 text-slate-400 hover:bg-white/10"}`}>⊞ {language === "ar" ? "جدول" : "Grid"}</button>
            </div>
            {/* Date filter */}
            {(["today","week","month","all"] as const).map(f => (
              <button key={f} onClick={() => setAttendanceFilter(f)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${attendanceFilter === f ? "border-amber-400/40 bg-amber-500/10 text-amber-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                {f === "today" ? (language === "ar" ? "اليوم" : "Today") : f === "week" ? (language === "ar" ? "الأسبوع" : "Week") : f === "month" ? (language === "ar" ? "الشهر" : "Month") : (language === "ar" ? "الكل" : "All")}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        {!isGuard && (
          <TxtInput className="mb-4" placeholder={language === "ar" ? "🔍 بحث بالاسم..." : "🔍 Search by name..."} value={attendanceSearch} onChange={e => setAttendanceSearch(e.target.value)} />
        )}

        {/* Export + Archive buttons - owner only */}
        {isOwner && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Btn variant="secondary" className="h-9 px-3 text-xs" onClick={() => exportAttendanceExcel(mergedAttendance, approvedUsers, snapshot.buildings)}>
              📥 {language === "ar" ? "تصدير Excel" : "Export Excel"}
            </Btn>
            <Btn variant="danger" className="h-9 px-3 text-xs" onClick={async () => {
              if (confirm(language === "ar"
                ? "سيتم تصدير السجلات الأقدم من 90 يوم إلى Excel ثم حذفها. متأكد؟"
                : "Records older than 90 days will be exported to Excel then deleted. Confirm?"))
                await archiveAndDeleteOldAttendance();
            }}>
              🗃 {language === "ar" ? "أرشفة وحذف +90 يوم" : "Archive & Delete 90d+"}
            </Btn>
            <span className="text-xs text-slate-500 self-center">
              {mergedAttendance.length} {language === "ar" ? "سجل إجمالي" : "total records"}
            </span>
          </div>
        )}

        {/* GRID VIEW */}
        {attendanceView === "grid" && !isGuard && (() => {
          // Get last 14 days
          const days: string[] = [];
          for (let i = 0; i < 14; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            days.push(d.toISOString().slice(0, 10));
          }
          const displayGuards = guardUsers.filter(g =>
            !attendanceSearch || g.name.toLowerCase().includes(attendanceSearch.toLowerCase())
          );
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[600px]">
                <thead>
                  <tr>
                    <th className="text-start font-bold text-slate-400 py-2 pe-3 min-w-[120px]">{language === "ar" ? "الحارس" : "Guard"}</th>
                    {days.map(d => (
                      <th key={d} className="text-center font-bold text-slate-500 px-1 min-w-[60px]">
                        <div className={d === today() ? "text-amber-400 font-black" : ""}>{d.slice(8)}/{d.slice(5, 7)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayGuards.map(g => (
                    <tr key={g.id} className="border-t border-white/5">
                      <td className="py-2 pe-3 font-bold text-white truncate max-w-[120px]">{g.name}</td>
                      {days.map(d => {
                        const recs = mergedAttendance.filter(a => a.userId === g.id && a.time.startsWith(d));
                        const last = recs[0];
                        const hasIn = !!last;
                        const hasOut = !!last?.checkOut;
                        return (
                          <td key={d} className="text-center px-1 py-2">
                            {hasOut ? <span title={`${last.time.split(" ")[1]} → ${last.checkOut!.split(" ")[1]}`} className="text-emerald-400 cursor-help">✅</span>
                              : hasIn ? <span title={last.time.split(" ")[1]} className="text-amber-400 animate-pulse cursor-help">🟡</span>
                              : <span className="text-slate-700">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 flex gap-4 text-xs text-slate-500">
                <span>✅ {language === "ar" ? "دخول + خروج" : "In + Out"}</span>
                <span>🟡 {language === "ar" ? "دخول فقط (لا يزال داخلاً)" : "In only (still inside)"}</span>
                <span>— {language === "ar" ? "غائب" : "Absent"}</span>
              </div>
            </div>
          );
        })()}

        {/* LIST VIEW */}
        {(attendanceView === "list" || isGuard) && (
        <div className="space-y-2">
          {(isGuard && currentUser
            ? mergedAttendance.filter(a => a.userId === currentUser.id)
            : (() => {
                const now = new Date();
                return mergedAttendance.filter(a => {
                  const d = new Date(a.time.slice(0, 10));
                  if (attendanceFilter === "today") return a.time.startsWith(today());
                  if (attendanceFilter === "week") { const w = new Date(now); w.setDate(w.getDate() - 7); return d >= w; }
                  if (attendanceFilter === "month") { const m = new Date(now); m.setDate(m.getDate() - 30); return d >= m; }
                  return true;
                }).filter(a => !attendanceSearch || a.userName.toLowerCase().includes(attendanceSearch.toLowerCase()));
              })()
          ).slice(0, 50).map(a => {
            const isCheckedOut = !!a.checkOut;
            let dur = "";
            if (a.checkOut) {
              try {
                const inT = new Date(a.time.replace(" ", "T"));
                const outT = new Date(a.checkOut.replace(" ", "T"));
                const diff = Math.round((outT.getTime() - inT.getTime()) / 60000);
                dur = `${Math.floor(diff/60)}س ${diff%60}د`;
              } catch { /* ignore */ }
            }
            return (
              <div key={a.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${isCheckedOut ? "border-white/10 bg-white/5" : "border-emerald-500/20 bg-emerald-500/5"}`}>
                <span className="text-lg flex-shrink-0">{isCheckedOut ? "🔴" : "🟢"}</span>
                <div className="flex-1 min-w-0">
                  {!isGuard && <div className="font-bold text-white text-sm">{a.userName}</div>}
                  <div className="text-xs text-slate-400">
                    {formatBuilding(snapshot.buildings.find(b => b.id === a.buildingId), language)}
                  </div>
                </div>
                <div className="text-end text-xs flex-shrink-0 min-w-[110px]">
                  <div className="text-emerald-400 font-mono">
                    🟢 {formatTime(a.time, use24h)}
                  </div>
                  {a.checkOut ? (
                    <>
                      <div className="text-red-400 font-mono mt-0.5">
                        🔴 {formatTimeOnly(a.checkOut, use24h)}
                      </div>
                      {dur && <div className="text-amber-400 font-bold mt-0.5">⏱ {dur}</div>}
                    </>
                  ) : (
                    <div className="text-emerald-300 text-xs mt-0.5 animate-pulse">
                      {language === "ar" ? "● نشط الآن" : "● Active"}
                    </div>
                  )}
                  <Badge className={a.method === "qr" ? "border-sky-400/30 bg-sky-500/15 text-sky-300 mt-1" : "border-slate-400/30 bg-slate-500/15 text-slate-400 mt-1"}>
                    {a.method === "qr" ? "QR" : language === "ar" ? "يدوي" : "Manual"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </Panel>
    </div>
  );

  // Generate and cache QR for a building
  const getOrGenerateBuildingQR = async (building: Building): Promise<string> => {
    if (buildingQrImages[building.id]) return buildingQrImages[building.id];
    const payload = JSON.stringify({
      type: "building",
      buildingId: building.id,
      buildingName: building.nameEn,
      qrCode: building.qrCode,
      secret: `MUSTAFAQA-${building.id}-2026`,
    });
    const qr = await generateBuildingQR(building.id, building.nameEn).catch(() => "");
    // Use qrService with custom data
    const { generateQRDataUrl } = await import("./services/qrService");
    const qrImg = await generateQRDataUrl(payload, 300).catch(() => qr);
    setBuildingQrImages(prev => ({ ...prev, [building.id]: qrImg }));
    return qrImg;
  };

  const addBuilding = (e: FormEvent) => {
    e.preventDefault();
    if (!addBuildingForm.nameEn.trim() || !addBuildingForm.nameAr.trim()) return;
    const id = addBuildingForm.nameEn.trim().toLowerCase().replace(/\s+/g, "-");
    const qrCode = "QA-" + addBuildingForm.nameEn.trim().toUpperCase().replace(/\s+/g, "").slice(0, 8);
    const newBuilding: Building = { id, nameAr: addBuildingForm.nameAr.trim(), nameEn: addBuildingForm.nameEn.trim(), area: addBuildingForm.area.trim() || "General Zone", qrCode };
    mutate(prev => ({ ...prev, buildings: [...prev.buildings, newBuilding] }), language === "ar" ? "تمت إضافة المبنى" : "Building added");
    setAddBuildingForm({ nameAr: "", nameEn: "", area: "" });
    setShowAddBuilding(false);
  };

  const deleteBuilding = (buildingId: string) => {
    if (!currentUser) return;
    // Safely unassign guards from deleted building
    mutate(prev => ({
      ...prev,
      buildings: prev.buildings.filter(b => b.id !== buildingId),
      users: prev.users.map(u => u.assignedBuildingId === buildingId ? { ...u, assignedBuildingId: undefined } : u),
    }), language === "ar" ? "تم حذف المبنى" : "Building deleted");
    if (selectedBuildingId === buildingId) setSelectedBuildingId(null);
  };

  const renderBuildings = () => {
    // Guard sees ALL buildings (to pick for report) but only their own data
    const allBuildings = snapshot.buildings;
    const filteredBuildings = buildingSearch.trim()
      ? allBuildings.filter(b =>
          b.nameAr.includes(buildingSearch) ||
          b.nameEn.toLowerCase().includes(buildingSearch.toLowerCase())
        )
      : allBuildings;

    const selectedBuilding = selectedBuildingId ? snapshot.buildings.find(b => b.id === selectedBuildingId) : null;
    const buildingReports = selectedBuilding
      ? (isGuard && currentUser
          ? mergedReports.filter(r => r.buildingId === selectedBuilding.id && r.senderId === currentUser.id)
          : mergedReports.filter(r => r.buildingId === selectedBuilding.id))
      : [];
    const buildingVisitors = selectedBuilding
      ? mergedVisitors.filter(v => v.buildingId === selectedBuilding.id)
      : [];
    const assignedGuard = selectedBuilding ? approvedUsers.find(u => u.assignedBuildingId === selectedBuilding.id) : null;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHead title={language === "ar" ? "المباني" : "Buildings"} subtitle={`${snapshot.buildings.length} ${language === "ar" ? "موقع" : "locations"}`} />
          {isOwner && (
            <Btn onClick={() => setShowAddBuilding(p => !p)}>
              {showAddBuilding ? (language === "ar" ? "إلغاء" : "Cancel") : ("+ " + (language === "ar" ? "إضافة مبنى" : "Add Building"))}
            </Btn>
          )}
        </div>

        {/* Add building form - owner only */}
        {isOwner && showAddBuilding && (
          <Panel>
            <div className="mb-3 font-black text-white">{language === "ar" ? "إضافة مبنى جديد" : "Add New Building"}</div>
            <form onSubmit={addBuilding} className="grid gap-4 sm:grid-cols-3">
              <div><Lbl>{language === "ar" ? "الاسم بالعربي" : "Arabic Name"}</Lbl><TxtInput required value={addBuildingForm.nameAr} onChange={e => setAddBuildingForm(p => ({ ...p, nameAr: e.target.value }))} placeholder="المبنى الجديد" /></div>
              <div><Lbl>{language === "ar" ? "الاسم بالإنجليزي" : "English Name"}</Lbl><TxtInput required value={addBuildingForm.nameEn} onChange={e => setAddBuildingForm(p => ({ ...p, nameEn: e.target.value }))} placeholder="NEW BUILDING" /></div>
              <div><Lbl>{language === "ar" ? "المنطقة" : "Area"}</Lbl><TxtInput value={addBuildingForm.area} onChange={e => setAddBuildingForm(p => ({ ...p, area: e.target.value }))} placeholder="Zone" /></div>
              <div className="sm:col-span-3"><Btn type="submit" className="w-full">{language === "ar" ? "إضافة" : "Add"}</Btn></div>
            </form>
          </Panel>
        )}

        {/* Search */}
        <TxtInput
          placeholder={language === "ar" ? "🔍 بحث بالاسم العربي أو الإنجليزي..." : "🔍 Search by name..."}
          value={buildingSearch}
          onChange={e => setBuildingSearch(e.target.value)}
          className="max-w-sm"
        />

        {/* Main layout: sidebar + detail */}
        <div className="flex flex-col gap-4 lg:flex-row">

          {/* Building list sidebar */}
          <div className="lg:w-72 lg:flex-shrink-0">
            <div className="max-h-[70vh] overflow-y-auto space-y-1 rounded-[24px] border border-white/10 bg-[#0b132b]/90 p-3">
              {filteredBuildings.length === 0
                ? <div className="p-4 text-center text-sm text-slate-500">{language === "ar" ? "لا نتائج" : "No results"}</div>
                : filteredBuildings.map(b => {
                    const bReports = isGuard && currentUser
                      ? mergedReports.filter(r => r.buildingId === b.id && r.senderId === currentUser.id)
                      : mergedReports.filter(r => r.buildingId === b.id);
                    const criticals = bReports.filter(r => r.status === "critical").length;
                    const isActive = selectedBuildingId === b.id;
                    return (
                      <button key={b.id} onClick={() => setSelectedBuildingId(b.id)}
                        className={`w-full rounded-2xl p-3 text-start transition ${isActive ? "border border-amber-400/40 bg-amber-500/10" : "border border-transparent hover:bg-white/5"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className={`font-bold text-sm ${isActive ? "text-amber-300" : "text-white"}`}>
                            {language === "ar" ? b.nameAr : b.nameEn}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {criticals > 0 && <span className="text-xs text-red-400">🚨{criticals}</span>}
                            {bReports.length > 0 && <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-xs text-slate-400">{bReports.length}</span>}
                          </div>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{b.area}</div>
                      </button>
                    );
                  })
              }
            </div>
          </div>

          {/* Detail panel */}
          <div className="flex-1">
            {!selectedBuilding ? (
              <div className="flex h-64 items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/5 text-slate-500">
                <div className="text-center">
                  <div className="text-4xl mb-2">🏢</div>
                  <div>{language === "ar" ? "اختر مبنى من القائمة" : "Select a building from the list"}</div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">

                {/* Building header */}
                <Panel>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-2xl font-black text-amber-400">{language === "ar" ? selectedBuilding.nameAr : selectedBuilding.nameEn}</div>
                      <div className="text-sm text-slate-400 mt-1">{selectedBuilding.area}</div>
                      {assignedGuard && <div className="mt-2 text-sm text-emerald-400">👮 {language === "ar" ? "الحارس المخصص:" : "Assigned Guard:"} {assignedGuard.name}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 font-mono text-sm font-bold text-amber-300">
                        {selectedBuilding.qrCode}
                      </div>
                      <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={async () => {
                          void getOrGenerateBuildingQR(selectedBuilding).then(() => setQrModalBuilding(selectedBuilding.id));
                        }}>📷 QR</Btn>
                      {isOwner && (
                        <Btn variant="danger" className="h-8 px-3 text-xs" onClick={() => {
                          if (confirm(language === "ar" ? "تأكيد حذف المبنى؟" : "Delete this building?")) deleteBuilding(selectedBuilding.id);
                        }}>{language === "ar" ? "حذف" : "Delete"}</Btn>
                      )}
                    </div>
                  </div>

                  {/* Owner: reassign guard */}
                  {isOwner && (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <Lbl>{language === "ar" ? "إسناد حارس لهذا المبنى" : "Assign Guard to this Building"}</Lbl>
                      <SelInput className="max-w-xs" value={assignedGuard?.id ?? ""} onChange={e => {
                        const guardId = e.target.value;
                        mutate(prev => ({
                          ...prev,
                          users: prev.users.map(u => {
                            if (u.id === guardId) return { ...u, assignedBuildingId: selectedBuilding.id };
                            if (u.assignedBuildingId === selectedBuilding.id) return { ...u, assignedBuildingId: undefined };
                            return u;
                          }),
                        }), language === "ar" ? "تم تحديث الإسناد" : "Assignment updated");
                        if (guardId) {
                          const g = approvedUsers.find(u => u.id === guardId);
                          if (g) void saveApprovedUser({ ...g, assignedBuildingId: selectedBuilding.id });
                        }
                        if (assignedGuard) void saveApprovedUser({ ...assignedGuard, assignedBuildingId: undefined });
                      }}>
                        <option value="">{language === "ar" ? "— بدون حارس —" : "— No guard —"}</option>
                        {guardUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </SelInput>
                    </div>
                  )}
                </Panel>

                {/* Stats row */}
                <div className="grid gap-3 grid-cols-3">
                  <Panel className="min-h-0 p-4 text-center">
                    <div className="text-2xl font-black text-white">{buildingReports.length}</div>
                    <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "تقارير" : "Reports"}</div>
                  </Panel>
                  <Panel className="min-h-0 p-4 text-center">
                    <div className="text-2xl font-black text-red-300">{buildingReports.filter(r => r.status === "critical").length}</div>
                    <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "حرجة" : "Critical"}</div>
                  </Panel>
                  <Panel className="min-h-0 p-4 text-center">
                    <div className="text-2xl font-black text-amber-300">{buildingVisitors.length}</div>
                    <div className="text-xs text-slate-400 mt-1">{language === "ar" ? "زوار" : "Visitors"}</div>
                  </Panel>
                </div>

                {/* Reports */}
                <Panel>
                  <div className="mb-3 font-black text-white">
                    {language === "ar" ? "التقارير" : "Reports"}
                    {isGuard && <span className="ms-2 text-xs font-normal text-slate-400">({language === "ar" ? "تقاريرك فقط" : "Your reports only"})</span>}
                  </div>
                  {buildingReports.length === 0
                    ? <EmptyMsg title={language === "ar" ? "لا تقارير" : "No Reports"} text="" />
                    : <div className="space-y-3">
                        {buildingReports.map(r => (
                          <div key={r.id} className={`rounded-2xl border p-3 ${r.status === "critical" ? "border-red-500/30 bg-red-500/5" : r.status === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge className={getStatusBadgeClass(r.status)}>{r.status}</Badge>
                                  <span className="font-bold text-white text-sm">{r.senderName}</span>
                                  <span className="text-xs text-slate-400">{formatTime(r.time, use24h)}</span>
                                </div>
                                {(isOwner || isAdmin) && (
                                  <div className="mt-1 text-xs text-slate-500">{r.senderEmail} · {r.senderPhone}</div>
                                )}
                                <p className="mt-2 text-sm text-slate-300">{r.text}</p>
                                {r.mediaUrl && r.mediaUrl !== "__local__" && r.mediaKind === "image" && (
                                  <img src={r.mediaUrl} alt="media" className="mt-2 max-h-40 rounded-xl object-cover" />
                                )}
                              </div>
                              {(isOwner || isAdmin) && (
                                <Btn variant="danger" className="h-7 px-2 text-xs flex-shrink-0" onClick={() => {
                                  mutate(prev => ({ ...prev, reports: prev.reports.filter(x => x.id !== r.id) }));
                                  void deleteReportRemote(r.id);
                                }}>✕</Btn>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                  }
                </Panel>

                {/* Visitors */}
                <Panel>
                  <div className="mb-3 font-black text-white">{language === "ar" ? "الزوار المرتبطون" : "Scheduled Visitors"}</div>
                  {buildingVisitors.length === 0
                    ? <EmptyMsg title={language === "ar" ? "لا زوار" : "No Visitors"} text="" />
                    : <div className="space-y-2">
                        {buildingVisitors.map(v => (
                          <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                            <div>
                              <div className="font-bold text-white">{v.guestName}</div>
                              <div className="text-xs text-slate-400">{v.company} · {v.arrivalDate} {v.arrivalTime}</div>
                              <div className="text-xs text-amber-400 font-mono mt-1">{v.passCode}</div>
                            </div>
                            <Badge className={v.status === "arrived" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : v.status === "cancelled" ? "border-red-400/30 bg-red-500/15 text-red-300" : "border-amber-400/30 bg-amber-500/15 text-amber-300"}>{v.status}</Badge>
                          </div>
                        ))}
                      </div>
                  }
                </Panel>

              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTasks = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "المهام" : "Tasks"} />
      {(isOwner || isAdmin) && (
        <Panel>
          <form onSubmit={e => {
            e.preventDefault();
            if (!currentUser || !taskForm.title.trim()) return;
            const isAll = taskForm.assignedTo === "all";
            const guards = isAll ? guardUsers : [guardUsers.find(u => u.id === taskForm.assignedTo)].filter(Boolean) as User[];
            guards.forEach(g => {
              const task: Task = { id: `t-${Date.now()}-${g.id}`, title: taskForm.title.trim(), details: taskForm.details.trim(), assignedTo: g.id, assignedName: g.name, status: "pending", createdAt: nowStamp(), priority: taskForm.priority, dueDate: taskForm.dueDate || undefined };
              void saveTask(task);
              mutate(prev => ({ ...prev, tasks: [task, ...prev.tasks] }));
              // Push to specific guard via Cloudflare Worker
              void sendPushViaWorker(
                `📋 ${language === "ar" ? "مهمة جديدة" : "New Task"}`,
                `${taskForm.title.trim()} — ${language === "ar" ? "أنجزها في أقرب وقت" : "Complete ASAP"}`,
                "task",
                g.id
              );
            });
            showToast(language === "ar" ? "تمت إضافة المهمة" : "Task added");
            setTaskForm({ title: "", details: "", assignedTo: "all", priority: "medium", dueDate: "" });
          }} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Lbl>{language === "ar" ? "المهمة" : "Task"}</Lbl><TxtInput required value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} /></div>
              <div><Lbl>{language === "ar" ? "للحارس" : "Assign To"}</Lbl>
                <SelInput value={taskForm.assignedTo} onChange={e => setTaskForm(p => ({ ...p, assignedTo: e.target.value }))}>
                  <option value="all">{language === "ar" ? "جميع الحراس" : "All Guards"}</option>
                  {guardUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "الأولوية" : "Priority"}</Lbl>
                <SelInput value={taskForm.priority} onChange={e => setTaskForm(p => ({ ...p, priority: e.target.value as Task["priority"] }))}>
                  <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "تاريخ الاستحقاق" : "Due Date"}</Lbl><TxtInput type="date" value={taskForm.dueDate} onChange={e => setTaskForm(p => ({ ...p, dueDate: e.target.value }))} /></div>
            </div>
            <div><Lbl>{language === "ar" ? "التفاصيل" : "Details"}</Lbl><TxtArea rows={3} value={taskForm.details} onChange={e => setTaskForm(p => ({ ...p, details: e.target.value }))} /></div>
            <Btn type="submit">{language === "ar" ? "إضافة المهمة" : "Add Task"}</Btn>
          </form>
        </Panel>
      )}
      <div className="space-y-3">
        {visibleTasks.length === 0 ? <EmptyMsg title={language === "ar" ? "لا مهام" : "No Tasks"} text="" /> : visibleTasks.map(t => (
          <Panel key={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Badge className={t.priority === "high" ? "border-red-400/30 bg-red-500/15 text-red-300" : t.priority === "medium" ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>{t.priority}</Badge>
                  <span className="font-black text-white">{t.title}</span>
                </div>
                <div className="text-xs text-slate-400">{t.assignedName} {t.dueDate && `· Due: ${t.dueDate}`}</div>
                {t.details && <p className="mt-1 text-sm text-slate-300">{t.details}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge className={t.status === "done" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-amber-400/30 bg-amber-500/15 text-amber-300"}>{t.status}</Badge>
                {t.status !== "done" && (isGuard || isOwner || isAdmin) && <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => { mutate(prev => ({ ...prev, tasks: prev.tasks.map(x => x.id === t.id ? { ...x, status: "done" } : x) }), language === "ar" ? "تم الإنجاز" : "Done"); void updateTaskRemote(t.id, { status: "done" }); }}>{language === "ar" ? "إنجاز" : "Complete"}</Btn>}
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );

  const renderViolations = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "المخالفات" : "Violations"} />
      <Panel>
        {isOwner && (
          <form onSubmit={e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const guardId = fd.get("guardId") as string;
            const type = fd.get("type") as string;
            const description = fd.get("description") as string;
            const severity = fd.get("severity") as "minor"|"major"|"critical";
            if (!guardId || !type || !description) return;
            const guard = approvedUsers.find(u => u.id === guardId);
            if (!guard) return;
            const v: Violation = { id: `v-${Date.now()}`, guardId, guardName: guard.name, type, description, severity, buildingId: guard.assignedBuildingId ?? "", date: today(), acknowledged: false, createdBy: currentUser?.name ?? "", createdAt: nowStamp() };
            void saveViolation(v);
            mutate(prev => ({
              ...prev,
              violations: [v, ...prev.violations],
              users: prev.users.map(u => u.id === guardId ? { ...u, violations: (u.violations ?? 0) + 1 } : u),
            }), language === "ar" ? "تم تسجيل المخالفة" : "Violation recorded");
            void saveApprovedUser({ ...guard, violations: (guard.violations ?? 0) + 1 });
            (e.target as HTMLFormElement).reset();
          }} className="space-y-4 mb-6">
            <div className="font-black text-white mb-3">{language === "ar" ? "تسجيل مخالفة جديدة" : "Record New Violation"}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Lbl>{language === "ar" ? "الحارس" : "Guard"}</Lbl>
                <SelInput name="guardId" required>
                  <option value="">{language === "ar" ? "اختر الحارس" : "Select guard"}</option>
                  {guardUsers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "نوع المخالفة" : "Type"}</Lbl><TxtInput name="type" required placeholder={language === "ar" ? "مثال: تأخر، غياب..." : "e.g. Late, Absent..."} /></div>
              <div><Lbl>{language === "ar" ? "الخطورة" : "Severity"}</Lbl>
                <SelInput name="severity">
                  <option value="minor">{language === "ar" ? "بسيطة" : "Minor"}</option>
                  <option value="major">{language === "ar" ? "متوسطة" : "Major"}</option>
                  <option value="critical">{language === "ar" ? "حرجة" : "Critical"}</option>
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "الوصف" : "Description"}</Lbl><TxtInput name="description" required /></div>
            </div>
            <Btn type="submit" className="w-full">{language === "ar" ? "تسجيل المخالفة" : "Record Violation"}</Btn>
          </form>
        )}
        {mergedViolations.length === 0
          ? <EmptyMsg title={language === "ar" ? "لا مخالفات" : "No Violations"} text="" />
          : mergedViolations.map(v => (
            <div key={v.id} className={`mb-3 rounded-2xl border p-4 ${v.severity === "critical" ? "border-red-500/30 bg-red-500/5" : v.severity === "major" ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-black text-white">{v.guardName} <span className="text-xs text-slate-400 font-normal">· {v.date}</span></div>
                  <div className="text-sm text-slate-300 mt-1">{v.type} — {v.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={v.severity === "critical" ? "border-red-400/30 bg-red-500/15 text-red-300" : v.severity === "major" ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>{v.severity}</Badge>
                  {!v.acknowledged && isOwner && (
                    <Btn variant="secondary" className="h-7 px-2 text-xs" onClick={() => {
                      mutate(prev => ({ ...prev, violations: prev.violations.map(x => x.id === v.id ? { ...x, acknowledged: true } : x) }));
                      void updateViolationRemote(v.id, { acknowledged: true });
                    }}>{language === "ar" ? "إقرار" : "Ack"}</Btn>
                  )}
                </div>
              </div>
            </div>
          ))
        }
      </Panel>
    </div>
  );

  const renderAudit = () => (
    <div className="space-y-4">
      <SectionHead title={language === "ar" ? "سجل التدقيق" : "Audit Log"} />
      {snapshot.auditLog.slice(0, 50).map(e => (
        <div key={e.id} className={`rounded-2xl border p-3 text-sm ${e.severity === "critical" ? "border-red-500/20 bg-red-500/5" : e.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
          <div className="flex justify-between"><span className="font-bold text-white">{e.actorName}</span><span className="text-xs text-slate-400">{e.time}</span></div>
          <div className="text-slate-400">{e.action} · {e.target}</div>
          <div className="text-xs text-slate-500">{e.details}</div>
        </div>
      ))}
    </div>
  );

  const renderSettings = () => {
    const handleChangePw = (e: FormEvent) => {
      e.preventDefault();
      setChangePwError("");
      if (!currentUser) return;
      if (hashPassword(changePwForm.current) !== currentUser.passwordHash) {
        setChangePwError(language === "ar" ? "كلمة السر الحالية غير صحيحة" : "Current password is incorrect");
        return;
      }
      if (changePwForm.newPw.length < 6) {
        setChangePwError(language === "ar" ? "كلمة السر الجديدة قصيرة جداً (6 أحرف على الأقل)" : "New password too short (min 6 chars)");
        return;
      }
      if (changePwForm.newPw !== changePwForm.confirm) {
        setChangePwError(language === "ar" ? "كلمتا السر غير متطابقتين" : "Passwords do not match");
        return;
      }
      const updated = { ...currentUser, passwordHash: hashPassword(changePwForm.newPw) };
      mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === currentUser.id ? updated : u) }));
      void saveApprovedUser(updated);
      showToast(language === "ar" ? "✅ تم تغيير كلمة السر" : "✅ Password changed", "success");
      setChangePwForm({ current: "", newPw: "", confirm: "" });
    };

    const forceSync = () => {
      if (!isOnline) { showToast(language === "ar" ? "لا يوجد اتصال بالإنترنت" : "No internet connection", "danger"); return; }
      setSyncQueue([]);
      window.localStorage.setItem(SYNC_KEY, "[]");
      showToast(language === "ar" ? "✅ تمت المزامنة" : "✅ Synced", "success");
    };

    return (
      <div className="space-y-6">
        <SectionHead title={language === "ar" ? "الإعدادات" : "Settings"} subtitle={currentUser?.name} />

        {/* ── Offline warning banner ── */}
        {!isOnline && (
          <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-3">
            <span className="text-2xl">📵</span>
            <div>
              <div className="font-black text-red-300">{language === "ar" ? "أنت غير متصل بالإنترنت" : "You are offline"}</div>
              <div className="text-sm text-red-400 mt-1">{language === "ar" ? `سيتم حفظ بياناتك محلياً (${syncQueue.length} عملية معلقة)` : `Your data is saved locally (${syncQueue.length} pending)`}</div>
            </div>
          </div>
        )}

        {/* ── Section 1: Personal Preferences ── */}
        <Panel>
          <div className="mb-4 font-black text-amber-400">⚙️ {language === "ar" ? "التفضيلات الشخصية" : "Personal Preferences"}</div>
          <div className="space-y-5">

            {/* Language */}
            <div>
              <Lbl>{language === "ar" ? "اللغة" : "Language"}</Lbl>
              <div className="flex gap-2">
                <Btn variant={language === "ar" ? "primary" : "secondary"} onClick={() => { setLanguage("ar"); document.documentElement.dir = "rtl"; document.documentElement.lang = "ar"; window.localStorage.setItem(LANGUAGE_KEY, "ar"); }}>🇸🇦 العربية</Btn>
                <Btn variant={language === "en" ? "primary" : "secondary"} onClick={() => { setLanguage("en"); document.documentElement.dir = "ltr"; document.documentElement.lang = "en"; window.localStorage.setItem(LANGUAGE_KEY, "en"); }}>🇬🇧 English</Btn>
              </div>
            </div>

            {/* Sound toggle */}
            <div>
              <Lbl>{language === "ar" ? "صوت الإشعارات" : "Notification Sound"}</Lbl>
              <div className="flex items-center gap-3">
                <button onClick={() => {
                  if (!currentUser) return;
                  const updated = { ...currentUser, soundEnabled: !currentUser.soundEnabled };
                  mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === currentUser.id ? updated : u) }));
                  void saveApprovedUser(updated);
                  showToast(updated.soundEnabled ? (language === "ar" ? "🔊 الصوت مفعّل" : "🔊 Sound on") : (language === "ar" ? "🔇 الصوت مكتوم" : "🔇 Sound off"), "info");
                }} className={`relative h-8 w-14 rounded-full border transition ${currentUser?.soundEnabled ? "border-emerald-400/40 bg-emerald-500/20" : "border-white/10 bg-white/5"}`}>
                  <span className={`absolute top-1 h-6 w-6 rounded-full transition-all ${currentUser?.soundEnabled ? "start-7 bg-emerald-400" : "start-1 bg-slate-600"}`} />
                </button>
                <span className="text-sm text-slate-400">{currentUser?.soundEnabled ? (language === "ar" ? "مفعّل" : "Enabled") : (language === "ar" ? "مكتوم" : "Muted")}</span>
                {!currentUser?.soundEnabled && <span className="text-xs text-amber-400">⚠️ {language === "ar" ? "لن تسمع إشعارات الطوارئ!" : "You won't hear emergency alerts!"}</span>}
              </div>
            </div>

            {/* Time format */}
            <div>
              <Lbl>{language === "ar" ? "تنسيق الوقت" : "Time Format"}</Lbl>
              <div className="flex gap-2">
                <Btn variant={!use24h ? "primary" : "secondary"} onClick={() => {
                  setUse24h(false);
                  window.localStorage.setItem("mustafaqa-24h", "false");
                  showToast(language === "ar" ? "توقيت 12 ساعة" : "12-hour format", "info");
                }}>🕐 12h {language === "ar" ? "(ص/م)" : "(AM/PM)"}</Btn>
                <Btn variant={use24h ? "primary" : "secondary"} onClick={() => {
                  setUse24h(true);
                  window.localStorage.setItem("mustafaqa-24h", "true");
                  showToast(language === "ar" ? "توقيت 24 ساعة" : "24-hour format", "info");
                }}>🕐 24h</Btn>
              </div>
              <div className="mt-2 text-xs text-slate-500">
                {language === "ar" ? "مثال: " : "Example: "}
                <span className="font-mono text-amber-400">{formatTime(nowStamp(), use24h)}</span>
              </div>
            </div>

            {/* Desktop notifications */}
            <div>
              <Lbl>{language === "ar" ? "إشعارات سطح المكتب / الهاتف" : "Desktop / Push Notifications"}</Lbl>
              <div className="flex items-center gap-3">
                <Btn variant="secondary" onClick={requestDesktopNotification}>
                  🔔 {language === "ar" ? "طلب الإذن" : "Request Permission"}
                </Btn>
                <Badge className={notificationPermission === "granted" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                  {notificationPermission === "granted" ? (language === "ar" ? "✅ مفعّل" : "✅ Granted") : notificationPermission === "denied" ? (language === "ar" ? "❌ مرفوض" : "❌ Denied") : (language === "ar" ? "⏳ لم يُحدد" : "⏳ Not set")}
                </Badge>
              </div>
              {notificationPermission !== "granted" && (
                <p className="mt-2 text-xs text-slate-500">{language === "ar" ? "مطلوب لاستقبال إشعارات الطوارئ حتى وأنت خارج التطبيق" : "Required to receive emergency alerts even when app is in background"}</p>
              )}
            </div>
          </div>
        </Panel>

        {/* ── Section 2: Connection & Sync ── */}
        <Panel>
          <div className="mb-4 font-black text-amber-400">🔄 {language === "ar" ? "الاتصال والمزامنة" : "Connection & Sync"}</div>
          <div className="space-y-4">
            <div className={`flex items-center gap-3 rounded-2xl border p-4 ${isOnline ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
              <span className={`h-3 w-3 rounded-full ${isOnline ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              <div className="flex-1">
                <div className="font-bold text-white">{isOnline ? (language === "ar" ? "متصل بالإنترنت" : "Online") : (language === "ar" ? "غير متصل" : "Offline")}</div>
                <div className="text-xs text-slate-400">{language === "ar" ? "Firebase Firestore" : "Firebase Firestore"}</div>
              </div>
              <Badge className={isOnline ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                {isOnline ? "Online" : "Offline"}
              </Badge>
            </div>

            {syncQueue.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-amber-300">⏳ {language === "ar" ? "عمليات معلقة" : "Pending Operations"}</div>
                    <div className="text-sm text-slate-400 mt-1">{syncQueue.length} {language === "ar" ? "عملية مخزنة محلياً بانتظار الإرسال" : "operations stored locally"}</div>
                  </div>
                  <Btn variant="secondary" onClick={forceSync}>{language === "ar" ? "🔄 مزامنة" : "🔄 Sync Now"}</Btn>
                </div>
              </div>
            )}

            {syncQueue.length === 0 && isOnline && (
              <div className="text-sm text-slate-500 text-center py-2">✅ {language === "ar" ? "جميع البيانات متزامنة" : "All data is synced"}</div>
            )}
          </div>
        </Panel>

        {/* ── Section 3: Owner Master Controls ── */}
        {isOwner && (
          <Panel>
            <div className="mb-4 font-black text-amber-400">👑 {language === "ar" ? "تحكم المالك — الصوت الرئيسي" : "Owner — Master Sound Control"}</div>
            <div className="space-y-2">
              {approvedUsers.filter(u => u.id !== currentUser?.id).map(u => (
                <div key={u.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <div className="font-bold text-white text-sm">{u.name}</div>
                    <div className="text-xs text-slate-500">{pair(language, roleLabels[u.role])}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={u.soundEnabled ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                      {u.soundEnabled ? "🔊" : "🔇"}
                    </Badge>
                    {!u.soundEnabled && (
                      <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => {
                        const updated = { ...u, soundEnabled: true };
                        mutate(prev => ({ ...prev, users: prev.users.map(x => x.id === u.id ? updated : x) }));
                        void saveApprovedUser(updated);
                        showToast(language === "ar" ? `🔊 تم تفعيل صوت ${u.name}` : `🔊 Sound restored for ${u.name}`, "success");
                      }}>{language === "ar" ? "إعادة تفعيل" : "Restore"}</Btn>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* ── Section 4: Security ── */}
        <Panel>
          <div className="mb-4 font-black text-amber-400">🔐 {language === "ar" ? "الأمان" : "Security"}</div>
          <div className="space-y-4">
            {/* Device ID */}
            <div>
              <Lbl>{language === "ar" ? "معرف الجهاز" : "Device ID"}</Lbl>
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <span className="font-mono text-sm text-amber-400">{deviceId}</span>
                <span className="text-xs text-slate-500">{language === "ar" ? "(خاص بهذا الجهاز)" : "(device-specific)"}</span>
              </div>
            </div>

            {/* Change password */}
            <div>
              <Lbl>{language === "ar" ? "تغيير كلمة السر" : "Change Password"}</Lbl>
              <form onSubmit={handleChangePw} className="space-y-3">
                <TxtInput type="password" placeholder={language === "ar" ? "كلمة السر الحالية" : "Current password"} value={changePwForm.current} onChange={e => setChangePwForm(p => ({ ...p, current: e.target.value }))} />
                <TxtInput type="password" placeholder={language === "ar" ? "كلمة السر الجديدة" : "New password (min 6)"} value={changePwForm.newPw} onChange={e => setChangePwForm(p => ({ ...p, newPw: e.target.value }))} />
                <TxtInput type="password" placeholder={language === "ar" ? "تأكيد كلمة السر" : "Confirm new password"} value={changePwForm.confirm} onChange={e => setChangePwForm(p => ({ ...p, confirm: e.target.value }))} />
                {changePwError && <div className="text-sm text-red-400">{changePwError}</div>}
                <Btn type="submit" variant="secondary" className="w-full">{language === "ar" ? "🔑 تغيير كلمة السر" : "🔑 Change Password"}</Btn>
              </form>
            </div>
          </div>
        </Panel>

        {/* ── Logout ── */}
        <Panel>
          <div className="text-sm text-slate-400 mb-4">
            {language === "ar" ? "تسجيل الخروج لا يحذف البيانات المحفوظة محلياً — ستبقى آمنة حتى تتم مزامنتها." : "Logout preserves locally stored data — it stays safe until synced."}
          </div>
          <Btn variant="danger" className="w-full h-14 text-lg" onClick={() => {
            setCurrentUserId(null);
            setAuthError(null);
            setAuthInfo(null);
            window.localStorage.removeItem(SESSION_KEY);
            showToast(language === "ar" ? "تم تسجيل الخروج بأمان" : "Logged out safely", "info");
          }}>
            🚪 {language === "ar" ? "تسجيل الخروج" : "Logout"}
          </Btn>
        </Panel>
      </div>
    );
  };

  const renderSystem = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "إعدادات النظام" : "System Settings"} subtitle={language === "ar" ? "للمالك فقط" : "Owner only"} />

      <Panel>
        <div className="mb-4 font-black text-amber-400">🏢 {language === "ar" ? "معلومات المنظمة" : "Organization Info"}</div>
        <div className="space-y-4">
          <div><Lbl>{language === "ar" ? "اسم المنظمة" : "Organization Name"}</Lbl>
            <TxtInput value={String(snapshot.systemSettings.orgName ?? "")} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, orgName: e.target.value } }))} />
          </div>
          <div><Lbl>{language === "ar" ? "رسالة ترحيب الحراس (عربي)" : "Guard Welcome Message (Arabic)"}</Lbl>
            <TxtArea rows={2} value={snapshot.systemSettings.welcomeAr} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, welcomeAr: e.target.value } }))} />
          </div>
          <div><Lbl>{language === "ar" ? "رسالة ترحيب الحراس (English)" : "Guard Welcome Message (English)"}</Lbl>
            <TxtArea rows={2} value={snapshot.systemSettings.welcomeEn} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, welcomeEn: e.target.value } }))} />
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="mb-4 font-black text-amber-400">🚨 {language === "ar" ? "إعدادات الطوارئ" : "Emergency Settings"}</div>
        <div className="space-y-4">
          <div><Lbl>{language === "ar" ? "رقم الطوارئ الموحد" : "Emergency Contact Number"}</Lbl>
            <TxtInput value={snapshot.systemSettings.emergencyContact} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, emergencyContact: e.target.value } }))} placeholder="999" />
          </div>
          <div><Lbl>{language === "ar" ? "بريد التنبيهات الحرجة" : "Critical Alert Email"}</Lbl>
            <TxtInput type="email" value={snapshot.systemSettings.criticalEmail} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, criticalEmail: e.target.value } }))} />
          </div>
          <div><Lbl>{language === "ar" ? "SMS الطوارئ" : "Emergency SMS Number"}</Lbl>
            <TxtInput value={snapshot.systemSettings.criticalSms} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, criticalSms: e.target.value } }))} />
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="mb-4 font-black text-amber-400">🕐 {language === "ar" ? "إعدادات الزوار" : "Visitor Settings"}</div>
        <div>
          <Lbl>{language === "ar" ? "وقت التذكير قبل وصول الزائر (بالدقائق)" : "Visitor reminder time (minutes before arrival)"}</Lbl>
          <div className="flex items-center gap-3">
            <TxtInput type="number" className="max-w-[120px]" min="5" max="120" value={snapshot.systemSettings.visitorReminderMinutes} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, visitorReminderMinutes: Number(e.target.value) } }))} />
            <span className="text-sm text-slate-400">{language === "ar" ? "دقيقة" : "minutes"}</span>
          </div>
        </div>
      </Panel>

      <Btn className="w-full" onClick={() => showToast(language === "ar" ? "✅ تم حفظ الإعدادات" : "✅ Settings saved", "success")}>
        💾 {language === "ar" ? "حفظ جميع الإعدادات" : "Save All Settings"}
      </Btn>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "dashboard": return renderDashboard();
      case "reports": return renderReports();
      case "alerts": return renderAlerts();
      case "buildings": return renderBuildings();
      case "users": return renderUsers();
      case "visitors": return renderVisitors();
      case "attendance": return renderAttendance();
      case "tasks": return renderTasks();
      case "chat": return renderChat();
      case "analytics": return renderAnalytics();
      case "scores": return renderScores();
      case "patrol": return renderPatrol();
      case "audit": return renderAudit();
      case "system": return renderSystem();
      case "settings": return renderSettings();
      case "violations": return renderViolations();
      case "map": return renderMap();
      case "sos": return renderSOS();
      default: return renderDashboard();
    }
  };

  if (!currentUser) {
    return (
      <AuthScreen language={language} buildings={snapshot.buildings} errorMessage={authError} infoMessage={authInfo} onSignIn={handleSignIn} onCreateAccount={handleCreateAccount} onLanguageChange={lang => { setLanguage(lang); document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; window.localStorage.setItem(LANGUAGE_KEY, lang); }} />
    );
  }

  return (
    <div dir={language === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#040818] text-white">
      {mergedSOSEvents.some(s => !s.resolved) && (
        <div className="border-b border-red-500/50 bg-red-600 px-4 py-2 text-center text-sm font-black tracking-wide animate-pulse">
          🚨 {language === "ar" ? "تنبيه SOS نشط — تحقق من لوحة SOS" : "ACTIVE SOS ALERT — Check SOS Panel"}
        </div>
      )}
      {!hasActiveEmergency && (
        <div className="border-b border-emerald-400/20 bg-emerald-600/90 px-4 py-2 text-center text-sm font-black tracking-[0.22em]">
          {language === "ar" ? "الوضع التشغيلي طبيعي" : "NORMAL OPERATING MODE"} · {APP_NAME}
        </div>
      )}
      <header className="border-b border-white/10 bg-[#0a1024]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-[22px] border border-amber-400/30 bg-[#111b3d] p-3 shadow-[0_0_28px_rgba(245,158,11,0.35)]">
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 5.25-3 8.5-7 10-4-1.5-7-4.75-7-10V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div>
              <div className="text-4xl font-black tracking-wide text-amber-400">{APP_NAME}</div>
              <div className="text-sm font-semibold text-slate-400">منصة الأمن المتكاملة</div>
            </div>
          </div>
          <div className="text-center lg:text-end">
            <div className="text-2xl font-black text-white">{language === "ar" ? `أهلاً ${currentUser.name}` : `Hello, ${currentUser.name}`}</div>
            <div className="mt-1 text-sm text-slate-400">{currentUser.email}</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2 lg:justify-end">
              <Badge className={getRoleBadgeClass(currentUser.role)}>{pair(language, roleLabels[currentUser.role])}</Badge>
              <Badge className={isOnline ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}>{isOnline ? (language === "ar" ? "متصل" : "Online") : (language === "ar" ? "بدون إنترنت" : "Offline")}</Badge>
            </div>
          </div>
        </div>
      </header>
      <nav className="border-b border-white/10 bg-[#070d22]">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3">
          {visibleTabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`inline-flex min-w-max items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${activeTab === tab ? "border-amber-400/40 bg-amber-500/10 text-amber-300" : tab === "sos" ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20" : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-white"}`}>
              {tab === "sos" && "🚨 "}
              {pair(language, tabLabels[tab] ?? { ar: tab, en: tab })}
            </button>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8">{renderContent()}</main>
      <VisitorManagementModal open={visitorModalOpen} language={language} buildings={snapshot.buildings} onClose={() => setVisitorModalOpen(false)} onSubmit={payload => { void createVisitor(payload); }} />
      <QrScannerModal open={qrModalOpen} title={language === "ar" ? "ماسح QR" : "QR Scanner"} hint={language === "ar" ? "وجّه الكاميرا نحو رمز QR" : "Point camera at QR code"} closeLabel={language === "ar" ? "إغلاق" : "Close"} onClose={() => { setQrModalOpen(false); setQrContext(null); }} onDetected={handleQrDetected} allowManual={qrContext === "report" || qrContext === "patrol"} />
      {emergencyActive && (
        <div className="fixed bottom-20 right-4 z-50">
          <Btn variant="danger" onClick={() => { stopEmergencySound(); setEmergencyActive(false); }}>{language === "ar" ? "🔇 إيقاف الصفارة" : "🔇 Stop Siren"}</Btn>
        </div>
      )}
      {toast && <div className="fixed bottom-4 left-1/2 z-50 w-[min(90vw,460px)] -translate-x-1/2"><div className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${getToastClass(toast.tone)}`}>{toast.text}</div></div>}

      {/* ── Building QR Modal ── */}
      {qrModalBuilding && (() => {
        const b = snapshot.buildings.find(x => x.id === qrModalBuilding);
        const qrImg = buildingQrImages[qrModalBuilding];
        if (!b) return null;
        const assignedGuard = guardUsers.find(u => u.assignedBuildingId === b.id);
        return (
          <div className="fixed inset-0 z-[90] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.9)" }}
            onClick={e => { if (e.target === e.currentTarget) setQrModalBuilding(null); }}>
            <div className="mx-4 w-full max-w-sm rounded-[28px] border border-white/10 bg-[#0b132b] p-6 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-black text-amber-400">{language === "ar" ? b.nameAr : b.nameEn}</div>
                  <div className="text-xs text-slate-400">{b.area} · {b.qrCode}</div>
                </div>
                <button onClick={() => setQrModalBuilding(null)} className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300">✕</button>
              </div>

              {/* QR Code */}
              <div className="flex justify-center">
                {qrImg
                  ? <div className="rounded-2xl bg-white p-4 shadow-xl"><img src={qrImg} alt={`QR ${b.nameEn}`} className="h-52 w-52" /></div>
                  : <div className="flex h-52 w-52 items-center justify-center rounded-2xl bg-white/10 text-slate-500 text-sm">{language === "ar" ? "جارٍ إنشاء QR..." : "Generating..."}</div>
                }
              </div>

              {/* Security note */}
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">
                🔒 {language === "ar"
                  ? "هذا الرمز مخصص للمالك فقط — اطبعه وضعه في المبنى، لا يمكن للحراس رؤيته داخل التطبيق"
                  : "Owner only — print this and place it in the building. Guards cannot see it in the app."}
              </div>

              {/* Actions */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Btn onClick={async () => {
                  if (!qrImg) return;
                  const a = document.createElement("a"); a.href = qrImg;
                  a.download = `QR-${b.qrCode}.png`; a.click();
                  showToast(language === "ar" ? "✅ تم تنزيل QR" : "✅ QR Downloaded");
                }}>⬇ {language === "ar" ? "تنزيل للطباعة" : "Download"}</Btn>
                <Btn variant="secondary" onClick={async () => {
                  if (!qrImg) return;
                  try {
                    const blob = await fetch(qrImg).then(r => r.blob());
                    await navigator.share({ files: [new File([blob], `QR-${b.qrCode}.png`, { type: "image/png" })], title: `QR ${b.nameEn}` });
                  } catch {
                    const a = document.createElement("a"); a.href = qrImg;
                    a.download = `QR-${b.qrCode}.png`; a.click();
                    showToast(language === "ar" ? "تم تنزيل QR" : "QR Downloaded");
                  }
                }}>↗ {language === "ar" ? "مشاركة" : "Share"}</Btn>
              </div>

              {/* Send to guard via chat */}
              {assignedGuard && (isOwner || isAdmin) && qrImg && (
                <Btn variant="secondary" className="mt-2 w-full" onClick={() => {
                  // Send QR as image in chat to assigned guard
                  const conv = visibleConversations.find(c => c.participantId === assignedGuard.id)
                    ?? { id: `c-${assignedGuard.id}`, participantId: assignedGuard.id, participantName: assignedGuard.name, participantRole: assignedGuard.role as Role, messages: [] };
                  const msg: ChatMessage = {
                    id: `msg-${Date.now()}`, senderId: currentUser?.id ?? "", kind: "image",
                    imageUrl: qrImg,
                    text: `QR رمز ${language === "ar" ? b.nameAr : b.nameEn} — اطبعه وضعه في مكان واضح`,
                    time: chatTime(language),
                  };
                  const updated = { ...conv, messages: [...(conv.messages ?? []), msg] };
                  void saveConversation(updated);
                  mutate(prev => {
                    const exists = prev.conversations.find(c => c.id === conv.id);
                    if (exists) return { ...prev, conversations: prev.conversations.map(c => c.id === conv.id ? updated : c) };
                    return { ...prev, conversations: [updated, ...prev.conversations] };
                  });
                  setQrModalBuilding(null);
                  setActiveTab("chat");
                  showToast(language === "ar" ? `✅ تم إرسال QR لـ ${assignedGuard.name}` : `✅ QR sent to ${assignedGuard.name}`, "success");
                }}>
                  💬 {language === "ar" ? `إرسال لـ ${assignedGuard.name} عبر الشات` : `Send to ${assignedGuard.name} via Chat`}
                </Btn>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Permission Modal ── */}
      {showPermissionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.85)" }}>
          <div className="mx-4 w-full max-w-sm rounded-[28px] border border-amber-400/30 bg-[#0b132b] p-6 shadow-2xl">
            <div className="mb-4 flex justify-center"><div className="flex h-20 w-20 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/10 text-5xl">🔔</div></div>
            <h2 className="mb-2 text-center text-xl font-black text-white">
              {language === "ar" ? "تفعيل الإشعارات" : "Enable Notifications"}
            </h2>
            <p className="mb-6 text-center text-sm text-slate-400">
              {language === "ar"
                ? "للحصول على إشعارات الطوارئ والتقارير والمهام حتى عند إغلاق التطبيق — مثل واتساب تماماً"
                : "Get emergency alerts, reports and task notifications even when the app is closed — just like WhatsApp"}
            </p>
            <div className="space-y-3">
              <Btn className="w-full h-14 text-base" onClick={async () => {
                setShowPermissionModal(false);
                try {
                  const perm = await Notification.requestPermission();
                  setNotificationPermission(perm);
                  if (perm === "granted" && currentUserId) {
                    await initFCM(currentUserId);
                    showToast(language === "ar" ? "✅ تم تفعيل الإشعارات!" : "✅ Notifications enabled!", "success");
                  } else {
                    showToast(language === "ar" ? "⚠️ لم يتم تفعيل الإشعارات" : "⚠️ Notifications not enabled", "danger");
                  }
                } catch { /* ignore */ }
              }}>
                🔔 {language === "ar" ? "السماح بالإشعارات" : "Allow Notifications"}
              </Btn>
              <button
                onClick={async () => {
                  setShowPermissionModal(false);
                  // Still try to init FCM even if declined our modal
                  if (currentUserId) void initFCM(currentUserId);
                }}
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 text-sm text-slate-400 hover:bg-white/10 transition"
              >
                {language === "ar" ? "ليس الآن" : "Not now"}
              </button>
            </div>
            <p className="mt-4 text-center text-xs text-slate-600">
              {language === "ar" ? "يمكنك تفعيلها لاحقاً من الإعدادات" : "You can enable later from Settings"}
            </p>
          </div>
        </div>
      )}
      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full mx-4" onClick={e => e.stopPropagation()}>
            <img src={lightboxUrl} alt="" className="w-full h-full object-contain rounded-2xl max-h-[80vh]" />
            <div className="mt-3 flex justify-center gap-3">
              <a
                href={lightboxUrl}
                download="report-photo.jpg"
                className="rounded-2xl bg-amber-500 px-6 py-2.5 text-sm font-black text-black"
                onClick={e => e.stopPropagation()}
              >⬇️ {language === "ar" ? "تحميل الصورة" : "Download"}</a>
              <button
                className="rounded-2xl border border-white/20 bg-white/10 px-6 py-2.5 text-sm font-bold text-white"
                onClick={() => setLightboxUrl(null)}
              >✕ {language === "ar" ? "إغلاق" : "Close"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

