# Laporan Perbaikan — Sisa Temuan UAT HR-Base (F-05..F-08, F-10, F-14, F-16, F-17)

Task ID: FIX-UAT-REST · Tanggal: 2026-10-27 · Kode: origin/main `ab9c96d` → fix ini
Tester: HR (`hrd@mii.co.id`, OWNER MII) · Target: http://localhost:3000/ (dev)

## 0. Konteks

Menindaklanjuti Stage Summary FIX-F13: "Sisa temuan UAT terbuka: F-16 parsial (hook PA-exit tanpa guard offboarding) · F-14 minor (validasi wizard telat di Review) · F-17 info". Diperluas memeriksa ulang F-05..F-08 & F-10 yang "belum diuji ulang satu per satu" pada laporan verifikasi pasca-rebase. Hasil audit kode: F-05, F-06 (sisi server), F-07, F-08, F-10 ternyata masih ada celah; F-06 sisi klien & F-14 sisi next() sudah ada. Semua celah ditutup dalam sesi ini.

## 1. Perbaikan per Temuan

### F-16 [MINOR→FIXED] Guard duplikat offboarding — dua jalur kini konsisten
- **Masalah**: POST manual hanya cek `status:"Open"`; hook PA-exit juga hanya cek Open → karyawan yang sudah **menyelesaikan** offboarding (Completed) lalu PA-nya diproses mendapat record KEDUA (repro nyata UAT: MII00046 punya 2 offboarding).
- **Perbaikan**: helper bersama `findBlockingOffboarding(tx, employeeId)` di offboarding.ts — memblokir bila ada offboarding **Open ATAU Completed** (Cancelled tidak menghalangi). Dipakai: (a) POST manual → 400 dengan pesan kontekstual; (b) hook PA-exit di personnel-actions-detail.ts → skip + **ActivityLog "Skipped … DILEWATI"** (jejak audit, tidak diam-diam).
- **Verifikasi E2E penuh** (browser + API sebagai OWNER):
  1. Buat karyawan uji MII00046 → offboarding dibuat (201, 10 tugas) → semua tugas Done → complete (200).
  2. POST offboarding kedua → **400** `"Karyawan ini sudah pernah menyelesaikan proses offboarding — proses baru tidak dapat dibuat"` ✓
  3. Buat PA-2026-0010 Resignation → submit → approve 2 layer → **process (200)** → offboarding karyawan tetap **1** (Completed), TIDAK ada record kedua ✓
  4. ActivityLog: `"Offboarding otomatis dari PA-2026-0010 (Pengunduran Diri) DILEWATI — karyawan sudah memiliki proses offboarding yang sudah selesai"` ✓
- Cleanup total: MII00046 + PA-2026-0010 + relasi + 22 ActivityLog + 22 EmailLog dihapus; direktori kembali **45 karyawan**, offboarding **0**, PA **9** (PA-2026-0001..0009), nomor berikutnya otomatis MII00046.

### F-14 [MINOR→FIXED] Validasi wizard onboarding
- **Status**: tombol "Lanjut" sudah memvalidasi per-langkah (blokir + toast + error inline — terverifikasi live: nama dikosongkan → Lanjut → tetap di langkah 1, "Nama lengkap wajib diisi" merah + toast "Lengkapi field yang ditandai merah"; screenshot f14-step1-blocked.png). Jalur UI ke "Review dengan field wajib kosong" kini tertutup (stepper hanya bisa mundur ke langkah yang sudah lewat).
- **Lapisan baru (defense-in-depth)**: `submit()` di Review kini re-validasi langkah 1–2 + baris kontak darurat → lompat otomatis ke langkah pertama yang salah + toast — user tidak perlu menunggu error 400 server (mis. draft restore/edit-balik di sesi mendatang).

