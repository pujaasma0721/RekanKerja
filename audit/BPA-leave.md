# BPA — AUDIT BISNIS PROSES MODUL LEAVE (CUTI) — OneVity HRIS

**Task ID:** 24-d · **Mode:** READ-ONLY (kode + probe GET runtime; 0 mutasi) · **Tanggal audit:** 2 Sep 2026 (jam server sandbox)
**Cakupan:** `src/onevity/leave/**` (8 API + leave-service.ts + leave-seed.ts + 9 komponen), `prisma/schema-tenant.prisma` (5 model Leave), integrasi `attendance-service.ts` (leaveFor/regenerateDaily/recapPeriod), `provisioning.ts` (LEAVE_TYPE_DEFS), payroll (`transferEncashment`, `markEncashmentPaidForRun`), referensi `ANALISA-LEAVE.md` (oranHR 14 halaman), worklog Task 18/22/23.
**Data MII live (probe):** 546 saldo (42 kar. × 12 jenis 2026 + 42 baris CT-THN 2025), 86 request (3 Submitted / 39 Approved / 1 Rejected / 1 Cancelled / 42 MassLeave), 5 encashment (2 Paid, 2 Approved, 1 Rejected), 1 event massal SKB (42 baris). Endpoint: 8/8 GET → 200.

---

## 1. RINGKASAN EKSEKUTIF

Modul Leave mengimplementasikan formula saldo oranHR **(a)+(b)+(c)−(d)+(e)+(f)+(g)** secara setia: saldo TIDAK disimpan sebagai kolom taken statis melainkan **dihitung dinamis dari request** (`computeParts`) — desain ini menghilangkan risiko pemotongan ganda klasik (double-deduct) pada approve/cancel, dan terbukti konsisten numerik di data live (546 baris; agregat taken 106,5 = 100 (permintaan 2025) + 6,5 (2026 lampau); laporan per jenis 50,5 hari CT-THN cocok dengan penjumlahan request; saldo MII00001 = 6+9+0−(0+2+0+3) = 10 ✓). Prorata bulanan "earned by end of month", carry-over max 6 hari + hangus 31-12, half-day 0,5 via sesi AM/PM, hari kerja dihitung dari jadwal modul TA, cuti massal SKB, encashment → UCT → payroll → Paid saat run dikonfirmasi: **semua rantai end-to-end berjalan dan terverifikasi live**.

Namun ditemukan **2 temuan KRITIS** yang keduanya berakar pada satu kelemahan desain: **saldo permintaan yang masih pending tidak direservasi dan tidak dire-validasi pada saat approval** — sehingga kombinasi 2+ permintaan/encashment paralel yang masing-masing lolos cek saldo saat submit dapat menghasilkan **saldo negatif pada jenis cuti yang tidak mengizinkan advance** dan **cashed melebihi entitlement**. Ditambah **guard tanggal** (backdate & validitas periode) yang tidak ada → **saldo periode kedaluwarsa (mis. 2025) tetap bisa dipakai/diuangkan** (vektor double-dip uang karena 6 hari dari saldo itu sudah terbawa ke 2026). Regenerasi absensi saat reject/cancel/mass leave juga **menulis baris "Absent" untuk tanggal masa depan** (tanpa clock log) yang bisa memotong upah lewat rekap absensi. Approval tidak mencatat identitas approver (`decidedById` selalu null) dan tidak ada otorisasi peran/layer atasan.

Total: **2 KRITIS · 4 MAJOR · 9 MINOR · 10 GAP** (beberapa GAP sudah dicatat backlog Task 18 — di sini diinventarisasi ulang sebagai kontrak proses).

---

## 2. PETA PROSES AS-IS (entitlement → saldo → request → approval → potong saldo → presensi → encashment → payroll)

