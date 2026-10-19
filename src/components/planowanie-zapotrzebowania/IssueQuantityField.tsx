'use client';

import { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Input } from '@/components/ui/Input';

type Props = {
  label: string;
  value: number;
  automaticLabel: string;
  manual: boolean;
  disabled: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
};

export function IssueQuantityField({ label, value, automaticLabel, manual, disabled, onChange, onReset }: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const valid = /^\d+(?:[.,]\d*)?$/.test(draft) && Number.isFinite(Number(draft.replace(',', '.')));
  return <div className="grid h-9 grid-cols-[minmax(0,1fr)_28px] items-center">
    <Input aria-label={label} aria-invalid={focused && Boolean(draft) && !valid} title={`${manual ? 'Ilość ręczna' : 'Wyliczenie automatyczne'}. Automatycznie: ${automaticLabel}`}
      type="text" inputMode="decimal" disabled={disabled} value={focused ? draft : String(value)}
      className="h-9 min-h-9 w-full min-w-0 rounded-none border-0 bg-transparent px-2 py-1 text-right text-xs font-black tabular-nums text-warning shadow-none"
      onFocus={() => { setDraft(String(value)); setFocused(true); }} onBlur={() => setFocused(false)}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        const quantity = Number(next.replace(',', '.'));
        if (/^\d+(?:[.,]\d*)?$/.test(next) && Number.isFinite(quantity)) onChange(quantity);
      }} />
    <button type="button" title={`Przywróć wyliczenie automatyczne: ${automaticLabel}`} aria-label={`Przywróć wyliczenie automatyczne: ${label}`}
      disabled={disabled || !manual} className={`flex h-7 w-7 items-center justify-center text-muted hover:text-title disabled:cursor-default ${manual ? '' : 'invisible'}`}
      onClick={onReset}><Undo2 className="h-3.5 w-3.5" /></button>
  </div>;
}
