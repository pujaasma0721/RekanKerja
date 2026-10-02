# BPA TRAVEL ADVANCE — Audit Menyeluruh Modul Travel + Benchmark Pasar + Gap Analysis + Roadmap "Advance & Smart"

**Task 97** · 2 Oktober 2026 · RekanKerja (workspace demo: PT Mitra Industri Internasional)
Mandat user: *"Audit menyeluruh module travel, explore advance module travel di pasaran dan temukan gap dengan aplikasi ini — saya ingin module travel ini lebih advance dan smart."*

Dokumen ini penerus `audit/BPA-travel.md` (audit bisnis proses lama, mayoritas temuan K/M sudah ditutup oleh 24-FIX-TRAVEL / T3-TRAVEL / T15 / T16) dan `ANALISA-TRAVEL.md` (spesifikasi padanan oranHR).

---

## 0. RINGKASAN EKSEKUTIF

**Metodologi 3 jalur paralel:**
1. **Audit kode** menyeluruh (2-a): 19 file modul `src/rekankerja/travel/` (±5.700 baris) + sisi ESS + integrasi (approval-engine, payroll, jurnal, notifikasi, webhook, attachment, vault) + 11 model Prisma.
2. **Riset pasar** (2-b): 10 vendor global (SAP Concur, TravelPerk/Perk, Navan, Egencia, Rydoo, ITILITE, Emburse, Expensify Travel, Deem/Coupa, TravelBank) + konteks Indonesia (Traveloka for Corporates, tiket.com corporate, Mekari Expense) + regulasi SBI (PMK 32/2025, PMK 54/2026) — semua dengan sumber URL.
3. **Walkthrough UI live** (3): 21 screenshot + analisis VLM pada sesi admin (8 view) + ESS + responsif 375px.

**Skor kematangan modul travel saat ini (0–5):**

| Dimensi | Skor | Catatan singkat |
|---|---|---|
| Alur uang (approval → settlement → jurnal → payroll) | **4,5** | Engine settlement server-otoritatif + jurnal balanced + UTRP/TRVSTLIN di payslip + storno — **lebih dalam dari mayoritas vendor travel global** |
| Advance (uang muka) & lifecycle | **4,0** | Requested → Given → Void + netting otomatis (b)/(c) |
| Keamanan uang | **4,0** | Enkripsi 9 kolom + Brankas Uang + money-view gating (1 inkonsistensi tersisa, lihat F0-5) |
| Policy engine | **2,0** | Limit statis per jenis + rule diferensiasi per parameter karyawan (Task 33) — tapi tanpa per-unit (hari/km), tanpa tarif per kota/grade SBI, tanpa enforcement saat pengajuan |
| Self-service ESS | **2,0** | Hanya klaim; TIDAK ADA pengajuan dinas dari ESS; TIDAK ADA upload kwitansi ESS |
| Analytics | **2,0** | Laporan statis + CSV export; tanpa tren, aging SLA, burn-rate, compliance rate |
| Expense capture | **1,5** | Lampiran kwitansi manual admin-only; tanpa OCR, tanpa feed kartu |
| Duty of care | **0,5** | SLA reminder 3 hari saja; tanpa pelacakan traveler |
| Booking & inventori | **0** | Tidak ada (semua vendor benchmark punya) |
| AI / smart | **0** | Nol — padahal infrastruktur AI per-tenant + KB RAG + chat widget sudah tersedia dari Task 96 |

**Vonis:** Modul travel RekanKerja adalah **"settlement engine back-office yang solid — tetapi BUKAN modul travel modern"**. Kuat di keuangan/disiplin uang (moat yang tidak dimiliki vendor travel global yang berhenti di reimbursement), lemah di pengalaman pengguna dan kecerdasan. Kata VLM atas form pengajuan: *"seperti lembar kerja Excel yang dipindahkan ke web"* — skor 6/10 vs standar Concur/Traveloka Bisnis.

