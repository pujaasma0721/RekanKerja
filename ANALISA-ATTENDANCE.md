# ANALISA DEEP-DIVE: Modul Time Attendance oranHR → Rencana Implementasi Attendance RekanKerja

> Dokumen analisa murni. Basis: eksplorasi langsung demo.oranhr.com (login MII000001,
> PT Mitra Industri Internasional / "MII", versi 11.08.00) — seluruh 28 halaman modul
> Time Attendance dipetakan via navigasi tree & data nyata dibaca via endpoint OrangeWS
> (JSONP), ditambah halaman fitur oranhr.com. Tanggal: sesi analisa attendance.
> Penulis: agent RekanKerja.

---

## 1. PETA MODUL TIME ATTENDANCE ORANHR (28 HALAMAN, 7 GRUP)

```
TIME ATTENDANCE
├─ Employee Schedule Assignment ........... /EmpWorkSchedule.jsp   (penugasan jadwal per karyawan)
├─ Employee Schedule Information .......... (view jadwal efektif, read-only)
├─ Employee Schedule Matrix ............... (matriks karyawan × hari)
├─ TRANSACTION (input transaksi harian)
│   ├─ Employee Overtime Work Order ....... /EmpOvertimeWrit.jsp  ★ pengajuan lembur
│   ├─ Employee Overtime Work Order Approval
│   ├─ Employee Work Off Permission ....... /EmployeeWorkOff.jsp  ★ izin/libur dibayar-tidak
│   ├─ Employee Work Off Permission Approval
│   ├─ Employee Clocking .................. /EmpClocking.jsp     ★ rekap harian (per tanggal)
│   ├─ Employee Clocking Approval ......... (approval koreksi clocking)
│   ├─ Employee Work Day Request Changes .. (tukar hari kerja) + To Approve
│   ├─ Employee Temporary Schedule ........ (jadwal sementara musiman)
│   └─ Transfer to Payroll ................ /TransferPayroll.jsp  ★ JEMBATAN KE PAYROLL
├─ QUERY (laporan)
│   ├─ Query - Non Clocking Employee ...... (karyawan tanpa clocking)
│   ├─ Query - Employee Clocking .......... (detail clocking)
│   ├─ Query - Employee Attendance ........ (rekap kehadiran per karyawan per tanggal)
│   ├─ Query - Employee Absence ........... (rekap absen)
│   ├─ Query - Employee Tidiness .......... (keterlambatan & pulang cepat)
│   └─ Query - Employee Day Type .......... (distribusi tipe hari)
├─ IMPORT (integrasi mesin & mobile)
│   ├─ Import Clocking File Configuration . (format file mesin fingerprint)
│   ├─ Import Clocking File ............... (upload data absen mesin)
│   ├─ Temporary Employee Clocking ........ (clocking sementara/manual)
│   ├─ Mark Location ...................... (penandaan lokasi GPS/geofence)
│   └─ Employee Check Location Exception .. (pengecualian lokasi)
└─ GENERAL SETTINGS (master & parameter)
    ├─ Day Type ........................... /DayType.jsp          ★ master tipe hari (18 baris MII)
    ├─ Day Substitute ..................... (OS = Off Shift, PH = Libur Nasional)
    ├─ Work Schedule ...................... /WorkSchedule.jsp     ★ master jadwal + cycle 7 hari
    ├─ Overtime Specified ................. (WageOvertimePres: map komponen upah ↔ kategori jam)
    ├─ User Defined Rounding .............. (pembulatan menit clocking)
    ├─ Time Attendance Report Template .... (template laporan)
    └─ Absence Wage Rules ................. (wage code absen: butuh dokumen? potong cuti?)
```

Integrasi yang diklaim situs resmi: **Payroll Administration, Leave Administration,
Travel Administration** (jam kerja saat perjalanan dinas dianggap kerja).
Reminder home page MII memperlihatkan approval TA yang aktif: **6 Overtime Work Order,
5 Work Schedule Changes, 10 Employee Work Off** — semua transaksi TA punya alur approval sendiri.

---

## 2. DATA MODEL INTI (dari grid + form + API nyata)

### 2.1 Day Type — master tipe hari (18 baris di MII) — 40+ atribut

Kunci seluruh perhitungan. Satu Day Type = satu "bentuk hari" (jam kerja, istirahat,
toleransi, komponen upah). Contoh data MII:

