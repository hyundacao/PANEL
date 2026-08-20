'use client';

import { PaintTapeInventoryPanel } from '../rozliczanie-farb-rozcienczalnikow/PaintTapeInventoryPanel';
import { isReadOnly } from '@/lib/auth/access';
import { useUiStore } from '@/lib/store/ui';

export default function PaintTapeInventoryPage() {
  const user = useUiStore((state) => state.user);
  return <PaintTapeInventoryPanel readOnly={isReadOnly(user, 'FARBY_TASMY')} />;
}
