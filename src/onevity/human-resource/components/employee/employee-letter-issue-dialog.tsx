"use client";
// OneVity — Dialog Terbitkan Surat Layanan dari profil karyawan (Task 26-a) ==
// =====================================================================
// Dipakai tab "Surat" pada profil karyawan (employee-module):
//   · pilih jenis surat (katalog EmployeeService aktif dari GET /letters);
//   · keperluan (opsional — default template "sesuai keperluan");
//   · PRATINJAU LIVE — render {{token}} dengan DATA AKTUAL karyawan ini
//     (gaji hanya utk EMP_SK_GAJI & EMP_PKWT — sama aturannya dgn server);
//   · Terbitkan → POST /api/onevity/letters/issue {category:"EmployeeService"}
//     → LetterDocument baru refNo 001/HR-ES/…/tahun + ActivityLog.
// Setelah terbit: tampil kartu hasil + tombol Unduh PDF (pola letter-preview).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, FileText, Loader2, Send, TriangleAlert } from "lucide-react";
import { apiSend, fmtDate, fmtIDR, tenure } from "@/onevity/shared/lib/api";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Template EmployeeService aktif (dari GET /api/onevity/letters). */
export interface ServiceTemplateRow {
  key: string;
  name: string;
  description: string | null;
  subject: string | null;
  body: string;
  signatoryName: string | null;
  signatoryTitle: string;
}

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

/** Data karyawan aktual utk pratinjau (subset DetailEmp — cukup utk token). */
export interface LetterPreviewEmployee {
  id: string;
  fullName: string;
  employeeNo: string;
  nationalId: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  address: string | null;
  city: string | null;
  joinDate: string;
  employmentStatus: string;
  baseSalary: number;
  position: { title: string | null } | null;
  orgUnit: { name: string | null } | null;
  grade: { code: string | null } | null;
  company: { name: string | null } | null;
}

// template yang boleh menampilkan nilai gaji (sama dgn server letter-service)
const SALARY_TEMPLATES = new Set(["EMP_SK_GAJI", "EMP_PKWT"]);

const todayLongId = () =>
  new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date());

