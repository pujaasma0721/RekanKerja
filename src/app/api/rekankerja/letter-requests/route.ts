// Thin route — logika handler ada di src/rekankerja/shared/api/letter-requests.ts
export const runtime = "nodejs";
export { listLetterRequests as GET, decideLetterRequest as PATCH } from "@/rekankerja/shared/api/letter-requests";
