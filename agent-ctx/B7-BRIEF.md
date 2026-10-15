# B7 BRIEF — Portal pelamar: magic-link status lamaran + branding CareerSiteConfig (DEVELOPMENT-PLAN-BACKLOG.md §4 B7)

Anda = subagent proyek RekanKerja. Kerjakan fase B7 END-TO-END hingga commit + push.

## WAJIB SEBELUM MULAI
1. `/home/z/my-project/worklog.md` — header aturan + entri B1–B6.
2. `/home/z/my-project/DEVELOPMENT-PLAN-BACKLOG.md` — §4 baris B7 + §5 risiko "Magic-link jadi vektor enumerasi email" (respons netral email ada/tidak; rate-limit per IP+email; token expired 6 jam SEKALI-PAKAI).
3. Modul Training TIDAK BOLEH disentuh (exclude user).

## LINGKUNGAN (SIAP — JANGAN ULANGI PEMULIHAN)
- Dev server :3000 JALAN. Portal kandidat mini-service :3010 JALAN (kode `mini-services/candidate-portal/index.ts` 1199 baris + `src/career-portal.tsx`; server bun murni TANPA dependensi — vanilla JS/HTML SSR). SMTP-catcher mini-service :2525 (menulis email ke `mini-services/smtp-catcher/catch.jsonl`) — CEK dulu hidup (`ss -tlnp | grep 2525`); bila mati start ulang pola mini-service lain (`cd mini-services/smtp-catcher && setsid -f bun run dev` — cek package.json script).
- Login owner `hrd@mii.co.id/onevity123`. PG 3 tenant (slug: mii / cahaya-digital-nusantara / sentra-logistik-prima — verifikasi via db platform Tenant).
- Memori 4GB; tsc scoped `NODE_OPTIONS="--max-old-space-size=2000" ./node_modules/.bin/tsc --noEmit -p tsconfig.b7.json`.

## REFERENSI ARSITEKTUR (pelajari dulu)
- Portal: `mini-services/candidate-portal/index.ts` — GET `/` SSR (openings + form lamaran vanilla JS dialog + honeypot + captcha), `ANY /api/public/recruitment/*` proxy ke main app, GET `/sign/<token>` halaman eSign (F7 — POLA HALAMAN TOKEN PUBLIK di portal), `/healthz`.
- API publik main app: `src/app/api/public/recruitment/{openings,captcha,apply,sign}/route.ts` — resolve tenant `?t=<slug>` (lihat openings route: slug → schema tenant; cross-tenant list saat tanpa t).
- Email: `notifyEmailEvent` (pola recruitment-esign-service.ts:139 — event + link placeholder); konfigurasi SMTP via API `PUT /api/rekankerja/email-config` (pola scripts/e2e-smtp-connect.ts — host 127.0.0.1 port 2525); email tertulis ke catch.jsonl.
- Kolom baru tabel existing di tenant-ddl: pola F8/F9 (ALTER/ADD COLUMN — cari contoh).
- Public page di main app: `/checklist/[token]`, `/v/[id]` (halaman verifikasi eSign — server component pola trServerFor).

## A. MAGIC-LINK STATUS LAMARAN (tanpa password)
### A.1 Main app — schema + service
1. `Applicant.statusLinkUsedAt DateTime?` (kolom baru — one-time use) + tenant-ddl + `scripts/migrate-recruitment-b7-status-link.ts` idempoten (loop 3 tenant, pola B6) + parity step `backlog-b7`.
2. `src/rekankerja/recruitment/services/status-link-service.ts` (BARU):
   - `requestStatusLink(db, {email, ip})`: normalisasi email; RATE-LIMIT in-memory Map (pola D20 dgn pergeseran jendela): maks 3/jam per (email) DAN 10/jam per IP → lempar 429 dgn pesan dwibahasa; honeypot handled caller. ANTI-ENUMERASI: fungsi SELALU resolve respons netral sama `{ok:true}` — email terkirim HANYA bila applicant dgn email itu ada (decrypt + compare case-insensitive; cari Applicant semua status kecuali Rejected? TIDAK — semua applicant Active/Outdated/Employed boleh; Rejected tetap boleh lihat statusnya — dia pelamar). Rate limit check DI AWAL (429 tetap 429 — jangan bocor enumerasi via timing: bila rate-limited return 429 sebelum lookup).
   - Token: `${exp}.${hex hmac}` — HMAC-SHA256 key = SHA256(SESSION_SECRET + ":" + schemaName) atas `${schemaName}:${applicantId}:${exp}`; exp = now + 6 jam; `statusLinkUsedAt` di-set saat VERIFIKASI sukses pertama (sekali-pakai). TANPA PII di token.
   - Kirim email `notifyEmailEvent` event BARU `"recruitment.status.link"` (tambah ke email-defaults: label "Rekrutmen — Tautan Cek Status Lamaran (→ Pelamar)", body ID sopan dgn placeholder {{nama}} {{link}} {{berlaku}}; daftar placeholder di baris ~319) — fire-and-forget.
   - `verifyStatusToken(db, token)`: parse exp+hmac → 410 bila kedaluwarsa; 410 bila statusLinkUsedAt terisi (sudah dipakai — minta tautan baru); sukses → set statusLinkUsedAt=now + return payload status.
   - `applicantStatusPayload(db, applicant)`: {applicantNo, fullName, slot dilamar terakhir (title + joRefNo + tanggal), status applicant, riwayat tahap seleksi (bila pernah jadi Candidate: nama tahap + status + planDate ringkas — TANPA nama evaluator/internal note), offer terakhir (offerNo + status + tanggal — TANPA nominal gaji), lampiran (nama file attachment applicant + ukuran), appliedCount total lamaran}. TANPA data internal sensitif (rating, catatan HR, score AI).
