"use client";
// P3.5-BM (D-BM27) — Jalur Karier (admin): register CareerPath — peta jalur
// posisi → posisi berikutnya + syarat keahlian (level minimum) + catatan.
// Daftar dikelompokkan per posisi asal (kartu posisi → panah → kartu posisi
// tujuan); dialog buat/ubah memakai editor syarat multi-baris (keahlian
// aktif + level 1–5, maks 15 baris, unik per keahlian). Guard pasangan
// duplikat 409 + JALUR BALIK LANGSUNG 400 (server) — D-BM27. Jalur karier
// = teks + referensi katalog — BUKAN modul training (D-BM28 exclude).
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Route, Plus, Pencil, Trash2, ArrowRight, Loader2, Wrench, MapPin, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// ============ kontrak API ============

interface PathPosition {
  id: string;
  code: string;
  title: string;
  active: boolean;
  unitName: string | null;
}
interface CareerPathRow {
  id: string;
  fromPosition: PathPosition;
  toPosition: PathPosition;
  requirements: { skillId: string; name: string; level: number }[];
  note: string | null;
}
interface PathsData {
  paths: CareerPathRow[];
  stats: { paths: number; sources: number; targets: number };
}
interface PickerPosition { id: string; code: string; title: string; unitName: string | null }
interface PickerSkill { id: string; name: string; category: string | null }
interface OptionsData { positions: PickerPosition[]; skills: PickerSkill[] }

const MAX_ROWS = 15;
const MAX_NOTE = 500;

/** Satu baris editor syarat (draft lokal — belum tersimpan). */
interface ReqDraft {
  key: number;
  skillId: string;
  level: number;
}
let reqKeySeq = 1;

