// Disposable/fake email domain blocklist
const BLOCKED_DOMAINS = new Set([
  "tempmail.com","throwaway.email","guerrillamail.com","mailinator.com",
  "sharklasers.com","guerrillamailblock.com","grr.la","guerrillamail.info",
  "spam4.me","trashmail.com","trashmail.me","trashmail.net","trashmail.org",
  "yopmail.com","yopmail.fr","cool.fr.nf","jetable.fr.nf","nospam.ze.tc",
  "nomail.xl.cx","mega.zik.dj","speed.1s.fr","courriel.fr.nf",
  "moncourrier.fr.nf","monemail.fr.nf","monmail.fr.nf","10minutemail.com",
  "10minutemail.net","10minutemail.org","tempr.email","discard.email",
  "fakeinbox.com","mailnull.com","spamgourmet.com","spamgourmet.net",
  "spamgourmet.org","spamtraps.nl","maildrop.cc","getairmail.com",
  "filzmail.com","throwam.com","sharklasers.com","yomail.info",
  "gishpuppy.com","trashmail.at","mt2015.com","dispostable.com",
  "mailnesia.com","e4ward.com","spam.la","anonbox.net","spambox.us",
  "mailexpire.com","spamhole.com","wegwerfmail.de","mail-temporaire.fr",
  "wegwerfmail.net","wegwerfmail.org","wegwerfemail.com","tempinbox.com",
]);

// Trusted providers (for suggestion)
const TRUSTED_PROVIDERS = [
  "gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com",
  "live.com","msn.com","protonmail.com","proton.me","zoho.com",
  "mail.com","aol.com","yandex.com","tutanota.com","fastmail.com",
];

export interface EmailValidationResult {
  valid: boolean;
  errorAr?: string;
  errorEn?: string;
  suggestion?: string;
}

export function validateEmail(email: string): EmailValidationResult {
  const trimmed = email.trim().toLowerCase();

  // Format check
  const formatRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (!formatRegex.test(trimmed)) {
    return {
      valid: false,
      errorAr: "صيغة البريد غير صحيحة. مثال: name@gmail.com",
      errorEn: "Invalid email format. Example: name@gmail.com",
    };
  }

  const domain = trimmed.split("@")[1];

  // Blocked domain check
  if (BLOCKED_DOMAINS.has(domain)) {
    return {
      valid: false,
      errorAr: "لا يُسمح بعناوين البريد المؤقتة. استخدم Gmail أو Outlook أو بريداً حقيقياً.",
      errorEn: "Disposable emails are not allowed. Please use Gmail, Outlook, or a real email.",
    };
  }

  // Check for suspicious patterns
  const localPart = trimmed.split("@")[0];
  if (localPart.length < 3) {
    return {
      valid: false,
      errorAr: "اسم المستخدم في البريد قصير جداً.",
      errorEn: "Email username is too short.",
    };
  }

  // Check for multiple consecutive dots or special chars
  if (/\.{2,}/.test(trimmed) || /[^a-zA-Z0-9@._+\-]/.test(trimmed)) {
    return {
      valid: false,
      errorAr: "البريد يحتوي على أحرف غير مسموح بها.",
      errorEn: "Email contains invalid characters.",
    };
  }

  // Suggest trusted provider if unknown domain
  const isTrusted = TRUSTED_PROVIDERS.includes(domain);
  if (!isTrusted) {
    // Still valid but warn
    return {
      valid: true,
      suggestion: `تأكد أن ${domain} بريدك الحقيقي`,
    };
  }

  return { valid: true };
}

export function isGmailAddress(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@gmail.com");
}
