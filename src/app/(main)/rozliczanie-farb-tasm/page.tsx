'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
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
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';
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
  settlement.warehouseIssuedIssues
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
  const [issueDraft, setIssueDraft] = useState<IssueDraft | null>(null);
  const [showDetailSuggestions, setShowDetailSuggestions] = useState(false);
  const [showItemSuggestions, setShowItemSuggestions] = useState(false);
  const [form, setForm] = useState({
    orderNumber: '',
    detailName: '',
    itemName: '',
    startQty: ''
  });

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
    queryFn: getProductionDetailSuggestions
  });

  const { data: erpSnapshot = [], error: erpSnapshotError } = useQuery({
    queryKey: ['spis-oryginalow-erp-snapshot', snapshotDate],
    queryFn: () => getOriginalInventoryErpSnapshot(snapshotDate),
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

  const selectedItem = useMemo(() => {
    const rawValue = form.itemName.includes('|')
      ? form.itemName.split('|')[0]?.trim() ?? form.itemName
      : form.itemName;
    const itemKey = normalizeKey(rawValue);
    if (!itemKey) return null;
    return itemCatalog.find(
      (item) => normalizeKey(item.name) === itemKey || normalizeKey(item.indexCode) === itemKey
    ) ?? null;
  }, [form.itemName, itemCatalog]);

  const snapshotMap = useMemo(() => buildSnapshotMap(erpSnapshot), [erpSnapshot]);

  const getErpForSettlement = (settlement: PaintTapeSettlement) =>
    snapshotMap.get(normalizeKey(settlement.itemIndexCode)) ??
    snapshotMap.get(normalizeKey(settlement.itemName)) ??
    null;

  const formErpSnapshot =
    snapshotMap.get(normalizeKey(selectedItem?.indexCode)) ??
    snapshotMap.get(normalizeKey(selectedItem?.name ?? form.itemName)) ??
    null;

  const detailSuggestions = useMemo(() => {
    const needle = normalizeKey(form.detailName);
    if (needle.length < 2) return [];
    return detailNames
      .filter((name) => matchesTokenSearch(name, needle))
      .sort(compareDetailSuggestions)
      .slice(0, 12);
  }, [detailNames, form.detailName]);

  const itemSuggestions = useMemo(() => {
    const rawNeedle = form.itemName.includes('|')
      ? form.itemName.split('|')[0]?.trim() ?? form.itemName
      : form.itemName;
    const needle = normalizeKey(rawNeedle);
    if (needle.length < 2) return [];
    const source = needle
      ? itemCatalog.filter(
          (item) =>
            matchesTokenSearch(`${item.name} ${item.indexCode}`, needle)
        )
      : [];
    return source.slice(0, 14);
  }, [form.itemName, itemCatalog]);

  const createMutation = useMutation({
    mutationFn: createPaintTapeSettlement,
    onSuccess: () => {
      setForm({
        orderNumber: '',
        detailName: '',
        itemName: '',
        startQty: ''
      });
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

  const updateMutation = useMutation({
    mutationFn: updatePaintTapeSettlement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-settlements'] });
      toast({ title: 'Zapisano rozliczenie', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie udało się zapisać zmian', tone: 'error' });
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

  const getDraft = (settlement: PaintTapeSettlement): RowDraft =>
    drafts[settlement.id] ?? {
      orderNumber: settlement.orderNumber,
      endQty: numberInputValue(settlement.endQty),
      producedQty: numberInputValue(settlement.producedQty)
    };

  const setDraft = (id: string, patch: Partial<RowDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        orderNumber: prev[id]?.orderNumber ?? '',
        endQty: prev[id]?.endQty ?? '',
        producedQty: prev[id]?.producedQty ?? '',
        ...patch
      }
    }));
  };

  const handleCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const startQty = parseQtyInput(form.startQty);
    const item = selectedItem;
    if (!form.orderNumber.trim() || !form.detailName.trim() || !form.itemName.trim()) {
      toast({ title: 'Uzupełnij numer zlecenia, detal i farbę/taśmę.', tone: 'error' });
      return;
    }
    if (startQty === null) {
      toast({ title: 'Podaj stan farby przed rozpoczęciem.', tone: 'error' });
      return;
    }
    createMutation.mutate({
      orderNumber: form.orderNumber.trim(),
      detailName: form.detailName.trim(),
      itemName: item?.name ?? form.itemName.trim(),
      itemIndexCode: item?.indexCode ?? null,
      unit: item?.unit ?? 'kg',
      startQty,
      warehouseIssuedQty: 0
    });
  };

  const handleSaveRow = (settlement: PaintTapeSettlement) => {
    const draft = getDraft(settlement);
    const orderNumber = draft.orderNumber.trim();
    const endQty = draft.endQty.trim() ? parseQtyInput(draft.endQty) : null;
    const producedQty = draft.producedQty.trim() ? parseQtyInput(draft.producedQty) : null;
    if (!orderNumber) {
      toast({ title: 'Podaj numer zlecenia.', tone: 'error' });
      return;
    }
    if (draft.endQty.trim() && endQty === null) {
      toast({ title: 'Podaj poprawny stan po zakończeniu.', tone: 'error' });
      return;
    }
    if (draft.producedQty.trim() && producedQty === null) {
      toast({ title: 'Podaj poprawną ilość detali.', tone: 'error' });
      return;
    }
    updateMutation.mutate({
      id: settlement.id,
      orderNumber,
      endQty,
      producedQty
    });
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

  const handleReopenRow = (settlement: PaintTapeSettlement) => {
    updateMutation.mutate({
      id: settlement.id,
      reopen: true
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
        onChange={(event) => setDraft(settlement.id, { orderNumber: event.target.value })}
        disabled={readOnly || updateMutation.isPending}
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

  const rows = filteredSettlements.map((settlement) => {
    const draft = getDraft(settlement);
    const erp = getErpForSettlement(settlement);
    const unit = settlement.unit || 'kg';
    const isDone = settlement.status === 'DONE';
    return [
      <div key={`${settlement.id}-order`} className="min-w-[150px]">
        {renderOrderNumber(settlement)}
        <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--brand)' }}>
          {settlement.detailName}
        </p>
      </div>,
      getStatusBadge(settlement),
      <div key={`${settlement.id}-item`} className="min-w-[180px]">
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
      </div>,
      formatQty(settlement.startQty, unit),
      <div key={`${settlement.id}-issued`}>{renderIssuedControl(settlement)}</div>,
      <Input
        key={`${settlement.id}-end`}
        value={draft.endQty}
        onChange={(event) => setDraft(settlement.id, { endQty: event.target.value })}
        inputMode="decimal"
        disabled={readOnly || isDone}
        aria-label="Stan farby po zakończeniu"
        className="min-w-[110px]"
      />,
      formatQty(settlement.usageQty, unit),
      <Input
        key={`${settlement.id}-produced`}
        value={draft.producedQty}
        onChange={(event) => setDraft(settlement.id, { producedQty: event.target.value })}
        inputMode="numeric"
        disabled={readOnly || isDone}
        aria-label="Ilość wyprodukowanych detali"
        className="min-w-[110px]"
      />,
      formatPerPiece(settlement.usagePerPiece, unit),
      <div key={`${settlement.id}-actions`} className="flex flex-wrap gap-2">
        {isDone && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleReopenRow(settlement)}
            disabled={readOnly || updateMutation.isPending}
            className="min-h-[40px] px-3 py-2"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Cofnij do edycji
          </Button>
        )}
        {!isDone && (
          <>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleSaveRow(settlement)}
          disabled={readOnly || updateMutation.isPending}
          className="min-h-[40px] px-3 py-2"
        >
          <Save className="mr-2 h-4 w-4" />
          Zapisz
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (window.confirm(`Usunąć rozliczenie ${settlement.orderNumber}?`)) {
              removeMutation.mutate(settlement.id);
            }
          }}
          disabled={readOnly || removeMutation.isPending}
          className="min-h-[40px] px-3 py-2"
          aria-label="Usuń rozliczenie"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
          </>
        )}
      </div>
    ];
  });

  const mobileCards = filteredSettlements.map((settlement) => {
    const draft = getDraft(settlement);
    const erp = getErpForSettlement(settlement);
    const unit = settlement.unit || 'kg';
    const isDone = settlement.status === 'DONE';
    const erpText = erp
      ? `${formatQty(erp.realQty, erp.unit)} rzecz. / ${formatQty(erp.availableQty, erp.unit)} dysp.`
      : 'brak';

    return (
      <article
        key={settlement.id}
        className="rounded-xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(0,0,0,0.48))] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Zlecenie</p>
            {renderOrderNumber(settlement, true)}
          </div>
          <div className="shrink-0">{getStatusBadge(settlement)}</div>
        </div>

        <p
          className="mt-2 break-words text-sm font-semibold leading-snug"
          style={{ color: 'var(--brand)' }}
        >
          {settlement.detailName}
        </p>

        <div className="mt-4 border-t border-[rgba(255,255,255,0.08)] pt-3">
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
              onChange={(event) => setDraft(settlement.id, { endQty: event.target.value })}
              inputMode="decimal"
              disabled={readOnly || isDone}
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
          <div className="min-h-[68px]">
            <label className="block h-4 text-[10px] font-semibold uppercase tracking-wide text-dim">
              Ilość detali
            </label>
            <Input
              value={draft.producedQty}
              onChange={(event) => setDraft(settlement.id, { producedQty: event.target.value })}
              inputMode="numeric"
              disabled={readOnly || isDone}
              aria-label="Ilość wyprodukowanych detali"
              className="mt-1 h-10"
            />
          </div>
          <div className="min-h-[68px]">
            <p className="h-4 text-[10px] font-semibold uppercase tracking-wide text-dim">Zużycie / szt.</p>
            <p className="mt-1 flex min-h-10 items-center break-words text-base font-black leading-tight text-title">
              {formatPerPiece(settlement.usagePerPiece, unit)}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2 border-t border-[rgba(255,255,255,0.08)] pt-3">
          {isDone && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleReopenRow(settlement)}
              disabled={readOnly || updateMutation.isPending}
              className="min-h-[44px] flex-1 px-3 py-2"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Cofnij do edycji
            </Button>
          )}
          {!isDone && (
            <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleSaveRow(settlement)}
            disabled={readOnly || updateMutation.isPending}
            className="min-h-[44px] flex-1 px-3 py-2"
          >
            <Save className="mr-2 h-4 w-4" />
            Zapisz
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Usunąć rozliczenie ${settlement.orderNumber}?`)) {
                removeMutation.mutate(settlement.id);
              }
            }}
            disabled={readOnly || removeMutation.isPending}
            className="min-h-[44px] w-12 px-0 py-2"
            aria-label="Usuń rozliczenie"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
            </>
          )}
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

          <div className="grid gap-3 md:grid-cols-4">
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
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Farba / taśma</label>
              <div className="relative mt-1">
                <Input
                  value={form.itemName}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, itemName: event.target.value }));
                    setShowItemSuggestions(normalizeKey(event.target.value).length >= 2);
                  }}
                  onFocus={() => setShowItemSuggestions(normalizeKey(form.itemName).length >= 2)}
                  onBlur={() => {
                    setTimeout(() => setShowItemSuggestions(false), 120);
                  }}
                  placeholder="zacznij wpisywać"
                  disabled={readOnly}
                />
                {showItemSuggestions && itemSuggestions.length > 0 && (
                  <div className="absolute z-40 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_16px_36px_rgba(0,0,0,0.48)]">
                    {itemSuggestions.map((item) => (
                      <button
                        key={`${item.id}-${item.indexCode ?? item.name}`}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setForm((prev) => ({ ...prev, itemName: item.name }));
                          setShowItemSuggestions(false);
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
                Stan farby przed rozpoczęciem
              </label>
              <Input
                value={form.startQty}
                onChange={(event) => setForm((prev) => ({ ...prev, startQty: event.target.value }))}
                inputMode="decimal"
                placeholder="np. 5,2"
                disabled={readOnly}
                className="mt-1"
              />
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
        ) : filteredSettlements.length === 0 ? (
          <EmptyState title="Brak rozliczeń" description="Dodaj pierwsze zlecenie powyżej." />
        ) : (
          <>
            <div className="space-y-3 md:hidden">{mobileCards}</div>
            <div className="hidden md:block">
              <DataTable
                columns={[
                  'Zlecenie',
                  'Status',
                  'Farba / taśma',
                  'Stan przed',
                  'Pobrane z magazynu',
                  'Stan po',
                  'Zużycie',
                  'Ilość detali',
                  'Zużycie / szt.',
                  'Akcje'
                ]}
                rows={rows}
                stickyHeader
                desktopMaxHeightClassName="max-h-[70vh]"
              />
            </div>
          </>
        )}
      </Card>
      )}
    </div>
  );
}
