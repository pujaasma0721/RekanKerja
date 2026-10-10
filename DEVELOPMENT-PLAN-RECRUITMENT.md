# REKANKERJA REKRUTMEN — DOKUMEN FINAL PENGEMBANGAN

**(Final Development Plan · Modul `recruitment` · Versi 1.0)**

> **Status**: dokumen eksekusi tunggal (single source of truth) implementasi Modul Rekrutmen
> RekanKerja. Menggantikan §8 *roadmap* pada `ANALISA-RECRUITMENT.md` (dokumen analisa tetap
> berlaku sebagai bukti & rujukan teknis).
> **Tanggal**: 2026-10-10 · **Sifat**: rencana — belum ada baris kode aplikasi yang diubah.

---

## 0. ASAL-USUL & CARA MEMBACA DOKUMEN INI

Dokumen ini adalah **hasil kombinasi dua sumber** yang diminta user:

| # | Sumber | Isi | Peran dalam kombinasi |
|---|---|---|---|
| 1 | `ANALISA-RECRUITMENT.md` (Task rec-1) | Analisa deep-dive modul Recruitment **oranHR** dari eksplorasi langsung `demo.oranhr.com` (60 halaman: 54 admin + 6 ESS, ekstraksi store ExtJS, 30 screenshot, analisa VLM) → data model inferensi, workflow, gap analysis, rekomendasi skema, roadmap P1–P5 | **Tulang punggung** — alur bisnis teruji di pasar Indonesia (proven workflow), struktur data nyata, integrasi ke modul HR Base |
| 2 | `upload/Recruitment.md` — *MASTER PROMPT: HRX-RECRUIT* | Spesifikasi ambisius modul rekrutmen AI-native: 10 prinsip desain, 12 bounded context, Modul fitur A–I, fase 0–9, quality gates, definisi selesai end-to-end | **Lapisan diferensiasi** — visi produk (AI-native, explainable, candidate-first, fairness by design) + fitur generasi baru (AI scoring, copilot, offer tracking, compliance UU PDP-grade) |

**Prinsip kombinasi**:
1. Alur bisnis inti mengikuti **oranHR** (Plan → PR → Approval → JO → Pelamar → Kandidat →
   Seleksi → Appointment → Employee) karena teruji dan cocok konteks Indonesia.
2. Standar pengalaman & inteligensi mengikuti **HRX** (AI explainable, candidate experience,
   fairness, compliance) karena itu diferensiator vs oranHR.
3. Semua asumsi teknis HRX (NestJS greenfield, Redis, OpenSearch, S3, microservice-ready)
   **diadaptasikan ke arsitektur nyata RekanKerja** — lihat §2. Tidak ada stack baru yang
   diwajibkan; kapabilitas dipertahankan, implementasinya menumpang pola yang sudah ada.
4. Nomor fase final **F0–F9**: F1–F5 = roadmap analisa P1–P5 (diperkaya fitur HRX), F6–F9 =
   gelombang inteligensi & hardening dari HRX. Pemetaan lengkap di §7.

**Cara membaca saat eksekusi**: buka §7 (fase) → kerjakan scope berurutan → verifikasi
acceptance per fase → ikuti quality gates §8 dan aturan kerja §9. Matriks jejak fitur (§3)
dipakai untuk memastikan tidak ada item HRX/oranHR yang hilang diam-diam.

---

## 1. MISI & PRINSIP DESAIN

### 1.1 Misi

Membangun **RekanKerja Rekrutmen** — modul rekrutmen end-to-end di dalam platform
RekanKerja yang: (a) **menandingi kelengkapan alur oranHR** (dari manpower planning sampai
pengangkatan karyawan), (b) **melampaui oranHR** pada titik integrasi (appointment →
onboarding wizard tanpa double-entry), dan (c) **menyelipkan inteligensi HRX** — AI yang
explainable, adil, dan selalu punya jalur manual — tanpa menjadikan AI titik tunggal
kegagalan.

### 1.2 Prinsip desain gabungan (wajib dijaga di semua fase)

| # | Prinsip | Asal | Makna praktis di RekanKerja |
|---|---|---|---|
| P1 | **AI-native, bukan tempelan** | HRX | AI menyatu di alur (parsing CV, ranking, copilot) — tapi setiap fitur AI punya fallback manual penuh |
| P2 | **Explainable** | HRX | Setiap skor/rekomendasi AI menampilkan alasan per-faktor + bukti dari CV; tidak ada black-box dalam keputusan hiring |
| P3 | **Kandidat = pelanggan** | HRX | Pengalaman pelamar first-class: form publik ringan, konfirmasi email, surat penolakan sopan, status terlacak |
| P4 | **Fairness by design** | HRX | Deteksi bahasa berbias di JD, blind-screening toggle, dashboard adverse-impact (4/5ths rule) |
| P5 | **Event-driven** (longgar) | HRX | Komunikasi antar-domain lewat event internal (notifikasi + ActivityLog + outbox webhook di F7), bukan coupling langsung |
| P6 | **Config over code** | HRX | Tahap seleksi, rubrik skor, template surat, dimensi approval = **data** (master), bukan hardcode |
| P7 | **Dwibahasa ID/EN** | HRX + keunggulan RekanKerja | Semua label `BASE_EN` + `t()` sejak baris pertama; format IDR & tanggal Indonesia |
| P8 | **Mobile-first recruiter; mobile-excellent kandidat** | HRX | List/grid responsive, aksi massal, touch-friendly (≥44px) |
| P9 | **Compliance UU PDP No. 27/2022** | HRX | Consent granular versi, retensi + anonimisasi, hak akses/hapus, audit akses PII |
| P10 | **UI elegan & cepat** | HRX | <200ms perceived: optimistic UI, skeleton, server-side pagination (pola existing) |
| P11 | **Isolasi multi-tenant mutlak** | RekanKerja | Semua data rekrutmen di schema tenant; tidak boleh bocor lintas tenant (daftar "Aman" audit) |
| P12 | **Bukan big-bang** | RekanKerja | Setiap fase harus runnable & demo-able; commit + push + E2E browser per fase |

---

## 2. KEPUTUSAN ARSITEKTUR (ADAPTASI HRX → REALITAS REKANKERJA)

### 2.1 Pemetaan stack

HRX ditulis untuk proyek greenfield. RekanKerja adalah aplikasi berjalan — stack HRX
**diadaptasi**, kapabilitasnya **dipertahankan**:

| HRX mengasumsikan | Keputusan RekanKerja | Alasan / padanan kapabilitas |
|---|---|---|
| NestJS modular monolith (DDD) | **Next.js 16 App Router monolith** — domain di `src/rekankerja/recruitment/{api,components,services}` (pola modul existing) | Arsitektur sudah modular per folder; DDD dijaga lewat pemisahan service + batas API |
| PostgreSQL 16 + Prisma | **Sama** — `prisma/schema-tenant.prisma` | Sudah berjalan |
| Multi-tenant: `org_id` + RLS di semua tabel | **Schema-per-tenant** (isolasi lebih kuat): tabel rekrutmen masuk schema tenant lewat tenant DDL | Konvensi proyek; isolasi setara RLS tanpa migrasi arsitektur |
| OpenSearch (semantic search) + fallback pgvector | **Postgres FTS + trigram** (F2–F5) → **pgvector opsional** saat F6c | Volume talent pool tenant-level tidak butuh OpenSearch; upgrade path jelas |
| Redis + BullMQ (queue) | **Scheduler internal existing (6 jam)** + **DB-backed queue** (`WebhookDelivery.nextRetryAt` dsb.) untuk tugas tertunda | Tanpa middleware baru; pola `keep-on-file → Outdated` sudah terbukti di scheduler existing |
| S3 + signed URLs | **Pattern attachment existing** (local storage terenkripsi, MIME whitelist + magic number) dengan lapisan abstraksi path agar bisa pindah S3 | Keamanan upload sudah ter-audit (EmployeeDocument) |
| WebSockets Socket.IO | **Mini-service socket.io existing** (gateway `?XTransformPort=`) bila perlu real-time; default cukup polling + notifikasi in-app | Real-time bukan kebutuhan inti rekrutmen |
| AI layer provider-agnostic | **`src/rekankerja/shared/services/ai-provider.ts`** sudah ada (z-ai-web-dev-sdk, backend-only) | Tepat memenuhi "no vendor hard-depend"; SDK hanya di server |
| OAuth2/OIDC, SAML SSO | Sesi existing (HMAC + sessionVersion + MFA) — autentikasi karyawan; pelamar publik **tanpa akun** (backlog: portal pelamar) | Keamanan sesi sudah ter-audit; mengurangi PII & permukaan serangan |
| UUIDv7 PK | **cuid** (konvensi proyek) | Ekuivalen (sort-stable, collision-safe) |
| Kubernetes, CI pipelines | Deploy PM2 + runbook existing (`DEPLOY-RUNBOOK.md`) | Lingkungan produksi nyata proyek |
| Monorepo terpisah | Satu repo aplikasi + `mini-services/` untuk proses sampingan | Konvensi proyek |

