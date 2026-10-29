"use client";
// OneVity — Modul Pengaturan: master data lookup, security & akses, approval engine
import { useState } from "react";
import { useApi, apiSend, fmtDate, initials } from "@/lib/onevity/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/components/onevity/ui-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  Layers, ShieldCheck, CheckCircle2, Plus, Pencil, Trash2, Eye, EyeOff, UserCog, Users,
  ArrowRight, Clock, Calendar, Zap, Settings2, Lock, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsModule({ view }: { view: string }) {
  if (view === "security") return <SecurityPage />;
  if (view === "approval") return <ApprovalEnginePage />;
  return <LookupPage />;
}

// ================= LOOKUPS =================
interface LookupItem { id: string; category: string; code: string; label: string; sortOrder: number; active: boolean }

function LookupPage() {
  const { data, loading, refresh } = useApi<{ lookups: LookupItem[]; grouped: Record<string, LookupItem[]> }>("/api/onevity/lookups");
  const [category, setCategory] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<LookupItem | null>(null);

  const categories = Object.keys(data?.grouped ?? {});
  const current = category ?? categories[0] ?? "";
  const items = data?.grouped[current] ?? [];

  const toggle = async (l: LookupItem) => {
    try {
      await apiSend("/api/onevity/lookups", "PATCH", { id: l.id, active: !l.active });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  const remove = async (l: LookupItem) => {
    try {
      await apiSend(`/api/onevity/lookups?id=${l.id}`, "DELETE");
      toast.success("Entri dihapus");
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow="PENGATURAN"
        title="Data Master"
        description={`${data?.lookups.length ?? 0} entri lookup di ${categories.length} kategori — agama, status, pendidikan, shift, dan lainnya`}
        actions={
          <Button onClick={() => setAddOpen(true)} className="gap-2 bg-emerald-600 font-bold hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Entri Baru
          </Button>
        }
      />
      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* categories */}
          <Card className="h-fit rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><Layers className="h-4 w-4 text-emerald-600" /> Kategori</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {categories.map((c) => {
                const catItems = data?.grouped[c] ?? [];
                const inactive = catItems.filter((i) => !i.active).length;
                return (
                  <button key={c} onClick={() => setCategory(c)} className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition",
                    c === current ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  )}>
                    <span className="flex-1 truncate">{c}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-extrabold", c === current ? "bg-white/20" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500")}>
                      {catItems.length}
                    </span>
                    {inactive > 0 && c === current && <span className="ml-1 text-[9px] opacity-75">{inactive} off</span>}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* entries */}
          <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold">Entri: {current}</CardTitle>
              <Badge variant="secondary" className="font-mono text-[10px]">{items.length} item</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                      <TableHead className="text-[11px] font-bold">Label</TableHead>
                      <TableHead className="text-[11px] font-bold">Kode</TableHead>
                      <TableHead className="text-[11px] font-bold">Urutan</TableHead>
                      <TableHead className="text-[11px] font-bold">Aktif</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((l) => (
                      <TableRow key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <TableCell className={cn("text-[13px] font-semibold", !l.active && "text-slate-400 line-through")}>{l.label}</TableCell>
                        <TableCell className="font-mono text-[10px] text-slate-400">{l.code}</TableCell>
                        <TableCell className="text-xs text-slate-500">{l.sortOrder}</TableCell>
                        <TableCell><Switch checked={l.active} onCheckedChange={() => toggle(l)} aria-label={`Toggle ${l.label}`} /></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <button onClick={() => setEditing(l)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => remove(l)} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label="Hapus">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <LookupDialog open={addOpen} setOpen={(v) => { setAddOpen(v); if (!v) refresh(); }} category={current} item={null} />
      <LookupDialog open={!!editing} setOpen={(v) => { if (!v) { setEditing(null); refresh(); } }} category={current} item={editing} />
    </div>
  );
}

