# B5 BRIEF — Benchmark gaji (DEVELOPMENT-PLAN-BACKLOG.md §4 B5, D-BL16–D-BL17/D-BL18)

Anda = subagent proyek RekanKerja (HR SaaS multi-tenant, Next.js 16 App Router + Prisma + PG embedded, /home/z/my-project). Kerjakan fase B5 END-TO-END hingga commit + push.

## WAJIB SEBELUM MULAI
1. Baca `/home/z/my-project/worklog.md` — header aturan proyek + 4 entri terakhir (B1–B4); ikuti semua konvensinya.
2. Baca `/home/z/my-project/DEVELOPMENT-PLAN-BACKLOG.md` — §2 D-BL16/D-BL17/D-BL18, §3 model `SalaryBenchmark`, §4 baris B5, §5 risiko "Benchmark bocor ke karyawan".
3. Modul Training TIDAK BOLEH disentuh/dibuat (perintah user — exclude permanen).

## LINGKUNGAN (SUDAH SIAP — JANGAN ULANGI PEMULIHAN)
- Dev server JALAN di :3000 (watchdog aktif; JANGAN `bun run build`; jangan bunuh dev server). Log: `dev.log`.
- PG embedded :5432; 3 tenant terpulihkan (MII = `tenant_pt_mitra_industri_internasional`, 46 karyawan, grade G1–G8, PER-2026-CAL Published). Login: owner HR `hrd@mii.co.id/onevity123` · ESS `yusuf@mii.co.id/EssDemo123!`. Direksi MII: CEO Hartono MII00001, HR Director Sri MII00002 — pola `isDirectorTitle` di `src/rekankerja/performance/services/talent-service.ts`.
- Uang: `EmployeeAssignment.baseSalary` enc:v1:n — baca via `tc.decryptMoney()` (lihat talent-service.ts ~baris 230–240 pola compa midpoint). MoneyVault BARIS = 0 → mode LEGACY (semua aktor canSee=true — perilaku pra-vault terdokumentasi di `src/rekankerja/shared/lib/money-view.ts`).
- Memori 4GB (dev server ~2,5GB). tsc WAJIB scoped: `NODE_OPTIONS="--max-old-space-size=2000" ./node_modules/.bin/tsc --noEmit -p tsconfig.b5.json`. Jangan proses berat paralel.

## A. SCHEMA + MIGRASI (pola B4 — lihat git show 9244e81)
1. `prisma/schema-tenant.prisma`: model `SalaryBenchmark` persis §3 (year Int, sourceLabel, gradeCode?, positionId?, currency default "IDR", p25/p50/p75 Float, @@unique([year, sourceLabel, gradeCode, positionId]), @@index([year, gradeCode])) + relasi Position RESTRICT. Catatan: unique 3-kolom nullable di PG = NULL-distinct → guard duplikat NULL-aware di SERVICE → 409.
2. `prisma/tenant-ddl.sql`: tabel + index + FK (pola SuccessionPosition baris 3565+).
3. `scripts/migrate-performance-b5-benchmark.ts`: idempoten, loop semua schema tenant dari registry, `main(schemas?)` exportable — pola persis `migrate-performance-b4-succession.ts`. Jalankan → verifikasi 3 tenant.
4. `src/rekankerja/shared/lib/parity-runner.ts`: step `{ key: "backlog-b5", label: "B5 Backlog — tabel benchmark gaji", ... }` setelah backlog-b4 (baris ~417–423).

