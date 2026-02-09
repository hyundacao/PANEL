'use client';

import { ArrowLeftRight, Bell, LogOut, Menu } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUiStore } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { getAccessibleWarehouses } from '@/lib/auth/access';
import { logoutUser } from '@/lib/api';

export const Topbar = ({ title, breadcrumb }: { title: string; breadcrumb?: string }) => {
  const router = useRouter();
  const { toggleSidebar, sidebarCollapsed, user, clearActiveWarehouse, logout } = useUiStore();
  const warehouses = getAccessibleWarehouses(user);
  const canSwitch = warehouses.length > 1;
  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch {
      // ignore logout transport errors and clear local state anyway
    } finally {
      logout();
      router.replace('/login');
    }
  };

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3 backdrop-blur md:gap-6 md:px-6 md:py-4">
      <div className="flex w-full min-w-0 items-center gap-3 md:w-auto">
        <Button
          variant="ghost"
          onClick={toggleSidebar}
          aria-label="Przelacz menu"
          aria-expanded={!sidebarCollapsed}
          className="hidden md:inline-flex"
        >
          <Menu className="h-4 w-4" style={{ color: 'var(--brand)' }} />
        </Button>
        <div className="min-w-0">
          {breadcrumb && (
            <p className="truncate text-xs" style={{ color: 'var(--brand)' }}>
              {breadcrumb}
            </p>
          )}
          <h1
            className="truncate text-base font-semibold md:text-lg"
            style={{ color: 'var(--brand)' }}
          >
            {title}
          </h1>
        </div>
        {user && (
          <Button
            variant="ghost"
            onClick={handleLogout}
            className="ml-auto md:hidden"
            aria-label="Wyloguj"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex w-full items-center justify-end gap-2 md:ml-auto md:w-auto md:gap-3">
        {canSwitch && (
          <Button
            variant="ghost"
            onClick={() => {
              clearActiveWarehouse();
              router.push('/magazyny');
            }}
            className="w-full md:w-auto"
          >
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            Zmień moduł
          </Button>
        )}
        <Button variant="ghost">
          <Bell className="h-4 w-4" />
        </Button>
        <div className="hidden h-10 w-10 rounded-full bg-surface2 sm:block" />
      </div>
    </header>
  );
};
