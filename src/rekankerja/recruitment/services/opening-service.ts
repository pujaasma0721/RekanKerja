// ============================================================================
// RECRUITMENT F2 — JobOpportunity (JO) + JobOpening (slot per PR) service
// Sumber: DEVELOPMENT-PLAN-RECRUITMENT.md §7 F2 + §4.2 analisa (§2.4).
//
// Rantai: PR Approved (+autoPostOpening) → JO otomatis dibuat (status
// Posted + slot per PR + kanal WEBPORTAL) → tampil di portal publik →
// lamaran masuk (PublicApplication staging F2 / ApplicantApplication).
//
// Uang: plannedCost/actualCost JobOpeningMethod = String terenkripsi vault
// (enc:v1:n:…) — decrypt HANYA di batas serializer (rows/detail) bila
// moneyVisible; tidak pernah di where/sort SQL (W28).
// salaryMin/salaryMax slot = rentang gaji IKLAN (publik by design) → Int polos.
//
// Status JO: Draft → Posted → Closed | Obsolete (guard di sini, bukan UI).
// Status slot: Open → Fulfilled (F4) | Closed (ikut JO).
// ============================================================================
import type { Prisma } from "@/generated/tenant";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import type { AdvSearch } from "@/rekankerja/shared/lib/adv-search";
import { advPrismaWhere, type AdvServerField } from "@/rekankerja/shared/services/adv-search-server";

// ============ konstanta domain ============

export const JO_STATUSES = ["Draft", "Posted", "Closed", "Obsolete"] as const;
export type JoStatus = (typeof JO_STATUSES)[number];

export const OPENING_STATUSES = ["Open", "Fulfilled", "Closed"] as const;
export type OpeningStatus = (typeof OPENING_STATUSES)[number];

/** Field advance-search JO (server-side, whitelist — field tak dikenal dibuang). */
const JO_ADV_FIELDS: Record<string, AdvServerField> = {
  refNo: { path: "refNo", type: "text" },
  title: { path: "title", type: "text" },
  status: { path: "status", type: "select" },
  contactPerson: { path: "contactPerson", type: "text" },
  preparedBy: { path: "preparedBy.fullName", type: "text" },
  datePrepared: { path: "datePrepared", type: "date" },
  datePosted: { path: "datePosted", type: "date" },
  lastAcceptDate: { path: "lastAcceptDate", type: "date" },
  // slot (dalam JO yang sama)
  prNo: { path: "openings[].pr.prNo", type: "text" },
  position: { path: "openings[].pr.position.title", type: "text" },
  slotStatus: { path: "openings[].status", type: "select" },
  location: { path: "openings[].workLocation.name", type: "text" },
};

/** Whitelist sort server-side (bentuk ARRAY — konvensi Prisma proyek). */
const JO_SORT: Record<string, Prisma.JobOpportunityOrderByWithRelationInput[]> = {
  refNo: [{ refNo: "asc" }],
  title: [{ title: "asc" }],
  datePrepared: [{ datePrepared: "asc" }],
  datePosted: [{ datePosted: "asc" }],
  status: [{ status: "asc" }],
  preparedBy: [{ preparedBy: { fullName: "asc" } }],
};

