import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'w-full rounded-xl border border-border bg-[var(--field-bg)] px-3 py-2 text-sm shadow-[var(--field-shadow)] text-body placeholder:text-dim hover:border-borderStrong focus:border-[var(--brand-border)] focus:outline-none focus:ring-2 focus:ring-ring disabled:text-disabled disabled:opacity-55 aria-[invalid=true]:border-[color:color-mix(in_srgb,var(--danger)_60%,transparent)] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[color:color-mix(in_srgb,var(--danger)_25%,transparent)]',
      className
    )}
    {...props}
  />
));

Input.displayName = 'Input';
