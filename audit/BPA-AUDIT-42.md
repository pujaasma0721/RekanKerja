# BPA AUDIT 42 — Audit Menyeluruh Sisa Area (rekonstruksi)

> **STATUS PERBAIKAN (Task 43 "perbaiki semua" — selesai):** 7/7 KRITIS fixed &
> terverifikasi; 19/21 MAJOR fixed (M-4 terverifikasi bukan-bug; M-8 & M-9
> ditunda ke Task 44); minor terpilih + follow-up ikut fixed. Rincian bukti &
> lokasi per-item: lihat worklog.md entry 43-a s.d. 43-FINAL. Commit ini
> (belum di-push).

> Status: temuan diverifikasi read-only oleh 6 subagent paralel (42-a..42-f) di atas
> task 41 (06082dc). Laporan asli hilang pada rollback snapshot (tidak ter-commit);
> direkonstruksi dari koordinasi tersimpan, lalu di-commit bersama Task 43 (perbaiki semua).
> Konfirmasi ulang per-item dilakukan oleh agen fix sebelum menyentuh kode (verify-then-fix).

## Ringkasan

- **7 KRITIS** (K-1..K-7), **21 MAJOR** (M-1..M-21), ~35 minor, 15 gap fitur.
- **Aman (jangan dirusak)**: isolasi multi-tenant (tenant dari session+membership, input
  klien diabaikan), HMAC session + sessionVersion + MFA, MIME whitelist + 5MB + path UUID,
  payslip PDF AES-256, enkripsi core payroll 28-c (20 field, 4.2µs decrypt), buildRunRows
  batching, upsert idempoten + advisory mutex payroll, 14 unique constraint terpasang,
  journal-no advisory lock, modal width clean (task 39), PWA network-first.

## KRITIS

| ID | Temuan | Lokasi | Fix |
|----|--------|--------|-----|
| K-1 | IDOR lampiran: GET stream file hanya `requireTenant` (anggota tenant apapun bisa baca lampiran ID manapun). DELETE/PUT di file sama punya guard — hanya GET/list yang bolong. | `src/onevity/shared/api/attachments-id.ts:22-55` + `attachments.ts:112-130` (list) | Guard menu (`ATTACHMENT_ENTITY_MENUS`) ATAU kepemilikan (`actor.employeeId`/pengunggah) — pattern 4-level di DELETE file sama; reference `employee-documents.ts:57` (requireScoped). |
| K-2 | Ekspor finansial tanpa guard menu: bank-transfer (rekening terdekripsi), SPT (NPWP), jurnal. | `payroll/api/payroll-run-export.ts:10-15`, `payroll-spt.ts:12-14`, `payroll-journals.ts:9-13` | `requireMenuAction(req,"payroll:runs","view"/"op:export")` — reference `reports-bpjs.ts:210`. |
| K-3 | PATCH karyawan menyimpan NIK/NPWP/rekening PLAINTEXT (write-path tak ikut 28-c). | `hr/api/employee-detail.ts:152-156,214-242` | Enkripsi via `payroll-profiles.ts:84-96` pattern + flatten return + sanitize import-by-query-id. |
| K-4 | EmailLog menyimpan body penuh: password plaintext ({{password}}) & THP ({{net}}) → bocor via log DB. | `email-service.ts:139-144,236,309`; template `app-users.ts:119-122`, `email-defaults.ts:93-96` | Redact sebelum persist (mask `{{password}}`→`***`, `{{net}}`→`***`). |
| K-5 | GET ESS attendance memicu `regenerateRange` SELURUH perusahaan per request karyawan. | `ess/api/attendance.ts:43-47` | Scope per employeeId → queue ke scheduler, batch holidayOn + `in [...]`. |
| K-6 | `PARITY_STEPS` tidak memuat migrasi 41 (scheduler-race, webhook-retry) → panel Webhook 500 di prod fresh. | `src/onevity/shared/lib/parity-runner.ts` | Tambah step + update DEPLOY-RUNBOOK. |
| K-7 | Skrip migrasi tanpa dotenv → fallback sandbox bila env kosong. | `scripts/migrate-*.ts` (env tanpa fallback aman) | Source .env di entry skrip + runbook. |

## MAJOR

