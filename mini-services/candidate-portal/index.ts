// mini-services/candidate-portal — Portal Kandidat RekanKerja (APLIKASI TERPISAH).
// Lihat README.md: keputusan AMANDEMEN 1 — portal karir publik TIDAK menyatu dengan
// aplikasi utama (domain produksi berbeda: karir.<perusahaan> vs app.<perusahaan>).
//
// Server bun murni — TANPA dependensi (tidak ada node_modules, tidak ada React di
// sini). Tugas layanan ini (F2-PORTAL-FORM):
//   GET  /                          → halaman karir SSR: daftar slot lowongan Posted
//                                     (fetch server-side dari API publik aplikasi
//                                     utama; fallback rapi bila utama mati) + FORM
//                                     LAMARAN (dialog vanilla JS — data diri,
//                                     pendidikan, pengalaman, upload CV, captcha,
//                                     consent UU PDP, honeypot anti-bot).
//   ANY  /api/public/recruitment/*  → PROXY server-side ke aplikasi utama (MAIN_APP):
//     - mode direct http://127.0.0.1:3010 → browser fetch URL RELATIF
//       "/api/public/recruitment/..." ditangani proxy ini (method+headers+body
//       di-relay; multipart CV di-stream apa adanya — boundary TIDAK pernah
//       disentuh manual).
//     - mode gateway ?XTransformPort=3010 → halaman dilayani portal, fetch relatif
//       browser menuju gateway → diteruskan aplikasi utama (proxy tidak dipakai).
//   GET  /healthz                   → status layanan (JSON).
//
// Kontrak API publik aplikasi utama (satu-satunya integrasi — tidak ada akses DB):
//   GET  /api/public/recruitment/openings?t=<slug>
//   GET  /api/public/recruitment/captcha
//   POST /api/public/recruitment/apply?t=<slug>   (multipart/form-data)
//
// Port tetap 3010 (konvensi mini-services — jangan pakai env PORT).
const PORT = 3010;
const MAIN_APP = process.env.CANDIDATE_PORTAL_MAIN_URL ?? "http://127.0.0.1:3000";
const FETCH_TIMEOUT_MS = 2000;
const PROXY_TIMEOUT_MS = 30000;
const PUBLIC_API_PREFIX = "/api/public/recruitment/";

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
  knockouts?: { questionId: string; question: string }[]; // F6b — pertanyaan objektif per slot (jawaban Tidak → ditolak otomatis dengan sopan)
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

// ============ B7 — branding portal (CareerSiteConfig per tenant) ============

interface SiteConfig {
  brandColor: string;
  logoUrl: string | null;
  heroTitle: string | null;
  heroSub: string | null;
  companyName: string | null;
}

/** Branding portal per tenant (fallback tenang bila utama mati — pola openings). */
async function fetchSiteConfig(tenantSlug: string | null): Promise<SiteConfig | null> {
  const url = new URL("/api/public/recruitment/site-config", MAIN_APP);
  if (tenantSlug) url.searchParams.set("t", tenantSlug);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as SiteConfig;
  } catch {
    return null;
  }
}

/** Palet brand valid (hex #rrggbb) — invalid → null (fallback default). */
function validBrand(hex: string | null | undefined): string | null {
  return hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Campur 2 warna hex — wa = bobot warna A (0..1). */
function mixHex(a: string, b: string, wa: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 * wa + r2 * (1 - wa), g1 * wa + g2 * (1 - wa), b1 * wa + b2 * (1 - wa));
}

/**
 * Palet turunan dari warna brand (dark/tint/deep) — dipakai CSS :root.
 * Tanpa branding → literal default persis seperti portal F2 (orange).
 */
interface BrandPalette { brand: string; dark: string; t95: string; t91: string; t87: string; t65: string; deep: string; deep2: string; rgb: string }
function brandPalette(brandHex: string | null): BrandPalette {
  const brand = brandHex ?? "#ea580c";
  if (!brandHex) {
    return { brand, dark: "#c2410c", t95: "#fff7ed", t91: "#ffedd5", t87: "#fed7aa", t65: "#fdba74", deep: "#9a3412", deep2: "#7c2d12", rgb: "234,88,12" };
  }
  const [r, g, b] = hexToRgb(brand);
  return {
    brand,
    dark: mixHex(brand, "#000000", 0.84),
    t95: mixHex(brand, "#ffffff", 0.05),
    t91: mixHex(brand, "#ffffff", 0.11),
    t87: mixHex(brand, "#ffffff", 0.24),
    t65: mixHex(brand, "#ffffff", 0.35),
    deep: mixHex(brand, "#000000", 0.66),
    deep2: mixHex(brand, "#000000", 0.53),
    rgb: `${r},${g},${b}`,
  };
}

// ============ PROXY server-side /api/public/recruitment/* → MAIN_APP ============
// Alasan: mode akses (a) direct 127.0.0.1:3010 — fetch relatif dari browser TIDAK
// bisa menemukan API aplikasi utama, maka portal me-relay-nya sendiri. Body POST
// (multipart + boundary) di-relay sebagai stream apa adanya; header hop-by-hop
// dibuang; respons di-relay status+body (content-encoding/length dibuang karena
// bun fetch sudah mendekompresi).

const HOP_REQ_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
]);
const HOP_RES_HEADERS = new Set([
  "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive",
]);

async function proxyPublicApi(req: Request, url: URL): Promise<Response> {
  const upstream = new URL(url.pathname + url.search, MAIN_APP);
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_REQ_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  });
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = req.body; // stream relay (bun support)
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
    const res = await fetch(upstream, { ...init, signal: ac.signal });
    clearTimeout(timer);
    const out = new Headers();
    res.headers.forEach((v, k) => {
      if (!HOP_RES_HEADERS.has(k.toLowerCase())) out.set(k, v);
    });
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  } catch {
    return Response.json(
      { error: "Portal tidak dapat menghubungi layanan rekrutmen. Silakan coba lagi nanti." },
      { status: 502 },
    );
  }
}

// ============ helper render ============

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

/** Label satuan gaji [id, en] — API mengirim "Monthly"/"Yearly"/… (kompatibel lowercase). */
const SALARY_UNIT_LABEL: Record<string, [string, string]> = {
  Monthly: ["/bulan", "/month"], monthly: ["/bulan", "/month"], month: ["/bulan", "/month"],
  Yearly: ["/tahun", "/year"], yearly: ["/tahun", "/year"], year: ["/tahun", "/year"],
  Weekly: ["/minggu", "/week"], weekly: ["/minggu", "/week"],
  Daily: ["/hari", "/day"], daily: ["/hari", "/day"],
  Hourly: ["/jam", "/hour"], hourly: ["/jam", "/hour"],
};

/** Label status kerja [id, en] — nilai PR.employmentStatus. */
const EMPLOYMENT_LABEL: Record<string, [string, string]> = {
  Permanent: ["Tetap", "Permanent"],
  Contract: ["Kontrak", "Contract"],
  Probation: ["Percobaan", "Probation"],
  Outsourcing: ["Outsourcing", "Outsourcing"],
};

function salaryAmount(o: PublicOpeningItem): string | null {
  if (o.salaryMin == null && o.salaryMax == null) return null;
  if (o.salaryMin != null && o.salaryMax != null && o.salaryMin !== o.salaryMax) {
    return `${idr(o.salaryMin)} – ${idr(o.salaryMax)}`;
  }
  return idr(o.salaryMax ?? o.salaryMin ?? 0);
}

function fmtDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  // date-only "YYYY-MM-DD" diparse sebagai T00:00:00 LOKAL supaya tidak bergeser hari per timezone.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T00:00:00") : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function renderOpeningCard(o: PublicOpeningItem, idx: number): string {
  const amount = salaryAmount(o);
  const unit = amount ? SALARY_UNIT_LABEL[o.salaryUnit ?? ""] : null;
  const closingId = fmtDate(o.closingDate, "id-ID");
  const closingEn = closingId ? fmtDate(o.closingDate, "en-US") : null;
  const place = [o.location, o.city].filter(Boolean).join(" · ") || "—";
  const summary = o.jobDescSummary || o.jobSpecSummary;
  const emp = o.employmentStatus ? EMPLOYMENT_LABEL[o.employmentStatus] : null;
  const empHtml = o.employmentStatus
    ? `<span class="chip">${emp ? `<span data-id="${esc(emp[0])}" data-en="${esc(emp[1])}">${esc(emp[0])}</span>` : esc(o.employmentStatus)}</span>`
    : "";
  return `
      <article class="card" role="button" tabindex="0" data-idx="${idx}">
        <div class="card-top">
          <div class="ct-txt">
            <span class="refno">${esc(o.joRefNo)}</span>
            <h3 title="${esc(o.title)}">${esc(o.title)}</h3>
          </div>
          ${empHtml}
        </div>
        <p class="meta"><span aria-hidden="true">📍</span> ${esc(place)}</p>
        ${amount ? `<p class="meta"><span aria-hidden="true">💰</span> ${esc(amount)}${unit ? `<span data-id="${esc(unit[0])}" data-en="${esc(unit[1])}">${esc(unit[0])}</span>` : ""}</p>` : ""}
        ${closingId ? `<p class="meta"><span aria-hidden="true">🗓️</span> <span data-id="Ditutup ${esc(closingId)}" data-en="Closes ${esc(closingEn ?? closingId)}">Ditutup ${esc(closingId)}</span></p>` : ""}
        ${summary ? `<p class="summary">${esc(summary)}</p>` : ""}
        <button type="button" class="btn primary block" data-id="Lamar Sekarang" data-en="Apply Now">Lamar Sekarang</button>
      </article>`;
}

// ---- pembangun field form (label dwibahasa via data-id/data-en — pola halaman) ----

function fld(
  name: string, labelId: string, labelEn: string,
  opts: { req?: boolean; type?: string; attrs?: string; hint?: [string, string]; ph?: [string, string] } = {},
): string {
  const type = opts.type ?? "text";
  const reqHtml = opts.req ? ` <b class="req" aria-hidden="true">*</b>` : "";
  const hintHtml = opts.hint
    ? `\n          <p class="hint" data-id="${esc(opts.hint[0])}" data-en="${esc(opts.hint[1])}">${esc(opts.hint[0])}</p>`
    : "";
  const phHtml = opts.ph
    ? ` placeholder="${esc(opts.ph[0])}" data-id-ph="${esc(opts.ph[0])}" data-en-ph="${esc(opts.ph[1])}"`
    : "";
  return `
          <div class="field">
            <label for="ap-${name}"><span data-id="${esc(labelId)}" data-en="${esc(labelEn)}">${esc(labelId)}</span>${reqHtml}</label>
            <input id="ap-${name}" name="${name}" type="${type}"${opts.attrs ? ` ${opts.attrs}` : ""}${phHtml}>
            ${hintHtml}
            <p class="ferr" data-for="${name}"></p>
          </div>`;
}

function selField(
  name: string, labelId: string, labelEn: string,
  options: [string, string, string][], // [value, teks ID, teks EN]
): string {
  const optsHtml = options
    .map(([v, id, en]) => `            <option value="${esc(v)}" data-id="${esc(id)}" data-en="${esc(en)}">${esc(id)}</option>`)
    .join("\n");
  return `
          <div class="field">
            <label for="ap-${name}"><span data-id="${esc(labelId)}" data-en="${esc(labelEn)}">${esc(labelId)}</span></label>
            <select id="ap-${name}" name="${name}">
${optsHtml}
          </select>
            <p class="ferr" data-for="${name}"></p>
          </div>`;
}

const FORM_IDENTITY_FIELDS = [
  fld("firstName", "Nama Depan", "First Name", { req: true, attrs: 'maxlength="80" autocomplete="given-name"' }),
  fld("middleName", "Nama Tengah", "Middle Name", { attrs: 'maxlength="80" autocomplete="additional-name"' }),
  fld("lastName", "Nama Belakang", "Last Name", { attrs: 'maxlength="80" autocomplete="family-name"' }),
  fld("email", "Email", "Email", { req: true, type: "email", attrs: 'maxlength="120" autocomplete="email"' }),
  fld("phone", "No. Telepon", "Phone Number", { type: "tel", attrs: 'maxlength="32" autocomplete="tel"' }),
  fld("city", "Kota", "City", { attrs: 'maxlength="80" autocomplete="address-level2"' }),
  fld("birthDate", "Tanggal Lahir", "Date of Birth", { type: "date", attrs: 'autocomplete="bday"' }),
  selField("gender", "Jenis Kelamin", "Gender", [
    ["", "— Tidak diisi —", "— Not specified —"],
    ["L", "Laki-laki", "Male"],
    ["P", "Perempuan", "Female"],
  ]),
].join("\n");

