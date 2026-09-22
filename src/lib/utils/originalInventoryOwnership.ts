import type { SupabaseClient } from '@supabase/supabase-js';

type Identity = { id: string; username?: string | null; name?: string | null };
type AuthoredRow = { user_name?: string | null };
const identityKey = (value: unknown) => typeof value === 'string' ? value.trim().toLocaleLowerCase('pl-PL') : '';
export const INVENTORY_OWNER_ERROR = 'INVENTORY_NOT_OWNER';
export const INVENTORY_OWNER_MESSAGE = 'Możesz zmieniać i usuwać tylko własne wpisy spisu.';
export type InventoryOwnership = { actor: string; owns: (row: AuthoredRow) => boolean; assert: (row: AuthoredRow) => void };

// Old inventory rows contain a display name or login, not a user ID. Resolve it
// against all accounts (including inactive ones); never guess on collisions.
// Roles deliberately do not participate: administrators cannot override authors.
export function inventoryOwnership(user: Identity, users: readonly Identity[]): InventoryOwnership {
  const identities = new Map<string, Set<string>>();
  for (const account of users) {
    for (const value of [account.username, account.name]) {
      const key = identityKey(value);
      if (!key || key === 'nieznany' || !account.id) continue;
      const ids = identities.get(key) ?? new Set<string>();
      ids.add(account.id);
      identities.set(key, ids);
    }
  }
  const owns = (row: AuthoredRow) => {
    const ids = identities.get(identityKey(row.user_name));
    return Boolean(user.id && ids?.size === 1 && ids.has(user.id));
  };
  return {
    // New entries use the account login rather than an editable display name.
    actor: user.username?.trim() || user.name?.trim() || '',
    owns,
    assert: row => { if (!owns(row)) throw new Error(INVENTORY_OWNER_ERROR); }
  };
}

export async function loadInventoryOwnership(db: SupabaseClient, user: Identity): Promise<InventoryOwnership> {
  const users: Identity[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('app_users').select('id,username,name').order('id').range(offset, offset + 499);
    if (error) throw error;
    users.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return inventoryOwnership(user, users);
}