### 2.2 Struktur modul & bounded context

Modul baru **`recruitment`** (muncul di module switcher: Human Resource · Payroll · … ·
**Recruitment**), route `?s=recruitment` dengan view: `plan`, `budget`, `pr`, `pr-approval`,
`openings`, `applicants` (talent pool), `candidates`, `selection`, `appointments`, `reports`,
`settings` (master). ESS: menu **"Karier Internal"**.

Bounded context HRX → penempatan di RekanKerja (semua di bawah `src/rekankerja/recruitment/`):

| Bounded context HRX | Penempatan | Fase masuk |
|---|---|---|
| workforce-planning | `services/plan.ts` + view `plan`,`budget` | F5 |
| sourcing · talent-crm | `services/applicant.ts` + view `openings`,`applicants` | F2 |
| applicant-tracking | `services/pr.ts`, `services/opening.ts`, `services/candidate.ts` | F1–F3 |
| interview-orchestration · assessment | `services/selection.ts` + scorecards | F3 |
| offer-management | `services/offer.ts` + view `appointments` | F4 |
| onboarding-handoff | `services/appointment.ts` → panggil wizard onboarding existing | F4 |
| ai-intelligence | `services/ai/` (parsing, scoring, search, copilot) — semua lewat ai-provider | F6 |
| analytics | `services/analytics.ts` + view `reports` | F4 (dasar) → F8 (penuh) |
| compliance | `services/consent.ts`, `services/retention.ts` + hook scheduler | F2 (capture) → F9 (lengkap) |
| platform (auth, notif, files) | **TUMPANG EXISTING**: sesi, notifications + email config, attachments, letter engine, approval engine | F0–F5 |

### 2.3 Event backbone (adaptasi)

Event domain HRX dipetakan ke mekanisme existing, bukan message broker:

```
event bisnis (mis. pr.approved, application.received, offer.accepted, candidate.hired)
   ├─ notifikasi in-app + email  → engine notifications + email templates (existing)
   ├─ ActivityLog (audit)        → pola existing, scope modul recruitment
   ├─ aksi otomatis              → rule ringan di service (F7: konfigurabel)
   └─ webhook outbound           → tabel WebhookDelivery + retry (F7)
```

### 2.4 Aturan AI (per P1/P2)

- Semua panggilan AI **wajib** lewat `ai-provider.ts` (abstraksi; z-ai-web-dev-sdk hanya di
  backend). Dilarang panggil vendor langsung dari komponen.
- **Mode simulasi wajib berlabel** — bila model tidak tersedia, hasil "simulated" ditandai
  eksplisit di UI & payload; tidak pernah memalsukan hasil AI diam-diam.
- AI **tidak pernah** menjadi satu-satunya penentu: skor AI = rekomendasi; keputusan
  pass/fail/offer tetap oleh manusia (recruiter/evaluator) kecuali knockout faktual
  (pertanyaan objektif, mis. "bersedia ditempatkan di Bandung?").

---

## 3. MATRIKS JEJAK FITUR (TRACEABILITY — INTI KOMBINASI)

Legenda keputusan: **ADOPT** (dibangun) · **ADAPT** (dibangun versi rasional) · **BACKLOG**
(ditunda, tidak dijadwalkan) · **TOLAK** (tidak dibangun, dengan alasan).

### 3.1 Modul A — Strategic Workforce Planning

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| A1 Headcount plan grid per unit + budget | `RecruitmentPlan` 24-kolom rumus (a)–(h) + rekonsiliasi PR (§2.1) | **ADAPT** ringkas 6–8 kolom inti + rekonsiliasi otomatis ke PR (requested/fulfilled/unfulfilled) | F5 |
| A2 Attrition prediction per role | — (tidak ada di oranHR) | **BACKLOG** (perlu data historis 12+ bln; antarmuka disiapkan di MetricSnapshot F8) | — |
| A3 Requisition engine (rich builder + state machine + approval multi-level + replacement) | PR form lengkap + Apply + inbox approval + auto_jop (§2.3, §4) | **ADOPT** + perluas: state machine eksplisit, dimensi approval parametrik (posisi/grade/jumlah/salaryBudget via ApprovalStructure existing) | F1 |
| A4 Internal mobility gateway (window internal-first + talent marketplace) | ESS MyJobOpportunity + kandidat Internal (§2.6, §2.10) | **ADAPT**: kandidat internal di F3 + flag window internal-first di JO (F2); *talent marketplace* → **BACKLOG** | F2/F3 |
| A5 Budget guardrails (blokir offer over-budget) | RecruitmentBudget + method cost (§2.2, §2.4) | **ADAPT**: field anggaran di PR (F1) + rekap realisasi (F5); *blocking real-time* → **BACKLOG** | F1/F5 |

### 3.2 Modul B — AI Intelligence Engine (diferensiator utama)

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| B1 CV parsing multilingual → JSON + confidence + human-verify | Input manual + ApplicantWeb staging (§2.5) | **ADOPT** via ai-provider (VLM/OCR pada PDF/DOCX) → pre-fill form pelamar + UI verifikasi per field | F6a |
| B2 Explainable scoring 0–100 + rubric no-code | — (oranHR skor manual per tahap, §2.6) | **ADOPT**: rubrik bobot per slot/PR, breakdown per-faktor + bukti dari CV; skor manual tetap bisa (fallback) | F6b |
| B3 Knockout engine | — | **ADOPT**: pertanyaan knockout saat apply, auto-disposition + surat penolakan ramah + audit log | F6b |
| B4 Semantic search natural language | ApplicantEngine query builder multi-dimensi (§2.5) | **ADAPT dua tingkat**: (1) query builder rasional F2; (2) pencarian natural-language (FTS/trigram → pgvector opsional) | F2 → F6c |
| B5 Recruiter copilot (draft JD, summarize kandidat, pertanyaan interview, outreach, pipeline Q&A) | — | **ADOPT** versi ringkas via ai-provider (chat terkurasi, bukan chat bebas tanpa konteks) | F6c |
| B6 Bias & fairness guard (JD bias check, blind screening, adverse-impact dashboard) | — | **ADOPT**: JD bias check + blind-screening toggle di F6c; dashboard adverse-impact (4/5ths) di F8 | F6c/F8 |
| B7 Predictive signals (offer acceptance prob, fast-mover) | — | **BACKLOG** (butuh data historis); proyeksi sederhana lihat G4 | — |
| B8 WhatsApp-first engagement | Email notifier (§5) | **BACKLOG** (butuh WhatsApp Business API; sandbox tidak tersedia). Mitigasi: template pesan WA digenerate sistem, pengiriman manual oleh recruiter; email otomatis tetap jalan | — |

### 3.3 Modul C — Sourcing & Recruitment Marketing

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| C1 Career site builder no-code + SEO + one-click apply | JobDescription publik + ApplicantWeb staging (§2.4, §2.5) | **ADAPT**: section guest di route `/` (tanpa login): daftar lowongan publik read-only + form lamaran anonim → staging → verifikasi HR. Builder no-code penuh → **BACKLOG** | F2 |
| C2 Multi-posting hub (Glints/Kalibrr/JobStreet/LinkedIn) | Metode advertensi dicatat manual + cost (§2.4) | **BACKLOG** (feed XML/JSON generik bisa disiapkan di F7 sebagai fondasi) | — |
| C3 Referral engine (portal + tracking + milestone rewards IDR) | Field `referral_employee` (§2.5) | **ADAPT**: catat referal karyawan saat input/apply (F2); *tracker berinsentif* → **BACKLOG** | F2 |
| C4 Talent CRM (segmentasi silver medalist, drip campaign) | Applicant + keep-on-file 12 bln + Outdated (§2.5) | **ADAPT**: talent pool + segmen (silver medalist = Passed tapi tak di-appoint) F5; *drip campaign* → **BACKLOG** | F5 |

### 3.4 Modul D — Structured Hiring & Interview Orchestration

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| D1 Pipeline kanban drag-drop + keyboard-first | EvaluationProcess per PR + per kandidat (§2.6) | **ADOPT**: board kandidat per PR (kolom = tahap seleksi), bulk action, keyboard J/K | F3 |
| D2 Structured scorecards (rubric 1–5 anchored, mandatory feedback, panel + divergence flag) | Master EvaluationCategory/Scale/StatementTemplate + hasil per tahap (§2.6, §2.8) | **ADOPT+PERLUAS**: ScorecardTemplate per tahap; feedback wajib sebelum naik tahap; selisih panel >2 → alert kalibrasi | F3 |
| D3 Interview scheduling (self-serve link, 2-way sync, reminder) | plan/due date + SLA group + RequestAcknowledge (§2.6) | **ADAPT**: penjadwalan + acknowledgement + reminder email (F3); *self-serve link & Google/Outlook sync* → F7 (opsional) | F3 → F7 |
| D4 Video interview (live + one-way async) | — | **BACKLOG** | — |
| D5 Assessment integration (adapter psikometrik/coding) | Psikotest manual + ApplicantPsikotest hasil 5 instrumen (§2.6, §2.9) | **ADAPT**: catat hasil tes manual + upload laporan (F3); *adapter eksternal* → **BACKLOG** | F3 |
| D6 Interview kits (auto-generate dari scorecard + JD) | template_code surat per tahap (§2.6) | **ADAPT**: kit interview dasar (F3); *auto-generate via copilot* → F6c | F3 → F6c |

