# P5-BRIEF — Merit, PA & Surat (DEVELOPMENT-PLAN-PERFORMANCE.md §20 P5)

> Task ID: **P5-impl** · Agent: fullstack-developer · BACA `worklog.md` (entri P0–P4) SEBELUM BEKERJA.
> Fase: **P5 Merit, PA & Surat** (L–XL). Keluaran terverifikasi: **alur 8 E2E + jurnal payroll menyerap** (§32).
> Setelah selesai WAJIB append entri worklog Anda (template di bawah) — JANGAN commit/push (orchestrator yang mengamend & push).

## 0. Konteks yang SUDAH ada (JANGAN dibuat ulang)

- **Schema Prisma** (`prisma/schema-tenant.prisma`): `MeritMatrix`, `MeritRecommendation` (docNo MER-2026-0001 unique, appraisalId unique, bonusMonths/bonusAmount/raisePct/raiseAmount/status Draft|Submitted|Approved|Rejected|Applied|Cancelled/personnelActionId/appliedRunNo), `PipPlan`, `PipCheckpoint` (seq 1..3 @@unique([pipId,seq])), `ProbationEvaluation` — SUDAH ADA dari P0. **TIDAK ADA perubahan schema.**
- `nextPerfNo(db, "MER"|"PIP")` — helper penomoran max-suffix global ada di `src/rekankerja/performance/services/perf-master-service.ts`.
- Approval engine `src/rekankerja/shared/services/approval-engine.ts`: `APPROVAL_DOC_TYPES`, `DOC_TYPE_LABEL`, `AMOUNT_DOC_TYPES`, `startApprovalChain`, `decideApprovalChain`, `getApprovalChain`, `attachChainSummaries`, `DELEGATION_DOC_ALIASES`. P4 menambah "PerformanceAppraisal" + `includeLevels` — PELAJARI pola di `perf-calibration-service.ts` (constant `PERF_DOC_TYPE`, `ensurePerfApprovalStructure`, `decidePerfApproval`).
- Payroll: `EmployeeComponentAssignment` (kind "Specific" + periodId + processTypeId + wageComponentId + amount ENCRYPTED `tc.encryptMoney`) = mekanisme resmi injeksi nominal ke run (pola `transferToPayroll` attendance-service L1097+, `bonus-massal.ts`). `calculateAndSaveRun(db, runId)` + `nextRunNo` di `payroll-service.ts`. Komponen seed tenant: **BONUS** (Earning/Irregular), **RAPEL** (Earning/Irregular/BackPay), **THR**. ProcessType: SALARY/BONUS/THR/RAPEL/BENEFIT/TERMINATION/YEAR_END_ADJ.
- PersonnelAction: pola create lengkap di `src/rekankerja/human-resource/api/personnel-actions.ts` POST (docNo PA-YYYY-NNNN, template `AT-PA-STD` layers, resolusi approver Dept Head=atasan langsung, status Prepared, validateSalaryAgainstGrade).
- Surat: `letter-service.ts` (`issueLetter`, `buildLetterContext`, `renderLetterBody`, `letterPdfBuffer`) + `letter-defaults.ts` (`LETTER_TEMPLATE_DEFAULTS`, kategori Disciplinary|PersonnelAction|EmployeeService|Recruitment) + `scripts/resync-letter-templates.ts` (seed 3 tenant, idempoten, tak menimpa edit user). Surat rekrutmen (offer-service.ts `performSend`) = pola konteks token kustom.
- Money vault: `tenantCryptoForDb(db)` → `tc.encryptMoney(n)`/`tc.decryptMoney(s)` (prefix enc:v1:n:). Gaji pokok: `EmployeeAssignment.baseSalary` (String terenkripsi; baca via decryptMoney).
- Notifikasi: `notifyEvent(db, {to, docType, docNo, title, body, kind, link, employeeId})` (notification-service).
- Menu perms: `src/rekankerja/shared/lib/menu-perms.ts` — performance:results ops [publish, appeal, close].
- UI pola: `performance-results.tsx` (554 baris — halaman "Hasil & 9-Box" performance:results; struktur tab ada di sana; pelajari juga performance-calibration.tsx untuk pola dialog/section/i18n `t("ID","EN")`).
- Dev state tenant MII (`tenant_pt_mitra_industri_internasional`): period **SEPTEMBER 2026 Open** (run SALARY Draft PR-2026-09-SAL-01), BONUS processType ada, matrix **MERIT-STD aktif** (grid: rating 5→bonus 2 bln raise [10,15]; 4→1.5/[8,12]; 3→1/[5,8]; 2→0.5/[0,3]; 1→0/[0,0]), appraisal: **21 Closed** (12 PER-2025 + 9 PER-2026-CAL) + 1 Published (PER-2026-ACK) + 2 ManagerDone + 41 Enrolled; PIP kosong; kandidat PIP rating≤2 Closed: Wahyu Saputra MII00021 (PER-2025, skor 62 rating 2) + cek DB untuk lainnya di PER-2026-CAL. Login admin: hrd@mii.co.id (OWNER Tri Handayani).

