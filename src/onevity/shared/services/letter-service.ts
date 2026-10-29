// OneVity — LAYANAN SURAT (template → render → terbitkan → PDF) ============
// =====================================================================
// Task 3-LETTERS — mesin surat cetak perusahaan (schema-per-tenant):
//   · renderLetterBody   — ganti setiap {{token}} dari konteks (kosong → "—")
//   · buildLetterContext — susun konteks SEMUA token dari data tenant
//     (Company, CompanyOffice, snapshot karyawan, DisciplinaryRecord,
//     PersonnelAction + detailJson)
//   · issueLetter        — terbitkan LetterDocument idempoten (refNo
//     001/HR-DIS/X/2026) + ActivityLog; body disimpan sebagai snapshot
//     hasil render (audit & cetak ulang tahan edit template).
//   · letterPdfBuffer    — PDF A4 portrait (pdf-lib, font standard
//     WinAnsi — pola payslip-pdf.ts).
//
// Server-only (db Prisma tenant + pdf-lib) — dipakai route API surat.
// =====================================================================
import type { TenantDb } from "@/onevity/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/onevity/shared/lib/field-crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "@cantoo/pdf-lib";
import type { PdfEsignStamp } from "./esign-service";

// ---------- tipe input (struktural — cocok utk hasil include Prisma) ----------

/** Karyawan + relasi snapshot yang dibutuhkan surat (pola flattening disciplinary API). */
export interface LetterEmployee {
  id: string;
  fullName: string;
  employeeNo: string;
  joinDate: Date;
  companyOfficeId: string | null;
  position?: { title: string | null } | null;
  orgUnit?: { name: string | null } | null;
  grade?: { code: string | null } | null;
  positionLevel?: { name: string | null } | null;
  // identitas utk surat layanan (SK kerja/gaji/pengalaman & PKWT 26-a)
  nationalId?: string | null;
  birthPlace?: string | null;
  birthDate?: Date | null;
  address?: string | null;
  endDate?: Date | null;
  contractStart?: Date | null;
  contractEnd?: Date | null;
  renewalCount?: number | null;
  /** assignment aktif (validTo null) — sumber status kepegawaian + gaji pokok. */
  assignments?: { employmentStatus: string; baseSalary: number }[];
}

/** Catatan disiplin sumber surat. */
export interface LetterDisciplinaryRecord {
  id: string;
  warningLevel: string; // Verbal|Written|Final
  violation: string;
  sanction: string | null;
  issuedAt: Date;
  expiresAt: Date | null;
  notes: string | null;
}

/** Personnel Action sumber surat (detailJson diparse di sini). */
export interface LetterPersonnelAction {
  id: string;
  type: string;
  effectiveDate: Date;
  reason: string | null;
  detailJson: string | null;
}

/** Baris LetterTemplate tenant. */
export interface LetterTemplateRow {
  key: string;
  category: string;
  name: string;
  description: string | null;
  subject: string | null;
  body: string;
  signatoryName: string | null;
  signatoryTitle: string;
  active: boolean;
}

/** Hasil issueLetter (dipakai route + UI pratinjau). */
export interface IssuedLetter {
  id: string;
  refNo: string;
  body: string;
  subject: string | null;
  templateName: string;
  employeeName: string;
  issuedAt: Date;
}

// ---------- util format tanggal Indonesia (long) ----------

