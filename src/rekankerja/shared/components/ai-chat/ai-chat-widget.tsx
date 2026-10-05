"use client";
// =====================================================================
// RekanKerja — WIDGET CHAT AI (Task 96) ==============================
// =====================================================================
// Bubble chat mengambang (konsisten di shell admin DAN ESS — dipasang di
// root page.tsx, self-gate via status sesi). Tiga tab:
//   1. Asisten AI  — chatbot RekanKerja (scope: menu yang bisa diakses
//                    pengguna + data pribadi sendiri; ditolak bila di luar).
//   2. Ahli HR     — persona konsultan HR (peraturan ketenagakerjaan RI
//                    yang relevan + basis pengetahuan perusahaan).
//   3. Kontak      — pesan langsung ke bawahan/atasan yang terhubung
//                    (poll 5 detik saat thread terbuka).
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot, Scale, Users, X, SendHorizonal, Loader2, Trash2, ArrowLeft, Sparkles, MessageCircle,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import { cn } from "@/lib/utils";
import { useApi, apiSend } from "@/rekankerja/shared/lib/api";
import { initials } from "@/rekankerja/shared/lib/api";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { useI18n } from "@/rekankerja/shared/lib/i18n";
import { useAccentTheme, ACCENT_THEMES } from "@/rekankerja/shared/lib/accent-theme";

// ---------- tipe ----------
interface ChatMsg { id: string; role: string; content: string; createdAt: string }
interface Contact {
  appUserId: string; name: string; positionTitle: string | null;
  relation: string; lastMessage: string | null; lastAt: string | null; unread: number;
}
interface DmMsg { id: string; mine: boolean; body: string; createdAt: string }
type Tab = "assistant" | "hr_expert" | "contacts";

const AI_TABS: { id: "assistant" | "hr_expert"; label: string; labelEn: string; icon: typeof Bot; desc: string; descEn: string }[] = [
  {
    id: "assistant", label: "Asisten AI", labelEn: "AI Assistant", icon: Bot,
    desc: "Tanya apa saja seputar RekanKerja — sesuai menu yang bisa Anda akses + data Anda sendiri (sisa cuti, presensi…)",
    descEn: "Ask anything about RekanKerja — scoped to your accessible menus + your own data (leave balance, attendance…)",
  },
  {
    id: "hr_expert", label: "Ahli HR", labelEn: "HR Expert", icon: Scale,
    desc: "Konsultan ketenagakerjaan: UU Ketenagakerjaan, PP 35/2021 PKWT, BPJS, PPh 21/TER, UMP/UMK + kebijakan internal perusahaan",
    descEn: "Indonesian labor consultant: Manpower Law, PP 35/2021, BPJS, PPh 21/TER, minimum wage + internal company policy",
  },
];

// ---------- subkomponen kecil ----------

function Bubble({ mine, children, accent }: { mine: boolean; children: React.ReactNode; accent: string }) {
  return (
    <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
          mine ? "rounded-br-md text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
        )}
        style={mine ? { background: accent } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex justify-start" aria-label="sedang mengetik">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- render markdown utk balasan AI (tabel cuti, heading, list…) ----------
// Balasan LLM kerap berformat Markdown; tanpa renderer ini tampil sebagai
// teks mentah (|---|---| dst). react-markdown aman: raw HTML tak dirender.
const MD_COMPONENTS: Components = {
  h1: ({ node, ...p }) => <h3 className="mt-2 mb-1 text-[13px] font-bold first:mt-0" {...p} />,
  h2: ({ node, ...p }) => <h3 className="mt-2 mb-1 text-[13px] font-bold first:mt-0" {...p} />,
  h3: ({ node, ...p }) => <h4 className="mt-2 mb-1 text-[12.5px] font-semibold first:mt-0" {...p} />,
  h4: ({ node, ...p }) => <h4 className="mt-1.5 mb-1 text-[12.5px] font-semibold first:mt-0" {...p} />,
  p: ({ node, ...p }) => <p className="my-1 first:my-0" {...p} />,
  ul: ({ node, ...p }) => <ul className="my-1 list-disc space-y-0.5 pl-4" {...p} />,
  ol: ({ node, ...p }) => <ol className="my-1 list-decimal space-y-0.5 pl-4" {...p} />,
  li: ({ node, ...p }) => <li className="leading-snug" {...p} />,
  table: ({ node, ...p }) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px]" {...p} />
    </div>
  ),
  th: ({ node, ...p }) => <th className="border border-slate-300 px-1.5 py-1 text-left font-semibold dark:border-slate-600" {...p} />,
  td: ({ node, ...p }) => <td className="border border-slate-200 px-1.5 py-1 align-top dark:border-slate-700" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold" {...p} />,
  a: ({ node, ...p }) => <a className="text-brand underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
  code: ({ node, ...p }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[11px] dark:bg-slate-900" {...p} />,
  pre: ({ node, ...p }) => <pre className="my-1.5 overflow-x-auto rounded-lg bg-slate-900 p-2 text-[11px] text-slate-100" {...p} />,
  blockquote: ({ node, ...p }) => <blockquote className="my-1 border-l-2 border-slate-300 pl-2 text-slate-500 dark:border-slate-600 dark:text-slate-400" {...p} />,
  hr: () => <hr className="my-2 border-slate-200 dark:border-slate-700" />,
};

