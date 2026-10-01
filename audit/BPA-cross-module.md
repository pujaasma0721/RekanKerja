# AUDIT BISNIS PROSES LINTAS-MODUL — RekanKerja HRIS

- Task ID: **24-g** · Tanggal: 22 Januari 2026 · Mode: **READ-ONLY** (tidak ada perubahan kode/commit/mutasi data).
- Lingkup: mesin integrasi 6 modul domain + shared (approval engine, payroll aggregator, transfer endpoints, jurnal lintas-sumber, auth/tenant, data flow TA↔payroll, leave↔TA, dashboard/meta, ActivityLog, provisioning).
- Sumber: pembacaan kode `src/rekankerja/**` + `prisma/schema-tenant.prisma`, probing runtime GET (login hrd@mii.co.id → tenant MII), dan query DB read-only (SELECT/groupBy via Prisma client) terhadap schema `tenant_pt_mitra_industri_internasional`.
- Tumpang-tindih dengan AUDIT-MODULES.md (Task 23, F-01..F-12) dihindari — semua temuan di bawah adalah temuan BARU lintas-modul.

---

## 1. Ringkasan Eksekutif

| Dimensi | Hasil |
|---|---|
| Isolasi tenant (guard `requireTenant`) | ✅ 73/73 handler API terlindungi (membership + status ACTIVE) |
| **Otorisasi approver (identitas/role)** | 🔴 **Tidak ada** di seluruh endpoint approval/transfer/payroll — hanya medical yang membaca session (tanpa role check); PA memakai user **hardcoded `MII000001`** |
| Mesin multi-layer approval | ⚠️ Hanya PersonnelAction; modul lain single-step; delegasi (TemporaryApprover) **tidak pernah dipakai**; layer non-HR-Manager bisa **deadlock** (bukti live PA-2026-0002) |
| Payroll sebagai agregator | ✅ Arsitektur benar (5 callback saat confirmRun + jurnal), ⚠️ 2 dari 5 kaki putus/tidak akurat (overtime tanpa cek transfer; medical no-op) |
| Idempotensi transfer & jurnal | ✅ delete+recreate per period; run unik per period+type; jurnal unik per runId · 🔴 **generator nomor jurnal 3 versi saling bertabrakan** (bukti live JV-2027..JV-2031) |
| Double posting travel (jurnal klaim + payroll) | 🔴 Bagian `payableEmployee` tercatat **dua kali** (beban 5105 + kas 1101) saat klaim di-approve lalu ditransfer ke payroll |
| Leave → TA | ✅ Approve cuti meregenerasi AttendanceDaily `OnLeave`, tidak double-count dengan Absent |
| TA → payroll | ⚠️ Snapshot via transfer manual (oranHR-style); window tanggal **tidak divalidasi** terhadap period; karyawan tanpa data kehadiran **dibayar penuh tanpa peringatan** |
| ActivityLog | ⚠️ Coverage proses bisnis cukup luas, tetapi **75/75 baris live tanpa aktor** (appUserId NULL) |
| Provisioning tenant baru | ✅ Master 6 modul lengkap (leave 12 jenis, medical types+providers, TA day-type/schedule, travel zone/template/expense, COA 5105/5106, komponen LEMBUR/UCT/UTRP/UMC) · ❌ ApprovalTemplate/AppUser/AccessGroup **tidak** dibuat |

**Hitungan temuan: KRITIS 3 · MAJOR 8 · MINOR 6 · GAP 6.**

---

## 2. Peta Arsitektur Integrasi As-Is

