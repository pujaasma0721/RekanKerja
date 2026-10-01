# AUDIT INTEGRASI LINTAS-MODUL — RekanKerja HRIS (Task 40)

- Task ID: **40** (+ subtask paralel 40-a s/d 40-f) · Tanggal: **9 September 2026** · Mode: **READ-ONLY** (tidak ada perubahan kode; verifikasi runtime via API browser/curl + query DB read-only).
- Basis kode: commit `befb30d` (task 39) — sandbox tersinkron penuh, DB demo 3 tenant.
- Lingkup: **semua modul** (Leave, Time-Attendance, Payroll, ESS, Human Resource, Medical, Travel) + shared (approval engine, otorisasi, notifikasi, scheduler, webhook, rule engine) — fokus **integrasi antar modul & validasi lintas batas**.
- Metode: 6 audit domain paralel (pembacaan kode baris-per-baris, file:line) + **verifikasi empiris runtime** (golden path & negative test di sandbox MII).
- Pembanding: `audit/BPA-cross-module.md` (Task 24-g, 22 Jan 2026) — setiap temuan lama dicek ulang statusnya.

---

## 1. Ringkasan Eksekutif

| Dimensi | Hasil |
|---|---|
| Integrasi inti Leave ↔ Attendance | ✅ **SEHAT & terverifikasi live** — hari kerja cuti dihitung dari jadwal absensi nyata (assignment→cycle→day type + overlay libur nasional), contoh kasus user terpenuhi |
| Approval berjenjang lintas modul | ✅ 7 docType pakai engine generik (aktor sesi, delegasi, anti-self-approve, race-safe 409) — temuan lama G-01/C-01/C-02 tuntas di jalur utama |
| Payroll sebagai agregator | ✅ Arsitektur benar; 5 callback confirmRun kini akurat (M-02/M-03 lama fixed) — sisa lubang M-08 di leave & medical |
| **Settle klaim medis** | 🔴 **100% GAGAL di runtime** (bug nested `$transaction`) — klaim tidak pernah bisa menjadi Settled, jurnal tidak pernah tercipta |
| **Upah bulan terakhir karyawan keluar** | 🔴 **Tidak dibayar siapa pun** (semua jalur keluar: Terminasi/Resign/Retire) — underpayment sistemik |
| **Regen tanggal masa depan** | 🔴 **Menulis "Absent" fiktif** (terverifikasi live: approve izin 22 Sep hari ini → karyawan lain tercatat Absent di masa depan) → risiko potongan gaji fiktif |
| Otorisasi endpoint | ⚠ Sebagian besar terkunci (requireMenuAction per aksi); **7 endpoint master-data & ~45 endpoint mutasi masih longgar** |
| Jurnal lintas sumber | ⚠ Generator tunggal race-safe (M-07 fixed) — tapi **regresi baru di medical** + Account.balance hanya dimutasi payroll + **residu C-04 beban dobel travel** |
| Seed/provisioning environment baru | ⚠ restore-demo fresh-seed **parsial**: master TA (day type/schedule/assignment), leave types, medical types kosong — butuh migrasi manual |

**Hitungan temuan BARU: KRITIS 3 · MAJOR 14 · MINOR 30+ · GAP 12** (detail §5).
**Status temuan lama (24-g): KRITIS 3 → 2 FIXED + 1 PARTIAL · MAJOR 8 → 5 FIXED + 3 PARTIAL** — progres besar sejak audit lama (gelombang 3–5 + task 25/32–36).

### Matriks kesehatan integrasi (baris = alur lintas modul)

| Alur integrasi | Status | Bukti kunci |
|---|---|---|
| Leave → TA (hitung hari kerja dari jadwal) | ✅ | `leave-service.ts:80-85` → `resolveDayType` (`attendance-service.ts:130-186`) — **VERIFIED LIVE**: cuti 24–28 Des (Natal+weekend) = 1 hari kerja; Sen–Jum = 5 hari |
| Leave → TA (write path approve→OnLeave) | ✅ | `decideRequest:920-929` regenerateDaily; funnel tunggal; MassLeave & WorkOff terintegrasi |
| WorkOff ↔ Leave (potong/refund saldo) | ✅ | `applyWorkoffLeaveDeduction:1561-1655` docNo 1:1 idempoten + refund saat reject/cancel |
| Leave → Payroll (encashment UCT) | ✅/⚠ | reservasi + revalidasi serializable; **guard period Confirmed belum ada (M-08)** |
| TA → Payroll (transfer LEMBUR/TLATE/TABS) | ✅ | window divalidasi vs taStartDate/taEndDate + anti-overlap (M-04 fixed) |
| Overtime ↔ Approval ↔ Payroll | ✅ | chain "Overtime", cap harian 4 jam PP35, rekap hanya yang belum dibayar, markPaid cek item run (M-02 fixed) — **cap mingguan 18 jam TIDAK ada** |
| TA regen tanggal future | 🔴 | `regenerateDaily:497-500` tanpa guard `date > today` — **VERIFIED LIVE: MII00003 = Absent di 22 Sep (future)** |
| Medical ↔ Rule ↔ Payroll (plafon, klaim) | ✅/🔴 | plafon per karyawan via `MedicalBenefitTypeRule` jalan; kwitansi enforce; **settle gagal total (bug $transaction)** |
| Medical → Payroll (transfer UMC) | ⚠ | guard hanya Locked/Closed — period run-Confirmed lolos → saldo hangus diam-diam (M-08) |
| Travel ↔ Approval ↔ Settlement | ✅ | chain Travel + TravelClaim; settlement otoritatif server; jurnal credit 2101 utk porsi payroll (sisi kas C-04 fixed) |
| Travel → Payroll | ✅/⚠ | guard run Confirmed ada (M-08 fixed utk travel); **beban (b) dobel di 5105 — residu C-04** |
| HR/PA → struktur (promosi/mutasi/gaji) | ✅ | `pa-targets.ts` + assignment snapshot dalam 1 transaksi (K-1/K-2 fixed) |
| PA Termination → Settlement PHK → run | ✅/🔴 | pesangon UPMK + THR prorata + PPh final masuk run TERMINATION; **upah bulan terakhir TIDAK termasuk** |
| PA keluar → Offboarding auto + banner | ✅ | auto-create 9 tugas clearance + exit interview + banner profil (5eb6ed8 bekerja) |
| Resign terjadwal → scheduler | ✅ | job 6 jam idempoten, PA-aware |
| Surat (PA/Disiplin → LetterDocument PDF) | ✅ | snapshot body, NPWP per kantor, idempoten |
| ESS ↔ semua modul | ✅ | reuse service yang sama (single source of truth), scope employeeId ketat |
| Notifikasi ↔ approval lintas modul | ⚠ | event lengkap, **tapi link "actions:inbox" hanya memuat PA — approver modul lain tidak bisa buka dokumen** |
| Scheduler ↔ lintas modul | ✅/⚠ | 6 job jalan; **race multi-proses PM2 cluster** |
| Webhook / Public API | ✅/⚠ | HMAC + scope + rate limit; **tanpa retry, event travel/medical/OT/loan belum ada** |
| Rule engine ↔ 5 domain | ✅ | evaluasi nyata di engine payroll, saldo leave, plafon medical, limit travel, benefit — **2 mirror lokal masih pakai nilai dasar (drift)** |

