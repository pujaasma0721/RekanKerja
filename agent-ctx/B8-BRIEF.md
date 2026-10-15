# B8 BRIEF — Referral tracker (DEVELOPMENT-PLAN-BACKLOG.md §4 B8)

Anda = subagent proyek RekanKerja. Kerjakan fase B8 END-TO-END hingga commit + push.

## WAJIB SEBELUM MULAI
1. `/home/z/my-project/worklog.md` — header aturan + entri B1–B7.
2. `/home/z/my-project/DEVELOPMENT-PLAN-BACKLOG.md` — §4 B8 + §3 baris "B8 — referral" + §5 risiko "Insentif referral disalahpahami otomatis" (UI tegas "catatan manual — di luar payroll").
3. Modul Training TIDAK BOLEH disentuh (exclude user).

## LINGKUNGAN (SIAP — JANGAN ULANGI)
- Dev :3000 jalan; portal :3010 jalan (tak disentuh fase ini). Login owner `hrd@mii.co.id/onevity123`; ESS `yusuf@mii.co.id/EssDemo123!`.
- tsc scoped `NODE_OPTIONS="--max-old-space-size=2000" ./node_modules/.bin/tsc --noEmit -p tsconfig.b8.json`.

## STATUS SAAT INI (F2 — sudah ada)
- `Applicant.referralEmployeeId` + relasi `referralEmployee` (schema-tenant.prisma baris ~3604/3625).
- Form pelamar admin (applicants.tsx): picker karyawan perujuk; detail tampil referralName.
- YANG BELUM ADA: referralNote, referralRewardNote, register HR khusus referral, ESS "Referral Saya", kolom perujuk di tabel daftar pelamar.

## A. SCHEMA + MIGRASI
1. `Applicant.referralNote String?` (konteks/pesan perujuk — kenapa merujuk) + `Applicant.referralRewardNote String?` (catatan insentif MANUAL HR — di luar payroll §5) + tenant-ddl (kolom baru, pola B6/B7) + `scripts/migrate-recruitment-b8-referral.ts` idempoten loop 3 tenant (`main(schemas?)` exportable) + parity step `backlog-b8`.

## B. SERVICE `src/rekankerja/recruitment/services/referral-service.ts` (BARU)
- `listReferrals(db, actor, {q, status, rewardOnly})` — register HR: SEMUA Applicant ber-referralEmployeeId + include referralEmployee (nama, employeeNo, unit via assignment aktif), application terakhir (slot title + joRefNo + tanggal), status pipeline ringkas (status applicant + tahap terakhir bila Candidate — reuse pola applicantStatusPayload B7 bila cocok, TANPA data internal), referralNote, referralRewardNote; urut createdAt desc; filter q (nama pelamar/perujuk/no), status applicant, rewardOnly (rewardNote terisi).
- `updateRewardNote(db, actor, {applicantId, referralRewardNote})` — HR saja (guard di service + menu op); trim; ≤500 char; kosong → null; ActivityLog `ReferralRewardNote` (before/after ringkas).
- `myReferrals(db, employeeId)` — ESS: Applicant WHERE referralEmployeeId = employeeId (self-scope) + slot dilamar + status ringkas + tanggal; urut desc; TANPA referralRewardNote (internal HR), TANPA catatan internal/skor; stats count per status.
- `applicant` serializer existing: tambahkan referralNote + referralRewardNote di detail admin + kolom referralName di LIST tabel pelamar (applicants.tsx kolom "Perujuk" — CEK lebar tabel/mobile; bila sudah padat tampil sebagai chip/teks kecil di kolom sumber).

## C. API
1. HR: di `src/rekankerja/recruitment/api/referrals.ts` + route `src/app/api/rekankerja/recruitment/referrals/route.ts`: GET `?q=&status=&rewardOnly=` register; POST `{action:updateReward, applicantId, referralRewardNote}`. MENU GUARD: key BARU `recruitment:referral` (menu-perms.ts) + MENU_OPS `{ key: "reward", label: "Mencatat insentif referral (manual)", hint: "Mengubah catatan insentif perujuk — catatan manual DI LUAR payroll (B8 §5)" }` — GET view-only tanpa op (pola settings), POST reward = op:reward.
2. ESS: `src/rekankerja/ess/api/my-referrals.ts` + route `.../ess/my-referrals/route.ts`: GET self-scope via requireEss (pola my-selection.ts). JANGAN expose rewardNote.
3. Detail pelamar admin (api/applicants.ts): terima referralNote saat create/update pelamar (form admin) — kolom input "Catatan Perujuk" di dialog pelamar bila referralEmployeeId terisi.

