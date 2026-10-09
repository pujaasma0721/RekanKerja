// =============================================================================
// SERVER-ERRORS — kamus + aturan terjemahan PESAN SERVER (error/warning/info)
// yang dihasilkan API route & service (Bahasa Indonesia) dan ditampilkan client.
//
// Latar (audit BL-ERR, tindak lanjut audit bilingual):
//   · Toast lokal frontend SUDAH bilingual (t("ID","EN") — 765 call site).
//   · Namun pesan yang LAHIR DI SERVER (`NextResponse.json({ error: "…" })`,
//     `throw new Error("…")`, field `message`/`warning`/`details`) hardcoded
//     Indonesia (536 string statis unik + 171 template dinamis) dan ditampilkan
//     mentah oleh 596 call site `e.message` → mode EN tetap menampilkan
//     pesan Indonesia.
//   Solusi terpusat (tanpa menyentuh 798 titik server): fungsi trServer() di
//   i18n-core.ts menerjemahkan pesan DI TITIK MASUK client (apiSend/apiUpload/
//   useApi/essGet/useEssMe/session-store) + titik tampil pesan sukses server.
//
// File ini MODUL DATA MURNI (tanpa import) agar:
//   · aman dari siklus import (i18n-core yang mengimpor file ini);
//   · bisa diisi paralel oleh agent tanpa konflik dengan edit i18n-core.
//
// Urutan kerja trServerFor(lang, msg):
//   1. exact-match SERVER_ERR_EN (pesan statis) → BASE_EN (i18n-core).
//   2. prefiks "Baris N: …" → "Row N: …" + rekursi isi (pesan validasi per baris
//      klaim ESS).
//   3. SERVER_MSG_RULES — regex berjangkar (urut; match perting menang).
//      Capture $1..$n = DATA (kode/nama/angka/status) dipertahankan apa adanya.
//   4. SERVER_MSG_FRAGMENTS — frasa baku word-boundary utk pesan campuran yang
//      lolos tahap 1–3 (jaring pengaman).
//   5. fallback identity (pesan tetap Bahasa Indonesia — degradasi mulus).
//
// Konvensi penulisan entri kamus: key = string PERSIS yang dikirim server
// (termasuk tanda baca akhir "." bila ada), value = EN alami (bukan harfiah).
// =============================================================================

