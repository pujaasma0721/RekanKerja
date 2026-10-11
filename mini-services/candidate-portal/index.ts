// mini-services/candidate-portal — Portal Kandidat RekanKerja (APLIKASI TERPISAH).
// Lihat README.md: keputusan AMANDEMEN 1 — portal karir publik TIDAK menyatu dengan
// aplikasi utama (domain produksi berbeda: karir.<perusahaan> vs app.<perusahaan>).
//
// Server bun murni — TANPA dependensi (tidak ada node_modules, tidak ada React di sini
// sampai scaffolding Next.js penuh pada resume F2). Tugas layanan ini:
//   GET /         → halaman karir SSR: daftar slot lowongan Posted (fetch server-side
//                   dari API publik aplikasi utama; fallback rapi bila utama mati).
//   GET /healthz  → status layanan (JSON).
//
// Kontrak API publik aplikasi utama (satu-satunya integrasi — tidak ada akses DB):
//   GET /api/public/recruitment/openings?t=<slug>
//
// Port tetap 3010 (konvensi mini-services — jangan pakai env PORT).
const PORT = 3010;
const MAIN_APP = process.env.CANDIDATE_PORTAL_MAIN_URL ?? "http://127.0.0.1:3000";
const FETCH_TIMEOUT_MS = 2000;

interface PublicOpeningItem {
  slotId: string;
  joRefNo: string;
  title: string;
  location: string | null;
  city: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  currency: string;
  salaryUnit: string;
  jobDescSummary: string | null;
  jobSpecSummary: string | null;
  closingDate: string | null;
  employmentStatus: string | null;
}
interface OpeningsResponse {
  tenant: { slug: string; companyName: string } | null;
  tenants?: { slug: string; companyName: string }[];
  openings: PublicOpeningItem[];
}

