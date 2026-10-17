// P1.1-BM (D-BM1) — SERVICE pengajuan perubahan data diri ESS ================
// =====================================================================
// Edit profil ESS = PENGAJUAN (bukan tulis langsung): whitelist field
// pribadi non-master; field gaji/organisasi/kepegawaian TETAP hanya via
// Personnel Action (ditolak 400 di sini). Status Submitted→Approved/
// Rejected/Cancelled; approve AKHIR = patch otomatis oleh HR (before/after
// tersimpan di fieldsJson + ActivityLog).
//   · submitChange — validasi whitelist + capture before SERVER-SIDE +
//     docNo PCR-YYYY-NNNN (retryOnUnique) + startApprovalChain docType
//     "ProfileChange" + ActivityLog Submitted;
//   · decide — decideApprovalChain (approve advances / reject stops);
//     approval FINAL → applyPatch (skalar Employee + kontak darurat,
//     telepon terenkripsi enc:v1) + ActivityLog before→after;
//   · cancelChange — karyawan membatalkan SENDIRI selama Submitted;
//   · listRequests/myRequests/getRequest — getter + ringkasan chain.
// NPWP (D-BM3, advisori): helper npwpAdvisory — normalisasi titik/garis,
// 15/16 digit valid; SALAH FORMAT = warning di UI, data TETAP disimpan
// (tanpa checksum — DJP modulus tidak diimplementasikan, jangan mengarang).
// =====================================================================
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { retryOnUnique } from "@/rekankerja/shared/lib/doc-no-retry";
import {
  startApprovalChain, getApprovalChain, decideApprovalChain, cancelApprovalChain,
  attachChainSummaries, type ChainSummary, type DecideActor,
} from "@/rekankerja/shared/services/approval-engine";

/** docType approval-engine (sudah terdaftar di Phase 0 — JANGAN duplikat). */
export const PROFILE_CHANGE_DOC_TYPE = "ProfileChange" as const;

// ============ error domain ============

/** Error domain service — route memetakan .status ke response HTTP. */
export class ProfileChangeError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProfileChangeError";
    this.status = status;
  }
}

// ============ whitelist field pribadi (D-BM1) ============

/**
 * Field skalar Employee yang BOLEH diubah lewat pengajuan ESS. Nama field
 = persis kolom model Employee (phone = telepon pribadi tunggal — model
 * tidak punya phoneNo/mobile terpisah). Field master (jabatan/gaji/status/
 * penempatan/NIK/NPWP/BPJS/bank) TIDAK masuk whitelist — wajib Personnel
 * Action.
 */
export const PROFILE_CHANGE_FIELDS: Record<string, { label: string; labelEn: string }> = {
  address: { label: "Alamat", labelEn: "Address" },
  city: { label: "Kota", labelEn: "City" },
  email: { label: "Email Pribadi", labelEn: "Personal Email" },
  phone: { label: "Telepon", labelEn: "Phone" },
  maritalStatus: { label: "Status Pernikahan", labelEn: "Marital Status" },
};

/** Nilai maksimum per field skalar (alamat panjang — 500). */
const FIELD_VALUE_MAX = 500;
/** Batas entri per pengajuan (field + kontak digabung). */
const ENTRIES_MAX = 30;
/** Batas panjang alasan pengajuan. */
const REASON_MAX = 500;

// ============ bentuk entri (fieldsJson) ============

/** Entri perubahan FIELD SKALAR — before ditangkap server-side. */
export interface PcFieldEntry {
  kind: "field";
  field: string;
  label: string;
  labelEn: string;
  before: string | null;
  after: string | null;
}

/** Nilai kontak darurat (snapshot before + nilai baru). */
export interface PcContactData {
  name: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
}

/** Entri perubahan KONTAK DARURAT (tambah/ubah/hapus). */
export interface PcContactEntry {
  kind: "contact";
  op: "add" | "update" | "remove";
  contactId: string | null;
  after: PcContactData;
  before: PcContactData | null;
}

export type PcEntry = PcFieldEntry | PcContactEntry;

