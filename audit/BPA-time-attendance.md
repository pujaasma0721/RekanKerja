# BPA — Modul TimeAttendance (Presensi) · RekanKerja HRIS

> Audit bisnis proses READ-ONLY · Task ID **24-c** · Auditor: sub-agent BPA
> Lingkup: `src/rekankerja/time-attendance/**` (10 api + attendance-service.ts + 10 komponen),
> `prisma/schema-tenant.prisma` (9 model TA), route thin `src/app/api/rekankerja/attendance/**`,
> integrasi Leave (`leave-service.ts`) & Payroll (`payroll-service.ts`), referensi bisnis
> `ANALISA-ATTENDANCE.md` (28 halaman oranHR). Temuan F-01..F-12 AUDIT-MODULES.md
> (sudah diperbaiki) TIDAK dilaporkan ulang.
> Metode: pembacaan kode penuh (966 baris service + 10 API + 10 komponen) + probing runtime
> GET-only (login hrd@mii.co.id → workspace MII) + query SQL read-only ke schema tenant MII.
> Tidak ada mutasi data / kode. Data live MII saat audit (2 Sep 2026): 2.560 AttendanceDaily,
> 17 OvertimeOrder (16 Paid, 1 Rejected), 8 WorkOffPermission (2 Pending), 42 karyawan aktif
> ter-assign 2 jadwal (OFFICE-STD 27, ROTASI-3R 15), 1 non-clocking.

---

## 1. RINGKASAN EKSEKUTIF

Modul TimeAttendance RekanKerja mengimplementasikan alur inti oranHR secara **berfungsi dan
terverifikasi live**: master (8 tipe hari termasuk shift malam lintas hari, jadwal cycle 5/7
hari + anchor Senin) → assignment jadwal (auto-close assignment lama) → clock log (IN pertama /
OUT terakhir) → kalkulasi AttendanceDaily (hour buckets: telat/pulang cepat/kerja/absen) →
rekap period → Transfer ke Payroll (Specific LEMBUR/TLATE/TABS/TKEHADIRAN, idempoten per
period) → confirmRun menandai lembur Paid. Integrasi dua arah dengan Leave (approve → status
OnLeave) bekerja; rotasi 3 regu & shift malam 22:00–06:00 terbukti benar di data live.

Namun audit menemukan **3 temuan KRITIS pada rantai nilai uang (lembur/absensi → payroll)**:
(1) order lembur berstatus **Paid tetap ikut rekap jendela berikutnya** → skenario pembayaran
ganda saat jendela transfer overlap (pola cutoff 25–24 oranHR); (2) **clock-out setelah tengah
malam dibuang** untuk tipe hari non-lintas-hari → karyawan yang lembur sampai >24:00 dianggap
**Absen penuh** (potongan 1/25 gaji); (3) flag `Paid` ditandai berdasar window **period** run,
bukan window **transfer** yang benar-benar dibayarkan → order bisa ditandai Paid tanpa pernah
dibayar. Ditambah **MAJOR**: batas tier multiplier lembur hari libur tidak sesuai PP 35/2021
Pasal 28, lupa clock-out dihukum absen penuh, pulang cepat tanpa konsekuensi, serta 4 setelan
aturan yang ditawarkan UI tapi tidak berpengaruh ke engine.

| Severity | Jumlah | Ringkas |
|---|---|---|
| KRITIS | 3 | lembur double-pay flag Paid; absen salah lewat tengah malam; markPaid window mismatch |
| MAJOR | 6 | multiplier Holiday salah; lupa clock-out = absen penuh; pulang cepat bebas; config mati; transfer window overlap; approve lembur tanpa bukti clock |
| MINOR | 9 | dead code, KPI tanpa OnLeave, validasi HH:MM, N+1 matrix, race nomor dokumen, dll. |
| GAP | 8 | deductLeave tidak jalan, libur nasional, cap lembur UU, koreksi manual, import mesin, dll. |

---

## 2. PETA PROSES AS-IS (master → assign → clock → daily → rekap → payroll)

