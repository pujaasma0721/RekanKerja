# Task 4-DEMOGRAFI — full-stack-developer subagent

## Task
Lengkapi Laporan HR tab Demografi (user complaint: "Laporan HR-demografi tidak lengkap"): tambah 7 dimensi baru di API + XLSX export + UI (chart pendidikan, 8 kartu distribusi, cross-tab gender×status, section headers).

## Files edited
- `src/rekankerja/human-resource/api/reports.ts` (API — BUILD 1)
- `src/rekankerja/human-resource/components/hr-reports-view.tsx` (UI — BUILD 2)

Tidak menyentuh file milik agent paralel (letters*, employee-wizard, actions-module, pa-detail, offboarding*, employee-module, personnel-actions*, app-shell, i18n-core, prisma schemas).

## API (reports.ts)
- Query employee select diperluas: `bloodType`, `positionLevelId`, `gradeId`, `companyOfficeId`, `education { level }`; Promise.all +4 master lookup (OrgUnit semua level, PositionLevel, Grade, CompanyOffice).
- `demografi` payload: SEMUA key lama utuh (gender, ageBuckets, employmentStatus, marital, religion) + baru:
  - `education`: bucket jenjang TERTINGGI per karyawan dari EmployeeEducation (EDU_RANK: S3=6..SMA/SMK/SD/SMP/Paket A/B=2, D1–D4=3); label fixed "S3"→"Tanpa data" (urutan tetap dari API; "Tanpa data" hanya muncul bila >0; semua bucket selalu hadir walau 0 — konsisten pola ageBuckets).
  - `orgUnits`: unit efektif (assignment aktif ?? snapshot orgUnitId — sumber sama dengan LifeRow.unitId/tabel divisi) → OrgUnit.name; null → "Tanpa data".
  - `positionLevels` / `offices`: snapshot employee → PositionLevel.name / CompanyOffice.name; null → "Tanpa data".
  - `grades`: `${code} — ${name}` (fallback code saja); null → "Tanpa data".
  - `bloodTypes`: label "Gol. {X}"; null/kosong → "Tanpa data".
  - `genderByStatus`: cross-tab 2 baris (Laki-laki/Perempuan) × 5 kolom status (Permanent/Probation/Contract/Outsourcing/"Tanpa data"); status dari `assignments[0] (validTo=null).employmentStatus ?? null` — sumber SAMA dengan employmentStatus lama; gender F→Perempuan, selain itu Laki-laki.
  - Base set & scoping: tetap `active` (status==="Active") dalam `scopeWhere` — tidak berubah.
  - Sort: distNd = count desc + label asc (education = urutan fixed).
- XLSX `?export=demografi`: 5 sheet lama UTUH + 7 sheet baru (Pendidikan, Unit Organisasi, Level Jabatan, Grade, Kantor, Golongan Darah, Gender x Status dgn kolom Total + baris TOTAL) — gaya sheet sama (toXlsxMulti/ExportSheet, kolom {header,width}, angka number).

## UI (hr-reports-view.tsx)
- Interface ReportsData.demografi + 7 key baru + GenderStatusRow; DemografiTab diekstrak jadi komponen (gender donut + age bar tetap di atas tab).
- SectionLabel baru: "PROFIL KARYAWAN" (gender, usia, pendidikan, gender×status, pernikahan, agama, gol. darah) & "KOMPOSISI ORGANISASI" (status kepegawaian, unit, level, grade, kantor) — uppercase text-[11px] tracking-wide text-stone-400 + hairline.
- "Pendidikan Terakhir": BarChart pola identik chart usia (chart-1, radius [6,6,0,0], maxBarSize 42, h-44); XAxis tickFormatter compact ("Diploma (D1–D4)"→"D1–D4", "SMA & Sederajat"→"≤ SMA"/"≤ HS") — tooltip tetap label full; UI re-sort defensif pakai EDU_ORDER module-scope.
- GenderStatusCard: tabel shadcn ui Table, header bg-stone-50, text-xs, kolom status + TOTAL bold (font-extrabold), baris TOTAL bold bg-stone-50/60; kolom "Tanpa data" auto-hidden bila semua 0; nol di-dim (stone-300); overflow-x-auto.
- DistCard: cap 12 baris + "{n} kategori lainnya · {m} karyawan" (border-t dashed); label "Tanpa data" di-translate t("Tanpa data","No data"); grid sm:grid-cols-2 lg:grid-cols-3.
- i18n inline 2-arg t("ID","EN") semua label baru; i18n-core TIDAK diubah.

## Keputusan kunci
- `orgUnits` pakai unit efektif assignment-aktif (konsisten tabel per-divisi; di data demo identik dgn snapshot — 0 mismatch).
- Blood type label "Gol. A" (pilihan pertama spec) — dipakai konsisten JSON + XLSX; netral bahasa cukup karena judul kartu di-translate.
- Education bucket fixed order dikembalikan API; UI re-sort defensif.
- Sheet name "Gender x Status" (hindari char non-ASCII di nama sheet).

## Verifikasi (curl + agent-browser + VLM)
- login hrd@mii.co.id → select-tenant MII → GET /api/rekankerja/hr/reports 200: education [S3:0,S2:3,S1:6,Diploma:1,SMA:5,Tanpa data:27], orgUnits 16 unit (Assembly Line 17 …), grades "G1 — Officer" 24 …, bloodTypes Gol. A 12 …, genderByStatus L=23+2 / P=12+5 = 42 = headcount = gender dist (25/17) ✓.
- Export XLSX 200 (16.8KB, 12 sheet benar urutan; sheet Gender x Status berisi 2 baris + TOTAL 35/2/5/0/0/42).
- Browser E2E: Demografi tab render penuh; VLM desktop 1440px: EXCELLENT 9/10 (semua elemen ada, axis pendidikan terbaca, tanpa overlap); EN locale: "EMPLOYEE PROFILE"/"ORGANIZATIONAL COMPOSITION"/"Highest Education"/"No data"/"4 more categories · 4 employees" ✓; mobile 390px: single column, A-grade, no breakage; 0 error console/page; dev.log bersih (GET / 200, reports 200).

## Catatan environment (penting utk agent berikut)
- Dev server MATI saat task ini mulai (proses ter-reap saat reset session 07:14; bukan ulah task ini). Dihidupkan ulang via `bash -c 'setsid nohup bash watch-dev.sh </dev/null >>/dev/null 2>&1 &'` — double-fork agar lolos reaper antar-invocation Bash tool (spawn langsung + setsid biasa tetap dibunuh). Watchdog PID 16405 hidup, server listen 3000, page 200 lintas invocation.
- next-server mem ~2GB RSS saat compile (total RAM 4GB) — OOM killer pernah membunuh next-server di boot sebelumnya; hindari menjalankan build/compile berat paralel.

## Risiko
- Karyawan aktif tanpa baris EmployeeEducation muncul sebagai "Tanpa data" besar (27/42 di demo) — mendorong pengisian data pendidikan lewat wizard; bukan bug.
- Kolom Outsourcing cross-tab tetap tampil walau 0 (by design, hanya "Tanpa data" yang auto-hide).
