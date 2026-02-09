'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { getTodayKey } from '@/lib/api';
import { WarehouseTransferDocumentsPanel } from '../przesuniecia/WarehouseTransferDocumentsPanel';

export default function WarehouseTransfersModulePage() {
  const today = getTodayKey();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Przesunięcia magazynowe ERP"
        subtitle={`Dzis: ${today}`}
      />

      <Card className="border-[rgba(255,106,0,0.35)] bg-brandSoft">
        <p className="text-sm text-body">
          Osobny modul do obslugi dokumentow ERP MM/MMZ: planowane pozycje, czesciowe przyjecia
          i rozliczenie dokumentu.
        </p>
      </Card>

      <WarehouseTransferDocumentsPanel />
    </div>
  );
}
