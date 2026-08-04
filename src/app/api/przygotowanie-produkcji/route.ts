import { NextRequest, NextResponse } from 'next/server';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

type StoredTask = {
  id: string;
  isCurrentPlan: boolean;
  planGroup: string;
  station: string;
  detail: string;
  quantity: string;
  norm: string;
  highlighted: boolean;
  kinds: string[];
  teams: string[];
  notes: Record<string, string>;
  done: boolean;
  material: string;
  materialType: string;
  source: string;
  dryer: string;
  temperature: string;
};

const todayKey = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

const unauthorized = (code: string) => NextResponse.json({ code }, { status: 401 });

const hasAssignment = (task: Record<string, unknown>) => {
  const kinds = Array.isArray(task.kinds) ? task.kinds : [];
  const teams = Array.isArray(task.teams) ? task.teams : [];
  const notes = task.notes && typeof task.notes === 'object' ? Object.keys(task.notes).length : 0;
  return kinds.length > 0 || teams.length > 0 || notes > 0 || Boolean(task.done);
};

const archiveAndRemovePreviousDays = async () => {
  const { data: previousSessions, error: sessionError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .select('id, session_date, file_name, plan_sheet, created_by')
    .lt('session_date', todayKey());
  if (sessionError) throw sessionError;

  for (const session of previousSessions ?? []) {
    const { data: taskRows, error: taskError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .select('*')
      .eq('session_id', session.id)
      .order('position_no');
    if (taskError) throw taskError;
    const tasks = (taskRows ?? []).filter((task) => hasAssignment(task as Record<string, unknown>));
    const { error: historyError } = await supabaseAdmin
      .from('przygotowanie_produkcji_history')
      .upsert({
        plan_date: session.session_date,
        file_name: session.file_name,
        plan_sheet: session.plan_sheet,
        tasks,
        archived_by: session.created_by
      }, { onConflict: 'plan_date' });
    if (historyError) throw historyError;
  }

  const { error: deleteError } = await supabaseAdmin
    .from('przygotowanie_produkcji_sessions')
    .delete()
    .lt('session_date', todayKey());
  if (deleteError) throw deleteError;
};

const ensureAccess = async (request: NextRequest, write = false) => {
  const auth = await getAuthenticatedUser(request);
  if (!auth.user) return { user: null, response: unauthorized(auth.code ?? 'UNAUTHORIZED') };
  if (!canSeeTab(auth.user, 'PRZYGOTOWANIE_PRODUKCJI', 'przygotowanie-produkcji')) {
    return { user: null, response: NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 }) };
  }
  if (write && isReadOnly(auth.user, 'PRZYGOTOWANIE_PRODUKCJI')) {
    return { user: null, response: NextResponse.json({ code: 'READ_ONLY' }, { status: 403 }) };
  }
  return { user: auth.user, response: null };
};

const toDbTask = (task: StoredTask, sessionId: string, position: number, userName: string) => ({
  session_id: sessionId,
  task_key: String(task.id),
  position_no: position,
  is_current_plan: Boolean(task.isCurrentPlan),
  plan_group: String(task.planGroup ?? 'standard'),
  station: String(task.station ?? ''),
  detail: String(task.detail ?? ''),
  quantity: String(task.quantity ?? ''),
  norm: String(task.norm ?? ''),
  highlighted: Boolean(task.highlighted),
  kinds: Array.isArray(task.kinds) ? [...new Set(task.kinds.map(String))] : [],
  teams: Array.isArray(task.teams) ? [...new Set(task.teams.map(String))] : [],
  notes: task.notes && typeof task.notes === 'object' ? task.notes : {},
  done: Boolean(task.done),
  material: String(task.material ?? ''),
  material_type: String(task.materialType ?? ''),
  source: String(task.source ?? ''),
  dryer: String(task.dryer ?? ''),
  temperature: String(task.temperature ?? ''),
  updated_at: new Date().toISOString(),
  updated_by: userName
});

