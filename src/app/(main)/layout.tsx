'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { ContentScrim } from '@/components/ui/ContentScrim';
import { useUiStore } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';
import {
  canAccessWarehouse,
  canSeeTab,
  getAdminWarehouses,
  getWarehouseLabel,
  isHeadAdmin,
  isWarehouseAdmin
} from '@/lib/auth/access';
import type { WarehouseKey, WarehouseTab } from '@/lib/api/types';
import Link from 'next/link';
import { getCurrentSessionUser } from '@/lib/api';

const getTitle = (pathname: string) => {
  if (pathname.startsWith('/dashboard')) return 'Pulpit';
  if (pathname.startsWith('/rozliczanie-farb-rozcienczalnikow')) return 'Rozliczanie farb i rozcieńczalników';
  if (pathname.startsWith('/spis-oryginalow')) return 'Spis oryginałów';
  if (pathname.startsWith('/spis')) return 'Spis przemiałów';
  if (pathname.startsWith('/przesuniecia')) return 'Przesunięcia przemiałowe';
  if (pathname.startsWith('/wymieszane')) return 'Wymieszane tworzywa';
  if (pathname.startsWith('/raport-brakowosci')) return 'Raport brakowości';
  if (pathname.startsWith('/raporty')) return 'Raporty';
  if (pathname.startsWith('/kartoteka')) return 'Stany magazynowe';
  if (pathname.startsWith('/bilans-przezbrojen')) return 'Bilans przezbrojeń';
  if (pathname.startsWith('/przygotowanie-produkcji')) return 'Przygotowanie produkcji';
  if (pathname.startsWith('/suszarki')) return 'Suszarki';
  if (pathname.startsWith('/czesci/historia')) return 'Historia';
  if (pathname.startsWith('/czesci/stany')) return 'Stany magazynowe';
  if (pathname.startsWith('/czesci/uzupelnij')) return 'Uzupełnij';
  if (pathname.startsWith('/czesci/pobierz')) return 'Pobierz';
  if (pathname.startsWith('/czesci')) return 'Części zamienne';
  if (pathname.startsWith('/raport-zmianowy')) return 'Raport zmianowy';
  if (pathname.startsWith('/admin')) return 'Admin';
  return 'Pulpit';
};

const getWarehouseFromPath = (pathname: string): WarehouseKey | null => {
  if (pathname.startsWith('/rozliczanie-farb-rozcienczalnikow')) return 'FARBY_TASMY';
  if (pathname.startsWith('/czesci')) return 'CZESCI';
  if (pathname.startsWith('/raport-zmianowy')) return 'RAPORT_ZMIANOWY';
  if (pathname.startsWith('/raport-brakowosci')) return 'RAPORT_BRAKOWOSCI';
  if (pathname.startsWith('/bilans-przezbrojen')) return 'BILANS_PRZEZBROJEN';
  if (pathname.startsWith('/przygotowanie-produkcji')) return 'PRZYGOTOWANIE_PRODUKCJI';
  if (pathname.startsWith('/admin')) return null;
  return 'PRZEMIALY';
};

const getTabFromPath = (pathname: string): WarehouseTab | null => {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/rozliczanie-farb-rozcienczalnikow')) return 'rozliczanie-farb-tasm';
  if (pathname.startsWith('/spis-oryginalow')) return 'spis-oryginalow';
  if (pathname.startsWith('/spis')) return 'spis';
  if (pathname.startsWith('/przesuniecia')) return 'przesuniecia';
  if (pathname.startsWith('/raport-brakowosci')) return 'raport-brakowosci';
  if (pathname.startsWith('/raporty')) return 'raporty';
  if (pathname.startsWith('/kartoteka')) return 'kartoteka';
  if (pathname.startsWith('/bilans-przezbrojen')) return 'bilans-przezbrojen';
  if (pathname.startsWith('/przygotowanie-produkcji')) return 'przygotowanie-produkcji';
  if (pathname.startsWith('/wymieszane')) return 'wymieszane';
  if (pathname.startsWith('/suszarki')) return 'suszarki';
  if (pathname.startsWith('/czesci/pobierz')) return 'pobierz';
  if (pathname.startsWith('/czesci/uzupelnij')) return 'uzupelnij';
  if (pathname.startsWith('/czesci/stany')) return 'stany';
  if (pathname.startsWith('/czesci/historia')) return 'historia';
  if (pathname.startsWith('/raport-zmianowy')) return 'raport-zmianowy';
  if (pathname.startsWith('/raport-brakowosci')) return 'raport-brakowosci';
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
  { label: 'Przesunięcia przemiałowe', href: '/przesuniecia', tab: 'przesuniecia' },
  { label: 'Raporty', href: '/raporty', tab: 'raporty' },
  { label: 'Stany magazynowe', href: '/kartoteka', tab: 'kartoteka' },
  { label: 'Suszarki', href: '/suszarki', tab: 'suszarki' },
  { label: 'Wymieszane tworzywa', href: '/wymieszane', tab: 'wymieszane' }
];

