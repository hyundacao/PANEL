'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adjustSparePart, getSpareParts } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { useToastStore } from '@/components/ui/Toast';
import { parseQtyInput } from '@/lib/utils/format';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';

export default function SparePartsPickPage() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'CZESCI');
  const [search, setSearch] = useState('');
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});

  const { data: parts = [], isLoading } = useQuery({
    queryKey: ['spare-parts'],
    queryFn: getSpareParts
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return parts;
    return parts.filter(
      (part) =>
        part.name.toLowerCase().includes(needle) || part.code.toLowerCase().includes(needle)
    );
  }, [parts, search]);

  const mutation = useMutation({
    mutationFn: adjustSparePart,
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      queryClient.invalidateQueries({ queryKey: ['spare-parts-history'] });
      setQtyDrafts((prev) => ({ ...prev, [payload.partId]: '' }));
      toast({ title: 'Zapisano pobranie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        PART_MISSING: 'Nie znaleziono części.',
        INVALID_QTY: 'Podaj poprawną ilość.',
        INSUFFICIENT_STOCK: 'Brak wystarczającego stanu.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie zapisano pobrania.',
        tone: 'error'
      });
    }
  });

  const handlePick = (partId: string, available: number) => {
    if (readOnly) {
      toast({ title: 'Brak uprawnień do pobrania', tone: 'error' });
      return;
    }
    const qtyValue = parseQtyInput(qtyDrafts[partId] ?? '');
    if (!qtyValue) {
      toast({ title: 'Podaj ilość', tone: 'error' });
      return;
    }
    if (qtyValue > available) {
      toast({ title: 'Brak wystarczającego stanu', tone: 'error' });
      return;
    }
    mutation.mutate({
      partId,
      qty: qtyValue,
      kind: 'OUT',
      user: user?.username ?? user?.name ?? 'nieznany'
    });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Pobierz części</p>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Szukaj po nazwie lub kodzie"
        />
      </Card>

      {isLoading ? (
        <p className="text-sm text-dim">Wczytywanie...</p>
      ) : (
        <Card>
          <DataTable
            columns={['Kod', 'Nazwa', 'Stan', 'Jedn.', 'Lokalizacja', 'Ilość', 'Akcja']}
            rows={filtered.map((part) => [
              part.code,
              part.name,
              <span key={`${part.id}-qty`} className="font-semibold tabular-nums">
                {part.qty}
              </span>,
              part.unit,
              part.location ?? '-',
              <Input
                key={`${part.id}-input`}
                value={qtyDrafts[part.id] ?? ''}
                onChange={(event) =>
                  setQtyDrafts((prev) => ({ ...prev, [part.id]: event.target.value }))
                }
                placeholder="0"
                inputMode="numeric"
                disabled={readOnly}
              />,
              <Button
                key={`${part.id}-action`}
                variant="primaryEmber"
                onClick={() => handlePick(part.id, part.qty)}
                disabled={readOnly || mutation.isPending}
              >
                Pobierz
              </Button>
            ])}
          />
        </Card>
      )}
    </div>
  );
}