```
SETUP (sekali)
  Tipe Hari (WorkDayType: jam/toleransi/nextDay/break/normal/kategori Workday|Off|Holiday)
    → Jadwal (WorkSchedule + WorkScheduleDay seq 1..N, cycle 1–28 hari)
    → Pengaturan (AttendanceRule singleton: rounding, peta komponen LEMBUR/TLATE/TABS/TKEHADIRAN,
       nilai potongan/tunjangan, nonClockingPolicy)
  Assign Jadwal (ScheduleAssignment: employeeId→scheduleId, anchorMonday+anchorSequence,
    clockingRequired, validFrom/validTo; POST menutup assignment validTo=null lama)

HARIAN (trigger, bukan cron)
  a) Clock log manual (POST /clocking: date+time+arah → AttendanceClockLog)
     → regenerateDaily(tanggal tsb, karyawan tsb SAJA)
  b) "Refresh Clocking" (PATCH /clocking {date}) → regenerateDaily(tanggal, SEMUA karyawan aktif)
  c) Overview "Hitung Ulang Hari Ini" → sama dengan (b) untuk hari ini
  d) approve/reject/verify lembur & approve/cancel workoff & approve cuti (modul Leave)
     → regenerateDaily / regenerateRange rentang terkait

  regenerateDaily(date): utk tiap karyawan aktif:
    resolveDayType (assignment aktif → cycle index = (offset hari dari anchor + anchorSeq-1)
      mod cycle → day type) → ambil log clock window [00:00 D, 00:00 D+2)
    → IN pertama = checkIn, OUT terakhir > checkIn = checkOut (filter < D+1 bila !nextDay)
    → prioritas cabang: OFF? → hadir-di-hari-off / Off; CUTI? → OnLeave (paid/half);
      WORKOFF? → WorkOff; non-clocking? → Present (AssumeNormal); tanpa IN/OUT? → Absent;
      else hitung telat/pulang-cepat (dikurangi toleransi, floor ke kelipatan rounding),
      work = out−in (cap 960), normal = min(work, target), absence = max(0, target−work)
    → + overtimeMinutes = Σ order Approved/Paid tanggal tsb (verified ?? actual)
    → upsert AttendanceDaily (employeeId+workDate unik, idempoten)

TRANSAKSI (approval)
  Lembur: submit (Plan, kategori hari dari day type) → approve (Actual = overlap jendela order
    × clock, cap 600 mnt; Verified = input ?? actual ?? plan) → verify (koreksi verified)
    → reject/cancel; Paid ditandai confirmRun payroll
  Work Off: submit (paid/deductLeave/half-day, maks 30 hari) → approve → regenerateRange

PER PERIODE
  Rekap (GET /absence?from&to → recapPeriod): agregat AttendanceDaily per karyawan +
    estimasi uang (TLATE = menit/60 × gaji/173; TABS = hari absen+izin unpaid × gaji/25;
    TKEHADIRAN = tunjangan bila sempurna; LEMBUR = overtimePayFor 1/173 × multiplier)
  Transfer (POST /absence): recap window → EmployeeComponentAssignment kind Specific
    (period × processType), hapus-dulu-tulis-ulang per period (idempoten), period
    Locked/Closed ditolak, UI hanya menawarkan Open/Processing

PAYROLL
  buildRunRows memasukkan Specific assignments → payslip item;
  confirmRun → markOvertimePaidForRun (lembur Approved dalam window period run SALARY →
    Paid + paidRunNo) → jurnal otomatis
```

---

## 3. TABEL STATE / STATUS

### 3.1 Status harian AttendanceDaily (urutan evaluasi di `regenerateDaily`, AS:303-371)