async function fetchOpenings(tenantSlug: string | null): Promise<OpeningsResponse | null> {
  const url = new URL("/api/public/recruitment/openings", MAIN_APP);
  if (tenantSlug) url.searchParams.set("t", tenantSlug);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OpeningsResponse;
  } catch {
    return null; // aplikasi utama mati / belum siap → halaman fallback
  }
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function salaryLabel(o: PublicOpeningItem): string | null {
  if (o.salaryMin == null && o.salaryMax == null) return null;
  const unit = o.salaryUnit === "month" ? "/bulan" : o.salaryUnit === "year" ? "/tahun" : "";
  if (o.salaryMin != null && o.salaryMax != null) return `${idr(o.salaryMin)} – ${idr(o.salaryMax)}${unit}`;
  if (o.salaryMin != null) return `≥ ${idr(o.salaryMin)}${unit}`;
  return `≤ ${idr(o.salaryMax)}${unit}`;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function renderOpeningCard(o: PublicOpeningItem): string {
  const salary = salaryLabel(o);
  const closing = fmtDate(o.closingDate);
  const place = [o.location, o.city].filter(Boolean).join(" · ") || "—";
  const summary = o.jobDescSummary || o.jobSpecSummary;
  return `
        <article class="card" aria-label="${esc(o.title)}">
          <div class="card-top">
            <h3>${esc(o.title)}</h3>
            ${o.employmentStatus ? `<span class="chip">${esc(o.employmentStatus)}</span>` : ""}
          </div>
          <p class="meta"><span aria-hidden="true">📍</span> ${esc(place)}</p>
          ${salary ? `<p class="meta"><span aria-hidden="true">💰</span> ${esc(salary)}</p>` : ""}
          ${closing ? `<p class="meta"><span aria-hidden="true">🗓️</span> Ditutup ${esc(closing)}</p>` : ""}
          ${summary ? `<p class="summary">${esc(summary)}</p>` : ""}
          <p class="ref">Ref: ${esc(o.joRefNo)}</p>
        </article>`;
}

function renderPage(data: OpeningsResponse | null, tenantSlug: string | null): string {
  const companyName = data?.tenant?.companyName ?? null;
  const openings = data?.openings ?? [];
  const listHtml = openings.length
    ? openings.map(renderOpeningCard).join("\n")
    : `
        <div class="empty" role="status">
          <p class="empty-title" data-id="Belum ada lowongan terbuka saat ini" data-en="No open positions right now">Belum ada lowongan terbuka saat ini</p>
          <p class="empty-sub" data-id="Silakan kembali lagi nanti — lowongan baru akan dipublikasikan di halaman ini." data-en="Please check back later — new openings will be published on this page.">Silakan kembali lagi nanti — lowongan baru akan dipublikasikan di halaman ini.</p>
        </div>`;
  const notice = data
    ? ""
    : `
        <p class="notice" role="status" data-id="Daftar lowongan live belum tersedia (layanan rekrutmen internal sedang tidak aktif). Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal." data-en="Live openings are unavailable right now (the internal recruitment service is offline). This page is the Candidate Portal — a separate application from the internal HR system.">Daftar lowongan live belum tersedia (layanan rekrutmen internal sedang tidak aktif). Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal.</p>`;
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>${companyName ? `Karir — ${esc(companyName)}` : "Portal Karir"} · RekanKerja</title>
<meta name="description" content="${companyName ? `Lowongan terbuka di ${esc(companyName)}.` : "Portal karir publik."} Lamar tanpa akun — konfirmasi via email.">
<style>
  :root { --accent:#ea580c; --ink:#1c1917; --muted:#78716c; --bg:#faf9f5; --card:#ffffff; --line:#e7e5e0; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { height:100%; }
  body { font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; background:var(--bg); color:var(--ink); display:flex; flex-direction:column; min-height:100vh; line-height:1.55; }
  header.site { background:var(--card); border-bottom:1px solid var(--line); padding:.9rem 1.25rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; position:sticky; top:0; z-index:5; }
  .wordmark { font-weight:800; letter-spacing:-.02em; font-size:1.05rem; display:flex; align-items:center; gap:.55rem; }
  .wordmark .dot { width:.65rem; height:.65rem; border-radius:9999px; background:var(--accent); }
  .lang { background:transparent; border:1px solid var(--line); border-radius:.6rem; padding:.35rem .7rem; font-size:.78rem; font-weight:600; color:var(--muted); cursor:pointer; min-height:44px; }
  .lang:hover { border-color:var(--accent); color:var(--accent); }
  main { flex:1; width:100%; max-width:56rem; margin:0 auto; padding:2.25rem 1.25rem 3rem; }
  .hero h1 { font-size:clamp(1.6rem,4vw,2.3rem); letter-spacing:-.03em; line-height:1.15; }
  .hero h1 em { font-style:normal; color:var(--accent); }
  .hero p.sub { color:var(--muted); margin-top:.6rem; max-width:38rem; }
  .notice { margin-top:1.25rem; border:1px dashed var(--accent); background:#fff7ed; color:#7c2d12; border-radius:.85rem; padding:.85rem 1rem; font-size:.85rem; }
  .grid { margin-top:1.75rem; display:grid; gap:1rem; grid-template-columns:repeat(auto-fill,minmax(19rem,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:1rem; padding:1.15rem 1.2rem; display:flex; flex-direction:column; gap:.5rem; transition:transform .15s ease, box-shadow .15s ease; }
  .card:hover { transform:translateY(-2px); box-shadow:0 10px 24px -14px rgba(28,25,23,.25); }
  .card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:.75rem; }
  .card h3 { font-size:1.02rem; letter-spacing:-.01em; }
  .chip { flex-shrink:0; font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); border:1px solid #fed7aa; background:#fff7ed; border-radius:9999px; padding:.22rem .6rem; }
  .meta { font-size:.83rem; color:var(--muted); }
  .summary { font-size:.86rem; color:#44403c; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .ref { font-size:.7rem; color:#a8a29e; margin-top:auto; padding-top:.4rem; border-top:1px dashed var(--line); }
  .empty { grid-column:1/-1; text-align:center; border:1px dashed var(--line); border-radius:1rem; padding:3rem 1.5rem; background:var(--card); }
  .empty-title { font-weight:700; }
  .empty-sub { color:var(--muted); font-size:.9rem; margin-top:.4rem; }
  footer.site { margin-top:auto; background:var(--card); border-top:1px solid var(--line); padding:1rem 1.25rem; padding-bottom:calc(1rem + env(safe-area-inset-bottom)); display:flex; flex-wrap:wrap; gap:.5rem 1.25rem; align-items:center; justify-content:space-between; font-size:.75rem; color:var(--muted); }
  a { color:var(--accent); }
</style>
</head>
<body>
  <header class="site">
    <div class="wordmark" aria-label="Portal Karir"><span class="dot" aria-hidden="true"></span>Karir${companyName ? ` · ${esc(companyName)}` : ""}</div>
    <button class="lang" id="lang-toggle" type="button" aria-label="Ganti bahasa / switch language">EN</button>
  </header>
  <main>
    <section class="hero">
      <h1 data-id="Berkarir <em>bersama kami</em>" data-en="Build your career <em>with us</em>">Berkarir <em>bersama kami</em></h1>
      <p class="sub" data-id="Lamar langsung tanpa membuat akun — cukup satu formulir, CV, dan konfirmasi email. Data Anda kami perlakukan sesuai UU PDP No. 27/2022." data-en="Apply directly without creating an account — just one form, your CV, and an email confirmation. Your data is handled under Indonesia's PDP Law No. 27/2022.">Lamar langsung tanpa membuat akun — cukup satu formulir, CV, dan konfirmasi email. Data Anda kami perlakukan sesuai UU PDP No. 27/2022.</p>
      ${notice}
    </section>
    <section class="grid" aria-label="Daftar lowongan">
      ${listHtml}
    </section>
  </main>
  <footer class="site">
    <span>${companyName ? `© ${new Date().getFullYear()} ${esc(companyName)}` : "Portal Karir"}</span>
    <span data-id="Portal Kandidat — aplikasi terpisah dari sistem HR internal (RekanKerja)" data-en="Candidate Portal — a separate application from the internal HR system (RekanKerja)">Portal Kandidat — aplikasi terpisah dari sistem HR internal (RekanKerja)</span>
  </footer>
  <script>
    (function () {
      var KEY = "portal-lang", cur = "id";
      try { cur = localStorage.getItem(KEY) || "id"; } catch (e) {}
      var btn = document.getElementById("lang-toggle");
      function apply(lang) {
        cur = lang;
        document.documentElement.lang = lang;
        document.querySelectorAll("[data-id]").forEach(function (el) {
          var v = el.getAttribute(lang === "id" ? "data-id" : "data-en");
          if (v != null) el.innerHTML = v;
        });
        btn.textContent = lang === "id" ? "EN" : "ID";
        try { localStorage.setItem(KEY, lang); } catch (e) {}
      }
      btn.addEventListener("click", function () { apply(cur === "id" ? "en" : "id"); });
      apply(cur);
    })();
  </script>
</body>
</html>`;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") {
      return Response.json({ ok: true, service: "candidate-portal", port: PORT, mainApp: MAIN_APP });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const t = url.searchParams.get("t");
      const data = await fetchOpenings(t);
      return new Response(renderPage(data, t), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`[candidate-portal] OK — http://127.0.0.1:${PORT} (aplikasi TERPISAH; gateway: /?XTransformPort=${PORT}) · main app: ${MAIN_APP}`);
