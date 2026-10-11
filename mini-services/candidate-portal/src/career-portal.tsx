"use client";
// ============================================================================
// RekanKerja — CAREER PORTAL (Recruitment F2 · D1): portal karier PUBLIK.
// ⚠️ AMANDEMEN 1 (2026-10-11): komponen ini DIPINDAH dari aplikasi utama
// (dulu di src/rekankerja/shared/components/auth/career-portal.tsx — salah
// tempat) ke layanan TERPISAH mini-services/candidate-portal/. Portal
// kandidat = aplikasi sendiri + domain sendiri saat produksi
// (karir.<perusahaan> ≠ app.<perusahaan>). Komponen ini adalah REFERENSI
// UI F2 — di-serve layanan ini setelah scaffolding Next.js penuh (resume
// F2). Prop onLogin (dulu kembali ke AuthGate aplikasi utama) diganti
// rute login domain internal saat integrasi final.
//
// Daftar lowongan slot Posted + form lamaran anonim (staging
// PublicApplication) TANPA login — murni untuk pengunjung publik.
//
// • Data  : GET  /api/public/recruitment/openings?t=<slug>&limit=50
//           (resolusi tenant: ?t= → host → default; multi-tenant → picker)
// • Capcha: GET  /api/public/recruitment/captcha (challenge matematika HMAC,
//           TTL 10 menit — token diminta saat dialog DIBUKA & tombol segarkan)
// • Kirim : POST /api/public/recruitment/apply?t=<slug> (multipart — browser
//           yang menyetel boundary; JANGAN set Content-Type manual)
// • Anti-bot: honeypot field "website" tersembunyi (bot yang mengisi DOM akan
//   terbawa FormData → server tandai Spam; respons tetap 201 — identik).
// • Estetika: halaman marketing publik — ivory hangat + aksen oranye modul
//   rekrutmen (#ea580c), kartu hover-lift, tanpa indigo/blue.
// ============================================================================
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle, Briefcase, Building2, CalendarClock, CheckCircle2, FileText, GraduationCap,
  Loader2, MapPin, RefreshCw, SearchX, Send, ShieldCheck, Sparkles, Upload, UserRound, Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { cn } from "@/lib/utils";

// ============ tipe respons API publik (mirror public-recruitment-service) ============

interface PublicOpeningItem {
  slotId: string;
  joRefNo: string;
  title: string;
  location: string | null;
  city: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryUnit: string;
  jobDescSummary: string | null;
  jobSpecSummary: string | null;
  closingDate: string | null;
  employmentStatus: string | null;
}

interface OpeningsResponse {
  tenant: { slug: string; companyName: string } | null;
  tenants?: { slug: string; companyName: string }[];
  openings: PublicOpeningItem[];
}

interface CaptchaChallenge {
  question: string;
  token: string;
  expiresInSeconds: number;
}

// ============ katalog label dwibahasa (lokal — portal tidak menarik modul admin) ============

/** Label status kerja (nilai PR.employmentStatus). */
const EMPLOYMENT_LABEL: Record<string, [string, string]> = {
  Permanent: ["Tetap", "Permanent"],
  Contract: ["Kontrak", "Contract"],
  Probation: ["Percobaan", "Probation"],
  Outsourcing: ["Outsourcing", "Outsourcing"],
};

/** Label satuan gaji (nilai salaryUnit slot). */
const SALARY_UNIT_LABEL: Record<string, [string, string]> = {
  Monthly: ["/bulan", "/month"],
  Yearly: ["/tahun", "/year"],
  Weekly: ["/minggu", "/week"],
  Daily: ["/hari", "/day"],
  Hourly: ["/jam", "/hour"],
};

/** Opsi jenjang pendidikan (enum form publik). */
const EDUCATION_OPTIONS: { value: string; label: [string, string] }[] = [
  { value: "SMP", label: ["SMP", "Junior High School (SMP)"] },
  { value: "SMA", label: ["SMA", "Senior High School (SMA)"] },
  { value: "SMK", label: ["SMK", "Vocational High School (SMK)"] },
  { value: "D3", label: ["D3 — Diploma", "D3 — Diploma"] },
  { value: "S1", label: ["S1 — Sarjana", "S1 — Bachelor's"] },
  { value: "S2", label: ["S2 — Magister", "S2 — Master's"] },
  { value: "S3", label: ["S3 — Doktor", "S3 — Doctorate"] },
  { value: "PROF", label: ["Profesi", "Professional"] },
];