```
                       ┌──────────────────────────── shared ────────────────────────────┐
                       │ api: dashboard, meta, app-users, access-groups,                │
                       │     approval-templates, temporary-approvers, lookups           │
                       │ lib: auth (session platform), tenant-db (requireTenant),       │
                       │      provisioning (DDL + seed reference semua modul), store    │
                       │ DB : AppUser, AccessGroup(+Member), ApprovalTemplate,          │
                       │      TemporaryApprover, ActivityLog                            │
                       └───────────────────────────────────────────────────────────────┘
                          ▲            ▲            ▲            ▲           ▲
   human-resource ───────┘   payroll ──┘  time-att ┘   leave ─────┘  travel ──┘  medical
   (PA + ApprovalLayer      (agregator sah:              (encashment   (claims     (claims
    multi-layer, satu-      confirmRun memanggil          → UCT        → UTRP/     settle →
    satunya multi-layer)     5 callback + jurnal)         transfer)    TRVSTLIN)   5106/UMC)
                                   │
      ┌────────────────────────────┼─────────────────────────────────────────────┐
      │  confirmRun(runId) [payroll-service.ts:302]                              │
      │  status harus Calculated → Confirmed + period → Processed                │
      │  ├─ markClaimsPaidForRun     (BENEFIT run: BenefitClaim Scheduled→Paid)  │
      │  ├─ markOvertimePaidForRun   (SALARY run: OvertimeOrder Approved→Paid)   │  ⚠ tanpa cek transfer
      │  ├─ markEncashmentPaidForRun (SALARY run: LeaveEncashment Transferred→Paid)
      │  ├─ markTravelPaidForRun     (SALARY run: TravelClaim Transferred→Paid)   │
      │  ├─ markMedicalPaidForRun    (SALARY run: MedicalClaim periodCode→Paid)   │  ✗ no-op (periodCode tak pernah diisi)
      │  └─ generateJournalForRun    (jurnal JV-{th}-nnn, D=C, update saldo COA)  │
      └──────────────────────────────────────────────────────────────────────────┘

  TRANSFER (modul pengirim → EmployeeComponentAssignment kind=Specific, period×processType):
   TA/absence    transferToPayroll        → LEMBUR/TLATE/TABS/TKEHADIRAN  (window from/to caller-supplied)
   leave         transferEncashment       → UCT   (Approved/Transferred, paymentDate dalam period)
   travel        transferClaimsToPayroll  → UTRP (earning) + TRVSTLIN (deduction)  (SEMUA claim Approved, tanpa filter tanggal)
   medical       transferUnusedToPayroll  → UMC   (saldo CASH tahun Y; saldo dikonsumsi saat transfer = guard ganda)
   payroll engine (buildRunRows) membaca Specific periodId+processTypeId → masuk snapshot run item.

  JURNAL (PayrollJournal + PayrollJournalLine — 3 sumber, 1 tabel):
   payroll run confirmed   → JV-{tahun}-{count+1:3}  (payroll-journal.ts:46)   update Account.balance ✓
   travel claim approved   → JV-{tahun}-{max+1:3}    (travel-service.ts:580)   update Account.balance ✗
   medical claim settled   → JV-{parseInt(slice(3))} (medical-service.ts:35)  → live: JV-2027…JV-2031   update Account.balance ✗

  LEAVE → TA (write path, lebih dari "4 util" seperti catatan Task 23):
   decideRequest approve/reject/cancel → regenerateDaily per hari rentang cuti (leave-service.ts:619-627,
   dynamic import attendance-service) → AttendanceDaily status OnLeave (paid/unpaid) — absen & cuti TIDAK double count.
```

---

## 3. Audit Mesin Approval per Modul (tabel konsistensi)

| Modul / dokumen | Mekanisme approval | Layer majemuk? | Delegasi (TemporaryApprover)? | Guard self-approval / identitas approver |
|---|---|---|---|---|
| **HR — PersonnelAction** | `ApprovalLayer` (Pending/Approved/Rejected) + `currentLayer`, template `AT-PA-STD` (3 layer) diambil saat create; submit→approve per layer→process | ✅ Ya — layer berurutan (personnel-actions-detail.ts:118-131) | ❌ **Tidak pernah dirujuk** di logika keputusan | ⚠ Identitas approver = **user hardcoded MII000001** (bukan session); semua layer PA baru dibuat dengan approverId = pembuat → **creator approves own doc**; role check longgar (HR Manager/Admin) |
| Leave — LeaveRequest | status Submitted→Approved/Rejected/Cancelled, satu keputusan (leave-service.ts:600) | ❌ | ❌ | ❌ Tidak ada — `decidedById` selalu null (route tidak mengoper actorId) |
| Leave — LeaveEncashment | sama, single-step (leave-service.ts:828) | ❌ | ❌ | ❌ idem |
| Travel — TravelRequest | Submitted→Approved/Rejected/Cancelled (travel-service.ts:302) | ❌ | ❌ | ❌ Tidak ada |
| Travel — TravelClaim | Submitted→Approved (→ jurnal) → Transferred → Paid (travel-service.ts:655) | ❌ | ❌ | ❌ Tidak ada; approve langsung posting jurnal |
| Medical — MedicalClaim | Draft→Submitted→(return)→Approved→Settled + statusLog per aktor (medical-service.ts:722) | ❌ | ❌ | ⚠ Satu-satunya modul yang mengisi aktor (`actor?.uid` platform) di statusLog/ActivityLog — tetapi **tanpa role check** siapa pun boleh settle |
| Payroll — BenefitClaim | Pending→Approved (auto-approve dalam limit) →Scheduled→Paid (benefit-service.ts:216) | ❌ (auto-approve in-limit = desain oranHR) | ❌ | ❌ `approvedBy` diambil dari **body request client** (default "Admin Payroll") |
| TA — OvertimeOrder | Pending→Approved (actual dari clocking)→verify→Paid (attendance-service.ts:753) | ❌ | ❌ | ❌ `approver` string dari body, default "Admin HR" |
| TA — WorkOffPermission | Pending→Approved/Rejected (attendance-service.ts:876) | ❌ | ❌ | ❌ idem |
| Payroll — PayrollRun | Draft→Calculated→**Confirmed** (confirmRun)→Paid | ❌ (tanpa approval layer — operator ganda payroll tidak dimodelkan) | ❌ | ❌ confirm/markPaid oleh user login mana pun |