function AssistantMd({ content }: { content: string }) {
  return <ReactMarkdown components={MD_COMPONENTS}>{content}</ReactMarkdown>;
}

// ---------- panel chat AI (dipakai 2 mode) ----------

function AiChatPane({ mode, accent }: { mode: "assistant" | "hr_expert"; accent: string }) {
  const { t } = useI18n();
  const meta = AI_TABS.find((x) => x.id === mode)!;
  const history = useApi<{ messages: ChatMsg[] }>(`/api/rekankerja/ai/chat?mode=${mode}`, [mode]);
  const [pending, setPending] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = [
    ...(history.data?.messages ?? []),
    ...pending.map((p, i) => ({ id: `p-${i}-${p.slice(0, 12)}`, role: i % 2 === 0 ? "user" : "assistant", content: p, createdAt: "" })),
  ];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [all.length, busy]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    setPending((p) => [...p, q]);
    try {
      const res = await apiSend<{ reply: string }>("/api/rekankerja/ai/chat", "POST", { mode, message: q });
      setPending((p) => [...p, res.reply]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("AI gagal menjawab — coba ulangi", "AI failed to answer — try again"));
      setPending((p) => p.slice(0, -1));
      setInput(q);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await apiSend(`/api/rekankerja/ai/chat?mode=${mode}`, "DELETE");
      setPending([]);
      history.refresh();
    } catch { /* abaikan */ }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2.5 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow" style={{ background: accent }}>
          <meta.icon className="h-4 w-4" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">{t(meta.desc, meta.descEn)}</p>
        <button
          onClick={() => void clear()}
          title={t("Hapus riwayat chat", "Clear chat history")}
          aria-label={t("Hapus riwayat chat", "Clear chat history")}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
        {all.length === 0 && !busy && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <Sparkles className="h-6 w-6 text-slate-300 dark:text-slate-600" aria-hidden />
            <p className="text-[12px] font-medium text-slate-400">
              {t("Belum ada percakapan — mulai bertanya di bawah.", "No conversation yet — start asking below.")}
            </p>
          </div>
        )}
        {all.map((m) => (
          <Bubble key={m.id} mine={m.role === "user"} accent={accent}>
            {m.role === "user" ? m.content : <AssistantMd content={m.content} />}
          </Bubble>
        ))}
        {busy && <TypingDots />}
        {error && (
          <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>
        )}
      </div>

      <div className="border-t border-slate-200/80 p-3 dark:border-slate-800">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
            }}
            rows={1}
            placeholder={t("Tulis pertanyaan… (Enter kirim)", "Type your question… (Enter to send)")}
            aria-label={t("Pertanyaan untuk AI", "Question for AI")}
            className="max-h-28 min-h-[42px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label={t("Kirim", "Send")}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-white shadow transition disabled:opacity-40"
            style={{ background: accent }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- panel kontak + thread DM ----------

function ContactsPane({ accent }: { accent: string }) {
  const { t } = useI18n();
  const contacts = useApi<{ contacts: Contact[] }>("/api/rekankerja/ai/contacts");
  const [partner, setPartner] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<DmMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadThread = useCallback(async (appUserId: string) => {
    try {
      const res = await apiSend<{ messages: DmMsg[] }>(`/api/rekankerja/ai/dm?with=${encodeURIComponent(appUserId)}`, "GET");
      setMessages(res.messages);
    } catch { /* biarkan list lama */ }
  }, []);

  // poll 5s saat thread terbuka
  useEffect(() => {
    if (!partner) return;
    void loadThread(partner.appUserId);
    const id = window.setInterval(() => void loadThread(partner.appUserId), 5000);
    return () => window.clearInterval(id);
  }, [partner, loadThread]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || !partner || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiSend<{ message: DmMsg }>("/api/rekankerja/ai/dm", "POST", { to: partner.appUserId, body: text });
      setMessages((m) => [...m, res.message]);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Gagal mengirim pesan", "Failed to send message"));
    } finally {
      setSending(false);
    }
  };

  if (partner) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2.5 border-b border-slate-200/80 px-3 py-2.5 dark:border-slate-800">
          <button
            onClick={() => { setPartner(null); setMessages([]); }}
            aria-label={t("Kembali ke daftar kontak", "Back to contact list")}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-foreground dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: accent }}>
            {initials(partner.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{partner.name}</p>
            <p className="truncate text-[10.5px] text-slate-400">{partner.relation}{partner.positionTitle ? ` · ${partner.positionTitle}` : ""}</p>
          </div>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <p className="pt-8 text-center text-[12px] text-slate-400">
              {t("Mulai percakapan dengan rekan Anda", "Start a conversation with your colleague")}
            </p>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} mine={m.mine} accent={accent}>{m.body}</Bubble>
          ))}
          {sending && <TypingDots />}
          {error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">{error}</p>
          )}
        </div>

        <div className="border-t border-slate-200/80 p-3 dark:border-slate-800">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
              }}
              rows={1}
              placeholder={t("Tulis pesan…", "Type a message…")}
              aria-label={t("Pesan", "Message")}
              className="max-h-28 min-h-[42px] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[13px] text-slate-700 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              aria-label={t("Kirim", "Send")}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl text-white shadow transition disabled:opacity-40"
              style={{ background: accent }}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const list = contacts.data?.contacts ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="px-4 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
        {t("Bawahan & atasan terhubung", "Connected subordinates & superiors")}
      </p>
      {contacts.loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("Memuat kontak…", "Loading contacts…")}
        </div>
      )}
      {!contacts.loading && list.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-8 py-10 text-center">
          <Users className="h-6 w-6 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-[12px] leading-relaxed text-slate-400">
            {t(
              "Belum ada bawahan/atasan yang terhubung dengan akun pengguna. Hubungi HR bila struktur penugasan Anda belum diatur.",
              "No connected subordinates/superiors with app accounts yet. Contact HR if your assignment structure is not set up.",
            )}
          </p>
        </div>
      )}
      {list.map((c) => (
        <button
          key={c.appUserId}
          onClick={() => { setPartner(c); setError(null); }}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-brand/10"
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ background: accent }}>
            {initials(c.name)}
            {c.unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-extrabold text-white ring-2 ring-white dark:ring-slate-900">
                {c.unread > 9 ? "9+" : c.unread}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{c.name}</span>
              <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ background: `color-mix(in oklab, ${accent} 14%, transparent)`, color: accent }}>
                {c.relation}
              </span>
            </span>
            <span className="mt-0.5 block truncate text-[11.5px] text-slate-400">
              {c.lastMessage ?? (c.positionTitle ?? "—")}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