const JO_INCLUDE = {
  preparedBy: { select: { id: true, fullName: true, employeeNo: true } },
  openings: {
    include: {
      pr: { select: { id: true, prNo: true, status: true, requiredNo: true, employmentStatus: true, position: { select: { title: true } } } },
      workLocation: { select: { id: true, name: true, city: true } },
      knockouts: { orderBy: { orderNo: "asc" } },
      _count: { select: { applications: true, publicApplications: true } },
    },
  },
  methods: {
    include: {
      method: { select: { id: true, code: true, name: true, scope: true } },
      adMediaType: { select: { id: true, name: true } },
      agency: { select: { id: true, name: true } },
      costItem: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.JobOpportunityInclude;

// ============ tipe baris (bentuk JSON API) ============

export interface OpeningSlotRow {
  id: string;
  prId: string;
  prNo: string;
  prStatus: string;
  requiredNo: number;
  employmentStatus: string;
  positionTitle: string | null;
  titleToShow: string;
  workLocationId: string | null;
  workLocationName: string | null;
  workLocationCity: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryUnit: string;
  jobDescSummary: string | null;
  jobSpecSummary: string | null;
  status: OpeningStatus;
  postedAt: string | null;
  closedAt: string | null;
  applicationCount: number; // ApplicantApplication
  publicApplicationCount: number; // staging Pending (belum jadi pelamar)
  knockouts: KnockoutRow[]; // F6: pertanyaan knockout slot ini
}

/** Pertanyaan knockout per slot (F6 — HRX B3): pertanyaan OBJEKTIF, mis.
 *  "Bersedia ditempatkan di Bandung?" dengan jawaban yang diharapkan. */
export interface KnockoutInput {
  id?: string;
  question: string;
  expectedValue: string;
  /** Equals (default) | Contains | NotEquals. */
  mode?: string;
  active?: boolean;
  orderNo?: number;
}

export interface KnockoutRow {
  id: string;
  question: string;
  expectedValue: string;
  mode: string;
  active: boolean;
  orderNo: number;
}

export interface MethodRow {
  id: string;
  methodId: string;
  methodName: string;
  methodScope: string;
  adMediaTypeId: string | null;
  adMediaName: string | null;
  agencyId: string | null;
  agencyName: string | null;
  costItemId: string | null;
  costItemName: string | null;
  /** null bila vault menyembunyikan — TIDAK pernah string cipher. */
  plannedCost: number | null;
  actualCost: number | null;
  datePosted: string | null;
  note: string | null;
}

export interface JoRow {
  id: string;
  refNo: string;
  title: string;
  status: JoStatus;
  datePrepared: string;
  datePosted: string | null;
  lastAcceptDate: string | null;
  contactPerson: string | null;
  content: string | null;
  preparedById: string | null;
  preparedByName: string | null;
  internalOnly: boolean; // F5: khusus internal selamanya (tidak tayang publik)
  internalFirstUntil: string | null; // F5: jendela internal-first (aktif bila > now)
  slots: OpeningSlotRow[];
  methods: MethodRow[];
}

export interface JoStats {
  total: number; draft: number; posted: number; closed: number; obsolete: number;
  openSlots: number; applications: number; // total ApplicantApplication ke slot JO
}

// ============ input ============

export interface SlotInput {
  prId: string;
  titleToShow?: string;
  workLocationId?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  jobDescSummary?: string | null;
  jobSpecSummary?: string | null;
}

export interface MethodInput {
  id?: string;
  /** JO target saat create (update memakai id — jobOpportunityId diabaikan). */
  jobOpportunityId?: string;
  methodId: string;
  adMediaTypeId?: string | null;
  agencyId?: string | null;
  costItemId?: string | null;
  plannedCost?: number | null;
  actualCost?: number | null;
  datePosted?: string | null;
  note?: string | null;
}

export interface JoInput {
  title: string;
  contactPerson?: string | null;
  lastAcceptDate?: string | null;
  content?: string | null;
  preparedById?: string | null;
  postNow?: boolean;
  /** F5: khusus internal (tidak pernah tayang di portal publik). */
  internalOnly?: boolean;
  /** F5: jendela internal-first — sebelum tanggal ini hanya ESS yang melihat. */
  internalFirstUntil?: string | null;
  slots: SlotInput[];
}

// ============ helper ============

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

/** Nomor JO berikutnya: JO-YYYY-NNNN (max-suffix, delete-safe — pola nextPrNo). */
export async function nextJoNo(db: TenantDb): Promise<string> {
  const year = new Date().getFullYear();
  const start = `JO-${year}-`;
  let max = 0;
  const rows = await db.jobOpportunity.findMany({
    where: { refNo: { startsWith: start } },
    select: { refNo: true },
    take: 500,
  });
  for (const r of rows) {
    const n = parseInt(r.refNo.slice(start.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${start}${String(max + 1).padStart(4, "0")}`;
}

function slotRow(s: Prisma.JobOpeningGetPayload<typeof JO_INCLUDE.openings>): OpeningSlotRow {
  return {
    id: s.id,
    prId: s.prId,
    prNo: s.pr.prNo,
    prStatus: s.pr.status,
    requiredNo: s.pr.requiredNo,
    employmentStatus: s.pr.employmentStatus,
    positionTitle: s.pr.position?.title ?? null,
    titleToShow: s.titleToShow,
    workLocationId: s.workLocationId,
    workLocationName: s.workLocation?.name ?? null,
    workLocationCity: s.workLocation?.city ?? null,
    salaryMin: s.salaryMin ?? null,
    salaryMax: s.salaryMax ?? null,
    currency: s.currency,
    salaryUnit: s.salaryUnit,
    jobDescSummary: s.jobDescSummary,
    jobSpecSummary: s.jobSpecSummary,
    status: s.status as OpeningStatus,
    postedAt: iso(s.postedAt),
    closedAt: iso(s.closedAt),
    applicationCount: s._count.applications,
    publicApplicationCount: s._count.publicApplications,
    knockouts: s.knockouts.map((k) => ({
      id: k.id,
      question: k.question,
      expectedValue: k.expectedValue,
      mode: k.mode,
      active: k.active,
      orderNo: k.orderNo,
    })).sort((a, b) => a.orderNo - b.orderNo),
  };
}

function methodRow(
  m: Prisma.JobOpeningMethodGetPayload<typeof JO_INCLUDE.methods>,
  moneyVisible: boolean,
  tc: ReturnType<typeof tenantCryptoForDb>,
): MethodRow {
  return {
    id: m.id,
    methodId: m.methodId,
    methodName: m.method.name,
    methodScope: m.method.scope,
    adMediaTypeId: m.adMediaTypeId,
    adMediaName: m.adMediaType?.name ?? null,
    agencyId: m.agencyId,
    agencyName: m.agency?.name ?? null,
    costItemId: m.costItemId,
    costItemName: m.costItem?.name ?? null,
    plannedCost: moneyVisible && m.plannedCost ? (tc.decryptMoney(m.plannedCost) ?? null) : null,
    actualCost: moneyVisible && m.actualCost ? (tc.decryptMoney(m.actualCost) ?? null) : null,
    datePosted: iso(m.datePosted),
    note: m.note,
  };
}

function joRow(jo: Prisma.JobOpportunityGetPayload<{ include: typeof JO_INCLUDE }>, moneyVisible: boolean, db: TenantDb): JoRow {
  const tc = tenantCryptoForDb(db);
  return {
    id: jo.id,
    refNo: jo.refNo,
    title: jo.title,
    status: jo.status as JoStatus,
    datePrepared: jo.datePrepared.toISOString(),
    datePosted: iso(jo.datePosted),
    lastAcceptDate: iso(jo.lastAcceptDate),
    contactPerson: jo.contactPerson,
    content: jo.content,
    preparedById: jo.preparedById,
    preparedByName: jo.preparedBy?.fullName ?? null,
    internalOnly: jo.internalOnly,
    internalFirstUntil: iso(jo.internalFirstUntil),
    slots: jo.openings.map(slotRow).sort((a, b) => a.prNo.localeCompare(b.prNo)),
    methods: jo.methods.map((m) => methodRow(m, moneyVisible, tc)).sort((a, b) => a.methodName.localeCompare(b.methodName)),
  };
}

// ============ query ============

export interface ListJoOptions {
  status?: string | null;
  q?: string | null;
  adv?: AdvSearch | null;
  limit?: number;
  offset?: number;
  sortBy?: string | null;
  sortDir?: string | null;
  moneyVisible?: boolean;
}

export async function listJos(db: TenantDb, opts: ListJoOptions): Promise<{ rows: JoRow[]; total: number; stats: JoStats }> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const moneyVisible = opts.moneyVisible ?? false;

  const where: Prisma.JobOpportunityWhereInput = {};
  if (opts.status && JO_STATUSES.includes(opts.status as JoStatus)) where.status = opts.status;
  const q = opts.q?.trim();
  if (q) {
    where.OR = [
      { refNo: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { contactPerson: { contains: q, mode: "insensitive" } },
      { openings: { some: { pr: { prNo: { contains: q, mode: "insensitive" } } } } },
      { openings: { some: { titleToShow: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const advWhere = opts.adv ? advPrismaWhere(opts.adv, JO_ADV_FIELDS) : undefined;
  if (advWhere) where.AND = [where.AND, advWhere].filter(Boolean) as Prisma.JobOpportunityWhereInput[];

  const sortBy = opts.sortBy && JO_SORT[opts.sortBy] ? JO_SORT[opts.sortBy]! : JO_SORT.refNo!;
  const order: Prisma.JobOpportunityOrderByWithRelationInput[] = opts.sortDir === "desc"
    ? sortBy.map((s) => reverseOrder(s) as Prisma.JobOpportunityOrderByWithRelationInput)
    : sortBy;

  const [rows, total, groupStatus, slotAgg, appAgg] = await Promise.all([
    db.jobOpportunity.findMany({ where, include: JO_INCLUDE, orderBy: order, take: limit, skip: offset }),
    db.jobOpportunity.count({ where }),
    db.jobOpportunity.groupBy({ by: ["status"], _count: { _all: true } }),
    db.jobOpening.groupBy({ by: ["status"], _count: { _all: true } }),
    db.applicantApplication.count(),
  ]);
  const st = (s: string) => groupStatus.find((g) => g.status === s)?._count._all ?? 0;

  return {
    rows: rows.map((r) => joRow(r, moneyVisible, db)),
    total,
    stats: {
      total: groupStatus.reduce((a, g) => a + g._count._all, 0),
      draft: st("Draft"), posted: st("Posted"), closed: st("Closed"), obsolete: st("Obsolete"),
      openSlots: slotAgg.find((g) => g.status === "Open")?._count._all ?? 0,
      applications: appAgg,
    },
  };
}

/** Balik arah order rekursif (pola pr-service). */
function reverseOrder(o: Prisma.JobOpportunityOrderByWithRelationInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = reverseOrder(v as Prisma.JobOpportunityOrderByWithRelationInput);
    else if (v === "asc") out[k] = "desc";
    else if (v === "desc") out[k] = "asc";
    else out[k] = v;
  }
  return out;
}

export async function getJo(db: TenantDb, id: string, moneyVisible: boolean): Promise<JoRow | null> {
  const jo = await db.jobOpportunity.findUnique({ where: { id }, include: JO_INCLUDE });
  return jo ? joRow(jo, moneyVisible, db) : null;
}

// ============ mutasi ============

/** Buat JO (Draft, atau langsung Posted bila postNow). Wajib ≥1 slot PR Approved. */
export async function createJo(
  db: TenantDb, input: JoInput, actorName?: string | null,
): Promise<JoRow> {
  const title = input.title?.trim();
  if (!title) throw new Error("Judul lowongan wajib diisi");
  if (!input.slots || input.slots.length === 0) throw new Error("Minimal 1 slot (PR) perlu dipilih");

  // validasi PR: harus Approved/OnHold (rekrutmen aktif), belum punya slot di JO manapun
  const prIds = [...new Set(input.slots.map((s) => s.prId))];
  const prs = await db.personnelRequisition.findMany({
    where: { id: { in: prIds } },
    include: { position: { select: { title: true } } },
  });
  for (const prId of prIds) {
    const pr = prs.find((p) => p.id === prId);
    if (!pr) throw new Error("PR tidak ditemukan");
    if (pr.status !== "Approved" && pr.status !== "OnHold") {
      throw new Error(`PR ${pr.prNo} berstatus ${pr.status} — hanya PR Approved/OnHold yang bisa dibuatkan lowongan`);
    }
    const dup = await db.jobOpening.findFirst({ where: { prId }, select: { id: true, jobOpportunity: { select: { refNo: true } } } });
    if (dup) throw new Error(`PR ${pr.prNo} sudah punya slot di ${dup.jobOpportunity.refNo} — gunakan JO lain untuk mengiklankan ulang`);
  }

  const postNow = input.postNow === true;
  const now = new Date();
  const jo = await db.jobOpportunity.create({
    data: {
      refNo: await nextJoNo(db),
      title,
      contactPerson: input.contactPerson?.trim() || null,
      lastAcceptDate: input.lastAcceptDate ? new Date(input.lastAcceptDate) : null,
      content: input.content?.trim() || null,
      preparedById: input.preparedById || null,
      datePrepared: now,
      status: postNow ? "Posted" : "Draft",
      datePosted: postNow ? now : null,
      internalOnly: input.internalOnly === true,
      internalFirstUntil: input.internalFirstUntil ? new Date(input.internalFirstUntil) : null,
      openings: {
        create: input.slots.map((s) => {
          const pr = prs.find((p) => p.id === s.prId)!;
          return {
            prId: s.prId,
            titleToShow: s.titleToShow?.trim() || pr.position?.title || title,
            workLocationId: s.workLocationId || null,
            salaryMin: s.salaryMin ?? null,
            salaryMax: s.salaryMax ?? null,
            jobDescSummary: s.jobDescSummary?.trim() || null,
            jobSpecSummary: s.jobSpecSummary?.trim() || null,
            status: "Open",
            postedAt: postNow ? now : null,
          };
        }),
      },
    },
    include: JO_INCLUDE,
  });
  await db.activityLog.create({
    data: {
      action: "Created", entity: "JobOpportunity", entityId: jo.refNo,
      detail: `Lowongan ${jo.refNo} "${title}" dibuat (${postNow ? "langsung Posted" : "Draft"}, ${input.slots.length} slot)${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  return joRow(jo, true, db);
}

/** Update header JO (Draft/Posted — iklan boleh disunting selama tayang). */
export async function updateJo(
  db: TenantDb, id: string, input: Partial<JoInput>, actorName?: string | null,
): Promise<JoRow> {
  const jo = await db.jobOpportunity.findUnique({ where: { id }, select: { id: true, refNo: true, status: true } });
  if (!jo) throw new Error("Lowongan tidak ditemukan");
  if (jo.status === "Closed" || jo.status === "Obsolete") {
    throw new Error(`Lowongan ${jo.refNo} berstatus ${jo.status} — tidak dapat diubah`);
  }
  const data: Prisma.JobOpportunityUpdateInput = {};
  if (input.title != null) {
    const t = input.title.trim();
    if (!t) throw new Error("Judul lowongan wajib diisi");
    data.title = t;
  }
  if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson?.trim() || null;
  if (input.lastAcceptDate !== undefined) data.lastAcceptDate = input.lastAcceptDate ? new Date(input.lastAcceptDate) : null;
  if (input.content !== undefined) data.content = input.content?.trim() || null;
  if (input.internalOnly !== undefined) data.internalOnly = input.internalOnly === true;
  if (input.internalFirstUntil !== undefined) data.internalFirstUntil = input.internalFirstUntil ? new Date(input.internalFirstUntil) : null;
  if (Object.keys(data).length > 0) {
    await db.jobOpportunity.update({ where: { id }, data });
    await db.activityLog.create({
      data: { action: "Updated", entity: "JobOpportunity", entityId: jo.refNo, detail: `Lowongan ${jo.refNo} diperbarui${actorName ? ` oleh ${actorName}` : ""}` },
    });
  }
  const fresh = await db.jobOpportunity.findUnique({ where: { id }, include: JO_INCLUDE });
  return joRow(fresh!, true, db);
}

/** Tambah slot PR ke JO (mengiklankan ulang PR — boleh >1 JO per PR via ini? tidak:
 * guard duplikat slot sama dengan create — slot PR hanya di 1 JO aktif). */
export async function addSlot(
  db: TenantDb, joId: string, slot: SlotInput, actorName?: string | null,
): Promise<JoRow> {
  const jo = await db.jobOpportunity.findUnique({ where: { id: joId }, select: { id: true, refNo: true, status: true } });
  if (!jo) throw new Error("Lowongan tidak ditemukan");
  if (jo.status === "Closed" || jo.status === "Obsolete") {
    throw new Error(`Lowongan ${jo.refNo} berstatus ${jo.status} — tidak dapat menambah slot`);
  }
  const pr = await db.personnelRequisition.findUnique({ where: { id: slot.prId }, include: { position: { select: { title: true } } } });
  if (!pr) throw new Error("PR tidak ditemukan");
  if (pr.status !== "Approved" && pr.status !== "OnHold") {
    throw new Error(`PR ${pr.prNo} berstatus ${pr.status} — hanya PR Approved/OnHold yang bisa dibuatkan lowongan`);
  }
  const dup = await db.jobOpening.findFirst({ where: { prId: slot.prId }, select: { id: true, jobOpportunity: { select: { refNo: true } } } });
  if (dup) throw new Error(`PR ${pr.prNo} sudah punya slot di ${dup.jobOpportunity.refNo}`);

  await db.jobOpening.create({
    data: {
      jobOpportunityId: joId,
      prId: slot.prId,
      titleToShow: slot.titleToShow?.trim() || pr.position?.title || pr.prNo,
      workLocationId: slot.workLocationId || null,
      salaryMin: slot.salaryMin ?? null,
      salaryMax: slot.salaryMax ?? null,
      jobDescSummary: slot.jobDescSummary?.trim() || null,
      jobSpecSummary: slot.jobSpecSummary?.trim() || null,
      status: "Open",
      postedAt: jo.status === "Posted" ? new Date() : null,
    },
  });
  await db.activityLog.create({
    data: { action: "Updated", entity: "JobOpportunity", entityId: jo.refNo, detail: `Slot ${pr.prNo} ditambahkan ke ${jo.refNo}${actorName ? ` oleh ${actorName}` : ""}` },
  });
  const fresh = await db.jobOpportunity.findUnique({ where: { id: joId }, include: JO_INCLUDE });
  return joRow(fresh!, true, db);
}

/** Update slot (judul/lokasi/rentang gaji iklan/ringkasan). */
export async function updateSlot(
  db: TenantDb, slotId: string, input: Partial<SlotInput>, actorName?: string | null,
): Promise<void> {
  const s = await db.jobOpening.findUnique({ where: { id: slotId }, include: { jobOpportunity: { select: { refNo: true } } } });
  if (!s) throw new Error("Slot tidak ditemukan");
  // UncheckedUpdateInput — kolom FK (workLocationId) dipakai langsung, bukan relasi.
  const data: Prisma.JobOpeningUncheckedUpdateInput = {};
  if (input.titleToShow != null) data.titleToShow = input.titleToShow.trim() || s.titleToShow;
  if (input.workLocationId !== undefined) data.workLocationId = input.workLocationId || null;
  if (input.salaryMin !== undefined) data.salaryMin = input.salaryMin ?? null;
  if (input.salaryMax !== undefined) data.salaryMax = input.salaryMax ?? null;
  if (input.jobDescSummary !== undefined) data.jobDescSummary = input.jobDescSummary?.trim() || null;
  if (input.jobSpecSummary !== undefined) data.jobSpecSummary = input.jobSpecSummary?.trim() || null;
  if (Object.keys(data).length > 0) {
    await db.jobOpening.update({ where: { id: slotId }, data });
    await db.activityLog.create({
      data: { action: "Updated", entity: "JobOpening", entityId: s.jobOpportunity.refNo, detail: `Slot ${s.titleToShow} di ${s.jobOpportunity.refNo} diperbarui${actorName ? ` oleh ${actorName}` : ""}` },
    });
  }
}

/** Publish JO: Draft → Posted (slot postedAt ikut diisi). */
export async function postJo(db: TenantDb, id: string, actorName?: string | null): Promise<{ refNo: string; status: JoStatus }> {
  const jo = await db.jobOpportunity.findUnique({ where: { id }, select: { id: true, refNo: true, status: true } });
  if (!jo) throw new Error("Lowongan tidak ditemukan");
  if (jo.status !== "Draft") throw new Error(`Lowongan ${jo.refNo} berstatus ${jo.status} — hanya Draft yang bisa dipublikasikan`);
  const now = new Date();
  await db.jobOpportunity.update({ where: { id }, data: { status: "Posted", datePosted: now } });
  await db.jobOpening.updateMany({ where: { jobOpportunityId: id, status: "Open", postedAt: null }, data: { postedAt: now } });
  await db.activityLog.create({
    data: { action: "Updated", entity: "JobOpportunity", entityId: jo.refNo, detail: `Lowongan ${jo.refNo} DIPUBLIKASIKAN (Posted) — tampil di portal karir publik${actorName ? ` oleh ${actorName}` : ""}` },
  });
  return { refNo: jo.refNo, status: "Posted" };
}

/** Tutup JO: Posted → Closed (slot Open → Closed). */
export async function closeJo(db: TenantDb, id: string, note?: string | null, actorName?: string | null): Promise<{ refNo: string; status: JoStatus }> {
  const jo = await db.jobOpportunity.findUnique({ where: { id }, select: { id: true, refNo: true, status: true } });
  if (!jo) throw new Error("Lowongan tidak ditemukan");
  if (jo.status !== "Posted" && jo.status !== "Draft") throw new Error(`Lowongan ${jo.refNo} berstatus ${jo.status} — hanya Draft/Posted yang bisa ditutup`);
  const now = new Date();
  await db.jobOpportunity.update({ where: { id }, data: { status: "Closed" } });
  await db.jobOpening.updateMany({ where: { jobOpportunityId: id, status: "Open" }, data: { status: "Closed", closedAt: now } });
  await db.activityLog.create({
    data: { action: "Closed", entity: "JobOpportunity", entityId: jo.refNo, detail: `Lowongan ${jo.refNo} ditutup${note ? ` — ${note.trim()}` : ""}${actorName ? ` oleh ${actorName}` : ""}` },
  });
  return { refNo: jo.refNo, status: "Closed" };
}

/** Obsolete JO: arsip (ikan lama tak relevan — beda dari Closed yang disengaja). */
export async function obsoleteJo(db: TenantDb, id: string, note?: string | null, actorName?: string | null): Promise<{ refNo: string; status: JoStatus }> {
  const jo = await db.jobOpportunity.findUnique({ where: { id }, select: { id: true, refNo: true, status: true } });
  if (!jo) throw new Error("Lowongan tidak ditemukan");
  if (jo.status === "Obsolete") throw new Error(`Lowongan ${jo.refNo} sudah Obsolete`);
  const now = new Date();
  await db.jobOpportunity.update({ where: { id }, data: { status: "Obsolete" } });
  await db.jobOpening.updateMany({ where: { jobOpportunityId: id, status: "Open" }, data: { status: "Closed", closedAt: now } });
  await db.activityLog.create({
    data: { action: "Updated", entity: "JobOpportunity", entityId: jo.refNo, detail: `Lowongan ${jo.refNo} ditandai OBSOLETE${note ? ` — ${note.trim()}` : ""}${actorName ? ` oleh ${actorName}` : ""}` },
  });
  return { refNo: jo.refNo, status: "Obsolete" };
}

/** Tutup satu slot (tanpa menutup JO). */
export async function closeSlot(db: TenantDb, slotId: string, actorName?: string | null): Promise<void> {
  const s = await db.jobOpening.findUnique({ where: { id: slotId }, include: { jobOpportunity: { select: { refNo: true } } } });
  if (!s) throw new Error("Slot tidak ditemukan");
  if (s.status !== "Open") throw new Error(`Slot ${s.titleToShow} berstatus ${s.status} — tidak bisa ditutup`);
  await db.jobOpening.update({ where: { id: slotId }, data: { status: "Closed", closedAt: new Date() } });
  await db.activityLog.create({
    data: { action: "Closed", entity: "JobOpening", entityId: s.jobOpportunity.refNo, detail: `Slot ${s.titleToShow} (${s.jobOpportunity.refNo}) ditutup${actorName ? ` oleh ${actorName}` : ""}` },
  });
}

// ============ kanal + biaya (JobOpeningMethod) ============

export async function upsertMethod(
  db: TenantDb, input: MethodInput, actorName?: string | null,
): Promise<void> {
  const tc = tenantCryptoForDb(db);
  // tentukan JO target: dari kanal existing (update) atau input (create)
  let targetJoId: string | null = null;
  if (input.id) {
    const m = await db.jobOpeningMethod.findUnique({ where: { id: input.id }, select: { jobOpportunityId: true } });
    targetJoId = m?.jobOpportunityId ?? null;
  } else if (input.jobOpportunityId) {
    targetJoId = input.jobOpportunityId;
  }
  if (!targetJoId) throw new Error("Lowongan tidak ditemukan untuk kanal ini");
  const jo = await db.jobOpportunity.findUnique({ where: { id: targetJoId }, select: { refNo: true, status: true } });
  if (!jo) throw new Error("Lowongan tidak ditemukan");
  if (jo.status === "Closed" || jo.status === "Obsolete") throw new Error(`Lowongan ${jo.refNo} berstatus ${jo.status} — tidak dapat mengubah kanal`);

  const data = {
    methodId: input.methodId,
    adMediaTypeId: input.adMediaTypeId || null,
    agencyId: input.agencyId || null,
    costItemId: input.costItemId || null,
    plannedCost: input.plannedCost != null && input.plannedCost > 0 ? tc.encryptMoney(input.plannedCost) : null,
    actualCost: input.actualCost != null && input.actualCost > 0 ? tc.encryptMoney(input.actualCost) : null,
    datePosted: input.datePosted ? new Date(input.datePosted) : null,
    note: input.note?.trim() || null,
  };
  if (input.id) {
    await db.jobOpeningMethod.update({ where: { id: input.id }, data });
  } else {
    await db.jobOpeningMethod.create({ data: { ...data, jobOpportunityId: targetJoId } });
  }
  await db.activityLog.create({
    data: {
      action: input.id ? "Updated" : "Created", entity: "JobOpeningMethod", entityId: jo.refNo,
      detail: `Kanal publikasi lowongan ${jo.refNo} ${input.id ? "diperbarui" : "ditambahkan"}${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
}

export async function deleteMethod(db: TenantDb, id: string, actorName?: string | null): Promise<void> {
  const m = await db.jobOpeningMethod.findUnique({ where: { id }, include: { jobOpportunity: { select: { refNo: true } } } });
  if (!m) throw new Error("Kanal tidak ditemukan");
  await db.jobOpeningMethod.delete({ where: { id } });
  await db.activityLog.create({
    data: { action: "Deleted", entity: "JobOpeningMethod", entityId: m.jobOpportunity.refNo, detail: `Kanal ${m.methodId} dihapus dari ${m.jobOpportunity.refNo}${actorName ? ` oleh ${actorName}` : ""}` },
  });
}

// ============ pertanyaan knockout per slot (F6 — HRX B3) ============

function knockoutRow(k: { id: string; question: string; expectedValue: string; mode: string; active: boolean; orderNo: number }): KnockoutRow {
  return { id: k.id, question: k.question, expectedValue: k.expectedValue, mode: k.mode, active: k.active, orderNo: k.orderNo };
}

/** Ganti seluruh daftar knockout slot (replace-all — item tanpa id = baru,
 *  id yang tidak dikirim = dihapus). Pertanyaan hanya boleh OBJEKTIF. */
export async function upsertKnockouts(
  db: TenantDb, slotId: string, items: KnockoutInput[], actorName?: string | null,
): Promise<KnockoutRow[]> {
  const slot = await db.jobOpening.findUnique({
    where: { id: slotId },
    include: { jobOpportunity: { select: { refNo: true, status: true } } },
  });
  if (!slot) throw new Error("Slot tidak ditemukan");
  if (slot.jobOpportunity.status === "Closed" || slot.jobOpportunity.status === "Obsolete") {
    throw new Error(`Lowongan ${slot.jobOpportunity.refNo} berstatus ${slot.jobOpportunity.status} — knockout tidak dapat diubah`);
  }
  if (items.length > 10) throw new Error("Maksimum 10 pertanyaan knockout per slot");

  const validModes = ["Equals", "Contains", "NotEquals"];
  const cleaned = items.map((it, i) => {
    const question = it.question?.trim() ?? "";
    if (question.length < 5) throw new Error(`Pertanyaan knockout ke-${i + 1} minimal 5 karakter`);
    const expected = it.expectedValue?.trim() ?? "";
    if (!expected) throw new Error(`Jawaban yang diharapkan untuk "${question.slice(0, 40)}" wajib diisi`);
    const mode = validModes.includes(it.mode ?? "") ? it.mode! : "Equals";
    return { id: it.id || undefined, question: question.slice(0, 200), expectedValue: expected.slice(0, 80), mode, active: it.active !== false, orderNo: i + 1 };
  });

  await db.$transaction(async (tx) => {
    const keepIds = cleaned.filter((c) => c.id).map((c) => c.id!);
    await tx.knockoutQuestion.deleteMany({
      where: { jobOpeningId: slot.id, ...(keepIds.length > 0 ? { id: { notIn: keepIds } } : {}) },
    });
    for (const c of cleaned) {
      if (c.id) {
        await tx.knockoutQuestion.update({
          where: { id: c.id },
          data: { question: c.question, expectedValue: c.expectedValue, mode: c.mode, active: c.active, orderNo: c.orderNo },
        });
      } else {
        await tx.knockoutQuestion.create({
          data: { jobOpeningId: slot.id, question: c.question, expectedValue: c.expectedValue, mode: c.mode, active: c.active, orderNo: c.orderNo },
        });
      }
    }
  });

  await db.activityLog.create({
    data: {
      action: "Updated", entity: "KnockoutQuestion", entityId: slot.jobOpportunity.refNo,
      detail: `Pertanyaan knockout slot "${slot.titleToShow}" (${slot.jobOpportunity.refNo}) disimpan: ${cleaned.length} pertanyaan${actorName ? ` oleh ${actorName}` : ""}`,
    },
  });
  const rows = await db.knockoutQuestion.findMany({ where: { jobOpeningId: slot.id }, orderBy: { orderNo: "asc" } });
  return rows.map(knockoutRow);
}

/** Daftar knockout slot (urut orderNo — utk dialog admin). */
export async function listKnockouts(db: TenantDb, slotId: string): Promise<KnockoutRow[]> {
  const rows = await db.knockoutQuestion.findMany({ where: { jobOpeningId: slotId }, orderBy: { orderNo: "asc" } });
  return rows.map(knockoutRow);
}

export interface KnockoutEvalResult {
  questionId: string;
  question: string;
  answer: string;
  expectedValue: string;
  mode: string;
  pass: boolean;
}

/** Evaluasi jawaban kandidat terhadap knockout AKTIF slot.
 *  Hanya jawaban yang DIKIRIM (key ko_<questionId> ada di form) yang dievaluasi
 *  — pertanyaan tak dijawab form (mis. form lama tanpa knockout) dibiarkan lolos;
 *  form portal yang merender pertanyaan wajib mengirim semua jawaban. */
export async function evaluateKnockouts(
  db: TenantDb, slotId: string, answers: Record<string, string>,
): Promise<{ results: KnockoutEvalResult[]; pass: boolean }> {
  const qs = await db.knockoutQuestion.findMany({
    where: { jobOpeningId: slotId, active: true },
    orderBy: { orderNo: "asc" },
  });
  const results: KnockoutEvalResult[] = [];
  for (const q of qs) {
    if (!(q.id in answers)) continue; // form tidak mengirim jawaban utk pertanyaan ini
    const answer = String(answers[q.id] ?? "").trim();
    const expected = q.expectedValue.trim();
    const a = answer.toLowerCase();
    const e = expected.toLowerCase();
    const pass = q.mode === "NotEquals" ? a !== e : q.mode === "Contains" ? a.includes(e) : a === e;
    results.push({ questionId: q.id, question: q.question, answer, expectedValue: q.expectedValue, mode: q.mode, pass });
  }
  return { results, pass: results.every((r) => r.pass) };
}

// ============ auto-post (hook PR Approved) ============

/**
 * autoPostOpening: saat PR FINAL-Approved dan autoPostOpening=true → buat JO
 * Posted + 1 slot PR + kanal WEBPORTAL (bila master ada). IDEMPOTEN: bila PR
 * sudah punya slot di JO manapun → skip (return null). Dipanggil dari
 * pr-service.decidePr DAN migrasi/seed (jalur produksi sama).
 *
 * Defensif: kegagalan auto-post TIDAK boleh menggagalkan approval PR —
 * pemanggil membungkus try/catch (lihat pr-service).
 */
export async function autoPostForApprovedPr(
  db: TenantDb,
  pr: { id: string; prNo: string; positionId: string | null; jobId: string | null; orgUnitId: string | null; companyOfficeId: string | null; requiredNo: number; employmentStatus: string; miscSpec: string | null; additionalQualification: string | null; latestDate: Date | null; positionTitle?: string | null },
  opts?: { preparedById?: string | null; actorName?: string | null },
): Promise<{ joRefNo: string; slotId: string } | null> {
  // idempoten: PR sudah punya slot?
  const existing = await db.jobOpening.findFirst({ where: { prId: pr.id }, select: { id: true, jobOpportunity: { select: { refNo: true } } } });
  if (existing) return null;

  const position = pr.positionId
    ? await db.position.findUnique({ where: { id: pr.positionId }, select: { title: true } })
    : null;
  const job = pr.jobId
    ? await db.job.findUnique({ where: { id: pr.jobId }, select: { title: true } })
    : null;
  const orgUnit = pr.orgUnitId
    ? await db.orgUnit.findUnique({ where: { id: pr.orgUnitId }, select: { name: true } })
    : null;
  const office = pr.companyOfficeId
    ? await db.companyOffice.findUnique({ where: { id: pr.companyOfficeId }, select: { name: true, city: true } })
    : null;

  const title = position?.title ?? job?.title ?? `Lowongan ${pr.prNo}`;
  const now = new Date();
  const descParts = [
    position || job ? `Posisi: ${position?.title ?? job?.title}` : null,
    orgUnit ? `Unit: ${orgUnit.name}` : null,
    office ? `Lokasi: ${office.name}${office.city ? ` — ${office.city}` : ""}` : null,
    `Status kerja: ${pr.employmentStatus}`,
    `Jumlah: ${pr.requiredNo} orang`,
    pr.miscSpec ? `Catatan: ${pr.miscSpec}` : null,
  ].filter(Boolean).join("\n");
  const specParts = [
    pr.additionalQualification ? `Kualifikasi: ${pr.additionalQualification}` : null,
    `Sumber kebutuhan: PR ${pr.prNo}`,
  ].filter(Boolean).join("\n");

  const jo = await db.jobOpportunity.create({
    data: {
      refNo: await nextJoNo(db),
      title,
      preparedById: opts?.preparedById ?? null,
      datePrepared: now,
      status: "Posted",
      datePosted: now,
      content: descParts || null,
      lastAcceptDate: pr.latestDate,
      contactPerson: null,
      openings: {
        create: {
          prId: pr.id,
          titleToShow: title,
          jobDescSummary: descParts || null,
          jobSpecSummary: specParts || null,
          status: "Open",
          postedAt: now,
        },
      },
    },
    include: { openings: true },
  });

  // kanal default: WEBPORTAL (master F0) + tanggal posting
  const webMethod = await db.recruitmentMethod.findUnique({ where: { code: "WEBPORTAL" }, select: { id: true } });
  if (webMethod) {
    await db.jobOpeningMethod.create({
      data: { jobOpportunityId: jo.id, methodId: webMethod.id, datePosted: now },
    });
  }

  await db.activityLog.create({
    data: {
      action: "Created", entity: "JobOpportunity", entityId: jo.refNo,
      detail: `AUTO-POST: PR ${pr.prNo} disetujui → lowongan ${jo.refNo} "${title}" otomatis dipublikasikan (portal karir)${opts?.actorName ? ` oleh ${opts.actorName}` : ""}`,
    },
  });
  return { joRefNo: jo.refNo, slotId: jo.openings[0]?.id ?? "" };
}
