import type { AppUser, Role, UserAccess } from '@/lib/api/types';

export type DbUserRow = {
  id: string;
  name: string;
  username: string;
  role: Role;
  access: UserAccess | null;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
};

const defaultAccess: UserAccess = { admin: false, warehouses: {} };

const ERP_ACCESS_TABS = new Set([
  'erp-magazynier',
  'erp-rozdzielca',
  'erp-wypisz-dokument',
  'erp-historia-dokumentow'
]);

const cloneAccess = (access: UserAccess): UserAccess => ({
  admin: Boolean(access.admin),
  warehouses: Object.fromEntries(
    Object.entries(access.warehouses).map(([key, value]) => [
      key,
      value ? { ...value, tabs: [...value.tabs] } : value
    ])
  ) as UserAccess['warehouses']
});

const normalizeAccessFromDb = (access: UserAccess | null | undefined): UserAccess => {
  const next = cloneAccess(access ?? defaultAccess);
  const przemialyAccess = next.warehouses.PRZEMIALY;
  if (!przemialyAccess) return next;

  const erpTabs = przemialyAccess.tabs.filter((tab) => ERP_ACCESS_TABS.has(tab));
  if (erpTabs.length > 0) {
    const existingErp = next.warehouses.PRZESUNIECIA_ERP;
    if (existingErp) {
      existingErp.tabs = Array.from(new Set([...existingErp.tabs, ...erpTabs]));
    } else {
      next.warehouses.PRZESUNIECIA_ERP = {
        role: przemialyAccess.role,
        readOnly: przemialyAccess.readOnly,
        admin: przemialyAccess.admin,
        tabs: erpTabs
      };
    }
  }

  przemialyAccess.tabs = przemialyAccess.tabs.filter((tab) => !ERP_ACCESS_TABS.has(tab));
  if (przemialyAccess.tabs.length === 0 && !przemialyAccess.admin) {
    delete next.warehouses.PRZEMIALY;
  }
  return next;
};

export const normalizeAccessForDb = (
  access: UserAccess | null | undefined
): UserAccess | null => {
  if (!access) return null;
  const next = cloneAccess(access);
  const erpAccess = next.warehouses.PRZESUNIECIA_ERP;
  const przemialyAccess = next.warehouses.PRZEMIALY;

  if (erpAccess) {
    const baseTabs = przemialyAccess
      ? przemialyAccess.tabs.filter((tab) => !ERP_ACCESS_TABS.has(tab))
      : [];
    const erpTabs = erpAccess.tabs.filter((tab) => ERP_ACCESS_TABS.has(tab));
    const mergedTabs = Array.from(new Set([...baseTabs, ...erpTabs]));
    next.warehouses.PRZEMIALY = {
      role: przemialyAccess?.role ?? erpAccess.role,
      readOnly: przemialyAccess?.readOnly ?? erpAccess.readOnly,
      admin: przemialyAccess?.admin ?? erpAccess.admin,
      tabs: mergedTabs
    };
    delete next.warehouses.PRZESUNIECIA_ERP;
    return next;
  }

  if (przemialyAccess) {
    przemialyAccess.tabs = przemialyAccess.tabs.filter((tab) => !ERP_ACCESS_TABS.has(tab));
    if (przemialyAccess.tabs.length === 0 && !przemialyAccess.admin) {
      delete next.warehouses.PRZEMIALY;
    }
  }
  return next;
};

export const mapDbUser = (row: DbUserRow): AppUser => ({
  id: row.id,
  name: row.name,
  username: row.username,
  role: row.role,
  access: normalizeAccessFromDb(row.access),
  isActive: row.is_active,
  createdAt: row.created_at,
  lastLogin: row.last_login
});

const knownErrorCodes = [
  'INVALID_CREDENTIALS',
  'INACTIVE',
  'DUPLICATE',
  'NAME_REQUIRED',
  'USERNAME_REQUIRED',
  'PASSWORD_REQUIRED',
  'NOT_FOUND'
];

export const getErrorCode = (message?: string | null, code?: string | null) => {
  const raw = message ?? '';
  const matched = knownErrorCodes.find((item) => raw.includes(item));
  if (matched) return matched;
  if (code === '23505') return 'DUPLICATE';
  return 'UNKNOWN';
};
