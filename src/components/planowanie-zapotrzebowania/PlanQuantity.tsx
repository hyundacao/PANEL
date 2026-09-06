import { AlertTriangle, ChevronDown } from 'lucide-react';
import { quantityIssueLabel, quantityNeedsReview, type PlanSourceFields } from '@/lib/planowanie-zapotrzebowania/planImport';

type QuantityItem = PlanSourceFields & { totalQty: number };
const fmt = (value: number) => value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });

export function PlanQuantity({ item, productionMode = 'planned', calculatedQuantity = 0, shiftNorm = 0 }: {
  item: QuantityItem;
  productionMode?: 'planned' | 'continuous' | 'linked';
  calculatedQuantity?: number;
  shiftNorm?: number;
}) {
  if (productionMode === 'continuous') return <div className="space-y-1" data-testid="plan-quantity" data-production-mode="continuous">
    <p className="text-base font-black text-title">Ciągła</p>
    {shiftNorm > 0
      ? <p className="text-xs font-semibold text-muted">{fmt(calculatedQuantity)} szt. w zakresie</p>
      : <p className="flex items-start justify-end gap-1 text-xs font-bold text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Brak wydajności na zmianę</span></p>}
  </div>;
  if (productionMode === 'linked') return <div className="space-y-1" data-testid="plan-quantity" data-production-mode="linked">
    <p className="text-base font-black text-title">Pod powiązanie</p>
    <p className="text-xs font-semibold text-muted">{fmt(calculatedQuantity)} szt. w zakresie</p>
  </div>;
  const review = quantityNeedsReview(item);
  const source = item.sourceQuantity?.trim();
  return <div className="space-y-1" data-testid="plan-quantity">
    <p className="whitespace-pre-line break-words text-base font-black text-title">{source || (review || item.sourceQuantity !== undefined ? '—' : fmt(item.totalQty))}</p>
    {review ? <p className="flex items-start justify-end gap-1 text-xs font-bold text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{quantityIssueLabel(item)} — do wyjaśnienia</span></p>
      : item.quantityStatus === 'manual' ? <p className="text-xs font-bold text-warning">Do obliczeń (ręcznie): {fmt(item.totalQty)} szt.</p>
        : item.quantityParts?.length ? <p className="text-xs text-muted">Do obliczeń łącznie: {fmt(item.totalQty)} szt.</p> : null}
  </div>;
}

type WarningItem = PlanSourceFields & { id: string; index: string; name: string; included: boolean; station: string };
export function PlanQuantityWarnings({ items, calculations = false, resolvedItemIds }: { items: WarningItem[]; calculations?: boolean; resolvedItemIds?: ReadonlySet<string> }) {
  const unresolved = items.filter((item) => !resolvedItemIds?.has(item.id) && quantityNeedsReview(item));
  if (!unresolved.length) return null;
  const activeCount = unresolved.filter((item) => item.included).length;
  const status = activeCount > 0
    ? calculations ? 'Obliczenia są niepełne' : `${activeCount} aktywnych blokuje dokument`
    : 'Wszystkie są wyłączone z obliczeń';
  return <details role="status" className="group border-y border-[rgba(245,158,11,0.42)] bg-[rgba(245,158,11,0.055)] text-sm">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-2">
        <p className="font-bold text-title">Brak ilości: {unresolved.length}</p>
        <p className="text-xs text-warning">{status}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted">Pokaż pozycje<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></span>
    </summary>
    <ul className="divide-y divide-border border-t border-border px-3">{unresolved.map((item) => <li key={item.id} className="grid gap-1 py-2 text-xs sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
      <span className="font-semibold text-muted">{item.station || 'Brak stanowiska'}{item.sourceRow ? ` · wiersz ${item.sourceRow}` : ''}</span>
      <span className="min-w-0"><strong className="text-title">{item.index || 'Brak indeksu'}</strong>{item.name && item.name !== item.index ? <span className="catalog-label"> · {item.name}</span> : null}</span>
      <span className="text-warning">{quantityIssueLabel(item)}{!item.included ? ' · wyłączona' : ''}</span>
    </li>)}</ul>
  </details>;
}
