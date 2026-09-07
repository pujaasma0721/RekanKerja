// Thin route — logika handler ada di src/onevity/shared/api/letter-requests.ts
export const runtime = "nodejs";
export { listLetterRequests as GET, decideLetterRequest as PATCH } from "@/onevity/shared/api/letter-requests";
