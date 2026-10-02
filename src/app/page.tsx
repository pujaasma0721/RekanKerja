"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useNav, useUiMode } from "@/rekankerja/shared/lib/store";
import { useApi } from "@/rekankerja/shared/lib/api";
import { useSession } from "@/rekankerja/shared/lib/session-store";
import { AuthGate } from "@/rekankerja/shared/components/auth/auth-gate";
import { AppShell } from "@/rekankerja/shared/components/shell/app-shell";
import { EssShell } from "@/rekankerja/ess/components/ess-shell";
import { I18nProvider, useI18n } from "@/rekankerja/shared/lib/i18n";
// Design Lab — mockup desain menu (terisolasi, akses ?mockup=menu; bukan produksi)
import { MenuDesignLab } from "@/rekankerja/shared/components/design/menu-design-lab";
// Design Lab — mockup desain halaman masuk (terisolasi, akses ?mockup=auth)
import { AuthDesignLab } from "@/rekankerja/shared/components/design/auth-design-lab";
import { DashboardModule } from "@/rekankerja/shared/components/dashboard/dashboard-module";
// PWA (Task 27-d) — registrasi service worker + banner instal aplikasi
import { PwaRegister } from "@/rekankerja/shared/components/pwa/pwa-register";
// Task 96 — widget chat AI mengambang (admin + ESS, self-gate via sesi)
import { AiChatWidget } from "@/rekankerja/shared/components/ai-chat/ai-chat-widget";
import { OrgModule } from "@/rekankerja/human-resource/components/org/org-module";
import { PositionModule } from "@/rekankerja/human-resource/components/position/position-module";
import { EmployeeModule } from "@/rekankerja/human-resource/components/employee/employee-module";
import { HrReportsView } from "@/rekankerja/human-resource/components/hr-reports-view";
// wave 28 stub — report builder kustom (Task 28-b)
import { CustomReportsView } from "@/rekankerja/human-resource/components/custom-reports/custom-reports-view";
import { ActionsModule } from "@/rekankerja/human-resource/components/actions/actions-module";
import { PayrollModule } from "@/rekankerja/payroll/components/payroll-module";
import { AttendanceModule } from "@/rekankerja/time-attendance/components/attendance-module";
import { LeaveModule } from "@/rekankerja/leave/components/leave-module";
import { TravelModule } from "@/rekankerja/travel/components/travel-module";
import { MedicalModule } from "@/rekankerja/medical/components/medical-module";
// Task 52-f — modul whistleblowing (TPKS UU 12/2022): kanal laporan anonim
// + penanganan (triase) oleh tim berwenang.
import { WhistleblowModule } from "@/rekankerja/whistleblow/components/whistleblow-module";
import { SettingsModule } from "@/rekankerja/shared/components/settings/settings-module";
import { isPublicMenuKey } from "@/rekankerja/shared/lib/public-menus";
import { Loader2, Waypoints } from "lucide-react";

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
  useEffect(() => {
    if (session.status !== "ready" || !meMenu.data) return;
    const d = meMenu.data;
    const adminMenus = (d.menus ?? []).filter((k) => !isPublicMenuKey(k));
    const noAdminMenu = !d.all && adminMenus.length === 0 && !d.isSuperAdmin;
    useUiMode.getState().setAutoMode(noAdminMenu ? "ess" : "admin");
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
