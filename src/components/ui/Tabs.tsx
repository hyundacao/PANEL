'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils/cn';

export const Tabs = TabsPrimitive.Root;

export const TabsList = ({ className, ...props }: TabsPrimitive.TabsListProps) => (
  <TabsPrimitive.List
    className={cn(
      'flex w-full flex-wrap gap-2 rounded-xl border border-border bg-surface p-1 shadow-[inset_0_1px_0_var(--inner-highlight)]',
      className
    )}
    {...props}
  />
);

export const TabsTrigger = ({ className, ...props }: TabsPrimitive.TabsTriggerProps) => (
  <TabsPrimitive.Trigger
    className={cn(
      'whitespace-nowrap rounded-lg border border-transparent px-3 py-1.5 text-sm font-semibold text-muted transition data-[state=active]:border-[rgba(255,106,0,0.65)] data-[state=active]:bg-brandSoft data-[state=active]:text-title data-[state=active]:ring-2 data-[state=active]:ring-[rgba(255,122,26,0.45)] data-[state=active]:shadow-[0_0_0_3px_rgba(255,122,26,0.18)]',
      className
    )}
    {...props}
  />
);

export const TabsContent = TabsPrimitive.Content;
