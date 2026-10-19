export type ManualIssueQuantity = {
  quantity: number;
  committedBaseline: number;
  planDate: string;
  areaId: string;
};

export type ManualIssueQuantities = Record<string, ManualIssueQuantity>;

export const normalizeManualIssueQuantities = (value: unknown): ManualIssueQuantities => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return [];
    const { quantity, committedBaseline, planDate, areaId } = entry;
    return typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 0
      && typeof committedBaseline === 'number' && Number.isFinite(committedBaseline) && committedBaseline >= 0
      && typeof planDate === 'string' && typeof areaId === 'string'
      ? [[key, { quantity, committedBaseline, planDate, areaId }]] : [];
  }));
};

type Source = { planItemId: string; demand: number; toIssue?: number };
type Document = {
  planDate: string;
  areaId: string;
  status: string;
  rows: { key: string; toIssue: number; confirmed: boolean; sources?: Source[] }[];
};

// New documents retain the actual issue split, including manual reserves. Older
// documents use their original demand proportions as a compatibility fallback.
export const committedIssueQuantity = (
  documents: Document[], planDate: string, areaId: string, materialKey: string, planItemId: string,
  canonicalKey: (key: string) => string
) => documents.reduce((total, document) => {
  if (document.planDate !== planDate || document.areaId !== areaId || document.status === 'cancelled') return total;
  return total + document.rows.reduce((sum, row) => {
    if (canonicalKey(row.key) !== materialKey || !(document.status === 'issued' || document.status === 'handed' || row.confirmed)) return sum;
    const sources = row.sources ?? [];
    const explicitSplit = sources.length > 0 && sources.every((source) => typeof source.toIssue === 'number' && Number.isFinite(source.toIssue) && source.toIssue >= 0);
    const demand = sources.reduce((amount, source) => amount + source.demand, 0);
    const allocated = sources.filter((source) => source.planItemId === planItemId).reduce((amount, source) => amount + (
      explicitSplit ? source.toIssue! : demand > 0 ? row.toIssue * source.demand / demand : 0
    ), 0);
    return sum + allocated;
  }, 0);
}, 0);

export const remainingManualIssueQuantity = (
  override: ManualIssueQuantity | undefined, planDate: string, areaId: string, committed: number
): number | null => {
  if (!override || override.planDate !== planDate || override.areaId !== areaId) return null;
  return Math.max(0, override.quantity - Math.max(0, committed - override.committedBaseline));
};

export function allocateIssueQuantities<T extends Source>(
  sources: T[], automaticQuantity: number, manualQuantity: (source: T) => number | null,
  round: (quantity: number) => number
): { toIssue: number; sources: Array<T & { toIssue: number }> } {
  const demand = sources.reduce((sum, source) => sum + source.demand, 0);
  const allocated = sources.map((source) => ({ ...source,
    toIssue: manualQuantity(source) ?? (demand > 0 ? automaticQuantity * source.demand / demand : 0)
  }));
  const sum = allocated.reduce((total, source) => total + source.toIssue, 0);
  const toIssue = Math.max(0, round(sum));
  // Preserve the exact row total when discrete units need rounding.
  const last = allocated.findLast((source) => source.toIssue > 0);
  if (last) last.toIssue += toIssue - sum;
  return { toIssue, sources: allocated };
}
