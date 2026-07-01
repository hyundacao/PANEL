'use client';

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import {
  addPaintTapeSettlementIssue,
  createPaintTapeSettlement,
  getOriginalInventoryCatalog,
  getOriginalInventoryCatalogFromErp,
  getOriginalInventoryErpSnapshot,
  getPaintTapeSettlements,
  getProductionDetailSuggestions,
  removePaintTapeSettlement,
  updatePaintTapeSettlement
} from '@/lib/api';
import type {
  OriginalInventoryCatalogEntry,
  OriginalInventoryErpSnapshotEntry,
  PaintTapeSettlement
} from '@/lib/api/types';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { getPaintTapePermissions, isReadOnly } from '@/lib/auth/access';
import { cn } from '@/lib/utils/cn';
import { parseQtyInput } from '@/lib/utils/format';

type FilterValue = 'CREATE' | 'OPEN' | 'DETAILS_REQUIRED' | 'DONE';

type RowDraft = {
  orderNumber: string;
  endQty: string;
  producedQty: string;
};

type IssueDraft = {
  settlementId: string;
  direction: 1 | -1;
  value: string;
};

type PaintTapeItemDraft = {
  id: string;
  itemName: string;
  startQty: string;
};

type SettlementGroup = {
  key: string;
  orderNumber: string;
  detailName: string;
  items: PaintTapeSettlement[];
};

const createEmptyPaintTapeItem = (index: number): PaintTapeItemDraft => ({
  id: `item-${index}`,
  itemName: '',
  startQty: ''
});

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeKey = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const getSearchTokens = (value: unknown) =>
  normalizeKey(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

const matchesTokenSearch = (value: unknown, query: unknown) => {
  const tokens = getSearchTokens(query);
  if (tokens.length === 0) return true;
  const normalizedValue = normalizeKey(value);
  return tokens.every((token) => normalizedValue.includes(token));
};

const cleanDetailSuggestion = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^FWP?[-\s]+/i, '')
    .replace(/^FW[-\s]+/i, '')
    .trim();

const formatDetailSuggestion = (name: unknown, indexCode?: unknown) => {
  const cleanedName = cleanDetailSuggestion(name);
  const index = String(indexCode ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanedName) return '';
  if (index.toUpperCase().startsWith('FWP')) return '';
  if (
    index &&
    !normalizeKey(cleanedName).includes(normalizeKey(index))
  ) {
    return `${cleanedName} (${index})`;
  }
  return cleanedName;
};

const countDetailIndices = (value: string) => {
  const matches = value.match(/\([^)]+\)/g) ?? [];
  return matches.filter((match) => /\d/.test(match)).length;
};

const isSingleDetailSuggestion = (value: string) => {
  if (value.includes(' / ')) return false;
  return countDetailIndices(value) <= 1;
};

const hasLowPriorityToolingMarker = (value: string) => /\bM[-\s]?(1|10|13)\b/i.test(value);

const compareDetailSuggestions = (a: string, b: string) => {
  const aLowPriority = hasLowPriorityToolingMarker(a);
  const bLowPriority = hasLowPriorityToolingMarker(b);
  if (aLowPriority !== bLowPriority) return aLowPriority ? 1 : -1;
  return a.localeCompare(b, 'pl', { sensitivity: 'base', numeric: true });
};

const formatQty = (value: number | null | undefined, unit = 'kg') => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const formatted = Number.isInteger(value)
    ? value.toLocaleString('pl-PL')
    : value.toLocaleString('pl-PL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
      });
  return `${formatted} ${unit}`;
};

const formatShortDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const formatSignedQty = (value: number, unit = 'kg') => {
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatQty(Math.abs(value), unit)}`;
};

const formatIssueHistory = (settlement: PaintTapeSettlement) =>
  (settlement.warehouseIssuedIssues ?? [])
    .map((issue) => {
      const date = formatShortDate(issue.createdAt);
      return `${date ? `${date} ` : ''}${formatSignedQty(issue.qty, settlement.unit || 'kg')}`;
    })
    .join(' 路 ');

const celebrationParticles = Array.from({ length: 28 }, (_, index) => ({
  id: index,
  angle: (index / 28) * 360,
  distance: 96 + (index % 5) * 26,
  delay: (index % 7) * 0.045,
  size: 7 + (index % 4) * 3,
  color: ['#FF6A00', '#22C55E', '#7C5CFF', '#F59E0B', '#F1F5F9'][index % 5]
}));

const formatPerPiece = (value: number | null | undefined, unit = 'kg') => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value.toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  })} ${unit}/szt.`;
};

const formatPiecesQty = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  const formatted = Number.isInteger(value)
    ? value.toLocaleString('pl-PL')
    : value.toLocaleString('pl-PL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
      });
  return `${formatted} szt.`;
};

const numberInputValue = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value).replace('.', ',');

const getStatusBadge = (settlement: PaintTapeSettlement) => {
  if (settlement.status === 'DONE') return <Badge tone="success">Zakończone</Badge>;
  if (settlement.status === 'DETAILS_REQUIRED') {
    return <Badge tone="warning">Do wpisania ilości detali</Badge>;
  }
  return <Badge tone="info">Otwarte</Badge>;
};

const buildSnapshotMap = (items: OriginalInventoryErpSnapshotEntry[]) => {
  const map = new Map<string, OriginalInventoryErpSnapshotEntry>();
  items.forEach((item) => {
    map.set(normalizeKey(item.name), item);
    if (item.indexCode) map.set(normalizeKey(item.indexCode), item);
  });
  return map;
};

