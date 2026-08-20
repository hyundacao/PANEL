'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  CircleCheckBig,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  History,
  Layers3,
  LayoutGrid,
  ListChecks,
  LockKeyhole,
  Package,
  PackagePlus,
  Palette,
  Plus,
  RotateCcw,
  Shapes,
  Trash2
} from 'lucide-react';
import {
  addPaintTapeInventoryCatalogItem,
  closePaintTapeInventorySession,
  getOriginalInventoryCatalog,
  getPaintTapeInventory,
  removePaintTapeInventoryEntry,
  reopenPaintTapeInventorySession,
  savePaintTapeInventoryEntry
} from '@/lib/api';
import type {
  PaintTapeInventoryCategory,
  PaintTapeInventoryCatalogItem,
  PaintTapeInventoryEntry,
  OriginalInventoryCatalogEntry
} from '@/lib/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { useToastStore } from '@/components/ui/Toast';
import { cn } from '@/lib/utils/cn';

type InventoryView = 'CURRENT' | 'HISTORY';
type CompletionFilter = 'ALL' | 'PENDING' | 'DONE';
type InventoryDraft = { qty: string };
type CatalogSourceOption = OriginalInventoryCatalogEntry & { itemCode: string };

const categories = [
  { value: 'ALL', label: 'Wszystkie', icon: LayoutGrid },
  { value: 'FARBY', label: 'Farby', icon: Palette },
  { value: 'FOLIE', label: 'Folie', icon: Layers3 },
  { value: 'ROZCIENCZALNIKI', label: 'Rozcieńczalniki', icon: FlaskConical },
  { value: 'TASMY', label: 'Taśmy', icon: Package },
  { value: 'DODATKI', label: 'Dodatki', icon: Shapes }
] satisfies Array<{
  value: 'ALL' | PaintTapeInventoryCategory;
  label: string;
  icon: typeof LayoutGrid;
}>;

const completionFilters: Array<{
  value: CompletionFilter;
  label: string;
  icon: typeof LayoutGrid;
  glowClass: string;
  activeClass: string;
}> = [
  {
    value: 'ALL',
    label: 'Wszystkie',
    icon: Boxes,
    glowClass: '',
    activeClass: 'border-[rgba(255,122,26,0.7)] text-orange-200'
  },
  {
    value: 'PENDING',
    label: 'Do wpisania',
    icon: Clock3,
    glowClass: 'paint-inventory-button-amber',
    activeClass: 'border-amber-500/55 text-amber-200'
  },
  {
    value: 'DONE',
    label: 'Gotowe',
    icon: CircleCheckBig,
    glowClass: 'paint-inventory-button-green',
    activeClass: 'border-emerald-500/55 text-emerald-300'
  }
];

const categoryLabels: Record<PaintTapeInventoryCategory, string> = {
  FARBY: 'Farba',
  FOLIE: 'Folia',
  ROZCIENCZALNIKI: 'Rozcieńczalnik',
  TASMY: 'Taśma',
  DODATKI: 'Dodatek'
};

const inferInventoryCategory = (name: string): PaintTapeInventoryCategory => {
  const normalized = normalizeSearch(name);
  if (normalized.includes('rozciencz')) return 'ROZCIENCZALNIKI';
  if (normalized.includes('folia') || normalized.includes('foli ')) return 'FOLIE';
  if (normalized.includes('tasma') || normalized.includes('tasm ')) return 'TASMY';
  if (normalized.includes('farba') || normalized.includes('lakier')) return 'FARBY';
  return 'DODATKI';
};

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
};

const normalizeSearch = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const parseQuantity = (value: string) => {
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const formatQuantity = (value: number) =>
  value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });

