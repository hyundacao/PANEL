'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Warehouse } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils/cn';

type Props = {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
};

export function WarehouseCodeInput({ value, options, onChange, label, disabled = false, invalid = false, className }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const suppressFocusOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 224, maxHeight: 360, above: false });
  const expanded = open && !disabled;
  const selectedIndex = options.findIndex((option) => option === value);

  const reposition = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const width = Math.min(Math.max(224, rect.width), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 14;
    const aboveSpace = rect.top - 14;
    const desiredHeight = Math.min(360, 52 + options.length * 40);
    const above = below < desiredHeight && aboveSpace > below;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: above ? rect.top - 6 : rect.bottom + 6,
      width,
      maxHeight: Math.max(0, Math.min(360, above ? aboveSpace : below)),
      above
    });
  }, [options.length]);

  const showOptions = () => {
    if (disabled) return;
    reposition();
    setActiveIndex(selectedIndex);
    setOpen(true);
  };
  const choose = (option: string) => {
    if (disabled) return;
    onChange(option);
    setOpen(false);
    suppressFocusOpen.current = true;
    inputRef.current?.focus();
    suppressFocusOpen.current = false;
  };

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!inputRef.current?.parentElement?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return;
      reposition();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [expanded, reposition]);

  useEffect(() => {
    if (expanded && activeIndex >= 0) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, expanded]);

  return <div className="relative">
    <Input
      ref={inputRef}
      role="combobox"
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={expanded ? id : undefined}
      aria-haspopup="listbox"
      aria-autocomplete="none"
      aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      aria-invalid={invalid || undefined}
      autoComplete="off"
      placeholder="Np. M-1"
      title={disabled ? 'Brak uprawnień do edycji' : 'Wpisz lub wybierz magazyn'}
      className={cn('h-10 min-h-10 rounded-lg pr-9 font-semibold uppercase', className, expanded && 'border-[var(--brand-border-strong)] ring-2 ring-ring')}
      value={value}
      disabled={disabled}
      onFocus={() => { if (!suppressFocusOpen.current) showOptions(); }}
      onClick={showOptions}
      onBlur={(event) => {
        if (!event.currentTarget.parentElement?.contains(event.relatedTarget) && !popupRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
      onChange={(event) => {
        onChange(event.target.value);
        reposition();
        setActiveIndex(options.findIndex((option) => option === event.target.value.replace(/\s+/g, '').toUpperCase()));
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!expanded) { showOptions(); setActiveIndex(selectedIndex >= 0 ? selectedIndex : event.key === 'ArrowDown' ? 0 : options.length - 1); }
          else setActiveIndex((current) => event.key === 'ArrowDown' ? Math.min(options.length - 1, current + 1) : current < 0 ? options.length - 1 : Math.max(0, current - 1));
        } else if (expanded && (event.key === 'Home' || event.key === 'End')) {
          event.preventDefault();
          setActiveIndex(event.key === 'Home' ? 0 : options.length - 1);
        } else if (expanded && event.key === 'Enter') {
          event.preventDefault();
          if (options[activeIndex]) choose(options[activeIndex]);
          else setOpen(false);
        } else if (expanded && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        } else if (event.key === 'Tab') setOpen(false);
      }}
    />
    <button type="button" tabIndex={-1} disabled={disabled} aria-label={`Rozwiń magazyny: ${label}`} aria-expanded={expanded}
      className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-[var(--catalog-accent,var(--brand))] transition hover:bg-brandSoft disabled:opacity-40"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (expanded) setOpen(false);
        else { inputRef.current?.focus(); showOptions(); }
      }}>
      <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
    </button>
    {expanded && typeof document !== 'undefined' ? createPortal(
      <div ref={popupRef} data-warehouse-options className="fixed z-[300] flex flex-col overflow-hidden rounded-xl border border-[var(--brand-border)] bg-[var(--surface-1)] bg-[image:var(--popover-bg)] text-[var(--t-title)] shadow-[var(--popover-shadow)] ring-1 ring-[var(--brand-ring)]"
        style={{ position: 'fixed', zIndex: 300, left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight, transform: position.above ? 'translateY(-100%)' : undefined }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-brandSoft px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider">
          <Warehouse className="h-4 w-4 text-[var(--catalog-accent,var(--brand))]" />Magazyny
          <span className="ml-auto text-[var(--t-muted)]">{options.length}</span>
        </div>
        <div id={id} role="listbox" aria-label={`Magazyny: ${label}`} className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
          {options.map((option, index) => <button key={option} ref={(element) => { optionRefs.current[index] = element; }} id={`${id}-${index}`}
            type="button" role="option" tabIndex={-1} aria-selected={option === value}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}
            onPointerMove={() => setActiveIndex(index)}
            className={cn('relative flex h-10 w-full shrink-0 items-center justify-between rounded-lg border border-transparent px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--brand-soft-hover)] focus:outline-none',
              activeIndex === index && 'border-[var(--brand-border)] bg-[var(--brand-soft-hover)]',
              option === value && 'bg-[var(--brand-soft-active)] font-bold text-[var(--catalog-accent,var(--brand))]')}>
            {option === value ? <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--brand)]" /> : null}
            <span>{option}</span>{option === value ? <Check className="h-4 w-4" /> : null}
          </button>)}
        </div>
      </div>, document.body
    ) : null}
  </div>;
}