| # | Kondisi pemicu | status | presence | normal | absence | Catatan guard |
|---|---|---|---|---|---|---|
| 1 | day type Off / tanpa jadwal, ada IN+OUT | Present | 1 | 0 | 0 | note "Bekerja pada hari off"; work cap 960; **tanpa order lembur → tidak dibayar** |
| 2 | day type Off / tanpa jadwal, tanpa clock | Off | 0 | 0 | 0 | tidak dihitung scheduled |
| 3 | cuti Approved/MassLeave menutup hari kerja | OnLeave | 0 | paid: target (half: ½) | unpaid: target | prioritas di atas workoff & clock; **jam kerja nyata diabaikan** |
| 4 | workoff Approved menutup hari kerja | WorkOff | 0 | paid: target (half: ½) | unpaid: target | sama — clock diabaikan |
| 5 | clockingRequired=false | Present | 0 | **0** | 0 | note "Non-clocking — jam dianggap normal" (normalMinutes tidak diisi) |
| 6 | tanpa clock-in ATAU tanpa clock-out | **Absent** | 0 | 0 | **target penuh** | note "Tanpa clock-in/OUT"; potongan TABS 1/25 gaji |
| 7 | lengkap | Late / Present | 1 | min(work,target) | max(0,target−work) | Late bila lateMinutes>0 |

`state`: Prepared → Calculated (setiap regenerasi) → *Revised tidak pernah diset* (field mati).
`revised/revisedBy` di-reset false/null oleh upsert — koreksi manual tidak ada jalurnya.

### 3.2 Status SP lembur OvertimeOrder (from → to, guard, efek)

| Transisi | Guard | Efek |
|---|---|---|
| (baru) → Pending | tanggal YYYY-MM-DD; jam HH:MM; tTo≤tFrom → +1 hari; plan = input ?? max(30, span); kategori hari = day type (Off→Weekend, Holiday→Holiday, else Weekday) | orderNo OT-thn-nnn; **tanpa cap jam; tanggal boleh masa depan** |
| Pending → Approved | approve | actual = overlap [order.timeFrom, timeTo] × [daily.checkIn, checkOut] cap 600 mnt; **daily tidak ada → actual 0**; verified = input ?? (actual>0 ? actual : **plan**); regenerateDaily; rateMultiplier diset flat 1.5 |
| Approved → (verify) | verifiedMinutes ?? actual | koreksi verified; regenerateDaily; **input 0 via API menjadi undefined → pakai actual** (tidak bisa nol-kan) |
| Pending → Rejected | note wajib | regenerateDaily (OT hilang dari rekap) |
| Pending/Approved → Cancelled | — | regenerateDaily |
| Approved → Paid | **confirmRun payroll SALARY**: `overtimeDate ∈ [period.startDate, period.endDate]` — window **period**, bukan window transfer | paidRunNo; **ikut rekap berikutnya** (lihat K-1) |
| Paid | — | tidak bisa cancel/verify; dihitung ulang oleh recapPeriod (status Approved+Paid) |

### 3.3 Status WorkOffPermission: Pending → Approved (regenerateRange rentang, semua karyawan) /
Rejected (note wajib) / Cancelled (regenerateRange). `deductLeave` & `recurrence` tersimpan
**tanpa efek** ke modul Leave.

---

## 4. AUDIT KALKULASI WAKTU

**Telat/pulang cepat (benar)**: late = (checkIn − schedIn − tolLate) di-floor ke kelipatan
`roundingMinutes` (live: 09:20 pada OFFICE 08:00 ±10 → late 70, floor 5 ✓). early =
(schedOut − checkOut − tolEarly) — live MII00018 malam: in 22:01/out 06:09 vs 22:00/06:00 ±5
→ late 0 early 0 ✓. Status Late hanya jika late>0; early>0 tetap "Present".

**Shift malam lintas hari (sebagian benar, 2 cacat)**: checkIn diambil dari tanggal D, schedOut
= timeOut+1 hari ✓ (live 22:01 D → 06:09 D+1, work 488). Cacat: (a) untuk `nextDay=false`,
OUT setelah 00:00 dibuang → Absen penuh (K-2); (b) untuk `nextDay=true`, window [D, D+2) tanpa
batas → checkOut bisa memakai OUT sore hari D+1 milik shift berikutnya; dan baris hari D+1
menyimpan checkOut 06:09 milik shift D (live: MII00018 2026-09-30 status Off dengan checkOut
06:09 — polusi data).