---

## 2. Verifikasi Runtime (bukti empiris, sandbox MII, 9 Sep 2026)

| # | Uji | Hasil |
|---|---|---|
| V-1 | **Contoh user**: preview cuti 24–28 Des 2026 (Natal Kam 24 + Jum 25 + Sabtu + Minggu) | ✅ `workingDays: 1`, saldo 14→13, `backToWork 29 Des` — libur nasional + weekend dikecualikan; pembanding Sen–Jum 14–18 Sep = 5 hari, saldo 14→9 |
| V-2 | Guard backdate cuti (Maret 2026) | ✅ ditolak: "Tanggal mulai tidak boleh di masa lalu" |
| V-3 | Klaim medis end-to-end: upload kwitansi draft → create+submit → approve 2 jenjang | ✅ MC-2026-011 → Submitted → Approved; enforcement kwitansi (type needReceipt) bekerja; chain 2 level dengan aktor sesi |
| V-4 | **SETTLE klaim medis** | 🔴 **GAGAL 100%**: `{"error":"db.$transaction is not a function"}` HTTP 400 — klaim stuck `Approved`, jurnal tidak pernah dibuat (temuan K-1) |
| V-5 | Workoff masa depan: submit WO-2026-001 (22 Sep, paid, tanpa potong cuti) → approve 2 jenjang | ✅ validasi kombinasi paid/deductLeave; chain jalan; **TAPI regen menulis MII00003 = `Absent` di 22 Sep (future!)** (temuan K-3) |
| V-6 | State DB TA segar | ⚠ `ScheduleAssignment: 0`, `WorkDayType: 0`, `WorkSchedule: 0` (hanya `AttendanceRule: 1`) setelah restore-demo — modul presensi tidak berfungsi tanpa migrasi manual (temuan M-12) |
| V-7 | Seed master leave/medical | ⚠ leave types & medical types kosong sampai `migrate-leave.ts` / `migrate-medical.ts` dijalankan manual |

**Artifacts uji (sandbox MII, dibiarkan sebagai bukti):** klaim `MC-2026-011` (Approved, unsettled), workoff `WO-2026-001` (Approved), master `AUDIT-WORK/AUDIT-OFF/AUDIT-SCH`, assignment MII00002 & MII00003, baris AttendanceDaily 22 Sep (MII00003=Absent).

---

## 3. Temuan KRITIS (3) — perlu fix segera

### K-1 · Settle klaim medis gagal total (nested `$transaction`) — **TERVERIFIKASI LIVE (V-4)**
- **Lokasi**: `medical/services/medical-service.ts:1167-1170` (settle dibungkus `db.$transaction`) → `generateSettleJournal(tx):975` → `nextJournalNo(tx)` → `shared/lib/journal-no.ts:84` memanggil `tx.$transaction(...)`.
- **Root cause**: Prisma 6.11 TransactionClient **tidak punya `$transaction`** (nested transaction tidak didukung). Util `nextJournalNoInTx` (journal-no.ts:119) tersedia tapi tidak dipakai siapa pun.
- **Kronologi**: commit 2643074 membungkus settle dalam tx (saat itu generator masih sederhana → jalan); `a11e31c` membuat generator race-safe dengan `$transaction` internal → **sejak itu settle medis rusak**; tertutupi karena `medical-seed.ts:209-211` menelan error.
- **Dampak**: klaim tidak pernah bisa Settled; jurnal 5106/1101 tidak pernah tercipta; notifikasi settle tidak terkirim; seluruh alur klaim medis berhenti di Approved.
- **Fix**: pakai `nextJournalNoInTx(tx)` di `generateSettleJournal`, ATAU alokasikan journalNo SEBELUM `db.$transaction`. Tambah test E2E settle nyata.

### K-2 · Upah bulan terakhir karyawan keluar tidak dibayar (semua jalur)
- **Lokasi**: `payroll/services/payroll-service.ts:122-126` (buildRunRows non-TERMINATION: `status Active` + `assignments validTo:null`) × `personnel-actions-detail.ts:388` (`closeCurrentAssignment(validTo=lastDay)` saat PA diproses) × `settlement-service.ts` (run TERMINATION hanya komponen settlement).
- **Mekanisme**: PA diproses → assignment ditutup → karyawan **langsung** dikecualikan dari run SALARY bulan berjalan/berikutnya — termasuk hari kerja sebelum lastDay; `prorateFactor` hanya menghitung validFrom (joiner), tidak validTo (leaver). Run TERMINATION berisi pesangon/THR/cuti/pajak — **tanpa upah waktu kerja** (UU 13/2003). Resignation/Retirement bahkan tanpa settlement sama sekali.
- **Dampak**: underpayment sistemik & senyap upah terakhir + notice period.
- **Fix**: (a) settlement tambah baris GAJI_TERAKHIR = upah × prorate s.d. lastDay; atau (b) buildRunRows hitung prorate keluar berbasis `validTo` dalam period; (c) perluas trigger settlement ke Resignation/Retirement (penggantian hak 156(2), tanpa pesangon).

