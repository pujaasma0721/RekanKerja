// RekanKerja — TEMPLATE EMAIL DEFAULT (Task 34) =========================
// Sumber tunggal template default (self-heal GET /api/rekankerja/email-templates).
// Duplikat sengaja dari scripts/migrate-email-config.ts (skrip berjalan
// standalone tanpa alias @/) — bila mengubah satu, ubah keduanya.
// =====================================================================
export interface EmailTemplateDefault {
  event: string;
  label: string;
  notifyEmployee: boolean;
  notifyApprover: boolean;
  notifyHrd: boolean;
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES_PLACEHOLDER: EmailTemplateDefault[] = [
  {
    event: "leave.submitted", label: "Cuti — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Cuti {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan cuti {{jenisCuti}} ({{docNo}}):\n- Periode: {{periode}}\n- Jumlah hari: {{jumlahHari}}\n- Alasan: {{alasan}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "leave.approved", label: "Cuti — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Permintaan Cuti {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan cuti Anda ({{docNo}}) telah DISSETUJUI.\n- Jenis: {{jenisCuti}}\n- Periode: {{periode}}\n- Jumlah hari: {{jumlahHari}}\n- Catatan approver: {{catatan}}\n\nSelamat beristirahat!\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "leave.rejected", label: "Cuti — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Cuti {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan cuti Anda ({{docNo}}) DITOLAK.\n- Jenis: {{jenisCuti}}\n- Periode: {{periode}}\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD atau ajukan kembali bila diperlukan.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.submitted", label: "Travel — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Perjalanan Dinas {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan perjalanan dinas ({{docNo}}):\n- Tujuan: {{tujuan}}\n- Periode: {{periode}}\n- Estimasi biaya: {{biaya}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.approved", label: "Travel — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Travel {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan perjalanan dinas Anda ({{docNo}}) telah DISSETUJUI.\n- Tujuan: {{tujuan}}\n- Periode: {{periode}}\n- Catatan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.rejected", label: "Travel — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Travel {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan perjalanan dinas Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.submitted", label: "Klaim Travel — Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Klaim Settlement {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan klaim settlement perjalanan ({{docNo}}):\n- Total klaim: {{jumlah}}\n- Periode: {{periode}}\n\nSilakan buka RekanKerja HRIS untuk memproses klaim ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.approved", label: "Klaim Travel — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Settlement {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nKlaim settlement Anda ({{docNo}}) telah DISSETUJUI — total {{jumlah}}.\nPembayaran akan diproses sesuai metode settlement.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "travel.claim.rejected", label: "Klaim Travel — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Settlement {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, klaim settlement Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // P1.5-BM (D-BM14) — pengingat settlement travel (scheduler D+N lewat
  // settlementDay; kirim ke pelaku perjalanan + atasan langsung).
  {
    event: "travel.settlement.reminder", label: "Travel — Pengingat Settlement", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "[Pengingat] Settlement travel {{docNo}} lewat {{hariTerlambat}} hari",
    body: "Halo {{nama}},\n\nPerjalanan dinas Anda ({{docNo}}) telah selesai, namun klaim & settlement belum diajukan:\n- Batas pengajuan: {{batasHari}} hari setelah kembali\n- Telah terlambat: {{hariTerlambat}} hari\n\nMohon segera ajukan klaim & settlement di modul Travel (Klaim & Settlement) agar reimbursement/kekurangan uang muka dapat diproses. Pengingat ini juga dikirim ke atasan langsung Anda.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.submitted", label: "Klaim Medis — Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Klaim Medis {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan klaim medis ({{docNo}}):\n- Jenis benefit: {{jenis}}\n- Total klaim: {{jumlah}}\n\nSilakan buka RekanKerja HRIS untuk memproses klaim ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.approved", label: "Klaim Medis — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nKlaim medis Anda ({{docNo}}) telah DISSETUJUI — total {{jumlah}}.\nSettlement akan diproses oleh tim HR/Medical.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.rejected", label: "Klaim Medis — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, klaim medis Anda ({{docNo}}) DITOLAK.\n- Alasan: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "medical.claim.settled", label: "Klaim Medis — Settled", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Klaim Medis {{docNo}} telah Dibayarkan",
    body: "Halo {{nama}},\n\nKlaim medis Anda ({{docNo}}) telah diselesaikan & dibayarkan — total {{jumlah}}.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.run.confirmed", label: "Payroll — Run Dikonfirmasi", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "Run Payroll {{runNo}} FINAL ({{jumlah}} karyawan, total {{total}})",
    body: "Run payroll {{runNo}} periode {{periode}} telah dikonfirmasi:\n- Karyawan: {{jumlah}}\n- Total bruto: {{total}}\n- Jurnal telah diposting.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.run.paid", label: "Payroll — Run Ditandai Dibayar", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "Run Payroll {{runNo}} DIBAYARKAN",
    body: "Run payroll {{runNo}} periode {{periode}} telah ditandai dibayarkan (total {{total}}).\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "payroll.payslip", label: "Payroll — Slip Gaji (Lampiran PDF)", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Slip Gaji {{periode}} — {{nama}}",
    body: "Halo {{nama}},\n\nSlip gaji Anda untuk periode {{periode}} telah diterbitkan (run {{runNo}}).\n- Take Home Pay: {{net}}\n- Rincian lengkap terlampir dalam email ini (PDF).\n\nSlip gaji bersifat RAHASIA — mohon tidak diteruskan.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.submitted", label: "Personnel Action — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Personnel Action {{docNo}} — {{nama}} ({{jenisAksi}})",
    body: "Halo {{approver}},\n\n{{nama}} mengajukan Personnel Action {{jenisAksi}} ({{docNo}}):\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan: {{alasan}}\n- Menunggu persetujuan: {{layer}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.approved", label: "Personnel Action — Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) DISSETUJUI",
    body: "Halo {{nama}},\n\nPengajuan Personnel Action {{jenisAksi}} ({{docNo}}) telah DISSETUJUI.\n- Tanggal efektif: {{tanggalEfektif}}\n- Catatan approver: {{catatan}}\n\nPerubahan akan diterapkan setelah dokumen diproses oleh tim HR.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.rejected", label: "Personnel Action — Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, pengajuan Personnel Action {{jenisAksi}} ({{docNo}}) DITOLAK.\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD untuk informasi lebih lanjut atau ajukan kembali bila diperlukan.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "pa.processed", label: "Personnel Action — Diproses", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Personnel Action {{docNo}} ({{jenisAksi}}) TELAH DIPROSES",
    body: "Halo {{nama}},\n\nPersonnel Action {{jenisAksi}} ({{docNo}}) telah DIPROSES dan perubahan sudah diterapkan pada data kepegawaian Anda.\n- Tanggal efektif: {{tanggalEfektif}}\n- Alasan: {{alasan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // F1-REC — modul Rekrutmen: notifikasi PR (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F1)
  {
    event: "recruitment.pr.submitted", label: "Rekrutmen — PR Diajukan", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Permintaan Karyawan {{docNo}} — {{posisi}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan permintaan karyawan ({{docNo}}):\n- Posisi: {{posisi}}\n- Jumlah kebutuhan: {{jumlahOrang}} orang\n- Status kerja: {{statusKerja}}\n- Alasan: {{alasan}}\n\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.pr.approved", label: "Rekrutmen — PR Disetujui", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Permintaan Karyawan {{docNo}} DISSETUJUI",
    body: "Halo {{nama}},\n\nPermintaan karyawan Anda ({{docNo}} — {{posisi}}, {{jumlahOrang}} orang) telah DISSETUJUI dan siap diproses tim rekrutmen.\n- Catatan approver: {{catatan}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.pr.rejected", label: "Rekrutmen — PR Ditolak", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "Permintaan Karyawan {{docNo}} DITOLAK",
    body: "Halo {{nama}},\n\nMohon maaf, permintaan karyawan Anda ({{docNo}} — {{posisi}}) DITOLAK.\n- Alasan penolakan: {{catatan}}\n\nSilakan hubungi HRD atau menduplikasi PR bila ingin mengajukan kembali dengan penyesuaian.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // F3-REC — modul Rekrutmen: seleksi (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F3)
  {
    event: "recruitment.selection.scheduled", label: "Rekrutmen — Tahap Seleksi Dijadwalkan", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Jadwal Baru] {{tahap}} — {{kandidat}} ({{docNo}})",
    body: "Halo {{nama}},\n\nTahap seleksi berikut telah dijadwalkan dan ditugaskan kepada Anda:\n- Kandidat: {{kandidat}}\n- Permintaan: {{docNo}} ({{posisi}})\n- Tahap: {{tahap}} (ke-{{urutan}} dari {{totalTahap}})\n- Jadwal: {{jadwal}}\n- Batas SLA: {{batasSla}}\n- Link meeting: {{linkMeeting}}\n\nSurat undangan kandidat dapat diterbitkan dari modul Rekrutmen > Kandidat & Seleksi.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.selection.reminder", label: "Rekrutmen — Pengingat Tahap Seleksi", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat] {{tahap}} {{kandidat}} — {{statusSla}}",
    body: "Halo {{nama}},\n\nPengingat tahap seleksi yang menjadi tanggung jawab Anda:\n- Kandidat: {{kandidat}}\n- Permintaan: {{docNo}} ({{posisi}})\n- Tahap: {{tahap}}\n- Jadwal: {{jadwal}}\n- Batas SLA: {{batasSla}} ({{statusSla}})\n- Link meeting: {{linkMeeting}}\n\nMohon segera tindak lanjuti penilaian/hasil tahap ini melalui modul Rekrutmen > Kandidat & Seleksi.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // F4-REC — modul Rekrutmen: offer & pengangkatan (DEVELOPMENT-PLAN-RECRUITMENT.md §7 F4)
  {
    event: "recruitment.offer.sent", label: "Rekrutmen — Offer Dikirim", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Surat Penawaran Kerja {{docNo}} — {{posisi}}",
    body: "Halo {{nama}},\n\nPenawaran kerja berikut telah diterbitkan:\n- Nomor offer: {{docNo}}\n- Posisi: {{posisi}}\n- Perusahaan: {{perusahaan}}\n- Penghasilan: {{gaji}}\n- Mulai bekerja: {{mulaiKerja}}\n- Berlaku sampai: {{berlakuSampai}}\n\nSurat penawaran resmi (PDF) dapat diperoleh dari petugas rekrutmen. Mohon konfirmasi penerimaan sebelum batas waktu.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.offer.reminder", label: "Rekrutmen — Pengingat Offer", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat] Offer {{docNo}} kandidat {{kandidat}} berakhir {{berlakuSampai}}",
    body: "Halo {{nama}},\n\nPengingat offer yang belum direspons kandidat:\n- Nomor offer: {{docNo}}\n- Kandidat: {{kandidat}}\n- Posisi: {{posisi}}\n- Status offer: {{statusOffer}}\n- Berlaku sampai: {{berlakuSampai}} ({{sisaHari}})\n\nMohon tindak lanjut respons kandidat melalui modul Rekrutmen > Offer & Pengangkatan.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.offer.responded", label: "Rekrutmen — Respons Offer Kandidat", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Offer {{docNo}} {{statusOffer}} — {{kandidat}}",
    body: "Halo {{nama}},\n\nKandidat telah merespons penawaran:\n- Nomor offer: {{docNo}}\n- Kandidat: {{kandidat}}\n- Posisi: {{posisi}}\n- Status: {{statusOffer}}\n- Catatan: {{catatan}}\n\nBila diterima, lanjutkan proses pengangkatan melalui modul Rekrutmen > Offer & Pengangkatan.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.appointment.hired", label: "Rekrutmen — Kandidat Resmi Karyawan", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Onboarding] {{kandidat}} resmi karyawan {{employeeNo}}",
    body: "Halo {{nama}},\n\nKandidat berikut telah melanjutkan ke onboarding dan resmi menjadi karyawan:\n- Kandidat: {{kandidat}}\n- Nomor karyawan: {{employeeNo}}\n- Posisi: {{posisi}}\n- Referensi offer: {{docNo}}\n\nProses onboarding (checklist per bagian) telah dibuat otomatis.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // F7-REC — otomasi & integrasi: auto-reply lamaran, OTP e-sign, digest
  {
    event: "recruitment.application.received", label: "Rekrutmen — Konfirmasi Lamaran Diterima", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "Lamaran Anda telah kami terima",
    body: "Halo {{nama}},\n\nTerima kasih telah melamar di {{perusahaan}}.\n- Posisi: {{posisi}}\n- Tanggal diterima: {{tanggal}}\n\nTim rekrutmen akan meninjau lamaran Anda dan menghubungi kandidat yang memenuhi kualifikasi. Anda tidak perlu membalas email ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.esign.otp", label: "Rekrutmen — Kode OTP Tanda Tangan Kandidat", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "Kode verifikasi tanda tangan elektronik — {{offerNo}}",
    body: "Halo {{nama}},\n\nAnda diminta menandatangani surat secara elektronik.\n\nKode verifikasi Anda:\n\n{{otp}}\n\nBerlaku 5 menit. Buka tautan berikut lalu masukkan kode dan ketik nama Anda persis:\n{{link}}\n\nReferensi: {{offerNo}}\n\nJangan bagikan kode ini kepada siapa pun.\n\n---\nEmail otomatis RekanKerja HRIS.",
  },
  {
    event: "recruitment.digest", label: "Rekrutmen — Ringkasan Notifikasi Harian", notifyEmployee: true, notifyApprover: false, notifyHrd: false,
    subject: "[Ringkasan] {{jumlah}} notifikasi belum dibaca",
    body: "Halo {{nama}},\n\nAnda memiliki {{jumlah}} notifikasi belum dibaca dalam 24 jam terakhir:\n\n{{ringkasan}}\n\nBuka RekanKerja HRIS untuk melihat seluruh notifikasi Anda.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // B7-BL — magic-link cek status lamaran portal pelamar (tanpa password)
  {
    event: "recruitment.status.link", label: "Rekrutmen — Tautan Cek Status Lamaran (→ Pelamar)", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "Tautan cek status lamaran Anda",
    body: "Halo {{nama}},\n\nAnda meminta tautan untuk melihat status lamaran Anda.\n\nBuka tautan berikut di portal karier kami:\n{{link}}\n\nTautan ini berlaku sampai {{berlaku}} dan hanya dapat digunakan satu kali. Bila tautan sudah kedaluwarsa atau pernah digunakan, Anda dapat meminta tautan baru di halaman portal.\n\nAnda tidak perlu membalas email ini.\n\n---\nEmail otomatis RekanKerja HRIS.",
  },
  // P2.3-BM (D-BM18) — panel interview: undangan kandidat pilih slot sendiri
  {
    event: "recruitment.interview.invite", label: "Rekrutmen — Undangan Pilih Jadwal Wawancara (→ Kandidat)", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "Undangan wawancara — {{posisi}} ({{kandidat}})",
    body: "Halo {{kandidat}},\n\nAnda diundang mengikuti tahap {{tahap}} untuk posisi {{posisi}} ({{docNo}}).\n\nSilakan pilih sendiri jadwal wawancara Anda melalui tautan berikut sebelum {{berlaku}}:\n{{linkJadwal}}\n\nUndangan kalender (.ics) akan dikirim setelah jadwal Anda terkunci.\n\n---\nEmail otomatis RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "recruitment.interview.booked", label: "Rekrutmen — Jadwal Wawancara Terkunci (→ Kandidat, lampiran .ics)", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "Jadwal wawancara Anda terkunci — {{posisi}}",
    body: "Halo {{kandidat}},\n\nJadwal wawancara Anda telah terkunci:\n- Posisi: {{posisi}} ({{docNo}})\n- Tahap: {{tahap}}\n- Jadwal: {{jadwal}}\n- Link meeting: {{linkMeeting}}\n\nUndangan kalender (.ics) terlampir pada email ini.\n\n---\nEmail otomatis RekanKerja HRIS — tidak perlu dibalas.",
  },
  // P2.4-BM (D-BM19) — tautan putusan offer mandiri (kandidat accept/decline sendiri)
  {
    event: "recruitment.offer.selfservice", label: "Rekrutmen — Tautan Putusan Offer Mandiri (→ Kandidat)", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "Putuskan penawaran kerja {{docNo}} — {{posisi}}",
    body: "Halo {{kandidat}},\n\nAnda dapat menerima atau menolak penawaran kerja {{docNo}} (posisi {{posisi}}) secara mandiri melalui tautan berikut sebelum {{berlakuSampai}}:\n{{portalLink}}\n\nTautan ini khusus untuk Anda — mohon tidak diteruskan.\n\n---\nEmail otomatis RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "user.created", label: "Pengguna Baru Dibuat", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "Akun RekanKerja HRIS Anda telah dibuat",
    body: "Halo {{nama}},\n\nAkun Anda untuk aplikasi RekanKerja HRIS telah dibuat:\n- Email login: {{email}}\n- Kata sandi sementara: {{password}}\n\nSegera login dan ganti kata sandi Anda. Kata sandi sementara hanya ditampilkan sekali.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "overtime.submitted", label: "Lembur — Pengajuan Baru", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[Perlu Persetujuan] Perintah Lembur {{docNo}} — {{nama}}",
    body: "Halo Approver,\n\n{{nama}} mengajukan perintah lembur ({{docNo}}):\n- Tanggal: {{tanggal}}\n- Rencana jam: {{jumlahJam}} jam\n- Alasan: {{alasan}}\n\nMaksimal lembur 4 jam/hari sesuai PP 35/2021.\nSilakan buka RekanKerja HRIS untuk menyetujui atau menolak pengajuan ini.\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  // ============ T14-SCHED: template pengingat scheduler latar belakang ============
  {
    event: "scheduler.contract-expiry", label: "Scheduler — Kontrak/Probation Segera Berakhir", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat Scheduler] {{jenis}} {{nama}} ({{employeeNo}}) berakhir {{date}}",
    body: "Halo Tim HR,\n\nPengingat otomatis scheduler RekanKerja:\n- Karyawan: {{nama}} ({{employeeNo}})\n- Jenis: {{jenis}}\n- Tanggal berakhir: {{date}}\n- Sisa waktu: {{days}} hari\n\nMohon tindak lanjut perpanjangan kontrak / evaluasi probation karyawan ini.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.doc-expiry", label: "Scheduler — Dokumen Karyawan Kedaluwarsa", notifyEmployee: true, notifyApprover: false, notifyHrd: true,
    subject: "[Pengingat Scheduler] Dokumen {{docType}} {{nama}} kedaluwarsa {{date}}",
    body: "Halo,\n\nDokumen karyawan berikut akan segera / telah kedaluwarsa:\n- Karyawan: {{nama}} ({{employeeNo}})\n- Dokumen: {{docType}} {{docNo}}\n- Tanggal kedaluwarsa: {{date}}\n- Sisa waktu: {{days}} hari\n\nMohon pembaruan dokumen sebelum tanggal tersebut.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.approval-sla", label: "Scheduler — Persetujuan Melewati SLA", notifyEmployee: false, notifyApprover: true, notifyHrd: false,
    subject: "[SLA] {{jenis}} {{docNo}} menunggu {{days}} hari",
    body: "Halo {{approver}},\n\nPersetujuan berikut menunggu lebih dari 3 hari (SLA terlampaui):\n- Dokumen: {{jenis}} {{docNo}}\n- Pemohon: {{nama}}\n- Jenjang menunggu: {{layer}}\n- Lama menunggu: {{days}} hari\n\nMohon tindak lanjut segera di RekanKerja HRIS.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "scheduler.payroll-reminder", label: "Scheduler — Payroll D-3", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[D-{{days}}] Payroll periode {{periode}} gajian {{date}}",
    body: "Halo Tim HR,\n\nPeriode payroll {{periode}} ({{code}}) dijadwalkan gajian pada {{date}} — {{days}} hari lagi — dan belum ada run yang dikonfirmasi.\n\nMohon mulai proses payroll agar pembayaran tepat waktu.\n\n---\nEmail otomatis scheduler RekanKerja HRIS — tidak perlu dibalas.",
  },
  // ============ Task 65: checklist onboarding/offboarding per bagian ============
  {
    event: "onboarding.checklist", label: "Onboarding — Checklist Bagian Baru", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "[Checklist Onboarding] Tugas bagian {{bagian}} untuk {{nama}} ({{employeeNo}})",
    body: "Halo Tim {{bagian}},\n\nKaryawan baru berikut memerlukan penyiapan dari bagian Anda:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n- Mulai kerja: {{tanggal}}\n\nTugas bagian {{bagian}}:\n{{daftarTugas}}\n\nCentang status tugas Anda melalui tautan berikut (tanpa login, khusus bagian {{bagian}}):\n{{link}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "onboarding.completed", label: "Onboarding — Checklist Selesai", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Selesai] Checklist onboarding {{nama}} ({{employeeNo}})",
    body: "Halo Tim HR,\n\nSeluruh checklist onboarding untuk karyawan berikut telah selesai:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "offboarding.checklist", label: "Offboarding — Checklist Bagian Baru", notifyEmployee: false, notifyApprover: false, notifyHrd: false,
    subject: "[Checklist Offboarding] Tugas bagian {{bagian}} untuk {{nama}} ({{employeeNo}})",
    body: "Halo Tim {{bagian}},\n\nKaryawan berikut akan keluar dan memerlukan clearance dari bagian Anda:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n- Hari terakhir: {{tanggal}}\n\nTugas bagian {{bagian}}:\n{{daftarTugas}}\n\nCentang status clearance Anda melalui tautan berikut (tanpa login, khusus bagian {{bagian}}):\n{{link}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
  {
    event: "offboarding.completed", label: "Offboarding — Checklist Selesai", notifyEmployee: false, notifyApprover: false, notifyHrd: true,
    subject: "[Selesai] Checklist offboarding {{nama}} ({{employeeNo}})",
    body: "Halo Tim HR,\n\nSeluruh checklist offboarding/clearance untuk karyawan berikut telah tuntas:\n- Nama: {{nama}} ({{employeeNo}})\n- Posisi: {{posisi}}\n- Unit: {{unit}}\n\n---\nEmail otomatis sistem RekanKerja HRIS — tidak perlu dibalas.",
  },
];

/** Label tampil untuk sebuah event (UI). */
export function templateLabelOf(event: string): string {
  return DEFAULT_TEMPLATES_PLACEHOLDER.find((t) => t.event === event)?.label ?? event;
}

// KATALOG PLACEHOLDER PER-EVENT =========================================
// Sumber kebenaran variabel {{...}} yang BENAR-BENAR dikirim hook tiap
// event (disalin dari pemanggilan notifyEmailEvent di API leave/travel/
// medical/payroll/app-users). Dipakai UI editor template: chip klik-untuk-
// sisipkan + preview langsung dengan nilai contoh. Placeholder tak
// terdaftar tetap boleh dipakai — dirender apa adanya saat kirim.
export interface PlaceholderDef { key: string; label: string; contoh: string }

const PH_NAMA: PlaceholderDef = { key: "nama", label: "Nama karyawan pengaju", contoh: "Hartono Wijaksono" };
const PH_DOC: PlaceholderDef = { key: "docNo", label: "Nomor dokumen", contoh: "LR-2026-010" };
const PH_PERIODE: PlaceholderDef = { key: "periode", label: "Periode / rentang tanggal", contoh: "2026-10-12 → 2026-10-13" };
const PH_CATATAN: PlaceholderDef = { key: "catatan", label: "Catatan approver saat keputusan", contoh: "Disetujui, selamat beristirahat" };
const PH_JENISCUTI: PlaceholderDef = { key: "jenisCuti", label: "Nama jenis cuti", contoh: "Cuti Tahunan" };
const PH_JUMLAHHARI: PlaceholderDef = { key: "jumlahHari", label: "Jumlah hari kerja (cuti)", contoh: "2" };
const PH_ALASAN: PlaceholderDef = { key: "alasan", label: "Alasan pengajuan (cuti)", contoh: "Acara keluarga" };
const PH_TUJUAN: PlaceholderDef = { key: "tujuan", label: "Kota tujuan perjalanan", contoh: "Surabaya, Jakarta" };
const PH_BIAYA: PlaceholderDef = { key: "biaya", label: "Estimasi biaya / uang muka", contoh: "Rp 5.000.000" };
const PH_JENIS: PlaceholderDef = { key: "jenis", label: "Jenis benefit medis", contoh: "Rawat Jalan" };
const PH_JUMLAH: PlaceholderDef = { key: "jumlah", label: "Jumlah klaim (Rp)", contoh: "Rp 1.250.000" };
const PH_RUNNO: PlaceholderDef = { key: "runNo", label: "Nomor run payroll", contoh: "PR-2026-09-001" };
const PH_JENISAKSI: PlaceholderDef = { key: "jenisAksi", label: "Jenis aksi Personnel Action", contoh: "Promosi" };
const PH_TGEFF: PlaceholderDef = { key: "tanggalEfektif", label: "Tanggal efektif aksi", contoh: "2026-10-01" };
const PH_LAYER: PlaceholderDef = { key: "layer", label: "Jenjang/layer persetujuan", contoh: "HR Manager" };
const PH_APPROVER: PlaceholderDef = { key: "approver", label: "Nama approver yang dituju", contoh: "Tri Handayani" };
const PH_TOTAL: PlaceholderDef = { key: "total", label: "Total bruto (Rp)", contoh: "Rp 412.500.000" };
const PH_NET: PlaceholderDef = { key: "net", label: "Take Home Pay (Rp)", contoh: "Rp 23.678.526" };
// T14-SCHED: placeholder template pengingat scheduler
const PH_EMPNO: PlaceholderDef = { key: "employeeNo", label: "Nomor karyawan", contoh: "MII00007" };
const PH_DATE: PlaceholderDef = { key: "date", label: "Tanggal berakhir / kedaluwarsa / gajian", contoh: "2026-10-06" };
const PH_DAYS: PlaceholderDef = { key: "days", label: "Jumlah hari (sisa waktu / lama menunggu)", contoh: "30" };
const PH_JENIS_SCHED: PlaceholderDef = { key: "jenis", label: "Jenis pengingat (Kontrak/Probation)", contoh: "Kontrak" };
const PH_DOCTYPE: PlaceholderDef = { key: "docType", label: "Jenis dokumen karyawan", contoh: "Paspor" };
const PH_CODE: PlaceholderDef = { key: "code", label: "Kode periode payroll", contoh: "2026-10" };
// T15-CHAIN-EXT: placeholder template lembur
const PH_TANGGAL: PlaceholderDef = { key: "tanggal", label: "Tanggal lembur", contoh: "2026-09-03" };
const PH_JUMLAHJAM: PlaceholderDef = { key: "jumlahJam", label: "Rencana jam lembur", contoh: "3" };
// F1-REC — placeholder template notifikasi PR rekrutmen
const PH_POSISI: PlaceholderDef = { key: "posisi", label: "Posisi yang diminta", contoh: "Staff Accounting" };
const PH_JUMLAHORANG: PlaceholderDef = { key: "jumlahOrang", label: "Jumlah kebutuhan (orang)", contoh: "2" };
const PH_STATUSKERJA: PlaceholderDef = { key: "statusKerja", label: "Status kerja", contoh: "Tetap (Permanent)" };
// F3-REC — placeholder template seleksi
const PH_KANDIDAT: PlaceholderDef = { key: "kandidat", label: "Nama kandidat", contoh: "Gita Savitri" };
const PH_TAHAP: PlaceholderDef = { key: "tahap", label: "Nama tahap seleksi", contoh: "Interview HR" };
const PH_URUTAN: PlaceholderDef = { key: "urutan", label: "Urutan tahap", contoh: "2" };
const PH_TOTALTAHAP: PlaceholderDef = { key: "totalTahap", label: "Total tahap seleksi", contoh: "5" };
const PH_JADWAL: PlaceholderDef = { key: "jadwal", label: "Jadwal pelaksanaan tahap", contoh: "2026-10-20 09:00" };
const PH_BATASSLA: PlaceholderDef = { key: "batasSla", label: "Batas SLA tahap", contoh: "2026-11-19" };
const PH_STATUSSLA: PlaceholderDef = { key: "statusSla", label: "Status SLA", contoh: "3 hari lagi / TERLAMBAT 5 hari" };
// B6-BL — link meeting video-call tahap seleksi (kompromi micro §1)
const PH_LINKMEETING: PlaceholderDef = { key: "linkMeeting", label: "Tautan meeting video-call (opsional)", contoh: "https://meet.google.com/abc-defg-hij" };
// F4-REC — placeholder template offer & pengangkatan
const PH_PERUSAHAAN: PlaceholderDef = { key: "perusahaan", label: "Nama perusahaan", contoh: "PT Mitra Industri Internasional" };
const PH_GAJI: PlaceholderDef = { key: "gaji", label: "Gaji final offer (Rp)", contoh: "Rp 8.500.000" };
const PH_MULAIKERJA: PlaceholderDef = { key: "mulaiKerja", label: "Tanggal mulai bekerja", contoh: "2026-11-01" };
const PH_BERLAKUSAMPAI: PlaceholderDef = { key: "berlakuSampai", label: "Batas offer berlaku", contoh: "2026-10-24" };
const PH_STATUSOFFER: PlaceholderDef = { key: "statusOffer", label: "Status offer", contoh: "DITERIMA / DITOLAK / Sent" };
const PH_SISAHARI: PlaceholderDef = { key: "sisaHari", label: "Sisa waktu offer", contoh: "2 hari lagi" };
const PH_EMPLOYEE_NO: PlaceholderDef = { key: "employeeNo", label: "Nomor karyawan hasil rekrutmen", contoh: "MII00041" };
// P1.5-BM (D-BM14) — placeholder pengingat settlement travel
const PH_BATASHARI: PlaceholderDef = { key: "batasHari", label: "Batas hari settlement (template travel)", contoh: "14" };
const PH_HARITERLAMBAT: PlaceholderDef = { key: "hariTerlambat", label: "Hari keterlambatan settlement", contoh: "3" };
// P2.3-BM (D-BM18) — panel interview + self-schedule + .ics
const PH_PORTALJADWAL: PlaceholderDef = { key: "linkJadwal", label: "Tautan pilih jadwal wawancara (portal kandidat)", contoh: "http://…/jadwal/<token>" };
// P2.4-BM (D-BM19) — putusan offer mandiri (portal kandidat)
const PH_PORTALLINK: PlaceholderDef = { key: "portalLink", label: "Tautan putusan offer mandiri (portal kandidat)", contoh: "http://…/offer/<token>" };

export const EVENT_PLACEHOLDERS: Record<string, PlaceholderDef[]> = {
  "leave.submitted": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_JUMLAHHARI, PH_ALASAN],
  "leave.approved": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_JUMLAHHARI, PH_CATATAN],
  "leave.rejected": [PH_NAMA, PH_DOC, PH_JENISCUTI, PH_PERIODE, PH_CATATAN],
  "travel.submitted": [PH_NAMA, PH_DOC, PH_TUJUAN, PH_PERIODE, PH_BIAYA],
  "travel.approved": [PH_NAMA, PH_DOC, PH_TUJUAN, PH_PERIODE, PH_CATATAN],
  "travel.rejected": [PH_NAMA, PH_DOC, PH_TUJUAN, PH_PERIODE, PH_CATATAN],
  "travel.claim.submitted": [PH_NAMA, PH_DOC, PH_JUMLAH, PH_PERIODE],
  "travel.claim.approved": [PH_NAMA, PH_DOC, PH_JUMLAH, PH_PERIODE, PH_CATATAN],
  "travel.claim.rejected": [PH_NAMA, PH_DOC, PH_JUMLAH, PH_PERIODE, PH_CATATAN],
  "travel.settlement.reminder": [PH_NAMA, PH_DOC, PH_BATASHARI, PH_HARITERLAMBAT],
  "overtime.submitted": [PH_NAMA, PH_DOC, PH_TANGGAL, PH_JUMLAHJAM, PH_ALASAN],
  "medical.claim.submitted": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH],
  "medical.claim.approved": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH, PH_CATATAN],
  "medical.claim.rejected": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH, PH_CATATAN],
  "medical.claim.settled": [PH_NAMA, PH_DOC, PH_JENIS, PH_JUMLAH, PH_CATATAN],
  "payroll.run.confirmed": [PH_RUNNO, PH_PERIODE, { ...PH_JUMLAH, label: "Jumlah karyawan dalam run", contoh: "44" }, PH_TOTAL],
  "payroll.run.paid": [PH_RUNNO, PH_PERIODE, PH_TOTAL],
  "payroll.payslip": [PH_NAMA, { ...PH_PERIODE, label: "Nama periode slip gaji", contoh: "AGUSTUS 2026" }, PH_NET, PH_RUNNO],
  "pa.submitted": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_ALASAN, PH_LAYER, PH_APPROVER],
  "pa.approved": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_CATATAN],
  "pa.rejected": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_CATATAN],
  "pa.processed": [PH_NAMA, PH_DOC, PH_JENISAKSI, PH_TGEFF, PH_ALASAN],
  "recruitment.pr.submitted": [PH_NAMA, PH_DOC, PH_POSISI, PH_JUMLAHORANG, PH_STATUSKERJA, PH_ALASAN],
  "recruitment.pr.approved": [PH_NAMA, PH_DOC, PH_POSISI, PH_JUMLAHORANG, PH_CATATAN],
  "recruitment.pr.rejected": [PH_NAMA, PH_DOC, PH_POSISI, PH_CATATAN],
  "recruitment.selection.scheduled": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_TAHAP, PH_URUTAN, PH_TOTALTAHAP, PH_JADWAL, PH_BATASSLA, PH_LINKMEETING],
  "recruitment.selection.reminder": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_TAHAP, PH_JADWAL, PH_BATASSLA, PH_STATUSSLA, PH_LINKMEETING],
  "recruitment.offer.sent": [PH_NAMA, PH_DOC, PH_POSISI, PH_PERUSAHAAN, PH_GAJI, PH_MULAIKERJA, PH_BERLAKUSAMPAI],
  "recruitment.offer.reminder": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_STATUSOFFER, PH_BERLAKUSAMPAI, PH_SISAHARI],
  "recruitment.offer.responded": [PH_NAMA, PH_DOC, PH_POSISI, PH_KANDIDAT, PH_STATUSOFFER, PH_CATATAN],
  "recruitment.appointment.hired": [PH_NAMA, PH_KANDIDAT, PH_EMPLOYEE_NO, PH_POSISI, PH_DOC],
  // F7-REC — placeholder template otomasi rekrutmen
  "recruitment.application.received": [
    { ...PH_NAMA, label: "Nama kandidat pelamar", contoh: "Fajar Nugraha" },
    PH_POSISI,
    PH_PERUSAHAAN,
    { key: "tanggal", label: "Tanggal lamaran diterima", contoh: "2026-10-20" },
  ],
  "recruitment.esign.otp": [
    { ...PH_NAMA, label: "Nama kandidat penandatangan", contoh: "Rina Amelia" },
    { key: "otp", label: "Kode OTP 6 digit", contoh: "482913" },
    { key: "link", label: "Tautan tanda tangan portal kandidat", contoh: "http://…/sign/<token>" },
    { ...PH_DOC, label: "Nomor offer referensi", contoh: "OFF-2026-0001" },
  ],
  "recruitment.digest": [
    PH_NAMA,
    { key: "jumlah", label: "Jumlah notifikasi belum dibaca", contoh: "5" },
    { key: "ringkasan", label: "Ringkasan judul notifikasi", contoh: "• Offer OFF-… diterima\n• …" },
  ],
  // B7-BL — magic-link cek status lamaran portal pelamar (tanpa password)
  "recruitment.status.link": [
    { ...PH_NAMA, label: "Nama pelamar penerima tautan", contoh: "Fajar Nugraha" },
    { key: "link", label: "Tautan cek status portal kandidat", contoh: "http://…/status/<token>" },
    { key: "berlaku", label: "Batas berlaku tautan (6 jam, sekali pakai)", contoh: "21 Okt 2026, 15.30 WIB" },
  ],
  // P2.3-BM (D-BM18) — panel interview + self-schedule + .ics
  "recruitment.interview.invite": [
    PH_KANDIDAT,
    PH_POSISI,
    PH_DOC,
    PH_TAHAP,
    PH_PORTALJADWAL,
    { key: "berlaku", label: "Batas berlaku tautan jadwal", contoh: "28 Okt 2026, 17.00 WIB" },
  ],
  "recruitment.interview.booked": [PH_KANDIDAT, PH_POSISI, PH_DOC, PH_TAHAP, PH_JADWAL, PH_LINKMEETING],
  // P2.4-BM (D-BM19) — putusan offer mandiri
  "recruitment.offer.selfservice": [PH_KANDIDAT, PH_DOC, PH_POSISI, PH_PORTALLINK, PH_BERLAKUSAMPAI],
  "user.created": [
    { key: "nama", label: "Nama pengguna baru", contoh: "Tri Handayani" },
    { key: "email", label: "Email login akun baru", contoh: "tri@mii.co.id" },
    { key: "password", label: "Kata sandi sementara (sekali tampil)", contoh: "Rekankerja!2026" },
  ],
  // T14-SCHED: katalog placeholder template pengingat scheduler
  "scheduler.contract-expiry": [PH_NAMA, PH_EMPNO, PH_JENIS_SCHED, PH_DATE, PH_DAYS],
  "scheduler.doc-expiry": [PH_NAMA, PH_EMPNO, PH_DOCTYPE, PH_DOC, PH_DATE, PH_DAYS],
  "scheduler.approval-sla": [PH_DOC, { ...PH_JENIS_SCHED, label: "Jenis dokumen (Cuti/Travel/dsb)", contoh: "Cuti" }, PH_NAMA, PH_APPROVER, PH_LAYER, PH_DAYS],
  "scheduler.payroll-reminder": [PH_PERIODE, PH_CODE, PH_DATE, PH_DAYS],
  // Task 65 — checklist onboarding/offboarding per bagian
  "onboarding.checklist": [
    { key: "bagian", label: "Bagian penerima (IT/GA/dll.)", contoh: "IT" },
    PH_NAMA,
    { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" },
    { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" },
    { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" },
    { key: "tanggal", label: "Tanggal mulai / hari terakhir", contoh: "2026-09-20" },
    { key: "daftarTugas", label: "Daftar tugas bagian", contoh: "1. Siapkan user …" },
    { key: "link", label: "Tautan checklist publik", contoh: "https://…/checklist/…" },
  ],
  "onboarding.completed": [PH_NAMA, { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" }, { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" }, { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" }],
  "offboarding.checklist": [
    { key: "bagian", label: "Bagian penerima (IT/GA/dll.)", contoh: "IT" },
    PH_NAMA,
    { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" },
    { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" },
    { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" },
    { key: "tanggal", label: "Tanggal mulai / hari terakhir", contoh: "2026-09-20" },
    { key: "daftarTugas", label: "Daftar tugas bagian", contoh: "1. Nonaktifkan akun …" },
    { key: "link", label: "Tautan checklist publik", contoh: "https://…/checklist/…" },
  ],
  "offboarding.completed": [PH_NAMA, { key: "employeeNo", label: "Nomor karyawan", contoh: "SAYONE00001" }, { key: "posisi", label: "Posisi karyawan", contoh: "Staff GA" }, { key: "unit", label: "Unit organisasi", contoh: "GA & Umum" }],
};

/** Daftar placeholder untuk event (fallback: kosong — contoh config.test sistem). */
export function placeholdersOf(event: string): PlaceholderDef[] {
  return EVENT_PLACEHOLDERS[event] ?? [];
}
