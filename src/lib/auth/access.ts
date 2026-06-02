import type {
  AppUser,
  WarehouseAccess,
  WarehouseKey,
  WarehouseRole,
  WarehouseTab,
  PaintTapePermissionKey,
  PaintTapePermissions
} from '@/lib/api/types';

export const PRZEMIALY_TABS: WarehouseTab[] = [
  'dashboard',
  'spis',
  'spis-oryginalow',
  'przesuniecia',
  'raporty',
  'kartoteka',
  'wymieszane',
  'suszarki'
];

export const CZESCI_TABS: WarehouseTab[] = ['pobierz', 'uzupelnij', 'stany', 'historia'];
export const RAPORT_ZMIANOWY_TABS: WarehouseTab[] = ['raport-zmianowy'];
export const BILANS_PRZEZBROJEN_TABS: WarehouseTab[] = ['bilans-przezbrojen'];
export const FARBY_TASMY_TABS: WarehouseTab[] = ['rozliczanie-farb-tasm'];
export const PAINT_TAPE_PERMISSION_KEYS: PaintTapePermissionKey[] = [
  'create',
  'open',
  'details',
  'accounting',
  'celebration'
];
export const DEFAULT_PAINT_TAPE_PERMISSIONS: PaintTapePermissions = {
  create: true,
  open: true,
  details: true,
  accounting: true,
  celebration: true
};
export const ERP_TRANSFERS_TABS: WarehouseTab[] = [
  'erp-magazynier',
  'erp-rozdzielca',
  'erp-rozdzielca-zmianowy',
  'erp-wypisz-dokument',
  'erp-historia-dokumentow'
];

export const isHeadAdmin = (user: AppUser | null | undefined) =>
  Boolean(user?.role === 'HEAD_ADMIN');

export const isWarehouseAdmin = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) =>
  Boolean(
    isHeadAdmin(user) ||
      (user?.role === 'ADMIN' &&
        (user?.access?.warehouses?.[warehouse]?.admin ||
          (warehouse === 'FARBY_TASMY' && user?.access?.warehouses?.PRZEMIALY?.admin)))
  );

const hasLegacyPaintTapeAccess = (user: AppUser | null | undefined) => {
  if (!user) return false;
  if (isHeadAdmin(user)) return true;
  const warehouses = user.access?.warehouses ?? {};
  if (warehouses.FARBY_TASMY) return true;
  if (user.role === 'ADMIN' && warehouses.PRZEMIALY?.admin) return true;
  return Boolean(warehouses.PRZEMIALY?.tabs?.includes('spis-oryginalow'));
};

const allWarehouseKeys: WarehouseKey[] = [
  'PRZEMIALY',
  'FARBY_TASMY',
  'CZESCI',
  'RAPORT_ZMIANOWY',
  'BILANS_PRZEZBROJEN',
  'PRZESUNIECIA_ERP'
];

export const getAdminWarehouses = (
  user: AppUser | null | undefined
): WarehouseKey[] => {
  if (!user) return [];
  if (isHeadAdmin(user)) return allWarehouseKeys;
  if (user.role !== 'ADMIN') return [];
  return Object.entries(user.access?.warehouses ?? {})
    .filter(([, value]) => Boolean(value?.admin))
    .map(([key]) => key as WarehouseKey);
};

export const hasAnyAdminAccess = (user: AppUser | null | undefined) => {
  if (!user) return false;
  if (isHeadAdmin(user)) return true;
  if (user.role !== 'ADMIN') return false;
  return Object.values(user.access?.warehouses ?? {}).some((entry) => Boolean(entry?.admin));
};

export const getRoleLabel = (user: AppUser | null | undefined, warehouse: WarehouseKey | null) => {
  if (!user) return 'Gość';
  if (isHeadAdmin(user)) return 'Head admin';
  if (warehouse && isWarehouseAdmin(user, warehouse)) return 'Administrator';
  return 'Użytkownik';
};

export const getAccessibleWarehouses = (user: AppUser | null | undefined): WarehouseKey[] => {
  if (!user) return [];
  if (isHeadAdmin(user)) return allWarehouseKeys;
  const keys = new Set(Object.keys(user.access?.warehouses ?? {}) as WarehouseKey[]);
  if (hasLegacyPaintTapeAccess(user)) keys.add('FARBY_TASMY');
  return [...keys];
};

export const canAccessWarehouse = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) => {
  if (!user) return false;
  if (isHeadAdmin(user)) return true;
  if (warehouse === 'FARBY_TASMY') return hasLegacyPaintTapeAccess(user);
  return Boolean(user.access?.warehouses?.[warehouse]);
};

