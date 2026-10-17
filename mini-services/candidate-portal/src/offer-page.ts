// P2.4-BM (D-BM19) — HALAMAN PUTUSAN OFFER MANDIRI KANDIDAT
// /offer/<token>?t=<slug> — stub Phase 0 P2. IMPLEMENTASI SLICE P2.4-D
// DI FILE INI (pertahankan export renderOfferPage + tanda tangan fungsi —
// routing index.ts sudah memanggilnya).
//
// Kontrak (pola /sign EsignRequest DB-token):
//   * SSR server-side: fetch ringkasan offer via
//     /api/public/recruitment/offer-respond (proxy meneruskan query t).
//   * TANPA nominal gaji di halaman publik (aman seperti halaman status —
//     surat resmi bertanda tangan dikirim via email).
//   * Token acak hex (hash SHA-256 tersimpan di CandidateOffer
//   .selfServiceTokenHash) — validasi format di routing index.ts.
//   * Accept/decline POST ke API publik → race-guard 409 bila sudah
//     diputuskan; cache-control no-store.
export async function renderOfferPage(token: string, tenantSlug: string | null, url: URL): Promise<Response> {
  void token; void tenantSlug; void url; // stub Phase 0 — diisi P2.4-D
  return new Response("P2.4 stub", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
