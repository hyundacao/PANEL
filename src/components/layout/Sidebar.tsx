'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  ClipboardList,
  ClipboardCheck,
  FileText,
  Layers,
  Shield,
  ArrowLeftRight,
  Shuffle,
  Wind,
  LogOut,
  History
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { useUiStore } from '@/lib/store/ui';
import { canSeeTab, getRoleLabel, getWarehouseLabel, hasAnyAdminAccess } from '@/lib/auth/access';
import type { WarehouseKey, WarehouseTab } from '@/lib/api/types';
import { logoutUser } from '@/lib/api';

type NavItem = {
  label: string;
  href: string;
  icon: typeof LayoutGrid;
  tab?: WarehouseTab;
};

const navItemsPrzemialy: NavItem[] = [
  { label: 'Pulpit', href: '/dashboard', icon: LayoutGrid, tab: 'dashboard' },
  { label: 'Spis przemialow', href: '/spis', icon: ClipboardList, tab: 'spis' },
  { label: 'Spis oryginalow', href: '/spis-oryginalow', icon: ClipboardCheck, tab: 'spis-oryginalow' },
  {
    label: 'Przesunięcia przemiałowe',
    href: '/przesuniecia',
    icon: ArrowLeftRight,
    tab: 'przesuniecia'
  },
  {
    label: 'Przesunięcia magazynowe ERP',
    href: '/przesuniecia-magazynowe',
    icon: ArrowLeftRight,
    tab: 'przesuniecia'
  },
  { label: 'Raporty', href: '/raporty', icon: FileText, tab: 'raporty' },
  { label: 'Stany magazynowe', href: '/kartoteka', icon: Layers, tab: 'kartoteka' },
  { label: 'Suszarki', href: '/suszarki', icon: Wind, tab: 'suszarki' },
  { label: 'Wymieszane tworzywa', href: '/wymieszane', icon: Shuffle, tab: 'wymieszane' }
];

const navItemsCzesci: NavItem[] = [
  { label: 'Start', href: '/czesci', icon: LayoutGrid },
  { label: 'Stany magazynowe', href: '/czesci/stany', icon: Layers, tab: 'stany' },
  { label: 'Historia', href: '/czesci/historia', icon: History, tab: 'historia' }
];

const navItemsRaport: NavItem[] = [
  { label: 'Raport zmianowy', href: '/raport-zmianowy', icon: FileText, tab: 'raport-zmianowy' }
];

export const Sidebar = () => {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed, user, logout, activeWarehouse } = useUiStore();
  const warehouse = activeWarehouse as WarehouseKey | null;
  const roleLabel = getRoleLabel(user, warehouse);
  const displayName = user?.name ?? 'Gosc';
  const items =
    warehouse === 'CZESCI'
      ? navItemsCzesci
      : warehouse === 'RAPORT_ZMIANOWY'
        ? navItemsRaport
        : navItemsPrzemialy;
  const visibleItems = items.filter((item) => {
    if (!warehouse) return false;
    if (!item.tab) return true;
    return canSeeTab(user, warehouse, item.tab);
  });
  const showAdmin = hasAnyAdminAccess(user);
  const warehouseLabel = getWarehouseLabel(warehouse);
  const isActivePath = (href: string) => {
    if (href === '/czesci') return pathname === '/czesci';
    if (href === '/spis') return pathname === '/spis' || pathname.startsWith('/spis/');
    if (href === '/spis-oryginalow') {
      return pathname === '/spis-oryginalow' || pathname.startsWith('/spis-oryginalow/');
    }
    if (href === '/przesuniecia-magazynowe') {
      return (
        pathname === '/przesuniecia-magazynowe' ||
        pathname.startsWith('/przesuniecia-magazynowe/')
      );
    }
    if (href === '/przesuniecia') {
      return pathname === '/przesuniecia' || pathname.startsWith('/przesuniecia/');
    }
    return pathname.startsWith(href);
  };
  const panelLabel =
    warehouse === 'CZESCI'
      ? 'PANEL MAGAZYNU CZ\u0118\u015aCI ZAMIENNYCH'
      : warehouse === 'PRZEMIALY'
        ? 'PANEL MAGAZYNU PRZEMIA\u0141\u00d3W'
        : warehouse === 'RAPORT_ZMIANOWY'
          ? 'PANEL RAPORTU ZMIANOWEGO'
          : 'Panel produkcji';
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
              {warehouse !== 'CZESCI' && warehouse !== 'PRZEMIALY' && (
                <p className="text-sm font-semibold" style={{ color: 'var(--brand)' }}>
                  {warehouseLabel}
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
          {showAdmin && (
            <div>
              <Link
                href="/admin"
                onClick={closeOnMobile}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition hover:bg-[rgba(255,255,255,0.04)] hover:text-brandHover',
                  pathname.startsWith('/admin') && 'bg-[rgba(255,255,255,0.06)]'
                )}
              >
                <span
                  className={cn(
                    'h-8 w-[2px] rounded-full bg-transparent',
                    pathname.startsWith('/admin') && 'bg-brand'
                  )}
                />
                <Shield className="h-4 w-4" style={{ color: 'var(--brand)' }} />
                {!sidebarCollapsed && <span style={{ color: 'var(--brand)' }}>ZARZĄDZANIE</span>}
              </Link>
              {!sidebarCollapsed && (
                <div className="flex justify-center pt-3">
                  <Image
                    src="/logo.png"
                    alt=""
                    aria-hidden="true"
                    width={260}
                    height={120}
                    className="w-full max-w-[260px] opacity-45 grayscale"
                  />
                </div>
              )}
            </div>
          )}
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