| Kode | Deskripsi | In | Out | NextDay | Break | NormalHour | AbsenceWage | Toleransi |
|---|---|---|---|---|---|---|---|---|
| `07-16` | 07:00-16:00 | 07:00 | 16:00 | - | 1j | 8 | ABTK | ±1 |
| `08:00-17:00` | PAGI | 08:00 | 17:00 | - | - | 9 | ABCK | ±1 |
| `17:30-06:00` | Shift Malam | 17:30 | 06:00 | ✔ | 1j | 8 | ABS | ±5 |
| `830-1630` | Office | 08:30 | 16:30 | - | 1j | 7 | ABSEN | 2/1 |
| `FLEXIBLE` | Flexible | 07:00 | 15:00 | - | - | 7 | ABTK | ±6 |
| `LONG SHIFT 1` | 06:30-18:30 | 06:30 | 18:30 | - | 3j | 9 | ABTK | ±6 |
| `LS1` | Long Shift Pagi 09:00-18:00 | 09:00 | 18:00 | - | 1j | 8 | ABS | 9/8 |
| `OFF`/`OFF2`/`OFFSAT`/`OFFSPH` | hari libur | - | - | - | - | - | - | - |
| `OFFTRAVEL` | off saat travel | 00:00 | … | | | | | |

Atribut lengkap (dari header grid): code, description, **color legend** (kode warna UI!),
**time_in, time_out, next_day** (shift lintas hari), **break start/end/hour**,
**break wage** (`BREAK` = Break/Lunch), **normal_hour**, **in-site wage** (`ATTDAYIN`
Normal Working Days In-Site), **off-site wage** (`ATTDAYOUT` Normal Working Days Off-Site),
**absence wage** (ABTK/ABCK/ABS/ABSEN — berbeda per day type!), **time_in_tolerance
before/after, time_out_tolerance before/after** (4 toleransi!), **late_in_wage**
(`LATEIN` Late In), **early_out_wage** (`EARLYOUT` Early Time Out), **late_break_in_wage**
(`LATEBRIN`), early_break_out_wage, **mandatory_overtime_hour**, overtime wage, increment
wage, **allow_flexible_in/out (+ with tolerance)**, calculation_for, **overtime_rounding
(type, value jam, minimum threshold, after rounding)**, **need_overtime_work_order**.

→ **Insight kunci:** oranHR TIDAK menyimpan status kehadiran sebagai enum — melainkan
**JAM per kategori** (hour buckets) yang masing-masing dipetakan ke komponen upah.
Potongan/insentif = jam × komponen upah, sehingga bebas formula perusahaan.

### 2.2 Work Schedule — master jadwal (pola rotasi cycle)

Kolom: Name (OFFICE, SHIFT, SHIFT 2…), Company, Schedule Type, Description, **Cycle Days
(7)**, Use Calendar Days Calculation, Days Calculation Factor. Plus grid **Cycle**:
`Company | Schedule Type | Sequence | Day Type | Description` — contoh OFFICE:
seq 1-5 = `830-1630`, seq 6 = `OFFSAT` (Libur Sabtu), seq 7 = `OFFSPH` (Libur
Minggu/Hari Raya). Contoh rotasi: "Shift 2 (M,S,P,P,S,M,Off Sunday)" — pola 7 hari kode
shift; "Shift 1,2,3, off Thursday, 3,2,1" — pola 3-regu rotasi.

→ **Insight:** jadwal = daftar berurutan day type dengan panjang cycle bebas (7 hari),
di-anchor ke tanggal: employee punya `first_monday_seq` (sequence day yang jatuh pada
Senin pertama) + `first_monday_date`, `valid_from/valid_to` (9999 = selamanya).

### 2.3 Employee Schedule Assignment (/EmpWorkSchedule.jsp)

Per karyawan: employee_id, schedule_type (OFFICE…), valid_from/valid_to, **first_monday_seq**,
**clocking_all (boolean — karyawan non-clocking!)**, calc_time, first_monday_date, base_date.
Data MII: mayoritas OFFICE dengan valid 2022-12-14 → 9999, Dita clocking_all=true,
Handjojo clocking_all=false → **non-clocking = jam diasumsikan normal** (lihat Transfer
"Assume as Normal Hour / By Hours / By Days").

### 2.4 Employee Clocking — rekap harian (/EmpClocking.jsp, per tanggal + Refresh Clocking)