/** Input entri dari klien (before TIDAK dipercaya dari klien). */
export interface PcEntryInput {
  kind?: string;
  field?: string;
  op?: string;
  contactId?: string | null;
  after?: string | null;
  name?: string | null;
  relationship?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

// ============ NPWP advisori (D-BM3 — format SAJA, tanpa checksum) ============

export interface NpwpAdvisoryResult {
  /** nilai yang disimpan (normalisasi digits bila 15/16 digit; mentah bila salah). */
  value: string | null;
  /** true bila format TIDAK valid (bukan 15/16 digit setelah normalisasi). */
  warning: boolean;
}

/**
 * Validasi NPWP advisori: normalisasi titik/garis/spasi → harus 15 atau 16
 * digit. Salah format → warning (data TETAP disimpan apa adanya — tidak
 * memblokir data lama). TIDAK ada checksum DJP — jangan mengarang algoritma.
 */
export function npwpAdvisory(raw: string | null | undefined): NpwpAdvisoryResult {
  const v = String(raw ?? "").trim();
  if (!v) return { value: null, warning: false };
  const digits = v.replace(/[\s.\-]/g, "");
  if (/^\d{15}$/.test(digits) || /^\d{16}$/.test(digits)) {
    return { value: digits, warning: false };
  }
  return { value: v, warning: true };
}

/** Masking no. telepon utk jejak log (2 awal + 4 akhir). */
function maskPhone(p: string): string {
  if (p.length <= 6) return "••••";
  return `${p.slice(0, 2)}••••${p.slice(-4)}`;
}

// ============ validasi input ============

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normScalar(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, FIELD_VALUE_MAX);
}

/**
 * Validasi + normalisasi entri dari klien. Nilai BEFORE ditangkap dari
 * Employee/kontak tersimpan (server-side — klien tidak pernah dipercaya).
 */
async function buildEntries(
  db: TenantDb,
  employeeId: string,
  inputs: PcEntryInput[],
): Promise<{ fields: PcFieldEntry[]; contacts: PcContactEntry[] }> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, address: true, city: true, email: true, phone: true, maritalStatus: true },
  });
  if (!emp) throw new ProfileChangeError("Karyawan tidak ditemukan", 404);

  const fields: PcFieldEntry[] = [];
  const contacts: PcContactEntry[] = [];
  const seen = new Set<string>();

  for (const raw of inputs) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.kind === "field") {
      const field = String(raw.field ?? "").trim();
      const meta = PROFILE_CHANGE_FIELDS[field];
      if (!meta) {
        // field master / tak dikenal → 400 + daftar field yang diizinkan + arahan PA
        throw new ProfileChangeError(
          `Field "${field || "(kosong)"}" tidak diizinkan untuk pengajuan ubah data diri. ` +
          `Field yang diizinkan: ${Object.keys(PROFILE_CHANGE_FIELDS).map((f) => `${f} (${PROFILE_CHANGE_FIELDS[f]!.label})`).join(", ")}. ` +
          "Perubahan data master kepegawaian (jabatan, unit, grade, gaji, status, NIK/NPWP/BPJS/rekening) " +
          "wajib melalui Personnel Action.",
          400,
        );
      }
      if (seen.has(field)) continue;
      seen.add(field);
      const after = normScalar(raw.after);
      const before = normScalar((emp as unknown as Record<string, unknown>)[field]);
      // no-op: nilai sama persis → tidak perlu diajukan
      if (after === before) continue;
      if (field === "email" && after && !EMAIL_RE.test(after)) {
        throw new ProfileChangeError("Format email pribadi tidak valid", 400);
      }
      fields.push({ kind: "field", field, label: meta.label, labelEn: meta.labelEn, before, after });
    } else if (raw.kind === "contact") {
      const op = raw.op === "add" ? "add" : raw.op === "update" ? "update" : raw.op === "remove" ? "remove" : null;
      if (!op) throw new ProfileChangeError("Operasi kontak darurat harus add / update / remove", 400);
      const name = String(raw.name ?? "").trim().slice(0, 100);
      const relationship = String(raw.relationship ?? "").trim().slice(0, 50);
      const phone = String(raw.phone ?? "").trim().slice(0, 30);
      const isPrimary = raw.isPrimary === true;
      const contactId = raw.contactId ? String(raw.contactId) : null;

      if (op === "add") {
        if (!name || !relationship || !phone) {
          throw new ProfileChangeError("Nama, hubungan, dan telepon kontak darurat wajib diisi", 400);
        }
        contacts.push({ kind: "contact", op, contactId: null, after: { name, relationship, phone, isPrimary }, before: null });
      } else {
        if (!contactId) throw new ProfileChangeError("contactId wajib untuk mengubah/menghapus kontak darurat", 400);
        const existing = await db.emergencyContact.findUnique({ where: { id: contactId } });
        if (!existing || existing.employeeId !== employeeId) {
          throw new ProfileChangeError("Kontak darurat tidak ditemukan pada profil Anda", 404);
        }
        const tc = tenantCryptoForDb(db);
        const beforeData: PcContactData = {
          name: existing.name, relationship: existing.relationship,
          phone: tc.decryptText(existing.phone) ?? "", isPrimary: existing.isPrimary,
        };
        if (op === "remove") {
          contacts.push({ kind: "contact", op, contactId, after: beforeData, before: beforeData });
        } else {
          if (!name || !relationship || !phone) {
            throw new ProfileChangeError("Nama, hubungan, dan telepon kontak darurat wajib diisi", 400);
          }
          contacts.push({ kind: "contact", op, contactId, after: { name, relationship, phone, isPrimary }, before: beforeData });
        }
      }
    } else {
      throw new ProfileChangeError('Setiap entri harus berupa {kind:"field"} atau {kind:"contact"}', 400);
    }
  }

  return { fields, contacts };
}

