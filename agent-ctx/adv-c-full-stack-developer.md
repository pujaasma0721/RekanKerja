# Task adv-c — Advance Search wiring: PAYROLL module (7 files)

Agent: full-stack-developer (adv-c)
Task: Wiring `AdvSearchButton` (infra final Task adv-search) ke seluruh view list modul PAYROLL — client-side, adv = filter TAMBAHAN di atas semua query/filter/select server yang sudah ada. Infra `adv-search.ts` / `adv-search.tsx` TIDAK disentuh.

## Infra yang dipakai (FINAL — tidak diubah)
- `src/rekankerja/shared/lib/adv-search.ts` — `txt/num/dt/sel`, `filterRowsByAdv`, `AdvSearch`, `AdvFieldDef`.
- `src/rekankerja/shared/components/adv-search.tsx` — `<AdvSearchButton fields value onChange className>`.
- Contoh wiring: `employee-directory.tsx` (ADV_FIELDS module-level + tombol di toolbar).

## File ter-wire (7/7 target, tidak ada view list payroll yang di-skip)
| # | File | Field | Penempatan tombol |
|---|------|-------|-------------------|
| 1 | payroll-profiles.tsx (PayrollProfilesPage) | employeeNo, fullName, orgUnitName, positionName, gradeName, baseSalary(num), npwp (getter `r.profile?.npwp`), taxStatus (sel 12 opsi dari TAX_STATUS_OPTIONS + TAX_STATUS_OPTION_EN), processMethod (sel GrossToNet/NetToGross), wageTemplateName, bankName, bankAccount — semua field profil via getter arg-4 | toolbar sebelah search & tombol Sinkron PTKP; adv di atas query+sort SERVER (`sortedRows` = filterRowsByAdv) |
| 2 | wage-components.tsx (WageComponentsPage) | code, name, type (sel Earning/Deduction/Informational), wageType (sel 13 opsi dari WAGE_TYPE_LABEL(_EN)), calcMethod (sel Fixed/Formula/Tax), amount(num "Nilai Tetap"), formula (text via getter `c.formula`), incomeTaxMethod (sel dari TAX_METHOD_LABEL(_EN)), ruleCount(num), includeInTHP (sel Ya/Tidak via String), active (sel Aktif/Nonaktif via String) | toolbar search diubah jadi flex (search + tombol adv); `components` = filterRowsByAdv → useTableSort menerima hasil adv |
| 3 | payroll-runs.tsx (PayrollRunsPage) | runNo, periodName (getter `r.period?.name`), processTypeName (getter `r.processType?.name`), status (sel dari RUN_STATUS_LABEL(_EN) — Draft/Calculated/Confirmed/Paid/Cancelled), employeeCount, totalBruto, totalDeduction, totalTax, totalNet (num), slipPassword (sel berpassword/tanpa via String — boolean di RunRow), calculatedAt (dt) | filter bar sebelah select period/status; counter "{n} run" & empty-state ikut hasil adv |
| 4 | payroll-benefits.tsx (PayrollBenefitsPage) — 2 tab, 2 state adv | CLAIM: claimNo, employeeNo/employeeName (getter `c.employee?.*`), benefitTypeName (getter `c.benefitType?.name`), claimDate(dt), amount, approvedAmount, limitUsed, limitRemaining (num), status (sel dari STATUS_FILTERS + STATUS_FILTERS_EN), description, paidRunNo. TYPES: code, name, category (sel 6 kategori via CATEGORY_LABEL_EN), resetPeriod (sel via RESET_LABEL(_EN)), maxClaimAmount, activeClaimCount, totalApprovedAmount (num), active (sel via String) | claims: tombol ml-auto di baris chip status; types: toolbar `flex justify-end` di atas grid kartu; `claims`/`types` memo SEBELUM useTableSort/map; counter tab ikut hasil adv |
| 5 | payroll-run-detail.tsx (PayrollRunDetailPage — hasil run per karyawan) | employeeNo, employeeName, orgUnitName, positionName, ptkpStatus (sel 12 opsi TAX_STATUS_OPTIONS), bruto, deduction, taxRegular, taxIrregular, net (num) | tombol sebelah Input "Cari karyawan…" di header tabel hasil; `lines` = filterRowsByAdv DI-LUAR filter q lama (panggilan inline, BUKAN useMemo — komputasi lama berada SETELAH early-return, rules-of-hooks) |
| 6 | non-employee-payments.tsx — 3 tab, 3 state adv | PAY: docNo, partnerName/serviceKind (getter `p.partner?.*`), description, grossAmount, dpp, pph21, netAmount (num), paymentDate (dt), taxYear (num), taxMonth (sel "1".."12" MONTH_ADV_OPTIONS = MONTHS + MONTHS_EN baru), status (sel Draft/Paid/Cancelled). PARTNER: code, name, serviceKind, idType (sel npwp/nik/none), idNumber (text — nilai terenkripsi null = no-match sesuai kontrak), isCatering (sel via String), paymentCount (num getter `p._count?.payments`), active (sel via String). LEDGER: year (num), month (sel), paymentCount, totalGross, totalDpp, totalPph21 (num) | payments: sebelah select status; partners: wrapper `space-y-3` + toolbar `flex justify-end` di atas Card; ledger: `ml-auto` di baris select tahun; totals (count/bruto/PPh21) kartu kecil ikut hasil adv |
| 7 | payroll-transactions.tsx — 2 tab list, 2 state adv | LOANS: letterNo, employeeName/employeeNo (getter `l.employee?.*`), loanDate (dt), amount, installmentCount, installmentAmount, interestRate, paidAmount, outstanding (num), startPaymentDate (dt), status (sel Active/PaidOff/Submitted/Rejected/Cancelled), purpose. COMPONENTS: employeeName/employeeNo (getter), componentName/componentCode (getter `a.wageComponent?.*`), kind (sel Specific/Periodic), basedDate (dt), amount (num), notes | toolbar `flex justify-end` di atas Card tiap tab; `assignments` memo → useTableSort; counter tab ikut hasil adv. Tab "rapel" TIDAK di-wire — bukan list (kartu penjelasan statis + dialog, tanpa tabel data) |

