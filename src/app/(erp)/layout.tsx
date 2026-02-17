'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  canAccessErpWorkspaceItem,
  ErpSidebar,
  ERP_WORKSPACE_ITEMS
} from '@/components/layout/ErpSidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ContentScrim } from '@/components/ui/ContentScrim';
import { canAccessWarehouse, canSeeTab } from '@/lib/auth/access';
import { getCurrentSessionUser } from '@/lib/api';
import type { AppUser } from '@/lib/api/types';
import { useUiStore } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';

const hasErpAccess = (user: AppUser | null) =>
  Boolean(user) &&
  canAccessWarehouse(user, 'PRZESUNIECIA_ERP') &&
  (canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-wypisz-dokument') ||
    canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-magazynier') ||
    canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-rozdzielca') ||
    canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-rozdzielca-zmianowy') ||
    canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-historia-dokumentow'));

export default function ErpLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const {
    hydrated,
    user,
    setUser,
    logout,
    activeWarehouse,
    setActiveWarehouse,
    sidebarCollapsed,
    setSidebarCollapsed,
    erpWorkspaceTab,
    setErpWorkspaceTab
  } = useUiStore();
  const allowed = hasErpAccess(user);
  const visibleWorkspaceItems = ERP_WORKSPACE_ITEMS.filter((item) =>
    canAccessErpWorkspaceItem(user, item.key)
  );
  const hasVisibleWorkspace = visibleWorkspaceItems.length > 0;

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!allowed || !hasVisibleWorkspace) {
      router.replace('/magazyny');
      return;
    }
    if (activeWarehouse !== 'PRZESUNIECIA_ERP') {
      setActiveWarehouse('PRZESUNIECIA_ERP');
    }
  }, [activeWarehouse, allowed, hasVisibleWorkspace, hydrated, router, setActiveWarehouse, user]);

  useEffect(() => {
    if (!hydrated || !allowed || !hasVisibleWorkspace) return;
    const selectedAllowed = visibleWorkspaceItems.some((item) => item.key === erpWorkspaceTab);
    if (!selectedAllowed) {
      setErpWorkspaceTab(visibleWorkspaceItems[0].key);
    }
  }, [
    allowed,
    erpWorkspaceTab,
    hasVisibleWorkspace,
    hydrated,
    setErpWorkspaceTab,
    visibleWorkspaceItems
  ]);

  useEffect(() => {
    if (!hydrated || !user?.id) return;
    const currentUser = user;
    let cancelled = false;
    getCurrentSessionUser()
      .then((freshUser) => {
        if (cancelled) return;
        const accessChanged =
          JSON.stringify(freshUser.access) !== JSON.stringify(currentUser.access);
        const changed =
          freshUser.id !== currentUser.id ||
          freshUser.name !== currentUser.name ||
          freshUser.username !== currentUser.username ||
          freshUser.role !== currentUser.role ||
          freshUser.isActive !== currentUser.isActive ||
          accessChanged;
        if (changed) {
          setUser(freshUser);
        }
      })
      .catch(() => {
        if (cancelled) return;
        logout();
        router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, logout, router, setUser, user, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onAuthExpired = () => {
      logout();
      router.replace('/login');
    };
    window.addEventListener('apka:auth-expired', onAuthExpired);
    return () => {
      window.removeEventListener('apka:auth-expired', onAuthExpired);
    };
  }, [logout, router]);

  if (!hydrated || !user || !allowed || !hasVisibleWorkspace) {
    return <div className="min-h-screen bg-bg" />;
  }

  return (
    <div className="min-h-screen bg-bg text-body">
      <div className="hidden md:block">
        <ErpSidebar />
      </div>
      <button
        type="button"
        aria-label="Zamknij menu"
        onClick={() => setSidebarCollapsed(true)}
        className={cn(
          'fixed inset-0 z-30 bg-[var(--scrim)] transition md:hidden',
          sidebarCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      />
      <div
        className={cn(
          'flex min-h-screen flex-1 flex-col transition-[padding] duration-200',
          sidebarCollapsed ? 'pl-0 md:pl-20' : 'pl-0 md:pl-64'
        )}
      >
        <Topbar title="Przesunięcia magazynowe ERP" breadcrumb="Moduł ERP" />
        <main className="content-area flex-1 px-4 py-4 md:px-6 md:py-6">
          <ContentScrim className="min-h-full">
            <div className="mb-4 md:hidden">
              <div className="rounded-2xl border border-border bg-surface2 p-2 shadow-[inset_0_1px_0_var(--inner-highlight)]">
                <div className="grid grid-cols-2 gap-2">
                {visibleWorkspaceItems.map((item) => {
                  const active = erpWorkspaceTab === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setErpWorkspaceTab(item.key)}
                      className={cn(
                        'min-h-[52px] rounded-xl border border-border bg-surface px-3 py-2.5 text-center text-sm font-semibold leading-tight text-title shadow-[inset_0_1px_0_var(--inner-highlight)] transition hover:border-[rgba(255,122,26,0.7)] hover:text-title',
                        active &&
                          'border-[rgba(255,122,26,0.9)] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.5))] shadow-[0_0_0_2px_rgba(255,122,26,0.25)]'
                      )}
                    >
                      {item.label}
                    </button>
                  );
                })}
                </div>
              </div>
            </div>
            {children}
          </ContentScrim>
        </main>
      </div>
    </div>
  );
}