**Lima gap terbesar (urut dampak):**
1. **Tidak ada per-diem/policy engine pintar** — semua nominal manual; pasar: per diem otomatis dari data trip (Perk/Rydoo/Mekari), limit dinamis per grade/rute/kota (Navan), tarif resmi SBI per kota (PMK 32/2025: uang harian Rp 360–580 rb/hari, Jakarta Rp 530 rb, hotel Rp 2,14–9,3 jt/malam per kelas jabatan).
2. **Tidak ada pengajuan dinis dari ESS** (web & mobile stub) + **tidak ada upload kwitansi di ESS** — karyawan menyimpan struk di ponsel tapi harus menyerahkan fisik ke HR (VLM: *critical issue* — audit trail hilang, risiko fraud, re-work Finance).
3. **Nol fitur AI/smart** — padahal asisten agentic jadi standar industri 2025-2026 (Joule/Concur, Ava/Navan, Juno/Perk, Iris/ITILITE) dan infra AI RekanKerja sendiri sudah siap (Task 96).
4. **Tidak ada analytics cerdas** — tanpa tren spend, compliance rate, benchmark hemat, burn-rate budget (ITILITE Mastermind, Navan Ava sebagai "data analyst").
5. **Booking & integrasi eksturnal nol** — tanpa inventori, tanpa API OTA lokal (Traveloka Business & tiket.com corporate menawarkan policy-compliant booking + cost center + API), tanpa kartu korporat/virtual card.

**Temuan kritis yang langsung diperbaiki di task ini (Fase 0):** lihat §2.3 — termasuk 1 P0 crash yang membuat view Klaim & Settlement **tidak bisa dipakai sama sekali** saat Brankas Uang tertutup (kondisi default).

---

## 1. AUDIT INTERNAL — HASIL

### 1.1 Peta modul (dari audit kode 2-a)

**Lokasi:** `src/rekankerja/travel/` — services (travel-service.ts 1.628 baris), api (7 route), components (11 file UI). Sisi ESS: `ess/api/claims-travel.ts` + dialog di `ess-claims.tsx`.

**Model data (schema-tenant.prisma, 11 model):** TravelZone, TravelTemplate (settlementDay/metode), TravelExpenseType (kind GENERAL/ALLOWANCE/MILEAGE/ENTERTAINMENT, limit, needDocs) + TravelExpenseTypeRule (rule limit Task 33), TravelBudget + Item (per cost center), TravelRequest + TravelDestination (multi-kaki, zona, overseas) + TravelAdvance (Requested/Given/Void), TravelClaim + TravelClaimExpense. Approval generik: ApprovalStructure/Level/Chain/Step (docType `Travel` nominal=advance, `TravelClaim` nominal=totalSettlement, jenjang nominal min/max, 6 dimensi penempatan, delegasi, anti-deadlock).

**Alur uang end-to-end (kekuatan utama):**
```
Request (destinasi multi-kaki + advance Requested)
 → ApprovalChain "Travel" (mis. MII: atasan → FIN ≥15jt → HRD ≥50jt)
 → Approved: advance cair (Given) | Rejected/Cancelled: advance Void
 → Klaim settlement (admin / ESS): baris biaya per jenis
    R = Σbiaya + rugi kurs − (a) pihak lain
    (b) = max(0, R − advance)  → dibayar karyawan (UTRP)
    (c) = max(0, advance − R) → kasbon kembali (TRVSTLIN)
 → ApprovalChain "TravelClaim" → approve final: jurnal otomatis (D 5105, C 2101=b, D 2105=c, C 1101; invarian D=C)
 → Transfer ke period payroll (atomik, idempoten) → confirmRun → Paid terverifikasi payslip
```
Guard menyeluruh: satu klaim aktif per request (K-2), tolak cancel bila ada klaim aktif (M-2), expenseDate dalam rentang trip, guard period Confirmed (M-4), 409/409/403 ramah, notifikasi 6 event email + in-app + 2 webhook + SLA reminder.

**Inkonsistensi kode** (catatan kecil): field `currency` (TravelExpenseType/TravelBudget) dan `creditAccount`/`compWageCode` master = field setengah-mati (tersimpan, tak pernah dipakai jurnal); folder duplikat legacy `src/components/rekankerja/travel/` masih ada di samping `src/rekankerja/travel/components/` (dead code — kandidat pembersihan).

### 1.2 Kekuatan yang harus dipertahankan (moat)

