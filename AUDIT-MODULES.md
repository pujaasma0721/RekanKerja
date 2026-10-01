# AUDIT MODULES — RekanKerja HRIS

Tanggal: 22 Januari 2026 (sesi audit pasca-restrukturisasi direktori per modul, commit `a8ef2af`)
Lingkup: seluruh source code `src/rekankerja/` (6 modul domain + shared), 73 endpoint API, 63 model Prisma tenant, data live 4 tenant PostgreSQL.

---

## Ringkasan Eksekutif

| Dimensi | Hasil |
|---|---|
| Struktur direktori per modul | ✅ Sesuai desain (7 modul: 6 domain + shared) |
| Kontrak thin route ↔ handler | ✅ 73/73 method & path import valid |
| Coverage endpoint UI → route | ✅ Semua fetch UI punya route (0 endpoint hilang) |
| Kode mati (route tak dipakai UI) | 1 minor: `lookup-categories` (dipakai internal provisioning) |
| Error TypeScript kode aplikasi | ✅ **0** setelah perbaikan (sebelumnya 21; 2 sisanya di `skills/` contoh SDK — bukan kode RekanKerja) |
| Bug runtime ditemukan & diperbaiki | **2 kritis** (crash PA gaji + DELETE posisi selalu 500) |
| Boundary lintas-modul | ✅ Bersih — hanya via `shared`; payroll = agregator sah (4 integrasi) |
| Error console/page E2E | 0 di seluruh view yang diuji |

---

## 1. Inventaris per Modul

| Modul | Komponen | Services | API | LOC | Endpoint (method) |
|---|---|---|---|---|---|
| **human-resource** | 22 | 1 (assignment) | 16 | 11.925 | employees(G,P), employee-detail, employee-options, family, education, experiences, disciplinary, positions(G,P,D), grades, jobs, process-types, org-units, org-map, companies, personnel-actions(G,P,PUT), personnel-actions/[id](G,PUT) |
| **payroll** | 16 | 5 (service, engine, journal, spt, benefit) | 16 | 7.721 | payroll-runs, payroll-run, payroll-run-export, payroll-rapel, payroll-periods, payroll-journals, payroll-spt, payroll-profiles, wage-templates, wage-components, component-assignments, tax-parameters, accounts, benefit-types, benefit-claims, loans |
| **time-attendance** | 10 | 1 (attendance-service) | 10 | 4.325 | absence, assignments, clocking, day-types, matrix, overtime, overview, schedules, settings, workoffs |
| **leave** | 10 | 2 (service, seed) | 8 | 3.791 | balances, encashment, mass, overview, reports, requests, transfer, types |
| **travel** | 10 | 2 (service, seed) | 7 | 4.452 | budget, claims, overview, reports, requests, templates, transfer |
| **medical** | 10 | 2 (service, seed) | 8 | 4.146 | adjustments, balances, claims, overview, providers, reports, transfer, types |
| **shared** | 10 | 0 (+6 lib) | 8 | 5.443 | dashboard, meta, app-users, access-groups, approval-templates, temporary-approvers, lookup-categories, lookups |
| **Total** | **88** | **13** | **73** | **37.803** | 73 route (URL tidak berubah) |

Pola thin route: `src/app/api/rekankerja/*/route.ts` hanya re-export method dari `src/rekankerja/<modul>/api/*.ts`. Verifikasi programatik: **73/73** pasangan path-import valid & method identik.

---

## 2. Temuan & Perbaikan (Bug Runtime — severity KRITIS)

### F-01 · HR — Crash detail PA dengan field gaji 🔴
- **Lokasi**: `human-resource/components/actions/actions-module.tsx:491`
- **Masalah**: `fmtVal()` memanggil `fmtIDR()` tanpa import. Field PA `newSalary`/`plannedSalary` (Promosi/Mutasi/Hire) mengandung "salary" → **ReferenceError → panel Detail Perubahan crash** setiap kali dibuka. Bug ini telah ada sejak modul HR dibuat (tidak terdeteksi E2E karena detail PA bertipe gaji jarang dibuka).
- **Perbaikan**: tambah `fmtIDR` ke import dari `@/rekankerja/shared/lib/api`.
- **Verifikasi**: buka detail PA-2026-0001 (Hire) → "Gaji Direncanakan **Rp 5.500.000**" tampil, 0 error page/console.

