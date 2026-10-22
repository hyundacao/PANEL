'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { savePaintTapeInventoryComment } from '@/lib/api';
import type { PaintTapeInventoryComment as Comment } from '@/lib/api/types';
import { Button } from '@/components/ui/Button';

export function PaintTapeInventoryComment({ sessionId, itemId, itemName, comment, queryKey, readOnly, unavailable }: {
  sessionId: string;
  itemId: string;
  itemName: string;
  comment?: Comment;
  queryKey: readonly string[];
  readOnly: boolean;
  unavailable: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<{ text: string; revision: number } | null>(null);
  const text = draft?.text ?? comment?.text ?? '';
  const changed = text.trim() !== (comment?.text ?? '');
  const save = useMutation({
    mutationFn: savePaintTapeInventoryComment,
    onSuccess: (saved) => {
      queryClient.setQueryData<Comment[]>(queryKey, (current) => [
        ...(current ?? []).filter((item) => item.catalogItemId !== saved.catalogItemId), saved
      ]);
      setDraft(null);
    },
    onError: (error: Error) => {
      if (error.message === 'INVENTORY_COMMENT_CONFLICT') void queryClient.invalidateQueries({ queryKey });
    }
  });
  const handleSave = () => {
    if (!draft || !changed || readOnly || unavailable || save.isPending) return;
    save.mutate({ sessionId, catalogItemId: itemId, text: draft.text, expectedRevision: draft.revision });
  };
  return (
    <div className="min-w-0 space-y-1.5 max-md:px-1 lg:col-span-full 2xl:col-span-1" data-inventory-comment={itemId}>
      <label htmlFor={`inventory-comment-${sessionId}-${itemId}`} className="block text-[10px] font-bold uppercase text-dim 2xl:sr-only">Komentarz</label>
      <textarea
        id={`inventory-comment-${sessionId}-${itemId}`}
        aria-label={`Komentarz do ${itemName}`}
        value={text}
        onChange={(event) => {
          setDraft((current) => ({ text: event.target.value, revision: current?.revision ?? comment?.revision ?? 0 }));
          save.reset();
        }}
        rows={2}
        maxLength={4000}
        readOnly={readOnly}
        disabled={unavailable || save.isPending}
        placeholder={unavailable ? '' : readOnly ? 'Brak komentarza' : 'Komentarz'}
        className="block min-h-[64px] w-full resize-y rounded-md border border-border bg-[var(--input-bg)] px-2.5 py-2 text-sm text-body outline-none focus:border-[var(--brand)] disabled:opacity-50"
      />
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="min-w-0 break-words text-[10px] text-dim">
          {save.isPending ? 'Zapisywanie...' : changed ? 'Niezapisany komentarz' : comment
            ? `${comment.updatedBy} · ${new Date(comment.updatedAt).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' })}`
            : ''}
        </span>
        {!readOnly && <div className="flex shrink-0 gap-1">
          {draft && <Button type="button" variant="outline" title="Odrzuć zmiany komentarza" aria-label={`Odrzuć zmiany komentarza do ${itemName}`}
            disabled={save.isPending} className="h-8 w-8 p-0" onClick={() => { setDraft(null); save.reset(); }}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>}
          <Button type="button" variant="outline" title="Zapisz komentarz" aria-label={`Zapisz komentarz do ${itemName}`}
            disabled={!changed || unavailable || save.isPending} className="h-8 w-8 p-0" onClick={handleSave}>
            {save.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
          </Button>
        </div>}
      </div>
      {save.isError && <p role="alert" className="text-xs text-danger">
        {save.error.message === 'INVENTORY_COMMENT_CONFLICT'
          ? 'Ktoś zmienił ten komentarz. Odrzuć swoją zmianę, aby wczytać aktualną treść.'
          : 'Nie zapisano komentarza. Sprawdź dostęp i połączenie, a następnie spróbuj ponownie.'}
      </p>}
    </div>
  );
}
