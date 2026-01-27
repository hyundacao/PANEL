'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUiStore } from '@/lib/store/ui';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { getAccessibleWarehouses, getWarehouseLabel, isAdmin } from '@/lib/auth/access';
import type { WarehouseKey } from '@/lib/api/types';

const warehouseOptions: Array<{
  key: WarehouseKey;
  title: string;
  description: string;
  action: string;
  href: string;
}> = [
  {
    key: 'PRZEMIALY',
    title: 'Zarządzanie przemiałami i przygotowaniem produkcji',
    description: 'Stany, spisy, przesunięcia i raporty z hal produkcyjnych.',
    action: 'WEJDŹ',
    href: '/dashboard'
  },
  {
    key: 'CZESCI',
    title: 'Magazyn części zamiennych',
    description: 'Pobrania, uzupełnienia i kontrola stanów części.',
    action: 'WEJDŹ',
    href: '/czesci'
  },
  {
    key: 'ZESZYT',
    title: 'Zeszyt produkcji',
    description: 'Ewidencja odbiorów palet i rozliczeń na zmianie.',
    action: 'WEJDŹ',
    href: '/zeszyt'
  }
];

export default function WarehousesPage() {
  const router = useRouter();
  const { user, hydrated, setActiveWarehouse, clearActiveWarehouse } = useUiStore();

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace('/login');
    }
  }, [hydrated, router, user]);

  if (!hydrated || !user) {
    return <div className="min-h-screen bg-bg" />;
  }

  const available = getAccessibleWarehouses(user);
  const visibleOptions = warehouseOptions.filter((item) => available.includes(item.key));
  const adminVisible = isAdmin(user) || user?.role === 'ADMIN';

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold text-title">Wybierz magazyn do pracy</h1>
        </div>

        {visibleOptions.length === 0 && !adminVisible ? (
          <Card className="space-y-2 text-center">
            <p className="text-sm font-semibold text-title">Brak dostępu</p>
            <p className="text-sm text-dim">
              Skontaktuj się z administratorem, aby otrzymać dostęp do magazynu.
            </p>
          </Card>
        ) : (
          <div className="mx-auto grid w-full max-w-3xl gap-4">
            {visibleOptions.map((option) => (
              <Card key={option.key} className="flex flex-col items-center gap-4 text-center">
                <div>
                  {option.key === 'PRZEMIALY' && (
                    <p className="text-2xl font-semibold text-title">
                      {getWarehouseLabel(option.key)}
                    </p>
                  )}
                  {option.key !== 'PRZEMIALY' && (
                    <>
                      <h2 className="mt-2 text-2xl font-semibold text-title">{option.title}</h2>
                      {option.key !== 'CZESCI' && (
                        <p className="mt-2 text-sm text-dim">{option.description}</p>
                      )}
                    </>
                  )}
                </div>
                <Button
                  onClick={() => {
                    setActiveWarehouse(option.key);
                    router.replace(option.href);
                  }}
                  className="px-10 text-lg"
                >
                  {option.action}
                </Button>
              </Card>
            ))}
            {adminVisible && (
              <>
                <Card className="flex flex-col items-center gap-4 text-center">
                  <div>
                    <h2 className="text-2xl font-semibold text-title">Panel administratora</h2>
                  </div>
                  <Button
                    onClick={() => {
                      clearActiveWarehouse();
                      router.replace('/admin');
                    }}
                    className="px-10 text-lg"
                  >
                    WEJDŹ
                  </Button>
                </Card>
                <img
                  src="/logo.png"
                  alt=""
                  aria-hidden="true"
                  className="mt-6 w-full max-w-3xl opacity-30 grayscale"
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


