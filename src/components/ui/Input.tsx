import { cn } from '@/lib/utils/cn';

export const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      'w-full rounded-xl border border-border bg-[rgba(0,0,0,0.40)] px-3 py-2 text-sm text-body placeholder:text-dim hover:border-borderStrong focus:border-[rgba(255,106,0,0.55)] focus:outline-none focus:ring-2 focus:ring-ring disabled:text-disabled disabled:opacity-55 aria-[invalid=true]:border-[color:color-mix(in_srgb,var(--danger)_60%,transparent)] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[color:color-mix(in_srgb,var(--danger)_25%,transparent)]',
      className
    )}
    {...props}
  />
);
