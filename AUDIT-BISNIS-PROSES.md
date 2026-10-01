# AUDIT BISNIS PROSES PER MODULE — RekanKerja HRIS

Tanggal: 22 Januari 2026 (sesi lanjutan Task 24, pasca audit struktur Task 23 / commit `ec82d9f`)
Lingkup: **proses bisnis** 6 modul domain + mesin lintas-modul (approval, transfer payroll, jurnal) — bukan gaya kode (sudah dicakup AUDIT-MODULES.md).
Metode: 7 auditor paralel (1 per modul + 1 lintas-modul) — rekonstruksi proses as-is dari source `src/rekankerja/**` + schema Prisma, verifikasi runtime read-only (GET API + SQL) atas data demo MII, pembandingan referensi oranHR (`ANALISA-*.md`, `PRD-HR-BASE.md`).
Laporan detail per modul: `audit/BPA-<modul>.md`.

---

## Ringkasan Eksekutif

| Modul | KRITIS | MAJOR | MINOR | GAP | Laporan detail |
|---|---|---|---|---|---|
| HumanResource | 3 | 6 | 9 | 8 | `audit/BPA-human-resource.md` |
| Payroll | 2 | 11 | 11 | 12 | `audit/BPA-payroll.md` |
| TimeAttendance | 3 | 6 | 9 | 8 | `audit/BPA-time-attendance.md` |
| Leave | 2 | 4 | 9 | 10 | `audit/BPA-leave.md` |
| Travel | 2 | 8 | 6 | 7 | `audit/BPA-travel.md` |
| Medical | 4 | 7 | 9 | 10 | `audit/BPA-medical.md` |
| Lintas-modul (approval/integrasi/jurnal) | 3 | 8 | 6 | 6 | `audit/BPA-cross-module.md` |
| **Total (sebelum dedup)** | **19** | **50** | **59** | **61** | |

### Tema kerentanan lintas modul (dedup temuan)

1. **Identitas & otorisasi aktor approval dekoratif** (C-01 = HR-K03; C-02; Leave-L05; Travel-M6 minor)
   Aktor keputusan hard-coded `"MII000001"` (PA), `decidedById` kosong di leave/travel, tanpa pemeriksaan role di SEMUA endpoint keputusan/transfer/confirm — user role VIEWER sekalipun dapat menyetujui klaim, mentransfer ke payroll, dan mengkonfirmasi run.
2. **Integritas uang antar modul** (TA-K1/K3, Travel-K1, Medical-K2/M3, Payroll-K2, C-04)
   Lembur Paid ikut rekap berikutnya (double-pay); penandaan `markXPaid` tidak selaras jendela transfer (lembur/medical "Paid" tanpa dibayar / hilang); transfer travel ke-2 menghapus assignment pertama; jurnal klaim travel ter-posting dobel (beban+kas lalu UTRP payroll); cancel run Confirmed diterima tanpa pembalikan jurnal.
3. **Validasi saldo saat approval** (Leave-L01/L02, Medical-K1/K2/K3)
   Saldo cuti tidak di-revalidasi saat approve (pending tidak direservasi → saldo negatif); encashment tanpa re-check remaining (overpay); klaim medical melebihi sisa plafon lolos; klaim dependent SHARED tidak memotong plafon bersama (saldo negatif live); generate saldo tahun depan mewarisi `used` (auto-carry salah formula).
4. **Kontrak data PA rusak** (HR-K01)
   Dialog PA menyimpan KODE posisi/unit/grade, handler process membaca ID → promosi/mutasi/demosi tidak pernah benar-benar memindahkan karyawan (terverifikasi live PA-2026-0004 Processed tanpa efek penempatan).
5. **Non-transaksionalitas efek proses** (HR-K02, Payroll-M confirmRun, Medical settle)
   Efek samping multi-tabel (tutup assignment + buka baru + status PA) ditulis lewat query terpisah tanpa `db.$transaction` → partial-write = korupsi riwayat.
6. **PPh 21 run ireguler ≈ nol** (Payroll-K1)
   `regularIncome` run THR/BONUS/RAPEL = 0 → pajak THR dihitung dari THR − PTKP saja → under-withholding sistemik.

