import { isPieceGrindingUnit } from '@/lib/utils/originalInventoryGrinding';

type MaterialIdentity = { name: string; unit: string; indexCode?: string | null };
type StockEntry = MaterialIdentity & { realQty: number; availableQty: number };

const indexKey = (value: string | null | undefined) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const unitKey = (value: string) => isPieceGrindingUnit(value)
  ? 'szt'
  : value.trim().toLowerCase().replace(/\.$/, '');

export const matchOriginalInventoryErpStock = (
  entries: readonly StockEntry[],
  material: MaterialIdentity,
  normalizeName: (name: string) => string
) => {
  const name = normalizeName(material.name);
  if (!name) return null;
  const index = indexKey(material.indexCode);
  let matches = index ? entries.filter((entry) => indexKey(entry.indexCode) === index) : [];
  if (!matches.length) {
    // Name matching is only a fallback for legacy rows without an ERP index.
    matches = entries.filter((entry) => normalizeName(entry.name) === name &&
      (!index || !indexKey(entry.indexCode)));
  }
  if (!matches.length || new Set(matches.map((entry) => indexKey(entry.indexCode))).size > 1) return null;
  const unit = unitKey(material.unit);
  if (matches.some((entry) => unitKey(entry.unit) !== unit ||
    !Number.isFinite(entry.realQty) || !Number.isFinite(entry.availableQty))) return null;

  return {
    name: matches[0].name,
    unit: matches[0].unit,
    realQty: matches.reduce((total, entry) => total + entry.realQty, 0),
    availableQty: matches.reduce((total, entry) => total + entry.availableQty, 0)
  };
};
