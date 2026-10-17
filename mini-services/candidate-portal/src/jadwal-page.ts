// P2.3-BM (D-BM18) — HALAMAN KANDIDAT MEMILIH SLOT JADWAL WAWANCARA
// /jadwal/<token>?t=<slug> — implementasi slice P2.3-C (routing index.ts
// Phase 0 sudah memanggil renderJadwalPage; tanda tangan dipertahankan).
//
// Kontrak (pola /status + /sign — lihat index.ts):
//   * SSR server-side: fetch slot via GET /api/public/recruitment/interview-slots
//     ?token=&t= langsung ke MAIN_APP (pola fetchStatusInfo). Respons:
//     200 {ok, position, companyName, tahap, slots[]} · 404/410 netral · 429.
//   * Kandidat klik "Pilih" → POST /api/public/recruitment/interview-slots
//     (URL RELATIF — mode direct :3010 dilayani proxy portal, mode gateway
//     diteruskan aplikasi utama; pola halaman /sign).
//   * 200 → layar konfirmasi "Jadwal Anda terkunci" (+ info .ics via email);
//     409 → slot sudah diambil, daftar di-refresh; 410 → kedaluwarsa (hubungi HR).
//   * Tanpa PII lain (nama evaluator/kandidat TIDAK pernah dikirim API);
//     waktu ditampilkan dalam WIB; cache-control no-store.
//   * Dwibahasa ID/EN: ?lang + toggle + localStorage "portal-lang" (pola /status).
const MAIN_APP = process.env.CANDIDATE_PORTAL_MAIN_URL ?? "http://127.0.0.1:3000";
const FETCH_TIMEOUT_MS = 8000;

interface JadwalSlot { id: string; startAt: string; durationMin: number; status: string }
interface JadwalInfo { ok: true; position: string; companyName: string | null; tahap: string; slots: JadwalSlot[] }
type JadwalPayload = { ok: true; info: JadwalInfo } | { ok: false; code: 404 | 410 | 429 | 0 };

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** SSR fetch slot (pola fetchStatusInfo /status). */
async function fetchJadwalInfo(token: string, tenantSlug: string | null): Promise<JadwalPayload> {
  const url = new URL("/api/public/recruitment/interview-slots", MAIN_APP);
  url.searchParams.set("token", token);
  if (tenantSlug) url.searchParams.set("t", tenantSlug);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (res.ok) {
      const j = (await res.json()) as JadwalInfo | { ok?: false } | null;
      if (j && (j as JadwalInfo).ok === true) return { ok: true, info: j as JadwalInfo };
      return { ok: false, code: 404 };
    }
    if (res.status === 410) return { ok: false, code: 410 };
    if (res.status === 429) return { ok: false, code: 429 };
    return { ok: false, code: 404 };
  } catch {
    return { ok: false, code: 0 }; // aplikasi utama mati / timeout
  }
}

// ---- format waktu WIB (Asia/Jakarta) dwibahasa ----

const JAKARTA_DATE: Intl.DateTimeFormatOptions = { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" };
const JAKARTA_TIME: Intl.DateTimeFormatOptions = { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false };

function fmtSlotId(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("id-ID", JAKARTA_DATE).format(d);
  const time = new Intl.DateTimeFormat("id-ID", JAKARTA_TIME).format(d).replace(".", ":").replace(":24", ":00");
  return `${date} · ${time} WIB`;
}

function fmtSlotEn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = new Intl.DateTimeFormat("en-US", JAKARTA_DATE).format(d);
  const time = new Intl.DateTimeFormat("en-US", JAKARTA_TIME).format(d).replace(":24", ":00");
  return `${date} · ${time} WIB`;
}

/** <span data-id data-en> — slot time bilingual (pola biDate /status). */
function biSlotTime(iso: string): string {
  return `<span data-id="${esc(fmtSlotId(iso))}" data-en="${esc(fmtSlotEn(iso))}">${esc(fmtSlotId(iso))}</span>`;
}

