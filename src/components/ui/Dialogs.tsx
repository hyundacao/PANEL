'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export const DialogRoot = Dialog.Root;
export const DialogTrigger = Dialog.Trigger;

type DialogContentProps = ComponentPropsWithoutRef<typeof Dialog.Content>;

export const DialogContent = ({
  children,
  className,
  hideClose = false,
  onEscapeKeyDown,
  onInteractOutside
}: {
  children: ReactNode;
  className?: string;
  hideClose?: boolean;
  onEscapeKeyDown?: DialogContentProps['onEscapeKeyDown'];
  onInteractOutside?: DialogContentProps['onInteractOutside'];
}) => (
  <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[990] bg-[var(--scrim)]" />
    <Dialog.Content
      className={cn(
        'fixed left-1/2 top-[5vh] z-[999] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-border bg-surface p-6 shadow-[inset_0_1px_0_var(--inner-highlight)] max-h-[90vh] overflow-y-auto',
        className
      )}
      onEscapeKeyDown={onEscapeKeyDown}
      onInteractOutside={onInteractOutside}
    >
      <Dialog.Title className="sr-only">Dialog</Dialog.Title>
      <Dialog.Description className="sr-only">Dialog content</Dialog.Description>
      {children}
      {!hideClose && (
        <Dialog.Close className="absolute right-4 top-4 text-dim hover:text-title">
          <X className="h-4 w-4" />
        </Dialog.Close>
      )}
    </Dialog.Content>
  </Dialog.Portal>
);
