// OneVity — DEFAULT TEMPLATE SURAT ==========================================
// =====================================================================
// Katalog template surat bawaan (Bahasa Indonesia formal) yang di-seed
// ke setiap tenant. Perusahaan dapat MENEDIT isi template lewat menu
// "Template Surat" agar sesuai format surat perusahaan masing-masing —
// default ini hanya titik awal.
//
// Konvensi isi body:
//   · Teks polos, paragraf dipisah baris kosong.
//   · Placeholder ditulis {{token}} — diganti data aktual saat surat
//     diterbitkan (token tidak dikenal / kosong → "—").
//   · Baris pertama umumnya {{letter_no}}, lalu "Perihal:", blok penerima,
//     isi, dan blok tanda tangan ({{city}}, {{letter_date}}, perusahaan,
//     {{signatory_name}}, {{signatory_title}}).
//   · Daftar token yang didukung mesin render: LETTER_PLACEHOLDERS di bawah.
//
// File ini SERVER- dan CLIENT-safe (tanpa import) — dipakai oleh:
//   · scripts/migrate-letters-offboarding.ts (seeding tenant existing)
//   · src/onevity/shared/lib/provisioning.ts (seeding tenant baru)
//   · UI Template Surat (daftar token + tombol "Kembalikan ke bawaan")
// =====================================================================

export type LetterCategory = "Disciplinary" | "PersonnelAction";

export interface LetterTemplateDefault {
  key: string;
  category: LetterCategory;
  name: string;
  description?: string;
  subject?: string;
  body: string;
  signatoryTitle: string;
}

