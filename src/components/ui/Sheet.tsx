'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils/cn';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

export const SheetContent = ({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 bg-[var(--scrim)]" />
    <Dialog.Content
      className={cn(
        'fixed right-6 top-16 w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-[inset_0_1px_0_var(--inner-highlight)]',
        className
      )}
    >
      {children}
    </Dialog.Content>
  </Dialog.Portal>
);