**Kesimpulan**: model `ApprovalLayer`/`ApprovalTemplate`/`TemporaryApprover` (schema baris 272/755/766) hanya dihidupkan oleh PersonnelAction. `ApprovalTemplate` hanya dibaca di `personnel-actions.ts:100` (code `AT-PA-STD`), `docType` default "PersonnelAction" — tidak ada modul lain yang memakai template/delegasi. Siapa approver: PA = template role → tapi **diisinya approverId = user yang membuat** (bukan resolusi role → user); modul lain = siapa saja yang login (tidak ada routing atasan langsung / access group / inbox approver per user).

### Bukti live (tenant MII, GET + SELECT read-only)
- PA-2026-0002 (Submitted): L1 Dept Head → approver MII000003 (role "Approver") Pending. Endpoint approve memakai `me = MII000001` (HR Manager) → cabang `personnel-actions-detail.ts:100-106` → 403 → **dokumen tidak bisa disetujui/ditolak oleh user mana pun** (deadlock multi-layer).
- Delegasi live: Sri Wahyuni (MII000004) → Tri Handayani (MII000001), Aktif — tidak berpengaruh apa pun karena decision logic tidak membaca `TemporaryApprover`.
- `personnel-actions?mine=1` mengembalikan dokumen milik MII000001 untuk SEMUA user yang login (filter "inbox saya" memakai user hardcoded).

---

## 4. Audit Idempotensi Transfer & Jurnal (payroll = agregator)

### 4.1 Sisi pengirim (validasi sebelum transfer, guard double-transfer)
| Endpoint / fungsi | Validasi status | Guard double transfer | Kaitan ke run |
|---|---|---|---|
| TA `transferToPayroll` (attendance-service.ts:570) | period Open/Processing (Locked/Closed ditolak) | ✅ delete+recreate Specific period ini (idempoten) | ❌ window from/to dari caller, **tidak divalidasi** = period; `PayrollPeriod.taStartDate/taEndDate` tak dipakai |
| leave `transferEncashment` (leave-service.ts:906) | idem | ✅ delete+recreate UCT; hanya doc dengan paymentDate/requestDate dalam window period target | ⚠ Tidak cek apakah run period tsb **sudah Confirmed** |
| travel `transferClaimsToPayroll` (travel-service.ts:717) | idem | ✅ status→Transferred (tak di-transfer ulang); delete+recreate UTRP/TRVSTLIN | ❌ Mengambil **SEMUA** claim Approved tanpa filter tanggal; tidak cek run sudah Confirmed |
| medical `transferUnusedToPayroll` (medical-service.ts:913) | idem | ✅ **kuat**: saldo CASH dikonsumsi (usedAmount += remaining) saat transfer → tak bisa transfer dua kali | idem |

### 4.2 Sisi agregator (confirmRun, payroll-service.ts:302-397)
- Kondisi: run.status harus `Calculated` → idempoten (re-confirm ditolak). ✅
- Run duplikat per period×processType ditolak (payroll-runs.ts:50-58) ✅; journal unik per `runId` (findUnique awal, payroll-journal.ts:65-69) ✅; balance D=C diverifikasi sebelum insert (payroll-journal.ts:159-163) ✅.
- Semua callback + posting jurnal dibungkus try/catch **non-fatal** (payroll-service.ts:351-396) → kegagalan jurnal hanya jadi ActivityLog "Error" — konfirmasi tetap sukses (lihat M-07).