### F-02 · HR — DELETE posisi selalu gagal 500 🔴
- **Lokasi**: `human-resource/api/positions.ts:117`
- **Masalah**: `db.employee.count({ where: { positionId } })` — Employee **tidak punya** field `positionId` (relasi via `EmployeeAssignment`). Prisma melempar "Unknown argument" → **setiap DELETE posisi = 500**, fitur hapus posisi tidak pernah berfungsi.
- **Perbaikan**: `db.employeeAssignment.count({ where: { positionId: id } })` (menghitung assignment aktif+historis — aman untuk FK).
- **Verifikasi**: posisi kosong AUD-TEST-01 → 200 terhapus; posisi P-ACC (dipegang 3 karyawan) → 400 "Posisi masih dipegang 3 karyawan".

---

## 3. Temuan & Perbaikan (Type / Contract — severity RENDAH, tidak mengganggu runtime)

| # | Lokasi | Temuan | Perbaikan |
|---|---|---|---|
| F-03 | `shared/components/shell/app-shell.tsx:195` | Tipe `meta` tidak memuat `benefitPendingClaims` — padahal handler `/api/rekankerja/meta` sudah mengirimnya; badge menu "Benefit Karyawan" bekerja di runtime tapi TS error | Tipe diperluas |
| F-04 | `travel/components/travel-claim-approval.tsx:37` | Tipe `approved` tanpa `stats` — endpoint mengirim `stats` (KPI "bayar karyawan/potongan") berfungsi tapi TS error | Tipe diperluas |
| F-05 | `human-resource/api/employee-detail.ts:60` | Tipe `manager.position.title` `string`, padahal bisa `null` (manager tanpa posisi aktif) | `string \| null` |
| F-06 | `payroll/api/payroll-rapel.ts:148` | `let run = null` meng-infer tipe `null` → 6 error narrowing; juga findFirst tanpa `include` membuat `run` kehilangan relasi saat dipakai UI | `RapelRun = Prisma.PayrollRunGetPayload<{include...}>` + guard `run &&` |
| F-07 | `payroll/components/payroll-benefits.tsx:343` | `{ period: claim.periodId ?? undefined }` — `undefined` tidak valid untuk `Record<string,string>` | Spread kondisional |
| F-08 | `human-resource/components/org/org-map-view.tsx:970` | TS2774: truthiness-check ikon (fungsi komponen) | `!= null` |
| F-09 | `time-attendance/components/attendance-absence.tsx:120` | `api.data.total?.employees` — field `total` tidak pernah dikirim service (selalu fallback `rows.length`) | Langsung `rows.length` |
| F-10 | `time-attendance/services/attendance-service.ts:942` | `month.rows ?? 0` — field `rows` tidak ada; `month.total` mati & tak dikonsumsi UI | Properti mati dihapus |
| F-11 | `travel/services/travel-service.ts:801` | `run.transferredRunNo` — PayrollRun tidak punya field itu (runtime fallback `?? run.runNo` bekerja, tapi baca properti tidak-ada) | Langsung `run.runNo` |
| F-12 | `prisma/seed.ts:479` | Tipe lokal `CompDef` belum memuat `accountDebitCode` (model WageComponent memilikinya; seed sudah berjalan sukses) | Tipe diperluas |

**Hasil**: error TS kode aplikasi **21 → 0** (2 sisanya di `skills/` — pustaka contoh environment, di luar scope RekanKerja).

---

## 4. Boundary & Dependensi Lintas-Modul

```
human-resource → shared
payroll        → shared + (TA, Leave, Travel, Medical — 4 service: markOvertimePaid/markEncashmentPaid/markTravelPaid/markMedicalPaidForRun)
time-attendance→ shared
leave          → shared + time-attendance (dayStart/addDays/diffDays/resolveDayType — lib hari kerja)
travel         → shared
medical        → shared
shared         — (tidak mengimpor modul domain mana pun ✓)
```

- **Payroll = agregator sah**: saat run payroll dikonfirmasi, ia menandai lembur/encashment/klaim travel/UMC medical sebagai terbayar — coupling domain yang memang diinginkan (1 arah, hanya di lapisan service).
- **Leave → time-attendance**: pemakaian 4 util tanggal/hari-kerja (pure function) — aman.
- Tidak ada komponen UI lintas-modul; semua berbagi hanya via `shared`. ✅

---

## 5. Coverage Endpoint & Kode Mati

