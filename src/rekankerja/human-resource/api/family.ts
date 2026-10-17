import { NextRequest, NextResponse } from "next/server";
import { requireTenant, UNAUTHORIZED_MSG } from "@/rekankerja/shared/lib/tenant-db";
import { requireMenuAction, requireMenuViewAny } from "@/rekankerja/shared/services/menu-access";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { ptkpPendingForEmployee } from "@/rekankerja/payroll/services/ptkp-auto";

// GET ?employeeId= | POST | PATCH | DELETE ?id=
// Task 32-d: mutasi dijaga hak AKSI menu hr:directory (per pengguna).
// Task 82-c: PATCH — ubah baris keluarga tanpa hapus+tambah (jejak utuh).
// Task 49: PTKP karyawan bersumber "auto" mengikuti data keluarga.
// Task 50: mutasi keluarga TIDAK lagi menulis PTKP efektif — PTKP payroll
// = snapshot hasil refresh tahunan; perubahan keluarga (tambah/hapus
// pasangan/tanggungan) hanya berlaku pada refresh 1 Januari TAHUN
// BERIKUTNYA. Respons membawa "ptkpPending" (tanpa tulis DB) supaya UI
// bisa memberi tahu perubahan yang tertunda.
//
// P1.1-BM:
// · D-BM4 — EmployeeFamily.nationalId (NIK anggota keluarga) OPSIONAL,
//   TERENKRIPSI enc:v1 (pola bankAccount employees.ts); 16 digit divalidasi
//   bila diisi; GET mengembalikan nilai TERDEKRIPSI (display masking di UI,
//   pola PII 3-tier employees.ts — pemanggil menu HR melihat nilai penuh utk
//   prefill dialog ubah).
// · D-BM2 — KONTAK DARURAT (EmergencyContact) 1–N: CRUD admin lewat
//   parameter kind=emergency (telepon terenkripsi enc:v1). Guard sama dgn
//   keluarga (hr:directory create/update/delete; GET kind=emergency
//   memakai gerbang menu-view karena berisi PII nomor telepon).
// · ActivityLog kini ditulis pada SEMUA mutasi keluarga & kontak darurat.
const FAMILY_ACTIVITY_LOG = true; // penanda konvensi — semua mutasi ter-audit

function logDetail(prefix: string, name: string, employeeId: string): string {
  return `${prefix} anggota keluarga "${name}" pada profil karyawan ${employeeId}`;
}