// ============ submit ============

export interface SubmitChangeInput {
  employeeId: string;
  entries: PcEntryInput[];
  reason?: string | null;
}

/** Aktor pengajuan (karyawan ESS) — dicatat ke ActivityLog. */
export interface ProfileChangeActorRef {
  appUserId: string | null;
  name: string;
}

export async function submitChange(
  db: TenantDb,
  input: SubmitChangeInput,
  actor: ProfileChangeActorRef,
): Promise<{ id: string; docNo: string; entries: PcEntry[] }> {
  const { employeeId } = input;
  if (!employeeId) throw new ProfileChangeError("employeeId wajib", 400);
  const inputs = Array.isArray(input.entries) ? input.entries : [];
  if (inputs.length === 0) {
    throw new ProfileChangeError("Pengajuan harus memuat minimal satu perubahan (field atau kontak darurat)", 400);
  }
  if (inputs.length > ENTRIES_MAX) {
    throw new ProfileChangeError(`Maksimal ${ENTRIES_MAX} entri per pengajuan`, 400);
  }
  const reason = String(input.reason ?? "").trim().slice(0, REASON_MAX) || null;

  // validasi whitelist + capture before (server-side)
  const { fields, contacts } = await buildEntries(db, employeeId, inputs);
  const entries: PcEntry[] = [...fields, ...contacts];
  if (entries.length === 0) {
    throw new ProfileChangeError(
      "Tidak ada perubahan efektif — nilai baru sama dengan nilai saat ini untuk seluruh field yang diajukan",
      400,
    );
  }

  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { fullName: true, employeeNo: true },
  });
  if (!emp) throw new ProfileChangeError("Karyawan tidak ditemukan", 404);

  // docNo PCR-YYYY-NNNN race-safe (pola doc-no-retry — REC-AUDIT-FIX)
  const year = new Date().getFullYear();
  const prefix = `PCR-${year}-`;
  const created = await retryOnUnique(async () => {
    const last = await db.employeeProfileChangeRequest.findFirst({
      where: { docNo: { startsWith: prefix } },
      orderBy: { docNo: "desc" },
      select: { docNo: true },
    });
    const lastSeq = last ? Number(last.docNo.slice(prefix.length).replace(/\D/g, "")) : 0;
    const docNo = `${prefix}${String((Number.isFinite(lastSeq) ? lastSeq : 0) + 1).padStart(4, "0")}`;
    const row = await db.employeeProfileChangeRequest.create({
      data: {
        docNo,
        employeeId,
        fieldsJson: JSON.stringify(entries),
        reason,
        status: "Submitted",
      },
      select: { id: true, docNo: true },
    });
    return row;
  });

  // jalur persetujuan (docType terdaftar Phase 0; tanpa template aktif →
  // fallback anti-deadlock atasan langsung → Admin/HR)
  await startApprovalChain(db, {
    docType: PROFILE_CHANGE_DOC_TYPE,
    docId: created.id,
    employeeId,
    amount: null,
    createdBy: actor.name,
  });

  await db.activityLog.create({
    data: {
      appUserId: actor.appUserId ?? undefined,
      action: "Submitted",
      entity: "ProfileChange",
      entityId: created.docNo,
      employeeId,
      detail:
        `Pengajuan ubah data diri ${created.docNo} diajukan dari ESS oleh ${emp.fullName} (${emp.employeeNo})` +
        ` — ${fields.length} field${contacts.length > 0 ? ` + ${contacts.length} kontak darurat` : ""}` +
        `${reason ? ` — alasan: ${reason}` : ""}`,
    },
  }).catch(() => { /* audit best-effort — tidak menggagalkan pengajuan */ });

  return { id: created.id, docNo: created.docNo, entries };
}

