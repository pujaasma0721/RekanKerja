# QA-TEST-PLAN — RekanKerja Multi-Tenant SaaS (Production Readiness)

> Dokumen ini = hasil eksekusi lengkap 5 pilar QA (Lead QA Automation + AppSec).
> Semua asumsi diverifikasi langsung dari kode (bukan dari dokumen).
> Status tiap kasus diperbarui setelah eksekusi suite `scripts/qa/*`.

---

## 0. Architecture Profile (terverifikasi dari kode — Step 1)

| Dimensi | Implementasi nyata | Bukti kode |
|---|---|---|
| **Tenant Isolation** | **Schema-per-tenant PostgreSQL** (`tenant_<slug>`) + registry platform (`public.Tenant`/`User`/`UserTenant`). Client Prisma per schema, `connection_limit=3`, `pool_timeout=10s`, cache di `globalThis`. TIDAK ada RLS — isolasi di lapisan aplikasi: `requireTenant()` = sesi terverifikasi → `effectiveTenantIdOf()` (subdomain MEMAKSA tenant, Task 78) → cek membership `UserTenant` → status `ACTIVE` → client schema. | `src/rekankerja/shared/lib/tenant-db.ts` L100–196 |
| **Routing** | **Subdomain** `<slug>.<base>` via header Host/x-forwarded-host → registry (cache TTL 60 dtk) — aktif hanya bila `REKANKERJA_BASE_DOMAINS` di-set; fallback cookie `tid`. SPA routing via query (`?s=&v=`). **Tidak ada file `middleware.ts`** (resolusi tenant di lapisan route handler, bukan edge). | `tenant-host.ts` + `tenant-host-server.ts` |
| **Auth** | **Custom** (bukan NextAuth): scrypt + session cookie `rekankerja_session` HMAC-SHA256, httpOnly, SameSite=Lax, Secure di prod, host-only, 7 hari. **Revokasi server-side** via `sessionVersion` (T1-SECURITY). MFA TOTP opsional (secret AES-256-GCM at-rest). Lockout 5x/15m + rate-limit login per-IP (30 gagal/15m). Idle timeout (env + per-tenant). | `src/rekankerja/shared/lib/auth.ts` |
| **RBAC** | Role workspace: `OWNER | ADMIN | HR | VIEWER` (UserTenant.role) + AppUser role domain per menu. Guard: `requireTenant` (401), `requireMutator` (VIEWER→403 mutasi), `requireMenuAction` (per-menu per-aksi), `requireEss` (ESS), money-vault gate (enkripsi nilai uang + grant money-view). | `tenant-db.ts`, `menu-access.ts`, `money-view.ts` |
| **Public API** | Header `x-api-key` → SHA-256 hash → tenant ACTIVE (cache 5 mnt, revoke dicek langsung DB) → rate limit 60 req/menit/kunci (429) → scope `employees/leave/payroll`. | `apikey-service.ts` |
| **DB / ORM** | Prisma 6, PostgreSQL embedded single-node (max_connections=100; anggaran ±19–30 tenant/node terdokumentasi M-19). | `schema.prisma` + `schema-tenant.prisma` |
| **Billing provider** | **TIDAK ADA** (no Stripe/Midtrans/Xendit). `Tenant.plan` (trial/starter/growth/enterprise) = field registry informatif. **Webhook internal** (outbound): `WebhookEndpoint`/`WebhookDelivery` HMAC-signature + retry/backoff (5 percobaan → dead), plus `ApiKey` (T18-API). | grep seluruh src: 0 hit payment provider |
| **Caching** | **TIDAK ada ISR/SSG/`unstable_cache`/fetch-cache tenant-scoped** (0 penggunaan; 4 route `force-dynamic`). Cache in-memory: host→tenant (key=slug), client tenant (key=schema), resolve apikey (key=hash, revoke selalu diperiksa per-request), rate maps. | grep + `tenant-host-server.ts` |
| **White-labeling** | `Tenant.name`/`companyCode` (prefix nomor karyawan), brand "RekanKerja", dwibahasa EN/ID (i18n-core). Subdomain per tenant + main host netral. | provisioning.ts |

**Adaptasi pilar** (jujur, karena arsitektur nyata ≠ template generik):
- Pilar 4 "Billing webhooks" → diadaptasi ke yang ADA: rate-limit kunci API (usage limit nyata), scope enforcement, revoke seketika, idempotensi scheduler (`report-schedule:<id>:<dateKey>`), anti-double-submit leave request. Gap billing-enforcement dicatat sebagai temuan roadmap.
- Pilar 5 "Subdomain routing" → fitur nyata Task 78, diuji via header Host langsung (gateway sandbox tidak bisa resolve subdomain dinamis).

