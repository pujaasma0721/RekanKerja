# B6 BRIEF — Rekrutmen quick wins: WA wiring + meetingUrl (DEVELOPMENT-PLAN-BACKLOG.md §4 B6)

Anda = subagent proyek RekanKerja (HR SaaS multi-tenant, Next.js 16 App Router + Prisma + PG embedded, /home/z/my-project). Kerjakan fase B6 END-TO-END hingga commit + push. Fase ini UKURAN S — fokus, tanpa scope creep.

## WAJIB SEBELUM MULAI
1. Baca `/home/z/my-project/worklog.md` — header aturan + entri B1–B5 (konvensi).
2. Baca `/home/z/my-project/DEVELOPMENT-PLAN-BACKLOG.md` — §4 baris B6 + §5 risiko "WA spam pelamar" (WA hanya event transaksional penting; **BUKAN OTP** — recruitment.esign.otp TIDAK DAPET template WA; aktif default per template; WaLog semua kirim).
3. Modul Training TIDAK BOLEH disentuh (exclude user).

## LINGKUNGAN (SIAP — JANGAN ULANGI PEMULIHAN)
- Dev server :3000 JALAN (JANGAN `bun run build`, jangan bunuh). Log `dev.log`.
- PG :5432, 3 tenant. Login owner `hrd@mii.co.id/onevity123` · ESS `yusuf@mii.co.id/EssDemo123!`.
- Memori 4GB. tsc scoped: `NODE_OPTIONS="--max-old-space-size=2000" ./node_modules/.bin/tsc --noEmit -p tsconfig.b6.json`.

## REFERENSI ARSITEKTUR (pelajari dulu)
- `src/rekankerja/shared/services/wa-service.ts` — `sendWa(db, {event, toPhone, placeholders})` never-throw fire-and-forget; `sendWaBatch`; `employeePhoneOf(db, employeeId)` (helper nomor WA karyawan); `normalizePhone`; config default MATI provider Fonnte (tanpa token semua kirim → Skipped — aman).
- `src/rekankerja/shared/services/wa-defaults.ts` — `WA_DEFAULT_TEMPLATES` event-keyed, self-heal insert-if-missing di GET `/api/rekankerja/wa-templates` (edit admin tak pernah ditimpa).
- Pola wiring WA terbaik: `src/rekankerja/time-attendance/api/shift-swap.ts` baris ~320-335 (Promise.all employeePhoneOf lalu void sendWa per penerima) + `src/rekankerja/performance/services/perf-cycle-service.ts` ~730.
- Email recruitment events + placeholders: `src/rekankerja/shared/services/email-defaults.ts` (baris 119–177 events; 319+ daftar placeholder per event). NOTIFIKASI rekrutmen: `notifyEmailEvent` call sites di `src/rekankerja/recruitment/services/` — applicant-service.ts:954, appointment-service.ts:617, offer-service.ts:623/646/801/887, recruitment-esign-service.ts:139/188, selection-service.ts:578/1009 (+PR service bila ada — cari `grep -rn notifyEmailEvent src/rekankerja/recruitment/`).
- PII pelamar: `Applicant.phone` TERENKRIPSI enc:v1:t → `tc.decryptText(a.phone)` (pola applicant-service.ts ~270/444). Karyawan: `employeePhoneOf`.
- Skema: `CandidateSelectionStep` di prisma/schema-tenant.prisma baris ~3843 (planDate/letterNo/…); `WaLog` baris ~2930 (event/toPhone/body/status/error).

## A. WA WIRING (quick win 1)
1. `wa-defaults.ts`: TAMBAH template rekrutmen (pola entri existing — bahasa Indonesia sopan, placeholder {{key}}, singkat):
   - `recruitment.pr.submitted` (→ approver), `recruitment.pr.approved` (→ pengaju), `recruitment.pr.rejected` (→ pengaju) — gunakan placeholder nama/docNo/posisi/catatan ala email.
   - `recruitment.selection.scheduled` (→ KANDIDAT — undangan: kandidat, tahap, posisi, jadwal, batasSla, **linkMeeting**), `recruitment.selection.reminder` (→ kandidat, + linkMeeting).
   - `recruitment.offer.sent` (→ kandidat: posisi, gaji, mulaiKerja, berlakuSampai), `recruitment.offer.reminder` (→ kandidat).
   - `recruitment.appointment.hired` (→ karyawan baru: employeeNo, posisi).
   - `recruitment.application.received` (→ pelamar: konfirmasi lamaran diterima, posisi).
   - **JANGAN** buat template `recruitment.esign.otp` (risiko §5: OTP tidak lewat WA).
   - Semua `active: true` (default; kirim aman karena config WA default MATI tanpa token → Skipped).
2. Wiring di SEMUA titik `notifyEmailEvent` rekrutmen: sejajar tiap panggilan, tambahkan `void sendWa(...)` ke penerima yang punya telepon:
   - Penerima karyawan (evaluator/pengaju/approver): `employeePhoneOf(db, id)` → sendWa event sama + placeholder sama seperti email.
   - Penerima kandidat/pelamar: `tc.decryptText(phone)` (peserta Applicant) → sendWa event sama.
   - Bila telepon null → biarkan (sendWa menangani null → Skipped).
   - POLA: `void sendWa(db, {...}).catch(() => {})` tidak perlu — sendWa never-throw; cukup `void sendWa(db, {...})`.
   - Jangan ubah perilaku email/notifikasi existing — WA MURNI TAMBAHAN paralel.
