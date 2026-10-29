"use client";
// OneVity — Settings: PENGGUNA + KEBIJAKAN KATA SANDI (Task 33) ============
// =====================================================================
// Tab Pengguna (Keamanan & Akses):
//   • TAMBAH PENGGUNA — dialog lengkap: identitas + role + tautan karyawan
//     + kata sandi awal divalidasi KEBIJAKAN (checklist live + meter). Membuat
//     AppUser tenant + akun login platform (email+sandi) sekaligus — pengguna
//     baru bisa langsung masuk.
//   • RESET KATA SANDI per pengguna — tervalidasi kebijakan + RIWAYAT
//     (tidak boleh sama dengan N sandi terakhir).
//   • Kolom umur kata sandi (lifetime) + hapus pengguna.
// Tab Kebijakan Kata Sandi:
//   • Editor aturan lengkap (kompleksitas / umur & riwayat / lockout login)
//     + kartu UJI CODO live terhadap kebijakan saat ini.
// Kartu Autentikasi Dua Faktor (T17-MFA):
//   • Self-service akun login SENDIRI (bukan AppUser lain): status + dialog
//     setup (QR + secret + input kode verifikasi) + disable dgn kata sandi.
// Tombol aksi ter-gate hak aksi menu per pengguna (settings:security).
// =====================================================================
import { useEffect, useMemo, useState } from "react";
import { useApi, apiSend, initials } from "@/onevity/shared/lib/api";
import { useTableSort } from "@/onevity/shared/lib/use-table-sort";
import { useSession } from "@/onevity/shared/lib/session-store";
import { EmptyState, LoadingRows, StatusPill } from "@/onevity/shared/components/ui-kit";
import { PasswordInput, PasswordRuleChecklist, PasswordStrengthBar } from "@/onevity/shared/components/password-ui";
import { actionAllowed, type MenuAction, type MenusMap } from "@/onevity/shared/lib/menu-perms";
import {
  DEFAULT_PASSWORD_POLICY,
  passwordAge,
  type PasswordPolicyData,
} from "@/onevity/shared/lib/password-policy";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  KeyRound, Pencil, Plus, ShieldCheck, ShieldOff, Smartphone, Trash2, UserCog, Eye, CalendarClock, History,
  Lock, Gauge, Save, RotateCcw, FlaskConical, UserRound, Copy, Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APP_ROLES = ["Admin", "HR Manager", "HR Staff", "Approver", "Viewer"] as const;

// Peta EN paralel label umur kata sandi dari lib/password-policy (label ID tetap di lib).
function ageLabelEn(label: string): string {
  if (label === "Tanpa batas umur") return "No age limit";
  if (label === "Kedaluwarsa") return "Expired";
  if (label === "Kedaluwarsa besok") return "Expires tomorrow";
  const m = /^Berlaku (\d+) hari lagi$/.exec(label);
  if (m) return `Valid for ${m[1]} more days`;
  return label;
}

const ROLE_TONE: Record<string, string> = {
  Admin: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
  "HR Manager": "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85",
  Approver: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
  Viewer: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
};

// ---------- hak aksi menu (per pengguna, Task 32) ----------

interface MeAccess { all: boolean; menus: string[]; perms?: MenusMap; isSuperAdmin: boolean }

function useSecurityActions() {
  const { data: me } = useApi<MeAccess>("/api/onevity/user-menu-access?action=me");
  return useMemo(() => {
    const perm = me?.perms?.["settings:security"];
    const can = (a: MenuAction) =>
      me == null ? false : me.all || (perm != null && perm.view && actionAllowed(perm, a));
    return { me, can };
  }, [me]);
}

// ---------- tipe data ----------

interface AppUserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: string;
  active: boolean;
  lastLogin: string | null;
  employeeId: string | null;
  passwordChangedAt: string | null;
  groups: { name: string; code: string }[];
}
interface AppUserData { users: AppUserRow[] }
interface EmployeeOption { id: string; fullName: string; employeeNo: string; status: string }

/** respons policy membawa updatedAt (string) dari DB */
type PolicyWithStamp = PasswordPolicyData & { updatedAt?: string };

// =====================================================================
// PANEL PENGGUNA
// =====================================================================

