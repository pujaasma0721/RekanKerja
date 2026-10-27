# UAT HR BASE — VERIFIKASI ULANG PASCA-REBASE ( kode ter-fix dari origin/main )

## KONTEKS

UAT ulang Bagian 1-2 (laporan ini) tanpa sadar dijalankan terhadap **kode basi** — snapshot lokal tertinggal di commit `b84efee`, sementara origin/main sudah berisi rangkaian fix yang hilang dari konteks sesi sebelumnya:
- `fe6f826` QA-ORG-EDIT — fitur edit unit organisasi
- `74b83c5` QA-ORG-CODE-IMPACT — notifikasi dampak perubahan kode unit
- `4b68d92` UAT HR-Base pertama (33/34 PASS; temuan MAY-01, MIN-01..08, PERF-01, INF-01)
- `a7d8004` UAT-HR-BASE-FIX — perbaikan seluruh temuan UAT pertama

Setelah rebase + push (`4a48bca`), seluruh temuan FAIL besar diverifikasi ulang terhadap kode ter-fix. Insiden lingkungan selama verifikasi: OOM kernel membunuh next-server berkali-kali saat kompilasi ulang penuh pasca-rebase (browser Chrome + Turbopack > RAM 4GB) → diselesaikan dengan menutup browser, membersihkan watchdog ganda, warm-up route, lalu buka browser kembali.

## HASIL VERIFIKASI ULANG

| Temuan (stale code) | Status di kode ter-fix | Bukti |
|---|---|---|
| F-01 KRITIS — edit company gagal "id company wajib" | **✅ FIXED** — dialog "Edit Profil" ter-prefill lengkap; ubah telepon → Simpan → PATCH 200 → DB `555-0101` tersimpan + tampil di halaman | 37, 38 + DB query |
| F-02 MAJOR — halaman Perusahaan kosong | **✅ FIXED** — nama/alamat/telepon/email/website/NPWP tampil; KPI 43 karyawan aktif / 18 unit / 20 posisi | 37-company-page-fixed.png |
| F-03 MAJOR — tidak ada UI edit unit | **✅ FIXED** — tombol "Edit Unit" di panel detail unit; dialog lengkap (kode/nama/parent/budget) | 39, 40 |
| F-04 MAJOR — kode unit tak bisa diedit | **✅ FIXED** — field "Unit Code *" EDITABLE; ubah kode → banner amber **"Unit code is about to change — check the impact"** + hasil analisis "No active action documents depend on this legacy code." + advisory template Excel; Batal menjaga data utuh | 40, 41 |
| F-15 MINOR — GAJI POKOK "—" untuk OWNER | **✅ FIXED** — profil Hartono tab Pekerjaan: GAJI POKOK **Rp 54.900.000** (rentang grade Rp 50-80 jt); dashboard: RATA-RATA GAJI POKOK Rp 11,5 jt; PII lain (NIK/BPJS/bank) terdekripsi penuh | live eval |
| F-13 KRITIS — duplikat NIK diterima | **❌ MASIH TERBUKA** — POST employees tetap tanpa cek keunikan NIK; JALUR IMPORT EXCEL sudah punya cek (nikSet dari existingNiks terdekripsi) → inkonsistensi antar jalur input | kode employees.ts:560+ vs :1220 |
| F-16 MINOR — offboarding ganda | **⚠️ SEBAGIAN** — POST manual kini punya guard "satu proses aktif per karyawan" (400); jalur hook PA-exit (createOffboardingWithTasks langsung) masih tanpa guard — kasus tepi: offboarding Completed lalu PA diproses → record kedua | offboarding.ts:194-201 vs :54 |
| F-05..F-12 minor (toast copy, validasi form, a11y, PWA) | Tidak diuji ulang satu per satu — mayoritas sudah ditangani UAT-HR-BASE-FIX (MAY-01, MIN-01..08) | — |
| F-14 MINOR — wizard bisa lanjut langkah dgn field wajib kosong | Tidak diubah oleh fix (validasi tetap di Review) | 26b |
| F-17 INFO — tanpa nonaktifkan cepat | Tidak diubah (by design via Offboarding) | — |

## INSIDEN LINGKUNGAN PENTING (didokumentasikan)

1. **Restore snapshot menyebabkan lokal tertinggal dari origin** — seluruh pekerjaan "hilang dari konteks" ternyata aman di GitHub. Pelajaran: sebelum UAT/QA apa pun, `git fetch` + bandingkan `origin/main` vs `HEAD` dulu.
2. **OOM loop pasca-rebase** — kernel OOM-kill next-server (anon-rss 2,75GB) berulang saat Turbopack kompilasi ulang penuh + Chrome ±600MB di kotak 4GB. Mitigasi terbukti: tutup browser → kill watchdog ganda + orphan → satu watchdog bersih → warm-up route via curl → buka browser lagi.
3. **Cookie sesi httpOnly tidak bisa dihapus via JS** (by design, baik) — sesi bertahan lintas reload.
4. **PWA banner muncul lagi** bila localStorage dibersihkan (flag dismissal hilang) — sesuai desain flag, bukan bug.

## KESIMPULAN

- **Semua temuan besar UAT ulang yang ternyata regresi kode-basi telah dipastikan SUDAH FIXED di kode aktual** (F-01, F-02, F-03, F-04, F-15).
- **Temuan baru yang tetap valid di kode aktual: F-13 (duplikat NIK — KRITIS, inkonsisten dengan jalur import yang sudah divalidasi) dan F-16 sebagian (hook PA-exit tanpa guard).**
- Status UAT modul HR Base keseluruhan (menggabungkan UAT pertama origin 33/34 + verifikasi fix + UAT ulang ini): **LULUS dengan 2 temuan terbuka yang perlu ditangani** (F-13 prioritas utama; F-16 kasus tepi).
