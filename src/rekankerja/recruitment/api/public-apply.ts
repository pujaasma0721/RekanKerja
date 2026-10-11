import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { getTenantClient } from "@/rekankerja/shared/lib/tenant-db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import { MAX_ATTACHMENT_BYTES } from "@/rekankerja/shared/services/attachment-service";
import {
  verifyCaptcha, ipHashOf, clientIpOf, listPublicOpenings,
} from "@/rekankerja/recruitment/services/public-recruitment-service";
import { evaluateKnockouts } from "@/rekankerja/recruitment/services/opening-service";
import { submitPublicApplication } from "@/rekankerja/recruitment/services/applicant-service";

// ============================================================================
// RECRUITMENT F2 — PUBLIC: kirim lamaran anonim (staging PublicApplication).
// POST /api/public/recruitment/apply  (multipart/form-data)
//   slotId?            — id slot (JobOpening) yang dilamar; kosong = umum
//   firstName*         — nama depan
//   middleName?, lastName?, email*, phone?, city?, birthDate?, gender?
//   educationLevel?, fieldOfStudy?, institution?, graduationYear?, gpa?
//   expYears?, lastPosition?, lastCompany?, expectedSalary?, notes?
//   captchaToken*, captchaAnswer*  — challenge dari /api/public/recruitment/captcha
//   website?           — HONEYPOT (terisi = bot → status Spam, respons tetap 201)
//   consent*           — wajib "true" (UU PDP — dicatat ApplicantConsent)
//   cv?                — File JPG/PNG/WEBP/PDF ≤ 5MB (opsional)
//   ko_<questionId>?   — F6 (HRX B3): jawaban pertanyaan knockout slot — salah
//                        → staging Rejected otomatis (respons TETAP 201, catatan
//                        di rejectNote + jawaban tersimpan utk audit).
// Response 201 { ok: true } — sukses maupun spam-honeypot/knockout-gagal
// (anti-enumeration).
// Rate limit 5 lamaran / 15 menit / IP (hash disimpan, bukan IP mentah).
// ============================================================================

export const runtime = "nodejs";

