"use client";
// OneVity AuthScreen — gerbang SaaS multi-tenant.
// Desain: "Ivory Editorial" (quiet luxury) — opsi B yang dipilih user dari
// Auth Design Lab (?mockup=auth). Latar ivory hangat + noise film + bingkai
// hairline; panel kiri serif display besar + testimoni + marquee klien;
// kartu kanan putih: eyebrow amber, judul serif italic, field underline,
// tab garis amber, CTA tinta hitam. Logika: useSession (login/registrasi +
// provisioning tenant + T17-MFA langkah OTP 6 digit), validasi inline,
// i18n ID/EN, a11y.
import { useState, type ChangeEvent, type FormEvent } from "react";
import { MotionConfig, motion } from "framer-motion";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useSession } from "@/onevity/shared/lib/session-store";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { LanguageSwitcher } from "@/onevity/shared/components/shell/language-switcher";
import { NoiseOverlay, HairlineFrame, EditorialLogo, MarqueeStrip, EditorialError } from "./editorial";
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

// ============ field underline editorial ============
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
      <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.26em] text-stone-500 dark:text-stone-400">
        {label}
      </label>
      <div
        className={cn(
          "border-b pb-2 pt-1 transition-colors duration-300",
          invalid
            ? "border-rose-400"
            : "border-stone-300 focus-within:border-amber-600 hover:border-stone-400 dark:border-stone-700 dark:focus-within:border-amber-500 dark:hover:border-stone-600",
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
            "h-9 w-full bg-transparent text-[15px] text-stone-800 caret-amber-700 outline-none placeholder:font-serif placeholder:italic placeholder:text-stone-300 disabled:opacity-60 dark:text-stone-200 dark:caret-amber-500 dark:placeholder:text-stone-600",
            mono && "font-mono text-[14px] uppercase tracking-[0.14em]",
          )}
        />
      </div>
      {hint && <p className="font-serif text-[11.5px] italic text-stone-400 dark:text-stone-500">{hint}</p>}
    </div>
  );
}

// ============ slot OTP editorial (underline) — T17-MFA ============
// InputOTPSlot default kotak shadcn ditimpa jadi garis-bawah serif senada
// field lain di kartu masuk (pola: 3 digit · 3 digit).
const OTP_SLOT_CLS =
  "h-12 w-10 rounded-none border-0 border-b border-stone-300 bg-transparent font-serif text-[18px] text-stone-800 shadow-none first:rounded-none first:border-l-0 last:rounded-none data-[active=true]:border-amber-600 data-[active=true]:ring-0 dark:border-stone-600 dark:bg-transparent dark:text-stone-200 dark:data-[active=true]:border-amber-500";