const FORM_EDU_FIELDS = [
  selField("educationLevel", "Jenjang Pendidikan", "Education Level", [
    ["", "— Tidak diisi —", "— Not specified —"],
    ["SMP", "SMP", "Junior High School (SMP)"],
    ["SMA", "SMA", "Senior High School (SMA)"],
    ["SMK", "SMK", "Vocational High School (SMK)"],
    ["D3", "D3 — Diploma", "D3 — Diploma"],
    ["S1", "S1 — Sarjana", "S1 — Bachelor's"],
    ["S2", "S2 — Magister", "S2 — Master's"],
    ["S3", "S3 — Doktor", "S3 — Doctorate"],
    ["PROF", "Profesi", "Professional"],
  ]),
  fld("fieldOfStudy", "Bidang Studi", "Field of Study", { attrs: 'maxlength="80"' }),
  fld("institution", "Institusi", "Institution", { attrs: 'maxlength="120"' }),
  fld("graduationYear", "Tahun Lulus", "Graduation Year", { type: "number", attrs: 'inputmode="numeric" min="1900" max="2100"' }),
  fld("gpa", "IPK", "GPA", { type: "number", attrs: 'inputmode="decimal" step="0.01" min="0" max="4"', hint: ["Skala 0–4", "Scale 0–4"] }),
].join("\n");

const FORM_EXP_FIELDS = [
  fld("expYears", "Pengalaman Kerja (tahun)", "Work Experience (years)", { type: "number", attrs: 'inputmode="numeric" min="0" step="1"' }),
  fld("lastPosition", "Posisi Terakhir", "Last Position", { attrs: 'maxlength="120"' }),
  fld("lastCompany", "Perusahaan Terakhir", "Last Company", { attrs: 'maxlength="120"' }),
  fld("expectedSalary", "Ekspektasi Gaji", "Expected Salary", { type: "number", attrs: 'inputmode="numeric" min="0" step="1000"', hint: ["Dalam Rupiah per bulan", "In Rupiah per month"] }),
  `
          <div class="field span2">
            <label for="ap-notes"><span data-id="Catatan" data-en="Notes">Catatan</span></label>
            <textarea id="ap-notes" name="notes" rows="3" maxlength="2000" placeholder="Ceritakan singkat mengapa Anda cocok untuk peran ini…" data-id-ph="Ceritakan singkat mengapa Anda cocok untuk peran ini…" data-en-ph="Briefly tell us why you're a good fit for this role…"></textarea>
            <p class="ferr" data-for="notes"></p>
          </div>`,
].join("\n");

// ============ halaman penuh ============

