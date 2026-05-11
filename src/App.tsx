import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import AuthScreen from "./components/AuthScreen";
import QrScannerModal from "./components/QrScannerModal";
import VisitorManagementModal from "./components/VisitorManagementModal";
import {
  playNormalAlertSound,
  registerNotificationServiceWorker,
  sendToServiceWorker,
  showSystemNotification,
  startEmergencySound,
  stopEmergencySound,
  vibrateDevice,
  vibrateEmergency,
} from "./services/notificationService";
import {
  deleteApprovedUserRemote,
  deleteConversationRemote,
  deletePendingUserRemote,
  ensureRemoteSeed,
  saveApprovedUser,
  saveConversation,
  savePendingUser,
  subscribeApprovedUsers,
  subscribeConversations,
  subscribePendingUsers,
} from "./services/firebaseData";
import type {
  AlertLog,
  AppSnapshot,
  AttendanceRecord,
  AuditEntry,
  AuditSeverity,
  Building,
  ChatMessage,
  Conversation,
  Language,
  NewAccountPayload,
  Pair,
  Report,
  ReportStatus,
  Role,
  Tab,
  Toast,
  ToastTone,
  User,
  VisitorFormPayload,
  VisitorRecord,
} from "./types/security";

// ─── Constants ───────────────────────────────────────────────────────────────
const STORAGE_KEY = "qa-security-appstate-v9";
const SESSION_KEY = "qa-security-session-v9";
const LANGUAGE_KEY = "qa-security-language-v9";
const SYNC_KEY = "qa-security-sync-v9";
const ACTIVE_KEY = "qa-security-active-v9";
const REPORTS_PER_PAGE = 6;
const VISITOR_REMINDER_MINUTES = 30;
const VISITOR_ARRIVAL_REMIND_MINUTES = 15;

// ─── Labels ───────────────────────────────────────────────────────────────────
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
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pair(language: Language, value: Pair): string {
  return value[language];
}

function normalizeCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function hashPassword(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = (hash * 33) ^ value.charCodeAt(i);
  return `h${(hash >>> 0).toString(16)}`;
}

function nowStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}-${`${now.getDate()}`.padStart(2, "0")} ${`${now.getHours()}`.padStart(2, "0")}:${`${now.getMinutes()}`.padStart(2, "0")}`;
}

function chatTime(language: Language): string {
  return new Date().toLocaleTimeString(language === "ar" ? "ar-SA" : "en-US", { hour: "2-digit", minute: "2-digit" });
}

function generatePassCode(): string {
  return `VIS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function securityNumber(userId: string): string {
  return `SEC-${userId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase().padStart(4, "0")}`;
}

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
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    actorId: actor?.id ?? "system",
    actorName: actor?.name ?? "System",
    action, target, details, severity,
    time: nowStamp(),
  };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("blob-failed"));
    reader.readAsDataURL(blob);
  });
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ─── Seed Data ────────────────────────────────────────────────────────────────
function buildSeedBuildings(): Building[] {
  return [
    ["gate-1", "البوابة 1", "GATE 1", "Gate Zone", "QA-GATE-1"],
    ["gate-2", "البوابة 2", "GATE 2", "Gate Zone", "QA-GATE-2"],
    ["reception", "الاستقبال", "RECEPTION", "Front Desk", "QA-REC"],
    ["building-2", "المبني 2", "BUILDING 2", "Building Zone", "QA-B2"],
    ["building-3", "المبني 3", "BUILDING 3", "Building Zone", "QA-B3"],
    ["building-4", "المبني 4", "BUILDING 4", "Building Zone", "QA-B4"],
    ["building-5", "المبني 5", "BUILDING 5", "Building Zone", "QA-B5"],
    ["building-6", "المبني 6", "BUILDING 6", "Building Zone", "QA-B6"],
    ["building-7", "المبني 7", "BUILDING 7", "Building Zone", "QA-B7"],
    ["building-8", "المبني 8", "BUILDING 8", "Building Zone", "QA-B8"],
    ["building-9", "المبني 9", "BUILDING 9", "Building Zone", "QA-B9"],
    ["building-10", "المبني 10", "BUILDING 10", "Building Zone", "QA-B10"],
    ["building-11", "المبني 11", "BUILDING 11", "Building Zone", "QA-B11"],
    ["building-12", "المبني 12", "BUILDING 12", "Building Zone", "QA-B12"],
    ["store-1", "المخزن 1", "STORE 1", "Storage", "QA-ST1"],
    ["store-2", "المخزن 2", "STORE 2", "Storage", "QA-ST2"],
    ["bumb-room", "غرفة المضخة", "BUMB ROOM", "Utility", "QA-PUMP"],
    ["back-s1", "المخزن الخلفي 1", "BACK S1", "Back Storage", "QA-BS1"],
    ["back-s2", "المخزن الخلفي 2", "BACK S2", "Back Storage", "QA-BS2"],
    ["back-s3", "المخزن الخلفي 3", "BACK S3", "Back Storage", "QA-BS3"],
    ["back-s4", "المخزن الخلفي 4", "BACK S4", "Back Storage", "QA-BS4"],
    ["cctv-room", "غرفة الكاميرات", "CCTV ROOM", "Control Room", "QA-CCTV"],
  ].map(([id, nameAr, nameEn, area, qrCode]) => ({ id, nameAr, nameEn, area, qrCode }));
}

function buildSeedState(): AppSnapshot {
  const buildings = buildSeedBuildings();
  const allPerms = Object.keys(permissionLabels);
  const users: User[] = [
    { id: "owner-1", name: "Mustafa Khojali", email: "mustafakhojali884@gmail.com", phone: "0555555555", role: "owner", status: "approved", permissions: allPerms, rating: 5, passwordHash: hashPassword("mus2003kh"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: true, createdAt: "2026-05-01 08:00" },
    { id: "admin-1", name: "Abeer Al-Harbi", email: "abeer.admin@qa-security.com", phone: "", role: "admin", status: "approved", permissions: ["reports", "alerts", "attendance", "buildings", "viewReports", "chat", "visitors"], rating: 4.8, passwordHash: hashPassword("admin123"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: true, createdAt: "2026-05-01 08:10" },
    { id: "guard-1", name: "Fatuma Osman", email: "fatuma.osman@qa-security.com", phone: "0507788991", role: "guard", status: "approved", assignedBuildingId: "gate-1", permissions: ["reports", "attendance", "chat", "buildings", "visitors"], rating: 4.9, passwordHash: hashPassword("guard123"), soundEnabled: true, desktopNotificationsEnabled: true, showFullToAdmin: false, createdAt: "2026-05-01 08:18" },
    { id: "guard-2", name: "Ayman Saeed", email: "ayman@qa-security.com", phone: "0503344551", role: "guard", status: "approved", assignedBuildingId: "gate-2", permissions: ["reports", "attendance", "chat", "buildings", "visitors"], rating: 4.6, passwordHash: hashPassword("guard456"), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: "2026-05-01 08:20" },
  ];

  return {
    buildings,
    users,
    reports: [
      { id: "r1", buildingId: "gate-1", text: "حركة الدخول طبيعية وتم التحقق من الهويات.", senderId: "guard-2", senderName: "Ayman Saeed", senderEmail: "ayman@qa-security.com", senderPhone: "70784249", time: "2026-05-06 08:43", status: "normal" },
      { id: "r2", buildingId: "gate-1", text: "تمت ملاحظة ازدحام بسيط عند البوابة وتم تنظيم الدخول.", senderId: "guard-1", senderName: "Fatuma Osman", senderEmail: "fatuma.osman@qa-security.com", senderPhone: "70784330", time: "2026-05-06 08:45", status: "warning" },
    ],
    alerts: [{ id: "a1", status: "Visitor / زائر", target: "Guards only / الحراس فقط", text: "تمت إضافة زائر مجدول لهذا اليوم.", sender: "Mustafa Khojali", time: "2026-05-05 08:15", severity: "info" }],
    attendance: [
      { id: "at1", userId: "guard-1", userName: "Fatuma Osman", buildingId: "gate-1", method: "manual", time: "2026-05-07 07:55" },
      { id: "at2", userId: "guard-2", userName: "Ayman Saeed", buildingId: "gate-2", method: "manual", time: "2026-05-07 08:05" },
    ],
    tasks: [
      { id: "t1", title: "فحص الكاميرات الخارجية", details: "تأكد من عمل جميع كاميرات البوابة 1 قبل الساعة 9 صباحاً.", assignedTo: "guard-1", assignedName: "Fatuma Osman", status: "pending", createdAt: "2026-05-07 07:20" },
      { id: "t2", title: "مراجعة سجل الزوار", details: "مطابقة أسماء الزوار المتوقعين مع موظف الاستقبال.", assignedTo: "guard-2", assignedName: "Ayman Saeed", status: "done", createdAt: "2026-05-07 07:30" },
    ],
    visitors: [
      { id: "v1", guestName: "خالد السبيعي", company: "شركة الصيانة الحديثة", purpose: "جولة صيانة", identityNumber: "1010101010", buildingId: "gate-1", arrivalDate: "2026-05-08", arrivalTime: "09:30", createdBy: "Mustafa Khojali", createdAt: "2026-05-07 08:20", passCode: generatePassCode(), status: "scheduled", reminderSent: false, preNotified: true },
    ],
    conversations: [
      { id: "c1", participantId: "guard-1", participantName: "Fatuma Osman", participantRole: "guard", messages: [{ id: "m1", senderId: "owner-1", kind: "text", text: "أهلاً فاطمة، يمكنك رفع أي ملاحظة عاجلة مباشرة هنا.", time: "08:10" }, { id: "m2", senderId: "guard-1", kind: "text", text: "تم استلام التعليمات.", time: "08:14" }] },
      { id: "c2", participantId: "guard-2", participantName: "Ayman Saeed", participantRole: "guard", messages: [{ id: "m3", senderId: "guard-2", kind: "text", text: "تم فحص البوابة 2 ولا توجد ملاحظات حالياً.", time: "08:22" }] },
    ],
    auditLog: [createAuditEntry(null, "system_seed", "platform", "تم تهيئة بيانات التشغيل الأساسية", "info")],
    systemSettings: {
      emergencyContact: "999",
      welcomeAr: "يرجى الالتزام بجميع تعليمات النوبة والمهام المسندة والتواصل فوراً عند أي حدث أمني.",
      welcomeEn: "Please comply with your shift instructions and report any security event immediately.",
      criticalEmail: "security-ops@qa-security.com",
      criticalSms: "+966555555555",
      visitorReminderMinutes: VISITOR_REMINDER_MINUTES,
    },
  };
}

function loadSnapshot(): AppSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedState();
    const parsed = JSON.parse(raw) as AppSnapshot;
    const seed = buildSeedState();
    // Always refresh buildings list (non-destructive)
    return { ...parsed, buildings: seed.buildings };
  } catch {
    return buildSeedState();
  }
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[28px] border border-white/10 bg-[#0b132b]/90 p-5 shadow-[0_22px_70px_rgba(0,0,0,0.35)] ${className}`}>{children}</div>;
}

function Lbl({ children }: { children: ReactNode }) {
  return <label className="mb-2 block text-sm font-semibold text-slate-400">{children}</label>;
}

function TxtInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none placeholder:text-slate-500 focus:border-amber-400/60 ${props.className ?? ""}`} />;
}

function SelInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none focus:border-amber-400/60 ${props.className ?? ""}`} />;
}

function TxtArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 py-3 text-white outline-none placeholder:text-slate-500 focus:border-amber-400/60 ${props.className ?? ""}`} />;
}

function Btn({ children, className = "", variant = "primary", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const cls = variant === "secondary" ? "border border-white/10 bg-white/5 text-white hover:bg-white/10" : variant === "danger" ? "bg-red-600 text-white hover:bg-red-500" : "bg-gradient-to-r from-amber-500 to-orange-400 text-black hover:from-amber-400 hover:to-orange-300";
  return <button {...props} className={`inline-flex h-11 items-center justify-center rounded-2xl px-5 text-sm font-bold transition ${cls} ${className}`}>{children}</button>;
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${className}`}>{children}</span>;
}

function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return <div className="mb-4"><h2 className="text-xl font-black text-white">{title}</h2>{subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}</div>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return <Panel className="min-h-[132px]"><div className="mb-8 text-sm font-semibold text-slate-400">{label}</div><div className="text-4xl font-black text-white">{value}</div></Panel>;
}

function EmptyMsg({ title, text }: { title: string; text: string }) {
  return <div className="flex min-h-[200px] flex-col items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/5 px-6 text-center"><h3 className="text-lg font-bold text-white">{title}</h3><p className="mt-2 max-w-md text-sm text-slate-400">{text}</p></div>;
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

  const [reportForm, setReportForm] = useState({
    buildingId: buildSeedBuildings()[0].id,
    text: "",
    status: "normal" as ReportStatus,
    mediaUrl: "",
    mediaKind: "" as "" | "image" | "video",
    fileName: "",
  });
  const [alertForm, setAlertForm] = useState({ status: "Fire / حريق", target: "Everyone / إرسال للكل", text: "", customStatus: "" });
  const [taskForm, setTaskForm] = useState({ title: "", details: "", assignedTo: "all" });
  const [newUserForm, setNewUserForm] = useState({ name: "", email: "", phone: "", password: "", role: "guard" as Role, buildingId: buildSeedBuildings()[0].id });

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const reportMediaInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const toastTimer = useRef<number | null>(null);
  const prevAlertCount = useRef(snapshot.alerts.length);
  const initialAlerts = useRef(true);

  // ─── Derived state ──────────────────────────────────────────────────────────
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
  const assignedBuildingId = currentUser?.assignedBuildingId ?? snapshot.buildings[0]?.id ?? "";

  const visibleTabs = useMemo((): Tab[] => {
    if (isGuard) return ["reports", "buildings", "visitors", "attendance", "tasks", "chat", "settings"];
    if (isAdmin) return ["dashboard", "reports", "alerts", "buildings", "users", "visitors", "attendance", "tasks", "chat", "settings"];
    return ["dashboard", "reports", "alerts", "buildings", "users", "visitors", "attendance", "tasks", "chat", "analytics", "audit", "system", "settings"];
  }, [isAdmin, isGuard]);

  const visibleReports = useMemo(() => isGuard && currentUser ? snapshot.reports.filter(r => r.senderId === currentUser.id) : snapshot.reports, [currentUser, isGuard, snapshot.reports]);
  const pagedReports = useMemo(() => visibleReports.slice((reportPage - 1) * REPORTS_PER_PAGE, reportPage * REPORTS_PER_PAGE), [reportPage, visibleReports]);
  const filteredUsers = useMemo(() => { const q = userFilter.trim().toLowerCase(); return q ? approvedUsers.filter(u => `${u.name} ${u.email}`.toLowerCase().includes(q)) : approvedUsers; }, [approvedUsers, userFilter]);
  const filteredVisitors = useMemo(() => {
    const q = visitorSearch.trim().toLowerCase();
    return snapshot.visitors
      .filter(v => visitorStatusFilter === "all" ? true : v.status === visitorStatusFilter)
      .filter(v => !q || `${v.guestName} ${v.company} ${v.identityNumber ?? ""}`.toLowerCase().includes(q));
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
      return approvedUsers
        .filter(u => u.id !== currentUser.id)
        .map(u => {
          const existing = conversationsSource.find(c => c.participantId === u.id);
          return existing ?? {
            id: `c-${u.id}`,
            participantId: u.id,
            participantName: u.name,
            participantRole: u.role,
            messages: [],
          };
        });
    }

    const existing = conversationsSource.find(c => c.participantId === currentUser.id);
    if (existing) return [existing];

    return [{
      id: `c-${currentUser.id}`,
      participantId: currentUser.id,
      participantName: currentUser.name,
      participantRole: currentUser.role,
      messages: [],
    }];
  }, [approvedUsers, conversationsSource, currentUser]);

  const activeConversation = useMemo(
    () => visibleConversations.find(c => c.id === conversationId) ?? visibleConversations[0],
    [conversationId, visibleConversations],
  );
  const visibleTasks = useMemo(() => isGuard && currentUser ? snapshot.tasks.filter(t => t.assignedTo === currentUser.id) : snapshot.tasks, [currentUser, isGuard, snapshot.tasks]);

  // ─── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.title = language === "ar" ? "QA SECURITY | نظام إدارة حراس الأمن" : "QA SECURITY | Security Operations Platform";
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

    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      unsubApproved();
      unsubPending();
      unsubConversations();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    setActiveUserIds(prev => Array.from(new Set([...prev.filter(id => id !== currentUserId), currentUserId])));
    return () => setActiveUserIds(prev => prev.filter(id => id !== currentUserId));
  }, [currentUserId]);

  useEffect(() => {
    if (!isOnline || !syncQueue.length || !currentUser) return;
    const timer = window.setTimeout(() => {
      setSyncQueue([]);
      showToast(language === "ar" ? "تمت مزامنة البيانات المحلية بعد عودة الإنترنت" : "Local data synced successfully", "info");
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [currentUser, isOnline, language, syncQueue]);

  useEffect(() => {
    if (!currentUser) return;
    if (initialAlerts.current) { initialAlerts.current = false; prevAlertCount.current = snapshot.alerts.length; return; }
    if (snapshot.alerts.length > prevAlertCount.current) {
      const latest = snapshot.alerts[0];
      const isCritical = latest.severity === "critical";
      if (isCritical) {
        // Emergency siren
        startEmergencySound();
        setEmergencyActive(true);
        vibrateEmergency();
        sendToServiceWorker({ title: `🚨 ${latest.status}`, body: latest.text, tag: "qa-emergency", requireInteraction: true });
        if (currentUser.desktopNotificationsEnabled) void showSystemNotification({ title: `🚨 ${latest.status}`, body: latest.text, tag: "qa-emergency", requireInteraction: true, data: { url: "/" } });
      } else {
        // Normal sound
        playNormalAlertSound(currentUser.soundEnabled);
        vibrateDevice();
        sendToServiceWorker({ title: latest.status, body: latest.text, tag: latest.id, requireInteraction: false });
        if (currentUser.desktopNotificationsEnabled) void showSystemNotification({ title: latest.status, body: latest.text, tag: latest.id, requireInteraction: false, data: { url: "/" } });
      }
    }
    prevAlertCount.current = snapshot.alerts.length;
  }, [currentUser, snapshot.alerts]);

  useEffect(() => {
    if (!currentUser || !snapshot.visitors.length) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      const reminderMs = snapshot.systemSettings.visitorReminderMinutes * 60_000;
      const reminderMs15 = VISITOR_ARRIVAL_REMIND_MINUTES * 60_000;

      // 15-minute arrival reminder
      const due15 = snapshot.visitors.find(v => {
        const target = new Date(`${v.arrivalDate}T${v.arrivalTime}:00`).getTime();
        const diff = target - now;
        return v.status === "scheduled" && !v.reminderSent && diff > 0 && diff <= reminderMs15;
      });
      if (due15) {
        setSnapshot(prev => ({ ...prev, visitors: prev.visitors.map(v => v.id === due15.id ? { ...v, reminderSent: true } : v) }));
        playNormalAlertSound(currentUser.soundEnabled);
        vibrateDevice();
        sendToServiceWorker({ title: language === "ar" ? `⏰ تذكير: 15 دقيقة للزائر` : `⏰ Reminder: 15 min to visitor`, body: `${due15.guestName} - ${due15.company || ""} - ${due15.arrivalTime}`, tag: `visitor-15-${due15.id}`, requireInteraction: false });
        if (currentUser.desktopNotificationsEnabled) void showSystemNotification({ title: language === "ar" ? `⏰ تذكير: ${due15.guestName}` : `⏰ Reminder: ${due15.guestName}`, body: language === "ar" ? `وصوله خلال 15 دقيقة - ${due15.arrivalTime}` : `Arriving in 15 minutes - ${due15.arrivalTime}`, tag: `visitor-15-${due15.id}`, requireInteraction: false, data: { url: "/" } });
      }

      // On-arrival notification
      const due = snapshot.visitors.find(v => v.status === "scheduled" && !v.reminderSent && (new Date(`${v.arrivalDate}T${v.arrivalTime}:00`).getTime() - now) <= reminderMs && (new Date(`${v.arrivalDate}T${v.arrivalTime}:00`).getTime() - now) > 0);
      if (!due) return;
      setSnapshot(prev => ({ ...prev, visitors: prev.visitors.map(v => v.id === due.id ? { ...v, reminderSent: true } : v) }));
      playNormalAlertSound(currentUser.soundEnabled);
      vibrateDevice();
      sendToServiceWorker({ title: language === "ar" ? `🔔 وصول زائر: ${due.guestName}` : `🔔 Visitor arriving: ${due.guestName}`, body: `${due.company || ""} - ${due.arrivalTime}`, tag: `visitor-arrival-${due.id}`, requireInteraction: true });
      if (currentUser.desktopNotificationsEnabled) void showSystemNotification({ title: language === "ar" ? `🔔 ${due.guestName} يصل الآن` : `🔔 ${due.guestName} arriving now`, body: `${due.company || ""} · ${due.passCode}`, tag: due.id, requireInteraction: true, data: { url: "/" } });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [currentUser, language, snapshot.systemSettings.visitorReminderMinutes, snapshot.visitors]);

  useEffect(() => {
    const allowedTabIds = visibleTabs as string[];
    if (!allowedTabIds.includes(activeTab)) setActiveTab(isGuard ? "reports" : "dashboard");
  }, [activeTab, isGuard, visibleTabs]);

  useEffect(() => {
    if (!visibleConversations.length) return;
    if (!visibleConversations.find(c => c.id === conversationId)) setConversationId(visibleConversations[0].id);
  }, [conversationId, visibleConversations]);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────
  const showToast = useCallback((text: string, tone: ToastTone = "success") => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const mutate = useCallback((updater: (prev: AppSnapshot) => AppSnapshot, successMsg?: string) => {
    try { setSnapshot(prev => updater(prev)); if (successMsg) showToast(successMsg); } catch { showToast(language === "ar" ? "تعذر إكمال العملية" : "Operation failed", "danger"); }
  }, [language, showToast]);

  const pushSync = useCallback((action: string) => setSyncQueue(prev => [...prev, `${nowStamp()}|${action}`]), []);

  const notify = useCallback(async (title: string, body: string, critical = false) => {
    if (!currentUser) return;
    if (critical) {
      // Emergency: start siren + background notification + vibration
      startEmergencySound();
      setEmergencyActive(true);
      vibrateEmergency();
      sendToServiceWorker({ title: `🚨 ${title}`, body, tag: "qa-emergency", requireInteraction: true });
      if (currentUser.desktopNotificationsEnabled) await showSystemNotification({ title: `🚨 ${title}`, body, tag: "qa-emergency", requireInteraction: true, data: { url: "/" } });
    } else {
      // Normal: short WhatsApp-style sound + notification
      playNormalAlertSound(currentUser.soundEnabled);
      vibrateDevice();
      sendToServiceWorker({ title, body, tag: `qa-notify-${Date.now()}`, requireInteraction: false });
      if (currentUser.desktopNotificationsEnabled) await showSystemNotification({ title, body, tag: `qa-notify-${Date.now()}`, requireInteraction: false, data: { url: "/" } });
    }
  }, [currentUser]);

  // Auth
  const handleSignIn = async (email: string, password: string) => {
    setAuthError(null); setAuthInfo(null);
    const user = snapshot.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user) return setAuthError(language === "ar" ? "الحساب غير موجود" : "Account not found");
    if (user.status === "pending") return setAuthInfo(language === "ar" ? "الحساب بانتظار موافقة المالك" : "Account pending owner approval");
    if (user.passwordHash !== hashPassword(password)) return setAuthError(language === "ar" ? "كلمة المرور غير صحيحة" : "Incorrect password");
    setCurrentUserId(user.id);
    setActiveTab(user.role === "guard" ? "reports" : "dashboard");
    mutate(prev => ({ ...prev, auditLog: [createAuditEntry(user, "login", "session", "تم تسجيل الدخول إلى النظام", "info"), ...prev.auditLog] }));
  };

  const handleCreateAccount = async (payload: NewAccountPayload) => {
    setAuthError(null); setAuthInfo(null);
    if (snapshot.users.some(u => u.email.toLowerCase() === payload.email.trim().toLowerCase())) return setAuthError(language === "ar" ? "البريد الإلكتروني مستخدم بالفعل" : "Email already registered");
    if (payload.role === "guard" && !payload.phone.trim()) return setAuthError(language === "ar" ? "رقم الهاتف مطلوب للحارس" : "Phone required for guards");
    if (payload.role === "guard" && !payload.buildingId) return setAuthError(language === "ar" ? "المبنى مطلوب للحارس" : "Building required for guards");
    const newUser: User = {
      id: `user-${Date.now()}`, name: payload.name.trim(), email: payload.email.trim(),
      phone: payload.role === "admin" ? "" : payload.phone.trim(), role: payload.role, status: "pending",
      assignedBuildingId: payload.role === "admin" ? undefined : payload.buildingId,
      permissions: payload.role === "admin" ? ["reports", "attendance", "buildings", "viewReports", "chat", "visitors"] : ["reports", "attendance", "chat", "buildings", "visitors"],
      rating: 4, passwordHash: hashPassword(payload.password), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: nowStamp(),
    };
    mutate(prev => ({ ...prev, users: [newUser, ...prev.users], auditLog: [createAuditEntry(null, "account_request", newUser.email, "تم إنشاء طلب حساب جديد بانتظار الموافقة", "warning"), ...prev.auditLog] }));
    setAuthInfo(language === "ar" ? "تم إرسال الطلب بنجاح وهو الآن بانتظار موافقة المالك" : "Request submitted and pending owner approval");
  };

  // Reports
  const submitReport = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser || !reportForm.text.trim()) return;
    const report: Report = {
      id: `r-${Date.now()}`,
      buildingId: reportForm.buildingId,
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
    mutate(prev => ({ ...prev, reports: [report, ...prev.reports] }), language === "ar" ? "تم حفظ التقرير" : "Report saved");
    pushSync("report");
    setReportForm(prev => ({ ...prev, text: "", status: "normal", mediaUrl: "", mediaKind: "", fileName: "" }));
  };

  const deleteReport = (id: string) => { if (isGuard) return; mutate(prev => ({ ...prev, reports: prev.reports.filter(r => r.id !== id) }), language === "ar" ? "تم حذف التقرير" : "Deleted"); };



  // Visitors
  const createVisitor = async (payload: VisitorFormPayload) => {
    if (!currentUser || (!isOwner && !isAdmin)) return;
    const visitor: VisitorRecord = { id: `v-${Date.now()}`, guestName: payload.guestName.trim(), company: payload.company.trim(), purpose: payload.purpose.trim(), identityNumber: payload.identityNumber?.trim() ?? "", buildingId: payload.buildingId, arrivalDate: payload.arrivalDate, arrivalTime: payload.arrivalTime, createdBy: currentUser.name, createdAt: nowStamp(), passCode: generatePassCode(), status: "scheduled", reminderSent: false, preNotified: true };
    mutate(prev => ({ ...prev, visitors: [visitor, ...prev.visitors], alerts: [{ id: `va-${Date.now()}`, status: language === "ar" ? "إشعار زائر" : "Visitor Notice", target: language === "ar" ? "جميع الحراس" : "All Guards", text: `${visitor.guestName} - ${visitor.company || (language === "ar" ? "بدون شركة" : "No company")} - ${visitor.arrivalDate} ${visitor.arrivalTime}`, sender: currentUser.name, time: nowStamp(), severity: "info" }, ...prev.alerts] }), language === "ar" ? "تمت إضافة الزائر وإرسال الإشعار" : "Visitor added and notified");
    pushSync("visitor");
    setVisitorModalOpen(false);
    await notify(language === "ar" ? "تمت إضافة زائر جديد" : "New visitor added", `${visitor.guestName} - ${visitor.arrivalTime}`);
  };

  const markArrived = (id: string) => mutate(prev => ({ ...prev, visitors: prev.visitors.map(v => v.id === id ? { ...v, status: "arrived" } : v) }), language === "ar" ? "تم تسجيل الوصول" : "Marked arrived");

  // Attendance
  const manualCheckIn = (user: User) => {
    const entry: AttendanceRecord = { id: `at-${Date.now()}`, userId: user.id, userName: user.name, buildingId: user.assignedBuildingId ?? snapshot.buildings[0].id, method: "manual", time: nowStamp() };
    mutate(prev => ({ ...prev, attendance: [entry, ...prev.attendance] }), language === "ar" ? `تم تسجيل حضور ${user.name}` : `${user.name} checked in`);
    pushSync("attendance-manual");
  };

  const handleQrDetected = (code: string) => {
    if (!currentUser) return;
    const building = snapshot.buildings.find(b => [b.id, b.qrCode, b.nameAr, b.nameEn].map(normalizeCode).includes(normalizeCode(code)));
    if (!building) { showToast(language === "ar" ? "رمز QR غير معروف" : "Unknown QR code", "danger"); setQrModalOpen(false); setQrContext(null); return; }
    if (qrContext === "attendance") {
      if (isGuard && currentUser.assignedBuildingId !== building.id) { showToast(language === "ar" ? "هذا الرمز لا يطابق المبنى المخصص لك" : "QR does not match your assigned building", "danger"); setQrModalOpen(false); setQrContext(null); return; }
      const entry: AttendanceRecord = { id: `at-${Date.now()}`, userId: currentUser.id, userName: currentUser.name, buildingId: building.id, method: "qr", time: nowStamp() };
      mutate(prev => ({ ...prev, attendance: [entry, ...prev.attendance] }), language === "ar" ? "تم تسجيل الحضور عبر QR" : "Attendance registered via QR");
      pushSync("attendance-qr");
    } else if (qrContext === "report") {
      setReportForm(prev => ({ ...prev, buildingId: building.id }));
      showToast(language === "ar" ? `تم تحديد ${building.nameAr}` : `${building.nameEn} selected from QR`, "info");
    }
    setQrModalOpen(false); setQrContext(null);
  };

  // Tasks
  const submitTask = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser || isGuard || !taskForm.title.trim() || !taskForm.details.trim()) return;
    const targets = taskForm.assignedTo === "all" ? guardUsers : guardUsers.filter(g => g.id === taskForm.assignedTo);
    mutate(prev => ({ ...prev, tasks: [...targets.map((g, i) => ({ id: `t-${Date.now()}-${i}`, title: taskForm.title.trim(), details: taskForm.details.trim(), assignedTo: g.id, assignedName: g.name, status: "pending" as const, createdAt: nowStamp() })), ...prev.tasks] }), language === "ar" ? "تم إرسال المهمة" : "Task sent");
    setTaskForm({ title: "", details: "", assignedTo: "all" });
  };

  const toggleTask = (id: string) => mutate(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, status: t.status === "done" ? "pending" : "done" } : t) }));

  // Users
  const approvePending = (id: string) => {
    if (!isOwner) return;
    const pending = pendingUsers.find(u => u.id === id);
    if (!pending) return;
    const approved = { ...pending, status: "approved" as const };
    mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === id ? approved : u) }), language === "ar" ? "تمت الموافقة" : "Approved");
    void saveApprovedUser(approved);
    void deletePendingUserRemote(id);
  };
  const rejectPending = (id: string) => {
    if (!isOwner) return;
    mutate(prev => ({ ...prev, users: prev.users.filter(u => u.id !== id) }), language === "ar" ? "تم الرفض" : "Rejected");
    void deletePendingUserRemote(id);
  };
  const deleteUser = (id: string) => {
    if (!isOwner || id === currentUserId) return;
    mutate(prev => ({ ...prev, users: prev.users.filter(u => u.id !== id) }), language === "ar" ? "تم الحذف" : "Deleted");
    void deleteApprovedUserRemote(id);
    void deletePendingUserRemote(id);
    void deleteConversationRemote(`c-${id}`);
  };
  const addUserDirectly = () => {
    if (!isOwner) return;
    if (!newUserForm.name.trim() || !newUserForm.email.trim() || !newUserForm.password.trim()) return showToast(language === "ar" ? "أكمل البيانات المطلوبة" : "Complete required fields", "danger");
    const u: User = { id: `user-${Date.now()}`, name: newUserForm.name.trim(), email: newUserForm.email.trim(), phone: newUserForm.role === "admin" ? "" : newUserForm.phone.trim(), role: newUserForm.role, status: "approved", assignedBuildingId: newUserForm.role === "guard" ? newUserForm.buildingId : undefined, permissions: newUserForm.role === "owner" ? Object.keys(permissionLabels) : newUserForm.role === "admin" ? ["reports", "alerts", "attendance", "buildings", "viewReports", "chat", "visitors"] : ["reports", "attendance", "chat", "buildings", "visitors"], rating: 4, passwordHash: hashPassword(newUserForm.password), soundEnabled: true, desktopNotificationsEnabled: false, showFullToAdmin: false, createdAt: nowStamp() };
    mutate(prev => ({ ...prev, users: [u, ...prev.users] }), language === "ar" ? "تمت إضافة المستخدم" : "User added");
    setNewUserForm({ name: "", email: "", phone: "", password: "", role: "guard", buildingId: snapshot.buildings[0].id });
  };
  const updateUserRole = (userId: string, newRole: Role) => { if (!isOwner) return; mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === userId ? { ...u, role: newRole } : u) }), language === "ar" ? "تم تحديث الدور" : "Role updated"); };
  const updateAssignedBuilding = (userId: string, buildingId: string) => { if (!isOwner) return; mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === userId ? { ...u, assignedBuildingId: buildingId } : u) }), language === "ar" ? "تم تحديث المبنى" : "Building updated"); };
  const restoreSound = (userId: string) => { if (!isOwner) return; mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === userId ? { ...u, soundEnabled: true } : u) }), language === "ar" ? "تمت إعادة تفعيل الصوت" : "Sound restored"); };
  const setAllGuardsSound = (enabled: boolean) => {
    if (!isOwner) return;
    mutate(
      prev => ({
        ...prev,
        users: prev.users.map(u => u.role === "guard" ? { ...u, soundEnabled: enabled } : u),
      }),
      enabled
        ? (language === "ar" ? "تم تفعيل أصوات جميع الحراس" : "All guards sound enabled")
        : (language === "ar" ? "تم كتم أصوات جميع الحراس" : "All guards sound muted"),
    );
  };
  const toggleAdminView = (userId: string) => { if (!isOwner) return; mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === userId ? { ...u, showFullToAdmin: !u.showFullToAdmin } : u) })); };
  const toggleMySound = () => { if (!currentUser) return; mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === currentUser.id ? { ...u, soundEnabled: !u.soundEnabled } : u) }), currentUser.soundEnabled ? (language === "ar" ? "تم كتم الصوت" : "Muted") : (language === "ar" ? "تم تشغيل الصوت" : "Sound enabled")); };

  // Chat
  const upsertConversationMessage = useCallback((conversation: Conversation, message: ChatMessage) => {
    setSnapshot(prev => {
      const exists = prev.conversations.some(c => c.id === conversation.id);
      if (exists) {
        return {
          ...prev,
          conversations: prev.conversations.map(c =>
            c.id === conversation.id ? { ...c, messages: [...c.messages, message] } : c,
          ),
        };
      }
      return {
        ...prev,
        conversations: [...prev.conversations, { ...conversation, messages: [message] }],
      };
    });
  }, []);

  const sendTextChat = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeConversation || !currentUser) return;
    const form = new FormData(e.currentTarget);
    const text = `${form.get("msg") ?? ""}`.trim();
    if (!text) return;
    const msg: ChatMessage = { id: `m-${Date.now()}`, senderId: currentUser.id, kind: "text", text, time: chatTime(language) };
    upsertConversationMessage(activeConversation, msg);
    e.currentTarget.reset();
  };

  const handleImagePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file || !activeConversation || !currentUser) return;
    const mediaUrl = await fileToDataUrl(file);
    const kind = file.type.startsWith("video/") ? "video" : "image";
    const msg: ChatMessage = { id: `m-${Date.now()}`, senderId: currentUser.id, kind, mediaUrl, fileName: file.name, time: chatTime(language) };
    upsertConversationMessage(activeConversation, msg);
    e.target.value = "";
  };

  const handleReportMediaPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const mediaUrl = await fileToDataUrl(file);
    setReportForm(prev => ({
      ...prev,
      mediaUrl,
      mediaKind: file.type.startsWith("video/") ? "video" : "image",
      fileName: file.name,
    }));
    e.target.value = "";
  };

  const toggleRecording = async () => {
    if (isRecording) { recorderRef.current?.stop(); return; }
    if (!activeConversation || !currentUser) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; recorderChunksRef.current = [];
      const recorder = new MediaRecorder(stream); recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data.size > 0) recorderChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(recorderChunksRef.current, { type: "audio/webm" });
        const mediaUrl = await blobToDataUrl(blob);
        const msg: ChatMessage = { id: `m-${Date.now()}`, senderId: currentUser.id, kind: "audio", mediaUrl, fileName: `voice-${Date.now()}.webm`, time: chatTime(language) };
        setSnapshot(prev => ({ ...prev, conversations: prev.conversations.map(c => c.id === activeConversation.id ? { ...c, messages: [...c.messages, msg] } : c) }));
        streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setIsRecording(false);
      };
      recorder.start(); setIsRecording(true); showToast(language === "ar" ? "بدأ التسجيل" : "Recording started", "info");
    } catch { showToast(language === "ar" ? "تعذر الوصول إلى الميكروفون" : "Microphone denied", "danger"); }
  };

  const requestDesktopNotification = async () => {
    if (!("Notification" in window)) return showToast(language === "ar" ? "المتصفح لا يدعم الإشعارات" : "Browser does not support notifications", "danger");
    const p = await Notification.requestPermission();
    setNotificationPermission(p);
    if (p === "granted" && currentUser) {
      mutate(prev => ({ ...prev, users: prev.users.map(u => u.id === currentUser.id ? { ...u, desktopNotificationsEnabled: true } : u) }), language === "ar" ? "تم تفعيل الإشعارات" : "Notifications enabled");
    } else {
      showToast(language === "ar" ? "لم يتم منح الإذن" : "Permission not granted", "danger");
    }
  };

  // ─── Auth Screen ──────────────────────────────────────────────────────────
  if (!currentUser) {
    return <AuthScreen language={language} buildings={snapshot.buildings} errorMessage={authError} infoMessage={authInfo} onSignIn={handleSignIn} onCreateAccount={handleCreateAccount} onLanguageChange={setLanguage} />;
  }

  // ─── Render Sections ──────────────────────────────────────────────────────
  const renderDashboard = () => (
    <div className="space-y-6">
      <Panel className="border-amber-500/25 bg-gradient-to-r from-[#151122] to-[#101a34]">
        <h1 className="text-3xl font-black text-white">{language === "ar" ? "لوحة العمليات الرئيسية" : "Security Operations Dashboard"}</h1>
        <p className="mt-2 text-sm text-slate-300">{language === "ar" ? "مرحباً بك في مركز التحكم الأمني لـ QA SECURITY." : "Welcome to QA SECURITY operations control center."}</p>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={language === "ar" ? "الحراس النشطون" : "Active Guards"} value={guardUsers.length} />
        <StatCard label={language === "ar" ? "التقارير" : "Reports"} value={snapshot.reports.length} />
        {isOwner ? <StatCard label={language === "ar" ? "المستخدمون النشطون الآن" : "Currently Active Users"} value={activeUserIds.length} /> : null}
        <StatCard label={language === "ar" ? "الزوار المجدولون" : "Scheduled Visitors"} value={snapshot.visitors.filter(v => v.status === "scheduled").length} />
      </div>
      {isOwner ? (
        <Panel>
          <SectionHead title={language === "ar" ? "المستخدمون النشطون الآن" : "Currently Active Users"} subtitle={language === "ar" ? "المستخدمون المتصلون حالياً بالمنصة" : "Users currently connected to the platform"} />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {approvedUsers.filter(u => activeUserIds.includes(u.id)).map(u => (
              <div key={u.id} className="flex items-center gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                <div className="h-3 w-3 rounded-full bg-emerald-400" />
                <div>
                  <div className="font-black text-white">{u.name}</div>
                  <div className="text-xs text-slate-400">{pair(language, roleLabels[u.role])}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      {!isGuard ? (
        <Panel>
          <SectionHead title={language === "ar" ? "أحدث التقارير الأمنية" : "Latest Security Reports"} subtitle={language === "ar" ? "آخر 3 تقارير مسجلة في النظام" : "Last 3 reports recorded in the system"} />
          <div className="space-y-3">
            {snapshot.reports.slice(0, 3).map(r => {
              const b = snapshot.buildings.find(b => b.id === r.buildingId);
              return (
                <div key={r.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-black text-white">{r.text}</div>
                      <div className="mt-1 text-xs text-slate-500">{r.senderName} · {formatBuilding(b, language)} · {r.time}</div>
                    </div>
                    <Badge className={getStatusBadgeClass(r.status)}>{pair(language, reportStatusLabels[r.status])}</Badge>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <Btn variant="secondary" onClick={() => setActiveTab("reports")}>{language === "ar" ? "عرض كل التقارير" : "View All Reports"}</Btn>
          </div>
        </Panel>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Btn onClick={() => setActiveTab("reports")}>{language === "ar" ? "إنشاء تقرير" : "Create Report"}</Btn>
        {!isGuard ? <Btn variant="secondary" onClick={() => { setVisitorModalOpen(true); setActiveTab("visitors"); }}>{language === "ar" ? "إدارة الزوار" : "Manage Visitors"}</Btn> : null}
        {!isGuard ? <Btn variant="secondary" onClick={() => setActiveTab("users")}>{language === "ar" ? "المستخدمون" : "Users"}</Btn> : null}
        <Btn variant="secondary" onClick={() => setActiveTab("chat")}>{language === "ar" ? "الدردشة" : "Chat"}</Btn>
      </div>
    </div>
  );

  const renderReports = () => (
    <div className="space-y-6">
      <Panel>
        <SectionHead title={language === "ar" ? "إنشاء تقرير جديد" : "Create New Report"} subtitle={language === "ar" ? "يمكن اختيار أي مبنى من القائمة أو استخدام QR" : "Choose any building or scan QR"} />
        <form onSubmit={submitReport} className="grid gap-4 xl:grid-cols-[1fr_2fr_1fr_auto] xl:items-end">
          <div>
            <Lbl>{language === "ar" ? "المبنى" : "Building"}</Lbl>
            <SelInput value={reportForm.buildingId} onChange={e => setReportForm(prev => ({ ...prev, buildingId: e.target.value }))}>
              {snapshot.buildings.map(b => <option key={b.id} value={b.id}>{formatBuilding(b, language)}</option>)}
            </SelInput>
          </div>
          <div>
            <Lbl>{language === "ar" ? "نص التقرير" : "Report Text"}</Lbl>
            <TxtInput value={reportForm.text} onChange={e => setReportForm(prev => ({ ...prev, text: e.target.value }))} placeholder={language === "ar" ? "اكتب ما حدث..." : "Describe the situation..."} />
          </div>
          <div>
            <Lbl>{language === "ar" ? "الحالة" : "Status"}</Lbl>
            <SelInput value={reportForm.status} onChange={e => setReportForm(prev => ({ ...prev, status: e.target.value as ReportStatus }))}>
              {Object.entries(reportStatusLabels).map(([k, v]) => <option key={k} value={k}>{pair(language, v)}</option>)}
            </SelInput>
          </div>
          <div className="flex gap-2">
            <input ref={reportMediaInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleReportMediaPicked} />
            <Btn type="button" variant="secondary" onClick={() => { setQrContext("report"); setQrModalOpen(true); }}>QR</Btn>
            <Btn type="button" variant="secondary" onClick={() => reportMediaInputRef.current?.click()}>{language === "ar" ? "إرفاق صورة/فيديو" : "Attach media"}</Btn>
            <Btn type="submit">{language === "ar" ? "إرسال" : "Send"}</Btn>
          </div>
        </form>
      </Panel>
      <Panel>
        <SectionHead title={language === "ar" ? "سجل التقارير" : "Report Log"} subtitle={isGuard ? (language === "ar" ? "تعرض تقاريرك فقط" : "Your reports only") : (language === "ar" ? "أحدث التقارير الأمنية" : "Latest security reports")} />
        <div className="space-y-4">
            {pagedReports.length ? pagedReports.map(r => {
              const b = snapshot.buildings.find(b => b.id === r.buildingId);
              return (
                <div key={r.id} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="grid gap-4 md:grid-cols-[1.1fr_1.5fr_1fr_1fr_1fr_0.7fr] md:items-center">
                    <div><div className="text-lg font-black text-white">{formatBuilding(b, language)}</div><div className="text-xs text-slate-500">{b?.area}</div></div>
                    <div className="text-sm text-slate-200">{r.text}</div>
                    <div><div className="font-bold text-slate-200">{r.senderName}</div><div className="text-xs text-slate-500">{r.senderEmail}</div></div>
                    <Badge className={getStatusBadgeClass(r.status)}>{pair(language, reportStatusLabels[r.status])}</Badge>
                    <div className="text-sm text-slate-400">{r.time}</div>
                    <div>{!isGuard ? <button onClick={() => deleteReport(r.id)} className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10">🗑️</button> : null}</div>
                  </div>
                  {r.mediaKind === "image" && r.mediaUrl ? <img src={r.mediaUrl} alt={r.fileName ?? "report media"} className="mt-4 max-h-80 rounded-2xl object-cover" /> : null}
                  {r.mediaKind === "video" && r.mediaUrl ? <video controls src={r.mediaUrl} className="mt-4 max-h-80 w-full rounded-2xl object-cover" /> : null}
                </div>
              );
            }) : <EmptyMsg title={language === "ar" ? "لا توجد تقارير" : "No reports"} text={language === "ar" ? "لم يتم تسجيل أي تقارير بعد." : "No reports have been submitted yet."} />}
        </div>
        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="text-sm text-slate-500">{language === "ar" ? `صفحة ${reportPage} من ${Math.max(1, Math.ceil(visibleReports.length / REPORTS_PER_PAGE))}` : `Page ${reportPage} of ${Math.max(1, Math.ceil(visibleReports.length / REPORTS_PER_PAGE))}`}</div>
          <div className="flex gap-2">
            <Btn variant="secondary" disabled={reportPage === 1} onClick={() => setReportPage(p => Math.max(1, p - 1))}>{language === "ar" ? "السابق" : "Prev"}</Btn>
            <Btn variant="secondary" disabled={reportPage >= Math.ceil(visibleReports.length / REPORTS_PER_PAGE)} onClick={() => setReportPage(p => p + 1)}>{language === "ar" ? "التالي" : "Next"}</Btn>
          </div>
        </div>
      </Panel>
    </div>
  );

  const submitAlertWithCustomStatus = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!currentUser || !alertForm.text.trim()) return;
    const statusToSend = alertForm.status === "__other__"
      ? (alertForm.customStatus.trim() || (language === "ar" ? "حالة أخرى" : "Other"))
      : alertForm.status;
    const isCritical = statusToSend.includes("Fire") || statusToSend.includes("حريق");
    const severity = isCritical ? "critical" as const : statusToSend.includes("Flood") || statusToSend.includes("Medical") || statusToSend.includes("إسعاف") ? "warning" as const : "info" as const;
    const alert: AlertLog = { id: `a-${Date.now()}`, status: statusToSend, target: alertForm.target, text: alertForm.text.trim(), sender: currentUser.name, time: nowStamp(), severity };
    mutate(prev => ({ ...prev, alerts: [alert, ...prev.alerts] }), language === "ar" ? "تم بث التنبيه" : "Alert broadcasted");
    setAlertForm(prev => ({ ...prev, text: "", customStatus: "" }));
    await notify(statusToSend, alert.text, severity === "critical");
  };

  const renderAlerts = () => {
    if (isGuard) return <EmptyMsg title={language === "ar" ? "غير متاح" : "Unavailable"} text={language === "ar" ? "هذه الشاشة للمالك والإداريين فقط." : "This section is for owner and admins only."} />;
    return (
      <div className="space-y-6">
        {emergencyActive ? (
          <div className="flex items-center justify-between gap-4 rounded-[24px] border-2 border-red-500 bg-red-500/15 px-6 py-4 animate-pulse">
            <div className="flex items-center gap-3">
              <span className="text-4xl">🚨</span>
              <div>
                <div className="text-xl font-black text-red-300">{language === "ar" ? "وضع الطوارئ نشط — الصفارة تعمل" : "Emergency Mode Active — Siren Running"}</div>
                <div className="text-sm text-red-200">{language === "ar" ? "يعمل الصوت حتى تضغط على إيقاف" : "Sound will keep running until you stop it"}</div>
              </div>
            </div>
            <Btn variant="danger" onClick={() => { stopEmergencySound(); setEmergencyActive(false); showToast(language === "ar" ? "تم إيقاف صوت الطوارئ" : "Emergency sound stopped", "info"); }}>
              🔇 {language === "ar" ? "إيقاف الصفارة" : "Stop Siren"}
            </Btn>
          </div>
        ) : null}
        <Panel>
          <SectionHead title={language === "ar" ? "بث تنبيه" : "Broadcast Alert"} subtitle={language === "ar" ? "تنبيه الحريق والإسعاف يفعّل صوت الصفارة المستمر" : "Fire & Medical alerts trigger the emergency siren"} />
          <form onSubmit={submitAlertWithCustomStatus} className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1fr_1fr_2fr]">
              <div>
                <Lbl>{language === "ar" ? "نوع الحالة" : "Status"}</Lbl>
                <SelInput value={alertForm.status} onChange={e => setAlertForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="Fire / حريق">{language === "ar" ? "🔥 حريق" : "🔥 Fire"}</option>
                  <option value="Medical / إسعاف">{language === "ar" ? "🚑 إسعاف طبي" : "🚑 Medical Emergency"}</option>
                  <option value="Flood / سيول">{language === "ar" ? "🌊 سيول / فيضان" : "🌊 Flood"}</option>
                  <option value="__other__">{language === "ar" ? "✏️ أخرى (حدد النوع)" : "✏️ Other (specify)"}</option>
                </SelInput>
              </div>
              <div>
                <Lbl>{language === "ar" ? "المستلم" : "Target"}</Lbl>
                <SelInput value={alertForm.target} onChange={e => setAlertForm(p => ({ ...p, target: e.target.value }))}>
                  <option>Everyone / إرسال للكل</option>
                  <option>Guards only / الحراس فقط</option>
                  <option>Owners only / الإدارة العليا</option>
                </SelInput>
              </div>
              <div>
                <Lbl>{language === "ar" ? "نص التنبيه" : "Alert Message"}</Lbl>
                <TxtInput value={alertForm.text} onChange={e => setAlertForm(p => ({ ...p, text: e.target.value }))} placeholder={language === "ar" ? "اكتب تفاصيل الحادثة..." : "Describe the incident..."} required />
              </div>
            </div>
            {alertForm.status === "__other__" ? (
              <div>
                <Lbl>{language === "ar" ? "حدد نوع الحالة" : "Specify status type"}</Lbl>
                <TxtInput value={alertForm.customStatus} onChange={e => setAlertForm(p => ({ ...p, customStatus: e.target.value }))} placeholder={language === "ar" ? "مثال: تهديد، اقتحام، انهيار..." : "e.g. Threat, Intrusion, Collapse..."} />
              </div>
            ) : null}
            <Btn type="submit">{language === "ar" ? "🚨 بث التنبيه" : "🚨 Broadcast Alert"}</Btn>
          </form>
        </Panel>
        <Panel>
          <SectionHead title={language === "ar" ? "سجل التنبيهات" : "Alert Log"} />
          <div className="space-y-3">
            {snapshot.alerts.map(a => (
              <div key={a.id} className={`rounded-[24px] border p-4 ${a.severity === "critical" ? "border-red-500/40 bg-red-500/8" : a.severity === "warning" ? "border-amber-500/30 bg-amber-500/5" : "border-white/10 bg-white/5"}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-xl font-black ${a.severity === "critical" ? "text-red-300" : a.severity === "warning" ? "text-amber-300" : "text-slate-200"}`}>{a.severity === "critical" ? "🚨" : a.severity === "warning" ? "⚠️" : "ℹ️"} {a.status}</span>
                      <Badge className="border-red-400/30 bg-red-500/10 text-red-200">{a.sender}</Badge>
                      <Badge className={a.severity === "critical" ? "border-red-400/30 bg-red-500/10 text-red-200" : a.severity === "warning" ? "border-amber-400/30 bg-amber-500/10 text-amber-200" : "border-sky-400/30 bg-sky-500/10 text-sky-200"}>{a.severity}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-200">{a.text}</p>
                    <p className="mt-1 text-xs text-slate-500">{a.time} · {a.target}</p>
                  </div>
                  {isOwner ? <button onClick={() => mutate(prev => ({ ...prev, alerts: prev.alerts.filter(x => x.id !== a.id) }))} className="shrink-0 p-2 text-slate-400 hover:text-white">🗑️</button> : null}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  };

  const renderBuildings = () => (
    <Panel>
      <SectionHead title={language === "ar" ? "المباني والمواقع" : "Buildings & Sites"} subtitle={language === "ar" ? "قائمة المواقع مع رموز QR الخاصة بكل موقع" : "Site list with QR codes for each location"} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.buildings.map(b => (
          <div key={b.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="font-black text-white">{formatBuilding(b, language)}</div>
            <div className="mt-1 text-xs text-slate-500">{b.area}</div>
            <div className="mt-2 font-mono text-xs text-amber-400">{b.qrCode}</div>
          </div>
        ))}
      </div>
    </Panel>
  );

  const renderUsers = () => {
    if (isGuard) return <EmptyMsg title={language === "ar" ? "غير متاح" : "Unavailable"} text={language === "ar" ? "إدارة المستخدمين مخفية عن الحراس." : "User management is hidden from guards."} />;
    return (
      <div className="space-y-6">
        {isOwner && pendingUsers.length > 0 ? (
          <Panel>
            <SectionHead title={language === "ar" ? "طلبات الحسابات المعلقة" : "Pending Account Requests"} subtitle={language === "ar" ? "تتطلب موافقة المالك" : "Require owner approval"} />
            <div className="space-y-3">
              {pendingUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div>
                    <div className="font-black text-white">{u.name}</div>
                    <div className="text-sm text-slate-400">{u.email}</div>
                    <div className="text-xs text-slate-500">{pair(language, roleLabels[u.role])}</div>
                  </div>
                  <div className="flex gap-2"><Btn onClick={() => approvePending(u.id)}>{language === "ar" ? "موافقة" : "Approve"}</Btn><Btn variant="danger" onClick={() => rejectPending(u.id)}>{language === "ar" ? "رفض" : "Reject"}</Btn></div>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}
        {isOwner ? (
          <Panel>
            <SectionHead title={language === "ar" ? "إضافة مستخدم مباشر" : "Direct Add User"} />
            <div className="grid gap-4 md:grid-cols-2">
              <div><Lbl>{language === "ar" ? "الاسم" : "Name"}</Lbl><TxtInput value={newUserForm.name} onChange={e => setNewUserForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Lbl>Email</Lbl><TxtInput value={newUserForm.email} onChange={e => setNewUserForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><Lbl>{language === "ar" ? "الدور" : "Role"}</Lbl><SelInput value={newUserForm.role} onChange={e => setNewUserForm(p => ({ ...p, role: e.target.value as Role }))}><option value="guard">{pair(language, roleLabels.guard)}</option><option value="admin">{pair(language, roleLabels.admin)}</option><option value="owner">{pair(language, roleLabels.owner)}</option></SelInput></div>
              <div><Lbl>{language === "ar" ? "كلمة المرور" : "Password"}</Lbl><TxtInput type="password" value={newUserForm.password} onChange={e => setNewUserForm(p => ({ ...p, password: e.target.value }))} /></div>
              {newUserForm.role === "guard" ? <div><Lbl>{language === "ar" ? "الجوال" : "Phone"}</Lbl><TxtInput value={newUserForm.phone} onChange={e => setNewUserForm(p => ({ ...p, phone: e.target.value }))} /></div> : null}
              {newUserForm.role === "guard" ? <div><Lbl>{language === "ar" ? "المبنى" : "Building"}</Lbl><SelInput value={newUserForm.buildingId} onChange={e => setNewUserForm(p => ({ ...p, buildingId: e.target.value }))}>{snapshot.buildings.map(b => <option key={b.id} value={b.id}>{formatBuilding(b, language)}</option>)}</SelInput></div> : null}
            </div>
            <div className="mt-4"><Btn onClick={addUserDirectly}>{language === "ar" ? "إضافة مستخدم" : "Add User"}</Btn></div>
          </Panel>
        ) : null}
        <div className="w-full max-w-md"><TxtInput placeholder={language === "ar" ? "فلترة المستخدمين..." : "Filter users..."} value={userFilter} onChange={e => setUserFilter(e.target.value)} /></div>
        <div className="grid gap-5 xl:grid-cols-2">
          {filteredUsers.map(u => {
            const isActive = activeUserIds.includes(u.id);
            const b = snapshot.buildings.find(b => b.id === u.assignedBuildingId);
            const canAdminSeePrivate = !isAdmin || u.role !== "guard" || u.showFullToAdmin;
            return (
              <Panel key={u.id} className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3 className="text-2xl font-black text-white">{u.name}</h3>
                      <Badge className={getRoleBadgeClass(u.role)}>{pair(language, roleLabels[u.role])}</Badge>
                      {isOwner ? <Badge className={isActive ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/5 text-slate-300"}>{isActive ? (language === "ar" ? "نشط الآن" : "Active Now") : language === "ar" ? "غير نشط" : "Offline"}</Badge> : null}
                    </div>
                    <p className="text-sm text-slate-500">{isAdmin && u.role === "guard" ? securityNumber(u.id) : u.email}</p>
                  </div>
                  {isOwner && u.id !== currentUser.id ? <Btn variant="danger" onClick={() => deleteUser(u.id)}>{language === "ar" ? "حذف" : "Delete"}</Btn> : null}
                </div>
                {isAdmin && u.role === "guard" && !canAdminSeePrivate ? (
                  <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">{language === "ar" ? "الإداري يرى الاسم ورقم السكيورتي فقط." : "Admin sees only name and security number."}<br /><span className="font-black text-white">{securityNumber(u.id)}</span></div>
                ) : (
                  <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-2">
                    <InfoRow label={language === "ar" ? "الجوال" : "Phone"} value={u.phone} />
                    <InfoRow label={language === "ar" ? "رقم السكيورتي" : "Security No."} value={securityNumber(u.id)} />
                    <InfoRow label={language === "ar" ? "المبنى" : "Building"} value={formatBuilding(b, language)} />
                  </div>
                )}
                {isOwner ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div><Lbl>{language === "ar" ? "الدور" : "Role"}</Lbl><SelInput value={u.role} onChange={e => updateUserRole(u.id, e.target.value as Role)} disabled={u.id === currentUser.id}><option value="owner">{pair(language, roleLabels.owner)}</option><option value="admin">{pair(language, roleLabels.admin)}</option><option value="guard">{pair(language, roleLabels.guard)}</option></SelInput></div>
                    {u.role === "guard" ? <div><Lbl>{language === "ar" ? "المبنى المخصص" : "Assigned Building"}</Lbl><SelInput value={u.assignedBuildingId ?? ""} onChange={e => updateAssignedBuilding(u.id, e.target.value)}>{snapshot.buildings.map(b => <option key={b.id} value={b.id}>{formatBuilding(b, language)}</option>)}</SelInput></div> : null}
                  </div>
                ) : null}
                {isOwner && u.role === "guard" ? (
                  <div className="flex flex-wrap gap-3">
                    <Btn variant="secondary" onClick={() => toggleAdminView(u.id)}>{u.showFullToAdmin ? (language === "ar" ? "إخفاء بيانات الحارس عن الإداري" : "Hide from admin") : language === "ar" ? "إظهار بيانات الحارس للإداري" : "Show to admin"}</Btn>
                    <Btn variant="secondary" onClick={() => restoreSound(u.id)}>{language === "ar" ? "إعادة تفعيل الصوت" : "Restore Sound"}</Btn>
                  </div>
                ) : null}
              </Panel>
            );
          })}
        </div>
      </div>
    );
  };

  const renderVisitors = () => (
    <div className="space-y-6">
      <Panel>
        <SectionHead title={language === "ar" ? "مركز الزوار" : "Visitor Center"} subtitle={language === "ar" ? "بحث فوري بالاسم أو الشركة أو رقم الهوية، يعمل دون إنترنت" : "Real-time search by name, company or ID – works offline"} />
        <div className="grid gap-3 md:grid-cols-[1.6fr_220px_auto] md:items-center">
          <TxtInput placeholder={language === "ar" ? "ابحث بالاسم أو الشركة أو رقم الهوية..." : "Search by name, company, or ID..."} value={visitorSearch} onChange={e => setVisitorSearch(e.target.value)} />
          <SelInput value={visitorStatusFilter} onChange={e => setVisitorStatusFilter(e.target.value as typeof visitorStatusFilter)}>
            <option value="all">{language === "ar" ? "جميع الحالات" : "All"}</option>
            <option value="scheduled">{language === "ar" ? "مجدول" : "Scheduled"}</option>
            <option value="arrived">{language === "ar" ? "وصل" : "Arrived"}</option>
            <option value="expired">{language === "ar" ? "منتهي" : "Expired"}</option>
          </SelInput>
          {!isGuard ? <Btn onClick={() => setVisitorModalOpen(true)}>{language === "ar" ? "إضافة زائر" : "Add Visitor"}</Btn> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge className="border-white/10 bg-white/5 text-slate-200">{isOnline ? (language === "ar" ? "متصل" : "Online") : language === "ar" ? "بدون إنترنت" : "Offline"}</Badge>
          {syncQueue.length > 0 ? <Badge className="border-amber-400/30 bg-amber-500/10 text-amber-200">{language === "ar" ? `مزامنة معلقة: ${syncQueue.length}` : `Pending sync: ${syncQueue.length}`}</Badge> : null}
        </div>
      </Panel>
      <div className="grid gap-5">
        {filteredVisitors.length ? filteredVisitors.map(v => {
          const b = snapshot.buildings.find(b => b.id === v.buildingId);
          const minutesLeft = Math.max(0, Math.round((new Date(`${v.arrivalDate}T${v.arrivalTime}:00`).getTime() - Date.now()) / 60000));
          return (
            <Panel key={v.id} className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="text-2xl font-black text-white">{v.guestName}</h3>
                    <Badge className={v.status === "arrived" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : v.status === "expired" ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-amber-400/30 bg-amber-500/10 text-amber-200"}>{v.status}</Badge>
                  </div>
                  <p className="text-sm text-slate-400">{v.company || (language === "ar" ? "بدون شركة" : "No company")}</p>
                  {v.identityNumber ? <p className="text-sm text-slate-500">{language === "ar" ? `رقم الهوية: ${v.identityNumber}` : `ID: ${v.identityNumber}`}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-white/10 bg-white/5 text-slate-200">{formatBuilding(b, language)}</Badge>
                  <Badge className="border-emerald-400/30 bg-emerald-500/10 text-emerald-200">{v.passCode}</Badge>
                  <Badge className="border-sky-400/30 bg-sky-500/10 text-sky-200">{v.arrivalDate} {v.arrivalTime}</Badge>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <InfoRow label={language === "ar" ? "المنشئ" : "Created By"} value={v.createdBy} />
                <InfoRow label={language === "ar" ? "الوقت المتبقي" : "Time Remaining"} value={v.status === "scheduled" ? `${minutesLeft} ${language === "ar" ? "دقيقة" : "min"}` : "—"} />
                <InfoRow label={language === "ar" ? "الغرض" : "Purpose"} value={v.purpose} />
              </div>
              {!isGuard && v.status === "scheduled" ? <Btn variant="secondary" onClick={() => markArrived(v.id)}>{language === "ar" ? "تسجيل الوصول عند البوابة" : "Mark Arrived at Gate"}</Btn> : null}
            </Panel>
          );
        }) : <EmptyMsg title={language === "ar" ? "لا توجد نتائج" : "No results"} text={language === "ar" ? "جرّب اسماً مختلفاً أو رقم هوية مختلفاً." : "Try a different name or identity number."} />}
      </div>
    </div>
  );

  const renderAttendance = () => {
    if (isGuard) {
      const assignedBuilding = snapshot.buildings.find(b => b.id === assignedBuildingId);
      return (
        <Panel>
          <SectionHead title={language === "ar" ? "تسجيل الحضور" : "Check In"} subtitle={language === "ar" ? "لن يقبل النظام إلا رمز QR الخاص بمبناك المخصص" : "Only your assigned building QR code is accepted"} />
          <div className="mb-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-emerald-200">
            {language === "ar" ? `المبنى المخصص لك: ${assignedBuilding?.nameAr ?? "—"}` : `Your assigned building: ${assignedBuilding?.nameEn ?? "—"}`}
          </div>
          <Btn onClick={() => { setQrContext("attendance"); setQrModalOpen(true); }}>{language === "ar" ? "مسح رمز QR" : "Scan QR Code"}</Btn>
          <div className="mt-6 space-y-3">
            {snapshot.attendance.filter(a => a.userId === currentUser?.id).map(a => (
              <div key={a.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
                <div><div className="font-black text-white">{formatBuilding(snapshot.buildings.find(b => b.id === a.buildingId), language)}</div><div className="text-xs text-slate-500">{a.time}</div></div>
                <Badge className="border-emerald-400/30 bg-emerald-500/10 text-emerald-200">{a.method.toUpperCase()}</Badge>
              </div>
            ))}
          </div>
        </Panel>
      );
    }
    return (
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <Panel>
          <SectionHead title={language === "ar" ? "تسجيل يدوي" : "Manual Check-In"} />
          <div className="space-y-3">
            {guardUsers.map(g => (
              <div key={g.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div><div className="text-xl font-black text-white">{g.name}</div><div className="text-xs text-slate-500">{formatBuilding(snapshot.buildings.find(b => b.id === g.assignedBuildingId), language)}</div></div>
                <Btn onClick={() => manualCheckIn(g)}>{language === "ar" ? "تسجيل" : "Check In"}</Btn>
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <SectionHead title={language === "ar" ? "سجل الحضور" : "Attendance Log"} />
          <div className="space-y-3">
            {snapshot.attendance.map(a => (
              <div key={a.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
                <div><div className="font-black text-white">{a.userName}</div><div className="text-xs text-slate-500">{formatBuilding(snapshot.buildings.find(b => b.id === a.buildingId), language)}</div></div>
                <div className="text-right"><div className="text-sm text-slate-400">{a.time}</div><Badge className="mt-1 border-emerald-400/30 bg-emerald-500/10 text-emerald-200">{a.method.toUpperCase()}</Badge></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  };

  const renderTasks = () => (
    <div className="space-y-6">
      {!isGuard ? (
        <Panel>
          <SectionHead title={language === "ar" ? "مهمة جديدة" : "New Task"} />
          <form onSubmit={submitTask} className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
            <div><Lbl>{language === "ar" ? "العنوان" : "Title"}</Lbl><TxtInput value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div><Lbl>{language === "ar" ? "التفاصيل" : "Details"}</Lbl><TxtInput value={taskForm.details} onChange={e => setTaskForm(p => ({ ...p, details: e.target.value }))} /></div>
            <div><Lbl>{language === "ar" ? "إسناد إلى" : "Assign To"}</Lbl><SelInput value={taskForm.assignedTo} onChange={e => setTaskForm(p => ({ ...p, assignedTo: e.target.value }))}><option value="all">{language === "ar" ? "جميع الحراس" : "All Guards"}</option>{guardUsers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</SelInput></div>
            <Btn type="submit">{language === "ar" ? "إرسال" : "Send"}</Btn>
          </form>
        </Panel>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {visibleTasks.map(task => (
          <Panel key={task.id} className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-2xl font-black text-white">{task.title}</h3><p className="mt-2 text-sm text-slate-400">{task.details}</p></div>
              <Badge className={task.status === "done" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-amber-400/30 bg-amber-500/10 text-amber-200"}>{task.status === "done" ? (language === "ar" ? "مكتملة" : "Done") : language === "ar" ? "قيد التنفيذ" : "Pending"}</Badge>
            </div>
            <div className="text-xs text-slate-500">{language === "ar" ? `موجهة إلى: ${task.assignedName}` : `Assigned to: ${task.assignedName}`}</div>
            <Btn variant="secondary" onClick={() => toggleTask(task.id)}>{task.status === "done" ? (language === "ar" ? "إعادة الفتح" : "Reopen") : language === "ar" ? "تحديد كمكتملة" : "Mark as Done"}</Btn>
          </Panel>
        ))}
      </div>
    </div>
  );

  const renderChatMsg = (msg: ChatMessage) => {
    if (!currentUser) return null;
    const mine = msg.senderId === currentUser.id;
    const shell = mine ? "bg-gradient-to-r from-amber-500 to-orange-400 text-black" : "bg-white/8 text-slate-200";
    return (
      <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <div className={`max-w-[78%] rounded-[22px] px-4 py-3 text-sm ${shell}`}>
          {msg.kind === "text" ? <div>{msg.text}</div> : null}
          {msg.kind === "image" && msg.mediaUrl ? <img src={msg.mediaUrl} alt={msg.fileName ?? "img"} className="max-h-72 rounded-2xl object-cover" /> : null}
          {msg.kind === "video" && msg.mediaUrl ? <video controls src={msg.mediaUrl} className="max-h-72 w-full rounded-2xl object-cover" /> : null}
          {msg.kind === "audio" && msg.mediaUrl ? <audio controls src={msg.mediaUrl} className="w-full" /> : null}
          <div className={`mt-2 text-[11px] ${mine ? "text-black/70" : "text-slate-500"}`}>{msg.time}</div>
        </div>
      </div>
    );
  };

  const renderChat = () => (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <Panel className="min-h-[620px]">
        <SectionHead title={language === "ar" ? "المحادثات" : "Conversations"} subtitle={language === "ar" ? "رسائل نصية وصور وصوتيات" : "Text, images, and voice messages"} />
        <div className="space-y-3">
          {visibleConversations.map(c => (
            <button key={c.id} onClick={() => setConversationId(c.id)} className={`w-full rounded-2xl border p-4 text-start transition ${activeConversation?.id === c.id ? "border-amber-400/40 bg-amber-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
              <div className="text-xl font-black text-white">{currentUser.role === "owner" ? c.participantName : (language === "ar" ? "المالك" : "Owner")}</div>
              <div className="mt-1 text-xs text-slate-500">{currentUser.role === "owner" ? pair(language, roleLabels[c.participantRole]) : pair(language, roleLabels.owner)}</div>
            </button>
          ))}
        </div>
      </Panel>
      <Panel className="min-h-[620px]">
        {activeConversation ? (
          <div className="flex h-full flex-col">
            <div className="mb-4 border-b border-white/10 pb-4">
              <div className="text-2xl font-black text-white">{currentUser.role === "owner" ? activeConversation.participantName : (language === "ar" ? "محادثة خاصة مع المالك" : "Private chat with owner")}</div>
              <div className="text-sm text-slate-500">{currentUser.role === "owner" ? pair(language, roleLabels[activeConversation.participantRole]) : (language === "ar" ? "قناة مباشرة مع الإدارة العليا فقط." : "Direct channel with upper management only.")}</div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto pb-4">{activeConversation.messages.map(renderChatMsg)}</div>
            <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleImagePicked} />
            <form onSubmit={sendTextChat} className="mt-4 flex gap-2 border-t border-white/10 pt-4">
              <button type="button" onClick={toggleRecording} className={`rounded-2xl border px-4 text-sm font-bold transition ${isRecording ? "border-red-400/40 bg-red-500/15 text-red-200" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}>{isRecording ? (language === "ar" ? "إيقاف" : "Stop") : "🎤"}</button>
              <button type="button" onClick={() => imageInputRef.current?.click()} className="rounded-2xl border border-white/10 bg-white/5 px-4 text-slate-300 hover:bg-white/10">📎</button>
              <TxtInput name="msg" placeholder={language === "ar" ? "اكتب رسالتك هنا..." : "Write your message here..."} className="flex-1" />
              <Btn type="submit">{language === "ar" ? "إرسال" : "Send"}</Btn>
            </form>
          </div>
        ) : <EmptyMsg title={language === "ar" ? "اختر محادثة" : "Choose a conversation"} text={language === "ar" ? "عند تحديد المحادثة ستظهر الرسائل هنا." : "Select a conversation to view messages."} />}
      </Panel>
    </div>
  );

  const renderAnalytics = () => {
    if (isGuard) return <EmptyMsg title={language === "ar" ? "غير متاح" : "Unavailable"} text={language === "ar" ? "التحليلات للإدارة فقط." : "Analytics for management only."} />;
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label={language === "ar" ? "إجمالي التقارير" : "Total Reports"} value={snapshot.reports.length} />
          <StatCard label={language === "ar" ? "تقارير اليوم" : "Today's Reports"} value={snapshot.reports.filter(r => r.time.startsWith(nowStamp().slice(0, 10))).length} />
          <StatCard label={language === "ar" ? "الزوار الكلي" : "Total Visitors"} value={snapshot.visitors.length} />
          <StatCard label={language === "ar" ? "سجلات الحضور" : "Attendance Records"} value={snapshot.attendance.length} />
        </div>
        <Panel>
          <SectionHead title={language === "ar" ? "أداء الحراس" : "Guard Performance"} />
          <div className="space-y-4">
            {guardUsers.map(g => {
              const reportCount = snapshot.reports.filter(r => r.senderId === g.id).length;
              const attendanceCount = snapshot.attendance.filter(a => a.userId === g.id).length;
              const max = Math.max(1, ...guardUsers.map(g2 => snapshot.reports.filter(r => r.senderId === g2.id).length));
              const width = Math.max(8, (reportCount / max) * 100);
              return (
                <div key={g.id}>
                  <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                    <span>{g.name}</span>
                    <span>{language === "ar" ? `${reportCount} تقرير · ${attendanceCount} حضور` : `${reportCount} reports · ${attendanceCount} attendance`}</span>
                  </div>
                  <div className="h-3 rounded-full bg-white/5"><div className="h-3 rounded-full bg-gradient-to-r from-amber-500 to-orange-400" style={{ width: `${width}%` }} /></div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    );
  };

  const renderAudit = () => {
    if (isGuard) return <EmptyMsg title={language === "ar" ? "غير متاح" : "Unavailable"} text={language === "ar" ? "سجل التدقيق للإدارة فقط." : "Audit log for management only."} />;
    return (
      <Panel>
        <SectionHead title={language === "ar" ? "سجل التدقيق" : "Audit Trail"} />
        <div className="space-y-3">
          {snapshot.auditLog.slice(0, 50).map(entry => (
            <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={entry.severity === "critical" ? "border-red-400/30 bg-red-500/10 text-red-200" : entry.severity === "warning" ? "border-amber-400/30 bg-amber-500/10 text-amber-200" : "border-sky-400/30 bg-sky-500/10 text-sky-200"}>{entry.severity}</Badge>
                <span className="font-black text-white">{entry.action}</span>
              </div>
              <div className="mt-2 text-sm text-slate-300">{entry.details}</div>
              <div className="mt-1 text-xs text-slate-500">{entry.actorName} · {entry.time}</div>
            </div>
          ))}
        </div>
      </Panel>
    );
  };

  const renderSystem = () => {
    if (!isOwner) return <EmptyMsg title={language === "ar" ? "غير متاح" : "Unavailable"} text={language === "ar" ? "إعدادات النظام للمالك فقط." : "System settings for owner only."} />;
    return (
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel>
          <SectionHead title={language === "ar" ? "إعدادات النظام" : "System Settings"} />
          <div className="space-y-4">
            <div><Lbl>{language === "ar" ? "رقم الطوارئ" : "Emergency Contact"}</Lbl><TxtInput value={snapshot.systemSettings.emergencyContact} onChange={e => setSnapshot(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, emergencyContact: e.target.value } }))} /></div>
            <div><Lbl>{language === "ar" ? "البريد الحرج" : "Critical Email"}</Lbl><TxtInput value={snapshot.systemSettings.criticalEmail} onChange={e => setSnapshot(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, criticalEmail: e.target.value } }))} /></div>
            <div><Lbl>{language === "ar" ? "رسالة ترحيب (عربي)" : "Welcome Message (Arabic)"}</Lbl><TxtArea rows={3} value={snapshot.systemSettings.welcomeAr} onChange={e => setSnapshot(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, welcomeAr: e.target.value } }))} /></div>
            <div><Lbl>{language === "ar" ? "رسالة ترحيب (إنجليزي)" : "Welcome Message (English)"}</Lbl><TxtArea rows={3} value={snapshot.systemSettings.welcomeEn} onChange={e => setSnapshot(prev => ({ ...prev, systemSettings: { ...prev.systemSettings, welcomeEn: e.target.value } }))} /></div>
            <Btn onClick={() => showToast(language === "ar" ? "تم الحفظ" : "Saved successfully")}>{language === "ar" ? "حفظ" : "Save"}</Btn>
          </div>
        </Panel>
        <Panel>
          <SectionHead title={language === "ar" ? "إعدادات الصوت للمستخدمين" : "User Sound Settings"} subtitle={language === "ar" ? "المالك يستطيع إعادة تفعيل الصوت لأي مستخدم أو التحكم العام بكل الحراس" : "Owner can restore sound per user or control all guards at once"} />
          <div className="mb-4 flex flex-wrap gap-3">
            <Btn variant="secondary" onClick={() => setAllGuardsSound(true)}>{language === "ar" ? "تفعيل أصوات جميع الحراس" : "Enable all guards sound"}</Btn>
            <Btn variant="danger" onClick={() => setAllGuardsSound(false)}>{language === "ar" ? "كتم أصوات جميع الحراس" : "Mute all guards sound"}</Btn>
          </div>
          <div className="space-y-3">
            {approvedUsers.filter(u => u.id !== currentUser.id).map(u => (
              <div key={u.id} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div><div className="font-black text-white">{u.name}</div><div className="text-xs text-slate-500">{pair(language, roleLabels[u.role])}</div></div>
                <div className="flex items-center gap-2">
                  <Badge className={u.soundEnabled ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}>{u.soundEnabled ? (language === "ar" ? "صوت مفعّل" : "Sound on") : language === "ar" ? "صوت مكتوم" : "Muted"}</Badge>
                  <Btn variant="secondary" onClick={() => restoreSound(u.id)}>{language === "ar" ? "تفعيل" : "Restore"}</Btn>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="mx-auto max-w-3xl space-y-6">
      <Panel>
        <SectionHead title={language === "ar" ? "الإعدادات الشخصية" : "Personal Settings"} />
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <Lbl>{language === "ar" ? "اللغة" : "Language"}</Lbl>
              <div className="grid grid-cols-2 gap-3 rounded-[24px] border border-white/10 bg-[#071125] p-1">
                <button type="button" onClick={() => setLanguage("ar")} className={`h-12 rounded-2xl text-sm font-bold transition ${language === "ar" ? "bg-gradient-to-r from-amber-500 to-orange-400 text-black" : "text-slate-300"}`}>العربية</button>
                <button type="button" onClick={() => setLanguage("en")} className={`h-12 rounded-2xl text-sm font-bold transition ${language === "en" ? "bg-gradient-to-r from-amber-500 to-orange-400 text-black" : "text-slate-300"}`}>English</button>
              </div>
            </div>
            <div>
              <Lbl>{language === "ar" ? "الصوت" : "Sound"}</Lbl>
              <Btn variant={currentUser.soundEnabled ? "secondary" : "primary"} onClick={toggleMySound}>{currentUser.soundEnabled ? (language === "ar" ? "كتم الصوت" : "Mute Sound") : language === "ar" ? "تشغيل الصوت" : "Enable Sound"}</Btn>
            </div>
            <div>
              <Lbl>{language === "ar" ? "إشعارات سطح المكتب" : "Desktop Notifications"}</Lbl>
              <div className="flex flex-wrap items-center gap-3">
                <Btn variant="secondary" onClick={requestDesktopNotification}>{language === "ar" ? "طلب الإذن" : "Request Permission"}</Btn>
                <Badge className="border-white/10 bg-white/5 text-slate-200">{notificationPermission}</Badge>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              {isOnline ? (language === "ar" ? `متصل بالإنترنت · عمليات معلقة للمزامنة: ${syncQueue.length}` : `Online · Pending sync: ${syncQueue.length}`) : (language === "ar" ? `بدون إنترنت · كل العمليات محفوظة محلياً (${syncQueue.length})` : `Offline · All operations stored locally (${syncQueue.length})`)}
            </div>
            <Btn variant="danger" className="w-full" onClick={() => { setCurrentUserId(null); setAuthError(null); setAuthInfo(null); showToast(language === "ar" ? "تم تسجيل الخروج" : "Logged out", "info"); }}>
              {language === "ar" ? "تسجيل الخروج" : "Logout"}
            </Btn>
          </div>
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
      default: return renderDashboard();
    }
  };

  // ─── Main Layout ──────────────────────────────────────────────────────────
  return (
    <div dir={language === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#040818] text-white">
      <div className="border-b border-emerald-400/20 bg-emerald-600/90 px-4 py-2 text-center text-sm font-black tracking-[0.22em]">
        {language === "ar" ? "الوضع التشغيلي طبيعي" : "NORMAL OPERATING MODE"}
      </div>
      <header className="border-b border-white/10 bg-[#0a1024]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="rounded-[22px] border border-amber-400/30 bg-[#111b3d] p-3 shadow-[0_0_28px_rgba(245,158,11,0.35)]">
              <svg viewBox="0 0 24 24" className="h-10 w-10 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 3v5c0 5.25-3 8.5-7 10-4-1.5-7-4.75-7-10V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div>
              <div className="text-4xl font-black tracking-wide text-amber-400">QA SECURITY</div>
              <div className="text-sm font-semibold text-slate-400">Integrated Security System</div>
            </div>
          </div>
          <div className="text-center lg:text-end">
            <div className="text-2xl font-black text-white">{language === "ar" ? `أهلاً ${currentUser.name}` : `Hello ${currentUser.name}`}</div>
            <div className="mt-1 text-sm text-slate-400">{currentUser.email}</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2 lg:justify-end">
              <Badge className={getRoleBadgeClass(currentUser.role)}>{pair(language, roleLabels[currentUser.role])}</Badge>
              <Badge className={isOnline ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-red-400/30 bg-red-500/10 text-red-200"}>{isOnline ? (language === "ar" ? "متصل" : "Online") : language === "ar" ? "بدون إنترنت" : "Offline"}</Badge>
            </div>
          </div>
        </div>
      </header>
      <nav className="border-b border-white/10 bg-[#070d22]">
        <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto px-4 py-3">
          {visibleTabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`inline-flex min-w-max items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold transition ${activeTab === tab ? "border-amber-400/40 bg-amber-500/10 text-amber-300" : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-white"}`}>
              {pair(language, tabLabels[tab] ?? { ar: tab, en: tab })}
            </button>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-7xl px-4 py-8">{renderContent()}</main>
      <VisitorManagementModal open={visitorModalOpen} language={language} buildings={snapshot.buildings} onClose={() => setVisitorModalOpen(false)} onSubmit={payload => { void createVisitor(payload); }} />
      <QrScannerModal open={qrModalOpen} title={language === "ar" ? "ماسح رمز QR" : "QR Scanner"} hint={language === "ar" ? "يمكنك المسح بالكاميرا فقط بعد منح إذن الوصول للكاميرا." : "Camera-only QR scanning after granting camera permission."} closeLabel={language === "ar" ? "إغلاق" : "Close"} onClose={() => { setQrModalOpen(false); setQrContext(null); }} onDetected={handleQrDetected} />
      {toast ? <div className="fixed bottom-4 left-1/2 z-50 w-[min(90vw,460px)] -translate-x-1/2"><div className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xl backdrop-blur ${getToastClass(toast.tone)}`}>{toast.text}</div></div> : null}
    </div>
  );
}
/**
 * firebaseData.additions.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Paste these exports into your existing  src/services/firebaseData.ts  file.
 *
 * They follow the exact same patterns already used for users & conversations:
 *   • save*   → doc(db, collection, id) + setDoc (merge: true)
 *   • delete* → deleteDoc
 *   • subscribe* → onSnapshot  (returns an unsubscribe function)
 *   • update* → updateDoc with a partial payload
 *
 * Firestore collections created:
 *   reports      – security reports submitted by guards
 *   visitors     – scheduled visitor records
 *   attendance   – clock-in / QR check-in entries
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";           // adjust path to match your project
import type { AttendanceRecord, Report, VisitorRecord } from "../types/security";

// ─── Reports ─────────────────────────────────────────────────────────────────

/** Write (or overwrite) a report document. */
export async function saveReport(report: Report): Promise<void> {
  await setDoc(doc(db, "reports", report.id), report, { merge: true });
}

/** Hard-delete a report document. */
export async function deleteReportRemote(id: string): Promise<void> {
  await deleteDoc(doc(db, "reports", id));
}

/**
 * Subscribe to the reports collection ordered newest-first.
 * Returns an unsubscribe function – call it on component unmount.
 */
export function subscribeReports(
  cb: (reports: Report[]) => void,
): () => void {
  const q = query(collection(db, "reports"), orderBy("time", "desc"));
  return onSnapshot(q, snapshot => {
    cb(snapshot.docs.map(d => d.data() as Report));
  });
}

// ─── Visitors ─────────────────────────────────────────────────────────────────

/** Write (or overwrite) a visitor record. */
export async function saveVisitor(visitor: VisitorRecord): Promise<void> {
  await setDoc(doc(db, "visitors", visitor.id), visitor, { merge: true });
}

/**
 * Partially update a visitor – used to flip status or reminderSent flag.
 * Only the supplied fields are written; the rest of the document is preserved.
 */
export async function updateVisitorRemote(
  id: string,
  updates: Partial<VisitorRecord>,
): Promise<void> {
  await updateDoc(doc(db, "visitors", id), updates as Record<string, unknown>);
}

/**
 * Subscribe to all visitor records ordered by creation time (newest first).
 * Returns an unsubscribe function.
 */
export function subscribeVisitors(
  cb: (visitors: VisitorRecord[]) => void,
): () => void {
  const q = query(collection(db, "visitors"), orderBy("createdAt", "desc"));
  return onSnapshot(q, snapshot => {
    cb(snapshot.docs.map(d => d.data() as VisitorRecord));
  });
}

// ─── Attendance ───────────────────────────────────────────────────────────────

/** Write an attendance record (clock-in or QR check-in). */
export async function saveAttendance(record: AttendanceRecord): Promise<void> {
  await setDoc(doc(db, "attendance", record.id), record, { merge: true });
}

/**
 * Subscribe to all attendance records ordered newest-first.
 * Returns an unsubscribe function.
 */
export function subscribeAttendance(
  cb: (records: AttendanceRecord[]) => void,
): () => void {
  const q = query(collection(db, "attendance"), orderBy("time", "desc"));
  return onSnapshot(q, snapshot => {
    cb(snapshot.docs.map(d => d.data() as AttendanceRecord));
  });
}