```
[MASTER] LeaveType (12 jenis seed PP 35/2021 + UU 13/2003; provisioning.ts:416-434)
   entitlement 12 (CT-THN, prorata bulanan, carry max 6, waiting 6 bln, advance ✓, cashable ✓)
   CT-ANNIV/CT-BESAR mode ANNIVERSARY; event-based (nikah 3, kematian 2/1, haji 40, haid 2, dst)
        │
        ▼
[SALDO] LeaveBalance per (karyawan × jenis × tahun) @@unique
   (a) carriedOver, (c) adjustment, (e) cashed — kolom simpan
   (b) earned = entitlement × bulanBerlalu/12 (prorata) ATAU entitlement penuh — DINAMIS
   (d) forfeited = carriedOver bila asOf > 31-12 tahun periode — DINAMIS
   (f) taken / (g) applied = Σ workingDays request Approved/MassLeave (dipisah dateTo < asOf) — DINAMIS
   remaining = (a+b+c) − (d+e+f+g)          [leave-service.ts:114-139 computeParts]
   Generate: manual per tahun (balances POST → generateLeaveInfo, carry = min(remaining tahun lalu
   per 31-12, carryOverMax)); auto-create baris saat request/preview/encashment (ensureBalance:206-219)
   Adjustment: PATCH balances (±delta + alasan, langsung tanpa approval)
        │
        ▼
[REQUEST] submitRequest (requests POST; preview=1 hitung saja)
   validasi: karyawan aktif · jenis aktif · waitingMonths (masa kerja) · half-day flag ·
   maxPerRequest · OVERLAP vs Submitted/Approved/MassLeave · saldo (minus hanya bila allowAdvance)
   workingDays & HP-kerja-dihitung dari jadwal TA (isWorkday→resolveDayType; skip Off+Holiday;
   sesi PM/AM −0,5) — status Submitted; snapshot balanceAtRequest/remainingAtRequest/backToWork
        │
        ▼
[APPROVAL] decideRequest (requests PATCH: approve|reject|cancel) — HANYA dari status Submitted
   efek: status → Approved/Rejected/Cancelled + regenerateDaily per tanggal rentang (per karyawan)
   → attendance status "OnLeave" (menang atas clock-log; paid→normalMinutes penuh / half ½;
   unpaid→absenceMinutes) — pemotongan saldo IMPLISIT (f/g bertambah karena status Approved)
        │
        ▼
[PRESENSI] recapPeriod (TA): OnLeave → leavePaidDays/leaveUnpaidDays (notes match "tidak dibayar");
   unpaid ikut potongan TABS perDay = gaji/25; kehadiran sempurna memperhitungkan cuti dibayar
        │
        ▼
[MASS LEAVE] createMassLeave (mass POST): per karyawan aktif (+filter org prefix) — skip bentrok
   & saldo minus; baris LeaveRequest status "MassLeave" (efektif langsung, tanpa approval);
   regenerateDaily SEMUA karyawan per tanggal rentang; header MassLeave menyimpan statistik
        │
        ▼
[ENCASHMENT] submitEncashment (encashment POST): cek cashable + days ≤ remaining (live);
   amount = days × gpokok/25 (snapshot) → decideEncashment approve → kolom (e) cashed += days
        │
        ▼
[PAYROLL] transferEncashment (transfer POST): Approved+Transferred (paymentDate dalam period,
   fallback requestDate) → EmployeeComponentAssignment Specific UCT (amount dihitung ulang dari
   gaji aktif); idempoten delete-rewrite per (period × processType × UCT) → status Transferred
   → confirmRun payroll → markEncashmentPaidForRun → Paid + transferredRunNo
```

**Karakteristik penting as-is:**
1. Saldo tidak pernah "dipotong" secara fisik saat approve — `taken/applied` turunan query. Sisi positif: bebas double-deduct. Sisi negatif: kebenaran saldo bergantung sepenuhnya pada guard submit & approve (lihat §5 L-01/L-02).
2. Request tahun ditentukan dari tanggal MULAI (`yearForDate`, anniversary-aware) — request lintas periode (30 Des → 5 Jan) seluruhnya dibebankan ke periode tanggal mulai.
3. MassLeave & encashment approve adalah dua-satu langkah (tanpa antrean approval atasan).

