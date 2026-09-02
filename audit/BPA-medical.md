# BPA-AUDIT · Modul Medical Benefit (OneVity HRIS) — Task 24-f

**Auditor**: sub-agent BPA · **Metode**: baca penuh `src/onevity/medical/` (8 api + medical-service.ts 1.091 baris + medical-seed.ts + 10 komponen), `prisma/schema-tenant.prisma` (6 model, L1349–1515), `ANALISA-MEDICAL.md`, worklog Task 21–23; probing runtime **GET-only** (login hrd@mii.co.id → tenant MII) terhadap 7 endpoint + payroll-journals/component-assignments untuk konsistensi. **0 mutasi**.

---

## 1. Ringkasan

Modul Medical mengimplementasikan alur inti oranHR 12 halaman → 8 view secara cukup lengkap: master jenis benefit (limit UNLIMITED/NOMINAL/FACTOR×gaji/frekuensi/unused CASH-CARRY-FORFEITED/dependent), generate saldo per tahun (idempoten + Benefit Limit Correction + carry-over), klaim multi-baris perawatan dengan snapshot saldo, approval state machine oranHR (Submit/Return/Approve/Reject/Cancel/Settle + StatusLog), settle = jurnal otomatis **Debit 5106 Beban Kesejahteraan Medis / Credit 1101 Kas** + saldo used bertambah, adjustment ± dengan approval, transfer sisa saldo CASH → komponen payroll **UMC** (konsumsi saldo = anti double-pay antar period), KPI/laporan.

**Namun audit proses bisnis menemukan 4 KRITIS, 7 MAJOR, 9 MINOR, 10 GAP.** Pokok masalah: (1) **formula plafon salah** untuk jenis CASH/CARRY saat generate tahun baru — dengan data live MII hari ini, generate 2027 akan memberi seluruh 42 karyawan sisa rawat jalan **Rp 0**; (2) **settle membayar penuh tanpa re-check saldo** → klaim over-limit dan klaim atas saldo yang sudah dicairkan via UMC tetap dibayar jurnal (double pay); (3) **klaim dependent pada jenis SHARED tidak mengurangi plafon bersama** (bukti live: saldo dependent −1.750.000); (4) **transfer UMC bisa dilakukan kapan saja** (live: saldo 2026 dicairkan 2 Sep 2026 → karyawan kehilangan benefit rawat jalan Sep–Des 2026).

Data live MII (verifikasi 2026): 336 saldo 2026 (+42 saldo 2025 RAWAT_JALAN) = 378; 11 klaim (5 Settled = Rp 15.900.000, 4 Submitted, 1 Approved over-limit Rp 11.500.000, 1 Rejected); 12 baris perawatan; 4 adjustment (3 Approved, 1 Submitted); 42 transfer UMC Rp 1.052.000.000 ke period Desember 2026; 5 jurnal JV-2027…JV-2031 (Debit 5106 / Credit 1101, balance ✓).

---

## 2. Peta proses as-is (plafon → saldo → claim → approval → settle jurnal → payroll UMC)