const texturedMobilePrzemialyTabs = new Set<WarehouseTab>([
  'dashboard',
  'spis',
  'spis-oryginalow',
  'przesuniecia',
  'raporty',
  'kartoteka',
  'wymieszane',
  'suszarki'
]);

const getTexturedMobileNavStyle = (active: boolean): React.CSSProperties => ({
  backgroundImage: active
    ? "linear-gradient(100deg, rgba(255,122,0,0.18), rgba(7,8,12,0.52)), url('/profil-panel-bg.png')"
    : "linear-gradient(100deg, rgba(7,8,12,0.78), rgba(7,8,12,0.58)), url('/profil-panel-bg.png')",
  backgroundPosition: 'left center',
  backgroundSize: 'cover'
});

const mobileNavPanelClass =
  'mb-4 rounded-[18px] border border-border bg-[var(--scrim)] p-2.5 shadow-[inset_0_1px_0_var(--inner-highlight)] backdrop-blur-[8px] md:hidden';

const mobileNavLinkClass =
  'flex min-h-[56px] items-center justify-center rounded-xl border border-border bg-[rgba(255,255,255,0.025)] px-3 py-3 text-center text-[13px] font-semibold leading-snug text-title transition hover:border-[rgba(255,122,26,0.65)] hover:bg-[rgba(255,255,255,0.045)] hover:text-title';

const navItemsCzesci: MobileNavItem[] = [
  { label: 'Start', href: '/czesci' },
  { label: 'Stany magazynowe', href: '/czesci/stany', tab: 'stany' },
  { label: 'Historia', href: '/czesci/historia', tab: 'historia' }
];

const navItemsRaport: MobileNavItem[] = [
  { label: 'Raport zmianowy', href: '/raport-zmianowy', tab: 'raport-zmianowy' }
];

const navItemsRaportBrakowosci: MobileNavItem[] = [
  { label: 'Raport brakowości', href: '/raport-brakowosci', tab: 'raport-brakowosci' }
];

const navItemsBilans: MobileNavItem[] = [
  { label: 'Bilans przezbrojeń', href: '/bilans-przezbrojen', tab: 'bilans-przezbrojen' }
];

const navItemsFarbyTasmy: MobileNavItem[] = [
  { label: 'Rozliczanie farb i rozcieńczalników', href: '/rozliczanie-farb-rozcienczalnikow', tab: 'rozliczanie-farb-tasm' }
];

const getModuleNavItems = (warehouse: WarehouseKey | null) => {
  if (warehouse === 'CZESCI') return navItemsCzesci;
  if (warehouse === 'RAPORT_ZMIANOWY') return navItemsRaport;
  if (warehouse === 'RAPORT_BRAKOWOSCI') return navItemsRaportBrakowosci;
  if (warehouse === 'BILANS_PRZEZBROJEN') return navItemsBilans;
  if (warehouse === 'PRZYGOTOWANIE_PRODUKCJI') return [];
  if (warehouse === 'FARBY_TASMY') return navItemsFarbyTasmy;
  return navItemsPrzemialy;
};

