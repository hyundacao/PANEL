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
    'inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ring-1 ring-inset ring-[rgba(255,122,26,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55';
  const variants: Record<string, string> = {
    primaryEmber:
      'min-h-[52px] px-5 py-3 border border-[rgba(255,122,26,0.7)] bg-[linear-gradient(180deg,#FFB36B_0%,#FF7A1A_45%,#E85F00_100%)] text-bg shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_12px_30px_-18px_rgba(255,106,0,0.85)] hover:bg-[linear-gradient(180deg,#FFC48D_0%,#FF8A33_45%,#FF6A00_100%)] active:bg-[linear-gradient(180deg,#FF9F52_0%,#FF6A00_45%,#D95500_100%)]',
    secondary:
      'border border-[rgba(255,122,26,0.55)] bg-[rgba(255,255,255,0.06)] text-body hover:border-[rgba(255,122,26,0.75)] hover:bg-[rgba(255,255,255,0.10)]',
    outline: 'border border-[rgba(255,106,0,0.55)] text-brandHover hover:bg-brandSoft',
    ghost:
      'border border-[rgba(255,122,26,0.35)] bg-transparent text-muted hover:border-[rgba(255,122,26,0.55)] hover:bg-[rgba(255,255,255,0.06)] hover:text-body'
  };
  const Component = asChild ? Slot : 'button';
  return (
    <Component className={cn(base, variants[variant], className)} disabled={disabled} {...props}>
      {children}
    </Component>
  );
};
