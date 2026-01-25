import { cn } from '@/lib/utils/cn';

export const Badge = ({
  children,
  tone = 'default'
}: {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}) => {
  const tones = {
    default: 'bg-[rgba(255,255,255,0.06)] text-muted border border-[rgba(255,255,255,0.14)]',
    success:
      'bg-[color:color-mix(in_srgb,var(--success)_14%,transparent)] text-success border border-[color:color-mix(in_srgb,var(--success)_35%,transparent)]',
    warning:
      'bg-[color:color-mix(in_srgb,var(--warning)_14%,transparent)] text-warning border border-[color:color-mix(in_srgb,var(--warning)_30%,transparent)]',
    danger:
      'bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)] text-danger border border-[color:color-mix(in_srgb,var(--danger)_35%,transparent)]',
    info: 'bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] text-brand border border-[color:color-mix(in_srgb,var(--brand)_35%,transparent)]'
  };
  return (
    <span className={cn('rounded-full px-3 py-1 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  );
};
