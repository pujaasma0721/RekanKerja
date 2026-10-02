// POST /api/rekankerja/travel/ocr — pindai kwitansi (F2-3, Task 98).
// =====================================================================
// Unggah foto struk (multipart: file + employeeId utk cek duplikasi) →
// VLM z-ai-web-dev-sdk (SERVER-SIDE ONLY) mengekstraksi merchant/tanggal/
// nominal → pre-fill baris klaim + deteksi duplikasi (nominal+tanggal sama
// pada klaim karyawan ≤90 hari — mirror deteksi anomali F2-4).
//
// Guard: admin aksi create travel:travel-claim ATAU sesi ESS (karyawan
// memindai kwitansi sendiri) — pola attachments.ts Task 98 (F1-5).
import { NextRequest, NextResponse } from "next/server";
import { requireMenuAction } from "@/rekankerja/shared/services/menu-access";
import { requireEss } from "@/rekankerja/ess/api/ess-auth";
import type { TenantDb } from "@/rekankerja/shared/lib/tenant-db";
import { tenantCryptoForDb } from "@/rekankerja/shared/lib/field-crypto";

interface OcrActor {
  db: TenantDb;
  employeeId: string | null;
}

async function resolveActor(req: NextRequest): Promise<{ ok: true; actor: OcrActor } | { ok: false; status: number; error: string }> {
  const m = await requireMenuAction(req, "travel:travel-claim", "create");
  if (m.ok) return { ok: true, actor: { db: m.db, employeeId: m.actor.employeeId ?? null } };
  const ess = await requireEss(req);
  if (ess.ok) return { ok: true, actor: { db: ess.actor.db, employeeId: ess.actor.employeeId } };
  return { ok: false, status: ess.status, error: ess.error };
}

const OCR_PROMPT = [
  "Kamu adalah pembaca kwitansi/struk belanja untuk aplikasi HRIS Indonesia.",
  "Analisis gambar kwitansi ini, lalu balas HANYA satu objek JSON valid (tanpa markdown, tanpa penjelasan) dengan field:",
  '- "merchant": nama toko/hotel/restoran/pemasok (string, ringkas ≤60 karakter; "tidak terbaca" bila tidak ada)',
  '- "date": tanggal transaksi format YYYY-MM-DD (tebak tahun berjalan bila tahun tidak tercetak)',
  '- "amount": nilai TOTAL yang dibayar dalam RUPIAH sebagai integer tanpa titik/koma (contoh: 257500)',
  '- "currency": "IDR" umumnya',
  '- "note": ringkasan isi/item utama ≤80 karakter',
  "Bila gamar bukan kwitansi, balas {\"error\":\"bukan kwitansi\"}.",
].join("\n");

function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const a = await resolveActor(req);
    if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
    const { db, employeeId } = a.actor;

    const form = await req.formData();
    const file = form.get("file");
    const targetEmployeeId = String(form.get("employeeId") ?? "") || employeeId;
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Field file wajib berupa berkas gambar kwitansi" }, { status: 400 });
    }
    const mime = file.type || "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      return NextResponse.json({ error: "Format harus JPG/PNG/WEBP (foto struk)" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "Ukuran gambar maks 5 MB" }, { status: 400 });
    }

    // VLM — z-ai-web-dev-sdk server-side (skill VLM: base64 data URL).
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    let parsed: Record<string, unknown> | null = null;
    let providerError: string | null = null;
    try {
      const { default: ZAI } = await import("z-ai-web-dev-sdk");
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_PROMPT },
              { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) throw new Error("VLM mengembalikan jawaban kosong");
      parsed = parseJsonLoose(text);
      if (!parsed) throw new Error("Jawaban VLM bukan JSON yang bisa dibaca");
    } catch (e) {
      providerError = e instanceof Error ? e.message : "VLM gagal";
    }
    if (!parsed) {
      return NextResponse.json(
        { error: providerError ?? "Kwitansi tidak berhasil dibaca — isi baris secara manual" },
        { status: 502 },
      );
    }
    if (parsed.error) {
      return NextResponse.json({ error: String(parsed.error) }, { status: 422 });
    }

    const amount = Math.max(0, Math.round(Number(parsed.amount ?? 0)));
    const date = typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;

    // F2-3 — deteksi duplikasi: nominal+tanggal sama pada klaim karyawan ≤90 hari
    // (kwitansi dipindai ulang / dipakai di klaim lain).
    let duplicateOf: string | null = null;
    if (amount > 0 && date && targetEmployeeId) {
      const tc = tenantCryptoForDb(db);
      const since = new Date(Date.now() - 90 * 86_400_000);
      const rows = await db.travelClaim.findMany({
        where: { employeeId: targetEmployeeId, claimDate: { gte: since } },
        select: { docNo: true, expenses: { select: { amount: true, expenseDate: true } } },
      });
      for (const r of rows) {
        const hit = r.expenses.some((e) =>
          e.expenseDate &&
          new Date(e.expenseDate).toISOString().slice(0, 10) === date &&
          (tc.decryptMoney(e.amount) ?? 0) === amount,
        );
        if (hit) {
          duplicateOf = r.docNo;
          break;
        }
      }
    }

    return NextResponse.json({
      merchant: typeof parsed.merchant === "string" ? parsed.merchant.slice(0, 120) : null,
      date,
      amount,
      currency: typeof parsed.currency === "string" ? parsed.currency : "IDR",
      note: typeof parsed.note === "string" ? parsed.note.slice(0, 120) : null,
      duplicateOf,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