const getFirstAccessibleModuleHref = (
  user: Parameters<typeof canSeeTab>[0],
  warehouse: WarehouseKey
) => {
  const item = getModuleNavItems(warehouse).find((navItem) => {
    if (!navItem.tab) return true;
    return canSeeTab(user, warehouse, navItem.tab);
  });
  return item?.href ?? null;
};

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const baseTitle = getTitle(pathname);
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    user,
    setUser,
    logout,
    hydrated,
    activeWarehouse,
    setActiveWarehouse
  } = useUiStore();
  const warehouseFromPath = getWarehouseFromPath(pathname);
  const tabFromPath = getTabFromPath(pathname);
  const autoCollapseDone = useRef(false);
  const previousPath = useRef<string | null>(null);
  const [authBootstrapResolved, setAuthBootstrapResolved] = useState(false);
  const authBootstrapDone = Boolean(user) || authBootstrapResolved;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!hydrated) return;
    if (previousPath.current && previousPath.current !== pathname) {
      const prev = previousPath.current;
      if (prev.startsWith('/admin')) {
        window.localStorage.removeItem('admin-przemialy-tab');
      }
      if (prev.startsWith('/raporty')) {
        window.localStorage.removeItem('raporty-tab');
      }
      if (prev.startsWith('/spis-oryginalow')) {
        window.localStorage.removeItem('spis-oryginalow-tab');
      }
      if (prev.startsWith('/wymieszane')) {
        window.localStorage.removeItem('wymieszane-tab');
      }
      if (prev.startsWith('/kartoteka')) {
        window.localStorage.removeItem('kartoteka-tab');
      }
    }
    previousPath.current = pathname;
  }, [hydrated, pathname]);

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
    if (!hydrated || user || authBootstrapResolved) return;
    let cancelled = false;
    getCurrentSessionUser()
      .then((freshUser) => {
        if (cancelled) return;
        setUser(freshUser);
      })
      .catch(() => {
        if (cancelled) return;
        logout();
        setAuthBootstrapResolved(true);
        router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [authBootstrapResolved, hydrated, logout, router, setUser, user]);

  useEffect(() => {
    if (!hydrated || !authBootstrapDone) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (pathname.startsWith('/admin')) {
      if (isHeadAdmin(user)) return;
      const adminWarehouses = getAdminWarehouses(user);
      if (adminWarehouses.length === 0) {
        router.replace('/magazyny');
        return;
      }
      if (!activeWarehouse || !isWarehouseAdmin(user, activeWarehouse)) {
        setActiveWarehouse(adminWarehouses[0]);
      }
      return;
    }
    if (!warehouseFromPath) {
      router.replace('/magazyny');
      return;
    }
    if (!canAccessWarehouse(user, warehouseFromPath)) {
      router.replace('/magazyny');
      return;
    }
    if (!activeWarehouse || activeWarehouse !== warehouseFromPath) {
      setActiveWarehouse(warehouseFromPath);
    }
    if (tabFromPath && !canSeeTab(user, warehouseFromPath, tabFromPath)) {
      const fallbackHref = getFirstAccessibleModuleHref(user, warehouseFromPath);
      router.replace(fallbackHref ?? '/magazyny');
    }
  }, [
    activeWarehouse,
    authBootstrapDone,
    hydrated,
    pathname,
    router,
    setActiveWarehouse,
    user,
    warehouseFromPath,
    tabFromPath
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

  if (!hydrated || !authBootstrapDone) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (!user) {
    return <div className="min-h-screen bg-bg" />;
  }

  const breadcrumb = pathname.startsWith('/admin')
    ? activeWarehouse === 'PRZEMIALY'
      ? 'Panel magazynu przemiałów'
      : 'Panel administratora'
    : getWarehouseLabel(activeWarehouse ?? warehouseFromPath);
  const title =
    pathname.startsWith('/admin') && activeWarehouse === 'PRZEMIALY'
      ? 'Zarządzanie modułem'
      : baseTitle;
  const showMobileNav =
    !pathname.startsWith('/admin') &&
    activeWarehouse !== 'FARBY_TASMY' &&
    Boolean(activeWarehouse && warehouseFromPath);
  const isReportsPath = pathname.startsWith('/raporty');
  const isActivePath = (href: string) => {
    if (href === '/czesci') return pathname === '/czesci';
    if (href === '/spis') return pathname === '/spis' || pathname.startsWith('/spis/');
    if (href === '/spis-oryginalow') {
      return pathname === '/spis-oryginalow' || pathname.startsWith('/spis-oryginalow/');
    }
    if (href === '/rozliczanie-farb-rozcienczalnikow') {
      return pathname === '/rozliczanie-farb-rozcienczalnikow' || pathname.startsWith('/rozliczanie-farb-rozcienczalnikow/');
    }
    if (href === '/przesuniecia') {
      return pathname === '/przesuniecia' || pathname.startsWith('/przesuniecia/');
    }
    return pathname.startsWith(href);
  };
  const mobileItems =
    getModuleNavItems(activeWarehouse).filter((item) => {
      if (!activeWarehouse) return false;
      if (!item.tab) return true;
      return canSeeTab(user, activeWarehouse, item.tab);
    });
  const isDashboardPath = pathname.startsWith('/dashboard');

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
        {!isDashboardPath && <Topbar title={title} breadcrumb={breadcrumb} />}
        <main
          className={cn(
            'content-area flex-1',
            isDashboardPath
              ? 'px-2 py-2 md:px-2.5 md:py-2.5'
              : showMobileNav
                ? 'px-2 py-3 md:px-6 md:py-6'
                : 'px-4 py-4 md:px-6 md:py-6'
          )}
        >
          {isDashboardPath ? (
            <>
              {showMobileNav && (
                <div className={mobileNavPanelClass}>
                  <div className="grid grid-cols-2 gap-2.5">
                    {mobileItems.map((item) => {
                      const active = isActivePath(item.href);
                      const textured =
                        activeWarehouse === 'PRZEMIALY' &&
                        Boolean(item.tab && texturedMobilePrzemialyTabs.has(item.tab));
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            mobileNavLinkClass,
                            textured &&
                              'overflow-hidden bg-[#0b0c10] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_20px_rgba(0,0,0,0.18)] hover:bg-[#111318] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_rgba(0,0,0,0.22)]',
                            active &&
                              'border-[rgba(255,122,26,0.85)] bg-[linear-gradient(180deg,rgba(255,122,26,0.13),rgba(255,122,26,0.035))] shadow-[0_0_0_2px_rgba(255,122,26,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
                            textured &&
                              active &&
                              'shadow-[0_0_0_2px_rgba(255,122,26,0.18),inset_0_1px_0_rgba(255,255,255,0.11)]'
                          )}
                          style={
                            textured
                              ? getTexturedMobileNavStyle(active)
                              : undefined
                          }
                        >
                          <span className="block max-w-full text-balance">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
              {children}
            </>
          ) : (
            <>
              {showMobileNav && (
              <div className={mobileNavPanelClass}>
                <div className="grid grid-cols-2 gap-2.5">
                  {mobileItems.map((item) => {
                    const active = isActivePath(item.href);
                    const textured =
                      activeWarehouse === 'PRZEMIALY' &&
                      Boolean(item.tab && texturedMobilePrzemialyTabs.has(item.tab));
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          mobileNavLinkClass,
                          textured &&
                            'overflow-hidden bg-[#0b0c10] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_20px_rgba(0,0,0,0.18)] hover:bg-[#111318] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_rgba(0,0,0,0.22)]',
                          active &&
                            'border-[rgba(255,122,26,0.85)] bg-[linear-gradient(180deg,rgba(255,122,26,0.13),rgba(255,122,26,0.035))] shadow-[0_0_0_2px_rgba(255,122,26,0.18),inset_0_1px_0_rgba(255,255,255,0.08)]',
                          textured &&
                            active &&
                            'shadow-[0_0_0_2px_rgba(255,122,26,0.18),inset_0_1px_0_rgba(255,255,255,0.11)]'
                        )}
                        style={
                          textured
                            ? getTexturedMobileNavStyle(active)
                            : undefined
                        }
                      >
                        <span className="block max-w-full text-balance">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
              )}
            <ContentScrim
              className={cn(
                'min-h-full max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none max-md:backdrop-blur-0',
                isReportsPath &&
                  'border-0 bg-transparent p-0 shadow-none backdrop-blur-0 md:p-0'
              )}
            >
              {children}
            </ContentScrim>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
