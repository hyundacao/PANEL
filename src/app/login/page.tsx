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

export default function LoginPage() {
  const router = useRouter();
  const toast = useToastStore((state) => state.push);
  const { user, setUser, hydrated, rememberMe, setRememberMe, clearActiveWarehouse } = useUiStore();
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
    onSuccess: (data) => {
      setUser(data);
      clearActiveWarehouse();
      toast({ title: 'Zalogowano', tone: 'success' });
      router.replace('/magazyny');
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_CREDENTIALS: 'Nieprawidlowy login lub haslo.',
        INACTIVE: 'Twoje konto jest nieaktywne.',
        RATE_LIMITED: 'Za duzo prob logowania. Odczekaj chwile i sprobuj ponownie.'
      };
      toast({
        title: 'Nie udalo sie zalogowac',
        description: messageMap[err.message] ?? 'Sprawdz dane i sprobuj ponownie.',
        tone: 'error'
      });
    }
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast({ title: 'Wpisz login i haslo', tone: 'error' });
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
            <p className="text-base text-dim">Zaloguj sie, aby przejsc do pulpitu.</p>
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
              <label className="text-xs uppercase tracking-wide text-dim">Haslo</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••"
                autoComplete="current-password"
              />
            </div>
            <div className="flex items-center justify-between">
              <Toggle checked={rememberMe} onCheckedChange={setRememberMe} label="Zapamietaj mnie" />
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
