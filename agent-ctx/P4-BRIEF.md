# TASK P4 — Kalibrasi & Finalisasi (Modul Performance RekanKerja HRIS)

TASK ID: **P4-impl** (orchestrator: main). Fase P4 blueprint DEVELOPMENT-PLAN-PERFORMANCE.md (L–XL).

## BACA DULU (wajib sebelum coding)
1. `/home/z/my-project/worklog.md` — SEMUA entri P0/P1/P2/P3 + P3-impl + P3 (pola, keputusan, keterbatasan P3 yang harus dilanjutkan).
2. Blueprint: §30 (Alur 6 kalibrasi & finalisasi berjenjang), §31 (Alur 7 publikasi + acknowledge + banding), §18.10 (Bell Curve — histogram + overlay normal + z-flag D19 + central tendency + tooltip edukatif), §11.1 (docType PerformanceAppraisal + AS-PERF-STD: L1 atasan penilai → L2 HR_ADMIN → L3 Direktur bila rating ekstrem 1&5 / grade tinggi / PIP; "pemohon" pencocokan struktur = KARYAWAN YANG DINILAI bukan atasan — §23-D4), §11.3 (visibility matrix — Direksi agregat), §8 (antipola bias), §35 baris 9–16 (guard: CalibrationDecision alasan wajib + peserta ManagerDone; finalisasi; approval chain; publish semua Finalized/force; acknowledge hasil Published; appeal ≤ appealDays D6 7 hari; decideAppeal tanpa catatan ditolak; close banding selesai), §36 (aktor×endpoint), §21 (gates), §17 (kontrak API calibration + results + ess my-appraisal ekstensi).
3. Referensi pola:
   - `src/rekankerja/performance/services/perf-appraisal-service.ts` (P3 — formula §16, appraisalDetail, ManagerDone state; finalize saat ini STUB 400 "via P4" — GANTI dgn implementasi)
   - `src/rekankerja/performance/services/perf-cycle-service.ts` (gerbang fase publish §35-12/close §35-16 SUDAH ADA — verifikasi & pakai)
   - **Engine approval**: `src/rekankerja/shared/services/approval-engine.ts` (startApprovalChain/decideApprovalChain/getApprovalChain/cancelApprovalChain/resolveApprovalStructure/buildApprovalChain + getEmployeeApprovalParams) — contoh pemakaian: `src/rekankerja/recruitment/services/pr-service.ts` (cara PR submit ke engine + struktur default AS-*) — TIRU polanya utk docType baru `PerformanceAppraisal` (NON-nominal; pemohon= karyawan yang dinilai; L3 hanya bila rating ekstrem/grade — cek bagaimana engine menyatakan level kondisional; bila engine tak mendukung L3-kondisional, buat L3 selalu ada di struktur tapi auto-approve oleh sistem ATAU sertakan L3 hanya saat rating ekstrem saat build chain — pilih implementasi paling bersih & jujur, catat keputusan di worklog).
   - UI: `performance-appraisals.tsx` (P3) + `performance-checkins.tsx` + pola PageHeader/EmptyState/t()/StatusPill/mobile flex-wrap.
   - Grafik: **recharts 2.15.4 tersedia** (pola: `src/rekankerja/time-attendance/components/attendance-reports.tsx` / dashboard-module.tsx).
   - ESS: `ess/api/my-appraisal.ts` + `ess-my-appraisal.tsx` (P3 — sudah ada hasil Published read-only + placeholder acknowledge P4 → SEKARANG implementasikan acknowledge + appeal + withdrawAppeal).
   - Scheduler: `shared/services/scheduler-service.ts` (counter 3 tempat: interface + literal + assignment).
   - Menu: `shared/lib/menu-perms.ts` — menu key `performance:calibration` + `performance:results` SUDAH ADA di rail app-shell (case di performance-module.tsx: "calibration" + "results") — verifikasi & isi.

## SCOPE P4 (§20: dashboard distribusi + BELL CURVE §18.10 + CalibrationSession/Decision audit + docType PerformanceAppraisal di engine + struktur AS-PERF-STD + finalisasi & publikasi + acknowledgement + banding ESS; E2E alur 6–7)

