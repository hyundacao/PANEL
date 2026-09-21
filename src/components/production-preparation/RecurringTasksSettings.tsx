'use client';

import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TaskHallSelect } from '@/components/production-preparation/TaskHallSelect';
import { isProductionHallSelection, isProductionTaskReferenceTeam, productionHallLabel } from '@/lib/utils/productionTaskReference';
import { cn } from '@/lib/utils/cn';
import { RECURRING_TASK_WEEKDAYS, type RecurringTaskDefinition } from '@/lib/utils/productionRecurringTasks';
import type { ProductionTeam } from '@/lib/utils/productionTeamComments';

type TeamOption = { id: ProductionTeam; label: string; color: string };

type Props = {
  tasks: RecurringTaskDefinition[];
  drafts: RecurringTaskDefinition[];
  editing: boolean;
  saving: boolean;
  error: string | null;
  teams: TeamOption[];
  onBeginEdit: () => void;
  onCancel: () => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Omit<RecurringTaskDefinition, 'id'>>) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
};

const daySummary = (task: RecurringTaskDefinition) => task.weekdays.length === 7
  ? 'Codziennie'
  : RECURRING_TASK_WEEKDAYS.filter((day) => task.weekdays.includes(day.value)).map((day) => day.label).join(', ');

export function RecurringTasksSettings({
  tasks,
  drafts,
  editing,
  saving,
  error,
  teams,
  onBeginEdit,
  onCancel,
  onAdd,
  onUpdate,
  onRemove,
  onSave
}: Props) {
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface2 px-4 py-3 sm:px-5">
      <p className="text-xs text-dim">Każdego wybranego dnia zadanie pojawi się raz w kolejkach przypisanych grup.</p>
      {!editing && <Button className="min-h-10 shrink-0 px-4 py-2 text-xs" onClick={onBeginEdit} type="button" variant="outline">
        <Pencil className="mr-1.5 h-3.5 w-3.5" />Edytuj harmonogram
      </Button>}
    </div>

    {editing ? <div>
      {drafts.length === 0 ? <p className="px-4 py-6 text-sm text-dim sm:px-5">Brak cykli. Dodaj pierwsze zadanie.</p> : <div className="divide-y divide-border">
        {drafts.map((task, index) => <section className="space-y-4 px-4 py-4 sm:px-5" key={task.id}>
          <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="text-xs font-semibold text-dim">Treść zadania
              <Input className="mt-1" maxLength={240} onChange={(event) => onUpdate(task.id, { title: event.target.value })} placeholder="Np. Sprawdzić poziom oleju w wtryskarkach" value={task.title} />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-lg bg-bg px-3 text-xs font-semibold text-body">
              <input checked={task.active} onChange={(event) => onUpdate(task.id, { active: event.target.checked })} type="checkbox" />
              Aktywne
            </label>
            <button aria-label={`Usuń zadanie ${index + 1}`} className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-500/40 text-red-300 transition hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" onClick={() => onRemove(task.id)} title="Usuń cykl" type="button">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {task.teams.some(isProductionTaskReferenceTeam) && <TaskHallSelect value={task.hall ?? ''} onChange={value => onUpdate(task.id, { hall: isProductionHallSelection(value) ? value : undefined })} />}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <fieldset>
              <legend className="mb-2 text-[11px] font-bold uppercase text-dim">Dni tygodnia</legend>
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                {RECURRING_TASK_WEEKDAYS.map((day) => {
                  const selected = task.weekdays.includes(day.value);
                  return <button aria-pressed={selected} className={cn('min-h-10 rounded-lg bg-bg px-2 text-xs font-bold text-dim transition hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]', selected && 'bg-[rgba(255,122,0,0.16)] text-[var(--brand)] ring-1 ring-inset ring-[rgba(255,122,0,0.55)]')} key={day.value} onClick={() => onUpdate(task.id, { weekdays: selected ? task.weekdays.filter((value) => value !== day.value) : [...task.weekdays, day.value].sort((left, right) => left - right) })} type="button">
                    {day.label}
                  </button>;
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-[11px] font-bold uppercase text-dim">Przypisane grupy</legend>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {teams.map((team) => {
                  const selected = task.teams.includes(team.id);
                  return <label className={cn('flex min-h-10 items-center gap-2 rounded-lg bg-bg px-3 text-xs font-semibold text-dim transition hover:bg-surface2', selected && 'bg-surface2 text-title ring-1 ring-inset ring-border')} key={team.id}>
                    <input checked={selected} onChange={() => onUpdate(task.id, { teams: selected ? task.teams.filter((value) => value !== team.id) : [...task.teams, team.id] })} type="checkbox" />
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: team.color }} />
                    <span>{team.label}</span>
                  </label>;
                })}
              </div>
            </fieldset>
          </div>
        </section>)}
      </div>}

      {error && <p className="border-t border-red-500/25 bg-red-500/10 px-4 py-3 text-xs font-semibold text-red-300 sm:px-5">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2 border-t border-border bg-surface2 px-4 py-3 sm:px-5">
        <Button className="min-h-10 px-4 py-2 text-xs" onClick={onAdd} type="button" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" />Dodaj cykl</Button>
        <div className="flex gap-2">
          <Button className="min-h-10 px-4 py-2 text-xs" disabled={saving} onClick={onCancel} type="button" variant="ghost"><X className="mr-1.5 h-3.5 w-3.5" />Anuluj</Button>
          <Button className="min-h-10 px-4 py-2 text-xs" disabled={saving} onClick={onSave} type="button" variant="primaryEmber"><Check className="mr-1.5 h-3.5 w-3.5" />{saving ? 'Zapisywanie...' : 'Zapisz cykle'}</Button>
        </div>
      </div>
    </div> : tasks.length === 0 ? <p className="px-4 py-6 text-sm text-dim sm:px-5">Nie ustawiono jeszcze żadnego zadania cyklicznego.</p> : <div className="divide-y divide-border">
      {tasks.map((task) => <div className="grid gap-2 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)_auto] lg:items-center" key={task.id}>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="break-words font-semibold text-title">{task.title}</p>
            {!task.active && <Badge>Wyłączone</Badge>}
          </div>
          <p className="mt-1 text-xs font-semibold text-[var(--brand)]">{daySummary(task)}{task.teams.some(isProductionTaskReferenceTeam) && ` · ${productionHallLabel(task.hall)}`}</p>
        </div>
        <p className="text-xs text-body">{task.teams.map((team) => teams.find((option) => option.id === team)?.label ?? team).join(', ')}</p>
        <span className={cn('w-fit rounded-full px-2.5 py-1 text-[11px] font-semibold', task.active ? 'bg-emerald-500/12 text-emerald-300' : 'bg-slate-500/12 text-slate-300')}>{task.active ? 'Aktywne' : 'Wstrzymane'}</span>
      </div>)}
    </div>}
  </div>;
}
