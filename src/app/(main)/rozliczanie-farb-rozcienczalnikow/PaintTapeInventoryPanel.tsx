'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  Check,
  CircleCheckBig,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  FileDown,
  History,
  Layers3,
  LayoutGrid,
  ListChecks,
  LoaderCircle,
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
  getOriginalInventoryErpSnapshot,
  getPaintTapeInventory,
  getPaintTapeInventoryComments,
  removePaintTapeInventoryEntry,
  removePaintTapeInventorySession,
  reopenPaintTapeInventorySession,
  savePaintTapeInventoryEntry,
  updatePaintTapeInventoryEntry
} from '@/lib/api';
import type {
  PaintTapeInventoryCategory,
  PaintTapeInventoryCatalogItem,
  PaintTapeInventoryData,
  PaintTapeInventoryEntry,
  PaintTapeInventorySession,
  OriginalInventoryCatalogEntry
} from '@/lib/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { SearchInput } from '@/components/ui/SearchInput';
import { useToastStore } from '@/components/ui/Toast';
import { getPaintTapePermissions, isHeadAdmin } from '@/lib/auth/access';
import { PaintTapeInventoryComment } from './PaintTapeInventoryComment';
import { useUiStore } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';
import { buildPaintTapeInventoryErpLookup, findPaintTapeInventoryErpSnapshot } from '@/lib/utils/paintTapeInventoryErp';

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

const normalizeUnit = (value: string) => {
  const normalized = normalizeSearch(value).replace(/[.\s]/g, '');
  if (['l', 'litr', 'litry', 'litrow'].includes(normalized)) return 'l';
  if (['szt', 'sztuka', 'sztuki', 'sztuk'].includes(normalized)) return 'szt';
  return normalized;
};

