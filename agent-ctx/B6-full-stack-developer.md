# B6 — Rekrutmen Quick Wins: WA Wiring + meetingUrl (Rekrutmen)

Task ID: B6 (DEVELOPMENT-PLAN-BACKLOG.md §4 B6; risiko §5 "WA spam pelamar" — hanya event transaksional penting, OTP TIDAK lewat WA)
Status: SELESAI — E2E 47/47, tsc tsconfig.b6.json 0 error, lint 0 error (6 warning baseline), audit-bilingual TOTAL_GAP=150, browser EN+ID + mobile 375 hscroll=0 + console 0 error baru, migrasi 3 tenant terverifikasi (kolom + WaTemplate via query db).

## File dibuat
- `scripts/migrate-recruitment-b6-wa-meeting.ts` (74) — idempoten: `ALTER TABLE "CandidateSelectionStep" ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT` + seed baris WaTemplate event `recruitment.*` (INSERT … ON CONFLICT ("event") DO NOTHING — edit admin tak pernah ditimpa; paritas antar-tenant tanpa GET per schema). TANPA recruitment.esign.otp (OTP tidak lewat WA). `main(schemas?)` exportable utk parity-runner in-process. Dijalankan → 3 tenant OK.
- `scripts/e2e-b6-wa-meeting.ts` (347) — 47 assert (lihat bawah).
- `tsconfig.b6.json` (40) — include recruitment services/api/components terkait + shared wa/email + route wa-templates + e2e/migrate b6.

