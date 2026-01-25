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
        'relative h-7 w-12 rounded-full border border-[rgba(255,122,26,0.45)] bg-[rgba(10,10,12,0.65)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)] transition',
        checked &&
          'border-[rgba(255,122,26,0.95)] bg-[linear-gradient(180deg,rgba(255,186,122,0.55),rgba(255,122,26,0.55))] shadow-[0_0_0_2px_rgba(255,122,26,0.25)]'
      )}
    >
      <span
        className={cn(
          'block h-4.5 w-4.5 translate-x-1 rounded-full bg-[rgba(255,255,255,0.9)] shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition',
          checked && 'translate-x-6 bg-[#FF7A1A] shadow-[0_0_0_2px_rgba(255,255,255,0.6)]'
        )}
      />
    </button>
    {label && <span>{label}</span>}
  </label>
);