### Yang sudah sehat (patut dipertahankan)
- Isolasi tenant 73/73 handler (audit lintas-modul); snapshot histori payroll aman dari mutasi master.
- Formula oranHR yang setia & terverifikasi numerik: saldo cuti a–g (prorata bulanan, carry hangus 31-12, half-day), settlement travel (a)(b)(c), plafon medical faktor gaji, upah lembur 1/173 weekday/weekend PP 35/2021, jurnal run payroll balanced D=C.
- Rotasi 3 regu + shift malam 22:00–06:00 lintas hari, integrasi mass leave → presensi (42 karyawan), idempotensi delete-rewrite transfer leave, N2G gross-up konvergen.

---

## Keputusan Triase Task 24

**Diperbaiki sekarang (KRITIS + MAJOR terseleksi — integritas proses/uang):**
1. Fondasi bersama (orchestrator): `requireMutator` (identitas aktor sesi + tolak VIEWER) di `shared/lib/tenant-db.ts`; generator nomor jurnal tunggal max-parse `shared/lib/journal-no.ts` (ganti 3 generator bentrok); sinkronisasi email AppUser MII000001 ↔ login demo.
2. Per modul (agen perbaikan):
   - **HR**: K-01 kontrak ID PA + deteksi no-op; K-02 `$transaction` efek PA; K-03 aktor sesi + larangan self-approve non-HR; M-01/02/06 guard approve (race, terminasi lastDay, validasi tanggal/gaji/status).
   - **Payroll**: K-02 tolak cancel run Confirmed; K-01 PPh21 ireguler pakai regular income YTD; M-01/02/03/06/08 (BPJS non-objek pajak, overlap periode, rapel dedupe, close periode, assignment ke run Confirmed).
   - **TimeAttendance**: K-1 filter lembur Paid di rekap; K-2 clock-out lintas tengah malam; K-3/M-02 penandaan Paid hanya order yang benar termuat run SALARY; M-1 tier holiday 7/8/9; M-4 validasi jendela transfer; M-7 tolak SP lembur masa depan.
   - **Leave**: L-01 re-validasi saldo saat approve (pending direservasi); L-02 encashment re-check + reservasi; L-03 guard backdate/periode; L-04 stop tulis Absent masa depan; L-05 aktor keputusan dari sesi.
   - **Travel**: K-1 transfer tanpa wipe; K-2 guard klaim duplikat; M-1 settlement (a)(b)(c) dihitung server; M-2 klaim hanya dari request Approved; M-5 validasi tanggal; C-04 jurnal porsi payroll kredit 2101.
   - **Medical**: K-1 enforcement plafon saat submit+approve; K-2 re-check remaining + blokir transfer saat ada klaim pending; K-3 dependent SHARED memotong pool; K-4 hapus auto-carry; M-2 validasi tanggal; M-3/M-05 penandaan Paid align transfer; M-8 dedupe kwitansi.
   - **Lintas-modul**: `requireMutator` diterapkan ke seluruh endpoint keputusan/transfer/confirm.

**Backlog (didokumentasikan, tidak mengganggu): MINOR per modul + GAP** — lihat `audit/BPA-<modul>.md` bagian GAP (fitur seperti ESS self-service, lampiran kwitansi, multi-layer approval generik, dependents medical, PPh21 YTD penuh Pasal 17, THR aturan H-7, dsb.).

---

## Struktur per Modul (ringkas — detail di BPA masing-masing)

### HumanResource
- Proses inti: wizard karyawan → Employee+Assignment; PA (12 tipe) → ApprovalLayer → inbox → keputusan → efek penempatan.
- Kritis: PA struktural no-op (kode vs ID); efek PA non-transaksional; aktor hard-coded + self-approval.
- Gap besar: mesin approval PRD §6.6 (autoApprove, delegasi, SLA), surat PA (DOCX), kontrak/probation end-date, disciplinary berjenjang SP1-3.

