'use client';

import { Fragment, useId, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils/cn';
import type { ZonePlanSummaryRow } from '@/lib/planowanie-zapotrzebowania/zoneStock';

type Props = {
  rows: ZonePlanSummaryRow[];
  areaName: string;
  planDate: string;
  inventoryDate: string;
  inventorySyncedAt: string;
  planIssues: string[];
  onRefresh: () => Promise<void>;
};

const quantity = (value: number) => value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
const signedQuantity = (value: number) => `${value > 0 ? '+' : ''}${quantity(value)}`;
const signedPercent = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`;

export function ZonePlanSummary({ rows, areaName, planDate, inventoryDate, inventorySyncedAt, planIssues, onRefresh }: Props) {
  const titleId = useId();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const tokens = search.trim().toLocaleLowerCase('pl-PL').split(/\s+/).filter(Boolean);
  const visibleRows = rows.filter((row) => {
    const text = [row.code, row.name, ...row.sources.flatMap((source) => [source.index, source.name, source.station])]
      .join(' ').toLocaleLowerCase('pl-PL');
    return tokens.every((token) => text.includes(token));
  });
  const hasSharedStock = rows.some((row) => row.sharedStock !== null || row.incompatibleSharedStock);
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  return <section aria-labelledby={titleId} className="min-w-0 space-y-3 border-t border-borderStrong pt-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={titleId} className="text-lg font-bold text-title">Podsumowanie strefy · {areaName}</h2>
        <p className="mt-1 text-xs text-muted">Bieżący plan: {planDate} · Zakresy wybrane w pozycjach planu</p>
        <p className="mt-1 text-xs text-muted">Spis: {inventoryDate || 'brak danych'}{inventorySyncedAt ? ` · pobrano ${inventorySyncedAt}` : ''}</p>
      </div>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input className="h-11 min-h-11 pl-9" aria-label="Szukaj w podsumowaniu strefy" placeholder="Materiał, indeks, zlecenie" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <Button variant="outline" title="Odśwież stan strefy" aria-label="Odśwież stan strefy" disabled={refreshing}
          className="h-11 min-h-11 w-11 shrink-0 p-0" onClick={refresh}><RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} /></Button>
      </div>
    </div>
    {planIssues.length ? <div role="status" className="border-l-2 border-[var(--warning)] py-1 pl-3 text-sm text-[var(--warning)]">
      <p className="font-semibold">Niepełne dane w planie. Różnice obejmują wyliczone zapotrzebowanie.</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">{planIssues.map((issue, index) => <li key={`${index}-${issue}`} className="break-words">{issue}</li>)}</ul>
    </div> : null}
    <div className="overflow-x-auto border-y border-border">
      <table className="w-full min-w-[850px] text-sm">
        <thead className="border-b border-borderStrong bg-[var(--surface-soft)] text-left text-xs uppercase text-dim">
          <tr><th className="w-12 p-3"><span className="sr-only">Zlecenia</span></th><th className="p-3">Materiał / indeks</th>
            <th className="w-36 p-3 text-right">Zapotrzebowanie</th><th className="w-36 p-3 text-right">Stan strefy</th>
            {hasSharedStock ? <th className="w-36 p-3 text-right">Silosy wspólne</th> : null}
            <th className="w-40 p-3 text-right" title="Stan fizyczny strefy minus zapotrzebowanie. Bez silosów i dokumentów oczekujących na wydanie.">Różnica w strefie</th>
            <th className="w-24 p-3">J.m.</th></tr>
        </thead>
        <tbody>{visibleRows.map((row) => {
          const isExpanded = expanded === row.key;
          const unknown = row.stockStatus === 'ambiguous' ? 'Spis niejednoznaczny' : row.stockStatus === 'incompatible' ? 'Inna j.m.' : row.stockStatus === 'ready' ? 'Brak pełnego zapotrzebowania' : 'Brak spisu';
          const tone = row.balance === null ? 'text-[var(--t-muted)]' : row.balance < 0 ? 'text-[var(--danger)]' : row.balance === 0 ? 'text-[var(--warning)]' : 'text-[var(--t-title)]';
          return <Fragment key={row.key}>
            <tr className="border-t border-border">
              <td className="p-2"><button type="button" title={isExpanded ? 'Ukryj zlecenia' : 'Pokaż zlecenia'}
                aria-label={`Zlecenia dla ${row.name}`} aria-expanded={isExpanded} onClick={() => setExpanded(isExpanded ? '' : row.key)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-border text-muted hover:text-title">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></td>
              <td className="min-w-64 max-w-lg p-3"><p className="break-words font-bold text-title">{row.code || 'Bez indeksu'}</p>
                <p className="catalog-label break-words font-semibold">{row.name}</p><p className="mt-1 text-xs text-muted">Pozycje planu: {row.sources.length}</p></td>
              <td className="p-3 text-right font-semibold tabular-nums">{row.demand === null ? 'Brak danych' : quantity(row.demand)}</td>
              <td className="p-3 text-right font-semibold tabular-nums">
                <p title={row.stockStatus === 'ambiguous' ? 'Spis zawiera samą nazwę, a plan kilka indeksów o tej nazwie. Stan nie został przypisany do żadnego z nich.' : undefined}>{row.stock === null ? unknown : quantity(row.stock)}</p>
                {row.stock !== null && row.stockMatchedByName ? <p className="mt-1 text-xs font-normal text-[var(--t-muted)]" title="Spis zapisano według nazwy. Indeks w tym wierszu pochodzi z planu.">Spis po nazwie</p> : null}
              </td>
              {hasSharedStock ? <td className="p-3 text-right tabular-nums text-muted">{row.incompatibleSharedStock ? 'Inna j.m.' : row.sharedStock === null ? '—' : quantity(row.sharedStock)}</td> : null}
              <td className={cn('p-3 text-right tabular-nums', tone)}><p className="text-base font-black">{row.balance === null ? unknown : signedQuantity(row.balance)}</p>
                {row.marginPercent !== null ? <p className="mt-1 text-xs" title="Różnica podzielona przez zapotrzebowanie">{signedPercent(row.marginPercent)}{row.balance === 0 ? ' · Bez zapasu' : ''}</p> : null}
                {row.balancePartial ? <p className="mt-1 text-xs font-semibold text-[var(--warning)]" title="Różnica dla wyliczonego zapotrzebowania. Plan zawiera nieuzupełnione pozycje wymienione nad tabelą.">Wstępnie</p> : null}
              </td>
              <td className="p-3 text-muted">{row.unit}</td>
            </tr>
            {isExpanded ? <tr className="border-t border-border bg-[var(--surface-faint)]"><td colSpan={hasSharedStock ? 7 : 6} className="px-4 py-3">
              <p className="mb-2 text-xs font-bold uppercase text-dim">Zlecenia · {areaName}</p>
              <ul className="divide-y divide-[var(--border)]">{row.sources.map((source) => <li key={source.id} className="flex items-start justify-between gap-4 py-2">
                <div className="min-w-0"><p className="break-words font-bold text-title">{source.index}{source.station ? ` · ${source.station}` : ''}</p><p className="break-words text-muted">{source.name}</p></div>
                <span className="shrink-0 font-bold tabular-nums">{source.demand === null ? 'Brak danych' : `${quantity(source.demand)} ${row.unit}`}</span>
              </li>)}</ul>
            </td></tr> : null}
          </Fragment>;
        })}</tbody>
      </table>
      {!visibleRows.length ? <p className="px-4 py-8 text-center text-sm text-muted">{rows.length ? 'Brak pasujących materiałów.' : 'Brak zapotrzebowania dla tej strefy.'}</p> : null}
    </div>
  </section>;
}
