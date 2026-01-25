import { cn } from '@/lib/utils/cn';

export const PageHeader = ({
  title,
  subtitle,
  actions,
  className,
  titleColor
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  titleColor?: string;
}) => (
  <div
    className={cn(
      'flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between',
      className
    )}
  >
    <div>
      <h2 className="text-xl font-semibold" style={{ color: titleColor ?? 'var(--brand)' }}>
        {title}
      </h2>
      {subtitle && <p className="text-sm text-dim">{subtitle}</p>}
    </div>
    {actions && (
      <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:justify-end">
        {actions}
      </div>
    )}
  </div>
);