export function PaintTapeInventoryPanel({ readOnly }: { readOnly: boolean }) {
  const user = useUiStore((state) => state.user);
  const canRemoveSessions = !readOnly && isHeadAdmin(user);
  const canViewComments = getPaintTapePermissions(user).inventoryComments;
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const today = getLocalDateValue();
  const [view, setView] = useState<InventoryView>('CURRENT');
  const [selectedDate, setSelectedDate] = useState(today);
  const [lastHistorySessions, setLastHistorySessions] = useState<PaintTapeInventorySession[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'ALL' | PaintTapeInventoryCategory>('ALL');
  const [completion, setCompletion] = useState<CompletionFilter>('ALL');
  const [drafts, setDrafts] = useState<Record<string, InventoryDraft>>({});
  const [entryEditDrafts, setEntryEditDrafts] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [showCatalogSuggestions, setShowCatalogSuggestions] = useState(false);
  const [showInventorySuggestions, setShowInventorySuggestions] = useState(false);
  const [activeInventorySuggestion, setActiveInventorySuggestion] = useState(0);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState(false);
  const exportBusy = useRef(false);

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
  const erpSnapshotQuery = useQuery({
    queryKey: ['original-inventory-erp-snapshot', selectedDate],
    queryFn: () => getOriginalInventoryErpSnapshot(selectedDate),
    enabled: view === 'HISTORY' && inventoryQuery.isSuccess &&
      !(inventoryQuery.data?.session?.status === 'CLOSED' && inventoryQuery.data.comparison),
    retry: false
  });
  const data = inventoryQuery.data;
  const historySessions = data?.sessions ?? lastHistorySessions;
  const selectInventoryDate = (date: string) => {
    if (data?.sessions) setLastHistorySessions(data.sessions);
    setSelectedDate(date);
  };
  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const catalog = useMemo(() => data?.catalog ?? [], [data?.catalog]);
  const session = data?.session ?? null;
  const comparison = data?.comparison;
  const showInventoryComments = view === 'HISTORY' && canViewComments && Boolean(session);
  const commentsQueryKey = ['paint-tape-inventory-comments', user?.id ?? '', session?.id ?? ''];
  const commentsQuery = useQuery({
    queryKey: commentsQueryKey,
    queryFn: () => getPaintTapeInventoryComments(session!.id),
    enabled: showInventoryComments && inventoryQuery.isSuccess,
    retry: false
  });
  const commentsByItem = new Map((commentsQuery.data ?? []).map((comment) => [comment.catalogItemId, comment]));
  const removeSessionMutation = useMutation({
    mutationFn: removePaintTapeInventorySession,
    onSuccess: async (removed) => {
      await queryClient.cancelQueries({ queryKey: ['paint-tape-inventory'] });
      // Remove the deleted day from every cached history before switching dates.
      queryClient.setQueriesData<PaintTapeInventoryData>({ queryKey: ['paint-tape-inventory'] }, (cached) => {
        if (!cached) return cached;
        return {
          ...cached,
          sessions: cached.sessions.filter((item) => item.id !== removed.id),
          ...(cached.session?.id === removed.id ? { session: null, entries: [], comparison: null } : {})
        };
      });
      const remaining = historySessions.filter((item) => item.id !== removed.id);
      setLastHistorySessions(remaining);
      setSelectedDate((current) => current === removed.inventoryDate ? remaining[0]?.inventoryDate ?? today : current);
      setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${removed.inventoryDate}:`))));
      setEntryEditDrafts({});
      setExpandedItems(new Set());
      queryClient.removeQueries({ queryKey: ['paint-tape-inventory-comments', user?.id ?? '', removed.id] });
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory-sessions-admin'] });
      await queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: `Usunięto spis z dnia ${formatDate(removed.inventoryDate)}`, tone: 'success' });
    },
    onError: () => toast({
      title: 'Nie udało się usunąć spisu',
      description: 'Sprawdź uprawnienia administratora i połączenie z bazą.',
      tone: 'error'
    })
  });
  const locked = readOnly || removeSessionMutation.isPending || session?.status === 'CLOSED' || (view === 'HISTORY' && !session);
  const historyGridClass = showInventoryComments
    ? locked
      ? 'lg:grid-cols-[minmax(200px,1fr)_110px_110px_minmax(150px,0.8fr)] 2xl:grid-cols-[minmax(200px,1fr)_100px_100px_minmax(150px,0.8fr)_minmax(200px,0.9fr)]'
      : 'lg:grid-cols-[minmax(160px,1fr)_90px_90px_minmax(120px,0.8fr)_90px_52px] 2xl:grid-cols-[minmax(160px,1fr)_80px_80px_minmax(120px,0.8fr)_90px_52px_minmax(180px,0.9fr)]'
    : locked
      ? 'lg:grid-cols-[minmax(260px,1.25fr)_130px_130px_minmax(190px,0.9fr)]'
      : 'lg:grid-cols-[minmax(240px,1.25fr)_120px_120px_minmax(170px,0.9fr)_130px_52px]';
  const showErpComparison = view === 'HISTORY';
  const isComparisonFrozen = session?.status === 'CLOSED' && Boolean(comparison);
  const isLiveErpMissing = erpSnapshotQuery.isSuccess && erpSnapshotQuery.data.length === 0;

  const entriesByItem = useMemo(() => {
    const grouped = new Map<string, PaintTapeInventoryEntry[]>();
    entries.forEach((entry) => {
      const itemEntries = grouped.get(entry.catalogItemId) ?? [];
      itemEntries.push(entry);
      grouped.set(entry.catalogItemId, itemEntries);
    });
    return grouped;
  }, [entries]);
  const erpSnapshotLookup = useMemo(
    () => buildPaintTapeInventoryErpLookup(erpSnapshotQuery.data ?? []),
    [erpSnapshotQuery.data]
  );
  const archivedComparisonByItem = useMemo(
    () => comparison && (isComparisonFrozen || isLiveErpMissing)
      ? new Map(comparison.rows.map((row) => [row.item.id, row]))
      : null,
    [comparison, isComparisonFrozen, isLiveErpMissing]
  );
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

  const inventorySuggestions = useMemo(() => {
    const needle = normalizeSearch(query);
    if (needle.length < 2) return [];
    const tokens = needle.split(' ').filter(Boolean);

    return catalog
      .filter((item) => {
        const haystack = normalizeSearch(`${item.name} ${item.itemIndex} ${item.itemCode ?? ''}`);
        return tokens.every((token) => haystack.includes(token));
      })
      .sort((left, right) => {
        const leftName = normalizeSearch(left.name);
        const rightName = normalizeSearch(right.name);
        const leftStartsWith = leftName.startsWith(needle);
        const rightStartsWith = rightName.startsWith(needle);
        if (leftStartsWith !== rightStartsWith) return leftStartsWith ? -1 : 1;
        return left.name.localeCompare(right.name, 'pl');
      })
      .slice(0, 12);
  }, [catalog, query]);

  const selectInventorySuggestion = (item: PaintTapeInventoryCatalogItem) => {
    setCategory(item.category);
    setCompletion('ALL');
    setQuery(item.name);
    setShowInventorySuggestions(false);
    setActiveInventorySuggestion(0);
    setHighlightedItemId(item.id);

    window.setTimeout(() => {
      document
        .getElementById(`paint-inventory-item-${item.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });

      if (!locked) {
        window.setTimeout(() => {
          const quantityInput = document.getElementById(
            `paint-inventory-qty-${item.id}`
          ) as HTMLInputElement | null;
          quantityInput?.focus({ preventScroll: true });
          quantityInput?.select();
        }, 350);
      }
    }, 0);

    window.setTimeout(() => {
      setHighlightedItemId((current) => (current === item.id ? null : current));
    }, 2200);
  };

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
      setQuery('');
      setShowInventorySuggestions(false);
      setActiveInventorySuggestion(0);
      setHighlightedItemId(null);
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: `Dodano pomiar: ${variables.item.name}`, tone: 'success' });
      window.setTimeout(() => {
        document.getElementById('paint-tape-inventory-search')?.focus();
      }, 0);
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

  const updateEntryMutation = useMutation({
    mutationFn: updatePaintTapeInventoryEntry,
    onSuccess: (entry) => {
      setEntryEditDrafts((current) => {
        const next = { ...current };
        delete next[entry.id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({ title: 'Pomiar został poprawiony', tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się poprawić pomiaru',
        description:
          error.message === 'INVENTORY_SESSION_CLOSED'
            ? 'Najpierw otwórz ponownie ten spis.'
            : error.message === 'QTY_REQUIRED'
              ? 'Wpisz poprawną ilość, także 0.'
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
    onSuccess: (closedSession) => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-inventory'] });
      toast({
        title: closedSession.archivePending
          ? 'Spis zamknięty. Archiwum ERP oczekuje aktualizacji bazy.'
          : 'Spis został zamknięty',
        tone: closedSession.archivePending ? 'info' : 'success'
      });
    },
    onError: (error) => toast({
      title: error instanceof Error && error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_ARCHIVE'
        ? 'Wymagana aktualizacja bazy danych dla archiwum spisów'
        : 'Nie udało się zamknąć spisu',
      tone: 'error'
    })
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

  const handleEntryUpdate = (entry: PaintTapeInventoryEntry) => {
    const qty = parseQuantity(entryEditDrafts[entry.id] ?? String(entry.qty));
    if (qty === null) {
      toast({ title: 'Wpisz poprawną ilość, także 0.', tone: 'error' });
      return;
    }
    updateEntryMutation.mutate({ entryId: entry.id, qty });
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

  const sessionActionPending = removeSessionMutation.isPending || closeMutation.isPending || reopenMutation.isPending ||
    saveMutation.isPending || updateEntryMutation.isPending || removeEntryMutation.isPending;
  const handleRemoveSession = () => {
    if (!canRemoveSessions || !session || session.inventoryDate !== selectedDate ||
      !inventoryQuery.isSuccess || inventoryQuery.isFetching || sessionActionPending || exporting) return;
    if (!window.confirm(
      `Trwale usunąć spis z dnia ${formatDate(session.inventoryDate)}? Zapisane pozycje: ${checkedItemCount}, pomiary: ${entries.length}. ` +
      'Zostaną usunięte wszystkie pomiary tego dnia oraz zapisane porównanie ERP. Katalog materiałów, źródłowe stany ERP i pozostałe spisy pozostaną bez zmian. Tej operacji nie można cofnąć.'
    )) return;
    removeSessionMutation.mutate(session.id);
  };

  const progress = catalog.length > 0 ? Math.round((checkedItemCount / catalog.length) * 100) : 0;
  const handleExportHistory = async () => {
    if (exportBusy.current || !data || !session || session.inventoryDate !== selectedDate || !entries.length) return;
    exportBusy.current = true;
    setExporting(true);
    try {
      let snapshots = erpSnapshotQuery.data ?? [];
      if (!isComparisonFrozen && !erpSnapshotQuery.isSuccess) {
        const result = await erpSnapshotQuery.refetch();
        if (result.isError) throw result.error;
        snapshots = result.data ?? [];
      }
      const commentsResult = canViewComments ? await commentsQuery.refetch() : undefined;
      if (commentsResult && (commentsResult.isError || !commentsResult.data)) {
        throw new Error('INVENTORY_EXPORT_COMMENTS_UNAVAILABLE', { cause: commentsResult.error });
      }
      const { createPaintTapeInventoryWorkbook } = await import('@/lib/utils/paintTapeInventoryWorkbook');
      const workbook = await createPaintTapeInventoryWorkbook(data, snapshots, selectedDate, commentsResult?.data);
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `spis-farb-i-tasm-${selectedDate}.xlsx`;
      document.body.appendChild(anchor);
      try { anchor.click(); } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast({ title: `Wyeksportowano spis z dnia ${formatDate(selectedDate)}`, tone: 'success' });
    } catch (error) {
      const commentsUnavailable = error instanceof Error && error.message === 'INVENTORY_EXPORT_COMMENTS_UNAVAILABLE';
      const migrationMissing = error instanceof Error && error.cause instanceof Error &&
        error.cause.message === 'MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_COMMENTS';
      toast({ title: 'Nie udało się wyeksportować spisu', description: migrationMissing
        ? 'Komentarze wymagają aktualizacji bazy: 05_farby_i_tasmy.sql.'
        : commentsUnavailable ? 'Nie udało się pobrać zapisanych komentarzy. Sprawdź dostęp i połączenie, a następnie ponów eksport.'
          : 'Sprawdź, czy spis i dane ERP zostały wczytane, i spróbuj ponownie.', tone: 'error' });
    } finally {
      exportBusy.current = false;
      setExporting(false);
    }
  };
  const migrationRequired =
    inventoryQuery.error instanceof Error &&
    inventoryQuery.error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY';
  const loadError = (
    <div role="alert" className="space-y-3 p-4">
      <p className="font-black text-danger">Nie udało się wczytać spisu.</p>
      <p className="text-sm text-dim">Błąd pobierania danych. Spróbuj ponownie lub wybierz inny dzień z historii.</p>
      <Button type="button" variant="outline" disabled={inventoryQuery.isFetching} onClick={() => void inventoryQuery.refetch()}>
        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
        Spróbuj ponownie
      </Button>
    </div>
  );

  const renderInventoryRow = (item: PaintTapeInventoryCatalogItem) => {
    const itemEntries = entriesByItem.get(item.id) ?? [];
    const totalQty = isComparisonFrozen && archivedComparisonByItem
      ? archivedComparisonByItem.get(item.id)?.physicalQty ?? 0
      : itemEntries.reduce((sum, entry) => sum + entry.qty, 0);
    const hasEntries = itemEntries.length > 0;
    const draftKey = `${selectedDate}:${item.id}`;
    const draft = drafts[draftKey] ?? { qty: '' };
    const isSaving = saveMutation.isPending && saveMutation.variables?.item.id === item.id;
    const expandedKey = `${selectedDate}:${item.id}`;
    const isExpanded = expandedItems.has(expandedKey);
    const erpSnapshot = archivedComparisonByItem
      ? archivedComparisonByItem.get(item.id)?.erp ?? undefined
      : findPaintTapeInventoryErpSnapshot(erpSnapshotLookup, item);
    const unitsMatch =
      !erpSnapshot || normalizeUnit(erpSnapshot.unit) === normalizeUnit(item.unit);
    const difference = hasEntries && unitsMatch && erpSnapshot
      ? totalQty - erpSnapshot.realQty
      : null;
    const absoluteDifference = difference === null ? null : Math.abs(difference);
    const differenceIsZero = difference !== null && absoluteDifference! < 0.0005;
    const toggleExpanded = () => {
      if (!hasEntries) return;
      setExpandedItems((current) => {
        const next = new Set(current);
        if (next.has(expandedKey)) next.delete(expandedKey);
        else next.add(expandedKey);
        return next;
      });
    };
    return (
      <div
        key={item.id}
        id={`paint-inventory-item-${item.id}`}
        className={cn(
          'grid scroll-mt-24 gap-3 border-b border-[rgba(255,255,255,0.09)] px-2 py-4 transition last:border-b-0 sm:px-4',
          showErpComparison
            ? `${historyGridClass} lg:items-center`
            : locked
              ? 'lg:grid-cols-[minmax(280px,1fr)_160px] lg:items-center'
              : 'lg:grid-cols-[minmax(280px,1fr)_160px_150px_52px] lg:items-center',
          hasEntries && 'bg-[rgba(35,190,105,0.035)]',
          highlightedItemId === item.id &&
            'bg-[rgba(255,122,26,0.11)] ring-1 ring-inset ring-[rgba(255,122,26,0.55)]'
        )}
      >
        <button
          type="button"
          onClick={toggleExpanded}
          disabled={!hasEntries}
          aria-expanded={hasEntries ? isExpanded : undefined}
          className="group min-w-0 text-left disabled:cursor-default"
        >
          <span className="flex items-start justify-between gap-2">
            <span className="break-words text-base font-black leading-snug text-[var(--brand)]">
              {item.name}
            </span>
            {hasEntries && (
              <ChevronDown
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 text-dim transition-transform group-hover:text-title',
                  isExpanded && 'rotate-180'
                )}
              />
            )}
          </span>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-semibold text-dim">
            <span>Indeks {item.itemIndex}</span>
            {item.itemCode && <span>Kod {item.itemCode}</span>}
            <Badge tone={hasEntries ? 'success' : 'default'}>{categoryLabels[item.category]}</Badge>
            {hasEntries && (
              <span>{itemEntries.length} {itemEntries.length === 1 ? 'pomiar' : 'pomiary'}</span>
            )}
          </div>
        </button>
        <div className="min-w-0 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.045] px-3 py-2.5">
          <p className="text-[9px] font-black uppercase text-dim">Stan fizyczny</p>
          <p className="mt-0.5 text-sm font-black tabular-nums text-emerald-300">
            {hasEntries ? `${formatQuantity(totalQty)} ${item.unit}` : '—'}
          </p>
        </div>
        {showErpComparison && (
          <>
            <div className="min-w-0 rounded-lg border border-sky-500/20 bg-sky-500/[0.045] px-3 py-2.5">
              <p className="text-[9px] font-black uppercase text-dim">ERP</p>
              <p className="mt-0.5 text-sm font-black tabular-nums text-sky-300">
                {erpSnapshot
                  ? `${formatQuantity(erpSnapshot.realQty)} ${erpSnapshot.unit}`
                  : erpSnapshotQuery.isLoading
                    ? 'Wczytywanie'
                    : 'Brak danych'}
              </p>
            </div>
            <div
              className={cn(
                'min-w-0 rounded-lg border px-3 py-2.5',
                differenceIsZero
                  ? 'border-emerald-500/25 bg-emerald-500/[0.055]'
                  : difference !== null && difference > 0
                    ? 'border-rose-500/55 bg-rose-500/[0.12] shadow-[0_0_18px_rgba(244,63,94,0.12)]'
                    : difference !== null
                      ? 'border-amber-400/45 bg-amber-400/[0.09]'
                    : 'border-white/10 bg-white/[0.025]'
              )}
            >
              <p className="text-[9px] font-black uppercase text-dim">Różnica</p>
              <p
            className={cn(
              'mt-0.5 break-words text-xs font-black leading-snug',
              differenceIsZero
                ? 'text-emerald-300'
                : difference !== null && difference > 0
                  ? 'text-rose-300'
                  : difference !== null
                    ? 'text-amber-200'
                    : 'text-dim'
            )}
          >
            {!hasEntries
              ? 'Brak pomiaru'
              : !unitsMatch
                ? 'Niezgodna jednostka'
                : difference !== null && difference > 0
                  ? `Mamy więcej fizycznie: +${formatQuantity(absoluteDifference!)} ${item.unit}`
                  : !erpSnapshot
                    ? 'Brak stanu ERP'
                    : differenceIsZero
                      ? 'Stan zgodny'
                      : `Do rozpisania: ${formatQuantity(absoluteDifference!)} ${item.unit}`}
              </p>
            </div>
          </>
        )}
        {!locked && (
          <>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase text-dim lg:hidden">Dopisz ilość</label>
              <div className="relative">
                <Input
                  id={`paint-inventory-qty-${item.id}`}
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
        {showInventoryComments && session && <PaintTapeInventoryComment
          key={`${session.id}:${item.id}`}
          sessionId={session.id} itemId={item.id} itemName={item.name}
          comment={commentsByItem.get(item.id)} queryKey={commentsQueryKey}
          readOnly={readOnly} unavailable={!commentsQuery.isSuccess || removeSessionMutation.isPending}
        />}
        {hasEntries && isExpanded && (
          <div className="space-y-1.5 border-t border-[rgba(255,255,255,0.08)] pt-3 lg:col-span-full">
            <p className="pb-1 text-[10px] font-black uppercase text-dim">Pomiary składowe</p>
            {itemEntries.map((entry, index) => (
              <div
                key={entry.id}
                className="flex min-w-0 items-start gap-2 rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-xs"
              >
                {locked ? (
                  <span className="shrink-0 font-black tabular-nums text-title">
                    {index + 1}. {formatQuantity(entry.qty)} {item.unit}
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="font-black text-dim">{index + 1}.</span>
                    <div className="relative w-28">
                      <Input
                        aria-label={`Edytuj pomiar ${index + 1} dla ${item.name}`}
                        value={entryEditDrafts[entry.id] ?? String(entry.qty)}
                        onChange={(event) => setEntryEditDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleEntryUpdate(entry);
                          }
                        }}
                        inputMode="decimal"
                        className="h-8 min-h-8 rounded-md px-2 pr-8 py-1 text-xs font-black tabular-nums"
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-dim">{item.unit}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleEntryUpdate(entry)}
                      disabled={updateEntryMutation.isPending || parseQuantity(entryEditDrafts[entry.id] ?? String(entry.qty)) === null}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-emerald-500/25 text-emerald-300 transition hover:bg-emerald-500/10 disabled:opacity-40"
                      aria-label={`Zapisz pomiar ${index + 1}`}
                      title="Zapisz poprawioną ilość"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                )}
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
    <div className="space-y-4 max-md:-mx-4 max-md:w-[calc(100%+2rem)]">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-[rgba(255,255,255,0.025)] p-1 max-md:rounded-none max-md:border-x-0">
        <button
          type="button"
          disabled={removeSessionMutation.isPending}
          onClick={() => {
            setView('CURRENT');
            selectInventoryDate(today);
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
          disabled={removeSessionMutation.isPending}
          onClick={() => {
            setView('HISTORY');
            const latest = historySessions[0]?.inventoryDate;
            if (latest) selectInventoryDate(latest);
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
            W SQL Editor uruchom plik <span className="font-mono">supabase/05_farby_i_tasmy.sql</span>.
          </p>
        </Card>
      ) : view === 'HISTORY' ? (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="p-0 max-md:rounded-none max-md:border-x-0 md:p-0">
            <div className="border-b border-border px-2 py-4 sm:px-4">
              <p className="font-black text-title">Historia spisów</p>
              <p className="mt-1 text-xs text-dim">Każdy dzień zachowuje własne ilości i osoby.</p>
            </div>
            {historySessions.length ? (
              <div className="max-h-[70vh] overflow-y-auto">
                {historySessions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={removeSessionMutation.isPending}
                    onClick={() => selectInventoryDate(item.inventoryDate)}
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
            ) : inventoryQuery.isLoading ? (
              <p className="p-4 text-sm text-dim">Wczytywanie historii...</p>
            ) : inventoryQuery.isError ? (
              <p className="p-4 text-sm text-danger">Nie udało się wczytać historii.</p>
            ) : (
              <EmptyState title="Brak historii" description="Historia pojawi się po zapisaniu pierwszej pozycji." />
            )}
          </Card>

          <Card className="p-0 max-md:rounded-none max-md:border-x-0 md:p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-2 py-4 sm:px-4">
              <div>
                <p className="font-black text-title">Spis z dnia {formatDate(selectedDate)}</p>
                <p className="text-xs text-dim">
                  {inventoryQuery.isError ? 'Odczyt spisu nie powiódł się.' : inventoryQuery.isLoading ? 'Wczytywanie spisu...'
                    : <>Zapisane pozycje: {checkedItemCount} · pomiary: {entries.length}</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => void handleExportHistory()}
                  disabled={exporting || removeSessionMutation.isPending || inventoryQuery.isFetching || !inventoryQuery.isSuccess || !session || session.inventoryDate !== selectedDate || !entries.length || (!isComparisonFrozen && erpSnapshotQuery.isFetching)}
                  aria-busy={exporting} className="min-h-[44px]">
                  {exporting ? <LoaderCircle className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <FileDown className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />}
                  {exporting ? 'Eksportowanie...' : 'Eksportuj do Excela'}
                </Button>
                {session?.status === 'CLOSED' && !readOnly && !inventoryQuery.isError ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reopenMutation.mutate(selectedDate)}
                    disabled={reopenMutation.isPending || removeSessionMutation.isPending}
                    className="paint-inventory-button paint-inventory-button-purple paint-inventory-button-active min-h-[44px] border-purple-500/35 px-4 text-title hover:border-purple-400/55"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Otwórz ponownie
                  </Button>
                ) : session?.status === 'OPEN' && !readOnly && !inventoryQuery.isError ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={closeMutation.isPending || removeSessionMutation.isPending}
                    className="paint-inventory-button paint-inventory-button-amber paint-inventory-button-active min-h-[44px] border-amber-500/35 px-4 text-title hover:border-amber-400/55"
                  >
                    <LockKeyhole className="mr-2 h-4 w-4" />
                    Zamknij ponownie
                  </Button>
                ) : null}
                {canRemoveSessions && session && inventoryQuery.isSuccess && session.inventoryDate === selectedDate && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRemoveSession}
                    disabled={sessionActionPending || inventoryQuery.isFetching || exporting}
                    title={`Usuń spis z dnia ${formatDate(selectedDate)}`}
                    aria-label={`Usuń spis z dnia ${formatDate(selectedDate)}`}
                    aria-busy={removeSessionMutation.isPending}
                    className="h-11 w-11 shrink-0 border-red-500/35 p-0 text-danger hover:border-red-400/60 hover:bg-red-500/10"
                  >
                    {removeSessionMutation.isPending
                      ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                  </Button>
                )}
              </div>
            </div>
            {showInventoryComments && commentsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-border p-3 text-xs text-danger">
              <span>{commentsQuery.error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_COMMENTS'
                ? 'Komentarze wymagają aktualizacji bazy: 05_farby_i_tasmy.sql.'
                : 'Nie udało się wczytać komentarzy. Sprawdź dostęp i połączenie.'}</span>
              <Button type="button" variant="outline" disabled={commentsQuery.isFetching} onClick={() => void commentsQuery.refetch()}>
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />Ponów
              </Button>
            </div>}
            <div className={cn('hidden gap-3 border-b border-border bg-[rgba(255,255,255,0.035)] px-4 py-3 text-[10px] font-black uppercase text-dim lg:grid', historyGridClass)}>
              <span>Nazwa</span>
              <span>Stan fizyczny</span>
              <span>ERP</span>
              <span>Różnica / korekta</span>
              {!locked && <><span>Dopisz ilość</span><span /></>}
              {showInventoryComments && <span className="hidden 2xl:block">Komentarz do rozliczenia</span>}
            </div>
            {inventoryQuery.isError ? loadError : inventoryQuery.isLoading ? (
              <p className="p-4 text-sm text-dim">Wczytywanie...</p>
            ) : entries.length === 0 ? (
              <EmptyState title="Brak zapisanych pozycji" description="Tego dnia nie rozpoczęto spisu." />
            ) : (
              catalog.filter((item) => entriesByItem.has(item.id)).map(renderInventoryRow)
            )}
          </Card>
        </div>
      ) : inventoryQuery.isError ? (
        <Card className="p-0">{loadError}</Card>
      ) : (
        <>
          <Card className="space-y-4 max-md:rounded-none max-md:border-x-0 max-md:px-2">
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
            <Card className="border-[rgba(255,122,26,0.35)] max-md:rounded-none max-md:border-x-0 max-md:px-2">
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
                  <div className="absolute z-30 mt-2 max-h-[360px] w-full overflow-y-auto rounded-xl border border-border bg-[var(--modal-bg)] p-1.5 shadow-[var(--modal-shadow)]">
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

          <Card className="space-y-3 max-md:rounded-none max-md:border-x-0 max-md:px-2">
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
            <div className="relative z-20">
              <SearchInput
                id="paint-tape-inventory-search"
                value={query}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setQuery(nextQuery);
                  setShowInventorySuggestions(normalizeSearch(nextQuery).length >= 2);
                  setActiveInventorySuggestion(0);
                }}
                onFocus={() => {
                  if (normalizeSearch(query).length >= 2) setShowInventorySuggestions(true);
                }}
                onBlur={() => {
                  window.setTimeout(() => setShowInventorySuggestions(false), 120);
                }}
                onKeyDown={(event) => {
                  if (!showInventorySuggestions || inventorySuggestions.length === 0) {
                    if (event.key === 'ArrowDown' && inventorySuggestions.length > 0) {
                      event.preventDefault();
                      setShowInventorySuggestions(true);
                    }
                    return;
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveInventorySuggestion((current) =>
                      Math.min(current + 1, inventorySuggestions.length - 1)
                    );
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveInventorySuggestion((current) => Math.max(current - 1, 0));
                  } else if (event.key === 'Enter') {
                    event.preventDefault();
                    selectInventorySuggestion(
                      inventorySuggestions[Math.min(activeInventorySuggestion, inventorySuggestions.length - 1)]
                    );
                  } else if (event.key === 'Escape') {
                    setShowInventorySuggestions(false);
                  }
                }}
                onClear={() => {
                  setQuery('');
                  setShowInventorySuggestions(false);
                  setActiveInventorySuggestion(0);
                }}
                clearable
                autoComplete="off"
                placeholder="Wpisz nazwę farby, folii lub taśmy"
                className="min-h-[50px]"
                aria-autocomplete="list"
                aria-expanded={showInventorySuggestions}
              />
              {showInventorySuggestions && normalizeSearch(query).length >= 2 && (
                <div
                  role="listbox"
                  className="absolute z-40 mt-2 max-h-[min(52vh,420px)] w-full overflow-y-auto rounded-xl border border-border bg-[var(--modal-bg)] p-1.5 shadow-[var(--modal-shadow)]"
                >
                  {inventorySuggestions.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-dim">
                      Brak pozycji w katalogu spisu farb i taśm.
                    </p>
                  ) : (
                    inventorySuggestions.map((item, index) => {
                      const itemEntries = entriesByItem.get(item.id) ?? [];
                      const totalQty = itemEntries.reduce((sum, entry) => sum + entry.qty, 0);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={index === activeInventorySuggestion}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveInventorySuggestion(index)}
                          onClick={() => selectInventorySuggestion(item)}
                          className={cn(
                            'flex min-h-[58px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition',
                            index === activeInventorySuggestion
                              ? 'border-[rgba(255,122,26,0.48)] bg-[rgba(255,122,26,0.09)]'
                              : 'border-transparent hover:border-white/10 hover:bg-white/[0.035]'
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-black text-title">
                              {item.name}
                            </span>
                            <span className="mt-1 block text-[11px] font-semibold text-dim">
                              Indeks: {item.itemIndex}
                              {item.itemCode ? ` · Kod: ${item.itemCode}` : ''}
                              {` · ${categoryLabels[item.category]}`}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'shrink-0 rounded-full border px-2 py-1 text-[10px] font-black tabular-nums',
                              itemEntries.length > 0
                                ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
                                : 'border-white/10 bg-white/[0.035] text-dim'
                            )}
                          >
                            {itemEntries.length > 0
                              ? `${formatQuantity(totalQty)} ${item.unit}`
                              : 'Do wpisania'}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden p-0 max-md:rounded-none max-md:border-x-0 md:p-0">
            <div className="hidden grid-cols-[minmax(280px,1fr)_160px_150px_52px] gap-3 border-b border-border bg-[rgba(255,255,255,0.035)] px-4 py-3 text-[10px] font-black uppercase text-dim lg:grid">
              <span>Nazwa</span>
              <span>Stan fizyczny</span>
              <span>Dopisz ilość</span>
              <span />
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
