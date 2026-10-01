"use client";
// RekanKerja — Pengaturan → eSIGN (Task 80d) ====================================
// Kelola tanda tangan elektronik tenant:
//   Tab 1 "Kunci & PIN" — daftar kunci RSA per pengguna aplikasi: status
//     (Active/Revoked), PIN tanda tangan (ada/tidak + waktu setel), fingerprint
//     kunci publik; aksi admin: Reset PIN (kembali ke OTP email) & Cabut Kunci
//     (ttd lama tetap sah; kunci baru dibuat otomatis saat ttd berikutnya).
//   Tab 2 "Audit Rantai" — jejak semua tanda tangan (hash-chain per tenant):
//     dokumen, penandatangan, waktu WIB, hash, status keutuhan rantai.
//     Manipulasi historis = link rantai putus → badge merah per record + banner.
// Guard server: menu settings:esign (view) + op:reset-pin / op:revoke.
// ============================================================================
import { useState } from "react";
import { useApi, apiSend, fmtDateTime } from "@/rekankerja/shared/lib/api";
import { useMenuPerms } from "@/rekankerja/shared/lib/menu-perms-context";
import { PageHeader, EmptyState, LoadingRows } from "@/rekankerja/shared/components/ui-kit";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  FileSignature, KeyRound, ShieldOff, RotateCcw, Link2, Link2Off, Search,
  ChevronLeft, ChevronRight, Fingerprint, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/rekankerja/shared/lib/i18n";

// ---------- tipe ----------
interface KeyRow {
  appUserId: string;
  username: string;
  fullName: string;
  role: string | null;
  active: boolean;
  status: string;
  hasPin: boolean;
  pinSetAt: string | null;
  algorithm: string;
  publicKeyFp: string;
  createdAt: string;
  rotatedAt: string | null;
}

interface KeysResp {
  summary: { totalKeys: number; withPin: number; revoked: number; signedCount: number };
  keys: KeyRow[];
}

interface ChainRow {
  id: string;
  docType: string;
  docId: string;
  docRef: string;
  docHash: string;
  signerName: string;
  signerRole: string | null;
  signedAt: string;
  signerIp: string | null;
  prevHash: string;
  ownHash: string;
  chainBroken: boolean;
}

interface ChainResp {
  total: number;
  limit: number;
  offset: number;
  chainIntact: boolean;
  brokenCount: number;
  records: ChainRow[];
}

const PAGE = 50;

