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

const roleLabels: Record<WarehouseRole, string> = {
  ROZDZIELCA: 'Rozdzielca',
  MECHANIK: 'Mechanik',
  PODGLAD: 'Podgląd'
};

export const isAdmin = (user: AppUser | null | undefined) =>
  Boolean(user?.access?.admin || user?.role === 'HEAD_ADMIN');

export const getRoleLabel = (user: AppUser | null | undefined, warehouse: WarehouseKey | null) => {
  if (!user) return 'Gość';
  if (isAdmin(user)) return 'Head admin';
  if (!warehouse) return 'Użytkownik';
  const role = user.access.warehouses[warehouse]?.role;
  return role ? roleLabels[role] : 'Użytkownik';
};

export const getAccessibleWarehouses = (user: AppUser | null | undefined): WarehouseKey[] => {
  if (!user) return [];
  if (isAdmin(user)) return ['PRZEMIALY', 'CZESCI', 'RAPORT_ZMIANOWY'];
  return Object.keys(user.access.warehouses) as WarehouseKey[];
};

export const canAccessWarehouse = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return Boolean(user.access.warehouses[warehouse]);
};

export const canSeeTab = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey,
  tab: WarehouseTab
) => {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (warehouse === 'CZESCI' && tab === 'historia') return false;
  return Boolean(user.access.warehouses[warehouse]?.tabs?.includes(tab));
};

export const isReadOnly = (
  user: AppUser | null | undefined,
  warehouse: WarehouseKey
) => {
  if (!user) return true;
  if (isAdmin(user)) return false;
  return user.access.warehouses[warehouse]?.readOnly ?? true;
};

export const getRolePreset = (
  warehouse: WarehouseKey,
  role: WarehouseRole
): WarehouseAccess => {
  if (warehouse === 'CZESCI') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: ['stany'] };
    }
    return { role, readOnly: false, tabs: ['pobierz', 'uzupelnij', 'stany'] };
  }
  if (warehouse === 'RAPORT_ZMIANOWY') {
    if (role === 'PODGLAD') {
      return { role, readOnly: true, tabs: RAPORT_ZMIANOWY_TABS };
    }
    return { role, readOnly: false, tabs: RAPORT_ZMIANOWY_TABS };
  }

  if (role === 'ROZDZIELCA') {
    return { role, readOnly: false, tabs: PRZEMIALY_TABS };
  }
  if (role === 'MECHANIK') {
    return {
      role,
      readOnly: true,
      tabs: ['dashboard', 'raporty', 'kartoteka', 'suszarki', 'spis-oryginalow']
    };
  }
  return {
    role,
    readOnly: true,
    tabs: ['dashboard', 'raporty', 'kartoteka', 'wymieszane', 'suszarki', 'spis-oryginalow']
  };
};

export const getWarehouseLabel = (warehouse: WarehouseKey | null) => {
  if (warehouse === 'CZESCI') return 'Magazyn części zamiennych';
  if (warehouse === 'PRZEMIALY')
    return 'Zarządzanie przemiałami i przygotowaniem produkcji';
  if (warehouse === 'RAPORT_ZMIANOWY') return 'Raport zmianowy';
  return 'Magazyn';
};
