# BL-REC-2 — full-stack-developer — Catatan Kerja

Konteks: temuan REAL-4 audit BL-REC-AUDIT — halaman tanda tangan publik `/sign/<token>` di portal kandidat (:3010) menampilkan error server (`res.j.error`) mentah dalam bahasa Indonesia ketika pengunjung memilih EN. Form lamaran di file yang sama sudah punya pola benar (`SERVER_ERRORS` map + `serverMsg()`), tapi scope-nya IIFE script halaman karier — halaman sign punya `<script>` sendiri, jadi butuh salinan sendiri.

## File yang diubah (HANYA satu)
`mini-services/candidate-portal/index.ts` — di dalam `<script>` IIFE `renderSignPage()` (+32/−1 baris):
1. **`SERVER_ERRORS` map** (10 pasangan, ditempatkan setelah `function t()` di script halaman sign) — SEMUA key diverifikasi byte-for-byte dari sumber (ekstraksi programatik regex `error:` / `new Error()` dari kedua file sumber, em-dash U+2014 terkonfirmasi):
   - Dari `src/rekankerja/recruitment/api/public-sign.ts`: "Terlalu banyak permintaan. Coba lagi nanti." (429 GET), "Terlalu banyak percobaan. Silakan coba lagi nanti." (429 POST), "Kode OTP salah atau kedaluwarsa" (400), "Nama wajib diketik sesuai nama pada surat" (400), "Tautan tanda tangan tidak valid atau kedaluwarsa" (NOT_FOUND 404).
   - Dari `src/rekankerja/recruitment/services/recruitment-esign-service.ts` `submitPublicEsign()` (semua mengalir ke 400 via catch public-sign.ts): "Tautan tanda tangan telah kedaluwarsa — minta HR mengirim permintaan baru", "Nama yang diketik tidak sesuai dengan nama kandidat pada surat", "Surat tidak tersedia — hubungi HR", "Surat tidak dapat dibuat — hubungi HR".
   - Dari proxy portal sendiri (respons 502 saat main app mati, juga lewat `res.j.error` di submit sign): "Portal tidak dapat menghubungi layanan rekrutmen. Silakan coba lagi nanti."
   - **String yang DIVERIFIKASI TIDAK ADA lalu di-skip**: "Tautan tanda tangan sudah pernah dipakai" (dugaan brief) — tidak ditemukan di source. Pesan "sudah diproses" yang SEBENARNYA bersifat DINAMIS: `` `Permintaan tanda tangan sudah diproses (${row.status})` `` → ditangani lewat RULES (bawah).
   - Error createEsignRequest/resendEsignOtp/cancelEsignRequest (sisi HR admin) TIDAK dimasukkan — tidak mengalir lewat endpoint publik sign.
2. **`SERVER_ERROR_RULES`** (1 aturan regex dinamis): `/^Permintaan tanda tangan sudah diproses \((.+)\)$/` → "This signing request has already been processed ($1)" — status Signed/Expired/Cancelled dipertahankan apa adanya (enum teknis).
3. **`serverMsg(msg)`** — persis pola form lamaran + iterasi RULES (hanya aktif saat `cur === "en"`; selain itu pass-through).
4. **Wiring**: `errEl.textContent = serverMsg((res.j && res.j.error) || t("Gagal memproses — coba lagi.", "Failed to process — please try again."))` di submit handler (fallback bilingual t() tetap utuh untuk respons non-JSON).

## Pemeriksaan jalur lain (tidak perlu wiring)
- **Tidak ada flow "request OTP"** di halaman sign (OTP dikirim HR saat membuat permintaan; tidak ada tombol resend di halaman) — satu-satunya fetch browser = POST submit.
- **fetchEsignInfo (render awal)**: dijalankan SERVER-SIDE di Bun, `!res.ok`/exception → return null → renderSignPage menampilkan kartu "Tautan tanda tangan tidak valid atau sudah kedaluwarsa." bilingual (data-id/data-en) — error 429/404 GET tidak pernah bocor mentah ke UI. Tidak diubah.

## Bug tersembunyi yang ditemukan & diperbaiki saat verifikasi
Regex RULES pertama kali ditulis `\((.+)\)` di source TS — template literal Bun MENGHAPUS backslash escape `\(` → HTML tersaji `((.+))` = nested capture group → hasil `((Signed))` (kurung ganda). Unit test menangkapnya. Fix: `\\((.+)\\)` di template literal → tersaji `\((.+)\)` benar. (Ini persis alasan `EMAIL_RE` form lamaran memakai `\\s`.)

## Verifikasi (semua LULUS)
1. `curl /healthz` → `{"ok":true,...}`; `bun --hot` reload bersih 2× (portal.log hanya baris boot OK, tanpa error).
2. `curl /sign/deadbeef` → HTTP 200, kartu invalid-link bilingual, TANPA stack trace; `new Function(script)` parse bersih (5447 kar).
3. POST via proxy portal `:3010/api/public/recruitment/sign/abcdef0123456789` (token 16-hex palsu, jalur sama dengan JS halaman):
   - `{"otp":"1"}` → 400 `"Kode OTP salah atau kedaluwarsa"` → **match peta byte-for-byte**
   - `{"otp":"123456","typedName":""}` → 400 `"Nama wajib diketik sesuai nama pada surat"` → **match**
   - valid-format → 404 `"Tautan tanda tangan tidak valid atau kedaluwarsa"` → **match**
   - POST ke-6 (rate limit 5/10mnt/IP) → 429 `"Terlalu banyak percobaan. Silakan coba lagi nanti."` → **match**
4. Unit test `serverMsg` (script diekstrak dari halaman YANG DISAJIKAN live, dieksekusi terisolasi, mode EN): 14/14 kasus lulus — 10 key statis, 3 varian dinamis (Signed/Expired/Cancelled), 1 pass-through pesan tak dikenal.
5. E2E browser nyata (agent-browser @ :3010/sign/deadbeef): injeksi form Pending + re-run script halaman + set `portal-lang=en` → submit → POST NYATA via proxy → main app → 429 → `#sg-err` menampilkan **"Too many attempts. Please try again later."**; toggle kembali ID → submit → menampilkan mentah **"Terlalu banyak percobaan. Silakan coba lagi nanti."**; 0 page error / 0 console error; screenshot `.tmp-research/bl-rec-2-sign-en-429.png`.

## Catatan
- TIDAK commit/push (sesuai brief — koordinator yang commit). File lain yang ter-modify di working tree (ai-search-service.ts dsb.) adalah kerja agent paralel, tidak disentuh.
- Rate-limit budget POST sign 5/10mnt/IP 127.0.0.1 terpakai penuh oleh verifikasi ini (jendela 10 menit — pulih otomatis).
