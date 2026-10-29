"use client";
// OneVity AuthScreen — gerbang SaaS multi-tenant.
// Split-panel: kiri brand obsidian + aksen emerald (sm ke atas, hidden mobile),
// kanan Card berisi Tabs "Masuk" | "Buat Workspace" (login / registrasi + provisioning tenant).
import { useState, type ChangeEvent, type ElementType, type FormEvent } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Calculator, Database, Loader2, Users, Waypoints } from "lucide-react";
import { useSession } from "@/lib/onevity/session-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthTab = "login" | "register";
type FieldId = "login-email" | "login-password" | "reg-workspace" | "reg-name" | "reg-email" | "reg-password";

interface Validity {
  message: string | null;
  fields: FieldId[];
}

function validateLogin(email: string, password: string): Validity {
  if (!email) return { message: "Email wajib diisi.", fields: ["login-email"] };
  if (!EMAIL_RE.test(email)) return { message: "Format email tidak valid.", fields: ["login-email"] };
  if (!password) return { message: "Kata sandi wajib diisi.", fields: ["login-password"] };
  return { message: null, fields: [] };
}

function validateRegister(workspaceName: string, fullName: string, email: string, password: string): Validity {
  if (!workspaceName) return { message: "Nama workspace wajib diisi.", fields: ["reg-workspace"] };
  if (!fullName) return { message: "Nama lengkap wajib diisi.", fields: ["reg-name"] };
  if (!email) return { message: "Email wajib diisi.", fields: ["reg-email"] };
  if (!EMAIL_RE.test(email)) return { message: "Format email tidak valid.", fields: ["reg-email"] };
  if (password.length < 8) return { message: "Kata sandi minimal 8 karakter.", fields: ["reg-password"] };
  return { message: null, fields: [] };
}

const BRAND_FEATURES: { icon: ElementType; title: string; desc: string }[] = [
  { icon: Database, title: "Database terpisah per tenant", desc: "Isolasi data penuh antar perusahaan" },
  { icon: Calculator, title: "Payroll Indonesia PPh21/BPJS", desc: "Pajak progresif, TER, jurnal & SPT 1721-A1" },
  { icon: Users, title: "Modul HR lengkap", desc: "Organisasi, karyawan, pengajuan & benefit" },
];