---

## 1. Test Plan Matrix

### Pilar 1 — Data & Tenant Isolation (Zero Leakage)

| ID | Skenario | Perilaku Diharapkan | Severity | Suite |
|---|---|---|---|---|
| TI-01 | Login 2 tenant terpisah (MII owner / Cahaya owner) → jar cookie terpisah | 200 keduanya, cookie `rekankerja_session` berbeda nilai | Critical | 01 |
| TI-02 | Daftar perusahaan MII vs Cahaya (`GET /api/rekankerja/companies`) | Himpunan data disjoint — 0 nama perusahaan tumpang tindih | Critical | 01 |
| TI-03 | **IDOR lintas schema**: sesi MII `GET /employees?q=<nama karyawan Cahaya>` (nama+email+employeeNo) | 0 baris (kueri berjalan di schema `tenant_mii` saja) | Critical | 01 |
| TI-04 | IDOR balik: sesi Cahaya cari nama karyawan MII | 0 baris | Critical | 01 |
| TI-05 | `POST /api/auth/select-tenant { tenantId: <Cahaya> }` dengan sesi MII (bukan anggota) | 403 "Anda bukan anggota workspace ini" | Critical | 01 |
| TI-06 | **Host forcing** (Task 78): cookie sesi Cahaya + `Host: mii.rekankerja.id` → `GET /api/rekankerja/companies` | 401 (tidak pernah jatuh ke tenant cookie) | Critical | 01 |
| TI-07 | Host forcing valid: cookie sesi MII + `Host: mii.rekankerja.id` | 200 data MII (tid dipaksa oleh host, bukan cookie) | High | 01 |
| TI-08 | Subdomain tak dikenal: `Host: ghost.rekankerja.id` + sesi MII | 401 — TIDAK ada fallback cookie (anti parkir/typo) | High | 01 |
| TI-09 | `GET /api/auth/me` sesi MII — daftar workspace hanya berisi tenant tempat user punya membership | Tidak pernah membocorkan tenant lain | Critical | 01 |
| TI-10 | Notifikasi MII vs Cahaya — himpunan ID disjoint | 0 kebocoran notifikasi lintas tenant | High | 01 |
| TI-11 | File XLSX export employees MII tidak memuat data Cahaya | Binary xlsx valid; nama tenant Cahaya tidak muncul | High | 01 |

### Pilar 2 — Authentication, Authorization & AppSec

| ID | Skenario | Perilaku Diharapkan | Severity | Suite |
|---|---|---|---|---|
| AA-01 | Tanpa cookie → semua `/api/rekankerja/*` | 401 konsisten | Critical | 02 |
| AA-02 | Token palsu (format benar, HMAC salah) | 401 (timingSafeEqual) | Critical | 02 |
| AA-03 | Payload di-tamper (body diganti, MAC asli) | 401 | Critical | 02 |
| AA-04 | Token expired (exp lampau, MAC valid — white-box via SESSION_SECRET) | 401 | Critical | 02 |
| AA-05 | `sessionVersion` mismatch (token sv=99 vs DB) → revokasi server-side | 401 | Critical | 02 |
| AA-06 | Logout → replay cookie lama | 401 (sv sudah dinaikkan) | Critical | 02 |
| AA-07 | Token MFA dipakai sebagai cookie sesi (typ "mfa", tanpa sv) | 401 (domain separation token) | High | 02 |
| AA-08 | Role VIEWER: GET boleh, POST mutasi ditolak | 200 pada baca; 403 pada mutasi (requireMutator) | Critical | 02 |
| AA-09 | Brute force login 31x gagal (IP spoofed XFF) | 429 + Retry-After; IP asli tidak terdampak | High | 02 |
| AA-10 | Header `x-forwarded-for` di-spoof client | TERKONFIRMASI bisa — temuan F-01 (lihat §6) | Medium | 02 |
| AA-11 | Path manipulation: `//`, trailing `/`, `%2F`, `/../`, casing huruf | Tidak ada jalur yang lolos tanpa auth | Critical | 02 |
| AA-12 | Injeksi SQL di `q=` (`' OR 1=1--`) & JSON rusak | Tanpa 500; tanpa data lintas tenant (Prisma parameterized) | Critical | 02 |
| AA-13 | Mass assignment: POST companies + field asing (`role`, `tenantId` Cahaya) | Ditolak/diabaikan — tidak mengubah konteks tenant | High | 02 |
| AA-14 | Flag cookie sesi: HttpOnly + SameSite=Lax + Path=/ | Set-Cookie memuat ketiganya (dev tanpa Secure — temuan F-02 utk prod checklist) | High | 02 |
| AA-15 | Login email tidak dikenal 1x (IP berbeda via XFF) | 401 generik tanpa membocorkan keberadaan akun | Medium | 02 |

