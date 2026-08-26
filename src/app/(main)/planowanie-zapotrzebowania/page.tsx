'use client';

import { createContext, forwardRef, Fragment, useContext, useDeferredValue, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  FileDown,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input as BaseInput } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import SpisRzeczywisty from '@/components/planowanie-zapotrzebowania/SpisRzeczywisty';
import { isReadOnly } from '@/lib/auth/access';
import { useUiStore } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';

type View =
  | 'plan'
  | 'technologie'
  | 'spis'
  | 'obliczenia'
  | 'dokument'
  | 'zwroty'
  | 'historia'
  | 'ustawienia'
  | 'instrukcja';

type MaterialCategory =
  | 'Tworzywo'
  | 'Barwnik'
  | 'Półwyrób'
  | 'Element montażowy'
  | 'Karton'
  | 'Przekładka'
  | 'Opakowanie'
  | 'Pozostałe';

type TechnologyMaterial = {
  id: string;
  code: string;
  name: string;
  category: MaterialCategory;
  usage: number;
  unit: string;
  logisticQty: number;
};

type Technology = {
  id: string;
  productIndex: string;
  productName: string;
  variant: 'base' | 'alternative';
  alternativeNo: number;
  description: string;
  notes: string;
  shiftNorm: number;
  materials: TechnologyMaterial[];
  archived: boolean;
};

type PlanGroup = 'standard' | 'emergency' | 'planned';

type PlanItem = {
  id: string;
  runId: string;
  index: string;
  name: string;
  station: string;
  areaId: string;
  totalQty: number;
  remainingQty: number;
  shiftNorm: number;
  notes: string;
  included: boolean;
  technologyId: string;
  workingMaterials: TechnologyMaterial[] | null;
  manualOverride: boolean;
  continuationCandidateId: string;
  planGroup?: PlanGroup;
  plannedDate?: string;
};

type InventoryItem = {
  id: string;
  areaId: string;
  code: string;
  name: string;
  category: MaterialCategory;
  qty: number;
  unit: string;
};

type ProductionArchive = {
  id: string;
  status: 'suspended' | 'completed';
  planItem: PlanItem;
  technologyName: string;
  materials: TechnologyMaterial[];
  at: string;
  reason: string;
};

type Area = { id: string; name: string; shared?: boolean };
type StationMapping = { station: string; areaId: string };

type AppState = {
  version: number;
  planName: string;
  planSheet: string;
  planImportedAt: string;
  inventorySourceDate: string;
  inventorySyncedAt: string;
  horizonShifts: number;
  calculationMode: 'horizon' | 'all';
  selectedAreaId: string;
  areas: Area[];
  stationMappings: StationMapping[];
  technologies: Technology[];
  plan: PlanItem[];
  inventory: InventoryItem[];
  pickingDone: Record<string, boolean>;
  archive: ProductionArchive[];
  updatedAt: string;
};

type Requirement = {
  key: string;
  code: string;
  name: string;
  category: MaterialCategory;
  unit: string;
  demand: number;
  areaStock: number;
  sharedStock: number;
  toIssue: number;
  globalSharedDemand: number;
  globalSharedShortage: number;
};

type PendingWorkbook = { workbook: XLSX.WorkBook; fileName: string; purpose: 'plan' | 'inventory' };
type ProductCatalogItem = { id: string; index: string; name: string; warehouseCode?: string; unit?: string };
type CalculationSimulation = { mode: 'shifts' | 'quantity' | 'all'; shifts: number; quantity: number };

const LOCAL_KEY = 'apka-kamila-planowanie-zapotrzebowania-v1';
const CATEGORIES: MaterialCategory[] = [
  'Tworzywo',
  'Barwnik',
  'Półwyrób',
  'Element montażowy',
  'Karton',
  'Przekładka',
  'Opakowanie',
  'Pozostałe'
];
const CATEGORY_ORDER = new Map(CATEGORIES.map((item, index) => [item, index]));
const MATERIAL_WAREHOUSE_PRIORITY = ['M-1', 'M-4', 'M-10', 'M-11', 'M-51'] as const;
const MATERIAL_WAREHOUSE_RANK = new Map<string, number>(
  MATERIAL_WAREHOUSE_PRIORITY.map((warehouseCode, index) => [warehouseCode, index])
);

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const numberValue = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const planQuantity = (value: unknown) => {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const parts = /,\s+|\s*\+\s*/.test(text) ? text.split(/,\s+|\s*\+\s*/).filter((part) => /\d/.test(part)) : [];
  return parts.length > 1 ? parts.reduce((sum, part) => sum + numberValue(part), 0) : numberValue(text);
};
const normalize = (value: unknown) =>
  String(value ?? '')
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('ł', 'l')
    .trim();
const splitProductFields = (name: unknown, index: unknown) => {
  let cleanName = String(name ?? '').replace(/\s+/g, ' ').trim();
  let cleanIndex = String(index ?? '').replace(/\s+/g, ' ').trim();
  const splitComposite = (value: string) => {
    const match = value.match(/^(.*?)\s*\(([^()]*\d[^()]*)\)\s*$/);
    return match ? { name: match[1].trim(), index: match[2].trim() } : null;
  };
  const fromName = splitComposite(cleanName);
  const fromIndex = splitComposite(cleanIndex);

  if (fromName && (!cleanIndex || normalize(cleanIndex) === normalize(cleanName) || normalize(cleanIndex) === normalize(fromName.index))) {
    cleanName = fromName.name;
    cleanIndex = fromName.index;
  } else if (fromIndex && (!cleanName || normalize(cleanName) === normalize(cleanIndex) || normalize(cleanName) === normalize(fromIndex.name))) {
    cleanName = fromIndex.name;
    cleanIndex = fromIndex.index;
  }

  return { name: cleanName || cleanIndex, index: cleanIndex || cleanName };
};
const stationKey = (value: unknown) => normalize(value).replace(/[\s_-]+/g, '');
const applyStationMappings = (plan: PlanItem[], mappings: StationMapping[]) => {
  const areaByStation = new Map(
    mappings
      .map((mapping) => [stationKey(mapping.station), mapping.areaId] as const)
      .filter(([station, areaId]) => Boolean(station && areaId))
  );
  return plan.map((item) => ({ ...item, areaId: areaByStation.get(stationKey(item.station)) ?? '' }));
};
const materialKey = (item: Pick<TechnologyMaterial, 'code' | 'name' | 'unit'>) =>
  `${normalize(item.code || item.name)}|${normalize(item.unit)}`;
const materialMatches = (
  material: Pick<TechnologyMaterial, 'code' | 'name' | 'unit'>,
  stock: Pick<TechnologyMaterial, 'code' | 'name' | 'unit'>
) => {
  const sameIdentity = Boolean(
    (normalize(material.code) && normalize(material.code) === normalize(stock.code)) ||
    (normalize(material.name) && normalize(material.name) === normalize(stock.name))
  );
  return sameIdentity && normalize(material.unit) === normalize(stock.unit);
};
const fmt = (value: number) => value.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
const nowLabel = () => new Date().toLocaleString('pl-PL');
const localDateKey = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const cloneMaterials = (items: TechnologyMaterial[]) => items.map((item) => ({ ...item, id: uid('mat') }));

const applyDefaultTechnologyAssignments = (plan: PlanItem[], technologies: Technology[]) => plan.map((item) => {
  if (item.technologyId || item.continuationCandidateId) return item;
  const variants = technologies.filter((technology) => !technology.archived && (
    normalize(technology.productIndex) === normalize(item.index) ||
    normalize(technology.productName) === normalize(item.name)
  ));
  const technology = variants.find((variant) => variant.variant === 'base') ?? (variants.length === 1 ? variants[0] : undefined);
  if (!technology) return item;
  return {
    ...item,
    technologyId: technology.id,
    shiftNorm: technology.shiftNorm || item.shiftNorm,
    workingMaterials: cloneMaterials(technology.materials),
    manualOverride: false
  };
});

const inferCategory = (category: unknown, name: unknown, code: unknown): MaterialCategory => {
  const source = normalize(`${category ?? ''} ${name ?? ''} ${code ?? ''}`);
  if (/barwn|koncentrat|masterbatch|plastoperm|plastomix|renol/.test(source)) return 'Barwnik';
  if (/karton/.test(source)) return 'Karton';
  if (/przeklad/.test(source)) return 'Przekładka';
  if (/polwyrob/.test(source)) return 'Półwyrób';
  if (/wkret|srub|montaz|zatrzask|os |kolo/.test(source)) return 'Element montażowy';
  if (/opakowan|etykiet|folia|worek/.test(source)) return 'Opakowanie';
  if (/tworzyw|granulat|regranulat|hostacom|(?:^|[-_\s])tw(?:$|[-_\s])|\bpp\b|\babs\b|\basa\b|\bpmma\b|\btpe\b|\bpom\b/.test(source)) return 'Tworzywo';
  return CATEGORIES.includes(category as MaterialCategory) ? category as MaterialCategory : 'Pozostałe';
};

const catalogMaterialPatch = (material: TechnologyMaterial, item: ProductCatalogItem): Partial<TechnologyMaterial> => ({
  code: item.index || material.code,
  name: item.name || material.name,
  unit: item.unit || material.unit,
  category: inferCategory(material.category, item.name, `${item.index} ${item.warehouseCode ?? ''}`)
});

const baseAreas: Area[] = [
  { id: 'hala-1', name: 'Hala 1' },
  { id: 'hala-2', name: 'Hala 2' },
  { id: 'bakoma', name: 'Bakoma' },
  { id: 'lakiernia', name: 'Lakiernia' },
  { id: 'narzedziownia', name: 'Narzędziownia' },
  { id: 'silosy', name: 'Silosy', shared: true }
];

const mergeAreas = (storedAreas: Area[]) => {
  const baseIds = new Set(baseAreas.map((area) => area.id));
  return [
    ...baseAreas.map((baseArea) => ({
      ...baseArea,
      ...storedAreas.find((area) => area.id === baseArea.id)
    })),
    ...storedAreas.filter((area) => !baseIds.has(area.id))
  ];
};

const demoMaterials = (): TechnologyMaterial[] => [
  { id: uid('mat'), code: 'PPGF35GR', name: 'Hostacom PPR 1042', category: 'Tworzywo', usage: 0.118, unit: 'kg', logisticQty: 1000 },
  { id: uid('mat'), code: 'BAR-QL-GR', name: 'Koncentrat grafitowy QUICK LIFT', category: 'Barwnik', usage: 0.002, unit: 'kg', logisticQty: 25 },
  { id: uid('mat'), code: 'SNAP-QL-01', name: 'Element zatrzaskowy NEW SNAP', category: 'Element montażowy', usage: 1, unit: 'szt.', logisticQty: 1000 },
  { id: uid('mat'), code: 'KOL-QL-01', name: 'Koło QUICK LIFT', category: 'Półwyrób', usage: 1, unit: 'szt.', logisticQty: 600 },
  { id: uid('mat'), code: 'OS-QL-01', name: 'Oś QUICK LIFT', category: 'Element montażowy', usage: 1, unit: 'szt.', logisticQty: 1500 },
  { id: uid('mat'), code: 'ETY-QL-01', name: 'Etykieta identyfikacyjna LEFT / RIGHT', category: 'Opakowanie', usage: 0.025, unit: 'szt.', logisticQty: 1000 },
  { id: uid('mat'), code: 'KAR-QL-01', name: 'Karton QUICK LIFT standard', category: 'Karton', usage: 0.025, unit: 'szt.', logisticQty: 160 },
  { id: uid('mat'), code: 'PRZ-QL-01', name: 'Przekładka QUICK LIFT standard', category: 'Przekładka', usage: 0.025, unit: 'szt.', logisticQty: 500 }
];

