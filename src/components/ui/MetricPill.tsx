import { cn } from '@/lib/utils/cn';

export const MetricPill = ({
  tone,
  children,
  className
}: {
  tone: 'success' | 'danger';
  children: React.ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      'relative inline-flex items-center rounded-[10px] border bg-[image:linear-gradient(180deg,var(--inset-panel-bg),var(--row-details-bg))] px-3 py-1 text-sm font-semibold',
      className
    )}
    style={{
      color: tone === 'success' ? 'var(--danger)' : 'var(--success)',
      borderColor: tone === 'success' ? 'var(--danger)' : 'var(--success)'
    }}
  >
    <span className="relative z-[1]">{children}</span>
  </span>
);