### Pilar 3 — Performance, Caching & Scalability

| ID | Skenario | Perilaku Diharapkan | Severity | Suite |
|---|---|---|---|---|
| PF-01 | Respons sama-URL dua tenant bergantian 5x (cache poisoning) | Data selalu sesuai tenant pemanggil — tidak ada respons tercampur | Critical | 03 |
| PF-02 | Cache host→tenant (TTL 60 dtk): 2 subdomain bergantian cepat | Slug mii↔cahaya tidak saling bocor | High | 03 |
| PF-03 | Revoke kunci API → cache resolve 5 mnt tidak menutupi revoke | 401 seketika | High | 03 |
| PF-04 | Load multi-tenant 10/30/60 VU 40 dtk (5 endpoint campuran) | Error rate <1%; 0 error koneksi DB; p95 dashboard < 1500 ms | High | 05 |
| PF-05 | pg_stat_activity saat puncak — koneksi stabil, tidak mendekati max=100 | Tidak ada pool_timeout/drop | High | 05 |
| PF-06 | Statik audit: 0 penggunaan ISR/SSG/unstable_cache untuk data tenant | Terkonfirmasi via grep (lihat §6) | Medium | audit |

### Pilar 4 — Feature Gating, Usage Limits & Webhook

| ID | Skenario | Perilaku Diharapkan | Severity | Suite |
|---|---|---|---|---|
| GL-01 | Alur kunci API: generate (scope employees) → pakai public API | 201; GET 200 data MII | High | 04 |
| GL-02 | Public API tanpa / dengan kunci salah | 401 | High | 04 |
| GL-03 | Kunci di-revoke → request berikutnya | 401 seketika (dicek langsung DB) | Critical | 04 |
| GL-04 | Rate limit kunci: 61 request cepat berturut | 429 pada batas ke-61 (60/menit) | High | 04 |
| GL-05 | Scope enforcement: kunci scope `employees` → endpoint leave | 403 (scope tidak mencakup) | High | 04 |
| GL-06 | Kunci tenant A tidak bisa dipakai membaca tenant B | Kunci hanya resolve ke schema pemiliknya | Critical | 04 |
| GL-07 | Anti-double-submit: leave request duplikat (karyawan+periode sama) 2x | Kedua diproses tepat 1x (guard duplikat) — padanan idempotensi webhook pembayaran | High | 04 |
| GL-08 | Webhook delivery internal: HMAC signature + retry/backoff (5x→dead) | Teraudit dari kode + terdokumentasi; e2e p23/p34 meliput dispatch | Medium | audit |
| GL-09 | `Tenant.plan` — penerapan limit fitur per plan | **GAP F-03**: field informatif, belum ada enforcement — temuan roadmap | Medium | audit |

### Pilar 5 — UX White-Labeling & Dynamic Subdomain Routing

| ID | Skenario | Perilaku Diharapkan | Severity | Suite |
|---|---|---|---|---|
| WL-01 | Dua browser context terpisah (session agent-browser terisolasi) login MII vs Cahaya | Workspace name masing-masing; tidak ada cookie/localStorage tumpang tindih | Critical | 03b |
| WL-02 | Cookie sesi httpOnly → `document.cookie` dari page | `rekankerja_session` TIDAK terlihat JS (anti XSS token theft) | Critical | 03b |
| WL-03 | companyCode tenant terbawa prefix nomor karyawan (MII vs CAHAYA) | Prefix sesuai tenant masing-masing | High | 03b |
| WL-04 | Main host netral (`rekankerja.id`) + subdomain tenant → perilaku pilih-workspace vs forced | Sesuai desain Task 78 | Medium | 01 |
| WL-05 | Dwibahasa EN/ID konsisten di kedua workspace | UI render penuh kedua bahasa | Medium | 03b |

---

## 2. Ringkasan Eksekusi (HASIL FINAL — 2026-10-22)