### 4.3 Temuan idempotensi/integritas
- **M-02**: `markOvertimePaidForRun` (attendance-service.ts:654-673) menandai **semua** OvertimeOrder Approved dalam window period sebagai Paid + paidRunNo pada confirm run SALARY — **tanpa memeriksa** bahwa lembur itu benar-benar ditransfer (assignment LEMBUR period tsb ada). Bukti live: 11 order OT Agustus Paid via `PR-2026-08-SAL-01` padahal **tidak ada** assignment LEMBUR period 2026-08 (seed menulis status langsung — lubang yang sama terbuka di jalur runtime). Dampak: lembur "terbayar" di modul TA tapi tidak pernah masuk hitungan gaji.
- **M-03**: `markMedicalPaidForRun` (medical-service.ts:998-1016) memfilter `medicalClaim.periodCode = run.period.code` — kolom itu **tidak pernah diisi oleh kode mana pun** (hanya dibaca di list row 630). Seluruh klaim medical live: periodCode null. Callback payroll→medical = **no-op** (kaki integrasi mati namun tak error).
- **M-08**: Transfer ke period yang run SALARY-nya sudah Confirmed: period menjadi "Processed" (bukan Locked/Closed) → transfer masih diterima → assignment dibuat, klaim jadi Transferred, **tetapi run baru untuk period+type sama ditolak** (payroll-runs.ts:50) dan run lama tak bisa re-confirm → klaim **terjebak Transferred** sampai admin membatalkan & membuat ulang run (recovery manual yang tidak terdokumentasi). Berlaku untuk keempat transfer.
- **M-04**: Jendela transfer TA bebas (dipilih user) — mismatch dua arah dengan window yang dipakai `markOvertimePaidForRun` (period.startDate–endDate): lembur bisa ter-transfer untuk window A tapi ter-mark Paid untuk window B.

---

## 5. Audit Jurnal Lintas Sumber (PostingEvent/Account/PayrollJournal)

| Aspek | payroll run | travel claim | medical settle |
|---|---|---|---|
| Generator nomor | `JV-{th}-{count+1:3}` (payroll-journal.ts:46-51) | `JV-{th}-{max+1:3}` (travel-service.ts:580-588) | `JV-{parseInt(slice(3))}` (medical-service.ts:35-43) **bug parse** |
| Update `Account.balance` | ✅ (payroll-journal.ts:199-210) | ❌ | ❌ |
| PostingEvent | dibuat seed (PE-001..003) tapi **tidak dipakai** di jalur posting | — | — |
| Double-posting guard | ✅ unique `runId` | ⚠ delete+recreate journal klaim | ⚠ idem |

- **C-03 (nomor jurnal bertabrakan)**: tiga generator berbeda pada tabel yang sama dengan `journalNo @unique`. Generator payroll berbasis `count` → begitu travel/medical menghapus jurnal (pola delete+recreate: travel-service.ts:600-601, 679-682; medical-service.ts:664-666, 754-757), count turun di bawah max → nomor berikutnya payroll menabrak nomor yang sudah ada → P2002 → **confirmRun menelan error** (payroll-service.ts:386-396) → jurnal run hilang diam-diam. Bug parse medical terbukti live: jurnal medical bernomor **JV-2027, JV-2028, …, JV-2031** (meng-parse "JV-2026-001" → 2026). Urutan live saat ini: JV-2026-001..010 (payroll+travel tercampur) + JV-2027..2031 (medical).
- **C-04 (double posting travel)**: `generateClaimJournal` (travel-service.ts:592-655) posting **D beban 5105 / C kas 1101 sebesar seluruh settlement (termasuk `payableEmployee`)** pada saat approve. Saat klaim yang sama ditransfer, `transferClaimsToPayroll` membuat komponen **UTRP** (payableEmployee) yang masuk run payroll → jurnal run: D beban / C hutang gaji / D hutang gaji / C kas. Bagian yang dibayar ke karyawan terekam **dua kali di beban 5105 dan dua kali keluar dari kas 1101** (sekali via jurnal klaim, sekali via pembayaran net run). Bukti live: CL-2026-001 (Paid, journal JV-2026-005, payableEmployee 900.000) juga punya assignment UTRP 900.000 di period 2026-11 yang dibayar run PR-2026-11-SAL-01.
- **m-08 (konsistensi COA)**: hanya jurnal payroll yang memutasi `Account.balance`; jurnal travel (5105/1101) dan medical (5106/1101) tidak → saldo COA tidak konsisten dengan total jurnal.
- PostingEvent (schema baris 630) hanya diisi provisioning seed — **tidak pernah dibaca** oleh logika posting mana pun (kode mati arsitektural).