export function EmployeeLetterIssueDialog({
  employee, templates, open, setOpen, onIssued,
}: {
  employee: LetterPreviewEmployee;
  templates: ServiceTemplateRow[];
  open: boolean;
  setOpen: (v: boolean) => void;
  onIssued: () => void;
}) {
  const { t } = useI18n();
  const [templateKey, setTemplateKey] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedLetter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tpl = useMemo(() => templates.find((x) => x.key === templateKey) ?? null, [templates, templateKey]);
  const isSalary = SALARY_TEMPLATES.has(templateKey);

  /** Pratinjau live — token diisi DATA AKTUAL karyawan; gaji hanya utk SK Gaji & PKWT. */
  const preview = useMemo(() => {
    if (!tpl) return "";
    const ctx: Record<string, string> = {
      employee_name: employee.fullName,
      employee_no: employee.employeeNo,
      employee_position: employee.position?.title ?? "—",
      employee_org_unit: employee.orgUnit?.name ?? "—",
      employee_grade: employee.grade?.code ?? "—",
      employee_status: employee.employmentStatus,
      status_kerja: employee.employmentStatus,
      join_date: employee.joinDate ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(employee.joinDate)) : "—",
      masa_kerja: tenure(employee.joinDate),
      nik: employee.nationalId ?? "—",
      birth_place: employee.birthPlace ?? "—",
      birth_date: employee.birthDate ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(new Date(employee.birthDate)) : "—",
      alamat: employee.address ?? "—",
      end_date: "hingga saat ini",
      company_name: employee.company?.name ?? "—",
      city: employee.city ?? "—",
      letter_no: "001/HR-ES/…/2026",
      letter_date: todayLongId(),
      purpose: purpose.trim() || "sesuai keperluan",
      signatory_name: tpl.signatoryName || "________________",
      signatory_title: tpl.signatoryTitle,
      // gaji — sensitive, hanya template SK Gaji & PKWT (aturan sama dgn server)
      gaji_pokok: isSalary ? fmtIDR(employee.baseSalary) : "—",
      tunjangan_tetap: isSalary ? t("(terhitung otomatis saat terbit)", "(computed on issue)") : "—",
      total_bruto: isSalary ? t("(terhitung otomatis saat terbit)", "(computed on issue)") : "—",
    };
    return tpl.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
      const v = ctx[token];
      return v != null && v.trim() !== "" ? v : "—";
    });
  }, [tpl, employee, purpose, isSalary, t]);

  const doIssue = async () => {
    if (busy || !tpl) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ letter: IssuedLetter }>("/api/onevity/letters/issue", "POST", {
        category: "EmployeeService",
        templateKey: tpl.key,
        employeeId: employee.id,
        purpose: purpose.trim() || undefined,
      });
      setIssued(res.letter);
      toast.success(
        t("Surat {ref} diterbitkan", "Letter {ref} issued", { ref: res.letter.refNo }),
        { description: t("Tersimpan di riwayat surat karyawan.", "Saved to the employee's letter history.") },
      );
      onIssued();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setError(msg);
      toast.error(t("Gagal menerbitkan surat", "Failed to issue the letter"), { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTemplateKey("");
    setPurpose("");
    setIssued(null);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2.5 text-base">
            <FileText className="h-4 w-4 ov-text-accent" />
            {issued
              ? t("Surat {name} — Diterbitkan", "Letter {name} — Issued", { name: issued.templateName })
              : t("Terbitkan Surat — {name}", "Issue Letter — {name}", { name: employee.fullName })}
          </DialogTitle>
        </DialogHeader>

        {issued ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200/80 bg-stone-50/70 px-4 py-3 dark:border-stone-700/70 dark:bg-stone-800/40">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full bg-stone-900 px-2.5 font-mono text-[10px] font-bold text-white hover:bg-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-100">
                  {issued.refNo}
                </Badge>
                <p className="text-xs font-bold text-stone-800 dark:text-stone-100">{issued.templateName}</p>
              </div>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">{fmtDate(issued.issuedAt)}</p>
            </div>
            <div className="max-h-[62vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-700">
              <div className="whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-stone-800">{issued.body}</div>
            </div>
          </>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* ===== kolom kiri: pilih template + keperluan ===== */}
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("Jenis Surat", "Letter Type")} *</Label>
                <Select value={templateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("Pilih jenis surat layanan…", "Choose a service letter type…")} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((x) => (
                      <SelectItem key={x.key} value={x.key}>{x.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tpl?.description && (
                  <p className="text-[11px] leading-relaxed text-stone-400">{tpl.description}</p>
                )}
                {templates.length === 0 && (
                  <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    {t("Tidak ada template surat layanan aktif — aktifkan dulu di menu Template Surat.", "No active service letter templates — enable them in Letter Templates first.")}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="emp-letter-purpose" className="text-xs">
                  {t("Keperluan (opsional)", "Purpose (optional)")}
                </Label>
                <Input
                  id="emp-letter-purpose"
                  value={purpose}
                  maxLength={200}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder={t("cth: pengajuan kredit, KPR, visa…", "e.g. loan application, mortgage, visa…")}
                />
                <p className="text-[10px] text-stone-400">
                  {t("Kosongkan bila surat cukup memuat \"sesuai keperluan\".", "Leave empty to print \"as needed\".")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t("Data yang dipakai", "Data used")}</Label>
                <div className="rounded-xl border border-stone-200/80 bg-stone-50/60 p-3.5 text-[11px] leading-relaxed text-stone-500 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-400">
                  <p className="font-mono">{employee.employeeNo} · {employee.fullName}</p>
                  <p>{employee.position?.title ?? "—"} — {employee.orgUnit?.name ?? "—"}</p>
                  <p>
                    {isSalary
                      ? t("Gaji diisi otomatis dari assignment aktif + tunjangan tetap payroll.", "Salary is filled from the active assignment + fixed payroll allowances.")
                      : t("Surat ini tidak memuat nilai gaji.", "This letter does not include salary figures.")}
                  </p>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span className="break-words">{error}</span>
                </div>
              )}
            </div>

            {/* ===== kolom kanan: pratinjau langsung ===== */}
            <div className="lg:sticky lg:top-0 lg:self-start">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-stone-400">
                {t("Pratinjau Langsung", "Live Preview")}
              </p>
              <div className={cn(
                "max-h-[56vh] overflow-y-auto rounded-xl border bg-white p-6 shadow-sm dark:border-stone-700",
                tpl ? "border-stone-200" : "border-dashed border-stone-300 dark:border-stone-700",
              )}>
                {tpl ? (
                  <div className="whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-stone-800">{preview}</div>
                ) : (
                  <p className="py-16 text-center text-xs text-stone-400">
                    {t("Pilih jenis surat untuk melihat pratinjau.", "Pick a letter type to see the preview.")}
                  </p>
                )}
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-stone-400">
                {t("Nomor surat & tanggal terisi otomatis saat diterbitkan.", "Letter number & date are filled automatically when issued.")}
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {issued ? (
            <Button asChild className="h-11 gap-2 font-bold">
              <a href={`/api/onevity/letters/${issued.id}/pdf?download=1`} download>
                <FileDown className="h-4 w-4" /> {t("Unduh PDF", "Download PDF")}
              </a>
            </Button>
          ) : (
            <Button
              onClick={() => void doIssue()}
              disabled={busy || !tpl}
              className="h-11 gap-2 font-bold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy ? t("Menerbitkan…", "Issuing…") : t("Terbitkan Surat", "Issue Letter")}
            </Button>
          )}
          <div className="flex gap-2">
            {issued && (
              <Button variant="outline" onClick={() => { reset(); }} className="h-11">
                {t("Terbitkan Lagi", "Issue Another")}
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)} className="h-11">{t("Tutup", "Close")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
