export type Language = "ar" | "en";
export type Role = "owner" | "admin" | "guard";
export type AccountStatus = "approved" | "pending";

export type Tab =
  | "dashboard"
  | "reports"
  | "alerts"
  | "buildings"
  | "users"
  | "visitors"
  | "attendance"
  | "tasks"
  | "chat"
  | "analytics"
  | "audit"
  | "system"
  | "settings";

export type Pair = {
  ar: string;
  en: string;
};

export type Building = {
  id: string;
  nameAr: string;
  nameEn: string;
  area: string;
  qrCode: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  status: AccountStatus;
  assignedBuildingId?: string;
  permissions: string[];
  rating: number;
  passwordHash: string;
  soundEnabled: boolean;
  desktopNotificationsEnabled: boolean;
  showFullToAdmin?: boolean;
  createdAt: string;
};

export type ReportStatus = "normal" | "warning" | "critical";

export type Report = {
  id: string;
  buildingId: string;
  text: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  time: string;
  status: ReportStatus;
  mediaUrl?: string;
  mediaKind?: "image" | "video";
  fileName?: string;
};

export type AlertLog = {
  id: string;
  status: string;
  target: string;
  text: string;
  sender: string;
  time: string;
  severity: "info" | "warning" | "critical";
};

export type AttendanceRecord = {
  id: string;
  userId: string;
  userName: string;
  buildingId: string;
  method: "manual" | "qr";
  time: string;
};

export type Task = {
  id: string;
  title: string;
  details: string;
  assignedTo: string;
  assignedName: string;
  status: "pending" | "done";
  createdAt: string;
};

export type VisitorRecord = {
  id: string;
  guestName: string;
  company: string;
  purpose: string;
  identityNumber?: string;
  buildingId: string;
  arrivalDate: string;
  arrivalTime: string;
  createdBy: string;
  createdAt: string;
  passCode: string;
  status: "scheduled" | "arrived" | "expired";
  reminderSent: boolean;
  preNotified: boolean;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  kind: "text" | "image" | "video" | "audio";
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  time: string;
};

export type Conversation = {
  id: string;
  participantId: string;
  participantName: string;
  participantRole: Role;
  messages: ChatMessage[];
};

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditEntry = {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  target: string;
  details: string;
  severity: AuditSeverity;
  time: string;
};

export type SystemSettings = {
  emergencyContact: string;
  welcomeAr: string;
  welcomeEn: string;
  criticalEmail: string;
  criticalSms: string;
  visitorReminderMinutes: number;
};

export type ToastTone = "success" | "danger" | "info";

export type Toast = {
  text: string;
  tone: ToastTone;
};

export type AppSnapshot = {
  buildings: Building[];
  users: User[];
  reports: Report[];
  alerts: AlertLog[];
  attendance: AttendanceRecord[];
  tasks: Task[];
  visitors: VisitorRecord[];
  conversations: Conversation[];
  auditLog: AuditEntry[];
  systemSettings: SystemSettings;
};

export type NewAccountPayload = {
  name: string;
  email: string;
  phone: string;
  role: Exclude<Role, "owner">;
  buildingId: string;
  password: string;
};

export type VisitorFormPayload = {
  guestName: string;
  company: string;
  purpose: string;
  identityNumber?: string;
  buildingId: string;
  arrivalDate: string;
  arrivalTime: string;
};
