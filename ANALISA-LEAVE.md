# ANALISA DEEP-DIVE: Modul Leave Administration oranHR → Rencana Implementasi Cuti OneVity

> Dokumen analisa murni. Basis: eksplorasi langsung demo.oranhr.com (login MII000001,
> PT Mitra Industri Internasional / "MII", versi 11.08.00) — seluruh 14 halaman modul
> Leave Administration dipetakan via navigasi tree (ExtJS) & data nyata dibaca dari
> grid + form + handler JS, ditambah interface payroll (Employee Leave Cashable) dan
> halaman ESS terkait leave. Tanggal: sesi analisa leave. Penulis: agent OneVity.

---

## 1. PETA MODUL LEAVE ADMINISTRATION ORANHR (14 HALAMAN, 5 GRUP)

```
LEAVE ADMINISTRATION
├─ Employee Leave Information ............ LeaveInformation.jsp    ★ saldo cuti per karyawan (15-16 jenis)
├─ Query - Employee Leave Information ... QueryEmpLeaveInfo.jsp    (query jenis cuti + entitlement)
├─ TRANSACTION
│   ├─ Leave Request ..................... LeaveRequest.jsp        ★ pengajuan cuti (666 baris, auto-compute)
│   ├─ Leave Request Approval ........... LeaveRequestToApprove.jsp ★ approval 19 pending; Operation: Approve|Reject|Cancel
│   ├─ Leave Adjustment ................. LeaveAdjustment.jsp      (penyesuaian saldo manual per karyawan)
│   ├─ Mass Leave ....................... MassLeave.jsp            ★ cuti massal per organisasi (SKB cuti bersama)
│   ├─ Leave Encashment ................. LeaveEncashment.jsp      ★ saldo → uang (7 baris MII)
│   ├─ Leave Encashment Approval ........ LeaveEncashmentToApprove.jsp
│   └─ History
│       ├─ Summary Based on Leave Type .. LeaveSummaryBaseLeaveType.jsp (laporan per jenis)
│       └─ Summary Based on Employee .... LeaveSummaryBaseEmployee.jsp  (laporan per karyawan)
├─ PROCESS
│   ├─ Generate Leave Information ....... GenerateLeaveInfoProcess.jsp  ★ generate baris saldo per tahun
│   └─ Generate Leave Adjustment ........ GenerateLeaveAdjustmentProcess.jsp (massal: date + type ± days + alasan)
└─ GENERAL SETTING
    ├─ Leave Type ....................... LeaveTypeDetail.jsp      ★ master 20 jenis (40+ atribut)
    └─ Initial Leave Information ........ InitialLeaveInformation.jsp (saldo awal: carry over + taken + tanggal)

PAYROLL (di modul Payroll Administration)
└─ Employee Leave Cashable .............. EmpLeaveCashable.jsp     ★ jembatan: period + process type + wage code + transfer + total hari

ESS / MSS
├─ My Leave Request Approval ............ MyLeaveRequestToApprove.jsp
├─ My Leave Encashment Approval ......... MyLeaveEncashmentToApprove.jsp
└─ Query - Employee on Leave ............ QueryEmpOnLeave.jsp (From/To + employee + jenis + tanggal kerja)
```

Reminder home page MII: **Approval - 31 Leave Requests, Approval - 1 Leave Encashment** —
leave adalah modul dengan beban approval terbesar setelah travel. Artikel home page
"SKB Cuti Bersama 2023" → Mass Leave adalah mekanisme resmi cuti bersama pemerintah.

---

## 2. DATA MODEL INTI (dari grid + form + data nyata MII)

### 2.1 LEAVE TYPE — master jenis cuti (20 baris MII) — 40+ atribut dalam 8 grup

Dibaca dari `LeaveTypeDetail.jsp?leave_name=Cuti Tahunan` (nilai MII nyata):

