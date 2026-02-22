'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowLeftRight,
  Boxes,
  FileText,
  Shield,
  Wrench,
  type LucideIcon
} from 'lucide-react';
import { useUiStore } from '@/lib/store/ui';
import { getCurrentSessionUser } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchInput } from '@/components/ui/SearchInput';
import {
  canSeeTab,
  getAccessibleWarehouses,
  getAdminWarehouses,
  hasAnyAdminAccess,
  isHeadAdmin
} from '@/lib/auth/access';
import type { WarehouseKey, WarehouseTab } from '@/lib/api/types';

type ModuleOption = {
  id: string;
  key: WarehouseKey;
  requiredTabs?: WarehouseTab[];
  title: string;
  description: string;
  action: string;
  href: string;
  tags: string[];
  keywords: string[];
  icon: LucideIcon;
};

const moduleOptions: ModuleOption[] = [
  {
    id: 'przemialy-core',
    key: 'PRZEMIALY',
    requiredTabs: [
      'dashboard',
      'spis',
      'spis-oryginalow',
      'przesuniecia',
      'raporty',
      'kartoteka',
      'suszarki',
      'wymieszane'
    ],
    title: 'Zarządzanie przemiałami i przygotowaniem produkcji',
    description: 'Spisy, raporty i bieżące stany hal produkcyjnych.',
    action: 'Wejdź',
    href: '/dashboard',
    tags: ['Produkcja', 'Statystyki'],
    keywords: ['hala', 'spis', 'raporty', 'kartoteka', 'suszarki', 'wymieszane'],
    icon: Boxes
  },
  {
    id: 'przemialy-erp',
    key: 'PRZESUNIECIA_ERP',
    requiredTabs: [
      'erp-magazynier',
      'erp-rozdzielca',
      'erp-rozdzielca-zmianowy',
      'erp-wypisz-dokument',
      'erp-historia-dokumentow'
    ],
    title: 'Przesunięcia magazynowe ERP',
    description: 'Osobny moduł ERP MM/MMZ: dokumenty, pozycje i przyjęcia.',
    action: 'Wejdź',
    href: '/przesuniecia-magazynowe',
    tags: ['ERP', 'MM/MMZ'],
    keywords: ['erp', 'mm', 'mmz', 'przesunięcia magazynowe', 'dokumenty'],
    icon: ArrowLeftRight
  },
  {
    id: 'czesci',
    key: 'CZESCI',
    title: 'Magazyn części zamiennych',
    description: 'Pobrania, uzupełnienia, historia ruchów i kontrola stanów.',
    action: 'Wejdź',
    href: '/czesci',
    tags: ['Dział Uruchomień', 'Magazyn'],
    keywords: ['części', 'historia', 'stany', 'pobierz', 'uzupełnij'],
    icon: Wrench
  },
  {
    id: 'raport-zmianowy',
    key: 'RAPORT_ZMIANOWY',
    title: 'Raport zmianowy',
    description: 'Wpisy ze zmian, podsumowania i analiza przebiegu produkcji.',
    action: 'Wejdź',
    href: '/raport-zmianowy',
    tags: ['Raporty', 'Zmiany'],
    keywords: ['raport', 'zmiana', 'sesja', 'wpisy'],
    icon: FileText
  }
];

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export default function WarehousesPage() {
  const router = useRouter();
  const {
    user,
    setUser,
    hydrated,
    setActiveWarehouse,
    clearActiveWarehouse,
    logout
  } = useUiStore();
  const [search, setSearch] = useState('');
  const [authBootstrapResolved, setAuthBootstrapResolved] = useState(false);
  const authBootstrapDone = Boolean(user) || authBootstrapResolved;

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
    }
  }, [authBootstrapDone, hydrated, router, user]);

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

  if (!hydrated || !authBootstrapDone || !user) {
    return <div className="min-h-screen bg-bg" />;
  }

  const available = getAccessibleWarehouses(user);
  const visibleModules = moduleOptions.filter((item) => {
    if (!available.includes(item.key)) return false;
    if (!item.requiredTabs || item.requiredTabs.length === 0) return true;
    return item.requiredTabs.some((tab) => canSeeTab(user, item.key, tab));
  });
  const adminWarehouses = getAdminWarehouses(user);
  const adminVisible = hasAnyAdminAccess(user);
  const needle = normalize(search);

  const filteredModules = !needle
    ? visibleModules
    : visibleModules.filter((module) => {
        const haystack = normalize(
          [module.title, module.description, ...module.tags, ...module.keywords].join(' ')
        );
        return haystack.includes(needle);
      });

  const adminHaystack = normalize(
    'panel administratora uprawnienia konfiguracja konta zarządzanie'
  );
  const showAdminCard = adminVisible && (!needle || adminHaystack.includes(needle));
  const visibleCount = filteredModules.length + (showAdminCard ? 1 : 0);

  const openModule = (module: ModuleOption) => {
    setActiveWarehouse(module.key);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('apka-nav-from-magazyny', module.href);
    }
    router.push(module.href);
  };

  const openAdmin = () => {
    if (isHeadAdmin(user)) {
      clearActiveWarehouse();
    } else if (adminWarehouses.length > 0) {
      setActiveWarehouse(adminWarehouses[0]);
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('apka-nav-from-magazyny', '/admin');
    }
    router.push('/admin');
  };

  return (
    <div className="min-h-screen bg-bg px-4 py-8 md:px-6 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-title md:text-3xl">
                Wybierz moduł do pracy
              </h1>
              <p className="text-sm text-dim">
                Moduły będą przybywać, więc możesz je filtrować po nazwie lub opisie.
              </p>
            </div>
            <Badge tone="info">Widoczne: {visibleCount}</Badge>
          </div>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Szukaj modułu (np. raport, części, spis...)"
          />
        </Card>

        {visibleModules.length === 0 && !adminVisible ? (
          <EmptyState
            title="Brak dostępu"
            description="Skontaktuj się z administratorem, aby otrzymać dostęp do modułów."
          />
        ) : visibleCount === 0 ? (
          <EmptyState
            title="Brak wyników"
            description="Zmień frazę wyszukiwania albo wyczyść filtr."
            actionLabel="Wyczyść filtr"
            onAction={() => setSearch('')}
          />
        ) : (
          <>
            {filteredModules.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-dim">
                    Moduły robocze
                  </h2>
                  <span className="text-xs text-dim">{filteredModules.length} szt.</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredModules.map((module) => {
                    const Icon = module.icon;
                    return (
                      <Card
                        key={module.id}
                        className="flex h-full flex-col gap-4 bg-[var(--surface-1)] hover:bg-[var(--surface-1)]"
                      >
                        <div className="flex items-start gap-3">
                          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface2">
                            <Icon className="h-5 w-5 text-brand" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-title">{module.title}</h3>
                            <p className="mt-1 text-sm text-dim">{module.description}</p>
                          </div>
                        </div>
                        <div className="mt-auto space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {module.tags.map((tag) => (
                              <span
                                key={`${module.id}-${tag}`}
                                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-dim"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                          <Button onClick={() => openModule(module)} className="w-full">
                            {module.action}
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}

            {showAdminCard && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-dim">
                  Administracja
                </h2>
                <Card className="flex flex-col gap-4 bg-[var(--surface-1)] hover:bg-[var(--surface-1)] md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface2">
                      <Shield className="h-5 w-5 text-brand" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-title">Panel administratora</h3>
                      <p className="text-sm text-dim">
                        Konfiguracja kont, uprawnień i ustawień systemowych.
                      </p>
                    </div>
                  </div>
                  <Button onClick={openAdmin} className="w-full md:w-auto md:px-8">
                    Wejdź
                  </Button>
                </Card>
              </section>
            )}
          </>
        )}

        <Image
          src="/logo.png"
          alt=""
          aria-hidden="true"
          width={1200}
          height={360}
          className="mt-2 h-auto w-full opacity-25 grayscale"
        />
      </div>
    </div>
  );
}