### Payroll
- Proses inti: periode → run (Draft→Calculated→Confirmed) → engine (gaji+komponen+TER) → jurnal → bank export; agregator 4 modul.
- Kritis: PPh21 run ireguler ≈ 0; cancel run Confirmed → double-book.
- Gap besar: PPh21 kumulatif YTD penuh, BPJS iuran terhitung penuh (basis pokok+tunjangan), THR regulasi, slip gaji PDF, maker-checker.

### TimeAttendance
- Proses inti: master (jadwal/regu/hari) → assignment → clocking → AttendanceDaily (realtime) → rekap/transfer payroll; SP lembur → approval → clock → bayar.
- Kritis: lembur Paid ikut rekap berikutnya (double-pay); clock-out >24:00 dibuang (absen penuh); penandaan Paid window mismatch.
- Gap besar: koreksi manual clocking + approval, kalender libur nasional, cap lembur UU, import mesin finger.

### Leave
- Proses inti: jenis a–g → saldo (prorata, carry) → permintaan → approval → potong saldo → presensi OnLeave → encashment → payroll UCT.
- Kritis: re-validasi saldo saat approval; encashment overpay.
- Gap besar: cuti melahirkan (UU §82), entitlement masa kerja, black-out date, ESS.

### Travel
- Proses inti: request multi-destinasi → approval → advance → claim settlement (a)(b)(c) → jurnal → transfer UTRP/TRVSTLIN.
- Kritis: transfer ke-2 wipe assignment; klaim duplikat per request.
- Gap besar: kwitansi, multi-currency, tarif grade/zona otomatis, approval multi-layer nominal.

### Medical
- Proses inti: jenis benefit (FACTOR/NOMINAL/UNLIMITED) → generate saldo tahunan → klaim multi-baris → approval → settle jurnal 5106 → transfer UMC.
- Kritis: over-limit lolos; double pay pasca-transfer; dependent SHARED tidak memotong pool; auto-carry initialUsed salah.
- Gap besar: dependents terintegrasi EmployeeFamily, pre-authorization, potongan gaji over-limit, attachment.

### Lintas-Modul
- Approval engine belum generik: multi-layer hanya PA (dan layer-nya kosmetik), 6 proses lain single-step tanpa template/inbox/routing.
- 3 generator jurnal bentrok (fixed Task 24 fondasi); ActivityLog tanpa pelaku; AccessGroup tidak diverifikasi; dua sistem klaim "benefit" paralel (BenefitClaim payroll vs MedicalClaim).

---

## Verifikasi

- Fondasi: `bunx tsc --noEmit` 0 error kode aplikasi; patch email AppUser MII000001 terpasang.
- Perbaikan per modul: diverifikasi per agen (tsc, lint, negative-test API guard yang aman — operasi illegal harus ditolak 400/403).
- E2E akhir: agent-browser golden path 6 modul + dev.log bersih (lihat bagian "Hasil Perbaikan" di bawah bila sudah final).

## Hasil Perbaikan Task 24

**Eksekusi**: fondasi bersama (orchestrator) + 7 agen perbaikan (HR, TA, Leave, Travel, Medical×2, Payroll) + sweep lintas-modul oleh orchestrator.

### Fondasi bersama
| Item | Perubahan |
|---|---|
| `shared/lib/tenant-db.ts` | **`requireMutator(req)`** — guard mutasi bisnis: resolusi tenant + tolak role VIEWER (403) + **aktor sesi nyata** (`userId/name/email/role` + AppUser tenant via email + employeeId) — menggantikan aktor hard-coded `"MII000001"` (fix C-01/C-02). |
| `shared/lib/journal-no.ts` (baru) | Generator nomor jurnal **tunggal** max-suffix per tahun — menggantikan 3 generator bentrok (payroll count-based, travel max-parse, medical `slice(3)` salah yang menghasilkan "JV-2027..2031") (fix M-07). |
| `prisma/seed.ts` + `scripts/patch-appuser-email.ts` | Email AppUser MII000001 disinkronkan dengan login demo `hrd@mii.co.id` → resolusi aktor sesi menemukan AppUser yang benar (patch live DB terpasang). |
| Sweep 10 endpoint uang/keputusan/keamanan | `leave/transfer`, `leave/mass`, `payroll-rapel`, `component-assignments`, `loans`, `payroll-periods`, `approval-templates`, `temporary-approvers`, `app-users`, `access-groups` → `requireMutator` (skrip transform, hanya fungsi POST/PATCH/PUT/DELETE — GET tetap `requireTenant`). |

