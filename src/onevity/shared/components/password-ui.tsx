"use client";
// OneVity — komponen UI kata sandi (Task 33) ============================
// Dipakai: dialog Tambah Pengguna, Reset Kata Sandi, Ganti Kata Sandi
// (shell), dan panel Uji Coba Kebijakan. Checklist aturan live + meter
// kekuatan + input dengan tombol perlihatkan/sembunyikan.
import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";
import {
  passwordStrength,
  validatePassword,
  type PasswordPolicyData,
} from "@/onevity/shared/lib/password-policy";

// Peta EN paralel untuk label aturan dari lib/password-policy (sumber label tetap
// Bahasa Indonesia di lib — angka kebijakan tetap data, hanya label diterjemahkan).
const CHECK_LABEL_EN: Record<string, string> = {
  "Mengandung huruf besar (A–Z)": "Contains an uppercase letter (A–Z)",
  "Mengandung huruf kecil (a–z)": "Contains a lowercase letter (a–z)",
  "Mengandung angka (0–9)": "Contains a digit (0–9)",
  "Mengandung karakter khusus (!@#$% dll.)": "Contains a special character (!@#$% etc.)",
  "Tidak mengandung username / email": "Must not contain the username / email",
  "Tidak mengandung nama pengguna": "Must not contain the user's name",
  "Bukan kata sandi umum / mudah ditebak": "Not a common / easily guessed password",
};

/** Label aturan dinamis ("Minimal 8 karakter" dll.) → padanan EN. */
function checkLabelEn(label: string): string {
  let m = /^Minimal (\d+) karakter berbeda$/.exec(label);
  if (m) return `At least ${m[1]} distinct characters`;
  m = /^Minimal (\d+) karakter$/.exec(label);
  if (m) return `At least ${m[1]} characters`;
  m = /^Maksimal (\d+) karakter$/.exec(label);
  if (m) return `At most ${m[1]} characters`;
  m = /^Tidak lebih dari (\d+) karakter sama berturut-turut/.exec(label);
  if (m) return `No more than ${m[1]} identical characters in a row (e.g. aaaa)`;
  m = /^Tidak lebih dari (\d+) karakter berurutan/.exec(label);
  if (m) return `No more than ${m[1]} sequential characters (e.g. abcd / 4321)`;
  return CHECK_LABEL_EN[label] ?? label;
}

const STRENGTH_LABEL_EN: Record<string, string> = {
  "Lemah": "Weak", "Sedang": "Fair", "Kuat": "Strong", "Sangat Kuat": "Very Strong",
};

/** Baris daftar aturan dengan tanda lolos/gagal — live selama mengetik. */
export function PasswordRuleChecklist({
  policy,
  password,
  username,
  fullName,
  email,
  compact,
}: {
  policy: PasswordPolicyData;
  password: string;
  username?: string | null;
  fullName?: string | null;
  email?: string | null;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const v = validatePassword(policy, password, { username, fullName, email });
  if (password.length === 0) {
    return (
      <p className={cn("text-stone-400", compact ? "text-[10px]" : "text-[11px]")}>
        {t("Kata sandi divalidasi terhadap {n} aturan kebijakan saat ini.", "The password is validated against the current {n} policy rules.", { n: v.checks.length })}
      </p>
    );
  }
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {v.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-1.5" title={t(c.label, checkLabelEn(c.label))}>
          {c.pass ? (
            <Check className={cn("mt-0.5 shrink-0 text-brand dark:text-brand/85", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
          ) : (
            <X className={cn("mt-0.5 shrink-0 text-rose-500", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
          )}
          <span className={cn("leading-tight", compact ? "text-[10px]" : "text-[11px]", c.pass ? "text-stone-500 dark:text-stone-400" : "font-semibold text-rose-600 dark:text-rose-400")}>
            {t(c.label, checkLabelEn(c.label))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Meter kekuatan sandi (indikatif — bukan aturan kebijakan). */
export function PasswordStrengthBar({ password, compact }: { password: string; compact?: boolean }) {
  const { t } = useI18n();
  const s = passwordStrength(password);
  if (!password) return null;
  const tone =
    s.label === "Lemah" ? "bg-rose-500"
    : s.label === "Sedang" ? "bg-amber-400"
    : s.label === "Kuat" ? "bg-brand"
    : "bg-brand";
  const text =
    s.label === "Lemah" ? "text-rose-600 dark:text-rose-400"
    : s.label === "Sedang" ? "text-amber-600 dark:text-amber-400"
    : "text-brand-deep dark:text-brand/85";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" role="progressbar" aria-valuenow={s.pct} aria-valuemin={0} aria-valuemax={100} aria-label={t("Kekuatan kata sandi", "Password strength")}>
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${s.pct}%` }} />
      </div>
      <span className={cn("shrink-0 font-bold", compact ? "text-[10px]" : "text-[11px]", text)}>{t(s.label, STRENGTH_LABEL_EN[s.label] ?? s.label)}</span>
    </div>
  );
}

/** Input kata sandi dengan tombol mata (perlihatkan / sembunyikan). */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = "new-password",
  disabled,
  className,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        autoComplete={autoComplete}
        disabled={disabled}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t("Sembunyikan kata sandi", "Hide password") : t("Perlihatkan kata sandi", "Show password")}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
