import { useState, type FormEvent } from "react";
import type { Building, Language, VisitorFormPayload } from "../types/security";

type Props = {
  open: boolean;
  language: Language;
  buildings: Building[];
  onClose: () => void;
  onSubmit: (payload: VisitorFormPayload) => void;
};

export default function VisitorManagementModal({
  open,
  language,
  buildings,
  onClose,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<VisitorFormPayload>({
    guestName: "",
    company: "",
    purpose: "",
    buildingId: buildings[0]?.id ?? "",
    arrivalDate: new Date().toISOString().slice(0, 10),
    arrivalTime: "09:00",
  });

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(form);
    setForm((previous) => ({ ...previous, guestName: "", company: "", purpose: "" }));
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[32px] border border-white/10 bg-[#091128] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-3xl font-black text-white">{language === "ar" ? "إدارة الزوار والتصاريح" : "Visitor Management & Passes"}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {language === "ar"
                ? "أدخل اسم الشخص أو الشركة مع موعد الوصول ليتم إشعار الحراس مسبقاً وإنشاء تصريح زيارة." 
                : "Enter the visitor or company name with arrival time to notify guards early and generate a visit pass."}
            </p>
          </div>
          <button onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 transition hover:bg-white/10">
            {language === "ar" ? "إغلاق" : "Close"}
          </button>
        </div>

        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "اسم الشخص" : "Visitor Name"}</label>
            <input value={form.guestName} onChange={(event) => setForm((previous) => ({ ...previous, guestName: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "الشركة" : "Company"}</label>
            <input value={form.company} onChange={(event) => setForm((previous) => ({ ...previous, company: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "الغرض من الزيارة" : "Purpose"}</label>
            <input value={form.purpose} onChange={(event) => setForm((previous) => ({ ...previous, purpose: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "رقم الهوية" : "Identity Number"}</label>
            <input value={form.identityNumber ?? ""} onChange={(event) => setForm((previous) => ({ ...previous, identityNumber: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "المبنى أو البوابة" : "Building / Gate"}</label>
            <select value={form.buildingId} onChange={(event) => setForm((previous) => ({ ...previous, buildingId: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none">
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>{language === "ar" ? building.nameAr : building.nameEn}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "تاريخ الوصول" : "Arrival Date"}</label>
            <input type="date" value={form.arrivalDate} onChange={(event) => setForm((previous) => ({ ...previous, arrivalDate: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-400">{language === "ar" ? "وقت الوصول" : "Arrival Time"}</label>
            <input type="time" value={form.arrivalTime} onChange={(event) => setForm((previous) => ({ ...previous, arrivalTime: event.target.value }))} className="h-12 w-full rounded-2xl border border-white/10 bg-[#070d22] px-4 text-white outline-none" required />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-amber-500 to-orange-400 px-6 text-sm font-black text-black transition hover:from-amber-400 hover:to-orange-300">
              {language === "ar" ? "إنشاء تصريح وإرسال إشعار" : "Generate Pass & Notify"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
