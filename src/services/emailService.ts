// Password reset email via EmailJS (client-side, free tier)
// Setup: create account at emailjs.com, then fill these 3 values.
const EMAILJS_SERVICE_ID = "service_40t762m";
const EMAILJS_TEMPLATE_ID = "template_vuuqicz";
const EMAILJS_PUBLIC_KEY = "U8ibb9uUevdDiZbOa";

type Lang = "ar" | "en";

const TEXTS: Record<Lang, Record<string, string>> = {
  ar: {
    subject: "كود استعادة كلمة المرور - QGuard",
    title: "طلب تغيير كلمة المرور",
    greeting: "مرحباً",
    intro: "لقد تلقينا طلباً لاستعادة كلمة المرور. استخدم الكود التالي:",
    validity: "هذا الكود صالح لمدة 15 دقيقة.",
    ignore: "إذا لم تطلب هذا، تجاهل الرسالة. حسابك آمن.",
    signature: "مع التحية، فريق",
    dir: "rtl",
  },
  en: {
    subject: "Password Reset Code - QGuard",
    title: "Password Reset Request",
    greeting: "Hello",
    intro: "We received a request to reset your password. Use the code below:",
    validity: "This code is valid for 15 minutes.",
    ignore: "If you didn't request this, ignore this email. Your account is safe.",
    signature: "Best regards, Team",
    dir: "ltr",
  },
};

export async function sendResetEmail(
  toEmail: string,
  toName: string,
  code: string,
  lang: Lang = "ar",
): Promise<boolean> {
  if (EMAILJS_SERVICE_ID === "YOUR_SERVICE_ID") {
    console.warn("EmailJS not configured");
    return false;
  }
  const tx = TEXTS[lang];
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: toEmail,
          to_name: toName,
          reset_code: code,
          subject: tx.subject,
          title: tx.title,
          greeting: tx.greeting,
          intro: tx.intro,
          validity: tx.validity,
          ignore: tx.ignore,
          signature: tx.signature,
          dir: tx.dir,
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
