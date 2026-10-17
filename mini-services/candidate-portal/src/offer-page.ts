// P2.4-BM (D-BM19) — HALAMAN PUTUSAN OFFER MANDIRI KANDIDAT
// /offer/<token>?t=<slug> — implementasi slice P2.4-D (export renderOfferPage
// dipertahankan — routing index.ts memanggil ini).
//
// Kontrak (pola /sign EsignRequest DB-token + /status SSR fetch):
//   * SSR server-side: fetch ringkasan via
//     /api/public/recruitment/offer-respond?token=&t= (MAIN_APP langsung,
//     pola fetchEsignInfo). Hasil: ok | 404 | 410 | down.
//   * TANPA nominal gaji di halaman publik (kebijakan halaman status —
//     surat resmi bertanda tangan dikirim via email oleh HR).
//   * Tombol Terima (konfirmasi 2 langkah) / Tolak + catatan opsional →
//     POST relatif /api/public/recruitment/offer-respond (proxy portal /
//     gateway meneruskan). 409 → "sudah diputuskan"; 410 → kedaluwarsa.
//   * Dwibahasa data-id/data-en + toggle + localStorage (pola /sign);
//     cache-control no-store; tanpa PII lain.

const MAIN_APP = process.env.CANDIDATE_PORTAL_MAIN_URL ?? "http://127.0.0.1:3000";
const FETCH_TIMEOUT_MS = 4000;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

interface OfferSummary {
  ok: true;
  offerNo: string;
  position: string | null;
  company: string | null;
  startDate: string | null;
  expiryDate: string | null;
  status: string;
}

type SummaryInfo =
  | { kind: "ok"; summary: OfferSummary }
  | { kind: "notfound" }
  | { kind: "expired" }
  | { kind: "down" };

async function fetchOfferSummary(token: string, tenantSlug: string | null): Promise<SummaryInfo> {
  const url = new URL("/api/public/recruitment/offer-respond", MAIN_APP);
  url.searchParams.set("token", token);
  if (tenantSlug) url.searchParams.set("t", tenantSlug);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (res.ok) {
      const j = (await res.json()) as OfferSummary;
      if (j && j.ok === true) return { kind: "ok", summary: j };
      return { kind: "notfound" };
    }
    if (res.status === 410) return { kind: "expired" };
    return { kind: "notfound" };
  } catch {
    return { kind: "down" };
  }
}

/** dd MMM yyyy (id) / MMM d, yyyy (en) — dwibahasa via span data-attr. */
function biDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  return isoDate.slice(0, 10);
}

const OFFER_STATUS_LABEL: Record<string, [string, string]> = {
  Draft: ["Draf", "Draft"],
  PendingApproval: ["Menunggu Persetujuan", "Pending Approval"],
  Sent: ["Menunggu Keputusan Anda", "Awaiting Your Decision"],
  Viewed: ["Menunggu Keputusan Anda", "Awaiting Your Decision"],
  Accepted: ["Diterima", "Accepted"],
  Declined: ["Ditolak", "Declined"],
  Expired: ["Kedaluwarsa", "Expired"],
};

