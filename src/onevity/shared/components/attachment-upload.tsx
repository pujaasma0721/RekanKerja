"use client";
// OneVity — komponen upload & preview lampiran (T16-ATTACH). ================
// Dipakai dialog submit klaim travel/medical + dialog dokumen karyawan.
//   <AttachmentUploadArea files onChange /> — pilih file (multi), preview
//     nama+ukuran+ikon, hapus sebelum submit (file BELUM diunggah —
//     diunggah saat submit dengan entityId "draft:" lalu di-rebind server).
//   <AttachmentChips attachments /> — daftar lampiran tersimpan; klik →
//     buka tab baru GET /api/onevity/attachments/{id} (inline preview).
import { useRef } from "react";
import { toast } from "sonner";
import { Paperclip, FileText, Image as ImageIcon, Eye, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { cn } from "@/lib/utils";

/** Metadata lampiran tersimpan (dari API — tanpa storagePath). */
export interface AttachmentMetaUI {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  entityType?: string;
  entityId?: string;
  createdAt?: string;
}

export const ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/webp,application/pdf";

export const fmtSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  return FileText;
}

export function attachmentUrl(id: string, download = false): string {
  return `/api/onevity/attachments/${id}${download ? "?download=1" : ""}`;
}

// ==== area pilih file (pra-submit — state lokal File[]) ====
export function AttachmentUploadArea({
  files,
  onChange,
  hint,
  compact,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  /** teks hint tambahan (mis. peringatan wajib kwitansi). */
  hint?: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    // validasi ringan sisi klien (server tetap otoritatif): jenis + ukuran
    const ok = incoming.filter(
      (f) =>
        (ACCEPT_ATTRIBUTE.split(",").includes(f.type) || /\.(jpe?g|png|webp|pdf)$/i.test(f.name)) &&
        f.size <= 5 * 1024 * 1024,
    );
    if (ok.length < incoming.length) {
      toast.error(
        t("Beberapa file dilewati — hanya JPG/PNG/WEBP/PDF maks 5 MB", "Some files were skipped — only JPG/PNG/WEBP/PDF up to 5 MB"),
      );
    }
    // hindari duplikat nama+ukuran yang sama persis
    const existing = new Set(files.map((f) => `${f.name}:${f.size}`));
    const merged = [...files, ...ok.filter((f) => !existing.has(`${f.name}:${f.size}`))];
    onChange(merged);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = ""; // reset supaya file yang sama bisa dipilih ulang
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-stone-300 bg-stone-50/60 px-3 py-3 text-xs font-bold text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-300 dark:hover:border-stone-500",
          compact && "py-2",
        )}
      >
        <UploadCloud className="h-4 w-4" />
        {t("Pilih file kwitansi (JPG/PNG/WEBP/PDF · maks 5 MB)", "Pick receipt files (JPG/PNG/WEBP/PDF · max 5 MB)")}
      </button>
      {hint && <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">{hint}</p>}
      {files.length > 0 && (
        <div className="space-y-1.5">
          {files.map((f, i) => {
            const Icon = f.type.startsWith("image/") ? ImageIcon : FileText;
            return (
              <div
                key={`${f.name}-${f.size}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 dark:border-stone-700 dark:bg-stone-900"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stone-100 dark:bg-stone-800">
                  <Icon className="h-3.5 w-3.5 text-stone-500" />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-700 dark:text-stone-200" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 text-[10px] font-bold text-stone-400">{fmtSize(f.size)}</span>
                <button
                  type="button"
                  className="shrink-0 text-rose-500 hover:text-rose-600"
                  onClick={() => onChange(files.filter((_, x) => x !== i))}
                  aria-label={t("Hapus file", "Remove file")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==== chips lampiran tersimpan (post-submit — klik = buka tab baru) ====
export function AttachmentChips({
  attachments,
  onDeleted,
  showDelete,
}: {
  attachments: AttachmentMetaUI[];
  /** refresh data pemilik setelah hapus (opsional). */
  onDeleted?: () => void;
  showDelete?: boolean;
}) {
  const { t } = useI18n();

  if (attachments.length === 0) {
    return <span className="text-[11px] text-stone-400">{t("tanpa lampiran", "no attachments")}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((a) => {
        const Icon = iconFor(a.mimeType);
        return (
          <span
            key={a.id}
            className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-stone-200 bg-white py-1 pl-1.5 pr-1 text-[11px] font-semibold text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          >
            <Icon className="h-3 w-3 shrink-0 text-stone-400" />
            <a
              href={attachmentUrl(a.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 truncate hover:underline"
              title={`${a.fileName} · ${fmtSize(a.sizeBytes)}`}
            >
              {a.fileName}
            </a>
            <span className="shrink-0 text-[9px] font-bold text-stone-400">{fmtSize(a.sizeBytes)}</span>
            <a
              href={attachmentUrl(a.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
              aria-label={t("Lihat lampiran", "View attachment")}
            >
              <Eye className="h-3 w-3" />
            </a>
            {showDelete && onDeleted && (
              <DeleteAttachmentButton id={a.id} fileName={a.fileName} onDeleted={onDeleted} />
            )}
          </span>
        );
      })}
    </div>
  );
}

/** tombol hapus kecil (hanya bilah lampiran milik entitas — best-effort). */
export function DeleteAttachmentButton({
  id, fileName, onDeleted,
}: {
  id: string; fileName: string; onDeleted: () => void;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-5 w-5 p-0 text-rose-500 hover:text-rose-600"
      title={t("Hapus lampiran {f}", "Delete attachment {f}", { f: fileName })}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          const res = await fetch(`/api/onevity/attachments/${id}`, { method: "DELETE" });
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(json.error ?? `HTTP ${res.status}`);
          }
          onDeleted();
        } catch {
          onDeleted(); // refresh state (server tetap otoritatif)
        }
      }}
    >
      <Trash2 className="h-3 w-3" />
    </Button>
  );
}

/** Badge jumlah lampiran utk daftar klaim ("lampiran n"). */
export function AttachmentCountBadge({ count }: { count: number }) {
  const { t } = useI18n();
  if (!count) return null;
  return (
    <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700 hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300">
      <Paperclip className="h-2.5 w-2.5" />
      {t("lampiran {n}", "{n} attached", { n: count })}
    </span>
  );
}