---

## 3. STATE MACHINE

### 3.1 LeaveRequest (status kolom `status`)

| From → To | Trigger (file:line) | Guard | Efek samping |
|---|---|---|---|
| — → **Submitted** | `submitRequest` leave-service.ts:479-552 (requests POST) | reason ≠ ∅ · karyawan Active · jenis aktif · waitingMonths · allowHalfDay · workingDays>0 · ≤ maxPerRequest · overlap vs Submitted/Approved/MassLeave (509-517) · saldo ≥ 0 kecuali allowAdvance (525-527) | create row + snapshot saldo + ActivityLog; **saldo belum berubah** (pending tidak dihitung) |
| Submitted → **Approved** | `decideRequest` :600-637 (requests PATCH action=approve) | **hanya** status=Submitted (606) — *tidak re-check saldo/overlap/waiting* | saldo berkurang (f/g dinamis); `regenerateDaily` rentang → OnLeave di TA (623-627); ActivityLog; decidedById = null (613, actorId tak dikirim route) |
| Submitted → **Rejected** | `decideRequest` (action=reject) | status=Submitted | saldo kembali (otomatis, pending tak dihitung); **regenerateDaily rentang tetap dijalankan** → tanggal masa depan tertulis "Absent" bila tanpa clock log (L-04) |
| Submitted → **Cancelled** | `decideRequest` (action=cancel) / UI permintaan (leave-requests.tsx:96) | status=Submitted | sama seperti Rejected |
| — → **MassLeave** | `createMassLeave` :663-776 (mass POST) | per karyawan: bentrok skip (716-722), saldo minus skip (730) — *tanpa approval, tanpa waitingMonths* | saldo terpotong langsung; OnLeave semua tanggal; regenerateDaily **seluruh karyawan** (765-767); header MassLeave |
| Approved/MassLeave → (apapun) | **TIDAK ADA** — :606 menolak | — | permintaan efektif tidak bisa dibatalkan/di-undo (GAP G-03) |

### 3.2 LeaveEncashment

| From → To | Trigger | Guard | Efek samping |
|---|---|---|---|
| — → Submitted | `submitEncashment` :794-826 (encashment POST) | jenis cashable · days>0 · days ≤ remaining live (804) | amount snapshot = days×gaji/25; **saldo belum berkurang** |
| Submitted → Approved | `decideEncashment` :828-864 (PATCH approve) | hanya status Submitted (834) — *tanpa re-check remaining* | **cashed += days (852)** → saldo berkurang; decidedById null |
| Submitted → Rejected/Cancelled | `decideEncashment` | status Submitted | tanpa efek saldo |
| Approved → **Transferred** | `transferEncashment` :906-969 (transfer POST) | period bukan Locked/Closed (912-914) · paymentDate (fallback requestDate) dalam period | delete-rewrite assignment UCT per period+processType (idempoten) · amount **dihitung ulang dari gaji aktif** (943-944) · periodCode di-set |
| Transferred → **Paid** | `markEncashmentPaidForRun` :972-997 ← `confirmRun` payroll | run SALARY · window paymentDate/requestDate dalam period run | transferredRunNo di-set; guard dobel: hanya status Transferred |

---

## 4. AUDIT KALKULASI SALDO — AS-IMPLEMENTED vs SEHARUSNYA

### 4.1 Formula as-implemented (`computeParts` :114-139)

```
earned     = prorateMonthly ? entitlement × earnedMonths(max(validFrom, join), asOf) / 12 : entitlement
             earnedMonths = selisih bulan + 1 (bulan berjalan dihitung PENUH — "by end of month"), clamp 0..12
forfeited  = carriedOver bila asOf > 31-12 tahun periode (hardcoded 31-12, padanan forfeiture oranHR)
taken      = Σ workingDays request (Approved|MassLeave, emp×jenis×tahun) dengan dateTo < asOf
applied    = Σ workingDays request (Approved|MassLeave) dengan dateTo ≥ asOf
remaining  = carriedOver + earned + adjustment − forfeited − cashed − taken − applied
```

