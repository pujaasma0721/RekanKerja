#!/usr/bin/env python3
# PPT-RESTORE: rebuild RekanKerja-Presentasi-Manajemen.pptx dari render slide PNG
# (tmp/pptx-check/s-01..14.png, tersimpan di git commit 5a9125d) + speaker notes.
# Latar: folder download/ hilang saat snapshot restore sandbox; sumber HTML tidak
# di-commit, tapi render visual 14 slide tersimpan utuh di git.
import os
from pptx import Presentation
from pptx.util import Inches, Emu

SRC = "/home/z/my-project/tmp/pptx-check"
OUT = "/home/z/my-project/download/RekanKerja-Presentasi-Manajemen.pptx"

notes = [
    # 1 — Cover
    "Slide pembuka. RekanKerja: platform HRIS multi-tenant yang dibangun in-house. "
    "Sampaikan tujuan sesi: gambaran produk secara utuh untuk pengambilan keputusan manajemen.",
    # 2 — Agenda
    "Lima bagian: tantangan operasional hari ini, solusi platform, tur produk, keamanan & skala, "
    "lalu langkah berikutnya yang diusulkan.",
    # 3 — Tantangan
    "Enam masalah operasional HR manual: data karyawan tersebar, payroll lambat dan rawan salah, "
    "presensi berbasis kertas, rekrutmen tidak terlacak, cuti lewat WhatsApp, dan tidak ada satu sumber kebenaran.",
    # 4 — Solusi
    "Satu platform dengan sembilan modul terintegrasi. Tunjukkan org chart di kanan sebagai bukti "
    "struktur data yang sudah tertata sejak awal. Tiga kemampuan kunci: multi-company, ESS mobile, dwibahasa.",
    # 5 — Dashboard
    "Dashboard manajemen dengan angka riil sistem: 43 karyawan aktif, rata-rata gaji Rp 11,5 juta, "
    "2 permintaan rekrutmen pending. Semua angka live dari database, bukan mockup.",
    # 6 — Data Karyawan 360
    "Profil karyawan satu layar: data pribadi, penempatan, dokumen, riwayat. Tekankan 43 profil aktif "
    "sudah rapi di dalam sistem hari ini.",
    # 7 — Payroll
    "Alur payroll terkontrol: draft, review, approve, bayar, jurnal. Kalkulasi otomatis termasuk "
    "pajak dan komponen BPJS; slip gaji terkirim elektronik.",
    # 8 — Presensi & ESS
    "Presensi real-time plus self-service karyawan dari HP: clock-in/out, pengajuan cuti, dan slip gaji "
    "tanpa perlu ke HRD.",
    # 9 — Rekrutmen
    "Funnel rekrutmen live: 2 PR pending, 3 kandidat tahap seleksi, 5 kandidat total, 1 penawaran. "
    "Angka langsung dari modul rekrutmen yang berjalan.",
    # 10 — Modul Pendukung & AI
    "Modul pendukung: cuti, perjalanan dinas, medis, whistleblowing, dan manajemen performa. "
    "Ada asisten AI untuk bertanya data dalam bahasa manusia.",
    # 11 — Keamanan
    "Isolasi data per tenant, enkripsi NIK/NPWP, audit trail lengkap. Sesuai amanat UU No. 27/2022 "
    "tentang Pelindungan Data Pribadi.",
    # 12 — Skala
    "Teruji beban: 4 tenant aktif saat ini, benchmark 5.000 karyawan per tenant, 2 database. "
    "Angka hasil uji beban nyata, bukan klaim.",
    # 13 — Nilai Bisnis
    "Nilai utama: proses lebih cepat, data akurat, kepatuhan terjaga, karyawan mandiri. "
    "Sistem yang merapikan cara kerja yang ada, bukan memaksakan cara kerja baru.",
    # 14 — Langkah Berikutnya
    "Usulan tiga fase: seed data contoh 43 karyawan, pilot satu divisi, lalu rollout penuh. "
    "Tutup dengan ajakan diskusi dan demo langsung.",
]

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]

for i in range(1, 15):
    png = os.path.join(SRC, f"s-{i:02d}.png")
    assert os.path.exists(png), f"missing {png}"
    slide = prs.slides.add_slide(blank)
    slide.shapes.add_picture(png, 0, 0, width=prs.slide_width, height=prs.slide_height)
    slide.notes_slide.notes_text_frame.text = notes[i - 1]

prs.save(OUT)
print("saved:", OUT, os.path.getsize(OUT) // 1024, "KB,", len(prs.slides.slides if hasattr(prs.slides,'slides') else prs.slides._sldIdLst), "slides")