```
IDENTITAS        : Leave Type, Description, Default Leave Type, Leave Reporting Code
ENTITLEMENT      : Annual Leave Entitlement 12 Day(s) | Maximum Days per Request 12
                   Leave Earned by End Of Month ✓ | Calendar Days ✓ (vs hari kerja)
                   Leave Period Yearly | Prorate by month for leave entitlement ✓
                   Entitled in Next Period
FIRST PERIOD     : Using Prorate | Apply Incomplete Month Rule
OTHER            : Allow Advance Leave + Maximum Days for Advanced
                   Not Allow Half Day Leave | Max Hour for Half Day Leave 4
                   Allow Carry Over + Maximum Carry Over 32
                   Carry Over Period 1 | Carry Over Forfeiture (DD-MM) 31-12
                   Number of months passed before takeable 6 month
                   Need Supporting Documents
TA/PAYROLL       : Link Schedule | Absence Code ABCT "Absent - Annual Leave"
                   Paid Leave ✓ | Balance Cashable
                   Cashed Leave Wage Code UCT "Cashable Leave"
RULE PARAMETER   : Organization Unit, Company Office, Work Location, Employee Status,
                   Employment Type, Specific Employee, Position, Position Grade,
                   Employee Grade, Religion, Marital Status, Gender, Service Year,
                   Service Group (15 dimensi targeting entitlement berbeda per segmen)
VALIDITY         : Valid From 01 Jan 1900 → Valid To 01 Jan 9999
```

**20 jenis cuti MII** (dari QueryEmpLeaveInfo + saldo MII000005/MII000001):

| Jenis | Hak | Satuan | Keterangan |
|---|---|---|---|
| ANNUAL_LEAVE_SMS | 12 | hari | annual leave SMS (kantor cabang) |
| Baptis/Khitanan Anak | 2 | hari | khitanan/baptis anak sah (PP 35/2021) |
| Cuti_Besar | 12 | hari | long service leave (>5 th) |
| Cuti Besar Aniv | — | hari | varians anniversary |
| Cuti Haid | 2 | hari | haid (UU 13/2003) |
| Cuti Haji | 40 | hari | ibadah haji |
| **Cuti Tahunan** | 12 | hari | **default** — prorate bulanan |
| Cuti Tahunan Anniversarry | 12 | hari | periode per tanggal join (15 Des → 14 Des) |
| Cuti Tahunan GF | 12 | hari | annual GF |
| Istri Keguguran | 2 | hari | istri keguguran (suami) |
| Keguguran | 1.5 | bulan | keguguran (perempuan) |
| Kelahiran Anak | 2 | hari | istri melahirkan (ayah) |
| Kematian Inti | 2 | hari | suami/istri/anak/orang tua |
| Kematian Saudara | 1 | hari | mertua/saudara/kakek-nenek |
| Kematian Serumah | 1 | hari | kenalan serumah |
| Melahirkan | 3 | bulan | melahirkan (1.5 bln × 2) |
| Melahirkan_1 | 3 | bulan | varians |
| Pernikahan | 3→2 | hari | karyawan sendiri |
| Pernikahan Anak | 2 | hari | anak sah karyawan |
| Tugas Belajar | 24 | bulan | tugas belajar |

Satuan bisa **hari ATAU bulan** — balance dicampur satuan per jenis.
Nilai haid/melahirkan/keguguran menegaskan basis PP 35/2021 pasal 35 + UU 13/2003 pasal 82–84.

### 2.2 LEAVE INFORMATION — saldo per karyawan per jenis (inti modul)

Grid `LeaveInformation.jsp` (MII000005 — base date 19 Jun 2026, 15 baris):

```
Kolom: Leave Type | (a) Carried Over | Leave Entitlement Day(s)/Month(s) | Maximum Days per Request |
       (b) Earned Leave | (c) Leave Adjustment | (d) Forfeited Amount | (e) Cashed Leave |
       (f) Leave Taken | (g) Leave Applied not Taken | Leave Balance | Valid From | Valid To

FORMULA: Leave Balance = (a + b + c) − (d + e + f + g)
```

