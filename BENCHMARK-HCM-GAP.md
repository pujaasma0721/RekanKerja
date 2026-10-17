# AUDIT BENCHMARK — RekanKerja vs Tier-1 HCM Global & Pasar Indonesia

> **Status: DOKUMEN AUDIT (read-only) — TIDAK ADA PERUBAHAN KODE** (sesuai mandat user:
> "audit semua module, bandingkan dengan #1 tier hcm di luar/pasar, berikan analisa dan
> gap, jangan ada perubahan dulu" — IM trace `1a14931ccd0b16ad`).
>
> **Metode:** 6 agent audit paralel read-only (BENCH-1 s/d BENCH-6, semua tercatat di
> worklog.md) + hasil audit internal modul Performance terbaru (PERF-AUD-0 + PERF-FIX-1).
> Semua temuan berbasis bukti `file:line`; tidak ada file source yang diubah.
>
> **Benchmark set:** Workday · SAP SuccessFactors · Oracle HCM Cloud · UKG (leader WFM) ·
> Darwinbox · Mekari Talenta (leader lokal) — plus titik pembanding khusus: Concur
> (travel/expense), Greenhouse/Lever (ATS), Cornerstone (LMS).

---

## Daftar Isi

- §1 Ringkasan eksekutif (verdict)
- §2 Skala produk yang diaudit
- §3 Matriks kematangan domain (24 domain, skala 0–5)
- §4 Analisa per modul (skala + kekuatan + gap)
- §5 Gap lintas-modul strategis (13, terurut dampak)
- §6 Moat regulasi Indonesia (yang MELEBIHI default tier-1)
- §7 Roadmap yang disarankan P1–P4 (→ rincian eksekusi di `DEVELOPMENT-PLAN-BENCHMARK.md`)
- §8 Basis bukti & pelacakan
- §9 Batasan audit

---

## §1 Ringkasan Eksekutif (Verdict)

**RekanKerja = "upper mid-market regional player" — skor kematangan rata-rata domain
~3,3/5 vs tier-1 global — dengan dua profil yang sangat tidak simetris:**

1. **Kedalaman regulasi Indonesia mencapai kelas 4,5–5.** Beberapa mesin (PPh 21 TER,
   lembur PP 35/2021, pesangon UPMK, kepatuhan UU PDP, whistleblowing TPKS) lebih dalam
   daripada implementasi *default* tier-1 global di Indonesia, dan melebihi Mekari
   Talenta pada titik-titik tersebut.
2. **Jarak ke tier-1 global bukan pada kedalaman, tapi pada LEBAR platform.**
   Learning/LMS tidak ada, job architecture & skills foundation dangkal, ekosistem
   integrasi tipis, tanpa WFM intelligence, tanpa lapisan global (multi-currency/expat).

> **Analogi:** fondasi & mesinnya kelas menara, tetapi lantainya belum selengkap menara.

**Implikasi strategis:** produk unggul head-to-head di pasar nasional pada domain
regulasi & integritas data; untuk naik kelas enterprise/global, prioritas = menutup
gap LEBAR (LMS, job architecture, integrasi, BPM), bukan memperdalam yang sudah dalam.

---

## §2 Skala Produk yang Diaudit

| Dimensi | Angka | Sumber |
|---|---|---|
| Total LOC `src/rekankerja` | ~250.000 | BENCH-1 (`wc -l` agregat) |
| Modul domain | 11 (HR, Payroll, Attendance, Leave, Travel, Medical, Whistleblow, Recruitment, Performance, ESS, Public) + shared | struktur direktori |
| API route admin | 231 `/api/rekankerja/**` | BENCH-5 |
| API route ESS | 35 | BENCH-5 |
| API route public | 7 (+ 7 route portal kandidat terpisah) | BENCH-5, BENCH-6 |
| Model Prisma tenant | 206 tabel | BENCH-5 |
| Menu item | ~119 admin + 25 ESS | BENCH-5 (`app-shell.tsx`) |
| Shared services | 23 (approval engine, scheduler, letter, esign, webhooks, dsb.) | BENCH-5 |
| Scheduler jobs | ~30 job idempoten lintas-tenant (advisory lock + dedupe ActivityLog) | BENCH-5 |
| Template notifikasi | 43 email + 20 WhatsApp | BENCH-5 |
| Dokumen laporan standar bilingual | 101 (HR 16 · Payroll 12 · Attendance 12 · Leave 11 · Travel 12 · Medical 12 · Recruitment 12 · Performance 14) | katalog `report-documents` tiap modul |
| Tenant | Schema-per-tenant PostgreSQL (MII, Nusatek, TAK) + provisioning fail-clean + parity self-heal | BENCH-5 |
| Career portal | App terpisah (mini-service port 3010, SSR bilingual, captcha + consent + magic-link + e-sign) | BENCH-6 |

---

## §3 Matriks Kematangan Domain (0–5; 5 = paritas penuh tier-1)

| # | Domain | Skor | Catatan kunci |
|---|---|---|---|
| 1 | Payroll & Pajak Indonesia | **4,5** | TER resmi DJP, true-up Desember, e-SPT 1721-A1 39 kolom terverifikasi, Coretax CSV |
| 2 | Time & Attendance | **4** | PP 35/2021 terlengkap di kelasnya; geofence+selfie+VLM wajah+QR kiosk+push mesin |
| 3 | Cuti / Absence | **4** | 17 jenis cuti statutori + rules engine 15-dimensi + encashment + SKB |
| 4 | Performance Management | **4** | Siklus 7 fase, OKR, 360, kalibrasi bell-curve, merit→payroll, PIP, probasi, 9-box |
| 5 | ESS (karyawan) | **4** | ~80% cakupan transaksi; 35 endpoint; profil read-only |
| 6 | Security platform | **4,5** | AES-256-GCM field-level, money vault, TOTP, e-sign hash-chain, 485 titik ActivityLog |
| 7 | Arsitektur multi-tenant | **4** | Schema-per-tenant + provisioning fail-clean + subdomain resolution |
| 8 | Lokalisasi dwibahasa | **5 (kedalaman)** | EN/ID + gerbang AST di CI; hanya 2 bahasa (bukan 40+ tier-1) |
| 9 | Core HR & lifecycle | **3,5** | Effective-dated assignment kelas atas; job architecture dangkal |
| 10 | Recruitment/ATS | **3,5** | Loop E2E lengkap + UU PDP terdalam di kelas; tanpa job board |
| 11 | Travel/Expense | **3,5** | OCR + anomaly + SBI PMK 32/2025; tanpa booking/korporat card |
| 12 | AI | **3,5** | CV parse, OCR, VLM wajah, aiCompose, copilot, RAG — jujur & berlabel |
| 13 | Analytics & Reporting | **3** | 101 laporan standar kuat; builder 6 entitas, tanpa pivot/terjadwal |
| 14 | Benefit/Medical | **3** | Mesin reimbursement kuat; bukan benefit administration |
| 15 | MSS (Manager Self-Service) | **2,5** | Tersebar di menu admin; tanpa workspace manajer |
| 16 | Succession & Career | **2,5** | 9-box + kandidat + readiness; tanpa career pathing/scenario modeling |
| 17 | Compensation workspace | **2,5** | Merit matrix ada; tanpa total rewards planning |
| 18 | Whistleblowing/GRC | **2,5** | MVP TPKS solid; tanpa SLA/lampiran/kanal eksternal |
| 19 | Mobile & Notifikasi | **2,5** | PWA tanpa push; app Flutter display-only |
| 20 | Integrasi & Extensibility | **2** | 11 webhook, 3 scope API; tanpa SSO/SCIM/marketplace |
| 21 | Job architecture & skills | **1,5** | Tanpa job family/profile/skills cloud — fondasi talent tier-1 |
| 22 | WFM (forecast/optimasi) | **1,5** | Hanya assignment rotasi; tanpa demand forecasting |
| 23 | Learning/LMS | **0** | **Modul tidak ada** (PRD referensi menyebutnya, belum dibangun) |
| 24 | Global employment (expat/multi-currency) | **0** | Desain single-country IDR |

**Cara membaca skor:** relatif terhadap tier-1 GLOBAL. Terhadap pasar lokal Indonesia,
mayoritas domain berada di atau di atas standar leader lokal (lihat §6).

---

## §4 Analisa per Modul

### 4.1 Core HR — 32.976 LOC · 30 route / 82 handler · 52 model

**Kekuatan di atas kelas menengah:**
1. **Effective-dated assignment engine** — insersi mid-chain + patch maju + guard
   integritas rantai + koreksi baris + proration payroll otomatis (kebanyakan kompetitor
   mid-market hanya snapshot data jabatan terkini).
2. **Enkripsi field + money vault + PII 3-tier** — AES-256-GCM per-tenant pada
   NIK/NPWP/bank/BPJS/gaji; dekripsi hanya di batas serializer; nominal null-out saat
   vault tertutup; mask bahkan di activity log.
3. **Otomasi lifecycle ujung-ke-ujung** — wizard 4 langkah → checklist onboarding
   9-departemen + email link HMAC → PA maker-checker + delegasi → proses → settlement
   UPMK otomatis → offboarding 12-tugas + klaim JKP PP 6/2025.
4. Org chart 2-mode (people/unit) dengan export PNG + keyboard nav; 16 laporan A4;
   laporan kustom 6-entitas.

**Gap ke tier-1:**
- Master org/posisi/job/grade **tidak effective-dated** (Workday/SF: objek fondasi
  berversi, reorg historis, future-dated reorg) — hanya flag `active`.
- **Job architecture dangkal**: Job = code/title/category; tanpa job profile
  (tugas/syarat/kondisi kerja), job family, katalog skills pada jabatan, kualifikasi posisi.
- Tanpa cost center & brand/outlet (Talenta punya untuk retail), tanpa org matrix.
- Routing approval PA = template role fix `AT-PA-STD` untuk 12 jenis PA (ironis:
  platform punya engine `ApprovalStructure` 6-dimensi yang dipakai modul lain).
- Tanpa multiple assignment konkuren; tanpa kontak darurat (terdokumentasi absen);
  ESS profil read-only; tanpa KITAS/expat; DSR belum menutup rekaman karyawan penuh;
  webhook tanpa event Core-HR (employee.created, pa.processed).

### 4.2 Payroll — ~25.200 LOC · 27 route · ~30 model

**Kekuatan kelas atas:**
1. **Engine PPh 21** — tabel TER resmi DJP (125 baris, PMK 168/2023) + Pasal 17
   fallback + bypass bulan ireguler (PP 58/2023) + supplemental YTD + true-up masa pajak
   terakhir + gross-up iteratif ≤30x; sitasi regulasi inline di kode.
2. **Rantai output statutori** — e-SPT 1721-A1 39 kolom (diverifikasi vs manual DJP
   e-Bupot 21/26 v1.4) + JRXML resmi + Coretax CSV bulanan + BPJS TK/JKN CSV + bank file.
3. Segment proration mid-period (assignment × template history) dengan pencegahan
   kebocoran versi masa depan; jurnal balance-enforced + reversal saat recalc parsial;
   payslip PDF password NIK + e-sign QR; partial recalc pasca-konfirmasi.
4. Benchmark gaji p25/p50/p75 (grade XOR position) + dashboard kompa-ratio.

**Gap ke tier-1 / Talenta:**
- **Tanpa approval chain payroll** (confirm = 1 permission; Talenta punya "payroll
  approvers"; tier-1 chain konfigurabel).
- **Rapel terbatas** — 1 karyawan × 1 komponen × nominal flat, positif-diff, 1 tahun
  pajak, tanpa batch; cancel pasca-confirm terblokir tanpa auto-reversal jurnal.
- **Bank file dangkal** — 3 bank layout generik (referensi: 12 bank), tanpa format
  korporat/office×process-type scoping.
- **BPJS** — tanpa integrasi langsung (CSV approx; KODE KANTOR/KELAS kosong; family
  tanpa NIK); tanpa saldo JHT/JP; JKK 1 rate global (tanpa 5 kelas risiko industri).
- Tanpa simulasi THP standalone; tanpa NTPN/e-billing, 1721-A2, PPh 23; PTKP hardcoded
  (bukan master bertanggal); THR tanpa scheduling agama (Lebaran/Natal) & gate
  min-1-bulan (flag `applyThrRules` mati); engine formula aritmetika saja; tanpa GL
  connector eksternal (CSV handoff); tanpa expat/multi-currency.

### 4.3 Time & Attendance (19.603 LOC) + Leave (9.016 LOC)

**Kekuatan kelas atas:**
1. **Engine lembur PP 35/2021 terlengkap di kelasnya** — tabel tarif lengkap 5-hari vs
   6-hari kerja, 2×/3×/4× hari libur, cap 4 jam/hari + 18 jam/minggu + exclusion hari
   istirahat Ps.26(2), mode Kepmen 102/custom, consent Ps.28, advisory Ps.29 (istirahat
   30 menit + makan 1.400 kkal), basis BASE/BASE_FIXED Ps.32, 1/173.
2. **Stack clocking modern** — geofence Off/Warn/Strict multi-site nearest-match,
   selfie, verifikasi wajah VLM server-side, QR kiosk HMAC 30 detik, push realtime
   mesin ZKTeco-style (key per-tenant, timing-safe), anomali (buddy-punch, perjalanan
   mustahil >250 km/jam, late pattern, burnout 3-bulan).
3. **Fatigue & wellbeing** — min rest antar-shift + max malam beruntun dijamin saat
   assign jadwal (benchmark UKG/Deputy).
4. 17 jenis cuti statutori dengan sitasi UU; rules engine 15-dimensi; encashment penuh
   (submit→approve→transfer UCT→Paid); SKB massal; blackout + notice period; open-shift
   marketplace + webhooks; 23 laporan + ICS.

**Gap ke UKG/Workday:**
- **Tanpa WFM intelligence** — tidak ada demand forecasting, optimasi jadwal, schedule
  bidding, coverage-gap analysis; tanpa real-time adherence/intraday management.
- Kalender libur **tidak dibundel** (CRUD + CSV manual; seed kosong; tanpa dataset
  nasional / auto-sync SKB).
- **Tanpa regularisasi absensi self-service karyawan** ("lupa absen" admin-side).
- Cuti tanpa upload lampiran (SKD surat dokter) — `needDocs` hanya flag tampilan;
  tanpa cuti per jam (minimum setengah hari); approval all-or-nothing (referensi MII:
  partial per-day); tanpa premi malam otomatis ke payroll; tanpa timesheet self-submit;
  toleransi 2-arah saja (MII: 4-arah + matriks rounding).

### 4.4 Medical (11.184) · Travel (11.368) · Whistleblowing (965 LOC)

**Medical (kuat sebagai reimbursement engine):** pool routing SHARED/SEPARATE dependen,
reservasi saldo in-flight, storno + jurnal reversal, piutang asuransi double-entry
dengan aging, rules engine policy 15-dimensi, 12 laporan. **Gap:** bukan benefits
administration — tanpa enrollment grup/premium/policy number/renewal, tanpa cashless;
ESS tanpa upload struk (paritas internal: travel punya); reset tahunan manual.

**Travel (mengalahkan Darwinbox-class di beberapa titik):** OCR struk VLM + deteksi
duplikat 90-hari + 6 anomaly flag ala Concur, SBI PMK 32/2025 per kota + aturan 60%
single-city, budget committed-vs-used + burn-rate, jurnal per expense line. **Gap:**
tanpa booking/GDS/korporat card, FX manual (tanpa master kurs), 1 klaim per request,
tanpa reminder settlement terjadwal, tanpa UI admin untuk master tarif kota.

**Whistleblowing (MVP TPKS yang jujur):** anonimitas nyata terverifikasi kode
(identitas dibuang server-side), 6 aksi triage, state machine dengan closure beralasan
≥10 karakter. **Gap vs GRC enterprise:** tanpa kanal pra-login/eksternal, tanpa upload
bukti, tanpa SLA/escalation, body laporan tidak terenkripsi (kontras data medis),
tanpa notifikasi status ke pelapor, kategori hardcoded 7, tanpa keterkaitan kasus →
DisciplinaryRecord/PA.

### 4.5 Recruitment — ~41.000 LOC (termasuk portal karir 2.587)

**Kekuatan:**
1. **Loop E2E satu-database penuh** — MPP→PR (approval bertingkat tier gaji)→posting
   portal→apply (captcha+honeypot+consent)→staging (PII encrypted + blind-index dedupe
   + merge)→talent pool→scorecard anchored 1-5 + panel divergence flag + gate tanpa
   feedback→offer (approval + e-sign OTP + expiry scheduler)→appointment→transaksi
   atomik karyawan+assignment+onboarding+probasi otomatis; ActivityLog di semua mutasi.
2. **Kepatuhan UU PDP terdalam di kelasnya** — consent ledger berversi, DSR SLA 7 hari
   + paket data, retensi/anonymize + dedupHash re-apply detection, audit akses PII,
   adverse impact 4/5ths rule per stage × gender × age.
3. **AI jujur berlabel** — parse CV + confidence + human-verify, scoring rubric
   explainable per evidence, NL talent search, recruiter copilot (JD/summarize/
   interview Q/bias-check), semua berlabel `ai|simulated|manual`.
4. Funnel analytics + time-to-fill/hire + source ROI + SLA ladder + snapshot harian;
   12 laporan; per-req custom stage chain (snapshot-safe).

**Gap ke tier-1 ATS:**
1. **Job board multiposting ABSEN** (Glints/Kalibrr/LinkedIn/JobStreet — nol integrasi
   API; channel = baris biaya manual) — pembeda utama Mekari Talenta di pasar ID.
2. Tanpa panel interview multi-evaluator + self-schedule link + undangan .ics
   (meetingUrl manual; 1 evaluator per tahap).
3. Tanpa interview kit terstruktur per stage (bank pertanyaan ↔ kompetensi).
4. Tanpa auto-ranking AI antrian pelamar / matching req↔kandidat.
5. Talent CRM: tanpa campaign/nurture/bulk outreach; referral manual penuh (tanpa form
   karyawan, tanpa reward ter-otomasi — catatan manual, keputusan bisnis SB-RC).
6. Offer tanpa versioning (counter = catatan bebas); tanpa self-service accept/decline
   kandidat di portal.

### 4.6 Performance — 21 tabel · 16 services · 17 route · 14 laporan (pf11–pf44)

*(Basis: audit internal terbaru PERF-AUD-0 + perbaikan PERF-FIX-1.)*

**Kekuatan (pasca perbaikan besar):** siklus 7-fase (Draft→…→Closed) dengan state
machine tertib + approval chain race-safe; formula appraisal §16 benar termasuk
LowerIsBetter; OKR kuartalan dengan board transparan + skor server otoritatif; 360
dengan anonimitas ≥3 enforced server-side + aksi expire undangan + moderasi bias
lexicon; kalibrasi bell-curve + z-flag + approval chain kondisional L3; merit matrix →
apply ke payroll dengan klaim atomik anti double-pay + jalur batal Approved; PIP +
checkpoint; evaluasi probasi D9 auto; succession 9-box + readiness + prune otomatis +
heuristik attrisi explainable; DSR UU PDP; overview dashboard informatif 1-endpoint.

**Gap ke tier-1 talent suite:** tanpa **career pathing / development plan / growth
portfolio** (beriringan absennya LMS); check-in level objective (bukan per-KR
continuous); succession tanpa scenario modeling ("what-if X pergi") dan tanpa talent
pool global lintas posisi; tanpa comp cycle workspace penuh (budget pool/guideline
modeling); 360 tanpa role-mix konfigurabel kelas SF (self/peer/upward/custom).

### 4.7 ESS + Platform (shared/public)

**Kekuatan platform kelas atas:**
1. **Approval engine** — 13 jenis dokumen × routing 6-dimensi × tier nominal ×
   delegasi wildcard × race-safe; namun tanpa parallel approval & tanpa auto-escalation
   engine-level (hingga reminder SLA 3 hari).
2. **Scheduler ~30 job idempoten** lintas-tenant dengan advisory lock + dedupe —
   disiplin konkurensi kelas produksi.
3. **Security layering** — session revocation server-side, policy password 18-atribut,
   TOTP murni Node, **money vault** (password perusahaan → PBKDF2 210k → dataKey; grant
   8-jam; re-key transaksional), e-sign RSA-PSS + hash-chain + verifikasi publik,
   enkripsi field-level, rate-limit (single-node).
4. Notifikasi 3-kanal (in-app/email/WA) + template; bilingual EN/ID dengan gerbang
   AST CI; PWA installable + service worker.

**Gap:** tanpa push notification & native app; tanpa SSO/SAML/SCIM; report builder 6
entitas tanpa pivot/join/scheduled delivery/chart; AI asisten read-only RAG (tidak bisa
mengeksekusi transaksi); ESS profil read-only; tanpa direktori rekan di ESS; tanpa
pengajuan loan mandiri; single-node in-memory (±30 tenant/node terdokumentasi).

---

## §5 Gap Lintas-Modul Strategis (terurut dampak)

| # | Gap | Dampak | Skor |
|---|---|---|---|
| 1 | **Learning/LMS tidak ada** — direferensikan PRD, belum dibangun | Talent suite terputus: succession & competency tak bisa dieksekusi jadi development; syarat mutlak tier-1 (Workday Learning, SF LMS, Cornerstone) | 0/5 |
| 2 | **Job architecture & skills foundation** — tanpa job family/profile/skills cloud/kualifikasi posisi | Memblokir career pathing, skills-based comp, kualitas succession, workforce planning — fondasi seluruh talent tier-1 | 1,5/5 |
| 3 | **Ekosistem integrasi** — tanpa SSO/SCIM; tanpa multiposting job board; tanpa API BPJS/LKS resmi; tanpa e-filing DJP; tanpa connector akuntansi; 11 webhook; tanpa marketplace | Enterprise deal-breaker; Talenta menang di Glints/Kalibrr/Jurnal/Accurate | 2/5 |
| 4 | **WFM intelligence** — tanpa forecasting/optimasi/real-time adherence | Membatasi segmen manufaktur/retail/F&B — pasar alami produk Indonesia | 1,5/5 |
| 5 | **Benefits administration** — reimbursement ≠ policy administration (enrollment, premium, policy number, renewals) | Segmen korporat dengan asuransi grup | 2,5/5 |
| 6 | **Manager workspace (MSS)** — tanpa dashboard tim/headcount/analytics manajer; approval tersebar | Tier-1 berpusat pada "day in the life of a manager" | 2,5/5 |
| 7 | **Analytics platform** — builder 6 entitas, tanpa pivot/join/scheduled delivery/dashboard designer | Prism/SF People Analytics jauh di depan; (kabar baik: 101 laporan standar bilingual justru di atas rata-rata) | 3/5 |
| 8 | **Mobile & push** — PWA tanpa web-push; app Flutter display-only | Mekari menang di mobile maturity | 2,5/5 |
| 9 | **BPM konfigurabel** — workflow hardcoded per jenis dokumen; tanpa parallel approval/timeout auto-escalation engine-level | Workday BPM = pembeda arsitektur paling fundamental | 2/5 |
| 10 | **Global employment layer** — single-country IDR, tanpa multi-currency/KITAS/expat | Menutup pasar regional (bila target nasional, dapat diterima) | 0/5 |
| 11 | **Compensation workspace** — merit matrix bagus, tanpa budget pool/modeling total rewards | Comp cycle enterprise | 2,5/5 |
| 12 | **Candidate experience** — tanpa akun kandidat/one-click apply/self-schedule/offer self-service | Konversi funnel rekrutmen | 3/5 |
| 13 | **Skala operasional** — import cap 500 baris; take-cap 500 diam-diam di beberapa query; single-node in-memory | Kesiapan enterprise volume | 3/5 |

---

## §6 Moat Regulasi Indonesia (yang MELEBIHI Default Tier-1)

Aset kompetitif yang harus dijaga (Workday/SF umumnya menyerahkan titik-titik ini ke
partner lokal):

1. **Engine PPh 21** — TER resmi DJP + Pasal 17 + true-up + gross-up + e-SPT 39 kolom
   terverifikasi + Coretax — lebih dalam dari implementasi standard SF/Oracle Indonesia.
2. **Lembur PP 35/2021** — satu-satunya di kelasnya yang membedakan tarif 5-hari vs
   6-hari kerja + cap statutori + consent Ps.28 di engine.
3. **Pesangon UPMK multi-tier + pajak final PP 36/2021 + uang cuti + THR prorata**
   sebagai mesin terhitung (bukan template surat).
4. **Blok PKWT 5-tahun** (PP 35/2021) dengan kode error `PKWT_OVER_5Y` + jalur
   force-override ter-audit.
5. **UU PDP end-to-end di rekrutmen** — consent ledger berversi, DSR SLA 7 hari,
   retensi/anonymize + dedupHash, audit akses PII, blind-index dedupe.
6. **Whistleblowing TPKS UU 12/2022** dengan anonimitas terverifikasi kode.
7. **SBI PMK 32/2025** per-diem travel per kota (60% single-city rule).
8. **Security primitives** — enkripsi field-level per-tenant + money vault + TOTP +
   e-sign hash-chain: di atas mayoritas SaaS HRIS mid-market manapun.
9. **Bilingual EN/ID dengan gerbang AST CI** termasuk header XLSX — disiplin langka.

---

## §7 Roadmap yang Disarankan (Analisa → Eksekusi)

> **Rincian eksekusi per fase (data model, register keputusan, gate mutu, ukuran,
> verifikasi) diturunkan di `DEVELOPMENT-PLAN-BENCHMARK.md`.** Ringkasan arah:

- **P1 — Quick wins paritas internal & table stakes** (efek besar, usaha kecil):
  edit profil ESS dengan approval · upload struk di klaim medis ESS (paritas travel) ·
  regularisasi absensi mandiri karyawan · lampiran surat dokter di cuti · bundling
  dataset kalender libur nasional + impor SKB · approval chain payroll · simulasi THP ·
  referral otomatis (form + reward tracking) · kontak darurat · validasi NPWP ·
  format bank korporat · export jurnal GL (Accurate/Jurnal/generic) · reminder
  settlement travel terjadwal · premi malam → komponen payroll · NIK di EmployeeFamily
  (fondasi BPJS family).
- **P2 — Kebutuhan pasar Indonesia** (menang head-to-head vs Talenta):
  format LKS BPJS resmi (JKN/TK kolom lengkap) · web push notification · panel
  interview + self-schedule + .ics · offer versioning & self-service kandidat ·
  benefits administration grup · escalation otomatis approval engine.
- **P3 — Paritas enterprise tier-1**:
  job architecture & skills foundation (job family/profile/skills catalog) · manager
  workspace · analytics pivot + scheduled delivery · career pathing (aksi pengembangan
  teks terstruktur — konsisten D-BL14) · *(Learning/LMS = DIKECUALIKAN permanen atas
  perintah user berdiri — lihat batasan di development plan)* · SSO/OIDC (trigger).
- **P4 — Ekspansi skala** (register DEFER + trigger objektif):
  multi-currency/expat · WFM forecasting · Redis/multi-node · BPM designer ·
  marketplace/API breadth · eSign tersertifikasi BSrE via partner · multiposting job
  board (trigger: akun berbayar) · API BPJS langsung (trigger: kredensial) ·
  SSO/SAML/SCIM penuh (trigger: IdP tenant).

---

## §8 Basis Bukti & Pelacakan

| Sumber | Cakupan |
|---|---|
| worklog `BENCH-1` | Core HR (45 komponen, 30 route, 52 model; checklist A–I + 12 gap) |
| worklog `BENCH-2` | Payroll (13 services; arsitektur engine end-to-end; checklist A–L + 14 gap) |
| worklog `BENCH-3` | T&A + Leave (23+10 endpoint; arsitektur engine; checklist A–I + 13 gap) |
| worklog `BENCH-4` | Medical + Travel + Whistleblow (checklist A–C; paritas internal) |
| worklog `BENCH-5` | ESS + platform + public (menu tree lengkap; approval engine; security; 12 gap platform) |
| worklog `BENCH-6` | Recruitment (alur E2E 11 langkah; checklist A–G + 15 gap) |
| worklog `PERF-AUD-0` + `PERF-FIX-1` | Performance (audit dalam + perbaikan 2 KRIT + 6 HIGH + 11 MED) |
| `AUDIT-MODULES.md` (Jan 2026) | ARCHAIC — era 6 modul; angka tidak dipakai |

Semua klaim dalam dokumen ini dapat dilacak ke entri worklog di atas (yang memuat
kutipan `file:line` per temuan).

## §9 Batasan Audit

1. Benchmark bersifat **analisa fitur/arsitektur dari kode + dokumentasi publik
   kompetitor** — bukan pengujian langsung produk kompetitor.
2. Fitur "OK/PARTIAL/ABSENT" dinilai dari implementasi kode yang ada; konfigurasi
   runtime per tenant tidak semuanya diverifikasi hidup.
3. Skor kematangan memuat penilaian (judgment) pada dimensi yang tidak terukur persis
   (mis. "kedalaman regulasi"); pembobotan dijelaskan di catatan kunci.
4. Data demo 3 tenant terbatas — beberapa fitur (360, succession) belum terpakai di
   data hidup saat audit.
