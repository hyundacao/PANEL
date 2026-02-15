import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';
import { getTodayKey } from '@/lib/api';
import { WarehouseTransferDocumentsPanel } from '@/app/(main)/przesuniecia/WarehouseTransferDocumentsPanel';

export const metadata: Metadata = {
  title: 'Panel Produkcja'
};

export default function WarehouseTransfersModulePage() {
  const today = getTodayKey();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Przesunięcia magazynowe ERP"
        subtitle={`Dziś: ${today}`}
      />

      <WarehouseTransferDocumentsPanel />
    </div>
  );
}

