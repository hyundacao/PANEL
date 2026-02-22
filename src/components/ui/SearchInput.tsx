import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Input } from './Input';

type SearchInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  clearable?: boolean;
  onClear?: () => void;
};

export const SearchInput = ({
  clearable = false,
  onClear,
  className,
  value,
  ...props
}: SearchInputProps) => {
  const hasValue = String(value ?? '').trim().length > 0;
  return (
    <div className="relative">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-dim" />
      <Input
        className={cn('pl-9', clearable && hasValue && 'pr-10', className)}
        value={value}
        {...props}
      />
      {clearable && hasValue && onClear && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Wyczysc wyszukiwanie"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-dim transition hover:text-title focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
