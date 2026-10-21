'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Trash2, Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { useToastStore } from '@/components/ui/Toast';
import {
  GRIND_TARGET_EXCLUSIONS_QUERY_KEY, grindingTargetSuggestionKey,
  normalizeRemovedGrindingTargetSuggestions, type RemovedGrindingTargetSuggestion
} from '@/lib/utils/grindingTargetSuggestions';

export function GrindingTargetInput({ value, onChange, suggestions, removed, readOnly, loading, loadError, onRetry }: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  removed: RemovedGrindingTargetSuggestion[];
  readOnly: boolean;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const client = useQueryClient();
  const toast = useToastStore((state) => state.push);
  const change = useMutation({
    mutationFn: async (variables: { action: 'hide' | 'restore'; name: string }) => {
      const response = await fetch('/api/original-inventory-grind-target-exclusions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(variables)
      });
      if (!response.ok) throw new Error('SAVE_FAILED');
      const payload = await response.json() as { items?: unknown };
      return normalizeRemovedGrindingTargetSuggestions(payload.items);
    },
    onMutate: async () => { await client.cancelQueries({ queryKey: GRIND_TARGET_EXCLUSIONS_QUERY_KEY }); },
    onSuccess: (items, variables) => {
      client.setQueryData(GRIND_TARGET_EXCLUSIONS_QUERY_KEY, items);
      if (variables.action === 'restore' && items.length === 0) setShowRemoved(false);
      if (variables.action === 'hide' && grindingTargetSuggestionKey(value) === grindingTargetSuggestionKey(variables.name)) onChange('');
      toast({ title: variables.action === 'hide' ? 'Usunięto podpowiedź' : 'Przywrócono podpowiedź', description: variables.name, tone: 'success' });
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: GRIND_TARGET_EXCLUSIONS_QUERY_KEY }); }
  });
  const rows = showRemoved ? removed.map((item) => item.name) : suggestions;
  const removeOrRestore = (name: string) => {
    if (!readOnly && !change.isPending && !loading && !loadError) change.mutate({ action: showRemoved ? 'restore' : 'hide', name });
  };

  return <div className="relative mt-1" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Input value={value} onChange={(event) => { onChange(event.target.value); setShowRemoved(false); setOpen(true); }}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
      aria-label="Na jaką kartotekę zmielić" autoComplete="off" placeholder="np. PRZEMIAŁ PP MIX" className="min-h-[54px] pr-12 font-semibold" />
    {!readOnly && removed.length > 0 && <button type="button" title="Usunięte podpowiedzi" aria-label="Usunięte podpowiedzi" aria-pressed={showRemoved}
      className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-md text-dim hover:bg-surface2 hover:text-title"
      onMouseDown={(event) => event.preventDefault()} onClick={() => { setShowRemoved(!showRemoved); setOpen(true); }}><Undo2 className="h-4 w-4" /></button>}
    {open && <div className="relative z-30 mt-2 max-h-60 w-full overflow-y-auto rounded-lg border border-border bg-[var(--bg-0)]">
      {loading ? <p className="px-3 py-2 text-xs text-dim" role="status">Wczytywanie podpowiedzi...</p>
        : loadError ? <div className="flex items-center gap-2 px-3 py-2 text-xs text-danger" role="alert">Nie udało się pobrać podpowiedzi.
          <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center" title="Ponów" aria-label="Ponów pobieranie podpowiedzi" onClick={onRetry}><RefreshCw className="h-4 w-4" /></button></div>
          : <>
            {showRemoved && <p className="px-3 py-2 text-xs font-semibold text-dim">Usunięte podpowiedzi</p>}
            {rows.map((option) => <div key={option} className="flex items-center border-b border-border last:border-b-0">
              {showRemoved ? <span className="min-w-0 flex-1 break-words px-3 py-2 text-sm text-dim">{option}</span>
                : <button type="button" className="min-h-11 min-w-0 flex-1 break-words px-3 py-2 text-left text-sm font-semibold text-body hover:bg-surface2"
                  onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); setOpen(false); change.reset(); }}>{option}</button>}
              {!readOnly && <button type="button" title={showRemoved ? 'Przywróć podpowiedź' : 'Usuń z podpowiedzi'}
                aria-label={`${showRemoved ? 'Przywróć' : 'Usuń'} podpowiedź ${option}`} disabled={change.isPending}
                className="m-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-dim hover:bg-surface2 hover:text-brand disabled:opacity-40"
                onMouseDown={(event) => event.preventDefault()} onClick={() => removeOrRestore(option)}>
                {showRemoved ? <Undo2 className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              </button>}
            </div>)}
            {rows.length === 0 && <p className="px-3 py-2 text-xs text-dim">Brak podpowiedzi</p>}
          </>}
      {change.isError && <p className="px-3 py-2 text-xs text-danger" role="alert">Nie zapisano zmiany. Spróbuj ponownie.</p>}
    </div>}
  </div>;
}
