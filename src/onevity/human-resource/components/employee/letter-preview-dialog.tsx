"use client";
// OneVity — Dialog pratinjau & penerbitan surat (Task 3-LETTERS) ============
// =====================================================================
// Dipakai dua tempat:
//   · Catatan Disiplin (employee-wizard DisciplinaryPage) — tombol "Surat"
//     per baris → kategori Disciplinary + disciplinaryRecordId;
//   · Detail Personnel Action (actions-module ActionDetail / pa-detail) —
//     tombol "Cetak Surat" (status Approved/Processed) → kategori
//     PersonnelAction + personnelActionId.
// Pola MOUNT-ON-OPEN: parent merender dialog ini hanya saat terbuka
// (`{target && <LetterPreviewDialog … onClose={…} />}`) — fetch berjalan
// sekali saat mount. POST /api/onevity/letters/issue IDEMPOTEN (klik
// berkali-kali mengembalikan surat yang sama, bukan menduplikasi).
// Saat terbuka: tampilkan kartu kertas refNo + isi snapshot + Unduh PDF.
import { useEffect, useState } from "react";
import { apiSend, fmtDate } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, FileDown, FileText, TriangleAlert, User, CalendarDays } from "lucide-react";

/** Respons POST /api/onevity/letters/issue. */
interface IssuedLetter {
  id: string;
  refNo: string;
  body: string;
  subject: string | null;
  templateName: string;
  employeeName: string;
  issuedAt: string;
}

export function LetterPreviewDialog({
  category, disciplinaryRecordId, personnelActionId, employeeName, onClose,
}: {
  category: "Disciplinary" | "PersonnelAction";
  disciplinaryRecordId?: string;
  personnelActionId?: string;
  employeeName?: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // dialog hanya ter-mount saat terbuka → fetch berjalan sekali di mount;
  // seluruh setState hanya terjadi di callback asinkon (bukan body effect).
  const [letter, setLetter] = useState<IssuedLetter | null>(null);
  const [error, setError] = useState<string | null>(
    category === "Disciplinary" && !disciplinaryRecordId ? "Sumber catatan disiplin tidak valid" : null,
  );
  const [loading, setLoading] = useState(error === null);

  useEffect(() => {
    let alive = true;
    const hasSource = category === "Disciplinary" ? !!disciplinaryRecordId : !!personnelActionId;
    if (!hasSource) return;
    apiSend<{ letter: IssuedLetter }>("/api/onevity/letters/issue", "POST", {
      category,
      disciplinaryRecordId: disciplinaryRecordId ?? undefined,
      personnelActionId: personnelActionId ?? undefined,
    })
      .then((res) => { if (alive) setLetter(res.letter); })
      .catch((e) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "unknown";
        setError(msg);
        toast.error(t("Gagal menerbitkan surat", "Failed to issue the letter"), { description: msg });
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base">
            <FileText className="h-4 w-4 ov-text-accent" />
            {t("Surat {name}", "Letter {name}", { name: employeeName ?? letter?.employeeName ?? "—" })}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 className="h-7 w-7 animate-spin ov-text-accent" aria-hidden />
            <p className="text-xs font-semibold text-stone-500 dark:text-stone-400">
              {t("Menyiapkan surat…", "Preparing the letter…")}
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-10 text-center dark:border-rose-500/30 dark:bg-rose-500/10">
            <TriangleAlert className="mx-auto h-6 w-6 text-rose-500 dark:text-rose-400" aria-hidden />
            <p className="mt-2 text-sm font-bold text-rose-700 dark:text-rose-400">
              {t("Surat gagal diterbitkan", "The letter could not be issued")}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-rose-600 dark:text-rose-400/90">{error}</p>
          </div>
        ) : letter ? (
          <>
            {/* kartu meta: refNo + template + karyawan + tanggal terbit */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200/80 bg-stone-50/70 px-4 py-3 dark:border-stone-700/70 dark:bg-stone-800/40">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full bg-stone-900 px-2.5 font-mono text-[10px] font-bold text-white hover:bg-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-100">
                  {letter.refNo}
                </Badge>
                <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{letter.templateName}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                <span className="inline-flex items-center gap-1"><User className="h-3 w-3" aria-hidden /> {letter.employeeName}</span>
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden /> {fmtDate(letter.issuedAt)}</span>
              </div>
            </div>

            {/* kertas surat — snapshot body hasil render */}
            <div className="max-h-[65vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700">
              <div className="whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-stone-800">
                {letter.body}
              </div>
            </div>
          </>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          {letter ? (
            <Button asChild className="h-11 gap-2 font-bold">
              <a href={`/api/onevity/letters/${letter.id}/pdf?download=1`} download>
                <FileDown className="h-4 w-4" /> {t("Unduh PDF", "Download PDF")}
              </a>
            </Button>
          ) : (
            <Button disabled className="h-11 gap-2 font-bold">
              <FileDown className="h-4 w-4" /> {t("Unduh PDF", "Download PDF")}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="h-11">
            {t("Tutup", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