## File diubah
- `prisma/schema-tenant.prisma` — `CandidateSelectionStep.meetingUrl String?` (kompromi micro §1: video interview platform penuh di-defer).
- `prisma/tenant-ddl.sql` — kolom di CREATE TABLE + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS "meetingUrl" TEXT` (pola F8/F9).
- `src/rekankerja/shared/services/wa-defaults.ts` — 10 template WA rekrutmen (9 wajib brief + `recruitment.offer.responded`) semua `active: true`, bahasa Indonesia sopan + placeholder {{key}} + katalog WA_EVENT_PLACEHOLDERS mirror email-defaults (PH_LINKMEETING dkk). TANPA esign.otp.
- `src/rekankerja/shared/services/wa-service.ts` — REORDER urutan cek sendWa: config-aktif → template → nomor → RENDER → provider-siap (waReady DIPINDAH setelah render). Efek: kanal aktif tapi provider belum dikonfigurasi → Skipped DENGAN body ter-render (pesan undangan tetap ter-audit di WaLog — kebutuhan E2E B6; tanpa token semua kirim tetap Skipped → aman).
- `src/rekankerja/shared/services/email-defaults.ts` — PH_LINKMEETING {key:"linkMeeting", label:"Tautan meeting video-call (opsional)", contoh:"https://meet.google.com/abc-defg-hij"} + placeholder linkMeeting di EVENT_PLACEHOLDERS selection.scheduled/reminder + baris "Link meeting: {{linkMeeting}}" di body default kedua template.
- `src/rekankerja/recruitment/services/selection-service.ts` — StepRow.meetingUrl + getCandidateDetail expose; `parseMeetingUrl` (kosong→null; bukan URL http/https → throw → API 400); ScheduleStepInput.meetingUrl + disimpan saat scheduling (reschedule reset ack); ActivityLog detail + `— link meeting {url}`; placeholders email `linkMeeting: meetingUrl ?? "-"`; WA wiring di scheduleStep (evaluator via employeePhoneOf + KANDIDAT via tc.decryptText(applicant.phone), Promise.all paralel pola shift-swap ~320-335, void sendWa per penerima, IIFE .catch noop) + jobSelectionReminders (target evaluator + kandidat).
- `src/rekankerja/recruitment/services/offer-service.ts` — performSend: decrypt phone kandidat (select tambah phone) + `void sendWa` offer.sent ke KANDIDAT + OFFICER; respondOffer: offer.responded → officer; jobOfferExpiry: offer.reminder → target.
- `src/rekankerja/recruitment/services/appointment-service.ts` — continueToOnboarding: appointment.hired → OFFICER rekrutmen + KARYAWAN BARU (employeePhoneOf ×2 paralel).
- `src/rekankerja/recruitment/services/applicant-service.ts` — submitPublicApplication: application.received → PELAMAR (nomor plain payload pra-enkripsi).
- `src/rekankerja/recruitment/api/pr.ts` — fireSubmittedSideEffects: pr.submitted → approverPhonesOf (mirror approverEmailsOf); fireDecidedSideEffects: pr.approved/rejected → PENGAJU (employeePhoneOf).
- `src/rekankerja/recruitment/api/selection.ts` — pass meetingUrl body → scheduleStep.
- `src/rekankerja/recruitment/components/selection-dialogs.tsx` — ScheduleDialog: field "Link Meeting" (Input type=url placeholder contoh + hint dwibahasa + ikon Info title) terisi dari step.meetingUrl, submit `meetingUrl.trim() || null`; CandidateDetailDialog: Field "Link Meeting" → tautan klik-buka target=_blank rel=noopener (ikon Video, "Buka Meeting"/"Open Meeting") bila terisi, "—" bila kosong.
- `src/rekankerja/recruitment/components/selection-shared.tsx` — StepRow.meetingUrl (tipe UI).
- `src/rekankerja/shared/lib/parity-runner.ts` — step `backlog-b6` setelah backlog-b5.

## WA wiring — peta lengkap (SEMUA titik notifyEmailEvent rekrutmen)
| Titik | Event email | WA ke | Pola |
|---|---|---|---|
| pr.ts fireSubmittedSideEffects | recruitment.pr.submitted | approver (karyawan) | approverPhonesOf loop |
| pr.ts fireDecidedSideEffects | recruitment.pr.approved/.rejected | pengaju | employeePhoneOf |
| selection-service scheduleStep | recruitment.selection.scheduled | evaluator + KANDIDAT | employeePhoneOf + tc.decryptText(applicant.phone) paralel |
| selection-service jobSelectionReminders | recruitment.selection.reminder | evaluator target + KANDIDAT | idem |
| offer-service performSend | recruitment.offer.sent | KANDIDAT + officer | decrypt phone + employeePhoneOf |
| offer-service respondOffer | recruitment.offer.responded | officer | employeePhoneOf |
| offer-service jobOfferExpiry | recruitment.offer.reminder | target officer | employeePhoneOf |
| appointment-service continueToOnboarding | recruitment.appointment.hired | officer + karyawan baru | employeePhoneOf ×2 |
| applicant-service submitPublicApplication | recruitment.application.received | pelamar | nomor plain payload |
| recruitment-esign-service 139/188 | recruitment.esign.otp | **TIDAK di-wire** — OTP tidak lewat WA (§5) |

Semua `void sendWa(db, {...})` fire-and-forget never-throw (sendWa sendiri menangani null → Skipped); email/notifikasi existing tidak berubah (WA murni tambahan paralel).

## E2E 47/47 (bun scripts/e2e-b6-wa-meeting.ts)
(1) TEMPLATE SEED 20: GET wa-templates 200 (18 template) · ≥9 rekrutmen active (10) · TANPA recruitment.esign.otp · selection.scheduled memuat {{linkMeeting}} · 9 event wajib ada & aktif · self-heal (hapus baris → GET → muncul kembali body identik) · 3 tenant ≥9 baris (10/10/10 via db per schema);
(2) SENDWA LOG 8: kandidat Dewi Lestari (InProcess/Nominated + applicant ber-phone 6281234500001) · POST schedule dgn meetingUrl https://meet.example.com/e2e-b6 → 200 · WaLog BARU (id baru — anti stale-row) event selection.scheduled ke phone kandidat · status Skipped (config aktif tanpa token → provider belum siap) · body ter-render MEMUAT link meeting + ≥1 placeholder domain · tanpa placeholder mentah · count event bertambah;
(3) MEETING URL 5: tersimpan db · muncul di respons detail step (GET ?candidateId) · clear → null · "bukan-url" → 400 + db tak berubah;
(4) GUARD 2: ESS yusuf POST schedule → 403 (menu guard op:schedule existing);
(5) OFFER WA 9: create → approve (jenjang HR_ADMIN final) → send → surat 006/HR-RC/X/2026 · WaLog BARU (id baru) offer.sent ke phone kandidat 6281234500008 Skipped + body ter-render offerNo;
(6) CLEANUP 3: step dikembalikan (plan/due/status/ack/meetingUrl) · WaConfig active dikembalikan false · offer uji + surat + approval chain dihapus.

## Browser (agent-browser)
Login owner (Tri Handayani/OWNER MII) → Rekrutmen → Kandidat & Seleksi: dialog Jadwalkan Tahap ID ("Link Meeting" + hint "Opsional — harus URL http/https (mis. Google Meet/Zoom).") + EN ("Schedule Stage — Interview HR", "Link Meeting", "Optional — must be an http/https URL (e.g. Google Meet/Zoom).") + detail kandidat keduanya bahasa menampilkan Field "Link Meeting"→"Buka Meeting"/"Open Meeting" (tautan klik-buka, step Dewi Lestari Interview HR) + placeholder contoh di input; Pengaturan Sistem → WhatsApp Notifications → tab Template menampilkan 10 baris rekrutmen (label + body default) + tab Send History menampilkan WaLog uji (total 14, Skipped provider-belum-siap — historis aman); mobile 375×812 hscroll=0 (board + dialog detail + dialog jadwalkan); console 0 error baru (DialogTitle-missing = quirk pra-existing fase loading CandidateDetailDialog di HEAD — diverifikasi git show HEAD; Description warning + Select uncontrolled = baseline). 8 screenshot audit/e2e-b6. Data uji browser dibersihkan (meetingUrl step uji → null; acknowledgedAt demo dipulihkan — planDate/evaluator/surat 001 = data seed demo F3 asli, dipertahankan).

## Keputusan menyimpang / catatan
1. SESI SEBELUMNYA TERPUTUS (pola B5): impl inti B6 dikerjakan sesi-1 (context-deadline; semua file di working tree TANPA commit, termasuk 2 screenshot + migrasi SUDAH dijalankan). Sesi ini (finalisasi) memverifikasi ulang semua kode vs brief baris-per-baris, memperbaiki E2E, menjalankan SELURUH gates dari nol, browser penuh, bersih-bersih.
2. Template ke-10 `recruitment.offer.responded` — brief hanya minta 9, tapi A2 menyuruh wiring di SEMUA titik notifyEmailEvent; tanpa template, sendWa offer.responded akan menulis WaLog Skipped "Template tidak ditemukan" (noise) → template dibuat aktif.
3. wa-service REORDER (waReady setelah render): perlu agar WaLog jalur "kanal aktif + provider belum siap" menyimpan body ter-render — syarat assert E2E C.2 ("body MEMUAT link"). Tanpa token semua kirim tetap Skipped → tidak ada spam riil (§5 aman).
4. E2E "baris BARU" diukur PER ID (himpunan id pra-panggilan), bukan per body/count semata — WaLog historis run sebelumnya ber-body serupa (link/offerNo bisa terulang: offerNo max-suffix setelah offer uji dihapus) membuat waitFor body-match bisa match baris basi. Dua run awal gagal krn ini + duplikasi WaConfig MII (pollusi sesi sebelumnya, findFirst ambigu) → fixed: updateMany SEMUA baris config saat set active + dedupe data (sisa 1 baris default MATI).
5. Esign 139/188 TIDAK di-wire — brief eksplisit (OTP tidak lewat WhatsApp, risiko §5; tanpa template sendWa akan log noise).
6. ActivityLog: tidak ada entri baru khusus B6 — meetingUrl disimpan sebagai bagian op schedule existing (detail ActivityLog di-append `— link meeting {url}`), sesuai catatan brief E.
7. Leftover B4 audit/e2e-b4/*.xlsx TIDAK disentuh (bukan cakupan; dicatat sejak B5 utk orchestrator).
8. Label "Batas SLA (opsional)" di dialog jadwalkan tampil ID di halaman EN — PRA-EXISTING (git show HEAD baris 133), di luar cakupan B6 (audit-bilingual 150 tetap).

## Sisa pekerjaan
- Fase berikutnya per §4: B7 — portal pelamar magic-link + branding CareerSiteConfig.
