'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Cell } from 'exceljs';
import {
  addOriginalInventoryGrindTask,
  completeOriginalInventoryGrindTasks,
  addOriginalInventory,
  getCatalog,
  getOriginalInventory,
  getOriginalInventoryCatalog,
  getOriginalInventoryCatalogFromErp,
  getOriginalInventoryErpSnapshot,
  getOriginalInventoryErpSnapshotsByDates,
  getOriginalInventoryGrindTasks,
  getOriginalInventorySiloEntries,
  getOriginalInventorySilosConfig,
  importOriginalInventoryCatalogFile,
  importOriginalInventoryErpSnapshotFile,
  getWarehouses,
  removeOriginalInventoryErpSnapshot,
  removeOriginalInventory,
  reopenOriginalInventoryGrindTasks,
  saveOriginalInventorySiloEntry,
  updateOriginalInventory
} from '@/lib/api';
import type { OriginalInventoryErpSnapshotEntry } from '@/lib/api/types';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { SelectField } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { parseQtyInput } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import {
  BarChart3,
  ClipboardList,
  Database,
  Factory,
  FileSpreadsheet,
  Maximize2,
  Minimize2,
  Search
} from 'lucide-react';
import {
  normalizeOriginalInventoryCatalogIdentityKey,
  parseOriginalInventoryCatalogRows
} from '@/lib/utils/originalInventoryCatalog';
import {
  normalizeOriginalInventoryName
} from '@/lib/utils/originalInventoryName';
import {
  isOriginalInventoryErpSnapshotPdfFile,
  parseOriginalInventoryErpSnapshotPdfFile
} from '@/lib/utils/originalInventoryErpPdf';

const WAREHOUSE_STORAGE_KEY = 'spis-oryginalow-warehouse';
const WAREHOUSE_NAME_STORAGE_KEY = 'spis-oryginalow-warehouse-name';
const WAREHOUSE_QUERY_PARAM = 'hala';
const TAB_STORAGE_KEY = 'spis-oryginalow-tab';
const SILOS_SELECT_VALUE = '__silos__';
const normalizeWarehouseOptionName = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase();
const isOriginalInventoryWarehouseVisible = (name: string) => {
  const normalized = normalizeWarehouseOptionName(name);
  return !normalized.includes('mlynem pp') && !normalized.includes('mlyn pp');
};
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const exportCatalogCollator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });
const dailyReportExcludePatterns = [/^ABS\s*30\//i];
const REPORT_HISTORY_DAYS_SHORT = 4;
const REPORT_HISTORY_DAYS_TWO_MONTHS = 60;
const CATALOG_TABLE_INITIAL_LIMIT = 150;
const CATALOG_TABLE_INCREMENT = 150;
const ERP_ORIGINALS_PROXY_NOT_CONFIGURED = 'ERP_ORIGINALS_PROXY_NOT_CONFIGURED';
const ERP_SNAPSHOT_MIGRATION_REQUIRED = 'MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS';
const originalInventoryTabTileClassName =
  'original-inventory-tab group flex min-h-[54px] w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold leading-none transition duration-200 hover:-translate-y-px hover:text-title focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]';
const originalInventoryTabIconClassName = 'h-[18px] w-[18px] shrink-0 opacity-90 transition group-hover:opacity-100';
const ERP_ORIGINALS_INTEGRATION_PLACEHOLDER =
  [
    'Source: ERP proxy API (aktywny)',
    'Action: getOriginalInventoryCatalogFromErp',
    'ENV: ERP_ORIGINALS_PROXY_URL',
    'ENV: ERP_ORIGINALS_PROXY_TOKEN (opcjonalny)',
    'ENV: ERP_ORIGINALS_PROXY_TIMEOUT_MS (opcjonalny, domyslnie 10000 ms)',
    'Response: [] lub { items: [] }, pola: id/name/unit/createdAt/indexCode?/warehouseCode?'
  ].join('\n');

const isErpOriginalsSourceError = (error: unknown) =>
  error instanceof Error && error.message === ERP_ORIGINALS_PROXY_NOT_CONFIGURED;

const isErpSnapshotMigrationError = (error: unknown) =>
  error instanceof Error && error.message === ERP_SNAPSHOT_MIGRATION_REQUIRED;

const getSiloConfigIdFromSourceId = (sourceId?: string | null) => {
  const match = /^silo:([^:]+):/.exec(sourceId ?? '');
  return match?.[1] ?? null;
};

type OriginalInventoryTab = 'spis' | 'kartoteki' | 'stany-erp' | 'raporty' | 'do-zmielenia';

const getInitialTabValue = (): OriginalInventoryTab => {
  if (typeof window === 'undefined') return 'spis';
  const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
  if (
    saved === 'spis' ||
    saved === 'kartoteki' ||
    saved === 'stany-erp' ||
    saved === 'raporty' ||
    saved === 'do-zmielenia'
  ) {
    return saved;
  }
  return 'spis';
};

const getInitialWarehouseValue = () => {
  if (typeof window === 'undefined') return '';
  const warehouseIdFromUrl = new URL(window.location.href).searchParams.get(
    WAREHOUSE_QUERY_PARAM
  );
  if (warehouseIdFromUrl) return warehouseIdFromUrl;
  return window.localStorage.getItem(WAREHOUSE_STORAGE_KEY) ?? '';
};

const getInitialWarehouseName = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(WAREHOUSE_NAME_STORAGE_KEY) ?? '';
};

