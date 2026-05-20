import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import AuthScreen from "./components/AuthScreen";
import QrScannerModal from "./components/QrScannerModal";
import VisitorManagementModal from "./components/VisitorManagementModal";
import { playNormalAlertSound, registerNotificationServiceWorker, sendToServiceWorker, showSystemNotification, startEmergencySound, stopEmergencySound, vibrateDevice, vibrateEmergency } from "./services/notificationService";
import { deleteApprovedUserRemote, deletePendingUserRemote, ensureRemoteSeed, saveApprovedUser, savePendingUser, subscribeApprovedUsers, subscribeConversations, subscribePendingUsers, saveConversation, subscribeReports, saveReport, deleteReportRemote, subscribeAlerts, saveAlert, subscribeVisitors, saveVisitor, updateVisitorRemote, subscribeAttendance, saveAttendance, subscribeTasks, saveTask, updateTaskRemote, deleteTaskRemote, subscribeShifts, saveShift, updateShiftRemote, subscribeViolations, saveViolation, updateViolationRemote, subscribeSOSEvents, saveSOSEvent, updateSOSEventRemote } from "./services/firebaseData";
import { exportReportsPDF, exportShiftReportPDF, exportFullDashboardPDF } from "./services/pdfService";
import { generateVisitorQR, generateBuildingQR } from "./services/qrService";
import { analyzeData } from "./services/analyticsService";
import { validateEmail } from "./services/emailVerification";
import type { AlertLog, AppSnapshot, AttendanceRecord, AuditEntry, AuditSeverity, Building, ChatMessage, Conversation, Language, NewAccountPayload, Pair, Report, ReportStatus, Role, Shift, SOSEvent, Tab, Task, Toast, ToastTone, User, Violation, VisitorFormPayload, VisitorRecord } from "./types/security";

const STORAGE_KEY = "mustafaqa-v1";
const SESSION_KEY = "mustafaqa-session-v1";
const LANGUAGE_KEY = "mustafaqa-lang-v1";
const SYNC_KEY = "mustafaqa-sync-v1";
const ACTIVE_KEY = "mustafaqa-active-v1";
const REPORTS_PER_PAGE = 6;
const VISITOR_REMINDER_MINUTES = 30;
const VISITOR_ARRIVAL_REMIND_MINUTES = 15;
const APP_NAME = "MUSTAFA.QA";

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
  shifts: { ar: "النوبات", en: "Shifts" },
  violations: { ar: "المخالفات", en: "Violations" },
  map: { ar: "الخريطة", en: "Map" },
  sos: { ar: "طوارئ SOS", en: "SOS" },
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
  shifts: { ar: "النوبات", en: "Shifts" },
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
    ["gate-1", "البوابة 1", "GATE 1", "Gate Zone", "QA-GATE-1", 25.2854, 51.5310],
    ["gate-2", "البوابة 2", "GATE 2", "Gate Zone", "QA-GATE-2", 25.2860, 51.5315],
    ["reception", "الاستقبال", "RECEPTION", "Front Desk", "QA-REC", 25.2858, 51.5312],
    ["building-2", "المبني 2", "BUILDING 2", "Building Zone", "QA-B2", 25.2856, 51.5318],
    ["building-3", "المبني 3", "BUILDING 3", "Building Zone", "QA-B3", 25.2862, 51.5320],
    ["cctv-room", "غرفة الكاميرات", "CCTV ROOM", "Control Room", "QA-CCTV", 25.2850, 51.5308],
  ] as [string, string, string, string, string, number, number][]).map(([id, nameAr, nameEn, area, qrCode, lat, lng]) => ({ id, nameAr, nameEn, area, qrCode, lat, lng }));
}