### 3.5 Modul E — Offer Management

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| E1 Offer builder (template + merge field + salary guidance + approval by value) | Tahap "Offering Salary" dalam seleksi + surat pengangkatan (§2.6, §2.7) | **ADOPT**: entitas Offer terpisah dari tahap seleksi; template letter engine; guidance vs range gaji slot JO; approval offer via scope approval sendiri | F4 |
| E2 E-signature (OTP + typed + drawn, tamper-evident, audit) | — | **ADAPT**: e-sign ringkas di F7 (OTP email + typed signature + hash PDF + audit). *TTE tersertifikasi eksternal* → **BACKLOG** | F7 |
| E3 Offer tracking (sent → viewed → accepted/declined/countered, expiry, reminder) | — | **ADOPT** versi ringkas (tanpa countered di rilis pertama; dicatat sebagai notes) | F4 |
| E4 Pre-employment checklist (KTP, NPWP, ijazah, medical, verifikasi) | RequirementDocument: CV (wajib), KTP (wajib) (§2.8) | **ADOPT**: checklist dokumen (F2) + status verifikasi final sebelum appoint (F4) | F2/F4 |

### 3.6 Modul F — Automation & Workflow Engine

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| F1 Visual workflow builder no-code | — (konfigurasi lewat master) | **ADAPT ringkas**: rule otomasi event umum (auto-ack, auto-reminder, auto-stage) di F7; *builder visual penuh* → **BACKLOG** | F7 |
| F2 Approval engine (matrix, delegasi, SLA, eskalasi) | Mesin approval oranHR + inbox PR (§4) | **SUDAH ADA** (ApprovalStructure parametrik + delegasi + MFA) → tinggal scope baru `recruitment/pr` (+ `recruitment/offer` di F4) | F1/F4 |
| F3 Notification hub (preferensi, digest, batching) | SelectionNotifier per event (§5) | **SUDAH ADA** (notifications + email config + template) → perluas preferensi + digest | F7 |
| F4 SLA engine per tahap + aging + eskalasi | sla_group ("Interview" 30 hari) + IncompleteEvaluation (§2.6, §2.8) | **ADOPT**: SLA per tahap + indikator aging + eskalasi notifikasi | F3 (dasar) → F7 (eskalasi) |

### 3.7 Modul G — Analytics & Insights

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| G1 Dashboard real-time (funnel, requisition health, workload, SLA, source ROI) | RecruitmentActivity funnel bertingkat + ApplicantDemography chart (§2.3, §2.5) | **ADOPT** di atas engine chart existing; funnel dasar lebih awal | F4 (funnel) → F8 (penuh) |
| G2 Metrics catalog (Time to Fill/Hire, konversi per tahap, cost per hire, offer acceptance rate, interview pass rate, source effectiveness, first-year attrition, quality-of-hire, diversity pass-through, requisition aging) | Kolom funnel Applied → … → Hired (§2.3) | **ADOPT** mayoritas; *first-year attrition & quality-of-hire* butuh data post-hire → F8 opsional (marked); diversity pass-through = adverse-impact dashboard (P4) | F8 |
| G3 Report builder (saved views, export terjadwal) | Report Collection (katalog tak terverifikasi di demo, §11.2) | **ADAPT**: saved views + export CSV/XLSX/PDF via engine laporan existing | F8 |
| G4 Predictive panel (projected time-to-fill, at-risk requisition) | — | **ADAPT** heuristik (rata-rata historis, aging), bukan ML | F8 |
| G5 Multi-touch attribution sumber | Sumber pelamar: advertensi/agency/kampus/referral/web (§2.5) | **ADAPT** light: last-touch + referal tracking | F8 |

### 3.8 Modul H — Onboarding Handoff & Integration

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| H1 Hire conversion (kandidat → karyawan, zero re-entry) | CandidateAppointment membuat Employee+Person+User+Role sekaligus (§2.7) — oranHR **double-entry manual** | **ADOPT + LEBIH BAIK**: tombol "Lanjutkan ke Onboarding" membuka **wizard onboarding existing ter-prefill** (nama, posisi, office, supervisor, employmentStatus dari PR) — diferensiator utama RekanKerja | F4 |
| H2 Onboarding automation (checklist IT, BPJS, kontrak, payroll) | — | **SUDAH ADA** wizard + checklist → trigger otomatis saat Employee dibuat | F4 |
| H3 Integration layer (REST + webhook HMAC + retry/DLQ + health) | — | **ADAPT**: webhook outbound (F7); API internal mengikuti konvensi `/api/rekankerja/...`; *health dashboard* versi ringkas | F7 |

### 3.9 Modul I — Compliance, Security & Trust (UU PDP-grade)

| Fitur (HRX) | Bukti oranHR (analisa) | Keputusan RekanKerja | Fase |
|---|---|---|---|
| I1 Consent management (granular, versi, withdrawal) | — (demo oranHR plaintext PII — analisa §6 mencatat RekanKerja unggul) | **ADOPT**: consent saat input/apply (F2) → ledger lengkap + withdrawal (F9) | F2 → F9 |
| I2 Data subject requests (akses/ekspor/hapus + SLA) | — | **ADOPT** (workflow internal HR dengan audit) | F9 |
| I3 Retention policy (anonymize rejected 12/24 bln) | keep-on-file 12 bln → Outdated (§2.5) | **ADOPT**: Outdated otomatis (F2) → **anonimisasi otomatis** pasca retensi, kecuali talent pool dengan consent aktif | F2 → F9 |
| I4 Audit trail PII (immutable, exportable) | ActivityLog existing + golid/golversion optimistic lock (§3) | **SUDAH ADA** ActivityLog → perluas: log akses PII pelamar + export | F9 |
| I5 RBAC + ABAC (7 role + scope recruiter) | Role per company + ESS terbatas (§2.10) | **SUDAH ADA** AppUser/AppRole → role rekrutmen (lihat F0) + ABAC: recruiter lihat PR yang di-assign | F0/F1 |
| I6 Security (enkripsi field, OWASP, rate limit, 2FA) | Plaintext di demo | **SUDAH ADA & UNGGUL** (field-crypto, masking per role, MFA) → terapkan ke PII pelamar + rate limit form publik | F2 dst. |
| I7 Anonymization utility (analytics & AI training) | — | **ADOPT** | F9 |

### 3.10 Fitur oranHR yang sengaja TIDAK diadopsi (keputusan tetap)

| Fitur oranHR | Alasan | Pengganti |
|---|---|---|
| Engine psikotest online (5 instrumen + proctoring kamera, 14 halaman master) | Sangat berat, niche, risiko privasi tinggi (kamera kandidat) | Catat hasil tes manual + upload laporan (F3); bila suatu saat online → fase tersendiri (BACKLOG) |
| Portal akun pelamar (password + aktivasi) | Perluasaan permukaan serangan & PII; nilai MVP rendah | Form publik anonim + email konfirmasi (F2); portal self-service → BACKLOG |
| RecruitmentIdentity per company (penomoran terpusat khusus modul) | Duplikasi mekanisme | Pola docNo proyek: prefix-tahun-seq (`PR-2026-0001`) |
| Multi-company lintas tenant | RekanKerja schema-per-tenant | Relasi `Company` internal tenant (sudah ada) |
| Grid manpower 24-kolom ala spreadsheet | Overkill, rawan error | Versi ringkas 6–8 kolom + rekonsiliasi otomatis (F5) |

---

## 4. DATA MODEL FINAL

### 4.1 Konvensi (mengikat semua model)

- PK `cuid`; **tanpa tipe list primitif** (anak-anak tabel / JSON string).
- Semua tabel rekrutmen masuk **schema tenant** (`prisma/schema-tenant.prisma` + tenant DDL).
- `createdAt`/`updatedAt` (+ `createdById` pada dokumen penting) dan entri **ActivityLog**
  untuk setiap mutasi.
- Soft-state via kolom `status` bernilai enum terdokumentasi (konvensi proyek), bukan enum
  DB — mudah evolve tanpa migrasi destruktif.
- **PII pelamar dienkripsi** field-crypto (`enc:v1:...`): alamat, telepon, email, tempat/tgl
  lahir; **kompensasi** (expectedSalary, salary, budget) ikut gating vault uang — dekripsi
  hanya di batas serializer API (pola existing).
