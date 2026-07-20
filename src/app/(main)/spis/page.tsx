'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { getWarehouses } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/layout/PageHeader';

const SPIS_AREAS = [
  { warehouseId: 'hall-1', locationId: 'hall-1-spis', name: 'Hala 1' },
  { warehouseId: 'hall-2', locationId: 'hall-2-spis', name: 'Hala 2' },
  { warehouseId: 'hall-3', locationId: 'hall-3-spis', name: 'Hala 3' },
  {
    warehouseId: 'mill-pp',
    locationId: 'mill-pp-spis',
    name: 'Pomieszczenie z młynem PP'
  }
] as const;

export default function SpisLandingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });

  const availableWarehouseIds = new Set((data ?? []).map((warehouse) => warehouse.id));
  const availableAreas = SPIS_AREAS.filter((area) => availableWarehouseIds.has(area.warehouseId));

  return (
    <div className="space-y-6">
      <PageHeader title="Spis przemiałów" subtitle="Wybierz obszar do spisu" />

      <div className="grid gap-4 md:grid-cols-2">
        {isLoading && (
          <Card>
            <p className="text-sm text-muted">Ładowanie obszarów...</p>
          </Card>
        )}

        {!isLoading &&
          availableAreas.map((area) => (
            <Card
              key={area.warehouseId}
              className="flex min-h-40 flex-col items-start justify-between gap-6 sm:flex-row sm:items-center"
            >
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-dim">Obszar spisu</p>
                <p className="mt-2 text-2xl font-bold text-title">{area.name}</p>
              </div>
              <Button asChild variant="primaryEmber" className="w-full sm:w-auto">
                <Link href={`/spis/${area.warehouseId}/lokacja/${area.locationId}`}>
                  Rozpocznij spis
                </Link>
              </Button>
            </Card>
          ))}

        {!isLoading && availableAreas.length === 0 && (
          <Card>
            <p className="text-sm text-muted">Nie udało się przygotować obszarów spisu.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