// ============ apply patch (approve final) ============

function contactSummary(e: PcContactEntry): string {
  const c = e.after;
  const phone = maskPhone(c.phone);
  switch (e.op) {
    case "add":
      return `Kontak darurat DITAMBAH: ${c.name} (${c.relationship}) — telp ${phone}${c.isPrimary ? " [utama]" : ""}`;
    case "remove":
      return `Kontak darurat DIHAPUS: ${c.name} (${c.relationship})`;
    default:
      return `Kontak darurat DIUBAH: ${c.name} (${c.relationship}) — telp ${phone}${c.isPrimary ? " [utama]" : ""}`;
  }
}

/**
 * Terapkan patch ke Employee + kontak darurat (dipanggil saat approval
 * FINAL). Skalar = update langsung; kontak add/update/remove dengan telepon
 * TERENKRIPSI enc:v1 (pola employees.ts bankAccount). Detail before→after
 * ditulis ke ActivityLog (TANPA nominal uang — tidak ada uang di sini).
 */
async function applyPatch(
  db: TenantDb,
  req: { id: string; docNo: string; employeeId: string },
  entries: PcEntry[],
  actor: { name: string; employeeId: string | null },
  note: string | null,
): Promise<void> {
  const tc = tenantCryptoForDb(db);
  const scalarData: Record<string, string | null> = {};
  const detailParts: string[] = [];

  for (const e of entries) {
    if (e.kind === "field") {
      scalarData[e.field] = e.after;
      detailParts.push(`${e.label}: "${e.before ?? "—"}" → "${e.after ?? "—"}"`);
    }
  }
  if (Object.keys(scalarData).length > 0) {
    await db.employee.update({ where: { id: req.employeeId }, data: scalarData });
  }

  for (const e of entries) {
    if (e.kind !== "contact") continue;
    if (e.op === "add") {
      await db.emergencyContact.create({
        data: {
          employeeId: req.employeeId,
          name: e.after.name,
          relationship: e.after.relationship,
          // encryptText(maybe-null) → string | null; telepon divalidasi
          // non-kosong saat submit — kembalikan string (kolom NOT NULL).
          phone: tc.encryptText(e.after.phone) ?? "",
          isPrimary: e.after.isPrimary,
        },
      });
    } else if (e.op === "update" && e.contactId) {
      await db.emergencyContact.updateMany({
        where: { id: e.contactId, employeeId: req.employeeId },
        data: {
          name: e.after.name,
          relationship: e.after.relationship,
          phone: tc.encryptText(e.after.phone) ?? "",
          isPrimary: e.after.isPrimary,
        },
      });
    } else if (e.op === "remove" && e.contactId) {
      await db.emergencyContact.deleteMany({ where: { id: e.contactId, employeeId: req.employeeId } });
    }
    detailParts.push(contactSummary(e));
  }

  const emp = await db.employee.findUnique({
    where: { id: req.employeeId },
    select: { fullName: true, employeeNo: true },
  });

  await db.employeeProfileChangeRequest.update({
    where: { id: req.id },
    data: { status: "Approved", decidedById: actor.employeeId, decidedAt: new Date(), decisionNote: note },
  });

  await db.activityLog.create({
    data: {
      action: "Approved",
      entity: "ProfileChange",
      entityId: req.docNo,
      employeeId: req.employeeId,
      detail:
        `Pengajuan ubah data diri ${req.docNo} (${emp?.fullName ?? req.employeeId} — ${emp?.employeeNo ?? "-"}) ` +
        `DISSETUJUI & diterapkan oleh ${actor.name}: ${detailParts.join("; ")}` +
        `${note ? ` — catatan: ${note}` : ""}`,
    },
  });
}

// ============ decide (HR) ============

export interface DecideChangeInput {
  id: string;
  action: "approve" | "reject";
  note?: string | null;
  actor: DecideActor;
}

export interface DecideChangeResult {
  docNo: string;
  status: "Submitted" | "Approved" | "Rejected";
  /** null = keputusan FINAL; ada = masih menunggu jenjang berikutnya. */
  approval: ChainSummary | null;
}