**Break tidak dipotong**: workMinutes = out−in mentah (cap 960); `breakMinutes/breakPaid`
dimuat ke ResolvedSchedule tapi tidak pernah dipakai → karyawan OFFICE yang masuk telat 1 jam
namun pulang tepat waktu hanya "kehilangan" 60 mnt di bucket absence (tanpa efek uang),
istirahat tidak pernah mengurangi jam normal.

**Lembur**: actual = overlap jendela order × clock (cap 600) — logika overlap benar (fix Task
17; data lama OT-2026-016 act 600 adalah artefak seed sebelum fix). Upah = Σ per interval 30
mnt (ceil) × multiplier kategori. **Tier Holiday salah**: kode `jam ≤5 → 2×; jam 6–7 → 3×;
jam ≥8 → 4×` (AS:423-424); PP 35/2021 Pasal 28: **7 jam pertama 2×, jam ke-8 3×, jam ke-9
dst 4×**. Simulasi gaji 5jt/8 jam: kode Rp 578.035 vs seharusnya Rp 491.329 (**+17,6%**) —
overpay. Weekday (1,5×/2×) & Weekend (2×/3×) sesuai Pasal 26/27. Rounding lembur `ceil` 30 mnt
hardcode — `overtimeRoundingMinutes` & `minOvertimeMinutes` di rule tidak dipakai.

---

## 5. TEMUAN PER SEVERITY

### KRITIS

**K-1 · Lembur Paid tetap dihitung di rekap window berikutnya → risiko dibayar 2×**
`attendance-service.ts:271-272` (regenerateDaily otByEmp), `:473-481` + `:526-529`
(recapPeriod otPay), via `transferToPayroll:595`. Filter `status in ["Approved","Paid"]`
tanpa memeriksa `paidRunNo`. Live: rekap Sep overtimePay Rp 2.236.561 seluruhnya berasal dari
5 order ber-status **Paid** (paidRunNo PR-2026-09-SAL-01). Skenario nyata: HR membuka period
Okt dan mentransfer jendela cutoff oranHR 25 Sep–24 Okt → kelima order Sep dibayar **lagi**
di run Okt (assignment baru period Okt; run Sep sudah Confirmed tidak ter-koreksi).
Saran fix minimal: di `recapPeriod`/`transferToPayroll` filter OT dengan `paidRunNo: null`
(hanya Approved yang belum dibayar); regenerasi display boleh tetap memuat Paid.

**K-2 · Clock-out lewat tengah malam (tipe hari non-lintas-hari) → dianggap Absen penuh**
`attendance-service.ts:284` (filter `l.timestamp < dayEnd || dayType?.nextDay`) + `:353-356`.
Karyawan OFFICE/SHIFT1/2 yang bekerja lembur hingga 00:30 (OUT 00:30 D+1): log OUT dibuang →
`checkOut=null` → status **Absent "Tanpa clock-out", absenceMinutes = 480** → potongan TABS
1/25 gaji untuk hari yang justru dikerjakan; approve order lembur hari itu juga mendapat
actual 0 → verified = plan (AS:770-776). Kebalikannya, `nextDay=true` tanpa batas atas
(AS:284-286) membuat checkOut bisa memakai OUT sore D+1 (workMinutes menggelembung, cap 960)
dan baris hari D+1 menyimpan checkOut 06:09 milik shift D (live MII00018 2026-09-30).
Saran fix minimal: izinkan OUT hingga jam tertentu setelah tengah malam (mis. ≤ schedOut+X
jam, atau < IN-pertama-hari-berikutnya), dan untuk nextDay batasi checkOut sebelum IN
berikutnya.

