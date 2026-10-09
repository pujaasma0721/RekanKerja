"use client";
// RekanKerja AuthScreen — gerbang SaaS multi-tenant.
// Desain: "Ivory Editorial" (quiet luxury) — opsi B yang dipilih user dari
// Auth Design Lab (?mockup=auth). Latar ivory hangat + noise film + bingkai
// hairline; panel kiri serif display besar + testimoni + marquee klien;
// kartu kanan putih: eyebrow amber, judul serif italic, field underline,
// tab garis amber, CTA tinta hitam. Logika: useSession (login/registrasi +
// provisioning tenant + T17-MFA langkah OTP 6 digit), validasi inline,
// i18n ID/EN, a11y.
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { MotionConfig, motion } from "framer-motion";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { LanguageSwitcher } from "@/rekankerja/shared/components/shell/language-switcher";
import { NoiseOverlay, EditorialLogo, MarqueeStrip, EditorialError } from "./editorial";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// pesan validasi (fungsi modul-level) diterjemahkan di call site
const VALIDATION_EN: Record<string, string> = {
  "Email wajib diisi.": "Email is required.",
  "Format email tidak valid.": "Invalid email format.",
  "Kata sandi wajib diisi.": "Password is required.",
  "Nama workspace wajib diisi.": "Workspace name is required.",
  "Kode perusahaan wajib diisi.": "Company code is required.",
  "Kode perusahaan minimal 2 karakter (huruf/angka).": "Company code must be at least 2 characters (letters/numbers).",
  "Nama lengkap wajib diisi.": "Full name is required.",
  "Kata sandi minimal 8 karakter.": "Password must be at least 8 characters.",
};

type AuthTab = "login" | "register";
type FieldId =
  | "login-email"
  | "login-password"
  | "reg-workspace"
  | "reg-companycode"
  | "reg-name"
  | "reg-email"
  | "reg-password";

interface Validity {
  message: string | null;
  fields: FieldId[];
}

function validateLogin(email: string, password: string): Validity {
  if (!email) return { message: "Email wajib diisi.", fields: ["login-email"] };
  if (!EMAIL_RE.test(email)) return { message: "Format email tidak valid.", fields: ["login-email"] };
  if (!password) return { message: "Kata sandi wajib diisi.", fields: ["login-password"] };
  return { message: null, fields: [] };
}

/** Sanitasi kode perusahaan → huruf besar A-Z0-9 (mirror aturan server). */
const sanitizeCode = (raw: string) => raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function validateRegister(workspaceName: string, companyCode: string, fullName: string, email: string, password: string): Validity {
  if (!workspaceName) return { message: "Nama workspace wajib diisi.", fields: ["reg-workspace"] };
  if (!companyCode) return { message: "Kode perusahaan wajib diisi.", fields: ["reg-companycode"] };
  if (companyCode.length < 2) return { message: "Kode perusahaan minimal 2 karakter (huruf/angka).", fields: ["reg-companycode"] };
  if (!fullName) return { message: "Nama lengkap wajib diisi.", fields: ["reg-name"] };
  if (!email) return { message: "Email wajib diisi.", fields: ["reg-email"] };
  if (!EMAIL_RE.test(email)) return { message: "Format email tidak valid.", fields: ["reg-email"] };
  if (password.length < 8) return { message: "Kata sandi minimal 8 karakter.", fields: ["reg-password"] };
  return { message: null, fields: [] };
}

// ============ field pill (SayOne-Learning) ============
interface UnderlineFieldProps {
  id: FieldId;
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Gaya monospace + huruf besar (utk kode perusahaan). */
  mono?: boolean;
  maxLength?: number;
  hint?: string;
}