### Per modul (semua agen melapor tsc 0 · lint 0 · dev.log bersih · data demo utuh)
| Modul | Perbaikan (ringkas) |
|---|---|
| **HR** (24-FIX-HR) | K-01: file baru `services/pa-targets.ts` — dialog PA kirim ID+kode, handler process baca `positionId/orgUnitId/gradeId` + fallback resolve kode→id (PA lama), PA struktural tanpa target → 400. K-02: seluruh side-effect PA + status dalam satu `$transaction` (count 0 → 409). K-03: aktor sesi (`requireMutator`), layer approver resolve dari struktur, guard putus OWNER/ADMIN/HR ∨ approver match, self-approve non-privilege → 403, inbox `mine=1` per aktor (badge 1→2 dokumen). M-01 race (updateMany kondisional → 409), M-02 terminasi `endDate = lastDay ?? effectiveDate` + resign terjadwal tetap Active, M-06 validasi eff≥joinDate/gaji range grade/PA hanya Active/FK → 400 ramah. |
| **Payroll** (24-FIX-PAYROLL) | K-2: cancel run Confirmed → **409** (jurnal/cicilan terpasang). K-1: run ireguler (THR/BONUS/RAPEL) diberi konteks YTD bruto run SALARY tahun berjalan (fallback gaji bulanan) → PPh21 Pasal 17 atas neto disetahunkan + ireguler; anti double-withhold; N2G konvergen (uji: THR 20jt → pajak 0 → 5.000.000). M-1: JKK/JKM/JPK-C dikeluarkan dari objek pajak/basis TER (PMK 16/2021), pengurang neto hanya JHT/JP (41/42 karyawan pajak turun). M-2 overlap periode → 400; M-3 rapel duplikat + run non-Draft → 400; M-6 close periode dengan klaim pending → 400 (3 klaim disebut); M-8 Specific ke run final → 400; aktor confirm/approve dari sesi. |
| **TimeAttendance** (24-FIX-TA) | K-1: rekap uang lembur hanya order `paidRunNo:null` (rekap Sep 2,24jt → 0 — order Paid tak dihitung lagi). K-2: clock-out lintas tengah malam diterima (window OUT = jam pulang+10j; kasus live MII00027 12 Agu: Absent → Present). K-3: `markOvertimePaidForRun` hanya run SALARY + window transfer period + karyawan punya item lembur di run. M-1: tier holiday PP 35/2021 Ps.28 (1-7=2×, 8=3×, 9+=4×; 5jt/8j: 578rb → 491rb). M-4: window transfer divalidasi vs period + anti-overlap (window disimpan di `taStartDate/taEndDate`). M-7: tolak SP lembur masa depan; verified=0 tanpa clock. Bonus: `requireMutator` di 6 route mutasi TA + ActivityLog aktor. |
| **Leave** (24-FIX-LEAVE) | L-01: reservasi pending (applied termasuk Submitted) + **re-validasi saldo saat approve** dalam `$transaction` Serializable (retry P2034) — cuti paralel tidak lagi menghasilkan saldo negatif (jenis advance tetap boleh minus sesuai desain). L-02: encashment re-check remaining + atomic. L-03: backdate ditolak; encashment hanya tahun berjalan. L-04: reject/cancel & mass leave tidak lagi menulis Absent untuk tanggal masa depan. L-05: `decidedById` = aktor sesi (AppUser MII000001) + `requireMutator`. |
| **Travel** (24-FIX-TRAVEL) | K-1: transfer rewrite = {Approved} ∪ {Transferred period ini} — assignment period lain/Paid aman; guard period run Confirmed → tolak. K-2: klaim duplikat per request → 400 + dropdown hanya request Approved tanpa klaim aktif. M-1: settlement (b)/(c) **dihitung server** dari rincian vs advance (klien readOnly). M-2: klaim wajib request Approved; cancel request berklaim aktif ditolak. M-5: validasi tanggal kaki/expense/claimDate. C-04: jurnal klaim — porsi payroll (b+c) dikredit **2101 Hutang Gaji**, tunai → 1101 (kas tidak lagi dobel dengan UTRP run). Aktor `requireMutator` di claims/transfer/requests. |
| **Medical** (24-FIX-MEDICAL/2) | K-1: over-limit ditolak di submit + re-check settle (MC-2026-005 settle → 400, jurnal tidak dibuat). K-2: re-check approve/settle; transfer UMC menolak bila ada klaim Submitted (MC-2026-006); klaim atas saldo ter-transfer → 400. K-3: SHARED pakai **pool utama** (termasuk routing adjustment). K-4: generate tanpa auto-carry (initialUsed=0). M-2: tanggal ≤ hari ini/tahun saldo/≥ joinDate. M-3/M-05: `markMedicalPaidForRun` menandai objek yang benar (42/42 UMC cocok; idempoten; SALARY-only). M-8: dedupe kwitansi lintas klaim aktif. Aktor di 8 route medical. Bonus: preview error bisnis 500→400. |
| **Dashboard (shared)** | Fix overflow mobile 390px: grid kartu chart `min-width:auto` → `[&>*]:min-w-0` (scrollWidth 559 → 390). |

