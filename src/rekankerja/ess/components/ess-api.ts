"use client";
// RekanKerja ESS — wrapper API tipis (pola shared/lib/api.ts: fetch relatif + kredensial sesi).
// Semua endpoint /api/rekankerja/ess/* sesuai KONTRAK API agent T7. Bentuk data yang
// tidak dirinci kontrak dibaca defensif via pickStr/pickNum agar tampilan tetap rapi.
import { useCallback, useEffect, useState } from "react";
import { apiSend, apiUpload } from "@/rekankerja/shared/lib/api";
import { trServer } from "@/rekankerja/shared/lib/i18n-core";
import type {
  EssAttendanceData,
  EssClaimsData,
  EssClockInput,
  EssClockResult,
  EssClockSettings,
  EssLeaveData,
  EssLeaveSubmitInput,
  EssMedicalClaimFormData,
  EssMedicalClaimSubmitInput,
  EssMedicalClaimSubmitResult,
  EssMe,
  EssNotificationsData,
  EssOvertimeInput,
  EssPayslipDetail,
  EssSubmitResult,
  EssTravelClaimFormData,
  EssTravelClaimSubmitInput,
  EssTravelClaimSubmitResult,
  EssWorkoffInput,
} from "./ess-types";

export const ESS_BASE = "/api/rekankerja/ess";

// ============ helper pembacaan defensif ============

