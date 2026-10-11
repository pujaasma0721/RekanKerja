// Thin route — logika handler ada di src/rekankerja/recruitment/api/ai.ts
// BUGFIX Next 16: `runtime` tidak boleh di-re-export — wajib inline per route.
export const runtime = "nodejs";
export { GET, POST } from "@/rekankerja/recruitment/api/ai";