- Penomoran dokumen: `PR-YYYY-NNNN` (PR), `JO-YYYY-NNNN` (lowongan), `APP-YY-NNNNN`
  (pelamar), `CAND-…`, `OFF-…`, `AP-YYYY-NNNN` (appointment) — prefix-tahun-seq, satu
  registry per tenant (pola modul lain).
- Penomoran surat (`letterNo`) via **letter engine existing** (template dwibahasa).

### 4.2 Basis: skema §7.2 ANALISA-RECRUITMENT.md (tetap berlaku)

20+ model berikut **tetap** menjadi basis (definisi lengkap + relasi ada di dokumen analisa):

```
PersonnelRequisition · JobOpportunity · JobOpening · JobOpeningMethod ·
Applicant · ApplicantEducation · ApplicantExperience · ApplicantSkill ·
ApplicantDocument · ApplicantApplication · JobCandidate · SelectionProcess ·
CandidateSelectionStep · CandidateAppointment ·
Masters: RecruitmentMethod · AdMediaType · EmploymentAgency · RecruitmentCostItem ·
Skill · RequiredDocument · EvaluationCategory · EvaluationScale · StatementTemplate ·
SlaGroup
```

### 4.3 Tambahan & revisi hasil kombinasi dengan HRX (baru di dokumen ini)

> Basis analisa + kebutuhan HRX (offer, consent, scorecard, knockout, AI, webhook, metrik,
> plan & budget ringkas). Semua mengikuti konvensi §4.1.

```prisma
// ── F1: state machine PR dieksplisitkan (HRX A3) ────────────────────────────
// PersonnelRequisition.status: Draft|Submitted|Approved|Rejected|OnHold|Fulfilled|Closed|Cancelled
// + kolom baru: slaTargetDays Int?        (HRX A3 SLA target)
// + kolom baru: replacedEmployeeId String? (replacement req ↔ alasan attrition)

// ── F2: consent & staging publik (HRX I1, C1-lite) ─────────────────────────
model PublicApplication {          // staging form publik (padanan ApplicantWeb oranHR)
  id            String   @id @default(cuid())
  jobOpeningId  String?
  status        String   @default("Pending")  // Pending|Verified|Rejected|Spam
  payloadJson   String                 // seluruh isian form (PII dienkripsi)
  cvFileName    String?
  cvStoragePath String?
  ipHash        String?               // rate-limit & audit (hash, bukan IP mentah)
  submittedAt   DateTime @default(now())
  verifiedById  String?               // Employee yang memverifikasi
  verifiedAt    DateTime?
  consentId     String?               // → ApplicantConsent
  @@index([status, submittedAt])
}

model ApplicantConsent {           // HRX I1 — consent granular & versioned
  id           String   @id @default(cuid())
  applicantId  String?              // null selagi masih staging (PublicApplication)
  purpose      String               // e.g. "recruitment", "talent-pool", "marketing"
  version      String               // versi teks consent
  grantedAt    DateTime @default(now())
  withdrawnAt  DateTime?
  channel      String               // public-form|manual|ess
  note         String?
  @@index([applicantId, purpose])
}

// ── F3: scorecards terstruktur (HRX D2) ────────────────────────────────────
model ScorecardTemplate {          // per tahap seleksi (mis. Interview User)
  id                 String  @id @default(cuid())
  name               String
  selectionProcessId String?       // null = template umum
  description        String?
  active            Boolean @default(true)
  competencies      ScorecardCompetency[]
}
model ScorecardCompetency {        // rubric no-code per template
  id               String  @id @default(cuid())
  templateId       String
  name             String
  description      String?
  weight           Float   @default(1.0)
  anchorsJson      String?         // [{value:1,label:"Does not meet",guide:"…"},…] (1–5 anchored)
  orderNo          Int     @default(1)
}
model CandidateScorecard {         // pengisian per kandidat per tahap per evaluator
  id                String   @id @default(cuid())
  candidateId       String              // JobCandidate
  selectionStepId   String              // CandidateSelectionStep
  templateId        String
  evaluatorId       String              // Employee
  submittedAt       DateTime?
  recommendation   String?             // StrongHire|Hire|NoHire|StrongNoHire
  overallComment    String?
  items             ScorecardItem[]
  @@unique([selectionStepId, evaluatorId])
}
model ScorecardItem {
  id           String  @id @default(cuid())
  scorecardId  String
  competencyId String
  score        Int     // 1–5
  comment      String?
  @@unique([scorecardId, competencyId])
}
// Aturan UI: feedback wajib sebelum naik tahap (HRX D2);
// divergensi panel >2 poin → flag kalibrasi dihitung saat baca (bukan disimpan).

// ── F4: offer management (HRX E1/E3) ───────────────────────────────────────
model Offer {
  id            String   @id @default(cuid())
  offerNo       String   @unique        // OFF-2026-0001
  prId          String
  candidateId   String                  // JobCandidate
  jobOpeningId  String?
  salary        Decimal                 // enkripsi kompensasi (vault gating)
  currency      String   @default("IDR")
  salaryUnit    String   @default("Monthly")
  startDate     DateTime?               // tanggal mulai kerja ditawarkan
  expiryDate    DateTime?               // timer kedaluwarsa (HRX E3)
  status        String   @default("Draft")  // Draft|Sent|Viewed|Accepted|Declined|Expired
  letterNo      String?                 // surat penawaran (letter engine)
  sentAt        DateTime?
  respondedAt   DateTime?
  note          String?                 // termasuk catatan counter (versi awal)
  createdById   String
  @@index([status, expiryDate])
}
// Approval offer → ApprovalStructure scope "recruitment/offer" (dimensi nilai/grade).

// ── F5: plan & budget ringkas (padanan oranHR §2.1–2.2, versi rasional) ────
model RecruitmentPlan {
  id             String   @id @default(cuid())
  period         String                 // "2026" atau "2026-B" (sub-periode, konvensi oranHR)
  positionId     String
  companyOfficeId String?
  initialTarget  Int      @default(0)   // (a)
  adjustment      Int      @default(0)   // (b) — catatan di note
  currentHeadcount Int     @default(0)  // (d)
  joinedCount     Int     @default(0)  // (e) — in
  leftCount       Int      @default(0)  // (f) — out
  salaryBudget    Decimal?               // opsional, vault gating
  status          String   @default("Draft") // Draft|Applied
  note            String?
  @@unique([period, positionId, companyOfficeId])
  // (c)=(a)+(b), (g)=(d)+(e)-(f), (h)=(c)-(g) dihitung + rekonsiliasi PR otomatis di view.
}
model RecruitmentBudget {
  id         String   @id @default(cuid())
  period     String
  total      Decimal  @default(0)
  adjust     Decimal  @default(0)
  used       Decimal  @default(0)     // agregat JobOpeningMethod.actualCost
  currency   String   @default("IDR")
  note       String?
  @@unique([period])
}
model TalentPool {                   // segmen ringkas (HRX C4-lite)
  id          String  @id @default(cuid())
  name        String
  description String?
  members     TalentPoolMember[]
}
model TalentPoolMember {
  id          String   @id @default(cuid())
  poolId      String
  applicantId String
  addedAt     DateTime @default(now())
  note        String?
  @@unique([poolId, applicantId])
}

// ── F6: artefak AI (semua explainable — HRX P2) ────────────────────────────
model KnockoutQuestion {             // HRX B3 — per slot lowongan
  id            String  @id @default(cuid())
  jobOpeningId  String
  question      String
  expectedValue String             // jawaban yang diharapkan (string/bool)
  mode          String  @default("Equals") // Equals|Contains|NotEquals
  active        Boolean @default(true)
  orderNo       Int     @default(1)
}
model ApplicationAnswer {
  id            String  @id @default(cuid())
  applicationId String              // ApplicantApplication
  questionId    String
  answer        String?
  @@unique([applicationId, questionId])
}
model CvParseResult {                // HRX B1 — hasil parsing + verifikasi manusia
  id            String   @id @default(cuid())
  applicantId   String
  sourceKind    String               // pdf|docx|paste
  storagePath   String?
  fieldsJson    String               // {field: {value, confidence}}
  mode          String               // ai|manual|simulated   ← label eksplisit
  model         String?
  verifiedById  String?              // Employee
  verifiedAt    DateTime?
  createdAt     DateTime @default(now())
  @@index([applicantId])
}
model CandidateAiScore {             // HRX B2 — skor explainable
  id             String   @id @default(cuid())
  candidateId    String               // JobCandidate
  rubricJson     String               // bobot kriteria saat generate (versi rubrik)
  total          Float
  factorsJson    String               // [{factor, weight, contribution, evidence}]
  mode           String               // ai|manual|simulated
  model          String?
  generatedAt    DateTime @default(now())
  generatedById  String               // Employee pemicu
  @@index([candidateId, generatedAt])
}

// ── F7: webhook outbound (HRX H3) ──────────────────────────────────────────
model WebhookEndpoint {
  id          String   @id @default(cuid())
  url         String
  eventsJson  String               // ["pr.approved","offer.accepted",…]
  secretEnc   String               // HMAC secret terenkripsi
  active      Boolean  @default(true)
  deliveries  WebhookDelivery[]
}
model WebhookDelivery {              // DB-backed queue + retry + DLQ
  id           String   @id @default(cuid())
  endpointId   String
  event        String
  payloadJson  String
  status       String   @default("Pending")  // Pending|Success|Failed|Dead
  attempts     Int      @default(0)
  nextRetryAt  DateTime?
  lastError    String?
  createdAt    DateTime @default(now())
  @@index([status, nextRetryAt])
}

// ── F8: snapshot metrik untuk dashboard & proyeksi ─────────────────────────
model MetricSnapshot {
  id         String   @id @default(cuid())
  metric     String               // time_to_fill, offer_acceptance_rate, …
  period     String               // YYYY[-Q|-B] atau YYYY-MM
  dimsJson   String?              // {"office":"BDG","source":"Referral"}
  value      Float
  computedAt DateTime @default(now())
  @@unique([metric, period, dimsJson])
}
```

