# AUDIT BISNIS PROSES — MODUL TRAVEL (PERJALANAN DINAS) OneVity HRIS

Task ID: **24-e** · Jenis: audit READ-ONLY (tanpa mutasi, tanpa commit) · Tanggal: 2026-09-02 (jam sistem sandbox)
Cakupan: `src/onevity/travel/**` (7 api + travel-service.ts + travel-seed.ts + 9 komponen), `prisma/schema-tenant.prisma` (10 model Travel), integrasi payroll (`payroll-service.ts`, `provisioning.ts`), referensi `ANALISA-TRAVEL.md` (oranHR), probing runtime GET tenant MII + verifikasi data PostgreSQL read-only.
Data MII diverifikasi: 7 request, 6 claim, 17 baris biaya, 4 zona, 5 template, 14 jenis biaya, budget 2026 Rp 250jt (4 CC), 10 jurnal (4 klaim + 6 payroll), 1 assignment UTRP.
Temuan audit modul sebelumnya (AUDIT-MODULES.md F-04/F-11) sudah diperbaiki dan TIDAK dilaporkan ulang.

---

## 1. RINGKASAN EKSEKUTIF

Modul Travel mengimplementasikan alur oranHR secara cukup lengkap: master (zona/template/jenis biaya+limit/akun) → request multi-destinasi + uang muka → approval → klaim settlement formula (a)+(b)−(c) → approval + jurnal otomatis → transfer payroll UTRP/TRVSTLIN → Paid saat run konfirmasi, plus budget tahunan per cost center (soft limit). Formula oranHR dipertahankan dan jurnal per baris biaya benar secara struktur.

Namun audit menemukan **2 temuan KRITIS pada rantai uang** dan **8 MAJOR guard hilang**:
1. **Transfer payroll "idempoten" yang salah** — transfer kedua ke period yang sama MENGHAPUS komponen UTRP/TRVSTLIN klaim yang sudah ditransfer sebelumnya, lalu hanya menulis ulang klaim yang masih Approved → klaim lama ditandai **Paid tanpa dibayar** saat run dikonfirmasi.
2. **Klaim duplikat per request tidak diblokir** (tanpa unique constraint, tanpa guard service, dropdown UI menampilkan semua request Approved) → double reimbursement dua klik saja.
3. **Settlement (a)(b)(c) tidak dihitung server-side** — b/c input bebas klien (saran hanya placeholder); bukti data: CL-2026-006 dengan b=c=0 → uang muka tidak pernah direkonsiliasi.
4. Advance (kasbon) tidak punya siklus hidup: tercatat "sudah diberikan" sebelum request disetujui, tidak dihapus saat request ditolak, tidak ada status lunas, TRVLOAN tidak diimplementasi meski UI mengklaim begitu → **kasbon tak tertagih tidak terlihat**.

Data demo saat ini secara kebetulan konsisten angkanya (KPI budget used 3,73jt = Σ settlement klaim Transferred/Paid terverifikasi), tetapi beberapa KPI salah semantik ("Permintaan Bulan Ini" mencakup tanggal request masa depan; "Klaim Tahun Ini" mencakup klaim belum selesai/ditolak).

Skor ringkas: KRITIS 2 · MAJOR 8 · MINOR 6 · GAP 7.

---

## 2. PETA PROSES AS-IS (request → approval → advance → claim → settlement → payroll)