**K-3 · Flag `Paid` ditandai dari window period run, bukan window transfer yang dibayarkan**
`attendance-service.ts:660-666` (`markOvertimePaidForRun`: `overtimeDate ∈ period.start–end`)
vs `transferToPayroll` yang membayar window bebas (input.from/to). Jika HR mentransfer
jendela 25 Agu–24 Sep ke period Sep, order 25–30 Sep yang Approved ditandai **Paid saat
confirmRun tanpa pernah masuk payroll** — period Sep jadi Processed (tidak ditawarkan lagi di
UI transfer), status Paid menutup follow-up → **uang lembur hilang**. Ditambah: transfer ke
process type ≠ SALARY tidak pernah ditandai Paid (`:659` return 0). Gabungan K-1+K-3 =
integritas flag Paid lemah di kedua arah (double & lost). Saran fix minimal: saat transfer,
simpan window transfer (mis. catatan pada assignment atau kolom `transferredWindow` di
order); `markOvertimePaidForRun` hanya menandai order yang benar-benar termuat dalam transfer
period tsb.

### MAJOR

**M-1 · Batas tier multiplier lembur Holiday tidak sesuai PP 35/2021 Pasal 28**
`attendance-service.ts:423-424`. Kode 2×/3×/4× pada jam 1-5/6-7/8+; seharusnya 2× (7 jam
pertama), 3× (jam ke-8), 4× (jam ke-9+). Overpay +17,6% per 8 jam lembur libur (simulasi
5jt: 578.035 vs 491.329). Saat ini latent (MII belum punya day type kategori Holiday — lihat
G-2), tapi kategori tersedia di UI dan multiplier langsung memengaruhi uang.
Fix: `hourIndex <= 7 ? 2 : hourIndex === 8 ? 3 : 4`.

**M-2 · Clock-in saja / lupa clock-out = Absen penuh + potongan 1/25 gaji**
`attendance-service.ts:353-356`. Praktik umum Indonesia: lupa clock-out dianggap hadir
(pulang tepat waktu) atau masuk antrean koreksi; oranHR punya Employee Clocking Approval.
Di sini langsung Absent full-day (live: 26 baris Sep, semuanya full absenceMinutes).
Tidak ada fitur koreksi rekap oleh admin (field `revised/revisedBy/state "Revised"` ada tapi
tak pernah diset; upsert malah me-reset). Fix minimal: cabang "Tanpa clock-out" → hadir
dengan early = sisa toleransi + flag butuh koreksi (state "Revised"/note), bukan Absent.

**M-3 · Pulang cepat > toleransi tidak ada konsekuensi**
`attendance-service.ts:366-369` menghitung earlyMinutes, tapi `recapPeriod:522-525` hanya
punya potongan telat (per menit) dan absen (per hari). Live: MII00011 2026-09-09 early 105
mnt (di luar toleransi 10) → status Present, abs 61 mnt, **potongan 0**. oranHR memetakan
EARLYOUT ke wage. Fix minimal: tambahkan potongan early (per menit, komponen TLATE atau
TEARLY) atau minimal masukkan early-beyond-tolerance sebagai absenceMinutes berbayar.

**M-4 · Empat setelan ditawarkan UI tapi tidak berpengaruh ke engine**
`AttendanceRule.nonClockingPolicy` (ByHours/ByDays), `minOvertimeMinutes`,
`overtimeRoundingMinutes` (settings.ts:38-40; provisioning.ts:377-378; UI
attendance-templates.tsx:499-510) — grep seluruh src: hanya disimpan/ditampilkan, tidak pernah
dibaca kalkulasi. Demikian pula `WorkDayType.flexible` dan `breakMinutes/breakPaid`
(dimuat di AS:52-53/98-100, tak pernah dipakai). HR bisa yakin salah konfigurasi.
Fix minimal: terapkan minOvertimeMinutes/overtimeRoundingMinutes di `overtimePayFor` &
`submitOvertimeOrder`, atau hapus/label "segera" di UI.

**M-5 · Jendela transfer bebas overlap antar period, tanpa penanda baris sudah ditransfer**
`attendance-service.ts:570-595` + `api/absence.ts:49-73`. Idempoten hanya per (period ×
processType). Transfer jendela 1–30 Sep ke period Sep lalu jendela 25 Sep–24 Okt ke period
Okt → TABS/TLATE/TKEHADIRAN hari 25–30 Sep dipotong/dibayar dua kali (oranHR punya kebijakan
"Duplicate Period Entries"). Fix minimal: catat window transfer terakhir per period (atau
tandai AttendanceDaily.transferredPeriod) dan tolak/warn overlap.

