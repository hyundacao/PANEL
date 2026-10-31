type CatalogItem = {
  id?: string;
  name: string;
  unit?: string | null;
  warehouseCode?: string | null;
  indexCode?: string | null;
  indexCode2?: string | null;
  catalogIds?: string[];
};

const indexKey = (value?: string | null) => String(value ?? '').trim().toUpperCase().replace(/\s*([-\/])\s*/g, '$1');
const unitKey = (value?: string | null) => {
  const key = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  return /^(szt|sztuka|sztuki|sztuk|pc|pcs)$/.test(key) ? 'szt' : key;
};

/** Read-only compatibility for the owner's confirmed legacy M-10 column convention. */
export const linkOriginalInventoryM10Indices = <T extends CatalogItem>(items: readonly T[]): T[] => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const index = indexKey(item.indexCode);
    if (!/^M-10-(?:PWY-.+|800\d+)$/.test(index)) continue;
    const warehouse = indexKey(item.warehouseCode);
    if (warehouse && warehouse !== 'M-10') continue;
    const unit = unitKey(item.unit);
    const name = item.name.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!unit || !name) continue;
    const key = JSON.stringify([name, unit]);
    groups.set(key, [...groups.get(key) ?? [], item]);
  }
  const linked = new Map<T, T>();
  for (const group of groups.values()) {
    const primary = group.filter(item => /^M-10-PWY-/.test(indexKey(item.indexCode)));
    const secondary = group.filter(item => /^M-10-800\d+$/.test(indexKey(item.indexCode)));
    if (group.length !== 2 || primary.length !== 1 || secondary.length !== 1) continue;
    const index1 = indexKey(primary[0].indexCode);
    const index2 = indexKey(secondary[0].indexCode);
    if (group.some(item => item.indexCode2 && indexKey(item.indexCode2) !== index2)) continue;
    const catalogIds = [...new Set(group.flatMap(item => [item.id ?? '', ...item.catalogIds ?? []]).filter(Boolean))];
    for (const item of group) linked.set(item, { ...item, indexCode: index1, indexCode2: index2, catalogIds });
  }
  return items.map(item => linked.get(item) ?? item);
};
