'use client';

import { forwardRef, Fragment, useCallback, useDeferredValue, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
  FilePlus2,
  Factory,
  GitMerge,
  Link2,
  ListFilter,
  MapPin,
  Minus,
  PackageCheck,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Undo2,
  Upload,
  Warehouse,
  X
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input as BaseInput } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import SpisRzeczywisty from '@/components/planowanie-zapotrzebowania/SpisRzeczywisty';
import { PlanningSaveNotice, PlanningSaveStatus } from '@/components/planowanie-zapotrzebowania/PlanningSaveStatus';
import { usePlanningAutosave } from '@/lib/planowanie-zapotrzebowania/usePlanningAutosave';
import { PlanQuantity, PlanQuantityWarnings } from '@/components/planowanie-zapotrzebowania/PlanQuantity';
import { knownRemainingQuantity, planningSections, quantityNeedsReview, readPlanningRows, splitPlanningRowOutputs, type PlanQuantityStatus, type PlanSourceFields } from '@/lib/planowanie-zapotrzebowania/planImport';
import { isReadOnly } from '@/lib/auth/access';
import { useUiStore } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';
import type {
  ProductCatalogItem,
  ProductCatalogSearchMode
} from '@/lib/planowanie-zapotrzebowania/productCatalogSearch';

import {
  calculateIssueBalance,
  calculateScopedQuantity,
  coalesceQuantityCorrection,
  diffPlanItems,
  effectiveProducerQuantity,
  latestPlanVersion,
  nextPlanVersionNumber,
  setRemainingQuantity,
  type PlanDifference,
  type TechnologyProductionMode
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

type LinkedProduct = {
  id: string;
  productIndex: string;
  productName: string;
  usage: number;
  unit: string;
};

type LinkedSourceMode = 'unselected' | 'warehouse' | 'production' | 'mixed';

type LinkedSourceSelection = {
  mode: LinkedSourceMode;
  producerPlanItemId: string;
  productionQuantity: number;
};

type Technology = {
  id: string;
  productIndex: string;
  productName: string;
  variant: 'base' | 'alternative';
  alternativeNo: number;
  description: string;
  notes: string;
  productionMode?: TechnologyProductionMode;
  shiftNorm: number;
  materials: TechnologyMaterial[];
  linkedProducts?: LinkedProduct[];
  surplusMaterials?: TechnologyMaterial[];
  emergencyMaterials?: TechnologyMaterial[];
  archived: boolean;
};

type PlanGroup = 'standard' | 'emergency' | 'planned';
type ItemScopeMode = 'global' | 'shifts' | 'quantity' | 'all';
type PackagingMode = 'base' | 'emergency';
type PlanVersionStatus = 'draft' | 'ready' | 'active' | 'superseded';

type PlanItem = PlanSourceFields & {
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
  packagingMode?: PackagingMode;
  manualOverride: boolean;
  continuationCandidateId: string;
  planGroup?: PlanGroup;
  plannedDate?: string;
  scopeMode?: ItemScopeMode;
  scopeShifts?: number;
  scopeQuantity?: number;
  productionGroupId?: string;
  linkedSources?: Record<string, LinkedSourceSelection>;
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
  previousQuantityStatus?: PlanQuantityStatus;
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
  areaId: string;
  reason: string;
  inventoried: number;
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
const LOCAL_KEY = 'apka-kamila-planowanie-zapotrzebowania-v2';
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
const PACKAGING_CATEGORIES = new Set<MaterialCategory>(['Karton', 'Przekładka', 'Opakowanie']);
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
    // A technical qualifier such as (MUCELL) or (R4 600) is part of the name.
    const isIndex = (part: string) => /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/i.test(part) && /\d{3}/.test(part);
    const groups = [...value.matchAll(/\(([^()]*)\)/g)].filter((match) =>
      match[1].split(/\s*[,;+]\s*/).every((part) => isIndex(part.trim()))
    );
    if (groups.length === 1) {
      const match = groups[0];
      const productName = `${value.slice(0, match.index)} ${value.slice(match.index! + match[0].length)}`.replace(/\s+/g, ' ').trim();
      if (productName) return { name: productName, index: match[1].trim() };
    }
    // Unbracketed indices need stronger evidence, so short model numbers stay in the name.
    if (!groups.length) {
      const match = value.match(/^(.*?)\s+([^\s()]+)$/);
      if (match && isIndex(match[2]) && (match[2].match(/\d/g)?.length ?? 0) >= 7) {
        return { name: match[1].trim(), index: match[2] };
      }
    }
    return null;
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
const materialIdentityMatches = (
  material: Pick<TechnologyMaterial, 'code' | 'name'>,
  stock: Pick<TechnologyMaterial, 'code' | 'name'>
) => Boolean(
  (normalize(material.code) && normalize(material.code) === normalize(stock.code)) ||
  (normalize(material.name) && normalize(material.name) === normalize(stock.name))
);
const isPackagingMaterial = (material: Pick<TechnologyMaterial, 'category'>) =>
  PACKAGING_CATEGORIES.has(material.category);
const technologyMaterialsForMode = (technology: Technology, mode: PackagingMode) => {
  const baseMaterials = Array.isArray(technology.materials) ? technology.materials : [];
  const emergencyMaterials = Array.isArray(technology.emergencyMaterials) ? technology.emergencyMaterials : [];
  if (mode !== 'emergency' || !emergencyMaterials.length) return baseMaterials;
  return [...baseMaterials.filter((material) => !isPackagingMaterial(material)), ...emergencyMaterials];
};
const migrateLegacyEmergencyTechnologies = (technologies: Technology[]) => {
  const recipeSignature = (materials: TechnologyMaterial[]) => materials
    .map((material) => [
      normalize(material.code),
      normalize(material.name),
      material.category,
      Number(material.usage),
      normalize(material.unit),
      Number(material.logisticQty)
    ].join('|'))
    .sort()
    .join('||');
  const sameProduct = (left: Technology, right: Technology) => Boolean(
    (normalize(left.productIndex) && normalize(left.productIndex) === normalize(right.productIndex)) ||
    (normalize(left.productName) && normalize(left.productName) === normalize(right.productName))
  );
  const migrated = technologies.map((technology) => ({ ...technology, emergencyMaterials: [] }));
  const alternativeByBaseId: Record<string, string> = {};

  technologies.forEach((source) => {
    const emergencyMaterials = Array.isArray(source.emergencyMaterials) ? source.emergencyMaterials : [];
    if (!emergencyMaterials.length) return;
    const completeRecipe = technologyMaterialsForMode(source, 'emergency');
    const signature = recipeSignature(completeRecipe);
    const existing = migrated.find((candidate) => (
      candidate.id !== source.id &&
      candidate.variant === 'alternative' &&
      sameProduct(candidate, source) &&
      recipeSignature(candidate.materials) === signature
    ));
    if (existing) {
      alternativeByBaseId[source.id] = existing.id;
      return;
    }

    const variants = migrated.filter((candidate) => sameProduct(candidate, source));
    const alternativeNo = Math.max(
      0,
      ...variants.filter((candidate) => candidate.variant === 'alternative').map((candidate) => candidate.alternativeNo)
    ) + 1;
    const variantId = `${source.id}-legacy-emergency`;
    const description = emergencyMaterials
      .map((material) => material.name.trim() || material.code.trim())
      .filter(Boolean)
      .join(' + ') || `Wariant awaryjny ${alternativeNo}`;
    migrated.push({
      ...source,
      id: variantId,
      variant: 'alternative',
      alternativeNo,
      description,
      materials: completeRecipe.map((material, index) => ({
        ...material,
        id: `${variantId}-material-${index + 1}`
      })),
      emergencyMaterials: []
    });
    alternativeByBaseId[source.id] = variantId;
  });

  return { technologies: migrated, alternativeByBaseId };
};
const normalizedMaterialUnit = (unit: unknown) => normalize(unit).replaceAll('.', '');
const isKilogramUnit = (unit: unknown) => ['kg', 'kilogram', 'kilogramy', 'kilograma'].includes(normalizedMaterialUnit(unit));
const isGramUnit = (unit: unknown) => ['g', 'gram', 'gramy', 'grama'].includes(normalizedMaterialUnit(unit));
const isThousandPiecesUnit = (unit: unknown) =>
  ['1000szt', '1000sztuk', 'tysszt', 'tyssztuk'].includes(normalizedMaterialUnit(unit).replace(/\s+/g, ''));
const technologyResultUnit = (unit: unknown) => isThousandPiecesUnit(unit) ? 'szt.' : String(unit ?? '').trim() || 'szt.';
const technologyResultQuantity = (value: number, unit: unknown) => isThousandPiecesUnit(unit) ? value * 1000 : value;
const roundTechnologyMaterialQuantity = (value: number, unit: unknown) => {
  const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
  if (isKilogramUnit(unit) || isGramUnit(unit)) return safeValue;
  const unitScale = isThousandPiecesUnit(unit) ? 1000 : 1;
  const scaledValue = safeValue * unitScale;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaledValue)) * 8;
  return Math.ceil(scaledValue - tolerance) / unitScale;
};
const canonicalProductIndex = (value: unknown) => normalize(value).replace(/^m\s*-\s*10\s*-\s*/, '');
const linkedProductKey = (link: Pick<LinkedProduct, 'id' | 'productIndex' | 'productName'>) =>
  canonicalProductIndex(link.productIndex) || normalize(link.productName) || link.id;
const linkedProductMatchesPlanItem = (
  link: Pick<LinkedProduct, 'productIndex' | 'productName'>,
  item: Pick<PlanItem, 'index' | 'name'>
) => Boolean(
  (canonicalProductIndex(link.productIndex) && canonicalProductIndex(link.productIndex) === canonicalProductIndex(item.index)) ||
  (normalize(link.productName) && normalize(link.productName) === normalize(item.name))
);
const linkedSourceSelectionForItem = (item: Pick<PlanItem, 'linkedSources'>, link: LinkedProduct): LinkedSourceSelection =>
  item.linkedSources?.[linkedProductKey(link)] ?? { mode: 'unselected', producerPlanItemId: '', productionQuantity: 0 };
const linkedMachineProductQuantity = (consumerQuantity: number, selection: LinkedSourceSelection) => {
  const safeQuantity = Math.max(0, Number.isFinite(consumerQuantity) ? consumerQuantity : 0);
  if (selection.mode === 'production') return safeQuantity;
  if (selection.mode !== 'mixed') return 0;
  return Math.min(safeQuantity, Math.max(0, Number.isFinite(selection.productionQuantity) ? selection.productionQuantity : 0));
};
const linkedWarehouseProductQuantity = (consumerQuantity: number, selection: LinkedSourceSelection) => {
  if (selection.mode === 'unselected') return 0;
  return Math.max(0, consumerQuantity - linkedMachineProductQuantity(consumerQuantity, selection));
};
const linkedSurplusQuantity = (producerQuantity: number, allocatedQuantity: number) =>
  Math.max(0, producerQuantity - allocatedQuantity);
const normalizeLinkedSources = (value: unknown): Record<string, LinkedSourceSelection> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const source = raw as Partial<LinkedSourceSelection>;
    const mode: LinkedSourceMode = ['warehouse', 'production', 'mixed'].includes(String(source.mode))
      ? source.mode as LinkedSourceMode
      : 'unselected';
    return [[key, {
      mode,
      producerPlanItemId: String(source.producerPlanItemId ?? ''),
      productionQuantity: Math.max(0, numberValue(source.productionQuantity))
    }]];
  }));
};
const technologyUsageInputUnit = (material: Pick<TechnologyMaterial, 'unit'>) =>
  isKilogramUnit(material.unit) || isGramUnit(material.unit)
    ? 'g'
    : isThousandPiecesUnit(material.unit) ? 'szt.' : material.unit || 'szt.';
const technologyUsageForEditor = (material: Pick<TechnologyMaterial, 'usage' | 'unit'>) =>
  isKilogramUnit(material.unit) || isThousandPiecesUnit(material.unit) ? material.usage * 1000 : material.usage;
const technologyUsageFromEditor = (material: Pick<TechnologyMaterial, 'unit'>, value: number) =>
  isKilogramUnit(material.unit) || isThousandPiecesUnit(material.unit) ? value / 1000 : value;
const technologyMaterialWithUnit = (material: TechnologyMaterial, unit: string): TechnologyMaterial => {
  const visibleUsage = technologyUsageForEditor(material);
  const next = { ...material, unit };
  return { ...next, usage: technologyUsageFromEditor(next, visibleUsage) };
};
const fmt = (value: number) => (Math.abs(value) < 1e-9 ? 0 : value).toLocaleString('pl-PL', { maximumFractionDigits: 3 });
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
  workingMaterials: item.workingMaterials ? item.workingMaterials.map((material) => ({ ...material })) : null,
  linkedSources: normalizeLinkedSources(item.linkedSources)
}));
const documentStatusLabel: Record<PickingDocumentStatus, string> = { draft: 'Roboczy', handed: 'Przekazany', issued: 'Wydany', cancelled: 'Anulowany', outdated: 'Nieaktualny' };
const pickingRowWasWritten = (
  document: Pick<PickingDocument, 'status'>,
  row: Pick<PickingDocumentRow, 'confirmed'>
) => document.status === 'issued' || (document.status !== 'cancelled' && Boolean(row.confirmed));
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
    shiftNorm: item.productionGroupId && item.shiftNorm > 0 ? item.shiftNorm : technology.shiftNorm || item.shiftNorm,
    workingMaterials: cloneMaterials(technology.materials),
    linkedSources: item.linkedSources ?? {},
    packagingMode: 'base' as const,
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

const catalogMaterialPatch = (material: TechnologyMaterial, item: ProductCatalogItem): Partial<TechnologyMaterial> => {
  const withCatalogUnit = technologyMaterialWithUnit(material, item.unit || material.unit);
  return {
    code: item.index || material.code,
    name: item.name || material.name,
    usage: withCatalogUnit.usage,
    unit: withCatalogUnit.unit,
    category: inferCategory(material.category, item.name, `${item.index} ${item.warehouseCode ?? ''}`)
  };
};

const findExactCatalogItem = (items: ProductCatalogItem[], mode: 'code' | 'name', value: string) => {
  const query = normalize(value);
  if (!query) return undefined;
  return items
    .filter((item) => normalize(mode === 'name' ? item.name : item.index) === query)
    .sort((left, right) => {
      const leftRank = MATERIAL_WAREHOUSE_RANK.get(String(left.warehouseCode ?? '').trim().toUpperCase()) ?? MATERIAL_WAREHOUSE_PRIORITY.length;
      const rightRank = MATERIAL_WAREHOUSE_RANK.get(String(right.warehouseCode ?? '').trim().toUpperCase()) ?? MATERIAL_WAREHOUSE_PRIORITY.length;
      return leftRank - rightRank || Number(!left.index) - Number(!right.index);
    })[0];
};

const PRODUCT_CATALOG_SEARCH_DELAY_MS = 180;
const productCatalogSearchCache = new Map<string, ProductCatalogItem[]>();

const useProductCatalogSearch = (
  query: string,
  mode: ProductCatalogSearchMode,
  enabled: boolean,
  limit: number
) => {
  const deferredQuery = useDeferredValue(query);
  const trimmedQuery = deferredQuery.replace(/\s+/g, ' ').trim();
  const minimumLength = mode === 'material-name' || mode === 'material-code' ? 1 : 2;
  const active = enabled && trimmedQuery.length >= minimumLength;
  const searchKey = active ? `${mode}|${limit}|${trimmedQuery.toLocaleLowerCase('pl')}` : '';
  const [result, setResult] = useState<{
    key: string;
    items: ProductCatalogItem[];
  }>({ key: '', items: [] });
  const cachedItems = searchKey ? productCatalogSearchCache.get(searchKey) : undefined;

  useEffect(() => {
    if (!active || !searchKey || productCatalogSearchCache.has(searchKey)) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        source: 'product-catalog',
        query: trimmedQuery,
        mode,
        limit: String(limit)
      });
      fetch(`/api/planowanie-zapotrzebowania?${params.toString()}`, {
        cache: 'no-store',
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('catalog search unavailable');
          return response.json() as Promise<{ items?: ProductCatalogItem[] }>;
        })
        .then((payload) => {
          if (controller.signal.aborted) return;
          const items = Array.isArray(payload.items) ? payload.items : [];
          if (productCatalogSearchCache.size >= 80) {
            const oldestKey = productCatalogSearchCache.keys().next().value;
            if (oldestKey) productCatalogSearchCache.delete(oldestKey);
          }
          productCatalogSearchCache.set(searchKey, items);
          setResult({ key: searchKey, items });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ key: searchKey, items: [] });
        });
    }, PRODUCT_CATALOG_SEARCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active, limit, mode, searchKey, trimmedQuery]);

  return {
    items: active ? cachedItems ?? (result.key === searchKey ? result.items : []) : [],
    loading: active && !cachedItems && result.key !== searchKey
  };
};

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
        emergencyMaterials: [],
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
        emergencyMaterials: [],
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

const emptyTechnologyDraft = (): Technology => ({
  id: '',
  productIndex: '',
  productName: '',
  variant: 'base',
  alternativeNo: 0,
  description: '',
  notes: '',
  productionMode: 'planned',
  shiftNorm: 0,
  materials: [],
  linkedProducts: [],
  surplusMaterials: [],
  emergencyMaterials: [],
  archived: false
});

const cloneTechnologyForEditor = (technology: Technology): Technology => ({
  ...technology,
  materials: (technology.materials ?? []).map((material) => ({ ...material })),
  linkedProducts: (technology.linkedProducts ?? []).map((link) => ({ ...link })),
  surplusMaterials: (technology.surplusMaterials ?? []).map((material) => ({ ...material })),
  emergencyMaterials: (technology.emergencyMaterials ?? []).map((material) => ({ ...material }))
});

const sameTechnologyMaterials = (left: TechnologyMaterial[], right: TechnologyMaterial[]) =>
  left.length === right.length && left.every((material, index) => {
    const other = right[index];
    return Boolean(other) &&
      material.id === other.id &&
      material.code === other.code &&
      material.name === other.name &&
      material.category === other.category &&
      material.usage === other.usage &&
      material.unit === other.unit &&
      material.logisticQty === other.logisticQty;
  });

const sameLinkedProducts = (left: LinkedProduct[], right: LinkedProduct[]) =>
  left.length === right.length && left.every((link, index) => {
    const other = right[index];
    return Boolean(other) &&
      link.id === other.id &&
      link.productIndex === other.productIndex &&
      link.productName === other.productName &&
      link.usage === other.usage &&
      link.unit === other.unit;
  });

const sameTechnologyEditorValue = (left: Technology, right: Technology) =>
  left.id === right.id &&
  left.productIndex === right.productIndex &&
  left.productName === right.productName &&
  left.variant === right.variant &&
  left.alternativeNo === right.alternativeNo &&
  left.description === right.description &&
  left.notes === right.notes &&
  (left.productionMode ?? 'planned') === (right.productionMode ?? 'planned') &&
  left.shiftNorm === right.shiftNorm &&
  left.archived === right.archived &&
  sameTechnologyMaterials(left.materials, right.materials) &&
  sameLinkedProducts(left.linkedProducts ?? [], right.linkedProducts ?? []) &&
  sameTechnologyMaterials(left.surplusMaterials ?? [], right.surplusMaterials ?? []) &&
  sameTechnologyMaterials(left.emergencyMaterials ?? [], right.emergencyMaterials ?? []);

const TECHNOLOGY_UNSAVED_CHANGES_MESSAGE =
  'Masz niezapisane zmiany w technologii. Odrzucić je i przejść dalej?';

const CALCULATION_UNSAVED_CHANGES_MESSAGE =
  'Masz niezapisane zmiany w tej pozycji planu. Odrzucić je i przejść dalej?';

const cleanImportedTechnologyDescription = (value: unknown) => {
  const description = String(value ?? '').trim();
  return /^Import\s*:/i.test(description) ? '' : description;
};

