export type Language = "ar" | "en";
export type Role = "owner" | "admin" | "guard";
export type ReportStatus = "normal" | "warning" | "critical";
export type Tab = "dashboard" | "reports" | "alerts" | "buildings" | "users" | "visitors" | "attendance" | "tasks" | "chat" | "analytics" | "audit" | "system" | "settings" | "violations" | "scores" | "patrol" | "map" | "sos";
export type ToastTone = "success" | "danger" | "info";
export type AuditSeverity = "info" | "warning" | "critical";

export interface Pair { ar: string; en: string; }

export interface User {
  id: string; name: string; email: string; phone: string; role: Role;
  status: "approved" | "pending"; permissions: string[];
  assignedBuildingId?: string; rating: number; passwordHash: string;
  soundEnabled: boolean; desktopNotificationsEnabled: boolean;
  showFullToAdmin: boolean; createdAt: string; avatar?: string;
  violations?: number; lastSeen?: string;
}

export interface Building {
  id: string; nameAr: string; nameEn: string; area: string; qrCode: string;
  lat?: number; lng?: number;
}

export interface ReportComment {
  id: string; authorId: string; authorName: string; text: string; time: string;
}

export interface Report {
  id: string; buildingId: string; text: string; senderId: string;
  senderName: string; senderEmail: string; senderPhone: string;
  time: string; status: ReportStatus; mediaUrl?: string;
  mediaKind?: "image" | "video"; fileName?: string;
  comments?: ReportComment[];
  editedAt?: string;
}

export interface AlertLog {
  id: string; status: string; target: string; text: string;
  sender: string; time: string; severity: "info" | "warning" | "critical";
}

export interface AttendanceRecord {
  id: string; userId: string; userName: string; buildingId: string;
  method: "manual" | "qr"; time: string; checkOut?: string;
}

export interface Task {
  id: string; title: string; details: string; assignedTo: string;
  assignedName: string; status: "pending" | "in-progress" | "done";
  createdAt: string; dueDate?: string; priority?: "low" | "medium" | "high";
}

export interface VisitorRecord {
  id: string; guestName: string; company: string; purpose: string;
  identityNumber?: string; buildingId: string; arrivalDate: string;
  arrivalTime: string; createdBy: string; createdAt: string;
  passCode: string; status: "scheduled" | "arrived" | "departed" | "cancelled";
  reminderSent: boolean; preNotified: boolean; qrData?: string;
  checkInTime?: string; checkOutTime?: string; notes?: string;
}

export interface ChatMessage {
  id: string; senderId: string; kind: "text" | "audio" | "image";
  text?: string; audioUrl?: string; imageUrl?: string; time: string;
}

export interface Conversation {
  id: string; participantId: string; participantName: string;
  participantRole: Role; messages: ChatMessage[]; lastSeen?: string;
}

export interface AuditEntry {
  id: string; actorId: string; actorName: string; action: string;
  target: string; details: string; severity: AuditSeverity; time: string;
}

export interface Shift {
  id: string; guardId: string; guardName: string; buildingId: string;
  date: string; startTime: string; endTime: string;
  status: "scheduled" | "active" | "completed" | "missed";
  checkInTime?: string; checkOutTime?: string;
  endOfShiftReport?: string; createdAt: string;
  overtimeMinutes?: number;
}

export interface Violation {
  id: string; guardId: string; guardName: string; type: string;
  description: string; severity: "minor" | "major" | "critical";
  buildingId?: string; issuedBy: string; issuedAt: string;
  acknowledged?: boolean; acknowledgedAt?: string; penalty?: string;
}

export interface SOSEvent {
  id: string; guardId: string; guardName: string; buildingId?: string;
  lat?: number; lng?: number; address?: string;
  time: string; resolved: boolean; resolvedAt?: string;
  resolvedBy?: string; notes?: string;
}

export interface SystemSettings {
  emergencyContact: string; welcomeAr: string; welcomeEn: string;
  criticalEmail: string; criticalSms: string;
  visitorReminderMinutes: number; orgName?: string; orgLogo?: string;
  shiftStartHour?: number; shiftEndHour?: number;
}

export interface AppSnapshot {
  buildings: Building[]; users: User[]; reports: Report[];
  alerts: AlertLog[]; attendance: AttendanceRecord[]; tasks: Task[];
  visitors: VisitorRecord[]; conversations: Conversation[];
  auditLog: AuditEntry[]; systemSettings: SystemSettings;
  shifts: Shift[]; violations: Violation[]; sosEvents: SOSEvent[];
}

export interface Toast { text: string; tone: ToastTone; }
export interface NewAccountPayload {
  name: string; email: string; phone: string; password: string;
  role: Role; buildingId: string;
}
export interface VisitorFormPayload {
  guestName: string; company: string; purpose: string;
  identityNumber?: string; buildingId: string;
  arrivalDate: string; arrivalTime: string; notes?: string;
}
export type Report2 = Report;

// ─── Patrol Rounds ─────────────────────────────────────────────────────────
export interface PatrolCheckpoint {
  buildingId: string;
  buildingName: string;
  order: number;
  scannedAt?: string;
}

export interface PatrolRound {
  id: string;
  guardId: string;
  guardName: string;
  startedAt: string;
  completedAt?: string;
  checkpoints: PatrolCheckpoint[];
  status: "active" | "completed" | "missed";
}

export interface PatrolRoute {
  id: string;
  name: string;
  nameAr: string;
  buildingIds: string[];
  createdBy: string;
}