Contoh nyata MII000005 baris **Cuti Tahunan**:
`12 (carried) | 12 (entitle) | 12 (max) | 6 (earned, s/d akhir Jun = 12 × 6/12) | 0 adj | 0 forf | 0 cashed | 1 taken | 0 applied → saldo 17`
— membuktikan **prorate bulanan**: earned dihitung akumulasi bulan berlalu ÷ 12 × hak.

Contoh **Cuti Tahunan Anniversarry** (MII000005, join 15 Dec): `Valid 15 Dec 2025 → 14 Dec 2026` —
periode anniversary per tanggal join, bukan tahun kalender.

Contoh **melahirkan/keguguran/tugas belajar**: satuan **Month(s)**, earned 3/24 bulan —
tidak diprorate per bulan (hak penuh saat kondisi terjadi).

### 2.3 LEAVE REQUEST — transaksi pengajuan (666 baris MII)

Form New (`LeaveRequest.jsp`) — field + auto-compute:

```
Employee Id* (picker) | Name (auto) | Letter No | Request Date (default hari ini)
Leave Type* (picker) → Current Leave Balance 9 (auto) | Maximum Days Allowed to Request 12 (auto)
Leave From* (tanggal + AM/PM) | Leave To* (tanggal + AM/PM)
→ Number of Working Applied 1 (AUTO: hanya hari kerja per jadwal!)
→ Remaining Leave Balance 8 (auto) | Reports to Work on 03 Sep 2026 (AUTO: hari kerja berikutnya)
Reason* (textarea) | Note | File Name (lampiran) | Need Supporting Documents (auto dari jenis)
```

Grid list (kolom sama + status). Data nyata:
- `MII000001 24 Mar AM → 25 Mar PM = 2 hari` (rentang lintas hari)
- `MII000001 04 Jul AM → 04 Jul AM = 0.5 hari` (half day; From AM → To AM = ½)
- `MII000001 07–16 Jul = 8 hari, saldo 7.5 → remaining −0.50` (**advance leave**, saldo minus diizinkan)
- `MII000018 saldo 0, ambil 2 hari → remaining −2` (advance)

**Status yang teramati**: `Submitted`, `Partially Approved`, `Approved`, `Rejected`, `Cancelled`,
`Mass Leave` (baris auto dari proses cuti massal — 3 tanggal SKB: 02 Jun, 27 Jul, 28 Jul dengan
Cut i_Besar 12/11/10 → cuti bersama **dibayar pakai saldo Cuti Besar 1 hari per tanggal per karyawan**).

Approval (menu **Operation** di form): **Approve | Reject | Cancel**. "Partially Approved" =
disetujui sebagian hari (misal minta 3 hari disetujui 1).

### 2.4 MASS LEAVE — cuti massal per organisasi

Form `MassLeave.jsp`:
```
Leave Type* | Status | Letter No | Leave Date From* | Leave Date To* | Leave Amount* (hari per karyawan)
Note | Organization Id + Include Sub Organization | Company Office
Exclude Non Working Day Type ✓ | Exclude Conflicted Leave ✓ | Created By/On (auto)
```
Efek: membuat baris Leave Request status "Mass Leave" untuk setiap karyawan dalam org
(contoh MII: 42 karyawan × 3 tanggal SKB = baris massal; pakai saldo Cuti_Besar).

### 2.5 LEAVE ENCASHMENT — uang pengganti cuti (7 baris MII)

```
Kolom: Employee | Letter No | Encashment Status | Request Date | Payment Date |
       Leave Type | Current Leave | Encash Leave (hari) | Remaining | Transferred to Payroll
Status: Submitted / Approved / Rejected / Cancelled
Contoh: MII000047 Boston Diana: saldo 10, encash 10 → remaining 0 (habis di-cash)
        MII000009 Taufik: saldo 12, encash 9 → remaining 3
```

### 2.6 EMPLOYEE LEAVE CASHABLE — jembatan ke payroll (`EmpLeaveCashable.jsp`)