## 1. Scope yang DIBANGUN (baru)

### A. Service `src/rekankerja/performance/services/perf-merit-service.ts` (±850 baris)
Pola actor seperti `CalibrationActor` di perf-calibration-service. Semua mutasi: ActivityLog + guard. Error message sertakan tag guard "§35-17" dst (pola modul).

1. `meritBoard(db, actor, {cycleId?})` → { cycle, recommendations[] (join appraisal→employee + chain summary via attachChainSummaries docType MeritRecommendation; DEKRIPSI bonusAmount/raiseAmount utk tampilan — menu-guard performance:results), stats {byStatus, totalBonus, totalRaise}, pipCandidates[], letters[], openRuns[] (PayrollRun Draft/Calculated + period name, utk pilihan apply), matrix aktif }.
2. `recommendMerit(db, actor, {cycleId, matrixId?})` — §32-1: draf otomatis peserta **Closed** (guard §35-17: status Closed & matrix aktif; skip bila MeritRecommendation appraisalId sudah ada — unique; rating null → skip dengan laporan). Hitung: bonusMonths & raisePct dari grid (raisePct = MID dari range) × finalRating; nominal dari `EmployeeAssignment` aktif baseSalary (decryptMoney): bonusAmount = bonusMonths × base; raiseAmount = raisePct% × base → simpan `tc.encryptMoney`. docNo `nextPerfNo(db,"MER")`. Return laporan {created, skippedExisting, skippedNoRating, noSalary[]}.
3. `patchMerit(db, actor, {id, patch:{bonusMonths?, raisePct?, note?}})` — hanya status Draft; recompute nominal terenkripsi.
4. `submitMerit(db, actor, {id})` — Draft→Submitted + `startApprovalChain(docType:"MeritRecommendation", docId: merit.id, employeeId: appraisal.employeeId, amount: (bonus+raise total decrypted))`. Sebelum submit: `ensureMeritApprovalStructure`. Notif ke approver jenjang aktif (`to:"nextApprover"` pola P4).
5. `decideMeritApproval(db, {docId, action:"approve"|"reject", note?, actor: DecideActor})` — via `decideApprovalChain`; approve semua jenjang → status **Approved** + notif admin HR + (milestone) notif selesai; reject → kembali **Draft** + alasan ter-ActivityLog (pola P4 reject → ManagerDone).
6. `cancelMerit(db, actor, {id})` — Draft/Submitted→Cancelled (+ cancel chain bila ada, pola perf-calibration L821).
7. `applyMerit(db, actor, {id, includeBonus?, includeRaise?})` — §32-3(a) "toPayroll" — guard §35-18: status Approved & belum Applied & ada PayrollRun terbuka (Draft/Calculated) di period Open. Mekanika (pola bonus-massal + transferToPayroll):
   - bonus → period Open terbaru + processType **BONUS**: cari run Draft/Calculated period+type → bila tak ada: BUAT run (`nextRunNo(db, periodId, processTypeId)` — baca signature aslinya) lalu hitung `calculateAndSaveRun` (pola autoRun bonus-massal). Buat `EmployeeComponentAssignment` kind Specific (periodId, processTypeId, wageComponent code **BONUS**, amount encryptMoney(bonusAmount), notes `Merit {docNo}`) — idempoten: deleteMany assignment lama dgn notes sama dulu.
   - raise (bila includeRaise) → period sama + processType **SALARY**: run Draft/Calculated (PR-2026-09-SAL-01 tersedia) + component **RAPEL** amount encryptMoney(raiseAmount) notes `Merit raise {docNo}`; bila run sudah Calculated → `calculateAndSaveRun` ulang.
   - Update merit: status **Applied** + appliedRunNo (run bonus; bila hanya raise → run salary). ActivityLog detail lengkap. Notifikasi milestone ke admin HR.