Baris per karyawan per tanggal (ambil sampel nyata 01 Sep 2026 MII):
`employee_id, employee_name, clocking_date, state ("Prepared"), temp_day_type, day_type (LS1),
description_curr ("Long Shift Pagi 09:00 - 18:00"), calc_day_type, result_revised, revised_by,
supervisor_id/name, org_id/name, position_id/title, base_date, golid_clock/golversion_clock
(versioning rekalkulasi), presence (1), **normal_hour (6), normal_hour_off (0), late_hour (0),
early_break_hour (0), late_break_hour (0), early_hour (2), absence_hour (2),
mandatory_overtime (0), spl_overtime (null), overtime_hour (0), overtime_paid (0)**`

→ **Model hour-bucket per hari**: hadir telat pun tetap menghasilkan normal_hour —
bagian telat menjadi late_hour, pulang cepat menjadi early_hour, melewati toleransi
menjadi absence_hour. Lembur terpisah: mandatory_overtime (lembur wajib dari day type),
spl_overtime, overtime_hour (total), overtime_paid (yang dibayar).

### 2.5 Employee Overtime Work Order (/EmpOvertimeWrit.jsp)

Form New: **Employee Id\*, Overtime Date\*, Plan Overtime\* (jam), Overtime Letter No,
Actual Overtime, Verified Overtime, Status, Calculation Based on Time, From, To**.
Alur: diajukan (Plan) → dicatat Actual (dari clocking) → diverifikasi/approval →
Verified (jam dibayar). Dita Tri Avista tercatat supervisor tiap karyawan — approval
berlapis atasan. Butuh "Need Overtime Work Order" di Day Type: jika ya, lembur hanya
dibayar dengan work order.

### 2.6 Employee Work Off Permission (/EmployeeWorkOff.jsp)

Kolom: employee, status, **work_off_from/to (Date From, Time From, Day Type, Date To,
Time To)**, Clocking Date, Sequence No, **Recurrence** (berulang mingguan?), **Absence
Wage + Name (komponen upah absensi — paid/unpaid)**, **Deduct Leave (potong saldo cuti)**,
Reason, File Name, **Need Supporting Documents**. Contoh: izin setengah hari dengan wage
code tertentu (dibayar penuh/sebagian/tidak), bisa mengurangi saldo cuti Leave module.

### 2.7 Transfer to Payroll (/TransferPayroll.jsp) — JEMBATAN KE PAYROLL ★

Form nyata MII:
- **Transfer to Period\*** (SEPTEMBER2026) + **Process Type\*** (Salary) + All Employee / Specific
- Jendela data (From/To masing-masing): **Attendance, Absence, Overtime, Service Charge, Increment**
- Toggle komponen yang ikut ditransfer: **Attendance Days, Factor Keterlambatan,
  TOTAL LATE DAYS, Overtime Upload, Potongan Izin, Tunjangan Kehadiran Karyawan,
  Uang Makan, Uang Makan Lembur, Uang Transport**
- Kebijakan: **Non Clocking Normal Hours Calculation** (Assume as Normal Hour / By Hours /
  By Days); **Overtime & Increment Calculation** (Assume as Absence Unpaid / By Days / By
  Period / Do not Transfer); **Unapproved Clocking Resolving** (Do not Transfer / Transfer /
  Override Existing Data); **Duplicate Period Entries** (Do not Transfer / Add to Existing
  Data); **Non Clocking** (Do Not Transfer and Assumed as Non Clocking); **Period Entries**
  (Do not Modify Existing Data)

→ Hasil transfer: jam/jam-hari per karyawan per komponen upah masuk sebagai transaksi
komponen gaji di period & process type terpilih (lengkap+idempoten dengan aturan
duplicate/override).

### 2.8 Master pendukung lain

- **Day Substitute** (2 baris MII): `OS` = Off Shift, `PH` = Libur Nasional — hari
  pengganti ketika hari kerja jatuh pada libur nasional (reschedule).
- **Overtime Specified (WageOvertimePres)**: wage_code + wage_name + **wage_type_payroll**
  (13 enum sama dengan payroll) + **wage_type_time**: `Normal, Overtime, Absence,
  Break/Lunch, Overtime Specified, Increment, Information` — **tabel peta jam ↔ komponen upah**.
