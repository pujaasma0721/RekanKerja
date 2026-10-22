// K6 (Grafana) — Konfigurasi Load Test Produksi RekanKerja Multi-Tenant =====
// File ini padanan CI/CD/staging dari scripts/qa/05-load.ts (Bun harness lokal).
//
// Jalankan (staging):
//   K6_HOST=https://app.rekankerja.id \
//   K6_TENANT_A_COOKIE="rekankerja_session=<token-A>" \
//   K6_TENANT_B_COOKIE="rekankerja_session=<token-B>" \
//   K6_API_KEY="<x-api-key>" \
//   k6 run qa/k6-tenant-load.js
//
// Threshold (gagal = exit non-zero → blokir pipeline):
//   - http_req_failed ............ < 1%      (error jaringan + 5xx)
//   - http_req_duration p(95) .... < 800ms    (target staging, network nyata)
//   - checks ..................... rate > 99% (isolasi data terjaga)
//
// Catatan desain:
//   1. Cookie disuntik via header (BUKAN k6 cookie jar) supaya DUA context
//      tenant berjalan paralel dalam SATU process — membuktikan tidak ada
//      respons tercampur (cache poisoning) pada URL yang sama.
//   2. Endpoint dashboard/employees = beban DB berat; me/companies = ringan.
//   3. Public API (x-api-key) diuji terpisah utk rate limit 60 req/mnt —
//      jangan melebihi 60 req/mnt per kunci pada scenario ini (dibatasi 50).

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const HOST = __ENV.K6_HOST || "http://127.0.0.1:3000";
const COOKIE_A = __ENV.K6_TENANT_A_COOKIE || "";
const COOKIE_B = __ENV.K6_TENANT_B_COOKIE || "";
const API_KEY = __ENV.K6_API_KEY || "";

const crossTenantLeak = new Counter("qa_cross_tenant_leak");

export const options = {
  scenarios: {
    // ---- Tenant A (MII): beban utama berjenjang ----
    tenant_a: {
      executor: "ramping-vus",
      startVUs: 5,
      stages: [
        { duration: "30s", target: 30 },
        { duration: "1m", target: 30 },
        { duration: "30s", target: 60 },
        { duration: "1m", target: 60 },
        { duration: "30s", target: 0 },
      ],
      exec: "tenantA",
    },
    // ---- Tenant B (Cahaya): paralel konstan — pembuktian isolasi cache ----
    tenant_b: {
      executor: "constant-vus",
      vus: 10,
      duration: "3m",
      startTime: "30s",
      exec: "tenantB",
    },
    // ---- Public API (API key): ≤50 req/mnt per kunci ----
    public_api: {
      executor: "constant-arrival-rate",
      rate: 45, // per menit? tidak — k6 rate = per detik; 45/min ≈ 0.75/s
      timeUnit: "1m",
      duration: "3m",
      startTime: "1m",
      preAllocatedVUs: 5,
      exec: "publicApi",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{scenario:tenant_a}": ["p(95)<800"],
    "http_req_duration{scenario:tenant_b}": ["p(95)<800"],
    checks: ["rate>0.99"],
    qa_cross_tenant_leak: ["count==0"],
  },
};

const EPS_AUTHED = [
  "/api/auth/me",
  "/api/rekankerja/companies",
  "/api/rekankerja/employees?limit=50",
  "/api/rekankerja/dashboard",
  "/api/rekankerja/notifications",
];

function authedRound(cookie, expectEmployeesRows) {
  for (const ep of EPS_AUTHED) {
    const res = http.get(`${HOST}${ep}`, { headers: { cookie } });
    check(res, {
      [`${ep} status 200`]: (r) => r.status === 200,
      [`${ep} bukan 5xx`]: (r) => r.status < 500,
    });
    if (ep.startsWith("/api/rekankerja/employees")) {
      // isolasi: tenant B (workspace referensi) HARUS 0 karyawan —
      // bila > 0 terjadi kebocoran lintas tenant (cache/DB).
      const n = (res.json("data.employees") || res.json("employees") || []).length;
      if (!expectEmployeesRows && n > 0) crossTenantLeak.add(1);
      if (expectEmployeesRows && n === 0) crossTenantLeak.add(1);
    }
    sleep(Math.random() * 0.5 + 0.2);
  }
}

export function tenantA() {
  // Tenant A (MII): 44 karyawan — expectEmployeesRows = true
  authedRound(COOKIE_A, true);
}

export function tenantB() {
  // Tenant B (Cahaya): tenant referensi 0 karyawan — expectEmployeesRows = false
  authedRound(COOKIE_B, false);
}

export function publicApi() {
  const res = http.get(`${HOST}/api/public/employees?limit=10`, {
    headers: { "x-api-key": API_KEY },
  });
  check(res, {
    "public employees 200": (r) => r.status === 200,
    "public employees ada data": (r) => (r.json("data.employees") || []).length > 0,
  });
}
