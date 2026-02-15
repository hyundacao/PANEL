'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { authenticateUser } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { canSeeTab } from '@/lib/auth/access';
import {
  disableErpPushNotifications,
  enableErpPushNotifications,
  syncErpPushStatus
} from '@/lib/push/client';

export default function LoginPage() {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const {
    user,
    setUser,
    hydrated,
    rememberMe,
    setRememberMe,
    clearActiveWarehouse,
    setErpDocumentNotificationsEnabled
  } = useUiStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!hydrated) return;
    if (user) {
      router.replace('/magazyny');
    }
  }, [hydrated, router, user]);

  const loginMutation = useMutation({
    mutationFn: authenticateUser,
    onSuccess: async (data) => {
      setUser(data);
      clearActiveWarehouse();

      const canManageErpDocumentPush =
        canSeeTab(data, 'PRZESUNIECIA_ERP', 'erp-magazynier') ||
        canSeeTab(data, 'PRZESUNIECIA_ERP', 'erp-rozdzielca');

      if (canManageErpDocumentPush) {
        try {
          if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'default') {
              const shouldEnable = window.confirm(
                'Czy włączyć powiadomienia o dokumentach ERP?'
              );
              if (shouldEnable) {
                const status = await enableErpPushNotifications();
                setErpDocumentNotificationsEnabled(status.enabled);
                if (status.enabled) {
                  toast({
                    title: 'Powiadomienia ERP włączone',
                    description: 'Powiadomienia o dokumentach ERP będą wysyłane systemowo.',
                    tone: 'info'
                  });
                }
              } else {
                await disableErpPushNotifications().catch(() => undefined);
                setErpDocumentNotificationsEnabled(false);
              }
            } else if (Notification.permission === 'granted') {
              const status = await syncErpPushStatus();
              setErpDocumentNotificationsEnabled(status.enabled);
            } else {
              setErpDocumentNotificationsEnabled(false);
              toast({
                title: 'Powiadomienia ERP są zablokowane',
                description: 'Odblokuj je w ustawieniach przeglądarki telefonu.',
                tone: 'info'
              });
            }
          } else {
            setErpDocumentNotificationsEnabled(false);
          }
        } catch (error) {
          setErpDocumentNotificationsEnabled(false);
          const code = error instanceof Error ? error.message : 'UNKNOWN';
          const description =
            code === 'NOT_CONFIGURED'
              ? 'Brak konfiguracji push na serwerze.'
              : code === 'INSECURE_CONTEXT'
                ? 'Powiadomienia wymagają HTTPS.'
                : code === 'NOT_SUPPORTED'
                  ? 'Ta przeglądarka nie obsługuje push.'
                  : code === 'MIGRATION_REQUIRED'
                    ? 'Brakuje migracji tabeli subskrypcji push.'
                    : 'Nie udało się włączyć powiadomień ERP.';
          toast({
            title: 'Problem z konfiguracją powiadomień ERP',
            description,
            tone: 'error'
          });
        }
      } else {
        setErpDocumentNotificationsEnabled(false);
      }

      toast({ title: 'Zalogowano', tone: 'success' });
      router.replace('/magazyny');
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_CREDENTIALS: 'Nieprawidłowy login lub hasło.',
        INACTIVE: 'Twoje konto jest nieaktywne.',
        RATE_LIMITED: 'Za dużo prób logowania. Odczekaj chwilę i spróbuj ponownie.'
      };
      toast({
        title: 'Nie udało się zalogować',
        description: messageMap[err.message] ?? 'Sprawdź dane i spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast({ title: 'Wpisz login i hasło', tone: 'error' });
      return;
    }
    loginMutation.mutate({ username, password, rememberMe });
  };

  if (!hydrated) {
    return <div className="min-h-screen bg-bg" />;
  }

  if (user) {
    return <div className="min-h-screen bg-bg" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-0.5">
        <Card className="w-full space-y-6">
          <div className="space-y-2 text-center">
            <p className="text-4xl font-semibold uppercase tracking-wide text-title">Panel logowania</p>
            <p className="text-base text-dim">Zaloguj się, aby przejść do pulpitu.</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-dim">Login</label>
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="np. admin"
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-dim">Hasło</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••"
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-center justify-between">
              <Toggle checked={rememberMe} onCheckedChange={setRememberMe} label="Zapamiętaj mnie" />
            </div>
            <Button type="submit" disabled={loginMutation.isPending} className="w-full">
              Zaloguj
            </Button>
          </form>
        </Card>
        <Image
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={640}
          height={320}
          className="w-full max-w-md -mt-2 h-auto opacity-30 grayscale"
        />
      </div>
    </div>
  );
}
