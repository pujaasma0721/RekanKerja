"use client";
// ============================================================================
// ONEVITY — AUTH DESIGN LAB (mockup interaktif, BUKAN kode produksi)
// Tujuan: memutuskan arah desain HALAMAN MASUK sebelum implementasi live.
// Akses terisolasi via /?mockup=auth — login live tidak tersentuh sama sekali.
//
// 5 konsep yang bisa dicoba langsung (form hidup: ketik, validasi, tab, bahasa):
//   0 · Sekarang          — baseline pembanding (replika desain live)
//   A · Obsidian Aurora   — gelap mewah: aurora emerald/teal, kartu kaca, kilau CTA
//   B · Ivory Editorial   — light luxury: serif editorial, underline input, marquee
//   C · Glass Showcase    — futuristik: mesh gradient + kartu produk mengambang
//   ★ Rekomendasi        — A + B + C terpilih (visi final)
// + Pratinjau mobile 390px untuk setiap konsep (gerbang login = kesan pertama
//   di ponsel juga, bukan hanya desktop).
// ============================================================================
import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, ArrowRight, BriefcaseBusiness, Building2, CalendarCheck2, Check,
  CheckCircle2, Coins, HeartPulse, Languages, Loader2, Lock, Mail, Palmtree,
  Plane, ShieldCheck, Sparkles, Users, Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============ tipografi: aksen serif = font-serif sistem (Georgia) —
// dipilih agar mockup tanpa dependensi baru; fase produksi bisa naik kelas
// ke display serif (mis. Playfair) bila konsep editorial dipilih.

// ============ kamus kecil lab (lab terisolasi dari I18nProvider) ============
type Lang = "id" | "en";
const DICT = {
  masuk: ["Masuk", "Sign in"],
  buat: ["Buat Workspace", "Create Workspace"],
  welcome: ["Selamat datang kembali", "Welcome back"],
  welcomeDesc: ["Masuk untuk melanjutkan ke workspace Anda.", "Sign in to continue to your workspace."],
  buatTitle: ["Buat workspace baru", "Create a new workspace"],
  buatDesc: ["Database terisolasi siap dalam ± 2 menit.", "Isolated database ready in ± 2 minutes."],
  email: ["Email", "Email"],
  password: ["Kata Sandi", "Password"],
  ws: ["Nama Workspace", "Workspace Name"],
  name: ["Nama Lengkap", "Full Name"],
  cta: ["Masuk ke Workspace", "Sign in to Workspace"],
  ctaReg: ["Buat Workspace", "Create Workspace"],
  busy: ["Memeriksa…", "Verifying…"],
  busyReg: ["Menyiapkan…", "Provisioning…"],
  noAcc: ["Belum punya akun?", "No account yet?"],
  haveAcc: ["Sudah punya akun?", "Already registered?"],
  buatLink: ["Buat workspace", "Create a workspace"],
  masukLink: ["Masuk", "Sign in"],
  errEmail: ["Format email tidak valid.", "Invalid email format."],
  errPw: ["Kata sandi wajib diisi.", "Password is required."],
  errPw8: ["Kata sandi minimal 8 karakter.", "Password must be at least 8 characters."],
  errWs: ["Nama workspace wajib diisi.", "Workspace name is required."],
  errName: ["Nama lengkap wajib diisi.", "Full name is required."],
  secure: ["Koneksi terenkripsi · data terisolasi per tenant", "Encrypted · data isolated per tenant"],
  done: ["Berhasil — ini pratinjau desain", "Success — design preview"],
  demoChip: ["Demo · hrd@mii.co.id / onevity123", "Demo · hrd@mii.co.id / onevity123"],
  pwHint: ["Minimal 8 karakter — kombinasi huruf besar/kecil, angka & simbol.", "8+ characters — mixed case, numbers & symbols."],
} as const;
type DictKey = keyof typeof DICT;
const tt = (k: DictKey, lang: Lang) => DICT[k][lang === "id" ? 0 : 1];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ============ logika form simulasi (dipakai semua konsep) ============
type Phase = "idle" | "busy" | "done";
function useLoginSim() {
  const [lang, setLang] = useState<Lang>("id");
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [ws, setWs] = useState("");
  const [name, setName] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);

  const switchTab = (next: "login" | "register") => {
    setTab(next);
    setErr(null);
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (phase === "busy") return;
    if (tab === "login") {
      if (!EMAIL_RE.test(email)) return setErr(tt("errEmail", lang));
      if (!pw) return setErr(tt("errPw", lang));
    } else {
      if (!ws.trim()) return setErr(tt("errWs", lang));
      if (!name.trim()) return setErr(tt("errName", lang));
      if (!EMAIL_RE.test(email)) return setErr(tt("errEmail", lang));
      if (pw.length < 8) return setErr(tt("errPw8", lang));
    }
    setErr(null);
    setPhase("busy");
    window.setTimeout(() => {
      setPhase("done");
      window.setTimeout(() => setPhase("idle"), 1900);
    }, 1300);
  };

  return { lang, setLang, tab, switchTab, email, setEmail, pw, setPw, ws, setWs, name, setName, phase, err, submit };
}
type Sim = ReturnType<typeof useLoginSim>;

// ============ tekstur & latar ============
const NOISE_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function NoiseOverlay({ opacity = 0.05, className }: { opacity?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0", className)}
      style={{ backgroundImage: NOISE_URL, opacity, mixBlendMode: "overlay" }}
    />
  );
}

/** Aurora emerald/teal/champagne — kedalaman mewah di atas obsidian. */
function AuroraField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -left-[12%] -top-[22%] h-[72%] w-[62%] rounded-full bg-brand/25 blur-[110px]"
        animate={{ x: ["0%", "10%", "0%"], y: ["0%", "7%", "0%"] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute right-[-16%] top-[28%] h-[62%] w-[56%] rounded-full bg-brand/15 blur-[120px]"
        animate={{ x: ["0%", "-9%", "0%"], y: ["0%", "9%", "0%"] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 2.5 }}
      />
      <motion.div
        className="absolute bottom-[-28%] left-[26%] h-[56%] w-[50%] rounded-full blur-[130px]"
        style={{ background: "rgba(212,175,55,0.10)" }}
        animate={{ x: ["0%", "7%", "0%"], y: ["0%", "-6%", "0%"] }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut", delay: 4 }}
      />
      {/* vignette sinematik */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(125% 95% at 50% 38%, transparent 52%, rgba(0,0,0,0.55) 100%)" }}
      />
    </div>
  );
}

/** Mesh gradient multi-warna (konsep C). */
function MeshField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-stone-950">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(46% 42% at 18% 12%, rgba(16,185,129,0.20), transparent 70%)," +
            "radial-gradient(40% 38% at 84% 22%, rgba(20,184,166,0.16), transparent 70%)," +
            "radial-gradient(50% 46% at 55% 95%, rgba(6,182,212,0.10), transparent 70%)," +
            "radial-gradient(30% 30% at 80% 80%, rgba(212,175,55,0.06), transparent 70%)",
        }}
      />
      <motion.div
        className="absolute left-[12%] top-[18%] h-[46%] w-[42%] rounded-full bg-brand/10 blur-[110px]"
        animate={{ scale: [1, 1.18, 1], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 60% at 50% 45%, black, transparent 80%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 45%, black, transparent 80%)",
        }}
      />
    </div>
  );
}

