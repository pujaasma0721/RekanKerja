import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import {
  CHECKLIST_DEPARTMENTS, getDeptRecipients, setDeptRecipients,
} from "@/rekankerja/shared/services/checklist-service";

// RekanKerja — Penerima email checklist per bagian (Task 65).
// GET  → daftar bagian + email terkonfigurasi (fallback kosong = pakai approver).
// PUT  → simpan email satu bagian {dept, emails: string[]} (Admin/HR saja).
// Data disimpan di Lookup(category "ChecklistDeptEmail", code = kode bagian).

export async function GET(req: NextRequest) {
  try {
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "view");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const rows = await Promise.all(
      CHECKLIST_DEPARTMENTS.map(async (d) => ({
        dept: d.code,
        label: d.label,
        emails: await getDeptRecipients(m.db, d.code),
      })),
    );
    return NextResponse.json({ departments: rows });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    // Task 82-T11: guard sejalan menu Checklist Onboarding (dulu settings:user-access — lintas domain).
    const m = await requireMenuAction(req, "hr:onboarding-checklist", "update");
    if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });

    const b = await req.json();
    const dept = String(b.dept ?? "");
    const emails: string[] = Array.isArray(b.emails) ? b.emails.map((e: unknown) => String(e)) : [];
    const valid = emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (valid.length !== emails.length) {
      return NextResponse.json({ error: "Ada format email tidak valid" }, { status: 400 });
    }
    await setDeptRecipients(m.db, dept, valid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
