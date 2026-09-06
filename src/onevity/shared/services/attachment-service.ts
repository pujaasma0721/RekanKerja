// OneVity — layanan lampiran generik (T16-ATTACH). =========================
// =====================================================================
// Menyimpan file lampiran (kwitansi klaim travel/medical, dokumen
// karyawan, …) ke folder uploads/{tenantSlug}/{yyyy}/{id}{ext} + baris
// metadata tabel "Attachment" (per-schema tenant).
//
// Kebijakan validasi (server-authoritative — klien hanya UX):
//   - whitelist MIME: image/jpeg, image/png, image/webp, application/pdf
//   - ukuran maksimum 5 MB
//   - nama file disanitasi (tanpa path/karakter kontrol, ≤120 karakter)
//
// Pola upload pra-submit (klaim travel/medical): UI mengunggah file dulu
// dengan entityId "draft:{uuid}" → saat klaim dibuat, route submit
// me-rebind baris ke entityId = id klaim (bindDraftAttachments). Draf yatim
// (>24 jam tak ter-rebind) disapu best-effort saat upload berikutnya.
// =====================================================================
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { TenantDb } from "../lib/tenant-db";

/** Whitelist MIME lampiran → ekstensi file penyimpanan (id = nama file aman). */
const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/** Ukuran maksimum per file (byte). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Prefiks entityId sementara pra-submit (di-rebind route submit klaim). */
export const DRAFT_ENTITY_PREFIX = "draft:";

export interface SaveAttachmentInput {
  /** Isi file (sudah dibaca dari formData). */
  file: Buffer;
  fileName: string;
  mimeType: string;
  entityType: string;
  entityId: string;
  /** AppUser id / platform user id pengunggah (jejak). */
  uploadedBy?: string | null;
}

export interface AttachmentRow {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  uploadedBy: string | null;
  createdAt: Date;
}

