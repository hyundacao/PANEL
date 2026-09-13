'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Check, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { getWarsawProductionPlanDate } from '@/lib/utils/productionPlanDate';
import {
  MAX_PERSONAL_TASK_TITLE_LENGTH,
  sortPersonalTasks,
  type PersonalTask,
  type PersonalTaskInput,
  type PersonalTaskRecurrence
} from '@/lib/utils/productionPersonalTasks';

const recurrenceLabels: Record<PersonalTaskRecurrence, string> = {
  once: 'Jednorazowe',
  daily: 'Codziennie',
  weekly: 'Co tydzień',
  monthly: 'Co miesiąc'
};

const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', {
  day: '2-digit',
  month: 'long',
  year: 'numeric'
});

const dateTimeLabel = (value?: string) => value
  ? new Date(value).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' })
  : '';

type TaskFormProps = {
  value: PersonalTaskInput;
  onChange: (value: PersonalTaskInput) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
};

function TaskForm({ value, onChange, onCancel, onSave, saving, saveLabel }: TaskFormProps) {
  return <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_190px_auto] lg:items-end">
    <label className="text-xs font-semibold text-dim">Treść zadania
      <textarea
        className="mt-1 h-12 min-h-12 w-full resize-none rounded-xl border border-[var(--control-border)] bg-[image:var(--control-bg)] px-3 py-2.5 text-sm font-semibold text-title outline-none transition focus:border-[var(--brand-border-strong)] focus:ring-2 focus:ring-ring"
        maxLength={MAX_PERSONAL_TASK_TITLE_LENGTH}
        onChange={(event) => onChange({ ...value, title: event.target.value })}
        placeholder="Np. Sprawdzić stany materiałów przed odprawą"
        value={value.title}
      />
    </label>
    <label className="text-xs font-semibold text-dim">Termin
      <Input
        className="mt-1 h-12"
        onChange={(event) => onChange({ ...value, dueDate: event.target.value })}
        type="date"
        value={value.dueDate}
      />
    </label>
    <label className="text-xs font-semibold text-dim">Powtarzanie
      <SelectField
        className="mt-1 !min-h-12"
        onChange={(event) => onChange({ ...value, recurrence: event.target.value as PersonalTaskRecurrence })}
        value={value.recurrence}
      >
        {Object.entries(recurrenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </SelectField>
    </label>
    <div className="flex justify-end gap-2">
      <Button className="h-12 min-h-12 px-3" disabled={saving} onClick={onCancel} type="button" variant="ghost"><X className="mr-1.5 h-4 w-4" />Anuluj</Button>
      <Button className="!h-12 !min-h-12 px-4" disabled={saving || !value.title.trim() || !value.dueDate} onClick={onSave} type="button" variant="primaryEmber">{saveLabel}</Button>
    </div>
  </div>;
}

type TaskCardProps = {
  task: PersonalTask;
  today: string;
  busy: boolean;
  editing: boolean;
  editValue: PersonalTaskInput;
  onEditValue: (value: PersonalTaskInput) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onComplete: () => void;
  onUndo: () => void;
  onArchive: () => void;
};

function PersonalTaskCard({
  task,
  today,
  busy,
  editing,
  editValue,
  onEditValue,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onComplete,
  onUndo,
  onArchive
}: TaskCardProps) {
  const completedForCurrentCycle = task.done || Boolean(task.lastCompletedAt && task.dueDate > today);
  const overdue = !completedForCurrentCycle && task.dueDate < today;
  const dueToday = !completedForCurrentCycle && task.dueDate === today;
  if (editing) {
    return <Card className="border-[var(--brand-border)] bg-surface2 p-4">
      <TaskForm value={editValue} onChange={onEditValue} onCancel={onCancelEdit} onSave={onSaveEdit} saving={busy} saveLabel={busy ? 'Zapisywanie...' : 'Zapisz'} />
    </Card>;
  }

  return <Card className={cn(
    'overflow-hidden p-0',
    completedForCurrentCycle && 'border-emerald-500/80 bg-emerald-500/[0.18] ring-1 ring-inset ring-emerald-500/30 shadow-[0_0_28px_rgba(16,185,129,0.16)] hover:border-emerald-500/80 hover:bg-emerald-500/[0.22]',
    overdue && 'border-red-500/60 bg-red-500/[0.06] hover:border-red-500/60 hover:bg-red-500/[0.06]',
    dueToday && 'border-amber-400/60 bg-amber-500/[0.06] hover:border-amber-400/60 hover:bg-amber-500/[0.06]'
  )}>
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{recurrenceLabels[task.recurrence]}</Badge>
          <span className={cn(
            'rounded-full border px-2.5 py-1 text-[11px] font-bold',
            completedForCurrentCycle ? 'border-emerald-500/40 bg-emerald-500/10 text-[var(--success)]'
              : overdue ? 'border-red-500/50 bg-red-500/10 text-[var(--danger)]'
                : dueToday ? 'border-amber-400/50 bg-amber-500/10 text-[var(--warning)]'
                  : 'border-[var(--brand-border)] bg-[var(--interactive-soft)] text-brandHover'
          )}>
            {task.done ? 'Wykonane' : completedForCurrentCycle ? `Wykonane · następny: ${dateLabel(task.dueDate)}` : overdue ? `Zaległe · ${dateLabel(task.dueDate)}` : dueToday ? 'Na dzisiaj' : `Termin: ${dateLabel(task.dueDate)}`}
          </span>
        </div>
        <p className={cn('mt-2 break-words text-sm font-semibold text-title sm:text-base', task.done && 'line-through opacity-70')}>{task.title}</p>
        {task.done && task.completedAt && <p className="mt-1 text-xs text-[var(--success)]">Wykonano: {dateTimeLabel(task.completedAt)}</p>}
        {!task.done && task.lastCompletedAt && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-dim">
          <span>Ostatnio wykonano: {dateTimeLabel(task.lastCompletedAt)}</span>
          <button className="font-semibold text-brandHover hover:underline disabled:opacity-50" disabled={busy} onClick={onUndo} type="button">Cofnij ostatnie wykonanie</button>
        </div>}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        {task.done ? <button
          aria-label="Cofnij wykonanie zadania"
          className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--brand-border)] px-3 text-brandHover transition hover:bg-[var(--interactive-soft)] disabled:opacity-50"
          disabled={busy}
          onClick={onUndo}
          title="Cofnij wykonanie"
          type="button"
        ><RotateCcw className="h-4 w-4" /><span className="ml-2 text-xs font-bold">Cofnij</span></button> : <button
          aria-label={task.recurrence === 'once' ? 'Oznacz zadanie jako wykonane' : 'Wykonaj zadanie i ustaw kolejny termin'}
          className="flex h-11 min-w-11 items-center justify-center rounded-xl border border-emerald-500/55 bg-emerald-500/10 px-3 text-[var(--success)] transition hover:bg-emerald-500/20 disabled:opacity-50"
          disabled={busy}
          onClick={onComplete}
          title={task.recurrence === 'once' ? 'Oznacz jako wykonane' : 'Wykonane — ustaw kolejny termin'}
          type="button"
        ><Check className="h-5 w-5" strokeWidth={2.5} /><span className="ml-2 text-xs font-bold">Gotowe</span></button>}
        <button aria-label="Edytuj zadanie" className="flex h-11 w-11 items-center justify-center rounded-xl border border-border text-dim transition hover:border-[var(--brand-border)] hover:text-title disabled:opacity-50" disabled={busy} onClick={onBeginEdit} title="Edytuj" type="button"><Pencil className="h-4 w-4" /></button>
        <button aria-label="Usuń zadanie" className="flex h-11 w-11 items-center justify-center rounded-xl border border-red-500/40 text-[var(--danger)] transition hover:bg-red-500/10 disabled:opacity-50" disabled={busy} onClick={onArchive} title="Usuń" type="button"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  </Card>;
}