const demoState = (): AppState => {
  const baseTechId = uid('tech');
  const altTechId = uid('tech');
  return {
    version: 1,
    planName: 'Plan demonstracyjny',
    planSheet: 'DEMO',
    planImportedAt: nowLabel(),
    inventorySourceDate: '',
    inventorySyncedAt: '',
    horizonShifts: 3.5,
    calculationMode: 'horizon',
    selectedAreaId: 'hala-1',
    areas: baseAreas,
    stationMappings: [
      ...Array.from({ length: 28 }, (_, index) => ({ station: `WTR ${index + 1}`, areaId: 'hala-1' })),
      ...Array.from({ length: 24 }, (_, index) => ({ station: `WTR ${index + 29}`, areaId: 'hala-2' })),
      { station: 'BAKOMA', areaId: 'bakoma' },
      { station: 'LAKIERNIA', areaId: 'lakiernia' }
    ],
    technologies: [
      {
        id: baseTechId,
        productIndex: 'A18192707',
        productName: 'NEL QUICK LIFT LEFT NEW SNAP',
        variant: 'base',
        alternativeNo: 0,
        description: 'Pakowanie w karton standard, 40 szt. w kartonie',
        notes: '',
        shiftNorm: 1400,
        materials: demoMaterials(),
        archived: false
      },
      {
        id: altTechId,
        productIndex: 'A18192707',
        productName: 'NEL QUICK LIFT LEFT NEW SNAP',
        variant: 'alternative',
        alternativeNo: 1,
        description: 'Pakowanie zastępcze — karton rozmiar 5',
        notes: '',
        shiftNorm: 1320,
        materials: demoMaterials().map((item) => item.category === 'Karton'
          ? { ...item, code: 'KAR-QL-05', name: 'Karton rozmiar 5', logisticQty: 120 }
          : item),
        archived: false
      }
    ],
    plan: [
      {
        id: uid('plan'), runId: uid('run'), index: 'A18192707', name: 'NEL QUICK LIFT LEFT NEW SNAP', station: 'WTR 15', areaId: 'hala-1',
        totalQty: 28000, remainingQty: 28000, shiftNorm: 1400, notes: '', included: true, technologyId: '', workingMaterials: null,
        manualOverride: false, continuationCandidateId: ''
      },
      {
        id: uid('plan'), runId: uid('run'), index: '8001130395', name: 'DISPLAY WINDOW-VG1 BO', station: 'WTR 20', areaId: 'hala-1',
        totalQty: 8180, remainingQty: 8180, shiftNorm: 1400, notes: '', included: true, technologyId: '', workingMaterials: null,
        manualOverride: false, continuationCandidateId: ''
      },
      {
        id: uid('plan'), runId: uid('run'), index: '01718-2', name: 'ODWODNIENIE KOMPLET Z KRATĄ PP A15 CZARNA', station: '', areaId: '',
        totalQty: 300, remainingQty: 300, shiftNorm: 180, notes: '', included: true, technologyId: '', workingMaterials: null,
        manualOverride: false, continuationCandidateId: ''
      }
    ],
    inventory: [
      { id: uid('inv'), areaId: 'hala-1', code: 'PPGF35GR', name: 'Hostacom PPR 1042', category: 'Tworzywo', qty: 120, unit: 'kg' },
      { id: uid('inv'), areaId: 'silosy', code: 'PPGF35GR', name: 'Hostacom PPR 1042', category: 'Tworzywo', qty: 6000, unit: 'kg' },
      { id: uid('inv'), areaId: 'hala-1', code: 'STARY-KAR', name: 'Karton nieużywany', category: 'Karton', qty: 40, unit: 'szt.' }
    ],
    pickingDone: {},
    archive: [],
    updatedAt: nowLabel()
  };
};

const emptyState = (): AppState => ({
  ...demoState(),
  planName: '', planSheet: '', planImportedAt: '', inventorySourceDate: '', inventorySyncedAt: '', technologies: [], plan: [], inventory: [], pickingDone: {}, archive: []
});

const parseStoredState = (value: unknown): AppState | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AppState>;
  if (!Array.isArray(record.plan) || !Array.isArray(record.technologies)) return null;
  const stationMappings = Array.isArray(record.stationMappings) ? record.stationMappings : [];
  const storedAreas = Array.isArray(record.areas) ? record.areas : [];
  const cleanPlanItem = (item: PlanItem): PlanItem => {
    const product = splitProductFields(item.name, item.index);
    return { ...item, name: product.name, index: product.index, planGroup: item.planGroup ?? 'standard', plannedDate: item.plannedDate ?? '' };
  };
  const plan = applyStationMappings(record.plan.map(cleanPlanItem), stationMappings);
  const technologies = record.technologies.map((technology) => {
    const product = splitProductFields(technology.productName, technology.productIndex);
    const normalizedTechnology = { ...technology, productName: product.name, productIndex: product.index };
    if (numberValue(normalizedTechnology.shiftNorm) > 0) return normalizedTechnology;
    const matchingPlanItem = plan.find((item) =>
      item.shiftNorm > 0 &&
      ((normalizedTechnology.productIndex && normalize(item.index) === normalize(normalizedTechnology.productIndex)) ||
        (normalizedTechnology.productName && normalize(item.name) === normalize(normalizedTechnology.productName)))
    );
    return matchingPlanItem
      ? { ...normalizedTechnology, shiftNorm: matchingPlanItem.shiftNorm }
      : normalizedTechnology;
  });
  return {
    ...emptyState(),
    ...record,
    calculationMode: 'horizon',
    areas: mergeAreas(storedAreas),
    stationMappings,
    technologies,
    plan,
    inventory: Array.isArray(record.inventory) ? record.inventory : [],
    archive: Array.isArray(record.archive) ? record.archive.map((entry) => ({ ...entry, planItem: cleanPlanItem(entry.planItem) })) : [],
    pickingDone: record.pickingDone && typeof record.pickingDone === 'object' ? record.pickingDone : {}
  };
};

const technologyLabel = (technology: Technology) =>
  technology.variant === 'base' ? 'Bazowa' : `Alternatywna ${technology.alternativeNo}`;

const planItemSignature = (item: Pick<PlanItem, 'index' | 'station' | 'planGroup' | 'plannedDate'>) =>
  `${item.planGroup ?? 'standard'}|${normalize(item.plannedDate)}|${normalize(item.index)}|${normalize(item.station)}`;

const parsePlanRows = (rows: unknown[][], mappings: StationMapping[]): PlanItem[] => {
  const result: PlanItem[] = [];
  const normalized = rows.map((row) => row.map(normalize));
  let sequence = 1;
  const makeItem = (
    name: unknown,
    index: unknown,
    station: unknown,
    qty: unknown,
    norm: unknown,
    notes = '',
    planGroup: PlanGroup = 'standard',
    plannedDate = ''
  ) => {
    const product = splitProductFields(name, index);
    const cleanName = product.name;
    const cleanIndex = product.index;
    const cleanStation = String(station ?? '').trim();
    const totalQty = planQuantity(qty);
    if (!cleanName || totalQty <= 0) return;
    const mapping = mappings.find((item) => stationKey(item.station) === stationKey(cleanStation));
    result.push({
      id: `plan-${Date.now().toString(36)}-${sequence++}`,
      runId: uid('run'), index: cleanIndex, name: cleanName, station: cleanStation, areaId: mapping?.areaId ?? '',
      totalQty, remainingQty: totalQty, shiftNorm: numberValue(norm), notes, included: planGroup !== 'planned',
      technologyId: '', workingMaterials: null, manualOverride: false, continuationCandidateId: '', planGroup, plannedDate
    });
  };

  const scheduleHeader = normalized.findIndex((row) =>
    row.some((cell) => cell.includes('ilosc'))
    && row.some((cell) => cell.includes('norma'))
  );
  if (scheduleHeader >= 0) {
    const headers = normalized[scheduleHeader];
    const qtyColumn = headers.findIndex((cell) => cell.includes('ilosc'));
    const normColumn = headers.findIndex((cell) => cell.includes('norma'));
    const stationColumn = headers.findIndex((cell) => cell === 'st' || /stanowisko|maszyna|wtryskarka|stol/.test(cell));
    const notesColumn = headers.findIndex((cell) => cell.includes('uwagi'));
    const nameColumn = qtyColumn > 0 ? qtyColumn - 1 : 1;
    let planGroup: PlanGroup = 'standard';
    let currentStation = '';
    let currentNorm = 0;
    let currentNotes = '';
    let lastPlannedDate = '';

    rows.slice(scheduleHeader + 1).forEach((row) => {
      const detail = String(row[nameColumn] ?? '').replace(/\s+/g, ' ').trim();
      const sectionLabel = normalize(detail);
      if (sectionLabel === 'awaryjnie') {
        planGroup = 'emergency';
        currentStation = '';
        currentNorm = 0;
        currentNotes = '';
        return;
      }
      if (sectionLabel === 'narzedziownia' || sectionLabel === 'lakiernia') {
        planGroup = 'standard';
        currentStation = '';
        currentNorm = 0;
        currentNotes = '';
        return;
      }
      if (sectionLabel.includes('planowane zmiany form')) {
        planGroup = 'planned';
        currentStation = '';
        currentNorm = 0;
        currentNotes = '';
        lastPlannedDate = '';
        return;
      }

      const explicitStation = String(row[stationColumn >= 0 ? stationColumn : 3] ?? '').trim();
      const quantity = row[qtyColumn];
      const explicitNorm = numberValue(row[normColumn >= 0 ? normColumn : 4]);
      const notes = String(row[notesColumn >= 0 ? notesColumn : 6] ?? '').trim();
      const plannedDate = planGroup === 'planned' ? String(row[0] ?? '').trim() : '';
      const continuesPlannedStation = Boolean(plannedDate && plannedDate === lastPlannedDate);
      const continuesPanelStation = Boolean(quantity && /^st\s*[12]$/i.test(currentStation));
      const station = explicitStation || (quantity || continuesPlannedStation || continuesPanelStation ? currentStation : '');
      const norm = explicitNorm || (continuesPanelStation ? currentNorm : 0);

      if (explicitStation) {
        currentStation = explicitStation;
        currentNorm = /^st\s*[12]$/i.test(explicitStation) ? explicitNorm : 0;
      }
      if (notes) currentNotes = notes;
      if (plannedDate) lastPlannedDate = plannedDate;
      if (/^panele\s+(se|bo)$/i.test(detail)) return;
      const header = normalize(`${detail} ${station}`);
      if (!detail || !station || header.includes('nazwa indeksu') || header.includes('stol lub maszyna')) return;
      makeItem(detail, detail, station, quantity, norm, notes || currentNotes, planGroup, plannedDate || lastPlannedDate);
    });
  }
  if (result.length) return result;

  const headerIndex = normalized.findIndex((row) => row.some((cell) => /indeks|detal|nazwa/.test(cell)) && row.some((cell) => /ilosc|ilość|qty/.test(cell)));
  if (headerIndex >= 0) {
    const headers = normalized[headerIndex];
    const find = (terms: string[]) => headers.findIndex((header) => terms.some((term) => header.includes(term)));
    const indexColumn = find(['indeks', 'kod']);
    const nameColumn = find(['detal', 'produkt', 'nazwa']);
    const stationColumn = find(['maszyna', 'wtr', 'stol', 'stanowisko']);
    const qtyColumn = find(['ilosc', 'ilość', 'qty']);
    const normColumn = find(['norma', 'wydajnosc', 'wydajność']);
    rows.slice(headerIndex + 1).forEach((row) => makeItem(row[nameColumn >= 0 ? nameColumn : indexColumn], row[indexColumn >= 0 ? indexColumn : nameColumn], row[stationColumn], row[qtyColumn], row[normColumn]));
  }
  return result;
};

