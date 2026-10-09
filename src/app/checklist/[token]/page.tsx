"use client";
// RekanKerja — Halaman checklist publik (Task 65) ==========================
// Dibuka dari link di email checklist per bagian: /checklist/<token>
// (token HMAC khusus satu proses + satu bagian, diverifikasi server per
// request). Penerima email melihat daftar tugas bagiannya & mencentang.
//
// Bilingual (Task 103-d): halaman ini di LUAR shell app (tanpa login) sehingga
// tidak ada I18nProvider di atasnya → default export membungkus sendiri dengan
// <I18nProvider>. Provider membaca localStorage pasca-mount — kedipan singkat
// ID→EN bagi user EN bisa diterima (konsisten perilaku shell).
// =====================================================================
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, CircleDashed, ListChecks, Mail, MinusCircle } from "lucide-react";
import { I18nProvider, useI18n } from "@/rekankerja/shared/lib/i18n";
import { trServer } from "@/rekankerja/shared/lib/i18n-core";

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

// Task 102: pesan error API publik selalu ID dari server — petakan best-effort saat EN.
const API_ERR_EN: Record<string, string> = {
  "Tautan tidak valid": "Invalid link",
  "Tenant tidak dikenal": "Unknown workspace",
  "Proses tidak ditemukan": "Process not found",
  "Status tidak valid (Done/Pending/Na)": "Invalid status (Done/Pending/Na)",
  "Proses sudah selesai/dibatalkan — tidak bisa diubah": "The process is already completed/cancelled — it can no longer be changed",
  "Tugas tidak termasuk bagian Anda": "This task does not belong to your section",
};

export default function PublicChecklistPage() {
  return (
    <I18nProvider>
      <ChecklistInner />
    </I18nProvider>
  );
}

function ChecklistInner() {
  const { t, locale, lang } = useI18n();
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const tenant = ""; // slug ikut dalam token — API resolve via token

  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  // Task 102: pesan error API publik selalu ID dari server — petakan best-effort saat EN.
  const apiErrMsg = useCallback(
    (raw: string) => (lang === "en" ? (API_ERR_EN[raw] ?? raw) : raw),
    [lang],
  );

  // Tanggal dari API berupa ISO — ambil bagian tanggalnya lalu format sesuai
  // locale. Konstruksi dari komponen y/m/d (bukan new Date(iso)) supaya tidak
  // bergeser -1 hari akibat timezone.
  const fmtDay = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-");
    return y && m && d
      ? new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })
      : iso.slice(0, 10);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/checklist?token=${encodeURIComponent(token)}&t=${encodeURIComponent(tenant)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(trServer(body.error) || t("Gagal memuat", "Failed to load"));
      setData(body as ChecklistData);
    } catch (e) {
      const raw = e instanceof Error ? e.message : t("Gagal memuat", "Failed to load");
      setError(apiErrMsg(raw));
    }
  }, [token, tenant, t, apiErrMsg]);

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
      if (!res.ok) throw new Error(trServer(body.error) || t("Gagal menyimpan", "Failed to save"));
      await load();
    } catch (e) {
      const raw = e instanceof Error ? e.message : t("Gagal menyimpan", "Failed to save");
      setError(apiErrMsg(raw));
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
        <p className="text-sm text-slate-500">{t("Memuat…", "Loading…")}</p>
      </main>
    );
  }

  const done = data.tasks.filter((task) => task.status === "Done").length;
  const na = data.tasks.filter((task) => task.status === "Na").length;
  const kindLabel = data.kind === "onboarding" ? "Onboarding" : "Offboarding / Clearance";
  const statusLabel = (s: string) =>
    s === "Done" ? t("Selesai", "Done")
    : s === "Pending" ? t("Menunggu", "Pending")
    : s === "Na" ? t("Tidak berlaku", "Not applicable")
    : s;

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            <ListChecks className="h-4 w-4" /> {t(`Checklist ${kindLabel}`)}
          </div>
          <h1 className="text-lg font-semibold text-slate-900">{data.employee.fullName}</h1>
          <p className="text-sm text-slate-500">
            {data.employee.employeeNo} · {t("Bagian:", "Department:")} <span className="font-medium text-slate-700">{data.dept}</span>
            {data.date ? ` · ${data.kind === "onboarding" ? t("Mulai", "Start") : t("Hari terakhir", "Last day")}: ${fmtDay(data.date)}` : ""}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            {t(
              "Progres bagian Anda: {done} selesai, {na} tidak berlaku, dari {total} tugas",
              "Your section progress: {done} done, {na} n/a, of {total} tasks",
              { done, na, total: data.tasks.length },
            )}
            {data.status !== "Open" ? ` · ${t("Proses sudah ditutup", "Process is closed")}` : ""}
          </p>
        </header>

        <div className="space-y-2">
          {data.tasks.length === 0 && (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
              {t("Tidak ada tugas untuk bagian ini.", "No tasks for this section.")}
            </p>
          )}
          {data.tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900">
                  {task.seq}. {task.title}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t("Status:", "Status:")} {statusLabel(task.status)}
                  {task.completedAt ? ` · ${fmtDay(task.completedAt)}` : ""}
                  {task.notes ? ` · ${task.notes}` : ""}
                </p>
              </div>
              {data.canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busyTask === task.id || task.status === "Done"}
                    onClick={() => void setTask(task.id, "Done")}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-700 disabled:opacity-40"
                    title={t("Tandai selesai", "Mark done")}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyTask === task.id || task.status === "Na"}
                    onClick={() => void setTask(task.id, "Na")}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-600 disabled:opacity-40"
                    title={t("Tidak berlaku", "Not applicable")}
                  >
                    <MinusCircle className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busyTask === task.id || task.status === "Pending"}
                    onClick={() => void setTask(task.id, "Pending")}
                    className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700 disabled:opacity-40"
                    title={t("Kembalikan ke menunggu", "Reset to pending")}
                  >
                    <CircleDashed className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className="shrink-0 text-xs text-slate-400">{t("terkunci", "locked")}</span>
              )}
            </div>
          ))}
        </div>

        <p className="pb-6 text-center text-xs text-slate-400">
          {t(
            "Tautan ini khusus bagian {dept} — tugas bagian lain tidak terlihat dan tidak bisa diubah.",
            "This link is specific to the {dept} section — other sections' tasks are hidden and cannot be changed.",
            { dept: data.dept },
          )}
        </p>
      </div>
    </main>
  );
}