---

## 6. Audit Guard Auth & Tenant (tabel endpoint bermasalah)

**Isolasi tenant: BERSIH.** 73/73 file `api/*.ts` memanggil `requireTenant` di setiap handler (verifikasi programatik) → session HMAC + membership + status ACTIVE → schema tenant. Tidak ditemukan handler yang lupa guard.

**Otorisasi (role/identitas): KOSONG.** `requireTenant` tidak memuat role platform (OWNER/ADMIN/HR/VIEWER ada di `UserTenant.role` — tidak pernah dibaca). `AccessGroup.modulesJson` + `AccessGroupMember.isApprover` hanya dikelola di settings, **tidak diverifikasi di mana pun**. Akibatnya semua endpoint mutasi di bawah dapat dipanggil oleh member tenant **dengan role apa pun, termasuk VIEWER**:

| Endpoint mutasi | Identitas approver diperiksa? |
|---|---|
| `personnel-actions/[id]` PATCH (submit/approve/reject/process) | ⚠ **Palsu** — user hardcoded MII000001 (C-01) |
| `personnel-actions` POST/DELETE, `personnel-actions?mine=1` | ⚠ hardcoded MII000001 |
| `leave/requests` PATCH, `leave/encashment` PATCH | ❌ (actorId tidak dioper → decidedById null) |
| `travel/requests` PATCH, `travel/claims` PATCH | ❌ |
| `medical/claims` PATCH, `medical/adjustments` PATCH | ⚠ aktor dicatat (uid), tanpa role check |
| `benefit-claims` PATCH (approve/reject/schedule/markPaid) | ❌ `approvedBy` dari body client |
| `payroll-runs` PATCH (calculate/confirm/markPaid/cancel), `payroll-rapel`, loans, dll. | ❌ |
| `attendance/absence` POST transfer, `leave|travel|medical/transfer` POST | ❌ |
| `attendance/overtime`, `attendance/workoffs` keputusan | ❌ (approver string dari body) |
| `approval-templates` POST/DELETE, `temporary-approvers` POST/PATCH/DELETE, `access-groups`, `app-users` | ❌ (settings keamanan bisa diubah member mana pun) |

---

## 7. Data Flow TA → Payroll & Leave → TA

- **TA → payroll** = snapshot manual (oranHR-style): `transferToPayroll` → rekap `recapPeriod(from,to)` → assignment Specific LEMBUR/TLATE/TABS/TKEHADIRAN. Payroll engine (`buildRunRows`, payroll-service.ts:72-77) **tidak membaca AttendanceDaily sama sekali** — hanya Specific/Periodic assignment. Konsekuensi:
  - Karyawan tanpa data kehadiran → `recapPeriod` menghasilkan 0 potongan (baris harian kosong ≠ Absent) dan engine membayar gaji pokok penuh → **dibayar penuh tanpa peringatan** (G-04).
  - Period Desember tidak otomatis = daily 1–31 Des; window ditentukan operator (M-04) — bisa sengaja/diam-diam digeser.
- **Leave → TA**: approve/reject/cancel leave request memicu `regenerateDaily` per hari cuti (leave-service.ts:619-627, dynamic import) → status `OnLeave` dengan paid/unpaid + half-day (attendance-service.ts:146-167, 313-325). Absen & cuti **tidak double count** (cabang leave diperiksa sebelum cabang absent; rekap memisahkan `leavePaid/leaveUnpaid` vs `absentDays`). ✅ Ini integrasi lintas-modul tertulis yang paling sehat.
- **MassLeave** menghasilkan request status MassLeave → juga terbaca `leaveFor` (status in Approved/MassLeave). ✅

## 8. Dashboard / Meta Lintas-Modul

