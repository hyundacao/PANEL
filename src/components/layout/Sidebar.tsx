'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  ClipboardList,
  ClipboardCheck,
  FileText,
  Layers,
  UsersRound,
  Shield,
  ArrowLeftRight,
  Shuffle,
  Wind,
  LogOut,
  History,
  Droplets
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useUiStore } from '@/lib/store/ui';
import {
  canSeeTab,
  getAccessibleWarehouses,
  getRoleLabel,
  getWarehouseLabel,
  isWarehouseAdmin
} from '@/lib/auth/access';
import type { WarehouseKey, WarehouseTab } from '@/lib/api/types';
import { logoutUser } from '@/lib/api';

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutGrid;
  tab?: WarehouseTab;
  requiresAdmin?: boolean;
};

const navItemsPrzemialy: NavItem[] = [
  { label: 'Pulpit', href: '/dashboard', icon: LayoutGrid, tab: 'dashboard' },
  { label: 'Spis przemiałów', href: '/spis', icon: ClipboardList, tab: 'spis' },
  { label: 'Spis oryginałów', href: '/spis-oryginalow', icon: ClipboardCheck, tab: 'spis-oryginalow' },
  {
    label: 'Przesunięcia przemiałowe',
    href: '/przesuniecia',
    icon: ArrowLeftRight,
    tab: 'przesuniecia'
  },
  { label: 'Raporty', href: '/raporty', icon: FileText, tab: 'raporty' },
  { label: 'Stany magazynowe', href: '/kartoteka', icon: Layers, tab: 'kartoteka' },
  { label: 'Suszarki', href: '/suszarki', icon: Wind, tab: 'suszarki' },
  { label: 'Wymieszane tworzywa', href: '/wymieszane', icon: Shuffle, tab: 'wymieszane' },
  {
    label: 'Zarządzanie Modułem',
    href: '/admin?tab=warehouses',
    icon: Shield,
    requiresAdmin: true
  }
];

const navItemsCzesci: NavItem[] = [
  { label: 'Start', href: '/czesci', icon: LayoutGrid },
  { label: 'Stany magazynowe', href: '/czesci/stany', icon: Layers, tab: 'stany' },
  { label: 'Historia', href: '/czesci/historia', icon: History, tab: 'historia' }
];

const navItemsRaport: NavItem[] = [
  { label: 'Raport zmianowy', href: '/raport-zmianowy', icon: FileText, tab: 'raport-zmianowy' }
];

const navItemsRaportBrakowosci: NavItem[] = [
  { label: 'Raport brakowości', href: '/raport-brakowosci', icon: FileText, tab: 'raport-brakowosci' }
];

const navItemsBilans: NavItem[] = [
  { label: 'Bilans przezbrojeń', href: '/bilans-przezbrojen', icon: UsersRound, tab: 'bilans-przezbrojen' }
];

const navItemsFarbyTasmy: NavItem[] = [
  {
    label: 'Rozliczanie farb i rozcieńczalników',
    href: '/rozliczanie-farb-rozcienczalnikow',
    icon: Droplets,
    tab: 'rozliczanie-farb-tasm'
  }
];