**M-6 · Approve lembur tanpa bukti clock & tanggal masa depan**
`attendance-service.ts:721-727` (overtimeDate boleh mendatang, tidak divalidasi ≤ hari ini)
dan `:776` (fallback verified = plan bila actual 0). Order bisa diajukan + disetujui sebelum
tanggal terjadi → terbayar penuh meski karyawan tidak datang (live: OT-2026-015 Paid dengan
actual 0, verified 240 — artefak seed, tapi jalur kodenya sama). Fix minimal: tolak approve
jika `overtimeDate > hari ini`; jika daily belum ada → verified 0 (menunggu verify).

### MINOR

**m-1** · `attendance-service.ts:338-348` — blok `else if (isOffDay)` duplikat setelah cabang
`if (isOffDay)` pertama (303-313): dead code (jalur tak terjangkau) — bau kode, rawan salah
edit. Hapus.
**m-2** · `attendance-service.ts:783` — `rateMultiplier: 1.5` flat saat approve (informasional
menyesatkan; order Weekend live tersimpan 1.5 padahal multiplier efektif 2×). Hitung dari
kategori atau biarkan null.
**m-3** · `api/clocking.ts:31-40` & `attendance-service.ts:951-961` — stats/summarize tanpa
bucket `OnLeave` → 17 Sep (mass leave 42 karyawan): total 42, hadir/telat/absen/izin/off
semua 0 — KPI tak bisa direkonsiliasi. Tambah kategori cuti.
**m-4** · `api/day-types.ts:31-32,72-73` — `timeIn/timeOut` tidak divalidasi format HH:MM di
API (UI memakai `type="time"`, API terbuka); string asing masuk `atTime()` → jam rollover
senyap. Validasi regex `/^\d{2}:\d{2}$/` + rentang 0-23/0-59.
**m-5** · `api/assignments.ts:71-74` — auto-close hanya assignment `validTo=null`; assignment
dengan validTo eksplisit di masa depan tidak ditutup → overlap dua jadwal aktif; validFrom
lebih awal dari assignment open menghasilkan validTo < validFrom (assignment mati senyap).
**m-6** · `api/matrix.ts:36-61` — N+1: 42 karyawan × 7 hari × resolveDayType (±300+ query
per GET). Masih 0,45 dtk di MII; skala ribuan karyawan akan berat. Batching assignment+days
sekali lalu hitung in-memory.
**m-7** · `attendance-service.ts:702-707, 828-833` — `nextOrderNo/nextWorkoffNo` count+1
race (submit bersamaan → unique clash). `:680-698 recordClockLog` menerima timestamp masa
depan tanpa validasi dan tanpa `activityLog` (jejak audit clock manual tidak ada).
**m-8** · Data seed: `WO-2026-006` (paid=false, deductLeave=false) melanggar aturan validasi
service sendiri (`submitWorkoff:857-859` menolak kombinasi tsb) — inkonsistensi data demo;
`OT-2026-016` actual 600 (cap) artefak pra-fix; order 13 Sep ber-status Paid padahal hari ini
2 Sep (seed menulis masa depan).
**m-9** · `attendance-service.ts:468-470, 493` — recapPeriod hanya karyawan **Active** dengan
`baseSalary` assignment **saat ini**: karyawan resign mid-period tidak terpotong di run
terakhirnya; upah lembur/potongan memakai gaji hari ini, bukan gaji saat kejadian (rapel).

### GAP (proses standar presensi Indonesia belum ada)

- **G-1 · `WorkOffPermission.deductLeave` tidak pernah memotong saldo modul Leave** (oranHR
  "Deduct Leave"). Absensi & Izin (workoff) dan modul Cuti berjalan paralel tanpa sinkron —
  saldo cuti bisa "dipakai dua kali" (izin + cuti terpisah) atau tidak berkurang.
- **G-2 · Kalender hari libur nasional tidak ada** — kategori day type Holiday tersedia tapi
  tidak ada mekanisme menandai tanggal libur nasional (17 Agustus, Idul Fitri, dll.) maupun
  Day Substitute/tukar hari; hari besar jatuh hari kerja dihitung workday biasa → multiplier
  lembur Holiday tak pernah terjadi (berkait M-1).
