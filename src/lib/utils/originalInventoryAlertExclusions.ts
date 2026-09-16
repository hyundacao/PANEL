export type OriginalInventoryAlertExclusion = {
  key: string;
  name: string;
  unit: string;
  createdAt: string;
  createdBy: string;
};

export const normalizeOriginalInventoryAlertExclusions = (value: unknown): OriginalInventoryAlertExclusion[] => {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, OriginalInventoryAlertExclusion>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const key = String(record.key ?? '').trim();
    const name = String(record.name ?? '').trim();
    const unit = String(record.unit ?? '').trim();
    if (!key || !name || key.length > 600 || name.length > 500 || unit.length > 50) continue;
    byKey.set(key, {
      key,
      name,
      unit,
      createdAt: String(record.createdAt ?? ''),
      createdBy: String(record.createdBy ?? '')
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
};

export const changeOriginalInventoryAlertExclusions = (
  current: OriginalInventoryAlertExclusion[],
  change: { action: 'ignore'; exclusion: OriginalInventoryAlertExclusion } | { action: 'restore'; key: string }
) => change.action === 'ignore'
  ? normalizeOriginalInventoryAlertExclusions([...current, change.exclusion])
  : current.filter((item) => item.key !== change.key);
