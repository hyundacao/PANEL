'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Layers, RotateCcw } from 'lucide-react';
import { buildTaskPreparationList, type TaskTechnologyReference } from '@/lib/utils/productionTaskReference';

const MaterialList = ({ names }: { names: string[] }) => names.length > 0 && <ul aria-label="Do podstawienia pod maszynę" className="divide-y divide-[var(--border)]">
  {names.map(name => <li className="break-words py-2 text-xs font-semibold text-[var(--t-title)]" key={name}>{name}</li>)}
</ul>;

const referenceIssueMessage = (status: TaskTechnologyReference['status'] | undefined) =>
  status === 'ambiguous' ? 'Nie można jednoznacznie dopasować technologii. Powiązanie wymaga sprawdzenia w planowaniu.'
    : status === 'conflict' ? 'Planiści mają różne technologie dla tej pozycji. Wymaga uzgodnienia w planowaniu zapotrzebowania.'
    : status === 'unselected' ? 'Nie wybrano technologii w planowaniu zapotrzebowania dla tego dnia i stanowiska.'
    : status === 'unavailable' ? 'Technologia wybrana w planowaniu jest niedostępna. Wymaga sprawdzenia przez planistę.'
    : 'Brak technologii w bibliotece dla tej pozycji.';

export function TaskTechnologyPreview({ detail, station, planDate, areaId }: { detail: string; station: string; planDate: string; areaId?: string }) {
  const [open, setOpen] = useState(false);
  const query = useQuery<TaskTechnologyReference>({
    queryKey: ['production-task-technology', detail, station, planDate, areaId],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/przygotowanie-produkcji/reference?${new URLSearchParams({ detail, station, date: planDate, area: areaId ?? '' })}`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Nie udało się wczytać technologii.');
      return response.json();
    },
    enabled: open, staleTime: 0, gcTime: 5 * 60_000, retry: 1,
    refetchInterval: open ? 5_000 : false, refetchIntervalInBackground: false
  });
  const technologies = query.data?.items ?? [];
  const issues = query.data?.issues ?? [];
  const materials = buildTaskPreparationList(technologies);
  // Only the display is collapsed by name; material identities and demand
  // calculations remain unchanged and still use their original indexes.
  const names = [...new Map(materials.map(material => {
    const name = material.name.replace(/\s+/g, ' ').trim();
    return [name.toLocaleLowerCase('pl-PL'), name] as const;
  }).filter(([, name]) => name)).values()];
  const unnamedMaterials = materials.some(material => !material.name.trim());
  return <section className="border-t border-[var(--border)]">
    <button aria-expanded={open} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-[var(--t-title)] hover:bg-[var(--surface-2)]" onClick={() => setOpen(value => !value)} type="button">
      <Layers className="h-4 w-4 shrink-0" /><span className="flex-1">Podgląd technologii</span><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="space-y-3 border-t border-[var(--border)] px-3 py-3" aria-live="polite">
      {query.isPending ? <p className="text-xs text-[var(--t-muted)]">Wczytywanie technologii...</p>
        : query.isError ? <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--t-body)]"><span>Nie udało się wczytać technologii.</span><button className="inline-flex min-h-10 items-center gap-1 text-[var(--brand)]" onClick={() => void query.refetch()} type="button"><RotateCcw className="h-4 w-4" />Ponów</button></div>
        : <>
          {(issues.length > 0 || unnamedMaterials) && <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-[var(--t-body)]" role="status">
            <p>Lista niepełna — {unnamedMaterials ? 'część pozycji nie ma nazwy.' : 'część technologii wymaga sprawdzenia.'} Zgłoś to planiście.</p>
          </div>}
          {technologies.length > 0 ? <>
            <MaterialList names={names} />
            {!materials.length && <p className="text-xs text-[var(--t-muted)]">Brak materiałów do podstawienia.</p>}
          </> : !issues.length && <p className="text-xs text-[var(--t-muted)]">{referenceIssueMessage(query.data?.status)}</p>}
        </>}
    </div>}
  </section>;
}
