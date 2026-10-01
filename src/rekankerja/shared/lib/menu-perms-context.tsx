"use client";
// RekanKerja — context hak AKSI menu per pengguna (Task 32) ==================
// =====================================================================
// Provider dipasang AppShell (memakai data ?action=me yang sama); view
// mana pun di dalam shell memakai:
//   const perms = useMenuPerms();
//   perms.can("hr", "directory", "create")      // tombol "Baru"
//   perms.can("hr", "directory", "update")      // tombol "Ubah"
//   perms.can("hr", "directory", "delete")      // tombol "Hapus"
//   perms.canOp("leave", "leave-approval", "approve")  // operasi khusus
// Konfigurasi belum termuat (ready=false) → sementara semua boleh
// (menghindari flicker/lockout — sama dengan perilaku menu Task 31).
// =====================================================================
import { createContext, useContext, type ReactNode } from "react";
import { actionAllowed, fullPerm, noPerm, opAllowed, type MenuAction, type MenuPerm, type MenusMap } from "./menu-perms";

export interface MenuPermsApi {
  /** false = konfigurasi masih dimuat → perlakukan semua boleh. */
  ready: boolean;
  /** mode Semua (default / super admin) → semua menu & aksi. */
  all: boolean;
  isSuperAdmin: boolean;
  /** Izin efektif sebuah menu (all → izin penuh; tak terdaftar → kosong). */
  permOf: (module: string, itemId: string) => MenuPerm;
  /** Hak aksi dasar (view/create/update/delete) pada module:view. */
  can: (module: string, itemId: string, action: MenuAction) => boolean;
  /** Hak operasi khusus (approve, calculate, settle, …) pada module:view. */
  canOp: (module: string, itemId: string, opKey: string) => boolean;
}

const ALLOW_ALL: MenuPermsApi = {
  ready: false,
  all: true,
  isSuperAdmin: false,
  permOf: () => fullPerm(),
  can: () => true,
  canOp: () => true,
};

const MenuPermsContext = createContext<MenuPermsApi>(ALLOW_ALL);

export function MenuPermsProvider({
  all,
  isSuperAdmin,
  ready,
  perms,
  children,
}: {
  all: boolean;
  isSuperAdmin: boolean;
  ready: boolean;
  perms?: MenusMap;
  children: ReactNode;
}) {
  const api: MenuPermsApi = {
    ready,
    all,
    isSuperAdmin,
    permOf: (module, itemId) => {
      if (all) return fullPerm();
      const p = perms?.[`${module}:${itemId}`];
      return p ?? noPerm();
    },
    can: (module, itemId, action) => {
      if (all) return true;
      const p = perms?.[`${module}:${itemId}`];
      if (!p || !p.view) return false;
      return actionAllowed(p, action);
    },
    canOp: (module, itemId, opKey) => {
      if (all) return true;
      const p = perms?.[`${module}:${itemId}`];
      if (!p || !p.view) return false;
      return opAllowed(p, opKey);
    },
  };
  return <MenuPermsContext.Provider value={api}>{children}</MenuPermsContext.Provider>;
}

/** Hook hak aksi menu pengguna sesi — gunakan di dalam AppShell. */
export function useMenuPerms(): MenuPermsApi {
  return useContext(MenuPermsContext);
}
