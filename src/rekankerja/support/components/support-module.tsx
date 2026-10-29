"use client";
// RekanKerja — Online Support (FEAT-SUPPORT-P1..P4): menu "Support Service". ===
// =====================================================================
// Chat interaktif pengguna ↔ AI support agent bergaya ticketing:
//   · Kiri: daftar tiket percakapan (status/prioritas/waktu) + pencarian;
//     pemegang op support:service/manage bisa mengganti scope "Semua Tiket".
//   · Kanan: utas chat — bubble USER/AI (+SYSTEM), lampiran gambar inline
//     (klik utk buka) & dokumen chip unduh, markdown utk balasan AI,
//     indikator "mengetik", retry bila provider AI gagal, aksi status
//     (Selesai / Tutup / Buka Kembali), polling ringan 15 dtk.
//   · Percakapan baru: dialog judul → tiket SP-<tahun>-NNN + sambutan agen.
//   · FEAT-SUPPORT-P4 — kartu usulan patch (diff berwarna) inline di timeline
//     chat; pemegang op manage bisa menyetujui/menolak lewat dialog tinjauan
//     (approve → file diterapkan; keputusan tercatat sbg pesan SYSTEM).
// Lampiran diunggah via multipart (apiUpload) — server menyimpan lewat
// attachment-service generik (entityType "SupportMessage").
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Headset, Plus, Send, Paperclip, X, FileText, Download, ArrowLeft, Search,
  Loader2, CheckCircle2, RotateCcw, ImageIcon, FileDiff, ChevronDown, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useApi, apiSend, apiUpload } from "@/rekankerja/shared/lib/api";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useAccentTheme, ACCENT_THEMES } from "@/rekankerja/shared/lib/accent-theme";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";