export async function renderOfferPage(token: string, tenantSlug: string | null, url: URL): Promise<Response> {
  void url; // query diambil dari token/slug oleh routing; tidak dipakai lebih lanjut
  const info = await fetchOfferSummary(token, tenantSlug);
  const qs = tenantSlug ? `?t=${encodeURIComponent(tenantSlug)}` : "";

  // ---- isi kartu sesuai hasil fetch ----
  let bodyHtml: string;
  let badgeHtml: string;
  if (info.kind === "ok") {
    const s = info.summary;
    const [stId, stEn] = OFFER_STATUS_LABEL[s.status] ?? [s.status, s.status];
    const decided = s.status === "Accepted" || s.status === "Declined";
    badgeHtml = decided
      ? `<span class="st ${s.status === "Accepted" ? "st-ok" : "st-err"}" data-id="${esc(stId)}" data-en="${esc(stEn)}">${esc(stId)}</span>`
      : `<span class="st" data-id="${esc(stId)}" data-en="${esc(stEn)}">${esc(stId)}</span>`;

    if (decided) {
      // sudah diputuskan — layar konfirmasi status
      bodyHtml = `
      <div class="meta">
        <div><span data-id="Nomor Offer" data-en="Offer No.">Nomor Offer</span>: <span class="mono">${esc(s.offerNo)}</span></div>
        <div><span data-id="Posisi" data-en="Position">Posisi</span>: <b>${esc(s.position ?? "—")}</b></div>
      </div>
      <div class="ok-box">
        <div class="ok-ic">${s.status === "Accepted" ? "✓" : "✕"}</div>
        <p class="lead">${
          s.status === "Accepted"
            ? '<span data-id="Terima kasih! Anda telah MENERIMA penawaran kerja ini. Tim rekrutmen akan menghubungi Anda untuk langkah berikutnya." data-en="Thank you! You have ACCEPTED this job offer. The recruitment team will contact you for the next steps.">Terima kasih! Anda telah MENERIMA penawaran kerja ini. Tim rekrutmen akan menghubungi Anda untuk langkah berikutnya.</span>'
            : '<span data-id="Anda telah MENOLAK penawaran kerja ini. Terima kasih atas waktunya — keputusan ini tidak bisa diubah dari tautan yang sama." data-en="You have DECLINED this job offer. Thank you for your time — this decision cannot be changed from the same link.">Anda telah MENOLAK penawaran kerja ini. Terima kasih atas waktunya — keputusan ini tidak bisa diubah dari tautan yang sama.</span>'
        }</p>
      </div>`;
    } else if (s.status === "Sent" || s.status === "Viewed") {
      // menunggu keputusan → form putusan (TANPA nominal gaji)
      bodyHtml = `
      <div class="meta">
        <div><span data-id="Nomor Offer" data-en="Offer No.">Nomor Offer</span>: <span class="mono">${esc(s.offerNo)}</span></div>
        <div><span data-id="Posisi" data-en="Position">Posisi</span>: <b>${esc(s.position ?? "—")}</b></div>
        <div><span data-id="Perusahaan" data-en="Company">Perusahaan</span>: <b>${esc(s.company ?? "—")}</b></div>
        <div><span data-id="Mulai Kerja" data-en="Start Date">Mulai Kerja</span>: <span class="mono">${esc(biDate(s.startDate))}</span></div>
        <div><span data-id="Berlaku Sampai" data-en="Valid Until">Berlaku Sampai</span>: <span class="mono">${esc(biDate(s.expiryDate))}</span></div>
      </div>
      <p class="muted" data-id="Rincian penawaran lengkap (termasuk nominal) tercantum pada surat penawaran resmi yang dikirim ke email Anda." data-en="Full offer details (including the amount) are stated in the official offer letter sent to your email.">Rincian penawaran lengkap (termasuk nominal) tercantum pada surat penawaran resmi yang dikirim ke email Anda.</p>
      <form id="offer-form" novalidate>
        <label for="of-note"><span data-id="Catatan (opsional)" data-en="Note (optional)">Catatan (opsional)</span></label>
        <textarea id="of-note" rows="3" data-id-placeholder="${esc("mis. pertanyaan perihal tunjangan, jadwal mulai, dsb.")}" data-en-placeholder="${esc("e.g. questions about benefits, start schedule, etc.")}"></textarea>
        <p class="err" id="of-err" role="alert"></p>
        <div class="btn-row">
          <button type="button" id="of-decline" class="btn btn-ghost"><span data-id="Tolak" data-en="Decline">Tolak</span></button>
          <button type="button" id="of-accept" class="btn"><span data-id="Terima" data-en="Accept">Terima</span></button>
        </div>
      </form>
      <div id="of-confirm" class="confirm" hidden>
        <p class="steps" data-id="Anda akan MENERIMA penawaran kerja ini. Keputusan bersifat final dan hanya bisa dilakukan satu kali — pastikan Anda telah membaca surat penawaran di email." data-en="You are about to ACCEPT this job offer. The decision is final and can only be made once — make sure you have read the offer letter in your email.">Anda akan MENERIMA penawaran kerja ini. Keputusan bersifat final dan hanya bisa dilakukan satu kali — pastikan Anda telah membaca surat penawaran di email.</p>
        <div class="btn-row">
          <button type="button" id="of-cancel" class="btn btn-ghost"><span data-id="Batal" data-en="Cancel">Batal</span></button>
          <button type="button" id="of-accept-final" class="btn"><span data-id="Ya, Saya Terima" data-en="Yes, I Accept">Ya, Saya Terima</span></button>
        </div>
      </div>`;
    } else {
      // status lain (Draft / Expired / PendingApproval) — tidak menunggu keputusan
      bodyHtml = `
      <div class="meta">
        <div><span data-id="Nomor Offer" data-en="Offer No.">Nomor Offer</span>: <span class="mono">${esc(s.offerNo)}</span></div>
        <div><span data-id="Posisi" data-en="Position">Posisi</span>: <b>${esc(s.position ?? "—")}</b></div>
      </div>
      <p class="lead" data-id="Penawaran ini sedang tidak menunggu keputusan Anda — silakan hubungi tim rekrutmen yang menghubungi Anda." data-en="This offer is not awaiting your decision at the moment — please contact the recruitment team that reached out to you.">Penawaran ini sedang tidak menunggu keputusan Anda — silakan hubungi tim rekrutmen yang menghubungi Anda.</p>`;
    }
  } else if (info.kind === "expired") {
    badgeHtml = `<span class="st st-err" data-id="Kedaluwarsa" data-en="Expired">Kedaluwarsa</span>`;
    bodyHtml = `
      <p class="lead" data-id="Tautan putusan offer ini telah kedaluwarsa. Silakan hubungi tim rekrutmen yang menghubungi Anda untuk meminta tautan baru." data-en="This offer decision link has expired. Please contact the recruitment team that reached out to you to request a new link.">Tautan putusan offer ini telah kedaluwarsa. Silakan hubungi tim rekrutmen yang menghubungi Anda untuk meminta tautan baru.</p>`;
  } else if (info.kind === "down") {
    badgeHtml = `<span class="st st-err" data-id="Layanan Sibuk" data-en="Service Unavailable">Layanan Sibuk</span>`;
    bodyHtml = `
      <p class="lead" data-id="Portal tidak dapat menghubungi layanan rekrutmen saat ini. Silakan coba lagi beberapa saat." data-en="The portal cannot reach the recruitment service right now. Please try again in a few moments.">Portal tidak dapat menghubungi layanan rekrutmen saat ini. Silakan coba lagi beberapa saat.</p>`;
  } else {
    badgeHtml = `<span class="st st-err" data-id="404" data-en="404">404</span>`;
    bodyHtml = `
      <p class="lead" data-id="Tautan putusan offer tidak valid atau tidak dikenali." data-en="This offer decision link is invalid or not recognized.">Tautan putusan offer tidak valid atau tidak dikenali.</p>
      <p class="muted" data-id="Pastikan Anda membuka tautan lengkap yang dikirim tim rekrutmen ke email Anda." data-en="Make sure you opened the full link sent by the recruitment team to your email.">Pastikan Anda membuka tautan lengkap yang dikirim tim rekrutmen ke email Anda.</p>`;
  }

  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title data-id="Putusan Penawaran Kerja · RekanKerja" data-en="Job Offer Decision · RekanKerja">Putusan Penawaran Kerja · RekanKerja</title>
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
  .steps { font-size:.88rem; line-height:1.55; color:#44403c; }
  form { display:flex; flex-direction:column; gap:.55rem; }
  label { font-size:.8rem; font-weight:700; color:#44403c; }
  textarea { width:100%; padding:.7rem .8rem; border:1px solid var(--line); border-radius:.6rem; font-size:.95rem; background:#fff; font-family:inherit; resize:vertical; }
  textarea:focus { outline:2px solid #fed7aa; border-color:var(--accent); }
  .err { color:var(--err); font-size:.8rem; min-height:1em; }
  .btn-row { display:flex; gap:.6rem; margin-top:.4rem; }
  .btn { flex:1; padding:.85rem 1rem; background:var(--accent); color:#fff; border:none; border-radius:.7rem; font-size:.95rem; font-weight:800; cursor:pointer; }
  .btn:disabled { opacity:.6; cursor:wait; }
  .btn-ghost { background:#fff; color:var(--err); border:1px solid #fecaca; }
  .confirm { border:1px solid #fed7aa; background:#fff7ed; border-radius:.8rem; padding:1rem; display:flex; flex-direction:column; gap:.75rem; }
  .ok-box { text-align:center; padding:.6rem 0; }
  .ok-ic { width:54px; height:54px; margin:0 auto .8rem; border-radius:50%; background:#ecfdf5; color:var(--ok); display:grid; place-items:center; font-size:1.6rem; }
  footer { padding:1.1rem 1.25rem calc(1.1rem + env(safe-area-inset-bottom)); border-top:1px solid var(--line); text-align:center; color:var(--muted); font-size:.72rem; background:var(--card); }
  footer b { color:var(--text); }
</style>
</head>
<body>
  <header>
    <div class="logo" aria-hidden="true">RK</div>
    <div class="brand">RekanKerja<small data-id="Portal Kandidat" data-en="Candidate Portal">Portal Kandidat</small></div>
    <button id="lang" style="margin-left:auto;border:1px solid var(--line);background:#fff;border-radius:9999px;padding:.3rem .75rem;font-size:.75rem;font-weight:700;cursor:pointer">EN</button>
  </header>
  <main>
    <div class="card">
      <h1><span data-id="Putusan Penawaran Kerja" data-en="Job Offer Decision">Putusan Penawaran Kerja</span></h1>
      ${badgeHtml}
      <div id="of-body">${bodyHtml}</div>
    </div>
  </main>
  <footer><b>RekanKerja</b> · <span data-id="Putusan mandiri kandidat — ter-audit (UU ITE & UU PDP)." data-en="Candidate self-service decision — audited (Indonesian ITE & PDP laws).">Putusan mandiri kandidat — ter-audit (UU ITE & UU PDP).</span></footer>
<script>
(function () {
  "use strict";
  var KEY = "portal-lang", cur = "id";
  try { cur = localStorage.getItem(KEY) || "id"; } catch (e) {}
  function t(id, en) { return cur === "id" ? id : en; }

  // pesan error server (ID) → padanan EN (pola SERVER_ERRORS halaman /sign).
  // Sumber: api/public-offer-respond.ts + services/offer-service.ts.
  var SERVER_ERRORS = {
    "Terlalu banyak permintaan. Coba lagi nanti.": "Too many requests. Please try again later.",
    "Tautan putusan offer tidak valid atau tidak dikenali": "This offer decision link is invalid or not recognized",
    "Tautan putusan offer telah kedaluwarsa — minta tim rekrutmen mengirim ulang": "This offer decision link has expired — ask the recruitment team to resend",
    "Offer sudah diputuskan — keputusan hanya bisa dilakukan satu kali": "This offer has already been decided — the decision can only be made once",
    "Aksi tidak dikenal — gunakan accept atau decline": "Unknown action — use accept or decline"
  };
  function serverMsg(msg) { return cur === "en" && SERVER_ERRORS[msg] ? SERVER_ERRORS[msg] : msg; }

  function apply(lang) {
    cur = lang;
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-id][data-en]").forEach(function (el) {
      var v = el.getAttribute(lang === "id" ? "data-id" : "data-en");
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll("[data-id-placeholder]").forEach(function (el) {
      var v = el.getAttribute(lang === "id" ? "data-id-placeholder" : "data-en-placeholder");
      if (v != null) el.setAttribute("placeholder", v);
    });
    var btn = document.getElementById("lang");
    if (btn) btn.textContent = lang === "id" ? "EN" : "ID";
    var title = document.querySelector("title");
    if (title) title.textContent = t("Putusan Penawaran Kerja · RekanKerja", "Job Offer Decision · RekanKerja");
    try { localStorage.setItem(KEY, lang); } catch (e) {}
  }
  var langBtn = document.getElementById("lang");
  if (langBtn) langBtn.addEventListener("click", function () { apply(cur === "id" ? "en" : "id"); });
  apply(cur);

  // ---- form putusan (hanya ada saat summary ok + status Sent/Viewed) ----
  var form = document.getElementById("offer-form");
  if (!form) return;
  var TOKEN = ${JSON.stringify(token)};
  var TSLUG = ${JSON.stringify(tenantSlug ?? "")};
  var QS = ${JSON.stringify(qs)};
  var noteIn = document.getElementById("of-note");
  var errEl = document.getElementById("of-err");
  var acceptBtn = document.getElementById("of-accept");
  var declineBtn = document.getElementById("of-decline");
  var confirmBox = document.getElementById("of-confirm");
  var acceptFinalBtn = document.getElementById("of-accept-final");
  var cancelBtn = document.getElementById("of-cancel");

  function setBusy(b) {
    if (acceptBtn) acceptBtn.disabled = b;
    if (declineBtn) declineBtn.disabled = b;
    if (acceptFinalBtn) acceptFinalBtn.disabled = b;
    if (cancelBtn) cancelBtn.disabled = b;
  }

  function submit(action) {
    setBusy(true);
    if (errEl) errEl.textContent = "";
    var note = noteIn && noteIn.value ? noteIn.value.trim() : null;
    fetch("/api/public/recruitment/offer-respond" + QS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: TOKEN, action: action, note: note, t: TSLUG || undefined })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    }).then(function (res) {
      if (res.ok) {
        var accepted = action === "accept";
        var badge = document.querySelector(".st");
        if (badge) {
          badge.className = "st " + (accepted ? "st-ok" : "st-err");
          badge.textContent = accepted ? t("Diterima", "Accepted") : t("Ditolak", "Declined");
        }
        document.getElementById("of-body").innerHTML =
          '<div class="ok-box"><div class="ok-ic">' + (accepted ? "✓" : "✕") + "</div>" +
          '<p class="lead">' + (accepted
            ? t("Terima kasih! Anda telah MENERIMA penawaran kerja ini. Tim rekrutmen telah diberi tahu dan akan menghubungi Anda untuk langkah berikutnya.",
                "Thank you! You have ACCEPTED this job offer. The recruitment team has been notified and will contact you for the next steps.")
            : t("Anda telah MENOLAK penawaran kerja ini. Terima kasih atas waktunya — keputusan ini tidak bisa diubah dari tautan yang sama.",
                "You have DECLINED this job offer. Thank you for your time — this decision cannot be changed from the same link.")) + "</p></div>";
        return;
      }
      // 409 sudah diputuskan / 410 kedaluwarsa → layar status final
      if (res.status === 409 || res.status === 410) {
        var badge2 = document.querySelector(".st");
        if (badge2) { badge2.className = "st st-err"; badge2.textContent = res.status === 410 ? t("Kedaluwarsa", "Expired") : t("Sudah Diputuskan", "Decided"); }
        document.getElementById("of-body").innerHTML =
          '<p class="lead">' + (res.status === 410
            ? t("Tautan putusan offer ini telah kedaluwarsa. Silakan hubungi tim rekrutmen untuk meminta tautan baru.",
                "This offer decision link has expired. Please contact the recruitment team to request a new link.")
            : t("Offer ini sudah diputuskan sebelumnya — keputusan hanya bisa dilakukan satu kali.",
                "This offer has already been decided — the decision can only be made once.")) + "</p>";
        return;
      }
      setBusy(false);
      if (errEl) errEl.textContent = serverMsg((res.j && res.j.error) || t("Gagal memproses — coba lagi.", "Failed to process — please try again."));
    }).catch(function () {
      setBusy(false);
      if (errEl) errEl.textContent = t("Koneksi gagal — periksa jaringan Anda dan coba lagi.", "Connection failed — check your network and try again.");
    });
  }

  // accept = 2 langkah (tombol → konfirmasi final); decline = langsung
  if (acceptBtn) acceptBtn.addEventListener("click", function () {
    if (errEl) errEl.textContent = "";
    form.hidden = true;
    if (confirmBox) confirmBox.hidden = false;
  });
  if (cancelBtn) cancelBtn.addEventListener("click", function () {
    if (confirmBox) confirmBox.hidden = true;
    form.hidden = false;
  });
  if (acceptFinalBtn) acceptFinalBtn.addEventListener("click", function () { submit("accept"); });
  if (declineBtn) declineBtn.addEventListener("click", function () { submit("decline"); });
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
