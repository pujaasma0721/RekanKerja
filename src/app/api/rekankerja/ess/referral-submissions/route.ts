// Thin route — logika handler ada di src/rekankerja/ess/api/referral-submissions.ts
// `runtime` wajib inline (Next 16 tidak menerima re-export field konfigurasi).
export const runtime = "nodejs";
export { GET, POST } from "@/rekankerja/ess/api/referral-submissions";