export function UsersPanel({ onConfigureAccess }: { onConfigureAccess: (userId: string) => void }) {
  const { t, locale } = useI18n();
  const { data, loading, refresh } = useApi<AppUserData>("/api/onevity/app-users");
  const { data: policyData } = useApi<{ policy: PolicyWithStamp }>("/api/onevity/password-policy");
  const { data: empData } = useApi<{ employees: EmployeeOption[] }>("/api/onevity/employees?limit=200", [data]);
  const { can } = useSecurityActions();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AppUserRow | null>(null);
  const [resetTarget, setResetTarget] = useState<AppUserRow | null>(null);
  const [deleting, setDeleting] = useState<AppUserRow | null>(null);

  const policy = policyData?.policy ?? DEFAULT_PASSWORD_POLICY;
  const employees = empData?.employees ?? [];
  const users = data?.users ?? [];

  // Task 72 — sorting kolom tabel pengguna (asc/desc via header)
  const sort = useTableSort(users, {
    user: (u) => u.fullName,
    username: (u) => u.username,
    role: (u) => u.role,
    lastLogin: (u) => u.lastLogin,
    password: (u) => u.passwordChangedAt,
    status: (u) => (u.active ? 0 : 1),
  }, { defaultKey: "user", defaultDir: "asc" });

  const removeUser = async (u: AppUserRow) => {
    try {
      await apiSend(`/api/onevity/app-users?id=${u.id}`, "DELETE");
      toast.success(t("Pengguna {name} dihapus", "User {name} deleted", { name: u.fullName }));
      setDeleting(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <div className="flex flex-row flex-wrap items-center justify-between gap-x-2 gap-y-2.5 border-b border-slate-200/80 px-6 pb-3 pt-6 dark:border-slate-800/80">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <UserCog className="h-4 w-4 ov-text-accent" /> {t("Pengguna Aplikasi ({n})", "Application Users ({n})", { n: users.length })}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 font-mono text-[10px]">
            <History className="h-3 w-3" /> {t("riwayat {n} sandi · umur {m} hari", "history of {n} passwords · lifetime {m} days", { n: policy.historyCount, m: policy.lifetimeDays })}
          </Badge>
          <Button
            onClick={() => setCreateOpen(true)}
            disabled={!can("create")}
            title={can("create") ? t("Tambah pengguna aplikasi baru", "Add a new application user") : t("Anda tidak memiliki aksi Baru pada menu ini", "You do not have the Create action on this menu")}
            className="h-8 gap-1.5 rounded-xl px-3 text-xs font-bold"
          >
            <Plus className="h-3.5 w-3.5" /> {t("Tambah Pengguna", "Add User")}
          </Button>
        </div>
      </div>
      <CardContent className="pt-0">
        {users.length === 0 ? (
          <EmptyState title={t("Belum ada pengguna aplikasi", "No application users yet")} description={t("Tambahkan pengguna pertama untuk workspace ini.", "Add the first user for this workspace.")} icon={UserCog} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                  {sort.head("user", t("Pengguna", "User"), "text-[11px] font-bold")}
                  {sort.head("role", "Role", "text-[11px] font-bold")}
                  {sort.head("lastLogin", t("Login Terakhir", "Last Login"), "text-[11px] font-bold")}
                  <TableHead className="text-[11px] font-bold">{t("Kata Sandi")}</TableHead>
                  {sort.head("status", t("Status"), "text-[11px] font-bold")}
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sort.sorted.map((u) => {
                  const age = passwordAge(u.passwordChangedAt, policy);
                  const linked = employees.find((e) => e.id === u.employeeId);
                  return (
                    <TableRow key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-extrabold",
                            u.active
                              ? "bg-brand/15 text-brand-deep dark:bg-brand/15 dark:text-brand/85"
                              : "bg-slate-100 text-slate-400 dark:bg-slate-800",
                          )}>{initials(u.fullName)}</span>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-[13px] font-bold">
                              {u.fullName}
                              <span className="font-mono text-[10px] font-normal text-slate-400">{u.username}</span>
                            </p>
                            <p className="truncate text-[10px] text-slate-400">
                              {u.email ?? t("— tanpa email", "— no email")}
                              {linked ? ` · ${linked.employeeNo}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px] font-bold", ROLE_TONE[u.role] ?? "")}>{u.role}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : t("Belum pernah", "Never")}
                      </TableCell>
                      <TableCell>
                        {u.passwordChangedAt ? (
                          <span
                            title={t("Terakhir disetel: {d} · kebijakan: umur {n} hari", "Last set: {d} · policy: lifetime {n} days", { d: new Date(u.passwordChangedAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" }), n: policy.lifetimeDays })}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold",
                              age.expired
                                ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400"
                                : age.warn
                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400"
                                  : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
                            )}
                          >
                            <CalendarClock className="h-3 w-3" /> {t(age.label, ageLabelEn(age.label))}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">{t("— belum disetel", "— never set")}</span>
                        )}
                      </TableCell>
                      <TableCell><StatusPill status={u.active ? "Active" : "Cancelled"} /></TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          <button
                            onClick={() => onConfigureAccess(u.id)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:ov-soft"
                            aria-label={t("Atur hak akses {name}", "Configure access rights for {name}", { name: u.fullName })}
                            title={t("Atur hak akses (menu & data)", "Configure access rights (menus & data)")}
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditing(u)}
                            disabled={!can("update")}
                            title={can("update") ? t("Edit pengguna", "Edit user") : t("Tanpa aksi Ubah pada menu ini", "No Update action on this menu")}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30 dark:hover:bg-slate-800"
                            aria-label={`Edit ${u.fullName}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setResetTarget(u)}
                            disabled={!can("update") || !u.email}
                            title={!u.email ? t("Pengguna tanpa email tidak punya akun login", "A user without email has no login account") : can("update") ? t("Reset kata sandi (kebijakan + riwayat)", "Reset password (policy + history)") : t("Tanpa aksi Ubah pada menu ini", "No Update action on this menu")}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600 disabled:opacity-30 dark:hover:bg-amber-500/10"
                            aria-label={t("Reset kata sandi {name}", "Reset password for {name}", { name: u.fullName })}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleting(u)}
                            disabled={!can("delete")}
                            title={can("delete") ? t("Hapus pengguna", "Delete user") : t("Tanpa aksi Hapus pada menu ini", "No Delete action on this menu")}
                            className="rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30 dark:hover:bg-rose-500/10"
                            aria-label={`Hapus ${u.fullName}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* dialog tambah / edit / reset / hapus */}
      <UserCreateDialog
        open={createOpen}
        onClose={(saved) => { setCreateOpen(false); if (saved) refresh(); }}
        policy={policy}
        employees={employees}
      />
      <UserEditDialog
        user={editing}
        employees={employees}
        onClose={(saved) => { setEditing(null); if (saved) refresh(); }}
      />
      <ResetPasswordDialog
        user={resetTarget}
        policy={policy}
        onClose={(saved) => { setResetTarget(null); if (saved) refresh(); }}
      />
      <Dialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-4 w-4 text-rose-500" /> {t("Hapus Pengguna", "Delete User")}
            </DialogTitle>
            <DialogDescription>
              {t("Pengguna", "User")} <b>{deleting?.fullName}</b> ({deleting?.username}) {t("akan dihapus dari workspace ini. Akun login platform & membership workspace tetap dipertahankan.", "will be removed from this workspace. The platform login account & workspace membership are kept.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>{t("Batal")}</Button>
            <Button onClick={() => deleting && removeUser(deleting)} className="bg-rose-600 font-bold hover:bg-rose-700">{t("Hapus")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =====================================================================
// DIALOG TAMBAH PENGGUNA
// =====================================================================

function UserCreateDialog({
  open, onClose, policy, employees,
}: {
  open: boolean;
  onClose: (saved: boolean) => void;
  policy: PasswordPolicyData;
  employees: EmployeeOption[];
}) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("Viewer");
  const [employeeId, setEmployeeId] = useState<string>("none");
  const [active, setActive] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  // reset formulir saat dibuka
  useEffect(() => {
    if (open) {
      setFullName(""); setUsername(""); setEmail(""); setRole("Viewer");
      setEmployeeId("none"); setActive(true); setPassword(""); setConfirm("");
      setServerErrors([]); setServerError(null);
    }
  }, [open]);

  // pratinjau username otomatis dari nama (bila belum disentuh)
  const [usernameTouched, setUsernameTouched] = useState(false);
  const autoUsername = fullName.trim().toLowerCase().split(/\s+/).slice(0, 2).join(".");
  const effUsername = usernameTouched ? username : autoUsername;

  const localIssues: string[] = [];
  if (!fullName.trim()) localIssues.push(t("Nama lengkap wajib diisi", "Full name is required"));
  if (effUsername.trim().length < 3) localIssues.push(t("Username minimal 3 karakter", "Username must be at least 3 characters"));
  if (!EMAIL_RE.test(email.trim())) localIssues.push(t("Email login wajib diisi dengan format valid", "A valid login email is required"));
  if (password !== confirm) localIssues.push(t("Konfirmasi kata sandi tidak sama", "Password confirmation does not match"));

  const submit = async () => {
    if (busy) return;
    setServerErrors([]); setServerError(null);
    if (localIssues.length > 0) { setServerErrors(localIssues); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/app-users", "POST", {
        username: effUsername.trim(),
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        employeeId: employeeId === "none" ? null : employeeId,
        active,
        password,
      });
      toast.success(t("Pengguna {name} dibuat — akun login {email} siap dipakai", "User {name} created — the login account {email} is ready to use", { name: fullName.trim(), email: email.trim() }));
      onClose(true);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setServerError(err.message);
      setServerErrors(err.details ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose(false); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserRound className="h-4 w-4 ov-text-accent" /> {t("Tambah Pengguna", "Add User")}
          </DialogTitle>
          <DialogDescription>
            {t("Pengguna aplikasi workspace ini + akun login (email & kata sandi awal divalidasi kebijakan kata sandi).", "An application user of this workspace + a login account (email & initial password validated against the password policy).")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Nama Lengkap *", "Full Name *")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t("cth: Dewi Lestari", "e.g. Dewi Lestari")} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Username *</Label>
            <div className="flex items-center gap-1.5">
              <Input
                value={effUsername}
                onChange={(e) => { setUsernameTouched(true); setUsername(e.target.value); }}
                placeholder="dewi.lestari"
                className="font-mono text-xs"
              />
              {usernameTouched && (
                <button
                  type="button"
                  onClick={() => setUsernameTouched(false)}
                  title={t("Kembali ke usulan otomatis dari nama", "Back to the automatic suggestion from the name")}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label={t("Usulkan username otomatis", "Suggest username automatically")}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Email Login *", "Login Email *")}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dewi@mii.co.id" />
            <p className="text-[10px] text-slate-400">{t("Dipakai untuk masuk (account SaaS) — harus belum terdaftar.", "Used to sign in (SaaS account) — must not be registered yet.")}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Role Aplikasi", "Application Role")}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APP_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-xs">{t("Tautkan ke Karyawan (opsional)", "Link to Employee (optional)")}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">{t("— tanpa tautan karyawan —", "— no employee link —")}</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.employeeNo} · {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-slate-400">{t("Pengguna terkait otomatis mengakses data dirinya (tanpa perlu rule).", "A linked user automatically accesses their own data (no rule needed).")}</p>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800 sm:col-span-2">
            <div>
              <p className="text-xs font-bold">{t("Status Aktif", "Active Status")}</p>
              <p className="text-[10px] text-slate-400">{t("Pengguna non-aktif tidak tampil sebagai konfigurasi aktif.", "Inactive users are not shown as an active configuration.")}</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label={t("Status aktif", "Active status")} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("Kata Sandi Awal *", "Initial Password *")}</Label>
            <PasswordInput value={password} onChange={setPassword} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Konfirmasi Kata Sandi *", "Confirm Password *")}</Label>
            <PasswordInput value={confirm} onChange={setConfirm} />
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5 ov-text-accent" /> {t("Validasi Kebijakan Kata Sandi", "Password Policy Validation")}
          </p>
          <PasswordStrengthBar password={password} />
          <PasswordRuleChecklist
            policy={policy}
            password={password}
            username={effUsername || null}
            fullName={fullName || null}
            email={email || null}
            compact
          />
          {password !== confirm && confirm.length > 0 && (
            <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">{t("Konfirmasi kata sandi tidak sama.", "Password confirmation does not match.")}</p>
          )}
        </div>

        {(serverError || serverErrors.length > 0) && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="text-xs font-bold text-rose-700 dark:text-rose-400">{serverError ?? t("Periksa kembali isian:", "Please check the fields again:")}</p>
            {serverErrors.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {serverErrors.map((d, i) => <li key={i} className="text-[11px] text-rose-600 dark:text-rose-400">{d}</li>)}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">
            {busy ? t("Menyimpan…") : t("Buat Pengguna", "Create User")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// DIALOG EDIT PENGGUNA (nama / email / role / tautan karyawan / status)
// =====================================================================

function UserEditDialog({
  user, employees, onClose,
}: {
  user: AppUserRow | null;
  employees: EmployeeOption[];
  onClose: (saved: boolean) => void;
}) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Viewer");
  const [employeeId, setEmployeeId] = useState("none");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");

  const uKey = user?.id ?? "none";
  if (key !== uKey) {
    setKey(uKey);
    setFullName(user?.fullName ?? "");
    setEmail(user?.email ?? "");
    setRole(user?.role ?? "Viewer");
    setEmployeeId(user?.employeeId ?? "none");
    setActive(user?.active ?? true);
    setError(null);
  }

  const submit = async () => {
    if (!user || busy) return;
    if (!fullName.trim()) { setError(t("Nama wajib diisi", "Name is required")); return; }
    setBusy(true); setError(null);
    try {
      await apiSend("/api/onevity/app-users", "PATCH", {
        id: user.id,
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        role,
        employeeId: employeeId === "none" ? null : employeeId,
        active,
      });
      toast.success(t("Pengguna diperbarui", "User updated"));
      onClose(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v && !busy) onClose(false); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{t("Edit Pengguna — {username}", "Edit User — {username}", { username: user?.username ?? "" })}</DialogTitle>
          <DialogDescription>{t("Hak akses menu & data diatur di tab Hak Akses per Pengguna.", "Menu & data access rights are configured in the Access Rights per User tab.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Nama Lengkap")}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Email Login", "Login Email")}</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APP_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Tautan Karyawan", "Employee Link")}</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="none">{t("— tanpa tautan —", "— no link —")}</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.employeeNo} · {e.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
            <div>
              <p className="text-xs font-bold">{t("Status Aktif", "Active Status")}</p>
              <p className="text-[10px] text-slate-400">{user?.active ? t("Pengguna aktif", "Active user") : t("Saat ini non-aktif", "Currently inactive")}</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label={t("Status aktif", "Active status")} />
          </div>
          {error && <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="font-bold">{busy ? t("Menyimpan…") : t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// DIALOG RESET KATA SANDI (admin, per pengguna)
// =====================================================================

function ResetPasswordDialog({
  user, policy, onClose,
}: {
  user: AppUserRow | null;
  policy: PasswordPolicyData;
  onClose: (saved: boolean) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  useEffect(() => {
    if (user) { setPassword(""); setConfirm(""); setServerError(null); setServerErrors([]); }
  }, [user]);

  const submit = async () => {
    if (!user || busy) return;
    setServerError(null); setServerErrors([]);
    if (password !== confirm) { setServerError(t("Konfirmasi kata sandi tidak sama", "Password confirmation does not match")); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/app-users", "PATCH", { id: user.id, password });
      toast.success(t("Kata sandi {name} direset", "Password for {name} reset", { name: user.fullName }));
      onClose(true);
    } catch (e) {
      const err = e as Error & { details?: string[] };
      setServerError(err.message);
      setServerErrors(err.details ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v && !busy) onClose(false); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-amber-600" /> {t("Reset Kata Sandi", "Reset Password")}
          </DialogTitle>
          <DialogDescription>
            {t("Pengguna", "User")} <b>{user?.fullName}</b> ({user?.username}) {t("akan memakai kata sandi baru saat masuk berikutnya.", "will use the new password on their next sign-in.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Kata Sandi Baru *", "New Password *")}</Label>
            <PasswordInput value={password} onChange={setPassword} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("Konfirmasi *", "Confirm *")}</Label>
            <PasswordInput value={confirm} onChange={setConfirm} />
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
              <History className="h-3.5 w-3.5 ov-text-accent" />
              {t("Tidak boleh sama dengan {n} kata sandi terakhir pengguna ini", "Must not match the user's last {n} passwords", { n: policy.historyCount })}
            </p>
            <PasswordStrengthBar password={password} />
            <PasswordRuleChecklist
              policy={policy}
              password={password}
              username={user?.username ?? null}
              fullName={user?.fullName ?? null}
              email={user?.email ?? null}
              compact
            />
          </div>

          {(serverError || serverErrors.length > 0) && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2.5 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="text-xs font-bold text-rose-700 dark:text-rose-400">{serverError ?? t("Periksa kembali:", "Please check again:")}</p>
              {serverErrors.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {serverErrors.map((d, i) => <li key={i} className="text-[11px] text-rose-600 dark:text-rose-400">{d}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)} disabled={busy}>{t("Batal")}</Button>
          <Button onClick={submit} disabled={busy} className="bg-amber-600 font-bold hover:bg-amber-700">{busy ? t("Meriset…", "Resetting…") : t("Reset Kata Sandi", "Reset Password")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================
// PANEL KEBIJAKAN KATA SANDI
// =====================================================================

type PolicyDraft = PasswordPolicyData;

function policyDraftOf(p: PasswordPolicyData): PolicyDraft {
  return { ...p };
}

export function PasswordPolicyPanel() {
  const { t } = useI18n();
  const { data, loading, refresh } = useApi<{ policy: PolicyWithStamp }>("/api/onevity/password-policy");
  const { can } = useSecurityActions();

  const [draft, setDraft] = useState<PolicyDraft>(policyDraftOf(DEFAULT_PASSWORD_POLICY));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPassword, setTestPassword] = useState("");
  const [testUsername, setTestUsername] = useState("");
  const [testName, setTestName] = useState("");
  const [loadKey, setLoadKey] = useState("");

  const policy: PolicyWithStamp = data?.policy ?? DEFAULT_PASSWORD_POLICY;
  const dataKey = data ? String(policy.updatedAt ?? "loaded") : "";
  if (data && loadKey !== dataKey) {
    setLoadKey(dataKey);
    setDraft(policyDraftOf(policy));
    setDirty(false);
  }

  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };

  const crossValid = draft.minLength <= draft.maxLength && (draft.lifetimeDays === 0 || draft.warnDays <= draft.lifetimeDays);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await apiSend("/api/onevity/password-policy", "PUT", draft);
      toast.success(t("Kebijakan kata sandi tersimpan", "Password policy saved"));
      setDirty(false);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !data) return <LoadingRows rows={5} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        {/* ---- seksi 1: kompleksitas ---- */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Gauge className="h-4 w-4 ov-text-accent" /> {t("Kompleksitas & Kombinasi", "Complexity & Combination")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PolicyNumber label={t("Panjang Minimum", "Minimum Length")} value={draft.minLength} onChange={(v) => set("minLength", v)} min={4} max={draft.maxLength} suffix={t("karakter", "characters")} />
              <PolicyNumber label={t("Panjang Maksimum", "Maximum Length")} value={draft.maxLength} onChange={(v) => set("maxLength", v)} min={draft.minLength} max={128} suffix={t("karakter", "characters")} />
              <PolicyNumber label={t("Karakter Unik Minimum", "Minimum Unique Characters")} value={draft.minUniqueChars} onChange={(v) => set("minUniqueChars", v)} min={0} max={32} suffix={t("beda", "distinct")} />
              <PolicyNumber label={t("Maks. Karakter Sama Berturut", "Max. Consecutive Identical Chars")} value={draft.maxRepeated} onChange={(v) => set("maxRepeated", v)} min={0} max={16} suffix={t("kali (aaa)", "times (aaa)")} />
              <PolicyNumber label={t("Maks. Karakter Berurutan", "Max. Sequential Chars")} value={draft.maxSequential} onChange={(v) => set("maxSequential", v)} min={0} max={16} suffix={t("kali (abc)", "times (abc)")} />
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <PolicySwitch label={t("Wajib huruf besar (A–Z)", "Require uppercase letters (A–Z)")} checked={draft.requireUppercase} onChange={(v) => set("requireUppercase", v)} />
              <PolicySwitch label={t("Wajib huruf kecil (a–z)", "Require lowercase letters (a–z)")} checked={draft.requireLowercase} onChange={(v) => set("requireLowercase", v)} />
              <PolicySwitch label={t("Wajib angka (0–9)", "Require digits (0–9)")} checked={draft.requireNumber} onChange={(v) => set("requireNumber", v)} />
              <PolicySwitch label={t("Wajib karakter khusus (!@#$…)", "Require special characters (!@#$…)")} checked={draft.requireSpecial} onChange={(v) => set("requireSpecial", v)} />
              <PolicySwitch label={t("Larang memuat username / email", "Forbid containing the username / email")} checked={draft.blockUsername} onChange={(v) => set("blockUsername", v)} />
              <PolicySwitch label={t("Larang memuat nama pengguna", "Forbid containing the user's name")} checked={draft.blockName} onChange={(v) => set("blockName", v)} />
              <PolicySwitch label={t("Larang kata sandi umum (password, qwerty…)", "Forbid common passwords (password, qwerty…)")} checked={draft.blockCommon} onChange={(v) => set("blockCommon", v)} />
            </div>
          </CardContent>
        </Card>

        {/* ---- seksi 2: umur & riwayat ---- */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <CalendarClock className="h-4 w-4 ov-text-accent" /> {t("Umur & Riwayat", "Age & History")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PolicyNumber label={t("Masa Berlaku (Lifetime)", "Lifetime")} value={draft.lifetimeDays} onChange={(v) => set("lifetimeDays", v)} min={0} max={730} suffix={t("hari (0 = tanpa batas)", "days (0 = no limit)")} />
              <PolicyNumber label={t("Peringatan Sebelum Kedaluwarsa", "Expiry Warning")} value={draft.warnDays} onChange={(v) => set("warnDays", v)} min={0} max={draft.lifetimeDays || 90} suffix={t("hari sebelumnya", "days in advance")} />
              <PolicyNumber label={t("Larangan Riwayat", "History Restriction")} value={draft.historyCount} onChange={(v) => set("historyCount", v)} min={0} max={24} suffix={t("sandi terakhir", "recent passwords")} />
            </div>
            <p className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
              {t("Kata sandi baru tidak boleh sama dengan", "A new password must not match")} <b>{draft.historyCount}</b> {t("sandi terakhir pengguna tersebut; umur sandi dihitung sejak terakhir disetel/direset — tabel Pengguna menampilkan sisa masa berlaku.", "of the user's recent passwords; the password age is counted from the last set/reset — the Users table shows the remaining lifetime.")}
            </p>
          </CardContent>
        </Card>

        {/* ---- seksi 3: lockout ---- */}
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Lock className="h-4 w-4 ov-text-accent" /> {t("Percobaan Login Gagal", "Failed Login Attempts")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <PolicyNumber label={t("Batas Percobaan Gagal", "Failed Attempt Limit")} value={draft.maxFailedAttempts} onChange={(v) => set("maxFailedAttempts", v)} min={0} max={20} suffix={t("kali", "times")} />
              <PolicyNumber label={t("Durasi Kunci Akun", "Account Lock Duration")} value={draft.lockoutMinutes} onChange={(v) => set("lockoutMinutes", v)} min={0} max={720} suffix={t("menit", "minutes")} />
              {/* Task 64k — idle timeout sesi (0 = nonaktif) */}
              <PolicyNumber label={t("Batas Idle Sesi", "Session Idle Timeout")} value={draft.idleTimeoutMinutes} onChange={(v) => set("idleTimeoutMinutes", v)} min={0} max={480} suffix={t("menit (0 = nonaktif)", "minutes (0 = off)")} />
            </div>
            <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
              {t("Melewati batas → akun terkunci sementara (login ditolak sampai waktu habis atau admin mereset sandi).", "Exceeding the limit → the account is temporarily locked (sign-in denied until the time expires or an admin resets the password).")}
            </p>
          </CardContent>
        </Card>

        {/* aksi simpan */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={save}
            disabled={!dirty || saving || !crossValid || !can("update")}
            title={!can("update") ? t("Anda tidak memiliki aksi Ubah pada menu ini", "You do not have the Update action on this menu") : undefined}
            className="gap-2 font-bold"
          >
            <Save className="h-4 w-4" /> {saving ? t("Menyimpan…") : dirty ? t("Simpan Kebijakan", "Save Policy") : t("Tersimpan", "Saved")}
          </Button>
          <Button
            variant="outline"
            onClick={() => { setDraft(policyDraftOf(DEFAULT_PASSWORD_POLICY)); setDirty(true); }}
            disabled={!can("update")}
            className="gap-2 font-semibold"
          >
            <RotateCcw className="h-4 w-4" /> {t("Kembalikan Default", "Restore Default")}
          </Button>
          {!crossValid && <p className="text-xs font-semibold text-rose-600">{t("Periksa kembali rentang nilai (min ≤ maks, peringatan ≤ masa berlaku).", "Please check the value ranges (min ≤ max, warning ≤ lifetime).")}</p>}
        </div>
      </div>

      {/* ---- kolom kanan: uji coba + penerapan ---- */}
      <div className="space-y-4">
        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <FlaskConical className="h-4 w-4 ov-text-accent" /> {t("Uji Coba Sandi", "Password Test")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {t("Coba sebuah kata sandi terhadap", "Try a password against")} <b>{t("draft kebijakan", "the policy draft")}</b> {t("saat ini (belum tersimpan bila ada perubahan).", "(unsaved if there are changes).")}
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Nama pengguna (uji aturan nama)", "User name (tests the name rule)")}</Label>
              <Input value={testName} onChange={(e) => setTestName(e.target.value)} placeholder={t("cth: Dewi Lestari", "e.g. Dewi Lestari")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Username (uji aturan username)", "Username (tests the username rule)")}</Label>
              <Input value={testUsername} onChange={(e) => setTestUsername(e.target.value)} placeholder={t("cth: dewi.lestari", "e.g. dewi.lestari")} className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("Kata Sandi")}</Label>
              <PasswordInput value={testPassword} onChange={setTestPassword} />
            </div>
            <PasswordStrengthBar password={testPassword} />
            <PasswordRuleChecklist
              policy={draft}
              password={testPassword}
              username={testUsername || null}
              fullName={testName || null}
            />
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-bold">
              <Eye className="h-4 w-4 ov-text-accent" /> {t("Penerapan", "How It Is Applied")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              <li>• <b>{t("Tambah pengguna", "Add user")}</b> {t("— kata sandi awal divalidasi seluruh aturan di atas.", "— the initial password is validated against all the rules above.")}</li>
              <li>• <b>{t("Reset kata sandi", "Reset password")}</b> {t("(admin) &", "(admin) &")} <b>{t("ganti kata sandi", "change password")}</b> {t("(pengguna sendiri) — aturan + riwayat N terakhir.", "(the user themself) — rules + the last N passwords.")}</li>
              <li>• <b>{t("Umur", "Age")}</b> {t("— sisa masa berlaku tampil di tabel Pengguna & peringatan saat masuk.", "— the remaining lifetime shows in the Users table & a warning at sign-in.")}</li>
              <li>• <b>{t("Lockout", "Lockout")}</b> {t("— diterapkan saat login (policy workspace pertama pengguna).", "— applied at sign-in (the user's first workspace policy).")}</li>
              <li>• <b>{t("Registrasi workspace baru", "New workspace registration")}</b> {t("— memakai kebijakan default.", "— uses the default policy.")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- kontrol kecil kebijakan ----------

function PolicyNumber({
  label, value, onChange, min, max, suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] leading-tight">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min);
        }}
        className="h-9 text-xs font-semibold"
      />
      {suffix && <p className="text-[10px] text-slate-400">{suffix}</p>}
    </div>
  );
}

function PolicySwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:ov-border-accent dark:border-slate-800">
      <span className="text-xs font-semibold leading-tight">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

// =====================================================================
// KARTU AUTENTIKASI DUA FAKTOR (T17-MFA)
// =====================================================================
// Self-service akun login SENDIRI (platform User — email sesi sekarang),
// bukan manajemen AppUser tenant. Alur: tombol "Aktifkan" → POST setup
// (secret baru + QR) → dialog pindai/masukkan manual → input kode 6 digit
// → POST enable → aktif. Disable wajib kata sandi. API:
// /api/auth/mfa/{setup GET+POST, enable, disable, verify} (auth-mfa.ts).

interface MfaStatusData { enabled: boolean; pending?: boolean }
interface MfaSetupData { secret: string; otpauthUrl: string; qrDataUrl: string }

export function MfaCard() {
  const { t } = useI18n();
  const email = useSession((s) => s.info?.user.email);
  const { data, loading, refresh } = useApi<MfaStatusData>("/api/auth/mfa/setup");

  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [setup, setSetup] = useState<MfaSetupData | null>(null);
  const [prepBusy, setPrepBusy] = useState(false);

  const enabled = data?.enabled === true;

  // Klik "Aktifkan" → generate secret SEBELUM dialog dibuka (regenerasi tiap
  // kali — secret lama yang belum diverifikasi ditimpa).
  const startSetup = async () => {
    setPrepBusy(true);
    try {
      const d = await apiSend<MfaSetupData>("/api/auth/mfa/setup", "POST");
      setSetup(d);
      setSetupOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPrepBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-bold">
          <Smartphone className="h-4 w-4 ov-text-accent" aria-hidden />
          {t("Autentikasi Dua Faktor", "Two-Factor Authentication")}
        </CardTitle>
        {loading && !data ? (
          <Badge variant="secondary" className="text-[10px]">…</Badge>
        ) : (
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] font-bold",
              enabled
                ? "border-brand/25 bg-brand/10 text-brand-deep dark:border-brand/25 dark:bg-brand/10 dark:text-brand/85"
                : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
            )}
          >
            {enabled ? t("Aktif", "Active") : t("Nonaktif", "Inactive")}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
          {t(
            "Lapisan kedua saat masuk: setelah kata sandi benar, masukkan kode 6 digit dari aplikasi autentikator (Google Authenticator, Authy, Microsoft Authenticator) yang berganti setiap 30 detik.",
            "A second layer at sign-in: after your password, enter a 6-digit code from an authenticator app (Google Authenticator, Authy, Microsoft Authenticator) that rotates every 30 seconds.",
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {enabled ? (
            <Button variant="outline" onClick={() => setDisableOpen(true)} className="gap-2 font-semibold">
              <ShieldOff className="h-4 w-4" aria-hidden />
              {t("Nonaktifkan…", "Disable…")}
            </Button>
          ) : (
            <Button onClick={() => void startSetup()} disabled={prepBusy} className="gap-2 font-bold">
              <Smartphone className="h-4 w-4" aria-hidden />
              {prepBusy ? t("Menyiapkan QR…", "Preparing QR…") : t("Aktifkan Sekarang", "Activate Now")}
            </Button>
          )}
          {email && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">
              {t("Berlaku untuk akun login Anda: {email}", "Applies to your login account: {email}", { email })}
            </span>
          )}
        </div>
        {enabled && (
          <p className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400">
            {t(
              "Saat masuk berikutnya Anda akan ditanya kode verifikasi setelah kata sandi. Pastikan aplikasi autentikator terpasang di ponsel Anda.",
              "On your next sign-in you will be asked for a verification code after your password. Keep the authenticator app installed on your phone.",
            )}
          </p>
        )}
      </CardContent>

      <MfaSetupDialog
        open={setupOpen}
        setOpen={(v) => { setSetupOpen(v); if (!v) refresh(); }}
        setup={setup}
        onDone={() => { setSetupOpen(false); refresh(); }}
      />
      <MfaDisableDialog
        open={disableOpen}
        setOpen={(v) => { setDisableOpen(v); if (!v) refresh(); }}
        onDone={() => { setDisableOpen(false); refresh(); }}
      />
    </Card>
  );
}

// ---------- dialog setup: QR + secret + kode verifikasi ----------

function MfaSetupDialog({
  open, setOpen, setup, onDone,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  setup: MfaSetupData | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // reset saat dialog ditutup/dibuka ulang (state render-time, tanpa effect)
  const [openMark, setOpenMark] = useState(false);
  if (open !== openMark) {
    setOpenMark(open);
    setCode("");
    setErr(null);
    setCopied(false);
  }

  const copySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("Gagal menyalin — salin manual dari teks di atas.", "Copy failed — copy the text above manually."));
    }
  };

  const confirmEnable = async (value: string) => {
    if (busy) return;
    if (!/^\d{6}$/.test(value)) {
      setErr(t("Masukkan kode 6 digit dari aplikasi autentikator Anda.", "Enter the 6-digit code from your authenticator app."));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/auth/mfa/enable", "POST", { token: value });
      toast.success(t("Autentikasi dua faktor aktif.", "Two-factor authentication is now active."));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {t("Siapkan Autentikasi Dua Faktor", "Set Up Two-Factor Authentication")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Pindai QR dengan aplikasi autentikator, atau masukkan secret manual. Lalu masukkan kode 6 digit untuk mengaktifkan.",
              "Scan the QR with an authenticator app, or enter the secret manually. Then enter the 6-digit code to activate.",
            )}
          </DialogDescription>
        </DialogHeader>

        {setup ? (
          <div className="space-y-4">
            <div className="flex justify-center rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              {/* QR data URL dari server (package qrcode) — aman, tanpa layanan luar */}
              <img src={setup.qrDataUrl} alt={t("QR kode secret TOTP", "TOTP secret QR code")} width={200} height={200} className="h-[200px] w-[200px]" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px]">{t("Secret manual (base32)", "Manual secret (base32)")}</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-mono text-[11px] tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  {setup.secret}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={() => void copySecret()} className="gap-1.5 px-2.5">
                  {copied ? <Check className="h-3.5 w-3.5 text-brand" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copied ? t("Tersalin") : t("Salin")}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px]">{t("Kode verifikasi 6 digit", "6-digit verification code")}</Label>
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(v) => { setCode(v); if (err) setErr(null); }}
                onComplete={(v) => { void confirmEnable(v); }}
                disabled={busy}
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="^\d+$"
                aria-label={t("Kode verifikasi 6 digit", "6-digit verification code")}
                containerClassName="justify-start"
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} className="h-10 w-10 text-[15px] font-semibold" />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            {err && <p className="text-[12px] font-medium text-rose-600 dark:text-rose-400">{err}</p>}
          </div>
        ) : (
          <p className="text-[13px] text-slate-500">{t("Menyiapkan secret…", "Preparing secret…")}</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {t("Batal")}
          </Button>
          <Button onClick={() => void confirmEnable(code)} disabled={busy || !setup} className="gap-2 font-bold">
            {busy ? t("Memverifikasi…", "Verifying…") : t("Aktifkan", "Activate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- dialog disable: wajib kata sandi ----------

function MfaDisableDialog({
  open, setOpen, onDone,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [openMark, setOpenMark] = useState(false);
  if (open !== openMark) {
    setOpenMark(open);
    setPassword("");
    setErr(null);
  }

  const confirmDisable = async () => {
    if (busy) return;
    if (!password) {
      setErr(t("Kata sandi wajib diisi untuk menonaktifkan.", "Password is required to disable."));
      return;
    }
    setBusy(true);
    try {
      await apiSend("/api/auth/mfa/disable", "POST", { password });
      toast.success(t("Autentikasi dua faktor dinonaktifkan — login kembali 1 langkah.", "Two-factor authentication disabled — sign-in is single-step again."));
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{t("Nonaktifkan Dua Faktor?", "Disable Two-Factor?")}</DialogTitle>
          <DialogDescription>
            {t(
              "Masuk kembali hanya perlu kata sandi. Masukkan kata sandi Anda untuk konfirmasi.",
              "Signing in will only require your password. Enter your password to confirm.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className="text-[11px]">{t("Kata Sandi Anda", "Your Password")}</Label>
          <PasswordInput
            value={password}
            onChange={(v) => { setPassword(v); if (err) setErr(null); }}
            placeholder="••••••••"
            autoComplete="current-password"
          />
          {err && <p className="text-[12px] font-medium text-rose-600 dark:text-rose-400">{err}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            {t("Batal")}
          </Button>
          <Button variant="destructive" onClick={() => void confirmDisable()} disabled={busy} className="font-bold">
            {busy ? t("Memproses…", "Processing…") : t("Nonaktifkan MFA", "Disable MFA")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
