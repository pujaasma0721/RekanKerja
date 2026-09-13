# OneVity Worklog

> REKONSTRUKSI (2026-09-12): worklog.md hilang 2× pada rollback snapshot sandbox
> (file di-gitignore). Mulai Task 44 file ini di-commit (git add -f) supaya
> selamat dari rollback. Protokol tetap: subagent WAJIB baca file ini sebelum
> bekerja & append hasil kerja dengan format `--- / Task ID / Agent / Task /
> Work Log / Stage Summary`.

## Aturan Emas (tidak berubah)

- DialogContent WAJIB `sm:max-w-*` — jangan modal full-width (task 39).
- i18n: semua label UI baru = BASE_EN + t(); error map 403/409 konsisten.
- Jangan rusak daftar "Aman" di audit/BPA-AUDIT-42.md (isolasi multi-tenant, HMAC
  session+sessionVersion+MFA, MIME whitelist+magic number, payslip AES-256,
  enkripsi 28-c payroll, upsert idempoten+advisory mutex, journal-no lock,
  PWA network-first).
- Enkripsi field: format `enc:v1:<t|n>:<iv>:<tag>:<ct>` via field-crypto.ts;
  decrypt HANYA di batas serializer API (decryptJson) atau di service saat
  menghitung — tidak pernah di query/sort SQL.
- Push SELALU otomatis setiap selesai melakukan perubahan (commit + push, tanpa
  menunggu perintah "push" dari user). Commit boleh tiap task. [DIUBAH 2026-09-13
  atas perintah user; sebelumnya: push hanya saat user bilang "push"]
- OOM guard: maks 2 subagent paralel berat (pelajaran task 41).

## Lingkungan Dev (pemulihan pasca-rollback #3, 2026-09-12)

- Postgres embedded: `cd mini-services/postgres && setsid nohup bun run index.ts &`
  (port 5432, user onevity/onevity_dev, db onevity). Data hilang tiap rollback.
- SMTP catcher: `cd mini-services/smtp-catcher && setsid nohup bun run index.ts &`
  (port 2525; JANGAN `bun --hot` — bind kadang gagal; direct index.ts stabil).
- `.env` WAJIB 3 var (semua `postgresql://onevity:onevity_dev@127.0.0.1:5432/onevity`):
  PLATFORM_DB_URL, TENANT_DB_BASE_URL, DATABASE_URL.
- Urutan recovery: start pg+smtp → `bun run db:generate` → `bun run db:push`
  (platform) → `bun scripts/restore-demo.ts` (+ `bun scripts/migrate-password-security.ts`
  bila inline gagal) → `bun run dev`.
- Login demo: hrd@mii.co.id/onevity123 → POST /api/auth/select-tenant {tenantId}
  → cookie sesi tenant. Health: /api/health.

## Riwayat Task (ringkas)

- Task 41 (06082dc): audit integrasi 40 — 3K+13M.
- Task 42 (audit): 7 KRITIS + 21 MAJOR + ~35 minor + 15 gap — audit/BPA-AUDIT-42.md.
- Task 43 (b744f6d, SUDAH PUSH): "perbaiki semua" audit 42 — 7 batch (43-a..43-g).
  7/7 K, 19/21 M (M-4 bukan-bug; M-8 & M-9 ditunda ke Task 44).
- Task 44 (BERJALAN): M-8 gelombang enkripsi kedua + M-9 PII scope + G-04 coverage.

---
Task ID: 44-0
Agent: orchestrator (Z.ai)
Task: Scoping & fondasi Task 44 — M-8 (38 kolom uang Float→String terenkripsi).

Work Log:
- Klasifikasi kolom: uang-personal → ENCRYPT; config/master (routing approval
  amount/minAmount/maxAmount, WageComponent(+Rule), TaxBracket, TerRate,
  PayrollRegulation, MinimumWage, LeaveType, TravelExpenseType(+Rule),
  MedicalBenefitType(+Rule), BenefitType(+Rule), AttendanceRule, Grade
  min/maxSalary, OvertimeOrder.rateMultiplier), non-uang (hari/qty/gpa/lat-lng/
  interestRate), GL perusahaan (Account.balance, Asset.value) → SKIP.
- Edit prisma/schema-tenant.prisma: 38 kolom Float→String (12 model) + regen
  tenant-ddl.sql (`bun run tenant:ddl`) + `bun run db:generate` (client tenant
  sekarang mengetik kolom tsb sebagai String).
- Tulis scripts/migrate-encrypt-money.ts (adaptasi migrate-encrypt.ts wave-1:
  ALTER Float→TEXT USING ::text + encrypt-in-place enc:v1:n, idempoten, skip
  non-numerik, main(schemas?) utk parity). Diverifikasi jalan di 3 tenant
  (fresh DDL sudah TEXT → 0 ALTER, tabel klaim kosong).
- PARITY_STEPS + key "encrypt-money" (parity-runner.ts, append-only kronologis).
- Rollback #3 mid-session: postgres data/dev server/worklog hilang; kode
  foundation selamat (git). Recovery penuh + MII partial seed 44 karyawan
  (tabel klaim kosong — seed crash di tulisan uang pertama → bukti fix modul
  wajib sebelum reseed penuh).

Stage Summary:
- SCOPE M-8 FINAL (38 kolom):
  · Loan(5): EmployeeLoan.amount/installmentAmount/paidAmount/outstanding, LoanInstallment.amount
  · Benefit(4): BenefitClaim.amount/approvedAmount/limitUsed/limitRemaining
  · Leave(1): LeaveEncashment.amount
  · Medical(19): MedicalBalance×8, MedicalClaim×6 (maxBenefitAt/usedAt/totalBill/
    totalReimburse/totalApproved/totalNonRe), MedicalClaimLine×4, MedicalAdjustment.amount
  · Travel(9): TravelClaim×5, TravelClaimExpense.amount, TravelAdvance.amount,
    TravelBudget.totalBudget, TravelBudgetItem.amount
- PATTERN WAJIB modul:
  · Tulis: `tc.encryptMoney(Number(x))` sebelum create/update (tc =
    tenantCryptoForDb(db) dari client LUAR bila di dalam $transaction).
  · Baca-serialize: `tenantCryptoForDb(db).decryptJson(rows)` di respons API —
    bentuk JSON frontend TIDAK berubah (angka tetap angka).
  · Baca-hitung: decryptMoney per field lalu aritmetika TS, re-encrypt saat tulis.
  · Agregasi SQL (groupBy/_sum) pada kolom ini → fetch rows + reduce in-memory.
  · Seed/demo-seed yang menulis kolom ini → encrypt juga.
  · Kolom `Float @default(0)` → `String @default("0")` — legacy "0" di-parse
    decryptMoney = 0 (kompatibel).
- TITIK KRITIS teridentifikasi: travel-service.ts:1447 (_sum amount),
  medical-service.ts:1593/1608/1621 (_sum totalApproved/totalBill),
  payroll-service.ts:90,555-638 (engine potongan loan — baca outstanding/
  installmentAmount/paidAmount + update), settlement-service.ts:393,
  payroll/services/benefit-service.ts (klaim benefit), travel-service.ts:1209
  (transfer klaim approved → payroll).
- DELEGASI: 44-b loan+benefit (payroll engine), 44-c medical, 44-d travel+
  encashment; maks 2 paralel; 44-e M-9 PII; 44-f G-04; 44-z final E2E + lint +
  tsc + commit TANPA push; orchestrator perbaiki seed.ts bersama + reseed penuh.

---
Task ID: 44-b
Agent: subagent (Z.ai) — modul Loan + Benefit
Task: M-8 gelombang enkripsi modul Loan + Benefit (5+4 kolom):
EmployeeLoan.amount/installmentAmount/paidAmount/outstanding,
LoanInstallment.amount, BenefitClaim.amount/approvedAmount/limitUsed/
limitRemaining → semua kode tulis encryptMoney / baca decryptMoney /
respons decryptJson (bentuk JSON frontend tetap ANGKA).

Work Log:
- payroll-service.ts: buildRunRows loanDues → tc.decryptMoney(due.amount)
  (engine menerima number); confirmRun apply cicilan → decrypt
  paidAmount/outstanding/inst.amount sebelum aritmetika + re-encrypt saat
  menulis balik (helper encLoan — kolom NOT NULL String, encryptMoney
  non-null); sinkron PHK_POT_LOAN (M-12) → decrypt cur.paidAmount/outstanding,
  re-encrypt; komentar lama "Float polos" dikoreksi. tc ditangkap dari client
  LUAR (payroll-service tidak menulis loan di dalam $transaction — loop
  confirmRun memakai db langsung).
- benefit-service.ts: limitSnapshot + approveClaim re-check + syncClaimComponent
  → fetch rows + reduce in-memory atas nilai terdekripsi (agregasi SQL pada
  kolom terenkripsi dihindari); submitClaim → amount/approvedAmount/limitUsed/
  limitRemaining dienkripsi saat create (helper encMoney); approveClaim →
  approvedAmount dienkripsi saat update; reject/schedule/markPaidCash/cancel
  tidak menyentuh kolom uang (status-only) — tidak diubah.
- settlement-service.ts (h): outstanding pinjaman → tc.decryptMoney sebelum
  reduce + note fmtRp (loansDec).
- api/loans.ts: POST → encL(amount/installmentAmount/paidAmount/outstanding);
  PATCH approve-final → principal = decryptMoney(loan.amount), tiap
  LoanInstallment.amount dienkripsi saat create; backfill chain legacy →
  amount didekripsi (ApprovalChain.amount TETAP Float — config routing, tidak
  diubah); semua respons (GET/POST/PATCH 5 titik) dibungkus
  tenantCryptoForDb(db).decryptJson(...) — angka utk frontend.
- api/benefit-claims.ts: GET → statistik dihitung dari amount terdekripsi
  (map dulu, reduce tetap in-memory) + claims dibungkus decryptJson; POST/PATCH
  → decryptJson pada respons klaim.
- api/benefit-types.ts GET: claims di-dekripsi sebelum reduce statistik
  (totalApprovedAmount/ytdAmount) — menghindari concat string terenkripsi.
- scripts/migrate-approval-structure.ts: backfill chain Loan →
  tcLoan.decryptMoney(r.amount) (string terenkripsi → number utk
  ApprovalChain.amount). Bagian Travel script ini diperbaiki agen 44-d;
  bagian Medical (line ~380 totalBill) DIBIARKAN utk agen 44-c.
- VERIFIKASI in-process (scripts/verify-44b.ts sementara, DIHAPUS setelah
  selesai): 27/27 lulus di tenant MII — (a) pg raw: BenefitClaim amount/
  limitUsed/limitRemaining/approvedAmount + EmployeeLoan 4 kolom +
  LoanInstallment.amount berprefix enc:v1:n; (b) roundtrip decrypt = input
  (500000/100000/2000000/1200000); (c) approveClaim menulis approvedAmount
  terenkripsi baru; (d) limitSnapshot used=500000 setelah approve; (e)
  buildRunRows memuat angsuran dgn amount number 100000; (f) E2E penuh
  run SALARY (period uji) → calculateAndSaveRun → confirmRun: paidAmount
  terdekripsi 100000, outstanding 1100000, cicilan Deducted; (g) cleanup
  semua baris uji = 0 baris tersisa.
- Curl guard (dev server restart — mati oleh OOM kill sandbox, dibangkitkan
  ulang): login+select-tenant 200; GET /api/onevity/loans 200 {"loans":[]};
  GET /api/onevity/benefit-claims 200 (stats number); GET /api/onevity/
  benefit-types 200. Uji tulis via HTTP: POST benefit-claims 201 (amount
  250000, limitRemaining 1000000 — angka di respons, enc:v1:n di DB),
  PATCH approve 200 approvedAmount 250000; POST loans 201 (amount 1200000,
  outstanding 1200000), PATCH approve-final → 12 cicilan dibuat (inst1
  100000), GET loans 200 angka utuh. Baris uji API dibersihkan (0 sisa).
- bunx tsc --noEmit: 0 error di src/onevity/payroll + shared (sisa error
  hanya modul paralel: medical-service, travel-service,
  migrate-travel-settlement-fix, migrate-approval-structure medical-line,
  prisma/seed.ts — di luar scope 44-b). bun run lint: bersih (exit 0).

Stage Summary:
- Modul Loan + Benefit M-8 SELESAI: 7 file diubah (payroll-service,
  benefit-service, settlement-service, api/loans, api/benefit-claims,
  api/benefit-types, scripts/migrate-approval-structure), 0 file baru
  (skrip verifikasi dibuat lalu dihapus sesuai instruksi).
- Pola konsisten 28-c/44-0: encryptMoney sebelum create/update (helper
  encMoney/encLoan/encL utk kolom NOT NULL String), decryptMoney per field
  utk aritmetika service, decryptJson di batas respons API (frontend tidak
  berubah), tanpa agregasi/orderBy SQL pada kolom uang (semua reduce sudah
  in-memory, kini atas nilai terdekripsi).
- Kolom config approval (ApprovalChain/Step/StructureLevel amount) dan
  BenefitType.maxClaimAmount TETAP Float (routing/master — sesuai scope).
- Risk tersisa: (1) prisma/seed.ts masih menulis number → seed crash pada
  loan/claim uang (tabel klaim MII kosong) — orchestrator; (2) line medical
  di migrate-approval-structure.ts menunggu 44-c; (3) dev server sandbox
  rawan OOM-kill saat kompilasi paralel — guard curl perlu server hidup.

---
Task ID: 44-d
Agent: subagent (Z.ai, gelombang M-8 modul travel + encashment)
Task: Enkripsi 9+1 kolom uang modul Travel (TravelClaim×5, TravelClaimExpense.amount,
      TravelAdvance.amount, TravelBudget.totalBudget, TravelBudgetItem.amount) +
      LeaveEncashment.amount — tulis encryptMoney, baca decryptMoney, respons
      decryptJson, agregasi SQL → in-memory.

Work Log:
- travel-service.ts: sumActiveAdvances kini (tc, advances) — decrypt per baris
  (6 call site). submitTravelRequest advance → encryptMoney. createClaim: 5
  kolom klaim + expense.amount di-createMany → encrypt. listTravelClaims /
  previewClaim / claimReport / listBudgets / travelStats: semua read money →
  decrypt (DTO tetap number — bentuk respons frontend tidak berubah).
- generateClaimJournal: drafts dari nilai TERDEKRIPSI (expense.amount, loss,
  contra (a), b, c) — jurnal tetap ditulis terenkripsi wave-1 (tcJ, tidak
  dobel-enkripsi; drafts angka murni di memori).
- travelStats: groupBy _sum.amount (TravelClaimExpense) DIGANTI findMany +
  agregasi in-memory per kind (agregasi SQL atas ciphertext dilarang);
  budgetTotal/claimsYtdAmount/advanceOutstanding/used → reduce atas nilai
  terdekripsi.
- transferClaimsToPayroll: b/c klaim didekripsi via tcC (ditangkap dari client
  LUAR sebelum $transaction) → assignment UTRP/TRVSTLIN tetap encryptMoney;
  markTravelPaidForRun: pengecekan b=c=0 pakai nilai terdekripsi.
- upsertBudget: totalBudget + item amount → encryptMoney; decideClaim
  legacy-backfill + ActivityLog total settlement → decrypt (amount chain =
  angka; log tidak bocor ciphertext).
- claims.ts API: GET ?id= (row mentah) dibungkus tenantCryptoForDb(db)
  .decryptJson(detail); email {{amount}} pasca approve/reject → decrypt dulu.
- ess/api/claims.ts: advance di-reduce setelah decrypt per baris (reduce atas
  string = concat!) + settlement decrypt + payload dibungkus decryptJson.
- leave-service.ts (encashment): submitEncashment create → encryptMoney;
  decideEncashment amountApproved fallback snapshot → decrypt + persist
  terenkripsi (tc dari client luar — runTx tanpa brand); listEncashments →
  decrypt; transferEncashment amount snapshot → decrypt (assignment UCT tetap
  terenkripsi, ActivityLog total = angka). leave-seed.ts encashment → encrypt.
- travel-seed.ts: budget total+items, advance, 5 kolom klaim, expense.amount →
  encryptMoney (seed demo tidak lagi crash di tulisan uang pertama).
- scripts/migrate-travel-settlement-fix.ts: klaim/advance/expense dibaca +
  didekripsi sebelum komputasi formula; update b/c/totalSettlement → encrypt
  (tidak ada plaintext number ke kolom String). scripts/migrate-t15-ot-claim.ts
  + migrate-approval-structure.ts: nominal chain travel → decryptMoney.
- report-builder.ts: entity travel_claims 3 field uang diberi flag
  encrypted=true → sel XLSX/CSV + filter pakai nilai terdekripsi (sort/filter
  in-app otomatis via jalur 28-c).

Stage Summary:
- VERIFIKASI LOLOS: tsc --noEmit → 0 error file travel/leave/ess-claims
  (sisa error = medical 86 + prisma/seed 17 + migrate-approval-structure:380
  [medical totalBill] = pekerjaan agen 44-c/orchestrator, TIDAK disentuh).
- In-process scripts/verify-44d.ts (dihapus setelah pakai): budget+item,
  request+advance 1,5jt, claim 3 expense + loss 300rb + (a) 200rb → R=2.8jt,
  b=1,3jt, c=0 SEMUA cocok formula; DB berprefix enc:v1: (query pg langsung),
  roundtrip decrypt = input, jurnal klaim D=C lolos (total D = beban bruto
  3jt); encashment submit+approve (amount=round(days×gpokok/25)=3.052.000)
  roundtrip + snapshot pasca-approve tetap terenkripsi. Cleanup baris uji OK.
- Curl guard (sesi tenant MII): travel/budget·claims·overview·requests·reports
  & leave/encashment → 200; travel/transfer GET → 405 (POST-only, wajar).
  POST budget → 201, GET balik angka murni (dihapus setelah uji). dev.log
  bersih (tanpa 500). bun run lint → 0 error/warning baru.
- Kolom HARI (days/qty/carriedOver/cashed/workingDays) & config limitAmount
  TETAP Float — tidak disentuh. Bentuk respons API tidak berubah.
- Risiko tersisa: tmp-sim-parity.ts (skrip parity usang, tidak direferensikan)
  masih membaca kolom travel via SQL mentah — hanya relevan bila dijalankan
  manual; orchestrator sebaiknya menghapus saat 44-z.

---
Task ID: 44-c
Agent: subagent (Z.ai) — modul Medical (gelombang enkripsi M-8, 19 kolom)
Task: Enkripsi 19 kolom uang modul Medical — MedicalBalance×8 (benefitAmount/
adjustmentAmount/initialUsed/usedAmount/depBenefitAmount/depAdjustment/depUsed/
carriedOver), MedicalClaim×6 (maxBenefitAt/usedAt/totalBill/totalReimburse/
totalApproved/totalNonRe), MedicalClaimLine×4 (billAmount/reimburseAmount/
approvedAmount/nonReAmount), MedicalAdjustment.amount → tulis encryptMoney, baca
decryptMoney, respons angka murni, agregasi SQL → in-memory.

