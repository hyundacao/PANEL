'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeftRight, Bell, KeyRound, LogOut, Menu, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useUiStore } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { canSeeTab, getAccessibleWarehouses } from '@/lib/auth/access';
import { changeOwnPassword, logoutUser } from '@/lib/api';
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
  const pathname = usePathname();
  const toast = useToastStore((state) => state.push);
  const {
    toggleSidebar,
    sidebarCollapsed,
    user,
    setUser,
    clearActiveWarehouse,
    logout,
    activeWarehouse,
    erpDocumentNotificationsEnabled,
    setErpDocumentNotificationsEnabled
  } = useUiStore();
  const warehouses = getAccessibleWarehouses(user);
  const canSwitch = warehouses.length > 1;
  const isErpModule = activeWarehouse === 'PRZESUNIECIA_ERP';
  const hasErpDocumentPushRole =
    canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-magazynier') ||
    canSeeTab(user, 'PRZESUNIECIA_ERP', 'erp-rozdzielca');
  const isErpDocumentsPage = pathname.startsWith('/przesuniecia-magazynowe');
  const canManageErpDocumentPush = isErpModule && isErpDocumentsPage && hasErpDocumentPushRole;
  const mustChangePassword = Boolean(user?.mustChangePassword);
  const [erpNotificationsBusy, setErpNotificationsBusy] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePasswordMutation = useMutation({
    mutationFn: changeOwnPassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordDialogOpen(false);
      if (user) {
        setUser({ ...user, mustChangePassword: false });
      }
      toast({ title: 'Haslo zostalo zmienione', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        CURRENT_PASSWORD_REQUIRED: 'Podaj aktualne haslo.',
        NEW_PASSWORD_REQUIRED: 'Podaj nowe haslo.',
        SAME_PASSWORD: 'Nowe haslo musi byc inne niz aktualne.',
        INVALID_CURRENT_PASSWORD: 'Aktualne haslo jest nieprawidlowe.',
        INACTIVE: 'Twoje konto jest nieaktywne.'
      };
      toast({
        title: 'Nie udalo sie zmienic hasla',
        description: messageMap[err.message] ?? 'Sprobuj ponownie.',
        tone: 'error'
      });
    }
  });

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
    if (!canManageErpDocumentPush) return;
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
  }, [canManageErpDocumentPush, setErpDocumentNotificationsEnabled]);

  useEffect(() => {
    if (mustChangePassword) {
      setPasswordDialogOpen(true);
    }
  }, [mustChangePassword]);

  useEffect(() => {
    if (!passwordDialogOpen || mustChangePassword) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPasswordDialogOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mustChangePassword, passwordDialogOpen]);

  const handleToggleErpNotifications = async () => {
    if (!canManageErpDocumentPush || erpNotificationsBusy) return;

    const shouldEnable = !erpDocumentNotificationsEnabled;
    setErpNotificationsBusy(true);
    try {
      if (shouldEnable) {
        await enableErpPushNotifications();
        setErpDocumentNotificationsEnabled(true);
        toast({
          title: 'Powiadomienia ERP włączone',
          description: 'Powiadomienia o dokumentach ERP będą wysyłane systemowo.',
          tone: 'info'
        });
      } else {
        await disableErpPushNotifications();
        setErpDocumentNotificationsEnabled(false);
        toast({
          title: 'Powiadomienia ERP wyłączone',
          description: 'Powiadomienia systemowe o dokumentach ERP są wyłączone.',
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

  const handleChangePassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = currentPassword.trim();
    const next = newPassword.trim();
    const confirmation = confirmPassword.trim();

    if (!current) {
      toast({ title: 'Podaj aktualne haslo', tone: 'error' });
      return;
    }
    if (!next) {
      toast({ title: 'Podaj nowe haslo', tone: 'error' });
      return;
    }
    if (next !== confirmation) {
      toast({ title: 'Nowe hasla nie sa takie same', tone: 'error' });
      return;
    }

    changePasswordMutation.mutate({
      currentPassword: current,
      newPassword: next
    });
  };

  return (
    <>
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
        {user && (
          <>
            <Button
              variant="ghost"
              className="h-10 min-h-10 w-10 px-0 py-0 md:hidden"
              aria-label="Zmien haslo"
              onClick={() => setPasswordDialogOpen(true)}
            >
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              className="hidden md:inline-flex"
              onClick={() => setPasswordDialogOpen(true)}
            >
              <KeyRound className="mr-2 h-4 w-4" />
              Zmien haslo
            </Button>
          </>
        )}
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
        {canManageErpDocumentPush && (
          <Button
            variant="ghost"
            onClick={() => void handleToggleErpNotifications()}
            disabled={erpNotificationsBusy}
            className={`h-10 min-h-10 w-10 px-0 py-0 ${
              erpDocumentNotificationsEnabled
                ? 'border-[color:color-mix(in_srgb,var(--brand)_55%,transparent)] bg-[color:color-mix(in_srgb,var(--brand)_14%,transparent)] text-brand'
                : ''
            }`}
            aria-label={
              erpDocumentNotificationsEnabled
                ? 'Wyłącz powiadomienia ERP'
                : 'Włącz powiadomienia ERP'
            }
            title={
              erpDocumentNotificationsEnabled
                ? 'Powiadomienia ERP: włączone'
                : 'Powiadomienia ERP: wyłączone'
            }
          >
            <Bell className="h-4 w-4" />
          </Button>
        )}
        <div className="hidden h-10 w-10 rounded-full bg-surface2 md:block" />
      </div>
      </header>
      {user && passwordDialogOpen && (
        <>
          <div
            className="fixed inset-0 z-[990] bg-[var(--scrim)]"
            onClick={() => {
              if (!mustChangePassword) {
                setPasswordDialogOpen(false);
              }
            }}
          />
          <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
            <div className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[rgba(255,255,255,0.14)] bg-[rgba(10,11,15,0.98)] p-6 shadow-[0_22px_50px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]">
              {!mustChangePassword && (
                <button
                  type="button"
                  className="absolute right-4 top-4 text-dim hover:text-title"
                  onClick={() => setPasswordDialogOpen(false)}
                  aria-label="Zamknij"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <div className="space-y-2">
                <p className="text-lg font-semibold text-title">Zmiana hasla</p>
                <p className="text-sm text-dim">
                  {mustChangePassword
                    ? 'Administrator zresetowal haslo. Ustaw nowe haslo, aby kontynuowac.'
                    : 'Podaj aktualne haslo i ustaw nowe.'}
                </p>
              </div>
              <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-dim">
                    Aktualne haslo
                  </label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-dim">
                    Nowe haslo
                  </label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs uppercase tracking-wide text-dim">
                    Powtorz nowe haslo
                  </label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••"
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={changePasswordMutation.isPending}>
                    Zapisz nowe haslo
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
};