export async function decideChange(db: TenantDb, input: DecideChangeInput): Promise<DecideChangeResult> {
  const req = await db.employeeProfileChangeRequest.findUnique({ where: { id: input.id } });
  if (!req) throw new ProfileChangeError("Pengajuan tidak ditemukan", 404);
  if (req.status !== "Submitted") {
    throw new ProfileChangeError(
      `Pengajuan ${req.docNo} berstatus ${req.status} — hanya pengajuan Submitted yang dapat diputus`,
      409,
    );
  }
  const note = String(input.note ?? "").trim().slice(0, REASON_MAX) || null;

  const chain = await getApprovalChain(db, PROFILE_CHANGE_DOC_TYPE, req.id);
  let final = true;
  if (chain && chain.status === "InProgress") {
    const res = await decideApprovalChain(db, {
      docType: PROFILE_CHANGE_DOC_TYPE,
      docId: req.id,
      action: input.action,
      note: note ?? undefined,
      actor: input.actor,
    });
    final = res.final;
  }

  const emp = await db.employee.findUnique({
    where: { id: req.employeeId },
    select: { fullName: true, employeeNo: true },
  });

  if (!final) {
    // approve jenjang menengah — masih menunggu approver berikutnya
    const chainAfter = await getApprovalChain(db, PROFILE_CHANGE_DOC_TYPE, req.id);
    const approval: ChainSummary = {
      status: chainAfter?.status ?? "InProgress",
      currentLevel: chainAfter?.currentLevel ?? 0,
      totalLevels: chainAfter?.totalLevels ?? 0,
      currentApprover: chainAfter?.steps.find((s) => s.status === "Current")?.approverLabel ?? null,
    };
    await db.activityLog.create({
      data: {
        appUserId: input.actor.appUserId ?? undefined,
        action: "Approved",
        entity: "ProfileChange",
        entityId: req.docNo,
        employeeId: req.employeeId,
        detail:
          `Pengajuan ubah data ${req.docNo} disetujui jenjang ${approval.currentLevel - 1}/${approval.totalLevels} ` +
          `(${input.actor.name}) — lanjut ke ${approval.currentApprover ?? "-"}`,
      },
    }).catch(() => { /* best-effort */ });
    return { docNo: req.docNo, status: "Submitted", approval };
  }

  if (input.action === "reject") {
    await db.employeeProfileChangeRequest.update({
      where: { id: req.id },
      data: { status: "Rejected", decidedById: input.actor.employeeId, decidedAt: new Date(), decisionNote: note },
    });
    await db.activityLog.create({
      data: {
        appUserId: input.actor.appUserId ?? undefined,
        action: "Rejected",
        entity: "ProfileChange",
        entityId: req.docNo,
        employeeId: req.employeeId,
        detail:
          `Pengajuan ubah data diri ${req.docNo} (${emp?.fullName ?? req.employeeId}) DITOLAK oleh ${input.actor.name}` +
          `${note ? ` — alasan: ${note}` : ""}`,
      },
    });
    return { docNo: req.docNo, status: "Rejected", approval: null };
  }

  // approval FINAL → patch otomatis
  await applyPatch(
    db,
    { id: req.id, docNo: req.docNo, employeeId: req.employeeId },
    parseEntries(req.fieldsJson),
    { name: input.actor.name, employeeId: input.actor.employeeId },
    note,
  );
  return { docNo: req.docNo, status: "Approved", approval: null };
}

// ============ cancel (karyawan sendiri, selama Submitted) ============

export async function cancelChange(
  db: TenantDb,
  input: { id: string; employeeId: string; actorName: string },
): Promise<{ docNo: string }> {
  const req = await db.employeeProfileChangeRequest.findUnique({ where: { id: input.id } });
  if (!req) throw new ProfileChangeError("Pengajuan tidak ditemukan", 404);
  if (req.employeeId !== input.employeeId) {
    throw new ProfileChangeError("Anda hanya dapat membatalkan pengajuan milik sendiri", 403);
  }
  if (req.status !== "Submitted") {
    throw new ProfileChangeError(
      `Pengajuan ${req.docNo} berstatus ${req.status} — hanya pengajuan Submitted yang dapat dibatalkan`,
      409,
    );
  }
  await cancelApprovalChain(db, PROFILE_CHANGE_DOC_TYPE, req.id, input.actorName);
  await db.employeeProfileChangeRequest.update({
    where: { id: req.id },
    data: { status: "Cancelled", decidedAt: new Date(), decisionNote: null },
  });
  await db.activityLog.create({
    data: {
      action: "Cancelled",
      entity: "ProfileChange",
      entityId: req.docNo,
      employeeId: req.employeeId,
      detail: `Pengajuan ubah data diri ${req.docNo} dibatalkan oleh karyawan (${input.actorName})`,
    },
  }).catch(() => { /* best-effort */ });
  return { docNo: req.docNo };
}