- `meta.ts:9-16`: `benefitPendingClaims` = `BenefitClaim(Pending)` modul payroll (live 3) — **tidak** sama dengan medical claims Submitted (live 4) maupun travel claims Submitted (live 2). Badge menu "Benefit Karyawan" hanya menghitung salah satu dari tiga sistem klaim.
- `dashboard.ts`: 100% HR (headcount, PA, aktivitas) — tidak ada KPI lintas modul (leave pending, TA anomali, klaim travel/medical, run payroll) meskipun tiap modul punya endpoint `overview` sendiri. KPI ganda tidak terjadi — hanya sempit cakupan (m-02).

## 9. ActivityLog

- Coverage proses penting: PA submit/approve/process ✅, confirm payroll + posting jurnal ✅, transfer TA/leave/travel/medical ✅, keputusan leave/travel/medical ✅ (medical terlengkap dengan statusLog per aktor).
- **Kosong**: keputusan lembur/workoff (decideOvertimeOrder/decideWorkoff), approve/reject BenefitClaim, schedule/markPaid benefit, mass leave generate (ada? "LeaveGenerate" ✅ 1 baris), ekspor ✅.
- **Tanpa aktor**: query live `appUserId IS NULL` = **75/75**. Hanya `personnel-actions-detail.ts:82` (dengan user hardcoded!) dan `app-users.ts:52` yang mengisi `appUserId` → jejak audit keputusan bisnis tidak dapat dibuktikan pelakunya (M-05).

## 10. Provisioning Tenant Baru

`register` → `provisionTenantSchema` (DDL 63 tabel) + `seedTenantReference` (lookup, komponen upah, COA 1101/2101-2105/5101-5104, PostingEvent, process type 7, regulasi+bracket+TER, template gaji, BenefitType 4) → `ensureAttendanceReference` (day type, schedule, AttendanceRule, komponen LEMBUR/TLATE/TABS/TKEHADIRAN) → `ensureLeaveReference` (12 jenis cuti + UCT) → `ensureTravelReference` (4 zona, 5 template, 14 jenis biaya, akun 5105, UTRP/TRVSTLIN) → `ensureMedicalReference` (jenis+provider, akun 5106, UMC). **Master semua modul: LENGKAP ✅.**
- ❌ Tidak membuat: `ApprovalTemplate` (fallback PA jadi 1 layer "HR Manager"), `AppUser`, `AccessGroup` → tenant baru tidak punya approver (approverId null → cabang cek identitas terlewati karena `me` = null) dan harus mengisi user manual sebelum approval bermakna (G-02).

---

## 11. Temuan per Severity (file:line · dampak · saran fix)

### KRITIS (3)
1. **C-01 · Identitas approver PA hardcoded** — `human-resource/api/personnel-actions-detail.ts:71`, `personnel-actions.ts:27,64,102,113-116`.
   Dampak: semua keputusan PA (approve/reject/process) dieksekusi atas nama MII000001 terlepas siapa yang login (termasuk VIEWER); PA baru menetapkan approverId tiap layer = pembuat → self-approval di semua layer; layer milik user role "Approver" tidak bisa diputus siapa pun (deadlock live PA-2026-0002); inbox `mine=1` palsu.
   Fix: resolve aktor dari session (`readSessionCookie` → uid → AppUser via relasi platform-user, atau simpan appUserId di session saat login); resolusi approver per layer dari role (AccessGroupMember.isApprover / template role → user); tolak `approverId == createdBy` kecuali layer selanjutnya.
2. **C-02 · Endpoint approval/transfer/payroll tanpa otorisasi role/identitas** — seluruh daftar tabel §6 (contoh: `leave/api/requests.ts:63`, `travel/api/claims.ts:91`, `payroll/api/benefit-claims.ts:77`, `payroll/api/payroll-runs.ts:80`, `time-attendance/api/absence.ts:49`, 3 `*/transfer`).
   Dampak: member tenant role VIEWER dapat menyetujui klaim, mengonfirmasi payroll run (memicu 5 callback + jurnal + penandaan Paid), mentransfer klaim ke payroll, dan mengubah settings keamanan (approval template, delegasi, access group, app user) → **bypass approval lintas modul**.
   Fix: middleware role (Viewer read-only; HR/Owner mutasi domain; Admin settings) berbasis `UserTenant.role` + `AccessGroup.modulesJson`; audit semua PATCH/POST/DELETE.
