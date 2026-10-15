# B3 — Heuristik Attrisi Explainable (Talent)

Task ID: B3 (DEVELOPMENT-PLAN-BACKLOG.md §4 B3; D-BL10–D-BL12/D-BL18)
Status: SELESAI — E2E 22/22, lint 0 error (6 warning baseline), tsc isolasi file baru 0 error, audit-bilingual TOTAL_GAP=150 (baseline).

## File dibuat
- `src/rekankerja/performance/services/talent-service.ts` (417 baris) — listAttritionRisk on-demand STATELESS (tanpa tabel/migrasi). 6 faktor {key,score,max,available,note}: rating 30 + trend 10 + pip 20 + tenure 10 + compa 15 + reward 15 = 100. Skor = round(Σscore/Σmax TERSEDIA ×100) — faktor unavailable keluar pembilang+penyebut (D-BL11). Akses D-BL12 di service: HR (talentHrActor: OWNER/ADMIN/HR | Admin/HR Manager/HR Staff) semua; Direksi (judul posisi aktif mengandung director/chief/direktur — pola merit L2) semua; selain itu bawahan langsung (assignment aktif managerId); bukan atasan → TalentForbiddenError 403. Urut skor desc, take 200. Export helper murni (ratingScore/trendScore/tenureScore/compaScore/rewardScore/monthsSince/levelOf) — E2E sengaja TIDAK memakainya (duplikasi manual utk regresi).
- `src/rekankerja/performance/api/talent.ts` (42) + `src/app/api/rekankerja/performance/talent/route.ts` (1) — GET ?unitId&q&onlyHigh → {rows, stats{tinggi,sedang,rendah,total}, disclaimer(key), scope}. Menu guard requireMenuViewAny(["performance:talent"]) — TANPA fallback overview (D-BL12 ketat). Read-only, tanpa POST/op-map.
- `src/rekankerja/performance/components/performance-talent.tsx` (391) — dwibahasa t() BASE_EN: banner disclaimer amber D-BL11, filter (search + select unit /api/rekankerja/org-units + switch "Hanya Tinggi"), 3 tile statistik, tabel desktop dgn expand rincian 6 faktor (mini progress + chip "data terbatas" bila unavailable), kartu mobile <640px, empty state, chip scope tim utk atasan.
- `scripts/e2e-b3-attrition.ts` (286) + `tsconfig.b3.json` (24).

## File diubah (wiring 4 titik, pola B1 okr)
- `app-shell.tsx` — grup nav baru "TALENT" setelah Tindak Lanjut: {id:"talent", label:"Talent & Attrisi", icon:TrendingUp (sudah terimpor)}.
- `performance-module.tsx` — case "talent" → PerformanceTalentPage.
- `menu-perms.ts` — "performance:talent": [] (read-only, tanpa op).
- `user-access-view.tsx` — komentar seksi B3 di MENU_OPS_HINT_EN (menu muncul otomatis di katalog via nav; tanpa op berarti tanpa entri label EN).

## E2E 22/22 (bun scripts/e2e-b3-attrition.ts)
(a) struktur 46 rows, factors 6 key lengkap, skor 0–100, level ∈3, stats Σ=total, disclaimer key; (b) DETERMINISTIK Tuti MII00013: manual dari db (rating 2, pip -, tenure 6.8thn, compa 1.04, reward 51 bln SalaryAdjustment) = API 42 Sedang (±1); (c) Joko tanpa appraisal → rating+trend unavailable, Σmax tersedia 60<100; Siti tanpa grade → compa unavailable; (d) yusuf 403 (bawahan=0 via db), service Joko 19/19 tim, Direksi Hartono 46/46, Tuti biasa → 403; (e) injeksi PIP Active Budi MII00035 (47→80 Tinggi) → onlyHigh semua Tinggi + pip 20/20, cleanup, skor kembali 47 deterministik.

## Keputusan menyimpang (dari brief ambigu)
1. REWARD memakai 3 changeReason {Promotion, SalaryAdjustment, Mutation} (bullet "Ambil data" brief) — spesifikasi faktor 5 hanya menyebut 2; mutasi dihitung peristiwa karier. Terdokumentasi di komentar service.
2. rating available bila ≥1 siklus terpublikasi ber-rating (note "data terbatas" bila <2 siklus); TANPA appraisal → unavailable. Trend available hanya bila 2 siklus ber-rating.
3. PIP "aktif" = status {Active, Extended} (Draft belum berjalan; merujuk merit PIP_ACTIVE_STATUS_SET yang memasukkan Draft — dipilih tidak, karena "aktif" berarti program berjalan).
4. Stats dihitung SEBELUM filter onlyHigh (distribusi populasi sejati — tile tetap informatif saat daftar dipadatkan).
5. Reward >24 bln dgn rating unavailable → cabang "rating ≤3" (8) — tak bisa dikonfirmasi "performa bagus" → tidak diberi 15.
6. Endpoint unit = /api/rekankerja/org-units (endpoint daftar unit yang DIPAKAI modul Kinerja — cycles/calibration; performance-goals.tsx sendiri tidak memakai daftar unit).
7. Akses menu guard hanya performance:talent (tanpa fallback performance:overview seperti endpoint lain) — D-BL12 membatasi.

## Sisa pekerjaan
- B4 succession (kartu overview Talent menunggu B4 — overview sengaja tidak diubah).
- tsc penuh tsconfig.b3.json oleh orchestrator (dev server hidup — OOM guard; tsc isolasi file baru sudah 0 error).