8. `toPersonnelAction(db, actor, {id, type:"SalaryAdjustment"|"Promotion", effectiveDate?, force?, reason?})` — §32-3(b) — guard §35-19: merit Approved/Applied; **Promotion: finalRating ≥ 4 WAJIB** (rating <4 → 400 "§35-19" kecuali force=true HANYA aktor superAdmin + reason wajib → ter-ActivityLog sebagai override direksi); PA duplikat aktif (status Prepared|Submitted employee sama type sama) → 400. Mekanika copy `personnel-actions.ts` POST: docNo PA-YYYY-NNNN (max-suffix), layers `AT-PA-STD` + resolusi approver, status Prepared, `validateSalaryAgainstGrade` utk SalaryAdjustment (newSalary = base×(1+raisePct/100) rounded), detailJson {newSalary, raisePct, meritDocNo, source:"Merit"} / Promotion {meritDocNo, fromRating, potentialBand}. Update merit.personnelActionId. PA Promotion tambahan syarat potentialBand=3? — DOKUMEN: "promosi hanya bila rating ≥4 & potentialBand tinggi" → potentialBand===3 WAJIB utk Promotion (guard sama dgn force override direksi). ActivityLog + notif.
9. `pipCandidates(db, actor, {cycleId?})` — appraisal Closed finalRating ≤2 TANPA PipPlan aktif (Draft|Active|Extended) utk karyawan sama (guard §35-20). Join employee + lowest KPI (utk prefill target).
10. `decidePip(db, actor, {appraisalId, run:boolean, reason?, input?})` — §32-5: HR memutuskan jalankan Alur 9 / tidak:
    - run=true → `input: {startDate, months (1–3, default 2 — D7), reviewerId (atasan pembina — default appraisal.managerId), hrAdvisorId?, targets: [{title, metric, target, weight}] (3–5 item, prefill dari 3 KPI skor terendah appraisal bila ada; Σbobot tidak divalidasi keras utk Draft)}` → create PipPlan status **Draft** docNo `nextPerfNo(db,"PIP")` + PipCheckpoint seq 1..3 dueDate start+30/60/90 hari + **terbitkan SK PIP** (lihat C) + notif reviewer (`to:"employee"` employeeId=reviewerId, kind "performance", link "performance:pip") + ActivityLog.
    - run=false → reason wajib → ActivityLog "Usul PIP DITOLAK + alasan" (entity AppraisalRecord). Return pip plan / log.
    - (Aktivasi/checkpoint/extend/outcome = **P6** — JANGAN bangun; status Draft saja.)
11. `issueResultLetter(db, actor, {appraisalId})` + `issueResultLetters(db, actor, {cycleId})` — Surat Hasil Penilaian template **PERF_RESULT** per karyawan (idempoten: cek LetterDocument templateKey PERF_RESULT + metaJson contains `"appraisalNo":"<docNo>"` sebelum issue; mass = loop semua peserta Closed siklus, laporan {issued, skippedExisting, skippedNotClosed}). `listPerfLetters(db, {cycleId?})` — LetterDocument templateKey in (PERF_RESULT, PERF_PIP) + employee join (cycleId filter via metaJson contains — parse client-side bila perlu).

### B. Approval engine + letters (file lama, perubahan ADDITIF kecil)

