# Task adv-d — Advance Search wiring: TIME-ATTENDANCE module

## Ringkasan
Wire tombol + dialog Advance Search (`AdvSearchButton` dari
`@/rekankerja/shared/components/adv-search`) ke 9 view list modul
TIME-ATTENDANCE. Semua wiring CLIENT-SIDE (`filterRowsByAdv`) — filter TAMBAHAN
di atas query/status/tab filter yang sudah ada (tidak ada logika lama yang
diubah), persis pola kontrak Task adv-search & contoh employee-directory.

## File yang di-wire (9/9, tanpa skip)
| View | Baris | Field |
|---|---|---|
| attendance-clocking.tsx | DailyRow | 13 field (employeeNo, fullName, orgUnitName, workDate dt, dayTypeName, status sel via ATT_STATUS_LABEL [7 status], presence txt, checkIn/checkOut txt via getter HH:MM, late/early/work/overtime minutes num) |
| attendance-absence.tsx | RecapRow | 13 field (…, scheduledDays, presentDays, lateCount, lateMinutes, absentDays, workoffUnpaidDays, overtimeMinutes, overtimePay, deductions = lateDeduction+absenceDeduction via getter, attendanceAllowance) |
| attendance-overtime.tsx | OvertimeRow | 16 field (orderNo, letterNo, employeeNo/fullName getter nested, orgUnitName, overtimeDate dt, timeFrom/timeTo txt HH:MM getter, dayCategory sel OT_CATEGORY_LABEL, plan/actual/verified minutes, rateMultiplier, status sel STATUS_FILTERS, estPay num `?? undefined` anti-mask-null→0, reason) |
| attendance-workoff.tsx | WorkoffRow | 12 field (docNo, employeeNo/fullName getter, orgUnitName, dateFrom/dateTo dt, allDay sel boolean, timeFrom txt "HH:MM" asli, paid & deductLeave sel boolean via String(), reason, status sel) |
| attendance-shift-swap.tsx | SwapRow | 11 field (code, swapDate dt, createdAt dt, requester/target nama+no via getter, jadwal requester/target, reason, status sel) |
| attendance-assignments.tsx | AssignmentRow | 11 field (employeeNo/fullName/orgUnitName getter bersarang, scheduleCode/scheduleName getter, cycleDays num getter, validFrom/validTo/anchorMonday dt, anchorSequence num, clockingRequired sel boolean) — hanya tabel penugasan AKTIF (riwayat 30 baris bawah tidak ikut, selaras perilaku query) |
| attendance-matrix.tsx | MatrixRow | 3 field (employeeNo, fullName, orgUnitName) — sesuai instruksi "keep simple" |
| attendance-liveboard.tsx | LiveboardRow | 10 field (fullName, employeeNo, orgUnitName, workLocationName, state sel [inOffice/done/noClock/off/absent + label seksi], status sel ATT_STATUS_LABEL, checkIn/checkOut txt HH:MM getter, lateMinutes num) |
| attendance-reports.tsx | EmployeeRow | 12 field (employeeNo, fullName, orgUnitName, presentDays, lateDays, lateMinutes, absentDays, workoffDays, onLeaveDays, offDays, workHours, overtimeHours) — di tab "Per Karyawan" |

## Catatan penting
- attendance-absence: daftar workoff pending di view ini HANYA banner jumlah +
  tombol navigasi ke menu workoff (tidak ada list baris) → tidak ada yang
  perlu di-wire selain tabel rekap.
- overtime `estPay` nullable (Brankas Uang) → getter `?? undefined` supaya
  nilai ter-mask tidak dianggap 0 (pola adv-b travel).
- checkIn/checkOut/timeFrom(time overtime)/liveboard dikonversi ke "HH:MM"
  lokal lewat getter `hmLocal` (toTimeString().slice(0,5)) — selaras render
  toLocaleTimeString; workoff timeFrom memang sudah string "HH:MM" dari API.
- Tidak ada view dengan tombol "reset semua filter" → tidak perlu setAdv(null)
  tambahan (Reset adv ada di dialog).
- Sort hook (overtime/assignments) & slice 80 (matrix) tetap bekerja di atas
  hasil adv.

## Verifikasi
- `bunx tsc --noEmit` → 0 error.
- `bun run lint` → 0 error, 7 warning pre-existing (file lain + 1 di infra
  adv-search.tsx yang tidak boleh diubah).
- dev.log: tidak ada error kompilasi.
- git diff: hanya 9 file target (+253/−32). Infra adv-search & file agent
  lain tidak tersentuh.