| Suite | File | Status | Detail |
|---|---|---|---|
| Isolation | `scripts/qa/01-isolation.test.ts` | ✅ **16/16 PASS** | zero leakage terbukti di seluruh permukaan |
| AppSec | `scripts/qa/02-appsec.test.ts` | ✅ **40/40 PASS** | token forgery/revocation, RBAC VIEWER, brute-force, path vectors, SQLi, mass-assignment, cookie flags |
| Cache/Perf fungsional | `scripts/qa/03-cache.test.ts` | ✅ **2/2 PASS** | setelah fix F-06 (lihat temuan) |
| Gating & Limits | `scripts/qa/04-limits.test.ts` | ✅ **8/8 PASS** | API key lifecycle lengkap + rate limit + scope + revoke seketika + anti-double-submit |
| Dual browser context | agent-browser session `qa-a`/`qa-b` | ✅ **VERIFIED** | screenshot `audit/qa-dual-tenant-{a,b}-*.png`; cookie sesi tak terlihat JS (httpOnly) di keduanya; localStorage hanya `rekankerja:lang` |
| Load test | `scripts/qa/05-load.ts` (eksekusi) + `qa/k6-tenant-load.js` (konfigurasi staging) | ✅ **PASS (PF-04/05)** | 3.184 req · 0 error (0,00%) · p95: dashboard 844ms / employees 847ms / me 519ms · pg_stat_activity puncak 20/100 koneksi · throughput 38,3 req/s @40 VU think-timed |

**Total: 66 test otomatis + 2 verifikasi browser + load test — semuanya hijau, stabil di 2 run berturut-turut.**

Reproduksi: `bun test scripts/qa/` (4 suite) · `bun scripts/qa/05-load.ts` (load) · lihat `qa/load-results.json`.

## 3. Temuan Keamanan (Findings)

| ID | Severity | Temuan | Status |
|---|---|---|---|
| **F-01** | Medium | `clientIp()` memercayai nilai pertama `x-forwarded-for` tanpa daftar proxy tepercaya — penyerang direct-to-app dapat merotasi header untuk melewati rate-limit login per-IP (terverifikasi di AA-09: 429 dipicu oleh XFF palsu). Di belakang gateway tepercaya (Caddy) header di-set proxy, namun jalur direct harus dijaga (firewall/bind) ATAU validasi proxy-chain ditambahkan. | **OPEN — mitigasi opsional** |
| **F-02** | Low (checklist prod) | Cookie sesi tanpa `Secure` di dev (by design — `NODE_ENV=development`); kode sudah meng-set `Secure` di production. Verifikasi pra-rilis: pastikan deploy produksi benar `NODE_ENV=production`. | **Verifikasi deployment** |
| **F-03** | Medium (roadmap) | Tidak ada billing provider; `Tenant.plan` informatif tanpa enforcement fitur/kuota per plan. Item P4 register (DEVELOPMENT-PLAN §4). | **OPEN — roadmap** |
| **F-05** | Low | `PATCH /api/rekankerja/companies` dengan id tak dikenal mengembalikan **500** (P2025 tak tertangani) — seharusnya 404. | **✅ FIXED** — 404 dwibahasa; teruji AA-13 |
| **F-06** | **HIGH** | **Bug isolasi host nyata**: `requireScoped` + 10 guard lain (`resolveMenuPerms`, `requireEss`, `requireAppUser`, `resolveMe` notifications/user-menu-access, `resolveAiActor`, `moneyViewForReq`, `requireVaultSession`, reporter whistleblow, `regenDeviceKey`, `tenantSlugOfSession`, prefix employeeNo) membaca `payload.tid` cookie **tanpa `effectiveTenantIdOf()`** → data tenant-cookie tetap disajikan di subdomain tenant lain (melanggar kontrak Task 78; ditemukan via PF-02: 45 karyawan MII tampil di host Cahaya). | **✅ FIXED sistemik** — helper `effectiveTidOfSession()` di auth.ts + patch 11 file; tsc 0 error; PF-02 kini hijau; seluruh suite tetap hijau |
| **F-07** | Medium (infra) | Dev server (Turbopack, heap 1.4GB) runtuh saat dihujani ~2.600 req/s tanpa pacing (OOM → watchdog restart); load valid memerlukan think-time realistis dan target build produksi. K6 script disediakan utk staging. Watchdog terbukti pulih otomatis. | **DOKUMENTASI** — pacing ditambahkan ke harness |

---

## 6. Edge-Case Audit Vectors (Next.js Multi-Tenancy — Step 4)