```
Kolom: Payroll Period (0120240600) | Process Type (Salary/Bonus) | Employee |
       Wage Code (UCT "Cashable Leave" / UTJ "Uang Tanda Jasa") | Transfer | Total Day
```
Encashment yang approved → baris ini → masuk payroll run sebagai wage UCT per hari.
**UTJ** (Uang Tanda Jasa) = pensiun/long-service juga lewat jalur ini.

### 2.7 GENERATE & INITIAL

- `GenerateLeaveInfoProcess.jsp`: **Year*** + Leave Type (kosong = semua) + All Employee/Specific →
  membuat baris Leave Information per karyawan per jenis untuk tahun tsb.
- `GenerateLeaveAdjustmentProcess.jsp`: Adjustment Date* + Leave Type* + **Adjusted Leave Days*** (±)
  + Reason + All/Specific → penyesuaian massal.
- `InitialLeaveInformation.jsp`: Employee* + Leave Type* + **Carry Over*** + **Initial Time*** + **Leave Taken***
  → saldo awal saat implementasi sistem.

### 2.8 ESS QUERY EMPLOYEE ON LEAVE (`QueryEmpOnLeave.jsp`)
Filter: From/To + employee + leave type + working date → siapa cuti pada rentang.

---

## 3. ALUR KERJA END-TO-END ORANHR

```
[TAHUNAN] Generate Leave Information (year → saldo per karyawan per jenis)
   ↓ carry-over otomatis dari periode lalu (max carry, forfeiture 31-12)
[KARTU] Employee ajukan Leave Request (saldo + hari kerja auto-compute)
   ↓ submit → status Submitted
[APPROVAL] Atasan: Operation → Approve / Reject / Cancel (bisa Partially Approved)
   ↓ approve → Leave Applied not Taken (future) / Leave Taken (past)
   ↓ → integrasi TA: hari cuti diberi Absence Code (ABCT) → rekap absensi dibayar/tidak
[MASSAL] Mass Leave per org (SKB cuti bersama) → baris Mass Leave otomatis
[UANG] Leave Encashment: saldo → hari di-cash → approve → Employee Leave Cashable
   ↓ transfer → payroll period + wage UCT → gaji
[PENYESUAIAN] Leave Adjustment manual / massal (± hari, alasan)
[AWAL] Initial Leave Information (carry over awal implementasi)
```

---

## 4. KETENTUAN REGULASI INDONESIA (konteks, tidak diubah oranHR)

- UU 13/2003: cuti tahunan 12 hari kerja setelah 12 bulan kerja berlanjut (pasal 79),
  izin berbayar: menikah 3 hr, khitan/baptis anak 2, istri melahirkan/keguguran 2,
  kematian inti 2, kematian serumah 1 (pasal 81), haid (pasal 81), melahirkan 1.5 bln ×2 (pasal 82),
 Absen berbayar pasal 93(4): pekerja berhak upah penuh untuk izin tsb.
- PP 35/2021: memperluas pasal 93(4) — 2 hari untuk anggota keluarga dalam satu rumah &
  menikah anak 2 hari; istri keguguran 2 hari untuk suami.
- SKB 3 Menteri: cuti bersama (Idulfitri dll) — perusahaan boleh memotong cuti tahunan
  atau memperlakukan sebagai cuti bersama dibayar — MII memakai saldo Cuti Besar via Mass Leave.
- OneVity: nilai default mengikuti tabel 2.1; admin bebas ubah (Leave Type fleksibel).

---

## 5. REKAYASA ONEVITY (fase L1–L5)

### L1 — Master & saldo (prasyarat)
- `LeaveType`: kode, nama, satuan (DAY/MONTH), hak, max/request, dibayar, cashable,
  periode (CALENDAR/ANNIVERSARY), prorate bulanan, carry-over max + forfeiture,
  waiting months, half-day, advance, perlu dokumen, valid from/to.
  Seed 12 jenis inti Indonesia (tabel 2.1).
