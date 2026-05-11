import { useState, type FormEvent } from "react";
import { authContent, t } from "../data/translations";
import type { Building, Language, NewAccountPayload } from "../types/security";

type Props = {
  language: Language;
  buildings: Building[];
  errorMessage: string | null;
  infoMessage: string | null;
  onSignIn: (email: string, password: string) => Promise<void> | void;
  onCreateAccount: (payload: NewAccountPayload) => Promise<void> | void;
  onLanguageChange: (language: Language) => void;
};

export default function AuthScreen({
  language,
  buildings,
  errorMessage,
  infoMessage,
  onSignIn,
  onCreateAccount,
  onLanguageChange,
}: Props) {
  const [tab, setTab] = useState<"signin" | "create">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [signInForm, setSignInForm] = useState({ email: "", password: "" });
  const [createForm, setCreateForm] = useState<NewAccountPayload & { confirmPassword: string }>({
    name: "",
    email: "",
    phone: "",
    role: "guard",
    buildingId: buildings[0]?.id ?? "",
    password: "",
    confirmPassword: "",
  });

  const submitSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSignIn(signInForm.email, signInForm.password);
  };

  const submitCreateAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createForm.password !== createForm.confirmPassword) return;
    const { confirmPassword, ...payload } = createForm;
    void confirmPassword;
    await onCreateAccount(payload);
  };

  return (
    <div dir={language === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-[#040818] text-white">
      <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col justify-between border-b border-white/10 p-8 lg:border-b-0 lg:border-e lg:p-12">
          <div>
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => onLanguageChange("ar")}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition ${language === "ar" ? "bg-amber-500 text-black" : "text-slate-300"}`}
                >
                  العربية
                </button>
                <button
                  type="button"
                  onClick={() => onLanguageChange("en")}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition ${language === "en" ? "bg-amber-500 text-black" : "text-slate-300"}`}
                >
                  English
                </button>
              </div>
            </div>
            <div className="mb-16 flex items-center gap-4">
              <div className="rounded-[22px] border border-amber-400/30 bg-[#111b3d] p-3 shadow-[0_0_28px_rgba(245,158,11,0.35)]">
                <svg viewBox="0 0 24 24" className="h-10 w-10 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 3l7 3v5c0 5.25-3 8.5-7 10-4-1.5-7-4.75-7-10V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <div className="text-4xl font-black tracking-wide text-amber-400">QA SECURITY</div>
                <div className="text-sm font-semibold text-slate-400">Integrated Security System</div>
              </div>
            </div>

            <div className="max-w-xl space-y-5 pt-20 lg:pt-40">
              <h1 className="text-4xl font-black leading-tight text-white lg:text-6xl">{t(language, authContent.brandTitle)}</h1>
              <div className="text-4xl font-black text-amber-400 lg:text-5xl">QA SECURITY</div>
              <p className="max-w-lg text-base leading-8 text-slate-400 lg:text-lg">{t(language, authContent.brandSubtitle)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-slate-500">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3l7 3v5c0 5.25-3 8.5-7 10-4-1.5-7-4.75-7-10V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t(language, authContent.footer)}
          </div>
        </div>

        <div className="flex items-center justify-center p-6 lg:p-12">
          <div className="w-full max-w-xl">
            <div className="mb-8 flex border-b border-white/10 text-lg font-bold">
              <button
                type="button"
                onClick={() => setTab("signin")}
                className={`flex-1 border-b-2 px-4 py-4 transition ${tab === "signin" ? "border-amber-400 text-amber-300" : "border-transparent text-slate-400"}`}
              >
                {t(language, authContent.signInTab)}
              </button>
              <button
                type="button"
                onClick={() => setTab("create")}
                className={`flex-1 border-b-2 px-4 py-4 transition ${tab === "create" ? "border-amber-400 text-amber-300" : "border-transparent text-slate-400"}`}
              >
                {t(language, authContent.createAccountTab)}
              </button>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-[#0b132b] p-8 shadow-[0_22px_70px_rgba(0,0,0,0.35)]">
              {errorMessage ? <div className="mb-5 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">{errorMessage}</div> : null}
              {infoMessage ? <div className="mb-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{infoMessage}</div> : null}

              {tab === "signin" ? (
                <form onSubmit={submitSignIn} className="space-y-5">
                  <h2 className="text-4xl font-black text-white">{t(language, authContent.signInTab)}</h2>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-400">Email</label>
                    <input
                      value={signInForm.email}
                      onChange={(event) => setSignInForm((previous) => ({ ...previous, email: event.target.value }))}
                      className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none placeholder:text-slate-500 focus:border-amber-400/60"
                      placeholder="example@qa.com"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-400">Password</label>
                    <div className="flex h-12 items-center rounded-2xl border border-white/10 bg-[#070d22] px-4">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={signInForm.password}
                        onChange={(event) => setSignInForm((previous) => ({ ...previous, password: event.target.value }))}
                        className="flex-1 bg-transparent text-white outline-none placeholder:text-slate-500"
                        placeholder="••••••••"
                      />
                      <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-slate-400">👁️</button>
                    </div>
                  </div>
                  <button className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-400 text-lg font-black text-black transition hover:from-amber-400 hover:to-orange-300">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 3l7 3v5c0 5.25-3 8.5-7 10-4-1.5-7-4.75-7-10V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t(language, authContent.signInTab)}
                  </button>
                </form>
              ) : (
                <form onSubmit={submitCreateAccount} className="space-y-4">
                  <h2 className="text-4xl font-black text-white">{t(language, authContent.createAccountTab)}</h2>
                  <p className="text-sm text-slate-400">{t(language, authContent.waitingApproval)}</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "الاسم" : "Name"}</label>
                      <input value={createForm.name} onChange={(event) => setCreateForm((previous) => ({ ...previous, name: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-400">Email</label>
                      <input value={createForm.email} onChange={(event) => setCreateForm((previous) => ({ ...previous, email: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "الدور" : "Role"}</label>
                      <select value={createForm.role} onChange={(event) => setCreateForm((previous) => ({
                        ...previous,
                        role: event.target.value as "admin" | "guard",
                        phone: event.target.value === "admin" ? "" : previous.phone,
                        buildingId: event.target.value === "admin" ? "" : previous.buildingId || buildings[0]?.id || "",
                      }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none">
                        <option value="guard">{language === "ar" ? "حارس أمن" : "Security Guard"}</option>
                        <option value="admin">{language === "ar" ? "إداري" : "Admin"}</option>
                      </select>
                    </div>
                    {createForm.role === "guard" ? (
                      <>
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "الجوال" : "Phone"}</label>
                          <input value={createForm.phone} onChange={(event) => setCreateForm((previous) => ({ ...previous, phone: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "المبنى المطلوب" : "Requested Building"}</label>
                          <select value={createForm.buildingId} onChange={(event) => setCreateForm((previous) => ({ ...previous, buildingId: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none">
                            {buildings.map((building) => (
                              <option key={building.id} value={building.id}>{language === "ar" ? building.nameAr : building.nameEn}</option>
                            ))}
                          </select>
                        </div>
                      </>
                    ) : null}
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-400">Password</label>
                      <div className="flex h-12 items-center rounded-2xl border border-white/10 bg-[#070d22] px-4">
                        <input type={showCreatePassword ? "text" : "password"} value={createForm.password} onChange={(event) => setCreateForm((previous) => ({ ...previous, password: event.target.value }))} className="flex-1 bg-transparent text-white outline-none" />
                        <button type="button" onClick={() => setShowCreatePassword((value) => !value)} className="text-slate-400">👁️</button>
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "تأكيد كلمة المرور" : "Confirm Password"}</label>
                       <input type="password" value={createForm.confirmPassword} onChange={(event) => setCreateForm((previous) => ({ ...previous, confirmPassword: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
                    </div>
                  </div>
                  <button className="flex h-12 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-amber-500 to-orange-400 text-lg font-black text-black transition hover:from-amber-400 hover:to-orange-300">
                    {t(language, authContent.createAccountTab)}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
