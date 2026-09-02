# AUDIT BISNIS PROSES — MODUL HUMAN RESOURCE (OneVity HRIS)

**Task ID:** 24-a · **Tanggal:** 2026-02 · **Metode:** statis (16 api + 1 service + komponen HR + prisma/schema-tenant.prisma + PRD-HR-BASE.md) + probing runtime GET-only (tenant MII).
**Scope:** proses bisnis (bukan gaya kode). Temuan struktur F-01..F-12 (Task 23, commit ec82d9f) sudah diperbaiki dan TIDAK dilaporkan ulang.

---

## 1. RINGKASAN

Modul HR OneVity merekonstruksi 4 proses inti oranHR: (1) onboarding 4-langkah, (2) master organisasi/posisi, (3) Personnel Action multi-layer approval, (4) catatan disiplin. Fondasi data **baik**: seluruh data pekerjaan hidup di `EmployeeAssignment` berperiode (`validTo null` = aktif), perubahan tercatat sebagai riwayat dengan `changeReason` + `sourceDocNo` — pola ini sehat.

Namun audit proses menemukan **3 temuan KRITIS**:

1. **K-01 — "Process" PA tidak menerapkan perubahan posisi/grade/unit.** Dialog create PA menyimpan **kode** (`toPosition:"P-SUP"`, `toUnit:"QAD"`, `newGrade:"G3"`) di `detailJson`, sedangkan handler process membaca **`detail.positionId/orgUnitId/gradeId` (ID)** yang tidak pernah ada → Promosi/Demosi/Transfer hanya mengubah gaji (bila diisi); **Mutation & Demotion-tanpa-gaji = no-op total**. Terverifikasi di data live: PA-2026-0004 (Transfer, **Processed**) — karyawan Yusuf Rahayu masih di unit `MII-HRD-RC`/`P-RCT`, tanpa baris riwayat `sourceDocNo=PA-2026-0004`.
2. **K-02 — Seluruh efek PA/terminasi non-transaksional.** `applyAssignmentChange` (tutup assignment lama → buka baru) dan terminasi (update Employee → close assignment) berjalan sebagai 2–4 query terpisah **tanpa `$transaction`** (0 kemunculan di seluruh modul HR). Kegagalan di tengah meninggalkan karyawan tanpa assignment aktif / status berubah tanpa assignment tertutup, dan PA tetap `Approved` sehingga bisa diproses ulang.
3. **K-03 — Maker = checker + aktor hard-coded `"MII000001"`.** Semua layer approval PA di-set `approverId = creator`; guard keputusan memakai `appUser.findFirst({username:"MII000001"})` (bukan session user). Pemegang dokumen dapat menyetujui sendiri 3 layernya; di tenant lain (Cahaya: 0 AppUser) `me=null` → guard approve **di-skip total**.

Ditambah 6 MAJOR (bypass PA via Edit Info Pekerjaan + field `status` silent no-op; `lastDay` diabaikan saat terminasi; 5 tipe PA tanpa efek; guard approve race-prone; validasi aturan inti hilang; prefix employeeNo hard-coded "MII"), 9 MINOR, 8 GAP vs PRD.

Dari 12 tipe PA, efek `process` nyata: **3 tipe penuh** (SalaryAdjustment, ChangeStatus, Resignation/Termination—parsial tanggal), **3 tipe gaji-saja**, **6 tipe no-op** (Hire, Mutation, ContractRenewal, ExtendProbation, Demotion/Promotion tanpa gaji, Retirement≈Resign).

---

## 2. PETA PROSES AS-IS

### 2.1 Siklus hidup karyawan