### A. Service `src/rekankerja/performance/services/perf-calibration-service.ts` (BARU)
1. `distribution(db, {cycleId, unitId?})` — bar rating per unit/atasan + rata-rata skor + flag anomali (leniency/strictness/central tendency §8) dari peserta ManagerDone/Finalized/Published.
2. `bellCurve(db, {cycleId, unitId?})` — §18.10: histogram skor (bin per 5 poin) + overlay kurva normal (μ,σ dari data) + tabel z-score per atasan: z=(mean_tim−mean_perusahaan)/σ_perusahaan; D19: z≤−1 "terlalu pelis" amber / z≥+1 "terlalu royal" amber / |z|≥2 merah + deteksi central tendency σ_tim < ½ σ_perusahaan. Hanya peserta ber-skor (ManagerDone+). Toggle sebelum/sesudah kalibrasi (finalScore vs managerScore). Akses: HR + Direksi (atasan hanya kurva timnya — via parameter unitId/managerId dibatasi service layer).
3. `openSession(db, actor, {cycleId, orgUnitId, heldAt, participants:[employeeId], chairId?, notes?})` — HR; peserta atasan-atasan; ActivityLog.
4. `decide(db, actor, {sessionId, appraisalId, newScore?, newRating?, potentialBand?, reason})` — §35-9: alasan WAJIB (tolak bila kosong); peserta harus ManagerDone (atau Finalized via banding-Adjusted — jalur banding); mengubah peserta Published tanpa jalur banding → 400; tulis CalibrationDecision {oldScore→newScore, oldRating→newRating, potentialBand 9-box 1..3} + update AppraisalRecord (bila newScore: finalScore; rating re-lookup RatingScale); every decision ActivityLog. Calibrated flag (status tetap ManagerDone tapi finalScore terisi? — DESAIN: finalScore = hasil kalibrasi; bila belum ada decision maka finalScore=null; potentialBand disimpan).
5. `closeSession(db, actor, sessionId, notes?)` — HR/ketua; menandai sesi selesai (tambah kolom? CalibrationSession tak punya status — gunakan notes + ActivityLog; ATAU tambahkan statusClosed DateTime? di skema? JANGAN ubah prisma — pakai participantsJson meta atau ActivityLog; catat keputusan di worklog).
6. `finalize(db, actor, {appraisalIds | cycleId})` — §35-10: HR/atasan; pasca kalibrasi; per karyawan: buat dokumen approval docType `PerformanceAppraisal` via startApprovalChain (pemohon = karyawan dinilai; L1 atasan → L2 HR → L3 Direktur bila rating final ekstrem 1/5 atau PIP/grade tinggi) → status Finalized menunggu approval; setelah chain Approved (hook di decideApprovalChain? — CEK bagaimana engine memberi tahu selesai: biasanya caller poll status atau ada callback — telusuri pr-service/offer-service) → finalScore/finalRating resmi + ActivityLog. Bila chain Rejected → kembali ManagerDone + alasan.
   PENTING: hasil final (finalScore/finalRating) hanya RESMI setelah approval Approved.
7. Integrasi engine: definisikan struktur default AS-PERF-STD (seed bila belum ada — pola seed struktur rekrutmen; 6-dimensi penempatan karyawan yang dinilai). docType TIDAK nominal (bukan AMOUNT_DOC_TYPES).