const fromDbTask = (row: Record<string, unknown>): StoredTask => ({
  id: String(row.task_key ?? ''),
  isCurrentPlan: row.is_current_plan !== false,
  planGroup: String(row.plan_group ?? 'standard'),
  station: String(row.station ?? ''),
  detail: String(row.detail ?? ''),
  quantity: String(row.quantity ?? ''),
  norm: String(row.norm ?? ''),
  highlighted: Boolean(row.highlighted),
  kinds: Array.isArray(row.kinds) ? [...new Set(row.kinds.map(String))] : [],
  teams: Array.isArray(row.teams) ? [...new Set(row.teams.map(String))] : [],
  notes: row.notes && typeof row.notes === 'object' ? row.notes as Record<string, string> : {},
  done: Boolean(row.done),
  material: String(row.material ?? ''),
  materialType: String(row.material_type ?? ''),
  source: String(row.source ?? ''),
  dryer: String(row.dryer ?? ''),
  temperature: String(row.temperature ?? '')
});

export async function GET(request: NextRequest) {
  try {
    const access = await ensureAccess(request);
    if (access.response) return access.response;
    await archiveAndRemovePreviousDays();
    if (request.nextUrl.searchParams.get('history') === '1') {
      const { data: history, error: historyError } = await supabaseAdmin
        .from('przygotowanie_produkcji_history')
        .select('plan_date, file_name, plan_sheet, tasks, archived_at')
        .order('plan_date', { ascending: false });
      if (historyError) throw historyError;
      return NextResponse.json({ history: history ?? [] });
    }
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('przygotowanie_produkcji_sessions')
      .select('id, session_date, file_name, plan_sheet, updated_at')
      .eq('session_date', todayKey())
      .maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) return NextResponse.json({ session: null, tasks: [] });
    const { data: taskRows, error: taskError } = await supabaseAdmin
      .from('przygotowanie_produkcji_tasks')
      .select('*')
      .eq('session_id', session.id)
      .order('position_no');
    if (taskError) throw taskError;
    return NextResponse.json({ session, tasks: (taskRows ?? []).map((row) => fromDbTask(row as Record<string, unknown>)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się odczytać planu.';
    return NextResponse.json({ code: 'PREPARATION_READ_FAILED', message }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await ensureAccess(request, true);
    if (access.response || !access.user) return access.response;
    await archiveAndRemovePreviousDays();
    const body = await request.json() as { action?: string; fileName?: string; sheetName?: string; tasks?: StoredTask[]; task?: StoredTask };
    const now = new Date().toISOString();

    if (body.action === 'savePlan') {
      const tasks = Array.isArray(body.tasks) ? body.tasks : [];
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .upsert({ session_date: todayKey(), file_name: body.fileName ?? '', plan_sheet: body.sheetName ?? '', created_by: access.user.name, updated_at: now }, { onConflict: 'session_date' })
        .select('id, session_date, file_name, plan_sheet, updated_at')
        .single();
      if (sessionError) throw sessionError;
      const { error: deleteError } = await supabaseAdmin.from('przygotowanie_produkcji_tasks').delete().eq('session_id', session.id);
      if (deleteError) throw deleteError;
      if (tasks.length) {
        const { error: insertError } = await supabaseAdmin
          .from('przygotowanie_produkcji_tasks')
          .insert(tasks.map((task, index) => toDbTask(task, session.id, index, access.user.name)));
        if (insertError) throw insertError;
      }
      return NextResponse.json({ session, tasks });
    }

    if (body.action === 'updateTask' && body.task) {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('przygotowanie_produkcji_sessions')
        .select('id')
        .eq('session_date', todayKey())
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!session) return NextResponse.json({ code: 'NO_PLAN' }, { status: 409 });
      const storedTask = toDbTask(body.task, session.id, 0, access.user.name);
      const { session_id: _sessionId, task_key: _taskKey, position_no: _positionNo, ...updates } = storedTask;
      const { error: taskError } = await supabaseAdmin
        .from('przygotowanie_produkcji_tasks')
        .update(updates)
        .eq('session_id', session.id)
        .eq('task_key', body.task.id);
      if (taskError) throw taskError;
      return NextResponse.json({ task: body.task });
    }

    return NextResponse.json({ code: 'INVALID_ACTION' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zapisać planu.';
    return NextResponse.json({ code: 'PREPARATION_SAVE_FAILED', message }, { status: 400 });
  }
}