| # | Langkah | Aktor | Sistem / file | State hasil |
|---|---------|-------|---------------|-------------|
| 1 | Onboarding wizard 4 langkah (Personal → Pekerjaan → Upah&Bank → Review) | HR Staff | `components/employee/employee-wizard.tsx` → POST `/api/onevity/employees` | `Employee` (status **Active**, `employeeNo` auto `MIIxxxxx`) + `EmployeeAssignment` (`changeReason:"Initial"`, `validFrom=joinDate`, `validTo=null`) + ActivityLog. Draft di-localStorage. **3 create tanpa transaksi.** |
| 2 | Status karyawan = `Employee.status` (Active/Resigned/Terminated/Blacklisted) — **bukan** dihitung dari assignment. Tampilan aktif = `status==="Active"`. | — | `api/employees.ts` (filter/statusAgg) | |
| 3 | Perubahan pekerjaan **jalur A (resmi)**: Personnel Action → approve → process → `applyAssignmentChange` (tutup lama `validTo=eff`, buka baru `validFrom=eff`) / terminasi (set status+endDate, close assignment). | HR + Approver | `api/personnel-actions*.ts`, `services/assignment.ts` | lihat §3 |
| 4 | Perubahan pekerjaan **jalur B (bypass)**: dialog "Edit Info Pekerjaan" PATCH `/api/onevity/employee-detail` → `applyAssignmentChange` dengan `reason:"ManualEdit"`, `effectiveDate = new Date()` (backdate tidak mungkin). Field `status` yang dikirim dialog **diabaikan server** (tidak ada di `PERSONAL_FIELDS`). | HR | `components/employee/detail-dialogs.tsx:252-263`, `api/employee-detail.ts:128-158` | riwayat baru ManualEdit |
| 5 | Terminasi hanya via PA Resignation/Termination/Retirement (process). Tidak ada endpoint DELETE employee. | HR + Approver | `api/personnel-actions-detail.ts:174-184` | `status` non-aktif, `endDate=effectiveDate` (**`lastDay` diabaikan**), assignment ditutup |
| 6 | Probation/kontrak: hanya `employmentStatus` pada assignment; **tidak ada field tanggal berakhir** → expiry tidak terlacak. | — | schema | |

### 2.2 Personnel Action (PA) — alur lengkap

1. **Create** (POST `personnel-actions`): validasi hanya `employeeId`+`type`. docNo `PA-YYYY-NNNN` dari max-suffix. Layers dari template `AT-PA-STD` (3 layer: Dept Head → HR Manager → HR Director) — **semua layer `approverId = me.id` (pembuat)**. Status `Prepared`.
2. **Detail dinamis per tipe** (`pa-create-dialog.tsx TYPE_FIELDS`): posisi/unit/grade dipilih dari **posisi yang sedang dipegang karyawan aktif** (opsi berasal dari `employees?status=Active`, bukan master posisi — posisi lowong tidak bisa dipilih), nilai yang disimpan = **kode**.
3. **Submit** (PATCH `action:"submit"`): guard `status==="Prepared"` → `Submitted`, `currentLayer=1`.
4. **Approve/Reject** (PATCH): guard `status==="Submitted"` + ada layer Pending. Cek approver lemah (K-03). Approve → layer `Approved`, `currentLayer++`; layer terakhir → PA `Approved`. Reject → layer `Rejected`, PA `Rejected` (terminal).
5. **Process** (PATCH `action:"process"`): guard `status==="Approved"` (idempoten: setelah sukses → `Processed`, tak bisa diproses ulang). Efek per tipe — lihat §3 & matriks §4. **Tanpa transaksi.**
6. **Cancel**: guard hanya menolak `Processed` → `Cancelled` (layer tidak di-reset).
7. **Return to draft**: hanya dari `Rejected/Cancelled` → semua layer di-reset `Pending`, `currentLayer=0` → `Prepared` (dokumen bisa diedit ulang via PATCH `action:"update"` — hanya saat `Prepared`).
8. **Delete**: hanya `Prepared/Cancelled`.
9. Inbox approval (`?mine=1`): filter dokumen `Submitted` yang layer Pending-nya `approverId === MII000001.id` atau aktor role Admin — **hard-coded**.

### 2.3 Struktur organisasi & posisi