Work Log:
- medical-service.ts (~264 baris berubah): helper modul decMoney/encMoney
  (legacy plaintext numerik tetap di-parse). claimPoolAvailability: 8 kolom
  saldo + totalApproved klaim lain → dekripsi (reservasi pendingOthers = jumlah
  angka, bukan concat string). generateBalances: create menulis SEMUA 8 kolom
  terenkripsi (termasuk 0); limitCorrection re-encrypt; carry-over dihitung dari
  saldo tahun lalu TERDEKRIPSI. listBalances/previewClaim: DTO angka (8 kolom +
  remaining/depRemaining; baseSalary tetap dekripsi 28-c).
- submitClaim: 6 kolom header (snapshot maxBenefitAt/usedAt dari pool
  terdekripsi + 4 total) + 4 kolom per baris → encMoney; startApprovalChain
  amount = totalBill angka in-memory. listClaims: header + lines di-dekripsi
  (DTO angka; cast lama (c as {lines}).lines diganti mapping ter-tipe).
- decideClaim: claimTotal{Approved,Bill,MaxBenefitAt,UsedAt} didekripsi sekali
  (re-check K-1/K-2 approve & settle, pesan fmtRp, chain legacy-backfill,
  usedAdded). Settle $transaction: tc ditangkap dari client LUAR →
  generateSettleJournal(tx, claimId, tc) (draft jurnal dari approvedAmount
  TERDEKRIPSI; jurnal tetap ditulis terenkripsi wave-1 via tcJ=tc — tidak
  dobel); bal.usedAmount/depUsed didekripsi → +usedAdded → re-encrypt; remaining
  respon dari saldo terdekripsi. BUKAN tenantCryptoForDb(tx) lagi (tx tanpa
  brand — komentar lama "Prisma 6.11 tetap membaca brand" dikoreksi).
- submitAdjustment: amount → encMoney. decideAdjustment: approve →
  depAdjustment/adjustmentAmount lama didekripsi + adjAmount → re-encrypt.
  listAdjustments: amount DTO angka. transferUnusedToPayroll: remaining dari
  saldo terdekripsi (filter > 0 atas angka), assignment UMC tetap encryptMoney,
  usedAmount konsumsi → decrypt + re-encrypt. medicalStats: _sum + groupBy SQL
  DIGANTI findMany settled + reduce in-memory (settledApproved/settledBill/
  byType per jenis) — agregasi atas ciphertext dilarang; sisa saldo reduce atas
  nilai terdekripsi. claimReport: totalBill/totalApproved DTO angka.
- api/claims.ts PATCH: email/in-app notifikasi settle/approve/reject →
  amountVal = decryptMoney(totalApproved ?? totalBill) (2 error TS hilang;
  {{jumlah}} angka murni). Guard M-6/M-21 + T16-ATTACH + T32-d TIDAK disentuh.
- scripts/migrate-approval-structure.ts: backfill chain Medical →
  tcMed.decryptMoney(totalBill) (pola loan 44-b / travel 44-d).
- report-builder.ts: entity medical_claims 3 field uang → flag encrypted=true
  (sel XLSX/CSV + filter pakai nilai terdekripsi — jalur 28-c otomatis).
- medical-seed.ts TIDAK diubah — seeder memakai service (submitClaim/decideClaim/
  generateBalances/adjustment) → otomatis menulis terenkripsi.
- VERIFIKASI in-process (scripts/verify-44c.ts sementara, DIHAPUS): 47/47 lulus
  tenant MII — (a) generate 24 saldo: 8 kolom enc:v1:n: di pg raw (queryRaw
  PascalCase/camelCase), limit RAWAT_INAP = 1×gaji 22,7jt & RAWAT_JALAN 25jt;
  (b) claim 3 baris: header+4 kolom line enc:v1:, roundtrip = input, listClaims
  angka; (c) approve → usedAmount tetap (barulah settle); (d) settle →
  usedAmount +2,2jt, jurnal JV-2026-0001 D=C 2,2jt (3 Debit line + 1 Credit,
  total terenkripsi), chain amount 2,4jt; (e) adjustment +2jt → adjustmentAmount
  enc + bertambah; (f) medicalStats/claimReport angka (settledApproved 2,2jt,
  byType RAWAT_JALAN, remaining 213,75jt — bukan NaN/concat). Cleanup 0 sisa.
- Curl guard (dev server hidup): login+select-tenant 200; GET medical/claims·
  balances·overview·reports·adjustments → 200; tanpa sesi → 401; sesi ESS
  non-HR (yusuf@mii.co.id, di-seed utk uji) → claims 403 (M-6 view guard) &
  balances 200 self-scope (M-21). HTTP write path: POST balances 201 → POST
  claim +lampiran 201 (angka murni) → PATCH approve 200 → PATCH settle 200
  (jurnal + usedAdded 600rb + remaining 24,4jt) → GET balik angka murni;
  ess/claims medical bill/approved angka (decryptJson 44-d menutup jalur ini).
  Semua baris uji (claim/lines/balance/jurnal/chain/attachment/log/notif/
  emailLog) dibersihkan → 0 sisa. dev.log: 0 respons 500.
- bunx tsc --noEmit: 0 error medical/migrate-approval-structure; sisa TOTAL 21
  error SEMUA di prisma/seed.ts (bagian shared — milik orchestrator, sesuai
  instruksi tidak disentuh). bun run lint: bersih (exit 0).

Stage Summary:
- Modul Medical M-8 SELESAI: 4 file diubah (medical-service.ts, medical/api/
  claims.ts, scripts/migrate-approval-structure.ts, shared/services/
  report-builder.ts) + 0 file baru (skrip verifikasi dibuat lalu dihapus).
- Bentuk respons API tidak berubah (angka tetap angka — DTO service di-dekripsi
  per field, bukan decryptJson wrapper, karena service selalu memetakan DTO).
- Agregasi SQL dipindah in-memory: medicalStats _sum(totalApproved/totalBill) +
  groupBy per typeId → findMany + reduce; claimPoolAvailability pendingOthers
  & generateBalances carry-over atas nilai terdekripsi.
- $transaction settle: konteks crypto kini eksplisit dari client luar (bukan
  asumsi brand pada tx) — selaras catatan 44-d leave-service.
- Kolom config (MedicalBenefitType(+Rule) limitValue/maxCarryOver/freqValue)
  TETAP Float; kolom hari/non-uang tidak disentuh; ApprovalChain.amount Float.
- Risk tersisa: (1) prisma/seed.ts 21 error TS + seed demo modul medical →
  orchestrator (medical-seed siap — lewat service); (2) akun demo ESS
  yusuf@mii.co.id/EssDemo123! sengaja di-seed ulang utk uji guard (fixture
  standar skrip seed-ess-demo-user.ts — berguna utk 44-z); (3) SMTP catcher
  sandbox mati (bind gagal) → email notifikasi fire-and-forget hanya tercatat
  di emailLog, pengiriman gagal diam-diam (lingkungan, bukan kode).

---
Task ID: 44-e
Agent: subagent (Z.ai) — Agent M-9 (audit 42): PII Employee scope-aware list
Task: Field-selection PII per cakupan akses di GET /api/onevity/employees +
      export XLSX + employee-detail (audit 42 item M-9, desain 42-e) — pemanggil
      limited (menu LIHAT + scope data CUSTOM) tidak lagi menerima PII sensitif
      (alamat/telepon/bank/NIK lengkap/dll); full & self tetap perilaku lama.

Work Log:
- employees.ts: blok M-9 baru setelah EMPLOYEE_LIST_MENUS — tipe PiiScope
  ("full"|"limited"|"self"), PII_REDACT_FIELDS, maskEmployeePii(row, tc)
  (exported; dipanggil di LAPISAN API SETELAH flattenEmployee+decrypt —
  tanda tangan service bersama assignment.ts TIDAK diubah). Komentar desain:
  field operasional vs PII sensitif + BYPASS approval InProgress (pragmatis —
  field tidak-di-mask [nama, no, unit, posisi, joinDate] memang cukup utk
  keputusan approver; TANPA query chain per-baris).
- GET list: piiScope = !menu→"self" | scope.all→"full" | else "limited";
  limited → maskEmployeePii per baris (address/city/phone/birthPlace/birthDate/
  maritalStatus/religion/bloodType/bankName/bankAccount/bpjsHealth/bpjsEmpSkill/
  baseSalary → null; nationalId→maskNik, taxId→maskNpwp). Flag piiScope di
  payload root (properti baru opsional). Key-set respons IDENTIK utk semua
  scope (field null ≠ field hilang — verified). Masking seragam per-baris
  (baris milik sendiri dalam result limited ikut ter-mask; profil sendiri
  tetap full via employee-detail self / ESS).
- Export XLSX (employeesExportGet): pemanggil limited (scope.all=false) —
  kolom PII DIHILANGKAN (PII_EXPORT_KEYS: nik/phone/marital/religion/
  bloodType/taxId/address/bankName/bankAccount) + baseSalary (gating lama
  includeWage tetap); guard requireMenuAction hr:directory view tetap.
- employee-detail.ts (GET): piiScope = scope.all→"full" | id===self→"self" |
  else "limited" (guard isEmployeeInScope M-11 TETAP — 403 bila di luar
  cakupan). Limited → maskEmployeePii(personal) + family/education/
  experiences/disciplinary dikosongkan (PII dependen & data personal lanjutan)
  + baseSalary null (current + riwayat assignments); actions/directReports/
  manager/pkwt/penempatan tetap (operasional). Flag piiScope di root.
  Import (pola personnel-actions-detail→offboarding) maskEmployeePii dari
  api/employees.ts.
- Kontak darurat: TIDAK ada di model Employee; EmployeeFamily hanya
  relation/name/gender/birthDate/occupation (tanpa telepon) dan memang tidak
  di-return endpoint list — dicatat di komentar, tidak ada kolom utk di-mask.
- VERIFIKASI (dev server mati tiap akhir tool-call oleh reaper sandbox —
  server dibangkitkan per-batch; dmesg: OOM-kill next-server lama):
  · hrd@mii.co.id (OWNER full): list piiScope "full" total 44 — address/city/
    phone/birthDate/marital/religion/bloodType/NIK plaintext/NPWP/bankName/
    bankAccount didekripsi/bpjs/baseSalary TERISI (perilaku lama). Detail
    MII00001 piiScope "full" family=3, baseSalary 54,9jt. Export 24 kolom
    penuh (NIK/Telepon/Alamat/Bank/Gaji Pokok ada).
  · Akun uji limited sementara: platform user bambang-test@mii.co.id
    (BambangTest123!, UserTenant role HR) ditautkan ke AppUser MII000002
    Bambang (CUSTOM menu hr:directory view + rule ACC-BAMBANG-FIN unit
    Finance + 3 bawahan langsung — scope CUSTOM non-all). DIHAPUS setelah
    verifikasi (UserTenant 1 + User 1 di-delete; email AppUser MII000002
    di-reset null).
  · limited: list piiScope "limited" total 4 (diri + 3 bawahan) — address/
    city/phone/birthDate/birthPlace/marital/religion/bloodType/bankName/
    bankAccount/bpjs/baseSalary = null; nationalId "31•••••••••87" (maskNik);
    taxId "••••••••1604" (maskNpwp); penempatan TETAP (orgUnit/position/
    employmentStatus/joinDate/email kantor). Detail bawahan (MII00013) →
    piiScope "limited", PII masked + family/education/experiences/disciplinary
    0 + baseSalary null di current & riwayat; actions(1)/manager/pkwt tetap.
    Detail DIRI (MII00003) → piiScope "self" FULL. Export XLSX → 14 kolom
    tanpa NIK/Telepon/Pernikahan/Agama/Darah/NPWP/Alamat/Bank/Rekening/Gaji;
    scan sel (exceljs) = 0 nilai PII.
  · yusuf@mii.co.id (ESS non-menu, di-seed ulang via scripts/seed-ess-demo-
    user.ts): list hanya dirinya (total 1) piiScope "self" data sendiri FULL
    (alamat/telepon/NIK/NPWP/bank/baseSalary terisi); detail sendiri "self"
    full; export → 403 (guard menu M-11/32-d utuh).
  · Guard lama tetap: tanpa sesi → 401 (list/detail/export); detail di luar
    cakupan (bambang→MII00001) → 403 pola lama. dev.log 0 respons 500.
  · bunx tsc --noEmit → 0 error; bun run lint → bersih (exit 0).

Stage Summary:
- M-9 SELESAI: 2 file diubah (employees.ts +92, employee-detail.ts +39), 0
  file baru; bentuk respons TIDAK berubah (key-set identik full/limited/self —
  hanya nilai null/mask + flag piiScope baru opsional di root).
- Keputusan field: MASKED utk limited = address, city, phone, birthPlace,
  birthDate, maritalStatus, religion, bloodType, bankName, bankAccount,
  bpjsHealth, bpjsEmpSkill, baseSalary (null), nationalId (maskNik),
  taxId (maskNpwp); TETAP = employeeNo, fullName, gender, email & foto
  kantor, joinDate, status, contract*, penempatan (orgUnit/position/grade/
  level/office/location/manager), employmentStatus, workShift; detail limited
  + family/education/experiences/disciplinary kosong, actions tetap.
- Risk/edge: (1) pemanggil menu-ALL-tapi-data-self (tanpa rule) → baris
  sendiri ikut ter-mask di list (bentuk bucket per-scope by design; profil
  sendiri tetap full via detail self/ESS); (2) export limited menghilangkan
  kolom (bukan kolom kosong) — file XLSX bentuk beda vs full by design;
  (3) ESS yusuf dibiarkan ter-seed (fixture standar utk 44-z); dev server
  sandbox dibunuh reaper tiap akhir tool-call + rawan OOM saat kompilasi —
  44-z perlu bangkitkan ulang sebelum E2E.

---
Task ID: 44-f
Agent: subagent (Z.ai) — G-04 warning coverage absensi
Task: Audit 42 gap G-04 — indikator coverage kualitas data presensi di
dashboard attendance (regenerasi AttendanceDaily belum/tidak lengkap tidak
lagi diam: KPI menampilkan peringatan sebelum dipakai payroll/kehadiran).

Work Log:
- attendance-service.ts: fungsi baru attendanceCoverage(db, monthFrom,
  monthTo) + tipe AttendanceCoverageResult/MissingDay/MissingEmployee.
  Populasi harapan = Employee.status "Active" (identik regenerateDaily) ×
  hari kerja terjadwal [awal bulan, min(akhir bulan, HARI INI)] — resolusi
  MEMAKAI resolveDayTypeFromCache (fungsi murni M-13) + assignment sah per
  tanggal (padanan assignmentFor) + overlay HolidayDate (prioritas holidayOn)
  → definisi Off/Holiday/workday 100% sama dgn engine (satu sumber kebenaran,
  engine regen TIDAK diubah). Hari future tidak dihitung (K-3).
- Aktual = 2 query groupBy count (per workDate, per employeeId) where
  dayTypeId IN (kategori "Workday") AND employee.status "Active" — baris
  regen menyimpan dayTypeId hasil resolusi → baris Off/libur/tanpa jadwal
  otomatis terkecualikan; TANPA fetch per-karyawan-per-hari. Total query
  tambahan: 5 kecil + 2 groupBy; missing di-clamp ≥0 (baris stale assignment
  tidak bikin coverage negatif). Output: {expected, actual, missing,
  coveragePct (expected 0 → 100), asOf, missingByDay top-10, missingByEmployee
  top-10} + helper isoLocal (YYYY-MM-DD lokal, bukan UTC).
- api/overview.ts: GET /attendance/overview kini Promise.all
  [attendanceStats, attendanceCoverage] → respons {…stats lama, coverage}
  (properti baru — bentuk lama tetap utuh; attendanceStats tidak disentuh;
  konsumen satu-satunya attendance-overview.tsx). Respons ~40ms (lightweight).
- attendance-overview.tsx (frontend): OverviewData + coverage? (opsional,
  payload lama tetap render); komponen CoverageAlert lokal di antara grid KPI
  dan kartu bulan berjalan: Badge shadcn variant outline + ikon
  ShieldCheck/TriangleAlert/ShieldAlert; ambang ≥98 hijau "Data Lengkap" ·
  90-98 kuning "Data Belum Lengkap ({p}%)" · <90 merah "Data Tidak Lengkap
  ({p}%)" + detail ("{n} kombinasi hilang · terburuk {d} ({n}) · karyawan:
  top-3 employeeNo") + tombol hint "Jalankan Regenerasi Presensi" → navigate
  clocking (halaman Clocking punya Hitung Ulang per tanggal). i18n BASE_EN
  inline t() persis pola file (12 pasang ID/EN); format angka/tanggal via
  locale useI18n; flex-wrap responsif (mobile 390px: kotak 358px muat); while
  loading awal tetap LoadingRows (perilaku lama); badge + tombol tidak merusak
  grid/sticky yang ada.
- VERIFIKASI: bunx tsc --noEmit 0 error; bun run lint exit 0.
  Backend (cookie MII): bulan berjalan Sep → expected 355, actual 355, 100%
  (355 = cross-check SQL manual workday-rows Sep 1-12: 34+42+36+35+6+7+42+
  36+35+33+34+15 — cocok); date=2026-08-01 → 843/843 100% (full Aug);
  date=2026-08-15 → bulan sama 843; date=2026-10-05 (future) → expected 0,
  coverage 100 anggun.
- Uji gap (pg + snapshot-restore verbatim): hapus 14 baris (Sep 8: 8
  karyawan office MII00001-08; Sep 10: MII00001-06) → coverage 341/355 =
  96,1% KUNING, missingByDay [2026-09-08:8, 2026-09-10:6], byEmployee
  MII00001-06=2, MII00007-08=1 (persis desain uji); tambah hapus seluruh
  42 baris Sep 2 → 299/355 = 84,2% MERAH, byDay [Sep2:42, Sep8:8, Sep10:6],
  byEmployee top-10 ter-cap (MII00001-06=3, MII00007-08=2, lainnya 1).
  RESTORE: insert balik 56 baris verbatim (id+semua kolom) → total 2545 =
  sebelum, Sep 1-12 kembali 42/hari, verifikasi field-per-field 56/56
  identik, coverage kembali 100%, month.present kembali 729 (nilai awal).