export async function renderJadwalPage(token: string, tenantSlug: string | null, url: URL): Promise<Response> {
  void url; // query di luar ?t / ?lang tidak dipakai (token dari path)
  const payload = await fetchJadwalInfo(token, tenantSlug);
  const qs = tenantSlug ? `?t=${encodeURIComponent(tenantSlug)}` : "";
  const year = new Date().getFullYear();

  // ---- isi kartu sesuai hasil verifikasi ----
  let bodyHtml: string;
  if (payload.ok) {
    const info = payload.info;
    const slotsHtml = info.slots.length
      ? `<ul class="slotlist" id="slotlist">${info.slots.map((s) => {
          const open = s.status === "Open";
          const badge = s.status === "Open"
            ? `<span class="st st-open" data-id="Tersedia" data-en="Open">Tersedia</span>`
            : s.status === "Booked"
              ? `<span class="st st-booked" data-id="Terpilih" data-en="Booked">Terpilih</span>`
              : `<span class="st st-closed" data-id="Ditutup" data-en="Closed">Ditutup</span>`;
          return `<li class="slot${open ? "" : " off"}" data-id="${esc(s.id)}">
            <div class="slot-when">${biSlotTime(s.startAt)}</div>
            <div class="slot-sub"><span data-id="${s.durationMin} menit" data-en="${s.durationMin} minutes">${s.durationMin} menit</span></div>
            <div class="slot-side">${badge}
              <button type="button" class="btn pick" data-id="${esc(s.id)}" data-start="${esc(s.startAt)}"${open ? "" : " disabled"}>
                <span data-id="Pilih" data-en="Pick">Pilih</span>
              </button>
            </div>
          </li>`;
        }).join("")}</ul>`
      : `<p class="muted" data-id="Belum ada slot yang dibuka. Silakan hubungi tim rekrutmen yang menghubungi Anda." data-en="No slots have been opened yet. Please contact the recruitment team that reached out to you.">Belum ada slot yang dibuka. Silakan hubungi tim rekrutmen yang menghubungi Anda.</p>`;

    bodyHtml = `
      <div class="meta">
        <div><span data-id="Posisi" data-en="Position">Posisi</span>: <b>${esc(info.position)}</b></div>
        <div><span data-id="Tahap" data-en="Stage">Tahap</span>: <b>${esc(info.tahap)}</b></div>
        ${info.companyName ? `<div><span data-id="Perusahaan" data-en="Company">Perusahaan</span>: ${esc(info.companyName)}</div>` : ""}
      </div>
      ${slotsHtml}
      <p class="muted tiny" data-id="Pilih salah satu waktu di atas — jadwal Anda terkunci begitu dipilih dan undangan kalender (.ics) dikirim ke email Anda. Waktu ditampilkan dalam WIB." data-en="Pick one of the times above — your schedule locks in as soon as you choose, and a calendar invitation (.ics) is emailed to you. Times are shown in WIB.">Pilih salah satu waktu di atas — jadwal Anda terkunci begitu dipilih dan undangan kalender (.ics) dikirim ke email Anda. Waktu ditampilkan dalam WIB.</p>
      <p class="err" id="jd-msg" role="alert" aria-live="polite"></p>`;
  } else if (payload.code === 410) {
    bodyHtml = `
      <p class="lead" data-id="Tautan undangan ini sudah kedaluwarsa." data-en="This invitation link has expired.">Tautan undangan ini sudah kedaluwarsa.</p>
      <p class="muted" data-id="Silakan hubungi tim rekrutmen / HR yang menghubungi Anda untuk mendapatkan tautan undangan baru." data-en="Please contact the recruitment team / HR who reached out to you to get a new invitation link.">Silakan hubungi tim rekrutmen / HR yang menghubungi Anda untuk mendapatkan tautan undangan baru.</p>`;
  } else if (payload.code === 429) {
    bodyHtml = `
      <p class="lead" data-id="Terlalu banyak permintaan. Coba lagi nanti." data-en="Too many requests. Please try again later.">Terlalu banyak permintaan. Coba lagi nanti.</p>`;
  } else if (payload.code === 0) {
    bodyHtml = `
      <p class="lead" data-id="Layanan penjadwalan sementara tidak dapat dihubungi. Silakan coba lagi beberapa saat." data-en="The scheduling service is temporarily unreachable. Please try again in a moment.">Layanan penjadwalan sementara tidak dapat dihubungi. Silakan coba lagi beberapa saat.</p>
      <p class="muted" data-id="Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal." data-en="This page is the Candidate Portal — a separate application from the internal HR system.">Halaman ini adalah Portal Kandidat — aplikasi terpisah dari sistem HR internal.</p>`;
  } else {
    bodyHtml = `
      <p class="lead" data-id="Tautan undangan jadwal tidak valid atau tidak dikenali." data-en="The schedule invitation link is invalid or unrecognized.">Tautan undangan jadwal tidak valid atau tidak dikenali.</p>
      <p class="muted" data-id="Periksa kembali tautan dari email Anda, atau hubungi tim rekrutmen yang menghubungi Anda." data-en="Double-check the link from your email, or contact the recruitment team that reached out to you.">Periksa kembali tautan dari email Anda, atau hubungi tim rekrutmen yang menghubungi Anda.</p>`;
  }

  // data untuk client JS (pilih slot → POST; refresh daftar setelah 409)
  const dataJson = JSON.stringify({
    token,
    t: tenantSlug,
    live: payload.ok,
    slots: payload.ok ? payload.info.slots : [],
    position: payload.ok ? payload.info.position : "",
    tahap: payload.ok ? payload.info.tahap : "",
  }).replace(/</g, "\\u003c");

  return new Response(`<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${payload.ok ? `${esc(payload.info.tahap)} — ${esc(payload.info.position)}` : "Jadwal"} · RekanKerja</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23ea580c'/%3E%3C/svg%3E">
<style>
  :root { --accent:#ea580c; --accent-dark:#c2410c; --t95:#fff7ed; --t87:#fed7aa; --ink:#1c1917; --muted:#78716c; --bg:#faf9f5; --card:#ffffff; --line:#e7e5e0; --bad:#dc2626; --ok:#059669; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; background:var(--bg); color:var(--ink); min-height:100vh; display:flex; flex-direction:column; line-height:1.55; }
  header { background:var(--card); border-bottom:1px solid var(--line); padding:.9rem 1.25rem; display:flex; align-items:center; justify-content:space-between; gap:1rem; position:sticky; top:0; z-index:5; }
  .wordmark { font-weight:800; letter-spacing:-.02em; font-size:1.05rem; display:flex; align-items:center; gap:.55rem; min-width:0; }
  .logo-dot { width:.65rem; height:.65rem; border-radius:9999px; background:var(--accent); flex-shrink:0; }
  .lang { background:transparent; border:1px solid var(--line); border-radius:.6rem; padding:.35rem .7rem; font-size:.78rem; font-weight:600; color:var(--muted); cursor:pointer; min-height:44px; }
  .lang:hover { border-color:var(--accent); color:var(--accent); }
  main { flex:1; width:100%; max-width:40rem; margin:0 auto; padding:2rem 1.25rem 3rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:1rem; padding:1.6rem 1.5rem; display:flex; flex-direction:column; gap:1.05rem; }
  h1 { font-size:1.3rem; letter-spacing:-.02em; }
  .lead { font-size:.95rem; line-height:1.6; }
  .muted { color:var(--muted); font-size:.85rem; line-height:1.6; }
  .tiny { font-size:.75rem; }
  .meta { display:flex; flex-direction:column; gap:.4rem; font-size:.85rem; color:#44403c; background:var(--t95); border:1px solid var(--t87); border-radius:.7rem; padding:.8rem .9rem; }
  .slotlist { list-style:none; display:flex; flex-direction:column; gap:.65rem; margin:0; padding:0; }
  .slot { display:flex; flex-direction:column; gap:.35rem; border:1px solid var(--line); border-radius:.8rem; padding:.85rem .9rem; background:var(--card); }
  .slot.off { opacity:.55; }
  .slot-when { font-weight:700; font-size:.92rem; }
  .slot-sub { font-size:.78rem; color:var(--muted); }
  .slot-side { display:flex; align-items:center; justify-content:space-between; gap:.6rem; flex-wrap:wrap; }
  .st { font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:.05em; padding:.22rem .6rem; border-radius:9999px; border:1px solid var(--t87); background:var(--t95); color:var(--accent); }
  .st-booked { background:#ecfdf5; color:var(--ok); border-color:#a7f3d0; }
  .st-closed { background:#f4f4f5; color:var(--muted); border-color:#e7e5e4; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:.4rem; font:inherit; font-size:.88rem; font-weight:700; border-radius:.75rem; padding:.6rem 1.1rem; cursor:pointer; border:1px solid transparent; min-height:44px; background:var(--accent); color:#fff; }
  .btn:hover { background:var(--accent-dark); }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn.block { width:100%; }
  .err { color:var(--bad); font-size:.8rem; min-height:1em; }
  .ok-box { text-align:center; padding:.6rem 0; }
  .ok-ic { width:54px; height:54px; margin:0 auto .8rem; border-radius:50%; background:#ecfdf5; color:var(--ok); display:grid; place-items:center; font-size:1.6rem; }
  .ok-when { margin-top:.5rem; font-weight:800; font-size:1rem; }
  footer { margin-top:auto; background:var(--card); border-top:1px solid var(--line); padding:1rem 1.25rem calc(1rem + env(safe-area-inset-bottom)); text-align:center; color:var(--muted); font-size:.72rem; }
</style>
</head>
<body>
  <header>
    <div class="wordmark" aria-label="Portal Karir"><span class="logo-dot" aria-hidden="true"></span><span class="co">Karir${payload.ok && payload.info.companyName ? ` · ${esc(payload.info.companyName)}` : ""}</span></div>
    <button class="lang" id="lang-toggle" type="button" aria-label="Ganti bahasa / switch language">EN</button>
  </header>
  <main>
    <div class="card">
      <h1 data-id="Pilih Jadwal Wawancara" data-en="Choose Your Interview Time">Pilih Jadwal Wawancara</h1>
      <div id="jd-body">${bodyHtml}</div>
    </div>
  </main>
  <footer><span>© ${year} RekanKerja · <span data-id="Data pribadi dilindungi sesuai UU No. 27/2022 (UU PDP)." data-en="Personal data is protected under Law No. 27/2022 (Indonesian PDP Law).">Data pribadi dilindungi sesuai UU No. 27/2022 (UU PDP).</span></span></footer>
<script>
(function () {
  "use strict";
  var INIT = ${dataJson};
  var QS = ${JSON.stringify(qs)};
  var API = "/api/public/recruitment/interview-slots";
  var KEY = "portal-lang", cur = "id";
  try { cur = localStorage.getItem(KEY) || "id"; } catch (e) {}
  var ql = null;
  try { ql = new URLSearchParams(location.search).get("lang"); } catch (e) {}
  if (ql === "id" || ql === "en") cur = ql; // ?lang= menimpa preferensi tersimpan
  function t(id, en) { return cur === "id" ? id : en; }
  var langBtn = document.getElementById("lang-toggle");
  function apply(lang) {
    cur = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-id][data-en]").forEach(function (el) {
      var v = el.getAttribute(lang === "id" ? "data-id" : "data-en");
      if (v != null) el.innerHTML = v;
    });
    langBtn.textContent = lang === "id" ? "EN" : "ID";
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }
  langBtn.addEventListener("click", function () { apply(cur === "id" ? "en" : "id"); });
  apply(cur);

  var slots = INIT.slots || [];
  var msgEl = document.getElementById("jd-msg");
  // tombol hasil SSR tidak membawa listener (binding hanya di renderRows) —
  // render ulang sekali di load supaya klik "Pilih" langsung hidup.
  renderRows();
  function msg(text) { if (msgEl) msgEl.textContent = text || ""; }

  function fmtSlot(iso, lang) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    try {
      return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", { timeZone: "Asia/Jakarta", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d)
        + " · " + new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(".", ":").replace(":24", ":00") + " WIB";
    } catch (e) { return iso; }
  }

  function renderRows() {
    var list = document.getElementById("slotlist");
    if (!list) return;
    list.innerHTML = "";
    slots.forEach(function (s) {
      var open = s.status === "Open";
      var li = document.createElement("li");
      li.className = "slot" + (open ? "" : " off");
      var when = document.createElement("div");
      when.className = "slot-when";
      when.textContent = fmtSlot(s.startAt, cur);
      var sub = document.createElement("div");
      sub.className = "slot-sub";
      sub.textContent = t(s.durationMin + " menit", s.durationMin + " minutes");
      var side = document.createElement("div");
      side.className = "slot-side";
      var badge = document.createElement("span");
      badge.className = "st" + (s.status === "Booked" ? " st-booked" : s.status === "Closed" ? " st-closed" : "");
      badge.textContent = s.status === "Open" ? t("Tersedia", "Open") : s.status === "Booked" ? t("Terpilih", "Booked") : t("Ditutup", "Closed");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn pick";
      btn.textContent = t("Pilih", "Pick");
      if (!open) btn.disabled = true;
      btn.addEventListener("click", function () { choose(s.id, btn); });
      side.appendChild(badge);
      side.appendChild(btn);
      li.appendChild(when); li.appendChild(sub); li.appendChild(side);
      list.appendChild(li);
    });
  }

  function busy(on, btn) {
    var all = document.querySelectorAll(".btn.pick");
    for (var i = 0; i < all.length; i++) all[i].disabled = on;
    if (btn && on) btn.textContent = t("Memproses…", "Processing…");
    else if (btn && !on) btn.textContent = t("Pilih", "Pick");
  }

  function choose(slotId, btn) {
    msg("");
    busy(true, btn);
    fetch(API + QS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: INIT.token, slotId: slotId, t: INIT.t || null })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (res) {
      if (res.ok && res.j && res.j.ok) {
        var when = fmtSlot(res.j.startAt || "", cur);
        document.getElementById("jd-body").innerHTML =
          '<div class="ok-box"><div class="ok-ic">✓</div>' +
          '<p class="lead"><b>' + t("Jadwal Anda terkunci.", "Your schedule is locked in.") + '</b></p>' +
          '<p class="ok-when">' + escHtml(when) + '</p>' +
          '<p class="muted" style="margin-top:.6rem">' + t("Undangan kalender (.ics) dan konfirmasi telah dikirim ke email Anda. Silakan hadir tepat waktu — hubungi tim rekrutmen bila ada perubahan.", "A calendar invitation (.ics) and confirmation have been sent to your email. Please be on time — contact the recruitment team if anything changes.") + '</p></div>';
        return;
      }
      busy(false, null);
      if (res.status === 409) {
        msg(t("Slot yang Anda pilih sudah diambil orang lain. Daftar diperbarui — silakan pilih waktu lain.", "The slot you picked has just been taken. The list has been refreshed — please pick another time."));
        refresh();
        return;
      }
      if (res.status === 410) {
        document.getElementById("jd-body").innerHTML =
          '<p class="lead">' + t("Tautan undangan ini sudah kedaluwarsa.", "This invitation link has expired.") + '</p>' +
          '<p class="muted">' + t("Silakan hubungi tim rekrutmen / HR yang menghubungi Anda untuk mendapatkan tautan undangan baru.", "Please contact the recruitment team / HR who reached out to you to get a new invitation link.") + '</p>';
        return;
      }
      if (res.status === 429) { msg(t("Terlalu banyak permintaan. Coba lagi nanti.", "Too many requests. Please try again later.")); return; }
      msg(t("Tautan atau slot tidak dikenali — muat ulang halaman atau hubungi tim rekrutmen.", "The link or slot is unrecognized — reload the page or contact the recruitment team."));
    }).catch(function () {
      busy(false, null);
      msg(t("Koneksi gagal — periksa jaringan Anda dan coba lagi.", "Connection failed — check your network and try again."));
    });
  }

  function refresh() {
    var u = API + "?token=" + encodeURIComponent(INIT.token) + (INIT.t ? "&t=" + encodeURIComponent(INIT.t) : "");
    fetch(u, { headers: { accept: "application/json" } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.ok && Array.isArray(j.slots)) { slots = j.slots; renderRows(); }
    }).catch(function () { /* daftar lama tetap tampil */ });
  }

  function escHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
})();
</script>
</body>
</html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