1. **Loop payroll tertutup** — klaim benar-benar masuk payslip (UTRP earning / TRVSTLIN deduction) dengan verifikasi markTravelPaidForRun; vendor travel global berhenti di reimbursement/expense.
2. **Formula settlement server-otoritatif T3-TRAVEL** — (b)/(c) dihitung server, input klien diabaikan; mutual-eksklusif by construction.
3. **Jurnal otomatis balanced** per jenis biaya + kontra (a) + kliring payroll yang net-0 lintas klaim↔run (fix audit 40).
4. **Enkripsi uang (M-8) + Brankas Uang (45-b)** — 9 kolom terenkripsi; masking per aktor; ESS advance dimask.
5. **Approval engine generik** — bukan hardcode: 6 dimensi penempatan, jenjang nominal, delegasi TemporaryApprover, backfill legacy, 409/403.
6. **Rule diferensiasi limit per parameter karyawan (Task 33)** — fondasi menuju policy engine v2.
7. **Disiplin i18n, menu-perm granular (op cancel/approve/transfer per pengguna), ActivityLog, money-vault aware CSV export.**

### 1.3 Temuan bug — status perbaikan Task 97

| # | Prioritas | Temuan (file:baris pra-fix) | Status |
|---|---|---|---|
| B1 | **P0** | **View Klaim & Settlement crash total saat Brankas Uang tertutup (kondisi default)** — `fmtIDRShort(null)` → `null.toLocaleString` TypeError (travel-types.ts:157, dipanggil travel-claims.tsx:335); seluruh halaman error boundary; ditemukan walkthrough, reproduksi 3× | ✅ **FIX** — formatter null-safe (`—`), + `subMoney()` helper; browser baru: 0 error, 5 klaim render |
| B2 | **P1** | **Klaim mandiri selalu dibuat untuk karyawan pertama** (travel-claims.tsx:206 — tanpa picker; temuan lama Task 88 yang belum ditutup) | ✅ **FIX** — combobox "Karyawan Penerima Klaim" + validasi wajib; terverifikasi dropdown 44 karyawan |
| B3 | **P1** | **Tombol Batal permintaan men-trigger PATCH destruktif tanpa konfirmasi** (travel-requests.tsx:116-124; dikonfirmasi live walkthrough: TR-2026-004 tercancel sekali klik) | ✅ **FIX** — AlertDialog konfirmasi + busy-guard; terverifikasi: dialog muncul, dismiss aman, konfirmasi → PATCH |
| B4 | **P1** | **GET /api/rekankerja/travel/requests hanya requireTenant** (requests.ts:14) — anggota tenant tanpa menu travel (termasuk sesi ESS) bisa membaca semua permintaan + stats.advanceTotal | ✅ **FIX** — `requireMenuViewAny([travel-request, travel-approval, travel-claim])`; terverifikasi ESS → 403, endpoint ESS sah tetap 200 |
| B5 | **P1** | **Agregat uang stats menyesatkan saat vault tertutup** — `?? 0` → KPI claim-approval tampil "Rp 0" padahal disembunyikan | ✅ **FIX** — stats nullable + "—" di UI; label "tanpa muka" → "muka tersembunyi" saat masked |
| B6 | P2 | Limit dicek per TOTAL baris, bukan per unit (qty hari/km) — travel-service.ts:692; overLimit tidak dihitung ulang saat master berubah | 📋 backlog (F1-1) |
| B7 | P2 | Jenis biaya L-\*/O-\* tidak difilter per destinasi (trip domestik bisa pakai jenis overseas) | 📋 backlog (F1-1) |
| B8 | P2 | Semantik KPI: `requestsThisMonth` tanpa batas atas; `claimsYtd` menghitung semua status + masa depan | 📋 backlog (F0-8) |
| B9 | P2 | nextDocNo max-suffix race-prone (dua POST paralel → 500) | 📋 backlog (F0-8) |
| B10 | P2 | Gating vault inkonsisten antar view: claims (dulu crash) vs claim-approval (dulu "Rp 0") vs **overview/budget/reports (uang ASLI tampil walau vault tertutup)** | 📋 backlog (F0-5) — bug fix parsial task ini menyeragamkan claims + claim-approval |
| B11 | P2 | `TravelClaimExpense.claimId`, `TravelRequest.employeeId/status`, `TravelClaim.employeeId/status/requestId/periodCode` dll **tanpa @@index** (index-sweep Task 42 melewatkan travel) — Seq Scan saat data tumbuh; semua list tanpa pagination | 📋 backlog (F0-7) |
| B12 | P3 | `detailApi` dobel fetch penuh untuk refresh; ternary `totalAdvance` selalu-true; tap target 28px; row expand tanpa keyboard | 📋 backlog |

