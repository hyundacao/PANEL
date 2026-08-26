import type {
  AppUser,
  PermissionGroup,
  Role,
  UserAccess,
  UserPermissionGroup,
  WarehouseAccess,
  WarehouseKey,
  WarehouseRole,
  WarehouseTab
} from '@/lib/api/types';
import { PAINT_TAPE_PERMISSION_KEYS, WAREHOUSE_TABS_BY_KEY } from '@/lib/auth/access';

export type DbUserRow = {
  id: string;
  name: string;
  username: string;
  role: Role;
  access: (UserAccess & { mustChangePassword?: boolean }) | null;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
};

export type DbPermissionGroupRow = {
  id: string;
  name: string;
  description: string | null;
  access: UserAccess | null;
  is_active: boolean;
  created_at: string;
};

const defaultAccess: UserAccess = { admin: false, warehouses: {} };
const defaultAccessWithPasswordFlag = {
  ...defaultAccess,
  mustChangePassword: false
} as UserAccess & { mustChangePassword?: boolean };
const validWarehouseKeys: WarehouseKey[] = [
  'PRZEMIALY',
  'FARBY_TASMY',
  'CZESCI',
  'RAPORT_ZMIANOWY',
  'RAPORT_BRAKOWOSCI',
  'BILANS_PRZEZBROJEN',
  'PRZYGOTOWANIE_PRODUKCJI',
  'PLANOWANIE_ZAPOTRZEBOWANIA',
  'PRZESUNIECIA_ERP'
];
const validWarehouseRoles: WarehouseRole[] = ['PODGLAD', 'MECHANIK', 'ROZDZIELCA'];
const warehouseRoleWeight: Record<WarehouseRole, number> = {
  PODGLAD: 0,
  MECHANIK: 1,
  ROZDZIELCA: 2
};
const isWarehouseRole = (value: unknown): value is WarehouseRole =>
  typeof value === 'string' &&
  validWarehouseRoles.includes(value as WarehouseRole);

const isWarehouseKey = (value: string): value is WarehouseKey =>
  validWarehouseKeys.includes(value as WarehouseKey);

const toUniqueTabs = (tabs: unknown, warehouse: WarehouseKey): WarehouseTab[] => {
  if (!Array.isArray(tabs)) return [];
  const unique = new Set<WarehouseTab>();
  tabs.forEach((tab) => {
    if (typeof tab === 'string' && WAREHOUSE_TABS_BY_KEY[warehouse].includes(tab as WarehouseTab)) {
      unique.add(tab as WarehouseTab);
    }
  });
  return Array.from(unique);
};

const normalizeWarehouseAccess = (value: unknown, warehouse: WarehouseKey): WarehouseAccess | null => {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const role = isWarehouseRole(entry.role) ? entry.role : 'PODGLAD';
  const tabs = toUniqueTabs(entry.tabs, warehouse);
  const hasOnlyLegacyTabs = Array.isArray(entry.tabs) && entry.tabs.length > 0 && tabs.length === 0;
  return {
    role,
    readOnly: entry.readOnly !== false,
    // Older versions saved the wrong tab set for Preparation Production.
    tabs: warehouse === 'PRZYGOTOWANIE_PRODUKCJI' && hasOnlyLegacyTabs
      ? [...WAREHOUSE_TABS_BY_KEY.PRZYGOTOWANIE_PRODUKCJI]
      : tabs,
    admin: Boolean(entry.admin)
  };
};

const mergeWarehouseAccess = (
  left: WarehouseAccess,
  right: WarehouseAccess
): WarehouseAccess => {
  const role =
    warehouseRoleWeight[right.role] > warehouseRoleWeight[left.role]
      ? right.role
      : left.role;
  return {
    role,
    readOnly: left.readOnly && right.readOnly,
    tabs: Array.from(new Set([...left.tabs, ...right.tabs])),
    admin: Boolean(left.admin || right.admin)
  };
};

const cloneAccess = (access: UserAccess): UserAccess => ({
  admin: Boolean(access.admin),
  warehouses: Object.fromEntries(
    Object.entries(access.warehouses)
      .filter(([key]) => isWarehouseKey(key))
      .map(([key, value]) => [key, value ? { ...value, tabs: [...value.tabs] } : value])
  ) as UserAccess['warehouses'],
  paintTapePermissions: access.paintTapePermissions
    ? { ...access.paintTapePermissions }
    : undefined
});

