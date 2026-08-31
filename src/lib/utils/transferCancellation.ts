export type TransferStatsRow = {
  at: string;
  kind: string;
  material_id: string;
  qty: number;
  from_location_id?: string | null;
  to_location_id?: string | null;
  partner?: string | null;
  note?: string | null;
  cancelled_at?: string | null;
};

export const isActiveTransferForStats = (transfer: { cancelled_at?: string | null }) =>
  !transfer.cancelled_at;

export const expandTransferStatsRows = (transfers: TransferStatsRow[]): TransferStatsRow[] =>
  transfers.flatMap((transfer) => {
    if (!transfer.cancelled_at) return [transfer];
    // Preserve the original stock delta; neutralize today's reversal separately.
    // Neither the cancelled external movement nor this correction is production.
    return [transfer, {
      at: transfer.cancelled_at,
      kind: 'INTERNAL',
      material_id: transfer.material_id,
      qty: transfer.qty,
      from_location_id: transfer.kind === 'EXTERNAL_OUT' ? null : transfer.to_location_id,
      to_location_id: transfer.kind === 'EXTERNAL_IN' ? null : transfer.from_location_id
    }];
  });