export function PaintTapeInventoryPanel({ readOnly }: { readOnly: boolean }) {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const today = getLocalDateValue();
  const [view, setView] = useState<InventoryView>('CURRENT');
  const [selectedDate, setSelectedDate] = useState(today);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'ALL' | PaintTapeInventoryCategory>('ALL');
  const [completion, setCompletion] = useState<CompletionFilter>('ALL');
  const [drafts, setDrafts] = useState<Record<string, InventoryDraft>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showCatalogSuggestions, setShowCatalogSuggestions] = useState(false);

  const inventoryQuery = useQuery({
    queryKey: ['paint-tape-inventory', selectedDate],
    queryFn: () => getPaintTapeInventory(selectedDate),
    retry: false
  });
  const sourceCatalogQuery = useQuery({
    queryKey: ['spis-oryginalow-catalog-local'],
    queryFn: getOriginalInventoryCatalog,
    enabled: showAddForm && !readOnly,
    retry: false
  });
  const data = inventoryQuery.data;
  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const catalog = useMemo(() => data?.catalog ?? [], [data?.catalog]);
  const session = data?.session ?? null;
  const locked = readOnly || session?.status === 'CLOSED' || view === 'HISTORY';

  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, PaintTapeInventoryEntry[]>();
    entries.forEach((entry) => {
      const itemEntries = grouped.get(entry.catalogItemId) ?? [];
      itemEntries.push(entry);
      grouped.set(entry.catalogItemId, itemEntries);
    });
    return grouped;
  }, [entries]);
  const checkedItemCount = entriesByItem.size;
  const existingCatalogIndexes = useMemo(
    () => new Set(catalog.map((item) => item.itemIndex.trim().toLowerCase())),
    [catalog]
  );
  const sourceCatalogOptions = useMemo(() => {
    const groups = new Map<string, OriginalInventoryCatalogEntry[]>();
    (sourceCatalogQuery.data ?? []).forEach((item) => {
      const key = normalizeSearch(item.name);
      if (!key) return;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });

    return [...groups.values()].map((items): CatalogSourceOption => {
      const preferred = [...items].sort((left, right) => {
        const score = (item: OriginalInventoryCatalogEntry) =>
          (item.warehouseCode ? 10_000 : 0) +
          (item.indexCode?.includes('-') ? 1_000 : 0) +
          (item.indexCode?.length ?? 0);
        return score(right) - score(left);
      })[0];
      const codeEntry = items.find(
        (item) => !item.warehouseCode && item.id !== preferred.id && item.indexCode?.trim()
      );
      return {
        ...preferred,
        itemCode: codeEntry?.indexCode?.trim() ?? preferred.indexCode?.trim() ?? ''
      };
    });
  }, [sourceCatalogQuery.data]);
  const sourceSuggestions = useMemo(() => {
    const needle = normalizeSearch(catalogSearch);
    if (needle.length < 2) return [];
    return sourceCatalogOptions
      .filter((item) => {
        const indexCode = item.indexCode?.trim().toLowerCase();
        return (
          Boolean(indexCode) &&
          !existingCatalogIndexes.has(indexCode ?? '') &&
          normalizeSearch(item.name).includes(needle)
        );
      })
      .slice(0, 15);
  }, [catalogSearch, existingCatalogIndexes, sourceCatalogOptions]);

  const filteredCatalog = useMemo(() => {
    const needle = normalizeSearch(query);
    const tokens = needle.split(' ').filter(Boolean);
    return catalog.filter((item) => {
      const itemEntries = entriesByItem.get(item.id) ?? [];
      if (category !== 'ALL' && item.category !== category) return false;
      if (completion === 'PENDING' && itemEntries.length > 0) return false;
      if (completion === 'DONE' && itemEntries.length === 0) return false;
      if (tokens.length === 0) return true;
      const haystack = normalizeSearch(`${item.itemIndex} ${item.itemCode ?? ''} ${item.name}`);
      return tokens.every((token) => haystack.includes(token));
    });
  }, [catalog, category, completion, entriesByItem, query]);

  const saveMutation = useMutation({
    mutationFn: ({ item, draft }: { item: PaintTapeInventoryCatalogItem; draft: InventoryDraft }) => {
      const qty = parseQuantity(draft.qty);
      if (qty === null) throw new Error('QTY_REQUIRED');
      return savePaintTapeInventoryEntry({
        dateKey: selectedDate,
        catalogItemId: item.id,
        qty
      });
    },
    onSuccess: (_, variables) => {
      const draftKey = `${selectedDate}:${variables.item.id}`;
      setDrafts((current) => ({
        ...current,
        [draftKey]: { qty: '' }
      }));
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: `Dodano pomiar: ${variables.item.name}`, tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się zapisać pozycji',
        description:
          error.message === 'QTY_REQUIRED'
            ? 'Wpisz poprawną ilość, także 0.'
            : error.message === 'INVENTORY_SESSION_CLOSED'
              ? 'Ten spis jest już zamknięty.'
              : 'Sprawdź połączenie z bazą.',
        tone: 'error'
      });
    }
  });

  const removeEntryMutation = useMutation({
    mutationFn: removePaintTapeInventoryEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: 'Pomiar został usunięty', tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się usunąć pomiaru',
        description:
          error.message === 'INVENTORY_SESSION_CLOSED'
            ? 'Najpierw otwórz ponownie ten spis.'
            : 'Sprawdź połączenie z bazą.',
        tone: 'error'
      });
    }
  });

  const addItemMutation = useMutation({
    mutationFn: addPaintTapeInventoryCatalogItem,
    onSuccess: () => {
      setCatalogSearch('');
      setShowCatalogSuggestions(false);
      setShowAddForm(false);
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: 'Dodano nową pozycję do listy', tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się dodać pozycji',
        description:
          error.message === 'ITEM_INDEX_EXISTS'
            ? 'Pozycja z takim indeksem już istnieje.'
            : 'Uzupełnij indeks i nazwę.',
        tone: 'error'
      });
    }
  });

  const handleAddCatalogItem = (item: CatalogSourceOption) => {
    const itemIndex = item.indexCode?.trim();
    if (!itemIndex) {
      toast({
        title: 'Nie można dodać tej pozycji',
        description: 'Wybrana kartoteka nie ma indeksu.',
        tone: 'error'
      });
      return;
    }
    addItemMutation.mutate({
      itemIndex,
      itemCode: item.itemCode,
      name: item.name,
      category: inferInventoryCategory(item.name),
      unit: item.unit || 'kg'
    });
  };

  const closeMutation = useMutation({
    mutationFn: closePaintTapeInventorySession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: 'Spis został zamknięty', tone: 'success' });
    },
    onError: () => toast({ title: 'Nie udało się zamknąć spisu', tone: 'error' })
  });

  const reopenMutation = useMutation({
    mutationFn: reopenPaintTapeInventorySession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: 'Spis został ponownie otwarty', tone: 'success' });
    },
    onError: () => toast({ title: 'Nie udało się otworzyć spisu', tone: 'error' })
  });

  const updateDraft = (itemId: string, patch: Partial<InventoryDraft>) => {
    const draftKey = `${selectedDate}:${itemId}`;
    setDrafts((current) => ({
      ...current,
      [draftKey]: {
        qty: current[draftKey]?.qty ?? '',
        ...patch
      }
    }));
  };

  const handleSave = (item: PaintTapeInventoryCatalogItem) => {
    const draftKey = `${selectedDate}:${item.id}`;
    saveMutation.mutate({
      item,
      draft: drafts[draftKey] ?? { qty: '' }
    });
  };

  const handleClose = () => {
    if (!session) return;
    const missing = Math.max(0, catalog.length - checkedItemCount);
    if (
      missing > 0 &&
      !window.confirm(`Nieuzupełnione pozycje: ${missing}. Zamknąć spis mimo to?`)
    ) {
      return;
    }
    closeMutation.mutate(selectedDate);
  };

  const progress = catalog.length > 0 ? Math.round((checkedItemCount / catalog.length) * 100) : 0;
  const migrationRequired =
    inventoryQuery.error instanceof Error &&
    inventoryQuery.error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY';

  const renderInventoryRow = (item: PaintTapeInventoryCatalogItem) => {
    const itemEntries = entriesByItem.get(item.id) ?? [];
    const totalQty = itemEntries.reduce((sum, entry) => sum + entry.qty, 0);
    const hasEntries = itemEntries.length > 0;
    const draftKey = `${selectedDate}:${item.id}`;
    const draft = drafts[draftKey] ?? { qty: '' };
    const isSaving = saveMutation.isPending && saveMutation.variables?.item.id === item.id;
    return (
      <div
        key={item.id}
        className={cn(
          'grid gap-3 border-b border-[rgba(255,255,255,0.09)] px-3 py-4 last:border-b-0 sm:px-4',
          locked
            ? 'lg:grid-cols-1'
            : 'lg:grid-cols-[minmax(280px,1fr)_150px_52px] lg:items-center',
          hasEntries && 'bg-[rgba(35,190,105,0.035)]'
        )}
      >
        <div className="min-w-0">
          <p className="break-words text-base font-black leading-snug text-[var(--brand)]">
            {item.name}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-semibold text-dim">
            <span>Indeks {item.itemIndex}</span>
            {item.itemCode && <span>Kod {item.itemCode}</span>}
            <Badge tone={hasEntries ? 'success' : 'default'}>{categoryLabels[item.category]}</Badge>
          </div>
          {hasEntries && (
            <p className="mt-2 text-sm font-black text-emerald-400">
              Suma: {formatQuantity(totalQty)} {item.unit}
              <span className="ml-2 text-[11px] font-semibold text-dim">
                ({itemEntries.length} {itemEntries.length === 1 ? 'pomiar' : 'pomiary'})
              </span>
            </p>
          )}
        </div>
        {!locked && (
          <>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-dim lg:hidden">Dopisz ilość</label>
              <div className="relative">
                <Input
                  value={draft.qty}
                  onChange={(event) => updateDraft(item.id, { qty: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSave(item);
                    }
                  }}
                  inputMode="decimal"
                  placeholder="0"
                  className="min-h-[48px] pr-12 text-base font-black tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-dim">
                  {item.unit}
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="primaryEmber"
              onClick={() => handleSave(item)}
              disabled={isSaving || parseQuantity(draft.qty) === null}
              className="min-h-[48px] w-full px-0 lg:w-[52px]"
              aria-label="Dodaj kolejny pomiar"
              title="Dodaj kolejny pomiar"
            >
              <Plus className="h-5 w-5" />
            </Button>
          </>
        )}
        {hasEntries && (
          <div className="space-y-1.5 border-t border-[rgba(255,255,255,0.08)] pt-3 lg:col-span-full">
            {itemEntries.map((entry, index) => (
              <div
                key={entry.id}
                className="flex min-w-0 items-start gap-2 rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-xs"
              >
                <span className="shrink-0 font-black tabular-nums text-title">
                  {index + 1}. {formatQuantity(entry.qty)} {item.unit}
                </span>
                <span className="min-w-0 flex-1 break-words text-dim">
                  {entry.checkedBy} · {new Date(entry.checkedAt).toLocaleString('pl-PL')}
                </span>
                {!locked && (
                  <button
                    type="button"
                    onClick={() => removeEntryMutation.mutate(entry.id)}
                    disabled={removeEntryMutation.isPending}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-rose-400 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-40"
                    aria-label={`Usuń pomiar ${formatQuantity(entry.qty)} ${item.unit}`}
                    title="Usuń błędny pomiar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-[rgba(255,255,255,0.025)] p-1">
        <button
          type="button"
          onClick={() => {
            setView('CURRENT');
            setSelectedDate(today);
          }}
          className={cn(
            'paint-inventory-button flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition',
            view === 'CURRENT'
              ? 'paint-inventory-button-active border-[rgba(255,122,26,0.55)] text-orange-200'
              : 'border-transparent text-muted hover:text-title'
          )}
        >
          <ListChecks className="h-4 w-4" />
          Bieżący spis
        </button>
        <button
          type="button"
          onClick={() => {
            setView('HISTORY');
            const latest = data?.sessions[0]?.inventoryDate;
            if (latest) setSelectedDate(latest);
          }}
          className={cn(
            'paint-inventory-button paint-inventory-button-purple flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition',
            view === 'HISTORY'
              ? 'paint-inventory-button-active border-purple-500/50 text-purple-100'
              : 'border-transparent text-muted hover:text-title'
          )}
        >
          <History className="h-4 w-4" />
          Historia
        </button>
      </div>

      {migrationRequired ? (
        <Card className="border-[rgba(230,70,70,0.45)] bg-[rgba(120,20,20,0.12)]">
          <p className="font-black text-danger">Spis wymaga utworzenia tabel w Supabase.</p>
          <p className="mt-2 text-sm text-body">
            Uruchom plik <span className="font-mono">supabase/migrate_paint_tape_inventory.sql</span> w SQL Editor.
          </p>
        </Card>
      ) : view === 'HISTORY' ? (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="p-0 md:p-0">
            <div className="border-b border-border px-4 py-4">
              <p className="font-black text-title">Historia spisów</p>
              <p className="mt-1 text-xs text-dim">Każdy dzień zachowuje własne ilości i osoby.</p>
            </div>
            {data?.sessions.length ? (
              <div className="max-h-[70vh] overflow-y-auto">
                {data.sessions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedDate(item.inventoryDate)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left transition last:border-b-0 hover:bg-[rgba(255,255,255,0.045)]',
                      selectedDate === item.inventoryDate && 'bg-[rgba(255,122,26,0.10)]'
                    )}
                  >
                    <div>
                      <p className="font-black text-title">{formatDate(item.inventoryDate)}</p>
                      <p className="text-xs text-dim">
                        {item.checkedCount} / {item.expectedCount} pozycji
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={item.status === 'CLOSED' ? 'success' : 'warning'}>
                        {item.status === 'CLOSED' ? 'Zamknięty' : 'Otwarty'}
                      </Badge>
                      <ChevronRight className="h-4 w-4 text-dim" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="Brak historii" description="Historia pojawi się po zapisaniu pierwszej pozycji." />
            )}
          </Card>

          <Card className="p-0 md:p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <p className="font-black text-title">Spis z dnia {formatDate(selectedDate)}</p>
                <p className="text-xs text-dim">
                  Zapisane pozycje: {checkedItemCount} · pomiary: {entries.length}
                </p>
              </div>
              {session?.status === 'CLOSED' && !readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => reopenMutation.mutate(selectedDate)}
                  disabled={reopenMutation.isPending}
                  className="paint-inventory-button paint-inventory-button-purple paint-inventory-button-active min-h-[44px] border-purple-500/35 px-4 text-title hover:border-purple-400/55"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Otwórz ponownie
                </Button>
              )}
            </div>
            {inventoryQuery.isLoading ? (
              <p className="p-4 text-sm text-dim">Wczytywanie...</p>
            ) : entries.length === 0 ? (
              <EmptyState title="Brak zapisanych pozycji" description="Tego dnia nie rozpoczęto spisu." />
            ) : (
              catalog.filter((item) => entriesByItem.has(item.id)).map(renderInventoryRow)
            )}
          </Card>
        </div>
      ) : (
        <>
          <Card className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <ClipboardCheck className="h-5 w-5 text-[var(--brand)]" />
                  <h2 className="text-lg font-black text-title">Spis farb i taśm</h2>
                  <Badge tone={session?.status === 'CLOSED' ? 'success' : 'warning'}>
                    {session?.status === 'CLOSED' ? 'Zamknięty' : 'W trakcie'}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-dim">
                  {formatDate(selectedDate)} · {checkedItemCount} z {catalog.length} pozycji · {entries.length} pomiarów
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {!readOnly && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShowAddForm((current) => !current)}
                    className="paint-inventory-button paint-inventory-button-active min-h-[44px] border-[rgba(255,122,26,0.42)] px-4 text-orange-100"
                  >
                    <PackagePlus className="mr-2 h-4 w-4" />
                    Dodaj pozycję
                  </Button>
                )}
                {session?.status === 'OPEN' && !readOnly && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={closeMutation.isPending}
                    className="paint-inventory-button paint-inventory-button-amber paint-inventory-button-active min-h-[44px] border-amber-500/35 px-4 text-title hover:border-amber-400/55"
                  >
                    <LockKeyhole className="mr-2 h-4 w-4" />
                    Zakończ spis
                  </Button>
                )}
              </div>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#ff6a00,#ffb35c)] transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </Card>

          {showAddForm && !readOnly && (
            <Card className="border-[rgba(255,122,26,0.35)]">
              <div className="mb-4 flex items-center gap-2">
                <PackagePlus className="h-5 w-5 text-[var(--brand)]" />
                <div>
                  <p className="font-black text-title">Dodaj z kartoteki</p>
                  <p className="mt-0.5 text-xs text-dim">
                    Wyszukaj po nazwie. Indeks, kod i jednostka zostaną pobrane automatycznie.
                  </p>
                </div>
              </div>
              <div className="relative max-w-4xl">
                <SearchInput
                  value={catalogSearch}
                  onChange={(event) => {
                    setCatalogSearch(event.target.value);
                    setShowCatalogSuggestions(true);
                  }}
                  onFocus={() => setShowCatalogSuggestions(true)}
                  onBlur={() => window.setTimeout(() => setShowCatalogSuggestions(false), 160)}
                  onClear={() => setCatalogSearch('')}
                  clearable
                  autoComplete="off"
                  placeholder="Wpisz nazwę farby, lakieru, folii lub taśmy"
                  className="min-h-[50px] text-base"
                />
                {showCatalogSuggestions && catalogSearch.trim().length >= 2 && (
                  <div className="absolute z-30 mt-2 max-h-[360px] w-full overflow-y-auto rounded-xl border border-border bg-[#0c0e13] p-1.5 shadow-[0_22px_50px_rgba(0,0,0,0.55)]">
                    {sourceCatalogQuery.isLoading ? (
                      <p className="px-3 py-4 text-sm text-dim">Wczytywanie kartoteki...</p>
                    ) : sourceCatalogQuery.isError ? (
                      <p className="px-3 py-4 text-sm text-rose-300">Nie udało się pobrać kartoteki.</p>
                    ) : sourceSuggestions.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-dim">
                        Brak nowych pozycji pasujących do tej nazwy.
                      </p>
                    ) : (
                      sourceSuggestions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleAddCatalogItem(item)}
                          disabled={addItemMutation.isPending}
                          className="flex min-h-[58px] w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition hover:border-[rgba(255,122,26,0.35)] hover:bg-[rgba(255,122,26,0.07)] disabled:opacity-50"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-black text-title">{item.name}</span>
                            <span className="mt-1 block text-[11px] font-semibold text-dim">
                              Indeks: {item.indexCode}
                              {item.itemCode ? ` · Kod: ${item.itemCode}` : ''}
                              {` · ${item.unit}`}
                            </span>
                          </span>
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(255,122,26,0.4)] bg-[rgba(255,122,26,0.09)] text-[var(--brand)]">
                            <Plus className="h-4 w-4" />
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card className="space-y-3">
            <SearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery('')}
              clearable
              placeholder="Wpisz nazwę farby, folii lub taśmy"
              className="min-h-[50px]"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {categories.map((item) => {
                const CategoryIcon = item.icon;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setCategory(item.value)}
                    className={cn(
                      'paint-inventory-button flex min-h-[42px] min-w-0 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-bold transition',
                      category === item.value
                        ? 'paint-inventory-button-active border-[rgba(255,122,26,0.62)] text-orange-200'
                        : 'border-border text-muted hover:border-white/20 hover:text-title'
                    )}
                  >
                    <CategoryIcon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {completionFilters.map((item) => {
                const FilterIcon = item.icon;
                const count =
                  item.value === 'ALL'
                    ? catalog.length
                    : item.value === 'PENDING'
                      ? Math.max(0, catalog.length - checkedItemCount)
                      : checkedItemCount;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setCompletion(item.value)}
                    className={cn(
                      'paint-inventory-button flex min-h-[46px] min-w-0 items-center justify-center gap-2 rounded-lg border px-2 text-xs font-bold transition sm:text-sm',
                      item.glowClass,
                      completion === item.value
                        ? cn('paint-inventory-button-active', item.activeClass)
                        : 'border-border text-muted hover:border-white/20 hover:text-title'
                    )}
                  >
                    <FilterIcon className="hidden h-4 w-4 shrink-0 sm:block" />
                    <span className="truncate">{item.label}</span>
                    <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-black/25 px-1.5 text-[11px] tabular-nums text-white">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="overflow-hidden p-0 md:p-0">
            <div className="hidden grid-cols-[minmax(280px,1fr)_150px_52px] gap-3 border-b border-border bg-[rgba(255,255,255,0.035)] px-4 py-3 text-[10px] font-black uppercase text-dim lg:grid">
              <span>Nazwa i suma</span><span>Dopisz ilość</span><span />
            </div>
            {inventoryQuery.isLoading ? (
              <p className="p-5 text-sm text-dim">Wczytywanie listy...</p>
            ) : filteredCatalog.length === 0 ? (
              <EmptyState title="Brak pozycji" description="Zmień wyszukiwanie lub filtr." />
            ) : (
              filteredCatalog.map(renderInventoryRow)
            )}
          </Card>
        </>
      )}
    </div>
  );
}