### F-17 [INFO→FIXED] Discoverability penonaktifan karyawan
- **Masalah**: tidak ada jalur nonaktifkan cepat; HR harus tahu sendiri harus ke modul Offboarding.
- **Perbaikan**: tombol **"Proses Keluar"** (ikon LogOut) di header profil karyawan — tampil hanya bila karyawan Active, belum punya offboarding berjalan, dan punya hak `hr:offboarding:create`. Klik → modul Offboarding terbuka dengan **dialog "Proses Offboarding Baru" LANGSUNG TERBUKA dan karyawan TERISI** (param nav `newFor`; prefill via state-awal-dari-prop + `key` reset — tanpa effect, lolos rule `react-hooks/set-state-in-effect`).
- **Verifikasi**: profil Hartono Wijaksono (MII00001) → tombol tampil → klik → modul Offboarding + dialog terbuka, terisi "Hartono Wijaksono · MII00001" (screenshot f17-proses-keluar-dialog.png) → Batal → tidak ada data berubah. Setelah dialog ditutup, "Proses Baru" manual berikutnya mulai kosong (prefill ter-reset via key).

### F-05 [MINOR→FIXED] Toast/dialog dobel kata "Unit Unit …"
- **Masalah**: template `"Unit {n} …"` bertabrakan dengan nama yang berawalan "Unit" → "Unit Unit Uji Coba UAT berhasil dibuat".
- **Perbaikan**: helper `unitPhrase(name)` — prefix "Unit" hanya ditambahkan bila belum ada (regex `^unit\b`). Dipakai di 3 toast (buat/edit/hapus) + teks dialog konfirmasi hapus.
- **Verifikasi**: buat unit "Unit Uji Coba F05" → toast `"Unit Uji Coba F05 berhasil dibuat"` (tanpa dobel) → hapus → dialog `"Unit Uji Coba F05 akan dihapus permanen."` → toast `"Unit Uji Coba F05 dihapus"` → tree kembali bersih.

### F-06 [MINOR→FIXED] Validasi form company (sisi server)
- Klien sudah memvalidasi (nama wajib + mata uang 3 huruf) — dicek utuh. **Celah sisi server ditutup**: PATCH `/api/rekankerja/companies` kini menolak `name` kosong/whitespace dengan 400 `"Nama perusahaan wajib diisi"` (sebelumnya string kosong bisa tersimpan menimpa nama valid).
- **Verifikasi**: PATCH `{name:"   "}` → **400** ✓

### F-07 [MINOR→FIXED] Guard hapus unit kini transparan + par dengan API
- **Masalah**: tombol Hapus disembunyikan diam-diam untuk unit ber-anak/ber-karyawan — user bingung tombolnya ke mana. Guard UI juga melewatkan **posisi** (API DELETE menolak dengan 400 "masih memiliki N posisi", tapi UI tetap menampilkan tombol aktif).
- **Perbaikan**: tombol tetap DIRENDER dalam keadaan **disabled** + tooltip `title`/`aria-label` berisi alasan lengkap; guard UI kini mencakup sub-unit + karyawan + **posisi** (par dengan cek API DELETE).
- **Verifikasi**: CEO Office → `{"disabled":true,"title":"Hapus dinonaktifkan karena unit masih memiliki 1 sub-unit, 2 karyawan, 1 posisi"}` ✓; unit kosong (Uji F05 sebelum dihapus) → tombol enabled ✓.

### F-08 [MINOR→FIXED] Warning a11y Radix DialogContent — fix SENTRAL
- **Masalah**: setiap dialog tanpa `<DialogDescription>` memicu warning console `"Missing \`Description\` or \`aria-describedby={undefined}\` for {DialogContent}"` (muncul tiap buka dialog, pre-existing di seluruh aplikasi).
- **Akar masalah**: Radix memasang `aria-describedby={descriptionId}` default pada DialogContent; bila tidak ada Description, id menunjuk ke elemen yang tidak ada.
- **Perbaikan (satu tempat, berlaku aplikasi-wide)**: wrapper `src/components/ui/dialog.tsx` mendeteksi kehadiran DialogDescription via React context; bila tidak ada → meneruskan `aria-describedby={undefined}` eksplisit (pola resmi Radix) → atribut tidak dirender → warning hilang DAN tidak ada lagi id aria menggantung. Dialog DENGAN Description tetap terhubung normal.
- **Verifikasi**: dialog "Unit Baru" (tanpa Description) → `aria-describedby: ABSENT`, console bersih; dialog "Edit Unit" (dengan Description) → `aria-describedby=radix-_r_22_` → elemen deskripsi ADA di DOM, console bersih; dialog "Proses Offboarding Baru" (tanpa Description, modul lain) juga bersih. **0 warning sepanjang sesi** yang membuka ≥6 dialog berbeda. (Catatan: seluruh 36 pemakai AlertDialog di aplikasi sudah memiliki AlertDialogDescription — dicek via grep, tidak perlu diubah.)