```
[HR] POST /travel/requests ──► TravelRequest (Submitted)
        ├─ validasi: purpose, karyawan aktif, template aktif, dateTo≥dateFrom, ≤60 hari, ≥1 destinasi,
        │  cost center auto dari orgUnit assignment aktif (fallback input)
        ├─ TravelDestination multi-kaki (seq, tanggal, kota, negara, zona, overseas)
        └─ TravelAdvance DIBUAT SAAT SUBMIT (givenAt = now, sebelum approval!)  ← M-3
                │
decideTravelRequest (PATCH /travel/requests, action approve|reject|cancel)
        ├─ approve : Submitted → Approved  (efek: boleh previewClaim; advance masuk KPI outstanding)
        ├─ reject  : Submitted|Approved → Rejected (klaim Submitted ikut Cancelled; advance TIDAK dibersihkan)
        └─ cancel  : Submitted|Approved → Cancelled (idem)
                │
[HR] GET /travel/claims?requestId= → previewClaim (HANYA di sini cek status Approved)
        │
[HR] POST /travel/claims ──► TravelClaim (Submitted) + TravelClaimExpense (multi baris)
        ├─ validasi: karyawan aktif, template aktif, ≥1 baris, jenis aktif, amount>0
        ├─ limit per jenis: amount > limitAmount → flag overLimit (WARNING saja, sesuai oranHR soft-limit)
        ├─ a/b/c = input klien (di-clamp ≥0), totalSettlement = round2(a+loss+b−c)   ← M-1 (tidak dihitung dari rincian vs advance)
        ├─ requestId opsional (klaim mandiri); status request TIDAK dicek di sini     ← M-2
        └─ request.claimRequestedAt = now (flag "sudah pernah diklaim" — hanya display) ← K-2
                │
decideClaim (PATCH /travel/claims, action approve|reject|cancel)
        ├─ approve: Submitted → Approved + generateClaimJournal (idempoten regenerate:
        │           tiap baris Debit akun jenis (fallback 5105) + a & loss Debit 5105,
        │           Credit 1101 Kas total; runNo=docNo klaim, runId=null; JV-xxxx)
        ├─ reject : Submitted → Rejected (tanpa jurnal)
        └─ cancel : Submitted|Approved → Cancelled (jurnal klaim dihapus bila ada)
                │
[HR] POST /travel/transfer {periodId} ──► transferClaimsToPayroll
        ├─ guard: period tidak Locked/Closed (period "Processed" dengan run sudah dikonfirmasi TETAP LOLOS) ← M-4
        ├─ ambil SEMUA klaim status Approved (semua tanggal — semantik oranHR HR pilih period target)
        ├─ deleteMany assignment Specific UTRP/TRVSTLIN period ini (SEMUA, termasuk milik klaim
        │   yang sudah Transferred sebelumnya) lalu tulis ulang HANYA untuk klaim Approved  ← K-1
        ├─ b (payableEmployee) → EmployeeComponentAssignment UTRP (Earning Compensation, dibulatkan)
        ├─ c (payableCompany)  → EmployeeComponentAssignment TRVSTLIN (Deduction NonTaxable)
        └─ klaim → Transferred + periodCode = period.code
                │
[payroll] buildRunRows: assignment Specific (period × processType) masuk baris run (karyawan AKTIF saja)
[payroll] confirmRun → markTravelPaidForRun:
        Transferred + periodCode = run.period.code (run SALARY) → Paid + paidRunNo
        (TANPA verifikasi komponen benar-benar ada di payslip/run item)  ← M-4
                │
[budget] listBudgets: used = Σ totalSettlement klaim Transferred/Paid dengan claimDate dalam window tahun
         (soft limit — over-budget hanya warning UI, sesuai perilaku oranHR MII)
```

Titik integrasi lain: `provisioning.ts:669-670` membuat komponen UTRP/TRVSTLIN (tanpa TRVLOAN); `payroll-service.ts:373` confirmRun memanggil markTravelPaidForRun; `travel-seed.ts` shared oleh prisma/seed.ts & scripts/migrate-travel.ts.

---

## 3. TABEL STATE MACHINE

### 3.1 TravelRequest (`status` default "Submitted"; tidak ada status Prepared seperti oranHR)

| From | Trigger (action) | Guard | To | Efek samping |
|---|---|---|---|---|
| — | POST /requests (submit) | karyawan aktif, template aktif, dateTo≥dateFrom, ≤60 hari, ≥1 destinasi | Submitted | docNo TR-YYYY-NNN; destinasi dibuat; **advance dibuat sekaligus givenAt=now**; settlementDue = dateTo + settlementDay |
| Submitted | approve | status ∈ from | Approved | boleh jadi dasar previewClaim; advance dihitung sebagai outstanding di KPI |
| Submitted, Approved | reject | status ∈ from | Rejected | klaim **Submitted** request ini → Cancelled; klaim Approved/Transferred/Paid TIDAK disentuh; **advance tidak dihapus/ditandai**; claimRequestedAt tidak direset |
| Submitted, Approved | cancel | status ∈ from | Cancelled | idem reject |
| Approved | (tidak ada edit) | — | — | **tidak ada endpoint edit/return-to-prepare sama sekali** (beda oranHR: Return To Prepare); tidak ada jalur reopen |