- **User Defined Rounding**: **From Minute | To Minute | Rounding Value** — tabel
  pembulatan menit (mis. 0-5' → 0, 6-15' → 15) untuk clocking.
- **Absence Wage Rules**: **Wage Code | Wage Name | Need Supporting Documents | Deduct Leave**.
- **Mark Location** + **Employee Check Location Exception**: geofence absensi mobile ESS
  (GPS) — oranhr.com/news artikel ESS: clock in/out mobile, GPS-based attendance, foto, OTP.

### 2.9 PayrollPeriod ↔ jendela TA

Modul payroll oranHR sudah punya `ta_start_date/ta_end_date` di PayrollPeriod (jendela
kehadiran ≠ jendela payroll — mis. gaji Oktober dihitung dari absensi 25 Sep-24 Okt).
Transfer mengambil window tersendiri (default 01-30 bulan period) — jadi window TA
ditentukan operator saat transfer, period hanya target penulisan.

---

## 3. ALUR KERJA END-TO-END ORANHR (distilasi)

```
1. SETUP (sekali)
   Day Type (jam+toleransi+wage map) → Work Schedule (cycle 7 hari day type)
   → Employee Schedule Assignment (karyawan → jadwal, clocking_all, anchor Senin)
   → User Defined Rounding, Overtime Specified, Absence Wage Rules
2. HARIAN
   Mesin/ESS/Import → raw clocking → "Refresh Clocking" per tanggal
   → Employee Clocking: resolve day type efektif → hitung hour buckets
      (late = in − (schedule_in + tolerance); early = out − schedule_out; dsb.)
   → koreksi/temporary schedule → Employee Clocking Approval
3. TRANSAKSI
   Overtime Work Order (Plan → Actual → Verified, approval)
   Work Off Permission (paid/unpaid wage, deduct leave, approval)
   Work Day Request Changes (tukar hari) + Temporary Schedule
4. PER PERIODE
   Query Employee Attendance/Absence/Tidiness (validasi)
   → Transfer to Payroll: pilih period+process type+window → jam → komponen gaji
   → Payroll Process (modul payroll menghitung komponen + PPh21 + BPJS)
```

---

## 4. GAP & KEPUTUSAN DESAIN REKANKERJA

| Aspek oranHR | Keputusan RekanKerja | Alasan |
|---|---|---|
| 28 halaman terpisah, ExtJS | 8 view dalam 1 modul attendance (nav sudah tersedia) | UX modern, nav RekanKerja sudah ada: Ringkasan, Template Jadwal, Assign Jadwal, Matriks Jadwal, Data Clocking, Absensi & Izin, Lembur, Work Off |
| Day Type 40+ atribut | `WorkDayType` dipangkas: in/out/nextDay, break menit + paid, normal menit, toleransi late/early, flexible, needOvertimeOrder, pembulatan OT | Menyimpan esensi (hour bucket + toleransi); wage mapping dipindah ke `AttendanceRule` global (lebih sederhana daripada per-day-type, tetap bisa dikembang) |
| Work Schedule + cycle grid | `WorkSchedule` + `WorkScheduleDay[]` (seq 1..cycle) | Identik |
| first_monday_seq anchor | `ScheduleAssignment.anchorMonday` (tanggal Senin pertama cycle) + `anchorSequence` | Setara, lebih mudah dihitung |
| Employee Clocking hour buckets | `AttendanceDaily`: presence, checkIn/checkOut, late/early/work/normal/absence/overtime menit, status, state, revised | Identik konsep; status turunan untuk UX (Present/Late/Absent/Off/Holiday/Leave/WorkOff) + jam untuk presisi |
| Raw clocking (mesin/import) | `AttendanceClockLog` (timestamp, arah, sumber) + input manual | Mesin fingerprint di luar scope sandbox; sumber WEB/MANUAL siap diperluas |
| Overtime WO Plan→Actual→Verified | `OvertimeOrder` (planMinutes/actualMinutes/verifiedMinutes, status, approval) | Identik |
| Work Off Permission | `WorkOffPermission` (paid, deductLeave, dayTypeId, recurrence sederhana tanpa/tanggal berulang) | Identik inti |
| Transfer to Payroll (window+toggles) | `transferToPayroll` service: rekap window → `EmployeeComponentAssignment kind:"Specific"` per komponen (amount dihitung service; idempoten upsert) | Mengikuti pola benefit `syncClaimComponent` yang sudah terbukti; komponen: LEMBUR (upah lembur), TLATE (potongan telat), TABS (potongan absen), TKEHADIRAN (tunjangan kehadiran penuh hadir) |
| Day Substitute / Work Day Changes / Temporary Schedule | Backlog (fase lanjutan) | Prioritas: core rekap + lembur + izin + transfer |
| Mark Location / Import mesin / ESS mobile | Backlog | Butuh device & mobile app |
| Non-clocking (clocking_all=false) | `ScheduleAssignment.clockingRequired=false` → rekap: jam dianggap normal penuh | Sama dengan "Assume as Normal Hour" |
| Overtime rounding & User Defined Rounding | Pembulatan menit global sederhana di `AttendanceRule` (kelipatan N menit, minimal M menit utk lembur) | Versioran tabel rounding bisa menyusul |

