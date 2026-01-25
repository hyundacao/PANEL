import { Search } from 'lucide-react';
import { Input } from './Input';

export const SearchInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <div className="relative">
    <Search className="absolute left-3 top-2.5 h-4 w-4 text-dim" />
    <Input className="pl-9" {...props} />
  </div>
);