**Kaidah relasi lintas domain**: entitas rekrutmen hanya mereferensikan master HR yang sudah
ada (`Position`, `Job`, `OrgUnit`, `CompanyOffice`, `WorkLocation`, `Employee`, `Skill`) —
**tidak menambah kolom ke tabel HR Base**. Arah integrasi ke HR Base satu pintu: lewat
`CandidateAppointment → wizard onboarding` (F4).

---

## 5. API & PENAMAAN (KONVENSI PROYEK)

Semua endpoint admin di bawah `/api/rekankerja/recruitment/...`, guard sesi + scope tenant,
tulis lewat `requireMutator()`, ActivityLog, notifikasi, masking PII sesuai role; gaji &
anggaran ikut gating vault uang. Error map 403/409 konsisten proyek. Cursor/server-side
pagination + advance search `&` (pola existing).

```
# F0–F1
GET/POST        /api/rekankerja/recruitment/masters?type=          # CRUD master ringan (validasi type)
GET/POST         /api/rekankerja/recruitment/pr
GET/PATCH/DELETE /api/rekankerja/recruitment/pr?id=
POST             /api/rekankerja/recruitment/pr/apply              # submit → ApprovalChain
POST             /api/rekankerja/recruitment/pr/{action}           # hold|close|cancel (state machine)

# F2
GET/POST/PATCH   /api/rekankerja/recruitment/openings              # JO + slot + method + cost
GET/POST/PATCH   /api/rekankerja/recruitment/applicants            # talent pool + filter multi-dimensi
GET/POST/PATCH   /api/rekankerja/recruitment/applicants/{education|experience|skill|documents}
POST             /api/rekankerja/recruitment/public-applications/{id}/verify   # staging → Applicant
# publik (section guest route "/", tanpa login, rate-limited):
GET              /api/public/recruitment/openings                   # hanya slot Posted
POST             /api/public/recruitment/apply                     # → PublicApplication + consent

# F3
GET/POST/PATCH   /api/rekankerja/recruitment/candidates             # transfer applicant/employee → kandidat
GET/PATCH        /api/rekankerja/recruitment/selection              # steps per kandidat (plan/due/ack/hasil)
GET/POST/PATCH   /api/rekankerja/recruitment/scorecards             # template + pengisian + agregat panel

# F4
GET/POST/PATCH   /api/rekankerja/recruitment/offers                # + accept|decline|expire (action)
POST             /api/rekankerja/recruitment/appointments          # appoint → surat + prefill onboarding
GET              /api/rekankerja/recruitment/reports/funnel

# F5
GET/POST/PATCH   /api/rekankerja/recruitment/plan | budget | talent-pools

# F6
POST             /api/rekankerja/recruitment/ai/parse-cv
POST             /api/rekankerja/recruitment/ai/score
GET              /api/rekankerja/recruitment/ai/search?q=
POST             /api/rekankerja/recruitment/ai/copilot             # aksi terkurasi (draft-jd, summarize, …)

# F7–F9
GET/POST/PATCH   /api/rekankerja/recruitment/webhooks | consents | retention-rules
GET              /api/rekankerja/recruitment/reports/{sla|source-roi|adverse-impact|dashboard}

# ESS (portal ESS existing)
GET  /api/rekankerja/ess/job-openings        POST /api/rekankerja/ess/apply
GET  /api/rekankerja/ess/my-applications      GET  /api/rekankerja/ess/my-selection
GET/POST /api/rekankerja/ess/pr               GET  /api/rekankerja/ess/pr-to-approve
```

---

## 6. STANDAR UI/UX

1. **Design language: ikut modul existing** (HRX §7 eksplisit: *"follow existing module"*)
   — list + quick sheet + detail + dialog, advance search `&`, sticky footer, `sm:max-w-*`
   untuk DialogContent (aturan emas proyek).
2. **Layar khas (signature screens)** — versi rasional dari HRX:
   - **Pipeline Kanban seleksi**: board kandidat per PR, kolom = tahap; drag-drop + bulk
     action + navigasi keyboard (J/K) (F3).
   - **Profil 360° pelamar/kandidat**: CV + ringkasan + breakdown skor (bila F6 aktif) +
     timeline tahap + dokumen + surat + komentar panel dalam satu layar (F2, kaya di F3/F6).
   - **Requisition Cockpit**: detail PR dengan slot lowongan, funnel mini, SLA & aging,
     kandidat aktif (F3).
   - **Dashboard analitik**: funnel konversi, kesehatan PR, sumber & biaya (F4 dasar, F8 penuh).
3. <200ms perceived: optimistic UI untuk aksi umum (pindah tahap, acknowledge), skeleton
   loader, empty state dengan panduan (HRX §7).
4. **Dwibahasa penuh** (`BASE_EN` + `t()`), format IDR (`Intl`, tanpa scientific), format
   tanggal Indonesia; mobile responsive + touch ≥44px; WCAG-minded (label, kontras, keyboard).
5. **Mode buta (blind screening)**: toggle sembunyikan nama/foto/umur/universitas di list
   kandidat (F6c) — kandidat tetap teridentifikasi via nomor.

---

## 7. RENCANA EKSEKUSI FINAL — FASE F0–F9

> Effort: **S** ≤1 hari · **M** 2–4 hari · **L** 1–2 minggu · **XL** >2 minggu (efektif, satu agent).
> Protokol tiap fase: ringkasan desain → tunggu **"GO"** user → schema (db push, additive &
> reversibel) → backend (API + service) → frontend → seed demo realistis → E2E browser →
> lint 0 error → commit + push → catat `worklog.md`.

### Peta fase gabungan

| Fase final | Nama | Asal | Effort |
|---|---|---|---|
| **F0** | Fondasi Modul & Master | HRX Phase 0 (adaptasi — banyak sudah ada) | **M** |
| **F1** | Permintaan Karyawan (PR) + Approval | Analisa P1 + HRX A3 | **L** |
| **F2** | Lowongan, Pelamar & Talent Pool + Form Publik | Analisa P2 + HRX C1-lite/I1/E4 | **L** |
| **F3** | Kandidat & Proses Seleksi Terstruktur (scorecard + kanban + SLA) | Analisa P3 + HRX D1/D2/D3/D6 | **L** |
| **F4** | Appointment, Offer & Integrasi Onboarding | Analisa P4 + HRX E1/E3/H1/H2 | **M–L** |
| **F5** | ESS, Rencana & Anggaran, Demografi | Analisa P5 + HRX A1-lite/C4-lite | **M–L** |
| **F6** | AI Intelligence (parsing, skor explainable, pencarian semantik, copilot) | HRX Modul B + backlog analisa | **XL** (3 sub-tahap) |
| **F7** | Otomasi, Integrasi & E-Sign | HRX F + H3 + E2 | **L–XL** |
| **F8** | Analytics & Prediktif | HRX G | **M–L** |
| **F9** | Compliance Hardening (UU PDP penuh) | HRX I | **M** |

```
GELOMBANG 1 — CORE REKRUTMEN (setara + melampaui oranHR):
F0 ─► F1 PR+approval ─► F2 lowongan+pelamar+publik ─► F3 seleksi ─► F4 offer+appointment
     └► F5 ESS+plan+budget
     Nilai bisnis tercepat: F1+F2 (permintaan terkontrol + talent pool).
     Titik unggul vs oranHR: F4 (onboarding tanpa double-entry) + dwibahasa + PII enkripsi.

GELOMBANG 2 — INTELLIGENCE & HARDENING (diferensiasi HRX):
F6 AI ─► F7 otomasi+integrasi+e-sign ─► F8 analytics ─► F9 compliance
```