3. Placeholder `{{linkMeeting}}` di template WA `selection.scheduled` + `selection.reminder` → diisi dari `step.meetingUrl ?? "-"` di call site selection-service.

## B. MEETING URL (quick win 2)
1. Schema: `CandidateSelectionStep.meetingUrl String?` (URL meeting video-call — kompromi micro §1 dok backlog) + `prisma/tenant-ddl.sql` kolom baru (ALTER... pattern — lihat bagaimana kolom baru ditambahkan di file itu untuk tabel existing, pola F8/F9) + `scripts/migrate-recruitment-b6-wa-meeting.ts` idempoten (ADD COLUMN IF NOT EXISTS, loop 3 tenant, `main(schemas?)` exportable, pola migrate-performance-b4-succession.ts) + parity step `backlog-b6`.
2. Email templates: `email-defaults.ts` — tambah placeholder `linkMeeting` ke daftar placeholder event `recruitment.selection.scheduled` + `recruitment.selection.reminder` (pola PH_* baris 319+; tambahkan definisi PH_LINKMEETING { key: "linkMeeting", label: "Tautan meeting video-call (opsional)", contoh: "https://meet.google.com/abc-defg-hij" }).
3. Service: `selection-service.ts` — di titik jadwalkan/ingatkan (578/1009): (a) terima + simpan meetingUrl saat scheduling (input field baru, validasi URL http/https bila terisi — tolak 400 bila bukan URL); (b) sertakan `linkMeeting: step.meetingUrl ?? "-"` di placeholders email + WA.
4. UI selection (cari komponen tahap seleksi di `src/rekankerja/recruitment/components/` — dialog jadwalkan/detail step): field "Link Meeting" (input URL + placeholder contoh + hint dwibahasa) + tampil di kartu/detail step sebagai tautan klik-buka (bila terisi); kolom/baris di tabel detail kandidat bila cocok pola existing. Dwibahasa t() BASE_EN.

## C. E2E `scripts/e2e-b6-wa-meeting.ts` (pola e2e-b4/b5: class Sesi, login owner, db getTenantClient(SCHEMA))
1. WA TEMPLATE SEED: GET `/api/rekankerja/wa-templates` (login owner) → memuat ≥9 baris rekrutmen event-keyed active=true (self-heal insert-if-missing) + TIDAK ada `recruitment.esign.otp`; verifikasi 3 tenant punya baris WaTemplate rekrutmen (query db per schema — pola cek parity).
2. SENDWA LOG: siapkan kandidat nyata di db (cari Applicant aktif dengan phone terisi via db; bila phone null → set phone sementara via db update encrypt — pakai tc encryptText lalu restore). Jadwalkan tahap seleksi via API (atau panggil service path yang men-trigger notifyEmailEvent selection.scheduled) dengan meetingUrl "https://meet.example.com/e2e-b6" → assert: `WaLog` row BARU event `recruitment.selection.scheduled`, toPhone = phone kandidat, status `Skipped` (config tanpa token — tenang), body MEMUAT "meet.example.com/e2e-b6" (template ter-render).
3. MEETING URL: simpan meetingUrl via API → db tersimpan; muncul di respons detail step; update step tanpa meetingUrl → null; URL tidak-valid "bukan-url" → 400.
4. GUARD: meetingUrl hanya diubah HR (menu guard recruitment:selection op existing — JANGAN buat menu baru); ESS/pelamar tidak bisa set (403 bila jalurna ada — bila tidak ada jalur publik, cukup assert lewat admin).
5. OFFER WA: kirim offer via API ke kandidat ber-phone → WaLog row `recruitment.offer.sent` Skipped + body ter-render (assert ≥1 placeholder terisi).
6. CLEANUP: hapus/restore data uji (meetingUrl null, WaLog uji tak perlu dihapus — log historis aman; hapus hanya data domain yang dibuat).
Format ✓/✗ + HASIL n/n + exit code; ulangi hingga PASS.

## D. GATES (semua hijau)
- `tsconfig.b6.json` (pola b5 — include recruitment + shared wa/email + route terkait + e2e/migrate b6) → tsc 0 error.
- `bun run lint` 0 error (6 warning baseline).
- `bun scripts/audit-bilingual.ts` → TOTAL_GAP=150 (tak naik).
- dev.log bersih.
- E2E PASS.
- BROWSER (agent-browser): login hrd → modul Rekrutmen → halaman detail kandidat/tahap seleksi → verifikasi field "Link Meeting" render di dialog jadwalkan EN + ID; halaman Pengaturan → WhatsApp templates menampilkan baris rekrutmen (GET self-heal); mobile 375×812 hscroll=0; console 0 error baru (dup-key "Male" = baseline). 2–3 screenshot → `audit/e2e-b6/*.png` (mkdir dulu). Data uji browser dibersihkan.

## E. WORKLOG + COMMIT + PUSH
- Append `worklog.md` entri Task ID B6 (format B5) + `git add -f worklog.md`.
- SATU commit gaya B5 (`git log -1 128d9e8`) + `git push origin main`.
- LAPOR: ringkasan + gates + commit + E2E n/n + screenshot + keputusan/penyimpangan.

## DISIPLIN
- JANGAN ubah kode di luar cakupan (kecuali wiring list di atas + parity + ddl + schema).
- JANGAN buat modul training. JANGAN kirim OTP via WA. JANGAN ubah default config WA (MATI).
- Context hampir habis → checkpoint commit + worklog status DULU.
- DialogContent `sm:max-w-*`; t() BASE_EN; ActivityLog hanya bila ada mutasi domain baru (meetingUrl update = bagian op existing — ikuti pola service).
