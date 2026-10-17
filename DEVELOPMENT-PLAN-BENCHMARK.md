# Rencana Pengembangan — MENUTUP GAP BENCHMARK TIER-1 HCM (P1–P4)

> **Status: DOKUMEN MURNI — BELUM ADA PERUBAHAN KODE APLIKASI.**
>
> Asal-usul: permintaan user (IM trace `1a149527ff8cd529`) — "buat dokumen:
> (a) simpan analisa ini sebagai dokumen BENCHMARK-HCM-GAP.md di repo,
> (b) turunkan P1–P4 menjadi development plan terstruktur per fase ala
> DEVELOPMENT-PLAN-*.md".
>
> Turunan langsung: `BENCHMARK-HCM-GAP.md` §5 (gap lintas-modul) + §7 (arah roadmap)
> — audit 6 agent (BENCH-1..6) + audit internal Performance. Semua item di bawah
> dipetakan balik ke gap benchmark yang ditutupnya.
>
> **Urutan eksekusi = P1 → P2 → P3; P4 = register DEFER (tidak dijadwalkan,
> trigger objektif tercatat).** Setiap fase commit + push terpisah.

---

## 0. Cara Membaca

Dokumen ini = jangkar keputusan + urutan fase. Standar mutu, protokol worklog, aturan
emas (DialogContent `sm:max-w-*`, i18n BASE_EN + `t()`, enkripsi field `enc:v1`,
ActivityLog, isolasi multi-tenant, push otomatis per fase) MENGACU ke aturan proyek di
worklog.md + §21 DEVELOPMENT-PLAN-PERFORMANCE.md — tidak diulang di sini.

**Notasi ukuran:** XS (<½ hari) · S (½–1 hari) · M (1–3 hari) · L (3–7 hari) · XL (>1 minggu).

## 1. Batas Eksekusi (apa yang TIDAK dikerjakan & alasannya)

| Item benchmark | Keputusan | Alasan |
|---|---|---|
| **Modul Training/Learning/LMS** | **EXCLUDE — perintah user berdiri, permanen** | perintah eksplisit berulang; "aksi pengembangan" karier = teks terstruktur (konsisten D-BL14), BUKAN modul training |
| Multi-posting job board (Glints/Kalibrr/LinkedIn) | **DEFER** | prasyarat akun berbayar per board (temuan SB-RC tetap valid) — trigger: akun tersedia |
| Integrasi API BPJS langsung | **DEFER** | kredensial/kemitraan resmi — yang dikerjakan: format file LKS resmi (P2) |
| SSO/SAML/SCIM | **DEFER** | butuh IdP tenant nyata — trigger: tenant enterprise pertama meminta |
| eSign tersertifikasi (BSrE/Privy/Vida) | **DEFER** | partner tersertifikasi (biaya + kontrak) — in-house hash-chain tetap dipakai |
| Multi-currency / expat / KITAS / global org | **DEFER** | keputusan strategis produk (single-country IDR by design) — trigger: arah regional |
| WFM forecasting / schedule optimization | **DEFER** | butuh strategi produk + data historis — trigger: segmen manufaktur/retail jadi mayoritas pipeline |
| Redis / multi-node / horizontal scale | **DEFER** | keputusan infra — single-node terdokumentasi ±30 tenant/node masih memadai |
| BPM designer no-code penuh | **DEFER** | P2 escalation + P3 lanjutan approval engine menutup 80% kebutuhan nyata |
| Marketplace / app store / OData / GraphQL | **DEFER** | belum ada permintaan klien |
| Psikotest proctoring / video interview platform | **DEFER** | vendor + privasi kamera (SB-REC tetap valid) |
| AI transaksional ("approve this") | **DEFER** | risiko keputusan otomatis — RAG read-only tetap batas D20 |

## 2. Register Keputusan (D-BM1…D-BM28)

### P1 — Quick Wins