### F0 — Fondasi Modul & Master (M)
**Scope**: (1) shell modul `recruitment` di module switcher + guard menu & role baru
(`Recruitment.HR`, `Recruitment.Approver`, `Recruitment.Viewer` + izin ESS terkait);
(2) kamus i18n modul (BASE_EN + ID) — cakupan seluruh fase inti; (3) CRUD master ringan
via satu endpoint `masters?type=` untuk: `RecruitmentMethod`, `AdMediaType`,
`EmploymentAgency`, `RecruitmentCostItem`, `Skill`, `RequiredDocument`,
`EvaluationCategory`, `EvaluationScale`, `SlaGroup`; (4) seed `SelectionProcess` default
(Interview HR → Psikotes [manual] → Interview User → Offering → Medical Check Up) —
per-tenant, dapat diedit (config-over-code); (5) seed demo dwibahasa.
**Acceptance**: modul tampil di switcher; semua master CRUD + validasi; role mengontrol
akses; lint 0. **Dependensi**: —.

### F1 — Permintaan Karyawan (PR) + Approval (L)
**Scope**: (1) skema `PersonnelRequisition` (+ kolom SLA target & replacement); (2) view
`pr`: list server-side + advance search `&` + filter status + duplikat + nomor `PR-2026-0001`;
(3) dialog New/Edit lengkap (field §2.3 analisa: posisi, job, org, office, requiredNo,
employmentStatus, preferredSource, jendela tanggal earliest/latest, recruitment officer,
reason, miscSpec, additionalQualification, salaryBudget [vault], autoPostOpening);
(4) **state machine eksplisit** Draft→Submitted→Approved/Rejected→…→Fulfilled/Closed/Cancelled
dengan guard transisi; (5) approval via `ApprovalStructure` scope `recruitment/pr` (default
1 lapis; dimensi parametrik posisi/grade/requiredNo/salaryBudget siap) + inbox `pr-approval`
+ **ESS**: My PR (pengajuan) & My PR To Approve (approval manager); (6) notifikasi in-app +
email submit/approve/reject + ActivityLog + masking.
**Acceptance (E2E)**: buat PR → apply → approve 2 lapis → `Approved`; tolak di lapis-1 →
`Rejected`; ESS manager mengajukan & menyetujui tanpa buka app admin; advance search bekerja.
**Dependensi**: F0. **Risiko**: kalibrasi dimensi approval → mitigasi default 1 lapis.

### F2 — Lowongan, Pelamar & Talent Pool + Form Publik (L)
**Scope**: (1) `JobOpportunity` + `JobOpening` (slot per PR; `autoPostOpening` saat PR
Approved) + `JobOpeningMethod` (kanal + biaya terencana/aktual); view `openings`
master-detail; (2) `Applicant` penuh + education/experience/skill + `ApplicantApplication`
multi-lamar + `ApplicantDocument` (checklist `RequiredDocument` — CV & KTP wajib;
pattern EmployeeDocument: MIME whitelist + magic number + ukuran maks); (3) **talent pool**:
view `applicants` + query builder rasional (pendidikan/bidang/IPK, pengalaman, ekspektasi
gaji, umur, status, sumber, skill) — padanan ApplicantEngine versi aman (bukan SQL bebas);
(4) auto **Outdated** via scheduler existing saat lewat `keepOnFileMonths` + blacklist/suspend
**wajib alasan**; (5) **form publik minimal** (section guest route `/` tanpa login):
daftar slot Posted (judul, lokasi, rentang gaji opsional, ringkasan) + form lamaran anonim
→ `PublicApplication` (Pending) → HR verifikasi "Upload" ke talent pool + email konfirmasi
+ **consent UU PDP** + rate-limit per IP + honeypot + captcha ringan; (6) pencatatan
referral employee.
**Acceptance**: PR approved → JO auto-post → slot tampil publik; lamaran publik masuk
staging → diverifikasi → jadi Applicant; input manual + CV; pelamar melamar 2 slot; filter
kombinasi talent pool menemukan pelamar; keep-on-file lewat → Outdated.
**Dependensi**: F1. **Risiko**: volume PII & spam publik → enkripsi + consent + staging.

### F3 — Kandidat & Proses Seleksi Terstruktur (L)
**Scope**: (1) `JobCandidate` — transfer dari applicant / **kandidat internal** (employee;
source Internal|External); (2) `SelectionProcess` per-tenant (katalog + urutan + SLA +
minResultPass + template surat + needAcknowledgement); (3) `CandidateSelectionStep`:
penjadwalan plan/due + acknowledgement, performed + evaluator, hasil Quantitative/
Qualitative, pass/fail + continueProcess, surat undangan via letter engine; monitor
Incomplete Evaluation + badge per PR; **kalender seleksi bulanan** (view sederhana);
(4) **Scorecards (HRX D2)**: template rubrik kompetensi 1–5 anchored per tahap; feedback
wajib sebelum naik tahap; agregat panel + flag divergensi >2 poin; (5) **Pipeline Kanban
(HRX D1)**: board per PR, drag antar tahap, bulk action, keyboard; (6) hasil tes eksternal
psikotes/medis: catat manual + upload laporan (bukan engine online — lihat §3.10);
(7) ESS `MySelectionProcess` untuk kandidat internal.
**Acceptance**: kandidat melewati 3 tahap — gagal tahap 2 → proses berhenti & status
`Failed`; lulus semua → `Passed`; SLA overdue terlihat; scorecard 2 evaluator dengan selisih
>2 memunculkan flag kalibrasi; surat undangan PDF terbit; kandidat internal melihat tahapan
sendiri di ESS.
**Dependensi**: F2. **Risiko**: fleksibilitas tahap per PR → salin katalog default ke PR,
boleh edit (config-over-code).

### F4 — Appointment, Offer & Integrasi Onboarding (M–L)
**Scope**: (1) **Offer (HRX E1/E3)**: dari tahap Offering → buat Offer (nomor `OFF-…`,
gaji final + guidance vs range slot JO, tanggal mulai, expiry timer + reminder otomatis,
status Sent→Viewed→Accepted/Declined/Expired; counter dicatat sebagai notes); approval
offer scope `recruitment/offer`; surat penawaran via letter engine; (2) **Appointment**:
dialog pengangkatan (tanggal, penempatan posisi/office/work location/supervisor — prefill
dari PR, boleh override) + surat pengangkatan + **surat penolakan batch** ke pelamar lain
di PR yang sama + verifikasi checklist dokumen pre-employment final; (3) tombol
**"Lanjutkan ke Onboarding"** → wizard onboarding existing ter-prefill (nama, posisi,
office, work location, supervisor, employmentStatus) → Employee + assignment dibuat →
backlink `employeeId` + `Applicant.status = Employed` + **`PR → Fulfilled` saat jumlah
appointed mencapai `requiredNo`**; (4) **funnel report dasar** (Applied → Candidate →
per tahap → Hired) di atas engine chart existing.
**Acceptance**: offer dikirim → expiry reminder jalan → accepted → appoint → surat PDF →
onboarding → Employee muncul di Direktori dengan assignment benar; PR `requiredNo=1`
otomatis `Fulfilled`; pelamar lain menerima surat penolakan; funnel cocok dengan data.
**Dependensi**: F3. **Risiko**: sinkronisasi ganda wizard → wizard dipanggil mode
prefill-readonly untuk field rekrutmen.

### F5 — ESS, Rencana & Anggaran, Demografi (M–L)
**Scope**: (1) **ESS internal job posting**: MyJobOpportunity (lowongan aktif + batas
apply + window internal-first opsional per JO) + apply + MyEmpAppliedJobOpportunity +
notifikasi; (2) **RecruitmentPlan ringkas** (6–8 kolom; formula a–h dihitung otomatis +
rekonsiliasi PR: requested/fulfilled/unfulfilled) + `MysRecruitmentPlanning` ESS;
(3) **RecruitmentBudget** (anggaran periode + realisasi agregat dari method cost + summary
per JO/PR — padanan dua level oranHR); (4) **demografi pelamar** (chart existing) +
**segmen talent pool** sederhana (TalentPool + auto-saran "silver medalist": Passed tapi
tidak di-appoint).
**Acceptance**: karyawan ESS melihat & melamar lowongan internal → tercatat sebagai
kandidat Internal di F3 flow; plan ringkas menampilkan (h) dan rekonsiliasi PR; budget vs
realisasi cocok dengan method cost; chart demografi tampil.
**Dependensi**: F4 (data realisasi). **Risiko**: kualitas data headcount → sinkron dengan
EmployeeAssignment existing.

