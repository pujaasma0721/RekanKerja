// RekanKerja — Online Support P7.1: eskalasi notifikasi ke PEMILIK APLIKASI.
// =====================================================================
// Gap yang ditutup: sebelumnya, bug yang dikonfirmasi agent (triase BUG
// prioritas TINGGI/KRITIS) dan usulan patch MENUNGGU hanya "duduk" di tiket
// tenant — pemilik aplikasi tidak tahu sampai membuka konsol platform.
// Service ini menulis PlatformAlert (schema public) sebagai feed di konsol
// (badge + tab "Bug & Patch").
//
// PRINSIP: BEST-EFFORT dan TIDAK PERNAH melempar — dipanggil dari jalur
// giliran agent; kegagalan menulis alert tidak boleh menggagalkan balasan
// AI ke pengguna (prioritas pengguna > notifikasi internal).
//
// Dedup: alert BELUM-DIBACA dengan (type, ticketRef) sama diperbarui
// (bukan baris baru) — agent bisa mengonfirmasi bug yang sama di beberapa
// giliran; feed tetap satu entri per tiket sampai dibaca.
import { db as platformDb } from "@/lib/db";

export type PlatformAlertType = "BUG_CONFIRMED" | "PATCH_PROPOSED";

export interface PlatformAlertInput {
  type: PlatformAlertType;
  tenantId: string;
  tenantName: string;
  ticketNo: string;
  ticketId: string;
  subject: string;
  priority?: string;
  message: string;
}

/** Tulis/perbarui alert konsol platform (best-effort, tidak pernah throw). */
export async function raisePlatformAlert(input: PlatformAlertInput): Promise<void> {
  try {
    const ticketRef = `${input.tenantId}:${input.ticketId}`;
    const existing = await platformDb.platformAlert.findFirst({
      where: { type: input.type, ticketRef, readAt: null },
      select: { id: true },
    });
    if (existing) {
      // sudah ada alert belum-dibaca utk tiket ini → perbarui isi & waktunya
      await platformDb.platformAlert.update({
        where: { id: existing.id },
        data: {
          tenantName: input.tenantName,
          ticketNo: input.ticketNo,
          subject: input.subject.slice(0, 200),
          priority: input.priority ?? "",
          message: input.message.slice(0, 500),
          createdAt: new Date(),
        },
      });
      return;
    }
    await platformDb.platformAlert.create({
      data: {
        type: input.type,
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        ticketNo: input.ticketNo,
        ticketRef,
        subject: input.subject.slice(0, 200),
        priority: input.priority ?? "",
        message: input.message.slice(0, 500),
      },
    });
  } catch (e) {
    console.warn(
      "[support-alert] gagal menulis PlatformAlert (diabaikan — best-effort):",
      e instanceof Error ? e.message : e,
    );
  }
}
