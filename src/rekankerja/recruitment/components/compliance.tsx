"use client";
// RekanKerja Recruitment F9 — view "Kepatuhan" (recruitment:compliance):
//   · Permintaan Subjek Data (DSR) — hak akses/ekspor/hapus UU PDP Pasal 7–9,
//     SLA 7 hari, alur New → InProgress → Completed/Rejected + paket data JSON.
//   · Ledger Consent — catatan pemberian/penarikan consent + catat penarikan
//     (efek: keluar dari saran talent pool / silver medalist).
//   · Retensi Data — konfigurasi bulan retensi + anonimisasi aktif/dry-run
//     + jalankan siklus retensi sekarang (hasil ringkas).
//   · Audit Akses PII — log siapa membuka data pribadi pelamar kapan + CSV.
// Kontrak API: src/rekankerja/recruitment/api/compliance.ts (F9-BACKEND) —
// GET ?section=dsr|consents|retention|audit + ?dsr-package=<id> + ?export=audit
// + POST dsr-create|dsr-progress|dsr-complete|dsr-reject|consent-withdraw
//        |retention-config|retention-run. Tipe mirror serializer — komponen
// client tidak meng-import file service.
import { useEffect, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock, Download, Eraser, FileSearch, Info,
  PlayCircle, PlusCircle, ShieldCheck, UserRoundX, XCircle,
} from "lucide-react";

export const COMPLIANCE_API = "/api/rekankerja/recruitment/compliance";
const APPLICANTS_LIST_API = "/api/rekankerja/recruitment/applicants";

// ============ tipe (mirror JSON API F9) ============

interface DsrRow {
  id: string;
  type: string; // Access | Export | Erase
  status: string; // New | InProgress | Completed | Rejected
  note: string | null;
  dueAt: string;
  createdAt: string;
  handledAt: string | null;
  resultNote: string | null;
  applicantId: string;
  applicantNo: string;
  applicantName: string;
  handlerName: string | null;
  overdue: boolean;
}

interface ConsentRow {
  id: string;
  applicantId: string | null;
  applicantNo: string | null;
  applicantName: string | null;
  purpose: string; // recruitment | talent-pool | …
  version: string;
  grantedAt: string;
  withdrawnAt: string | null;
  channel: string; // manual | public-form
  note: string | null;
}

interface RetentionOverview {
  settings: { "retention.months.rejected": string; "retention.months.outdated": string; "retention.anonymize": string };
  lastRun: { at: string; detail: string } | null;
  stats: { rejected: number; outdated: number; anonymized: number; dueForRetention: number; heldByConsent: number };
}

interface PiiAuditRow {
  id: string;
  createdAt: string;
  employeeId: string | null;
  employeeName: string | null;
  applicantNo: string | null;
  what: string | null;
}

interface RetentionResult {
  scanned: number;
  anonymized: number;
  skippedConsent: number;
  dryRun: boolean;
}

/** Opsi pelamar utk dialog DSR baru (list topeng — tanpa PII). */
interface ApplicantOption {
  id: string;
  applicantNo: string;
  fullName: string;
  status: string;
}

// ============ label dwibahasa ============

const DSR_TYPES: { key: string; label: string; labelEn: string; tone: string }[] = [
  { key: "Access", label: "Akses Data", labelEn: "Access", tone: "slate" },
  { key: "Export", label: "Ekspor Data", labelEn: "Export", tone: "amber" },
  { key: "Erase", label: "Hapus Data", labelEn: "Erase", tone: "rose" },
];

const DSR_STATUSES: { key: string; label: string; labelEn: string; tone: string }[] = [
  { key: "New", label: "Baru", labelEn: "New", tone: "rose" },
  { key: "InProgress", label: "Diproses", labelEn: "In Progress", tone: "amber" },
  { key: "Completed", label: "Selesai", labelEn: "Completed", tone: "emerald" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected", tone: "zinc" },
];

const TONE_CLS: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/25",
  teal: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  zinc: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-500/10 dark:text-zinc-400 dark:border-zinc-500/25",
};
const TONE_DOT: Record<string, string> = {
  emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", teal: "bg-teal-500",
  slate: "bg-slate-400", zinc: "bg-zinc-400",
};

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
      TONE_CLS[tone] ?? TONE_CLS.slate,
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} aria-hidden />
      {children}
    </span>
  );
}

function dsrTypeMeta(key: string, t: (a: string, b?: string) => string) {
  const m = DSR_TYPES.find((x) => x.key === key);
  return { tone: m?.tone ?? "slate", label: t(m?.label ?? key, m?.labelEn ?? key) };
}

function dsrStatusMeta(key: string, t: (a: string, b?: string) => string) {
  const m = DSR_STATUSES.find((x) => x.key === key);
  return { tone: m?.tone ?? "zinc", label: t(m?.label ?? key, m?.labelEn ?? key) };
}

/** Purpose consent → label dwibahasa (recruitment / talent-pool / lainnya). */
function purposeMeta(purpose: string, t: (a: string, b?: string) => string): { tone: string; label: string } {
  if (purpose === "talent-pool") return { tone: "teal", label: t("talent pool", "talent pool") };
  if (purpose === "recruitment") return { tone: "slate", label: t("rekrutmen", "recruitment") };
  return { tone: "zinc", label: purpose };
}