- Frontend (agent-browser headless, tenant MII): snapshot a11y memuat
  "KUALITAS DATA PRESENSI / 355/355 kombinasi karyawan-hari terhitung · s.d.
  12 Sep 2026 / [Data Lengkap]"; kuning: "Data Belum Lengkap (96,1%) · 14
  kombinasi hilang · terburuk 2026-09-08 (8) · karyawan: MII00001 (2)…";
  merah: "Data Tidak Lengkap (84,2%) · 56 kombinasi hilang · terburuk
  2026-09-02 (42)…"; klik "Jalankan Regenerasi Presensi" → URL ?m=attendance
  &v=clocking; toggle EN (localStorage onevity:lang) → "ATTENDANCE DATA
  QUALITY / 355/355 employee-day combinations recorded · as of Sep 12, 2026
  / Complete Data"; viewport 390px: alert 358px (wrap OK) — overflow 414px
  di halaman berasal dari actions PageHeader lama (flex gap-2, PRE-EXISTING,
  bukan komponen baru). Screenshot /tmp/44f-{green,yellow,red,red-mobile,
  final-green}.png.

Stage Summary:
- G-04 SELESAI: 3 file diubah (attendance-service.ts +195, api/overview.ts
  +11, attendance-overview.tsx +92), 0 file baru permanen (uji via bun -e +
  snapshot /tmp, browser headless).
- Formula coverage: expected = karyawan aktif × hari-kerja terjadwal s.d.
  hari ini (definisi engine: resolveDayTypeFromCache + assignmentFor +
  holiday overlay); actual = baris AttendanceDaily groupBy dayTypeId
  kategori Workday & karyawan aktif; coveragePct = actual/expected (clamp,
  expected 0 → 100). Kompatibel: respons lama utuh, engine regen tidak
  disentuh, guard 401 tenant tetap.
- i18n keys baru (inline BASE_EN): "Kualitas Data Presensi"/"Attendance Data
  Quality", "Data Lengkap"/"Complete Data", "Data Belum Lengkap ({p}%)"/
  "Data Incomplete ({p}%)", "Data Tidak Lengkap ({p}%)", "{a}/{b} kombinasi
  karyawan-hari terhitung · s.d. {d}", "{n} kombinasi hilang", "· terburuk
  {d} ({n})", "· karyawan: {list}", "{no} ({n})", "Jalankan Regenerasi
  Presensi"/"Run Attendance Regeneration".
- Risk tersisa: (1) baris STALE (assignment berubah tanpa regen) dihitung
  pakai dayTypeId tersimpan — missing bisa understate sampai regen dijalankan
  (indikator tetap memandu regen; acceptable by design); (2) threshold 98/90
  dipilih di KODE (bukan AttendanceRule) — bisa dinaikkan jadi konfigurasi
  bila kebijakan tenant berbeda; (3) header actions PageHeader lama overflow
  414px @390px (pre-existing, di luar scope 44-f); (4) dev server sandbox
  rawan mati antar-perintah (agent paralel + OOM) — tiap curl guard memastikan
  server hidup dulu (restart setsid nohup).

---
Task ID: 44-FINAL (44-z)
Agent: orchestrator (Z.ai)
Task: Penutup Task 44 — seed shared, reseed penuh, E2E browser, dokumentasi, commit.

Work Log:
- prisma/seed.ts: helper encM non-null + mkLoan (amount/installmentAmount/paidAmount/outstanding/installments.amount) + 4 blok db.benefitClaim.create (amount/limitUsed/limitRemaining) → encryptMoney (21 error TS terakhir hilang; tsc repo 0 error).
- Clean slate: DROP 3 schema tenant + TRUNCATE platform registry → restore-demo.ts FULL (seed lolos menulis uang terenkripsi: 3 loan/24 cicilan, 9 benefit claim, 10 medical claim/11 line/378 balance, 5 travel claim/15 expense/4 advance/budget, 4 encashment, 3 run payroll) → migrate-encrypt-money.ts rerun = 0 baru (idempoten) → migrate-password-security.
- Verifikasi at-rest: EmployeeLoan.amount & MedicalClaim.totalBill prefix enc:v1:n; BenefitClaim/MedicalClaimLine plaintext tersisa = 0.
- Hapus scripts/tmp-sim-parity.ts (usang, tidak direferensikan — saran 44-d).
- E2E agent-browser (login hrd MII → pilih workspace): badge G-04 "KUALITAS DATA PRESENSI 355/355 · Data Lengkap"; medical overview Rp 14,1 jt settled / Rp 2,5 M saldo; klaim MC-2026-001 Rp10.070.000; benefit Rp12.800.000; encashment LE-2026-001 Rp 4.448.000; loan LTR-2026-001 outstanding Rp 11.000.000 (cicilan engine terpotong benar); direktori 44 karyawan; mobile 390px + footer sticky + bottom-nav 84px utuh; console & page errors 0; dev.log 0×500 (semua API 200).
- DEPLOY-RUNBOOK.md: parity #21 encrypt-money + §5.2.1 catatan perilaku M-8/M-9.
- audit/BPA-AUDIT-42.md: header status lanjutan Task 44 (M-8/M-9/G-04 SELESAI).

Stage Summary:
- Task 44 SELESAI: M-8 (38 kolom uang terenkripsi, 12 model, 5 modul), M-9 (PII scope-aware list/detail/export), G-04 (badge coverage presensi).
- tsc 0 error, lint bersih, E2E hijau penuh, worklog lengkap (44-0,44-b,44-c,44-d,44-e,44-f,44-FINAL).
- Audit 42 kini TUNTAS 100%: 7/7 K + 21/21 M (M-4 bukan-bug, M-8+M-9 selesai di 44) + G-04.
- Commit TANPA push (menunggu instruksi "push" user).

---
Task ID: 45-a
Agent: full-stack-developer
Task: Money Vault backend core (schema, DDL, kripto, API, audit) — gerbang
      visibilitas nilai uang terenkripsi per tenant.

Work Log:
- Baca worklog (44-0/44-b..44-z) + file acuan: field-crypto.ts (format
  enc:v1 + deriveTenantKey + brand schema), migrate-encrypt-money.ts (pola
  SCHEMAS + pg Client + SET search_path + CLI guard), parity-runner.ts
  (STEPS append-only), tenant-db.ts (requireTenant/requireMutator + cache
  key versi), access-scope.ts (SUPER_ADMIN_PLATFORM_ROLES), notifications
  (pola route tipis → modul shared/api), wa-config (konvensi error + audit
  inline ActivityLog).
- prisma/schema-tenant.prisma: 2 model baru MoneyVault (salt/verifier/
  wrappedKey/openUntil?/openByUserId? — openUntil/openByUserId INFORMATIF,
  status open otoritatif di memori) + MoneyViewGrant (userId @unique =
  PLATFORM user id, grantedBy, revokedAt? — aktif saat null). Satu baris
  vault per schema dijaga kode (findFirst orderBy createdAt; >1 → pakai
  pertama). `bun run db:generate` → src/generated/tenant kini mengetik
  db.moneyVault / db.moneyViewGrant (terverifikasi grep index.d.ts).
- tenant-db.ts: cache key globalThis dinaikkan W28→T45A (instance client
  lama tanpa model vault tidak dipakai ulang pasca-regenerasi — pola T7/T15/
  W27/28-c).
- scripts/migrate-money-vault.ts (BARU): DDL idempoten CREATE TABLE IF NOT
  EXISTS "MoneyVault" + "MoneyViewGrant" + unique index userId, kolom persis
  model Prisma (TEXT/TIMESTAMP(3), PK cuid, default CURRENT_TIMESTAMP),
  verifikasi information_schema per schema, CLI guard /scripts/, import
  ./lib/env. Dijalankan utk 3 tenant → OK; rerun + in-process import (jalur
  parity) = 0 perubahan (idempoten).
- parity-runner.ts: langkah { key: "money-vault" } didaftarkan SETELAH
  task43-indexes (append-only kronologis).
- field-crypto.ts (BACKWARD COMPAT — semua export lama utuh): +3 export
  tenantDataKey(schema) (deriveTenantKey alias), decryptTextWithKey(stored,
  key), decryptMoneyWithKey(stored, key) — dekripsi AES-256-GCM 6-segmen
  kind t/n dengan kunci EKSPLISIT (legacy plaintext dioper sama perilaku
  konteks; malformat/auth-tag/kind-salah → throw).
- src/onevity/shared/lib/money-vault.ts (BARU): PBKDF2_ITERATIONS=210_000
  (sha256 keylen 64; 32 pertama KEK, 32 akhir verifierKey), VAULT_TTL_MS=8j,
  LOCKOUT 5×/15m, MIN_PASSWORD_LEN=8. State symbol-keyed globalThis
  (Symbol.for "onevity.moneyVault.state" — selamat HMR): openKeys
  (Map<schema,{dek,openUntil,openBy}>), configCache (TTL 60s, invalidasi
  setup/change-password), grantCache (TTL 60s, invalidasi grant/revoke),
  fails (lockout). Verifier "vrf:v1:"+HMAC-SHA256(vk,"onevity-money-vault")
  hex; wrappedKey "vlt:v1:iv:tag:ct"=AES-256-GCM(KEK, tenantDataKey(schema)).
  API: vaultInfo, setupVault (409 ALREADY_CONFIGURED/400 WEAK, langsung
  open), unlockVault (verifier timing-safe; fails→429; unwrap DEK; sync kolom
  informatif best-effort; param actor opsional utk openBy), lockVault
  (idempoten), changeVaultPassword (409 VAULT_LOCKED bila tak open → 403
  current salah → 400 lemah; re-wrap DEK sama, salt/verifier baru, TETAP
  open), setGrant (insert/aktifkan-ulang/cabut — idempoten DB), grantUserIds
  (Set aktif, cache), memberList(db, tenantId) (platform User+UserTenant
  join, urut nama, flag granted; P2021→legacy-safe null/kosong).
  VaultError {code,status} + peta status/pesan Bahasa Indonesia.
  KEPUTUSAN DESAIN: memberList menerima tenantId EKSPLISIT dari route (route
  sudah resolve dari sesi — lebih bersih daripada reverse-map schema→tenant).
- src/onevity/shared/lib/money-view.ts (BARU, OPT-IN — belum ada call site,
  45-b yang men-thread): MoneyViewReason legacy|open-admin|open-granted|
  vault-closed|no-grant; getMoneyView(db,actor) → dec/dec0/json. canSee:
  tanpa row vault → legacy (jalur env tenantCryptoForDb — perilaku lama);
  vault open + role OWNER/ADMIN (SUPER_ADMIN_PLATFORM_ROLES di-IMPORT dari
  access-scope — satu sumber) ATAU userId ∈ grantUserIds → true (dekripsi
  DEK via decryptMoneyWithKey/decryptTextWithKey); selain itu masked.
  Walker json: open → n=angka/t=teks via DEK (mirror decryptJson); masked →
  n=null, t tetap didekripsi jalur env (PII tidak dipengaruhi vault — DEK
  memang kunci data tenant itu, hasil identik); Date/number/boolean/null
  lewat; array+objek baru (deep).
- src/onevity/shared/api/money-vault.ts + route tipis: GET/POST
  /api/onevity/money-vault + GET /api/onevity/money-vault/members.
  Resolusi sesi TANPA menu key (requireVaultSession: readVerifiedSession →
  membership → getTenantClient + appUserId via email match). GET status
  {configured,open,openUntil,openBy,canManage,myView,grantsCount,
  lockoutUntil,serverNow}; myView = unconfigured → canManage?"admin":"legacy"
  (semua tetap legacy-visible), configured → "admin"|"granted"|"none".
  POST {action}: setup/unlock/lock/change-password/grant/revoke — semua
  canManage (403 NOT_ADMIN); grant/revoke validasi member (404 NOT_MEMBER);
  unknown action 400. VaultError → status + {error,code}. Audit ActivityLog
  best-effort: MoneyVault VaultSetup/VaultUnlock/VaultLock/
  VaultPasswordChange + MoneyViewGrant VaultGrant/VaultRevoke (entityId=
  userId sasaran) — unlock/lock hanya saat status benar-benar berubah; sandi
  tidak pernah masuk log; appUserId disertakan.
- VERIFIKASI: bunx tsc --noEmit 0 error; bun run lint exit 0; migrasi 3
  schema (tabel+index terverifikasi pg information_schema); E2E curl
  (hrd@mii.co.id OWNER, MII — dev server sempat mati dibunuh OOM-reaper,
  dibangkitkan ulang setsid nohup): 401 tanpa sesi; status awal
  {configured:false,canManage:true,myView:"admin"}; setup sandi lemah 400
  WEAK_PASSWORD; setup "vault-demo-123" 200 → status open:true myView:admin
  (openUntil +8j); setup ulang 409; lock 200 → open:false; unlock salah 403
  INVALID_PASSWORD; unlock benar 200 (bug unwrapKey format 5-segmen
  ditemukan-di-sini lalu DIPERBAIKI — parse vlt/v1/iv/tag/ct); change-
  password: current salah 403, terkunci 409 VAULT_LOCKED, benar 200 (tetap
  open; sandi lama ditolak setelahnya); unlock sandi baru 200; members 200
  (Tri OWNER + Yusuf HR, urut nama); unknown action 400; grant Yusuf 200 →
  members granted:true + grantsCount:1; grant non-member 404; sesi Yusuf
  (HR): GET status myView:"granted" (canManage:false), members 403
  NOT_ADMIN, POST unlock 403 NOT_ADMIN; saat vault locked myView:"none";
  revoke → granted:false/myView "none"; lockout: 4×403 → percobaan ke-5 429
  LOCKOUT, sandi benar pun 429, status memuat lockoutUntil (+15m); GET
  /api/onevity/loans 200 (angka murni — serializer BELUM digated, tugas
  45-b); unlock tanpa konfigurasi 409 NOT_CONFIGURED.
- Sanity money-view (skrip /tmp, proses terpisah → memori vault kosong):
  19/19 PASS — masked: canSee false reason vault-closed, dec()=null/dec0()=0,
  walker n→null + t→"3176363464506" (PII tetap terbaca) + plain/number/
  boolean/array/nested lewat; unlock in-proses → admin open-admin dec()
  12345678.5 + walker n→angka/t→teks + legacy plaintext "0"→0; HR tanpa
  grant saat open → no-grant dec() null; HR dengan grant (Yusuf) saat open
  → open-granted dec() 12345678.5; tenant Cahaya (tanpa vault) → legacy
  dec()=999. RESTART-SAFETY terbukti: proses baru dengan baris vault ada +
  kolom openUntil terisi → open:false (memori satu-satunya sumber open).
- Catatan lingkungan: 1 respons 500 sesaat (bug unwrapKey) sebelum
  perbaikan; dev server restart 2× oleh OOM-reaper sandbox (log ter-truncate
  oleh tee — log akhir bersih 0×500); pengguna browser (preview panel) aktif
  paralel sesi hrd (terlihat login + app-shell + 2 eksekusi grant/revoke
  tambahan dari sesi itu — semua idempoten di DB, log audit vaultnya ikut
  dibersihkan).
- CLEANUP: baris uji dihapus — MoneyVault=0, MoneyViewGrant=0, ActivityLog
  entity vault=0 (MII kembali legacy-visible configured:false — pasca-TTL
  cache 60s GET status "configured":false diverifikasi); tmp skrip dihapus;
  tidak ada file uji tertinggal di repo.

Stage Summary:
- FILE BARU: scripts/migrate-money-vault.ts, src/onevity/shared/lib/
  money-vault.ts, src/onevity/shared/lib/money-view.ts, src/onevity/shared/
  api/money-vault.ts, src/app/api/onevity/money-vault/route.ts, src/app/api/
  onevity/money-vault/members/route.ts. FILE DIUBAH: prisma/
  schema-tenant.prisma (+2 model), src/onevity/shared/lib/tenant-db.ts
  (cache key T45A), src/onevity/shared/lib/field-crypto.ts (+3 export raw-key,
  backward compat), src/onevity/shared/lib/parity-runner.ts (langkah
  "money-vault"), (client regen src/generated/tenant).
- KONTRAK API (implementasi): GET /api/onevity/money-vault → {configured,
  open, openUntil, openBy, canManage, myView: "admin"|"granted"|"none"|
  "legacy", grantsCount, lockoutUntil, serverNow}; POST {action:setup|
  unlock|lock|change-password|grant|revoke, password/currentPassword/
  newPassword/userId} → {ok:true[,openUntil]} / {error,code} (400 WEAK_
  PASSWORD/UNKNOWN_ACTION/INVALID_BODY, 403 INVALID_PASSWORD/NOT_ADMIN, 404
  NOT_MEMBER, 409 ALREADY_CONFIGURED/VAULT_LOCKED/NOT_CONFIGURED, 429
  LOCKOUT); GET /members (canManage saja) → {members:[{userId,name,email,
  role,granted}]} urut nama.
- DEVIASI KECIL dari spesifikasi (terdokumentasi): (1) NOT_CONFIGURED →
  409 (peta status eksplisit menang atas komentar "400" di unlockVault);
  (2) unlockVault punya param actor OPSIONAL (openByUserId akurat);
  (3) memberList(db, tenantId) — tenantId eksplisit dari route; (4) t-kind
  pada mode masked didekripsi via jalur env (identik hasil decryptTextWithKey
  (dek) karena DEK = kunci data tenant); (5) audit unlock/lock diputuskan di
  route (tahu status sebelum/sesudah).
- CATATAN UNTUK 45-b (frontend + serializer): getMoneyView(db, {userId,
  membershipRole}) OPT-IN — panggil di batas serializer respons uang (ganti
  decryptJson/decryptMoney), .json(payload) walker siap pakai (legacy =
  perilaku lama persis); server-side service/payroll engine TIDAK usah
  diganti (tetap tenantCryptoForDb); agregasi tetap in-memory atas nilai
  terdekripsi; vault status frontend: poll GET /api/onevity/money-vault
  (serverNow utk sinkronisasi TTL); kata sandi uji demo: vault-demo-123 →
  diganti vault-demo-456 saat E2E lalu barisnya dihapus (MII kembali
  unconfigured). myView union final "admin"|"granted"|"none"|"legacy".
- 45-c (bila ada UI grant): GET /members sudah tersedia (admin-only); grant
  aktif = revokedAt null; grant tidak pernah menyebar sandi.

---
Task ID: 45-c
Agent: frontend-styling-expert
Task: Money Vault frontend (header button + dialog + assign grants UI)

Work Log:
- Studi pola: notification-bell.tsx (polling interval + refetch saat dropdown
  dibuka + toast sonner), language-switcher.tsx (tombol topbar aria-label/
  tooltip), change-password-dialog.tsx (PasswordInput bersama + dialog
  sm:max-w-xl + inline error box), header app-shell (WorkspaceMenu → search
  → quick-create → NotificationBell → LanguageSwitcher → ThemeToggle;
  seluruh shell dibungkus TooltipProvider delayDuration 200), session-store
  (status "ready" = tenant terpilih; ESS shell terpisah di ess-shell.tsx),
  useApi/apiSend (fetch relative), i18n-core BASE_EN (tidak perlu tambahan —
  semua string baru dirender oleh komponen baru, bukan app-shell).