// ============ getter ============

function parseEntries(fieldsJson: string): PcEntry[] {
  try {
    const parsed = JSON.parse(fieldsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as PcEntry[];
  } catch {
    return [];
  }
}

export interface ProfileChangeRow {
  id: string;
  docNo: string;
  status: string;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  employee: { id: string; employeeNo: string; fullName: string };
  entries: PcEntry[];
  approval: ChainSummary | null;
}

function toRow(
  r: {
    id: string; docNo: string; status: string; reason: string | null; fieldsJson: string;
    createdAt: Date; decidedAt: Date | null; decisionNote: string | null;
    employee: { id: string; employeeNo: string; fullName: string };
  },
  approval: ChainSummary | null,
): ProfileChangeRow {
  return {
    id: r.id, docNo: r.docNo, status: r.status, reason: r.reason,
    createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote, employee: r.employee, entries: parseEntries(r.fieldsJson), approval,
  };
}

export interface ListChangeFilter {
  status?: string;
  employeeId?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Daftar pengajuan (admin HR) — take-cap 500 terbaru dulu (konvensi desc). */
export async function listRequests(db: TenantDb, filter: ListChangeFilter): Promise<ProfileChangeRow[]> {
  const where: Record<string, unknown> = {};
  if (filter.status && filter.status !== "all") where.status = filter.status;
  if (filter.employeeId) where.employeeId = filter.employeeId;
  if (filter.q?.trim()) {
    const q = filter.q.trim();
    where.OR = [
      { docNo: { contains: q } },
      { employee: { fullName: { contains: q } } },
      { employee: { employeeNo: { contains: q } } },
    ];
  }
  if (filter.dateFrom || filter.dateTo) {
    const from = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`) : null;
    const to = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59.999`) : null;
    where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }
  const rows = await db.employeeProfileChangeRequest.findMany({
    where,
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const chains = await attachChainSummaries(
    db, PROFILE_CHANGE_DOC_TYPE, rows.map((r) => ({ id: r.id })),
  );
  return rows.map((r) => toRow(r, chains.get(r.id) ?? null));
}

/** Daftar pengajuan MILIK SENDIRI (ESS self-scope). */
export async function myRequests(db: TenantDb, employeeId: string): Promise<ProfileChangeRow[]> {
  const rows = await db.employeeProfileChangeRequest.findMany({
    where: { employeeId },
    include: { employee: { select: { id: true, employeeNo: true, fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const chains = await attachChainSummaries(
    db, PROFILE_CHANGE_DOC_TYPE, rows.map((r) => ({ id: r.id })),
  );
  return rows.map((r) => toRow(r, chains.get(r.id) ?? null));
}

// ============ nilai saat ini + kontak darurat (prefill form ESS) ============

export interface CurrentProfileValues {
  address: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  maritalStatus: string | null;
}

export interface EmergencyContactView {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  address: string | null;
  isPrimary: boolean;
  notes: string | null;
}

/** Kontak darurat karyawan — telepon DIENKRIPSI di batas serializer. */
export function serializeEmergencyContacts(
  rows: { id: string; name: string; relationship: string; phone: string; address: string | null; isPrimary: boolean; notes: string | null }[],
  tc: { decryptText(v: string | null | undefined): string | null },
): EmergencyContactView[] {
  return rows.map((r) => ({
    id: r.id, name: r.name, relationship: r.relationship,
    phone: tc.decryptText(r.phone) ?? "", address: r.address, isPrimary: r.isPrimary, notes: r.notes,
  }));
}

/** Nilai saat ini field whitelist + kontak darurat (self-scope ESS). */
export async function currentProfile(
  db: TenantDb,
  employeeId: string,
): Promise<{ current: CurrentProfileValues; contacts: EmergencyContactView[] }> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    select: { address: true, city: true, email: true, phone: true, maritalStatus: true },
  });
  if (!emp) throw new ProfileChangeError("Karyawan tidak ditemukan", 404);
  const contacts = await db.emergencyContact.findMany({
    where: { employeeId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });
  return {
    current: {
      address: emp.address, city: emp.city, email: emp.email,
      phone: emp.phone, maritalStatus: emp.maritalStatus,
    },
    contacts: serializeEmergencyContacts(contacts, tenantCryptoForDb(db)),
  };
}
