// Password reset email via EmailJS (client-side, free tier)
// Setup required: create account at emailjs.com, then fill these 3 values.
const EMAILJS_SERVICE_ID = "YOUR_SERVICE_ID";
const EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID";
const EMAILJS_PUBLIC_KEY = "YOUR_PUBLIC_KEY";

export async function sendResetEmail(toEmail: string, toName: string, code: string): Promise<boolean> {
  // If not configured, fail gracefully
  if (EMAILJS_SERVICE_ID === "YOUR_SERVICE_ID") {
    console.warn("EmailJS not configured");
    return false;
  }
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
        },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
