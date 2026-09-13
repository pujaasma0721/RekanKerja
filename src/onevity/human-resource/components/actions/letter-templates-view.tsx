"use client";
// OneVity — Template Surat: daftar template per tenant + editor + pratinjau
// =====================================================================
// Task 3-LETTERS (menu HR → Dokumen & Surat → Template Surat):
//   · TAB "Katalog" — tiga seksi kategori: Disipliner, Personnel Action &
//     EmployeeService (26-a: SK Kerja/Gaji/Pengalaman, Referensi, PKWT).
//     Baris kartu: nama, deskripsi, chip key mono, penanda tangan,
//     "diperbarui", pil aktif (klik = toggle PATCH).
//   · TAB "Permintaan Masuk" (26-a) — daftar LetterRequest ESS karyawan:
//     Setujui & Terbitkan (render → LetterDocument 001/HR-ES/… + notifikasi
//     karyawan + ActivityLog) atau Tolak (alasan → status Rejected +
//     notifikasi). Hak aksi: hr:templates op:decide (katalog menu-perms).
//   · Editor sm:max-w-5xl 2 kolom: form + palet placeholder (klik sisip
//     {{token}} di posisi kursor) | PRATINJAU LANGsung gaya kertas.
//   · "Kembalikan ke Bawaan" — restore dari LETTER_TEMPLATE_DEFAULTS.
import { useEffect, useRef, useState } from "react";
import { useApi, apiSend, fmtDate, fmtDateTime } from "@/onevity/shared/lib/api";
import { useMenuPerms } from "@/onevity/shared/lib/menu-perms-context";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { LETTER_PLACEHOLDERS } from "@/onevity/shared/lib/letter-defaults";
import { PageHeader, EmptyState, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { FileText, Pencil, RotateCcw, Loader2, PenLine, Eye, Scale, Inbox, CheckCircle2, XCircle, FileDown, UserRound, HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- tipe baris template (respons GET /api/onevity/letter-templates) ----------
interface TemplateRow {
  id: string;
  key: string;
  category: string; // Disciplinary | PersonnelAction
  name: string;
  description: string | null;
  subject: string | null;
  body: string;
  signatoryName: string | null;
  signatoryTitle: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const BODY_MAX = 20000;

// ---------- sampel pratinjau (peta token → contoh nilai) ----------
const PREVIEW_SAMPLES: Record<string, string> = {
  employee_name: "Tri Handayani",
  employee_no: "MII00004",
  employee_position: "HR Manager",
  employee_org_unit: "Human Resources",
  employee_grade: "G5",
  employee_level: "Managerial",
  employee_status: "Permanent",
  join_date: "18 Juni 2016",
  company_name: "PT Mitra Industri Internasional",
  company_address: "Jl. Industri Raya No. 88",
  company_city: "Jakarta",
  company_phone: "(021) 555-0123",
  company_npwp: "01.234.567.8-901.000",
  office_name: "Kantor Pusat Jakarta",
  office_city: "Jakarta",
  office_npwp: "01.234.567.8-901.000",
  city: "Jakarta",
  letter_no: "001/HR-DIS/X/2026",
  validity_months: "6",
  warning_no: "1",
  warning_level: "Surat Peringatan Tertulis",
  violation: "Keterlambatan berulang 5 kali dalam satu bulan",
  sanction: "Teguran tertulis pertama",
  notes: "Diberikan pembinaan intensif oleh atasan langsung",
  reason: "Penyesuaian struktur organisasi",
  new_salary: "Rp 15.000.000",
  new_position: "QA Supervisor",
  new_org_unit: "Quality Assurance",
  new_grade: "G4",
  new_status: "Permanent",
  // 26-a — surat layanan karyawan
  purpose: "pengajuan kredit multiguna",
  nik: "3172027430555",
  birth_date: "12 Maret 1992",
  birth_place: "Jakarta",
  alamat: "Jl. Kenanga No. 14, Jakarta Timur",
  status_kerja: "Permanent",
  masa_kerja: "1 tahun 4 bulan",
  end_date: "hingga saat ini",
  gaji_pokok: "Rp 6.300.000",
  tunjangan_tetap: "Rp 1.300.000",
  total_bruto: "Rp 7.600.000",
  contract_start: "23 April 2025",
  contract_end: "22 April 2027",
  renewal_count: "1",
};

// tanggal panjang Indonesia hari ini (sampel letter_date)
const todayLongId = () =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date());

// peta token → deskripsi (fallback sampel pratinjau utk token tak ber sampel)
const TOKEN_DESC: Record<string, string> = {};
for (const g of LETTER_PLACEHOLDERS) for (const tk of g.tokens) TOKEN_DESC[tk.token] = tk.desc;

/** Render pratinjau: {{token}} → sampel; token tak dikenal → deskripsi atau "—". */
function renderPreview(body: string, live: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    const v = live[token];
    return v != null && v.trim() !== "" ? v : (TOKEN_DESC[token] ?? "—");
  });
}