/** Validasi MIME/ukuran/nama — melempar Error pesan ramah (route → 400). */
function validate(file: Buffer, fileName: string, mimeType: string): string {
  if (!ALLOWED_MIME[mimeType]) {
    throw new Error(
      `Jenis file tidak didukung (${mimeType || "tidak dikenal"}) — hanya JPG/PNG/WEBP/PDF yang boleh diunggah`,
    );
  }
  if (file.length === 0) throw new Error("Berkas kosong — pilih file lain");
  if (file.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Ukuran file melebihi 5 MB (${(file.length / (1024 * 1024)).toFixed(1)} MB) — kecilkan atau kompres file`,
    );
  }
  if (!fileName.trim()) throw new Error("Nama file kosong");
  return sanitizeFileName(fileName);
}

/** Sanitasi nama file tampilan: buang path/karakter kontrol, batasi panjang. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!cleaned) return "lampiran";
  return cleaned.length > 120 ? `${cleaned.slice(0, 110)}…` : cleaned;
}

/** Simpan file + baris metadata. Return baris Attachment. */
export async function saveAttachment(
  db: TenantDb,
  tenantSlug: string,
  input: SaveAttachmentInput,
): Promise<AttachmentRow> {
  const safeName = validate(input.file, input.fileName, input.mimeType);

  const id = `att_${randomUUID()}`;
  const year = String(new Date().getFullYear());
  const ext = ALLOWED_MIME[input.mimeType]!;
  const relPath = path.posix.join("uploads", tenantSlug, year, `${id}${ext}`);
  const absPath = path.join(process.cwd(), relPath);

  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, input.file);

  return db.attachment.create({
    data: {
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName: safeName,
      mimeType: input.mimeType,
      sizeBytes: input.file.length,
      storagePath: relPath,
      uploadedBy: input.uploadedBy ?? null,
    },
  });
}

/** Ambil metadata lampiran by id. */
export async function getAttachmentById(db: TenantDb, id: string): Promise<AttachmentRow | null> {
  return db.attachment.findUnique({ where: { id } });
}

/** Path absolut file lampiran — dengan guard path-traversal (harus di uploads/). */
export function attachmentAbsolutePath(row: Pick<AttachmentRow, "storagePath">): string {
  const rel = row.storagePath;
  if (!rel.startsWith("uploads/") || rel.includes("..")) {
    throw new Error("Path lampiran tidak valid");
  }
  return path.join(process.cwd(), rel);
}

/** Baca isi file lampiran (≤5 MB → buffer aman utk response stream). */
export async function readAttachmentFile(row: Pick<AttachmentRow, "storagePath">): Promise<Buffer> {
  return readFile(attachmentAbsolutePath(row));
}

/** Metadata ringkas utk response API (tanpa storagePath). */
export function attachmentMeta(row: AttachmentRow) {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt,
  };
}

/** Hapus file fisik + baris (best-effort: file hilang tetap OK). */
export async function deleteAttachmentByRow(
  db: TenantDb,
  row: Pick<AttachmentRow, "id" | "storagePath">,
): Promise<void> {
  try {
    await unlink(attachmentAbsolutePath(row));
  } catch {
    /* file sudah tidak ada — lanjut hapus baris */
  }
  await db.attachment.delete({ where: { id: row.id } }).catch(() => undefined);
}

/** Hapus SEMUA lampiran sebuah entitas (mis. klaim dibatalkan) — best-effort. */
export async function deleteAttachmentsByEntity(
  db: TenantDb,
  entityType: string,
  entityId: string,
): Promise<number> {
  const rows = await db.attachment.findMany({
    where: { entityType, entityId },
    select: { id: true, storagePath: true },
  });
  for (const row of rows) {
    try {
      await unlink(attachmentAbsolutePath(row));
    } catch {
      /* best-effort */
    }
  }
  if (rows.length > 0) {
    await db.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  }
  return rows.length;
}

/** Daftar lampiran sebuah entitas (metadata saja, urut terbaru). */
export async function listAttachmentsByEntity(db: TenantDb, entityType: string, entityId: string) {
  const rows = await db.attachment.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(attachmentMeta);
}

/** Peta entityId → daftar metadata lampiran (utk GET daftar klaim). */
export async function attachmentsByEntityIds(
  db: TenantDb,
  entityType: string,
  entityIds: string[],
): Promise<Map<string, ReturnType<typeof attachmentMeta>[]>> {
  const map = new Map<string, ReturnType<typeof attachmentMeta>[]>();
  if (entityIds.length === 0) return map;
  const rows = await db.attachment.findMany({
    where: { entityType, entityId: { in: entityIds, not: { startsWith: DRAFT_ENTITY_PREFIX } } },
    orderBy: { createdAt: "asc" },
  });
  for (const row of rows) {
    const list = map.get(row.entityId) ?? [];
    list.push(attachmentMeta(row));
    map.set(row.entityId, list);
  }
  return map;
}

/**
 * Rebind lampiran draf pra-submit ke entitas final (klaim yang baru dibuat).
 * Hanya baris draf (entityId "draft:") yang boleh di-rebind — mencegah
 * pembajakan lampiran entitas lain. Return jumlah baris ter-rebind.
 */
export async function bindDraftAttachments(
  db: TenantDb,
  entityType: string,
  attachmentIds: string[],
  finalEntityId: string,
): Promise<number> {
  const ids = attachmentIds.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  if (ids.length === 0) return 0;
  const res = await db.attachment.updateMany({
    where: {
      id: { in: ids },
      entityType,
      entityId: { startsWith: DRAFT_ENTITY_PREFIX },
    },
    data: { entityId: finalEntityId },
  });
  return res.count;
}

/** Sapu draf yatim (>24 jam tak ter-rebind) — best-effort, never-throw. */
export async function sweepDraftAttachments(db: TenantDb): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db.attachment.findMany({
      where: { entityId: { startsWith: DRAFT_ENTITY_PREFIX }, createdAt: { lt: cutoff } },
      select: { id: true, storagePath: true },
      take: 100,
    });
    for (const row of rows) {
      try {
        await unlink(attachmentAbsolutePath(row));
      } catch {
        /* best-effort */
      }
    }
    if (rows.length > 0) {
      await db.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
  } catch {
    /* best-effort */
  }
}

/** Hapus lampiran draf by id (mis. submit klaim gagal setelah upload) — best-effort. */
export async function deleteDraftAttachmentsByIds(db: TenantDb, ids: string[]): Promise<number> {
  const clean = ids.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  if (clean.length === 0) return 0;
  try {
    const rows = await db.attachment.findMany({
      where: { id: { in: clean }, entityId: { startsWith: DRAFT_ENTITY_PREFIX } },
      select: { id: true, storagePath: true },
    });
    for (const row of rows) {
      try {
        await unlink(attachmentAbsolutePath(row));
      } catch {
        /* best-effort */
      }
    }
    if (rows.length > 0) {
      await db.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    }
    return rows.length;
  } catch {
    return 0;
  }
}

/** Hitung jumlah lampiran ter-bound sebuah entitas (utk enforcement). */
export async function countBoundAttachments(
  db: TenantDb,
  entityType: string,
  entityId: string,
): Promise<number> {
  return db.attachment.count({
    where: {
      entityType,
      AND: [{ entityId }, { entityId: { not: { startsWith: DRAFT_ENTITY_PREFIX } } }],
    },
  });
}

/**
 * Hitung draf lampiran by id yang benar-benar siap di-rebind (entityType
 * cocok + masih ber-prefix draft:) — dipakai enforcement pra-submit klaim
 * supaya daftar id palsu/lintas-klaim tidak bisa melewati validasi.
 */
export async function countDraftAttachmentsByIds(
  db: TenantDb,
  entityType: string,
  ids: string[],
): Promise<number> {
  const clean = ids.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
  if (clean.length === 0) return 0;
  return db.attachment.count({
    where: { id: { in: clean }, entityType, entityId: { startsWith: DRAFT_ENTITY_PREFIX } },
  });
}
