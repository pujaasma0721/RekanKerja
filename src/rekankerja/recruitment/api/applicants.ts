import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction, requireMenuViewAny, type MenuActionRef } from "@/rekankerja/shared/services/menu-access";
import { moneyViewForReq } from "@/rekankerja/shared/lib/money-view-req";
import { parseAdvSearchReq } from "@/rekankerja/shared/services/adv-search-server";
import { tenantSlugOfSession } from "@/rekankerja/shared/api/attachments";
import {
  listApplicants, getApplicant, createApplicant, updateApplicant,
  blacklistApplicant, unblacklistApplicant, suspendApplicant, unsuspendApplicant,
  applyToOpening, deleteApplicant,
  type ApplicantInput, type EduInput, type ExpInput, type SkillInput,
} from "@/rekankerja/recruitment/services/applicant-service";
import { logPiiAccess } from "@/rekankerja/recruitment/services/compliance-service";

// ============================================================================
// RECRUITMENT F2 — API Applicant (talent pool + query builder)
// DEVELOPMENT-PLAN-RECRUITMENT.md §5 (F2) + §7 F2.
//   GET    ?id= | ?status=&q=&adv=&sortBy=&sortDir=&limit=&offset=  → { rows|row, total, stats }
//   POST   { …profil, educations[], experiences[], skills[] }       → buat pelamar
//   PATCH  { action: update|blacklist|unblacklist|suspend|unsuspend
//           |apply, … }                                             → aksi
//   DELETE ?id=                                                    → hapus pelamar
// Guard menu: recruitment:applicants (view/create/update/delete +
// op:blacklist/apply). PII dienkripsi service-side; list menampilkan topeng.
// ============================================================================

// GET /api/rekankerja/recruitment/applicants
export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuViewAny(req, ["recruitment:applicants", "recruitment:public-staging"]);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const sp = req.nextUrl.searchParams;
    const id = sp.get("id");
    const mv = await moneyViewForReq(req, db);

    if (id) {
      const row = await getApplicant(db, id, mv.canSee);
      if (!row) return NextResponse.json({ error: "Pelamar tidak ditemukan" }, { status: 404 });
      // F9 (UU PDP) — audit akses PII: GET detail membuka data pribadi penuh
      // (email/telepon/alamat) → dicatat siapa mengakses kapan. Fire-and-forget
      // (kegagalan log tidak memblokir baca). LIST tidak dicatat — hanya
      // menampilkan versi topeng (minimisasi).
      void logPiiAccess(db, { employeeId: m.actor.employeeId, applicantId: id, what: "detail-view" }).catch(() => {});
      return NextResponse.json({ row });
    }

    const res = await listApplicants(db, {
      status: sp.get("status"),
      q: sp.get("q"),
      adv: parseAdvSearchReq(req),
      limit: Number(sp.get("limit") ?? 20),
      offset: Number(sp.get("offset") ?? 0),
      sortBy: sp.get("sortBy"),
      sortDir: sp.get("sortDir"),
      moneyVisible: mv.canSee,
    });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