### F6 — AI Intelligence (XL — tiga sub-tahap, masing-masing runnable)
**F6a CV Intelligence**: parsing CV (PDF/DOCX/paste) via ai-provider (VLM/OCR) →
`CvParseResult` (fieldsJson + confidence per field) → UI **human-verify** yang mem-pre-fill
form Applicant; bila model gagal/tidak tersedia → mode `simulated` berlabel, form manual
tetap jalan (fallback penuh).
**F6b Skor Explainable + Knockout**: (1) pertanyaan knockout per slot (objektif) saat
apply → auto-disposition + surat penolakan ramah + audit; (2) rubrik skor no-code per
slot/PR (bobot kriteria) → skor 0–100 + breakdown per-faktor + **bukti dikutip dari CV**;
skor = rekomendasi, keputusan tetap manual; seluruh artefak tersimpan (`CandidateAiScore`).
**F6c Semantic Search + Copilot + Fairness**: (1) pencarian natural language talent pool
(FTS/trigram; pgvector opsional); (2) **Recruiter Copilot** aksi terkurasi: draft &
optimasi JD (deteksi bahasa berbias → saran netral), ringkas profil kandidat 5 poin dengan
tautan bukti, generate pertanyaan interview dari scorecard, draft outreach (email/teks WA),
tanya-jawab pipeline ("berapa kandidat backend aktif di tahap 2?"); (3) **blind screening
toggle**.
**Acceptance**: upload CV → 80% field terisi + confidence terlihat + bisa dikoreksi;
kandidat dengan knockout → auto-tolak ter-audit; skor menampilkan "mengapa" per faktor;
pencarian "software engineer Bandung 3 tahun" mengembalikan kandidat relevan; JD berbias
gender terdeteksi & diberi saran; semua fitur AI punya jalur manual.
**Dependensi**: F2 (talent pool), F3 (kandidat & rubrik). **Risiko**: biaya/latensi model →
batas kuota + cache; bias → audit + human-in-the-loop + adverse-impact dashboard F8.

### F7 — Otomasi, Integrasi & E-Sign (L–XL)
**Scope**: (1) **SLA & eskalasi**: aging per tahap + notifikasi eskalasi berjenjang;
(2) **rule otomasi ringkas** (config-over-code): auto-acknowledge, auto-reminder H-1,
auto-reply konfirmasi, auto-stage-move pasca knockout (hanya untuk event umum — builder
visual penuh backlog); (3) **notification hub**: preferensi per user (email/in-app/digest
harian) + intelligent batching ringkas; (4) **e-sign ringkas (HRX E2)**: OTP email + typed
signature + hash PDF tamper-evident + audit trail pada offer & surat pengangkatan;
(5) **webhook outbound**: `WebhookEndpoint` + HMAC + idempotency key + retry backoff +
DLQ + health ringkas; event utama: `pr.approved`, `application.received`,
`candidate.hired`, `offer.accepted`; (6) opsional (butuh kredensial): kalender Google
two-way sync + self-serve link penjadwalan — bila tidak tersedia, tetap backlog tercatat.
**Acceptance**: tahap overdue 3+ hari memicu eskalasi; rule auto-reminder terpicu pada
jadwal nyata; offer dapat ditandatangani via OTP dan PDF terverifikasi hash-nya; webhook
demo menerima event dengan signature valid & retry saat gagal.
**Dependensi**: F3–F5. **Risiko**: OAuth kalender → opsional, tidak blocking.

### F8 — Analytics & Prediktif (M–L)
**Scope**: (1) **dashboard**: funnel konversi per tahap, kesehatan & aging PR, beban
recruiter, kepatuhan SLA, ROI sumber & cost per hire; (2) **katalog metrik**: Time to
Fill/Hire, offer acceptance rate, interview pass rate, source effectiveness, requisition
aging; first-year attrition by source & quality-of-hire = **opsional** (butuh data
post-hire, tandai bila data belum cukup); (3) **adverse-impact dashboard** (pass-through
demografis per tahap + flag 4/5ths rule — lanjutan P4 fairness); (4) **saved views +
export** CSV/XLSX/PDF terjadwal; (5) **prediktif heuristik**: projected time-to-fill
(rata-rata historis per posisi/grup) + alert PR berisiko; (6) snapshot metrik periodik
(`MetricSnapshot`) sebagai basis historis (fondasi bila kelak A2/B7 diaktifkan).
**Acceptance**: dashboard akurat vs data demo; export terunduh; adverse-impact menampilkan
flag contoh dari data seed; projected time-to-fill tampil di PR.
**Dependensi**: F4 (data transaksional penuh), disarankan setelah F6 untuk skor.

### F9 — Compliance Hardening UU PDP (M)
**Scope**: (1) **consent ledger** versi + withdrawal (efek: keluar dari talent pool &
hentikan komunikasi marketing); (2) **DSR**: workflow akses/ekspor/papus data pelamar
dengan SLA + audit + data lineage (tabel mana saja memuat PII pelamar); (3) **retention &
anonimisasi otomatis**: rejected/outdated tanpa consent talent pool → anonimisasi terjadwal
(reversible hash untuk dedup, PII di-null terenkripsi log); (4) **audit PII**: log akses
(mis. siapa membuka CV/telepon pelamar) + export audit; (5) **utility anonimisasi** untuk
analytics & bahan latih AI; (6) hardening: review rate limit, OWASP checklist, verifikasi
field-level encryption PII pelamar, README modul (purpose, data flow, API, config,
limitation).
**Acceptance**: pelamar (seed) minta ekspor → paket data terunduh ter-audit; retensi
dipicu → data anonim terverifikasi; consent ditarik → tidak lagi muncul di saran talent
pool; log akses PII bisa diexport.
**Dependensi**: F2 (consent capture) & seluruh fase data.

### Backlog (belum dijadwalkan — XL / butuh prasyarat eksternal)

| Item | Prasyarat |
|---|---|
| Engine psikotest online (DISC/Papikostik/WPT/Kraepelin/MSDT + proctoring) | Keputusan bisnis + review privasi kamera |
| Portal self-service pelamar (akun + status + upload mandiri) | Volume pelamar membenarkan; setelah F9 |
| Multi-posting job board (Glints/Kalibrr/JobStreet/LinkedIn) | API partner; fondasi feed F7 |
| WhatsApp Business API (notif + apply) | Akses API resmi |
| Referral engine berinsentif (matriks bonus IDR + milestone) | Kebijakan kompensasi klien |
| Video interview (live + one-way async) | Integrasi Zoom/Meet + storage |
| Assessment adapter eksternal (psikometrik/coding) | Partner |
| Career site builder no-code penuh (SEO, tema) | Setelah section publik F2 terbukti |
| Internal mobility marketplace (fit score + manager consent) | Data historis + A2 |
| Attrition prediction & offer acceptance ML (A2/B7) | Data historis 12+ bln (MetricSnapshot) |
| Budget guardrail blocking real-time (A5) | Kebijakan keuangan klien |
| Automated test suite (unit/E2E Playwright) di lingkungan engineering produksi | Di sandbox diganti protokol verifikasi §8 |

### Register keputusan (default pasca-kombinasi — user dapat mengubah sebelum/di antara fase)

| ID | Keputusan | Default | Alasan kombinasi |
|---|---|---|---|
| D1 | Portal publik sejak awal? | **Ya, versi minimal di F2** (form staging), versi penuh backlog | HRX P3 "candidate = customer" mengangkat prioritas; analisa semula menaruhnya di P5 demi keamanan → kompromi: form anonim + staging + verifikasi manual (aman), bukan portal akun |
| D2 | Anggaran rekrutmen di fase berapa? | Field di PR sejak F1; pelacakan & rekap di F5 | Nilai bisnis alur inti dulu (analisa), data tetap tertangkap sejak awal (HRX A5) |
| D3 | Kandidat internal masuk? | **Ya, F3** | Rekomendasi analisa + selaras HRX A4 internal-first; modal Employee sudah ada |
| D4 | Pola manpower plan? | Ringkas 6–8 kolom + rekonsiliasi otomatis (F5) | 24-kolom oranHR overkill (analisa §3.10) |
| D5 | Psikotest online? | **Tidak** (backlog) | Analisa §3.10 + HRX juga menyerahkannya ke adapter eksternal (D5) |
| D6 | E-signature? | Ringkas OTP + typed di F7 (bukan F4) | Jangan menunda inti alur; HRX E2 tetap tercakup |
| D7 | AI bila model tidak tersedia? | Mode `simulated` berlabel + fallback manual penuh | HRX P1/P2 + aturan agen §2.4 |
| D8 | Automated tests? | Sandbox: protokol verifikasi §8 (E2E browser + lint terdokumentasi); suite otomatis = backlog engineering | Aturan lingkungan proyek; niat HRX (≥80% coverage) dicatat sebagai standar produksi |

---

## 8. QUALITY GATES (SETIAP FASE WAJIB LOLOS)

1. **Lint 0 error** (`bun run lint`) — termasuk aturan Next.js.
2. **E2E browser terdokumentasi**: golden path per fase dijalankan via agent-browser,
   langkah + hasil + screenshot dicatat di `worklog.md`; dev.log diperiksa bersih dari
   error runtime/hidrasi.
3. **Migrasi additive & reversibel**: `db push` + dump cadangan sebelum perubahan skema
   besar; tidak ada kolom destructif tanpa rencana rollback.
