'use client';

import { cn } from '@/lib/utils/cn';

export const Toggle = ({
  checked,
  onCheckedChange,
  label,
  disabled
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) => (
  <label className={cn('flex items-center gap-3 text-sm text-body', disabled && 'opacity-60')}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-7 w-12 rounded-full border border-[var(--brand-border)] bg-[var(--toggle-off-bg)] shadow-[var(--toggle-shadow)] transition',
        checked &&
          'border-[var(--brand-border-strong)] bg-[image:var(--toggle-on-bg)] shadow-[var(--toggle-on-shadow)]'
      )}
    >
      <span
        className={cn(
          'block h-4.5 w-4.5 translate-x-1 rounded-full bg-[var(--toggle-thumb-bg)] shadow-[var(--toggle-thumb-shadow)] transition',
          checked && 'translate-x-6 bg-[var(--toggle-thumb-on-bg)] shadow-[var(--toggle-thumb-on-shadow)]'
        )}
      />
    </button>
    {label && <span>{label}</span>}
  </label>
);
