import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils/cn';

export const Button = ({
  children,
  className,
  variant = 'primaryEmber',
  disabled,
  asChild,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primaryEmber' | 'secondary' | 'ghost' | 'outline';
  asChild?: boolean;
}) => {
  const base =
    'inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ring-1 ring-inset ring-[var(--brand-ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55';
  const variants: Record<string, string> = {
    primaryEmber:
      'min-h-[52px] px-5 py-3 border border-[var(--ember-border)] bg-[image:var(--ember-bg)] text-[var(--on-ember)] shadow-[var(--ember-shadow)] hover:bg-[image:var(--ember-bg-hover)] active:bg-[image:var(--ember-bg-active)]',
    secondary:
      'border border-[var(--brand-border)] bg-[var(--interactive-soft)] text-body hover:border-[var(--brand-border-hover)] hover:bg-[var(--interactive-soft-hover)]',
    outline: 'border border-[var(--brand-border)] text-brandHover hover:bg-brandSoft',
    ghost:
      'border border-[var(--brand-border-soft)] bg-transparent text-muted hover:border-[var(--brand-border)] hover:bg-[var(--interactive-soft)] hover:text-body'
  };
  const Component = asChild ? Slot : 'button';
  return (
    <Component className={cn(base, variants[variant], className)} disabled={disabled} {...props}>
      {children}
    </Component>
  );
};