Catatan: `decidedById` tersedia di schema tapi **tidak pernah diisi** (m-1). Cancel/Reject setelah klaim Transferred/Paid membiarkan klaim tetap diproses bayar (M-2/M-4 cluster).

### 3.2 TravelClaim (`status` default "Submitted")

| From | Trigger | Guard | To | Efek samping |
|---|---|---|---|---|
| — | POST /claims | karyawan aktif, template aktif, ≥1 baris biaya, jenis aktif, amount>0; bila ada requestId: request milik karyawan yang sama (**status request TIDAK dicek**) | Submitted | docNo CL-YYYY-NNN; baris biaya + flag overLimit; totalSettlement=a+loss+b−c; request.claimRequestedAt=now (sekali) |
| Submitted | approve (decideClaim) | status = Submitted | Approved | generateClaimJournal → journalNo/journalDate; jurnal lama (runNo=docNo, runId null) dibuang lalu dibuat ulang |
| Submitted | reject | status = Submitted | Rejected | — |
| Submitted, Approved | cancel | status ∈ from | Cancelled | jurnal klaim dihapus bila ada (deleteMany journalNo+runId null) |
| Approved | POST /transfer {periodId} | period tidak Locked/Closed; komponen UTRP/TRVSTLIN ada; ≥1 klaim Approved | Transferred | assignment UTRP (b) & TRVSTLIN (c) period target; periodCode; **deleteMany juga menghapus assignment klaim Transferred sebelumnya di period sama** |
| Transferred | confirmRun payroll (SALARY, periodCode cocok) | run.processType=SALARY | Paid | paidRunNo + transferredRunNo = run.runNo; tanpa verifikasi isi payslip |
| Transferred, Paid | (tidak ada reject/cancel/koreksi) | — | — | **tidak ada jalur reversal post-transfer** (klaim salah transfer tidak bisa dibatalkan) |

### 3.3 TravelAdvance
Tidak punya state machine sama sekali: satu baris (amount, note, givenAt) dibuat saat request disubmit; tidak ada status (diminta/dibayar/lunas), tidak ada metode bayar (payroll/tunai), tidak ada penghapusan saat request ditolak, tidak ada penandaan lunas saat settlement. Kompensasi via c (TRVSTLIN) bergantung input manual HR (M-1) dan tidak menandai advance apa pun.

---

## 4. AUDIT KALKULASI SETTLEMENT (a)(b)(c) + BUDGET

### 4.1 Formula oranHR — implementasi
- Server (`travel-service.ts:447-451`): `a=max(0,otherCompanyExp)`, `loss=max(0,exchangeLoss)`, `b=max(0,payableEmployee)`, `c=max(0,payableCompany)`, `totalSettlement=round2(a+loss+b−c)` → **identik oranHR** (termasuk kemungkinan negatif = karyawan bon). ✓
- Saran UI (`travel-claims.tsx:97-101`): `grossRealisasi = Σbaris + a + loss`; `saranB = max(0, gross−advance)`; `saranC = max(0, advance−gross)` → logika (a) realisasi < kasbon → kembalikan; (b) = ; (c) realisasi > kasbon → bayar. Benar secara konsep, **tetapi hanya placeholder** — b/c tetap input bebas (M-1).
- Verifikasi data: CL-2026-002 (advance 15jt; rincian 13,7jt + rugi kurs 300rb = gross 14jt → c = 1jt ✓ konsisten formula). CL-2026-001 (advance 3jt; rincian 3,9jt → b = 900rb ✓).