// ---------- tipe (bentuk JSON dari API support) ----------
interface TicketRow {
  id: string;
  ticketNo: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  createdById: string | null;
  createdByName: string | null;
  lastMessageAt: string;
  createdAt: string;
  closedAt?: string | null;
  _count?: { messages: number };
}
interface AttachmentMeta { id: string; fileName: string; mimeType: string; sizeBytes: number }
interface MessageRow {
  id: string;
  senderRole: string; // USER | AI | SYSTEM
  senderName: string | null;
  body: string;
  createdAt: string;
  attachments: AttachmentMeta[];
}
// FEAT-SUPPORT-P4 — usulan patch dari agen (menunggu keputusan developer).
interface PatchRow {
  id: string;
  filePath: string;
  description: string;
  diffText: string;
  status: string; // MENUNGGU|DISETUJUI|DITOLAK|KONFLIK
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

// ---------- label dwibahasa status/kategori/prioritas ----------
const STATUS_UI: Record<string, { id: string; en: string; cls: string; dot: string }> = {
  AKTIF: {
    id: "Aktif", en: "Active",
    cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25", dot: "bg-brand",
  },
  SELESAI: {
    id: "Selesai", en: "Resolved",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25", dot: "bg-emerald-500",
  },
  DITUTUP: {
    id: "Ditutup", en: "Closed",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400",
  },
};
const CATEGORY_UI: Record<string, { id: string; en: string }> = {
  BUG: { id: "Bug", en: "Bug" },
  PENGGUNAAN: { id: "Cara Pakai", en: "How-to" },
  DATA: { id: "Data", en: "Data" },
  AKUN: { id: "Akun", en: "Account" },
  FITUR: { id: "Permintaan Fitur", en: "Feature Request" },
  LAINNYA: { id: "Lainnya", en: "Other" },
};
const PRIORITY_UI: Record<string, { id: string; en: string; cls: string }> = {
  RENDAH: { id: "Rendah", en: "Low", cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25" },
  SEDANG: { id: "Sedang", en: "Medium", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25" },
  TINGGI: { id: "Tinggi", en: "High", cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25" },
  KRITIS: { id: "Kritis", en: "Critical", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" },
};

// ---------- label dwibahasa status usulan patch (P4) ----------
const PATCH_STATUS_UI: Record<string, { id: string; en: string; cls: string }> = {
  MENUNGGU: {
    id: "Menunggu Persetujuan", en: "Pending Approval",
    cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  },
  DISETUJUI: {
    id: "Disetujui & Diterapkan", en: "Approved & Applied",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  DITOLAK: {
    id: "Ditolak", en: "Rejected",
    cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  },
  KONFLIK: {
    id: "Konflik — file berubah", en: "Conflict — file changed",
    cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
};

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024;

function fmtSize(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function fmtStamp(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString(locale, { day: "numeric", month: "short" })} ${time}`;
}

// ---------- render markdown balasan AI (pola ai-chat-widget) ----------
const MD_COMPONENTS: Components = {
  h1: ({ node, ...p }) => <h3 className="mt-2 mb-1 text-[13px] font-bold first:mt-0" {...p} />,
  h2: ({ node, ...p }) => <h3 className="mt-2 mb-1 text-[13px] font-bold first:mt-0" {...p} />,
  h3: ({ node, ...p }) => <h4 className="mt-2 mb-1 text-[12.5px] font-semibold first:mt-0" {...p} />,
  h4: ({ node, ...p }) => <h4 className="mt-1.5 mb-1 text-[12.5px] font-semibold first:mt-0" {...p} />,
  p: ({ node, ...p }) => <p className="my-1 first:my-0" {...p} />,
  ul: ({ node, ...p }) => <ul className="my-1 list-disc space-y-0.5 pl-4" {...p} />,
  ol: ({ node, ...p }) => <ol className="my-1 list-decimal space-y-0.5 pl-4" {...p} />,
  li: ({ node, ...p }) => <li className="leading-snug" {...p} />,
  table: ({ node, ...p }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px]" {...p} />
    </div>
  ),
  th: ({ node, ...p }) => <th className="border border-slate-300 px-1.5 py-1 text-left font-semibold dark:border-slate-600" {...p} />,
  td: ({ node, ...p }) => <td className="border border-slate-200 px-1.5 py-1 align-top dark:border-slate-700" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
  a: ({ node, ...p }) => <a className="text-brand underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
  code: ({ node, ...p }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-900" {...p} />,
  pre: ({ node, ...p }) => <pre className="my-1.5 overflow-x-auto rounded-lg bg-slate-900 p-2 text-[11px] text-slate-100" {...p} />,
  blockquote: ({ node, ...p }) => <blockquote className="my-1 border-l-2 border-slate-300 pl-2 text-slate-500 dark:border-slate-600 dark:text-slate-400" {...p} />,
  hr: () => <hr className="my-2 border-slate-200 dark:border-slate-700" />,
};

// ---------- subkomponen kecil ----------
function TypingDots() {
  return (
    <div className="flex justify-start" aria-label="AI sedang mengetik">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 dark:bg-slate-500" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const s = STATUS_UI[status] ?? { id: status, en: status, cls: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25", dot: "bg-slate-400" };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {t(s.id, s.en)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useI18n();
  const p = PRIORITY_UI[priority];
  if (!p) return null;
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", p.cls)}>
      {t(p.id, p.en)}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const { t } = useI18n();
  const c = CATEGORY_UI[category] ?? { id: category, en: category };
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10.5px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
      {t(c.id, c.en)}
    </span>
  );
}

/** Lampiran pesan: gambar → thumbnail (klik buka); dokumen → chip unduh. */
function AttachmentList({ atts, mine }: { atts: AttachmentMeta[]; mine: boolean }) {
  if (atts.length === 0) return null;
  const images = atts.filter((a) => a.mimeType.startsWith("image/"));
  const docs = atts.filter((a) => !a.mimeType.startsWith("image/"));
  return (
    <div className="mt-2 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((a) => (
            <a
              key={a.id}
              href={`/api/rekankerja/support/attachments/${a.id}`}
              target="_blank"
              rel="noreferrer"
              title={a.fileName}
              className="group relative block h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
            >
              <img
                src={`/api/rekankerja/support/attachments/${a.id}`}
                alt={a.fileName}
                className="h-full w-full object-cover transition group-hover:scale-105"
                loading="lazy"
              />
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-2 text-[8.5px] text-white opacity-0 transition group-hover:opacity-100">
                {a.fileName}
              </span>
            </a>
          ))}
        </div>
      )}
      {docs.map((a) => (
        <a
          key={a.id}
          href={`/api/rekankerja/support/attachments/${a.id}?download=1`}
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800",
            mine && "flex-row-reverse",
          )}
          title={a.fileName}
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden />
          <span className="truncate font-medium">{a.fileName}</span>
          <span className="shrink-0 text-slate-400">{fmtSize(a.sizeBytes)}</span>
          <Download className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
        </a>
      ))}
    </div>
  );
}

/** Satu bubble percakapan. */
function ChatBubble({ m, locale, accent }: { m: MessageRow; locale: string; accent: string }) {
  const { t } = useI18n();
  if (m.senderRole === "SYSTEM") {
    return (
      <div className="flex justify-center" role="note">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
          {m.body}
        </span>
      </div>
    );
  }
  const mine = m.senderRole === "USER";
  return (
    <div className={cn("flex w-full gap-2.5", mine ? "justify-end" : "justify-start")}>
      {!mine && (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-emerald-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-emerald-400" aria-hidden>
          <Headset className="h-4 w-4" />
        </div>
      )}
      <div className={cn("flex max-w-[85%] flex-col sm:max-w-[75%]", mine && "items-end")}>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
            mine
              ? "rounded-br-md text-white"
              : "rounded-bl-md border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
          )}
          style={mine ? { background: accent } : undefined}
        >
          {mine ? m.body : <ReactMarkdown components={MD_COMPONENTS} remarkPlugins={[remarkGfm]}>{m.body}</ReactMarkdown>}
        </div>
        {m.attachments.length > 0 && (
          <div className={cn("max-w-full", mine ? "self-end" : "self-start")}>
            <div className="rounded-2xl px-1 pt-1">
              <AttachmentList atts={m.attachments} mine={mine} />
            </div>
          </div>
        )}
        <span className={cn("mt-0.5 px-1 text-[10px] text-slate-400 dark:text-slate-500", mine ? "text-right" : "text-left")}>
          {m.senderName ?? (mine ? t("Anda", "You") : "Support AI")} · {fmtStamp(m.createdAt, locale)}
        </span>
      </div>
    </div>
  );
}

/** Blok render unified diff (warna per jenis baris; gelap utk kontras kode). */
function DiffBlock({ diff, maxH }: { diff: string; maxH?: string }) {
  const lines = diff.split("\n");
  return (
    <div
      className={cn("overflow-auto rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-700", maxH ?? "max-h-72")}
      role="region"
      aria-label="Perubahan kode yang diusulkan"
    >
      <pre className="min-w-max p-2 font-mono text-[10.5px] leading-relaxed">
        {lines.map((l, i) => {
          const cls = l.startsWith("+++") || l.startsWith("---")
            ? "text-slate-500"
            : l.startsWith("@@")
              ? "font-semibold text-amber-300"
              : l.startsWith("+")
                ? "bg-emerald-500/10 text-emerald-300"
                : l.startsWith("-")
                  ? "bg-rose-500/10 text-rose-300"
                  : "text-slate-400";
          return (
            <span key={i} className={cn("block whitespace-pre px-1.5", cls)}>
              {l.length > 0 ? l : " "}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

/** Kartu usulan patch (FEAT-SUPPORT-P4) — muncul di timeline chat.
 *  Pelapor: hanya lihat status/diff. Pemegang op manage: bisa memutuskan. */
function PatchCard({
  p, canDecide, onReview, locale,
}: { p: PatchRow; canDecide: boolean; onReview: (p: PatchRow) => void; locale: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const st = PATCH_STATUS_UI[p.status] ?? PATCH_STATUS_UI.MENUNGGU;
  const added = p.diffText.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = p.diffText.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return (
    <div className="flex w-full justify-start">
      <div className="w-full rounded-2xl rounded-bl-md border border-brand/30 bg-brand/[0.03] p-3 shadow-sm dark:border-brand/25 dark:bg-brand/[0.06] sm:max-w-[85%]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-brand/30 bg-white text-brand-deep dark:border-brand/25 dark:bg-slate-900 dark:text-brand/85" aria-hidden>
            <FileDiff className="h-3.5 w-3.5" />
          </span>
          <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-100">
            {t("Usulan Perbaikan Kode", "Code Patch Proposal")}
          </span>
          <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold", st.cls)}>
            {t(st.id, st.en)}
          </span>
          <span className="ml-auto text-[10px] text-slate-400">{fmtStamp(p.createdAt, locale)}</span>
        </div>
        <p className="mt-1.5 break-all font-mono text-[11px] font-semibold text-brand-deep dark:text-brand/85">{p.filePath}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">{p.description}</p>

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-2 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          {t("Lihat perubahan", "View changes")}
          <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">+{added}</span>
          <span className="font-mono text-[10px] text-rose-500 dark:text-rose-400">-{removed}</span>
        </button>
        {open && (
          <div className="mt-1.5">
            <DiffBlock diff={p.diffText} />
          </div>
        )}

        {/* keputusan / aksi */}
        {p.status === "MENUNGGU" ? (
          canDecide ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="h-7 gap-1.5 bg-emerald-600 text-[11px] text-white hover:bg-emerald-700"
                onClick={() => onReview(p)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {t("Setujui & Terapkan", "Approve & Apply")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-[11px] text-rose-600 hover:text-rose-700 dark:text-rose-400"
                onClick={() => onReview(p)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                {t("Tolak", "Reject")}
              </Button>
            </div>
          ) : (
            <p className="mt-2 text-[10.5px] text-slate-400 dark:text-slate-500">
              {t(
                "Menunggu tinjauan developer — file belum diubah sama sekali.",
                "Awaiting developer review — the file has not been changed at all.",
              )}
            </p>
          )
        ) : (
          <p className="mt-2 text-[10.5px] text-slate-400 dark:text-slate-500">
            {p.decidedByName
              ? `${t("Diputuskan oleh", "Decided by")} ${p.decidedByName}${p.decidedAt ? ` · ${fmtStamp(p.decidedAt, locale)}` : ""}`
              : t("Sudah diputuskan", "Decided")}
            {p.decisionNote ? ` — “${p.decisionNote}”` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------- entry modul ----------
export function SupportModule({ view }: { view: string }) {
  // Fase P1: satu-satunya menu adalah "service" (Support Service);
  // view lain (riwayat/analitik) menyusul di fase berikutnya.
  void view;
  return <SupportServiceView />;
}

function SupportServiceView() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const canManage = perms.canOp("support", "service", "manage");
  const accentId = useAccentTheme((s) => s.accent);
  const accent = ACCENT_THEMES.find((x) => x.id === accentId)?.hex ?? "#10b981";
  const loc = locale || "id-ID";

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [creating, setCreating] = useState(false);

  const ticketsApi = useApi<{ tickets: TicketRow[] }>(
    `/api/rekankerja/support/tickets${scope === "all" ? "?scope=all" : ""}`,
    [scope],
  );
  const ticketApi = useApi<{ ticket: TicketRow }>(
    selectedId ? `/api/rekankerja/support/tickets/${selectedId}` : null,
    [selectedId],
  );
  const msgApi = useApi<{ messages: MessageRow[] }>(
    selectedId ? `/api/rekankerja/support/tickets/${selectedId}/messages` : null,
    [selectedId],
  );
  // FEAT-SUPPORT-P4 — usulan patch pada tiket terpilih (+ izin memutuskan).
  const patchesApi = useApi<{ patches: PatchRow[]; canDecide: boolean }>(
    selectedId ? `/api/rekankerja/support/tickets/${selectedId}/patches` : null,
    [selectedId],
  );

  // composer
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  // P4 — dialog tinjauan usulan patch (developer)
  const [review, setReview] = useState<PatchRow | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ticket = ticketApi.data?.ticket ?? null;
  const busy = sending || aiBusy;

  // autoscroll ke pesan terbaru
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [msgApi.data, aiBusy]);

  // polling ringan (15 dtk) — hanya saat chat terbuka & tidak sedang sibuk
  useEffect(() => {
    if (!selectedId) return;
    const h = window.setInterval(() => {
      if (!sending && !aiBusy) {
        void msgApi.refresh();
        void patchesApi.refresh();
      }
    }, 15000);
    return () => window.clearInterval(h);
  }, [selectedId, sending, aiBusy, msgApi, patchesApi]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ticketsApi.data?.tickets ?? [];
    if (!q) return list;
    return list.filter(
      (tk) =>
        tk.ticketNo.toLowerCase().includes(q) ||
        tk.subject.toLowerCase().includes(q) ||
        (tk.createdByName ?? "").toLowerCase().includes(q),
    );
  }, [ticketsApi.data, search]);

  const refreshAll = useCallback(() => {
    void ticketsApi.refresh();
    void ticketApi.refresh();
    void msgApi.refresh();
    void patchesApi.refresh();
  }, [ticketsApi, ticketApi, msgApi, patchesApi]);

  const createTicket = useCallback(async () => {
    const s = subject.trim();
    if (s.length < 5) {
      toast.error(t("Judul percakapan minimal 5 karakter", "Conversation title is at least 5 characters"));
      return;
    }
    setCreating(true);
    try {
      const r = await apiSend<{ ticket: TicketRow }>("/api/rekankerja/support/tickets", "POST", { subject: s });
      setNewOpen(false);
      setSubject("");
      setSelectedId(r.ticket.id);
      refreshAll();
      toast.success(t("Percakapan dibuat", "Conversation created"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  }, [subject, t, refreshAll]);

  const pickFiles = useCallback(
    (list: FileList | null) => {
      if (!list) return;
      const next = [...files];
      for (const f of Array.from(list)) {
        if (next.length >= MAX_FILES) {
          toast.error(t("Jumlah lampiran maksimum 5 file per pesan", "Maximum 5 attachments per message"));
          break;
        }
        const mime = f.type || "";
        if (!ACCEPTED_MIME.includes(mime)) {
          toast.error(
            t(`Jenis file tidak didukung (${f.name}) — hanya JPG/PNG/WEBP/PDF`, `Unsupported file type (${f.name}) — only JPG/PNG/WEBP/PDF`),
          );
          continue;
        }
        if (f.size > MAX_BYTES) {
          toast.error(
            t(`Ukuran file melebihi 5 MB (${f.name})`, `File exceeds 5 MB (${f.name})`),
          );
          continue;
        }
        next.push(f);
      }
      setFiles(next);
    },
    [files, t],
  );

  const runAgent = useCallback(async () => {
    if (!selectedId) return;
    setAgentError(null);
    setAiBusy(true);
    try {
      await apiSend(`/api/rekankerja/support/tickets/${selectedId}/agent`, "POST");
      refreshAll();
    } catch (e) {
      setAgentError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }, [selectedId, refreshAll]);

  const send = useCallback(async () => {
    if (!selectedId || busy) return;
    const body = draft.trim();
    if (!body) return; // aturan server: pesan wajib berisi teks
    const form = new FormData();
    form.set("body", body);
    for (const f of files) form.append("files", f);
    setSending(true);
    setAgentError(null);
    try {
      await apiUpload(`/api/rekankerja/support/tickets/${selectedId}/messages`, form);
      setDraft("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refreshAll();
      setSending(false);
      await runAgent();
    } catch (e) {
      setSending(false);
      toast.error((e as Error).message);
    }
  }, [selectedId, busy, draft, files, refreshAll, runAgent]);

  const changeStatus = useCallback(
    async (status: string) => {
      if (!selectedId) return;
      try {
        await apiSend(`/api/rekankerja/support/tickets/${selectedId}`, "PATCH", { status });
        refreshAll();
        toast.success(t("Status percakapan diperbarui", "Conversation status updated"));
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [selectedId, refreshAll, t],
  );

  // P4 — keputusan developer atas usulan patch (approve → file diterapkan).
  const decidePatch = useCallback(
    async (decision: "approve" | "reject") => {
      if (!selectedId || !review) return;
      setDeciding(true);
      try {
        await apiSend(`/api/rekankerja/support/tickets/${selectedId}/patches`, "POST", {
          proposalId: review.id,
          decision,
          ...(reviewNote.trim() ? { note: reviewNote.trim() } : {}),
        });
        setReview(null);
        setReviewNote("");
        void patchesApi.refresh();
        void msgApi.refresh();
        toast.success(
          decision === "approve"
            ? t("Patch disetujui & diterapkan ke file", "Patch approved & applied to file")
            : t("Usulan patch ditolak", "Patch proposal rejected"),
        );
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setDeciding(false);
      }
    },
    [selectedId, review, reviewNote, patchesApi, msgApi, t],
  );

  // timeline gabungan: pesan + kartu usulan patch, urut waktu.
  const timeline = useMemo(() => {
    const msgs = (msgApi.data?.messages ?? []).map((m) => ({ kind: "msg" as const, at: m.createdAt, m }));
    const pts = (patchesApi.data?.patches ?? []).map((p) => ({ kind: "patch" as const, at: p.createdAt, p }));
    return [...msgs, ...pts].sort((a, b) =>
      a.at < b.at ? -1 : a.at > b.at ? 1 : a.kind === "msg" ? -1 : 1,
    );
  }, [msgApi.data, patchesApi.data]);
  const canDecide = patchesApi.data?.canDecide ?? false;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL ONLINE SUPPORT", "ONLINE SUPPORT MODULE")}
        title={t("Support Service", "Support Service")}
        description={t(
          "Chat langsung dengan tim support AI — kendala, pertanyaan, atau laporan bug ditangani layaknya tiket: bisa dilampiri tangkapan layar/dokumen, terlacak statusnya, dan dipantau kapan pun.",
          "Chat directly with the AI support team — issues, questions, or bug reports handled ticket-style: attach screenshots/documents, trackable status, available anytime.",
        )}
        actions={
          <Button onClick={() => setNewOpen(true)} className="gap-1.5 text-white shadow-sm" style={{ background: accent }}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("Percakapan Baru", "New Conversation")}
          </Button>
        }
      />

      <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        {/* ============ daftar tiket ============ */}
        <aside
          className={cn(
            "flex max-h-[calc(100vh-230px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900",
            selectedId && "hidden lg:flex",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 px-3 py-2.5 dark:border-slate-800/70">
            {canManage ? (
              <div className="flex rounded-lg border border-slate-200 p-0.5 text-[11px] dark:border-slate-700" role="tablist" aria-label={t("Lingkup daftar tiket", "Ticket list scope")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === "mine"}
                  onClick={() => { setScope("mine"); }}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-semibold transition",
                    scope === "mine"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
                  )}
                >
                  {t("Milik Saya", "Mine")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={scope === "all"}
                  onClick={() => { setScope("all"); }}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-semibold transition",
                    scope === "all"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
                  )}
                >
                  {t("Semua Tiket", "All Tickets")}
                </button>
              </div>
            ) : (
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("Percakapan Saya", "My Conversations")}</span>
            )}
            <span className="text-[11px] text-slate-400">{filtered.length}</span>
          </div>

          <div className="border-b border-slate-200/70 p-2 dark:border-slate-800/70">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Cari no. tiket / judul…", "Search ticket no. / subject…")}
                className="h-8 pl-8 text-xs"
                aria-label={t("Cari percakapan", "Search conversations")}
              />
            </div>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {ticketsApi.loading ? (
              <LoadingRows rows={4} />
            ) : ticketsApi.error ? (
              <EmptyState title={t("Gagal memuat", "Failed to load")} description={ticketsApi.error} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={Headset}
                title={t("Belum ada percakapan", "No conversations yet")}
                description={t(
                  "Mulai percakapan pertama Anda — tim support AI siap membantu.",
                  "Start your first conversation — the AI support team is ready to help.",
                )}
              />
            ) : (
              filtered.map((tk) => {
                const st = STATUS_UI[tk.status] ?? STATUS_UI.AKTIF;
                return (
                  <button
                    key={tk.id}
                    type="button"
                    onClick={() => setSelectedId(tk.id)}
                    aria-current={selectedId === tk.id}
                    className={cn(
                      "w-full rounded-xl border p-2.5 text-left transition",
                      selectedId === tk.id
                        ? "border-brand/40 bg-brand/5 dark:border-brand/30 dark:bg-brand/10"
                        : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/60",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10.5px] font-semibold text-slate-400">{tk.ticketNo}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{fmtStamp(tk.lastMessageAt, loc)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-800 dark:text-slate-200">{tk.subject}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", st.dot)} aria-hidden />
                      {t(st.id, st.en)}
                      <PriorityBadge priority={tk.priority} />
                      <CategoryBadge category={tk.category} />
                      {scope === "all" && tk.createdByName && (
                        <span className="truncate text-[10px] text-slate-400">· {tk.createdByName}</span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ============ utas chat ============ */}
        <section
          className={cn(
            "flex max-h-[calc(100vh-230px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900",
            !selectedId && "hidden lg:flex",
          )}
        >
          {ticketApi.loading || msgApi.loading ? (
            <div className="flex-1 p-4"><LoadingRows rows={6} /></div>
          ) : !ticket ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand-deep dark:text-brand/85">
                <Headset className="h-7 w-7" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {t("Pilih percakapan di samping", "Pick a conversation")}
              </p>
              <p className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t(
                  "Atau mulai percakapan baru — ceritakan kendala Anda, lampirkan tangkapan layar bila perlu, dan tim support AI akan langsung menangani.",
                  "Or start a new one — describe your issue, attach screenshots if needed, and the AI support team will handle it right away.",
                )}
              </p>
              <Button onClick={() => setNewOpen(true)} variant="outline" size="sm" className="mt-1 gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("Percakapan Baru", "New Conversation")}
              </Button>
            </div>
          ) : (
            <>
              {/* header utas */}
              <div className="flex items-start gap-2 border-b border-slate-200/70 p-3 dark:border-slate-800/70 sm:p-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 lg:hidden"
                  onClick={() => setSelectedId(null)}
                  aria-label={t("Kembali ke daftar", "Back to list")}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] font-semibold text-slate-400">{ticket.ticketNo}</span>
                    <StatusBadge status={ticket.status} />
                    <PriorityBadge priority={ticket.priority} />
                    <CategoryBadge category={ticket.category} />
                  </div>
                  <h2 className="mt-0.5 truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100" title={ticket.subject}>
                    {ticket.subject}
                  </h2>
                  {scope === "all" && (
                    <p className="text-[11px] text-slate-400">
                      {t("oleh", "by")} {ticket.createdByName ?? "—"}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {ticket.status === "AKTIF" && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => changeStatus("SELESAI")}>
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      <span className="hidden sm:inline">{t("Tandai Selesai", "Mark Resolved")}</span>
                      <span className="sm:hidden">{t("Selesai", "Resolved")}</span>
                    </Button>
                  )}
                  {(ticket.status === "AKTIF" || ticket.status === "SELESAI") && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => changeStatus("DITUTUP")}>
                      <X className="h-3.5 w-3.5" aria-hidden />
                      <span className="hidden sm:inline">{t("Tutup", "Close")}</span>
                    </Button>
                  )}
                  {(ticket.status === "SELESAI" || ticket.status === "DITUTUP") && (
                    <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => changeStatus("AKTIF")}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      <span className="hidden sm:inline">{t("Buka Kembali", "Reopen")}</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* pesan + kartu usulan patch (timeline gabungan P4) */}
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite">
                {timeline.map((item) =>
                  item.kind === "msg" ? (
                    <ChatBubble key={item.m.id} m={item.m} locale={loc} accent={accent} />
                  ) : (
                    <PatchCard
                      key={item.p.id}
                      p={item.p}
                      canDecide={canDecide}
                      onReview={setReview}
                      locale={loc}
                    />
                  ),
                )}
                {aiBusy && <TypingDots />}
              </div>

              {/* kegagalan agent + retry */}
              {agentError && (
                <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" role="alert">
                  <span className="min-w-0">
                    {t("AI support gagal menjawab", "AI support failed to answer")}: <span className="font-medium">{agentError}</span>
                  </span>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={runAgent} disabled={aiBusy}>
                    <RotateCcw className="h-3 w-3" aria-hidden />
                    {t("Coba Lagi", "Retry")}
                  </Button>
                </div>
              )}

              {/* composer */}
              {ticket.status === "DITUTUP" ? (
                <div className="border-t border-slate-200/70 p-4 text-center dark:border-slate-800/70">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t("Percakapan ditutup — buka kembali untuk melanjutkan.", "This conversation is closed — reopen it to continue.")}
                  </p>
                  <Button size="sm" variant="outline" className="mt-2 gap-1.5 text-xs" onClick={() => changeStatus("AKTIF")}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    {t("Buka Kembali", "Reopen")}
                  </Button>
                </div>
              ) : (
                <div className="border-t border-slate-200/70 p-3 dark:border-slate-800/70">
                  {files.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {files.map((f, i) => (
                        <span
                          key={`${f.name}-${i}`}
                          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-2 pr-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {f.type.startsWith("image/") ? (
                            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-rose-500" aria-hidden />
                          )}
                          <span className="truncate font-medium">{f.name}</span>
                          <span className="shrink-0 text-slate-400">{fmtSize(f.size)}</span>
                          <button
                            type="button"
                            onClick={() => setFiles(files.filter((_, j) => j !== i))}
                            className="ml-0.5 shrink-0 rounded p-0.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            aria-label={t("Hapus lampiran", "Remove attachment")}
                          >
                            <X className="h-3 w-3" aria-hidden />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <form
                    className="flex items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        pickFiles(e.target.files);
                        e.target.value = "";
                      }}
                      aria-hidden
                      tabIndex={-1}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-slate-500"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                      aria-label={t("Lampirkan berkas", "Attach file")}
                      title={t("Lampirkan gambar / dokumen (maks 5 MB)", "Attach image / document (max 5 MB)")}
                    >
                      <Paperclip className="h-4 w-4" aria-hidden />
                    </Button>
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={2}
                      maxLength={4000}
                      placeholder={t("Tulis pesan Anda… (Enter kirim, Shift+Enter baris baru)", "Write your message… (Enter to send, Shift+Enter for a new line)")}
                      className="max-h-32 min-h-[44px] resize-none text-[13px]"
                      disabled={busy}
                      aria-label={t("Pesan", "Message")}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      className="h-10 w-10 shrink-0 text-white shadow-sm"
                      style={{ background: accent }}
                      disabled={busy || !draft.trim()}
                      aria-label={t("Kirim", "Send")}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    </Button>
                  </form>
                  <p className="mt-1.5 text-[10.5px] text-slate-400 dark:text-slate-500">
                    {t(
                      "Lampiran: JPG/PNG/WEBP/PDF, maks 5 MB per file, 5 file per pesan.",
                      "Attachments: JPG/PNG/WEBP/PDF, max 5 MB per file, 5 files per message.",
                    )}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {/* ============ dialog percakapan baru ============ */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Percakapan Baru", "New Conversation")}</DialogTitle>
            <DialogDescription>
              {t(
                "Beri judul singkat — setelah tiket dibuat, langsung ceritakan kendala Anda di chat.",
                "Give it a short title — once the ticket is created, describe your issue in the chat.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="sp-subject">{t("Judul", "Title")}</Label>
            <Input
              id="sp-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
              placeholder={t("Mis. Gagal menyimpan data karyawan", "E.g. Failed to save employee data")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createTicket();
                }
              }}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("Judul percakapan minimal 5 karakter", "Conversation title is at least 5 characters")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={creating}>
              {t("Batal", "Cancel")}
            </Button>
            <Button onClick={() => void createTicket()} disabled={creating} className="gap-1.5 text-white" style={{ background: accent }}>
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t("Buat Tiket", "Create Ticket")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ dialog tinjau usulan patch (P4 — developer) ============ */}
      <Dialog
        open={!!review}
        onOpenChange={(o) => {
          if (!o) {
            setReview(null);
            setReviewNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Tinjau Usulan Patch", "Review Patch Proposal")}</DialogTitle>
            <DialogDescription>
              {t(
                "Menyetujui akan MENERAPKAN perubahan ini langsung ke file aplikasi. Pastikan Anda memahami diff di bawah.",
                "Approving will APPLY these changes directly to the application file. Make sure you understand the diff below.",
              )}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="space-y-2.5">
              <p className="break-all rounded-lg bg-slate-50 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                {review.filePath}
              </p>
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{review.description}</p>
              <DiffBlock diff={review.diffText} maxH="max-h-60" />
              <div className="space-y-1.5">
                <Label htmlFor="sp-patch-note">{t("Catatan keputusan (opsional)", "Decision note (optional)")}</Label>
                <Textarea
                  id="sp-patch-note"
                  rows={2}
                  maxLength={500}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder={t("Mis. Sudah saya verifikasi di lingkungan uji", "E.g. Verified in the test environment")}
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="gap-1.5 text-rose-600 hover:text-rose-700 dark:text-rose-400"
              onClick={() => void decidePatch("reject")}
              disabled={deciding}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              {t("Tolak Usulan", "Reject Proposal")}
            </Button>
            <Button
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void decidePatch("approve")}
              disabled={deciding}
            >
              {deciding ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
              {t("Setujui & Terapkan", "Approve & Apply")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
