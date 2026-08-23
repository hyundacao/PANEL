'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  CalendarDays,
  ClipboardCheck,
  ListChecks,
  Plus,
  RotateCcw,
  Settings2,
  Trash2
} from 'lucide-react';
import {
  getPaintTapeInventoryCatalogAdmin,
  getPaintTapeInventorySessionsAdmin,
  removePaintTapeInventorySession,
  setPaintTapeInventoryCatalogItemActive
} from '@/lib/api';
import { isWarehouseAdmin } from '@/lib/auth/access';
import { useUiStore } from '@/lib/store/ui';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SearchInput } from '@/components/ui/SearchInput';
import { useToastStore } from '@/components/ui/Toast';
import { cn } from '@/lib/utils/cn';

type CatalogStatus = 'ACTIVE' | 'ARCHIVED';
type ManagementView = 'CATALOG' | 'INVENTORIES';

const normalizeSearch = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const categoryLabels = {
  FARBY: 'Farba',
  FOLIE: 'Folia',
  ROZCIENCZALNIKI: 'Rozcieńczalnik',
  TASMY: 'Taśma',
  DODATKI: 'Dodatek'
} as const;

const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
};

export default function PaintTapeInventoryManagementPage() {
  const user = useUiStore((state) => state.user);
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CatalogStatus>('ACTIVE');
  const [managementView, setManagementView] = useState<ManagementView>('CATALOG');
  const canManage = isWarehouseAdmin(user, 'FARBY_TASMY');

  const catalogQuery = useQuery({
    queryKey: ['paint-tape-inventory-catalog-admin'],
    queryFn: getPaintTapeInventoryCatalogAdmin,
    enabled: canManage,
    retry: false
  });
  const sessionsQuery = useQuery({
    queryKey: ['paint-tape-inventory-sessions-admin'],
    queryFn: getPaintTapeInventorySessionsAdmin,
    enabled: canManage && managementView === 'INVENTORIES',
    retry: false
  });

  const statusMutation = useMutation({
    mutationFn: setPaintTapeInventoryCatalogItemActive,
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory-catalog-admin'] });
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({
        title: item.isActive ? 'Pozycja została przywrócona' : 'Pozycja została zarchiwizowana',
        description: item.name,
        tone: 'success'
      });
    },
    onError: () =>
      toast({
        title: 'Nie udało się zmienić pozycji',
        description: 'Sprawdź uprawnienia administratora i połączenie z bazą.',
        tone: 'error'
      })
  });

  const removeSessionMutation = useMutation({
    mutationFn: removePaintTapeInventorySession,
    onSuccess: (removed) => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory-sessions-admin'] });
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({
        title: 'Spis został trwale usunięty',
        description: formatDate(removed.inventoryDate),
        tone: 'success'
      });
    },
    onError: () =>
      toast({
        title: 'Nie udało się usunąć spisu',
        description: 'Sprawdź uprawnienia administratora i połączenie z bazą.',
        tone: 'error'
      })
  });

  const catalog = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);
  const activeCount = catalog.filter((item) => item.isActive).length;
  const archivedCount = catalog.length - activeCount;
  const filteredCatalog = useMemo(() => {
    const needle = normalizeSearch(query);
    const tokens = needle.split(' ').filter(Boolean);
    return catalog.filter((item) => {
      if (status === 'ACTIVE' && !item.isActive) return false;
      if (status === 'ARCHIVED' && item.isActive) return false;
      if (tokens.length === 0) return true;
      const haystack = normalizeSearch(`${item.name} ${item.itemIndex} ${item.itemCode ?? ''}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [catalog, query, status]);

  const handleArchive = (id: string, name: string) => {
    if (
      !window.confirm(
        `Zarchiwizować „${name}”? Pozycja zniknie z bieżącego i kolejnych spisów, ale jej historia pozostanie zapisana.`
      )
    ) {
      return;
    }
    statusMutation.mutate({ id, isActive: false });
  };

  const handleRemoveSession = (id: string, inventoryDate: string, checkedCount: number) => {
    if (
      !window.confirm(
        `Trwale usunąć cały spis z ${formatDate(inventoryDate)} wraz z ${checkedCount} zapisanymi pozycjami? Tej operacji nie można cofnąć.`
      )
    ) {
      return;
    }
    removeSessionMutation.mutate(id);
  };

  if (!canManage) {
    return (
      <EmptyState
        title="Brak uprawnień"
        description="Zarządzanie katalogiem jest dostępne tylko dla administratora modułu farb i taśm."
      />
    );
  }

  return (
    <div className="w-full max-w-none space-y-4 max-md:-mx-4 max-md:w-[calc(100%+2rem)]">
      <Card className="space-y-4 max-md:rounded-none max-md:border-x-0 max-md:px-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-[var(--brand)]" />
              <h1 className="text-lg font-black text-title">Zarządzanie spisem</h1>
            </div>
            <p className="mt-1 text-sm text-dim">
              {managementView === 'CATALOG'
                ? 'Zarządzaj listą pozycji dostępnych podczas spisu.'
                : 'Przeglądaj i usuwaj zapisane spisy.'}
            </p>
          </div>
          {managementView === 'CATALOG' && <Button asChild variant="secondary" className="min-h-[44px] px-4">
            <Link href="/spis-farb-tasm">
              <Plus className="mr-2 h-4 w-4" />
              Dodaj z kartoteki
            </Link>
          </Button>}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-black/25 p-1">
          <button
            type="button"
            onClick={() => setManagementView('CATALOG')}
            className={cn(
              'flex min-h-[48px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition',
              managementView === 'CATALOG'
                ? 'border-[rgba(255,122,26,0.55)] bg-[rgba(255,122,26,0.13)] text-orange-200 shadow-[inset_0_-2px_0_rgba(255,122,26,0.7)]'
                : 'border-transparent bg-transparent text-muted hover:bg-white/[0.035] hover:text-title'
            )}
          >
            <ListChecks className="h-4 w-4" />
            Katalog farb i taśm
          </button>
          <button
            type="button"
            onClick={() => setManagementView('INVENTORIES')}
            className={cn(
              'flex min-h-[48px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition',
              managementView === 'INVENTORIES'
                ? 'border-[rgba(255,122,26,0.55)] bg-[rgba(255,122,26,0.13)] text-orange-200 shadow-[inset_0_-2px_0_rgba(255,122,26,0.7)]'
                : 'border-transparent bg-transparent text-muted hover:bg-white/[0.035] hover:text-title'
            )}
          >
            <CalendarDays className="h-4 w-4" />
            Zapisane spisy
          </button>
        </div>

        {managementView === 'CATALOG' && <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[11px] font-black uppercase text-dim">Pokaż pozycje</span>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-black/25 p-1 sm:w-[360px]">
          <button
            type="button"
            onClick={() => setStatus('ACTIVE')}
            className={cn(
              'flex min-h-[38px] items-center justify-center gap-2 rounded-md border px-3 text-xs font-bold transition',
              status === 'ACTIVE'
                ? 'border-emerald-500/45 bg-emerald-500/[0.09] text-emerald-300'
                : 'border-transparent text-muted hover:bg-white/[0.035] hover:text-title'
            )}
          >
            <ClipboardCheck className="h-4 w-4" />
            Aktywne
            <span className="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-xs tabular-nums text-white">
              {activeCount}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setStatus('ARCHIVED')}
            className={cn(
              'flex min-h-[38px] items-center justify-center gap-2 rounded-md border px-3 text-xs font-bold transition',
              status === 'ARCHIVED'
                ? 'border-slate-400/35 bg-slate-400/[0.08] text-slate-200'
                : 'border-transparent text-muted hover:bg-white/[0.035] hover:text-title'
            )}
          >
            <Archive className="h-4 w-4" />
            Ukryte
            <span className="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-xs tabular-nums text-white">
              {archivedCount}
            </span>
          </button>
          </div>
        </div>}

        {managementView === 'CATALOG' && <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          clearable
          placeholder="Wpisz nazwę, indeks lub kod"
          className="min-h-[50px]"
        />}
      </Card>

      {managementView === 'CATALOG' ? <Card className="overflow-hidden p-0 max-md:rounded-none max-md:border-x-0 md:p-0">
        {catalogQuery.isLoading ? (
          <p className="p-5 text-sm text-dim">Wczytywanie katalogu...</p>
        ) : catalogQuery.isError ? (
          <EmptyState
            title="Nie udało się pobrać katalogu"
            description="Sprawdź połączenie z bazą i uprawnienia administratora."
          />
        ) : filteredCatalog.length === 0 ? (
          <EmptyState
            title={status === 'ACTIVE' ? 'Brak aktywnych pozycji' : 'Brak pozycji archiwalnych'}
            description="Zmień wyszukiwanie lub wybierz drugą zakładkę."
          />
        ) : (
          filteredCatalog.map((item) => {
            const pending = statusMutation.isPending && statusMutation.variables?.id === item.id;
            return (
              <div
                key={item.id}
                className="flex flex-col gap-3 border-b border-border px-2 py-4 last:border-b-0 sm:flex-row sm:items-center sm:px-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-base font-black leading-snug text-[var(--brand)]">
                    {item.name}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-dim">
                    <span>Indeks {item.itemIndex}</span>
                    {item.itemCode && <span>Kod {item.itemCode}</span>}
                    <span>{item.unit}</span>
                    <Badge tone={item.isActive ? 'success' : 'warning'}>
                      {categoryLabels[item.category]}
                    </Badge>
                  </div>
                </div>
                {item.isActive ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleArchive(item.id, item.name)}
                    disabled={pending}
                    className="min-h-[42px] shrink-0 border-rose-500/35 px-3 text-rose-300 hover:border-rose-400/60"
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    Archiwizuj
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => statusMutation.mutate({ id: item.id, isActive: true })}
                    disabled={pending}
                    className="min-h-[42px] shrink-0 border-emerald-500/35 px-3 text-emerald-300 hover:border-emerald-400/60"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Przywróć
                  </Button>
                )}
              </div>
            );
          })
        )}
      </Card> : <Card className="overflow-hidden p-0 max-md:rounded-none max-md:border-x-0 md:p-0">
        {sessionsQuery.isLoading ? (
          <p className="p-5 text-sm text-dim">Wczytywanie zapisanych spisów...</p>
        ) : sessionsQuery.isError ? (
          <EmptyState
            title="Nie udało się pobrać spisów"
            description="Sprawdź połączenie z bazą i uprawnienia administratora."
          />
        ) : (sessionsQuery.data ?? []).length === 0 ? (
          <EmptyState title="Brak zapisanych spisów" description="Nie utworzono jeszcze żadnego spisu." />
        ) : (
          (sessionsQuery.data ?? []).map((inventorySession) => {
            const pending =
              removeSessionMutation.isPending &&
              removeSessionMutation.variables === inventorySession.id;
            return (
              <div
                key={inventorySession.id}
                className="flex flex-col gap-3 border-b border-border px-2 py-4 last:border-b-0 sm:flex-row sm:items-center sm:px-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-base font-black text-title">
                    Spis z {formatDate(inventorySession.inventoryDate)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-dim">
                    <Badge tone={inventorySession.status === 'CLOSED' ? 'success' : 'warning'}>
                      {inventorySession.status === 'CLOSED' ? 'Zamknięty' : 'W trakcie'}
                    </Badge>
                    <span>{inventorySession.checkedCount} zapisanych pozycji</span>
                    <span>Utworzył: {inventorySession.createdBy}</span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    handleRemoveSession(
                      inventorySession.id,
                      inventorySession.inventoryDate,
                      inventorySession.checkedCount
                    )
                  }
                  disabled={pending}
                  className="min-h-[42px] shrink-0 border-rose-500/45 px-3 text-rose-300 hover:border-rose-400/70 hover:bg-rose-500/10"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Usuń cały spis
                </Button>
              </div>
            );
          })
        )}
      </Card>}
    </div>
  );
}