/** Pesan error server (Indonesia) → padanan EN — ditampilkan via t(id, en). */
const SERVER_ERRORS: Record<string, string> = {
  "Terlalu banyak permintaan. Coba lagi nanti.": "Too many requests. Please try again later.",
  "Terlalu banyak lamaran terkirim. Silakan coba lagi nanti.": "Too many applications submitted. Please try again later.",
  "Verifikasi keamanan salah atau kedaluwarsa. Silakan coba lagi.": "Security verification is incorrect or expired. Please try again.",
  "Persetujuan pemrosesan data pribadi wajib diberikan.": "Consent to personal data processing is required.",
  "Nama depan wajib diisi": "First name is required.",
  "Email valid wajib diisi": "A valid email address is required.",
  "Lowongan sudah tidak tersedia. Silakan pilih lowongan lain.": "This opening is no longer available. Please choose another one.",
  "CV harus JPG/PNG/WEBP/PDF dan maksimum 5 MB": "The CV must be a JPG/PNG/WEBP/PDF file of at most 5 MB.",
  "Perusahaan tidak ditemukan. Pilih perusahaan pada halaman karier.": "Company not found. Please choose a company on the career page.",
  "Request harus multipart/form-data": "Invalid request format.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_EXTS = ["jpg", "jpeg", "png", "webp", "pdf"];

/** Nilai state form lamaran (string semua — server parse angka). */
interface ApplyForm {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  birthDate: string;
  gender: string;
  educationLevel: string;
  fieldOfStudy: string;
  institution: string;
  graduationYear: string;
  gpa: string;
  expYears: string;
  lastPosition: string;
  lastCompany: string;
  expectedSalary: string;
  notes: string;
}

const EMPTY_FORM: ApplyForm = {
  firstName: "", middleName: "", lastName: "", email: "", phone: "", city: "",
  birthDate: "", gender: "none", educationLevel: "none", fieldOfStudy: "", institution: "",
  graduationYear: "", gpa: "", expYears: "", lastPosition: "", lastCompany: "",
  expectedSalary: "", notes: "",
};

// ============ sub-komponen kecil ============

/** Saklar bahasa ID/EN ringkas (pola useI18n().setLang). */
function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("Ganti bahasa", "Change language")}
      className="flex items-center rounded-full border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900"
    >
      {(["id", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider transition-colors",
            lang === l
              ? "bg-orange-600 text-white shadow-sm"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** Judul seksi form lamaran. */
function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-950/70 dark:text-orange-300">
        {icon}
      </span>
      <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{children}</h4>
    </div>
  );
}

/** Bungkus field: label (+ asterisk wajib) + kontrol + hint. */
function Field({
  label, required, hint, htmlFor, children,
}: { label: string; required?: boolean; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-orange-600 dark:text-orange-400" aria-hidden>*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-slate-400">{hint}</p>}
    </div>
  );
}

/** Chip meta kartu lowongan. */
function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-800 ring-1 ring-orange-200/70 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-900/70">
      {icon}
      {children}
    </span>
  );
}

// ============ komponen utama ============

