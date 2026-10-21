export const GRIND_TARGET_EXCLUSIONS_QUERY_KEY = ['original-inventory-grind-target-exclusions'] as const;

export type RemovedGrindingTargetSuggestion = {
  name: string;
  createdAt: string;
  createdBy: string;
};

export const grindingTargetSuggestionKey = (name: string) =>
  name.trim().toLocaleLowerCase('pl').replace(/\s+/g, ' ').replace(/\s*\+\s*/g, '+');

export const normalizeRemovedGrindingTargetSuggestions = (value: unknown): RemovedGrindingTargetSuggestion[] => {
  if (!Array.isArray(value)) return [];
  const items = new Map<string, RemovedGrindingTargetSuggestion>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name || name.length > 240) continue;
    items.set(grindingTargetSuggestionKey(name), {
      name, createdAt: String(record.createdAt ?? ''), createdBy: String(record.createdBy ?? '')
    });
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
};
