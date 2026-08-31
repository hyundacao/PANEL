type RegrindStockWrite = {
  action: 'upsertEntry' | 'addInventoryMeasure';
  qty: number;
};

export const getRegrindStockWrite = (raw: string): RegrindStockWrite | null => {
  const normalized = raw.replace(/[\s_]/g, '').replace(',', '.');
  if (!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const qty = Number(normalized);
  if (!Number.isFinite(qty) || qty < 0 || qty > 999999) return null;
  // Zero is a confirmed empty stock, not another measurement to add to the total.
  return { action: qty === 0 ? 'upsertEntry' : 'addInventoryMeasure', qty };
};
