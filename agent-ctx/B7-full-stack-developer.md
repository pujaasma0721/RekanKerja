# B7 — Portal pelamar: magic-link status lamaran + branding CareerSiteConfig (SELESAI)

Task ID: B7 · Laporan akhir subagent (sesi-2, finalisasi). Brief: agent-ctx/B7-BRIEF.md.

## Status: SELESAI — semua gate hijau, commit ter-push.

## Hasil inti
1. **Magic-link status lamaran** (tanpa password): `status-link-service.ts` — requestStatusLink (netral anti-enumerasi, rate-limit 3/jam per email + 10/jam per IP per tenant schema, dicek SEBELUM lookup), token HMAC `${exp}.${hex}` key SHA256(SESSION_SECRET:schema), 6 jam, TANPA PII; verifyStatusToken (400/410/200 + set statusLinkUsedAt); payload minim (slot terakhir, timeline tahapan TANPA evaluator, offer TANPA nominal, lampiran, appliedCount). API publik: POST status-link + GET status (no-store, 429 Retry-After). Portal :3010: form "Cek Status Lamaran" + halaman `/status/<token>` dwibahasa + tombol minta tautan baru. Email event `recruitment.status.link` (catch.jsonl terverifikasi).
2. **Branding CareerSiteConfig**: schema §3 + tenant-ddl + migrasi idempoten (3 tenant, no seed default) + parity `backlog-b7`; service get/save + ActivityLog `CareerSiteConfigSaved`; admin API op `site-config-save` (menu recruitment:settings op update) + tab UI "Branding Portal" (color picker + preview + validasi dwibahasa); API publik site-config (fallback tanpa 404); portal menerapkan brandColor palet turunan + logoUrl + heroTitle/heroSub per tenant.

## Keputusan penting (menyimpang dari literal brief — didokumentasikan)
- **Sekali-pakai**: reset `statusLinkUsedAt` saat minta link baru (impl sesi-1) menghidupkan ulang link lama → DIGANTI perbandingan waktu-terbit (`exp − TTL` vs `statusLinkUsedAt`): link lama tetap 410, link baru bekerja.
- Hero default row-absen = hero F2 asli (bukan teks baru; "Jelajahi Karier…" jadi placeholder admin); portal main-app-mati mempertahankan orange F2 (degradasi).
- Verifikasi token memindai HMAC seluruh applicant (anti-PII, dikomentari O(n) kecil).
- Honeypot short-circuit sebelum rate-limit (respons tetap identik).
- E2E: cahaya branding via db (tanpa login); email+IP nonce per-run; SSR portal diuji token segar ke-3.
- Portal type-check via `tsc --noEmit index.ts node_modules/bun-types/index.d.ts …` = 0 (bukan menjalankan server).

## Gates
- tsc scoped tsconfig.b7.json **0** · portal tsc light **0** · lint **0 error/6 warning baseline** (1 warning sesi-1 dihapus) · bilingual **TOTAL_GAP=150** · dev.log bersih · migrasi re-run idempoten · **E2E 48/48 PASS** · browser EN/ID + mobile 375 hscroll=0 + console 0 baru · 7 screenshot `audit/e2e-b7/` · ActivityLog verified.

## Artefak
- Baru: `src/rekankerja/recruitment/services/status-link-service.ts`, api/public-{status-link,status,site-config}.ts, routes `src/app/api/public/recruitment/{status-link,status,site-config}/route.ts`, `scripts/migrate-recruitment-b7-status-link.ts`, `scripts/e2e-b7-portal-magic.ts`, `tsconfig.b7.json`.
- Ubah: portal `index.ts` (+458), schema-tenant + tenant-ddl, recruitment-settings api/component/service, field-crypto (+tenantSchemaOfDb), parity-runner, email-defaults.

Commit: lihat `git log -1` (pesan "B7 backlog: …"). Push: origin/main.
