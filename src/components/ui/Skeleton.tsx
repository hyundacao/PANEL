import { cn } from '@/lib/utils/cn';

export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={cn('animate-pulseSoft rounded-xl bg-surface2', className)} />
);