const persistWarehouseValue = (warehouseId: string, warehouseName = '') => {
  if (typeof window === 'undefined' || !warehouseId) return;
  window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, warehouseId);
  if (warehouseName) {
    window.localStorage.setItem(WAREHOUSE_NAME_STORAGE_KEY, warehouseName);
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get(WAREHOUSE_QUERY_PARAM) === warehouseId) return;
  url.searchParams.set(WAREHOUSE_QUERY_PARAM, warehouseId);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`
  );
};

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getPreviousDateKeys = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (!year || !month || !day) return [];
  const baseDate = new Date(year, month - 1, day);
  if (Number.isNaN(baseDate.getTime())) return [];

  return Array.from({ length: days }, (_, index) => {
    const value = new Date(baseDate);
    value.setDate(baseDate.getDate() - index - 1);
    return getLocalDateValue(value);
  });
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
  if (point.diffQty === null) return 'brak danych';
  return formatSignedQty(point.diffQty);
};

const formatExcelDiffHistoryCell = (point?: { dateKey: string; diffQty: number | null } | null) => {
  if (!point) return 'brak danych';
  if (point.diffQty === null) return 'brak danych';
  return formatExcelSignedQty(point.diffQty);
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

const normalizeImportCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCatalogNameKey = (value: unknown) =>
  normalizeOriginalInventoryName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const tokenizeCatalogSearch = (value: unknown) =>
  normalizeCatalogNameKey(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);

const matchesCatalogSearch = (
  query: unknown,
  name: unknown,
  indexCode?: unknown,
  warehouseCode?: unknown
) => {
  const normalizedQuery = normalizeCatalogNameKey(query);
  if (!normalizedQuery) return true;

  const normalizedName = normalizeCatalogNameKey(name);
  const normalizedIndex = String(indexCode ?? '')
    .trim()
    .toLowerCase();
  const normalizedWarehouse = String(warehouseCode ?? '')
    .trim()
    .toLowerCase();

  if (
    normalizedName.includes(normalizedQuery) ||
    normalizedIndex.includes(normalizedQuery) ||
    normalizedWarehouse.includes(normalizedQuery)
  ) {
    return true;
  }

  const haystackTokens = [
    ...tokenizeCatalogSearch(name),
    ...normalizedIndex.split(/[^a-z0-9]+/).filter(Boolean),
    ...normalizedWarehouse.split(/[^a-z0-9]+/).filter(Boolean)
  ];
  const queryTokens = tokenizeCatalogSearch(query);
  if (queryTokens.length === 0) return false;

  return queryTokens.every((queryToken) =>
    haystackTokens.some((haystackToken) => haystackToken.includes(queryToken))
  );
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
    const name = normalizeOriginalInventoryName(row?.[0]);
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

const parseCatalogImportFile = async (
  file: File
): Promise<Array<{ name: string; unit: string; indexCode: string | null; warehouseCode: string | null }>> => {
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
  return parseOriginalInventoryCatalogRows(rows);
};

export default function SpisRzeczywisty() {
  const toast = useToastStore((state) => state.push);
  const { user } = useUiStore();
  const readOnly = canSeeTab(
    user,
    'PLANOWANIE_ZAPOTRZEBOWANIA',
    'planowanie-zapotrzebowania'
  )
    ? isReadOnly(user, 'PLANOWANIE_ZAPOTRZEBOWANIA')
    : isReadOnly(user, 'PRZEMIALY');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<OriginalInventoryTab>(() => getInitialTabValue());
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [selectedWarehouseName, setSelectedWarehouseName] = useState('');
  const [warehouseSelectionRestored, setWarehouseSelectionRestored] = useState(false);
  const [expandedMaterialKey, setExpandedMaterialKey] = useState<string | null>(null);
  const [quickQty, setQuickQty] = useState('');
  const [quickWarehouseId, setQuickWarehouseId] = useState('');
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { qty: string; warehouseId: string }>
  >({});
  const [siloDrafts, setSiloDrafts] = useState<
    Record<string, { percent: string; hopperPresent: boolean }>
  >({});
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const [reportQuery, setReportQuery] = useState('');
  const [showReportSuggestions, setShowReportSuggestions] = useState(false);
  const [reportQuantityMode, setReportQuantityMode] = useState<'real' | 'available'>('real');
  const [showReportUncountedItems, setShowReportUncountedItems] = useState(false);
  const reportFullscreenRef = useRef<HTMLDivElement | null>(null);
  const [isReportFullscreen, setIsReportFullscreen] = useState(false);
  const [isReportFullscreenFallback, setIsReportFullscreenFallback] = useState(false);
  const [grindDialogMaterial, setGrindDialogMaterial] = useState<{
    name: string;
    unit: string;
    availableQty: number | null;
  } | null>(null);
  const [grindQty, setGrindQty] = useState('');
  const [grindTargetMaterial, setGrindTargetMaterial] = useState('');
  const [showGrindTargetSuggestions, setShowGrindTargetSuggestions] = useState(false);
  const [spisDate, setSpisDate] = useState(getLocalDateValue());
  const [catalogSearch, setCatalogSearch] = useState('');
  const deferredCatalogSearch = useDeferredValue(catalogSearch);
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_TABLE_INITIAL_LIMIT);
  const [catalogImportFile, setCatalogImportFile] = useState<File | null>(null);
  const [catalogImportInputKey, setCatalogImportInputKey] = useState(0);
  const [catalogImportFileName, setCatalogImportFileName] = useState('');
  const [catalogImportItems, setCatalogImportItems] = useState<
    Array<{ name: string; unit: string; indexCode: string | null; warehouseCode: string | null }>
  >(
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
    parsed: number | null;
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
  const visibleWarehouses = useMemo(
    () => warehouses.filter((warehouse) => isOriginalInventoryWarehouseVisible(warehouse.name)),
    [warehouses]
  );
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
  const { data: siloConfigs = [] } = useQuery({
    queryKey: ['original-inventory-silos-config'],
    queryFn: getOriginalInventorySilosConfig
  });
  const { data: siloEntries = [] } = useQuery({
    queryKey: ['original-inventory-silo-entries', spisDate],
    queryFn: () => getOriginalInventorySiloEntries(spisDate),
    enabled: Boolean(spisDate)
  });
  const { data: grindTasks = [] } = useQuery({
    queryKey: ['original-inventory-grind-tasks'],
    queryFn: getOriginalInventoryGrindTasks
  });
  const { data: grindTargetSourceMaterials = [] } = useQuery({
    queryKey: ['catalog'],
    queryFn: getCatalog
  });
  const erpCatalogItems = useMemo(
    () => (Array.isArray(erpCatalogState?.items) ? erpCatalogState.items : []),
    [erpCatalogState]
  );
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
    const localCatalogItems = Array.isArray(localCatalog) ? localCatalog : [];
    erpCatalogItems.forEach((item) => {
      merged.set(normalizeOriginalInventoryCatalogIdentityKey(item.name, item.indexCode), item);
    });
    localCatalogItems.forEach((item) => {
      const key = normalizeOriginalInventoryCatalogIdentityKey(item.name, item.indexCode);
      if (!merged.has(key)) {
        merged.set(key, item);
      }
    });
    return [...merged.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [erpCatalogItems, localCatalog]);
  const catalogErrorCode =
    catalogError instanceof Error && !isErpOriginalsSourceError(catalogError)
      ? catalogError.message
      : '';
  const erpSourceUnavailable = erpCatalogState.sourceUnavailable;
  const erpSnapshotEntries = useMemo(
    () => (Array.isArray(erpSnapshotState?.items) ? erpSnapshotState.items : []),
    [erpSnapshotState]
  );
  const erpSnapshotMigrationRequired = Boolean(erpSnapshotState?.migrationRequired);
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
  const activeSiloConfigs = useMemo(() => {
    const list = siloConfigs.filter((item) => item.isActive);
    list.sort((a, b) => {
      const order = a.orderNo - b.orderNo;
      if (order !== 0) return order;
      const name = collator.compare(a.name, b.name);
      if (name !== 0) return name;
      return collator.compare(a.chamber, b.chamber);
    });
    return list;
  }, [siloConfigs]);
  const siloEntryMap = useMemo(
    () => new Map(siloEntries.map((entry) => [entry.configId, entry])),
    [siloEntries]
  );
  const siloConfigIdByGeneratedEntryId = useMemo(
    () =>
      new Map(
        siloEntries
          .filter((entry) => entry.generatedEntryId)
          .map((entry) => [entry.generatedEntryId as string, entry.configId])
      ),
    [siloEntries]
  );
  const siloMaterialNameByConfigId = useMemo(
    () =>
      new Map(
        siloConfigs
          .map((config) => [config.id, config.materialName.trim()] as const)
          .filter(([, materialName]) => Boolean(materialName))
      ),
    [siloConfigs]
  );
  const entriesWithCurrentSiloMaterial = useMemo(
    () =>
      entries.map((entry) => {
        const configId =
          getSiloConfigIdFromSourceId(entry.sourceId) ??
          siloConfigIdByGeneratedEntryId.get(entry.id);
        const materialName = configId ? siloMaterialNameByConfigId.get(configId) : null;
        return materialName && materialName !== entry.name ? { ...entry, name: materialName } : entry;
      }),
    [entries, siloConfigIdByGeneratedEntryId, siloMaterialNameByConfigId]
  );
  const effectiveSelectedWarehouseId = useMemo(() => {
    if (selectedWarehouseId === SILOS_SELECT_VALUE) {
      return SILOS_SELECT_VALUE;
    }
    if (selectedWarehouseId && visibleWarehouses.some((warehouse) => warehouse.id === selectedWarehouseId)) {
      return selectedWarehouseId;
    }
    if (selectedWarehouseName) {
      const restoredByName = visibleWarehouses.find(
        (warehouse) =>
          normalizeWarehouseOptionName(warehouse.name) ===
          normalizeWarehouseOptionName(selectedWarehouseName)
      );
      if (restoredByName) return restoredByName.id;
    }
    return '';
  }, [selectedWarehouseId, selectedWarehouseName, visibleWarehouses]);
  const isSilosSelected = effectiveSelectedWarehouseId === SILOS_SELECT_VALUE;

  useEffect(() => {
    setSelectedWarehouseId(getInitialWarehouseValue());
    setSelectedWarehouseName(getInitialWarehouseName());
    setWarehouseSelectionRestored(true);
  }, []);

  useEffect(() => {
    if (!warehouseSelectionRestored) return;
    const warehouseName =
      effectiveSelectedWarehouseId === SILOS_SELECT_VALUE
        ? 'Silosy'
        : visibleWarehouses.find(
            (warehouse) => warehouse.id === effectiveSelectedWarehouseId
          )?.name ?? '';
    persistWarehouseValue(effectiveSelectedWarehouseId, warehouseName);
  }, [effectiveSelectedWarehouseId, visibleWarehouses, warehouseSelectionRestored]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    setCatalogVisibleCount(CATALOG_TABLE_INITIAL_LIMIT);
  }, [deferredCatalogSearch, activeTab]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsReportFullscreen(document.fullscreenElement === reportFullscreenRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isReportFullscreenFallback) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsReportFullscreenFallback(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReportFullscreenFallback]);

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
  const saveSiloMutation = useMutation({
    mutationFn: saveOriginalInventorySiloEntry,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['original-inventory-silo-entries', variables.dateKey] });
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow'] });
      toast({ title: 'Zapisano spis silosa', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        PERCENT_REQUIRED: 'Wpisz procent od 0 do 100.',
        NOT_FOUND: 'Nie znaleziono konfiguracji silosa.',
        DATE_REQUIRED: 'Wybierz dzien spisu.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie zapisano silosa.', tone: 'error' });
    }
  });
  const addGrindTaskMutation = useMutation({
    mutationFn: addOriginalInventoryGrindTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['original-inventory-grind-tasks'] });
      setGrindDialogMaterial(null);
      setGrindQty('');
      setGrindTargetMaterial('');
      setShowGrindTargetSuggestions(false);
      toast({ title: 'Dodano do zmielenia', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        MATERIAL_REQUIRED: 'Nie wybrano materialu.',
        QTY_REQUIRED: 'Wpisz poprawna ilosc kg.',
        MIGRATION_REQUIRED_ORIGINAL_INVENTORY_GRIND_TASKS:
          'Brakuje migracji bazy dla listy do zmielenia.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie dodano do zmielenia.', tone: 'error' });
    }
  });
  const completeGrindDocumentMutation = useMutation({
    mutationFn: completeOriginalInventoryGrindTasks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['original-inventory-grind-tasks'] });
      toast({ title: 'Oznaczono dokument jako zmielony', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono dokumentu.',
        MIGRATION_REQUIRED_ORIGINAL_INVENTORY_GRIND_TASKS:
          'Brakuje migracji bazy dla listy do zmielenia.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie zapisano dokumentu.', tone: 'error' });
    }
  });
  const reopenGrindDocumentMutation = useMutation({
    mutationFn: reopenOriginalInventoryGrindTasks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['original-inventory-grind-tasks'] });
      toast({ title: 'Cofnieto dokument do edycji', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono dokumentu.',
        MIGRATION_REQUIRED_ORIGINAL_INVENTORY_GRIND_TASKS:
          'Brakuje migracji bazy dla listy do zmielenia.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie cofnieto dokumentu.', tone: 'error' });
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
      const existingNames = new Set(
        catalog.map((item) => normalizeOriginalInventoryCatalogIdentityKey(item.name, item.indexCode))
      );
      const toImport = items.filter(
        (item) => !existingNames.has(normalizeOriginalInventoryCatalogIdentityKey(item.name, item.indexCode))
      );
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
      if (isOriginalInventoryErpSnapshotPdfFile(file)) {
        setErpSnapshotImportSummary({
          parsed: null,
          currentRows: erpSnapshotEntries.length
        });
        return;
      }
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
    if (isSilosSelected) {
      toast({ title: 'Dla silosow zapisz komore w sekcji silosow.', tone: 'error' });
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
    addMutation.mutate(
      {
        warehouseId: effectiveSelectedWarehouseId,
        name,
        qty: qtyValue,
        unit: form.unit.trim() || 'kg',
        at: buildEntryTimestamp(spisDate),
        user: user?.username ?? user?.name ?? 'nieznany'
      },
      {
        onSuccess: () => {
          window.requestAnimationFrame(() => {
            nameInputRef.current?.focus();
            nameInputRef.current?.select();
          });
        }
      }
    );
  };
  const getSiloDraft = (configId: string) => {
    const existing = siloEntryMap.get(configId);
    return (
      siloDrafts[configId] ?? {
        percent: existing ? String(existing.percent) : '',
        hopperPresent: existing?.hopperPresent ?? false
      }
    );
  };
  const updateSiloDraft = (
    configId: string,
    patch: Partial<{ percent: string; hopperPresent: boolean }>
  ) => {
    const current = getSiloDraft(configId);
    const next = { ...current, ...patch };
    if (patch.percent !== undefined) {
      const nextPercent = parseQtyInput(patch.percent);
      if (nextPercent !== null && nextPercent > 100) {
        next.percent = '100';
      }
      if (nextPercent !== null && nextPercent > 0) {
        next.hopperPresent = true;
      }
    }
    setSiloDrafts((prev) => ({
      ...prev,
      [configId]: next
    }));
  };
  const handleSaveSilo = (configId: string) => {
    if (readOnly) {
      toast({ title: 'Brak uprawnien do zapisu spisu.', tone: 'error' });
      return;
    }
    const draft = getSiloDraft(configId);
    const percent = draft.percent.trim() === '' && draft.hopperPresent ? 0 : parseQtyInput(draft.percent);
    if (percent === null || percent < 0 || percent > 100) {
      toast({ title: 'Wpisz procent od 0 do 100.', tone: 'error' });
      return;
    }
    saveSiloMutation.mutate({
      configId,
      dateKey: spisDate,
      percent,
      hopperPresent: draft.hopperPresent
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
        if (expandedMaterialKey === normalizeCatalogNameKey(entryName) && selectedEntries.length === 1) {
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
    if (!spisDate) return entriesWithCurrentSiloMaterial;
    return entriesWithCurrentSiloMaterial.filter((entry) => getEntryDateKey(entry.at) === spisDate);
  }, [entriesWithCurrentSiloMaterial, spisDate]);
  const inventoryExportRows = useMemo(() => {
    const rows = new Map<
      string,
      {
        materialName: string;
        locationName: string;
        locationType: 'Silos' | 'Hala / miejsce';
        qty: number;
        unit: string;
      }
    >();

    entriesForDate.forEach((entry) => {
      const isSilo = entry.sourceType === 'SILO';
      const locationName =
        entry.location?.trim() ||
        warehouseNameMap.get(entry.warehouseId)?.trim() ||
        entry.warehouseId?.trim() ||
        'Nieznana lokalizacja';
      const unit = entry.unit.trim() || 'kg';
      const key = [
        normalizeCatalogNameKey(entry.name),
        normalizeCatalogNameKey(locationName),
        unit.toLowerCase()
      ].join('|');
      const current = rows.get(key);
      if (current) {
        current.qty += entry.qty;
        return;
      }
      rows.set(key, {
        materialName: entry.name,
        locationName,
        locationType: isSilo ? 'Silos' : 'Hala / miejsce',
        qty: entry.qty,
        unit
      });
    });

    return [...rows.values()].sort((left, right) => {
      const materialCompare = exportCatalogCollator.compare(left.materialName, right.materialName);
      if (materialCompare !== 0) return materialCompare;
      return exportCatalogCollator.compare(left.locationName, right.locationName);
    });
  }, [entriesForDate, warehouseNameMap]);

  const existingByName = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; total: number }>();
    entriesForDate.forEach((entry) => {
      const key = normalizeCatalogNameKey(entry.name);
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
    const needle = normalizeCatalogNameKey(form.name);
    if (!needle) return null;
    return existingByName.get(needle) ?? null;
  }, [existingByName, form.name]);
  const matchedErpSnapshot = useMemo(() => {
    const needle = normalizeCatalogNameKey(form.name);
    if (!needle) return null;
    return erpSnapshotMap.get(needle) ?? null;
  }, [erpSnapshotMap, form.name]);
  const nameSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const namesWithIndexedSuggestions = new Set<string>();
    const list: Array<{
      name: string;
      unit: string;
      warehouseCode: string | null;
      indexCode: string | null;
      isMag55: boolean;
    }> = [];
    const registerIndexedName = (
      name: string,
      warehouseCode: string | null | undefined,
      indexCode: string | null | undefined
    ) => {
      if (warehouseCode || indexCode) {
        namesWithIndexedSuggestions.add(normalizeCatalogNameKey(name));
      }
    };

    erpSnapshotEntries.forEach((item) =>
      registerIndexedName(
        item.name,
        item.warehouseCode ? String(item.warehouseCode).trim().toUpperCase() : null,
        item.indexCode ? String(item.indexCode).trim() : null
      )
    );
    erpCatalogItems.forEach((item) =>
      registerIndexedName(
        item.name,
        item.warehouseCode ? String(item.warehouseCode).trim().toUpperCase() : null,
        item.indexCode ? String(item.indexCode).trim() : null
      )
    );
    catalog.forEach((item) =>
      registerIndexedName(
        item.name,
        item.warehouseCode ? String(item.warehouseCode).trim().toUpperCase() : null,
        item.indexCode ? String(item.indexCode).trim() : null
      )
    );

    erpSnapshotEntries.forEach((item) => {
      const nameKey = normalizeCatalogNameKey(item.name);
      const warehouseCode = item.warehouseCode ? String(item.warehouseCode).trim().toUpperCase() : null;
      const indexCode = item.indexCode ? String(item.indexCode).trim() : null;
      const key = `${nameKey}|${warehouseCode ?? ''}|${indexCode ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        name: item.name,
        unit: item.unit,
        warehouseCode,
        indexCode,
        isMag55: warehouseCode === 'M-55'
      });
    });
    erpCatalogItems.forEach((item) => {
      const nameKey = normalizeCatalogNameKey(item.name);
      const warehouseCode = item.warehouseCode ? String(item.warehouseCode).trim().toUpperCase() : null;
      const indexCode = item.indexCode ? String(item.indexCode).trim() : null;
      const key = `${nameKey}|${warehouseCode ?? ''}|${indexCode ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        name: item.name,
        unit: item.unit,
        warehouseCode,
        indexCode,
        isMag55: warehouseCode === 'M-55'
      });
    });
    existingList.forEach((item) => {
      const nameKey = normalizeCatalogNameKey(item.name);
      if (namesWithIndexedSuggestions.has(nameKey)) return;
      const key = `${nameKey}|||`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        name: item.name,
        unit: item.unit,
        warehouseCode: null,
        indexCode: null,
        isMag55: false
      });
    });
    catalog.forEach((item) => {
      const nameKey = normalizeCatalogNameKey(item.name);
      const warehouseCode = item.warehouseCode ? String(item.warehouseCode).trim().toUpperCase() : null;
      const indexCode = item.indexCode ? String(item.indexCode).trim() : null;
      if (!warehouseCode && !indexCode && namesWithIndexedSuggestions.has(nameKey)) return;
      const key = `${nameKey}|${warehouseCode ?? ''}|${indexCode ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({
        name: item.name,
        unit: item.unit,
        warehouseCode,
        indexCode,
        isMag55: warehouseCode === 'M-55'
      });
    });
    const deduped = new Map<string, (typeof list)[number]>();
    list.forEach((item) => {
      const key = `${normalizeCatalogNameKey(item.name)}|${item.warehouseCode ?? ''}`;
      const current = deduped.get(key);
      if (!current) {
        deduped.set(key, item);
        return;
      }
      const currentScore =
        (current.warehouseCode ? 4 : 0) + (current.indexCode ? 2 : 0) + (current.unit ? 1 : 0);
      const nextScore = (item.warehouseCode ? 4 : 0) + (item.indexCode ? 2 : 0) + (item.unit ? 1 : 0);
      if (nextScore > currentScore) {
        deduped.set(key, item);
      }
    });
    const values = [...deduped.values()];
    const namesWithWarehouseVariant = new Set(
      values
        .filter((item) => Boolean(item.warehouseCode))
        .map((item) => normalizeCatalogNameKey(item.name))
    );
    return values.filter(
      (item) => Boolean(item.warehouseCode) || !namesWithWarehouseVariant.has(normalizeCatalogNameKey(item.name))
    );
  }, [catalog, erpCatalogItems, erpSnapshotEntries, existingList]);
  const filteredNameSuggestions = useMemo(() => {
    if (!normalizeCatalogNameKey(form.name)) return [];
    const filtered = nameSuggestions
      .filter((item) => matchesCatalogSearch(form.name, item.name, item.indexCode, item.warehouseCode))
    const deduped = new Map<string, (typeof filtered)[number]>();
    filtered.forEach((item) => {
      const key = `${normalizeCatalogNameKey(item.name)}|${item.warehouseCode ?? ''}`;
      const current = deduped.get(key);
      if (!current) {
        deduped.set(key, item);
        return;
      }
      const currentScore = (current.indexCode ? 1 : 0) + (current.warehouseCode ? 2 : 0);
      const nextScore = (item.indexCode ? 1 : 0) + (item.warehouseCode ? 2 : 0);
      if (nextScore > currentScore) {
        deduped.set(key, item);
      }
    });
    return [...deduped.values()]
      .sort((a, b) => {
        const aExistsInSpis = existingByName.has(normalizeCatalogNameKey(a.name));
        const bExistsInSpis = existingByName.has(normalizeCatalogNameKey(b.name));
        if (aExistsInSpis !== bExistsInSpis) return aExistsInSpis ? -1 : 1;
        if (a.isMag55 !== b.isMag55) return a.isMag55 ? 1 : -1;
        if (Boolean(a.warehouseCode) !== Boolean(b.warehouseCode)) return a.warehouseCode ? -1 : 1;
        const nameCompare = collator.compare(a.name, b.name);
        if (nameCompare !== 0) return nameCompare;
        return collator.compare(a.warehouseCode ?? '', b.warehouseCode ?? '');
      })
      .slice(0, 8);
  }, [existingByName, form.name, nameSuggestions]);
  const filteredCatalog = useMemo(() => {
    if (activeTab !== 'kartoteki') return [];
    if (!normalizeCatalogNameKey(deferredCatalogSearch)) return catalog;
    return catalog.filter((item) =>
      matchesCatalogSearch(deferredCatalogSearch, item.name, item.indexCode, item.warehouseCode)
    );
  }, [activeTab, catalog, deferredCatalogSearch]);
  const visibleCatalogRows = useMemo(
    () => filteredCatalog.slice(0, catalogVisibleCount),
    [catalogVisibleCount, filteredCatalog]
  );
  const catalogTableRows = useMemo(
    () =>
      visibleCatalogRows.map((item) => [
        item.name,
        item.indexCode ?? '-',
        item.warehouseCode ?? '-',
        item.unit,
        new Date(item.createdAt).toLocaleString('pl-PL')
      ]),
    [visibleCatalogRows]
  );
  const hasMoreCatalogRows = catalogVisibleCount < filteredCatalog.length;
  const applyNameToForm = (rawName: string) => {
    setForm((prev) => ({ ...prev, name: rawName }));
  };
  const applyNameSuggestionToForm = (suggestion: (typeof nameSuggestions)[number]) => {
    setForm((prev) => ({
      ...prev,
      name: suggestion.name,
      unit: suggestion.unit || prev.unit
    }));
    qtyInputRef.current?.focus();
    qtyInputRef.current?.select();
  };

  const materialGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; unit: string; entries: typeof entriesForDate }
    >();
    entriesForDate.forEach((entry) => {
      const key = normalizeCatalogNameKey(entry.name);
      const current = map.get(key);
      if (current) {
        current.entries.push(entry);
      } else {
        map.set(key, { key, name: entry.name, unit: entry.unit, entries: [entry] });
      }
    });
    return map;
  }, [entriesForDate]);

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
  const reportSourceEntries = useMemo(() => {
    const rows = [...dailySummary];
    if (!showReportUncountedItems) return rows;

    const countedMaterialKeys = new Set(dailySummary.map((entry) => entry.key));
    erpSnapshotMap.forEach((entry, key) => {
      if (countedMaterialKeys.has(key)) return;
      if (dailyReportExcludePatterns.some((pattern) => pattern.test(entry.name))) return;
      rows.push({
        key,
        name: entry.name,
        unit: entry.unit,
        qty: 0
      });
    });

    return rows.sort((a, b) => {
      const nameCompare = exportCatalogCollator.compare(a.name.trim(), b.name.trim());
      if (nameCompare !== 0) return nameCompare;
      return exportCatalogCollator.compare(a.unit.trim(), b.unit.trim());
    });
  }, [dailySummary, erpSnapshotMap, showReportUncountedItems]);
  const inventoryHistoryByMaterial = useMemo(() => {
    if (!spisDate) return new Map<string, Array<{ dateKey: string; name: string; unit: string; qty: number }>>();
    const grouped = new Map<
      string,
      Map<string, { dateKey: string; name: string; unit: string; qty: number }>
    >();
    entriesWithCurrentSiloMaterial.forEach((entry) => {
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
  }, [entriesWithCurrentSiloMaterial, spisDate]);
  const reportPreviousSnapshotDates = useMemo(() => {
    const dates = new Set<string>();
    const allowedDates = new Set(getPreviousDateKeys(spisDate, REPORT_HISTORY_DAYS_TWO_MONTHS));
    reportSourceEntries.forEach((entry) => {
      (inventoryHistoryByMaterial.get(entry.key) ?? [])
        .filter((point) => allowedDates.has(point.dateKey))
        .forEach((point) => dates.add(point.dateKey));
    });
    return [...dates].sort((a, b) => b.localeCompare(a));
  }, [inventoryHistoryByMaterial, reportSourceEntries, spisDate]);
  const reportHistoryDates = useMemo(
    () => reportPreviousSnapshotDates.slice(0, REPORT_HISTORY_DAYS_SHORT),
    [reportPreviousSnapshotDates]
  );
  const reportHistoryDatesTwoMonths = useMemo(
    () => reportPreviousSnapshotDates.slice(0, REPORT_HISTORY_DAYS_TWO_MONTHS),
    [reportPreviousSnapshotDates]
  );
  const reportHistoryDatesForExport = reportHistoryDatesTwoMonths;
  const {
    data: historicalErpSnapshotState = {
      items: [] as OriginalInventoryErpSnapshotEntry[],
      migrationRequired: false
    },
    isFetching: isHistoricalErpSnapshotFetching
  } = useQuery({
    queryKey: ['spis-oryginalow-erp-snapshot-history', reportHistoryDatesTwoMonths],
    queryFn: async () => {
      try {
        return {
          items: await getOriginalInventoryErpSnapshotsByDates(reportHistoryDatesTwoMonths),
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
    enabled: reportHistoryDates.length > 0,
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
  const historicalErpSnapshotEntries = useMemo(
    () =>
      Array.isArray(historicalErpSnapshotState?.items)
        ? historicalErpSnapshotState.items
        : [],
    [historicalErpSnapshotState]
  );
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
    return [...reportSourceEntries]
      .map((entry) => {
        const historyByDate = new Map(
          (inventoryHistoryByMaterial.get(entry.key) ?? []).map((point) => [point.dateKey, point])
        );
        const previousComparisons = reportHistoryDates.map((dateKey) => {
          const point = historyByDate.get(dateKey);
          if (!point) return null;
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
        const currentComparison = {
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
        return {
          key: entry.key,
          name: entry.name,
          unit: entry.unit,
          currentRealErpQty: currentComparison.realErpQty,
          currentAvailableErpQty: currentComparison.availableErpQty,
          currentSpisQty: currentComparison.spisQty,
          currentRealDiffQty: currentComparison.realDiffQty,
          currentAvailableDiffQty: currentComparison.availableDiffQty,
          previousRealDiffs: previousComparisons.map((point) =>
            point
              ? {
                  dateKey: point.dateKey,
                  diffQty: point.realDiffQty
                }
              : null
          ),
          previousAvailableDiffs: previousComparisons.map((point) =>
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
  }, [erpSnapshotByDateAndMaterial, erpSnapshotMap, inventoryHistoryByMaterial, reportHistoryDates, reportSourceEntries, spisDate]);
  const reportRowsForExport = useMemo(() => {
    return [...reportSourceEntries]
      .map((entry) => {
        const historyByDate = new Map(
          (inventoryHistoryByMaterial.get(entry.key) ?? []).map((point) => [point.dateKey, point])
        );
        const previousComparisons = reportHistoryDatesForExport.map((dateKey) => {
          const point = historyByDate.get(dateKey);
          if (!point) return null;
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
        const currentComparison = {
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
        return {
          key: entry.key,
          name: entry.name,
          unit: entry.unit,
          currentRealErpQty: currentComparison.realErpQty,
          currentAvailableErpQty: currentComparison.availableErpQty,
          currentSpisQty: currentComparison.spisQty,
          currentRealDiffQty: currentComparison.realDiffQty,
          currentAvailableDiffQty: currentComparison.availableDiffQty,
          previousRealDiffs: previousComparisons.map((point) =>
            point
              ? {
                  dateKey: point.dateKey,
                  diffQty: point.realDiffQty
                }
              : null
          ),
          previousAvailableDiffs: previousComparisons.map((point) =>
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
  }, [erpSnapshotByDateAndMaterial, erpSnapshotMap, inventoryHistoryByMaterial, reportHistoryDatesForExport, reportSourceEntries, spisDate]);
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
  const reportOptions = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        unit: string;
        indexCodes: Set<string>;
        warehouseCodes: Set<string>;
        inReport: boolean;
        hasHistory: boolean;
      }
    >();

    const ensureOption = (name: string, unit?: string) => {
      const key = normalizeCatalogNameKey(name);
      if (!key) return null;
      const current = map.get(key);
      if (current) {
        if (!current.unit && unit) {
          current.unit = unit;
        }
        return current;
      }
      const next = {
        key,
        name,
        unit: unit ?? '',
        indexCodes: new Set<string>(),
        warehouseCodes: new Set<string>(),
        inReport: false,
        hasHistory: false
      };
      map.set(key, next);
      return next;
    };

    const addCatalogMeta = (
      name: string,
      unit?: string,
      indexCode?: string | null,
      warehouseCode?: string | null
    ) => {
      const option = ensureOption(name, unit);
      if (!option) return;
      const normalizedIndex = String(indexCode ?? '').trim();
      const normalizedWarehouse = String(warehouseCode ?? '').trim().toUpperCase();
      if (normalizedIndex) option.indexCodes.add(normalizedIndex);
      if (normalizedWarehouse) option.warehouseCodes.add(normalizedWarehouse);
    };

    reportRows.forEach((row) => {
      const option = ensureOption(row.name, row.unit);
      if (option) option.inReport = true;
    });
    entries.forEach((entry) => {
      const option = ensureOption(entry.name, entry.unit);
      if (option) option.hasHistory = true;
    });
    erpSnapshotEntries.forEach((item) =>
      addCatalogMeta(item.name, item.unit, item.indexCode ?? null, item.warehouseCode ?? null)
    );
    erpCatalogItems.forEach((item) =>
      addCatalogMeta(item.name, item.unit, item.indexCode ?? null, item.warehouseCode ?? null)
    );
    catalog.forEach((item) =>
      addCatalogMeta(item.name, item.unit, item.indexCode ?? null, item.warehouseCode ?? null)
    );

    return [...map.values()]
      .map((option) => ({
        ...option,
        indexCodes: [...option.indexCodes].sort((a, b) => collator.compare(a, b)),
        warehouseCodes: [...option.warehouseCodes].sort((a, b) => collator.compare(a, b))
      }))
      .sort((a, b) => {
        if (a.inReport !== b.inReport) return a.inReport ? -1 : 1;
        if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1;
        return collator.compare(a.name, b.name);
      });
  }, [catalog, entries, erpCatalogItems, erpSnapshotEntries, reportRows]);
  const selectedReportOption = useMemo(() => {
    const normalizedQuery = normalizeCatalogNameKey(reportQuery);
    const rawQuery = reportQuery.trim().toLowerCase();
    if (!normalizedQuery || reportOptions.length === 0) return null;
    return (
      reportOptions.find(
        (option) =>
          option.key === normalizedQuery ||
          normalizeCatalogNameKey(option.name) === normalizedQuery ||
          option.indexCodes.some((code) => code.toLowerCase() === rawQuery) ||
          option.warehouseCodes.some((code) => code.toLowerCase() === rawQuery)
      ) ?? null
    );
  }, [reportOptions, reportQuery]);
  const selectedReportMaterialKey = selectedReportOption?.key ?? '';
  const selectedReportRows = useMemo(() => {
    if (!selectedReportMaterialKey) return [];
    return reportRows.filter((row) => row.key === selectedReportMaterialKey);
  }, [reportRows, selectedReportMaterialKey]);
  const pendingGrindQtyByMaterial = useMemo(() => {
    const map = new Map<string, number>();
    grindTasks.forEach((task) => {
      if (task.status === 'DONE' || task.sourceReportDate !== spisDate) return;
      const key = normalizeCatalogNameKey(task.materialName);
      if (!key) return;
      map.set(key, (map.get(key) ?? 0) + task.qty);
    });
    return map;
  }, [grindTasks, spisDate]);
  const reportSuggestions = useMemo(() => {
    if (!normalizeCatalogNameKey(reportQuery)) return [];
    return reportOptions
      .filter((option) =>
        matchesCatalogSearch(
          reportQuery,
          option.name,
          option.indexCodes.join(' '),
          option.warehouseCodes.join(' ')
        )
      )
      .slice(0, 8);
  }, [reportOptions, reportQuery]);

  const reportExportHistoryDateLabels = useMemo(
    () =>
      Array.from({ length: reportHistoryDatesForExport.length }, (_, index) =>
        reportHistoryDatesForExport[index] ? formatCompactDate(reportHistoryDatesForExport[index]) : '-'
      ),
    [reportHistoryDatesForExport]
  );

  const handleExportDaily = async () => {
    if (!spisDate || reportRowsForExport.length === 0) return;
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
      type ExportColumn = {
        key: string;
        header: string;
        wrap: boolean;
        align: 'left' | 'center' | 'right';
        minWidth: number;
        maxWidth: number;
        multiplier?: number;
        padding?: number;
        getValue: (row: (typeof reportRowsForExport)[number]) => string;
      };
      const exportReportModes = visibleReportModes;
      const exportColumns: ExportColumn[] = [
        {
          key: 'name',
          header: 'Material',
          wrap: true,
          align: 'left' as const,
          minWidth: 34,
          maxWidth: 80,
          multiplier: 1.12,
          padding: 4,
          getValue: (row: (typeof reportRowsForExport)[number]) => row.name
        },
        ...exportReportModes.map((mode) => ({
            key: `erpToday-${mode.key}`,
            header: `ERP dzis (${mode.shortLabel})`,
            wrap: false,
            align: 'center' as const,
            minWidth: 14,
            maxWidth: 18,
            getValue: (row: (typeof reportRowsForExport)[number]) =>
              formatExcelQty(mode.key === 'real' ? row.currentRealErpQty : row.currentAvailableErpQty)
        })),
        {
          key: 'spisToday',
          header: 'Spis dzis',
          wrap: false,
          align: 'center' as const,
          minWidth: 12,
          maxWidth: 18,
          getValue: (row: (typeof reportRowsForExport)[number]) => formatExcelQty(row.currentSpisQty)
        },
        ...exportReportModes.map((mode) => ({
            key: `diffToday-${mode.key}`,
            header: `Roznica dzis (${mode.shortLabel})`,
            wrap: false,
            align: 'right' as const,
            minWidth: 16,
            maxWidth: 20,
            getValue: (row: (typeof reportRowsForExport)[number]) =>
              formatExcelSignedQty(
                mode.key === 'real' ? row.currentRealDiffQty : row.currentAvailableDiffQty
              )
        })),
        ...Array.from({ length: reportExportHistoryDateLabels.length }, (_, index) =>
            exportReportModes.map((mode) => ({
              key: `diffPrev${index + 1}-${mode.key}`,
              header: `Roznica ${reportExportHistoryDateLabels[index]} (${mode.shortLabel})`,
              wrap: false,
              align: 'left' as const,
              minWidth: 16,
              maxWidth: 22,
              getValue: (row: (typeof reportRowsForExport)[number]) =>
                formatExcelDiffHistoryCell(
                  mode.key === 'real'
                    ? row.previousRealDiffs[index]
                    : row.previousAvailableDiffs[index]
                )
            }))
          ).flat(),
        {
          key: 'unit',
          header: 'Jedn.',
          wrap: false,
          align: 'center' as const,
          minWidth: 8,
          maxWidth: 12,
          getValue: (row: (typeof reportRowsForExport)[number]) => row.unit
        }
      ];
      const columnWidths = Object.fromEntries(
        exportColumns.map((column) => [
          column.key,
          fitWidth(
            [column.header, ...reportRowsForExport.map((row) => column.getValue(row))],
            column.minWidth,
            column.maxWidth,
            column.multiplier ?? 1,
            column.padding ?? 2
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
      worksheet.getCell('A1').value = 'Raport kontroli rozjazdow - spis rzeczywisty';
      worksheet.getCell('A2').value = currentErpSnapshotMeta
        ? `Dzien raportu: ${spisDate} | ERP wgrane: ${new Date(currentErpSnapshotMeta.importedAt).toLocaleString('pl-PL')}`
        : `Dzien raportu: ${spisDate} | ERP wgrane: brak`;
      worksheet.getCell('A3').value =
        `Wygenerowano: ${generatedAt} | Dane ERP: ${exportReportModes.map((mode) => mode.fullLabel).join(', ')} | ` +
        `Historia: ${reportExportHistoryDateLabels.length} dni | Kolumny XLSX: ${exportColumns.length}`;

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

      reportRowsForExport.forEach((row, rowIndex) => {
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

        exportReportModes.forEach((mode) => {
          const diffTodayColumnIndex =
            exportColumns.findIndex((column) => column.key === `diffToday-${mode.key}`) + 1;
          const diffHighlightValue =
            mode.key === 'real' ? row.currentRealDiffQty : row.currentAvailableDiffQty;
          if (
            diffTodayColumnIndex <= 0 ||
            diffHighlightValue === null ||
            !Number.isFinite(diffHighlightValue)
          ) {
            return;
          }
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
        });
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spis-rzeczywisty-raport-${spisDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Nie udalo sie wyeksportowac raportu XLSX.', tone: 'error' });
    }
  };
  const handleExportInventoryByLocation = async () => {
    if (!spisDate || inventoryExportRows.length === 0) return;
    try {
      const ExcelJSModule = await import('exceljs');
      const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'APKA DLA KAMILA';
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet('Spis wg lokalizacji', {
        views: [{ state: 'frozen', ySplit: 1 }]
      });
      worksheet.columns = [
        { header: 'Data spisu', key: 'date', width: 14 },
        { header: 'Tworzywo', key: 'material', width: 48 },
        { header: 'Lokalizacja', key: 'location', width: 30 },
        { header: 'Typ lokalizacji', key: 'locationType', width: 18 },
        { header: 'Ilość', key: 'qty', width: 14 },
        { header: 'Jednostka', key: 'unit', width: 12 }
      ];
      worksheet.autoFilter = 'A1:F1';
      const headerRow = worksheet.getRow(1);
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } };
        cell.alignment = { vertical: 'middle' };
      });
      inventoryExportRows.forEach((row) => {
        const excelRow = worksheet.addRow({
          date: spisDate,
          material: row.materialName,
          location: row.locationName,
          locationType: row.locationType,
          qty: Math.round(row.qty * 1000) / 1000,
          unit: row.unit
        });
        excelRow.getCell('qty').numFmt = '0.###';
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spis-rzeczywisty-lokalizacje-${spisDate}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Nie udalo sie wyeksportowac spisu XLSX.', tone: 'error' });
    }
  };
  const materialGroupList = useMemo(() => {
    const list = [...materialGroups.values()].map((group) => {
      const total = group.entries.reduce((sum, entry) => sum + entry.qty, 0);
      const lastEntry = [...group.entries].sort((a, b) => b.at.localeCompare(a.at))[0];
      const hallIds = Array.from(
        new Set(group.entries.filter((entry) => entry.sourceType !== 'SILO').map((entry) => entry.warehouseId))
      );
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
          if (entry.sourceType === 'SILO') {
            return `${entry.qty} (Silos)`;
          }
          const warehouseLabel = warehouseNameMap.get(entry.warehouseId);
          return warehouseLabel ? `${entry.qty} (${warehouseLabel})` : String(entry.qty);
        })
        .join(' + ')
    : '';
  const currentReportDateLabel = formatCompactDate(spisDate);
  const reportHistoryDateLabels = Array.from({ length: reportHistoryDates.length }, (_, index) =>
    reportHistoryDates[index] ? formatCompactDate(reportHistoryDates[index]) : '-'
  );
  const visibleReportModes = [
    reportQuantityMode === 'real'
      ? {
          key: 'real' as const,
          shortLabel: 'rzecz.',
          fullLabel: 'stan rzeczywisty'
        }
      : {
          key: 'available' as const,
          shortLabel: 'dysp.',
          fullLabel: 'stan do dyspozycji'
        }
  ];
  const handleReportRealQtyToggle = (checked: boolean) => {
    if (checked) setReportQuantityMode('real');
  };
  const handleReportAvailableQtyToggle = (checked: boolean) => {
    if (checked) setReportQuantityMode('available');
  };
  const isReportFullscreenActive = isReportFullscreen || isReportFullscreenFallback;
  const toggleReportFullscreen = async () => {
    if (isReportFullscreenFallback) {
      setIsReportFullscreenFallback(false);
      return;
    }
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } finally {
        setIsReportFullscreen(false);
      }
      return;
    }
    const element = reportFullscreenRef.current;
    if (!element) return;
    if (element.requestFullscreen) {
      try {
        await element.requestFullscreen();
        setIsReportFullscreen(true);
        return;
      } catch {
        // Fall back to an in-app maximized table when browser fullscreen is blocked.
      }
    }
    setIsReportFullscreenFallback(true);
  };
  const reportColumns = [
    'Material',
    ...visibleReportModes.map((mode) => `ERP ${currentReportDateLabel} (${mode.shortLabel})`),
    `Spis ${currentReportDateLabel}`,
    ...visibleReportModes.map((mode) => `Roznica ${currentReportDateLabel} (${mode.shortLabel})`),
    ...reportHistoryDateLabels.flatMap((dateLabel) =>
      visibleReportModes.map((mode) => `Roznica ${dateLabel} (${mode.shortLabel})`)
    ),
    'Jedn.'
  ];
  const renderReportMaterialCell = (row: (typeof reportRows)[number]) => {
    const grindQty = pendingGrindQtyByMaterial.get(row.key) ?? 0;
    if (grindQty <= 0) return row.name;
    return (
      <div className="min-w-0 space-y-1">
        <div className="break-words">{row.name}</div>
        <div className="text-xs font-semibold text-violet-200">
          − {formatQty(grindQty)} kg do mielenia
        </div>
      </div>
    );
  };
  const getReportRowClassName = (row: (typeof reportRows)[number]) =>
    (pendingGrindQtyByMaterial.get(row.key) ?? 0) > 0
      ? 'border-[rgba(168,85,247,0.36)] bg-[linear-gradient(90deg,rgba(168,85,247,0.18),rgba(88,28,135,0.08))] hover:bg-[rgba(168,85,247,0.16)]'
      : '';
  const reportActionButtonBaseClassName =
    'report-action-button rounded-xl px-4 transition active:translate-y-px disabled:translate-y-0';
  const reportExportButtonClassName = cn(
    reportActionButtonBaseClassName,
    'report-action-button-export'
  );
  const reportFullscreenButtonClassName = cn(
    reportActionButtonBaseClassName,
    'report-action-button-fullscreen'
  );
  const reportTableRows = reportRows.map((row) => [
    renderReportMaterialCell(row),
    ...visibleReportModes.map((mode) =>
      formatQty(mode.key === 'real' ? row.currentRealErpQty : row.currentAvailableErpQty)
    ),
    formatQty(row.currentSpisQty),
    ...visibleReportModes.map((mode) =>
      formatSignedQty(mode.key === 'real' ? row.currentRealDiffQty : row.currentAvailableDiffQty)
    ),
    ...Array.from({ length: reportHistoryDateLabels.length }, (_, index) =>
      visibleReportModes.map((mode) =>
        formatDiffHistoryCell(
          mode.key === 'real' ? row.previousRealDiffs[index] : row.previousAvailableDiffs[index]
        )
      )
    ).flat(),
    row.unit
  ]);
  const selectedReportTableRows = selectedReportRows.map((row) => [
    renderReportMaterialCell(row),
    ...visibleReportModes.map((mode) =>
      formatQty(mode.key === 'real' ? row.currentRealErpQty : row.currentAvailableErpQty)
    ),
    formatQty(row.currentSpisQty),
    ...visibleReportModes.map((mode) =>
      formatSignedQty(mode.key === 'real' ? row.currentRealDiffQty : row.currentAvailableDiffQty)
    ),
    ...Array.from({ length: reportHistoryDateLabels.length }, (_, index) =>
      visibleReportModes.map((mode) =>
        formatDiffHistoryCell(
          mode.key === 'real' ? row.previousRealDiffs[index] : row.previousAvailableDiffs[index]
        )
      )
    ).flat(),
    row.unit
  ]);
  const dailyComparisonColumns = [
    'Material',
    ...visibleReportModes.map((mode) => `ERP ${currentReportDateLabel} (${mode.shortLabel})`),
    `Spis ${currentReportDateLabel}`,
    ...visibleReportModes.map((mode) => `Roznica ${currentReportDateLabel} (${mode.shortLabel})`),
    'Jedn.'
  ];
  const dailyComparisonRows = dailyComparison.map((row) => [
    row.name,
    ...visibleReportModes.map((mode) =>
      formatQty(mode.key === 'real' ? row.realErpQty : row.availableErpQty)
    ),
    formatQty(row.spisQty),
    ...visibleReportModes.map((mode) =>
      formatSignedQty(mode.key === 'real' ? row.realDiffQty : row.availableDiffQty)
    ),
    row.unit
  ]);

  const grindTargetOptions = useMemo(() => {
    const options = new Map<string, string>();
    grindTargetSourceMaterials
      .filter((material) => material.isActive)
      .forEach((material) => {
        const value = material.code.trim();
        const key = normalizeCatalogNameKey(value);
        if (key && !options.has(key)) options.set(key, value);
      });
    return [...options.values()].sort((a, b) => collator.compare(a, b));
  }, [grindTargetSourceMaterials]);
  const grindTargetSuggestions = useMemo(() => {
    if (!normalizeCatalogNameKey(grindTargetMaterial)) return grindTargetOptions.slice(0, 8);
    return grindTargetOptions
      .filter((option) => matchesCatalogSearch(grindTargetMaterial, option))
      .slice(0, 8);
  }, [grindTargetMaterial, grindTargetOptions]);
  const pendingGrindTasks = grindTasks.filter((task) => task.status !== 'DONE');
  const doneGrindTasks = grindTasks.filter((task) => task.status === 'DONE');
  const buildGrindDocuments = (
    tasks: typeof grindTasks,
    mode: 'pending' | 'done'
  ) => {
    const documents: Array<{
      key: string;
      targetMaterialName: string;
      tasks: typeof grindTasks;
      totalQty: number;
      createdAt: string;
      completedAt?: string | null;
      completedBy?: string | null;
    }> = [];
    const sorted = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    sorted.forEach((task) => {
      const targetMaterialName = task.targetMaterialName?.trim() || 'Brak docelowej kartoteki';
      const targetKey = normalizeCatalogNameKey(targetMaterialName) || targetMaterialName.toLowerCase();
      const doneKey = mode === 'done' ? `${task.completedAt ?? task.createdAt}|${task.completedBy ?? ''}` : '';
      const candidate =
        mode === 'pending'
          ? [...documents]
              .reverse()
              .find(
                (document) =>
                  normalizeCatalogNameKey(document.targetMaterialName) === targetKey &&
                  document.totalQty + task.qty <= 500
              )
          : documents.find(
              (document) =>
                document.key === `${targetKey}|${doneKey}`
            );

      if (candidate) {
        candidate.tasks.push(task);
        candidate.totalQty += task.qty;
        return;
      }

      documents.push({
        key:
          mode === 'pending'
            ? `${targetKey}|${documents.filter((document) => normalizeCatalogNameKey(document.targetMaterialName) === targetKey).length + 1}`
            : `${targetKey}|${doneKey}`,
        targetMaterialName,
        tasks: [task],
        totalQty: task.qty,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        completedBy: task.completedBy
      });
    });

    return documents.sort((a, b) => {
      if (mode === 'done') {
        return String(b.completedAt ?? b.createdAt).localeCompare(String(a.completedAt ?? a.createdAt));
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
  };
  const pendingGrindDocuments = buildGrindDocuments(pendingGrindTasks, 'pending');
  const doneGrindDocuments = buildGrindDocuments(doneGrindTasks, 'done');
  const parsedGrindQty = parseQtyInput(grindQty);
  const grindQtyLimitMessage =
    parsedGrindQty !== null && Number.isFinite(parsedGrindQty) && parsedGrindQty > 500
      ? `Maksymalna mo\u017cliwa ilo\u015b\u0107 do wpisania: ${formatQty(500)} kg`
      : '';
  const openGrindDialog = (row: (typeof reportRows)[number]) => {
    setGrindDialogMaterial({
      name: row.name,
      unit: row.unit || 'kg',
      availableQty: row.currentAvailableErpQty
    });
    setGrindQty('');
    setGrindTargetMaterial('');
    setShowGrindTargetSuggestions(false);
  };
  const closeGrindDialog = () => {
    if (addGrindTaskMutation.isPending) return;
    setGrindDialogMaterial(null);
    setGrindQty('');
    setGrindTargetMaterial('');
    setShowGrindTargetSuggestions(false);
  };
  const handleAddGrindTask = () => {
    if (!grindDialogMaterial) return;
    const qty = parseQtyInput(grindQty);
    if (qty === null || !Number.isFinite(qty) || qty <= 0) {
      toast({ title: 'Wpisz poprawna ilosc kg.', tone: 'error' });
      return;
    }
    if (qty > 500) {
      toast({ title: 'Jeden dokument moze miec maksymalnie 500 kg.', tone: 'error' });
      return;
    }
    const targetMaterialName = grindTargetMaterial.trim();
    if (!targetMaterialName) {
      toast({ title: 'Wybierz docelowa kartoteke.', tone: 'error' });
      return;
    }
    addGrindTaskMutation.mutate({
      materialName: grindDialogMaterial.name,
      targetMaterialName,
      qty,
      unit: grindDialogMaterial.unit || 'kg',
      sourceReportDate: spisDate
    });
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="space-y-4">
        <TabsList className="grid w-full grid-cols-1 gap-2 rounded-none border-0 bg-transparent p-0 shadow-none sm:grid-cols-2 xl:grid-cols-5">
          <TabsTrigger
            value="spis"
            className={cn(
              originalInventoryTabTileClassName,
              'original-inventory-tab-spis'
            )}
          >
            <ClipboardList className={originalInventoryTabIconClassName} />
            <span>Spis</span>
          </TabsTrigger>
          <TabsTrigger
            value="kartoteki"
            className={cn(
              originalInventoryTabTileClassName,
              'original-inventory-tab-kartoteki'
            )}
          >
            <Search className={originalInventoryTabIconClassName} />
            <span>Kartoteki</span>
          </TabsTrigger>
          <TabsTrigger
            value="stany-erp"
            className={cn(
              originalInventoryTabTileClassName,
              'original-inventory-tab-stany-erp'
            )}
          >
            <Database className={originalInventoryTabIconClassName} />
            <span>Stany ERP</span>
          </TabsTrigger>
          <TabsTrigger
            value="raporty"
            className={cn(
              originalInventoryTabTileClassName,
              'original-inventory-tab-raporty'
            )}
          >
            <BarChart3 className={originalInventoryTabIconClassName} />
            <span>Raporty</span>
          </TabsTrigger>
          <TabsTrigger
            value="do-zmielenia"
            className={cn(
              originalInventoryTabTileClassName,
              'original-inventory-tab-do-zmielenia'
            )}
          >
            <Factory className={originalInventoryTabIconClassName} />
            <span>Do zmielenia</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spis" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Spis rzeczywisty</p>
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
                  onChange={(event) => {
                    const warehouseId = event.target.value;
                    const warehouseName =
                      warehouseId === SILOS_SELECT_VALUE
                        ? 'Silosy'
                        : visibleWarehouses.find(
                            (warehouse) => warehouse.id === warehouseId
                          )?.name ?? '';
                    persistWarehouseValue(warehouseId, warehouseName);
                    setSelectedWarehouseId(warehouseId);
                    setSelectedWarehouseName(warehouseName);
                  }}
                  disabled={visibleWarehouses.length === 0 && activeSiloConfigs.length === 0}
                >
                  {!effectiveSelectedWarehouseId && <option value="">Wybierz hale</option>}
                  {visibleWarehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                  <option value={SILOS_SELECT_VALUE}>Silosy</option>
                </SelectField>
              </div>
              {!isSilosSelected && (
              <>
              <div className="lg:col-span-2">
                <label className="text-xs uppercase tracking-wide text-dim">
                  Wyszukiwarka / nazwa
                </label>
                <div className="relative">
                  <Input
                    ref={nameInputRef}
                    value={form.name}
                    onChange={(event) => {
                      applyNameToForm(event.target.value);
                      setShowNameSuggestions(true);
                    }}
                    placeholder="np. BOREALIS HF700SA"
                    className={form.name ? 'min-h-[46px] pr-10' : 'min-h-[46px]'}
                    onFocus={() => setShowNameSuggestions(true)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || filteredNameSuggestions.length === 0) return;
                      event.preventDefault();
                      applyNameSuggestionToForm(filteredNameSuggestions[0]);
                      setShowNameSuggestions(false);
                    }}
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
                      {filteredNameSuggestions.map((suggestion) => (
                        <button
                          key={`${suggestion.name}|${suggestion.warehouseCode ?? ''}|${suggestion.indexCode ?? ''}`}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyNameSuggestionToForm(suggestion);
                            setShowNameSuggestions(false);
                          }}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]',
                            suggestion.isMag55 && 'bg-[rgba(244,114,182,0.10)] hover:bg-[rgba(244,114,182,0.16)]'
                          )}
                        >
                          <span>{suggestion.name}</span>
                          {suggestion.warehouseCode && (
                            <span
                              className={cn(
                                'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                suggestion.isMag55
                                  ? 'border-[rgba(244,114,182,0.45)] bg-[rgba(244,114,182,0.16)] text-[rgb(251,207,232)]'
                                  : 'border-border bg-surface2 text-dim'
                              )}
                            >
                              {suggestion.warehouseCode}
                            </span>
                          )}
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
                  ref={qtyInputRef}
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
              </>
              )}
            </form>
          </Card>

          {isSilosSelected ? (
            activeSiloConfigs.length === 0 ? (
              <EmptyState
                title="Brak aktywnych silosow"
                description="Admin musi najpierw dodac komory silosow w zarzadzaniu modulem."
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {activeSiloConfigs.map((config) => {
                  const draft = getSiloDraft(config.id);
                  const percent = parseQtyInput(draft.percent);
                  const calculatedQty =
                    percent === null && !draft.hopperPresent
                      ? siloEntryMap.get(config.id)?.calculatedQty ?? 0
                      : Math.round(
                          ((percent ?? 0) * config.percentKg + (draft.hopperPresent ? config.hopperKg : 0)) * 1000
                        ) / 1000;
                  const fillPercent = Math.max(0, Math.min(100, percent ?? 0));
                  return (
                    <Card key={config.id} className="space-y-3 p-3 sm:p-4">
                      <div className="grid gap-3 border-b border-border pb-3 min-[430px]:grid-cols-[minmax(0,1fr)_70px] min-[430px]:items-center">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">Komora</p>
                          <h3 className="mt-0.5 text-xl font-semibold leading-tight text-title">
                            {config.chamber}
                          </h3>
                          <p className="mt-1 break-words text-sm font-semibold leading-snug text-[var(--brand)]">
                            {config.materialName}
                          </p>
                        </div>
                        <div className="mx-auto flex w-[66px] flex-col items-center gap-1">
                          <div className="relative h-[96px] w-[54px]">
                            <div className="absolute left-1/2 top-0 h-[66px] w-[46px] -translate-x-1/2 overflow-hidden rounded-t-md border border-[rgba(180,190,205,0.42)] bg-[linear-gradient(90deg,rgba(210,218,230,0.20),rgba(210,218,230,0.055),rgba(210,218,230,0.16))] shadow-[inset_0_0_12px_rgba(0,0,0,0.42)]">
                              <div
                                className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,#ffbd73,#ff7a1a)] shadow-[0_0_12px_rgba(255,106,0,0.35)] transition-[height] duration-300"
                                style={{ height: `${fillPercent}%` }}
                              />
                              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.12),transparent_34%,transparent_70%,rgba(0,0,0,0.18))]" />
                              <div className="absolute inset-y-0 left-[12px] w-px bg-[rgba(255,255,255,0.08)]" />
                              <div className="absolute inset-y-0 right-[12px] w-px bg-[rgba(0,0,0,0.20)]" />
                            </div>
                            <div className="absolute left-1/2 top-[65px] h-[27px] w-[46px] -translate-x-1/2 overflow-hidden [clip-path:polygon(0_0,100%_0,60%_100%,40%_100%)] border-x border-t border-[rgba(180,190,205,0.42)] bg-[linear-gradient(90deg,rgba(210,218,230,0.18),rgba(210,218,230,0.045),rgba(210,218,230,0.14))] shadow-[inset_0_0_9px_rgba(0,0,0,0.42)]">
                              <div
                                className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,#ffbd73,#ff7a1a)] shadow-[0_0_12px_rgba(255,106,0,0.34)] transition-[height] duration-300"
                                style={{ height: draft.hopperPresent ? '100%' : '0%' }}
                              />
                              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.10),transparent_38%,rgba(0,0,0,0.20))]" />
                            </div>
                            <div className="absolute bottom-[1px] left-1/2 h-2 w-4 -translate-x-1/2 rounded-b-sm border border-[rgba(180,190,205,0.42)] bg-[rgba(210,218,230,0.08)]" />
                          </div>
                          <span className="text-[11px] font-black tabular-nums text-[var(--brand)]">
                            {Math.round(fillPercent)}%
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-2">
                        <div>
                          <label className="text-[11px] uppercase tracking-wide text-dim">
                            Procent w komorze
                          </label>
                          <Input
                            value={draft.percent}
                            onChange={(event) => updateSiloDraft(config.id, { percent: event.target.value })}
                            placeholder="np. 80"
                            inputMode="decimal"
                            max={100}
                            disabled={readOnly}
                            className="min-h-[42px]"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 min-[380px]:gap-2">
                          <div className="flex min-h-[44px] flex-col justify-center rounded-lg border border-[rgba(255,122,26,0.26)] bg-[rgba(255,122,26,0.07)] px-2 py-1.5 text-center">
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-dim">
                              Wychodzi
                            </p>
                            <p className="mt-0.5 text-base font-black leading-none text-[var(--brand)]">
                              {formatQty(calculatedQty)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateSiloDraft(config.id, { hopperPresent: !draft.hopperPresent })}
                            className="flex min-h-[44px] min-w-0 items-center justify-center gap-1 rounded-lg border border-border bg-[rgba(255,255,255,0.025)] px-1 text-[11px] font-semibold text-body min-[380px]:gap-1.5 min-[380px]:text-xs"
                          >
                            <span
                              className={`relative h-6 w-10 shrink-0 rounded-full border transition ${
                                draft.hopperPresent
                                  ? 'border-[rgba(255,122,26,0.95)] bg-[linear-gradient(180deg,rgba(255,186,122,0.55),rgba(255,122,26,0.55))]'
                                  : 'border-[rgba(255,122,26,0.45)] bg-[rgba(10,10,12,0.65)]'
                              }`}
                            >
                              <span
                                className={`absolute top-1 h-4 w-4 rounded-full bg-[rgba(255,255,255,0.9)] shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition ${
                                  draft.hopperPresent ? 'left-[19px] bg-[#FF7A1A]' : 'left-1'
                                }`}
                              />
                            </span>
                            <span className="whitespace-nowrap">Lejek</span>
                          </button>
                          <Button
                            onClick={() => handleSaveSilo(config.id)}
                            disabled={readOnly || saveSiloMutation.isPending}
                            className="min-h-[44px] w-full min-w-0 px-1.5 text-sm min-[380px]:px-2"
                          >
                            Zapisz
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )
          ) : isLoading ? (
            <p className="text-sm text-dim">Wczytywanie...</p>
          ) : (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Spis dnia {spisDate}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void handleExportInventoryByLocation();
                  }}
                  disabled={inventoryExportRows.length === 0}
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  <span>Eksportuj spis do Excel</span>
                </Button>
              </div>
              <DataTable
                columns={['Nazwa', 'Suma', 'ERP rzecz.', 'ERP dysp.', 'Jedn.', 'Hale', 'Kto']}
                rows={materialGroupList.map((group) => {
                  return [
                    <span
                      key={`${group.key}-name`}
                      className="text-sm font-semibold transition"
                      style={{ color: 'var(--brand)' }}
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
                    setQuickWarehouseId(effectiveSelectedWarehouseId || '');
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
                            disabled={visibleWarehouses.length === 0}
                          >
                            {!quickWarehouseId && !effectiveSelectedWarehouseId && (
                              <option value="">Wybierz hale</option>
                            )}
                            {visibleWarehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </SelectField>
                        </div>
                        <div className="flex items-end">
                          <Button type="submit" disabled={addMutation.isPending} className="w-full">
                            Dopisz do materialu
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
                              {visibleWarehouses.map((warehouse) => (
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

        <TabsContent value="kartoteki" className="hidden">
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
                To konto ma tylko podglad. Import kartotek wymaga prawa zapisu w module
                Planowanie zapotrzebowania.
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
                  Import kartotek
                </label>
                <p className="text-xs text-dim">
                  Obslugiwane uklady: `Nazwa | Jedn. | Indeks` albo ERP `Kod | Indeks | Nazwa | Jm`.
                </p>
                <Input
                  key={catalogImportInputKey}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    void handleCatalogFileChange(file);
                  }}
                  disabled={readOnly || catalogImportPreparing || importCatalogMutation.isPending}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={handleCatalogImport}
                  disabled={
                    readOnly ||
                    catalogImportPreparing ||
                    importCatalogMutation.isPending ||
                    catalogImportItems.length === 0
                  }
                >
                  Wgraj kartoteki
                </Button>
                {catalogImportFileName && (
                  <Button variant="outline" onClick={resetCatalogImportState}>
                    Wyczyść
                  </Button>
                )}
              </div>
            </div>
            {catalogImportSummary && (
              <div className="rounded-lg border border-border bg-surface2 p-3 text-sm text-body">
                Plik: <span className="font-semibold">{catalogImportFileName}</span> | odczytano:{' '}
                {catalogImportSummary.parsed} | do dodania: {catalogImportSummary.toImport} |
                pominiete jako juz istniejace: {catalogImportSummary.skipped}
              </div>
            )}
          </Card>
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
                To konto ma tylko podglad. Import kartotek wymaga prawa zapisu w module
                Planowanie zapotrzebowania.
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
                  Import kartotek
                </label>
                <p className="text-xs text-dim">
                  Obslugiwane uklady: `Nazwa | Jedn. | Indeks` albo ERP `Kod | Indeks | Nazwa | Jm`.
                </p>
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
              placeholder="Szukaj po nazwie lub indeksie"
            />
            <DataTable
              columns={['Nazwa', 'Indeks', 'Mag.', 'Jedn.', 'Utworzono']}
              rows={catalogTableRows}
            />
            <div className="flex flex-col gap-2 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
              <span>
                Pokazano {visibleCatalogRows.length} z {filteredCatalog.length} kartotek.
              </span>
              {hasMoreCatalogRows && (
                <Button
                  variant="outline"
                  onClick={() =>
                    setCatalogVisibleCount((count) => count + CATALOG_TABLE_INCREMENT)
                  }
                >
                  Pokaz kolejne
                </Button>
              )}
            </div>
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
                To konto ma tylko podglad. Import stanow ERP wymaga prawa zapisu w module
                Planowanie zapotrzebowania.
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
                    {erpSnapshotImportSummary.parsed === null
                      ? `PDF gotowy do importu. Aktualnie zapisane dla dnia ${spisDate}: ${erpSnapshotImportSummary.currentRows}.`
                      : `W pliku: ${erpSnapshotImportSummary.parsed}. Aktualnie zapisane dla dnia ${spisDate}: ${erpSnapshotImportSummary.currentRows}.`}
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
                      {reportSuggestions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setReportQuery(option.name);
                            setShowReportSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <span>{option.name}</span>
                          {(option.indexCodes.length > 0 || option.warehouseCodes.length > 0) && (
                            <span className="shrink-0 text-xs text-dim">
                              {[...option.indexCodes.slice(0, 2), ...option.warehouseCodes.slice(0, 2)].join(' / ')}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {selectedReportMaterialKey && (
              selectedReportTableRows.length > 0 ? (
                <div className="[&_tbody]:font-semibold [&_tbody_td:first-child]:font-bold">
                  <DataTable
                    columns={reportColumns}
                    rows={selectedReportTableRows}
                    onRowClick={(rowIndex) => openGrindDialog(selectedReportRows[rowIndex])}
                    getRowClassName={(rowIndex) => getReportRowClassName(selectedReportRows[rowIndex])}
                  />
                </div>
              ) : (
                <p className="text-sm text-dim">Brak tej pozycji w raporcie dla wybranego dnia.</p>
              )
            )}
          </Card>
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Raport kontroli rozjazdów
            </p>
            <p className="text-sm text-dim">
              Raport obejmuje tylko pozycje spisane w wybranym dniu i pokazuje rozjazd na tle 4 poprzednich dni.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Toggle
                checked={reportQuantityMode === 'real'}
                onCheckedChange={handleReportRealQtyToggle}
                label="Pokaz stan rzeczywisty"
              />
              <Toggle
                checked={reportQuantityMode === 'available'}
                onCheckedChange={handleReportAvailableQtyToggle}
                label="Pokaz stan do dyspozycji"
              />
              <Toggle
                checked={showReportUncountedItems}
                onCheckedChange={setShowReportUncountedItems}
                label="Pokaz pozycje nie spisane"
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
              <div className="md:col-span-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={handleExportDaily}
                  disabled={reportRowsForExport.length === 0 || isHistoricalErpSnapshotFetching}
                  className={reportExportButtonClassName}
                >
                  <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                  <span>Eksportuj do Excel</span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void toggleReportFullscreen();
                  }}
                  disabled={reportRows.length === 0}
                  className={reportFullscreenButtonClassName}
                >
                  {isReportFullscreenActive ? (
                    <Minimize2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{isReportFullscreenActive ? 'Wroc do normalnego widoku' : 'Pelny ekran tabeli'}</span>
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
                  row.unit
                ])}
                  />
                )}
                <div
                  ref={reportFullscreenRef}
                  className={cn(
                    'space-y-3 [&_tbody]:font-semibold [&_tbody_td:first-child]:font-bold',
                    isReportFullscreenActive && 'bg-[var(--bg-0)] p-4 md:p-5',
                    isReportFullscreen && 'h-screen overflow-auto',
                    isReportFullscreenFallback && 'fixed inset-0 z-50 overflow-auto'
                  )}
                >
                  {isReportFullscreenActive && (
                    <div className="flex justify-end">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          void toggleReportFullscreen();
                        }}
                        className={reportFullscreenButtonClassName}
                      >
                        <Minimize2 className="h-4 w-4" aria-hidden="true" />
                        <span>Wroc do normalnego widoku</span>
                      </Button>
                    </div>
                  )}
                  <DataTable
                    columns={reportColumns}
                    rows={reportTableRows}
                    onRowClick={(rowIndex) => openGrindDialog(reportRows[rowIndex])}
                    getRowClassName={(rowIndex) => getReportRowClassName(reportRows[rowIndex])}
                    stickyHeader
                    desktopMaxHeightClassName={isReportFullscreenActive ? 'max-h-[calc(100vh-104px)]' : 'max-h-[82vh]'}
                  />
                  {isReportFullscreenActive && grindDialogMaterial && (
                    <div className="fixed inset-0 z-50">
                      <div className="absolute inset-0 bg-[var(--scrim)]" onClick={closeGrindDialog} />
                      <div className="fixed left-1/2 top-1/2 z-10 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgba(255,122,26,0.35)] bg-[var(--surface-1)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55),inset_0_1px_0_var(--inner-highlight)]">
                        <button
                          type="button"
                          onClick={closeGrindDialog}
                          className="absolute right-4 top-4 text-dim hover:text-title"
                          aria-label="Zamknij"
                        >
                          X
                        </button>
                        <div className="space-y-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                              Dodaj do zmielenia
                            </p>
                            <h3 className="mt-1 break-words text-lg font-black text-title">
                              {grindDialogMaterial.name}
                            </h3>
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wide text-dim">
                              Ile kg do wpisania
                            </label>
                            <Input
                              value={grindQty}
                              onChange={(event) => setGrindQty(event.target.value)}
                              inputMode="decimal"
                              placeholder="np. 20"
                              className="mt-1 min-h-[54px] text-xl font-black"
                              aria-invalid={Boolean(grindQtyLimitMessage)}
                              autoFocus
                            />
                            {grindQtyLimitMessage && (
                              <p className="mt-2 rounded-lg bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm font-semibold text-red-300">
                                {grindQtyLimitMessage}
                              </p>
                            )}
                            <Button
                              type="button"
                              onClick={() => {
                                if (
                                  grindDialogMaterial.availableQty === null ||
                                  grindDialogMaterial.availableQty <= 0
                                ) {
                                  toast({ title: 'Brak stanu do dyspozycji dla tej pozycji.', tone: 'error' });
                                  return;
                                }
                                setGrindQty(formatQty(grindDialogMaterial.availableQty));
                              }}
                              disabled={
                                grindDialogMaterial.availableQty === null ||
                                grindDialogMaterial.availableQty <= 0
                              }
                              className="mt-3 flex min-h-[54px] w-full items-center justify-between gap-3 rounded-xl border border-[rgba(255,122,26,0.58)] bg-[linear-gradient(135deg,rgba(255,122,26,0.22),rgba(255,122,26,0.06)_48%,rgba(0,0,0,0.24))] px-4 text-left shadow-[0_0_24px_rgba(255,122,26,0.12),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-[rgba(255,122,26,0.88)] hover:bg-[linear-gradient(135deg,rgba(255,122,26,0.30),rgba(255,122,26,0.08)_48%,rgba(0,0,0,0.24))] disabled:opacity-45"
                            >
                              <span>
                                <span className="block text-[10px] font-black uppercase tracking-wide text-brand">
                                  Szybkie uzupelnienie
                                </span>
                                <span className="block text-sm font-black text-title">
                                  Dodaj caly stan do dyspozycji
                                </span>
                              </span>
                              <span className="shrink-0 rounded-lg border border-[rgba(255,122,26,0.45)] bg-[rgba(255,122,26,0.16)] px-3 py-2 text-base font-black text-brand">
                                {grindDialogMaterial.availableQty !== null
                                  ? `${formatQty(grindDialogMaterial.availableQty)} ${grindDialogMaterial.unit}`
                                  : '-'}
                              </span>
                            </Button>
                          </div>
                          <div>
                            <label className="text-xs uppercase tracking-wide text-dim">
                              Na jaka kartoteke zmielic
                            </label>
                            <div className="relative mt-1">
                              <Input
                                value={grindTargetMaterial}
                                onChange={(event) => {
                                  setGrindTargetMaterial(event.target.value);
                                  setShowGrindTargetSuggestions(true);
                                }}
                                onFocus={() => setShowGrindTargetSuggestions(true)}
                                onBlur={() => {
                                  setTimeout(() => setShowGrindTargetSuggestions(false), 120);
                                }}
                                placeholder="np. PRZEMIAL PP MIX"
                                className="min-h-[54px] font-semibold"
                              />
                              {showGrindTargetSuggestions && grindTargetSuggestions.length > 0 && (
                                <div className="absolute z-30 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
                                  {grindTargetSuggestions.map((option) => (
                                    <button
                                      key={option}
                                      type="button"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        setGrindTargetMaterial(option);
                                        setShowGrindTargetSuggestions(false);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-sm font-semibold text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                                    >
                                      {option}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <Button variant="outline" onClick={closeGrindDialog}>
                              Anuluj
                            </Button>
                            <Button
                              onClick={handleAddGrindTask}
                              disabled={readOnly || addGrindTaskMutation.isPending}
                            >
                              Zatwierdz
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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
                <div className="[&_tbody]:font-semibold [&_tbody_td:first-child]:font-bold">
                  <DataTable
                    columns={dailyComparisonColumns}
                    rows={dailyComparisonRows}
                    stickyHeader
                    desktopMaxHeightClassName="max-h-[82vh]"
                  />
                </div>
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

        <TabsContent value="do-zmielenia" className="space-y-4">
          <div className="space-y-4 rounded-2xl bg-white/[0.025] p-1 sm:p-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Do zmielenia
                </p>
                <p className="text-sm text-dim">
                  Prosta lista pozycji dodanych z raportu.
                </p>
              </div>
              <div className="rounded-lg bg-white/6 px-3 py-1.5 text-sm font-semibold text-title">
                Aktywne dokumenty: {pendingGrindDocuments.length}
              </div>
            </div>

            {pendingGrindDocuments.length === 0 ? (
              <p className="rounded-xl bg-white/5 p-4 text-sm text-dim">
                Brak pozycji do zmielenia.
              </p>
            ) : (
              <div className="space-y-3">
                {pendingGrindDocuments.map((document, index) => (
                  <div
                    key={document.key}
                    className="rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(0,0,0,0.48))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  >
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_150px] md:items-center">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                          Dokument #{index + 1}
                        </p>
                        <h3 className="mt-1 break-words text-lg font-black text-brand">
                          {document.targetMaterialName}
                        </h3>
                        <p className="mt-1 text-xs text-dim">
                          {document.tasks.length} poz. | limit dokumentu 500 kg
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
                          Suma
                        </p>
                        <p className="text-2xl font-black text-title">
                          {formatQty(document.totalQty)} kg
                        </p>
                      </div>
                      <Button
                        onClick={() =>
                          completeGrindDocumentMutation.mutate(document.tasks.map((task) => task.id))
                        }
                        disabled={readOnly || completeGrindDocumentMutation.isPending}
                        className="w-full bg-[var(--success)] text-bg hover:bg-[var(--success)]"
                      >
                        Zmielone
                      </Button>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-xl border border-border">
                      {document.tasks.map((task) => (
                        <div
                          key={task.id}
                          className="grid gap-2 border-t border-border px-3 py-2 first:border-t-0 md:grid-cols-[minmax(0,1fr)_120px]"
                        >
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-title">
                              {task.materialName}
                            </p>
                            <p className="text-xs text-dim">
                              Dodal: {task.createdBy}
                            </p>
                          </div>
                          <p className="font-black text-brand md:text-right">
                            {formatQty(task.qty)} {task.unit}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {doneGrindDocuments.length > 0 && (
            <div className="space-y-3 rounded-2xl bg-white/[0.025] p-1 sm:p-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Zmielone
              </p>
              <div className="space-y-2">
                {doneGrindDocuments.slice(0, 30).map((document) => (
                  <div
                    key={document.key}
                    className="rounded-xl border border-[rgba(34,197,94,0.22)] bg-[rgba(34,197,94,0.08)] p-3 text-sm"
                  >
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_170px_170px] md:items-center">
                      <div>
                        <p className="font-black text-success">{document.targetMaterialName}</p>
                        <p className="text-xs text-dim">
                          Zmielone:{' '}
                          {document.completedAt
                            ? new Date(document.completedAt).toLocaleString('pl-PL')
                            : 'brak daty'}{' '}
                          przez {document.completedBy ?? 'nieznany'}
                        </p>
                      </div>
                      <p className="font-black text-success md:text-right">
                        {formatQty(document.totalQty)} kg
                      </p>
                      <Button
                        variant="outline"
                        onClick={() =>
                          reopenGrindDocumentMutation.mutate(document.tasks.map((task) => task.id))
                        }
                        disabled={readOnly || reopenGrindDocumentMutation.isPending}
                        className="w-full border-[rgba(255,122,26,0.55)] text-title"
                      >
                        Cofnij do edycji
                      </Button>
                    </div>
                    <div className="mt-3 space-y-1 border-t border-[rgba(34,197,94,0.18)] pt-3">
                      {document.tasks.map((task) => (
                        <div
                          key={task.id}
                          className="grid gap-1 text-xs md:grid-cols-[minmax(0,1fr)_100px]"
                        >
                          <span className="break-words text-title">{task.materialName}</span>
                          <span className="font-semibold text-success md:text-right">
                            {formatQty(task.qty)} {task.unit}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {!isReportFullscreenActive && grindDialogMaterial && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[var(--scrim)]" onClick={closeGrindDialog} />
          <div className="fixed left-1/2 top-[84dvh] z-10 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[rgba(255,122,26,0.35)] bg-[var(--surface-1)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.55),inset_0_1px_0_var(--inner-highlight)]">
            <button
              type="button"
              onClick={closeGrindDialog}
              className="absolute right-4 top-4 text-dim hover:text-title"
              aria-label="Zamknij"
            >
              X
            </button>
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Dodaj do zmielenia
                </p>
                <h3 className="mt-1 break-words text-lg font-black text-title">
                  {grindDialogMaterial.name}
                </h3>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">
                  Ile kg do wpisania
                </label>
                <Input
                  value={grindQty}
                  onChange={(event) => setGrindQty(event.target.value)}
                  inputMode="decimal"
                  placeholder="np. 20"
                  className="mt-1 min-h-[54px] text-xl font-black"
                  aria-invalid={Boolean(grindQtyLimitMessage)}
                  autoFocus
                />
                {grindQtyLimitMessage && (
                  <p className="mt-2 rounded-lg bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm font-semibold text-red-300">
                    {grindQtyLimitMessage}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => {
                    if (
                      grindDialogMaterial.availableQty === null ||
                      grindDialogMaterial.availableQty <= 0
                    ) {
                      toast({ title: 'Brak stanu do dyspozycji dla tej pozycji.', tone: 'error' });
                      return;
                    }
                    setGrindQty(formatQty(grindDialogMaterial.availableQty));
                  }}
                  disabled={
                    grindDialogMaterial.availableQty === null ||
                    grindDialogMaterial.availableQty <= 0
                  }
                  className="mt-3 flex min-h-[54px] w-full items-center justify-between gap-3 rounded-xl border border-[rgba(255,122,26,0.58)] bg-[linear-gradient(135deg,rgba(255,122,26,0.22),rgba(255,122,26,0.06)_48%,rgba(0,0,0,0.24))] px-4 text-left shadow-[0_0_24px_rgba(255,122,26,0.12),inset_0_1px_0_rgba(255,255,255,0.08)] transition hover:border-[rgba(255,122,26,0.88)] hover:bg-[linear-gradient(135deg,rgba(255,122,26,0.30),rgba(255,122,26,0.08)_48%,rgba(0,0,0,0.24))] disabled:opacity-45"
                >
                  <span>
                    <span className="block text-[10px] font-black uppercase tracking-wide text-brand">
                      Szybkie uzupelnienie
                    </span>
                    <span className="block text-sm font-black text-title">
                      Dodaj caly stan do dyspozycji
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg border border-[rgba(255,122,26,0.45)] bg-[rgba(255,122,26,0.16)] px-3 py-2 text-base font-black text-brand">
                    {grindDialogMaterial.availableQty !== null
                      ? `${formatQty(grindDialogMaterial.availableQty)} ${grindDialogMaterial.unit}`
                      : '-'}
                  </span>
                </Button>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">
                  Na jaka kartoteke zmielic
                </label>
                <div className="relative mt-1">
                  <Input
                    value={grindTargetMaterial}
                    onChange={(event) => {
                      setGrindTargetMaterial(event.target.value);
                      setShowGrindTargetSuggestions(true);
                    }}
                    onFocus={() => setShowGrindTargetSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowGrindTargetSuggestions(false), 120);
                    }}
                    placeholder="np. PRZEMIAL PP MIX"
                    className="min-h-[54px] font-semibold"
                  />
                  {showGrindTargetSuggestions && grindTargetSuggestions.length > 0 && (
                    <div className="absolute z-30 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.45)]">
                      {grindTargetSuggestions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setGrindTargetMaterial(option);
                            setShowGrindTargetSuggestions(false);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm font-semibold text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={closeGrindDialog}>
                  Anuluj
                </Button>
                <Button
                  onClick={handleAddGrindTask}
                  disabled={readOnly || addGrindTaskMutation.isPending}
                >
                  Zatwierdz
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
