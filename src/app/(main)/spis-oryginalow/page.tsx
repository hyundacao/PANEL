'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cell } from 'exceljs';
import {
  addOriginalInventory,
  getOriginalInventory,
  getOriginalInventoryCatalog,
  getOriginalInventoryCatalogFromErp,
  getOriginalInventoryErpSnapshot,
  getOriginalInventoryErpSnapshotsByDates,
  importOriginalInventoryCatalogFile,
  importOriginalInventoryErpSnapshotFile,
  getWarehouses,
  removeOriginalInventoryErpSnapshot,
  removeOriginalInventory,
  updateOriginalInventory
} from '@/lib/api';
import type { OriginalInventoryErpSnapshotEntry } from '@/lib/api/types';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { SelectField } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';
import { parseQtyInput } from '@/lib/utils/format';
import {
  isOriginalInventoryErpSnapshotPdfFile,
  parseOriginalInventoryErpSnapshotPdfFile
} from '@/lib/utils/originalInventoryErpPdf';

const WAREHOUSE_STORAGE_KEY = 'spis-oryginalow-warehouse';
const TAB_STORAGE_KEY = 'spis-oryginalow-tab';
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const exportCatalogCollator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });
const dailyReportExcludePatterns = [/^ABS\s*30\//i];
const ERP_ORIGINALS_PROXY_NOT_CONFIGURED = 'ERP_ORIGINALS_PROXY_NOT_CONFIGURED';
const ERP_SNAPSHOT_MIGRATION_REQUIRED = 'MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS';
const ERP_ORIGINALS_INTEGRATION_PLACEHOLDER =
  [
    'Source: ERP proxy API (aktywny)',
    'Action: getOriginalInventoryCatalogFromErp',
    'ENV: ERP_ORIGINALS_PROXY_URL',
    'ENV: ERP_ORIGINALS_PROXY_TOKEN (opcjonalny)',
    'ENV: ERP_ORIGINALS_PROXY_TIMEOUT_MS (opcjonalny, domyslnie 10000 ms)',
    'Response: [] lub { items: [] }, pola: id/name/unit/createdAt'
  ].join('\n');

const isErpOriginalsSourceError = (error: unknown) =>
  error instanceof Error && error.message === ERP_ORIGINALS_PROXY_NOT_CONFIGURED;

const isErpSnapshotMigrationError = (error: unknown) =>
  error instanceof Error && error.message === ERP_SNAPSHOT_MIGRATION_REQUIRED;

const getInitialTabValue = (): 'spis' | 'kartoteki' | 'stany-erp' | 'raporty' => {
  if (typeof window === 'undefined') return 'spis';
  const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
  if (saved === 'spis' || saved === 'kartoteki' || saved === 'stany-erp' || saved === 'raporty') {
    return saved;
  }
  return 'spis';
};

const getInitialWarehouseValue = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(WAREHOUSE_STORAGE_KEY) ?? '';
};

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildEntryTimestamp = (dateKey: string) => {
  if (!dateKey) return undefined;
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const now = new Date();
  const local = new Date(
    year,
    month - 1,
    day,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  );
  if (Number.isNaN(local.getTime())) return undefined;
  return local.toISOString();
};

const getEntryDateKey = (value: string) => getLocalDateValue(new Date(value));

const formatCompactDate = (dateKey: string) => {
  if (!dateKey) return '-';
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return dateKey;
  const value = new Date(year, month - 1, day);
  return value.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit'
  });
};

const formatSignedQty = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'brak ERP';
  const absValue = Math.abs(value);
  const label = Number.isInteger(absValue)
    ? absValue.toLocaleString('pl-PL')
    : absValue.toLocaleString('pl-PL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
      });
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${label}`;
};

const formatQty = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number.isInteger(value)
    ? value.toLocaleString('pl-PL')
    : value.toLocaleString('pl-PL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3
      });
};

const formatExcelQty = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, '');
};

const formatExcelSignedQty = (value: number | null | undefined) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'brak ERP';
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '-'}${formatExcelQty(Math.abs(value))}`;
};

const formatDiffHistoryCell = (point?: { dateKey: string; diffQty: number | null } | null) => {
  if (!point) return 'brak danych';
  if (point.diffQty === null) return `${formatCompactDate(point.dateKey)}: brak danych`;
  return `${formatCompactDate(point.dateKey)}: ${formatSignedQty(point.diffQty)}`;
};

const formatExcelDiffHistoryCell = (point?: { dateKey: string; diffQty: number | null } | null) => {
  if (!point) return 'brak danych';
  if (point.diffQty === null) return `${formatCompactDate(point.dateKey)}: brak danych`;
  return `${formatCompactDate(point.dateKey)}: ${formatExcelSignedQty(point.diffQty)}`;
};

const formatErpSnapshotPair = (
  realQty: number | null | undefined,
  availableQty: number | null | undefined,
  formatter: (value: number | null | undefined) => string = formatQty
) => `Rzecz: ${formatter(realQty)} | Dysp: ${formatter(availableQty)}`;

const formatDiffPair = (
  realDiffQty: number | null | undefined,
  availableDiffQty: number | null | undefined,
  formatter: (value: number | null | undefined) => string = formatSignedQty
) => `Rzecz: ${formatter(realDiffQty)} | Dysp: ${formatter(availableDiffQty)}`;

const formatDiffHistoryPair = (
  realPoint?: { dateKey: string; diffQty: number | null } | null,
  availablePoint?: { dateKey: string; diffQty: number | null } | null,
  formatter: (point?: { dateKey: string; diffQty: number | null } | null) => string = formatDiffHistoryCell
) => `Rzecz: ${formatter(realPoint)} | Dysp: ${formatter(availablePoint)}`;

const getReportVisibilitySuffix = (showRealQty: boolean, showAvailableQty: boolean) => {
  const labels: string[] = [];
  if (showRealQty) labels.push('rzecz.');
  if (showAvailableQty) labels.push('dysp.');
  return labels.length > 0 ? ` (${labels.join('/')})` : '';
};

const formatVisibleReportPair = (
  showRealQty: boolean,
  showAvailableQty: boolean,
  realQty: number | null | undefined,
  availableQty: number | null | undefined,
  formatter: (value: number | null | undefined) => string = formatQty
) => {
  const parts: string[] = [];
  if (showRealQty) parts.push(`Rzecz: ${formatter(realQty)}`);
  if (showAvailableQty) parts.push(`Dysp: ${formatter(availableQty)}`);
  return parts.join(' | ');
};

const formatVisibleReportHistoryPair = (
  showRealQty: boolean,
  showAvailableQty: boolean,
  realPoint?: { dateKey: string; diffQty: number | null } | null,
  availablePoint?: { dateKey: string; diffQty: number | null } | null,
  formatter: (point?: { dateKey: string; diffQty: number | null } | null) => string = formatDiffHistoryCell
) => {
  const parts: string[] = [];
  if (showRealQty) parts.push(`Rzecz: ${formatter(realPoint)}`);
  if (showAvailableQty) parts.push(`Dysp: ${formatter(availablePoint)}`);
  return parts.join(' | ');
};

const normalizeImportCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCatalogNameKey = (value: unknown) => normalizeImportCell(value).toLowerCase();

const isCatalogHeaderRow = (name: string, unit: string) => {
  const normalizedName = name.toLowerCase();
  const normalizedUnit = unit.toLowerCase().replace(/\./g, '');
  const nameHeaders = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
  const unitHeaders = new Set(['jedn', 'jm', 'jednostka', 'unit']);
  return nameHeaders.has(normalizedName) && (!normalizedUnit || unitHeaders.has(normalizedUnit));
};

const parseSnapshotQty = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = normalizeImportCell(value).replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isSnapshotHeaderRow = (name: string, availableQty: unknown, realQty: unknown) => {
  const normalizedName = name.toLowerCase();
  const availableQtyText = normalizeImportCell(availableQty).toLowerCase();
  const realQtyText = normalizeImportCell(realQty).toLowerCase();
  const nameHeaders = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
  const availableQtyHeaders = new Set([
    'stan do dyspozycji erp',
    'stan do dyspozycji',
    'dostepne',
    'dostępne',
    'available',
    'available qty',
    'stan dostepny',
    'stan dostępny',
    'ilosc',
    'ilość',
    'qty',
    'quantity',
    'stan'
  ]);
  const realQtyHeaders = new Set(['stan rzeczywisty erp', 'stan rzeczywisty']);
  return (
    nameHeaders.has(normalizedName) &&
    availableQtyHeaders.has(availableQtyText) &&
    (realQtyText === '' || realQtyHeaders.has(realQtyText))
  );
};

const parseSnapshotImportFile = async (
  file: File
): Promise<Array<{ name: string; realQty: number; availableQty: number; unit: string }>> => {
  if (isOriginalInventoryErpSnapshotPdfFile(file)) {
    return parseOriginalInventoryErpSnapshotPdfFile(file);
  }
  const XLSX = await import('xlsx');
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: ''
  }) as unknown[][];
  const merged = new Map<
    string,
    { name: string; realQty: number; availableQty: number; unit: string }
  >();
  rows.forEach((row, index) => {
    const name = normalizeImportCell(row?.[0]);
    const availableQty = parseSnapshotQty(row?.[1]);
    const thirdCell = row?.[2];
    const thirdCellText = normalizeImportCell(thirdCell);
    const parsedRealQty = parseSnapshotQty(thirdCell);
    const fourthCellText = normalizeImportCell(row?.[3]);
    const usesNewLayout = fourthCellText.length > 0;
    const realQty = usesNewLayout ? parsedRealQty : parsedRealQty ?? availableQty;
    const unitCell = usesNewLayout ? fourthCellText : thirdCellText;
    if (!name) return;
    if (index === 0 && isSnapshotHeaderRow(name, row?.[1], row?.[2])) return;
    if (realQty === null || availableQty === null) return;
    const key = normalizeCatalogNameKey(name);
    const existing = merged.get(key);
    if (existing) {
      existing.realQty += realQty;
      existing.availableQty += availableQty;
      if (!existing.unit && unitCell) {
        existing.unit = unitCell;
      }
      return;
    }
    merged.set(key, {
      name,
      realQty,
      availableQty,
      unit: unitCell || 'kg'
    });
  });
  return [...merged.values()];
};

const parseCatalogImportFile = async (file: File): Promise<Array<{ name: string; unit?: string }>> => {
  const XLSX = await import('xlsx');
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: ''
  }) as unknown[][];
  const items: Array<{ name: string; unit?: string }> = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = normalizeImportCell(row?.[0]);
    const unitCell = normalizeImportCell(row?.[1]);
    if (!name) return;
    if (index === 0 && isCatalogHeaderRow(name, unitCell)) return;
    const key = normalizeCatalogNameKey(name);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, unit: unitCell || 'kg' });
  });
  return items;
};

