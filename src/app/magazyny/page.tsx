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
    title: 'Zarzadzanie przemialami i przygotowaniem produkcji',
    description: 'Spisy, raporty i biezace stany hal produkcyjnych.',
    action: 'Wejdz',
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
      'erp-wypisz-dokument',
      'erp-historia-dokumentow'
    ],
    title: 'Przesuniecia magazynowe ERP',
    description: 'Osobny modul ERP MM/MMZ: dokumenty, pozycje i przyjecia.',
    action: 'Wejdz',
    href: '/przesuniecia-magazynowe',
    tags: ['ERP', 'MM/MMZ'],
    keywords: ['erp', 'mm', 'mmz', 'przesuniecia magazynowe', 'dokumenty'],
    icon: ArrowLeftRight
  },
  {
    id: 'czesci',
    key: 'CZESCI',
    title: 'Magazyn czesci zamiennych',
    description: 'Pobrania, uzupelnienia, historia ruchow i kontrola stanow.',
    action: 'Wejdz',
    href: '/czesci',
    tags: ['Utrzymanie ruchu', 'Magazyn'],
    keywords: ['czesci', 'historia', 'stany', 'pobierz', 'uzupelnij'],
    icon: Wrench
  },
  {
    id: 'raport-zmianowy',
    key: 'RAPORT_ZMIANOWY',
    title: 'Raport zmianowy',
    description: 'Wpisy ze zmian, podsumowania i analiza przebiegu produkcji.',
    action: 'Wejdz',
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
  const { user, hydrated, setActiveWarehouse, clearActiveWarehouse, logout } = useUiStore();
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!hydrated) return;
    if (!user) {
      router.replace('/login');
    }
  }, [hydrated, router, user]);

  useEffect(() => {
    if (!hydrated || !user) return;
    let cancelled = false;
    getCurrentSessionUser().catch(() => {
      if (cancelled) return;
      logout();
      router.replace('/login');
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated, logout, router, user]);

  if (!hydrated || !user) {
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
    'panel administratora uprawnienia konfiguracja konta zarzadzanie'
  );
  const showAdminCard = adminVisible && (!needle || adminHaystack.includes(needle));
  const visibleCount = filteredModules.length + (showAdminCard ? 1 : 0);

  const openModule = (module: ModuleOption) => {
    setActiveWarehouse(module.key);
    router.replace(module.href);
  };

  const openAdmin = () => {
    if (isHeadAdmin(user)) {
      clearActiveWarehouse();
    } else if (adminWarehouses.length > 0) {
      setActiveWarehouse(adminWarehouses[0]);
    }
    router.replace('/admin');
  };

  return (
    <div className="min-h-screen bg-bg px-4 py-8 md:px-6 md:py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold text-title md:text-3xl">
                Wybierz modul do pracy
              </h1>
              <p className="text-sm text-dim">
                Moduly beda przybywac, wiec mozesz je filtrowac po nazwie lub opisie.
              </p>
            </div>
            <Badge tone="info">Widoczne: {visibleCount}</Badge>
          </div>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Szukaj modulu (np. raport, czesci, spis...)"
          />
        </Card>

        {visibleModules.length === 0 && !adminVisible ? (
          <EmptyState
            title="Brak dostepu"
            description="Skontaktuj sie z administratorem, aby otrzymac dostep do modulow."
          />
        ) : visibleCount === 0 ? (
          <EmptyState
            title="Brak wynikow"
            description="Zmien fraze wyszukiwania albo wyczysc filtr."
            actionLabel="Wyczysc filtr"
            onAction={() => setSearch('')}
          />
        ) : (
          <>
            {filteredModules.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-dim">
                    Moduly robocze
                  </h2>
                  <span className="text-xs text-dim">{filteredModules.length} szt.</span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredModules.map((module) => {
                    const Icon = module.icon;
                    return (
                      <Card key={module.id} className="flex h-full flex-col gap-4">
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
                <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface2">
                      <Shield className="h-5 w-5 text-brand" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-title">Panel administratora</h3>
                      <p className="text-sm text-dim">
                        Konfiguracja kont, uprawnien i ustawien systemowych.
                      </p>
                    </div>
                  </div>
                  <Button onClick={openAdmin} className="w-full md:w-auto md:px-8">
                    Wejdz
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
