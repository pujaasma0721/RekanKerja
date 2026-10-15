# Rencana Pengembangan — EKSEKUSI BACKLOG (Kinerja + Rekrutmen)

> Status: DIJALANKAN atas perintah eksplisit user (2026-10-16): "kerjakan sisa backlog
> diatas exclude jangan dikerjakan poin no 3 (module training)".
>
> Cakupan = backlog yang tercantum di akhir §20 DEVELOPMENT-PLAN-PERFORMANCE.md
> (OKR kuartalan + board transparan · AI ringkasan check-in & deteksi bias bahasa ·
> succession planning di atas 9-box · benchmark gaji) + 9 item strategic-backlog
> rekrutmen hasil audit SB-REC (commit 519c864).
>
> **DIKECUALIKAN atas perintah user: modul Training/pengembangan** — tidak dikerjakan
> sama sekali (termasuk tidak dibangun sebagai bagian succession; "aksi
> pengembangan" di succession = catatan teks terstruktur, bukan modul training).

## 0. Cara Membaca

Dokumen ini = jangkar keputusan + urutan fase untuk pekerjaan backlog. Standar mutu,
protokol worklog, aturan emas (DialogContent `sm:max-w-*`, i18n BASE_EN + t(),
enkripsi field `enc:v1`, ActivityLog, isolasi multi-tenant, push otomatis per fase)
semua MENGACU ke aturan proyek di worklog.md + §21 DEVELOPMENT-PLAN-PERFORMANCE.md —
tidak diulang di sini.

## 1. Batas Eksekusi (apa yang TIDAK dikerjakan & alasannya)

| Item backlog | Keputusan | Alasan |
|---|---|---|
| Modul Training/pengembangan | **EXCLUDE — perintah user** | eksplisit |
| Multi-posting job board | **DEFER** | butuh akun berbayar per job board (prasyarat eksternal SAH — temuan SB-REC) |
| Psikotest online ber-proctoring | **DEFER** | vendor + risiko privasi kamera (temuan SB-REC tetap valid) |
| Video interview platform penuh | **KOMPROMI MICRO** — kolom link meeting di tahap seleksi (XS) | 80% nilai dengan 1% effort |
| Career site builder no-code penuh | **KOMPROMI** — branding config per tenant (logo/warna/hero) (M) | builder penuh L+ tanpa permintaan klien |
| Attrition ML | **DIGANTI heuristik explainable** | data historis < 12 bulan → model ML = plasebo berbahaya; heuristik ala pola F6b (ai-score explainable) |
| Insentif referral otomatis ke payroll | **DEFER** (bisnis) — tracker dibangun, insentif dicatat manual | bloker = keputusan budget, bukan teknis (temuan SB-REC) |
| ML/AI di luar ringkasan+deteksi bias | **DEFER** | sesuai batas D20; ini satu-satunya perluasan AI yang disetujuser |

## 2. Register Keputusan Baru (D-BL1…D-BL18)

| # | Keputusan | Default dipilih |
|---|---|---|
| D-BL1 | OKR = alat transparansi tujuan TERPISAH dari mesin penilaian | TIDAK memengaruhi skor/rating/merit/PIP — board OKR tidak pernah jadi input AppraisalRecord |
| D-BL2 | Ritme OKR | kuartalan (Q1–Q4 per tahun), per-tenant default OFF (`PerformanceSetting.okrEnabled`) |
| D-BL3 | Transparansi board | Objective ber-status `Posted` terlihat SELURUH karyawan (silang-tim, pola Google OKR); `Draft` hanya pemilik + HR |
| D-BL4 | Struktur OKR | Objective (owner karyawan, boleh align ke objective lain → pohon dukungan) + 3–5 KR (baseline/target/current, unit, polarity, confidence R/Y/G) |
| D-BL5 | Skor OKR (server otoritatif) | per KR = clamp((current−baseline)/(target−baseline)) → 0.00–1.00; objective = rata-rata ber-bobot KR; keyResult weight Σ=100 |
| D-BL6 | Ringkasan check-in AI | on-demand (tombol), STATELESS (tidak persist ke domain — hanya ActivityLog audit), menyusun ulang isi check-in SAJA tanpa menambah fakta, dwibahasa ikut UI aktif |
| D-BL7 | Deteksi bias bahasa — 2 titik | (a) penulis: scan SINKRON rule-based lexicon (SARA/sarkasme/serangan pribadi ID+EN) saat submit komentar 360 & ulasan atasan → peringatan ADVISORI, tidak memblokir; (b) HR: antrean moderasi komentar ter-flag → Setujui/Redaksi sebelum tampil ter-agregasi ≥3 |
| D-BL8 | Batas AI backlog ini | ringkasan check-in rate-limit 20/jam/user (pola D20); deep-scan AI oleh HR rate-limit 20/jam/user; rule-based detector = tanpa limit (deterministik, nol biaya) |
| D-BL9 | Flag & audit | semua pemakaian AI ter-ActivityLog `aiSummary`/`aiBiasScan`; komentar 360 ter-flag menyimpan `flaggedJson` (kandidat frasa + alasan) — anonimitas reviewer TETAP utuh (flag di Answer, bukan identitas) |
| D-BL10 | Attrition heuristic — bukan ML | skor 0–100 dari faktor bobot tetap ter-audit: tenure band, tren rating 2 siklus terakhir, PIP aktif/riwayat, kompa-ratio vs midpoint grade, waktu sejak promosi/penyesuaian terakhir, under-performer flag; skor + rincian kontribusi per faktor (explainable); level Rendah/Sedang/Tinggi |
| D-BL11 | Disclaimer attrisi | label eksplisit "heuristik — bukan prediksi ML"; bila data < 2 siklus → tampil "data terbatas" pada faktor yang tak tersedia (faktor dinetralkan, tidak difabrikasi) |
| D-BL12 | Akses attrisi | HR + Direksi + atasan langsung (hanya bawahannya) — pola §11.3; ESS tidak melihat |
| D-BL13 | Succession di atas 9-box | kandidat di-seed dari penempatan 9-box siklus Published terakhir (finalRating × potentialBand); readiness = ReadyNow/Ready1yr/Ready23yr/Development — keputusan MANUAL HR di atas saran sistem |
| D-BL14 | Model succession | per Position (flag peran kritis + target pengisi ≥2 successor) + SuccessorCandidate (karyawan, readiness, flightRisk dari D-BL10, catatan aksi pengembangan TEKS — bukan modul training) |
| D-BL15 | Laporan succession | coverage per peran (punya ≥2 ready), bench strength per unit, kandidat tanpa pengganti; XLSX dwibahasa pola katalog laporan |
| D-BL16 | Benchmark gaji — sumber data | impor manual HR (XLSX ≤500 baris, pratinjau per sel pola D16) + CRUD master: tahun, label sumber, kunci Grade ATAU Position, p25/p50/p75 |
| D-BL17 | Benchmark gaji — kompa-ratio | gaji pokok karyawan vs p50 benchmark (cocokkan grade → position → fallback); nominal gaji tetap vault `enc:v1` → dihitung server-side; tampilan nominal hanya role dengan money-view; ESS TIDAK melihat benchmark |
| D-BL18 | Rumah UI baru | OKR & Talent (succession+attrisi) = tab baru modul Kinerja `performance:okr` + `performance:talent`; benchmark gaji = tab baru modul Payroll `payroll:benchmark`; referral = seksi ESS + register rekrutmen |

## 3. Data Model Baru (schema tenant)

```prisma
// B1 — OKR kuartalan (terpisah dari AppraisalRecord — D-BL1)
model OkrObjective {
  id          String   @id @default(cuid())
  quarter     String   // "2026-Q1" — kuartal, bukan siklus tahunan
  title       String
  ownerEmployeeId String
  alignToId   String?  // pohon dukungan — align ke objective lain
  status      String   @default("Draft") // Draft|Posted|Closed (Close di akhir kuartal)
  weight      Int      @default(100)   // Σ KR = 100 per objective
  closedScore Float?   // skor final 0.00–1.00 saat Closed (server)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  keyResults  OkrKeyResult[]
  alignChildren OkrObjective[] @relation("OkrAlign")
  alignParent   OkrObjective? @relation("OkrAlign", fields: [alignToId], references: [id])
}
model OkrKeyResult {
  id          String  @id @default(cuid())
  objectiveId String
  title       String
  unit        String
  polarity    String  @default("HigherIsBetter")
  baseline    Float
  target      Float
  current     Float   @default(0)
  weight      Int     @default(20)  // Σ per objective = 100
  confidence  String  @default("Yellow") // Red|Yellow|Green — subjektif pemilik, beda dari skor
  note        String? // update progres ringan (bukan check-in formal)
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
// PerformanceSetting + okrEnabled Boolean @default(false)

// B2 — moderasi bias 360 (flag di Answer; anonimitas reviewer utuh — D-BL9)
// Feedback360Answer + flaggedJson String? + moderated String? ("Pending|Approved|Redacted")
//   komentar ter-flag Default-nya "Pending" → HR moderasi; komentar bersih langsung "Approved"

// B3/B4 — attrition (stateless, tidak disimpan skor — dihitung on-demand) +
model SuccessionPosition {
  id         String  @id @default(cuid())
  positionId String  @unique
  critical   Boolean @default(true)
  targetSuccessors Int @default(2)
  note       String?
  updatedAt  DateTime @updatedAt
  candidates SuccessorCandidate[]
}
model SuccessorCandidate {
  id                  String @id @default(cuid())
  successionPositionId String
  employeeId          String
  readiness           String // ReadyNow|Ready1yr|Ready23yr|Development
  suggested9Box       String? // snapshot saran saat ditambahkan (mis. "3.9/5 — High Potential")
  flightRisk          Float?  // skor heuristik saat ditambahkan (refresh on-demand)
  devNotes            String? // aksi pengembangan — TEKS (bukan modul training — D-BL14)
  addedById           String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  @@unique([successionPositionId, employeeId])
}

// B5 — benchmark gaji
model SalaryBenchmark {
  id          String  @id @default(cuid())
  year        Int
  sourceLabel String  // "Survei XX 2026" — sumber manual HR
  gradeCode   String? // kunci A: cocokkan berdasar Grade
  positionId  String? // kunci B: cocokkan berdasar Position (lebih spesifik)
  currency    String  @default("IDR")
  p25 Float
  p50 Float
  p75 Float
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([year, sourceLabel, gradeCode, positionId])
  @@index([year, gradeCode])
}

// B6 — link meeting tahap seleksi
// CandidateSelectionStep + meetingUrl String?

// B7 — branding portal karier per tenant
model CareerSiteConfig {
  id        String  @id @default(cuid())
  tenantSlug String @unique
  brandColor String  @default("#0f766e")
  logoUrl   String?
  heroTitle String?
  heroSub   String?
  updatedAt DateTime @updatedAt
}

// B8 — referral: tanpa model baru (Applicant.referralEmployeeId ada sejak F2) +
//   Applicant + referralNote String?  (konteks/pesan perujuk)
//   insentif = catatan manual HR di ActivityLog + field referralRewardNote String?
```

## 4. Rencana Eksekusi (urutan fase)

| Fase | Isi | Ukuran | Keluaran terverifikasi |
|---|---|---|---|
| **B0** | Dokumen ini (jangkar keputusan) | XS | commit ter-push |
| **B1** | OKR kuartalan + board transparan: schema + setting + service (CRUD objective/KR, skor server D-BL5, close kuartal) + API + UI admin (register kuartal + board + pohon align) + ESS "OKR Saya" + board org-wide Posted + guard visibilitas D-BL3 | L | E2E 2 jalur (HR buat + ESS propose→approval ringan? — tidak: ESS buat objective sendiri langsung Posted? → ESS boleh buat Draft, HR/owner memosting) + board silang-tim + mobile + dwibahasa |
| **B2** | AI ringkasan check-in + deteksi bias: ringkasan on-demand (D-BL6/D-BL8) di dialog check-in atasan + ESS riwayat; lexicon rule-based ID+EN saat submit komentar 360/ulasan (D-BL7a) + antrean moderasi HR di tab 360 (D-BL7b) + flaggedJson + ActivityLog | M–L | E2E: ringkasan konsisten isi (tanpa fakta baru) dwibahasa; lexicon menandai frasa uji (ID+EN) tanpa blokir; moderasi Pending→Approved tampil, Redacted tersensor ter-agregasi; rate-limit 400 |
| **B3** | Heuristik attrisi (D-BL10–12): service explainable + API + tab Talent seksi "Risiko Attrisi" (tabel skor+faktor, filter unit) + disclaimer | M | E2E: skor deterministik dari fixture; rincian faktor Σ kontribusi masuk akal; akses 403 ESS; supervisor hanya tim |
| **B4** | Succession planning (D-BL13–15): 2 model + service (seed saran 9-box + flightRisk refresh) + API + UI tab Talent seksi "Succession" (peran kritis, kandidat, coverage) + laporan XLSX dwibahasa | L | E2E: tambah peran kritis + kandidat dgn saran 9-box tampil; coverage benar; guard duplikat/akses; laporan render |
| **B5** | Benchmark gaji (D-BL16–17): model + impor XLSX pratinjau + CRUD + API + tab Payroll "Benchmark Pasar" (dashboard kompa-ratio + daftar outlier + laporan XLSX) | M | E2E: impor 2 file (valid + baris kotor ditolak per sel); kompa-ratio benar vs fixture; ESS 403; nominal hanya money-view |
| **B6** | Rekrutmen quick wins: WA wiring (wa-defaults template rekrutmen + sendWa fire-and-forget di titik notifyEmailEvent rekrutmen + pastikan WaTemplate row per tenant) + meetingUrl tahap seleksi (field + UI + placeholder {{linkMeeting}} di email/WA undangan) | S | E2E: template WA ter-seed & aktif; panggilan sendWa ter-log WaLog (provider sandbox skip tenang); meetingUrl tersimpan & muncul di undangan |
| **B7** | Portal pelamar: magic-link status lamaran (token HMAC expired + rate-limit email; tanpa password — D-…) + branding CareerSiteConfig (logo/warna/hero per tenant) | M | E2E portal: minta link → email terkirim (smtp-catcher) → buka link → status pipeline + dokumen; branding berubah per tenant; link kedaluwarsa ditolak |
| **B8** | Referral tracker: ESS "Referral Saya" (riwayat status lamaran yg dirujuk) + register HR (filter, referralRewardNote manual, ActivityLog) + kolom perujuk di pelamar | M | E2E: ESS lihat referral + status; HR catat insentif manual ter-audit; 403 lintas tenant |
| **B9** | Agregator `bun run test:e2e`: runner urut suite + ringkasan per-suite + `--reset` fixture (restore-demo + migrasi) + daftar suite stabil | S–M | menjalankan agregator pada subset suite → ringkasan benar; README cara pakai |
| **BF** | Verifikasi silang menyeluruh + overview 10/10→N/N + push final | S | browser dwibahasa + mobile + console 0 |

Aturan per fase (tanpa kecuali): tsc scoped 0 error · lint 0 error (warning baseline 6)
· audit-bilingual TOTAL_GAP tidak naik dari 150 · migrasi idempoten 3 tenant + tenant-ddl.sql
· E2E script PASS · browser EN+ID + mobile 375 hscroll=0 + console 0 · ActivityLog · commit + push.

## 5. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Board OKR dianggap penilaian → politik | D-BL1 dijaga keras: tidak ada kolom OKR di AppraisalRecord; label "tujuan, bukan penilaian" |
| Ringkasan AI mengarang fakta | prompt compose-only + validasi output vs input (frasa angka/fakta baru → dibuang, fallback "tidak dapat diringkas") |
| Lexicon bias terlalu agresif → komentar sehat ter-flag | advisori saja di penulis + antrean HR sebagai penjaga akhir (Approve cepat) + lexicon versi-able di kode, mudah disetel |
| Attrition heuristic disalahartikan prediksi pasti | label + disclaimer D-BL11; rincian faktor selalu tampil bersama skor |
| Benchmark bocor ke karyawan | ESS 403; nominal hanya money-view grant; laporan hanya HR/Direksi |
| WA spam pelamar | hanya event transaksional penting (undangan/offer/OTP? — bukan OTP), aktif default per template, WaLog semua kirim |
| Magic-link jadi vektor enumerasi email | respons netral sama untuk email ada/tidak; rate-limit per IP+email; token expired 6 jam sekali-pakai |
| Insentif referral disalahpahami otomatis | UI tegas "catatan manual — di luar payroll" |

## 6. Selesai

Setelah B9: backlog Kinerja tersisa SATU item yang sengaja tidak dikerjakan (Training —
perintah user), dan backlog Rekrutmen tersisa item yang terblokir eksternal murni
(multi-posting, psikotest proctoring, video platform, ML attrition 12-bulan,
insentif otomatis, builder no-code penuh). Semua punya trigger pembuka objektif yang
tercatat di SB-REC + §1 dokumen ini.
