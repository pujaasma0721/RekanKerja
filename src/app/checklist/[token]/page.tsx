"use client";
// OneVity — Halaman checklist publik (Task 65) ==========================
// Dibuka dari link di email checklist per bagian: /checklist/<token>
// (token HMAC khusus satu proses + satu bagian, diverifikasi server per
// request). Penerima email melihat daftar tugas bagiannya & mencentang.
// =====================================================================
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, CircleDashed, ListChecks, Mail, MinusCircle } from "lucide-react";

interface TaskRow { id: string; seq: number; title: string; status: string; notes: string | null; completedAt: string | null }
interface ChecklistData {
  kind: "onboarding" | "offboarding";
  dept: string;
  status: string;
  date: string | null;
  employee: { fullName: string; employeeNo: string };
  tasks: TaskRow[];
  canEdit: boolean;
}

const STATUS_LABEL: Record<string, string> = { Done: "Selesai", Pending: "Menunggu", Na: "Tidak berlaku" };

export default function PublicChecklistPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const tenant = ""; // slug ikut dalam token — API resolve via token

  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/checklist?token=${encodeURIComponent(token)}&t=${encodeURIComponent(tenant)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Gagal memuat");
      setData(body as ChecklistData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat");
    }
  }, [token, tenant]);

  useEffect(() => { void load(); }, [load]);

  async function setTask(taskId: string, status: string) {
    setBusyTask(taskId);
    try {
      const res = await fetch("/api/public/checklist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, tenant, taskId, status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Gagal menyimpan");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setBusyTask(null);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center">
          <Mail className="mx-auto mb-3 h-8 w-8 text-red-400" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <p className="text-sm text-slate-500">Memuat…</p>
      </main>
    );
  }

  const done = data.tasks.filter((t) => t.status === "Done").length;
  const na = data.tasks.filter((t) => t.status === "Na").length;
  const kindLabel = data.kind === "onboarding" ? "Onboarding" : "Offboarding / Clearance";

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <ListChecks className="h-4 w-4" /> Checklist {kindLabel}
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{data.employee.fullName}</h1>
          <p className="text-sm text-slate-500">
            {data.employee.employeeNo} · Bagian: <span className="font-medium text-slate-700">{data.dept}</span>
            {data.date ? ` · ${data.kind === "onboarding" ? "Mulai" : "Hari terakhir"}: ${String(data.date).slice(0, 10)}` : ""}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Progres bagian Anda: {done} selesai, {na} tidak berlaku, dari {data.tasks.length} tugas
            {data.status !== "Open" ? " · Proses sudah ditutup" : ""}
          </p>
        </header>

        <div className="space-y-2">
          {data.tasks.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
              Tidak ada tugas untuk bagian ini.
            </p>
          )}
          {data.tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {t.seq}. {t.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Status: {STATUS_LABEL[t.status] ?? t.status}
                  {t.completedAt ? ` · ${String(t.completedAt).slice(0, 10)}` : ""}
                  {t.notes ? ` · ${t.notes}` : ""}
                </p>
              </div>
              {data.canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busyTask === t.id || t.status === "Done"}
                    onClick={() => void setTask(t.id, "Done")}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 disabled:opacity-40"
                    title="Tandai selesai"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyTask === t.id || t.status === "Na"}
                    onClick={() => void setTask(t.id, "Na")}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-600 disabled:opacity-40"
                    title="Tidak berlaku"
                  >
                    <MinusCircle className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyTask === t.id || t.status === "Pending"}
                    onClick={() => void setTask(t.id, "Pending")}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700 disabled:opacity-40"
                    title="Kembalikan ke menunggu"
                  >
                    <CircleDashed className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className="shrink-0 text-xs text-slate-400">terkunci</span>
              )}
            </div>
          ))}
        </div>

        <p className="pb-6 text-center text-xs text-slate-400">
          Tautan ini khusus bagian {data.dept} — tugas bagian lain tidak terlihat dan tidak bisa diubah.
        </p>
      </div>
    </main>
  );
}
