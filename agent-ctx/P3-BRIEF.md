# TASK P3 — Penilaian & 360 (Modul Performance RekanKerja HRIS)

Brief lengkap fase P3 untuk subagent fullstack-developer (Task ID: P3-impl).
Sumber otoritatif: DEVELOPMENT-PLAN-PERFORMANCE.md §16/§17/§11.3/§18-4~7/§18-11/§18-12/§29/§35-7,8,27,30,31,32/§36/§21.

## Scope yang didelegasikan
- **Service** `perf-appraisal-service.ts`: listAppraisals/appraisalDetail (row-level §11.3), ensureCompRows (idempoten: template→fallback kompetensi aktif), submitSelf §35-7, saveManagerScore (autosave §18.7), submitManager §35-8 + formula skor §16 server, pullAutoSources §18.6 (6 binding), buildActualsTemplateXlsx + importActualsPreview/Commit (D16 §35-27), previewImpact §18.12/§35-31 (stateless, tanpa Rp), aiCompose §18.11/D20/§35-30 (compose-only, rate-limit 20/jam/user via ActivityLog entityId=actorKey, kegagalan tenang).
- **Service** `perf-360-service.ts`: inviteReviewers (guard feedback360 + dedupe unique + reviewer≠peserta), myInvitations, decline, submit360 (anonim), aggregate360 (komentar hanya ≥3 reviewer/kategori), expireOverdue (scheduler), remindReviewer.
- **API**: performance/api/appraisals.ts + feedback360.ts + routes re-export; ess/api/my-appraisal.ts + my-360.ts + routes (requireEss self-scope).
- **UI**: performance-appraisals.tsx (form atasan §18-4 penuh: tabel KPI + tarik per baris + pratinjau massal + impor 3 langkah + grid kompetensi + AI compose + ringkasan 360 + panel estimasi dampak sticky + autosave + progress bar + submit keras), ess-my-appraisal.tsx, ess-my-360.tsx + wiring (ess-shell nav "Penilaian Saya"/"360 Saya", performance-module case appraisals, menu-perms op import/pull, scheduler job perf-360-expire + counter 3 tempat).
- **Gate**: tsconfig.p3a/p3b scoped @1400MB (tsc full OOM exit 137 — pola p2a/b/c), lint 0 error/6 warning, audit-bilingual ≤150.

## Batasan lingkungan (dari pengalaman P0–P2)
Login admin hrd@mii.co.id/onevity123 (OWNER=superadmin); ESS yusuf@mii.co.id/EssDemo123!. JANGAN ubah prisma (skema P0 lengkap). JANGAN commit/push (orchestrator). JANGAN parity via bun CLI. z-ai-web-dev-sdk server-side via zai-client.ts (fallback tenang wajib).

## Hasil (lihat worklog P3-impl + P3 untuk detail)
Implementasi selesai + 2 bug perbaikan (i18n interpolasi, noise float exceljs) + gates hijau + smoke test 14 PASS + 4 guard negatif. Verifikasi E2E orchestrator menemukan & memperbaiki 3 bug tambahan: penomoran docNo lintas-siklus (tabrakan unique), guard hole lockGoals 0-KPI, assignBatch judul wajib meski kpiDefId ada.