### B. Service `src/rekankerja/performance/services/perf-results-service.ts` (BARU)
1. `results(db, {cycleId, unitId?})` — hasil + potentialBand 9-box + acknowledgement status; akses §11.3: HR semua; Direksi agregat/9-box; atasan tim; karyawan via ESS endpoint sendiri.
2. `nineBox(db, {cycleId})` — matriks 3×3 (performance=finalRating, potential=potentialBand) + daftar karyawan per sel (UI klik sel → daftar — §18-6 9-box interaktif).
3. `publish(db, actor, cycleId, {force?})` — §35-12: semua peserta Finalized ATAU force ter-log (force → ActivityLog jelas); status siklus Published + publishAt; notifikasi in-app massal ke tiap peserta (deep-link ess:my-appraisal).
4. `acknowledge(db, employeeId, appraisalId)` — §35-13: hasil Published (cycle status Published); catat acknowledgedAt; ActivityLog. Bukan persetujuan isi.
5. `appeal(db, employeeId, appraisalId, {note, evidence?})` — §35-14: jendela D6 7 hari sejak publishAt; status Appealed + appealNote; ActivityLog.
6. `withdrawAppeal(db, employeeId, appraisalId)` — pengaju sendiri → appealStatus Withdrawn.
7. `decideAppeal(db, actorHR, appraisalId, {decision: Rejected|Adjusted, note, newScore?})` — §35-15: tanpa catatan → 400; Adjusted → CalibrationDecision baru (alasan = catatan keputusan) + finalScore baru; ActivityLog.
8. `closeCycleResults(db, actor, cycleId)` — §35-16: banding selesai semua (tak ada appealStatus Submitted) → status siklus Closed (read-only permanen). (Cycle close gate P1 `close` — verifikasi konsisten / reuse.)

### C. API (tiru pola appraisals.ts P3)
1. `performance/api/calibration.ts` — GET ?cycleId&unitId (distribusi) | ?curve=1&cycleId (bell curve) | ?sessions=1&cycleId (daftar sesi); POST action: openSession|decide|closeSession|finalize (guard performance:calibration + op finalize → tambah MENU_OPS bila perlu).
2. `performance/api/results.ts` — GET ?cycleId (hasil + 9box + ack status); POST action: publish|acknowledge|appeal|withdrawAppeal|decideAppeal|closeResults (guard performance:results; publish/close = op khusus MENU_OPS).
3. Routes re-export ×2 (`src/app/api/rekankerja/performance/calibration/route.ts` + `results/route.ts`).
4. ESS `ess/api/my-appraisal.ts` — EXTEND: POST action acknowledge|appeal|withdrawAppeal (self-scope; hasil Published). GET sudah menampilkan hasil — tambah ack status + jendela banding tersisa.
5. `ess/api/perf-approval.ts`? — TIDAK perlu file baru: approval PerformanceAppraisal muncul di approval inbox EXISTING (pola PR Approval) — VERIFIKASI inbox admin menampilkan docType baru (cek cara pr approval muncul di UI approver;PerformanceAppraisal perlu label + detail view sederhana: skor + rating + alasan keputusan kalibrasi + tombol approve/reject). Bila inbox generik sudah menampilkan docType apapun → cukup metadata; bila perlu mapping label/ikon → tambah di tempat yang sama dgn PR.

### D. UI
1. `performance/components/performance-calibration.tsx` (view "calibration" — case di performance-module.tsx + rail "Calibration" SUDAH ADA): pemilih siklus → TAB Distribusi (bar per unit/atasan + flag anomali) → TAB Kurva Bell §18.10 (recharts: BarChart histogram + Line overlay normal; pilihan lingkup perusahaan/unit/atasan; toggle sebelum/sesudah kalibrasi; tabel z per atasan + flag D19 + central tendency; klik bin → daftar; tooltip edukatif "kurva = lensa kewajaran bukan kuota (D2 OFF)") → TAB Sesi (daftar + buat sesi: unit + peserta atasan + ketua + tanggal + catatan; keputusan per peserta: skor lama→baru + alasan WAJIB + potentialBand 1–3) → TAB Finalisasi (checkbox peserta ManagerDone/Finalized → submit batch → chain status per dokumen) + tombol force-advance cycle? (startCalibration sudah di cycles).
2. `performance/components/performance-results.tsx` (view "results" — rail "Results & 9-Box" ada): TAB Hasil (tabel peserta: skor/rating/ack/banding + aksi publish di toolbar + closeResults) → TAB 9-Box (scatter/grid 3×3 interaktif klik sel → panel daftar; akses HR/Direksi) → detail banding (list appeal + keputusan).
3. ESS `ess-my-appraisal.tsx` — extend: hasil Published → tombol "Saya telah membaca & memahami (acknowledge)" + tombol "Ajukan Banding" (jendela 7 hari + textarea alasan) + status banding + withdraw.
4. Approval inbox: label docType PerformanceAppraisal (cek tempat label PR di UI approval; tambah + ikon; detail minimal).
5. Dwibahasa t() SEMUA; mobile 375 tanpa h-scroll; recharts responsive.

