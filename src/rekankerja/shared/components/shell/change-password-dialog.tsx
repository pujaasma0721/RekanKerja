"use client";
// RekanKerja — dialog GANTI KATA SANDI (self-service, Task 33) ================
// Dibuka dari tombol kunci di footer sidebar AppShell (dan aksi toast
// kedaluwarsa). Verifikasi sandi saat ini + sandi baru divalidasi kebijakan
// workspace + riwayat N sandi terakhir — endpoint /api/auth/change-password.
import { useEffect, useState } from "react";
import { apiSend } from "@/rekankerja/shared/lib/api";
import { PasswordInput, PasswordRuleChecklist, PasswordStrengthBar } from "@/rekankerja/shared/components/password-ui";
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicyData } from "@/rekankerja/shared/lib/password-policy";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export function ChangePasswordDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { t } = useI18n();
  const { info } = useSession();
  const [policy, setPolicy] = useState<PasswordPolicyData>(DEFAULT_PASSWORD_POLICY);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setCurrent(""); setNext(""); setConfirm(""); setError(null); setDetails([]);
      // kebijakan workspace aktif (utk checklist live — server tetap otoritatif)
      apiSend<{ policy: PasswordPolicyData }>("/api/rekankerja/password-policy", "GET")
        .then((d) => setPolicy(d.policy))
        .catch(() => setPolicy(DEFAULT_PASSWORD_POLICY));
    }
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setError(null); setDetails([]);
    if (!current || !next) { setError(t("Kata sandi saat ini & baru wajib diisi", "Current & new password are required")); return; }
    if (next !== confirm) { setError(t("Konfirmasi kata sandi tidak sama", "Password confirmation does not match")); return; }
    setBusy(true);
    try {
      await apiSend("/api/auth/change-password", "POST", { currentPassword: current, newPassword: next });
      toast.success(t("Kata sandi berhasil diganti", "Password changed successfully"));
      setOpen(false);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setError(err.message);
      setDetails(err.details ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) setOpen(v); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 ov-text-accent" /> {t("Ganti Kata Sandi")}
          </DialogTitle>
          <DialogDescription>
            {t("Akun {email} — sandi baru divalidasi kebijakan workspace & riwayat {n} sandi terakhir.", "Account {email} — the new password is validated against workspace policy & the last {n} passwords.", { email: info?.user.email ?? "", n: policy.historyCount })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Kata Sandi Saat Ini", "Current Password")} *</Label>
            <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Kata Sandi Baru", "New Password")} *</Label>
            <PasswordInput value={next} onChange={setNext} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Konfirmasi Kata Sandi Baru", "Confirm New Password")} *</Label>
            <PasswordInput value={confirm} onChange={setConfirm} />
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <PasswordStrengthBar password={next} />
            <PasswordRuleChecklist
              policy={policy}
              password={next}
              email={info?.user.email ?? null}
              compact
            />
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="text-xs font-bold text-rose-700 dark:text-rose-400">{error}</p>
              {details.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {details.map((d, i) => <li key={i} className="text-[11px] text-rose-600 dark:text-rose-400">{d}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">
            {busy ? t("Menyimpan…") : t("Ganti Kata Sandi")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