3. **C-04 · Double posting klaim travel (jurnal + payroll)** — `travel/services/travel-service.ts:592-655` (jurnal klaim: C 1101 sebesar total termasuk payableEmployee) × `travel-service.ts:717-790` (UTRP masuk run).
   Dampak: bagian reimburs karyawan tercatat dua kali sebagai beban (5105) dan dua kali keluar kas (1101) — laporan keuangan membengkak; bukti live CL-2026-001 (UTRP 900.000 di run Nov + jurnal klaim).
   Fix: saat `settlementMethod` payroll, jurnal klaim meng-credit 2101 (hutang gaji) untuk porsi `payableEmployee` bukan 1101; atau jurnal klaim hanya untuk porsi kas (a+loss) dan UTRP diposting run.

### MAJOR (8)
4. **M-01 · Delegasi TemporaryApprover tidak pernah diperhitungkan** — dipakai hanya di settings (`shared/api/temporary-approvers.ts`), tidak di `personnel-actions-detail.ts:96-131`. Dampak: fitur delegasi menyesatkan (UI menyatakan "Aktif"); approver cuti/pulang tidak tergantikan. Fix: sebelum cek approverId, cek delegasi aktif (docType, validFrom≤now≤validTo) → izinkan delegate.
5. **M-02 · markOvertimePaidForRun tanpa cek transfer** — `attendance-service.ts:654-673`. Dampak: lembur Approved ditandai Paid meski belum pernah masuk komponen payroll (live: 11 order Aug). Fix: tandai Paid hanya untuk order yang masuk assignment LEMBUR period run (join periodId), atau track transferRun di OvertimeOrder.
6. **M-03 · markMedicalPaidForRun no-op** — `medical-service.ts:998-1016` (filter `periodCode` yang tak pernah diisi). Dampak: kaki payroll→medical tidak berfungsi; laporan "transfer medis dibayar" tidak pernah benar. Fix: hapus callback, atau pindahkan penandaan ke MedicalBalance/transfer record dengan kolom yang memang ditulis `transferUnusedToPayroll`.
7. **M-04 · Window transfer TA tidak divalidasi** — `time-attendance/api/absence.ts:49-73`, `attendance-service.ts:570-648` (abaikan `PayrollPeriod.taStartDate/taEndDate`). Dampak: potongan/lembur bisa dipindahkan ke period yang tidak sesuai bulan kehadiran; markPaid window ≠ transfer window. Fix: default & validasi window = taStart/taEnd (fallback start/end period), tolak window menyilang period lain.
8. **M-05 · ActivityLog tanpa aktor** — 75/75 baris live `appUserId NULL`; hanya 2 call-site mengisi. Dampak: keputusan approve/settle/confirm tak dapat diatribusikan — lemah untuk audit SOX-style. Fix: helper `logActivity(db, session, …)` dipakai semua service (resep sama dengan medical).
9. **M-06 · AccessGroup/modulesJson/isApprover tidak pernah diverifikasi** — hanya CRUD `shared/api/access-groups.ts`. Dampak: permission matrix dekoratif. Fix: jadikan sumber otorisasi di middleware C-02.
10. **M-07 · Generator nomor jurnal bertabrakan** — `payroll-journal.ts:46-51` (count) vs `travel-service.ts:580-588` (max) vs `medical-service.ts:35-43` (parse `slice(3)` salah → live JV-2027..2031); kegagalan ditelan `payroll-service.ts:386-396`. Dampak: P2002 duplikat journalNo setelah jurnal dihapus → jurnal run hilang senyap; penomoran tidak konsisten lintas sumber. Fix: satu util `nextJournalNo(db, source)` berbasis `SELECT max` atas prefix `JV-{tahun}-` dengan parse suffix benar (atau tabel sequence), prefix per sumber (JVP/JVT/JVM), dan gagal-hard di confirmRun bila jurnal wajib gagal.
11. **M-08 · Transfer ke period yang run-nya sudah Confirmed → klaim terjebak Transferred** — `travel-service.ts:717-777`, `leave-service.ts:906-967`, `medical-service.ts:913-996`, `attendance-service.ts:570-648` (blokir hanya Locked/Closed, period "Processed" lolos). Dampak: assignment dibuat setelah snapshot run → tidak pernah dibayar, klaim menggantung tanpa jalur UI. Fix: tolak transfer bila period sudah punya run Confirmed/Paid untuk processType target, atau izinkan re-open run.

