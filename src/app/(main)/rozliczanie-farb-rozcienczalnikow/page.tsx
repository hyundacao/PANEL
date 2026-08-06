'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, CircleHelp, FileSpreadsheet, Minus, Plus, RotateCcw, Save, Trash2, Upload, X } from 'lucide-react';
import {
  addPaintTapeSettlementIssue,
  createPaintTapeSettlement,
  getOriginalInventoryCatalog,
  getOriginalInventoryCatalogFromErp,
  getOriginalInventoryErpSnapshot,
  getPaintTapeSettlements,
  getPaintTapeTechnologyUsages,
  getProductionDetailSuggestions,
  removePaintTapeSettlement,
  upsertPaintTapeTechnologyUsages,
  updatePaintTapeSettlement
} from '@/lib/api';
import type {
  OriginalInventoryCatalogEntry,
  OriginalInventoryErpSnapshotEntry,
  PaintTapeSettlement,
  PaintTapeTechnologyUsage
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

type FilterValue = 'CREATE' | 'OPEN' | 'DETAILS_REQUIRED' | 'DONE' | 'ACCOUNTED';

type RowDraft = {
  orderNumber: string;
  endQty: string;
  producedQty: string;
};

type OrderQuantityDraft = {
  id: string;
  orderNumber: string;
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

type TechnologyUsage = {
  usagePerPiece: number;
  unit: string;
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

const getLocalDateTimeInputValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const toIsoFromDateTimeInput = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const normalizeKey = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Normy technologiczne z dokumentu "tech grafika.docx". Dopasowanie odbywa sie
// wyłącznie po indeksie materialu, aby nie przypisac normy do podobnej nazwy.
const sampleTechnologyUsageByIndex: Record<string, TechnologyUsage> = {
  'm-51-ro-itw-9924': { usagePerPiece: 1 / 30000, unit: 'litr' },
  'm-51-ro-itw-9720': { usagePerPiece: 1 / 30000, unit: 'litr' },
  'm-51-fa-itw-9719': { usagePerPiece: 1 / 15000, unit: 'kg' },
  'm-51-f-011-001': { usagePerPiece: 1 / 10000, unit: 'szt.' },
  tp131301: { usagePerPiece: 1 / 100000, unit: 'litr' },
  'm-51-ro-pp-10769': { usagePerPiece: 1 / 30000, unit: 'szt.' },
  'm-51-ro-pp-10880': { usagePerPiece: 1 / 30000, unit: 'szt.' },
  'm-51-fa-pp-10767': { usagePerPiece: 1 / 30000, unit: 'litr' },
  'm-51-fa-pp-10768': { usagePerPiece: 1 / 30000, unit: 'litr' }
};

const getTechnologyUsage = (
  settlement: PaintTapeSettlement,
  technologyUsageByIndex: Map<string, TechnologyUsage>
) => technologyUsageByIndex.get(normalizeKey(settlement.itemIndexCode));

type UsageComparison = 'HIGHER' | 'LOWER' | 'MATCH' | null;

const getUsageComparison = (
  actualUsagePerPiece: number | null | undefined,
  technicalUsagePerPiece: number | null | undefined
): UsageComparison => {
  if (
    actualUsagePerPiece === null ||
    actualUsagePerPiece === undefined ||
    technicalUsagePerPiece === null ||
    technicalUsagePerPiece === undefined
  ) {
    return null;
  }
  const actualRounded = Math.round(actualUsagePerPiece * 1_000_000);
  const technicalRounded = Math.round(technicalUsagePerPiece * 1_000_000);
  if (actualRounded === technicalRounded) return 'MATCH';
  return actualRounded > technicalRounded ? 'HIGHER' : 'LOWER';
};

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
    .join(' | ');

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

const sanitizeFileName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .toLowerCase();

const createEmptyOrderQuantityDraft = (index: number): OrderQuantityDraft => ({
  id: `order-${index}`,
  orderNumber: '',
  producedQty: ''
});

const splitOrderNumbers = (value: string) =>
  value
    .split(value.includes(';') || value.includes('\n') ? /[;\n]+/ : /[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const parseOrderQuantityDraftsFromText = (
  orderNumber: string,
  producedQty?: number | null
): OrderQuantityDraft[] => {
  const parts = splitOrderNumbers(orderNumber);
  if (parts.length === 0) {
    return [createEmptyOrderQuantityDraft(1)];
  }
  return parts.map((part, index) => {
    const match = part.match(/^(.+?)\s*[-:|]\s*([\d\s,.]+)\s*(?:szt\.?)?$/i);
    const order = match?.[1]?.trim() || part.trim();
    const qty = match?.[2]?.trim() || (parts.length === 1 ? numberInputValue(producedQty) : '');
    return {
      id: `order-${index + 1}`,
      orderNumber: order,
      producedQty: qty
    };
  });
};

const serializeOrderQuantities = (
  rows: Array<{ orderNumber: string; producedQty: number }>
) => rows.map((row) => `${row.orderNumber} - ${numberInputValue(row.producedQty)} szt.`).join('; ');

const getOrderQuantitySummaryRows = (orderNumber: string, producedQty?: number | null) =>
  parseOrderQuantityDraftsFromText(orderNumber, producedQty)
    .map((row) => ({
      orderNumber: row.orderNumber.trim(),
      producedQty: parseQtyInput(row.producedQty)
    }))
    .filter((row) => Boolean(row.orderNumber));

const getStatusBadge = (settlement: PaintTapeSettlement) => {
  if (settlement.status === 'DONE') return <Badge tone="success">Zakończone</Badge>;
  if (settlement.status === 'DETAILS_REQUIRED') {
    return <Badge tone="warning">Do wpisania ilości detali</Badge>;
  }
  return <Badge tone="info">Otwarte</Badge>;
};

const buildSnapshotMap = (items: unknown) => {
  const map = new Map<string, OriginalInventoryErpSnapshotEntry>();
  if (!Array.isArray(items)) return map;
  items.forEach((rawItem) => {
    if (!rawItem || typeof rawItem !== 'object') return;
    const item = rawItem as OriginalInventoryErpSnapshotEntry;
    if (typeof item.name === 'string' && item.name.trim()) {
      map.set(normalizeKey(item.name), item);
    }
    if (typeof item.indexCode === 'string' && item.indexCode.trim()) {
      map.set(normalizeKey(item.indexCode), item);
    }
  });
  return map;
};

type TechnologyUsageImportEntry = {
  indexCode: string;
  itemName: string;
  usagePerPiece: number;
  unit: string;
};

const parseTechnologyUsageValue = (value: unknown) => {
  const text = String(value ?? '')
    .replace(/\s+/g, '')
    .replace(',', '.');
  const fraction = text.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator > 0 ? numerator / denominator : null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const parseTechnologyUsageRows = (rows: unknown[][]): TechnologyUsageImportEntry[] => {
  const imports = new Map<string, TechnologyUsageImportEntry>();
  rows.forEach((rawRow, rowIndex) => {
    const headerRow = rawRow.map((value) => normalizeKey(value));
    const indexColumn = headerRow.findIndex((value) => value.includes('indkes') || value.includes('indeks'));
    const usageColumn = headerRow.findIndex(
      (value) => value.includes('zuzycie') && (value.includes('tech') || value.includes('technolog'))
    );
    const unitColumn = headerRow.findIndex((value) => value.includes('jednost'));
    const nameColumn = headerRow.findIndex((value) => value.includes('nazwa'));
    if (indexColumn < 0 || usageColumn < 0) return;

    rows.slice(rowIndex + 1).forEach((row) => {
      const indexCode = String(row[indexColumn] ?? '').trim();
      const usagePerPiece = parseTechnologyUsageValue(row[usageColumn]);
      if (!indexCode || usagePerPiece === null) return;
      imports.set(normalizeKey(indexCode), {
        indexCode,
        itemName: nameColumn >= 0 ? String(row[nameColumn] ?? '').trim() : '',
        usagePerPiece,
        unit: unitColumn >= 0 ? String(row[unitColumn] ?? '').trim() || 'kg' : 'kg'
      });
    });
  });
  return [...imports.values()];
};

const parseTechnologyUsageFile = async (file: File): Promise<TechnologyUsageImportEntry[]> => {
  const filename = file.name.toLowerCase();
  if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
    const rows = workbook.SheetNames.flatMap((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return sheet
        ? (XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][])
        : [];
    });
    return parseTechnologyUsageRows(rows);
  }

  if (!filename.endsWith('.docx')) throw new Error('TECHNOLOGY_FILE_TYPE');
  const JSZipModule = await import('jszip');
  const archive = await JSZipModule.default.loadAsync(await file.arrayBuffer());
  const documentXml = await archive.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('TECHNOLOGY_FILE_READ');

  const document = new DOMParser().parseFromString(documentXml, 'application/xml');
  const tableRows = Array.from(document.getElementsByTagName('w:tbl')).flatMap((table) =>
    Array.from(table.getElementsByTagName('w:tr')).map((row) =>
      Array.from(row.getElementsByTagName('w:tc')).map((cell) =>
        Array.from(cell.getElementsByTagName('w:t'))
          .map((node) => node.textContent ?? '')
          .join('')
      )
    )
  );
  return parseTechnologyUsageRows(tableRows);
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
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterValue>('CREATE');
  const [query, setQuery] = useState('');
  const [snapshotDate, setSnapshotDate] = useState(getLocalDateValue());
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [orderNoteDrafts, setOrderNoteDrafts] = useState<Record<string, string>>({});
  const [usageCheckNoteDrafts, setUsageCheckNoteDrafts] = useState<Record<string, string>>({});
  const [activeUsageCheckNoteId, setActiveUsageCheckNoteId] = useState<string | null>(null);
  const [groupOrderQuantityDrafts, setGroupOrderQuantityDrafts] = useState<
    Record<string, OrderQuantityDraft[]>
  >({});
  const [groupCompletedAtDrafts, setGroupCompletedAtDrafts] = useState<Record<string, string>>({});
  const [selectedExportGroupKeys, setSelectedExportGroupKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [issueDraft, setIssueDraft] = useState<IssueDraft | null>(null);
  const [showDetailSuggestions, setShowDetailSuggestions] = useState(false);
  const [showItemSuggestionsFor, setShowItemSuggestionsFor] = useState<string | null>(null);
  const [form, setForm] = useState({
    orderNumber: '',
    detailName: '',
    productionStartedAt: getLocalDateTimeInputValue()
  });
  const technologyImportInputRef = useRef<HTMLInputElement>(null);
  const nextItemDraftId = useRef(2);
  const nextOrderQuantityDraftId = useRef(1000);
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
        paintTapePermissions.accounting
          ? { value: 'DONE' as FilterValue, label: 'Zlecenia do rozliczenia' }
          : null,
        paintTapePermissions.accounted
          ? { value: 'ACCOUNTED' as FilterValue, label: 'Rozliczone' }
          : null
      ].filter(Boolean) as Array<{ value: FilterValue; label: string }>,
    [
      paintTapePermissions.accounting,
      paintTapePermissions.accounted,
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

  const { data: importedTechnologyUsages = [] } = useQuery({
    queryKey: ['paint-tape-technology-usages'],
    queryFn: getPaintTapeTechnologyUsages
  });

  const technologyUsageByIndex = useMemo(() => {
    const values = new Map<string, TechnologyUsage>(Object.entries(sampleTechnologyUsageByIndex));
    importedTechnologyUsages.forEach((usage: PaintTapeTechnologyUsage) => {
      values.set(normalizeKey(usage.indexCode), {
        usagePerPiece: usage.usagePerPiece,
        unit: usage.unit
      });
    });
    return values;
  }, [importedTechnologyUsages]);

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
        const snapshot = await getOriginalInventoryErpSnapshot(snapshotDate);
        return Array.isArray(snapshot) ? snapshot : [];
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

  const technologyImportMutation = useMutation({
    mutationFn: upsertPaintTapeTechnologyUsages,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['paint-tape-technology-usages'] });
      toast({ title: `Zaimportowano ${result.imported} norm technologicznych`, tone: 'success' });
    },
    onError: (error: Error) => {
      toast({
        title: 'Nie udało się zaimportować norm technologicznych',
        description:
          error.message === 'MIGRATION_REQUIRED_PAINT_TAPE_TECHNOLOGY_USAGES'
            ? 'Uruchom migrację supabase/migrate_paint_tape_settlements.sql.'
            : 'Sprawdź nagłówki i wartości w pliku.',
        tone: 'error'
      });
    }
  });

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
        detailName: '',
        productionStartedAt: getLocalDateTimeInputValue()
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
      setOrderNoteDrafts({});
      setUsageCheckNoteDrafts({});
      setActiveUsageCheckNoteId(null);
      setGroupOrderQuantityDrafts({});
      setGroupCompletedAtDrafts({});
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
      const matchesStage =
        activeFilter === 'ACCOUNTED'
          ? settlement.status === 'DONE' && Boolean(settlement.accountedAt)
          : activeFilter === 'DONE'
            ? settlement.status === 'DONE' && !settlement.accountedAt
            : activeFilter !== 'CREATE' && settlement.status === activeFilter;
      if (!matchesStage) return false;
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

  const getGroupOrderQuantityDrafts = (group: SettlementGroup) => {
    const saved = groupOrderQuantityDrafts[group.key];
    if (saved) return saved;
    const firstSettlement = group.items[0];
    return parseOrderQuantityDraftsFromText(
      firstSettlement?.orderNumber ?? group.orderNumber,
      firstSettlement?.producedQty
    );
  };

  const getGroupOrderNoteDraft = (group: SettlementGroup) =>
    orderNoteDrafts[group.key] ?? group.items[0]?.orderNote ?? '';

  const setGroupOrderNoteDraft = (group: SettlementGroup, value: string) => {
    setOrderNoteDrafts((previous) => ({ ...previous, [group.key]: value }));
  };

  const getUsageCheckNoteDraft = (settlement: PaintTapeSettlement) =>
    usageCheckNoteDrafts[settlement.id] ?? settlement.usageCheckNote ?? '';

  const setUsageCheckNoteDraft = (settlementId: string, value: string) => {
    setUsageCheckNoteDrafts((previous) => ({ ...previous, [settlementId]: value }));
  };

  const setGroupOrderQuantityDraft = (
    group: SettlementGroup,
    id: string,
    patch: Partial<OrderQuantityDraft>
  ) => {
    setGroupOrderQuantityDrafts((prev) => ({
      ...prev,
      [group.key]: getGroupOrderQuantityDrafts(group).map((draft) =>
        draft.id === id ? { ...draft, ...patch } : draft
      )
    }));
  };

  const addGroupOrderQuantityDraft = (group: SettlementGroup) => {
    const nextId = nextOrderQuantityDraftId.current;
    nextOrderQuantityDraftId.current += 1;
    setGroupOrderQuantityDrafts((prev) => ({
      ...prev,
      [group.key]: [...getGroupOrderQuantityDrafts(group), createEmptyOrderQuantityDraft(nextId)]
    }));
  };

  const removeGroupOrderQuantityDraft = (group: SettlementGroup, id: string) => {
    setGroupOrderQuantityDrafts((prev) => {
      const next = getGroupOrderQuantityDrafts(group).filter((draft) => draft.id !== id);
      return {
        ...prev,
        [group.key]: next.length > 0 ? next : [createEmptyOrderQuantityDraft(1)]
      };
    });
  };

  const getParsedGroupOrderQuantities = (group: SettlementGroup) =>
    getGroupOrderQuantityDrafts(group)
      .map((draft) => ({
        orderNumber: draft.orderNumber.trim(),
        producedQty: parseQtyInput(draft.producedQty)
      }))
      .filter(
        (row): row is { orderNumber: string; producedQty: number } =>
          Boolean(row.orderNumber) && row.producedQty !== null && row.producedQty > 0
      );

  const getGroupProducedDraft = (group: SettlementGroup) => {
    const total = getParsedGroupOrderQuantities(group).reduce(
      (sum, row) => sum + row.producedQty,
      0
    );
    return total > 0 ? numberInputValue(total) : numberInputValue(group.items[0]?.producedQty);
  };

  const getUsagePerPiecePreview = (settlement: PaintTapeSettlement, group: SettlementGroup) => {
    const producedQty = parseQtyInput(getGroupProducedDraft(group));
    if (producedQty === null || producedQty <= 0) return settlement.usagePerPiece;
    const usageQty = settlement.usageQty;
    if (usageQty === null || usageQty === undefined || Number.isNaN(usageQty)) return null;
    return usageQty / producedQty;
  };

  const getUsageAllocationPreview = (settlement: PaintTapeSettlement, group: SettlementGroup) => {
    const usageQty = settlement.usageQty;
    if (usageQty === null || usageQty === undefined || Number.isNaN(usageQty)) return [];
    const orderRows = getParsedGroupOrderQuantities(group);
    const totalProduced = orderRows.reduce((sum, row) => sum + row.producedQty, 0);
    if (totalProduced <= 0) return [];
    return orderRows.map((row) => ({
      orderNumber: row.orderNumber,
      producedQty: row.producedQty,
      usageQty: usageQty * (row.producedQty / totalProduced)
    }));
  };

  const getGroupCompletedAtDraft = (group: SettlementGroup) =>
    groupCompletedAtDrafts[group.key] ?? getLocalDateTimeInputValue();

  const handleExportGroup = async (group: SettlementGroup) => {
    const firstSettlement = group.items[0];
    if (!firstSettlement) return;
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Produkcja', {
        views: [{ state: 'frozen', ySplit: 8 }]
      });
      const startedAt = group.items
        .map((settlement) => settlement.createdAt)
        .filter(Boolean)
        .sort()[0];
      const completedDates = group.items
        .map((settlement) => settlement.productionCompletedAt)
        .filter(Boolean)
        .sort();
      const completedAt = completedDates[completedDates.length - 1];
      const orderRows = getParsedGroupOrderQuantities(group);
      const totalProduced =
        firstSettlement.producedQty ??
        orderRows.reduce((sum, row) => sum + row.producedQty, 0);
      const generatedAt = new Date().toLocaleString('pl-PL');

      workbook.creator = 'APKA DLA KAMILA';
      workbook.created = new Date();

      worksheet.columns = [
        { key: 'lp', width: 5 },
        { key: 'orderNumber', width: 16 },
        { key: 'detailName', width: 38 },
        { key: 'producedQty', width: 12 },
        { key: 'material', width: 52 },
        { key: 'physicalUsage', width: 13 },
        { key: 'physicalUsagePerPiece', width: 15 },
        { key: 'technicalUsagePerPiece', width: 15 },
        { key: 'technicalUsage', width: 13 },
        { key: 'usageDifference', width: 15 }
      ];

      worksheet.mergeCells('A1:J1');
      worksheet.getCell('A1').value =
        `${group.detailName} | Rozpoczęto: ${formatDateTime(startedAt) || '-'} | ` +
        `Zakończono: ${formatDateTime(completedAt) || '-'} | Wygenerowano: ${generatedAt}`;
      worksheet.getRow(1).font = { bold: true, color: { argb: 'FF6D5DFF' }, size: 12 };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      worksheet.getRow(1).height = 24;

      const headerRow = worksheet.getRow(2);
      headerRow.values = [
        '',
        'NR ZLECENIA',
        'NAZWA (INDEKS)',
        'ILOŚĆ SZT',
        'MATERIAŁ',
        'ZUŻYCIE FIZ',
        'ZUŻYCIE RZECZ./SZT',
        'ZUŻYCIE TECH/SZT',
        'ZUŻYCIE TECH',
        'RÓŻNICA FIZ.-TECH.'
      ];
      headerRow.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF7A7A7A' } },
          left: { style: 'thin', color: { argb: 'FF7A7A7A' } },
          bottom: { style: 'thin', color: { argb: 'FF7A7A7A' } },
          right: { style: 'thin', color: { argb: 'FF7A7A7A' } }
        };
      });

      const sourceOrderRows =
        orderRows.length > 0
          ? orderRows
          : [{ orderNumber: firstSettlement.orderNumber || '', producedQty: totalProduced ?? 0 }];
      sourceOrderRows.forEach((orderRow, orderIndex) => {
        group.items.forEach((settlement, materialIndex) => {
          const usageQty =
            settlement.usageQty === null ||
            settlement.usageQty === undefined ||
            Number.isNaN(settlement.usageQty) ||
            !totalProduced
              ? null
              : settlement.usageQty * (orderRow.producedQty / totalProduced);
          const usagePerPiece =
            usageQty !== null && orderRow.producedQty > 0 ? usageQty / orderRow.producedQty : null;
          const technologyUsage = getTechnologyUsage(settlement, technologyUsageByIndex);
          const technicalUsageQty = technologyUsage
            ? technologyUsage.usagePerPiece * orderRow.producedQty
            : null;
          worksheet.addRow({
            lp: materialIndex === 0 ? `${orderIndex + 1}.` : '',
            orderNumber: materialIndex === 0 ? orderRow.orderNumber : '',
            detailName: materialIndex === 0 ? group.detailName : '',
            producedQty: materialIndex === 0 ? orderRow.producedQty : '',
            material: `${settlement.itemName}${settlement.itemIndexCode ? ` - ${settlement.itemIndexCode}` : ''}`,
            physicalUsage: usageQty,
            physicalUsagePerPiece: usagePerPiece,
            technicalUsagePerPiece: technologyUsage?.usagePerPiece ?? null,
            technicalUsage: technicalUsageQty,
            usageDifference:
              usageQty !== null && technicalUsageQty !== null ? usageQty - technicalUsageQty : null
          });
        });
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= 2) return;
        const detailLength = String(row.getCell(3).value ?? '').length;
        const materialLength = String(row.getCell(5).value ?? '').length;
        const lineCount = Math.max(Math.ceil(detailLength / 34), Math.ceil(materialLength / 48), 1);
        row.height = Math.min(Math.max(20, lineCount * 18), 58);
        row.eachCell((cell, columnNumber) => {
          cell.alignment = {
            vertical: 'middle',
            horizontal: columnNumber === 3 || columnNumber === 5 ? 'left' : 'center',
            wrapText: true
          };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF8A8A8A' } },
            left: { style: 'thin', color: { argb: 'FF8A8A8A' } },
            bottom: { style: 'thin', color: { argb: 'FF8A8A8A' } },
            right: { style: 'thin', color: { argb: 'FF8A8A8A' } }
          };
        });
        row.getCell(2).font = { bold: true, color: { argb: 'FF6D5DFF' } };
        row.getCell(3).font = { bold: true, color: { argb: 'FF6D5DFF' } };
        row.getCell(5).font = { bold: true, color: { argb: 'FFFF6A00' } };
      });
      worksheet.autoFilter = 'A2:J2';
      worksheet.getColumn(6).numFmt = '0.###';
      worksheet.getColumn(7).numFmt = '0.000000';
      worksheet.getColumn(8).numFmt = '0.000000';
      worksheet.getColumn(9).numFmt = '0.###';
      worksheet.getColumn(10).numFmt = '0.###';

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rozliczenie-produkcji-${sanitizeFileName(group.detailName || firstSettlement.orderNumber || 'produkcja')}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Nie udało się wyeksportować produkcji do XLSX.', tone: 'error' });
    }
  };

  const toggleExportGroupSelection = (groupKey: string, checked: boolean) => {
    setSelectedExportGroupKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(groupKey);
      else next.delete(groupKey);
      return next;
    });
  };

  const toggleAllVisibleExportGroups = (checked: boolean) => {
    setSelectedExportGroupKeys((current) => {
      const next = new Set(current);
      groupedSettlements.forEach((group) => {
        if (checked) next.add(group.key);
        else next.delete(group.key);
      });
      return next;
    });
  };

  const handleExportSelectedGroups = async () => {
    const selectedGroups = groupedSettlements.filter((group) =>
      selectedExportGroupKeys.has(group.key)
    );
    if (selectedGroups.length === 0) {
      toast({ title: 'Wybierz przynajmniej jedną produkcję.', tone: 'error' });
      return;
    }

    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Wybrane produkcje', {
        views: [{ state: 'frozen', ySplit: 2 }]
      });

      workbook.creator = 'APKA DLA KAMILA';
      workbook.created = new Date();
      worksheet.columns = [
        { key: 'lp', width: 5 },
        { key: 'orderNumber', width: 16 },
        { key: 'detailName', width: 38 },
        { key: 'producedQty', width: 12 },
        { key: 'material', width: 52 },
        { key: 'physicalUsage', width: 13 },
        { key: 'physicalUsagePerPiece', width: 15 },
        { key: 'technicalUsagePerPiece', width: 15 },
        { key: 'technicalUsage', width: 13 },
        { key: 'usageDifference', width: 15 }
      ];

      const generatedAt = new Date().toLocaleString('pl-PL');
      selectedGroups.forEach((group, groupIndex) => {
        const firstSettlement = group.items[0];
        if (!firstSettlement) return;
        if (groupIndex > 0) worksheet.addRow([]);

        const startedAt = group.items
          .map((settlement) => settlement.createdAt)
          .filter(Boolean)
          .sort()[0];
        const completedDates = group.items
          .map((settlement) => settlement.productionCompletedAt)
          .filter(Boolean)
          .sort();
        const completedAt = completedDates[completedDates.length - 1];
        const orderRows = getParsedGroupOrderQuantities(group);
        const totalProduced =
          firstSettlement.producedQty ??
          orderRows.reduce((sum, row) => sum + row.producedQty, 0);
        const sourceOrderRows =
          orderRows.length > 0
            ? orderRows
            : [{ orderNumber: firstSettlement.orderNumber || '', producedQty: totalProduced ?? 0 }];

        const titleRowNumber = worksheet.rowCount + 1;
        worksheet.mergeCells(titleRowNumber, 1, titleRowNumber, 10);
        const titleRow = worksheet.getRow(titleRowNumber);
        titleRow.getCell(1).value =
          `${group.detailName} | Rozpoczęto: ${formatDateTime(startedAt) || '-'} | ` +
          `Zakończono: ${formatDateTime(completedAt) || '-'} | Wygenerowano: ${generatedAt}`;
        titleRow.font = { bold: true, color: { argb: 'FF6D5DFF' }, size: 12 };
        titleRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        titleRow.height = 24;

        const headerRow = worksheet.addRow([
          '',
          'NR ZLECENIA',
          'NAZWA (INDEKS)',
          'ILOŚĆ SZT',
          'MATERIAŁ',
          'ZUŻYCIE FIZ',
          'ZUŻYCIE RZECZ./SZT',
          'ZUŻYCIE TECH/SZT',
          'ZUŻYCIE TECH',
          'RÓŻNICA FIZ.-TECH.'
        ]);
        headerRow.font = { bold: true, color: { argb: 'FF111827' }, size: 10 };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        headerRow.height = 20;
        headerRow.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF7A7A7A' } },
            left: { style: 'thin', color: { argb: 'FF7A7A7A' } },
            bottom: { style: 'thin', color: { argb: 'FF7A7A7A' } },
            right: { style: 'thin', color: { argb: 'FF7A7A7A' } }
          };
        });

        sourceOrderRows.forEach((orderRow, orderIndex) => {
          group.items.forEach((settlement, materialIndex) => {
            const usageQty =
              settlement.usageQty === null ||
              settlement.usageQty === undefined ||
              Number.isNaN(settlement.usageQty) ||
              !totalProduced
                ? null
                : settlement.usageQty * (orderRow.producedQty / totalProduced);
            const usagePerPiece =
              usageQty !== null && orderRow.producedQty > 0
                ? usageQty / orderRow.producedQty
                : null;
            const technologyUsage = getTechnologyUsage(settlement, technologyUsageByIndex);
            const technicalUsageQty = technologyUsage
              ? technologyUsage.usagePerPiece * orderRow.producedQty
              : null;
            const row = worksheet.addRow({
              lp: orderIndex === 0 && materialIndex === 0 ? `${groupIndex + 1}.` : '',
              orderNumber: materialIndex === 0 ? orderRow.orderNumber : '',
              detailName: materialIndex === 0 ? group.detailName : '',
              producedQty: materialIndex === 0 ? orderRow.producedQty : '',
              material: `${settlement.itemName}${settlement.itemIndexCode ? ` - ${settlement.itemIndexCode}` : ''}`,
              physicalUsage: usageQty,
              physicalUsagePerPiece: usagePerPiece,
              technicalUsagePerPiece: technologyUsage?.usagePerPiece ?? null,
              technicalUsage: technicalUsageQty,
              usageDifference:
                usageQty !== null && technicalUsageQty !== null ? usageQty - technicalUsageQty : null
            });
            const detailLength = String(row.getCell(3).value ?? '').length;
            const materialLength = String(row.getCell(5).value ?? '').length;
            const lineCount = Math.max(
              Math.ceil(detailLength / 34),
              Math.ceil(materialLength / 48),
              1
            );
            row.height = Math.min(Math.max(20, lineCount * 18), 58);
            row.eachCell((cell, columnNumber) => {
              cell.alignment = {
                vertical: 'middle',
                horizontal: columnNumber === 3 || columnNumber === 5 ? 'left' : 'center',
                wrapText: true
              };
              cell.border = {
                top: { style: 'thin', color: { argb: 'FF8A8A8A' } },
                left: { style: 'thin', color: { argb: 'FF8A8A8A' } },
                bottom: { style: 'thin', color: { argb: 'FF8A8A8A' } },
                right: { style: 'thin', color: { argb: 'FF8A8A8A' } }
              };
            });
            row.getCell(2).font = { bold: true, color: { argb: 'FF6D5DFF' } };
            row.getCell(3).font = { bold: true, color: { argb: 'FF6D5DFF' } };
            row.getCell(5).font = { bold: true, color: { argb: 'FFFF6A00' } };
          });
        });
      });

      worksheet.getColumn(6).numFmt = '0.###';
      worksheet.getColumn(7).numFmt = '0.000000';
      worksheet.getColumn(8).numFmt = '0.000000';
      worksheet.getColumn(9).numFmt = '0.###';
      worksheet.getColumn(10).numFmt = '0.###';

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `rozliczenia-produkcji-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setSelectedExportGroupKeys(new Set());
    } catch {
      toast({ title: 'Nie udało się wyeksportować wybranych produkcji do XLSX.', tone: 'error' });
    }
  };

  const handleTechnologyImport = async (file: File | null) => {
    if (!file) return;
    try {
      const entries = await parseTechnologyUsageFile(file);
      if (entries.length === 0) {
        toast({
          title: 'Nie znaleziono norm technologicznych',
          description: 'Plik musi zawierać indeks oraz kolumnę zużycia technologicznego na sztukę.',
          tone: 'error'
        });
        return;
      }
      await technologyImportMutation.mutateAsync({ entries });
    } catch {
      toast({
        title: 'Nie odczytano pliku z normami technologicznymi',
        description: 'Obsługiwane są pliki DOCX, XLSX i XLS z tabelą technologii.',
        tone: 'error'
      });
    } finally {
      if (technologyImportInputRef.current) technologyImportInputRef.current.value = '';
    }
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
      toast({ title: 'Uzupełnij detal i przynajmniej jedną farbę lub rozcieńczalnik.', tone: 'error' });
      return;
    }
    const createdAt = toIsoFromDateTimeInput(form.productionStartedAt);
    if (!createdAt) {
      toast({ title: 'Podaj poprawną datę rozpoczęcia produkcji.', tone: 'error' });
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
          warehouseIssuedQty: 0,
          createdAt
        }
      };
    });
    if (payloads.some(({ draft }) => !draft.itemName.trim())) {
      toast({ title: 'Uzupełnij nazwę każdej farby lub rozcieńczalnika.', tone: 'error' });
      return;
    }
    if (payloads.some(({ startQty }) => startQty === null)) {
      toast({ title: 'Podaj stan przed rozpoczęciem dla każdej farby lub każdego rozcieńczalnika.', tone: 'error' });
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
    const productionCompletedAt = toIsoFromDateTimeInput(
      groupCompletedAtDrafts[group.key] ?? getLocalDateTimeInputValue()
    );
    if (!productionCompletedAt) {
      toast({ title: 'Podaj poprawną datę zakończenia produkcji.', tone: 'error' });
      return;
    }
    const payloads = group.items.map((settlement) => {
      const draft = getDraft(settlement);
      const endQty = draft.endQty.trim() ? parseQtyInput(draft.endQty) : null;
      return { settlement, draft, endQty };
    });
    if (payloads.some(({ draft }) => !draft.endQty.trim())) {
      toast({ title: 'Podaj stan po dla każdej farby lub każdego rozcieńczalnika w zleceniu.', tone: 'error' });
      return;
    }
    if (payloads.some(({ endQty }) => endQty === null)) {
      toast({ title: 'Podaj poprawny stan po dla każdej farby lub każdego rozcieńczalnika.', tone: 'error' });
      return;
    }
    updateGroupMutation.mutate(
      payloads.map(({ settlement, endQty }) => ({
        id: settlement.id,
        orderNumber,
        endQty,
        producedQty: null,
        productionCompletedAt,
        completeProduction: true
      }))
    );
  };

  const handleSaveDetailsGroup = (group: SettlementGroup) => {
    if (!canDetails) {
      toast({ title: 'Brak uprawnien do wpisywania ilosci.', tone: 'error' });
      return;
    }
    const firstSettlement = group.items[0];
    if (!firstSettlement) return;
    const orderRows = getGroupOrderQuantityDrafts(group).map((draft) => ({
      orderNumber: draft.orderNumber.trim(),
      producedQty: parseQtyInput(draft.producedQty)
    }));
    if (orderRows.some((row) => !row.orderNumber && row.producedQty !== null)) {
      toast({ title: 'Podaj numer zlecenia przy każdej ilości.', tone: 'error' });
      return;
    }
    if (orderRows.some((row) => row.orderNumber && (row.producedQty === null || row.producedQty <= 0))) {
      toast({ title: 'Podaj poprawną ilość sztuk dla każdego zlecenia.', tone: 'error' });
      return;
    }
    const validOrderRows = orderRows.filter(
      (row): row is { orderNumber: string; producedQty: number } =>
        Boolean(row.orderNumber) && row.producedQty !== null && row.producedQty > 0
    );
    if (validOrderRows.length === 0) {
      toast({ title: 'Dodaj przynajmniej jedno zlecenie z ilością sztuk.', tone: 'error' });
      return;
    }
    const producedQty = validOrderRows.reduce((sum, row) => sum + row.producedQty, 0);
    const orderNumber = serializeOrderQuantities(validOrderRows);
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

  const handleSaveGroupOrderNote = (group: SettlementGroup) => {
    if (!canAccounting) {
      toast({ title: 'Brak uprawnien do zapisu uwag.', tone: 'error' });
      return;
    }
    const orderNote = getGroupOrderNoteDraft(group);
    updateGroupMutation.mutate(group.items.map((settlement) => ({ id: settlement.id, orderNote })));
  };

  const handleSaveUsageCheckNote = (settlement: PaintTapeSettlement) => {
    if (!canAccounting) {
      toast({ title: 'Brak uprawnien do zapisu notatki kontrolnej.', tone: 'error' });
      return;
    }
    updateGroupMutation.mutate([{ id: settlement.id, usageCheckNote: getUsageCheckNoteDraft(settlement) }]);
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
      const orderRows = getOrderQuantitySummaryRows(settlement.orderNumber, settlement.producedQty);
      return (
        <p className={compact ? 'mt-1 text-lg font-black leading-tight' : 'font-black'}>
          {orderRows.length > 0
            ? orderRows.map((row, index) => (
                <Fragment key={`${settlement.id}-${row.orderNumber}-${index}`}>
                  {index > 0 && <span className="text-dim"> | </span>}
                  <span className="text-[var(--value-purple)]">{row.orderNumber}</span>
                  {row.producedQty !== null && row.producedQty > 0 && (
                    <span className="text-title">: {formatPiecesQty(row.producedQty)}</span>
                  )}
                </Fragment>
              ))
            : <span className="text-dim">Bez numeru</span>}
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
      <div className={compact ? 'min-w-0' : 'mx-auto min-w-[96px]'}>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleIssueMove(settlement, -1)}
            disabled={disabled || settlement.warehouseIssuedQty <= 0}
            className={compact ? 'h-10 w-10 px-0 py-0' : 'h-8 w-8 px-0 py-0'}
            aria-label="Odejmij pobranie z magazynu"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <div
            className={cn(
              'flex h-10 items-center justify-center rounded-xl border border-border bg-[rgba(0,0,0,0.32)] px-3 text-sm font-black text-title',
              compact ? 'min-w-0 flex-1' : 'w-[96px] shrink-0'
            )}
          >
            {formatQty(settlement.warehouseIssuedQty, settlement.unit || 'kg')}
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleIssueMove(settlement, 1)}
            disabled={disabled}
            className={compact ? 'h-10 w-10 px-0 py-0' : 'h-8 w-8 px-0 py-0'}
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
            if (window.confirm(`Usunąć farbę/rozcieńczalnik ${settlement.itemName} ze zlecenia ${settlement.orderNumber}?`)) {
              removeMutation.mutate(settlement.id);
            }
          }}
          disabled={!canOpen || activeFilter !== 'OPEN' || removeMutation.isPending}
          className={compact ? 'min-h-[44px] w-12 px-0 py-2' : 'min-h-[40px] px-3 py-2'}
          aria-label="Usuń farbę / rozcieńczalnik"
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
              Farba / rozcieńczalnik
            </p>
            <p
              className="mt-1 break-words text-sm font-black leading-snug"
              style={{ color: 'var(--brand)' }}
            >
              {settlement.itemName}
            </p>
            {settlement.itemIndexCode && (
              <p className="mt-1 break-words text-xs font-semibold text-[var(--value-purple)]">
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
            <div className="flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(255,255,255,0.035)] px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Zuzycie rzecz. / szt.
              </p>
              <p className="mt-1 break-words font-black leading-tight text-title">
                {formatPerPiece(getUsagePerPiecePreview(settlement, group), unit)}
              </p>
              {getUsageAllocationPreview(settlement, group).length > 0 && (
                <div className="mt-2 w-full space-y-1 text-xs font-semibold text-title">
                  {getUsageAllocationPreview(settlement, group).map((allocation) => (
                    <p key={`${settlement.id}-${allocation.orderNumber}`}>
                      <span className="text-[var(--value-purple)]">{allocation.orderNumber}</span>
                      : {formatQty(allocation.usageQty, unit)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {showPerPiece && (
            <div className="flex min-h-[70px] flex-col items-center justify-center rounded-lg bg-[rgba(109,93,255,0.09)] px-3 py-2 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                Zuzycie tech. / szt.
              </p>
              <p className="mt-1 break-words font-black leading-tight text-title">
                {formatPerPiece(
                  getTechnologyUsage(settlement, technologyUsageByIndex)?.usagePerPiece,
                  getTechnologyUsage(settlement, technologyUsageByIndex)?.unit ?? unit
                )}
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
    const groupProducedQty = firstSettlement.producedQty;
    const groupBusy = updateGroupMutation.isPending;
    const groupAccounted = group.items.every((settlement) => Boolean(settlement.accountedAt));
    const outsideTechnologyCount = group.items.filter(
      (settlement) => (settlement.usageQty ?? 0) > 0 && !getTechnologyUsage(settlement, technologyUsageByIndex)
    ).length;
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
          activeFilter === 'DONE' &&
            selectedExportGroupKeys.has(group.key) &&
            'border-[var(--accent)] shadow-[0_0_0_1px_rgba(255,122,0,0.35),0_16px_38px_rgba(0,0,0,0.30)]',
          groupAccounted &&
            'border-[color:color-mix(in_srgb,var(--success)_55%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--success)_16%,rgba(255,255,255,0.04)),rgba(0,0,0,0.48))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--success)_25%,transparent),0_16px_38px_rgba(0,0,0,0.30)]'
        )}
      >
        <div className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.08)] pb-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <p
              className="break-words text-lg font-black leading-tight text-[var(--value-purple)] md:text-xl"
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
            {activeFilter === 'OPEN' && (
              <div className="mt-3 max-w-[340px]">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                  Zakończenie produkcji
                </label>
                <Input
                  type="datetime-local"
                  value={getGroupCompletedAtDraft(group)}
                  onChange={(event) =>
                    setGroupCompletedAtDrafts((prev) => ({
                      ...prev,
                      [group.key]: event.target.value
                    }))
                  }
                  disabled={!canOpen || groupBusy}
                  className="mt-1 h-10"
                />
              </div>
            )}
          </div>
          <div className="grid shrink-0 gap-2 sm:grid-cols-[170px_220px] md:w-[398px]">
            {(activeFilter === 'DONE' || activeFilter === 'ACCOUNTED') && (
              <label className="flex min-h-[72px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-[rgba(255,122,0,0.38)] bg-[rgba(255,122,0,0.06)] px-3 py-3 text-xs font-bold text-title transition-colors hover:bg-[rgba(255,122,0,0.12)]">
                <input
                  type="checkbox"
                  checked={selectedExportGroupKeys.has(group.key)}
                  onChange={(event) =>
                    toggleExportGroupSelection(group.key, event.target.checked)
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                Wybierz produkcję
              </label>
            )}
            {(activeFilter === 'DONE' || activeFilter === 'ACCOUNTED') && (
              <div className="flex min-h-[72px] w-full flex-col items-center justify-center rounded-xl border border-[rgba(124,92,255,0.42)] bg-[rgba(124,92,255,0.09)] px-4 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                  Ilość wykonana
                </p>
                <p className="mt-1 text-[26px] font-black leading-none tracking-tight text-title md:text-[28px]">
                  {formatPiecesQty(groupProducedQty)}
                </p>
              </div>
            )}
            <div className="flex w-full flex-wrap items-center justify-end gap-2 pt-1 sm:col-span-2">
              {activeFilter !== 'DONE' && activeFilter !== 'ACCOUNTED' && getStatusBadge(firstSettlement)}
              {groupAccounted && <Badge tone="success">Rozliczone</Badge>}
              {group.items.length > 1 && (
                <Badge tone="info">{group.items.length} farby / rozcieńczalniki</Badge>
              )}
              {outsideTechnologyCount > 0 && (
                <Badge tone="warning">Poza technologią: {outsideTechnologyCount}</Badge>
              )}
            </div>
            {activeFilter === 'DETAILS_REQUIRED' && (
              <div className="grid gap-2 sm:min-w-[360px]">
                <p className="text-xs uppercase tracking-wide text-dim">Zlecenia i ilości sztuk</p>
                {getGroupOrderQuantityDrafts(group).map((draft) => (
                  <div key={draft.id} className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2">
                    <Input
                      value={draft.orderNumber}
                      onChange={(event) =>
                        setGroupOrderQuantityDraft(group, draft.id, { orderNumber: event.target.value })
                      }
                      placeholder="np. 5599"
                      disabled={!canDetails || groupBusy}
                      aria-label="Numer zlecenia"
                      className="h-10"
                    />
                    <Input
                      value={draft.producedQty}
                      onChange={(event) =>
                        setGroupOrderQuantityDraft(group, draft.id, { producedQty: event.target.value })
                      }
                      inputMode="numeric"
                      placeholder="szt."
                      disabled={!canDetails || groupBusy}
                      aria-label="Ilość sztuk dla zlecenia"
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeGroupOrderQuantityDraft(group, draft.id)}
                      disabled={!canDetails || groupBusy || getGroupOrderQuantityDrafts(group).length <= 1}
                      className="h-10 w-10 px-0 py-0"
                      aria-label="Usuń zlecenie"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => addGroupOrderQuantityDraft(group)}
                  disabled={!canDetails || groupBusy}
                  className="min-h-[38px] justify-start px-3 py-2"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Dodaj kolejne zlecenie
                </Button>
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
          <table className="w-full min-w-[1240px] text-sm">
            <thead className="bg-[linear-gradient(90deg,rgba(255,122,26,0.16),rgba(255,255,255,0.03))] text-title">
              <tr>
                {[
                  'Farba / rozcieńczalnik',
                  'Stan przed',
                  'Pobrane z magazynu',
                  'Stan po',
                  'Zużycie',
                  ...(activeFilter === 'OPEN'
                    ? []
                    : [
                        'Zużycie na szt. rzeczywiste',
                        'Zużycie na szt. technologiczne',
                        'Rozchód na zlecenia',
                        'Kontrola'
                      ]),
                  ...(activeFilter === 'DONE' || activeFilter === 'ACCOUNTED' ? [] : ['Akcje'])
                ].map((column, index) => (
                  <th
                    key={`${group.key}-${column}`}
                    className={cn(
                      'px-2 py-3 text-center text-xs font-semibold uppercase tracking-wide text-title',
                      index === 0 && 'text-left'
                    )}
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
                const technologyUsage = getTechnologyUsage(settlement, technologyUsageByIndex);
                const isDone = settlement.status === 'DONE';
                const showPerPiece = activeFilter !== 'OPEN';
                const showActions = activeFilter !== 'DONE' && activeFilter !== 'ACCOUNTED';
                const actualUsagePerPiece = getUsagePerPiecePreview(settlement, group);
                const usageComparison = getUsageComparison(
                  actualUsagePerPiece,
                  technologyUsage?.usagePerPiece
                );
                const usageCheckNoteOpen = activeUsageCheckNoteId === settlement.id;
                const tableColumnCount = showPerPiece ? 9 : 6;
                const isOutsideTechnology = (settlement.usageQty ?? 0) > 0 && !technologyUsage;
                return (
                  <Fragment key={settlement.id}>
                    <tr className="border-t border-[rgba(255,255,255,0.08)] text-body">
                    <td className="px-4 py-3">
                      <div className="min-w-[180px]">
                        <p className="font-semibold" style={{ color: 'var(--brand)' }}>
                          {settlement.itemName}
                        </p>
                        {settlement.itemIndexCode && (
                          <p className="mt-1 text-xs text-[var(--value-purple)]">{settlement.itemIndexCode}</p>
                        )}
                        <p className="mt-1 text-xs text-dim">
                          ERP {snapshotDate}:{' '}
                          {erp ? `${formatQty(erp.realQty, erp.unit)} rzecz. / ${formatQty(erp.availableQty, erp.unit)} dysp.` : 'brak'}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{formatQty(settlement.startQty, unit)}</td>
                    <td className="px-4 py-3 text-center">{renderIssuedControl(settlement)}</td>
                    <td className="px-4 py-3 text-center">
                      <Input
                        value={draft.endQty}
                        onChange={(event) => setDraft(settlement, { endQty: event.target.value })}
                        inputMode="decimal"
                        disabled={!canOpen || isDone || activeFilter !== 'OPEN'}
                        aria-label="Stan farby po zakończeniu"
                        className="mx-auto h-10 w-[100px] min-w-[100px] text-center font-black"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">{formatQty(settlement.usageQty, unit)}</td>
                    {showPerPiece && (
                      <>
                        <td className="px-4 py-3 text-center font-semibold">
                          {formatPerPiece(actualUsagePerPiece, unit)}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-title">
                          {formatPerPiece(
                            technologyUsage?.usagePerPiece,
                            technologyUsage?.unit ?? unit
                          )}
                        </td>
                        <td className="min-w-[145px] px-2 py-3 text-center">
                          {getUsageAllocationPreview(settlement, group).length > 0 ? (
                            <div className="space-y-1 text-center text-xs font-semibold text-title">
                              {getUsageAllocationPreview(settlement, group).map((allocation) => (
                                <p key={`${settlement.id}-${allocation.orderNumber}`}>
                                  <span className="text-[var(--value-purple)]">{allocation.orderNumber}</span>
                                  : {formatQty(allocation.usageQty, unit)}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <span className="text-dim">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            {isOutsideTechnology && (
                              <button
                                type="button"
                                onClick={() => setActiveUsageCheckNoteId(settlement.id)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(255,122,0,0.55)] bg-[rgba(255,122,0,0.10)] text-[var(--accent)] transition hover:bg-[rgba(255,122,0,0.18)]"
                                title="Zużyto fizycznie, ale materiał nie występuje w technologii"
                                aria-label="Zużyto fizycznie, ale materiał nie występuje w technologii"
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </button>
                            )}
                            {usageComparison === 'HIGHER' && (
                              <ArrowUp
                                className="h-5 w-5 text-[var(--danger)]"
                                aria-label="Zużycie rzeczywiste jest wyższe od technologicznego"
                              />
                            )}
                            {usageComparison === 'LOWER' && (
                              <ArrowDown
                                className="h-5 w-5 text-[var(--accent)]"
                                aria-label="Zużycie rzeczywiste jest niższe od technologicznego"
                              />
                            )}
                            {usageComparison === 'MATCH' && (
                              <CheckCircle2
                                className="h-5 w-5 text-success"
                                aria-label="Zużycie rzeczywiste jest zgodne z technologicznym"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setActiveUsageCheckNoteId((current) =>
                                  current === settlement.id ? null : settlement.id
                                )
                              }
                              className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-lg border border-border text-dim transition hover:border-[rgba(255,122,0,0.6)] hover:text-[var(--accent)]',
                                Boolean(settlement.usageCheckNote) &&
                                  'border-[rgba(255,122,0,0.55)] bg-[rgba(255,122,0,0.10)] text-[var(--accent)]'
                              )}
                              title="Dodaj notatkę kontrolną"
                              aria-label="Dodaj notatkę kontrolną"
                            >
                              <CircleHelp className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                    {showActions && (
                      <td className="px-4 py-3">{renderSettlementActions(settlement)}</td>
                    )}
                    </tr>
                    {usageCheckNoteOpen && (
                      <tr className="border-t border-[rgba(255,255,255,0.08)] bg-[rgba(255,122,0,0.035)]">
                        <td colSpan={tableColumnCount} className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <textarea
                              value={getUsageCheckNoteDraft(settlement)}
                              onChange={(event) => setUsageCheckNoteDraft(settlement.id, event.target.value)}
                              disabled={!canAccounting || groupBusy}
                              maxLength={1000}
                              rows={1}
                              placeholder="Notatka kontrolna, np. sprawdzić pobranie..."
                              className="min-h-[40px] flex-1 resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm font-semibold text-body outline-none transition focus:border-[rgba(255,122,0,0.65)] disabled:cursor-not-allowed disabled:opacity-50"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => handleSaveUsageCheckNote(settlement)}
                              disabled={!canAccounting || groupBusy}
                              className="min-h-[40px] shrink-0 px-3 py-2"
                            >
                              <Save className="mr-2 h-4 w-4" />
                              Zapisz
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {activeFilter === 'OPEN' && (
          <div className="mt-4 grid gap-3 border-t border-[rgba(255,255,255,0.10)] pt-4 md:flex md:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleExportGroup(group)}
              className="min-h-[42px] w-full px-3 py-2 md:w-auto"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Eksport Excel
            </Button>
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
              variant="ghost"
              onClick={() => void handleExportGroup(group)}
              className="min-h-[42px] w-full px-3 py-2 md:w-auto"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Eksport Excel
            </Button>
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
        {(activeFilter === 'DONE' || activeFilter === 'ACCOUNTED') && (
          <div className="mt-4 border-t border-[rgba(255,255,255,0.10)] pt-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <textarea
                value={getGroupOrderNoteDraft(group)}
                onChange={(event) => setGroupOrderNoteDraft(group, event.target.value)}
                disabled={!canAccounting || groupBusy}
                maxLength={3000}
                rows={1}
                aria-label="Uwagi do zlecenia"
                placeholder="Uwagi do zlecenia..."
                className="min-h-[42px] w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm font-semibold text-body outline-none transition focus:border-[rgba(255,122,0,0.65)] disabled:cursor-not-allowed disabled:opacity-50 md:flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleSaveGroupOrderNote(group)}
                disabled={!canAccounting || groupBusy}
                className="min-h-[42px] w-full shrink-0 px-3 py-2 md:w-auto"
              >
                <Save className="mr-2 h-4 w-4" />
                Zapisz uwagę
              </Button>
              {activeFilter === 'ACCOUNTED' && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void handleExportGroup(group)}
                  className="min-h-[42px] w-full shrink-0 px-3 py-2 md:w-auto"
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Eksport Excel
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleAccountedGroup(group)}
                disabled={!canAccounting || groupBusy}
                aria-pressed={groupAccounted}
                className={cn(
                  'min-h-[42px] w-full shrink-0 px-3 py-2 md:w-auto',
                  groupAccounted &&
                    'border-[color:color-mix(in_srgb,var(--success)_65%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_16%,transparent)] text-success'
                )}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {groupAccounted ? 'Cofnij rozliczenie' : 'Rozliczone'}
              </Button>
              {activeFilter === 'DONE' && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleReopenGroup(group)}
                  disabled={!canAccounting || groupBusy}
                  className="min-h-[42px] w-full shrink-0 px-3 py-2 md:w-auto"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Cofnij zlecenie
                </Button>
              )}
            </div>
          </div>
        )}
      </article>
    );
  });

  const statusButtonClass =
    'flex min-h-[50px] min-w-0 items-center justify-center whitespace-normal break-words border-[rgba(255,122,26,0.22)] bg-[rgba(255,122,26,0.035)] px-2 py-2 text-center text-[12px] leading-tight shadow-[0_8px_22px_rgba(255,122,26,0.08)] data-[state=active]:shadow-[0_0_0_2px_rgba(255,122,26,0.22),0_0_22px_rgba(255,122,26,0.28),inset_0_1px_0_rgba(255,255,255,0.1)] sm:min-h-[44px] sm:px-3 sm:text-sm';

  const statusFilters = (
    <Tabs value={activeFilter} onValueChange={(value) => setFilter(value as FilterValue)}>
      <TabsList className="grid w-full grid-cols-2 gap-2 border-0 bg-transparent p-0 shadow-none sm:grid-cols-5">
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
      {statusFilters}

      {visibleFilters.length === 0 && (
        <Card>
          <EmptyState
            title="Brak dostepu do etapow"
            description="Administrator musi wlaczyc przynajmniej jeden etap rozliczania farb i rozcienczalnikow."
          />
        </Card>
      )}

      {activeFilter === 'CREATE' && visibleFilters.length > 0 && (
      <Card className="border-0 bg-transparent p-0 shadow-none hover:border-transparent hover:bg-transparent">
        <form
          onSubmit={handleCreate}
          className="w-full overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] border-t-2 border-t-[var(--accent)] bg-[rgba(15,15,18,0.96)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
        >
          <div className="border-b border-[rgba(255,255,255,0.09)] bg-[linear-gradient(135deg,rgba(255,122,0,0.10),rgba(255,255,255,0.015)_55%)] px-6 py-5">
            <h2 className="text-xl font-black text-title">Nowa produkcja</h2>
          </div>

          <div className="space-y-5 px-6 py-6 lg:px-7 lg:py-7">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-black ${
                  form.detailName.trim() && form.productionStartedAt
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                    : 'border-[rgba(255,122,0,0.50)] bg-[rgba(255,122,0,0.10)] text-[var(--accent)]'
                }`}
              >
                {form.detailName.trim() && form.productionStartedAt ? '✓' : '1'}
              </span>
              <p className="text-sm font-black text-title">Dane zlecenia</p>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-dim">
                Numery zleceń <span className="normal-case text-dim">(opcjonalnie)</span>
              </label>
              <div className="relative mt-3">
                <Input
                  value={form.orderNumber}
                  onChange={(event) => setForm((prev) => ({ ...prev, orderNumber: event.target.value }))}
                  placeholder="opcjonalnie, np. 5599, 5812, 5852"
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
              <label className="text-xs font-semibold uppercase tracking-wide text-dim">
                Nazwa detalu
              </label>
              <div className="relative mt-3">
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
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-dim">
                Rozpoczęcie produkcji
              </label>
              <Input
                type="datetime-local"
                value={form.productionStartedAt}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, productionStartedAt: event.target.value }))
                }
                disabled={!canCreate}
                className="mt-3"
              />
            </div>
          </div>

          <div className="space-y-4 border-t border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.018)] px-6 py-6 lg:px-7 lg:py-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-black ${
                    itemDrafts.some((draft) => draft.itemName.trim())
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400'
                      : 'border-[rgba(255,122,0,0.50)] bg-[rgba(255,122,0,0.10)] text-[var(--accent)]'
                  }`}
                >
                  {itemDrafts.some((draft) => draft.itemName.trim()) ? '✓' : '2'}
                </span>
                <p className="text-sm font-black text-title">Farby / rozcieńczalniki</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={addItemDraft}
                disabled={!canCreate || createMutation.isPending}
                className="min-h-[40px] shrink-0 px-3 py-2"
              >
                <Plus className="mr-2 h-4 w-4" />
                Dodaj farbę / rozcieńczalnik
              </Button>
            </div>

            <div className="border-t border-[rgba(255,255,255,0.10)] md:space-y-3 md:border-t-0">
              {itemDrafts.map((draft, index) => {
                const itemSuggestions = getItemSuggestions(draft.itemName);
                const formErpSnapshot = getFormErpSnapshot(draft.itemName);
                return (
                  <div
                    key={draft.id}
                    className="grid gap-3 border-b border-[rgba(255,255,255,0.10)] py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-start md:rounded-xl md:border md:border-[rgba(255,255,255,0.10)] md:bg-[rgba(255,255,255,0.03)] md:p-4 md:last:border-b"
                  >
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">
                        Farba / rozcieńczalnik {index + 1}
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
                            aria-label="Wyczyść farbę / rozcieńczalnik"
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
                    <div className="flex justify-end md:pt-5">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => removeItemDraft(draft.id)}
                        disabled={!canCreate || itemDrafts.length <= 1 || createMutation.isPending}
                        className="min-h-[40px] w-11 px-0 py-2"
                        aria-label="Usuń farbę / rozcieńczalnik"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-[rgba(255,255,255,0.10)] bg-[linear-gradient(90deg,rgba(255,122,0,0.07),rgba(255,122,0,0.02))] px-6 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-7">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[rgba(255,122,0,0.50)] bg-[rgba(255,122,0,0.10)] text-sm font-black text-[var(--accent)]">
                3
              </span>
              <p className="text-sm font-black text-title">Utwórz produkcję</p>
            </div>
            <Button
              type="submit"
              disabled={
                !canCreate ||
                createMutation.isPending ||
                !form.detailName.trim() ||
                !form.productionStartedAt ||
                !itemDrafts.some((draft) => draft.itemName.trim())
              }
              className="w-full sm:w-auto sm:min-w-56"
            >
              <Plus className="mr-2 h-4 w-4" />
              Utwórz produkcję
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
            {canOpen && (
              <div>
                <input
                  ref={technologyImportInputRef}
                  type="file"
                  accept=".docx,.xlsx,.xls"
                  className="hidden"
                  onChange={(event) => void handleTechnologyImport(event.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => technologyImportInputRef.current?.click()}
                  disabled={technologyImportMutation.isPending}
                  className="min-h-[38px] px-3 py-2"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {technologyImportMutation.isPending ? 'Importowanie...' : 'Import norm technologicznych'}
                </Button>
              </div>
            )}
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

        {(activeFilter === 'DONE' || activeFilter === 'ACCOUNTED') &&
          groupedSettlements.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-[rgba(255,122,0,0.28)] bg-[rgba(255,122,0,0.055)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-title">
              <input
                type="checkbox"
                checked={
                  groupedSettlements.length > 0 &&
                  groupedSettlements.every((group) => selectedExportGroupKeys.has(group.key))
                }
                onChange={(event) => toggleAllVisibleExportGroups(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Zaznacz wszystkie produkcje
            </label>
            <Button
              type="button"
              onClick={() => void handleExportSelectedGroups()}
              disabled={!groupedSettlements.some((group) => selectedExportGroupKeys.has(group.key))}
              className="w-full sm:w-auto"
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Eksportuj zaznaczone ({
                groupedSettlements.filter((group) => selectedExportGroupKeys.has(group.key)).length
              })
            </Button>
          </div>
        )}

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