export const Sidebar = () => {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed, user, logout, activeWarehouse, clearActiveWarehouse } = useUiStore();
  const warehouse = activeWarehouse as WarehouseKey | null;
  const isAdminRoute = pathname.startsWith('/admin');
  const roleLabel = getRoleLabel(user, warehouse);
  const displayName = user?.name ?? 'Gość';
  const items =
    warehouse === 'CZESCI'
      ? navItemsCzesci
      : warehouse === 'RAPORT_ZMIANOWY'
        ? navItemsRaport
        : warehouse === 'RAPORT_BRAKOWOSCI'
          ? navItemsRaportBrakowosci
          : warehouse === 'BILANS_PRZEZBROJEN'
            ? navItemsBilans
            : warehouse === 'FARBY_TASMY'
              ? navItemsFarbyTasmy
              : navItemsPrzemialy;
  const visibleItems = items.filter((item) => {
    if (!warehouse) return false;
    if (item.requiresAdmin && !isWarehouseAdmin(user, warehouse)) {
      return false;
    }
    if (!item.tab) return true;
    return canSeeTab(user, warehouse, item.tab);
  });
  const canSwitchModule = getAccessibleWarehouses(user).length > 1;
  const warehouseLabel = getWarehouseLabel(warehouse);
  const isPrzemialyModuleManagementRoute = isAdminRoute && warehouse === 'PRZEMIALY';
  const isActivePath = (href: string) => {
    if (href.startsWith('/admin')) return isAdminRoute;
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
  const panelLabel = isAdminRoute && !isPrzemialyModuleManagementRoute
    ? 'PANEL ADMINISTRATORA'
    : warehouse === 'CZESCI'
      ? 'PANEL MAGAZYNU CZĘŚCI ZAMIENNYCH'
      : warehouse === 'PRZEMIALY'
        ? 'PANEL MAGAZYNU PRZEMIAŁÓW'
        : warehouse === 'FARBY_TASMY'
          ? 'PANEL ROZLICZANIA FARB I ROZCIEŃCZALNIKÓW'
          : warehouse === 'RAPORT_ZMIANOWY'
            ? 'PANEL RAPORTU ZMIANOWEGO'
            : warehouse === 'RAPORT_BRAKOWOSCI'
              ? 'PANEL RAPORTU BRAKOWOŚCI'
              : warehouse === 'BILANS_PRZEZBROJEN'
                ? 'PANEL BILANSU PRZEZBROJEŃ'
                : warehouse === 'PRZESUNIECIA_ERP'
                  ? 'PANEL PRZESUNIĘĆ ERP'
                  : 'PANEL MODUŁU';
  const headerLabel = isAdminRoute && !isPrzemialyModuleManagementRoute ? 'MODUŁY' : warehouseLabel;
  const showHeaderLabel =
    (isAdminRoute && !isPrzemialyModuleManagementRoute) ||
    (warehouse !== 'CZESCI' && warehouse !== 'PRZEMIALY' && warehouse !== 'FARBY_TASMY');
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
              {showHeaderLabel && (
                <p className="text-sm font-semibold" style={{ color: 'var(--brand)' }}>
                  {headerLabel}
                </p>
              )}
              <p
                className="text-base font-bold text-center"
                style={{ color: 'var(--brand)' }}
              >
                {panelLabel}
              </p>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-2">
          {visibleItems.map((item) => {
            const active = isActivePath(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeOnMobile}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition hover:bg-[rgba(255,255,255,0.04)] hover:text-brandHover',
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
              </Link>
            );
          })}
          {canSwitchModule && (
            <Link
              href="/magazyny"
              onClick={() => {
                clearActiveWarehouse();
                closeOnMobile();
              }}
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition hover:bg-[rgba(255,255,255,0.04)] hover:text-brandHover"
            >
              <span className="h-8 w-[2px] rounded-full bg-transparent" />
              <ArrowLeftRight className="h-4 w-4" style={{ color: 'var(--brand)' }} />
              {!sidebarCollapsed && <span style={{ color: 'var(--brand)' }}>Zmień moduł</span>}
            </Link>
          )}
        </nav>

        <div
          className={cn(
            'overflow-hidden rounded-2xl border border-[rgba(255,122,0,0.22)] bg-[#0b0c10] shadow-[0_14px_32px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.08)]',
            sidebarCollapsed ? 'p-2' : 'p-3'
          )}
          style={{
            backgroundImage:
              "linear-gradient(100deg, rgba(7,8,12,0.78), rgba(7,8,12,0.58)), url('/profil-panel-bg.png')",
            backgroundPosition: 'left center',
            backgroundSize: 'cover'
          }}
        >
          <div className={cn('flex items-center', sidebarCollapsed ? 'justify-center' : 'gap-3')}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(255,122,0,0.32)] bg-[linear-gradient(145deg,rgba(255,122,0,0.22),rgba(124,92,255,0.16))] text-sm font-black uppercase text-[var(--brand)] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
              {displayName.slice(0, 1) || '?'}
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-[var(--brand)]">{displayName}</p>
                <p className="mt-0.5 truncate text-[11px] font-medium text-dim">{roleLabel}</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && user && (
            <button
              type="button"
              onClick={handleLogout}
              className="mt-3 flex h-9 w-full items-center justify-center rounded-xl border border-[rgba(255,255,255,0.08)] bg-black/20 text-xs font-semibold text-dim transition hover:border-[rgba(255,122,0,0.28)] hover:bg-[rgba(255,122,0,0.08)] hover:text-title"
            >
              <LogOut className="mr-2 h-3.5 w-3.5" />
              Wyloguj
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

