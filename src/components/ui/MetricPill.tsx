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
      'relative inline-flex items-center rounded-[10px] border bg-[linear-gradient(180deg,rgba(0,0,0,0.65),rgba(0,0,0,0.35))] px-3 py-1 text-sm font-semibold',
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
