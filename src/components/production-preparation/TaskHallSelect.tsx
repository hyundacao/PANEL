'use client';

import { SelectField } from '@/components/ui/Select';
import { normalizeProductionHallAssignment, type ProductionHallAssignment } from '@/lib/utils/productionTaskReference';

export function TaskHallSelect({ value, onChange, automatic = false }: {
  value: ProductionHallAssignment;
  onChange: (value: ProductionHallAssignment) => void;
  automatic?: boolean;
}) {
  return <label className="block text-xs font-semibold text-[var(--t-muted)]">Hala zadania
    <SelectField aria-label="Hala zadania" className="mt-1 w-full min-w-0 text-xs" value={value} onChange={event => onChange(normalizeProductionHallAssignment(event.target.value))}>
      {automatic && <option value="">Według stanowiska</option>}
      <option value={automatic ? 'unassigned' : ''}>Nieprzypisane</option>
      <option value="hala-1">Hala 1</option><option value="hala-2">Hala 2</option>
      <option value="both">Hala 1 i Hala 2</option>
    </SelectField>
  </label>;
}