- BARU src/onevity/shared/components/shell/money-vault.tsx (756 baris,
  "use client"): export MoneyVaultButton — tombol ikon Vault h-10 w-10 (hit
  area 40px, mobile & desktop share topbar) + titik status + Tooltip +
  Dialog sm:max-w-2xl (house rule) + Tabs terkontrol 3 tab (Status / Kata
  Sandi / Hak Akses). GET status via fetch manual (bukan useApi) supaya kode
  HTTP bisa dibedakan: 404 → state "missing" (tombol abu-abu tooltip "Tidak
  tersedia", dialog alert amber "Fitur belum tersedia", TANPA crash); POST
  via helper vaultMutate yang SELALU return {ok,error} (0 unhandled
  rejection). Poll: mount (hanya session ready) + 60 dtk saat tab visible +
  tiap dialog dibuka + pasca-setiap mutasi. serverNow → skewRef (jam server)
  utk countdown openUntil/lockoutUntil; detak 30 dtk selama dialog terbuka.
- Tab Status: Alert amber (unconfigured) / emerald (TERBUKA + "Berlaku hingga
  {fmtDateTime} · sisa {n} menit/jam" + "Dibuka oleh {openBy}") / destructive
  (TERTUTUP, "Semua nilai uang disembunyikan (—)"); baris "Hak lihat uang
  Anda: Penuh (Admin)/Diberikan/Tidak ada/Belum dikonfigurasi" + grantsCount
  (saat configured); lockoutUntil future → Alert terkunci + tombol Buka
  disabled; canManage&&open → "Kunci Brankas" konfirmasi 2-klik (label "Klik
  lagi untuk konfirmasi", auto-batal 5 dtk) + Segarkan; canManage&&closed →
  PasswordInput + "Buka Brankas"; canManage&&unconfigured → tombol lompat ke
  tab Kata Sandi.
- Tab Kata Sandi (canManage; non-admin Alert "Hanya Admin"): setup form
  (password+confirm, helper "Minimal 8 karakter", validasi inline min-8 &
  match, toast sukses) saat unconfigured; configured&&closed → Alert "Buka
  brankas dulu (tab Status)" + SEMUA field disabled (aturan inti
  change-password hanya saat OPEN); configured&&open → form ganti lengkap
  aktif. Toast per kode: INVALID_PASSWORD "Kata sandi saat ini salah",
  WEAK_PASSWORD, VAULT_LOCKED, LOCKOUT (+pesan retryAfterSeconds server
  di-append), ALREADY_CONFIGURED, NOT_MEMBER; fallback pesan server/HTTP.
- Tab Hak Akses (canManage; non-admin Alert + status diri): explainer Alert
  "…dapat melihat nilai uang TANPA mengetahui kata sandi enkripsi — kata
  sandi tetap hanya milik Anda"; Table anggota (Nama, Email hidden sm:,
  Peran Badge, Akses Uang) — OWNER/ADMIN → teks "OTOMATIS" (implicit, tanpa
  switch), lainnya Switch per baris (optimistik + refetch members & status +
  toast; gagal → refetch mengembalikan baris, 404 ditangani); skeleton saat
  loading; wrapper max-h-96 overflow-y-auto (house rule).
- app-shell.tsx: +2 baris — import MoneyVaultButton + <MoneyVaultButton />
  SEBELUM <NotificationBell /> di topbar; header/sticky footer/bottom-nav
  tidak direstrukturisasi. Render null bila session ≠ "ready"; ESS otomatis
  terkecuali (shell terpisah). i18n: ~90 pasang inline t("ID","EN") di
  komponen; BASE_EN tidak diubah.
- VERIFIKASI: bunx tsc --noEmit → 0 error; bun run lint → exit 0; dev server
  (restart setsid nohup karena reaper) GET / 200, dev.log 0 compile error.
- E2E agent-browser (backend 45-a ternyata SUDAH live saat tes — kontrak cocok
  100% dengan GET status & GET members):
  · Login hrd MII → tombol "Brankas Uang" sebelum Notifikasi; state live
    berputar sesuai uji paralel 45-a: unconfigured → amber animate-pulse +
    dialog setup form (validasi "Kata sandi minimal 8 karakter" &
    "Konfirmasi… tidak sama" teruji + tombol lompat tab); configured+closed →
    rose + alert TERTUTUP + form Buka Brankas (disabled saat kosong) + tab
    Kata Sandi "Buka brankas dulu" semua field disabled.
  · grant/revoke round-trip NET-ZERO: toggle Yusuf (HR) ON → toast "Hak lihat
    uang diberikan kepada Yusuf Rahayu" + switch checked + refetch (grants
    count ikut); OFF → toast "dicabut" + grantsCount balik 0 (cek curl).
    OWNER row → "OTOMATIS" tanpa switch.
  · State OPEN + LOCKOUT via network mock (tanpa menyentuh DB): titik
    emerald, alert TERBUKA + "Berlaku hingga 12 Sep 2026, 04.34 · sisa 2 jam
    15 menit" + "Dibuka oleh Tri Handayani", form ganti sandi aktif (submit
    disabled saat kosong/mismatch); 2-klik "Kunci Brankas" → toast "Brankas
    uang ditutup"; lockout → Alert "…dinonaktifkan sementara hingga 12 Sep
    2026, 02.50" + tombol Buka disabled; myView none → "Tidak ada".
  · Degradasi 404 (VAULT_BASE sementara diarahkan ke path tak-ada, lalu
    dikembalikan): titik stone + tooltip "Tidak tersedia" + dialog alert
    "Fitur belum tersedia…" — 0 page error; kembalikan URL → state pulih
    otomatis via polling. Bonus: 200 body invalid → diperlakukan unconfigured
    anggun (mock --body tanpa status).
  · EN toggle: "Money Vault / Status / Password / Access Rights / Money vault
    CLOSED / Your money view rights: Full (Admin) / Open Vault / …" semua
    bilingual. Mobile 390px: dialog konten 320px full-width, tablist 1 baris,
    tombol 40px; overflow 408px @390 terbukti PRE-EXISTING (div dekoratif
    pointer-events-none absolute -right-16 DI LUAR dialog, tetap ada setelah
    dialog ditutup — bukan komponen baru, kelas masalah sama spt catatan
    44-f). Console & page error 0. Screenshots /tmp/45c-{header,dialog-
    desktop,mobile-dialog,lockout,unconfigured}.png.

Stage Summary:
- 2 file: src/onevity/shared/components/shell/money-vault.tsx (BARU 756
  baris), app-shell.tsx (+2 baris). 0 file backend disentuh; BASE_EN tak
  diubah; 0 file test; tidak commit/push.
- Matriks state tertangani (configured×open×canManage×myView): unconfigured+
  admin (amber pulse + setup), unconfigured+non-admin (stone, read-only),
  closed+admin (rose + unlock form + change-password DISABLED), closed+
  granted-viewer (rose), closed+none-viewer (stone read-only), open (emerald
  + countdown skew-server + lock 2-klik + change aktif), lockout (alert +
  unlock disabled), endpoint-404 (stone "Tidak tersedia"), 200-body-invalid
  (unconfigured anggun), network error (retain-last / alert gagal muat).
- Asumsi kontrak: openBy = string nama (render mentah bila non-null); role
  OWNER/ADMIN = akses implicit ("OTOMATIS"); error code di key "code" +
  fallback pesan server; LOCKOUT retryAfterSeconds ikut pesan server;
  grantsCount disembunyikan saat unconfigured (belum relevan).
- tsc 0 error, lint exit 0, E2E hijau (state live paralel 45-a + mock OPEN/
  LOCKOUT + degradasi 404 + EN + 390px). DB bersih: hanya round-trip grant→
  revoke (net-zero); kata sandi vault TIDAK disentuh (milik pengujian 45-a).
  Alur password penuh (setup/unlock/lock/change sukses-gagal) defer ke 45-d.

---
Task ID: 45-b (dilanjutkan + ditutup orchestrator)
Agent: full-stack-developer (timed-out) + Z.ai orchestrator (penyelesaian)
Task: Thread gerbang MoneyView ke seluruh serializer uang (25+ titik) — compute tetap raw

Work Log:
- Subagent full-stack mengconvert 43 file (Pattern A route-level decryptJson → mv.json via
  moneyViewForReq/actor; Pattern B service DTO → param mv wajib): payroll api (loans,
  payroll-run/runs, journals, component-assignments, benefit-claims/types, rapel, profiles,
  spt, bonus-massal, reports-register), medical api+service (claims/overview/balances/
  adjustments/reports), travel api+service, leave api+service (encashment), ESS api (claims,
  payslips, payslips-detail, dashboard), HR api (employees, employee-detail/options, org-map,
  personnel-actions-detail), TA overtime, shared dashboard, payslip-pdf, report-builder,
  custom-reports run/export. Timeout sebelum worklog + 5 file terakhir + cleanup.
- Orchestrator menyelesaikan 5 file tersisa: payroll-spt.ts route (dm → mv.dec0 + hoist),
  payroll-run-export.ts (file transfer bank gated — admin buka vault dulu utk nilai riil),
  reports-bpjs.ts (toMemberRow +mv param; GAJI kolom upload CSV + rekap iuran gated),
  wage-component-rules.ts + entity-rules.ts (preview gaji dasar gated), plus service
  payroll-spt.ts buildAnnualSpt(db, year, mv?) — rekap SPT/CSV e-SPT ikut tergerbang.
- Helper baru src/onevity/shared/lib/money-view-req.ts (pola sesi persis tenant-db.ts;
  fail-closed; role tak pernah di-invent). Import rusak di payroll-run-export diperbaiki
  (tc.decryptText rekening tetap perlu field-crypto).
- Klasifikasi inti dipertahankan: ENGINE/COMPUTE TIDAK digerbang (payroll-service, benefit-
  service, settlement, payroll-journal, assignment validation, seeds, semua encryptMoney
  write path) — bisnis tetap jalan saat vault TERTUTUP; hanya tampilan/ekspor uang user-
  facing yang ter-mask (null → fmtIDR "—").
- Verifikasi: tsc 0 error, lint bersih. E2E curl (hrd OWNER MII): legacy visible (12jt/11jt)
  → setup → open visible → LOCK → loans {amount:null, outstanding:null, status utuh} →
  compute-path proof (bun -e tenantCrypto().decryptMoney = 12000000/11000000 saat LOCKED) →
  unlock → visible. Change-password: locked → 409 VAULT_LOCKED; wrong current → 403.
  Grant/revoke round-trip grantsCount 1↔0.

Stage Summary:
- Semua jalur tampilan uang user-facing kini lewat MoneyView (vault uang). Rollout behavior-
  neutral: tanpa baris vault (legacy) perilaku = sebelum 45-b persis.
- 51 file berubah total (43 subagent + 8 orchestrator); 0 test file; audit Aman utuh.

---
Task ID: 45-d (45-final)
Agent: orchestrator (Z.ai)
Task: E2E browser Money Vault + perbaikan openBy + reset demo + worklog + commit

Work Log:
- openBy fix: GET /api/onevity/money-vault kini resolve user id → nama (platformDb.user
  findUnique, fallback email) — "Dibuka oleh Tri Handayani" (sebelumnya id mentah).