- `LeaveBalance` per karyawan×jenis×periode: carriedOver, adjustment, cashed, forfeited
  (statis per periode) + **earned/taken/applied dihitung dinamis** dari tanggal & request.
- Generate Leave Information per tahun (semua/spesifik) — carry-over dari periode lalu.

### L2 — Permintaan & approval
- `LeaveRequest`: employee, jenis, dari(tgl+AM/PM), sampai(tgl+AM/PM), hariKerja dihitung
  **dari jadwal modul Attendance** (resolveDayType — OS/PH tidak dihitung; ½ hari bila
  From/To beda sesi), saldo saat itu, remaining, HP-kembali-kerja, alasan, catatan,
  status (Submitted → Approved/Rejected/Cancelled; MassLeave untuk massal).
- Approval list + Operation setara oranHR: Approve / Reject / Cancel + catatan keputusan.
- Validasi: waiting period 6 bulan, max/request, saldo (advance bila diizinkan jenis),
  bentrok tanggal dengan request existing.

### L3 — Cuti massal & penyesuaian
- `MassLeave` + generate baris request status MassLeave per karyawan org (include sub-org,
  exclude non-working & bentrok). `LeaveAdjustment` (± hari, alasan) — massal & per karyawan.

### L4 — Encashment & integrasi payroll
- `LeaveEncashment`: request (hari di-cash), payment date, status, transferred.
  Approve → cashed bertambah. Transfer → **ComponentAssignment Specific** komponen
  `UCT` (Uang Pengganti Cuti) amount = hari × upah harian (gpokok/25), per payroll period —
  mengikuti pola Transfer to Payroll modul Attendance (idempoten, hapus-dan-tulis-ulang).
  Setelah run dikonfirmasi → mark Transferred to Payroll (paidRunNo).

### L5 — Ringkasan & laporan
- Ringkasan modul (KPI + alur), laporan saldo per karyawan (formula a–g), rekap jenis,
  karyawan-sedang-cuti (rentang tanggal).

### Integrasi silang
- **Attendance**: hari cuti approved → coverage rekap kehadiran sebagai absen-berbayar
  (jenis paid) — tampil di recap period sebagai day-type leave (kode per jenis).
- **Payroll**: encashment (L4) — cuti unpaid sudah terpotong via jalur absensi TABS.

### Backlog (tidak dikerjakan fase ini)
- ESS mobile + geofence request, lampiran file storage nyata, partially-approved per hari,
  15 dimensi rule parameter penuh (OneVity: hak seragam per jenis + adjustment manual),
  cuti bersama otomatis dari kalender pemerintah, UTJ long-service otomatis.

---

## 6. PEMETAAN VIEW UI ONEVITY (8 VIEW, BAHASA INDONESIA)

| View oranHR | View OneVity | Isi |
|---|---|---|
| Employee Leave Information | **Saldo Cuti** | grid a–g + saldo + dialog generate & adjust |
| Leave Type (+Query) | **Jenis Cuti** | master CRUD + seed Indonesia |
| Leave Request | **Permintaan Cuti** | form + auto-compute + filter status |
| Leave Request Approval (+ESS) | **Persetujuan** | pending + Approve/Reject/Cancel |
| Mass Leave | **Cuti Massal** | form + generate + daftar hasil |
| Leave Encashment (+Approval+Cashable) | **Uang Pengganti Cuti** | request + approval + transfer payroll |
| History (2 laporan) | **Laporan** | saldo per jenis/karyawan + sedang cuti |
| (Process menu) | **Proses & Integrasi** | generate info/adjustment + transfer |

Ditambah view **Ringkasan** (KPI + alur kerja 4 langkah) = total 8 view, konsisten
paradigma payroll-module/attendance-module (KPI card + table + dialog + toast).

---

*Dokumen ini menjadi acuan kontrak implementasi fase L1–L5. Penyimpangan implementasi
dicatat di worklog.md Task 18.*
