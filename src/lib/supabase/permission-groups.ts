import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PermissionGroup, UserPermissionGroup } from '@/lib/api/types';
import {
  mapDbPermissionGroup,
  toUserPermissionGroup,
  type DbPermissionGroupRow
} from '@/lib/supabase/users';

type UserGroupJoinRow = {
  user_id: string;
  group_id: string;
};

const isPermissionGroupSchemaMissing = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string; hint?: string };
  const code = String(candidate.code ?? '');
  const text = `${String(candidate.message ?? '')} ${String(candidate.details ?? '')} ${String(candidate.hint ?? '')}`
    .toLowerCase();
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST204') return true;
  const mentionsPermissionTables =
    text.includes('permission_groups') || text.includes('user_permission_groups');
  const mentionsMissingRelation =
    text.includes('does not exist') || text.includes('not found');
  return mentionsPermissionTables && mentionsMissingRelation;
};

const toUniqueGroupIds = (groupIds: string[] | null | undefined) =>
  Array.from(
    new Set(
      (groupIds ?? [])
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );

export const listPermissionGroups = async (): Promise<PermissionGroup[]> => {
  const { data, error } = await supabaseAdmin
    .from('permission_groups')
    .select('id, name, description, access, is_active, created_at')
    .order('name', { ascending: true });

  if (error) {
    if (isPermissionGroupSchemaMissing(error)) return [];
    throw error;
  }
  const groups = (data ?? []) as DbPermissionGroupRow[];

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from('user_permission_groups')
    .select('group_id');

  if (assignmentError) {
    if (isPermissionGroupSchemaMissing(assignmentError)) {
      return groups.map((group) => ({ ...mapDbPermissionGroup(group), assignedUsersCount: 0 }));
    }
    throw assignmentError;
  }

  const countsByGroupId = new Map<string, number>();
  (assignments ?? []).forEach((item: { group_id?: string | null }) => {
    if (!item.group_id) return;
    countsByGroupId.set(item.group_id, (countsByGroupId.get(item.group_id) ?? 0) + 1);
  });

  return groups.map((group) => ({
    ...mapDbPermissionGroup(group),
    assignedUsersCount: countsByGroupId.get(group.id) ?? 0
  }));
};

export const loadUserGroupsByUserIds = async (
  userIds: string[]
): Promise<Map<string, UserPermissionGroup[]>> => {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const groupsByUserId = new Map<string, UserPermissionGroup[]>();
  if (ids.length === 0) return groupsByUserId;

  const { data: assignmentsData, error: assignmentsError } = await supabaseAdmin
    .from('user_permission_groups')
    .select('user_id, group_id')
    .in('user_id', ids);

  if (assignmentsError) {
    if (isPermissionGroupSchemaMissing(assignmentsError)) return groupsByUserId;
    throw assignmentsError;
  }

  const assignments = (assignmentsData ?? []) as UserGroupJoinRow[];
  const groupIds = Array.from(
    new Set(
      assignments
        .map((row) => row.group_id?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  if (groupIds.length === 0) return groupsByUserId;

  const { data: groupsData, error: groupsError } = await supabaseAdmin
    .from('permission_groups')
    .select('id, name, description, access, is_active, created_at')
    .in('id', groupIds);

  if (groupsError) {
    if (isPermissionGroupSchemaMissing(groupsError)) return groupsByUserId;
    throw groupsError;
  }

  const groupsById = new Map(
    ((groupsData ?? []) as DbPermissionGroupRow[]).map((row) => [row.id, toUserPermissionGroup(row)])
  );

  assignments.forEach((row) => {
    const mapped = groupsById.get(row.group_id);
    if (!mapped) return;
    const current = groupsByUserId.get(row.user_id) ?? [];
    current.push(mapped);
    groupsByUserId.set(row.user_id, current);
  });

  return groupsByUserId;
};

export const setUserPermissionGroups = async (
  userId: string,
  groupIds: string[] | null | undefined
) => {
  const nextGroupIds = toUniqueGroupIds(groupIds);

  const { error: deleteError } = await supabaseAdmin
    .from('user_permission_groups')
    .delete()
    .eq('user_id', userId);

  if (deleteError) {
    if (isPermissionGroupSchemaMissing(deleteError)) {
      if (nextGroupIds.length === 0) return;
      const migrationError = new Error('GROUPS_SCHEMA_MISSING');
      throw migrationError;
    }
    throw deleteError;
  }
  if (nextGroupIds.length === 0) return;

  const rows = nextGroupIds.map((groupId) => ({ user_id: userId, group_id: groupId }));
  const { error: insertError } = await supabaseAdmin.from('user_permission_groups').insert(rows);
  if (insertError) {
    if (isPermissionGroupSchemaMissing(insertError)) {
      const migrationError = new Error('GROUPS_SCHEMA_MISSING');
      throw migrationError;
    }
    throw insertError;
  }
};
