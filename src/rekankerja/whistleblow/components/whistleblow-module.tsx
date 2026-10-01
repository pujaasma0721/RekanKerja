"use client";
// Task 52-f — modul Whistleblowing (TPKS UU 12/2022):
//   · view "report"  → form laporan (semua pengguna; PUBLIC_MENU_KEYS).
//   · view "triage"  → kelola laporan (guard whistleblowing:triage): daftar,
//     filter status/kategori, detail (kronologi/penangan), alur status
//     Baru → Diterima → Investigasi → Selesai|Ditutup, penugasan penangan.
import { useState } from "react";
import { Loader2, Siren, ClipboardCheck, ShieldCheck, EyeOff, UserRound, MapPin, CalendarDays, Send, X, CheckCircle2, Ban, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { WB_CATEGORIES, WhistleblowForm } from "./whistleblow-form";
import { useNav } from "@/rekankerja/shared/lib/store";

interface ReportRow {
  id: string; ticketNo: string; category: string; channel: string; description: string;
  incidentDate: string | null; location: string | null; involvedHint: string | null;
  anonymous: boolean; reporterEmployeeId: string | null; reporterContact: string | null;
  status: string; assignedToId: string | null; assignedToName: string | null;
  reporterName: string | null; followUpNote: string | null; resolutionNote: string | null;
  createdAt: string; updatedAt: string;
}
interface TriageData {
  reports: ReportRow[];
  stats: { byStatus: Record<string, number>; byCategory: Record<string, number>; total: number };
  handlers: { id: string; label: string; role: string }[];
}

const STATUS_META: Record<string, { id: string; en: string; cls: string }> = {
  Baru: { id: "Baru", en: "New", cls: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25" },
  Diterima: { id: "Diterima", en: "Received", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25" },
  Investigasi: { id: "Investigasi", en: "Investigating", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25" },
  Selesai: { id: "Selesai", en: "Resolved", cls: "bg-brand/10 text-brand-deep border-brand/25 dark:bg-brand/10 dark:text-brand/85 dark:border-brand/25" },
  Ditutup: { id: "Ditutup", en: "Closed", cls: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25" },
};

const catLabel = (v: string) => WB_CATEGORIES.find((c) => c.value === v)?.id ?? v;

export function WhistleblowModule({ view }: { view: string }) {
  if (view === "triage") return <TriagePage />;
  return <ReportPage />;
}

// ============ view "report" — form (semua pengguna) ============
function ReportPage() {
  const { t } = useI18n();
  const { navigate } = useNav();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={t("MODUL WHISTLEBLOWING", "WHISTLEBLOWING MODULE")}
        title={t("Laporkan Pelanggaran", "Report a Violation")}
        description={t(
          "Kanal resmi pelaporan kekerasan seksual & pelanggaran di tempat kerja (UU 12/2022). Laporan ditangani tim yang berwenang — pelapor anonim dilindungi undang-undang.",
          "Official channel for reporting sexual violence & workplace violations (Law 12/2022). Reports are handled by the authorized team — anonymous reporters are protected by law.",
        )}
      />
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <WhistleblowForm />
      </div>
      <button
        onClick={() => navigate("whistleblowing", "triage")}
        className="mx-auto mt-4 flex items-center gap-1.5 text-[11px] font-bold text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline dark:hover:text-slate-300"
      >
        <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />
        {t("Anggota tim penangan? Buka Kelola Laporan", "Handling team member? Open Report Management")}
      </button>
    </div>
  );
}

// ============ view "triage" — kelola laporan ============
function TriagePage() {
  const { t } = useI18n();
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const triage = useApi<TriageData>(
    `/api/rekankerja/whistleblowing/reports?status=${status}&category=${category}`,
    [status, category],
  );
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [actBusy, setActBusy] = useState(false);
  const [note, setNote] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [resolution, setResolution] = useState("");

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!selected) return;
    setActBusy(true);
    try {
      const res = await apiSend<{ report: ReportRow }>("/api/rekankerja/whistleblowing/reports", "PATCH", {
        id: selected.id, action, ...extra,
      });
      toast.success(t("Laporan {ticket} diperbarui", "Report {ticket} updated", { ticket: selected.ticketNo }));
      setNote("");
      setResolution("");
      setAssignTo("");
      // baris terpilih diperbarui dari respons PATCH (status/note terbaru);
      // reporterName/assignedToName dipertahankan dari state lama.
      setSelected((prev) => (prev ? { ...prev, ...res.report, reporterName: prev.reporterName, assignedToName: prev.assignedToName } : prev));
      triage.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setActBusy(false);
    }
  };

  const rows = (triage.data?.reports ?? []).filter(
    (r) => !q.trim() || r.ticketNo.toLowerCase().includes(q.toLowerCase()) || r.description.toLowerCase().includes(q.toLowerCase()),
  );
  const stats = triage.data?.stats;

  return (
    <div>
      <PageHeader
        eyebrow={t("MODUL WHISTLEBLOWING", "WHISTLEBLOWING MODULE")}
        title={t("Kelola Laporan Whistleblowing", "Whistleblowing Report Management")}
        description={t(
          "Triase & penanganan laporan pelanggaran/TPKS — alur Baru → Diterima → Investigasi → Selesai/Ditutup; setiap keputusan tercatat di log aktivitas.",
          "Triage & handling of violation/SVA reports — flow New → Received → Investigating → Resolved/Closed; every decision is recorded in the activity log.",
        )}
        actions={
          <Badge variant="outline" className="gap-1.5 border-rose-200 font-mono text-[10px] text-rose-700 dark:border-rose-500/30 dark:text-rose-400">
            <Siren className="h-3 w-3" aria-hidden /> {stats?.total ?? 0} {t("total", "total")}
          </Badge>
        }
      />

      {/* statistik status */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Object.keys(STATUS_META).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? "all" : s)}
            className={`rounded-xl border p-3 text-left transition-colors ${status === s ? "border-slate-400 dark:border-slate-500" : "border-slate-200/80 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"} bg-white dark:bg-slate-900`}
          >
            <p className="text-lg font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{stats?.byStatus?.[s] ?? 0}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t(STATUS_META[s].id, STATUS_META[s].en)}</p>
          </button>
        ))}
      </div>

      {/* filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="h-8 pl-8 text-xs" placeholder={t("cari no. tiket / isi laporan…", "search ticket no. / report content…")} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua Status", "All Statuses")}</SelectItem>
            {Object.keys(STATUS_META).map((s) => (
              <SelectItem key={s} value={s}>{t(STATUS_META[s].id, STATUS_META[s].en)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("Semua Kategori", "All Categories")}</SelectItem>
            {WB_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>{t(c.id, c.en)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {triage.loading && !triage.data ? (
        <LoadingRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Belum ada laporan", "No reports yet")}
          description={t("Kanal bersih — laporan baru dari karyawan akan muncul di sini.", "The channel is clean — new staff reports will appear here.")}
          icon={ShieldCheck}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
          <div className="max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50/95 backdrop-blur dark:bg-slate-900/95">
                <tr>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Tiket", "Ticket")}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Kategori", "Category")}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Masuk", "Received")}</th>
                  <th className="px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Pelapor", "Reporter")}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Penangan", "Handler")}</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-slate-400">{t("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-900/60"
                  >
                    <td className="px-3 py-2 font-mono font-bold text-slate-700 dark:text-slate-200">{r.ticketNo}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{t(catLabel(r.category), WB_CATEGORIES.find((c) => c.value === r.category)?.en ?? r.category)}</td>
                    <td className="px-3 py-2 text-slate-400">{new Date(r.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                    <td className="px-3 py-2 text-center">
                      {r.anonymous ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"><EyeOff className="h-3 w-3" aria-hidden /> {t("Anonim", "Anonymous")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300"><UserRound className="h-3 w-3" aria-hidden /> {r.reporterName ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.assignedToName ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_META[r.status]?.cls ?? ""}`}>
                        {t(STATUS_META[r.status]?.id ?? r.status, STATUS_META[r.status]?.en ?? r.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* dialog detail + aksi */}
      <Dialog open={selected != null} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-sm">
                  <Siren className="h-4 w-4 text-rose-600" aria-hidden />
                  <span className="font-mono">{selected.ticketNo}</span>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_META[selected.status]?.cls ?? ""}`}>
                    {t(STATUS_META[selected.status]?.id ?? selected.status, STATUS_META[selected.status]?.en ?? selected.status)}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  {t(catLabel(selected.category), WB_CATEGORIES.find((c) => c.value === selected.category)?.en ?? selected.category)}
                  {" · "}
                  {selected.anonymous ? t("pelapor anonim (identitas tidak tersimpan)", "anonymous reporter (identity not stored)") : selected.reporterName ?? t("pelapor teridentifikasi", "identified reporter")}
                  {selected.reporterContact ? ` · ${t("kontak", "contact")}: ${selected.reporterContact}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {/* meta kejadian */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden /> {selected.incidentDate ? new Date(selected.incidentDate).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : t("tanpa tanggal", "no date")}</span>
                  {selected.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden /> {selected.location}</span>}
                  <span className="flex items-center gap-1">{t("kanal", "channel")}: {selected.channel}</span>
                </div>

                {/* kronologi */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Kronologi Laporan", "Report Narrative")}</p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-200">{selected.description}</p>
                  {selected.involvedHint && (
                    <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400"><b>{t("Pihak terlibat:", "Involved parties:")}</b> {selected.involvedHint}</p>
                  )}
                </div>

                {(selected.followUpNote || selected.resolutionNote) && (
                  <div className="space-y-1 rounded-xl border border-brand/25 bg-brand/10/50 p-3 text-[11px] dark:border-brand/25 dark:bg-brand/10 dark:text-brand/75">
                    {selected.followUpNote && <p><b>{t("Catatan tindak lanjut:", "Follow-up note:")}</b> {selected.followUpNote}</p>}
                    {selected.resolutionNote && <p><b>{t("Hasil:", "Resolution:")}</b> {selected.resolutionNote}</p>}
                  </div>
                )}

                {/* aksi sesuai status */}
                {selected.status !== "Selesai" && selected.status !== "Ditutup" ? (
                  <div className="space-y-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{t("Tindakan Penanganan", "Handling Actions")}</p>

                    {/* penugasan */}
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold">{t("Tugaskan penangan", "Assign handler")}</Label>
                        <Select value={assignTo} onValueChange={setAssignTo}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("pilih penanggung jawab…", "pick responsible…")} /></SelectTrigger>
                          <SelectContent className="max-h-48">
                            {(triage.data?.handlers ?? []).map((h) => (
                              <SelectItem key={h.id} value={h.id}>{h.label} · {h.role}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-bold" disabled={!assignTo || actBusy} onClick={() => run("assign", { assignedToId: assignTo })}>
                        {actBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {t("Tugaskan", "Assign")}
                      </Button>
                    </div>

                    {/* catatan tindak lanjut */}
                    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-bold">{t("Catatan tindak lanjut", "Follow-up note")}</Label>
                        <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-8 text-xs" placeholder={t("opsional — progres penanganan", "optional — handling progress")} />
                      </div>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-bold" disabled={!note.trim() || actBusy} onClick={() => run("note", { note })}>
                        {t("Simpan Catatan", "Save Note")}
                      </Button>
                    </div>

                    {/* alur status */}
                    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      {selected.status === "Baru" && (
                        <Button size="sm" className="h-8 gap-1.5 text-xs font-bold" disabled={actBusy} onClick={() => run("receive")}>
                          {actBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {t("Terima Laporan", "Receive Report")}
                        </Button>
                      )}
                      {selected.status === "Diterima" && (
                        <Button size="sm" className="h-8 gap-1.5 text-xs font-bold" disabled={actBusy} onClick={() => run("investigate")}>
                          {t("Mulai Investigasi", "Start Investigation")}
                        </Button>
                      )}
                      {selected.status === "Investigasi" && (
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
                          <div className="flex-1 space-y-1.5">
                            <Label className="text-[11px] font-bold">{t("Hasil penyelesaian *", "Resolution *")}</Label>
                            <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} className="min-h-16 text-xs" placeholder={t("tindakan yang diambil, sanksi/putusan, perbaikan proses…", "actions taken, sanctions/decisions, process improvements…")} />
                          </div>
                          <Button size="sm" className="h-8 gap-1.5 text-xs font-bold" disabled={resolution.trim().length < 10 || actBusy} onClick={() => run("resolve", { resolutionNote: resolution })}>
                            <CheckCircle2 className="h-3.5 w-3.5" /> {t("Selesaikan", "Resolve")}
                          </Button>
                        </div>
                      )}
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-bold" disabled={actBusy || selected.status === "Baru"} onClick={() => run("close", { note: note || resolution })} title={selected.status === "Baru" ? t("Terima laporan dulu", "Receive the report first") : undefined}>
                        <Ban className="h-3.5 w-3.5" /> {t("Tutup tanpa tindak lanjut", "Close without action")}
                      </Button>
                    </div>
                    {selected.status === "Baru" && (
                      <p className="text-[10px] text-slate-400">
                        <X className="mr-1 inline h-3 w-3" aria-hidden />
                        {t("Penutupan membutuhkan laporan diterima + alasan ≥ 10 karakter (di kolom catatan).", "Closing requires the report to be received + reason ≥ 10 characters (in the note field).")}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-brand/25 bg-brand/10/60 p-3 text-[11px] text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85">
                    {t("Laporan telah selesai ditangani/ditutup — dokumen hanya-baca.", "This report has been resolved/closed — read-only record.")}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
