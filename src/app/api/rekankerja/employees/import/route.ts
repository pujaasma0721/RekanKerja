export const runtime = "nodejs";
// Thin route (T13-IMPORT) — logika handler ada di src/rekankerja/human-resource/api/employees.ts
// GET  ?template=1 → unduh XLSX template (sheet Karyawan + Referensi)
// POST multipart {file, dryRun} → validasi laporan / komit bulk import
import { employeesImportGet, employeesImportPost } from "@/rekankerja/human-resource/api/employees";

export const GET = employeesImportGet;
export const POST = employeesImportPost;