### F-10 [INFO→FIXED] Kode perusahaan read-only kini terdokumentasi
- Dialog Edit Profil menampilkan catatan: `"Kode perusahaan (MII) bersifat tetap — tidak dapat diubah dari profil ini."` (screenshot f10-company-code-note.png).

## 2. Uji Regresi

| Uji | Hasil |
|---|---|
| F-13 duplikat NIK (guard FIX-F13) | ✓ POST karyawan kedua dgn NIK sama → 400 `"NIK 3271010203940002 sudah dipakai karyawan lain (MII00046 — Uji F16 API)"` |
| MAY-01 overflow mobile direktori | ✓ viewport 390×844: scrollW 390 = clientW 390 — tidak ada overflow (screenshot mobile-390-directory.png) |
| Console & dev.log | ✓ 0 error JS, 0 page error, 0 warning a11y; dev.log tanpa error/500 selama sesi |
| Data demo pasca-cleanup | ✓ 45 karyawan · 0 offboarding · 9 PA (0001..0009) · nomor berikutnya MII00046 |

## 3. Verifikasi Kualitas Kode

- `bun run lint`: **0 error** (6 warning pre-existing unused eslint-disable — baseline sama dengan sesi sebelumnya).
- `bunx tsc --noEmit`: **bersih**.
- Catatan: satu iterasi perbaikan saat lint menolak `setState` langsung dalam effect (react-hooks/set-state-in-effect) pada prefill F-17 → diganti pola state-awal-dari-prop + remount via `key` (lebih idiomatik).

## 4. File yang Diubah (8)

| File | Temuan |
|---|---|
| `src/components/ui/dialog.tsx` | F-08 (fix sentral presence-context) |
| `src/rekankerja/human-resource/api/offboarding.ts` | F-16 (findBlockingOffboarding + guard POST) |
| `src/rekankerja/human-resource/api/personnel-actions-detail.ts` | F-16 (hook PA-exit pakai guard + ActivityLog skip) |
| `src/rekankerja/human-resource/api/companies.ts` | F-06 (PATCH tolak nama kosong) |
| `src/rekankerja/human-resource/components/employee/employee-wizard.tsx` | F-14 (re-validasi submit di Review) |
| `src/rekankerja/human-resource/components/employee/employee-module.tsx` | F-17 (tombol Proses Keluar) |
| `src/rekankerja/human-resource/components/offboarding/offboarding-module.tsx` | F-17 (param newFor + dialog prefill) |
| `src/rekankerja/human-resource/components/org/org-module.tsx` | F-05 + F-07 + F-10 |

## 5. Status Temuan UAT Keseluruhan (setelah sesi ini)

- **F-01..F-17: SEMUA CLOSED** (fixed & terverifikasi) — kecuali:
  - F-09, F-12 (INFO, by-design/sehat — tidak perlu aksi),
  - F-11 (PWA prompt sesi pertama — flag dismissal sudah diperbaiki UAT-HR-BASE-FIX; perilaku tersisa by-design),
  - INF-01 split-brain routing domain publik — KRITIS-INFRA, akar di platform DI LUAR container (wajib ditindaklanjuti pemilik platform),
  - PERF-01 employee-detail cold-compile — catatan dev; ukur ulang di build produksi.
- Sisa artefak: 4 screenshot di `audit/uat-hr-base-fix2/`.
