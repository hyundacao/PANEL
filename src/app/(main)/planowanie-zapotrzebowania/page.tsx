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
  Clock3,
  FileDown,
  FilePlus2,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Undo2,
  Upload,
  X
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

import {
  allocateAmountByDemand,
  calculateIssueBalance,
  calculateReturnSurplus,
  calculateScopedQuantity,
  correctedQuantity,
  diffPlanItems,
  nextPlanVersionNumber,
  type PlanDifference
} from '@/lib/planowanie-zapotrzebowania/domain';

type View =
  | 'plan'
  | 'technologie'
  | 'spis'
  | 'dokument'
  | 'zwroty'
  | 'historia'
  | 'ustawienia'
  | 'obliczenia'
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
type ItemScopeMode = 'global' | 'shifts' | 'quantity' | 'all';
type PlanVersionStatus = 'draft' | 'ready' | 'active' | 'superseded';

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
  scopeMode?: ItemScopeMode;
  scopeShifts?: number;
  scopeQuantity?: number;
};


type PlanVersion = {
  id: string;
  planDate: string;
  versionNo: number;
  importedAt: string;
  importedBy: string;
  fileName: string;
  sheetName: string;
  status: PlanVersionStatus;
  items: PlanItem[];
  differences: PlanDifference[];
};

type QuantityCorrection = {
  id: string;
  planDate: string;
  planVersionId: string;
  itemId: string;
  index: string;
  name: string;
  previousValue: number;
  newValue: number;
  difference: number;
  createdBy: string;
  createdAt: string;
  source: 'Ręczna korekta';
  revertedAt?: string;
};

type PickingDocumentStatus = 'draft' | 'handed' | 'issued' | 'cancelled' | 'outdated';
type PickingDocumentKind = 'base' | 'correction';

type PickingDocumentSource = {
  planItemId: string;
  index: string;
  name: string;
  demand: number;
};

type PickingDocumentRow = {
  key: string;
  code: string;
  name: string;
  category: MaterialCategory;
  unit: string;
  demand: number;
  areaStock: number;
  issuedBefore: number;
  pendingBefore: number;
  toIssue: number;
  confirmed: boolean;
  sources: PickingDocumentSource[];
};

type PickingDocument = {
  id: string;
  documentNo: string;
  planDate: string;
  planVersionId: string;
  planVersionNo: number;
  areaId: string;
  scopeLabel: string;
  createdAt: string;
  createdBy: string;
  status: PickingDocumentStatus;
  kind: PickingDocumentKind;
  rows: PickingDocumentRow[];
};

type MaterialReturnRow = {
  id: string;
  planDate: string;
  materialKey: string;
  code: string;
  name: string;
  category: MaterialCategory;
  unit: string;
  planItemId: string;
  index: string;
  productName: string;
  areaId: string;
  reason: string;
  issued: number;
  currentNeed: number;
  surplus: number;
  destination: string;
  status: 'open' | 'completed';
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
  selectedPlanDate: string;
  activePlanVersionId: string;
  technologies: Technology[];
  plan: PlanItem[];
  dailyPlans: Record<string, PlanItem[]>;
  planVersions: PlanVersion[];
  quantityCorrections: QuantityCorrection[];
  documents: PickingDocument[];
  returnStatuses: Record<string, 'open' | 'completed'>;
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
  fullDemand: number;
  issued: number;
  pending: number;
  sources: PickingDocumentSource[];
  selectedDemand: number;
  areaStock: number;
  sharedStock: number;
  toIssue: number;
  globalSharedDemand: number;
  globalSharedShortage: number;
};

type PendingWorkbook = { workbook: XLSX.WorkBook; fileName: string; purpose: 'plan' | 'inventory' };
type ProductCatalogItem = { id: string; index: string; name: string; warehouseCode?: string; unit?: string };

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
const dateOffsetKey = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const formatPlanDate = (value: string) => value
  ? new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(`${value}T12:00:00`))
  : 'Brak daty';
const clonePlanItems = (items: PlanItem[]) => items.map((item) => ({
  ...item,
  workingMaterials: item.workingMaterials ? item.workingMaterials.map((material) => ({ ...material })) : null
}));
const documentStatusLabel: Record<PickingDocumentStatus, string> = { draft: 'Roboczy', handed: 'Przekazany', issued: 'Wydany', cancelled: 'Anulowany', outdated: 'Nieaktualny' };
const differenceLabel: Record<PlanDifference['kind'], string> = { new: 'Nowa', removed: 'Usunięta', quantity_increased: 'Zwiększona', quantity_decreased: 'Zmniejszona', station_changed: 'Zmiana stanowiska', norm_changed: 'Zmiana normy' };
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
    selectedPlanDate: localDateKey(),
    activePlanVersionId: '',
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
    dailyPlans: {},
    planVersions: [],
    quantityCorrections: [],
    documents: [],
    returnStatuses: {},
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
  planName: '', planSheet: '', planImportedAt: '', inventorySourceDate: '', inventorySyncedAt: '', technologies: [], plan: [], dailyPlans: {}, planVersions: [], quantityCorrections: [], documents: [], returnStatuses: {}, inventory: [], pickingDone: {}, archive: []
});

