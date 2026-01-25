'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getWarehouses } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';

export default function SpisLandingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Spis przemiałów" subtitle="Wybierz hale do spisu" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && (
          <Card>
            <p className="text-sm text-muted">Ladowanie hal...</p>
          </Card>
        )}

        {(data ?? []).map((warehouse) => (
          <Card
            key={warehouse.id}
            className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Hala</p>
              <p className="text-2xl font-semibold" style={{ color: 'var(--brand)' }}>
                {warehouse.name}
              </p>
            </div>
            <Button asChild variant="primaryEmber" className="w-full sm:w-auto">
              <Link href={`/spis/${warehouse.id}`}>Rozpocznij spis</Link>
            </Button>
          </Card>
        ))}

        {!isLoading && (data ?? []).length === 0 && (
          <Card>
            <p className="text-sm text-muted">Brak aktywnych hal.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
