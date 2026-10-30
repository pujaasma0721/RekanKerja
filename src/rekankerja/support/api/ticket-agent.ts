// RekanKerja — Online Support (FEAT-SUPPORT-P1): giliran AI support agent. ====
// =====================================================================
// POST /api/rekankerja/support/tickets/[id]/agent — picu satu giliran AI:
//   · dipanggil UI setelah pesan user tersimpan (POST messages) atau saat
//     retry (provider gagal → 502; pesan user TIDAK hilang);
//   · hanya bila pesan non-SYSTEM terakhir adalah USER (mencegah balasan ganda);
//   · tiket DITUTUP → 409 (buka kembali dulu).
// Proses: analisa lampiran gambar (VLM) → aiComplete (provider tenant) →
//   parse marker triase [[META:…]] → simpan pesan AI + perbarui kategori/
//   prioritas/lastMessageAt. Bisa makan waktu (timeout provider 45s) — UI
//   menampilkan indikator "mengetik".
// =====================================================================
import { NextRequest, NextResponse } from "next/server";
import { db as platformDb } from "@/lib/db";
import { hitRateLimit } from "@/rekankerja/shared/lib/rate-limit";
import {
  resolveSupportActor, supportActorDenied, supportServiceDenied, ticketAccess,
} from "@/rekankerja/support/api/support-auth";
import { agentRespond, AgentTurnInProgressError, SUPPORT_AI_NAME, type SupportTurnUsageAcc } from "@/rekankerja/support/services/support-agent";
import { supportQuotaLeft, logSupportTurn } from "@/rekankerja/support/services/support-entitlement";
import { raisePlatformAlert } from "@/rekankerja/support/services/support-alerts";
import {
  classifySupportIntentRules, classifySupportIntentLlm, supportRedirectBody,
} from "@/rekankerja/support/services/support-intent";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const a = await resolveSupportActor(req);
    const denied = supportActorDenied(a);
    if (denied || !a) return denied ?? NextResponse.json({ error: "unknown" }, { status: 500 });
    const svc = await supportServiceDenied(a); // P5 — gate layanan berbayar
    if (svc) return svc;
    const ticket = await a.db.supportTicket.findUnique({ where: { id } });
    const access = await ticketAccess(req, a, ticket);
    if (!access.ok) return access.res;
    const t = ticket!;

    if (t.status === "DITUTUP") {
      return NextResponse.json(
        { error: "Percakapan sudah ditutup — buka kembali untuk melanjutkan" },
        { status: 409 },
      );
    }

    // AUDIT-SUPPORT — rate-limit per sesi (pola tickets.ts): 20 giliran /
    // 10 menit. Satu giliran bisa memakan hingga 14 panggilan LLM + aksi
    // browser (kuota biaya nyata) — UI memicu tepat satu giliran per pesan;
    // 20 cukup longgar utk pengguna normal, cukup ketat utk spam biaya LLM.
    const cookie = req.headers.get("cookie") ?? "anon";
    const rlKey = `support:agent-turn:${cookie.length}:${Buffer.from(cookie).toString("base64").slice(-24)}`;
    const rl = hitRateLimit(rlKey, 20, 10 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan AI dalam waktu singkat — coba lagi beberapa saat lagi" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }

    // cek pesan terakhir non-SYSTEM harus dari USER (AI belum menjawabnya).
    // P10: id+body ikut diambil — dipakai filter lapis pertama di bawah.
    const last = await a.db.supportMessage.findFirst({
      where: { ticketId: t.id, senderRole: { in: ["USER", "AI"] } },
      orderBy: { createdAt: "desc" },
      select: { senderRole: true, id: true, body: true },
    });
    if (!last || last.senderRole !== "USER") {
      return NextResponse.json(
        { error: "AI sudah menjawab pesan terakhir — kirim pesan baru terlebih dahulu" },
        { status: 409 },
      );
    }

    // P5 — KUOTA LAYANAN BERBAYAR: jumlah giliran AI per bulan kalender dibatasi
    // entitlement tenant (0 = tanpa batas). Kuota habis → 402-friendly: pesan
    // user TIDAK hilang (sudah tersimpan), giliran ditolak sampai kuota bulan
    // berikutnya / pemilik aplikasi menaikkannya.
    if (a.tenantId) {
      const left = await supportQuotaLeft(a.tenantId);
      if (left !== null && left <= 0) {
        return NextResponse.json(
          {
            error:
              "Kuota balasan AI layanan support bulan ini sudah habis untuk workspace Anda. " +
              "Pesan Anda tetap tersimpan dan akan bisa dibalas setelah kuota bulan berikutnya diaktifkan (atau ditingkatkan pemilik aplikasi).",
            code: "SUPPORT_QUOTA_EXHAUSTED",
          },
          { status: 403 },
        );
      }
    }

    // -----------------------------------------------------------------------
    // FEAT-SUPPORT-P10 — FILTER LAPIS PERTAMA (intent gate, SEBELUM agent):
    // layanan support = kanal laporan MASALAH/BUG aplikasi. Pertanyaan umum
    // (data aplikasi: jumlah karyawan/gaji/kantor, cara pakai fitur, sapaan)
    // sudah ditangani widget Asisten AI — di sini DIBLOKIR supaya token &
    // provider (biaya pemilik aplikasi) tidak terbakar untuk giliran agent
    // penuh (system prompt besar + hingga 14 langkah LLM + loop tool + VLM).
    //   · aturan (biaya nol): sinyal masalah jelas → lolos; sapaan murni /
    //     pertanyaan data khas → blokir;
    //   · ambigu → SATU panggilan klasifikasi LLM kecil (±ratusan token,
    //     maxTokens 8) — jauh lebih murah daripada salah melayani giliran
    //     penuh. Gagal klasifikasi → fail-open MASALAH (laporan masalah nyata
    //     tidak boleh tertahan).
    // Pesan dengan LAMPIRAN selalu lolos (bukti layar umumnya error) — VLM
    // tetap menganalisa. Log HANYA metadata — isi pesan tidak pernah ditulis
    // ke log server bersama (H1 audit-2).
    // -----------------------------------------------------------------------
    const gateBody = last.body?.trim() ?? "";
    let gateSteps = 0;
    let gateTokensIn = 0;
    let gateTokensOut = 0;
    let gateProvider = "builtin";
    if (gateBody) {
      const hasAttachment =
        (await a.db.attachment.count({
          where: { entityType: "SupportMessage", entityId: last.id },
        })) > 0;
      if (!hasAttachment) {
        const rules = classifySupportIntentRules(gateBody);
        let blockedKind: "greeting" | "umum" | null =
          rules === "UMUM_GREETING" ? "greeting" : rules === "UMUM" ? "umum" : null;
        if (!blockedKind && rules === null) {
          try {
            const c = await classifySupportIntentLlm(t.subject, gateBody);
            gateTokensIn = c.usage.tokensIn;
            gateTokensOut = c.usage.tokensOut;
            gateSteps = c.usage.llmSteps;
            gateProvider = c.usage.provider;
            if (c.verdict === "UMUM") blockedKind = "umum";
          } catch (e) {
            // fail-open: klasifikasi gagal (provider dsb.) → layani sbg. MASALAH
            console.warn("[support-intent] klasifikasi LLM gagal (fail-open → MASALAH):", e instanceof Error ? e.message : e);
          }
        }
        if (blockedKind) {
          // Balasan redirect TETAP tanpa giliran agent — jelaskan fungsi layanan
          // support + arahkan ke Asisten AI (bubble chat pojok kanan bawah).
          const message = await a.db.supportMessage.create({
            data: {
              ticketId: t.id,
              senderRole: "AI",
              senderName: SUPPORT_AI_NAME,
              body: supportRedirectBody(blockedKind, a.appUserName),
            },
          });
          await a.db.supportTicket.update({
            where: { id: t.id },
            data: { lastMessageAt: new Date() },
          });
          // Atribusi biaya nyata (token klasifikasi, bila dipakai) — tetap
          // dicatat, TIDAK memakan kuota tenant (billable=false): giliran
          // diblokir bukan kesalahan pengguna, dan pemilik aplikasi tetap
          // melihat jejak filter bekerja di log pemakaian.
          if (a.tenantId && (gateSteps > 0 || gateTokensIn > 0 || gateTokensOut > 0)) {
            await logSupportTurn(a.tenantId, t.ticketNo, {
              llmSteps: gateSteps, tokensIn: gateTokensIn, tokensOut: gateTokensOut,
              provider: gateProvider, billable: false,
            });
          }
          console.log(`[support-intent] tiket ${t.ticketNo}: pesan UMUM diblokir lapis-1 (${blockedKind}${gateSteps > 0 ? ", via LLM" : ", via aturan"}) — dialihkan ke Asisten AI tanpa giliran agent`);
          return NextResponse.json({ message, category: null, priority: null }, { status: 201 });
        }
        // lolos filter (MASALAH): token klasifikasi tetap diatribusikan ke
        // giliran agent berikut (dijumlahkan via usageAcc di bawah).
        if (gateSteps > 0) {
          console.log(`[support-intent] tiket ${t.ticketNo}: lolos lapis-1 (klasifikasi LLM: MASALAH) — giliran agent berjalan`);
        }
      }
    }

    // R4 (audit-2) — akumulator pemakaian giliran: dimutasi agentRespond per
    // langkah LLM, sehingga giliran yang GAGAL di tengah jalan (→ 502) tetap
    // mencatat token yang sudah terpakai ke SupportUsageLog (billable=false —
    // biaya teratribusi, TANPA memakan kuota tenant: bukan salah pengguna).
    // Sebelumnya giliran gagal tidak tercatat sama sekali → tagihan kurang
    // hitung padahal token LLM (hingga 14 langkah) sudah terbakar.
    // P10: nilai awal = token klasifikasi lapis-1 (bila dipakai) — runAgentTurn
    // menyinkronkan akumulator sbg. BENIH + total giliran, bukan menimpa.
    const usageAcc: SupportTurnUsageAcc = {
      llmSteps: gateSteps, tokensIn: gateTokensIn, tokensOut: gateTokensOut, provider: gateProvider,
    };
    let result: Awaited<ReturnType<typeof agentRespond>>;
    try {
      result = await agentRespond(a.db, t, usageAcc);
    } catch (e) {
      if (a.tenantId && usageAcc.llmSteps > 0) {
        await logSupportTurn(a.tenantId, t.ticketNo, { ...usageAcc, billable: false });
      }
      throw e;
    }

    // P5 — atribusi pemakaian per giliran ke tenant (dasar kuota bulanan &
    // penagihan layanan berbayar). Pesan AI sudah tersimpan — kegagalan log
    // tidak boleh mengubah respons sukses (logSupportTurn best-effort).
    // P10: usageAcc (bukan result.usage) dipakai — sudah memuat BENIH token
    // klasifikasi lapis-1 + total giliran agent (biaya nyata utuh).
    if (a.tenantId) {
      await logSupportTurn(a.tenantId, t.ticketNo, { ...usageAcc, billable: true });
    }

    // P7.1 — ESKALASI KE PEMILIK APLIKASI (best-effort, tidak pernah gagalkan
    // giliran): (a) bug terkonfirmasi agent dengan prioritas TINGGI/KRITIS;
    // (b) agent mengajukan usulan patch MENUNGGU keputusan. Sebelumnya dua
    // kondisi ini hanya "duduk" di tiket tenant tanpa ada yang memberi tahu
    // pemilik aplikasi.
    if (a.tenantId) {
      try {
        const highBug =
          result.category === "BUG" && (result.priority === "TINGGI" || result.priority === "KRITIS");
        const proposedPatch = result.toolsUsed.includes("propose_patch");
        if (highBug || proposedPatch) {
          const ten = await platformDb.tenant.findUnique({
            where: { id: a.tenantId },
            select: { id: true, name: true },
          });
          if (ten) {
            if (highBug) {
              await raisePlatformAlert({
                type: "BUG_CONFIRMED",
                tenantId: ten.id,
                tenantName: ten.name,
                ticketNo: t.ticketNo,
                ticketId: t.id,
                subject: t.subject,
                priority: result.priority ?? "",
                message: `Agent mengonfirmasi bug prioritas ${result.priority} pada tiket "${t.subject}" — menunggu penanganan tim platform.`,
              });
            }
            if (proposedPatch) {
              const waiting = await a.db.supportPatchProposal.findFirst({
                where: { ticketId: t.id, status: "MENUNGGU" },
                orderBy: { createdAt: "desc" },
                select: { filePath: true, description: true },
              });
              if (waiting) {
                await raisePlatformAlert({
                  type: "PATCH_PROPOSED",
                  tenantId: ten.id,
                  tenantName: ten.name,
                  ticketNo: t.ticketNo,
                  ticketId: t.id,
                  subject: t.subject,
                  priority: result.priority ?? "",
                  message: `Agent mengajukan usulan patch "${waiting.filePath}": ${waiting.description.slice(0, 300)} — menunggu keputusan (setujui/tolak).`,
                });
              }
            }
          }
        }
      } catch (e) {
        console.warn("[support-agent] eskalasi alert ke konsol platform gagal (diabaikan):", e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json(
      { message: result.message, category: result.category, priority: result.priority },
      { status: 201 },
    );
  } catch (e) {
    // AUDIT-SUPPORT: giliran tiket ini masih berjalan (POST paralel) → 409,
    // bukan kegagalan provider — UI menampilkan pesan ramah tanpa retry ganda.
    if (e instanceof AgentTurnInProgressError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    // provider AI gagal (key salah, timeout, kuota) → 502 ramah — pesan user
    // sudah tersimpan; UI menawarkan tombol coba lagi (POST ulang endpoint ini).
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