**Bukti verifikasi task ini:** lint 0 error · `tsc --noEmit` 0 error · dev.log bersih · browser frasa: view klaim render "—" + "muka tersembunyi" (0 error konsol di browser baru), dialog mandiri menampilkan picker, TR-2026-007 uji dibuat → konfirmasi Batal muncul → cancel sukses, ESS yusuf → 403 endpoint admin (dulu bocor) + 200 endpoint sah. Screenshot: `/tmp/travel-audit-fix/`.

### 1.4 Temuan UX (walkthrough + VLM)

**Kekuatan:** konsistensi shell/navigasi/i18n; KPI klik-able deep-link; tabel kaya konteks (badge status + catatan approver + "KLAIM ✓"); kartu approval berjenjang; responsif 375px solid (0 overflow).

**Kelemahan (urut dampak):**
1. Form panjang 100% manual tanpa bantuan — tanpa estimasi biaya, tanpa hint kebijakan real-time, tanpa smart defaults (VLM: 6/10 "Excel moved to web"; bandingkan Concur/Traveloka Bisnis: policy hint saat memilih, budget preview).
2. ESS tidak bisa upload kwitansi (VLM: *critical* — "operational nightmare" bagi Finance; audit trail hilang, risiko fraud, re-work).
3. Kartu aksi approval tampil juga untuk item yang menunggu approver lain (kejelasan peran).
4. Dashboard minim tindak lanjut — alert "Uang Muka Beredar Rp 43 jt" tanpa CTA; tanpa aging/SLA/tren/burn-rate.
5. Empty state ESS klaim travel informatif tapi alur mati di situ (tidak bisa ajukan dinis).

---

## 2. BENCHMARK PASAR (ringkas — detail sumber di riset 2-b)

### 2.1 Vendor global — fitur "advanced & smart" pembeda

