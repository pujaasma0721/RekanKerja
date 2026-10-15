"use client";
// RekanKerja Recruitment F2 — view "Talent Pool / Pelamar" (Applicant):
// list + query builder advance search server-side + detail multi-tab
// (profil/pendidikan/dokumen/lamaran/consent) + form panjang 2 kolom dgn
// 3 sub-form array dinamis (padanan Applicant §2.5; UU PDP consent).
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, apiSend, apiUpload, fmtIDR } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { ACCEPT_ATTRIBUTE, fmtSize } from "@/rekankerja/shared/components/attachment-upload";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AdvSearchButton } from "@/rekankerja/shared/components/adv-search";
import { encodeAdvParam, type AdvSearch, type AdvFieldDef, txt, dt, num, sel } from "@/rekankerja/shared/lib/adv-search";
import type {
  ApplicantRow, ApplicantDetail, ApplicantStats,
} from "@/rekankerja/recruitment/services/applicant-service";
import type { JoRow } from "@/rekankerja/recruitment/services/opening-service";
import type { PrOptions } from "./recruitment-types";
import { ParseCvDialog, CvParseSection } from "./ai-cv-dialogs";
import { AiSearchBar } from "./ai-search-bar";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import {
  UserPlus, Search, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, MoreHorizontal, UsersRound,
  Ban, PauseCircle, PlayCircle, CircleCheckBig, Send, GraduationCap, BriefcaseBusiness, Sparkles,
  FileCheck2, UploadCloud, Wallet, CalendarRange, Inbox, FileSearch,
} from "lucide-react";

const PAGE_SIZE = 10;

function fmtDay(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- label domain (lokal — F2) ----------

const APPLICANT_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Active", label: "Aktif", labelEn: "Active" },
  { key: "Outdated", label: "Kedaluwarsa", labelEn: "Outdated" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected" },
  { key: "Employed", label: "Bekerja", labelEn: "Employed" },
];
const A_LABEL: Record<string, string> = Object.fromEntries(APPLICANT_STATUSES.map((s) => [s.key, s.label]));
const A_LABEL_EN: Record<string, string> = Object.fromEntries(APPLICANT_STATUSES.map((s) => [s.key, s.labelEn]));
const A_TONE: Record<string, string> = { Active: "emerald", Outdated: "amber", Rejected: "rose", Employed: "teal" };

const APPLICANT_SOURCES: { key: string; label: string; labelEn: string }[] = [
  { key: "Advertisement", label: "Iklan", labelEn: "Advertisement" },
  { key: "Agency", label: "Agency", labelEn: "Agency" },
  { key: "Referral", label: "Referensi", labelEn: "Referral" },
  { key: "Web", label: "Web / Portal", labelEn: "Web / Portal" },
  { key: "Internal", label: "Internal", labelEn: "Internal" },
  { key: "Other", label: "Lainnya", labelEn: "Other" },
];
const SRC_LABEL: Record<string, string> = Object.fromEntries(APPLICANT_SOURCES.map((s) => [s.key, s.label]));
const SRC_LABEL_EN: Record<string, string> = Object.fromEntries(APPLICANT_SOURCES.map((s) => [s.key, s.labelEn]));

const EDU_LEVELS = ["SMP", "SMA", "SMK", "D3", "S1", "S2", "S3", "PROF"] as const;
const SKILL_LEVELS = ["Beginner", "Intermediate", "Advanced", "Expert"] as const;
const GENDERS: [string, string, string][] = [["M", "Laki-laki", "Male"], ["F", "Perempuan", "Female"]];
const MARITAL: [string, string, string][] = [
  ["Single", "Belum Menikah", "Single"], ["Married", "Menikah", "Married"],
  ["Divorced", "Bercerai", "Divorced"], ["Widowed", "Janda/Duda", "Widowed"],
];
const APPLICATION_STATUSES: { key: string; label: string; labelEn: string }[] = [
  { key: "Received", label: "Diterima", labelEn: "Received" },
  { key: "Screening", label: "Penyaringan", labelEn: "Screening" },
  { key: "Rejected", label: "Ditolak", labelEn: "Rejected" },
  { key: "Hired", label: "Diterima Kerja", labelEn: "Hired" },
];
const APP_LABEL: Record<string, string> = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s.key, s.label]));
const APP_LABEL_EN: Record<string, string> = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s.key, s.labelEn]));

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
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", TONE_CLS[tone] ?? TONE_CLS.slate, TONE_DOT[tone] ?? TONE_DOT.slate)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone] ?? TONE_DOT.slate)} />
      {children}
    </span>
  );
}

interface ListResp { rows: ApplicantRow[]; total: number; stats: ApplicantStats }

// Advance search — query builder talent pool (SERVER-side; expectedSalary
// terenkripsi → dua-fase di service, tetap lewat AdvSearchButton ini).
const ADV_FIELDS: AdvFieldDef<Record<string, unknown>>[] = [
  txt("applicantNo", "Nomor Pelamar", "Applicant No."),
  sel("status", "Status", "Status", APPLICANT_STATUSES.map((s): [string, string, string] => [s.key, s.label, s.labelEn])),
  sel("source", "Sumber", "Source", APPLICANT_SOURCES.map((s): [string, string, string] => [s.key, s.label, s.labelEn])),
  sel("gender", "Jenis Kelamin", "Gender", GENDERS.map((g): [string, string, string] => g)),
  dt("birthDate", "Tanggal Lahir", "Birth Date"),
  dt("keepOnFileUntil", "Keep-on-File Sampai", "Keep-on-File Until"),
  dt("dateApplied", "Tanggal Melamar", "Date Applied"),
  sel("educationLevel", "Pendidikan Tertinggi", "Highest Education", EDU_LEVELS.map((l): [string, string, string] => [l, l, l])),
  num("gpa", "IPK Tertinggi", "Highest GPA"),
  txt("fieldOfStudy", "Bidang Studi", "Field of Study"),
  txt("institution", "Institusi Pendidikan", "Education Institution"),
  num("totalExpMonths", "Total Pengalaman (bulan)", "Total Experience (months)"),
  txt("skill", "Skill", "Skill"),
  txt("referral", "Pereferensi Karyawan", "Referring Employee"),
  txt("institutionName", "Institusi Asal (sumber)", "Source Institution"),
  num("expectedSalary", "Ekspektasi Gaji (Rp)", "Expected Salary (Rp)"),
];

// ---------- form state ----------

interface EduDraft { level: string; fieldOfStudy: string; institution: string; graduationYear: string; gpa: string }
interface ExpDraft { company: string; position: string; field: string; startYear: string; endYear: string; months: string }
interface SkillDraft { skillId: string; level: string }

interface FormState {
  firstName: string; middleName: string; lastName: string; displayName: string;
  status: string; dateApplied: string; dateAvailable: string;
  expectedSalary: string; keepOnFileMonths: string;
  source: string; adMediaTypeId: string; agencyId: string; institutionName: string; referralEmployeeId: string; referralNote: string;
  email: string; phone: string; address: string; city: string;
  placeOfBirth: string; identityNo: string; birthDate: string; gender: string; maritalStatus: string;
  notes: string;
}

const emptyForm = (): FormState => ({
  firstName: "", middleName: "", lastName: "", displayName: "",
  status: "Active", dateApplied: new Date().toISOString().slice(0, 10), dateAvailable: "",
  expectedSalary: "", keepOnFileMonths: "12",
  source: "Web", adMediaTypeId: "", agencyId: "", institutionName: "", referralEmployeeId: "", referralNote: "",
  email: "", phone: "", address: "", city: "",
  placeOfBirth: "", identityNo: "", birthDate: "", gender: "", maritalStatus: "",
  notes: "",
});

const emptyEdu = (): EduDraft => ({ level: "", fieldOfStudy: "", institution: "", graduationYear: "", gpa: "" });
const emptyExp = (): ExpDraft => ({ company: "", position: "", field: "", startYear: "", endYear: "", months: "" });
const emptySkill = (): SkillDraft => ({ skillId: "", level: "" });

