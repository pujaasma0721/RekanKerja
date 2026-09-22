"use client";

// OneVity — dialog TANDA TANGAN ELEKTRONIK (Task 80). ========================
// Alur: GET status (PIN/OTP?) → POST challenge → user isi kode → POST sign.
// Hasil: link verifikasi publik /v/[signatureId] (bisa disalin/dikirim).
// Reusable untuk semua docType (surat dulu; PA & payroll menyusul).
// ============================================================================

import { useEffect, useState } from "react";
import { BadgeCheck, Copy, Fingerprint, KeyRound, Loader2, MailCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/onevity/shared/lib/i18n";

export type EsignDocType = "LetterDocument" | "PersonnelAction" | "PayrollRun";

interface SignDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docType: EsignDocType;
  docId: string;
  /** label singkat dokumen utk judul (mis. "Surat 001/HR/IX/2026") */
  docLabel: string;
  /** dipanggil setelah ttd sukses (mis. refresh daftar) */
  onSigned?: (signatureId: string) => void;
}

interface StatusPayload { hasPin: boolean; hasKey: boolean; factor?: "pin" | "otp"; }
interface ChallengePayload { ok: boolean; message: string; factor?: "pin" | "otp"; }
interface SignPayload { ok: boolean; message: string; signatureId?: string; }

export function EsignSignDialog({ open, onOpenChange, docType, docId, docLabel, onSigned }: SignDialogProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [factor, setFactor] = useState<"pin" | "otp" | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDone(null); setCode(""); setError(""); setFactor(null); setBusy(false);
    fetch("/api/onevity/esign").then((r) => (r.ok ? r.json() : null)).then((j: StatusPayload | null) => setStatus(j)).catch(() => setStatus(null));
  }, [open, docId]);

  const requestChallenge = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/onevity/esign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "challenge", docType, docId }),
      });
      const j = (await r.json()) as ChallengePayload;
      if (j.ok) setFactor(j.factor ?? (status?.hasPin ? "pin" : "otp"));
      else setError(j.message || t("Gagal memulai tanda tangan", "Failed to start signing"));
    } catch {
      setError(t("Kesalahan jaringan", "Network error"));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/onevity/esign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sign", docType, docId, code }),
      });
      const j = (await r.json()) as SignPayload;
      if (j.ok && j.signatureId) {
        setDone({ id: j.signatureId });
        onSigned?.(j.signatureId);
      } else setError(j.message || t("Tanda tangan gagal", "Signing failed"));
    } catch {
      setError(t("Kesalahan jaringan", "Network error"));
    } finally { setBusy(false); }
  };

  const verifyUrl = done ? typeof window !== "undefined" ? `${window.location.origin}/v/${done.id}` : "" : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Fingerprint className="h-5 w-5" /> {t("Tanda Tangan Elektronik", "Electronic Signature")}
          </DialogTitle>
          <DialogDescription>{docLabel}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div className="text-sm">
                <p className="font-bold text-emerald-800">{t("Dokumen berhasil ditandatangani", "Document signed")}</p>
                <p className="mt-1 text-emerald-700/80">
                  {t("Bukti kriptografis tersimpan. Bagikan tautan verifikasi untuk membuktikan keaslian dokumen:", "Cryptographic proof stored. Share the verification link to prove authenticity:")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={verifyUrl} className="h-9 flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => { void navigator.clipboard.writeText(verifyUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                {copied ? <Check16 /> : <Copy className="h-3.5 w-3.5" />} {t("Salin", "Copy")}
              </Button>
            </div>
            <DialogFooter>
              <Button className="h-9" onClick={() => onOpenChange(false)}>{t("Selesai", "Done")}</Button>
            </DialogFooter>
          </div>
        ) : factor === null ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              {t("Tanda tangan dibuat dengan kunci kriptografis pribadi Anda dan tercatat permanen. Lanjutkan dengan faktor verifikasi:", "Your signature is created with your personal cryptographic key and recorded permanently. Continue with a verification factor:")}
            </p>
            <div className="grid gap-2">
              <button
                type="button" disabled={busy || (status ? !status.hasKey : false)}
                onClick={() => void requestChallenge()}
                className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 text-left transition hover:border-stone-900 disabled:opacity-50"
              >
                {status?.hasPin ? <KeyRound className="h-5 w-5" /> : <MailCheck className="h-5 w-5" />}
                <span className="text-sm font-bold">
                  {status?.hasPin ? t("Gunakan PIN tanda tangan", "Use signature PIN") : t("Kirim kode OTP ke email saya", "Email me an OTP code")}
                </span>
              </button>
            </div>
            {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!busy) void submit(); }}>
            <div className="space-y-1.5">
              <Label htmlFor="esign-code" className="text-[13px] font-bold">
                {factor === "pin" ? t("PIN Tanda Tangan (6 digit)", "Signature PIN (6 digits)") : t("Kode OTP dari Email (6 digit)", "Email OTP code (6 digits)")}
              </Label>
              <Input
                id="esign-code" inputMode="numeric" maxLength={6} autoFocus
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="h-11 text-center font-mono text-xl tracking-[0.4em]" placeholder="••••••"
              />
              {factor === "otp" && (
                <button type="button" className="text-[11px] font-semibold text-stone-500 underline underline-offset-2 hover:text-stone-800" onClick={() => void requestChallenge()} disabled={busy}>
                  {t("Kirim ulang kode", "Resend code")}
                </button>
              )}
            </div>
            {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" className="h-9" onClick={() => { setFactor(null); setError(""); }}>{t("Kembali", "Back")}</Button>
              <Button type="submit" className="h-9 gap-1.5" disabled={busy || code.length !== 6}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {t("Tandatangani", "Sign")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Check16() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