## B. SERVICE `src/rekankerja/payroll/services/benchmark-service.ts` (pola succession-service.ts)
- AKSES (pola D-BL12): baca = HR/admin (`talentHrActor` dari talent-service — sudah di-export) ATAU Direksi (`isDirectorTitle`); selain itu 403 `BenchmarkError`. MUTASI/impor/hapus = HR/admin SAJA (Direksi read-only).
- CRUD `upsert(year, sourceLabel, gradeCode?, positionId?, currency, p25/p50/p75)`: p25≤p50≤p75>0; tahun 2000–2100; gradeCode harus ada di Grade.code aktif ATAU positionId valid; keduanya null → 400; keduanya terisi → 400 (pilih satu kunci); duplikat NULL-aware → 409. `delete(id)` → 200. `list(year?, sourceLabel?)` urut year desc, sourceLabel, kode.
- TEMPLATE: `buildBenchmarkTemplateXlsx(lang)` — sheet dwibahasa (ID: Tahun|Label Sumber|Kode Grade|Kode Posisi|p25|p50|p75|Mata Uang; EN: Year|Source Label|Grade Code|Position Code|p25|p50|p75|Currency) + baris contoh + sheet petunjuk.
- IMPOR D16 (pola persis `importTargetsPreview/Commit` di performance services): .xlsx ≤2MB, ≤500 baris; preview VALIDASI PER SEL; commit HANYA baris valid; error per sel {rowNo, cells, errors:[{col,reason}]}; baris kotor tidak membatalkan baris lain; duplikat in-file vs db ditandai.
- KOMPA-RATIO (D-BL17): per karyawan Active + assignment aktif — match p50 urut: (1) gradeCode = grade assignment; (2) positionId = posisi assignment; (3) fallback = TIDAK ADA → ratio null + chip "belum ada benchmark" (JANGAN fabrikasi). Selector year+sourceLabel (default = year max + sourceLabel createdAt desc). ratio = decryptMoney(baseSalary)/p50 (2 desimal). band: ratio < p25/p50 → "Below p25"; > p75/p50 → "Above p75"; else "Within band". Output per karyawan `{employeeNo, fullName, unit, positionTitle, gradeCode, ratio, band, p50, matchedKey, baseSalaryNominal?}` — `baseSalaryNominal` HANYA bila `MoneyView.canSee` (thread `moneyViewForReq` — lihat `src/rekankerja/shared/lib/money-view-req.ts`; masked → null → UI "—"). Stats: distribusi band 3 angka + rata-rata ratio + jumlah tanpa benchmark.
- LAPORAN `exportBenchmarkXlsx(lang)`: 2 sheet dwibahasa (ID "Ringkasan Kompa-Ratio" + "Master Benchmark"; EN "Compa-Ratio Summary" + "Benchmark Master"); kolom nominal di-omit bila masked; pakai `toXlsxMulti/exportFilename/xlsxResponse` (pola D-BL15 succession).
- ACTIVITYLOG semua mutasi (pola B1 — action BenchmarkUpsert/BenchmarkDelete/BenchmarkImport/BenchmarkExport).

## C. API `src/rekankerja/payroll/api/benchmark.ts` + `src/app/api/rekankerja/payroll/benchmark/route.ts`
- GET `?list=1&year=&sourceLabel=` register; `?template=1&lang=` xlsx; `?dashboard=1&year=&sourceLabel=` `{stats, rows, context{year, sourceLabel, sources[]}}`; `?sources=1` daftar unik.
- POST multipart `action=importPreview`; POST `{action:importCommit, rows}`; `{action:upsert|delete|exportXlsx}`.
- MENU GUARD key BARU `"payroll:benchmark"` — tambah di `menu-perms.ts` + MENU_OPS: `import` "Mengimpor benchmark gaji (XLSX)", `manage` "Mengelola master benchmark", `export` "Mengekspor laporan benchmark" (pola performance:talent baris ~243). requireMenuViewAny utk GET; requireMenuAction per aksi POST. Error map → status.

## D. UI `src/rekankerja/payroll/components/payroll-benchmark.tsx` (pola performance-talent.tsx B4)
- Judul "Benchmark Pasar Gaji" / EN "Salary Market Benchmark" + chip "PAYROLL · B5".
- BANNER disclaimer amber: benchmark = data eksternal manual HR (impor survei); kompa-ratio alat analisis — BUKAN dasar otomatis kenaikan gaji (mitigasi §5).
- Selector tahun + sumber + refresh; 3 tile statistik band + rata-ratio + chip tanpa-benchmark.
- TABEL MASTER register (tahun, sumber, kunci, p25/p50/p75, aksi edit/hapus HR) + dialog upsert + tombol "Impor XLSX" (template download → upload multipart → preview per sel error merah → "Commit N baris valid") — pola UI importTargets di performance components.
- TABEL KOMPA-RATIO per karyawan (nama, unit, posisi, grade, ratio badge, band, p50, gaji nominal bila canSee (null → "—"), kunci match chip, "belum ada benchmark" chip; filter unit + cari nama + filter band).
- Tombol "Ekspor XLSX". Mobile <640px kartu; desktop tabel. Dwibahasa `t()` BASE_EN penuh — JANGAN kata Inggris dalam string ID (ingat fix B4: Coverage→Cakupan).
- WIRING: `app-shell.tsx` PAYROLL_NAV grup baru "Analisis Pasar" setelah "Master Data" `{id:"benchmark", label:"Benchmark Pasar", icon: Scale}`; `payroll-module.tsx` case "benchmark"; `user-access-view.tsx` MENU_OPS_LABEL_EN + HINT_EN 3 op baru (pola diff B4 baris 1150+).