- `approval-engine.ts`: tambah `"MeritRecommendation"` ke `APPROVAL_DOC_TYPES` + `DOC_TYPE_LABEL` ("Usulan Merit (Performance)") + `AMOUNT_DOC_TYPES` (tier nominal D12). Cek juga tempat lain yang switch pada docType (approval-structure-view/approval-views.tsx P4 sempat disentuh — ikuti pola PerformanceAppraisal; `DELEGATION_DOC_ALIASES` bila perlu).
- `ensureMeritApprovalStructure(db)` di merit service (pola `ensurePerfApprovalStructure`): struktur `AS-MERIT-STD` docType MeritRecommendation — L1 `HR_ADMIN` (note "Verifikasi usulan merit HR"), L2 `POSISI` direktur (resolusi P-CEO → judul director → level tertinggi — copy dari P4) dengan `minAmount: 10_000_000` (D12: jenjang Direktur aktif bila nominal ≥ Rp 10 jt).
- `letter-defaults.ts`: `LetterCategory` += `"Performance"`; tambah 2 template `LETTER_TEMPLATE_DEFAULTS` (kategori "Performance", signatoryTitle "HR Director", subject + body dwibahasa alami ID — pola REC_OFFER): **PERF_RESULT** "Surat Hasil Penilaian Kinerja" (token: appraisal_no, cycle_name, cycle_period, final_score, rating_label, manager_name, employee_name/no/position/org_unit, letter_no/date, company_name, city, signatory) + **PERF_PIP** "SK Program Perbaikan Kinerja (PIP)" (tambahan: pip_start, pip_end, pip_reviewer, pip_targets (render "1. title — target (metric)" per baris), appraisal_no, final_score, rating_label). Jalankan `bun scripts/resync-letter-templates.ts` SEKALI (idempoten 3 tenant) + catat di worklog.
- `letter-service.ts`: `issueLetter` opts.category union += `"Performance"`; refNo code map: Performance → "HR-PER"; `buildLetterContext` opts tambah `extraCtx?: Record<string,string>` yang di-merge SETELAH ctx default (token perf menimpa default "—"); `issueLetter` teruskan extraCtx. JANGAN ubah perilaku kategori lama.
- `letter-templates-view.tsx` (human-resource): kategori select + section + CATEGORY_LABEL += Performance ("Kinerja" / "Performance") — ikuti pola Recruitment di file itu.

### C. API + route

- `src/rekankerja/performance/api/merit.ts` — GET `?cycleId&status` → meritBoard; POST `{action}`: recommend|patch|submit|approve|reject|cancel|apply|toPersonnelAction|pipDecide|issueLetter|issueLetters. Guard `requireMenuAction(req,"performance:results", op)` — mapping op: recommend/patch/submit/approve/reject/cancel/apply/toPersonnelAction/issueLetter* → `"op:merit"`; pipDecide → `"op:pip"`. approve/reject otorisasi keputusan tetap di engine (decideMeritApproval — aktor DecideActor dari sesi, pola calibration API L127).
- `src/app/api/rekankerja/performance/merit/route.ts` — thin route (`export const runtime = "nodejs"` + export GET/POST, pola results/route.ts).
- `menu-perms.ts`: performance:results ops += `{key:"merit", label:"Mengelola usulan merit", hint:"Rekomendasi bonus/kenaikan pasca-penilaian → payroll/PA (§32)"}, {key:"pip", label:"Memutuskan usul PIP", hint:"Menjalankan atau menolak usulan PIP rating ≤2 (§32-5)"}`.

### D. UI `src/rekankerja/performance/components/performance-merit.tsx` (±800 baris) + wiring

- Halaman baru di-tab-kan KE `performance-results.tsx` sebagai tab **"Merit & Tindak Lanjut" / "Merit & Follow-up"** (results page sudah ber-tab — pelajari strukturnya; tab baru render `<PerformanceMeritPage/>`; jangan pecah tab lama). Content:
  1. Pemilih siklus (default: siklus Closed terbaru; semua siklus tampil).
  2. Tile statistik: jumlah per status + total bonus/raise (Rp — sudah didekripsi server).
  3. Section **Usulan Merit** (tabel): karyawan · rating (chip warna RatingScale) · bonus bln · nominal bonus · raise % · nominal raise · status chip · appliedRunNo/personnelActionId · aksi per status: Draft → Edit (dialog patch bonusMonths/raisePct/note + pratinjau nominal live) / Ajukan / Batalkan; Submitted → Kotak Approval (tampilkan chain jenjang+status; tombol Setujui/Tolak + catatan — hanya aktif bila aktor berhak, engine yang memvalidasi); Approved → **Terapkan ke Payroll** (dialog: centang [✓bonus] [✓ raise], tampil period/run target yang akan menyerap + komponen BONUS/RAPEL + nominal, konfirmasi) / **Buat PA** (dialog type SalaryAdjustment/Promotion + tanggal efektif + pratinjau gaji baru; Promotion tampil syarat rating≥4+band) / **Surat Hasil** (terbitkan + link unduh PDF); Applied → info run + PA (read-only); Rejected/Cancelled → badge.
  4. Toolbar section: tombol **"Buat Usulan Massal"** (dialog pilih matrix + ringkasan grid + jumlah kandidat Closed) + **"Terbitkan Surat Massal"**.
  5. Section **Usul PIP** (rating ≤2): kartu karyawan + skor/rating + 3 KPI terendah + tombol **"Jalankan PIP"** (dialog: tanggal mulai, durasi bulan 1–3 default 2, pembina (select atasan default), target 3–5 baris prefill editable) / **"Tidak Dijalankan"** (dialog alasan wajib).
  6. Section **Surat Kinerja** (daftar LetterDocument PERF_* + refNo + tanggal + tombol unduh PDF via `/api/rekankerja/letters/{id}/pdf`).
