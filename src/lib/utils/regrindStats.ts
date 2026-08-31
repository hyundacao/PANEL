import type { Warehouse } from '@/lib/api/types';

const PLANNING_AREA_IDS = new Set(['bakoma', 'lakiernia']);

// Older planning migrations enabled these shared areas in regrind statistics.
export const isRegrindStatsWarehouse = (
  warehouse: Pick<Warehouse, 'id' | 'isActive' | 'includeInStats'>
) => warehouse.isActive && warehouse.includeInStats && !PLANNING_AREA_IDS.has(warehouse.id);
