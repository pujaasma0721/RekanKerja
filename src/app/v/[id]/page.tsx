import Link from "next/link";
import { cookies, headers } from "next/headers";
import { BadgeCheck, ShieldAlert, FileSignature, Fingerprint } from "lucide-react";

// ============ HALAMAN VERIFIKASI PUBLIK e-SIGN (Task 80) ====================
// /v/[id] — diakses dari QR code pada dokumen/PDF. Tanpa login. Hanya
// metadata pembuktian (penandatangan, waktu, status kriptografis) — ISI
// dokumen tidak diekspos. Tenant di-resolve server via API (?t= / host /
// pencarian lintas tenant) — di sini cukup render hasil fetch.
//
// Bilingual (Task 103-d): server component TIDAK bisa membaca localStorage
// "rekankerja:lang" → preferensi bahasa dibaca dari cookie "rklang" yang
// ditulis I18nProvider (shared/lib/i18n.tsx). Semua teks statis dibungkus
// helper tr(id, en); format tanggal mengikuti lang.
// ============================================================================

export const dynamic = "force-dynamic";

interface VerifyPayload {
  valid?: boolean; reason?: string;
  docType?: string; docRef?: string;
  signerName?: string; signerRole?: string | null; signedAt?: string;
  tenantSlug?: string; chainIntact?: boolean; chainLength?: number;
  error?: string;
}

// Label jenis dokumen per bahasa (di-render via tr di bawah).
const DOC_LABEL: Record<string, { id: string; en: string }> = {
  LetterDocument: { id: "Surat", en: "Letter" },
  PersonnelAction: { id: "Personnel Action", en: "Personnel Action" },
  PayrollRun: { id: "Run Payroll", en: "Run Payroll" },
};

async function verify(id: string, host: string | null): Promise<{ data: VerifyPayload | null; status: number }> {
  const base = host ? `https://${host}` : "";
  try {
    const res = await fetch(`${base}/api/public/esign-verify?id=${encodeURIComponent(id)}`, {
      headers: host ? { "x-forwarded-host": host } : {},
      cache: "no-store",
    });
    const json = (await res.json()) as VerifyPayload;
    return { data: json, status: res.status };
  } catch {
    return { data: null, status: 0 };
  }
}

export default async function VerifyPage({ params }: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Next 16 — headers()/cookies() async; x-forwarded-host dari nginx/Cloudflare
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const { data, status } = await verify(id, host);

  // Preferensi bahasa via cookie rklang (default Indonesia).
  const lang = (await cookies()).get("rklang")?.value === "en" ? "en" : "id";
  const tr = (id: string, en: string) => (lang === "en" ? en : id);

  const fmt = (iso?: string) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(lang === "en" ? "en-US" : "id-ID", { dateStyle: "full", timeStyle: "short" });
  };

  const docLabelOf = (dt?: string) => {
    const dl = DOC_LABEL[dt ?? ""];
    return dl ? tr(dl.id, dl.en) : (dt ?? "—");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Fingerprint className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">RekanKerja e-Sign</p>
            <h1 className="text-lg font-bold leading-tight text-slate-900">
              {tr("Verifikasi Tanda Tangan Elektronik", "Electronic Signature Verification")}
            </h1>
          </div>
        </div>

        {status === 404 || data?.error ? (
          <div className="rounded-xl bg-rose-50 p-5 ring-1 ring-rose-200">
            <div className="flex items-center gap-2 font-bold text-rose-700">
              <ShieldAlert className="h-5 w-5" /> {tr("Tanda tangan tidak ditemukan", "Signature not found")}
            </div>
            <p className="mt-2 text-sm text-rose-600">
              {tr(
                "QR atau tautan ini tidak merujuk pada tanda tangan yang terdaftar. Pastikan kode diambil dari dokumen resmi.",
                "This QR/link does not match a registered signature. Make sure the code comes from an official document.",
              )}
            </p>
          </div>
        ) : data?.valid ? (
          <div className="space-y-4">
            <div className={`rounded-xl p-5 ring-1 ${data.chainIntact === false ? "bg-amber-50 ring-amber-200" : "bg-emerald-50 ring-emerald-200"}`}>
              <div className={`flex items-center gap-2 font-bold ${data.chainIntact === false ? "text-amber-700" : "text-emerald-700"}`}>
                {data.chainIntact === false ? <ShieldAlert className="h-5 w-5" /> : <BadgeCheck className="h-5 w-5" />}
                {data.chainIntact === false
                  ? tr("VALID — dengan catatan rantai", "VALID — with chain caveats")
                  : tr("TANDA TANGAN VALID", "SIGNATURE VALID")}
              </div>
              <p className="mt-1.5 text-sm text-emerald-800/80">
                {data.chainIntact === false
                  ? tr(
                      "Tanda tangan kriptografis sah, namun posisinya dalam rantai historis tidak berurutan — hubungi administrator untuk audit.",
                      "The cryptographic signature is valid, but its position in the historical chain is out of order — contact an administrator for an audit.",
                    )
                  : tr(
                      "Dokumen ditandatangani secara elektronik dan tidak berubah sejak ditandatangani (terverifikasi kriptografis).",
                      "This document was signed electronically and has not changed since signing (cryptographically verified).",
                    )}
              </p>
            </div>

            <dl className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
              <Row label={tr("Dokumen", "Document")} value={`${docLabelOf(data.docType)}${data.docRef ? ` · ${data.docRef}` : ""}`} />
              <Row label={tr("Penandatangan", "Signer")} value={data.signerName ?? "—"} icon />
              <Row label={tr("Peran", "Role")} value={data.signerRole ?? "—"} />
              <Row label={tr("Waktu tanda tangan", "Signing time")} value={fmt(data.signedAt)} />
              <Row label={tr("Organisasi", "Organization")} value={data.tenantSlug ?? "—"} />
            </dl>
          </div>
        ) : (
          <div className="rounded-xl bg-rose-50 p-5 ring-1 ring-rose-200">
            <div className="flex items-center gap-2 font-bold text-rose-700">
              <ShieldAlert className="h-5 w-5" /> {tr("TANDA TANGAN TIDAK VALID", "SIGNATURE INVALID")}
            </div>
            <p className="mt-2 text-sm text-rose-600">
              {data?.reason ?? tr(
                "Verifikasi gagal — dokumen kemungkinan telah diubah setelah ditandatangani.",
                "Verification failed — the document may have been altered after signing.",
              )}
            </p>
          </div>
        )}

        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-slate-400">
          <FileSignature className="h-3.5 w-3.5" />
          {tr(
            "Bukti kriptografis RSA-PSS · SHA-256 · hash-chain per organisasi",
            "Cryptographic proof: RSA-PSS · SHA-256 · per-organization hash chain",
          )}
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          {tr(
            "Butuh memeriksa dokumen fisik/digital? Cocokkan nomor dokumen dan penandatangan di atas dengan salinan resmi Anda.",
            "Need to check the physical/digital document? Match the document number and signer above against your official copy.",
          )}{" "}
          <Link href="/" className="font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-700">
            {tr("Beranda RekanKerja", "RekanKerja Home")}
          </Link>
        </p>
      </div>
    </main>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-right text-sm font-bold text-slate-800">{icon ? <span className="inline-flex items-center gap-1.5">{value}</span> : value}</dd>
    </div>
  );
}