export function ApplicantsPage() {
  const { t, locale } = useI18n();
  const perms = useMenuPerms();
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [adv, setAdv] = useState<AdvSearch | null>(null);
  const [offset, setOffset] = useState(0);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // form create/edit
  const [dialog, setDialog] = useState<null | "new" | "edit">(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNo, setEditNo] = useState<string>("");
  const [form, setForm] = useState<FormState>(emptyForm());
  const [eduDrafts, setEduDrafts] = useState<EduDraft[]>([emptyEdu()]);
  const [expDrafts, setExpDrafts] = useState<ExpDraft[]>([emptyExp()]);
  const [skillDrafts, setSkillDrafts] = useState<SkillDraft[]>([emptySkill()]);
  const [busy, setBusy] = useState(false);

  // detail multi-tab
  const [detail, setDetail] = useState<ApplicantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // dialog aksi
  const [blTarget, setBlTarget] = useState<ApplicantRow | null>(null);
  const [susTarget, setSusTarget] = useState<ApplicantRow | null>(null);
  const [applyTarget, setApplyTarget] = useState<ApplicantRow | null>(null);
  // dialog Parse CV (F6a — dipicu aksi baris; tab detail pakai CvParseSection)
  const [cvTarget, setCvTarget] = useState<{ id: string; applicantNo: string; fullName: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [untilText, setUntilText] = useState("");
  const [applySlotId, setApplySlotId] = useState("");
  const [applyNote, setApplyNote] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  // upload dokumen (tab Dokumen)
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docRequiredId, setDocRequiredId] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedQ(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const url = useMemo(() => {
    const sp = new URLSearchParams({
      status: statusFilter, q: debouncedQ, limit: String(PAGE_SIZE), offset: String(offset),
      sortBy: "dateApplied", sortDir,
    });
    const e = encodeAdvParam(adv);
    if (e) sp.set("adv", e);
    return `/api/rekankerja/recruitment/applicants?${sp.toString()}`;
  }, [statusFilter, debouncedQ, offset, sortDir, adv]);

  const api = useApi<ListResp>(url, [url]);
  const skillApi = useApi<{ rows: { id: string; code: string; name?: string | null }[] }>("/api/rekankerja/recruitment/masters?type=skill", []);
  const reqDocApi = useApi<{ rows: { id: string; code: string; title?: string | null; name?: string | null; mandatory?: boolean | null }[] }>("/api/rekankerja/recruitment/masters?type=required-document", []);
  const adMediaApi = useApi<{ rows: { id: string; code: string; name?: string | null }[] }>("/api/rekankerja/recruitment/masters?type=ad-media", []);
  const agencyApi = useApi<{ rows: { id: string; code: string; name?: string | null }[] }>("/api/rekankerja/recruitment/masters?type=agency", []);
  const prOptsApi = useApi<PrOptions>("/api/rekankerja/recruitment/pr-options", []);
  const openingsApi = useApi<{ rows: JoRow[] }>("/api/rekankerja/recruitment/openings?limit=100", []);

  const rows = api.data?.rows ?? [];
  const total = api.data?.total ?? 0;
  const stats = api.data?.stats;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canCreate = perms.can("recruitment", "applicants", "create");
  const canUpdate = perms.can("recruitment", "applicants", "update");
  const canDelete = perms.can("recruitment", "applicants", "delete");
  const canBlacklist = perms.canOp("recruitment", "applicants", "blacklist");
  const canApply = perms.canOp("recruitment", "applicants", "apply");
  const canParseCv = perms.canOp("recruitment", "applicants", "parse-cv");

  // slot terbuka (JO Posted + slot Open) untuk "Lamar ke Slot"
  const openSlots = useMemo(
    () => (openingsApi.data?.rows ?? [])
      .filter((jo) => jo.status === "Posted")
      .flatMap((jo) => jo.slots.filter((s) => s.status === "Open").map((s) => ({ ...s, joRefNo: jo.refNo }))),
    [openingsApi.data],
  );

  const reloadDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await apiSend<{ row: ApplicantDetail }>(`/api/rekankerja/recruitment/applicants?id=${id}`, "GET");
      setDetail(res.row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memuat detail", "Failed to load detail"));
    } finally { setDetailLoading(false); }
  };

  const openDetail = async (r: ApplicantRow) => {
    setDetail(null);
    setDetailLoading(true);
    setDocFile(null); setDocTitle(""); setDocRequiredId("");
    try {
      const res = await apiSend<{ row: ApplicantDetail }>(`/api/rekankerja/recruitment/applicants?id=${r.id}`, "GET");
      setDetail(res.row);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memuat detail", "Failed to load detail"));
    } finally { setDetailLoading(false); }
  };

  // ---------- create / edit ----------

  const openNew = () => {
    setEditId(null);
    setForm(emptyForm());
    setEduDrafts([emptyEdu()]);
    setExpDrafts([emptyExp()]);
    setSkillDrafts([emptySkill()]);
    setDialog("new");
  };

  const openEdit = async (r: ApplicantRow) => {
    setBusy(true);
    try {
      const res = await apiSend<{ row: ApplicantDetail }>(`/api/rekankerja/recruitment/applicants?id=${r.id}`, "GET");
      const d = res.row;
      // id relasi tidak diserialisasi detail (hanya nama) — pulihkan lewat pencocokan
      // nama pada opsi (upaya terbaik supaya update tidak menghapus relasi).
      const findId = (list: { id: string; name?: string | null; code?: string | null }[] | undefined, name: string | null) =>
        (list ?? []).find((m) => (m.name ?? m.code) === name)?.id ?? "";
      const referralId = d.referralName
        ? ((prOptsApi.data?.employees ?? []).find((e) => e.fullName === d.referralName)?.id ?? "")
        : "";
      setEditId(d.id);
      setEditNo(d.applicantNo);
      setForm({
        firstName: d.firstName, middleName: d.middleName ?? "", lastName: d.lastName ?? "", displayName: d.displayName ?? "",
        status: d.status, dateApplied: d.dateApplied.slice(0, 10), dateAvailable: d.dateAvailable ? d.dateAvailable.slice(0, 10) : "",
        expectedSalary: d.expectedSalary != null ? String(d.expectedSalary) : "",
        keepOnFileMonths: String(d.keepOnFileMonths),
        source: d.source ?? "",
        adMediaTypeId: findId(adMediaApi.data?.rows, d.adMediaName),
        agencyId: findId(agencyApi.data?.rows, d.agencyName),
        institutionName: d.institutionName ?? "",
        referralEmployeeId: referralId,
        referralNote: d.referralNote ?? "",
        email: d.email ?? "", phone: d.phone ?? "", address: d.address ?? "", city: d.city ?? "",
        placeOfBirth: d.placeOfBirth ?? "", identityNo: "", birthDate: d.birthDate ? d.birthDate.slice(0, 10) : "",
        gender: d.gender ?? "", maritalStatus: d.maritalStatus ?? "",
        notes: d.notes ?? "",
      });
      setEduDrafts(d.educations.map((e) => ({
        level: e.level, fieldOfStudy: e.fieldOfStudy ?? "", institution: e.institution ?? "",
        graduationYear: e.graduationYear != null ? String(e.graduationYear) : "", gpa: e.gpa != null ? String(e.gpa) : "",
      })));
      setExpDrafts(d.experiences.map((e) => ({
        company: e.company ?? "", position: e.position ?? "", field: e.field ?? "",
        startYear: e.startYear != null ? String(e.startYear) : "", endYear: e.endYear != null ? String(e.endYear) : "",
        months: e.months != null ? String(e.months) : "",
      })));
      setSkillDrafts(d.skills.map((s) => ({ skillId: s.skillId, level: s.level ?? "" })));
      setDialog("edit");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memuat data pelamar", "Failed to load applicant data"));
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!form.firstName.trim()) {
      toast.error(t("Nama depan pelamar wajib diisi", "Applicant first name is required"));
      return;
    }
    setBusy(true);
    try {
      const body = {
        firstName: form.firstName,
        middleName: form.middleName || null,
        lastName: form.lastName || null,
        displayName: form.displayName || null,
        status: form.status || null,
        dateApplied: form.dateApplied || null,
        dateAvailable: form.dateAvailable || null,
        expectedSalary: form.expectedSalary === "" ? null : Number(form.expectedSalary),
        keepOnFileMonths: form.keepOnFileMonths === "" ? undefined : Number(form.keepOnFileMonths),
        source: form.source || null,
        adMediaTypeId: form.adMediaTypeId || null,
        agencyId: form.agencyId || null,
        institutionName: form.institutionName || null,
        referralEmployeeId: form.referralEmployeeId || null,
        referralNote: form.referralEmployeeId ? (form.referralNote || null) : null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        city: form.city || null,
        placeOfBirth: form.placeOfBirth || null,
        identityNo: form.identityNo || null,
        birthDate: form.birthDate || null,
        gender: form.gender || null,
        maritalStatus: form.maritalStatus || null,
        notes: form.notes || null,
        educations: eduDrafts.filter((e) => e.level).map((e) => ({
          level: e.level,
          fieldOfStudy: e.fieldOfStudy || null,
          institution: e.institution || null,
          graduationYear: e.graduationYear === "" ? null : Number(e.graduationYear),
          gpa: e.gpa === "" ? null : Number(e.gpa),
        })),
        experiences: expDrafts.filter((e) => e.company || e.position || e.startYear !== "").map((e) => ({
          company: e.company || null,
          position: e.position || null,
          field: e.field || null,
          startYear: e.startYear === "" ? null : Number(e.startYear),
          endYear: e.endYear === "" ? null : Number(e.endYear),
          months: e.months === "" ? null : Number(e.months),
        })),
        skills: skillDrafts.filter((s) => s.skillId).map((s) => ({
          skillId: s.skillId,
          level: s.level || null,
        })),
      };
      if (dialog === "edit" && editId) {
        await apiSend("/api/rekankerja/recruitment/applicants", "PATCH", { action: "update", id: editId, ...body });
        toast.success(t("Data pelamar diperbarui", "Applicant updated"));
      } else {
        const res = await apiSend<{ row: ApplicantRow }>("/api/rekankerja/recruitment/applicants", "POST", body);
        toast.success(t(`Pelamar ${res.row.applicantNo} masuk talent pool`, `Applicant ${res.row.applicantNo} added to the talent pool`));
      }
      setDialog(null);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menyimpan pelamar", "Failed to save the applicant"));
    } finally { setBusy(false); }
  };

  const remove = async (r: ApplicantRow) => {
    if (!window.confirm(t(`Hapus pelamar ${r.applicantNo} — ${r.fullName}? Dokumen terkait ikut dihapus.`, `Delete applicant ${r.applicantNo} — ${r.fullName}? Related documents are deleted too.`))) return;
    try {
      await apiSend(`/api/rekankerja/recruitment/applicants?id=${r.id}`, "DELETE");
      toast.success(t(`Pelamar ${r.applicantNo} dihapus`, `Applicant ${r.applicantNo} deleted`));
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus pelamar", "Failed to delete the applicant"));
    }
  };

  // ---------- aksi blacklist / suspend / apply ----------

  const doBlacklist = async () => {
    if (!blTarget) return;
    if (!noteText.trim()) {
      toast.error(t("Alasan blacklist wajib diisi", "Blacklist reason is required"));
      return;
    }
    setActionBusy(true);
    try {
      await apiSend("/api/rekankerja/recruitment/applicants", "PATCH", { action: "blacklist", id: blTarget.id, note: noteText.trim() });
      toast.success(t(`Pelamar ${blTarget.applicantNo} di-blacklist`, `Applicant ${blTarget.applicantNo} blacklisted`));
      setBlTarget(null); setNoteText("");
      if (detail?.id === blTarget.id) await reloadDetail(blTarget.id);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    } finally { setActionBusy(false); }
  };

  const doUnblacklist = async (r: ApplicantRow) => {
    try {
      await apiSend("/api/rekankerja/recruitment/applicants", "PATCH", { action: "unblacklist", id: r.id });
      toast.success(t(`Blacklist pelamar ${r.applicantNo} dilepaskan`, `Applicant ${r.applicantNo} removed from blacklist`));
      if (detail?.id === r.id) await reloadDetail(r.id);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    }
  };

  const doSuspend = async () => {
    if (!susTarget) return;
    if (!noteText.trim()) {
      toast.error(t("Alasan suspend wajib diisi", "Suspend reason is required"));
      return;
    }
    setActionBusy(true);
    try {
      await apiSend("/api/rekankerja/recruitment/applicants", "PATCH", { action: "suspend", id: susTarget.id, note: noteText.trim(), until: untilText || null });
      toast.success(t(`Pelamar ${susTarget.applicantNo} di-suspend`, `Applicant ${susTarget.applicantNo} suspended`));
      setSusTarget(null); setNoteText(""); setUntilText("");
      if (detail?.id === susTarget.id) await reloadDetail(susTarget.id);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    } finally { setActionBusy(false); }
  };

  const doUnsuspend = async (r: ApplicantRow) => {
    try {
      await apiSend("/api/rekankerja/recruitment/applicants", "PATCH", { action: "unsuspend", id: r.id });
      toast.success(t(`Suspend pelamar ${r.applicantNo} diakhiri`, `Applicant ${r.applicantNo} suspension ended`));
      if (detail?.id === r.id) await reloadDetail(r.id);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Aksi gagal", "Action failed"));
    }
  };

  const doApply = async () => {
    if (!applyTarget) return;
    if (!applySlotId) {
      toast.error(t("Pilih slot lowongan terbuka", "Pick an open job slot"));
      return;
    }
    setActionBusy(true);
    try {
      const res = await apiSend<{ id: string; slotTitle: string; joRefNo: string }>("/api/rekankerja/recruitment/applicants", "PATCH", {
        action: "apply", applicantId: applyTarget.id, jobOpeningId: applySlotId, sourceNote: applyNote || null,
      });
      toast.success(t(`Pelamar ${applyTarget.applicantNo} melamar "${res.slotTitle}" (${res.joRefNo})`, `Applicant ${applyTarget.applicantNo} applied to "${res.slotTitle}" (${res.joRefNo})`));
      setApplyTarget(null); setApplySlotId(""); setApplyNote("");
      if (detail?.id === applyTarget.id) await reloadDetail(applyTarget.id);
      api.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal melamar", "Failed to apply"));
    } finally { setActionBusy(false); }
  };

  // ---------- dokumen ----------

  const uploadDoc = async () => {
    if (!detail) return;
    if (!docFile) {
      toast.error(t("Pilih file dokumen (JPG/PNG/WEBP/PDF ≤ 5 MB)", "Pick a document file (JPG/PNG/WEBP/PDF ≤ 5 MB)"));
      return;
    }
    setDocBusy(true);
    try {
      const fd = new FormData();
      fd.set("applicantId", detail.id);
      if (docRequiredId) fd.set("requiredDocumentId", docRequiredId);
      if (docTitle.trim()) fd.set("title", docTitle.trim());
      fd.set("file", docFile);
      await apiUpload("/api/rekankerja/recruitment/applicant-documents", fd);
      toast.success(t(`Dokumen "${docTitle.trim() || docFile.name}" diunggah`, `Document "${docTitle.trim() || docFile.name}" uploaded`));
      setDocFile(null); setDocTitle(""); setDocRequiredId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await reloadDetail(detail.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal mengunggah dokumen", "Failed to upload the document"));
    } finally { setDocBusy(false); }
  };

  const toggleVerified = async (docId: string, verified: boolean) => {
    if (!detail) return;
    try {
      await apiSend("/api/rekankerja/recruitment/applicant-documents", "PATCH", { id: docId, verified });
      await reloadDetail(detail.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal memperbarui verifikasi", "Failed to update verification"));
    }
  };

  const removeDoc = async (docId: string, title: string) => {
    if (!detail) return;
    if (!window.confirm(t(`Hapus dokumen "${title}"?`, `Delete document "${title}"?`))) return;
    try {
      await apiSend(`/api/rekankerja/recruitment/applicant-documents?id=${docId}`, "DELETE");
      toast.success(t("Dokumen dihapus", "Document deleted"));
      await reloadDetail(detail.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal menghapus dokumen", "Failed to delete the document"));
    }
  };

  // ---------- render ----------

  const expYears = (m: number) => t("{n} thn {r} bln", "{n} yr {r} mo", { n: String(Math.floor(m / 12)), r: String(m % 12) });

  const statCard = (key: string, label: string, labelEn: string, value: number | undefined, accent?: boolean) => (
    <button
      key={key}
      onClick={() => { setStatusFilter(statusFilter === key ? "all" : key); setOffset(0); }}
      className={cn(
        "rounded-xl border p-3 text-left transition-colors",
        statusFilter === key
          ? "ov-border-accent ov-soft"
          : accent
            ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10 hover:border-amber-400"
            : "border-slate-200 bg-white/80 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700",
      )}
    >
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t(label, labelEn)}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value ?? 0}</div>
    </button>
  );

  return (
    <div>
      <PageHeader
        eyebrow={t("Recruitment · Talent Pool")}
        title={t("Talent Pool (Pelamar)", "Talent Pool (Applicants)")}
        description={t(
          "Basis data pelamar — profil terenkripsi (UU PDP), pendidikan/pengalaman/skill, dokumen & riwayat lamaran multi-lowongan. Query builder pencarian di Advance Search. Padanan Applicant.",
          "Applicant database — encrypted profiles (Indonesian PDP law), education/experience/skills, documents & multi-opening application history. Search query builder in Advance Search. Applicant equivalent.",
        )}
        actions={canCreate && (
          <Button onClick={openNew} className="ov-fill ov-glow gap-2" disabled={busy}>
            <UserPlus className="h-4 w-4" aria-hidden /> {t("Pelamar Baru", "New Applicant")}
          </Button>
        )}
      />

      {/* ringkasan status */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {statCard("all", "Total", "Total", stats?.total)}
        {statCard("Active", "Aktif", "Active", stats?.active)}
        {statCard("Outdated", "Kedaluwarsa", "Outdated", stats?.outdated)}
        {statCard("Rejected", "Ditolak", "Rejected", stats?.rejected)}
        {statCard("Employed", "Bekerja", "Employed", stats?.employed)}
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Blacklist", "Blacklisted")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">{stats?.blacklisted ?? 0}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-900/80">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Suspend", "Suspended")}</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">{stats?.suspended ?? 0}</div>
        </div>
        <button
          className={cn(
            "rounded-xl border p-3 text-left transition-colors",
            (stats?.stagingPending ?? 0) > 0
              ? "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/10"
              : "border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80",
          )}
          title={t("Lamaran publik menunggu verifikasi — lihat view Lamaran Publik", "Public applications awaiting verification — see the Public Applications view")}
        >
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("Staging Menunggu", "Pending Staging")}</div>
          <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", (stats?.stagingPending ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-slate-900 dark:text-slate-50")}>
            {stats?.stagingPending ?? 0}
          </div>
          {(stats?.stagingPending ?? 0) > 0 && (
            <div className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <Inbox className="h-3 w-3" aria-hidden /> {t("lihat Lamaran Publik", "see Public Applications")}
            </div>
          )}
        </button>
      </div>

      {/* F6c — pencarian bebas natural-language (AI) di atas tabel */}
      <AiSearchBar onOpenDetail={(r) => void openDetail(r)} />

      <Card className="border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <CardContent className="p-4">
          {/* toolbar */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Cari nomor / nama / institusi…", "Search no. / name / institution…")}
                className="pl-9"
                aria-label={t("Pencarian", "Search")}
              />
            </div>
            <AdvSearchButton fields={ADV_FIELDS} value={adv} onChange={(v) => { setAdv(v); setOffset(0); }} />
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}>
              <CalendarRange className="h-4 w-4" aria-hidden />
              {sortDir === "desc" ? t("Terbaru", "Newest") : t("Terlama", "Oldest")}
            </Button>
          </div>

          {api.loading && !api.data ? (
            <LoadingRows rows={6} />
          ) : api.error ? (
            <EmptyState title={t("Gagal memuat daftar pelamar", "Failed to load applicants")} description={api.error} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={UsersRound}
              title={t("Belum ada pelamar di talent pool", "No applicants in the talent pool yet")}
              description={t(
                "Tambahkan pelamar manual atau verifikasi lamaran publik dari view Lamaran Publik.",
                "Add applicants manually or verify public applications from the Public Applications view.",
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Nomor / Nama", "No. / Name")}</TableHead>
                    <TableHead>{t("Status", "Status")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Sumber", "Source")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Melamar", "Applied")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("Keep-on-File s.d.", "Keep-on-File until")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Pendidikan", "Education")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Pengalaman", "Experience")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("Ekspektasi Gaji", "Expected Salary")}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t("Lamaran", "Applications")}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => void openDetail(r)}>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold">{r.applicantNo}</div>
                        <div className="font-medium">{r.fullName}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.emailMasked ?? "—"} · {r.phoneMasked ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Pill tone={A_TONE[r.status] ?? "slate"}>{t(A_LABEL[r.status] ?? r.status, A_LABEL_EN[r.status] ?? r.status)}</Pill>
                          {r.blacklist && <Pill tone="rose">{t("Blacklist", "Blacklist")}</Pill>}
                          {r.suspend && <Pill tone="amber">{t("Suspend", "Suspended")}</Pill>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {r.source ? t(SRC_LABEL[r.source] ?? r.source, SRC_LABEL_EN[r.source] ?? r.source) : "—"}
                        {r.referralName && (
                          <div className="mt-0.5">
                            <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400">
                              {t("Perujuk", "Referrer")}: {r.referralName}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">{fmtDay(r.dateApplied, locale)}</TableCell>
                      <TableCell className="hidden xl:table-cell text-xs">{fmtDay(r.keepOnFileUntil, locale)}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {r.highestEduLevel ?? "—"}
                        {r.highestGpa != null && <span className="text-slate-500 dark:text-slate-400"> · {r.highestGpa.toFixed(2)}</span>}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs">{expYears(r.totalExpMonths)}</TableCell>
                      <TableCell className="hidden xl:table-cell text-xs tabular-nums"
                        title={r.expectedSalary == null ? t("disembunyikan vault uang / kosong", "hidden by money vault / empty") : undefined}>
                        {r.expectedSalary != null ? fmtIDR(r.expectedSalary) : <span className="text-slate-400">—</span>}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-center text-xs font-semibold tabular-nums">{r.applicationCount}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t("Aksi pelamar", "Applicant actions")}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-60">
                            <DropdownMenuItem onClick={() => void openDetail(r)}><Eye className="h-4 w-4" /> {t("Lihat detail", "View detail")}</DropdownMenuItem>
                            {canUpdate && <DropdownMenuItem onClick={() => void openEdit(r)}><Pencil className="h-4 w-4" /> {t("Ubah", "Edit")}</DropdownMenuItem>}
                            {canParseCv && (
                              <DropdownMenuItem onClick={() => setCvTarget({ id: r.id, applicantNo: r.applicantNo, fullName: r.fullName })}>
                                <FileSearch className="h-4 w-4" /> {t("Parse CV (AI)…", "Parse CV (AI)…")}
                              </DropdownMenuItem>
                            )}
                            {canApply && <DropdownMenuItem onClick={() => { setApplyTarget(r); setApplySlotId(""); setApplyNote(""); }}><Send className="h-4 w-4" /> {t("Lamar ke Slot…", "Apply to Slot…")}</DropdownMenuItem>}
                            {canBlacklist && !r.blacklist && (
                              <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => { setBlTarget(r); setNoteText(""); }}>
                                <Ban className="h-4 w-4" /> {t("Blacklist (alasan wajib)…", "Blacklist (reason required)…")}
                              </DropdownMenuItem>
                            )}
                            {canBlacklist && r.blacklist && (
                              <DropdownMenuItem onClick={() => void doUnblacklist(r)}><CircleCheckBig className="h-4 w-4" /> {t("Lepas blacklist", "Remove blacklist")}</DropdownMenuItem>
                            )}
                            {canBlacklist && !r.suspend && (
                              <DropdownMenuItem onClick={() => { setSusTarget(r); setNoteText(""); setUntilText(""); }}>
                                <PauseCircle className="h-4 w-4" /> {t("Suspend (alasan wajib)…", "Suspend (reason required)…")}
                              </DropdownMenuItem>
                            )}
                            {canBlacklist && r.suspend && (
                              <DropdownMenuItem onClick={() => void doUnsuspend(r)}><PlayCircle className="h-4 w-4" /> {t("Akhirkan suspend", "End suspension")}</DropdownMenuItem>
                            )}
                            {canDelete && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-rose-600 focus:text-rose-600" onClick={() => void remove(r)}>
                                  <Trash2 className="h-4 w-4" /> {t("Hapus", "Delete")}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* pagination */}
          {total > PAGE_SIZE && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{t("Halaman {p} dari {n} — {t2} pelamar", "Page {p} of {n} — {t2} applicants", { p: String(page), n: String(pages), t2: String(total) })}</span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label={t("Halaman sebelumnya", "Previous page")}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={offset + PAGE_SIZE >= total}
                  onClick={() => setOffset(offset + PAGE_SIZE)} aria-label={t("Halaman berikutnya", "Next page")}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== dialog form create/edit (2 kolom + 3 sub-form array) ===== */}
      <Dialog open={dialog != null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {dialog === "edit"
                ? t("Ubah Pelamar — {no}", "Edit Applicant — {no}", { no: editNo })
                : t("Pelamar Baru", "New Applicant")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Identitas", "Identity")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>{t("Nama Depan *", "First Name *")}</Label>
                  <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Nama Tengah", "Middle Name")}</Label>
                  <Input value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Nama Belakang", "Last Name")}</Label>
                  <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Nama Tampilan", "Display Name")}</Label>
                  <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder={t("opsional — default gabungan nama", "optional — defaults to full name")} /></div>
                <div className="space-y-1.5"><Label>{t("Jenis Kelamin", "Gender")}</Label>
                  <Select value={form.gender || undefined} onValueChange={(v) => setForm({ ...form, gender: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent>{GENDERS.map(([k, l, lEn]) => <SelectItem key={k} value={k}>{t(l, lEn)}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>{t("Tanggal Lahir", "Birth Date")}</Label>
                  <Input type="date" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Tempat Lahir", "Place of Birth")}</Label>
                  <Input value={form.placeOfBirth} onChange={(e) => setForm({ ...form, placeOfBirth: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Status Perkawinan", "Marital Status")}</Label>
                  <Select value={form.maritalStatus || undefined} onValueChange={(v) => setForm({ ...form, maritalStatus: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent>{MARITAL.map(([k, l, lEn]) => <SelectItem key={k} value={k}>{t(l, lEn)}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>{t("No. Identitas (KTP/Paspor)", "Identity No. (ID Card/Passport)")}</Label>
                  <Input value={form.identityNo} onChange={(e) => setForm({ ...form, identityNo: e.target.value })} />
                  {dialog === "edit" && (
                    <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      {t("Terenkripsi — tidak ditampilkan kembali. Saat mengubah: kosong = nomor lama dihapus; isi ulang nilai yang sama untuk mempertahankannya.", "Encrypted — never shown again. When editing: empty = the old number is erased; re-type the same value to keep it.")}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Kontak", "Contact")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label>{t("Email", "Email")}</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Telepon", "Phone")}</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label>{t("Alamat", "Address")}</Label>
                  <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Kota", "City")}</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              </div>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Rekrutmen", "Recruitment")}</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {dialog === "new" && (
                  <div className="space-y-1.5"><Label>{t("Status", "Status")}</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{APPLICANT_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>)}</SelectContent>
                    </Select></div>
                )}
                <div className="space-y-1.5"><Label>{t("Tanggal Melamar", "Date Applied")}</Label>
                  <Input type="date" value={form.dateApplied} onChange={(e) => setForm({ ...form, dateApplied: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>{t("Siap Bekerja Mulai", "Available From")}</Label>
                  <Input type="date" value={form.dateAvailable} onChange={(e) => setForm({ ...form, dateAvailable: e.target.value })} /></div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1"><Wallet className="h-3 w-3" aria-hidden /> {t("Ekspektasi Gaji (Rp/bulan)", "Expected Salary (Rp/month)")}</Label>
                  <Input type="number" min={0} value={form.expectedSalary} onChange={(e) => setForm({ ...form, expectedSalary: e.target.value })} />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t("Terenkripsi vault uang — hanya role dengan izin yang melihat.", "Encrypted in the money vault — visible only to permitted roles.")}
                  </p>
                </div>
                <div className="space-y-1.5"><Label>{t("Keep-on-File (bulan)", "Keep-on-File (months)")}</Label>
                  <Input type="number" min={1} max={120} value={form.keepOnFileMonths} onChange={(e) => setForm({ ...form, keepOnFileMonths: e.target.value })} />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t("Setelah lewat, scheduler menandai pelamar Outdated.", "Once past, the scheduler flags the applicant Outdated.")}
                  </p></div>
                <div className="space-y-1.5"><Label>{t("Sumber", "Source")}</Label>
                  <Select value={form.source || undefined} onValueChange={(v) => setForm({ ...form, source: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Pilih sumber", "Pick a source")} /></SelectTrigger>
                    <SelectContent>{APPLICANT_SOURCES.map((s) => <SelectItem key={s.key} value={s.key}>{t(s.label, s.labelEn)}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>{t("Media Advertensi", "Ad Media")}</Label>
                  <Select value={form.adMediaTypeId || undefined} onValueChange={(v) => setForm({ ...form, adMediaTypeId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(adMediaApi.data?.rows ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>{t("Agency Tenaga Kerja", "Employment Agency")}</Label>
                  <Select value={form.agencyId || undefined} onValueChange={(v) => setForm({ ...form, agencyId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(agencyApi.data?.rows ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>)}
                    </SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>{t("Institusi Asal", "Source Institution")}</Label>
                  <Input value={form.institutionName} onChange={(e) => setForm({ ...form, institutionName: e.target.value })} placeholder={t("mis. kampus / lembaga diklat", "e.g. campus / training institute")} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label>{t("Direferensikan Karyawan", "Referred by Employee")}</Label>
                  <Select value={form.referralEmployeeId || undefined} onValueChange={(v) => setForm({ ...form, referralEmployeeId: v })}>
                    <SelectTrigger><SelectValue placeholder={t("Opsional — karyawan yang mereferensikan", "Optional — referring employee")} /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      {(prOptsApi.data?.employees ?? []).map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.employeeNo} — {e.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* B8-BL — catatan perujuk (kenapa merujuk); tampil hanya bila perujuk dipilih */}
                  {form.referralEmployeeId && (
                    <div className="mt-1.5 space-y-1.5">
                      <Label htmlFor="referral-note-input">{t("Catatan Perujuk", "Referrer Note")}</Label>
                      <Textarea
                        id="referral-note-input"
                        rows={2}
                        value={form.referralNote}
                        onChange={(e) => setForm({ ...form, referralNote: e.target.value })}
                        placeholder={t("mis. Teman kuliah, rajin — konteks kenapa merujuk", "e.g. College friend, hardworking — context for the referral")}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* pendidikan */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <GraduationCap className="h-3.5 w-3.5" aria-hidden /> {t("Pendidikan", "Education")}
                </h4>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={() => setEduDrafts([...eduDrafts, emptyEdu()])}>
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah", "Add")}
                </Button>
              </div>
              <div className="space-y-2">
                {eduDrafts.map((e, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700 sm:grid-cols-6">
                    <Select value={e.level || undefined} onValueChange={(v) => setEduDrafts(eduDrafts.map((x, xi) => xi === i ? { ...x, level: v } : x))}>
                      <SelectTrigger><SelectValue placeholder={t("Jenjang", "Level")} /></SelectTrigger>
                      <SelectContent>{EDU_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input value={e.fieldOfStudy} placeholder={t("Bidang", "Field")} onChange={(ev) => setEduDrafts(eduDrafts.map((x, xi) => xi === i ? { ...x, fieldOfStudy: ev.target.value } : x))} />
                    <Input value={e.institution} placeholder={t("Institusi", "Institution")} onChange={(ev) => setEduDrafts(eduDrafts.map((x, xi) => xi === i ? { ...x, institution: ev.target.value } : x))} />
                    <Input type="number" placeholder={t("Thn lulus", "Grad. year")} value={e.graduationYear} onChange={(ev) => setEduDrafts(eduDrafts.map((x, xi) => xi === i ? { ...x, graduationYear: ev.target.value } : x))} />
                    <Input type="number" step="0.01" min={0} max={4} placeholder="IPK" value={e.gpa} onChange={(ev) => setEduDrafts(eduDrafts.map((x, xi) => xi === i ? { ...x, gpa: ev.target.value } : x))} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600 dark:text-rose-400" aria-label={t("Hapus baris", "Remove row")}
                      onClick={() => setEduDrafts(eduDrafts.filter((_, xi) => xi !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            {/* pengalaman */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden /> {t("Pengalaman Kerja", "Work Experience")}
                </h4>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={() => setExpDrafts([...expDrafts, emptyExp()])}>
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah", "Add")}
                </Button>
              </div>
              <div className="space-y-2">
                {expDrafts.map((e, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700 sm:grid-cols-6">
                    <Input value={e.company} placeholder={t("Perusahaan", "Company")} onChange={(ev) => setExpDrafts(expDrafts.map((x, xi) => xi === i ? { ...x, company: ev.target.value } : x))} />
                    <Input value={e.position} placeholder={t("Posisi", "Position")} onChange={(ev) => setExpDrafts(expDrafts.map((x, xi) => xi === i ? { ...x, position: ev.target.value } : x))} />
                    <Input value={e.field} placeholder={t("Bidang", "Field")} onChange={(ev) => setExpDrafts(expDrafts.map((x, xi) => xi === i ? { ...x, field: ev.target.value } : x))} />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input type="number" placeholder={t("Mulai", "From")} value={e.startYear} onChange={(ev) => setExpDrafts(expDrafts.map((x, xi) => xi === i ? { ...x, startYear: ev.target.value } : x))} />
                      <Input type="number" placeholder={t("Sampai", "To")} value={e.endYear} onChange={(ev) => setExpDrafts(expDrafts.map((x, xi) => xi === i ? { ...x, endYear: ev.target.value } : x))} />
                    </div>
                    <Input type="number" min={0} placeholder={t("Durasi (bln)", "Duration (mo)")} value={e.months} onChange={(ev) => setExpDrafts(expDrafts.map((x, xi) => xi === i ? { ...x, months: ev.target.value } : x))} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600 dark:text-rose-400" aria-label={t("Hapus baris", "Remove row")}
                      onClick={() => setExpDrafts(expDrafts.filter((_, xi) => xi !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            {/* skill */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t("Skill", "Skills")}
                </h4>
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1" onClick={() => setSkillDrafts([...skillDrafts, emptySkill()])}>
                  <UserPlus className="h-3.5 w-3.5" aria-hidden /> {t("Tambah", "Add")}
                </Button>
              </div>
              <div className="space-y-2">
                {skillDrafts.map((s, i) => (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-2.5 dark:border-slate-700 sm:grid-cols-3">
                    <Select value={s.skillId || undefined} onValueChange={(v) => setSkillDrafts(skillDrafts.map((x, xi) => xi === i ? { ...x, skillId: v } : x))}>
                      <SelectTrigger><SelectValue placeholder={t("Pilih skill (master)", "Pick a skill (master)")} /></SelectTrigger>
                      <SelectContent className="max-h-64">
                        {(skillApi.data?.rows ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name ?? m.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={s.level || undefined} onValueChange={(v) => setSkillDrafts(skillDrafts.map((x, xi) => xi === i ? { ...x, level: v } : x))}>
                      <SelectTrigger><SelectValue placeholder={t("Level", "Level")} /></SelectTrigger>
                      <SelectContent>{SKILL_LEVELS.map((l) => <SelectItem key={l} value={l}>{t(l, l)}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600 dark:text-rose-400" aria-label={t("Hapus baris", "Remove row")}
                      onClick={() => setSkillDrafts(skillDrafts.filter((_, xi) => xi !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t("Catatan", "Notes")}</h4>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={save} disabled={busy} className="ov-fill">
              {busy ? t("Menyimpan…", "Saving…") : dialog === "edit" ? t("Simpan Perubahan", "Save Changes") : t("Simpan Pelamar", "Save Applicant")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog detail multi-tab (4xl) ===== */}
      <Dialog open={detail != null || detailLoading} onOpenChange={(o) => { if (!o) { setDetail(null); setDetailLoading(false); } }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail ? (
                <>
                  <span className="font-mono">{detail.applicantNo}</span>
                  <Pill tone={A_TONE[detail.status] ?? "slate"}>{t(A_LABEL[detail.status] ?? detail.status, A_LABEL_EN[detail.status] ?? detail.status)}</Pill>
                  {detail.blacklist && <Pill tone="rose">{t("Blacklist", "Blacklist")}</Pill>}
                  {detail.suspend && <Pill tone="amber">{t("Suspend", "Suspended")}</Pill>}
                  <span className="min-w-0 flex-1 truncate text-sm font-normal text-slate-500 dark:text-slate-400">{detail.fullName}</span>
                </>
              ) : (
                <span className="text-sm text-slate-400">{t("Memuat detail…", "Loading detail…")}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailLoading && !detail ? (
            <LoadingRows rows={4} />
          ) : detail && (
            <Tabs defaultValue="profil" className="w-full">
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1 bg-slate-100 p-1 dark:bg-slate-900">
                <TabsTrigger value="profil">{t("Profil", "Profile")}</TabsTrigger>
                <TabsTrigger value="edu">{t("Pendidikan & Skill", "Education & Skills")}</TabsTrigger>
                <TabsTrigger value="docs">{t("Dokumen ({n})", "Documents ({n})", { n: String(detail.documents.length) })}</TabsTrigger>
                {canParseCv && (
                  <TabsTrigger value="cvparse">
                    <FileSearch className="h-3.5 w-3.5" aria-hidden /> {t("Parse CV", "Parse CV")}
                  </TabsTrigger>
                )}
                <TabsTrigger value="apps">{t("Lamaran ({n})", "Applications ({n})", { n: String(detail.applications.length) })}</TabsTrigger>
                <TabsTrigger value="consent">{t("Consent ({n})", "Consent ({n})", { n: String(detail.consents.length) })}</TabsTrigger>
              </TabsList>

              {/* (a) profil */}
              <TabsContent value="profil" className="mt-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  {([
                    [t("Nama Lengkap", "Full Name"), detail.fullName],
                    [t("Nama Tampilan", "Display Name"), detail.displayName ?? "—"],
                    [t("Tanggal Melamar", "Date Applied"), fmtDay(detail.dateApplied, locale)],
                    [t("Siap Bekerja Mulai", "Available From"), fmtDay(detail.dateAvailable, locale)],
                    [t("Ekspektasi Gaji", "Expected Salary"), detail.expectedSalary != null ? fmtIDR(detail.expectedSalary) : t("disembunyikan / kosong", "hidden / empty")],
                    [t("Keep-on-File", "Keep-on-File"), `${detail.keepOnFileMonths} ${t("bulan", "months")} (s.d. ${fmtDay(detail.keepOnFileUntil, locale)})`],
                    [t("Sumber", "Source"), detail.source ? t(SRC_LABEL[detail.source] ?? detail.source, SRC_LABEL_EN[detail.source] ?? detail.source) : "—"],
                    [t("Media Advertensi", "Ad Media"), detail.adMediaName ?? "—"],
                    [t("Agency", "Agency"), detail.agencyName ?? "—"],
                    [t("Institusi Asal", "Source Institution"), detail.institutionName ?? "—"],
                    [t("Direferensikan", "Referred By"), detail.referralName ?? "—"],
                    [t("Catatan Perujuk", "Referrer Note"), detail.referralNote ?? "—"],
                    [t("Insentif Referral (manual)", "Referral Reward (manual)"), detail.referralRewardNote ?? t("—"),],
                    [t("Email", "Email"), detail.email ?? "—"],
                    [t("Telepon", "Phone"), detail.phone ?? "—"],
                    [t("Alamat", "Address"), detail.address ?? "—"],
                    [t("Kota", "City"), detail.city ?? "—"],
                    [t("Tempat Lahir", "Place of Birth"), detail.placeOfBirth ?? "—"],
                    [t("Tanggal Lahir", "Birth Date"), fmtDay(detail.birthDate, locale)],
                    [t("Jenis Kelamin", "Gender"), detail.gender ? t(GENDERS.find((g) => g[0] === detail.gender)?.[1] ?? detail.gender, GENDERS.find((g) => g[0] === detail.gender)?.[2] ?? detail.gender) : "—"],
                    [t("Status Perkawinan", "Marital Status"), detail.maritalStatus ? t(MARITAL.find((m) => m[0] === detail.maritalStatus)?.[1] ?? detail.maritalStatus, MARITAL.find((m) => m[0] === detail.maritalStatus)?.[2] ?? detail.maritalStatus) : "—"],
                    [t("No. Identitas", "Identity No."), detail.identityNoMasked ?? "—"],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{k}</div>
                      <div className="break-words font-medium">{v}</div>
                    </div>
                  ))}
                </div>

                {(detail.blacklist || detail.suspend) && (
                  <div className="mt-3 space-y-2">
                    {detail.blacklist && (
                      <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 text-xs dark:border-rose-500/30 dark:bg-rose-500/10">
                        <span className="font-bold text-rose-700 dark:text-rose-400">{t("Blacklist", "Blacklist")}:</span>{" "}
                        <span className="text-rose-800 dark:text-rose-300">{detail.blacklistNote ?? "—"}{detail.blacklistAt ? ` (${fmtDay(detail.blacklistAt, locale)})` : ""}</span>
                      </div>
                    )}
                    {detail.suspend && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
                        <span className="font-bold text-amber-700 dark:text-amber-400">{t("Suspend", "Suspended")}:</span>{" "}
                        <span className="text-amber-800 dark:text-amber-300">{detail.suspendNote ?? "—"}{detail.suspendUntil ? ` — ${t("s.d.", "until")} ${fmtDay(detail.suspendUntil, locale)}` : ""}</span>
                      </div>
                    )}
                  </div>
                )}

                {detail.notes && (
                  <div className="mt-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{t("Catatan", "Notes")}</div>
                    <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">{detail.notes}</p>
                  </div>
                )}
              </TabsContent>

              {/* (b) pendidikan & pengalaman & skill */}
              <TabsContent value="edu" className="mt-3 space-y-4">
                <div>
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <GraduationCap className="h-3.5 w-3.5" aria-hidden /> {t("Pendidikan", "Education")}
                  </h4>
                  {detail.educations.length === 0 ? <p className="text-xs text-slate-400">{t("tanpa data", "no data")}</p> : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>{t("Jenjang", "Level")}</TableHead>
                          <TableHead>{t("Bidang", "Field")}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t("Institusi", "Institution")}</TableHead>
                          <TableHead>{t("Lulus", "Graduated")}</TableHead>
                          <TableHead>{t("IPK", "GPA")}</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {detail.educations.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="font-semibold">{e.level}</TableCell>
                              <TableCell className="text-xs">{e.fieldOfStudy ?? "—"}</TableCell>
                              <TableCell className="hidden sm:table-cell text-xs">{e.institution ?? "—"}</TableCell>
                              <TableCell className="text-xs tabular-nums">{e.graduationYear ?? "—"}</TableCell>
                              <TableCell className="text-xs tabular-nums">{e.gpa != null ? e.gpa.toFixed(2) : "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <BriefcaseBusiness className="h-3.5 w-3.5" aria-hidden /> {t("Pengalaman Kerja", "Work Experience")}
                  </h4>
                  {detail.experiences.length === 0 ? <p className="text-xs text-slate-400">{t("tanpa data", "no data")}</p> : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <Table>
                        <TableHeader><TableRow>
                          <TableHead>{t("Perusahaan", "Company")}</TableHead>
                          <TableHead>{t("Posisi", "Position")}</TableHead>
                          <TableHead className="hidden sm:table-cell">{t("Bidang", "Field")}</TableHead>
                          <TableHead>{t("Periode", "Period")}</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                          {detail.experiences.map((e) => (
                            <TableRow key={e.id}>
                              <TableCell className="text-xs font-medium">{e.company ?? "—"}</TableCell>
                              <TableCell className="text-xs">{e.position ?? "—"}</TableCell>
                              <TableCell className="hidden sm:table-cell text-xs">{e.field ?? "—"}</TableCell>
                              <TableCell className="text-xs tabular-nums">
                                {e.startYear ?? "—"}{e.endYear ? ` – ${e.endYear}` : e.startYear ? ` – ${t("kini", "now")}` : ""}
                                {e.months != null && <span className="text-slate-400"> ({e.months} bln)</span>}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> {t("Skill", "Skills")}
                  </h4>
                  {detail.skills.length === 0 ? <p className="text-xs text-slate-400">{t("tanpa data", "no data")}</p> : (
                    <div className="flex flex-wrap gap-1.5">
                      {detail.skills.map((s) => (
                        <Badge key={s.id} variant="secondary" className="gap-1 font-normal">
                          {s.skillName}{s.level ? <span className="text-slate-400">· {s.level}</span> : null}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* (c) dokumen */}
              <TabsContent value="docs" className="mt-3 space-y-3">
                {canCreate && (
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      <UploadCloud className="h-3.5 w-3.5" aria-hidden /> {t("Unggah Dokumen Baru", "Upload New Document")}
                    </h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("Jenis Dokumen Wajib", "Required Document Type")}</Label>
                        <Select value={docRequiredId || undefined} onValueChange={setDocRequiredId}>
                          <SelectTrigger><SelectValue placeholder={t("Opsional", "Optional")} /></SelectTrigger>
                          <SelectContent className="max-h-64">
                            {(reqDocApi.data?.rows ?? []).map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.title ?? d.name ?? d.code}{d.mandatory ? " *" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("Judul Dokumen", "Document Title")}</Label>
                        <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder={t("default nama file", "defaults to file name")} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("File (JPG/PNG/WEBP/PDF ≤ 5 MB)", "File (JPG/PNG/WEBP/PDF ≤ 5 MB)")}</Label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ACCEPT_ATTRIBUTE}
                          className="w-full text-xs"
                          onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" className="ov-fill gap-1.5" onClick={uploadDoc} disabled={docBusy}>
                        <UploadCloud className="h-3.5 w-3.5" aria-hidden />
                        {docBusy ? t("Mengunggah…", "Uploading…") : t("Unggah", "Upload")}
                      </Button>
                    </div>
                  </div>
                )}

                {detail.documents.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                    {t("Belum ada dokumen", "No documents yet")}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t("Dokumen", "Document")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("Jenis Wajib", "Required Type")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("File", "File")}</TableHead>
                        <TableHead>{t("Verifikasi", "Verified")}</TableHead>
                        <TableHead className="w-20" />
                      </TableRow></TableHeader>
                      <TableBody>
                        {detail.documents.map((d) => (
                          <TableRow key={d.id}>
                            <TableCell className="text-xs font-medium">{d.title}</TableCell>
                            <TableCell className="hidden sm:table-cell text-xs">
                              {d.requiredDocTitle
                                ? <span>{d.requiredDocTitle}{d.requiredDocMandatory ? " *" : ""}</span>
                                : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-xs">
                              {d.attachmentId ? (
                                <a className="font-semibold text-brand-deep hover:underline dark:text-brand/80" href={`/api/rekankerja/attachments/${d.attachmentId}`} target="_blank" rel="noopener noreferrer">
                                  {d.fileName ?? "file"}{d.sizeBytes != null && <span className="font-normal text-slate-400"> · {fmtSize(d.sizeBytes)}</span>}
                                </a>
                              ) : <span className="text-slate-400">—</span>}
                            </TableCell>
                            <TableCell>
                              <Button variant="ghost" size="sm"
                                className={cn("h-7 gap-1 px-2 text-[11px] font-bold", d.verified ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500")}
                                disabled={!canUpdate}
                                onClick={() => void toggleVerified(d.id, !d.verified)}
                                title={t("tandai / batal verifikasi", "toggle verification")}>
                                <CircleCheckBig className="h-3.5 w-3.5" aria-hidden />
                                {d.verified ? t("Terverifikasi", "Verified") : t("Belum", "Unverified")}
                              </Button>
                            </TableCell>
                            <TableCell>
                              {canDelete && (
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-600 dark:text-rose-400" title={t("Hapus dokumen", "Delete document")}
                                  onClick={() => void removeDoc(d.id, d.title)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* (c2) parse CV — F6a human-verify (tab terpisah: seksi hasil besar,
                  tab Dokumen sudah padat form upload + tabel + toggle verifikasi) */}
              {canParseCv && (
                <TabsContent value="cvparse" className="mt-3">
                  <CvParseSection
                    applicant={{ id: detail.id, applicantNo: detail.applicantNo, fullName: detail.fullName }}
                    documents={detail.documents}
                    canVerify={canUpdate}
                  />
                </TabsContent>
              )}

              {/* (d) lamaran */}
              <TabsContent value="apps" className="mt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <Send className="h-3.5 w-3.5" aria-hidden /> {t("Riwayat Lamaran", "Application History")}
                  </h4>
                  {canApply && !detail.blacklist && !detail.suspend && detail.status !== "Employed" && (
                    <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => { setApplyTarget(detail); setApplySlotId(""); setApplyNote(""); }}>
                      <Send className="h-3.5 w-3.5" aria-hidden /> {t("Lamar ke Slot…", "Apply to Slot…")}
                    </Button>
                  )}
                </div>
                {detail.applications.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                    {t("Belum pernah melamar slot lowongan", "Has not applied to any job slot yet")}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t("Slot / Lowongan", "Slot / Opening")}</TableHead>
                        <TableHead>{t("Tanggal", "Date")}</TableHead>
                        <TableHead>{t("Status", "Status")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("Catatan", "Note")}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {detail.applications.map((ap) => (
                          <TableRow key={ap.id}>
                            <TableCell>
                              <div className="text-xs font-medium">{ap.slotTitle ?? "—"}</div>
                              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{ap.joRefNo}</div>
                            </TableCell>
                            <TableCell className="text-xs">{fmtDay(ap.dateApplied, locale)}</TableCell>
                            <TableCell><Pill tone={ap.status === "Hired" ? "teal" : ap.status === "Rejected" ? "rose" : ap.status === "Screening" ? "amber" : "slate"}>
                              {t(APP_LABEL[ap.status] ?? ap.status, APP_LABEL_EN[ap.status] ?? ap.status)}
                            </Pill></TableCell>
                            <TableCell className="hidden sm:table-cell text-xs">{ap.sourceNote ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* (e) consent */}
              <TabsContent value="consent" className="mt-3">
                {detail.consents.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-xs text-slate-500 dark:border-slate-700">
                    {t("Belum ada catatan persetujuan", "No consent records")}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t("Tujuan", "Purpose")}</TableHead>
                        <TableHead>{t("Versi", "Version")}</TableHead>
                        <TableHead className="hidden sm:table-cell">{t("Kanal", "Channel")}</TableHead>
                        <TableHead>{t("Diberikan", "Granted")}</TableHead>
                        <TableHead className="hidden md:table-cell">{t("Ditarik", "Withdrawn")}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {detail.consents.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="text-xs font-medium">{c.purpose}</TableCell>
                            <TableCell className="font-mono text-xs">{c.version}</TableCell>
                            <TableCell className="hidden sm:table-cell text-xs">{c.channel}</TableCell>
                            <TableCell className="text-xs">{fmtDay(c.grantedAt, locale)}</TableCell>
                            <TableCell className="hidden md:table-cell text-xs">{fmtDay(c.withdrawnAt, locale)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {t("Jejak persetujuan pemrosesan data pribadi (UU PDP) — tercatat otomatis dari form publik / input manual.", "Personal data processing consent trail (Indonesian PDP law) — recorded automatically from the public form / manual input.")}
                </p>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setDetail(null); setDetailLoading(false); }}>{t("Tutup", "Close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog blacklist ===== */}
      <Dialog open={blTarget != null} onOpenChange={(o) => { if (!o) setBlTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Blacklist Pelamar", "Blacklist Applicant")} — {blTarget?.applicantNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Pelamar di-blacklist tidak bisa melamar slot lowongan mana pun. Alasan wajib.", "A blacklisted applicant cannot apply to any job slot. A reason is required.")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Alasan *", "Reason *")}</Label>
              <Textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("mis. data palsu saat verifikasi", "e.g. falsified data during verification")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={doBlacklist} disabled={actionBusy}>
              {actionBusy ? t("Memproses…", "Processing…") : t("Blacklist", "Blacklist")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog suspend ===== */}
      <Dialog open={susTarget != null} onOpenChange={(o) => { if (!o) setSusTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Suspend Pelamar", "Suspend Applicant")} — {susTarget?.applicantNo}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Suspend sementara — pelamar tidak bisa melamar selama masa suspend. Alasan wajib.", "Temporary suspension — the applicant cannot apply while suspended. A reason is required.")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Alasan *", "Reason *")}</Label>
              <Textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("Suspend Sampai (opsional)", "Suspend Until (optional)")}</Label>
              <Input type="date" value={untilText} onChange={(e) => setUntilText(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSusTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={doSuspend} disabled={actionBusy}>
              {actionBusy ? t("Memproses…", "Processing…") : t("Suspend", "Suspend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog lamar ke slot ===== */}
      <Dialog open={applyTarget != null} onOpenChange={(o) => { if (!o) setApplyTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Lamar ke Slot — {no}", "Apply to Slot — {no}", { no: applyTarget?.applicantNo ?? "" })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t("Daftarkan pelamar ke slot lowongan yang masih terbuka (multi-lamar).", "Enroll the applicant to a still-open job slot (multi-application).")}
            </p>
            <div className="space-y-1.5">
              <Label>{t("Slot Terbuka *", "Open Slot *")}</Label>
              <Select value={applySlotId || undefined} onValueChange={setApplySlotId}>
                <SelectTrigger><SelectValue placeholder={t("Pilih slot (JO Posted · slot Open)", "Pick a slot (Posted JO · Open slot)")} /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {openSlots.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-400">{t("tidak ada slot terbuka", "no open slots")}</div>}
                  {openSlots.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.titleToShow} — {s.joRefNo} ({s.prNo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea rows={2} value={applyNote} onChange={(e) => setApplyNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyTarget(null)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={doApply} disabled={actionBusy} className="ov-fill">
              {actionBusy ? t("Memproses…", "Processing…") : t("Daftarkan Lamaran", "Enroll Application")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== dialog Parse CV (F6a — aksi baris tabel) ===== */}
      <ParseCvDialog
        open={cvTarget != null}
        onOpenChange={(o) => { if (!o) setCvTarget(null); }}
        applicant={cvTarget}
        canVerify={canUpdate}
      />
    </div>
  );
}