### A.2 Main app — API publik
3. `src/app/api/public/recruitment/status-link/route.ts`: POST JSON {email, website? (honeypot)} + `?t=<slug>` → resolve tenant; 429 rate-limit; respons netral `{ok:true}` SELALU (kecuali 429/400 validasi format email); NO login. Rate limit keyed per tenant schema juga (Map key = `${schema}:${ip}` / `${schema}:${email}`).
4. `src/app/api/public/recruitment/status/route.ts`: GET `?token=...` + `?t=<slug>` → verify → 200 payload ATAU 410 (kedaluwarsa/terpakai) / 400 (token format) — pesan dwibahasa netral (jangan bocor mana-mana). Header no-store.
### A.3 Portal mini-service
5. `mini-services/candidate-portal/index.ts`:
   - Form "Cek Status Lamaran / Check Application Status" di halaman `/` (bawah daftar lowongan; input email + honeypot tersembunyi + tombol; fetch POST `/api/public/recruitment/status-link?t=` → pesan netral dwibahasa "jika email terdaftar, tautan dikirim" — SELALU tampil sama).
   - Halaman BARU `GET /status/<token>?t=<slug>` (pola halaman /sign/<token>): tampilkan status pelamar (kartu ringkas: identitas terbatas {applicantNo, nama}, slot terakhir, status, tahapan timeline sederhana, offer, lampiran) — vanilla HTML/JS gaya portal existing + dwibahasa ikut ?lang portal (lihat cara /sign menangani bahasa) + tombol "Minta tautan baru". Selesaikan via fetch ke `/api/public/recruitment/status` main app (langsung :3000 server-side pola fetchEsignInfo — pelajari pola proxy/fetch yang dipakai /sign).
   - `/healthz` tetap.

## B. BRANDING CareerSiteConfig (per tenant)
1. Schema `CareerSiteConfig` persis §3 (tenantSlug @unique, brandColor default "#0f766e", logoUrl?, heroTitle?, heroSub?) + tenant-ddl + migrasi (gabung ke migrate-recruitment-b7: buat tabel bila belum + TANPA seed default — fallback kode) + parity.
2. API admin: di `src/rekankerja/recruitment/api/settings.ts` (atau file settings recruitment existing — PELAJARI struktur recruitment settings API) tambah op `getSiteConfig`/`saveSiteConfig` (menu recruitment:settings, op "update" existing atau op baru "branding"): validasi brandColor hex 6, logoUrl http(s), heroTitle ≤120 char; ActivityLog "CareerSiteConfigSaved".
3. API publik: `src/app/api/public/recruitment/site-config/route.ts` GET `?t=<slug>` → `{brandColor, logoUrl, heroTitle, heroSub, companyName}` — fallback default bila row tak ada (tanpa 404).
4. UI admin: tab/section "Branding Portal Karier" di halaman settings rekrutmen (`src/rekankerja/recruitment/components/` — cari settings component): color picker (input type=color + hex text), logo URL, hero title + sub, preview kecil (kartu mini ber-brandColor), ActivityLog. Dwibahasa t() BASE_EN.
5. Portal `/`: fetch site-config (server-side, fallback tenang bila main app mati — pola fetchOpenings) → terapkan: brandColor (CSS :root --brand + tombol), logoUrl di header (bila null → nama perusahaan teks), heroTitle/heroSub (fallback default ID/EN "Jelajahi Karier Bersama Kami" / companyName). Simpan per-tab ?t aktif.

