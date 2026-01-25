import { AlertCircle } from 'lucide-react';
import { Button } from './Button';

export const EmptyState = ({
  title,
  description,
  actionLabel,
  onAction
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface p-8 text-center shadow-[inset_0_1px_0_var(--inner-highlight)]">
    <AlertCircle className="h-8 w-8 text-brand" />
    <h3 className="mt-3 text-lg font-semibold text-title">{title}</h3>
    {description && <p className="mt-1 text-sm text-muted">{description}</p>}
    {actionLabel && onAction && (
      <Button className="mt-4" onClick={onAction}>
        {actionLabel}
      </Button>
    )}
  </div>
);
