import { cn } from '@/lib/utils/cn';

import React from 'react';

export const DataTable = ({
  columns,
  rows,
  onRowClick,
  renderRowDetails
}: {
  columns: Array<React.ReactNode>;
  rows: Array<Array<React.ReactNode>>;
  onRowClick?: (rowIndex: number) => void;
  renderRowDetails?: (rowIndex: number) => React.ReactNode | null;
}) => (
  <div className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.55))] shadow-[0_18px_40px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]">
    <div className="space-y-3 p-3 md:hidden">
      {rows.map((row, rowIndex) => {
        const details = renderRowDetails?.(rowIndex) ?? null;
        return (
          <div
            key={`row-card-${rowIndex}`}
            className={cn(
              'rounded-xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.5))] p-3 shadow-[0_10px_24px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-[rgba(255,122,26,0.55)]',
              onRowClick && 'cursor-pointer'
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
            <div className="space-y-3">
              {row.map((cell, cellIndex) => (
                <div key={`cell-card-${rowIndex}-${cellIndex}`} className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    {columns[cellIndex]}
                  </p>
                  <div className="break-words text-sm text-body">{cell}</div>
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

    <table className="hidden w-full text-sm md:table">
      <thead className="bg-[linear-gradient(90deg,rgba(255,122,26,0.18),rgba(255,255,255,0.03))] text-title">
        <tr>
          {columns.map((col, idx) => (
            <th
              key={`col-${idx}`}
              className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-title"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => {
          const details = renderRowDetails?.(rowIndex) ?? null;
          return (
            <React.Fragment key={`row-${rowIndex}`}>
              <tr
                className={cn(
                  'border-t border-[rgba(255,255,255,0.08)] text-body transition hover:bg-[rgba(255,255,255,0.06)]',
                  onRowClick && 'cursor-pointer',
                  rowIndex % 2 === 1 &&
                    'bg-[linear-gradient(90deg,rgba(255,255,255,0.04),rgba(0,0,0,0.35))]'
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
);
