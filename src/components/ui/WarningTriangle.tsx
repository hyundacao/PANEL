import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils/cn';

type WarningTriangleProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'aria-hidden' | 'aria-label' | 'children' | 'role'
> & {
  /** Add a label only when there is no adjacent visible warning text. */
  label?: string;
};

export function WarningTriangle({ className, label, ...props }: WarningTriangleProps) {
  return (
    <span
      {...props}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-warning-triangle=""
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-visible align-middle',
        className
      )}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        className="warning-triangle-glyph h-full w-full overflow-visible"
      >
        <path
          d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
          fill="var(--warning-signal-fill, #FFD21A)"
          stroke="var(--warning-signal-fill, #FFD21A)"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="M12 9v4"
          fill="none"
          stroke="var(--warning-signal-ink, #2A1800)"
          strokeLinecap="round"
          strokeWidth="2.4"
        />
        <circle cx="12" cy="17" r="1.15" fill="var(--warning-signal-ink, #2A1800)" />
      </svg>
    </span>
  );
}
