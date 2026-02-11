'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Bell, LogOut, Menu } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUiStore } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { getAccessibleWarehouses } from '@/lib/auth/access';
import { logoutUser } from '@/lib/api';
import { useToastStore } from '@/components/ui/Toast';
import {
  disableErpPushNotifications,
  enableErpPushNotifications,
  syncErpPushStatus
} from '@/lib/push/client';

export const Topbar = ({
  title,
  breadcrumb,
  showSidebarToggle = true
}: {
  title: string;
  breadcrumb?: string;
  showSidebarToggle?: boolean;
}) => {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const {
    toggleSidebar,
    sidebarCollapsed,
    user,
    clearActiveWarehouse,
    logout,
    activeWarehouse,
    erpDocumentNotificationsEnabled,
    setErpDocumentNotificationsEnabled
  } = useUiStore();
  const warehouses = getAccessibleWarehouses(user);
  const canSwitch = warehouses.length > 1;
  const isErpModule = activeWarehouse === 'PRZESUNIECIA_ERP';
  const [erpNotificationsBusy, setErpNotificationsBusy] = useState(false);

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

  useEffect(() => {
    if (!isErpModule) return;
    let cancelled = false;

    const syncStatus = async () => {
      try {
        const status = await syncErpPushStatus();
        if (cancelled) return;
        setErpDocumentNotificationsEnabled(status.enabled);
      } catch {
        if (cancelled) return;
        setErpDocumentNotificationsEnabled(false);
      }
    };

    void syncStatus();

    return () => {
      cancelled = true;
    };
  }, [isErpModule, setErpDocumentNotificationsEnabled]);

  const handleToggleErpNotifications = async () => {
    if (!isErpModule || erpNotificationsBusy) return;

    const shouldEnable = !erpDocumentNotificationsEnabled;
    setErpNotificationsBusy(true);
    try {
      if (shouldEnable) {
        await enableErpPushNotifications();
        setErpDocumentNotificationsEnabled(true);
        toast({
          title: 'Powiadomienia ERP włączone',
          description: 'Nowe dokumenty będą wysyłane jako powiadomienia systemowe.',
          tone: 'info'
        });
      } else {
        await disableErpPushNotifications();
        setErpDocumentNotificationsEnabled(false);
        toast({
          title: 'Powiadomienia ERP wyłączone',
          description: 'Powiadomienia systemowe o nowych dokumentach są wyłączone.',
          tone: 'info'
        });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN';
      const description =
        code === 'NOT_SUPPORTED'
          ? 'Ta przeglądarka nie obsługuje powiadomień push.'
          : code === 'INSECURE_CONTEXT'
            ? 'Powiadomienia push wymagają połączenia HTTPS.'
            : code === 'NOT_CONFIGURED' || code === 'PUSH_NOT_CONFIGURED'
              ? 'Brak konfiguracji kluczy push na serwerze.'
              : code === 'PERMISSION_DENIED' || code === 'PERMISSION_NOT_GRANTED'
                ? 'W przeglądarce odrzucono zgodę na powiadomienia.'
                : code === 'MIGRATION_REQUIRED'
                  ? 'Brak tabeli subskrypcji. Wykonaj migrację bazy danych.'
                  : 'Nie udało się zapisać ustawienia powiadomień.';

      toast({
        title: shouldEnable
          ? 'Nie udało się włączyć powiadomień ERP'
          : 'Nie udało się wyłączyć powiadomień ERP',
        description,
        tone: 'error'
      });
    } finally {
      setErpNotificationsBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface px-3 py-2 backdrop-blur md:gap-6 md:px-6 md:py-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
        <Button
          variant="ghost"
          onClick={toggleSidebar}
          aria-label="Przełącz menu"
          aria-expanded={!sidebarCollapsed}
          className={showSidebarToggle ? 'hidden md:inline-flex' : 'hidden'}
        >
          <Menu className="h-4 w-4" style={{ color: 'var(--brand)' }} />
        </Button>
        <div className="min-w-0">
          {breadcrumb && (
            <p className="hidden truncate text-[11px] leading-tight sm:block" style={{ color: 'var(--brand)' }}>
              {breadcrumb}
            </p>
          )}
          <h1
            className="truncate text-sm font-semibold leading-tight md:text-lg"
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

      <div className="ml-auto flex items-center justify-end gap-2 md:gap-3">
        {canSwitch && (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                clearActiveWarehouse();
                router.push('/magazyny');
              }}
              className="h-10 min-h-10 w-10 px-0 py-0 md:hidden"
              aria-label="Zmień moduł"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                clearActiveWarehouse();
                router.push('/magazyny');
              }}
              className="hidden md:inline-flex"
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Zmień moduł
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          onClick={isErpModule ? () => void handleToggleErpNotifications() : undefined}
          disabled={isErpModule ? erpNotificationsBusy : false}
          className={`h-10 min-h-10 w-10 px-0 py-0 ${
            isErpModule && erpDocumentNotificationsEnabled
              ? 'border-[color:color-mix(in_srgb,var(--brand)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] text-brand'
              : ''
          }`}
          aria-label={
            isErpModule
              ? erpDocumentNotificationsEnabled
                ? 'Wyłącz powiadomienia ERP'
                : 'Włącz powiadomienia ERP'
              : 'Powiadomienia'
          }
          title={
            isErpModule
              ? erpDocumentNotificationsEnabled
                ? 'Powiadomienia ERP: włączone'
                : 'Powiadomienia ERP: wyłączone'
              : undefined
          }
        >
          <Bell className="h-4 w-4" />
        </Button>
        <div className="hidden h-10 w-10 rounded-full bg-surface2 md:block" />
      </div>
    </header>
  );
};