- Company (single per tenant schema; PATCH profil saja) → OrgUnit (tree `parentId`, `level` dihitung saat create; PATCH tidak bisa memindah parent → restukturisasi = delete+create) → Position (`reportsTo` tree, `headcount`, grade) → Job/Grade master.
- Guard DELETE: **Position** = blokir jika ada assignment (semua riwayat) atau posisi anak — bagus. **OrgUnit** = blokir hanya sub-unit/assignment **aktif**/posisi → riwayat historis `SetNull` (jejak hilang). **Grade** = blokir hanya assignment aktif + posisi. **Job** = blokir jika dipakai posisi.
- Kapasitas: `headcount` vs `filled` = hitungan assignment aktif (kolom DB `Position.filled` tidak pernah disinkronkan oleh API — seed-only). Over-capacity tidak divalidasi di mana pun (live: P-ACC headcount 1, filled 2). org-map membatasi tampilan `filled=min(headcount,aktual)` → kelebihan kapasitas tersembunyi.
- org-map konsisten memakai assignment aktif (`people`, vacancies, `monthlyCost`, span-of-control).

### 2.4 Disciplinary

POST/GET/DELETE `api/disciplinary.ts` + dialog. Murni catatan: `warningLevel` bebas (Verbal|Written|Final — bisa langsung Final tanpa SP1/SP2), `expiresAt` hanya ikon kedaluwarsa di tabel, **tidak ada** efek status karyawan, noPromote, eskalasi ke PA Termination, atau blacklist.

### 2.5 employee-detail (agregasi)

GET menggabungkan personal + assignment aktif (flatten) + riwayat lengkap + family/education/experiences/disciplinary/actions + directReports (via `managerId` assignment aktif) — **konsisten** dengan endpoint CRUD masing-masing (urutan & data sama). PATCH = edit personal + (jalur bypass) pekerjaan.

---

## 3. STATE MACHINE PA (as-implemented)

| From | Event | Guard nyata | To | Efek samping / catatan |
|------|-------|-------------|----|------------------------|
| — | create | `employeeId`,`type` wajib; karyawan harus ada (status TIDAK dicek) | **Prepared** | 3 layer approval dibuat, approverId = pembuat; detailJson tersimpan |
| Prepared | update | `status==="Prepared"` | Prepared | reason/effectiveDate/detailJson bisa diedit bebas (tanpa validasi tanggal) |
| Prepared | submit | `status==="Prepared"` | **Submitted** | submittedAt, currentLayer=1 |
| Submitted | approve (layer n) | `status==="Submitted"` + ada layer `Pending`; cek approver **lemah** (hard-coded me; me=null di tenant lain → guard skip) | n<last → Submitted (currentLayer=n+1) · n=last → **Approved** | layer `Approved`+decidedAt; approverId di-overwrite jadi aktor; **tanpa update kondisional** → race double-advance |
| Submitted | reject | idem | **Rejected** | layer `Rejected`; PA terminal |
| Approved | process | `status==="Approved"` | **Processed** | **efek per matriks §4**; processedAt; idempoten via status; NON-transaksional |
| Prepared/Submitted/Approved/Rejected | cancel | hanya `Processed` ditolak | **Cancelled** | layer tidak di-reset; cancel dokumen yang sedang menunggu approval tanpa pemberitahuan |
| Rejected/Cancelled | return | hanya 2 status itu | **Prepared** | semua layer reset `Pending` (approverId tetap), currentLayer=0, submittedAt=null |
| Prepared/Cancelled | delete | — | (dihapus) | layers ikut cascade |

### Matriks efek `process` per tipe (implementasi nyata vs dialog)

| Tipe PA | detailJson dari dialog | Efek nyata saat process | Verdict |
|---------|------------------------|--------------------------|---------|
| Hire | plannedPosition(kode), plannedSalary | — (tidak ada branch) | no-op |
| Promotion | toPosition(kode), newGrade(kode), newSalary | hanya `baseSalary` (posisi/grade **hilang**) | parsial |
| Demotion | toPosition, newGrade, newSalary? | hanya `baseSalary` bila diisi; tanpa gaji → `changed:false` tanpa riwayat | parsial/no-op |
| Transfer | toUnit, toPosition, newSalary? | hanya `baseSalary` bila diisi | parsial |
| Mutation | toUnit | — | **no-op** |
| SalaryAdjustment | newSalary | `baseSalary` ✓ + riwayat | ✅ penuh |
| ContractRenewal | months, newEndDate | — (`newEmploymentStatus` tak pernah dikirim dialog) | **no-op** |
| ChangeStatus | newEmploymentStatus | `employmentStatus` ✓ + riwayat | ✅ penuh |
| ExtendProbation | months | — | **no-op** |
| Resignation | lastDay | status Resigned + `endDate=effectiveDate` (**lastDay diabaikan**) + tutup assignment | parsial |
| Termination | lastDay | status Terminated + endDate=effectiveDate + tutup assignment | parsial |
| Retirement | lastDay | status **Resigned** + endDate + tutup assignment | parsial |