export function PersonalTasksPanel() {
  const today = getWarsawProductionPlanDate();
  const emptyInput = (): PersonalTaskInput => ({ title: '', dueDate: today, recurrence: 'once' });
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createValue, setCreateValue] = useState<PersonalTaskInput>(emptyInput);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<PersonalTaskInput>(emptyInput);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busyRef = useRef(false);
  const latestRequestRef = useRef(0);

  const loadTasks = useCallback(async (quiet = false) => {
    const requestId = ++latestRequestRef.current;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch('/api/przygotowanie-produkcji/personal-tasks', { cache: 'no-store' });
      const data = await response.json().catch(() => null) as { tasks?: PersonalTask[]; message?: string } | null;
      if (!response.ok) throw new Error(data?.message ?? 'Nie udało się wczytać zadań osobistych.');
      if (requestId !== latestRequestRef.current) return;
      setTasks(sortPersonalTasks(data?.tasks ?? []));
      setError(null);
    } catch (caught) {
      if (requestId !== latestRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Nie udało się wczytać zadań osobistych.');
    } finally {
      if (!quiet && requestId === latestRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async (quiet = false) => {
      if (!active || busyRef.current) return;
      await loadTasks(quiet);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 30_000);
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTasks]);

  const runAction = async (key: string, body: Record<string, unknown>, onSuccess?: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const requestId = ++latestRequestRef.current;
    setBusyKey(key);
    try {
      const response = await fetch('/api/przygotowanie-produkcji/personal-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null) as { tasks?: PersonalTask[]; message?: string } | null;
      if (!response.ok) {
        if (response.status === 409) void loadTasks(true);
        throw new Error(data?.message ?? 'Nie udało się zapisać zadania.');
      }
      if (requestId !== latestRequestRef.current) return;
      setTasks(sortPersonalTasks(data?.tasks ?? []));
      setError(null);
      onSuccess?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Nie udało się zapisać zadania.');
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
  };

  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.done), [tasks]);
  const overdueCount = openTasks.filter((task) => task.dueDate < today).length;

  const renderTask = (task: PersonalTask) => <PersonalTaskCard
    busy={busyKey !== null}
    editing={editingId === task.id}
    editValue={editingId === task.id ? editValue : task}
    key={task.id}
    onArchive={() => void runAction(task.id, { action: 'archive', id: task.id }, () => editingId === task.id && setEditingId(null))}
    onBeginEdit={() => {
      setEditingId(task.id);
      setEditValue({ title: task.title, dueDate: task.dueDate, recurrence: task.recurrence });
    }}
    onCancelEdit={() => setEditingId(null)}
    onComplete={() => void runAction(task.id, { action: 'complete', id: task.id, occurrenceDate: task.dueDate })}
    onEditValue={setEditValue}
    onSaveEdit={() => void runAction(task.id, { action: 'update', id: task.id, task: editValue }, () => setEditingId(null))}
    onUndo={() => void runAction(task.id, { action: 'undo', id: task.id })}
    task={task}
    today={today}
  />;

  return <div className="space-y-4">
    <Card className="overflow-hidden border-[rgba(255,122,0,0.35)] p-0">
      <div className="flex flex-col gap-4 bg-[linear-gradient(110deg,rgba(255,122,0,0.13),rgba(47,181,240,0.06),transparent)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[rgba(255,122,0,0.45)] bg-[rgba(255,122,0,0.10)]"><CalendarClock className="h-5 w-5 text-[var(--brand)]" /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">Przygotowanie produkcji</p><h1 className="mt-1 text-xl font-bold text-title">Moje zadania</h1><p className="mt-1 text-sm text-dim">Twoja prywatna lista spraw do dopilnowania. Zadania cykliczne po wykonaniu dostają kolejny termin.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{openTasks.length} otwartych</Badge>
          {overdueCount > 0 && <span className="rounded-full border border-red-500/45 bg-red-500/10 px-2.5 py-1 text-xs font-bold text-[var(--danger)]">{overdueCount} zaległych</span>}
          <Button className="!min-h-12 shrink-0 px-4" disabled={busyKey !== null} onClick={() => setShowCreate((current) => !current)} type="button" variant="primaryEmber"><Plus className="mr-2 h-4 w-4" />Dodaj zadanie</Button>
        </div>
      </div>
      {showCreate && <div className="border-t border-border bg-surface2 p-4 sm:p-5">
        <TaskForm
          onCancel={() => { setShowCreate(false); setCreateValue(emptyInput()); }}
          onChange={setCreateValue}
          onSave={() => void runAction('create', { action: 'create', task: createValue }, () => { setShowCreate(false); setCreateValue(emptyInput()); })}
          saveLabel={busyKey === 'create' ? 'Dodawanie...' : 'Dodaj'}
          saving={busyKey !== null}
          value={createValue}
        />
      </div>}
    </Card>

    {error && <div className="rounded-xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm font-semibold text-[var(--danger)]" role="alert">{error}</div>}
    {loading ? <Card className="py-10 text-center text-sm text-dim">Wczytywanie Twoich zadań...</Card> : tasks.length === 0 ? <Card className="py-10 text-center"><p className="font-semibold text-title">Nie masz jeszcze własnych zadań.</p><p className="mt-1 text-sm text-dim">Dodaj pierwszą sprawę jednorazową albo cykliczną.</p></Card> : <>
      <section className="space-y-2"><div className="flex items-center justify-between"><h2 className="font-semibold text-title">Do zrobienia</h2><Badge>{openTasks.length}</Badge></div>{openTasks.length === 0 ? <Card className="py-6 text-center text-sm text-dim">Wszystko zrobione.</Card> : openTasks.map(renderTask)}</section>
      {completedTasks.length > 0 && <section className="space-y-2 border-t border-border pt-4"><div className="flex items-center justify-between"><h2 className="font-semibold text-title">Wykonane</h2><Badge>{completedTasks.length}</Badge></div>{completedTasks.map(renderTask)}</section>}
    </>}
  </div>;
}
