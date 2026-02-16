import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getErrorCode,
  mapDbUser,
  normalizeAccessForDb,
  type DbUserRow
} from '@/lib/supabase/users';
import {
  loadUserGroupsByUserIds,
  setUserPermissionGroups
} from '@/lib/supabase/permission-groups';
import type { Role, UserAccess } from '@/lib/api/types';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { isHeadAdmin } from '@/lib/auth/access';

type UpdateUserPayload = {
  name?: string;
  username?: string;
  password?: string;
  role?: Role;
  access?: UserAccess;
  groupIds?: string[];
  isActive?: boolean;
};

const normalizeRole = (role?: Role) =>
  role === 'HEAD_ADMIN' || role === 'ADMIN' || role === 'USER' || role === 'VIEWER'
    ? role
    : null;

const requireHeadAdmin = async (request: Request) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) {
    const response = NextResponse.json({ code: auth.code }, { status: 401 });
    if (auth.code === 'SESSION_EXPIRED') {
      clearSessionCookie(response);
    }
    return {
      denied: response,
      userId: null as string | null
    };
  }
  if (!isHeadAdmin(auth.user)) {
    return {
      denied: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
      userId: null as string | null
    };
  }
  return { denied: null, userId: auth.user.id };
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireHeadAdmin(request);
  if (auth.denied) return auth.denied;

  const { id } = await context.params;
  const userId = id ?? '';
  if (!userId) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  const payload = (await request.json().catch(() => null)) as UpdateUserPayload | null;
  const name = payload?.name?.trim();
  const username = payload?.username?.trim();
  const password = payload?.password?.trim();
  const normalizedRole = normalizeRole(payload?.role);
  const normalizedAccess =
    payload?.access === undefined ? undefined : normalizeAccessForDb(payload.access);
  const shouldUpdateGroups = payload?.groupIds !== undefined;

  if (payload?.name !== undefined && !name) {
    return NextResponse.json({ code: 'NAME_REQUIRED' }, { status: 400 });
  }
  if (payload?.username !== undefined && !username) {
    return NextResponse.json({ code: 'USERNAME_REQUIRED' }, { status: 400 });
  }
  if (payload?.isActive === false && auth.userId === userId) {
    return NextResponse.json({ code: 'SELF_DISABLE_FORBIDDEN' }, { status: 400 });
  }

  if (password) {
    const { data, error } = await supabaseAdmin.rpc('update_app_user', {
      p_id: userId,
      p_name: name ?? null,
      p_username: username ?? null,
      p_password: password,
      p_role: normalizedRole,
      p_access: normalizedAccess ?? null,
      p_is_active: typeof payload?.isActive === 'boolean' ? payload.isActive : null
    });

    if (error) {
      const code = getErrorCode(error.message, error.code);
      const status = code === 'DUPLICATE' ? 409 : code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ code }, { status });
    }

    const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
    if (!row) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }

    if (shouldUpdateGroups) {
      try {
        await setUserPermissionGroups(userId, payload?.groupIds);
      } catch (groupError: unknown) {
        const code = (() => {
          if (groupError instanceof Error && groupError.message === 'GROUPS_SCHEMA_MISSING') {
            return 'GROUPS_SCHEMA_MISSING';
          }
          if (
            typeof groupError === 'object' &&
            groupError &&
            'code' in groupError &&
            groupError.code === '23503'
          ) {
            return 'GROUP_NOT_FOUND';
          }
          return 'UNKNOWN';
        })();
        const status = code === 'GROUPS_SCHEMA_MISSING' ? 500 : 400;
        return NextResponse.json({ code }, { status });
      }
    }

    const groupsByUserId = await loadUserGroupsByUserIds([userId]);
    return NextResponse.json(mapDbUser(row, groupsByUserId.get(userId) ?? []));
  }

  const updatePayload: Record<string, unknown> = {};
  if (payload?.name !== undefined) {
    updatePayload.name = name;
  }
  if (payload?.username !== undefined) {
    updatePayload.username = username;
  }
  if (payload?.role !== undefined && normalizedRole) {
    updatePayload.role = normalizedRole;
  }
  if (payload?.access !== undefined) {
    updatePayload.access = normalizedAccess ?? { admin: false, warehouses: {} };
  }
  if (typeof payload?.isActive === 'boolean') {
    updatePayload.is_active = payload.isActive;
  }

  if (Object.keys(updatePayload).length === 0 && !shouldUpdateGroups) {
    const { data: unchangedRow, error: unchangedError } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (unchangedError) {
      const code = getErrorCode(unchangedError.message, unchangedError.code);
      const status = code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ code }, { status });
    }
    if (!unchangedRow) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }
    const groupsByUserId = await loadUserGroupsByUserIds([userId]);
    return NextResponse.json(
      mapDbUser(unchangedRow as DbUserRow, groupsByUserId.get(userId) ?? [])
    );
  }

  let directRow: DbUserRow | null = null;
  if (Object.keys(updatePayload).length > 0) {
    const { data, error: directError } = await supabaseAdmin
      .from('app_users')
      .update(updatePayload)
      .eq('id', userId)
      .select('*')
      .maybeSingle();

    if (directError) {
      const code = getErrorCode(directError.message, directError.code);
      const status = code === 'DUPLICATE' ? 409 : code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ code }, { status });
    }

    directRow = data as DbUserRow | null;
    if (!directRow) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }
  }

  if (shouldUpdateGroups) {
    try {
      await setUserPermissionGroups(userId, payload?.groupIds);
    } catch (groupError: unknown) {
      const code = (() => {
        if (groupError instanceof Error && groupError.message === 'GROUPS_SCHEMA_MISSING') {
          return 'GROUPS_SCHEMA_MISSING';
        }
        if (
          typeof groupError === 'object' &&
          groupError &&
          'code' in groupError &&
          groupError.code === '23503'
        ) {
          return 'GROUP_NOT_FOUND';
        }
        return 'UNKNOWN';
      })();
      const status = code === 'GROUPS_SCHEMA_MISSING' ? 500 : 400;
      return NextResponse.json({ code }, { status });
    }
  }

  if (!directRow) {
    const { data: fallbackRow, error: fallbackError } = await supabaseAdmin
      .from('app_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (fallbackError) {
      const code = getErrorCode(fallbackError.message, fallbackError.code);
      const status = code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ code }, { status });
    }
    if (!fallbackRow) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }
    directRow = fallbackRow as DbUserRow;
  }

  const groupsByUserId = await loadUserGroupsByUserIds([userId]);
  return NextResponse.json(mapDbUser(directRow, groupsByUserId.get(userId) ?? []));
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireHeadAdmin(request);
  if (auth.denied) return auth.denied;

  const { id } = await context.params;
  const userId = id ?? '';
  if (!userId) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }
  if (auth.userId === userId) {
    return NextResponse.json({ code: 'SELF_DELETE_FORBIDDEN' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('app_users')
    .delete()
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (error) {
    const code = getErrorCode(error.message, error.code);
    const status = code === 'NOT_FOUND' ? 404 : 400;
    return NextResponse.json({ code }, { status });
  }

  const row = (Array.isArray(data) ? data[0] : data) as DbUserRow | null;
  if (!row) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json(mapDbUser(row, []));
}