export const canSeeTab = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey,
  tab: WarehouseTab
) => {
  if (!user) return false;
  if (isHeadAdmin(user) || isWarehouseAdmin(user, warehouse)) return true;
  if (warehouse === 'FARBY_TASMY') {
    if (tab !== 'rozliczanie-farb-tasm') return false;
    return hasLegacyPaintTapeAccess(user);
  }
  if (warehouse === 'CZESCI' && tab === 'historia') return false;
  return Boolean(user.access?.warehouses?.[warehouse]?.tabs?.includes(tab));
};

export const isReadOnly = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) => {
  if (!user) return true;
  if (isHeadAdmin(user) || isWarehouseAdmin(user, warehouse)) return false;
  if (warehouse === 'FARBY_TASMY') {
    return (
      user.access?.warehouses?.FARBY_TASMY?.readOnly ??
      user.access?.warehouses?.PRZEMIALY?.readOnly ??
      true
    );
  }
  return user.access?.warehouses?.[warehouse]?.readOnly ?? true;
};

export const getPaintTapePermissions = (
  user: AppUser | null | undefined
): PaintTapePermissions => {
  if (!user) {
    return { create: false, open: false, details: false, accounting: false, celebration: false };
  }
  if (isHeadAdmin(user) || isWarehouseAdmin(user, 'FARBY_TASMY')) {
    return { ...DEFAULT_PAINT_TAPE_PERMISSIONS };
  }
  if (!canSeeTab(user, 'FARBY_TASMY', 'rozliczanie-farb-tasm')) {
    return { create: false, open: false, details: false, accounting: false, celebration: false };
  }
  const raw = user.access?.paintTapePermissions;
  if (!raw) return { ...DEFAULT_PAINT_TAPE_PERMISSIONS };
  return {
    create: raw.create !== false,
    open: raw.open !== false,
    details: raw.details !== false,
    accounting: raw.accounting !== false,
    celebration: raw.celebration !== false
  };
};

export const canUsePaintTapePermission = (
  user: AppUser | null | undefined,
  permission: PaintTapePermissionKey
) => {
  if (!user) return false;
  if (isReadOnly(user, 'FARBY_TASMY')) return false;
  return getPaintTapePermissions(user)[permission];
};

export const getRolePreset = (
  warehouse: WarehouseKey,
  role: WarehouseRole
): WarehouseAccess => {
  if (warehouse === 'CZESCI') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: ['stany'], admin: false };
    }
    return { role, readOnly: false, tabs: ['pobierz', 'uzupelnij', 'stany'], admin: false };
  }
  if (warehouse === 'RAPORT_ZMIANOWY') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: RAPORT_ZMIANOWY_TABS, admin: false };
    }
    return { role, readOnly: false, tabs: RAPORT_ZMIANOWY_TABS, admin: false };
  }
  if (warehouse === 'BILANS_PRZEZBROJEN') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: BILANS_PRZEZBROJEN_TABS, admin: false };
    }
    return { role, readOnly: false, tabs: BILANS_PRZEZBROJEN_TABS, admin: false };
  }
  if (warehouse === 'FARBY_TASMY') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: FARBY_TASMY_TABS, admin: false };
    }
    return { role, readOnly: false, tabs: FARBY_TASMY_TABS, admin: false };
  }
  if (warehouse === 'PRZESUNIECIA_ERP') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: ERP_TRANSFERS_TABS, admin: false };
    }
    return { role, readOnly: false, tabs: ERP_TRANSFERS_TABS, admin: false };
  }

  if (role === 'ROZDZIELCA') {
    return { role, readOnly: false, tabs: PRZEMIALY_TABS, admin: false };
  }
  if (role === 'MECHANIK') {
    return {
      role,
      readOnly: true,
      tabs: ['dashboard', 'raporty', 'kartoteka', 'suszarki', 'spis-oryginalow'],
      admin: false
    };
  }
  return {
    role,
    readOnly: true,
    tabs: ['dashboard', 'raporty', 'kartoteka', 'wymieszane', 'suszarki', 'spis-oryginalow'],
    admin: false
  };
};

export const getWarehouseLabel = (warehouse: WarehouseKey | null) => {
  if (warehouse === 'CZESCI') return 'Magazyn części zamiennych';
  if (warehouse === 'PRZEMIALY')
    return 'Zarządzanie przemiałami i przygotowaniem produkcji';
  if (warehouse === 'FARBY_TASMY') return 'Rozliczanie farb i taśm';
  if (warehouse === 'RAPORT_ZMIANOWY') return 'Raport zmianowy';
  if (warehouse === 'BILANS_PRZEZBROJEN') return 'Bilans przezbrojeń';
  if (warehouse === 'PRZESUNIECIA_ERP') return 'Przesunięcia magazynowe ERP';
  return 'Magazyn';
};