```
[1] Master Jenis Benefit (medical-benefit-type → POST /types → upsertBenefitType)
      limitRule: UNLIMITED | NOMINAL | FACTOR(×gaji) | WAGE_COMPONENT(fallback gaji)
      frekuensi (freqValue/freqPeriod YEAR), unusedRule FORFEITED|CASH|CARRY,
      pct company/asuransi (✗ tak dipakai), dependent (maxDep/umur/SHARED|TOTAL|EACH)
            │
[2] Generate Saldo (medical-info → POST /balances → generateBalances)
      karyawan Active × jenis aktif × tahun; gaji = assignment validTo=null
      benefitAmount = benefitLimitFor(tipe, gaji); depBenefit = limit jika ≠ SHARED
      carriedOver = min(sisa th lalu, maxCarryOver) [CARRY]
      initialUsed  = prev.usedAmount [CASH/CARRY]  ← ✗ BUG (lihat §4)
      idempoten: create bila belum ada; update hanya bila "Benefit Limit Correction"
            │
[3] Ajukan Klaim (medical-claim → POST /claims → submitClaim)
      preview snapshot (limit/used/remaining/frekuensi/provider aktif)
      validasi: karyawan Active, jenis aktif, approved ≤ bill per baris, tidak negatif,
      frekuensi (hitung klaim tahun kalender berjalan), over-limit soft guard 2× sisa
      ✗ tidak ada validasi tanggal (masa depan / lintas tahun / sebelum joinDate),
      ✗ tidak ada dedupe kwitansi, ✗ provider hanya free text
      state awal: Draft (submit:false) / Submitted (default) + statusLog
            │
[4] Approval (medical-approval → PATCH /claims {action} → decideClaim)
      Submit | Return | Approve | Reject | Cancel | Settle (state machine §3)
      ✗ Approve tidak re-check saldo/frekuensi/tanggal
            │
[5] Settle ( Approved → Settled )
      generateSettleJournal: Debit 5106 per baris approved (memo: jenis + nama dirawat)
                             Credit 1101 total · Posted · JV-NNNN
      saldo: forDependent → depUsed += totalApproved, else usedAmount += totalApproved
      ✗ tanpa re-check sisa; ✗ tanpa potong gaji bagian over-limit;
      ✗ bila saldo tahun itu belum digenerate → jurnal tetap dibayar, used tidak dicatat
            │
[6] Adjustment (medical-adjustment → submit → decide approve/reject/cancel)
      approve → adjustmentAmount / depAdjustment ± langsung ke saldo
            │
[7] Transfer UMC (medical-approval → POST /transfer → transferUnusedToPayroll)
      jenis unusedRule=CASH × karyawan Active × sisa > 0 → EmployeeComponentAssignment
      Specific UMC (Earning Compensation, debit 5106) per karyawan (agregasi)
      idempoten per period (delete-rewrite); saldo dikonsumsi (used += remaining)
      ✗ tanpa guard akhir tahun; ✗ hanya pool karyawan (pool dependent tidak dicairkan)
            │
[8] Payroll confirmRun → markMedicalPaidForRun (klaim periodCode = period run → paidRunNo)
      ✗ periodCode klaim medis TIDAK PERNAH diisi oleh kode mana pun → no-op (dead code)
```

---

## 3. State machine klaim (as-implemented, medical-service.ts:735–742)

| From | Action | To | Guard | Efek samping |
|---|---|---|---|---|
| — | POST submit (`submit:false`) | Draft | master aktif + baris valid + frek + soft 2× | docNo MC-YYYY-NNN, snapshot maxBenefitAt/usedAt, statusLog |
| — | POST submit (default) | Submitted | idem | idem + log Submitted |
| Draft | submit | Submitted | — | log |
| Returned | submit | Submitted | — | log |
| Submitted | return | Returned | — | log + note (padanan Return To Requester) |
| Submitted/Returned | approve | Approved | ✗ **tidak ada re-check saldo/tanggal/frek** | log + decidedBy |
| Submitted/Returned | reject | Rejected | — | log + decidedBy |
| Draft/Submitted/Approved | cancel | Cancelled | bukan Settled | (penghapusan jurnal = dead code L754–758) |
| Approved | settle | Settled | — | **jurnal 5106/1101 Posted** + used/depUsed += totalApproved + settleDate/journalNo + log |
| Settled | (terminal) | — | settle/reject/cancel diblokir oleh `allowed` map | — |

Guard yang ADA dan benar: settle dua kali diblok state machine; reject/cancel setelah settle diblok; approve ≤ bill per baris; frekuensi per tahun kalender; karyawan/jenis harus aktif; transfer UMC idempoten + konsumsi saldo; journal balance Debit=Credit.

