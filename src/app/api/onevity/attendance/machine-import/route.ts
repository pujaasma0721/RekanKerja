export const runtime = "nodejs";
// Thin route (27-a) — logika handler ada di src/onevity/time-attendance/api/machine-import.ts
// GET  → 20 batch import terakhir (riwayat audit)
// POST multipart {file, dryRun} → preview klasifikasi / komit import log mesin
import { machineImportGet, machineImportPost } from "@/onevity/time-attendance/api/machine-import";

export const GET = machineImportGet;
export const POST = machineImportPost;