- Semua URL `/api/rekankerja/*` yang di-fetch UI (79 pattern) memiliki route — **0 endpoint hilang**.
- Route `personnel-actions/[id]` terpakai via template literal `personnel-actions/${id}` ✓.
- `lookup-categories`: endpoint sah, dipakai internal/admin data-master — bukan mati.
- UI payroll-templates memakai `wage-templates` + `wage-components` (bukan `payroll-templates` — memang tidak ada route-nya).

---

## 6. Model DB per Modul (schema-tenant.prisma — 63 model)

| Modul | Model (jumlah) |
|---|---|
| HR (19) | Company, OrgUnit, Job, Grade, Position, Employee, EmployeeAssignment, EmployeeFamily, EmployeeEducation, EmployeeExperience, DisciplinaryRecord, PersonnelAction, ApprovalLayer, Lookup, AppUser, AccessGroup, AccessGroupMember, ApprovalTemplate, TemporaryApprover |
| Payroll (21) | WageComponent, PayrollPeriod, ProcessType, WageTemplate, WageTemplateItem, EmployeePayrollProfile, TaxBracket, TerRate, PayrollRegulation, PayrollRun, PayrollRunLine, PayrollRunItem, EmployeeLoan, LoanInstallment, EmployeeComponentAssignment, PayrollJournal, PayrollJournalLine, AccountGroup, Account, PostingEvent, BenefitType, BenefitClaim |
| TA (10) | WorkDayType, WorkSchedule, WorkScheduleDay, ScheduleAssignment, AttendanceClockLog, AttendanceDaily, OvertimeOrder, WorkOffPermission, AttendanceRule |
| Leave (5) | LeaveType, LeaveBalance, LeaveRequest, LeaveEncashment, MassLeave |
| Travel (10) | TravelZone, TravelTemplate, TravelExpenseType, TravelBudget, TravelBudgetItem, TravelRequest, TravelDestination, TravelAdvance, TravelClaim, TravelClaimExpense |
| Medical (6) | MedicalBenefitType, MedicalProvider, MedicalBalance, MedicalClaim, MedicalClaimLine, MedicalAdjustment |
| Shared (1) | ActivityLog |

## 7. Data Live per Tenant (PostgreSQL, 21 Jan 2026)

| Tenant | HR | Payroll | TA | Leave | Travel | Medical | Keterangan |
|---|---|---|---|---|---|---|---|
| **MII** (pt_mitra_industri_internasional) | 227 (44 karyawan, 48 assignment, 9 PA, 20 posisi) | 3.952 (6 run, 3.806 run item, 15 jurnal, 42 profile, 9 benefit claim, 3 loan) | 2.639 (2.562 daily, 42 assignment, 17 overtime) | 649 (546 saldo, 86 request, 5 encashment) | 36 (7 request, 6 claim, 17 baris biaya) | 421 (378 saldo, 11 claim, 12 baris, 4 adjustment) | Data demo lengkap ✓ |
| **Cahaya** (cahaya_digital_nusantara) | 47 lookup | 60 master | 11 master | 12 master | 5 master | 16 master (8 jenis, 8 provider) | Master-only (by design) |
| **Sentra** (sentra_logistik_prima) | 47 lookup | 60 master | 11 master | 12 master | 5 master | 16 master | Master-only (by design) |
| **PT akas** (pt_akas) | 47 lookup | 55 master | 11 master | 12 master | ⚠️ **tabel travel tidak ada** | ⚠️ **tabel medical tidak ada** | **Legacy** — schema pra-modul travel/medical; tenant tanpa user aktif yang memakainya |

> ⚠️ **Rekomendasi**: `pt_akas` adalah tenant legacy — jalankan provisioning (create schema + push + master) bila akan dipakai, atau nonaktifkan statusnya di platform untuk kebersihan demo.

## 8. Kualitas Lintas-Modul (hasil verifikasi)

- **E2E agent-browser** (login MII): 27+ view lintas 6 modul + settings — 0 page error, 0 console error.
- **Mobile 390px**: 0 overflow horizontal; footer sticky benar (dasar viewport saat pendek, terdorong saat panjang).
- **Lint**: bersih. **tsc**: 0 error kode aplikasi.
- **dev.log**: hanya 200/401.

## 9. Backlog (tidak mengganggu, catatan arsitektur)

1. `positions.ts` DELETE pada id tak-dikenal → Prisma P2025 dibungkus 500; idealnya 404 eksplisit (sangat minor).
2. ESS mobile self-service wizard; attachment kwitansi klaim (storage); laporan PDF — seperti backlog modul sebelumnya.
3. Tenant `pt_akas` — provisioning ulang atau nonaktifkan (lihat §7).