## Keputusan/deviasi (terdokumentasi)
1. `slipPassword` di RunRow adalah BOOLEAN (spec awal bilang "text") → dibuat select Berpassword/Tanpa password via getter `String(r.slipPassword)`.
2. `calcMethod` wage-components → SELECT Fixed/Formula/Tax ("Tax" muncul di render baris meski tidak ada di select dialog).
3. payroll-run-detail: filter adv dipanggil INLINE (bukan useMemo) karena `lines` dihitung setelah early-return loading/error — menaati rules-of-hooks; footer total & header count tetap dari `run.lines` penuh (total run, bukan hasil filter).
4. non-employee-payments `idNumber` mitra dimasukkan sebagai TEXT — NPWP/NIK tersimpan terenkripsi (null saat masked) → operator teks no-match, empty/notEmpty tetap berguna (kontrak vault-masked).
5. Benefits types tab (semula opsional di spec) tetap di-wire — grid kartu adalah list view; claims & types masing-masing punya state adv terpisah (pola 2-tab adv-b di ess-claims).
6. Rapel tab di payroll-transactions di-skip (alasan: tanpa tabel list — hanya kartu edukatif + tombol dialog).
7. Select options selalu di-reuse dari peta label file (RUN_STATUS_LABEL, STATUS_FILTERS, CATEGORY_LABEL_EN, RESET_LABEL, WAGE_TYPE_LABEL, TAX_METHOD_LABEL, TAX_STATUS_OPTIONS, MONTHS) — tidak ada hardcode label ganda.

## Verifikasi
- `bunx tsc --noEmit` → 0 error (bersih).
- `bun run lint` → 0 error, 7 warning pre-existing (file lain + 1 infra adv-search.tsx yang tidak boleh diubah) — sama persis dgn baseline adv-a/adv-b.
- dev.log (sesi sebelumnya): tidak ada error kompilasi; server dev tidak aktif saat pemeriksaan akhir — tsc lintas-projek menjadi jaminan kompilasi.
- Filter/query/sort yang sudah ada TIDAK tersentuh — adv selalu pembungkus luar; sort hook (useTableSort) kini menerima hasil adv sesuai pola adv-a (leave-balances).
