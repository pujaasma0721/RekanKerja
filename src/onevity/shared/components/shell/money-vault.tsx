"use client";
// OneVity — Money Vault / Brankas Uang (Task 45-c) ============================
// Tombol topbar (ikon Vault + titik status) + dialog pengelolaan kata sandi
// enkripsi uang per workspace. Kontrak API (backend 45-a, dibangun paralel):
//   · GET  /api/onevity/money-vault         → { configured, open, openUntil,
//     openBy, canManage, myView, grantsCount, lockoutUntil, serverNow }
//   · POST /api/onevity/money-vault         → {action: setup|unlock|lock|
//     change-password|grant|revoke, ...} → {ok:true} | {error, code}
//   · GET  /api/onevity/money-vault/members → {members:[{userId,name,email,
//     role,granted}]} (admin only)
// Ketahanan: endpoint belum ada (404) → tombol abu-abu tooltip "Tidak
// tersedia", dialog menampilkan alert — tanpa crash / rejection liar.
// Aturan inti: ganti kata sandi HANYA saat status "open" (VAULT_LOCKED 409);
// pengguna yang di-grant melihat nilai uang TANPA mengetahui kata sandi.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Vault, KeyRound, Users, ShieldCheck, LockKeyhole, LockKeyholeOpen, TriangleAlert, Info, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/onevity/shared/lib/session-store";
import { useI18n } from "@/onevity/shared/lib/i18n";
import { fmtDateTime } from "@/onevity/shared/lib/api";
import { PasswordInput } from "@/onevity/shared/components/password-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const VAULT_BASE = "/api/onevity/money-vault";
const VAULT_MEMBERS = `${VAULT_BASE}/members`;

// ============ TIPE KONTRAK ============

interface VaultStatus {
  configured: boolean;
  open: boolean;
  openUntil: string | null;
  openBy: string | null;
  canManage: boolean;
  myView: "admin" | "granted" | "none" | "legacy";
  grantsCount: number;
  lockoutUntil: string | null;
  serverNow: string | null;
  error?: string;
}

interface VaultMember {
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "HR" | "VIEWER";
  granted: boolean;
}

/** Error terstruktur dari POST /money-vault — code dipakai utk toast bilingual. */
interface VaultError {
  status: number;
  code: string | null;
  message: string | null;
}

/** POST aksi vault — tidak pernah melempar (rejection liar) — selalu {ok,error}. */
async function vaultMutate(body: Record<string, unknown>): Promise<{ ok: boolean; error: VaultError | null }> {
  try {
    const res = await fetch(VAULT_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!res.ok) return { ok: false, error: { status: res.status, code: json.code ?? null, message: json.error ?? null } };
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: { status: 0, code: null, message: null } };
  }
}

/** Warna + denyut titik status tombol. */
interface DotState { cls: string; pulse: boolean }

// ============ KOMPONEN ============