const parseInventoryRows = (rows: unknown[][], areas: Area[]): InventoryItem[] => {
  const cleanRows = rows.map((row) => row.map((value) => String(value ?? '').trim()));
  const normalized = cleanRows.map((row) => row.map(normalize));
  const findColumn = (headers: string[], terms: string[]) => headers.findIndex((header) => terms.some((term) => header === term || header.includes(term)));
  const headerIndex = normalized.findIndex((row) => findColumn(row, ['ilosc', 'stan rzeczywisty', 'stan', 'qty']) >= 0 && findColumn(row, ['kod', 'indeks', 'symbol', 'material', 'tworzywo', 'nazwa']) >= 0);
  if (headerIndex < 0) return [];
  const headers = normalized[headerIndex];
  const codeColumn = findColumn(headers, ['kod', 'indeks', 'symbol', 'nr materialu']);
  const nameColumn = findColumn(headers, ['nazwa', 'material', 'tworzywo', 'opis']);
  const categoryColumn = findColumn(headers, ['rodzaj', 'kategoria', 'grupa']);
  const locationColumn = findColumn(headers, ['lokalizacja', 'hala', 'obszar', 'miejsce']);
  const qtyColumn = findColumn(headers, ['ilosc', 'stan rzeczywisty', 'stan', 'qty']);
  const unitColumn = findColumn(headers, ['j.m', 'jm', 'jednostka', 'miara']);
  const result: InventoryItem[] = [];
  cleanRows.slice(headerIndex + 1).forEach((row) => {
    const name = String(row[nameColumn] || row[codeColumn] || '').trim();
    if (!name || String(row[qtyColumn] ?? '').trim() === '') return;
    const code = codeColumn >= 0 ? String(row[codeColumn] ?? '').trim() : '';
    const rawLocation = locationColumn >= 0 ? String(row[locationColumn] ?? '').trim() : '';
    const compact = normalize(rawLocation).replace(/\s/g, '');
    const area = areas.find((item) => compact.includes(normalize(item.name).replace(/\s/g, '')))
      ?? (compact.includes('silos') || compact.includes('komora') ? areas.find((item) => item.shared) : undefined);
    const category = inferCategory(row[categoryColumn], name, code);
    result.push({
      id: uid('inv'), areaId: area?.id ?? '', code, name, category,
      qty: Math.max(0, numberValue(row[qtyColumn])), unit: String(row[unitColumn] || (category === 'Tworzywo' || category === 'Barwnik' ? 'kg' : 'szt.')).trim()
    });
  });
  return result;
};

const SectionTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div>
    <h2 className="text-lg font-bold text-title">{title}</h2>
    {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
    <span>{label}</span>
    {children}
  </label>
);

const ProductCatalogField = ({
  label,
  mode,
  value,
  items,
  loading,
  onChange,
  onSelect
}: {
  label: string;
  mode: 'index' | 'name';
  value: string;
  items: ProductCatalogItem[];
  loading: boolean;
  onChange: (value: string) => void;
  onSelect: (item: ProductCatalogItem) => void;
}) => {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => {
    const query = normalize(value);
    if (query.length < 2) return [];
    const tokens = query.split(/\s+/).filter(Boolean);
    return items
      .filter((item) => {
        const mainValue = normalize(mode === 'name' ? item.name : item.index);
        const searchable = normalize(`${item.name} ${item.index}`);
        return Boolean(mainValue) && tokens.every((token) => searchable.includes(token));
      })
      .sort((left, right) => {
        const leftValue = normalize(mode === 'name' ? left.name : left.index);
        const rightValue = normalize(mode === 'name' ? right.name : right.index);
        return Number(!leftValue.startsWith(query)) - Number(!rightValue.startsWith(query))
          || leftValue.localeCompare(rightValue, 'pl', { numeric: true });
      })
      .slice(0, 12);
  }, [items, mode, value]);

  const selectItem = (item: ProductCatalogItem) => {
    onSelect(item);
    setOpen(false);
  };

  return (
    <div className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
      <span>{label}</span>
      <div className="relative">
        <Input
          value={value}
          autoComplete="off"
          placeholder={loading ? 'Wczytywanie głównej bazy...' : mode === 'name' ? 'Wpisz nazwę produktu' : 'Wpisz indeks produktu'}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && suggestions[0]) {
              event.preventDefault();
              selectItem(suggestions[0]);
            }
            if (event.key === 'Escape') setOpen(false);
          }}
        />
        {open && suggestions.length > 0 ? (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-72 overflow-y-auto rounded-xl border border-borderStrong bg-[rgba(13,13,16,0.98)] p-1.5 normal-case tracking-normal shadow-2xl">
            {suggestions.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-brandSoft focus:bg-brandSoft focus:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectItem(item)}
              >
                <span className="block text-sm font-bold text-title">{mode === 'name' ? item.name : item.index}</span>
                <span className="mt-0.5 block text-xs font-medium text-muted">
                  {mode === 'name' ? `Indeks: ${item.index || 'brak w kartotece'}` : item.name}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const MaterialCatalogContext = createContext<ProductCatalogItem[]>([]);

type MaterialCatalogInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  items: ProductCatalogItem[];
  mode: 'code' | 'name';
  onCatalogSelect?: (item: ProductCatalogItem) => void;
};

const MaterialCatalogInput = forwardRef<HTMLInputElement, MaterialCatalogInputProps>(({ items, mode, onCatalogSelect, ...props }, forwardedRef) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const instanceId = useId();
  const suppressOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
    width: number;
    placement: 'above' | 'below';
  }>({ left: 8, top: 8, width: 320, placement: 'below' });
  const query = String(props.value ?? '');
  const deferredQuery = useDeferredValue(query);

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  const suggestions = useMemo(() => {
    if (!mode || !open) return [];
    const normalizedQuery = normalize(deferredQuery);
    if (!normalizedQuery) return [];
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const otherWarehouseRank = MATERIAL_WAREHOUSE_PRIORITY.length;
    const relevanceLevels = 5;
    const buckets = Array.from(
      { length: relevanceLevels },
      () => Array.from({ length: otherWarehouseRank + 1 }, () => [] as ProductCatalogItem[])
    );
    for (const item of items) {
      const code = normalize(item.index);
      const name = normalize(item.name);
      const warehouseCode = normalize(item.warehouseCode);
      if (/(^|[\s(/_-])fw\s*-/.test(name)) continue;
      const searchable = `${code} ${name} ${warehouseCode}`;
      if (!tokens.every((token) => searchable.includes(token))) continue;
      const primary = mode === 'name' ? name : code;
      const secondary = mode === 'name' ? code : name;
      const relevance = primary.startsWith(normalizedQuery)
        ? 0
        : primary.includes(normalizedQuery)
          ? 1
          : secondary.startsWith(normalizedQuery)
            ? 2
            : secondary.includes(normalizedQuery)
              ? 3
              : 4;
      const rank = MATERIAL_WAREHOUSE_RANK.get(String(item.warehouseCode ?? '').trim().toUpperCase()) ?? otherWarehouseRank;
      const bucket = buckets[relevance][rank];
      if (bucket.length < 8) bucket.push(item);
    }
    const ordered: ProductCatalogItem[] = [];
    for (let relevance = 0; relevance < relevanceLevels && ordered.length < 8; relevance += 1) {
      for (let rank = 0; rank <= otherWarehouseRank && ordered.length < 8; rank += 1) {
        ordered.push(...buckets[relevance][rank]);
      }
    }
    return ordered.slice(0, 8);
  }, [deferredQuery, items, mode, open]);

  const positionDropdown = (input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    const width = Math.min(480, Math.max(300, Math.min(rect.width, window.innerWidth - 16)));
    const placement = window.innerHeight - rect.bottom >= 160 ? 'below' : 'above';
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: placement === 'below' ? rect.bottom + 6 : rect.top - 6,
      width,
      placement
    });
  };

  useEffect(() => {
    const closeWhenAnotherInputOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== instanceId) setOpen(false);
    };
    window.addEventListener('material-catalog-open', closeWhenAnotherInputOpens);
    return () => window.removeEventListener('material-catalog-open', closeWhenAnotherInputOpens);
  }, [instanceId]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const handleScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('[data-material-suggestions]')) return;
      close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  const { onFocus, onBlur, onChange, onKeyDown, ...inputProps } = props;
  const setInputValue = (input: HTMLInputElement | null, value: string) => {
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const setSelectValue = (select: HTMLSelectElement | null, value: string) => {
    if (!select) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const selectItem = (item: ProductCatalogItem) => {
    const input = inputRef.current;
    if (!input) return;
    if (onCatalogSelect) {
      setOpen(false);
      onCatalogSelect(item);
      return;
    }
    const ownValue = mode === 'code' ? item.index : item.name;
    const counterpartMode = mode === 'code' ? 'name' : 'code';
    const counterpartValue = mode === 'code' ? item.name : item.index;
    const row = input.closest('tr');
    const counterpart = row?.querySelector<HTMLInputElement>(`input[data-material-catalog-mode="${counterpartMode}"]`) ?? null;
    const categorySelect = row?.children.item(2)?.querySelector<HTMLSelectElement>('select') ?? null;
    const unitInput = row?.children.item(4)?.querySelector<HTMLInputElement>('input') ?? null;
    const category = inferCategory(categorySelect?.value, item.name, `${item.index} ${item.warehouseCode ?? ''}`);
    setOpen(false);
    suppressOpenRef.current = true;
    setInputValue(input, ownValue);
    suppressOpenRef.current = false;
    window.setTimeout(() => {
      setInputValue(counterpart, counterpartValue);
      window.setTimeout(() => {
        if (item.unit) setInputValue(unitInput, item.unit);
        window.setTimeout(() => setSelectValue(categorySelect, category), 0);
      }, 0);
    }, 0);
  };

  const openForInput = (input: HTMLInputElement) => {
    if (!input.value.trim()) {
      setOpen(false);
      return;
    }
    window.dispatchEvent(new CustomEvent('material-catalog-open', { detail: instanceId }));
    positionDropdown(input);
    setOpen(true);
  };

  return <>
    <BaseInput
      {...inputProps}
      list={undefined}
      ref={inputRef}
      data-material-catalog-mode={mode}
      onFocus={(event) => {
        openForInput(event.currentTarget);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        window.setTimeout(() => setOpen(false), 120);
        onBlur?.(event);
      }}
      onChange={(event) => {
        if (suppressOpenRef.current || document.activeElement !== event.currentTarget) setOpen(false);
        else openForInput(event.currentTarget);
        onChange?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && suggestions[0]) {
          event.preventDefault();
          selectItem(suggestions[0]);
        } else if (event.key === 'Escape') {
          setOpen(false);
        }
        onKeyDown?.(event);
      }}
    />
    {open && query.trim() && typeof document !== 'undefined' ? createPortal(
      <div
        data-material-suggestions
        className="fixed z-[300] max-h-[310px] overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] p-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.48)]"
        style={{
          position: 'fixed',
          zIndex: 300,
          left: position.left,
          top: position.top,
          width: position.width,
          transform: position.placement === 'above' ? 'translateY(-100%)' : undefined
        }}
      >
        {suggestions.length ? suggestions.map((item) => <button
          key={item.id}
          type="button"
          className="block w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[rgba(255,255,255,0.06)] focus:bg-[rgba(255,255,255,0.06)] focus:outline-none"
          onMouseDown={(event) => {
            event.preventDefault();
            selectItem(item);
          }}
        >
          <span className="block text-sm font-bold text-title">{item.name}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-dim">
            <span>{item.index || 'Brak kodu / indeksu'}</span>
            {item.warehouseCode ? <span className="rounded-full border border-border px-1.5 py-0.5 font-bold text-body">{item.warehouseCode}</span> : null}
          </span>
        </button>) : <p className="px-3 py-3 text-sm text-muted">Brak pasującej pozycji w kartotece.</p>}
      </div>,
      document.body
    ) : null}
  </>;
});

MaterialCatalogInput.displayName = 'MaterialCatalogInput';

type MaterialAwareInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  onCatalogSelect?: (item: ProductCatalogItem) => void;
};

const Input = forwardRef<HTMLInputElement, MaterialAwareInputProps>(({ onCatalogSelect, ...props }, forwardedRef) => {
  const items = useContext(MaterialCatalogContext);
  const listId = typeof props.list === 'string' ? props.list : '';
  const mode = listId === 'material-code-suggestions' ? 'code' : listId === 'material-name-suggestions' ? 'name' : null;
  if (!mode) return <BaseInput ref={forwardedRef} {...props} />;
  return <MaterialCatalogInput ref={forwardedRef} {...props} items={items} mode={mode} onCatalogSelect={onCatalogSelect} />;
});