| Vendor | Pemembeda kunci (2025-2026) | Harga (jika dipublikasikan) |
|---|---|---|
| **SAP Concur** | AI agents: Booking/Meeting Planning/Receipt Analysis/Expense Validation/**Approval Management Agent** (soroti pengajuan high-risk + reasoning); **AI generator policy rule dari dokumen**; TripLink (tangkap booking off-channel/leakage); Detect fraud; duty of care; ESG | request pricing |
| **TravelPerk → Perk** | AI-native; **policy diterapkan di SETAPAK booking→expense**; **per diem otomatis dari data booking**; "expenses that submit themselves" (auto-capture/match/code); **MCP: booking via Claude/ChatGPT**; FlexiPerk refund; kartu diblokir sampai struk dilampirkan | Starter $0 (5 booking/bln + 5%/booking); Pro $299/bln + 3% |
| **Navan** | **Ava agentic assistant** (54% tiket support selesai AI; zero critical hallucinations); **Travel Policy Agent — limit dinamis dari data pasar real-time + reward hemat**; Checkout AI (split booking); **Voice/Waiver Agent (AI menelepon hotel)**; fraud detection menyapu 100% transaksi; Navan Rewards; virtual card | Travel gratis; Expense $15/user/bln |
| **Egencia (Amex GBT)** | Egencia AI asisten percakapan ask-book-manage; agentic di Teams + Concur; booking via Claude; re-price hotel pasca-booking | — |
| **Rydoo** | Mobile-first scan OCR real-time (4,9★ App Store); **per diem + mileage + angka pajak 80+ negara tertanam** | Essentials €10/user/bln |
| **ITILITE** | **Mastermind** — benchmark program T&E antar perusahaan + estimasi penghematan + rekomendasi; Iris (NL Q&A); **Voice AI booking & expense**; approval via link dgn harga real-time; $10/trip | $10/trip/traveler + $6-9/user/bln |
| **Emburse** | AI agent yang "mengerjakan expense otomatis"; **ISO/IEC 42001** (AI governance); anti-fraud | — |
| **Expensify** | SmartScan; booking in-app; **Trip Rooms** (chat per trip) | Collect $5/member/bln |
| **Deem (Coupa)** | Etta; Google ITA; **Pre-trip approval — review 100% booking tapi hanya perlu aksi yang out-of-policy**; Deem Ground | — |
| **TravelBank** | Booking dengan **custom budgets & approvals** per trip; policy validation + pre-set spend limits | — |

### 2.2 Konteks Indonesia

- **Traveloka for Corporates**: self-booking + **built-in approval system** + policy per role/level/divisi + dashboard compliance + **API integration** + invoicing. URL: corporates.ctv.traveloka.com.
- **tiket.com corporate**: **Policy-Compliant Bookings** (smart approval + real-time budget tracking), **customizable cost centers** per cabang, ISO 27001/27701, 1300+ perusahaan. URL: tiket.com/id-id/corporate/solution.
- **Mekari Expense** (kompetitor paling langsung): fitur **Business Trip end-to-end** — request → multi-level approval → cash advance → **per diem otomatis (set harian dari durasi/frekuensi/lokasi)** → laporan + struk digital → settlement advance → disbursement, **multi-destination policy per grade/posisi/tim/tujuan**, refund sisa advance otomatis, OCR AI, **Fraud AI Checker**, kartu Limitless, integrasi Jurnal + KlikPajak. URL: expense.mekari.com/en/feature/business-trip.
- **HRIS lokal lain (Gadjian/GajiHub/Talenta entry)**: payroll-first, **tidak ada modul perjalanan dinas** → **white space produk** untuk RekanKerja.

### 2.3 Regulasi — SBI untuk per-diem siap-pakai

**PMK 32/2025** (SBM TA 2026; digantikan sebagian oleh **PMK 54/2026** tentang uang harian & representasi — per 22 Juli 2026, nominal detail PMK 32 masih acuan liputan):
- Uang harian domestik **Rp 360.000–580.000/hari** (Jakarta Rp 530.000; Papua Rp 580.000); multi-tujuan 1 kota → 60% + transport lokal riil.
- Uang harian luar negeri **US$347–792/hari** per negara & jabatan.
- Hotel dalam negeri **Rp 2,14–9,3 jt/malam** per kelas jabatan; tiket domestik maks Rp 11,46 jt (ekonomi) / Rp 22,1 jt (bisnis).
- Transport lokal bandara Rp 94–462 rb.
- PPN: reimbursement bisa dikreditkan bila **faktur atas nama perusahaan** (bukan karyawan) → relevan untuk flag e-Faktur per baris biaya + fitur "faktur perusahaan" di form klaim (klikpajak.id).

### 2.4 Tren 2025-2026 yang membentuk ekspektasi pengguna
Agentic AI jadi standar (90% travel manager sudah pakai AI); MCP memindahkan aksi travel ke asisten pihak ketiga; policy engine berbasis data pasar real-time (limit dinamis + reward hemat); AI fraud menyapu 100% transaksi + tantangan struk sintetis AI; virtual card sebagai kontrol PRE-spend; CO₂ tracking per trip bawaan; voice booking.

---

## 3. ANALISIS GAP — MATRIKS KAPABILITAS

Skala: ✅ ada & kuat · 🟡 parsial/lemah · ❌ tidak ada. Prioritas: dampak×efort relatif terhadap posisi produk (HR SaaS multi-tenant Indonesia).

| Kapabilitas (grup benchmark A-J) | RekanKerja kini | Standar pasar | Best-in-class | Prioritas |
|---|---|---|---|---|
| A. Booking & inventori | ❌ | Self-booking in-policy (semua vendor) | Perk MCP / Concur TripLink leakage | F3 (partnership) |
| B. Policy engine real-time | 🟡 limit statis + rule Task 33; tanpa per-unit/dinamis/SBI | Limit per grade/rute + badge in/out-of-policy saat isi | Navan limit dinamis data pasar + reward | **F1 (inti)** |
| C. Approval workflow | ✅ generik multi-jenjang + nominal + delegasi | + auto-approve in-policy, approval via link | Concur AI sorot high-risk + reasoning | F2 (AI layer) |
| D. Advance & settlement | ✅ lifecycle + netting b/c + payroll | + per diem otomatis, virtual card, auto-clearing | Perk per-diem dari data booking; Mekari refund otomatis | **F1 (per diem)** |
| E. Expense capture | 🟡 lampiran manual admin-only | OCR struk + e-receipt + kartu feed | Perk "expenses submit themselves"; Rydoo 80+ negara rates | **F1 (ESS upload) → F2 (OCR)** |
| F. Duty of care | 🟡 SLA reminder saja | Pelacakan traveler + alert + check-in | ITILITE live tracking; Concur monitoring destinasi | F3 (ringan) |
| G. Analytics | 🟡 laporan statis + CSV | Spend dashboard + compliance + savings | ITILITE Mastermind benchmark; Navan "Ava analyst" | **F2** |
| H. AI & smart | ❌ (infra siap dari Task 96) | Chat assistant policy/data; smart approval | Joule/Ava/Juno/Iris agentic; fraud AI | **F2 (inti)** |
| I. Integrasi | 🟡 payroll+jurnal (kuat, moat); tanpa ERP eksternal/kartu/e-Faktur | HRIS+ERP+GL mapping | Concur VAT reclaim; Mekari Jurnal+KlikPajak | F1 (e-Faktur flag) → F3 |
| J. Employee experience | 🟡 ESS klaim saja; mobile stub dinas | Mobile-first + WhatsApp + chat approval | Rydoo 4,9★; Expensify Trip Rooms | **F1 (ESS ajukan + upload)** |

**Kesimpulan gap:** RekanKerja unggul di C/D/I-payroll (yang justru TIDAK dimiliki vendor travel murni), tetapi tertinggal jauh di B/E/H/J — dan semua itu justru yang paling terasa oleh **karyawan dan HR sehari-hari**. Strategi yang disarankan: **bukan mengejar booking (butuh partnership OTA), melainkan memenangkan "policy pintar + self-service penuh + AI" di atas mesin uang yang sudah kelas atas** — kombinasi yang tidak dimiliki siapa pun di pasar lokal (Mekari kuat di expense tapi tak punya payroll+jurnal; Traveloka/tiket kuat di booking tapi tak punya settlement→payslip).

---

## 4. ROADMAP "ADVANCE & SMART"

### Fase 0 — Stabilisasi (task ini; sisa segera)
- [x] **F0-1** Null-safe money formatter + `subMoney` → crash view Klaim & KPI "Rp 0" → "—" (B1, B5) ✅
- [x] **F0-2** Picker karyawan klaim mandiri (B2) ✅
- [x] **F0-3** AlertDialog konfirmasi cancel + busy-guard (B3) ✅
- [x] **F0-4** Menu-guard GET /travel/requests (B4) ✅
- [ ] **F0-5** Unifikasi gating vault: terapkan money-view pada overview/budget/reports (B10) — *effort S*
- [ ] **F0-6** Limit per-unit (qty×nominal vs limit) + filter jenis L-\*/O-\* per zona destinasi (B6, B7) — *S/M*
- [ ] **F0-7** `@@index` tabel travel + pagination list + hapus `detailApi` dobel-fetch (B11, B12) — *S (perlu DDL parity 4 tenant, pola Task 96)*
- [ ] **F0-8** KPI semantik (requestsThisMonth bounded; claimsYtd hanya realisasi) + nextDocNo retry-on-unique (B8, B9) — *S*