### 4.2 Kelemahan kalkulasi yang berdampak uang
1. **Server tidak menghitung ulang b/c dari rincian vs advance** dan tidak cross-check `b+c` vs `totalExpenses±advance`. Klaim dengan advance bisa disetujui dengan b=c=0 (bukti: CL-2026-006, request TR-2026-007, tanpa pencatatan pengembalian uang muka) → selisih kasbon menguap.
2. **b>0 dan c>0 bersamaan diizinkan** (karyawan dibayar sekaligus dipotong tanpa relasi) — tidak ada validasi mutual exclusive.
3. **Ambiguitas (a)**: komponen (a) dihitung sebagai bagian realisasi bruto untuk saran b/c (mengurangi kewajiban kembalian kasbon) SEKALIGUS ditambahkan ke totalSettlement dan dijurnal Debit 5105/Credit Kas. Jika (a) memang "dibayar pihak lain", meng-kredit kas sendiri dan menganggapnya menutup kasbon adalah dobel. (CL-2026-006: jurnal JV-2026-008 total 2,5jt = rincian 1,25jt + (a) 1,25jt, sementara totalSettlement 1,25jt dan b=c=0 → angka jurnal ≠ settlement ≠ kasbon.)
4. **Klaim duplikat per request** tidak dicek (K-2): claimRequestedAt hanya flag display; tidak ada unique constraint `requestId` di TravelClaim; dropdown UI memuat semua request Approved.
5. **Tanggal**: baris biaya bebas tanggal (bukti CL-2026-002 O-LICENSE 2026-09-10 < berangkat 2026-09-14); claimDate bebas (bukti CL-2026-006 claimDate = tanggal berangkat 2026-09-02); tidak ada cek claim setelah trip selesai; tidak ada cek batas settlementDay (hanya badge overdue display).

### 4.3 Budget
- `used = Σ totalSettlement klaim Transferred/Paid dengan claimDate ∈ [startDate, endDate]` (travel-service.ts:823-839) — diverifikasi live: 900rb+730rb+850rb+1,25jt = **3.730.000** ✓ konsisten API ↔ DB.
- Klaim **Approved belum dihitung sebagai komitmen** → budget tampak lebih rendah dari komitmen berjalan (soft limit oranHR memang hanya monitoring, tapi commitment-view standar tidak ada).
- Budget **per cost center**: hanya alokasi angka; **used per CC tidak dihitung**; klaim mandiri tanpa cost center tidak teralokasi; Σ item tidak divalidasi ≤ totalBudget.
- **Tidak ada rate per grade/zona/durasi**: tidak ada item budget "hotel per malam × malam" atau "uang harian × hari otomatis dari tanggal trip"; semua nominal klaim manual (qty hanya keterangan) → GAP g-3. Limit jenis diperiksa **per total baris, bukan per unit** (L-POCKET limit 500rb dengan qty 3 hari = 1,2jt → selalu salah flag; L-BBM 125rb × 2 hari) → M-6.
- Over-budget = warning saja (sesuai perilaku oranHR MII: used > budget tetap diproses) — by design, didokumentasikan.

### 4.4 Jurnal & transfer payroll
- Jurnal klaim benar-balanced (D=C, terverifikasi JV-2026-005/006/007/008), idempoten regenerate, dan dihapus saat cancel post-approve. ✓
- Masalah: (1) **Credit selalu Kas 1101** meski settlementMethod="Payroll"/pembayaran via UTRP payroll → beban dobel (jurnal klaim + jurnal payroll run) dan kas tercatat keluar padahal dibayar via payroll (M-7); (2) **advance tidak pernah dijurnal** (tidak ada Debit piutang saat kasbon) → buku kas tidak mencerminkan uang muka; (3) `creditAccount` master jenis biaya tidak pernah dipakai.
- Transfer: guard double-transfer antar-period OK (hanya Approved yang diambil; klaim jadi Transferred sehingga tak bisa ditransfer ulang), **tetapi transfer ke period yang sama dua kali menghapus assignment batch pertama** (K-1). Guard period sudah ber-run-confirmed tidak ada (M-4) — bukti CL-2026-004 Transferred di period 2026-08 yang run-nya sudah lewat → menggantung selamanya (guard run baru per period × processType memblokir duplikat run, payroll-runs.ts:51-56).
- markTravelPaidForRun menandai Paid hanya dari periodCode (M-4) → bila transfer dilakukan setelah run dihitung (calculate) sebelum confirm, atau karyawan sudah non-aktif (buildRunRows hanya proses karyawan aktif), klaim Paid tanpa pernah masuk payslip.