Input.displayName = 'MaterialAwareInput';

const Stat = ({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'success' }) => (
  <div className={cn('rounded-2xl border border-border bg-[rgba(255,255,255,0.035)] p-4', tone === 'warning' && 'border-[color:color-mix(in_srgb,var(--warning)_42%,transparent)]', tone === 'success' && 'border-[color:color-mix(in_srgb,var(--success)_42%,transparent)]')}>
    <p className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</p>
    <p className="mt-2 text-2xl font-black text-title">{value}</p>
  </div>
);

export default function MaterialPlanningPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useUiStore((store) => store.user);
  const readOnly = isReadOnly(user, 'PLANOWANIE_ZAPOTRZEBOWANIA');
  const requestedView = searchParams.get('view');
  const view: View = requestedView && ['plan', 'technologie', 'spis', 'obliczenia', 'dokument', 'zwroty', 'historia', 'ustawienia', 'instrukcja'].includes(requestedView)
    ? requestedView as View
    : 'plan';
  const [state, setState] = useState<AppState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storageMode, setStorageMode] = useState<'server' | 'local' | 'loading'>('loading');
  const [message, setMessage] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [pending, setPending] = useState<PendingWorkbook | null>(null);
  const [expandedPlan, setExpandedPlan] = useState('');
  const [expandedCalculation, setExpandedCalculation] = useState('');
  const [calculationSimulations, setCalculationSimulations] = useState<Record<string, CalculationSimulation>>({});
  const [editingTechnologyId, setEditingTechnologyId] = useState('');
  const [productCatalog, setProductCatalog] = useState<ProductCatalogItem[]>([]);
  const [productCatalogLoading, setProductCatalogLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3200);
  };

  useEffect(() => {
    let local: AppState | null = null;
    try {
      local = parseStoredState(JSON.parse(window.localStorage.getItem(LOCAL_KEY) || 'null'));
    } catch {
      local = null;
    }
    if (local) setState({ ...local, plan: applyDefaultTechnologyAssignments(local.plan, local.technologies) });
    setHydrated(true);
    fetch('/api/planowanie-zapotrzebowania', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable');
        const payload = await response.json() as { state?: unknown };
        const serverState = parseStoredState(payload.state);
        if (serverState) {
          const withDefaults = { ...serverState, plan: applyDefaultTechnologyAssignments(serverState.plan, serverState.technologies) };
          setState(withDefaults);
          window.localStorage.setItem(LOCAL_KEY, JSON.stringify(withDefaults));
        }
        setStorageMode('server');
      })
      .catch(() => setStorageMode('local'));
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/planowanie-zapotrzebowania?source=product-catalog', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('catalog unavailable');
        return response.json() as Promise<{ items?: ProductCatalogItem[] }>;
      })
      .then((payload) => {
        if (active) setProductCatalog(Array.isArray(payload.items) ? payload.items : []);
      })
      .catch(() => {
        if (active) setProductCatalog([]);
      })
      .finally(() => {
        if (active) setProductCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !productCatalog.length) return;
    const byCode = new Map(productCatalog.filter((item) => normalize(item.index)).map((item) => [normalize(item.index), item]));
    const byName = new Map(productCatalog.filter((item) => normalize(item.name)).map((item) => [normalize(item.name), item]));
    setState((current) => {
      let changed = false;
      const repairMaterials = (materials: TechnologyMaterial[]) => {
        let listChanged = false;
        const next = materials.map((material) => {
          const catalogItem = byCode.get(normalize(material.code)) ?? byName.get(normalize(material.name));
          if (!catalogItem) return material;
          const patch = catalogMaterialPatch(material, catalogItem);
          if (
            patch.code === material.code &&
            patch.name === material.name &&
            patch.unit === material.unit &&
            patch.category === material.category
          ) return material;
          listChanged = true;
          changed = true;
          return { ...material, ...patch };
        });
        return listChanged ? next : materials;
      };
      const technologies = current.technologies.map((technology) => {
        const materials = repairMaterials(technology.materials);
        return materials === technology.materials ? technology : { ...technology, materials };
      });
      const plan = current.plan.map((item) => {
        if (!item.workingMaterials) return item;
        const workingMaterials = repairMaterials(item.workingMaterials);
        return workingMaterials === item.workingMaterials ? item : { ...item, workingMaterials };
      });
      return changed ? { ...current, technologies, plan } : current;
    });
  }, [hydrated, productCatalog, storageMode]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const updateState = (updater: (current: AppState) => AppState) => {
    if (readOnly) return;
    setState((current) => {
      const next = updater(current);
      const mappedPlan = applyStationMappings(next.plan, next.stationMappings);
      return {
        ...next,
        plan: applyDefaultTechnologyAssignments(mappedPlan, next.technologies),
        updatedAt: nowLabel()
      };
    });
    setDirty(true);
  };

  const save = async () => {
    if (readOnly) return;
    setSaving(true);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    try {
      const response = await fetch('/api/planowanie-zapotrzebowania', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state })
      });
      if (!response.ok) throw new Error('save failed');
      setStorageMode('server');
      setDirty(false);
      flash('Zapisano moduł i historię zmian.');
    } catch {
      setStorageMode('local');
      setDirty(false);
      flash('Zapisano lokalnie. Baza modułu nie jest jeszcze dostępna.');
    } finally {
      setSaving(false);
    }
  };

  const areaName = (id: string) => state.areas.find((area) => area.id === id)?.name ?? 'Brak przypisu';
  const technologiesFor = (item: Pick<PlanItem, 'index' | 'name'>) => state.technologies.filter((technology) => !technology.archived && (normalize(technology.productIndex) === normalize(item.index) || normalize(technology.productName) === normalize(item.name)));
  const technologyForItem = (item: PlanItem) => state.technologies.find((technology) => technology.id === item.technologyId);
  const materialsForItem = (item: PlanItem) => item.workingMaterials ?? technologyForItem(item)?.materials ?? [];

  const selectTechnology = (itemId: string, technologyId: string) => {
    updateState((current) => ({
      ...current,
      plan: current.plan.map((item) => {
        if (item.id !== itemId) return item;
        const technology = current.technologies.find((entry) => entry.id === technologyId);
        return { ...item, technologyId, shiftNorm: technology?.shiftNorm || item.shiftNorm, workingMaterials: technology ? cloneMaterials(technology.materials) : null, manualOverride: false };
      })
    }));
  };

  const itemProductionQty = (item: PlanItem) => {
    const remaining = Math.max(0, item.remainingQty || item.totalQty);
    const norm = item.shiftNorm || technologyForItem(item)?.shiftNorm || 0;
    return Math.min(remaining, Math.max(0, norm * state.horizonShifts));
  };

  const demandByArea = (() => {
    const all = new Map<string, Map<string, number>>();
    state.areas.filter((area) => !area.shared).forEach((area) => all.set(area.id, new Map()));
    state.plan.filter((item) => item.included && item.areaId && item.technologyId).forEach((item) => {
      const areaMap = all.get(item.areaId) ?? new Map<string, number>();
      const qty = itemProductionQty(item);
      materialsForItem(item).forEach((material) => {
        const key = materialKey(material);
        areaMap.set(key, (areaMap.get(key) ?? 0) + qty * material.usage);
      });
      all.set(item.areaId, areaMap);
    });
    return all;
  })();

  const sharedAreaIds = new Set(state.areas.filter((area) => area.shared).map((area) => area.id));
  const materialSupply = (key: string, material: TechnologyMaterial, areaId: string) => {
    const sharedStock = state.inventory
      .filter((item) => sharedAreaIds.has(item.areaId) && materialMatches(material, item))
      .reduce((sum, item) => sum + item.qty, 0);
    const areaNeeds = [...demandByArea.entries()].map(([currentAreaId, demandMap]) => {
      const demand = demandMap.get(key) ?? 0;
      const areaStock = state.inventory
        .filter((item) => item.areaId === currentAreaId && materialMatches(material, item))
        .reduce((sum, item) => sum + item.qty, 0);
      return { areaId: currentAreaId, demand, areaStock, netNeed: Math.max(0, demand - areaStock) };
    });
    const globalSharedDemand = areaNeeds.reduce((sum, item) => sum + item.netNeed, 0);
    const globalSharedShortage = Math.max(0, globalSharedDemand - sharedStock);
    const selected = areaNeeds.find((item) => item.areaId === areaId) ?? { areaId, demand: 0, areaStock: 0, netNeed: 0 };
    const toIssue = globalSharedDemand > 0
      ? globalSharedShortage * (selected.netNeed / globalSharedDemand)
      : 0;
    return { ...selected, sharedStock, globalSharedDemand, globalSharedShortage, toIssue };
  };

  const requirements = (() => {
    const aggregate = new Map<string, { material: TechnologyMaterial; demand: number }>();
    state.plan
      .filter((item) => item.included && item.areaId === state.selectedAreaId && item.technologyId)
      .forEach((item) => {
        const qty = itemProductionQty(item);
        materialsForItem(item).forEach((material) => {
          const key = materialKey(material);
          const row = aggregate.get(key) ?? { material, demand: 0 };
          row.demand += qty * material.usage;
          aggregate.set(key, row);
        });
      });
    return [...aggregate.entries()].map(([key, row]) => {
      const supply = materialSupply(key, row.material, state.selectedAreaId);
      return {
        key, code: row.material.code, name: row.material.name, category: row.material.category, unit: row.material.unit,
        demand: row.demand, areaStock: supply.areaStock, sharedStock: supply.sharedStock, toIssue: supply.toIssue,
        globalSharedDemand: supply.globalSharedDemand, globalSharedShortage: supply.globalSharedShortage
      };
    }).sort((a, b) => (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) || a.name.localeCompare(b.name, 'pl')) as Requirement[];
  })();

  const missingTechnologyCount = state.plan.filter((item) => item.included && !item.technologyId).length;
  const unassignedCount = state.plan.filter((item) => item.included && !item.areaId).length;
  const documentRows = requirements.filter((row) => row.toIssue > 0);
  const doneCount = documentRows.filter((row) => state.pickingDone[`${state.selectedAreaId}|${row.key}`]).length;

  const openView = (next: View) => router.push(next === 'plan' ? '/planowanie-zapotrzebowania' : `/planowanie-zapotrzebowania?view=${next}`);

  const handleWorkbook = async (file: File, purpose: PendingWorkbook['purpose']) => {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const selected = workbook.SheetNames.at(-1) ?? '';
      setPending({ workbook, fileName: file.name, purpose });
      setSheetName(selected);
      flash(`Odczytano plik. Wybierz zakładkę do importu.`);
    } catch {
      flash('Nie udało się odczytać pliku Excel.');
    }
  };

  const importSelectedSheet = () => {
    if (!pending || !sheetName) return;
    const sheet = pending.workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (pending.purpose === 'inventory') {
      const imported = parseInventoryRows(rows, state.areas);
      if (!imported.length) return flash('Nie znaleziono rozpoznawalnych pozycji spisu.');
      updateState((current) => ({ ...current, inventory: imported }));
      setPending(null);
      flash(`Wczytano i pogrupowano ${imported.length} pozycji spisu.`);
      return;
    }
    const imported = parsePlanRows(rows, state.stationMappings);
    if (!imported.length) return flash('Nie znaleziono rozpoznawalnych pozycji planu.');
    updateState((current) => {
      const activeBySignature = new Map(current.plan.map((item) => [planItemSignature(item), item]));
      const suspended = current.archive.filter((item) => item.status === 'suspended');
      const nextPlan = imported.map((incoming) => {
        const signature = planItemSignature(incoming);
        const active = activeBySignature.get(signature);
        if (active) {
          activeBySignature.delete(signature);
          return { ...incoming, id: active.id, runId: active.runId, technologyId: active.technologyId, workingMaterials: active.workingMaterials, manualOverride: active.manualOverride, remainingQty: incoming.totalQty };
        }
        const candidate = suspended.find((entry) => planItemSignature(entry.planItem) === signature);
        const variants = current.technologies.filter((technology) => !technology.archived && (normalize(technology.productIndex) === normalize(incoming.index) || normalize(technology.productName) === normalize(incoming.name)));
        return { ...incoming, continuationCandidateId: candidate?.id ?? '', technologyId: candidate ? '' : variants.length === 1 ? variants[0].id : '', workingMaterials: candidate ? null : variants.length === 1 ? cloneMaterials(variants[0].materials) : null };
      });
      const newSuspended = [...activeBySignature.values()].map<ProductionArchive>((item) => ({
        id: item.runId, status: 'suspended', planItem: item, technologyName: technologyForItem(item) ? technologyLabel(technologyForItem(item) as Technology) : 'Brak technologii',
        materials: materialsForItem(item), at: nowLabel(), reason: 'Pozycja zniknęła z nowego planu'
      }));
      return {
        ...current, plan: nextPlan, planName: pending.fileName, planSheet: sheetName, planImportedAt: nowLabel(),
        archive: [...newSuspended, ...current.archive.filter((entry) => !newSuspended.some((item) => item.id === entry.id))]
      };
    });
    setPending(null);
    flash(`Zaimportowano ${imported.length} pozycji z zakładki ${sheetName}.`);
  };

  const syncOriginalInventory = async (showMessage = true) => {
    try {
      const dateKey = localDateKey();
      const response = await fetch(`/api/planowanie-zapotrzebowania?source=original-inventory&date=${dateKey}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('sync failed');
      const payload = await response.json() as {
        dateKey: string;
        syncedAt: string;
        rows: Array<{ id: string; areaId: string; code: string; name: string; qty: number; unit: string }>;
      };
      const inventory = payload.rows.map<InventoryItem>((row) => ({
        ...row,
        category: 'Pozostałe'
      }));
      setState((current) => ({
        ...current,
        inventory,
        inventorySourceDate: payload.dateKey,
        inventorySyncedAt: new Date(payload.syncedAt).toLocaleString('pl-PL'),
        updatedAt: nowLabel()
      }));
      if (!readOnly) setDirty(true);
      if (showMessage) flash(`Pobrano ${inventory.length} pozycji ze Spisu rzeczywistego.`);
    } catch {
      if (showMessage) flash('Nie udało się pobrać aktualnego Spisu rzeczywistego.');
    }
  };

  useEffect(() => {
    if (
      !hydrated ||
      !(['spis', 'obliczenia', 'dokument', 'zwroty'] as View[]).includes(view)
    ) {
      return;
    }
    void syncOriginalInventory(false);
    // Spis odświeżamy przy wejściu do każdej części, która korzysta z jego ilości.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, view]);

  const addTechnology = (productIndex = '', productName = '', shiftNorm = 0) => {
    const same = state.technologies.filter((technology) => normalize(technology.productIndex) === normalize(productIndex));
    const technology: Technology = {
      id: uid('tech'), productIndex, productName, variant: same.length ? 'alternative' : 'base', alternativeNo: same.filter((item) => item.variant === 'alternative').length + 1,
      description: '', notes: '', shiftNorm: Math.max(0, shiftNorm), materials: [], archived: false
    };
    updateState((current) => ({ ...current, technologies: [...current.technologies, technology] }));
    setEditingTechnologyId(technology.id);
    openView('technologie');
  };

  const editTechnology = (technologyId: string, patch: Partial<Technology>) => {
    updateState((current) => ({ ...current, technologies: current.technologies.map((technology) => technology.id === technologyId ? { ...technology, ...patch } : technology) }));
  };

  const deleteTechnology = (technologyId: string) => {
    if (readOnly) return;
    const technology = state.technologies.find((item) => item.id === technologyId);
    if (!technology) return;
    const label = technology.productIndex || technology.productName || 'tę technologię';
    if (!window.confirm(`Usunąć trwale technologię „${label}”?`)) return;
    const nextTechnology = state.technologies.find((item) => item.id !== technologyId && !item.archived);
    updateState((current) => ({
      ...current,
      technologies: current.technologies.filter((item) => item.id !== technologyId),
      plan: current.plan.map((item) => item.technologyId === technologyId
        ? { ...item, technologyId: '', workingMaterials: null, manualOverride: false }
        : item)
    }));
    setEditingTechnologyId(nextTechnology?.id ?? '');
    flash('Technologia została usunięta. Przypisania w bieżącym planie wyczyszczono.');
  };

  const planShiftNormForProduct = (productIndex: string, productName: string) => {
    const normalizedIndex = normalize(productIndex);
    const normalizedName = normalize(productName);
    return state.plan.find((item) =>
      item.shiftNorm > 0 &&
      ((normalizedIndex && normalize(item.index) === normalizedIndex) ||
        (normalizedName && normalize(item.name) === normalizedName))
    )?.shiftNorm ?? 0;
  };

  const assignTechnologyProduct = (
    technologyId: string,
    productIndex: string,
    productName: string
  ) => {
    const technology = state.technologies.find((item) => item.id === technologyId);
    const shiftNorm =
      technology && technology.shiftNorm > 0
        ? technology.shiftNorm
        : planShiftNormForProduct(productIndex, productName);
    editTechnology(technologyId, { productIndex, productName, shiftNorm });
  };

  const editTechnologyProductField = (technologyId: string, mode: 'index' | 'name', value: string) => {
    const normalizedValue = normalize(value);
    const exactMatches = normalizedValue
      ? productCatalog.filter((item) => normalize(mode === 'name' ? item.name : item.index) === normalizedValue)
      : [];
    if (exactMatches.length === 1) {
      const match = exactMatches[0];
      assignTechnologyProduct(technologyId, match.index, match.name);
      return;
    }
    editTechnology(technologyId, mode === 'name' ? { productName: value } : { productIndex: value });
  };

  const updateWorkingMaterial = (itemId: string, materialId: string, patch: Partial<TechnologyMaterial>) => {
    updateState((current) => ({
      ...current,
      plan: current.plan.map((item) => item.id === itemId
        ? { ...item, manualOverride: true, workingMaterials: materialsForItem(item).map((material) => material.id === materialId ? { ...material, ...patch } : material) }
        : item)
    }));
  };

  const continueProduction = (itemId: string, archiveId: string, keep: boolean) => {
    updateState((current) => {
      const archived = current.archive.find((entry) => entry.id === archiveId);
      return {
        ...current,
        plan: current.plan.map((item) => item.id === itemId ? {
          ...item,
          runId: keep && archived ? archived.planItem.runId : uid('run'),
          technologyId: keep && archived ? archived.planItem.technologyId : '',
          workingMaterials: keep && archived ? cloneMaterials(archived.materials) : null,
          manualOverride: keep && archived ? archived.planItem.manualOverride : false,
          continuationCandidateId: ''
        } : item),
        archive: current.archive.filter((entry) => entry.id !== archiveId)
      };
    });
    flash(keep ? 'Kontynuacja zachowała technologię roboczą.' : 'Rozpoczęto nową produkcję bez poprzednich korekt.');
  };

  const exportDocument = () => {
    const rows = [['Status', 'Grupa', 'Kod', 'Materiał', 'Zapotrzebowanie', 'Na obszarze', 'Stan wspólny silosów', 'Do wypisania', 'J.m.']];
    documentRows.forEach((row) => rows.push([
      state.pickingDone[`${state.selectedAreaId}|${row.key}`] ? 'Wypisane' : 'Do wypisania', row.category, row.code, row.name,
      String(row.demand), String(row.areaStock), String(row.sharedStock), String(row.toIssue), row.unit
    ]));
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `pobranie-${state.selectedAreaId}-${state.horizonShifts}-zmiany.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const renderHeader = (title: string, subtitle: string) => (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Osobny moduł produkcyjny</p>
        <h1 className="mt-1 text-2xl font-black text-title md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={storageMode === 'server' ? 'success' : storageMode === 'local' ? 'warning' : 'default'}>
          {storageMode === 'server' ? 'Zapis centralny' : storageMode === 'local' ? 'Zapis lokalny' : 'Łączenie...'}
        </Badge>
        {dirty ? <Badge tone="warning">Niezapisane zmiany</Badge> : null}
        {!readOnly ? <Button onClick={save} disabled={saving} className="min-h-[44px]" variant="secondary"><Save className="mr-2 h-4 w-4" />{saving ? 'Zapisuję...' : 'Zapisz'}</Button> : <Badge tone="info">Tylko podgląd</Badge>}
      </div>
    </div>
  );

  const renderPendingImport = () => pending ? (
    <Card className="space-y-4 border-[rgba(255,122,26,0.5)]">
      <SectionTitle title={pending.purpose === 'plan' ? 'Wybierz zakładkę planu' : 'Wybierz zakładkę wspólnego spisu'} subtitle={`${pending.fileName} — importowana jest tylko jedna wskazana zakładka.`} />
      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_auto_auto] md:items-end">
        <Field label="Zakładka">
          <SelectField value={sheetName} onChange={(event) => setSheetName(event.target.value)}>
            {pending.workbook.SheetNames.map((name) => <option value={name} key={name}>{name}</option>)}
          </SelectField>
        </Field>
        <Button onClick={importSelectedSheet}><Upload className="mr-2 h-4 w-4" />Importuj zakładkę</Button>
        <Button variant="ghost" onClick={() => setPending(null)}>Anuluj</Button>
      </div>
    </Card>
  ) : null;

  const renderPlanTable = (
    items: PlanItem[],
    title: string,
    subtitle: string,
    tone: 'standard' | 'emergency' | 'planned'
  ) => {
    if (!items.length) return null;
    return <Card className={cn(
      'overflow-hidden p-0',
      tone === 'emergency' && 'border-[rgba(239,68,68,0.5)]',
      tone === 'planned' && 'border-[rgba(183,122,255,0.5)] bg-[rgba(183,122,255,0.035)]'
    )}>
      <div className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3',
        tone === 'emergency' && 'bg-[rgba(239,68,68,0.08)]',
        tone === 'planned' && 'border-[rgba(183,122,255,0.25)] bg-[rgba(183,122,255,0.08)]'
      )}>
        <div>
          <p className={cn('font-bold text-title', tone === 'emergency' && 'text-red-300', tone === 'planned' && 'text-[#debaff]')}>{title}</p>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
        <Badge tone={tone === 'emergency' ? 'danger' : tone === 'planned' ? 'info' : 'default'}>{items.length}</Badge>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-[rgba(255,255,255,0.045)] text-left text-xs uppercase tracking-wide text-dim"><tr><th className="p-3">Licz</th><th className="p-3">Indeks / detal</th><th className="p-3">Stanowisko</th><th className="p-3">Strefa</th><th className="p-3 text-right">Całość</th><th className="p-3 text-right">Pozostało</th><th className="p-3 text-right">Norma / zmianę</th><th className="p-3">Technologia</th><th className="p-3"></th></tr></thead><tbody>
        {items.map((item) => {
          const variants = technologiesFor(item);
          return <tr key={item.id} className={cn(
            'border-t border-border align-top',
            !item.included && 'opacity-55',
            tone === 'planned' && 'border-[rgba(183,122,255,0.18)]'
          )}>
            <td className="p-3"><button onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, included: !row.included } : row) }))} className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', item.included ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_20%,transparent)] text-success' : 'border-border text-dim')}>{item.included ? <Check className="h-4 w-4" /> : null}</button></td>
            <td className="p-3"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-title">{item.index}</p>{item.planGroup === 'planned' && item.plannedDate ? <span className="rounded-md border border-[rgba(183,122,255,0.45)] bg-[rgba(183,122,255,0.1)] px-2 py-0.5 text-xs font-bold text-[#debaff]">{item.plannedDate}</span> : null}</div><p className="mt-1 max-w-[300px] text-muted">{item.name}</p>{item.continuationCandidateId ? <div className="mt-2 flex gap-2"><Button className="min-h-[34px] px-3 py-1 text-xs" onClick={() => continueProduction(item.id, item.continuationCandidateId, true)}>Kontynuuj</Button><Button className="min-h-[34px] px-3 py-1 text-xs" variant="ghost" onClick={() => continueProduction(item.id, item.continuationCandidateId, false)}>Nowa produkcja</Button></div> : null}</td>
            <td className="p-3"><div className="min-w-[150px] rounded-xl border border-border bg-[rgba(255,255,255,0.025)] px-3 py-2"><p className="font-semibold text-title">{item.station || 'Nie podano'}</p><p className="mt-0.5 text-[11px] text-dim">Z planu produkcyjnego</p></div></td>
            <td className="p-3">{item.areaId ? <Badge tone="info">{areaName(item.areaId)}</Badge> : <Badge tone="warning">Brak przypisu</Badge>}</td>
            <td className="p-3 text-right font-semibold">{fmt(item.totalQty)}</td>
            <td className="p-3"><Input className="text-right" type="number" value={item.remainingQty} onChange={(event) => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, remainingQty: Math.max(0, numberValue(event.target.value)) } : row) }))} /></td>
            <td className="p-3"><Input className="text-right" type="number" value={item.shiftNorm} onChange={(event) => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, shiftNorm: Math.max(0, numberValue(event.target.value)) } : row) }))} /></td>
            <td className="min-w-[220px] p-3">{variants.length ? <SelectField value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}><option value="">{variants.length > 1 ? 'Wybierz technologię' : 'Technologia'}</option>{variants.map((technology) => <option key={technology.id} value={technology.id}>{technologyLabel(technology)} · {technology.description || 'bez opisu'}</option>)}</SelectField> : <Button variant="outline" className="min-h-[40px]" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}><Plus className="mr-2 h-4 w-4" />Dodaj technologię</Button>}</td>
            <td className="p-3"><button aria-expanded={expandedPlan === item.id} aria-label={`Rozwiń technologię ${item.index}`} className="rounded-lg p-2 text-muted hover:bg-[rgba(255,255,255,0.06)] hover:text-title" onClick={() => setExpandedPlan(expandedPlan === item.id ? '' : item.id)}>{expandedPlan === item.id ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button></td>
          </tr>;
        })}
      </tbody></table></div>
    </Card>;
  };

  const renderPlan = () => (
    <div className="space-y-5">
      {renderHeader('Plan produkcyjny', 'Tutaj wgrywasz plan i kontrolujesz dane wejściowe. Technologie oraz obliczenia mają własne ekrany.')}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pozycje planu" value={String(state.plan.length)} />
        <Stat label="Bez technologii" value={String(missingTechnologyCount)} tone={missingTechnologyCount ? 'warning' : 'success'} />
        <Stat label="Bez przypisanej strefy" value={String(unassignedCount)} tone={unassignedCount ? 'warning' : 'success'} />
      </div>
      <input ref={fileInputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWorkbook(file, 'plan'); event.target.value = ''; }} />
      <Card className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div><p className="font-bold text-title">{state.planName || 'Brak wgranego planu'}</p><p className="mt-1 text-sm text-muted">{state.planSheet ? `Zakładka: ${state.planSheet} · ${state.planImportedAt}` : 'Wybierz plik Excel, a potem jedną zakładkę.'}</p></div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />Wgraj plan Excel</Button><Button variant="ghost" onClick={() => { if (readOnly) return; setState(demoState()); setDirty(true); flash('Wczytano dane demonstracyjne.'); }}><RefreshCw className="mr-2 h-4 w-4" />Wczytaj demo</Button></div>
      </Card>
      {renderPendingImport()}
      {state.plan.length ? <div className="space-y-4">
        {renderPlanTable(state.plan.filter((item) => (item.planGroup ?? 'standard') === 'standard'), 'Plan bieżący', 'Aktualna produkcja z wybranego arkusza.', 'standard')}
        {renderPlanTable(state.plan.filter((item) => item.planGroup === 'emergency'), 'Awaryjnie', 'Pozycje oznaczone w planie jako awaryjne.', 'emergency')}
        {renderPlanTable(state.plan.filter((item) => item.planGroup === 'planned'), 'Planowane zmiany form', 'Pozycje przyszłe. Włącz „Licz”, aby uwzględnić wybraną pozycję w zapotrzebowaniu.', 'planned')}
      </div> : <EmptyState title="Nie wgrano planu" description="Zaimportuj plik Excel i wybierz jedną zakładkę planu produkcyjnego." />}
      {expandedPlan ? (() => {
        const item = state.plan.find((row) => row.id === expandedPlan);
        if (!item) return null;
        const materials = materialsForItem(item);
        return <Card className="space-y-4 border-[rgba(255,122,26,0.4)]"><div className="flex items-center justify-between"><SectionTitle title={`Technologia robocza: ${item.index}`} subtitle="Zmiany dotyczą tylko tej pozycji planu. Biblioteka technologii nie zostanie nadpisana." />{item.manualOverride ? <Badge tone="warning">Ręcznie zmieniona</Badge> : <Badge tone="success">Kopia nominalna</Badge>}</div>{materials.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="text-left text-xs uppercase text-dim"><tr><th className="p-2">Kod</th><th className="p-2">Nazwa</th><th className="p-2">Rodzaj</th><th className="p-2">Zużycie / szt.</th><th className="p-2">J.m.</th><th className="p-2">Ilość na palecie / w opakowaniu</th><th></th></tr></thead><tbody>{materials.map((material) => <tr key={material.id} className="border-t border-border"><td className="p-2"><Input value={material.code} onChange={(event) => updateWorkingMaterial(item.id, material.id, { code: event.target.value })} /></td><td className="p-2"><Input list="material-name-suggestions" value={material.name} onChange={(event) => updateWorkingMaterial(item.id, material.id, { name: event.target.value })} /></td><td className="p-2"><SelectField value={material.category} onChange={(event) => updateWorkingMaterial(item.id, material.id, { category: event.target.value as MaterialCategory })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td><td className="p-2"><Input type="number" step="0.0001" value={material.usage} onChange={(event) => updateWorkingMaterial(item.id, material.id, { usage: numberValue(event.target.value) })} /></td><td className="p-2"><Input value={material.unit} onChange={(event) => updateWorkingMaterial(item.id, material.id, { unit: event.target.value })} /></td><td className="p-2"><Input type="number" value={material.logisticQty} onChange={(event) => updateWorkingMaterial(item.id, material.id, { logisticQty: numberValue(event.target.value) })} /></td><td className="p-2"><Button variant="ghost" className="min-h-[38px] px-3 text-danger" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: materials.filter((entry) => entry.id !== material.id) } : row) }))}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">Wybierz technologię, aby utworzyć kopię roboczą materiałów.</p>}<Button variant="outline" disabled={!item.technologyId} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: [...materials, { id: uid('mat'), code: '', name: '', category: 'Pozostałe', usage: 0, unit: 'szt.', logisticQty: 1 }] } : row) }))}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button></Card>;
      })() : null}
    </div>
  );

  const renderTechnologies=() => {
    const selected=state.technologies.find((technology) => technology.id===editingTechnologyId)??state.technologies.find((technology) => !technology.archived);
    return <div className="space-y-5">
      {renderHeader('Biblioteka technologii','Technologie są wprowadzane ręcznie i pozostają w bibliotece. Bazowa jest zawsze pierwsza, kolejne warianty to Alternatywna 1, 2, 3...')}
      {selected && !readOnly ? <div className="flex justify-end"><Button variant="outline" className="border-[color:color-mix(in_srgb,var(--danger)_48%,transparent)] text-danger hover:border-danger" onClick={() => deleteTechnology(selected.id)}><Trash2 className="mr-2 h-4 w-4" />Usuń wybraną technologię</Button></div> : null}
      <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <Card className="space-y-3"><div className="flex items-center justify-between"><SectionTitle title="Technologie" subtitle={`${state.technologies.filter((item) => !item.archived).length} aktywnych`} /><Button className="min-h-[40px] px-3" onClick={() => addTechnology()}><Plus className="h-4 w-4" /></Button></div><div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">{state.technologies.filter((technology) => !technology.archived).map((technology) => <button key={technology.id} onClick={() => setEditingTechnologyId(technology.id)} className={cn('w-full rounded-xl border p-3 text-left transition',selected?.id===technology.id? 'border-[rgba(255,122,26,0.75)] bg-brandSoft':'border-border bg-[rgba(255,255,255,0.025)] hover:border-borderStrong')}><div className="flex items-center justify-between gap-2"><Badge tone={technology.variant==='base'? 'success':'info'}>{technologyLabel(technology)}</Badge><span className="text-xs text-dim">{fmt(technology.shiftNorm)} / zm.</span></div><p className="mt-2 font-bold text-title">{technology.productIndex||'Nowy indeks'}</p><p className="mt-1 line-clamp-2 text-xs text-muted">{technology.productName||technology.description||'Uzupełnij dane technologii'}</p></button>)}</div></Card>
        {selected? <Card className="space-y-5"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><SectionTitle title={`${technologyLabel(selected)} · ${selected.productIndex||'Nowa technologia'}`} subtitle="Ta karta jest wzorcem wielokrotnego użytku. Korekty konkretnej produkcji wykonuje się w planie lub obliczeniach." /><Button variant="ghost" className="text-danger" onClick={() => editTechnology(selected.id,{ archived: true })}><Archive className="mr-2 h-4 w-4" />Archiwizuj</Button></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><ProductCatalogField label="Indeks produktu" mode="index" value={selected.productIndex} items={productCatalog} loading={productCatalogLoading} onChange={(value) => editTechnologyProductField(selected.id,'index',value)} onSelect={(item) => assignTechnologyProduct(selected.id,item.index,item.name)} /><ProductCatalogField label="Nazwa produktu" mode="name" value={selected.productName} items={productCatalog} loading={productCatalogLoading} onChange={(value) => editTechnologyProductField(selected.id,'name',value)} onSelect={(item) => assignTechnologyProduct(selected.id,item.index,item.name)} /><Field label="Rodzaj wersji"><SelectField value={selected.variant} onChange={(event) => editTechnology(selected.id,{ variant: event.target.value as Technology['variant'],alternativeNo: event.target.value==='base'? 0:selected.alternativeNo||1 })}><option value="base">Bazowa</option><option value="alternative">Alternatywna</option></SelectField></Field>{selected.variant==='alternative'? <Field label="Numer alternatywy"><Input type="number" min="1" value={selected.alternativeNo} onChange={(event) => editTechnology(selected.id,{ alternativeNo: Math.max(1,Math.floor(numberValue(event.target.value))) })} /></Field>:null}<Field label="Norma na zmianę (8h)"><Input type="number" value={selected.shiftNorm} onChange={(event) => editTechnology(selected.id,{ shiftNorm: Math.max(0,numberValue(event.target.value)) })} /></Field><Field label="Krótki opis"><Input placeholder="np. Pakowanie w karton rozmiar 5" value={selected.description} onChange={(event) => editTechnology(selected.id,{ description: event.target.value })} /></Field><label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-dim md:col-span-2 xl:col-span-3"><span>Uwagi (opcjonalne)</span><textarea className="min-h-20 w-full rounded-xl border border-border bg-[rgba(0,0,0,0.4)] p-3 text-sm font-normal normal-case tracking-normal text-body focus:border-[rgba(255,106,0,0.55)] focus:outline-none" value={selected.notes} onChange={(event) => editTechnology(selected.id,{ notes: event.target.value })} /></label></div><div className="flex items-center justify-between"><SectionTitle title="Materiały technologii" subtitle="Zużycie jest podawane na jedną sztukę produktu. Ilość logistyczna jest tylko wskazówką i nie zaokrągla pobrania do pełnej palety." /><Button variant="outline" onClick={() => editTechnology(selected.id,{ materials: [...selected.materials,{ id: uid('mat'),code: '',name: '',category: 'Pozostałe',usage: 0,unit: 'szt.',logisticQty: 1 }] })}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="text-left text-xs uppercase text-dim"><tr><th className="p-2">Kod</th><th className="p-2">Nazwa materiału</th><th className="p-2">Rodzaj</th><th className="p-2">Zużycie / szt.</th><th className="p-2">J.m.</th><th className="p-2">Na palecie / w opakowaniu</th><th></th></tr></thead><tbody>{selected.materials.map((material) => <tr key={material.id} className="border-t border-border"><td className="p-2"><Input list="material-code-suggestions" value={material.code} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,code: event.target.value }:row) })} /></td><td className="p-2"><Input list="material-name-suggestions" value={material.name} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,name: event.target.value }:row) })} /></td><td className="p-2"><SelectField value={material.category} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,category: event.target.value as MaterialCategory }:row) })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td><td className="p-2"><Input type="number" step="0.0001" value={material.usage} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,usage: numberValue(event.target.value) }:row) })} /></td><td className="p-2"><Input value={material.unit} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,unit: event.target.value }:row) })} /></td><td className="p-2"><Input type="number" value={material.logisticQty} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,logisticQty: numberValue(event.target.value) }:row) })} /></td><td className="p-2"><Button variant="ghost" className="min-h-[38px] px-3 text-danger" onClick={() => editTechnology(selected.id,{ materials: selected.materials.filter((row) => row.id!==material.id) })}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div></Card>:<EmptyState title="Brak technologii" description="Dodaj pierwszą technologię bazową dla produktu." />}
      </div>
    </div>;
  };

  const renderInventory = () => <SpisRzeczywisty />;

  const renderCalculationDetails = (item: PlanItem) => {
    const technology = technologyForItem(item);
    const materials = materialsForItem(item);
    const simulation = calculationSimulations[item.id] ?? { mode: 'shifts', shifts: 3.5, quantity: 0 };
    const remaining = Math.max(0, item.remainingQty || item.totalQty);
    const norm = Math.max(0, item.shiftNorm || technology?.shiftNorm || 0);
    const simulationQty = simulation.mode === 'all'
      ? remaining
      : simulation.mode === 'quantity'
        ? Math.min(remaining, Math.max(0, simulation.quantity))
        : Math.min(remaining, norm * Math.max(0, simulation.shifts));
    const updateSimulation = (patch: Partial<CalculationSimulation>) => setCalculationSimulations((current) => ({
      ...current,
      [item.id]: { ...simulation, ...patch }
    }));

    return <div className="space-y-4 border-t border-[rgba(255,122,26,0.28)] bg-[rgba(255,255,255,0.018)] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <SectionTitle title={`Symulacja: ${item.index}`} subtitle="Zakres symulacji nie zmienia ilości zapisanej w planie. Edycja materiałów tworzy roboczą korektę tylko dla tej pozycji." />
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 3.5].map((shifts) => <Button key={shifts} className="min-h-9 px-3 py-1.5 text-xs" variant={simulation.mode === 'shifts' && simulation.shifts === shifts ? 'secondary' : 'outline'} onClick={() => updateSimulation({ mode: 'shifts', shifts })}>{String(shifts).replace('.', ',')} zm.</Button>)}
          <Button className="min-h-9 px-3 py-1.5 text-xs" variant={simulation.mode === 'all' ? 'secondary' : 'outline'} onClick={() => updateSimulation({ mode: 'all' })}>Całe zlecenie</Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Własna liczba zmian"><Input type="number" min="0" step="0.5" value={simulation.shifts} onChange={(event) => updateSimulation({ mode: 'shifts', shifts: Math.max(0, numberValue(event.target.value)) })} /></Field>
        <Field label="Własna liczba sztuk"><Input type="number" min="0" value={simulation.quantity} onChange={(event) => updateSimulation({ mode: 'quantity', quantity: Math.max(0, numberValue(event.target.value)) })} /></Field>
        <Stat label="Produkcja w symulacji" value={`${fmt(simulationQty)} szt.`} />
        <Stat label="Zmiany do końca" value={norm > 0 ? fmt(remaining / norm) : 'Brak normy'} tone={norm > 0 ? 'default' : 'warning'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Pozostało" value={`${fmt(remaining)} szt.`} />
        <Stat label="Norma / zmianę" value={`${fmt(norm)} szt.`} />
        <Stat label="Strefa" value={item.areaId ? areaName(item.areaId) : 'Brak przypisu'} tone={item.areaId ? 'default' : 'warning'} />
      </div>

      {!technology ? <div className="flex flex-col gap-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.07)] p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold text-warning">Najpierw wybierz lub dodaj technologię dla tej pozycji.</p><Button variant="outline" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}><Plus className="mr-2 h-4 w-4" />Dodaj technologię</Button></div> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={item.manualOverride ? 'warning' : 'success'}>{item.manualOverride ? 'Technologia robocza zmieniona' : 'Kopia technologii bazowej'}</Badge><span className="text-xs text-muted">Zmiany zapiszą się razem z modułem.</span></div>
          {item.manualOverride ? <Button variant="ghost" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, workingMaterials: cloneMaterials(technology.materials), manualOverride: false } : row) }))}><RefreshCw className="mr-2 h-4 w-4" />Przywróć bazową</Button> : null}
        </div>
        {materials.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1500px] text-sm"><thead className="text-left text-xs uppercase text-dim"><tr><th className="p-2">Kod</th><th className="p-2">Nazwa materiału</th><th className="p-2">Rodzaj</th><th className="p-2 text-right">Zużycie / szt.</th><th className="p-2">J.m.</th><th className="p-2 text-right">Potrzeba</th><th className="p-2 text-right">W strefie</th><th className="p-2 text-right">W silosach</th><th className="p-2 text-right">Do pobrania</th><th className="p-2 text-right">Brakuje</th><th></th></tr></thead><tbody>{materials.map((material) => {
          const key = materialKey(material);
          const demand = simulationQty * material.usage;
          const supply = materialSupply(key, material, item.areaId);
          const itemShare = supply.demand > 0 ? Math.min(1, demand / supply.demand) : 0;
          const areaStock = supply.areaStock;
          const sharedStock = supply.sharedStock;
          const toIssue = supply.toIssue * itemShare;
          const shortage = toIssue;
          return <tr key={material.id} className="border-t border-border align-top"><td className="p-2"><Input value={material.code} onChange={(event) => updateWorkingMaterial(item.id, material.id, { code: event.target.value })} /></td><td className="p-2"><Input list="material-name-suggestions" value={material.name} onChange={(event) => updateWorkingMaterial(item.id, material.id, { name: event.target.value })} /></td><td className="p-2"><SelectField value={material.category} onChange={(event) => updateWorkingMaterial(item.id, material.id, { category: event.target.value as MaterialCategory })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td><td className="p-2"><Input className="text-right" type="number" step="0.0001" value={material.usage} onChange={(event) => updateWorkingMaterial(item.id, material.id, { usage: Math.max(0, numberValue(event.target.value)) })} /></td><td className="p-2"><Input value={material.unit} onChange={(event) => updateWorkingMaterial(item.id, material.id, { unit: event.target.value })} /></td><td className="p-2 text-right font-black text-title">{fmt(demand)}</td><td className="p-2 text-right">{fmt(areaStock)}</td><td className="p-2 text-right">{fmt(sharedStock)}</td><td className="p-2 text-right font-bold text-warning">{fmt(toIssue)}</td><td className={cn('p-2 text-right font-black', shortage > 0 ? 'text-danger' : 'text-success')}>{fmt(shortage)}</td><td className="p-2"><Button variant="ghost" className="min-h-[38px] px-3 text-danger" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: materials.filter((entry) => entry.id !== material.id) } : row) }))}><Trash2 className="h-4 w-4" /></Button></td></tr>;
        })}</tbody></table></div> : <p className="text-sm text-muted">Technologia nie ma jeszcze materiałów.</p>}
        <Button variant="outline" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: [...materials, { id: uid('mat'), code: '', name: '', category: 'Pozostałe', usage: 0, unit: 'szt.', logisticQty: 1 }] } : row) }))}><Plus className="mr-2 h-4 w-4" />Dodaj materiał do tej pozycji</Button>
      </>}
    </div>;
  };

  const renderCalculation = () => {
    const scopeItems = state.plan.filter((item) => item.included && (item.areaId === state.selectedAreaId || !item.areaId));
    return (
      <div className="space-y-5">
        {renderHeader('Obliczanie zapotrzebowania', 'Rozwiń wybraną pozycję, aby zasymulować zakres i zmienić jej technologię roboczą.')}
        <Card className="grid gap-3 md:grid-cols-2">
          <Field label="Strefa">
            <SelectField value={state.selectedAreaId} onChange={(event) => updateState((current) => ({ ...current, selectedAreaId: event.target.value }))}>
              {state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </SelectField>
          </Field>
          <Field label="Liczba zmian">
            <Input type="number" min="0.5" step="0.5" value={state.horizonShifts} onChange={(event) => updateState((current) => ({ ...current, horizonShifts: Math.max(0.5, numberValue(event.target.value)) }))} />
          </Field>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-[rgba(255,255,255,0.045)] text-left text-xs uppercase text-dim">
                <tr>
                  <th className="p-3">Pozycja</th>
                  <th className="p-3">Stanowisko / strefa</th>
                  <th className="p-3">Technologia</th>
                  <th className="p-3 text-right">Pozostało</th>
                  <th className="p-3 text-right">W zakresie</th>
                  <th className="p-3">Status</th>
                  <th className="w-14 p-3"><span className="sr-only">Szczegóły</span></th>
                </tr>
              </thead>
              <tbody>
                {scopeItems.map((item) => {
                  const variants = technologiesFor(item);
                  const expanded = expandedCalculation === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr className={cn('border-t border-border', expanded && 'bg-[rgba(255,255,255,0.035)]')}>
                        <td className="p-3"><p className="font-bold text-title">{item.index}</p><p className="text-muted">{item.name}</p></td>
                        <td className="p-3"><p>{item.station || 'Nie podano'}</p><p className="mt-1 text-xs text-muted">{item.areaId ? areaName(item.areaId) : 'Brak przypisu - sprawdź ustawienia'}</p></td>
                        <td className="min-w-[260px] p-3">
                          {variants.length ? (
                            <SelectField value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}>
                              <option value="">Wybierz technologię</option>
                              {variants.map((technology) => <option key={technology.id} value={technology.id}>{technologyLabel(technology)} · {technology.description || 'bez opisu'}</option>)}
                            </SelectField>
                          ) : <Button variant="outline" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}>Dodaj technologię</Button>}
                        </td>
                        <td className="p-3 text-right">{fmt(item.remainingQty)}</td>
                        <td className="p-3 text-right font-black text-title">{item.included && item.technologyId ? fmt(itemProductionQty(item)) : '—'}</td>
                        <td className="p-3">
                          {!item.areaId ? <Badge tone="warning">Brak strefy</Badge> : !item.technologyId ? <Badge tone="danger">Wybierz technologię</Badge> : !item.included ? <Badge>Nie licz</Badge> : item.manualOverride ? <Badge tone="warning">Ręczna korekta</Badge> : <Badge tone="success">Gotowa</Badge>}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            aria-label={expanded ? `Zwiń szczegóły ${item.index}` : `Rozwiń szczegóły ${item.index}`}
                            aria-expanded={expanded}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-[rgba(255,255,255,0.035)] text-muted transition hover:border-brand hover:text-title"
                            onClick={() => setExpandedCalculation(expanded ? '' : item.id)}
                          >
                            {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                          </button>
                        </td>
                      </tr>
                      {expanded ? <tr className="border-t border-border"><td colSpan={7} className="p-0">{renderCalculationDetails(item)}</td></tr> : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Produkcja w zakresie" value={`${fmt(scopeItems.filter((item) => item.areaId === state.selectedAreaId && item.technologyId).reduce((sum, item) => sum + itemProductionQty(item), 0))} szt.`} />
          <Stat label="Pozycje materiałowe" value={String(requirements.length)} />
          <Stat label="Do pobrania" value={String(documentRows.length)} tone={documentRows.length ? 'warning' : 'success'} />
        </div>
        {requirements.some((row) => row.globalSharedShortage > 0) ? (
          <Card className="border-[color:color-mix(in_srgb,var(--warning)_52%,transparent)]">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><p className="font-bold text-title">Wspólne silosy mogą nie wystarczyć dla wszystkich obszarów</p><p className="mt-1 text-sm text-muted">Bilans wspólnego źródła uwzględnia jednocześnie zapotrzebowanie wszystkich hal, a nie tylko aktualnie wybranej strefy.</p></div></div>
          </Card>
        ) : null}
        <div className="flex justify-end"><Button disabled={missingTechnologyCount > 0} onClick={() => openView('dokument')}><PackageCheck className="mr-2 h-4 w-4" />Utwórz dokument do wypisania</Button></div>
      </div>
    );
  };

  const renderDocument = () => {
    const groups = CATEGORIES.map((category) => ({ category, rows: documentRows.filter((row) => row.category === category) })).filter((group) => group.rows.length);
    return <div className="space-y-5">{renderHeader('Dokument pobrania', `Do wypisania dla ${areaName(state.selectedAreaId)} · ${state.calculationMode === 'all' ? 'cała pozostała produkcja' : `${fmt(state.horizonShifts)} zmiany`}.`)}<div className="grid gap-3 sm:grid-cols-3"><Stat label="Pozycje do wypisania" value={String(documentRows.length)} /><Stat label="Oznaczone jako wypisane" value={`${doneCount} / ${documentRows.length}`} tone={doneCount === documentRows.length && documentRows.length ? 'success' : 'default'} /><Stat label="Obszar" value={areaName(state.selectedAreaId)} /></div><div className="flex justify-end"><Button variant="outline" onClick={exportDocument}><FileDown className="mr-2 h-4 w-4" />Pobierz CSV</Button></div>{groups.length ? groups.map((group) => <Card key={group.category} className="overflow-hidden p-0"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="font-black text-title">{group.category}</h2><Badge tone="info">{group.rows.length}</Badge></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="text-left text-xs uppercase text-dim"><tr><th className="p-3">Wypisane</th><th className="p-3">Kod / materiał</th><th className="p-3 text-right">Zapotrzebowanie</th><th className="p-3 text-right">Na obszarze</th><th className="p-3 text-right">W silosach</th><th className="p-3 text-right">Do wypisania</th><th className="p-3">J.m.</th></tr></thead><tbody>{group.rows.map((row) => { const statusKey = `${state.selectedAreaId}|${row.key}`; const done = Boolean(state.pickingDone[statusKey]); return <tr key={row.key} className={cn('border-t border-border transition', done && 'bg-[color:color-mix(in_srgb,var(--success)_9%,transparent)]')}><td className="p-3"><button onClick={() => updateState((current) => ({ ...current, pickingDone: { ...current.pickingDone, [statusKey]: !done } }))} className={cn('flex min-h-11 items-center gap-2 rounded-xl border px-3 font-bold transition', done ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_18%,transparent)] text-success' : 'border-border bg-[rgba(255,255,255,0.03)] text-muted hover:border-success')}><Check className="h-4 w-4" />{done ? 'Wypisane' : 'Kliknij po wypisaniu'}</button></td><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="text-muted">{row.name}</p></td><td className="p-3 text-right">{fmt(row.demand)}</td><td className="p-3 text-right">{fmt(row.areaStock)}</td><td className="p-3 text-right">{fmt(row.sharedStock)}{row.globalSharedShortage > 0 ? <p className="mt-1 text-xs font-bold text-warning">Globalnie brakuje {fmt(row.globalSharedShortage)}</p> : null}</td><td className="p-3 text-right text-lg font-black text-title">{fmt(row.toIssue)}</td><td className="p-3">{row.unit}</td></tr>; })}</tbody></table></div></Card>) : <EmptyState title="Brak materiałów do wypisania" description="Najpierw wybierz technologie i przelicz zapotrzebowanie." />}</div>;
  };

  const returns = state.inventory.filter((item) => !state.areas.find((area) => area.id === item.areaId)?.shared).map((item) => {
    const key = materialKey(item);
    const ownDemand = demandByArea.get(item.areaId)?.get(key) ?? 0;
    const other = state.areas.filter((area) => !area.shared && area.id !== item.areaId).map((area) => ({ area, demand: demandByArea.get(area.id)?.get(key) ?? 0 })).filter((entry) => entry.demand > 0);
    return { item, ownDemand, surplus: Math.max(0, item.qty - ownDemand), other };
  }).filter((row) => row.surplus > 0);

  const renderReturns = () => <div className="space-y-5">{renderHeader('Zwroty i przesunięcia między halami', 'Nadwyżka spisana na hali trafia tutaj. Jeżeli materiał jest potrzebny na innym obszarze, aplikacja wskazuje przesunięcie przed zwrotem do magazynu.')} {returns.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-[rgba(255,255,255,0.045)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Materiał</th><th className="p-3">Skąd</th><th className="p-3 text-right">Nadwyżka</th><th className="p-3">Najpierw sprawdź</th><th className="p-3">Decyzja</th></tr></thead><tbody>{returns.map((row) => <tr key={row.item.id} className="border-t border-border"><td className="p-3"><p className="font-bold text-title">{row.item.code || '—'} · {row.item.name}</p><p className="text-xs text-muted">{row.item.category}</p></td><td className="p-3">{areaName(row.item.areaId)}</td><td className="p-3 text-right text-lg font-black">{fmt(row.surplus)} {row.item.unit}</td><td className="p-3">{row.other.length ? <div className="space-y-1">{row.other.map(({ area, demand }) => <Badge key={area.id} tone="warning">{area.name} potrzebuje {fmt(demand)} {row.item.unit}</Badge>)}</div> : <span className="text-muted">Inne hale nie potrzebują tego materiału</span>}</td><td className="p-3">{row.other.length ? <Badge tone="info">Przesunięcie między halami</Badge> : <Badge>Zwrot do magazynu</Badge>}</td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak pozycji do zwrotu" description="Zwroty pojawią się po porównaniu rzeczywistego spisu z aktualnym zapotrzebowaniem." />}</div>;

  const renderHistory = () => <div className="space-y-5">{renderHeader('Historia produkcji', 'Pozycje znikające z nowego planu są wstrzymywane. Ich technologia robocza i ręczne zamienniki pozostają zapisane do decyzji operatora.')} {state.archive.length ? <div className="space-y-3">{state.archive.map((entry) => <Card key={entry.id} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap items-center gap-2"><Badge tone={entry.status === 'suspended' ? 'warning' : 'success'}>{entry.status === 'suspended' ? 'Wstrzymana' : 'Zakończona'}</Badge>{entry.planItem.manualOverride ? <Badge tone="info">Ręczna technologia</Badge> : null}</div><p className="mt-3 font-bold text-title">{entry.planItem.index} · {entry.planItem.name}</p><p className="mt-1 text-sm text-muted">{entry.planItem.station || 'Brak stanowiska'} · {entry.technologyName} · {entry.at}</p><p className="mt-1 text-xs text-dim">{entry.reason}</p></div>{entry.status === 'suspended' && !readOnly ? <Button variant="ghost" onClick={() => updateState((current) => ({ ...current, archive: current.archive.map((row) => row.id === entry.id ? { ...row, status: 'completed', reason: 'Produkcja zakończona ręcznie', at: nowLabel() } : row) }))}><Archive className="mr-2 h-4 w-4" />Zakończ produkcję</Button> : null}</Card>)}</div> : <EmptyState title="Historia jest pusta" description="Pojawi się po kolejnym imporcie planu lub ręcznym zakończeniu produkcji." />}</div>;

  const renderSettings = () => <div className="space-y-5">{renderHeader('Ustawienia modułu', 'Przypisz stanowiska do obszarów. Import planu będzie uzupełniał halę automatycznie na podstawie tej listy.')}<Card className="space-y-4"><div className="flex items-center justify-between"><SectionTitle title="Stanowiska i obszary" subtitle="Domyślnie WTR 1–28 należą do Hali 1, a WTR 29–52 do Hali 2." /><Button variant="outline" onClick={() => updateState((current) => ({ ...current, stationMappings: [...current.stationMappings, { station: '', areaId: 'hala-1' }] }))}><Plus className="mr-2 h-4 w-4" />Dodaj</Button></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{state.stationMappings.map((mapping, index) => <div key={`${index}-${mapping.station}`} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-border p-2"><Input value={mapping.station} placeholder="np. WTR 12 lub ST 3" onChange={(event) => updateState((current) => ({ ...current, stationMappings: current.stationMappings.map((row, rowIndex) => rowIndex === index ? { ...row, station: event.target.value } : row) }))} /><SelectField value={mapping.areaId} onChange={(event) => updateState((current) => ({ ...current, stationMappings: current.stationMappings.map((row, rowIndex) => rowIndex === index ? { ...row, areaId: event.target.value } : row) }))}>{state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</SelectField><Button variant="ghost" className="min-h-[44px] px-3 text-danger" onClick={() => updateState((current) => ({ ...current, stationMappings: current.stationMappings.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button></div>)}</div></Card></div>;

  const renderGuide = () => <div className="space-y-5">{renderHeader('Instrukcja modułu', 'Krótki opis pełnego obiegu i najważniejszych zasad działania.')}{[
    ['1. Plan produkcyjny', 'Wgraj Excel i wybierz jedną zakładkę. Stanowiska zostaną przypisane do obszarów zgodnie z ustawieniami. Pozycje bez przypisu pozostaną widoczne na obu halach z ostrzeżeniem.'],
    ['2. Biblioteka technologii', 'Dla każdego indeksu utwórz technologię Bazową. Kolejne dopuszczone warianty zapisuj jako Alternatywna 1, Alternatywna 2 itd. Opis służy do szybkiego rozróżnienia pakowania lub materiału.'],
    ['3. Technologia robocza', 'Po wyborze wersji aplikacja kopiuje jej materiały do konkretnej pozycji planu. Zamiana tworzywa, kartonu lub zużycia oznaczana jest jako ręczna i nie zmienia biblioteki.'],
    ['4. Codzienny horyzont', 'Zapotrzebowanie domyślnie dotyczy 3,5 zmiany: mniejszej z wartości „pozostała ilość” oraz „norma na zmianę × liczba zmian”. Długie zlecenie jest liczone ponownie każdego dnia tylko dla kolejnego krótkiego zakresu.'],
    ['5. Rzeczywisty spis', 'W tej zakładce prowadzisz pełny Spis rzeczywisty. Lokalizacja rozdziela pozycje na Halę 1, Halę 2, Bakomę, Lakiernię i wspólne Silosy. Obliczenia pobierają stąd aktualne ilości hali.'],
    ['6. Silosy', 'Silos jest wspólnym źródłem dla wszystkich hal. Ostrzeżenie liczy łączne zapotrzebowanie wszystkich obszarów, aby ten sam stan nie został obiecany dwa razy.'],
    ['7. Dokument do wypisania', 'Dokument pokazuje wyłącznie materiały, które trzeba dobrać. Osoba wypisująca klika jeden przycisk przy gotowej pozycji; wiersz zaznacza się na zielono.'],
    ['8. Zwroty i historia', 'Materiały niepotrzebne na danej hali trafiają do zwrotów. Jeśli potrzebuje ich inna hala, pojawia się zalecenie przesunięcia. Produkcja znikająca z planu przechodzi do wstrzymanych i zachowuje technologię roboczą.']
  ].map(([title, text]) => <Card key={title}><h2 className="font-black text-title">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{text}</p></Card>)}</div>;

  if (!hydrated) return <div className="min-h-[50vh]" />;

  const renderer: Record<View, () => React.ReactNode> = {
    plan: renderPlan,
    technologie: renderTechnologies,
    spis: renderInventory,
    obliczenia: renderCalculation,
    dokument: renderDocument,
    zwroty: renderReturns,
    historia: renderHistory,
    ustawienia: renderSettings,
    instrukcja: renderGuide
  };

  return <MaterialCatalogContext.Provider value={productCatalog}>
    <div className="space-y-5">
      {message ? <div className="fixed right-4 top-20 z-50 max-w-sm rounded-2xl border border-[rgba(255,122,26,0.55)] bg-[rgba(12,12,15,0.96)] px-4 py-3 text-sm font-semibold text-title shadow-2xl">{message}</div> : null}
      {renderer[view]()}
    </div>
  </MaterialCatalogContext.Provider>;
}
