"use client";
import { Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useNav, useUiMode } from "@/rekankerja/shared/lib/store";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { AuthGate } from "@/rekankerja/shared/components/auth/auth-gate";
import { AppShell } from "@/rekankerja/shared/components/shell/app-shell";
import { EssShell } from "@/rekankerja/ess/components/ess-shell";
import { I18nProvider, useI18n } from "@/rekankerja/shared/lib/i18n";
import { DashboardModule } from "@/rekankerja/shared/components/dashboard/dashboard-module";
// PWA (Task 27-d) — registrasi service worker + banner instal aplikasi
import { PwaRegister } from "@/rekankerja/shared/components/pwa/pwa-register";
import { isPublicMenuKey } from "@/rekankerja/shared/lib/public-menus";
import { Loader2, Waypoints } from "lucide-react";

// ============ AUD-DEPLOY (3-b CRIT-1): code splitting per modul ============
// Dulu: 13 modul (±50K LOC client: payroll/attendance/travel/medical/…)
// + 2 design lab + widget AI (react-markdown) di-import STATIS ke SATU
// bundle — semua pengguna mengunduh semua modul sebelum interaktif.
// kini: next/dynamic ssr:false (halaman sepenuhnya client-render di balik
// AuthGate — modul tak pernah bermakna di SSR) → chunk per modul dimuat
// saat pertama dibuka; login/dashboard tetap instan. Fallback: skeleton.
const ModuleLoading = () => (
  <div className="grid min-h-[60vh] place-items-center" role="status" aria-label="Loading">
    <Loader2 className="h-6 w-6 animate-spin text-amber-700 dark:text-amber-500" aria-hidden />
  </div>
);

// Human Resource
const OrgModule = dynamic(() => import("@/rekankerja/human-resource/components/org/org-module").then((m) => ({ default: m.OrgModule })), { ssr: false, loading: ModuleLoading });
const PositionModule = dynamic(() => import("@/rekankerja/human-resource/components/position/position-module").then((m) => ({ default: m.PositionModule })), { ssr: false, loading: ModuleLoading });
const EmployeeModule = dynamic(() => import("@/rekankerja/human-resource/components/employee/employee-module").then((m) => ({ default: m.EmployeeModule })), { ssr: false, loading: ModuleLoading });
const ActionsModule = dynamic(() => import("@/rekankerja/human-resource/components/actions/actions-module").then((m) => ({ default: m.ActionsModule })), { ssr: false, loading: ModuleLoading });
const HrReportsView = dynamic(() => import("@/rekankerja/human-resource/components/hr-reports-view").then((m) => ({ default: m.HrReportsView })), { ssr: false, loading: ModuleLoading });
// wave 28 stub — report builder kustom (Task 28-b)
const CustomReportsView = dynamic(() => import("@/rekankerja/human-resource/components/custom-reports/custom-reports-view").then((m) => ({ default: m.CustomReportsView })), { ssr: false, loading: ModuleLoading });
// Modul lain
const PayrollModule = dynamic(() => import("@/rekankerja/payroll/components/payroll-module").then((m) => ({ default: m.PayrollModule })), { ssr: false, loading: ModuleLoading });
const AttendanceModule = dynamic(() => import("@/rekankerja/time-attendance/components/attendance-module").then((m) => ({ default: m.AttendanceModule })), { ssr: false, loading: ModuleLoading });
const LeaveModule = dynamic(() => import("@/rekankerja/leave/components/leave-module").then((m) => ({ default: m.LeaveModule })), { ssr: false, loading: ModuleLoading });
const TravelModule = dynamic(() => import("@/rekankerja/travel/components/travel-module").then((m) => ({ default: m.TravelModule })), { ssr: false, loading: ModuleLoading });
const MedicalModule = dynamic(() => import("@/rekankerja/medical/components/medical-module").then((m) => ({ default: m.MedicalModule })), { ssr: false, loading: ModuleLoading });
// Task 52-f — modul whistleblowing (TPKS UU 12/2022): kanal laporan anonim
// + penanganan (triase) oleh tim berwenang.
const WhistleblowModule = dynamic(() => import("@/rekankerja/whistleblow/components/whistleblow-module").then((m) => ({ default: m.WhistleblowModule })), { ssr: false, loading: ModuleLoading });
const SettingsModule = dynamic(() => import("@/rekankerja/shared/components/settings/settings-module").then((m) => ({ default: m.SettingsModule })), { ssr: false, loading: ModuleLoading });
// Task 96 — widget chat AI mengambang (admin + ESS, self-gate via sesi):
// stack react-markdown/SDK dimuat off the critical path.
const AiChatWidget = dynamic(() => import("@/rekankerja/shared/components/ai-chat/ai-chat-widget").then((m) => ({ default: m.AiChatWidget })), { ssr: false, loading: ModuleLoading });
// Design Lab — mockup desain (terisolasi, ?mockup=menu / ?mockup=auth;
// bukan produksi) — chunk hanya dimuat bila mode mockup dipakai.
const MenuDesignLab = dynamic(() => import("@/rekankerja/shared/components/design/menu-design-lab").then((m) => ({ default: m.MenuDesignLab })), { ssr: false, loading: ModuleLoading });
const AuthDesignLab = dynamic(() => import("@/rekankerja/shared/components/design/auth-design-lab").then((m) => ({ default: m.AuthDesignLab })), { ssr: false, loading: ModuleLoading });

