'use client';

import { PageHeader } from '@/components/layout/PageHeader';
import { getTodayKey } from '@/lib/api';
import { WarehouseTransferDocumentsPanel } from '@/app/(main)/przesuniecia/WarehouseTransferDocumentsPanel';

export default function WarehouseTransfersModulePage() {
  const today = getTodayKey();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Przesuniecia magazynowe ERP"
        subtitle={`Dzis: ${today}`}
      />

      <WarehouseTransferDocumentsPanel />
    </div>
  );
}