### MINOR (6)
12. **m-01 · meta.benefitPendingClaims hanya BenefitClaim payroll** — `shared/api/meta.ts:14` (live 3 vs medical Submitted 4, travel 2). Fix: badge gabungkan tiga sumber atau ganti label.
13. **m-02 · Dashboard tanpa KPI lintas modul** — `shared/api/dashboard.ts:10-33`. Fix: tambah panel leave pending/TA anomali/klaim/run bulan berjalan dari overview tiap modul.
14. **m-03 · Route leave tidak mengoper actorId** — `leave/api/requests.ts:71-75`, `leave/api/encashment.ts` (service sudah mendukung) → `decidedById` null.
15. **m-04 · approvedBy approver dari body client** — `payroll/api/benefit-claims.ts:87` → string bisa dipalsukan; default "Admin Payroll".
16. **m-05 · Nomor dokumen race (read-last + increment tanpa transaksi)** — `personnel-actions.ts:95-97`, `nextWorkoffNo`, `nextDocNo` leave/travel/medical — bentrokan concurrent → 500 unique. Fix: sequence tabel atau retry P2002.
17. **m-06 · COA balance hanya dimutasi jurnal payroll** — `payroll-journal.ts:199-210` vs travel/medical journal tanpa update Account → saldo akun tidak cocok dengan total jurnal.

### GAP (6) — mesin proses yang belum ada
18. **G-01 · Approval engine tunggal untuk seluruh modul belum ada**: multi-layer hanya PA; leave/travel/medical/benefit/overtime/workoff single-step tanpa template per proses, tanpa inbox approver per user, tanpa routing atasan langsung (manager karyawan tidak dipakai sebagai approver di modul mana pun). ApprovalTemplate.docType praktis satu nilai.
19. **G-02 · Approval master tidak diprovision untuk tenant baru** (ApprovalTemplate/AppUser/AccessGroup) → layer PA kosong & cek identitas terlewati.
20. **G-03 · Tidak ada notifikasi/reminder approval lintas modul** (tidak ada email/task inbox).
21. **G-04 · Payroll tidak melakukan sanity-check absensi** — run bisa dikonfirmasi tanpa transfer TA periode tsb tanpa peringatan; karyawan tanpa data kehadiran dibayar penuh secara default (by-design oranHR transfer, tapi tanpa guard).
22. **G-05 · Dua sistem klaim "benefit" paralel** — payroll `BenefitClaim` (Pending/Approved/Scheduled/Paid, auto-approve in-limit) vs medical `MedicalClaim` (Draft/Submitted/Approved/Settled) — dua sumber kebenaran untuk konsep serupa, badge meta & KPI terpisah.
23. **G-06 · PostingEvent tidak diimplementasikan** — model + seed ada (schema:630) tetapi tidak ada logika posting yang membacanya.

---

## 12. Hal yang Sudah BAIK (jangan dipecah saat refactor)
- Isolasi tenant 73/73 handler; session HMAC httpOnly; status tenant ACTIVE dicek.
- Idempotensi inti: run unik per period×type; confirm hanya dari Calculated; jurnal unik per run + cek balance D=C; transfer delete+recreate per period; medical mengonsumsi saldo saat transfer; encashment tidak bisa re-transfer lintas period (filter paymentDate window + status).
- Leave→TA: regenerasi AttendanceDaily OnLeave dengan paid/unpaid/half-day — absen vs cuti tidak double count; MassLeave terintegrasi.
- Payroll engine murni & teruji; snapshot run item (Specific assignment terkunci saat calculate) — perubahan master pasca-kalkulasi tidak merusak run.
- Provisioning master lengkap untuk 6 modul + komponen interface (LEMBUR/UCT/UTRP/UMC) + akun 5105/5106.

## 13. Urutan Rekomendasi Perbaikan
1. Identitas aktor + role guard (C-01, C-02, M-05, M-06) — fondasi semua perbaikan approval.
2. Jurnal: satu generator + fix credit-account klaim travel (C-03, C-04, m-06, m-08).
3. Kaki agregator: markOvertime cek transfer, markMedical dihapus/dibenerkan, validasi window transfer & period Confirmed (M-02, M-03, M-04, M-08).
4. Mesin approval generik (G-01): template per docType dipakai 6 modul, resolusi approver (atasan langsung/access group), delegasi diperhitungkan, inbox per user.
5. Provisioning approval master (G-02) + notifikasi (G-03).