### Fase 1 — Fondasi "Advance" (policy & self-service; estimasi 2-4 sprint)
- [ ] **F1-1 Policy engine v2**: upgrade TravelExpenseTypeRule → plafon per **kategori × grade × zona/kota × durasi** dengan satuan per-unit (hari/malam/km); **seed default tarif SBI PMK 32/2025 per kota Indonesia** (uang harian + plafon hotel per kelas jabatan); badge in/out-of-policy REAL-TIME di form (tampil limit efektif pengaju saat memilih jenis — data `effectiveExpenseLimits` sudah ada).
- [ ] **F1-2 Per diem otomatis**: baris ALLOWANCE dihitung otomatis = tarif(kota, grade) × hari trip (aturan full/half day + 60% satu-kota SBI); **estimasi biaya trip** di form pengajuan (hotel × malam × plafon kota, uang harian × hari) → jadi dasar nominal advance yang disarankan (pola Perk/Mekari/Rydoo).
- [ ] **F1-3 Budget check saat pengajuan**: tampilkan sisa budget CC + warning over-budget SEBELUM submit; klaim Approved dihitung sebagai komitmen (fix m-6).
- [ ] **F1-4 Pengajuan dinis dari ESS** (web + buka stub mobile `app_state.dart:926`): form self-service dengan wizard 3 langkah (tujuan → estimasi otomatis F1-2 → advance), approval chain sama, karyawan pantau status — menutup paradigma "HR mengajukan atas nama karyawan".
- [ ] **F1-5 Upload kwitansi ESS**: buka endpoint attachments untuk entityType TravelClaim milik sendiri (guard requireEss + kepemilikan) — menutup temuan VLM "critical".
- [ ] **F1-6 Edit/Return-to-prepare**: revisi permintaan ditolak (ala Concur) + `claimRequestedAt` reset saat klaim ditolak; reversal klaim post-Transferred (storno mirror medical 92).
- [ ] **F1-7 Multi-currency**: kurs per tanggal (rate tenant / manual), jenis biaya O-\* otomatis valas; aktifkan field `currency` yang mati.
- [ ] **F1-8 Flag PPN/e-Faktur per baris biaya** (faktur atas nama perusahaan → input PPN masukan) — nilai tambah akuntansi lokal.