---

## 4. ATURAN BISNIS vs IMPLEMENTASI

| Aturan (PRD / praktik HRIS) | Implementasi OneVity | Status |
|------------------------------|----------------------|--------|
| Perubahan struktural (posisi/unit/grade/gaji) harus lewat PA (PRD §6.3) | EditWorkDialog mengubah semuanya langsung via PATCH (reason ManualEdit) | ✗ MAJOR (M-01) |
| Approve PA = pemisahan tugas maker/checker | approver semua layer = pembuat; aktor hard-coded | ✗ KRITIS (K-03) |
| Process PA menutup interval lama & membuka baru (PRD §6.4 Process) | Terjadi — tapi hanya untuk field yang kuncinya cocok (posisi/grade/unit tidak pernah) | ✗ KRITIS (K-01) |
| Terminasi mengubah status karyawan pada effectiveDate | Status berubah **saat proses** (bukan tanggal efektif); `endDate`=effectiveDate bukan `lastDay` | ✗ MAJOR (M-02) |
| Overlap assignment (2 posisi bersamaan) | `applyAssignmentChange` menutup current dulu → secara prosedur aman; namun tanpa transaksi/unique index → race bisa menghasilkan 2 assignment aktif; rangkap (non-primary) memang tidak didukung (GAP) | ⚠ sebagian |
| effectiveDate ≥ joinDate | Tidak divalidasi (PA maupun PATCH); eff di masa lalu → interval terbalik | ✗ (M-05) |
| Hapus karyawan dgn riwayat payroll/PA | Endpoint DELETE employee **tidak ada** (hanya GET/POST/PATCH) → guard tidak relevan; GAP vs PRD F10 | n/a (GAP) |
| Hapus OrgUnit/Position/Job/Grade yang dipakai | Position: guard semua riwayat ✅; OrgUnit & Grade: hanya pemakaian **aktif** → historis SetNull | ⚠ sebagian (m-05) |
| NIP/employeeNo unik | employeeNo unique DB + auto; **prefix "MII" hard-coded** (tenant lain salah); NIK tidak unik | ⚠ (M-06) |
| Gaji pokok dalam rentang min/max grade | Hanya indikator UI di wizard (SalaryMeter advisory); API (wizard, PATCH, PA) tidak memvalidasi sama sekali | ✗ (M-05) |
| Kapasitas posisi (headcount) | Soft: filled dihitung & ditampilkan; over-capacity bisa terjadi & tidak divalidasi; org-map menyembunyikan overfill | ⚠ (m-04) |
| 12 tipe PA (PRD §6.4) | 12 tipe ada tapi berbeda: tidak ada ConfirmProbation/Assign/Release Non-Primary/TransferCrossCompany; ada Hire/Mutation/Retirement | ⚠ (G-01) |
| Disciplinary: SP berjenjang + efek noPromote + expiry (PRD §6.5) | Hanya catatan; level bebas; expiry hanya ikon | ✗ (G-03) |
| Approval engine multi-rule + delegasi + autoApprove + SLA (PRD §6.6) | Template 3-layer statis saat create; TemporaryApprover/autoApprove/SLA tidak dipakai di keputusan | ✗ (G-02) |

---

## 5. TEMUAN PER SEVERITY

### KRITIS