const normalizeAccessFromDb = (access: UserAccess | null | undefined): UserAccess => {
  if (!access || typeof access !== 'object') {
    return cloneAccess(defaultAccess);
  }
  const source = access as Record<string, unknown>;
  const warehousesRaw =
    source.warehouses && typeof source.warehouses === 'object'
      ? (source.warehouses as Record<string, unknown>)
      : {};
  const warehouses = Object.fromEntries(
    Object.entries(warehousesRaw)
      .filter(([key]) => isWarehouseKey(key))
      .map(([key, value]) => [key, normalizeWarehouseAccess(value, key as WarehouseKey)])
      .filter(([, value]) => Boolean(value))
  ) as UserAccess['warehouses'];
  const przemialyAccess = warehouses.PRZEMIALY;
  if (
    przemialyAccess?.tabs.includes('bilans-przezbrojen') &&
    !warehouses.BILANS_PRZEZBROJEN
  ) {
    warehouses.BILANS_PRZEZBROJEN = {
      role: przemialyAccess.role,
      readOnly: przemialyAccess.readOnly,
      tabs: ['bilans-przezbrojen'],
      admin: Boolean(przemialyAccess.admin)
    };
  }
  if (
    (przemialyAccess?.tabs.includes('raport-brakowosci') ||
      przemialyAccess?.tabs.includes('raporty')) &&
    !warehouses.RAPORT_BRAKOWOSCI
  ) {
    warehouses.RAPORT_BRAKOWOSCI = {
      role: przemialyAccess.role,
      readOnly: przemialyAccess.readOnly,
      tabs: ['raport-brakowosci'],
      admin: Boolean(przemialyAccess.admin)
    };
  }
  const paintTapePermissionsRaw =
    source.paintTapePermissions && typeof source.paintTapePermissions === 'object'
      ? (source.paintTapePermissions as Record<string, unknown>)
      : null;
  const paintTapePermissions = paintTapePermissionsRaw
    ? Object.fromEntries(
        PAINT_TAPE_PERMISSION_KEYS.map((key) => [
          key,
          key === 'accounted' && paintTapePermissionsRaw.accounted === undefined
            ? paintTapePermissionsRaw.accounting !== false
            : paintTapePermissionsRaw[key] !== false
        ])
      )
    : undefined;
  return {
    admin: Boolean(source.admin),
    warehouses,
    paintTapePermissions
  };
};

const readMustChangePassword = (
  access: (UserAccess & { mustChangePassword?: boolean }) | null | undefined
) => {
  if (!access || typeof access !== 'object') return false;
  const source = access as Record<string, unknown>;
  return Boolean(source.mustChangePassword);
};

export const normalizeAccessForDb = (
  access: UserAccess | null | undefined
): UserAccess | null => {
  if (!access) return null;
  return normalizeAccessFromDb(access);
};

const mergeAccesses = (accesses: UserAccess[]): UserAccess => {
  if (accesses.length === 0) {
    return cloneAccess(defaultAccess);
  }
  return accesses.reduce<UserAccess>((acc, next) => {
    const normalized = normalizeAccessFromDb(next);
    const mergedWarehouses: Partial<Record<WarehouseKey, WarehouseAccess>> = {
      ...acc.warehouses
    };
    Object.entries(normalized.warehouses).forEach(([warehouseKey, warehouseAccess]) => {
      if (!warehouseAccess || !isWarehouseKey(warehouseKey)) return;
      const current = mergedWarehouses[warehouseKey];
      mergedWarehouses[warehouseKey] = current
        ? mergeWarehouseAccess(current, warehouseAccess)
        : { ...warehouseAccess, tabs: [...warehouseAccess.tabs] };
    });
    const leftPaintTape = acc.paintTapePermissions;
    const rightPaintTape = normalized.paintTapePermissions;
    const paintTapePermissions =
      leftPaintTape && rightPaintTape
        ? Object.fromEntries(
            PAINT_TAPE_PERMISSION_KEYS.map((key) => [
              key,
              Boolean(leftPaintTape[key] || rightPaintTape[key])
            ])
          )
        : leftPaintTape
          ? { ...leftPaintTape }
          : rightPaintTape
            ? { ...rightPaintTape }
            : undefined;
    return {
      admin: Boolean(acc.admin || normalized.admin),
      warehouses: mergedWarehouses,
      paintTapePermissions
    };
  }, cloneAccess(defaultAccess));
};

export const mapDbPermissionGroup = (row: DbPermissionGroupRow): PermissionGroup => ({
  id: row.id,
  name: row.name,
  description: row.description,
  access: normalizeAccessFromDb(row.access),
  isActive: row.is_active,
  createdAt: row.created_at
});

export const toUserPermissionGroup = (
  group: PermissionGroup | DbPermissionGroupRow
): UserPermissionGroup => {
  const mapped = 'isActive' in group ? group : mapDbPermissionGroup(group);
  return {
    id: mapped.id,
    name: mapped.name,
    description: mapped.description,
    access: normalizeAccessFromDb(mapped.access),
    isActive: mapped.isActive
  };
};

export const mapDbUser = (row: DbUserRow, groups: UserPermissionGroup[] = []): AppUser => {
  const rawAccess = row.access ?? defaultAccessWithPasswordFlag;
  const directAccess = normalizeAccessFromDb(rawAccess);
  const mustChangePassword = readMustChangePassword(rawAccess);
  const activeGroupAccesses = groups
    .filter((group) => group.isActive)
    .map((group) => normalizeAccessFromDb(group.access));
  const effectiveAccess = mergeAccesses([directAccess, ...activeGroupAccesses]);

  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    access: effectiveAccess,
    directAccess,
    mustChangePassword,
    groups: groups.map((group) => ({
      ...group,
      access: normalizeAccessFromDb(group.access)
    })),
    groupIds: groups.map((group) => group.id),
    isActive: row.is_active,
    createdAt: row.created_at,
    lastLogin: row.last_login
  };
};

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