### E. Scheduler + menu-perms
- Menu-perms: performance:calibration ops (decide/finalize?), performance:results ops (publish/close/appeal-decide) — ikuti pola P1-P3 (op hanya utk aksi berat).
- Scheduler: TIDAK wajib P4 (jendela appeal berjalan lazy dari publishAt — hitung saat cek). Bila mau tambah job pengingat banding mendekati tutup — OPSIONAL, skip bila ribet.

## LINGKUNGAN & BATASAN (P0–P3, WAJIB dipatuhi)
- Skema P0 ADA: CalibrationSession/Decision/PotentialBand di AppraisalRecord — JANGAN ubah prisma (KalibrasiSession: id,cycleId,orgUnitId,heldAt,participantsJson,chairId,notes; CalibrationDecision: sessionId,appraisalId,oldScore,newScore,oldRating,newRating,reason,decidedById,potentialBand? — BACA persis di schema-tenant.prisma).
- **GATE TSC**: bunx tsc OOM. Buat `tsconfig.p4.json` (extends; include performance/** + ess wiring + scheduler + approval-engine + pr-service referensi JANGAN dimasukkan semua — cukup file yang disentuh + graf importnya; pola p3a/p3b bila perlu pecah) → `node --max-old-space-size=1400 ./node_modules/typescript/bin/tsc --noEmit --project tsconfig.p4.json` = 0.
- lint 0 error (6 warning baseline); audit-bilingual ≤150 (t() semua).
- Dev server :3000 jalan (jangan restart). Cek dev.log.
- JANGAN commit/push. JANGAN parity via bun CLI. JANGAN ubah skema.
- Login admin hrd@mii.co.id/onevity123 (OWNER superadmin); ESS yusuf@mii.co.id/EssDemo123! (+ reviewer rina360/agung360@mii.co.id / EssDemo123!).
- DATA MII SAAT INI: PER-2026 Assessment feedback360=true: Dedi ManagerDone 70.65 + Yusuf ManagerDone 77.63 + 41 Enrolled (belum lock — TIDAK bisa dinilai); PER-2025 Closed 12 peserta finalScore terisi (bagus utk uji bell curve data historis). UTK E2E alur 6-7 perlu lebih banyak peserta ber-skor: buat siklus uji "PER-2026-CAL" via API (create→enroll 8-12 karyawan lintas 3-4 atasan→openGoal→assign KPI dari pustaka per peserta (assignBatch — kini resolve judul otomatis dari kpiDefId!)→lockGoals→startOngoing→startAssessment→submitSelf+submitManager per peserta via API dgn skor VARIATIF termasuk 1 atasan pelis (semua nilai rendah) & 1 royal (semua tinggi) supaya z-flag D19 terdeteksi) — bersihkan/atau pertahankan sesudahnya (pertahankan OK — data demo bagus utk P5+; catat di worklog).
- Engine approval: telusuri dulu approval-engine.ts + pr-service.ts SEBELUM desain finalize (jangan asumsi API). approval inbox UI: temukan cara PR tampil (grep docType 'RecruitmentPR' / approval-inbox component).
- 9-box & hasil = akses ketat §11.3 (karyawan TIDAK melihat 9-box; Direksi agregat).

## URUTAN KERJA
baca referensi+skema+engine → service A (calibration) → B (results) → integrasi engine (AS-PERF-STD seed + finalize) → API C → UI D → E → gate tsc scoped + lint + audit → smoke test (API + browser ringan: login admin, buka Kalibrasi & Hasil, bell curve render) → data uji CAL → append worklog.

## WORKLOG (WAJIB append /home/z/my-project/worklog.md, jangan overwrite):
```
---
Task ID: P4-impl
Agent: fullstack-developer
Task: <ringkasan>

Work Log:
- <langkah>

Stage Summary:
- <hasil+file+keputusan desain+keterbatasan>
```

## LAPORKAN BALIK
file+baris; keputusan desain (terutama: integrasi engine L3-kondisional, closeSession tanpa kolom status, finalize batch); hasil gate; smoke test; data uji CAL yang dibuat; keterbatasan; apa yg perlu E2E orchestrator.
