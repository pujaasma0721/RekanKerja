# OneVity HRIS Mobile 📱

Aplikasi mobile **Employee-Centric Self-Service** untuk OneVity HR Suite — didesain agar pengalaman HR terasa menyenangkan dan personal layaknya aplikasi fintech/media sosial, bukan software kantor yang kaku.

> **Status:** Demo UI dengan data seed realistis — arsitektur siap disambungkan ke backend OneVity (lihat *Integrasi* di bawah).

## Fitur (dari modul OneVity)

| Modul | Isi |
|---|---|
| 🏠 **Beranda** | Sapaan personal, kartu presensi satu-tap (jam hidup + status shift), sisa cuti, lembur bulan ini, teaser take-home pay (privacy mode), pintasan, pengumuman terbaru |
| ☝️ **Presensi** | Ring statistik kehadiran, kalender bulanan interaktif (warna status), riwayat + detail lembur |
| 🌴 **Cuti** | Saldo per jenis (ring), pengajuan dengan date-range, riwayat + timeline persetujuan berjenjang |
| 💸 **Slip Gaji** | Daftar 12 periode, detail komponen penghasilan/potongan/PPh 21, mode privasi nominal |
| 🏥 **Klaim** | Reimbursement medis (rawat jalan/inap/gigi/kacamata/persalinan), filter status, timeline |
| 📋 **Pengajuan** | Lembur, workoff, perjalanan dinas (+ uang muka), tukar shift |
| 📄 **Surat** | Permintaan surat keterangan kerja/gaji/pengalaman, keperluan, riwayat |
| 📣 **Pengumuman** | Feed berita perusahaan dengan kategori & pin |
| 🔁 **Tukar Shift** | Jadwal ke depan, tawaran tukar dengan rekan |
| 💼 **Aset Saya** | Daftar aset perusahaan yang dipinjamkan |
| 🛡️ **Lapor Aman** | Whistleblowing — jaminan anonimitas, kategori pelanggaran, kode pelacakan |
| 👤 **Saya** | Profil & data kepegawaian, keluarga, dokumen, pengaturan (dark mode, privasi nominal, notifikasi) |
| 🔔 **Notifikasi** | Pusat kabar persetujuan/payslip/pengingat + poin gamifikasi |

## Stack & Arsitektur

- **Flutter 3.32** + Material 3, tema emerald + aksen amber (identitas OneVity)
- **provider** untuk state management (`AppState` — semua aksi bermutasi state → UI interaktif penuh)
- Tanpa dependensi berat: kalender, ring progress, timeline — semua custom-painted
- Struktur:
  ```
  lib/
  ├── app.dart / main.dart      # root + tema (light/dark)
  ├── core/                     # design system: theme, format (rupiah/tanggal ID), widgets reusable
  ├── data/                     # models, seed demo, AppState (ChangeNotifier)
  └── features/                 # 14 halaman per modul ESS
  ```

## Menjalankan

```bash
cd hris-mobile
flutter pub get
flutter run          # pilih emulator / device
```

Login demo: tombol *Masuk Sekarang* (kredensial demo terisi otomatis).

## Integrasi backend OneVity (next step)

`lib/data/app_state.dart` adalah titik ganti tunggal:
1. Ganti seed `mock_data.dart` dengan service API OneVity (`/api/onevity/ess/*` sudah tersedia di web: auth, clock, leave, claims, payslips, dsb.)
2. Tambahkan `dio`/`http` + token sesi → mutasi `submit*()` cukup memanggil endpoint.
3. Enkripsi uang & PII sudah ditangani backend (Money Vault + field-crypto) — mobile hanya menampilkan.

## Catatan desain

- Bahasa utama: Indonesia (gaya ramah "kamu")
- Nominal besar & tebal (fintech), chip status berwarna, radius 20–28, soft shadow
- Dark mode penuh + **privacy mode** (sembunyikan nominal gaji)
- Semua form memakai bottom-sheet — satu jempol cukup