export function CareerPortal({ onLogin }: { onLogin: () => void }) {
  const { t, locale, monthShort } = useI18n();

  // ---- daftar lowongan (tenant: ?t= → host → default server) ----
  const [data, setData] = useState<OpeningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null); // override pilihan picker
  const [reloadTick, setReloadTick] = useState(0);

  // ---- dialog form lamaran ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [target, setTarget] = useState<PublicOpeningItem | null>(null); // null = lamaran umum
  const [form, setForm] = useState<ApplyForm>(EMPTY_FORM);
  const [consent, setConsent] = useState(false);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  // ---- captcha (challenge HMAC, TTL 10 mnt) ----
  const [captcha, setCaptcha] = useState<CaptchaChallenge | null>(null);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const [captchaErr, setCaptchaErr] = useState<string | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");

  // ---- status kirim ----
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const set = <K extends keyof ApplyForm>(k: K, v: ApplyForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const company = data?.tenant?.companyName ?? null;
  const openings = data?.openings ?? [];
  const activeSlug = slug ?? data?.tenant?.slug ?? null;

  // ---- muat daftar lowongan (tenant aktif) ----
  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const qs = `?limit=50${slug ? `&t=${encodeURIComponent(slug)}` : ""}`;
        const r = await fetch(`/api/public/recruitment/openings${qs}`);
        const j = (await r.json().catch(() => ({}))) as OpeningsResponse & { error?: string };
        if (!alive) return;
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setData(j);
        setLoading(false);
      } catch (e) {
        if (!alive) return;
        setLoadError(e instanceof Error ? e.message : "unknown");
        setLoading(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, [slug, reloadTick]);

  // ---- captcha: challenge baru (dipanggil saat dialog dibuka + tombol segarkan) ----
  const refreshCaptcha = useCallback(async () => {
    setCaptchaBusy(true);
    setCaptchaErr(null);
    try {
      const r = await fetch("/api/public/recruitment/captcha");
      const j = (await r.json().catch(() => ({}))) as CaptchaChallenge & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setCaptcha(j);
    } catch (e) {
      setCaptcha(null);
      setCaptchaErr(e instanceof Error ? e.message : "unknown");
    } finally {
      setCaptchaBusy(false);
    }
  }, []);

  // ---- buka dialog (slot terpilih / lamaran umum) ----
  const openApply = (o: PublicOpeningItem | null) => {
    setTarget(o);
    setSubmitted(false);
    setSubmitError(null);
    setCaptchaAnswer("");
    setDialogOpen(true);
    void refreshCaptcha(); // token diminta saat dialog DIBUKA
  };

  // ---- tutup dialog; reset isi form HANYA setelah sukses ----
  const closeDialog = () => {
    setDialogOpen(false);
    if (submitted) {
      setForm(EMPTY_FORM);
      setConsent(false);
      setCvFile(null);
      setCvError(null);
      setSubmitted(false);
      setTarget(null);
      setCaptchaAnswer("");
      setSubmitError(null);
    }
  };

  // ---- validasi CV ringan di klien (server tetap otoritatif) ----
  const onCvChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ""; // izinkan memilih ulang file yang sama
    setCvError(null);
    if (!f) { setCvFile(null); return; }
    const ext = f.name.toLowerCase().split(".").pop() ?? "";
    if (!CV_EXTS.includes(ext)) {
      setCvError(t("Format CV harus JPG, PNG, WEBP, atau PDF.", "CV format must be JPG, PNG, WEBP, or PDF."));
      setCvFile(null);
      return;
    }
    if (f.size > CV_MAX_BYTES) {
      setCvError(t("Ukuran CV maksimum 5 MB.", "CV must be at most 5 MB."));
      setCvFile(null);
      return;
    }
    setCvFile(f);
  };

  // ---- kirim lamaran (multipart — tanpa Content-Type manual) ----
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // validasi klien ringan
    const errs: string[] = [];
    if (!form.firstName.trim()) errs.push(t("Nama depan wajib diisi.", "First name is required."));
    if (!EMAIL_RE.test(form.email.trim())) errs.push(t("Email valid wajib diisi.", "A valid email address is required."));
    if (!/^\d+$/.test(captchaAnswer.trim())) errs.push(t("Jawab pertanyaan verifikasi keamanan (angka).", "Answer the security verification question (a number)."));
    if (!consent) errs.push(t("Persetujuan pemrosesan data pribadi wajib diberikan.", "Consent to personal data processing is required."));
    if (cvError) errs.push(cvError);
    if (errs.length > 0) { setSubmitError(errs[0]!); return; }

    const fd = new FormData();
    if (target) fd.append("slotId", target.slotId);
    fd.append("firstName", form.firstName.trim());
    fd.append("middleName", form.middleName.trim());
    fd.append("lastName", form.lastName.trim());
    fd.append("email", form.email.trim());
    fd.append("phone", form.phone.trim());
    fd.append("city", form.city.trim());
    fd.append("birthDate", form.birthDate);
    fd.append("gender", form.gender === "none" ? "" : form.gender);
    fd.append("educationLevel", form.educationLevel === "none" ? "" : form.educationLevel);
    fd.append("fieldOfStudy", form.fieldOfStudy.trim());
    fd.append("institution", form.institution.trim());
    fd.append("graduationYear", form.graduationYear.trim());
    fd.append("gpa", form.gpa.trim());
    fd.append("expYears", form.expYears.trim());
    fd.append("lastPosition", form.lastPosition.trim());
    fd.append("lastCompany", form.lastCompany.trim());
    fd.append("expectedSalary", form.expectedSalary.trim());
    fd.append("notes", form.notes.trim());
    fd.append("captchaToken", captcha?.token ?? "");
    fd.append("captchaAnswer", captchaAnswer.trim());
    fd.append("consent", "true");
    // HONEYPOT — nilai dibaca dari DOM (bot yang mengisi input tersembunyi terbawa ke sini).
    fd.append("website", honeypotRef.current?.value ?? "");
    if (cvFile) fd.append("cv", cvFile);

    setSubmitting(true);
    setSubmitError(null);
    try {
      const qs = activeSlug ? `?t=${encodeURIComponent(activeSlug)}` : "";
      const r = await fetch(`/api/public/recruitment/apply${qs}`, { method: "POST", body: fd });
      if (r.status === 201) {
        setSubmitted(true); // respons 201 = sukses (maupun spam — identik by design)
        return;
      }
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      const msg = j.error ?? `HTTP ${r.status}`;
      setSubmitError(t(msg, SERVER_ERRORS[msg] ?? msg));
      if (r.status === 400) {
        // challenge bisa basi/kedaluwarsa → segarkan otomatis
        setCaptchaAnswer("");
        void refreshCaptcha();
      }
    } catch {
      setSubmitError(t("Gagal mengirim lamaran. Periksa koneksi internet Anda lalu coba lagi.", "Failed to send the application. Check your internet connection and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- helper tampilan ----
  const fmtRp = (n: number) => `Rp ${new Intl.NumberFormat(locale).format(n)}`;
  const salaryText = (o: PublicOpeningItem) => {
    if (o.salaryMin == null && o.salaryMax == null) return t("Gaji terbuka", "Open salary");
    if (o.salaryMin != null && o.salaryMax != null && o.salaryMin !== o.salaryMax) {
      return `${fmtRp(o.salaryMin)} – ${fmtRp(o.salaryMax)}`;
    }
    return fmtRp(o.salaryMax ?? o.salaryMin ?? 0);
  };
  const salaryUnitText = (o: PublicOpeningItem) => {
    if (o.salaryMin == null && o.salaryMax == null) return "";
    const u = SALARY_UNIT_LABEL[o.salaryUnit];
    return u ? t(u[0], u[1]) : o.salaryUnit ? `/${o.salaryUnit.toLowerCase()}` : "";
  };
  const employmentText = (o: PublicOpeningItem) => {
    const l = o.employmentStatus ? EMPLOYMENT_LABEL[o.employmentStatus] : undefined;
    return l ? t(l[0], l[1]) : (o.employmentStatus ?? "—");
  };
  const closingText = (o: PublicOpeningItem) => {
    if (!o.closingDate) return "—";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(o.closingDate);
    if (!m) return "—";
    const mo = monthShort[Number(m[2]) - 1] ?? "";
    return t("Tutup {d}", "Closes {d}", { d: `${Number(m[3])} ${mo}` });
  };
  const locationText = (o: PublicOpeningItem) =>
    [o.location, o.city].filter(Boolean).join(" · ") || t("Lokasi fleksibel", "Flexible location");

  const consentText = t(
    "Saya setuju data pribadi saya pada formulir ini diproses oleh {c} untuk keperluan proses rekrutmen sesuai UU No. 27/2022 (UU PDP), dan persetujuan ini dapat saya tarik kembali kapan saja. (Kebijakan v2026-01)",
    "I consent to my personal data in this form being processed by {c} for recruitment purposes under Law No. 27/2022 (Indonesian PDP Law), and I may withdraw this consent at any time. (Policy v2026-01)",
    { c: company ?? t("perusahaan", "the company") },
  );

  const year = new Date().getFullYear();
  const currentYearStr = String(year);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="relative flex min-h-screen flex-col bg-[#fbf6ee] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-40 border-b border-orange-900/10 bg-[#fbf6ee]/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {/* lockup PNG resmi (pola auth-gate — rule no-img-element tidak aktif utk komponen non-halaman) */}
            <img src="/brand/rekankerja-lockup.png" alt="RekanKerja — Human Resource Information System" className="h-8 w-auto shrink-0" draggable={false} />
            {company && (
              <>
                <span aria-hidden className="hidden h-6 w-px bg-slate-300 sm:block dark:bg-slate-700" />
                <span className="hidden truncate text-sm font-semibold text-slate-700 sm:block dark:text-slate-200">{company}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LangToggle />
            <Button variant="outline" onClick={onLogin} className="rounded-full border-slate-300 bg-white font-semibold text-slate-700 hover:border-orange-400 hover:bg-orange-50 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-orange-800 dark:hover:bg-orange-950/60 dark:hover:text-orange-300">
              {t("Masuk", "Log in")}
            </Button>
          </div>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <main className="flex-1">
        <section className="relative overflow-hidden">
          {/* glow dekoratif — aksen oranye lembut */}
          <div aria-hidden className="pointer-events-none absolute -top-28 right-[-6rem] h-80 w-80 rounded-full bg-orange-200/50 blur-3xl dark:bg-orange-900/20" />
          <div aria-hidden className="pointer-events-none absolute -top-10 left-[-8rem] h-64 w-64 rounded-full bg-amber-200/40 blur-3xl dark:bg-amber-900/10" />
          <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 pt-14 sm:px-6 sm:pb-16 sm:pt-20">
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }} className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {t("Rekrutmen terbuka", "We're hiring")}
              </span>
              <h1 className="mt-4 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
                {t("Bergabunglah dengan tim kami.", "Join our team.")}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg dark:text-slate-300">
                {company
                  ? t("Ada {n} posisi terbuka di {c}. Temukan peran yang cocok untuk Anda.", "There are {n} open positions at {c}. Find the role that fits you.", { n: String(openings.length), c: company })
                  : t("Ada {n} posisi terbuka. Temukan peran yang cocok untuk Anda.", "There are {n} open positions. Find the role that fits you.", { n: String(openings.length) })}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => openApply(null)}
                  className="rounded-full bg-orange-600 px-5 font-semibold text-white shadow-[0_10px_24px_-10px_rgba(234,88,12,0.55)] hover:bg-orange-700"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  {t("Kirim Lamaran Umum", "Send a General Application")}
                </Button>
                <a
                  href="#openings"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-white/70 px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-orange-400 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-orange-800 dark:hover:text-orange-300"
                >
                  {t("Lihat Lowongan", "View Openings")}
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ================= DAFTAR LOWONGAN ================= */}
        <section id="openings" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pb-16 sm:px-6" aria-labelledby="openings-title">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 id="openings-title" className="text-xl font-bold tracking-tight sm:text-2xl">
              {t("Lowongan Terbuka", "Open Positions")}
              <span className="ml-2 align-middle text-sm font-semibold text-orange-600 dark:text-orange-400">({openings.length})</span>
            </h2>

            {/* tenant picker — hanya bila respons memuat beberapa perusahaan aktif */}
            {(data?.tenants?.length ?? 0) >= 2 && (
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-slate-400" aria-hidden />
                <span className="hidden text-[11px] font-bold uppercase tracking-wide text-slate-500 sm:inline dark:text-slate-400">
                  {t("Perusahaan", "Company")}
                </span>
                <Select value={activeSlug ?? ""} onValueChange={(v) => setSlug(v)}>
                  <SelectTrigger
                    className="w-full min-w-48 bg-white sm:w-64 dark:bg-slate-900"
                    aria-label={t("Pilih perusahaan", "Choose a company")}
                  >
                    <SelectValue placeholder={t("Pilih perusahaan", "Choose a company")} />
                  </SelectTrigger>
                  <SelectContent>
                    {data?.tenants?.map((tn) => (
                      <SelectItem key={tn.slug} value={tn.slug}>{tn.companyName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* memuat — skeleton kartu */}
          {loading && (
            <div role="status" aria-label={t("Memuat lowongan…", "Loading openings…")} className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-56 animate-pulse rounded-2xl border border-slate-200/80 bg-white/70 dark:border-slate-800 dark:bg-slate-900/70" />
              ))}
            </div>
          )}

          {/* gagal memuat */}
          {!loading && loadError && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 px-6 py-12 text-center dark:border-orange-900 dark:bg-orange-950/30">
              <AlertCircle className="h-8 w-8 text-orange-600 dark:text-orange-400" aria-hidden />
              <p className="text-sm font-semibold">{t(loadError, SERVER_ERRORS[loadError] ?? loadError)}</p>
              <Button variant="outline" onClick={() => setReloadTick((n) => n + 1)} className="mt-1">
                {t("Coba lagi", "Try again")}
              </Button>
            </div>
          )}

          {/* kosong */}
          {!loading && !loadError && openings.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <SearchX className="h-10 w-10 text-slate-400" aria-hidden />
              <p className="text-base font-semibold">{t("Belum ada lowongan terbuka", "No open positions yet")}</p>
              <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">
                {t("Coba lagi nanti, atau kirim lamaran umum agar profil Anda tersimpan di talent pool kami.", "Check back later, or send a general application so your profile is kept in our talent pool.")}
              </p>
              <Button onClick={() => openApply(null)} className="mt-2 rounded-full bg-orange-600 font-semibold text-white hover:bg-orange-700">
                <Send className="h-4 w-4" aria-hidden />
                {t("Kirim Lamaran Umum", "Send a General Application")}
              </Button>
            </div>
          )}

          {/* grid kartu lowongan */}
          {!loading && !loadError && openings.length > 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {openings.map((o, i) => (
                <motion.article
                  key={o.slotId}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: Math.min(i * 0.05, 0.4), ease: "easeOut" }}
                  role="button"
                  tabIndex={0}
                  aria-label={t("Lamar untuk posisi {t}", "Apply for the {t} position", { t: o.title })}
                  onClick={() => openApply(o)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openApply(o); } }}
                  className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)] outline-none transition-all duration-200 hover:-translate-y-1 hover:border-orange-300 hover:shadow-[0_18px_40px_-18px_rgba(234,88,12,0.35)] focus-visible:ring-2 focus-visible:ring-orange-500/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-800"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-orange-700/90 dark:text-orange-400">{o.joRefNo}</span>
                      <h3 className="mt-0.5 line-clamp-2 text-base font-semibold leading-snug text-slate-900 dark:text-slate-100" title={o.title}>
                        {o.title}
                      </h3>
                    </div>
                    <Badge className="shrink-0 border-orange-200 bg-orange-100 text-[10px] text-orange-700 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300">
                      {t("Buka", "Open")}
                    </Badge>
                  </div>

                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {locationText(o)}
                  </p>

                  {o.jobDescSummary && (
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{o.jobDescSummary}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <Chip icon={<Wallet className="h-3 w-3" aria-hidden />}>
                      {salaryText(o)}{salaryUnitText(o)}
                    </Chip>
                    <Chip icon={<Briefcase className="h-3 w-3" aria-hidden />}>{employmentText(o)}</Chip>
                    <Chip icon={<CalendarClock className="h-3 w-3" aria-hidden />}>{closingText(o)}</Chip>
                  </div>

                  <div className="mt-auto pt-5">
                    <Button
                      onClick={() => openApply(o)}
                      className="w-full bg-orange-600 font-semibold text-white hover:bg-orange-700"
                    >
                      <Send className="h-4 w-4" aria-hidden />
                      {t("Lamar", "Apply")}
                    </Button>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ================= FOOTER (menempel bawah bila konten pendek) ================= */}
      <footer className="mt-auto border-t border-orange-900/10 bg-white/60 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-slate-400">
          <p>
            © {year} {company ?? "RekanKerja"} — {t("didukung oleh", "powered by")} RekanKerja
          </p>
          <p className="max-w-xl leading-relaxed">
            {t(
              "Data pribadi yang Anda kirim diproses hanya untuk proses rekrutmen dan dilindungi sesuai UU No. 27/2022 tentang Pelindungan Data Pribadi.",
              "Personal data you submit is processed solely for recruitment and is protected under Indonesian Personal Data Protection Law (UU No. 27/2022).",
            )}
          </p>
        </div>
      </footer>

      {/* ================= DIALOG FORM LAMARAN ================= */}
      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {submitted ? (
            /* ---- state sukses ---- */
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950/70">
                <CheckCircle2 className="h-9 w-9 text-orange-600 dark:text-orange-400" aria-hidden />
              </span>
              <h3 className="text-xl font-bold tracking-tight">{t("Lamaran Terkirim!", "Application Sent!")}</h3>
              <p className="max-w-md text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                {company
                  ? t("Terima kasih! Lamaran Anda telah diterima dan akan ditinjau oleh tim HR {c}.", "Thank you! Your application has been received and will be reviewed by the {c} HR team.", { c: company })
                  : t("Terima kasih! Lamaran Anda telah diterima dan akan ditinjau oleh tim HR kami.", "Thank you! Your application has been received and will be reviewed by our HR team.")}
              </p>
              <Button onClick={closeDialog} className="mt-2 rounded-full bg-orange-600 px-6 font-semibold text-white hover:bg-orange-700">
                {t("Tutup", "Close")}
              </Button>
            </div>
          ) : (
            /* ---- form lamaran ---- */
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-baseline gap-x-2 text-lg leading-snug">
                  <span className="line-clamp-2">{target ? target.title : t("Lamaran Umum", "General Application")}</span>
                  {target && <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-orange-700/80 dark:text-orange-400">{target.joRefNo}</span>}
                </DialogTitle>
                <DialogDescription>
                  {target
                    ? t("Lengkapi data berikut untuk melamar posisi ini.", "Fill in the following details to apply for this position.")
                    : t("Tidak memilih lowongan tertentu? Profil Anda akan tersimpan di talent pool kami.", "Not applying for a specific opening? Your profile will be kept in our talent pool.")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={submit} className="space-y-6" noValidate>
                {/* ---- seksi: identitas ---- */}
                <section className="space-y-3" aria-labelledby="ap-ident">
                  <span id="ap-ident"><SectionTitle icon={<UserRound className="h-3.5 w-3.5" aria-hidden />}>{t("Identitas", "Identity")}</SectionTitle></span>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                    <Field label={t("Nama Depan", "First Name")} required htmlFor="ap-first">
                      <Input id="ap-first" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" required disabled={submitting} maxLength={80} />
                    </Field>
                    <Field label={t("Nama Tengah", "Middle Name")} htmlFor="ap-middle">
                      <Input id="ap-middle" value={form.middleName} onChange={(e) => set("middleName", e.target.value)} autoComplete="additional-name" disabled={submitting} maxLength={80} />
                    </Field>
                    <Field label={t("Nama Belakang", "Last Name")} htmlFor="ap-last">
                      <Input id="ap-last" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" disabled={submitting} maxLength={80} />
                    </Field>
                    <Field label={t("Email", "Email")} required htmlFor="ap-email">
                      <Input id="ap-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" required disabled={submitting} maxLength={120} />
                    </Field>
                    <Field label={t("No. Telepon", "Phone Number")} htmlFor="ap-phone">
                      <Input id="ap-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" disabled={submitting} maxLength={32} />
                    </Field>
                    <Field label={t("Kota", "City")} htmlFor="ap-city">
                      <Input id="ap-city" value={form.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" disabled={submitting} maxLength={80} />
                    </Field>
                    <Field label={t("Tanggal Lahir", "Date of Birth")} htmlFor="ap-birth">
                      <Input id="ap-birth" type="date" value={form.birthDate} max={todayIso} onChange={(e) => set("birthDate", e.target.value)} disabled={submitting} />
                    </Field>
                    <Field label={t("Jenis Kelamin", "Gender")} htmlFor="ap-gender">
                      <Select value={form.gender} onValueChange={(v) => set("gender", v)} disabled={submitting}>
                        <SelectTrigger id="ap-gender" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Tidak diisi —", "— Not specified —")}</SelectItem>
                          <SelectItem value="L">{t("Laki-laki", "Male")}</SelectItem>
                          <SelectItem value="P">{t("Perempuan", "Female")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </section>

                {/* ---- seksi: pendidikan & pengalaman ---- */}
                <section className="space-y-3" aria-labelledby="ap-edu">
                  <span id="ap-edu"><SectionTitle icon={<GraduationCap className="h-3.5 w-3.5" aria-hidden />}>{t("Pendidikan & Pengalaman", "Education & Experience")}</SectionTitle></span>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                    <Field label={t("Jenjang Pendidikan", "Education Level")} htmlFor="ap-edu-level">
                      <Select value={form.educationLevel} onValueChange={(v) => set("educationLevel", v)} disabled={submitting}>
                        <SelectTrigger id="ap-edu-level" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("— Tidak diisi —", "— Not specified —")}</SelectItem>
                          {EDUCATION_OPTIONS.map((op) => (
                            <SelectItem key={op.value} value={op.value}>{t(op.label[0], op.label[1])}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label={t("Bidang Studi", "Field of Study")} htmlFor="ap-field">
                      <Input id="ap-field" value={form.fieldOfStudy} onChange={(e) => set("fieldOfStudy", e.target.value)} disabled={submitting} maxLength={80} />
                    </Field>
                    <Field label={t("Institusi", "Institution")} htmlFor="ap-inst">
                      <Input id="ap-inst" value={form.institution} onChange={(e) => set("institution", e.target.value)} disabled={submitting} maxLength={120} />
                    </Field>
                    <Field label={t("Tahun Lulus", "Graduation Year")} htmlFor="ap-grad">
                      <Input id="ap-grad" type="number" inputMode="numeric" min={1900} max={Number(currentYearStr) + 10} value={form.graduationYear} onChange={(e) => set("graduationYear", e.target.value)} disabled={submitting} />
                    </Field>
                    <Field label={t("IPK", "GPA")} htmlFor="ap-gpa" hint={t("Skala 0–4", "Scale 0–4")}>
                      <Input id="ap-gpa" type="number" inputMode="decimal" step="0.01" min={0} max={4} value={form.gpa} onChange={(e) => set("gpa", e.target.value)} disabled={submitting} />
                    </Field>
                    <Field label={t("Pengalaman Kerja (tahun)", "Work Experience (years)")} htmlFor="ap-exp">
                      <Input id="ap-exp" type="number" inputMode="numeric" min={0} step={1} value={form.expYears} onChange={(e) => set("expYears", e.target.value)} disabled={submitting} />
                    </Field>
                    <Field label={t("Posisi Terakhir", "Last Position")} htmlFor="ap-pos">
                      <Input id="ap-pos" value={form.lastPosition} onChange={(e) => set("lastPosition", e.target.value)} disabled={submitting} maxLength={120} />
                    </Field>
                    <Field label={t("Perusahaan Terakhir", "Last Company")} htmlFor="ap-comp">
                      <Input id="ap-comp" value={form.lastCompany} onChange={(e) => set("lastCompany", e.target.value)} disabled={submitting} maxLength={120} />
                    </Field>
                  </div>
                </section>

                {/* ---- seksi: lainnya ---- */}
                <section className="space-y-3" aria-labelledby="ap-misc">
                  <span id="ap-misc"><SectionTitle icon={<FileText className="h-3.5 w-3.5" aria-hidden />}>{t("Lainnya", "Others")}</SectionTitle></span>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
                    <Field
                      label={t("Ekspektasi Gaji", "Expected Salary")}
                      htmlFor="ap-salary"
                      hint={t("Dalam Rupiah per bulan", "In Rupiah per month")}
                    >
                      <Input id="ap-salary" type="number" inputMode="numeric" min={0} step={1000} value={form.expectedSalary} onChange={(e) => set("expectedSalary", e.target.value)} disabled={submitting} />
                    </Field>
                    <div className="sm:col-span-1" />
                    <div className="sm:col-span-2">
                      <Field label={t("Catatan", "Notes")} htmlFor="ap-notes">
                        <Textarea id="ap-notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} disabled={submitting} maxLength={2000}
                          placeholder={t("Ceritakan singkat mengapa Anda cocok untuk peran ini…", "Briefly tell us why you're a good fit for this role…")} />
                      </Field>
                    </div>
                    <div className="sm:col-span-2">
                      <Field
                        label={t("CV / Resume (opsional)", "CV / Resume (optional)")}
                        htmlFor="ap-cv"
                        hint={t("JPG, PNG, WEBP, atau PDF — maksimal 5 MB.", "JPG, PNG, WEBP, or PDF — max 5 MB.")}
                      >
                        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 transition-colors focus-within:border-orange-400 dark:border-slate-700 dark:bg-slate-900">
                          <Upload className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                          <input
                            id="ap-cv"
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,.pdf"
                            onChange={onCvChange}
                            disabled={submitting}
                            className="w-full cursor-pointer text-xs text-slate-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-orange-600 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-white hover:file:bg-orange-700 dark:text-slate-400"
                          />
                        </div>
                      </Field>
                      {cvFile && (
                        <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          {cvFile.name} · {(cvFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      )}
                      {cvError && (
                        <p role="alert" className="mt-1 text-[11px] font-medium text-destructive">{cvError}</p>
                      )}
                    </div>
                  </div>
                </section>

                {/* ---- seksi: keamanan & persetujuan ---- */}
                <section className="space-y-3" aria-labelledby="ap-sec">
                  <span id="ap-sec"><SectionTitle icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden />}>{t("Keamanan & Persetujuan", "Security & Consent")}</SectionTitle></span>

                  {/* captcha matematika */}
                  <div className="space-y-1.5">
                    <Label htmlFor="ap-captcha" className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {t("Verifikasi Keamanan", "Security Verification")}
                      <span className="ml-0.5 text-orange-600 dark:text-orange-400" aria-hidden>*</span>
                    </Label>
                    <div className="flex items-stretch gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-orange-200 bg-orange-50/70 px-3.5 py-2.5 dark:border-orange-900 dark:bg-orange-950/40">
                        {captchaBusy ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-600" aria-hidden />
                        ) : (
                          <ShieldCheck className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden />
                        )}
                        <span className="truncate font-mono text-sm font-bold tracking-wider text-orange-900 dark:text-orange-200" aria-live="polite">
                          {captcha?.question ?? "…"}
                        </span>
                      </div>
                      <Input
                        id="ap-captcha"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={captchaAnswer}
                        onChange={(e) => setCaptchaAnswer(e.target.value.replace(/[^\d]/g, ""))}
                        disabled={submitting}
                        required
                        aria-describedby="ap-captcha-hint"
                        className="w-24 shrink-0 text-center font-mono font-bold"
                        placeholder="?"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => void refreshCaptcha()}
                        disabled={captchaBusy || submitting}
                        title={t("Segarkan soal", "Refresh question")}
                        aria-label={t("Segarkan soal captcha", "Refresh the captcha question")}
                        className="shrink-0"
                      >
                        <RefreshCw className={cn("h-4 w-4", captchaBusy && "animate-spin")} aria-hidden />
                      </Button>
                    </div>
                    <p id="ap-captcha-hint" className="text-[11px] leading-snug text-slate-400">
                      {t("Jawab pertanyaan di atas (angka). Tantangan berlaku 10 menit — segarkan bila kedaluwarsa.", "Answer the question above (a number). The challenge is valid for 10 minutes — refresh it if expired.")}
                    </p>
                    {captchaErr && (
                      <p role="alert" className="text-[11px] font-medium text-destructive">
                        {t(captchaErr, SERVER_ERRORS[captchaErr] ?? captchaErr)}
                      </p>
                    )}
                  </div>

                  {/* consent UU PDP */}
                  <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                    <Checkbox
                      id="ap-consent"
                      checked={consent}
                      onCheckedChange={(c) => setConsent(c === true)}
                      disabled={submitting}
                      className="mt-0.5"
                      aria-required={true}
                    />
                    <Label htmlFor="ap-consent" className="cursor-pointer text-[12px] font-normal leading-relaxed text-slate-600 dark:text-slate-300">
                      {consentText}
                    </Label>
                  </div>

                  {/* HONEYPOT — tersembunyi dari manusia; bot yang mengisinya ditandai Spam server */}
                  <input
                    ref={honeypotRef}
                    name="website"
                    type="text"
                    className="hidden"
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                  />
                </section>

                {/* pesan error di atas tombol */}
                {submitError && (
                  <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive dark:bg-destructive/20">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {submitError}
                  </p>
                )}

                <DialogFooter className="gap-2 sm:justify-end">
                  <Button type="button" variant="outline" onClick={closeDialog} disabled={submitting}>
                    {t("Batal", "Cancel")}
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-orange-600 font-semibold text-white hover:bg-orange-700">
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        {t("Mengirim…", "Sending…")}
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4" aria-hidden />
                        {t("Kirim Lamaran", "Submit Application")}
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