### 4.5 Konsistensi Overview/Reports (live, tenant MII)
| KPI | Nilai API | Verifikasi | Catatan |
|---|---|---|---|
| requestsThisMonth | 7 | semua request (termasuk requestDate 2026-10-05) | label "Bulan Ini" salah — filter `>= awal bulan` mencakup masa depan (m-2) |
| pendingRequest/Claim | 2 / 2 | TR-003,004 / CL-002,003 ✓ | ✓ |
| claimsYtd / amount | 6 / Rp 5.230.000 | Σ totalSettlement SEMUA status (termasuk 2 Submitted & masa depan) | semantik campur vs budgetUsed (m-2) |
| budgetUsed | Rp 3.730.000 | Σ Transferred+Paid ✓ = listBudgets.used ✓ | ✓ konsisten |
| advanceOutstanding | Rp 25.000.000 | hanya TR-005 (Approved, belum klaim) | TR-001 15jt (klaim masih Submitted) & TR-004 5jt (request Submitted) tak terlihat (M-3) |
| transferred/paid | 1 / 3 | CL-004 / CL-001,005,006 ✓ | CL-005 Paid via seed tanpa run asli (artefak demo) |
| reports default (YTD s/d hari ini) | 3 klaim | klaim bertanggal > hari ini terkecualikan | beda populasi dgn claimsYtd=6 → membingungkan (m-2) |

---

## 5. TEMUAN PER SEVERITY

### KRITIS

**K-1 · Transfer payroll kedua ke period sama menghapus komponen klaim sebelumnya → klaim ditandai Paid tanpa dibayar**
- Lokasi: `src/onevity/travel/services/travel-service.ts:739-742` (deleteMany semua assignment Specific UTRP/TRVSTLIN period×processType) vs `:733-737` (klaim yang ditulis ulang hanya status Approved).
- Skenario: transfer batch 1 (klaim A,B) ke period P → A,B Transferred + assignment dibuat. Klaim C disetujui; transfer batch 2 ke period P → deleteMany **menghapus assignment A,B** (mereka kini Transferred, tidak ikut ditulis ulang), hanya assignment C dibuat. Saat run P dikonfirmasi → markTravelPaidForRun menandai A,B,C **Paid** — A,B tidak pernah dibayar. Kebalikan dari idempotensi yang dimaksud; uang hilang diam-diam (tidak ada error).
- Dampak: underpayment karyawan dengan jejak "Dibayar via run X" palsu; rekonsiliasi payroll vs klaim tidak akan balance.
- Saran fix: tulis ulang assignment dari **klaim status ∈ {Approved, Transferred(period ini)}** (bukan hanya Approved), atau hapus deleteMany dan jadikan per-klaim upsert dengan guard klaim belum punya assignment period lain; tambah assertions Σ assignment = Σ klaim period.

**K-2 · Klaim duplikat per request tidak diblokir → double reimbursement**
- Lokasi: `travel-service.ts:440-445` (createClaim tidak menolak request yang sudah pernah diklaim / tidak cek status request), `prisma/schema-tenant.prisma:1294` (`requestId` tanpa @unique/eksklusifitas), `travel-claims.tsx:347-353` (dropdown memuat SEMUA request Approved tanpa menandai yang sudah diklaim).
- Skenario: pilih request yang sudah diklaim → buat klaim kedua dengan rincian sama → approve (jurnal lagi) → transfer (UTRP dibayar lagi). `claimRequestedAt` hanya display, `claimCount` hanya badge.
- Dampak: gaji karyawan overpaid dua kali lipat untuk trip yang sama; GL beban dobel.
- Saran fix: unique index parsial `TravelClaim(requestId) where status not in (Rejected,Cancelled)` atau guard service "request ini sudah memiliki klaim aktif"; tandai/hapus request ter-claim dari dropdown; reset `claimRequestedAt` saat klaim ditolak/dibatalkan.

### MAJOR

**M-1 · Settlement (b)/(c) tidak dihitung server-side dari rincian vs uang muka — kasbon tak tertagih / overpay senyap**
- Lokasi: `travel-service.ts:447-451` (b/c langsung dari body klien), `api/claims.ts:73-76` (passthrough), `travel-claims.tsx:470-484` (b/c input manual; saran hanya placeholder, tidak di-prefill).
- Bukti data: CL-2026-006 (TR-2026-007) b=c=0 — tidak ada pengembalian uang muka, tidak ada reimbursement, klaim tetap diproses sampai Paid.
- Dampak: skenario (a) realisasi < kasbon tidak otomatis menghasilkan c → karyawan menahan selisih kasbon tanpa potongan; (c) realisasi > kasbon bisa di-set b berapa pun. b dan c > 0 bersamaan juga diperbolehkan.
- Saran fix: server menghitung `gross = Σexpenses + a + loss`; validasi `b = max(0, gross − advance)` dan `c = max(0, advance − gross)` (atau minimal warning/approver gate saat menyimpang); simpan `computedB/computedC` untuk audit.

