/**
 * Task 64 — E2E demo prorate segmen SAYONE (via API UI, login owner):
 *  1. Komponen T_TRF (Fixed 1.500.000, prorated) + 2 rule office (SetAmount).
 *  2. Template TPL_TRF = SAYONE_SALARY + T_TRF.
 *  3. PA Transfer eff 20 Sep: office A→B + ganti template (→ 2 segmen Sep).
 *  4. PA SalaryAdjustment eff 1 Okt: gaji +500.000 (→ versi baru Okt).
 *  5. Run Sep: segmen prorate + nilai LAMA. Run Okt: nilai BARU penuh.
 * Usage: tsx scripts/demo-prorate-e2e.ts [BASE]
 */
const BASE = process.argv[2] ?? "https://onevity.sayone.my.id";
const jar = new Map<string, string>();
function storeCookies(res: Response): void {
  const list: string[] = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
async function api(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  storeCookies(res);
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { raw: text.slice(0, 300) }; }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}
const J = (label: string, v: unknown) => console.log(`\n== ${label} ==\n${JSON.stringify(v, null, 1)}`);

async function main(): Promise<void> {
  // 0. login + vault
  await api("POST", "/api/auth/login", { email: "puja.asmara@sayone.com", password: "Asmaree.007" });
  await api("POST", "/api/onevity/money-vault", { action: "unlock", password: "asmaree.007" });
  console.log("login + vault OK");

  // 1. office A/B (dua pertama)
  const offs = (await api("GET", "/api/onevity/company-offices")) as { offices?: { id: string; code: string; name: string }[] };
  const offices = offs.offices ?? (offs as unknown as { data?: { id: string; code: string; name: string }[] }).data ?? [];
  if (offices.length < 2) throw new Error(`butuh ≥2 office, ada ${offices.length}`);
  const [OFF_A, OFF_B] = offices;
  J("OFF_A / OFF_B", { a: OFF_A.code, b: OFF_B.code });

  // 2. komponen T_TRF + rule per office (idempoten: reuse bila sudah ada)
  const comps = (await api("GET", "/api/onevity/wage-components")) as { components?: { id: string; code: string }[] };
  let T_TRF: { id: string; code: string } | undefined = (comps.components ?? []).find((c) => c.code === "T_TRF");
  if (!T_TRF) {
    const created = (await api("POST", "/api/onevity/wage-components", {
      code: "T_TRF", name: "Tunjangan Transfer (demo prorate office)", type: "Earning", wageType: "Compensation",
      calcMethod: "Fixed", amount: 1_500_000, prorated: true, incomeTaxMethod: "Regular", includeInTHP: true,
    })) as { component: { id: string } };
    T_TRF = { id: created.component.id, code: "T_TRF" };
  }
  if (!T_TRF) throw new Error("komponen T_TRF tidak tersedia");
  const rulesList = (await api("GET", `/api/onevity/wage-component-rules?componentId=${T_TRF.id}`)) as { rules?: { id: string; name: string }[] };
  const hasRuleA = (rulesList.rules ?? []).some((r) => r.name === "Tarif Kantor A");
  if (!hasRuleA) {
    await api("POST", "/api/onevity/wage-component-rules", {
      componentId: T_TRF.id, name: "Tarif Kantor A", priority: 1, active: true, actionType: "SetAmount", amount: 1_500_000,
      conditions: [{ param: "office", op: "in", values: [OFF_A.code] }],
    });
  }
  const hasRuleB = (rulesList.rules ?? []).some((r) => r.name === "Tarif Kantor B");
  if (!hasRuleB) {
    await api("POST", "/api/onevity/wage-component-rules", {
      componentId: T_TRF.id, name: "Tarif Kantor B", priority: 2, active: true, actionType: "SetAmount", amount: 800_000,
      conditions: [{ param: "office", op: "in", values: [OFF_B.code] }],
    });
  }
  J("T_TRF", T_TRF);

  // 3. template TPL_TRF = komponen SAYONE_SALARY + T_TRF
  const tpls = (await api("GET", "/api/onevity/wage-templates")) as { templates?: { id: string; code: string; items?: { wageComponentId: string }[] }[] };
  const tplList = tpls.templates ?? (tpls as unknown as { data?: { id: string; code: string; items?: { wageComponentId: string }[] }[] }).data ?? [];
  const base = tplList.find((t) => t.code === "DEFAULT");
  if (!base) throw new Error("template DEFAULT tidak ditemukan");
  const compIds = [...(base.items ?? []).map((i) => i.wageComponentId), T_TRF.id];
  let TPL = tplList.find((t) => t.code === "TPL_TRF");
  if (!TPL) {
    const created = (await api("POST", "/api/onevity/wage-templates", {
      code: "TPL_TRF", name: "Template Transfer (demo prorate)", componentIds: compIds,
    })) as { template: { id: string; code: string } };
    TPL = { id: created.template.id, code: created.template.code };
  }
  J("TPL_TRF", { id: TPL.id, comps: compIds.length });

  // 4. karyawan sampel SAYONE00001 (aktif, punya profil payroll)
  const emps = (await api("GET", "/api/onevity/employees?limit=1")) as { employees?: { id: string; employeeNo: string; fullName: string }[] };
  const emp = (emps.employees ?? (emps as unknown as { data?: typeof emps.employees }).data ?? [])[0];
  if (!emp) throw new Error("karyawan tidak ditemukan");
  J("karyawan sampel", emp);

  // 5. PA Transfer eff 20 Sep: office A→B + template baru
  const pa1 = (await api("POST", "/api/onevity/personnel-actions", {
    employeeId: emp.id, type: "Transfer", effectiveDate: "2026-09-20",
    detail: { companyOfficeId: OFF_B.id, newWageTemplateId: TPL.id, reason: "Demo prorate segmen Task 64" },
  })) as { action?: { id: string; docNo: string } } | { id: string };
  const pa1Id = (pa1 as { action?: { id: string } }).action?.id ?? (pa1 as { id: string }).id;
  await api("PATCH", `/api/onevity/personnel-actions/${pa1Id}`, { action: "submit" });
  for (let i = 0; i < 6; i++) {
    const d = (await api("GET", `/api/onevity/personnel-actions/${pa1Id}`)) as { action?: { status: string } };
    const st = d.action?.status;
    if (st === "Approved") break;
    if (st === "Submitted") { await api("PATCH", `/api/onevity/personnel-actions/${pa1Id}`, { action: "approve", note: "auto demo" }); continue; }
    if (st === "Prepared") { await api("PATCH", `/api/onevity/personnel-actions/${pa1Id}`, { action: "submit" }); continue; }
    break;
  }
  await api("PATCH", `/api/onevity/personnel-actions/${pa1Id}`, { action: "process" });
  console.log(`PA Transfer 20 Sep OK (${(pa1 as { action?: { docNo: string } }).action?.docNo ?? pa1Id})`);

  // 6. PA SalaryAdjustment eff 1 Okt: +500.000
  const emps2 = (await api("GET", "/api/onevity/employee-detail?id=" + emp.id)) as Record<string, unknown>;
  const curSal = Number((emps2 as { employee?: { baseSalary?: number } }).employee?.baseSalary ?? 0);
  const pa2 = (await api("POST", "/api/onevity/personnel-actions", {
    employeeId: emp.id, type: "SalaryAdjustment", effectiveDate: "2026-10-01",
    detail: { newSalary: curSal + 500_000, reason: "Kenaikan upah efektif Okt (demo effective-dated)" },
  })) as { action?: { id: string; docNo: string } } | { id: string };
  const pa2Id = (pa2 as { action?: { id: string } }).action?.id ?? (pa2 as { id: string }).id;
  await api("PATCH", `/api/onevity/personnel-actions/${pa2Id}`, { action: "submit" });
  for (let i = 0; i < 6; i++) {
    const d = (await api("GET", `/api/onevity/personnel-actions/${pa2Id}`)) as { action?: { status: string } };
    const st = d.action?.status;
    if (st === "Approved") break;
    if (st === "Submitted") { await api("PATCH", `/api/onevity/personnel-actions/${pa2Id}`, { action: "approve", note: "auto demo" }); continue; }
    if (st === "Prepared") { await api("PATCH", `/api/onevity/personnel-actions/${pa2Id}`, { action: "submit" }); continue; }
    break;
  }
  await api("PATCH", `/api/onevity/personnel-actions/${pa2Id}`, { action: "process" });
  console.log(`PA SalaryAdjustment 1 Okt OK (gaji ${curSal} → ${curSal + 500_000})`);

  // 7. period Okt + run Sep & Okt
  const periods = (await api("GET", "/api/onevity/payroll-periods")) as { periods?: { id: string; code: string; status: string }[] };
  const perList = periods.periods ?? (periods as unknown as { data?: { id: string; code: string; status: string }[] }).data ?? [];
  const sep = perList.find((p) => p.code === "2026-09");
  if (!sep) throw new Error("period 2026-09 tidak ada");
  let okt = perList.find((p) => p.code === "2026-10");
  if (!okt) {
    const created = (await api("POST", "/api/onevity/payroll-periods", {
      name: "Oktober 2026", startDate: "2026-10-01", endDate: "2026-10-31",
    })) as { period?: { id: string } };
    okt = { id: (created.period ?? created as unknown as { id: string }).id, code: "2026-10", status: "Draft" };
  }
  const ptypes = (await api("GET", "/api/onevity/process-types")) as { processTypes?: { id: string; code: string }[] };
  const sal = (ptypes.processTypes ?? (ptypes as unknown as { data?: { id: string; code: string }[] }).data ?? []).find((p) => p.code === "SALARY");
  if (!sal) throw new Error("process type SALARY tidak ada");

  for (const per of [sep, okt as { id: string; code: string }]) {
    const { run } = (await api("POST", "/api/onevity/payroll-runs", { periodId: per.id, processTypeId: sal.id, allEmployee: true })) as { run: { id: string; runNo: string } };
    const calc = (await api("PATCH", "/api/onevity/payroll-runs", { id: run.id, action: "calculate" })) as {
      summary?: { employees: number; totalNet: string | number };
      logSummary?: { byLevel?: Record<string, number> };
    };
    J(`RUN ${per.code} ${run.runNo}`, { employees: calc.summary?.employees, net: calc.summary?.totalNet, logs: calc.logSummary?.byLevel });
    const det = (await api("GET", `/api/onevity/payroll-run?id=${run.id}`)) as {
      run?: { lines?: { employeeNo: string; baseSalary?: number; items?: { code: string; amount: number; note?: string | null }[] }[]; logs?: { code: string; level: string; message: string }[] };
    };
    const line = det.run?.lines?.find((l) => l.employeeNo === emp.employeeNo);
    if (line) {
      J(`Garis ${emp.employeeNo} ${per.code}`, {
        items: line.items?.filter((i) => i.code === "T_TRF" || i.code === "BASIC" || /gaji|basic/i.test(i.code)).map((i) => ({ code: i.code, amount: i.amount, note: i.note })),
      });
    } else {
      console.log("!! garis karyawan sampel tidak ditemukan di run", per.code);
    }
    const segLogs = (det.run?.logs ?? []).filter((l) => l.code === "SEGMENTS").slice(0, 3);
    if (segLogs.length) J("log SEGMENTS (3 pertama)", segLogs);
  }
  console.log("\nSELESAI — bandingkan garis karyawan sampel Sep (prorate 2 segmen, nilai lama) vs Okt (nilai baru penuh).");
}
main().catch((e) => { console.error("GAGAL:", e instanceof Error ? e.message : e); process.exit(1); });

export {};