**K-01 · Efek "Process" PA tidak menerapkan perubahan posisi/grade/unit (mismatch kunci detail code vs id)**
- Lokasi: `src/onevity/human-resource/components/actions/pa-create-dialog.tsx:40-85` (TYPE_FIELDS menyimpan `toPosition`/`toUnit`/`newGrade` berisi **KODE**) vs `src/onevity/human-resource/api/personnel-actions-detail.ts:141-152` (membaca `detail.positionId`/`orgUnitId`/`gradeId` = **ID**); seed juga memakai kode (`prisma/seed.ts:1226,1232,1246`).
- Dampak: Promosi/demosi/rotasi yang sudah **Approved & Processed** tidak memindahkan karyawan — hanya gaji yang berubah (bila diisi); Mutation & Demotion-tanpa-gaji no-op total tanpa jejak. Bukti live: PA-2026-0004 Transfer Processed → Yusuf Rahayu tetap MII-HRD-RC/P-RCT, tanpa riwayat `sourceDocNo=PA-2026-0004`; PA-2026-0009 Demotion Processed {fromPosition,toPosition} → nol efek.
- Saran fix minimal: di `pa-create-dialog` kirim `{positionId, orgUnitId, gradeId}` (ID, dari endpoint positions/org-units/grades — sekaligus memperbaiki opsi yang kini hanya posisi yang sudah dipegang orang); ATAU di handler process, resolve `toPosition/toUnit/newGrade` (kode → id) sebelum `applyAssignmentChange`. Tambahkan assertion: bila type Promosi/Transfer dan tidak ada perubahan posisi/unit yang diterapkan → tolak dengan error (agar no-op tidak senyap).

**K-02 · Semua efek PA/terminasi non-transaksional (partial write)**
- Lokasi: `src/onevity/human-resource/services/assignment.ts:100-111` (update validTo lalu create terpisah); `src/onevity/human-resource/api/personnel-actions-detail.ts:135-188` (side effects + update status PA terpisah); 0 penggunaan `$transaction` di seluruh `src/onevity/human-resource/`.
- Dampak: kegagalan di tengah (koneksi, FK, constraint) → assignment lama tertutup tanpa pengganti / employee non-aktif tapi assignment masih terbuka; PA tetap `Approved` → setelah diperbaiki bisa diproses ulang → efek ganda; proses retry bisa terjalan `changed:false` atau throw "Karyawan tidak memiliki penempatan aktif" (stuck permanen).
- Saran fix minimal: bungkus tiap side-effect + `personnelAction.update(status:"Processed")` dalam satu `db.$transaction(async (tx) => …)`; pindahkan update status PA ke **dalam** transaksi sebagai komit terakhir.

**K-03 · Maker = checker & identitas aktor hard-coded "MII000001"**
- Lokasi: `src/onevity/human-resource/api/personnel-actions.ts:102-117` (semua layer `approverId: me?.id` = pembuat); `personnel-actions-detail.ts:71,100-106` (guard memakai `db.appUser.findFirst({username:"MII000001"})` bukan session user; logika cek terbalik: memeriksa role **penunjuk** approver, bukan role aktor); `personnel-actions.ts:25-29,63-71` (inbox `mine=1` hard-coded).
- Dampak: pemegang dokumen dapat menyetujui sendiri seluruh 3 layer (3 klik) — approval berlapis hanya kosmetik; identitas session (uid di cookie) diabaikan → siapa pun yang login di MII bertindak sebagai Tri Handayani (audit trail salah); di tenant tanpa user "MII000001" (terverifikasi Cahaya: 0 AppUser) `me=null` → guard approve **di-skip** dan inbox selalu kosong → PA tidak bisa diputuskan secara sah.
- Saran fix minimal: resolve aktor dari session (`requireTenant` → uid → mapping AppUser, atau simpan appUserId di session); saat create PA, isi `approverId` per-layer dari resolusi role/struktur (atau biarkan null + guard keputusan berbasis role aktor); tolak approve bila `approverId === createdBy` (kecuali Admin dengan alasan tercatat).

### MAJOR

