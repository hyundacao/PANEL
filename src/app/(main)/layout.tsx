'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ContentScrim } from '@/components/ui/ContentScrim';
import { useUiStore } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';
import { canAccessWarehouse, canSeeTab, getWarehouseLabel, isAdmin } from '@/lib/auth/access';
import type { WarehouseKey, WarehouseTab } from '@/lib/api/types';

const getTitle = (pathname: string) => {
  if (pathname.startsWith('/dashboard')) return 'Pulpit';
  if (pathname.startsWith('/spis-oryginalow')) return 'Spis oryginałów';
  if (pathname.startsWith('/spis')) return 'Spis przemiałów';
  if (pathname.startsWith('/przesuniecia')) return 'Przesunięcia';
  if (pathname.startsWith('/wymieszane')) return 'Wymieszane tworzywa';
  if (pathname.startsWith('/raporty')) return 'Raporty';
  if (pathname.startsWith('/kartoteka')) return 'Stany magazynowe';
  if (pathname.startsWith('/suszarki')) return 'Suszarki';
  if (pathname.startsWith('/czesci/historia')) return 'Historia';
  if (pathname.startsWith('/czesci/stany')) return 'Stany magazynowe';
  if (pathname.startsWith('/czesci/uzupelnij')) return 'Uzupełnij';
  if (pathname.startsWith('/czesci/pobierz')) return 'Pobierz';
  if (pathname.startsWith('/czesci')) return 'Części zamienne';
  if (pathname.startsWith('/admin')) return 'Admin';
  return 'Pulpit';
};

const getWarehouseFromPath = (pathname: string): WarehouseKey | null => {
  if (pathname.startsWith('/czesci')) return 'CZESCI';
  if (pathname.startsWith('/admin')) return null;
  return 'PRZEMIALY';
};

const getTabFromPath = (pathname: string): WarehouseTab | null => {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/spis-oryginalow')) return 'spis-oryginalow';
  if (pathname.startsWith('/spis')) return 'spis';
  if (pathname.startsWith('/przesuniecia')) return 'przesuniecia';
  if (pathname.startsWith('/raporty')) return 'raporty';
  if (pathname.startsWith('/kartoteka')) return 'kartoteka';
  if (pathname.startsWith('/wymieszane')) return 'wymieszane';
  if (pathname.startsWith('/suszarki')) return 'suszarki';
  if (pathname.startsWith('/czesci/pobierz')) return 'pobierz';
  if (pathname.startsWith('/czesci/uzupelnij')) return 'uzupelnij';
  if (pathname.startsWith('/czesci/stany')) return 'stany';
  if (pathname.startsWith('/czesci/historia')) return 'historia';
  return null;
};

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const title = getTitle(pathname);
  const { sidebarCollapsed, setSidebarCollapsed, user, role, hydrated, activeWarehouse } = useUiStore();
  const warehouseFromPath = getWarehouseFromPath(pathname);
  const tabFromPath = getTabFromPath(pathname);
  const autoCollapseDone = useRef(false);

  useEffect(() => {
    if (!hydrated || autoCollapseDone.current) return;
    autoCollapseDone.current = true;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    const hasStored =
      window.localStorage.getItem('apka-ui') ?? window.sessionStorage.getItem('apka-ui');
    if (!hasStored) {
      setSidebarCollapsed(true);
    }
  }, [hydrated, setSidebarCollapsed]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    document.body.style.overflow = sidebarCollapsed ? '' : 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [hydrated, sidebarCollapsed]);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (pathname.startsWith('/admin')) {
      if (!isAdmin(user) && role !== 'ADMIN') {
        router.replace('/magazyny');
      }
      return;
    }
    if (!activeWarehouse || !warehouseFromPath) {
      router.replace('/magazyny');
      return;
    }
    if (activeWarehouse !== warehouseFromPath || !canAccessWarehouse(user, warehouseFromPath)) {
      router.replace('/magazyny');
      return;
    }
    if (tabFromPath && !canSeeTab(user, warehouseFromPath, tabFromPath)) {
      router.replace('/magazyny');
    }
  }, [activeWarehouse, hydrated, pathname, role, router, user, warehouseFromPath, tabFromPath]);

  if (!hydrated) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (!user) {
    return <div className="min-h-screen bg-bg" />;
  }

  const breadcrumb = pathname.startsWith('/admin')
    ? 'Panel administratora'
    : getWarehouseLabel(activeWarehouse ?? warehouseFromPath);

  return (
    <div className="min-h-screen bg-bg text-body">
      <Sidebar />
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
        <Topbar title={title} breadcrumb={breadcrumb} />
        <main className="content-area flex-1 px-4 py-4 md:px-6 md:py-6">
          <ContentScrim className="min-h-full">{children}</ContentScrim>
        </main>
      </div>
    </div>
  );
}