## E. E2E `scripts/e2e-b5-benchmark.ts` (pola e2e-b4-succession.ts: class Sesi, login owner, ESS yusuf, db getTenantClient(SCHEMA))
1. Template download → PK + sheet dwibahasa.
2. Impor FILE VALID (buffer XLSX via exceljs di skrip: 8 baris grade G1–G8, sourceLabel "E2E-SURVEI", tahun 2026, p25<p50<p75) → preview 0 error → commit → 8 inserted → register memuat 8.
3. Impor FILE KOTOR (8 baris: grade tak-ada; p25>p50; p50 negatif; tahun "abc"; tanpa kunci; duplikat vs db; currency "XYZ"; 1 valid baru source berbeda) → preview error PER SEL per baris (assert ≥5 baris ber-error dgn kolom+alasan) → commit → hanya baris valid masuk (count delta tepat).
4. KOMPA-RATIO deterministik: 2 karyawan via db (Tuti MII00013 G2 + Hartono MII00001 G8) — p50 dari db + decryptMoney baseSalary → ratio dihitung MANUAL di skrip (TIDAK impor helper service) → assert API ratio sama ±0.01 + band benar + matchedKey=grade; verifikasi ≥1 baris "belum ada benchmark" (buat 1 karyawan dummy tanpa grade bila semua ber-grade — lalu cleanup).
5. AKSES: ESS yusuf GET dashboard/list + POST upsert/export → 403 semua (menu guard admin-only).
6. Export XLSX id+en → PK + filename benchmark + sheet dwibahasa (exceljs load).
7. Nominal: response dashboard utk owner (legacy canSee) memuat baseSalaryNominal number ≥1 baris (verifikasi threading money-view).
8. CLEANUP: deleteMany SalaryBenchmark "E2E-SURVEI" + semua uji → count 0.
Format ✓/✗ + HASIL n/n + exit code; ulangi hingga PASS.

## F. GATES (semua wajib hijau)
- tsc: buat `tsconfig.b5.json` (pola tsconfig.b4.json — include payroll + shared + route benchmark + e2e/migrate b5) → 0 error.
- `bun run lint` = 0 error (6 warning baseline).
- `bun scripts/audit-bilingual.ts` → TOTAL_GAP=150 (tak boleh naik).
- dev.log bersih (401 unauth = normal).
- E2E PASS penuh.
- BROWSER (agent-browser CLI): login hrd → Payroll → tab "Benchmark Pasar" EN: banner + 3 tile + selector + tabel register + tombol Impor; ID dwibahasa penuh; mobile 375×812 hscroll=0 (eval scrollWidth vs clientWidth); console 0 error baru (dup-key "Male" = baseline); 2–3 screenshot → `audit/e2e-b5/*.png` (mkdir dulu). Data uji browser dibersihkan.

## G. WORKLOG + COMMIT + PUSH
- Append `worklog.md` (JANGAN timpa): entri Task ID B5 format B3/B4 (Work Log konkret + Stage Summary); `git add -f worklog.md`.
- SATU commit gaya B4 (`git log -1 9244e81`): "B5 backlog: benchmark gaji per DEVELOPMENT-PLAN-BACKLOG.md §4 B5 D-BL16..17 — … ; E2E n/n …; bilingual 150 + tsc b5 0 + lint baseline + browser …".
- `git push origin main`.
- LAPOR ke orchestrator: ringkasan + semua hasil gates + nomor commit + E2E n/n + screenshot list + SEMUA penyimpangan/keputusan.

## DISIPLIN
- JANGAN ubah kode di luar cakupan B5 (kecuali wiring: menu-perms, app-shell, payroll-module, user-access-view, parity-runner, tenant-ddl, schema-tenant).
- JANGAN buat modul training; jangan sentuh migrasi fase lain.
- Context hampir habis → PASTIKAN checkpoint commit (`git add -A && git commit -m "B5 WIP checkpoint"`) + append worklog status SEBELUM berhenti.
- DialogContent `sm:max-w-*`; i18n `t()` BASE_EN; isolasi tenant via requireTenant; ActivityLog semua mutasi.
- Bug kode fase lain → catat di worklog "Catatan orchestrator", jangan perbaiki (kecuali memblokir B5).