**M-01 · Dialog "Edit Info Pekerjaan" bypass PA + field status silent no-op**
- Lokasi: `src/onevity/human-resource/components/employee/detail-dialogs.tsx:252-263` (mengirim `status`, `joinDate`, `endDate`, unit/posisi/grade/gaji/atasan) vs `api/employee-detail.ts:118-158` (`PERSONAL_FIELDS` tidak memuat `status` → **diabaikan**; JOB_FIELDS + baseSalary → `applyAssignmentChange` reason `ManualEdit`, eff = hari ini).
- Dampak: (a) perubahan struktural & gaji tanpa approval — melanggar kontrol PRD §6.3; (b) memilih status "Resigned/Terminated" di dialog tidak berlaku tapi `endDate` tersimpan → karyawan `Active` dengan tanggal keluar (inkonsistensi lifecycle); (c) `joinDate` bisa diubah bebas → tenure & riwayat assignment tidak lagi sinkron.
- Saran fix: hapus field `status` (dan `joinDate`) dari dialog; arahkan perubahan struktural/gaji ke flow PA; atau tandai PATCH pekerjaan sebagai "emergency edit" yang wajib mencatat alasan.

**M-02 · Terminasi: `lastDay` diabaikan & nonaktif sebelum tanggal efektif**
- Lokasi: `src/onevity/human-resource/api/personnel-actions-detail.ts:174-184` (`endDate: action.effectiveDate` — `detail.lastDay` tidak pernah dipakai; `employee.status` di-set saat proses, bukan saat eff date).
- Dampak: contoh live PA-2026-0005: `lastDay 2026-06-30` vs `effectiveDate 2026-11-04` → bila diproses, endDate salah 4+ bulan; terminasi ber-eff-date masa depan langsung mengeluarkan karyawan dari direktori aktif/payroll/TA **hari ini**.
- Saran fix: `endDate = detail.lastDay ?? effectiveDate`; status non-aktif diterapkan terjadwal (job harian sederhana yang menutup assignment & set status saat eff date tercapai), atau minimal warning UI saat eff date > hari ini.

**M-03 · 5 tipe PA tidak punya efek data sama sekali (Hire, Mutation, ContractRenewal, ExtendProbation, Demotion-tanpa-gaji)**
- Lokasi: `personnel-actions-detail.ts:153-173` (branch ExtendProbation/ContractRenewal hanya efektif bila `detail.newEmploymentStatus` — dialog tidak pernah mengirimnya; Hire tidak punya branch).
- Dampak: dokumen "Processed" tanpa jejak perubahan; perpanjangan kontrak/probation tidak tercatat di data (tidak ada field tanggal berakhir — lihat G-05); `pa-types.ts:190-193` bahkan menyebut "tercatat sebagai catatan saja" padahal tidak ada catatan yang ditulis.
- Saran fix minimal: tulis minimal ke `notes` assignment baru + ActivityLog ("kontrak diperpanjang 12 bln s.d. 2027-01-31"); jangka panjang tambahkan `employmentEndDate` di EmployeeAssignment.

**M-04 · Guard approve/reject tidak idempen & race-prone**
- Lokasi: `personnel-actions-detail.ts:96-131` (read PA → cari pending → update tanpa kondisi `status:"Pending"`).
- Dampak: double-click approve memproses 2 layer beruntun (karena approver tiap layer sama); dua request paralel double-advance; reject setelah approve tetap sah untuk layer baru.
- Saran fix: `approvalLayer.updateMany({ where: { id: pending.id, status: "Pending" }, … })` + cek `count===1` sebelum update PA.

**M-05 · Validasi aturan inti hilang di server**
- Lokasi: `personnel-actions.ts:84-120` (eff date bebas — bisa < joinDate / karyawan non-aktif tetap bisa di-PA; gaji baru tidak divalidasi); `employees.ts:81-137` (baseSalary/FK posisi-unit-grade tanpa validasi → error 500 prisma; wizard SalaryMeter `employee-wizard.tsx:614-636` advisory saja); `positions.ts:87-101` (headcount bisa negatif; `active:false` pada posisi yang masih dipegang).
- Dampak: PA SalaryAdjustment bisa men-set gaji 0/negatif/di luar range grade tanpa peringatan; eff date < joinDate → interval riwayat terbalik (contoh live: Yusuf Rahayu baris `2025-04-23 → 2022-06-30`); promosi karyawan Resigned via API.
- Saran fix: validasi server: `effectiveDate ≥ joinDate`, `newSalary` dalam range grade (atau warning + override tersimpan), PA non-terminasi hanya untuk `status==="Active"`.

