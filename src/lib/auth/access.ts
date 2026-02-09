import type {
  AppUser,
  WarehouseAccess,
  WarehouseKey,
  WarehouseRole,
  WarehouseTab
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

export const isHeadAdmin = (user: AppUser | null | undefined) =>
  Boolean(user?.role === 'HEAD_ADMIN');

export const isWarehouseAdmin = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) =>
  Boolean(
    isHeadAdmin(user) ||
      (user?.role === 'ADMIN' && user?.access?.warehouses?.[warehouse]?.admin)
  );

export const getAdminWarehouses = (
  user: AppUser | null | undefined
): WarehouseKey[] => {
  if (!user) return [];
  if (isHeadAdmin(user)) return ['PRZEMIALY', 'CZESCI', 'RAPORT_ZMIANOWY'];
  if (user.role !== 'ADMIN') return [];
  return Object.entries(user.access.warehouses)
    .filter(([, value]) => Boolean(value?.admin))
    .map(([key]) => key as WarehouseKey);
};

export const hasAnyAdminAccess = (user: AppUser | null | undefined) => {
  if (!user) return false;
  if (isHeadAdmin(user)) return true;
  if (user.role !== 'ADMIN') return false;
  return Object.values(user.access.warehouses).some((entry) => Boolean(entry?.admin));
};

export const getRoleLabel = (user: AppUser | null | undefined, warehouse: WarehouseKey | null) => {
  if (!user) return 'Gość';
  if (isHeadAdmin(user)) return 'Head admin';
  if (warehouse && isWarehouseAdmin(user, warehouse)) return 'Administrator';
  return 'Użytkownik';
};

export const getAccessibleWarehouses = (user: AppUser | null | undefined): WarehouseKey[] => {
  if (!user) return [];
  if (isHeadAdmin(user)) return ['PRZEMIALY', 'CZESCI', 'RAPORT_ZMIANOWY'];
  return Object.keys(user.access.warehouses) as WarehouseKey[];
};

export const canAccessWarehouse = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) => {
  if (!user) return false;
  if (isHeadAdmin(user)) return true;
  return Boolean(user.access.warehouses[warehouse]);
};

export const canSeeTab = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey,
  tab: WarehouseTab
) => {
  if (!user) return false;
  if (isHeadAdmin(user) || isWarehouseAdmin(user, warehouse)) return true;
  if (warehouse === 'CZESCI' && tab === 'historia') return false;
  return Boolean(user.access.warehouses[warehouse]?.tabs?.includes(tab));
};

export const isReadOnly = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) => {
  if (!user) return true;
  if (isHeadAdmin(user) || isWarehouseAdmin(user, warehouse)) return false;
  return user.access.warehouses[warehouse]?.readOnly ?? true;
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
  if (warehouse === 'RAPORT_ZMIANOWY') return 'Raport zmianowy';
  return 'Magazyn';
};
