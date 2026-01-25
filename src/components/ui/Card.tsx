import { cn } from '@/lib/utils/cn';

export const Card = ({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      'rounded-2xl border border-border bg-surface p-4 shadow-[inset_0_1px_0_var(--inner-highlight)] transition hover:border-borderStrong hover:bg-surface2 md:p-6',
      className
    )}
  >
    {children}
  </div>
);