export default function PaintTapeSettlementsPage() {
  const toast = useToastStore((state) => state.push);
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'FARBY_TASMY');
  const paintTapePermissions = getPaintTapePermissions(user);
  const canCreate = !readOnly && paintTapePermissions.create;
  const canOpen = !readOnly && paintTapePermissions.open;
  const canDetails = !readOnly && paintTapePermissions.details;
  const canAccounting = !readOnly && paintTapePermissions.accounting;
  const canShowCelebration = paintTapePermissions.celebration;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterValue>('CREATE');
  const [query, setQuery] = useState('');
  const [snapshotDate, setSnapshotDate] = useState(getLocalDateValue());
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [groupProducedDrafts, setGroupProducedDrafts] = useState<Record<string, string>>({});
  const [issueDraft, setIssueDraft] = useState<IssueDraft | null>(null);
  const [celebrationVisible, setCelebrationVisible] = useState(false);
  const [showDetailSuggestions, setShowDetailSuggestions] = useState(false);
  const [showItemSuggestionsFor, setShowItemSuggestionsFor] = useState<string | null>(null);
  const [form, setForm] = useState({
    orderNumber: '',
    detailName: ''
  });
  const nextItemDraftId = useRef(2);
  const celebrationTimerRef = useRef<number | null>(null);
  const [itemDrafts, setItemDrafts] = useState<PaintTapeItemDraft[]>([
    createEmptyPaintTapeItem(1)
  ]);
  const visibleFilters = useMemo(
    () =>
      [
        paintTapePermissions.create ? { value: 'CREATE' as FilterValue, label: 'Dodaj zlecenie' } : null,
        paintTapePermissions.open ? { value: 'OPEN' as FilterValue, label: 'Otwarte zlecenia' } : null,
        paintTapePermissions.details
          ? { value: 'DETAILS_REQUIRED' as FilterValue, label: 'Zlecenia do wpisania ilości' }
          : null,
        paintTapePermissions.accounting ? { value: 'DONE' as FilterValue, label: 'Zakończone zlecenia' } : null
      ].filter(Boolean) as Array<{ value: FilterValue; label: string }>,
    [
      paintTapePermissions.accounting,
      paintTapePermissions.create,
      paintTapePermissions.details,
      paintTapePermissions.open
    ]
  );

  const activeFilter = visibleFilters.some((item) => item.value === filter)
    ? filter
    : visibleFilters[0]?.value ?? 'CREATE';

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['paint-tape-settlements'],
    queryFn: getPaintTapeSettlements
  });

  const { data: localCatalog = [] } = useQuery({
    queryKey: ['spis-oryginalow-catalog-local'],
    queryFn: getOriginalInventoryCatalog
  });

  const { data: erpCatalog = [] } = useQuery({
    queryKey: ['spis-oryginalow-catalog-erp-for-settlements'],
    queryFn: async () => {
      try {
        return await getOriginalInventoryCatalogFromErp();
      } catch {
        return [] as OriginalInventoryCatalogEntry[];
      }
    },
    retry: false
  });

  const { data: productionDetails = [] } = useQuery({
    queryKey: ['production-detail-suggestions'],
    queryFn: async () => {
      try {
        return await getProductionDetailSuggestions();
      } catch {
        return [] as string[];
      }
    },
    retry: false
  });

  const { data: erpSnapshot = [], error: erpSnapshotError } = useQuery({
    queryKey: ['spis-oryginalow-erp-snapshot', snapshotDate],
    queryFn: async () => {
      try {
        return await getOriginalInventoryErpSnapshot(snapshotDate);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (code === 'MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS') {
          return [] as OriginalInventoryErpSnapshotEntry[];
        }
        throw error;
      }
    },
    enabled: Boolean(snapshotDate),
    retry: false
  });

  const itemCatalog = useMemo(() => {
    const merged = new Map<string, OriginalInventoryCatalogEntry>();
    [...erpCatalog, ...localCatalog].forEach((item) => {
      const key = `${normalizeKey(item.name)}|${normalizeKey(item.indexCode)}`;
      if (!merged.has(key)) merged.set(key, item);
    });
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }, [erpCatalog, localCatalog]);

  const detailNames = useMemo(() => {
    const values = new Set<string>();
    productionDetails.forEach((name) => {
      const trimmed = cleanDetailSuggestion(name);
      if (trimmed && !trimmed.toUpperCase().startsWith('FW') && isSingleDetailSuggestion(trimmed)) {
        values.add(trimmed);
      }
    });
    itemCatalog.forEach((item) => {
      const trimmed = formatDetailSuggestion(item.name, item.indexCode);
      if (trimmed && !trimmed.toUpperCase().startsWith('FW') && isSingleDetailSuggestion(trimmed)) {
        values.add(trimmed);
      }
    });
    settlements.forEach((item) => {
      const trimmed = cleanDetailSuggestion(item.detailName);
      if (trimmed && !trimmed.toUpperCase().startsWith('FW') && isSingleDetailSuggestion(trimmed)) {
        values.add(trimmed);
      }
    });
    return [...values].sort(compareDetailSuggestions);
  }, [itemCatalog, productionDetails, settlements]);

  const getSelectedItem = (itemName: string) => {
    const rawValue = itemName.includes('|')
      ? itemName.split('|')[0]?.trim() ?? itemName
      : itemName;
    const itemKey = normalizeKey(rawValue);
    if (!itemKey) return null;
    return itemCatalog.find(
      (item) => normalizeKey(item.name) === itemKey || normalizeKey(item.indexCode) === itemKey
    ) ?? null;
  };

  const snapshotMap = useMemo(() => buildSnapshotMap(erpSnapshot), [erpSnapshot]);

  const getErpForSettlement = (settlement: PaintTapeSettlement) =>
    snapshotMap.get(normalizeKey(settlement.itemIndexCode)) ??
    snapshotMap.get(normalizeKey(settlement.itemName)) ??
    null;

  const getFormErpSnapshot = (itemName: string) => {
    const selectedItem = getSelectedItem(itemName);
    return (
      snapshotMap.get(normalizeKey(selectedItem?.indexCode)) ??
      snapshotMap.get(normalizeKey(selectedItem?.name ?? itemName)) ??
      null
    );
  };

  const detailSuggestions = useMemo(() => {
    const needle = normalizeKey(form.detailName);
    if (needle.length < 2) return [];
    return detailNames
      .filter((name) => matchesTokenSearch(name, needle))
      .sort(compareDetailSuggestions)
      .slice(0, 12);
  }, [detailNames, form.detailName]);

  const getItemSuggestions = (itemName: string) => {
    const rawNeedle = itemName.includes('|')
      ? itemName.split('|')[0]?.trim() ?? itemName
      : itemName;
    const needle = normalizeKey(rawNeedle);
    if (needle.length < 2) return [];
    const source = needle
      ? itemCatalog.filter(
          (item) =>
            matchesTokenSearch(`${item.name} ${item.indexCode}`, needle)
        )
      : [];
    return source.slice(0, 14);
  };

  const showAccountedCelebration = () => {
    if (celebrationTimerRef.current) {
      window.clearTimeout(celebrationTimerRef.current);
    }
    setCelebrationVisible(false);
    window.requestAnimationFrame(() => {
      setCelebrationVisible(true);
      celebrationTimerRef.current = window.setTimeout(() => {
        setCelebrationVisible(false);
        celebrationTimerRef.current = null;
      }, 4200);
    });
  };

  const createMutation = useMutation({
    mutationFn: async (
      payloads: Array<Parameters<typeof createPaintTapeSettlement>[0]>
    ) => Promise.all(payloads.map((payload) => createPaintTapeSettlement(payload))),
    onSuccess: () => {
      setForm({
        orderNumber: '',
        detailName: ''
      });
      nextItemDraftId.current = 2;
      setItemDrafts([createEmptyPaintTapeItem(1)]);
      setShowItemSuggestionsFor(null);
      setFilter('OPEN');
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-settlements'] });
      toast({ title: 'Dodano rozliczenie', tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się dodać rozliczenia',
        description:
          error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_SETTLEMENTS'
            ? 'Uruchom migrację supabase/migrate_paint_tape_settlements.sql.'
            : 'Sprawdź wymagane pola.',
        tone: 'error'
      });
    }
  });

  const updateGroupMutation = useMutation({
    mutationFn: async (
      payloads: Array<Parameters<typeof updatePaintTapeSettlement>[0]>
    ) => Promise.all(payloads.map((payload) => updatePaintTapeSettlement(payload))),
    onSuccess: (_data, payloads) => {
      setDrafts({});
      setGroupProducedDrafts({});
      if (canShowCelebration && payloads.some((payload) => payload.accounted === true)) {
        showAccountedCelebration();
      }
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-settlements'] });
      toast({ title: 'Zapisano zlecenie', tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się zapisać zlecenia',
        description:
          error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_SETTLEMENT_ACCOUNTING'
            ? 'Uruchom migrację supabase/migrate_paint_tape_settlements.sql.'
            : undefined,
        tone: 'error'
      });
    }
  });

  const issueMutation = useMutation({
    mutationFn: addPaintTapeSettlementIssue,
    onSuccess: () => {
      setIssueDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-settlements'] });
      toast({ title: 'Zapisano ruch pobrania', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie udało się zapisać ruchu pobrania', tone: 'error' });
    }
  });

  const removeMutation = useMutation({
    mutationFn: removePaintTapeSettlement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-settlements'] });
      toast({ title: 'Usunięto rozliczenie', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie udało się usunąć rozliczenia', tone: 'error' });
    }
  });

  const filteredSettlements = useMemo(() => {
    const normalizedQuery = normalizeKey(query);
    return settlements.filter((settlement) => {
      if (activeFilter === 'CREATE' || settlement.status !== activeFilter) return false;
      if (!normalizedQuery) return true;
      return [
        settlement.orderNumber,
        settlement.detailName,
        settlement.itemName,
        settlement.itemIndexCode
      ].some((value) => matchesTokenSearch(value, normalizedQuery));
    });
  }, [activeFilter, query, settlements]);

  const groupedSettlements = useMemo(() => {
    const groups = new Map<string, SettlementGroup>();
    filteredSettlements.forEach((settlement) => {
      const key = `${normalizeKey(settlement.orderNumber)}|${normalizeKey(settlement.detailName)}`;
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(settlement);
        return;
      }
      groups.set(key, {
        key,
        orderNumber: settlement.orderNumber,
        detailName: settlement.detailName,
        items: [settlement]
      });
    });
    return [...groups.values()];
  }, [filteredSettlements]);

  const getDraft = (settlement: PaintTapeSettlement): RowDraft => {
    const draft = drafts[settlement.id];
    if (draft) {
      return {
        orderNumber: draft.orderNumber.trim() ? draft.orderNumber : settlement.orderNumber,
        endQty: draft.endQty,
        producedQty: draft.producedQty
      };
    }
    return {
      orderNumber: settlement.orderNumber,
      endQty: numberInputValue(settlement.endQty),
      producedQty: numberInputValue(settlement.producedQty)
    };
  };

  const setDraft = (settlement: PaintTapeSettlement, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [settlement.id]: {
        orderNumber: prev[settlement.id]?.orderNumber?.trim()
          ? prev[settlement.id].orderNumber
          : settlement.orderNumber,
        endQty: prev[settlement.id]?.endQty ?? numberInputValue(settlement.endQty),
        producedQty: prev[settlement.id]?.producedQty ?? numberInputValue(settlement.producedQty),
        ...patch
      }
    }));
  };

  const getGroupProducedDraft = (group: SettlementGroup) =>
    groupProducedDrafts[group.key] ?? numberInputValue(group.items[0]?.producedQty);

  const getUsagePerPiecePreview = (settlement: PaintTapeSettlement, group: SettlementGroup) => {
    const producedQty = parseQtyInput(getGroupProducedDraft(group));
    if (producedQty === null || producedQty <= 0) return settlement.usagePerPiece;
    const usageQty = settlement.usageQty;
    if (usageQty === null || usageQty === undefined || Number.isNaN(usageQty)) return null;
    return usageQty / producedQty;
  };

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCreate) {
      toast({ title: 'Brak uprawnien do dodawania zlecen.', tone: 'error' });
      return;
    }
    const validItemDrafts = itemDrafts.filter(
      (draft) => draft.itemName.trim() || draft.startQty.trim()
    );
    if (!form.detailName.trim() || validItemDrafts.length === 0) {
      toast({ title: 'Uzupełnij detal i przynajmniej jedną farbę/taśmę.', tone: 'error' });
      return;
    }
    const payloads = validItemDrafts.map((draft) => {
      const startQty = parseQtyInput(draft.startQty);
      const item = getSelectedItem(draft.itemName);
      return {
        draft,
        startQty,
        payload: {
          orderNumber: form.orderNumber.trim() || undefined,
          detailName: form.detailName.trim(),
          itemName: item?.name ?? draft.itemName.trim(),
          itemIndexCode: item?.indexCode ?? null,
          unit: item?.unit ?? 'kg',
          startQty: startQty ?? 0,
          warehouseIssuedQty: 0
        }
      };
    });
    if (payloads.some(({ draft }) => !draft.itemName.trim())) {
      toast({ title: 'Uzupełnij nazwę każdej farby/taśmy.', tone: 'error' });
      return;
    }
    if (payloads.some(({ startQty }) => startQty === null)) {
      toast({ title: 'Podaj stan przed rozpoczęciem dla każdej farby/taśmy.', tone: 'error' });
      return;
    }
    createMutation.mutate(payloads.map(({ payload }) => payload));
  };

  const updateItemDraft = (id: string, patch: Partial<PaintTapeItemDraft>) => {
    setItemDrafts((prev) =>
      prev.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
    );
  };

  const addItemDraft = () => {
    if (!canCreate) return;
    const nextId = nextItemDraftId.current;
    nextItemDraftId.current += 1;
    setItemDrafts((prev) => [...prev, createEmptyPaintTapeItem(nextId)]);
  };

  const removeItemDraft = (id: string) => {
    if (!canCreate) return;
    setItemDrafts((prev) =>
      prev.length <= 1 ? prev : prev.filter((draft) => draft.id !== id)
    );
    setShowItemSuggestionsFor((current) => (current === id ? null : current));
  };

  const handleSaveOpenGroup = (group: SettlementGroup) => {
    if (!canOpen) {
      toast({ title: 'Brak uprawnien do otwartych zlecen.', tone: 'error' });
      return;
    }
    const firstSettlement = group.items[0];
    if (!firstSettlement) return;
    const orderNumber =
      getDraft(firstSettlement).orderNumber.trim() ||
      group.orderNumber.trim() ||
      firstSettlement.orderNumber.trim();
    if (!orderNumber) {
      toast({ title: 'Podaj numer zlecenia.', tone: 'error' });
      return;
    }
    const payloads = group.items.map((settlement) => {
      const draft = getDraft(settlement);
      const endQty = draft.endQty.trim() ? parseQtyInput(draft.endQty) : null;
      return { settlement, draft, endQty };
    });
    if (payloads.some(({ draft }) => !draft.endQty.trim())) {
      toast({ title: 'Podaj stan po dla każdej farby/taśmy w zleceniu.', tone: 'error' });
      return;
    }
    if (payloads.some(({ endQty }) => endQty === null)) {
      toast({ title: 'Podaj poprawny stan po dla każdej farby/taśmy.', tone: 'error' });
      return;
    }
    updateGroupMutation.mutate(
      payloads.map(({ settlement, endQty }) => ({
        id: settlement.id,
        orderNumber,
        endQty,
        producedQty: null,
        completeProduction: true
      }))
    );
  };

  const handleSaveDetailsGroup = (group: SettlementGroup) => {
    if (!canDetails) {
      toast({ title: 'Brak uprawnien do wpisywania ilosci.', tone: 'error' });
      return;
    }
    const producedQty = parseQtyInput(getGroupProducedDraft(group));
    const firstSettlement = group.items[0];
    if (!firstSettlement) return;
    const orderNumber =
      getDraft(firstSettlement).orderNumber.trim() ||
      group.orderNumber.trim() ||
      firstSettlement.orderNumber.trim();
    if (producedQty === null || producedQty <= 0) {
      toast({ title: 'Podaj poprawną ilość detali dla całego zlecenia.', tone: 'error' });
      return;
    }
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        orderNumber,
        producedQty
      }))
    );
  };

  const handleReopenGroup = (group: SettlementGroup) => {
    if (!canAccounting) {
      toast({ title: 'Brak uprawnien do rozliczania zakonczonych zlecen.', tone: 'error' });
      return;
    }
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        reopen: true
      }))
    );
  };

  const handleMoveGroupBackToOpen = (group: SettlementGroup) => {
    if (!canDetails) {
      toast({ title: 'Brak uprawnien do cofania zlecen.', tone: 'error' });
      return;
    }
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        producedQty: null,
        moveToOpen: true
      }))
    );
  };

  const handleAccountedGroup = (group: SettlementGroup) => {
    if (!canAccounting) {
      toast({ title: 'Brak uprawnien do rozliczania zakonczonych zlecen.', tone: 'error' });
      return;
    }
    const nextAccounted = !group.items.every((settlement) => Boolean(settlement.accountedAt));
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        accounted: nextAccounted
      }))
    );
  };

  const handleIssueMove = (settlement: PaintTapeSettlement, direction: 1 | -1) => {
    if (!canOpen || activeFilter !== 'OPEN') return;
    setIssueDraft({ settlementId: settlement.id, direction, value: '' });
  };

  const submitIssueMove = (settlement: PaintTapeSettlement) => {
    if (!issueDraft || issueDraft.settlementId !== settlement.id) return;
    if (!canOpen || activeFilter !== 'OPEN') {
      toast({ title: 'Brak uprawnien do otwartych zlecen.', tone: 'error' });
      return;
    }
    const qty = parseQtyInput(issueDraft.value);
    if (qty === null || qty <= 0) {
      toast({ title: 'Podaj poprawną ilość pobrania.', tone: 'error' });
      return;
    }
    issueMutation.mutate({
      settlementId: settlement.id,
      qty: issueDraft.direction * qty
    });
  };

  const renderOrderNumber = (settlement: PaintTapeSettlement, compact = false) => {
    const draft = getDraft(settlement);
    const isDone = settlement.status === 'DONE';
    if (isDone) {
      return (
        <p className={compact ? 'mt-1 text-lg font-black leading-tight text-[var(--value-purple)]' : 'font-black text-[var(--value-purple)]'}>
          {settlement.orderNumber || 'Bez numeru'}
        </p>
      );
    }
    return (
      <Input
        value={draft.orderNumber}
        onChange={(event) => setDraft(settlement, { orderNumber: event.target.value })}
        disabled={!canOpen || activeFilter !== 'OPEN' || updateGroupMutation.isPending}
        aria-label="Numer zlecenia"
        className={compact ? 'mt-1 h-10 font-black text-[var(--value-purple)]' : 'h-10 min-w-[120px] font-black text-[var(--value-purple)]'}
      />
    );
  };

  const renderIssuedControl = (settlement: PaintTapeSettlement, compact = false) => {
    const disabled = !canOpen || activeFilter !== 'OPEN' || settlement.status === 'DONE' || issueMutation.isPending;
    const history = formatIssueHistory(settlement);
    const activeIssueDraft =
      issueDraft?.settlementId === settlement.id ? issueDraft : null;
    return (
      <div className="min-w-[130px]">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleIssueMove(settlement, -1)}
            disabled={disabled || settlement.warehouseIssuedQty <= 0}
            className={compact ? 'h-10 w-10 px-0 py-0' : 'h-9 w-9 px-0 py-0'}
            aria-label="Odejmij pobranie z magazynu"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div className="flex min-h-10 min-w-0 flex-1 items-center justify-center rounded-xl border border-border bg-[rgba(0,0,0,0.32)] px-3 text-sm font-black text-title">
            {formatQty(settlement.warehouseIssuedQty, settlement.unit || 'kg')}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleIssueMove(settlement, 1)}
            disabled={disabled}
            className={compact ? 'h-10 w-10 px-0 py-0' : 'h-9 w-9 px-0 py-0'}
            aria-label="Dodaj pobranie z magazynu"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {history && (
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-dim">
            {history}
          </p>
        )}
        {activeIssueDraft && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={activeIssueDraft.value}
              onChange={(event) =>
                setIssueDraft((prev) =>
                  prev && prev.settlementId === settlement.id
                    ? { ...prev, value: event.target.value }
                    : prev
                )
              }
              inputMode="decimal"
              placeholder={activeIssueDraft.direction > 0 ? '+ ilość' : '- ilość'}
              disabled={issueMutation.isPending}
              className="h-9 min-w-0 flex-1"
              autoFocus
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => submitIssueMove(settlement)}
              disabled={issueMutation.isPending}
              className="h-9 px-3 py-0"
            >
              OK
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setIssueDraft(null)}
              disabled={issueMutation.isPending}
              className="h-9 px-3 py-0"
            >
              X
            </Button>
          </div>
        )}
      </div>
    );
  };

  const renderSettlementActions = (settlement: PaintTapeSettlement, compact = false) => {
    const isDone = settlement.status === 'DONE';
    if (isDone) return null;
    return (
      <div className={compact ? 'flex gap-2' : 'flex flex-wrap gap-2'}>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (window.confirm(`Usunąć farbę/taśmę ${settlement.itemName} ze zlecenia ${settlement.orderNumber}?`)) {
              removeMutation.mutate(settlement.id);
            }
          }}
          disabled={!canOpen || activeFilter !== 'OPEN' || removeMutation.isPending}
          className={compact ? 'min-h-[44px] w-12 px-0 py-2' : 'min-h-[40px] px-3 py-2'}
          aria-label="Usuń farbę / taśmę"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  };

  const renderMobileSettlementItem = (settlement: PaintTapeSettlement, group: SettlementGroup) => {
    const draft = getDraft(settlement);
    const erp = getErpForSettlement(settlement);
    const unit = settlement.unit || 'kg';
    const isDone = settlement.status === 'DONE';
    const showPerPiece = activeFilter !== 'OPEN';
    const erpText = erp
      ? `${formatQty(erp.realQty, erp.unit)} rzecz. / ${formatQty(erp.availableQty, erp.unit)} dysp.`
      : 'brak';

    return (
      <section className="border-t border-[rgba(255,255,255,0.10)] py-4 first:border-t-0 first:pt-0 last:pb-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
              Farba / tasma
            </p>
            <p
              className="mt-1 break-words text-sm font-black leading-snug"
              style={{ color: 'var(--brand)' }}
            >
              {settlement.itemName}
            </p>
            {settlement.itemIndexCode && (
              <p className="mt-1 break-words text-xs font-semibold text-dim">
                {settlement.itemIndexCode}
              </p>
            )}
          </div>
          {activeFilter === 'OPEN' && renderSettlementActions(settlement, true)}
        </div>

        <p className="mt-2 text-xs font-semibold leading-snug text-dim">
          ERP {snapshotDate}: {erpText}
        </p>

        {activeFilter === 'OPEN' && (
          <div className="mt-3 space-y-3 rounded-lg border border-[rgba(255,122,26,0.20)] bg-[rgba(255,122,26,0.045)] p-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-dim">
                Pobrane z magazynu
              </label>
              <div className="mt-1">{renderIssuedControl(settlement, true)}</div>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wide text-dim">
                Stan po produkcji
              </label>
              <Input
                value={draft.endQty}
                onChange={(event) => setDraft(settlement, { endQty: event.target.value })}
                inputMode="decimal"
                disabled={!canOpen || isDone || activeFilter !== 'OPEN'}
                aria-label="Stan farby po zakończeniu"
                className="mt-1 h-11"
              />
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div className="flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
              Stan przed
            </p>
            <p className="mt-1 font-black text-title">{formatQty(settlement.startQty, unit)}</p>
          </div>
          {activeFilter !== 'OPEN' && (
            <div className="flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Pobrane
              </p>
              <p className="mt-1 font-black text-title">
                {formatQty(settlement.warehouseIssuedQty, unit)}
              </p>
            </div>
          )}
          {activeFilter !== 'OPEN' && (
            <div className="flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Stan po
              </p>
              <p className="mt-1 font-black text-title">{formatQty(settlement.endQty, unit)}</p>
            </div>
          )}
          <div className="flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Zuzycie</p>
            <p className="mt-1 font-black text-title">{formatQty(settlement.usageQty, unit)}</p>
          </div>
          {showPerPiece && (
            <div className="col-span-2 flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Zuzycie / szt.
              </p>
              <p className="mt-1 break-words font-black leading-tight text-title">
                {formatPerPiece(getUsagePerPiecePreview(settlement, group), unit)}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  };

  const groupedCards = groupedSettlements.map((group) => {
    const firstSettlement = group.items[0];
    if (!firstSettlement) return null;
    const groupProducedDraft = getGroupProducedDraft(group);
    const groupProducedQty = firstSettlement.producedQty;
    const groupBusy = updateGroupMutation.isPending;
    const groupAccounted = group.items.every((settlement) => Boolean(settlement.accountedAt));
    const startedAt = group.items
      .map((settlement) => settlement.createdAt)
      .filter(Boolean)
      .sort()[0];
    const completedDates = group.items
      .map((settlement) => settlement.productionCompletedAt)
      .filter(Boolean)
      .sort();
    const completedAt = completedDates[completedDates.length - 1];
    return (
      <article
        key={group.key}
        className={cn(
          'rounded-xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(0,0,0,0.50))] p-3 shadow-[0_10px_24px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.08)] md:p-4',
          groupAccounted &&
            'border-[color:color-mix(in_srgb,var(--success)_55%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--success)_16%,rgba(255,255,255,0.04)),rgba(0,0,0,0.48))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--success)_25%,transparent),0_16px_38px_rgba(0,0,0,0.30)]'
        )}
      >
        <div className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.08)] pb-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p
              className="break-words text-sm font-black leading-snug text-[var(--value-purple)]"
            >
              {group.detailName}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold">
              <span style={{ color: 'var(--success)' }}>
                Rozpoczęto: {formatDateTime(startedAt) || '-'}
              </span>
              <span style={{ color: 'var(--danger)' }}>
                Zakończono produkcję: {formatDateTime(completedAt) || '-'}
              </span>
            </div>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-dim">Zlecenie</p>
            {renderOrderNumber(firstSettlement, true)}
          </div>
          <div className="flex shrink-0 flex-col gap-3 md:items-end">
            {activeFilter === 'DONE' && (
              <div className="w-full rounded-lg border border-[rgba(124,92,255,0.45)] bg-[rgba(124,92,255,0.10)] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] md:min-w-[190px] md:text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                  Ilość wykonana
                </p>
                <p className="mt-1 text-xl font-black leading-tight text-[var(--value-purple)]">
                  {formatPiecesQty(groupProducedQty)}
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {activeFilter !== 'DONE' && getStatusBadge(firstSettlement)}
              {groupAccounted && <Badge tone="success">Rozliczone</Badge>}
              {group.items.length > 1 && (
                <Badge tone="info">{group.items.length} farby / taśmy</Badge>
              )}
            </div>
            {activeFilter === 'DETAILS_REQUIRED' && (
              <div className="grid gap-2 sm:max-w-[220px]">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Ilość detali</label>
                  <Input
                    value={groupProducedDraft}
                    onChange={(event) =>
                      setGroupProducedDrafts((prev) => ({
                        ...prev,
                        [group.key]: event.target.value
                      }))
                    }
                    inputMode="numeric"
                    disabled={!canDetails || groupBusy}
                    aria-label="Ilość wyprodukowanych detali"
                    className="mt-1 h-10"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 md:hidden">
          {group.items.map((settlement) => (
            <div key={settlement.id}>{renderMobileSettlementItem(settlement, group)}</div>
          ))}
        </div>

        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="bg-[linear-gradient(90deg,rgba(255,122,26,0.16),rgba(255,255,255,0.03))] text-title">
              <tr>
                {[
                  'Farba / taśma',
                  'Stan przed',
                  'Pobrane z magazynu',
                  'Stan po',
                  'Zużycie',
                  ...(activeFilter === 'OPEN' ? [] : ['Zużycie / szt.']),
                  ...(activeFilter === 'DONE' ? [] : ['Akcje'])
                ].map((column) => (
                  <th
                    key={`${group.key}-${column}`}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-title"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.items.map((settlement) => {
                const draft = getDraft(settlement);
                const erp = getErpForSettlement(settlement);
                const unit = settlement.unit || 'kg';
                const isDone = settlement.status === 'DONE';
                const showPerPiece = activeFilter !== 'OPEN';
                const showActions = activeFilter !== 'DONE';
                return (
                  <tr
                    key={settlement.id}
                    className="border-t border-[rgba(255,255,255,0.08)] text-body"
                  >
                    <td className="px-4 py-3">
                      <div className="min-w-[220px]">
                        <p className="font-semibold" style={{ color: 'var(--brand)' }}>
                          {settlement.itemName}
                        </p>
                        {settlement.itemIndexCode && (
                          <p className="mt-1 text-xs text-dim">{settlement.itemIndexCode}</p>
                        )}
                        <p className="mt-1 text-xs text-dim">
                          ERP {snapshotDate}:{' '}
                          {erp ? `${formatQty(erp.realQty, erp.unit)} rzecz. / ${formatQty(erp.availableQty, erp.unit)} dysp.` : 'brak'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">{formatQty(settlement.startQty, unit)}</td>
                    <td className="px-4 py-3">{renderIssuedControl(settlement)}</td>
                    <td className="px-4 py-3">
                      <Input
                        value={draft.endQty}
                        onChange={(event) => setDraft(settlement, { endQty: event.target.value })}
                        inputMode="decimal"
                        disabled={!canOpen || isDone || activeFilter !== 'OPEN'}
                        aria-label="Stan farby po zakończeniu"
                        className="min-w-[110px]"
                      />
                    </td>
                    <td className="px-4 py-3">{formatQty(settlement.usageQty, unit)}</td>
                    {showPerPiece && (
                      <td className="px-4 py-3">
                        {formatPerPiece(getUsagePerPiecePreview(settlement, group), unit)}
                      </td>
                    )}
                    {showActions && (
                      <td className="px-4 py-3">{renderSettlementActions(settlement)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {activeFilter === 'OPEN' && (
          <div className="mt-4 border-t border-[rgba(255,255,255,0.10)] pt-4 md:flex md:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleSaveOpenGroup(group)}
              disabled={!canOpen || groupBusy}
              className="min-h-[42px] w-full px-3 py-2 md:w-auto"
            >
              <Save className="mr-2 h-4 w-4" />
              Przesuń zlecenie do wpisu ilości
            </Button>
          </div>
        )}

        {activeFilter === 'DETAILS_REQUIRED' && (
          <div className="mt-4 grid gap-2 border-t border-[rgba(255,255,255,0.10)] pt-4 sm:grid-cols-2 md:flex md:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleSaveDetailsGroup(group)}
              disabled={!canDetails || groupBusy}
              className="min-h-[42px] w-full px-3 py-2 md:w-auto"
            >
              <Save className="mr-2 h-4 w-4" />
              Przesuń do zakończonych
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleMoveGroupBackToOpen(group)}
              disabled={!canDetails || groupBusy}
              className="min-h-[42px] w-full px-3 py-2 md:w-auto"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Cofnij do otwartych
            </Button>
          </div>
        )}
        {activeFilter === 'DONE' && (
          <div className="mt-4 grid gap-2 border-t border-[rgba(255,255,255,0.10)] pt-4 sm:grid-cols-2 md:flex md:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleAccountedGroup(group)}
              disabled={!canAccounting || groupBusy}
              aria-pressed={groupAccounted}
              className={cn(
                'min-h-[42px] w-full px-3 py-2 md:w-auto',
                groupAccounted &&
                  'border-[color:color-mix(in_srgb,var(--success)_65%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_16%,transparent)] text-success'
              )}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Rozliczone
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleReopenGroup(group)}
              disabled={!canAccounting || groupBusy}
              className="min-h-[42px] w-full px-3 py-2 md:w-auto"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Cofnij zlecenie
            </Button>
          </div>
        )}
      </article>
    );
  });

  const celebrationOverlay = celebrationVisible ? (
    <div
      className="pointer-events-none fixed inset-0 z-[1200] flex items-center justify-center overflow-hidden bg-[rgba(5,6,10,0.34)] px-4"
      aria-live="polite"
    >
      <div className="paint-tape-celebration relative flex min-h-[320px] w-full max-w-[520px] flex-col items-center justify-center">
        <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2">
          {celebrationParticles.map((particle) => (
            <span
              key={particle.id}
              className="paint-tape-celebration-particle absolute left-1/2 top-1/2 rounded-full"
              style={
                {
                  '--angle': `${particle.angle}deg`,
                  '--distance': `${particle.distance}px`,
                  '--delay': `${particle.delay}s`,
                  width: `${particle.size}px`,
                  height: `${particle.size}px`,
                  backgroundColor: particle.color
                } as CSSProperties
              }
            />
          ))}
        </div>

        <div className="paint-tape-teddy relative h-[250px] w-[296px] overflow-hidden rounded-2xl drop-shadow-[0_26px_54px_rgba(0,0,0,0.45)] sm:h-[300px] sm:w-[356px]">
          <iframe
            src="https://tenor.com/embed/23978789"
            title="Bear Dance GIF"
            className="h-full w-full border-0"
            allowFullScreen
            loading="lazy"
          />
        </div>
        <div className="paint-tape-celebration-text mt-4 rounded-2xl border border-[rgba(255,255,255,0.16)] bg-[rgba(9,10,14,0.82)] px-5 py-4 text-center shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-success">
            Gratulacje
          </p>
          <p className="mt-1 text-xl font-black text-title sm:text-2xl">
            Rozliczyłaś zlecenie
          </p>
        </div>
      </div>
    </div>
  ) : null;

  const statusButtonClass =
    'flex min-h-[50px] min-w-0 items-center justify-center whitespace-normal break-words border-[rgba(255,122,26,0.22)] bg-[rgba(255,122,26,0.035)] px-2 py-2 text-center text-[12px] leading-tight shadow-[0_8px_22px_rgba(255,122,26,0.08)] data-[state=active]:shadow-[0_0_0_2px_rgba(255,122,26,0.22),0_0_22px_rgba(255,122,26,0.28),inset_0_1px_0_rgba(255,255,255,0.1)] sm:min-h-[44px] sm:px-3 sm:text-sm';

  const statusFilters = (
    <Tabs value={activeFilter} onValueChange={(value) => setFilter(value as FilterValue)}>
      <TabsList className="grid w-full grid-cols-2 gap-2 border-0 bg-transparent p-0 shadow-none sm:grid-cols-4">
        {visibleFilters.map((item) => (
          <TabsTrigger key={item.value} className={statusButtonClass} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
  return (
    <div className="space-y-5">
      {celebrationOverlay}
      {statusFilters}

      {visibleFilters.length === 0 && (
        <Card>
          <EmptyState
            title="Brak dostepu do etapow"
            description="Administrator musi wlaczyc przynajmniej jeden etap rozliczania farb i tasm."
          />
        </Card>
      )}

      {activeFilter === 'CREATE' && visibleFilters.length > 0 && (
      <Card className="space-y-5 border-0 bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent md:border-border md:bg-surface md:p-6 md:shadow-[inset_0_1px_0_var(--inner-highlight)] md:hover:border-borderStrong md:hover:bg-surface2">
        <form onSubmit={handleCreate} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Numer zlecenia</label>
              <div className="relative mt-1">
                <Input
                  value={form.orderNumber}
                  onChange={(event) => setForm((prev) => ({ ...prev, orderNumber: event.target.value }))}
                  placeholder="opcjonalnie, np. ZL/123"
                  disabled={!canCreate}
                  className="pr-10"
                />
                {form.orderNumber && (
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, orderNumber: '' }))}
                    disabled={!canCreate}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-dim transition hover:bg-[rgba(255,255,255,0.08)] hover:text-title disabled:opacity-40"
                    aria-label="Wyczyść numer zlecenia"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Nazwa detalu</label>
              <div className="relative mt-1">
                <Input
                  value={form.detailName}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, detailName: event.target.value }));
                    setShowDetailSuggestions(normalizeKey(event.target.value).length >= 2);
                  }}
                  onFocus={() => setShowDetailSuggestions(normalizeKey(form.detailName).length >= 2)}
                  onBlur={() => {
                    setTimeout(() => setShowDetailSuggestions(false), 120);
                  }}
                  placeholder="zacznij wpisywać"
                  disabled={!canCreate}
                  className="pr-10"
                />
                {form.detailName && (
                  <button
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, detailName: '' }));
                      setShowDetailSuggestions(false);
                    }}
                    disabled={!canCreate}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-dim transition hover:bg-[rgba(255,255,255,0.08)] hover:text-title disabled:opacity-40"
                    aria-label="Wyczyść nazwę detalu"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                {showDetailSuggestions && detailSuggestions.length > 0 && (
                  <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_16px_36px_rgba(0,0,0,0.48)]">
                    {detailSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setForm((prev) => ({ ...prev, detailName: name }));
                          setShowDetailSuggestions(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm font-semibold text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Farby / taśmy
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={addItemDraft}
                disabled={!canCreate || createMutation.isPending}
                className="min-h-[40px] shrink-0 px-3 py-2"
              >
                <Plus className="mr-2 h-4 w-4" />
                Dodaj farbę / taśmę
              </Button>
            </div>

            <div className="border-t border-[rgba(255,255,255,0.10)] md:space-y-3 md:border-t-0">
              {itemDrafts.map((draft, index) => {
                const itemSuggestions = getItemSuggestions(draft.itemName);
                const formErpSnapshot = getFormErpSnapshot(draft.itemName);
                return (
                  <div
                    key={draft.id}
                    className="grid gap-3 border-b border-[rgba(255,255,255,0.10)] py-4 last:border-b-0 md:rounded-xl md:border md:border-[rgba(255,255,255,0.10)] md:bg-[rgba(255,255,255,0.03)] md:p-3 md:last:border-b md:grid-cols-[minmax(0,1fr)_180px_auto]"
                  >
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">
                        Farba / taśma {index + 1}
                      </label>
                      <div className="relative mt-1">
                        <Input
                          value={draft.itemName}
                          onChange={(event) => {
                            updateItemDraft(draft.id, { itemName: event.target.value });
                            setShowItemSuggestionsFor(
                              normalizeKey(event.target.value).length >= 2 ? draft.id : null
                            );
                          }}
                          onFocus={() =>
                            setShowItemSuggestionsFor(
                              normalizeKey(draft.itemName).length >= 2 ? draft.id : null
                            )
                          }
                          onBlur={() => {
                            setTimeout(() => {
                              setShowItemSuggestionsFor((current) =>
                                current === draft.id ? null : current
                              );
                            }, 120);
                          }}
                          placeholder="zacznij wpisywać"
                          disabled={!canCreate}
                          className="pr-10"
                        />
                        {draft.itemName && (
                          <button
                            type="button"
                            onClick={() => {
                              updateItemDraft(draft.id, { itemName: '' });
                              setShowItemSuggestionsFor(null);
                            }}
                            disabled={!canCreate}
                            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-dim transition hover:bg-[rgba(255,255,255,0.08)] hover:text-title disabled:opacity-40"
                            aria-label="Wyczyść farbę / taśmę"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        {showItemSuggestionsFor === draft.id && itemSuggestions.length > 0 && (
                          <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_16px_36px_rgba(0,0,0,0.48)]">
                            {itemSuggestions.map((item) => (
                              <button
                                key={`${draft.id}-${item.id}-${item.indexCode ?? item.name}`}
                                type="button"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  updateItemDraft(draft.id, { itemName: item.name });
                                  setShowItemSuggestionsFor(null);
                                }}
                                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                              >
                                <span className="min-w-0 font-semibold">{item.name}</span>
                                {item.indexCode && (
                                  <span className="shrink-0 text-xs font-semibold text-dim">
                                    {item.indexCode}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-dim">
                        ERP {snapshotDate}:{' '}
                        {formErpSnapshot
                          ? `${formatQty(formErpSnapshot.realQty, formErpSnapshot.unit)} rzecz. / ${formatQty(
                              formErpSnapshot.availableQty,
                              formErpSnapshot.unit
                            )} dysp.`
                          : erpSnapshotError
                            ? 'brak wgranego stanu lub migracji'
                            : 'brak'}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">
                        Stan przed
                      </label>
                      <div className="relative mt-1">
                        <Input
                          value={draft.startQty}
                          onChange={(event) =>
                            updateItemDraft(draft.id, { startQty: event.target.value })
                          }
                          inputMode="decimal"
                          placeholder="np. 5,2"
                          disabled={!canCreate}
                          className="pr-10"
                        />
                        {draft.startQty && (
                          <button
                            type="button"
                            onClick={() => updateItemDraft(draft.id, { startQty: '' })}
                            disabled={!canCreate}
                            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-dim transition hover:bg-[rgba(255,255,255,0.08)] hover:text-title disabled:opacity-40"
                            aria-label="Wyczyść stan przed"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-end justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeItemDraft(draft.id)}
                        disabled={!canCreate || itemDrafts.length <= 1 || createMutation.isPending}
                        className="min-h-[40px] w-11 px-0 py-2"
                        aria-label="Usuń farbę / taśmę"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[rgba(255,255,255,0.10)] pt-4">
            <Button
              type="submit"
              disabled={!canCreate || createMutation.isPending}
              className="w-full sm:w-auto"
            >
              <Plus className="mr-2 h-4 w-4" />
              Dodaj zlecenie
            </Button>
          </div>
        </form>
      </Card>
      )}

      {activeFilter !== 'CREATE' && visibleFilters.length > 0 && (
      <Card className="space-y-4 border-0 bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent md:border-border md:bg-surface md:p-6 md:shadow-[inset_0_1px_0_var(--inner-highlight)] md:hover:border-borderStrong md:hover:bg-surface2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Tabela rozliczeń
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[220px_180px]">
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Szukaj</label>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="zlecenie, detal, farba"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Dzień stanu ERP</label>
              <Input
                type="date"
                value={snapshotDate}
                onChange={(event) => setSnapshotDate(event.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-dim">Ładowanie rozliczeń...</p>
        ) : groupedSettlements.length === 0 ? (
          <EmptyState title="Brak rozliczeń" description="Dodaj pierwsze zlecenie powyżej." />
        ) : (
          <div className="space-y-3">{groupedCards}</div>
        )}
      </Card>
      )}
    </div>
  );
}
