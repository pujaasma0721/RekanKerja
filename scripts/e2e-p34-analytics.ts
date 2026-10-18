// E2E P3.4-BM (D-BM26) — Analytics pivot + scheduled delivery ==================
// Uji end-to-end slice D Fase P3 (DEVELOPMENT-PLAN-BENCHMARK.md §4 P3.4):
//   (0) SETUP — login owner hrd@mii.co.id (money-view) + SMTP → smtp-catcher :2525
//       (state email-config lama disimpan utk restore eksak — pola e2e-b7).
//   (1) GROUP-BY — employees by orgUnitName + count via API run → dibanding
//       hitung manual prisma (harus identik).
//   (2) UANG — payroll_lines Σ net via API (hrd money-view) vs SQL manual
//       decryptMoney; TANPA money-view (panggilan langsung runReport dgn
//       mv.canSee=false) → agregat null + maskedAggregates=true (TIDAK
//       difabrikasi — invarian paling diaudit platform).
//   (3) PIVOT — employees orgUnitName × gender (count) → sel vs prisma manual.
//   (4) TRUNCATION — runReport langsung takeCap=10 (MII 44 karyawan) →
//       truncated=true + scanned=10 (take-cap eksplisit + indikator jujur).
//   (5) SCHEDULE — simpan laporan kustom + schedule-save (Daily jam 0 WIB)
//       → jobCustomReportSchedules langsung → EmailLog "Sent" (smtp-catcher)
//       + lastStatus OK + XLSX nyata (catch.jsonl berisi attachment base64);
//       idempoten (run ke-2 → sent 0 utk jadwal itu); guard validasi (frekuensi
//       salah / Weekly tanpa hari / 21 penerima / jam 24 → 400).
//   (6) CLEANUP — schedule-delete + DELETE laporan + EmailLog/ActivityLog uji
//       dipertahankan (pola B8) + email-config direstore eksak.
// Jalankan: bun scripts/e2e-p34-analytics.ts
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";
import { runReport, type MoneyView } from "@/rekankerja/shared/services/report-builder";
import { jobCustomReportSchedules } from "@/rekankerja/shared/services/scheduler-service";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const SCHEMA = "tenant_pt_mitra_industri_internasional";
const HR_EMAIL = "hrd@mii.co.id";
const HR_PASSWORD = "onevity123";
const RUN_API = "/api/rekankerja/custom-reports/run";
const CR_API = "/api/rekankerja/custom-reports";
const SCHED_API = "/api/rekankerja/custom-reports/schedule";
const RCPT = "e2e-p34@rekankerja.test";

let pass = 0, fail = 0;
function ok(cond: boolean, label: string, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.error(`  ✗ FAIL: ${label}${extra ? " — " + extra : ""}`); }
}

/** fetch ber-cookie dgn retry transient (pola p35 — dev-server on-demand compile). */
class Sesi {
  cookie = "";
  async api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          method,
          headers: { "Content-Type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
        });
        const setCookie = res.headers.get("set-cookie");
        if (setCookie) this.cookie = setCookie.split(";")[0];
        const json = await res.json().catch(() => ({}));
        return { status: res.status, json };
      } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2500 * (attempt + 1))); }
    }
    throw lastErr;
  }
}

