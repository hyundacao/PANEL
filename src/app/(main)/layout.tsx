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
import Link from 'next/link';

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

type MobileNavItem = {
  label: string;
  href: string;
  tab?: WarehouseTab;
};

const navItemsPrzemialy: MobileNavItem[] = [
  { label: 'Pulpit', href: '/dashboard', tab: 'dashboard' },
  { label: 'Spis przemiałów', href: '/spis', tab: 'spis' },
  { label: 'Spis oryginałów', href: '/spis-oryginalow', tab: 'spis-oryginalow' },
  { label: 'Przesunięcia', href: '/przesuniecia', tab: 'przesuniecia' },
  { label: 'Raporty', href: '/raporty', tab: 'raporty' },
  { label: 'Stany magazynowe', href: '/kartoteka', tab: 'kartoteka' },
  { label: 'Suszarki', href: '/suszarki', tab: 'suszarki' },
  { label: 'Wymieszane tworzywa', href: '/wymieszane', tab: 'wymieszane' }
];

const navItemsCzesci: MobileNavItem[] = [
  { label: 'Start', href: '/czesci' },
  { label: 'Stany magazynowe', href: '/czesci/stany', tab: 'stany' },
  { label: 'Historia', href: '/czesci/historia', tab: 'historia' }
];

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
    const isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile) {
      setSidebarCollapsed(true);
      return;
    }
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
  const showMobileNav =
    !pathname.startsWith('/admin') && Boolean(activeWarehouse && warehouseFromPath);
  const isActivePath = (href: string) => {
    if (href === '/czesci') return pathname === '/czesci';
    if (href === '/spis') return pathname === '/spis' || pathname.startsWith('/spis/');
    if (href === '/spis-oryginalow') {
      return pathname === '/spis-oryginalow' || pathname.startsWith('/spis-oryginalow/');
    }
    return pathname.startsWith(href);
  };
  const mobileItems =
    (activeWarehouse === 'CZESCI' ? navItemsCzesci : navItemsPrzemialy).filter((item) => {
      if (!activeWarehouse) return false;
      if (!item.tab) return true;
      return canSeeTab(user, activeWarehouse, item.tab);
    });

  return (
    <div className="min-h-screen bg-bg text-body">
      <div className="hidden md:block">
        <Sidebar />
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
        <Topbar title={title} breadcrumb={breadcrumb} />
        <main className="content-area flex-1 px-4 py-4 md:px-6 md:py-6">
          <ContentScrim className="min-h-full">
            {showMobileNav && (
              <div className="mb-4 md:hidden">
                <div className="grid grid-cols-2 gap-2">
                  {mobileItems.map((item) => {
                    const active = isActivePath(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          'rounded-xl border border-border bg-surface2 px-3 py-3 text-center text-sm font-semibold text-title shadow-[inset_0_1px_0_var(--inner-highlight)] transition hover:border-[rgba(255,122,26,0.7)] hover:text-title',
                          active &&
                            'border-[rgba(255,122,26,0.9)] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(0,0,0,0.5))] shadow-[0_0_0_2px_rgba(255,122,26,0.25)]'
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
            {children}
          </ContentScrim>
        </main>
      </div>
    </div>
  );
}