**M-2 · createClaim tidak memvalidasi status request Approved (guard hanya di previewClaim)**
- Lokasi: `travel-service.ts:440-445` vs `:367` (previewClaim melempar error bila status ≠ Approved; createClaim tidak).
- Dampak: POST langsung ke `/api/onevity/travel/claims` dengan `requestId` request Rejected/Cancelled → klaim sah dibuat, bisa diapprove & ditransfer → dibayar untuk perjalanan yang ditolak/dibatalkan. Juga: reject/cancel request setelah klaim Approved/Transferred tidak menghentikan klaim (hanya klaim Submitted yang dibatalkan, `:319-324`).
- Saran fix: pindahkan cek status ke createClaim; saat reject/cancel request, blokir bila ada klaim Approved/Transferred (atau batalkan berantai + hapus jurnal + assignment).

**M-3 · Siklus hidup advance (kasbon) tidak ada — tercatat terbayar sebelum approval, tak pernah lunas**
- Lokasi: `travel-service.ts:220-225` (advance dibuat saat submit, givenAt=now), `:319-333` (reject/cancel tidak membersihkan advance), `travelStats:918-921` (outstanding hanya Approved + claimRequestedAt null), `travel-requests.tsx:400-404` (UI mengklaim "tercatat sebagai pinjaman (TRVLOAN)" — **tidak ada EmployeeLoan/TRVLOAN yang dibuat**; provisioning hanya UTRP/TRVSTLIN).
- Dampak: kasbon pada request yang ditolak tidak terlihat di KPI mana pun; kasbon request yang klaimnya ditolak/dibatalkan juga hilang dari radar (claimRequestedAt tetap terisi); tidak ada status "lunas saat settlement"; tidak ada mekanisme pembayaran advance (payroll/tunai).
- Saran fix: status advance (Requested→Given→Settled) + hanya buat/give saat request Approved; saat klaim Rejected/Cancelled, kembalikan request ke "belum diklaim" (reset claimRequestedAt) agar advance masuk kembali outstanding; implement TRVLOAN atau hapus klaim UI.

**M-4 · Transfer & markPaid tidak memverifikasi period/run masih hidup dan komponen benar masuk payslip**
- Lokasi: `travel-service.ts:723-725` (guard hanya Locked/Closed — period "Processed" dengan run terkonfirmasi lolos; period baru run tak bisa dibuat karena guard run-eksisting `payroll-runs.ts:51-56`), `:793-812` (markTravelPaidForRun menandai Paid hanya dari periodCode, tanpa cek PayrollRunItem berisi UTRP/TRVSTLIN karyawan itu).
- Bukti data: CL-2026-004 Transferred period 2026-08 (run sudah dikonfirmasi sebelumnya) → menggantung Transferred selamanya. Dampak tambahan: transfer setelah calculate-sebelum-confirm, atau karyawan non-aktif (buildRunRows hanya karyawan aktif, `payroll-service.ts:96-133`) → klaim Paid tanpa pernah dibayar.
- Saran fix: blokir transfer ke period yang sudah punya run Confirmed; markTravelPaidForRun hanya menandai klaim yang komponennya benar-benar ada di item run (join PayrollRunItem × wageComponent UTRP/TRVSTLIN).

**M-5 · Validasi tanggal hilang: destinasi vs rentang request, urutan kaki, tanggal baris klaim vs trip, claimDate vs tanggal kembali**
- Lokasi: `travel-service.ts:204-216` (destinasi dibuat tanpa cek dateTo≥dateFrom per kaki, tanpa cek dalam rentang request, tanpa urutan seq tanggal), `:471-484` (expenseDate bebas), `:459` (claimDate bebas di masa lalu/depan).
- Bukti data: CL-2026-002 O-LICENSE 2026-09-10 sebelum berangkat 2026-09-14; CL-2026-006 claimDate = tanggal berangkat.
- Dampak: klaim biaya di luar trip bisa diapprove; periode budget/klaim bisa digeser via claimDate; tidak ada cek "klaim hanya setelah trip selesai" & batas settlementDay (overdue hanya badge).
- Saran fix: validasi rentang per kaki + rentang request + monotonic seq; expenseDate ∈ [dateFrom, dateTo + toleransi]; claimDate ≥ dateTo (warning lewat settlementDue).