### Fase 2 — "Smart" (AI di atas infra Task 96; 2-3 sprint)
- [ ] **F2-1 Snapshot travel di AI chatbot**: tambah ke `selfDataSnapshot` (ai-chat-service.ts): uang muka beredar + jatuh tempo settlement terdekat + status klaim terakhir → karyawan bisa tanya *"berapa uang muka saya yang belum settle?"* dijawab data nyata (pola saldo cuti Task 96). *Effort S — nilai terbesar per baris kode.*
- [ ] **F2-2 Asisten policy inline**: saat isi form, hint limit efektif + estimasi (F1-2) + jawab "boleh hotel bintang 5?" via rule engine; KB RAG: unggah SOP perjalanan tenant → chatbot jawab "berapa plafon hotel saya ke Jakarta?" (endpoint read-only kecil).
- [ ] **F2-3 OCR kwitansi via VLM**: foto struk → ekstraksi (merchant, tanggal, nominal, jenis) → pre-fill baris klaim + deteksi duplikasi (hash file/nilai+tanggal sama). *Infra z-ai-web-dev-sdk VLM sudah tersedia server-side.*
- [ ] **F2-4 Deteksi anomali pre-approval**: bendera otomatis di kartu approval — klaim vs rata-rata rute/kota sama (data historik TravelClaimExpense), duplikasi, nominal bulat berlebihan, tanggal hari libur — dengan alasan singkat utk approver (ala Concur Approval Management Agent).
- [ ] **F2-5 Analytics pintar**: dashboard tren bulanan (spend per CC/destinasi/jenis), compliance rate (in-policy vs over-limit), aging SLA approval, top traveler, burn-rate budget vs waktu, dan rekomendasi hemat sederhana ("SPD serupa rata-rata Rp X, pengajuan ini +40%").
- [ ] **F2-6 Nudge pintar**: reminder WhatsApp/email sebelum jatuh tempo settlement + eskalasi atasan bila lewat (scheduler sudah ada).

### Fase 3 — Ekosistem (opsional, partnership-dependent)
- [ ] **F3-1 Duty of care ringan**: peta traveler aktif per tanggal + tombol darurat + check-in.
- [ ] **F3-2 Integrasi booking**: API Traveloka for Corporates / tiket.com corporate bila tersedia (policy check di titik booking), atau mode "booking assisted" (HR mengaitkan nomor booking ke destinasi).
- [ ] **F3-3 Kartu korporat/virtual card** (butuh partner bank) → kontrol pre-spend.
- [ ] **F3-4 CO₂ tracking per trip** ( faktor emisi per moda) — tren ESG.
- [ ] **F3-5 Aksi travel via asisten AI (agentic/MCP-style)**: ajukan dinis lewat chat widget Task 96.

**Urutan eksekusi yang disarankan:** F0-5→F0-8 (1 sprint) → **F1-1/F1-2/F1-4/F1-5** (jantung "advance") → **F2-1/F2-3/F2-4** (jantung "smart", memanfaatkan infra AI yang sudah dibayar) → sisanya mengikuti prioritas bisnis tenant.

---

## 5. LAMPIRAN

- Audit kode lengkap: worklog Task 2-a (peta file, model data, endpoint, alur, temuan) · Riset pasar + URL sumber: worklog Task 2-b · Walkthrough UI + 21 screenshot + VLM: worklog Task 3 (/tmp/travel-ui/) · Screenshot bukti fix: /tmp/travel-audit-fix/.
- Dokumen terkait: `audit/BPA-travel.md` (audit lama), `ANALISA-TRAVEL.md` (spesifikasi), worklog Task 96 (infra AI).
- Perubahan kode task ini (7 file): `travel-types.ts` (formatter null-safe + subMoney + tipe nullable), `travel-claims.tsx` (picker mandiri + guard), `travel-requests.tsx` (AlertDialog cancel), `travel/api/requests.ts` (menu guard), `travel/api/claims.ts` (stats nullable), `travel-claim-approval.tsx` (subMoney + tipe), `travel-reports.tsx` (guard nullable).
