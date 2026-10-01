# RekanKerja HRIS Mobile 📱

Aplikasi mobile **Employee-Centric Self-Service** untuk RekanKerja HR Suite — didesain agar pengalaman HR terasa menyenangkan dan personal layaknya aplikasi fintech/media sosial, bukan software kantor yang kaku.

> **Status:** ✅ **Terhubung ke backend RekanKerja** (default: `https://onevity.sayone.my.id`) — mode **Demo** tetap tersedia untuk mencoba tanpa server.

## Dua Mode Aplikasi

| | Mode **Live** | Mode **Demo** |
|---|---|---|
| Sumber data | REST API RekanKerja (`/api/rekankerja/ess/*`) | Seed lokal realistis |
| Login | Email + sandi akun kantor → (MFA 6 digit bila aktif) → pilih workspace bila multi-perusahaan | Tombol *Coba Mode Demo* |
| Presensi, cuti, lembur, workoff, tukar shift, surat, whistleblow | Nyata — tersimpan ke database perusahaan | Simulasi lokal |
| Slip gaji, klaim, aset, pengumuman, notifikasi, profil | Nyata — dari server (hanya-baca) | Simulasi lokal |
| Sesi | Cookie `rekankerja_session` (7 hari, tersimpan di perangkat) | — |

Ganti server (dev ⇄ produksi): **tekan-lama logo "1V"** di halaman login → dialog Base URL. Bisa juga lewat build: `--dart-define=REKANKERJA_API=https://...`.

## Fitur (dari modul RekanKerja)

| Modul | Isi | Sumber live |
|---|---|---|
| 🏠 **Beranda** | Sapaan personal, kartu presensi satu-tap, KPI (sisa cuti, menunggu persetujuan, kehadiran, lembur), teaser slip terbaru, feed pengajuan | `/ess/dashboard` |
| ☝️ **Presensi** | Statistik ring, kalender bulanan interaktif (warna status + WF), riwayat + detail, navigasi bulan | `/ess/attendance`, `POST /ess/clock` |
| 🌴 **Cuti** | Saldo per jenis (termasuk saldo pecahan), pengajuan date-range, riwayat + approver aktif | `/ess/leave` |
| 💸 **Slip Gaji** | Daftar periode (status Terbayar/Terkonfirmasi), detail komponen lazy-load, mode privasi nominal | `/ess/payslips(+/detail)` |
| 🏥 **Klaim** | Reimbursement medis + klaim perjalanan dinas (uang muka/pertanggungjawaban), filter status | `/ess/claims` |
| 📋 **Pengajuan** | Lembur, workoff, perjalanan dinas | `POST /ess/overtime`, `/ess/workoff` |
| 📄 **Surat** | Template dari server, permintaan + keperluan, **unduh PDF** surat terbit (share sheet) | `/ess/letters(+/pdf)` |
| 📣 **Pengumuman** | Feed berita: pin, badge belum-baca, jumlah pembaca | `/ess/announcements` |
| 🔁 **Tukar Shift** | Pilih tanggal → lihat jadwalmu → pilih rekan kandidat → ajukan/batalkan | `/ess/swap` |
| 💼 **Aset Saya** | Aset aktif + riwayat pengembalian (kondisi, jatuh tempo) | `/ess/assets` |
| 🛡️ **Lapor Aman** | Whistleblowing anonim — 7 kategori, tanggal insiden, kode tiket pelacakan | `POST /whistleblowing/report` |
| 👤 **Saya** | Profil kepegawaian, NPWP/BPJS (masker + toggle), logout | `/ess/me` |
| 🔔 **Notifikasi** | Pusat kabar persetujuan/payslip/pengingat | `/ess/notifications` |

> Pengajuan **klaim medis** dan **perjalanan dinas** dari mobile belum dibuka backend ESS — aplikasi menampilkan statusnya secara lengkap dan mengarahkan ke HR/backoffice untuk pengajuan baru.

## Stack & Arsitektur

- **Flutter 3.32** + Material 3, tema emerald + aksen amber (identitas RekanKerja)
- **provider** untuk state; **http** + cookie sesi manual; **shared_preferences** (sesi & server), **path_provider + share_plus** (PDF surat)
- Struktur:
  ```
  lib/
  ├── app.dart / main.dart
  ├── core/                     # design system: theme, format ID, widgets reusable
  ├── data/
  │   ├── api_client.dart       # HTTP + cookie rekankerja_session + error ramah
  │   ├── rekankerja_api.dart       # gateway bertipe + mapper JSON→model seluruh ESS
  │   ├── app_state.dart        # AppState dua-mode (demo|live) + restore sesi
  │   ├── models.dart           # model lintas modul (field live opsional)
  │   └── mock_data.dart        # seed demo
  └── features/                 # 14 halaman per modul ESS
  ```

## Menjalankan

```bash
cd hris-mobile
flutter pub get
flutter run          # pilih emulator / device
```

- **Mode Live:** masuk dengan akun kantor RekanKerja (mis. demo lokal: `hrd@mii.co.id` / `onevity123`).
- **Mode Demo:** tombol *Coba Mode Demo* di halaman login.

## Testing

```bash
flutter analyze
flutter test
```

- `test/smoke_test.dart` — E2E mode demo: splash → login → shell → navigasi → clock in/out.
- `test/live_api_test.dart` — **integrasi nyata** ke backend lokal (`http://localhost:3000`, kode sama dengan produksi): login → pilih workspace → `/ess/me` → dashboard → presensi → cuti → slip + rincian → logout 401. Otomatis di-skip bila server tidak berjalan.

## Catatan desain

- Bahasa utama: Indonesia (gaya ramah "kamu")
- Nominal besar & tebal (fintech), chip status berwarna, radius 20–28, soft shadow
- Dark mode penuh + **privacy mode** (sembunyikan nominal gaji; nominal ter-mask server/vault tampil "•••")
- Semua form memakai bottom-sheet — satu jempol cukup
- Keamanan: sesi cookie httpOnly server-side + sessionVersion (logout mencabut semua token), MFA TOTP dua-langkah didukung