// ============ atom brand ============
function LogoLockup({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl text-white",
          compact ? "h-10 w-10" : "h-12 w-12",
          light
            ? "bg-stone-900 shadow-[0_10px_28px_-12px_rgba(28,25,23,0.7)]"
            : "bg-gradient-to-br from-brand/40 via-brand to-brand shadow-[0_10px_28px_-10px_rgba(16,185,129,0.75),inset_0_1px_0_rgba(255,255,255,0.35)]",
        )}
      >
        <Waypoints className={compact ? "h-5 w-5" : "h-6 w-6"} />
      </div>
      <div>
        <p className={cn("font-extrabold tracking-tight", compact ? "text-base" : "text-lg", light ? "text-stone-900" : "text-stone-50")}>
          One
          {light ? (
            <span className="text-amber-700">Vity</span>
          ) : (
            <span className="bg-gradient-to-r from-brand/30 to-brand/40 bg-clip-text text-transparent">Vity</span>
          )}
        </p>
        <p className={cn("text-[9px] font-bold uppercase tracking-[0.32em]", light ? "text-stone-400" : "text-stone-500")}>HR Suite</p>
      </div>
    </div>
  );
}

function GoldHairline({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("h-px w-full bg-gradient-to-r from-transparent via-amber-200/35 to-transparent", className)}
    />
  );
}

function LangPill({ sim, dark = true }: { sim: Sim; dark?: boolean }) {
  const { lang, setLang } = sim;
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "id" ? "en" : "id")}
      aria-label="Ganti bahasa"
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold backdrop-blur transition",
        dark
          ? "border-white/15 bg-white/[0.06] text-stone-300 hover:border-white/35 hover:text-stone-100"
          : "border-stone-300 bg-white/80 text-stone-600 hover:border-stone-400 hover:text-stone-900",
      )}
    >
      <Languages className="h-3.5 w-3.5" />
      <span className={lang === "id" ? "text-brand" : "text-stone-500 dark:text-stone-500"}>ID</span>
      <span className="opacity-40">·</span>
      <span className={lang === "en" ? "text-brand" : "text-stone-500 dark:text-stone-500"}>EN</span>
    </button>
  );
}

// ============ field: kaca gelap (A / C / ★) ============
function GlassField({
  id, label, icon: Icon, type = "text", placeholder, value, onChange, invalid, autoComplete, hint,
}: {
  id: string; label: string; icon: typeof Mail; type?: string; placeholder?: string;
  value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete?: string; hint?: string;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400">
        {label}
      </label>
      <div
        className={cn(
          "relative flex items-center rounded-xl border bg-white/[0.04] backdrop-blur-md transition-all duration-300",
          focus
            ? "border-brand/40/60 shadow-[0_0_0_4px_rgba(16,185,129,0.10),0_10px_26px_-14px_rgba(16,185,129,0.45)]"
            : invalid
              ? "border-rose-500/60"
              : "border-white/10 hover:border-white/25",
        )}
      >
        <Icon className={cn("pointer-events-none absolute left-4 h-4 w-4 transition-colors", focus ? "text-brand/85" : "text-stone-500")} />
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onChange={(e) => onChange(e.target.value)}
          className="h-12 w-full rounded-xl bg-transparent pl-11 pr-4 text-sm text-stone-100 caret-brand/60 outline-none placeholder:text-stone-600"
        />
      </div>
      {hint && <p className="text-[11px] leading-relaxed text-stone-500">{hint}</p>}
    </div>
  );
}

// ============ field: underline editorial (B) ============
function UnderlineField({
  id, label, type = "text", placeholder, value, onChange, invalid, autoComplete,
}: {
  id: string; label: string; type?: string; placeholder?: string;
  value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete?: string;
}) {
  return (
    <div className="group space-y-1.5">
      <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.26em] text-stone-400">
        {label}
      </label>
      <div className={cn("border-b pb-2 pt-1 transition-colors duration-300", invalid ? "border-rose-400" : "border-stone-300 focus-within:border-amber-600")}>
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full bg-transparent text-[15px] text-stone-800 caret-amber-700 outline-none placeholder:font-serif placeholder:italic placeholder:text-stone-300"
        />
      </div>
    </div>
  );
}

// ============ CTA: gradient + sweep kilau ============
function ShineCTA({ onClick, busy, children }: { onClick: () => void; busy: boolean; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      whileHover={{ y: -1.5 }}
      whileTap={{ y: 0 }}
      className="relative h-12 w-full overflow-hidden rounded-xl bg-gradient-to-r from-brand via-brand/60 to-brand/60 text-[14px] font-bold tracking-wide text-stone-950 shadow-[0_14px_36px_-12px_rgba(16,185,129,0.75)] disabled:opacity-70"
    >
      <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
        <motion.span
          className="absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/45 to-transparent"
          animate={{ x: ["-170%", "360%"] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut", repeatDelay: 1.6 }}
        />
      </span>
      <span className="relative flex items-center justify-center gap-2">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="italic">Memeriksa…</span>
          </>
        ) : (
          children
        )}
      </span>
    </motion.button>
  );
}

