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

export const mapDbUser = (row: DbUserRow): AppUser => ({
  id: row.id,
  name: row.name,
  username: row.username,
  role: row.role,
  access: row.access ?? defaultAccess,
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
