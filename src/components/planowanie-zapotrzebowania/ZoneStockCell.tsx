'use client';

import { useEffect, useId, useRef } from 'react';
import { CircleHelp, X } from 'lucide-react';
import type { ZoneStockSummary } from '@/lib/planowanie-zapotrzebowania/zoneStock';

type Props = {
  areaName: string;
  materialName: string;
  sourceDate: string;
  stockReady: boolean;
  summary: ZoneStockSummary;
  currentDemand: number | null;
  included: boolean;
  incompletePlan: boolean;
  formatQuantity: (value: number) => string;
};

export function ZoneStockCell({ areaName, materialName, sourceDate, stockReady, summary, currentDemand, included, incompletePlan, formatQuantity }: Props) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const position = () => {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 24);
    const maxHeight = Math.min(500, window.innerHeight - 24);
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${maxHeight}px`;
    const height = Math.min(popover.scrollHeight || maxHeight, maxHeight);
    popover.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
    popover.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))}px`;
  };
  useEffect(() => {
    const reposition = () => {
      if (popoverRef.current?.matches(':popover-open')) position();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, []);
  const quantity = (value: number | null) => value === null ? 'Brak danych' : formatQuantity(value);
  const stockLabel = !areaName ? 'Brak strefy' : !stockReady || summary.stock === null
    ? summary.incompatibleStock && stockReady ? 'Inna j.m.' : 'Brak spisu'
    : formatQuantity(summary.stock);
  const hasSharedStock = stockReady && (summary.sharedStock !== null || summary.incompatibleSharedStock);
  const sharedLabel = summary.incompatibleSharedStock ? 'Inna j.m.' : quantity(summary.sharedStock);
  const otherSources = hasSharedStock ? summary.allOthers : summary.others;

  return <>
    <button ref={buttonRef} type="button" popoverTarget={id} onClick={position}
      title="Stan strefy i zapotrzebowanie"
      aria-label={`Stan strefy ${areaName || 'nieprzypisanej'}: ${stockLabel}.${hasSharedStock ? ` Silosy wspólne: ${sharedLabel}.` : ''} Szczegóły zapotrzebowania`}
      className="flex min-h-11 w-full items-center justify-end gap-2 px-2 py-1.5 text-right font-bold tabular-nums text-title hover:bg-[var(--surface-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      <span className="min-w-0"><span className="block">{stockLabel}</span>{hasSharedStock ? <span className="mt-0.5 block text-[11px] leading-4 text-muted">Silosy: {sharedLabel}</span> : null}</span><CircleHelp className="h-4 w-4 shrink-0 text-muted" />
    </button>
    <div id={id} ref={popoverRef} popover="auto" onToggle={(event) => { if (event.newState === 'open') position(); }}
      role="dialog" aria-label={`Stan strefy: ${materialName}`}
      className="fixed m-0 overflow-y-auto overscroll-contain rounded-lg border border-borderStrong bg-[var(--surface-1)] p-4 text-left text-xs normal-case text-body shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-title">{areaName || 'Nieprzypisana strefa'}</p>
          <p className="mt-1 break-words font-semibold text-brand">{materialName}</p>
        </div>
        <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Zamknij szczegóły stanu" title="Zamknij"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted hover:text-title"><X className="h-4 w-4" /></button>
      </div>
      <dl className="mt-3 space-y-2 border-y border-border py-3">
        <div className="flex justify-between gap-3"><dt>Spisano w strefie</dt><dd className="shrink-0 font-bold">{stockLabel}</dd></div>
        {hasSharedStock ? <div className="flex justify-between gap-3"><dt>Silosy · wspólne dla wszystkich stref</dt><dd className="shrink-0 font-bold">{sharedLabel}</dd></div> : null}
        <div className="flex justify-between gap-3"><dt>Ten detal · wybrany zakres</dt><dd className="shrink-0 font-bold">{quantity(currentDemand)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Inne detale · {areaName || 'ta strefa'}</dt><dd className="shrink-0 font-bold">{quantity(summary.otherDemand)}</dd></div>
        {hasSharedStock ? <div className="flex justify-between gap-3"><dt>Inne detale · wszystkie strefy</dt><dd className="shrink-0 font-bold">{quantity(summary.allOtherDemand)}</dd></div> : null}
      </dl>
      <p className="mt-2 text-muted">Spis: {stockReady && sourceDate ? sourceDate : 'brak danych dla dnia planu'}</p>
      {!included ? <p className="mt-2 text-muted">Ten detal jest wyłączony z obliczeń.</p> : null}
      {summary.incompatibleStock && stockReady ? <p className="mt-2 text-muted">Jednostka w spisie nie jest zgodna z jednostką materiału.</p> : null}
      {incompletePlan ? <p className="mt-2 text-muted">Niepełne zapotrzebowanie: {hasSharedStock ? 'w planie' : 'w tej strefie'} są pozycje bez strefy, technologii, ilości lub normy.</p> : null}
      <p className="mt-3 font-semibold text-title">Pozostałe detale · wybrane zakresy</p>
      {otherSources.length ? <ul className="mt-2 divide-y divide-[var(--border)] border-t border-border">
        {otherSources.map((other) => <li key={other.id} className="py-2">
          <div className="flex items-start justify-between gap-3"><span className="min-w-0 break-words font-bold text-title">{other.index}{other.station ? ` · ${other.station}` : ''}</span><span className="shrink-0 font-bold tabular-nums">{quantity(other.demand)}</span></div>
          {hasSharedStock ? <p className="mt-1 font-semibold text-muted">{other.areaName}</p> : null}
          <p className="mt-1 break-words text-muted">{other.name}</p>
        </li>)}
      </ul> : <p className="mt-2 text-muted">Brak innych pozycji z tym materiałem {hasSharedStock ? 'w planie' : 'w tej strefie'}.</p>}
      <p className="mt-2 border-t border-border pt-2 text-muted">{hasSharedStock ? 'Silosy to jeden wspólny zapas dla wszystkich stref, bez rezerwacji dla poszczególnych detali.' : 'Wspólny stan strefy, bez rezerwacji dla poszczególnych detali.'}</p>
    </div>
  </>;
}
