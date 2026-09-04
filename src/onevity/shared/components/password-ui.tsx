"use client";
// OneVity — komponen UI kata sandi (Task 33) ============================
// Dipakai: dialog Tambah Pengguna, Reset Kata Sandi, Ganti Kata Sandi
// (shell), dan panel Uji Coba Kebijakan. Checklist aturan live + meter
// kekuatan + input dengan tombol perlihatkan/sembunyikan.
import { useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  passwordStrength,
  validatePassword,
  type PasswordPolicyData,
} from "@/onevity/shared/lib/password-policy";

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
  const v = validatePassword(policy, password, { username, fullName, email });
  if (password.length === 0) {
    return (
      <p className={cn("text-stone-400", compact ? "text-[10px]" : "text-[11px]")}>
        Kata sandi divalidasi terhadap {v.checks.length} aturan kebijakan saat ini.
      </p>
    );
  }
  return (
    <ul className="grid gap-1 sm:grid-cols-2">
      {v.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-1.5" title={c.label}>
          {c.pass ? (
            <Check className={cn("mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
          ) : (
            <X className={cn("mt-0.5 shrink-0 text-rose-500", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
          )}
          <span className={cn("leading-tight", compact ? "text-[10px]" : "text-[11px]", c.pass ? "text-stone-500 dark:text-stone-400" : "font-semibold text-rose-600 dark:text-rose-400")}>
            {c.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Meter kekuatan sandi (indikatif — bukan aturan kebijakan). */
export function PasswordStrengthBar({ password, compact }: { password: string; compact?: boolean }) {
  const s = passwordStrength(password);
  if (!password) return null;
  const tone =
    s.label === "Lemah" ? "bg-rose-500"
    : s.label === "Sedang" ? "bg-amber-400"
    : s.label === "Kuat" ? "bg-emerald-500"
    : "bg-emerald-600";
  const text =
    s.label === "Lemah" ? "text-rose-600 dark:text-rose-400"
    : s.label === "Sedang" ? "text-amber-600 dark:text-amber-400"
    : "text-emerald-700 dark:text-emerald-400";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800" role="progressbar" aria-valuenow={s.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Kekuatan kata sandi">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${s.pct}%` }} />
      </div>
      <span className={cn("shrink-0 font-bold", compact ? "text-[10px]" : "text-[11px]", text)}>{s.label}</span>
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
        aria-label={show ? "Sembunyikan kata sandi" : "Perlihatkan kata sandi"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