**M-06 · Prefix employeeNo hard-coded "MII"**
- Lokasi: `employees.ts:91-93` (`MII${pad(nextNo,5)}`; nextNo dari max suffix).
- Dampak: onboarding di tenant Cahaya/Sentra menghasilkan nomor "MIIxxxxx" (identitas tenant bocor/berantakan); nomor karyawan terhapus dapat terpakai ulang (max-suffix turun) → dokumen historis membingungkan.
- Saran fix: prefix dari `company.code`; simpan counter (sequence) yang tidak turun saat record dihapus.

### MINOR

- **m-01** `personnel-actions-detail.ts:178` — Retirement dipetakan ke status `Resigned` → pensiun tidak bisa dibedakan dari resign di semua laporan. Fix: status `Retired` (atau simpan `exitReason`).
- **m-02** Karyawan non-aktif dari seed menyisakan assignment aktif (Slamet Resigned: assignment `validTo=null`) → `stats.contract=6` padahal kontrak aktif 5; `employeeCount` unit termasuk mantan karyawan (`employees.ts:48`, `org-units.ts:13`). Fix: tutup assignment saat status non-aktif (normalize script / proses terminasi tunggal).
- **m-03** Interval riwayat terbalik dari seed (validFrom > validTo) tidak dideteksi/tampil membingungkan (`employee-detail` riwayat). Fix: validasi + tampilkan warning; perbaiki data.
- **m-04** `positions.ts:31-37` — `employees` take:1 (pemegang ke-2 tak tampil padahal filled=2); kolom DB `Position.filled` tak pernah disinkronkan (dua sumber kebenaran); `org-map.ts:149,159` membatasi `filled=min(headcount,aktual)` → overfill tersembunyi dari KPI. Fix: tampilkan semua pemegang; drop kolom filled atau maintain.
- **m-05** Kebijakan guard DELETE tidak seragam: Position blokir semua riwayat (aman), OrgUnit & Grade hanya blokir pemakaian aktif → hapus master dengan riwayat → FK `SetNull` menghapus jejak unit/grade lama dari riwayat karier (`org-units.ts:97-104`, `grades.ts:77-81`). Fix: samakan (blokir bila ada riwayat apa pun).
- **m-06** Detail PA menampilkan nilai kode mentah (fromPosition "P-OPR") tanpa resolusi nama; `personnel-actions.ts:27` query `me` mati (unused); tipe UI `PAListResp.actingUser/canAct` tidak pernah dikirim API (drift kontrak). Fix: resolve label + bersihkan.
- **m-07** `cancel` dari status `Submitted` tanpa reset layer/notifikasi; PA `Cancelled` menyimpan layer sudah-Approved (timeline membingungkan), hanya `return` yang me-reset. Fix: reset layer saat cancel, atau tampilkan keterangan.
- **m-08** docNo PA/employeeNo dari max-suffix tanpa transaksi → dua POST bersamaan → unique violation → 500. Fix: retry/sequence.
- **m-09** Denormalisasi ganda unit: `EmployeeAssignment.orgUnitId` vs `Position.orgUnitId` bisa berbeda (EditWorkDialog memungkinkan posisi di unit lain; org-map membaca assignment). Fix: validasi konsistensi posisi↔unit saat menempatkan.

### GAP (vs PRD-HR-BASE.md / praktik HRIS Indonesia)