**M-6 · Limit jenis biaya diperiksa per TOTAL baris, bukan per unit (hari/malam/km) — semantik limit oranHR hilang**
- Lokasi: `travel-service.ts:435` (`e.amount > t.limitAmount`), `travel-claims.tsx:383` (sama di UI); `qty` tersimpan tetapi tidak dipakai (`:479`).
- Bukti data: L-POCKET limit 500rb, klaim 1,2jt qty 3 hari (400rb/hari) → service akan flag over-limit padahal per hari wajar; L-BBM 125rb qty 2 hari → 250rb kena flag; sebaliknya seed membuat baris over-limit tanpa flag (over=false di DB) → badge "LEBIH LIMIT" tidak muncul di data demo.
- Dampak: guard limit salah arah (false positive per durasi; false negative via seed/manual); approver kehilangan sinyal yang benar.
- Saran fix: definisikan `limitPerUnit` (per baris vs per hari/km) di TravelExpenseType; cek `amount/qty` vs limit untuk jenis duratif; hitung ulang flag overLimit saat listing (jangan percaya flag tersimpan).

**M-7 · Jurnal klaim tidak mencerminkan arus uang sebenarnya (kredit Kas padahal dibayar payroll; advance tak pernah dijurnal)**
- Lokasi: `travel-service.ts:626` (Credit selalu 1101 Kas, `creditAccount` master diabaikan), `:618-623` (a & loss di-Debit & kas dikredit meski (a) "dibayar pihak lain"), tidak ada jurnal advance, sementara b dibayar via UTRP di jurnal payroll run (JV-2026-009).
- Bukti data: CL-2026-001 — jurnal klaim JV-2026-005 kredit Kas 3,9jt DAN UTRP 900rb masuk jurnal gaji run Nov → beban/kas tercatat dobel untuk komponen yang sama.
- Dampak: GL membengkak; rekonsiliasi kas vs payroll gagal; akun `creditAccount` master menyesatkan (field mati).
- Saran fix: bila settlementMethod=Payroll/b>0 → Credit akun kliring payroll (mis. 2102 Utang Gaji), bukan Kas; buat jurnal advance (Debit 1201 Piutang Karyawan / Credit Kas) saat advance diberikan dan penyelesaiannya saat settlement; pakai `creditAccount` jenis biaya.

**M-8 · Jenis biaya L-* (lokal) vs O-* (luar negeri) tidak difilter per destinasi/zona**
- Lokasi: `travel-service.ts:368` (previewClaim mengembalikan SEMUA jenis aktif), `travel-claims.tsx:399-405` (dropdown semua jenis); flag `overseas`/zona hanya data display.
- Dampak: trip dalam negeri bisa memakai O-HOTEL dan trip luar negeri memakai L-HOTEL tanpa warning — salah klasifikasi biaya, salah akun/limit, laporan per jenis menyesatkan (padanan oranHR memisahkan definisi Local vs Overseas).
- Saran fix: filter/flag jenis biaya sesuai kombinasi destinasi (ada kaki overseas → O-*; semua lokal → L-*), atau minimal warning di approve.

### MINOR

**m-1 · Identitas approver tidak direkam & tanpa kontrol akses keputusan** — `decidedById` tidak pernah diisi (`travel-service.ts:326-333`, `:686-694`); PATCH approve/reject/transfer bisa oleh user tenant mana pun (tidak ada cek peran). Dampak: jejak audit keputusan uang kosong. Fix: ambil actor dari session (pola modul medical) + isi decidedById; batasi aksi ke peran HR/approver.

**m-2 · KPI salah semantik** — `travelStats:906/938` "Permintaan Bulan Ini" = semua requestDate ≥ awal bulan (mencakup Okt — data 7 padahal bulan ini 6); `:909-911/943` claimsYtd & "Klaim Tahun Ini" mencakup klaim Submitted/Rejected & bertanggal masa depan (5,23jt vs yang benar-benar dibayar 3,73jt); overview (6 klaim) vs reports default (3 klaim, s/d hari ini) beda populasi. Fix: filter `claimDate ≤ now`, statusAktif, dan bulan berjalan; samakan semantik laporan.

