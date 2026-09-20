'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { searchOriginalInventoryCatalog } from '@/lib/api';
import type { OriginalInventoryCatalogEntry } from '@/lib/api/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { isPieceUnit, palletSetError, type PalletSet, type PalletSetComponent } from '@/lib/planowanie-zapotrzebowania/palletSets';

function CatalogPicker({ onSelect }: { onSelect: (item: OriginalInventoryCatalogEntry) => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  const { data = [], isFetching } = useQuery({
    queryKey: ['spis-oryginalow-catalog-search', debounced.toLowerCase()],
    queryFn: ({ signal }) => searchOriginalInventoryCatalog(debounced, 24, signal),
    enabled: debounced.length >= 2 && open, staleTime: 300_000, retry: false
  });
  const items = debounced === query.trim() ? data.filter((item) => isPieceUnit(item.unit)) : [];
  const choose = (item: OriginalInventoryCatalogEntry) => { cancelClose(); onSelect(item); setQuery(''); setOpen(false); };
  return <div className="relative">
    <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted" />
      <Input aria-label="Dodaj składnik z katalogu" value={query} className="min-h-11 pl-9"
        placeholder="Nazwa lub indeks 2 składnika" onFocus={() => { cancelClose(); setOpen(true); }}
        onBlur={() => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 150); }}
        onChange={(event) => { cancelClose(); setQuery(event.target.value); setOpen(true); }}
        onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); if (event.key === 'Enter') { event.preventDefault(); if (items[0]) choose(items[0]); } }} />
    </div>
    {open && query.trim().length >= 2 && <div className="absolute z-30 mt-1 max-h-64 w-full touch-pan-y overflow-y-auto overscroll-contain rounded-lg border border-border bg-[var(--bg-0)] shadow-lg">
      {items.map((item) => <button key={item.id} type="button" className="block min-h-11 w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-surface2"
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item)}>
        <span className="block break-words font-semibold text-title">{item.name}</span><span className="text-xs text-muted">{item.indexCode2 || item.indexCode} · {item.unit}</span>
      </button>)}
      {!items.length && <p className="p-3 text-sm text-muted">{isFetching || debounced !== query.trim() ? 'Wyszukiwanie...' : 'Brak pozycji w sztukach.'}</p>}
    </div>}
  </div>;
}