1. **Next.js Cache Poisoning** — aplikasi 100% `force-dynamic` untuk data tenant (0 `unstable_cache`, 0 `revalidate`, 0 fetch-cache tenant-scoped). Verifikasi perilaku: TI/PF-01 (dua tenant bergantian sama-URL). Cache in-memory kunci-tenant aman: `slug`→tenant, `schema`→client, `hash`→apikey (+ revoke selalu diperiksa per-request). **Risiko residual**: bila kelak menambah ISR/SSG, WAJIB tag cache `tenant:<id>` — dicatat sebagai guardrail.
2. **Middleware Bypass** — tidak ada middleware edge; resolusi tenant di route handler. Vektor path diuji AA-11: `//` prefix, trailing slash, `%2F`/`%2E%2E` encodings, dot-segments, casing, `/api/auth/../rekankerja/...`. Next 16 App Router mematch route secara strict; ekspektasi: 404/308/401 — tidak pernah serve data tanpa auth.
3. **Webhook Idempotency** — padanan nyata di aplikasi: (a) scheduler `report-schedule:<id>:<dateKey>` idempoten harian (e2e p34: run-2 tanpa duplikasi — sudah hijau), (b) anti-double-submit leave (GL-07), (c) webhook outbound retry/backoff + HMAC (webhook-service). Tidak ada payment webhook (tanpa billing provider — temuan F-03).
4. **Subdomain forcing** (TI-06..08) — permukaan spesifik produk ini: cookie `tid` tenant lain DIABAIKAN di subdomain tenant; subdomain tak dikenal = tidak ada fallback.
5. **XFF trust** (AA-10/F-01) — `clientIp()` memakai `x-forwarded-for` pertama tanpa daftar proxy tepercaya → rate limit IP bisa dilewati dengan rotasi header. Di belakang gateway tepercaya (Caddy) header ini di-set oleh proxy, namun mitigasi direct-to-app harus didokumentasikan.

## 7. Load Test Spec (Step 5)

- **Executor**: `scripts/qa/05-load.ts` (Bun, native fetch, 3 sesi tenant nyata) — hasil = bukti eksekusi di sandbox ini.
- **Konfigurasi produksi**: `qa/k6-tenant-load.js` (K6/Grafana — threshold p(95)<800ms, http_req_failed<1%, staging 10→30→60 VU, dua cookie context tenant A/B + public API key) — untuk CI/CD/staging berkala.
- **Pengukuran DB**: sampling `pg_stat_activity` tiap tahap — bukti pool koneksi stabil jauh di bawah `max_connections=100`.

## 8. Hasil & Kesimpulan

**Status: SIAP PRODUKSI (dengan 2 temuan terbuka yang bersifat opsional/roadmap).**

1. **Pilar 1 (Isolasi)** — terbukti kokoh: schema-per-tenant + resolusi sesi→membership memastikan zero leakage pada seluruh vektor yang diuji (IDOR, pencarian lintas schema, select-tenant asing, host forcing, notifikasi, export, multi-workspace switching). Bug F-06 (satu-satunya celah nyata, di jalur subdomain) **ditemukan, diperbaiki sistemik, dan terverifikasi ulang**.
2. **Pilar 2 (Auth/AppSec)** — 40 asersi hijau: token tak bisa dipalsukan/di-tamper/expired-divileged; revokasi server-side bekerja (logout membunuh semua sesi); MFA token terpisah domain; VIEWER fail-closed; brute force ter-rate-limit (dengan catatan F-01); path manipulation tidak membuka celah; SQLi terserap Prisma; mass-assignment tak mengubah konteks.
3. **Pilar 3 (Performa)** — 0% error pada 3.184 request multi-tenant; p95 terberat 847ms (mode DEV dgn Turbopack — build produksi akan lebih cepat); pool koneksi DB stabil di 20/100 (matematika M-19 terkonfirmasi). K6 config siap untuk staging berkala.
4. **Pilar 4 (Gating/Limits)** — API key lifecycle penuh (generate→pakai→scope-ditolak→rate-limit 429→revoke seketika); idempotensi bisnis (anti-double-submit + scheduler key) teruji. Gap billing (F-03) = keputusan produk, tercatat di register P4.
5. **Pilar 5 (White-label/Routing)** — subdomain forcing (Task 78) kini konsisten di SELURUH API setelah F-06; dua browser context terisolasi penuh (cookie httpOnly tak terlihat JS, localStorage bersih, data workspace masing-masing).

**Rekomendasi pra-rilis (urutan):** (1) verifikasi `NODE_ENV=production` di deploy + HTTPS → F-02; (2) jaga akses direct-to-app di belakang gateway tepercaya (F-01); (3) jadwalkan K6 di staging dgn build produksi (F-07); (4) keputusan produk utk billing enforcement (F-03).

---