**m-3 · Penomoran dokumen rawan race** — nextDocNo/nextJournalNo max-suffix tanpa transaksi/lock (`travel-service.ts:23-35`, `:578-588`); dua POST bersamaan → docNo sama → unique violation 500. Fix: `SELECT ... FOR UPDATE` atau retry on P2002.

**m-4 · Label form destinasi terbalik** — `travel-requests.tsx:369-374`: dateFrom dilabel "Tgl Datang", dateTo "Tgl Berangkat" (semantik terbalik untuk kaki perjalanan). Fix: tukar label.

**m-5 · Budget per CC tidak dihitung terpakainya & item tak divalidasi** — `listBudgets:829-837` hanya total; `upsertBudget:841-880` tidak cek Σ item ≤ totalBudget; klaim mandiri tanpa CC tak teralokasi. Fix: agregasi used per costCenter dari klaim; validasi Σ item.

**m-6 · Klaim Approved tidak dihitung sebagai komitmen budget** — used hanya Transferred/Paid (`:826-828`); over-budget warning by-design oranHR (didokumentasikan), namun commitment-view standar (klaim Approved pending transfer) tidak ada → HR bisa over-commit tanpa sinyal. Fix: tambah kolom "committed" terpisah dari "used".

### GAP (proses standar perjalanan dinas yang belum ada)

- **g-1 Kwitansi/attachment**: `needDocs` hanya badge — tidak ada upload/penyimpanan dokumen pendukung per baris biaya (oranHR "Need Supporting Documents").
- **g-2 Multi-currency**: field `currency` ada tapi klaim IDR-only; exchangeLoss manual; tidak ada Exchange Transaction/kurs beli-jual (oranHR Currency Rate tab).
- **g-3 Tarif budget per grade/zona/durasi**: tidak ada rate hotel per malam / uang harian per hari yang dihitung otomatis dari tanggal trip, tidak ada nominal per grade (oranHR ExpenseAccount "Based On Region/OrgUnit/Grade") — semua nominal manual.
- **g-4 Approval multi-layer per nominal**: tidak ada Partially Approved / matrix approval berdasarkan nilai advance/klaim (oranHR punya); hanya 1 langkah approve; juga tidak ada "Return To Prepare" (revisi request) dan tidak ada edit request sama sekali.
- **g-5 ESS self-service**: MyTravelRequest / MyTravelClaim / MyTravelRequestToApprove oranHR tidak ada — seluruh aksi lewat UI HR.
- **g-6 TRVLOAN / advance sebagai EmployeeLoan**: potongan bertahap pinjaman uang muka tidak ada — hanya satu-shot TRVSTLIN (di backlog Task 19).
- **g-7 Detail settlement lain**: Cash On Hand, Cash Return, Entertainment Guest sebagai tabel terpisah (guest hanya kolom nama), itinerary/booking transport & tiket, template laporan PDF — disederhanakan/di-backlog.

---

## 6. KESIMPULAN & PRIORITAS TINDAKAN

1. **Segera (KRITIS)**: perbaiki idempotensi transfer (K-1) dan guard klaim duplikat per request (K-2) — keduanya langsung berdampak uang keluar payroll.
2. **Tinggi**: hitung b/c settlement di server dari rincian vs advance + gate approver (M-1); cek status request di createClaim + cancel berantai (M-2); lifecycle advance (M-3); guard period & verifikasi payslip di markPaid (M-4).
3. **Menengah**: validasi tanggal (M-5), limit per unit (M-6), akun jurnal per metode settlement + jurnal advance (M-7), filter L-*/O-* (M-8).
4. **Backlog produk**: attachment kwitansi, multi-currency, tarif per grade/durasi, approval matrix nominal, ESS, TRVLOAN.

Positif yang layak dipertahankan: formula (a)+(b)−(c) persis oranHR; jurnal per baris biaya balanced & idempoten-regenerate; transfer antar-period tidak bisa dobel; budget soft-limit sesuai perilaku nyata MII; KPI budgetUsed terverifikasi konsisten dengan data (3,73jt).