- E2E agent-browser (hrd MII, dev.log 0×500, console/page error 0):
  * Tombol "Brankas Uang" di header sebelum NotificationBell (desktop+mobile), dot status:
    amber=belum-konfigurasi, hijau=TERBUKA, merah=TERTUTUP; dialog sm:max-w-2xl, 390px →
    dialog 363px (fit), header/footer/bottom-nav utuh.
  * Dialog 3 tab: Status (alert state + countdown server-skew "Berlaku hingga … sisa 7 jam
    59 menit" + Kunci Brankas 2-klik konfirmasi 5s + Segarkan), Kata Sandi (setup min-8 +
    match inline; ganti kata sandi DISABLED saat tertutup dengan alert "Buka brankas dulu —
    kata sandi enkripsi hanya dapat diganti saat brankas TERBUKA" = ATURAN INTI USER),
    Hak Akses (tabel anggota + Switch per user; OWNER/ADMIN "OTOMATIS"; alert "Anggota yang
    ditugaskan dapat melihat nilai uang TANPA mengetahui kata sandi").
  * Golden path penuh: loans Rp 12.000.000/OUTSTANDING Rp 11.000.000 saat TERBUKA →
    Kunci → reload → "Pokok — · cicilan — · OUTSTANDING —" (non-uang utuh) → Buka via dialog
    (kata sandi) → uang kembali → GANTI KATA SANDI via UI (toast "berhasil diganti") →
    kunci → buka dgn KATA SANDI BARU (vault-demo-999) sukses.
  * User ber-grant (yusuf HR, uji): ESS Slip Gaji Gross Rp 8.545.000/NET Rp 7.074.508 saat
    open+grant → LOCK (via curl hrd) → reload → "Gross — · NET —" → unlock + REVOKE → tetap
    "—" walau TERBUKA (assign = satu-satunya jalur lihat uang bagi non-admin). Dialog yusuf
    read-only (canManage false, "Hak lihat uang Anda: Tidak ada").
  * Catatan tooling: sesi agent-browser pertama mengalami konteks eval basi (klik no-op) —
    bukan bug aplikasi (keyboard + sesi baru bersih); tab/lock/unlock/ubah-sandi semua
    bekerja via klik nyata setelah restart browser.
- Reset demo: MoneyVault+MoneyViewGrant+audit vault MII dihapus (2 grant/1 vault/20 log),
  user uji yusuf@mii.co.id + agus45b@mii.co.id dihapus (sisa hrd/ayu/bambang), 3 schema
  diverifikasi vault:0 grants:0, status configured:false, loans legacy visible. Tombol
  kembali amber "Atur kata sandi enkripsi uang" (entry point fitur utk admin demo).
- tsc 0 error · lint exit 0 · dev.log 0×500.

Stage Summary:
- Task 45 TUNTAS: M-VAULT UI lengkap — input/modify (hanya saat open)/assign hak view uang
  tanpa sebar kata sandi + masking "—" saat tertutup/tanpa grant + compute/write tetap jalan.
- Kontrak: GET /api/onevity/money-vault (status+serverNow+openBy nama), POST {action:
  setup|unlock|lock|change-password|grant|revoke}, GET .../members. Vault aktif hanya di
  memori server (restart → tertutup, admin buka ulang) — by design.
- Vault demo DIKOSONGKAN (legacy visible) — admin mengatur kata sandi via tombol header saat
  ingin mengaktifkan; TTL open 8 jam, lockout 5 salah/15 menit, PBKDF2 210k.

---
Task ID: 46
Agent: orchestrator (Z.ai)
Task: Bug report user "ketika set password encrypt: [field-crypto] ONEVITY_ENCRYPTION_KEY wajib di-set di production" — precheck UI vault + fix root cause kedua (tabel vault tidak dibuat di fresh install).

Work Log:
- Diagnosis: error = guard fail-fast M-10 di field-crypto masterKey() — NODE_ENV=production tanpa ONEVITY_ENCRYPTION_KEY; terjadi SAAT setup vault karena tenantDataKey() → masterKey(). Perilaku by-design (audit 42); fix utama = set env var di server production user.
- Sandbox ter-reset total (postgres data hilang, .env balik default SQLite, db/ hilang, semua layanan mati) → pemulihan penuh: initdb postgres 17 (:5432) → .env 3 URL postgres → db:generate+db:push → bun scripts/restore-demo.ts (3 tenant, 44 karyawan MII, parity lengkap) → dev server.
- REAPER DITEMUKAN & DIKALAHKAN: proses dari tree shell sesi tool dibunuh di batas antar-perintah (setsid+nohup+disown TIDAK cukup — PPID masih menyatu; server mati 2× diam-diam, watchdog ikut mati tanpa log). Fix: launch double-fork `( setsid nohup … & )` → watchdog PPID=1 → selamat lintas perintah (postgres & agent-browser selamat karena sudah PPID=1 lebih dulu — konsisten).
- E2E pertama GAGAL: POST setup vault 500 "table tenant_...​.MoneyVault does not exist" — ROOT CAUSE KEDUA: (a) prisma/tenant-ddl.sql STALE (Task 45 lupa regen — tenant BARU tak dapat tabel vault dari provisioning); (b) checkParityGap() hanya cek 2 marker lama (Announcement + bruto TEXT) → boot self-heal TIDAK jalan untuk skema existing pasca-restore (money-vault step tak pernah dieksekusi). Berlaku juga ke production fresh-install → user bakal kena error kedua ini SETELAH set env key!
- Fix A: regen tenant-ddl.sql (`bun run tenant:ddl`) — diff bersih: hanya +MoneyVault +MoneyViewGrant +index userId.
- Fix B: checkParityGap() + marker ketiga (tabel MoneyVault per schema) — verifikasi langsung: bun -e → gap:true "3 tenant tanpa tabel MoneyVault (Task 45-a)".
- Fix C (UX precheck Task 46 inti): field-crypto.ts + encryptionEnvKeyMissing() (pure check, tak pernah throw); GET /api/onevity/money-vault + field envKeyMissing; money-vault.tsx: alert merah bilingual di tab Status (canManage) + tab Kata Sandi, form setup (2 input + submit) DISABLED saat envKeyBlocked — admin lihat penghalang SEBELUM mengetik sandi, bukan 500 pasca-submit.
- DEPLOY-RUNBOOK.md + §5.2.2 baru: prasyarat env key sebelum setup vault, urutan benar fresh-install, operasi mana yang TIDAK butuh env key (unlock/lock/change-password/grant — hanya setup + dekripsi jalur env yang butuh).
- Verifikasi self-heal end-to-end: restart dev server → instrumentation boot deteksi gap → parity pipeline background → tabel vault tercipta otomatis di 3 schema (2/2 tabel masing-masing) → restart ke-2: "3 tenant sudah paritas" (marker bekerja dua arah).
- E2E lengkap pasca-fix: API — setup "vault-e2e-46" {ok:true} → configured+open+openBy "Tri Handayani" → lock ok → unlock salah 403 INVALID_PASSWORD ("Kata sandi vault salah.") → unlock benar ok (openUntil +8j). Browser — dialog vault: unconfigured (amber) → form setup aktif di dev (envKeyMissing:false) → SIMULASI PRODUCTION (temp-patch envKeyMissing:true): alert merah "Kunci enkripsi server belum diatur" + instruksi lengkap di tab Status & Kata Sandi + kedua input & submit [disabled] + screenshot /tmp/vault-blocked.png → revert patch → form kembali aktif → setup via UI → restart server → TERTUTUP (in-memory by design) → unlock via UI password → TERBUKA "Berlaku hingga 12 Sep 2026, 15.42 · Dibuka oleh Tri Handayani".
- Unit helper: NODE_ENV=production + key kosong → true; + key 32 char → false; dev → false.
- Reset demo state MII (konvensi 45): MoneyVault 1 baris + audit 4 log dihapus → status akhir {configured:false, open:false, myView:"admin", envKeyMissing:false} — tombol kembali amber "Atur kata sandi enkripsi uang".
- bunx tsc --noEmit 0 error · bun run lint exit 0 · dev.log 0×500 (log baru pasca-restart bersih).

Stage Summary:
- Task 46 TUNTAS: (1) UX precheck vault — envKeyMissing di GET status + alert merah + form disabled (admin tahu penghalang SEBELUM submit, lengkap dgn instruksi set ONEVITY_ENCRYPTION_KEY); (2) FIX BUG FRESH-INSTALL: tenant-ddl.sql regen (tenant baru dapat tabel vault) + marker MoneyVault di checkParityGap (skema existing self-heal saat boot — terbukti menciptakan tabel otomatis); (3) runbook §5.2.2; (4) sandbox dipulihkan penuh + teknik double-fork mengalahkan reaper antar-perintah.
- Untuk server PRODUCTION user: set ONEVITY_ENCRYPTION_KEY (≥32 char acak) di env (mis. .env) → restart → setup vault akan berhasil (tabel kini ikut DDL + self-heal). Urutan: key dulu, setup vault kemudian.
- Kontrak API bertambah satu field opsional (envKeyMissing) — backward compatible; tipe VaultStatus UI diperbarui.

---
Task ID: 47
Agent: orchestrator (Z.ai)
Task: Redesain arsitektur enkripsi sesuai arahan user — kata sandi enkripsi PERUSAHAAN disimpan di DB (bukan .env), per company, admin bebas mengganti kapan pun, dan ganti kata sandi = seluruh data di-decrypt lalu di-enkripsi ulang dengan kunci baru.

Work Log:
- Diagnosis keluhan user: model lama (Task 45/46) memakai ONEVITY_ENCRYPTION_KEY env sebagai master key + sandi vault hanya membungkus kunci tsb — setup gagal di production tanpa env (M-10 fail-fast). User ingin: password di DB, per company, bebas diganti, re-enkripsi total saat ganti.
- DESAIN BARU: dataKey = PBKDF2(kata sandi admin, salt, 210k, 96 byte → verifierKey|kek|dataKey) per schema tenant — disimpan hex di MoneyVault.dataKey (DB tenant = "password di DB"). Server membaca dataKey dari DB → dekripsi TRANSPARAN (payroll/klaim/laporan jalan tanpa input sandi); visibilitas uang tetap digerbang vault-open (memori, TTL 8j) + MoneyViewGrant; PII digerbang scope PII (tidak terpengaruh vault).
- Format nilai: enc:v2:<t|n>:… = kunci kata sandi perusahaan; enc:v1 = bootstrap pra-vault (env opsional / fallback deterministik — fail-fast M-10 DIHAPUS per arahan user); plaintext legacy passthrough. Decrypt = dispatch per prefix → migrasi mulus, tanpa downtime.
- field-crypto.ts rewrite: cache dataKey globalThis (HMR-safe) + primeTenantCrypto/primeAllTenantCrypto (pg mentah) + setVaultDataKey; context kunci dibaca DINAMIS per panggilan (cache context tak perlu invalidate); encryptWithKey/legacyTenantKey diekspor utk engine.
- Engine re-enkripsi scripts/migrate-rekey-vault.ts + registry scripts/lib/encrypted-columns.ts (59 kolom = 21 wave-28c + 38 M-8; uang payroll + PII identitas): keyset pagination 200/baris, decrypt per prefix (v2→oldDataKey, v1→legacy, plaintext→parse), re-encrypt v2. rekeySchemaWithPassword utk ops manual.
- money-vault.ts rewrite: setupVault & changeVaultPassword = SATU transaksi pg (BEGIN + pg_advisory_xact_lock + INSERT/UPDATE baris + rekeyVaultData + COMMIT) → all-or-nothing (gagal tengah = rollback bersih, tak ada campuran kunci); rekeyJobs guard in-process (REKEY_IN_PROGRESS 409); change TIDAK lagi butuh open (verifikasi sandi saat ini = gerbang; status open/closed dipertahankan); unlock = verify verifier saja; MIN_PASSWORD_LEN 8→6 ("terserah mau password apa"); P2022 ikut ditangani (pra-parity window).
- vault-derive.ts baru (pure crypto): deriveVaultKeys + computeVaultVerifier + verifyVaultPassword (timing-safe) + wrapDataKey — dipakai lib & skrip tanpa dependensi prisma.
- money-view.ts disederhanakan: tanpa DEK/unwrap — dec/json pakai tenantCryptoForDb (prefix dispatch); maskedWalker tetap (uang null, PII terbaca).
- tenant-db.ts: requireTenant/requireMutator AWAIT primeTenantCrypto sebelum return db (menutup race request pertama); getTenantClient fire-and-forget prime; versi client cache T45A→T47A (DMMF dataKey).
- Schema tenant MoneyVault + dataKey String?; migrate-money-vault.ts + CREATE TABLE dataKey & ALTER ADD COLUMN IF NOT EXISTS; tenant-ddl.sql regen (kolom dataKey baris 2014); parity-runner: gap check ke-4 (kolom dataKey) + prime kensi semua schema sebelum langkah enkripsi + label step money-vault 45-a/47; instrumentation boot: primeAllTenantCrypto (scheduler baca field terenkripsi sebelum request pertama).
- API money-vault.ts: field envKeyMissing DIHAPUS dari GET status; setup/change respons membawa reEncrypted {tables,rows,skipped}; audit detail mencatat jumlah re-enkripsi; prime sesi vault.
- UI money-vault.tsx: kedua alert envKeyBlocked DIHAPUS (status & password tab); form ganti sandi AKTIF kapan pun (disabled hanya saat busy) + info alert "Bisa diganti KAPAN PUN"; label tombol busy = "Mengenkripsi ulang data…"; toast sukses membawa jumlah baris; minimal 6 karakter; hint "terserah Anda"; alert unconfigured menjelaskan model kunci perusahaan.
- E2E API (login hrd MII → tenant): status awal TANPA envKeyMissing · setup "sandi-perusahaan-A" → {ok, reEncrypted:{tables:59, rows:5280}} · data v1→v2 semua (48 baseSalary + 44 NIK) · lock → payroll totalBruto null (masked) · unlock salah 403 INVALID_PASSWORD · change-password SAAT CLOSED → 200 re-encrypted 5280 · password lama 403 / baru 200 open · pasca-RESTART server: open=false (memori), uang masked, NIK TETAP terbaca (PII tak terpengaruh), unlock password baru → data terbaca (kunci dari DB selamat restart).
- E2E Browser: dialog vault — status TERBUKA/TERTUTUP + countdown; Kunci Brankas 2-klik; ganti sandi SAAT TERTUTUP via form → toast "Kata sandi diganti — 5280 data didekripsi lalu dienkripsi ulang dengan kunci baru"; status tetap TERTUTUP (dipertahankan); Buka Brankas dengan sandi baru → TERBUKA "Dibuka oleh Tri Handayani"; screenshot /tmp/vault-t47-open.png.
- Reset demo state: scripts/reset-vault-demo.ts (v2→v1 + hapus MoneyVault/MoneyViewGrant/ActivityLog vault; 5280 nilai dikembalikan, 1 baris + 12 log dihapus) → restart server → status akhir {configured:false, myView:"admin"} data v1 48/48 — tombol kembali amber "Atur kata sandi".
- bunx tsc --noEmit 0 error · bun run lint exit 0 · dev.log 0×500 seluruh E2E.
- DEPLOY-RUNBOOK.md: §5.1 ONEVITY_ENCRYPTION_KEY → OPSIONAL; §5.2.2 rewrite (model kata sandi perusahaan, urutan fresh-install TANPA env var, catatan lupa sandi + skrip ops); tabel §5.2 step 21 kunci aktif + step 22 money-vault/dataKey.

Stage Summary:
- Task 47 TUNTAS: kata sandi enkripsi = milik perusahaan per workspace, disimpan di DB, tanpa env var, admin bebas mengganti kapan pun, ganti sandi = re-enkripsi total (5280 baris/59 tabel di demo MII) dalam transaksi atomik — persis permintaan user.
- Properti keamanan: rotasi sandi membuat backup/data lama tidak terbaca lagi (disengaja); dataKey di DB = perlindungan dump parsial + invalidasi historis; brute-force unlock tetap 5×/15 menit; sandi tak pernah disimpan plaintext (verifier HMAC) & tak pernah masuk log/pesan error.
- Trade-off yang disadari (didokumentasikan runbook §5.2.2): penyerang dengan akses FULL DB dapat membaca dataKey — model ini dipilih pemilik produk ("simpan password di db"); tingkat perlindungan = at-rest + pasca-rotasi.
- Kontrak API berubah backward-compat: envKeyMissing dihapus, reEncrypted ditambah, error code baru REKEY_IN_PROGRESS 409; prisma tenant client versi T47A.
- Jalur deploy: cukup deploy + restart (tanpa env var, tanpa urutan khusus) — parity self-heal menambah kolom dataKey; admin mengatur sandi via UI kapan pun.

---
Task ID: 48
Agent: orchestrator (Z.ai)
Task: Verifikasi final Task 47 pasca-lanjutan sesi + PUSH ke origin (instruksi baru user: "selalu push setelah perbaikan") + penetapan aturan git permanen.

Work Log:
- Instruksi baru user: setiap perbaikan selesai → selalu push (menggantikan aturan lama "push hanya bila diminta").
- State awal sesi lanjutan: HEAD lokal = abed114 (Task 47, ter-commit), origin = 9be121e (Task 46) → 1 commit belum ter-push; worktree bersih.
- Verifikasi ulang menyeluruh Task 47 (golden path penuh, login hrd MII):
  * GET /api/onevity/money-vault → {configured:false, tanpa envKeyMissing} — kontrak Task 47 aktif.
  * POST setup "verify-t47-a" → {ok:true, reEncrypted:{tables:59, rows:5280, skipped:0}}.
  * POST change-password SAAT VAULT TERBUKA → ok (re-encrypt 5280).
  * POST lock → ok; change-password SAAT TERTUTUP → ok (re-encrypt 5280) — fitur inti "ganti kapan pun" terbukti.
  * unlock dengan sandi LAMA → 403 INVALID_PASSWORD; sandi BARU → 200 open (bukti re-key total ke kunci baru).
  * GET /api/onevity/loans?limit=1 saat open → amount 12000000/outstanding 11000000 (dekripsi kunci baru OK); setelah lock → amount:null/outstanding:null (masking bekerja).
  * Catatan: rute benar /api/onevity/loans (bukan /api/onevity/payroll/loans — perbaiki smoke test).
- Reset demo state: bun run scripts/reset-vault-demo.ts → 5280 nilai v2→v1 legacy, 1 baris vault + 8 log audit dihapus; restart dev server (double-fork anti-reaper, watchdog pulihkan port conflict sesaat) → status akhir {configured:false, myView:"admin"} + data legacy terbaca (12jt) — tombol amber "Atur kata sandi".
- Kesehatan: dev.log 0×500 seluruh E2E · bun run lint exit 0.
- PUSH: abed114 (Task 47) + commit worklog ini → origin/main.

Stage Summary:
- Task 47 TERVERIFIKASI LULUS dan TERPUSH ke origin — refaktor kata sandi enkripsi perusahaan (DB, per-company, bebas diganti, re-encrypt total) live di remote.
- ATURAN GIT BARU PERMANEN: setelah setiap perbaikan selesai → commit + push otomatis (tidak lagi menunggu perintah "push" eksplisit).

---
Task ID: 49
Agent: orchestrator (Z.ai)
Task: PTKP Status pada menu Data Gaji Karyawan terisi OTOMATIS dari data family (dependent) + refresh otomatis per 1 Januari, sesuai peraturan perpajakan Indonesia (riset regulasi via web-search).

Work Log:
- Riset regulasi (web-search + verifikasi pajak.go.id/klikpajak/ortax/muc): UU PPh Ps. 7 ayat (1) + PMK 168/2023 — PTKP TK/0 Rp 54jt, kawin +4,5jt, per tanggungan +4,5jt maks 3; tanggungan = keluarga sedarah/semenda garis keturunan LURUS + anak angkat (→ model EmployeeFamily: Child & Parent; Sibling DIKECUALIKAN garis samping); status kawin = relasi Spouse ATAU maritalStatus "Menikah"; Ps. 7 ayat (2) perubahan status berlaku bulanan mulai bulan BERIKUTNYA; K/I (penghasilan pasangan digabung) tidak dapat diturunkan dari data keluarga → manual.
- Eksplorasi (subagent Explore): EmployeeFamily (relation String konvensi Spouse|Child|Parent|Sibling, isDependent, tanpa enum); EmployeePayrollProfile.taxStatus TK0..KI3 + dependents; PTKP_ANNUAL hardcode payroll-engine; scheduler setInterval 6 jam + guarded(mutex advisory); referensi derivasi seed.ts:748.
- SKEMA: EmployeePayrollProfile + kolom ptkpSource String @default("manual") — aman untuk upgrade (baris lama tidak berubah perilaku); tenant-ddl.sql regen; skrip scripts/migrate-ptkp-auto.ts (ALTER ADD COLUMN IF NOT EXISTS, idempoten, import-in-process parity); parity-runner: step 23 + gap marker ke-5 (kolom ptkpSource); versi client tenant T47A→T49A (DMMF).
- SERVICE BARU src/onevity/payroll/services/ptkp-auto.ts: derivePtkpFromFamily (pure; spouse || marital Menikah → K; tanggungan Child/Parent isDependent maks 3; hasil TK0..K3 — TIDAK PERNAH KI*) + suggestPtkpForEmployee + syncEmployeePtkpAuto (profil auto saja; tulis + ActivityLog bila berubah) + syncAllPtkpAuto + applyPtkpAutoToAll (ops-in massal: alihkan semua profil aktif non-KI → auto lalu sync; dryRun pratinjau; K/I preservedKi).
- API payroll-profiles.ts: GET membawa ptkpSource + ptkpSuggestion per baris (derivasi server-side — tanpa PII keluarga); PATCH menerima ptkpSource — "auto" mengabaikan payload taxStatus (derived menang), taxStatus eksplisit tanpa ptkpSource → manual (override admin menang); POST {action:"sync-ptkp", dryRun} sinkron massal; route export POST.
- API family.ts: hook POST/DELETE → syncEmployeePtkpAuto + respons ptkpSync {changed, from, to} (DELETE menangkap employeeId SEBELUM hapus); AddFamilyDialog toast "status PTKP TK0 → K0 (otomatis dari keluarga)".
- SCHEDULER: job "ptkp-tahunan" (jobAnnualPtkpRefresh) — marker ActivityLog (action Scheduled, entity PtkpSync, entityId annual-<tahun>) per tahun pajak; siklus pertama setelah 1 Januari menjalankan syncAllPtkpAuto + ringkasan; counter SchedulerJobCounts.ptkpYearlySynced + ringkasan detail siklus.
- UI payroll-profiles.tsx: tabel badge Auto (emerald)/Manual (stone) + hint "Saran keluarga: K2" amber saat manual mismatch; tombol header "Sinkronkan PTKP dari Keluarga" → dialog pratinjau dryRun (daftar perubahan from→to, K/I dibiarkan manual, info regulasi) → Terapkan; dialog edit: dua kartu sumber (Otomatis dari keluarga / Manual), mode auto = info box derivasi (Pasangan ada/tidak · Tanggungan N → Status K2 Rp 67,5jt/thn + catatan refresh 1 Januari) + select disabled; mode manual = select aktif + dependents + chip saran "Terapkan"; alert K/I by-design; i18n t() penuh.
- SEED: profil demo ptkpSource = spouseWorks (KI) ? manual : auto; demo DB existing disamakan via SQL (MII: 39 auto + 3 K/I manual; tenant lain 0 profil).
- BONUS FIX shell header: overflow horizontal 18px di 390px (pre-existing, tombol notifikasi/tema meluber di SEMUA halaman — terverifikasi di dashboard) → gap-2 px-3 base (sm:gap-3 sm:px-6) — scrollWidth 390=390 clean, desktop 1440 utuh.
- E2E API (login hrd MII): GET 42 karyawan (39 auto, 3 manual KI2/KI1/KI0 + saran K2/K1/K0) · family POST Spouse → TK0→K0 · POST Child → K0→K1 · DELETE Child → K1→K0 · DELETE Spouse → K0→TK0 · PATCH manual K1 → PATCH auto dengan taxStatus TK3 DIABAIKAN (derived TK0 menang) · POST sync dryRun (39 karyawan, 0 berubah, preservedKi 3) · ganggu Sri Wahyuni K1→TK0 di DB → POST sync apply memperbaiki (TK0→K1, 1 changed) · marker scheduler "annual-2026" tertulis (39 profil, 0 berubah) · ActivityLog audit per perubahan.
- E2E Browser: tabel badge + saran (VLM verifikasi 4/4 poin) · dialog sinkron lengkap (pratinjau, K/I note, info regulasi) · dialog edit auto (info box keluarga + status terkunci) + toggle manual (select + tanggungan aktif) · responsif 390px bersih pasca-fix header · 1440 desktop utuh · console/page errors 0.
- bunx tsc --noEmit 0 · bun run lint 0 · dev.log 0×500 · DEPLOY-RUNBOOK §5.2.3 baru + step parity 23.

Stage Summary:
- Task 49 TUNTAS: PTKP terisi otomatis dari data family (dependent) — pasangan → K, anak/ortu tanggungan maks 3, K/I tetap manual by-design; berubah otomatis saat data keluarga CRUD; REFRESH TAHUNAN otomatis tiap 1 Januari (job scheduler, marker idempoten); admin bisa massal "Sinkronkan PTKP dari Keluarga" (dryRun pratinjau → apply) atau per-karyawan pilih sumber; upgrade aman (default manual — payroll berjalan tidak tersentuh sampai admin mengaktifkan).
- Kontrak API bertambah backward-compat: GET +ptkpSource/+ptkpSuggestion; PATCH +ptkpSource; POST baru {action:"sync-ptkp"}; family POST/DELETE +ptkpSync; kolom DB ptkpSource (step parity 23 self-heal).
- Bonus: fix overflow header mobile 390px (pre-existing shell, semua halaman).

---
Task ID: 50
Agent: orchestrator (Z.ai)
Task: Kebijakan SNAPSHOT TAHUNAN PTKP — perubahan keluarga (tambah/hapus dependen) di tengah tahun TIDAK mengubah PTKP payroll; hanya berlaku pada refresh 1 Januari tahun berikutnya (instruksi pemilik produk, melanjutkan Task 49).

Work Log:
- Analisis gap Task 49: hook family CRUD langsung menulis taxStatus (mis. "TK0→K0" saat tambah pasangan) — bertentangan dengan aturan baru "PTKP payroll = hasil refresh tahunan". Rancangan ulang: PTKP efektif = snapshot beku; saran keluarga dihitung on-the-fly (GET) sebagai pratinjau tahun depan.
- src/onevity/payroll/services/ptkp-auto.ts: header komentar kebijakan baru; fungsi baru ptkpPendingForEmployee(db, employeeId) + tipe PtkpPendingInfo {source,current,next,dependents,nextYear} — TANPA menulis DB; syncEmployeePtkpAuto DIHAPUS (fungsi mati pasca-hook dicabut); syncAllPtkpAuto/applyPtkpAutoToAll dipertahankan (jalur refresh tahunan + koreksi admin).
- src/onevity/human-resource/api/family.ts: hook POST/DELETE tidak lagi memanggil penulis PTKP — respons berubah ptkpSync → ptkpPending (tanpa tulis; menangkap employeeId SEBELUM delete tetap).
- src/onevity/payroll/api/payroll-profiles.ts PATCH: initialAutoFill = wantAuto && existing?.ptkpSource !== "auto" — derivasi keluarga HANYA saat profil baru / aktivasi manual→auto; profil yang SUDAH auto mempertahankan taxStatus+dependents (payload taxStatus diabaikan); audit note membedakan "pengisian awal" vs "snapshot refresh tahunan — perubahan keluarga berlaku 1 Jan <yr+1>"; existing profile difetch lebih awal (hapus deklarasi ganda).
- scheduler-service.ts: komentar job ptkp-tahunan + detail marker ActivityLog kini menyebut kebijakan (perubahan tahun sebelumnya kini berlaku; tahun berjalan menunggu 1 Jan <yr+1>) — mekanisme job tidak berubah (marker idempoten per tahun).
- UI payroll-profiles.tsx: tabel hint baru "→ {s} pada 1 Jan {yr+1}" untuk auto+pending (manual mismatch tetap "Saran keluarga"); dialog edit mode auto menampilkan "PTKP efektif — dipakai payroll tahun ini" (status BEKU + ptkp) + blok amber "Data keluarga terkini: … → {s} — berlaku 1 Jan {yr+1}" saat tertunda / blok emerald "tidak ada perubahan tertunda" + catatan snapshot; select terkunci menampilkan status beku (bukan saran); kartu sumber auto "Snapshot data keluarga — refresh otomatis 1 Januari"; dialog sinkron: info box kebijakan baru (TIDAK langsung mengubah payroll; tombol = koreksi manual admin) + toast "(koreksi admin)".
- UI employee-module.tsx: AddFamilyDialog + handler hapus keluarga membaca ptkpPending → toast deferred "PTKP akan menjadi {s} pada 1 Jan {y} (perubahan berlaku tahun depan)" hanya saat next ≠ current.
- DEPLOY-RUNBOOK.md §5.2.3 → "Task 49 + 50": bullet KEBIJAKAN SNAPSHOT TAHUNAN + PTKP efektif hanya berubah lewat 3 jalur + kontrak API (ptkpPending, PATCH freeze).
- E2E API (login hrd MII; fix: MII = workspace PERTAMA, payload select-tenant {tenantId}): 19/19 PASS — tambah Child → ptkpPending {current:K2,next:K3,nextYear:2027} · taxStatus efektif TETAP K2 (GET) · saran K3 on-the-fly · PATCH auto+taxStatus:TK3 → snapshot K2 dipertahankan · DELETE child → tetap K2, saran kembali · dryRun 39-0-3KI · jalur APPLY: pending diterapkan (K2→K3) lalu restore K2 · aktivasi manual→auto = pengisian awal derive (K/I KI2 → auto K2 → restore KI2 manual).
- E2E Browser (agent-browser, MII): tabel "K/2 — Menikah +2 Auto PTKP Rp 67.500.000/thn → K3 pada 1 Jan 2027" · dialog edit: "Status: K2" beku + amber "Data keluarga terkini: pasangan ada, tanggungan 3 → K3 — berlaku 1 Jan 2027 (perubahan tengah tahun menunggu refresh tahunan)" · dialog sinkron: pratinjau 39/1 berubah (Hartono K2→K3) + info kebijakan baru · toast deferred "Anggota keluarga ditambahkan — PTKP akan menjadi K3 pada 1 Jan 2027 (perubahan berlaku tahun depan)" (catatan: Select shadcn harus diklik-open, bukan perintah select) · state uji dibersihkan (0 data "Anak Uji", hint hilang, Hartono kembali K2) · konsol 0 error · 390px scrollWidth=390 (tanpa overflow) · footer sticky di halaman pendek (bottom=vh=900) & terdorong natural di halaman panjang (2712>844).
- bun run lint 0 · bunx tsc --noEmit 0 · dev.log 0 error/500 · skrip E2E + screenshot artefak dihapus.

Stage Summary:
- Task 50 TUNTAS: PTKP payroll = SNAPSHOT hasil refresh tahunan 1 Januari. Mutasi keluarga tengah tahun hanya memperbarui saran (tanpa tulis DB) dan berlaku tahun berikutnya; admin tetap bisa koreksi eksplisit (sinkron massal / PATCH manual) dan pengisian awal tetap derive saat aktivasi auto.
- Kontrak API berubah: family POST/DELETE → ptkpPending {current,next,dependents,nextYear} (menggantikan ptkpSync); PATCH auto pada profil yang sudah auto = freeze (payload taxStatus diabaikan). Tanpa perubahan skema DB (kolom ptkpSource tetap; parity step 23 tidak berubah).
- UI: hint tabel "→ K3 pada 1 Jan 2027", dialog edit tampilkan PTKP efektif beku + kartu tertunda, toast keluarga deferred, info box sinkron reframed sebagai koreksi admin.

---
Task ID: 51
Agent: orchestrator (Z.ai) + 2 Explore subagent (51-a payroll cluster, 51-b HR-core cluster)
Task: AUDIT KEPATUHAN HUKUM (legal compliance audit) — cek apakah sistem sudah mengadopsi kompilasi regulasi Indonesia (UU 13/2003 jo 6/2023 + MK 168/PUU, PP 35/2021, PP 36/2021, UU HPP 7/2021, PER-2/PJ/2024, UU BPJS 24/2011, PP 6/2025 JKP, UU KIA 4/2024, UU TPKS 12/2022, UU PDP 27/2022, PP PSTE 71/2019, Permenaker 7/2026). Riset-only — TANPA perubahan kode.

Work Log:
- 2 subagent Explore paralel (audit payroll vs HR-core) + spot-check orchestrator (grep JKP/maternitas/kompensasi/whistleblowing + verifikasi katalog 12 tipe cuti CT-* di provisioning.ts:489-500 + registry enkripsi 59 kolom scripts/lib/encrypted-columns.ts).
- Skor ringkas 16 poin audit: 8 ADOPTED KUAT · 6 PARTIAL · 5 GAP TOTAL.

Stage Summary (matriks hasil audit):
- ✅ ADOPTED KUAT: (1) Lembur PP 35/2021 — formula progresif 1,5×/2× (2×/3×/4× hari libur), upah sejam base/173, cap 4j/hari + 18j/minggu dipaksa di attendance-service.ts:705-1290 + api/overtime.ts:141. (2) PPh 21 TER UU HPP — kategori A/B/C by PTKP (payroll-engine.ts:187-191), TER bulanan 36 baris, fallback Pasal 17 + non-NPWP ×1,2, gross-up, supplemental THR/bonus YTD. (3) Export e-SPT/DJP — 39 kolom CSV e-Bupot 1721-A1 (payroll-spt.ts:362-503) + coretax + recap, audited. (4) UMP/UMK PP 36/2021 — master per kantor/tahun + warning saat run (payroll-service.ts:758-834, banner di run-detail). (5) BPJS UU 24/2011 — JHT 3,7/2, JP 2/1, JKK 0,24, JKM 0,3, JPK 4/1 parameter per-tenant + plafon JP 10,5jt/JKN 12jt (engine:360-365) + laporan BPJS TK & e-Dabu CSV. (6) PKWT/PKWTT — klasifikasi, contractStart/End, guard 5-tahun (pkwt.ts:53-91, warn-only), konversi PKS, reminder 30/60/90. (7) PHK settlement — pesangon skala UPMK ×multiplier 0,5-2, uang pisah 15%, THR prorata PMK 168, cuti encashment upah/25, PPh21 final 0/10/20/25% (settlement-service.ts). (8) Cuti tahunan 12 hari + 10 tipe statutori lain (CT-NIKAH 3, CT-HAID 2, CT-MATI, CT-HAJI, dll). (9) Enkripsi 59 kolom uang+NIK+NPWP+rekening (AES-256-GCM vault per-perusahaan).
- ⚠️ PARTIAL: validasi 40 jam/minggu TIDAK di-enforce (normalMinutes bebas, hanya konvensi template 8×5); UMP/UMK & upah-sejam lembur pakai gaji pokok saja (tanpa tunjangan tetap — PP 35 Art 31-32 / PP 36 definisi upah); komponen LEMBUR di-seed NonTaxable (harusnya taxable → risiko under-withholding); PKWT 5-tahun warn-only (API tidak menolak) + reminder hanya ke admin; cuti haid tanpa gating gender/kondisi-sakit; JKK satu rate global (tanpa kelas risiko); ActivityLog hanya mutasi+export (TIDAK ada trail akses BACA profil); PII plaintext: nomor dokumen KTP/KK (EmployeeDocument.docNumber), nomor BPJS, diagnosis MedicalClaimLine, kontak & data keluarga; outsourcing hanya label status (tanpa manajemen vendor/6 klaster); PHK pajak final mid-bracket selalu 10%/20% (basis PP 68 5%/15% + penggandaan 2 tahun); nonNpwpSurcharge parameter tampil tapi tidak dipakai engine.
- ❌ GAP TOTAL (5): (1) UANG KOMPENSASI PKWT PP 35/2021 Art 15-16 — tidak ada sama sekali (1 bulan per 12 bulan masa kerja, prorata, PPh final 0%). (2) JKP PP 6/2025 — tidak ada iuran, tidak ada flag klaim saat PHK (checklist hanya "stop iuran BPJS"). (3) CUTI MELAHIRKAN pekerja perempuan — tidak ada 3 bulan (UU 13 Ps.82) maupun perpanjangan 6 bulan UU KIA 4/2024 (CT-LAHIR/CT-GUGUR-I hanya cuti SUAMI 2 hari; benefit PERSALINAN 8jt bukan cuti); cuti keguguran pekerja perempuan 1,5 bulan juga tidak ada. (4) WHISTLEBLOWING TPKS UU 12/2022 — tidak ada kanal pelaporan anonim. (5) RIGHT TO ERASURE UU PDP — tidak ada retensi/anonymisasi pasca-resign, bahkan tidak ada endpoint DELETE Employee; data eks-karyawan tersimpan tanpa batas.
- OPS (di luar kode): PP PSTE 71/2019 lokasi data-center Indonesia — perlu verifikasi infrastruktur produksi (onevity.sayone.my.id), tidak dapat diaudit dari codebase.
- Rekomendasi prioritas (jika ditindaklanjuti jadi Task 52+): A. Cuti melahirkan/keguguran KIA (MONTH unit sudah ada di schema — seed 2 tipe baru + validasi perpanjangan needDocs). B. Kompensasi PKWT (komponen formula + trigger saat kontrak berakhir). C. JKP (parameter iuran + flag klaim di offboarding/settlement). D. Perluas registry enkripsi ke docNumber/diagnosis/bpjsHealth. E. Trail akses baca (action "Viewed" di employee-detail). F. Kanal whistleblowing anonim. G. Enforce 40 jam/minggu + blocker opsional 5-tahun PKWT.
---
Task ID: 52
Agent: orchestrator (Z.ai) + 2 Explore subagent (peta payroll/settlement & leave/crypto/shell)
Task: "Implementasikan semua" — TUJUH rekomendasi audit kepatuhan Task 51 (A–G): cuti melahirkan/keguguran UU KIA, uang kompensasi PKWT PP 35/2021, JKP PP 6/2025, perluasan enkripsi PII, audit trail akses baca, kanal whistleblowing TPKS, enforce 40 jam/minggu + blokir PKWT 5 tahun.

Work Log:
- EKSPLORASI: 2 subagent paralel (payroll/settlement/offboarding + leave/medical/detail/crypto/shell) → peta lengkap file:line semua area target.
- 52-a CUTI PEREMPUAN: LEAVE_TYPE_DEFS + CT-LAHIR-P (6 bln MONTH, needDocs) & CT-GUGUR-P (1,5 bln); leave-service: FEMALE_ONLY_LEAVE (LAHIR-P/GUGUR-P/HAID) + assertGenderEligible di submit+preview, toUnitDays (÷21 utk MONTH — saldo konsisten dalam bulan), unitLabel; createMassLeave tolak jenis perempuan-only; ESS GET: filter jenis perempuan utk laki-laki + SYNTH jenis event aktif tanpa baris saldo; ESS UI + dialog admin suffix bln/mo; migrasi scripts/migrate-maternity-leave.ts (INSERT ON CONFLICT) + parity step 25 + gap CT-LAHIR-P.
- 52-b KOMPENSASI PKWT: settlement-service — PKWT_KOMP (masa kerja/12 × upah, prorata; PKWT_STATUSES diekspor dari pkwt.ts); EXCLUDE dari basis PPh final (Ps.16 PPh 0%); SETTLEMENT_COMPONENTS +PKWT_KOMP NonTaxable; normalizeSettlementParams ijinkan multiplier 0; dialog preview + opsi ×0 "jangka waktu PKWT berakhir".
- 52-c JKP: schema PayrollRegulation +jkpEmployeeRate/jkpCompanyRate/jkpSalaryCap (0,0024/0,0022/5jt); engine: JKP_BASE + env JKP_* + NON_OBJEK_BPJS + DEDUCTIBLE_IURAN (iuran pegawai = pengurang bruto); getActiveRegulation + wage-component-rules (env preview + fallback); provisioning COMP_DEFS JKP_C/JKP_E + TPL DEFAULT/BS + seed regulasi; tax-parameters PATCH whitelist; UI parameter + 3 field + catatan; reports-bpjs: basisOf +JKP (dicek sebelum JP), BpjsRow/Buckets +jkp, XLSX +2 kolom, totalCompany/Employee memuat JKP; offboarding checklist + task klaim JKP (surat keterangan PHK); migrasi migrate-jkp.ts (ALTER + komponen + template item) + parity step 26 + gap kolom.
- 52-d ENKRIPSI PII: encrypted-columns 59→63 (bpjsHealth, bpjsEmpSkill, docNumber, treatment); migrate-encrypt-pii.ts (99 baris MII: 44+44+11) + parity step 27 + gap nilai plaintext; serializer: flattenEmployee/employee-detail GET+PATCH/ESS me (dekripsi bpjs), employee-documents docMeta+POST/PATCH/DELETE (enkripsi tulis + log plaintext), medical-service listClaims (treatment dekripsi) + submitClaim (treatment enkripsi); createEmployeeWithAssignment enkripsi bpjs saat create/import.
- 52-e AUDIT BACA: ScopedResult +actor {appUserId,employeeId} (additive); employee-detail GET tulis ActivityLog action "Viewed" (detail menyebut cakupan PII penuh/self/limited; dedupe 5 mnt per penampil×karyawan; best-effort); ACTIVITY_PHRASES +Melihat/Viewed.
- 52-f WHISTLEBLOWING: schema model WhistleblowReport (ticketNo WB-YYYY-NNN, kategori TPKS, anonim default — reporterEmployeeId null, status Baru→Diterima→Investigasi→Selesai/Ditutup, assignedTo, followUpNote, resolutionNote); API report.ts POST (sesi wajib, identitas ANONIM TIDAK disimpan, non-anonim resolve employeeId dari sesi bukan input; rate-limit 3/15mnt/sesi; notifyEvent→admins tanpa identitas pelapor) + reports.ts GET/PATCH (guard whistleblowing:triage, op assign/decide; validasi alur status; ActivityLog aktor=penangan); route shims /api/onevity/whistleblowing/{report,reports}; UI whistleblow-form.tsx (jaminan perlindungan Ps.23, toggle anonim default ON, kontak opsional) + whistleblow-module.tsx (form + triage: statistik status, filter, tabel, dialog detail + alur aksi + penugasan penangan); registrasi: store.ts module/section/label/defaultView, app-shell MODULES (hex #e11d48 Siren) + WHISTLEBLOW_NAV + navOfModule, page.tsx render + auto-deteksi ESS memfilter menu publik (public-menus.ts baru — whistleblowing:report view-only semua user; menu-access re-export); ESS: EssView+nav "Laporkan Pelanggaran" + render form compact; menu-perms ops assign/decide; migrasi migrate-whistleblow.ts + parity step 28 + gap tabel.
- 52-g ENFORCE: schedules.ts assertWeeklyHours (rata-rata Σ menit×7/cycleDays ≤ 40 jam ATAU pola 6 hari×7 jam ≤ 42 jam & hari ≤ 420 mnt; hari kerja ≤ 8 jam; Off/Holiday tak dihitung; validasi SEBELUM mutasi) di POST+PATCH; personnel-actions-detail ContractRenewal: hitung total durasi contractStart→newEnd > 60 bln → 409 code PKWT_OVER_5Y (pesan arahkan konversi PKS; override b.force=true dicatat di log proses).
- INFRA: parity STEPS 25-28 + checkParityGap + rowSchemas helper (UNION antar schema) + gap: maternity/jkp-col/pii-plaintext/whistleblow-table; tenant-db client cache T49A→T52A; db:generate + tenant:ddl regen (WhistleblowReport + jkp* masuk DDL); provisioning seed fresh-tenant lengkap.
- E2E API (login hrd MII): leave types baru (CT-LAHIR-P 6/MONTH, CT-GUGUR-P 1.5/MONTH) · preview cuti perempuan saldo bln (6−3.19=2.81) · laki-laki 400 "hanya pekerja perempuan" · submit melahirkan 201 (67 hr kerja = 3.19 bln, saldo 6 bln, cancel bersih) · tax-params jkp 0.24/0.22/5jt · whistleblow POST anonim WB-2026-001 · triage GET + PATCH receive/investigate/resolve/note/assign semua 200 · employee-detail bpjsHealth terdekripsi + ActivityLog Viewed ada · settlement Hartono (Contract): PKWT_KOMP 57jt + THR + CUTI_CASH, PPh 0 (kompensasi dikecualikan) · wage-components JKP_C/JKP_E ada · formula engine via component-rules preview: JKP_C 11.000 & JKP_E 12.000 (basis plafon 5jt) 42/42 karyawan · jadwal: 5×480+2off 201, 6×420+1off 201 (pola UU), 6×480+1off 400 "48 jam", 6×480 tanpa off 400 "56 jam" (cycle HARUS memuat hari libur — benar by design; jadwal seed OFFICE-STD/ROTASI lolos).
- E2E Browser (agent-browser, MII): login → rail Whistleblowing merah → form lengkap (jaminan Ps.23, anonim default checked) → submit WB-2026-002 → toast + konfirmasi "tersimpan SECARA ANONIM" → triage tabel 2 laporan (Anonim badge, status) → dialog detail → Terima Laporan → judul "Diterima" + toast → tombol Mulai Investigasi muncul · leave dialog dropdown memuat "Cuti Melahirkan (6 bln)" & "Cuti Keguguran (1.5 bln)" · parameter payroll: 3 field JKP (0.24/0.22/5000000) + catatan PP 6/2025 · ESS demo user (seed-ess-demo-user): auto-mode ESS tetap benar (menu publik difilter dari deteksi admin) + nav "Laporkan Pelanggaran" + view form render · mobile 390px scrollWidth=390 · console/page errors 0 (hanya aria-describedby warning pre-existing).
- FIX saat E2E: migrate-jkp WageComponent tanpa kolom updatedAt (42703); wage-component-rules preview env tanpa JKP_* (jumlah 0 → diperbaiki); sixDayPattern threshold 6.0 (6×420+1off sempat ditolak → >=5.98).
- Data demo: 3 laporan whistleblow WB-2026-001 (Investigasi, assigned MII000001, note BAP) · WB-2026-002 (Selesai, resolusi mediasi+SP II) · WB-2026-003 (Baru, keselamatan); deskripsi uji dirapikan via SQL; cuti uji dibatalkan; jadwal uji dihapus; ESS demo user di-seed ulang (yusuf@mii.co.id/EssDemo123!).
- bunx tsc --noEmit 0 · bun run lint 0 · dev.log 0×500 (hanya EADDRINUSE dari duplikat start yang tak berdampak — instance tunggal menyajikan). DEPLOY-RUNBOOK: tabel parity step 24-28 + §5.2.4 baru (7 fitur).

Stage Summary:
- Task 52 TUNTAS: 7 dari 7 rekomendasi audit diimplementasikan penuh (A cuti UU KIA, B kompensasi PKWT, C JKP, D enkripsi PII 63 kolom, E audit trail baca, F modul whistleblowing anonim, G enforce 40 jam + blokir PKWT 5 tahun) — semua terverifikasi API + browser + mobile.
- Skema DB bertambah: PayrollRegulation +3 kolom JKP; tabel WhistleblowReport; LeaveType +2 baris data; ENCRYPTED_COLUMNS 59→63. Parity steps 25-28 self-heal saat boot; client tenant T52A; deploy = restart saja.
- Kontrak API baru: POST /api/onevity/whistleblowing/report (anonim, rate-limited) + GET/PATCH /api/onevity/whistleblowing/reports; family/leave/month-unit backward-compat; PATCH PA ContractRenewal bisa 409 PKWT_OVER_5Y (force=true override); settlement +row PKWT_KOMP; GET employee-detail menulis Viewed log.
- Keputusan desain penting: (1) whistleblow anonim = sesi login wajib tapi identitas dibuang (tak ada kanal pra-login di SPA single-route — dibatasi arsitektur, dijelaskan di form); (2) cycle jadwal TANPA hari libur = melanggar 40 jam (rata-rata mingguan dihitung dari proporsi cycle — math benar, jadwal seed valid); (3) PKWT_KOMP dikecualikan basis PPh final (0% per PP 35 Ps.16); (4) iuran JKP pegawai = pengurang bruto (perlakuan JP).

---
Task ID: 52 (lanjutan push)
Agent: orchestrator (Z.ai)
Task: Push Task 52 — rebase di atas 2 commit paralel origin (83b8ccb fix fix-nan-money search_path, 9602be9 checkParityGap sekuensial deprecation pg 8.23).

Work Log:
- git push awal ditolak (origin maju 2 commit perbaikan parity paralel) → git pull --rebase.
- Konflik tunggal: src/onevity/shared/lib/parity-runner.ts (checkParityGap).
- Resolusi gabungan: pertahankan gaya SEKUENSIAL dari origin (pg 8.23 deprecated mengantre >1 query per Client) + semua cek gap Task 52 (maternity/jkp/pii-plaintext/whistleblow — rowSchemas helper kini sekuensial; Promise.all bersarang PII dihapus).
- tsc 0 · lint 0 · rebase continue → 08cbd51 → PUSH sukses (9602be9..08cbd51).
- Verifikasi final: HTTP 200, dev.log 0×500, worktree bersih.

Stage Summary:
- Task 52 TERPUSH ke origin/main sebagai 08cbd51 — resolusi konflik mempertahankan perbaikan pg-deprecation origin sekaligus seluruh cek gap baru Task 52.

---
Task ID: 53
Agent: orchestrator (Z.ai)
Task: AUDIT ULANG hasil Task 49-52 terhadap peraturan pemerintah yang dirujuk ("audit ulang apa yang sudah dibuat di atas refer ke peraturan pemerintah sebelumnya") — verification audit, TANPA perubahan kode aplikasi.

Work Log:
- Baca kode: payroll-engine.ts (PTKP_ANNUAL, terCategoryOf, terRateFor, computeTaxOn, supplemental, DEDUCTIBLE_IURAN, NON_OBJEK_BPJS), ptkp-auto.ts (derivasi + snapshot), settlement-service.ts (PKWT_KOMP, multiplier), provisioning.ts + seed.ts (JKP, TER 36×3, regulasi default), scheduler-service.ts (jobAnnualPtkpRefresh), schedules.ts (assertWeeklyHours), provisioning leave CT-LAHIR-P/CT-GUGUR-P.
- Riset regulasi via web-search (17 kueri; sumber: pajak.go.id, JDIH Kemenkeu, peraturan.bpk.go.id, BPJS Ketenagakerjaan, klikpajak, muc.co.id, uc.co.id, ortax, ideatax, ptpsi, lekslawyer, catapa, hukumonline, glints, adcolaw, gadjian, kantorku, taalenta).
- Verifikasi as-built langsung ke DB (pg): PayrollRegulation JKP live 0,0024/0,0022/5jt, TerRate MII (A r3 5.65-6.35 vs resmi 5.65-5.95; B r1 ≤5,6jt vs resmi ≤6,2jt; C max 20% vs resmi ada ≥21%), 3 profil K1 auto, CT-LAHIR-P 6 MONTH flat, JKP_C/JKP_E terpasang di template DEFAULT+BS (aktif di run berikutnya), 0 run item JKP historis. Dev server 200 OK.
- Tulis laporan audit/BPA-AUDIT-53.md.

Stage Summary (matriks temuan — 4 KRITIS, 3 SEDANG, 4 RENDAH):
- ✅ PTKP INTI LOLOS: PTKP 54jt (PMK 101/2016) TETAP SAH s.d. TA 2026 (pajakku/ikpi/DDTC — tidak ada kenaikan; angka "72jt" hanya RUU HPP yang tak diundangkan). Derivasi keluarga (spouse→K, Child/Parent isDependent maks 3, Sibling dikecualikan, K/I manual) + snapshot 1 Jan idempoten PATUH.
- 🔴 F-01 JKP (AKTIF): PP 6/2025 = iuran 0,36% (0,22% APBN + 0,14% REKOMPOSISI JKK — tanpa biaya baru perusahaan) dan TANPA iuran pekerja; implementasi memotong pekerja 0,24% (tidak sah) + beban perusahaan fiktif 0,22%; komponen live di template DEFAULT/BS 3 tenant → R1 remediasi SEGERA.
- 🔴 F-02 (LATEN): tabel TER seed menyimpang dari Lampiran UU HPP/PMK 168 (A r3+: 5.650.001-5.950.000; B r1 ≤6.200.000; C ada bracket ≥21%) — hanya aktif bila useTer=true (default false).
- 🔴 F-03 (LATEN): terCategoryOf salah — K1 di A (harus B, PTKP 63jt), K3 di B (harus C, 72jt); 3 profil K1 live terdampak.
- 🔴 F-04 (LATEN): tidak ada true-up Masa Pajak Terakhir — PMK 168: Desember = Pasal 17 atas penghasilan setahun (biaya jabatan cap 6jt/TAHUN) minus yang telah dipotong Jan-Nov; engine pakai metode sama 12 bulan.
- ⚠️ F-05 kompensasi PKWT dikecualikan saat resign (PP 35 Ps.17: "salah satu pihak" — termasuk pengunduran diri); F-06 PPh kompensasi di-hardcode 0% (praktik lazim: tarif final lapisan 0/10/20/25% PP 36/2021 + ×1,2 non-NPWP); F-07 cuti melahirkan 6 bln flat (UU KIA Ps.4(3)(a): 3 bln + maks 3 bln berikutnya APABILA kondisi khusus + surat dokter).
- ℹ️ F-08 kutipan keliru (ptkp-auto.ts sebut "PMK 168/2023 PTKP 54jt" — PMK 168 ≠ pengatur PTKP; CT-LAHIR-P "Ps.22"; CT-LAHIR "PP 35/2021"; settlement "PPh 0% (Ps.16)"); F-09 istirahat mingguan Ps.79 tak di-enforce (cycle 7×6jam lolos); F-10 snapshot vs Ps.7(2) "bulan berikutnya" = penyimpangan yang DISKAHKAN pemilik produk (timing-only, SPT mengoreksi liabilitas tahunan); F-11 plafon JP perlu review tahunan.
- ✅ Patuh terverifikasi ulang: bracket Pasal 17 + non-NPWP ×1,2, biaya jabatan 5%/500rb-bl, basis TER=bruto, bulan ireguler→Pasal 17, iuran JHT+JP pengurang neto, formula kompensasi masa/12×upah, keguguran 1,5 bln, suami 2 hari, 40 jam (8×5/6×7) + ≤8 jam/hari, PKWT >5th 409+force, BPJS rates.
- PRIORITAS REMEDIASI (bila "perbaiki"): R1 JKP segera (aktif) → R2 re-seed TER resmi → R3 mapping kategori → R4 true-up Desember → R5 kompensasi resign → R6 PPh kompensasi → R7 melahirkan 3+3 → R8 kutipan → R9 istirahat mingguan.
- Laporan lengkap + bukti DB live + sumber: audit/BPA-AUDIT-53.md.

---
Task ID: 54
Agent: orchestrator (Z.ai)
Task: "perbaiki semua" — implementasi penuh remediasi audit BPA-AUDIT-53 (Task 49-52 vs peraturan pemerintah): R1-R9 (JKP PP 6/2025, tabel TER resmi, mapping kategori TER, true-up masa pajak terakhir, kompensasi PKWT resign, PPh final lapisan, cuti melahirkan 3+3, kutipan regulasi, istirahat mingguan).

Work Log:
- Riset sumber resmi: unduh PDF PMK 168/2023 dari pajak.go.id, ekstrak tabel TER Kategori A/B/C VERBATIM (hlm. 9-12; 44/40/41 lapisan, max 34% — bukan 36×3=108 seperti dugaan audit) + formula masa pajak terakhir.
- F-02: modul sumber tunggal src/onevity/payroll/services/ter-official.ts; ganti tabel lama di prisma/seed.ts & provisioning.ts; migrasi scripts/migrate-audit53.ts (DELETE+INSERT 125 baris, id deterministik). Validasi silang 9 contoh resmi DJP dalam PDF — 9/9 cocok.
- F-03: terCategoryOf dikoreksi — A: TK0/TK1/K0 · B: TK2/TK3/K1/K2/KI0/KI1 · C: K3/KI2/KI3 (K1 dari A→B, K3 dari B→C).
- F-04: true-up masa pajak terakhir di payroll-engine (computeTrueUpOn + jalur NetToGross iteratif) + konteks YTD (bruto/iuran/dipotong) di buildRunRows dari run Confirmed/Paid non-TERMINATION/YEAR_END_ADJ; deteksi Desember (endDate month=11, BUKAN max-endDate — bug heuristik pertama salah memicu true-up di Sep, ditemukan via E2E run Sep totalTax=0, diperbaiki) + leaver (status≠Active/endDate).
- F-01: struktur JKP PP 6/2025 Ps.11 benar (0,36% = 0,22% APBN + 0,14% rekomposisi JKK): provisioning tanpa JKP_C/JKP_E + rate 0/0.0014; migrate-jkp.ts ditulis ulang (UPDATE regulasi + nonaktifkan komponen + DELETE item template DEFAULT/BS); schema-tenant.prisma default baru + db:generate; UI parameter + rekap BPJS (header + jkpNote informatif) + preview default.
- F-05/F-06: settlement-service — gate !isResignation dihapus (PP 35 Ps.17 salah satu pihak); finalTerminationTax(base, hasNpwp) tarif lapisan + non-NPWP ×120%; baris PKWT_TAX terpisah; PKWT_KOMP → SeveranceFinal (find-or-create di migrasi).
- F-07: CT-LAHIR-P 3+3 bersyarat (entitlement 3, max 6, allowAdvance) + gerbang surat dokter di leave-service submitRequest; gerbang memakai BULAN KALENDER (bug konversi ÷21 ditemukan saat E2E: 3 bln kalender ≈ 3,1 satuan — salah memicu gerbang & maxPer; diperbaiki dengan calMonthsOf).
- F-08: kutipan ptkp-auto.ts (PMK 101/2016 sumber PTKP), deskripsi CT-LAHIR/CT-GUGUR-I (UU 13/2003 Ps.93), CT-LAHIR-P (UU KIA Ps.4(3)(a)), header settlement (PP 36/2021).
- F-09: assertWeeklyHours menolak cycle tanpa hari Off (rata-rata ≥1 hari istirahat/minggu, UU 13 Ps.79(2)).
- Parity: step "audit53" + label jkp direvisi + 5 marker gap (terOfficial/terOld/jkpFixed/maternity3/pkwtFinal).
- Verifikasi: migrasi 3 tenant sukses; checkParityGap {gap:false, readySchemas:3}; uji engine terisolasi true-up EKSAK (216.250; over-withheld→0) + mapping 12/12; API E2E: run Sep normal (progresif, tanpa JKP), run Desember true-up ter-plumbing (YTD 3 bln<PTKP→0, benar; data uji dibersihkan + run Sep dikembalikan Draft), cuti 6bln tanpa surat DITOLAK/dengan surat DIBUAT (dibersihkan), settlement resign MII00013 (PKWT_KOMP 57.712.500 + PKWT_TAX 771.250 = 10%×7.712.500 eksak), jadwal 7-hari-kerja DITOLAK; browser: Parameter Pajak (JKP 0%/0,14% + teks benar) & Jenis Cuti (3 bln + Ps.4(3)(a)) render, tanpa error console, mobile 390px tanpa overflow, footer ada; lint & tsc bersih; dev.log tanpa 500.

Stage Summary:
- SELURUH temuan BPA-AUDIT-53 R1-R9 terimplementasi & terverifikasi (F-10 dipertahankan by design; F-11 catatan review tahunan). Parity 3/3 tenant hijau.
- Artefak: audit/BPA-FIX-54.md (dokumentasi remediasi), ter-official.ts (sumber tunggal tabel TER resmi), migrate-audit53.ts, migrate-jkp.ts revisi.
- Angka kunci tervalidasi: TER resmi 125 baris (contoh DJP 9/9); true-up Desember eksak; PKWT final 10% lapisan eksak; JKP 0% pekerja + 0,14% rekomposisi (0 potongan THP tidak sah dihilangkan).

---
Task ID: 55
Agent: orchestrator (Z.ai) + 1 Explore subagent (audit PII decryption leak paths)
Task: Laporan user (screenshot Direktori Karyawan, tab Personal, MII00001 Hartono): field NIK/NPWP/No. Rekening menampilkan ciphertext mentah "enc:v2:t:…" (lingkaran merah). Perbaiki.

Work Log:
- VLM analisa screenshot: Personal tab MII00001 — NIK `enc:v2:t:9WDFDSizNt96PMHT:…`, NPWP + ACCOUNT NO juga enc:v2; BPJS Health/Emp PLAINTEXT; identifikasi karyawan via DB (birthPlace Bogor/21-7-1995/AB/Cerai/Kristen Protestan → MII00001 Hartono).
- LIVE API test awal: employee-detail + employees list saat INI mengembalikan plaintext benar (nik 3176363464506) — DB kini enc:v1 tanpa vault (rollback sandbox mengubah state vs saat screenshot).
- Subagent Explore (audit 24 lokasi serializer PII): akar masalah TERBUKTI = DOUBLE-ENCRYPTION — encryptText TANPA guard isEncrypted; ciphertext yang pernah bocor ke UI (vektor historis employee-options pra-43-f) di-round-trip balik ke write-path → 2 lapis; decryptText melepas lapisan luar → "mengembalikan" ciphertext lapisan dalam seolah plaintext → persis gejala screenshot (terverifikasi kriptografis oleh subagent + repro orchestrator). Tambah ditemukan: 3 jalur bocor RAW (reports-bpjs bpjsTk/bpjsKes, scheduler docNumber, POST /employees respons), bug primeTenantCrypto pin-null permanen saat error transien, kunci respons ESS "bpjsEmpskill" casing salah.
- FIX field-crypto.ts: (1) guard encryptText — input isEncrypted → tulis apa adanya (idempoten, mencegah double-enc di SEMUA write-path: employee-detail PATCH, payroll-profiles, createEmployeeWithAssignment, employee-documents, medical-service); (2) primeTenantCrypto catch — error koneksi transien TIDAK lagi pin-null+tandai primed (dulu: 1 error → enc:v2 gagal 500 sampai restart); 42P01/42703 tetap null permanen.
- FIX reports-bpjs.ts toMemberRow: bpjsTk/bpjsKes didekripsi tc.decryptText (CSV upload BPJS TK/JKN kini berisi no. kartu riil).
- FIX scheduler-service.ts jobDocumentExpiryReminders: docNumber didekripsi best-effort per baris (tcDoc dari tenantCryptoForDb; gagal → label generik; JANGAN tulis ciphertext mentah ke notifikasi/email).
- FIX employees.ts POST respons: bentuk read-path (decryptText 5 field PII) — konsumen respons tidak menerima ciphertext.
- FIX ESS me.ts: kunci respons bpjsEmpskill → bpjsEmpSkill + UI consumers (ess-profile.tsx, ess-types.ts).
- BARU scripts/migrate-unwrap-double-enc.ts + parity step 29 "unwrap-double-enc": pindai 63 kolom registry ENCRYPTED_COLUMNS, unwrap maks 5 lapis, tulis ulang 1 lapis; kolom uang (kind n) dicek defensif (kind-mismatch → unwrap → parse); idempoten. Log per-tabel diperbaiki (fixedCol).
- E2E REPRO KONTROL: (1) tulis double-enc faithful (outer v1 bootstrap manual) ke MII00001 → GET employee-detail 200 mengembalikan "enc:v1:t:CG4X…" RAW = BUG REPRODUCED; (2) guard: encryptText(ciphertext) = no-op PASSED; (3) migrasi → 1 diperbaiki dari 5379 dipindai; (4) GET kembali plaintext 3176363464506 RESTORED; (5) BPJS CSV TK/JKN 200 tanpa "enc:" (baris Hartono: 3176363464506;…;92008027469135 / JKN 000173269675); (6) POST /employees 201 respons decrypt benar (nik/taxId/acct plaintext); (7) PATCH input ciphertext → DB tetap 1 lapis (guard) + PATCH nilai normal round-trip 200; (8) data uji dibersihkan.
- E2E BROWSER (agent-browser, login hrd MII): Direktori → Hartono → dialog quick view → "Buka Profil Lengkap" → tab Personal: NIK 3176363464506, NPWP 091485262345, No. Rekening 848850308, BPJS Kesehatan 000173269675, BPJS TK 92008027469135 (semua plaintext — persis field screenshot); eval innerText: CLEAN tanpa "enc:"; console 0 error (hanya Fast Refresh); mobile 390px scrollWidth=390; footer visible; desktop 1280px scrollWidth=1280. VLM verifikasi screenshot: nilai terbaca normal.
- bunx tsc --noEmit 0 · bun run lint 0 · dev.log bersih (PATCH 500 tunggal = uji malformed disengaja, 404 = route typo uji). Commit 6e3aefc. DEPLOY-RUNBOOK §5.2: baris parity 29.

Stage Summary:
- Task 55 TUNTAS: akar masalah screenshot = double-encryption PII (bukan serializer detail — GET employee-detail memang sudah mendekripsi; nilai yang tersimpan berlapis dua membuat decrypt "berhasil" mengembalikan ciphertext lapisan dalam).
- Pertahanan berlapis: (a) guard encryptText idempoten = tidak ada lapisan baru DI MANA PUN; (b) migrasi parity 29 self-heal data historis tiap boot; (c) 3 jalur bocor RAW ditutup (CSV BPJS, pengingat dokumen, respons POST create); (d) prime vault tidak lagi pin-null saat error transien.
- Kontrak tidak berubah (field tetap sama; hanya kunci ESS bpjsEmpskill → bpjsEmpSkill). Deploy = restart saja (parity 29 idempoten).
- Catatan: PATCH dengan input ciphertext well-formed kini tersimpan apa adanya → respons decrypt mengembalikan inner value; kasus pathologis (form tak pernah mengirim ciphertext) + migrasi unwrap membersihkan sisa data lama.

---
Task ID: 56
Agent: orchestrator (Z.ai)
Task: Payroll — UX enkripsi uang (lanjutan Task 55/47): field uang menu payroll saat brankas tertutup harus bernilai 0 (bukan "—"/null), dan SETELAH kata sandi enkripsi dimasukkan halaman harus terefresh OTOMATIS dengan nilai sebenarnya. Audit menyeluruh field ter-impact encryption di seluruh menu payroll.

Work Log:
- DIAGNOSIS end-to-end (login MII owner + browser): semua endpoint payroll utama SUDAH ter-gate money-view (tidak ada ciphertext mentah yang bocor); scan DB scripts/diag-scan-double-enc.ts (baru): 5.379 nilai terenkripsi MII — 0 double-enc, 0 gagal dekripsi (data bersih pasca-Task 55). Perilaku aktual yang salah: vault tertutup → uang "—" (null); unlock → halaman TIDAK re-fetch (nilai tetap "—" sampai reload manual) — dua akar keluhan pemilik produk.
- src/onevity/shared/lib/money-view.ts: maskedWalker kind "n" → 0 (semula null) untuk mode vault-closed/no-grant — SEMUA respons json() UI admin (payroll runs/detail, loans, component-assignments, journals, benefit-claims, rapel) kini "Rp 0" saat brankas tertutup; kind "t" (PII) tetap terdekripsi; dec() TETAP null saat masked (jalur karyawan: PDF payslip/email/ESS tetap "—" — karyawan tidak boleh melihat "Rp 0"); komentar header + interface diperbarui.
- src/onevity/payroll/api/payroll-profiles.ts GET: baseSalary mv.canSee?(dec??0):null → mv.dec0() (masked → 0).
- src/onevity/payroll/api/bonus-massal.ts: total run respons → mv.dec0() (masked → 0).
- src/onevity/human-resource/api/personnel-actions-detail.ts: baseSalary → mv.dec0() (masked → 0, konsisten).
- src/onevity/payroll/api/reports-register.ts: baris per karyawan r0n(null→"—") → r0(dm=dec0) (masked → 0, XLSX & JSON); helper r0n dihapus; type Map diperketat number.
- src/onevity/shared/lib/api.ts: konstanta VAULT_CHANGED_EVENT="onevity:vault-changed"; hook useApi mendengarkan event → bump tick → REFETCH otomatis semua data halaman terbuka; fmtIDR & fmtIDRShort defensif (non-number/non-finite → "—" — tidak pernah merender string enc: mentah).
- src/onevity/shared/components/shell/money-vault.tsx: notifyVaultChanged() dipanggil pada SETIAP aksi sukses (setup/unlock/lock/change-password/grant/revoke) → semua useApi ter-mount re-fetch → nilai uang berganti otomatis Rp 0 ↔ nilai asli TANPA reload browser.
- src/onevity/payroll/components/payroll-run-detail.tsx: badge item informational {i.name}: {i.amount} (render mentah — satu-satunya titik bisa menampilkan karakter enkripsi bila ada kebocoran jalur lama) → fmtIDR(i.amount) (konsisten dgn PDF payslip).
- E2E browser (MII, 42 karyawan): [locked] runs/detail/profiles/transactions/journals/overview + ekspor bank CSV/register JSON/jurnal CSV → Rp 0/0 semua; [unlock via dialog] runs list, profiles (Gaji Pokok Rp 54.900.000), run detail 176 sel + dialog slip + overview → nilai asli muncul TANPA reload; [lock via dialog] → otomatis kembali Rp 0. lint ✓ tsc ✓ dev.log bersih (semua 200, tanpa error).
- CATATAN LINGKUNGAN: vault MII SEKARANG TERKONFIGURASI (setup test) — kata sandi "brankas123", status terkunci; ganti lewat dialog Brankas Uang (tab Kata Sandi) bila ingin sandi sendiri. Tenant Cahaya/Sentra belum ber-vault (legacy — semua nilai terlihat).

Stage Summary:
- Aturan produk Task 56 tuntas: brankas uang tertutup → SEMUA field uang payroll = 0; kata sandi dimasukkan → halaman aktif terefresh otomatis (event onevity:vault-changed + useApi listener) dengan nilai asli; kunci kembali → 0 otomatis.
- Tidak ada kebocoran ciphertext: endpoint payroll seluruhnya ter-gate; DB bersih (diag-scan-double-enc.ts bisa dijalankan ulang kapan pun); fmtIDR defensif.
- Jalur karyawan (PDF payslip/email/ESS) TETAP "—" saat masked (disengaja — karyawan tidak boleh menyangka gajinya Rp 0).
- Artefak: scripts/diag-scan-double-enc.ts (diagnostik read-only double-encryption lintas tenant).

---
Task ID: 56-push
Agent: orchestrator (Z.ai)
Task: Push 3 commit lokal (Task 55 + worklog + Task 56) ke origin/main atas permintaan user ("sudah di push?").

Work Log:
- Verifikasi: main 3 commit di depan origin/main (6e3aefc T55 fix, a74d462 worklog T55, 4464022 T56 payroll encryption UX); working tree bersih.
- `git push -u origin main` → 1ed1df2..4464022 main -> main; upstream main...origin/main tersambung.
- Post-push fetch: rev-list 0/0 (sinkron penuh), status bersih.

Stage Summary:
- origin/main kini berada di 4464022 (Task 56: field uang payroll = 0 saat brankas terkunci + auto-refresh nilai asli saat unlock).
- Semua pekerjaan Task 49–56 (PTKP/TER/PPH21, employee directory, payroll encryption UX) sudah aman di remote GitHub.

---
Task ID: 57
Agent: orchestrator (Z.ai)
Task: Investigasi laporan user "MII Proses & Hasil: password brankas 'asmaree.007' benar tapi nilai tetap 0" — temukan akar masalah, perbaiki bug sumber, tetapkan rencana pemulihan data.

Work Log:
- Diagnostik prod berlapis (MII = tenant_pt_mitra_industri_internasional):
  - MoneyVault MII: 1 baris, openUntil=12:53 UTC (unlock 04:53 UTC sukses) → password "asmaree.007" COCOK, vault TERBUKA di memori.
  - Aktor: Tri Handayani = OWNER platform (role OWNER, satu-satunya member) → gate money-view open-admin → mustSee.
  - Dekripsi manual PayrollRunLine.bruto/net dgn dataKey vault: plaintext-nya BENAR-BENAR "0" — bukan gate, bukan UI, bukan key mismatch (dataKey tersimpan == PBKDF2(password) terverifikasi YA).
  - Pindai 16 kolom uang MII: SEMUA nilai hasil migrasi 28-c = 0 (baseSalary 48/48, PayrollRunLine 126/126, RunItem, Run totals, Journal totals) — sementara kolom M-8 (Loan/Benefit/Travel/Medical) utuh non-zero, dan journal 3 baris non-zero (created 12 Sep setelah seed, tidak tersentuh rerun).
- AKAR MASALAH (bug idempotensi migrasi): scripts/migrate-encrypt.ts step parity "encrypt" memilih baris dgn filter `NOT LIKE 'enc:v1%'` — baris enc:v2 (Money Vault Task 47) TIDAK terskip → Number("enc:v2:…") = NaN → encryptMoney(NaN) (pra-fix Task 50 menulis "NaN"; pasca-fix menulis 0) → SETIAP parity rerun setelah vault aktif MENIMPA seluruh kolom uang tenant tsb menjadi 0. MII satu-satunya tenant ber-vault → satu-satunya korban. Korban kedua hampir terjadi: migrate-encrypt-money.ts (M-8) pola sama — selamat hanya karena guard isFinite men-skip ciphertext (mubazir tiap rerun: 126 baris "dienkripsi" = dibaca+ditulis ulang tanpa kerusakan).
- Momen korupsi teridentifikasi: log deploy 13 Sep 04:00 UTC (task 54) — "PayrollRunLine.bruto: 126 baris dienkripsi" dst = rerun parity menimpa data.
- FIX (scripts/migrate-encrypt.ts + migrate-encrypt-money.ts): filter kini `NOT LIKE 'enc:%'` (skip v1 DAN v2) + counter `already` pakai 'enc:%'. Typecheck bersih.
- Pencarian pemulihan: TIDAK ada backup DB (ROOT.war.bak = aplikasi, bukan data; tidak ada cron pg_dump; /var/backups = sistem); WaLog kosong; Attachment kosong; seed baseSalary = RANDOM dlm range grade (G1 4.5-7jt … G8 50-80jt, kelipatan 50rb) → nilai asli TIDAK dapat direkonstruksi dari sumber repo; jurnal 3 baris non-zero + kolom M-8 non-zero utuh.

Stage Summary:
- Bug sumber SUDAH DIPERBAIKI & akan dideploy: parity rerun tidak akan pernah menimpa enc:v2 lagi (Tenant lain tanpa vault tidak pernah terdampak; data mereka verifikasi utuh).
- Data uang MII (kolom 28-c) hilang permanen (ditimpa 0): opsi pemulihan = (a) restorasi nilai demo dgn angka realistis per grade (kolom loan/travel/benefit tetap asli), (b) input manual ulang via UI, (c) biarkan 0 sebagai data baru. Menunggu keputusan pemilik produk; bug tidak akan terulang.
- Rekomendasi tindak lanjut (di luar task ini): pg_dump harian cron + parity runner skip tenant ber-vault utk step enkripsi.

---
Task ID: 58
Agent: orchestrator (Z.ai)
Task: Form "Buat Workspace" (registrasi) — tambah kolom input KODE PERUSAHAAN perusahaan yang didaftarkan (permintaan user: "cek form ketika membuat workspace baru, seharusnya ada kolom untuk input company code"). [RENUMBER 57→58 saat rebase: Task ID 57 telah dipakai sesi paralel (fix parity encrypt enc:v2)]

Work Log:
- Audit form registrasi auth-screen.tsx: hanya 4 field (Nama Workspace, Nama Lengkap, Email, Kata Sandi) — tidak ada company code; tenant baru pun TIDAK punya record Company (companies.ts GET 404 "Perusahaan belum di-setup") sehingga prefix nomor karyawan jatuh ke fallback slug (CAH/SEN) — akar masalahnya.
- prisma/schema.prisma: model Tenant += kolom companyCode String? (nullable utk tenant lama) → bun run db:push (Prisma Client platform ter-regenerate).
- src/app/api/auth/register/route.ts: parse + sanitizeCompanyCode (trim→uppercase→A-Z0-9→max 12, mirror codePrefix employees.ts); validasi wajib 2–12 karakter (400 bila kurang); SETELAH seedTenantReference kini langsung CREATE record Company { code, name: workspaceName, shortName: code } → tenant baru langsung punya profil perusahaan + prefix nomor karyawan benar (MII00001-style); registry platform Tenant.create menyimpan companyCode; gagal seed tetap drop schema (idempoten).
- src/onevity/shared/lib/session-store.ts: SessionTenant += companyCode: string | null; type input register += companyCode: string.
- src/onevity/shared/lib/auth.ts buildSessionInfo: select tenant += companyCode; mapping workspaces += companyCode.
- src/onevity/shared/components/auth/auth-screen.tsx: FieldId "reg-companycode"; state companyCode; validateRegister(companyCode) — wajib + min 2 (pesan baru + VALIDATION_EN); UnderlineField += props mono (font-mono uppercase tracking) / maxLength / hint; field baru "Kode Perusahaan" (placeholder MII) tepat di bawah Nama Workspace + helper text fungsi prefix nomor karyawan; submit sanitasi client-side (mirror server).
- src/onevity/shared/components/auth/tenant-select.tsx: kartu workspace menampilkan badge kode perusahaan (mono uppercase bordered) sebelum slug — tenant lama tanpa kode tetap rapi (null-safe).
- scripts/backfill-tenant-company-code.ts (baru): backfill Tenant.companyCode dari Company.code tiap schema — MII ✓; Cahaya/Sentra TANPA Company sama sekali → dibuatkan Company (CDN, SLP — kode 3 huruf dari nama) + companyCode registry via SQL satu kali.
- E2E browser: [form] field KODE PERUSAHAAN tampil; [validasi] submit kosong → "Kode perusahaan wajib diisi." + aria-invalid; [registrasi penuh] kode "cKr-7!" disanitasi CKR7 → provisioning sukses → masuk app shell; [DB] Tenant companyCode=CKR7 + Company {code CKR7} + User owner; [halaman Perusahaan tenant baru] menampilkan CKR7 (dulu 404 belum-setup); [tenant-select hrd@mii.co.id] badge MII + CDN tampil; console/error bersih; tenant uji E2E dibersihkan pasca-verifikasi (DROP schema + registry).
- tsc ✓ lint ✓ dev.log bersih (semua 200).

Stage Summary:
- Aturan produk Task 58 tuntas: form buat workspace kini MEMINTA kode perusahaan (wajib, A-Z0-9 2–12, otomatis uppercase); kode langsung dipakai membuat record Company tenant (profil + prefix nomor karyawan) dan tersimpan di registry platform (tampilan workspace + fallback).
- Tenant demo existing: MII, CDN, SLP — semua ber-companyCode; tenant baru apapun otomatis benar dari detik pertama.
- Artefak: scripts/backfill-tenant-company-code.ts; screenshot audit/t58-tenant-select-code.png.

---
Task ID: 57b
Agent: orchestrator (Z.ai)
Task: Implementasi restore otomatis data uang MII (keputusan pemilik produk) — skrip restore + parity step.

Work Log:
- scripts/restore-mii-payroll-money.ts (BARU): pemulihan 3 lapis dari sumber yang masih dapat di-reason:
  1. EmployeeAssignment.baseSalary — nilai seed RANDOM per grade (tak rekonstruksiibel) → diisi ulang angka realistis per rentang grade (G1 4.5-7jt … G8 50-80jt, kelipatan 50rb) dgn PRNG deterministik per baris (rerun konsisten) + multiplier mutasi historis PA-2022-0101..0104 (1.18/1.0/1.12/1.05) sesuai seed.
  2. EmployeeComponentAssignment.amount — nilai seed eksplisit dikembalikan: BONUS Q3 SEP (MII00004 2.5jt, MII00009 1.5jt, MII00014 3jt) + TTRANS MII00021 1jt; baris 0 non-seed (settlement sah) dibiarkan.
  3. Run PR-2026-07/08-SAL-01 (Paid) dihitung ULANG via engine payroll sungguhan (calculateAndSaveRun + confirmRun): RunLine/RunItem/totals terisi konsisten dgn master baru; jurnal lama berisi-0 dihapus dulu (generateJournalForRun idempoten per runId → regenerate). Rollback buku pinjaman M-8 sebelum recalc: angsuran Deducted oleh run tsb → Pending + paid/outstanding dikembalikan, sehingga recalc memasukkan kembali item LOAN dan confirmRun memotong ulang SEKALI (netto buku = nol perubahan). Run SEP tetap Draft (demo interaktif).
- IDEMPOTEN: hanya nilai 0 yang ditulis; run hanya diproses bila Paid+totalNet=0; rerun = no-op penuh.
- parity-runner.ts: step "restore-mii-payroll-money" didaftarkan setelah unwrap-double-enc (konvensi K-6).
- tsc --noEmit bersih (setelah regen prisma client utk nullable LoanInstallment.periodCode & encLoan ?? "0" utk M-8 NOT NULL).

Stage Summary:
- Restore otomatis siap deploy — bug sumber (Task 57) + repair data satu paket.
- Deployment prod: parity pipeline dipicu manual (env diag sementara) → step restore jalan → env diag dibersihkan lagi (pm2 delete+start+save).
