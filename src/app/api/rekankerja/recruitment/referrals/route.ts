// Thin route — logika handler ada di src/rekankerja/recruitment/api/referrals.ts
// `runtime` wajib inline (Next 16 tidak menerima re-export field konfigurasi).
export const runtime = "nodejs";
export { GET, POST } from "@/rekankerja/recruitment/api/referrals";
