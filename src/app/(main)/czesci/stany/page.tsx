'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSpareParts } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable } from '@/components/ui/DataTable';

export default function SparePartsStockPage() {
  const [search, setSearch] = useState('');
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

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Stany magazynowe</p>
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
            columns={['Kod', 'Nazwa', 'Stan', 'Jedn.', 'Lokalizacja']}
            rows={filtered.map((part) => [
              part.code,
              part.name,
              <span key={`${part.id}-qty`} className="font-semibold tabular-nums">
                {part.qty}
              </span>,
              part.unit,
              part.location ?? '-'
            ])}
          />
        </Card>
      )}
    </div>
  );
}
