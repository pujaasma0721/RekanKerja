# Task ID: PERF-FIX-OV — full-stack-developer (overview rebuild)

## Task
Rebuild Performance module Overview page from dev-phase roadmap (P0–P9/B1–B4, "fase terverifikasi 14/14" progress bar, "Rencana Eksekusi Fase" card) into an informative business dashboard — replicating the REC-OV recruitment overview gold standard.

## Work log (condensed — full record in /home/z/my-project/worklog.md, entry Task ID: PERF-FIX-OV)

1. Read worklog tail (REC-OV + PERF-AUD-2e) and studied gold-standard files:
   - `src/rekankerja/recruitment/services/overview-service.ts` (one aggregate, parallel count/groupBy)
   - `src/rekankerja/recruitment/api/overview.ts` + route mount pattern
   - `src/rekankerja/recruitment/components/recruitment-overview.tsx` (KPI click-nav via useNav, layout)
   - Performance domain: perf-cycle-service (7-phase state machine, APPRAISAL_LOCKED), performance-reports.ts (ACTIVE_CYCLE, money vault pattern via moneyViewForReq, okr helpers currentQuarter/objectiveScore), schema-tenant.prisma model/state comments.

2. Created `src/rekankerja/performance/services/perf-overview-service.ts`
   - `overviewFor(db, { canSeeMoney })` returns ALL dashboard data in ONE call.
   - Cycle picked = newest active (ACTIVE_CYCLE mirrors performance-reports) else latest, else empty-state zeros.
   - Parallel count/groupBy only (no N+1): participants, appraisal pipeline by status, goals health (APPRAISAL_LOCKED/SELF_DONE mirrors, KPI actuals), check-ins (held30d/upcoming/missed), 360 counts by status only (anonymity ≥3 — no reviewer identities/scores), calibration sessions/decisions, PIP counts by status (aggregates only), probation open/dueSoon≤14d/overdue, merit byStatus + Applied total decrypted ONLY when canSeeMoney (returns `money: { canSee }`), OKR quarter summary only when PerformanceSetting.okrEnabled (reuse exported okr-service helpers), last-8 ActivityLog feed with sanitizeDetail (Rp → "Rp •••" since ActivityLog is not vault-gated; also strips internal "§x.y" refs and "(D9)/(D-BL7)/(AMn)" decision codes — display only, DB untouched).
   - Take-caps: 200 cycles / 500 merit / 8 activity / 200 OKR.

3. Created `src/rekankerja/performance/api/overview.ts` + `src/app/api/rekankerja/performance/overview/route.ts`
   - GET only, guard `requireMenuViewAny(req, ["performance:overview","performance:cycles","performance:appraisals","performance:reports"])`, money via moneyViewForReq, returns `{ overview }`.

4. Rebuilt `src/rekankerja/performance/components/performance-overview.tsx` (~766 lines, export `PerformanceOverview` unchanged so performance-module.tsx untouched)
   - PageHeader business actions; cycle banner (phase badge bilingual, type, 360 chip, fallback chip "no running cycle — showing the latest", deadline chips, participants button → cycles).
   - 4–5 clickable KPI tiles (appraisals in flight / check-ins 30d / active PIP / merit applied + OKR only when enabled; 1/2/4-col responsive, 5-col at 2xl when OKR tile present; merit sub shows "Rp •••" + lock icon when !money.canSee).
   - Appraisal pipeline status strip (11-state machine labels bilingual, bars, footer participants/final/calibration).
   - Goal & Assessment Health card (3 clickable progress rows: goals locked → goals tab, self reviews & KPI actuals → appraisals).
   - Performance Cycle Flow: HORIZONTAL 7-phase step indicator (numbered circles, emerald checks for completed, accent fill + ring for active, connector lines, click per phase → cycles, footer "Active phase: X · n of 7 phases complete"; overflow-x-auto on mobile).
   - 360 progress card (submitted, rate progress bar, pending/declined/expired chips, anonymity note), Probation & PIP watchlist (aggregate counts + due soon/overdue, no names), recent activity feed (bilingual action/entity labels, sanitized detail, timestamps, max-h-80 scroll).
   - Loading (LoadingCards) / error (EmptyState) / no-cycle empty state with CTA → cycles. All strings via t(ID, EN), numbers via toLocaleString("id-ID"), useNav navigation (no raw <a>), aria-labels + role=button + keyboard handlers on tiles.

5. Cleanup: all dev-speak removed; grep confirmed no forbidden strings in the new files and no external imports of removed internals.

## Gates (all pass)
- `NODE_OPTIONS="--max-old-space-size=2000" bunx tsc --noEmit -p tsconfig.p9.json` → 0 errors.
- `bun run lint` → 0 errors / 6 warnings (exact repo baseline; zero new; no eslint-disable added).
- `bunx tsx scripts/audit-bilingual.ts --dir src/rekankerja/performance/components` → TOTAL_GAP=0 (25 files).
- Repo-wide bilingual → TOTAL_GAP=149 (≤ 150 baseline, no regression).
- Dev server compiles clean; page 200; API 401 without auth (guard works).

## Browser verification (agent-browser, hrd@mii.co.id @ MII + empty tenant CDN)
- Empty tenant → friendly empty state with "Buat Siklus Penilaian" CTA.
- MII: banner (PER-2025 Closed fallback chip), KPI tiles, pipeline "Ditutup 12", goal health 12/12 · 12/12 · 54/54, flow "Fase aktif: Ditutup · 6 dari 7 fase terlewati", 360 zeros + anonymity note, watchlist probation 1 / PIP 0, feed 1 item sanitized (no "(D9)"/"§7.1").
- Clicks: KPI → appraisals, phase → cycles, probation → probation, View Reports → reports (SPA nav).
- EN language fully correct; mobile 375px hscroll=false; console 0 errors; VLM desktop ID / mobile / final = NO DEFECTS.

## Files created/modified
- NEW `src/rekankerja/performance/services/perf-overview-service.ts`
- NEW `src/rekankerja/performance/api/overview.ts`
- NEW `src/app/api/rekankerja/performance/overview/route.ts`
- REWRITTEN `src/rekankerja/performance/components/performance-overview.tsx`
- APPENDED `worklog.md`
- Not touched: Training module, other perf services/APIs/reports/catalogs, performance-module.tsx (no change needed — nav handled via useNav inside the component).

## Deviations from plan
- None material. Two small additions beyond the letter of the brief, both aligned with its intent:
  1. Activity feed detail also strips internal "§x.y" refs and "(D9)"-style decision codes (in addition to the required Rp masking) — dev-speak must not be user-visible, and ActivityLog writers are outside this task's writable surface.
  2. Dropped the raw entityId (cuid) from the activity feed display (technical identifier — same "identifier teknis" defect class the audit flagged); field remains in the API payload.
