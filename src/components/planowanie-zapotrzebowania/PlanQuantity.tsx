import { quantityIssueLabel, quantityNeedsReview, type PlanSourceFields } from '@/lib/planowanie-zapotrzebowania/planImport';

type QuantityItem = PlanSourceFields & { totalQty: number };
const fmt = (value: number) => value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });

export function PlanQuantity({ item }: { item: QuantityItem }) {
  const review = quantityNeedsReview(item);
  const source = item.sourceQuantity?.trim();
  return <div className="space-y-1" data-testid="plan-quantity">
    <p className="whitespace-pre-line break-words font-bold text-title">{source || (review || item.sourceQuantity !== undefined ? '—' : fmt(item.totalQty))}</p>
    {review ? <p className="text-xs font-bold text-warning">⚠ {quantityIssueLabel(item)} — do wyjaśnienia</p>
      : item.quantityStatus === 'manual' ? <p className="text-xs font-bold text-warning">Do obliczeń (ręcznie): {fmt(item.totalQty)} szt.</p>
        : item.quantityParts?.length ? <p className="text-xs text-muted">Do obliczeń łącznie: {fmt(item.totalQty)} szt.</p> : null}
  </div>;
}

type WarningItem = PlanSourceFields & { id: string; index: string; name: string; included: boolean; station: string };
export function PlanQuantityWarnings({ items, calculations = false }: { items: WarningItem[]; calculations?: boolean }) {
  const unresolved = items.filter(quantityNeedsReview);
  if (!unresolved.length) return null;
  const activeCount = unresolved.filter((item) => item.included).length;
  return <div role="status" className="space-y-2 rounded-xl border border-[rgba(245,158,11,0.5)] bg-[rgba(245,158,11,0.08)] p-4 text-sm">
    <p className="font-bold text-warning">Ilość do wyjaśnienia: {unresolved.length} {calculations && activeCount > 0 ? '— obliczenia niepełne' : '— wszystkie pozycje są w planie'}</p>
    <p className="text-muted">Oryginalny zapis pozostaje w kolumnie ilości. Rozwiń pozycję i ustaw ilość do obliczeń albo świadomie wyłącz ją z obliczeń. Nieznana ilość nie oznacza zerowego zapotrzebowania.</p>
    {activeCount > 0 ? <p className="font-semibold text-warning">Dokument dla strefy z nieustaloną ilością wymaga najpierw jej wyjaśnienia lub wyłączenia pozycji.</p> : null}
    <details><summary className="cursor-pointer font-semibold text-title">Pokaż pozycje do wyjaśnienia</summary>
      <ul className="mt-2 space-y-1 text-muted">{unresolved.map((item) => <li key={item.id}>
        {item.sourceRow ? `Wiersz ${item.sourceRow} · ` : ''}{item.station || 'Brak stanowiska'} · {item.index || item.name}: {quantityIssueLabel(item)}{!item.included ? ' (wyłączona z obliczeń)' : ''}
      </li>)}</ul>
    </details>
  </div>;
}