## D. UI
1. **Register HR**: `src/rekankerja/recruitment/components/referral-register.tsx` (BARU) — tab BARU modul Rekrutmen: app-shell RECRUITMENT_NAV grup sesuai (lihat struktur — taruh dekat pelamar/talent pool, label "Referral Karyawan"/"Employee Referrals", icon Users/UserPlus); recruitment-module.tsx case "referral" (pelajari struktur modul rekrutmen). Isi: BANNER amber tegas "Insentif referral dicatat MANUAL oleh HR — TIDAK otomatis masuk payroll" (§5); stats tile (total referral, terkonversi Employed, ber-insentif tercatat); tabel register (pelamar, perujuk + unit, slot, status pipeline chip, referralNote ringkas, rewardNote + tombol edit inline utk HR, tanggal); filter q + status + switch "hanya ber-insentif"; dialog edit rewardNote (textarea + warning manual); mobile kartu; dwibahasa t() BASE_EN penuh.
2. **ESS "Referral Saya"**: `src/rekankerja/ess/components/ess-my-referrals.tsx` (BARU) — nav item ess-shell (pola my-selection baris 85: label "Referral Saya"/"My Referrals", icon UserRoundCheck) + case render; isi: stats kecil + daftar kartu (nama pelamar, slot, status chip, tanggal, referralNote bila ada) + empty state "Belum ada referral — rujuk kenalan lewat form lamaran dgn nama Anda" + banner "status mengikuti proses rekrutmen — insentif diatur HR terpisah". ESS TIDAK bisa mengubah apa pun (read-only).
3. **Kolom perujuk** di tabel pelamar admin (applicants.tsx) + field referralNote di form/detail pelamar admin.

## E. E2E `scripts/e2e-b8-referral.ts` (pola b6/b7: class Sesi, db tenant)
1. SEED via db: 3 Applicant MII — A1 referralEmployeeId = yusuf (status Active + 1 application ke slot demo + referralNote "Teman kuliah, rajin"); A2 referralEmployeeId = yusuf (status Employed — terkonversi); A3 referralEmployeeId = karyawan lain (Joko MII00014? — cek db Employee). Simpan state lama utk cleanup.
2. ESS yusuf: GET my-referrals → 2 baris (A1, A2) + TIDAK ada A3 + TIDAK ada field referralRewardNote di payload (assert key tak ada) + stats benar.
3. HR register: GET referrals → 3 baris + filter q nama A1 → 1; rewardOnly=1 → 0.
4. CATAT INSENTIF: POST updateReward A2 "Bonus Rp 2.000.000 — dibayar manual via kasir Q4" → 200 + db tersimpan + ActivityLog row (action ReferralReward*) + rewardOnly=1 → 1 + update kedua (ubah teks) → ActivityLog bertambah; clear (note kosong) → null.
5. GUARD: ESS yusuf POST updateReward → 403; menu-guard: akun tanpa menu (ESS via sesi ess) GET referrals → 403; updateReward applicantId tak-ada → 404; payload >500 char → 400.
6. 403 LINTAS TENANT: bikin Applicant di schema cahaya dgn referralEmployeeId karyawan MII yusuf (via db lintas schema — di dunia nyata mustahil lewat UI; verifikasi API MII session TIDAK membacanya: GET referrals mii TIDAK memuat applicant cahaya; PLUS: sesi MII memanggil route dgn header host/t apa yang dipakai resolusi tenant? — resolusi tenant via SESSION membership, bukan input → cukup assert register MII hanya berisi data MII). Simpel: assert tidak ada kebocoran lintas schema.
7. CLEANUP: hapus 3 Applicant uji + ActivityLog uji? (log = audit trail — JANGAN hapus; biarkan) + restore state.
Format ✓/✗ + HASIL n/n; ulangi hingga PASS.

## F. GATES (semua hijau)
- tsc `tsconfig.b8.json` 0 error (include recruitment referral + ess + shared + routes + e2e/migrate).
- `bun run lint` 0 error / 6 warning baseline. `bun scripts/audit-bilingual.ts` TOTAL_GAP=150. dev.log bersih. E2E PASS.
- BROWSER (agent-browser): login hrd → Rekrutmen → tab "Referral Karyawan" EN (banner manual-payroll + tabel + filter + dialog reward) + ID dwibahasa; ESS yusuf login → "Referral Saya" (kartu + status chip + empty-state bila data uji sudah dibersihkan — SEED dulu 1 referral utk screenshot lalu cleanup); mobile 375×812 hscroll=0 kedua halaman; console 0 error baru. 3–4 screenshot `audit/e2e-b8/` (mkdir dulu).
- Data uji browser dibersihkan.

## G. WORKLOG + COMMIT + PUSH
Append worklog entri Task ID B8 (format B7) + `git add -f worklog.md`; SATU commit gaya B7 (`git log -1 e54599b`) + `git push origin main`; LAPOR lengkap (ringkasan + gates + commit + E2E n/n + screenshot + keputusan).

## DISIPLIN
- JANGAN ubah perilaku apply/portal existing; JANGAN buat modul training; insentif TIDAK menyentuh payroll sama sekali (teks manual saja).
- referralRewardNote TIDAK pernah dikirim ke ESS/pelamar (internal HR).
- DialogContent sm:max-w-*; t() BASE_EN; ActivityLog mutasi; self-scope ESS anti-IDOR.
- Context hampir habis → checkpoint commit + worklog DULU.
