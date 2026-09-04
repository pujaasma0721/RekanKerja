"use client";
// OneVity — Modul Pengaturan: master data lookup, security & akses (per pengguna), approval engine
import { useState } from "react";
import { useApi, apiSend, fmtDate, initials } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { ApprovalEngineView } from "@/onevity/shared/components/settings/approval-views";
import { UserAccessView } from "@/onevity/shared/components/settings/user-access-view";
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
  Layers, ShieldCheck, CheckCircle2, Plus, Pencil, Trash2, UserCog, KeyRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function SettingsModule({ view }: { view: string }) {
  if (view === "security") return <SecurityPage />;
  if (view === "approval") return <ApprovalEngineView />;
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
          <Card className="h-fit rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
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
                    c === current ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
                  )}>
                    <span className="flex-1 truncate">{c}</span>
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-extrabold", c === current ? "bg-white/20" : "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-500")}>
                      {catItems.length}
                    </span>
                    {inactive > 0 && c === current && <span className="ml-1 text-[9px] opacity-75">{inactive} off</span>}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* entries */}
          <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-bold">Entri: {current}</CardTitle>
              <Badge variant="secondary" className="font-mono text-[10px]">{items.length} item</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                      <TableHead className="text-[11px] font-bold">Label</TableHead>
                      <TableHead className="text-[11px] font-bold">Kode</TableHead>
                      <TableHead className="text-[11px] font-bold">Urutan</TableHead>
                      <TableHead className="text-[11px] font-bold">Aktif</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((l) => (
                      <TableRow key={l.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                        <TableCell className={cn("text-[13px] font-semibold", !l.active && "text-stone-400 line-through")}>{l.label}</TableCell>
                        <TableCell className="font-mono text-[10px] text-stone-400">{l.code}</TableCell>
                        <TableCell className="text-xs text-stone-500">{l.sortOrder}</TableCell>
                        <TableCell><Switch checked={l.active} onCheckedChange={() => toggle(l)} aria-label={`Toggle ${l.label}`} /></TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <button onClick={() => setEditing(l)} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label="Edit">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => remove(l)} className="rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label="Hapus">
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
  users: { id: string; username: string; fullName: string; email: string | null; role: string; active: boolean; lastLogin: string | null }[];
}

function SecurityPage() {
  const { data, loading, refresh } = useApi<AppUserData>("/api/onevity/app-users");
  const [tab, setTab] = useState("users");
  const [focusUser, setFocusUser] = useState<string | null>(null);
  const [userDialog, setUserDialog] = useState<{ open: boolean; user: AppUserData["users"][number] | null }>({ open: false, user: null });

  const roleTone: Record<string, string> = {
    Admin: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-400",
    "HR Manager": "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400",
    Approver: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400",
    Viewer: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400",
  };

  return (
    <div>
      <PageHeader
        eyebrow="PENGATURAN"
        title="Keamanan & Akses"
        description="Pengguna aplikasi dan hak aksesnya — akses menu & data karyawan diatur per pengguna (bukan per grup); super admin dan atasan langsung otomatis tanpa setting."
      />
      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 h-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
            <TabsTrigger value="users" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
              <UserCog className="h-3.5 w-3.5" /> Pengguna ({data?.users.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="access" className="gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800 dark:data-[state=active]:text-emerald-400">
              <KeyRound className="h-3.5 w-3.5" /> Hak Akses per Pengguna
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users">
            <Card className="rounded-2xl border-stone-200/80 shadow-sm dark:border-stone-800">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                        <TableHead className="text-[11px] font-bold">Pengguna</TableHead>
                        <TableHead className="text-[11px] font-bold">Username</TableHead>
                        <TableHead className="text-[11px] font-bold">Role</TableHead>
                        <TableHead className="text-[11px] font-bold">Login Terakhir</TableHead>
                        <TableHead className="text-[11px] font-bold">Status</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(data?.users ?? []).map((u) => (
                        <TableRow key={u.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/60">
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-extrabold", "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400")}>{initials(u.fullName)}</span>
                              <div>
                                <p className="text-[13px] font-bold">{u.fullName}</p>
                                <p className="text-[10px] text-stone-400">{u.email ?? "—"}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] font-bold text-stone-500">{u.username}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px] font-bold", roleTone[u.role] ?? "")}>{u.role}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-stone-500">{u.lastLogin ? new Date(u.lastLogin).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "Belum pernah"}</TableCell>
                          <TableCell><StatusPill status={u.active ? "Active" : "Cancelled"} /></TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <button
                                onClick={() => { setFocusUser(u.id); setTab("access"); }}
                                className="rounded-lg p-1.5 text-stone-400 transition hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-500/10"
                                aria-label={`Atur hak akses ${u.fullName}`}
                                title="Atur hak akses (menu & data)"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => setUserDialog({ open: true, user: u })} className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800" aria-label="Edit user">
                                <Pencil className="h-3.5 w-3.5" />
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
          </TabsContent>

          <TabsContent value="access">
            <UserAccessView focusUserId={focusUser} onFocusConsumed={() => setFocusUser(null)} />
          </TabsContent>
        </Tabs>
      )}

      <UserDialog open={userDialog.open} user={userDialog.user} onClose={() => { setUserDialog({ open: false, user: null }); refresh(); }} />
    </div>
  );
}

function UserDialog({ open, user, onClose }: { open: boolean; user: AppUserData["users"][number] | null; onClose: () => void }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Viewer");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const uKey = user?.id ?? "none";
  if (key !== uKey) {
    setKey(uKey);
    setFullName(user?.fullName ?? ""); setEmail(user?.email ?? "");
    setRole(user?.role ?? "Viewer");
  }

  const submit = async () => {
    if (!fullName.trim()) { toast.error("Nama wajib diisi"); return; }
    setBusy(true);
    try {
      await apiSend("/api/onevity/app-users", "PATCH", { id: user!.id, fullName, email, role });
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
          <p className="text-[11px] leading-relaxed text-stone-400">Hak akses menu &amp; data karyawan diatur per pengguna di tab <b>Hak Akses per Pengguna</b>.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Batal</Button>
          <Button onClick={submit} disabled={busy} className="bg-emerald-600 font-bold hover:bg-emerald-700">{busy ? "Menyimpan…" : "Simpan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