function LookupDialog({ open, setOpen, category, item }: { open: boolean; setOpen: (v: boolean) => void; category: string; item: LookupItem | null }) {
  const [label, setLabel] = useState(item?.label ?? "");
  const [key, setKey] = useState("");
  const itemKey = item?.id ?? "new";
  if (key !== itemKey) { setKey(itemKey); setLabel(item?.label ?? ""); }

  const submit = async () => {
    if (!label.trim()) { toast.error("Label wajib diisi"); return; }
    try {
      if (item) {
        await apiSend("/api/onevity/lookups", "PATCH", { id: item.id, label });
        toast.success("Entri diperbarui");
      } else {
        await apiSend("/api/onevity/lookups", "POST", { category, label });
        toast.success("Entri ditambahkan");
      }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{item ? "Edit Entri" : "Entri Baru"} — {category}</DialogTitle></DialogHeader>
        <div>
          <Label className="text-xs">Label *</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1.5" placeholder="cth: Buddha" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Batal</Button>
          <Button onClick={submit} className="bg-emerald-600 font-bold hover:bg-emerald-700">Simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= SECURITY =================
interface AppUserData {
  users: { id: string; username: string; fullName: string; email: string | null; role: string; active: boolean; lastLogin: string | null; groups: { name: string; code: string }[] }[];
  groups: { id: string; code: string; name: string; description: string | null; modules: { module: string; view: boolean; create: boolean; edit: boolean; delete: boolean; approve: boolean }[]; members: { id: string; fullName: string; role: string; isApprover: boolean }[] }[];
}

function SecurityPage() {
  const { data, loading, refresh } = useApi<AppUserData>("/api/onevity/app-users");
  const [tab, setTab] = useState("users");
  const [userDialog, setUserDialog] = useState<{ open: boolean; user: AppUserData["users"][number] | null }>({ open: false, user: null });

  const roleTone: Record<string, string> = {
    Admin: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
    "HR Manager": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400",
    Approver: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
    Viewer: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
  };

  return (
    <div>
      <PageHeader
        eyebrow="PENGATURAN"
        title="Keamanan & Akses"
        description="Pengguna aplikasi, kelompok akses modul, dan matriks permission"
      />
      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-900">
            <TabsTrigger value="users" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <UserCog className="h-3.5 w-3.5" /> Pengguna ({data?.users.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="groups" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Users className="h-3.5 w-3.5" /> Access Group ({data?.groups.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="scheme" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Lock className="h-3.5 w-3.5" /> Data Scheme
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/80 dark:bg-slate-900/50">
                        <TableHead className="text-[11px] font-bold">Pengguna</TableHead>
                        <TableHead className="text-[11px] font-bold">Username</TableHead>
                        <TableHead className="text-[11px] font-bold">Role</TableHead>
                        <TableHead className="text-[11px] font-bold">Access Group</TableHead>
                        <TableHead className="text-[11px] font-bold">Login Terakhir</TableHead>
                        <TableHead className="text-[11px] font-bold">Status</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.users ?? []).map((u) => (
                        <TableRow key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-extrabold", "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400")}>{initials(u.fullName)}</span>
                              <div>
                                <p className="text-[13px] font-bold">{u.fullName}</p>
                                <p className="text-[10px] text-slate-400">{u.email ?? "—"}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] font-bold text-slate-500">{u.username}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px] font-bold", roleTone[u.role] ?? "")}>{u.role}</Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {u.groups.length > 0 ? u.groups.map((g) => <Badge key={g.code} variant="secondary" className="text-[9px]">{g.name}</Badge>) : <span className="text-[10px] text-slate-400">—</span>}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-slate-500">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "Belum pernah"}</TableCell>
                          <TableCell><StatusPill status={u.active ? "Active" : "Cancelled"} /></TableCell>
                          <TableCell>
                            <button onClick={() => setUserDialog({ open: true, user: u })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Edit user">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="groups">
            <div className="grid gap-4 lg:grid-cols-2">
              {(data?.groups ?? []).map((g) => (
                <Card key={g.id} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md">
                          <ShieldCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[14px] font-bold">{g.name}</p>
                          <p className="font-mono text-[10px] text-slate-400">{g.code}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{g.members.length} anggota</Badge>
                    </div>
                    {g.description && <p className="mt-2 text-[11px] text-slate-500">{g.description}</p>}

                    {/* permission matrix */}
                    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="bg-slate-50/80 dark:bg-slate-900/50">
                            <th className="px-2.5 py-2 text-left font-bold uppercase text-slate-400">Modul</th>
                            {["Lihat", "Buat", "Edit", "Hapus", "Approve"].map((h) => <th key={h} className="px-1.5 py-2 text-center font-bold uppercase text-slate-400">{h}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {g.modules.map((m) => (
                            <tr key={m.module} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-2.5 py-2 font-bold">{m.module}</td>
                              {[m.view, m.create, m.edit, m.delete, m.approve].map((ok, i) => (
                                <td key={i} className="px-1.5 py-2 text-center">
                                  {ok ? <Eye className="mx-auto h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> : <EyeOff className="mx-auto h-3.5 w-3.5 text-slate-200 dark:text-slate-700" />}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* members */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {g.members.map((m) => (
                        <span key={m.id} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold",
                          m.isApprover ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400" : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400")}>
                          {m.fullName}
                          {m.isApprover && <CheckCircle2 className="h-3 w-3" />}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="scheme">
            <Card className="rounded-2xl border-dashed border-slate-300 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/30">
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Data Access Scheme (Ilustrasi)</p>
                    <p className="text-[11px] text-slate-400">Aturan akses data berbasis struktur organisasi — seperti Scheme Setup OranHR</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2.5">
                  {[
                    "HR Administrator → akses SEMUA data karyawan semua perusahaan",
                    "Dept Head → akses karyawan di unit & sub-unit-nya saja",
                    "Approver → akses dokumen PA yang dia approve + data karyawan terkait",
                    "Viewer → read-only direktori tanpa data sensitif (gaji, NIK, rekening)",
                  ].map((rule, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-extrabold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">{i + 1}</span>
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{rule}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      <UserDialog open={userDialog.open} user={userDialog.user} groups={data?.groups ?? []} onClose={() => { setUserDialog({ open: false, user: null }); refresh(); }} />
    </div>
  );
}

function UserDialog({ open, user, groups, onClose }: { open: boolean; user: AppUserData["users"][number] | null; groups: AppUserData["groups"]; onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Viewer");
  const [accessGroupId, setAccessGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const uKey = user?.id ?? "none";
  if (key !== uKey) {
    setKey(uKey);
    setFullName(user?.fullName ?? ""); setEmail(user?.email ?? "");
    setRole(user?.role ?? "Viewer"); setAccessGroupId(user?.groups[0] ? groups.find((g) => g.name === user.groups[0].name)?.id ?? "" : "");
  }

  const submit = async () => {
    if (!fullName.trim()) { toast.error("Nama wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/app-users", "PATCH", { id: user!.id, fullName, email, role, accessGroupId: accessGroupId || "" });
      toast.success("User diperbarui");
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (!user) return null;
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="text-base">Edit User — {user.username}</DialogTitle></DialogHeader>
        <div className="space-y-3.5">
          <div>
            <Label className="text-xs">Nama Lengkap</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label className="text-xs">Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Admin", "HR Manager", "HR Staff", "Approver", "Viewer"].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Access Group</Label>
            <Select value={accessGroupId || "none"} onValueChange={(v) => setAccessGroupId(v === "none" ? "" : v)}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pilih grup" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Tanpa grup —</SelectItem>
                {groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= APPROVAL ENGINE =================
interface ApprovalData {
  templates: { id: string; code: string; name: string; docType: string; layers: { layer: number; role: string }[]; autoApprove: boolean; active: boolean }[];
  delegations: { id: string; docType: string; validFrom: string; validTo: string; reason: string | null; active: boolean; approver: { id: string; fullName: string; role: string }; delegate: { id: string; fullName: string; role: string }; state: string }[];
}

function ApprovalEnginePage() {
  const { data, loading, refresh } = useApi<ApprovalData>("/api/onevity/approval-templates");
  const [tab, setTab] = useState("templates");

  return (
    <div>
      <PageHeader
        eyebrow="PENGATURAN"
        title="Template Approval"
        description="Template alur approval multi-layer dan delegasi approver sementara"
      />
      {loading && !data ? (
        <LoadingRows rows={4} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-2xl bg-slate-100 p-1.5 dark:bg-slate-900">
            <TabsTrigger value="templates" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Settings2 className="h-3.5 w-3.5" /> Template ({data?.templates.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="delegations" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-slate-800 dark:data-[state=active]:text-emerald-400">
              <Clock className="h-3.5 w-3.5" /> Temporary Approver ({data?.delegations.length ?? 0})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates">
            <div className="grid gap-4 lg:grid-cols-2">
              {(data?.templates ?? []).map((t) => (
                <Card key={t.id} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md">
                          <Zap className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-[14px] font-bold">{t.name}</p>
                          <p className="font-mono text-[10px] text-slate-400">{t.code} · {t.docType}</p>
                        </div>
                      </div>
                      {t.autoApprove && (
                        <Badge className="gap-1 bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400">
                          <Zap className="h-3 w-3" /> Auto-approve
                        </Badge>
                      )}
                    </div>
                    {/* layer flow */}
                    <div className="mt-4 flex items-center">
                      {t.layers.map((l, i) => (
                        <div key={l.layer} className={cn("flex items-center", i < t.layers.length - 1 && "flex-1")}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-extrabold text-emerald-700 ring-2 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/30">
                              {l.layer}
                            </span>
                            <span className="whitespace-nowrap text-[9.5px] font-bold text-slate-500">{l.role}</span>
                          </div>
                          {i < t.layers.length - 1 && <ArrowRight className="mx-2 h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="delegations">
            <div className="grid gap-4 lg:grid-cols-2">
              {(data?.delegations ?? []).map((d) => (
                <Card key={d.id} className="rounded-2xl border-slate-200/80 shadow-sm dark:border-slate-800">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[10px]">{d.docType}</Badge>
                      <Badge variant="outline" className={cn("text-[10px] font-bold",
                        d.state === "Aktif" ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400" :
                        d.state === "Akan Datang" ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400" :
                        "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500")}>
                        {d.state}
                      </Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="min-w-0 text-right">
                        <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">{d.approver.fullName}</p>
                        <p className="text-[9px] text-slate-400">Approver asli</p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-emerald-700 dark:text-emerald-400">{d.delegate.fullName}</p>
                        <p className="text-[9px] text-slate-400">Delegasi sementara</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-dashed border-slate-100 pt-3 text-[11px] text-slate-500 dark:border-slate-800">
                      <Calendar className="h-3.5 w-3.5" />
                      {fmtDate(d.validFrom)} — {fmtDate(d.validTo)}
                    </div>
                    {d.reason && <p className="mt-1.5 text-[11px] italic text-slate-400">"{d.reason}"</p>}
                  </CardContent>
                </Card>
              ))}
              {(data?.delegations ?? []).length === 0 && (
                <EmptyState title="Belum ada delegasi" description="Tambahkan delegasi approver sementara saat approver utama cuti." icon={<Clock className="h-6 w-6" />} />
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