| # | Keputusan | Default dipilih |
|---|---|---|
| D-BM1 | Edit profil ESS = **pengajuan perubahan data** (bukan tulis langsung) | whitelist field pribadi non-master (alamat, telepon, email pribadi, kontak darurat, status pernikahan→picu PTKP note); field gaji/organisasi/kepegawaian TETAP hanya via PersonnelAction; status Submitted→Approved/Rejected + ActivityLog; HR apply patch (before/after tersimpan) |
| D-BM2 | Kontak darurat | model `EmergencyContact` (relasi Employee, 1–N, tipe+prioritas+hubungan); tampil di wizard langkah personal + ESS profil + detail HR |
| D-BM3 | Validasi NPWP | format 15/16 digit + digit-check modulus (DJP); advisori saat simpan (tidak memblokir data lama); normalisasi otomatis `npwp15()` di input |
| D-BM4 | NIK anggota keluarga | `EmployeeFamily.nationalId` terenkripsi `enc:v1` — OPSIONAL, fondasi enrollment BPJS family (P2) |
| D-BM5 | Lampiran cuti | relasi `LeaveRequest`↔`Attachment` (reuse attachment-service); `LeaveType.needDocs` → **blokir submit tanpa lampiran** (konfigurabel per tenant, default blokir); catatan + riwayat lampiran di UI approval |
| D-BM6 | Upload struk klaim medis ESS | ESS endpoint unggah struk (≤2MB, MIME whitelist JPG/PNG/PDF — pola travel); deklarasi tetap ada; HR verifikasi lihat lampiran |
| D-BM7 | Regularisasi absensi mandiri | model `AttendanceRegularizationRequest` (karyawan ajukan clock-in/out hilang/salah + alasan wajib + lampiran opsional) → approval chain docType baru `AttendanceReg` → auto-apply `override-daily` + regen + ActivityLog; cap 4 request aktif/bulan/karyawan |
| D-BM8 | Approval chain payroll run | docType `PayrollRunConfirm` di approval-engine (confirm = butuh chain bila template aktif per tenant); **default OFF** (backward-compat — tenant kecil tetap 1-klik); ActivityLog tercatat approver |
| D-BM9 | Simulasi THP | endpoint stateless (input komponen + status PTKP + NPWP → output estimasi via engine TER + Pasal 17 yang sama); UI di modul Payroll + ESS "Simulasi Gaji"; label "estimasi simulasi"; tidak persist domain (ActivityLog saja); data upah sendiri bisa dipakai sbg prefill ESS |
| D-BM10 | Format bank korporat | template export per bank (BCA/Mandiri/BNI + generik) dengan konfigurasi kolom + format tanggal/nomor — konfigurasi KODE (bukan DB) + pilihan saat export run |
| D-BM11 | Export jurnal GL | format CSV per target: Accurate · Jurnal.id · generik (mapping kolom template); dari layar jurnal existing |
| D-BM12 | Dataset kalender libur nasional | **bundled seed** per tahun (kompilasi resmi pemerintah/SKB, di-update saat rilis) + tombol impor per tenant; TANPA auto-fetch (tidak ada feed resmi stabil) |
| D-BM13 | Premi malam → payroll | komponen upah opsional `NIGHT_PREM` (formula dari jam malam AttendanceDaily, ambang 22:00–06:00, per jam proporsional 1/173 basis BASE); aktif per tenant |
| D-BM14 | Reminder settlement travel | scheduler job D+N (default H+3 lewat `settlementDay`) → email/WA ke pelaku perjalanan + atasan; idempoten advisory-lock |
| D-BM15 | Referral otomatis | ESS form ajukan referral (nama+email+WA kandidat+lowongan+pesan) → staging HR (verifikasi ala public staging ringan) → catat di Applicant; register HR + kolom perujuk (sudah ada) + reward = catatan manual ter-audit (insentif payroll otomatis TETAP di luar scope — keputusan bisnis, konsisten SB-RC) |

### P2 — Pasar Indonesia