const BULAN_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Tanggal panjang Indonesia: "17 September 2026". */
export function fmtDateIdLong(d: Date): string {
  return `${d.getDate()} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
}

/** Rupiah teks: 15000000 → "Rp 15.000.000". */
export function fmtRupiahText(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** Masa kerja teks Indonesia: "3 tahun 4 bulan" / "7 bulan" / "5 tahun". */
export function fmtTenureId(joinDate: Date | null | undefined): string {
  if (!joinDate) return "—";
  const d = new Date(joinDate);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months--;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years <= 0 && rest <= 0) return "kurang dari 1 bulan";
  if (years <= 0) return `${rest} bulan`;
  if (rest <= 0) return `${years} tahun`;
  return `${years} tahun ${rest} bulan`;
}

/** Template surat yang boleh memuat nilai gaji (sensitive — hanya SK Gaji & PKWT). */
const SALARY_TEMPLATE_KEYS = new Set(["EMP_SK_GAJI", "EMP_PKWT"]);

/**
 * Total tunjangan tetap bulanan karyawan: komponen Earning tetap (calcMethod
 * Fixed, wageType Compensation) dari item wage-template profil payroll +
 * assignment Periodic aktif. Gaji pokok TIDAK dihitung (sudah token sendiri).
 */
async function fixedAllowanceOf(db: TenantDb, employeeId: string): Promise<number> {
  try {
    const profile = await db.employeePayrollProfile.findUnique({
      where: { employeeId },
      select: { wageTemplateId: true },
    });
    let sum = 0;
    const isFixedEarning = (c: { type: string; wageType: string; calcMethod: string }) =>
      c.type === "Earning" && c.wageType === "Compensation" && c.calcMethod === "Fixed";
    // 1. item wage-template profil payroll (amount override 0 → pakai amount master)
    if (profile?.wageTemplateId) {
      const tpl = await db.wageTemplate.findUnique({
        where: { id: profile.wageTemplateId },
        include: { items: { include: { wageComponent: true } } },
      });
      for (const it of tpl?.items ?? []) {
        if (!it.wageComponent || !isFixedEarning(it.wageComponent)) continue;
        // WageTemplateItem.amount TIDAK dienkripsi (master template, bukan nilai
        // per-karyawan — di luar lingkup 28-c; hanya EmployeeComponentAssignment).
        sum += it.wageComponent.amount;
      }
    }
    // 2. komponen Periodic aktif milik karyawan (tunjangan khusus tetap)
    const periodic = await db.employeeComponentAssignment.findMany({
      where: { employeeId, active: true, kind: "Periodic" },
      include: { wageComponent: true },
    });
    // 28-c: amount komponen tersimpan terenkripsi — dekripsi (0 → pakai master).
    const tc = tenantCryptoForDb(db);
    for (const p of periodic) {
      if (!p.wageComponent || !isFixedEarning(p.wageComponent)) continue;
      const pAmount = tc.decryptMoney(p.amount) ?? 0;
      sum += pAmount > 0 ? pAmount : p.wageComponent.amount;
    }
    return sum;
  } catch {
    return 0; // profil/komponen belum tersedia → tunjangan 0, surat tetap terbit
  }
}

/** Bulan Romawi I..XII (untuk nomor surat). */
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

// karakter tipografi umum → padanan WinAnsi (pola payslip-pdf.ts)
const CHAR_MAP: Record<string, string> = {
  "\u2013": "-", "\u2014": "-", "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
  "\u2026": "...", "\u00B7": "\u00B7", "\u2022": "-", "\u00A0": " ", "\u20AC": "EUR",
  "\u2212": "-", "\u2264": "<=", "\u2265": ">=", "\u00D7": "x",
};

/** Sanitasi teks agar aman di-encode font standard pdf-lib (WinAnsi). */
function safe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (CHAR_MAP[ch] !== undefined) out += CHAR_MAP[ch];
    else {
      const code = ch.codePointAt(0) ?? 63;
      out += code >= 0x20 && code <= 0xff ? ch : "?"; // buang karakter eksotis
    }
  }
  return out;
}

// ================= MESIN RENDER =================

/**
 * Ganti setiap {{token}} pada body template dengan nilai konteks.
 * Token tidak dikenal / nilai kosong → "—" (surat formal tak boleh kosong).
 */
export function renderLetterBody(body: string, ctx: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) => {
    const v = ctx[token];
    return v != null && v.trim() !== "" ? v : "—";
  });
}

/** Ambil nilai string aman (null/undefined → "—"). */
const val = (v: string | null | undefined): string => (v != null && v.trim() !== "" ? v : "—");

/**
 * Susun konteks untuk SELURUH token katalog LETTER_PLACEHOLDERS.
 * Token sumber: Company (baris pertama), CompanyOffice karyawan
 * (fallback kantor pertama perusahaan), snapshot karyawan, relasi
 * DisciplinaryRecord / PersonnelAction (+detailJson).
 */
export async function buildLetterContext(
  db: TenantDb,
  opts: {
    employee: LetterEmployee;
    template: LetterTemplateRow;
    disciplinaryRecord?: LetterDisciplinaryRecord | null;
    personnelAction?: LetterPersonnelAction | null;
    letterNo: string;
    /** keperluan surat (permintaan ESS / input HR) — default "sesuai keperluan". */
    purpose?: string | null;
  },
): Promise<Record<string, string>> {
  const { employee, template, disciplinaryRecord, personnelAction, letterNo, purpose } = opts;

  // ---- Perusahaan (baris pertama) + kantor penempatan karyawan ----
  const company = await db.company.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, address: true, city: true, phone: true, taxId: true },
  });
  let office: { name: string | null; city: string | null; npwp: string | null } | null = null;
  if (employee.companyOfficeId) {
    office = await db.companyOffice.findUnique({
      where: { id: employee.companyOfficeId },
      select: { name: true, city: true, npwp: true },
    });
  }
  if (!office && company) {
    // fallback: kantor pertama perusahaan
    office = await db.companyOffice.findFirst({
      where: { companyId: company.id, active: true },
      orderBy: { createdAt: "asc" },
      select: { name: true, city: true, npwp: true },
    });
  }

  const ctx: Record<string, string> = {
    // Surat & perusahaan
    letter_no: letterNo,
    letter_date: fmtDateIdLong(new Date()),
    city: val(office?.city || company?.city),
    company_name: val(company?.name),
    company_address: val(company?.address),
    company_city: val(company?.city),
    company_phone: val(company?.phone),
    company_npwp: val(company?.taxId),
    office_name: val(office?.name),
    office_city: val(office?.city),
    office_npwp: val(office?.npwp),
    signatory_name: template.signatoryName || "________________",
    signatory_title: val(template.signatoryTitle),

    // Data karyawan (snapshot + assignment aktif)
    employee_name: val(employee.fullName),
    employee_no: val(employee.employeeNo),
    employee_position: val(employee.position?.title),
    employee_org_unit: val(employee.orgUnit?.name),
    employee_grade: val(employee.grade?.code),
    employee_level: val(employee.positionLevel?.name),
    employee_status: val(employee.assignments?.[0]?.employmentStatus),
    join_date: employee.joinDate ? fmtDateIdLong(new Date(employee.joinDate)) : "—",

    // Surat layanan karyawan (26-a) — identitas, masa kerja, kontrak PKWT
    purpose: purpose?.trim() || "sesuai keperluan",
    nik: val(employee.nationalId),
    birth_date: employee.birthDate ? fmtDateIdLong(new Date(employee.birthDate)) : "—",
    birth_place: val(employee.birthPlace),
    alamat: val(employee.address),
    status_kerja: val(employee.assignments?.[0]?.employmentStatus),
    masa_kerja: fmtTenureId(employee.joinDate),
    // aktif → "hingga saat ini" (SK pengalaman/referensi utk karyawan aktif)
    end_date: employee.endDate ? fmtDateIdLong(new Date(employee.endDate)) : "hingga saat ini",
    contract_start: employee.contractStart ? fmtDateIdLong(new Date(employee.contractStart)) : "—",
    contract_end: employee.contractEnd ? fmtDateIdLong(new Date(employee.contractEnd)) : "—",
    renewal_count: String((employee.renewalCount ?? 0) + 1),
    // nilai gaji (SENSITIVE) — hanya dirender utk EMP_SK_GAJI & EMP_PKWT
    gaji_pokok: "—",
    tunjangan_tetap: "—",
    total_bruto: "—",

    // Personnel Action (diisi bila surat bersumber PA)
    effective_date: "—",
    reason: "—",
    last_day: "—",
    new_position: "—",
    new_org_unit: "—",
    new_grade: "—",
    new_salary: "—",
    new_status: "—",
    contract_until: "—",
    probation_until: "—",

    // Disipliner (diisi bila surat bersumber catatan disiplin)
    warning_level: "—",
    warning_no: "—",
    violation: "—",
    sanction: "—",
    issued_at: "—",
    expires_at: "—",
    validity_months: "—",
    notes: "—",
  };

  // ---- Konteks GAJI (hanya template sensitive EMP_SK_GAJI & EMP_PKWT) ----
  if (SALARY_TEMPLATE_KEYS.has(template.key)) {
    const base = employee.assignments?.[0]?.baseSalary ?? 0;
    const allowance = await fixedAllowanceOf(db, employee.id);
    ctx.gaji_pokok = fmtRupiahText(base);
    ctx.tunjangan_tetap = fmtRupiahText(allowance);
    ctx.total_bruto = fmtRupiahText(base + allowance);
  }

  // ---- Konteks DISIPLINER ----
  if (disciplinaryRecord) {
    const r = disciplinaryRecord;
    ctx.violation = val(r.violation);
    ctx.sanction = val(r.sanction);
    ctx.issued_at = r.issuedAt ? fmtDateIdLong(new Date(r.issuedAt)) : "—";
    ctx.expires_at = r.expiresAt ? fmtDateIdLong(new Date(r.expiresAt)) : "—";
    // masa berlaku dalam bulan penuh; tanpa tanggal berakhir → 6 bulan (ketentuan umum)
    if (r.expiresAt) {
      const i = new Date(r.issuedAt);
      const e = new Date(r.expiresAt);
      const months =
        (e.getFullYear() - i.getFullYear()) * 12 + (e.getMonth() - i.getMonth()) -
        (e.getDate() < i.getDate() ? 1 : 0);
      ctx.validity_months = String(Math.max(months, 0));
    } else {
      ctx.validity_months = "6";
    }
    ctx.warning_level =
      r.warningLevel === "Verbal" ? "Teguran Lisan"
      : r.warningLevel === "Written" ? "Surat Peringatan Tertulis"
      : r.warningLevel === "Final" ? "Surat Peringatan Terakhir"
      : val(r.warningLevel);
    // urutan surat peringatan karyawan pada level YANG SAMA (1-based)
    const sameLevel = await db.disciplinaryRecord.findMany({
      where: { employeeId: employee.id, warningLevel: r.warningLevel },
      orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const idx = sameLevel.findIndex((row) => row.id === r.id);
    ctx.warning_no = String(idx >= 0 ? idx + 1 : 1);
    ctx.notes = val(r.notes);
  }

  // ---- Konteks PERSONNEL ACTION ----
  if (personnelAction) {
    const pa = personnelAction;
    ctx.effective_date = pa.effectiveDate ? fmtDateIdLong(new Date(pa.effectiveDate)) : "—";
    ctx.reason = val(pa.reason);

    // detailJson: kode master disimpan sebagai id+code — resolve ke nama
    // yang enak dibaca di surat (Posisi → title, Unit → name).
    let det: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(pa.detailJson ?? "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) det = parsed as Record<string, unknown>;
    } catch { /* detailJson korup → abaikan, token tetap "—" */ }

    const str = (v: unknown): string | null =>
      (v == null || v === "" || v === false) ? null : String(v);

    // posisi baru: id → title, fallback nilai teks (toPosition/plannedPosition)
    const positionId = str(det.positionId) ?? str(det.toPositionId);
    let newTitle: string | null = null;
    if (positionId) {
      const p = await db.position.findUnique({ where: { id: positionId }, select: { title: true } });
      newTitle = p?.title ?? null;
    }
    ctx.new_position = val(newTitle ?? str(det.toPosition) ?? str(det.plannedPosition));

    // unit baru: id → name, fallback nilai teks (toUnit/newUnit/toOrgUnit)
    const unitId = str(det.orgUnitId) ?? str(det.toUnitId);
    let newUnit: string | null = null;
    if (unitId) {
      const u = await db.orgUnit.findUnique({ where: { id: unitId }, select: { name: true } });
      newUnit = u?.name ?? null;
    }
    ctx.new_org_unit = val(newUnit ?? str(det.toUnit) ?? str(det.newUnit) ?? str(det.toOrgUnit));

    // grade baru (kode grade — "G4" dsb.)
    ctx.new_grade = val(str(det.newGrade));

    // remunerasi baru → format Rupiah
    const salaryRaw = det.newSalary ?? det.plannedSalary;
    if (salaryRaw != null && salaryRaw !== "" && !Number.isNaN(Number(salaryRaw))) {
      ctx.new_salary = fmtRupiahText(Number(salaryRaw));
    }

    ctx.new_status = val(str(det.newStatus) ?? str(det.newEmploymentStatus));
    ctx.last_day = val(str(det.lastDay) ? fmtDateIdLong(new Date(String(det.lastDay))) : null);
    ctx.contract_until = val(
      str(det.contractUntil) ? fmtDateIdLong(new Date(String(det.contractUntil)))
      : str(det.newEndDate) ? fmtDateIdLong(new Date(String(det.newEndDate)))
      : null,
    );
    ctx.probation_until = val(
      str(det.probationUntil) ? fmtDateIdLong(new Date(String(det.probationUntil)))
      : str(det.newEndDate) ? fmtDateIdLong(new Date(String(det.newEndDate)))
      : null,
    );
  }

  return ctx;
}

// ================= TERBITKAN SURAT =================

/**
 * Terbitkan LetterDocument dari template:
 *   1. template by key (+aktif) — belum ada → Error ramah (aktifkan dulu);
 *   2. IDEMPOTEN — surat untuk (PA|Disciplinary + templateKey) sama sudah
 *      ada → kembalikan dokumen lama (klik "Surat" dua kali aman);
 *   3. refNo 001/HR-DIS|HR-PA/X/2026 (urutan kategori + tahun);
 *   4. render snapshot body + ActivityLog.
 */
export async function issueLetter(
  db: TenantDb,
  opts: {
    category: "Disciplinary" | "PersonnelAction" | "EmployeeService";
    templateKey: string;
    employeeId: string;
    personnelActionId?: string | null;
    disciplinaryRecordId?: string | null;
    actorId?: string | null;
    /** keperluan surat layanan (Permintaan ESS / input HR saat terbit dari profil). */
    purpose?: string | null;
  },
): Promise<IssuedLetter> {
  const { category, templateKey, employeeId } = opts;

  // 1. template aktif (bila nonaktif/absen → pesan mengarah ke menu Template Surat)
  let template = await db.letterTemplate.findFirst({ where: { key: templateKey, active: true } });
  if (!template) {
    const anyState = await db.letterTemplate.findUnique({ where: { key: templateKey } });
    const name = anyState?.name ?? templateKey;
    throw new Error(
      `Template surat untuk ${name} belum tersedia — aktifkan/buat dulu di menu Template Surat`,
    );
  }

  // 2. idempoten per dokumen sumber + template
  const sourceFilter = opts.personnelActionId
    ? { personnelActionId: opts.personnelActionId, templateKey }
    : opts.disciplinaryRecordId
      ? { disciplinaryRecordId: opts.disciplinaryRecordId, templateKey }
      : null;
  if (sourceFilter) {
    const existing = await db.letterDocument.findFirst({
      where: sourceFilter,
      include: { employee: { select: { fullName: true } } },
      orderBy: { issuedAt: "desc" },
    });
    if (existing) {
      const meta = parseMeta(existing.metaJson);
      return {
        id: existing.id,
        refNo: existing.refNo,
        body: existing.body,
        subject: existing.subject,
        templateName: meta.templateName ?? existing.templateKey,
        employeeName: existing.employee.fullName,
        issuedAt: existing.issuedAt,
      };
    }
  }

  // data sumber (untuk konteks render)
  const employee = await loadLetterEmployee(db, employeeId);
  const disciplinaryRecord = opts.disciplinaryRecordId
    ? (await db.disciplinaryRecord.findUnique({ where: { id: opts.disciplinaryRecordId } })) ?? null
    : null;
  const personnelAction = opts.personnelActionId
    ? (await db.personnelAction.findUnique({ where: { id: opts.personnelActionId } })) ?? null
    : null;

  // 3. nomor surat berurutan per kategori + tahun
  const now = new Date();
  const year = now.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const countSame = await db.letterDocument.count({
    where: { category, issuedAt: { gte: yearStart, lt: yearEnd } },
  });
  const code = category === "Disciplinary" ? "HR-DIS" : category === "PersonnelAction" ? "HR-PA" : "HR-ES";
  const refNo = `${String(countSame + 1).padStart(3, "0")}/${code}/${ROMAN[now.getMonth()]}/${year}`;

  // 4. render snapshot + simpan + jejak aktivitas
  const ctx = await buildLetterContext(db, {
    employee,
    template,
    disciplinaryRecord,
    personnelAction,
    letterNo: refNo,
    purpose: opts.purpose ?? null,
  });
  const body = renderLetterBody(template.body, ctx);

  const doc = await db.letterDocument.create({
    data: {
      refNo,
      templateKey,
      category,
      employeeId,
      personnelActionId: opts.personnelActionId ?? null,
      disciplinaryRecordId: opts.disciplinaryRecordId ?? null,
      subject: template.subject,
      body,
      metaJson: JSON.stringify({
        templateName: template.name,
        templateKey,
        officeId: employee.companyOfficeId,
        ...(opts.purpose?.trim() ? { purpose: opts.purpose.trim() } : {}),
      }),
      issuedAt: now,
      createdById: opts.actorId ?? null,
    },
  });
  await db.activityLog.create({
    data: {
      action: "Created",
      entity: "LetterDocument",
      entityId: doc.id,
      employeeId,
      personnelActionId: opts.personnelActionId ?? undefined,
      appUserId: opts.actorId ?? undefined,
      detail: `Surat ${template.name} ${refNo} diterbitkan`,
    },
  });

  return {
    id: doc.id,
    refNo,
    body,
    subject: doc.subject,
    templateName: template.name,
    employeeName: employee.fullName,
    issuedAt: doc.issuedAt,
  };
}

/** Parse metaJson LetterDocument dengan aman. */
export function parseMeta(metaJson: string | null): { templateName?: string; templateKey?: string; officeId?: string; purpose?: string } {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson) as Record<string, unknown>;
    return (parsed && typeof parsed === "object" ? parsed : {}) as { templateName?: string; templateKey?: string; officeId?: string; purpose?: string };
  } catch {
    return {};
  }
}

/** Muat karyawan + relasi snapshot yang dibutuhkan konteks surat. */
export async function loadLetterEmployee(db: TenantDb, employeeId: string): Promise<LetterEmployee> {
  // 28-c: NIK & gaji pokok tersimpan terenkripsi — dekripsi di sini (surat
  // merender nilai riil {{nik}} / gaji via placeholder server-side).
  const tc = tenantCryptoForDb(db);
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true, fullName: true, employeeNo: true, joinDate: true, companyOfficeId: true,
      nationalId: true, birthPlace: true, birthDate: true, address: true,
      endDate: true, contractStart: true, contractEnd: true, renewalCount: true,
      position: { select: { title: true } },
      orgUnit: { select: { name: true } },
      grade: { select: { code: true } },
      positionLevel: { select: { name: true } },
      assignments: {
        where: { validTo: null },
        orderBy: { validFrom: "desc" },
        take: 1,
        select: { employmentStatus: true, baseSalary: true },
      },
    },
  });
  if (!emp) throw new Error("Karyawan tidak ditemukan");
  return {
    ...emp,
    nationalId: tc.decryptText(emp.nationalId),
    assignments: emp.assignments.map((a) => ({ ...a, baseSalary: tc.decryptMoney(a.baseSalary) ?? 0 })),
  };
}

// ================= PDF (pola payslip-pdf.ts) =================

/** Data minimal LetterDocument untuk PDF. */
export interface LetterPdfDoc {
  refNo: string;
  body: string;
  subject?: string | null;
}

/** Kop perusahaan (baris Company pertama). */
export interface LetterPdfCompany {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  taxId: string | null;
}

/** Kantor penempatan (NPWP kantor utama kop bila ada). */
export interface LetterPdfOffice {
  name?: string | null;
  city?: string | null;
  npwp?: string | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const CONTENT_W = A4[0] - MARGIN * 2;
const BODY_SIZE = 11;
const BODY_LEADING = 17;
const INK = rgb(0.13, 0.12, 0.11);
const INK_SOFT = rgb(0.42, 0.40, 0.38);
const RULE = rgb(0.85, 0.84, 0.82);
const ACCENT = rgb(0.13, 0.29, 0.24);

/**
 * Bangun PDF surat A4 portrait:
 *   · kop tengah — nama perusahaan bold 14, "alamat — kota", telepon,
 *     "NPWP: …" (NPWP kantor ?? NPWP perusahaan) 9pt;
 *   · garis tipis + isi body snapshot;
 *   · paragraf dipisah baris kosong; baris berawalan ≥4 spasi = baris
 *     rincian menjorok (x+36, tanpa re-wrap); lainnya word-wrap
 *     (ukur widthOfTextAtSize); multi-halaman saat y < 110.
 * Mengembalikan bytes PDF (Uint8Array).
 */
export async function letterPdfBuffer(
  doc: LetterPdfDoc,
  company: LetterPdfCompany | null,
  office?: LetterPdfOffice | null,
  esign?: PdfEsignStamp | null,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Surat ${doc.refNo}`);
  pdf.setSubject(doc.subject ?? doc.refNo);
  pdf.setProducer("OneVity HRIS");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage(A4);
  let y = A4[1] - MARGIN;

  const txt = (text: string, x: number, yy: number, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "center" } = {}) => {
    const size = opts.size ?? BODY_SIZE;
    const font = opts.font ?? regular;
    const s = safe(text);
    let xx = x;
    if (opts.align === "center") xx = x - font.widthOfTextAtSize(s, size) / 2;
    page.drawText(s, { x: xx, y: yy, size, font, color: opts.color ?? INK });
  };

  /** Pindah halaman bila ruang vertikal kurang. */
  const ensure = (need: number) => {
    if (y - need < 110) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };

  // ================= KOP (halaman pertama) =================
  const cx = A4[0] / 2;
  const companyName = company?.name ?? "OneVity HRIS";
  txt(companyName, cx, y, { size: 14, font: bold, color: ACCENT, align: "center" });
  y -= 15;
  if (company) {
    const place = [company.address, company.city].filter((p): p is string => !!p).join(" — ");
    if (place) { txt(place, cx, y, { size: 9, color: INK_SOFT, align: "center" }); y -= 11; }
    if (company.phone) { txt(company.phone, cx, y, { size: 9, color: INK_SOFT, align: "center" }); y -= 11; }
    const npwp = office?.npwp ?? company.taxId ?? "—";
    txt(`NPWP: ${npwp}`, cx, y, { size: 9, color: INK_SOFT, align: "center" });
    y -= 13;
  }
  // garis pemisah tipis
  page.drawRectangle({ x: MARGIN, y: y - 2, width: CONTENT_W, height: 0.7, color: RULE });
  y -= 26;

  // ================= ISI (snapshot body) =================
  const wrap = (text: string): string[] => {
    const words = safe(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (regular.widthOfTextAtSize(test, BODY_SIZE) <= CONTENT_W) cur = test;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // paragraf dipisah baris kosong
  const paragraphs = doc.body.split(/\n[ \t]*\n/);
  for (const para of paragraphs) {
    const rawLines = para.split("\n");
    for (const raw of rawLines) {
      if (!raw.trim()) continue; // baris kosong di dalam paragraf
      if (/^ {4,}/.test(raw)) {
        // baris rincian menjorok — digambar apa adanya (tanpa re-wrap)
        ensure(BODY_LEADING);
        txt(raw.replace(/^ +/, ""), MARGIN + 36, y, {});
        y -= BODY_LEADING;
      } else {
        for (const line of wrap(raw)) {
          ensure(BODY_LEADING);
          txt(line, MARGIN, y, {});
          y -= BODY_LEADING;
        }
      }
    }
    y -= BODY_LEADING; // jeda antarparagraf
  }

  // ================= BLOK e-SIGN (Task 80b) =================
  // Ditandatangani secara elektronik (OneVity e-Sign) — QR ke /v/[id].
  if (esign) {
    ensure(118);

    y -= 6;
    const qr = await pdf.embedPng(esign.qrPng as unknown as Parameters<typeof pdf.embedPng>[0]);
    // Gambar QR dulu — embedPng/drawImage BISA menambah halaman via ensure
    // internal pdf-lib; refresh `page` = halaman TERAKHIR sebelum menggambar teks
    page = pdf.getPage(pdf.getPageCount() - 1);
    page.drawImage(qr, { x: MARGIN, y: y - 84, width: 84, height: 84 });

    const LX = MARGIN + 100; // kolom teks di kanan QR
    page.drawRectangle({ x: LX, y: y - 86, width: 2, height: 92, color: ACCENT });
    let ly = y;
    txt("DITANDATANGANI SECARA ELEKTRONIK", LX + 10, ly, { size: 8.5, font: bold, color: ACCENT });
    ly -= 13;
    txt(`melalui OneVity e-Sign — ${esign.docRef}`, LX + 10, ly, { size: 8.5, color: INK_SOFT });
    ly -= 13;
    txt(esign.signerName + (esign.signerRole ? ` · ${esign.signerRole}` : ""), LX + 10, ly, { size: 10, font: bold });
    ly -= 12;
    txt(formatWibLabel(esign.signedAtIso), LX + 10, ly, { size: 8.5, color: INK_SOFT });
    ly -= 12;
    txt(`Hash: ${esign.docHashShort}…`, LX + 10, ly, { size: 7.5, color: INK_SOFT });
    ly -= 12;
    // URL verifikasi dipotong agar muas satu baris
    const url = esign.verifyUrl;
    txt(url.length > 66 ? url.slice(0, 63) + "…" : url, LX + 10, ly, { size: 7.5, color: INK_SOFT });
    y = ly - 10;
  }

  return pdf.save();
}

const BULAN_ID_QR = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function formatWibLabel(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const wib = new Date(d.getTime() + 7 * 60 * 60_000);
  return `Waktu tanda tangan: ${p(wib.getUTCDate())} ${BULAN_ID_QR[wib.getUTCMonth()]} ${wib.getUTCFullYear()} ${p(wib.getUTCHours())}:${p(wib.getUTCMinutes())} WIB`;
}
