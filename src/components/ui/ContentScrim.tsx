import { cn } from '@/lib/utils/cn';

export const ContentScrim = ({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      'rounded-[18px] border border-border bg-[var(--scrim)] p-4 backdrop-blur-[8px] md:p-6',
      className
    )}
  >
    {children}
  </div>
);