| # | Keputusan | Default dipilih |
|---|---|---|
| D-BM16 | File LKS BPJS resmi | format resmi LKS JKN + TK (kolom lengkap termasuk KODE KANTOR & KELAS dari config tenant; family NIK dari D-BM4); export dari laporan BPJS existing |
| D-BM17 | Web push notification | model `PushSubscription` (endpoint+keys terenkripsi); opt-in per user (pengaturan notifikasi); event = approval masuk + pengumuman + nudge scheduler; fallback tenang bila browser tak dukung |
| D-BM18 | Panel interview + self-schedule | `CandidateSelectionStep` multi-evaluator (1–N, scorecard per evaluator existing + panel view + divergence flag existing); slot waktu yang HR buka → kandidat pilih via link token portal (HMAC, expired); undangan email + **lampiran .ics** |
| D-BM19 | Offer versioning + self-service | model `CandidateOfferVersion` (riwayat draft→counter→final; diff nominal vault-gated); portal kandidat: **accept/decline sendiri** ter-audit (status race-guard: hanya offer aktif; HR dashboard notifikasi) |
| D-BM20 | Benefits administration grup | model `InsurancePolicy` (perusahaan+polis+periode+premi+pct split) + `PolicyMember` (enrollment karyawan+dependen, effective dating, terminasi otomatis saat karyawan keluar); laporan premi vs payroll + renewal reminder |
| D-BM21 | Escalation approval engine | per-template: auto-escalate ke atasan approver setelah X hari (default off; X konfigurabel) + auto-remind; scheduler job; ActivityLog jejak eskalasi |
| D-BM22 | Konektor akuntansi | export-only (D-BM11); API live Accurate/Jurnal = DEFER (trigger: permintaan klien + akun) |

### P3 — Paritas Enterprise

| # | Keputusan | Default dipilih |
|---|---|---|
| D-BM23 | Job architecture | model `JobFamily` (tree 2-level) + `Job` diperluas jadi job profile (mission/duties/qualifications/syarat pendidikan/kondisi kerja) + `Position` kualifikasi; backfill `Job.category` → JobFamily; **non-effective-dated dulu** (trade-off dicatat — upgrade kemudian bila butuh reorg historis) |
| D-BM24 | Skills foundation | model `SkillCatalog` lintas-modul + `EmployeeSkill` (level 1–5 + evidence + tanggal) + requirement di JobProfile; recruitment `Skill` (applicant) dijembatani via label match saat staging → employee |
| D-BM25 | Manager workspace | tab ESS "Tim Saya": headcount tim, kehadiran 7-hari, siapa cuti, approval menunggu, anniversary/PHK-mendatang, tenure — read-only agregat + tombol approve (reuse action inbox); akses = atasan langsung (pola access-scope existing) |
| D-BM26 | Analytics pivot + terjadwal | report-builder + agregasi (group by + Σ/avg/count) + pivot 2-dimensi sederhana + **scheduled delivery** (email XLSX periodik per saved report, pola digest rekrutmen); take-cap eksplisit + indikator terpotong |
| D-BM27 | Career pathing | jalur karier dari JobFamily graph (posisi → posisi berikutnya, syarat skills dari D-BM24); development actions = **teks terstruktur** di succession (KONSISTEN D-BL14 — bukan modul training); tampilan "jalur karier saya" di ESS |
| D-BM28 | Learning/LMS | **EXCLUDE — permanen atas perintah user** (dicatat ulang di sini agar tidak terbawa biasa roadmap benchmark) |

## 3. Data Model Baru (sketsa — final saat implementasi)