### K-3 · Regen tanggal masa depan menulis "Absent" fiktif — **TERVERIFIKASI LIVE (V-5)**
- **Lokasi**: `attendance-service.ts:497-500` (`regenerateDaily` tanpa guard `date > today`), dipicu `decideWorkoff → regenerateRange(permit.dateFrom..dateTo)` (:1850, :1876, :1920 — full range, semua karyawan) dan `decideOvertimeOrder` (:1282-1345) untuk tanggal future.
- **Dampak terukur**: approve izin 22 Sep pada 9 Sep → MII00003 tercatat **Absent** di 22 Sep tanpa clock data (hari belum terjadi). Bila window transfer TA default (bulan berjalan) menyentuh tanggal future → **potongan TABS fiktif gaji/25 × hari** (vektor L-04 lama, lewat jalur workoff/overtime yang tidak ikut difix; leave sudah fix di call-site-nya).
- **Fix**: guard sentral di `regenerateDaily` — `date > today && tidak ada clock log → jangan tulis Absent` (biarkan null/Off).

---

## 4. Temuan MAJOR (14)

| # | Temuan | Lokasi | Dampak | Fix |
|---|---|---|---|---|
| M-1 | **Regen future** (lihat K-3) | attendance-service.ts:497-500 | potongan gaji fiktif | guard tanggal sentral |
| M-2 | **7 endpoint master-data tanpa guard role** (requireTenant only): jenis cuti (entitlement!), aturan presensi (cap lembur/geofence), tipe hari, jadwal, budget & template travel | `leave/api/types.ts:37-40,72-75` · `ta/api/settings.ts:29-32` · `ta/api/day-types.ts:29` · `ta/api/schedules.ts:28` · `travel/api/budget.ts:19` · `travel/api/templates.ts:29` | pengguna terbatas bisa mengubah parameter yang menggerakkan saldo cuti, lembur & payroll | ganti ke `requireMenuAction(menu, op)` — pola 1 baris |
| M-3 | **Beban travel (porsi payroll b) dobel di 5105 + 2101 menumpuk** (residu C-04): jurnal klaim D 5105 sebesar penuh R; jurnal run D 5105 lagi utk UTRP (accountDebit 5105); 2101 kredit (b+c') tidak pernah dibersihkan; 2105 phantom | travel-service.ts:911-965 × provisioning.ts:719 × payroll-journal.ts:118-157 | laba rugi terdistorsi +b per klaim; neraca salah | UTRP jadi pass-through (debit 2101) ATAU jurnal klaim hanya porsi tunai; buat jurnal advance |
| M-4 | **c' (klamp jurnal) ≠ c (TRVSTLIN)** saat kasbon > realisasi | travel-service.ts:936 vs :1191-1203 | karyawan dipotong c penuh, buku hanya catat min(c,R) | simpan computedC + baris recovery |
| M-5 | **Drift mirror entitlement Task 33**: settlement PHK (uang cuti) & `annualAvailability` (guard izin workoff) pakai entitlement DASAR, bukan hasil `LeaveTypeRule` | settlement-service.ts:290-292 · attendance-service.ts:1468 vs leave-service.ts:151-152 | rule aktif (mis. tenure≥5th→14 hari) → settlement membayar terlalu kecil; guard izin salah ketat | helper bersama `effectiveEntitlement()` dipakai 3 tempat |
| M-6 | **Cap lembur MINGGUAN 18 jam (PP 35/2021 Ps.26) tidak diimplement** — hanya harian 4 jam + opsional bulanan | attendance-service.ts:1023-1104 | 6 hari × 4 jam = 24 jam/minggu lolos — pelanggaran regulasi | `maxOvertimeHoursWeekly` default 18 + validasi window Sen–Min |
| M-7 | **Transfer UMC/UCT ke period pasca-confirm = saldo/klaim hangus diam-diam** (M-08 lama, sisa di leave & medical — travel sudah fixed) | leave-service.ts:1295-1297 · medical-service.ts:1359-1361 | saldo dikonsumsi + assignment dibuat setelah snapshot run → tidak pernah dibayar; tanpa jalur recovery | tolak bila period punya run Confirmed/Paid utk processType target |
| M-8 | **Notifikasi approval link ke `actions:inbox` yang isinya hanya PA** — approver leave/workoff/overtime/travel/medical tidak bisa buka dokumen dari notifikasi | leave/api/requests.ts:99,149 · workoffs.ts:95,129 · overtime.ts:107,159 · travel/requests.ts:93,136 · medical/claims.ts:171,249 · scheduler-service.ts:667 × actions-module.tsx:57 | notification center tidak sampai ke tindakan | link ke menu approval modul; idealnya inbox approval generik berbasis ApprovalChain |
| M-9 | **Data-access scope hanya diterapkan modul HR** — GET list leave/medical/travel/loans/benefit menampilkan dokumen seluruh karyawan ke user non-VIEWER apa pun scope-nya | access-scope.ts dipakai hanya hr/* ; list: leave/api/requests.ts:13-23 dll | kebijakan scope data per pengguna bocor di modul transaksional | terapkan `scopeWhere` pada list lintas karyawan |
| M-10 | **Scheduler multi-proses tidak race-safe**: flag `running` per-proses + dedupe tanpa unique index ActivityLog; PM2 cluster → semua worker first-run T+60s bersamaan | scheduler-service.ts:96-101,161-174,903 | dobel email/notif pengingat; baris Reminder duplikat | unique index (action,entity,entityId) + ON CONFLICT DO NOTHING; atau scheduler single-instance |
| M-11 | **Encashment approved-not-transferred jadi Rp0 saat karyawan keluar** — transfer hitung ulang `activeSalary/25` (=0 tanpa assignment aktif) & settlement meng-exclude hari yang sudah `cashed` | leave-service.ts:1328-1329, :593-600 × settlement-service.ts:307 | hak uang cuti hilang total | transfer pakai `enc.amount` snapshot; tolak transfer karyawan non-aktif |
| M-12 | **PHK_POT_LOAN tidak disinkronkan ke buku EmployeeLoan** saat run TERMINATION dikonfirmasi (item wageType Deduction, bukan Loan) | payroll-service.ts:486-510 × settlement-service.ts:435 | piutang pinjaman overstated setelah dipotong dari settlement | sinkron paidAmount/outstanding saat confirm |
| M-13 | **Jalur terminasi senyap**: PATCH `endDate` bebas + scheduler memutus status tanpa PA/offboarding/settlement/penutupan assignment | employee-detail.ts:200 × scheduler-service.ts:272-317 | karyawan "Resigned" dengan assignment terbuka — bypass seluruh proses keluar | tolak endDate tanpa PA terminasi; atau job juga close assignment + offboarding |
| M-14 | **Webhook tanpa retry + katalog timpang** (tidak ada event travel/medical/overtime/loan meski engine mendukung); single fetch attempt 5 dtk | webhook-service.ts:17-25, 255-274 | integrasi eksternal kehilangan event saat receiver down | antrian retry/backoff + tambah event |
| (+) | **Fresh-seed parsial**: restore-demo tidak menjamin master modul (TA day type/schedule/assignment 0 baris; leave/medical types kosong — V-6/V-7) — kemungkinan error tertelan di tengah pipeline (pola sama dengan K-1) | scripts/restore-demo.ts + provisioning path | environment baru: modul presensi/cuti/medis tidak langsung berfungsi | audit pipeline seed; fail-loud per langkah |

---

## 5. Temuan MINOR terpilih (30+ total — lihat §8 per domain)

1. `decideRequest` menuntaskan chain FINAL sebelum validasi saldo (leave-service.ts:824 vs :875-906) — state inkonsisten saat saldo kurang (recoverable; workoff sudah meniru pola benar: pre-validasi).
2. ESS submit lembur/workoff/cuti tanpa `actorName` → ActivityLog tanpa aktor & approver jenjang pertama tidak dinotifikasi (ess/api/overtime.ts:33-39 vs api/overtime.ts:94-123).
3. Jam lembur jalur admin hanya regex `^\d{2}:\d{2}$` — "25:99" lolos → plan NaN → error 500 (attendance-service.ts:1125).
4. Jalur `verify` lembur tidak revalidasi cap kumulatif hari yang sama (attendance-service.ts:1320-1325).
5. `markEncashmentPaidForRun` tidak mencocokkan periodCode — dua period overlap bisa double-mark (leave-service.ts:1363-1371).
6. `transferEncashment` hitung ulang amount tanpa update snapshot `enc.amount` (L-07 masih terbuka).
7. Forfeit 31-12 hardcoded — mode ANNIVERSARY (Mar–Mar) carry hangus di tengah periode (leave-service.ts:173).
8. Tidak ada cancel/undo permintaan **Approved** & baris MassLeave (decideRequest hanya dari Submitted).
9. ESS estimasi cuti = hari kalender (label jujur, tapi est-remaining bisa tampak minus).
10. Medical: guard API tidak seragam (transfer/balances/types/providers = requireMutator tanpa op menu); ActivityLog tanpa appUserId (7 call-site); kwitansi level-klaim bukan level-baris; preview stale-year; ESS tidak bisa ajukan klaim medis (G-7 lama); offboarding ↔ saldo medis tidak terhubung; dependent tidak divalidasi vs EmployeeFamily; markMedicalPaidForRun fragile (string-match notes).
11. Travel: transfer tidak transaksional + idempotensi kunci `notes contains docNo` (tabrakan substring setelah 999 klaim); KPI campur klaim future/rejected; `requests.ts` PATCH tanpa mapping 403/409; label destinasi masih terbalik (m-4 lama); nextDocNo race; markPaid verifikasi keberadaan bukan nominal; chain status basi pasca-approve-cancel; limit per total baris (qty diabaikan, M-6 lama).
12. HR: `letters/issue` tidak validasi status PA (server terima PA Rejected); refNo surat count-based race; settlement bisa memilih period Closed; settlement tidak menandai `cashed` di LeaveBalance; ExtendProbation & Hire PA tetap no-op; privileged role masih bisa self-approve PA (trade-off terdokumentasi); Retirement → status "Resigned" (bukan "Retired").
13. Payroll: G-04 masih terbuka — karyawan tanpa data kehadiran dibayar penuh tanpa peringatan; `calculateAndSaveRun`/`confirmRun` tanpa sanity-check transfer TA.
14. Cross-cutting: ActivityLog keputusan leave/medical/travel/loan/payroll-confirm tanpa appUserId (M-05 lama PARTIAL); ~45 endpoint `requireMutator` tanpa op menu; badge meta masih campur (m-01); dashboard 100% HR (m-02); SLA label docType mentah; `findFirst({email})` tanpa orderBy; benefit claim/encashment/medical adjustment single-step (tanpa engine).

## 6. GAP (12)

1. Inbox "menunggu saya" lintas docType (approval generik) belum ada — hanya PA; ESS hanya count.
2. ESS self-service: klaim medis & klaim travel tidak bisa diajukan dari portal (read-only).
3. Offboarding ↔ medical/leave saldo tidak terhubung (sisa saldo resign hangus tanpa keputusan).
4. Advance travel: tidak dijurnal (D piutang/C kas saat Given) & tanpa skema pengembalian bertahap.
5. Tarif travel per zona/grade/durasi masih manual (rule hanya LIMIT, bukan tarif).
6. Multi-currency klaim travel.
7. Notifikasi WhatsApp hanya event leave.
8. Public API hanya 5 endpoint read + submit leave (event lain belum terbuka).
9. Benefit claim dua sistem paralel (payroll BenefitClaim vs MedicalClaim) — G-05 lama masih.
10. PostingEvent tetap kode mati (seed saja, tidak dibaca).
11. Cap lembur mingguan (juga M-6).
12. Pratinjau settlement bagi **approver** PA (hanya tersedia di dialog create).

---

## 7. Status Temuan Lama (24-g) — rekap perbaikan sejak audit terakhir

| Temuan lama | Status kini | Bukti |
|---|---|---|
| **C-01** PA approver hardcoded MII000001 | ✅ **FIXED** | aktor sesi nyata (personnel-actions-detail.ts:209-229); resolusi approver per layer dari struktur/role; delegasi aktif; grep MII000001 → hanya komentar |
| **C-02** endpoint tanpa otorisasi role | ✅ **MOSTLY FIXED** | requireMenuAction per aksi + engine 403/409 + VIEWER ditolak; sisa: M-2 (7 endpoint master) + ~45 requireMutator |
| **C-03** generator jurnal bertabrakan | ✅ **FIXED** | util tunggal `nextJournalNo` (advisory-lock + retry) dipakai payroll/travel/medical — **tapi memicu K-1 di medical (regresi nested tx)** |
| **C-04** double posting travel | ⚠ **PARTIAL** | sisi kas fixed (credit 2101 utk porsi payroll); **sisi beban masih dobel** (M-3) |
| **M-01** delegasi tidak dipakai | ✅ **FIXED** | engine + PA memakai findActiveDelegation, jejak "(delegasi dari X)" |
| **M-02** markOvertimePaid tanpa cek transfer | ✅ **FIXED** | hanya karyawan + item LEMBUR di run + window nyata + decidedAt≤calculatedAt |
| **M-03** markMedicalPaid no-op | ✅ **FIXED** | redesign menandai assignment UMC yang benar masuk run (sisa fragilitas notes-match) |
| **M-04** window transfer TA bebas | ✅ **FIXED** | default/validasi taStartDate/taEndDate + anti-overlap + persist window |
| **M-05** ActivityLog tanpa aktor | ⚠ **PARTIAL** | HR/payroll-markPaid/settings mengisi; keputusan leave/medical/travel belum |
| **M-06** AccessGroup tidak diverifikasi | ⚠ **PARTIAL** | AccessGroup dekoratif — tapi digantikan UserMenuAccess (LIVE) + DataAccessRule per user |
| **M-07** generator jurnal | ✅ **FIXED** | (lihat C-03) |
| **M-08** transfer ke period Confirmed | ⚠ **PARTIAL** | travel fixed; **leave & medical belum (M-7)**; TA terlindungi tidak langsung via window-overlap |
| **m-01..m-06** | ⚠ campuran | m-03/m-04/m-05(approver body) FIXED; m-01 PARTIAL; m-02 NOT FIXED; m-06 NOT FIXED (Account.balance) |
| **G-01** approval engine tunggal | ✅ **FIXED** | engine generik 7 docType + struktur 6-dimensi + tier nominal + fallback anti-deadlock |
| **G-02** provisioning approval master | ✅ **FIXED** | provisioning.ts:340-359 default structures per tenant (PA fallback aman) |
| **G-03** notifikasi approval | ✅ **FIXED** | notification center + email 16 template + SLA scheduler (sisa link salah — M-8) |
| **G-04** payroll sanity-check absensi | ❌ **NOT FIXED** | karyawan tanpa data kehadiran tetap dibayar penuh tanpa peringatan |
| **G-05** dua sistem benefit paralel | ❌ masih | (GAP-9) |
| **G-06** PostingEvent mati | ❌ masih | (GAP-10) |

---

## 8. Peta Detail per Domain (konsolidasi sub-audit 40-a s/d 40-f)

### 8.1 Leave ↔ Attendance ↔ Payroll (40-a)
- **Hari kerja** (contoh user): `isWorkday` → `resolveDayType` membaca Assignment→Schedule cycle→WorkDayType + overlay HolidayDate (libur MENANG) + fallback Sen–Jum tanpa jadwal. Half-day AM/PM −0,5/sesi. Estimasi dialog admin = backend `previewRequest` (tanpa drift FE). **Estimasi ESS = hari kalender (minor)**.
- **Write path**: approve → `regenerateDaily` (OnLeave paid/unpaid/half) dari funnel tunggal; MassLeave terintegrasi (masa lalu semua karyawan, masa depan hanya target); absen vs cuti tidak double-count (recap memisah).
- **Saldo**: prorata bulan kalender (bukan kehadiran), hangus 31-12 dinamis, `LeaveTypeRule` (Task 33) dievaluasi di 7 titik. Reservasi pending + revalidasi `runTx` Serializable + retry P2034 — solid.
- **Encashment → UCT**: window + idempoten; guard period Confirmed belum (M-7); amount dihitung ulang tanpa update snapshot (minor).
- **WorkOff ↔ Leave** arsitektur mirror elegan (docNo 1:1, refund, pre-validasi sebelum chain final) — desain idempoten & race-aware.

### 8.2 Attendance/Overtime ↔ Approval ↔ Payroll (40-b)
- **Lembur**: validasi format + kategori hari (overlay libur) + chain "Overtime" + revalidasi cap SEBELUM chain final; actual = overlap order×clock (cap 600 mnt); tanpa clock → verified 0 + wajib verifikasi manual (fix M-7 lama).
- **Uang**: 1/173 × multiplier (tier Holiday PP35 Ps.28 2×/3×/4×), potongan telat 1/173, absen 1/25 — konsisten lintas GET estimasi/rekap/transfer.
- **Transfer → payroll**: window tervalidasi + anti-overlap + persist; rekap hanya `paidRunNo null`; markPaid cek item di run (M-02/M-04/K-1/K-3 lama FIXED).
- **ESS**: service yang sama + geofence 3-mode (Off/Warn/Strict, haversine × radius) + single-IN guard — lebih ketat dari jalur admin (by design).
- **ShiftSwap**: benar-benar memutasi ScheduleAssignment (override 1-hari per pasangan + regen + cek clash).
- **Cap PP35**: harian 4 jam ✓ + opsional bulanan; **mingguan 18 jam TIDAK ada (M-6)**; jalur verify lolos dari cap kumulatif (minor).

### 8.3 Medical ↔ Rule ↔ Payroll (40-c)
- **Plafon per karyawan** (Task 33): generateBalances (ctx 1-Jan tahun target) + fallback on-the-fly + rule FACTOR/WAGE_COMPONENT dari gaji — dievaluasi nyata, bukan CRUD dekoratif.
- **Klaim**: validasi tanggal/frekuensi/dedupe kwitansi in-claim & lintas-klaim; HARD guard pool (reservasi pending, pool SHARED vs dependent); re-check saldo saat approve DAN settle.
- **Kwitansi (T16-ATTACH)**: server-authoritative (draft→rebind→enforcement ulang saat submit dari Draft; sapu saat cancel) — **VERIFIED LIVE (V-3)**.
- **Settle**: 🔴 K-1 (gagal total — nested $transaction).
- **Transfer UMC**: konsumsi saldo (guard ganda) tapi period guard lemah (M-7).
- **Jurnal**: nilai terenkripsi; Account.balance tidak dimutasi (m-06); markMedicalPaidForRun sudah diarahkan ke objek benar.

### 8.4 Travel ↔ Approval ↔ Settlement ↔ Payroll (40-d)
- **Request**: validasi tanggal per-kaki + template + chain nominal advance; reject/cancel guard klaim; advance Requested→Given(final)→Void.
- **Klaim**: limit `TravelExpenseTypeRule` + fallback; K-2 satu klaim aktif per request; tanggal biaya dalam trip; **settlement otoritatif server** (b/c dihitung server, input klien diabaikan); chain "TravelClaim" nominal totalSettlement; mid-tier tanpa jurnal.
- **Jurnal klaim**: credit 2101 utk porsi payroll + 1101 porsi tunai (sisi kas C-04 fixed); **beban masih dobel (M-3)**; clamp c' ≠ c (M-4); Account.balance tidak dimutasi (m-06).
- **Transfer**: guard run Confirmed/Paid ✓ (M-8 fixed utk travel); scope rewrite per klaim; assignment terenkripsi; **tidak transaksional + kunci notes-substring (minor)**.
- **MarkPaid**: verifikasi item UTRP/TRVSTLIN di run + ActivityLog skip — akurat (existence-check, bukan nominal).

### 8.5 HR/PA/Offboarding ↔ Payroll ↔ ESS (40-e)
- **PA**: aktor sesi (C-01 fixed); resolusi approver per layer (atasan langsung via assignment snapshot, role via AppUser); guard self-approve (kecuali privileged — trade-off terdokumentasi); semua efek PA dalam 1 `$transaction` (assignment + PKWT + status) — K-1/K-2 lama fixed.
- **Settlement PHK**: pesangon UPMK tabel benar, uang pisah, THR prorata PMK-168, uang cuti (mirror lokal — lihat M-5), pinjaman, PPh final 0/10/20/25 (PP 68/2009 5(3)); komponen SeveranceFinal dikecualikan pajak progresif; idempoten; **K-2: tanpa upah bulan terakhir; M-11/M-12**.
- **Offboarding**: auto-create saat PA keluar diproses (dedupe, best-effort + flag ke UI); 9 tugas clearance + tugas aset dinamis + exit interview + freeze + banner profil; resign terjadwal scheduler PA-aware.
- **Surat**: snapshot body tahan edit template; idempoten; NPWP per kantor di kop; gaji hanya template sensitive.
- **ESS**: `requireEss` wajib tautan AppUser↔Employee (403 tanpa); semua endpoint scope `actor.employeeId`; payslip ownership 403; mode admin hanya navigasi.
- **Import**: dry-run vs commit batch transaksional; dedupe NIK terenkripsi via match JS; prefix company.code.

### 8.6 Cross-cutting (40-f)
- **Approval engine**: struktur 6-dimensi ter-spesifik-menang; 5 tipe resolusi approver + fallback anti-deadlock; self-approval skip + dedupe jenjang; race-safe conditional updateMany (409); delegasi aktif dengan jejak; SLA 3 hari (scheduler); backfill legacy. **PA masih mekanisme layer sendiri** (kompatibel, delegasi dipakai bersama).
- **Otorisasi**: sesi HMAC + sessionVersion revokasi + MFA TOTP (secret AES-GCM); requireMenuAction fail-closed; VIEWER ditolak; sisa celah M-2.
- **Notification center**: never-throw, resolusi deklaratif (employee/nextApprover/admins), bell unread, ownership, dedupe, housekeeping 180 hari; email 16 template + self-heal; WA event leave.
- **Scheduler**: 6 job idempoten (resign terjadwal / kontrak-probation band 30-60-90 / dokumen ≤30 hari / SLA approval / payroll D-3 / housekeeping); per-job per-tenant try-catch; env flags; **race multi-proses M-10**.
- **Webhook & Public API**: HMAC-SHA256 body persis + log verifikasi ulang; kunci hanya hash; scope 3-level; rate limit 60/mnt; revoke seketika; audit aktor apikey:{prefix}; **tanpa retry + event timpang (M-14)**.
- **Rule engine**: core murni + ctx 20 parameter (job+personal+assignment); priority ASC first-match; AND/OR (Task 36) backward-compat; presedensi assignment>rule>dasar eksplisit di payroll; simulasi per karyawan (entity-rules + wage preview); CRUD ter-guard menu.

---

## 9. Hal yang Sudah BAIK (jangan dipecah saat refactor)

1. **Rantai leave→TA→payroll inti sehat end-to-end** — hari kerja dari jadwal nyata, regen idempoten satu funnel, potongan cuti/absen tidak double-count.
2. **Approval engine generik matang** — 7 docType, resolusi approver struktural, delegasi, race-safe, fallback anti-deadlock (M-01/G-01/C-01/C-02 tuntas di jalur utama).
3. **Idempotensi inti**: run unik period×type; confirm hanya dari Calculated; jurnal unik + D=C balance check; transfer delete+recreate; medical konsumsi saldo; encashment reservasi + revalidasi serializable.
4. **Settlement PHK regulasinya matang** (tabel UPMK, PPh final, pengurang BPJS di engine) — kecuali K-2.
5. **WorkOff↔Leave mirror** & **ShiftSwap override assignment** — desain idempoten elegan.
6. **ESS memakai service yang sama persis** (single source of truth) + scoping ketat.
7. **Enforcement kwitansi server-authoritative** (travel + medical).
8. **Enkripsi uang/NIK per-tenant (28-c)** konsisten lintas jalur dengan dekripsi transparan di batas serializer.
9. **Notifikasi + scheduler + email template** — G-03 tuntas.
10. **Journal generator tunggal race-safe** (M-07/C-03 fixed — perlu migrasi medical ke varian InTx, K-1).

---

## 10. Urutan Rekomendasi Perbaikan

1. **K-1** — settle medis (1-baris: `nextJournalNo` → `nextJournalNoInTx` di `generateSettleJournal`) + test E2E settle.
2. **K-3** — guard tanggal future di `regenerateDaily` (mencegah Absent & potongan fiktif).
3. **K-2 + M-11/M-12** — upah terakhir + settlement resign/retire + sinkron buku pinjaman.
4. **M-2** — guard 7 endpoint master-data (1 baris per file).
5. **M-8** — perbaiki link notifikasi approval ke menu modul (UX approver lintas modul).
6. **M-7** — guard period Confirmed untuk transfer UCT (leave & medical).
7. **M-3/M-4** — rapih posting jurnal travel (UTRP pass-through / pecah beban) + samakan clamp c.
8. **M-10 + M-14** — scheduler single-instance/unique index; webhook retry.
9. **M-5** — helper entitlement efektif bersama (3 tempat).
10. **M-6** — cap lembur mingguan 18 jam.
11. **M-13 + minor** — tutup jalur terminasi senyap; batch minor per modul.
12. **Seed/provisioning** — fail-loud pipeline restore-demo agar master semua modut terjamin di environment baru.

---

## 11. Lampiran: artefak & cara replikasi verifikasi

```bash
# V-1 (leave ↔ jadwal): login → POST /api/rekankerja/leave/requests {preview:true, ...}
#   rentang 2026-12-24..28 → workingDays:1 | 2026-09-14..18 → workingDays:5
# V-4 (settle medis): klaim Approved → PATCH {action:"settle"}
#   → 400 {"error":"db.$transaction is not a function"}
# V-5 (Absent future): assignment 2 karyawan (jadwal 7×Workday) →
#   workoff 2026-09-22 utk MII00002 → approve (2 jenjang) →
#   SELECT status FROM AttendanceDaily WHERE workDate='2026-09-22':
#   MII00002=WorkOff, MII00003=Absent  ← fiktif (hari belum terjadi)
```

---

## 12. STATUS PERBAIKAN — Task 41 (9 September 2026, pasca-audit)

Mode: **FIX** (6 workstream paralel + wiring orchestrator + verifikasi E2E live).

### KRITIS — semua FIXED & terverifikasi

| # | Temuan | Status | Bukti verifikasi |
|---|---|---|---|
| K-1 | Settle klaim medis gagal (nested `$transaction`) | ✅ **FIXED** | `generateSettleJournal` kini menerima `Prisma.TransactionClient` + `nextJournalNoInTx` (lock advisory s.d. commit). **E2E live: MC-2026-011 → Settled, jurnal JV-2026-0001 (2 baris, Posted), saldo used +1,5jt, UI menampilkan "Disetujui & Dibayar · jurnal JV-2026-0001"** |
| K-2 | Upah bulan terakhir karyawan keluar tidak dibayar | ✅ **FIXED** | buildRunRows memuat leaver (status keluar + assignment validTo ≥ periodStart) dengan prorate simetris joiner (basis hari kalender inklusif); keluar sebelum period tetap dikecualikan. **E2E in-process: leaver validTo 15 Sep → prorate 0,5; validTo 31 Agu → dikecualikan; branch TERMINATION tak berubah**. Settlement kini juga dibuat untuk PA Resignation/Retirement (Penggantian Hak Ps.156(2)(c) — uang cuti rule-aware + potongan + PPh final, tanpa pesangon) |
| K-3 | Regen tanggal future menulis "Absent" fiktif | ✅ **FIXED** | Guard sentral di `regenerateDaily` (sebelum upsert): `start > today && status === "Absent"` → baris TIDAK ditulis + baris fiktif lama dihapus (deleteMany). OnLeave/WorkOff/Off future tetap ditulis. **E2E live: cancel WO-2026-001 → baris Absent fiktif MII00003 (22 Sep) terhapus; workoff future 2026-10-06 → MII00002=WorkOff, MII00003 tanpa baris Absent** |

### MAJOR — semua FIXED

| # | Temuan | Status | Ringkasan fix |
|---|---|---|---|
| M-1 | Regen future (= K-3) | ✅ | lihat K-3 |
| M-2 | 7 endpoint master-data tanpa guard role | ✅ | Semua kini `requireMenuAction(menu, op)` (create/update) — VIEWER ditolak 403; GET tak dilonggarkan |
| M-3 | Beban travel dobel 5105 + 2101 menumpuk | ✅ | UTRP pass-through di payroll-journal (D 2101, khusus wageCode UTRP — beban 5105 tepat 1× di jurnal klaim); jurnal klaim: C 2101 = b saja; kasbon c → D 2105 ditutup TRVSTLIN; jurnal advance retroaktif D 1101 saat Given (GAP-4 ikut tertutup). Matriks 8 skenario: 5105=R sekali, 2101/2105 net 0, D=C |
| M-4 | Clamp c' ≠ c (jurnal vs TRVSTLIN) | ✅ | Kasbon jurnal = c penuh (payableCompany) — sumber nilai sama dengan assignment TRVSTLIN & tampilan settlement |
| M-5 | Drift entitlement (mirror lokal pakai nilai dasar) | ✅ | Helper bersama `leave/services/entitlement.ts` (rule-aware, leaver-aware) dipakai: leave-service (availableForRequest), settlement (CUTI_CASH), attendance (annualAvailability guard workoff) |
| M-6 | Cap lembur mingguan 18 jam tidak ada | ✅ | `WEEKLY_OT_CAP_MINUTES = 18×60` (konstanta statutory) — enforce di submit/approve/verify, jendela Senin–Minggu, sumber menit konsisten rekap. **E2E live: 4×4jam diterima, pengajuan ke-5 (20 jam) ditolak "PP 35/2021 Ps.26"** |
| M-7 | Transfer UCT/UMC ke period pasca-confirm | ✅ | Guard mirror travel di leave (transferEncashment) & medical (transferUnusedToPayroll): period punya run Confirmed/Paid → tolak |
| M-8 | Notifikasi approval link ke inbox PA-only | ✅ | Semua notifyEvent approver kini link ke view modul: `leave:leave-approval`, `attendance:overtime`, `attendance:workoff`, `travel:travel-approval`, `travel:travel-claim-approval`, `medical:medical-approval` |
| M-9 | Data-access scope hanya modul HR | ⏸ **DEFERRED (disengaja)** | Risiko functional: approver dengan scope rules akan berhenti melihat dokumen yang harus ia putuskan. Perlu desain scope-aware (approver bypass) — lihat §13 |
| M-10 | Scheduler multi-proses race | ✅ | Job mutex `pg_try_advisory_lock` per (job,tenant) + partial unique index `ActivityLog_dedu_reminder` + INSERT ON CONFLICT DO NOTHING. **Diterapkan 3/3 tenant (migrasi) + provisioning tenant baru**. Live: siklus scheduler 3/3 tenant OK |
| M-11 | Encashment approved jadi Rp0 saat karyawan keluar | ✅ | Transfer pakai snapshot `enc.amount`; approval me-refresh & persist snapshot (L-07 ikut fixed); karyawan tanpa assignment aktif mempertahankan snapshot |
| M-12 | PHK_POT_LOAN tak sinkron ke buku EmployeeLoan | ✅ | confirmRun TERMINATION: item PHK_POT_LOAN → update EmployeeLoan (rujukan letterNo via notes assignment → fallback oldest-first), paidAmount/outstanding/status PaidOff + angsuran Pending→Skipped, best-effort + ActivityLog |
| M-13 | Terminasi senyap (PATCH endDate + scheduler) | ✅ | PATCH endDate non-kosong → 400 "harus melalui Personnel Action" (mengosongkan tetap boleh). **E2E live: setError 400 + clear null OK**. Scheduler resign job tetap PA-aware (endDate kini hanya bisa berasal dari PA) |
| M-14 | Webhook tanpa retry + katalog timpang | ✅ | Kolom WebhookLog (attempts/nextRetryAt/lastError + index) di schema-tenant + tenant-ddl + migrasi 3/3 tenant; backoff [5m,30m,2h,6h,24h] maks 5 → dead; job scheduler `webhook-retry` (mutex-guarded, re-sign payload); katalog +4 event (travel.request.approved / medical.claim.submitted / overtime.approved / loan.created) — emission di loans.ts + travel requests + medical claims + overtime PATCH (final approve) |

### Minor terpilih yang ikut diperbaiki

- (1) decideRequest leave: pre-guard saldo+bentrok SEBELUM approval final (400 sebelum mutasi; revalidasi serializable tetap otoritatif).
- (2) ESS submit overtime/workoff/cuti: actorName + notifikasi approver jenjang pertama kini terkirim.
- (3) Validasi jam ketat HH:MM (00–23/00–59) — "25:99" ditolak.
- (4) Verify lembur re-validasi cap kumulatif harian+mingguan (excludeOrderId).
- (5) markEncashmentPaidForRun match periodCode run (window fallback hanya baris legacy).
- (6) L-07: snapshot amount dipersist saat approval.
- (11 travel) transferClaimsToPayroll kini `$transaction` (anti race); requests.ts PATCH mapping 409/403; label destinasi ditukar.
- (12 HR) settlement tolak period Closed/Locked; Retirement→Resigned tetap (enum tanpa "Retired" — terdokumentasi).
- (14 cross) appUserId di ActivityLog keputusan medical (5/7 call-site; 2 sisanya di luar jangkauan file); badge log webhook granular (Delivered/Retry n/5/Dead).
- Fresh-seed: provisioning kini juga memasang index dedupe Reminder untuk tenant baru.

### Verifikasi gabungan (Task 41)

- `bun run lint` ✅ 0 error · `bunx tsc --noEmit` ✅ 0 error (dependency `@cantoo/pdf-lib` yang hilang dari sandbox ikut di-install).
- E2E live (sandbox MII, server dev): login → 12/12 pemeriksaan PASS (settle+UI, regen future, guard endDate, render).
- Browser (agent-browser): login form → pilih workspace → shell + modul Medical → detail klaim MC-2026-011 menampilkan jurnal — tanpa error konsol/hidrasi.
- Migrasi DB: `migrate-scheduler-race.ts` + `migrate-webhook-retry.ts` → 3/3 tenant OK, idempoten; `tenant:ddl` + `db:generate` dijalankan.

### Sisa yang tidak dikerjakan (disengaja / deferred)

- **M-9** — scopeWhere di list modul transaksional (perlu desain approver-bypass, risiko tinggi bila asal diterapkan).
- Inbox approval generik lintas docType (GAP-1), ESS ajukan klaim medis/travel (GAP-2) — fitur baru, bukan perbaikan bug.
- Presisi sub-rupiah jurnal vs assignment TRVSTLIN (Math.round vs round2 — pre-existing, kini hanya selisih pembulatan).