export function CareerPathsView() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const canCreate = perms.can("hr", "career-paths", "create");
  const canUpdate = perms.can("hr", "career-paths", "update");
  const canDelete = perms.can("hr", "career-paths", "delete");

  const { data, loading, error, refresh } = useApi<PathsData>("/api/rekankerja/career-paths");
  const paths = data?.paths ?? [];

  // kelompokkan per posisi asal (urut judul)
  const groups = useMemo(() => {
    const byFrom = new Map<string, { position: PathPosition; rows: CareerPathRow[] }>();
    for (const p of paths) {
      const g = byFrom.get(p.fromPosition.id) ?? { position: p.fromPosition, rows: [] };
      g.rows.push(p);
      byFrom.set(p.fromPosition.id, g);
    }
    return [...byFrom.values()].sort((a, b) => a.position.title.localeCompare(b.position.title));
  }, [paths]);

  // ---- dialog buat/ubah ----
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CareerPathRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ fromPositionId: string; toPositionId: string; note: string }>({
    fromPositionId: "", toPositionId: "", note: "",
  });
  const [reqRows, setReqRows] = useState<ReqDraft[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<CareerPathRow | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const { data: options } = useApi<OptionsData>(dialogOpen ? "/api/rekankerja/career-paths?options=1" : null, [dialogOpen]);
  const optPositions = options?.positions ?? [];
  const optSkills = options?.skills ?? [];

  // saat dialog ditutup → bersihkan draft (hindari state basi lintas buka)
  useEffect(() => {
    if (!dialogOpen) {
      setEditing(null);
      setReqRows([]);
    }
  }, [dialogOpen]);

  const openCreate = () => {
    setEditing(null);
    setForm({ fromPositionId: "", toPositionId: "", note: "" });
    setReqRows([{ key: reqKeySeq++, skillId: "", level: 3 }]);
    setDialogOpen(true);
  };

  const openEdit = (p: CareerPathRow) => {
    setEditing(p);
    setForm({ fromPositionId: p.fromPosition.id, toPositionId: p.toPosition.id, note: p.note ?? "" });
    setReqRows(
      p.requirements.length
        ? p.requirements.map((r) => ({ key: reqKeySeq++, skillId: r.skillId, level: r.level }))
        : [{ key: reqKeySeq++, skillId: "", level: 3 }],
    );
    setDialogOpen(true);
  };

  const addReqRow = () => {
    if (reqRows.length >= MAX_ROWS) {
      toast.error(t("Maksimal {n} syarat keahlian per jalur", "At most {n} skill requirements per path", { n: String(MAX_ROWS) }));
      return;
    }
    setReqRows((rows) => [...rows, { key: reqKeySeq++, skillId: "", level: 3 }]);
  };
  const removeReqRow = (key: number) => {
    setReqRows((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  };
  const setReq = (key: number, patch: Partial<Pick<ReqDraft, "skillId" | "level">>) => {
    setReqRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const submit = async () => {
    if (!form.fromPositionId || !form.toPositionId) {
      toast.error(t("Pilih posisi asal & posisi tujuan", "Pick the source & target positions"));
      return;
    }
    if (form.fromPositionId === form.toPositionId) {
      toast.error(t("Posisi tujuan harus berbeda dari posisi asal", "The target position must differ from the source"));
      return;
    }
    const filled = reqRows.filter((r) => r.skillId);
    const seen = new Set<string>();
    for (const r of filled) {
      if (seen.has(r.skillId)) {
        toast.error(t("Satu keahlian hanya boleh muncul sekali dalam syarat jalur", "A skill may appear only once in the path requirements"));
        return;
      }
      seen.add(r.skillId);
    }
    if (form.note.length > MAX_NOTE) {
      toast.error(t("Catatan maksimal {n} karakter", "The note is limited to {n} characters", { n: String(MAX_NOTE) }));
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...(editing ? { id: editing.id } : {}),
        fromPositionId: form.fromPositionId,
        toPositionId: form.toPositionId,
        requirements: filled.map((r) => ({ skillId: r.skillId, level: r.level })),
        note: form.note.trim() || null,
      };
      await apiSend("/api/rekankerja/career-paths", editing ? "PATCH" : "POST", body);
      toast.success(editing
        ? t("Jalur karier diperbarui", "Career path updated")
        : t("Jalur karier terdaftar", "Career path registered"));
      setDialogOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusy(false); }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setBusyDelete(true);
    try {
      await apiSend(`/api/rekankerja/career-paths?id=${confirmDelete.id}`, "DELETE");
      toast.success(t("Jalur karier dihapus", "Career path deleted"));
      setConfirmDelete(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Gagal", "Failed"));
    } finally { setBusyDelete(false); }
  };

  const fromTitle = (id: string) => optPositions.find((p) => p.id === id)?.title ?? "";

  // ============ render ============
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t("Posisi & Jabatan", "Positions & Jobs")}
        title={t("Jalur Karier", "Career Paths")}
        description={t(
          "Peta jalur posisi → posisi berikutnya beserta syarat keahlian minimumnya — menjadi dasar \"Jalur Karier Saya\" di portal karyawan",
          "Map of position-to-next-position paths with minimum skill requirements — the basis of \"My Career Path\" in the employee portal",
        )}
        actions={canCreate && (
          <Button onClick={openCreate} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Jalur Baru", "New Path")}
          </Button>
        )}
      />

      {/* mini stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={Route} label={t("Jalur Terdaftar", "Registered Paths")} value={data?.stats.paths ?? 0} />
        <StatCard icon={MapPin} label={t("Posisi Asal", "Source Positions")} value={data?.stats.sources ?? 0} />
        <StatCard icon={Sparkles} label={t("Posisi Tujuan", "Target Positions")} value={data?.stats.targets ?? 0} />
      </div>

      {loading && !data ? (
        <Card className="min-w-0"><CardContent className="p-4"><LoadingRows rows={4} /></CardContent></Card>
      ) : error ? (
        <EmptyState icon={Route} title={t("Gagal memuat jalur karier", "Failed to load career paths")} description={error} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Route}
          title={t("Belum ada jalur karier terdaftar", "No career paths registered yet")}
          description={t(
            "Daftarkan jalur pertama — mis. dari Staff ke Supervisor — lalu isi syarat keahlian minimumnya. Jalur ini tampil di portal karyawan sebagai \"Jalur Karier Saya\".",
            "Register the first path — e.g. from Staff to Supervisor — then set its minimum skill requirements. These paths appear in the employee portal as \"My Career Path\".",
          )}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.position.id} className="min-w-0">
              <CardContent className="p-4">
                {/* posisi asal → panah */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 rounded-xl border border-brand/30 bg-brand/10 px-2.5 py-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                    <span className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{g.position.title}</span>
                    <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-px font-mono text-[9px] font-bold text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                      {g.position.code}
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="text-[11px] font-bold text-slate-400">
                    {t("{n} jalur", "{n} paths", { n: String(g.rows.length) })}
                  </span>
                  {!g.position.active && (
                    <Badge variant="outline" className="text-[9px] text-slate-400">
                      {t("posisi non-aktif", "inactive position")}
                    </Badge>
                  )}
                </div>

                {/* kartu posisi tujuan */}
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  {g.rows.map((p) => (
                    <div key={p.id} className="min-w-0 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{p.toPosition.title}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                            {p.toPosition.code}
                            {p.toPosition.unitName ? ` · ${p.toPosition.unitName}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {canUpdate && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(p)} title={t("Ubah jalur", "Edit path")}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">{t("Ubah jalur", "Edit path")}</span>
                            </Button>
                          )}
                          {canDelete && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 dark:text-rose-400" onClick={() => setConfirmDelete(p)} title={t("Hapus jalur", "Delete path")}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              <span className="sr-only">{t("Hapus jalur", "Delete path")}</span>
                            </Button>
                          )}
                        </div>
                      </div>
                      {p.requirements.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {p.requirements.map((r) => (
                            <span key={r.skillId} className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400">
                              <Wrench className="h-3 w-3" aria-hidden />
                              {r.name}
                              <span className="tabular-nums opacity-80">{t("Lv ≥ {n}", "Lv ≥ {n}", { n: String(r.level) })}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-[11px] italic text-slate-400">{t("tanpa syarat keahlian", "no skill requirements")}</p>
                      )}
                      {p.note && (
                        <p className="mt-2 line-clamp-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-2 py-1 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400" title={p.note}>
                          {p.note}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ================= dialog buat/ubah jalur ================= */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setDialogOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("Ubah Jalur Karier — {f} → {to}", "Edit Career Path — {f} → {to}", { f: fromTitle(form.fromPositionId) || editing.fromPosition.title, to: fromTitle(form.toPositionId) || editing.toPosition.title })
                : t("Jalur Karier Baru", "New Career Path")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Posisi asal", "Source position")}</Label>
                <Select value={form.fromPositionId} onValueChange={(v) => setForm((f) => ({ ...f, fromPositionId: v }))}>
                  <SelectTrigger aria-label={t("Pilih posisi asal", "Pick the source position")}>
                    <SelectValue placeholder={t("Pilih posisi…", "Pick a position…")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {optPositions.length === 0 ? (
                      <div className="p-2 text-xs text-slate-400">{t("Memuat posisi…", "Loading positions…")}</div>
                    ) : optPositions.map((x) => (
                      <SelectItem key={x.id} value={x.id}>
                        {x.title}{x.unitName ? ` · ${x.unitName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Posisi tujuan", "Target position")}</Label>
                <Select value={form.toPositionId} onValueChange={(v) => setForm((f) => ({ ...f, toPositionId: v }))}>
                  <SelectTrigger aria-label={t("Pilih posisi tujuan", "Pick the target position")}>
                    <SelectValue placeholder={t("Pilih posisi…", "Pick a position…")} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {optPositions
                      .filter((x) => x.id !== form.fromPositionId)
                      .map((x) => (
                        <SelectItem key={x.id} value={x.id}>
                          {x.title}{x.unitName ? ` · ${x.unitName}` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-slate-400">
                  {t("Tujuan tidak boleh sama dengan asal; jalur balik langsung (A↔B) ditolak.", "The target must differ from the source; a direct reverse path (A↔B) is rejected.")}
                </p>
              </div>
            </div>

            {/* editor syarat keahlian multi-baris */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5">
                  <Wrench className="h-3.5 w-3.5 text-brand" aria-hidden />
                  {t("Syarat keahlian minimum", "Minimum skill requirements")}
                </Label>
                <span className="text-[10px] font-bold tabular-nums text-slate-400">{reqRows.length}/{MAX_ROWS}</span>
              </div>
              <div className="space-y-2">
                {reqRows.map((r, idx) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-800">
                    <span className="w-5 shrink-0 text-center text-[10px] font-black tabular-nums text-slate-400">{idx + 1}</span>
                    <div className="min-w-40 flex-1">
                      <Select value={r.skillId || undefined} onValueChange={(v) => setReq(r.key, { skillId: v })}>
                        <SelectTrigger aria-label={t("Pilih keahlian", "Pick a skill")}>
                          <SelectValue placeholder={t("Pilih keahlian…", "Pick a skill…")} />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {optSkills.length === 0 ? (
                            <div className="p-2 text-xs text-slate-400">{t("Memuat keahlian…", "Loading skills…")}</div>
                          ) : optSkills.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}{s.category ? ` · ${s.category}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-28 shrink-0">
                      <Select value={String(r.level)} onValueChange={(v) => setReq(r.key, { level: Number(v) })}>
                        <SelectTrigger aria-label={t("Level minimum", "Minimum level")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5].map((lv) => (
                            <SelectItem key={lv} value={String(lv)}>{t("Lv ≥ {n}", "Lv ≥ {n}", { n: String(lv) })}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      size="sm" variant="ghost" className="h-8 w-8 shrink-0 p-0 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                      onClick={() => removeReqRow(r.key)} disabled={reqRows.length <= 1}
                      title={t("Hapus baris syarat", "Remove requirement row")}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      <span className="sr-only">{t("Hapus baris syarat", "Remove requirement row")}</span>
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-xl" onClick={addReqRow} disabled={reqRows.length >= MAX_ROWS}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t("Tambah Syarat", "Add Requirement")}
              </Button>
              <p className="text-[10px] text-slate-400">
                {t(
                  "Baris tanpa keahlian terpilih diabaikan saat simpan. Satu keahlian hanya boleh sekali.",
                  "Rows without a selected skill are ignored on save. A skill may appear only once.",
                )}
              </p>
            </div>

            <div className="space-y-1">
              <Label>{t("Catatan (opsional)", "Note (optional)")}</Label>
              <Textarea
                rows={2}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("Contoh: jalur promosi reguler; wajib rotasi 6 bulan di unit produksi", "e.g. regular promotion track; requires a 6-month rotation in the production unit")}
              />
              <p className="text-right text-[10px] tabular-nums text-slate-400">{form.note.length}/{MAX_NOTE}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("Batal", "Cancel")}</Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {editing ? t("Simpan Perubahan", "Save Changes") : t("Daftarkan", "Register")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= dialog hapus ================= */}
      <Dialog open={confirmDelete != null} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Hapus Jalur Karier?", "Delete Career Path?")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {confirmDelete && t(
              "Jalur \"{f}\" → \"{to}\" akan dihapus. Tindakan tercatat di log aktivitas.",
              "The path \"{f}\" → \"{to}\" will be deleted. This action is recorded in the activity log.",
              { f: confirmDelete.fromPosition.title, to: confirmDelete.toPosition.title },
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>{t("Batal", "Cancel")}</Button>
            <Button variant="destructive" onClick={doDelete} disabled={busyDelete}>
              {busyDelete && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {t("Hapus", "Delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ elemen kecil ============

function StatCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-black leading-none tabular-nums text-slate-800 dark:text-slate-100">{value}</p>
        <p className="mt-1 truncate text-[11px] font-bold text-slate-400">{label}</p>
      </div>
    </div>
  );
}