**Perhitungan upah lembur (regulasi Indonesia, PP 35/2021 + KEP-102):**
upah sejam = 1/173 × upah bulanan; hari kerja 1,5× (jam ke-1) lalu 2×; hari istirahat
mingguan 2× (8 jam pertama) lalu 3×; hari libur nasional 2×/3×/4× bertingkat. oranHR
menyimpan konfigurasi multiplier implisit di komponen; RekanKerja menghitung di service
`overtimePayFor()` berdasarkan kategori hari (weekday/weekend/holiday dari day type + hari
libur), tetap divisualisasikan transparan di UI.

---

## 5. RENCANA IMPLEMENTASI (SKEMA + SERVICE + API + UI + SEED)

### Fase A1 — Master & model (9 model baru schema-tenant)
`WorkDayType`, `WorkSchedule`, `WorkScheduleDay`, `ScheduleAssignment`,
`AttendanceClockLog`, `AttendanceDaily` (unique employee+tanggal), `OvertimeOrder`,
`WorkOffPermission`, `AttendanceRule` (singleton: toleransi default, pembulatan,
peta komponen LEMBUR/TLATE/TABS/TKEHADIRAN, kebijakan non-clocking, kategori hari
libur untuk multiplier lembur).

### Fase A2 — Service rekap harian (attendance-service.ts)
`resolveDayType(db, employeeId, date)` (assignment → schedule cycle + anchor),
`regenerateDaily(db, date)` (clock log → hour buckets + toleransi + workoff + lembur
approved → upsert AttendanceDaily), `recapPeriod(db, from, to)` (agregat per karyawan),
`overtimePay` (1/173 × multiplier kategori hari), `transferToPayroll` (rekap → Specific
assignments idempoten), `nextOrderNo/nextWorkoffNo`.

### Fase A3 — API (10 route, requireTenant)
`attendance/day-types`, `schedules` (+cycle), `assignments`, `matrix`, `clocking`
(harian + input manual + regenerate), `absence` (rekap + transfer), `overtime`
(order+approve/verify), `workoffs` (+approve), `settings`, dan badge di `meta`.

### Fase A4 — UI 8 view (Bahasa Indonesia, shadcn, emerald/stone)
Ringkasan (KPI hari ini + live), Template Jadwal (tabs Tipe Hari/Jadwal/Pengaturan),
Assign Jadwal, Matriks Jadwal (karyawan × 7 hari), Data Clocking (per tanggal + koreksi),
Absensi & Izin (rekap bulanan + tombol Transfer ke Payroll), Lembur (order + approval),
Work Off (izin + approval).

### Fase A5 — Seed & integrasi payroll
Seed MII: 8 day type, 3 jadwal (OFFICE/SHIFT3/SHIFT2), penugasan 44 karyawan (produksi
shift, kantor office), log + rekap harian 2 bulan (deterministik: hadir/telat/absen/izin),
lembur approved+pending, izin, `AttendanceRule` default. `buildRunRows`: run SALARY juga
memproses Specific assignments (period × process type) — selaras Transfer ke "Salary"
oranHR. `confirmRun` → tandai lembur dalam window sebagai Paid (paidRunNo) — pola
`markClaimsPaidForRun`.

### Backlog (tidak dikerjakan sekarang)
Import mesin fingerprint, Mark Location/geofence ESS, Day Substitute & Work Day Changes
(tukar hari), Temporary Schedule, report template, service charge & increment window,
break-hour potongan (Break/Lunch wage), employee clocking approval berlapis.