4. **Isolasi tenant terverifikasi**: data rekrutmen MII tidak terlihat dari tenant lain
   (uji silang akun demo Cahaya/Sentra).
5. **Seed demo realistis dwibahasa**: data Indonesia (nama, IDR, Jakarta/Bandung/Surabaya,
   sumber Glints/Kalibrr/referal) yang membuat seluruh alur fase tersebut dapat didemokan
   end-to-end.
6. **i18n 100%**: semua label baru `BASE_EN` + `t()`; tidak ada teks hardcode.
7. **AI fallback**: setiap fitur AI punya jalur manual yang setara; mode simulasi berlabel
   eksplisit (D7).
8. **UI konsisten**: dialog `sm:max-w-*`, sticky footer, list + quick sheet pattern,
   advance search `&`, responsive mobile, empty state bermakna.
9. **Tidak merusak daftar "Aman"** audit keamanan (isolasi multi-tenant, sesi HMAC+MFA,
   MIME whitelist, enkripsi field, dll.) — regressed = fase belum selesai.
10. **Commit + push per fase** + entri `worklog.md` (protokol proyek).
11. *(Standar produksi, di luar sandbox)*: unit test ≥80% service / ≥90% jalur kritis,
    E2E Playwright per modul, README per modul — dicatat sebagai backlog engineering (D8).

---

## 9. ATURAN KERJA AGENT (GABUNGAN HRX + PROTOKOL PROYEK)

1. **Berpikir dulu**: sebelum tiap fase, sajikan ringkasan desain + rencana file (apa yang
   akan dibuat/diubah) → tunggu **"GO"** user. Jangan mulai schema sebelum disetujui.
2. Bertanya hanya bila terblokir keputusan produk sungguhan; selain itu buat asumsi pasar
   Indonesia yang masuk akal dan **catat** di Lampiran A dokumen ini + worklog.
3. Semua AI lewat `ai-provider.ts`; tidak ada dependensi vendor langsung di komponen;
   mode simulasi diberi label.
4. Tidak ada secrets di kode — via env/vault (konvensi proyek).
5. Bila ambigu, pilih opsi yang meningkatkan **fairness, privasi, dan pengalaman kandidat**.
6. **Sources of truth**: dokumen ini (rencana) · `ANALISA-RECRUITMENT.md` (bukti & detail
   teknis) · `PRD-HR-BASE.md` (konteks platform) · `worklog.md` (riwayat eksekusi).
7. **Runnable di akhir setiap fase** — tidak ada "big-bang dump"; demo-able.
8. Aturan emas proyek tetap: push otomatis tiap selesai perubahan; maks 2 subagent paralel
   berat (OOM guard); enkripsi hanya di batas serializer; ActivityLog di semua mutasi;
   error map 403/409 konsisten.
9. Selama fase berjalan, perubahan scope (tambah/lesi item) wajib dicatat sebagai amandemen
   di §3/§7 dokumen ini — matriks jejak adalah kontrak kelengkapan.

---

## 10. RISIKO & MITIGASI LINTAS FASE

| Risiko | Mitigasi |
|---|---|
| PII pelamar (UU PDP 27/2022): data pihak ketiga — consent, retensi, akses | Consent versioned sejak input (F2), enkripsi field-crypto + masking per role, retention + anonimisasi (F9), log akses PII, blacklist wajib alasan |
| Upload berbahaya (CV/ijazah) | Pattern EmployeeDocument: whitelist MIME + magic number + ukuran maks + anti-virus opsional |
| Spam/abuse form publik (F2) | Rate-limit per IP (hash), honeypot, captcha ringan, staging + verifikasi manual sebelum jadi Applicant |
| Bias & tanggung jawab hukum AI (F6) | Explainable wajib (P2), human-in-the-loop untuk semua keputusan, knockout hanya untuk pertanyaan objektif, blind screening toggle, adverse-impact dashboard (F8), audit log |
| AI jadi titik tunggal kegagalan | Fallback manual penuh di semua fitur; mode simulated berlabel; batas kuota + cache |
| Scope creep psikotest / portal pelamar / WhatsApp | Semua di backlog dengan prasyarat jelas (§7); tidak boleh menyusup ke F0–F5 |
| Kualitas data pelamar → karyawan | Prefill wizard onboarding + validasi + cek duplikat (nama/telepon/email) sebelum create Employee |
| Sinkronisasi ganda appointment ↔ onboarding | Wizard dipanggil mode prefill-readonly untuk field rekrutmen; backlink `employeeId` + status `Employed` transaksional |
| Performa list pelamar besar | Index (status, keepOnFileUntil, source) + server-side pagination + FTS terindeks (pola existing) |
| Konsistensi dwibahasa | `BASE_EN` + `t()` sejak baris pertama; gate lint review label baru |
| E-sign belum setara TTE bersertifikat (aspek hukum) | F7 = OTP + typed + audit (internal use); klausul opsi tanda tangan basah/TTE eksternal; backlog TTE tersertifikasi |
| Kalender sync / OAuth eksternal | Opsional di F7 — tidak boleh menunda fase; backlog bila kredensial tak tersedia |

---

## 11. DEFINITION OF DONE (END-TO-END, SELURUH F0–F9)

> Adaptasi §11 master prompt HRX ke konteks RekanKerja:

Seorang recruiter dapat: menyusun rencana kebutuhan ringkas → mengajukan PR → mendapatkan
approval berjenjang → mempublikasikan lowongan (lowongan internal ESS + halaman publik) →
menerima lamaran (form publik anonim ter-verifikasi staging, input manual, referal, dan
kandidat internal) → mengelola talent pool dengan pencarian multi-dimensi → melihat
kandidat ter-rank dengan skor explainable (dengan fallback manual penuh) → menjalankan
seleksi terstruktur dengan scorecard, SLA, dan kanban → mengirim offer terlacak yang
disetujui sesuai matriks approval → meng-convert kandidat yang menerima menjadi karyawan
melalui wizard onboarding **tanpa input ulang** → sampai PR otomatis Fulfilled, biaya
terekonsiliasi ke anggaran, dan seluruh perjalanan ter-audit, ter-notifikasi, ter-pantau
SLA, dan ter-analisa di dashboard — dalam Bahasa Indonesia maupun Inggris, di desktop
maupun mobile, dengan hak kandidat atas datanya (akses/hapus/retensi) terpenuhi sesuai
UU PDP No. 27/2022.

---

## LAMPIRAN A — ASUMSI (dicatat, dapat direvisi user)

1. Mata uang IDR; gaji bulanan; format tanggal & angka mengikuti locale Indonesia.
2. Kanal lamaran awal: form publik + input manual + referal karyawan + kandidat internal;
   job board eksternal dicatat sebagai metode/cost (bukan integrasi) sampai backlog dibuka.
3. WhatsApp Business API tidak tersedia di lingkungan saat ini → notifikasi email otomatis
   + template teks WA yang bisa dikirim manual recruiter.
4. AI memakai `ai-provider.ts` (z-ai-web-dev-sdk, server-side). Bila kuota/model bermasalah
   → mode `simulated` berlabel + jalur manual; tidak pernah memalsukan hasil AI.
5. E-sign ringkas (OTP email + typed signature) untuk keperluan internal; kekuatan hukum
   formal mengikuti kebijakan klien (opsi TTE eksternal).
6. Pelamar tidak punya akun di sistem (F0–F9) — identitas via email + nomor lamaran;
   portal pelamar = backlog.
7. Sub-periode perencanaan mengikuti pola oranHR (`2026`, `2026-B`) — string bebas.
8. Dalam sandbox, verifikasi kualitas = protokol §8 (E2E browser terdokumentasi + lint);
   suite tes otomatis = standar engineering produksi (backlog D8).

## LAMPIRAN B — RUJUKAN ARTEFAK

- `ANALISA-RECRUITMENT.md` — analisa lengkap modul Recruitment oranHR (60 halaman, data
  model inferensi §3, workflow §4, gap §6, skema dasar §7, bukti eksplorasi §11).
- `upload/Recruitment.md` — master prompt HRX-RECRUIT asli (sumber kedua dokumen ini).
- `.tmp-research/rec-*.png` (30 screenshot), `.tmp-research/rec-data/*.json` (50 ekstraksi
  store ExtJS), `.tmp-research/vlm-*.json` — bukti eksplorasi oranHR.
- `PRD-HR-BASE.md` — konteks platform HR Base (master Employee/Position/Org/Approval).
- `DEPLOY-RUNBOOK.md` — prosedur deploy & pemulihan lingkungan.
- `worklog.md` — riwayat eksekusi (protokol pencatatan per fase).

---

*Dokumen final ini disusun sebagai hasil kombinasi eksplisit kedua sumber (analisa oranHR +
master prompt HRX-Recruit) atas permintaan user. Tidak ada baris kode aplikasi RekanKerja
yang diubah dalam pembuatannya. Eksekusi dimulai dari F0 setelah "GO".*