### 4.2 Verifikasi numerik (data live MII, asOf = 2 Sep 2026)

| Uji | Hasil | Keterangan |
|---|---|---|
| MII00001 CT-THN 2026 | 6+9+0−(0+2+0+3) = **10** ✓ | 6 carry dari 2025 · earned 9 = 12×9/12 (Jan–Sep) · cashed 2 (LE-2026-005) · applied 3 (LR-2026-010 7–8 Sep + massal 17 Sep) |
| MII00003 2025 | 0+12−5 = 7 ✓ | permintaan seed 2025 dihitung sebagai taken |
| Σ taken semua saldo = 106,5 | = 100 (2025) + 6,5 (2026 lampau: 3+0,5+3) ✓ | konsisten agregat API balances vs requests |
| Laporan per jenis CT-THN 2026 = 50,5 | = 3+0,5+3+2(E2E)+42×1 massal ✓ | konsisten reports vs requests |
| Cuti massal 17 Sep | 42 baris MassLeave, absensi 42×OnLeave, workingDays 1/kar. ✓ | saldo skip-guard bekerja (tidak ada yang minus) |
| Half-day | LR-2026-006 = 0,5 hari (sesi PM→PM) ✓ | guard allowHalfDay aktif |
| Hari kerja | rentang 10–12 Agu = 3 hari (Sabtu/Minggu dikecualikan) ✓ | resolveDayType TA |
| KPI overview | avgAnnualRemaining 13,49 · approvedThisYear 47 (=5 approved + 42 massal) ✓ | konsisten |

### 4.3 Perbandingan dengan UU 13/2003 / PP 35/2021 / oranHR