// ================= VIEW UTAMA =================
/** Baris permintaan surat ESS (GET /api/onevity/letter-requests). */
interface RequestRow {
  id: string;
  reqNo: string;
  templateKey: string;
  templateName: string;
  purpose: string | null;
  notes: string | null;
  status: string;
  rejectReason: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  letterDocumentId: string | null;
  createdAt: string;
  employee: {
    id: string;
    fullName: string;
    employeeNo: string;
    photoUrl: string | null;
    positionTitle: string | null;
    orgUnitName: string | null;
  };
}

export function LetterTemplatesView() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const { data, loading, refresh } = useApi<{ templates: TemplateRow[] }>("/api/onevity/letter-templates");
  const requests = useApi<{ requests: RequestRow[]; counts: { pending: number; issued: number; rejected: number } }>(
    "/api/onevity/letter-requests",
  );
  const [tab, setTab] = useState("catalog");
  const [edit, setEdit] = useState<TemplateRow | null>(null);
  const [resetTarget, setResetTarget] = useState<TemplateRow | null>(null);
  const [busy, setBusy] = useState(false);
  // keputusan permintaan surat (26-a)
  const [rejectTarget, setRejectTarget] = useState<RequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const [issuingId, setIssuingId] = useState<string | null>(null);

  const templates = data?.templates ?? [];
  const disciplinary = templates.filter((x) => x.category === "Disciplinary");
  const personnel = templates.filter((x) => x.category === "PersonnelAction");
  const service = templates.filter((x) => x.category === "EmployeeService");
  const reqRows = requests.data?.requests ?? [];
  const pendingCount = requests.data?.counts.pending ?? 0;

  /** Toggle aktif/nonaktif (klik pil). */
  const toggleActive = async (tpl: TemplateRow) => {
    try {
      await apiSend("/api/onevity/letter-templates", "PATCH", { id: tpl.id, active: !tpl.active });
      toast.success(tpl.active
        ? t("Template dinonaktifkan — tidak dipakai saat menerbitkan surat", "Template deactivated — not used when issuing letters")
        : t("Template diaktifkan", "Template activated"));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  /** Kembalikan isi template ke bawaan sistem. */
  const doReset = async () => {
    if (!resetTarget) return;
    setBusy(true);
    try {
      await apiSend("/api/onevity/letter-templates", "POST", { action: "reset", id: resetTarget.id });
      toast.success(t("Template {name} dikembalikan ke bawaan", "Template {name} restored to default", { name: resetTarget.name }));
      setResetTarget(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  /** 26-a — Setujui & Terbitkan permintaan surat karyawan (idempoten). */
  const doIssue = async (req: RequestRow) => {
    if (issuingId) return;
    setIssuingId(req.id);
    try {
      const res = await apiSend<{ letter: { refNo: string } }>("/api/onevity/letter-requests", "PATCH", {
        id: req.id,
        action: "issue",
      });
      toast.success(
        t("Surat {ref} diterbitkan — karyawan dapat mengunduh PDF", "Letter {ref} issued — the employee can download the PDF", { ref: res.letter.refNo }),
      );
      requests.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setIssuingId(null); }
  };

  /** 26-a — Tolak permintaan surat (dialog alasan). */
  const doReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setRejectBusy(true);
    try {
      await apiSend("/api/onevity/letter-requests", "PATCH", {
        id: rejectTarget.id,
        action: "reject",
        reason: rejectReason.trim(),
      });
      toast.success(t("Permintaan {req} ditolak — karyawan diberi tahu", "Request {req} rejected — the employee is notified", { req: rejectTarget.reqNo }));
      setRejectTarget(null);
      setRejectReason("");
      requests.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setRejectBusy(false); }
  };

  const renderRow = (tpl: TemplateRow) => (
    <Card key={tpl.id} className="rounded-2xl border-stone-200/80 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-stone-800 dark:text-stone-100">{tpl.name}</p>
            <Badge variant="outline" className="rounded-md px-1.5 font-mono text-[10px] font-bold text-stone-500 dark:text-stone-400">
              {tpl.key}
            </Badge>
            {/* pil aktif — klik untuk toggle */}
            <button
              type="button"
              onClick={() => void toggleActive(tpl)}
              title={t("Klik untuk mengaktifkan/menonaktifkan template", "Click to activate/deactivate the template")}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold transition-colors",
                tpl.active
                  ? "border-brand/25 bg-brand/10 text-brand-deep hover:bg-brand/15 dark:border-brand/30 dark:bg-brand/10 dark:text-brand/85"
                  : "border-stone-200 bg-stone-50 text-stone-400 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-500",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", tpl.active ? "bg-brand" : "bg-stone-300 dark:bg-stone-600")} aria-hidden />
              {tpl.active ? t("Aktif", "Active") : t("Nonaktif", "Inactive")}
            </button>
          </div>
          {tpl.description && (
            <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{tpl.description}</p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-stone-400">
            <span className="inline-flex items-center gap-1">
              <PenLine className="h-3 w-3" aria-hidden />
              {tpl.signatoryName ? `${tpl.signatoryName} — ${tpl.signatoryTitle}` : `— — ${tpl.signatoryTitle}`}
            </span>
            <span>{t("diperbarui {d}", "updated {d}", { d: fmtDate(tpl.updatedAt) })}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEdit(tpl)} className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
            <Pencil className="h-3 w-3" /> {t("Ubah")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setResetTarget(tpl)} className="h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold">
            <RotateCcw className="h-3 w-3" /> {t("Kembalikan ke Bawaan", "Reset to Default")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("Dokumen & Surat")}
        title={t("Template Surat", "Letter Templates")}
        description={t(
          "{total} template surat siap cetak — {d} disipliner · {p} personnel action · {s} surat layanan karyawan. Sesuaikan isi template dengan format surat perusahaan Anda.",
          "{total} print-ready letter templates — {d} disciplinary · {p} personnel action · {s} employee service. Customize the templates to your company's letter format.",
          { total: templates.length, d: disciplinary.length, p: personnel.length, s: service.length },
        )}
      />

      {/* tab katalog / permintaan masuk (26-a) */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-stone-100/90 p-1 dark:bg-stone-800/70">
          <TabsTrigger value="catalog" className="shrink-0 gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-stone-500 transition-all data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-stone-900/[0.06] dark:text-stone-400 dark:data-[state=active]:bg-stone-900 dark:data-[state=active]:ring-stone-100/10">
            <FileText className="h-4 w-4" aria-hidden /> {t("Katalog Template", "Template Catalog")}
          </TabsTrigger>
          <TabsTrigger value="requests" className="shrink-0 gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-medium whitespace-nowrap text-stone-500 transition-all data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-stone-900/[0.06] dark:text-stone-400 dark:data-[state=active]:bg-stone-900 dark:data-[state=active]:ring-stone-100/10">
            <Inbox className="h-4 w-4" aria-hidden /> {t("Permintaan Masuk", "Incoming Requests")}
            {pendingCount > 0 && (
              <span data-count className="ml-1 rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold tabular-nums text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB KATALOG ===== */}
        <TabsContent value="catalog">
          {loading && !data ? (
            <LoadingRows rows={6} />
          ) : templates.length === 0 ? (
            <EmptyState
              title={t("Belum ada template surat", "No letter templates yet")}
              description={t("Template bawaan belum tersedia di tenant ini — hubungi admin untuk melakukan seeding.", "Default templates are not available in this tenant yet — contact an admin to seed them.")}
              icon={<FileText className="h-6 w-6" />}
            />
          ) : (
            <div className="space-y-6">
              {/* seksi Disipliner */}
              <section aria-label={t("Template Disipliner", "Disciplinary Templates")}>
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                  <Scale className="h-3.5 w-3.5" aria-hidden /> {t("Disipliner", "Disciplinary")}
                  <Badge variant="outline" className="rounded-full px-2 text-[10px] font-bold text-stone-400">{disciplinary.length}</Badge>
                </h3>
                <div className="grid gap-3">
                  {disciplinary.map(renderRow)}
                </div>
              </section>

              {/* seksi Personnel Action */}
              <section aria-label={t("Template Personnel Action", "Personnel Action Templates")}>
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                  <FileText className="h-3.5 w-3.5" aria-hidden /> {t("Personnel Action")}
                  <Badge variant="outline" className="rounded-full px-2 text-[10px] font-bold text-stone-400">{personnel.length}</Badge>
                </h3>
                <div className="grid gap-3">
                  {personnel.map(renderRow)}
                </div>
              </section>

              {/* ===== seksi Surat Layanan Karyawan (26-a) ===== */}
              <section aria-label={t("Template Surat Layanan Karyawan", "Employee Service Templates")}>
                <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                  <HeartHandshake className="h-3.5 w-3.5" aria-hidden /> {t("Surat Layanan Karyawan", "Employee Service")}
                  <Badge variant="outline" className="rounded-full px-2 text-[10px] font-bold text-stone-400">{service.length}</Badge>
                </h3>
                <div className="grid gap-3">
                  {service.map(renderRow)}
                </div>
              </section>
            </div>
          )}
        </TabsContent>

        {/* ===== TAB PERMINTAAN MASUK (26-a) ===== */}
        <TabsContent value="requests">
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardContent className="p-4 sm:p-6">
              {requests.loading && !requests.data ? (
                <LoadingRows rows={4} />
              ) : requests.error && !requests.data ? (
                <EmptyState
                  title={t("Gagal memuat permintaan", "Failed to load requests")}
                  description={requests.error}
                  icon={<Inbox className="h-6 w-6" />}
                />
              ) : reqRows.length === 0 ? (
                <EmptyState
                  title={t("Belum ada permintaan surat", "No letter requests yet")}
                  description={t(
                    "Permintaan surat dari Portal Karyawan (menu Surat) akan tampil di sini untuk Anda setujui & terbitkan, atau tolak.",
                    "Letter requests from the Employee Portal (Surat menu) appear here for you to approve & issue, or reject.",
                  )}
                  icon={<Inbox className="h-6 w-6" />}
                />
              ) : (
                <ul className="space-y-3">
                  {reqRows.map((r) => (
                    <li key={r.id}>
                      <div className={cn(
                        "rounded-xl border p-4 transition-colors",
                        r.status === "Pending"
                          ? "border-amber-200 bg-amber-50/50 dark:border-amber-500/25 dark:bg-amber-500/5"
                          : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/40",
                      )}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <UserRound className="h-3.5 w-3.5 text-stone-400" aria-hidden />
                              <p className="text-[13px] font-bold text-stone-800 dark:text-stone-100">
                                {r.employee.fullName}
                                <span className="ml-1.5 font-mono text-[11px] font-semibold text-stone-400">{r.employee.employeeNo}</span>
                              </p>
                              <StatusPill status={r.status} />
                            </div>
                            <p className="mt-1 text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                              {r.templateName}
                              <span className="ml-2 font-mono text-[11px] font-semibold text-stone-400">{r.reqNo}</span>
                            </p>
                            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                              {r.employee.positionTitle ?? "—"} · {r.employee.orgUnitName ?? "—"}
                              {r.purpose ? ` · ${t("keperluan", "for")}: ${r.purpose}` : ""}
                            </p>
                            {r.notes && (
                              <p className="mt-1 rounded-lg bg-stone-100/70 px-2.5 py-1.5 text-[11px] italic leading-relaxed text-stone-500 dark:bg-stone-800/60 dark:text-stone-400">
                                “{r.notes}”
                              </p>
                            )}
                            {r.status === "Rejected" && r.rejectReason && (
                              <p className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                {t("Alasan tolak", "Reject reason")}: {r.rejectReason}
                              </p>
                            )}
                            <p className="mt-1 text-[10px] text-stone-400">
                              {t("diajukan", "requested")} {fmtDateTime(r.createdAt)}
                              {r.decidedAt && r.decidedBy ? ` · ${t("diputuskan", "decided")} ${fmtDateTime(r.decidedAt)} (${r.decidedBy})` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {r.status === "Pending" && perms.canOp("hr", "templates", "decide") && (
                              <>
                                <Button size="sm" onClick={() => void doIssue(r)} disabled={issuingId === r.id} className="h-8 gap-1.5 rounded-lg px-3 text-[11px] font-bold">
                                  {issuingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                  {t("Setujui & Terbitkan", "Approve & Issue")}
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setRejectReason(""); setRejectTarget(r); }} className="h-8 gap-1.5 rounded-lg px-3 text-[11px] font-bold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10">
                                  <XCircle className="h-3.5 w-3.5" /> {t("Tolak", "Reject")}
                                </Button>
                              </>
                            )}
                            {r.status === "Issued" && r.letterDocumentId && (
                              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg px-3 text-[11px] font-bold">
                                <a href={`/api/onevity/letters/${r.letterDocumentId}/pdf?download=1`} download>
                                  <FileDown className="h-3.5 w-3.5" /> {t("Unduh PDF", "Download PDF")}
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* dialog edit template */}
      {edit && (
        <TemplateEditDialog
          tpl={edit}
          open={!!edit}
          setOpen={(v) => { if (!v) setEdit(null); }}
          onSaved={refresh}
        />
      )}

      {/* dialog tolak permintaan surat (26-a) */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v && !rejectBusy) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/15">
                <XCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              </span>
              {t("Tolak Permintaan Surat?", "Reject the Letter Request?")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
              {rejectTarget && t(
                "{name} meminta {tpl} ({req}). Alasan penolakan akan dikirim sebagai notifikasi kepada karyawan.",
                "{name} requested {tpl} ({req}). The rejection reason will be sent to the employee as a notification.",
                { name: rejectTarget.employee.fullName, tpl: rejectTarget.templateName, req: rejectTarget.reqNo },
              )}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason" className="text-xs">{t("Alasan Penolakan", "Rejection Reason")} *</Label>
              <Textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder={t("mis. data kepegawaian belum lengkap…", "e.g. incomplete employment data…")}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={rejectBusy} onClick={() => { setRejectTarget(null); setRejectReason(""); }} className="h-11">{t("Batal")}</Button>
            <Button onClick={() => void doReject()} disabled={rejectBusy || !rejectReason.trim()} className="h-11 gap-2 bg-rose-600 font-bold text-white hover:bg-rose-700">
              {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              {t("Tolak Permintaan", "Reject Request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* konfirmasi reset ke bawaan */}
      <AlertDialog open={!!resetTarget} onOpenChange={(v) => { if (!v) setResetTarget(null); }}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
                <RotateCcw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </span>
              {t("Kembalikan ke Bawaan?", "Reset to Default?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "Isi template akan dikembalikan ke bawaan sistem — perubahan Anda hilang.",
                "The template content will be restored to the system default — your changes will be lost.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} className="h-11">{t("Batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void doReset(); }}
              className="h-11 gap-2 font-bold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {t("Ya, Kembalikan", "Yes, Reset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


// ================= DIALOG EDIT + PRATINJAU LANGSUNG =================
function TemplateEditDialog({ tpl, open, setOpen, onSaved }: {
  tpl: TemplateRow;
  open: boolean;
  setOpen: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryTitle, setSignatoryTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // isi form setiap kali dialog dibuka utk template baru
  useEffect(() => {
    if (!open) return;
    setName(tpl.name);
    setSubject(tpl.subject ?? "");
    setSignatoryName(tpl.signatoryName ?? "");
    setSignatoryTitle(tpl.signatoryTitle);
    setBody(tpl.body);
  }, [open, tpl]);

  /** Sisipkan {{token}} pada posisi kursor textarea body. */
  const insertToken = (token: string) => {
    const el = bodyRef.current;
    const ins = `{{${token}}}`;
    if (!el) {
      setBody((b) => b + ins);
      return;
    }
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    const next = body.slice(0, s) + ins + body.slice(e);
    setBody(next);
    // pulihkan fokus + caret setelah React menulis nilai baru
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + ins.length, s + ins.length);
    });
  };

  const save = async () => {
    if (!name.trim()) { toast.error(t("Nama template wajib diisi", "Template name is required")); return; }
    if (!body.trim()) { toast.error(t("Isi surat wajib diisi", "Letter body is required")); return; }
    if (body.length > BODY_MAX) { toast.error(t("Isi surat maksimal {n} karakter", "Letter body must be at most {n} characters", { n: BODY_MAX })); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/letter-templates", "PATCH", {
        id: tpl.id,
        name: name.trim(),
        subject: subject.trim(),
        signatoryName: signatoryName.trim(), // "" → null di server (garis tanda tangan)
        signatoryTitle: signatoryTitle.trim(),
        body,
      });
      toast.success(t("Template surat disimpan", "Letter template saved"));
      setOpen(false);
      onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  // pratinjau live — sampel + nilai form penanda tangan
  const liveSamples: Record<string, string> = {
    ...PREVIEW_SAMPLES,
    letter_date: todayLongId(),
    effective_date: "17 September 2026",
    last_day: "17 September 2026",
    expires_at: "17 September 2026",
    issued_at: "17 September 2026",
    contract_until: "17 September 2026",
    probation_until: "17 September 2026",
    signatory_name: signatoryName.trim() || "________________",
    signatory_title: signatoryTitle.trim() || "HR Manager",
  };
  const preview = renderPreview(body, liveSamples);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base">
            <Pencil className="h-4 w-4 ov-text-accent" />
            {t("Ubah Template Surat", "Edit Letter Template")}
            <Badge variant="outline" className="rounded-md px-1.5 font-mono text-[10px] font-bold text-stone-500 dark:text-stone-400">{tpl.key}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ===== KOLOM KIRI: form + palet placeholder ===== */}
          <div className="space-y-3.5">
            <div>
              <Label className="text-xs">{t("Nama Template", "Template Name")} *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label className="text-xs">{t("Perihal (opsional)", "Subject (optional)")}</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("cth: Surat Peringatan", "e.g. Warning Letter")} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("Nama Penanda Tangan", "Signatory Name")}</Label>
                <Input value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder={t("kosong = garis tanda tangan", "empty = signature line")} className="mt-1.5" />
              </div>
              <div>
                <Label className="text-xs">{t("Jabatan Penanda Tangan", "Signatory Title")} *</Label>
                <Input value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} className="mt-1.5" />
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("Isi Surat", "Letter Body")} *</Label>
              <Textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="mt-1.5 min-h-[420px] font-mono text-xs leading-relaxed"
                aria-label={t("Isi surat dengan placeholder", "Letter body with placeholders")}
              />
              <p className="mt-1 text-[10px] text-stone-400">
                {t("{n} karakter — placeholder ditulis", "{n} characters — placeholders are written as", { n: body.length })}
                <span className="font-mono"> {"{{token}}"}</span>
              </p>
            </div>

            {/* palet placeholder — klik menyisipkan di posisi kursor */}
            <div className="rounded-xl border border-stone-200/80 bg-stone-50/60 p-3.5 dark:border-stone-800 dark:bg-stone-900/40">
              <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
                {t("Sisipkan Placeholder", "Insert Placeholder")}
              </p>
              <div className="mt-2.5 max-h-52 space-y-2.5 overflow-y-auto pr-1">
                {LETTER_PLACEHOLDERS.map((g) => (
                  <div key={g.group}>
                    <p className="text-[10px] font-semibold text-stone-500 dark:text-stone-400">{g.group}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {g.tokens.map((tk) => (
                        <button
                          key={tk.token}
                          type="button"
                          title={tk.desc}
                          onClick={() => insertToken(tk.token)}
                          className="cursor-pointer rounded-md border border-stone-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                        >
                          {`{{${tk.token}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ===== KOLOM KANAN: pratinjau langsung (kertas) ===== */}
          <div className="lg:sticky lg:top-0 lg:self-start">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-stone-400">
              <Eye className="h-3.5 w-3.5" aria-hidden /> {t("Pratinjau Langsung", "Live Preview")}
            </p>
            <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700">
              <div className="whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-stone-800">
                {preview}
              </div>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
              {t(
                "Pratinjau memakai data contoh — nilai aktual diisi otomatis saat surat diterbitkan.",
                "The preview uses sample data — actual values are filled in when the letter is issued.",
              )}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy} className="h-11">{t("Batal")}</Button>
          <Button onClick={save} disabled={busy} className="h-11 gap-2 font-bold">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
            {t("Simpan Perubahan", "Save Changes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