// ---------- widget utama ----------

export function AiChatWidget() {
  const { t } = useI18n();
  const session = useSession();
  const { accent: accentId } = useAccentTheme();
  const accent = (ACCENT_THEMES.find((x) => x.id === accentId) ?? ACCENT_THEMES[0]).hex;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("assistant");

  // widget hanya untuk sesi aktif (admin ATAU ESS)
  if (session.status !== "ready") return null;

  return (
    <>
      {/* tombol mengambang */}
      <motion.button
        onClick={() => setOpen((o) => !o)}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22, delay: 0.4 }}
        aria-label={t("Asisten AI RekanKerja", "RekanKerja AI Assistant")}
        aria-expanded={open}
        className="fixed bottom-24 right-4 z-[55] flex h-[52px] w-[52px] items-center justify-center rounded-2xl text-white shadow-[0_14px_32px_-8px_rgba(0,0,0,0.45)] transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
        style={{ background: accent }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "x" : "bot"}
            initial={{ rotate: -30, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 30, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      {/* panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t("Chat RekanKerja", "RekanKerja Chat")}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-3 bottom-[160px] z-[56] flex h-[min(62vh,540px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl md:inset-x-auto md:bottom-24 md:right-6 md:h-[min(70vh,580px)] md:w-[400px] dark:border-slate-800 dark:bg-slate-950"
          >
            {/* header + tab */}
            <div className="border-b border-slate-200/80 bg-white px-3 pt-2.5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2 px-1 pb-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white" style={{ background: accent }}>
                  <Bot className="h-3.5 w-3.5" aria-hidden />
                </span>
                <p className="flex-1 text-[13px] font-extrabold tracking-tight text-slate-900 dark:text-slate-50">
                  {t("Asisten RekanKerja", "RekanKerja Assistant")}
                </p>
                <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: `color-mix(in oklab, ${accent} 12%, transparent)`, color: accent }}>
                  <Sparkles className="h-2.5 w-2.5" aria-hidden /> AI
                </span>
              </div>
              <div role="tablist" aria-label={t("Mode chat", "Chat mode")} className="flex gap-1">
                {([
                  ...AI_TABS.map((x) => ({ id: x.id as Tab, label: t(x.label, x.labelEn), icon: x.icon })),
                  { id: "contacts" as Tab, label: t("Kontak", "Contacts"), icon: Users },
                ]).map((x) => {
                  const active = tab === x.id;
                  const Icon = x.icon;
                  return (
                    <button
                      key={x.id}
                      role="tab"
                      aria-selected={active}
                      onClick={() => setTab(x.id)}
                      className={cn(
                        "relative flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12px] font-bold transition-colors",
                        active ? "text-slate-900 dark:text-slate-50" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="ov-ai-tab"
                          className="absolute inset-x-0 bottom-0 h-0.5 rounded-full"
                          style={{ background: accent }}
                        />
                      )}
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                      {x.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {tab === "contacts" ? <ContactsPane accent={accent} /> : <AiChatPane key={tab} mode={tab} accent={accent} />}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
