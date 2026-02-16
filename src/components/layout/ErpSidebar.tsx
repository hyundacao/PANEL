'use client';

import { useEffect } from 'react';
import { ArrowLeftRight, ClipboardList, History, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useUiStore, type ErpWorkspaceTab } from '@/lib/store/ui';
import { canSeeTab, getRoleLabel } from '@/lib/auth/access';
import { logoutUser } from '@/lib/api';
import type { AppUser, WarehouseTab } from '@/lib/api/types';

export const ERP_WORKSPACE_ITEMS: Array<{
  key: ErpWorkspaceTab;
  label: string;
  icon: typeof ClipboardList;
}> = [
  { key: 'issuer', label: 'Wypisz dokument', icon: ClipboardList },
  { key: 'warehouseman', label: 'Magazynier', icon: ArrowLeftRight },
  { key: 'dispatcher', label: 'Rozdzielca', icon: ArrowLeftRight },
  { key: 'history', label: 'Historia dokumentów', icon: History }
];

export const ERP_WORKSPACE_TAB_ACCESS: Partial<Record<ErpWorkspaceTab, WarehouseTab>> = {
  issuer: 'erp-wypisz-dokument',
  warehouseman: 'erp-magazynier',
  dispatcher: 'erp-rozdzielca',
  history: 'erp-historia-dokumentow'
};

export const canAccessErpWorkspaceItem = (
  user: AppUser | null | undefined,
  workspaceTab: ErpWorkspaceTab
) => {
  const requiredTab = ERP_WORKSPACE_TAB_ACCESS[workspaceTab];
  if (!requiredTab) return false;
  return canSeeTab(user, 'PRZESUNIECIA_ERP', requiredTab);
};

export const ErpSidebar = () => {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    user,
    logout,
    erpWorkspaceTab,
    setErpWorkspaceTab
  } = useUiStore();
  const roleLabel = getRoleLabel(user, 'PRZESUNIECIA_ERP');
  const displayName = user?.name ?? 'Gość';
  const visibleItems = ERP_WORKSPACE_ITEMS.filter((item) =>
    canAccessErpWorkspaceItem(user, item.key)
  );

  useEffect(() => {
    if (visibleItems.length === 0) return;
    if (visibleItems.some((item) => item.key === erpWorkspaceTab)) return;
    setErpWorkspaceTab(visibleItems[0].key);
  }, [erpWorkspaceTab, setErpWorkspaceTab, visibleItems]);

  const closeOnMobile = () => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      setSidebarCollapsed(true);
    }
  };
  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      // ignore logout transport errors and clear local state anyway
    } finally {
      logout();
    }
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-border bg-surface transition-transform duration-200 md:block md:translate-x-0',
        sidebarCollapsed ? 'md:w-20 -translate-x-full md:translate-x-0' : 'translate-x-0'
      )}
    >
      <div className="flex h-full flex-col px-4 py-6">
        <div className="mb-8 flex w-full flex-col items-center justify-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand" />
          {!sidebarCollapsed && (
            <div className="text-center">
              <p className="text-base font-bold text-center" style={{ color: 'var(--brand)' }}>
                PANEL PRZESUNIĘĆ MAGAZYNOWYCH
              </p>
            </div>
          )}
        </div>

        <nav className="mt-3 flex flex-1 flex-col gap-2">
          {visibleItems.map((item) => {
            const active = erpWorkspaceTab === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setErpWorkspaceTab(item.key);
                  closeOnMobile();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:bg-[rgba(255,255,255,0.04)] hover:text-brandHover',
                  active && 'bg-[rgba(255,255,255,0.06)]'
                )}
              >
                <span
                  className={cn(
                    'h-8 w-[2px] rounded-full bg-transparent',
                    active && 'bg-brand'
                  )}
                />
                <Icon className="h-4 w-4" style={{ color: 'var(--brand)' }} />
                {!sidebarCollapsed && (
                  <span style={{ color: 'var(--brand)' }}>{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="rounded-xl border border-border bg-surface2 p-3 shadow-[inset_0_1px_0_var(--inner-highlight)]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-brandSoft" />
            {!sidebarCollapsed && (
              <div className="flex-1">
                <p className="text-sm font-semibold text-title">{displayName}</p>
                <p className="text-xs text-dim">{roleLabel}</p>
                {user && (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="mt-2 flex h-8 w-[calc(100%+3.25rem)] -ml-[3.25rem] items-center rounded-lg pr-2 text-xs text-dim transition hover:bg-[rgba(255,255,255,0.06)] hover:text-title"
                  >
                    <span className="flex items-center pl-[3.25rem]">
                      <LogOut className="mr-2 h-3.5 w-3.5" />
                      Wyloguj
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};