| ID | Temuan | Lokasi | Fix |
|----|--------|--------|-----|
| M-1 | Cookie tanpa `Secure`/`SameSite` ketat | `auth.ts:128-135` | Secure di prod (NODE_ENV/https), SameSite=Lax (API same-origin). |
| M-2 | Token default demo di seed prod-facing | `demo-seed.ts:26,36-38` | Gating: default hanya dev. |
| M-3 | `/api/auth/register` tanpa rate limit | register route | In-memory limiter (IP+email). |
| M-4 | `recordPasswordSet` mencari AppUser lintas workspace | `password-security.ts:106-111` | Scope by schema (db tenant sudah per-schema — pastikan query pakai db tenant, bukan platform). |
| M-5 | MIME whitelist tanpa magic-number check | `attachment-service.ts:60-74` | Header byte check (PNG/JPG/PDF/DOCX minimal). |
| M-6 | claims GET hanya `requireTenant` (medical/travel/absence-export) | `medical/api/claims.ts:21`, `travel/api/claims.ts:21`, `absence-export.ts:14` | requireMenuAction ("medical:claims"/"travel:claims"/"attendance") view. |
| M-7 | `resolveMenuPerms` default terbuka saat menu tak terdaftar | `menu-access.ts:132` | Default deny + allowlist eksplisit. |
| M-8 | ±22 kolom uang masih plaintext (medical/travel/leave/overtime/benefit) | schema tenant | Gelombang enkripsi kedua (Float→String) — BESAR, tugas terpisah (Task 44). |
| M-9 | PII Employee plaintext (alamat, telp, kontak darurat, bank) | schema Employee | scope-aware list (design 42-e: `requireScopedList` + bypass ApprovalChain InProgress). |
| M-10 | Kunci enkripsi tanpa fail-fast prod (fallback deterministik) | `field-crypto.ts:58-74` | Throw bila NODE_ENV=production & ONEVITY_ENCRYPTION_KEY kosong. |
| M-11 | `/employees` over-expose (semua kolom PII ke semua anggota) | hr/api/employees | Field selection by role/scope. |
| M-12 | Amount di ActivityLog/Notification/Email subject plain | berbagai service | Redact/mask di tempat menulis. |
| M-13/14 | N+1: clocking list, attendance-service, leave balances, medical-service | `api/clocking.ts:87`, `attendance-service.ts:1955`, `leave-service.ts:405-438`, `medical-service.ts:392-444` | include/groupBy batch. |
| M-15 | 4 index hilang: PayrollRun.periodId, EmployeeComponentAssignment, MedicalClaim.employeeId, MedicalClaimLine.receiptNo | prisma/schema-tenant.prisma | @@index + db push (terverifikasi Seq Scan). |
| M-16 | List tanpa batas (leave/balances 319KB) | leave/api/balances | Pagination default + param. |
| M-17 | Transfer karyawan non-transaksional | `attendance-service.ts:887-917` | Wrap $transaction. |
| M-18 | 500 payslip PDF+SMTP sinkron di confirm run | `payroll-runs.ts:300` | Background queue bertahap. |
| M-19 | Connection pool vs max_connections=100 | tenant-db.ts pool | connection_limit turunkan / dokumentasi kapasitas. |
| M-20 | PayrollRun soft-duplicate (tanpa unique period+type aktif) | `payroll-runs.ts:68-88` | Unique partial `WHERE status<>'Cancelled'` + friendly 409. |
| M-21 | medical balances bocor katalog seluruh karyawan ke non-HR | `medical/api/balances.ts:26-31` | `db.employee.findMany({where: scopeWhere})`. |

## Urutan Perbaikan (Task 43)

1. **Batch 1 — IDOR/read guard**: K-1, K-2, M-6, M-7, M-21
2. **Batch 2 — PII/enkripsi write-path**: K-3, K-4, M-10, M-11, M-12 (mask), webhook key mask
3. **Batch 3 — Auth hardening**: M-1, M-2, M-3, M-4
4. **Batch 4 — Perf/integrity**: K-5, M-15, M-17, M-20, M-13/14 terpilih, M-16, M-18
5. **Batch 5 — Ops/deploy**: K-6, K-7, /api/health, logrotate runbook
6. **Batch 6 — Minor terpilih**: M-5, M-19
7. **Batch 7 — Gelombang enkripsi kedua (M-8)**: tugas terpisah (Task 44) — Float→String ±25 kolom + migrasi + serializer.
8. **Batch 8 — Fitur**: M-9 scope-aware PII (design 42-e), G-04 warning coverage absensi — tugas terpisah.

Aturan mutlak: verify-then-fix (kode mungkin sudah berubah di task 41), jangan
rusak bagian "Aman" di atas, error map 403/409 konsisten, modal `sm:max-w-*`,
i18n BASE_EN bila menambah label UI.