/** Kamus pesan server statis → EN. (Diisi bertahap — blok BL-ERR & BL-6.) */
export const SERVER_ERR_EN: Record<string, string> = {
  // ---- autentikasi / sesi (paling kritis: layar login) ----
  "Email dan kata sandi wajib diisi": "Email and password are required",
  "Email atau kata sandi salah": "Incorrect email or password",
  "Email atau kata sandi salah.": "Incorrect email or password.",
  "Terlalu banyak percobaan masuk gagal dari jaringan ini. Coba lagi nanti.":
    "Too many failed sign-in attempts from this network. Try again later.",
  "Gagal masuk": "Sign-in failed",
  "Verifikasi gagal": "Verification failed",
  "Gagal membuat workspace": "Failed to create the workspace",
  "Gagal memilih workspace": "Failed to select the workspace",
  "Sesi tidak valid — silakan masuk kembali.": "Invalid session — please sign in again.",
  "Sesi tidak valid": "Invalid session",
  "Autentikasi dua faktor aktif.": "Two-factor authentication is now active.",
  "Autentikasi dua faktor dinonaktifkan — login kembali 1 langkah.":
    "Two-factor authentication is disabled — sign-in is now a single step.",
  "Kata sandi berhasil diganti": "Password changed successfully",

  // ---- umum / paling sering muncul (seed dari inventory frekuensi) ----
  "id wajib": "id is required",
  "Karyawan tidak ditemukan": "Employee not found",
  "runId wajib": "runId is required",
  "Run tidak ditemukan": "Run not found",
  "Template tidak ditemukan": "Template not found",
  "Dokumen tidak ditemukan": "Document not found",
  "Pengguna tidak ditemukan": "User not found",
  "Rule tidak ditemukan": "Rule not found",
  "Periode tidak ditemukan": "Period not found",
  "Period tidak ditemukan": "Period not found",
  "Terlalu banyak percobaan kode verifikasi salah — coba lagi dalam 15 menit.":
    "Too many incorrect verification code attempts — try again in 15 minutes.",
  "Tanggal efektif tidak valid": "Invalid effective date",
  "Nilai harus angka": "Value must be a number",
  "Nama rule wajib diisi": "Rule name is required",
  "Company belum di-set": "Company is not set yet",
  "Tidak ada perubahan data": "No data changes",
  "Pengumuman tidak ditemukan": "Announcement not found",
  "Karyawan wajib dipilih": "An employee must be selected",
  "Aset tidak ditemukan": "Asset not found",
  "Approver dan delegate tidak boleh sama": "Approver and delegate cannot be the same person",
  "Proses onboarding tidak ditemukan": "Onboarding process not found",
  "Proses offboarding tidak ditemukan": "Offboarding process not found",
  "Posting open shift tidak ditemukan": "Open shift post not found",
  "Komponen upah tidak ditemukan": "Wage component not found",
  "Komponen tidak ditemukan": "Component not found",
  "Tugas tidak ditemukan pada proses ini": "Task not found in this process",
  "Baris riwayat tidak ditemukan": "History row not found",
  "Parameter month harus format YYYY-MM": "Parameter month must be in YYYY-MM format",
  "id & action wajib": "id & action are required",
  "id & action (approve|reject|cancel) wajib": "id & action (approve|reject|cancel) are required",
  "actionType tidak valid": "Invalid actionType",
  "kind tidak dikenal": "Unknown kind",
  "domain tidak valid": "Invalid domain",
  "Tanggal berakhir harus setelah tanggal mulai": "End date must be after the start date",
  "Tanggal mulai bentrok dengan versi sebelumnya": "Start date conflicts with the previous version",
  "Tanggal berakhir melewati awal versi berikutnya": "End date passes the start of the next version",

  // ---- Task BL-6 (kamus pesan server — hasil sweep api/services) ----
  // ---- autentikasi / sesi / MFA (29) ----
  "Akun ini bukan anggota workspace alamat ini. Masuk lewat alamat workspace Anda.":
    "This account is not a member of the workspace at this address. Sign in via your own workspace address.",
  "Alamat ini khusus workspace lain": "This address belongs to a different workspace",
  "Alamat workspace harus 2–12 huruf/angka tanpa tanda hubung — sama dengan kode perusahaan Anda.":
    "The workspace address must be 2–12 letters/digits without hyphens — the same as your company code.",
  "Alamat workspace ini sudah dipakai — pilih alamat lain.":
    "This workspace address is already taken — choose another one.",
  "Alamat workspace tidak dikenal. Masuk lewat alamat perusahaan Anda atau alamat utama.":
    "Unknown workspace address. Sign in via your company's address or the main address.",
  "Anda bukan anggota workspace ini": "You are not a member of this workspace",
  "Autentikasi dua faktor sudah aktif — nonaktifkan terlebih dahulu bila ingin mengatur ulang.":
    "Two-factor authentication is already active — disable it first if you want to set it up again.",
  "Autentikasi dua faktor sudah aktif.": "Two-factor authentication is already active.",
  "Belum masuk": "Not signed in",
  "Email sudah terdaftar — silakan masuk": "Email already registered — please sign in",
  "Gagal mengaktifkan MFA": "Failed to activate MFA",
  "Gagal menonaktifkan MFA": "Failed to deactivate MFA",
  "Gagal menyimpan secret MFA": "Failed to save the MFA secret",
  "Kata sandi salah — MFA tidak dinonaktifkan.": "Incorrect password — MFA was not disabled.",
  "Kata sandi wajib diisi untuk menonaktifkan MFA.": "A password is required to disable MFA.",
  "Kode perusahaan wajib diisi (2–12 karakter huruf/angka)": "Company code is required (2–12 letters/digits)",
  "Kode verifikasi harus 6 digit angka.": "The verification code must be 6 digits.",
  "Kode verifikasi salah.": "Incorrect verification code.",
  "MFA tidak aktif pada akun ini — silakan masuk kembali.": "MFA is not active on this account — please sign in again.",
  "Nama workspace minimal 3 karakter": "The workspace name must be at least 3 characters",
  "Pendaftaran dengan email ini terlalu sering. Coba lagi nanti atau gunakan email lain.":
    "Too many registrations with this email. Try again later or use a different email.",
  "Secret MFA belum disiapkan — mulai dari langkah setelan (QR).":
    "The MFA secret has not been prepared — start from the setup step (QR).",
  "Selesaikan pendaftaran workspace Anda di alamat ini.": "Finish registering your workspace at this address.",
  "Sesi gagal dibangun": "Failed to establish the session",
  "Sesi verifikasi kedaluwarsa atau tidak valid — silakan masuk kembali.":
    "The verification session has expired or is invalid — please sign in again.",
  "tenantId wajib diisi": "tenantId is required",
  "Terlalu banyak percobaan pendaftaran dari jaringan ini. Coba lagi nanti.":
    "Too many registration attempts from this network. Try again later.",
  "Token verifikasi MFA wajib diisi.": "The MFA verification token is required.",
  "user gagal dibuat": "Failed to create the user",
  // ---- pengguna aplikasi & kebijakan sandi (21) ----
  "Bukan kata sandi umum / mudah ditebak": "Not a common / easily guessed password",
  "Email wajib diisi dengan format valid (untuk login)":
    "Email must be filled in with a valid format (used for sign-in)",
  "Kata sandi awal wajib diisi": "An initial password is required",
  "Kata sandi baru belum memenuhi kebijakan:": "The new password does not meet the policy:",
  "Kata sandi baru tidak boleh sama dengan kata sandi saat ini":
    "The new password cannot be the same as the current password",
  "Kata sandi baru wajib diisi": "A new password is required",
  "Kata sandi belum memenuhi kebijakan:": "The password does not meet the policy:",
  "Kata sandi saat ini & kata sandi baru wajib diisi": "Current password & new password are required",
  "Kata sandi saat ini salah": "The current password is incorrect",
  "Masa peringatan tidak boleh melebihi masa berlaku kata sandi":
    "The warning period cannot exceed the password lifetime",
  "Mengandung angka (0–9)": "Contains a number (0–9)",
  "Mengandung huruf besar (A–Z)": "Contains an uppercase letter (A–Z)",
  "Mengandung huruf kecil (a–z)": "Contains a lowercase letter (a–z)",
  "Mengandung karakter khusus (!@#$% dll.)": "Contains a special character (!@#$% etc.)",
  "Minimal satu user harus tersisa": "At least one user must remain",
  "Panjang minimum tidak boleh melebihi panjang maksimum": "The minimum length cannot exceed the maximum length",
  "Pengguna super admin (role Admin) tidak boleh dihapus dari sini":
    "Super admin users (Admin role) cannot be deleted from here",
  "Pengguna tanpa email — tidak punya akun login untuk direset":
    "The user has no email — there is no login account to reset",
  "Tidak mengandung nama pengguna": "Must not contain the user's name",
  "Tidak mengandung username / email": "Must not contain the username / email",
  "Username & nama wajib diisi": "Username & name are required",
  // ---- money-vault / e-sign / kunci API (47) ----
  "action tidak dikenal": "Unknown action",
  "Akses ditolak: kunci API hanya boleh dikelola oleh Admin platform / AppUser Admin (superadmin).":
    "Access denied: API keys can only be managed by platform Admins / AppUser Admins (superadmins).",
  "Aksi tidak dikenal — hanya \"revoke\"": "Unknown action — only \"revoke\" is allowed",
  "docType & docId wajib": "docType & docId are required",
  "docType, docId, code wajib": "docType, docId, code are required",
  "Dokumen ditandatangani": "Document signed",
  "Email sesi tidak tersedia — set PIN tanda tangan": "Session email is unavailable — set a signing PIN",
  "Hanya admin workspace (Owner/Admin) yang dapat mengelola vault uang.":
    "Only workspace admins (Owner/Admin) can manage the Money Vault.",
  "Hanya pengguna aplikasi (AppUser) yang dapat menandatangani": "Only application users (AppUser) can sign",
  "Header x-api-key wajib diisi": "The x-api-key header is required",
  "Jenis dokumen tidak didukung": "Unsupported document type",
  "Kata sandi vault salah.": "Incorrect vault password.",
  "Kode tanda tangan salah atau kedaluwarsa": "The signing code is incorrect or expired",
  "kunci aktif": "active key",
  "Kunci API telah dicabut": "The API key has been revoked",
  "Kunci API tidak dikenali": "Unrecognized API key",
  "kunci baru": "new key",
  "Kunci dicabut — kunci baru dibuat otomatis saat pengguna menandatangani lagi":
    "Key revoked — a new key is created automatically when the user signs again",
  "Kunci penandatangan tidak ditemukan": "Signer key not found",
  "Kunci sudah dicabut sebelumnya": "The key has already been revoked",
  "Kunci tanda tangan DICABUT oleh admin — ttd baru tertahan sampai kunci dibuat ulang":
    "Signing key REVOKED by an admin — new signatures are held until the key is recreated",
  "Kunci tanda tangan pengguna tidak ditemukan": "The user's signing key was not found",
  "Kunci tanda tangan tidak dapat dibuka (vault)": "The signing key cannot be unlocked (vault)",
  "Kunci tanda tangan tidak tersedia": "No signing key available",
  "Kunci tidak ditemukan": "Key not found",
  "Masukkan PIN tanda tangan": "Enter your signing PIN",
  "Metadata tanda tangan berubah sejak ditandatangani": "The signature metadata changed since signing",
  "Nama kunci wajib diisi": "Key name is required",
  "Pengguna tersebut bukan anggota workspace ini.": "That user is not a member of this workspace.",
  "Pilih minimal satu scope (employees / leave / payroll)": "Select at least one scope (employees / leave / payroll)",
  "PIN harus 6 digit angka": "The PIN must be 6 digits",
  "PIN lama salah": "The old PIN is incorrect",
  "PIN tanda tangan dihapus — OTP email dipakai": "Signing PIN deleted — email OTP is used",
  "PIN tanda tangan dihapus — pengguna memakai OTP email untuk sementara":
    "Signing PIN deleted — the user will temporarily use email OTP",
  "PIN tanda tangan direset oleh admin — faktor kembali ke OTP email":
    "Signing PIN reset by an admin — the factor reverts to email OTP",
  "PIN tanda tangan diset/diperbarui": "Signing PIN set/updated",
  "PIN tanda tangan tersimpan": "Signing PIN saved",
  "Proses re-enkripsi data sedang berjalan untuk workspace ini — tunggu hingga selesai lalu coba lagi.":
    "Data re-encryption is running for this workspace — wait for it to finish, then try again.",
  "Tanda tangan tidak cocok dengan kunci penandatangan": "The signature does not match the signer's key",
  "Tanda tangan tidak ditemukan": "Signature not found",
  "Terlalu banyak percobaan kata sandi salah — vault terkunci sementara, coba lagi nanti.":
    "Too many incorrect password attempts — the vault is temporarily locked, try again later.",
  "Terlalu banyak permintaan verifikasi. Coba lagi nanti.": "Too many verification requests. Try again later.",
  "userId anggota workspace wajib diisi": "The workspace member's userId is required",
  "Vault tenant belum termuat — kunci tidak dapat dibuat": "The tenant vault is not loaded — the key cannot be created",
  "Vault uang belum dikonfigurasi — atur kata sandi vault terlebih dahulu.":
    "The Money Vault has not been configured — set a vault password first.",
  "Vault uang sedang terkunci — buka kunci vault terlebih dahulu.":
    "The Money Vault is locked — unlock the vault first.",
  "Vault uang sudah dikonfigurasi untuk workspace ini — gunakan ganti kata sandi vault.":
    "The Money Vault is already configured for this workspace — use change vault password.",
  // ---- human-resource (master, PA, on/offboarding, aset, surat) (109) ----
  "[field-crypto] applyAssignmentChange dalam $transaction tanpa konteks kunci — berikan tc dari client luar (pola payroll-service 28-c)":
    "[field-crypto] applyAssignmentChange inside $transaction without key context — pass tc from the outer client (payroll-service 28-c pattern)",
  "Ada format email tidak valid": "Some email addresses are invalid",
  "Akses ditolak: karyawan ini di luar skema akses data Anda. Hubungi admin workspace bila seharusnya dapat diakses.":
    "Access denied: this employee is outside your data access scope. Contact the workspace admin if it should be accessible.",
  "Aset dan karyawan wajib dipilih": "Asset and employee must be selected",
  "Aset memiliki riwayat penugasan dan tidak bisa dihapus — tandai status Retired sebagai gantinya":
    "The asset has assignment history and cannot be deleted — mark its status as Retired instead",
  "Aset sedang ditugaskan — gunakan aksi Kembalikan di tab Penugasan agar kondisi tercatat":
    "The asset is currently assigned — use the Return action on the Assignments tab so its condition is recorded",
  "Atasan langsung tidak dikenal — pilih ulang atasan": "Unknown direct supervisor — reselect the supervisor",
  "Data keluarga tidak ditemukan": "Family data not found",
  "Data referensi tidak valid — periksa karyawan terkait": "Invalid reference data — check the related employee",
  "Data referensi tidak valid — periksa karyawan/posisi/unit/grade tujuan":
    "Invalid reference data — check the target employee/position/unit/grade",
  "Data referensi tidak valid — periksa posisi/unit/grade tujuan":
    "Invalid reference data — check the target position/unit/grade",
  "Data referensi tidak valid — periksa unit/posisi/grade/atasan":
    "Invalid reference data — check the unit/position/grade/supervisor",
  "Dokumen sudah diproses sebelumnya": "The document has already been processed",
  "Dokumen sudah diproses, tidak bisa dibatalkan": "The document has already been processed and cannot be cancelled",
  "Dokumen sudah tidak berstatus Draft (mungkin baru saja disubmit)":
    "The document is no longer a Draft (it may have just been submitted)",
  "Dokumen tidak dalam status Menunggu Approval": "The document is not awaiting approval",
  "Endpoint ini untuk template — tambahkan ?template=1 (unduh) atau POST file untuk import":
    "This endpoint is for templates — add ?template=1 (download) or POST a file to import",
  "File XLSX tidak terbaca (rusak / bukan Excel) — unduh template dan isi ulang":
    "The XLSX file cannot be read (corrupt / not Excel) — download the template and fill it in again",
  "File XLSX wajib dilampirkan (field \"file\")": "An XLSX file must be attached (field \"file\")",
  "Gaji pokok baru harus berupa angka lebih dari 0": "The new base salary must be a number greater than 0",
  "Gaji pokok harus berupa angka tidak negatif": "The base salary must be a non-negative number",
  "Gaji pokok tidak boleh negatif": "The base salary cannot be negative",
  "Grade tidak dikenal — pilih ulang grade": "Unknown grade — reselect the grade",
  "Grade tujuan tidak dikenal — periksa kembali detail dokumen": "Unknown target grade — re-check the document details",
  "Hanya aksi reset yang didukung": "Only the reset action is supported",
  "Hanya dokumen Disetujui yang bisa diproses": "Only Approved documents can be processed",
  "Hanya dokumen Ditolak/Dibatalkan yang bisa dikembalikan ke draft":
    "Only Rejected/Cancelled documents can be returned to draft",
  "Hanya dokumen Draft yang bisa disubmit": "Only Draft documents can be submitted",
  "Hanya dokumen Draft/Dibatalkan yang bisa dihapus": "Only Draft/Cancelled documents can be deleted",
  "Hanya draft yang bisa diedit": "Only drafts can be edited",
  "Hanya file .xlsx yang didukung — simpan ulang sebagai Excel Workbook":
    "Only .xlsx files are supported — re-save it as an Excel Workbook",
  "Hanya koordinator (Admin/HR) yang bisa membatalkan": "Only coordinators (Admin/HR) can cancel",
  "Hanya koordinator (Admin/HR) yang bisa menambah tugas": "Only coordinators (Admin/HR) can add tasks",
  "Hanya koordinator (Admin/HR) yang bisa menandai selesai": "Only coordinators (Admin/HR) can mark tasks complete",
  "Hanya koordinator (Admin/HR) yang bisa menghapus tugas": "Only coordinators (Admin/HR) can delete tasks",
  "Hanya koordinator (Admin/HR) yang bisa mengirim ulang email": "Only coordinators (Admin/HR) can resend emails",
  "Hanya proses berjalan (Open) yang bisa dibatalkan": "Only running (Open) processes can be cancelled",
  "Hanya proses berjalan (Open) yang bisa diedit": "Only running (Open) processes can be edited",
  "Hanya proses berjalan (Open) yang bisa ditandai selesai": "Only running (Open) processes can be marked complete",
  "Hanya proses berstatus Dibatalkan yang bisa dihapus": "Only Cancelled processes can be deleted",
  "Hanya tugas berstatus Pending yang bisa dihapus": "Only tasks with Pending status can be deleted",
  "id aset wajib": "Asset id is required",
  "id penugasan wajib": "Assignment id is required",
  "Isi pengumuman maksimal 20.000 karakter": "Announcement body must be at most 20,000 characters",
  "Isi pengumuman wajib diisi": "Announcement body is required",
  "Jenis dokumen tidak dikenal": "Unknown document type",
  "Jenjang & institusi wajib diisi": "Education level & institution are required",
  "Job tidak ditemukan": "Job not found",
  "Judul maksimal 160 karakter": "Title must be at most 160 characters",
  "Judul pengumuman wajib diisi": "Announcement title is required",
  "Judul tugas wajib diisi": "Task title is required",
  "Karyawan dan jenis aksi wajib diisi": "Employee and action type are required",
  "Karyawan tidak memiliki penempatan aktif": "The employee has no active assignment",
  "Kode dan judul job wajib diisi": "Job code and title are required",
  "Kode dan judul posisi wajib diisi": "Position code and title are required",
  "Kode dan nama grade wajib diisi": "Grade code and name are required",
  "Kode dan nama unit wajib diisi": "Unit code and name are required",
  "Kode posisi wajib diisi": "Position code is required",
  "Kode unit organisasi wajib diisi": "Organizational unit code is required",
  "Kondisi pengembalian wajib Good/Damaged/Lost": "The return condition must be Good/Damaged/Lost",
  "Koreksi manual baris riwayat penempatan (tanpa movement)":
    "Manual correction of an assignment history row (without movement)",
  "Lampiran harus JPG/PNG/WEBP/PDF dan maksimum 5 MB": "Attachments must be JPG/PNG/WEBP/PDF and at most 5 MB",
  "Lokasi kerja tidak dikenal — pilih ulang lokasi": "Unknown work location — reselect the location",
  "Nama & hubungan wajib diisi": "Name & relationship are required",
  "Nama aset maksimal 120 karakter": "Asset name must be at most 120 characters",
  "Nama aset wajib diisi": "Asset name is required",
  "Nama lengkap karyawan wajib diisi": "Employee full name is required",
  "NIK wajib diisi (16 digit angka)": "NIK is required (16 digits)",
  "Nilai aset harus angka >= 0": "The asset value must be a number >= 0",
  "Nomor karyawan baru sudah dipakai permintaan lain yang berjalan bersamaan — muat ulang dan coba lagi":
    "The new employee number is already used by another concurrent request — reload and try again",
  "Parameter expiring harus angka hari (mis. 30)": "The expiring parameter must be a number of days (e.g. 30)",
  "Parameter export tidak dikenal — gunakan ?export=turnover atau ?export=demografi":
    "Unknown export parameter — use ?export=turnover or ?export=demografi",
  "Parameter id laporan tidak dikenal (r11…r44)": "Unknown report id parameter (r11…r44)",
  "Pelanggaran wajib diisi": "The violation is required",
  "Pembuat dokumen tidak boleh menyetujui/menolak dokumennya sendiri (pemisahan maker-checker)":
    "The document's creator cannot approve/reject their own document (maker-checker separation)",
  "Pengakhiran kepegawaian harus melalui Personnel Action (Termination/Resignation/Retirement) — perubahan endDate langsung dinonaktifkan (fix audit 40 M-13)":
    "Employment termination must go through a Personnel Action (Termination/Resignation/Retirement) — direct endDate changes are disabled (audit fix 40 M-13)",
  "Pengalaman kerja tidak ditemukan": "Work experience not found",
  "Perubahan struktural tanpa target: dokumen Promotion/Demotion/Transfer/Mutation wajib memiliki posisi, unit, grade, kantor, atau lokasi tujuan yang valid sebelum diproses":
    "Structural change without a target: Promotion/Demotion/Transfer/Mutation documents must have a valid target position, unit, grade, office, or location before being processed",
  "Perusahaan & posisi wajib diisi": "Company & position are required",
  "Perusahaan belum di-setup": "The company has not been set up",
  "Perusahaan tidak dikenal — pilih ulang perusahaan": "Unknown company — reselect the company",
  "Perusahaan tidak ditemukan": "Company not found",
  "Posisi tidak dikenal — pilih ulang posisi": "Unknown position — reselect the position",
  "Posisi tujuan tidak dikenal — periksa kembali detail dokumen":
    "Unknown target position — re-check the document details",
  "Profil perusahaan diperbarui": "Company profile updated",
  "Proses offboarding untuk karyawan ini sudah berjalan": "An offboarding process is already running for this employee",
  "Proses onboarding untuk karyawan ini sudah berjalan": "An onboarding process is already running for this employee",
  "Proses sudah selesai/dibatalkan — data tidak bisa diubah":
    "The process is already completed/cancelled — the data cannot be changed",
  "Request harus multipart/form-data": "The request must be multipart/form-data",
  "Riwayat pendidikan tidak ditemukan": "Education history not found",
  "rowId wajib": "rowId is required",
  "Sheet data tidak ditemukan — gunakan template resmi": "Data sheet not found — use the official template",
  "Skor kepuasan harus angka bulat 1–5": "The satisfaction score must be an integer 1–5",
  "Status tugas tidak valid (Done/Pending/Na)": "Invalid task status (Done/Pending/Na)",
  "Tanggal berakhir kontrak harus setelah tanggal mulai kontrak":
    "The contract end date must be after the contract start date",
  "Tanggal hari terakhir tidak valid": "Invalid last working day",
  "Tanggal jatuh tempo tidak valid": "Invalid due date",
  "Tanggal kedaluwarsa tidak boleh mendahului tanggal terbit": "The expiry date cannot precede the issue date",
  "Tanggal kedaluwarsa tidak valid": "Invalid expiry date",
  "Tanggal masuk wajib diisi (YYYY-MM-DD)": "The join date is required (YYYY-MM-DD)",
  "Tanggal mulai tidak valid": "Invalid start date",
  "Tanggal perolehan tidak valid": "Invalid acquisition date",
  "Tidak ada baris data — seluruh baris adalah baris contoh (EXAMPLE) yang diabaikan":
    "No data rows — all rows are example (EXAMPLE) rows and were ignored",
  "Tidak ada baris data pada sheet": "No data rows on the sheet",
  "Tidak ada layer approval pending": "No pending approval layers",
  "Unit induk tidak ditemukan": "Parent unit not found",
  "Unit memiliki sub-unit — hapus/pindahkan sub-unit terlebih dahulu":
    "The unit has sub-units — delete/move the sub-units first",
  "Unit organisasi tidak dikenal — pilih ulang unit": "Unknown organizational unit — reselect the unit",
  "Unit organisasi tujuan tidak dikenal — periksa kembali detail dokumen":
    "Unknown target organizational unit — re-check the document details",
  // ---- leave (24) ----
  "Akses ditolak: hanya pemohon yang bisa menarik pengajuan ini":
    "Access denied: only the requester can withdraw this request",
  "Alasan penyesuaian wajib diisi": "Adjustment reason is required",
  "Baris saldo untuk encashment ini tidak ditemukan — generate saldo periode terlebih dahulu":
    "The balance row for this encashment was not found — generate the period balances first",
  "Data encashment tidak ditemukan": "Encashment data not found",
  "employeeId, leaveTypeId, year & days wajib": "employeeId, leaveTypeId, year & days are required",
  "employeeId, leaveTypeId, year & delta wajib": "employeeId, leaveTypeId, year & delta are required",
  "Encashment sudah diproses oleh pengguna lain — muat ulang daftar":
    "The encashment was already processed by another user — reload the list",
  "Jenis cuti tidak ditemukan / tidak aktif": "Leave type not found / inactive",
  "Jumlah hari diuangkan harus lebih dari 0": "The number of days to encash must be greater than 0",
  "Kode & nama jenis cuti wajib diisi": "Leave type code & name are required",
  "Kombinasi sesi tidak valid (PM → AM pada hari yang sama)": "Invalid session combination (PM → AM on the same day)",
  "Komponen upah UCT belum didefinisikan (hubungi admin)":
    "The UCT wage component has not been defined (contact the admin)",
  "leaveTypeId, dateFrom & dateTo wajib": "leaveTypeId, dateFrom & dateTo are required",
  "Nilai penyesuaian tidak boleh 0": "The adjustment value cannot be 0",
  "Parameter id laporan tidak dikenal (lr11…lr43)": "Unknown report id parameter (lr11…lr43)",
  "Parameter month wajib format YYYY-MM": "The month parameter must be in YYYY-MM format",
  "Pembatalan cuti yang sudah disetujui wajib menyertakan alasan (tercatat ke karyawan)":
    "Cancelling an approved leave must include a reason (recorded for the employee)",
  "Permintaan sudah diproses — muat ulang daftar": "The request has already been processed — reload the list",
  "Permintaan sudah diproses oleh pengguna lain — muat ulang daftar":
    "The request was already processed by another user — reload the list",
  "Rentang tanggal tidak memuat hari kerja": "The date range contains no working days",
  "Rentang tidak memuat hari kerja bagi karyawan mana pun": "The range contains no working days for any employee",
  "Saldo belum digenerate untuk periode ini": "Balances have not been generated for this period yet",
  "Tidak ada encashment Approved dengan payment date dalam period ini":
    "No Approved encashments with a payment date in this period",
  "Tidak ada jenis cuti aktif": "No active leave types",
  // ---- medical (42) ----
  "Akses ditolak: hanya pemegang akses LIHAT menu medis atau pemilik saldo yang dapat melihat saldo medis":
    "Access denied: only holders of the Medical menu VIEW access or the balance owner can view medical balances",
  "Akun piutang 13xx tidak ditemukan — jurnal hapus buku tidak dapat dibuat":
    "Accounts receivable 13xx account not found — the write-off journal cannot be created",
  "Akun piutang 13xx tidak ditemukan — jurnal pelunasan tidak dapat dibuat":
    "Accounts receivable 13xx account not found — the settlement journal cannot be created",
  "Approved tidak boleh melebihi tagihan": "The approved amount cannot exceed the bill",
  "Aturan limit tidak valid": "Invalid limit rule",
  "code & name wajib": "code & name are required",
  "employeeId & typeId wajib utk preview": "employeeId & typeId are required for preview",
  "employeeId, typeId & year wajib": "employeeId, typeId & year are required",
  "employeeId, typeId, claimDate & lines wajib": "employeeId, typeId, claimDate & lines are required",
  "employeeId, typeId, year, adjustmentDate & amount wajib":
    "employeeId, typeId, year, adjustmentDate & amount are required",
  "Faktor gaji harus > 0": "The salary factor must be > 0",
  "Frekuensi setiap-X-tahun harus ≥ 2 tahun (untuk 1×/tahun gunakan freqPeriod YEAR)":
    "Every-X-years frequency must be ≥ 2 years (for once a year, use freqPeriod YEAR)",
  "freqUnlimited tidak boleh aktif bersama EVERY_X_YEARS": "freqUnlimited cannot be active together with EVERY_X_YEARS",
  "Hapus buku piutang wajib menyertakan alasan (mis. klaim ditolak asuransi)":
    "A write-off must include a reason (e.g. the claim was rejected by insurance)",
  "id & action (submit|paid|writeoff) wajib": "id & action (submit|paid|writeoff) are required",
  "Jenis benefit tidak aktif": "The benefit type is inactive",
  "Jumlah penyesuaian harus ≠ 0": "The adjustment amount must be ≠ 0",
  "Jumlah tidak boleh negatif": "The amount cannot be negative",
  "Karyawan tidak aktif": "The employee is inactive",
  "kind harus HOSPITAL atau INSURANCE": "kind must be HOSPITAL or INSURANCE",
  "Klaim sudah settled — tidak bisa dibatalkan": "The claim is already settled — it cannot be cancelled",
  "Komponen upah UMC belum didefinisikan (hubungi admin)":
    "The UMC wage component has not been defined (contact the admin)",
  "Limit nominal harus > 0": "The nominal limit must be > 0",
  "lines harus array": "lines must be an array",
  "Minimal satu baris perawatan": "At least one treatment line is required",
  "Nama yang dirawat wajib diisi": "The treated person's name is required",
  "Nilai saldo awal (terpakai) wajib ≥ 0": "The opening (used) balance must be ≥ 0",
  "Parameter id laporan tidak dikenal (mr11…mr43)": "Unknown report id parameter (mr11…mr43)",
  "Penyesuaian tidak ditemukan": "Adjustment not found",
  "periodId & year wajib": "periodId & year are required",
  "Process type SALARY tidak ditemukan — potongan gaji over-limit tidak dapat dibuat":
    "SALARY process type not found — the over-limit salary deduction cannot be created",
  "Rumah sakit/klinik tidak ditemukan pada master provider": "Hospital/clinic not found in the provider master",
  "Saldo medis karyawan belum digenerate untuk tahun ini":
    "The employee's medical balances have not been generated for this year",
  "Saldo tidak ditemukan": "Balance not found",
  "Storno wajib menyertakan alasan (padanan Enter Reason oranHR)":
    "A storno must include a reason (the equivalent of oranHR's Enter Reason)",
  "Tanggal klaim mendahului tanggal bergabung karyawan": "The claim date precedes the employee's join date",
  "Tanggal klaim tidak boleh di masa depan": "The claim date cannot be in the future",
  "Tanggal klaim tidak valid": "Invalid claim date",
  "Tidak ada jenis benefit aktif": "No active benefit types",
  "Tidak ada jenis benefit dengan kebijakan saldo CASH": "No benefit types with a CASH balance policy",
  "Tidak ada period payroll terbuka — potongan gaji over-limit tidak dapat dibuat":
    "No open payroll period — the over-limit salary deduction cannot be created",
  "year wajib": "year is required",
  // ---- payroll (114) ----
  "action harus 'sync-ptkp'": "action must be 'sync-ptkp'",
  "Baris karyawan tidak ditemukan pada run ini": "Employee row not found on this run",
  "Benefit pay-in-payroll wajib memetakan komponen upah": "Pay-in-payroll benefits must map to a wage component",
  "Benefit pay-in-payroll wajib memetakan komponen upah (tampil di payslip)":
    "Pay-in-payroll benefits must map to a wage component (shown on the payslip)",
  "Buka Money Vault untuk mengoreksi nilai gaji": "Open the Money Vault to correct salary values",
  "componentId wajib": "componentId is required",
  "Data tidak ditemukan": "Data not found",
  "Ekspor hanya untuk run yang sudah dikonfirmasi": "Export is only available for confirmed runs",
  "employeeId & effectiveDate wajib diisi": "employeeId & effectiveDate are required",
  "employeeId, componentCode, fromPeriodId, toPeriodId & targetPeriodId wajib":
    "employeeId, componentCode, fromPeriodId, toPeriodId & targetPeriodId are required",
  "employeeIds (array id karyawan) wajib diisi": "employeeIds (array of employee ids) is required",
  "Entri UMP/UMK tidak ditemukan": "UMP/UMK entry not found",
  "Gagal merender bukti potong": "Failed to render the withholding tax slip",
  "Gaji pokok kosong/0 pada penempatan berlaku — karyawan TIDAK diproses (perbaiki gaji di penempatan aktif atau via PA kenaikan upah)":
    "Base salary is empty/0 on the effective assignment — the employee is NOT processed (fix the salary on the active assignment or via a salary increase PA)",
  "Hanya klaim Approved yang dapat dijadwalkan": "Only Approved claims can be scheduled",
  "Hanya klaim Approved yang dapat ditandai lunas": "Only Approved claims can be marked as settled",
  "Hanya klaim berstatus Pending yang dapat disetujui": "Only claims with Pending status can be approved",
  "Hanya klaim berstatus Pending yang dapat ditolak": "Only claims with Pending status can be rejected",
  "Hasil formula tidak berhingga (div/0?)": "The formula result is not finite (div/0?)",
  "ids wajib": "ids are required",
  "Jasa katering: bruto = seluruh jumlah penghasilan — komponen tenaga kerja/material tidak boleh dikeluarkan (Pasal 12(4)(a) PMK 168/2023)":
    "Catering services: gross = the entire income amount — labor/material components cannot be deducted (Article 12(4)(a) PMK 168/2023)",
  "Java runtime tidak tersedia di server — engine iReport (JasperReports) membutuhkan JRE 11+. Hubungi administrator.":
    "No Java runtime available on the server — the iReport engine (JasperReports) requires JRE 11+. Contact the administrator.",
  "Jendela TA: tanggal selesai sebelum tanggal mulai": "TA window: the end date is before the start date",
  "Jenis benefit belum memetakan komponen upah (payslip)":
    "The benefit type has no wage component mapping yet (payslip)",
  "Jenis benefit ini dibayar langsung dari kas (bukan via payroll)":
    "This benefit type is paid directly from cash (not via payroll)",
  "Jenis benefit ini dibayar via payroll — jadwalkan ke period":
    "This benefit type is paid via payroll — schedule it to a period",
  "Jenis benefit ini mewajibkan keterangan dokumen pendukung": "This benefit type requires supporting document notes",
  "Jenis benefit sudah kedaluwarsa": "The benefit type has expired",
  "Jenis benefit tidak ditemukan / tidak aktif": "Benefit type not found / inactive",
  "Jenis proses tidak ditemukan": "Process type not found",
  "Jumlah harus angka positif": "The amount must be a positive number",
  "Jumlah pinjaman harus > 0": "The loan amount must be > 0",
  "Jumlah upah minimum per bulan harus angka positif": "The monthly minimum wage must be a positive number",
  "Jurnal hanya dapat dibuat untuk run yang dikonfirmasi/dibayar":
    "Journals can only be created for confirmed/paid runs",
  "Jurnal tidak ditemukan": "Journal not found",
  "Karyawan & komponen wajib dipilih": "Employee & component must be selected",
  "Karyawan terpilih tidak memiliki baris hasil pada run ini": "The selected employees have no result rows on this run",
  "Karyawan tidak memiliki data payroll final pada tahun tersebut":
    "The employee has no final payroll data for that year",
  "Karyawan tidak memiliki penempatan (assignment) — upah PHK tidak dapat ditentukan":
    "The employee has no assignment — severance pay cannot be determined",
  "Karyawan, jenis benefit & nilai klaim (lebih dari 0) wajib diisi":
    "Employee, benefit type & claim amount (greater than 0) are required",
  "Karyawan, no surat, jumlah pinjaman & jumlah cicilan wajib":
    "Employee, letter no., loan amount & installment count are required",
  "kind ('salary'|'template') dan rowId wajib": "kind ('salary'|'template') and rowId are required",
  "Klaim yang sudah dibayar/ditolak tidak dapat dibatalkan":
    "Claims that have been paid/rejected can no longer be cancelled",
  "Kode & nama akun wajib": "Account code & name are required",
  "Kode & nama event wajib": "Event code & name are required",
  "Kode & nama grup wajib": "Group code & name are required",
  "Kode & nama wajib diisi": "Code & name are required",
  "Kode dan nama komponen wajib diisi": "Component code and name are required",
  "Kode dan nama mitra wajib diisi": "Partner code and name are required",
  "Komponen dikeluarkan harus angka ≥ 0": "Deducted components must be a number ≥ 0",
  "Komponen dikeluarkan tidak boleh melebihi penghasilan bruto (Pasal 12(4)(b))":
    "Deducted components cannot exceed gross income (Article 12(4)(b))",
  "Komponen khusus perlu period & jenis proses": "Custom components require a period & process type",
  "Komponen masih dipakai template/assignment — non-aktifkan saja":
    "The component is still used by templates/assignments — deactivate it instead",
  "Kurung tutup hilang": "Missing closing parenthesis",
  "Label wajib diisi (mis. UMK DKI Jakarta 2026)": "Label is required (e.g. DKI Jakarta UMK 2026)",
  "lineId wajib": "lineId is required",
  "Mitra tidak ditemukan": "Partner not found",
  "Mitra, uraian, dan tanggal bayar wajib diisi": "Partner, description, and payment date are required",
  "Nama, tanggal mulai & selesai wajib diisi": "Name, start & end dates are required",
  "Nilai baru per bulan harus > 0": "The new monthly value must be > 0",
  "Nilai gaji tidak valid": "Invalid salary value",
  "Nominal bonus harus lebih dari 0": "The bonus amount must be greater than 0",
  "Parameter year (tahun pajak) wajib": "The year parameter (tax year) is required",
  "partnerId wajib — pembayaran hanya dapat dibatalkan (jejak pajak), bukan dihapus":
    "partnerId is required — payments can only be cancelled (tax trail), not deleted",
  "PayrollRegulation aktif tidak ditemukan — jalankan seed": "Active PayrollRegulation not found — run the seed",
  "Pembayaran final tidak dapat diubah — batalkan bila salah":
    "Final payments cannot be edited — cancel it if it is wrong",
  "Pembayaran tidak ditemukan": "Payment not found",
  "Penghasilan bruto harus angka > 0": "Gross income must be a number > 0",
  "Period & jenis proses wajib dipilih": "Period & process type must be selected",
  "Period sudah ditutup/terkunci": "The period is already closed/locked",
  "periodId wajib utk schedule": "periodId is required for scheduling",
  "periodId, processTypeId & wageComponentId wajib dipilih":
    "periodId, processTypeId & wageComponentId must be selected",
  "Persentase gaji harus di rentang 0-100%": "The salary percentage must be in the 0-100% range",
  "Pilih minimal satu karyawan untuk dihitung ulang": "Select at least one employee to recalculate",
  "Pilih minimal satu karyawan untuk target manual": "Select at least one employee for the manual target",
  "Pilih minimal satu unit organisasi untuk target unit": "Select at least one organizational unit for the unit target",
  "Pilih status kepegawaian untuk target status": "Select an employment status for the status target",
  "Pinjaman menunggu persetujuan — aksi wajib approve|reject|cancel":
    "The loan is awaiting approval — action must be approve|reject|cancel",
  "Pinjaman tidak ditemukan": "Loan not found",
  "Process type tidak ditemukan": "Process type not found",
  "Profil payroll belum dibuat — PTKP default TK0 & metode GrossToNet dipakai":
    "No payroll profile yet — the default PTKP TK0 & GrossToNet method are used",
  "ptkpSource harus 'auto' atau 'manual'": "ptkpSource must be 'auto' or 'manual'",
  "Rapel lintas tahun pajak belum didukung — pilih range dalam satu tahun":
    "Retro pay across tax years is not supported yet — choose a range within a single year",
  "Regulasi aktif tidak ditemukan": "Active regulation not found",
  "report wajib": "report is required",
  "Run harus berstatus Calculated sebelum dikonfirmasi": "The run must be Calculated before it can be confirmed",
  "Run harus Confirmed sebelum ditandai dibayar": "The run must be Confirmed before it can be marked paid",
  "Run payroll tidak ditemukan": "Payroll run not found",
  "Run sudah dibayar — koreksi via run koreksi/rapel, bukan hitung ulang":
    "The run is already paid — correct it via a correction/retroactive run, not by recalculating",
  "Run sudah dikonfirmasi — jurnal/cicilan terpasang; buat run koreksi/rapel, atau hubungi admin untuk reversi manual":
    "The run is already confirmed — journals/installments are attached; create a correction/retroactive run, or contact the admin for a manual reversal",
  "Run tidak memiliki baris hasil": "The run has no result rows",
  "Run yang sudah dibayar tidak bisa dibatalkan": "Paid runs cannot be cancelled",
  "Run yang sudah dikonfirmasi/dibayar tidak dapat dihapus": "Confirmed/paid runs cannot be deleted",
  "Run yang sudah dikonfirmasi/dibayar tidak dapat dihitung ulang": "Confirmed/paid runs cannot be recalculated",
  "runId / year wajib untuk pool karyawan": "runId / year is required for the employee pool",
  "runId & lineId wajib": "runId & lineId are required",
  "Slip gaji belum final (run belum dikonfirmasi/dibayar)":
    "The payslip is not final yet (the run is not confirmed/paid)",
  "Slip hanya bisa dikirim untuk run Confirmed/Paid": "Slips can only be sent for Confirmed/Paid runs",
  "Slip tidak berada pada run terpilih": "The slip is not on the selected run",
  "Status run berubah — muat ulang halaman dan coba lagi": "The run status changed — reload the page and try again",
  "Status tidak valid": "Invalid status",
  "Tahun tidak valid (2000–2999)": "Invalid year (2000–2999)",
  "Tahun wajib valid (2000–2100)": "The year must be valid (2000–2100)",
  "Target mode harus all / unit / status / custom": "Target mode must be all / unit / status / custom",
  "Template upah belum ditetapkan pada Profil Payroll — karyawan TIDAK diproses (tetapkan template di menu Profil Payroll)":
    "No wage template set on the Payroll Profile — the employee is NOT processed (set the template in the Payroll Profile menu)",
  "Template upah mengikuti riwayat yang berlaku hari ini — ubah via Personnel Action (kenaikan jabatan) atau koreksi baris di Riwayat":
    "The wage template follows the history in effect today — change it via a Personnel Action (promotion) or correct the row in History",
  "Tidak ada karyawan aktif yang cocok dengan target": "No active employees match the target",
  "Tidak ada karyawan terpilih yang bisa dihitung ulang (lihat pesan skip)":
    "None of the selected employees can be recalculated (see the skip messages)",
  "Tidak ada period payroll — settlement tidak dapat dijadwalkan ke run TERMINATION":
    "No payroll period — the settlement cannot be scheduled to a TERMINATION run",
  "Tidak ada period yang sudah diproses final dalam range rapel":
    "No periods have been final-processed within the retro pay range",
  "Tidak ada perubahan": "No changes",
  "Tidak ada versi penempatan yang berlaku pada period ini — dilewati":
    "No assignment version is in effect for this period — skipped",
  "Tidak bisa membatalkan — sudah ada cicilan terpotong payroll":
    "Cannot cancel — installments have already been deducted from payroll",
  "year & employeeId wajib": "year & employeeId are required",
  // ---- time-attendance (93) ----
  "action wajib approve|reject untuk operasi massal": "action must be approve|reject for bulk operations",
  "Ada kode tipe hari tidak dikenal / tidak aktif": "Some day-type codes are unknown / inactive",
  "Alasan koreksi maksimal 300 karakter": "Correction reason must be at most 300 characters",
  "Alasan koreksi wajib diisi (tercatat di log aktivitas)":
    "Correction reason is required (recorded in the activity log)",
  "API key perangkat tidak valid — periksa format ovdev_{tenantSlug}_{secret} dan konfigurasi Pengaturan Kehadiran (Device Push)":
    "Invalid device API key — check the ovdev_{tenantSlug}_{secret} format and the Attendance Settings configuration (Device Push)",
  "Arah clock harus IN atau OUT": "Clock direction must be IN or OUT",
  "Baris rekap tidak ditemukan": "Recap row not found",
  "Body JSON wajib berisi data punch": "The JSON body must contain punch data",
  "burnoutOtHoursMonthly harus 0–200 jam": "burnoutOtHoursMonthly must be 0–200 hours",
  "Catatan keputusan maksimal 300 karakter": "Decision notes must be at most 300 characters",
  "Catatan maksimal 500 karakter": "Notes must be at most 500 characters",
  "claimId wajib": "claimId is required",
  "Cycle 1–28 hari": "Cycle of 1–28 days",
  "faceVerifyMode harus off, warn, atau strict": "faceVerifyMode must be off, warn, or strict",
  "fatigueMaxConsecutiveNights harus 0–10 (0 = nonaktif)": "fatigueMaxConsecutiveNights must be 0–10 (0 = disabled)",
  "fatigueMinRestHours harus 0–36 jam (0 = nonaktif)": "fatigueMinRestHours must be 0–36 hours (0 = disabled)",
  "File log wajib dilampirkan (field \"file\")": "A log file must be attached (field \"file\")",
  "File tidak terbaca (rusak / bukan CSV-Excel) — periksa format file":
    "The file cannot be read (corrupt / not Excel CSV) — check the file format",
  "Format jam tidak valid": "Invalid time format",
  "geofenceMode harus Off, Warn, atau Strict": "geofenceMode must be Off, Warn, or Strict",
  "Hanya file .csv atau .xlsx yang didukung": "Only .csv or .xlsx files are supported",
  "Hanya izin berstatus Pending yang dapat disetujui": "Only permits with Pending status can be approved",
  "Hanya izin berstatus Pending yang dapat ditolak": "Only permits with Pending status can be rejected",
  "Hanya perintah berstatus Pending yang dapat disetujui": "Only orders with Pending status can be approved",
  "Hanya perintah berstatus Pending yang dapat ditolak": "Only orders with Pending status can be rejected",
  "Hari libur tidak ditemukan": "Holiday not found",
  "Header X-Api-Key wajib diisi (format ovdev_{tenantSlug}_{secret})":
    "The X-Api-Key header is required (format ovdev_{tenantSlug}_{secret})",
  "id & action (approve|reject) wajib": "id & action (approve|reject) are required",
  "id baris rekap (AttendanceDaily) wajib": "Recap row id (AttendanceDaily) is required",
  "id posting wajib": "Post id is required",
  "ids wajib diisi (array id dokumen izin)": "ids is required (array of permit document ids)",
  "ids wajib diisi (array nomor/id dokumen)": "ids is required (array of document numbers/ids)",
  "Izin maksimal 30 hari sekali pengajuan": "Permits are limited to 30 days per request",
  "Izin setengah hari wajib mengisi jam mulai": "Half-day permits must fill in the start time",
  "Izin tidak dibayar namun tidak memotong cuti — konfigurasi tidak sah":
    "An unpaid permit that does not deduct leave — invalid configuration",
  "Izin tidak ditemukan": "Permit not found",
  "Izin yang sudah ditolak/selesai tidak dapat dibatalkan":
    "Permits that have been rejected/completed can no longer be cancelled",
  "Jadwal tidak ditemukan": "Schedule not found",
  "Jadwal tidak ditemukan / tidak aktif": "Schedule not found / inactive",
  "Jam mulai/selesai harus format HH:MM dengan jam 00–23 dan menit 00–59":
    "Start/end times must be in HH:MM format with hours 00–23 and minutes 00–59",
  "Jendela absensi tidak valid — tanggal selesai sebelum tanggal mulai":
    "Invalid attendance window — the end date is before the start date",
  "Jendela tanggal absensi tidak valid (YYYY-MM-DD)": "Invalid attendance date window (YYYY-MM-DD)",
  "Jenis harus National|Joint|Company": "Type must be National|Joint|Company",
  "Jumlah slot harus bilangan bulat 1–20": "The number of slots must be an integer between 1–20",
  "Karyawan & jadwal wajib dipilih": "Employee & schedule must be selected",
  "Karyawan pengklaim tidak ditemukan / sudah tidak aktif": "Claiming employee not found / no longer active",
  "Klaim open shift tidak ditemukan": "Open shift claim not found",
  "Kode & nama jadwal wajib diisi": "Schedule code & name are required",
  "Kode & nama tipe hari wajib diisi": "Day type code & name are required",
  "Log clock tidak ditemukan": "Clock log not found",
  "Maksimal 500 baris per import": "At most 500 rows per import",
  "Nama libur wajib 1–120 karakter": "The holiday name must be 1–120 characters",
  "op tidak dikenal — pilihan: close|cancel|approve-claim|reject-claim":
    "Unknown op — options: close|cancel|approve-claim|reject-claim",
  "Open shift hanya bisa diposting maksimal 30 hari ke depan": "Open shifts can only be posted up to 30 days ahead",
  "otBasisMode harus BASE atau BASE_FIXED": "otBasisMode must be BASE or BASE_FIXED",
  "otCapMode harus PP35, KEPMEN102, atau CUSTOM": "otCapMode must be PP35, KEPMEN102, or CUSTOM",
  "otWorkweekDays harus 5 atau 6": "otWorkweekDays must be 5 or 6",
  "paidFlag harus boolean": "paidFlag must be a boolean",
  "Parameter employeeId wajib — pilih karyawan pada halaman penugasan jadwal":
    "The employeeId parameter is required — select an employee on the schedule assignment page",
  "Parameter export tidak dikenal — gunakan ?export=kpi": "Unknown export parameter — use ?export=kpi",
  "Parameter from & to wajib (YYYY-MM-DD)": "The from & to parameters are required (YYYY-MM-DD)",
  "Parameter from harus sebelum to": "The from parameter must be before to",
  "Parameter id laporan tidak dikenal (ar11…ar43)": "Unknown report id parameter (ar11…ar43)",
  "Parameter id log clock wajib": "The clock log id parameter is required",
  "Penugasan sudah berakhir": "The assignment has already ended",
  "Perintah lembur tidak ditemukan": "Overtime order not found",
  "Perintah yang sudah dibayar/ditolak tidak dapat dibatalkan":
    "Orders that have been paid/rejected can no longer be cancelled",
  "Period payroll wajib dipilih": "A payroll period must be selected",
  "Permintaan tukar shift tidak ditemukan": "Shift swap request not found",
  "Persetujuan karyawan wajib dicatat sebelum mengajukan lembur (PP 35/2021 Pasal 28 ayat 1)":
    "The employee's consent must be recorded before submitting overtime (PP 35/2021 Article 28 paragraph 1)",
  "scheduleId & dayTypeId wajib dipilih": "scheduleId & dayTypeId must be selected",
  "selfieMode harus off, warn, atau required": "selfieMode must be off, warn, or required",
  "SESSION_SECRET belum dikonfigurasi — token QR kios tidak bisa dihitung":
    "SESSION_SECRET is not configured — kiosk QR tokens cannot be computed",
  "Tabel OpenShift belum tersedia di schema tenant — jalankan scripts/migrate-attendance-advance.ts (Task 100-impl-C) sebelum memakai open shift marketplace":
    "The OpenShift table is not yet available in the tenant schema — run scripts/migrate-attendance-advance.ts (Task 100-impl-C) before using the open shift marketplace",
  "Tanggal & jam wajib (YYYY-MM-DD, HH:MM)": "Date & time are required (YYYY-MM-DD, HH:MM)",
  "Tanggal awal tidak boleh setelah tanggal akhir": "The start date cannot be after the end date",
  "Tanggal kerja wajib format YYYY-MM-DD": "The work date must be in YYYY-MM-DD format",
  "Tanggal lembur tidak valid (YYYY-MM-DD)": "Invalid overtime date (YYYY-MM-DD)",
  "Tanggal mulai tidak valid (YYYY-MM-DD)": "Invalid start date (YYYY-MM-DD)",
  "Tanggal open shift tidak boleh di masa lalu": "The open shift date cannot be in the past",
  "Tanggal tidak valid (YYYY-MM-DD)": "Invalid date (YYYY-MM-DD)",
  "Tanggal wajib (YYYY-MM-DD)": "Date is required (YYYY-MM-DD)",
  "Tidak ada baris data terbaca di bawah header": "No data rows detected below the header",
  "Tidak ada data punch di body (field punches / data / array)":
    "No punch data in the body (field punches / data / array)",
  "Tidak ada perubahan (date/name/kind)": "No changes (date/name/kind)",
  "Tipe hari kerja wajib punya jam masuk & keluar": "Working day types must have clock-in & clock-out times",
  "Tipe hari posting tidak ditemukan pada cycle jadwal — posting tidak konsisten, batalkan dan buat ulang":
    "The post's day type was not found on the schedule cycle — the post is inconsistent; cancel it and create it again",
  "Tipe hari tidak ditemukan": "Day type not found",
  "Tipe hari tidak ditemukan / tidak aktif": "Day type not found / inactive",
  "Verifikasi hanya untuk perintah yang sudah disetujui": "Verification is only for approved orders",
  "Waktu clock tidak boleh di masa depan (toleransi 5 menit)":
    "The clock time cannot be in the future (5-minute tolerance)",
  "Waktu clock tidak boleh lebih dari 30 hari ke belakang — gunakan regenerasi rekap untuk koreksi histori":
    "The clock time cannot be more than 30 days in the past — use recap regeneration to correct history",
  "Workspace tidak ditemukan / tidak aktif": "Workspace not found / inactive",
  // ---- travel (19) ----
  "Aksi tidak dikenal": "Unknown action",
  "Biaya dibayar pihak lain (a) tidak boleh melebihi total rincian + rugi kurs":
    "Costs paid by another party (a) cannot exceed the total line items + exchange loss",
  "Field file wajib berupa berkas gambar kwitansi": "The file field must be a receipt image",
  "Format harus JPG/PNG/WEBP (foto struk)": "The format must be JPG/PNG/WEBP (receipt photo)",
  "Jawaban VLM bukan JSON yang bisa dibaca": "The VLM answer is not readable JSON",
  "kind harus template | expense": "kind must be template | expense",
  "Kode & nama jenis biaya wajib diisi": "Expense type code & name are required",
  "Kode & nama template wajib diisi": "Template code & name are required",
  "Komponen upah UTRP/TRVSTLIN belum didefinisikan (hubungi admin)":
    "The UTRP/TRVSTLIN wage components have not been defined (contact the admin)",
  "Minimal 1 destinasi perjalanan": "At least 1 travel destination is required",
  "Parameter id laporan tidak dikenal (tr11…tr43)": "Unknown report id parameter (tr11…tr43)",
  "Perjalanan lebih dari 60 hari — hubungi HR (validasi manual)":
    "Trips longer than 60 days — contact HR (manual validation)",
  "Permintaan travel milik karyawan lain": "The travel request belongs to another employee",
  "Permintaan travel tidak ditemukan": "Travel request not found",
  "Tahun wajib valid": "The year must be valid",
  "Tidak ada klaim berstatus Approved yang siap ditransfer": "No Approved claims are ready to be transferred",
  "Tujuan perjalanan wajib diisi": "Travel destination is required",
  "Ukuran gambar maks 5 MB": "The image must be at most 5 MB",
  "VLM gagal": "VLM failed",
  "VLM mengembalikan jawaban kosong": "The VLM returned an empty answer",
  // ---- ESS (mobile) (48) ----
  "Aksi tidak dikenal — ESS hanya dapat membatalkan": "Unknown action — ESS can only cancel",
  "Akun tidak terhubung data karyawan": "The account is not linked to an employee record",
  "Alasan izin wajib diisi": "Permit reason is required",
  "Alasan lembur wajib diisi": "Overtime reason is required",
  "Alasan tukar shift wajib diisi": "Shift swap reason is required",
  "Anda sudah mengajukan klaim untuk posting open shift ini":
    "You have already submitted a claim for this open shift post",
  "Belum ada clock-in hari ini (atau kemarin sejak tengah hari) yang belum ditutup clock-out — clock-out wajib setelah clock-in":
    "No open clock-in today (or since midday yesterday) is awaiting a clock-out — clock-out must follow clock-in",
  "Catatan maksimal 300 karakter": "Notes must be at most 300 characters",
  "Data karyawan Anda tidak aktif — hubungi HR": "Your employee record is inactive — contact HR",
  "Data karyawan tidak ditemukan": "Employee data not found",
  "direction harus IN atau OUT": "direction must be IN or OUT",
  "Foto selfie gagal disimpan": "Failed to save the selfie photo",
  "Foto selfie harus JPG atau PNG": "The selfie photo must be JPG or PNG",
  "Foto selfie wajib dilampirkan saat presensi (mode Selfie Wajib) — ambil foto lalu ulangi":
    "A selfie photo must be attached when clocking in (Mandatory Selfie mode) — take a photo and try again",
  "Hanya pemohon yang dapat membatalkan permintaan ini": "Only the requester can cancel this request",
  "Jadwal Anda non-clocking (jam kerja dianggap normal) — clock tidak diperlukan":
    "Your schedule is non-clocking (working hours are assumed normal) — clocking is not required",
  "Jam mulai/selesai wajib format HH:MM (00:00–23:59)": "Start/end times must be in HH:MM format (00:00–23:59)",
  "Jenis benefit wajib dipilih": "A benefit type must be selected",
  "Jenis cuti wajib dipilih": "A leave type must be selected",
  "Jenis surat tidak tersedia": "Letter type not available",
  "Jenis surat wajib dipilih": "A letter type must be selected",
  "Keperluan maksimal 200 karakter": "Purpose must be at most 200 characters",
  "Klaim wajib memuat minimal satu baris perawatan": "A claim must contain at least one treatment line",
  "Kwitansi asli/tagihan tetap diserahkan ke HR untuk verifikasi sebelum klaim disetujui.":
    "Original receipts/bills are still submitted to HR for verification before the claim is approved.",
  "Kwitansi asli tiap biaya tetap diserahkan ke HR/Finance untuk verifikasi sebelum klaim disetujui.":
    "Original receipts for each expense are still submitted to HR/Finance for verification before the claim is approved.",
  "Kode TSK unik tidak berhasil dialokasikan setelah 3 percobaan — coba ulang sesaat lagi":
    "Failed to allocate a unique TSK code after 3 attempts — try again in a moment",
  "Lampiran tidak ditemukan/d sudah terpakai — unggah ulang kwitansi":
    "Attachment not found / already used — re-upload the receipt",
  "latitude tidak valid": "Invalid latitude",
  "lineId wajib diisi": "lineId is required",
  "longitude tidak valid": "Invalid longitude",
  "Pengajuan dinas tidak ditemukan / bukan milik Anda": "Travel request not found / not yours",
  "Pengumuman belum diterbitkan": "The announcement has not been published yet",
  "Pilih pengajuan dinas sebagai dasar klaim, atau pilih template untuk klaim mandiri":
    "Select a travel request as the claim basis, or choose a template for a standalone claim",
  "postId posting wajib dipilih": "The post's postId must be selected",
  "Posting sudah lewat tanggalnya": "The post's date has already passed",
  "Rekan tujuan tidak ditemukan atau tidak aktif": "Swap partner not found or inactive",
  "Rekan tujuan tukar wajib dipilih": "A swap partner must be selected",
  "Surat belum diterbitkan": "The letter has not been issued yet",
  "Tabel OpenShift belum tersedia di schema tenant — hubungi admin (jalankan migrasi Task 100-impl-C)":
    "The OpenShift table is not yet available in the tenant schema — contact the admin (run the Task 100-impl-C migration)",
  "Tanggal klaim wajib format YYYY-MM-DD": "The claim date must be in YYYY-MM-DD format",
  "Tanggal lembur wajib format YYYY-MM-DD": "The overtime date must be in YYYY-MM-DD format",
  "Tanggal mulai wajib format YYYY-MM-DD": "The start date must be in YYYY-MM-DD format",
  "Tanggal mulai/selesai wajib format YYYY-MM-DD": "Start/end dates must be in YYYY-MM-DD format",
  "Tanggal selesai wajib format YYYY-MM-DD": "The end date must be in YYYY-MM-DD format",
  "Tanggal tukar tidak boleh di masa lalu": "The swap date cannot be in the past",
  "Tanggal tukar tidak valid": "Invalid swap date",
  "Tidak ada jadwal kerja aktif untuk Anda pada hari ini — hubungi HR":
    "You have no active work schedule today — contact HR",
  "Tidak bisa mengajukan tukar shift dengan diri sendiri": "You cannot request a shift swap with yourself",
  "Ukuran foto selfie maksimal 2 MB": "The selfie photo must be at most 2 MB",
  "Verifikasi wajah gagal — foto selfie tidak cocok dengan foto referensi Anda. Hubungi HR bila ini keliru.":
    "Face verification failed — the selfie photo does not match your reference photo. Contact HR if this is a mistake.",
  // ---- whistleblowing (17) ----
  "action tidak dikenal (receive|investigate|resolve|close|assign|note)":
    "Unknown action (receive|investigate|resolve|close|assign|note)",
  "Alasan penutupan minimal 10 karakter (laporan ditutup tanpa tindak lanjut — wajib beralasan)":
    "Closing reason must be at least 10 characters (a report closed without follow-up must be justified)",
  "assignedToId wajib": "assignedToId is required",
  "Catatan hasil penyelesaian minimal 10 karakter": "Resolution notes must be at least 10 characters",
  "Catatan kosong": "Notes are empty",
  "Hanya laporan berstatus Baru yang bisa diterima": "Only reports with New status can be accepted",
  "Kategori laporan tidak dikenal": "Unknown report category",
  "Laporan harus berstatus Investigasi sebelum diselesaikan":
    "The report must be under Investigation before it can be resolved",
  "Laporan tersimpan dengan identitas Anda — tim penangan akan menghubungi untuk tindak lanjut.":
    "The report was saved with your identity — the handling team will contact you for follow-up.",
  "Laporan tersimpan SECARA ANONIM — identitas Anda tidak disimpan di sistem. Simpan nomor tiket untuk mengecek perkembangan.":
    "The report was saved ANONYMOUSLY — your identity is not stored in the system. Keep the ticket number to check its progress.",
  "Laporan tidak ditemukan": "Report not found",
  "Penangan tidak ditemukan": "Handler not found",
  "Tanggal kejadian tidak boleh di masa depan": "The incident date cannot be in the future",
  "Tanggal kejadian tidak valid": "Invalid incident date",
  "Terima laporan dulu sebelum investigasi": "Accept the report before investigating",
  "Uraian kejadian minimal 20 karakter — jelaskan kronologi singkat agar dapat ditindaklanjuti":
    "The incident description must be at least 20 characters — briefly explain the chronology so it can be followed up",
  "Uraian maksimum 4.000 karakter": "The description must be at most 4,000 characters",
  // ---- public (checklist publik) (6) ----
  "Proses sudah selesai/dibatalkan — tidak bisa diubah":
    "The process is already completed/cancelled — it cannot be changed",
  "Proses tidak ditemukan": "Process not found",
  "Status tidak valid (Done/Pending/Na)": "Invalid status (Done/Pending/Na)",
  "Tautan tidak valid": "Invalid link",
  "Tenant tidak dikenal": "Unknown tenant",
  "Tugas tidak termasuk bagian Anda": "The task is not your section's",
  // ---- shared / integrasi (email, WA, AI, webhook, approval, lampiran) (127) ----
  "Access group tidak ditemukan": "Access group not found",
  "action harus issue atau reject": "action must be issue or reject",
  "AI bawaan mengembalikan jawaban kosong — coba ulangi": "The built-in AI returned an empty answer — please try again",
  "Akses ditolak: hanya pengunggah, pemilik proses, atau HR (aksi ubah menu terkait) yang dapat menghapus lampiran ini":
    "Access denied: only the uploader, the process owner, or HR (with edit access to the related menu) can delete this attachment",
  "Akses ditolak: hanya pengunggah, pemilik proses, atau pemegang akses LIHAT menu terkait yang dapat membuka lampiran ini":
    "Access denied: only the uploader, the process owner, or holders of the related menu's VIEW access can open this attachment",
  "Akses ditolak: role Viewer hanya dapat melihat data, tidak melakukan aksi bisnis. Hubungi admin workspace.":
    "Access denied: the Viewer role can only view data, not perform business actions. Contact the workspace admin.",
  "Akses ditolak: webhook hanya boleh dikelola oleh Admin platform / AppUser Admin (superadmin).":
    "Access denied: webhooks can only be managed by platform Admins / AppUser Admins (superadmins).",
  "Akun tidak memiliki profil pengguna tenant": "The account has no tenant user profile",
  "Alamat email tujuan tidak valid": "The destination email address is invalid",
  "Alamat email tujuan uji tidak valid": "The test destination email address is invalid",
  "API key provider AI belum disetel (atau gagal didekripsi) — isi di Pengaturan → Provider AI":
    "The AI provider API key has not been set (or failed to decrypt) — fill it in under Settings → AI Provider",
  "API key wajib diisi untuk provider OpenAI-compatible": "An API key is required for OpenAI-compatible providers",
  "Approver & delegate wajib": "Approver & delegate are required",
  "Approver asal dan pendelegasian wajib dipilih": "The source approver and delegate must be selected",
  "Base URL wajib dan harus diawali http(s)://": "Base URL is required and must start with http(s)://",
  "Berkas fisik lampiran tidak ditemukan di penyimpanan": "The attachment file was not found in storage",
  "Berkas kosong — pilih file lain": "Empty file — choose another file",
  "Catatan disiplin tidak ditemukan": "Disciplinary record not found",
  "category harus Disciplinary, PersonnelAction, atau EmployeeService":
    "category must be Disciplinary, PersonnelAction, or EmployeeService",
  "Daftar nilai maksimal 50 item": "The value list must contain at most 50 items",
  "Data perusahaan belum di-setup": "Company data has not been set up",
  "Delegasi approval dibuat": "Approval delegation created",
  "Delegasi approval diperbarui": "Approval delegation updated",
  "Delegasi tidak ditemukan": "Delegation not found",
  "disciplinaryRecordId wajib": "disciplinaryRecordId is required",
  "docType tidak valid": "Invalid docType",
  "Dokumen pengajuan tidak ditemukan": "Request document not found",
  "domain tidak valid (leave|medical|travel|benefit)": "Invalid domain (leave|medical|travel|benefit)",
  "Email karyawan kosong": "Employee email is empty",
  "Email pengirim (from) wajib alamat email valid": "The sender email (from) must be a valid email address",
  "Email pengirim bukan alamat valid": "The sender email is not a valid address",
  "Email terkirim": "Email sent",
  "employeeId wajib untuk simulasi": "employeeId is required for simulation",
  "Endpoint harus URL http(s) valid": "The endpoint must be a valid http(s) URL",
  "Endpoint provider belum diisi": "The provider endpoint has not been filled in",
  "entityId wajib": "entityId is required",
  "entityId wajib diisi": "entityId is required",
  "entityType tidak dikenal": "Unknown entityType",
  "Field file wajib berupa berkas": "The file field must be a file",
  "filters harus berupa array": "filters must be an array",
  "Format ekspor harus csv atau xlsx": "The export format must be csv or xlsx",
  "Gagal menerbitkan surat": "Failed to issue the letter",
  "ID delegasi wajib disertakan": "A delegation id must be provided",
  "ID grup wajib disertakan": "A group id must be provided",
  "id laporan wajib": "Report id is required",
  "id rule wajib": "Rule id is required",
  "id template wajib": "Template id is required",
  "id webhook wajib": "Webhook id is required",
  "Isi dokumen wajib diisi": "Document content is required",
  "Isi pesan maksimal 1.000 karakter (batas praktis WhatsApp)":
    "Message body must be at most 1,000 characters (a practical WhatsApp limit)",
  "Isi pesan tidak boleh kosong saat template aktif": "The message body cannot be empty while the template is active",
  "Isi tidak boleh kosong": "Content cannot be empty",
  "Jalur persetujuan tidak ditemukan untuk dokumen ini": "No approval route found for this document",
  "Jenis benefit medis tidak ditemukan": "Medical benefit type not found",
  "Jenis biaya travel tidak ditemukan": "Travel expense type not found",
  "Jenis dokumen tidak valid": "Invalid document type",
  "Jenis dokumen tidak valid (Leave|Travel|Medical|Loan)": "Invalid document type (Leave|Travel|Medical|Loan)",
  "Jenis file tidak dikenal — unggah JPG/PNG/WEBP/PDF": "Unknown file type — upload JPG/PNG/WEBP/PDF",
  "Jenjang aktif tidak ditemukan": "Active level not found",
  "Judul tidak boleh kosong": "Title cannot be empty",
  "Judul wajib diisi": "Title is required",
  "Kanal WhatsApp belum aktif": "The WhatsApp channel is not active yet",
  "Kantor induk tidak ditemukan": "Parent office not found",
  "Kantor masih memiliki lokasi kerja terhubung — pindahkan/hapus lokasi dahulu":
    "The office still has linked work locations — move/delete them first",
  "Karyawan pemohon tidak ditemukan": "Requesting employee not found",
  "Kategori & label wajib": "Category & label are required",
  "Kode & nama kantor wajib diisi": "Office code & name are required",
  "Kode & nama level jabatan wajib diisi": "Position level code & name are required",
  "Kode & nama lokasi wajib diisi": "Location code & name are required",
  "Kode & nama rule wajib diisi": "Rule code & name are required",
  "Kode & nama struktur wajib diisi": "Structure code & name are required",
  "Kode dan nama grup wajib diisi": "Group code and name are required",
  "Konfigurasi belum tersimpan": "The configuration has not been saved yet",
  "Konfigurasi email belum aktif": "The email configuration is not active yet",
  "Konfigurasi tidak ditemukan (pengguna sudah tanpa konfigurasi — default DENY, M-7)":
    "Configuration not found (the user has no configuration — default DENY, M-7)",
  "Kwitansi hanya bisa diunggah untuk klaim travel milik Anda":
    "Receipts can only be uploaded for your own travel claims",
  "Label template tidak boleh kosong": "The template label cannot be empty",
  "Lampiran tidak ditemukan": "Attachment not found",
  "Laporan tersimpan tidak ditemukan": "Saved report not found",
  "Library pengiriman email (nodemailer) belum terpasang — jalankan `npm install` atau `bun install` di folder proyek lalu restart server dev":
    "The email sending library (nodemailer) is not installed — run `npm install` or `bun install` in the project folder, then restart the dev server",
  "Minimal 1 field harus dipilih": "At least 1 field must be selected",
  "Minimal 1 jenjang approver": "At least 1 approver level is required",
  "Model wajib diisi (mis. gpt-4o-mini)": "Model is required (e.g. gpt-4o-mini)",
  "Nama file kosong": "The file name is empty",
  "Nama laporan maksimal 120 karakter": "Report name must be at most 120 characters",
  "Nama laporan wajib diisi": "Report name is required",
  "Nilai filter wajib diisi": "Filter value is required",
  "Nomor HP tujuan uji wajib diisi": "The test destination phone number is required",
  "Nomor tujuan tidak valid (contoh: 081234567899)": "Invalid destination number (example: 081234567899)",
  "Parameter ?id= wajib": "The ?id= parameter is required",
  "Parameter ?with= wajib": "The ?with= parameter is required",
  "Parameter format harus csv atau xlsx": "The format parameter must be csv or xlsx",
  "Path lampiran tidak valid": "Invalid attachment path",
  "Penerima bukan bawahan/atasan Anda yang terhubung": "The recipient is not your linked subordinate/supervisor",
  "Penerima tidak ditemukan / tidak aktif": "Recipient not found / inactive",
  "Penerima wajib": "Recipient is required",
  "personnelActionId wajib": "personnelActionId is required",
  "Pertanyaan kosong": "Empty question",
  "Pesan kosong": "Empty message",
  "Pilih minimal satu event webhook": "Select at least one webhook event",
  "Pilih minimal satu menu, atau gunakan mode Semua Menu.": "Select at least one menu, or use All Menus mode.",
  "Pilih pengguna pemegang rule (hak akses diatur per pengguna)":
    "Select the user who holds the rule (access rights are set per user)",
  "PRD markdown tidak ditemukan": "PRD markdown not found",
  "Prioritas harus angka": "Priority must be a number",
  "Provider AI tenant mengembalikan jawaban kosong": "The tenant's AI provider returned an empty answer",
  "Provider belum dikonfigurasi (token/endpoint kosong)": "The provider has not been configured (empty token/endpoint)",
  "Provider Custom wajib mengisi endpoint saat kanal diaktifkan":
    "The Custom provider requires an endpoint when the channel is activated",
  "Radius harus angka meter 1..100000": "The radius must be a number of meters 1..100000",
  "Rentang tanggal valid wajib diisi": "A valid date range is required",
  "Request harus multipart/form-data dengan field file": "The request must be multipart/form-data with a file field",
  "SMTP belum dikonfigurasi": "SMTP has not been configured",
  "SMTP host dan email pengirim belum diisi": "The SMTP host and sender email have not been filled in",
  "SMTP host wajib diisi saat notifikasi diaktifkan": "The SMTP host is required when notifications are enabled",
  "Struktur tidak ditemukan": "Structure not found",
  "Subjek template tidak boleh kosong": "The template subject cannot be empty",
  "Super admin otomatis punya akses semua menu — tidak perlu dibatasi.":
    "Super admins automatically have access to all menus — no restrictions needed.",
  "Template surat layanan tidak ditemukan": "Service letter template not found",
  "templateKey wajib": "templateKey is required",
  "Token seed tidak valid": "Invalid seed token",
  "Uji kirim webhook dari RekanKerja HRIS — konfigurasi signature & endpoint Anda benar.":
    "A test webhook delivery from RekanKerja HRIS — your signature & endpoint configuration is correct.",
  "URL webhook harus http:// atau https://": "The webhook URL must be http:// or https://",
  "URL webhook tidak valid": "Invalid webhook URL",
  "URL webhook wajib diisi": "Webhook URL is required",
  "User approver/delegate tidak ditemukan": "Approver/delegate user not found",
  "userId wajib": "userId is required",
  "userId wajib untuk simulasi": "userId is required for simulation",
  "Webhook tidak ditemukan": "Webhook not found",
  // ---- lintas modul (umum) (41) ----
  "Alasan cuti wajib diisi": "Leave reason is required",
  "Alasan maksimal 300 karakter": "Reason must be at most 300 characters",
  "Alasan penolakan wajib diisi": "Rejection reason is required",
  "appUserId wajib": "appUserId is required",
  "Body harus multipart/form-data dengan field file + dryRun":
    "The body must be multipart/form-data with file + dryRun fields",
  "Bulan tidak valid": "Invalid month",
  "employeeId wajib": "employeeId is required",
  "Faktor Multiply harus > 0": "The Multiply factor must be > 0",
  "Format email tidak valid": "Invalid email format",
  "id & kind wajib": "id & kind are required",
  "id pengumuman wajib": "Announcement id is required",
  "id wajib diisi (atau all: true)": "id is required (or all: true)",
  "Jenis benefit tidak ditemukan": "Benefit type not found",
  "Jenis cuti tidak ditemukan": "Leave type not found",
  "Kantor tidak dikenal — pilih ulang kantor": "Unknown office — reselect the office",
  "Karyawan tidak ditemukan / tidak aktif": "Employee not found / inactive",
  "Klaim tidak ditemukan": "Claim not found",
  "Klaim wajib memuat minimal 1 baris biaya": "A claim must contain at least 1 expense line",
  "Kode & nama template wajib": "Template code & name are required",
  "Minimal 1 destinasi wajib": "At least 1 destination is required",
  "Minimal satu kondisi parameter diperlukan": "At least one parameter condition is required",
  "Nama lengkap wajib diisi": "Full name is required",
  "Notifikasi tidak ditemukan": "Notification not found",
  "Parameter date harus YYYY-MM-DD": "The date parameter must be YYYY-MM-DD",
  "Parameter id wajib": "The id parameter is required",
  "Penugasan tidak ditemukan": "Assignment not found",
  "Period payroll tidak ditemukan": "Payroll period not found",
  "Period sudah ditutup/terkunci — pilih period lain": "The period is already closed/locked — choose another period",
  "periodId wajib": "periodId is required",
  "Permintaan surat tidak ditemukan": "Letter request not found",
  "Permintaan tidak ditemukan": "Request not found",
  "Semua slot posting sudah terisi": "All post slots are already filled",
  "Sesi tidak valid atau berakhir — silakan masuk kembali.": "Invalid or expired session — please sign in again.",
  "Slip gaji ini bukan milik Anda": "This payslip is not yours",
  "Slip gaji tidak ditemukan": "Payslip not found",
  "Surat tidak ditemukan": "Letter not found",
  "Tahun tidak valid": "Invalid year",
  "Tanggal selesai sebelum tanggal mulai": "The end date is before the start date",
  "Tanggal selesai tidak boleh sebelum tanggal mulai": "The end date cannot be before the start date",
  "TENANT_DB_BASE_URL belum diset": "TENANT_DB_BASE_URL is not set",
  "Tidak ada karyawan aktif": "No active employees",
};