/** Kanal pemberian consent → label dwibahasa. */
function channelMeta(channel: string, t: (a: string, b?: string) => string): string {
  if (channel === "manual") return t("manual (HR)", "manual (HR)");
  if (channel === "public-form") return t("form publik", "public form");
  return channel;
}

/** Aktivitas akses PII dari log (mis. "detail-view") → label manusiawi. */
function whatMeta(what: string, t: (a: string, b?: string) => string): string {
  if (what === "detail-view") return t("Melihat detail pelamar (data pribadi penuh)", "Viewed applicant detail (full PII)");
  return what;
}

function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ============ tombol unduh (anchor biasa — cookie sesi ikut) ============

function DownloadAnchor({ href, label, title, small }: { href: string; label: string; title: string; small?: boolean }) {
  return (
    <a
      href={href}
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg font-bold shadow-sm transition",
        small
          ? "h-7 px-2 text-[11px] bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          : "h-9 px-3.5 text-xs bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300",
      )}
    >
      <Download className={small ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden /> {label}
    </a>
  );
}

/** Kotak info kecil (disclaimer / SLA / efek aksi). */
function InfoNote({ icon: Icon, tone, children }: { icon: React.ElementType; tone: "amber" | "teal" | "rose"; children: React.ReactNode }) {
  const toneCls = tone === "amber"
    ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
    : tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
      : "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300";
  return (
    <p className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium", toneCls)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// ============ halaman ============

export function CompliancePage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();

  const [tab, setTab] = useState<string>("dsr");

  // ---------- gating (mirror guard server: op handle/retention/export) ----------
  const canHandle = perms.canOp("recruitment", "compliance", "handle");
  const canRetention = perms.canOp("recruitment", "compliance", "retention");
  const canExport = perms.canOp("recruitment", "compliance", "export");

  // ---------- data (semua seksi dimuat sekali — data demo kecil) ----------
  const dsrApi = useApi<{ list: DsrRow[] }>(`${COMPLIANCE_API}?section=dsr`, []);
  const consentsApi = useApi<{ list: ConsentRow[] }>(`${COMPLIANCE_API}?section=consents`, []);
  const retentionApi = useApi<RetentionOverview>(`${COMPLIANCE_API}?section=retention`, []);
  const auditApi = useApi<{ list: PiiAuditRow[] }>(`${COMPLIANCE_API}?section=audit`, []);

  const dsrs = dsrApi.data?.list ?? null;
  const consents = consentsApi.data?.list ?? null;
  const ret = retentionApi.data ?? null;
  const audit = auditApi.data?.list ?? null;

  // opsi pelamar (list topeng) utk dialog DSR baru — hanya bila boleh handle
  const applicantsApi = useApi<{ rows: ApplicantOption[] }>(
    canHandle ? `${APPLICANTS_LIST_API}?status=all&limit=100&offset=0` : null, [canHandle],
  );
  const applicantOptions = (applicantsApi.data?.rows ?? []).filter((a) => a.status !== "Anonymized");

  // ---------- dialog & busy state ----------
  const [newOpen, setNewOpen] = useState(false);
  const [newApplicantId, setNewApplicantId] = useState("");
  const [newType, setNewType] = useState("Access");
  const [newNote, setNewNote] = useState("");
  const [busyNew, setBusyNew] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<DsrRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [busyReject, setBusyReject] = useState(false);

  const [eraseTarget, setEraseTarget] = useState<DsrRow | null>(null);
  const [busyDsr, setBusyDsr] = useState<string | null>(null);

  const [wdTarget, setWdTarget] = useState<ConsentRow | null>(null);
  const [wdNote, setWdNote] = useState("");
  const [busyWd, setBusyWd] = useState(false);

  const [runOpen, setRunOpen] = useState(false);
  const [busyRun, setBusyRun] = useState(false);
  const [runResult, setRunResult] = useState<RetentionResult | null>(null);

  // konfigurasi retensi — state lokal di atas snapshot server
  const [rejMonths, setRejMonths] = useState("");
  const [outMonths, setOutMonths] = useState("");
  const [busyCfg, setBusyCfg] = useState<string | null>(null);
  useEffect(() => {
    if (ret) {
      setRejMonths(ret.settings["retention.months.rejected"]);
      setOutMonths(ret.settings["retention.months.outdated"]);
    }
  }, [ret]);

  // ---------- aksi DSR ----------
  const dsrPackageHref = (id: string) => `${COMPLIANCE_API}?dsr-package=${id}`;

  const doProgress = async (row: DsrRow) => {
    setBusyDsr(`${row.id}:p`);
    try {
      await apiSend(COMPLIANCE_API, "POST", { action: "dsr-progress", id: row.id });
      toast.success(t(
        `DSR ${row.applicantName} mulai ditangani.`, `${row.applicantName}'s DSR is now in progress.`,
      ));
      dsrApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memproses DSR", "Failed to progress the DSR"));
    } finally {
      setBusyDsr(null);
    }
  };

  const doComplete = async (row: DsrRow) => {
    setBusyDsr(`${row.id}:c`);
    try {
      const res = await apiSend<{ type: string; resultNote: string }>(COMPLIANCE_API, "POST", { action: "dsr-complete", id: row.id });
      toast.success(t(`DSR ${row.applicantName} diselesaikan.`, `${row.applicantName}'s DSR completed.`));
      if (res?.resultNote) toast.info(res.resultNote);
      dsrApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyelesaikan DSR", "Failed to complete the DSR"));
    } finally {
      setBusyDsr(null);
    }
  };

  const doReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectNote.trim();
    if (!reason) {
      toast.error(t("Alasan penolakan wajib diisi.", "A rejection reason is required."));
      return;
    }
    setBusyReject(true);
    try {
      await apiSend(COMPLIANCE_API, "POST", { action: "dsr-reject", id: rejectTarget.id, resultNote: reason });
      toast.success(t(`DSR ${rejectTarget.applicantName} ditolak.`, `${rejectTarget.applicantName}'s DSR rejected.`));
      setRejectTarget(null);
      setRejectNote("");
      dsrApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menolak DSR", "Failed to reject the DSR"));
    } finally {
      setBusyReject(false);
    }
  };

  const openNewDsr = () => {
    setNewApplicantId("");
    setNewType("Access");
    setNewNote("");
    setNewOpen(true);
  };

  const doCreate = async () => {
    if (!newApplicantId) {
      toast.error(t("Pilih pelamar dulu.", "Pick an applicant first."));
      return;
    }
    setBusyNew(true);
    try {
      await apiSend(COMPLIANCE_API, "POST", { action: "dsr-create", applicantId: newApplicantId, type: newType, note: newNote.trim() || null });
      const opt = applicantOptions.find((a) => a.id === newApplicantId);
      toast.success(t(
        `Permintaan ${dsrTypeMeta(newType, t).label} utk ${opt?.fullName ?? t("pelamar", "applicant")} dicatat (SLA 7 hari).`,
        `${dsrTypeMeta(newType, t).label} request for ${opt?.fullName ?? t("applicant", "applicant")} recorded (7-day SLA).`,
      ));
      setNewOpen(false);
      dsrApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mencatat DSR", "Failed to create the DSR"));
    } finally {
      setBusyNew(false);
    }
  };

  // ---------- aksi consent ----------
  const doWithdraw = async () => {
    if (!wdTarget) return;
    const note = wdNote.trim();
    if (!note) {
      toast.error(t("Catatan penarikan wajib diisi.", "A withdrawal note is required."));
      return;
    }
    setBusyWd(true);
    try {
      await apiSend(COMPLIANCE_API, "POST", {
        action: "consent-withdraw", applicantId: wdTarget.applicantId ?? "", consentId: wdTarget.id, note,
      });
      toast.success(t(
        `Consent ${purposeMeta(wdTarget.purpose, t).label} milik ${wdTarget.applicantName ?? ""} ditarik.`,
        `${wdTarget.applicantName ?? ""}'s ${purposeMeta(wdTarget.purpose, t).label} consent withdrawn.`,
      ));
      setWdTarget(null);
      setWdNote("");
      consentsApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mencatat penarikan consent", "Failed to record the consent withdrawal"));
    } finally {
      setBusyWd(false);
    }
  };

  // ---------- retensi ----------
  const saveMonths = async (key: "retention.months.rejected" | "retention.months.outdated", value: string) => {
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < 1 || n > 120) {
      toast.error(t("Retensi harus bilangan bulat 1–120 bulan.", "Retention must be an integer of 1–120 months."));
      return;
    }
    setBusyCfg(key);
    try {
      await apiSend(COMPLIANCE_API, "POST", { action: "retention-config", key, value: String(n) });
      toast.success(t(
        key === "retention.months.rejected"
          ? `Retensi pelamar ditolak: ${n} bulan.`
          : `Retensi pelamar kedaluwarsa: ${n} bulan.`,
        key === "retention.months.rejected"
          ? `Rejected applicants retention: ${n} months.`
          : `Outdated applicants retention: ${n} months.`,
      ));
      retentionApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan konfigurasi retensi", "Failed to save the retention config"));
    } finally {
      setBusyCfg(null);
    }
  };

  const toggleAnonymize = async (next: boolean) => {
    setBusyCfg("retention.anonymize");
    try {
      await apiSend(COMPLIANCE_API, "POST", { action: "retention-config", key: "retention.anonymize", value: String(next) });
      toast.success(next
        ? t("Anonimisasi aktif — siklus retensi akan menganonimkan pelamar jatuh tempo.", "Anonymization on — retention cycles will anonymize due applicants.")
        : t("Mode dry-run — siklus retensi hanya menghitung, tanpa mengubah data.", "Dry-run mode — retention cycles only count, nothing is changed."));
      retentionApi.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengubah pengaturan anonimisasi", "Failed to change the anonymization setting"));
    } finally {
      setBusyCfg(null);
    }
  };

  const doRun = async () => {
    setBusyRun(true);
    try {
      const res = await apiSend<{ result: RetentionResult }>(COMPLIANCE_API, "POST", { action: "retention-run" });
      setRunResult(res.result ?? null);
      toast.success(t(
        `Siklus retensi selesai — ${res.result?.scanned ?? 0} dipindai, ${res.result?.anonymized ?? 0} dianonimkan, ${res.result?.skippedConsent ?? 0} ditahan consent.`,
        `Retention cycle done — scanned ${res.result?.scanned ?? 0}, anonymized ${res.result?.anonymized ?? 0}, held by consent ${res.result?.skippedConsent ?? 0}.`,
      ));
      retentionApi.refresh();
      setRunOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menjalankan retensi", "Failed to run the retention cycle"));
    } finally {
      setBusyRun(false);
    }
  };

  // ---------- render ----------

  const errBox = (title: string, error: string | null) => (
    <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
      <CardContent className="pt-6">
        <EmptyState title={title} description={error ?? undefined} />
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · F9")}
        title={t("Kepatuhan UU PDP", "PDP Compliance")}
        description={t(
          "Pemenuhan hak subjek data — permintaan akses/ekspor/hapus (DSR), ledger consent, retensi & anonimisasi, dan audit akses data pribadi pelamar.",
          "Data subject rights fulfilment — access/export/erasure requests (DSR), consent ledger, retention & anonymization, and applicant PII access audit.",
        )}
      />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
          <TabsTrigger value="dsr">{t("Permintaan Subjek Data (DSR)", "Data Subject Requests (DSR)")}</TabsTrigger>
          <TabsTrigger value="consents">{t("Ledger Consent", "Consent Ledger")}</TabsTrigger>
          <TabsTrigger value="retention">{t("Retensi Data", "Data Retention")}</TabsTrigger>
          <TabsTrigger value="audit">{t("Audit Akses PII", "PII Access Audit")}</TabsTrigger>
        </TabsList>

        {/* ==================== TAB: DSR ==================== */}
        <TabsContent value="dsr" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <InfoNote icon={Clock} tone="amber">
              {t(
                "UU PDP Pasal 7–9 — subjek data berhak mengakses, mengekspor, dan meminta penghapusan datanya. SLA penanganan: 7 hari sejak permintaan dicatat.",
                "PDP Law Art. 7–9 — data subjects may access, export, and request erasure of their data. Handling SLA: 7 days from recording.",
              )}
            </InfoNote>
            {canHandle && (
              <Button onClick={openNewDsr} className="shrink-0">
                <PlusCircle className="h-4 w-4" aria-hidden /> {t("Permintaan Baru", "New Request")}
              </Button>
            )}
          </div>

          {dsrApi.loading && !dsrs ? (
            <LoadingRows rows={4} />
          ) : dsrApi.error ? (
            errBox(t("Daftar DSR gagal dimuat", "Failed to load the DSR list"), dsrApi.error)
          ) : !dsrs ? null : dsrs.length === 0 ? (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="pt-6">
                <EmptyState
                  title={t("Belum ada permintaan subjek data", "No data subject requests yet")}
                  description={t(
                    "Permintaan akses/ekspor/hapus dari pelamar akan muncul di sini — atau catat satu lewat tombol “Permintaan Baru”.",
                    "Applicant access/export/erasure requests will appear here — or record one via “New Request”.",
                  )}
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Pelamar", "Applicant")}</TableHead>
                        <TableHead>{t("Tipe", "Type")}</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead>{t("Batas SLA (7 hari)", "SLA Due (7 days)")}</TableHead>
                        <TableHead>{t("Penangani", "Handler")}</TableHead>
                        <TableHead className="min-w-[200px]">{t("Catatan Hasil", "Result Note")}</TableHead>
                        <TableHead className="text-right">{t("Aksi", "Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dsrs.map((r) => {
                        const tm = dsrTypeMeta(r.type, t);
                        const sm = dsrStatusMeta(r.status, t);
                        const pkgEnabled = r.type === "Export" && (r.status === "Completed" || r.status === "New") && canExport;
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <p className="font-semibold text-slate-800 dark:text-slate-200">{r.applicantName}</p>
                              <p className="text-[11px] text-slate-400">{r.applicantNo}</p>
                            </TableCell>
                            <TableCell><Pill tone={tm.tone}>{tm.label}</Pill></TableCell>
                            <TableCell>
                              <span className="flex flex-wrap items-center gap-1.5">
                                <Pill tone={sm.tone}>{sm.label}</Pill>
                                {r.overdue && (
                                  <span className="inline-block whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">
                                    {t("terlambat", "overdue")}
                                  </span>
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{fmtDay(r.dueAt, locale)}</TableCell>
                            <TableCell className="text-xs text-slate-600 dark:text-slate-300">{r.handlerName ?? "—"}</TableCell>
                            <TableCell className="max-w-[260px]">
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={r.resultNote ?? r.note ?? undefined}>
                                {r.resultNote ?? r.note ?? "—"}
                              </p>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                {canHandle && r.status === "New" && (
                                  <Button size="sm" variant="outline" disabled={busyDsr === `${r.id}:p`} onClick={() => doProgress(r)}>
                                    <PlayCircle className="h-3.5 w-3.5" aria-hidden /> {t("Proses", "Progress")}
                                  </Button>
                                )}
                                {canHandle && r.status === "InProgress" && (
                                  <Button size="sm" disabled={busyDsr === `${r.id}:c`} onClick={() => (r.type === "Erase" ? setEraseTarget(r) : doComplete(r))}>
                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t("Selesaikan", "Complete")}
                                  </Button>
                                )}
                                {canHandle && (r.status === "New" || r.status === "InProgress") && (
                                  <Button size="sm" variant="outline" onClick={() => { setRejectTarget(r); setRejectNote(""); }}>
                                    {t("Tolak", "Reject")}
                                  </Button>
                                )}
                                {pkgEnabled && (
                                  <DownloadAnchor
                                    href={dsrPackageHref(r.id)}
                                    label={t("Unduh Paket Data", "Download Data Package")}
                                    title={t(
                                      `Paket data JSON ${r.applicantNo} (hak ekspor UU PDP)`,
                                      `${r.applicantNo} JSON data package (PDP Law export right)`,
                                    )}
                                    small
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== TAB: CONSENT LEDGER ==================== */}
        <TabsContent value="consents" className="mt-4 space-y-4">
          <InfoNote icon={Info} tone="teal">
            {t(
              "Menarik consent “talent pool” mengeluarkan pelamar dari saran silver-medalist otomatis (modul Demografi). Consent yang sudah ditarik tidak bisa diaktifkan kembali dari sini — pelamar mendaftar ulang utk memberi consent baru.",
              "Withdrawing a “talent pool” consent removes the applicant from automatic silver-medalist suggestions (Demographics module). A withdrawn consent cannot be re-granted here — the applicant must re-apply to consent anew.",
            )}
          </InfoNote>

          {consentsApi.loading && !consents ? (
            <LoadingRows rows={4} />
          ) : consentsApi.error ? (
            errBox(t("Ledger consent gagal dimuat", "Failed to load the consent ledger"), consentsApi.error)
          ) : !consents ? null : consents.length === 0 ? (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="pt-6">
                <EmptyState
                  title={t("Belum ada consent tercatat", "No consents recorded")}
                  description={t(
                    "Consent pelamar (rekrutmen / talent pool) tercatat otomatis saat pelamar mendaftar atau diverifikasi dari lamaran publik.",
                    "Applicant consents (recruitment / talent pool) are recorded automatically when applicants register or get verified from public applications.",
                  )}
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Pelamar", "Applicant")}</TableHead>
                        <TableHead>{t("Purpose", "Purpose")}</TableHead>
                        <TableHead>{t("Diberikan", "Granted")}</TableHead>
                        <TableHead>{t("Ditarik", "Withdrawn")}</TableHead>
                        <TableHead>{t("Kanal", "Channel")}</TableHead>
                        <TableHead className="min-w-[160px]">{t("Catatan", "Note")}</TableHead>
                        <TableHead className="text-right">{t("Aksi", "Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {consents.map((r) => {
                        const pm = purposeMeta(r.purpose, t);
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <p className="font-semibold text-slate-800 dark:text-slate-200">{r.applicantName ?? "—"}</p>
                              <p className="text-[11px] text-slate-400">{r.applicantNo ?? "—"}</p>
                            </TableCell>
                            <TableCell><Pill tone={pm.tone}>{pm.label}</Pill></TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">
                              {fmtDay(r.grantedAt, locale)}
                              <span className="ml-1 text-slate-400">v{r.version}</span>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {r.withdrawnAt ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold text-zinc-500 dark:border-zinc-600 dark:bg-zinc-700/50 dark:text-zinc-300">
                                    {t("ditarik", "withdrawn")}
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400">{fmtDay(r.withdrawnAt, locale)}</span>
                                </span>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{channelMeta(r.channel, t)}</TableCell>
                            <TableCell className="max-w-[220px]">
                              <p className="truncate text-xs text-slate-500 dark:text-slate-400" title={r.note ?? undefined}>{r.note ?? "—"}</p>
                            </TableCell>
                            <TableCell className="text-right">
                              {canHandle && !r.withdrawnAt && r.applicantId ? (
                                <Button size="sm" variant="outline" onClick={() => { setWdTarget(r); setWdNote(""); }}>
                                  <UserRoundX className="h-3.5 w-3.5" aria-hidden /> {t("Catat Penarikan", "Record Withdrawal")}
                                </Button>
                              ) : (
                                <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ==================== TAB: RETENSI ==================== */}
        <TabsContent value="retention" className="mt-4 space-y-4">
          {retentionApi.loading && !ret ? (
            <LoadingRows rows={4} />
          ) : retentionApi.error ? (
            errBox(t("Ringkasan retensi gagal dimuat", "Failed to load the retention overview"), retentionApi.error)
          ) : !ret ? null : (
            <>
              {/* stats ringkas */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {([
                  { label: t("Pelamar Ditolak", "Rejected Applicants"), value: ret.stats.rejected, icon: XCircle },
                  { label: t("Pelamar Kedaluwarsa", "Outdated Applicants"), value: ret.stats.outdated, icon: CalendarClock },
                  { label: t("Ter-anonim", "Anonymized"), value: ret.stats.anonymized, icon: Eraser },
                  { label: t("Jatuh Tempo Retensi", "Due for Retention"), value: ret.stats.dueForRetention, icon: AlertTriangle },
                  { label: t("Ditahan Consent", "Held by Consent"), value: ret.stats.heldByConsent, icon: ShieldCheck },
                ] as { label: string; value: number; icon: React.ElementType }[]).map((s) => (
                  <Card key={s.label} className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                    <CardContent className="p-4">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <s.icon className="h-3.5 w-3.5" aria-hidden /> {s.label}
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900 dark:text-slate-100">{s.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* konfigurasi */}
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t("Konfigurasi Retensi", "Retention Configuration")}</CardTitle>
                    <CardDescription>
                      {t(
                        "Pelamar ditolak/kedaluwarsa lebih lama dari jendela retensi akan dianonimkan pada siklus harian.",
                        "Rejected/outdated applicants beyond the retention window are anonymized on the daily cycle.",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="min-w-[180px] flex-1">
                        <Label htmlFor="rej-months" className="text-xs font-semibold">
                          {t("Retensi pelamar ditolak (bulan)", "Rejected applicants retention (months)")}
                        </Label>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {t("retention.months.rejected", "retention.months.rejected")}
                        </p>
                      </div>
                      <div className="flex items-end gap-2">
                        <Input
                          id="rej-months" inputMode="numeric" className="w-24" disabled={!canRetention}
                          value={rejMonths} onChange={(e) => setRejMonths(e.target.value)} aria-label={t("Retensi pelamar ditolak (bulan)", "Rejected applicants retention (months)")}
                        />
                        {canRetention && (
                          <Button size="sm" variant="outline" disabled={busyCfg === "retention.months.rejected"} onClick={() => saveMonths("retention.months.rejected", rejMonths)}>
                            {t("Simpan", "Save")}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div className="min-w-[180px] flex-1">
                        <Label htmlFor="out-months" className="text-xs font-semibold">
                          {t("Retensi pelamar kedaluwarsa (bulan)", "Outdated applicants retention (months)")}
                        </Label>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {t("retention.months.outdated", "retention.months.outdated")}
                        </p>
                      </div>
                      <div className="flex items-end gap-2">
                        <Input
                          id="out-months" inputMode="numeric" className="w-24" disabled={!canRetention}
                          value={outMonths} onChange={(e) => setOutMonths(e.target.value)} aria-label={t("Retensi pelamar kedaluwarsa (bulan)", "Outdated applicants retention (months)")}
                        />
                        {canRetention && (
                          <Button size="sm" variant="outline" disabled={busyCfg === "retention.months.outdated"} onClick={() => saveMonths("retention.months.outdated", outMonths)}>
                            {t("Simpan", "Save")}
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {t("Anonimisasi aktif", "Anonymization active")}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {t(
                            "Matikan = dry-run — siklus hanya menghitung kandidat tanpa mengubah data.",
                            "Turn off = dry-run — cycles only count candidates without changing data.",
                          )}
                        </p>
                      </div>
                      <Switch
                        checked={ret.settings["retention.anonymize"] !== "false"}
                        disabled={!canRetention || busyCfg === "retention.anonymize"}
                        onCheckedChange={toggleAnonymize}
                        aria-label={t("Anonimisasi aktif", "Anonymization active")}
                      />
                    </div>

                    <InfoNote icon={AlertTriangle} tone="rose">
                      {t(
                        "Anonimisasi permanen: identitas, kontak & dokumen pelamar dihapus; lamaran & catatan consent dipertahankan sebagai bukti kepatuhan (UU PDP Pasal 9 ayat 3).",
                        "Anonymization is permanent: applicant identity, contacts & documents are deleted; applications & consent records are retained as compliance evidence (PDP Law Art. 9 (3)).",
                      )}
                    </InfoNote>
                  </CardContent>
                </Card>

                {/* jalankan sekarang */}
                <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{t("Jalankan Siklus Retensi", "Run Retention Cycle")}</CardTitle>
                    <CardDescription>
                      {t(
                        "Siklus juga berjalan otomatis harian lewat scheduler — tombol ini utk menjalankan segera.",
                        "The cycle also runs automatically daily via the scheduler — this button runs it immediately.",
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <p className="font-semibold text-slate-700 dark:text-slate-200">{t("Jalankan Terakhir", "Last Run")}</p>
                        {ret.lastRun ? (
                          <p className="mt-0.5" title={ret.lastRun.detail}>
                            {fmtDateTime(ret.lastRun.at, locale)} — <span className="text-slate-400">{ret.lastRun.detail}</span>
                          </p>
                        ) : (
                          <p className="mt-0.5 italic">{t("belum pernah dijalankan", "never run")}</p>
                        )}
                      </div>
                      {canRetention && (
                        <Button className="shrink-0" disabled={busyRun} onClick={() => setRunOpen(true)}>
                          <PlayCircle className="h-4 w-4" aria-hidden /> {t("Jalankan Sekarang", "Run Now")}
                        </Button>
                      )}
                    </div>

                    {runResult && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                        <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                          {t("Hasil siklus terakhir", "Last cycle result")}
                          {runResult.dryRun && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                              {t("dry-run", "dry-run")}
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                          {t(
                            `{scanned} pelamar dipindai · {anonymized} dianonimkan · {skipped} ditahan consent talent-pool`,
                            `{scanned} applicants scanned · {anonymized} anonymized · {skipped} held by talent-pool consent`,
                            { scanned: String(runResult.scanned), anonymized: String(runResult.anonymized), skipped: String(runResult.skippedConsent) },
                          )}
                        </p>
                      </div>
                    )}

                    <InfoNote icon={Info} tone="teal">
                      {t(
                        "Pelamar dengan consent talent-pool yang masih aktif TIDAK dianonimkan (ditahan) sampai consent ditarik.",
                        "Applicants with an active talent-pool consent are NOT anonymized (held) until the consent is withdrawn.",
                      )}
                    </InfoNote>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ==================== TAB: AUDIT PII ==================== */}
        <TabsContent value="audit" className="mt-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <InfoNote icon={ShieldCheck} tone="teal">
              {t(
                "Setiap pembukaan detail pelamar (data pribadi penuh) tercatat: siapa, kapan, pelamar mana. Daftar versi topeng tidak dicatat (minimisasi).",
                "Every applicant detail view (full PII) is logged: who, when, which applicant. Masked list views are not logged (minimization).",
              )}
            </InfoNote>
            {canExport && (
              <DownloadAnchor
                href={`${COMPLIANCE_API}?export=audit`}
                label={t("Unduh CSV", "Download CSV")}
                title={t("Unduh log audit akses PII (CSV)", "Download the PII access audit log (CSV)")}
              />
            )}
          </div>

          {auditApi.loading && !audit ? (
            <LoadingRows rows={4} />
          ) : auditApi.error ? (
            errBox(t("Log audit gagal dimuat", "Failed to load the audit log"), auditApi.error)
          ) : !audit ? null : audit.length === 0 ? (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="pt-6">
                <EmptyState
                  icon={FileSearch}
                  title={t("Belum ada akses data pribadi yang tercatat", "No personal data access recorded yet")}
                  description={t(
                    "Membuka detail seorang pelamar di modul Talent Pool akan menulis satu baris audit di sini — hanya akses data pribadi penuh yang dicatat.",
                    "Opening an applicant's detail in the Talent Pool module writes one audit line here — only full-PII access is logged.",
                  )}
                />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("Waktu", "Time")}</TableHead>
                        <TableHead>{t("Karyawan", "Employee")}</TableHead>
                        <TableHead>{t("Pelamar", "Applicant")}</TableHead>
                        <TableHead>{t("Aktivitas Akses", "Access Activity")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {audit.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-xs text-slate-600 dark:text-slate-300">{fmtDateTime(r.createdAt, locale)}</TableCell>
                          <TableCell className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {r.employeeName ?? r.employeeId ?? t("(sistem)", "(system)")}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{r.applicantNo ?? "—"}</TableCell>
                          <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                            {whatMeta(r.what ?? "", t)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ==================== DIALOG: DSR BARU ==================== */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5 text-slate-500" aria-hidden />
              {t("Permintaan Subjek Data Baru", "New Data Subject Request")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Catat permintaan akses/ekspor/hapus dari pelamar — SLA penanganan 7 hari.",
                "Record an applicant's access/export/erasure request — 7-day handling SLA.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dsr-applicant">{t("Pelamar", "Applicant")}</Label>
              {applicantsApi.loading ? (
                <p className="text-xs text-slate-400">{t("Memuat daftar pelamar…", "Loading applicants…")}</p>
              ) : applicantsApi.error ? (
                <p className="text-xs text-rose-600 dark:text-rose-400">
                  {t("Daftar pelamar gagal dimuat", "Failed to load applicants")} — {applicantsApi.error}
                </p>
              ) : (
                <Select value={newApplicantId || ""} onValueChange={setNewApplicantId}>
                  <SelectTrigger id="dsr-applicant">
                    <SelectValue placeholder={t("Pilih pelamar…", "Pick an applicant…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {applicantOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.fullName} · {a.applicantNo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsr-type">{t("Jenis Permintaan", "Request Type")}</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger id="dsr-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DSR_TYPES.map((x) => (
                    <SelectItem key={x.key} value={x.key}>
                      {t(x.label, x.labelEn)}
                      {x.key === "Erase" && <span className="ml-1 text-rose-500">— {t("anonimisasi permanen", "permanent anonymization")}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-400">
                {t(
                  "Access: ringkasan isi data · Export: paket JSON lengkap · Erase: anonimisasi permanen.",
                  "Access: data summary · Export: full JSON package · Erase: permanent anonymization.",
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dsr-note">{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea
                id="dsr-note" rows={3} value={newNote}
                placeholder={t("Sumber permintaan, salinan surat, dsb.", "Request source, letter copy, etc.")}
                onChange={(e) => setNewNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={busyNew}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doCreate} disabled={busyNew || !newApplicantId}>
              {busyNew ? t("Menyimpan…", "Saving…") : t("Catat Permintaan", "Record Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== DIALOG: TOLAK DSR ==================== */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) setRejectTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
              {t("Tolak Permintaan Data?", "Reject the Data Request?")}
            </DialogTitle>
            <DialogDescription>
              {t(
                `DSR ${rejectTarget ? dsrTypeMeta(rejectTarget.type, t).label : ""} pelamar ${rejectTarget?.applicantName ?? ""} (${rejectTarget?.applicantNo ?? ""}) akan ditandai ditolak.`,
                `The ${rejectTarget ? dsrTypeMeta(rejectTarget.type, t).label : ""} DSR of ${rejectTarget?.applicantName ?? ""} (${rejectTarget?.applicantNo ?? ""}) will be marked rejected.`,
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="dsr-reject-note">{t("Alasan penolakan (wajib)", "Rejection reason (required)")}</Label>
              <Textarea
                id="dsr-reject-note" rows={3} value={rejectNote}
                placeholder={t("Contoh: permintaan tidak sah / data karyawan aktif terikat kontrak.", "E.g.: unlawful request / active employee bound by contract.")}
                onChange={(e) => setRejectNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={busyReject}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={doReject} disabled={busyReject || !rejectNote.trim()}>
              {busyReject ? t("Menolak…", "Rejecting…") : t("Tolak Permintaan", "Reject Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== ALERT: KONFIRMASI ERASE (DESTRUKTIF) ==================== */}
      <AlertDialog open={!!eraseTarget} onOpenChange={(v) => { if (!v) setEraseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" aria-hidden />
              {t("Anonimkan permanen data pelamar?", "Permanently anonymize the applicant's data?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `Data ${eraseTarget?.applicantName ?? ""} (${eraseTarget?.applicantNo ?? ""}) akan DIANONIMKAN PERMANEN — seluruh data pribadi (identitas, kontak, dokumen, CV) dihapus dan tidak dapat dikembalikan. Catatan lamaran & consent dipertahankan sebagai bukti kepatuhan (UU PDP Pasal 9 ayat 3).`,
                `${eraseTarget?.applicantName ?? ""}'s data (${eraseTarget?.applicantNo ?? ""}) will be PERMANENTLY ANONYMIZED — all personal data (identity, contacts, documents, CV) is deleted and cannot be restored. Application & consent records are retained as compliance evidence (PDP Law Art. 9 (3)).`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyDsr?.endsWith(":c")}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyDsr?.endsWith(":c")}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault();
                if (eraseTarget) {
                  void doComplete(eraseTarget).finally(() => setEraseTarget(null));
                }
              }}
            >
              {busyDsr?.endsWith(":c") ? t("Memproses…", "Processing…") : t("Ya, Anonimkan Permanen", "Yes, Anonymize Permanently")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ==================== DIALOG: CATAT PENARIKAN CONSENT ==================== */}
      <Dialog open={!!wdTarget} onOpenChange={(v) => { if (!v) setWdTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserRoundX className="h-5 w-5 text-slate-500" aria-hidden />
              {t("Catat Penarikan Consent", "Record Consent Withdrawal")}
            </DialogTitle>
            <DialogDescription>
              {t(
                `Consent ${wdTarget ? purposeMeta(wdTarget.purpose, t).label : ""} milik ${wdTarget?.applicantName ?? ""} (${wdTarget?.applicantNo ?? ""}) akan ditandai ditarik.`,
                `The ${wdTarget ? purposeMeta(wdTarget.purpose, t).label : ""} consent of ${wdTarget?.applicantName ?? ""} (${wdTarget?.applicantNo ?? ""}) will be marked withdrawn.`,
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wd-note">{t("Catatan penarikan (wajib)", "Withdrawal note (required)")}</Label>
              <Textarea
                id="wd-note" rows={3} value={wdNote}
                placeholder={t("Contoh: email permintaan pelamar tgl …", "E.g.: applicant's request email dated …")}
                onChange={(e) => setWdNote(e.target.value)}
              />
            </div>
            <InfoNote icon={Info} tone="amber">
              {t(
                "Efek: pelamar keluar dari saran talent pool (silver medalist) pada modul Demografi.",
                "Effect: the applicant leaves the talent pool (silver medalist) suggestions in the Demographics module.",
              )}
            </InfoNote>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWdTarget(null)} disabled={busyWd}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doWithdraw} disabled={busyWd || !wdNote.trim()}>
              {busyWd ? t("Menyimpan…", "Saving…") : t("Tarik Consent", "Withdraw Consent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== ALERT: KONFIRMASI JALANKAN RETENSI ==================== */}
      <AlertDialog open={runOpen} onOpenChange={setRunOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5 text-slate-500" aria-hidden />
              {t("Jalankan siklus retensi sekarang?", "Run the retention cycle now?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {ret?.settings["retention.anonymize"] === "false"
                ? t(
                  "Mode dry-run aktif — siklus hanya menghitung kandidat tanpa mengubah data.",
                  "Dry-run mode is on — the cycle only counts candidates without changing data.",
                )
                : t(
                  "Pelamar ditolak/kedaluwarsa yang melewati jendela retensi (dan tanpa consent talent-pool aktif) akan DIANONIMKAN PERMANEN. Tindakan ini tidak bisa dibatalkan.",
                  "Rejected/outdated applicants past the retention window (and without an active talent-pool consent) will be PERMANENTLY ANONYMIZED. This cannot be undone.",
                )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyRun}>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyRun}
              className={ret?.settings["retention.anonymize"] === "false" ? "" : "bg-rose-600 hover:bg-rose-700"}
              onClick={(e) => { e.preventDefault(); void doRun(); }}
            >
              {busyRun ? t("Menjalankan…", "Running…") : t("Ya, Jalankan", "Yes, Run")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
