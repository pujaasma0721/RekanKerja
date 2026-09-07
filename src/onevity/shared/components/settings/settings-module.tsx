"use client";
// OneVity — Modul Pengaturan: master data lookup, security & akses (per
// pengguna: pengguna + kebijakan kata sandi + hak akses), approval engine
import { useState } from "react";
import { useApi, apiSend, fmtDate, initials } from "@/onevity/shared/lib/api";
import { PageHeader, StatusPill, EmptyState, LoadingRows } from "@/onevity/shared/components/ui-kit";
import { ApprovalEngineView } from "@/onevity/shared/components/settings/approval-views";
import { UserAccessView } from "@/onevity/shared/components/settings/user-access-view";
import { PasswordPolicyPanel, UsersPanel, MfaCard } from "@/onevity/shared/components/settings/user-security-view";
import { EmailConfigView } from "@/onevity/shared/components/settings/email-config-view";
import { ApiKeysView } from "@/onevity/shared/components/settings/api-view";
import { ActivityLogView } from "@/onevity/shared/components/settings/activity-log-view";
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
  Layers, ShieldCheck, Smartphone, CheckCircle2, Plus, Pencil, Trash2, UserCog, KeyRound, FileKey,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/onevity/shared/lib/i18n";

export function SettingsModule({ view }: { view: string }) {
  if (view === "security") return <SecurityPage />;
  if (view === "approval") return <ApprovalEngineView />;
  if (view === "email") return <EmailConfigView />;
  if (view === "api") return <ApiKeysView />;
  // 26-b P0 — viewer audit trail (menu Log Aktivitas)
  if (view === "audit") return <ActivityLogView />;
  return <LookupPage />;
}

// ================= LOOKUPS =================
interface LookupItem { id: string; category: string; code: string; label: string; sortOrder: number; active: boolean }

function LookupPage() {
  const { t } = useI18n();
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
      toast.success(t("Entri dihapus", "Entry deleted"));
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Data Master", "Master Data")}
        description={t("{n} entri lookup di {m} kategori — agama, status, pendidikan, shift, dan lainnya", "{n} lookup entries in {m} categories — religion, status, education, shifts, and more", { n: data?.lookups.length ?? 0, m: categories.length })}
        actions={
          <Button onClick={() => setAddOpen(true)} className="gap-2 font-bold">
            <Plus className="h-4 w-4" /> {t("Entri Baru", "New Entry")}
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
              <CardTitle className="flex items-center gap-2 text-sm font-bold"><Layers className="h-4 w-4 ov-text-accent" /> {t("Kategori", "Categories")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {categories.map((c) => {
                const catItems = data?.grouped[c] ?? [];
                const inactive = catItems.filter((i) => !i.active).length;
                return (
                  <button key={c} onClick={() => setCategory(c)} className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition",
                    c === current ? "ov-fill shadow-md" : "text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
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
              <CardTitle className="text-sm font-bold">{t("Entri: {cat}", "Entries: {cat}", { cat: current })}</CardTitle>
              <Badge variant="secondary" className="font-mono text-[10px]">{t("{n} item", "{n} items", { n: items.length })}</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-stone-50/80 dark:bg-stone-900/50">
                      <TableHead className="text-[11px] font-bold">{t("Label")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Kode")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Urutan", "Order")}</TableHead>
                      <TableHead className="text-[11px] font-bold">{t("Aktif")}</TableHead>
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
                            <button onClick={() => remove(l)} className="rounded-lg p-1.5 text-stone-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10" aria-label={t("Hapus")}>
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
  const { t } = useI18n();
  const [label, setLabel] = useState(item?.label ?? "");
  const [key, setKey] = useState("");
  const itemKey = item?.id ?? "new";
  if (key !== itemKey) { setKey(itemKey); setLabel(item?.label ?? ""); }

  const submit = async () => {
    if (!label.trim()) { toast.error(t("Label wajib diisi", "Label is required")); return; }
    try {
      if (item) {
        await apiSend("/api/onevity/lookups", "PATCH", { id: item.id, label });
        toast.success(t("Entri diperbarui", "Entry updated"));
      } else {
        await apiSend("/api/onevity/lookups", "POST", { category, label });
        toast.success(t("Entri ditambahkan", "Entry added"));
      }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-base">{item ? t("Edit Entri", "Edit Entry") : t("Entri Baru", "New Entry")} — {category}</DialogTitle></DialogHeader>
        <div>
          <Label className="text-xs">{t("Label *", "Label *")}</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1.5" placeholder={t("cth: Buddha", "e.g. Buddha")} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("Batal")}</Button>
          <Button onClick={submit} className="font-bold">{t("Simpan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================= SECURITY =================

function SecurityPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("users");
  const [focusUser, setFocusUser] = useState<string | null>(null);

  const tabCls = "gap-1.5 rounded-xl px-4 py-2 text-xs font-bold data-[state=active]:bg-white data-[state=active]:ov-text-accent data-[state=active]:shadow-sm dark:data-[state=active]:bg-stone-800";

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("Keamanan & Akses")}
        description={t("Pengguna aplikasi & kebijakan kata sandi (tambah pengguna, validasi sandi, umur, riwayat, lockout) + hak akses menu & data per pengguna — super admin dan atasan langsung otomatis tanpa setting.", "Application users & password policy (add user, password validation, age, history, lockout) + menu & data access rights per user — super admins and direct superiors are automatic without any setting.")}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 h-auto max-w-full overflow-x-auto rounded-2xl bg-stone-100 p-1.5 dark:bg-stone-900">
          <TabsTrigger value="users" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <UserCog className="h-3.5 w-3.5" /> {t("Pengguna", "Users")}
          </TabsTrigger>
          <TabsTrigger value="policy" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <FileKey className="h-3.5 w-3.5" /> {t("Kebijakan Kata Sandi", "Password Policy")}
          </TabsTrigger>
          <TabsTrigger value="access" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <KeyRound className="h-3.5 w-3.5" /> {t("Hak Akses per Pengguna", "Access Rights per User")}
          </TabsTrigger>
          <TabsTrigger value="mfa" className={cn(tabCls, "shrink-0 whitespace-nowrap")}>
            <Smartphone className="h-3.5 w-3.5" /> {t("Dua Faktor (2FA)", "Two-Factor (2FA)")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <UsersPanel
            onConfigureAccess={(userId) => { setFocusUser(userId); setTab("access"); }}
          />
        </TabsContent>

        <TabsContent value="policy">
          <PasswordPolicyPanel />
        </TabsContent>

        <TabsContent value="access">
          <UserAccessView focusUserId={focusUser} onFocusConsumed={() => setFocusUser(null)} />
        </TabsContent>

        {/* T17-MFA: self-service akun login sendiri (status/setup/disable). */}
        <TabsContent value="mfa">
          <MfaCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