export const LETTER_TEMPLATE_DEFAULTS: LetterTemplateDefault[] = [
  // ---------------- DISIPLINER ----------------
  {
    key: "DISC_VERBAL",
    category: "Disciplinary",
    name: "Surat Teguran",
    description: "Teguran lisan / tingkat pertama sebelum Surat Peringatan tertulis.",
    subject: "Teguran",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Teguran

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan catatan kepegawaian, Saudara tercatat melakukan pelanggaran sebagai berikut:

    {{violation}}

Sehubungan dengan hal tersebut, perusahaan {{company_name}} memberikan teguran agar Saudara segera memperbaiki sikap dan pelaksanaan pekerjaan sesuai ketentuan yang berlaku. Apabila pelanggaran serupa terulang, perusahaan akan memberikan Surat Peringatan tertulis (SP) dengan sanksi yang lebih berat.

Demikian teguran ini disampaikan untuk diperhatikan dan dipatuhi.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "DISC_WRITTEN",
    category: "Disciplinary",
    name: "Surat Peringatan (SP)",
    description: "Surat Peringatan tertulis (SP ke-{{warning_no}}) — berlaku {{validity_months}} bulan.",
    subject: "Surat Peringatan",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Surat Peringatan Ke-{{warning_no}}

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Dengan ini perusahaan {{company_name}} secara resmi memberikan Surat Peringatan Ke-{{warning_no}} ({{warning_level}}) kepada Saudara atas pelanggaran berikut:

    {{violation}}

Sanksi: {{sanction}}

Surat Peringatan ini berlaku selama {{validity_months}} bulan terhitung sejak tanggal diterbitkan, yaitu sampai dengan {{expires_at}}. Apabila dalam masa berlaku Surat Peringatan ini Saudara kembali melakukan pelanggaran, perusahaan dapat memberikan Surat Peringatan tingkat lebih tinggi hingga pemutusan hubungan kerja sesuai Peraturan Perusahaan dan peraturan perundang-undangan yang berlaku.

Demikian surat ini dibuat untuk diperhatikan dan dipatuhi.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "DISC_FINAL",
    category: "Disciplinary",
    name: "Surat Peringatan Terakhir",
    description: "Peringatan terakhir sebelum tindak lanjut pemutusan hubungan kerja.",
    subject: "Surat Peringatan Terakhir",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Surat Peringatan Terakhir

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Dengan ini perusahaan {{company_name}} memberikan Surat Peringatan Terakhir ({{warning_level}}) kepada Saudara atas pelanggaran berikut:

    {{violation}}

Sanksi: {{sanction}}

Surat Peringatan Terakhir ini berlaku selama {{validity_months}} bulan sejak tanggal diterbitkan, yaitu sampai dengan {{expires_at}}. Perusahaan menegaskan bahwa Surat Peringatan Terakhir ini merupakan peringatan terakhir sebelum langkah pemutusan hubungan kerja (PHK). Selama masa berlaku surat ini Saudara tidak menerima kenaikan jabatan maupun penyesuaian remunerasi sesuai ketentuan Peraturan Perusahaan.

Apabila dalam masa berlaku surat ini terjadi pelanggaran kembali, perusahaan akan mengambil langkah pemutusan hubungan kerja sesuai Peraturan Perusahaan dan peraturan perundang-undangan.

Demikian surat ini dibuat untuk diperhatikan dan dipatuhi.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },

  // ---------------- PERSONNEL ACTION ----------------
  {
    key: "PA_HIRE",
    category: "PersonnelAction",
    name: "Surat Penawaran Kerja",
    description: "Offer letter / surat keputusan penerimaan karyawan baru.",
    subject: "Penawaran Kerja",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Penawaran Kerja

Kepada Yth.
Bapak/Ibu {{employee_name}}
{{city}}

Berdasarkan hasil proses seleksi yang telah Saudara ikuti, dengan ini perusahaan {{company_name}} menawarkan Saudara untuk bergabung sebagai:

    Jabatan      : {{new_position}}
    Unit Kerja   : {{new_org_unit}}
    Grade        : {{new_grade}}
    Status       : {{new_status}}
    Mulai Kerja  : {{effective_date}}

Remunerasi dan ketentuan lainnya mengikuti kontrak/pakta kerja yang akan diterbitkan bersamaan dengan surat ini. Sesuai ketentuan yang berlaku, Saudara akan menjalani masa percobaan sebagai berikut:

    Masa Percobaan s.d. : {{probation_until}}

Apabila Saudara menerima penawaran ini, mohon konfirmasi dan penandatanganan dokumen onboarding paling lambat sebelum tanggal mulai kerja.

Kami menyambut baik keikutsertaan Saudara di perusahaan.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_PROMOTION",
    category: "PersonnelAction",
    name: "Surat Keputusan Promosi",
    description: "SK kenaikan jabatan (promosi).",
    subject: "Surat Keputusan Promosi",
    signatoryTitle: "HR Director",
    body: `{{letter_no}}

Perihal: Surat Keputusan Promosi Jabatan

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan hasil evaluasi kinerja dan pertimbangan kebutuhan organisasi, dengan ini perusahaan {{company_name}} memutuskan untuk MENAIKKAN jabatan Saudara dengan rincian sebagai berikut:

    Jabatan Baru      : {{new_position}}
    Unit Kerja Baru   : {{new_org_unit}}
    Grade             : {{new_grade}}
    Status Kepegawaian: {{employee_status}}
    Berlaku Efektif   : {{effective_date}}

Penyesuaian remunerasi menyertai keputusan ini sesuai ketentuan yang berlaku dan akan diterangkan terpisah secara rahasia.

Saudara diharapkan melaksanakan tanggung jawab pada jabatan baru dengan sebaik-baiknya serta menyelesaikan serah terima pekerjaan pada jabatan lama secara tertib.

Demikian surat keputusan ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_DEMOTION",
    category: "PersonnelAction",
    name: "Surat Keputusan Penurunan Jabatan",
    description: "SK penurunan jabatan (demosi).",
    subject: "Surat Keputusan Penurunan Jabatan",
    signatoryTitle: "HR Director",
    body: `{{letter_no}}

Perihal: Surat Keputusan Penurunan Jabatan

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan hasil evaluasi dan pertimbangan organisasi, perusahaan {{company_name}} memutuskan untuk menyesuaikan jabatan Saudara menjadi:

    Jabatan Baru    : {{new_position}}
    Unit Kerja Baru : {{new_org_unit}}
    Grade           : {{new_grade}}
    Berlaku Efektif : {{effective_date}}

Alasan: {{reason}}

Penyesuaian tunjangan yang melekat pada jabatan akan berlaku mengikuti ketentuan perusahaan seiring keputusan ini.

Saudara diharapkan tetap melaksanakan tugas pada jabatan baru dengan penuh tanggung jawab, dan serah terima pekerjaan pada jabatan sebelumnya diselesaikan secara tertib.

Demikian surat keputusan ini dibuat untuk dilaksanakan sebagaimana mestinya.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_TRANSFER",
    category: "PersonnelAction",
    name: "Surat Keputusan Transfer",
    description: "SK pemindahan penempatan kerja antar unit (jabatan setara).",
    subject: "Surat Keputusan Transfer",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Surat Keputusan Transfer Penempatan Kerja

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Dalam rangka penyesuaian kebutuhan organisasi, perusahaan {{company_name}} memutuskan untuk memindahkan penempatan kerja Saudara dengan rincian:

    Unit Kerja Baru : {{new_org_unit}}
    Jabatan         : {{new_position}}
    Grade           : {{new_grade}}
    Berlaku Efektif : {{effective_date}}

Hak dan kewajiban Saudara sebagai karyawan tetap berlaku sebagaimana mestinya, dan serah terima pekerjaan pada unit sebelumnya wajib diselesaikan sebelum tanggal efektif.

Demikian surat keputusan ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_MUTATION",
    category: "PersonnelAction",
    name: "Surat Keputusan Mutasi",
    description: "SK mutasi — perubahan tugas/penempatan (jabatan turut menyesuaikan).",
    subject: "Surat Keputusan Mutasi",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Surat Keputusan Mutasi

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan kebutuhan organisasi, perusahaan {{company_name}} memutasi Saudara ke penempatan berikut:

    Jabatan Baru    : {{new_position}}
    Unit Kerja Baru : {{new_org_unit}}
    Grade           : {{new_grade}}
    Berlaku Efektif : {{effective_date}}
    Alasan          : {{reason}}

Saudara diharapkan menyesuaikan diri dengan tugas dan lingkungan kerja baru sebaik-baiknya. Serah terima pekerjaan pada penempatan lama diselesaikan secara tertib sebelum tanggal efektif.

Demikian surat keputusan ini dibuat untuk dilaksanakan sebagaimana mestinya.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_SALARYADJUSTMENT",
    category: "PersonnelAction",
    name: "Surat Penyesuaian Remunerasi",
    description: "Surat rahasia — pemberitahuan penyesuaian gaji.",
    subject: "Penyesuaian Remunerasi (Rahasia)",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Penyesuaian Remunerasi — RAHASIA

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan hasil evaluasi, perusahaan {{company_name}} menetapkan penyesuaian remunerasi Saudara sebagai berikut:

    Grade Baru        : {{new_grade}}
    Remunerasi Baru  : {{new_salary}}
    Berlaku Efektif  : {{effective_date}}
    Alasan           : {{reason}}

Besaran remunerasi tercantum dalam lampiran slip rahasia yang hanya diketahui Saudara, atasan langsung, dan bagian kepegawaian. Saudara diminta menjaga kerahasiaan besaran remunerasi sesuai Peraturan Perusahaan.

Kami berharap penyesuaian ini menjadi motivasi untuk kontribusi yang lebih baik bagi perusahaan.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_CONTRACTRENEWAL",
    category: "PersonnelAction",
    name: "Surat Keputusan Perpanjangan Kontrak",
    description: "SK perpanjangan PKWT.",
    subject: "Perpanjangan Kontrak Kerja",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Surat Keputusan Perpanjangan Kontrak Kerja

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Menindaklanjuti berakhirnya kontrak kerja Saudara, berdasarkan hasil evaluasi kinerja, dengan ini perusahaan {{company_name}} memutuskan untuk MEMPERPANJANG kontrak kerja Saudara dengan ketentuan:

    Jabatan      : {{new_position}}
    Unit Kerja   : {{new_org_unit}}
    Grade        : {{new_grade}}
    Kontrak Baru : s.d. {{contract_until}}
    Berlaku Efektif : {{effective_date}}

Syarat dan ketentuan kerja lainnya mengikuti kontrak kerja yang akan ditandatangani kedua belah pihak.

Demikian surat keputusan ini dibuat untuk dipatuhi dan dilaksanakan.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_CHANGESTATUS",
    category: "PersonnelAction",
    name: "Surat Keputusan Perubahan Status Kepegawaian",
    description: "SK perubahan status (mis. kontrak → permanen).",
    subject: "Perubahan Status Kepegawaian",
    signatoryTitle: "HR Director",
    body: `{{letter_no}}

Perihal: Surat Keputusan Perubahan Status Kepegawaian

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan hasil evaluasi kinerja dan kebutuhan organisasi, dengan ini perusahaan {{company_name}} mengubah status kepegawaian Saudara menjadi:

    Status Baru    : {{new_status}}
    Jabatan        : {{new_position}}
    Unit Kerja     : {{new_org_unit}}
    Berlaku Efektif: {{effective_date}}

Dengan berubahnya status tersebut, hak dan kewajiban Saudara mengikuti ketentuan bagi status kepegawaian yang baru sesuai Peraturan Perusahaan dan peraturan perundang-undangan.

Kami berharap Saudara terus memberikan kontribusi terbaik bagi perusahaan.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_EXTENDPROBATION",
    category: "PersonnelAction",
    name: "Surat Keputusan Perpanjangan Masa Percobaan",
    description: "SK perpanjangan probation.",
    subject: "Perpanjangan Masa Percobaan",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Surat Keputusan Perpanjangan Masa Percobaan

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Menindaklanjuti masa percobaan Saudara yang sedang berjalan, perusahaan {{company_name}} memutuskan untuk memperpanjang masa percobaan Saudara dengan ketentuan:

    Masa Percobaan diperpanjang s.d. : {{probation_until}}
    Berlaku Efektif                  : {{effective_date}}

Selama masa perpanjangan, perusahaan akan tetap memberikan pembinaan dan evaluasi berkala atas aspek-aspek yang perlu ditingkatkan. Keputusan status kepegawaian selanjutnya akan disampaikan sebelum tanggal berakhirnya masa percobaan.

Demikian surat keputusan ini dibuat untuk dipatuhi.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_RESIGNATION",
    category: "PersonnelAction",
    name: "Surat Penerimaan Pengunduran Diri",
    description: "Surat pengakuan pengunduran diri (resign) — hari terakhir kerja.",
    subject: "Penerimaan Pengunduran Diri",
    signatoryTitle: "HR Manager",
    body: `{{letter_no}}

Perihal: Penerimaan Pengunduran Diri

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Merujuk surat permohonan pengunduran diri Saudara, perusahaan {{company_name}} menerima pengunduran diri Saudara dengan ketentuan:

    Hari Kerja Terakhir : {{last_day}}
    Berlaku Efektif     : {{effective_date}}
    Alasan/Catatan     : {{reason}}

Saudara wajib menyelesaikan seluruh kewajiban administratif sebelum hari terakhir, antara lain serah terima pekerjaan dan aset, pengembalian dokumen, serta clearance keuangan sesuai checklist offboarding yang diberikan bagian kepegawaian. Hak-hak Saudara sesuai peraturan perusahaan dan peraturan perundang-undangan akan diselesaikan melalui final settlement.

Kami mengucapkan terima kasih atas kontribusi Saudara selama bekerja di perusahaan dan mengingatkan tetap menjaga kerahasiaan informasi perusahaan setelah hubungan kerja berakhir.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_TERMINATION",
    category: "PersonnelAction",
    name: "Surat Pemutusan Hubungan Kerja (PHK)",
    description: "Surat PHK — hari terakhir, hak & kewajiban settlement.",
    subject: "Pemutusan Hubungan Kerja",
    signatoryTitle: "HR Director",
    body: `{{letter_no}}

Perihal: Surat Pemutusan Hubungan Kerja

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Berdasarkan pertimbangan perusahaan, dengan ini {{company_name}} menyatakan pemutusan hubungan kerja (PHK) dengan Saudara dengan ketentuan:

    Hari Kerja Terakhir : {{last_day}}
    Berlaku Efektif     : {{effective_date}}
    Alasan             : {{reason}}

Hak-hak Saudara (pesangon dan/atau uang pisah, penggantian cuti yang belum diambil, THR/penghasilan proporsional, dan kompensasi lainnya sesuai ketentuan Peraturan Perusahaan dan peraturan perundang-undangan yang berlaku) akan dibayarkan melalui final settlement yang rinciannya disampaikan terpisah.

Saudara diminta menyelesaikan serah terima pekerjaan, pengembalian seluruh aset dan dokumen perusahaan, serta clearance keuangan sesuai checklist offboarding paling lambat pada hari kerja terakhir.

Setelah tanggal efektif, Saudara tetap terikat pada kewajiban menjaga kerahasiaan informasi perusahaan.

Demikian surat ini dibuat untuk diperhatikan.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
  {
    key: "PA_RETIREMENT",
    category: "PersonnelAction",
    name: "Surat Keputusan Pensiun",
    description: "Surat pensiun — penghargaan masa kerja.",
    subject: "Pensiun",
    signatoryTitle: "HR Director",
    body: `{{letter_no}}

Perihal: Surat Keputusan Pensiun

Kepada Yth.
Bapak/Ibu {{employee_name}}
NIK {{employee_no}}
{{employee_position}} — {{employee_org_unit}}

Sesuai ketentuan usia pensiun dan/atau masa kerja — Saudara bergabung sejak {{join_date}} — dengan ini perusahaan {{company_name}} memutuskan pensiun Saudara dengan ketentuan:

    Hari Kerja Terakhir : {{last_day}}
    Berlaku Efektif     : {{effective_date}}

Hak-hak Saudara berupa pesangon pensiun, penggantian cuti yang belum diambil, dan manfaat lain sesuai ketentuan Jaminan Hari Tua/BPJS Ketenagakerjaan serta Peraturan Perusahaan akan dibayarkan melalui final settlement yang rinciannya disampaikan terpisah. Serah terima pekerjaan dan aset diselesaikan sesuai checklist offboarding.

Kami menyampaikan penghargaan yang setinggi-tingginya atas dedikasi dan kontribusi Saudara selama mengabdi di perusahaan.

{{city}}, {{letter_date}}

{{company_name}}

{{signatory_name}}
{{signatory_title}}`,
  },
];

// ---------------- KATALOG PLACEHOLDER (untuk editor + mesin render) ----------------

export interface LetterPlaceholderGroup {
  group: string;
  tokens: { token: string; desc: string }[];
}

export const LETTER_PLACEHOLDERS: LetterPlaceholderGroup[] = [
  {
    group: "Surat & Perusahaan",
    tokens: [
      { token: "letter_no", desc: "Nomor surat terbit (terisi otomatis saat terbit)" },
      { token: "letter_date", desc: "Tanggal surat diterbitkan" },
      { token: "city", desc: "Kota penerbitan surat" },
      { token: "company_name", desc: "Nama badan usaha" },
      { token: "company_address", desc: "Alamat badan usaha" },
      { token: "company_city", desc: "Kota badan usaha" },
      { token: "company_phone", desc: "Telepon badan usaha" },
      { token: "company_npwp", desc: "NPWP badan usaha" },
      { token: "office_name", desc: "Nama kantor penempatan karyawan" },
      { token: "office_city", desc: "Kota kantor penempatan" },
      { token: "office_npwp", desc: "NPWP kantor penempatan" },
      { token: "signatory_name", desc: "Nama penanda tangan (diatur pada template)" },
      { token: "signatory_title", desc: "Jabatan penanda tangan (diatur pada template)" },
    ],
  },
  {
    group: "Data Karyawan",
    tokens: [
      { token: "employee_name", desc: "Nama lengkap karyawan" },
      { token: "employee_no", desc: "NIK / nomor karyawan" },
      { token: "employee_position", desc: "Jabatan saat ini" },
      { token: "employee_org_unit", desc: "Unit organisasi saat ini" },
      { token: "employee_grade", desc: "Grade saat ini" },
      { token: "employee_level", desc: "Level jabatan saat ini" },
      { token: "employee_status", desc: "Status kepegawaian (Permanent/Contract/…)" },
      { token: "join_date", desc: "Tanggal bergabung" },
    ],
  },
  {
    group: "Personnel Action",
    tokens: [
      { token: "effective_date", desc: "Tanggal efektif dokumen aksi" },
      { token: "reason", desc: "Alasan / catatan dokumen aksi" },
      { token: "last_day", desc: "Hari kerja terakhir (resign/PHK/pensiun)" },
      { token: "new_position", desc: "Jabatan baru / jabatan pada dokumen" },
      { token: "new_org_unit", desc: "Unit kerja baru / unit pada dokumen" },
      { token: "new_grade", desc: "Grade baru" },
      { token: "new_salary", desc: "Remunerasi baru (format Rupiah)" },
      { token: "new_status", desc: "Status kepegawaian baru" },
      { token: "contract_until", desc: "Kontrak berlaku s.d." },
      { token: "probation_until", desc: "Masa percobaan s.d." },
    ],
  },
  {
    group: "Disipliner",
    tokens: [
      { token: "warning_level", desc: "Label level peringatan" },
      { token: "warning_no", desc: "Urutan surat peringatan karyawan" },
      { token: "violation", desc: "Uraian pelanggaran" },
      { token: "sanction", desc: "Sanksi" },
      { token: "issued_at", desc: "Tanggal kejadian/diterbitkan" },
      { token: "expires_at", desc: "Tanggal berakhir masa berlaku" },
      { token: "validity_months", desc: "Lama masa berlaku (bulan)" },
      { token: "notes", desc: "Catatan tambahan" },
    ],
  },
];
