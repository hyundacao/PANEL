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
  return cloneAccess(access ?? defaultAccess);
};

export const normalizeAccessForDb = (
  access: UserAccess | null | undefined
): UserAccess | null => {
  if (!access) return null;
  return cloneAccess(access);
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