export default function PalletSetSettings({ sets, readOnly, onChange }: {
  sets: PalletSet[]; readOnly: boolean; onChange: (sets: PalletSet[]) => void;
}) {
  const [draft, setDraft] = useState<PalletSet | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const edit = (set: PalletSet) => { setDraft(structuredClone(set)); setError(''); };
  const addPart = (item: OriginalInventoryCatalogEntry) => {
    if (!draft) return;
    if (draft.components.some((part) => part.catalogId === item.id)) { setError('Ten indeks jest już w zestawie.'); return; }
    const part: PalletSetComponent = { catalogId: item.id, name: item.name, unit: item.unit, qty: 0,
      indexCode: item.indexCode ?? '', indexCode2: item.indexCode2 ?? '', warehouseCode: item.warehouseCode ?? '' };
    setDraft({ ...draft, name: draft.name || item.name, primaryCatalogId: draft.primaryCatalogId || item.id, components: [...draft.components, part] });
    setError('');
  };
  const save = () => {
    if (!draft || readOnly) return;
    const message = palletSetError(draft);
    if (message) { setError(message); return; }
    onChange(sets.some((set) => set.id === draft.id) ? sets.map((set) => set.id === draft.id ? draft : set) : [...sets, draft]);
    setDraft(null);
  };
  const filtered = sets.filter((set) => `${set.name} ${set.components.map((part) => part.indexCode2 || part.indexCode).join(' ')}`.toLocaleLowerCase('pl').includes(filter.toLocaleLowerCase('pl')));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold text-title">Zestawy paletowe <span className="text-sm text-muted">({sets.length})</span></h2>
      <Button variant="outline" disabled={readOnly || Boolean(draft)} onClick={() => edit({ id: crypto.randomUUID(), name: '', active: true, primaryCatalogId: '', components: [] })}><Plus className="mr-2 h-4 w-4" />Dodaj zestaw</Button>
    </div>
    {draft && <section className="space-y-4 border-y-2 border-brand py-4" aria-label="Edycja zestawu paletowego">
      <div className="flex flex-wrap items-end gap-4">
        <label className="min-w-0 flex-1 text-xs font-semibold text-muted">NAZWA ZESTAWU<Input value={draft.name} maxLength={300} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1 min-h-11" /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />Aktywny</label>
      </div>
      <div className="divide-y divide-border border-y border-border">
        {draft.components.map((part) => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_100px_40px] items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_140px_40px]" key={part.catalogId}>
          <div className="min-w-0"><p className="break-words text-sm font-semibold text-title">{part.name}</p><p className="text-xs text-muted">{part.indexCode2 || part.indexCode}</p>
            <label className="mt-2 flex items-center gap-2 text-xs"><input type="radio" name="pallet-primary" checked={draft.primaryCatalogId === part.catalogId} onChange={() => setDraft({ ...draft, primaryCatalogId: part.catalogId })} />Indeks wyszukiwany</label>
          </div>
          <label className="text-xs text-muted">SZT. / ZESTAW<Input aria-label={`Sztuk na zestaw: ${part.name}`} type="number" inputMode="numeric" min={1} step={1} value={part.qty || ''} className="mt-1 min-h-11"
            onChange={(event) => setDraft({ ...draft, components: draft.components.map((row) => row.catalogId === part.catalogId ? { ...row, qty: Number(event.target.value) } : row) })} /></label>
          <button type="button" title="Usuń składnik" aria-label={`Usuń składnik: ${part.name}`} className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-danger"
            onClick={() => { const parts = draft.components.filter((row) => row.catalogId !== part.catalogId); setDraft({ ...draft, components: parts, primaryCatalogId: draft.primaryCatalogId === part.catalogId ? parts[0]?.catalogId ?? '' : draft.primaryCatalogId }); }}><Trash2 className="h-4 w-4" /></button>
        </div>)}
      </div>
      {draft.components.length < 20 && <CatalogPicker onSelect={addPart} />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setDraft(null)}><X className="mr-2 h-4 w-4" />Anuluj</Button><Button disabled={readOnly} onClick={save}><Check className="mr-2 h-4 w-4" />Zapisz zestaw</Button></div>
    </section>}
    {sets.length > 5 && <Input aria-label="Filtruj zestawy" placeholder="Szukaj zestawu..." value={filter} onChange={(event) => setFilter(event.target.value)} />}
    <div className="divide-y divide-border border-y border-border">
      {filtered.map((set) => <details key={set.id} className="group py-3">
        <summary className="flex cursor-pointer list-none items-center gap-3"><ChevronDown className="h-4 w-4 shrink-0 text-muted" /><span className="min-w-0 flex-1 break-words font-semibold text-title">{set.name}</span><span className="shrink-0 text-xs text-muted">{set.active ? 'Aktywny' : 'Wyłączony'}</span></summary>
        <div className="mt-3 space-y-2 pl-7">{set.components.map((part) => <div key={part.catalogId} className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{part.indexCode2 || part.indexCode} · {part.name}{part.catalogId === set.primaryCatalogId && <span className="block text-xs text-brand">Indeks wyszukiwany</span>}</span><span className="shrink-0 font-bold">{part.qty} szt.</span></div>)}
          <div className="flex justify-end gap-2 pt-2"><Button variant="outline" disabled={readOnly || Boolean(draft)} onClick={() => edit(set)}><Pencil className="mr-2 h-4 w-4" />Edytuj</Button><button type="button" title="Usuń zestaw" aria-label={`Usuń zestaw: ${set.name}`} disabled={readOnly || Boolean(draft)} className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-danger disabled:opacity-40" onClick={() => { if (window.confirm(`Usunąć zestaw „${set.name}”? Zapisane spisy pozostaną bez zmian.`)) onChange(sets.filter((item) => item.id !== set.id)); }}><Trash2 className="h-4 w-4" /></button></div>
        </div>
      </details>)}
      {!sets.length && !draft && <p className="py-6 text-sm text-muted">Brak zestawów paletowych.</p>}
    </div>
  </div>;
}