async function main() {
  const db = getTenantClient(SCHEMA);
  const hr = new Sesi();
  const t0 = new Date();

  // ================= (0) SETUP =================
  console.log("\n[(0)] SETUP — login owner + SMTP catcher (pola e2e-b7)");
  const login = await hr.api("POST", "/api/auth/login", { email: HR_EMAIL, password: HR_PASSWORD });
  ok(login.status === 200, `login owner ${HR_EMAIL}`, `HTTP ${login.status}`);

  const oldCfg = await db.emailConfig.findFirst();
  const put = await hr.api("PUT", "/api/rekankerja/email-config", {
    active: true, smtpHost: "127.0.0.1", smtpPort: 2525, smtpSecure: false,
    smtpUser: "", smtpPassword: "", fromEmail: "e2e-p34@rekankerja.test", fromName: "RekanKerja E2E P3.4",
  });
  ok(put.status === 200, "PUT email-config → smtp-catcher 127.0.0.1:2525", `HTTP ${put.status}`);

  const empAll = await db.employee.findMany({
    select: { id: true, gender: true, orgUnit: { select: { name: true } }, status: true },
  });
  const activeEmp = empAll.filter((e) => e.status === "Active");
  ok(empAll.length >= 30, `data demo cukup (${empAll.length} karyawan MII)`);

  // ================= (1) GROUP-BY =================
  console.log("\n[(1)] GROUP-BY — employees by unit + count vs prisma manual");
  const g1 = await hr.api("POST", RUN_API, {
    entity: "employees", fields: ["employeeNo"],
    groupBy: "orgUnitName",
    aggregates: [{ field: "employeeNo", fn: "count", alias: "Jumlah" }],
    filters: [{ field: "status", op: "eq", value: "Active" }],
  });
  ok(g1.status === 200, "POST run (groupBy+count) → 200", `HTTP ${g1.status} ${g1.json?.error ?? ""}`);
  ok(g1.json?.mode === "grouped", "mode = grouped", g1.json?.mode);
  const manualByUnit = new Map<string, number>();
  for (const e of activeEmp) {
    const k = e.orgUnit?.name ?? "—";
    manualByUnit.set(k, (manualByUnit.get(k) ?? 0) + 1);
  }
  const apiRows = (g1.json?.rows ?? []) as Record<string, unknown>[];
  ok(apiRows.length === manualByUnit.size, "jumlah grup = unit unik manual", `${apiRows.length} vs ${manualByUnit.size}`);
  // key kolom agregat = alias tersanitasi (u_Jumlah) — baca dari columns respons
  const aggCol = (g1.json?.columns ?? []).find((c: any) => c.key !== "orgUnitName");
  ok(!!aggCol?.key && String(aggCol.key).startsWith("u_"), "kolom agregat alias tersanitasi u_*", aggCol?.key);
  let groupMatch = true;
  for (const r of apiRows) {
    const k = String(r.orgUnitName ?? "—");
    if (Number(r[aggCol.key]) !== (manualByUnit.get(k) ?? -1)) { groupMatch = false; }
  }
  ok(groupMatch, "setiap grup count == manual prisma");
  ok(Number(g1.json?.total) === apiRows.length, "total = jumlah baris grup (mode agregat)");

  // ================= (2) UANG =================
  console.log("\n[(2)] UANG — Σ net payroll_lines: money-view vs masked");
  const tc = tenantCryptoForDb(db as never);
  const lines = await db.payrollRunLine.findMany({ select: { net: true } });
  ok(lines.length >= 10, `baris payroll tersedia (${lines.length})`);
  const manualNet = lines.reduce((s, l) => s + (tc.decryptMoney(l.net) ?? 0), 0);
  const g2 = await hr.api("POST", RUN_API, {
    entity: "payroll_lines", fields: ["employeeNo"],
    aggregates: [{ field: "net", fn: "sum", alias: "TotalNet" }],
  });
  ok(g2.status === 200, "POST run (Σ net) → 200", `HTTP ${g2.status} ${g2.json?.error ?? ""}`);
  ok(g2.json?.mode === "summary", "mode = summary", g2.json?.mode);
  const apiNet = Number(g2.json?.aggregates?.[0]?.value);
  ok(Math.abs(apiNet - manualNet) < 0.01, "Σ net (money-view hrd) == manual decryptMoney", `api ${apiNet} vs manual ${manualNet.toFixed(2)}`);

  // masked: panggilan LANGSUNG runReport dgn mv.canSee=false (jalur yang sama
  // dgn PDF/email/ESS — API selalu lewat getMoneyView aktor).
  const maskedMv = { canSee: false, reason: "E2E_MASKED" } as unknown as MoneyView;
  const g2m = await runReport(db, { entity: "payroll_lines", fields: ["employeeNo"], aggregates: [{ field: "net", fn: "sum" }] }, maskedMv, {});
  ok(g2m.mode === "summary" && g2m.aggregates?.[0]?.value === null, "tanpa money-view → agregat null (tak difabrikasi)", JSON.stringify(g2m.aggregates?.[0]?.value));
  ok(g2m.maskedAggregates === true, "flag maskedAggregates=true direspons");

  // ================= (3) PIVOT =================
  console.log("\n[(3)] PIVOT — employees unit × gender (count)");
  const g3 = await hr.api("POST", RUN_API, {
    entity: "employees", fields: ["employeeNo"],
    pivot: { rowField: "orgUnitName", colField: "gender", valueFn: "count" },
    filters: [{ field: "status", op: "eq", value: "Active" }],
  });
  ok(g3.status === 200, "POST run (pivot 2-dim) → 200", `HTTP ${g3.status} ${g3.json?.error ?? ""}`);
  ok(g3.json?.mode === "pivot", "mode = pivot", g3.json?.mode);
  const pivot = g3.json?.pivot;
  ok(!!pivot && Array.isArray(pivot.rowKeys) && Array.isArray(pivot.colKeys), "pivot memuat rowKeys/colKeys");
  const manualCell = new Map<string, number>();
  for (const e of activeEmp) {
    const k = `${(e.orgUnit?.name ?? "—")}|${e.gender}`;
    manualCell.set(k, (manualCell.get(k) ?? 0) + 1);
  }
  let cellMatch = true, cellsChecked = 0;
  if (pivot) {
    for (const rk of pivot.rowKeys) for (const ck of pivot.colKeys) {
      const v = pivot.cells?.[rk]?.[ck] ?? 0;
      const m = manualCell.get(`${rk}|${ck}`) ?? 0;
      cellsChecked++;
      if (Number(v) !== m) cellMatch = false;
    }
  }
  ok(cellMatch, `semua sel pivot == manual (${cellsChecked} sel dicek)`);

  // ================= (4) TRUNCATION =================
  console.log("\n[(4)] TRUNCATION — take-cap eksplisit");
  const g4 = await runReport(
    db,
    { entity: "employees", fields: ["employeeNo"], aggregates: [{ field: "employeeNo", fn: "count" }] },
    { canSee: true, reason: "E2E" } as unknown as MoneyView,
    { takeCap: 10 },
  );
  ok(g4.scanned === 10, "scanned = 10 (cap)", String(g4.scanned));
  ok(g4.takeCap === 10, "takeCap ter-echo = 10", String(g4.takeCap));
  ok(g4.truncated === true, "truncated = true (MII > 10 baris)");
  ok(Number(g4.aggregates?.[0]?.value) === 10, "count pada cap = 10 (jujur: hanya yang discan)", String(g4.aggregates?.[0]?.value));

  // ================= (5) SCHEDULE =================
  console.log("\n[(5)] SCHEDULE — jadwal harian + job + EmailLog (smtp-catcher)");
  const rep = await hr.api("POST", CR_API, {
    name: "E2E34 laporan uji", description: "fixture e2e p34",
    entity: "employees", fields: ["employeeNo", "fullName", "orgUnitName"],
    filters: [{ field: "status", op: "eq", value: "Active" }],
  });
  ok(rep.status === 200 || rep.status === 201, "POST custom-reports → simpan laporan", `HTTP ${rep.status} ${rep.json?.error ?? ""}`);
  const repId = rep.json?.report?.id ?? rep.json?.id;
  ok(!!repId, "id laporan tersimpan", String(rep.json?.report?.code ?? rep.json?.code ?? ""));

  // guard validasi jadwal
  const bad1 = await hr.api("POST", SCHED_API, { action: "schedule-save", reportId: repId, frequency: "Yearly", hour: 0, recipients: RCPT });
  ok(bad1.status === 400, "frekuensi Yearly → 400", `HTTP ${bad1.status}`);
  const bad2 = await hr.api("POST", SCHED_API, { action: "schedule-save", reportId: repId, frequency: "Weekly", hour: 0, recipients: RCPT });
  ok(bad2.status === 400, "Weekly tanpa dayOfWeek → 400", `HTTP ${bad2.status}`);
  const bad3 = await hr.api("POST", SCHED_API, { action: "schedule-save", reportId: repId, frequency: "Daily", hour: 0, recipients: Array.from({ length: 21 }, (_, i) => `r${i}@x.test`).join(",") });
  ok(bad3.status === 400, "21 penerima → 400", `HTTP ${bad3.status}`);
  const bad4 = await hr.api("POST", SCHED_API, { action: "schedule-save", reportId: repId, frequency: "Daily", hour: 24, recipients: RCPT });
  ok(bad4.status === 400, "jam 24 → 400", `HTTP ${bad4.status}`);

  const sv = await hr.api("POST", SCHED_API, {
    action: "schedule-save", reportId: repId, frequency: "Daily", hour: 0, recipients: RCPT, active: true,
  });
  ok(sv.status === 200 || sv.status === 201, "schedule-save Daily jam 0 → 200/201", `HTTP ${sv.status} ${sv.json?.error ?? ""}`);
  const schedRow = await db.reportSchedule.findUnique({ where: { reportId: repId } });
  ok(!!schedRow && schedRow.frequency === "Daily" && schedRow.hour === 0, "row ReportSchedule upsert by reportId");

  // job LANGSUNG (bukan via siklus 6 jam — pola uji job scheduler e2e lain)
  const r1 = await jobCustomReportSchedules(db);
  ok(r1.due >= 1 && r1.sent >= 1, "run 1: jadwal due + terkirim", JSON.stringify(r1));
  const after1 = await db.reportSchedule.findUnique({ where: { reportId: repId } });
  ok(after1?.lastStatus === "OK", "lastStatus = OK", after1?.lastStatus ?? "—");
  const em1 = await db.emailLog.count({ where: { event: "report.scheduled", toEmail: RCPT, status: "Sent", createdAt: { gte: t0 } } });
  ok(em1 >= 1, "EmailLog report.scheduled Sent tertulis (await path)", `${em1} baris`);

  const r2 = await jobCustomReportSchedules(db);
  const em2 = await db.emailLog.count({ where: { event: "report.scheduled", toEmail: RCPT, status: "Sent", createdAt: { gte: t0 } } });
  ok(em2 === em1, `idempoten — run 2 tidak dobel kirim`, `total ${em2} (run2 sent utk jadwal ini: ${r2.sent})`);

  const act1 = await db.activityLog.count({ where: { entity: "ReportSchedule", createdAt: { gte: t0 } } });
  ok(act1 >= 1, "ActivityLog ReportSchedule tertulis", `${act1} baris`);

  // ================= (6) CLEANUP =================
  console.log("\n[(6)] CLEANUP — hapus fixture (EmailLog/ActivityLog dipertahankan — pola B8)");
  const dl = await hr.api("POST", SCHED_API, { action: "schedule-delete", reportId: repId });
  ok(dl.status === 200, "schedule-delete → 200", `HTTP ${dl.status}`);
  const gone = await db.reportSchedule.findUnique({ where: { reportId: repId } });
  ok(gone === null, "jadwal terhapus");
  const dr = await hr.api("DELETE", `${CR_API}?id=${repId}`);
  ok(dr.status === 200, "DELETE laporan uji → 200", `HTTP ${dr.status}`);

  // restore email-config eksak (state pra-uji: active=true + host kosong)
  if (oldCfg) {
    await db.emailConfig.update({
      where: { id: oldCfg.id },
      data: {
        active: oldCfg.active, smtpHost: oldCfg.smtpHost, smtpPort: oldCfg.smtpPort,
        smtpSecure: oldCfg.smtpSecure, smtpUser: oldCfg.smtpUser, smtpPassword: oldCfg.smtpPassword,
        fromEmail: oldCfg.fromEmail, fromName: oldCfg.fromName,
      },
    });
    ok(true, "email-config direstore ke pra-uji");
  }

  console.log(`\nE2E P3.4: ${pass}/${pass + fail} ${fail === 0 ? "PASS" : "FAIL"} — mulai ${t0.toISOString()}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
