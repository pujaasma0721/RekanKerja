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
- Push hanya saat user bilang "push". Commit boleh tiap task.
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