```prisma
// P1.1 — fondasi data karyawan
model EmergencyContact {
  id          String  @id @default(cuid())
  employeeId  String
  name        String
  relationship String  // lookup: Pasangan|Anak|Orang tua|Saudara|Lainnya
  phone       String  @encrypted
  address     String?
  isPrimary   Boolean @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
model EmployeeProfileChangeRequest {
  id          String  @id @default(cuid())
  employeeId  String
  fieldsJson  String  // whitelisted: [{field, before, after}]
  status      String  @default("Submitted") // Submitted|Approved|Rejected
  reason      String?
  decidedById String?
  decidedAt   DateTime?
  createdAt   DateTime @default(now())
  // ActivityLog: entity "profileChange" + aksi submit/approve/reject
}
// EmployeeFamily + nationalId String? @encrypted  (D-BM4)

// P1.2 — lampiran (relasi ke Attachment existing, tanpa model baru)
//   LeaveRequest.attachmentIds Json?  /  MedicalClaim.attachmentIds Json?

// P1.3 — regularisasi absensi
model AttendanceRegularizationRequest {
  id          String   @id @default(cuid())
  employeeId  String
  date        DateTime
  clockIn     String?  // HH:mm
  clockOut    String?
  kind        String   // MissingPunch|WrongTime|ForgotClock
  reason      String   // wajib ≥10 kar
  attachmentIds Json?
  status      String   @default("Submitted") // Submitted|Approved|Rejected|Cancelled
  createdAt   DateTime @default(now())
  // approve → override-daily + regen (reuse) + ActivityLog
}

// P1.4 — approval payroll (reuse ApprovalChain docType "PayrollRunConfirm", tanpa model baru)

// P2.2 — web push
model PushSubscription {
  id        String   @id @default(cuid())
  appUserId String
  endpoint  String   @encrypted
  p256dh    String   @encrypted
  auth      String   @encrypted
  createdAt DateTime @default(now())
  @@unique([appUserId, endpoint])
}

// P2.4 — offer versioning
model CandidateOfferVersion {
  id        String   @id @default(cuid())
  offerId   String
  versionNo Int
  payloadJson String  // snapshot + diff vs sebelumnya; nominal vault enc:v1
  createdById String
  createdAt DateTime @default(now())
  @@unique([offerId, versionNo])
}

// P2.5 — benefits administration grup
model InsurancePolicy {
  id         String   @id @default(cuid())
  providerId String   // MedicalProvider kind=INSURANCE
  policyNo   String
  periodStart DateTime
  periodEnd  DateTime
  premiumMonthly Float @encrypted
  pctCompany Float    @default(100)
  status     String   @default("Active") // Active|Expired|Terminated
  createdAt  DateTime @default(now())
}
model PolicyMember {
  id         String   @id @default(cuid())
  policyId   String
  employeeId String
  dependentId String?  // EmployeeFamily opsional
  effectiveFrom DateTime
  effectiveTo  DateTime?
  createdAt  DateTime @default(now())
  @@unique([policyId, employeeId, dependentId, effectiveFrom])
}

// P3.1/P3.2 — job architecture & skills
model JobFamily {
  id        String  @id @default(cuid())
  code      String  @unique
  name      String
  parentId  String?  // tree 2-level
  createdAt DateTime @default(now())
}
// Job + familyId?, mission?, dutiesJson?, qualificationsJson?, minEducation?, workingConditions?
// Position + requiredSkillsJson? (SkillCatalog refs)
model SkillCatalog {
  id       String  @id @default(cuid())
  code     String  @unique
  name     String
  category String?
}
model EmployeeSkill {
  id          String   @id @default(cuid())
  employeeId  String
  skillId     String
  level       Int      // 1–5
  evidence    String?
  assessedAt  DateTime @default(now())
  @@unique([employeeId, skillId])
}

// P3.5 — career path
model CareerPath {
  id          String  @id @default(cuid())
  fromPositionId String
  toPositionId   String
  requiredSkillsJson String? // SkillCatalog refs + level
  note        String?
  @@unique([fromPositionId, toPositionId])
}
```

## 4. Rencana Eksekusi

### Fase P1 — Quick Wins Paritas Internal & Table Stakes

| Fase | Isi (register) | Ukuran | Gap benchmark yang ditutup | Keluaran terverifikasi |
|---|---|---|---|---|
| **P1.1** | Fondasi data karyawan & ESS: EmergencyContact (D-BM2) · pengajuan edit profil ESS + approval (D-BM1) · validasi NPWP (D-BM3) · NIK keluarga (D-BM4) | M–L | HR §4.1 gap-7 (emergency contact, ESS read-only) | E2E: ajukan ubah alamat → HR approve → ter-apply + before/after di ActivityLog; field master (jabatan/gaji) ditolak 400; wizard & ESS tampil kontak darurat; NPWP salah digit → advisori |
| **P1.2** | Lampiran & bukti: lampiran cuti + gate needDocs (D-BM5) · upload struk klaim medis ESS (D-BM6) | S–M | T&A §4.3 gap-5; Medical §4.4 paritas internal | E2E: cuti sakit tanpa SKD → 400; dengan SKD → approve → lampiran terlihat approver; ESS unggah struk 2MB ok / 5MB 413; MIME salah 400 |
| **P1.3** | Regularisasi absensi mandiri (D-BM7) | M | T&A §4.3 gap-4 | E2E: karyawan ajukan lupa absen → chain approve → AttendanceDaily ter-regen + ActivityLog; >4 aktif/bulan → 429; approver lihat bukti |
| **P1.4** | Kontrol & simulasi payroll: approval chain confirm (D-BM8) · simulasi THP (D-BM9) · format bank korporat (D-BM10) · export GL Accurate/Jurnal/generik (D-BM11) | M | Payroll §4.2 gap-1/6/9 | E2E: tenant template aktif → confirm butuh chain; OFF → 1-klik tetap; simulasi TER vs engine sama senInstant; export BCA kolom benar; GL Accurate CSV lolos import dry-run |
| **P1.5** | Kalender, premi malam, reminder: dataset libur nasional bundled + impor (D-BM12) · NIGHT_PREM (D-BM13) · reminder settlement travel (D-BM14) | S–M | T&A §4.3 gap-3 (libur); §4.3 gap-8 (premi malam); Travel §4.4 gap-4 | E2E: impor dataset 2027 → holiday overlay menang atas siklus; premi malam terhitung di run fixture; reminder terkirim H+3 (EmailLog) |
| **P1.6** | Referral otomatis (D-BM15) | M | Recruitment §4.5 gap-5 | E2E: ESS ajukan referral → staging HR → verifikasi → Applicant tercatat perujuk; reward note ter-ActivityLog; 403 lintas tenant |