/**
 * Aturan pesan DINAMIS (template literal server dengan data ter-interpolasi).
 * Regex berjangkar ^…$ — data (kode/nama/angka) di-capture lalu dipancangkan
 * ulang di template EN. Urutan = prioritas; match pertama menang.
 */
export const SERVER_MSG_RULES: { re: RegExp; en: string }[] = [
  // ---------- autentikasi ----------
  {
    re: /^Email atau kata sandi salah \(sisa (\d+) percobaan sebelum akun terkunci\)\.$/,
    en: "Incorrect email or password ($1 attempts left before the account is locked).",
  },
  {
    re: /^Akun terkunci sementara karena terlalu banyak percobaan gagal\. Coba lagi dalam (\d+) menit atau minta admin mereset kata sandi Anda\.$/,
    en: "Account temporarily locked due to too many failed attempts. Try again in $1 minutes, or ask an admin to reset your password.",
  },
  {
    re: /^Terlalu banyak percobaan gagal — akun terkunci (\d+) menit\.$/,
    en: "Too many failed attempts — account locked for $1 minutes.",
  },
  {
    re: /^Kata sandi belum memenuhi syarat: (.+)$/,
    en: "Password does not meet the requirements: $1",
  },
  {
    re: /^Kata sandi baru sama dengan kata sandi lama Anda \(riwayat ke-(\d+)\) — tidak boleh sama dengan (\d+) kata sandi terakhir\.$/,
    en: "The new password matches an old one (history #$1) — it must differ from the last $2 passwords.",
  },
  {
    re: /^Kode perusahaan harus (.+?) — mengikuti alamat (.+)\.$/,
    en: "Company code must be $1 — following the address $2.",
  },
  // ---------- duplikasi kode / email ----------
  { re: /^Kode (.+?) sudah dipakai$/, en: "Code $1 is already in use" },
  { re: /^Kode '(.+?)' sudah dipakai grup lain$/, en: "Code '$1' is already used by another group" },
  { re: /^Kode period (.+?) sudah dipakai$/, en: "Period code $1 is already in use" },
  { re: /^No surat (.+?) sudah dipakai$/, en: "Letter no. $1 is already in use" },
  { re: /^Email (.+?) sudah dipakai pengguna lain di workspace ini$/, en: "Email $1 is already used by another user in this workspace" },
  { re: /^Email (.+?) sudah dipakai pengguna lain$/, en: "Email $1 is already used by another user" },
  { re: /^Email (.+?) sudah terdaftar akun SaaS lain$/, en: "Email $1 is already registered to another SaaS account" },
  {
    re: /^Email (.+?) sudah terdaftar sebagai akun SaaS — gunakan email lain \(sandi akun terdaftar tidak boleh ditimpa\)\.$/,
    en: "Email $1 is already registered as a SaaS account — use a different email (a registered account's password cannot be overwritten).",
  },
  { re: /^Username (.+?) sudah dipakai$/, en: "Username $1 is already in use" },
  // ---------- payroll: run / period ----------
  {
    re: /^Run (.+?) berstatus (.+?) — hitung \(calculate\) payroll terlebih dahulu$/,
    en: "Run $1 has status $2 — calculate the payroll first",
  },
  {
    re: /^Run (.+?) pada period (.+?) berstatus (.+?) — bonus massal hanya dapat diproses ke run Draft\. Batalkan\/hapus run tersebut atau pilih period lain$/,
    en: "Run $1 on period $2 has status $3 — mass bonuses can only be processed into a Draft run. Cancel/delete that run or choose another period",
  },
  {
    re: /^Run RAPEL (.+?) pada period (.+?) berstatus (.+?) — assignment rapel hanya dapat diproses run Draft\. Batalkan\/hapus run tersebut atau pilih period target lain$/,
    en: "Run RAPEL $1 on period $2 has status $3 — retroactive assignments can only be processed into a Draft run. Cancel/delete that run or choose another target period",
  },
  {
    re: /^Run (.+?) untuk period × jenis proses ini sudah dibayar — komponen khusus tidak akan pernah diproses; buat run koreksi\/rapel pada period lain$/,
    en: "Run $1 for this period × process type has already been paid — custom components will never be processed; create a correction/retroactive run on another period",
  },
  {
    re: /^Run aktif untuk period\+jenis sudah ada \((.+?) × (.+?)\) — konflik terdeteksi, muat ulang daftar run$/,
    en: "An active run already exists for this period + process type ($1 × $2) — conflict detected, reload the run list",
  },
  { re: /^Period (.+?) sudah ditutup$/, en: "Period $1 is already closed" },
  { re: /^Period (.+?) sudah terkunci$/, en: "Period $1 is already locked" },
  {
    re: /^Period (.+?) sudah (.+?) — pilih period yang masih terbuka$/,
    en: "Period $1 is already $2 — choose a period that is still open",
  },
  { re: /^Period target (.+?) sudah (.+)$/, en: "Target period $1 is already $2" },
  {
    re: /^Rentang tanggal beririsan dengan period (.+?) \((.+?): (.+?) s\.d\. (.+?)\) — dua period tidak boleh menutup hari yang sama$/,
    en: "Date range overlaps period $1 ($2: $3 to $4) — two periods must not cover the same day",
  },
  {
    re: /^Period untuk bulan pajak (.+?) sudah ada \((.+?)\)$/,
    en: "A period for tax month $1 already exists ($2)",
  },
  {
    re: /^Terdapat (\d+) run belum selesai \(Draft\/Calculated\) — selesaikan dulu sebelum menutup period$/,
    en: "$1 runs are still unfinished (Draft/Calculated) — finish them before closing the period",
  },
  {
    re: /^Masih ada (.+?) klaim benefit belum dibayar \(Pending\/Approved\/Scheduled\) pada period (.+?) — bayar via run payroll BENEFIT, tolak, atau batalkan klaim terlebih dahulu$/,
    en: "$1 benefit claims are still unpaid (Pending/Approved/Scheduled) on period $2 — pay them via a BENEFIT payroll run, reject, or cancel the claims first",
  },
  { re: /^(\d+) period tidak bisa dihapus \(punya run\/klaim\/assignment, atau tidak berstatus Open\)$/, en: "$1 periods cannot be deleted (they have runs/claims/assignments, or are not Open)" },
  { re: /^Sudah ada entri tahun (\d+) untuk (.+?) — ubah entri yang ada$/, en: "An entry for year $1 already exists for $2 — edit the existing entry" },
  { re: /^Belum ada run Confirmed\/Paid pada periode (.+)$/, en: "No Confirmed/Paid runs yet on period $1" },
  { re: /^Tidak ada data payroll final \(Confirmed\/Paid\) pada tahun pajak (\d+)$/, en: "No final payroll data (Confirmed/Paid) for tax year $1" },
  { re: /^Komponen (.+?) tidak aktif$/, en: "Component $1 is inactive" },
  {
    re: /^Komponen harus pendapatan \(Earning\) dengan metode pajak Irregular — (.+?) bertipe (.+)\/(.+)$/,
    en: "Component must be an Earning with Irregular tax method — $1 is of type $2/$3",
  },
  {
    re: /^Jenis proses harus BONUS atau THR \(dipilih: (.+?)\)$/,
    en: "Process type must be BONUS or THR (selected: $1)",
  },
  {
    re: /^Seluruh (\d+) karyawan sudah memiliki assignment (.+?) pada (.+?) × (.+?) — hapus assignment lama \(menu Transaksi & Rapel\) atau pilih period lain$/,
    en: "All $1 employees already have assignment $2 on $3 × $4 — delete the old assignment (Transactions & Retroactive menu) or choose another period",
  },
  {
    re: /^Rapel (.+?) untuk (.+?) pada period (.+?) sudah ada \(assignment (.+?)\) — hapus assignment lama atau pilih period target lain$/,
    en: "Retroactive $1 for $2 on period $3 already exists (assignment $4) — delete the old assignment or choose another target period",
  },
  {
    re: /^Selisih rapel Rp ([\d.,]+) \(≤ 0\) — nilai baru tidak lebih tinggi dari yang dibayar, atau komponen tidak ditemukan pada riwayat run$/,
    en: "Retroactive difference Rp $1 (≤ 0) — the new value is not higher than what was paid, or the component was not found in run history",
  },
  { re: /^Status pinjaman saat ini (.+?) — hanya Active yang bisa diubah manual$/, en: "Current loan status is $1 — only Active can be edited manually" },
  { re: /^Template dipakai (\d+) karyawan — pindahkan profil karyawan dulu$/, en: "Template is used by $1 employees — move the employee profiles first" },
  { re: /^Grup masih memiliki (\d+) akun$/, en: "Group still has $1 accounts" },
  { re: /^Tidak dapat dihapus — dipakai (\d+) klaim\. Nonaktifkan saja\.$/, en: "Cannot delete — used by $1 claims. Deactivate it instead." },
  {
    re: /^Mitra masih memiliki (\d+) pembayaran — non-aktifkan saja \(jejak bukti potong harus utuh\)$/,
    en: "Partner still has $1 payments — deactivate it instead (withholding evidence must stay intact)",
  },
  {
    re: /^Transisi status (.+?) → (.+?) tidak diizinkan \(pembayaran final hanya dapat dibatalkan\)$/,
    en: "Status transition $1 → $2 is not allowed (final payments can only be cancelled)",
  },
  { re: /^Status PTKP tidak valid \((.+)\)$/, en: "Invalid PTKP status ($1)" },
  { re: /^Bank tidak dikenal: (.+)$/, en: "Unknown bank: $1" },
  { re: /^Tidak ada karyawan dengan rekening (.+?) pada run ini — gunakan format "umum"$/, en: "No employees with $1 accounts on this run — use the \"general\" format" },
  // ---------- HR: struktur / aset / pengumuman ----------
  { re: /^Job masih dipakai (\d+) posisi$/, en: "Job is still used by $1 positions" },
  { re: /^Unit masih memiliki (\d+) karyawan aktif$/, en: "Unit still has $1 active employees" },
  { re: /^Unit masih memiliki (\d+) posisi$/, en: "Unit still has $1 positions" },
  { re: /^Grade masih dipakai \((\d+) karyawan, (\d+) posisi\)$/, en: "Grade is still in use ($1 employees, $2 positions)" },
  { re: /^Masih ada (\d+) tugas belum selesai$/, en: "$1 tasks are still incomplete" },
  { re: /^Aksi tidak dikenal: (.+)$/, en: "Unknown action: $1" },
  { re: /^Action tidak dikenal: (.+)$/, en: "Unknown action: $1" },
  { re: /^Report tidak dikenal: (.+)$/, en: "Unknown report: $1" },
  { re: /^Isi surat maksimal (\d+) karakter$/, en: "Letter body must be at most $1 characters" },
  { re: /^Layer ini menunggu persetujuan (.+)$/, en: "This layer is awaiting approval from $1" },
  {
    re: /^Tugas ini milik bagian (.+?) — hanya bagian tersebut \(atau Admin\/HR\) yang bisa mengubah$/,
    en: "This task belongs to $1 — only that section (or Admin/HR) can change it",
  },
  { re: /^Pengumuman (.+?) masih draft$/, en: "Announcement $1 is still a draft" },
  { re: /^Pengumuman (.+?) sudah diterbitkan$/, en: "Announcement $1 has already been published" },
  {
    re: /^Pengumuman (.+?) sudah diterbitkan — batalkan terbitannya dulu \(kembali draft\) sebelum menghapus$/,
    en: "Announcement $1 has already been published — unpublish it first (back to draft) before deleting",
  },
  { re: /^(.+?) berstatus (.+?) — aset hanya bisa ditugaskan ke karyawan aktif$/, en: "$1 has status $2 — assets can only be assigned to active employees" },
  { re: /^Aset (.+?) sudah dikembalikan pada (.+)$/, en: "Asset $1 was already returned on $2" },
  {
    re: /^Aset (.+?) sedang ditugaskan — terima pengembaliannya dulu \(tab Penugasan\)$/,
    en: "Asset $1 is currently assigned — process its return first (Assignments tab)",
  },
  {
    re: /^Aset (.+?) sedang (.+?) — tidak bisa ditugaskan$/,
    en: "Asset $1 is currently $2 — it cannot be assigned",
  },
  { re: /^Jenis dokumen tidak dikenal — gunakan (.+)$/, en: "Unknown document type — use $1" },
  { re: /^(Kategori|Status) tidak valid \((.+)\)$/, en: "Invalid $1 ($2)" },
  { re: /^Kolom wajib tidak ditemukan: (.+?) — unduh template resmi dan jangan mengubah baris header$/, en: "Required column(s) not found: $1 — download the official template and do not modify the header row" },
  { re: /^File terlalu besar \(([\d.]+) MB\) — maksimum (\d+) MB\. Pecah file atau hapus baris tidak perlu\.$/, en: "File too large ($1 MB) — maximum $2 MB. Split the file or remove unnecessary rows." },
  { re: /^Terlalu banyak baris \((\d+)\) — maksimum (\d+) baris per file$/, en: "Too many rows ($1) — maximum $2 rows per file" },
  { re: /^Tanggal efektif tidak boleh mendahului tanggal bergabung \((.+)\)$/, en: "Effective date cannot precede the join date ($1)" },
  // ---------- ESS: clock / swap shift / open shift / klaim ----------
  { re: /^Clock-in hari ini sudah tercatat pukul (.+)$/, en: "Today's clock-in was already recorded at $1" },
  { re: /^(.+?) tidak memiliki jadwal pada (.+)$/, en: "$1 has no schedule on $2" },
  { re: /^Anda tidak memiliki jadwal pada (.+?) — tukar shift tidak bisa diajukan$/, en: "You have no schedule on $1 — a shift swap cannot be submitted" },
  { re: /^Anda masih punya permintaan tukar shift menunggu keputusan untuk (.+?) \((.+?)\)$/, en: "You still have a pending shift-swap request for $1 ($2)" },
  { re: /^Permintaan (.+?) sudah diputuskan \((.+?)\) — tidak bisa dibatalkan$/, en: "Request $1 has already been decided ($2) — it cannot be cancelled" },
  { re: /^Shift Anda dan (.+?) sama pada (.+?) \((.+?)\) — tukar shift tidak bermakna$/, en: "Your shift and $1's are identical on $2 ($3) — a shift swap is pointless" },
  { re: /^Posting sudah ditutup$/, en: "This posting is already closed" },
  { re: /^Posting sudah dibatalkan$/, en: "This posting has been cancelled" },
  { re: /^Klaim hanya bisa dibuat dari pengajuan Approved \(status saat ini: (.+?)\)$/, en: "Claims can only be created from an Approved request (current status: $1)" },
  { re: /^Anda masih punya permintaan (.+?) menunggu keputusan HR \((.+?)\)\.$/, en: "You still have a pending $1 request awaiting HR's decision ($2)." },
  {
    re: /^Jenis (.+?) mewajibkan nomor surat rujukan dokter\/RS — isi No\. Surat Rujukan pada klaim$/,
    en: "Letter type $1 requires a doctor/hospital referral number — fill in the Referral No. on the claim",
  },
  // ---------- medical / leave ----------
  { re: /^Saldo medis tahun (\d+) belum digenerate — generate saldo dulu sebelum input migrasi$/, en: "Medical balances for year $1 have not been generated — generate balances before entering a migration" },
  { re: /^Migrasi ditolak: sisa plafon menjadi negatif \(Rp ([\d.,]+)\) — periksa kembali nilai terpakai$/, en: "Migration rejected: the remaining ceiling would go negative (Rp $1) — review the used amount" },
  // ---------- validasi per-baris klaim ESS (isi dalam "Baris N: …") ----------
  { re: /^nama yang dirawat wajib diisi$/, en: "the treated person's name is required" },
  { re: /^jenis biaya wajib dipilih$/, en: "an expense type must be selected" },
  { re: /^nominal biaya wajib lebih dari 0$/, en: "the expense amount must be greater than 0" },
  { re: /^nilai tagihan wajib lebih dari 0$/, en: "the bill amount must be greater than 0" },
  // ---------- infra / integrasi ----------
  { re: /^Engine iReport gagal merender 1721-A1 \((.+?)\): (.+)$/, en: "The iReport engine failed to render 1721-A1 ($1): $2" },
  { re: /^Platform DB tidak dapat diakses: (.+)$/, en: "Platform DB is unreachable: $1" },
  { re: /^id & action \((.+)\) wajib$/, en: "id & action ($1) are required" },
];

/**
 * Frasa baku utk pesan campuran yang tidak kena kamus/aturan (jaring pengaman).
 * Dipakai mirip locReport: kata/frasa Indonesia utuh → EN, berjaga word-boundary
 * dan hanya saat diikuti akhir-string/tanda baca (guard belakang adaptif).
 */
export const SERVER_MSG_FRAGMENTS: [string, string][] = [
  [" tidak ditemukan", " not found"],
  [" sudah dipakai", " is already in use"],
  [" wajib diisi", " is required"],
  [" wajib diisi (atau all: true)", " is required (or all: true)"],
  [" belum selesai", " not yet completed"],
  [" tidak valid", " is invalid"],
  [" tidak dikenal", " is unknown"],
  [" gagal dimuat", " failed to load"],
  [" gagal disimpan", " failed to save"],
];
