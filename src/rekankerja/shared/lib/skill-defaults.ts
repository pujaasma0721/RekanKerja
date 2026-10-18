// P3.2-BM (D-BM24) — katalog keahlian default (seed starter per tenant).
// Dipakai bersama oleh provisioning (tenant baru) dan migrate-p3-benchmark
// (tenant existing) — SATU sumber agar tidak berdivergen.
// Catatan: ini KATALOG organisasi (SkillCatalog) — BUKAN modul training
// (D-BM28 exclude permanen; tidak ada kursus/sesi/e-learning di sini).

export interface DefaultSkillSeed {
  code: string;
  name: string;
  category: string;
}

export const DEFAULT_SKILL_CATALOG: DefaultSkillSeed[] = [
  // Teknis — umum lintas industri
  { code: "SKL-EXCL", name: "Microsoft Excel", category: "Teknis" },
  { code: "SKL-DATA", name: "Analisis Data", category: "Teknis" },
  { code: "SKL-SQL", name: "SQL / Basis Data", category: "Teknis" },
  { code: "SKL-ERP", name: "Sistem ERP", category: "Teknis" },
  { code: "SKL-ISO", name: "ISO / Sistem Manajemen Mutu", category: "Teknis" },
  // Soft skill
  { code: "SKL-COMM", name: "Komunikasi Efektif", category: "Soft Skill" },
  { code: "SKL-COLB", name: "Kolaborasi Tim", category: "Soft Skill" },
  { code: "SKL-PSOL", name: "Pemecahan Masalah", category: "Soft Skill" },
  { code: "SKL-ADAP", name: "Adaptabilitas", category: "Soft Skill" },
  // Manajerial
  { code: "SKL-LEAD", name: "Kepemimpinan", category: "Manajerial" },
  { code: "SKL-PLN", name: "Perencanaan & Organisasi", category: "Manajerial" },
  { code: "SKL-NEG", name: "Negosiasi", category: "Manajerial" },
  { code: "SKL-COACH", name: "Coaching & Umpan Balik", category: "Manajerial" },
  // Regulasi & kepatuhan (moat Indonesia)
  { code: "SKL-PPh21", name: "PPh 21 & PPh 26", category: "Regulasi & Kepatuhan" },
  { code: "SKL-BPJS", name: "BPJS Kesehatan & Ketenagakerjaan", category: "Regulasi & Kepatuhan" },
  { code: "SKL-UUKEK", name: "Ketenagakerjaan (UU 13/2003 & turunannya)", category: "Regulasi & Kepatuhan" },
  // Bahasa
  { code: "SKL-EN", name: "Bahasa Inggris", category: "Bahasa" },
];