- **G-01** PA type PRD yang belum ada: Confirm Probationary (habis masa percobaan), Assign/Release **Non-Primary Position** (rangkap jabatan), Transfer Across Company (multi-company dalam group). (`PA_TYPES` ui-kit.tsx:73-86)
- **G-02** Mesin approval PRD §6.6 belum nyata di PA: ApprovalProcess (14 dokumen), ApprovalProcessTemplate + 10 rule scoping, **autoApprove** (template AT-PA-FAST ada tapi tak pernah dipilih), **TemporaryApprover** (data + API shared ada, tapi guard keputusan PA tidak memakainya), SLA `approvalDays`/eskalasi. Routing approver by struktur (atasan langsung) tidak diimplementasi.
- **G-03** Disciplinary tanpa makna proses: tidak ada master WarningLevel (validity bulan, noPromote, noSalaryInc, scPenaltyRate — PRD §5.6/§6.5), tidak ada validasi berjenjang SP1→SP2→SP3, tidak ada efek blokir promosi/kenaikan gaji, tidak ada jalan otomatis ke PA Termination.
- **G-04** Blacklist: `Employee.status="Blacklisted"` tidak pernah bisa diset dari UI/API mana pun; tidak ada entity Blacklist berbasis NIK untuk blokir re-hire (PRD F17).
- **G-05** Tanggal berakhir kontrak & akhir probation tidak dimodelkan → reminder "probation habis/kontrak habis" (PRD Reminder Setting) & Generate PA massal dari data (probation due) tidak mungkin.
- **G-06** Letter generator/surat PA (templateCode, letterNo, dateOfIssue, generate DOCX/PDF — PRD §6.4/F24) tidak ada; PA tidak menghasilkan dokumen.
- **G-07** Endpoint DELETE/Duplicate employee (PRD F10) tidak ada — karyawan salah input tidak bisa dihapus (hanya nonaktifkan via PA); wizard juga tidak menyimpan BPJS/FasKes saat pembuatan (PRD step 5) — hanya lewat edit dialog; NIK duplikat tidak dicegah.
- **G-08** Query historis as-of (`basedOnDate` PRD §4.3/§6.3) tidak ada — riwayat tersedia di employee-detail, tetapi tidak ada cara melihat kondisi org/posisi "pada tanggal X".

---

## 6. VERIFIKASI RUNTIME (GET-only, tenant MII)

- `personnel-actions`: 9 dokumen — Prepared 2, Submitted 2, Rejected 1, Approved 1, Processed 2, Cancelled 1. Layer approver semua mengarah ke user MII000001 (Tri Handayani) atau null.
- PA-2026-0004 (Transfer **Processed**): employee Yusuf Rahayu masih unit MII-HRD-RC/P-RCT; riwayat hanya 2 baris (Initial 2025-04-23→2022-06-30 [terbalik], Transfer PA-2022-0102 2022-07-01→aktif dengan unit sama) → **bukti K-01**.
- Slamet Riyadi (status Resigned, endDate 2024-06-30): assignment masih `validTo=null` → **bukti m-02** (stats contract inflated 6 vs 5).
- positions: P-ACC headcount 1 / filled 2; P-OPR headcount 30 / filled 17 → overfill tanpa guard (m-04/GAP kapasitas).
- Cahaya tenant: 0 AppUser → `me=null` → inbox PA kosong & guard approve skip (**bukti K-03**).
- Template approval: AT-PA-STD (3 layer) selalu dipakai; AT-PA-FAST autoApprove tidak pernah; 1 delegasi TemporaryApprover aktif tidak berpengaruh di alur PA (G-02).

---

## 7. KESIMPULAN & PRIORITAS PERBAIKAN

1. **K-01** (bug kontrak kunci detail) — perbaikan kecil (kirim ID atau resolve kode→id) dengan dampak terbesar: seluruh proses promosi/transfer/mutasi saat ini tidak berfungsi.
2. **K-02** ($transaction) — melindungi integritas riwayat penempatan dari partial write.
3. **K-03** (identitas aktor dari session + larang self-approve) — syarat approval multi-layer bermakna.
4. **M-02/M-01** (semantik terminasi & bypass PA) — menyamakan perilaku dengan PRD.
5. Sisanya (validasi M-05, M-03 efek tipe PA, GAP bertahap G-01..G-08) menyusul sesuai prioritas produk.