// ============ CTA tinta ============
function InkButton({ busy, busyLabel, children }: { busy: boolean; busyLabel: string; children: React.ReactNode }) {
  return (
    <motion.button
      type="submit"
      disabled={busy}
      whileHover={{ y: -1.5 }}
      whileTap={{ y: 0 }}
      className="group flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-stone-900 text-[13px] font-bold uppercase tracking-[0.16em] text-stone-50 shadow-[0_18px_40px_-16px_rgba(28,25,23,0.6)] transition-colors hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf8f3] disabled:pointer-events-none disabled:opacity-70 dark:bg-stone-100 dark:text-stone-900 dark:shadow-none dark:hover:bg-white dark:focus-visible:ring-offset-stone-950"
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
  const { busy, error, login, register, verifyMfa, clearError } = useSession();

  const [tab, setTab] = useState<AuthTab>("login");
  const [formError, setFormError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<FieldId[]>([]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  // ---- T17-MFA: langkah OTP (kode 6 digit) setelah password benar ----
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);

  const shownError = formError ?? error;
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
    const code = sanitizeCode(companyCode);
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

  const marqueeItems = [
    "PT Mitra Industri Internasional",
    "Cahaya Digital Nusantara",
    "Sentra Logistik Prima",
    t("Payroll PPh21 · BPJS", "Payroll PPh21 · BPJS"),
    t("Presensi · Cuti · Travel · Medis", "Attendance · Leave · Travel · Medical"),
  ];

  const langPillCls =
    "rounded-full border border-stone-300 bg-white/80 text-stone-600 shadow-none backdrop-blur hover:border-stone-400 hover:bg-white hover:text-stone-900 dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-stone-100";

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-hidden bg-[#faf8f3] text-stone-800 dark:bg-stone-950 dark:text-stone-300">
        <NoiseOverlay opacity={0.035} />
        <HairlineFrame />

        <div className="relative z-10 grid min-h-screen grid-cols-1 lg:grid-cols-[1.12fr_1fr]">
          {/* ============ Panel kiri — editorial (desktop) ============ */}
          {/* min-w-0: nolkan minimum konten (marquee w-max) agar track fr berukuran benar */}
          <div className="relative z-10 hidden h-full min-w-0 flex-col justify-between p-12 lg:flex xl:p-20">
            <EditorialLogo />

            <div className="max-w-xl">
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.5 }}
                className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber-700 dark:text-amber-500"
              >
                {t("Satu platform · multi perusahaan", "One platform · many companies")}
              </motion.p>
              <motion.h1
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }}
                className="mt-4 font-serif text-[46px] leading-[1.07] tracking-tight text-stone-900 xl:text-[56px] dark:text-stone-100"
              >
                {t("HR yang tertata,", "HR in order,")}
                <br />
                <span className="italic text-amber-700 dark:text-amber-500">{t("bisnis yang tenang.", "business at ease.")}</span>
              </motion.h1>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="mt-8 max-w-md"
              >
                <div className="flex items-center gap-1.5" aria-hidden>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="text-[13px] text-amber-600 dark:text-amber-500">
                      ★
                    </span>
                  ))}
                </div>
                <p className="sr-only">{t("Rating 5 dari 5", "Rated 5 of 5")}</p>
                <blockquote className="mt-3 font-serif text-[17px] italic leading-relaxed text-stone-700 dark:text-stone-300">
                  {t(
                    "“Payroll PPh21 kami dari tiga hari menjadi dua jam — dan tiap perusahaan datanya benar-benar terpisah.”",
                    "“Our PPh21 payroll went from three days to two hours — and every company's data is truly isolated.”",
                  )}
                </blockquote>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500">
                  {t("Tri Handayani · HR Director", "Tri Handayani · HR Director")}
                </p>
              </motion.div>
            </div>

            <div className="relative">
              <div className="mb-3 hidden items-center gap-6 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400 lg:flex dark:text-stone-500">
                <span>{t("86 tabel siap", "86 tables ready")}</span>
                <span aria-hidden className="h-1 w-1 rotate-45 bg-amber-600/60 dark:bg-amber-500/50" />
                <span>{t("Ter-isolasi per tenant", "Isolated per tenant")}</span>
                <span aria-hidden className="h-1 w-1 rotate-45 bg-amber-600/60 dark:bg-amber-500/50" />
                <span>PPh21 · BPJS · SPT 1721-A1</span>
              </div>
              <div aria-hidden className="border-t border-stone-300/80 dark:border-stone-700/60" />
              <MarqueeStrip items={marqueeItems} />
            </div>
          </div>

          {/* ============ Panel kanan — kartu masuk / buat workspace ============ */}
          <div className="relative flex min-h-screen min-w-0 flex-col bg-white/40 lg:bg-transparent dark:bg-stone-900/40 lg:dark:bg-transparent">
            {/* pembatas vertikal hairline */}
            <div aria-hidden className="absolute inset-y-0 left-0 hidden w-px bg-stone-300/80 lg:block dark:bg-stone-700/60" />

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
              {/* tagline serif — mobile (panel kiri tersembunyi) */}
              <p className="mb-5 max-w-[300px] text-center font-serif text-[20px] italic leading-snug text-stone-700 lg:hidden dark:text-stone-300">
                {t("HR yang tertata,", "HR in order,")}{" "}
                <span className="text-amber-700 dark:text-amber-500">{t("bisnis yang tenang.", "business at ease.")}</span>
              </p>

              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="relative w-full max-w-md overflow-hidden rounded-3xl border border-stone-200/90 bg-white p-8 shadow-[0_40px_80px_-40px_rgba(87,83,78,0.35)] sm:p-10 dark:border-stone-800 dark:bg-stone-900 dark:shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)]"
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700 dark:text-amber-500">
                  {tab === "register"
                    ? t("Registrasi", "Registration")
                    : mfaStep
                      ? t("Verifikasi Dua Langkah", "Two-Step Verification")
                      : t("Masuk ke akun", "Sign in to your account")}
                </p>
                <h2 className="mt-2.5 font-serif text-[27px] italic leading-tight text-stone-900 dark:text-stone-100">
                  {tab === "register"
                    ? t("Mulai perjalanan.", "Begin your journey.")
                    : mfaStep
                      ? t("Kode autentikator.", "Authenticator code.")
                      : t("Selamat datang.", "Welcome.")}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
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
                <div className="mt-6 flex items-center gap-5 border-b border-stone-200 pb-5 dark:border-stone-800">
                  {(["login", "register"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => switchTab(k)}
                      className="group relative rounded-sm pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/40"
                    >
                      <span
                        className={cn(
                          "text-[12px] font-bold uppercase tracking-[0.2em] transition-colors",
                          tab === k
                            ? "text-stone-900 dark:text-stone-100"
                            : "text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300",
                        )}
                      >
                        {k === "login" ? t("Masuk") : t("Buat Workspace", "Create Workspace")}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "absolute inset-x-0 -bottom-[21px] h-[2px] transition-all",
                          tab === k
                            ? "bg-amber-600 dark:bg-amber-500"
                            : "bg-transparent group-hover:bg-stone-300 dark:group-hover:bg-stone-600",
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
                    <p className="text-[13px] leading-relaxed text-stone-500 dark:text-stone-400">
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
                        <span aria-hidden className="h-px w-4 bg-stone-300 dark:bg-stone-600" />
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
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500" aria-hidden />
                        {t("Autentikasi dua faktor aktif di akun ini", "Two-factor authentication is active on this account")}
                      </span>
                      <button
                        type="button"
                        onClick={backToPassword}
                        className="text-[11px] font-bold text-amber-800 hover:underline dark:text-amber-400"
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
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500" aria-hidden />
                        {t("Koneksi terenkripsi · data terisolasi per tenant", "Encrypted · data isolated per tenant")}
                      </span>
                      <button
                        type="button"
                        onClick={() => switchTab("register")}
                        className="text-[11px] font-bold text-amber-800 hover:underline dark:text-amber-400"
                      >
                        {t("Belum punya akun?", "No account yet?")}
                      </button>
                    </div>
                  </form>
                )}

                {/* ============ Tab Buat Workspace ============ */}
                {tab === "register" && (
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
                      maxLength={24}
                      mono
                      hint={t(
                        "2–12 huruf besar/angka — dipakai sebagai prefix nomor karyawan (mis. MII00001) dan identitas perusahaan Anda.",
                        "2–12 uppercase letters/numbers — used as your employee number prefix (e.g. MII00001) and your company identity.",
                      )}
                      value={companyCode}
                      onChange={update("reg-companycode", setCompanyCode)}
                      disabled={busy}
                      invalid={isInvalid("reg-companycode")}
                      describedBy={describedBy("reg-companycode", "register-error")}
                    />
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
                      <p className="mt-2 font-serif text-[11.5px] italic text-stone-400 dark:text-stone-500">
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
                      <p className="text-center font-serif text-[12px] italic text-stone-400 dark:text-stone-500">
                        {t(
                          "Provisioning database tenant ± beberapa detik.",
                          "Provisioning the tenant database takes a few seconds.",
                        )}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-amber-700 dark:text-amber-500" aria-hidden />
                        {t("Koneksi terenkripsi · data terisolasi per tenant", "Encrypted · data isolated per tenant")}
                      </span>
                      <button
                        type="button"
                        onClick={() => switchTab("login")}
                        className="text-[11px] font-bold text-amber-800 hover:underline dark:text-amber-400"
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
              <div aria-hidden className="border-t border-stone-200 dark:border-stone-800" />
              <MarqueeStrip items={marqueeItems} />
            </div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