- **G-3 · Cap lembur legal tidak ada guard** — UU 13/2003 Pasal 12 jo. PP 35/2021: maks 4
  jam/hari & 18 jam/minggu; submit/approve menerima plan/verified berapa pun (plan 1020 mnt
  di simulasi diterima).
- **G-4 · Koreksi manual rekap harian + approval clocking tidak ada** — satu-satunya koreksi
  adalah menambah clock log manual lalu refresh; `state "Revised"/revised/revisedBy` mati.
- **G-5 · Deteksi absen bergantung refresh manual** — baris harian hanya lahir dari clock log
  karyawan tsb / tombol Refresh per tanggal / approval izin-cuti; tanpa disiplin refresh
  harian, karyawan tanpa clock tidak muncul sebagai Absen di rekap (tanpa import mesin —
  G-8 — tidak ada sumber massal otomatis).
- **G-6 · Pembulatan granular (User Defined Rounding oranHR)** tidak ada — hanya floor
  kelipatan N untuk telat; lembur ceil 30 mnt hardcode; tabel interval (0-5→0, 6-15→15) tak
  tersedia.
- **G-7 · Break/Lunch wage tidak dihitung** — istirahat tidak mengurangi jam kerja normal,
  `breakPaid` diabaikan (oranHR BREAK wage).
- **G-8 · Import mesin finger / ESS mobile / geofence & `WorkOffPermission.recurrence`**
  — enum source "Machine|Mobile" sudah disiapkan; recurrence tersimpan tak dipakai
  (dinyatakan backlog di ANALISA — dicatat untuk kelengkapan BPA).

### Yang sudah benar (paritas terverifikasi live)

- Rotasi cycle + anchor Senin benar: MII00018 minggu ini `OFF,OFF,SHIFT1,SHIFT2,SHIFT3,OFF,OFF`
  (cycle 5 hari) sesuai ROTASI-3R; 42/42 karyawan aktif ter-assign; karyawan tanpa jadwal = 0.
- Shift malam lintas hari: SHIFT3 22:00–06:00+1 terhitung benar (late/early toleransi 5 mnt,
  work 488).
- Integrasi Leave→TA: approve LR/ML → status OnLeave paid/unpaid + setengah hari sesi AM/PM
  (51 baris OnLeave; 42 karyawan mass leave 17 Sep normal 480 "Cuti Cuti Tahunan (dibayar)").
- Transfer idempoten per period (delete+rewrite Specific; period Locked/Closed ditolak; UI
  hanya menawarkan period Open/Processing; process type dipilih).
- Upah 1/173 dengan multiplier weekday/weekend sesuai PP 35 Pasal 26/27; estimasi rekap
  tampil transparan di UI Absensi & Lembur.
- Kehadiran sempurna (TKEHADIRAN) hanya bila tanpa telat/absen/izin unpaid — sesuai kebijakan
  umum; TLATE per menit (1/173) dan TABS per hari (1/25).

---

## 6. KESIMPULAN & REKOMENDASI PRIORITAS

1. **Kunci integritas rantai lembur→payroll** (K-1, K-3, M-6): filter `paidRunNo = null` di
   rekap transfer; catat window transfer; tolak approve lembur tanggal mendatang. Perubahan
   kecil, menutup risiko uang hilang/dobeldua.
2. **Perbaiki jendela clock lintas tengah malam** (K-2, satu kondisi di filter log + batas
   checkOut) dan **relaksasi hukuman lupa clock-out** (M-2) — dua baris cabang di
   `regenerateDaily`.
3. **Koreksi tier Holiday** (M-1) satu baris; **aktifkan/hapus setelan mati** (M-4);
   **guard overlap window transfer** (M-5).
4. Backlog BPA berikutnya sesuai kebutuhan Indonesia: kalender libur nasional (G-2),
   deductLeave workoff (G-1), cap lembur (G-3), koreksi manual + approval (G-4).