const parseStoredState = (value: unknown): AppState | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AppState>;
  if (!Array.isArray(record.plan) || !Array.isArray(record.technologies)) return null;
  const stationMappings = Array.isArray(record.stationMappings) ? record.stationMappings : [];
  const storedAreas = Array.isArray(record.areas) ? record.areas : [];
  const cleanPlanItem = (item: PlanItem): PlanItem => {
    const product = splitProductFields(item.name, item.index);
    return {
      ...item,
      name: product.name,
      index: product.index,
      planGroup: item.planGroup ?? 'standard',
      plannedDate: item.plannedDate ?? '',
      scopeMode: item.scopeMode ?? 'global',
      scopeShifts: Math.max(0.5, numberValue(item.scopeShifts) || 3.5),
      scopeQuantity: Math.max(0, numberValue(item.scopeQuantity))
    };
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
  const selectedPlanDate = record.selectedPlanDate || localDateKey();
  const dailyPlans: Record<string, PlanItem[]> = record.dailyPlans && typeof record.dailyPlans === 'object'
    ? Object.fromEntries(Object.entries(record.dailyPlans).map(([date, items]) => [
      date,
      Array.isArray(items) ? applyStationMappings(items.map(cleanPlanItem), stationMappings) : []
    ]))
    : {};
  if (!Object.keys(dailyPlans).length && plan.length) dailyPlans[selectedPlanDate] = plan;
  const storedVersions = Array.isArray(record.planVersions) ? record.planVersions : [];
  const planVersions: PlanVersion[] = storedVersions.length ? storedVersions.map((planVersion) => ({
    ...planVersion,
    items: Array.isArray(planVersion.items) ? planVersion.items.map(cleanPlanItem) : [],
    differences: Array.isArray(planVersion.differences) ? planVersion.differences : []
  })) : (plan.length ? [{
    id: uid('version'),
    planDate: selectedPlanDate,
    versionNo: 1,
    importedAt: record.planImportedAt || record.updatedAt || nowLabel(),
    importedBy: 'Migracja istniejącego planu',
    fileName: record.planName || 'Istniejący plan',
    sheetName: record.planSheet || '',
    status: 'active',
    items: clonePlanItems(plan),
    differences: []
  }] : []);
  const selectedPlan = dailyPlans[selectedPlanDate] ?? plan;
  return {
    ...emptyState(),
    ...record,
    calculationMode: 'horizon',
    areas: mergeAreas(storedAreas),
    stationMappings,
    technologies,
    selectedPlanDate,
    activePlanVersionId: record.activePlanVersionId || planVersions.find((planVersion) => planVersion.planDate === selectedPlanDate && planVersion.status === 'active')?.id || '',
    plan: selectedPlan,
    dailyPlans,
    planVersions,
    quantityCorrections: Array.isArray(record.quantityCorrections) ? record.quantityCorrections : [],
    documents: Array.isArray(record.documents) ? record.documents : [],
    returnStatuses: record.returnStatuses && typeof record.returnStatuses === 'object' ? record.returnStatuses : {},
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
  const view: View = requestedView && ['plan', 'technologie', 'spis', 'dokument', 'zwroty', 'historia', 'ustawienia'].includes(requestedView)
    ? requestedView as View
    : 'plan';
  const [state, setState] = useState<AppState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [storageMode, setStorageMode] = useState<'server' | 'local' | 'loading'>('loading');
  const [serverRevision, setServerRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [pending, setPending] = useState<PendingWorkbook | null>(null);
  const [expandedPlan, setExpandedPlan] = useState('');
  const [expandedCalculation, setExpandedCalculation] = useState('');
  const [showChanges, setShowChanges] = useState(false);
  const [quantityInputs, setQuantityInputs] = useState<Record<string, string>>({});
  const [technologySearch, setTechnologySearch] = useState('');
  const [technologyFilter, setTechnologyFilter] = useState<'active' | 'archived'>('active');
  const [expandedDocument, setExpandedDocument] = useState('');
  const [expandedMaterial, setExpandedMaterial] = useState('');
  const [editingTechnologyId, setEditingTechnologyId] = useState('');
  const [productCatalog, setProductCatalog] = useState<ProductCatalogItem[]>([]);
  const [productCatalogLoading, setProductCatalogLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUserName = user?.username ?? user?.name ?? 'nieznany';

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
        const payload = await response.json() as { state?: unknown; revision?: number };
        const serverState = parseStoredState(payload.state);
        if (serverState) {
          const withDefaults = { ...serverState, plan: applyDefaultTechnologyAssignments(serverState.plan, serverState.technologies) };
          setState(withDefaults);
          window.localStorage.setItem(LOCAL_KEY, JSON.stringify(withDefaults));
        }
        setStorageMode('server');
        setServerRevision(Math.max(0, Number(payload.revision ?? 0)));
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
      const plan = applyDefaultTechnologyAssignments(mappedPlan, next.technologies);
      return {
        ...next,
        plan,
        dailyPlans: { ...next.dailyPlans, [next.selectedPlanDate]: clonePlanItems(plan) },
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
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state, expectedRevision: serverRevision })
      });
      const payload = await response.json() as { revision?: number; code?: string };
      if (response.status === 409) {
        setServerRevision(Math.max(0, Number(payload.revision ?? serverRevision)));
        setStorageMode('server');
        flash('Ktoś zapisał nowsze zmiany. Odśwież dane przed ponownym zapisem — Twoje zmiany nie zostały nadpisane.');
        return;
      }
      if (!response.ok) throw new Error(payload.code ?? 'save failed');
      setServerRevision(Math.max(0, Number(payload.revision ?? serverRevision + 1)));
      setStorageMode('server');
      setDirty(false);
      flash('Zapisano moduł i historię zmian.');
    } catch {
      setStorageMode('local');
      flash('Baza centralna jest niedostępna. Zachowano kopię lokalną, ale zmiany nadal wymagają zapisu centralnego.');
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

  const scopeForItem = (item: PlanItem) => {
    if (item.scopeMode === 'all') return { mode: 'all' as const };
    if (item.scopeMode === 'quantity') return { mode: 'quantity' as const, quantity: Math.max(0, item.scopeQuantity ?? 0) };
    if (item.scopeMode === 'shifts') return { mode: 'shifts' as const, shifts: Math.max(0.5, item.scopeShifts ?? state.horizonShifts) };
    return state.calculationMode === 'all'
      ? { mode: 'all' as const }
      : { mode: 'shifts' as const, shifts: state.horizonShifts };
  };

  const itemProductionQty = (item: PlanItem) => {
    const remaining = Math.max(0, item.remainingQty || item.totalQty);
    const norm = item.shiftNorm || technologyForItem(item)?.shiftNorm || 0;
    return calculateScopedQuantity(remaining, norm, scopeForItem(item));
  };

  const itemScopeLabel = (item: PlanItem) => {
    const scope = scopeForItem(item);
    if (scope.mode === 'all') return 'Cały plan';
    if (scope.mode === 'quantity') return `${fmt(scope.quantity)} szt.`;
    return `${fmt(scope.shifts)} zm. / ${fmt(itemProductionQty(item))} szt.`;
  };

  const documentLedger = new Map<string, { issued: number; pending: number }>();
  state.documents
    .filter((document) => document.planDate === state.selectedPlanDate && (document.status === 'issued' || document.status === 'handed'))
    .forEach((document) => document.rows.forEach((row) => {
      const key = `${document.areaId}|${row.key}`;
      const current = documentLedger.get(key) ?? { issued: 0, pending: 0 };
      if (document.status === 'issued') current.issued += row.toIssue;
      if (document.status === 'handed') current.pending += row.toIssue;
      documentLedger.set(key, current);
    }));

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
      const ledger = documentLedger.get(`${currentAreaId}|${key}`) ?? { issued: 0, pending: 0 };
      const balance = calculateIssueBalance({ demand, areaStock, sharedCoverage: 0, issued: ledger.issued, pending: ledger.pending });
      return { areaId: currentAreaId, demand, areaStock, issued: ledger.issued, pending: ledger.pending, netNeed: balance.toIssue };
    });
    const globalSharedDemand = areaNeeds.reduce((sum, item) => sum + item.netNeed, 0);
    const globalSharedShortage = Math.max(0, globalSharedDemand - sharedStock);
    const selected = areaNeeds.find((item) => item.areaId === areaId) ?? { areaId, demand: 0, areaStock: 0, issued: 0, pending: 0, netNeed: 0 };
    const toIssue = globalSharedDemand > 0 ? globalSharedShortage * (selected.netNeed / globalSharedDemand) : 0;
    return { ...selected, sharedStock, globalSharedDemand, globalSharedShortage, toIssue };
  };

  const requirementsForArea = (areaId: string) => {
    const aggregate = new Map<string, { material: TechnologyMaterial; demand: number; fullDemand: number; sources: PickingDocumentSource[] }>();
    state.plan.filter((item) => item.included && item.areaId === areaId && item.technologyId).forEach((item) => {
      const selectedQty = itemProductionQty(item);
      const fullQty = Math.max(0, item.remainingQty || item.totalQty);
      materialsForItem(item).forEach((material) => {
        const key = materialKey(material);
        const row = aggregate.get(key) ?? { material, demand: 0, fullDemand: 0, sources: [] };
        const demand = selectedQty * material.usage;
        row.demand += demand;
        row.fullDemand += fullQty * material.usage;
        row.sources.push({ planItemId: item.id, index: item.index, name: item.name, demand });
        aggregate.set(key, row);
      });
    });
    return [...aggregate.entries()].map(([key, row]) => {
      const supply = materialSupply(key, row.material, areaId);
      return {
        key, code: row.material.code, name: row.material.name, category: row.material.category, unit: row.material.unit,
        demand: row.demand, selectedDemand: row.demand, fullDemand: row.fullDemand, issued: supply.issued, pending: supply.pending,
        sources: row.sources, areaStock: supply.areaStock, sharedStock: supply.sharedStock, toIssue: supply.toIssue,
        globalSharedDemand: supply.globalSharedDemand, globalSharedShortage: supply.globalSharedShortage
      };
    }).sort((a, b) => (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99) || a.name.localeCompare(b.name, 'pl')) as Requirement[];
  };

  const requirements = requirementsForArea(state.selectedAreaId);
  const missingTechnologyCount = state.plan.filter((item) => item.included && !item.technologyId).length;
  const unassignedCount = state.plan.filter((item) => item.included && !item.areaId).length;
  const documentRows = requirements.filter((row) => row.toIssue > 0);

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
    let importedVersionNo = 1;
    let differenceCount = 0;
    updateState((current) => {
      const activeQueues = new Map<string, PlanItem[]>();
      current.plan.forEach((item) => {
        const signature = planItemSignature(item);
        activeQueues.set(signature, [...(activeQueues.get(signature) ?? []), item]);
      });
      const suspended = current.archive.filter((item) => item.status === 'suspended');
      const nextPlan = imported.map((incoming) => {
        const signature = planItemSignature(incoming);
        const queue = activeQueues.get(signature) ?? [];
        const active = queue.shift();
        activeQueues.set(signature, queue);
        if (active) {
          return {
            ...incoming,
            id: active.id,
            runId: active.runId,
            included: incoming.planGroup === 'planned' ? active.included : true,
            technologyId: active.technologyId,
            workingMaterials: active.workingMaterials,
            manualOverride: active.manualOverride,
            remainingQty: incoming.totalQty,
            scopeMode: active.scopeMode ?? 'global',
            scopeShifts: active.scopeShifts ?? 3.5,
            scopeQuantity: active.scopeQuantity ?? 0
          };
        }
        const candidate = suspended.find((entry) => planItemSignature(entry.planItem) === signature);
        const variants = current.technologies.filter((technology) => !technology.archived && (
          normalize(technology.productIndex) === normalize(incoming.index) || normalize(technology.productName) === normalize(incoming.name)
        ));
        const defaultTechnology = variants.find((technology) => technology.variant === 'base') ?? (variants.length === 1 ? variants[0] : undefined);
        return {
          ...incoming,
          continuationCandidateId: candidate?.id ?? '',
          technologyId: candidate ? '' : defaultTechnology?.id ?? '',
          workingMaterials: candidate || !defaultTechnology ? null : cloneMaterials(defaultTechnology.materials),
          scopeMode: 'global' as const,
          scopeShifts: 3.5,
          scopeQuantity: 0
        };
      });
      const previousVersion = current.planVersions
        .filter((version) => version.planDate === current.selectedPlanDate)
        .sort((left, right) => right.versionNo - left.versionNo)[0];
      const differences = diffPlanItems(previousVersion?.items ?? [], nextPlan);
      importedVersionNo = nextPlanVersionNumber(current.planVersions, current.selectedPlanDate);
      differenceCount = differences.length;
      const importedAt = nowLabel();
      const versionId = uid('version');
      const nextVersion: PlanVersion = {
        id: versionId,
        planDate: current.selectedPlanDate,
        versionNo: importedVersionNo,
        importedAt,
        importedBy: currentUserName,
        fileName: pending.fileName,
        sheetName,
        status: 'active',
        items: clonePlanItems(nextPlan),
        differences
      };
      const removedItems = [...activeQueues.values()].flat();
      const newSuspended = removedItems.map<ProductionArchive>((item) => {
        const technology = current.technologies.find((entry) => entry.id === item.technologyId);
        return {
          id: item.runId,
          status: 'suspended',
          planItem: item,
          technologyName: technology ? technologyLabel(technology) : 'Brak technologii',
          materials: item.workingMaterials ?? technology?.materials ?? [],
          at: importedAt,
          reason: `Pozycja zniknęła z wersji ${importedVersionNo} planu na ${formatPlanDate(current.selectedPlanDate)}`
        };
      });
      return {
        ...current,
        plan: nextPlan,
        activePlanVersionId: versionId,
        planName: pending.fileName,
        planSheet: sheetName,
        planImportedAt: importedAt,
        planVersions: [
          nextVersion,
          ...current.planVersions.map((version) => version.planDate === current.selectedPlanDate && version.status !== 'superseded'
            ? { ...version, status: 'superseded' as const }
            : version)
        ],
        documents: current.documents.map((document) => document.planDate === current.selectedPlanDate && document.status === 'draft'
          ? { ...document, status: 'outdated' as const }
          : document),
        archive: [...newSuspended, ...current.archive.filter((entry) => !newSuspended.some((item) => item.id === entry.id))]
      };
    });
    setPending(null);
    setShowChanges(differenceCount > 0);
    flash(`Zaimportowano wersję ${importedVersionNo}: ${imported.length} pozycji, ${differenceCount} zmian.`);
  };

  const selectPlanDate = (planDate: string) => {
    if (!planDate) return;
    setState((current) => {
      const dailyPlans = { ...current.dailyPlans, [current.selectedPlanDate]: clonePlanItems(current.plan) };
      const latest = current.planVersions
        .filter((version) => version.planDate === planDate)
        .sort((left, right) => right.versionNo - left.versionNo)[0];
      return {
        ...current,
        selectedPlanDate: planDate,
        activePlanVersionId: latest?.id ?? '',
        plan: clonePlanItems(dailyPlans[planDate] ?? latest?.items ?? []),
        dailyPlans,
        planName: latest?.fileName ?? '',
        planSheet: latest?.sheetName ?? '',
        planImportedAt: latest?.importedAt ?? ''
      };
    });
    setExpandedPlan('');
    setShowChanges(false);
  };

  const applyQuantityCorrection = (item: PlanItem, mode: 'exact' | 'increase' | 'decrease') => {
    const amount = numberValue(quantityInputs[item.id]);
    const nextTotal = correctedQuantity(item.totalQty, mode, amount);
    if (nextTotal === item.totalQty) return flash('Podaj wartość, która zmienia ilość.');
    const createdAt = nowLabel();
    updateState((current) => {
      const produced = Math.max(0, item.totalQty - item.remainingQty);
      const correction: QuantityCorrection = {
        id: uid('correction'), planDate: current.selectedPlanDate, planVersionId: current.activePlanVersionId,
        itemId: item.id, index: item.index, name: item.name, previousValue: item.totalQty, newValue: nextTotal,
        difference: nextTotal - item.totalQty, createdBy: currentUserName, createdAt, source: 'Ręczna korekta'
      };
      return {
        ...current,
        plan: current.plan.map((row) => row.id === item.id ? {
          ...row, totalQty: nextTotal, remainingQty: Math.max(0, nextTotal - produced)
        } : row),
        quantityCorrections: [correction, ...current.quantityCorrections],
        documents: current.documents.map((document) => document.planDate === current.selectedPlanDate && document.status === 'draft'
          ? { ...document, status: 'outdated' as const }
          : document)
      };
    });
    setQuantityInputs((current) => ({ ...current, [item.id]: '' }));
  };

  const undoLastCorrection = (item: PlanItem) => {
    const previous = state.quantityCorrections.find((correction) => correction.planDate === state.selectedPlanDate && correction.itemId === item.id && !correction.revertedAt);
    if (!previous) return flash('Brak ręcznej korekty do cofnięcia.');
    const revertedAt = nowLabel();
    updateState((current) => ({
      ...current,
      plan: current.plan.map((row) => row.id === item.id ? {
        ...row,
        totalQty: previous.previousValue,
        remainingQty: Math.max(0, previous.previousValue - Math.max(0, row.totalQty - row.remainingQty))
      } : row),
      quantityCorrections: current.quantityCorrections.map((correction) => correction.id === previous.id ? { ...correction, revertedAt } : correction),
      documents: current.documents.map((document) => document.planDate === current.selectedPlanDate && document.status === 'draft'
        ? { ...document, status: 'outdated' as const }
        : document)
    }));
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
      if (showMessage) flash(`Pobrano ${inventory.length} pozycji ze Spisu rzeczywistego.`);
    } catch {
      if (showMessage) flash('Nie udało się pobrać aktualnego Spisu rzeczywistego.');
    }
  };

  useEffect(() => {
    if (
      !hydrated ||
      !(['plan', 'spis', 'dokument', 'zwroty'] as View[]).includes(view)
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

  const saveWorkingAsTechnology = (item: PlanItem) => {
    const materials = materialsForItem(item);
    if (!materials.length) return flash('Dodaj przynajmniej jeden materiał do technologii roboczej.');
    const alternatives = state.technologies.filter((technology) => (
      normalize(technology.productIndex) === normalize(item.index) || normalize(technology.productName) === normalize(item.name)
    ) && technology.variant === 'alternative');
    const technology: Technology = {
      id: uid('tech'),
      productIndex: item.index,
      productName: item.name,
      variant: state.technologies.some((entry) => normalize(entry.productIndex) === normalize(item.index)) ? 'alternative' : 'base',
      alternativeNo: alternatives.length + 1,
      description: `Zapisano z planu ${formatPlanDate(state.selectedPlanDate)}`,
      notes: `Utworzył: ${currentUserName}`,
      shiftNorm: item.shiftNorm,
      materials: cloneMaterials(materials),
      archived: false
    };
    updateState((current) => ({
      ...current,
      technologies: [...current.technologies, technology],
      plan: current.plan.map((row) => row.id === item.id ? {
        ...row, technologyId: technology.id, workingMaterials: cloneMaterials(technology.materials), manualOverride: false
      } : row)
    }));
    flash(`Zapisano ${technologyLabel(technology)} w bibliotece.`);
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
        {!readOnly && view !== 'technologie' ? <Button onClick={save} disabled={saving} className="min-h-[44px]" variant="secondary"><Save className="mr-2 h-4 w-4" />{saving ? 'Zapisuję...' : 'Zapisz'}</Button> : null}
        {readOnly ? <Badge tone="info">Tylko podgląd</Badge> : null}
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

  const currentPlanVersion = state.planVersions
    .filter((version) => version.planDate === state.selectedPlanDate)
    .sort((left, right) => right.versionNo - left.versionNo)[0];

  const renderPlanTable = (items: PlanItem[], title: string, subtitle: string, tone: PlanGroup) => {
    if (!items.length) return null;
    return <Card className={cn('overflow-hidden p-0', tone === 'emergency' && 'border-[rgba(239,68,68,0.42)]', tone === 'planned' && 'border-[rgba(183,122,255,0.45)]')}>
      <div className={cn('flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3', tone === 'planned' && 'border-[rgba(183,122,255,0.25)]')}>
        <div>
          <p className={cn('font-bold text-title', tone === 'emergency' && 'text-red-300', tone === 'planned' && 'text-[#debaff]')}>{title}</p>
          <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
        </div>
        <Badge tone={tone === 'emergency' ? 'danger' : tone === 'planned' ? 'info' : 'default'}>{items.length}</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim">
            <tr>
              <th className="w-14 p-3">Uwzgl.</th><th className="w-[260px] p-3">Indeks / nazwa</th><th className="w-28 p-3">Stanowisko</th>
              <th className="w-20 p-3">Strefa</th><th className="w-16 p-3 text-right">Ilość</th>
              <th className="w-16 p-3 text-right">Norma</th><th className="w-[320px] p-3">Technologia</th><th className="w-14 p-3"><span className="sr-only">Szczegóły</span></th>
            </tr>
          </thead>
          <tbody>{items.map((item) => {
            const variants = technologiesFor(item);
            const changes = currentPlanVersion?.differences.filter((difference) => difference.itemId === item.id) ?? [];
            const quantityChange = changes.find((difference) => difference.kind === 'quantity_increased' || difference.kind === 'quantity_decreased');
            const corrected = state.quantityCorrections.some((correction) => correction.planDate === state.selectedPlanDate && correction.itemId === item.id && !correction.revertedAt);
            const expanded = expandedPlan === item.id;
            return <Fragment key={item.id}>
              <tr className={cn('border-t border-border align-top transition', !item.included && 'bg-[rgba(255,255,255,0.018)] text-dim', tone === 'planned' && 'border-[rgba(183,122,255,0.2)]')}>
                <td className="p-3"><button type="button" title={item.included ? 'Wyłącz z obliczeń' : 'Uwzględnij w obliczeniach'} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, included: !row.included } : row) }))} className={cn('flex h-11 w-11 items-center justify-center rounded-lg border', item.included ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_18%,transparent)] text-success' : 'border-border text-dim')}>{item.included ? <Check className="h-4 w-4" /> : null}</button></td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5"><p className="break-words font-bold text-title">{item.index}</p>{tone === 'emergency' ? <Badge tone="danger">Awaryjna</Badge> : null}{tone === 'planned' ? <Badge tone="info">Przyszła</Badge> : null}{corrected ? <Badge tone="warning">Zmieniona ręcznie</Badge> : null}{changes.map((change) => <Badge key={change.id} tone={change.kind === 'new' ? 'success' : change.kind === 'quantity_decreased' ? 'warning' : 'info'}>{differenceLabel[change.kind]}</Badge>)}</div>
                  <p className="mt-1 break-words text-muted">{item.name}</p>
                  {item.plannedDate ? <p className="mt-1 text-xs text-[#debaff]">Termin: {item.plannedDate}</p> : null}
                </td>
                <td className="p-3 font-semibold text-title">{item.station || 'Nie podano'}</td>
                <td className="p-3">{item.areaId ? <Badge tone="info">{areaName(item.areaId)}</Badge> : <Badge tone="warning">Brak przypisu</Badge>}</td>
                <td className="p-3 text-right"><p className="font-black text-title">{fmt(item.totalQty)}</p>{quantityChange ? <p className={cn('mt-1 text-xs font-bold', quantityChange.difference > 0 ? 'text-success' : 'text-warning')}>{quantityChange.difference > 0 ? '+' : ''}{fmt(quantityChange.difference)}</p> : null}</td>
                <td className="p-3 text-right">{fmt(item.shiftNorm)}</td>
                <td className="p-3">{variants.length ? <SelectField value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}><option value="">Wybierz technologię</option>{variants.map((technology) => <option key={technology.id} value={technology.id}>{technologyLabel(technology)} · {technology.description || 'bez opisu'}</option>)}</SelectField> : <Button variant="outline" className="min-h-11" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}><Plus className="mr-2 h-4 w-4" />Dodaj</Button>}{!item.technologyId ? <p className="mt-1 text-xs font-bold text-danger">Brak technologii</p> : item.manualOverride ? <p className="mt-1 text-xs font-bold text-warning">Technologia robocza</p> : <p className="mt-1 text-xs text-success">Gotowa</p>}</td>
                <td className="p-3"><button type="button" title={expanded ? 'Zwiń pozycję' : 'Rozwiń pozycję'} aria-expanded={expanded} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted hover:border-brand hover:text-title" onClick={() => setExpandedPlan(expanded ? '' : item.id)}>{expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button></td>
              </tr>
              {expanded ? <tr className="border-t border-border"><td colSpan={8} className="p-0">{renderCalculationDetails(item)}</td></tr> : null}
            </Fragment>;
          })}</tbody>
        </table>
      </div>
    </Card>;
  };

  const renderPlan = () => <div className="space-y-5">
    {renderHeader('Plan produkcyjny', 'Plan dnia, technologie i pełne obliczenia materiałowe są dostępne bezpośrednio w rozwijanych pozycjach.')}
    <input ref={fileInputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWorkbook(file, 'plan'); event.target.value = ''; }} />

    <Card className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(310px,0.8fr)_minmax(360px,1fr)_auto] xl:items-end">
        <div className="space-y-2"><p className="text-xs font-bold uppercase text-dim">Data produkcji</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-[auto_auto_minmax(160px,1fr)]"><Button variant={state.selectedPlanDate === localDateKey() ? 'secondary' : 'outline'} onClick={() => selectPlanDate(localDateKey())}>Dzisiaj</Button><Button variant={state.selectedPlanDate === dateOffsetKey(1) ? 'secondary' : 'outline'} onClick={() => selectPlanDate(dateOffsetKey(1))}>Jutro</Button><Input className="col-span-2 sm:col-span-1" type="date" value={state.selectedPlanDate} onChange={(event) => selectPlanDate(event.target.value)} /></div></div>
        <div className="space-y-2"><p className="text-xs font-bold uppercase text-dim">Globalny zakres obliczeń</p><div className="flex flex-wrap gap-2"><Button className="min-h-11" variant={state.calculationMode === 'horizon' && state.horizonShifts === 3.5 ? 'secondary' : 'outline'} onClick={() => updateState((current) => ({ ...current, calculationMode: 'horizon', horizonShifts: 3.5 }))}>3,5 zmiany</Button><Button className="min-h-11" variant={state.calculationMode === 'horizon' && state.horizonShifts === 9 ? 'secondary' : 'outline'} onClick={() => updateState((current) => ({ ...current, calculationMode: 'horizon', horizonShifts: 9 }))}>9 zmian</Button><Input className="w-28" aria-label="Własna liczba zmian" type="number" min="0.5" step="0.5" value={state.horizonShifts} onChange={(event) => updateState((current) => ({ ...current, calculationMode: 'horizon', horizonShifts: Math.max(0.5, numberValue(event.target.value)) }))} /><Button className="min-h-11" variant={state.calculationMode === 'all' ? 'secondary' : 'outline'} onClick={() => updateState((current) => ({ ...current, calculationMode: 'all' }))}>Cały plan</Button></div></div>
        <div className="flex flex-wrap gap-2 xl:justify-end"><Button onClick={() => fileInputRef.current?.click()}><Upload className="mr-2 h-4 w-4" />{currentPlanVersion ? 'Wgraj aktualizację' : 'Wgraj plan'}</Button><Button variant="outline" disabled={!currentPlanVersion?.differences.length} onClick={() => setShowChanges((current) => !current)}>{showChanges ? <X className="mr-2 h-4 w-4" /> : <Clock3 className="mr-2 h-4 w-4" />}Pokaż zmiany</Button></div>
      </div>
      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs uppercase text-dim">Plan na dzień</p><p className="mt-1 text-xl font-black text-title">{formatPlanDate(state.selectedPlanDate)}</p></div>
        <div><p className="text-xs uppercase text-dim">Aktualna wersja</p><p className="mt-1 font-bold text-title">{currentPlanVersion ? `Wersja ${currentPlanVersion.versionNo}` : 'Brak planu'}</p><p className="text-xs text-muted">{currentPlanVersion?.importedAt ?? '—'}</p></div>
        <div><p className="text-xs uppercase text-dim">Plik / arkusz</p><p className="mt-1 break-words font-semibold text-title">{currentPlanVersion?.fileName ?? '—'}</p><p className="text-xs text-muted">{currentPlanVersion?.sheetName ?? '—'}</p></div>
        <Field label="Status wersji"><SelectField disabled={!currentPlanVersion} value={currentPlanVersion?.status ?? 'draft'} onChange={(event) => updateState((current) => ({ ...current, planVersions: current.planVersions.map((version) => version.id === currentPlanVersion?.id ? { ...version, status: event.target.value as PlanVersionStatus } : version) }))}><option value="draft">Roboczy</option><option value="ready">Gotowy</option><option value="active">Aktywny</option><option value="superseded">Zastąpiony</option></SelectField></Field>
      </div>
    </Card>

    {renderPendingImport()}
    {showChanges && currentPlanVersion ? <Card className="space-y-3"><div className="flex items-center justify-between"><SectionTitle title={`Zmiany w wersji ${currentPlanVersion.versionNo}`} subtitle="Porównanie z poprzednim importem tej samej daty." /><Badge tone={currentPlanVersion.differences.length ? 'warning' : 'success'}>{currentPlanVersion.differences.length}</Badge></div>{currentPlanVersion.differences.length ? <div className="divide-y divide-border">{currentPlanVersion.differences.map((difference) => <div key={difference.id} className="grid gap-2 py-3 md:grid-cols-[150px_1fr_auto]"><Badge tone={difference.kind === 'removed' ? 'danger' : difference.kind === 'quantity_decreased' ? 'warning' : 'info'}>{differenceLabel[difference.kind]}</Badge><div><p className="font-bold text-title">{difference.index} · {difference.name}</p><p className="text-xs text-muted">{String(difference.previousValue ?? '—')} → {String(difference.currentValue ?? '—')}</p></div>{difference.difference ? <p className={cn('font-black', difference.difference > 0 ? 'text-success' : 'text-warning')}>{difference.difference > 0 ? '+' : ''}{fmt(difference.difference)}</p> : null}</div>)}</div> : <p className="text-sm text-muted">Pierwszy import albo brak różnic.</p>}</Card> : null}

    <div className="grid gap-3 grid-cols-2 xl:grid-cols-4"><Stat label="Pozycje planu" value={String(state.plan.length)} /><Stat label="Uwzględnione" value={String(state.plan.filter((item) => item.included).length)} /><Stat label="Bez technologii" value={String(missingTechnologyCount)} tone={missingTechnologyCount ? 'warning' : 'success'} /><Stat label="Bez strefy" value={String(unassignedCount)} tone={unassignedCount ? 'warning' : 'success'} /></div>

    {state.plan.length ? <div className="space-y-4">
      {renderPlanTable(state.plan.filter((item) => (item.planGroup ?? 'standard') === 'standard'), 'Plan na dzisiaj', 'Bieżące pozycje wchodzą do obliczeń i dokumentów.', 'standard')}
      {renderPlanTable(state.plan.filter((item) => item.planGroup === 'emergency'), 'Pozycje awaryjne', 'Działają obliczeniowo tak samo jak plan bieżący.', 'emergency')}
      {renderPlanTable(state.plan.filter((item) => item.planGroup === 'planned'), 'Planowane zmiany form — przyszłe', 'Nie są liczone, dopóki ręcznie nie włączysz pozycji.', 'planned')}
    </div> : <EmptyState title={`Brak planu na ${formatPlanDate(state.selectedPlanDate)}`} description="Wgraj pierwszy plan dla wybranej daty. Poprzednie dni i wersje pozostaną w historii." />}
  </div>;

  const renderTechnologies=() => {
    const normalizedSearch = normalize(technologySearch);
    const filteredTechnologies = state.technologies.filter((technology) => (
      technologyFilter === 'archived' ? technology.archived : !technology.archived
    ) && (!normalizedSearch || normalize(`${technology.productIndex} ${technology.productName}`).includes(normalizedSearch)))
      .sort((left, right) => left.productName.localeCompare(right.productName, 'pl') || left.alternativeNo - right.alternativeNo);
    const selected = state.technologies.find((technology) => technology.id === editingTechnologyId)
      ?? filteredTechnologies[0];
    return <div className="space-y-5">
      {renderHeader('Biblioteka technologii','Technologie są wprowadzane ręcznie i pozostają w bibliotece. Bazowa jest zawsze pierwsza, kolejne warianty to Alternatywna 1, 2, 3...')}
      {selected && !readOnly ? <div className="flex justify-end"><Button variant="outline" className="border-[color:color-mix(in_srgb,var(--danger)_48%,transparent)] text-danger hover:border-danger" onClick={() => deleteTechnology(selected.id)}><Trash2 className="mr-2 h-4 w-4" />Usuń wybraną technologię</Button></div> : null}
      <Card className="space-y-3"><div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-dim" /><Input className="min-h-14 pl-12 text-base" placeholder="Szukaj po indeksie lub nazwie produktu" value={technologySearch} onChange={(event) => setTechnologySearch(event.target.value)} /></div><div className="flex flex-wrap gap-2"><Button variant={technologyFilter === 'active' ? 'secondary' : 'outline'} onClick={() => setTechnologyFilter('active')}>Aktywne ({state.technologies.filter((technology) => !technology.archived).length})</Button><Button variant={technologyFilter === 'archived' ? 'secondary' : 'outline'} onClick={() => setTechnologyFilter('archived')}>Archiwalne ({state.technologies.filter((technology) => technology.archived).length})</Button><Button className="ml-auto" onClick={() => addTechnology()}><Plus className="mr-2 h-4 w-4" />Dodaj technologię</Button></div></Card>
      {selected?.archived && !readOnly ? <div className="flex justify-end"><Button variant="secondary" onClick={() => editTechnology(selected.id, { archived: false })}><RefreshCw className="mr-2 h-4 w-4" />Przywróć technologię</Button></div> : null}
      <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <Card className="space-y-3"><div className="flex items-center justify-between"><SectionTitle title={technologyFilter === 'active' ? 'Aktywne technologie' : 'Archiwalne technologie'} subtitle={`${filteredTechnologies.length} wyników`} /></div><div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">{filteredTechnologies.map((technology) => <button key={technology.id} onClick={() => setEditingTechnologyId(technology.id)} className={cn('w-full rounded-xl border p-3 text-left transition',selected?.id===technology.id? 'border-[rgba(255,122,26,0.75)] bg-brandSoft':'border-border bg-[rgba(255,255,255,0.025)] hover:border-borderStrong')}><div className="flex items-center justify-between gap-2"><Badge tone={technology.variant==='base'? 'success':'info'}>{technologyLabel(technology)}</Badge><span className="text-xs text-dim">{fmt(technology.shiftNorm)} / zm.</span></div><p className="mt-2 break-words font-bold text-title">{technology.productIndex||'Nowy indeks'}</p><p className="mt-1 line-clamp-2 text-xs text-muted">{technology.productName||technology.description||'Uzupełnij dane technologii'}</p></button>)}{!filteredTechnologies.length ? <p className="py-8 text-center text-sm text-muted">Brak technologii spełniających kryteria.</p> : null}</div></Card>
        {selected? <Card className="space-y-5"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><SectionTitle title={`${technologyLabel(selected)} · ${selected.productIndex||'Nowa technologia'}`} subtitle="Ta karta jest wzorcem wielokrotnego użytku. Korekty konkretnej produkcji wykonuje się w planie lub obliczeniach." /><div className="flex flex-wrap items-center gap-2">{!readOnly ? <Button onClick={save} disabled={saving} className="min-h-[44px]" variant="secondary"><Save className="mr-2 h-4 w-4" />{saving ? 'Zapisuję...' : 'Zapisz'}</Button> : null}<Button variant="ghost" className="text-danger" onClick={() => editTechnology(selected.id,{ archived: true })}><Archive className="mr-2 h-4 w-4" />Archiwizuj</Button></div></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"><ProductCatalogField label="Indeks produktu" mode="index" value={selected.productIndex} items={productCatalog} loading={productCatalogLoading} onChange={(value) => editTechnologyProductField(selected.id,'index',value)} onSelect={(item) => assignTechnologyProduct(selected.id,item.index,item.name)} /><ProductCatalogField label="Nazwa produktu" mode="name" value={selected.productName} items={productCatalog} loading={productCatalogLoading} onChange={(value) => editTechnologyProductField(selected.id,'name',value)} onSelect={(item) => assignTechnologyProduct(selected.id,item.index,item.name)} /><Field label="Rodzaj wersji"><SelectField value={selected.variant} onChange={(event) => editTechnology(selected.id,{ variant: event.target.value as Technology['variant'],alternativeNo: event.target.value==='base'? 0:selected.alternativeNo||1 })}><option value="base">Bazowa</option><option value="alternative">Alternatywna</option></SelectField></Field>{selected.variant==='alternative'? <Field label="Numer alternatywy"><Input type="number" min="1" value={selected.alternativeNo} onChange={(event) => editTechnology(selected.id,{ alternativeNo: Math.max(1,Math.floor(numberValue(event.target.value))) })} /></Field>:null}<Field label="Norma na zmianę (8h)"><Input type="number" value={selected.shiftNorm} onChange={(event) => editTechnology(selected.id,{ shiftNorm: Math.max(0,numberValue(event.target.value)) })} /></Field><Field label="Krótki opis"><Input placeholder="np. Pakowanie w karton rozmiar 5" value={selected.description} onChange={(event) => editTechnology(selected.id,{ description: event.target.value })} /></Field><label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-dim md:col-span-2 xl:col-span-3"><span>Uwagi (opcjonalne)</span><textarea className="min-h-20 w-full rounded-xl border border-border bg-[rgba(0,0,0,0.4)] p-3 text-sm font-normal normal-case tracking-normal text-body focus:border-[rgba(255,106,0,0.55)] focus:outline-none" value={selected.notes} onChange={(event) => editTechnology(selected.id,{ notes: event.target.value })} /></label></div><div className="flex items-center justify-between"><SectionTitle title="Materiały technologii" subtitle="Zużycie jest podawane na jedną sztukę produktu. Ilość logistyczna jest tylko wskazówką i nie zaokrągla pobrania do pełnej palety." /><Button variant="outline" onClick={() => editTechnology(selected.id,{ materials: [...selected.materials,{ id: uid('mat'),code: '',name: '',category: 'Pozostałe',usage: 0,unit: 'szt.',logisticQty: 1 }] })}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="text-left text-xs uppercase text-dim"><tr><th className="p-2">Kod</th><th className="p-2">Nazwa materiału</th><th className="p-2">Rodzaj</th><th className="p-2">Zużycie / szt.</th><th className="p-2">J.m.</th><th className="p-2">Na palecie / w opakowaniu</th><th></th></tr></thead><tbody>{selected.materials.map((material) => <tr key={material.id} className="border-t border-border"><td className="p-2"><Input list="material-code-suggestions" value={material.code} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,code: event.target.value }:row) })} /></td><td className="p-2"><Input list="material-name-suggestions" value={material.name} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,name: event.target.value }:row) })} /></td><td className="p-2"><SelectField value={material.category} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,category: event.target.value as MaterialCategory }:row) })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td><td className="p-2"><Input type="number" step="0.0001" value={material.usage} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,usage: numberValue(event.target.value) }:row) })} /></td><td className="p-2"><Input value={material.unit} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,unit: event.target.value }:row) })} /></td><td className="p-2"><Input type="number" value={material.logisticQty} onChange={(event) => editTechnology(selected.id,{ materials: selected.materials.map((row) => row.id===material.id? { ...row,logisticQty: numberValue(event.target.value) }:row) })} /></td><td className="p-2"><Button variant="ghost" className="min-h-[38px] px-3 text-danger" onClick={() => editTechnology(selected.id,{ materials: selected.materials.filter((row) => row.id!==material.id) })}><Trash2 className="h-4 w-4" /></Button></td></tr>)}</tbody></table></div></Card>:<EmptyState title="Brak technologii" description="Dodaj pierwszą technologię bazową dla produktu." />}
      </div>
    </div>;
  };

  const renderInventory = () => <SpisRzeczywisty />;

  const renderCalculationDetails = (item: PlanItem) => {
    const technology = technologyForItem(item);
    const materials = materialsForItem(item);
    const remaining = Math.max(0, item.remainingQty || item.totalQty);
    const norm = Math.max(0, item.shiftNorm || technology?.shiftNorm || 0);
    const selectedQty = itemProductionQty(item);
    const currentDifference = currentPlanVersion?.differences.find((difference) => difference.itemId === item.id && (difference.kind === 'quantity_increased' || difference.kind === 'quantity_decreased'));
    const previousQty = typeof currentDifference?.previousValue === 'number' ? currentDifference.previousValue : item.totalQty;
    const updateScope = (patch: Pick<PlanItem, 'scopeMode' | 'scopeShifts' | 'scopeQuantity'>) => updateState((current) => ({
      ...current,
      plan: current.plan.map((row) => row.id === item.id ? { ...row, ...patch } : row)
    }));

    return <div className="space-y-5 bg-[rgba(255,255,255,0.012)] p-4 md:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <SectionTitle title={`${item.index} · ${item.name}`} subtitle="Plan, zakres, technologia i zapotrzebowanie materiałowe tej pozycji." />
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant={!item.scopeMode || item.scopeMode === 'global' ? 'secondary' : 'outline'} onClick={() => updateScope({ scopeMode: 'global', scopeShifts: item.scopeShifts, scopeQuantity: item.scopeQuantity })}>Zakres globalny</Button>
          <Button className="min-h-11" variant={item.scopeMode === 'all' ? 'secondary' : 'outline'} onClick={() => updateScope({ scopeMode: 'all', scopeShifts: item.scopeShifts, scopeQuantity: item.scopeQuantity })}>Cały pozostały plan</Button>
        </div>
      </div>

      <section className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-black uppercase text-dim">Plan i zakres</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-4">
          {[
            ['Plan łącznie', `${fmt(item.totalQty)} szt.`],
            ['Poprzednia ilość', `${fmt(previousQty)} szt.`],
            ['Aktualna ilość', `${fmt(item.totalQty)} szt.`],
            ['Różnica', `${item.totalQty - previousQty > 0 ? '+' : ''}${fmt(item.totalQty - previousQty)} szt.`],
            ['Pozostało', `${fmt(remaining)} szt.`],
            ['Norma / zmianę', `${fmt(norm)} szt.`],
            ['Wybrany zakres', itemScopeLabel(item)],
            ['Sztuk w zakresie', `${fmt(selectedQty)} szt.`]
          ].map(([label, value]) => <div key={label} className="min-h-20 border-l-2 border-border px-3 py-2"><p className="text-[11px] font-bold uppercase text-dim">{label}</p><p className="mt-2 break-words text-lg font-black text-title">{value}</p></div>)}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[220px_220px_1fr]">
          <Field label="Własna liczba zmian"><Input type="number" min="0.5" step="0.5" value={item.scopeShifts ?? state.horizonShifts} onChange={(event) => updateScope({ scopeMode: 'shifts', scopeShifts: Math.max(0.5, numberValue(event.target.value)), scopeQuantity: item.scopeQuantity })} /></Field>
          <Field label="Własna liczba sztuk"><Input type="number" min="0" value={item.scopeQuantity ?? 0} onChange={(event) => updateScope({ scopeMode: 'quantity', scopeShifts: item.scopeShifts, scopeQuantity: Math.max(0, numberValue(event.target.value)) })} /></Field>
          <div className="grid gap-2 sm:grid-cols-[minmax(120px,1fr)_auto_auto_auto_auto] sm:items-end"><Field label="Ręczna korekta ilości"><Input type="number" min="0" placeholder="np. 200" value={quantityInputs[item.id] ?? ''} onChange={(event) => setQuantityInputs((current) => ({ ...current, [item.id]: event.target.value }))} /></Field><Button variant="outline" onClick={() => applyQuantityCorrection(item, 'exact')}>Ustaw</Button><Button variant="outline" onClick={() => applyQuantityCorrection(item, 'increase')}>Dodaj</Button><Button variant="outline" onClick={() => applyQuantityCorrection(item, 'decrease')}>Odejmij</Button><Button title="Cofnij ostatnią korektę" variant="ghost" className="min-h-11 px-3" onClick={() => undoLastCorrection(item)}><Undo2 className="h-4 w-4" /></Button></div>
        </div>
      </section>

      <section className="space-y-3 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-xs font-black uppercase text-dim">Technologia</h3><p className="mt-1 text-sm text-muted">Zmiany robocze dotyczą tylko tej pozycji i nie nadpisują biblioteki.</p></div>{technology ? <SelectField className="max-w-md" value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}>{technologiesFor(item).map((variant) => <option key={variant.id} value={variant.id}>{technologyLabel(variant)} · {variant.description || 'bez opisu'}</option>)}</SelectField> : null}</div>

      {!technology ? <div className="flex flex-col gap-3 rounded-xl border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.07)] p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold text-warning">Najpierw wybierz lub dodaj technologię dla tej pozycji.</p><Button variant="outline" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}><Plus className="mr-2 h-4 w-4" />Dodaj technologię</Button></div> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={item.manualOverride ? 'warning' : 'success'}>{item.manualOverride ? 'Technologia robocza zmieniona' : technologyLabel(technology)}</Badge><span className="text-xs text-muted">{technology.description || 'Bez opisu'}</span></div>
          {item.manualOverride ? <Button variant="ghost" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, workingMaterials: cloneMaterials(technology.materials), manualOverride: false } : row) }))}><RefreshCw className="mr-2 h-4 w-4" />Przywróć wybraną</Button> : null}
        </div>
        {materials.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1900px] text-sm"><thead className="sticky top-0 bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim"><tr><th className="w-[320px] p-2">Kod i nazwa materiału</th><th className="w-40 p-2">Rodzaj</th><th className="w-28 p-2 text-right">Zużycie / szt.</th><th className="w-32 p-2 text-right">Cały plan</th><th className="w-32 p-2 text-right">Wybrany zakres</th><th className="w-28 p-2 text-right">Wydano</th><th className="w-28 p-2 text-right">Oczekuje</th><th className="w-28 p-2 text-right">Stan strefy</th><th className="w-28 p-2 text-right">Źródła wspólne</th><th className="w-28 p-2 text-right">Wydać teraz</th><th className="w-32 p-2 text-right">Bilans</th><th className="w-24 p-2">J.m.</th><th className="w-14"></th></tr></thead><tbody>{materials.map((material) => {
          const key = materialKey(material);
          const demand = selectedQty * material.usage;
          const fullDemand = remaining * material.usage;
          const supply = materialSupply(key, material, item.areaId);
          const itemShare = supply.demand > 0 ? Math.min(1, demand / supply.demand) : 0;
          const areaStock = supply.areaStock;
          const sharedStock = supply.sharedStock;
          const issued = supply.issued * itemShare;
          const pendingAmount = supply.pending * itemShare;
          const toIssue = supply.toIssue * itemShare;
          const covered = Math.max(0, demand - toIssue);
          const surplus = Math.max(0, areaStock + sharedStock + issued + pendingAmount - demand);
          return <tr key={material.id} className="border-t border-border align-top"><td className="space-y-2 p-2"><Input value={material.code} aria-label="Kod materiału" onChange={(event) => updateWorkingMaterial(item.id, material.id, { code: event.target.value })} /><Input list="material-name-suggestions" value={material.name} aria-label="Nazwa materiału" onChange={(event) => updateWorkingMaterial(item.id, material.id, { name: event.target.value })} /></td><td className="p-2"><SelectField value={material.category} onChange={(event) => updateWorkingMaterial(item.id, material.id, { category: event.target.value as MaterialCategory })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td><td className="p-2"><Input className="text-right" type="number" step="0.0001" value={material.usage} onChange={(event) => updateWorkingMaterial(item.id, material.id, { usage: Math.max(0, numberValue(event.target.value)) })} /></td><td className="p-2 text-right font-semibold">{fmt(fullDemand)}</td><td className="p-2 text-right font-black text-title">{fmt(demand)}</td><td className="p-2 text-right">{fmt(issued)}</td><td className="p-2 text-right text-warning">{fmt(pendingAmount)}</td><td className="p-2 text-right">{fmt(areaStock)}</td><td className="p-2 text-right">{fmt(sharedStock)}</td><td className="p-2 text-right font-black text-warning">{fmt(toIssue)}</td><td className={cn('p-2 text-right font-black', toIssue > 0 ? 'text-danger' : 'text-success')}>{toIssue > 0 ? `Brak ${fmt(toIssue)}` : surplus > 0 ? `Nadwyżka ${fmt(surplus)}` : `Pokryte ${fmt(covered)}`}</td><td className="p-2"><Input value={material.unit} onChange={(event) => updateWorkingMaterial(item.id, material.id, { unit: event.target.value })} /></td><td className="p-2"><Button title="Usuń materiał z technologii roboczej" variant="ghost" className="min-h-11 px-3 text-danger" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: materials.filter((entry) => entry.id !== material.id) } : row) }))}><Trash2 className="h-4 w-4" /></Button></td></tr>;
        })}</tbody></table></div> : <p className="text-sm text-muted">Technologia nie ma jeszcze materiałów.</p>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: [...materials, { id: uid('mat'), code: '', name: '', category: 'Pozostałe', usage: 0, unit: 'szt.', logisticQty: 1 }] } : row) }))}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button><Button variant="secondary" onClick={() => saveWorkingAsTechnology(item)}><Save className="mr-2 h-4 w-4" />Zapisz jako nową technologię w bibliotece</Button></div>
      </>}
      </section>
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

  const documentTone = (status: PickingDocumentStatus): 'default' | 'success' | 'warning' | 'danger' | 'info' => {
    if (status === 'issued') return 'success';
    if (status === 'handed') return 'info';
    if (status === 'outdated') return 'warning';
    if (status === 'cancelled') return 'danger';
    return 'default';
  };

  const createOrRefreshPickingDocument = () => {
    const rows = requirementsForArea(state.selectedAreaId)
      .filter((row) => row.toIssue > 0)
      .map<PickingDocumentRow>((row) => ({
        key: row.key,
        code: row.code,
        name: row.name,
        category: row.category,
        unit: row.unit,
        demand: row.demand,
        areaStock: row.areaStock,
        issuedBefore: row.issued,
        pendingBefore: row.pending,
        toIssue: row.toIssue,
        confirmed: false,
        sources: row.sources.map((source) => ({ ...source }))
      }));
    if (!rows.length) {
      flash('Dla wybranej strefy nie ma materiałów wymagających wydania.');
      return;
    }
    const createdAt = nowLabel();
    updateState((current) => {
      const lockedExists = current.documents.some((document) =>
        document.planDate === current.selectedPlanDate &&
        document.areaId === current.selectedAreaId &&
        (document.status === 'handed' || document.status === 'issued')
      );
      const kind: PickingDocumentKind = lockedExists ? 'correction' : 'base';
      const editable = current.documents.find((document) =>
        document.planDate === current.selectedPlanDate &&
        document.areaId === current.selectedAreaId &&
        document.kind === kind &&
        (document.status === 'draft' || document.status === 'outdated')
      );
      const activeVersion = current.planVersions.find((version) => version.id === current.activePlanVersionId)
        ?? current.planVersions
          .filter((version) => version.planDate === current.selectedPlanDate)
          .sort((left, right) => right.versionNo - left.versionNo)[0];
      const scopeLabel = current.calculationMode === 'all'
        ? 'Cały pozostały plan'
        : `${fmt(current.horizonShifts)} zmiany`;
      if (editable) {
        return {
          ...current,
          documents: current.documents.map((document) => document.id === editable.id ? {
            ...document,
            planVersionId: activeVersion?.id ?? '',
            planVersionNo: activeVersion?.versionNo ?? 0,
            scopeLabel,
            createdAt,
            createdBy: currentUserName,
            status: 'draft' as const,
            rows
          } : document)
        };
      }
      const sequence = current.documents.filter((document) =>
        document.planDate === current.selectedPlanDate && document.areaId === current.selectedAreaId
      ).length + 1;
      const areaCode = current.selectedAreaId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'STREFA';
      const document: PickingDocument = {
        id: uid('document'),
        documentNo: `${current.selectedPlanDate.replaceAll('-', '')}-${areaCode}-${String(sequence).padStart(2, '0')}`,
        planDate: current.selectedPlanDate,
        planVersionId: activeVersion?.id ?? '',
        planVersionNo: activeVersion?.versionNo ?? 0,
        areaId: current.selectedAreaId,
        scopeLabel,
        createdAt,
        createdBy: currentUserName,
        status: 'draft',
        kind,
        rows
      };
      return { ...current, documents: [document, ...current.documents] };
    });
    flash('Dokument do wypisania został zapisany jako roboczy.');
  };

  const changePickingDocumentStatus = (documentId: string, nextStatus: PickingDocumentStatus) => {
    const document = state.documents.find((item) => item.id === documentId);
    if (!document) return;
    const allowed =
      (nextStatus === 'handed' && document.status === 'draft') ||
      (nextStatus === 'issued' && document.status === 'handed') ||
      (nextStatus === 'cancelled' && ['draft', 'outdated', 'handed'].includes(document.status));
    if (!allowed) {
      flash('Ta zmiana statusu nie jest dozwolona.');
      return;
    }
    updateState((current) => ({
      ...current,
      documents: current.documents.map((item) => item.id === documentId ? {
        ...item,
        status: nextStatus,
        rows: nextStatus === 'issued' ? item.rows.map((row) => ({ ...row, confirmed: true })) : item.rows
      } : item)
    }));
    flash(`Dokument ma teraz status: ${documentStatusLabel[nextStatus]}.`);
  };

  const togglePickingConfirmation = (documentId: string, rowKey: string) => {
    const document = state.documents.find((item) => item.id === documentId);
    if (!document || document.status !== 'draft') return;
    updateState((current) => ({
      ...current,
      documents: current.documents.map((item) => item.id === documentId ? {
        ...item,
        rows: item.rows.map((row) => row.key === rowKey ? { ...row, confirmed: !row.confirmed } : row)
      } : item)
    }));
  };

  const exportPickingDocument = (pickingDocument: PickingDocument) => {
    const rows = [[
      'Dokument', 'Status', 'Typ', 'Data planu', 'Wersja planu', 'Strefa', 'Zakres', 'Materiał', 'Kod',
      'Zapotrzebowanie', 'Stan strefy', 'Wydano wcześniej', 'Oczekuje', 'Wydać teraz', 'J.m.', 'Źródła'
    ]];
    pickingDocument.rows.forEach((row) => rows.push([
      pickingDocument.documentNo,
      documentStatusLabel[pickingDocument.status],
      pickingDocument.kind === 'base' ? 'Podstawowy' : 'Korekta',
      pickingDocument.planDate,
      String(pickingDocument.planVersionNo),
      areaName(pickingDocument.areaId),
      pickingDocument.scopeLabel,
      row.name,
      row.code,
      String(row.demand),
      String(row.areaStock),
      String(row.issuedBefore),
      String(row.pendingBefore),
      String(row.toIssue),
      row.unit,
      row.sources.map((source) => `${source.index} - ${source.name}: ${fmt(source.demand)}`).join(' | ')
    ]));
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${pickingDocument.documentNo}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const deriveReturnsForDate = (planDate: string): MaterialReturnRow[] => {
    const datePlan = planDate === state.selectedPlanDate
      ? state.plan
      : state.dailyPlans[planDate]
        ?? state.planVersions
          .filter((version) => version.planDate === planDate)
          .sort((left, right) => right.versionNo - left.versionNo)[0]?.items
        ?? [];
    const allocations = new Map<string, {
      materialKey: string;
      code: string;
      name: string;
      category: MaterialCategory;
      unit: string;
      planItemId: string;
      index: string;
      productName: string;
      areaId: string;
      issued: number;
    }>();
    state.documents
      .filter((document) => document.planDate === planDate && document.status === 'issued')
      .forEach((document) => document.rows.forEach((row) => {
        allocateAmountByDemand(row.toIssue, row.sources).forEach((source) => {
          const key = `${document.areaId}|${row.key}|${source.planItemId}`;
          const current = allocations.get(key) ?? {
            materialKey: row.key,
            code: row.code,
            name: row.name,
            category: row.category,
            unit: row.unit,
            planItemId: source.planItemId,
            index: source.index,
            productName: source.name,
            areaId: document.areaId,
            issued: 0
          };
          current.issued += source.allocated;
          allocations.set(key, current);
        });
      }));

    return [...allocations.values()].map((allocation) => {
      const item = datePlan.find((entry) => entry.id === allocation.planItemId);
      const material = item ? materialsForItem(item).find((entry) => materialKey(entry) === allocation.materialKey) : undefined;
      const currentNeed = item && item.included && item.areaId === allocation.areaId && material
        ? itemProductionQty(item) * material.usage
        : 0;
      const surplus = calculateReturnSurplus(allocation.issued, currentNeed);
      if (surplus <= 0.000001) return null;
      let reason = 'Zmniejszenie ilości produkcji';
      if (!item || !item.included) reason = 'Pozycja usunięta lub wyłączona z planu';
      else if (!material) reason = 'Zmiana technologii lub materiału';
      let destination = 'Zwrot do magazynu';
      if (planDate === state.selectedPlanDate) {
        const targetArea = state.areas
          .filter((area) => !area.shared && area.id !== allocation.areaId)
          .find((area) => requirementsForArea(area.id).some((requirement) => requirement.key === allocation.materialKey && requirement.toIssue > 0));
        if (targetArea) destination = `Przesunięcie do: ${targetArea.name}`;
      }
      const id = `${planDate}|${allocation.areaId}|${allocation.materialKey}|${allocation.planItemId}`;
      return {
        id,
        planDate,
        ...allocation,
        reason,
        currentNeed,
        surplus,
        destination,
        status: state.returnStatuses[id] ?? 'open'
      } satisfies MaterialReturnRow;
    }).filter((row): row is MaterialReturnRow => Boolean(row));
  };

  const renderDocumentV2 = () => {
    const documents = state.documents
      .filter((document) => document.planDate === state.selectedPlanDate && document.areaId === state.selectedAreaId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt, 'pl'));
    return <div className="space-y-5">
      {renderHeader('Dokument do wypisania', 'Każda strefa otrzymuje osobny, zapisany dokument. Po przekazaniu lub wydaniu jego ilości pozostają niezmienne.')}
      <Card className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.6fr)_minmax(260px,1fr)_auto] lg:items-end">
          <Field label="Data planu"><Input type="date" value={state.selectedPlanDate} onChange={(event) => selectPlanDate(event.target.value)} /></Field>
          <Field label="Strefa"><SelectField value={state.selectedAreaId} onChange={(event) => updateState((current) => ({ ...current, selectedAreaId: event.target.value }))}>{state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</SelectField></Field>
          <Button onClick={createOrRefreshPickingDocument}><FilePlus2 className="mr-2 h-4 w-4" />{documents.some((document) => document.status === 'draft' || document.status === 'outdated') ? 'Przelicz dokument roboczy' : 'Utwórz dokument'}</Button>
        </div>
        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <Stat label="Do wydania teraz" value={`${documentRows.length} pozycji`} tone={documentRows.length ? 'warning' : 'success'} />
          <Stat label="Dokumenty dla strefy" value={String(documents.length)} />
          <Stat label="Aktualna wersja planu" value={currentPlanVersion ? `Wersja ${currentPlanVersion.versionNo}` : 'Brak'} />
        </div>
      </Card>

      {documents.length ? documents.map((document) => {
        const expanded = expandedDocument === document.id;
        const locked = document.status === 'handed' || document.status === 'issued';
        return <Card key={document.id} className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => setExpandedDocument(expanded ? '' : document.id)}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted">{expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</span>
              <span className="min-w-0"><span className="block break-words font-black text-title">{document.documentNo}</span><span className="mt-1 block text-xs text-muted">{formatPlanDate(document.planDate)} · wersja {document.planVersionNo || '—'} · {document.scopeLabel} · {document.createdBy} · {document.createdAt}</span></span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={document.kind === 'correction' ? 'warning' : 'info'}>{document.kind === 'correction' ? 'Korekta' : 'Podstawowy'}</Badge>
              <Badge tone={documentTone(document.status)}>{documentStatusLabel[document.status]}</Badge>
              {(document.status === 'draft' || document.status === 'outdated') ? <Button variant="outline" onClick={createOrRefreshPickingDocument}><RefreshCw className="mr-2 h-4 w-4" />Przelicz</Button> : null}
              {document.status === 'draft' ? <Button variant="secondary" onClick={() => changePickingDocumentStatus(document.id, 'handed')}><PackageCheck className="mr-2 h-4 w-4" />Przekaż</Button> : null}
              {document.status === 'handed' ? <Button variant="secondary" onClick={() => changePickingDocumentStatus(document.id, 'issued')}><Check className="mr-2 h-4 w-4" />Oznacz jako wydany</Button> : null}
              {['draft', 'outdated', 'handed'].includes(document.status) ? <Button variant="ghost" className="text-danger" onClick={() => changePickingDocumentStatus(document.id, 'cancelled')}><X className="mr-2 h-4 w-4" />Anuluj</Button> : null}
              <Button title="Pobierz dokument CSV" variant="ghost" className="min-h-11 px-3" onClick={() => exportPickingDocument(document)}><FileDown className="h-4 w-4" /></Button>
            </div>
          </div>
          {expanded ? <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="sticky top-0 z-10 bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim"><tr><th className="w-14 p-3"><span className="sr-only">Źródła</span></th><th className="p-3">Materiał</th><th className="p-3 text-right">Zapotrzebowanie</th><th className="p-3 text-right">Stan strefy</th><th className="p-3 text-right">Już wydano</th><th className="p-3 text-right">Oczekuje</th><th className="p-3 text-right">Wydać teraz</th><th className="p-3">J.m.</th><th className="p-3">Potwierdzenie</th></tr></thead>
              <tbody>{document.rows.map((row) => {
                const sourceKey = `${document.id}|${row.key}`;
                const sourcesExpanded = expandedMaterial === sourceKey;
                return <Fragment key={row.key}><tr className="border-t border-border"><td className="p-3"><button type="button" title={sourcesExpanded ? 'Ukryj źródła zapotrzebowania' : 'Pokaż indeksy źródłowe'} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted" onClick={() => setExpandedMaterial(sourcesExpanded ? '' : sourceKey)}>{sourcesExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></td><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="break-words text-muted">{row.name}</p></td><td className="p-3 text-right">{fmt(row.demand)}</td><td className="p-3 text-right">{fmt(row.areaStock)}</td><td className="p-3 text-right">{fmt(row.issuedBefore)}</td><td className="p-3 text-right text-warning">{fmt(row.pendingBefore)}</td><td className="p-3 text-right text-lg font-black text-title">{fmt(row.toIssue)}</td><td className="p-3">{row.unit}</td><td className="p-3"><button type="button" disabled={locked || document.status !== 'draft'} onClick={() => togglePickingConfirmation(document.id, row.key)} className={cn('flex min-h-11 items-center gap-2 rounded-lg border px-3 font-bold', row.confirmed ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_14%,transparent)] text-success' : 'border-border text-muted', (locked || document.status !== 'draft') && 'cursor-default opacity-80')}><Check className="h-4 w-4" />{document.status === 'issued' ? 'Wydano' : row.confirmed ? 'Sprawdzone' : 'Do potwierdzenia'}</button></td></tr>{sourcesExpanded ? <tr className="border-t border-border bg-[rgba(255,255,255,0.025)]"><td colSpan={9} className="px-5 py-4"><p className="text-xs font-bold uppercase text-dim">Źródła zapotrzebowania</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{row.sources.map((source) => <div key={`${source.planItemId}-${source.index}`} className="border-l-2 border-brand pl-3"><p className="font-bold text-title">{source.index}</p><p className="break-words text-sm text-muted">{source.name}</p><p className="mt-1 text-xs text-dim">{fmt(source.demand)} {row.unit}</p></div>)}</div></td></tr> : null}</Fragment>;
              })}</tbody>
            </table>
          </div> : null}
        </Card>;
      }) : <EmptyState title="Brak zapisanych dokumentów" description="Wybierz strefę i utwórz dokument z aktualnego planu. Jeżeli materiały są już pokryte, dokument nie będzie potrzebny." />}
    </div>;
  };

  const renderReturnsV2 = () => {
    const returnRows = deriveReturnsForDate(state.selectedPlanDate);
    const openRows = returnRows.filter((row) => row.status === 'open');
    return <div className="space-y-5">
      {renderHeader('Zwroty', 'Nadwyżki powstają wyłącznie z materiałów wcześniej oznaczonych jako wydane. Zmniejszenie lub usunięcie planu nigdy nie tworzy ujemnego wydania.')}
      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(220px,360px)_1fr] sm:items-end"><Field label="Data planu"><Input type="date" value={state.selectedPlanDate} onChange={(event) => selectPlanDate(event.target.value)} /></Field><p className="text-sm text-muted">Propozycja przesunięcia uwzględnia bieżące braki innych stref dla tej samej daty.</p></div>
        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3"><Stat label="Otwarte zwroty" value={String(openRows.length)} tone={openRows.length ? 'warning' : 'success'} /><Stat label="Łącznie pozycji" value={String(returnRows.length)} /><Stat label="Data" value={formatPlanDate(state.selectedPlanDate)} /></div>
      </Card>
      {returnRows.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[1220px] text-sm"><thead className="sticky top-0 z-10 bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim"><tr><th className="p-3">Materiał</th><th className="p-3">Indeks produkcyjny</th><th className="p-3">Strefa</th><th className="p-3">Przyczyna</th><th className="p-3 text-right">Wydano</th><th className="p-3 text-right">Aktualna potrzeba</th><th className="p-3 text-right">Nadwyżka</th><th className="p-3">Proponowane miejsce</th><th className="p-3">Status</th></tr></thead><tbody>{returnRows.map((row) => <tr key={row.id} className={cn('border-t border-border', row.status === 'completed' && 'bg-[color:color-mix(in_srgb,var(--success)_7%,transparent)]')}><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="break-words text-muted">{row.name}</p></td><td className="p-3"><p className="font-bold text-title">{row.index}</p><p className="break-words text-xs text-muted">{row.productName}</p></td><td className="p-3">{areaName(row.areaId)}</td><td className="p-3">{row.reason}</td><td className="p-3 text-right">{fmt(row.issued)} {row.unit}</td><td className="p-3 text-right">{fmt(row.currentNeed)} {row.unit}</td><td className="p-3 text-right text-lg font-black text-warning">{fmt(row.surplus)} {row.unit}</td><td className="p-3"><Badge tone={row.destination.startsWith('Przesunięcie') ? 'info' : 'default'}>{row.destination}</Badge></td><td className="p-3"><Button variant={row.status === 'completed' ? 'ghost' : 'secondary'} onClick={() => updateState((current) => ({ ...current, returnStatuses: { ...current.returnStatuses, [row.id]: row.status === 'completed' ? 'open' : 'completed' } }))}>{row.status === 'completed' ? <Undo2 className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}{row.status === 'completed' ? 'Przywróć' : 'Wykonano'}</Button></td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak materiałów do zwrotu" description="Zwroty pojawią się po wydaniu materiału i późniejszym zmniejszeniu, usunięciu lub zmianie technologii pozycji planu." />}
    </div>;
  };

  const renderHistoryV2 = () => {
    const versions = [...state.planVersions].sort((left, right) => right.planDate.localeCompare(left.planDate) || right.versionNo - left.versionNo);
    const corrections = [...state.quantityCorrections].sort((left, right) => right.createdAt.localeCompare(left.createdAt, 'pl'));
    const documents = [...state.documents].sort((left, right) => right.planDate.localeCompare(left.planDate) || right.createdAt.localeCompare(left.createdAt, 'pl'));
    const returnDates = [...new Set(state.documents.filter((document) => document.status === 'issued').map((document) => document.planDate))];
    const returnRows = returnDates.flatMap(deriveReturnsForDate);
    return <div className="space-y-5">
      {renderHeader('Historia', 'Wersje planów, korekty, dokumenty i zwroty pozostają zapisane. Kolejny import nie usuwa wcześniejszych danych.')}

      <section className="space-y-3"><SectionTitle title="Wersje planów" subtitle={`${versions.length} zapisanych wersji`} />{versions.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Data / wersja</th><th className="p-3">Import</th><th className="p-3">Plik / arkusz</th><th className="p-3">Status</th><th className="p-3">Różnice</th></tr></thead><tbody>{versions.map((version) => <tr key={version.id} className="border-t border-border align-top"><td className="p-3"><p className="font-black text-title">{formatPlanDate(version.planDate)}</p><p className="text-muted">Wersja {version.versionNo}</p></td><td className="p-3"><p>{version.importedAt}</p><p className="text-xs text-muted">{version.importedBy}</p></td><td className="p-3"><p className="break-words font-semibold text-title">{version.fileName}</p><p className="text-xs text-muted">{version.sheetName}</p></td><td className="p-3"><Badge tone={version.status === 'active' ? 'success' : version.status === 'superseded' ? 'default' : 'warning'}>{version.status === 'active' ? 'Aktywny' : version.status === 'superseded' ? 'Zastąpiony' : version.status === 'ready' ? 'Gotowy' : 'Roboczy'}</Badge></td><td className="p-3"><div className="flex max-w-[420px] flex-wrap gap-1.5">{version.differences.length ? version.differences.map((difference) => <Badge key={difference.id} tone={difference.kind === 'removed' ? 'danger' : difference.kind === 'quantity_decreased' ? 'warning' : 'info'}>{differenceLabel[difference.kind]} · {difference.index}</Badge>) : <span className="text-muted">Pierwsza wersja lub brak różnic</span>}</div></td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak wersji planów" description="Pierwszy import utworzy wersję 1 dla wybranej daty." />}</section>

      <section className="space-y-3"><SectionTitle title="Ręczne korekty ilości" subtitle={`${corrections.length} operacji`} />{corrections.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Data planu</th><th className="p-3">Pozycja</th><th className="p-3 text-right">Poprzednio</th><th className="p-3 text-right">Nowa ilość</th><th className="p-3 text-right">Różnica</th><th className="p-3">Użytkownik / czas</th><th className="p-3">Status</th></tr></thead><tbody>{corrections.map((correction) => <tr key={correction.id} className="border-t border-border"><td className="p-3">{formatPlanDate(correction.planDate)}</td><td className="p-3"><p className="font-bold text-title">{correction.index}</p><p className="text-xs text-muted">{correction.name}</p></td><td className="p-3 text-right">{fmt(correction.previousValue)}</td><td className="p-3 text-right">{fmt(correction.newValue)}</td><td className={cn('p-3 text-right font-black', correction.difference > 0 ? 'text-success' : 'text-warning')}>{correction.difference > 0 ? '+' : ''}{fmt(correction.difference)}</td><td className="p-3"><p>{correction.createdBy}</p><p className="text-xs text-muted">{correction.createdAt}</p></td><td className="p-3"><Badge tone={correction.revertedAt ? 'default' : 'info'}>{correction.revertedAt ? 'Cofnięta' : correction.source}</Badge></td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak ręcznych korekt" description="Zmiana dokładna, + lub - przy pozycji planu pojawi się tutaj." />}</section>

      <section className="space-y-3"><SectionTitle title="Dokumenty i wydania" subtitle={`${documents.length} dokumentów`} />{documents.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Dokument</th><th className="p-3">Data / strefa</th><th className="p-3">Wersja i zakres</th><th className="p-3">Utworzył</th><th className="p-3">Typ</th><th className="p-3">Status</th><th className="p-3 text-right">Pozycje</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id} className="border-t border-border"><td className="p-3 font-black text-title">{document.documentNo}</td><td className="p-3"><p>{formatPlanDate(document.planDate)}</p><p className="text-xs text-muted">{areaName(document.areaId)}</p></td><td className="p-3"><p>Wersja {document.planVersionNo || '—'}</p><p className="text-xs text-muted">{document.scopeLabel}</p></td><td className="p-3"><p>{document.createdBy}</p><p className="text-xs text-muted">{document.createdAt}</p></td><td className="p-3"><Badge tone={document.kind === 'correction' ? 'warning' : 'info'}>{document.kind === 'correction' ? 'Korekta' : 'Podstawowy'}</Badge></td><td className="p-3"><Badge tone={documentTone(document.status)}>{documentStatusLabel[document.status]}</Badge></td><td className="p-3 text-right">{document.rows.length}</td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak dokumentów" description="Dokumenty podstawowe i korekty pojawią się po ich utworzeniu." />}</section>

      <section className="space-y-3"><SectionTitle title="Zwroty" subtitle={`${returnRows.length} wykrytych pozycji`} />{returnRows.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[880px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Data</th><th className="p-3">Materiał</th><th className="p-3">Indeks</th><th className="p-3">Przyczyna</th><th className="p-3 text-right">Nadwyżka</th><th className="p-3">Status</th></tr></thead><tbody>{returnRows.map((row) => <tr key={row.id} className="border-t border-border"><td className="p-3">{formatPlanDate(row.planDate)}</td><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="text-xs text-muted">{row.name}</p></td><td className="p-3">{row.index}</td><td className="p-3">{row.reason}</td><td className="p-3 text-right font-black text-warning">{fmt(row.surplus)} {row.unit}</td><td className="p-3"><Badge tone={row.status === 'completed' ? 'success' : 'warning'}>{row.status === 'completed' ? 'Wykonany' : 'Otwarty'}</Badge></td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak zwrotów" description="Historia zwrotów pojawi się po zmianie planu następującej po wydaniu materiałów." />}</section>

      {state.archive.length ? <section className="space-y-3"><SectionTitle title="Wstrzymane i zakończone produkcje" subtitle={`${state.archive.length} pozycji`} /><div className="divide-y divide-border border-y border-border">{state.archive.map((entry) => <div key={entry.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap gap-2"><Badge tone={entry.status === 'suspended' ? 'warning' : 'success'}>{entry.status === 'suspended' ? 'Wstrzymana' : 'Zakończona'}</Badge>{entry.planItem.manualOverride ? <Badge tone="info">Technologia robocza</Badge> : null}</div><p className="mt-2 font-bold text-title">{entry.planItem.index} · {entry.planItem.name}</p><p className="mt-1 text-sm text-muted">{entry.planItem.station || 'Brak stanowiska'} · {entry.technologyName} · {entry.at}</p><p className="mt-1 text-xs text-dim">{entry.reason}</p></div>{entry.status === 'suspended' && !readOnly ? <Button variant="ghost" onClick={() => updateState((current) => ({ ...current, archive: current.archive.map((row) => row.id === entry.id ? { ...row, status: 'completed', reason: 'Produkcja zakończona ręcznie', at: nowLabel() } : row) }))}><Archive className="mr-2 h-4 w-4" />Zakończ produkcję</Button> : null}</div>)}</div></section> : null}
    </div>;
  };

  const renderSettings = () => <div className="space-y-5">{renderHeader('Ustawienia modułu', 'Przypisz stanowiska do obszarów. Import planu będzie uzupełniał halę automatycznie na podstawie tej listy.')}<Card className="space-y-4"><div className="flex items-center justify-between"><SectionTitle title="Stanowiska i obszary" subtitle="Domyślnie WTR 1–28 należą do Hali 1, a WTR 29–52 do Hali 2." /><Button variant="outline" onClick={() => updateState((current) => ({ ...current, stationMappings: [...current.stationMappings, { station: '', areaId: 'hala-1' }] }))}><Plus className="mr-2 h-4 w-4" />Dodaj</Button></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{state.stationMappings.map((mapping, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-border p-2"><Input value={mapping.station} placeholder="np. WTR 12 lub ST 3" onChange={(event) => updateState((current) => ({ ...current, stationMappings: current.stationMappings.map((row, rowIndex) => rowIndex === index ? { ...row, station: event.target.value } : row) }))} /><SelectField value={mapping.areaId} onChange={(event) => updateState((current) => ({ ...current, stationMappings: current.stationMappings.map((row, rowIndex) => rowIndex === index ? { ...row, areaId: event.target.value } : row) }))}>{state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</SelectField><Button variant="ghost" className="min-h-[44px] px-3 text-danger" onClick={() => updateState((current) => ({ ...current, stationMappings: current.stationMappings.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button></div>)}</div></Card></div>;

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
    dokument: renderDocumentV2,
    zwroty: renderReturnsV2,
    historia: renderHistoryV2,
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
