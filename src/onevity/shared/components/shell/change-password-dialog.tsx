"use client";
// OneVity — dialog GANTI KATA SANDI (self-service, Task 33) ================
// Dibuka dari tombol kunci di footer sidebar AppShell (dan aksi toast
// kedaluwarsa). Verifikasi sandi saat ini + sandi baru divalidasi kebijakan
// workspace + riwayat N sandi terakhir — endpoint /api/auth/change-password.
import { useEffect, useState } from "react";
import { apiSend } from "@/onevity/shared/lib/api";
import { PasswordInput, PasswordRuleChecklist, PasswordStrengthBar } from "@/onevity/shared/components/password-ui";
import { DEFAULT_PASSWORD_POLICY, type PasswordPolicyData } from "@/onevity/shared/lib/password-policy";
import { useSession } from "@/onevity/shared/lib/session-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";

export function ChangePasswordDialog({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
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
      apiSend<{ policy: PasswordPolicyData }>("/api/onevity/password-policy", "GET")
        .then((d) => setPolicy(d.policy))
        .catch(() => setPolicy(DEFAULT_PASSWORD_POLICY));
    }
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setError(null); setDetails([]);
    if (!current || !next) { setError("Kata sandi saat ini & baru wajib diisi"); return; }
    if (next !== confirm) { setError("Konfirmasi kata sandi tidak sama"); return; }
    setBusy(true);
    try {
      await apiSend("/api/auth/change-password", "POST", { currentPassword: current, newPassword: next });
      toast.success("Kata sandi berhasil diganti");
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 ov-text-accent" /> Ganti Kata Sandi
          </DialogTitle>
          <DialogDescription>
            Akun <b>{info?.user.email}</b> — sandi baru divalidasi kebijakan workspace &amp; riwayat {policy.historyCount} sandi terakhir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">Kata Sandi Saat Ini *</Label>
            <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Kata Sandi Baru *</Label>
            <PasswordInput value={next} onChange={setNext} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Konfirmasi Kata Sandi Baru *</Label>
            <PasswordInput value={confirm} onChange={setConfirm} />
          </div>

          <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/40">
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
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">
            {busy ? "Menyimpan…" : "Ganti Kata Sandi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