## C. E2E `scripts/e2e-b7-portal-magic.ts` (pola b4/b5/b6: class Sesi, db platform + tenant)
1. SMTP: PUT email-config host 127.0.0.1:2525 (pola e2e-smtp-connect.ts) — catat state lama, restore di akhir.
2. Siapkan applicant uji via db (Applicant aktif MII dgn email terenkripsi e2e-b7@… — buat bila perlu + 1 attachment dummy + 1 slot lamaran via db/ApplicantApplication? PELAJARI model: applicant → application → slot; buat minimal 1 lamaran).
3. MINTA LINK: POST status-link email valid → 200 {ok:true}; email muncul di catch.jsonl (polling ≤10s) berisi link /status/<token>; POST email TIDAK-TERDAFTAR → 200 {ok:true} SAMA PERSIS (netral — assert json identik) + TIDAK ada email baru di catch.jsonl.
4. BUKA LINK: GET status?token=...&t=mii → 200 payload (applicantNo, nama, slot, tahapan array, lampiran array); SEKALI-PAKAI: GET ke-2 → 410; minta link baru (email lagi) → link LAMA sudah invalid (token berbeda) + link baru bekerja.
5. KEDALUWARSA: request link; craft token expired via helper service export (exp di masa lalu — verifikasi 410) — JANGAN tunggu 6 jam nyata.
6. RATE-LIMIT: 4x email sama berturut → ke-4 429; IP berbeda (header x-forwarded-for berbeda per request? public API — cek cara main app baca IP; bila x-forwarded-for di-trust, gunakan itu) → 3/jam email tercapai dulu; tunggu/jendela — pakai injeksi langsung ke Map internal via export helper reset utk cleanup (helper `__resetRateLimiterForTest`).
7. BRANDING: admin set CareerSiteConfig MII (heroTitle "Gerbang Talenta MII", brandColor "#b45309") + Cahaya (beda) → GET site-config?t=mii vs t=cahaya berbeda sesuai set; portal :3010 GET `/?t=mii` HTML MEMUAT heroTitle MII + warna; `/?t=cahaya-digital-nusantara` memuat branding cahaya; fallback: tenant tanpa row (sentra) → default.
8. GUARD: status-link tanpa email valid → 400; token rusak "abc" → 400.
9. CLEANUP: restore email-config lama, hapus CareerSiteConfig uji + applicant uji + statusLinkUsedAt null; rate limiter reset.
Format ✓/✗ + HASIL n/n; ulangi hingga PASS.

## D. GATES (semua hijau)
- tsc scoped `tsconfig.b7.json` 0 error (include: recruitment status-link service/api + public routes + portal? PORTAL = file .ts bun murni di luar src/ — buat tsconfig include mini-services/candidate-portal/index.ts bila type-checkable dgn import path root; bila dependensi cross-path bikin ribet, cek via `bun build --no-bundle`? JANGAN berat — cukup `bun -e "await import('./mini-services/candidate-portal/index.ts')"`? ITU MENJALANKAN server — JANGAN. Alternatif ringan: `bunx tsc --noEmit mini-services/candidate-portal/index.ts --skipLibCheck --target esnext --module esnext --moduleResolution bundler` bila cepat; bila bermasalah, verifikasi via `/healthz` + render halaman (portal sudah berjalan hot-reload? cek dev script portal — `bun --hot`?). LAPORKAN pendekatan yang dipakai.)
- `bun run lint` 0 error / 6 warning baseline. `bun scripts/audit-bilingual.ts` TOTAL_GAP=150. dev.log bersih.
- E2E PASS penuh.
- BROWSER (agent-browser): buka `http://localhost:3010/?t=mii` — career page render + form Cek Status muncul (EN+ID via toggle bahasa portal bila ada); admin MII → Recruitment settings → section Branding render (color + preview); set heroTitle via UI → simpan → reload portal → hero berubah; mobile 375×812 hscroll=0 (portal); console 0 error baru. 2–3 screenshot `audit/e2e-b7/`.
- Catatan gateway: fetch browser ke portal harus RELATIF — halaman portal dilayani :3010 via gateway preview `?XTransformPort=3010`; di agent-browser buka `http://localhost:3010/?t=mii` LANGSUNG boleh (internal). E2E script fetch :3010 langsung OK.

## E. WORKLOG + COMMIT + PUSH
Append worklog entri Task ID B7 (format B6) + `git add -f worklog.md`; SATU commit gaya B6 + `git push origin main`; LAPOR lengkap (ringkasan + gates + commit + E2E n/n + screenshot + keputusan).

## DISIPLIN
- JANGAN ubah perilaku apply/esign existing; JANGAN buat modul training; JANGAN simpan PII di token; respons netral anti-enumerasi DIUJI.
- Rate limit = in-memory per-proses (dokumentasikan keterbatasan restart di komentar — pola D20).
- DialogContent sm:max-w-*; t() BASE_EN; ActivityLog mutasi admin; honeypot + no-store di API publik.
- Context hampir habis → checkpoint commit + worklog DULU.
