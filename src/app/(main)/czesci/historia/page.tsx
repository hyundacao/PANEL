'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSparePartHistory } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable } from '@/components/ui/DataTable';

export default function SparePartsHistoryPage() {
  const [search, setSearch] = useState('');
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['spare-parts-history'],
    queryFn: getSparePartHistory
  });

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return history;
    return history.filter(
      (entry) =>
        entry.partName.toLowerCase().includes(needle) ||
        entry.user.toLowerCase().includes(needle)
    );
  }, [history, search]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Historia ruchów</p>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Szukaj po części lub użytkowniku"
        />
      </Card>

      {isLoading ? (
        <p className="text-sm text-dim">Wczytywanie...</p>
      ) : (
        <Card>
          <DataTable
            columns={['Kiedy', 'Kto', 'Co', 'Ile', 'Typ', 'Uwagi']}
            rows={filtered.map((entry) => [
              new Date(entry.at).toLocaleString('pl-PL'),
              entry.user,
              entry.partName,
              entry.qty,
              entry.kind === 'IN' ? 'Uzupełnienie' : 'Pobranie',
              entry.note ?? '-'
            ])}
          />
        </Card>
      )}
    </div>
  );
}
