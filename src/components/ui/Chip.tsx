import { cn } from '@/lib/utils/cn';

export const Chip = ({
  children,
  active
}: {
  children: React.ReactNode;
  active?: boolean;
}) => (
  <span
    className={cn(
      'rounded-full border px-3 py-1 text-xs font-semibold',
      active
        ? 'border-[rgba(255,106,0,0.45)] bg-brandSoft text-brandHover'
        : 'border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.06)] text-muted'
    )}
  >
    {children}
  </span>
);
