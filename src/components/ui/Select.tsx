'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const EMPTY_VALUE = '__empty__';

type NativeSelectProps = Omit<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'defaultValue' | 'onChange'
> & {
  value?: string;
  defaultValue?: string;
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
};

type SelectItem = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

type SelectGroup = {
  key: string;
  label?: React.ReactNode;
  items: SelectItem[];
  source: 'root' | 'group';
};

const parseOptions = (children: React.ReactNode) => {
  const groups: SelectGroup[] = [];
  let placeholder: React.ReactNode | undefined;
  let groupIndex = 0;

  const addGroup = (label: React.ReactNode | undefined, source: SelectGroup['source']) => {
    const group: SelectGroup = { key: `group-${groupIndex++}`, label, items: [], source };
    groups.push(group);
    return group;
  };

  const addItem = (item: SelectItem, source: SelectGroup['source'], label?: React.ReactNode) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label && last.source === source) {
      last.items.push(item);
      return;
    }
    addGroup(label, source).items.push(item);
  };

  const parseOption = (child: React.ReactElement) => {
    const props = child.props as {
      value?: string;
      disabled?: boolean;
      children?: React.ReactNode;
    };
    const value = props.value ?? '';
    const label = props.children;
    const disabled = Boolean(props.disabled);
    const isEmpty = String(value) === '';
    const itemValue = isEmpty ? EMPTY_VALUE : String(value);
    if (isEmpty && placeholder === undefined) {
      placeholder = label;
    }
    return { value: itemValue, label, disabled };
  };

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === 'option') {
      addItem(parseOption(child), 'root');
      return;
    }
    if (child.type === 'optgroup') {
      const label = child.props.label;
      const groupItems: SelectItem[] = [];
      React.Children.forEach(child.props.children, (optionChild) => {
        if (!React.isValidElement(optionChild)) return;
        if (optionChild.type !== 'option') return;
        groupItems.push(parseOption(optionChild));
      });
      if (groupItems.length > 0) {
        addGroup(label, 'group').items.push(...groupItems);
      }
    }
  });

  return { groups, placeholder };
};

export const SelectField = ({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  style,
  ...props
}: NativeSelectProps) => {
  const { groups, placeholder } = parseOptions(children);
  const handleChange = (nextValue: string) => {
    const actual = nextValue === EMPTY_VALUE ? '' : nextValue;
    if (!onChange) return;
    const event = {
      target: { value: actual }
    } as React.ChangeEvent<HTMLSelectElement>;
    onChange(event);
  };
  const controlledValue = value === '' ? EMPTY_VALUE : value;
  const uncontrolledValue = defaultValue === '' ? EMPTY_VALUE : defaultValue;

  return (
    <SelectPrimitive.Root
      value={value !== undefined ? controlledValue : undefined}
      defaultValue={value === undefined ? uncontrolledValue : undefined}
      onValueChange={handleChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          'flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.5))] px-4 py-2.5 text-sm font-semibold text-title shadow-[0_10px_24px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.14)] transition hover:border-[rgba(255,122,26,0.7)] hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(0,0,0,0.5))] focus:border-[rgba(255,122,26,0.9)] focus:outline-none focus:ring-2 focus:ring-[rgba(255,122,26,0.35)] disabled:cursor-not-allowed disabled:text-disabled disabled:opacity-60',
          className
        )}
        style={{ WebkitTapHighlightColor: 'transparent', ...style }}
        {...props}
      >
        <SelectPrimitive.Value placeholder={placeholder ?? 'Wybierz'} />
        <SelectPrimitive.Icon className="text-title">
          <ChevronDown className="h-4 w-4" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={8}
        collisionPadding={16}
        className="z-50 w-[--radix-select-trigger-width] max-h-[min(70vh,var(--radix-select-content-available-height))] overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(15,15,18,0.98),rgba(8,8,10,0.96))] shadow-[0_24px_60px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] transition data-[state=open]:animate-fade data-[state=open]:ring-1 data-[state=open]:ring-[rgba(255,122,26,0.28)]"
      >
          <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-2 text-muted">
            <ChevronUp className="h-4 w-4" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="max-h-[min(70vh,var(--radix-select-content-available-height))] overflow-y-auto p-2">
            {groups.map((group, groupIndex) => (
              <React.Fragment key={group.key}>
                {groupIndex > 0 && (
                  <div className="my-2 h-px bg-[rgba(255,255,255,0.08)]" />
                )}
                {group.label && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-dim">
                    {group.label}
                  </div>
                )}
                {group.items.map((item, idx) => (
                  <SelectPrimitive.Item
                    key={`${group.key}-${idx}`}
                    value={item.value}
                    disabled={item.disabled}
                    className="relative flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-title outline-none transition data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-[rgba(255,122,26,0.18)] data-[highlighted]:text-title data-[state=checked]:bg-[rgba(255,122,26,0.25)]"
                  >
                    <SelectPrimitive.ItemText>{item.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="text-brand">
                      <Check className="h-4 w-4" />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </React.Fragment>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-2 text-muted">
            <ChevronDown className="h-4 w-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
};