### Verifikasi akhir (orchestrator)
- `bunx tsc --noEmit` **0 error** kode aplikasi · `bun run lint` **bersih**.
- **62 endpoint GET lintas 6 modul + settings → 200 semua** (setelah login + select-tenant MII).
- Negative guard: tanpa sesi → 401 (transfer/periods/app-users); sesi tanpa body valid → 400; cancel run Confirmed → 409; process PA sudah Processed → 409.
- **E2E agent-browser**: login → pilih workspace → 15 view lintas 6 modul (payroll runs/periods/rapel/benefits; TA clocking/lembur/absensi; leave permintaan/approval/encashment; travel klaim/approval; medical klaim/approval/saldo; HR inbox/detail PA/dialog PA baru) — **0 page error, 0 console error**; inbox menampilkan 2 dokumen PA dengan tombol keputusan (aktor sesi bekerja); dialog PA baru memuat field tujuan (posisi/unit/grade) + gaji.
- Mobile 390px: scrollWidth = 390 (0 overflow); footer: struktur `flex min-h-screen` + `mt-auto` — halaman pendek menempel bawah viewport, halaman panjang terdorong natural (inbox 900/844, medical reports 2423 — tanpa gap menggantung). Desktop 1440px: 0 overflow.
- `dev.log`: hanya 200/401 (uji negatif) — tidak ada 500/compile error seluruh sesi.
- Data demo MII utuh: 44 karyawan · 86 request cuti · 6 run payroll · 2.562 absensi harian · 11 klaim medis (termasuk kasus audit MC-2026-005/006 yang kini ter-blokir untuk operasi baru) · 7 request travel.

### Sisa risiko / backlog lanjutan (per agen)
- HR: resign terjadwal tanpa job harian penonaktif; 5 tipe PA minim efek data; prefix employeeNo "MII".
- Payroll: reversi run Confirmed tetap manual (butuh jurnal Reversed + rollback cicilan transaksional); konteks YTD memakai snapshot bruto historis; payPeriod 2026-10=0 belum dinormalisasi.
- TA: order di-approve antara transfer dan kalkulasi bisa tertandai Paid tanpa nilai snapshot (edge sempit); lupa clock-out murni >10 jam tetap Absen; rekap pakai gaji saat ini.
- Leave: submit masih non-transaksional (tertangkap re-validasi approve); split lintas periode.
- Travel: jurnal sisi run payroll masih D-5105 untuk UTRP (konsolidasi level COA); advance tanpa jurnal; markTravelPaidForRun tanpa verifikasi item run untuk klaim lama.
- Medical: totalRemaining masih menampilkan depRemaining SHARED negatif (display lama); frekuensi multi-tahun.
- Lintas-modul: master-CRUD tanpa role check (VIEWER bisa edit master — RBAC granular = backlog); ActivityLog belum menyertari semua operasi; dua sistem klaim "benefit" paralel.