function FormError({ id, message }: { id: string; message: string }) {
  return (
    <div
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm font-medium text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function AuthScreen() {
  const { busy, error, login, register, clearError } = useSession();

  const [tab, setTab] = useState<AuthTab>("login");
  const [formError, setFormError] = useState<string | null>(null);
  const [invalidFields, setInvalidFields] = useState<FieldId[]>([]);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [fullName, setFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const shownError = formError ?? error;

  const switchTab = (next: AuthTab) => {
    setTab(next);
    setFormError(null);
    setInvalidFields([]);
    if (error) clearError();
  };

  const update = (fieldId: FieldId, setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    if (formError) setFormError(null);
    if (invalidFields.length) setInvalidFields((prev) => prev.filter((f) => f !== fieldId));
  };

  const isInvalid = (fieldId: FieldId) => (invalidFields.includes(fieldId) ? true : undefined);
  const describedBy = (fieldId: FieldId, errorId: string) => (invalidFields.includes(fieldId) ? errorId : undefined);

  const submitLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const email = loginEmail.trim();
    const v = validateLogin(email, loginPassword);
    setFormError(v.message);
    setInvalidFields(v.fields);
    if (v.message) return;
    await login(email, loginPassword);
  };

  const submitRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const v = validateRegister(workspaceName.trim(), fullName.trim(), regEmail.trim(), regPassword);
    setFormError(v.message);
    setInvalidFields(v.fields);
    if (v.message) return;
    await register({
      workspaceName: workspaceName.trim(),
      fullName: fullName.trim(),
      email: regEmail.trim(),
      password: regPassword,
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-2">
        {/* Panel kiri — brand OneVity (hidden di mobile) */}
        <div className="relative hidden flex-col overflow-hidden bg-slate-950 p-10 text-slate-300 sm:flex xl:p-14">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[image:radial-gradient(ellipse_70%_55%_at_75%_0%,rgba(16,185,129,0.14),transparent_60%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[image:linear-gradient(to_right,rgba(214,211,209,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(214,211,209,0.05)_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:radial-gradient(ellipse_60%_60%_at_30%_20%,black,transparent_75%)]"
          />

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="relative z-10 flex h-full flex-col justify-between gap-10"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-950/60">
                <Waypoints className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight text-slate-50">
                  One<span className="text-emerald-400">Vity</span>
                </p>
                <p className="text-[11px] uppercase tracking-widest text-slate-500">HR Suite</p>
              </div>
            </div>

            <div className="max-w-md">
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
              >
                SaaS Multi-Tenant
              </Badge>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-slate-50 xl:text-4xl">OneVity HR Suite</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-400 xl:text-base">
                HRIS multi-tenant — satu platform, tiap perusahaan punya data terisolasi.
              </p>
              <ul className="mt-9 space-y-4">
                {BRAND_FEATURES.map((f) => (
                  <li key={f.title} className="flex items-start gap-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                      <f.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-200">{f.title}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{f.desc}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-[11px] text-slate-600">© 2026 OneVity — HRIS multi-tenant SaaS</p>
          </motion.div>
        </div>

        {/* Panel kanan — kartu masuk / buat workspace */}
        <div className="flex items-center justify-center px-4 py-10 sm:px-8">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="w-full max-w-md"
          >
            <Card className="border-slate-200 shadow-lg shadow-slate-200/60 dark:border-slate-800 dark:shadow-none">
              <CardHeader>
                <div className="mb-2 flex items-center gap-2.5 sm:hidden">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md">
                    <Waypoints className="h-5 w-5" />
                  </div>
                  <p className="text-base font-bold tracking-tight">
                    One<span className="text-emerald-600 dark:text-emerald-400">Vity</span>
                  </p>
                </div>
                <CardTitle className="text-xl">Selamat datang</CardTitle>
                <CardDescription>
                  Masuk untuk melanjutkan ke workspace Anda, atau buat workspace baru untuk perusahaan Anda.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs value={tab} onValueChange={(v) => switchTab(v as AuthTab)}>
                  <TabsList className="w-full">
                    <TabsTrigger value="login">Masuk</TabsTrigger>
                    <TabsTrigger value="register">Buat Workspace</TabsTrigger>
                  </TabsList>

                  {/* ============ Tab Masuk ============ */}
                  <TabsContent value="login" className="mt-4">
                    <form className="space-y-4" noValidate onSubmit={submitLogin}>
                      <div className="space-y-2">
                        <Label htmlFor="login-email">Email</Label>
                        <Input
                          id="login-email"
                          type="email"
                          autoComplete="email"
                          autoFocus
                          placeholder="nama@perusahaan.id"
                          value={loginEmail}
                          onChange={update("login-email", setLoginEmail)}
                          disabled={busy}
                          aria-invalid={isInvalid("login-email")}
                          aria-describedby={describedBy("login-email", "login-error")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="login-password">Kata Sandi</Label>
                        <Input
                          id="login-password"
                          type="password"
                          autoComplete="current-password"
                          placeholder="••••••••"
                          value={loginPassword}
                          onChange={update("login-password", setLoginPassword)}
                          disabled={busy}
                          aria-invalid={isInvalid("login-password")}
                          aria-describedby={describedBy("login-password", "login-error")}
                        />
                      </div>

                      {shownError && <FormError id="login-error" message={shownError} />}

                      <Button
                        type="submit"
                        disabled={busy}
                        className="w-full bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        {busy ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Memeriksa…
                          </>
                        ) : (
                          "Masuk"
                        )}
                      </Button>

                      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                        Belum punya akun?{" "}
                        <button
                          type="button"
                          onClick={() => switchTab("register")}
                          className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          Buat workspace
                        </button>
                      </p>
                    </form>
                  </TabsContent>

                  {/* ============ Tab Buat Workspace ============ */}
                  <TabsContent value="register" className="mt-4">
                    <form className="space-y-4" noValidate onSubmit={submitRegister}>
                      <div className="space-y-2">
                        <Label htmlFor="reg-workspace">Nama Workspace</Label>
                        <Input
                          id="reg-workspace"
                          autoComplete="organization"
                          placeholder="PT Nusantara Sejahtera"
                          value={workspaceName}
                          onChange={update("reg-workspace", setWorkspaceName)}
                          disabled={busy}
                          aria-invalid={isInvalid("reg-workspace")}
                          aria-describedby={describedBy("reg-workspace", "register-error")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-name">Nama Lengkap</Label>
                        <Input
                          id="reg-name"
                          autoComplete="name"
                          placeholder="Budi Santoso"
                          value={fullName}
                          onChange={update("reg-name", setFullName)}
                          disabled={busy}
                          aria-invalid={isInvalid("reg-name")}
                          aria-describedby={describedBy("reg-name", "register-error")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-email">Email</Label>
                        <Input
                          id="reg-email"
                          type="email"
                          autoComplete="email"
                          placeholder="nama@perusahaan.id"
                          value={regEmail}
                          onChange={update("reg-email", setRegEmail)}
                          disabled={busy}
                          aria-invalid={isInvalid("reg-email")}
                          aria-describedby={describedBy("reg-email", "register-error")}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-password">Kata Sandi</Label>
                        <Input
                          id="reg-password"
                          type="password"
                          autoComplete="new-password"
                          placeholder="••••••••"
                          value={regPassword}
                          onChange={update("reg-password", setRegPassword)}
                          disabled={busy}
                          aria-invalid={isInvalid("reg-password")}
                          aria-describedby={describedBy("reg-password", "register-error")}
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400">Minimal 8 karakter.</p>
                      </div>

                      {shownError && <FormError id="register-error" message={shownError} />}

                      <Button
                        type="submit"
                        disabled={busy}
                        className="w-full bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        {busy ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Menyiapkan workspace…
                          </>
                        ) : (
                          "Buat Workspace"
                        )}
                      </Button>
                      {busy && (
                        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                          Provisioning database tenant ± beberapa detik.
                        </p>
                      )}

                      <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                        Sudah punya akun?{" "}
                        <button
                          type="button"
                          onClick={() => switchTab("login")}
                          className="font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          Masuk
                        </button>
                      </p>
                    </form>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
