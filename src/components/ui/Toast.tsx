'use client';

import { create } from 'zustand';
import { useEffect } from 'react';
import { cn } from '@/lib/utils/cn';

export type ToastItem = {
  id: string;
  tone?: 'success' | 'error' | 'info';
  title: string;
  description?: string;
};

type ToastState = {
  items: ToastItem[];
  push: (toast: Omit<ToastItem, 'id'>) => void;
  remove: (id: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (toast) =>
    set((state) => ({
      items: [...state.items, { ...toast, id: crypto.randomUUID() }]
    })),
  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
}));

export const Toaster = () => {
  const { items, remove } = useToastStore();

  useEffect(() => {
    const timers = items.map((item) => setTimeout(() => remove(item.id), 3200));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [items, remove]);

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2">
      {items.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-[inset_0_1px_0_var(--inner-highlight)] animate-fade',
            toast.tone === 'success' &&
              'border-[color:color-mix(in_srgb,var(--success)_50%,transparent)]',
            toast.tone === 'error' &&
              'border-[color:color-mix(in_srgb,var(--danger)_50%,transparent)]',
            toast.tone === 'info' &&
              'border-[color:color-mix(in_srgb,var(--brand)_50%,transparent)]'
          )}
        >
          <p className="font-semibold text-title">{toast.title}</p>
          {toast.description && <p className="text-muted">{toast.description}</p>}
        </div>
      ))}
    </div>
  );
};
