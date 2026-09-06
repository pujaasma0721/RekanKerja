export const runtime = "nodejs";
// Thin route (T13-IMPORT) — logika handler ada di src/onevity/human-resource/api/employees.ts
// GET → unduh XLSX direktori karyawan aktif sesuai scope akses (upah bila scope penuh)
import { employeesExportGet } from "@/onevity/human-resource/api/employees";

export const GET = employeesExportGet;