- Dwibahasa penuh `t("ID","EN")` + mobile 375 tanpa h-scroll + loading/error state + a11y (pola modul). Konsisten shadcn/ui + Lucide.
- `performance-module.tsx` tidak perlu view baru (merit menempel di results view).

### E. tsconfig scoped + gates

- Buat `tsconfig.p5.json` (copy pola `tsconfig.p4.json` — include semua file performance + ess wiring + scheduler + routes + menu-perms + letter-service + letter-defaults + letter-templates-view + approval-engine + payroll-service + personnel-actions API + app routes terkait).
- Gate ANDA (subagent): `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.p5.json` = 0 error; `bun run lint` 0 error (warning baseline 6); `bun scripts/audit-bilingual.ts` TOTAL_GAP ≤ 150 (file baru kontribusi 0 — pakai konvensi t() di call-site / Record<[string,string]> utk label dinamis); smoke-test API minimal (login cookie hrd@mii.co.id): meritBoard 200, recommend → created, submit → chain, approve → Approved, apply → Applied + EmployeeComponentAssignment terbentuk + PayrollRunItem run BONUS memuat nominal (BUKTI "jurnal payroll menyerap"), guard negatif (apply dua kali 400 §35-18; recommend duplikat skip; promotion rating<4 400 §35-19; PIP duplikat aktif 400 §35-20; submit tanpa matrix 400). CATAT semua hasil di worklog.
- JANGAN jalankan `bunx tsc --noEmit` penuh (OOM senyap — lihat worklog P1).

## 2. Urutan kerja yang disarankan

1. Baca worklog entri P0–P4 + file acuan di §0 (khususnya perf-calibration-service.ts, bonus-massal.ts, personnel-actions.ts POST, letter-service.ts, offer-service.ts performSend, performance-results.tsx).
2. approval-engine + letter-service + letter-defaults (perubahan kecil dulu) → resync template.
3. Service merit (inti) → API + route + menu-perms.
4. UI merit + wiring tab results.
5. tsconfig.p5 + gates + smoke API + perbaikan.
6. Append worklog (template di bawah). JANGAN commit.

## 3. Template worklog (append ke /home/z/my-project/worklog.md)

```markdown
---
Task ID: P5-impl
Agent: fullstack-developer
Task: DEVELOPMENT-PLAN-PERFORMANCE.md §20 P5 — Merit, PA & Surat: MeritRecommendation (approval nominal-tier D12 + vault) → toPayroll/toPersonnelAction + surat PERF_RESULT/PERF_PIP + usul PIP + notifikasi milestone.

Work Log:
- <langkah konkret + temuan + keputusan>

Stage Summary:
- <hasil + artefak + apa yang TERVERIFIKASI smoke + keterbatasan yang jujur>
- E2E alur 8 penuh (UI dua sisi + negatif) diserahkan ke orchestrator.
```

## 4. Batasan tegas

- **TIDAK** mengubah schema Prisma (semua model P5 sudah ada).
- **TIDAK** membangun PIP lifecycle P6 (activate/checkpoint/extend/outcome/scheduler) — P5 hanya create Draft + SK PIP + keputusan usulan.
- **TIDAK** menyentuh THR (§7.1 — THR tidak terikat kinerja).
- Nominal uang: HANYA via encryptMoney/decryptMoney (enc:v1) — JANGAN simpan plaintext di kolom String nominal; tampilan UI hanya menu-guard performance:results (pola payroll).
- `toPayroll` TIDAK otomatis PA SalaryAdjustment utk raise permanen (itu jalur toPersonnelAction); apply payroll utk raise = komponen RAPEL satu kali.
- Error message guard sertakan "§35-NN". ActivityLog SETIAP mutasi (pola modul).
- Jangan commit/push — orchestrator (Task P5) akan verifikasi E2E + amend + push.