export default function Page() {
  // useSearchParams butuh boundary Suspense pada halaman statis (Next 16)
  return (
    <Suspense fallback={null}>
      <PageInner />
    </Suspense>
  );
}

/** Splash singkat saat mode UI masih diputuskan (session ready, hak menu termuat). */
function ModeSplash() {
  const { t } = useI18n();
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-[0_10px_28px_-12px_rgba(28,25,23,0.7)] dark:bg-slate-100 dark:text-slate-900 dark:shadow-none">
          <Waypoints className="h-7 w-7" aria-hidden />
        </div>
        <div className="flex items-center gap-2 text-[13px] font-medium text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-amber-700 dark:text-amber-500" aria-hidden />
          {t("Menyiapkan ruang kerja Anda…", "Preparing your workspace…")}
        </div>
      </div>
    </div>
  );
}

function PageInner() {
  // Hooks dipanggil selalu (sebelum branch mockup) agar urutan konsisten.
  const { section, view, syncFromUrl } = useNav();
  const searchParams = useSearchParams();
  const session = useSession();
  const uiMode = useUiMode((s) => s.uiMode);
  const modeOverride = useUiMode((s) => s.override);

  useEffect(() => { syncFromUrl(); }, [syncFromUrl]);

  // ===== MODE UI (T8): hydrate preferensi tersimpan sekali, SEBELUM session
  // ready — tidak ada kedip shell yang salah.
  useEffect(() => { useUiMode.getState().hydrate(); }, []);

  // Hak menu admin pengguna sesi (dipakai untuk auto-deteksi mode default).
  // Hanya di-fetch saat session ready (menghindari 401 sia-sia saat anonim).
  const meMenu = useApi<{ all: boolean; menus: string[]; isSuperAdmin: boolean }>(
    session.status === "ready" ? "/api/rekankerja/user-menu-access?action=me" : null,
    [session.status],
  );

  // Auto-deteksi mode default: pengguna TANPA menu admin apa pun → otomatis ESS.
  // Tidak menimpa pilihan eksplisit pengguna (override di store).
  // Task 52-f — menu PUBLIK (whistleblowing:report — kanal TPKS semua pekerja)
  // TIDAK dihitung sebagai menu admin: pemiliknya tetap masuk mode ESS.
  // Task role-ess — override "admin" basi (disimpan sebelum role diubah ke
  // ESS / sebelum seluruh menu dicabut) dibersihkan supaya pengguna tidak
  // terjebak di shell admin kosong; pemilik role ESS selalu mendarat di ESS.
  useEffect(() => {
    if (session.status !== "ready" || !meMenu.data) return;
    const d = meMenu.data;
    const adminMenus = (d.menus ?? []).filter((k) => !isPublicMenuKey(k));
    const noAdminMenu = !d.all && adminMenus.length === 0 && !d.isSuperAdmin;
    const st = useUiMode.getState();
    if (noAdminMenu && st.override === "admin") {
      useUiMode.setState({ override: null, uiMode: "ess" });
    }
    st.setAutoMode(noAdminMenu ? "ess" : "admin");
  }, [session.status, meMenu.data]);

  // Mode mockup desain menu (?mockup=menu) — render lab tanpa AuthGate/shell,
  // benar-benar terisolasi dari menu live (dan dari provider bahasa).
  if (searchParams.get("mockup") === "menu") return <MenuDesignLab />;

  // Mode mockup desain halaman masuk (?mockup=auth) — lab login terisolasi;
  // halaman login live tidak tersentuh sampai pilihan desain diambil.
  if (searchParams.get("mockup") === "auth") return <AuthDesignLab />;

  // Mode UI masih diputuskan (session ready, belum ada override, hak menu
  // belum termuat) → splash agar tidak berkedip shell admin.
  const deciding = session.status === "ready" && !modeOverride && !meMenu.data && !meMenu.error;

  return (
    <I18nProvider>
      <AuthGate>
      {deciding ? (
        <ModeSplash />
      ) : uiMode === "ess" ? (
        <EssShell />
      ) : (
        <AppShell>
        <AnimatePresence mode="wait">
          <motion.div
            key={`${section}-${view}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {section === "dashboard" && <DashboardModule />}
            {section === "org" && <OrgModule view={view} />}
            {section === "position" && <PositionModule view={view} />}
            {section === "employee" && <EmployeeModule view={view} />}
            {section === "actions" && <ActionsModule view={view} />}
            {section === "reports" && (view === "custom-reports" ? <CustomReportsView /> : <HrReportsView />)}
            {section === "payroll" && <PayrollModule view={view} />}
            {section === "attendance" && <AttendanceModule view={view} />}
            {section === "leave" && <LeaveModule view={view} />}
            {section === "travel" && <TravelModule view={view} />}
            {section === "settings" && <SettingsModule view={view} />}
            {section === "medical" && <MedicalModule view={view} />}
            {section === "whistleblowing" && <WhistleblowModule view={view} />}
          </motion.div>
        </AnimatePresence>
      </AppShell>
      )}
      </AuthGate>
      <AiChatWidget />
      <PwaRegister />
    </I18nProvider>
  );
}