/** Ambil string pertama yang terdefinisi dari kandidat nama field. */
export function pickStr(obj: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Ambil angka pertama yang terdefinisi dari kandidat nama field. */
export function pickNum(obj: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/** Render jam "HH:mm" dari nilai "08:05", "08:05:33", atau ISO timestamp. */
export function fmtClockTime(v: string | null | undefined, locale: "id-ID" | "en-US"): string {
  if (!v) return "—";
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(v)) return v.length === 5 ? v : v.slice(0, 5);
  const d = new Date(v);
  if (!isNaN(d.getTime())) return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  return v;
}

/** Label dokumen (mis. LEAVE/WORKOFF/OVERTIME) → label ramah bila dikenali. */
export function essDocTypeLabel(v: string): string {
  const s = v.toLowerCase();
  if (s.includes("leave")) return "Cuti";
  if (s.includes("work") && s.includes("off")) return "Izin Tidak Masuk";
  if (s.includes("overtime")) return "Lembur";
  if (s.includes("medical")) return "Klaim Medis";
  if (s.includes("travel")) return "Travel Dinas";
  if (s.includes("personnel") || s.includes("pa")) return "Personnel Action";
  return v;
}

/** Padanan EN utk essDocTypeLabel (dipakai t(label, en) — Task 38). */
export function essDocTypeLabelEn(v: string): string {
  const s = v.toLowerCase();
  if (s.includes("leave")) return "Leave";
  if (s.includes("work") && s.includes("off")) return "Work Off";
  if (s.includes("overtime")) return "Overtime";
  if (s.includes("medical")) return "Medical Claim";
  if (s.includes("travel")) return "Business Travel";
  if (s.includes("personnel") || s.includes("pa")) return "Personnel Action";
  return v;
}

// ============ GET tipis ============
export async function essGet<T>(path: string): Promise<T> {
  const res = await fetch(`${ESS_BASE}${path}`);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    // BL-ERR: pesan error server diterjemahkan terpusat (kamus/pola EN).
    const err = new Error(trServer(json.error ?? `HTTP ${res.status}`)) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json;
}

// ============ POST mutasi (sesuai kontrak) ============
export const submitLeave = (body: EssLeaveSubmitInput) =>
  apiSend<EssSubmitResult>(`${ESS_BASE}/leave`, "POST", body);

export const submitWorkoff = (body: EssWorkoffInput) =>
  apiSend<EssSubmitResult>(`${ESS_BASE}/workoff`, "POST", body);

export const submitOvertime = (body: EssOvertimeInput) =>
  apiSend<EssSubmitResult>(`${ESS_BASE}/overtime`, "POST", body);

export const submitClock = (body: EssClockInput) =>
  apiSend<EssClockResult>(`${ESS_BASE}/clock`, "POST", body);

// ============ Task 100 F1 (G13/G17) — clock multipart (foto selfie + QR) ============

/** GET /ess/clock-settings — mode verifikasi presensi (selfie/face) widget punch clock. */
export const fetchClockSettings = () => essGet<EssClockSettings>("/clock-settings");

/**
 * POST /ess/clock sebagai multipart/form-data — FormData berisi direction,
 * latitude, longitude, accuracy, note, deviceId, qrToken, photo (Blob selfie.jpg).
 * (apiUpload TIDAK menyetel Content-Type manual — browser menyetel boundary.)
 */
export const submitClockForm = (form: FormData) =>
  apiUpload<EssClockResult>(`${ESS_BASE}/clock`, form);

/**
 * Fingerprint perangkat stabil (G13): UUID sekali di localStorage "rk_device_id",
 * dikirim pada SETIAP clock supaya log presensi bisa diaudit per perangkat.
 * Gagal akses storage → null (clock tetap jalan tanpa deviceId).
 */
export function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const KEY = "rk_device_id";
    let v = window.localStorage.getItem(KEY);
    if (!v) {
      v = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}

// ============ Task 100 F1 (G19) — open shift marketplace ============

/** POST /ess/open-shift { postId } — ajukan klaim (201) / 409 sudah pernah. */
export const claimOpenShift = (postId: string) =>
  apiSend<{ ok: boolean; claimId: string; status: string }>(`${ESS_BASE}/open-shift`, "POST", { postId });

// ============ POST permintaan surat layanan (26-a) ============
export const submitLetterRequest = (body: { templateKey: string; purpose?: string; notes?: string }) =>
  apiSend<EssSubmitResult>(`${ESS_BASE}/letters`, "POST", body);

// ============ GET/POST pengajuan klaim medis & travel (Task 71) ============
export const fetchMedicalClaimForm = () =>
  essGet<EssMedicalClaimFormData>("/claims/medical");

export const submitMedicalClaim = (body: EssMedicalClaimSubmitInput) =>
  apiSend<EssMedicalClaimSubmitResult>(`${ESS_BASE}/claims/medical`, "POST", body);

export const fetchTravelClaimForm = () =>
  essGet<EssTravelClaimFormData>("/claims/travel");

export const submitTravelClaim = (body: EssTravelClaimSubmitInput) =>
  apiSend<EssTravelClaimSubmitResult>(`${ESS_BASE}/claims/travel`, "POST", body);

export const markNotifRead = (payload: { id?: string; all?: boolean }) =>
  apiSend<unknown>(`${ESS_BASE}/notifications/read`, "POST", payload);

// ============ hook /ess/me (state machine — bedakan 403 "akun tanpa karyawan") ============
export type EssMeState =
  | { phase: "loading" }
  | { phase: "ok"; me: EssMe }
  | { phase: "no-employee"; canAdmin: boolean; message: string | null }
  | { phase: "error"; message: string | null };

/**
 * GET /api/rekankerja/ess/me → profil karyawan sesi.
 * · 403 = akun login tidak terhubung ke data karyawan (tanpa employeeId) →
 *   layar pemberitahuan; canAdmin diperiksa lewat user-menu-access agar tombol
 *   "Mode Admin" hanya tampil bagi pengguna yang benar punya akses admin.
 * · error lain (network/5xx) → error state dengan tombol coba lagi.
 */
export function useEssMe(): { state: EssMeState; retry: () => void } {
  const [state, setState] = useState<EssMeState>({ phase: "loading" });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setState({ phase: "loading" });
      try {
        const res = await fetch(`${ESS_BASE}/me`);
        if (res.ok) {
          const me = (await res.json()) as EssMe;
          if (alive) setState({ phase: "ok", me });
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 403) {
          // akun tanpa employeeId — cek canAdmin untuk tombol kembali ke admin
          let canAdmin = true; // default true: gagal cek → tetap beri jalan pulang
          try {
            const mr = await fetch("/api/rekankerja/user-menu-access?action=me");
            if (mr.ok) {
              const md = (await mr.json()) as { all?: boolean; menus?: string[]; isSuperAdmin?: boolean };
              canAdmin = !!(md.all || (md.menus ?? []).length > 0 || md.isSuperAdmin);
            }
          } catch { /* biarkan true */ }
          if (alive) setState({ phase: "no-employee", canAdmin, message: trServer(body.error) });
          return;
        }
        if (alive) setState({ phase: "error", message: trServer(body.error ?? `HTTP ${res.status}`) });
      } catch {
        if (alive) setState({ phase: "error", message: null });
      }
    };
    void run();
    return () => { alive = false; };
  }, [tick]);

  return { state, retry };
}

// ============ shortcut tipe data fetch halaman (opsional, buat rapi) ============
export type {
  EssAttendanceData,
  EssClaimsData,
  EssLeaveData,
  EssNotificationsData,
  EssPayslipDetail,
};