const parseStoredState = (value: unknown): AppState | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<AppState>;
  if (!Array.isArray(record.plan) || !Array.isArray(record.technologies)) return null;
  const stationMappings = Array.isArray(record.stationMappings) ? record.stationMappings : [];
  const storedAreas = Array.isArray(record.areas) ? record.areas : [];
  const normalizedTechnologies = record.technologies.map((technology) => {
    const product = splitProductFields(technology.productName, technology.productIndex);
    return {
      ...technology,
      productName: product.name,
      productIndex: product.index,
      description: cleanImportedTechnologyDescription(technology.description),
      productionMode: technology.productionMode === 'continuous'
        ? 'continuous' as const
        : technology.productionMode === 'linked'
          ? 'linked' as const
          : 'planned' as const,
      shiftNorm: Math.max(0, numberValue(technology.shiftNorm)),
      materials: Array.isArray(technology.materials) ? technology.materials : [],
      linkedProducts: Array.isArray(technology.linkedProducts) ? technology.linkedProducts.map((link) => ({
        ...link,
        id: String(link.id || uid('link')),
        productIndex: String(link.productIndex ?? '').trim(),
        productName: String(link.productName ?? '').trim(),
        usage: Math.max(0, numberValue(link.usage)),
        unit: String(link.unit ?? '').trim() || 'szt.'
      })) : [],
      surplusMaterials: Array.isArray(technology.surplusMaterials) ? technology.surplusMaterials : [],
      emergencyMaterials: Array.isArray(technology.emergencyMaterials) ? technology.emergencyMaterials : []
    };
  });
  const legacyEmergencyMigration = migrateLegacyEmergencyTechnologies(normalizedTechnologies);
  const technologies = legacyEmergencyMigration.technologies;
  const protectedPlanItemIds = new Set(
    (Array.isArray(record.documents) ? record.documents : [])
      .flatMap((document) => (Array.isArray(document.rows) ? document.rows : [])
        .filter((row) => document.status === 'handed' || pickingRowWasWritten(document, row)))
      .flatMap((row) => Array.isArray(row.sources) ? row.sources : [])
      .map((source) => source.planItemId)
      .filter(Boolean)
  );
  const cleanPlanItem = (item: PlanItem): PlanItem => {
    const product = splitProductFields(item.name, item.index);
    const migratedTechnologyId = item.packagingMode === 'emergency'
      ? legacyEmergencyMigration.alternativeByBaseId[item.technologyId]
      : undefined;
    const migratedTechnology = migratedTechnologyId
      ? technologies.find((technology) => technology.id === migratedTechnologyId)
      : undefined;
    return {
      ...item,
      name: product.name,
      index: product.index,
      planGroup: item.planGroup ?? 'standard',
      technologyId: migratedTechnologyId ?? item.technologyId,
      workingMaterials: migratedTechnology && !item.manualOverride
        ? cloneMaterials(migratedTechnology.materials)
        : item.workingMaterials,
      packagingMode: 'base',
      plannedDate: item.plannedDate ?? '',
      scopeMode: item.scopeMode ?? 'global',
      scopeShifts: Math.max(0.5, numberValue(item.scopeShifts) || 3.5),
      scopeQuantity: Math.max(0, numberValue(item.scopeQuantity)),
      linkedSources: normalizeLinkedSources(item.linkedSources)
    };
  };
  const cleanPlanItems = (items: PlanItem[]) => applyStationMappings(items.flatMap((item) => {
    if (protectedPlanItemIds.has(item.id)) return [cleanPlanItem(item)];
    const outputs = splitPlanningRowOutputs({
      ...item,
      norm: item.shiftNorm,
      planGroup: item.planGroup ?? 'standard',
      plannedDate: item.plannedDate ?? ''
    });
    if (outputs.length < 2) return [cleanPlanItem(item)];
    const remainingRatio = item.totalQty > 0
      ? Math.min(1, Math.max(0, item.remainingQty / item.totalQty))
      : 1;
    const productionGroupId = item.productionGroupId || `production-${item.runId || item.id}`;
    return outputs.map((output, position) => cleanPlanItem({
      ...item,
      ...output,
      id: position === 0 ? item.id : `${item.id}-output-${position + 1}`,
      runId: position === 0 ? item.runId : `${item.runId || item.id}-output-${position + 1}`,
      productionGroupId,
      remainingQty: output.totalQty * remainingRatio,
      technologyId: '',
      workingMaterials: null,
      packagingMode: 'base',
      linkedSources: {},
      manualOverride: false
    }));
  }), stationMappings);
  const plan = cleanPlanItems(record.plan);
  const selectedPlanDate = record.selectedPlanDate || localDateKey();
  const dailyPlans: Record<string, PlanItem[]> = record.dailyPlans && typeof record.dailyPlans === 'object'
    ? Object.fromEntries(Object.entries(record.dailyPlans).map(([date, items]) => [
      date,
      Array.isArray(items) ? cleanPlanItems(items) : []
    ]))
    : {};
  if (!Object.keys(dailyPlans).length && plan.length) dailyPlans[selectedPlanDate] = plan;
  const storedVersions = Array.isArray(record.planVersions) ? record.planVersions : [];
  const planVersions: PlanVersion[] = storedVersions.length ? storedVersions.map((planVersion) => ({
    ...planVersion,
    items: Array.isArray(planVersion.items) ? cleanPlanItems(planVersion.items) : [],
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
    calculationMode: record.calculationMode === 'all' ? 'all' : 'horizon',
    areas: mergeAreas(storedAreas),
    stationMappings,
    technologies,
    selectedPlanDate,
    activePlanVersionId: latestPlanVersion(planVersions, selectedPlanDate)?.id ?? '',
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

const preparePlanningAutosaveState = (state: AppState): AppState => ({
  ...state,
  plan: applyDefaultTechnologyAssignments(state.plan, state.technologies)
});

const technologyLabel = (technology: Technology) =>
  technology.variant === 'base' ? 'Bazowa' : `Awaryjna ${technology.alternativeNo}`;

const technologySelectLabel = (technology: Technology) =>
  [technologyLabel(technology), cleanImportedTechnologyDescription(technology.description)].filter(Boolean).join(' · ');

const technologyMatchesProduct = (technology: Technology, productIndex: string, productName: string) => {
  const normalizedIndex = normalize(productIndex);
  const normalizedName = normalize(productName);
  return Boolean(
    (normalizedIndex && normalize(technology.productIndex) === normalizedIndex) ||
    (normalizedName && normalize(technology.productName) === normalizedName)
  );
};

const selectedTechnologyForEditor = (technologies: Technology[], editingTechnologyId: string) =>
  technologies.find((technology) => technology.id === editingTechnologyId) ?? null;

const updateBaseTechnologyFromWorkingCopy = (
  technologies: Technology[],
  selectedTechnologyId: string,
  materials: TechnologyMaterial[],
  shiftNorm: number
) => {
  const selected = technologies.find((technology) => technology.id === selectedTechnologyId);
  if (!selected) return { technologies, baseId: '' };
  const base = technologies.find((technology) => (
    technology.variant === 'base' &&
    technologyMatchesProduct(technology, selected.productIndex, selected.productName)
  )) ?? selected;
  return {
    baseId: base.id,
    technologies: technologies.map((technology) => technology.id === base.id ? {
      ...technology,
      variant: 'base' as const,
      alternativeNo: 0,
      shiftNorm: Math.max(0, shiftNorm),
      materials: cloneMaterials(materials)
    } : technology)
  };
};

const createAlternativeTechnologyFromWorkingCopy = (
  technologies: Technology[],
  selectedTechnologyId: string,
  materials: TechnologyMaterial[],
  shiftNorm: number,
  description: string
) => {
  const selected = technologies.find((technology) => technology.id === selectedTechnologyId);
  const cleanDescription = cleanImportedTechnologyDescription(description);
  if (!selected || !materials.length || !cleanDescription) {
    return { technologies, technology: null as Technology | null };
  }
  const alternativeNo = Math.max(
    0,
    ...technologies
      .filter((technology) => technology.variant === 'alternative' && technologyMatchesProduct(technology, selected.productIndex, selected.productName))
      .map((technology) => technology.alternativeNo)
  ) + 1;
  const technology: Technology = {
    ...selected,
    id: uid('tech'),
    variant: 'alternative',
    alternativeNo,
    description: cleanDescription,
    shiftNorm: Math.max(0, shiftNorm),
    materials: cloneMaterials(materials),
    emergencyMaterials: [],
    archived: false
  };
  return { technologies: [...technologies, technology], technology };
};

const planItemSignature = (item: Pick<PlanItem, 'index' | 'station' | 'planGroup' | 'plannedDate'>) =>
  `${item.planGroup ?? 'standard'}|${normalize(item.plannedDate)}|${normalize(item.index)}|${normalize(item.station)}`;

const parsePlanRows = (rows: unknown[][], mappings: StationMapping[], rowOffset = 0): PlanItem[] =>
  readPlanningRows(rows, rowOffset).flatMap((row, position) => {
    const outputs = splitPlanningRowOutputs(row);
    const productionGroupId = outputs.length > 1 ? uid('production') : '';
    const mapping = mappings.find((item) => stationKey(item.station) === stationKey(row.station));
    return outputs.map((output, outputPosition) => {
      const product = splitProductFields(output.name, output.index);
      return {
        ...output,
        name: product.name,
        index: product.index,
        id: `plan-${Date.now().toString(36)}-${position + 1}-${outputPosition + 1}`,
        runId: uid('run'),
        areaId: mapping?.areaId ?? '',
        remainingQty: output.totalQty,
        shiftNorm: numberValue(output.norm),
        included: output.planGroup !== 'planned',
        technologyId: '',
        workingMaterials: null,
        packagingMode: 'base',
        linkedSources: {},
        manualOverride: false,
        continuationCandidateId: '',
        productionGroupId: productionGroupId || undefined
      };
    });
  });

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

const SectionTitle = ({ title, subtitle }: { title: React.ReactNode; subtitle?: string }) => (
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

const PlanAmountField = ({ label, value, disabled, min = 0, onChange }: {
  label: string;
  value: number | null;
  disabled: boolean;
  min?: number;
  onChange: (value: number, editId: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const editId = useRef('');
  return <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold uppercase tracking-normal text-dim">
    <span>{label}</span>
    <BaseInput
      className="h-11 rounded-lg text-base font-bold tabular-nums text-title"
      type="number" inputMode="decimal" min={min} step="any"
      aria-label={label} aria-invalid={value === null} placeholder={value === null ? 'Podaj ilość' : undefined}
      disabled={disabled} value={draft ?? value ?? ''}
      onFocus={() => { editId.current = uid('correction'); }}
      onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft(text);
        const number = event.currentTarget.valueAsNumber;
        if (text.trim() && Number.isFinite(number) && number >= min && number !== value) {
          if (!editId.current) editId.current = uid('correction');
          onChange(number, editId.current);
        }
      }}
      onBlur={() => { setDraft(null); editId.current = ''; }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    />
  </label>;
};

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
          className={mode === 'name' ? 'catalog-label font-semibold' : undefined}
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
                key={`${item.id}|${item.index}|${item.name}`}
                type="button"
                className="block w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-brandSoft focus:bg-brandSoft focus:outline-none"
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectItem(item);
                }}
              >
                <span className={cn('block text-sm font-bold', mode === 'name' ? 'catalog-label' : 'text-title')}>{mode === 'name' ? item.name : item.index}</span>
                <span className={cn('mt-0.5 block text-xs font-medium', mode === 'index' ? 'catalog-label' : 'text-muted')}>
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

type MaterialCatalogInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  mode: 'code' | 'name';
  onCatalogSelect?: (item: ProductCatalogItem) => void;
};

const MaterialCatalogInput = forwardRef<HTMLInputElement, MaterialCatalogInputProps>(({ mode, onCatalogSelect, ...props }, forwardedRef) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const blurTimeoutRef = useRef<number | null>(null);
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
  const catalogSearch = useProductCatalogSearch(
    query,
    mode === 'code' ? 'material-code' : 'material-name',
    open,
    8
  );
  const suggestions = catalogSearch.items;
  const exactSuggestion = useMemo(
    () => findExactCatalogItem(suggestions, mode, query),
    [mode, query, suggestions]
  );

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  const positionDropdown = useCallback((input: HTMLInputElement) => {
    const rect = input.getBoundingClientRect();
    const width = Math.min(480, Math.max(300, Math.min(rect.width, window.innerWidth - 16)));
    const placement = window.innerHeight - rect.bottom >= 160 ? 'below' : 'above';
    const nextPosition = {
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: placement === 'below' ? rect.bottom + 6 : rect.top - 6,
      width,
      placement
    } as const;
    setPosition((current) => current.left === nextPosition.left && current.top === nextPosition.top
      && current.width === nextPosition.width && current.placement === nextPosition.placement
      ? current : nextPosition);
  }, []);

  const cancelPendingClose = useCallback(() => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => cancelPendingClose, [cancelPendingClose]);

  useEffect(() => {
    const closeWhenAnotherInputOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== instanceId) setOpen(false);
    };
    window.addEventListener('material-catalog-open', closeWhenAnotherInputOpens);
    return () => window.removeEventListener('material-catalog-open', closeWhenAnotherInputOpens);
  }, [instanceId]);

  useEffect(() => {
    if (!open) return;
    let positionFrame = 0;
    const reposition = () => {
      if (positionFrame) return;
      positionFrame = window.requestAnimationFrame(() => {
        positionFrame = 0;
        if (inputRef.current) positionDropdown(inputRef.current);
      });
    };
    const handleScroll = (event: Event) => {
      // Długa nazwa przewija tekst wewnątrz inputa, nie sam formularz.
      if (event.target === inputRef.current) return;
      if (event.target instanceof Node && dropdownRef.current?.contains(event.target)) return;
      reposition();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.cancelAnimationFrame(positionFrame);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, positionDropdown]);

  const { onFocus, onBlur, onChange, onClick, onKeyDown, ...inputProps } = props;
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
    cancelPendingClose();
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
      className={cn(inputProps.className, mode === 'name' && 'catalog-label font-semibold')}
      autoComplete={inputProps.autoComplete ?? 'off'}
      list={undefined}
      ref={inputRef}
      data-material-catalog-mode={mode}
      onFocus={(event) => {
        openForInput(event.currentTarget);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        cancelPendingClose();
        blurTimeoutRef.current = window.setTimeout(() => {
          blurTimeoutRef.current = null;
          if (document.activeElement !== inputRef.current && !dropdownRef.current?.contains(document.activeElement)) {
            setOpen(false);
          }
        }, 120);
        onBlur?.(event);
      }}
      onClick={(event) => {
        openForInput(event.currentTarget);
        onClick?.(event);
      }}
      onChange={(event) => {
        if (suppressOpenRef.current || document.activeElement !== event.currentTarget) setOpen(false);
        else openForInput(event.currentTarget);
        onChange?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (exactSuggestion || suggestions[0])) {
          event.preventDefault();
          selectItem(exactSuggestion ?? suggestions[0]);
        } else if (event.key === 'Escape') {
          setOpen(false);
        }
        onKeyDown?.(event);
      }}
    />
    {open && query.trim() && typeof document !== 'undefined' ? createPortal(
      <div
        ref={dropdownRef}
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
        {catalogSearch.loading ? <p className="px-3 py-3 text-sm text-muted">Wyszukiwanie...</p> : suggestions.length ? suggestions.map((item) => <button
          key={item.id}
          type="button"
          className="block w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-[rgba(255,255,255,0.06)] focus:bg-[rgba(255,255,255,0.06)] focus:outline-none"
          onMouseDown={(event) => {
            event.preventDefault();
            selectItem(item);
          }}
        >
          <span className="catalog-label block whitespace-normal break-words text-sm font-bold">{item.name}</span>
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
  const listId = typeof props.list === 'string' ? props.list : '';
  const mode = listId === 'material-code-suggestions' ? 'code' : listId === 'material-name-suggestions' ? 'name' : null;
  if (!mode) return <BaseInput ref={forwardedRef} {...props} />;
  return <MaterialCatalogInput ref={forwardedRef} {...props} mode={mode} onCatalogSelect={onCatalogSelect} />;
});

Input.displayName = 'MaterialAwareInput';

const Stat = ({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'success' }) => (
  <div className={cn('rounded-2xl border border-border bg-[rgba(255,255,255,0.035)] p-4', tone === 'warning' && 'border-[color:color-mix(in_srgb,var(--warning)_42%,transparent)]', tone === 'success' && 'border-[color:color-mix(in_srgb,var(--success)_42%,transparent)]')}>
    <p className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</p>
    <p className="mt-2 text-2xl font-black text-title">{value}</p>
  </div>
);

function MaterialPlanningWorkspace({ requestedView }: { requestedView: string | null }) {
  const router = useRouter();
  const user = useUiStore((store) => store.user);
  const readOnly = isReadOnly(user, 'PLANOWANIE_ZAPOTRZEBOWANIA');
  const view: View = requestedView && ['plan', 'technologie', 'spis', 'dokument', 'zwroty', 'ustawienia'].includes(requestedView)
    ? requestedView as View
    : 'plan';
  const {
    state,
    setState,
    changeState,
    beginManualSave,
    commitManualSave,
    discardManualSave,
    hydrated,
    info: saveInfo,
    retry: retrySave,
    downloadDraft,
    loadLatest
  } = usePlanningAutosave({
    initial: emptyState,
    parse: parseStoredState,
    prepare: preparePlanningAutosaveState,
    storageKey: LOCAL_KEY,
    readOnly
  });
  const [message, setMessage] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [pending, setPending] = useState<PendingWorkbook | null>(null);
  const [lastPlanWorkbook, setLastPlanWorkbook] = useState<PendingWorkbook | null>(null);
  const planUploadModeRef = useRef<'plan' | 'update'>('plan');
  const [expandedPlan, setExpandedPlan] = useState('');
  const [showAllPlanAreas, setShowAllPlanAreas] = useState(false);
  const [returnAreaFilter, setReturnAreaFilter] = useState('all');
  const [planSearch, setPlanSearch] = useState('');
  const [expandedCalculation, setExpandedCalculation] = useState('');
  const [calculationEditorDirty, setCalculationEditorDirty] = useState(false);
  const [calculationEditorSaving, setCalculationEditorSaving] = useState(false);
  const [alternativeDraftItemId, setAlternativeDraftItemId] = useState('');
  const [alternativeDraftDescription, setAlternativeDraftDescription] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customHorizon, setCustomHorizon] = useState(false);
  const [today, setToday] = useState(localDateKey);
  const [technologySearch, setTechnologySearch] = useState('');
  const [technologyMaterialSearch, setTechnologyMaterialSearch] = useState('');
  const [technologyFilter, setTechnologyFilter] = useState<'active' | 'archived'>('active');
  const [technologyPanel, setTechnologyPanel] = useState<'editor' | 'list'>('editor');
  const [expandedDocument, setExpandedDocument] = useState('');
  const [expandedMaterial, setExpandedMaterial] = useState('');
  const [editingTechnologyId, setEditingTechnologyId] = useState('');
  const [technologyDraft, setTechnologyDraft] = useState<Technology>(emptyTechnologyDraft);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inventorySyncRequestRef = useRef(0);
  const currentUserName = user?.username ?? user?.name ?? 'nieznany';
  const selectedTechnologyEditorSource = useMemo(
    () => selectedTechnologyForEditor(state.technologies, editingTechnologyId),
    [editingTechnologyId, state.technologies]
  );
  const technologyEditorDirty = useMemo(
    () => !sameTechnologyEditorValue(
      technologyDraft,
      selectedTechnologyEditorSource ?? emptyTechnologyDraft()
    ),
    [selectedTechnologyEditorSource, technologyDraft]
  );
  const technologyProductIndexSearch = useProductCatalogSearch(
    technologyDraft.productIndex,
    'product-index',
    view === 'technologie' && technologyPanel === 'editor',
    12
  );
  const technologyProductNameSearch = useProductCatalogSearch(
    technologyDraft.productName,
    'product-name',
    view === 'technologie' && technologyPanel === 'editor',
    12
  );
  const resetTechnologyEditor = useCallback(() => {
    setTechnologyDraft(selectedTechnologyEditorSource
      ? cloneTechnologyForEditor(selectedTechnologyEditorSource)
      : emptyTechnologyDraft());
  }, [selectedTechnologyEditorSource]);
  const clearTechnologyEditor = useCallback(() => {
    setEditingTechnologyId('');
    setTechnologyDraft(emptyTechnologyDraft());
  }, []);
  const confirmDiscardTechnologyEditor = useCallback(
    () => !technologyEditorDirty || window.confirm(TECHNOLOGY_UNSAVED_CHANGES_MESSAGE),
    [technologyEditorDirty]
  );

  useEffect(() => {
    if (view !== 'technologie' || !technologyEditorDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (!window.confirm(TECHNOLOGY_UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      clearTechnologyEditor();
    };
    const handleHistoryNavigation = (event: PopStateEvent) => {
      if (!window.confirm(TECHNOLOGY_UNSAVED_CHANGES_MESSAGE)) {
        event.stopImmediatePropagation();
        router.push('/planowanie-zapotrzebowania?view=technologie');
        return;
      }
      clearTechnologyEditor();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handleHistoryNavigation, true);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handleHistoryNavigation, true);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [clearTechnologyEditor, router, technologyEditorDirty, view]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime() + 100);
    };
    const refresh = () => {
      clearTimeout(timer);
      setToday(localDateKey());
      schedule();
    };
    schedule();
    window.addEventListener('focus', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); };
  }, []);

  const flash = (text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage(''), 3200);
  };

  const calculationEditorOpen = Boolean(expandedPlan || expandedCalculation);

  const updateState = (updater: (current: AppState) => AppState) => {
    if (readOnly) return;
    let changed = false;
    changeState((current) => {
      const next = updater(current);
      if (next === current) return current;
      changed = true;
      const mappedPlan = applyStationMappings(next.plan, next.stationMappings);
      const plan = applyDefaultTechnologyAssignments(mappedPlan, next.technologies);
      return {
        ...next,
        plan,
        dailyPlans: { ...next.dailyPlans, [next.selectedPlanDate]: clonePlanItems(plan) },
        updatedAt: nowLabel()
      };
    });
    if (changed && calculationEditorOpen) setCalculationEditorDirty(true);
  };

  const confirmDiscardCalculationEditor = useCallback(
    () => !calculationEditorDirty || window.confirm(CALCULATION_UNSAVED_CHANGES_MESSAGE),
    [calculationEditorDirty]
  );
  const closeCalculationEditor = useCallback(() => {
    discardManualSave();
    setCalculationEditorDirty(false);
    setCalculationEditorSaving(false);
    setAlternativeDraftItemId('');
    setAlternativeDraftDescription('');
    setExpandedPlan('');
    setExpandedCalculation('');
  }, [discardManualSave]);
  const closeCalculationEditorIfAllowed = () => {
    if (!calculationEditorOpen) return true;
    if (calculationEditorSaving) return false;
    if (!confirmDiscardCalculationEditor()) return false;
    closeCalculationEditor();
    return true;
  };
  const toggleCalculationEditor = useCallback((itemId: string, surface: 'plan' | 'calculation') => {
    if (calculationEditorSaving) return;
    const currentId = surface === 'plan' ? expandedPlan : expandedCalculation;
    if (currentId === itemId) {
      if (!confirmDiscardCalculationEditor()) return;
      closeCalculationEditor();
      return;
    }
    if ((expandedPlan || expandedCalculation) && !confirmDiscardCalculationEditor()) return;
    if (expandedPlan || expandedCalculation) closeCalculationEditor();
    if (!readOnly) beginManualSave();
    if (surface === 'plan') setExpandedPlan(itemId);
    else setExpandedCalculation(itemId);
  }, [beginManualSave, calculationEditorSaving, closeCalculationEditor, confirmDiscardCalculationEditor, expandedCalculation, expandedPlan, readOnly]);
  const resetCalculationEditorChanges = () => {
    discardManualSave();
    setCalculationEditorDirty(false);
    setCalculationEditorSaving(false);
    setAlternativeDraftItemId('');
    setAlternativeDraftDescription('');
    if (!readOnly) beginManualSave();
    flash('Niezapisane zmiany tej pozycji zostały anulowane.');
  };
  const saveCalculationEditorChanges = async () => {
    if (readOnly || !calculationEditorDirty || calculationEditorSaving) return;
    setCalculationEditorSaving(true);
    try {
      const result = await commitManualSave();
      if (result?.status === 'saved' && !result.pending) {
        setCalculationEditorDirty(false);
        beginManualSave();
        flash('Zmiany pozycji zostały zapisane.');
      } else {
        flash('Nie udało się zapisać zmian. Sprawdź komunikat zapisu i spróbuj ponownie.');
      }
    } finally {
      setCalculationEditorSaving(false);
    }
  };

  useEffect(() => {
    if (!calculationEditorOpen) return;

    const discardAndClose = () => {
      discardManualSave();
      setCalculationEditorDirty(false);
      setCalculationEditorSaving(false);
      setExpandedPlan('');
      setExpandedCalculation('');
    };
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (calculationEditorSaving) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (calculationEditorDirty && !window.confirm(CALCULATION_UNSAVED_CHANGES_MESSAGE)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      discardAndClose();
    };
    const handleHistoryNavigation = (event: PopStateEvent) => {
      if (calculationEditorSaving) {
        event.stopImmediatePropagation();
        router.push(view === 'plan' ? '/planowanie-zapotrzebowania' : `/planowanie-zapotrzebowania?view=${view}`);
        return;
      }
      if (calculationEditorDirty && !window.confirm(CALCULATION_UNSAVED_CHANGES_MESSAGE)) {
        event.stopImmediatePropagation();
        router.push(view === 'plan' ? '/planowanie-zapotrzebowania' : `/planowanie-zapotrzebowania?view=${view}`);
        return;
      }
      discardAndClose();
    };

    window.addEventListener('popstate', handleHistoryNavigation, true);
    document.addEventListener('click', handleDocumentClick, true);
    return () => {
      window.removeEventListener('popstate', handleHistoryNavigation, true);
      document.removeEventListener('click', handleDocumentClick, true);
    };
  }, [calculationEditorDirty, calculationEditorOpen, calculationEditorSaving, discardManualSave, router, view]);

  const areaName = (id: string) => state.areas.find((area) => area.id === id)?.name ?? 'Brak przypisu';
  const selectPlanningArea = (areaId: string) => {
    if (!state.areas.some((area) => area.id === areaId && !area.shared)) return false;
    if (!closeCalculationEditorIfAllowed()) return false;
    setState((current) => current.selectedAreaId === areaId ? current : { ...current, selectedAreaId: areaId });
    setExpandedPlan('');
    setExpandedCalculation('');
    return true;
  };
  const selectPlanAreaFilter = (areaId: string) => {
    if (areaId === 'all') {
      if (!closeCalculationEditorIfAllowed()) return;
      setShowAllPlanAreas(true);
      setExpandedPlan('');
      return;
    }
    if (!state.areas.some((area) => area.id === areaId && !area.shared)) return;
    if (selectPlanningArea(areaId)) setShowAllPlanAreas(false);
  };
  const technologiesFor = (item: Pick<PlanItem, 'index' | 'name'>) => state.technologies.filter((technology) => !technology.archived && (normalize(technology.productIndex) === normalize(item.index) || normalize(technology.productName) === normalize(item.name)));
  const technologyForItem = (item: PlanItem) => state.technologies.find((technology) => technology.id === item.technologyId);
  const materialsForItem = (item: PlanItem) => item.workingMaterials ?? technologyForItem(item)?.materials ?? [];

  const selectTechnology = (itemId: string, technologyId: string) => {
    updateState((current) => ({
      ...current,
      plan: current.plan.map((item) => {
        if (item.id !== itemId) return item;
        const technology = current.technologies.find((entry) => entry.id === technologyId);
        return { ...item, technologyId, shiftNorm: item.productionGroupId && item.shiftNorm > 0 ? item.shiftNorm : technology?.shiftNorm || item.shiftNorm, workingMaterials: technology ? cloneMaterials(technology.materials) : null, packagingMode: 'base', manualOverride: false };
      })
    }));
  };

  const updateLinkedSourceSelection = (
    itemId: string,
    link: LinkedProduct,
    patch: Partial<LinkedSourceSelection>
  ) => {
    updateState((current) => ({
      ...current,
      plan: current.plan.map((item) => {
        if (item.id !== itemId) return item;
        const key = linkedProductKey(link);
        const previous = linkedSourceSelectionForItem(item, link);
        return {
          ...item,
          linkedSources: {
            ...(item.linkedSources ?? {}),
            [key]: { ...previous, ...patch }
          }
        };
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

  const shiftNormForItem = (item: PlanItem) => {
    const planNorm = Math.max(0, numberValue(item.shiftNorm));
    const technology = technologyForItem(item);
    return technology?.productionMode === 'continuous' && planNorm <= 0
      ? Math.max(0, numberValue(technology.shiftNorm))
      : planNorm;
  };
  const plannedItemProductionQty = (item: PlanItem) => {
    const technology = technologyForItem(item);
    const norm = shiftNormForItem(item);
    if (technology?.productionMode === 'continuous') {
      const scope = scopeForItem(item);
      if (scope.mode === 'quantity') return Math.max(0, scope.quantity);
      const shifts = scope.mode === 'shifts' ? scope.shifts : state.horizonShifts;
      return norm * Math.max(0, shifts);
    }
    const remaining = knownRemainingQuantity(item);
    return calculateScopedQuantity(remaining, norm, scopeForItem(item));
  };

  const technologyLinksForItem = (item: PlanItem) => technologyForItem(item)?.linkedProducts ?? [];
  const linkedProducerCandidates = (link: LinkedProduct, consumerItemId: string) => state.plan.filter((candidate) =>
    candidate.id !== consumerItemId && candidate.included && linkedProductMatchesPlanItem(link, candidate)
  );
  const linkedProducerFor = (item: PlanItem, link: LinkedProduct) => {
    const selection = linkedSourceSelectionForItem(item, link);
    const candidates = linkedProducerCandidates(link, item.id);
    return candidates.find((candidate) => candidate.id === selection.producerPlanItemId) ??
      (candidates.length === 1 ? candidates[0] : undefined);
  };
  const linkedAllocationByProducer = (fullPlan: boolean) => {
    const allocations = new Map<string, number>();
    state.plan.filter((item) => item.included && item.technologyId).forEach((item) => {
      technologyLinksForItem(item).forEach((link) => {
        const selection = linkedSourceSelectionForItem(item, link);
        if (selection.mode !== 'production' && selection.mode !== 'mixed') return;
        const producer = linkedProducerFor(item, link);
        if (!producer) return;
        const consumerQuantity = fullPlan && technologyForItem(producer)?.productionMode !== 'continuous'
          ? knownRemainingQuantity(item)
          : plannedItemProductionQty(item);
        const machineProducts = linkedMachineProductQuantity(consumerQuantity, selection);
        const allocatedOutput = roundTechnologyMaterialQuantity(machineProducts * Math.max(0, link.usage), link.unit);
        allocations.set(producer.id, (allocations.get(producer.id) ?? 0) + allocatedOutput);
      });
    });
    return allocations;
  };
  const selectedLinkedAllocationByProducer = linkedAllocationByProducer(false);
  const fullLinkedAllocationByProducer = linkedAllocationByProducer(true);
  const itemProductionQty = (item: PlanItem, fullPlan = false) => {
    const technology = technologyForItem(item);
    const plannedQuantity = fullPlan && technology?.productionMode !== 'continuous'
      ? knownRemainingQuantity(item)
      : plannedItemProductionQty(item);
    const allocatedQuantity = (fullPlan ? fullLinkedAllocationByProducer : selectedLinkedAllocationByProducer).get(item.id) ?? 0;
    return effectiveProducerQuantity(plannedQuantity, allocatedQuantity, technology?.productionMode ?? 'planned');
  };
  const planQuantityNeedsReview = (item: PlanItem) => {
    const productionMode = technologyForItem(item)?.productionMode ?? 'planned';
    if (productionMode === 'continuous') return false;
    if (productionMode === 'linked' && itemProductionQty(item) > 0) return false;
    return quantityNeedsReview(item);
  };
  const materialDemandContributionsForItem = (item: PlanItem, fullPlan = false) => {
    const quantity = itemProductionQty(item, fullPlan);
    const contributions = materialsForItem(item).map((material) => ({
      material,
      demand: roundTechnologyMaterialQuantity(quantity * material.usage, material.unit)
    }));
    technologyLinksForItem(item).forEach((link) => {
      const selection = linkedSourceSelectionForItem(item, link);
      const warehouseProducts = linkedWarehouseProductQuantity(quantity, selection);
      if (warehouseProducts <= 0 || link.usage <= 0) return;
      const material: TechnologyMaterial = {
        id: `linked-${link.id}`,
        code: link.productIndex,
        name: link.productName,
        category: 'Półwyrób',
        usage: link.usage,
        unit: link.unit || 'szt.',
        logisticQty: 1
      };
      contributions.push({
        material,
        demand: roundTechnologyMaterialQuantity(warehouseProducts * link.usage, material.unit)
      });
    });
    const technology = technologyForItem(item);
    const surplusMaterials = technology?.surplusMaterials ?? [];
    const allocatedOutput = (fullPlan ? fullLinkedAllocationByProducer : selectedLinkedAllocationByProducer).get(item.id) ?? 0;
    const surplusQuantity = linkedSurplusQuantity(quantity, allocatedOutput);
    if (surplusQuantity > 0) {
      surplusMaterials.forEach((material) => contributions.push({
        material,
        demand: roundTechnologyMaterialQuantity(surplusQuantity * material.usage, material.unit)
      }));
    }
    return contributions;
  };

  const needsMaterialBalances = (['plan', 'obliczenia', 'dokument', 'zwroty'] as View[]).includes(view);
  const documentLedger = new Map<string, { issued: number; pending: number }>();
  if (needsMaterialBalances) {
    state.documents
      .filter((document) => document.planDate === state.selectedPlanDate && (
        document.status === 'issued' ||
        document.status === 'handed' ||
        document.rows.some((row) => pickingRowWasWritten(document, row))
      ))
      .forEach((document) => document.rows.forEach((row) => {
        if (document.status !== 'issued' && document.status !== 'handed' && !pickingRowWasWritten(document, row)) return;
        const key = `${document.areaId}|${row.key}`;
        const current = documentLedger.get(key) ?? { issued: 0, pending: 0 };
        if (document.status === 'issued') current.issued += row.toIssue;
        else current.pending += row.toIssue;
        documentLedger.set(key, current);
      }));
  }

  const demandByArea = (() => {
    const all = new Map<string, Map<string, number>>();
    state.areas.filter((area) => !area.shared).forEach((area) => all.set(area.id, new Map()));
    if (!needsMaterialBalances) return all;
    state.plan.filter((item) => item.included && item.areaId && item.technologyId).forEach((item) => {
      const areaMap = all.get(item.areaId) ?? new Map<string, number>();
      materialDemandContributionsForItem(item).forEach(({ material, demand }) => {
        const key = materialKey(material);
        areaMap.set(key, (areaMap.get(key) ?? 0) + demand);
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
      const netNeed = roundTechnologyMaterialQuantity(balance.toIssue, material.unit);
      return { areaId: currentAreaId, demand, areaStock, issued: ledger.issued, pending: ledger.pending, netNeed };
    });
    const globalSharedDemand = areaNeeds.reduce((sum, item) => sum + item.netNeed, 0);
    const globalSharedShortage = roundTechnologyMaterialQuantity(Math.max(0, globalSharedDemand - sharedStock), material.unit);
    const selected = areaNeeds.find((item) => item.areaId === areaId) ?? { areaId, demand: 0, areaStock: 0, issued: 0, pending: 0, netNeed: 0 };
    const toIssue = roundTechnologyMaterialQuantity(
      globalSharedDemand > 0 ? globalSharedShortage * (selected.netNeed / globalSharedDemand) : 0,
      material.unit
    );
    return { ...selected, sharedStock, globalSharedDemand, globalSharedShortage, toIssue };
  };

  const requirementsForArea = (areaId: string) => {
    const aggregate = new Map<string, { material: TechnologyMaterial; demand: number; fullDemand: number; sources: PickingDocumentSource[] }>();
    state.plan.filter((item) => item.included && item.areaId === areaId && item.technologyId).forEach((item) => {
      const fullDemands = new Map(materialDemandContributionsForItem(item, true).map(({ material, demand }) => [materialKey(material), demand]));
      materialDemandContributionsForItem(item).forEach(({ material, demand }) => {
        const key = materialKey(material);
        const row = aggregate.get(key) ?? { material, demand: 0, fullDemand: 0, sources: [] };
        row.demand += demand;
        row.fullDemand += fullDemands.get(key) ?? 0;
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

  const linkedSourceIssuesForArea = (areaId: string) => {
    const issues: string[] = [];
    state.plan.filter((item) => item.included && item.areaId === areaId && item.technologyId).forEach((item) => {
      const technology = technologyForItem(item);
      if (technology?.productionMode === 'continuous' && itemProductionQty(item) <= 0) {
        issues.push(`${item.index}: uzupełnij wydajność produkcji ciągłej na zmianę.`);
      }
      const consumerQuantity = itemProductionQty(item);
      technologyLinksForItem(item).forEach((link) => {
        const selection = linkedSourceSelectionForItem(item, link);
        const label = link.productIndex || link.productName;
        if (selection.mode === 'unselected') {
          issues.push(`${item.index}: wybierz źródło półwyrobu ${label}.`);
          return;
        }
        if (selection.mode === 'mixed' && (selection.productionQuantity <= 0 || selection.productionQuantity >= consumerQuantity)) {
          issues.push(`${item.index}: dla źródła mieszanego podaj ilość z maszyny większą od 0 i mniejszą od ${fmt(consumerQuantity)}.`);
        }
        if ((selection.mode === 'production' || selection.mode === 'mixed') && !linkedProducerFor(item, link)) {
          issues.push(`${item.index}: nie znaleziono jednoznacznej pozycji produkcyjnej ${label} w planie.`);
        }
      });
    });
    selectedLinkedAllocationByProducer.forEach((allocated, producerId) => {
      const producer = state.plan.find((item) => item.id === producerId);
      if (!producer || producer.areaId !== areaId) return;
      const produced = itemProductionQty(producer);
      if (allocated > produced) {
        issues.push(`${producer.index}: do paneli przypisano ${fmt(allocated)} szt., a w zakresie produkowane jest ${fmt(produced)} szt.`);
      }
    });
    return issues;
  };

  const requirements = view === 'dokument' || view === 'obliczenia'
    ? requirementsForArea(state.selectedAreaId)
    : [];
  const areaPlan = showAllPlanAreas ? state.plan : state.plan.filter((item) => !item.areaId || item.areaId === state.selectedAreaId);
  const planSearchTokens = normalize(planSearch).split(/\s+/).filter(Boolean);
  const visibleAreaPlan = planSearchTokens.length === 0 ? areaPlan : areaPlan.filter((item) => {
    const searchable = normalize([
      item.index,
      item.name,
      item.station,
      item.areaId ? areaName(item.areaId) : 'brak strefy',
      item.notes
    ].join(' '));
    return planSearchTokens.every((token) => searchable.includes(token));
  });
  const allVisiblePlanIncluded = visibleAreaPlan.length > 0 && visibleAreaPlan.every((item) => item.included);
  const someVisiblePlanIncluded = visibleAreaPlan.some((item) => item.included);
  const setVisiblePlanIncluded = (included: boolean) => {
    if (readOnly || !visibleAreaPlan.some((item) => item.included !== included)) return;
    const visibleIds = new Set(visibleAreaPlan.map((item) => item.id));
    const planDate = state.selectedPlanDate;
    updateState((current) => {
      if (current.selectedPlanDate !== planDate) return current;
      let changed = false;
      const plan = current.plan.map((item) => {
        if (!visibleIds.has(item.id) || item.included === included) return item;
        changed = true;
        return { ...item, included };
      });
      return changed ? { ...current, plan } : current;
    });
  };
  const quantityResolvedPlanItemIds = new Set(state.plan
    .filter((item) => {
      const productionMode = technologyForItem(item)?.productionMode;
      return productionMode === 'continuous' || (productionMode === 'linked' && itemProductionQty(item) > 0);
    })
    .map((item) => item.id));
  const unresolvedActiveCount = areaPlan.filter((item) => item.included && planQuantityNeedsReview(item)).length;
  const documentRows = requirements.filter((row) => row.toIssue > 0);
  const editablePickingDocumentExists = state.documents.some((document) =>
    document.planDate === state.selectedPlanDate &&
    document.areaId === state.selectedAreaId &&
    (document.status === 'draft' || document.status === 'outdated')
  );

  const openView = (next: View) => {
    if (calculationEditorOpen && next !== view && !closeCalculationEditorIfAllowed()) return false;
    if (view === 'technologie' && next !== 'technologie') {
      if (!confirmDiscardTechnologyEditor()) return false;
      clearTechnologyEditor();
    }
    router.push(next === 'plan' ? '/planowanie-zapotrzebowania' : `/planowanie-zapotrzebowania?view=${next}`);
    return true;
  };

  const handleWorkbook = async (file: File, purpose: PendingWorkbook['purpose'], preferredSheet?: string) => {
    if (purpose === 'plan' && readOnly) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const selected = purpose === 'plan'
        ? preferredSheet && workbook.SheetNames.includes(preferredSheet) ? preferredSheet : ''
        : workbook.SheetNames.at(-1) ?? '';
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
    if (pending.purpose === 'plan' && (readOnly || !sheet)) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    if (pending.purpose === 'inventory') {
      const imported = parseInventoryRows(rows, state.areas);
      if (!imported.length) return flash('Nie znaleziono rozpoznawalnych pozycji spisu.');
      updateState((current) => ({ ...current, inventory: imported }));
      setPending(null);
      flash(`Wczytano i pogrupowano ${imported.length} pozycji spisu.`);
      return;
    }
    const imported = parsePlanRows(rows, state.stationMappings, XLSX.utils.decode_range(sheet['!ref'] || 'A1').s.r);
    if (!imported.length) return flash('Nie znaleziono rozpoznawalnych pozycji planu.');
    const importedProductionCount = new Set(imported.map((item) => item.productionGroupId || item.id)).size;
    let importedVersionNo = 1;
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
            included: active.included,
            technologyId: active.technologyId,
            workingMaterials: active.workingMaterials,
            packagingMode: active.packagingMode ?? 'base',
            linkedSources: normalizeLinkedSources(active.linkedSources),
            manualOverride: active.manualOverride,
            remainingQty: incoming.totalQty,
            ...(active.quantityStatus === 'manual' && incoming.sourceQuantity === active.sourceQuantity
              ? { quantityStatus: 'manual' as const, totalQty: active.totalQty, remainingQty: active.remainingQty }
              : {}),
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
      const previousVersion = latestPlanVersion(current.planVersions, current.selectedPlanDate);
      const differences = previousVersion ? diffPlanItems(previousVersion.items, nextPlan) : [];
      importedVersionNo = nextPlanVersionNumber(current.planVersions, current.selectedPlanDate);
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
    setLastPlanWorkbook(pending);
    setPending(null);
    flash(`Zaimportowano wersję ${importedVersionNo}: ${importedProductionCount} produkcji, ${imported.length} detali. Ilości z pliku do sprawdzenia: ${imported.filter(quantityNeedsReview).length}.`);
  };

  const selectPlanDate = (planDate: string) => {
    if (!planDate) return;
    if (!closeCalculationEditorIfAllowed()) return;
    setState((current) => {
      const dailyPlans = { ...current.dailyPlans, [current.selectedPlanDate]: clonePlanItems(current.plan) };
      const latest = latestPlanVersion(current.planVersions, planDate);
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
  };

  const updatePlanQuantity = (itemId: string, quantity: number, editId: string) => {
    if (!Number.isFinite(quantity) || quantity < 0) return;
    const createdAt = nowLabel();
    updateState((current) => {
      const item = current.plan.find((row) => row.id === itemId);
      if (!item) return current;
      const nextItem = setRemainingQuantity(item, quantity);
      if (nextItem.remainingQty === item.remainingQty && nextItem.totalQty === item.totalQty && !quantityNeedsReview(item)) return current;
      const previousCorrection = current.quantityCorrections.find((entry) => entry.id === editId);
      const correction: QuantityCorrection = {
        id: editId, planDate: current.selectedPlanDate, planVersionId: current.activePlanVersionId,
        itemId: item.id, index: item.index, name: item.name, previousValue: item.totalQty, newValue: nextItem.totalQty,
        difference: nextItem.totalQty - item.totalQty, createdBy: currentUserName, createdAt, source: 'Ręczna korekta',
        previousQuantityStatus: previousCorrection ? previousCorrection.previousQuantityStatus : item.quantityStatus
      };
      return {
        ...current,
        plan: current.plan.map((row) => row.id === item.id ? {
          ...nextItem, quantityStatus: 'manual' as const
        } : row),
        quantityCorrections: coalesceQuantityCorrection(current.quantityCorrections, correction),
        documents: current.documents.map((document) => document.planDate === current.selectedPlanDate && document.status === 'draft'
          ? { ...document, status: 'outdated' as const }
          : document)
      };
    });
  };

  const updatePlanNorm = (itemId: string, shiftNorm: number) => {
    if (!Number.isFinite(shiftNorm) || shiftNorm < 0) return;
    updateState((current) => {
      const item = current.plan.find((row) => row.id === itemId);
      if (!item) return current;
      const belongsToProduction = (row: PlanItem) => item.productionGroupId
        ? row.productionGroupId === item.productionGroupId
        : row.id === itemId;
      if (current.plan.filter(belongsToProduction).every((row) => row.shiftNorm === shiftNorm)) return current;
      return {
        ...current,
        plan: current.plan.map((row) => belongsToProduction(row) ? { ...row, shiftNorm } : row),
        documents: current.documents.map((document) => document.planDate === current.selectedPlanDate && document.status === 'draft'
          ? { ...document, status: 'outdated' as const }
          : document)
      };
    });
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
        quantityStatus: previous.previousQuantityStatus,
        remainingQty: Math.max(0, previous.previousValue - Math.max(0, row.totalQty - row.remainingQty))
      } : row),
      quantityCorrections: current.quantityCorrections.map((correction) => correction.id === previous.id ? { ...correction, revertedAt } : correction),
      documents: current.documents.map((document) => document.planDate === current.selectedPlanDate && document.status === 'draft'
        ? { ...document, status: 'outdated' as const }
        : document)
    }));
  };

  const syncOriginalInventory = async (showMessage = true, requestedDate = state.selectedPlanDate) => {
    const requestId = ++inventorySyncRequestRef.current;
    try {
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : localDateKey();
      const response = await fetch(`/api/planowanie-zapotrzebowania?source=original-inventory&date=${dateKey}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('sync failed');
      const payload = await response.json() as {
        dateKey: string;
        syncedAt: string;
        rows: Array<{ id: string; areaId: string; code: string; name: string; qty: number; unit: string }>;
      };
      if (requestId !== inventorySyncRequestRef.current) return;
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
      if (requestId !== inventorySyncRequestRef.current) return;
      if (showMessage) flash('Nie udało się pobrać aktualnego Spisu rzeczywistego.');
    }
  };

  useEffect(() => {
    if (
      !hydrated ||
      !(['plan', 'dokument', 'zwroty'] as View[]).includes(view)
    ) {
      return;
    }
    void syncOriginalInventory(false, state.selectedPlanDate);
    // Spis odświeżamy przy wejściu do części korzystającej z ilości oraz po zmianie daty planu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.selectedPlanDate, view]);

  const addTechnology = (productIndex = '', productName = '', shiftNorm = 0) => {
    if (!confirmDiscardTechnologyEditor()) return;
    const same = state.technologies.filter((technology) => normalize(technology.productIndex) === normalize(productIndex));
    const technology: Technology = {
      id: '', productIndex, productName, variant: same.length ? 'alternative' : 'base',
      alternativeNo: same.length
        ? Math.max(0, ...same.filter((item) => item.variant === 'alternative').map((item) => item.alternativeNo)) + 1
        : 0,
      description: '', notes: '', shiftNorm: Math.max(0, shiftNorm), materials: [], linkedProducts: [], surplusMaterials: [], emergencyMaterials: [], archived: false
    };
    setEditingTechnologyId('');
    setTechnologyDraft(technology);
    setTechnologyPanel('editor');
    openView('technologie');
  };

  const startTechnologyDraft = () => {
    if (!confirmDiscardTechnologyEditor()) return;
    setEditingTechnologyId('');
    setTechnologyDraft(emptyTechnologyDraft());
    setTechnologyPanel('editor');
  };

  const openTechnologyEditor = (technologyId: string) => {
    if (technologyId === editingTechnologyId && technologyPanel === 'editor') return;
    if (!confirmDiscardTechnologyEditor()) return;
    const technology = state.technologies.find((item) => item.id === technologyId);
    if (!technology) return;
    setEditingTechnologyId(technology.id);
    setTechnologyDraft(cloneTechnologyForEditor(technology));
    setTechnologyPanel('editor');
  };

  const deleteTechnology = (technologyId: string) => {
    if (readOnly) return;
    const technology = state.technologies.find((item) => item.id === technologyId);
    if (!technology) return;
    const label = technology.productIndex || technology.productName || 'tę technologię';
    if (!window.confirm(`Usunąć trwale technologię „${label}”?`)) return;
    updateState((current) => ({
      ...current,
      technologies: current.technologies.filter((item) => item.id !== technologyId),
      plan: current.plan.map((item) => item.technologyId === technologyId
        ? { ...item, technologyId: '', workingMaterials: null, packagingMode: 'base', linkedSources: {}, manualOverride: false }
        : item)
    }));
    setEditingTechnologyId('');
    setTechnologyDraft(emptyTechnologyDraft());
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

  const selectTechnologyEditorProduct = (item: ProductCatalogItem) => {
    if (readOnly) return;
    const variants = state.technologies.filter((technology) => !technology.archived && technologyMatchesProduct(technology, item.index, item.name));
    const baseTechnology = variants.find((technology) => technology.variant === 'base');
    const alternativeNo = Math.max(
      0,
      ...variants.filter((technology) => technology.variant === 'alternative').map((technology) => technology.alternativeNo)
    ) + 1;
    setTechnologyDraft((current) => {
      const productChanged = !technologyMatchesProduct(current, item.index, item.name);
      const variant = baseTechnology ? 'alternative' as const : 'base' as const;
      return {
        ...current,
        productIndex: item.index,
        productName: item.name,
        variant,
        alternativeNo: variant === 'alternative' ? alternativeNo : 0,
        description: productChanged ? '' : current.description,
        notes: productChanged ? '' : current.notes,
        productionMode: productChanged
          ? baseTechnology?.productionMode ?? 'planned'
          : current.productionMode,
        materials: productChanged
          ? baseTechnology ? cloneMaterials(baseTechnology.materials) : []
          : current.materials,
        linkedProducts: productChanged
          ? baseTechnology ? (baseTechnology.linkedProducts ?? []).map((link) => ({ ...link })) : []
          : current.linkedProducts,
        surplusMaterials: productChanged
          ? baseTechnology ? cloneMaterials(baseTechnology.surplusMaterials ?? []) : []
          : current.surplusMaterials,
        shiftNorm: productChanged
          ? baseTechnology?.shiftNorm || planShiftNormForProduct(item.index, item.name)
          : current.shiftNorm
      };
    });
  };

  const editTechnologyEditorProductField = (mode: 'index' | 'name', value: string) => {
    if (readOnly) return;
    setTechnologyDraft((current) => ({
      ...current,
      ...(mode === 'name' ? { productName: value } : { productIndex: value })
    }));
  };

  const saveTechnologyEditor = () => {
    const productIndex = technologyDraft.productIndex.trim();
    const productName = technologyDraft.productName.trim();
    const description = cleanImportedTechnologyDescription(technologyDraft.description);
    if (!productIndex || !productName) {
      flash('Wybierz indeks i nazwę produktu przed zapisaniem technologii.');
      return;
    }
    if (technologyDraft.variant === 'alternative' && !description) {
      flash('Wpisz opis wariantu awaryjnego, aby pracownik wiedział, kiedy go wybrać.');
      return;
    }
    if (technologyDraft.productionMode === 'continuous' && technologyDraft.shiftNorm <= 0) {
      flash('Dla produkcji ciągłej podaj wydajność na zmianę.');
      return;
    }

    const source = selectedTechnologyForEditor(state.technologies, editingTechnologyId);
    if (editingTechnologyId && !source) {
      flash('Nie znaleziono edytowanej technologii. Otwórz ją ponownie z listy.');
      return;
    }
    const baseConflict = technologyDraft.variant === 'base'
      ? state.technologies.find((technology) =>
        technology.id !== source?.id &&
        technology.variant === 'base' &&
        technologyMatchesProduct(technology, productIndex, productName)
      )
      : undefined;
    if (baseConflict) {
      flash('Dla tego produktu technologia bazowa już istnieje. Wybierz ją z listy albo utwórz wariant awaryjny.');
      return;
    }
    const alternativeConflict = technologyDraft.variant === 'alternative'
      ? state.technologies.find((technology) =>
        technology.id !== source?.id &&
        technology.variant === 'alternative' &&
        technology.alternativeNo === Math.max(1, technologyDraft.alternativeNo) &&
        technologyMatchesProduct(technology, productIndex, productName)
      )
      : undefined;
    if (alternativeConflict) {
      flash(`Awaryjna ${Math.max(1, technologyDraft.alternativeNo)} dla tego produktu już istnieje.`);
      return;
    }

    const technology: Technology = {
      ...cloneTechnologyForEditor(technologyDraft),
      id: source?.id ?? uid('tech'),
      productIndex,
      productName,
      description,
      alternativeNo: technologyDraft.variant === 'base' ? 0 : Math.max(1, technologyDraft.alternativeNo)
    };
    updateState((current) => ({
      ...current,
      technologies: source
        ? current.technologies.map((item) => item.id === source.id ? technology : item)
        : [...current.technologies, technology]
    }));
    setEditingTechnologyId(technology.id);
    setTechnologyDraft(cloneTechnologyForEditor(technology));
    flash(source ? 'Zmiany technologii zostały zapisane.' : 'Technologia została dodana do biblioteki.');
  };

  const updateWorkingMaterial = (itemId: string, materialId: string, patch: Partial<TechnologyMaterial>) => {
    updateState((current) => ({
      ...current,
      plan: current.plan.map((item) => item.id === itemId
        ? { ...item, manualOverride: true, workingMaterials: materialsForItem(item).map((material) => {
          if (material.id !== materialId) return material;
          return patch.unit !== undefined && patch.usage === undefined
            ? technologyMaterialWithUnit(material, String(patch.unit))
            : { ...material, ...patch };
        }) }
        : item)
    }));
  };

  const saveWorkingAsBaseTechnology = (item: PlanItem) => {
    const selectedTechnology = technologyForItem(item);
    const materials = materialsForItem(item);
    if (!selectedTechnology) return flash('Najpierw wybierz technologię dla tej pozycji.');
    if (!materials.length) return flash('Dodaj przynajmniej jeden materiał do technologii roboczej.');
    if (!window.confirm('Zapisać aktualne materiały i normę jako technologię bazową?')) return;
    const baseMaterials = cloneMaterials(materials);
    updateState((current) => {
      const saved = updateBaseTechnologyFromWorkingCopy(
        current.technologies,
        selectedTechnology.id,
        baseMaterials,
        item.shiftNorm
      );
      if (!saved.baseId) return current;
      return {
        ...current,
        technologies: saved.technologies,
        plan: current.plan.map((row) => row.id === item.id ? {
          ...row,
          technologyId: saved.baseId,
          workingMaterials: cloneMaterials(baseMaterials),
          manualOverride: false
        } : row)
      };
    });
    flash('Technologia bazowa została przygotowana. Kliknij „Zapisz zmiany”, aby ją zatwierdzić.');
  };

  const openAlternativeDraft = (itemId: string) => {
    setAlternativeDraftItemId(itemId);
    setAlternativeDraftDescription('');
  };

  const closeAlternativeDraft = () => {
    setAlternativeDraftItemId('');
    setAlternativeDraftDescription('');
  };

  const saveWorkingAsAlternativeTechnology = (item: PlanItem) => {
    const selectedTechnology = technologyForItem(item);
    const materials = materialsForItem(item);
    if (!selectedTechnology) return flash('Najpierw wybierz technologię dla tej pozycji.');
    if (!materials.length) return flash('Dodaj przynajmniej jeden materiał do technologii roboczej.');
    if (!alternativeDraftDescription.trim()) return flash('Wpisz opis wariantu awaryjnego.');
    const saved = createAlternativeTechnologyFromWorkingCopy(
      state.technologies,
      selectedTechnology.id,
      materials,
      item.shiftNorm,
      alternativeDraftDescription
    );
    if (!saved.technology) return flash('Nie udało się utworzyć wariantu awaryjnego.');
    const alternative = saved.technology;
    updateState((current) => ({
      ...current,
      technologies: saved.technologies,
      plan: current.plan.map((row) => row.id === item.id ? {
        ...row,
        technologyId: alternative.id,
        workingMaterials: cloneMaterials(alternative.materials),
        manualOverride: false
      } : row)
    }));
    closeAlternativeDraft();
    flash(`${technologyLabel(alternative)} została przygotowana. Kliknij „Zapisz zmiany”, aby ją zatwierdzić.`);
  };

  const renderHeader = (title: string, subtitle: string) => (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Osobny moduł produkcyjny</p>
        <h1 className="mt-1 text-2xl font-black text-title md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">{subtitle}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && view !== 'technologie' ? calculationEditorOpen
          ? <Badge tone={calculationEditorDirty ? 'warning' : 'info'}>{calculationEditorDirty ? 'Niezapisane zmiany' : 'Zapis ręczny'}</Badge>
          : <PlanningSaveStatus info={saveInfo} /> : null}
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

  const currentPlanVersion = latestPlanVersion(state.planVersions, state.selectedPlanDate);
  const tomorrow = dateOffsetKey(1);
  const savedPlanDates = [...new Set([
    ...Object.keys(state.dailyPlans), ...state.planVersions.map((version) => version.planDate), state.selectedPlanDate
  ])].filter((date) => date && date !== today && date !== tomorrow).sort((left, right) => right.localeCompare(left));
  const customRangeVisible = state.calculationMode !== 'all' && (customHorizon || ![3.5, 9].includes(state.horizonShifts));
  const globalRangeChoice = state.calculationMode === 'all' ? 'all' : customRangeVisible ? 'custom' : String(state.horizonShifts);
  const pendingPlanWorkbook = pending?.purpose === 'plan' ? pending : null;
  const planImportWorkbook = pendingPlanWorkbook ?? lastPlanWorkbook;
  const planImportSheet = pendingPlanWorkbook ? sheetName
    : planImportWorkbook ? planImportWorkbook.workbook.SheetNames.includes(state.planSheet) ? state.planSheet : ''
      : state.planSheet;

  const renderPlanTable = (items: PlanItem[], title: string, subtitle: string, tone: PlanGroup) => {
    if (!items.length) return null;
    const showSectionHeader = tone !== 'standard' || title !== 'Plan na dzisiaj';
    const productionGroups: Record<string, PlanItem[]> = {};
    items.forEach((item) => {
      if (!item.productionGroupId) return;
      productionGroups[item.productionGroupId] = [...(productionGroups[item.productionGroupId] ?? []), item];
    });
    const planGridColumns = 'grid-cols-[80px_minmax(300px,1.65fr)_176px_190px_88px_minmax(300px,1.3fr)_56px]';
    return <section className={cn('overflow-hidden border-y border-border', tone === 'emergency' && 'border-[rgba(239,68,68,0.42)]', tone === 'planned' && 'border-[rgba(183,122,255,0.45)]')}>
      {showSectionHeader ? <div className={cn('flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2.5', tone === 'planned' && 'border-[rgba(183,122,255,0.25)]')}>
        <div>
          <p className={cn('font-bold text-title', tone === 'emergency' && 'text-red-300', tone === 'planned' && 'text-[#debaff]')}>{title}</p>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
        <Badge tone={tone === 'emergency' ? 'danger' : tone === 'planned' ? 'info' : 'default'}>{items.length} detali</Badge>
      </div> : null}
      <div className="overflow-x-auto">
        <div className="min-w-[1190px] pb-2 text-sm">
          <div className={cn('sticky top-0 z-10 grid items-center border-b border-border bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim', planGridColumns)}>
            <div className="flex items-center gap-1 px-2 py-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={allVisiblePlanIncluded ? true : someVisiblePlanIncluded ? 'mixed' : false}
                aria-label={allVisiblePlanIncluded ? 'Odznacz wszystkie widoczne pozycje' : 'Zaznacz wszystkie widoczne pozycje'}
                title={allVisiblePlanIncluded ? 'Wyłącz wszystkie widoczne pozycje z obliczeń' : 'Uwzględnij wszystkie widoczne pozycje w obliczeniach'}
                disabled={readOnly || visibleAreaPlan.length === 0}
                onClick={() => setVisiblePlanIncluded(!allVisiblePlanIncluded)}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-55',
                  allVisiblePlanIncluded
                    ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_18%,transparent)] text-success'
                    : someVisiblePlanIncluded
                      ? 'border-brand bg-brandSoft text-brand'
                      : 'border-border text-dim'
                )}
              >
                {allVisiblePlanIncluded ? <Check className="h-3.5 w-3.5" /> : someVisiblePlanIncluded ? <Minus className="h-3.5 w-3.5" /> : null}
              </button>
              <span>Uwzgl.</span>
            </div><div className="p-3">Indeks / nazwa</div><div className="p-3">Stanowisko / strefa</div>
            <div className="p-3 text-right">Ilość do zrobienia</div>
            <div className="p-3 text-right">Norma</div><div className="p-3">Technologia</div><div className="p-3"><span className="sr-only">Szczegóły</span></div>
          </div>
          <div>{items.map((item) => {
            const variants = technologiesFor(item);
            const corrected = state.quantityCorrections.some((correction) => correction.planDate === state.selectedPlanDate && correction.itemId === item.id && !correction.revertedAt);
            const expanded = expandedPlan === item.id;
            const productionItems = item.productionGroupId ? productionGroups[item.productionGroupId] ?? [item] : [item];
            const firstProductionOutput = !item.productionGroupId || productionItems[0]?.id === item.id;
            const productionIncluded = productionItems.every((entry) => entry.included);
            const readyTechnologies = productionItems.filter((entry) => entry.technologyId).length;
            return <Fragment key={item.id}>
              {item.productionGroupId && firstProductionOutput ? <div className="flex min-h-14 items-center gap-3 border-b border-t border-borderStrong border-l-4 border-l-brand bg-[rgba(255,122,26,0.06)] px-3 py-2.5">
                <button type="button" title={productionIncluded ? 'Wyłącz całą wspólną produkcję z obliczeń' : 'Uwzględnij całą wspólną produkcję w obliczeniach'} aria-pressed={productionIncluded} disabled={readOnly} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.productionGroupId === item.productionGroupId ? { ...row, included: !productionIncluded } : row) }))} className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border disabled:cursor-not-allowed', productionIncluded ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_18%,transparent)] text-success' : 'border-border text-dim')}>{productionIncluded ? <Check className="h-4 w-4" /> : null}</button>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5"><Badge tone="info">Wspólna forma</Badge><span className="font-bold text-title">{productionItems.length} {productionItems.length < 5 ? 'detale' : 'detali'}</span><span className="h-4 w-px bg-[rgba(255,255,255,0.16)]" aria-hidden="true" /><span className="text-xs font-semibold text-muted">{item.station || 'Brak stanowiska'} · {item.areaId ? areaName(item.areaId) : 'Brak strefy'} · {fmt(item.shiftNorm)} szt. każdego detalu / zmianę</span></div>
                <Badge tone={readyTechnologies === productionItems.length ? 'success' : 'warning'}>Technologie {readyTechnologies}/{productionItems.length}</Badge>
              </div> : null}
              <div data-plan-item={item.id} data-expanded={expanded ? 'true' : 'false'} className={cn('relative overflow-hidden border-b border-border transition', expanded && 'border-y border-[rgba(255,122,26,0.58)] shadow-[0_16px_34px_-30px_rgba(255,106,0,0.9)]', tone === 'emergency' && !expanded && 'border-[rgba(239,68,68,0.35)]', tone === 'planned' && !expanded && 'border-[rgba(183,122,255,0.28)]')}>
                {expanded ? <span className="absolute inset-y-0 left-0 z-10 w-1 bg-brand" aria-hidden="true" /> : null}
                <div className={cn('grid min-h-[76px] items-center', planGridColumns, expanded ? 'bg-[rgba(255,255,255,0.055)]' : 'bg-[rgba(7,8,11,0.5)]', !item.included && 'text-dim')}>
                <div className="p-3">{item.productionGroupId ? <span title={`Detal ${(item.productionOutputOrder ?? 0) + 1} z ${item.productionOutputCount}`} className={cn('flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-black', expanded ? 'border-brand bg-brandSoft text-brand' : 'border-border text-muted')}>{(item.productionOutputOrder ?? 0) + 1}</span> : <button type="button" title={item.included ? 'Wyłącz z obliczeń' : 'Uwzględnij w obliczeniach'} aria-pressed={item.included} disabled={readOnly} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, included: !row.included } : row) }))} className={cn('flex h-11 w-11 items-center justify-center rounded-lg border disabled:cursor-not-allowed', item.included ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_18%,transparent)] text-success' : 'border-border text-dim')}>{item.included ? <Check className="h-4 w-4" /> : null}</button>}</div>
                <div className="p-3">
                  <div className="flex flex-wrap items-center gap-1.5"><p className="break-words font-normal text-title">{item.index}</p>{tone === 'emergency' ? <Badge tone="danger">Awaryjna</Badge> : null}{tone === 'planned' ? <Badge tone="info">Przyszła</Badge> : null}{corrected ? <Badge tone="warning">Zmieniona ręcznie</Badge> : null}</div>
                  {normalize(item.name) !== normalize(item.index) ? <p className="catalog-label mt-1 break-words font-bold">{item.name}</p> : null}
                  {item.notes ? <p className="mt-1 whitespace-pre-line break-words text-xs text-muted">{item.notes}</p> : null}
                  {item.plannedDate ? <p className="mt-1 text-xs text-[#debaff]">Termin: {item.plannedDate}</p> : null}
                </div>
                <div className="p-3">
                  <p className="text-base font-black text-title">{item.station || 'Brak stanowiska'}</p>
                  <p className={cn('mt-1.5 flex items-center gap-1.5 text-sm font-semibold', item.areaId ? 'text-muted' : 'text-warning')}>
                    <MapPin className="h-4 w-4 shrink-0" />{item.areaId ? areaName(item.areaId) : 'Brak przypisanej strefy'}
                  </p>
                </div>
                <div className="p-3 text-right"><PlanQuantity item={item} productionMode={technologyForItem(item)?.productionMode} calculatedQuantity={itemProductionQty(item)} shiftNorm={shiftNormForItem(item)} /></div>
                <div className="p-3 text-right text-base font-bold text-title">{fmt(shiftNormForItem(item))}</div>
                <div className="p-3">{variants.length ? <SelectField className="min-h-11 rounded-lg shadow-none" value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}><option value="">Wybierz technologię</option>{variants.map((technology) => <option key={technology.id} value={technology.id}>{technologySelectLabel(technology)}</option>)}</SelectField> : <Button variant="outline" className="h-11 min-h-11 w-full max-w-[180px] rounded-lg shadow-none" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}><Plus className="mr-2 h-4 w-4" />Dodaj technologię</Button>}{!item.technologyId ? <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-danger"><AlertTriangle className="h-3.5 w-3.5" />Brak technologii</p> : item.manualOverride ? <p className="mt-1.5 text-xs font-bold text-warning">Technologia robocza</p> : <p className="mt-1.5 text-xs font-semibold text-success">Gotowa</p>}</div>
                <div className="p-3"><button type="button" title={expanded ? 'Zwiń pozycję' : 'Rozwiń pozycję'} aria-expanded={expanded} className={cn('flex h-11 w-11 items-center justify-center rounded-lg border text-muted hover:border-brand hover:text-title', expanded ? 'border-brand bg-brandSoft text-title' : 'border-border')} onClick={() => toggleCalculationEditor(item.id, 'plan')}>{expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button></div>
                </div>
              {expanded ? <>
                <div data-plan-details={item.id} className="border-t border-borderStrong bg-[rgba(23,25,36,0.72)]">{renderCalculationDetails(item)}</div>
                <div data-plan-separator={item.id} aria-hidden="true" className="h-2 border-t border-[rgba(255,122,26,0.22)] bg-[rgba(5,6,9,0.78)]" />
              </> : null}
              </div>
            </Fragment>;
          })}</div>
        </div>
      </div>
    </section>;
  };

  const renderPlan = () => <div className="space-y-3">
    <input ref={fileInputRef} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWorkbook(file, 'plan', planUploadModeRef.current === 'update' ? state.planSheet : undefined); event.target.value = ''; }} />

    <section className="overflow-hidden border-y border-border bg-[rgba(255,255,255,0.018)]">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-3 py-3 md:px-4">
        <h1 className="text-xl font-bold text-title">Plan produkcyjny</h1>
        <div className="flex items-center gap-3">
          {readOnly ? <Badge tone="info">Tylko podgląd</Badge> : calculationEditorOpen
            ? <Badge tone={calculationEditorDirty ? 'warning' : 'info'}>{calculationEditorDirty ? 'Niezapisane zmiany' : 'Zapis ręczny'}</Badge>
            : <PlanningSaveStatus info={saveInfo} />}
        </div>
      </div>
      <div className="grid items-start gap-3 border-t border-border p-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,0.8fr)_minmax(260px,1fr)_minmax(320px,1.2fr)]">
        <div className="min-w-0">
          <p className="mb-1.5 h-4 text-xs font-semibold leading-4 text-dim">Dzień produkcji</p>
            <SelectField aria-label="Dzień produkcji" className="h-[52px] max-h-[52px] min-h-[52px] rounded-xl shadow-none" value={showDatePicker ? 'custom' : state.selectedPlanDate} onChange={(event) => {
              const value = event.target.value;
              setShowDatePicker(value === 'custom');
              if (value !== 'custom') selectPlanDate(value);
            }}>
              <option value={today}>Dzisiaj · {formatPlanDate(today)}</option>
              <option value={tomorrow}>Jutro · {formatPlanDate(tomorrow)}</option>
              {savedPlanDates.map((date) => <option key={date} value={date}>{formatPlanDate(date)}</option>)}
              <option value="custom">Inny dzień...</option>
            </SelectField>
          {showDatePicker ? <Input aria-label="Wybrana data produkcji" className="mt-2 h-[52px] max-h-[52px] min-h-[52px] rounded-xl" type="date" value={state.selectedPlanDate} onChange={(event) => selectPlanDate(event.target.value)} /> : null}
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 h-4 text-xs font-semibold leading-4 text-dim">Zapotrzebowanie na</p>
            <SelectField aria-label="Zapotrzebowanie na" className="h-[52px] max-h-[52px] min-h-[52px] rounded-xl shadow-none" disabled={readOnly} value={globalRangeChoice} onChange={(event) => {
              const value = event.target.value;
              setCustomHorizon(value === 'custom');
              if (value === 'custom') {
                if (state.calculationMode === 'all') updateState((current) => ({ ...current, calculationMode: 'horizon' }));
              } else updateState((current) => value === 'all'
                ? { ...current, calculationMode: 'all' }
                : { ...current, calculationMode: 'horizon', horizonShifts: Number(value) });
            }}>
              <option value="3.5">3,5 zmiany</option>
              <option value="9">9 zmian</option>
              <option value="all">Całą produkcję</option>
              <option value="custom">Inną liczbę zmian...</option>
            </SelectField>
          {customRangeVisible ? <div className="mt-2"><PlanAmountField label="Liczba zmian" min={0.5} value={state.horizonShifts} disabled={readOnly} onChange={(value) => updateState((current) => ({ ...current, calculationMode: 'horizon', horizonShifts: value }))} /></div> : null}
        </div>
        <div className="min-w-0">
          <p className="mb-1.5 h-4 text-xs font-semibold leading-4 text-dim">{showAllPlanAreas ? 'Dokument' : `Dokument · ${areaName(state.selectedAreaId)}`}</p>
          {!readOnly ? <Button className="h-[52px] max-h-[52px] min-h-[52px] w-full rounded-xl py-2.5 shadow-none" disabled={showAllPlanAreas || !state.plan.length || unresolvedActiveCount > 0} title={unresolvedActiveCount > 0 ? 'Najpierw uzupełnij ilości aktywnych pozycji' : undefined} onClick={createPickingDocumentFromPlan}><FilePlus2 className="mr-2 h-4 w-4" />{unresolvedActiveCount > 0 ? `Uzupełnij ilości (${unresolvedActiveCount})` : editablePickingDocumentExists ? 'Przelicz i pokaż dokument' : 'Utwórz dokument do wypisania'}</Button>
            : <p className="flex h-[52px] max-h-[52px] min-h-[52px] items-center text-sm font-semibold text-muted">{showAllPlanAreas ? 'Wybierz strefę' : areaName(state.selectedAreaId)}</p>}
        </div>
      </div>
      <div className={cn('grid gap-3 border-t border-border bg-[rgba(0,0,0,0.12)] p-3 md:grid-cols-2 xl:items-end', readOnly ? 'xl:grid-cols-[minmax(240px,1.15fr)_minmax(180px,0.65fr)_minmax(300px,1fr)]' : 'xl:grid-cols-[minmax(240px,1.15fr)_minmax(210px,0.75fr)_minmax(260px,1fr)_auto]')}>
        <div className="min-w-0 border-l-2 border-brand pl-3">
          <p className="text-xs font-semibold text-dim">{pendingPlanWorkbook ? 'Plik do wczytania' : 'Wgrany plik'}</p>
          <p className="mt-1 min-w-0 break-words text-sm font-semibold text-title">{planImportWorkbook?.fileName || currentPlanVersion?.fileName || state.planName || 'Brak pliku'}</p>
        </div>
        {!readOnly && planImportWorkbook ? <label className="block min-w-0 space-y-1.5 text-xs font-semibold text-dim"><span>Arkusz</span>
          <SelectField aria-label="Karta / arkusz Excela" className="min-h-10 rounded-lg shadow-none" value={planImportSheet || ''} onChange={(event) => {
            if (!planImportWorkbook) return;
            setSheetName(event.target.value);
            setPending(planImportWorkbook);
          }}>
            <option value="">{planImportWorkbook ? 'Wybierz kartę' : 'Brak wczytanego pliku'}</option>
            {planImportWorkbook
              ? planImportWorkbook.workbook.SheetNames.map((name) => <option key={name} value={name}>{name}</option>)
              : state.planSheet ? <option value={state.planSheet}>{state.planSheet}</option> : null}
          </SelectField>
        </label> : <div className="min-w-0">
          <p className="text-xs font-semibold text-dim">Arkusz</p>
          <p className="mt-1 flex min-h-10 items-center text-sm font-semibold text-title">{currentPlanVersion?.sheetName || state.planSheet || 'Brak arkusza'}</p>
        </div>}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-dim">Ostatni import</p>
          {currentPlanVersion ? <div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"><Badge tone="info">Wersja {currentPlanVersion.versionNo}</Badge><span>{currentPlanVersion.importedAt} · {currentPlanVersion.importedBy}</span></div>
            : <p className="mt-1 flex min-h-10 items-center text-sm text-muted">Brak wgranej wersji</p>}
        </div>
        {!readOnly ? <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
          {pendingPlanWorkbook ? <>
            <Button variant="ghost" className="min-h-10 rounded-lg px-3 shadow-none" onClick={() => { setPending(null); setSheetName(''); }}><X className="mr-2 h-4 w-4" />Anuluj</Button>
            <Button className="min-h-10 rounded-lg px-3" disabled={!sheetName} onClick={importSelectedSheet}><Check className="mr-2 h-4 w-4" />Wczytaj arkusz</Button>
          </> : <>
            <Button variant="outline" className="min-h-10 rounded-lg px-3 shadow-none" onClick={() => { if (!closeCalculationEditorIfAllowed()) return; planUploadModeRef.current = 'plan'; fileInputRef.current?.click(); }}><Upload className="mr-2 h-4 w-4" />Wgraj plan</Button>
            {currentPlanVersion ? <Button variant="outline" className="min-h-10 rounded-lg px-3 shadow-none" onClick={() => { if (!closeCalculationEditorIfAllowed()) return; planUploadModeRef.current = 'update'; fileInputRef.current?.click(); }}><RefreshCw className="mr-2 h-4 w-4" />Wgraj aktualizację</Button> : null}
          </>}
        </div> : null}
      </div>
    </section>

    {pending?.purpose === 'inventory' ? renderPendingImport() : null}
    <PlanQuantityWarnings items={areaPlan} resolvedItemIds={quantityResolvedPlanItemIds} />

    {state.plan.length ? <div className="space-y-3">
      <div className="flex flex-col gap-3 border-y border-border bg-[rgba(255,255,255,0.025)] px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <p className="text-base font-bold text-title">Produkty do realizacji</p>
          <Badge tone="info">{visibleAreaPlan.length} {visibleAreaPlan.length === 1 ? 'pozycja' : visibleAreaPlan.length > 1 && visibleAreaPlan.length < 5 ? 'pozycje' : 'pozycji'}</Badge>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto" data-plan-list-filters>
          <label className="relative block min-w-0 flex-1 lg:w-[340px]">
            <span className="sr-only">Wyszukaj produkt w planie</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Wyszukaj produkt w planie" type="search" className="h-11 min-h-11 rounded-lg pl-10 shadow-none" placeholder="Szukaj po indeksie, nazwie, stanowisku..." value={planSearch} onChange={(event) => setPlanSearch(event.target.value)} />
          </label>
          <div className="w-full sm:w-[220px]">
            <SelectField aria-label="Strefa planu" className="h-11 min-h-11 rounded-lg shadow-none" value={showAllPlanAreas ? 'all' : state.selectedAreaId} onChange={(event) => selectPlanAreaFilter(event.target.value)}>
              <option value="all">Wszystkie strefy</option>
              {state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </SelectField>
          </div>
        </div>
      </div>
      {visibleAreaPlan.length ? planningSections(visibleAreaPlan).map((section, index) => <Fragment key={`${index}-${section.title}`}>{renderPlanTable(section.items, section.title,
        section.group === 'planned' ? 'Pozycje przyszłe są wyłączone do ręcznego zaznaczenia.' : section.group === 'emergency' ? 'Pozycje wymagające reakcji.' : '', section.group)}</Fragment>)
        : <p className="py-8 text-center text-sm text-muted">{areaPlan.length ? 'Brak produktów pasujących do wyszukiwania.' : showAllPlanAreas ? 'Brak pozycji w planie.' : `Brak pozycji w strefie: ${areaName(state.selectedAreaId)}.`}</p>}
    </div> : <EmptyState title={`Brak planu na ${formatPlanDate(state.selectedPlanDate)}`} description="Wgraj pierwszy plan dla wybranej daty. Poprzednie dni i wersje pozostaną w historii." />}
  </div>;

  const renderTechnologies = () => {
    const normalizedSearch = normalize(technologySearch);
    const technologyProductKey = (technology: Technology) =>
      normalize(technology.productIndex) || normalize(technology.productName) || technology.id;
    const productCount = (archived: boolean) => new Set(
      state.technologies.filter((technology) => technology.archived === archived).map(technologyProductKey)
    ).size;
    const technologyGroups = new Map<string, Technology[]>();
    state.technologies
      .filter((technology) => technologyFilter === 'archived' ? technology.archived : !technology.archived)
      .forEach((technology) => {
        const key = technologyProductKey(technology);
        technologyGroups.set(key, [...(technologyGroups.get(key) ?? []), technology]);
      });
    const filteredTechnologyGroups = [...technologyGroups.entries()]
      .map(([key, variants]) => ({
        key,
        variants: variants.sort((left, right) => Number(left.variant !== 'base') - Number(right.variant !== 'base') || left.alternativeNo - right.alternativeNo)
      }))
      .filter(({ variants }) => !normalizedSearch || variants.some((technology) =>
        normalize(`${technology.productIndex} ${technology.productName} ${technology.description}`).includes(normalizedSearch)
      ))
      .sort((left, right) => left.variants[0].productName.localeCompare(right.variants[0].productName, 'pl'));
    const selected = selectedTechnologyEditorSource;
    const editorTechnology = technologyDraft;
    const isDraft = selected === null;
    const editorProductVariants = editorTechnology.productIndex || editorTechnology.productName
      ? state.technologies
        .filter((technology) => !technology.archived && technologyMatchesProduct(
          technology,
          editorTechnology.productIndex,
          editorTechnology.productName
        ))
        .sort((left, right) => Number(left.variant !== 'base') - Number(right.variant !== 'base') || left.alternativeNo - right.alternativeNo)
      : [];
    const editorBaseTechnology = editorProductVariants.find((technology) => technology.variant === 'base');
    const editorEmergencyVariants = editorProductVariants.filter((technology) => technology.variant === 'alternative');
    const selectedEmergencyTechnology = selected?.variant === 'alternative'
      ? selected
      : editorEmergencyVariants[0];
    const nextEmergencyVariantNo = Math.max(0, ...editorEmergencyVariants.map((technology) => technology.alternativeNo)) + 1;
    const technologyActionButtonClass = 'h-10 min-h-10 w-full rounded-lg px-3 py-2 sm:w-[148px]';
    const updateEditorTechnology = (patch: Partial<Technology>) => {
      if (readOnly) return;
      setTechnologyDraft((current) => ({ ...current, ...patch }));
    };
    const selectTechnologyDraftVariant = (variant: Technology['variant']) => {
      if (selected || readOnly) return;
      if (variant === 'base' && editorBaseTechnology) {
        flash('Ten produkt ma już technologię bazową. Wybierz wariant awaryjny.');
        return;
      }
      if (variant === 'alternative' && (editorTechnology.productIndex.trim() || editorTechnology.productName.trim()) && !editorBaseTechnology) {
        flash('Najpierw zapisz technologię bazową dla tego produktu.');
        return;
      }
      updateEditorTechnology({
        variant,
        alternativeNo: variant === 'base' ? 0 : nextEmergencyVariantNo,
        productionMode: variant === 'alternative' && editorBaseTechnology
          ? editorBaseTechnology.productionMode ?? 'planned'
          : editorTechnology.productionMode,
        materials: variant === 'alternative' && editorBaseTechnology && !editorTechnology.materials.length
          ? cloneMaterials(editorBaseTechnology.materials)
          : editorTechnology.materials,
        linkedProducts: variant === 'alternative' && editorBaseTechnology && !(editorTechnology.linkedProducts ?? []).length
          ? (editorBaseTechnology.linkedProducts ?? []).map((link) => ({ ...link }))
          : editorTechnology.linkedProducts,
        surplusMaterials: variant === 'alternative' && editorBaseTechnology && !(editorTechnology.surplusMaterials ?? []).length
          ? cloneMaterials(editorBaseTechnology.surplusMaterials ?? [])
          : editorTechnology.surplusMaterials,
        shiftNorm: variant === 'alternative' && editorBaseTechnology && !editorTechnology.shiftNorm
          ? editorBaseTechnology.shiftNorm
          : editorTechnology.shiftNorm
      });
    };
    const updateEditorMaterials = (
      field: 'materials' | 'surplusMaterials',
      updater: (materials: TechnologyMaterial[]) => TechnologyMaterial[]
    ) => {
      updateEditorTechnology({ [field]: updater(editorTechnology[field] ?? []) });
    };
    const selectEditorMaterial = (field: 'materials' | 'surplusMaterials', materialId: string, item: ProductCatalogItem) => {
      updateEditorMaterials(field, (materials) => materials.map((material) => material.id === materialId
        ? { ...material, ...catalogMaterialPatch(material, item) }
        : material));
    };
    const addEditorMaterial = (field: 'materials' | 'surplusMaterials') => {
      setTechnologyMaterialSearch('');
      updateEditorMaterials(field, (materials) => [...materials, {
        id: uid('mat'),
        code: '',
        name: '',
        category: 'Pozostałe',
        usage: 0,
        unit: 'kg',
        logisticQty: 1
      }]);
    };
    const updateEditorLinks = (updater: (links: LinkedProduct[]) => LinkedProduct[]) => {
      updateEditorTechnology({ linkedProducts: updater(editorTechnology.linkedProducts ?? []) });
    };
    const selectEditorLink = (linkId: string, item: ProductCatalogItem) => {
      updateEditorLinks((links) => links.map((link) => link.id === linkId ? {
        ...link,
        productIndex: item.index || link.productIndex,
        productName: item.name || link.productName,
        unit: item.unit || link.unit
      } : link));
    };
    const addEditorLink = () => updateEditorLinks((links) => [...links, {
      id: uid('link'),
      productIndex: '',
      productName: '',
      usage: 1,
      unit: 'szt.'
    }]);
    const renderEditorMaterialsTable = (field: 'materials' | 'surplusMaterials', emptyText: string) => {
      const materials = editorTechnology[field] ?? [];
      const normalizedMaterialSearch = normalize(technologyMaterialSearch);
      const visibleMaterials = normalizedMaterialSearch
        ? materials.filter((material) => normalize(`${material.code} ${material.name} ${material.category}`).includes(normalizedMaterialSearch))
        : materials;
      if (!materials.length) return <p className="border-y border-border py-4 text-sm text-muted">{emptyText}</p>;
      if (!visibleMaterials.length) return <p className="border-y border-border py-4 text-sm text-muted">Brak materiałów pasujących do wyszukiwania.</p>;
      const compactInputClass = 'min-h-9 rounded-none border-0 bg-transparent px-2 py-1 text-xs shadow-none focus:bg-[rgba(255,122,26,0.06)] focus:ring-1';
      return <div className="overflow-x-auto rounded-lg border border-borderStrong bg-[rgba(0,0,0,0.16)]">
        <table className="w-full min-w-[1144px] table-fixed text-xs">
          <colgroup><col className="w-[220px]" /><col className="w-[480px]" /><col className="w-[150px]" /><col className="w-[150px]" /><col className="w-[100px]" /><col className="w-[44px]" /></colgroup>
          <thead className="bg-[rgba(255,255,255,0.045)] text-left text-[10px] uppercase text-dim"><tr><th className="border-r border-border px-2 py-1.5">Kod</th><th className="border-r border-border px-2 py-1.5">Nazwa materiału</th><th className="border-r border-border px-2 py-1.5">Rodzaj</th><th className="border-r border-border px-2 py-1.5">Przelicznik / szt.</th><th className="border-r border-border px-2 py-1.5">J.m. wyniku</th><th><span className="sr-only">Akcje</span></th></tr></thead>
          <tbody>{visibleMaterials.map((material) => <tr key={material.id} className="border-t border-border transition hover:bg-[rgba(255,255,255,0.025)]">
            <td className="border-r border-border p-0"><Input className={cn(compactInputClass, 'font-semibold text-title')} list="material-code-suggestions" value={material.code} onCatalogSelect={(item) => selectEditorMaterial(field, material.id, item)} onChange={(event) => updateEditorMaterials(field, (rows) => rows.map((row) => row.id === material.id ? { ...row, code: event.target.value } : row))} /></td>
            <td className="border-r border-border p-0"><Input className={compactInputClass} list="material-name-suggestions" title={material.name} value={material.name} onCatalogSelect={(item) => selectEditorMaterial(field, material.id, item)} onChange={(event) => updateEditorMaterials(field, (rows) => rows.map((row) => row.id === material.id ? { ...row, name: event.target.value } : row))} /></td>
            <td className="border-r border-border p-0"><SelectField className="min-h-9 rounded-none border-0 bg-[none] px-2 py-1 text-xs shadow-none ring-0 focus:ring-1" value={material.category} onChange={(event) => updateEditorMaterials(field, (rows) => rows.map((row) => row.id === material.id ? { ...row, category: event.target.value as MaterialCategory } : row))}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td>
            <td className="border-r border-border p-0"><div className="flex min-h-9 items-center"><Input className={cn(compactInputClass, 'text-right tabular-nums')} aria-label={`Przelicznik na sztukę (${technologyUsageInputUnit(material)})`} type="number" step="0.001" value={technologyUsageForEditor(material)} onChange={(event) => updateEditorMaterials(field, (rows) => rows.map((row) => row.id === material.id ? { ...row, usage: technologyUsageFromEditor(row, Math.max(0, numberValue(event.target.value))) } : row))} /><span className="pr-2 text-[10px] font-bold text-muted">{technologyUsageInputUnit(material)}</span></div></td>
            <td className="border-r border-border p-0"><Input className={cn(compactInputClass, 'font-semibold')} aria-label="Jednostka wyniku" value={technologyResultUnit(material.unit)} onChange={(event) => updateEditorMaterials(field, (rows) => rows.map((row) => row.id === material.id ? technologyMaterialWithUnit(row, event.target.value) : row))} /></td>
            <td className="p-0 text-center">{!readOnly ? <Button title="Usuń pozycję" aria-label="Usuń pozycję" variant="ghost" className="h-9 min-h-9 w-9 rounded-none border-0 px-0 py-0 text-danger ring-0" onClick={() => updateEditorMaterials(field, (rows) => rows.filter((row) => row.id !== material.id))}><Trash2 className="h-3.5 w-3.5" /></Button> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>;
    };

    return <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-black text-title md:text-3xl">Biblioteka technologii</h1>
        <p className="mt-1 text-sm text-muted">Każdy produkt ma technologię bazową oraz opcjonalne, opisane warianty awaryjne.</p>
      </div>
      <Tabs value={technologyPanel} onValueChange={(value) => {
        const nextPanel = value as 'editor' | 'list';
        if (nextPanel === technologyPanel) return;
        if (technologyPanel === 'editor' && technologyEditorDirty) {
          if (!confirmDiscardTechnologyEditor()) return;
          resetTechnologyEditor();
        }
        if (nextPanel === 'editor') clearTechnologyEditor();
        setTechnologyPanel(nextPanel);
      }} className="space-y-5">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="w-full flex-nowrap sm:w-fit">
            <TabsTrigger value="editor" className="flex h-10 min-h-10 min-w-0 flex-1 items-center justify-center gap-2 px-3 sm:w-[164px] sm:flex-none">
              <PencilLine className="h-4 w-4" />Edytor technologii
            </TabsTrigger>
            <TabsTrigger value="list" className="flex h-10 min-h-10 min-w-0 flex-1 items-center justify-center gap-2 px-3 sm:w-[164px] sm:flex-none">
              <ListFilter className="h-4 w-4" />Technologie ({productCount(false)})
            </TabsTrigger>
          </TabsList>
          {!readOnly ? <Button className="h-10 min-h-10 w-full rounded-lg px-3 py-2 sm:w-[176px]" onClick={startTechnologyDraft}><Plus className="mr-2 h-4 w-4" />Nowa technologia</Button> : null}
        </div>

        <TabsContent value="list" className="space-y-4">
          <Card className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-dim" />
              <Input className="min-h-14 pl-12 text-base" placeholder="Szukaj po indeksie lub nazwie produktu" value={technologySearch} onChange={(event) => setTechnologySearch(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant={technologyFilter === 'active' ? 'secondary' : 'outline'} onClick={() => setTechnologyFilter('active')}>Aktywne ({productCount(false)})</Button>
              <Button variant={technologyFilter === 'archived' ? 'secondary' : 'outline'} onClick={() => setTechnologyFilter('archived')}>Archiwalne ({productCount(true)})</Button>
            </div>
          </Card>
          <Card className="space-y-3">
            <SectionTitle title={technologyFilter === 'active' ? 'Aktywne technologie' : 'Archiwalne technologie'} subtitle={`${filteredTechnologyGroups.length} ${filteredTechnologyGroups.length === 1 ? 'indeks' : 'indeksów'}`} />
            <div className="grid max-h-[68vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
              {filteredTechnologyGroups.map((group) => {
                const primary = group.variants.find((technology) => technology.variant === 'base') ?? group.variants[0];
                const emergencyVariants = group.variants.filter((technology) => technology.variant === 'alternative');
                const selectedGroup = group.variants.some((technology) => technology.id === selected?.id);
                return <button
                  key={group.key}
                  onClick={() => openTechnologyEditor(primary.id)}
                  className={cn('w-full rounded-lg border p-3 text-left transition', selectedGroup ? 'border-[rgba(255,122,26,0.75)] bg-brandSoft' : 'border-border bg-[rgba(255,255,255,0.025)] hover:border-borderStrong')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge tone={primary.variant === 'base' ? 'success' : 'info'}>{primary.variant === 'base' ? 'Technologia bazowa' : 'Warianty archiwalne'}</Badge>
                    <span className="text-xs text-dim">{group.variants.length} {group.variants.length === 1 ? 'wariant' : group.variants.length < 5 ? 'warianty' : 'wariantów'}</span>
                  </div>
                  <p className="mt-2 break-words font-bold text-title">{primary.productIndex || 'Nowy indeks'}</p>
                  <p className="catalog-label mt-1 line-clamp-2 text-xs font-semibold">{primary.productName || 'Uzupełnij nazwę produktu'}</p>
                  {emergencyVariants.length ? <div className="mt-3 border-t border-border pt-2 text-xs text-muted">
                    {emergencyVariants.slice(0, 2).map((technology) => <p key={technology.id} className="line-clamp-1"><span className="font-bold text-warning">{technologyLabel(technology)}:</span> {technology.description}</p>)}
                    {emergencyVariants.length > 2 ? <p className="mt-1 text-dim">+ {emergencyVariants.length - 2} kolejne</p> : null}
                  </div> : null}
                </button>;
              })}
              {!filteredTechnologyGroups.length ? <p className="py-8 text-center text-sm text-muted sm:col-span-2 xl:col-span-3">Brak technologii spełniających kryteria.</p> : null}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="editor" className="space-y-3">
          <section className="rounded-lg border border-borderStrong bg-[rgba(255,255,255,0.025)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-black text-title">Produkt i technologia</h2>
              <Badge tone={editorTechnology.archived ? 'default' : selected ? 'success' : 'info'}>{editorTechnology.archived ? 'Archiwalna' : selected ? 'Aktywna' : 'Nowa'}</Badge>
            </div>
            {isDraft ? <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(210px,0.7fr)_minmax(320px,1.3fr)_minmax(280px,0.8fr)] lg:items-end">
              <ProductCatalogField label="Indeks produktu" mode="index" value={editorTechnology.productIndex} items={technologyProductIndexSearch.items} loading={technologyProductIndexSearch.loading} onChange={(value) => editTechnologyEditorProductField('index', value)} onSelect={selectTechnologyEditorProduct} />
              <ProductCatalogField label="Nazwa produktu" mode="name" value={editorTechnology.productName} items={technologyProductNameSearch.items} loading={technologyProductNameSearch.loading} onChange={(value) => editTechnologyEditorProductField('name', value)} onSelect={selectTechnologyEditorProduct} />
              <div className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-dim">
                <div className="flex items-center justify-between gap-2"><span>Rodzaj technologii</span><span className="normal-case tracking-normal text-muted">{technologyLabel(editorTechnology)}</span></div>
                <div role="group" aria-label="Rodzaj technologii" className="grid h-11 grid-cols-2 gap-1 rounded-lg border border-border bg-[rgba(0,0,0,0.28)] p-1">
                  <button
                    type="button"
                    aria-pressed={editorTechnology.variant === 'base'}
                    disabled={Boolean(editorBaseTechnology)}
                    onClick={() => selectTechnologyDraftVariant('base')}
                    className={cn('rounded-md px-3 text-xs font-bold normal-case tracking-normal transition disabled:cursor-not-allowed disabled:opacity-40', editorTechnology.variant === 'base' ? 'bg-brandSoft text-title ring-1 ring-brand' : 'text-muted hover:bg-[rgba(255,255,255,0.05)]')}
                  >Bazowa</button>
                  <button
                    type="button"
                    aria-pressed={editorTechnology.variant === 'alternative'}
                    disabled={Boolean((editorTechnology.productIndex.trim() || editorTechnology.productName.trim()) && !editorBaseTechnology)}
                    onClick={() => selectTechnologyDraftVariant('alternative')}
                    className={cn('rounded-md px-3 text-xs font-bold normal-case tracking-normal transition disabled:cursor-not-allowed disabled:opacity-40', editorTechnology.variant === 'alternative' ? 'bg-brandSoft text-title ring-1 ring-brand' : 'text-muted hover:bg-[rgba(255,255,255,0.05)]')}
                  >Awaryjna</button>
                </div>
                {editorBaseTechnology ? <p className="normal-case tracking-normal text-muted">Bazowa już istnieje. Tworzysz kolejny wariant awaryjny.</p> : editorTechnology.productIndex.trim() || editorTechnology.productName.trim() ? <p className="normal-case tracking-normal text-muted">Dla nowego produktu najpierw zapisz technologię bazową.</p> : null}
              </div>
            </div> : <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.8fr)] lg:items-end">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-border pb-3 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-5">
                <span className="text-lg font-black text-title">{editorTechnology.productIndex}</span>
                <span className="catalog-label min-w-0 break-words text-sm font-bold">{editorTechnology.productName}</span>
              </div>
              <Field label="Wariant technologii">
                <SelectField className="h-11 min-h-11 rounded-lg" value={selected?.id ?? ''} onChange={(event) => event.target.value && openTechnologyEditor(event.target.value)}>
                  {editorProductVariants.map((technology) => <option key={technology.id} value={technology.id}>{technologySelectLabel(technology)}</option>)}
                </SelectField>
              </Field>
            </div>}
          </section>

          {editorProductVariants.length ? <section className="border-y border-borderStrong px-1 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black text-title">Warianty produktu</h2>
                <p className="mt-0.5 text-xs text-muted">Bazowa jest domyślna. Wariant awaryjny wybiera się świadomie dla konkretnej produkcji.</p>
              </div>
              <Badge tone="info">{editorProductVariants.length} {editorProductVariants.length === 1 ? 'wariant' : editorProductVariants.length < 5 ? 'warianty' : 'wariantów'}</Badge>
            </div>
            <div className="mt-3 grid items-start gap-2 md:grid-cols-2">
              {editorBaseTechnology ? <button
                type="button"
                onClick={() => openTechnologyEditor(editorBaseTechnology.id)}
                className={cn(
                  'h-[72px] overflow-hidden rounded-lg border px-3 py-2.5 text-left transition',
                  selected?.id === editorBaseTechnology.id
                    ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_9%,transparent)]'
                    : 'border-border bg-[rgba(255,255,255,0.02)] hover:border-borderStrong'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="success">Bazowa</Badge>
                  <span className="text-xs text-dim">{editorBaseTechnology.materials.length} poz.</span>
                </div>
                <p className="mt-2 line-clamp-1 text-xs font-semibold text-title">{editorBaseTechnology.description || 'Technologia domyślna'}</p>
              </button> : <div className="flex h-[72px] items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted">Brak zapisanej technologii bazowej.</div>}

              {editorEmergencyVariants.length ? <details className="group overflow-hidden rounded-lg border border-border bg-[rgba(255,255,255,0.02)]">
                <summary className="flex h-[70px] cursor-pointer list-none flex-col justify-center px-3 py-2 transition hover:bg-[rgba(255,255,255,0.025)] [&::-webkit-details-marker]:hidden">
                  <div className="flex items-center gap-2">
                    <Badge tone="warning">Awaryjne</Badge>
                    <span className="ml-auto text-xs text-dim">{editorEmergencyVariants.length} {editorEmergencyVariants.length === 1 ? 'wariant' : editorEmergencyVariants.length < 5 ? 'warianty' : 'wariantów'}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
                  </div>
                  <div className="mt-2 flex min-w-0 items-baseline gap-3">
                    <span className="shrink-0 text-xs font-black text-warning">{selectedEmergencyTechnology ? technologyLabel(selectedEmergencyTechnology) : 'Wybierz wariant'}</span>
                    {selectedEmergencyTechnology ? <span className="line-clamp-1 min-w-0 text-xs text-muted">{selectedEmergencyTechnology.description}</span> : null}
                  </div>
                </summary>
                <div className="border-t border-border">
                  {editorEmergencyVariants.map((technology) => <button
                    key={technology.id}
                    type="button"
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open');
                      openTechnologyEditor(technology.id);
                    }}
                    className={cn(
                      'grid min-h-10 w-full grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-2 text-left text-xs transition last:border-b-0 hover:bg-[rgba(255,255,255,0.035)]',
                      selected?.id === technology.id && 'bg-brandSoft'
                    )}
                  >
                    <span className="font-black text-warning">{technologyLabel(technology)}</span>
                    <span className="min-w-0 break-words text-muted">{technology.description}</span>
                    <span className="flex items-center gap-2 whitespace-nowrap text-dim">{technology.materials.length} poz.{selected?.id === technology.id ? <Check className="h-4 w-4 text-success" /> : null}</span>
                  </button>)}
                </div>
              </details> : <div className="flex h-[72px] items-center rounded-lg border border-dashed border-border px-3 text-xs text-muted">Brak wariantów awaryjnych.</div>}
            </div>
          </section> : null}

          <Card className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <SectionTitle
                title={isDraft ? 'Nowa technologia' : `${technologyLabel(editorTechnology)} · ${editorTechnology.productIndex}`}
                subtitle={technologyEditorDirty ? 'Zmiany istnieją tylko w tym formularzu do czasu zapisu.' : isDraft ? 'Pusty formularz nowej technologii.' : 'Technologia zapisana w bibliotece.'}
              />
              <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
                <div className="flex min-h-6 items-center lg:justify-end">
                  {technologyEditorDirty
                    ? <Badge tone="warning">Niezapisane zmiany</Badge>
                    : !readOnly && selected ? <PlanningSaveStatus info={saveInfo} /> : <Badge tone="info">Nowa technologia</Badge>}
                </div>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                  {!readOnly && technologyEditorDirty ? <Button className={technologyActionButtonClass} variant="outline" onClick={resetTechnologyEditor}><Undo2 className="mr-2 h-4 w-4" />Anuluj zmiany</Button> : null}
                  {!readOnly ? <Button className={technologyActionButtonClass} onClick={saveTechnologyEditor} disabled={!technologyEditorDirty || !editorTechnology.productIndex.trim() || !editorTechnology.productName.trim() || (editorTechnology.variant === 'alternative' && !editorTechnology.description.trim()) || (editorTechnology.productionMode === 'continuous' && editorTechnology.shiftNorm <= 0)}><Check className="mr-2 h-4 w-4" />{isDraft ? 'Zapisz technologię' : 'Zapisz zmiany'}</Button> : null}
                  {selected && !readOnly ? editorTechnology.archived
                    ? <Button className={technologyActionButtonClass} variant="secondary" onClick={() => updateEditorTechnology({ archived: false })}><RefreshCw className="mr-2 h-4 w-4" />Przywróć</Button>
                    : <Button className={technologyActionButtonClass} variant="ghost" onClick={() => updateEditorTechnology({ archived: true })}><Archive className="mr-2 h-4 w-4" />Archiwizuj</Button> : null}
                  {selected && !readOnly ? <Button title="Usuń technologię" className={cn(technologyActionButtonClass, 'text-danger')} variant="ghost" onClick={() => deleteTechnology(selected.id)}><Trash2 className="mr-2 h-4 w-4" />Usuń</Button> : null}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[220px_220px_minmax(0,1fr)]">
              <Field label="Tryb produkcji">
                <SelectField value={editorTechnology.productionMode ?? 'planned'} onChange={(event) => updateEditorTechnology({ productionMode: event.target.value as TechnologyProductionMode })}>
                  <option value="planned">Według planu</option>
                  <option value="continuous">Produkcja ciągła</option>
                  <option value="linked">Pod powiązanie</option>
                </SelectField>
              </Field>
              <Field label={editorTechnology.productionMode === 'continuous' ? 'Wydajność na zmianę (szt.)' : editorTechnology.productionMode === 'linked' ? 'Norma pomocnicza (opc.)' : 'Norma na zmianę (8h)'}><Input type="number" value={editorTechnology.shiftNorm} onChange={(event) => updateEditorTechnology({ shiftNorm: Math.max(0, numberValue(event.target.value)) })} /></Field>
              <Field label={editorTechnology.variant === 'alternative' ? 'Opis wariantu (wymagany)' : 'Opis bazowej (opcjonalny)'}><Input placeholder={editorTechnology.variant === 'alternative' ? 'np. Przemiał + czarny barwnik + karton 600x410' : 'np. Oryginał bez barwnika'} value={editorTechnology.description} onChange={(event) => updateEditorTechnology({ description: event.target.value })} /></Field>
              <label className="space-y-1.5 text-xs font-semibold uppercase tracking-wide text-dim md:col-span-3">
                <span>Uwagi (opcjonalne)</span>
                <textarea className="min-h-20 w-full rounded-xl border border-border bg-[rgba(0,0,0,0.4)] p-3 text-sm font-normal normal-case tracking-normal text-body focus:border-[rgba(255,106,0,0.55)] focus:outline-none" value={editorTechnology.notes} onChange={(event) => updateEditorTechnology({ notes: event.target.value })} />
              </label>
            </div>

            <section className="space-y-3 border-t border-borderStrong pt-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <SectionTitle
                    title={editorTechnology.variant === 'base' ? 'Materiały technologii bazowej' : `Materiały wariantu Awaryjna ${editorTechnology.alternativeNo}`}
                    subtitle={editorTechnology.variant === 'base' ? 'Zestaw domyślny. Przelicznik masy na jedną sztukę jest podawany w gramach.' : 'Pełna receptura wariantu. Nie jest automatycznie łączona z materiałami technologii bazowej.'}
                  />
                  <Badge tone="info">{editorTechnology.materials.length} {editorTechnology.materials.length === 1 ? 'materiał' : 'materiałów'}</Badge>
                </div>
                <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
                  <div className="relative min-w-0 flex-1 lg:w-64">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
                    <Input className="min-h-9 rounded-lg py-1 pl-9 text-xs" placeholder="Szukaj materiału (kod, nazwa...)" value={technologyMaterialSearch} onChange={(event) => setTechnologyMaterialSearch(event.target.value)} />
                  </div>
                  {!readOnly ? <Button className="min-h-9 rounded-lg px-3 py-1.5 text-xs" variant="outline" onClick={() => addEditorMaterial('materials')}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button> : null}
                </div>
              </div>
              {renderEditorMaterialsTable('materials', 'Brak materiałów w tym wariancie.')}
            </section>

            <section className="space-y-3 border-t border-borderStrong pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <SectionTitle title="Powiązane półwyroby" subtitle="Półwyrób może zostać pobrany z magazynu albo przekazany bezpośrednio z innej pozycji planu." />
                  <Badge tone="info">{(editorTechnology.linkedProducts ?? []).length} powiązań</Badge>
                </div>
                {!readOnly ? <Button className="min-h-9 rounded-lg px-3 py-1.5 text-xs" variant="outline" onClick={addEditorLink}><Link2 className="mr-2 h-4 w-4" />Dodaj powiązanie</Button> : null}
              </div>
              {(editorTechnology.linkedProducts ?? []).length ? <div className="space-y-2">
                {(editorTechnology.linkedProducts ?? []).map((link) => <div key={link.id} className="grid gap-2 border-y border-border py-2 lg:grid-cols-[220px_minmax(320px,1fr)_150px_110px_44px] lg:items-end">
                  <Field label="Indeks półwyrobu"><Input list="material-code-suggestions" value={link.productIndex} onCatalogSelect={(item) => selectEditorLink(link.id, item)} onChange={(event) => updateEditorLinks((links) => links.map((row) => row.id === link.id ? { ...row, productIndex: event.target.value } : row))} /></Field>
                  <Field label="Nazwa półwyrobu"><Input list="material-name-suggestions" value={link.productName} onCatalogSelect={(item) => selectEditorLink(link.id, item)} onChange={(event) => updateEditorLinks((links) => links.map((row) => row.id === link.id ? { ...row, productName: event.target.value } : row))} /></Field>
                  <Field label="Zużycie / produkt"><Input className="text-right tabular-nums" type="number" min="0" step="0.001" value={link.usage} onChange={(event) => updateEditorLinks((links) => links.map((row) => row.id === link.id ? { ...row, usage: Math.max(0, numberValue(event.target.value)) } : row))} /></Field>
                  <Field label="J.m."><Input value={link.unit} onChange={(event) => updateEditorLinks((links) => links.map((row) => row.id === link.id ? { ...row, unit: event.target.value } : row))} /></Field>
                  {!readOnly ? <Button title="Usuń powiązanie" aria-label="Usuń powiązanie" variant="ghost" className="h-11 min-h-11 w-11 px-0 text-danger" onClick={() => updateEditorLinks((links) => links.filter((row) => row.id !== link.id))}><Trash2 className="h-4 w-4" /></Button> : null}
                </div>)}
              </div> : <p className="border-y border-border py-4 text-sm text-muted">Ta technologia nie pobiera półwyrobu z powiązanej produkcji.</p>}
            </section>

            <section className="space-y-3 border-t border-borderStrong pt-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-start gap-2">
                  <SectionTitle title="Pakowanie nadwyżki" subtitle="Te materiały są liczone tylko od ilości produktu, która po przekazaniu do powiązanej produkcji pozostaje do wydania na magazyn." />
                  <Badge tone="info">{(editorTechnology.surplusMaterials ?? []).length} {(editorTechnology.surplusMaterials ?? []).length === 1 ? 'materiał' : 'materiałów'}</Badge>
                </div>
                {!readOnly ? <Button className="min-h-9 rounded-lg px-3 py-1.5 text-xs" variant="outline" onClick={() => addEditorMaterial('surplusMaterials')}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button> : null}
              </div>
              {renderEditorMaterialsTable('surplusMaterials', 'Brak osobnego pakowania nadwyżki.')}
            </section>
          </Card>
        </TabsContent>
      </Tabs>
    </div>;
  };

  const renderInventory = () => <SpisRzeczywisty />;

  const renderCalculationDetails = (item: PlanItem) => {
    const technology = technologyForItem(item);
    const itemTechnologies = technologiesFor(item);
    const materials = materialsForItem(item);
    const nextAlternativeNo = technology ? Math.max(
      0,
      ...state.technologies
        .filter((candidate) => candidate.variant === 'alternative' && technologyMatchesProduct(candidate, technology.productIndex, technology.productName))
        .map((candidate) => candidate.alternativeNo)
    ) + 1 : 1;
    const continuousProduction = technology?.productionMode === 'continuous';
    const linkedProduction = technology?.productionMode === 'linked';
    const quantityReview = planQuantityNeedsReview(item);
    const ownQuantityReview = quantityNeedsReview(item);
    const norm = shiftNormForItem(item);
    const selectedQty = itemProductionQty(item);
    const remaining = itemProductionQty(item, true);
    const hasCorrection = state.quantityCorrections.some((correction) => correction.planDate === state.selectedPlanDate && correction.itemId === item.id && !correction.revertedAt);
    const editorLocked = readOnly || calculationEditorSaving;
    const updateScope = (patch: Pick<PlanItem, 'scopeMode' | 'scopeShifts' | 'scopeQuantity'>) => updateState((current) => ({
      ...current,
      plan: current.plan.map((row) => (item.productionGroupId
        ? row.productionGroupId === item.productionGroupId
        : row.id === item.id) ? { ...row, ...patch } : row)
    }));
    const compactPlanMaterialInputClass = 'h-9 min-h-9 rounded-none border-0 bg-transparent px-2 py-1 text-xs shadow-none focus:bg-[rgba(255,122,26,0.06)] focus:ring-1';
    const linkedProducts = technology?.linkedProducts ?? [];
    const selectedAllocatedOutput = selectedLinkedAllocationByProducer.get(item.id) ?? 0;
    const fullAllocatedOutput = fullLinkedAllocationByProducer.get(item.id) ?? 0;
    const selectedSurplusQuantity = linkedSurplusQuantity(selectedQty, selectedAllocatedOutput);
    const fullSurplusQuantity = linkedSurplusQuantity(remaining, fullAllocatedOutput);

    return <div className="space-y-4 px-5 py-4 md:px-6 md:py-5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-borderStrong pb-3">
        {item.productionGroupId ? <Badge tone="info">Detal {(item.productionOutputOrder ?? 0) + 1} z {item.productionOutputCount}</Badge> : null}
        <span className="font-bold text-title">{item.index}</span>
        {normalize(item.name) !== normalize(item.index) ? <span className="catalog-label break-words font-bold">{item.name}</span> : null}
      </div>

      <section className="space-y-2">
        <div className="grid gap-2 xl:grid-cols-[150px_150px_44px_minmax(170px,0.7fr)_minmax(210px,0.9fr)_290px] xl:items-end">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-end gap-2 xl:contents">
            {continuousProduction ? <Field label="Tryb produkcji"><div className="flex h-11 items-center gap-2 rounded-lg border border-brand bg-brandSoft px-3 font-bold text-title"><Factory className="h-4 w-4 text-brand" />Ciągła</div></Field>
              : <PlanAmountField key={item.id + '-quantity'} label={linkedProduction ? 'Własny plan (szt.)' : 'Do zrobienia (szt.)'} value={linkedProduction ? (ownQuantityReview ? null : knownRemainingQuantity(item)) : (quantityReview ? null : remaining)} disabled={editorLocked} onChange={(value, editId) => updatePlanQuantity(item.id, value, editId)} />}
            <PlanAmountField key={item.id + '-norm'} label={continuousProduction ? 'Wydajność / zmianę (szt.)' : linkedProduction ? 'Norma pomocnicza (szt.)' : 'Norma na zmianę (szt.)'} value={norm} disabled={editorLocked} onChange={(value) => updatePlanNorm(item.id, value)} />
            {continuousProduction ? <div className="h-11 w-11" aria-hidden="true" /> : <Button title="Cofnij ostatnią zmianę ilości" aria-label="Cofnij ostatnią zmianę ilości" variant="ghost" className="h-11 min-h-11 w-11 rounded-lg p-0" disabled={editorLocked || !hasCorrection} onClick={() => undoLastCorrection(item)}><Undo2 className="h-4 w-4" /></Button>}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(160px,0.75fr)_minmax(210px,1fr)_290px] xl:contents">
            <Field label="Zakres obliczeń">
              <SelectField className="h-11 min-h-11 rounded-lg shadow-none" aria-label="Zakres obliczeń pozycji" disabled={editorLocked} value={item.scopeMode ?? 'global'} onChange={(event) => updateScope({ scopeMode: event.target.value as ItemScopeMode, scopeShifts: item.scopeShifts, scopeQuantity: item.scopeQuantity })}>
                <option value="global">{continuousProduction || linkedProduction || state.calculationMode !== 'all' ? `Z planu: ${fmt(state.horizonShifts)} zm.` : 'Z planu: cała produkcja'}</option>
                {!continuousProduction ? <option value="all">Cała produkcja</option> : null}
                <option value="shifts">Inna liczba zmian</option>
                <option value="quantity">Wybrana liczba sztuk</option>
              </SelectField>
            </Field>
            <Field label="Technologia">
              {itemTechnologies.length ? <SelectField aria-label="Wariant technologii" className="h-11 min-h-11 rounded-lg shadow-none" disabled={editorLocked} value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}>
                <option value="">Wybierz technologię</option>
                {itemTechnologies.map((variant) => <option key={variant.id} value={variant.id}>{technologySelectLabel(variant)}</option>)}
              </SelectField> : <Button className="h-11 min-h-11 w-full rounded-lg py-2" variant="outline" disabled={editorLocked} onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}><Plus className="mr-2 h-4 w-4" />Dodaj technologię</Button>}
            </Field>
            {!readOnly ? <div className="space-y-1.5">
              <p className={cn('text-xs font-semibold uppercase text-dim', calculationEditorDirty && 'text-warning')}>{calculationEditorDirty ? 'Niezapisane zmiany' : 'Zmiany pozycji'}</p>
              <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                <Button title="Odrzuć niezapisane zmiany" aria-label="Odrzuć niezapisane zmiany" variant="outline" className="h-12 min-h-12 w-full whitespace-nowrap rounded-lg px-3 py-2" disabled={!calculationEditorDirty || calculationEditorSaving} onClick={resetCalculationEditorChanges}><X className="mr-2 h-4 w-4 shrink-0" />Odrzuć</Button>
                <Button className="h-12 min-h-12 w-full whitespace-nowrap rounded-lg px-5 py-2 font-bold shadow-[0_10px_24px_-14px_rgba(255,122,26,0.95)]" disabled={!calculationEditorDirty || calculationEditorSaving} onClick={() => void saveCalculationEditorChanges()}><Check className="mr-2 h-4 w-4 shrink-0" />{calculationEditorSaving ? 'Zapisywanie...' : 'Zapisz zmiany'}</Button>
              </div>
            </div> : null}
          </div>
        </div>
        {quantityReview ? <div role="status" className="text-sm text-warning"><PlanQuantity item={item} /></div> : null}
        {item.scopeMode === 'shifts' || item.scopeMode === 'quantity' ? <div className="max-w-[210px]">
          {item.scopeMode === 'shifts'
            ? <PlanAmountField key={item.id + '-shifts'} label="Liczba zmian do obliczeń" min={0.5} value={item.scopeShifts ?? state.horizonShifts} disabled={editorLocked} onChange={(value) => updateScope({ scopeMode: 'shifts', scopeShifts: value, scopeQuantity: item.scopeQuantity })} />
            : <PlanAmountField key={item.id + '-scope'} label="Sztuki do obliczeń" value={item.scopeQuantity ?? 0} disabled={editorLocked} onChange={(value) => updateScope({ scopeMode: 'quantity', scopeShifts: item.scopeShifts, scopeQuantity: value })} />}
        </div> : null}
      </section>

      {linkedProducts.length ? <section className="space-y-3 border-t border-borderStrong pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link2 className="h-4 w-4 text-brand" />
          <h3 className="text-sm font-black text-title">Źródło powiązanego półwyrobu</h3>
          <Badge tone="info">wybór dla tej pozycji planu</Badge>
        </div>
        {linkedProducts.map((link) => {
          const selection = linkedSourceSelectionForItem(item, link);
          const candidates = linkedProducerCandidates(link, item.id);
          const producer = linkedProducerFor(item, link);
          const machineProducts = linkedMachineProductQuantity(selectedQty, selection);
          const warehouseProducts = linkedWarehouseProductQuantity(selectedQty, selection);
          const machineComponents = roundTechnologyMaterialQuantity(machineProducts * link.usage, link.unit);
          const warehouseComponents = roundTechnologyMaterialQuantity(warehouseProducts * link.usage, link.unit);
          const producerOutput = producer ? itemProductionQty(producer) : 0;
          const producerAllocated = producer ? selectedLinkedAllocationByProducer.get(producer.id) ?? 0 : 0;
          const producerSurplus = linkedSurplusQuantity(producerOutput, producerAllocated);
          const setMode = (mode: LinkedSourceMode) => updateLinkedSourceSelection(item.id, link, {
            mode,
            producerPlanItemId: mode === 'warehouse'
              ? selection.producerPlanItemId
              : selection.producerPlanItemId || (candidates.length === 1 ? candidates[0].id : ''),
            productionQuantity: mode === 'mixed' ? Math.min(selectedQty, selection.productionQuantity) : selection.productionQuantity
          });
          return <div key={link.id} className="space-y-3 border-y border-border bg-[rgba(255,255,255,0.018)] px-3 py-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-black text-title">{link.productIndex}</span>
              <span className="catalog-label min-w-0 break-words text-xs font-bold">{link.productName}</span>
              <span className="text-xs text-muted">{fmt(link.usage)} {link.unit || 'szt.'}/produkt</span>
            </div>
            <div className="grid gap-3 xl:grid-cols-[minmax(330px,0.8fr)_minmax(300px,1fr)_180px] xl:items-end">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase text-dim">Skąd pobieramy półwyrób</p>
                <div role="group" aria-label={`Źródło półwyrobu ${link.productIndex}`} className="grid h-11 grid-cols-3 gap-1 rounded-lg border border-border bg-[rgba(0,0,0,0.28)] p-1">
                  <button type="button" disabled={editorLocked} aria-pressed={selection.mode === 'warehouse'} onClick={() => setMode('warehouse')} className={cn('flex min-w-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-bold transition', selection.mode === 'warehouse' ? 'bg-brandSoft text-title ring-1 ring-brand' : 'text-muted hover:bg-[rgba(255,255,255,0.05)]')}><Warehouse className="h-3.5 w-3.5 shrink-0" />Magazyn</button>
                  <button type="button" disabled={editorLocked} aria-pressed={selection.mode === 'production'} onClick={() => setMode('production')} className={cn('flex min-w-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-bold transition', selection.mode === 'production' ? 'bg-brandSoft text-title ring-1 ring-brand' : 'text-muted hover:bg-[rgba(255,255,255,0.05)]')}><Factory className="h-3.5 w-3.5 shrink-0" />Maszyna</button>
                  <button type="button" disabled={editorLocked} aria-pressed={selection.mode === 'mixed'} onClick={() => setMode('mixed')} className={cn('flex min-w-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-bold transition', selection.mode === 'mixed' ? 'bg-brandSoft text-title ring-1 ring-brand' : 'text-muted hover:bg-[rgba(255,255,255,0.05)]')}><GitMerge className="h-3.5 w-3.5 shrink-0" />Mieszane</button>
                </div>
              </div>
              {selection.mode === 'production' || selection.mode === 'mixed' ? <Field label="Powiązana pozycja produkująca półwyrób">
                <SelectField className="h-11 min-h-11 rounded-lg shadow-none" disabled={editorLocked || !candidates.length} value={producer?.id ?? ''} onChange={(event) => updateLinkedSourceSelection(item.id, link, { producerPlanItemId: event.target.value })}>
                  <option value="">{candidates.length ? 'Wybierz pozycję z planu' : 'Brak półwyrobu w planie'}</option>
                  {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.index} · {candidate.station || 'brak stanowiska'} · {fmt(itemProductionQty(candidate))} szt.</option>)}
                </SelectField>
              </Field> : <div className="hidden xl:block" />}
              {selection.mode === 'mixed' ? <PlanAmountField label="Z maszyny (szt.)" min={0} value={selection.productionQuantity} disabled={editorLocked} onChange={(value) => updateLinkedSourceSelection(item.id, link, { productionQuantity: Math.min(selectedQty, value) })} /> : <div className="hidden xl:block" />}
            </div>
            {selection.mode === 'unselected' ? <p className="text-sm font-semibold text-warning">Wybierz źródło. Bez tego dokument materiałowy nie zostanie utworzony.</p> : <div className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
              <div className="border-l-2 border-borderStrong pl-2"><p className="text-dim">Półwyrób z magazynu</p><p className="mt-1 font-black text-title">{fmt(technologyResultQuantity(warehouseComponents, link.unit))} {technologyResultUnit(link.unit)}</p></div>
              <div className="border-l-2 border-brand pl-2"><p className="text-dim">Bezpośrednio z maszyny</p><p className="mt-1 font-black text-title">{fmt(technologyResultQuantity(machineComponents, link.unit))} {technologyResultUnit(link.unit)}</p></div>
              <div className="border-l-2 border-borderStrong pl-2"><p className="text-dim">Produkcja powiązanej pozycji</p><p className="mt-1 font-black text-title">{producer ? `${fmt(producerOutput)} szt.` : '—'}</p></div>
              <div className="border-l-2 border-warning pl-2"><p className="text-dim">Nadwyżka półwyrobu na magazyn</p><p className="mt-1 font-black text-warning">{producer ? `${fmt(producerSurplus)} szt.` : '—'}</p></div>
            </div>}
          </div>;
        })}
      </section> : null}

      <section className="space-y-3 border-t border-borderStrong pt-3">
      {!technology ? <p className="border-l-2 border-warning bg-[rgba(245,158,11,0.055)] px-3 py-2.5 text-sm font-semibold text-warning">Wybierz technologię, aby wyświetlić materiały.</p> : <>
        {item.manualOverride ? <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone="warning">Technologia robocza zmieniona</Badge>
          <Button className="h-9 min-h-9 rounded-lg px-3 py-1.5 text-xs" variant="ghost" disabled={editorLocked} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, workingMaterials: cloneMaterials(technology.materials), manualOverride: false } : row) }))}><RefreshCw className="mr-2 h-3.5 w-3.5" />Przywróć wybraną</Button>
        </div> : null}
        {materials.length ? <div className="overflow-x-auto rounded-lg border border-borderStrong bg-[rgba(0,0,0,0.16)]">
          <table className="w-full min-w-[1394px] table-fixed text-xs">
            <colgroup><col className="w-[220px]" /><col className="w-[420px]" /><col className="w-[145px]" /><col className="w-[150px]" /><col className="w-[105px]" /><col className="w-[110px]" /><col className="w-[105px]" /><col className="w-[95px]" /><col className="w-[44px]" /></colgroup>
            <thead className="sticky top-0 z-10 bg-[rgba(23,23,27,0.98)] text-left text-[10px] uppercase text-dim">
              <tr>
                <th className="border-r border-border px-2 py-1.5">Kod</th>
                <th className="border-r border-border px-2 py-1.5">Nazwa materiału</th>
                <th className="border-r border-border px-2 py-1.5">Rodzaj</th>
                <th className="border-r border-border px-2 py-1.5 text-right">Przelicznik / szt.</th>
                <th className="border-r border-border px-2 py-1.5 text-right">Cały plan</th>
                <th className="border-r border-border px-2 py-1.5 text-right">Wybrany zakres</th>
                <th className="border-r border-border px-2 py-1.5 text-right">Do wypisania</th>
                <th className="border-r border-border px-2 py-1.5">J.m. wyniku</th>
                <th><span className="sr-only">Akcje</span></th>
              </tr>
            </thead>
            <tbody>{materials.map((material) => {
          const key = materialKey(material);
          const demand = roundTechnologyMaterialQuantity(selectedQty * material.usage, material.unit);
          const fullDemand = roundTechnologyMaterialQuantity(remaining * material.usage, material.unit);
          const supply = materialSupply(key, material, item.areaId);
          const itemShare = supply.demand > 0 ? Math.min(1, demand / supply.demand) : 0;
          const toIssue = roundTechnologyMaterialQuantity(supply.toIssue * itemShare, material.unit);
          return <tr key={material.id} className="border-t border-border transition hover:bg-[rgba(255,255,255,0.025)]">
            <td className="border-r border-border p-0"><Input className={cn(compactPlanMaterialInputClass, 'font-semibold text-title')} disabled={editorLocked} list="material-code-suggestions" value={material.code} aria-label="Kod materiału" onCatalogSelect={(catalogItem) => updateWorkingMaterial(item.id, material.id, catalogMaterialPatch(material, catalogItem))} onChange={(event) => updateWorkingMaterial(item.id, material.id, { code: event.target.value })} /></td>
            <td className="border-r border-border p-0"><Input className={cn(compactPlanMaterialInputClass, 'font-semibold')} disabled={editorLocked} list="material-name-suggestions" title={material.name} value={material.name} aria-label="Nazwa materiału" onCatalogSelect={(catalogItem) => updateWorkingMaterial(item.id, material.id, catalogMaterialPatch(material, catalogItem))} onChange={(event) => updateWorkingMaterial(item.id, material.id, { name: event.target.value })} /></td>
            <td className="border-r border-border p-0"><SelectField className="h-9 min-h-9 rounded-none border-0 bg-[none] px-2 py-1 text-xs shadow-none ring-0 focus:ring-1" disabled={editorLocked} value={material.category} onChange={(event) => updateWorkingMaterial(item.id, material.id, { category: event.target.value as MaterialCategory })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</SelectField></td>
            <td className="border-r border-border p-0"><div className="flex h-9 items-center"><Input aria-label={`Przelicznik na sztukę (${technologyUsageInputUnit(material)})`} className={cn(compactPlanMaterialInputClass, 'text-right tabular-nums')} disabled={editorLocked} type="number" step="0.001" value={technologyUsageForEditor(material)} onChange={(event) => updateWorkingMaterial(item.id, material.id, { usage: technologyUsageFromEditor(material, Math.max(0, numberValue(event.target.value))) })} /><span className="pr-2 text-[10px] font-bold text-muted">{technologyUsageInputUnit(material)}</span></div></td>
            <td className="h-9 border-r border-border px-2 text-right font-semibold tabular-nums text-body">{quantityReview ? '—' : fmt(technologyResultQuantity(fullDemand, material.unit))}</td>
            <td className="h-9 border-r border-border px-2 text-right font-bold tabular-nums text-title">{quantityReview ? '—' : fmt(technologyResultQuantity(demand, material.unit))}</td>
            <td className="h-9 border-r border-border px-2 text-right font-black tabular-nums text-warning">{quantityReview ? '—' : fmt(technologyResultQuantity(toIssue, material.unit))}</td>
            <td className="border-r border-border p-0"><Input className={cn(compactPlanMaterialInputClass, 'font-semibold')} aria-label="Jednostka wyniku" disabled={editorLocked} value={technologyResultUnit(material.unit)} onChange={(event) => updateWorkingMaterial(item.id, material.id, technologyMaterialWithUnit(material, event.target.value))} /></td>
            <td className="p-0 text-center"><Button title="Usuń materiał z technologii roboczej" aria-label="Usuń materiał z technologii roboczej" variant="ghost" className="h-9 min-h-9 w-9 rounded-none border-0 px-0 py-0 text-danger ring-0" disabled={editorLocked} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: materials.filter((entry) => entry.id !== material.id) } : row) }))}><Trash2 className="h-3.5 w-3.5" /></Button></td>
          </tr>;
        })}</tbody>
          </table>
        </div> : <p className="text-sm text-muted">Technologia nie ma jeszcze materiałów.</p>}
        {(technology.surplusMaterials ?? []).length ? <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs font-black uppercase text-title">Pakowanie nadwyżki na magazyn</p>
            <span className="text-xs text-muted">Produkcja: {fmt(selectedQty)} szt.</span>
            <span className="text-xs text-muted">Do powiązanych produktów: {fmt(selectedAllocatedOutput)} szt.</span>
            <Badge tone="warning">Nadwyżka: {fmt(selectedSurplusQuantity)} szt.</Badge>
          </div>
          <div className="overflow-x-auto rounded-lg border border-borderStrong bg-[rgba(0,0,0,0.16)]">
            <table className="w-full min-w-[920px] table-fixed text-xs">
              <colgroup><col className="w-[210px]" /><col className="w-[390px]" /><col className="w-[130px]" /><col className="w-[120px]" /><col className="w-[120px]" /></colgroup>
              <thead className="bg-[rgba(23,23,27,0.98)] text-left text-[10px] uppercase text-dim"><tr><th className="border-r border-border px-2 py-1.5">Kod</th><th className="border-r border-border px-2 py-1.5">Materiał nadwyżki</th><th className="border-r border-border px-2 py-1.5 text-right">Przelicznik / szt.</th><th className="border-r border-border px-2 py-1.5 text-right">Cały plan</th><th className="px-2 py-1.5 text-right">Wybrany zakres</th></tr></thead>
              <tbody>{(technology.surplusMaterials ?? []).map((material) => {
                const demand = roundTechnologyMaterialQuantity(selectedSurplusQuantity * material.usage, material.unit);
                const fullDemand = roundTechnologyMaterialQuantity(fullSurplusQuantity * material.usage, material.unit);
                return <tr key={material.id} className="border-t border-border"><td className="border-r border-border px-2 py-2 font-semibold text-title">{material.code}</td><td className="catalog-label border-r border-border px-2 py-2 font-semibold">{material.name}</td><td className="border-r border-border px-2 py-2 text-right tabular-nums">{fmt(technologyUsageForEditor(material))} {technologyUsageInputUnit(material)}</td><td className="border-r border-border px-2 py-2 text-right tabular-nums">{quantityReview ? '—' : `${fmt(technologyResultQuantity(fullDemand, material.unit))} ${technologyResultUnit(material.unit)}`}</td><td className="px-2 py-2 text-right font-black tabular-nums text-warning">{quantityReview ? '—' : `${fmt(technologyResultQuantity(demand, material.unit))} ${technologyResultUnit(material.unit)}`}</td></tr>;
              })}</tbody>
            </table>
          </div>
        </div> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className="h-10 min-h-10 w-full rounded-lg px-3 py-2 sm:w-[190px]" variant="outline" disabled={editorLocked} onClick={() => updateState((current) => ({ ...current, plan: current.plan.map((row) => row.id === item.id ? { ...row, manualOverride: true, workingMaterials: [...materials, { id: uid('mat'), code: '', name: '', category: 'Pozostałe', usage: 0, unit: 'kg', logisticQty: 1 }] } : row) }))}><Plus className="mr-2 h-4 w-4" />Dodaj materiał</Button>
          <Button className="h-10 min-h-10 w-full rounded-lg px-3 py-2 sm:w-[190px]" variant="secondary" disabled={editorLocked} onClick={() => saveWorkingAsBaseTechnology(item)}><Star className="mr-2 h-4 w-4" />Ustaw jako bazową</Button>
          <Button className="h-10 min-h-10 w-full rounded-lg px-3 py-2 sm:w-[220px]" variant="outline" disabled={editorLocked} onClick={() => openAlternativeDraft(item.id)}><FilePlus2 className="mr-2 h-4 w-4" />Zapisz jako awaryjną</Button>
        </div>
        {alternativeDraftItemId === item.id ? <form className="grid gap-2 border-l-2 border-brand bg-[rgba(255,122,26,0.045)] px-3 py-3 sm:grid-cols-[minmax(260px,1fr)_120px_180px] sm:items-end" onSubmit={(event) => { event.preventDefault(); saveWorkingAsAlternativeTechnology(item); }}>
          <Field label={`Opis wariantu · Awaryjna ${nextAlternativeNo}`}>
            <Input autoFocus aria-label="Opis nowego wariantu awaryjnego" placeholder="np. Karton zastępczy 600x410x400" value={alternativeDraftDescription} onChange={(event) => setAlternativeDraftDescription(event.target.value)} />
          </Field>
          <Button type="button" className="h-11 min-h-11 w-full whitespace-nowrap rounded-lg px-3 py-2" variant="ghost" onClick={closeAlternativeDraft}><X className="mr-2 h-4 w-4" />Anuluj</Button>
          <Button type="submit" className="h-11 min-h-11 w-full whitespace-nowrap rounded-lg px-4 py-2" disabled={!alternativeDraftDescription.trim()}><Check className="mr-2 h-4 w-4" />Utwórz wariant</Button>
        </form> : null}
      </>}
      </section>
    </div>;
  };

  const renderCalculation = () => {
    const scopeItems = state.plan.filter((item) => item.included && (item.areaId === state.selectedAreaId || !item.areaId));
    return (
      <div className="space-y-5">
        {renderHeader('Obliczanie zapotrzebowania', 'Rozwiń wybraną pozycję, aby zasymulować zakres i zmienić jej technologię roboczą.')}
        <PlanQuantityWarnings items={scopeItems} resolvedItemIds={quantityResolvedPlanItemIds} calculations />
        <Card className="grid gap-3 md:grid-cols-2">
          <Field label="Strefa">
            <SelectField value={state.selectedAreaId} onChange={(event) => selectPlanningArea(event.target.value)}>
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
                        <td className="p-3">
                          {item.productionGroupId ? <p className="mb-1 text-[11px] font-black uppercase text-brand">Wspólna forma · detal {(item.productionOutputOrder ?? 0) + 1}/{item.productionOutputCount}</p> : null}
                          <p className="font-bold text-title">{item.index}</p><p className="catalog-label font-semibold">{item.name}</p>
                        </td>
                        <td className="p-3"><p>{item.station || 'Nie podano'}</p><p className="mt-1 text-xs text-muted">{item.areaId ? areaName(item.areaId) : 'Brak przypisu - sprawdź ustawienia'}</p></td>
                        <td className="min-w-[260px] p-3">
                          {variants.length ? (
                            <SelectField value={item.technologyId} onChange={(event) => selectTechnology(item.id, event.target.value)}>
                              <option value="">Wybierz technologię</option>
                              {variants.map((technology) => <option key={technology.id} value={technology.id}>{technologySelectLabel(technology)}</option>)}
                            </SelectField>
                          ) : <Button variant="outline" onClick={() => addTechnology(item.index, item.name, item.shiftNorm)}>Dodaj technologię</Button>}
                        </td>
                        <td className="min-w-48 p-3 text-right"><PlanQuantity item={item} productionMode={technologyForItem(item)?.productionMode} calculatedQuantity={itemProductionQty(item)} shiftNorm={shiftNormForItem(item)} /></td>
                        <td className="p-3 text-right font-black text-title">{planQuantityNeedsReview(item) ? 'Do wyjaśnienia' : item.included && item.technologyId ? fmt(itemProductionQty(item)) : '—'}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1.5">
                            {planQuantityNeedsReview(item) ? <Badge tone="warning">Wyjaśnij ilość</Badge> : !item.areaId ? <Badge tone="warning">Brak strefy</Badge> : !item.technologyId ? <Badge tone="danger">Wybierz technologię</Badge> : !item.included ? <Badge>Nie licz</Badge> : technologyForItem(item)?.productionMode === 'continuous' ? <Badge tone="info">Produkcja ciągła</Badge> : technologyForItem(item)?.productionMode === 'linked' ? <Badge tone="info">Pod powiązanie</Badge> : item.manualOverride ? <Badge tone="warning">Ręczna korekta</Badge> : <Badge tone="success">Gotowa</Badge>}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            aria-label={expanded ? `Zwiń szczegóły ${item.index}` : `Rozwiń szczegóły ${item.index}`}
                            aria-expanded={expanded}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-[rgba(255,255,255,0.035)] text-muted transition hover:border-brand hover:text-title"
                            onClick={() => toggleCalculationEditor(item.id, 'calculation')}
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
          <Stat label="Detale w zakresie" value={`${fmt(scopeItems.filter((item) => item.areaId === state.selectedAreaId && item.technologyId).reduce((sum, item) => sum + itemProductionQty(item), 0))} szt.`} />
          <Stat label="Pozycje materiałowe" value={String(requirements.length)} />
          <Stat label="Do pobrania" value={String(documentRows.length)} tone={documentRows.length ? 'warning' : 'success'} />
        </div>
        {requirements.some((row) => row.globalSharedShortage > 0) ? (
          <Card className="border-[color:color-mix(in_srgb,var(--warning)_52%,transparent)]">
            <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" /><div><p className="font-bold text-title">Wspólne silosy mogą nie wystarczyć dla wszystkich obszarów</p><p className="mt-1 text-sm text-muted">Bilans wspólnego źródła uwzględnia jednocześnie zapotrzebowanie wszystkich hal, a nie tylko aktualnie wybranej strefy.</p></div></div>
          </Card>
        ) : null}
        <div className="flex justify-end"><Button onClick={createPickingDocumentFromPlan}><PackageCheck className="mr-2 h-4 w-4" />{editablePickingDocumentExists ? 'Przelicz i pokaż dokument' : 'Utwórz dokument do wypisania'}</Button></div>
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

  const createOrRefreshPickingDocument = (): boolean => {
    const linkedSourceIssue = linkedSourceIssuesForArea(state.selectedAreaId)[0];
    if (linkedSourceIssue) {
      flash(`Nie można utworzyć dokumentu: ${linkedSourceIssue}`);
      return false;
    }
    if (state.plan.some((item) => item.included && item.areaId === state.selectedAreaId && !item.technologyId)) {
      flash('Nie można utworzyć kompletnego dokumentu: uzupełnij technologie zaznaczonych pozycji w wybranej strefie.');
      return false;
    }
    if (state.plan.some((item) => item.included && planQuantityNeedsReview(item) && (item.areaId === state.selectedAreaId || !item.areaId))) {
      flash('Nie można utworzyć kompletnego dokumentu: wyjaśnij ilości oznaczone ostrzeżeniem albo wyłącz te pozycje z obliczeń.');
      return false;
    }
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
      return false;
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
      const activeVersion = latestPlanVersion(current.planVersions, current.selectedPlanDate);
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
    return true;
  };

  function createPickingDocumentFromPlan() {
    if (!closeCalculationEditorIfAllowed()) return;
    if (createOrRefreshPickingDocument()) openView('dokument');
  }

  const changePickingDocumentStatus = (documentId: string, nextStatus: PickingDocumentStatus) => {
    if (readOnly) return;
    const document = state.documents.find((item) => item.id === documentId);
    if (!document) return;
    if (nextStatus === 'handed' && state.plan.some((item) => item.included && planQuantityNeedsReview(item) && (item.areaId === document.areaId || !item.areaId))) {
      return flash('Przed przekazaniem dokumentu wyjaśnij ilości albo wyłącz wskazane pozycje z obliczeń.');
    }
    if (nextStatus === 'handed' && document.rows.some((row) => !row.confirmed)) {
      return flash('Najpierw zaznacz po lewej wszystkie pozycje jako wypisane do dokumentu.');
    }
    if (nextStatus === 'draft' && (document.status === 'handed' || document.status === 'issued')) {
      const latestActive = state.documents.find((item) =>
        item.planDate === document.planDate &&
        item.areaId === document.areaId &&
        item.status !== 'cancelled' &&
        item.status !== 'outdated'
      );
      if (latestActive?.id !== document.id) {
        return flash('Najpierw zakończ lub anuluj nowszy dokument dla tej strefy.');
      }
    }
    const allowed =
      (nextStatus === 'handed' && document.status === 'draft') ||
      (nextStatus === 'issued' && document.status === 'handed') ||
      (nextStatus === 'draft' && (document.status === 'handed' || document.status === 'issued')) ||
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
    flash(nextStatus === 'draft' ? 'Dokument został cofnięty do edycji.' : `Dokument ma teraz status: ${documentStatusLabel[nextStatus]}.`);
  };

  const togglePickingConfirmation = (documentId: string, rowKey: string) => {
    if (readOnly) return;
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
      String(technologyResultQuantity(row.demand, row.unit)),
      String(technologyResultQuantity(row.areaStock, row.unit)),
      String(technologyResultQuantity(row.issuedBefore, row.unit)),
      String(technologyResultQuantity(row.pendingBefore, row.unit)),
      String(technologyResultQuantity(row.toIssue, row.unit)),
      technologyResultUnit(row.unit),
      row.sources.map((source) => `${source.index} - ${source.name}: ${fmt(technologyResultQuantity(source.demand, row.unit))}`).join(' | ')
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
    if (!datePlan.length) return [];

    const plannedMaterials = datePlan
      .filter((item) => item.included)
      .flatMap((item) => materialsForItem(item))
      .filter((material) => Boolean(normalize(material.code) || normalize(material.name)));
    if (!plannedMaterials.length) return [];

    const inventoriedByMaterial = new Map<string, InventoryItem>();
    state.inventory.forEach((inventoryItem) => {
      if (inventoryItem.qty <= 0.000001) return;
      if (state.areas.find((area) => area.id === inventoryItem.areaId)?.shared) return;
      const key = `${inventoryItem.areaId}|${materialKey(inventoryItem)}`;
      const current = inventoriedByMaterial.get(key);
      if (current) current.qty += inventoryItem.qty;
      else inventoriedByMaterial.set(key, { ...inventoryItem });
    });

    return [...inventoriedByMaterial.entries()]
      .filter(([, inventoryItem]) => !plannedMaterials.some((material) => materialIdentityMatches(material, inventoryItem)))
      .map(([inventoryKey, inventoryItem]) => {
        const id = `${planDate}|${inventoryKey}`;
        return {
          id,
          planDate,
          materialKey: materialKey(inventoryItem),
          code: inventoryItem.code,
          name: inventoryItem.name,
          category: inventoryItem.category ?? 'Pozostałe',
          unit: inventoryItem.unit,
          areaId: inventoryItem.areaId,
          reason: 'Brak w technologiach aktualnego planu',
          inventoried: inventoryItem.qty,
          surplus: inventoryItem.qty,
          destination: 'Zwrot do magazynu',
          status: state.returnStatuses[id] ?? 'open'
        } satisfies MaterialReturnRow;
      });
  };

  const renderDocumentV2 = () => {
    const documents = state.documents
      .filter((document) => document.planDate === state.selectedPlanDate && document.areaId === state.selectedAreaId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt, 'pl'));
    return <div className="space-y-5">
      {renderHeader('Dokument do wypisania', 'Każda strefa otrzymuje osobny, zapisany dokument. Po przekazaniu lub wydaniu jego ilości pozostają niezmienne.')}
      <PlanQuantityWarnings items={state.plan.filter((item) => item.included && (item.areaId === state.selectedAreaId || !item.areaId))} resolvedItemIds={quantityResolvedPlanItemIds} calculations />
      <Card className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,0.6fr)_minmax(260px,1fr)_auto] lg:items-end">
          <Field label="Data planu"><Input type="date" value={state.selectedPlanDate} onChange={(event) => selectPlanDate(event.target.value)} /></Field>
          <Field label="Strefa"><SelectField value={state.selectedAreaId} onChange={(event) => selectPlanningArea(event.target.value)}>{state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</SelectField></Field>
          {!readOnly ? <Button onClick={createOrRefreshPickingDocument}><FilePlus2 className="mr-2 h-4 w-4" />{documents.some((document) => document.status === 'draft' || document.status === 'outdated') ? 'Przelicz dokument roboczy' : 'Utwórz dokument'}</Button> : null}
        </div>
      </Card>

      {documents.length ? documents.map((document) => {
        const expanded = expandedDocument === document.id;
        const locked = document.status === 'handed' || document.status === 'issued';
        const confirmedRows = document.rows.filter((row) => row.confirmed).length;
        const allRowsConfirmed = document.rows.length > 0 && confirmedRows === document.rows.length;
        return <Card key={document.id} className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <button type="button" className="flex min-w-0 items-center gap-3 text-left" onClick={() => setExpandedDocument(expanded ? '' : document.id)}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-muted">{expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</span>
              <span className="min-w-0"><span className="block break-words font-black text-title">{document.documentNo}</span><span className="mt-1 block text-xs text-muted">{formatPlanDate(document.planDate)} · wersja {document.planVersionNo || '—'} · {document.scopeLabel} · {document.createdBy} · {document.createdAt}</span></span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={document.kind === 'correction' ? 'warning' : 'info'}>{document.kind === 'correction' ? 'Korekta' : 'Podstawowy'}</Badge>
              <Badge tone={documentTone(document.status)}>{documentStatusLabel[document.status]}</Badge>
              <Badge tone={allRowsConfirmed ? 'success' : 'warning'}>{allRowsConfirmed ? `Wszystko wypisane · ${confirmedRows}/${document.rows.length}` : `Wypisano ${confirmedRows}/${document.rows.length}`}</Badge>
              {!readOnly && (document.status === 'draft' || document.status === 'outdated') ? <Button variant="outline" onClick={createOrRefreshPickingDocument}><RefreshCw className="mr-2 h-4 w-4" />Przelicz</Button> : null}
              {!readOnly && document.status === 'draft' ? <Button variant="secondary" onClick={() => changePickingDocumentStatus(document.id, 'handed')}><PackageCheck className="mr-2 h-4 w-4" />Przekaż</Button> : null}
              {!readOnly && document.status === 'handed' ? <Button variant="secondary" onClick={() => changePickingDocumentStatus(document.id, 'issued')}><Check className="mr-2 h-4 w-4" />Oznacz jako wydany</Button> : null}
              {!readOnly && locked ? <Button variant="outline" onClick={() => changePickingDocumentStatus(document.id, 'draft')}><Undo2 className="mr-2 h-4 w-4" />Cofnij do edycji</Button> : null}
              {!readOnly && ['draft', 'outdated', 'handed'].includes(document.status) ? <Button variant="ghost" className="text-danger" onClick={() => changePickingDocumentStatus(document.id, 'cancelled')}><X className="mr-2 h-4 w-4" />Anuluj</Button> : null}
              <Button title="Pobierz dokument CSV" variant="ghost" className="min-h-11 px-3" onClick={() => exportPickingDocument(document)}><FileDown className="h-4 w-4" /></Button>
            </div>
          </div>
          {expanded ? <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="sticky top-0 z-10 bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim"><tr><th className="w-24 p-3 text-center">Wypisane</th><th className="w-14 p-3"><span className="sr-only">Źródła</span></th><th className="p-3">Materiał</th><th className="p-3 text-right">Zapotrzebowanie</th><th className="p-3 text-right">Stan strefy</th><th className="p-3 text-right">Wydać teraz</th><th className="p-3">J.m.</th></tr></thead>
              <tbody>{document.rows.map((row) => {
                const sourceKey = `${document.id}|${row.key}`;
                const sourcesExpanded = expandedMaterial === sourceKey;
                return <Fragment key={row.key}><tr className="border-t border-border"><td className="p-3"><button type="button" aria-label={row.confirmed ? `Odznacz jako wypisane: ${row.name}` : `Zaznacz jako wypisane: ${row.name}`} aria-pressed={row.confirmed} title={row.confirmed ? 'Pozycja wypisana — kliknij, aby cofnąć' : 'Zaznacz pozycję jako wypisaną'} disabled={readOnly || locked || document.status !== 'draft'} onClick={() => togglePickingConfirmation(document.id, row.key)} className={cn('mx-auto flex h-11 w-11 items-center justify-center rounded-lg border', row.confirmed ? 'border-success bg-[color:color-mix(in_srgb,var(--success)_14%,transparent)] text-success' : 'border-border text-muted', (readOnly || locked || document.status !== 'draft') && 'cursor-default opacity-80')}>{row.confirmed ? <Check className="h-4 w-4" /> : null}</button></td><td className="p-3"><button type="button" title={sourcesExpanded ? 'Ukryj źródła zapotrzebowania' : 'Pokaż indeksy źródłowe'} className="flex h-11 w-11 items-center justify-center rounded-lg border border-border text-muted" onClick={() => setExpandedMaterial(sourcesExpanded ? '' : sourceKey)}>{sourcesExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button></td><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="catalog-label break-words font-semibold">{row.name}</p></td><td className="p-3 text-right">{fmt(technologyResultQuantity(row.demand, row.unit))}</td><td className="p-3 text-right">{fmt(technologyResultQuantity(row.areaStock, row.unit))}</td><td className="p-3 text-right text-lg font-black text-title">{fmt(technologyResultQuantity(row.toIssue, row.unit))}</td><td className="p-3">{technologyResultUnit(row.unit)}</td></tr>{sourcesExpanded ? <tr className="border-t border-border bg-[rgba(255,255,255,0.025)]"><td colSpan={7} className="px-5 py-4"><p className="text-xs font-bold uppercase text-dim">Źródła zapotrzebowania</p><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{row.sources.map((source) => <div key={`${source.planItemId}-${source.index}`} className="border-l-2 border-brand pl-3"><p className="font-bold text-title">{source.index}</p><p className="catalog-label break-words text-sm font-semibold">{source.name}</p><p className="mt-1 text-xs text-dim">{fmt(technologyResultQuantity(source.demand, row.unit))} {technologyResultUnit(row.unit)}</p></div>)}</div></td></tr> : null}</Fragment>;
              })}</tbody>
            </table>
          </div> : null}
        </Card>;
      }) : <EmptyState title="Brak zapisanych dokumentów" description="Wybierz strefę i utwórz dokument z aktualnego planu. Jeżeli materiały są już pokryte, dokument nie będzie potrzebny." />}
    </div>;
  };

  const renderReturnsV2 = () => {
    const allReturnRows = deriveReturnsForDate(state.selectedPlanDate);
    const returnAreas = state.areas.filter((area) => !area.shared);
    const activeReturnAreaFilter = returnAreaFilter === 'all' || returnAreas.some((area) => area.id === returnAreaFilter)
      ? returnAreaFilter
      : 'all';
    const returnRows = activeReturnAreaFilter === 'all'
      ? allReturnRows
      : allReturnRows.filter((row) => row.areaId === activeReturnAreaFilter);
    const openRows = returnRows.filter((row) => row.status === 'open');
    const activeTechnologyMaterialCount = state.plan
      .filter((item) => item.included)
      .flatMap((item) => materialsForItem(item))
      .filter((material) => Boolean(normalize(material.code) || normalize(material.name)))
      .length;
    const inventoriedAreaRows = state.inventory.filter((item) => (
      item.qty > 0.000001
      && !state.areas.find((area) => area.id === item.areaId)?.shared
      && (activeReturnAreaFilter === 'all' || item.areaId === activeReturnAreaFilter)
    ));
    const returnsEmptyState = !state.inventory.length
      ? <EmptyState title="Brak danych ze Spisu rzeczywistego" description="Po wykonaniu spisu wróć do tej zakładki i odśwież dane." />
      : !state.plan.length
        ? <EmptyState title="Brak wgranego planu" description="Zwroty można wyznaczyć dopiero po wgraniu planu produkcyjnego." />
        : !activeTechnologyMaterialCount
          ? <EmptyState title="Brak przypisanych technologii" description="Najpierw przypisz technologie do pozycji uwzględnionych w planie." />
          : activeReturnAreaFilter !== 'all' && allReturnRows.length && !returnRows.length
            ? <EmptyState title={`Brak zwrotów w strefie: ${areaName(activeReturnAreaFilter)}`} description="Wybierz inną strefę albo pokaż wszystkie strefy." />
          : <EmptyState title="Brak materiałów do zwrotu" description="Każdy materiał ze Spisu rzeczywistego występuje w co najmniej jednej technologii aktualnego planu." />;
    return <div className="space-y-5">
      {renderHeader('Zwroty', 'Materiały ze Spisu rzeczywistego, których nie ma w żadnej technologii aktualnego planu.')}
      <PlanQuantityWarnings items={state.plan.filter((item) => item.included)} resolvedItemIds={quantityResolvedPlanItemIds} calculations />
      <Card className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(200px,300px)_minmax(220px,320px)_1fr_auto] xl:items-end">
          <Field label="Data planu"><Input type="date" value={state.selectedPlanDate} onChange={(event) => selectPlanDate(event.target.value)} /></Field>
          <Field label="Strefa"><SelectField aria-label="Strefa zwrotów" value={activeReturnAreaFilter} onChange={(event) => setReturnAreaFilter(event.target.value)}><option value="all">Wszystkie strefy</option>{returnAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</SelectField></Field>
          <p className="text-sm text-muted">Spis z dnia: <span className="font-bold text-title">{state.inventorySourceDate ? formatPlanDate(state.inventorySourceDate) : 'brak danych'}</span>{state.inventorySyncedAt ? ` · pobrano ${state.inventorySyncedAt}` : ''}</p>
          <Button variant="outline" onClick={() => void syncOriginalInventory()}><RefreshCw className="mr-2 h-4 w-4" />Odśwież spis</Button>
        </div>
        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <Stat label="Do zwrotu" value={String(openRows.length)} tone={openRows.length ? 'warning' : 'success'} />
          <Stat label="Pozycje spisane" value={String(inventoriedAreaRows.length)} />
          <Stat label="Data planu" value={formatPlanDate(state.selectedPlanDate)} />
        </div>
      </Card>
      {returnRows.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="sticky top-0 z-10 bg-[rgba(18,18,22,0.98)] text-left text-[11px] uppercase text-dim"><tr><th className="p-3">Materiał</th><th className="p-3">Strefa</th><th className="p-3 text-right">Do zwrotu</th><th className="p-3">Status</th></tr></thead><tbody>{returnRows.map((row) => <tr key={row.id} className={cn('border-t border-border', row.status === 'completed' && 'bg-[color:color-mix(in_srgb,var(--success)_7%,transparent)]')}><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="catalog-label break-words font-semibold">{row.name}</p></td><td className="p-3">{areaName(row.areaId)}</td><td className="p-3 text-right text-lg font-black text-warning">{fmt(row.surplus)} {row.unit}</td><td className="p-3"><Button variant={row.status === 'completed' ? 'ghost' : 'secondary'} onClick={() => updateState((current) => ({ ...current, returnStatuses: { ...current.returnStatuses, [row.id]: row.status === 'completed' ? 'open' : 'completed' } }))}>{row.status === 'completed' ? <Undo2 className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}{row.status === 'completed' ? 'Przywróć' : 'Wykonano'}</Button></td></tr>)}</tbody></table></div></Card> : returnsEmptyState}
    </div>;
  };

  const renderHistoryV2 = () => {
    const versions = [...state.planVersions].sort((left, right) => right.planDate.localeCompare(left.planDate) || right.versionNo - left.versionNo);
    const corrections = [...state.quantityCorrections].sort((left, right) => right.createdAt.localeCompare(left.createdAt, 'pl'));
    const documents = [...state.documents].sort((left, right) => right.planDate.localeCompare(left.planDate) || right.createdAt.localeCompare(left.createdAt, 'pl'));
    const returnRows = deriveReturnsForDate(state.selectedPlanDate);
    return <div className="space-y-5">
      {renderHeader('Historia', 'Wersje planów, korekty i dokumenty pozostają zapisane. Zwroty pokazują bieżące porównanie planu ze Spisem rzeczywistym.')}

      <section className="space-y-3">
        <SectionTitle title="Wersje planów" subtitle={`${versions.length} zapisanych wersji`} />
        {versions.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr>
              <th className="p-3">Data / wersja</th><th className="p-3">Wgrano</th><th className="p-3">Plik / arkusz</th>
            </tr></thead>
            <tbody>{versions.map((version, index) => {
              const isLatest = index === 0 || versions[index - 1].planDate !== version.planDate;
              return <tr key={version.id} className="border-t border-border align-top">
                <td className="p-3">
                  <p className="font-black text-title">{formatPlanDate(version.planDate)}</p>
                  <p className="text-muted">Wersja {version.versionNo}</p>
                  <p className="mt-2"><Badge tone={isLatest ? 'success' : 'default'}>{isLatest ? 'Aktualna wersja' : 'Poprzednia wersja'}</Badge></p>
                </td>
                <td className="p-3"><p>{version.importedAt}</p><p className="text-xs text-muted">{version.importedBy}</p></td>
                <td className="p-3"><p className="break-words font-semibold text-title">{version.fileName}</p><p className="text-xs text-muted">{version.sheetName}</p></td>
              </tr>;
            })}</tbody>
          </table>
        </div></Card> : <EmptyState title="Brak wersji planów" description="Pierwszy import utworzy wersję 1 dla wybranej daty." />}
      </section>

      <section className="space-y-3"><SectionTitle title="Ręczne korekty ilości" subtitle={`${corrections.length} operacji`} />{corrections.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Data planu</th><th className="p-3">Pozycja</th><th className="p-3 text-right">Poprzednio</th><th className="p-3 text-right">Nowa ilość</th><th className="p-3 text-right">Różnica</th><th className="p-3">Użytkownik / czas</th><th className="p-3">Status</th></tr></thead><tbody>{corrections.map((correction) => <tr key={correction.id} className="border-t border-border"><td className="p-3">{formatPlanDate(correction.planDate)}</td><td className="p-3"><p className="font-bold text-title">{correction.index}</p><p className="catalog-label text-xs font-semibold">{correction.name}</p></td><td className="p-3 text-right">{fmt(correction.previousValue)}</td><td className="p-3 text-right">{fmt(correction.newValue)}</td><td className={cn('p-3 text-right font-black', correction.difference > 0 ? 'text-success' : 'text-warning')}>{correction.difference > 0 ? '+' : ''}{fmt(correction.difference)}</td><td className="p-3"><p>{correction.createdBy}</p><p className="text-xs text-muted">{correction.createdAt}</p></td><td className="p-3"><Badge tone={correction.revertedAt ? 'default' : 'info'}>{correction.revertedAt ? 'Cofnięta' : correction.source}</Badge></td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak ręcznych korekt" description="Zmiana dokładna, + lub - przy pozycji planu pojawi się tutaj." />}</section>

      <section className="space-y-3"><SectionTitle title="Dokumenty i wydania" subtitle={`${documents.length} dokumentów`} />{documents.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Dokument</th><th className="p-3">Data / strefa</th><th className="p-3">Wersja i zakres</th><th className="p-3">Utworzył</th><th className="p-3">Typ</th><th className="p-3">Status</th><th className="p-3 text-right">Pozycje</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id} className="border-t border-border"><td className="p-3 font-black text-title">{document.documentNo}</td><td className="p-3"><p>{formatPlanDate(document.planDate)}</p><p className="text-xs text-muted">{areaName(document.areaId)}</p></td><td className="p-3"><p>Wersja {document.planVersionNo || '—'}</p><p className="text-xs text-muted">{document.scopeLabel}</p></td><td className="p-3"><p>{document.createdBy}</p><p className="text-xs text-muted">{document.createdAt}</p></td><td className="p-3"><Badge tone={document.kind === 'correction' ? 'warning' : 'info'}>{document.kind === 'correction' ? 'Korekta' : 'Podstawowy'}</Badge></td><td className="p-3"><Badge tone={documentTone(document.status)}>{documentStatusLabel[document.status]}</Badge></td><td className="p-3 text-right">{document.rows.length}</td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak dokumentów" description="Dokumenty podstawowe i korekty pojawią się po ich utworzeniu." />}</section>

      <section className="space-y-3"><SectionTitle title="Zwroty" subtitle={`${returnRows.length} wykrytych pozycji dla aktualnego spisu`} />{returnRows.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-[rgba(255,255,255,0.035)] text-left text-xs uppercase text-dim"><tr><th className="p-3">Data planu</th><th className="p-3">Materiał</th><th className="p-3">Strefa</th><th className="p-3">Przyczyna</th><th className="p-3 text-right">Do zwrotu</th><th className="p-3">Status</th></tr></thead><tbody>{returnRows.map((row) => <tr key={row.id} className="border-t border-border"><td className="p-3">{formatPlanDate(row.planDate)}</td><td className="p-3"><p className="font-bold text-title">{row.code || '—'}</p><p className="catalog-label text-xs font-semibold">{row.name}</p></td><td className="p-3">{areaName(row.areaId)}</td><td className="p-3">{row.reason}</td><td className="p-3 text-right font-black text-warning">{fmt(row.surplus)} {row.unit}</td><td className="p-3"><Badge tone={row.status === 'completed' ? 'success' : 'warning'}>{row.status === 'completed' ? 'Wykonany' : 'Otwarty'}</Badge></td></tr>)}</tbody></table></div></Card> : <EmptyState title="Brak zwrotów" description="Materiały do zwrotu są wyznaczane z aktualnego Spisu rzeczywistego i technologii planu." />}</section>

      {state.archive.length ? <section className="space-y-3"><SectionTitle title="Wstrzymane i zakończone produkcje" subtitle={`${state.archive.length} pozycji`} /><div className="divide-y divide-border border-y border-border">{state.archive.map((entry) => <div key={entry.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between"><div><div className="flex flex-wrap gap-2"><Badge tone={entry.status === 'suspended' ? 'warning' : 'success'}>{entry.status === 'suspended' ? 'Wstrzymana' : 'Zakończona'}</Badge>{entry.planItem.manualOverride ? <Badge tone="info">Technologia robocza</Badge> : null}</div><p className="mt-2 font-bold"><span className="text-title">{entry.planItem.index}</span><span className="catalog-label"> · {entry.planItem.name}</span></p><p className="mt-1 text-sm text-muted">{entry.planItem.station || 'Brak stanowiska'} · {entry.technologyName} · {entry.at}</p><p className="mt-1 text-xs text-dim">{entry.reason}</p></div>{entry.status === 'suspended' && !readOnly ? <Button variant="ghost" onClick={() => updateState((current) => ({ ...current, archive: current.archive.map((row) => row.id === entry.id ? { ...row, status: 'completed', reason: 'Produkcja zakończona ręcznie', at: nowLabel() } : row) }))}><Archive className="mr-2 h-4 w-4" />Zakończ produkcję</Button> : null}</div>)}</div></section> : null}
    </div>;
  };

  const renderSettings = () => <div className="space-y-5">{renderHeader('Ustawienia modułu', 'Przypisz stanowiska do obszarów. Import planu będzie uzupełniał halę automatycznie na podstawie tej listy.')}<Card className="space-y-4"><div className="flex items-center justify-between"><SectionTitle title="Stanowiska i obszary" subtitle="Domyślnie WTR 1–28 należą do Hali 1, a WTR 29–52 do Hali 2." /><Button variant="outline" onClick={() => updateState((current) => ({ ...current, stationMappings: [...current.stationMappings, { station: '', areaId: 'hala-1' }] }))}><Plus className="mr-2 h-4 w-4" />Dodaj</Button></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{state.stationMappings.map((mapping, index) => <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border border-border p-2"><Input value={mapping.station} placeholder="np. WTR 12 lub ST 3" onChange={(event) => updateState((current) => ({ ...current, stationMappings: current.stationMappings.map((row, rowIndex) => rowIndex === index ? { ...row, station: event.target.value } : row) }))} /><SelectField value={mapping.areaId} onChange={(event) => updateState((current) => ({ ...current, stationMappings: current.stationMappings.map((row, rowIndex) => rowIndex === index ? { ...row, areaId: event.target.value } : row) }))}>{state.areas.filter((area) => !area.shared).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</SelectField><Button variant="ghost" className="min-h-[44px] px-3 text-danger" onClick={() => updateState((current) => ({ ...current, stationMappings: current.stationMappings.filter((_, rowIndex) => rowIndex !== index) }))}><Trash2 className="h-4 w-4" /></Button></div>)}</div></Card></div>;

  const renderGuide = () => <div className="space-y-5">{renderHeader('Instrukcja modułu', 'Krótki opis pełnego obiegu i najważniejszych zasad działania.')}{[
    ['1. Plan produkcyjny', 'Wgraj Excel i wybierz jedną zakładkę. Stanowiska zostaną przypisane do obszarów zgodnie z ustawieniami. Pozycje bez przypisu pozostaną widoczne na obu halach z ostrzeżeniem.'],
    ['2. Biblioteka technologii', 'Dla każdego indeksu utwórz technologię Bazową. Dopuszczone zamienniki zapisuj jako opisane warianty Awaryjna 1, Awaryjna 2 itd. Każdy wariant zawiera pełną listę materiałów.'],
    ['3. Technologia robocza', 'Po wyborze wersji aplikacja kopiuje jej materiały do konkretnej pozycji planu. Zamiana tworzywa, kartonu lub zużycia oznaczana jest jako ręczna i nie zmienia biblioteki.'],
    ['4. Codzienny horyzont', 'Zapotrzebowanie domyślnie dotyczy 3,5 zmiany: mniejszej z wartości „pozostała ilość” oraz „norma na zmianę × liczba zmian”. Długie zlecenie jest liczone ponownie każdego dnia tylko dla kolejnego krótkiego zakresu.'],
    ['5. Rzeczywisty spis', 'W tej zakładce prowadzisz pełny Spis rzeczywisty. Lokalizacja rozdziela pozycje na Halę 1, Halę 2, Bakomę, Lakiernię i wspólne Silosy. Obliczenia pobierają stąd aktualne ilości hali.'],
    ['6. Silosy', 'Silos jest wspólnym źródłem dla wszystkich hal. Ostrzeżenie liczy łączne zapotrzebowanie wszystkich obszarów, aby ten sam stan nie został obiecany dwa razy.'],
    ['7. Dokument do wypisania', 'Dokument pokazuje wyłącznie materiały, które trzeba dobrać. Osoba wypisująca klika jeden przycisk przy gotowej pozycji; wiersz zaznacza się na zielono.'],
    ['8. Zwroty', 'Materiał spisany na strefie trafia do zwrotów tylko wtedy, gdy nie występuje w żadnej technologii aktualnego planu. Zwroty można filtrować według strefy.']
  ].map(([title, text]) => <Card key={title}><h2 className="font-black text-title">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{text}</p></Card>)}</div>;

  if (!hydrated) return <div className="py-8 text-sm text-dim" role="status">Wczytywanie planowania...</div>;

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

  return <div className="space-y-5">
    {!readOnly ? <PlanningSaveNotice
      info={saveInfo}
      retry={calculationEditorOpen ? () => { void saveCalculationEditorChanges(); } : retrySave}
      downloadDraft={downloadDraft}
      loadLatest={async () => { if (await loadLatest()) closeCalculationEditor(); }}
    /> : null}
    {message ? <div className="fixed right-4 top-20 z-50 max-w-sm rounded-2xl border border-[rgba(255,122,26,0.55)] bg-[rgba(12,12,15,0.96)] px-4 py-3 text-sm font-semibold text-title shadow-2xl">{message}</div> : null}
    {renderer[view]()}
  </div>;
}

export default function MaterialPlanningPage() {
  const requestedView = useSearchParams().get('view');
  if (requestedView === 'spis') return <SpisRzeczywisty />;
  return <MaterialPlanningWorkspace requestedView={requestedView} />;
}