Guard yang TIDAK ADA: edit klaim (tidak ada endpoint edit sama sekali — klaim Returned hanya bisa disubmit ulang tanpa perubahan), reversal/storno klaim settled, validasi tanggal, dedupe kwitansi, re-check saldo saat approve/settle, validasi dependent vs EmployeeFamily.

---

## 4. Audit kalkulasi plafon (as-implemented vs seharusnya)

Rumus dasar (konsisten di listBalances L355–357, previewClaim L464, medicalStats L1039, transfer L944):

```
remaining(emp)  = benefitAmount + adjustmentAmount + carriedOver − usedAmount − initialUsed
remaining(dep)  = depBenefitAmount + depAdjustment − depUsed        (carry/initial dep tidak ada)
sisa_carry(th-1) = ben + adj + carry − used − initialUsed
```

| Kebijakan | As-implemented | Seharusnya (oranHR/analisa) | Verdict |
|---|---|---|---|
| UNLIMITED | `benefitLimitFor` = MAX_SAFE_INTEGER/1000 = 9.007.199.254.740,99 **disimpan sebagai benefitAmount & snapshot maxBenefitAt** (L208; bukti MC-2026-010) | representasi ∞ (0/null + flag) | ⚠ MINOR-1 |
| NOMINAL | limitValue | limitValue | ✓ |
| FACTOR × gaji | `round2(limitValue × baseSalary)`, gaji aktif saat generate (L209); kenaikan gaji hanya via Benefit Limit Correction | idem oranHR (generate + koreksi) | ✓ |
| WAGE_COMPONENT | fallback `baseSalary`, **wageCode diabaikan** (L210) | limit = komponen upah (oranHR MEDICAL_KL) | ⚠ MINOR-6 |
| FORFEITED tahun baru | ben baru, initialUsed 0, carry 0 | reset penuh | ✓ |
| **CASH tahun baru** | `initialUsed = prev.usedAmount` (L271) → remaining = limit_baru − used_th_lalu | limit baru penuh (sisa th lalu sudah dicairkan via UMC — used th lalu tidak relevan) | ✗ **KRITIS-4** |
| **CARRY tahun baru** | carried = min(sisa_th_lalu, maxCarryOver) **DAN** initialUsed = prev.usedAmount → sisa_th_lalu dikurangkan dua kali | remaining = limit_baru + carried (initialUsed hanya untuk migrasi awal) | ✗ **KRITIS-4** |
| Dependent SHARED | depBenefitAmount = 0; klaim dependent masuk depUsed → **plafon bersama tidak pernah berkurang** (L272–273 + L774–776) | klaim dependent memotong limit karyawan (Included in Employee's) | ✗ **KRITIS-3** |
| Dependent EACH vs TOTAL_SEPARATE | keduanya → depBenefit = limit (satu bucket agregat, L272–273); tidak per-dependen | EACH = limit per dependent; TOTAL = satu pool | ⚠ GAP |
| Transfer UMC | `used += remaining` (employee pool saja); pool dependent tidak dicairkan | oranHR: cash-out saldo tak terpakai (emp+dep) di akhir period | ✗ MAJOR-1/GAP |
| Settle | `used/depUsed += totalApproved` tanpa batas → **saldo boleh negatif**, bagian over-limit 100% beban perusahaan | potong gaji karyawan utk kelebihan plafon atau cap approved | ✗ KRITIS-1 |

**Bukti live KRITIS-4 (CASH)**: semua 42 saldo RAWAT_JALAN (CASH) 2026 kini `usedAmount = 25.000.000` (konsumsi transfer UMC 2 Sep 2026). `generateBalances(2027)` → `initialUsed = 25.000.000` → `remaining = 25.000.000 − 25.000.000 = 0` → **seluruh karyawan tidak punya plafon rawat jalan 2027 sebelum klaim apa pun**. Contoh numerik CARRY: th-1 limit 10jt terpakai 4jt → carried 6jt + initialUsed 4jt → sisa baru = 10+6−4 = **12jt** (seharusnya 16jt).

**Konsistensi agregasi (verified live)**: settledApproved 15,9jt = Σ jurnal JV-2027..2031 ✓; pendingAmount 20,9jt = 4 Submitted (9,4jt) + 1 Approved (11,5jt) ✓; MII00001 RAWAT_INAP used 1,85jt = MC-2026-011 ✓; MII00002 RAWAT_JALAN used 27jt = 25jt + adj 2jt (transfer 27jt ✓); totalBalances 336 = 42×8, listBalances 294 (UNLIMITED dikecualikan) ✓; UMC 42 baris Rp 1.052.000.000 = 41×25jt + 27jt ✓. Inkonsistensi: KPI overview "remaining" hanya pool karyawan (dep IMUNISASI 2jt + PERSALINAN 8jt × 42 = 420jt tidak tampil), sementara listBalances `totalRemaining` menjumlahkan depRemaining **termasuk depRem negatif SHARED** (MII00004 tampil −1,75jt).

---

## 5. Temuan per severity

### KRITIS

**K-1 · Klaim melebihi sisa plafon lolos & settle membayar penuh tanpa potong gaji**
`medical-service.ts:533–541` (submit: tolak hanya bila > 2× sisa — soft guard), `medical-service.ts:760–779` (settle: tidak ada re-check/cap).
Dampak: klaim over-limit sampai 2× sisa lolos ke approval; **bukti live MC-2026-005** — MII00011 RAWAT_INAP, approved 11.500.000 vs maxBenefit 8.500.000 (135%), kini berstatus Approved dan tombol "Settle & Jurnal" aktif → menekannya = jurnal Rp 11,5jt + saldo −3jt. Bagian over-limit (di luar plafon) seharusnya dipotong dari gaji karyawan atau di-cap, bukan 100% beban kas perusahaan.
Saran fix: (a) tolak submit bila totalApproved > remaining, ATAU (b) izinkan dengan flag `overLimit` wajip alasan + komponen potongan gaji otomatis untuk kelebihan saat settle; tampilkan indikator over-limit di antrean approval.

**K-2 · Settle setelah transfer UMC = double pay (kas perusahaan > plafon)**
`medical-service.ts:977–986` (transfer mengonsumsi saldo) + `medical-service.ts:760–779` (settle tak re-check).
Dampak: **bukti live** — transfer UMC 2 Sep 2026 mencairkan seluruh sisa RAWAT_JALAN (Rp 1,052 M, sudah dibayarkan payroll Des 2026), namun klaim MC-2026-006 (MII00013 RAWAT_JALAN, Submitted, 900rb) masih di antrean; approve + settle hari ini = perusahaan membayar 900rb **di atas** 25jt yang sudah dicairkan → total 25,9jt > plafon 25jt.
Saran fix: re-check `remaining ≥ totalApproved` saat approve/settle (atau setidaknya warning + alasan wajib); blokir transfer UMC bila masih ada klaim Submitted/Approved untuk jenis CASH tahun itu.

**K-3 · Klaim dependent pada depLimitRule SHARED tidak mengurangi plafon karyawan**
`medical-service.ts:272–273` (SHARED → depBenefit 0) + `medical-service.ts:774–776` (forDependent → depUsed).
Dampak: plafon bersama (rawat inap, rawat jalan, gigi, kacamata semuanya SHARED) **tidak pernah terpotong klaim keluarga** — dependent praktis klaim tanpa batas sampai guard 2× remaining karyawan; depRemaining jadi negatif. **Bukti live**: MC-2026-002 (Tri Handayani, RAWAT_JALAN dep, Settled, jurnal JV-2028 1.750.000) → MII00004: `depUsed 1.750.000, depBenefit 0, depRemaining −1.750.000`, `usedAmount` (pool bersama) tidak bertambah. UI menampilkan totalRemaining −1,75jt.
Saran fix: untuk SHARED, settle klaim dependent menambah `usedAmount` (bukan `depUsed`); validasi submit klaim dependent memakai pool yang benar; tolak `forDependent` bila `dependentEnabled=false` (KHUSUS_PJK).

**K-4 · Formula initialUsed salah untuk CASH/CARRY — plafon tahun baru hangus / double-count**
`medical-service.ts:271` — `initialUsed = prev && unusedRule==="FORFEITED" ? 0 : prev ? prev.usedAmount : 0`.
Dampak: (a) CASH: tahun baru dikurangi pemakaian tahun lalu padahal sisa sudah dicairkan tunai → dengan data live, **generate 2027 memberi seluruh 42 karyawan sisa RAWAT_JALAN Rp 0** (provable: used 2026 = 25jt); (b) CARRY: sisa tahun lalu dihitung dalam `carriedOver` LALU dikurangi lagi via initialUsed → double-count (contoh §4). Konsep oranHR "Initial Medical Benefit" adalah **migrasi manual saldo awal**, bukan auto-carry.
Saran fix: hapus auto-carry initialUsed (set 0 untuk semua unusedRule); sediakan input migrasi eksplisit (padanan halaman InitialMedicalBenefit.jsp) bila diperlukan.

### MAJOR

**M-1 · Transfer UMC tanpa guard akhir tahun — bisa kapan saja & mematikan benefit sisa tahun**
`medical-service.ts:913–947` (guard hanya period Locked/Closed; UI label "Akhir Tahun" tanpa validasi).
Dampak: live — transfer saldo 2026 dieksekusi 2 Sep 2026 → seluruh karyawan kehilangan plafon rawat jalan Sep–Des 2026; klaim baru RAWAT_JALAN ditolak (remaining 0 → guard 2× nol). oranHR: "Paid to employee in cash **at end of period**".
Saran fix: validasi period target ≥ akhir tahun saldo (endDate period ≥ 31-12-tahun) atau konfirmasi ganda + blokir bila ada klaim pending.

**M-2 · Guard tanggal hilang total (masa depan / lintas tahun / sebelum joinDate)**
`api/claims.ts:60–63` (hanya cek field wajib) + `medical-service.ts:509–531` (baris: hanya nama & nominal).
Dampak: claimDate/treatmentDate bisa diisi tanggal masa depan; klaim tahun 2026 boleh memuat perawatan 2024/2027 (tidak divalidasi tahun berjalan); klaim bisa untuk tanggal sebelum `employee.joinDate` (schema tersedia, tidak dicek). Spek tugas & praktik reimbursement menuntut tanggal ≤ hari ini.
Saran fix: validasi `claimDate ≤ hari ini`, `treatmentDate ≤ hari ini`, `getFullYear(treatmentDate) == claim.year`, `treatmentDate ≥ joinDate`.

**M-3 · Provider (RS/asuransi) tidak terhubung ke klaim — tidak ada guard provider aktif**
`MedicalClaimLine.hospital` free text (schema:1480; service:523); `previewClaim` L453–455 hanya menampilkan daftar provider aktif sebagai info.
Dampak: klaim bisa diajukan atas RS yang sudah dinonaktifkan (active=false) atau nama RS fiktif; master MedicalProvider praktis dekoratif untuk klaim (padanan oranHR: hospital_name di baris + master Hospital/Insurance).
Saran fix: relasi `providerId` di MedicalClaimLine + validasi provider aktif saat submit (atau minimal autocomplete dari daftar aktif).

**M-4 · Tidak ada pencegahan klaim ganda (dedupe kwitansi)**
`medical-service.ts:509–531` — `receiptNo` bebas, tidak pernah dicek terhadap klaim lain.
Dampak: kwitansi yang sama dapat diklaim dua kali (double claim) oleh karyawan berbeda/klaim berbeda — satu-satunya pembatas adalah frekuensi per jenis (mayoritas ∞).
Saran fix: cek unik (employeeId + receiptNo) lintas klaim non-Cancelled/Rejected → tolak atau warning di approval.

**M-5 · Frekuensi hanya per tahun kalender — MEDICAL/WORK & multi-tahun tidak diimplementasi**
`medical-service.ts:447–452` (count per `year`), `:488–492` (guard), master `freqPeriod` MEDICAL|WORK|YEAR hanya jadi teks.
Dampak: "Max Claim sekali dalam setiap X tahun" oranHR tak bisa dijalankan — **KACAMATA deskripsinya "1× setiap 2 tahun" tapi dikonfigurasi freq 1/YEAR → dijalankan 1×/tahun** (klaim 2026 + 2027 keduanya lolos, seharusnya 2027 ditolak).
Saran fix: rentang frekuensi mengikuti freqPeriod + freqValue tahun (hitung klaim dari tanggal klaim mundur X tahun); implementasi MEDICAL/WORK period.

**M-6 · markMedicalPaidForRun no-op — periodCode klaim medis tidak pernah diisi**
`medical-service.ts:998–1017` (query `periodCode = run.period.code`), grep seluruh codebase: tidak ada penulisan `periodCode` pada MedicalClaim (transfer UMC memakai EmployeeComponentAssignment, bukan klaim).
Dampak: kolom `periodCode`/`paidRunNo` MedicalClaim selalu NULL (verified live 11/11 klaim) → pelacakan "transfer medis ditandai Dibayar via run" tidak pernah terjadi; dibanding travel/leave yang benar-benar memakai periodCode→Paid.
Saran fix: hapus dead path, atau tandai pembayaran UMC pada objek yang benar (saldo/assignment) dan tampilkan status "Dibayar via run" di UI transfer.

**M-7 · pctCompany/pctInsurance diabaikan — jurnal selalu 100% beban perusahaan**
Master `pctCompany/pctInsurance/insuranceCompany` (schema:1365–1367) tidak pernah dibaca oleh `generateSettleJournal` L668–687 (Debit 5106 = penuh approved) maupun validasi klaim.
Dampak: bila HR mengatur "Paid By Insurance 50%", settle tetap mendebet 5106 & mengkredit kas 100% — beban perusahaan salah hitung; tidak ada proses klaim ke asuransi.
Saran fix: split baris jurnal (beban perusahaan × pctCompany; piutang-asuransi/kas untuk sisanya) atau tolak konfigurasi pctInsurance > 0 sampai fitur asuransi ada.

### MINOR

**m-1 · Sentinel UNLIMITED 9,007,199,254,740,99 tersimpan sebagai data** — `benefitLimitFor` L208; snapshot MC-2026-010 tampil "9 triliun" di UI snapshot limit. Fix: simpan 0/null + flag ∞.
**m-2 · `totalRemaining` kondisi aneh & menjumlah depRem negatif SHARED** — `medical-service.ts:370` `b.type.limitRule !== ""` selalu true; total MII00004 = −1,75jt. Fix: jumlahkan depRemaining hanya untuk non-SHARED; ikut K-3.
**m-3 · KPI overview sisa plafon hanya pool karyawan** — `medicalStats` L1039–1043; pool dependent 420jt tak terlihat, label tidak menjelaskan. Fix: tambah baris KPI dependent atau label eksplisit.
**m-4 · Preview vs submit beda basis tahun** — UI preview default tahun berjalan (`medical-claims.tsx:79–92`, api `claims.ts:20–21`) sedangkan `submitClaim` L484 memakai tahun `claimDate` → angka snapshot yang dipratinjau bisa berbeda dengan yang divalidasi bila claimDate diganti tahun lain. Fix: kirim `year` dari form.
**m-5 · Settle saat saldo tahun belum digenerate tetap bayar jurnal tanpa catatan used** — `decideClaim` L770–778 `if (bal)` diam-diam skip; `previewClaim` L445 fallback hitung limit untuk tahun tanpa saldo (verified live: preview 2027 = 25jt padahal belum generate). Fix: wajib saldo ada untuk submit klaim tahun itu.
**m-6 · WAGE_COMPONENT fallback gaji pokok, wageCode diabaikan** — `benefitLimitFor` L210 (oranHR: komponen MEDICAL_KL).
**m-7 · Tanpa `$transaction`** — settle = 3 tulisan terpisah (jurnal L689–701, saldo L772–777, klaim L781–793); `nextDocNo` L21–33 rawan race (unique docNo menyelamatkan sebagian). Crash mid-flight → jurnal tanpa used dsb. Fix: bungkus dalam transaksi.
**m-8 · Adjustment negatif tanpa floor** — `decideAdjustment` L858–868 bisa membuat remaining negatif tanpa peringatan; tidak ada batas/cap. Fix: validasi hasil remaining ≥ 0 atau wajib alasan kuat.
**m-9 · Dead code penghapusan jurnal saat cancel** — `medical-service.ts:754–758` (throw L754 membuat blok L756 tak terjangkau). Hapus.

### GAP (proses standar medical benefit yang belum ada)

| # | Gap | Referensi oranHR/analisa | Catatan |
|---|---|---|---|
| G-1 | **Dependents tidak terintegrasi EmployeeFamily** — treatedName free text; `maxDependents`/`maxChildAge`/`depLimitRule` tidak divalidasi saat klaim/adjustment; EACH ≡ TOTAL_SEPARATE (satu bucket) | analisa §2 (dependent 2, max 21 th, SHARED/TOTAL/EACH); modul HR punya data family | disarankan relasi familyId |
| G-2 | **Pre-authorization / surat rujukan RS** — letterNo opsional, tidak divalidasi | oranHR letter_no + praktik rujukan rawat inap | — |
| G-3 | **Copay/asuransi** — tidak ada proses klaim ke asuransi (lihat M-7) | oranHR Reimbursement Employee: Paid By Insurance % | — |
| G-4 | **Prorata karyawan baru** — karyawan masuk pertengahan tahun dapat plafon penuh | analisa §4 roadmap "prorata opsional" | — |
| G-5 | **Potong gaji bagian over-limit** — tidak ada (lihat K-1) | praktik reimbursement Indonesia | — |
| G-6 | **Lampiran bukti (file kwitansi)** — hanya nomor kwitansi teks | oranHR file_name; backlog analisa | — |
| G-7 | **ESS MyMedical wizard** — klaim hanya via HR | oranHR MyMedicalExpenseClaim | — |
| G-8 | **Segmentasi penerima benefit** (employment type/status/grade/umur/masa kerja ×10) | analisa §2 Base on Employee Characteristics | — |
| G-9 | **Laporan SummaryType drill-down + Adjustment per Employee** — reports hanya byType + rentang klaim | oranHR 3 laporan (§1 #6–8) | — |
| G-10 | **Initial Medical Benefit migrasi eksplisit** — diganti auto-carry buggy (lihat K-4) | oranHR InitialMedicalBenefit.jsp | — |

---

## 6. Kesimpulan & urutan perbaikan yang disarankan

1. **K-4** (initialUsed) — one-line fix, mencegah plafon 2027 nol massal saat generate tahun depan.
2. **K-1 + K-2** (re-check saldo saat approve/settle + treatment over-limit) — menutup jalur pembayaran melebihi plafon/double-pay.
3. **K-3** (SHARED dependent) — potong pool yang benar saat settle klaim keluarga.
4. **M-1** (guard akhir tahun transfer UMC) + **M-6** (mark-paid) — melengkapi rantai UMC.
5. Lalu M-2/M-3/M-4/M-5 (guard tanggal, provider, dedupe, frekuensi) dan backlog GAP bertahap.

*Audit read-only — tidak ada perubahan kode, tidak ada commit, tidak ada mutasi data.*
