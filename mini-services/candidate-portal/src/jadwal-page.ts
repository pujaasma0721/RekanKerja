// P2.3-BM (D-BM18) — HALAMAN KANDIDAT MEMILIH SLOT JADWAL WAWANCARA
// /jadwal/<token>?t=<slug> — stub Phase 0 P2. IMPLEMENTASI SLICE P2.3-C
// DI FILE INI (pertahankan export renderJadwalPage + tanda tangan fungsi —
// routing index.ts sudah memanggilnya).
//
// Kontrak (pola /status + /sign):
//   * SSR server-side: fetch slot via /api/public/recruitment/interview-slots
//     (proxy PUBLIC_API_PREFIX otomatis meneruskan query t).
//   * Token acak hex (hash SHA-256 tersimpan di CandidateSelectionStep
//   .inviteTokenHash) — validasi format di routing index.ts.
//   * Tanpa PII di token; cache-control no-store.
export async function renderJadwalPage(token: string, tenantSlug: string | null, url: URL): Promise<Response> {
  void token; void tenantSlug; void url; // stub Phase 0 — diisi P2.3-C
  return new Response("P2.3 stub", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