function buildSeedState(): AppSnapshot {
  const buildings = buildSeedBuildings();
  const allPerms = Object.keys(permissionLabels);
  const users: User[] = [
    { id: "owner-1", name: "Mustafa Khojali", email: "mustafakhojali884@gmail.com", phone: "0555555555", role: "owner", status: "approved", permissions: allPerms, rating: 5, passwordHash: hashPassword("mus2003kh"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: true, createdAt: "2026-05-01 08:00", violations: 0 },
    { id: "admin-1", name: "Abeer Al-Harbi", email: "abeer.admin@mustafa.qa", phone: "", role: "admin", status: "approved", permissions: ["reports", "alerts", "attendance", "buildings", "viewReports", "chat", "visitors", "shifts", "violations"], rating: 4.8, passwordHash: hashPassword("admin123"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: true, createdAt: "2026-05-01 08:10", violations: 0 },
    { id: "guard-1", name: "Fatuma Osman", email: "fatuma@mustafa.qa", phone: "0507788991", role: "guard", status: "approved", assignedBuildingId: "gate-1", permissions: ["reports", "attendance", "chat", "buildings", "visitors", "sos"], rating: 4.9, passwordHash: hashPassword("guard123"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: false, createdAt: "2026-05-01 08:18", violations: 0 },
    { id: "guard-2", name: "Ayman Saeed", email: "ayman@mustafa.qa", phone: "0503344551", role: "guard", status: "approved", assignedBuildingId: "gate-2", permissions: ["reports", "attendance", "chat", "buildings", "visitors", "sos"], rating: 4.6, passwordHash: hashPassword("guard456"), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: "2026-05-01 08:20", violations: 1 },
  ];

  const todayStr = today();
  const shifts: Shift[] = [
    { id: "s1", guardId: "guard-1", guardName: "Fatuma Osman", buildingId: "gate-1", date: todayStr, startTime: "07:00", endTime: "19:00", status: "active", checkInTime: "07:02", createdAt: nowStamp() },
    { id: "s2", guardId: "guard-2", guardName: "Ayman Saeed", buildingId: "gate-2", date: todayStr, startTime: "07:00", endTime: "19:00", status: "active", checkInTime: "07:10", createdAt: nowStamp() },
  ];
  const violations: Violation[] = [
    { id: "v1", guardId: "guard-2", guardName: "Ayman Saeed", type: "Late Arrival", description: "Guard arrived 30 minutes late without notice.", severity: "minor", buildingId: "gate-2", issuedBy: "Mustafa Khojali", issuedAt: "2026-05-06 08:35", acknowledged: false },
  ];
  const sosEvents: SOSEvent[] = [];

  return {
    buildings, users,
    reports: [
      { id: "r1", buildingId: "gate-1", text: "حركة الدخول طبيعية وتم التحقق من الهويات.", senderId: "guard-2", senderName: "Ayman Saeed", senderEmail: "ayman@mustafa.qa", senderPhone: "0503344551", time: "2026-05-06 08:43", status: "normal" },
      { id: "r2", buildingId: "gate-1", text: "ازدحام بسيط عند البوابة تم تنظيمه.", senderId: "guard-1", senderName: "Fatuma Osman", senderEmail: "fatuma@mustafa.qa", senderPhone: "0507788991", time: "2026-05-06 08:45", status: "warning" },
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
    auditLog: [createAuditEntry(null, "system_seed", "platform", "تم تهيئة بيانات MUSTAFA.QA", "info")],
    systemSettings: {
      emergencyContact: "999", welcomeAr: "يرجى الالتزام بجميع تعليمات النوبة.", welcomeEn: "Please comply with shift instructions.", criticalEmail: "security@mustafa.qa", criticalSms: "+97455555555", visitorReminderMinutes: VISITOR_REMINDER_MINUTES, orgName: APP_NAME, shiftStartHour: 7, shiftEndHour: 19,
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
  const [language, setLanguage] = useState<Language>(() => loadJson<Language>(LANGUAGE_KEY, "ar"));
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
  const [qrContext, setQrContext] = useState<"attendance" | "report" | null>(null);
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
  const chatFileRef = useRef<HTMLInputElement | null>(null);
  const [visitorQrMap, setVisitorQrMap] = useState<Record<string, string>>({});
  const [shiftFilter, setShiftFilter] = useState<"all" | "today">("today");
  const [violationForm, setViolationForm] = useState({ guardId: "", type: "", description: "", severity: "minor" as Violation["severity"], buildingId: "" });
  const [shiftForm, setShiftForm] = useState({ guardId: "", buildingId: "", date: today(), startTime: "07:00", endTime: "19:00" });
  const [endShiftNote, setEndShiftNote] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  const [reportForm, setReportForm] = useState({ buildingId: buildSeedBuildings()[0].id, text: "", status: "normal" as ReportStatus, mediaUrl: "", mediaKind: "" as "" | "image" | "video", fileName: "" });
  const [alertForm, setAlertForm] = useState({ status: "Fire / حريق", target: "Everyone / إرسال للكل", text: "", customStatus: "" });
  const [taskForm, setTaskForm] = useState({ title: "", details: "", assignedTo: "all", priority: "medium" as Task["priority"], dueDate: "" });
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", phone: "", password: "", role: "guard" as Role, buildingId: buildSeedBuildings()[0].id });

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const reportPhotoRef = useRef<HTMLInputElement | null>(null);
  const [reportScannedBuilding, setReportScannedBuilding] = useState<string>("");
  const reportMediaInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const toastTimer = useRef<number | null>(null);
  const prevAlertCount = useRef(0);
  const initialAlerts = useRef(true);

  // ─── Derived state ───────────────────────────────────────────────────────────
  const approvedUsers = useMemo(() => {
    const map = new Map<string, User>();
    snapshot.users.filter(u => u.status === "approved").forEach(u => map.set(u.id, u));
    remoteApprovedUsers.forEach(u => map.set(u.id, u));
    return Array.from(map.values());
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
    if (isGuard) return ["reports", "buildings", "visitors", "attendance", "tasks", "chat", "shifts", "sos", "settings"];
    if (isAdmin) return ["dashboard", "reports", "alerts", "buildings", "users", "visitors", "attendance", "tasks", "chat", "shifts", "violations", "map", "settings"];
    return ["dashboard", "reports", "alerts", "buildings", "users", "visitors", "attendance", "tasks", "chat", "analytics", "audit", "shifts", "violations", "map", "sos", "system", "settings"];
  }, [isAdmin, isGuard]);

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
    return Array.from(map.values()).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }, [snapshot.violations, remoteViolations]);

  const mergedSOSEvents = useMemo(() => {
    const map = new Map<string, SOSEvent>();
    snapshot.sosEvents.forEach(s => map.set(s.id, s));
    remoteSOSEvents.forEach(s => map.set(s.id, s));
    return Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time));
  }, [snapshot.sosEvents, remoteSOSEvents]);

  const visibleReports = useMemo(() => isGuard && currentUser ? mergedReports.filter(r => r.senderId === currentUser.id) : mergedReports, [currentUser, isGuard, mergedReports]);
  const pagedReports = useMemo(() => visibleReports.slice((reportPage - 1) * REPORTS_PER_PAGE, reportPage * REPORTS_PER_PAGE), [reportPage, visibleReports]);
  const filteredUsers = useMemo(() => { const q = userFilter.trim().toLowerCase(); return q ? approvedUsers.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q)) : approvedUsers; }, [approvedUsers, userFilter]);
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
    if (currentUser.role === "owner") {
      return approvedUsers.filter(u => u.id !== currentUser.id).map(u => {
        const existing = conversationsSource.find(c => c.participantId === u.id);
        return existing ?? { id: `c-${u.id}`, participantId: u.id, participantName: u.name, participantRole: u.role, messages: [] };
      });
    }
    const existing = conversationsSource.find(c => c.participantId === currentUser.id);
    if (existing) return [existing];
    return [{ id: `c-${currentUser.id}`, participantId: currentUser.id, participantName: currentUser.name, participantRole: currentUser.role, messages: [] }];
  }, [approvedUsers, conversationsSource, currentUser]);

  const activeConversation = useMemo(() => visibleConversations.find(c => c.id === conversationId) ?? visibleConversations[0], [conversationId, visibleConversations]);
  const visibleTasks = useMemo(() => isGuard && currentUser ? mergedTasks.filter(t => t.assignedTo === currentUser.id) : snapshot.tasks, [currentUser, isGuard, snapshot.tasks]);

  const todayShifts = useMemo(() => shiftFilter === "today" ? mergedShifts.filter(s => s.date === today()) : mergedShifts, [mergedShifts, shiftFilter]);
  const myShift = useMemo(() => isGuard && currentUser ? mergedShifts.find(s => s.guardId === currentUser.id && s.date === today()) : null, [currentUser, isGuard, mergedShifts]);
  const insights = useMemo(() => analyzeData(mergedReports, mergedShifts, mergedViolations, mergedSOSEvents, mergedAttendance, snapshot.buildings), [mergedReports, mergedShifts, mergedViolations, mergedSOSEvents, mergedAttendance, snapshot.buildings]);

  // ─── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.title = `${APP_NAME} | ${language === "ar" ? "نظام الأمن المتكامل" : "Integrated Security System"}`;
  }, [language]);

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
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    setActiveUserIds(prev => Array.from(new Set([...prev.filter(id => id !== currentUserId), currentUserId])));
    return () => setActiveUserIds(prev => prev.filter(id => id !== currentUserId));
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
    if (remoteAlerts.length > 0)
      setSnapshot(prev => {
        const map = new Map(prev.alerts.map(a => [a.id, a]));
        remoteAlerts.forEach(a => map.set(a.id, a));
        return { ...prev, alerts: Array.from(map.values()).sort((a, b) => b.time.localeCompare(a.time)) };
      });
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
      if (isCritical) { startEmergencySound(); setEmergencyActive(true); vibrateEmergency(); } else { playNormalAlertSound(currentUser.soundEnabled); vibrateDevice(); }
    }
    prevAlertCount.current = mergedAlerts.length;
  }, [currentUser, mergedAlerts]);

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
  };

  const handleCreateAccount = async (payload: NewAccountPayload) => {
    setAuthError(null); setAuthInfo(null);
    const emailCheck = validateEmail(payload.email);
    if (!emailCheck.valid) return setAuthError(language === "ar" ? (emailCheck.errorAr ?? "بريد غير صحيح") : (emailCheck.errorEn ?? "Invalid email"));
    if (snapshot.users.some(u => u.email.toLowerCase() === payload.email.trim().toLowerCase()) ||
        remotePendingUsers.some(u => u.email.toLowerCase() === payload.email.trim().toLowerCase()))
      return setAuthError(language === "ar" ? "البريد مستخدم بالفعل" : "Email already registered");
    if (emailCheck.suggestion) setAuthInfo(emailCheck.suggestion);
    const newUser: User = {
      id: `user-${Date.now()}`, name: payload.name.trim(), email: payload.email.trim(),
      phone: payload.role === "admin" ? "" : payload.phone.trim(), role: payload.role, status: "pending",
      assignedBuildingId: payload.role === "admin" ? undefined : payload.buildingId,
      permissions: payload.role === "admin" ? ["reports", "attendance", "buildings", "viewReports", "chat", "visitors", "shifts"] : ["reports", "attendance", "chat", "buildings", "visitors", "sos"],
      rating: 4, passwordHash: hashPassword(payload.password), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: nowStamp(), violations: 0,
    };
    // Save to Firebase so owner sees it on ANY device
    try {
      await savePendingUser(newUser);
      mutate(prev => ({ ...prev, users: [newUser, ...prev.users], auditLog: [createAuditEntry(null, "account_request", newUser.email, "طلب حساب جديد", "warning"), ...prev.auditLog] }));
      setAuthInfo(language === "ar" ? "تم إرسال الطلب وهو بانتظار موافقة المالك" : "Request submitted — pending owner approval");
    } catch {
      mutate(prev => ({ ...prev, users: [newUser, ...prev.users] }));
      setAuthInfo(language === "ar" ? "تم الإرسال (وضع أوفلاين)" : "Submitted (offline mode)");
    }
  };

  // SOS
  const triggerSOS = useCallback(async () => {
    if (!currentUser) return;
    setSosActive(true);
    startEmergencySound(); setEmergencyActive(true); vibrateEmergency();
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
    setReportForm(prev => ({ ...prev, text: "", status: "normal", mediaUrl: "", mediaKind: "", fileName: "" }));
    setReportScannedBuilding("");
  };

  // Shifts
  const addShift = (e: FormEvent) => {
    e.preventDefault();
    if (!shiftForm.guardId || !shiftForm.buildingId) return;
    const guard = approvedUsers.find(u => u.id === shiftForm.guardId);
    if (!guard) return;
    const shift: Shift = { id: `s-${Date.now()}`, guardId: shiftForm.guardId, guardName: guard.name, buildingId: shiftForm.buildingId, date: shiftForm.date, startTime: shiftForm.startTime, endTime: shiftForm.endTime, status: "scheduled", createdAt: nowStamp() };
    void saveShift(shift);
    mutate(prev => ({ ...prev, shifts: [shift, ...prev.shifts] }), language === "ar" ? "تمت إضافة النوبة" : "Shift added");
    setShiftForm({ guardId: "", buildingId: "", date: today(), startTime: "07:00", endTime: "19:00" });
  };

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
    const v: Violation = { id: `viol-${Date.now()}`, guardId: violationForm.guardId, guardName: guard.name, type: violationForm.type, description: violationForm.description, severity: violationForm.severity, buildingId: violationForm.buildingId || undefined, issuedBy: currentUser.name, issuedAt: nowStamp(), acknowledged: false };
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
    mutate(prev => {
      const exists = prev.conversations.find(c => c.id === activeConversation.id);
      if (exists) return { ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? { ...c, messages: [...c.messages, msg] } : c) };
      return { ...prev, conversations: [{ ...activeConversation, messages: [msg] }, ...prev.conversations] };
    });
  };

  // Approve/reject user
  const approveUser = (userId: string) => {
    if (!currentUser) return;
    mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === userId ? { ...u, status: "approved" } : u), auditLog: [createAuditEntry(currentUser, "approve_user", userId, "تمت الموافقة على المستخدم", "info"), ...prev.auditLog] }), language === "ar" ? "تمت الموافقة" : "Approved");
    const approvedUser = [...snapshot.users, ...remotePendingUsers].find(u => u.id === userId);
    if (approvedUser) void saveApprovedUser({ ...approvedUser, status: "approved" });
    void deletePendingUserRemote(userId);
  };

  const rejectUser = (userId: string) => {
    mutate(prev => ({ ...prev, users: prev.users.filter(u => u.id !== userId) }), language === "ar" ? "تم الرفض" : "Rejected");
    void deletePendingUserRemote(userId);
  };

  const deleteUser = (userId: string) => {
    if (!currentUser || userId === currentUser.id) return;
    mutate(prev => ({ ...prev, users: prev.users.filter(u => u.id !== userId), auditLog: [createAuditEntry(currentUser, "delete_user", userId, "تم حذف المستخدم", "warning"), ...prev.auditLog] }), language === "ar" ? "تم حذف المستخدم" : "Deleted");
    void deleteApprovedUserRemote(userId);
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
      if (data.type === "building" && qrContext === "report") {
        // QR scan for report - auto-fill building
        const building = snapshot.buildings.find(b => b.id === data.buildingId);
        if (building) {
          setReportScannedBuilding(data.buildingId);
          showToast(language === "ar" ? `✅ ${building.nameAr}` : `✅ ${building.nameEn}`, "success");
        } else {
          showToast(language === "ar" ? "مبنى غير معروف" : "Unknown building", "danger");
        }
      } else if (data.type === "building" && qrContext === "attendance") {
        const building = snapshot.buildings.find(b => b.id === data.buildingId);
        if (!building || !currentUser) return;
        if (currentUser.assignedBuildingId && currentUser.assignedBuildingId !== data.buildingId) { showToast(language === "ar" ? "⚠️ هذا المبنى غير مخصص لك" : "⚠️ Building mismatch", "danger"); return; }
        const record: AttendanceRecord = { id: `at-${Date.now()}`, userId: currentUser.id, userName: currentUser.name, buildingId: data.buildingId, method: "qr", time: nowStamp() };
        mutate(prev => ({ ...prev, attendance: [record, ...prev.attendance] }), language === "ar" ? `تم تسجيل الحضور في ${building.nameAr}` : `Checked in at ${building.nameEn}`);
        void saveAttendance(record);
      } else if (data.type === "visitor") {
        const visitor = snapshot.visitors.find(v => v.passCode === data.passCode);
        if (visitor) { mutate(prev => ({ ...prev, visitors: prev.visitors.map(v => v.id === visitor.id ? { ...v, status: "arrived", checkInTime: nowStamp() } : v) }), language === "ar" ? `✅ تم استقبال ${visitor.guestName}` : `✅ ${visitor.guestName} checked in`); void updateVisitorRemote(visitor.id, { status: "arrived", checkInTime: nowStamp() }); }
      }
    } catch { showToast(language === "ar" ? "رمز غير معروف" : "Unknown QR", "danger"); }
    setQrContext(null);
  };

  // ─── Render Sections ──────────────────────────────────────────────────────────
  const renderDashboard = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "لوحة التحكم" : "Dashboard"} subtitle={APP_NAME} />
      {insights.length > 0 && (
        <div className="space-y-3">
          {insights.map((ins, i) => (
            <div key={i} className={`rounded-2xl border p-4 text-sm font-semibold ${ins.type === "critical" ? "border-red-500/30 bg-red-500/10 text-red-200" : ins.type === "warning" ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-sky-500/30 bg-sky-500/10 text-sky-200"}`}>
              <div className="font-black">{language === "ar" ? ins.titleAr : ins.title}</div>
              <div className="mt-1 opacity-80">{language === "ar" ? ins.bodyAr : ins.body}</div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={language === "ar" ? "إجمالي الحراس" : "Total Guards"} value={guardUsers.length} />
        <StatCard label={language === "ar" ? "التقارير الحرجة" : "Critical Reports"} value={mergedReports.filter(r => r.status === "critical").length} color="text-red-300" />
        <StatCard label={language === "ar" ? "أحداث SOS" : "SOS Events"} value={mergedSOSEvents.filter(s => !s.resolved).length} color="text-red-400" />
        <StatCard label={language === "ar" ? "زوار اليوم" : "Today Visitors"} value={mergedVisitors.filter(v => v.arrivalDate === today()).length} color="text-amber-300" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={language === "ar" ? "نوبات اليوم" : "Today Shifts"} value={mergedShifts.filter(s => s.date === today()).length} />
        <StatCard label={language === "ar" ? "مخالفات مفتوحة" : "Open Violations"} value={mergedViolations.filter(v => !v.acknowledged).length} color="text-amber-300" />
        <StatCard label={language === "ar" ? "تقارير تحذير" : "Warning Reports"} value={mergedReports.filter(r => r.status === "warning").length} color="text-amber-300" />
        <StatCard label={language === "ar" ? "إجمالي التقارير" : "Total Reports"} value={mergedReports.length} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 font-black text-white">{language === "ar" ? "آخر التقارير" : "Latest Reports"}</div>
          {mergedReports.slice(0, 4).map(r => (
            <div key={r.id} className="mb-2 flex items-start gap-3 rounded-xl bg-white/5 p-3">
              <Badge className={getStatusBadgeClass(r.status)}>{r.status}</Badge>
              <div><div className="text-sm font-bold text-white">{r.senderName}</div><div className="text-xs text-slate-400">{r.text.slice(0, 60)}…</div></div>
            </div>
          ))}
        </Panel>
        <Panel>
          <div className="mb-3 font-black text-white">{language === "ar" ? "آخر أحداث SOS" : "Latest SOS"}</div>
          {mergedSOSEvents.length === 0 ? <EmptyMsg title={language === "ar" ? "لا أحداث" : "No SOS"} text={language === "ar" ? "لم يُبلَّغ عن أي حوادث" : "No SOS events reported"} /> : mergedSOSEvents.slice(0, 4).map(s => (
            <div key={s.id} className={`mb-2 rounded-xl p-3 ${s.resolved ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-white">{s.guardName}</span>
                <Badge className={s.resolved ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>{s.resolved ? (language === "ar" ? "محلول" : "Resolved") : (language === "ar" ? "نشط" : "Active")}</Badge>
              </div>
              <div className="text-xs text-slate-400">{s.address} · {s.time}</div>
            </div>
          ))}
        </Panel>
      </div>
      <div className="flex flex-wrap gap-3">
        <Btn variant="secondary" onClick={() => { try { exportFullDashboardPDF(snapshot, APP_NAME); showToast(language === "ar" ? "تم تصدير PDF" : "PDF exported"); } catch { showToast("PDF failed", "danger"); } }}>📄 {language === "ar" ? "تصدير PDF" : "Export PDF"}</Btn>
      </div>
    </div>
  );

  const renderSOS = () => (
    <div className="space-y-6">
      <SectionHead title="SOS" subtitle={language === "ar" ? "زر الطوارئ الفوري" : "Instant Emergency Alert"} />
      {isGuard && (
        <Panel>
          <div className="flex flex-col items-center gap-6 py-8">
            <div className="text-6xl">🚨</div>
            <p className="text-center text-slate-300">{language === "ar" ? "اضغط الزر عند وجود خطر فوري. سيتم إرسال موقعك تلقائياً." : "Press in case of immediate danger. Your location will be sent automatically."}</p>
            <Btn variant="sos" className="h-24 w-64 text-2xl font-black" onClick={() => { void triggerSOS(); }}> 🚨 SOS </Btn>
            {myShift && (
              <div className="mt-4 w-full">
                <Lbl>{language === "ar" ? "ملاحظة إضافية" : "Additional Note"}</Lbl>
                <TxtArea rows={3} value={endShiftNote} onChange={e => setEndShiftNote(e.target.value)} placeholder={language === "ar" ? "وصف الحادثة..." : "Describe the incident..."} />
              </div>
            )}
          </div>
        </Panel>
      )}
      <Panel>
        <div className="mb-4 flex items-center justify-between">
          <div className="font-black text-white">{language === "ar" ? "سجل أحداث SOS" : "SOS Event Log"}</div>
        </div>
        {mergedSOSEvents.length === 0 ? <EmptyMsg title={language === "ar" ? "لا أحداث" : "No Events"} text={language === "ar" ? "لم يُسجَّل أي حدث SOS" : "No SOS events recorded"} /> : (
          <div className="space-y-3">
            {mergedSOSEvents.map(s => (
              <div key={s.id} className={`rounded-2xl border p-4 ${s.resolved ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/30 bg-red-500/10"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{s.guardName}</div>
                    <div className="text-sm text-slate-400">{s.time}</div>
                    {s.address && <div className="mt-1 text-xs text-slate-500">📍 {s.address}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={s.resolved ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                      {s.resolved ? (language === "ar" ? "محلول" : "Resolved") : (language === "ar" ? "نشط" : "Active")}
                    </Badge>
                    {!s.resolved && (isOwner || isAdmin) && <Btn variant="secondary" className="text-xs px-3 h-8" onClick={() => resolveSOS(s.id)}>{language === "ar" ? "إغلاق" : "Resolve"}</Btn>}
                  </div>
                </div>
                {s.resolvedBy && <div className="mt-2 text-xs text-emerald-400">✅ {language === "ar" ? "أُغلق بواسطة" : "Resolved by"}: {s.resolvedBy}</div>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );

  const renderShifts = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "إدارة النوبات" : "Shift Management"} />
      {(isOwner || isAdmin) && (
        <Panel>
          <div className="mb-4 font-black text-white">{language === "ar" ? "إضافة نوبة جديدة" : "Add New Shift"}</div>
          <form onSubmit={addShift} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><Lbl>{language === "ar" ? "الحارس" : "Guard"}</Lbl>
              <SelInput value={shiftForm.guardId} onChange={e => setShiftForm(p => ({ ...p, guardId: e.target.value }))}>
                <option value="">{language === "ar" ? "اختر حارساً" : "Select Guard"}</option>
                {guardUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </SelInput>
            </div>
            <div><Lbl>{language === "ar" ? "المبنى" : "Building"}</Lbl>
              <SelInput value={shiftForm.buildingId} onChange={e => setShiftForm(p => ({ ...p, buildingId: e.target.value }))}>
                <option value="">{language === "ar" ? "اختر مبنى" : "Select Building"}</option>
                {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{language === "ar" ? b.nameAr : b.nameEn}</option>)}
              </SelInput>
            </div>
            <div><Lbl>{language === "ar" ? "التاريخ" : "Date"}</Lbl><TxtInput type="date" value={shiftForm.date} onChange={e => setShiftForm(p => ({ ...p, date: e.target.value }))} /></div>
            <div><Lbl>{language === "ar" ? "وقت البداية" : "Start Time"}</Lbl><TxtInput type="time" value={shiftForm.startTime} onChange={e => setShiftForm(p => ({ ...p, startTime: e.target.value }))} /></div>
            <div><Lbl>{language === "ar" ? "وقت النهاية" : "End Time"}</Lbl><TxtInput type="time" value={shiftForm.endTime} onChange={e => setShiftForm(p => ({ ...p, endTime: e.target.value }))} /></div>
            <div className="flex items-end"><Btn type="submit" className="w-full">{language === "ar" ? "إضافة النوبة" : "Add Shift"}</Btn></div>
          </form>
        </Panel>
      )}
      {isGuard && myShift && (
        <Panel>
          <div className="mb-3 font-black text-white">{language === "ar" ? "نوبتك اليوم" : "Your Shift Today"}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <InfoRow label={language === "ar" ? "البداية" : "Start"} value={myShift.startTime} />
            <InfoRow label={language === "ar" ? "النهاية" : "End"} value={myShift.endTime} />
            <InfoRow label={language === "ar" ? "الحالة" : "Status"} value={myShift.status} />
          </div>
          {myShift.status === "active" && (
            <div className="mt-4 space-y-3">
              <TxtArea rows={3} value={endShiftNote} onChange={e => setEndShiftNote(e.target.value)} placeholder={language === "ar" ? "ملاحظات نهاية النوبة..." : "End of shift notes..."} />
              <Btn onClick={() => endShift(myShift.id)}>{language === "ar" ? "إنهاء النوبة وتصدير PDF" : "End Shift & Export PDF"}</Btn>
            </div>
          )}
        </Panel>
      )}
      <Panel>
        <div className="mb-4 flex items-center gap-3">
          <div className="font-black text-white">{language === "ar" ? "النوبات" : "Shifts"}</div>
          <SelInput className="w-40" value={shiftFilter} onChange={e => setShiftFilter(e.target.value as "all" | "today")}>
            <option value="today">{language === "ar" ? "اليوم" : "Today"}</option>
            <option value="all">{language === "ar" ? "الكل" : "All"}</option>
          </SelInput>
        </div>
        {todayShifts.length === 0 ? <EmptyMsg title={language === "ar" ? "لا نوبات" : "No Shifts"} text={language === "ar" ? "لا توجد نوبات مجدولة" : "No scheduled shifts"} /> : (
          <div className="space-y-3">
            {todayShifts.map(s => (
              <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{s.guardName}</div>
                    <div className="text-sm text-slate-400">{s.date} · {s.startTime}–{s.endTime} · {formatBuilding(snapshot.buildings.find(b => b.id === s.buildingId), language)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={s.status === "completed" ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : s.status === "active" ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : s.status === "missed" ? "border-red-400/30 bg-red-500/15 text-red-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>{s.status}</Badge>
                    {s.status === "completed" && <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => { try { exportShiftReportPDF(s, s.guardName, APP_NAME); } catch { showToast("PDF failed", "danger"); } }}>PDF</Btn>}
                  </div>
                </div>
                {s.endOfShiftReport && <div className="mt-2 text-xs text-slate-400 italic">"{s.endOfShiftReport}"</div>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );

  const renderViolations = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "إدارة المخالفات" : "Violations Management"} />
      {(isOwner || isAdmin) && (
        <Panel>
          <div className="mb-4 font-black text-white">{language === "ar" ? "تسجيل مخالفة" : "Record Violation"}</div>
          <form onSubmit={addViolation} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Lbl>{language === "ar" ? "الحارس" : "Guard"}</Lbl>
                <SelInput value={violationForm.guardId} onChange={e => setViolationForm(p => ({ ...p, guardId: e.target.value }))}>
                  <option value="">{language === "ar" ? "اختر حارساً" : "Select Guard"}</option>
                  {guardUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "نوع المخالفة" : "Violation Type"}</Lbl>
                <SelInput value={violationForm.type} onChange={e => setViolationForm(p => ({ ...p, type: e.target.value }))}>
                  <option value="">{language === "ar" ? "اختر النوع" : "Select Type"}</option>
                  {["Late Arrival", "Absence", "Uniform Violation", "Phone Usage", "Security Breach", "Insubordination", "Other"].map(t => <option key={t} value={t}>{t}</option>)}
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "الخطورة" : "Severity"}</Lbl>
                <SelInput value={violationForm.severity} onChange={e => setViolationForm(p => ({ ...p, severity: e.target.value as Violation["severity"] }))}>
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="critical">Critical</option>
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "المبنى" : "Building"}</Lbl>
                <SelInput value={violationForm.buildingId} onChange={e => setViolationForm(p => ({ ...p, buildingId: e.target.value }))}>
                  <option value="">{language === "ar" ? "اختياري" : "Optional"}</option>
                  {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{language === "ar" ? b.nameAr : b.nameEn}</option>)}
                </SelInput>
              </div>
            </div>
            <div><Lbl>{language === "ar" ? "الوصف" : "Description"}</Lbl><TxtArea rows={3} value={violationForm.description} onChange={e => setViolationForm(p => ({ ...p, description: e.target.value }))} placeholder={language === "ar" ? "وصف المخالفة..." : "Describe the violation..."} /></div>
            <Btn type="submit">{language === "ar" ? "تسجيل المخالفة" : "Record Violation"}</Btn>
          </form>
        </Panel>
      )}
      <Panel>
        <div className="mb-4 font-black text-white">{language === "ar" ? "سجل المخالفات" : "Violations Log"}</div>
        {mergedViolations.length === 0 ? <EmptyMsg title={language === "ar" ? "لا مخالفات" : "No Violations"} text={language === "ar" ? "لم تُسجَّل أي مخالفات" : "No violations recorded"} /> : (
          <div className="space-y-3">
            {mergedViolations.map(v => (
              <div key={v.id} className={`rounded-2xl border p-4 ${v.severity === "critical" ? "border-red-500/30 bg-red-500/5" : v.severity === "major" ? "border-amber-500/30 bg-amber-500/5" : "border-slate-500/20 bg-white/5"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-white">{v.guardName}</div>
                    <div className="text-sm font-semibold text-slate-300">{v.type}</div>
                    <div className="text-xs text-slate-400">{v.issuedAt} · {language === "ar" ? "بواسطة" : "by"}: {v.issuedBy}</div>
                    {v.description && <div className="mt-1 text-sm text-slate-400">{v.description}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge className={v.severity === "critical" ? "border-red-400/30 bg-red-500/15 text-red-300" : v.severity === "major" ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>{v.severity}</Badge>
                    {!v.acknowledged && <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={() => { mutate(prev => ({ ...prev, violations: prev.violations.map(x => x.id === v.id ? { ...x, acknowledged: true, acknowledgedAt: nowStamp() } : x) }), language === "ar" ? "تم الإقرار" : "Acknowledged"); void updateViolationRemote(v.id, { acknowledged: true, acknowledgedAt: nowStamp() }); }}>{language === "ar" ? "إقرار" : "Acknowledge"}</Btn>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );

  const renderMap = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "خريطة المباني" : "Buildings Map"} />
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.buildings.map(b => {
            const guard = guardUsers.find(u => u.assignedBuildingId === b.id);
            const todayReports = snapshot.reports.filter(r => r.buildingId === b.id && r.time.startsWith(today()));
            return (
              <div key={b.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-black text-amber-400">{language === "ar" ? b.nameAr : b.nameEn}</div>
                    <div className="text-xs text-slate-400">{b.area}</div>
                  </div>
                  <Badge className={guard ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-red-400/30 bg-red-500/15 text-red-300"}>
                    {guard ? (language === "ar" ? "مراقب" : "Guarded") : (language === "ar" ? "غير مراقب" : "Unguarded")}
                  </Badge>
                </div>
                {guard && <div className="mt-2 text-sm text-slate-300">👮 {guard.name}</div>}
                {todayReports.length > 0 && <div className="mt-2 text-xs text-amber-400">⚠️ {todayReports.length} {language === "ar" ? "تقارير اليوم" : "reports today"}</div>}
                {b.lat && <div className="mt-2 text-xs text-slate-500">📍 {b.lat.toFixed(4)}, {b.lng?.toFixed(4)}</div>}
              </div>
            );
          })}
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

  const renderReports = () => (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHead title={language === "ar" ? "التقارير" : "Reports"} />
        <Btn variant="secondary" onClick={() => { try { exportReportsPDF(visibleReports, approvedUsers, APP_NAME); showToast(language === "ar" ? "تم تصدير PDF" : "PDF exported"); } catch { showToast("PDF failed", "danger"); } }}>📄 PDF</Btn>
      </div>
      {(isGuard || isAdmin || isOwner) && (
        <Panel>
          <input ref={reportPhotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) return;
            const dataUrl = await fileToDataUrl(file);
            setReportForm(p => ({ ...p, mediaUrl: dataUrl, mediaKind: "image", fileName: file.name }));
            e.target.value = "";
          }} />
          <form onSubmit={e => { void submitReport(e); }} className="space-y-4">
            {/* Building - QR scan or select */}
            <div>
              <Lbl>{language === "ar" ? "المبنى" : "Building"}</Lbl>
              {reportScannedBuilding ? (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                  <span className="text-2xl">✅</span>
                  <div className="flex-1">
                    <div className="font-black text-emerald-300">
                      {formatBuilding(snapshot.buildings.find(b => b.id === reportScannedBuilding), language)}
                    </div>
                    <div className="text-xs text-slate-400">{language === "ar" ? "تم المسح بـ QR" : "Scanned via QR"}</div>
                  </div>
                  <button type="button" onClick={() => setReportScannedBuilding("")} className="text-slate-400 hover:text-white text-lg">✕</button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <SelInput value={reportForm.buildingId} onChange={e => setReportForm(p => ({ ...p, buildingId: e.target.value }))} className="flex-1">
                    {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{language === "ar" ? b.nameAr : b.nameEn}</option>)}
                  </SelInput>
                  <Btn type="button" variant="secondary" className="h-12 px-4 flex-shrink-0" onClick={() => {
                    setQrContext("report");
                    setQrModalOpen(true);
                  }}>📷 QR</Btn>
                </div>
              )}
            </div>

            <div><Lbl>{language === "ar" ? "الحالة" : "Status"}</Lbl>
              <SelInput value={reportForm.status} onChange={e => setReportForm(p => ({ ...p, status: e.target.value as ReportStatus }))}>
                {(Object.keys(reportStatusLabels) as ReportStatus[]).map(s => <option key={s} value={s}>{pair(language, reportStatusLabels[s])}</option>)}
              </SelInput>
            </div>

            <div><Lbl>{language === "ar" ? "التقرير" : "Report"}</Lbl>
              <TxtArea rows={4} required value={reportForm.text} onChange={e => setReportForm(p => ({ ...p, text: e.target.value }))} placeholder={language === "ar" ? "اكتب تفاصيل التقرير هنا..." : "Write report details here..."} />
            </div>

            {/* Photo attachment */}
            <div>
              <Lbl>{language === "ar" ? "إرفاق صورة (اختياري)" : "Attach Photo (optional)"}</Lbl>
              {reportForm.mediaUrl ? (
                <div className="relative inline-block">
                  <img src={reportForm.mediaUrl} alt="preview" className="max-h-40 rounded-2xl object-cover border border-white/10" />
                  <button type="button" onClick={() => setReportForm(p => ({ ...p, mediaUrl: "", mediaKind: "", fileName: "" }))} className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white text-xs font-black">✕</button>
                </div>
              ) : (
                <Btn type="button" variant="secondary" className="w-full" onClick={() => reportPhotoRef.current?.click()}>
                  📷 {language === "ar" ? "التقاط صورة أو اختيار من المعرض" : "Take Photo or Choose from Gallery"}
                </Btn>
              )}
            </div>

            <Btn type="submit" className="w-full h-14 text-lg">
              {language === "ar" ? "📤 إرسال التقرير" : "📤 Submit Report"}
            </Btn>
          </form>
        </Panel>
      )}
      <div className="space-y-3">
        {pagedReports.length === 0 ? <EmptyMsg title={language === "ar" ? "لا تقارير" : "No Reports"} text="" /> : pagedReports.map(r => (
          <Panel key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={getStatusBadgeClass(r.status)}>{pair(language, reportStatusLabels[r.status])}</Badge>
                  <span className="font-black text-white">{r.senderName}</span>
                  <span className="text-xs text-slate-400">{r.time}</span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{r.text}</p>
              </div>
              {(isOwner || isAdmin) && <Btn variant="danger" className="h-8 px-3 text-xs" onClick={() => { mutate(prev => ({ ...prev, reports: prev.reports.filter(x => x.id !== r.id) }), language === "ar" ? "تم الحذف" : "Deleted"); void deleteReportRemote(r.id); }}>{language === "ar" ? "حذف" : "Delete"}</Btn>}
            </div>
          </Panel>
        ))}
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

  const renderUsers = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "المستخدمون" : "Users"} />
      {pendingUsers.length > 0 && (
        <Panel>
          <div className="mb-4 font-black text-amber-400">⏳ {language === "ar" ? `طلبات انتظار (${pendingUsers.length})` : `Pending Requests (${pendingUsers.length})`}</div>
          {pendingUsers.map(u => (
            <div key={u.id} className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div><div className="font-bold text-white">{u.name}</div><div className="text-xs text-slate-400">{u.email} · {pair(language, roleLabels[u.role])}</div></div>
              <div className="flex gap-2">
                <Btn onClick={() => approveUser(u.id)}>{language === "ar" ? "موافقة" : "Approve"}</Btn>
                <Btn variant="danger" onClick={() => rejectUser(u.id)}>{language === "ar" ? "رفض" : "Reject"}</Btn>
              </div>
            </div>
          ))}
        </Panel>
      )}
      <div><TxtInput className="mb-4 max-w-xs" placeholder={language === "ar" ? "بحث..." : "Search..."} value={userFilter} onChange={e => setUserFilter(e.target.value)} /></div>
      <div className="space-y-3">
        {filteredUsers.map(u => (
          <Panel key={u.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={getRoleBadgeClass(u.role)}>{pair(language, roleLabels[u.role])}</Badge>
                  <span className="font-black text-white">{u.name}</span>
                  {(u.violations ?? 0) > 0 && <Badge className="border-red-400/30 bg-red-500/15 text-red-300">⚠️ {u.violations} {language === "ar" ? "مخالفات" : "violations"}</Badge>}
                </div>
                <div className="mt-1 text-sm text-slate-400">{u.email} · ⭐ {u.rating}</div>
                {isOwner && u.id !== currentUser?.id && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.keys(permissionLabels).map(p => {
                      const hasPerm = (u.permissions ?? []).includes(p);
                      return (
                        <button key={p} onClick={() => {
                          const newPerms = hasPerm ? u.permissions.filter(x => x !== p) : [...(u.permissions ?? []), p];
                          mutate(prev => ({ ...prev, users: prev.users.map(x => x.id === u.id ? { ...x, permissions: newPerms } : x) }));
                          void saveApprovedUser({ ...u, permissions: newPerms });
                        }} className={`rounded-full border px-2 py-0.5 text-xs font-bold transition ${hasPerm ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-500 hover:bg-white/10"}`}>
                          {pair(language, permissionLabels[p])}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {isOwner && u.id !== currentUser?.id && (
                <div className="flex gap-2">
                  <SelInput className="h-8 w-28 text-xs px-2" value={u.role} onChange={e => {
                    const newRole = e.target.value as Role;
                    mutate(prev => ({ ...prev, users: prev.users.map(x => x.id === u.id ? { ...x, role: newRole } : x) }), language === "ar" ? "تم تغيير الدور" : "Role changed");
                    void saveApprovedUser({ ...u, role: newRole });
                  }}>
                    <option value="guard">Guard</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </SelInput>
                  <Btn variant="danger" className="h-8 px-3 text-xs" onClick={() => deleteUser(u.id)}>{language === "ar" ? "حذف" : "Delete"}</Btn>
                </div>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );

  const sendChatMedia = async (file: File) => {
    if (!currentUser || !activeConversation) return;
    setChatMediaUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const kind: ChatMessage["kind"] = file.type.startsWith("video") ? "image" : "image";
      const msg: ChatMessage = { id: `msg-${Date.now()}`, senderId: currentUser.id, kind, imageUrl: dataUrl, time: chatTime(language) };
      mutate(prev => {
        const exists = prev.conversations.find(c => c.id === activeConversation.id);
        const updated = exists ? { ...exists, messages: [...exists.messages, msg] } : { ...activeConversation, messages: [msg] };
        void saveConversation(updated);
        if (exists) return { ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? updated : c) };
        return { ...prev, conversations: [updated, ...prev.conversations] };
      });
    } catch { showToast(language === "ar" ? "فشل رفع الملف" : "Upload failed", "danger"); }
    setChatMediaUploading(false);
  };

  const startVoiceRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorderChunksRef.current = [];
      recorder.ondataavailable = e => recorderChunksRef.current.push(e.data);
      recorder.onstop = async () => {
        if (!currentUser || !activeConversation) return;
        const blob = new Blob(recorderChunksRef.current, { type: "audio/webm" });
        const audioUrl = await fileToDataUrl(new File([blob], "voice.webm"));
        const msg: ChatMessage = { id: `msg-${Date.now()}`, senderId: currentUser.id, kind: "audio", audioUrl, time: chatTime(language) };
        mutate(prev => {
          const exists = prev.conversations.find(c => c.id === activeConversation.id);
          const updated = exists ? { ...exists, messages: [...exists.messages, msg] } : { ...activeConversation, messages: [msg] };
          void saveConversation(updated);
          if (exists) return { ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? updated : c) };
          return { ...prev, conversations: [updated, ...prev.conversations] };
        });
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      setIsRecording(true);
    } catch { showToast(language === "ar" ? "تعذر الوصول للميكروفون" : "Microphone denied", "danger"); }
  };

  const stopVoiceRecord = () => {
    recorderRef.current?.stop();
    setIsRecording(false);
  };

  const renderChat = () => {
    return (
      <div className="space-y-4">
        <SectionHead title={language === "ar" ? "الدردشة" : "Chat"} />
        <input ref={chatFileRef} type="file" accept="image/*,video/*" className="hidden" onChange={async e => { if (e.target.files?.[0]) { await sendChatMedia(e.target.files[0]); e.target.value = ""; } }} />
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
                              {m.kind === "audio" && m.audioUrl && <audio controls src={m.audioUrl} className="max-w-[220px]" />}
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
                    title={isRecording ? (language === "ar" ? "إيقاف التسجيل" : "Stop") : (language === "ar" ? "رسالة صوتية" : "Voice")}
                    onMouseDown={() => { void startVoiceRecord(); }}
                    onMouseUp={stopVoiceRecord}
                    onTouchStart={() => { void startVoiceRecord(); }}
                    onTouchEnd={stopVoiceRecord}
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-lg transition ${isRecording ? "border-red-500/50 bg-red-500/20 animate-pulse" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                  >
                    🎙️
                  </button>
                  <Btn onClick={() => { sendMessage(chatInput); setChatInput(""); }}>{language === "ar" ? "إرسال" : "Send"}</Btn>
                </div>
                {isRecording && <div className="mt-2 text-center text-xs text-red-400 animate-pulse">⏺ {language === "ar" ? "جارٍ التسجيل... أفلت لإرسال" : "Recording... release to send"}</div>}
              </div>
            ) : <EmptyMsg title={language === "ar" ? "اختر محادثة" : "Select a conversation"} text="" />}
          </Panel>
        </div>
      </div>
    );
  };

  const renderAlerts = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "التنبيهات" : "Alerts"} />
      {(isOwner || isAdmin) && (
        <Panel>
          <form onSubmit={e => {
            e.preventDefault();
            if (!currentUser || !alertForm.text.trim()) return;
            const alert: AlertLog = { id: `a-${Date.now()}`, status: alertForm.customStatus || alertForm.status, target: alertForm.target, text: alertForm.text.trim(), sender: currentUser.name, time: nowStamp(), severity: alertForm.status.toLowerCase().includes("fire") || alertForm.status.toLowerCase().includes("حريق") ? "critical" : "info" };
            void saveAlert(alert);
            mutate(prev => ({ ...prev, alerts: [alert, ...prev.alerts] }), language === "ar" ? "تم إرسال التنبيه" : "Alert sent");
            setAlertForm(p => ({ ...p, text: "", customStatus: "" }));
          }} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Lbl>{language === "ar" ? "نوع التنبيه" : "Alert Type"}</Lbl>
                <SelInput value={alertForm.status} onChange={e => setAlertForm(p => ({ ...p, status: e.target.value }))}>
                  {["Fire / حريق", "Theft / سرقة", "Suspicious Activity / نشاط مريب", "Medical / طبي", "Visitor / زائر", "Custom / مخصص"].map(s => <option key={s} value={s}>{s}</option>)}
                </SelInput>
              </div>
              <div><Lbl>{language === "ar" ? "الهدف" : "Target"}</Lbl>
                <SelInput value={alertForm.target} onChange={e => setAlertForm(p => ({ ...p, target: e.target.value }))}>
                  {["Everyone / إرسال للكل", "Guards only / الحراس فقط", "Admins only / الإداريون فقط"].map(t => <option key={t} value={t}>{t}</option>)}
                </SelInput>
              </div>
            </div>
            <div><Lbl>{language === "ar" ? "نص التنبيه" : "Alert Text"}</Lbl><TxtArea rows={3} required value={alertForm.text} onChange={e => setAlertForm(p => ({ ...p, text: e.target.value }))} /></div>
            <Btn type="submit">{language === "ar" ? "إرسال التنبيه" : "Send Alert"}</Btn>
          </form>
        </Panel>
      )}
      <div className="space-y-3">
        {mergedAlerts.length === 0 ? <EmptyMsg title={language === "ar" ? "لا تنبيهات" : "No Alerts"} text="" /> : mergedAlerts.map(a => (
          <Panel key={a.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><Badge className={a.severity === "critical" ? "border-red-400/30 bg-red-500/15 text-red-300" : a.severity === "warning" ? "border-amber-400/30 bg-amber-500/15 text-amber-300" : "border-sky-400/30 bg-sky-500/15 text-sky-300"}>{a.status}</Badge></div>
                <p className="mt-2 text-sm text-slate-300">{a.text}</p>
                <div className="mt-1 text-xs text-slate-500">{a.sender} · {a.time}</div>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );

  const renderAttendance = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "الحضور" : "Attendance"} subtitle={language === "ar" ? "يجب مسح رمز QR للمبنى المخصص لك" : "Scan the QR code of your assigned building"} />
      <Panel>
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="text-6xl">📷</div>
          <p className="text-center text-slate-300 text-sm max-w-sm">
            {language === "ar"
              ? `امسح رمز QR الخاص بـ ${formatBuilding(snapshot.buildings.find(b => b.id === currentUser?.assignedBuildingId), language)} لتسجيل حضورك`
              : `Scan the QR code of ${formatBuilding(snapshot.buildings.find(b => b.id === currentUser?.assignedBuildingId), language)} to clock in`}
          </p>
          <Btn onClick={() => { setQrContext("attendance"); setQrModalOpen(true); }} className="h-14 px-8 text-lg">
            📷 {language === "ar" ? "مسح QR الآن" : "Scan QR Now"}
          </Btn>
        </div>
      </Panel>
      <div className="space-y-3">
        {mergedAttendance.slice(0, 20).map(a => (
          <Panel key={a.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-black text-white">{a.userName}</div><div className="text-sm text-slate-400">{a.time} · {formatBuilding(snapshot.buildings.find(b => b.id === a.buildingId), language)}</div></div>
              <Badge className={a.method === "qr" ? "border-sky-400/30 bg-sky-500/15 text-sky-300" : "border-slate-400/30 bg-slate-500/15 text-slate-300"}>{a.method === "qr" ? "QR" : language === "ar" ? "يدوي" : "Manual"}</Badge>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );

  const renderBuildings = () => {
    const building = selectedBuildingId ? snapshot.buildings.find(b => b.id === selectedBuildingId) : null;
    const buildingReports = building
      ? mergedReports.filter(r => r.buildingId === building.id && (isGuard ? r.senderId === currentUser?.id : true))
      : [];

    if (building) return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Btn variant="secondary" onClick={() => setSelectedBuildingId(null)}>← {language === "ar" ? "رجوع" : "Back"}</Btn>
          <SectionHead title={language === "ar" ? building.nameAr : building.nameEn} subtitle={building.area} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={language === "ar" ? "إجمالي التقارير" : "Total Reports"} value={buildingReports.length} />
          <StatCard label={language === "ar" ? "حرجة" : "Critical"} value={buildingReports.filter(r => r.status === "critical").length} color="text-red-300" />
          <StatCard label={language === "ar" ? "تحذير" : "Warning"} value={buildingReports.filter(r => r.status === "warning").length} color="text-amber-300" />
        </div>
        {buildingReports.length === 0
          ? <EmptyMsg title={language === "ar" ? "لا تقارير" : "No Reports"} text="" />
          : buildingReports.map(r => (
            <Panel key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={getStatusBadgeClass(r.status)}>{r.status}</Badge>
                    <span className="font-black text-white">{r.senderName}</span>
                    <span className="text-xs text-slate-400">{r.time}</span>
                  </div>
                  {(isOwner || isAdmin) && (
                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                      <InfoRow label={language === "ar" ? "البريد" : "Email"} value={r.senderEmail} />
                      <InfoRow label={language === "ar" ? "الهاتف" : "Phone"} value={r.senderPhone} />
                    </div>
                  )}
                  <p className="mt-2 text-sm text-slate-300">{r.text}</p>
                  {r.mediaUrl && r.mediaKind === "image" && <img src={r.mediaUrl} alt="media" className="mt-3 max-h-48 rounded-xl object-cover" />}
                </div>
              </div>
            </Panel>
          ))
        }
      </div>
    );

    return (
      <div className="space-y-6">
        <SectionHead title={language === "ar" ? "المباني" : "Buildings"} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.buildings.map(b => {
            const guard = approvedUsers.find(u => u.assignedBuildingId === b.id);
            const bReports = mergedReports.filter(r => r.buildingId === b.id);
            const criticals = bReports.filter(r => r.status === "critical").length;
            return (
              <Panel key={b.id} className="cursor-pointer hover:border-amber-400/30 transition" onClick={() => setSelectedBuildingId(b.id)}>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-black text-amber-400">{language === "ar" ? b.nameAr : b.nameEn}</div>
                  <Btn variant="secondary" className="h-8 px-3 text-xs" onClick={async e => {
                    e.stopPropagation();
                    const qr = await generateBuildingQR(b.id, b.nameEn).catch(() => "");
                    if (qr) { const a = document.createElement("a"); a.href = qr; a.download = `qr-${b.id}.png`; a.click(); showToast(language === "ar" ? "تم تنزيل QR" : "QR Downloaded"); }
                  }}>QR ⬇</Btn>
                </div>
                <div className="text-sm text-slate-400">{b.area}</div>
                {guard && <div className="mt-2 text-sm text-emerald-400">👮 {guard.name}</div>}
                <div className="mt-2 flex gap-2">
                  <Badge className="border-slate-400/30 bg-slate-500/15 text-slate-300">{bReports.length} {language === "ar" ? "تقرير" : "reports"}</Badge>
                  {criticals > 0 && <Badge className="border-red-400/30 bg-red-500/15 text-red-300">🚨 {criticals} {language === "ar" ? "حرج" : "critical"}</Badge>}
                </div>
                <div className="mt-2 text-xs text-slate-600 font-mono">{b.qrCode}</div>
              </Panel>
            );
          })}
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
              const task = { id: `t-${Date.now()}-${g.id}`, title: taskForm.title.trim(), details: taskForm.details.trim(), assignedTo: g.id, assignedName: g.name, status: "pending" as const, createdAt: nowStamp(), priority: taskForm.priority, dueDate: taskForm.dueDate || undefined };
              void saveTask(task);
              mutate(prev => ({ ...prev, tasks: [task, ...prev.tasks] }));
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

  const renderSettings = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "الإعدادات" : "Settings"} />
      <Panel>
        <div className="space-y-4">
          <div><Lbl>{language === "ar" ? "اللغة" : "Language"}</Lbl>
            <div className="flex gap-2">
              <Btn variant={language === "ar" ? "primary" : "secondary"} onClick={() => setLanguage("ar")}>العربية</Btn>
              <Btn variant={language === "en" ? "primary" : "secondary"} onClick={() => setLanguage("en")}>English</Btn>
            </div>
          </div>
          <div><Lbl>{language === "ar" ? "إشعارات سطح المكتب" : "Desktop Notifications"}</Lbl>
            <div className="flex items-center gap-3">
              <Btn variant="secondary" onClick={requestDesktopNotification}>{language === "ar" ? "طلب الإذن" : "Request Permission"}</Btn>
              <Badge className="border-white/10 bg-white/5 text-slate-200">{notificationPermission}</Badge>
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            {isOnline ? `🟢 ${language === "ar" ? "متصل بالإنترنت" : "Online"} · ${syncQueue.length} ${language === "ar" ? "معلقة" : "pending"}` : `🔴 ${language === "ar" ? "بدون إنترنت" : "Offline"} · ${syncQueue.length} ${language === "ar" ? "محفوظة محلياً" : "stored locally"}`}
          </div>
          <Btn variant="danger" className="w-full" onClick={() => { setCurrentUserId(null); setAuthError(null); setAuthInfo(null); showToast(language === "ar" ? "تم تسجيل الخروج" : "Logged out", "info"); }}>
            {language === "ar" ? "تسجيل الخروج" : "Logout"}
          </Btn>
        </div>
      </Panel>
    </div>
  );

  const renderSystem = () => (
    <div className="space-y-6">
      <SectionHead title={language === "ar" ? "إعدادات النظام" : "System Settings"} />
      <Panel>
        <div className="space-y-4">
          {([["orgName", language === "ar" ? "اسم المنظمة" : "Organization Name"], ["emergencyContact", language === "ar" ? "رقم الطوارئ" : "Emergency Contact"], ["criticalEmail", "Email"], ["criticalSms", "SMS"]] as [keyof typeof snapshot.systemSettings, string][]).map(([key, label]) => (
            <div key={key}><Lbl>{label}</Lbl>
              <TxtInput value={String(snapshot.systemSettings[key] ?? "")} onChange={e => mutate(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, [key]: e.target.value } }))} />
            </div>
          ))}
        </div>
      </Panel>
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
      case "audit": return renderAudit();
      case "system": return renderSystem();
      case "settings": return renderSettings();
      case "shifts": return renderShifts();
      case "violations": return renderViolations();
      case "map": return renderMap();
      case "sos": return renderSOS();
      default: return renderDashboard();
    }
  };

  if (!currentUser) {
    return <AuthScreen language={language} buildings={snapshot.buildings} errorMessage={authError} infoMessage={authInfo} onSignIn={handleSignIn} onCreateAccount={handleCreateAccount} onLanguageChange={setLanguage} />;
  }

  return (
    <div dir={language === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#040818] text-white">
      {mergedSOSEvents.some(s => !s.resolved) && (
        <div className="border-b border-red-500/50 bg-red-600 px-4 py-2 text-center text-sm font-black tracking-wide animate-pulse">
          🚨 {language === "ar" ? "تنبيه SOS نشط — تحقق من لوحة SOS" : "ACTIVE SOS ALERT — Check SOS Panel"}
        </div>
      )}
      <div className="border-b border-emerald-400/20 bg-emerald-600/90 px-4 py-2 text-center text-sm font-black tracking-[0.22em]">
        {language === "ar" ? "الوضع التشغيلي طبيعي" : "NORMAL OPERATING MODE"} · {APP_NAME}
      </div>
      <header className="border-b border-white/10 bg-[#0a1024]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-[22px] border border-amber-400/30 bg-[#111b3d] p-3 shadow-[0_0_28px_rgba(245,158,11,0.35)]">
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 5.25-3 8.5-7 10-4-1.5-7-4.75-7-10V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div>
              <div className="text-4xl font-black tracking-wide text-amber-400">{APP_NAME}</div>
              <div className="text-sm font-semibold text-slate-400">Integrated Security Platform</div>
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
      <QrScannerModal open={qrModalOpen} title={language === "ar" ? "ماسح QR" : "QR Scanner"} hint={language === "ar" ? "وجّه الكاميرا نحو رمز QR" : "Point camera at QR code"} closeLabel={language === "ar" ? "إغلاق" : "Close"} onClose={() => { setQrModalOpen(false); setQrContext(null); }} onDetected={handleQrDetected} />
      {emergencyActive && (
        <div className="fixed bottom-20 right-4 z-50">
          <Btn variant="danger" onClick={() => { stopEmergencySound(); setEmergencyActive(false); }}>{language === "ar" ? "🔇 إيقاف الصفارة" : "🔇 Stop Siren"}</Btn>
        </div>
      )}
      {toast && <div className="fixed bottom-4 left-1/2 z-50 w-[min(90vw,460px)] -translate-x-1/2"><div className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${getToastClass(toast.tone)}`}>{toast.text}</div></div>}
    </div>
  );
}

