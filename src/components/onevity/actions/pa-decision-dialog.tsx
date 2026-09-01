"use client";
// Shared decision dialog (approve/reject with note) for Personnel Action
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { apiSend } from "@/lib/onevity/api";
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
        toast.success(fully ? `${docNo} sepenuhnya disetujui 🎉` : `${docNo} — Layer ${currentLayer ?? ""} disetujui, lanjut ke layer berikutnya`);
      } else {
        toast.error(`${docNo} ditolak`, { description: note.trim() || "Tanpa catatan" });
      }
      setNote("");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error("Gagal memutuskan dokumen", { description: (e as Error).message });
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            {approve ? (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </span>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/15">
                <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </span>
            )}
            {approve ? "Setujui Dokumen" : "Tolak Dokumen"}
          </DialogTitle>
          <DialogDescription>
            Keputusan layer {currentLayer ? `${currentLayer} ` : ""}untuk{" "}
            <span className="font-semibold text-stone-700 dark:text-stone-300">{docNo}</span>
            {employeeName ? ` — ${employeeName}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="decision-note">Catatan Keputusan (opsional)</Label>
          <Textarea
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={approve ? "Contoh: Setuju, silakan lanjutkan proses." : "Contoh: Data tunjangan belum lengkap, mohon revisi."}
            rows={3}
            className="resize-none"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-11 px-5">Batal</Button>
          <Button
            disabled={busy}
            onClick={() => void submit()}
            className={`h-11 px-5 font-bold ${approve ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"}`}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {approve ? "Setujui Sekarang" : "Tolak Dokumen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
