"use client";
// Shared decision dialog (approve/reject with note) for Personnel Action
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { apiSend } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { toast } from "sonner";

export function DecisionDialog({
  open,
  onOpenChange,
  docId,
  docNo,
  employeeName,
  variant,
  currentLayer,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  docId: string;
  docNo: string;
  employeeName: string;
  variant: "approve" | "reject";
  currentLayer?: number;
  onDone: () => void;
}) {
  const perms = useMenuPerms();
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const approve = variant === "approve";

  const submit = async () => {
    if (!docId) return;
    setBusy(true);
    try {
      const res = await apiSend<{ action: { status: string; currentLayer: number; layers: { status: string }[] } }>(
        `/api/onevity/personnel-actions/${docId}`,
        "PATCH",
        { action: variant, note: note.trim() || null }
      );
      if (approve) {
        const fully = res.action.status === "Approved";
        toast.success(fully ? t("{doc} sepenuhnya disetujui 🎉", "{doc} fully approved 🎉", { doc: docNo }) : t("{doc} — Layer {n} disetujui, lanjut ke layer berikutnya", "{doc} — Layer {n} approved, moving to the next layer", { doc: docNo, n: currentLayer ?? "" }));
      } else {
        toast.error(t("{doc} ditolak", "{doc} rejected", { doc: docNo }), { description: note.trim() || t("Tanpa catatan", "No note") });
      }
      setNote("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(t("Gagal memutuskan dokumen", "Failed to decide document"), { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setNote("");
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {approve ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 dark:bg-brand/15">
                <CheckCircle2 className="h-5 w-5 text-brand dark:text-brand/85" />
              </span>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/15">
                <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </span>
            )}
            {approve ? t("Setujui Dokumen", "Approve Document") : t("Tolak Dokumen", "Reject Document")}
          </DialogTitle>
          <DialogDescription>
            {t("Keputusan layer", "Layer decision")} {currentLayer ? `${currentLayer} ` : ""}{t("untuk", "for")}{" "}
            <span className="font-semibold text-stone-700 dark:text-stone-300">{docNo}</span>
            {employeeName ? ` — ${employeeName}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="decision-note">{t("Catatan Keputusan (opsional)", "Decision Note (optional)")}</Label>
          <Textarea
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={approve ? t("Contoh: Setuju, silakan lanjutkan proses.", "Example: Approved, please proceed.") : t("Contoh: Data tunjangan belum lengkap, mohon revisi.", "Example: Allowance data is incomplete, please revise.")}
            rows={3}
            className="resize-none"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-11 px-5">{t("Batal")}</Button>
          {perms.canOp("hr", "inbox", "approve") && (
            <Button
              disabled={busy}
              onClick={() => void submit()}
              className={`h-11 px-5 font-bold ${approve ? "bg-brand hover:bg-brand/70" : "bg-rose-600 hover:bg-rose-700"}`}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {approve ? t("Setujui Sekarang", "Approve Now") : t("Tolak Dokumen", "Reject Document")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