// ============ pesan error / sukses ============
function SimError({ err }: { err: string | null }) {
  return (
    <AnimatePresence>
      {err && (
        <motion.p
          key="err"
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0, x: [0, -5, 5, -3, 3, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {err}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function SimErrorLight({ err }: { err: string | null }) {
  return (
    <AnimatePresence>
      {err && (
        <motion.p
          key="errL"
          role="alert"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0, x: [0, -5, 5, -3, 3, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-600"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {err}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** Overlay sukses di dalam kartu. */
function SuccessOverlay({ label }: { label: string }) {
  return (
    <motion.div
      key="done"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-[inherit] text-center backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.5, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 16 }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/15 text-brand/85 shadow-[0_0_40px_-6px_rgba(16,185,129,0.6)]"
      >
        <CheckCircle2 className="h-7 w-7" />
      </motion.div>
      <p className="text-sm font-bold">{label}</p>
    </motion.div>
  );
}

// ============ stat hairline (A / ★) ============
const STATS: { big: string; label: string; desc: string }[] = [
  { big: "6", label: "Modul Terpadu", desc: "HR · Payroll · Presensi · Cuti · Travel · Medis" },
  { big: "100%", label: "Terisolasi", desc: "Database terpisah untuk tiap perusahaan" },
  { big: "±2mnt", label: "Onboarding", desc: "Provisioning workspace otomatis" },
];

function StatRow({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("relative grid grid-cols-3", compact ? "gap-4" : "gap-6 xl:gap-8")}>
      <GoldHairline className="absolute inset-x-0 top-0" />
      {STATS.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 + i * 0.12, duration: 0.5, ease: "easeOut" }}
          className={cn(compact ? "pt-3" : "pt-5")}
        >
          <p className="bg-gradient-to-b from-stone-50 to-stone-400 bg-clip-text text-[26px] font-extrabold tracking-tight text-transparent xl:text-[30px]">
            {s.big}
          </p>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-200/70">{s.label}</p>
          {!compact && <p className="mt-1 text-[11px] leading-relaxed text-stone-500">{s.desc}</p>}
        </motion.div>
      ))}
    </div>
  );
}

// ============ kartu produk mengambang (C / ★) ============
function FloatCard({ children, className, delay = 0, rotate = 0 }: { children: ReactNode; className?: string; delay?: number; rotate?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, rotate }}
      animate={{ opacity: 1, y: [0, -9, 0], rotate }}
      transition={{
        opacity: { delay, duration: 0.6, ease: "easeOut" },
        y: { delay, duration: 6.5, repeat: Infinity, ease: "easeInOut" },
      }}
      className={cn(
        "absolute z-10 rounded-2xl border border-white/12 bg-white/[0.06] p-4 shadow-[0_30px_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

function FloatPayroll() {
  return (
    <FloatCard className="w-[236px]" delay={0.35} rotate={1.5}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
          <Coins className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold text-stone-200">Payroll · Agustus 2026</p>
          <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-brand/85">Terbayar penuh</p>
        </div>
      </div>
      <p className="mt-3 font-mono text-[19px] font-bold tracking-tight text-stone-50">Rp 531.700.000</p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-brand/60 to-brand/40"
          initial={{ width: "12%" }}
          animate={{ width: "100%" }}
          transition={{ delay: 0.8, duration: 1.6, ease: "easeOut" }}
        />
      </div>
      <p className="mt-2 text-[10px] text-stone-500">44/44 karyawan · PPh21 &amp; BPJS terproses</p>
    </FloatCard>
  );
}

function FloatApprovals() {
  const items: { icon: typeof Palmtree; label: string; tint: string }[] = [
    { icon: Palmtree, label: "Cuti", tint: "text-brand/75 bg-brand/55/10" },
    { icon: Plane, label: "Travel", tint: "text-brand/75 bg-brand/55/10" },
    { icon: HeartPulse, label: "Medis", tint: "text-rose-300 bg-rose-400/10" },
  ];
  return (
    <FloatCard className="w-[212px]" delay={0.55} rotate={-2}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/55/15 text-brand/75">
          <CalendarCheck2 className="h-4 w-4" />
        </span>
        <p className="text-[11px] font-bold text-stone-200">Menunggu persetujuan</p>
        <span className="ml-auto rounded-full bg-brand/55/20 px-1.5 py-0.5 text-[10px] font-extrabold text-brand/75">3</span>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        {["SW", "BS", "AR"].map((n, i) => (
          <span
            key={n}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border border-stone-950 text-[9px] font-extrabold text-stone-950",
              i === 0 ? "bg-brand/35" : i === 1 ? "bg-amber-300" : "bg-brand/35",
            )}
          >
            {n}
          </span>
        ))}
        <span className="ml-1 text-[10px] text-stone-500">pengaju hari ini</span>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {items.map((it) => (
          <span key={it.label} className={cn("flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold", it.tint)}>
            <it.icon className="h-3 w-3" />
            {it.label}
          </span>
        ))}
      </div>
    </FloatCard>
  );
}

function FloatAttendance() {
  const C = 2 * Math.PI * 17;
  return (
    <FloatCard className="w-[176px]" delay={0.75} rotate={2}>
      <div className="flex items-center gap-3">
        <div className="relative h-11 w-11">
          <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
            <circle cx="22" cy="22" r="17" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
            <motion.circle
              cx="22" cy="22" r="17" fill="none" stroke="url(#attg)" strokeWidth="4" strokeLinecap="round"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: C * 0.04 }}
              transition={{ delay: 1, duration: 1.4, ease: "easeOut" }}
            />
            <defs>
              <linearGradient id="attg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#2dd4bf" />
              </linearGradient>
            </defs>
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-extrabold text-stone-100">96%</span>
        </div>
        <div>
          <p className="text-[11px] font-bold text-stone-200">Kehadiran</p>
          <p className="text-[10px] text-stone-500">hari ini · 424 hadir</p>
        </div>
      </div>
    </FloatCard>
  );
}

// ============ marquee klien (B) ============
const CLIENTS = ["PT Mitra Industri Internasional", "Cahaya Digital Nusantara", "Sentra Logistik Prima", "Payroll PPh21 · BPJS", "Presensi · Cuti · Travel · Medis"];
function MarqueeStrip() {
  const doubled = [...CLIENTS, ...CLIENTS];
  return (
    <div className="relative overflow-hidden py-3" style={{ maskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, black 12%, black 88%, transparent)" }}>
      <motion.div
        className="flex w-max items-center gap-10"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
      >
        {doubled.map((c, i) => (
          <span key={i} className="flex items-center gap-10 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.22em] text-stone-400">
            {c}
            <span aria-hidden className="block h-1.5 w-1.5 rotate-45 bg-amber-600/60" />
          </span>
        ))}
      </motion.div>
    </div>
  );
}

// ============================================================================
// KONSEP 0 — SEKARANG (replika baseline live, pembanding)
// ============================================================================
function BaselineLogin({ variant }: { variant: "desktop" | "mobile" }) {
  const sim = useLoginSim();
  const { lang, tab, switchTab } = sim;
  const feats = [
    { icon: Building2, t: "Database terpisah per tenant", d: "Isolasi data penuh antar perusahaan" },
    { icon: Coins, t: "Payroll Indonesia PPh21/BPJS", d: "Pajak progresif, TER, jurnal & SPT 1721-A1" },
    { icon: Users, t: "Modul HR lengkap", d: "Organisasi, karyawan, pengajuan & benefit" },
  ];
  const inputCls = "h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/50";
  return (
    <div className="grid h-full min-h-0 bg-white lg:grid-cols-2">
      {variant === "desktop" && (
        <div className="relative hidden flex-col overflow-hidden bg-stone-950 p-10 text-stone-300 lg:flex xl:p-14">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[image:radial-gradient(ellipse_70%_55%_at_75%_0%,rgba(16,185,129,0.14),transparent_60%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[image:linear-gradient(to_right,rgba(214,211,209,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(214,211,209,0.05)_1px,transparent_1px)] bg-[size:36px_36px]" />
          <div className="relative z-10 flex h-full flex-col justify-between gap-10">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand/60 to-brand text-white shadow-lg">
                <Waypoints className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight text-stone-50">One<span className="text-brand/85">Vity</span></p>
                <p className="text-[11px] uppercase tracking-widest text-stone-500">HR Suite</p>
              </div>
            </div>
            <div className="max-w-md">
              <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand/85">SaaS Multi-Tenant</span>
              <h2 className="mt-5 text-3xl font-bold tracking-tight text-stone-50 xl:text-4xl">OneVity HR Suite</h2>
              <p className="mt-3 text-sm leading-relaxed text-stone-400">HRIS multi-tenant — satu platform, tiap perusahaan punya data terisolasi.</p>
              <ul className="mt-9 space-y-4">
                {feats.map((f) => (
                  <li key={f.t} className="flex items-start gap-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand/20 bg-brand/10 text-brand/85">
                      <f.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-stone-200">{f.t}</span>
                      <span className="mt-0.5 block text-xs text-stone-500">{f.d}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-stone-600">© 2026 OneVity — HRIS multi-tenant SaaS</p>
          </div>
        </div>
      )}
      <div className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <LangPill sim={sim} dark={false} />
        <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-6 shadow-lg shadow-stone-200/60">
          <div className="mb-3 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand/60 to-brand text-white shadow-md">
              <Waypoints className="h-5 w-5" />
            </div>
            <p className="text-base font-bold tracking-tight text-stone-900">One<span className="text-brand">Vity</span></p>
          </div>
          <h1 className="text-xl font-bold text-stone-900">{tt("welcome", lang)}</h1>
          <p className="mt-1 text-sm text-stone-500">{tt("welcomeDesc", lang)}</p>
          <div className="mt-5 flex rounded-lg bg-stone-100 p-1">
            {(["login", "register"] as const).map((k) => (
              <button
                key={k}
                onClick={() => switchTab(k)}
                className={cn("h-8 flex-1 rounded-md text-[13px] font-semibold transition", tab === k ? "bg-white text-stone-900 shadow" : "text-stone-500")}
              >
                {k === "login" ? tt("masuk", lang) : tt("buat", lang)}
              </button>
            ))}
          </div>
          <form className="mt-4 space-y-4" onSubmit={sim.submit}>
            {tab === "login" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-stone-800" htmlFor="b0e">{tt("email", lang)}</label>
                  <input id="b0e" className={inputCls} value={sim.email} onChange={(e) => sim.setEmail(e.target.value)} placeholder="nama@perusahaan.id" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] font-semibold text-stone-800" htmlFor="b0p">{tt("password", lang)}</label>
                  <input id="b0p" type="password" className={inputCls} value={sim.pw} onChange={(e) => sim.setPw(e.target.value)} placeholder="••••••••" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5"><label className="text-[13px] font-semibold text-stone-800" htmlFor="b0w">{tt("ws", lang)}</label><input id="b0w" className={inputCls} value={sim.ws} onChange={(e) => sim.setWs(e.target.value)} placeholder="PT Nusantara Sejahtera" /></div>
                <div className="space-y-1.5"><label className="text-[13px] font-semibold text-stone-800" htmlFor="b0n">{tt("name", lang)}</label><input id="b0n" className={inputCls} value={sim.name} onChange={(e) => sim.setName(e.target.value)} placeholder="Budi Santoso" /></div>
                <div className="space-y-1.5"><label className="text-[13px] font-semibold text-stone-800" htmlFor="b0e2">{tt("email", lang)}</label><input id="b0e2" className={inputCls} value={sim.email} onChange={(e) => sim.setEmail(e.target.value)} placeholder="nama@perusahaan.id" /></div>
                <div className="space-y-1.5"><label className="text-[13px] font-semibold text-stone-800" htmlFor="b0p2">{tt("password", lang)}</label><input id="b0p2" type="password" className={inputCls} value={sim.pw} onChange={(e) => sim.setPw(e.target.value)} placeholder="••••••••" /></div>
              </>
            )}
            <SimErrorLight err={sim.err} />
            <button type="submit" className="h-10 w-full rounded-md bg-brand text-sm font-semibold text-white shadow-sm hover:bg-brand/70">
              {sim.phase === "busy" ? tt("busy", lang) : tab === "login" ? tt("masuk", lang) : tt("buat", lang)}
            </button>
            <p className="text-center text-xs text-stone-500">
              {tab === "login" ? tt("noAcc", lang) : tt("haveAcc", lang)}{" "}
              <button type="button" onClick={() => switchTab(tab === "login" ? "register" : "login")} className="font-semibold text-brand-deep hover:underline">
                {tab === "login" ? tt("buatLink", lang) : tt("masukLink", lang)}
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// KONSEP A — OBSIDIAN AURORA (gelap mewah)
// ============================================================================
function AuroraLogin({ variant }: { variant: "desktop" | "mobile" }) {
  const sim = useLoginSim();
  const { lang, tab, switchTab } = sim;

  const card = (
    <div className="relative w-full max-w-md">
      {/* highlight tepi atas — sinyal kaca premium */}
      <div aria-hidden className="absolute inset-x-12 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.05] p-7 shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-8">
        <AnimatePresence>{sim.phase === "done" && <SuccessOverlay label={tt("done", lang)} />}</AnimatePresence>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-200/70">OneVity · {tab === "login" ? "Masuk" : "Registrasi"}</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-tight text-stone-50">{tab === "login" ? tt("welcome", lang) : tt("buatTitle", lang)}</h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-stone-400">{tab === "login" ? tt("welcomeDesc", lang) : tt("buatDesc", lang)}</p>

          {/* tabs segmented kaca */}
          <div className="mt-6 flex rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur-md">
            {(["login", "register"] as const).map((k) => (
              <button
                key={k}
                onClick={() => switchTab(k)}
                className={cn("relative h-9 flex-1 rounded-full text-[12.5px] font-bold transition-colors", tab === k ? "text-stone-950" : "text-stone-400 hover:text-stone-200")}
              >
                {tab === k && (
                  <motion.span
                    layoutId="aurora-tab"
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-brand/40 to-brand/40 shadow-[0_6px_20px_-6px_rgba(16,185,129,0.7)]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative">{k === "login" ? tt("masuk", lang) : tt("buat", lang)}</span>
              </button>
            ))}
          </div>

          <form className="mt-6 space-y-4" onSubmit={sim.submit}>
            {tab === "login" ? (
              <>
                <GlassField id="a-email" label={tt("email", lang)} icon={Mail} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
                <GlassField id="a-pw" label={tt("password", lang)} icon={Lock} type="password" autoComplete="current-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} />
              </>
            ) : (
              <>
                <GlassField id="a-ws" label={tt("ws", lang)} icon={BriefcaseBusiness} placeholder="PT Nusantara Sejahtera" value={sim.ws} onChange={sim.setWs} invalid={!!sim.err} />
                <GlassField id="a-nm" label={tt("name", lang)} icon={Users} autoComplete="name" placeholder="Budi Santoso" value={sim.name} onChange={sim.setName} />
                <GlassField id="a-re" label={tt("email", lang)} icon={Mail} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
                <GlassField id="a-rp" label={tt("password", lang)} icon={Lock} type="password" autoComplete="new-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} hint={tt("pwHint", lang)} />
              </>
            )}
            <SimError err={sim.err} />
            <ShineCTA onClick={() => sim.submit()} busy={sim.phase === "busy"}>
              {tab === "login" ? tt("cta", lang) : tt("ctaReg", lang)} <ArrowRight className="h-4 w-4" />
            </ShineCTA>
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <span className="flex items-center gap-1.5 text-[11px] text-stone-500">
                <ShieldCheck className="h-3.5 w-3.5 text-brand/80" />
                {tt("secure", lang)}
              </span>
              <button type="button" onClick={() => switchTab(tab === "login" ? "register" : "login")} className="text-[11px] font-bold text-brand/85 hover:text-brand/75 hover:underline">
                {tab === "login" ? tt("noAcc", lang) : tt("haveAcc", lang)}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );

  if (variant === "mobile") {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-stone-950 text-stone-200">
        <AuroraField />
        <NoiseOverlay opacity={0.06} />
        <div className="relative z-10 flex items-center justify-between px-5 pt-6">
          <LogoLockup compact />
          <LangPill sim={sim} />
        </div>
        <div className="relative z-10 flex flex-1 items-center justify-center px-5">
          {card}
        </div>
        <div className="relative z-10 px-5 pb-5">
          <GoldHairline />
          <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600">© 2026 OneVity · Data terisolasi per tenant</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-stone-950 text-stone-200">
      <AuroraField />
      <NoiseOverlay opacity={0.06} />
      <div className="relative z-10 grid h-full grid-cols-1 lg:grid-cols-[1.08fr_1fr]">
        {/* kiri — editorial */}
        <div className="hidden h-full flex-col justify-between p-10 lg:flex xl:p-16">
          <LogoLockup />
          <div className="max-w-xl">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-300 backdrop-blur-md"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand/55 shadow-[0_0_10px_2px_rgba(16,185,129,0.8)]" />
              SaaS Multi-Tenant
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.6, ease: "easeOut" }}
              className="mt-6 text-[42px] font-extrabold leading-[1.05] tracking-[-0.025em] text-stone-50 xl:text-[52px]"
            >
              Satu gerbang.
              <br />
              Seluruh operasional
              <br />
              <span className="bg-gradient-to-r from-brand/30 via-brand/30 to-amber-100 bg-clip-text font-serif italic text-transparent">
                perusahaan Anda.
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="mt-5 max-w-md text-[14px] leading-relaxed text-stone-400"
            >
              OneVity menyatukan HR, payroll PPh21/BPJS, presensi hingga benefit —
              dengan data terisolasi untuk setiap perusahaan.
            </motion.p>
          </div>
          <StatRow />
        </div>
        {/* kanan — kartu kaca */}
        <div className="relative flex h-full items-center justify-center p-6 sm:p-10">
          <div className="absolute right-6 top-6 z-20 sm:right-10 sm:top-10"><LangPill sim={sim} /></div>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }} className="flex w-full justify-center lg:hidden">
            <LogoLockup compact />
          </motion.div>
          <div className="mt-6 w-full flex-1 flex items-start justify-center lg:mt-0 lg:flex-none">
            {card}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// KONSEP B — IVORY EDITORIAL (light luxury)
// ============================================================================
function EditorialLogin({ variant }: { variant: "desktop" | "mobile" }) {
  const sim = useLoginSim();
  const { lang, tab, switchTab } = sim;

  const card = (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="relative w-full max-w-md overflow-hidden rounded-3xl border border-stone-200/90 bg-white p-8 shadow-[0_40px_80px_-40px_rgba(87,83,78,0.35)] sm:p-10"
    >
      <AnimatePresence>{sim.phase === "done" && <SuccessOverlay label={tt("done", lang)} />}</AnimatePresence>
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-700">{tab === "login" ? "Masuk ke akun" : "Registrasi"}</p>
      <h2 className="mt-2.5 font-serif text-[27px] italic leading-tight text-stone-900">
        {tab === "login" ? "Selamat datang." : "Mulai perjalanan."}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-stone-500">{tab === "login" ? tt("welcomeDesc", lang) : tt("buatDesc", lang)}</p>

      <div className="mt-6 flex items-center gap-5 border-b border-stone-200 pb-5">
        {(["login", "register"] as const).map((k, i) => (
          <button key={k} onClick={() => switchTab(k)} className="group relative pb-1">
            <span className={cn("text-[12px] font-bold uppercase tracking-[0.2em] transition-colors", tab === k ? "text-stone-900" : "text-stone-400 hover:text-stone-700")}>
              {k === "login" ? tt("masuk", lang) : tt("buat", lang)}
            </span>
            <span className={cn("absolute inset-x-0 -bottom-[21px] h-[2px] transition-all", tab === k ? "bg-amber-600" : "bg-transparent group-hover:bg-stone-300")} />
          </button>
        ))}
      </div>

      <form className="mt-7 space-y-6" onSubmit={sim.submit}>
        {tab === "login" ? (
          <>
            <UnderlineField id="e-email" label={tt("email", lang)} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
            <UnderlineField id="e-pw" label={tt("password", lang)} type="password" autoComplete="current-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} />
          </>
        ) : (
          <>
            <UnderlineField id="e-ws" label={tt("ws", lang)} placeholder="PT Nusantara Sejahtera" value={sim.ws} onChange={sim.setWs} invalid={!!sim.err} />
            <UnderlineField id="e-nm" label={tt("name", lang)} autoComplete="name" placeholder="Budi Santoso" value={sim.name} onChange={sim.setName} />
            <UnderlineField id="e-re" label={tt("email", lang)} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
            <div>
              <UnderlineField id="e-rp" label={tt("password", lang)} type="password" autoComplete="new-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} />
              <p className="mt-2 font-serif text-[11.5px] italic text-stone-400">{tt("pwHint", lang)}</p>
            </div>
          </>
        )}
        <SimErrorLight err={sim.err} />
        <motion.button
          type="submit"
          whileHover={{ y: -1.5 }}
          whileTap={{ y: 0 }}
          className="group flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-stone-900 text-[13px] font-bold uppercase tracking-[0.16em] text-stone-50 shadow-[0_18px_40px_-16px_rgba(28,25,23,0.6)] transition-colors hover:bg-stone-800"
        >
          {sim.phase === "busy" ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {tab === "login" ? tt("busy", lang) : tt("busyReg", lang)}</>
          ) : (
            <>
              {tab === "login" ? tt("cta", lang) : tt("ctaReg", lang)}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </motion.button>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-stone-400">
            <ShieldCheck className="h-3.5 w-3.5 text-amber-700" />
            {tt("secure", lang)}
          </span>
          <button type="button" onClick={() => switchTab(tab === "login" ? "register" : "login")} className="text-[11px] font-bold text-amber-800 hover:underline">
            {tab === "login" ? tt("noAcc", lang) : tt("haveAcc", lang)}
          </button>
        </div>
      </form>
    </motion.div>
  );

  if (variant === "mobile") {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-[#faf8f3] text-stone-800">
        <NoiseOverlay opacity={0.035} />
        <div className="relative z-10 flex items-center justify-between px-5 pt-6">
          <LogoLockup compact light />
          <LangPill sim={sim} dark={false} />
        </div>
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-8">
          <p className="mb-5 max-w-[280px] text-center font-serif text-[20px] italic leading-snug text-stone-700">
            HR yang tertata, <span className="text-amber-700">bisnis yang tenang.</span>
          </p>
          {card}
        </div>
        <div className="relative z-10">
          <div className="border-t border-stone-200" />
          <MarqueeStrip />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-[#faf8f3] text-stone-800">
      <NoiseOverlay opacity={0.035} />
      {/* bingkai hairline editorial */}
      <div aria-hidden className="pointer-events-none absolute inset-3 hidden border border-stone-300/70 lg:block" />
      <div className="relative z-10 grid h-full grid-cols-1 lg:grid-cols-[1.12fr_1fr]">
        {/* kiri — editorial */}
        <div className="hidden h-full flex-col justify-between p-12 lg:flex xl:p-20">
          <LogoLockup light />
          <div className="max-w-xl">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              className="text-[10px] font-bold uppercase tracking-[0.32em] text-amber-700"
            >
              Satu platform · multi perusahaan
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6, ease: "easeOut" }}
              className="mt-4 font-serif text-[46px] leading-[1.07] tracking-tight text-stone-900 xl:text-[56px]"
            >
              HR yang tertata,
              <br />
              <span className="italic text-amber-700">bisnis yang tenang.</span>
            </motion.h1>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="mt-8 max-w-md"
            >
              <div className="flex items-center gap-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className="text-[13px] text-amber-600">★</span>
                ))}
              </div>
              <blockquote className="mt-3 font-serif text-[17px] italic leading-relaxed text-stone-700">
                “Payroll PPh21 kami dari tiga hari menjadi dua jam — dan tiap perusahaan
                datanya benar-benar terpisah.”
              </blockquote>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.2em] text-stone-400">
                Tri Handayani · HR Director
              </p>
            </motion.div>
          </div>
          <div className="relative">
            <div className="mb-3 hidden items-center gap-6 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-400 lg:flex">
              <span>86 tabel siap</span>
              <span aria-hidden className="h-1 w-1 rotate-45 bg-amber-600/60" />
              <span>Ter-isolasi per tenant</span>
              <span aria-hidden className="h-1 w-1 rotate-45 bg-amber-600/60" />
              <span>PPh21 · BPJS · SPT 1721-A1</span>
            </div>
            <div className="border-t border-stone-300/80 pt-0" />
            <MarqueeStrip />
          </div>
        </div>
        {/* kanan — kartu */}
        <div className="relative flex h-full items-center justify-center bg-white/40 p-6 sm:p-10 lg:bg-transparent">
          <div className="absolute inset-y-0 left-0 hidden w-px bg-stone-300/80 lg:block" />
          <div className="absolute right-6 top-6 sm:right-10 sm:top-10 z-20"><LangPill sim={sim} dark={false} /></div>
          <div className="flex w-full justify-center lg:hidden">
            <LogoLockup compact light />
          </div>
          <div className="mt-6 flex w-full flex-1 items-start justify-center lg:mt-0 lg:flex-none">
            {card}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// KONSEP C — GLASS SHOWCASE (mesh + kartu produk mengambang)
// ============================================================================
function ShowcaseLogin({ variant }: { variant: "desktop" | "mobile" }) {
  const sim = useLoginSim();
  const { lang, tab, switchTab } = sim;

  const card = (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      className="relative w-full max-w-[420px] overflow-hidden rounded-[26px] border border-white/12 bg-white/[0.06] p-7 shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-2xl sm:p-8"
    >
      <div aria-hidden className="absolute inset-x-10 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <AnimatePresence>{sim.phase === "done" && <SuccessOverlay label={tt("done", lang)} />}</AnimatePresence>
      <div className="text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-brand/75/70">{tab === "login" ? "Masuk" : "Registrasi"}</p>
        <h2 className="mt-2 text-[22px] font-bold tracking-tight text-stone-50">{tab === "login" ? tt("welcome", lang) : tt("buatTitle", lang)}</h2>
        <p className="mt-1 text-[12.5px] text-stone-400">{tab === "login" ? tt("welcomeDesc", lang) : tt("buatDesc", lang)}</p>
      </div>
      <div className="mt-5 flex justify-center rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur-md">
        {(["login", "register"] as const).map((k) => (
          <button key={k} onClick={() => switchTab(k)} className={cn("relative h-8 flex-1 rounded-full px-4 text-[12px] font-bold transition-colors", tab === k ? "text-stone-950" : "text-stone-400 hover:text-stone-200")}>
            {tab === k && (
              <motion.span layoutId="showcase-tab" className="absolute inset-0 rounded-full bg-gradient-to-r from-brand/40 to-brand/40" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
            )}
            <span className="relative">{k === "login" ? tt("masuk", lang) : tt("buat", lang)}</span>
          </button>
        ))}
      </div>
      <form className="mt-6 space-y-4" onSubmit={sim.submit}>
        {tab === "login" ? (
          <>
            <GlassField id="c-email" label={tt("email", lang)} icon={Mail} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
            <GlassField id="c-pw" label={tt("password", lang)} icon={Lock} type="password" autoComplete="current-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} />
          </>
        ) : (
          <>
            <GlassField id="c-ws" label={tt("ws", lang)} icon={BriefcaseBusiness} placeholder="PT Nusantara Sejahtera" value={sim.ws} onChange={sim.setWs} invalid={!!sim.err} />
            <div className="grid grid-cols-2 gap-3">
              <GlassField id="c-nm" label={tt("name", lang)} icon={Users} autoComplete="name" placeholder="Budi Santoso" value={sim.name} onChange={sim.setName} />
              <GlassField id="c-re" label={tt("email", lang)} icon={Mail} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
            </div>
            <GlassField id="c-rp" label={tt("password", lang)} icon={Lock} type="password" autoComplete="new-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} hint={tt("pwHint", lang)} />
          </>
        )}
        <SimError err={sim.err} />
        <ShineCTA onClick={() => sim.submit()} busy={sim.phase === "busy"}>
          {tab === "login" ? tt("cta", lang) : tt("ctaReg", lang)} <ArrowRight className="h-4 w-4" />
        </ShineCTA>
        <p className="text-center text-[11px] text-stone-500">
          {tab === "login" ? tt("noAcc", lang) : tt("haveAcc", lang)}{" "}
          <button type="button" onClick={() => switchTab(tab === "login" ? "register" : "login")} className="font-bold text-brand/85 hover:underline">
            {tab === "login" ? tt("buatLink", lang) : tt("masukLink", lang)}
          </button>
        </p>
      </form>
    </motion.div>
  );

  if (variant === "mobile") {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-stone-950 text-stone-200">
        <MeshField />
        <NoiseOverlay opacity={0.05} />
        <div className="relative z-10 flex items-center justify-between px-5 pt-6">
          <LogoLockup compact />
          <LangPill sim={sim} />
        </div>
        <div className="relative z-10 flex flex-1 items-center justify-center px-5">
          {card}
        </div>
        <p className="relative z-10 pb-5 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600">© 2026 OneVity</p>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-stone-950 text-stone-200">
      <MeshField />
      <NoiseOverlay opacity={0.05} />
      {/* kartu produk mengambang */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 hidden xl:block">
        <FloatPayroll />
        <FloatApprovals />
        <FloatAttendance />
      </div>
      <div className="relative z-20 flex h-full flex-col items-center justify-center px-6 py-10">
        <div className="absolute right-6 top-6 z-30 sm:right-10 sm:top-10"><LangPill sim={sim} /></div>
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex flex-col items-center gap-4 lg:mb-6">
          <LogoLockup />
        </motion.div>
        <div className="hidden text-center lg:mb-7 lg:block">
          <h1 className="text-[30px] font-extrabold tracking-[-0.02em] text-stone-50">
            Satu platform,{" "}
            <span className="bg-gradient-to-r from-brand/30 to-brand/30 bg-clip-text text-transparent">enam modul</span>{" "}
            — data terisolasi.
          </h1>
          <p className="mt-2 text-[13px] text-stone-400">Lihat produknya bekerja bahkan sebelum Anda masuk.</p>
        </div>
        {card}
        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-stone-500">
          <ShieldCheck className="h-3.5 w-3.5 text-brand/80" />
          {tt("secure", lang)}
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// KONSEP ★ — REKOMENDASI (Obsidian Aurora + serif + kartu produk + kaca)
// ============================================================================
function GrandLogin({ variant }: { variant: "desktop" | "mobile" }) {
  const sim = useLoginSim();
  const { lang, tab, switchTab } = sim;

  const card = (
    <div className="relative w-full max-w-md">
      <div aria-hidden className="absolute inset-x-12 top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.05] p-7 shadow-[0_50px_110px_-42px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:p-8">
        <AnimatePresence>{sim.phase === "done" && <SuccessOverlay label={tt("done", lang)} />}</AnimatePresence>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: "easeOut" }}>
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-200/70">{tab === "login" ? "Masuk" : "Registrasi"}</p>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-stone-500">
              <Lock className="h-3 w-3 text-brand/80" />
              TLS
            </span>
          </div>
          <h2 className="mt-2 text-[22px] font-bold tracking-tight text-stone-50">
            {tab === "login" ? tt("welcome", lang) : tt("buatTitle", lang)}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-stone-400">{tab === "login" ? tt("welcomeDesc", lang) : tt("buatDesc", lang)}</p>

          <div className="mt-6 flex rounded-full border border-white/10 bg-white/[0.05] p-1 backdrop-blur-md">
            {(["login", "register"] as const).map((k) => (
              <button key={k} onClick={() => switchTab(k)} className={cn("relative h-9 flex-1 rounded-full text-[12.5px] font-bold transition-colors", tab === k ? "text-stone-950" : "text-stone-400 hover:text-stone-200")}>
                {tab === k && (
                  <motion.span
                    layoutId="grand-tab"
                    className="absolute inset-0 rounded-full bg-gradient-to-r from-brand/40 to-brand/40 shadow-[0_6px_22px_-6px_rgba(16,185,129,0.8)]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative">{k === "login" ? tt("masuk", lang) : tt("buat", lang)}</span>
              </button>
            ))}
          </div>

          <form className="mt-6 space-y-4" onSubmit={sim.submit}>
            {tab === "login" ? (
              <>
                <GlassField id="g-email" label={tt("email", lang)} icon={Mail} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
                <GlassField id="g-pw" label={tt("password", lang)} icon={Lock} type="password" autoComplete="current-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} />
                <div className="flex items-center gap-2.5 rounded-xl border border-amber-200/15 bg-amber-300/[0.06] px-3.5 py-2.5">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-300/80" />
                  <p className="text-[11px] font-semibold text-amber-100/80">{tt("demoChip", lang)}</p>
                </div>
              </>
            ) : (
              <>
                <GlassField id="g-ws" label={tt("ws", lang)} icon={BriefcaseBusiness} placeholder="PT Nusantara Sejahtera" value={sim.ws} onChange={sim.setWs} invalid={!!sim.err} />
                <GlassField id="g-nm" label={tt("name", lang)} icon={Users} autoComplete="name" placeholder="Budi Santoso" value={sim.name} onChange={sim.setName} />
                <GlassField id="g-re" label={tt("email", lang)} icon={Mail} type="email" autoComplete="email" placeholder="nama@perusahaan.id" value={sim.email} onChange={sim.setEmail} invalid={!!sim.err} />
                <GlassField id="g-rp" label={tt("password", lang)} icon={Lock} type="password" autoComplete="new-password" placeholder="••••••••" value={sim.pw} onChange={sim.setPw} hint={tt("pwHint", lang)} />
              </>
            )}
            <SimError err={sim.err} />
            <ShineCTA onClick={() => sim.submit()} busy={sim.phase === "busy"}>
              {tab === "login" ? tt("cta", lang) : tt("ctaReg", lang)} <ArrowRight className="h-4 w-4" />
            </ShineCTA>
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <span className="flex items-center gap-1.5 text-[11px] text-stone-500">
                <ShieldCheck className="h-3.5 w-3.5 text-brand/80" />
                {tt("secure", lang)}
              </span>
              <button type="button" onClick={() => switchTab(tab === "login" ? "register" : "login")} className="text-[11px] font-bold text-brand/85 hover:text-brand/75 hover:underline">
                {tab === "login" ? tt("noAcc", lang) : tt("haveAcc", lang)}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </div>
  );

  if (variant === "mobile") {
    return (
      <div className="relative flex h-full flex-col overflow-hidden bg-stone-950 text-stone-200">
        <AuroraField />
        <NoiseOverlay opacity={0.06} />
        <div className="relative z-10 flex items-center justify-between px-5 pt-6">
          <LogoLockup compact />
          <LangPill sim={sim} />
        </div>
        <div className="relative z-10 flex flex-1 items-center justify-center px-5">
          {card}
        </div>
        <div className="relative z-10 px-5 pb-5">
          <GoldHairline />
          <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-600">
            © 2026 OneVity · 6 modul · data terisolasi per tenant
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden bg-stone-950 text-stone-200">
      <AuroraField />
      <NoiseOverlay opacity={0.06} />
      <div className="relative z-10 grid h-full grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
        {/* kiri — editorial + bukti produk */}
        <div className="relative hidden h-full flex-col justify-between p-10 lg:flex xl:p-16">
          <LogoLockup />
          <div className="relative max-w-xl">
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-stone-300 backdrop-blur-md"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-brand/55 shadow-[0_0_10px_2px_rgba(16,185,129,0.8)]" />
              SaaS Multi-Tenant · HR Suite
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.6, ease: "easeOut" }}
              className="mt-6 text-[42px] font-extrabold leading-[1.05] tracking-[-0.025em] text-stone-50 xl:text-[52px]"
            >
              Kesan pertama yang
              <br />
              <span className="bg-gradient-to-r from-brand/30 via-brand/30 to-amber-100 bg-clip-text font-serif italic text-transparent">
                sekelas operasional Anda.
              </span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              className="mt-5 max-w-md text-[14px] leading-relaxed text-stone-400"
            >
              HR, payroll PPh21/BPJS, presensi, cuti, travel &amp; medis — satu platform
              dengan data terisolasi untuk tiap perusahaan.
            </motion.p>
            {/* bukti produk mengambang */}
            <div className="pointer-events-none absolute -right-24 top-6 hidden xl:block">
              <FloatPayroll />
            </div>
            <div className="pointer-events-none absolute -right-36 top-[240px] hidden xl:block">
              <FloatAttendance />
            </div>
          </div>
          <StatRow />
        </div>
        {/* kanan — kartu kaca */}
        <div className="relative flex h-full items-center justify-center p-6 sm:p-10">
          <div aria-hidden className="pointer-events-none absolute inset-y-10 left-0 w-px bg-gradient-to-b from-transparent via-white/12 to-transparent" />
          <div className="absolute right-6 top-6 z-20 sm:right-10 sm:top-10"><LangPill sim={sim} /></div>
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5, ease: "easeOut" }} className="flex w-full justify-center lg:hidden">
            <LogoLockup compact />
          </motion.div>
          <div className="mt-6 flex w-full flex-1 items-start justify-center lg:mt-0 lg:flex-none">
            {card}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// LAB ROOT
// ============================================================================
type OptKey = "now" | "a" | "b" | "c" | "rec";
interface OptionDef {
  key: OptKey;
  tab: string;
  title: string;
  effort: string;
  accent: string;
  changed: string[];
  pros: string[];
  watch: string[];
  verdict?: string;
  render: (variant: "desktop" | "mobile") => ReactNode;
}

const OPTIONS: OptionDef[] = [
  {
    key: "now",
    tab: "0 · Sekarang",
    title: "0 · Desain Saat Ini (Pembanding)",
    effort: "—",
    accent: "#a8a29e",
    changed: ["— (tanpa perubahan; replika desain live untuk pembandingan)"],
    pros: ["Fungsional & jelas: split-panel + kartu + dua bahasa", "Validasi & state error sudah lengkap"],
    watch: [
      "Kesan pertama datar — kartu putih generik, tidak ada momen “mewah”",
      "Panel kiri statis: grid + glow radial hanya hiasan, tanpa kedalaman atau gerak",
      "Mobile: hanya kartu polos di latar putih — kesan “aplikasi template”",
    ],
    render: (v) => <BaselineLogin variant={v} />,
  },
  {
    key: "a",
    tab: "A · Obsidian Aurora",
    title: "A · Obsidian Aurora (Gelap Mewah)",
    effort: "Sedang",
    accent: "#10b981",
    changed: [
      "Latar obsidian penuh: aurora emerald/teal/champagne bergerak lambat + noise film + vignette sinematik",
      "Kartu kaca premium: backdrop-blur, highlight tepi atas, shadow berlapis",
      "Tipografi display besar + kata kunci serif italic gradient emerald→teal→emas",
      "Input kaca berikon dengan glow fokus; CTA gradient dengan sweep kilau berulang",
      "Baris statistik produk dengan hairline emas + angka gradient",
    ],
    pros: [
      "Kesan premium instan — bahasa visual fintech/enterprise kelas atas",
      "Aurora memberi kedalaman tanpa foto stok; tetap ringan (CSS + motion)",
      "Cocok dengan identitas gelap panel kiri yang sudah ada — evolusi, bukan revolusi",
    ],
    watch: [
      "Kontras teks harus dijaga (WCAG): teks sekunder minimal stone-400",
      "Backdrop-blur berat di perangkat lawas — perlu fallback",
      "Area kanan app live terang → gerbang gelap adalah pilihan tema (putuskan sadar)",
    ],
    render: (v) => <AuroraLogin variant={v} />,
  },
  {
    key: "b",
    tab: "B · Ivory Editorial",
    title: "B · Ivory Editorial (Quiet Luxury)",
    effort: "Rendah–Sedang",
    accent: "#b45309",
    changed: [
      "Latar ivory hangat + bingkai hairline tipis + grid editorial yang tenang",
      "Tipografi serif display (Georgia) dengan kata italic beraksen amber",
      "Input underline minimal (fashion-grade) tanpa kotak; caret amber",
      "CTA hitam solid dengan peluncuran panah; marquee nama klien bergulir",
      "Testimonial bintang lima + kutipan serif italic",
    ],
    pros: [
      "“Quiet luxury” — bersih, tenang, khas brand jasa/fashion premium",
      "Paling ringan & cepat: tanpa blur/gradient berat, sangat aksesibel",
      "Konsisten dengan tema terang halaman login saat ini (transisi paling mulus)",
    ],
    watch: [
      "Input underline butuh indikator fokus kuat untuk aksesibilitas",
      "Serif sistem (Georgia) — fase produksi bisa naik ke display serif asli (mis. Playfair)",
      "Marquee wajib hormati prefers-reduced-motion saat produksi",
    ],
    render: (v) => <EditorialLogin variant={v} />,
  },
  {
    key: "c",
    tab: "C · Glass Showcase",
    title: "C · Glass Showcase (Futuristik)",
    effort: "Sedang",
    accent: "#2dd4bf",
    changed: [
      "Satu kolom terpusat di atas mesh gradient multi-warna + grid samar",
      "Kartu produk mini (payroll, persetujuan, kehadiran) mengambang & beranimasi",
      "Kartu kaca tengah ringkas — fokus penuh ke form",
      "CTA gradient teal dengan glow dan sweep kilau",
    ],
    pros: [
      "Memperlihatkan produk sejak detik pertama — bukti nyata, bukan klaim",
      "Terpusat: tingkat fokus & konversi form terbaik di antara semua konsep",
      "Diferensiasi kuat vs login SaaS generik",
    ],
    watch: [
      "Kartu mengambang wajib disembunyikan di layar kecil (kepadatan visual)",
      "Mesh gradient tidak boleh bersaing dengan kontras form",
      "Gerak harus sangat halus agar tidak terasa “ramai”",
    ],
    render: (v) => <ShowcaseLogin variant={v} />,
  },
  {
    key: "rec",
    tab: "★ Rekomendasi",
    title: "★ Rekomendasi — Aurora + Editorial + Showcase",
    effort: "Sedang–Tinggi",
    accent: "#f59e0b",
    changed: [
      "Latar Obsidian Aurora (A) + tipografi serif gradient (B) + kartu bukti produk (C)",
      "Kartu kaca dengan input berikon, CTA gradient sweep kilau, hairline emas & statistik",
      "Chip kredensial demo di dalam form — evaluator langsung bisa mencoba",
      "Mobile: aurora tetap hidup penuh, kartu ringkas terpusat, lockup logo di atas",
      "Saklar bahasa ID/EN tetap berfungsi (pratinjau ini punya saklarnya — coba!)",
    ],
    pros: [
      "Kesan mewah paling kuat sekaligus informatif — setiap elemen punya alasan",
      "Bukti produk mengambang memberi kredibilitas sejak layar pertama",
      "Skalabel: token warna mudah diselaraskan dengan identitas per modul",
    ],
    watch: [
      "Implementasi produksi perlu perhatian kontras & prefers-reduced-motion",
      "Hanya gerbang auth (login + pilih workspace) yang naik kelas — shell app tidak berubah",
    ],
    verdict:
      "Gelap mewah untuk kesan, serif untuk karakter, bukti produk untuk kredibilitas — kombinasi paling “mahal” yang tetap fungsional.",
    render: (v) => <GrandLogin variant={v} />,
  },
];

function NotesPanel({ opt }: { opt: OptionDef }) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-extrabold tracking-tight text-stone-50">{opt.title}</h3>
        <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400">{opt.effort}</span>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Apa yang berubah</p>
        <ul className="mt-1.5 space-y-1.5">
          {opt.changed.map((t) => (
            <li key={t} className="flex gap-2 text-[12px] leading-relaxed text-stone-300">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: opt.accent }} />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Kelebihan</p>
        <ul className="mt-1.5 space-y-1.5">
          {opt.pros.map((t) => (
            <li key={t} className="flex gap-2 text-[12px] leading-relaxed text-stone-300">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand/85" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Perlu diperhatikan</p>
        <ul className="mt-1.5 space-y-1.5">
          {opt.watch.map((t) => (
            <li key={t} className="flex gap-2 text-[12px] leading-relaxed text-stone-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/80" />
              {t}
            </li>
          ))}
        </ul>
      </div>
      {opt.verdict && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
          <div className="flex gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: opt.accent }} />
            <p className="text-[12px] font-semibold leading-relaxed text-stone-200">{opt.verdict}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function BrowserFrame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-stone-900 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-white/[0.07] bg-stone-900 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-brand/55/70" />
        <div className="ml-3 flex-1 truncate rounded-md bg-white/[0.05] px-3 py-1 text-[11px] font-medium text-stone-500">
          onevity.sayone.my.id · pratinjau desain halaman masuk
        </div>
        <span className="w-12" />
      </div>
      <div className="h-[640px] bg-white sm:h-[680px]">{children}</div>
    </div>
  );
}

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-[390px] max-w-full">
      <div className="relative overflow-hidden rounded-[2.6rem] border border-stone-700 bg-stone-950 shadow-2xl ring-8 ring-stone-800/80">
        <div aria-hidden className="absolute left-1/2 top-2.5 z-50 h-5 w-24 -translate-x-1/2 rounded-full bg-stone-800" />
        <div className="relative h-[760px] overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

export function AuthDesignLab() {
  const [opt, setOpt] = useState<OptKey>("now");
  const active = OPTIONS.find((o) => o.key === opt)!;

  return (
    <div className="relative min-h-screen bg-stone-950 text-stone-100">
      {/* latar studio */}
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(600px circle at 15% 0%, rgba(16,185,129,0.13), transparent 45%), radial-gradient(700px circle at 85% 100%, rgba(245,158,11,0.09), transparent 45%), linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 32px 32px, 32px 32px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        {/* header */}
        <header className="flex items-center justify-between gap-4 py-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand/60 to-brand shadow-lg shadow-brand/85/40">
              <Waypoints className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-[15px] font-extrabold leading-tight tracking-tight text-white">
                OneVity <span className="text-brand/85">Design Lab</span>
              </p>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-stone-500">Preview desain halaman masuk</p>
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-stone-300 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
          >
            Buka aplikasi <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </header>

        {/* hero */}
        <div className="pt-2">
          <h1 className="max-w-2xl text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Lima konsep halaman masuk — rasakan kesan pertamanya
          </h1>
          <p className="mt-3 max-w-3xl text-[13.5px] leading-relaxed text-stone-400">
            Halaman masuk adalah kesan pertama pengguna terhadap produk. Lab ini merender konsep secara{" "}
            <span className="font-bold text-stone-200">interaktif penuh</span>: ketik email, coba submit kosong (validasi hidup),
            ganti tab Masuk/Buat Workspace, dan saklar bahasa ID/EN di pojok. Halaman login live{" "}
            <span className="font-bold text-brand/85">tidak tersentuh sama sekali</span> sampai Anda memilih.
          </p>
        </div>

        {/* tab opsi */}
        <div role="tablist" aria-label="Pilihan konsep" className="mt-6 flex flex-wrap gap-2">
          {OPTIONS.map((o) => {
            const isOn = o.key === opt;
            return (
              <button
                key={o.key}
                role="tab"
                aria-selected={isOn}
                onClick={() => setOpt(o.key)}
                className={cn(
                  "rounded-full border px-4 py-2 text-[12.5px] font-bold transition",
                  isOn
                    ? "border-transparent bg-stone-100 text-stone-950 shadow-lg"
                    : "border-white/15 text-stone-400 hover:border-white/30 hover:bg-white/5 hover:text-stone-200",
                  o.key === "rec" && !isOn && "border-amber-500/30 text-amber-300 hover:border-amber-500/50 hover:bg-amber-500/5 hover:text-amber-200",
                )}
              >
                {o.tab}
              </button>
            );
          })}
        </div>

        {/* stage + catatan */}
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0">
            <BrowserFrame key={`desk-${opt}`}>{active.render("desktop")}</BrowserFrame>
            <p className="mt-3 flex items-center gap-2 text-[11.5px] text-stone-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-brand/70" />
              Form di atas hidup: ketik, submit (loading → sukses), ganti tab &amp; bahasa.
            </p>

            <div className="mt-6 flex flex-wrap items-start justify-center gap-6">
              <PhoneFrame key={`phone-${opt}`}>{active.render("mobile")}</PhoneFrame>
              <div className="max-w-[240px] pt-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-stone-500">Pratinjau mobile 390px</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-400">
                  Setengah trafik pertama datang dari ponsel — tiap konsep punya varian{" "}
                  <span className="font-bold text-stone-200">mobile tersendiri</span> (bukan sekadar menyembunyikan panel kiri).
                </p>
              </div>
            </div>
          </div>
          <NotesPanel key={`notes-${opt}`} opt={active} />
        </div>

        {/* footer */}
        <footer className="mt-10 border-t border-white/[0.07] pt-5">
          <p className="text-[11px] leading-relaxed text-stone-500">
            OneVity Design Lab · mockup interaktif untuk pengambilan keputusan — bukan kode produksi.
            Angka (Rp 531,7 jt, 96%, 44/44) merupakan data contoh dari seed demo. Fase produksi akan menghormati kontras WCAG
            &amp; prefers-reduced-motion, dan mengganti serif sistem dengan display serif bila konsep editorial dipilih.
          </p>
        </footer>
      </div>
    </div>
  );
}