export function MoneyVaultButton() {
  const { t, locale } = useI18n();
  const sessionStatus = useSession((s) => s.status);
  const ready = sessionStatus === "ready";

  // — status vault (poll: mount + 60 dtk saat tab terlihat + buka dialog + pasca-mutasi) —
  const [st, setSt] = useState<VaultStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false); // fetch pertama selesai
  const [missing, setMissing] = useState(false); // endpoint 404 (45-a belum merge)
  const [failed, setFailed] = useState(false); // fetch gagal & belum ada data
  const statusRef = useRef<VaultStatus | null>(null);
  const skewRef = useRef(0); // selisih jam lokal vs server (dari serverNow)

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("status");
  const [tickCount, setTickCount] = useState(0); // detak 30 dtk utk hitung mundur saat dialog terbuka
  const [busy, setBusy] = useState<null | "setup" | "unlock" | "lock" | "change">(null);

  // — form setup / buka / ganti kata sandi —
  const [setupPw, setSetupPw] = useState("");
  const [setupPw2, setSetupPw2] = useState("");
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [unlockPw, setUnlockPw] = useState("");
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [confirmLock, setConfirmLock] = useState(false); // konfirmasi 2-klik utk mengunci

  // — daftar anggota (admin) —
  const [members, setMembers] = useState<VaultMember[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(VAULT_BASE);
      if (r.status === 404) {
        // backend 45-a belum tersedia — degrade anggun (tombol abu-abu)
        setMissing(true);
        return;
      }
      setMissing(false);
      if (!r.ok) {
        if (!statusRef.current) setFailed(true);
        return;
      }
      const d = (await r.json()) as VaultStatus;
      if (d.serverNow) {
        const srv = new Date(d.serverNow).getTime();
        if (!isNaN(srv)) skewRef.current = Date.now() - srv;
      }
      statusRef.current = d;
      setSt(d);
      setFailed(false);
    } catch {
      if (!statusRef.current) setFailed(true);
    } finally {
      setStatusLoaded(true);
    }
  }, []);

  const fetchMembers = useCallback(async () => {
    setMembersLoading(true);
    setMembersError(null);
    try {
      const r = await fetch(VAULT_MEMBERS);
      if (!r.ok) {
        const json = (await r.json().catch(() => ({}))) as { error?: string };
        setMembersError(json.error ?? `HTTP ${r.status}`);
        setMembers(null);
        return;
      }
      const d = (await r.json()) as { members?: VaultMember[] };
      setMembers(Array.isArray(d.members) ? d.members : []);
    } catch {
      setMembersError(t("Gagal memuat daftar anggota", "Failed to load member list"));
    } finally {
      setMembersLoading(false);
    }
  }, [t]);

  // Poll ringan: saat mount (hanya sesi ready) + interval 60 dtk saat tab terlihat.
  useEffect(() => {
    if (!ready) return;
    void fetchStatus();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") void fetchStatus();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [ready, fetchStatus]);

  // Dialog dibuka → status segar + reset form + tab Status.
  useEffect(() => {
    if (!open) return;
    void fetchStatus();
    setTab("status");
    setSetupPw(""); setSetupPw2(""); setSetupErr(null);
    setUnlockPw(""); setUnlockErr(null);
    setCurPw(""); setNewPw(""); setNewPw2(""); setChangeErr(null);
    setConfirmLock(false);
  }, [open, fetchStatus]);

  // Anggota hanya dimuat saat dialog terbuka & pengguna admin (canManage).
  const canManage = st?.canManage === true;
  useEffect(() => {
    if (open && canManage) void fetchMembers();
  }, [open, canManage, fetchMembers]);

  // Hitung mundur: detak 30 dtk selama dialog terbuka.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTickCount((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, [open]);

  // Konfirmasi 2-klik mengunci: batal otomatis setelah 5 detik.
  useEffect(() => {
    if (!confirmLock) return;
    const id = window.setTimeout(() => setConfirmLock(false), 5_000);
    return () => window.clearTimeout(id);
  }, [confirmLock]);

  // ============ turunan status ============

  /** Sisa waktu (ms) sebelum brankas menutup — jam server via skew. */
  const remainingMs = useMemo(() => {
    if (!st?.open || !st.openUntil) return null;
    void tickCount; // hitung ulang tiap detak 30 dtk
    const until = new Date(st.openUntil).getTime();
    if (isNaN(until)) return null;
    return until - (Date.now() - skewRef.current);
  }, [st, tickCount]);

  /** Lockout aktif ( Percobaan gagal > 5×) — hitung dari jam server. */
  const lockoutActive = useMemo(() => {
    if (!st?.lockoutUntil) return false;
    void tickCount;
    const until = new Date(st.lockoutUntil).getTime();
    if (isNaN(until)) return false;
    return until > Date.now() - skewRef.current;
  }, [st, tickCount]);

  const fmtTime = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  };

  /** Label sisa waktu ("sisa 45 menit" / "sisa 3 jam 20 menit"). */
  const remainingLabel = (ms: number): string => {
    const mins = Math.max(0, Math.round(ms / 60_000));
    if (mins < 60) return t("sisa {n} menit", "{n} min left", { n: mins });
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0
      ? t("sisa {h} jam {m} menit", "{h}h {m}m left", { h, m })
      : t("sisa {h} jam", "{h}h left", { h });
  };

  /** Pesan error bilingual per kode kontrak + fallback pesan server. */
  const errText = (e: VaultError | null): string => {
    if (!e) return t("Terjadi kesalahan jaringan", "A network error occurred");
    const map: Record<string, string> = {
      ALREADY_CONFIGURED: t("Kata sandi enkripsi sudah diatur", "Encryption password is already set"),
      WEAK_PASSWORD: t("Kata sandi terlalu lemah — minimal 8 karakter", "Password is too weak — minimum 8 characters"),
      INVALID_PASSWORD: t("Kata sandi saat ini salah", "Current password is wrong"),
      LOCKOUT: t("Terlalu banyak percobaan gagal — coba lagi nanti", "Too many failed attempts — try again later"),
      VAULT_LOCKED: t("Brankas terkunci — buka brankas dulu sebelum mengganti kata sandi", "Vault is locked — open the vault before changing the password"),
      NOT_MEMBER: t("Pengguna tidak ditemukan di workspace ini", "User not found in this workspace"),
    };
    if (e.code && map[e.code]) {
      // LOCKOUT membawa retryAfterSeconds pada pesan server — tampilkan.
      return e.code === "LOCKOUT" && e.message ? `${map[e.code]} — ${e.message}` : map[e.code]!;
    }
    return e.message ?? t("Permintaan gagal", "Request failed");
  };

  const myViewLabel = (v: VaultStatus["myView"]): string =>
    v === "admin" ? t("Penuh (Admin)", "Full (Admin)")
      : v === "granted" ? t("Diberikan", "Granted")
        : v === "none" ? t("Tidak ada", "None")
          : t("Belum dikonfigurasi", "Not configured");

  // Titik status tombol — matriks configured × open × canManage × myView.
  const dot: DotState = useMemo(() => {
    if (missing || failed || !st) return { cls: "bg-stone-300 dark:bg-stone-600", pulse: false };
    if (!st.configured) {
      return st.canManage
        ? { cls: "bg-amber-500", pulse: true } // admin: belum diatur → ajakan aksi
        : { cls: "bg-stone-400 dark:bg-stone-500", pulse: false };
    }
    if (st.open) return { cls: "bg-emerald-500", pulse: false };
    // tertutup: admin & pengguna ber-grant peduli; pemirsa none/legacy abu-abu
    return st.canManage || st.myView === "granted"
      ? { cls: "bg-rose-500", pulse: false }
      : { cls: "bg-stone-400 dark:bg-stone-500", pulse: false };
  }, [st, missing, failed]);

  const tooltip = useMemo(() => {
    if (missing) return t("Tidak tersedia", "Unavailable");
    if (failed || !st) return t("Brankas Uang", "Money Vault");
    if (!st.configured) {
      return st.canManage
        ? t("Atur kata sandi enkripsi uang", "Set money encryption password")
        : t("Brankas Uang — belum dikonfigurasi", "Money Vault — not configured");
    }
    if (st.open) {
      const hm = fmtTime(st.openUntil);
      return hm
        ? t("Brankas uang terbuka (s.d. {time})", "Money vault open (until {time})", { time: hm })
        : t("Brankas uang terbuka", "Money vault open");
    }
    return t("Brankas uang tertutup", "Money vault closed");
  }, [st, missing, failed, locale, t]);

  // ============ aksi ============

  const submitSetup = async () => {
    if (busy) return;
    setSetupErr(null);
    if (setupPw.length < 8) { setSetupErr(t("Kata sandi minimal 8 karakter", "Password must be at least 8 characters")); return; }
    if (setupPw !== setupPw2) { setSetupErr(t("Konfirmasi kata sandi tidak sama", "Password confirmation does not match")); return; }
    setBusy("setup");
    const res = await vaultMutate({ action: "setup", password: setupPw });
    setBusy(null);
    if (res.ok) {
      toast.success(t("Kata sandi enkripsi uang berhasil diatur", "Money encryption password set successfully"));
      setSetupPw(""); setSetupPw2("");
      setTab("status");
      await fetchStatus();
    } else {
      setSetupErr(errText(res.error));
    }
  };

  const submitUnlock = async () => {
    if (busy || !unlockPw) return;
    setUnlockErr(null);
    setBusy("unlock");
    const res = await vaultMutate({ action: "unlock", password: unlockPw });
    setBusy(null);
    if (res.ok) {
      toast.success(t("Brankas uang dibuka", "Money vault opened"));
      setUnlockPw("");
      await fetchStatus();
    } else {
      setUnlockErr(errText(res.error));
      await fetchStatus(); // bawa lockoutUntil segar bila 429
    }
  };

  const doLock = async () => {
    if (busy) return;
    if (!confirmLock) { setConfirmLock(true); return; } // klik-1: senjatakan konfirmasi
    setBusy("lock");
    setConfirmLock(false);
    const res = await vaultMutate({ action: "lock" });
    setBusy(null);
    if (res.ok) {
      toast.success(t("Brankas uang ditutup", "Money vault closed"));
      await fetchStatus();
    } else {
      toast.error(errText(res.error));
    }
  };

  const submitChange = async () => {
    if (busy) return;
    setChangeErr(null);
    if (!curPw) { setChangeErr(t("Kata sandi saat ini wajib diisi", "Current password is required")); return; }
    if (newPw.length < 8) { setChangeErr(t("Kata sandi baru minimal 8 karakter", "New password must be at least 8 characters")); return; }
    if (newPw !== newPw2) { setChangeErr(t("Konfirmasi kata sandi baru tidak sama", "New password confirmation does not match")); return; }
    setBusy("change");
    const res = await vaultMutate({ action: "change-password", currentPassword: curPw, newPassword: newPw });
    setBusy(null);
    if (res.ok) {
      toast.success(t("Kata sandi enkripsi uang berhasil diganti", "Money encryption password changed successfully"));
      setCurPw(""); setNewPw(""); setNewPw2("");
      await fetchStatus();
    } else {
      setChangeErr(errText(res.error));
      await fetchStatus(); // VAULT_LOCKED bisa terjadi bila ditutup orang lain
    }
  };

  const toggleGrant = async (m: VaultMember, next: boolean) => {
    if (pendingToggle) return;
    setPendingToggle(m.userId);
    // optimistik: balik switch segera
    setMembers((prev) => (prev ? prev.map((x) => (x.userId === m.userId ? { ...x, granted: next } : x)) : prev));
    const res = await vaultMutate({ action: next ? "grant" : "revoke", userId: m.userId });
    setPendingToggle(null);
    if (res.ok) {
      toast.success(next
        ? t("Hak lihat uang diberikan kepada {name}", "Money view rights granted to {name}", { name: m.name })
        : t("Hak lihat uang {name} dicabut", "Money view rights revoked for {name}", { name: m.name }));
      await Promise.all([fetchStatus(), fetchMembers()]); // grantsCount + baris segar
    } else {
      toast.error(errText(res.error)); // 404 dsb.
      await fetchMembers(); // kembalikan baris ke kondisi server
    }
  };

  // ============ render ============

  if (!ready) return null; // sesi tanpa workspace (superadmin pre-select / anonim) → sembunyikan

  const roleBadge = (r: VaultMember["role"]) => (
    <Badge variant={r === "OWNER" || r === "ADMIN" ? "secondary" : "outline"} className="text-[10px] font-bold">{r}</Badge>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(true)}
            aria-label={t("Brankas Uang", "Money Vault")}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl text-stone-500 transition hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <Vault className="h-[18px] w-[18px]" aria-hidden />
            <span className={cn("absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full", dot.cls, dot.pulse && "animate-pulse")} aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px] font-semibold">{tooltip}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={(v) => { if (busy === null) setOpen(v); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Vault className="h-4 w-4" aria-hidden /> {t("Brankas Uang", "Money Vault")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Kata sandi enkripsi uang mengontrol visibilitas nilai uang di workspace ini — hanya pemegang kata sandi yang dapat membukanya.",
                "The money encryption password controls money value visibility in this workspace — only the password holder can open it.",
              )}
            </DialogDescription>
          </DialogHeader>

          {!statusLoaded ? (
            /* fetch pertama masih berjalan */
            <div className="space-y-2.5 px-1">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : missing ? (
            /* endpoint belum ada (45-a belum merge) — degrade anggun */
            <Alert className="border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              <TriangleAlert className="text-amber-600 dark:text-amber-400" aria-hidden />
              <AlertTitle>{t("Fitur belum tersedia", "Feature unavailable")}</AlertTitle>
              <AlertDescription>
                {t(
                  "Fitur Brankas Uang belum tersedia di server ini. Halaman tetap aman dipakai — coba lagi setelah pembaruan sistem.",
                  "The Money Vault feature is not yet available on this server. The app remains safe to use — try again after a system update.",
                )}
              </AlertDescription>
            </Alert>
          ) : failed && !st ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>{t("Gagal memuat status", "Failed to load status")}</AlertTitle>
              <AlertDescription>
                {t("Status brankas uang tidak dapat dimuat. Coba tutup lalu buka kembali dialog ini.", "Money vault status could not be loaded. Try closing and reopening this dialog.")}
              </AlertDescription>
            </Alert>
          ) : st ? (
            <Tabs value={tab} onValueChange={setTab} className="gap-3">
              <TabsList className="w-full">
                <TabsTrigger value="status" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> {t("Status", "Status")}</TabsTrigger>
                <TabsTrigger value="password" className="gap-1.5"><KeyRound className="h-3.5 w-3.5" /> {t("Kata Sandi", "Password")}</TabsTrigger>
                <TabsTrigger value="access" className="gap-1.5"><Users className="h-3.5 w-3.5" /> {t("Hak Akses", "Access Rights")}</TabsTrigger>
              </TabsList>

              {/* ============ TAB STATUS (semua peran) ============ */}
              <TabsContent value="status" className="space-y-3.5">
                {!st.configured ? (
                  <Alert className="border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    <LockKeyholeOpen className="text-amber-600 dark:text-amber-400" aria-hidden />
                    <AlertTitle>{t("Kata sandi enkripsi belum diatur", "Encryption password not set yet")}</AlertTitle>
                    <AlertDescription>
                      {t(
                        "Nilai uang masih tampil normal. Atur kata sandi untuk mengunci visibilitas uang.",
                        "Money values are still visible normally. Set a password to lock money visibility.",
                      )}
                    </AlertDescription>
                  </Alert>
                ) : st.open ? (
                  <Alert className="border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                    <LockKeyholeOpen className="text-emerald-600 dark:text-emerald-400" aria-hidden />
                    <AlertTitle>{t("Brankas uang TERBUKA", "Money vault OPEN")}</AlertTitle>
                    <AlertDescription className="text-emerald-700 dark:text-emerald-400">
                      {t("Pengguna dengan hak lihat uang dapat melihat nilainya.", "Users with money view rights can see the values.")}
                      {st.openUntil && (
                        <span className="block">
                          {t("Berlaku hingga {d}", "Valid until {d}", { d: fmtDateTime(st.openUntil) })}
                          {remainingMs != null && remainingMs > 0 ? ` · ${remainingLabel(remainingMs)}` : ""}
                        </span>
                      )}
                      {st.openBy && <span className="block">{t("Dibuka oleh {name}", "Opened by {name}", { name: st.openBy })}</span>}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert variant="destructive">
                    <LockKeyhole aria-hidden />
                    <AlertTitle>{t("Brankas uang TERTUTUP", "Money vault CLOSED")}</AlertTitle>
                    <AlertDescription>
                      {t("Semua nilai uang disembunyikan (—).", "All money values are hidden (—).")}
                    </AlertDescription>
                  </Alert>
                )}

                {lockoutActive && (
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>{t("Percobaan kata sandi terkunci", "Password attempts locked out")}</AlertTitle>
                    <AlertDescription>
                      {t(
                        "Terlalu banyak percobaan gagal. Buka brankas dinonaktifkan sementara hingga {d}.",
                        "Too many failed attempts. Unlocking is temporarily disabled until {d}.",
                        { d: fmtDateTime(st.lockoutUntil) },
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-1.5 rounded-xl border border-stone-200 bg-stone-50/70 px-3.5 py-3 text-[12px] leading-relaxed dark:border-stone-800 dark:bg-stone-900/40">
                  <p className="text-stone-600 dark:text-stone-300">
                    {t("Hak lihat uang Anda:", "Your money view rights:")}{" "}
                    <span className={cn(
                      "font-bold",
                      st.myView === "admin" || st.myView === "granted" ? "text-emerald-600 dark:text-emerald-400" : st.myView === "none" ? "text-rose-600 dark:text-rose-400" : "text-stone-500",
                    )}>{myViewLabel(st.myView)}</span>
                  </p>
                  {st.configured && (
                    <p className="text-stone-600 dark:text-stone-300">
                      {t("{n} anggota lain diberi hak lihat uang.", "{n} other members have granted money view rights.", { n: st.grantsCount })}
                    </p>
                  )}
                </div>

                {/* Aksi admin sesuai status */}
                {canManage && st.configured && st.open && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={() => void doLock()}
                      disabled={busy !== null}
                      variant={confirmLock ? "destructive" : "outline"}
                      className="gap-2 rounded-xl font-bold"
                    >
                      <LockKeyhole className="h-4 w-4" />
                      {busy === "lock"
                        ? t("Memproses…", "Processing…")
                        : confirmLock
                          ? t("Klik lagi untuk konfirmasi", "Click again to confirm")
                          : t("Kunci Brankas", "Lock Vault")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void fetchStatus()} className="gap-1.5 text-[11px] font-bold text-stone-500">
                      <RefreshCw className="h-3.5 w-3.5" /> {t("Segarkan", "Refresh")}
                    </Button>
                  </div>
                )}

                {canManage && st.configured && !st.open && (
                  <form
                    className="space-y-2.5 rounded-xl border border-stone-200 p-3.5 dark:border-stone-800"
                    onSubmit={(e) => { e.preventDefault(); void submitUnlock(); }}
                  >
                    <p className="text-xs font-bold">{t("Buka Brankas", "Open Vault")}</p>
                    <PasswordInput
                      value={unlockPw}
                      onChange={setUnlockPw}
                      autoComplete="current-password"
                      placeholder={t("Kata sandi enkripsi uang", "Money encryption password")}
                      disabled={busy !== null || lockoutActive}
                    />
                    {unlockErr && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{unlockErr}</p>}
                    <Button type="submit" disabled={busy !== null || lockoutActive || !unlockPw} className="gap-2 rounded-xl font-bold">
                      {busy === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyholeOpen className="h-4 w-4" />}
                      {busy === "unlock" ? t("Membuka…", "Opening…") : t("Buka Brankas", "Open Vault")}
                    </Button>
                  </form>
                )}

                {canManage && !st.configured && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setTab("password")} className="gap-2 rounded-xl font-bold">
                      <KeyRound className="h-4 w-4" /> {t("Atur Kata Sandi Sekarang", "Set Password Now")}
                    </Button>
                    <span className="text-[11px] text-stone-400">
                      {t("Lihat tab Kata Sandi.", "See the Password tab.")}
                    </span>
                  </div>
                )}
              </TabsContent>

              {/* ============ TAB KATA SANDI (canManage saja) ============ */}
              <TabsContent value="password" className="space-y-3.5">
                {!canManage ? (
                  <Alert>
                    <Info aria-hidden />
                    <AlertTitle>{t("Hanya Admin", "Admins only")}</AlertTitle>
                    <AlertDescription>
                      {t("Hanya Admin yang dapat mengatur kata sandi enkripsi uang.", "Only Admins can manage the money encryption password.")}
                    </AlertDescription>
                  </Alert>
                ) : !st.configured ? (
                  <form
                    className="space-y-3 rounded-xl border border-stone-200 p-3.5 dark:border-stone-800"
                    onSubmit={(e) => { e.preventDefault(); void submitSetup(); }}
                  >
                    <p className="text-xs font-bold">{t("Atur Kata Sandi Enkripsi", "Set Encryption Password")}</p>
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">{t("Kata Sandi Baru", "New Password")} *</p>
                      <PasswordInput value={setupPw} onChange={setSetupPw} disabled={busy !== null} />
                      <p className="text-[10px] text-stone-400">{t("Minimal 8 karakter", "Minimum 8 characters")}</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">{t("Konfirmasi Kata Sandi", "Confirm Password")} *</p>
                      <PasswordInput value={setupPw2} onChange={setSetupPw2} disabled={busy !== null} />
                    </div>
                    {setupErr && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{setupErr}</p>}
                    <Button type="submit" disabled={busy !== null || !setupPw || !setupPw2} className="gap-2 rounded-xl font-bold">
                      {busy === "setup" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                      {busy === "setup" ? t("Menyimpan…", "Saving…") : t("Atur Kata Sandi Enkripsi", "Set Encryption Password")}
                    </Button>
                  </form>
                ) : (
                  <>
                    {!st.open && (
                      <Alert className="border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                        <TriangleAlert className="text-amber-600 dark:text-amber-400" aria-hidden />
                        <AlertTitle>{t("Buka brankas dulu", "Open the vault first")}</AlertTitle>
                        <AlertDescription>
                          {t(
                            "Kata sandi enkripsi hanya dapat diganti saat brankas dalam keadaan TERBUKA (tab Status).",
                            "The encryption password can only be changed while the vault is OPEN (see the Status tab).",
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                    <form
                      className="space-y-3 rounded-xl border border-stone-200 p-3.5 dark:border-stone-800"
                      onSubmit={(e) => { e.preventDefault(); void submitChange(); }}
                    >
                      <p className="text-xs font-bold">{t("Ganti Kata Sandi Enkripsi", "Change Encryption Password")}</p>
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">{t("Kata Sandi Saat Ini", "Current Password")} *</p>
                        <PasswordInput value={curPw} onChange={setCurPw} autoComplete="current-password" disabled={!st.open || busy !== null} />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">{t("Kata Sandi Baru", "New Password")} *</p>
                        <PasswordInput value={newPw} onChange={setNewPw} disabled={!st.open || busy !== null} />
                        <p className="text-[10px] text-stone-400">{t("Minimal 8 karakter", "Minimum 8 characters")}</p>
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">{t("Konfirmasi Kata Sandi Baru", "Confirm New Password")} *</p>
                        <PasswordInput value={newPw2} onChange={setNewPw2} disabled={!st.open || busy !== null} />
                      </div>
                      {changeErr && <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{changeErr}</p>}
                      <Button type="submit" disabled={!st.open || busy !== null || !curPw || !newPw || !newPw2} className="gap-2 rounded-xl font-bold">
                        {busy === "change" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                        {busy === "change" ? t("Menyimpan…", "Saving…") : t("Ganti Kata Sandi", "Change Password")}
                      </Button>
                    </form>
                  </>
                )}
              </TabsContent>

              {/* ============ TAB HAK AKSES (canManage saja) ============ */}
              <TabsContent value="access" className="space-y-3.5">
                {!canManage ? (
                  <>
                    <Alert>
                      <Info aria-hidden />
                      <AlertTitle>{t("Hanya Admin", "Admins only")}</AlertTitle>
                      <AlertDescription>
                        {t("Hanya Admin yang dapat mengatur hak lihat uang.", "Only Admins can manage money view rights.")}
                      </AlertDescription>
                    </Alert>
                    <p className="text-[12px] text-stone-500 dark:text-stone-400">
                      {t("Hak lihat uang Anda:", "Your money view rights:")}{" "}
                      <span className="font-bold text-stone-700 dark:text-stone-200">{myViewLabel(st.myView)}</span>
                    </p>
                  </>
                ) : (
                  <>
                    <Alert className="border-sky-200 bg-sky-50/70 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                      <Users className="text-sky-600 dark:text-sky-400" aria-hidden />
                      <AlertTitle>{t("Bagikan hak lihat uang", "Share money view rights")}</AlertTitle>
                      <AlertDescription>
                        {t(
                          "Anggota yang ditugaskan dapat melihat nilai uang TANPA mengetahui kata sandi enkripsi — kata sandi tetap hanya milik Anda.",
                          "Assigned members can see money values WITHOUT knowing the encryption password — the password stays only with you.",
                        )}
                      </AlertDescription>
                    </Alert>

                    <div className="max-h-96 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-800">
                      {membersLoading ? (
                        <div className="space-y-2.5 p-3.5">
                          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                        </div>
                      ) : membersError ? (
                        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
                          <TriangleAlert className="h-5 w-5 text-stone-400" aria-hidden />
                          <p className="text-xs text-stone-500">{membersError}</p>
                          <Button variant="outline" size="sm" onClick={() => void fetchMembers()} className="gap-1.5 rounded-lg text-[11px] font-bold">
                            <RefreshCw className="h-3.5 w-3.5" /> {t("Coba Lagi", "Retry")}
                          </Button>
                        </div>
                      ) : members && members.length > 0 ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[11px] font-bold uppercase tracking-wide">{t("Nama", "Name")}</TableHead>
                              <TableHead className="hidden text-[11px] font-bold uppercase tracking-wide sm:table-cell">{t("Email", "Email")}</TableHead>
                              <TableHead className="text-[11px] font-bold uppercase tracking-wide">{t("Peran", "Role")}</TableHead>
                              <TableHead className="text-right text-[11px] font-bold uppercase tracking-wide">{t("Akses Uang", "Money Access")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {members.map((m) => {
                              const implicit = m.role === "OWNER" || m.role === "ADMIN";
                              return (
                                <TableRow key={m.userId}>
                                  <TableCell className="max-w-[160px] truncate py-2.5 text-[12px] font-semibold">{m.name}</TableCell>
                                  <TableCell className="hidden max-w-[200px] truncate py-2.5 text-[12px] text-stone-500 sm:table-cell">{m.email}</TableCell>
                                  <TableCell className="py-2.5">{roleBadge(m.role)}</TableCell>
                                  <TableCell className="py-2.5 text-right">
                                    {implicit ? (
                                      <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                        {t("Otomatis", "Automatic")}
                                      </span>
                                    ) : (
                                      <Switch
                                        checked={m.granted}
                                        disabled={pendingToggle !== null}
                                        onCheckedChange={(v) => void toggleGrant(m, v)}
                                        aria-label={t("Hak lihat uang {name}", "Money view rights for {name}", { name: m.name })}
                                      />
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="px-3 py-8 text-center">
                          <p className="text-xs text-stone-400">{t("Belum ada anggota lain di workspace ini.", "No other members in this workspace yet.")}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </TabsContent>
            </Tabs>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
