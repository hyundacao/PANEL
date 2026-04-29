import { cn } from '@/lib/utils/cn';

import React from 'react';

export const DataTable = ({
  columns,
  rows,
  onRowClick,
  renderRowDetails,
  getRowClassName,
  stickyHeader = false,
  desktopMaxHeightClassName
}: {
  columns: Array<React.ReactNode>;
  rows: Array<Array<React.ReactNode>>;
  onRowClick?: (rowIndex: number) => void;
  renderRowDetails?: (rowIndex: number) => React.ReactNode | null;
  getRowClassName?: (rowIndex: number) => string;
  stickyHeader?: boolean;
  desktopMaxHeightClassName?: string;
}) => (
  <div className="md:overflow-hidden md:rounded-2xl md:border md:border-[rgba(255,255,255,0.12)] md:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.55))] md:shadow-[0_18px_40px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
    <div className="space-y-2 md:hidden">
      {rows.map((row, rowIndex) => {
        const details = renderRowDetails?.(rowIndex) ?? null;
        const rowClassName = getRowClassName?.(rowIndex);
        const primaryCell = row[0];
        const secondaryCells = row.slice(1);
        return (
          <div
            key={`row-card-${rowIndex}`}
            className={cn(
              'rounded-xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(0,0,0,0.48))] p-3 shadow-[0_10px_24px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-[rgba(255,122,26,0.55)]',
              onRowClick && 'cursor-pointer',
              rowClassName
            )}
            onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
            onKeyDown={
              onRowClick
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(rowIndex);
                    }
                  }
                : undefined
            }
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
          >
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                {columns[0]}
              </p>
              <div className="mt-1 break-words text-sm font-semibold leading-snug text-brand">
                {primaryCell}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[rgba(255,255,255,0.08)] pt-3">
              {secondaryCells.map((cell, cellIndex) => (
                <div
                  key={`cell-card-${rowIndex}-${cellIndex + 1}`}
                  className="min-w-0"
                >
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-dim">
                    {columns[cellIndex + 1]}
                  </p>
                  <div className="mt-1 min-w-0 break-words text-[13px] font-semibold leading-snug text-body">
                    {cell}
                  </div>
                </div>
              ))}
            </div>
            {details && (
              <div className="mt-3 border-t border-border pt-3">{details}</div>
            )}
          </div>
        );
      })}
    </div>

    <div className={cn('hidden md:block', desktopMaxHeightClassName && cn('overflow-auto', desktopMaxHeightClassName))}>
      <table className="w-full text-sm">
      <thead
        className={cn(
          'bg-[linear-gradient(90deg,rgba(255,122,26,0.18),rgba(255,255,255,0.03))] text-title',
          stickyHeader && 'sticky top-0 z-10'
        )}
      >
        <tr>
          {columns.map((col, idx) => (
            <th
              key={`col-${idx}`}
              className={cn(
                'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-title',
                stickyHeader &&
                  'bg-[linear-gradient(90deg,rgba(32,18,8,0.98),rgba(18,18,18,0.98))] backdrop-blur'
              )}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => {
          const details = renderRowDetails?.(rowIndex) ?? null;
          const rowClassName = getRowClassName?.(rowIndex);
          return (
            <React.Fragment key={`row-${rowIndex}`}>
              <tr
                className={cn(
                  'border-t border-[rgba(255,255,255,0.08)] text-body transition hover:bg-[rgba(255,255,255,0.06)]',
                  onRowClick && 'cursor-pointer',
                  !rowClassName &&
                    rowIndex % 2 === 1 &&
                    'bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(0,0,0,0.35))]',
                  rowClassName
                )}
                onClick={onRowClick ? () => onRowClick(rowIndex) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(rowIndex);
                        }
                      }
                    : undefined
                }
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`} className="px-4 py-3">
                    {cell}
                  </td>
                ))}
              </tr>
              {details && (
                <tr className="border-t border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.35)]">
                  <td colSpan={columns.length} className="px-4 py-4">
                    {details}
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
    </div>
  </div>
);
