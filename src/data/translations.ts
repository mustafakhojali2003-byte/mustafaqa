import type { Language } from "../types/security";

export const authContent = {
  brandTitle: {
    ar: "منصة تشغيل الأمن الذكية",
    en: "Smart Security Operations System",
  },
  brandSubtitle: {
    ar: "بوابة الوصول الآمنة للمالك، الإدمن، والحراس داخل منظومة QA SECURITY.",
    en: "A secure access portal for owners, admins, and guards inside QA SECURITY.",
  },
  signInTab: {
    ar: "تسجيل الدخول",
    en: "Sign In",
  },
  createAccountTab: {
    ar: "إنشاء حساب",
    en: "Create Account",
  },
  waitingApproval: {
    ar: "سيبقى الحساب في انتظار موافقة المالك قبل تفعيل الدخول.",
    en: "The account will remain pending until approved by the owner.",
  },
  footer: {
    ar: "جميع الحقوق محفوظة © 2026 QA SECURITY",
    en: "All Rights Reserved © 2026 QA SECURITY",
  },
};

export function t(language: Language, value: { ar: string; en: string }) {
  return value[language];
}
