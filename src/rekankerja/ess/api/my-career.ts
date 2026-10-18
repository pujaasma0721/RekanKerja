// GET /api/rekankerja/ess/my-career — "Jalur Karier Saya" (P3.5-BM / D-BM27).
// READ-ONLY untuk karyawan yang login (requireEss): SATU respons utk seluruh
// halaman:
//   • posisi saat ini (dari assignment AKTIF terbaru) + grade + unit + masa
//     kerja (tenure) + di posisi ini sejak kapan;
//   • jalur karier dari posisi itu (CareerPath.fromPositionId) dengan
//     posisi tujuan + syarat keahlian + GAP PRIBADI: level saya
//     (EmployeeSkill) vs level syarat → ok = my >= required, plus ringkasan
//     met/total;
//   • daftar level keahlian saya saat ini (nama + level).
// Tanpa posisi aktif → position null + paths kosong (UI tampil empty state).
// Jalur karier = peta posisi + syarat teks — BUKAN modul training (D-BM28).
import { NextResponse } from "next/server";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";

/** Selisih tahun/bulan penuh utk tenure (pola konservatif — tanpa lib). */
function diffYearsMonths(from: Date, to: Date): { years: number; months: number } {
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months) };
}

export async function GET(req: Request) {
  const m = await requireEss(req);
  if (!m.ok) return NextResponse.json({ error: m.error }, { status: m.status });
  const { db, employeeId } = m.actor;

  try {
    // ===== (1) profil + posisi saat ini (assignment aktif TERBARU) =====
    const emp = await db.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, employeeNo: true, fullName: true, joinDate: true,
        assignments: {
          where: { validTo: null, positionId: { not: null } },
          select: {
            validFrom: true,
            position: {
              select: {
                id: true, code: true, title: true,
                orgUnit: { select: { name: true } },
                grade: { select: { name: true } },
              },
            },
          },
          orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
          take: 1,
        },
      },
    });
    if (!emp) return NextResponse.json({ error: "Karyawan tidak ditemukan" }, { status: 404 });

    const asg = emp.assignments[0] ?? null;
    const curPos = asg?.position ?? null; // positionId di-filter not-null → relation pasti ada
    const now = new Date();
    const tenure = emp.joinDate ? diffYearsMonths(emp.joinDate, now) : { years: 0, months: 0 };

    // ===== (2) jalur karier dari posisi ini + gap pribadi =====
    let paths: {
      id: string;
      toPosition: { id: string; code: string; title: string; gradeName: string | null };
      note: string | null;
      requirements: { skillId: string; name: string; required: number; my: number | null; ok: boolean }[];
      met: number;
      total: number;
    }[] = [];

    if (curPos) {
      const rows = await db.careerPath.findMany({
        where: { fromPositionId: curPos.id },
        include: {
          toPosition: { select: { id: true, code: true, title: true, grade: { select: { name: true } } } },
        },
        orderBy: { toPosition: { title: "asc" } },
      });

      // level saya utk SEMUA skill yang disyaratkan (1 kueri batch)
      const reqLists = rows.map((r) => {
        try {
          return r.requiredSkillsJson
            ? (JSON.parse(r.requiredSkillsJson) as { skillId: string; level: number }[])
            : [];
        } catch {
          return [] as { skillId: string; level: number }[]; // json legacy cacat → tanpa syarat
        }
      });
      const allSkillIds = [...new Set(reqLists.flat().map((x) => x.skillId))];
      const mySkills = allSkillIds.length
        ? await db.employeeSkill.findMany({
            where: { employeeId, skillId: { in: allSkillIds } },
            select: { skillId: true, level: true },
          })
        : [];
      const myLevel = new Map(mySkills.map((s) => [s.skillId, s.level]));

      // nama keahlian katalog (skill dinonaktifkan pun tetap bernama — syarat
      // historis jalur tetap terbaca)
      const catalog = allSkillIds.length
        ? await db.skillCatalog.findMany({
            where: { id: { in: allSkillIds } },
            select: { id: true, name: true },
          })
        : [];
      const nameOf = new Map(catalog.map((c) => [c.id, c.name]));

      paths = rows.map((r, i) => {
        const requirements = reqLists[i]!.map((x) => {
          const my = myLevel.get(x.skillId) ?? null;
          return {
            skillId: x.skillId,
            name: nameOf.get(x.skillId) ?? "—",
            required: x.level,
            my,
            ok: my != null && my >= x.level,
          };
        });
        return {
          id: r.id,
          toPosition: {
            id: r.toPosition.id, code: r.toPosition.code, title: r.toPosition.title,
            gradeName: r.toPosition.grade?.name ?? null,
          },
          note: r.note,
          requirements,
          met: requirements.filter((x) => x.ok).length,
          total: requirements.length,
        };
      });
    }

    // ===== (3) daftar level keahlian saya saat ini =====
    const skillRows = await db.employeeSkill.findMany({
      where: { employeeId },
      select: {
        level: true, assessedAt: true, evidence: true,
        skill: { select: { id: true, name: true, category: true } },
      },
      orderBy: [{ skill: { name: "asc" } }],
    });

    return NextResponse.json({
      employee: {
        fullName: emp.fullName,
        employeeNo: emp.employeeNo,
        joinDate: emp.joinDate ? emp.joinDate.toISOString().slice(0, 10) : null,
        tenureYears: tenure.years,
        tenureMonths: tenure.months,
      },
      position: curPos
        ? {
            id: curPos.id,
            code: curPos.code,
            title: curPos.title,
            gradeName: curPos.grade?.name ?? null,
            unitName: curPos.orgUnit?.name ?? null,
            since: asg?.validFrom ? asg.validFrom.toISOString().slice(0, 10) : null,
          }
        : null,
      paths,
      skills: skillRows.map((s) => ({
        skillId: s.skill.id,
        name: s.skill.name,
        category: s.skill.category,
        level: s.level,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