function UnderlineField({
  id, label, type = "text", placeholder, value, onChange, autoComplete, autoFocus, disabled, invalid, describedBy, mono, maxLength, hint,
}: UnderlineFieldProps) {
  return (
    <div className="group space-y-1.5">
      <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">
        {label}
      </label>
      <div
        className={cn(
          "flex items-center rounded-2xl border bg-surface px-4 transition-colors duration-200",
          invalid
            ? "border-destructive/60"
            : "border-input focus-within:border-primary/60 hover:border-primary/40 dark:focus-within:border-primary/60",
        )}
      >
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          maxLength={maxLength}
          onChange={onChange}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 w-full bg-transparent text-[15px] text-foreground caret-primary outline-none placeholder:text-muted-foreground/60 disabled:opacity-60",
            mono && "font-mono text-[14px] uppercase tracking-[0.14em]",
          )}
        />
      </div>
      {hint && <p className="text-[11.5px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

// ============ slot OTP (SayOne-Learning) — T17-MFA ============
// InputOTPSlot gaya kartu pill lembut senada field lain (pola: 3 digit · 3 digit).
const OTP_SLOT_CLS =
  "h-12 w-10 rounded-xl border border-input bg-surface text-[18px] text-foreground shadow-none data-[active=true]:border-primary data-[active=true]:ring-0 dark:data-[active=true]:border-primary";

// ============ CTA biru (SayOne-Learning) ============
function InkButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: React.ReactNode }) {
  return (
    <motion.button
      type="submit"
      disabled={busy}
      whileHover={{ y: -1.5 }}
      whileTap={{ y: 0 }}
      className="group flex h-[52px] w-full items-center justify-center gap-2.5 rounded-full bg-primary text-[13px] font-bold uppercase tracking-[0.16em] text-primary-foreground shadow-[0_18px_40px_-16px_rgba(37,99,235,0.55)] transition-colors hover:bg-[#1d4ed8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-70 dark:bg-primary dark:hover:bg-[#2563eb]"
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {busyLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
        </>
      )}
    </motion.button>
  );
}