function renderPage(data: OpeningsResponse | null, tenantSlug: string | null, site: SiteConfig | null): string {
  const companyName = data?.tenant?.companyName ?? null;
  const openings = data?.openings ?? [];
  const tenants = data?.tenants ?? [];
  const activeSlug = data?.tenant?.slug ?? tenantSlug;
  const live = data != null;
  const year = new Date().getFullYear();

  // B7 — branding per tenant: warna (palet turunan), logo, hero. Tanpa
  // branding → palet default persis portal F2 (orange) — tidak mengubah look.
  const brandHex = validBrand(site?.brandColor);
  const pal = brandPalette(brandHex);
  const logoUrl = site?.logoUrl && /^https?:\/\//.test(site.logoUrl) ? site.logoUrl : null;
  const heroTitleCustom = site?.heroTitle?.trim() || null;
  const heroSubCustom = site?.heroSub?.trim() || null;
  const faviconColor = pal.brand.slice(1);

  // data untuk client JS (kartu klik → dialog; ?t= untuk POST apply)
  const dataJson = JSON.stringify({
    live,
    slug: activeSlug,
    company: companyName,
    openings: openings.map((o) => ({
      slotId: o.slotId,
      joRefNo: o.joRefNo,
      title: o.title,
      knockouts: (o.knockouts ?? []).map((k) => ({ questionId: k.questionId, question: k.question })), // F6b — pertanyaan wajib posisi
    })),
  }).replace(/</g, "\\u003c");

  const chipsHtml = live && tenants.length > 1
    ? `
    <nav class="chips" aria-label="Pilih perusahaan / choose a company">
      <span class="chips-label" data-id="Perusahaan" data-en="Company">Perusahaan</span>
      ${tenants.map((tn) => `<a class="chipbtn${tn.slug === activeSlug ? " on" : ""}" href="/?t=${encodeURIComponent(tn.slug)}">${esc(tn.companyName)}</a>`).join("")}
    </nav>`
    : "";

  const listHtml = live
    ? openings.length
      ? openings.map((o, i) => renderOpeningCard(o, i)).join("\n")
      : `
        <div class="empty" role="status">
          <p class="empty-title" data-id="Belum ada lowongan terbuka saat ini" data-en="No open positions right now">Belum ada lowongan terbuka saat ini</p>
          <p class="empty-sub" data-id="Silakan kembali lagi nanti — atau kirim lamaran umum agar profil Anda tersimpan di talent pool kami." data-en="Please check back later — or send a general application so your profile is kept in our talent pool.">Silakan kembali lagi nanti — atau kirim lamaran umum agar profil Anda tersimpan di talent pool kami.</p>
        </div>`
    : "";

  const listSectionHtml = live
    ? `
    ${chipsHtml}
    <section class="listwrap" aria-labelledby="openings-h">
      <h2 id="openings-h" class="list-title"><span data-id="Lowongan Terbuka" data-en="Open Positions">Lowongan Terbuka</span> <span class="count">(${openings.length})</span></h2>
      <div class="grid" id="openings">
${listHtml}
      </div>
    </section>
    <section class="genbox">
      <div class="genbox-txt">
        <p class="genbox-title" data-id="Tidak menemukan posisi yang cocok?" data-en="Didn't find a matching position?">Tidak menemukan posisi yang cocok?</p>
        <p class="genbox-sub" data-id="Kirim lamaran umum — profil Anda akan tersimpan di talent pool kami." data-en="Send a general application — your profile will be kept in our talent pool.">Kirim lamaran umum — profil Anda akan tersimpan di talent pool kami.</p>
      </div>
      <button type="button" class="btn warm" id="apply-general" data-id="Lamar Umum" data-en="General Application">Lamar Umum</button>
    </section>
    <section class="statusbox" id="cek-status" aria-labelledby="cek-status-h">
      <h2 id="cek-status-h" class="list-title"><span data-id="Cek Status Lamaran" data-en="Check Application Status">Cek Status Lamaran</span></h2>
      <p class="statusbox-sub" data-id="Sudah mengirim lamaran? Masukkan email Anda — kami mengirim tautan sekali-pakai untuk melihat status lamaran (berlaku 6 jam)." data-en="Already applied? Enter your email — we'll send a one-time link to view your application status (valid for 6 hours).">Sudah mengirim lamaran? Masukkan email Anda — kami mengirim tautan sekali-pakai untuk melihat status lamaran (berlaku 6 jam).</p>
      <form id="status-form" class="statusform" novalidate>
        <input id="st-email" name="email" type="email" maxlength="120" autocomplete="email" inputmode="email"
          placeholder="nama@email.com" data-id-ph="nama@email.com" data-en-ph="you@email.com" aria-label="Email / Email">
        <button type="submit" class="btn primary" id="st-submit" data-id="Kirim Tautan" data-en="Send Link">Kirim Tautan</button>
        <!-- HONEYPOT — tersembunyi; bot yang mengisinya diabaikan server (respons tetap netral). -->
        <div class="hp" aria-hidden="true"><label for="st-website">Website</label><input id="st-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
      </form>
      <p class="st-msg" id="st-msg" role="status" aria-live="polite"></p>
    </section>`
    : "";

  const noticeHtml = live
    ? ""
    : `
      <p class="notice" role="status" data-id="Daftar lowongan live sementara tidak tersedia — layanan rekrutmen internal sedang tidak aktif. Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal." data-en="Live openings are temporarily unavailable — the internal recruitment service is offline. This page is the Candidate Portal — a separate application from the internal HR system.">Daftar lowongan live sementara tidak tersedia — layanan rekrutmen internal sedang tidak aktif. Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal.</p>
      <p class="retry-row"><button type="button" class="btn ghost" id="retry-btn" data-id="Coba Lagi" data-en="Try Again">Coba Lagi</button></p>`;

  const companyStrong = companyName
    ? `<strong>${esc(companyName)}</strong>`
    : `<strong data-id="perusahaan" data-en="the company">perusahaan</strong>`;

  // B7 — hero: judul/sub custom (CareerSiteConfig) atau default dwibahasa F2
  const heroTitleHtml = heroTitleCustom
    ? `<h1>${esc(heroTitleCustom)}</h1>`
    : `<h1 data-id="Berkarir <em>bersama kami</em>" data-en="Build your career <em>with us</em>">Berkarir <em>bersama kami</em></h1>`;
  const heroSubHtml = heroSubCustom
    ? `<p class="sub">${esc(heroSubCustom)}</p>`
    : `<p class="sub" data-id="Lamar langsung tanpa membuat akun — cukup satu formulir, CV, dan konfirmasi email. Data Anda kami perlakukan sesuai UU PDP No. 27/2022." data-en="Apply directly without creating an account — just one form, your CV, and an email confirmation. Your data is handled under Indonesia's PDP Law No. 27/2022.">Lamar langsung tanpa membuat akun — cukup satu formulir, CV, dan konfirmasi email. Data Anda kami perlakukan sesuai UU PDP No. 27/2022.</p>`;

  // B7 — logo tenant (bila diatur) menggantikan titik wordmark default
  const wordmarkHtml = logoUrl
    ? `<img class="logo-img" src="${esc(logoUrl)}" alt="${companyName ? esc(companyName) : "Logo"}" loading="lazy">`
    : `<span class="dot" aria-hidden="true"></span>`;

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>${companyName ? `Karir — ${esc(companyName)}` : "Portal Karir"} · RekanKerja</title>
<meta name="description" content="${companyName ? `Lowongan terbuka di ${esc(companyName)}.` : "Portal karir publik."} Lamar tanpa akun — konfirmasi via email.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23${faviconColor}'/%3E%3C/svg%3E">
<style>
  :root { --brand:${pal.brand}; --accent:var(--brand); --accent-dark:${pal.dark}; --t95:${pal.t95}; --t91:${pal.t91}; --t87:${pal.t87}; --t65:${pal.t65}; --deep:${pal.deep}; --deep2:${pal.deep2}; --ink:#1c1917; --muted:#78716c; --bg:#faf9f5; --card:#ffffff; --line:#e7e5e0; --bad:#dc2626; --ok:#059669; }
  * { box-sizing:border-box; margin:0; padding:0; }
  html,body { height:100%; }
  body { font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; background:var(--bg); color:var(--ink); display:flex; flex-direction:column; min-height:100vh; line-height:1.55; }
  body.no-scroll { overflow:hidden; }
  header.site { background:var(--card); border-bottom:1px solid var(--line); padding:.9rem 1.25rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; position:sticky; top:0; z-index:5; }
  .wordmark { font-weight:800; letter-spacing:-.02em; font-size:1.05rem; display:flex; align-items:center; gap:.55rem; min-width:0; }
  .wordmark .dot { width:.65rem; height:.65rem; border-radius:9999px; background:var(--accent); flex-shrink:0; }
  .wordmark .co { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lang { background:transparent; border:1px solid var(--line); border-radius:.6rem; padding:.35rem .7rem; font-size:.78rem; font-weight:600; color:var(--muted); cursor:pointer; min-height:44px; }
  .lang:hover { border-color:var(--accent); color:var(--accent); }
  main { flex:1; width:100%; max-width:56rem; margin:0 auto; padding:2.25rem 1.25rem 3rem; }
  a { color:var(--accent); }
  .hero-tag { display:inline-flex; align-items:center; gap:.4rem; border:1px solid var(--t87); background:var(--t95); color:var(--deep); border-radius:9999px; padding:.28rem .8rem; font-size:.66rem; font-weight:800; text-transform:uppercase; letter-spacing:.12em; margin-bottom:.85rem; }
  .hero h1 { font-size:clamp(1.6rem,4vw,2.3rem); letter-spacing:-.03em; line-height:1.15; }
  .hero h1 em { font-style:normal; color:var(--accent); }
  .hero p.sub { color:var(--muted); margin-top:.6rem; max-width:38rem; }
  .notice { margin-top:1.25rem; border:1px dashed var(--accent); background:var(--t95); color:var(--deep2); border-radius:.85rem; padding:.85rem 1rem; font-size:.85rem; }
  .retry-row { margin-top:.8rem; }
  .chips { margin-top:1.75rem; display:flex; flex-wrap:wrap; align-items:center; gap:.5rem; }
  .chips-label { font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-right:.2rem; }
  .chipbtn { font-size:.8rem; font-weight:600; color:#57534e; background:var(--card); border:1px solid var(--line); border-radius:9999px; padding:.42rem .95rem; text-decoration:none; transition:all .15s ease; }
  .chipbtn:hover { border-color:var(--accent); color:var(--accent); transform:translateY(-1px); }
  .chipbtn.on { background:var(--accent); border-color:var(--accent); color:#fff; }
  .listwrap { margin-top:.25rem; }
  .list-title { font-size:1.25rem; letter-spacing:-.02em; margin-top:1.6rem; }
  .count { color:var(--accent); font-size:.95rem; font-weight:700; }
  .grid { margin-top:1rem; display:grid; gap:1rem; grid-template-columns:repeat(auto-fill,minmax(19rem,1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:1rem; padding:1.15rem 1.2rem; display:flex; flex-direction:column; gap:.5rem; cursor:pointer; transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease; }
  .card:hover, .card:focus-visible { transform:translateY(-2px); box-shadow:0 10px 24px -14px rgba(28,25,23,.25); border-color:var(--t65); outline:none; }
  .card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:.75rem; }
  .ct-txt { min-width:0; }
  .refno { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.64rem; font-weight:700; text-transform:uppercase; letter-spacing:.07em; color:var(--accent); }
  .card h3 { font-size:1.02rem; letter-spacing:-.01em; margin-top:.1rem; }
  .chip { flex-shrink:0; font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); border:1px solid var(--t87); background:var(--t95); border-radius:9999px; padding:.22rem .6rem; }
  .meta { font-size:.83rem; color:var(--muted); }
  .summary { font-size:.86rem; color:#44403c; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .empty { grid-column:1/-1; text-align:center; border:1px dashed var(--line); border-radius:1rem; padding:3rem 1.5rem; background:var(--card); }
  .empty-title { font-weight:700; }
  .empty-sub { color:var(--muted); font-size:.9rem; margin-top:.4rem; }
  .genbox { margin-top:1.6rem; border:1px dashed var(--t87); background:var(--t95); border-radius:1rem; padding:1.2rem 1.3rem; display:flex; flex-wrap:wrap; gap:.9rem 1.5rem; align-items:center; justify-content:space-between; }
  .genbox-title { font-weight:700; }
  .genbox-sub { color:var(--muted); font-size:.85rem; margin-top:.15rem; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:.4rem; font:inherit; font-size:.88rem; font-weight:700; border-radius:.75rem; padding:.6rem 1.1rem; cursor:pointer; border:1px solid transparent; transition:background .15s ease, border-color .15s ease, color .15s ease; min-height:44px; }
  .btn.primary { background:var(--accent); color:#fff; }
  .btn.primary:hover { background:var(--accent-dark); }
  .btn.ghost { background:var(--card); border-color:var(--line); color:#44403c; }
  .btn.ghost:hover { border-color:var(--accent); color:var(--accent); }
  .btn.warm { background:var(--t95); border-color:var(--t65); color:var(--accent-dark); }
  .btn.warm:hover { background:var(--t91); border-color:var(--accent); }
  .btn.block { width:100%; margin-top:.6rem; }
  .btn[disabled] { opacity:.6; cursor:not-allowed; }
  footer.site { margin-top:auto; background:var(--card); border-top:1px solid var(--line); padding:1rem 1.25rem; padding-bottom:calc(1rem + env(safe-area-inset-bottom)); display:flex; flex-wrap:wrap; gap:.5rem 1.25rem; align-items:center; justify-content:space-between; font-size:.75rem; color:var(--muted); }
  footer.site .pdp { max-width:34rem; }
  .logo-img { height:2rem; width:auto; max-width:9rem; object-fit:contain; border-radius:.4rem; flex-shrink:0; }

  /* ---------- B7 — cek status lamaran ---------- */
  .statusbox { margin-top:1.6rem; border:1px solid var(--t87); background:var(--card); border-radius:1rem; padding:1.2rem 1.3rem; }
  .statusbox-sub { color:var(--muted); font-size:.85rem; margin-top:.4rem; }
  .statusform { margin-top:.9rem; display:flex; flex-wrap:wrap; gap:.6rem; }
  .statusform input { flex:1 1 14rem; font:inherit; font-size:.9rem; color:var(--ink); background:#fff; border:1px solid var(--line); border-radius:.6rem; padding:.6rem .75rem; min-height:44px; }
  .statusform input:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(${pal.rgb},.14); }
  .statusform input.bad { border-color:var(--bad); }
  .st-msg { margin-top:.75rem; font-size:.82rem; font-weight:600; color:var(--deep); }
  .st-msg.err { color:var(--bad); }

  /* ---------- dialog lamaran ---------- */
  .overlay { position:fixed; inset:0; z-index:60; background:rgba(28,25,23,.52); display:none; padding:1rem; }
  .overlay.open { display:flex; align-items:flex-start; justify-content:center; overflow-y:auto; }
  .modal { background:var(--card); width:100%; max-width:560px; margin:min(7vh,3.5rem) auto; border-radius:1rem; box-shadow:0 24px 60px -20px rgba(28,25,23,.45); display:flex; flex-direction:column; max-height:85vh; overflow:hidden; }
  .modal-head { flex-shrink:0; display:flex; align-items:flex-start; justify-content:space-between; gap:.75rem; padding:1.05rem 1.25rem .85rem; border-bottom:1px solid var(--line); }
  .mh-txt { min-width:0; }
  .mh-txt h3 { font-size:1.08rem; letter-spacing:-.015em; line-height:1.3; }
  .modal-sub { font-size:.78rem; color:var(--muted); display:flex; flex-wrap:wrap; gap:.15rem .6rem; margin-top:.2rem; }
  .xbtn { flex-shrink:0; border:1px solid var(--line); background:transparent; color:var(--muted); border-radius:.55rem; width:2rem; height:2rem; font-size:.9rem; cursor:pointer; line-height:1; }
  .xbtn:hover { border-color:var(--accent); color:var(--accent); }
  .modal-body { overflow-y:auto; padding:1.1rem 1.25rem 1.3rem; }
  .banner { display:none; border:1px solid #fecaca; background:#fef2f2; color:#b91c1c; border-radius:.7rem; padding:.6rem .85rem; font-size:.82rem; font-weight:600; margin-bottom:.9rem; }
  .banner.show { display:block; }
  .sect { display:flex; align-items:center; gap:.5rem; font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin:1.25rem 0 .75rem; }
  form .sect:first-child { margin-top:0; }
  .sect .ico { width:1.55rem; height:1.55rem; display:inline-flex; align-items:center; justify-content:center; background:var(--t91); border-radius:.5rem; font-size:.75rem; flex-shrink:0; }
  .fgrid { display:grid; grid-template-columns:1fr; gap:.7rem 1rem; }
  @media (min-width:640px) { .fgrid { grid-template-columns:1fr 1fr; } .span2 { grid-column:1 / -1; } }
  .field { display:flex; flex-direction:column; gap:.28rem; min-width:0; }
  .field label { font-size:.78rem; font-weight:600; color:#44403c; }
  .req { color:var(--accent); }
  .field input, .field select, .field textarea { font:inherit; font-size:.9rem; color:var(--ink); background:#fff; border:1px solid var(--line); border-radius:.6rem; padding:.55rem .7rem; width:100%; }
  .field input:focus, .field select:focus, .field textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(${pal.rgb},.14); }
  .field input.bad, .field select.bad, .field textarea.bad { border-color:var(--bad); }
  .ferr { font-size:.72rem; color:var(--bad); font-weight:600; }
  .hint { font-size:.72rem; color:#a8a29e; }
  .fname { display:none; font-size:.75rem; color:var(--ok); font-weight:600; }
  .fname.show { display:block; }
  .filebox { border:1px dashed var(--line); background:#fafaf9; border-radius:.7rem; padding:.55rem .65rem; }
  .filebox input[type=file] { font-size:.78rem; color:var(--muted); width:100%; }
  input[type=file]::file-selector-button { font:inherit; font-size:.72rem; font-weight:700; color:#fff; background:var(--accent); border:0; border-radius:.5rem; padding:.45rem .8rem; margin-right:.7rem; cursor:pointer; }
  input[type=file]::file-selector-button:hover { background:var(--accent-dark); }
  .cap-row { display:flex; gap:.5rem; align-items:stretch; }
  .cap-q { flex:1; min-width:0; display:flex; align-items:center; background:var(--t95); border:1px solid var(--t87); border-radius:.6rem; padding:.55rem .8rem; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.95rem; font-weight:700; letter-spacing:.05em; color:var(--deep2); }
  .cap-in { flex-shrink:0; width:5.2rem; text-align:center; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-weight:700; }
  .cap-btn { flex-shrink:0; width:44px; border:1px solid var(--line); background:var(--card); border-radius:.6rem; cursor:pointer; font-size:1.05rem; color:var(--muted); }
  .cap-btn:hover { border-color:var(--accent); color:var(--accent); }
  .cap-btn.spin { animation:cpspin 1s linear infinite; }
  @keyframes cpspin { to { transform:rotate(360deg); } }
  .consent { display:flex; flex-wrap:wrap; align-items:flex-start; gap:.6rem; background:#fff; border:1px solid var(--line); border-radius:.7rem; padding:.8rem .9rem; }
  .ko-box { background:#fff; border:1px solid var(--line); border-radius:.7rem; padding:.9rem; display:flex; flex-direction:column; gap:.65rem; }
  .ko-title { font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--accent); }
  .ko-q { font-size:.8rem; color:#44403c; line-height:1.5; }
  .ko-opts { display:flex; gap:1rem; margin-top:.25rem; }
  .ko-opt { display:flex; align-items:center; gap:.4rem; cursor:pointer; font-size:.8rem; font-weight:600; color:#44403c; }
  .ko-opt input { width:1.05rem; height:1.05rem; accent-color:var(--accent); cursor:pointer; }
  .consent input[type=checkbox] { width:1.05rem; height:1.05rem; margin-top:.22rem; accent-color:var(--accent); flex-shrink:0; cursor:pointer; }
  .consent input[type=checkbox].bad { outline:2px solid var(--bad); outline-offset:2px; border-radius:.2rem; }
  .consent-txt { font-size:.78rem; color:#44403c; line-height:1.55; cursor:pointer; }
  .consent .ferr { flex-basis:100%; }
  .hp { position:absolute; left:-9999px; top:-9999px; width:1px; height:1px; overflow:hidden; }
  .actions { display:flex; gap:.6rem; justify-content:flex-end; margin-top:1.3rem; flex-wrap:wrap; }
  .okwrap { display:none; text-align:center; padding:1.6rem .5rem 1rem; flex-direction:column; gap:.7rem; align-items:center; }
  .okwrap.show { display:flex; }
  .okcircle { width:4rem; height:4rem; border-radius:9999px; background:var(--t91); color:var(--accent); font-size:2rem; font-weight:800; display:flex; align-items:center; justify-content:center; }
  .okwrap h3 { font-size:1.25rem; letter-spacing:-.02em; }
  .okwrap p { color:var(--muted); font-size:.88rem; max-width:26rem; }
</style>
</head>
<body>
  <header class="site">
    <div class="wordmark" aria-label="Portal Karir">${wordmarkHtml}<span class="co">Karir${companyName ? ` · ${esc(companyName)}` : ""}</span></div>
    <button class="lang" id="lang-toggle" type="button" aria-label="Ganti bahasa / switch language">EN</button>
  </header>
  <main>
    <section class="hero">
      <span class="hero-tag" data-id="Rekrutmen Terbuka" data-en="We're Hiring">Rekrutmen Terbuka</span>
      ${heroTitleHtml}
      ${heroSubHtml}
      ${noticeHtml}
    </section>
    ${listSectionHtml}
  </main>
  <footer class="site">
    <span>© ${year} ${companyName ? esc(companyName) : "Portal Karir"} — RekanKerja</span>
    <span class="pdp" data-id="Data pribadi yang Anda kirim diproses hanya untuk keperluan rekrutmen dan dilindungi sesuai UU No. 27/2022 tentang Pelindungan Data Pribadi." data-en="Personal data you submit is processed solely for recruitment and is protected under Indonesian Personal Data Protection Law No. 27/2022.">Data pribadi yang Anda kirim diproses hanya untuk keperluan rekrutmen dan dilindungi sesuai UU No. 27/2022 tentang Pelindungan Data Pribadi.</span>
  </footer>

  <!-- ============ DIALOG FORM LAMARAN (custom modal — bukan <dialog>) ============ -->
  <div class="overlay" id="apply-overlay" role="dialog" aria-modal="true" aria-labelledby="apply-title">
    <div class="modal">
      <div class="modal-head">
        <div class="mh-txt">
          <h3 id="apply-title">—</h3>
          <p class="modal-sub"><span id="apply-ref" class="refno"></span><span id="apply-desc"></span></p>
        </div>
        <button type="button" class="xbtn" id="apply-close" aria-label="Tutup / Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="banner" id="apply-banner" role="alert"></div>
        <form id="apply-form" novalidate>
          <h4 class="sect"><span class="ico" aria-hidden="true">👤</span><span data-id="Data Diri" data-en="Personal Details">Data Diri</span></h4>
          <div class="fgrid">
${FORM_IDENTITY_FIELDS}
          </div>

          <h4 class="sect"><span class="ico" aria-hidden="true">🎓</span><span data-id="Pendidikan" data-en="Education">Pendidikan</span></h4>
          <div class="fgrid">
${FORM_EDU_FIELDS}
          </div>

          <h4 class="sect"><span class="ico" aria-hidden="true">💼</span><span data-id="Pengalaman" data-en="Experience">Pengalaman</span></h4>
          <div class="fgrid">
${FORM_EXP_FIELDS}
          </div>

          <h4 class="sect"><span class="ico" aria-hidden="true">📎</span><span data-id="Dokumen &amp; Konfirmasi" data-en="Documents &amp; Confirmation">Dokumen &amp; Konfirmasi</span></h4>
          <div class="fgrid">
            <div class="field span2">
              <label for="ap-cv"><span data-id="CV / Resume (opsional)" data-en="CV / Resume (optional)">CV / Resume (opsional)</span></label>
              <div class="filebox"><input id="ap-cv" name="cv" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf"></div>
              <p class="hint" data-id="JPG, PNG, WEBP, atau PDF — maksimal 5 MB." data-en="JPG, PNG, WEBP, or PDF — max 5 MB.">JPG, PNG, WEBP, atau PDF — maksimal 5 MB.</p>
              <p class="fname" id="ap-cv-name"></p>
              <p class="ferr" id="ap-cv-err" role="alert"></p>
            </div>

            <div class="field span2" id="ap-knockouts-wrap" style="display:none">
              <div class="ko-box">
                <div class="ko-title"><span data-id="Pertanyaan Wajib Posisi" data-en="Required Position Questions">Pertanyaan Wajib Posisi</span></div>
                <div id="ap-knockouts"></div>
                <p class="hint" data-id="Jawaban jujur menghemat waktu Anda — posisi ini memiliki syarat objektif tertentu." data-en="An honest answer saves your time — this position has specific objective requirements.">Jawaban jujur menghemat waktu Anda — posisi ini memiliki syarat objektif tertentu.</p>
              </div>
            </div>

            <div class="field span2">
              <label for="ap-captcha"><span data-id="Verifikasi Keamanan" data-en="Security Verification">Verifikasi Keamanan</span> <b class="req" aria-hidden="true">*</b></label>
              <div class="cap-row">
                <div class="cap-q" id="captcha-q" aria-live="polite">…</div>
                <input class="cap-in" id="ap-captcha" name="captchaAnswer" inputmode="numeric" pattern="[0-9]*" placeholder="?" autocomplete="off">
                <button type="button" class="cap-btn" id="cap-refresh" title="Segarkan soal" aria-label="Segarkan soal captcha">↻</button>
              </div>
              <p class="hint" data-id="Jawab pertanyaan di atas (angka). Tantangan berlaku 10 menit — segarkan bila kedaluwarsa." data-en="Answer the question above (a number). The challenge is valid for 10 minutes — refresh it if expired.">Jawab pertanyaan di atas (angka). Tantangan berlaku 10 menit — segarkan bila kedaluwarsa.</p>
              <p class="ferr" data-for="captcha"></p>
            </div>

            <div class="consent span2">
              <input type="checkbox" id="ap-consent">
              <label for="ap-consent" class="consent-txt"><span data-id="Saya setuju data pribadi saya pada formulir ini diproses oleh" data-en="I consent to my personal data in this form being processed by">Saya setuju data pribadi saya pada formulir ini diproses oleh</span> ${companyStrong} <span data-id="untuk keperluan proses rekrutmen sesuai UU No. 27/2022 (UU PDP). Persetujuan ini dapat saya tarik kembali kapan saja." data-en="for recruitment purposes under Law No. 27/2022 (Indonesian PDP Law). I may withdraw this consent at any time.">untuk keperluan proses rekrutmen sesuai UU No. 27/2022 (UU PDP). Persetujuan ini dapat saya tarik kembali kapan saja.</span></label>
              <p class="ferr" data-for="consent"></p>
            </div>

            <!-- HONEYPOT — tersembunyi dari manusia; bot yang mengisinya ditandai Spam server (respons 201 identik). -->
            <div class="hp" aria-hidden="true">
              <label for="hp-website">Website</label>
              <input id="hp-website" name="website" type="text" tabindex="-1" autocomplete="off">
            </div>
          </div>

          <div class="actions">
            <button type="button" class="btn ghost" id="apply-cancel" data-id="Batal" data-en="Cancel">Batal</button>
            <button type="submit" class="btn primary" id="apply-submit">Kirim Lamaran</button>
          </div>
        </form>

        <div class="okwrap" id="apply-success">
          <div class="okcircle" aria-hidden="true">✓</div>
          <h3 data-id="Lamaran Terkirim!" data-en="Application Sent!">Lamaran Terkirim!</h3>
          <p data-id="Terima kasih! Lamaran Anda telah kami terima dan akan ditinjau oleh tim HR. Konfirmasi akan dikirim ke email Anda." data-en="Thank you! Your application has been received and will be reviewed by the HR team. A confirmation will be sent to your email.">Terima kasih! Lamaran Anda telah kami terima dan akan ditinjau oleh tim HR. Konfirmasi akan dikirim ke email Anda.</p>
          <button type="button" class="btn primary" id="apply-ok" data-id="Tutup" data-en="Close">Tutup</button>
        </div>
      </div>
    </div>
  </div>

  <script id="portal-data" type="application/json">${dataJson}</script>
  <script>
    (function () {
      "use strict";
      // ---- data SSR (openings utk klik kartu; slug utk ?t= pada POST apply) ----
      var KEY = "portal-lang", cur = "id";
      try { cur = localStorage.getItem(KEY) || "id"; } catch (e) {}
      var DATA = {};
      try { DATA = JSON.parse(document.getElementById("portal-data").textContent) || {}; } catch (e) {}
      var ACTIVE_SLUG = DATA.slug || null;
      var OPENINGS = DATA.openings || [];

      var EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
      var CV_EXTS = ["jpg", "jpeg", "png", "webp", "pdf"];
      var CV_MAX = 5 * 1024 * 1024;

      // pesan error server (ID) -> padanan EN (pola SERVER_ERRORS career-portal.tsx)
      var SERVER_ERRORS = {
        "Terlalu banyak permintaan. Coba lagi nanti.": "Too many requests. Please try again later.",
        "Terlalu banyak lamaran terkirim. Silakan coba lagi nanti.": "Too many applications submitted. Please try again later.",
        "Verifikasi keamanan salah atau kedaluwarsa. Silakan coba lagi.": "Security verification is incorrect or expired. Please try again.",
        "Persetujuan pemrosesan data pribadi wajib diberikan.": "Consent to personal data processing is required.",
        "Nama depan wajib diisi": "First name is required.",
        "Email valid wajib diisi": "A valid email address is required.",
        "Lowongan sudah tidak tersedia. Silakan pilih lowongan lain.": "This opening is no longer available. Please choose another one.",
        "CV harus JPG/PNG/WEBP/PDF dan maksimum 5 MB": "The CV must be a JPG/PNG/WEBP/PDF file of at most 5 MB.",
        "Perusahaan tidak ditemukan. Pilih perusahaan pada halaman karier.": "Company not found. Please choose a company on the career page.",
        "Request harus multipart/form-data": "Invalid request format."
      };
      function t(id, en) { return cur === "id" ? id : en; }
      function serverMsg(msg) { return cur === "en" && SERVER_ERRORS[msg] ? SERVER_ERRORS[msg] : msg; }

      // ---- elemen ----
      var langBtn = document.getElementById("lang-toggle");
      var overlay = document.getElementById("apply-overlay");
      var form = document.getElementById("apply-form");
      var titleEl = document.getElementById("apply-title");
      var refEl = document.getElementById("apply-ref");
      var descEl = document.getElementById("apply-desc");
      var banner = document.getElementById("apply-banner");
      var successBox = document.getElementById("apply-success");
      var submitBtn = document.getElementById("apply-submit");
      var cancelBtn = document.getElementById("apply-cancel");
      var capQ = document.getElementById("captcha-q");
      var capRefresh = document.getElementById("cap-refresh");
      var capInput = document.getElementById("ap-captcha");
      var cvInput = document.getElementById("ap-cv");
      var cvName = document.getElementById("ap-cv-name");
      var cvErr = document.getElementById("ap-cv-err");
      var consentBox = document.getElementById("ap-consent");
      var hpInput = document.getElementById("hp-website");

      var ALL_FIELDS = ["firstName","middleName","lastName","email","phone","city","birthDate","gender","educationLevel","fieldOfStudy","institution","graduationYear","gpa","expYears","lastPosition","lastCompany","expectedSalary","notes","captcha"];
      var capToken = null, capBusy = false, cvFile = null, cvBad = null;
      var target = null, submitting = false, submitted = false;

      // ---- bahasa (pola data-id/data-en + placeholder varian) ----
      function updateSubmitLabel() {
        submitBtn.textContent = submitting ? t("Mengirim…", "Sending…") : t("Kirim Lamaran", "Submit Application");
      }
      function apply(lang) {
        cur = lang;
        document.documentElement.lang = lang;
        document.querySelectorAll("[data-id]").forEach(function (el) {
          var v = el.getAttribute(lang === "id" ? "data-id" : "data-en");
          if (v != null) el.innerHTML = v;
        });
        document.querySelectorAll("[data-id-ph]").forEach(function (el) {
          var v = el.getAttribute(lang === "id" ? "data-id-ph" : "data-en-ph");
          if (v != null) el.setAttribute("placeholder", v);
        });
        langBtn.textContent = lang === "id" ? "EN" : "ID";
        if (cvBad) cvErr.textContent = t(cvBad.id, cvBad.en);
        updateSubmitLabel();
        try { localStorage.setItem(KEY, lang); } catch (e) {}
      }
      langBtn.addEventListener("click", function () { apply(cur === "id" ? "en" : "id"); });

      // ---- util field ----
      function el(name) { return document.getElementById("ap-" + name); }
      function val(name) { var e = el(name); return e ? String(e.value == null ? "" : e.value).trim() : ""; }
      function fErr(name) { return document.querySelector('.ferr[data-for="' + name + '"]'); }
      function setErr(name, msg) {
        var p = fErr(name); if (p) p.textContent = msg;
        var e = el(name); if (e) e.classList.add("bad");
        if (name === "consent") consentBox.classList.add("bad");
      }
      function clearErr(name) {
        var p = fErr(name); if (p) p.textContent = "";
        var e = el(name); if (e) e.classList.remove("bad");
        if (name === "consent") consentBox.classList.remove("bad");
      }
      ALL_FIELDS.forEach(function (n) {
        var e = el(n);
        if (e) {
          e.addEventListener("input", function () { clearErr(n); });
          e.addEventListener("change", function () { clearErr(n); });
        }
      });
      consentBox.addEventListener("change", function () { clearErr("consent"); });
      capInput.addEventListener("input", function () {
        capInput.value = capInput.value.replace(/[^0-9]/g, "");
      });
      var bd = el("birthDate");
      if (bd) bd.max = new Date().toISOString().slice(0, 10);

      function showBanner(msg) {
        banner.textContent = msg;
        banner.classList.add("show");
        if (banner.scrollIntoView) banner.scrollIntoView({ block: "nearest" });
      }
      function hideBanner() { banner.classList.remove("show"); banner.textContent = ""; }

      // ---- captcha: challenge baru (dialog dibuka + tombol ↻ + auto setelah 400) ----
      function refreshCaptcha() {
        if (capBusy) return;
        capBusy = true;
        capQ.textContent = "…";
        capRefresh.classList.add("spin");
        fetch("/api/public/recruitment/captcha")
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (res.ok && res.j && res.j.token) {
              capToken = res.j.token;
              capQ.textContent = res.j.question || "?";
              clearErr("captcha");
            } else {
              capToken = null;
              capQ.textContent = "?";
              setErr("captcha", serverMsg((res.j && res.j.error) || "Gagal memuat verifikasi keamanan."));
            }
          })
          .catch(function () {
            capToken = null;
            capQ.textContent = "?";
            setErr("captcha", t("Gagal memuat verifikasi keamanan. Periksa koneksi Anda.", "Failed to load the security verification. Check your connection."));
          })
          .then(function () { capBusy = false; capRefresh.classList.remove("spin"); });
      }
      capRefresh.addEventListener("click", refreshCaptcha);

      // ---- CV: pre-check klien (ekstensi + ukuran; server tetap otoritatif) ----
      cvInput.addEventListener("change", function () {
        var f = (cvInput.files && cvInput.files[0]) || null;
        cvInput.value = ""; // izinkan memilih ulang file yang sama
        cvFile = null; cvBad = null;
        cvErr.textContent = "";
        cvName.textContent = ""; cvName.classList.remove("show");
        if (!f) return;
        var parts = f.name.toLowerCase().split(".");
        var ext = parts.length > 1 ? parts[parts.length - 1] : "";
        if (CV_EXTS.indexOf(ext) === -1) {
          cvBad = { id: "Format CV harus JPG, PNG, WEBP, atau PDF.", en: "CV format must be JPG, PNG, WEBP, or PDF." };
          cvErr.textContent = t(cvBad.id, cvBad.en);
          return;
        }
        if (f.size > CV_MAX) {
          cvBad = { id: "Ukuran CV maksimum 5 MB.", en: "CV must be at most 5 MB." };
          cvErr.textContent = t(cvBad.id, cvBad.en);
          return;
        }
        cvFile = f;
        cvName.textContent = f.name + " · " + (f.size / 1048576).toFixed(2) + " MB";
        cvName.classList.add("show");
      });

      // ---- dialog ----
      function resetForm() {
        form.reset();
        cvFile = null; cvBad = null;
        cvErr.textContent = ""; cvName.textContent = ""; cvName.classList.remove("show");
        ALL_FIELDS.forEach(clearErr);
        clearErr("consent");
        hideBanner();
        submitted = false;
        renderKnockouts(null);
      }
      // F6b — render pertanyaan knockout slot yang dilamar (radio Ya/Tidak per pertanyaan)
      function escHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
      }
      function renderKnockouts(slot) {
        var wrap = document.getElementById("ap-knockouts-wrap");
        var box = document.getElementById("ap-knockouts");
        if (!wrap || !box) return;
        var kos = (slot && slot.knockouts && slot.knockouts.length) ? slot.knockouts : null;
        box.innerHTML = "";
        wrap.style.display = kos ? "" : "none";
        if (!kos) return;
        kos.forEach(function (k, i) {
          var qid = "ko_" + k.questionId;
          var div = document.createElement("div");
          div.className = "ko-q";
          div.innerHTML =
            '<div>' + (i + 1) + '. ' + escHtml(k.question) + '</div>' +
            '<div class="ko-opts">' +
              '<label class="ko-opt"><input type="radio" name="' + qid + '" value="Ya" required> <span data-id="Ya" data-en="Yes">Ya</span></label>' +
              '<label class="ko-opt"><input type="radio" name="' + qid + '" value="Tidak"> <span data-id="Tidak" data-en="No">Tidak</span></label>' +
            '</div>';
          box.appendChild(div);
        });
        apply(cur); // terapkan bahasa aktif pada label baru
      }
      function openApply(slot) {
        target = slot || null;
        titleEl.textContent = slot ? slot.title : t("Lamaran Umum", "General Application");
        refEl.textContent = slot ? slot.joRefNo : "";
        descEl.textContent = slot
          ? t("Lengkapi data berikut untuk melamar posisi ini.", "Fill in the following details to apply for this position.")
          : t("Tidak memilih lowongan tertentu? Profil Anda akan tersimpan di talent pool kami.", "Not applying for a specific opening? Your profile will be kept in our talent pool.");
        renderKnockouts(slot); // F6b — pertanyaan wajib posisi (bila ada)
        hideBanner();
        successBox.classList.remove("show");
        form.style.display = "";
        overlay.classList.add("open");
        document.body.classList.add("no-scroll");
        refreshCaptcha(); // token diminta saat dialog DIBUKA
        setTimeout(function () { var f = el("firstName"); if (f) f.focus(); }, 60);
      }
      function closeApply() {
        if (submitting) return;
        overlay.classList.remove("open");
        document.body.classList.remove("no-scroll");
        if (submitted) resetForm(); // reset isi form HANYA setelah sukses
      }
      document.getElementById("apply-close").addEventListener("click", closeApply);
      cancelBtn.addEventListener("click", closeApply);
      document.getElementById("apply-ok").addEventListener("click", closeApply);
      overlay.addEventListener("click", function (e) { if (e.target === overlay) closeApply(); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && overlay.classList.contains("open")) closeApply();
      });

      // ---- pemicu buka dialog: kartu lowongan / lamaran umum / coba lagi ----
      var grid = document.getElementById("openings");
      if (grid) {
        grid.addEventListener("click", function (e) {
          var card = e.target && e.target.closest ? e.target.closest("[data-idx]") : null;
          if (!card) return;
          var o = OPENINGS[Number(card.getAttribute("data-idx"))];
          if (o) openApply(o);
        });
        Array.prototype.forEach.call(grid.querySelectorAll("[data-idx]"), function (card) {
          card.addEventListener("keydown", function (e) {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            var o = OPENINGS[Number(card.getAttribute("data-idx"))];
            if (o) openApply(o);
          });
        });
      }
      var genBtn = document.getElementById("apply-general");
      if (genBtn) genBtn.addEventListener("click", function () { openApply(null); });
      var retryBtn = document.getElementById("retry-btn");
      if (retryBtn) retryBtn.addEventListener("click", function () { location.reload(); });

      // ---- B7 — cek status lamaran: minta tautan magic-link via email ----
      // Respons server NETRAL (anti-enumerasi): pesan berikut SELALU sama
      // baik email terdaftar maupun tidak.
      var statusForm = document.getElementById("status-form");
      var stEmail = document.getElementById("st-email");
      var stMsg = document.getElementById("st-msg");
      var stBtn = document.getElementById("st-submit");
      var stHp = document.getElementById("st-website");
      var ST_NEUTRAL_ID = "Terima kasih! Jika email Anda terdaftar, tautan untuk mengecek status lamaran telah dikirim ke email Anda.";
      var ST_NEUTRAL_EN = "Thank you! If your email is registered, a link to check your application status has been sent to your email.";
      function setStMsg(msg, isErr) {
        if (!stMsg) return;
        stMsg.textContent = msg;
        stMsg.className = "st-msg" + (isErr ? " err" : "");
      }
      if (statusForm && stEmail && stBtn) {
        statusForm.addEventListener("submit", function (e) {
          e.preventDefault();
          var em = stEmail.value.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            stEmail.classList.add("bad");
            setStMsg(t("Masukkan alamat email yang valid.", "Please enter a valid email address."), true);
            return;
          }
          stEmail.classList.remove("bad");
          var qs = ACTIVE_SLUG ? "?t=" + encodeURIComponent(ACTIVE_SLUG) : "";
          stBtn.disabled = true;
          stBtn.textContent = t("Mengirim…", "Sending…");
          fetch("/api/public/recruitment/status-link" + qs, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: em, website: stHp ? stHp.value : "" }) // honeypot ikut dikirim
          }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
          }).then(function (res) {
            if (res.status === 429) {
              setStMsg(serverMsg((res.j && res.j.error) || "Terlalu banyak permintaan. Coba lagi nanti."), true);
              return;
            }
            if (res.status === 400) {
              stEmail.classList.add("bad");
              setStMsg(serverMsg((res.j && res.j.error) || "Email valid wajib diisi"), true);
              return;
            }
            // 200/201 — respons netral SAMA (email terdaftar maupun tidak)
            setStMsg(t(ST_NEUTRAL_ID, ST_NEUTRAL_EN), false);
            stEmail.value = "";
          }).catch(function () {
            setStMsg(t("Gagal mengirim permintaan. Periksa koneksi internet Anda lalu coba lagi.", "Failed to send the request. Check your internet connection and try again."), true);
          }).then(function () {
            stBtn.disabled = false;
            stBtn.textContent = t("Kirim Tautan", "Send Link");
          });
        });
      }

      // ---- validasi klien (per-field: border merah + teks kecil) ----
      function validate() {
        var bad = false;
        if (!val("firstName")) { setErr("firstName", t("Nama depan wajib diisi.", "First name is required.")); bad = true; }
        var em = val("email");
        if (!em || !EMAIL_RE.test(em)) { setErr("email", t("Email valid wajib diisi.", "A valid email address is required.")); bad = true; }
        if (!/^[0-9]+$/.test(val("captcha"))) { setErr("captcha", t("Jawab pertanyaan verifikasi keamanan (angka).", "Answer the security verification question (a number).")); bad = true; }
        if (!consentBox.checked) { setErr("consent", t("Persetujuan pemrosesan data pribadi wajib diberikan.", "Consent to personal data processing is required.")); bad = true; }
        if (cvBad) { cvErr.textContent = t(cvBad.id, cvBad.en); bad = true; }
        // F6b — semua pertanyaan wajib posisi harus dijawab (required radio menangani native; jaga validasi eksplisit)
        var koWrap = document.getElementById("ap-knockouts-wrap");
        if (koWrap && koWrap.style.display !== "none") {
          var kos = koWrap.querySelectorAll("input[type=radio][name^='ko_']");
          var seen = {};
          for (var ki = 0; ki < kos.length; ki++) { seen[kos[ki].name] = seen[kos[ki].name] || kos[ki].checked; }
          var missing = Object.keys(seen).filter(function (n) { return !seen[n]; });
          if (missing.length > 0) { showBanner(t("Jawab semua pertanyaan wajib posisi terlebih dahulu.", "Please answer all required position questions first.")); bad = true; }
        }
        var gy = val("graduationYear");
        if (gy && !/^[0-9]+$/.test(gy)) { setErr("graduationYear", t("Tahun lulus harus angka (1900–2100).", "Graduation year must be a number (1900–2100).")); bad = true; }
        var gp = val("gpa");
        if (gp && !/^[0-9]+([.,][0-9]+)?$/.test(gp)) { setErr("gpa", t("IPK harus angka 0–4 (contoh: 3.50).", "GPA must be a number 0–4 (e.g. 3.50).")); bad = true; }
        var ex = val("expYears");
        if (ex && !/^[0-9]+$/.test(ex)) { setErr("expYears", t("Pengalaman kerja harus angka (tahun).", "Work experience must be a number (years).")); bad = true; }
        var es = val("expectedSalary");
        if (es && !/^[0-9]+$/.test(es)) { setErr("expectedSalary", t("Ekspektasi gaji harus angka (Rupiah).", "Expected salary must be a number (Rupiah).")); bad = true; }
        if (bad) showBanner(t("Periksa kembali isian yang ditandai merah.", "Please review the fields highlighted in red."));
        return bad;
      }

      // ---- kirim lamaran (multipart — JANGAN set Content-Type manual) ----
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (submitting) return;
        if (validate()) return;
        var fd = new FormData();
        if (target && target.slotId) fd.append("slotId", target.slotId);
        ["firstName","middleName","lastName","email","phone","city","birthDate","gender","educationLevel","fieldOfStudy","institution","graduationYear","gpa","expYears","lastPosition","lastCompany","expectedSalary","notes"].forEach(function (n) {
          fd.append(n, val(n));
        });
        fd.append("captchaToken", capToken || "");
        fd.append("captchaAnswer", val("captcha"));
        fd.append("consent", "true");
        fd.append("website", hpInput ? hpInput.value : ""); // HONEYPOT dari DOM
        // F6b — jawaban pertanyaan wajib posisi (ko_<questionId>)
        var koRadios = form.querySelectorAll("input[type=radio][name^='ko_']:checked");
        for (var kri = 0; kri < koRadios.length; kri++) fd.append(koRadios[kri].name, koRadios[kri].value);
        if (cvFile) fd.append("cv", cvFile);
        submitting = true;
        updateSubmitLabel();
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        hideBanner();
        var qs = ACTIVE_SLUG ? "?t=" + encodeURIComponent(ACTIVE_SLUG) : "";
        fetch("/api/public/recruitment/apply" + qs, { method: "POST", body: fd })
          .then(function (r) {
            if (r.status === 201) {
              // respons 201 = sukses (maupun spam-honeypot — identik by design)
              submitted = true;
              form.style.display = "none";
              successBox.classList.add("show");
              document.getElementById("apply-ok").focus();
              return null;
            }
            return r.json().catch(function () { return {}; }).then(function (j) {
              showBanner(serverMsg((j && j.error) || ("HTTP " + r.status)));
              if (r.status === 400) {
                // challenge bisa basi/kedaluwarsa → segarkan otomatis
                capInput.value = "";
                refreshCaptcha();
              }
            });
          })
          .catch(function () {
            showBanner(t("Gagal mengirim lamaran. Periksa koneksi internet Anda lalu coba lagi.", "Failed to send the application. Check your internet connection and try again."));
          })
          .then(function () {
            submitting = false;
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            updateSubmitLabel();
          });
      });

      apply(cur); // terapkan bahasa tersimpan
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
    // PROXY server-side: semua /api/public/recruitment/* di-relay ke aplikasi utama
    // (mode direct :3010 — mode gateway tidak menyentuh jalur ini).
    if (url.pathname.startsWith(PUBLIC_API_PREFIX)) {
      return proxyPublicApi(req, url);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const t = url.searchParams.get("t");
      const [data, site] = await Promise.all([fetchOpenings(t), fetchSiteConfig(t)]);
      return new Response(renderPage(data, t, site), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    // B7 — halaman cek status lamaran (magic-link sekali-pakai): /status/<token>
    if (url.pathname.startsWith("/status/")) {
      const token = url.pathname.slice("/status/".length).split("/")[0] ?? "";
      const t = url.searchParams.get("t");
      if (!/^\d{10,16}\.[a-f0-9]{64}$/.test(token)) {
        return new Response("Not found", { status: 404 });
      }
      const [payload, site] = await Promise.all([fetchStatusInfo(token, t), fetchSiteConfig(t)]);
      return new Response(renderStatusPage(payload, token, t, site), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    // F7 — halaman tanda tangan elektronik kandidat: /sign/<token>
    if (url.pathname.startsWith("/sign/")) {
      const token = url.pathname.slice("/sign/".length).split("/")[0] ?? "";
      const t = url.searchParams.get("t");
      if (!/^[a-f0-9]{8,80}$/i.test(token)) {
        return new Response("Not found", { status: 404 });
      }
      const info = await fetchEsignInfo(token, t);
      return new Response(renderSignPage(info, token, t), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(
  `[candidate-portal] OK — http://127.0.0.1:${PORT} (aplikasi TERPISAH + form lamaran; proxy ${PUBLIC_API_PREFIX}* → ${MAIN_APP}; gateway: /?XTransformPort=${PORT})`,
);

// ============================================================================
// F7 — HALAMAN TANDA TANGAN ELEKTRONIK KANDIDAT  /sign/<token>
// (e-sign ringkas: OTP email + typed signature + hash PDF tamper-evident —
// HRX E2; Amandemen 1: UI publik kandidat hidup di PORTAL, bukan aplikasi
// utama. API: /api/public/recruitment/sign/<token> via proxy.)
// ============================================================================

interface EsignInfo {
  status: "Pending" | "Signed" | "Expired" | "Cancelled";
  purpose: "offer" | "appointment";
  signerName: string;
  letterNo: string | null;
  letterKind: string | null;
  offerNo: string | null;
  companyName: string | null;
  expiresAt: string;
}

async function fetchEsignInfo(token: string, tenantSlug: string | null): Promise<EsignInfo | null> {
  const url = new URL(`/api/public/recruitment/sign/${encodeURIComponent(token)}`, MAIN_APP);
  if (tenantSlug) url.searchParams.set("t", tenantSlug);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as EsignInfo;
  } catch {
    return null;
  }
}

function renderSignPage(info: EsignInfo | null, token: string, tenantSlug: string | null): string {
  const PURPOSE_LABEL: Record<string, string> = {
    offer: "Surat Penawaran Kerja / Job Offer Letter",
    appointment: "Surat Pengangkatan / Appointment Letter",
  };
  const purpose = info ? PURPOSE_LABEL[info.purpose] ?? info.purpose : "";
  const company = info?.companyName ? esc(info.companyName) : "";
  const qs = tenantSlug ? `?t=${encodeURIComponent(tenantSlug)}` : "";

  const statusBadge =
    !info ? `<span class="st st-err">404</span>`
    : info.status === "Signed" ? `<span class="st st-ok" data-id="Sudah Ditandatangani" data-en="Signed">Sudah Ditandatangani</span>`
    : info.status === "Pending" ? `<span class="st" data-id="Menunggu Tanda Tangan" data-en="Awaiting Signature">Menunggu Tanda Tangan</span>`
    : info.status === "Expired" ? `<span class="st st-err" data-id="Kedaluwarsa" data-en="Expired">Kedaluwarsa</span>`
    : `<span class="st st-err" data-id="Dibatalkan" data-en="Cancelled">Dibatalkan</span>`;

  let bodyHtml: string;
  if (!info) {
    bodyHtml = `
      <p class="lead" data-id="Tautan tanda tangan tidak valid atau sudah kedaluwarsa." data-en="This signing link is invalid or has expired.">Tautan tanda tangan tidak valid atau sudah kedaluwarsa.</p>
      <p class="muted" data-id="Silakan hubungi tim rekrutmen yang menghubungi Anda untuk meminta tautan baru." data-en="Please contact the recruitment team that reached out to you to request a new link.">Silakan hubungi tim rekrutmen yang menghubungi Anda untuk meminta tautan baru.</p>`;
  } else if (info.status === "Pending") {
    bodyHtml = `
      <div class="meta">
        <div><span data-id="Dokumen" data-en="Document">Dokumen</span>: <b>${esc(purpose)}</b>${info.letterNo ? ` — <span class="mono">${esc(info.letterNo)}</span>` : ""}</div>
        <div><span data-id="Nomor Offer" data-en="Offer No.">Nomor Offer</span>: <span class="mono">${esc(info.offerNo ?? "—")}</span></div>
      </div>
      <div class="steps">
        <div class="step" data-id="1. Kode OTP telah dikirim ke email Anda oleh tim rekrutmen (berlaku 5 menit)." data-en="1. An OTP code has been sent to your email by the recruitment team (valid for 5 minutes).">1. Kode OTP telah dikirim ke email Anda oleh tim rekrutmen (berlaku 5 menit).</div>
        <div class="step" data-id="2. Ketik nama lengkap Anda PERSIS seperti: " data-en="2. Type your full name EXACTLY as: ">2. Ketik nama lengkap Anda PERSIS seperti: </div>
        <div class="name-echo">${esc(info.signerName)}</div>
      </div>
      <form id="esign-form" novalidate>
        <label for="sg-otp"><span data-id="Kode OTP (6 digit)" data-en="OTP Code (6 digits)">Kode OTP (6 digit)</span> <b class="req">*</b></label>
        <input id="sg-otp" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="••••••">
        <label for="sg-name"><span data-id="Nama Lengkap Anda" data-en="Your Full Name">Nama Lengkap Anda</span> <b class="req">*</b></label>
        <input id="sg-name" autocomplete="name" placeholder="${esc(info.signerName)}">
        <label class="chk"><input type="checkbox" id="sg-consent"><span data-id="Saya menandatangani dokumen ini secara elektronik dan memahami bahwa tanda tangan ini memiliki nilai data integritas (hash SHA-256) yang dapat diverifikasi." data-en="I am signing this document electronically and understand this signature carries a verifiable SHA-256 integrity hash.">Saya menandatangani dokumen ini secara elektronik dan memahami bahwa tanda tangan ini memiliki nilai data integritas (hash SHA-256) yang dapat diverifikasi.</span></label>
        <p class="err" id="sg-err" role="alert"></p>
        <button type="submit" id="sg-btn" class="btn"><span data-id="Tanda Tangani Sekarang" data-en="Sign Now">Tanda Tangani Sekarang</span></button>
      </form>`;
  } else {
    bodyHtml = `
      <div class="meta">
        <div><span data-id="Dokumen" data-en="Document">Dokumen</span>: <b>${esc(purpose)}</b>${info.letterNo ? ` — <span class="mono">${esc(info.letterNo)}</span>` : ""}</div>
        <div><span data-id="Nomor Offer" data-en="Offer No.">Nomor Offer</span>: <span class="mono">${esc(info.offerNo ?? "—")}</span></div>
      </div>
      <p class="lead">${
        info.status === "Signed"
          ? '<span data-id="Terima kasih! Dokumen ini telah Anda tandatangani secara elektronik." data-en="Thank you! This document has been electronically signed by you.">Terima kasih! Dokumen ini telah Anda tandatangani secara elektronik.</span>'
          : info.status === "Expired"
            ? '<span data-id="Tautan tanda tangan ini sudah kedaluwarsa. Silakan minta tautan baru kepada tim rekrutmen." data-en="This signing link has expired. Please ask the recruitment team for a new link.">Tautan tanda tangan ini sudah kedaluwarsa. Silakan minta tautan baru kepada tim rekrutmen.</span>'
            : '<span data-id="Permintaan tanda tangan ini telah dibatalkan." data-en="This signing request has been cancelled.">Permintaan tanda tangan ini telah dibatalkan.</span>'
      }</p>`;
  }

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${info ? `${esc(info.signerName)} — ${company}` : "Sign"} · RekanKerja</title>
<style>
  :root { --accent:#ea580c; --bg:#fffbf5; --card:#ffffff; --line:#eadfd2; --text:#292524; --muted:#78716c; --ok:#059669; --err:#dc2626; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; flex-direction:column; }
  header { padding:1.1rem 1.25rem; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:.6rem; background:var(--card); }
  .logo { width:30px; height:30px; border-radius:.6rem; background:var(--accent); color:#fff; display:grid; place-items:center; font-weight:800; font-size:.9rem; }
  .brand { font-weight:800; letter-spacing:-.01em; }
  .brand small { display:block; font-weight:500; color:var(--muted); font-size:.7rem; }
  main { flex:1; width:100%; max-width:560px; margin:0 auto; padding:2rem 1.25rem 3rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:1rem; padding:1.6rem 1.5rem; display:flex; flex-direction:column; gap:1rem; }
  h1 { font-size:1.35rem; letter-spacing:-.02em; }
  .st { align-self:flex-start; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.05em; padding:.28rem .7rem; border-radius:9999px; background:#fff7ed; color:var(--accent); border:1px solid #fed7aa; }
  .st-ok { background:#ecfdf5; color:var(--ok); border-color:#a7f3d0; }
  .st-err { background:#fef2f2; color:var(--err); border-color:#fecaca; }
  .lead { font-size:.95rem; line-height:1.6; }
  .muted { color:var(--muted); font-size:.85rem; line-height:1.6; }
  .meta { display:flex; flex-direction:column; gap:.4rem; font-size:.85rem; color:#44403c; background:#fffdf8; border:1px solid var(--line); border-radius:.7rem; padding:.8rem .9rem; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.82rem; }
  .steps { display:flex; flex-direction:column; gap:.5rem; font-size:.88rem; line-height:1.55; color:#44403c; }
  .name-echo { font-weight:800; font-size:1.02rem; padding:.5rem .8rem; background:#fff7ed; border:1px solid #fed7aa; border-radius:.6rem; align-self:flex-start; }
  form { display:flex; flex-direction:column; gap:.55rem; }
  label { font-size:.8rem; font-weight:700; color:#44403c; }
  .req { color:var(--err); }
  input { width:100%; padding:.7rem .8rem; border:1px solid var(--line); border-radius:.6rem; font-size:.95rem; background:#fff; }
  input:focus { outline:2px solid #fed7aa; border-color:var(--accent); }
  input#sg-otp { letter-spacing:.35em; text-align:center; font-size:1.1rem; }
  .chk { display:flex; gap:.55rem; align-items:flex-start; font-size:.78rem; font-weight:500; color:#57534e; line-height:1.5; cursor:pointer; }
  .chk input { width:1.05rem; height:1.05rem; margin-top:.15rem; accent-color:var(--accent); flex-shrink:0; }
  .err { color:var(--err); font-size:.8rem; min-height:1em; }
  .btn { margin-top:.4rem; padding:.85rem 1rem; background:var(--accent); color:#fff; border:none; border-radius:.7rem; font-size:.95rem; font-weight:800; cursor:pointer; }
  .btn:disabled { opacity:.6; cursor:wait; }
  .ok-box { text-align:center; padding:.6rem 0; }
  .ok-ic { width:54px; height:54px; margin:0 auto .8rem; border-radius:50%; background:#ecfdf5; color:var(--ok); display:grid; place-items:center; font-size:1.6rem; }
  .hash { font-size:.68rem; color:var(--muted); word-break:break-all; text-align:center; }
  footer { padding:1.1rem 1.25rem calc(1.1rem + env(safe-area-inset-bottom)); border-top:1px solid var(--line); text-align:center; color:var(--muted); font-size:.72rem; background:var(--card); }
  footer b { color:var(--text); }
</style>
</head>
<body>
  <header>
    <div class="logo" aria-hidden="true">RK</div>
    <div class="brand">RekanKerja<small>${company}</small></div>
    <button id="lang" style="margin-left:auto;border:1px solid var(--line);background:#fff;border-radius:9999px;padding:.3rem .75rem;font-size:.75rem;font-weight:700;cursor:pointer">EN</button>
  </header>
  <main>
    <div class="card">
      <h1><span data-id="Tanda Tangan Elektronik" data-en="Electronic Signature">Tanda Tangan Elektronik</span></h1>
      ${statusBadge}
      <div id="sg-body">${bodyHtml}</div>
    </div>
  </main>
  <footer><b>RekanKerja</b> · <span data-id="Tanda tangan elektronik — OTP + nama terketik + hash integritas SHA-256 (UU ITE & UU PDP)." data-en="Electronic signature — OTP + typed name + SHA-256 integrity hash (Indonesian ITE & PDP laws).">Tanda tangan elektronik — OTP + nama terketik + hash integritas SHA-256 (UU ITE & UU PDP).</span></footer>
<script>
(function () {
  "use strict";
  var KEY = "portal-lang", cur = "id";
  try { cur = localStorage.getItem(KEY) || "id"; } catch (e) {}
  function t(id, en) { return cur === "id" ? id : en; }

  // pesan error server (ID) -> padanan EN (pola SERVER_ERRORS form lamaran).
  // Sumber string: api/public-sign.ts + services/recruitment-esign-service.ts
  // (jalur POST /sign/<token>) + respons 502 proxy portal sendiri.
  var SERVER_ERRORS = {
    "Terlalu banyak permintaan. Coba lagi nanti.": "Too many requests. Please try again later.",
    "Terlalu banyak percobaan. Silakan coba lagi nanti.": "Too many attempts. Please try again later.",
    "Kode OTP salah atau kedaluwarsa": "The OTP code is incorrect or has expired",
    "Nama wajib diketik sesuai nama pada surat": "The name must be typed exactly as it appears on the letter",
    "Nama yang diketik tidak sesuai dengan nama kandidat pada surat": "The typed name does not match the candidate name on the letter",
    "Tautan tanda tangan tidak valid atau kedaluwarsa": "The signature link is invalid or has expired",
    "Tautan tanda tangan telah kedaluwarsa — minta HR mengirim permintaan baru": "The signature link has expired — ask HR to send a new request",
    "Surat tidak tersedia — hubungi HR": "The letter is not available — please contact HR",
    "Surat tidak dapat dibuat — hubungi HR": "The letter could not be generated — please contact HR",
    "Portal tidak dapat menghubungi layanan rekrutmen. Silakan coba lagi nanti.": "The portal cannot reach the recruitment service. Please try again later."
  };
  // pesan dinamis: "Permintaan tanda tangan sudah diproses (Signed|Expired|Cancelled)"
  var SERVER_ERROR_RULES = [
    [/^Permintaan tanda tangan sudah diproses \\((.+)\\)$/, "This signing request has already been processed ($1)"]
  ];
  function serverMsg(msg) {
    if (cur === "en") {
      if (SERVER_ERRORS[msg]) return SERVER_ERRORS[msg];
      for (var i = 0; i < SERVER_ERROR_RULES.length; i++) {
        var m = SERVER_ERROR_RULES[i][0].exec(msg);
        if (m) return SERVER_ERROR_RULES[i][1].replace("$1", m[1]);
      }
    }
    return msg;
  }

  function apply(lang) {
    cur = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-id]").forEach(function (el) {
      var v = el.getAttribute(lang === "id" ? "data-id" : "data-en");
      if (v != null) el.innerHTML = v;
    });
    document.getElementById("lang").textContent = lang === "id" ? "EN" : "ID";
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }
  document.getElementById("lang").addEventListener("click", function () { apply(cur === "id" ? "en" : "id"); });
  apply(cur);

  var form = document.getElementById("esign-form");
  if (!form) return;
  var TOKEN = ${JSON.stringify(token)};
  var QS = ${JSON.stringify(qs)};
  var otpIn = document.getElementById("sg-otp");
  var nameIn = document.getElementById("sg-name");
  var consent = document.getElementById("sg-consent");
  var errEl = document.getElementById("sg-err");
  var btn = document.getElementById("sg-btn");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errEl.textContent = "";
    if (!/^[0-9]{6}$/.test(otpIn.value.trim())) { errEl.textContent = t("Masukkan kode OTP 6 digit dari email Anda.", "Enter the 6-digit OTP code from your email."); return; }
    if (!nameIn.value.trim()) { errEl.textContent = t("Ketik nama lengkap Anda.", "Type your full name."); return; }
    if (!consent.checked) { errEl.textContent = t("Centang pernyataan persetujuan tanda tangan elektronik.", "Tick the electronic signature consent statement."); return; }
    btn.disabled = true;
    btn.textContent = t("Memverifikasi…", "Verifying…");
    fetch("/api/public/recruitment/sign/" + encodeURIComponent(TOKEN) + QS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otp: otpIn.value.trim(), typedName: nameIn.value.trim() })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (res.ok) {
        var h = (res.j && res.j.pdfSha256) || "";
        var badge = document.querySelector(".st");
        if (badge) { badge.className = "st st-ok"; badge.textContent = t("Sudah Ditandatangani", "Signed"); }
        document.getElementById("sg-body").innerHTML =
          '<div class="ok-box"><div class="ok-ic">✓</div>' +
          '<p class="lead">' + t("Dokumen berhasil ditandatangani. Terima kasih!", "Document successfully signed. Thank you!") + '</p>' +
          (h ? '<p class="hash mono">SHA-256: ' + h + '</p>' : '') +
          '<p class="muted" style="margin-top:.6rem">' + t("Tim rekrutmen telah diberi tahu. Simpan hash ini sebagai bukti integritas dokumen Anda.", "The recruitment team has been notified. Keep this hash as proof of your document integrity.") + '</p></div>';
        return;
      }
      btn.disabled = false;
      btn.textContent = t("Tanda Tangani Sekarang", "Sign Now");
      errEl.textContent = serverMsg((res.j && res.j.error) || t("Gagal memproses — coba lagi.", "Failed to process — please try again."));
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = t("Tanda Tangani Sekarang", "Sign Now");
      errEl.textContent = t("Koneksi gagal — periksa jaringan Anda dan coba lagi.", "Connection failed — check your network and try again.");
    });
  });
})();
</script>
</body>
</html>`;
}

// ============================================================================
// B7 — HALAMAN CEK STATUS LAMARAN  /status/<token>?t=<slug>
// (magic-link sekali-pakai 6 jam — tanpa password. SSR fetch server-side ke
// aplikasi utama /api/public/recruitment/status — pola fetchEsignInfo /sign.)
// Payload = data yang boleh dilihat pelamar: identitas terbatas, slot terakhir,
// status, tahapan (TANPA nama evaluator/catatan internal), offer (TANPA
// nominal), lampiran. Dwibahasa: ?lang + toggle + localStorage (pola /sign).
// ============================================================================

interface StatusStepItem { name: string; status: string; planDate: string | null }
interface StatusPayload {
  applicantNo: string;
  fullName: string;
  status: string;
  appliedCount: number;
  latestApplication: { joRefNo: string; title: string; dateApplied: string; status: string } | null;
  selection: { prNo: string | null; steps: StatusStepItem[] } | null;
  offer: { offerNo: string; status: string; date: string | null } | null;
  attachments: { title: string; fileName: string; sizeBytes: number }[];
}

/** Hasil fetch status: payload sukses ATAU kode error netral. */
type StatusInfo = { ok: true; payload: StatusPayload } | { ok: false; code: 400 | 410 | 404 | 429 | 0 };

async function fetchStatusInfo(token: string, tenantSlug: string | null): Promise<StatusInfo> {
  const url = new URL("/api/public/recruitment/status", MAIN_APP);
  url.searchParams.set("token", token);
  if (tenantSlug) url.searchParams.set("t", tenantSlug);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000); // verifikasi memindai HMAC — beri napas
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (res.ok) return { ok: true, payload: (await res.json()) as StatusPayload };
    if (res.status === 410) return { ok: false, code: 410 };
    if (res.status === 429) return { ok: false, code: 429 };
    return { ok: false, code: res.status === 400 ? 400 : 404 };
  } catch {
    return { ok: false, code: 0 }; // aplikasi utama mati
  }
}

// label dwibahasa [ID, EN] — status sistem → teks manusia
const APPLICANT_STATUS_LABEL: Record<string, [string, string]> = {
  Active: ["Talent Pool Aktif", "Active Talent Pool"],
  Rejected: ["Tidak Lolos", "Not Selected"],
  Outdated: ["Arsip (retensi)", "Archived (retention)"],
  Employed: ["Menjadi Karyawan", "Employed"],
};
const APP_STATUS_LABEL: Record<string, [string, string]> = {
  Received: ["Diterima", "Received"],
  Screening: ["Penyaringan", "Screening"],
  Rejected: ["Tidak Lolos", "Rejected"],
  Hired: ["Dipekerjakan", "Hired"],
};
const STEP_STATUS_LABEL: Record<string, [string, string]> = {
  Planned: ["Direncanakan", "Planned"],
  Acknowledged: ["Dikonfirmasi Kandidat", "Acknowledged"],
  Performed: ["Selesai Dilaksanakan", "Performed"],
  Passed: ["Lulus", "Passed"],
  Failed: ["Tidak Lulus", "Failed"],
  Cancelled: ["Dibatalkan", "Cancelled"],
};
const OFFER_STATUS_LABEL: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"],
  PendingApproval: ["Menunggu Persetujuan", "Pending Approval"],
  Sent: ["Terkirim", "Sent"],
  Viewed: ["Sudah Dilihat", "Viewed"],
  Accepted: ["Diterima", "Accepted"],
  Declined: ["Ditolak", "Declined"],
  Expired: ["Kedaluwarsa", "Expired"],
};

function lbl(map: Record<string, [string, string]>, key: string): [string, string] {
  return map[key] ?? [key, key];
}

/** <span data-id="…" data-en="…">ID</span> — bahasa diganti toggle klien. */
function biSpan(map: Record<string, [string, string]>, key: string): string {
  const [id, en] = lbl(map, key);
  return `<span data-id="${esc(id)}" data-en="${esc(en)}">${esc(id)}</span>`;
}

function biDate(iso: string | null): string {
  if (!iso) return "—";
  const id = fmtDate(iso, "id-ID") ?? "—";
  const en = fmtDate(iso, "en-US") ?? id;
  return `<span data-id="${esc(id)}" data-en="${esc(en)}">${esc(id)}</span>`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function renderStatusPage(info: StatusInfo, _token: string, tenantSlug: string | null, site: SiteConfig | null): string {
  const brandHex = validBrand(site?.brandColor);
  const pal = brandPalette(brandHex);
  const logoUrl = site?.logoUrl && /^https?:\/\//.test(site.logoUrl) ? site.logoUrl : null;
  const company = site?.companyName ?? null;
  const homeHref = tenantSlug ? `/?t=${encodeURIComponent(tenantSlug)}#cek-status` : "/#cek-status";
  const year = new Date().getFullYear();

  const wordmarkHtml = logoUrl
    ? `<img class="logo-img" src="${esc(logoUrl)}" alt="${company ? esc(company) : "Logo"}" loading="lazy">`
    : `<div class="logo-dot" aria-hidden="true"></div>`;

  // ---- isi kartu sesuai hasil verifikasi ----
  let bodyHtml: string;
  if (info.ok) {
    const p = info.payload;
    const appStatus = p.latestApplication;
    const steps = p.selection?.steps ?? [];
    const timelineHtml = steps.length
      ? `<ol class="timeline">${steps.map((s) => {
          const good = s.status === "Passed";
          const bad = s.status === "Failed";
          return `<li class="tl-item${good ? " good" : ""}${bad ? " bad" : ""}">
            <span class="tl-dot" aria-hidden="true"></span>
            <div class="tl-txt">
              <p class="tl-name">${esc(s.name)}</p>
              <p class="tl-meta">${biSpan(STEP_STATUS_LABEL, s.status)}${s.planDate ? ` · <span data-id="Jadwal" data-en="Scheduled">Jadwal</span>: ${biDate(s.planDate)}` : ""}</p>
            </div>
          </li>`;
        }).join("")}</ol>`
      : `<p class="muted" data-id="Belum ada tahap seleksi yang terjadwal." data-en="No selection stages scheduled yet.">Belum ada tahap seleksi yang terjadwal.</p>`;

    const offerHtml = p.offer
      ? `<div class="offerbox">
          <p class="box-title"><span data-id="Penawaran Terakhir" data-en="Latest Offer">Penawaran Terakhir</span></p>
          <p class="offer-no mono">${esc(p.offer.offerNo)} · ${biSpan(OFFER_STATUS_LABEL, p.offer.status)}${p.offer.date ? ` · ${biDate(p.offer.date)}` : ""}</p>
        </div>`
      : "";

    const attachHtml = p.attachments.length
      ? `<ul class="attachlist">${p.attachments.map((a) =>
          `<li><span class="att-ic" aria-hidden="true">📎</span> <b>${esc(a.title)}</b> <span class="mono">${esc(a.fileName)}</span> <span class="muted">(${fmtBytes(a.sizeBytes)})</span></li>`,
        ).join("")}</ul>`
      : `<p class="muted" data-id="Belum ada lampiran." data-en="No attachments yet.">Belum ada lampiran.</p>`;

    bodyHtml = `
      <div class="who">
        <div>
          <p class="who-name">${esc(p.fullName)}</p>
          <p class="mono who-no">${esc(p.applicantNo)}</p>
        </div>
        <span class="st st-big">${biSpan(APPLICANT_STATUS_LABEL, p.status)}</span>
      </div>

      ${appStatus ? `
      <div class="meta">
        <div><span data-id="Posisi Terakhir Dilamar" data-en="Latest Application">Posisi Terakhir Dilamar</span>: <b>${esc(appStatus.title)}</b> <span class="mono">(${esc(appStatus.joRefNo)})</span></div>
        <div><span data-id="Tanggal" data-en="Date">Tanggal</span>: ${biDate(appStatus.dateApplied)} · ${biSpan(APP_STATUS_LABEL, appStatus.status)}</div>
        <div><span data-id="Total Lamaran" data-en="Total Applications">Total Lamaran</span>: ${p.appliedCount}</div>
      </div>` : `
      <div class="meta"><div data-id="Belum ada lamaran ke slot lowongan — profil Anda tersimpan di talent pool." data-en="No applications to specific openings yet — your profile is kept in the talent pool.">Belum ada lamaran ke slot lowongan — profil Anda tersimpan di talent pool.</div></div>`}

      <div class="sect-h"><span data-id="Tahapan Seleksi" data-en="Selection Stages">Tahapan Seleksi</span>${p.selection?.prNo ? ` <span class="mono muted">· ${esc(p.selection.prNo)}</span>` : ""}</div>
      ${timelineHtml}
      ${offerHtml}
      <div class="sect-h"><span data-id="Lampiran" data-en="Attachments">Lampiran</span></div>
      ${attachHtml}

      <p class="muted tiny" data-id="Tampilan ini sengaja tidak memuat catatan internal, penilaian evaluator, atau nominal — hanya status yang berhak Anda lihat. Tautan ini sekali-pakai; untuk melihat lagi, minta tautan baru." data-en="This view intentionally omits internal notes, evaluator scores, and salary figures — only the status you are entitled to see. This link is one-time; request a new link to view again.">Tampilan ini sengaja tidak memuat catatan internal, penilaian evaluator, atau nominal — hanya status yang berhak Anda lihat. Tautan ini sekali-pakai; untuk melihat lagi, minta tautan baru.</p>
      <a class="btn" href="${esc(homeHref)}" data-id="Minta Tautan Baru" data-en="Request a New Link">Minta Tautan Baru</a>`;
  } else if (info.code === 410) {
    bodyHtml = `
      <p class="lead" data-id="Tautan ini sudah kedaluwarsa atau pernah digunakan." data-en="This link has expired or has already been used.">Tautan ini sudah kedaluwarsa atau pernah digunakan.</p>
      <p class="muted" data-id="Silakan minta tautan baru dengan memasukkan email Anda di portal karier." data-en="Please request a new link by entering your email on the career portal.">Silakan minta tautan baru dengan memasukkan email Anda di portal karier.</p>
      <a class="btn" href="${esc(homeHref)}" data-id="Minta Tautan Baru" data-en="Request a New Link">Minta Tautan Baru</a>`;
  } else if (info.code === 429) {
    bodyHtml = `
      <p class="lead" data-id="Terlalu banyak permintaan. Coba lagi nanti." data-en="Too many requests. Please try again later.">Terlalu banyak permintaan. Coba lagi nanti.</p>`;
  } else if (info.code === 0) {
    bodyHtml = `
      <p class="lead" data-id="Layanan status lamaran sementara tidak dapat dihubungi. Silakan coba lagi beberapa saat." data-en="The application status service is temporarily unreachable. Please try again in a moment.">Layanan status lamaran sementara tidak dapat dihubungi. Silakan coba lagi beberapa saat.</p>
      <p class="muted" data-id="Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal." data-en="This page is the Candidate Portal — a separate application from the internal HR system.">Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal.</p>`;
  } else {
    bodyHtml = `
      <p class="lead" data-id="Tautan status lamaran tidak valid atau tidak dikenali." data-en="The application status link is invalid or unrecognized.">Tautan status lamaran tidak valid atau tidak dikenali.</p>
      <p class="muted" data-id="Periksa kembali tautan dari email Anda, atau minta tautan baru di portal karier." data-en="Double-check the link from your email, or request a new one on the career portal.">Periksa kembali tautan dari email Anda, atau minta tautan baru di portal karier.</p>
      <a class="btn" href="${esc(homeHref)}" data-id="Minta Tautan Baru" data-en="Request a New Link">Minta Tautan Baru</a>`;
  }

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${info.ok ? `${esc(info.payload.fullName)} — Status` : "Status"} · RekanKerja</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23${pal.brand.slice(1)}'/%3E%3C/svg%3E">
<style>
  :root { --brand:${pal.brand}; --accent:var(--brand); --accent-dark:${pal.dark}; --t95:${pal.t95}; --t91:${pal.t91}; --t87:${pal.t87}; --deep:${pal.deep}; --deep2:${pal.deep2}; --ink:#1c1917; --muted:#78716c; --bg:#faf9f5; --card:#ffffff; --line:#e7e5e0; --bad:#dc2626; --ok:#059669; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; background:var(--bg); color:var(--ink); min-height:100vh; display:flex; flex-direction:column; line-height:1.55; }
  header { background:var(--card); border-bottom:1px solid var(--line); padding:.9rem 1.25rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; position:sticky; top:0; z-index:5; }
  .wordmark { font-weight:800; letter-spacing:-.02em; font-size:1.05rem; display:flex; align-items:center; gap:.55rem; min-width:0; }
  .logo-img { height:2rem; width:auto; max-width:9rem; object-fit:contain; border-radius:.4rem; flex-shrink:0; }
  .logo-dot { width:.65rem; height:.65rem; border-radius:9999px; background:var(--accent); flex-shrink:0; }
  .wordmark .co { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .lang { background:transparent; border:1px solid var(--line); border-radius:.6rem; padding:.35rem .7rem; font-size:.78rem; font-weight:600; color:var(--muted); cursor:pointer; min-height:44px; }
  .lang:hover { border-color:var(--accent); color:var(--accent); }
  main { flex:1; width:100%; max-width:40rem; margin:0 auto; padding:2rem 1.25rem 3rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:1rem; padding:1.6rem 1.5rem; display:flex; flex-direction:column; gap:1.05rem; }
  h1 { font-size:1.3rem; letter-spacing:-.02em; }
  .who { display:flex; align-items:flex-start; justify-content:space-between; gap:.9rem; flex-wrap:wrap; }
  .who-name { font-weight:800; font-size:1.15rem; letter-spacing:-.01em; }
  .who-no { font-size:.78rem; color:var(--muted); margin-top:.15rem; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.82rem; }
  .muted { color:var(--muted); font-size:.85rem; line-height:1.6; }
  .tiny { font-size:.75rem; }
  .st { align-self:flex-start; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.05em; padding:.28rem .7rem; border-radius:9999px; background:var(--t95); color:var(--accent); border:1px solid var(--t87); }
  .st-big { font-size:.78rem; }
  .lead { font-size:.95rem; line-height:1.6; }
  .meta { display:flex; flex-direction:column; gap:.4rem; font-size:.85rem; color:#44403c; background:var(--t95); border:1px solid var(--t87); border-radius:.7rem; padding:.8rem .9rem; }
  .sect-h { font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin-top:.25rem; }
  .timeline { list-style:none; display:flex; flex-direction:column; gap:.65rem; margin:0; padding:0; }
  .tl-item { display:flex; gap:.7rem; align-items:flex-start; }
  .tl-dot { width:.85rem; height:.85rem; border-radius:9999px; border:2px solid var(--t87); background:var(--card); flex-shrink:0; margin-top:.2rem; }
  .tl-item.good .tl-dot { background:var(--ok); border-color:var(--ok); }
  .tl-item.bad .tl-dot { background:var(--bad); border-color:var(--bad); }
  .tl-name { font-weight:700; font-size:.9rem; }
  .tl-meta { font-size:.78rem; color:var(--muted); margin-top:.1rem; }
  .offerbox { background:var(--t91); border:1px solid var(--t87); border-radius:.7rem; padding:.8rem .9rem; }
  .box-title { font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--deep); }
  .offer-no { margin-top:.25rem; color:var(--deep2); font-size:.85rem; }
  .attachlist { list-style:none; display:flex; flex-direction:column; gap:.4rem; font-size:.85rem; margin:0; padding:0; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:.4rem; font:inherit; font-size:.88rem; font-weight:700; border-radius:.75rem; padding:.6rem 1.1rem; cursor:pointer; border:1px solid transparent; min-height:44px; background:var(--accent); color:#fff; text-decoration:none; align-self:flex-start; }
  .btn:hover { background:var(--accent-dark); }
  footer { margin-top:auto; background:var(--card); border-top:1px solid var(--line); padding:1rem 1.25rem calc(1rem + env(safe-area-inset-bottom)); text-align:center; color:var(--muted); font-size:.72rem; }
</style>
</head>
<body>
  <header>
    <div class="wordmark" aria-label="Portal Karir">${wordmarkHtml}<span class="co">Karir${company ? ` · ${esc(company)}` : ""}</span></div>
    <button class="lang" id="lang-toggle" type="button" aria-label="Ganti bahasa / switch language">EN</button>
  </header>
  <main>
    <div class="card">
      <h1 data-id="Status Lamaran Anda" data-en="Your Application Status">Status Lamaran Anda</h1>
      ${bodyHtml}
    </div>
  </main>
  <footer><span>© ${year} ${company ? esc(company) : "Portal Karir"} — RekanKerja · <span data-id="Data pribadi dilindungi sesuai UU No. 27/2022 (UU PDP)." data-en="Personal data is protected under Law No. 27/2022 (Indonesian PDP Law).">Data pribadi dilindungi sesuai UU No. 27/2022 (UU PDP).</span></span></footer>
<script>
(function () {
  "use strict";
  var KEY = "portal-lang", cur = "id";
  try { cur = localStorage.getItem(KEY) || "id"; } catch (e) {}
  var ql = null;
  try { ql = new URLSearchParams(location.search).get("lang"); } catch (e) {}
  if (ql === "id" || ql === "en") cur = ql; // ?lang= menimpa preferensi tersimpan
  var langBtn = document.getElementById("lang-toggle");
  function apply(lang) {
    cur = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-id]").forEach(function (el) {
      var v = el.getAttribute(lang === "id" ? "data-id" : "data-en");
      if (v != null) el.innerHTML = v;
    });
    langBtn.textContent = lang === "id" ? "EN" : "ID";
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }
  langBtn.addEventListener("click", function () { apply(cur === "id" ? "en" : "id"); });
  apply(cur);
})();
</script>
</body>
</html>`;
}