const APPLY_IP_LIMIT = 5;
const APPLY_IP_WINDOW_MS = 15 * 60 * 1000;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // rate limit per IP — sebelum parsing body
    const ip = clientIpOf(req);
    const rl = hitRateLimit(`recruitment-apply:ip:${ip}`, APPLY_IP_LIMIT, APPLY_IP_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak lamaran terkirim. Silakan coba lagi nanti." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    // ---- resolusi tenant (?t= → subdomain → fallback 1 aktif) ----
    let schemaName: string | null = null;
    let tenantSlug: string | null = null;
    const tParam = req.nextUrl.searchParams.get("t");
    const bySlug = tParam ? await platformDb.tenant.findUnique({ where: { slug: tParam }, select: { slug: true, schemaName: true, status: true } }) : null;
    if (bySlug?.status === "ACTIVE") {
      schemaName = bySlug.schemaName;
      tenantSlug = bySlug.slug;
    }
    if (!schemaName) {
      const { resolveTenantByHost } = await import("@/rekankerja/shared/lib/tenant-host-server");
      const byHost = await resolveTenantByHost(req).catch(() => null);
      if (byHost?.tenant) {
        const row = await platformDb.tenant.findUnique({ where: { slug: byHost.tenant.slug }, select: { slug: true, schemaName: true, status: true } });
        if (row?.status === "ACTIVE") {
          schemaName = row.schemaName;
          tenantSlug = row.slug;
        }
      }
    }
    if (!schemaName) {
      // fallback: default tenant pertama (konsisten /openings — picker UI
      // selalu mengirim ?t= eksplisit setelah pengguna memilih perusahaan)
      const active = await platformDb.tenant.findMany({ where: { status: "ACTIVE" }, select: { slug: true, schemaName: true }, orderBy: { createdAt: "asc" } });
      if (active.length > 0) {
        schemaName = active[0]!.schemaName;
        tenantSlug = active[0]!.slug;
      }
    }
    if (!schemaName || !tenantSlug) {
      return bad("Perusahaan tidak ditemukan. Pilih perusahaan pada halaman karier.", 404);
    }

    // ---- parsing multipart ----
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return bad("Request harus multipart/form-data");
    }

    // ---- captcha wajib ----
    const captchaToken = String(form.get("captchaToken") ?? "");
    const captchaAnswer = String(form.get("captchaAnswer") ?? "");
    if (!verifyCaptcha(captchaToken, captchaAnswer)) {
      return bad("Verifikasi keamanan salah atau kedaluwarsa. Silakan coba lagi.");
    }

    // ---- consent UU PDP wajib ----
    if (String(form.get("consent") ?? "") !== "true") {
      return bad("Persetujuan pemrosesan data pribadi wajib diberikan.");
    }

    // ---- honeypot: field tersembunyi yang diisi = bot → Spam (respons sama) ----
    const honeypot = String(form.get("website") ?? "").trim();
    const spam = honeypot.length > 0;

    // ---- field teks ----
    const txt = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v.trim() : "";
    };
    const num = (k: string): number | null => {
      const v = txt(k);
      if (!v) return null;
      const n = Number(v.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };

    const firstName = txt("firstName");
    if (!firstName) return bad("Nama depan wajib diisi");
    const email = txt("email");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("Email valid wajib diisi");

    // ---- slot yang dilamar (validasi masih layak bila diisi) ----
    let jobOpeningId: string | null = null;
    const slotId = txt("slotId");
    if (slotId) {
      const db = getTenantClient(schemaName);
      const slot = await db.jobOpening.findUnique({
        where: { id: slotId },
        select: { id: true, status: true, jobOpportunity: { select: { status: true } } },
      });
      if (!slot || slot.status !== "Open" || slot.jobOpportunity.status !== "Posted") {
        return bad("Lowongan sudah tidak tersedia. Silakan pilih lowongan lain.");
      }
      jobOpeningId = slot.id;
    }

    // ---- F6 (HRX B3): evaluasi jawaban knockout ko_<questionId> ----
    // Hanya field yang DIKIRIM form yang dievaluasi (form lama tanpa knockout
    // tetap lolos) — jawaban tersimpan di payload utk audit + disalin ke
    // ApplicationAnswer saat diverifikasi HR.
    const koAnswers: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("ko_") && typeof value === "string") koAnswers[key.slice(3)] = value;
    }
    const knockoutAnswers: { questionId: string; answer: string | null; pass: boolean }[] = [];
    let rejectNote: string | null = null;
    if (jobOpeningId && Object.keys(koAnswers).length > 0) {
      const db = getTenantClient(schemaName);
      const ev = await evaluateKnockouts(db, jobOpeningId, koAnswers);
      for (const r of ev.results) {
        knockoutAnswers.push({ questionId: r.questionId, answer: r.answer, pass: r.pass });
      }
      if (!ev.pass) {
        const failed = ev.results.filter((r) => !r.pass);
        rejectNote = `Gagal knockout: ${failed
          .map((f) => `"${f.question}" (jawaban "${f.answer}", diharapkan ${f.mode === "NotEquals" ? `bukan "${f.expectedValue}"` : `"${f.expectedValue}"`})`)
          .join("; ")}`;
      }
    }

    // ---- CV opsional (pattern applicant-documents: pre-check + service otoritatif) ----
    let cv: { buffer: Buffer; fileName: string; mimeType: string } | null = null;
    const file = form.get("cv");
    if (file instanceof File && file.size > 0) {
      const buf = Buffer.from(await file.arrayBuffer());
      let mimeType = file.type;
      if (!mimeType) {
        const ext = file.name.toLowerCase().split(".").pop() ?? "";
        mimeType =
          ext === "jpg" || ext === "jpeg" ? "image/jpeg"
          : ext === "png" ? "image/png"
          : ext === "webp" ? "image/webp"
          : ext === "pdf" ? "application/pdf"
          : "";
      }
      if (!mimeType || buf.length <= 0 || buf.length > MAX_ATTACHMENT_BYTES) {
        return bad("CV harus JPG/PNG/WEBP/PDF dan maksimum 5 MB");
      }
      cv = { buffer: buf, fileName: file.name, mimeType };
    }

    // ---- submit staging (PII terenkripsi + consent dicatat service) ----
    const db = getTenantClient(schemaName);
    const payload = {
      firstName,
      middleName: txt("middleName") || null,
      lastName: txt("lastName") || null,
      email,
      phone: txt("phone") || null,
      city: txt("city") || null,
      birthDate: txt("birthDate") || null,
      gender: txt("gender") || null,
      educationLevel: txt("educationLevel") || null,
      fieldOfStudy: txt("fieldOfStudy") || null,
      institution: txt("institution") || null,
      graduationYear: num("graduationYear"),
      gpa: num("gpa"),
      expYears: num("expYears"),
      lastPosition: txt("lastPosition") || null,
      lastCompany: txt("lastCompany") || null,
      expectedSalary: num("expectedSalary"),
      notes: txt("notes") || null,
      knockoutAnswers,
    };
    const res = await submitPublicApplication(db, tenantSlug, {
      jobOpeningId,
      payload,
      cv,
      ipHash: ipHashOf(ip),
      spam,
      knockoutRejected: rejectNote != null,
      rejectNote,
    });
    void res;

    // respons 201 SAMA untuk sukses & spam — tidak membocorkan deteksi bot
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