export function AuthScreen() {
  const { t } = useI18n();
  const { busy, error, expired, expiredReason, login, register, verifyMfa, clearError } = useSession();

  const [tab, setTab] = useState<AuthTab>("login");
  const [formError, setFormError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<FieldId[]>([]);

  // ---- Task 78: konteks subdomain — alamat <slug>.<base> yang sudah punya
  // workspace tidak bisa dipakai mendaftar ulang → tab daftar disembunyikan
  // dan pendaftar diarahkan ke tab masuk. Task 78d: alamat = kode perusahaan —
  // daftar via subdomain → kode otomatis dari alamat (terkunci).
  const [hostInfo, setHostInfo] = useState<{ isTenantHost: boolean; exists: boolean; slug: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/host-workspace");
        if (!res.ok) return;
        const d = (await res.json()) as { isTenantHost: boolean; exists: boolean; slug: string | null };
        if (alive) setHostInfo(d);
      } catch {
        // host utama / gagal cek → perilaku lama (tab daftar tampil)
      }
    })();
    return () => { alive = false; };
  }, []);
  const hostRegister = hostInfo?.isTenantHost === true && hostInfo.exists === false;
  const baseDomain = typeof window !== "undefined"
    ? (window.location.hostname.split(".").length >= 3
        ? window.location.hostname.split(".").slice(1).join(".")
        : window.location.hostname)
    : "";

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  // Task 78d — daftar via subdomain: kode TAMPILAN diturunkan dari alamat
  // (tanpa setState di effect). Server mengikat kode dari host saat submit.
  const companyCodeValue = hostRegister && hostInfo?.slug ? hostInfo.slug.toUpperCase() : companyCode;
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  // ---- T17-MFA: langkah OTP (kode 6 digit) setelah password benar ----
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);

  // Task 64k — sesi berakhir (kedaluwarsa/idle) → pesan di atas error form.
  const sessionEndedMsg = expired
    ? expiredReason === "idle"
      ? t("Sesi berakhir karena tidak ada aktivitas — silakan masuk kembali.", "Your session ended due to inactivity — please sign in again.")
      : t("Sesi Anda telah berakhir — silakan masuk kembali.", "Your session has expired — please sign in again.")
    : null;
  const shownError = formError ?? error ?? sessionEndedMsg;
  const otpShownError = otpError ?? error;

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setFormError(null);
    setInvalidFields([]);
    setMfaStep(false);
    setMfaToken("");
    setOtp("");
    setOtpError(null);
    if (error) clearError();
  };

  const update = (fieldId: FieldId, setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    if (formError) setFormError(null);
    if (invalidFields.length) setInvalidFields((prev) => prev.filter((f) => f !== fieldId));
  };

  const isInvalid = (fieldId: FieldId) => (invalidFields.includes(fieldId) ? true : undefined);
  const describedBy = (fieldId: FieldId, errorId: string) => (invalidFields.includes(fieldId) ? errorId : undefined);

  const submitLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const email = loginEmail.trim();
    const v = validateLogin(email, loginPassword);
    setFormError(v.message ? t(v.message, VALIDATION_EN[v.message]) : null);
    setInvalidFields(v.fields);
    if (v.message) return;
    const r = await login(email, loginPassword);
    if (r.mfaRequired && r.mfaToken) {
      // password benar, akun ber-MFA → tampilkan langkah kode 6 digit
      setMfaStep(true);
      setMfaToken(r.mfaToken);
      setOtp("");
      setOtpError(null);
      if (error) clearError();
    }
  };

  // ---- T17-MFA: kirim kode 6 digit (auto-submit saat lengkap) ----
  const submitOtp = async (code: string) => {
    if (busy || !mfaToken) return;
    if (!/^\d{6}$/.test(code)) {
      setOtpError(t("Kode verifikasi harus 6 digit angka.", "The verification code must be 6 digits."));
      return;
    }
    const ok = await verifyMfa(mfaToken, code);
    if (!ok) setOtp(""); // gagal → bersihkan utk coba lagi (error dari store)
  };

  const backToPassword = () => {
    setMfaStep(false);
    setMfaToken("");
    setOtp("");
    setOtpError(null);
    if (error) clearError();
  };

  const submitRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    // Task 78d: kode ikut alamat saat daftar via subdomain (hostRegister).
    const code = sanitizeCode(companyCodeValue);
    const v = validateRegister(workspaceName.trim(), code, fullName.trim(), regEmail.trim(), regPassword);
    setFormError(v.message ? t(v.message, VALIDATION_EN[v.message]) : null);
    setInvalidFields(v.fields);
    if (v.message) return;
    await register({
      workspaceName: workspaceName.trim(),
      companyCode: code,
      fullName: fullName.trim(),
      email: regEmail.trim(),
      password: regPassword,
    });
  };

  // marquee: modul-modul aplikasi (bukan nama klien)
  const marqueeItems = [
    t("Human Resource Base", "Human Resource Base"),
    t("Payroll", "Payroll"),
    t("Time & Attendance", "Time & Attendance"),
    t("Cuti", "Leave"),
    t("Perjalanan Dinas", "Travel"),
    t("Medis", "Medical"),
    t("Whistleblowing · TPKS", "Whistleblowing · TPKS"),
  ];

  const langPillCls =
    "rounded-full border border-slate-300 bg-white/80 text-slate-600 shadow-none backdrop-blur hover:border-slate-400 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-slate-100";

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
        <NoiseOverlay opacity={0.035} />

        <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[1.12fr_1fr]">
          {/* ============ Panel kiri — hero gradient biru (SayOne-Learning, desktop) ============ */}
          {/* min-w-0: nolkan minimum konten (marquee w-max) agar track fr berukuran benar */}
          <div className="relative z-10 hidden h-full min-w-0 flex-col justify-between bg-gradient-to-br from-[#1e3a8a] via-[#1e40af] to-[#2563eb] p-12 text-white lg:flex xl:p-20">
            <EditorialLogo variant="hero" />

            <div className="max-w-xl">
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="text-[10px] font-bold uppercase tracking-[0.32em] text-blue-100"
              >
                {t("Satu platform · multi perusahaan", "One platform · many companies")}
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }}
                className="mt-4 text-[42px] font-bold leading-[1.07] tracking-tight text-white xl:text-[52px]"
              >
                {t("Bagian rumit dari HR,", "The messy part of HR,")}
                <br />
                <span className="italic text-blue-200">{t("biar kami yang pikirkan.", "we've already figured out.")}</span>
              </motion.h1>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="mt-8 max-w-md"
              >
                <div className="flex items-center gap-1.5" aria-hidden>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="text-[13px] text-blue-300">
                      ★
                    </span>
                  ))}
                </div>
                <p className="sr-only">{t("Rating 5 dari 5", "Rated 5 of 5")}</p>
                <blockquote className="mt-3 text-[17px] italic leading-relaxed text-white/80">
                  {t(
                    "“Rekrut, absensi, cuti, sampai gaji terenkripsi — ternyata cukup satu tempat. Tinggalnya? Coba sendiri.”",
                    "“Hiring, attendance, leave, even encrypted payroll — it all fits in one place. The rest? See for yourself.”",
                  )}
                </blockquote>
              </motion.div>
            </div>

            <div className="relative">
              <div className="mb-3 hidden items-center gap-6 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-200/70 lg:flex">
                <span>{t("86 tabel siap", "86 tables ready")}</span>
                <span aria-hidden className="h-1 w-1 rotate-45 bg-blue-300/60" />
                <span>{t("Ter-isolasi per tenant", "Isolated per tenant")}</span>
                <span aria-hidden className="h-1 w-1 rotate-45 bg-blue-300/60" />
                <span>PPh21 · BPJS · SPT 1721-A1</span>
              </div>
              <div aria-hidden className="border-t border-white/20" />
              <MarqueeStrip items={marqueeItems} />
            </div>
          </div>

          {/* ============ Panel kanan — kartu masuk / buat workspace ============ */}
          <div className="relative flex min-h-screen min-w-0 flex-col bg-white/40 lg:bg-transparent dark:bg-slate-900/40 lg:dark:bg-transparent">
            {/* pembatas vertikal hairline */}
            <div aria-hidden className="absolute inset-y-0 left-0 hidden w-px bg-slate-300/80 lg:block dark:bg-slate-700/60" />

            {/* header mobile: logo + bahasa */}
            <div className="relative z-10 flex items-center justify-between px-5 pt-6 lg:hidden">
              <EditorialLogo compact />
              <LanguageSwitcher className={langPillCls} />
            </div>

            {/* saklar bahasa — desktop */}
            <div className="absolute right-10 top-10 z-20 hidden lg:block">
              <LanguageSwitcher className={langPillCls} />
            </div>

            <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-8 sm:px-8 lg:py-12">
              {/* tagline — mobile (panel kiri tersembunyi) */}
              <p className="mb-5 max-w-[300px] text-center text-[20px] italic leading-snug text-slate-700 lg:hidden dark:text-slate-300">
                {t("Bagian rumit dari HR,", "The messy part of HR,")}{" "}
                <span className="text-brand-deep dark:text-brand">{t("biar kami yang pikirkan.", "we've already figured out.")}</span>
              </p>

              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="relative w-full max-w-md overflow-hidden rounded-3xl border border-slate-200/90 bg-card p-8 shadow-[0_40px_80px_-40px_rgba(37,99,235,0.18)] sm:p-10 dark:border-white/10"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand-deep dark:text-brand">
                  {tab === "register"
                    ? t("Registrasi", "Registration")
                    : mfaStep
                      ? t("Verifikasi Dua Langkah", "Two-Step Verification")
                      : t("Masuk ke akun", "Sign in to your account")}
                </p>
                <h2 className="mt-2.5 text-[27px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
                  {tab === "register"
                    ? t("Mulai perjalanan.", "Begin your journey.")
                    : mfaStep
                      ? t("Kode autentikator.", "Authenticator code.")
                      : t("Selamat datang.", "Welcome.")}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {tab === "register"
                    ? t("Database terisolasi siap dalam ± 2 menit.", "Isolated database ready in ± 2 minutes.")
                    : mfaStep
                      ? t(
                          "Masukkan kode 6 digit dari aplikasi autentikator Anda untuk melanjutkan.",
                          "Enter the 6-digit code from your authenticator app to continue.",
                        )
                      : t("Masuk untuk melanjutkan ke workspace Anda.", "Sign in to continue to your workspace.")}
                </p>

                {/* tab garis bawah editorial (disembunyikan saat langkah OTP) */}
                {!mfaStep && (
                <div className="mt-6 flex items-center gap-5 border-b border-slate-200 pb-5 dark:border-slate-800">
                  {(["login", "register"] as const)
                    .filter((k) => k !== "register" || hostInfo?.exists !== true) // Task 78: alamat sudah terpakai → tanpa tab daftar
                    .map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => switchTab(k)}
                      className="group relative rounded-sm pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      <span
                        className={cn(
                          "text-[12px] font-bold uppercase tracking-[0.2em] transition-colors",
                          tab === k
                            ? "text-slate-900 dark:text-slate-100"
                            : "text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300",
                        )}
                      >
                        {k === "login" ? t("Masuk", "Log in") : t("Buat Workspace", "Create Workspace")}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-x-0 -bottom-[21px] h-[2px] transition-all",
                          tab === k
                            ? "bg-brand dark:bg-brand"
                            : "bg-transparent group-hover:bg-slate-300 dark:group-hover:bg-slate-600",
                        )}
                      />
                    </button>
                  ))}
                </div>
                )}

                {/* ============ Langkah OTP (T17-MFA) ============ */}
                {tab === "login" && mfaStep && (
                  <form
                    className="mt-7 space-y-6"
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitOtp(otp);
                    }}
                  >
                    <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {t(
                        "Kode berlaku 30 detik dan berganti otomatis. Akun: {email}.",
                        "The code is valid for 30 seconds and rotates automatically. Account: {email}.",
                        { email: loginEmail || "—" },
                      )}
                    </p>
                    <div className="pt-1">
                      <InputOTP
                        maxLength={6}
                        value={otp}
                        onChange={(v) => {
                          setOtp(v);
                          if (otpError) setOtpError(null);
                          if (error) clearError();
                        }}
                        onComplete={(v) => {
                          void submitOtp(v);
                        }}
                        disabled={busy}
                        autoFocus
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        pattern="^\d+$"
                        aria-label={t("Kode verifikasi 6 digit", "6-digit verification code")}
                        aria-invalid={otpShownError ? true : undefined}
                        aria-describedby={otpShownError ? "otp-error" : undefined}
                        containerClassName="justify-center"
                      >
                        <InputOTPGroup className="gap-2.5">
                          {[0, 1, 2].map((i) => (
                            <InputOTPSlot key={i} index={i} className={OTP_SLOT_CLS} />
                          ))}
                        </InputOTPGroup>
                        <span aria-hidden className="h-px w-4 bg-slate-300 dark:bg-slate-600" />
                        <InputOTPGroup className="gap-2.5">
                          {[3, 4, 5].map((i) => (
                            <InputOTPSlot key={i} index={i} className={OTP_SLOT_CLS} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>

                    {otpShownError && <EditorialError id="otp-error" message={otpShownError} />}

                    <InkButton busy={busy} busyLabel={t("Memeriksa…", "Verifying…")}>
                      {t("Verifikasi & Masuk", "Verify & Sign In")}
                    </InkButton>

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-deep dark:text-brand" aria-hidden />
                        {t("Autentikasi dua faktor aktif di akun ini", "Two-factor authentication is active on this account")}
                      </span>
                      <button
                        type="button"
                        onClick={backToPassword}
                        className="text-[11px] font-bold text-brand-deep hover:underline dark:text-brand/85"
                      >
                        ← {t("Kembali ke kata sandi", "Back to password")}
                      </button>
                    </div>
                  </form>
                )}

                {/* ============ Tab Masuk ============ */}
                {tab === "login" && !mfaStep && (
                  <form className="mt-7 space-y-6" noValidate onSubmit={submitLogin}>
                    <UnderlineField
                      id="login-email"
                      label={t("Email")}
                      type="email"
                      autoComplete="email"
                      autoFocus
                      placeholder={t("nama@perusahaan.id", "name@company.com")}
                      value={loginEmail}
                      onChange={update("login-email", setLoginEmail)}
                      disabled={busy}
                      invalid={isInvalid("login-email")}
                      describedBy={describedBy("login-email", "login-error")}
                    />
                    <UnderlineField
                      id="login-password"
                      label={t("Kata Sandi", "Password")}
                      type="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={update("login-password", setLoginPassword)}
                      disabled={busy}
                      invalid={isInvalid("login-password")}
                      describedBy={describedBy("login-password", "login-error")}
                    />

                    {shownError && <EditorialError id="login-error" message={shownError} />}

                    <InkButton busy={busy} busyLabel={t("Memeriksa…", "Verifying…")}>
                      {t("Masuk ke Workspace", "Sign in to Workspace")}
                    </InkButton>

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-deep dark:text-brand" aria-hidden />
                        {t("Koneksi terenkripsi · data terisolasi per tenant", "Encrypted · data isolated per tenant")}
                      </span>
                      <button
                        type="button"
                        onClick={() => switchTab("register")}
                        className="text-[11px] font-bold text-brand-deep hover:underline dark:text-brand/85"
                      >
                        {t("Belum punya akun?", "No account yet?")}
                      </button>
                    </div>
                  </form>
                )}

                {/* ============ Tab Buat Workspace ============ */}
                {tab === "register" && hostInfo?.exists !== true && (
                  <form className="mt-7 space-y-6" noValidate onSubmit={submitRegister}>
                    <UnderlineField
                      id="reg-workspace"
                      label={t("Nama Workspace", "Workspace Name")}
                      autoComplete="organization"
                      placeholder={t("PT Nusantara Sejahtera", "Acme Corporation")}
                      value={workspaceName}
                      onChange={update("reg-workspace", setWorkspaceName)}
                      disabled={busy}
                      invalid={isInvalid("reg-workspace")}
                      describedBy={describedBy("reg-workspace", "register-error")}
                    />
                    <UnderlineField
                      id="reg-companycode"
                      label={t("Kode Perusahaan", "Company Code")}
                      placeholder="MII"
                      maxLength={12}
                      mono
                      hint={t(
                        "2–12 huruf besar/angka — menjadi kode perusahaan, prefix nomor karyawan (mis. MII00001), DAN alamat workspace Anda.",
                        "2–12 uppercase letters/numbers — becomes your company code, employee number prefix (e.g. MII00001), AND your workspace address.",
                      )}
                      value={companyCodeValue}
                      onChange={update("reg-companycode", setCompanyCode)}
                      disabled={busy || hostRegister}
                      invalid={isInvalid("reg-companycode")}
                      describedBy={describedBy("reg-companycode", "register-error")}
                    />
                    {hostRegister ? (
                      <p className="-mt-3 text-[11px] text-slate-400 dark:text-slate-500">
                        {t(
                          `Kode perusahaan otomatis mengikuti alamat: ${hostInfo?.slug?.toUpperCase() ?? ""}`,
                          `Company code follows your address: ${hostInfo?.slug?.toUpperCase() ?? ""}`,
                        )}
                      </p>
                    ) : (
                      <p className="-mt-3 text-[11px] text-slate-400 dark:text-slate-500">
                        {t("Alamat workspace:", "Workspace address:")}{" "}
                        <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                          {(companyCode || "kode").toLowerCase()}.{baseDomain || "domain"}
                        </span>
                      </p>
                    )}
                    <UnderlineField
                      id="reg-name"
                      label={t("Nama Lengkap", "Full Name")}
                      autoComplete="name"
                      placeholder={t("Budi Santoso", "John Smith")}
                      value={fullName}
                      onChange={update("reg-name", setFullName)}
                      disabled={busy}
                      invalid={isInvalid("reg-name")}
                      describedBy={describedBy("reg-name", "register-error")}
                    />
                    <UnderlineField
                      id="reg-email"
                      label={t("Email")}
                      type="email"
                      autoComplete="email"
                      placeholder={t("nama@perusahaan.id", "name@company.com")}
                      value={regEmail}
                      onChange={update("reg-email", setRegEmail)}
                      disabled={busy}
                      invalid={isInvalid("reg-email")}
                      describedBy={describedBy("reg-email", "register-error")}
                    />
                    <div>
                      <UnderlineField
                        id="reg-password"
                        label={t("Kata Sandi", "Password")}
                        type="password"
                        autoComplete="new-password"
                        placeholder="••••••••"
                        value={regPassword}
                        onChange={update("reg-password", setRegPassword)}
                        disabled={busy}
                        invalid={isInvalid("reg-password")}
                        describedBy={describedBy("reg-password", "register-error")}
                      />
                      <p className="mt-2 text-[11.5px] text-slate-400 dark:text-slate-500">
                        {t(
                          "Minimal 8 karakter — kombinasi huruf besar/kecil, angka & simbol.",
                          "8+ characters — mixed case, numbers & symbols.",
                        )}
                      </p>
                    </div>

                    {shownError && <EditorialError id="register-error" message={shownError} />}

                    <InkButton busy={busy} busyLabel={t("Menyiapkan…", "Provisioning…")}>
                      {t("Buat Workspace", "Create Workspace")}
                    </InkButton>
                    {busy && (
                      <p className="text-center text-[12px] text-slate-400 dark:text-slate-500">
                        {t(
                          "Provisioning database tenant ± beberapa detik.",
                          "Provisioning the tenant database takes a few seconds.",
                        )}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-deep dark:text-brand" aria-hidden />
                        {t("Koneksi terenkripsi · data terisolasi per tenant", "Encrypted · data isolated per tenant")}
                      </span>
                      <button
                        type="button"
                        onClick={() => switchTab("login")}
                        className="text-[11px] font-bold text-brand-deep hover:underline dark:text-brand/85"
                      >
                        {t("Sudah punya akun?", "Already registered?")}
                      </button>
                    </div>
                  </form>
                )}
              </motion.div>
            </div>

            {/* marquee klien — mobile (desktop memakai panel kiri) */}
            <div className="relative z-10 lg:hidden">
              <div aria-hidden className="border-t border-slate-200 dark:border-slate-800" />
              <MarqueeStrip items={marqueeItems} />
            </div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
