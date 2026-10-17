// Thin route — logika handler ada di src/rekankerja/recruitment/api/referral-staging.ts
// `runtime` wajib inline (Next 16 tidak menerima re-export field konfigurasi).
export const runtime = "nodejs";
export { GET, PATCH } from "@/rekankerja/recruitment/api/referral-staging";