export async function GET(req: NextRequest) {
  try {
    const db = await requireTenant(req);
    if (!db) return NextResponse.json({ error: UNAUTHORIZED_MSG }, { status: 401 });

    const employeeId = req.nextUrl.searchParams.get("employeeId");
    if (!employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });

    // P1.1-BM (D-BM2) — kontak darurat: PII nomor telepon → gerbang menu-view.
    if (req.nextUrl.searchParams.get("kind") === "emergency") {
      const m = await requireMenuViewAny(req, ["hr:directory"]);
      if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
      const contacts = await m.db.emergencyContact.findMany({
        where: { employeeId },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      });
      const tc = tenantCryptoForDb(m.db);
      return NextResponse.json({
        contacts: contacts.map((c) => ({
          ...c,
          phone: tc.decryptText(c.phone) ?? "",
        })),
      });
    }

    const family = await db.employeeFamily.findMany({ where: { employeeId }, orderBy: { birthDate: "asc" } });
    // D-BM4 — NIK keluarga terenkripsi di DB → dekripsi di batas serializer.
    const tc = tenantCryptoForDb(db);
    return NextResponse.json({
      family: family.map((f) => ({ ...f, nationalId: tc.decryptText(f.nationalId) })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

// ===== P1.1-BM (D-BM2) — validasi input kontak darurat =====
interface EmergencyInput {
  employeeId?: string; id?: string;
  name?: string; relationship?: string; phone?: string;
  address?: string | null; notes?: string | null; isPrimary?: boolean;
}

function parseEmergencyInput(b: EmergencyInput) {
  const name = String(b.name ?? "").trim().slice(0, 100);
  const relationship = String(b.relationship ?? "").trim().slice(0, 50);
  const phone = String(b.phone ?? "").trim().slice(0, 30);
  const address = b.address != null && String(b.address).trim() !== "" ? String(b.address).trim().slice(0, 300) : null;
  const notes = b.notes != null && String(b.notes).trim() !== "" ? String(b.notes).trim().slice(0, 300) : null;
  const isPrimary = b.isPrimary === true;
  return { name, relationship, phone, address, notes, isPrimary };
}

export async function POST(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "create");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const tc = tenantCryptoForDb(db);

    const b = await req.json();
    if (!b.employeeId) return NextResponse.json({ error: "employeeId wajib" }, { status: 400 });

    // ===== P1.1-BM (D-BM2) — kontak darurat (kind=emergency) =====
    if (b.kind === "emergency") {
      const input = parseEmergencyInput(b);
      if (!input.name || !input.relationship || !input.phone) {
        return NextResponse.json({ error: "Nama, hubungan & telepon kontak darurat wajib diisi" }, { status: 400 });
      }
      const contact = await db.emergencyContact.create({
        data: {
          employeeId: b.employeeId,
          name: input.name,
          relationship: input.relationship,
          // encryptText(maybe-null) → string | null; phone sudah divalidasi
          // non-kosong — kembalikan string (kolom NOT NULL).
          phone: tc.encryptText(input.phone) ?? "",
          address: input.address,
          notes: input.notes,
          isPrimary: input.isPrimary,
        },
      });
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? undefined,
          action: "Created", entity: "EmergencyContact", entityId: contact.id, employeeId: b.employeeId,
          detail: `Kontak darurat "${input.name}" (${input.relationship}) ditambahkan oleh ${m.actor.appUsername ?? m.actor.name}`,
        },
      }).catch(() => { /* best-effort */ });
      return NextResponse.json({ contact: { ...contact, phone: input.phone } }, { status: 201 });
    }

    if (!b.name || !b.relation) return NextResponse.json({ error: "Nama & hubungan wajib diisi" }, { status: 400 });
    // D-BM4 — NIK anggota keluarga opsional; 16 digit bila diisi.
    const nationalId = b.nationalId != null ? String(b.nationalId).trim() : "";
    if (nationalId && !/^\d{16}$/.test(nationalId)) {
      return NextResponse.json({ error: "NIK anggota keluarga harus 16 digit angka" }, { status: 400 });
    }
    const fam = await db.employeeFamily.create({
      data: {
        employeeId: b.employeeId, relation: b.relation, name: b.name, gender: b.gender ?? "M",
        birthDate: b.birthDate ? new Date(b.birthDate) : null,
        occupation: b.occupation ?? null, isDependent: b.isDependent ?? true,
        // D-BM4 — NIK keluarga TERENKRIPSI (enc:v1 — pola bankAccount employees.ts).
        nationalId: nationalId ? tc.encryptText(nationalId) : null,
      },
    });
    if (FAMILY_ACTIVITY_LOG) {
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? undefined,
          action: "Created", entity: "EmployeeFamily", entityId: fam.id, employeeId: b.employeeId,
          detail: logDetail("Ditambahkan", String(b.name), String(b.employeeId)) +
            (nationalId ? " — NIK keluarga tersimpan terenkripsi" : ""),
        },
      }).catch(() => { /* best-effort */ });
    }
    // Task 50: PTKP tertunda — saran dari data keluarga BARU, tanpa menulis
    // (berlaku 1 Januari tahun depan; PTKP efektif tahun ini tidak berubah).
    const ptkpPending = await ptkpPendingForEmployee(db, b.employeeId);
    return NextResponse.json({ family: { ...fam, nationalId: nationalId || null }, ptkpPending }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    // Task 82-c: guard aksi update (cermin POST/DELETE di file ini).
    const m = await requireMenuAction(req, "hr:directory", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;
    const tc = tenantCryptoForDb(db);

    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    // ===== P1.1-BM (D-BM2) — ubah kontak darurat =====
    if (b.kind === "emergency") {
      const existing = await db.emergencyContact.findUnique({
        where: { id: String(b.id) },
        select: { id: true, employeeId: true },
      });
      if (!existing) return NextResponse.json({ error: "Kontak darurat tidak ditemukan" }, { status: 404 });
      const input = parseEmergencyInput(b);
      if (b.name !== undefined || b.relationship !== undefined || b.phone !== undefined) {
        if (!input.name || !input.relationship || !input.phone) {
          return NextResponse.json({ error: "Nama, hubungan & telepon kontak darurat wajib diisi" }, { status: 400 });
        }
      }
      const contact = await db.emergencyContact.update({
        where: { id: existing.id },
        data: {
          ...(b.name !== undefined ? { name: input.name } : {}),
          ...(b.relationship !== undefined ? { relationship: input.relationship } : {}),
          ...(b.phone !== undefined ? { phone: tc.encryptText(input.phone) ?? "" } : {}),
          ...(b.address !== undefined ? { address: input.address } : {}),
          ...(b.notes !== undefined ? { notes: input.notes } : {}),
          ...(b.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        },
      });
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? undefined,
          action: "Updated", entity: "EmergencyContact", entityId: existing.id, employeeId: existing.employeeId,
          detail: `Kontak darurat "${input.name || "—"}" diperbarui oleh ${m.actor.appUsername ?? m.actor.name}`,
        },
      }).catch(() => { /* best-effort */ });
      return NextResponse.json({ contact: { ...contact, phone: input.phone } });
    }

    // validasi CERMIN POST: nama & hubungan wajib (bila dikirim, tak boleh kosong).
    const relation = b.relation !== undefined ? String(b.relation) : undefined;
    const name = b.name !== undefined ? String(b.name).trim() : undefined;
    if (relation === "" || name === "") return NextResponse.json({ error: "Nama & hubungan wajib diisi" }, { status: 400 });
    // D-BM4 — NIK keluarga bila dikirim: 16 digit / kosong utk menghapus.
    let nationalIdUpdate: string | null | undefined;
    if (b.nationalId !== undefined) {
      const v = b.nationalId != null ? String(b.nationalId).trim() : "";
      if (v && !/^\d{16}$/.test(v)) {
        return NextResponse.json({ error: "NIK anggota keluarga harus 16 digit angka" }, { status: 400 });
      }
      nationalIdUpdate = v ? tc.encryptText(v) : null;
    }
    // record milik employee yang valid — 404 bila tidak ada.
    const existing = await db.employeeFamily.findUnique({
      where: { id: String(b.id) },
      select: { id: true, employeeId: true },
    });
    if (!existing) return NextResponse.json({ error: "Data keluarga tidak ditemukan" }, { status: 404 });

    const fam = await db.employeeFamily.update({
      where: { id: existing.id },
      data: {
        ...(relation !== undefined ? { relation } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(b.gender !== undefined ? { gender: b.gender ?? "M" } : {}),
        ...(b.birthDate !== undefined ? { birthDate: b.birthDate ? new Date(b.birthDate) : null } : {}),
        ...(b.occupation !== undefined ? { occupation: b.occupation ?? null } : {}),
        ...(b.isDependent !== undefined ? { isDependent: b.isDependent ?? true } : {}),
        ...(nationalIdUpdate !== undefined ? { nationalId: nationalIdUpdate } : {}),
      },
    });
    if (FAMILY_ACTIVITY_LOG) {
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? undefined,
          action: "Updated", entity: "EmployeeFamily", entityId: existing.id, employeeId: existing.employeeId,
          detail: logDetail("Diubah", String(name ?? fam.name), existing.employeeId),
        },
      }).catch(() => { /* best-effort */ });
    }
    // Task 50: saran PTKP tertunda mengikuti data keluarga TERBARU (tanpa tulis).
    const ptkpPending = await ptkpPendingForEmployee(db, existing.employeeId);
    return NextResponse.json({ family: { ...fam, nationalId: tc.decryptText(fam.nationalId) }, ptkpPending });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:directory", "delete");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
    const db = m.db;

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id wajib" }, { status: 400 });

    // ===== P1.1-BM (D-BM2) — hapus kontak darurat =====
    if (req.nextUrl.searchParams.get("kind") === "emergency") {
      const existing = await db.emergencyContact.findUnique({
        where: { id },
        select: { id: true, employeeId: true, name: true },
      });
      if (!existing) return NextResponse.json({ error: "Kontak darurat tidak ditemukan" }, { status: 404 });
      await db.emergencyContact.delete({ where: { id } });
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? undefined,
          action: "Deleted", entity: "EmergencyContact", entityId: id, employeeId: existing.employeeId,
          detail: `Kontak darurat "${existing.name}" dihapus oleh ${m.actor.appUsername ?? m.actor.name}`,
        },
      }).catch(() => { /* best-effort */ });
      return NextResponse.json({ ok: true });
    }

    // Task 50: tangkap employeeId SEBELUM baris terhapus — hitung saran
    // PTKP tertunda TANPA menulis (perubahan berlaku 1 Jan tahun depan).
    const fam = await db.employeeFamily.findUnique({ where: { id }, select: { employeeId: true, name: true } });
    if (!fam) return NextResponse.json({ error: "Data keluarga tidak ditemukan" }, { status: 404 });
    await db.employeeFamily.delete({ where: { id } });
    if (FAMILY_ACTIVITY_LOG) {
      await db.activityLog.create({
        data: {
          appUserId: m.actor.appUserId ?? undefined,
          action: "Deleted", entity: "EmployeeFamily", entityId: id, employeeId: fam.employeeId,
          detail: logDetail("Dihapus", fam.name, fam.employeeId),
        },
      }).catch(() => { /* best-effort */ });
    }
    const ptkpPending = await ptkpPendingForEmployee(db, fam.employeeId);
    return NextResponse.json({ ok: true, ptkpPending });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