### Fase P2 — Kebutuhan Pasar Indonesia (menang head-to-head vs Talenta)

| Fase | Isi (register) | Ukuran | Gap benchmark | Keluaran terverifikasi |
|---|---|---|---|---|
| **P2.1** | File LKS BPJS resmi (D-BM16) | M | §5 gap-3 (parsial) | E2E: export LKS JKN+TK kolom resmi terisi (KODE KANTOR/KELAS dari config); family tanpa NIK → baris family dilewati + laporan gap |
| **P2.2** | Web push (D-BM17) | M | §5 gap-8 (parsial) | E2E: subscribe → event approval → push diterima (test harness); opt-out berhenti; keys terenkripsi at-rest |
| **P2.3** | Panel interview + self-schedule + .ics (D-BM18) | L | Recruitment §4.5 gap-2 | E2E: 3 evaluator → scorecard masing-masing + divergence flag; kandidat pilih slot via token → terkunci; undangan email memuat .ics valid (parse) |
| **P2.4** | Offer versioning + self-service kandidat (D-BM19) | M–L | Recruitment §4.5 gap-6/7 | E2E: counter → versi 2 + diff nominal (vault); kandidat accept di portal → status + HR dashboard ter-update; race double-click → 409 |
| **P2.5** | Benefits administration grup (D-BM20) | L | §5 gap-5 | E2E: buat polis + enroll karyawan+dependen → laporan premi; karyawan terminasi → membership berakhir otomatis; renewal reminder H-30 |
| **P2.6** | Escalation approval engine (D-BM21) | S–M | §5 gap-9 (parsial) | E2E: template X=3 hari → hari ke-4 eskalasi ke atasan approver + ActivityLog; default off tidak mengubah perilaku |

### Fase P3 — Paritas Enterprise Tier-1

| Fase | Isi (register) | Ukuran | Gap benchmark | Keluaran terverifikasi |
|---|---|---|---|---|
| **P3.1** | Job architecture (D-BM23) | L | §5 gap-2 (parsial job) | E2E: buat family tree + job profile lengkap; backfill category → family; posisi menautkan kualifikasi; laporan struktur jabatan baru |
| **P3.2** | Skills foundation (D-BM24) — setelah P3.1 | M | §5 gap-2 (skills) | E2E: katalog + level karyawan + requirement job profile → gap analysis "kandidat internal memenuhi X dari Y skill"; jembatan applicant skill → employee skill saat appoint |
| **P3.3** | Manager workspace "Tim Saya" (D-BM25) | M | §5 gap-6 | E2E: atasan lihat headcount/kehadiran/cuti/approval tim; non-atasan 403; approve dari workspace jalan; mobile 375 |
| **P3.4** | Analytics pivot + scheduled delivery (D-BM26) | L | §5 gap-7 (parsial) | E2E: saved report group-by unit + Σ gaji (vault) benar vs SQL manual; jadwal harian → email XLSX terkirim (smtp-catcher); indikator terpotong saat >cap |
| **P3.5** | Career pathing teks terstruktur (D-BM27) — setelah P3.1/P3.2 | S–M | Performance §4.6 gap-1 (parsial, tanpa LMS) | E2E: jalur posisi→posisi + syarat skill; ESS "jalur karier saya" tampil; development action di succession ter-struktur (bukan modul training) |

