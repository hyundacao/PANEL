import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { isHeadAdmin } from '@/lib/auth/access';
import { getErrorCode, type DbUserRow } from '@/lib/supabase/users';
import { DEFAULT_RESET_PASSWORD } from '@/lib/auth/password';

const getUnexpectedCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error) {
    const dbCode = String((error as { code?: unknown }).code ?? '').trim();
    if (dbCode) return `DB_${dbCode}`;
  }
  if (error instanceof Error && error.message.trim()) {
    return `ERR_${error.message.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')}`;
  }
  return 'UNKNOWN';
};

const isFunctionResolutionError = (
  error: { code?: string | null; message?: string | null } | null
) => {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    message.includes('function') ||
    message.includes('update_app_user')
  );
};

const isMissingActiveSessionColumnError = (
  error: { code?: string | null; message?: string | null } | null
) => {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '').toLowerCase();
  return (
    code === '42703' ||
    message.includes('active_session_id') ||
    (message.includes('column') && message.includes('does not exist'))
  );
};

const requireHeadAdmin = async (request: Request) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) {
    const response = NextResponse.json({ code: auth.code }, { status: 401 });
    if (auth.code === 'SESSION_EXPIRED') {
      clearSessionCookie(response);
    }
    return { denied: response, userId: null as string | null };
  }
  if (!isHeadAdmin(auth.user)) {
    return {
      denied: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }),
      userId: auth.user.id
    };
  }
  return { denied: null, userId: auth.user.id };
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireHeadAdmin(request);
    if (auth.denied) return auth.denied;

    const { id } = await context.params;
    const targetUserId = id ?? '';
    if (!targetUserId) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }

    let passwordUpdateResult = await supabaseAdmin.rpc('update_app_user', {
      p_id: targetUserId,
      p_password: DEFAULT_RESET_PASSWORD
    });

    if (passwordUpdateResult.error && isFunctionResolutionError(passwordUpdateResult.error)) {
      passwordUpdateResult = await supabaseAdmin.rpc('update_app_user', {
        p_id: targetUserId,
        p_name: null,
        p_username: null,
        p_password: DEFAULT_RESET_PASSWORD,
        p_role: null,
        p_access: null,
        p_is_active: null
      });
    }

    if (passwordUpdateResult.error && isFunctionResolutionError(passwordUpdateResult.error)) {
      passwordUpdateResult = await supabaseAdmin.rpc('update_app_user', {
        p_id: targetUserId,
        p_name: null,
        p_username: null,
        p_password: DEFAULT_RESET_PASSWORD,
        p_role: null,
        p_access: null
      });
    }

    if (passwordUpdateResult.error) {
      if (isFunctionResolutionError(passwordUpdateResult.error)) {
        return NextResponse.json({ code: 'UPDATE_USER_RPC_MISSING' }, { status: 500 });
      }
      const mappedCode = getErrorCode(
        passwordUpdateResult.error.message,
        passwordUpdateResult.error.code
      );
      if (mappedCode !== 'UNKNOWN') {
        const status = mappedCode === 'NOT_FOUND' ? 404 : mappedCode === 'DUPLICATE' ? 409 : 400;
        return NextResponse.json({ code: mappedCode }, { status });
      }
      return NextResponse.json(
        { code: getUnexpectedCode(passwordUpdateResult.error) },
        { status: 500 }
      );
    }

    const row = (Array.isArray(passwordUpdateResult.data)
      ? passwordUpdateResult.data[0]
      : passwordUpdateResult.data) as DbUserRow | null;
    if (!row) {
      return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    }

    const currentAccess =
      row.access && typeof row.access === 'object'
        ? (row.access as Record<string, unknown>)
        : ({ admin: false, warehouses: {} } as Record<string, unknown>);
    const nextAccess = {
      ...currentAccess,
      mustChangePassword: true
    };

    let syncResult = await supabaseAdmin
      .from('app_users')
      .update({ active_session_id: null, access: nextAccess })
      .eq('id', targetUserId)
      .select('id')
      .maybeSingle();

    if (syncResult.error && isMissingActiveSessionColumnError(syncResult.error)) {
      syncResult = await supabaseAdmin
        .from('app_users')
        .update({ access: nextAccess })
        .eq('id', targetUserId)
        .select('id')
        .maybeSingle();
    }

    if (syncResult.error) {
      // Password reset already applied; don't fail whole operation on sync flag/session update.
      return NextResponse.json({
        ok: true,
        partial: true,
        code: getUnexpectedCode(syncResult.error),
        defaultPassword: DEFAULT_RESET_PASSWORD
      });
    }

    return NextResponse.json({ ok: true, defaultPassword: DEFAULT_RESET_PASSWORD });
  } catch (error) {
    return NextResponse.json({ code: getUnexpectedCode(error) }, { status: 500 });
  }
}
