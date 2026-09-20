'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { removeOriginalInventoryPalletSet, updateOriginalInventoryPalletSet } from '@/lib/api';
import type { OriginalInventoryEntry } from '@/lib/api/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { isPalletCount, palletInventoryError, parsePalletSource } from '@/lib/planowanie-zapotrzebowania/palletSets';

export default function PalletInventoryEditor({ batchId, entries, warehouses, readOnly, onClose, onSaved }: {
  batchId: string; entries: OriginalInventoryEntry[]; warehouses: Array<{ id: string; name: string }>;
  readOnly: boolean; onClose: () => void; onSaved: () => void;
}) {
  const rows = entries.filter((row) => parsePalletSource(row.sourceId)?.batchId === batchId);
  const first = rows[0];
  const firstSource = parsePalletSource(first?.sourceId);
  const [count, setCount] = useState(first && firstSource ? String(first.qty / firstSource.qtyPerSet) : '');
  const [warehouseId, setWarehouseId] = useState(first?.warehouseId ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  const save = async (remove: boolean) => {
    if (readOnly || busy.current) return;
    if (remove && !window.confirm('Usunąć cały wpis zestawu razem ze wszystkimi jego składnikami?')) return;
    if (!remove && !isPalletCount(Number(count))) { setError(palletInventoryError('PALLET_COUNT_REQUIRED')); return; }
    busy.current = true; setPending(true); setError('');
    try {
      if (remove) await removeOriginalInventoryPalletSet(batchId);
      else await updateOriginalInventoryPalletSet({ batchId, count: Number(count), warehouseId });
      onSaved(); onClose();
    } catch (err) { setError(palletInventoryError(err instanceof Error ? err.message : '')); }
    finally { busy.current = false; setPending(false); }
  };
  return <dialog ref={dialog} aria-labelledby="pallet-entry-title" onCancel={(event) => { event.preventDefault(); if (!busy.current) onClose(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_24px)] max-w-xl overflow-y-auto rounded-lg border border-border bg-[var(--bg-0)] p-4 text-body shadow-2xl backdrop:bg-black/60 sm:p-6">
    <div className="flex items-start justify-between gap-3"><h2 id="pallet-entry-title" className="min-w-0 break-words text-base font-bold text-title">{first?.note || 'Zestaw paletowy'}</h2><button type="button" title="Zamknij" aria-label="Zamknij edycję zestawu" disabled={pending} onClick={onClose} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border"><X className="h-4 w-4" /></button></div>
    {first ? <>
      <p className="mt-1 text-xs text-muted">{new Date(first.at).toLocaleDateString('pl-PL')} · {first.user}</p>
      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-muted">LICZBA PEŁNYCH ZESTAWÓW<Input aria-label="Liczba pełnych zestawów" className="mt-1 min-h-11" type="number" inputMode="numeric" min={1} step={1} value={count} disabled={pending || readOnly} onChange={(event) => setCount(event.target.value)} /></label>
        <label className="text-xs font-semibold text-muted">HALA<select aria-label="Hala zestawu" className="mt-1 min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 text-sm text-[var(--t-title)]" value={warehouseId} disabled={pending || readOnly} onChange={(event) => setWarehouseId(event.target.value)}>{warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <div className="divide-y divide-border border-y border-border">{rows.map((row) => <div key={row.id} className="flex items-start justify-between gap-3 py-3 text-sm"><span className="min-w-0 break-words">{row.name}</span><strong className="shrink-0 text-title">{isPalletCount(Number(count)) ? (parsePalletSource(row.sourceId)?.qtyPerSet ?? 0) * Number(count) : '—'} {row.unit}</strong></div>)}</div>
      {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
      {!readOnly && <div className="mt-4 flex flex-wrap justify-between gap-3"><Button variant="outline" disabled={pending} onClick={() => void save(true)}><Trash2 className="mr-2 h-4 w-4" />Usuń cały wpis</Button><Button disabled={pending} onClick={() => void save(false)}><Check className="mr-2 h-4 w-4" />{pending ? 'Zapisywanie...' : 'Zapisz cały zestaw'}</Button></div>}
    </> : <p className="py-4 text-sm text-muted">Nie znaleziono wpisu zestawu.</p>}
  </dialog>;
}
