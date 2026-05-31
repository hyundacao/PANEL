'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Minus, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
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
import { isReadOnly } from '@/lib/auth/access';
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
    .join(' · ');

const formatPerPiece = (value: number | null | undefined, unit = 'kg') => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${value.toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  })} ${unit}/szt.`;
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
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterValue>('CREATE');
  const [query, setQuery] = useState('');
  const [snapshotDate, setSnapshotDate] = useState(getLocalDateValue());
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [groupProducedDrafts, setGroupProducedDrafts] = useState<Record<string, string>>({});
  const [groupExtraOrderDrafts, setGroupExtraOrderDrafts] = useState<Record<string, string>>({});
  const [issueDraft, setIssueDraft] = useState<IssueDraft | null>(null);
  const [showDetailSuggestions, setShowDetailSuggestions] = useState(false);
  const [showItemSuggestionsFor, setShowItemSuggestionsFor] = useState<string | null>(null);
  const [form, setForm] = useState({
    orderNumber: '',
    detailName: ''
  });
  const nextItemDraftId = useRef(2);
  const [itemDrafts, setItemDrafts] = useState<PaintTapeItemDraft[]>([
    createEmptyPaintTapeItem(1)
  ]);

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
    onSuccess: () => {
      setDrafts({});
      setGroupProducedDrafts({});
      setGroupExtraOrderDrafts({});
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
      if (filter === 'CREATE' || settlement.status !== filter) return false;
      if (!normalizedQuery) return true;
      return [
        settlement.orderNumber,
        settlement.detailName,
        settlement.itemName,
        settlement.itemIndexCode
      ].some((value) => matchesTokenSearch(value, normalizedQuery));
    });
  }, [filter, query, settlements]);

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

  const appendOrderNumber = (currentValue: string, nextValue: string) => {
    const currentParts = currentValue
      .split(/[;,/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const nextParts = nextValue
      .split(/[;,/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const values = new Map<string, string>();
    [...currentParts, ...nextParts].forEach((part) => {
      const key = normalizeKey(part);
      if (key && !values.has(key)) values.set(key, part);
    });
    return [...values.values()].join(', ');
  };

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validItemDrafts = itemDrafts.filter(
      (draft) => draft.itemName.trim() || draft.startQty.trim()
    );
    if (!form.orderNumber.trim() || !form.detailName.trim() || validItemDrafts.length === 0) {
      toast({ title: 'Uzupełnij numer zlecenia, detal i przynajmniej jedną farbę/taśmę.', tone: 'error' });
      return;
    }
    const payloads = validItemDrafts.map((draft) => {
      const startQty = parseQtyInput(draft.startQty);
      const item = getSelectedItem(draft.itemName);
      return {
        draft,
        startQty,
        payload: {
          orderNumber: form.orderNumber.trim(),
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
    const nextId = nextItemDraftId.current;
    nextItemDraftId.current += 1;
    setItemDrafts((prev) => [...prev, createEmptyPaintTapeItem(nextId)]);
  };

  const removeItemDraft = (id: string) => {
    setItemDrafts((prev) =>
      prev.length <= 1 ? prev : prev.filter((draft) => draft.id !== id)
    );
    setShowItemSuggestionsFor((current) => (current === id ? null : current));
  };

  const handleSaveOpenGroup = (group: SettlementGroup) => {
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
        producedQty: null
      }))
    );
  };

  const handleAddOrderNumber = (group: SettlementGroup) => {
    const firstSettlement = group.items[0];
    if (!firstSettlement) return;
    const extraOrderNumber = String(groupExtraOrderDrafts[group.key] ?? '').trim();
    if (!extraOrderNumber) {
      toast({ title: 'Wpisz kolejny numer zlecenia.', tone: 'error' });
      return;
    }
    const currentOrderNumber =
      getDraft(firstSettlement).orderNumber.trim() ||
      group.orderNumber.trim() ||
      firstSettlement.orderNumber.trim();
    const nextOrderNumber = appendOrderNumber(currentOrderNumber, extraOrderNumber);
    setDraft(firstSettlement, { orderNumber: nextOrderNumber });
    setGroupExtraOrderDrafts((prev) => ({ ...prev, [group.key]: '' }));
  };

  const handleSaveDetailsGroup = (group: SettlementGroup) => {
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
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        reopen: true
      }))
    );
  };

  const handleMoveGroupBackToOpen = (group: SettlementGroup) => {
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        producedQty: null,
        moveToOpen: true
      }))
    );
  };

  const handleAccountedGroup = (group: SettlementGroup) => {
    updateGroupMutation.mutate(
      group.items.map((settlement) => ({
        id: settlement.id,
        accounted: true
      }))
    );
  };

  const handleIssueMove = (settlement: PaintTapeSettlement, direction: 1 | -1) => {
    setIssueDraft({ settlementId: settlement.id, direction, value: '' });
  };

  const submitIssueMove = (settlement: PaintTapeSettlement) => {
    if (!issueDraft || issueDraft.settlementId !== settlement.id) return;
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
          {settlement.orderNumber}
        </p>
      );
    }
    return (
      <Input
        value={draft.orderNumber}
        onChange={(event) => setDraft(settlement, { orderNumber: event.target.value })}
        disabled={readOnly || updateGroupMutation.isPending}
        aria-label="Numer zlecenia"
        className={compact ? 'mt-1 h-10 font-black text-[var(--value-purple)]' : 'h-10 min-w-[120px] font-black text-[var(--value-purple)]'}
      />
    );
  };

  const renderIssuedControl = (settlement: PaintTapeSettlement, compact = false) => {
    const disabled = readOnly || settlement.status === 'DONE' || issueMutation.isPending;
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
          disabled={readOnly || removeMutation.isPending}
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
    const erpText = erp
      ? `${formatQty(erp.realQty, erp.unit)} rzecz. / ${formatQty(erp.availableQty, erp.unit)} dysp.`
      : 'brak';

    return (
      <div className="rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(0,0,0,0.22)] p-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Farba / taśma</p>
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
          <p className="mt-2 text-xs font-semibold leading-snug text-dim">
            ERP {snapshotDate}: {erpText}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-[rgba(255,255,255,0.08)] pt-3">
          <div className="min-h-[68px]">
            <p className="h-4 text-[10px] font-semibold uppercase tracking-wide text-dim">Stan przed</p>
            <p className="mt-1 flex h-10 items-center text-base font-black text-title">
              {formatQty(settlement.startQty, unit)}
            </p>
          </div>
          <div className="min-h-[68px]">
            <label className="block h-4 truncate text-[10px] font-semibold uppercase tracking-wide text-dim">
              Pobrane z magazynu
            </label>
            <div className="mt-1">{renderIssuedControl(settlement, true)}</div>
          </div>
          <div className="min-h-[68px]">
            <label className="block h-4 text-[10px] font-semibold uppercase tracking-wide text-dim">Stan po</label>
            <Input
              value={draft.endQty}
              onChange={(event) => setDraft(settlement, { endQty: event.target.value })}
              inputMode="decimal"
              disabled={readOnly || isDone || filter !== 'OPEN'}
              aria-label="Stan farby po zakończeniu"
              className="mt-1 h-10"
            />
          </div>
          <div className="min-h-[68px]">
            <p className="h-4 text-[10px] font-semibold uppercase tracking-wide text-dim">Zużycie</p>
            <p className="mt-1 flex h-10 items-center text-base font-black text-title">
              {formatQty(settlement.usageQty, unit)}
            </p>
          </div>
          {filter !== 'OPEN' && (
            <div className="min-h-[68px]">
              <p className="h-4 text-[10px] font-semibold uppercase tracking-wide text-dim">Zużycie / szt.</p>
              <p className="mt-1 flex min-h-10 items-center break-words text-base font-black leading-tight text-title">
                {formatPerPiece(getUsagePerPiecePreview(settlement, group), unit)}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-[rgba(255,255,255,0.08)] pt-3">
          {renderSettlementActions(settlement, true)}
        </div>
      </div>
    );
  };

  const groupedCards = groupedSettlements.map((group) => {
    const firstSettlement = group.items[0];
    if (!firstSettlement) return null;
    const groupProducedDraft = getGroupProducedDraft(group);
    const groupBusy = updateGroupMutation.isPending;
    const groupAccounted = group.items.every((settlement) => Boolean(settlement.accountedAt));
    return (
      <article
        key={group.key}
        className={cn(
          'rounded-xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(0,0,0,0.50))] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.08)]',
          groupAccounted &&
            'border-[color:color-mix(in_srgb,var(--success)_55%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--success)_16%,rgba(255,255,255,0.04)),rgba(0,0,0,0.48))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--success)_25%,transparent),0_16px_38px_rgba(0,0,0,0.30)]'
        )}
      >
        <div className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.08)] pb-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Zlecenie</p>
            {renderOrderNumber(firstSettlement, true)}
            {filter === 'OPEN' && (
              <div className="mt-2 grid max-w-xl gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Input
                  value={groupExtraOrderDrafts[group.key] ?? ''}
                  onChange={(event) =>
                    setGroupExtraOrderDrafts((prev) => ({
                      ...prev,
                      [group.key]: event.target.value
                    }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddOrderNumber(group);
                    }
                  }}
                  placeholder="kolejny numer zlecenia"
                  disabled={readOnly || groupBusy}
                  className="h-10"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleAddOrderNumber(group)}
                  disabled={readOnly || groupBusy}
                  className="min-h-[40px] px-3 py-2"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Dodaj numer
                </Button>
              </div>
            )}
            <p
              className="mt-2 break-words text-sm font-semibold leading-snug"
              style={{ color: 'var(--brand)' }}
            >
              {group.detailName}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 md:items-end">
            <div className="flex flex-wrap items-center gap-2">
              {getStatusBadge(firstSettlement)}
              {groupAccounted && <Badge tone="success">Rozliczone</Badge>}
              {group.items.length > 1 && (
                <Badge tone="info">{group.items.length} farby / taśmy</Badge>
              )}
            </div>
            {filter === 'OPEN' && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleSaveOpenGroup(group)}
                disabled={readOnly || groupBusy}
                className="min-h-[42px] px-3 py-2"
              >
                <Save className="mr-2 h-4 w-4" />
                Przesuń zlecenie do wpisu ilości
              </Button>
            )}
            {filter === 'DETAILS_REQUIRED' && (
              <div className="grid gap-2 sm:grid-cols-[180px_auto_auto]">
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
                    disabled={readOnly || groupBusy}
                    aria-label="Ilość wyprodukowanych detali"
                    className="mt-1 h-10"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleSaveDetailsGroup(group)}
                    disabled={readOnly || groupBusy}
                    className="min-h-[42px] px-3 py-2"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Przesuń do zakończonych
                  </Button>
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleMoveGroupBackToOpen(group)}
                    disabled={readOnly || groupBusy}
                    className="min-h-[42px] px-3 py-2"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Cofnij do otwartych
                  </Button>
                </div>
              </div>
            )}
            {filter === 'DONE' && (
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleAccountedGroup(group)}
                  disabled={readOnly || groupBusy || groupAccounted}
                  className={cn(
                    'min-h-[42px] px-3 py-2',
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
                  disabled={readOnly || groupBusy}
                  className="min-h-[42px] px-3 py-2"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Cofnij zlecenie
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-3 md:hidden">
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
                  ...(filter === 'OPEN' ? [] : ['Zużycie / szt.']),
                  ...(filter === 'DONE' ? [] : ['Akcje'])
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
                const showPerPiece = filter !== 'OPEN';
                const showActions = filter !== 'DONE';
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
                        disabled={readOnly || isDone || filter !== 'OPEN'}
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
      </article>
    );
  });

  const statusButtonClass =
    'min-h-[48px] border-[rgba(255,122,26,0.22)] bg-[rgba(255,122,26,0.035)] px-4 py-2.5 text-center leading-tight shadow-[0_8px_22px_rgba(255,122,26,0.08)] data-[state=active]:shadow-[0_0_0_2px_rgba(255,122,26,0.22),0_0_22px_rgba(255,122,26,0.28),inset_0_1px_0_rgba(255,255,255,0.1)]';

  const statusFilters = (
    <Tabs value={filter} onValueChange={(value) => setFilter(value as FilterValue)}>
      <TabsList className="grid w-full grid-cols-1 gap-2 border-0 bg-transparent p-0 shadow-none sm:grid-cols-4">
        <TabsTrigger className={statusButtonClass} value="CREATE">
          Dodaj zlecenie
        </TabsTrigger>
        <TabsTrigger className={statusButtonClass} value="OPEN">
          Otwarte zlecenia
        </TabsTrigger>
        <TabsTrigger className={statusButtonClass} value="DETAILS_REQUIRED">
          Zlecenia do wpisania ilości
        </TabsTrigger>
        <TabsTrigger className={statusButtonClass} value="DONE">
          Zakończone zlecenia
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return (
    <div className="space-y-5">
      {statusFilters}

      {filter === 'CREATE' && (
      <Card>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Nowe rozliczenie
              </p>
              <p className="text-sm text-dim">
                Numer zlecenia wpisz ręcznie, a detal i farbę/taśmę wybierz z podpowiedzi.
              </p>
            </div>
            <Button type="submit" disabled={readOnly || createMutation.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Dodaj zlecenie
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Numer zlecenia</label>
              <Input
                value={form.orderNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, orderNumber: event.target.value }))}
                placeholder="np. ZL/123"
                disabled={readOnly}
                className="mt-1"
              />
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
                  disabled={readOnly}
                />
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Farby / taśmy
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={addItemDraft}
                disabled={readOnly || createMutation.isPending}
                className="min-h-[40px] px-3 py-2"
              >
                <Plus className="mr-2 h-4 w-4" />
                Dodaj farbę / taśmę
              </Button>
            </div>

            <div className="space-y-3">
              {itemDrafts.map((draft, index) => {
                const itemSuggestions = getItemSuggestions(draft.itemName);
                const formErpSnapshot = getFormErpSnapshot(draft.itemName);
                return (
                  <div
                    key={draft.id}
                    className="grid gap-3 rounded-xl border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.03)] p-3 md:grid-cols-[minmax(0,1fr)_180px_auto]"
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
                          disabled={readOnly}
                        />
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
                      <Input
                        value={draft.startQty}
                        onChange={(event) =>
                          updateItemDraft(draft.id, { startQty: event.target.value })
                        }
                        inputMode="decimal"
                        placeholder="np. 5,2"
                        disabled={readOnly}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeItemDraft(draft.id)}
                        disabled={readOnly || itemDrafts.length <= 1 || createMutation.isPending}
                        className="min-h-[40px] w-full px-3 py-2 md:w-11 md:px-0"
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
        </form>
      </Card>
      )}

      {filter !== 'CREATE' && (
      <Card className="space-y-4">
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