> **P3 YANG DIKECUALIKAN:** Learning/LMS (D-BM28) — perintah user permanen.
> SSO/OIDC — DEFER trigger IdP. Lihat §1.

### Fase P4 — Ekspansi Skala (register DEFER, tidak dijadwalkan)

| Item | Trigger pembuka objektif |
|---|---|
| Multi-currency / expat / KITAS / global org | keputusan strategis produk (arah regional) |
| WFM forecasting & schedule optimization | segmen manufaktur/retail jadi mayoritas pipeline + data historis ≥ 12 bulan |
| Redis / multi-node | > 25 tenant aktif ATAU pain operasional single-node nyata |
| BPM designer no-code | permintaan tenant dengan proses non-standar berulang |
| Multiposting job board | akun berbayar per board tersedia (Glints/Kalibrr/LinkedIn) |
| API BPJS langsung | kredensial/kemitraan BPJS resmi |
| SSO/SAML/SCIM penuh | tenant enterprise pertama dengan IdP sendiri |
| eSign BSrE via partner (Privy/Vida) | kontrak partner tersertifikasi |
| AI transaksional ("approve this") | keputusan risiko + guardrails disetujui pemilik produk |
| Marketplace / OData / GraphQL | permintaan klien berulang |

### Aturan per fase (tanpa kecuali)

tsc scoped 0 error · lint 0 error (warning baseline 6) · audit-bilingual TOTAL_GAP
tidak naik dari 150 · migrasi idempoten 3 tenant + `tenant-ddl.sql` disinkron ·
E2E script PASS · browser EN+ID + mobile 375 hscroll=0 + console 0 · ActivityLog di
semua mutasi · commit + push per fase.

## 5. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Edit profil ESS dipakai bypass PA | whitelist ketat D-BM1; field master (jabatan/gaji/status) ditolak 400 + arahan ke PA; before/after ter-audit |
| Regularisasi absensi disalahgunakan (rekayasa kehadiran) | cap 4/bulan + alasan wajib + approval chain + ActivityLog + bukti opsional |
| Approval payroll menambah deadlock (approver libur) | default OFF; fallback chain engine (manager→Admin/HR) tetap berlaku; delegasi TemporaryApprover tersedia |
| Simulasi THA dianggap janji gaji | label "estimasi simulasi" menonjol; tidak persist; disclaimer bawah hasil |
| Lampiran jadi vektor malware | reuse attachment-service (2MB + MIME whitelist + magic-number check — sudah teruji travel) |
| Push notification dianggap spam | opt-in per user + per-event; hingga 3 event inti; opt-out 1 klik |
| Offer self-service race (double-accept / expire bersamaan) | race-guard status 409 + expiry scheduler existing menang; versi terkunci saat Posted |
| Benefits admin scope creep jadi klaim asuransi penuh | D-BM20 = administrasi polis + enrollment + laporan premi SAJA; adjudikasi klaim tetangga tetap di engine reimbursement existing |
| Job architecture migration merusak data lama | backfill non-destruktif (category → family baru "Lainnya"); field baru nullable; laporan lama tetap jalan |
| Pivot builder membocorkan gaji | agregasi tetap lewat money-vault gate; kolom nominal hanya role money-view; take-cap eksplisit + indikator terpotong |
| Career pathing dianggap awal modul training | D-BM27 eksplisit teks terstruktur; boundary dijaga seperti D-BL14; tidak ada tabel kursus/sesi/e-learning |

## 6. Selesai

Setelah P3.5: gap benchmark tier-1 yang tersisa adalah item P4 yang seluruhnya
terblokir prasyarat eksternal / strategis — masing-masing punya trigger pembuka
objektif yang tercatat di §4-P4, sehingga setiap kapan pun prasyarat terpenuhi,
pekerjaan bisa dijadwalkan tanpa audit ulang dari nol.

**Dua hal yang sengaja tidak berubah:** (1) modul Training tetap tidak dibangun
(perintah user permanen); (2) kedalaman regulasi Indonesia (moat §6 BENCHMARK-HCM-GAP)
dijaga — tidak ada fase yang boleh melemahkan mesin statutori yang sudah benar.