export function EsignAdminView() {
  const { t } = useI18n();
  const perms = useMenuPerms();
  const keysApi = useApi<KeysResp>("/api/rekankerja/esign-admin");
  const chainApi = useApi<ChainResp>(`/api/rekankerja/esign-admin?view=chain&limit=${PAGE}`);
  const [chainOffset, setChainOffset] = useState(0);
  const [chainQ, setChainQ] = useState("");
  const [chainDocType, setChainDocType] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "reset-pin" | "revoke-key"; row: KeyRow } | null>(null);
  const [busy, setBusy] = useState(false);

  const canReset = perms.canOp("settings", "esign", "reset-pin");
  const canRevoke = perms.canOp("settings", "esign", "revoke");

  const reloadAll = () => { keysApi.refresh(); chainApi.refresh(); };

  const doAction = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const r = await apiSend<{ ok: boolean; message: string }>("/api/rekankerja/esign-admin", "POST", {
        action: confirm.kind, appUserId: confirm.row.appUserId,
      });
      toast.success(r.message ?? t("Berhasil", "Done"));
      setConfirm(null);
      reloadAll();
    } catch (e) {
      toast.error(t("Aksi gagal", "Action failed"), { description: (e as Error).message });
    } finally { setBusy(false); }
  };

  const chain = chainApi.data;
  const chainPage = (delta: number) => {
    const next = Math.max(0, (chain?.offset ?? 0) + delta * PAGE);
    setChainOffset(next);
    chainApi.refresh();
  };

  return (
    <div>
      <PageHeader
        eyebrow={t("PENGATURAN", "SETTINGS")}
        title={t("eSign — Tanda Tangan Elektronik", "eSign — Electronic Signature")}
        description={t(
          "{k} kunci tanda tangan · {p} PIN aktif · {s} dokumen ditandatangani",
          "{k} signing keys · {p} active PINs · {s} signed documents",
          { k: keysApi.data?.summary.totalKeys ?? 0, p: keysApi.data?.summary.withPin ?? 0, s: keysApi.data?.summary.signedCount ?? 0 },
        )}
      />

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys" className="gap-2"><KeyRound className="h-4 w-4" /> {t("Kunci & PIN", "Keys & PINs")}</TabsTrigger>
          <TabsTrigger value="chain" className="gap-2"><Link2 className="h-4 w-4" /> {t("Audit Rantai", "Signature Chain")}</TabsTrigger>
        </TabsList>

        {/* ================= TAB 1 — KUNCI & PIN ================= */}
        <TabsContent value="keys">
          <Card>
            <CardContent className="p-0">
              {keysApi.loading ? <LoadingRows /> : (keysApi.data?.keys.length ?? 0) === 0 ? (
                <EmptyState icon={FileSignature} title={t("Belum ada kunci tanda tangan", "No signing keys yet")} description={t("Kunci dibuat otomatis saat pengguna menandatangani dokumen pertama kali.", "Keys are created automatically on a user's first signature.")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Pengguna", "User")}</TableHead>
                      <TableHead>{t("Status Kunci", "Key Status")}</TableHead>
                      <TableHead>{t("PIN Tanda Tangan", "Signature PIN")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("Sidik Kunci", "Key Fingerprint")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t("Dibuat", "Created")}</TableHead>
                      <TableHead className="text-right">{t("Aksi", "Actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(keysApi.data?.keys ?? []).map((k) => (
                      <TableRow key={k.appUserId}>
                        <TableCell>
                          <p className="font-bold text-slate-800 dark:text-slate-100">{k.fullName}</p>
                          <p className="text-xs text-slate-400">{k.username}{k.role ? ` · ${k.role}` : ""}{!k.active && t(" · nonaktif", " · inactive")}</p>
                        </TableCell>
                        <TableCell>
                          {k.status === "Active"
                            ? <Badge variant="outline" className="bg-brand/10 text-brand-deep border-brand/25"><ShieldCheck className="mr-1 h-3 w-3" /> Active</Badge>
                            : <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200"><ShieldOff className="mr-1 h-3 w-3" /> Revoked</Badge>}
                          <p className="mt-0.5 text-[10px] text-slate-400">{k.algorithm}</p>
                        </TableCell>
                        <TableCell>
                          {k.hasPin
                            ? <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t("Terpasang", "Set")}{k.pinSetAt ? ` · ${fmtDateTime(k.pinSetAt)}` : ""}</span>
                            : <span className="text-xs text-slate-400">{t("Belum — faktor OTP email", "Not set — email OTP factor")}</span>}
                        </TableCell>
                        <TableCell className="hidden md:table-cell"><code className="text-[10px] text-slate-400">…{k.publicKeyFp}</code></TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-slate-500">{fmtDateTime(k.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            {k.hasPin && canReset && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ kind: "reset-pin", row: k })} className="h-8 gap-1.5 text-xs">
                                <RotateCcw className="h-3.5 w-3.5" /> {t("Reset PIN", "Reset PIN")}
                              </Button>
                            )}
                            {k.status === "Active" && canRevoke && (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm({ kind: "revoke-key", row: k })} className="h-8 gap-1.5 border-rose-200 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-400 dark:hover:bg-rose-500/10">
                                <ShieldOff className="h-3.5 w-3.5" /> {t("Cabut", "Revoke")}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB 2 — AUDIT RANTAI ================= */}
        <TabsContent value="chain">
          {chain && !chain.chainIntact && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-500/40 dark:bg-rose-500/10">
              <Link2Off className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
                  {t("Rantai tanda tangan TIDAK UTUH", "Signature chain is BROKEN")}
                </p>
                <p className="text-xs text-rose-600/90 dark:text-rose-400/90">
                  {t("{n} record memiliki link rantai yang tidak cocok — indikasi manipulasi data historis. Segera investigasi.", "{n} records have mismatched chain links — possible historical tampering. Investigate immediately.", { n: chain.brokenCount })}
                </p>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={chainQ} onChange={(e) => { setChainQ(e.target.value); }} placeholder={t("Cari no. dokumen / penandatangan…", "Search doc ref / signer…")} className="w-64 pl-9" />
            </div>
            <Button variant="outline" className="h-9" onClick={() => { setChainOffset(0); reloadAll(); }}>
              {t("Cari", "Search")}
            </Button>
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
              {chain?.chainIntact ? <><Link2 className="h-4 w-4 text-brand" /> {t("Rantai utuh", "Chain intact")}</> : <><Link2Off className="h-4 w-4 text-rose-500" /> {t("Rantai putus", "Chain broken")}</>}
            </span>
          </div>

          <Card>
            <CardContent className="p-0">
              {chainApi.loading ? <LoadingRows /> : (chain?.records.length ?? 0) === 0 ? (
                <EmptyState icon={Fingerprint} title={t("Belum ada tanda tangan", "No signatures yet")} description={t("Setiap dokumen yang ditandatangani akan tercatat di sini dengan hash dan rantai bukti.", "Every signed document is recorded here with its hash and proof chain.")} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Dokumen", "Document")}</TableHead>
                      <TableHead>{t("Penandatangan", "Signer")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("Waktu", "Signed At")}</TableHead>
                      <TableHead className="hidden lg:table-cell">{t("Hash", "Hash")}</TableHead>
                      <TableHead>{t("Rantai", "Chain")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(chain?.records ?? []).map((r) => (
                      <TableRow key={r.id} className={cn(r.chainBroken && "bg-rose-50/60 dark:bg-rose-500/[0.07]")}>
                        <TableCell>
                          <p className="font-bold text-slate-800 dark:text-slate-100">{r.docRef}</p>
                          <p className="text-xs text-slate-400">{r.docType}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{r.signerName}</p>
                          {r.signerRole && <p className="text-xs text-slate-400">{r.signerRole}</p>}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-slate-500">{fmtDateTime(r.signedAt)}</TableCell>
                        <TableCell className="hidden lg:table-cell"><code className="text-[10px] text-slate-400">{r.docHash.slice(0, 12)}…</code></TableCell>
                        <TableCell>
                          {r.chainBroken
                            ? <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-700"><Link2Off className="mr-1 h-3 w-3" /> {t("PUTUS", "BROKEN")}</Badge>
                            : <Badge variant="outline" className="border-brand/25 bg-brand/10 text-brand-deep"><Link2 className="mr-1 h-3 w-3" /> {t("sah", "ok")}</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {(chain?.total ?? 0) > PAGE && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {t("{from}–{to} dari {total}", "{from}–{to} of {total}", { from: (chain?.offset ?? 0) + 1, to: Math.min(chain?.total ?? 0, (chain?.offset ?? 0) + PAGE), total: chain?.total ?? 0 })}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={(chain?.offset ?? 0) === 0} onClick={() => chainPage(-1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={(chain?.offset ?? 0) + PAGE >= (chain?.total ?? 0)} onClick={() => chainPage(1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ===== konfirmasi aksi admin ===== */}
      <AlertDialog open={!!confirm} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "reset-pin" ? t("Reset PIN tanda tangan?", "Reset signature PIN?") : t("Cabut kunci tanda tangan?", "Revoke signing key?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "reset-pin"
                ? t("PIN {name} akan dihapus — sementara ia memakai kode OTP email untuk menandatangani. PIN baru bisa diset dari dialog tanda tangan.", "{name}'s PIN will be removed — they will temporarily sign with email OTP codes. A new PIN can be set from the signing dialog.", { name: confirm?.row.fullName ?? "" })
                : t("Kunci {name} dicabut dan ttd baru tertahan sampai kunci dibuat ulang otomatis. Tanda tangan LAMA tetap sah dan terverifikasi.", "{name}'s key will be revoked and new signatures held until a new key is auto-created. OLD signatures remain valid and verifiable.", { name: confirm?.row.fullName ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Batal", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doAction()} className={confirm?.kind === "revoke-key" ? "bg-rose-600 hover:bg-rose-700" : ""}>
              {confirm?.kind === "reset-pin" ? t("Reset PIN", "Reset PIN") : t("Cabut Kunci", "Revoke Key")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