function parseInput(b: Record<string, unknown>): ApplicantInput {
  const edu = (arr: unknown): EduInput[] =>
    Array.isArray(arr) ? arr.map((e) => e as Record<string, unknown>).filter((e) => e.level).map((e) => ({
      level: String(e.level ?? ""),
      fieldOfStudy: e.fieldOfStudy ? String(e.fieldOfStudy) : null,
      institution: e.institution ? String(e.institution) : null,
      graduationYear: e.graduationYear != null && e.graduationYear !== "" ? Number(e.graduationYear) : null,
      gpa: e.gpa != null && e.gpa !== "" ? Number(e.gpa) : null,
    })) : [];
  const exp = (arr: unknown): ExpInput[] =>
    Array.isArray(arr) ? arr.map((e) => e as Record<string, unknown>).filter((e) => e.company || e.position || e.startYear != null).map((e) => ({
      company: e.company ? String(e.company) : null,
      position: e.position ? String(e.position) : null,
      field: e.field ? String(e.field) : null,
      startYear: e.startYear != null && e.startYear !== "" ? Number(e.startYear) : null,
      endYear: e.endYear != null && e.endYear !== "" ? Number(e.endYear) : null,
      months: e.months != null && e.months !== "" ? Number(e.months) : null,
    })) : [];
  const skl = (arr: unknown): SkillInput[] =>
    Array.isArray(arr) ? arr.map((e) => e as Record<string, unknown>).filter((e) => e.skillId).map((e) => ({
      skillId: String(e.skillId ?? ""),
      level: e.level ? String(e.level) : null,
    })) : [];
  return {
    firstName: String(b.firstName ?? ""),
    middleName: b.middleName ? String(b.middleName) : null,
    lastName: b.lastName ? String(b.lastName) : null,
    displayName: b.displayName ? String(b.displayName) : null,
    status: b.status ? String(b.status) : undefined,
    dateApplied: b.dateApplied ? String(b.dateApplied) : null,
    dateAvailable: b.dateAvailable ? String(b.dateAvailable) : null,
    expectedSalary: b.expectedSalary != null && b.expectedSalary !== "" ? Number(b.expectedSalary) : null,
    keepOnFileMonths: b.keepOnFileMonths != null && b.keepOnFileMonths !== "" ? Number(b.keepOnFileMonths) : undefined,
    source: b.source ? String(b.source) : null,
    adMediaTypeId: b.adMediaTypeId ? String(b.adMediaTypeId) : null,
    agencyId: b.agencyId ? String(b.agencyId) : null,
    institutionName: b.institutionName ? String(b.institutionName) : null,
    referralEmployeeId: b.referralEmployeeId ? String(b.referralEmployeeId) : null,
    referralNote: b.referralNote != null ? String(b.referralNote) : null,
    email: b.email ? String(b.email) : null,
    phone: b.phone ? String(b.phone) : null,
    address: b.address ? String(b.address) : null,
    city: b.city ? String(b.city) : null,
    placeOfBirth: b.placeOfBirth ? String(b.placeOfBirth) : null,
    identityNo: b.identityNo ? String(b.identityNo) : null,
    birthDate: b.birthDate ? String(b.birthDate) : null,
    gender: b.gender ? String(b.gender) : null,
    maritalStatus: b.maritalStatus ? String(b.maritalStatus) : null,
    notes: b.notes ? String(b.notes) : null,
    educations: edu(b.educations),
    experiences: exp(b.experiences),
    skills: skl(b.skills),
  };
}

// POST /api/rekankerja/recruitment/applicants — input manual pelamar baru
export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const m = await requireMenuAction(req, "recruitment:applicants", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const row = await createApplicant(m.db, parseInput(b), m.actor.name);
    return NextResponse.json({ row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// PATCH /api/rekankerja/recruitment/applicants — update + aksi
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action ?? "update");
    const op: MenuActionRef =
      action === "blacklist" || action === "unblacklist" ? "op:blacklist" :
      action === "suspend" || action === "unsuspend" ? "op:blacklist" :
      action === "apply" ? "op:apply" :
      b.id ? "update" : "create";
    const m = await requireMenuAction(req, "recruitment:applicants", op);
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const note = b.note ? String(b.note) : null;

    if (action === "update" && b.id) {
      await updateApplicant(db, String(b.id), parseInput(b), m.actor.name);
      const row = await getApplicant(db, String(b.id), true);
      return NextResponse.json({ row });
    }

    if (action === "blacklist" && b.id) {
      await blacklistApplicant(db, String(b.id), note ?? "", { employeeId: m.actor.employeeId, name: m.actor.name });
      return NextResponse.json({ ok: true });
    }
    if (action === "unblacklist" && b.id) {
      await unblacklistApplicant(db, String(b.id), m.actor.name);
      return NextResponse.json({ ok: true });
    }
    if (action === "suspend" && b.id) {
      await suspendApplicant(db, String(b.id), note ?? "", b.until ? String(b.until) : null, m.actor.name);
      return NextResponse.json({ ok: true });
    }
    if (action === "unsuspend" && b.id) {
      await unsuspendApplicant(db, String(b.id), m.actor.name);
      return NextResponse.json({ ok: true });
    }
    if (action === "apply" && b.applicantId && b.jobOpeningId) {
      const res = await applyToOpening(db, {
        applicantId: String(b.applicantId), jobOpeningId: String(b.jobOpeningId),
        sourceNote: b.sourceNote ? String(b.sourceNote) : null,
      }, m.actor.name);
      return NextResponse.json(res, { status: 201 });
    }

    return NextResponse.json({ error: `Aksi tidak dikenal: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}

// DELETE /api/rekankerja/recruitment/applicants?id= — hapus pelamar (+dokumen)
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });
    const m = await requireMenuAction(req, "recruitment:applicants", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const slug = await tenantSlugOfSession(req);
    const res = await deleteApplicant(m.db, id, slug ?? "unknown", m.actor.name);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 400 });
  }
}