| Aspek | OneVity as-implemented | Seharusnya / referensi | Penilaian |
|---|---|---|---|
| Hak tahunan | 12 hari, prorata bulanan, waiting 6 bulan (oranHR MII) | UU 13/2003 §79: **12 hari kerja setelah 12 bulan kerja berlanjut**; oranHR MII memakai waiting 6 bln + prorate | ⚠️ Mengikuti oranHR; deviasi vs UU (waiting 6 ≠ 12 bln, prorata memungkinkan ambil < 12 bln) — tercatat sadar di ANALISA §5-L2 |
| Hak per masa kerja | seragam per jenis; hanya adjustment manual (±) | oranHR 15 dimensi rule (service year dsb.) | GAP G-02 (backlog Task 18) |
| Cuti Besar | 12 hari, waiting **72 bulan** | oranHR MII 12 hari >5 th (**60 bln**); konvensi umum 3 bulan | ⚠️ MINOR + GAP G-02 |
| Jenis non-saldo | SEMUA jenis punya saldo (termasuk nikah/duka/haji) — saldo "seragam" | oranHR juga row per jenis; konsep "unpaid/event leave tanpa saldo" tidak dimodelkan | Desain mengikuti oranHR; catatan: duka/nikah tidak diprorata ✓, event-based full entitlement ✓ |
| Melahirkan/keguguran (perempuan) | **TIDAK ADA jenisnya** | UU 13/2003 §82: 1,5 bln sebelum + 1,5 sesudah; oranHR: Melahirkan 3 bulan (unit MONTH) | **GAP G-01** — jenis cuti Indonesia paling fundamental hilkap |
| Satuan bulan | kolom `unit` MONTH ada tapi perhitungan selalu HARI | oranHR: satuan campur hari/bulan | MINOR L-16 (latent) |
| Carry-over | max **6** hari, hangus 31-12 periode berikut | oranHR MII: max 32, forfeiture 31-12, carry period 1 th | ✓ mekanisme ada (angka lebih ketat — pilihan konfigurasi) |
| Half-day 0,5 | ✓ AM/PM sesi | oranHR + max 4 jam | ✓ (GAP "max hour" G-08) |
| Prorata karyawan baru | ✓ earnedMonths dari join | oranHR "Prorate by month" + *incomplete month rule* | ✓ (bulan parsial dihitung penuh — MINOR) |
| Black-out date | tidak ada | standar proses umum | GAP G-05 |
| Upah encashment | gpokok/**25** | ANALISA L4 menetapkan /25 | ✓ konsisten submit & transfer |

---

## 5. TEMUAN PER SEVERITY

### KRITIS (saldo salah terpotong / double / negatif)

**L-01 · Approval permintaan cuti tidak re-validasi saldo — pending tidak direservasi → saldo negatif pada jenis non-advance.**
- Lokasi: `src/onevity/leave/services/leave-service.ts:600-637` (decideRequest — hanya cek status :606); akar: `listBalances:169-172` + `computeParts` hanya menghitung status `Approved|MassLeave` (Submitted tidak masuk kolom g) sehingga cek saldo saat submit (`:522-527`) selalu melihat saldo penuh.
- Skenario terbukti dari kode: saldo CT-NIKAH 3 hari → submit permintaan A (3 hari) ✓, submit B (3 hari, non-overlap) ✓ (B masih melihat 3 karena A pending) → approve A → 0 → approve B → **remaining −3 pada jenis `allowAdvance=false`** — guard "Saldo tidak cukup" terlewati. Ditambah UI approval menampilkan snapshot `remainingAtRequest` (leave-approval.tsx:152), approver tidak melihat saldo terkini. Operasi juga non-transaksional (findFirst → create tanpa `$transaction`/unique constraint rentang) → race dua submit bersamaan.
- Dampak: saldo negatif tanpa kebijakan; pemakaian melebihi entitlement; laporan saldo & overview (negative count) tercemar.
- Saran fix: (1) hitung `applied` termasuk status `Submitted` (padanan "Leave Applied not Taken" yang mencakup pending) ATAU reservasi eksplisit; (2) re-validasi saldo (+ overlap + waiting) di `decideRequest` dalam `$transaction` sebelum set Approved — tolak bila remaining < 0 dan !allowAdvance; (3) tampilkan saldo live di kartu approval.

**L-02 · Approval encashment menambah `cashed` tanpa re-check remaining → cashed melebihi entitlement / saldo negatif & uang kelebihan.**
- Lokasi: `src/onevity/leave/services/leave-service.ts:844-855` (decideEncashment approve → `cashed += enc.days` tanpa validasi); pintu masuk: `submitEncashment:802-806` cek `days > row.remaining` memakai saldo live yang belum dikurangi encashment Submitted lain.
- Skenario: saldo 10 → ajukan encashment 8 hari ✓ dan permintaan cuti 5 hari (non-overlap) ✓ (cuti melihat 10, pending tidak dihitung) → approve keduanya → cashed 8 + taken/applied 5 → **remaining −3**. Atau dua encashment paralel (8+8 terhadap saldo 10) → cashed 16. UCT dibayar sesuai hari yang di-cash → **kelebihan bayar finansial**.
- Saran fix: reservasi hari encashment saat Submitted (kolom turunan pending-cash) + re-validasi `cashed + days ≤ entitlement-terpakai` transaksional saat approve; tolak approve bila saldo kini tidak cukup.

### MAJOR (guard hilang)

**L-03 · Tidak ada guard backdate & validitas periode — saldo periode kedaluwarsa tetap terpakai/teruangkan (double-dip uang).**
- Lokasi: `submitRequest:486-527` (tidak ada cek `dateFrom ≥ hari ini` maupun tanggal dalam jendela periode `validFrom/validTo`); `submitEncashment:794-826` (parameter `year` bebas — periode lampau diterima); `computeParts:127-129` (hangus hanya memakan `carriedOver`, bukan sisa saldo periode).
- Skenario nyata di data live: saldo 2025 MII00002 saat ini remaining 9 (12−3). 6 hari dari saldo itu **sudah terbawa ke 2026** (carry=6) dan dapat dipakai lagi di 2026. Mengajukan encashment `year=2025, days=9` **lolos** (9 ≤ 9) → approve → cashed 9 → transfer → dibayar — padahal 6 di antaranya juga eksis sebagai saldo 2026 → **dibayar dua kali**. Jalur request sama: backdate permintaan ke Des 2025 memakai saldo yang sudah ter-carry.
- Dampak: pembayaran ganda UCT, saldo historis dipakai ulang, absensi masa lalu tertimpa OnLeave (L-09).
- Saran fix: validasi `dateFrom` dalam `[max(hari ini−grace, validFrom periode), validTo periode]`; tolak encashment untuk periode yang `asOf > validTo` (atau whose forfeit date lewat); sinkronkan hangus ke seluruh sisa (bukan hanya carry) pada periode tertutup.

**L-04 · Regenerasi absensi menulis data MASA DEPAN salah ("Absent") — dipicu reject/cancel & cuti massal.**
- Lokasi: `decideRequest:623-627` (regen dijalankan untuk SEMUA action, termasuk reject/cancel) dan `createMassLeave:763-767` (`regenerateDaily(db, d)` **tanpa employeeId** → seluruh karyawan per tanggal); mekanisme tulis: `attendance-service.ts:349-356` — karyawan clocking tanpa clock log → status **"Absent"**, `absenceMinutes = target`.
- Skenario: reject permintaan cuti bertanggal 15–16 Des (masa depan) → 2 baris Absent fiktif dibuat; membuat cuti massal rentang 3 hari → karyawan yang di-skip (bentrok/saldo) mendapat baris Absent fiktif untuk 3 hari masa depan. `recapPeriod:504,525` menjumlahkan Absent → potongan TABS `gaji/25 × hari` di Transfer to Payroll bila rekap dijalankan sebelum tanggal terlewati & sebelum refresh clocking.
- Saran fix: dalam `regenerateDaily`, bila `date > hari ini` dan tidak ada clock log → jangan tulis "Absent" (biarkan null/tanpa baris); di `decideRequest`, hanya regen bila action=approve (reject/cancel cukup menghapus efek dengan regen yang sama aman); mass leave: regen hanya karyawan target.

**L-05 · Identitas & otoritas approver tidak dicatat — `decidedById` selalu NULL, tanpa layer/otorisasi atasan.**
- Lokasi: `src/onevity/leave/api/requests.ts:71-75` dan `api/encashment.ts:60-64` (PATCH tidak membaca session → `actorId` tak pernah dikirim; `leave-service.ts:613,840` default null). Bandingkan: modul Medical sudah benar (`medical/api/claims.ts:57-58` membaca `readSessionCookie`). Tidak ada integrasi dengan infrastruktur `approval-templates`/`temporary-approvers` platform — approve bisa dilakukan anggota tenant mana pun tanpa cek peran.
- Dampak: jejak audit keputusan kosong (masalah kepatuhan/forensik HR); risiko penyalahgunaan akses.
- Saran fix: ekstrak `actor?.uid` dari session cookie di kedua PATCH (pola medical) + validasi peran (OWNER/ADMIN HR) sebelum decide; jangka panjang: sambungkan ke approval template layer.

**L-06 · Saldo request lintas-periode & snapshot encashment tak sinkron — request 30 Des→5 Jan seluruhnya dibebankan ke periode tanggal mulai.**
- Lokasi: `submitRequest:520` (`year = yearForDate(type, emp, from)` — hanya tanggal mulai); `workingDays` utuh dari rentang; tidak ada split periode. oranHR memecah permintaan lintas periode/atribut "Entitled in Next Period".
- Dampak: saldo periode lalu terpotong untuk hari yang jatuh di periode baru (atau sebaliknya belum-tahun-baru terpotong dari periode baru); saldo tahun berikutnya tidak akurat untuk tahun bergantian.
- Saran fix: pecah perhitungan per periode (dua segmen request) atau validasi rentang tidak boleh melintasi batas periode.

### MINOR

| ID | Temuan | Lokasi | Dampak / saran |
|---|---|---|---|
| L-07 | Transfer menghitung ulang amount dari gaji **aktif** saat transfer tanpa memperbarui `enc.amount` | leave-service.ts:943-944 vs :808 | payslip ≠ record encashment bila gaji berubah submit→transfer; fix: pakai `enc.amount` snapshot atau update snapshot |
| L-08 | Guard transfer hanya Locked/Closed — period "Processed" dengan run terkonfirmasi masih menerima transfer; run lama tak otomatis memuat assignment baru; transfer ulang ke period lain meninggalkan assignment lama (delete per period+processType) | :912-914, 936-938 | encashment nyangkut Transferred-tak-Paid; risiko dobel bayar bila run dihitung ulang; fix: blokir period dengan run Confirmed/Processed, atau recalc otomatis |
| L-09 | Approve permintaan bertanggal lampau menimpa presensi aktual — cabang OnLeave mendahului cabang clock-log | attendance-service.ts:314-325 | karyawan yang tetap masuk (clock-in ada) tercatat OnLeave; fix: prioritas clock log vs OnLeave atau flag manual |
| L-10 | Hari libur nasional (day type kategori "Holiday") dalam rentang cuti ditandai OnLeave, padahal `workingDays` cuti mengecualikannya | attendance-service.ts:291 (`isOffDay` hanya "Off") vs leave-service.ts:70-75 | rekap `leavePaidDays` > hari cuti terpotong; fix: samakan definisi (Holiday ikut di-skip di TA) |
| L-11 | Seed snapshot salah: permintaan non-CT-THN menyimpan `balanceAtRequest=0` (fallback `?? 0`) | leave-seed.ts:79-90 | kolom "Sisa Saldo" di UI approval/daftar menampilkan 0 untuk permintaan seed (mis. LR-2026-007 CT-MATI-I padahal saldo 2); fix seed: hitung dari listBalances |
| L-12 | Entitlement master dipakai untuk periode lalu (tanpa snapshot per baris saldo) | computeParts memakai `type.entitlement` saat ini | mengubah hak jenis cuti mengubah saldo historis; fix: snapshot entitlement di LeaveBalance saat generate |
| L-13 | KPI/statistik tidak konsisten: `massLeaves` menghitung baris (42) bukan event (1); `typeUsageSummary`/`leaveStats` tidak memfilter karyawan Active sedangkan `listBalances` ya (:182) | leave-service.ts:1061, 1024-1051 vs 182 | angka laporan ≠ angka saldo view; KPI menyesatkan; fix: satukan filter + hitung event distinct docNo prefix |
| L-14 | Performa O(N×M): mass leave & preview memanggil `listBalances` (full-scan semua request+saldo) per karyawan; `calculateRequestDays` N+1 query per tanggal | :727-728, 663-698 | lambat pada data besar; fix: agregasi sekali + cache resolveDayType per cycle |
| L-15 | Campuran kecil: dead variable `year` (joinDate palsu) di createMassLeave (:700); `submitEncashment` tidak cek karyawan Active (resign → `activeSalary`=0 → amount 0); filter org massal pakai prefix nama string (:677-681 — "Produksi" cocok semua org berawalan sama, bukan hierarki) | :700, :794-826, :677-681 | perilaku mengejutkan/ambigu; fix sesuai masing-masing |
| L-16 | `unit=MONTH` didukung skema/UI tapi perhitungan selalu hari (maxPerRequest & saldo mencampur hari vs bulan) | types.ts:39/75; leave-service.ts:349-385 | admin yang membuat jenis bulanan akan mendapat guard salah; fix: konversi hari↔bulan atau tolak unit MONTH pada submit |
| L-17 | Absensi karyawan resign tidak diregenerasi (regenerateDaily hanya Active) sementara saldo request resign tetap dihitung | attendance-service.ts:253-255 | korelasi cuti-presensi putus untuk ex-karyawan; catatan desain |

### GAP (proses standar cuti Indonesia belum ada)

| ID | Gap | Referensi | Status di worklog |
|---|---|---|---|
| G-01 | **Cuti melahirkan (1,5+1,5 bulan, UU §82) & keguguran (perempuan)** tidak ada di seed 12 jenis — satuan MONTH disiapkan tapi tak terpakai | oranHR 20 jenis MII (Melahirkan 3 bulan); UU 13/2003 | TIDAK pernah dicatat — temuan baru |
| G-02 | Entitlement diferensiasi masa kerja (12/14 hari, cuti besar ≥5 th & konvensi 3 bulan; 15 dimensi oranHR) tidak ada — hanya adjustment manual; waiting CT-BESAR 72 bln ≠ 5 th | UU/PP + oranHR | Backlog Task 18 (parsial) |
| G-03 | **Cancel/undo permintaan Approved & pembatalan baris MassLeave tidak ada** (oranHR Cancel berlaku juga untuk approved) | oranHR Operation | Baru |
| G-04 | `needDocs` hanya info form — **tidak ada lampiran file & enforcement dokumen** | oranHR File Name + Need Supporting Documents | Backlog Task 18 |
| G-05 | Black-out date / minimum notice pengajuan tidak ada | praktik umum | Baru |
| G-06 | Partially Approved per hari tidak ada (approve all-or-nothing) | oranHR status | Backlog Task 18 |
| G-07 | ESS self-service & approval atasan (MyLeaveRequestToApprove) tidak ada | oranHR ESS | Backlog Task 18 |
| G-08 | Max Hour for Half Day (4 jam) tidak dimodelkan (half-day hanya sesi AM/PM) | oranHR atribut | Baru |
| G-09 | Penyesuaian massal per jenis+org (GenerateLeaveAdjustmentProcess) & Initial Leave Information (carry awal implementasi) hanya per-karyawan dialog | oranHR Process | Baru (parsial backlog) |
| G-10 | Kalender cuti bersama pemerintah otomatis (SKB) tidak ada — mass leave manual | SKB 3 Menteri | Backlog Task 18 |

**Catatan GAP yang SUDAH tercakup (tidak menjadi gap):** carry-over expired ✓ (hangus 31-12, live data konsisten), half-day 0,5 ✓, prorata karyawan baru ✓, upah /25 ✓, cuti bersama SKB manual ✓, validasi hari-kerja-only ✓.

---

## 6. KESIMPULAN & REKOMENDASI PRIORITAS

1. **Segera (KRITIS):** reservasi saldo pending + re-validasi transaksional di `decideRequest`/`decideEncashment` (L-01, L-02) — satu perubahan desain menutup kedua vektor.
2. **Segera (MAJOR):** guard backdate & validitas periode + larangan encashment periode kedaluwarsa (L-03) — menutup vektor double-dip UCT.
3. **Segera (MAJOR):** `regenerateDaily` berhenti menulis "Absent" untuk tanggal masa depan; regen mass leave dibatasi karyawan target (L-04).
4. **Kuatkan kepatuhan (MAJOR):** actorId dari session di PATCH requests/encashment + cek peran (L-05) — pola tinggal salin dari modul Medical.
5. **Lanjutan:** split request lintas periode (L-06), sinkron amount transfer (L-07), seed jenis maternitas (G-01), kemampuan cancel approved (G-03).

*Probe runtime: hanya GET (login hrN → select-tenant MII → 8 endpoint leave + 3 endpoint TA/payroll pendukung). Tidak ada POST/PUT/PATCH/DELETE, tidak ada perubahan kode, tidak ada commit.*