export default function OriginalInventoryPage() {
  const toast = useToastStore((state) => state.push);
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'PRZEMIALY');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'spis' | 'kartoteki' | 'stany-erp' | 'raporty'>(() =>
    getInitialTabValue()
  );
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(() =>
    getInitialWarehouseValue()
  );
  const [expandedMaterialKey, setExpandedMaterialKey] = useState<string | null>(null);
  const [quickQty, setQuickQty] = useState('');
  const [quickWarehouseId, setQuickWarehouseId] = useState('');
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { qty: string; warehouseId: string }>
  >({});
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [reportQuery, setReportQuery] = useState('');
  const [showReportSuggestions, setShowReportSuggestions] = useState(false);
  const [showReportRealQty, setShowReportRealQty] = useState(true);
  const [showReportAvailableQty, setShowReportAvailableQty] = useState(true);
  const [spisDate, setSpisDate] = useState(getLocalDateValue());
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogImportFile, setCatalogImportFile] = useState<File | null>(null);
  const [catalogImportInputKey, setCatalogImportInputKey] = useState(0);
  const [catalogImportFileName, setCatalogImportFileName] = useState('');
  const [catalogImportItems, setCatalogImportItems] = useState<Array<{ name: string; unit?: string }>>(
    []
  );
  const [catalogImportSummary, setCatalogImportSummary] = useState<{
    parsed: number;
    toImport: number;
    skipped: number;
  } | null>(null);
  const [catalogImportPreparing, setCatalogImportPreparing] = useState(false);
  const [erpSnapshotImportFile, setErpSnapshotImportFile] = useState<File | null>(null);
  const [erpSnapshotImportInputKey, setErpSnapshotImportInputKey] = useState(0);
  const [erpSnapshotImportFileName, setErpSnapshotImportFileName] = useState('');
  const [erpSnapshotImportSummary, setErpSnapshotImportSummary] = useState<{
    parsed: number;
    currentRows: number;
  } | null>(null);
  const [erpSnapshotImportPreparing, setErpSnapshotImportPreparing] = useState(false);
  const [form, setForm] = useState({
    name: '',
    qty: '',
    unit: 'kg'
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['spis-oryginalow'],
    queryFn: getOriginalInventory
  });
  const { data: erpCatalogState = { items: [], sourceUnavailable: false }, error: catalogError } = useQuery({
    queryKey: ['spis-oryginalow-catalog-erp'],
    queryFn: async () => {
      try {
        return {
          items: await getOriginalInventoryCatalogFromErp(),
          sourceUnavailable: false
        };
      } catch (error) {
        if (isErpOriginalsSourceError(error)) {
          return {
            items: [],
            sourceUnavailable: true
          };
        }
        throw error;
      }
    },
    retry: false
  });
  const { data: localCatalog = [] } = useQuery({
    queryKey: ['spis-oryginalow-catalog-local'],
    queryFn: getOriginalInventoryCatalog
  });
  const { data: erpSnapshotState = { items: [] as OriginalInventoryErpSnapshotEntry[], migrationRequired: false } } = useQuery({
    queryKey: ['spis-oryginalow-erp-snapshot', spisDate],
    queryFn: async () => {
      try {
        return {
          items: await getOriginalInventoryErpSnapshot(spisDate),
          migrationRequired: false
        };
      } catch (error) {
        if (isErpSnapshotMigrationError(error)) {
          return {
            items: [] as OriginalInventoryErpSnapshotEntry[],
            migrationRequired: true
          };
        }
        throw error;
      }
    },
    enabled: Boolean(spisDate),
    retry: false
  });
  const catalog = useMemo(() => {
    const merged = new Map<string, (typeof localCatalog)[number]>();
    const erpCatalogItems = Array.isArray(erpCatalogState?.items) ? erpCatalogState.items : [];
    const localCatalogItems = Array.isArray(localCatalog) ? localCatalog : [];
    erpCatalogItems.forEach((item) => {
      merged.set(item.name.toLowerCase(), item);
    });
    localCatalogItems.forEach((item) => {
      const key = item.name.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    });
    return [...merged.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [erpCatalogState, localCatalog]);
  const catalogErrorCode =
    catalogError instanceof Error && !isErpOriginalsSourceError(catalogError)
      ? catalogError.message
      : '';
  const erpSourceUnavailable = erpCatalogState.sourceUnavailable;
  const erpSnapshotEntries = erpSnapshotState.items;
  const erpSnapshotMigrationRequired = erpSnapshotState.migrationRequired;
  const erpSnapshotMap = useMemo(() => {
    const map = new Map<
      string,
      { name: string; unit: string; realQty: number; availableQty: number }
    >();
    erpSnapshotEntries.forEach((item) => {
      const key = normalizeCatalogNameKey(item.name);
      const current = map.get(key);
      if (current) {
        current.realQty += item.realQty;
        current.availableQty += item.availableQty;
        if (!current.unit && item.unit) {
          current.unit = item.unit;
        }
      } else {
        map.set(key, {
          name: item.name,
          unit: item.unit,
          realQty: item.realQty,
          availableQty: item.availableQty
        });
      }
    });
    return map;
  }, [erpSnapshotEntries]);
  const effectiveSelectedWarehouseId = useMemo(() => {
    if (selectedWarehouseId && warehouses.some((warehouse) => warehouse.id === selectedWarehouseId)) {
      return selectedWarehouseId;
    }
    return warehouses[0]?.id ?? '';
  }, [selectedWarehouseId, warehouses]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!effectiveSelectedWarehouseId) return;
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, effectiveSelectedWarehouseId);
  }, [effectiveSelectedWarehouseId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  const addMutation = useMutation({
    mutationFn: addOriginalInventory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow'] });
      setForm((prev) => ({ ...prev, name: '', qty: '' }));
      toast({ title: 'Dodano wpis do spisu', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        WAREHOUSE_REQUIRED: 'Wybierz hale do spisu.',
        NAME_REQUIRED: 'Podaj pełną nazwę tworzywa lub półproduktu.',
        QTY_REQUIRED: 'Wpisz poprawną ilość.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie dodano wpisu.', tone: 'error' });
    }
  });
  const updateMutation = useMutation({
    mutationFn: updateOriginalInventory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow'] });
      toast({ title: 'Zapisano zmiany', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        ENTRY_MISSING: 'Nie znaleziono wpisu.',
        WAREHOUSE_REQUIRED: 'Wybierz hale.',
        QTY_REQUIRED: 'Wpisz poprawna ilosc.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie zapisano zmian.', tone: 'error' });
    }
  });
  const removeEntryMutation = useMutation({
    mutationFn: removeOriginalInventory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow'] });
      toast({ title: 'Usunieto wpis', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        ENTRY_MISSING: 'Nie znaleziono wpisu.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie usunieto wpisu.', tone: 'error' });
    }
  });
  const importCatalogMutation = useMutation({
    mutationFn: importOriginalInventoryCatalogFile
  });
  const importErpSnapshotMutation = useMutation({
    mutationFn: ({ file, snapshotDate }: { file: File; snapshotDate: string }) =>
      importOriginalInventoryErpSnapshotFile(file, snapshotDate)
  });
  const removeErpSnapshotMutation = useMutation({
    mutationFn: removeOriginalInventoryErpSnapshot,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-erp-snapshot', spisDate] });
      toast({ title: 'Usunieto stany ERP dla wybranego dnia', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        DATE_REQUIRED: 'Wybierz poprawny dzien.',
        MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS:
          'Brakuje migracji bazy dla stanow ERP. Uruchom migracje SQL.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie usunieto stanow ERP.',
        tone: 'error'
      });
    }
  });
  const resetCatalogImportState = () => {
    setCatalogImportFile(null);
    setCatalogImportFileName('');
    setCatalogImportItems([]);
    setCatalogImportSummary(null);
    setCatalogImportInputKey((prev) => prev + 1);
  };
  const handleCatalogFileChange = async (file: File | null) => {
    resetCatalogImportState();
    if (!file) return;
    if (readOnly) {
      toast({ title: 'Brak uprawnien do importu kartotek.', tone: 'error' });
      return;
    }
    setCatalogImportFileName(file.name);
    setCatalogImportFile(file);
    setCatalogImportPreparing(true);
    try {
      const items = await parseCatalogImportFile(file);
      if (items.length === 0) {
        toast({ title: 'Plik nie zawiera kartotek do importu.', tone: 'error' });
        return;
      }
      const existingNames = new Set(catalog.map((item) => normalizeCatalogNameKey(item.name)));
      const toImport = items.filter((item) => !existingNames.has(normalizeCatalogNameKey(item.name)));
      setCatalogImportItems(toImport);
      setCatalogImportSummary({
        parsed: items.length,
        toImport: toImport.length,
        skipped: items.length - toImport.length
      });
      if (toImport.length === 0) {
        toast({ title: 'Wszystkie kartoteki z pliku juz istnieja. Nic do dodania.', tone: 'success' });
      }
    } catch {
      resetCatalogImportState();
      toast({ title: 'Nie odczytano pliku. Sprawdz format CSV/XLS/XLSX.', tone: 'error' });
    } finally {
      setCatalogImportPreparing(false);
    }
  };
  const handleCatalogImport = async () => {
    if (readOnly) {
      toast({ title: 'Brak uprawnien do importu kartotek.', tone: 'error' });
      return;
    }
    const file = catalogImportFile;
    if (!file || catalogImportItems.length === 0) {
      toast({ title: 'Najpierw wybierz poprawny plik z kartotekami.', tone: 'error' });
      return;
    }
    try {
      const result = await importCatalogMutation.mutateAsync(file);
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-catalog-local'] });
      resetCatalogImportState();
      toast({
        title: 'Wgrano kartoteki',
        description: `Dodano: ${result.inserted}, pominieto: ${result.skipped}.`,
        tone: 'success'
      });
    } catch (err) {
      const messageMap: Record<string, string> = {
        EMPTY: 'Plik nie zawiera poprawnych nazw kartotek.',
        FORBIDDEN: 'Brak uprawnien do importu kartotek.'
      };
      const errorCode = err instanceof Error ? err.message : '';
      toast({
        title: messageMap[errorCode] ?? 'Nie wgrano kartotek.',
        description:
          !messageMap[errorCode] && errorCode
            ? `Kod błędu: ${errorCode}`
            : errorCode === ERP_ORIGINALS_PROXY_NOT_CONFIGURED
            ? 'Import lokalny nie powinien zalezec od ERP. Jesli to widzisz, trzeba sprawdzic route API.'
            : undefined,
        tone: 'error'
      });
    }
  };
  const resetErpSnapshotImportState = () => {
    setErpSnapshotImportFile(null);
    setErpSnapshotImportFileName('');
    setErpSnapshotImportSummary(null);
    setErpSnapshotImportInputKey((prev) => prev + 1);
  };
  const handleErpSnapshotFileChange = async (file: File | null) => {
    resetErpSnapshotImportState();
    if (!file) return;
    if (readOnly) {
      toast({ title: 'Brak uprawnien do importu stanow ERP.', tone: 'error' });
      return;
    }
    setErpSnapshotImportPreparing(true);
    setErpSnapshotImportFile(file);
    setErpSnapshotImportFileName(file.name);
    try {
      const items = await parseSnapshotImportFile(file);
      if (items.length === 0) {
        toast({ title: 'Plik nie zawiera poprawnych stanow ERP.', tone: 'error' });
        resetErpSnapshotImportState();
        return;
      }
      setErpSnapshotImportSummary({
        parsed: items.length,
        currentRows: erpSnapshotEntries.length
      });
    } catch {
      resetErpSnapshotImportState();
      toast({
        title: 'Nie odczytano pliku stanow ERP. Sprawdz format XLS/XLSX/CSV/PDF.',
        tone: 'error'
      });
    } finally {
      setErpSnapshotImportPreparing(false);
    }
  };
  const handleErpSnapshotImport = async () => {
    if (readOnly) {
      toast({ title: 'Brak uprawnien do importu stanow ERP.', tone: 'error' });
      return;
    }
    if (!spisDate) {
      toast({ title: 'Wybierz dzien snapshotu ERP.', tone: 'error' });
      return;
    }
    if (!erpSnapshotImportFile) {
      toast({ title: 'Najpierw wybierz plik stanow ERP.', tone: 'error' });
      return;
    }
    try {
      const result = await importErpSnapshotMutation.mutateAsync({
        file: erpSnapshotImportFile,
        snapshotDate: spisDate
      });
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-erp-snapshot', spisDate] });
      resetErpSnapshotImportState();
      toast({
        title: 'Wgrano stany ERP',
        description: `Pozycji: ${result.inserted}. Nadpisano poprzedni snapshot z dnia: ${result.replaced}.`,
        tone: 'success'
      });
    } catch (err) {
      const messageMap: Record<string, string> = {
        DATE_REQUIRED: 'Wybierz poprawny dzien snapshotu.',
        FILE_REQUIRED: 'Wybierz plik do importu.',
        EMPTY: 'Plik nie zawiera poprawnych stanow ERP.',
        FORBIDDEN: 'Brak uprawnien do importu stanow ERP.',
        MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS:
          'Brakuje migracji bazy dla stanow ERP. Uruchom migracje SQL.'
      };
      const errorCode = err instanceof Error ? err.message : '';
      toast({
        title: messageMap[errorCode] ?? 'Nie wgrano stanow ERP.',
        description: !messageMap[errorCode] && errorCode ? `Kod błędu: ${errorCode}` : undefined,
        tone: 'error'
      });
    }
  };
  const handleAdd = () => {
    const name = form.name.trim();
    const qtyValue = parseQtyInput(form.qty);
    if (!effectiveSelectedWarehouseId) {
      toast({ title: 'Wybierz hale do spisu.', tone: 'error' });
      return;
    }
    if (!name) {
      toast({ title: 'Podaj pełną nazwę tworzywa lub półproduktu.', tone: 'error' });
      return;
    }
    if (qtyValue === null || qtyValue <= 0) {
      toast({ title: 'Wpisz poprawną ilość.', tone: 'error' });
      return;
    }
    addMutation.mutate({
      warehouseId: effectiveSelectedWarehouseId,
      name,
      qty: qtyValue,
      unit: form.unit.trim() || 'kg',
      at: buildEntryTimestamp(spisDate),
      user: user?.username ?? user?.name ?? 'nieznany'
    });
  };
  const handleQuickAdd = () => {
    if (!selectedGroup) return;
    const qtyValue = parseQtyInput(quickQty);
    const warehouseId = quickWarehouseId || effectiveSelectedWarehouseId;
    if (!warehouseId) {
      toast({ title: 'Wybierz hale do spisu.', tone: 'error' });
      return;
    }
    if (qtyValue === null || qtyValue <= 0) {
      toast({ title: 'Wpisz poprawna ilosc.', tone: 'error' });
      return;
    }
    addMutation.mutate(
      {
        warehouseId,
        name: selectedGroup.name,
        qty: qtyValue,
        unit: selectedGroup.unit,
        at: buildEntryTimestamp(spisDate),
        user: user?.username ?? user?.name ?? 'nieznany'
      },
      {
        onSuccess: () => {
          setExpandedMaterialKey(null);
          setQuickQty('');
          setForm((prev) => ({ ...prev, name: '', qty: '' }));
        }
      }
    );
  };

  const handleEditSave = (entryId: string) => {
    const draft = editDrafts[entryId];
    if (!draft) return;
    const qtyValue = parseQtyInput(draft.qty);
    if (qtyValue === null || qtyValue <= 0) {
      toast({ title: 'Wpisz poprawna ilosc.', tone: 'error' });
      return;
    }
    updateMutation.mutate({
      id: entryId,
      qty: qtyValue,
      warehouseId: draft.warehouseId
    });
  };
  const updateEditDraft = (entryId: string, patch: Partial<{ qty: string; warehouseId: string }>) => {
    setEditDrafts((prev) => ({
      ...prev,
      [entryId]: { ...prev[entryId], ...patch }
    }));
  };
  const handleRemoveEntry = (entryId: string, entryName: string) => {
    removeEntryMutation.mutate(entryId, {
      onSuccess: () => {
        if (expandedMaterialKey === entryName.toLowerCase() && selectedEntries.length === 1) {
          setExpandedMaterialKey(null);
        }
      }
    });
  };

  const warehouseNameMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])),
    [warehouses]
  );
  const warehouseOrderMap = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.orderNo])),
    [warehouses]
  );
  const entriesForDate = useMemo(() => {
    if (!spisDate) return entries;
    return entries.filter((entry) => getEntryDateKey(entry.at) === spisDate);
  }, [entries, spisDate]);

  const existingByName = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; total: number }>();
    entriesForDate.forEach((entry) => {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      if (current) {
        current.total += entry.qty;
      } else {
        map.set(key, { name: entry.name, unit: entry.unit, total: entry.qty });
      }
    });
    return map;
  }, [entriesForDate]);
  const existingList = useMemo(
    () =>
      [...existingByName.values()].sort((a, b) =>
        collator.compare(a.name, b.name)
      ),
    [existingByName]
  );
  const matchedExisting = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return null;
    return existingByName.get(needle) ?? null;
  }, [existingByName, form.name]);
  const matchedErpSnapshot = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return null;
    return erpSnapshotMap.get(needle) ?? null;
  }, [erpSnapshotMap, form.name]);
  const nameSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    existingList.forEach((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push(item.name);
    });
    catalog.forEach((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push(item.name);
    });
    return list;
  }, [catalog, existingList]);
  const filteredNameSuggestions = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return [];
    return nameSuggestions
      .filter((item) => item.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [form.name, nameSuggestions]);
  const filteredCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((item) => item.name.toLowerCase().includes(needle));
  }, [catalog, catalogSearch]);
  const applyNameToForm = (rawName: string) => {
    const needle = rawName.trim().toLowerCase();
    if (!needle) {
      setForm((prev) => ({ ...prev, name: rawName }));
      return;
    }
    const matched =
      existingByName.get(needle) ??
      catalog.find((item) => item.name.toLowerCase() === needle) ??
      null;
    if (matched) {
      setForm((prev) => ({ ...prev, name: matched.name, unit: matched.unit }));
      return;
    }
    setForm((prev) => ({ ...prev, name: rawName }));
  };

  const materialGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; unit: string; entries: typeof entriesForDate }
    >();
    entriesForDate.forEach((entry) => {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      if (current) {
        current.entries.push(entry);
      } else {
        map.set(key, { key, name: entry.name, unit: entry.unit, entries: [entry] });
      }
    });
    return map;
  }, [entriesForDate]);

  const reportOptions = useMemo(() => {
    const map = new Map<string, { key: string; name: string }>();
    entries.forEach((entry) => {
      const key = entry.name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { key, name: entry.name });
      }
    });
    return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [entries]);
  const selectedReportMaterialKey = useMemo(() => {
    const query = reportQuery.trim().toLowerCase();
    if (!query || reportOptions.length === 0) return '';
    const exactMatch = reportOptions.find((option) => option.name.toLowerCase() === query);
    return exactMatch?.key ?? '';
  }, [reportOptions, reportQuery]);
  const reportEntries = useMemo(() => {
    if (!selectedReportMaterialKey) return [];
    return entries
      .filter((entry) => entry.name.toLowerCase() === selectedReportMaterialKey)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [entries, selectedReportMaterialKey]);
  const reportSuggestions = useMemo(() => {
    const needle = reportQuery.trim().toLowerCase();
    if (!needle) return [];
    return reportOptions
      .map((option) => option.name)
      .filter((name) => name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [reportOptions, reportQuery]);

  const dailyEntries = useMemo(() => {
    if (!spisDate) return [];
    return entriesForDate
      .filter(
        (entry) => !dailyReportExcludePatterns.some((pattern) => pattern.test(entry.name))
      )
      .sort((a, b) => {
        const nameCompare = collator.compare(a.name, b.name);
        if (nameCompare !== 0) return nameCompare;
        return a.at.localeCompare(b.at);
      });
  }, [entriesForDate, spisDate]);
  const dailySummary = useMemo(() => {
    const map = new Map<string, { key: string; name: string; unit: string; qty: number }>();
    dailyEntries.forEach((entry) => {
      const materialKey = normalizeCatalogNameKey(entry.name);
      const key = `${materialKey}|${entry.unit.toLowerCase()}`;
      const current = map.get(key);
      if (current) {
        current.qty += entry.qty;
      } else {
        map.set(key, { key: materialKey, name: entry.name, unit: entry.unit, qty: entry.qty });
      }
    });
    return [...map.values()].sort((a, b) => {
      const nameCompare = exportCatalogCollator.compare(a.name.trim(), b.name.trim());
      if (nameCompare !== 0) return nameCompare;
      return exportCatalogCollator.compare(a.unit.trim(), b.unit.trim());
    });
  }, [dailyEntries]);
  const inventoryHistoryByMaterial = useMemo(() => {
    if (!spisDate) return new Map<string, Array<{ dateKey: string; name: string; unit: string; qty: number }>>();
    const grouped = new Map<
      string,
      Map<string, { dateKey: string; name: string; unit: string; qty: number }>
    >();
    entries.forEach((entry) => {
      if (dailyReportExcludePatterns.some((pattern) => pattern.test(entry.name))) return;
      const dateKey = getEntryDateKey(entry.at);
      if (dateKey > spisDate) return;
      const materialKey = normalizeCatalogNameKey(entry.name);
      let datesMap = grouped.get(materialKey);
      if (!datesMap) {
        datesMap = new Map();
        grouped.set(materialKey, datesMap);
      }
      const current = datesMap.get(dateKey);
      if (current) {
        current.qty += entry.qty;
        if (!current.unit && entry.unit) {
          current.unit = entry.unit;
        }
        return;
      }
      datesMap.set(dateKey, {
        dateKey,
        name: entry.name,
        unit: entry.unit,
        qty: entry.qty
      });
    });
    const result = new Map<string, Array<{ dateKey: string; name: string; unit: string; qty: number }>>();
    grouped.forEach((datesMap, materialKey) => {
      result.set(
        materialKey,
        [...datesMap.values()].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      );
    });
    return result;
  }, [entries, spisDate]);
  const reportPreviousSnapshotDates = useMemo(() => {
    const dates = new Set<string>();
    dailySummary.forEach((entry) => {
      (inventoryHistoryByMaterial.get(entry.key) ?? [])
        .slice(1, 5)
        .forEach((point) => dates.add(point.dateKey));
    });
    return [...dates].sort((a, b) => b.localeCompare(a));
  }, [dailySummary, inventoryHistoryByMaterial]);
  const {
    data: historicalErpSnapshotState = {
      items: [] as OriginalInventoryErpSnapshotEntry[],
      migrationRequired: false
    }
  } = useQuery({
    queryKey: ['spis-oryginalow-erp-snapshot-history', reportPreviousSnapshotDates],
    queryFn: async () => {
      try {
        return {
          items: await getOriginalInventoryErpSnapshotsByDates(reportPreviousSnapshotDates),
          migrationRequired: false
        };
      } catch (error) {
        if (isErpSnapshotMigrationError(error)) {
          return {
            items: [] as OriginalInventoryErpSnapshotEntry[],
            migrationRequired: true
          };
        }
        throw error;
      }
    },
    enabled: reportPreviousSnapshotDates.length > 0,
    retry: false
  });
  const erpSnapshotSummary = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; unit: string; realQty: number; availableQty: number }
    >();
    erpSnapshotEntries.forEach((entry) => {
      const key = normalizeCatalogNameKey(entry.name);
      const current = map.get(key);
      if (current) {
        current.realQty += entry.realQty;
        current.availableQty += entry.availableQty;
      } else {
        map.set(key, {
          key,
          name: entry.name,
          unit: entry.unit,
          realQty: entry.realQty,
          availableQty: entry.availableQty
        });
      }
    });
    return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [erpSnapshotEntries]);
  const historicalErpSnapshotEntries = historicalErpSnapshotState.items;
  const reportErpSnapshotMigrationRequired =
    erpSnapshotMigrationRequired || historicalErpSnapshotState.migrationRequired;
  const erpSnapshotByDateAndMaterial = useMemo(() => {
    const datesMap = new Map<
      string,
      Map<string, { name: string; unit: string; realQty: number; availableQty: number }>
    >();
    const addEntry = (entry: OriginalInventoryErpSnapshotEntry) => {
      const dateKey = entry.snapshotDate;
      let materialMap = datesMap.get(dateKey);
      if (!materialMap) {
        materialMap = new Map();
        datesMap.set(dateKey, materialMap);
      }
      const key = normalizeCatalogNameKey(entry.name);
      const current = materialMap.get(key);
      if (current) {
        current.realQty += entry.realQty;
        current.availableQty += entry.availableQty;
        if (!current.unit && entry.unit) {
          current.unit = entry.unit;
        }
      } else {
        materialMap.set(key, {
          name: entry.name,
          unit: entry.unit,
          realQty: entry.realQty,
          availableQty: entry.availableQty
        });
      }
    };
    erpSnapshotEntries.forEach(addEntry);
    historicalErpSnapshotEntries.forEach(addEntry);
    return datesMap;
  }, [erpSnapshotEntries, historicalErpSnapshotEntries]);
  const currentErpSnapshotMeta = useMemo(() => {
    if (erpSnapshotEntries.length === 0) return null;
    const latest = [...erpSnapshotEntries].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0];
    if (!latest) return null;
    return {
      importedAt: latest.importedAt,
      importedBy: latest.importedBy,
      sourceFileName: latest.sourceFileName || null
    };
  }, [erpSnapshotEntries]);
  const reportRows = useMemo(() => {
    return [...dailySummary]
      .map((entry) => {
        const recentComparisons = (inventoryHistoryByMaterial.get(entry.key) ?? [])
          .slice(0, 6)
          .map((point) => {
            const erpPoint = erpSnapshotByDateAndMaterial.get(point.dateKey)?.get(entry.key) ?? null;
            const realErpQty = erpPoint?.realQty ?? null;
            const availableErpQty = erpPoint?.availableQty ?? null;
            return {
              dateKey: point.dateKey,
              spisQty: point.qty,
              realErpQty,
              availableErpQty,
              realDiffQty: realErpQty === null ? null : point.qty - realErpQty,
              availableDiffQty: availableErpQty === null ? null : point.qty - availableErpQty
            };
          });
        const currentSnapshot = erpSnapshotMap.get(entry.key);
        const currentComparison = recentComparisons[0] ?? {
          dateKey: spisDate,
          spisQty: entry.qty,
          realErpQty: currentSnapshot?.realQty ?? null,
          availableErpQty: currentSnapshot?.availableQty ?? null,
          realDiffQty:
            currentSnapshot?.realQty === undefined ? null : entry.qty - (currentSnapshot?.realQty ?? 0),
          availableDiffQty:
            currentSnapshot?.availableQty === undefined
              ? null
              : entry.qty - (currentSnapshot?.availableQty ?? 0)
        };
        const previousDiffs = Array.from({ length: 5 }, (_, index) => recentComparisons[index + 1] ?? null);
        return {
          key: entry.key,
          name: entry.name,
          unit: entry.unit,
          currentRealErpQty: currentComparison.realErpQty,
          currentAvailableErpQty: currentComparison.availableErpQty,
          currentSpisQty: currentComparison.spisQty,
          currentRealDiffQty: currentComparison.realDiffQty,
          currentAvailableDiffQty: currentComparison.availableDiffQty,
          previousRealDiffs: previousDiffs.map((point) =>
            point
              ? {
                  dateKey: point.dateKey,
                  diffQty: point.realDiffQty
                }
              : null
          ),
          previousAvailableDiffs: previousDiffs.map((point) =>
            point
              ? {
                  dateKey: point.dateKey,
                  diffQty: point.availableDiffQty
                }
              : null
          )
        };
      })
      .sort((a, b) => {
        const nameCompare = exportCatalogCollator.compare(a.name.trim(), b.name.trim());
        if (nameCompare !== 0) return nameCompare;
        return exportCatalogCollator.compare(a.unit.trim(), b.unit.trim());
      });
  }, [dailySummary, inventoryHistoryByMaterial, erpSnapshotByDateAndMaterial, erpSnapshotMap, spisDate]);
  const dailyComparison = useMemo(
    () =>
      reportRows.map((row) => ({
        name: row.name,
        unit: row.unit,
        realErpQty: row.currentRealErpQty,
        availableErpQty: row.currentAvailableErpQty,
        spisQty: row.currentSpisQty,
        realDiffQty: row.currentRealDiffQty,
        availableDiffQty: row.currentAvailableDiffQty
      })),
    [reportRows]
  );

  const handleExportDailyLegacy = async () => {
    if (!spisDate || reportRows.length === 0) return;
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const generatedAt = new Date().toLocaleString('pl-PL');
      const fitWidth = (
        values: string[],
        minWidth: number,
        maxWidth: number,
        multiplier = 1,
        padding = 2
      ) => {
        const longest = values.reduce((max, value) => Math.max(max, value.length), 0);
        return Math.min(maxWidth, Math.max(minWidth, Math.ceil(longest * multiplier) + padding));
      };
      const columnWidths = {
        name: fitWidth(
          ['Material', ...reportRows.map((row) => row.name)],
          34,
          90,
          1.18,
          4
        ),
        unit: fitWidth(
          ['Jedn.', ...reportRows.map((row) => row.unit)],
          8,
          12
        ),
        erpToday: fitWidth(
          [
            'ERP dziś (rzecz./dysp.)',
            ...reportRows.map((row) =>
              formatErpSnapshotPair(
                row.currentRealErpQty,
                row.currentAvailableErpQty,
                formatExcelQty
              )
            )
          ],
          12,
          18
        ),
        spisToday: fitWidth(
          ['Spis dziś', ...reportRows.map((row) => formatExcelQty(row.currentSpisQty))],
          12,
          18
        ),
        diffToday: fitWidth(
          [
            'Różnica dziś (rzecz./dysp.)',
            ...reportRows.map((row) =>
              formatDiffPair(
                row.currentRealDiffQty,
                row.currentAvailableDiffQty,
                formatExcelSignedQty
              )
            )
          ],
          14,
          20
        ),
        diffPrev1: fitWidth(
          [
            'Różnica -1',
            ...reportRows.map((row) =>
              formatDiffHistoryPair(
                row.previousRealDiffs[0],
                row.previousAvailableDiffs[0],
                formatExcelDiffHistoryCell
              )
            )
          ],
          18,
          24
        ),
        diffPrev2: fitWidth(
          [
            'Różnica -2',
            ...reportRows.map((row) =>
              formatDiffHistoryPair(
                row.previousRealDiffs[1],
                row.previousAvailableDiffs[1],
                formatExcelDiffHistoryCell
              )
            )
          ],
          18,
          24
        ),
        diffPrev3: fitWidth(
          [
            'Różnica -3',
            ...reportRows.map((row) =>
              formatDiffHistoryPair(
                row.previousRealDiffs[2],
                row.previousAvailableDiffs[2],
                formatExcelDiffHistoryCell
              )
            )
          ],
          18,
          24
        ),
        diffPrev4: fitWidth(
          [
            'Różnica -4',
            ...reportRows.map((row) =>
              formatDiffHistoryPair(
                row.previousRealDiffs[3],
                row.previousAvailableDiffs[3],
                formatExcelDiffHistoryCell
              )
            )
          ],
          18,
          24
        ),
        diffPrev5: fitWidth(
          [
            'Różnica -5',
            ...reportRows.map((row) =>
              formatDiffHistoryPair(
                row.previousRealDiffs[4],
                row.previousAvailableDiffs[4],
                formatExcelDiffHistoryCell
              )
            )
          ],
          18,
          24
        )
      };
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'APKA DLA KAMILA';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Raport', {
        views: [{ state: 'frozen', ySplit: 4 }]
      });

      worksheet.columns = [
        { header: 'Material', key: 'name', width: columnWidths.name },
        { header: 'Jedn.', key: 'unit', width: columnWidths.unit },
        { header: 'ERP dziś (rzecz./dysp.)', key: 'erpToday', width: columnWidths.erpToday },
        { header: 'Spis dziś', key: 'spisToday', width: columnWidths.spisToday },
        { header: 'Różnica dziś (rzecz./dysp.)', key: 'diffToday', width: columnWidths.diffToday },
        { header: 'Różnica -1', key: 'diffPrev1', width: columnWidths.diffPrev1 },
        { header: 'Różnica -2', key: 'diffPrev2', width: columnWidths.diffPrev2 },
        { header: 'Różnica -3', key: 'diffPrev3', width: columnWidths.diffPrev3 },
        { header: 'Różnica -4', key: 'diffPrev4', width: columnWidths.diffPrev4 },
        { header: 'Różnica -5', key: 'diffPrev5', width: columnWidths.diffPrev5 }
      ];

      worksheet.mergeCells('A1:J1');
      worksheet.mergeCells('A2:D2');
      worksheet.mergeCells('E2:G2');
      worksheet.mergeCells('H2:J2');
      worksheet.getCell('A1').value = 'Raport kontroli rozjazdów - spis oryginałów';
      worksheet.getCell('A2').value = `Dzień raportu: ${spisDate}`;
      worksheet.getCell('E2').value = currentErpSnapshotMeta
        ? `ERP wgrane: ${new Date(currentErpSnapshotMeta.importedAt).toLocaleString('pl-PL')}`
        : 'ERP wgrane: brak';
      worksheet.getCell('H2').value = `Wygenerowano: ${generatedAt}`;

      worksheet.getRow(1).height = 26;
      worksheet.getRow(2).height = 22;
      worksheet.getRow(4).values = [
        'Material',
        'Jedn.',
        'ERP dziś (rzecz./dysp.)',
        'Spis dziś',
        'Różnica dziś (rzecz./dysp.)',
        'Różnica -1',
        'Różnica -2',
        'Różnica -3',
        'Różnica -4',
        'Różnica -5'
      ];
      worksheet.autoFilter = 'A4:J4';

      const border = {
        top: { style: 'thin', color: { argb: '33FFFFFF' } },
        left: { style: 'thin', color: { argb: '22FFFFFF' } },
        bottom: { style: 'thin', color: { argb: '33FFFFFF' } },
        right: { style: 'thin', color: { argb: '22FFFFFF' } }
      } as const;

      const applyDarkCell = (cell: Cell, fillColor: string) => {
        cell.font = { color: { argb: 'FFFFFBF7' }, size: 11, name: 'Segoe UI' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      };

      const titleCell = worksheet.getCell('A1');
      titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFF8F1' }, name: 'Segoe UI Semibold' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF121212' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      ['A2', 'E2', 'H2'].forEach((cellRef) => {
        const cell = worksheet.getCell(cellRef);
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFC58A' }, name: 'Segoe UI Semibold' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
        cell.alignment = { vertical: 'middle' };
      });

      worksheet.getRow(4).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FF111111' }, size: 11, name: 'Segoe UI Semibold' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8C32' } };
        cell.border = border;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      reportRows.forEach((row, rowIndex) => {
        const excelRow = worksheet.addRow({
          name: row.name,
          unit: row.unit,
          erpToday: formatErpSnapshotPair(
            row.currentRealErpQty,
            row.currentAvailableErpQty,
            formatExcelQty
          ),
          spisToday: formatExcelQty(row.currentSpisQty),
          diffToday: formatDiffPair(
            row.currentRealDiffQty,
            row.currentAvailableDiffQty,
            formatExcelSignedQty
          ),
          diffPrev1: formatDiffHistoryPair(
            row.previousRealDiffs[0],
            row.previousAvailableDiffs[0],
            formatExcelDiffHistoryCell
          ),
          diffPrev2: formatDiffHistoryPair(
            row.previousRealDiffs[1],
            row.previousAvailableDiffs[1],
            formatExcelDiffHistoryCell
          ),
          diffPrev3: formatDiffHistoryPair(
            row.previousRealDiffs[2],
            row.previousAvailableDiffs[2],
            formatExcelDiffHistoryCell
          ),
          diffPrev4: formatDiffHistoryPair(
            row.previousRealDiffs[3],
            row.previousAvailableDiffs[3],
            formatExcelDiffHistoryCell
          ),
          diffPrev5: formatDiffHistoryPair(
            row.previousRealDiffs[4],
            row.previousAvailableDiffs[4],
            formatExcelDiffHistoryCell
          )
        });
        excelRow.height = 26;
        const baseFill = rowIndex % 2 === 0 ? 'FF111111' : 'FF1A1A1A';
        excelRow.eachCell((cell, columnNumber) => {
          applyDarkCell(cell, baseFill);
          if (columnNumber === 1) {
            cell.font = {
              color: { argb: 'FFFFC58A' },
              size: 11,
              bold: true,
              name: 'Segoe UI Semibold'
            };
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          }
          if ([3, 4].includes(columnNumber)) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
          if (columnNumber === 5) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
          if (columnNumber >= 6 && columnNumber <= 10) {
            cell.alignment = { wrapText: true, vertical: 'middle' };
            cell.font = { color: { argb: 'FFF7ED' }, size: 10, name: 'Segoe UI' };
          }
        });

        const diffTodayCell = excelRow.getCell(5);

        if (row.currentRealDiffQty !== null && Number.isFinite(row.currentRealDiffQty)) {
          diffTodayCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb:
                row.currentRealDiffQty === 0
                  ? 'FF173A2A'
                  : Math.abs(row.currentRealDiffQty) >= 10
                    ? 'FF7A2600'
                    : 'FF4E1B00'
            }
          };
          diffTodayCell.font = { color: { argb: 'FFFFF4EA' }, bold: true, name: 'Segoe UI Semibold' };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spis-oryginalow-raport-${spisDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Nie udalo sie wyeksportowac raportu XLSX.', tone: 'error' });
    }
  };

  void handleExportDailyLegacy;

  const handleExportDaily = async () => {
    if (!spisDate || reportRows.length === 0) return;
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const generatedAt = new Date().toLocaleString('pl-PL');
      const toExcelWrappedText = (value: string) => value.split(' | ').join('\n');
      const fitWidth = (
        values: string[],
        minWidth: number,
        maxWidth: number,
        multiplier = 1,
        padding = 2
      ) => {
        const longest = values.reduce((max, value) => {
          const lineMax = String(value)
            .split('\n')
            .reduce((innerMax, line) => Math.max(innerMax, line.length), 0);
          return Math.max(max, lineMax);
        }, 0);
        return Math.min(maxWidth, Math.max(minWidth, Math.ceil(longest * multiplier) + padding));
      };
      const getExcelColumnLetter = (index: number) => {
        let value = index;
        let result = '';
        while (value > 0) {
          const remainder = (value - 1) % 26;
          result = String.fromCharCode(65 + remainder) + result;
          value = Math.floor((value - 1) / 26);
        }
        return result;
      };
      const exportColumns = [
        {
          key: 'name',
          header: 'Material',
          wrap: true,
          align: 'left' as const,
          minWidth: 34,
          maxWidth: 80,
          multiplier: 1.12,
          padding: 4,
          getValue: (row: (typeof reportRows)[number]) => row.name
        },
        {
          key: 'unit',
          header: 'Jedn.',
          wrap: false,
          align: 'center' as const,
          minWidth: 8,
          maxWidth: 12,
          getValue: (row: (typeof reportRows)[number]) => row.unit
        },
        {
          key: 'erpToday',
          header: 'ERP dzis (rzecz./dysp.)',
          wrap: true,
          align: 'center' as const,
          minWidth: 16,
          maxWidth: 26,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatErpSnapshotPair(row.currentRealErpQty, row.currentAvailableErpQty, formatExcelQty)
            )
        },
        {
          key: 'spisToday',
          header: 'Spis dzis',
          wrap: false,
          align: 'center' as const,
          minWidth: 12,
          maxWidth: 18,
          getValue: (row: (typeof reportRows)[number]) => formatExcelQty(row.currentSpisQty)
        },
        {
          key: 'diffToday',
          header: 'Roznica dzis (rzecz./dysp.)',
          wrap: true,
          align: 'right' as const,
          minWidth: 16,
          maxWidth: 26,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatDiffPair(
                row.currentRealDiffQty,
                row.currentAvailableDiffQty,
                formatExcelSignedQty
              )
            )
        },
        {
          key: 'diffPrev1',
          header: 'Roznica -1',
          wrap: true,
          align: 'left' as const,
          minWidth: 18,
          maxWidth: 30,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatDiffHistoryPair(
                row.previousRealDiffs[0],
                row.previousAvailableDiffs[0],
                formatExcelDiffHistoryCell
              )
            )
        },
        {
          key: 'diffPrev2',
          header: 'Roznica -2',
          wrap: true,
          align: 'left' as const,
          minWidth: 18,
          maxWidth: 30,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatDiffHistoryPair(
                row.previousRealDiffs[1],
                row.previousAvailableDiffs[1],
                formatExcelDiffHistoryCell
              )
            )
        },
        {
          key: 'diffPrev3',
          header: 'Roznica -3',
          wrap: true,
          align: 'left' as const,
          minWidth: 18,
          maxWidth: 30,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatDiffHistoryPair(
                row.previousRealDiffs[2],
                row.previousAvailableDiffs[2],
                formatExcelDiffHistoryCell
              )
            )
        },
        {
          key: 'diffPrev4',
          header: 'Roznica -4',
          wrap: true,
          align: 'left' as const,
          minWidth: 18,
          maxWidth: 30,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatDiffHistoryPair(
                row.previousRealDiffs[3],
                row.previousAvailableDiffs[3],
                formatExcelDiffHistoryCell
              )
            )
        },
        {
          key: 'diffPrev5',
          header: 'Roznica -5',
          wrap: true,
          align: 'left' as const,
          minWidth: 18,
          maxWidth: 30,
          getValue: (row: (typeof reportRows)[number]) =>
            toExcelWrappedText(
              formatDiffHistoryPair(
                row.previousRealDiffs[4],
                row.previousAvailableDiffs[4],
                formatExcelDiffHistoryCell
              )
            )
        }
      ];
      const columnWidths = Object.fromEntries(
        exportColumns.map((column) => [
          column.key,
          fitWidth(
            [column.header, ...reportRows.map((row) => column.getValue(row))],
            column.minWidth,
            column.maxWidth,
            column.multiplier,
            column.padding
          )
        ])
      ) as Record<string, number>;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'APKA DLA KAMILA';
      workbook.created = new Date();

      const worksheet = workbook.addWorksheet('Raport', {
        views: [{ state: 'frozen', ySplit: 4 }]
      });

      worksheet.columns = exportColumns.map((column) => ({
        header: column.header,
        key: column.key,
        width: columnWidths[column.key]
      }));

      const lastColumnLetter = getExcelColumnLetter(exportColumns.length);
      worksheet.mergeCells(`A1:${lastColumnLetter}1`);
      worksheet.mergeCells(`A2:${lastColumnLetter}2`);
      worksheet.mergeCells(`A3:${lastColumnLetter}3`);
      worksheet.getCell('A1').value = 'Raport kontroli rozjazdow - spis oryginalow';
      worksheet.getCell('A2').value = currentErpSnapshotMeta
        ? `Dzien raportu: ${spisDate} | ERP wgrane: ${new Date(currentErpSnapshotMeta.importedAt).toLocaleString('pl-PL')}`
        : `Dzien raportu: ${spisDate} | ERP wgrane: brak`;
      worksheet.getCell('A3').value =
        `Wygenerowano: ${generatedAt} | Dane ERP: stan rzeczywisty, stan do dyspozycji | ` +
        'Kolumny XLSX: pelny raport';

      worksheet.getRow(1).height = 26;
      worksheet.getRow(2).height = 22;
      worksheet.getRow(3).height = 38;
      worksheet.getRow(4).values = exportColumns.map((column) => column.header);
      worksheet.autoFilter = `A4:${lastColumnLetter}4`;

      const border = {
        top: { style: 'thin', color: { argb: '33FFFFFF' } },
        left: { style: 'thin', color: { argb: '22FFFFFF' } },
        bottom: { style: 'thin', color: { argb: '33FFFFFF' } },
        right: { style: 'thin', color: { argb: '22FFFFFF' } }
      } as const;

      const applyDarkCell = (cell: Cell, fillColor: string) => {
        cell.font = { color: { argb: 'FFFFFBF7' }, size: 11, name: 'Segoe UI' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        cell.border = border;
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      };

      const titleCell = worksheet.getCell('A1');
      titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFF8F1' }, name: 'Segoe UI Semibold' };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF121212' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

      ['A2', 'A3'].forEach((cellRef) => {
        const cell = worksheet.getCell(cellRef);
        cell.font = { bold: true, size: 10, color: { argb: 'FFFFC58A' }, name: 'Segoe UI Semibold' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
        cell.alignment = { vertical: 'middle', wrapText: true };
      });

      worksheet.getRow(4).eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FF111111' }, size: 11, name: 'Segoe UI Semibold' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF8C32' } };
        cell.border = border;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      });

      reportRows.forEach((row, rowIndex) => {
        const excelRow = worksheet.addRow(
          exportColumns.reduce<Record<string, string>>((accumulator, column) => {
            accumulator[column.key] = column.getValue(row);
            return accumulator;
          }, {})
        );
        excelRow.height = exportColumns.some((column) => column.wrap) ? 42 : 26;
        const baseFill = rowIndex % 2 === 0 ? 'FF111111' : 'FF1A1A1A';
        excelRow.eachCell((cell, columnNumber) => {
          applyDarkCell(cell, baseFill);
          const column = exportColumns[columnNumber - 1];
          if (!column) return;
          if (column.key === 'name') {
            cell.font = {
              color: { argb: 'FFFFC58A' },
              size: 11,
              bold: true,
              name: 'Segoe UI Semibold'
            };
          }
          if (column.wrap) {
            cell.font = {
              color: { argb: column.key === 'name' ? 'FFFFC58A' : 'FFF7ED' },
              size: column.key === 'name' ? 11 : 10,
              bold: column.key === 'name',
              name: column.key === 'name' ? 'Segoe UI Semibold' : 'Segoe UI'
            };
          }
          cell.alignment = {
            horizontal: column.align,
            vertical: 'middle',
            wrapText: column.wrap
          };
        });

        const diffTodayColumnIndex = exportColumns.findIndex((column) => column.key === 'diffToday') + 1;
        const diffHighlightCandidates = [
          row.currentRealDiffQty,
          row.currentAvailableDiffQty
        ].filter((value): value is number => value !== null && Number.isFinite(value));
        const diffHighlightValue =
          diffHighlightCandidates.length === 0
            ? null
            : diffHighlightCandidates.reduce((currentMax, value) =>
                Math.abs(value) > Math.abs(currentMax) ? value : currentMax
              );

        if (diffTodayColumnIndex > 0 && diffHighlightValue !== null) {
          const diffTodayCell = excelRow.getCell(diffTodayColumnIndex);
          diffTodayCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
              argb:
                diffHighlightValue === 0
                  ? 'FF173A2A'
                  : Math.abs(diffHighlightValue) >= 10
                    ? 'FF7A2600'
                    : 'FF4E1B00'
            }
          };
          diffTodayCell.font = { color: { argb: 'FFFFF4EA' }, bold: true, name: 'Segoe UI Semibold' };
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spis-oryginalow-raport-${spisDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Nie udalo sie wyeksportowac raportu XLSX.', tone: 'error' });
    }
  };

  const materialGroupList = useMemo(() => {
    const list = [...materialGroups.values()].map((group) => {
      const total = group.entries.reduce((sum, entry) => sum + entry.qty, 0);
      const lastEntry = [...group.entries].sort((a, b) => b.at.localeCompare(a.at))[0];
      const hallIds = Array.from(new Set(group.entries.map((entry) => entry.warehouseId)));
      hallIds.sort((a, b) => {
        const orderA = warehouseOrderMap.get(a) ?? 0;
        const orderB = warehouseOrderMap.get(b) ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return (warehouseNameMap.get(a) ?? '').localeCompare(warehouseNameMap.get(b) ?? '');
      });
      const halls = hallIds
        .map((id) => warehouseNameMap.get(id))
        .filter(Boolean)
        .join(', ');
      return {
        key: group.key,
        name: group.name,
        unit: lastEntry?.unit ?? group.unit,
        total,
        erpRealQty: erpSnapshotMap.get(group.key)?.realQty ?? null,
        erpAvailableQty: erpSnapshotMap.get(group.key)?.availableQty ?? null,
        halls,
        lastUser: lastEntry?.user ?? '-'
      };
    });
    return list.sort((a, b) => collator.compare(a.name, b.name));
  }, [erpSnapshotMap, materialGroups, warehouseNameMap, warehouseOrderMap]);
  const selectedGroup = expandedMaterialKey ? materialGroups.get(expandedMaterialKey) ?? null : null;
  const selectedEntries = selectedGroup
    ? [...selectedGroup.entries].sort((a, b) => b.at.localeCompare(a.at))
    : [];
  const historyLine = selectedGroup
    ? [...selectedGroup.entries]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((entry) => {
          const warehouseLabel = warehouseNameMap.get(entry.warehouseId);
          return warehouseLabel ? `${entry.qty} (${warehouseLabel})` : String(entry.qty);
        })
        .join(' + ')
    : '';
  const reportVisibilitySuffix = getReportVisibilitySuffix(showReportRealQty, showReportAvailableQty);
  const reportValuesVisible = showReportRealQty || showReportAvailableQty;
  const reportColumns = [
    'Material',
    ...(reportValuesVisible ? [`ERP dzis${reportVisibilitySuffix}`] : []),
    'Spis dzis',
    ...(reportValuesVisible ? [`Roznica dzis${reportVisibilitySuffix}`] : []),
    ...(reportValuesVisible
      ? ['Roznica -1', 'Roznica -2', 'Roznica -3', 'Roznica -4', 'Roznica -5']
      : []),
    'Jedn.'
  ];
  const reportTableRows = reportRows.map((row) => [
    row.name,
    ...(reportValuesVisible
      ? [
          formatVisibleReportPair(
            showReportRealQty,
            showReportAvailableQty,
            row.currentRealErpQty,
            row.currentAvailableErpQty
          )
        ]
      : []),
    formatQty(row.currentSpisQty),
    ...(reportValuesVisible
      ? [
          formatVisibleReportPair(
            showReportRealQty,
            showReportAvailableQty,
            row.currentRealDiffQty,
            row.currentAvailableDiffQty,
            formatSignedQty
          ),
          formatVisibleReportHistoryPair(
            showReportRealQty,
            showReportAvailableQty,
            row.previousRealDiffs[0],
            row.previousAvailableDiffs[0]
          ),
          formatVisibleReportHistoryPair(
            showReportRealQty,
            showReportAvailableQty,
            row.previousRealDiffs[1],
            row.previousAvailableDiffs[1]
          ),
          formatVisibleReportHistoryPair(
            showReportRealQty,
            showReportAvailableQty,
            row.previousRealDiffs[2],
            row.previousAvailableDiffs[2]
          ),
          formatVisibleReportHistoryPair(
            showReportRealQty,
            showReportAvailableQty,
            row.previousRealDiffs[3],
            row.previousAvailableDiffs[3]
          ),
          formatVisibleReportHistoryPair(
            showReportRealQty,
            showReportAvailableQty,
            row.previousRealDiffs[4],
            row.previousAvailableDiffs[4]
          )
        ]
      : []),
    row.unit
  ]);
  const dailyComparisonColumns = [
    'Material',
    ...(reportValuesVisible ? [`ERP${reportVisibilitySuffix}`] : []),
    'Spis',
    ...(reportValuesVisible ? [`Roznica${reportVisibilitySuffix}`] : []),
    'Jedn.'
  ];
  const dailyComparisonRows = dailyComparison.map((row) => [
    row.name,
    ...(reportValuesVisible
      ? [
          formatVisibleReportPair(
            showReportRealQty,
            showReportAvailableQty,
            row.realErpQty,
            row.availableErpQty
          )
        ]
      : []),
    formatQty(row.spisQty),
    ...(reportValuesVisible
      ? [
          formatVisibleReportPair(
            showReportRealQty,
            showReportAvailableQty,
            row.realDiffQty,
            row.availableDiffQty,
            formatSignedQty
          )
        ]
      : []),
    row.unit
  ]);


  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger
            value="spis"
            className="data-[state=active]:bg-[var(--brand)] data-[state=active]:text-bg"
          >
            SPIS
          </TabsTrigger>
          <TabsTrigger
            value="kartoteki"
            className="data-[state=active]:bg-[#ff6a00] data-[state=active]:text-bg"
          >
            KARTOTEKI
          </TabsTrigger>
          <TabsTrigger
            value="stany-erp"
            className="data-[state=active]:bg-[#c49102] data-[state=active]:text-bg"
          >
            STANY ERP
          </TabsTrigger>
          <TabsTrigger
            value="raporty"
            className="data-[state=active]:bg-[var(--value-purple)] data-[state=active]:text-bg"
          >
            RAPORTY
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spis" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Spis oryginalow</p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Dzien spisu</label>
                <Input
                  type="date"
                  value={spisDate}
                  onChange={(event) => setSpisDate(event.target.value)}
                  className="min-h-[46px]"
                />
              </div>
              <p className="text-xs text-dim">Spis i raport dzienny liczone dla wybranego dnia (00:00-24:00).</p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                handleAdd();
              }}
              className="grid gap-3 md:grid-cols-2 lg:grid-cols-6"
            >
              <div className="lg:col-span-2">
                <label className="text-xs uppercase tracking-wide text-dim">Hala</label>
                <SelectField
                  value={effectiveSelectedWarehouseId}
                  onChange={(event) => setSelectedWarehouseId(event.target.value)}
                  disabled={warehouses.length === 0}
                >
                  {!effectiveSelectedWarehouseId && <option value="">Wybierz hale</option>}
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="lg:col-span-2">
                <label className="text-xs uppercase tracking-wide text-dim">
                  Wyszukiwarka / nazwa
                </label>
                <div className="relative">
                  <Input
                    value={form.name}
                    onChange={(event) => {
                      applyNameToForm(event.target.value);
                      setShowNameSuggestions(true);
                    }}
                    placeholder="np. BOREALIS HF700SA"
                    className={form.name ? 'min-h-[46px] pr-10' : 'min-h-[46px]'}
                    onFocus={() => setShowNameSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowNameSuggestions(false), 120);
                    }}
                  />
                  {form.name && (
                    <button
                      type="button"
                      aria-label="Wyczysc nazwe"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface2 px-2 py-1 text-xs font-semibold text-dim transition hover:border-borderStrong hover:text-title"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, name: '' }));
                        setShowNameSuggestions(false);
                      }}
                    >
                      X
                    </button>
                  )}

                  {showNameSuggestions && filteredNameSuggestions.length > 0 && (
                    <div className="absolute z-20 mt-2 w-full rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                      {filteredNameSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyNameToForm(name);
                            setShowNameSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {matchedExisting && (
                  <p className="mt-1 text-xs text-dim">
                    Aktualnie spisane: {matchedExisting.total} {matchedExisting.unit}
                  </p>
                )}
                {matchedErpSnapshot && (
                  <p className="mt-1 text-xs text-dim">
                    ERP na dzien {spisDate}: stan rzeczywisty {formatQty(matchedErpSnapshot.realQty)}{' '}
                    {matchedErpSnapshot.unit}, stan do dyspozycji{' '}
                    {formatQty(matchedErpSnapshot.availableQty)} {matchedErpSnapshot.unit}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Ilosc</label>
                <Input
                  value={form.qty}
                  onChange={(event) => setForm((prev) => ({ ...prev, qty: event.target.value }))}
                  placeholder="0"
                  inputMode="decimal"
                  className="min-h-[46px]"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Jednostka</label>
                <Input
                  value={form.unit}
                  onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))}
                  placeholder="kg"
                  className="min-h-[46px]"
                />
              </div>
              <div className="flex items-end justify-end lg:col-span-6">
                <Button
                  variant="secondary"
                  type="submit"
                  disabled={addMutation.isPending}
                  className="w-full"
                >
                  {matchedExisting ? 'Dodaj ilosc' : 'Dodaj wpis'}
                </Button>
              </div>
            </form>
          </Card>

          {isLoading ? (
            <p className="text-sm text-dim">Wczytywanie...</p>
          ) : (
            <Card>
              <DataTable
                columns={['Nazwa', 'Suma', 'ERP rzecz.', 'ERP dysp.', 'Jedn.', 'Hale', 'Kto']}
                rows={materialGroupList.map((group) => {
                  const isActive = expandedMaterialKey === group.key;
                  return [
                    <span
                      key={`${group.key}-name`}
                      className={`text-sm font-semibold transition ${
                        isActive ? 'text-brand' : 'text-title'
                      }`}
                    >
                      {group.name}
                    </span>,
                    group.total,
                    group.erpRealQty ?? '-',
                    group.erpAvailableQty ?? '-',
                    group.unit,
                    group.halls || '-',
                    group.lastUser
                  ];
                })}
                onRowClick={(rowIndex) => {
                  const group = materialGroupList[rowIndex];
                  if (!group) return;
                  const nextKey = expandedMaterialKey === group.key ? null : group.key;
                  setExpandedMaterialKey(nextKey);
                  if (nextKey) {
                    setQuickQty('');
                    setQuickWarehouseId(effectiveSelectedWarehouseId || warehouses[0]?.id || '');
                  }
                }}
                renderRowDetails={(rowIndex) => {
                  const group = materialGroupList[rowIndex];
                  if (!group || expandedMaterialKey !== group.key || !selectedGroup) {
                    return null;
                  }
                  return (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                            Wybrany material
                          </p>
                          <p className="text-lg font-semibold text-title">{selectedGroup.name}</p>
                          <p className="text-xs text-dim">
                            ERP na dzien {spisDate}: stan rzeczywisty{' '}
                            {formatQty(erpSnapshotMap.get(selectedGroup.key)?.realQty ?? 0)}{' '}
                            {erpSnapshotMap.get(selectedGroup.key)?.unit ?? selectedGroup.unit}, stan do
                            dyspozycji{' '}
                            {formatQty(erpSnapshotMap.get(selectedGroup.key)?.availableQty ?? 0)}{' '}
                            {erpSnapshotMap.get(selectedGroup.key)?.unit ?? selectedGroup.unit}
                          </p>
                          {historyLine && (
                            <p className="text-xs text-dim">Historia: {historyLine}</p>
                          )}
                        </div>
                        <Button variant="outline" onClick={() => setExpandedMaterialKey(null)}>
                          Zamknij
                        </Button>
                      </div>

                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleQuickAdd();
                        }}
                        className="grid gap-3 md:grid-cols-3"
                      >
                        <div>
                          <label className="text-xs uppercase tracking-wide text-dim">
                            Dopisz ilosc
                          </label>
                          <Input
                            value={quickQty}
                            onChange={(event) => setQuickQty(event.target.value)}
                            placeholder="0"
                            inputMode="decimal"
                            className="min-h-[46px]"
                          />
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-wide text-dim">Hala</label>
                          <SelectField
                            value={quickWarehouseId || effectiveSelectedWarehouseId}
                            onChange={(event) => setQuickWarehouseId(event.target.value)}
                            disabled={warehouses.length === 0}
                          >
                            {!quickWarehouseId && !effectiveSelectedWarehouseId && (
                              <option value="">Wybierz hale</option>
                            )}
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </SelectField>
                        </div>
                        <div className="flex items-end justify-end">
                          <Button
                            type="submit"
                            disabled={addMutation.isPending}
                            className="w-full"
                          >
                            Dodaj ilosc
                          </Button>
                        </div>
                      </form>

                      <DataTable
                        columns={['Data', 'Ilosc', 'Jedn.', 'Hala', 'Kto', 'Akcje']}
                        rows={selectedEntries.map((entry) => {
                          const draft = editDrafts[entry.id] ?? {
                            qty: String(entry.qty),
                            warehouseId: entry.warehouseId
                          };
                          return [
                            new Date(entry.at).toLocaleString('pl-PL'),
                            <Input
                              key={`${entry.id}-qty`}
                              value={draft.qty}
                              onChange={(event) =>
                                updateEditDraft(entry.id, { qty: event.target.value })
                              }
                              inputMode="decimal"
                              className="min-h-[40px] w-28"
                            />,
                            entry.unit,
                            <SelectField
                              key={`${entry.id}-warehouse`}
                              value={draft.warehouseId}
                              onChange={(event) =>
                                updateEditDraft(entry.id, { warehouseId: event.target.value })
                              }
                            >
                              {warehouses.map((warehouse) => (
                                <option key={warehouse.id} value={warehouse.id}>
                                  {warehouse.name}
                                </option>
                              ))}
                            </SelectField>,
                            entry.user,
                            <div key={`${entry.id}-actions`} className="flex items-center gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => handleEditSave(entry.id)}
                                disabled={updateMutation.isPending}
                              >
                                Zapisz
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => handleRemoveEntry(entry.id, entry.name)}
                                disabled={removeEntryMutation.isPending}
                                className="h-8 w-8 border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                              >
                                X
                              </Button>
                            </div>
                          ];
                        })}
                      />
                    </div>
                  );
                }}
              />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="kartoteki" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Integracja ERP</p>
            <p className="text-sm text-dim">
              Kartoteki sa pobierane z ERP, ale mozesz tez recznie dograc brakujace pozycje
              z pliku CSV/XLS/XLSX.
            </p>
            {erpSourceUnavailable && (
              <p className="text-xs text-dim">
                Zrodlo ERP nie jest skonfigurowane. Import lokalny i lista recznie wgranych
                kartotek nadal dzialaja.
              </p>
            )}
            {readOnly && (
              <p className="text-xs text-danger">
                To konto ma tylko podglad. Import kartotek wymaga zapisu w module
                `spis-oryginalow`.
              </p>
            )}
            {catalogErrorCode && (
              <p className="text-xs text-danger">
                Blad zrodla ERP: {catalogErrorCode}
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-dim">
                  Import kartotek (kolumna A: nazwa, kolumna B: jednostka - opcjonalnie)
                </label>
                <Input
                  key={catalogImportInputKey}
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  onChange={async (event) => {
                    const file = event.target.files?.[0] ?? null;
                    await handleCatalogFileChange(file);
                  }}
                  disabled={readOnly || catalogImportPreparing || importCatalogMutation.isPending}
                />
                {catalogImportFileName && (
                  <p className="text-xs text-dim">Wybrany plik: {catalogImportFileName}</p>
                )}
                {catalogImportPreparing && (
                  <p className="text-xs text-dim">Analiza pliku...</p>
                )}
                {catalogImportSummary && (
                  <p className="text-xs text-dim">
                    W pliku: {catalogImportSummary.parsed}. Do importu: {catalogImportSummary.toImport}.
                    Pominiete jako istniejace: {catalogImportSummary.skipped}.
                  </p>
                )}
                {importCatalogMutation.isPending && (
                  <p className="text-xs text-dim">Wgrywanie pliku...</p>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={handleCatalogImport}
                disabled={
                  readOnly ||
                  catalogImportPreparing ||
                  catalogImportItems.length === 0 ||
                  importCatalogMutation.isPending
                }
              >
                {importCatalogMutation.isPending ? 'Wgrywanie...' : 'Wgraj kartoteki'}
              </Button>
            </div>
            <div className="rounded-xl border border-[rgba(255,122,26,0.35)] bg-[rgba(255,122,26,0.08)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Pole dla kolejnego programisty
              </p>
              <p className="mt-2 whitespace-pre-line font-mono text-xs text-body">
                {ERP_ORIGINALS_INTEGRATION_PLACEHOLDER}
              </p>
            </div>
          </Card>

          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Kartoteki (ERP + recznie wgrane)
            </p>
            <Input
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder="Szukaj po nazwie"
            />
            <DataTable
              columns={['Nazwa', 'Jedn.', 'Utworzono']}
              rows={filteredCatalog.map((item) => [
                item.name,
                item.unit,
                new Date(item.createdAt).toLocaleString('pl-PL')
              ])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="stany-erp" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Stany ERP</p>
            <p className="text-sm text-dim">
              Wgraj dzienny snapshot stanow z ERP. Snapshot jest jeden na wybrany dzien i nadpisuje
              poprzedni import z tego samego dnia.
            </p>
            {erpSnapshotMigrationRequired && (
              <p className="text-xs text-danger">
                Brakuje migracji bazy dla stanow ERP. Uruchom SQL z `supabase/setup_full.sql`.
              </p>
            )}
            {readOnly && (
              <p className="text-xs text-danger">
                To konto ma tylko podglad. Import stanow ERP wymaga zapisu w module
                `spis-oryginalow`.
              </p>
            )}
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-end">
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Dzien snapshotu</label>
                <Input
                  type="date"
                  value={spisDate}
                  onChange={(event) => setSpisDate(event.target.value)}
                  className="min-h-[46px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-dim">
                  Import stanow ERP (kolumna A: nazwa, kolumna B: stan do dyspozycji ERP, kolumna C:
                  stan rzeczywisty ERP, kolumna D: jednostka - opcjonalnie; PDF: nazwa + stan
                  rzeczywisty + stan do dyspozycji)
                </label>
                <Input
                  key={erpSnapshotImportInputKey}
                  type="file"
                  accept=".csv,.xls,.xlsx,.pdf"
                  onChange={async (event) => {
                    const file = event.target.files?.[0] ?? null;
                    await handleErpSnapshotFileChange(file);
                  }}
                  disabled={
                    readOnly ||
                    erpSnapshotMigrationRequired ||
                    erpSnapshotImportPreparing ||
                    importErpSnapshotMutation.isPending
                  }
                />
                {erpSnapshotImportFileName && (
                  <p className="text-xs text-dim">Wybrany plik: {erpSnapshotImportFileName}</p>
                )}
                {erpSnapshotImportPreparing && (
                  <p className="text-xs text-dim">Analiza pliku stanow ERP...</p>
                )}
                {erpSnapshotImportSummary && (
                  <p className="text-xs text-dim">
                    W pliku: {erpSnapshotImportSummary.parsed}. Aktualnie zapisane dla dnia {spisDate}:{' '}
                    {erpSnapshotImportSummary.currentRows}.
                  </p>
                )}
                {importErpSnapshotMutation.isPending && (
                  <p className="text-xs text-dim">Wgrywanie snapshotu ERP...</p>
                )}
              </div>
              <div className="flex items-end gap-3">
                <Button
                  variant="secondary"
                  onClick={handleErpSnapshotImport}
                  disabled={
                    readOnly ||
                    erpSnapshotMigrationRequired ||
                    erpSnapshotImportPreparing ||
                    !erpSnapshotImportFile ||
                    importErpSnapshotMutation.isPending
                  }
                >
                  {importErpSnapshotMutation.isPending ? 'Wgrywanie...' : 'Wgraj stany ERP'}
                </Button>
                <Button
                  variant="outline"
                  onClick={resetErpSnapshotImportState}
                  disabled={
                    readOnly ||
                    !erpSnapshotImportFile ||
                    erpSnapshotImportPreparing ||
                    importErpSnapshotMutation.isPending
                  }
                >
                  Usun wybrany plik
                </Button>
                <Button
                  variant="outline"
                  onClick={() => removeErpSnapshotMutation.mutate(spisDate)}
                  disabled={
                    readOnly ||
                    erpSnapshotMigrationRequired ||
                    erpSnapshotEntries.length === 0 ||
                    removeErpSnapshotMutation.isPending
                  }
                >
                  Usun wgrany plik i stany dnia
                </Button>
              </div>
            </div>
            {currentErpSnapshotMeta && (
              <div className="rounded-xl border border-border bg-surface2 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Aktualnie wgrany snapshot dnia
                </p>
                <p className="mt-2 text-sm text-body">
                  Plik: {currentErpSnapshotMeta.sourceFileName ?? 'brak nazwy pliku'}
                </p>
                <p className="text-xs text-dim">
                  Wgrano: {new Date(currentErpSnapshotMeta.importedAt).toLocaleString('pl-PL')} przez{' '}
                  {currentErpSnapshotMeta.importedBy}
                </p>
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Snapshot ERP dla dnia {spisDate}
              </p>
              <span className="text-xs text-dim">{erpSnapshotSummary.length} poz.</span>
            </div>
            {erpSnapshotSummary.length === 0 ? (
              <p className="text-sm text-dim">Brak wgranych stanow ERP dla wybranego dnia.</p>
            ) : (
              <DataTable
                columns={['Nazwa', 'Stan rzeczywisty ERP', 'Stan do dyspozycji ERP', 'Jedn.']}
                rows={erpSnapshotSummary.map((row) => [
                  row.name,
                  row.realQty,
                  row.availableQty,
                  row.unit
                ])}
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="raporty" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Historia kartoteki
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-wide text-dim">Wyszukiwarka kartotek</label>
                <div className="relative">
                  <Input
                    value={reportQuery}
                    onChange={(event) => {
                      setReportQuery(event.target.value);
                      setShowReportSuggestions(true);
                    }}
                    placeholder="np. TATREN 5046"
                    className={reportQuery ? 'min-h-[46px] pr-10' : 'min-h-[46px]'}
                    onFocus={() => setShowReportSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowReportSuggestions(false), 120);
                    }}
                  />
                  {reportQuery && (
                    <button
                      type="button"
                      aria-label="Wyczysc wyszukiwanie"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface2 px-2 py-1 text-xs font-semibold text-dim transition hover:border-borderStrong hover:text-title"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setReportQuery('');
                        setShowReportSuggestions(false);
                      }}
                    >
                      X
                    </button>
                  )}

                  {showReportSuggestions && reportSuggestions.length > 0 && (
                    <div className="absolute z-20 mt-2 w-full rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                      {reportSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setReportQuery(name);
                            setShowReportSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {selectedReportMaterialKey && (
              <DataTable
                columns={['Kiedy', 'Ilosc', 'Jedn.', 'Hala', 'Kto']}
                rows={reportEntries.map((entry) => [
                  new Date(entry.at).toLocaleString('pl-PL'),
                  entry.qty,
                  entry.unit,
                  warehouseNameMap.get(entry.warehouseId) ?? '-',
                  entry.user
                ])}
              />
            )}
          </Card>
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Raport kontroli rozjazdów
            </p>
            <p className="text-sm text-dim">
              Raport obejmuje tylko pozycje spisane w wybranym dniu i pokazuje rozjazd na tle
              5 poprzednich różnic tej samej pozycji.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Toggle
                checked={showReportRealQty}
                onCheckedChange={setShowReportRealQty}
                label="Pokaz stan rzeczywisty"
              />
              <Toggle
                checked={showReportAvailableQty}
                onCheckedChange={setShowReportAvailableQty}
                label="Pokaz stan do dyspozycji"
              />
            </div>
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Dzień</label>
                <Input
                  type="date"
                  value={spisDate}
                  onChange={(event) => setSpisDate(event.target.value)}
                  className="min-h-[46px]"
                />
              </div>
              <div className="md:col-span-2 flex items-end justify-end">
                <Button
                  variant="secondary"
                  onClick={handleExportDaily}
                  disabled={reportRows.length === 0}
                >
                  Eksportuj do Excel (XLSX)
                </Button>
              </div>
            </div>
            {reportErpSnapshotMigrationRequired ? (
              <p className="text-sm text-dim">
                Brakuje migracji bazy dla stanów ERP. Uruchom SQL z `supabase/setup_full.sql`.
              </p>
            ) : reportRows.length === 0 ? (
              <p className="text-sm text-dim">Brak wpisów dla wybranego dnia.</p>
            ) : (
              <>
                {false && (
                  <DataTable
                columns={[
                  'Material',
                  'ERP dziś (rzecz./dysp.)',
                  'Spis dziś',
                  'Różnica dziś (rzecz./dysp.)',
                  'Różnica -1',
                  'Różnica -2',
                  'Różnica -3',
                  'Różnica -4',
                  'Różnica -5',
                  'Jedn.'
                ]}
                rows={reportRows.map((row) => [
                  row.name,
                  formatErpSnapshotPair(row.currentRealErpQty, row.currentAvailableErpQty),
                  formatQty(row.currentSpisQty),
                  formatDiffPair(row.currentRealDiffQty, row.currentAvailableDiffQty),
                  formatDiffHistoryPair(row.previousRealDiffs[0], row.previousAvailableDiffs[0]),
                  formatDiffHistoryPair(row.previousRealDiffs[1], row.previousAvailableDiffs[1]),
                  formatDiffHistoryPair(row.previousRealDiffs[2], row.previousAvailableDiffs[2]),
                  formatDiffHistoryPair(row.previousRealDiffs[3], row.previousAvailableDiffs[3]),
                  formatDiffHistoryPair(row.previousRealDiffs[4], row.previousAvailableDiffs[4]),
                  row.unit
                ])}
                  />
                )}
                <DataTable columns={reportColumns} rows={reportTableRows} />
              </>
            )}
          </Card>
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Porównanie bieżące ERP vs Spis
            </p>
            {reportErpSnapshotMigrationRequired ? (
              <p className="text-sm text-dim">
                Brakuje migracji bazy dla stanów ERP. Uruchom SQL z `supabase/setup_full.sql`.
              </p>
            ) : dailyComparison.length === 0 ? (
              <p className="text-sm text-dim">Brak danych ERP i spisu dla wybranego dnia.</p>
            ) : (
              <>
                <DataTable columns={dailyComparisonColumns} rows={dailyComparisonRows} />
                {false && (
                  <DataTable
                columns={['Material', 'ERP (rzecz./dysp.)', 'Spis', 'Różnica (rzecz./dysp.)', 'Jedn.']}
                rows={dailyComparison.map((row) => [
                  row.name,
                  formatErpSnapshotPair(row.realErpQty, row.availableErpQty),
                  formatQty(row.spisQty),
                  formatDiffPair(row.realDiffQty, row.availableDiffQty),
                  row.unit
                ])}
                  />
                )}
              </>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
