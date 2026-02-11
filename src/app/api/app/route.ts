/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatDate } from '@/lib/utils/format';
import {
  canAccessWarehouse,
  canSeeTab,
  isReadOnly,
  isWarehouseAdmin
} from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { sendWarehouseTransferDocumentCreatedPush } from '@/lib/push/server';
import type {
  AuditEvent,
  AppUser,
  CatalogTotal,
  DailyTotals,
  DashboardSummary,
  Dryer,
  InventoryAdjustment,
  InventoryTotalPoint,
  Location,
  LocationDetailItem,
  LocationOption,
  LocationOverview,
  Material,
  MaterialCatalog,
  MaterialLocationsMap,
  MaterialReportRow,
  MaterialTotal,
  MixedMaterial,
  MonthlyDelta,
  MonthlyMaterialBreakdown,
  OriginalInventoryCatalogEntry,
  OriginalInventoryEntry,
  PeriodReport,
  RaportZmianowyEntry,
  RaportZmianowyEntryLog,
  RaportZmianowyItem,
  RaportZmianowySession,
  RaportZmianowySessionData,
  ReportRow,
  SparePart,
  SparePartHistory,
  Transfer,
  TransferKind,
  WarehouseTransferDocument,
  WarehouseTransferDocumentDetails,
  WarehouseTransferDocumentItem,
  WarehouseTransferDocumentStatus,
  WarehouseTransferDocumentSummary,
  WarehouseTransferItemIssue,
  WarehouseTransferItemPriority,
  WarehouseTransferItemReceipt,
  WarehouseTransferItemStatus,
  Warehouse,
  WarehouseKey,
  WarehouseTab,
  YearlyReport,
  YearlyReportRow
} from '@/lib/api/types';

export const dynamic = 'force-dynamic';

type EntryMap = Record<string, Record<string, { qty: number; confirmed: boolean; comment?: string }>>;
type EntriesByDate = Record<string, EntryMap>;
type TransferAdjustment = { added: number; removed: number };
type TransferAdjustmentsByDate = Record<string, Record<string, TransferAdjustment>>;
type TransferAdjustmentsByWarehouse = Record<string, Record<string, TransferAdjustment>>;
type TransferCommentsByDate = Record<string, Record<string, string[]>>;
type TransferDeltasByDate = Record<string, Record<string, Record<string, number>>>;
type WarehouseTransferDocumentItemBase = Omit<
  WarehouseTransferDocumentItem,
  'issuedQty' | 'receivedQty' | 'diffQty' | 'status' | 'issues' | 'receipts'
>;

const warehouseTransferPriorityOrder: WarehouseTransferItemPriority[] = [
  'CRITICAL',
  'HIGH',
  'NORMAL',
  'LOW'
];

const normalizeWarehouseTransferItemPriority = (value: unknown): WarehouseTransferItemPriority => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase();
  if (warehouseTransferPriorityOrder.includes(normalized as WarehouseTransferItemPriority)) {
    return normalized as WarehouseTransferItemPriority;
  }
  return 'NORMAL';
};

const toNumber = (value: unknown) => {
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const addDays = (dateKey: string, delta: number) => {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + delta);
  return formatDate(date);
};

const buildDateKeys = (fromKey: string, toKey: string) => {
  const start = parseDateKey(fromKey);
  const end = parseDateKey(toKey);
  const keys: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    keys.push(formatDate(cursor));
  }
  return keys;
};

const ensureAdjustment = (target: Record<string, TransferAdjustment>, key: string) => {
  if (!target[key]) {
    target[key] = { added: 0, removed: 0 };
  }
  return target[key];
};

const addTransferDelta = (
  target: TransferDeltasByDate,
  dateKey: string,
  locationId: string,
  materialId: string,
  delta: number
) => {
  if (!target[dateKey]) target[dateKey] = {};
  if (!target[dateKey][locationId]) target[dateKey][locationId] = {};
  target[dateKey][locationId][materialId] =
    (target[dateKey][locationId][materialId] ?? 0) + delta;
};

const mapWarehouse = (row: any): Warehouse => ({
  id: row.id,
  name: row.name,
  orderNo: row.order_no ?? 0,
  includeInSpis: row.include_in_spis ?? true,
  includeInStats: row.include_in_stats ?? true,
  isActive: row.is_active ?? true
});

const mapLocation = (row: any): Location => ({
  id: row.id,
  warehouseId: row.warehouse_id,
  name: row.name,
  orderNo: row.order_no ?? 0,
  type: row.type,
  isActive: row.is_active ?? true
});

const mapMaterial = (row: any): Material => ({
  id: row.id,
  code: row.material_catalogs?.name ?? 'Brak kartoteki',
  name: row.name,
  catalogId: row.catalog_id ?? null,
  catalogName: row.material_catalogs?.name ?? null,
  isActive: row.is_active ?? true
});

const mapMaterialCatalog = (row: any): MaterialCatalog => ({
  id: row.id,
  name: row.name,
  isActive: row.is_active ?? true
});

const mapDryer = (row: any): Dryer => ({
  id: row.id,
  name: row.name,
  orderNo: row.order_no ?? 0,
  isActive: row.is_active ?? true,
  materialId: row.material_id
});

const mapTransfer = (row: any): Transfer => ({
  id: row.id,
  at: row.at,
  kind: row.kind,
  materialId: row.material_id,
  qty: toNumber(row.qty),
  fromLocationId: row.from_location_id ?? undefined,
  toLocationId: row.to_location_id ?? undefined,
  partner: row.partner ?? undefined,
  note: row.note ?? undefined
});

const mapWarehouseTransferDocument = (row: any): WarehouseTransferDocument => {
  const status: WarehouseTransferDocumentStatus =
    row.status === 'CLOSED' ? 'CLOSED' : row.status === 'ISSUED' ? 'ISSUED' : 'OPEN';
  return {
    id: row.id,
    createdAt: row.created_at,
    createdById: row.created_by_id ?? null,
    createdByName: row.created_by_name ?? 'nieznany',
    documentNumber: row.document_number ?? '',
    sourceWarehouse: row.source_warehouse ?? undefined,
    targetWarehouse: row.target_warehouse ?? undefined,
    note: row.note ?? undefined,
    status,
    closedAt: row.closed_at ?? null,
    closedByName: row.closed_by_name ?? null
  };
};

const mapWarehouseTransferDocumentItem = (row: any): WarehouseTransferDocumentItemBase => ({
  id: row.id,
  documentId: row.document_id,
  lineNo: toNumber(row.line_no),
  priority: normalizeWarehouseTransferItemPriority(row.priority),
  indexCode: row.index_code ?? '',
  indexCode2: row.index_code2 ?? undefined,
  name: row.name ?? '',
  batch: row.batch ?? undefined,
  location: row.location ?? undefined,
  unit: row.unit ?? 'kg',
  plannedQty: toNumber(row.planned_qty),
  note: row.note ?? undefined
});

const mapWarehouseTransferItemIssue = (row: any): WarehouseTransferItemIssue => ({
  id: row.id,
  itemId: row.item_id,
  createdAt: row.created_at,
  issuerId: row.issuer_id ?? null,
  issuerName: row.issuer_name ?? 'nieznany',
  qty: toNumber(row.qty),
  note: row.note ?? undefined
});

const mapWarehouseTransferItemReceipt = (row: any): WarehouseTransferItemReceipt => ({
  id: row.id,
  itemId: row.item_id,
  createdAt: row.created_at,
  receiverId: row.receiver_id ?? null,
  receiverName: row.receiver_name ?? 'nieznany',
  qty: toNumber(row.qty),
  note: row.note ?? undefined
});

const mapInventoryAdjustment = (row: any): InventoryAdjustment => ({
  id: row.id,
  at: row.at,
  locationId: row.location_id,
  materialId: row.material_id,
  prevQty: toNumber(row.prev_qty),
  nextQty: toNumber(row.next_qty),
  note: row.note ?? undefined
});

const mapMixedMaterial = (row: any): MixedMaterial => ({
  id: row.id,
  name: row.name,
  qty: toNumber(row.qty),
  locationId: row.location_id
});

const mapSparePart = (row: any): SparePart => ({
  id: row.id,
  code: row.code,
  name: row.name,
  unit: row.unit,
  qty: toNumber(row.qty),
  location: row.location ?? undefined
});

const mapSparePartHistory = (row: any): SparePartHistory => ({
  id: row.id,
  at: row.at,
  user: row.user_name,
  partId: row.part_id,
  partName: row.part_name,
  qty: toNumber(row.qty),
  kind: row.kind,
  note: row.note ?? undefined
});

const mapOriginalInventoryEntry = (row: any): OriginalInventoryEntry => ({
  id: row.id,
  at: row.at,
  warehouseId: row.warehouse_id,
  name: row.name,
  qty: toNumber(row.qty),
  unit: row.unit,
  location: row.location ?? undefined,
  note: row.note ?? undefined,
  user: row.user_name
});

const mapOriginalInventoryCatalogEntry = (row: any): OriginalInventoryCatalogEntry => ({
  id: row.id,
  name: row.name,
  unit: row.unit,
  createdAt: row.created_at
});

const mapRaportZmianowySession = (row: any): RaportZmianowySession => ({
  id: row.id,
  createdAt: row.created_at,
  createdBy: row.created_by,
  dateKey: row.session_date ?? formatDate(new Date(row.created_at)),
  planSheet: row.plan_sheet ?? '',
  fileName: row.file_name ?? null
});

const mapRaportZmianowyItem = (row: any): RaportZmianowyItem => ({
  id: row.id,
  sessionId: row.session_id,
  indexCode: row.index_code,
  description: row.description ?? null,
  station: row.station ?? null,
  createdAt: row.created_at
});

const mapRaportZmianowyEntry = (row: any): RaportZmianowyEntry => ({
  id: row.id,
  itemId: row.item_id,
  note: row.note ?? '',
  createdAt: row.created_at,
  authorId: row.author_id ?? null,
  authorName: row.author_name ?? 'nieznany',
  editedAt: row.edited_at ?? null,
  editedById: row.edited_by_id ?? null,
  editedByName: row.edited_by_name ?? null
});

const mapAuditEvent = (row: any): AuditEvent => ({
  id: row.id,
  at: row.at,
  user: row.user_name,
  action: row.action,
  warehouse: row.warehouse ?? undefined,
  location: row.location ?? undefined,
  material: row.material ?? undefined,
  prevQty: row.prev_qty ?? null,
  nextQty: row.next_qty ?? null
});

const buildEntriesByDate = (rows: any[]): EntriesByDate => {
  const result: EntriesByDate = {};
  rows.forEach((row) => {
    const dateKey = row.date_key;
    if (!result[dateKey]) {
      result[dateKey] = {};
    }
    const dateBucket = result[dateKey];
    if (!dateBucket[row.location_id]) {
      dateBucket[row.location_id] = {};
    }
    dateBucket[row.location_id][row.material_id] = {
      qty: toNumber(row.qty),
      confirmed: row.confirmed ?? false,
      comment: row.comment ?? undefined
    };
  });
  return result;
};

const statusCodeFromError = (code: string) => {
  if (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'NOT_FOUND' || code === 'ENTRY_MISSING') return 404;
  if (code === 'DUPLICATE') return 409;
  if (code === 'INVALID_CREDENTIALS') return 401;
  if (code === 'INACTIVE') return 403;
  return 400;
};

const errorCodeFromError = (error: unknown) => {
  if (error && typeof error === 'object') {
    const maybeCode = (error as { code?: string }).code;
    if (maybeCode === '23505') return 'DUPLICATE';
    if (maybeCode === '23514') return 'CHECK_VIOLATION';
    if (typeof maybeCode === 'string') return maybeCode;
  }
  if (error instanceof Error) return error.message || 'UNKNOWN';
  return 'UNKNOWN';
};

const ALL_PRZEMIALY_TABS: WarehouseTab[] = [
  'dashboard',
  'spis',
  'spis-oryginalow',
  'przesuniecia',
  'raporty',
  'kartoteka',
  'wymieszane',
  'suszarki'
];

const ERP_MODULE_TABS: WarehouseTab[] = [
  'erp-wypisz-dokument',
  'erp-magazynier',
  'erp-rozdzielca',
  'erp-historia-dokumentow'
];

const requireWarehouseAccess = (user: AppUser, warehouse: WarehouseKey) => {
  if (!canAccessWarehouse(user, warehouse)) {
    throw new Error('FORBIDDEN');
  }
};

const requireAnyTabAccess = (
  user: AppUser,
  warehouse: WarehouseKey,
  tabs: WarehouseTab[]
) => {
  requireWarehouseAccess(user, warehouse);
  if (!tabs.some((tab) => canSeeTab(user, warehouse, tab))) {
    throw new Error('FORBIDDEN');
  }
};

const requireWarehouseWriteAccess = (user: AppUser, warehouse: WarehouseKey) => {
  requireWarehouseAccess(user, warehouse);
  if (isReadOnly(user, warehouse)) {
    throw new Error('FORBIDDEN');
  }
};

const requireTabWriteAccess = (
  user: AppUser,
  warehouse: WarehouseKey,
  tabs: WarehouseTab[]
) => {
  requireAnyTabAccess(user, warehouse, tabs);
  if (isReadOnly(user, warehouse)) {
    throw new Error('FORBIDDEN');
  }
};

const requireWarehouseAdminAccess = (user: AppUser, warehouse: WarehouseKey) => {
  if (!isWarehouseAdmin(user, warehouse)) {
    throw new Error('FORBIDDEN');
  }
};

const getActorName = (user: AppUser) =>
  user.name?.trim() || user.username?.trim() || 'nieznany';

const ensureActionAccess = (action: string, user: AppUser, payload: any) => {
  switch (action) {
    case 'getDashboard':
    case 'getTotalsHistory':
    case 'getMonthlyDelta':
    case 'getMonthlyMaterialBreakdown':
    case 'getTopCatalogTotal':
      requireAnyTabAccess(user, 'PRZEMIALY', ['dashboard']);
      return;
    case 'getReports':
    case 'getDailyHistory':
    case 'getPeriodReport':
    case 'getYearlyReport':
      requireAnyTabAccess(user, 'PRZEMIALY', ['raporty']);
      return;
    case 'getCurrentMaterialTotals':
      if (payload?.scope === 'all') {
        requireAnyTabAccess(user, 'PRZEMIALY', ['kartoteka']);
      } else {
        requireAnyTabAccess(user, 'PRZEMIALY', ['dashboard', 'kartoteka']);
      }
      return;
    case 'getMaterialLocations':
      requireAnyTabAccess(user, 'PRZEMIALY', ['kartoteka']);
      return;
    case 'getLocationsOverview':
    case 'getLocationDetail':
      requireAnyTabAccess(user, 'PRZEMIALY', ['spis']);
      return;
    case 'upsertEntry':
    case 'confirmNoChangeEntry':
    case 'confirmNoChangeLocation':
    case 'closeSpis':
      requireTabWriteAccess(user, 'PRZEMIALY', ['spis']);
      return;
    case 'getTransfers':
      requireAnyTabAccess(user, 'PRZEMIALY', ['przesuniecia']);
      return;
    case 'getWarehouseTransferDocuments':
    case 'getWarehouseTransferDocument':
      requireAnyTabAccess(user, 'PRZESUNIECIA_ERP', ERP_MODULE_TABS);
      return;
    case 'addTransfer':
      requireTabWriteAccess(user, 'PRZEMIALY', ['przesuniecia']);
      return;
    case 'createWarehouseTransferDocument':
      requireTabWriteAccess(user, 'PRZESUNIECIA_ERP', ['erp-wypisz-dokument']);
      return;
    case 'addWarehouseTransferItemIssue':
    case 'updateWarehouseTransferItemIssue':
      requireTabWriteAccess(user, 'PRZESUNIECIA_ERP', ['erp-magazynier']);
      return;
    case 'markWarehouseTransferDocumentIssued':
      requireTabWriteAccess(user, 'PRZESUNIECIA_ERP', ['erp-magazynier']);
      return;
    case 'addWarehouseTransferItemReceipt':
    case 'updateWarehouseTransferItemReceipt':
      requireTabWriteAccess(user, 'PRZESUNIECIA_ERP', ['erp-rozdzielca']);
      return;
    case 'closeWarehouseTransferDocument':
      requireTabWriteAccess(user, 'PRZESUNIECIA_ERP', [
        'erp-rozdzielca',
        'erp-historia-dokumentow'
      ]);
      return;
    case 'removeWarehouseTransferDocument':
      requireTabWriteAccess(user, 'PRZESUNIECIA_ERP', [
        'erp-magazynier',
        'erp-rozdzielca',
        'erp-historia-dokumentow'
      ]);
      return;
    case 'getMixedMaterials':
      requireAnyTabAccess(user, 'PRZEMIALY', ['wymieszane']);
      return;
    case 'addMixedMaterial':
    case 'removeMixedMaterial':
    case 'deleteMixedMaterial':
    case 'transferMixedMaterial':
      requireTabWriteAccess(user, 'PRZEMIALY', ['wymieszane']);
      return;
    case 'getDryers':
      requireAnyTabAccess(user, 'PRZEMIALY', ['suszarki']);
      return;
    case 'setDryerMaterial':
      requireTabWriteAccess(user, 'PRZEMIALY', ['suszarki']);
      return;
    case 'getOriginalInventory':
      requireAnyTabAccess(user, 'PRZEMIALY', ['spis-oryginalow']);
      return;
    case 'getOriginalInventoryCatalog':
      requireAnyTabAccess(user, 'PRZEMIALY', [
        'spis-oryginalow',
        'suszarki'
      ]);
      return;
    case 'addOriginalInventory':
      requireTabWriteAccess(user, 'PRZEMIALY', ['spis-oryginalow']);
      return;
    case 'addOriginalInventoryCatalog':
      requireTabWriteAccess(user, 'PRZEMIALY', [
        'spis-oryginalow',
        'suszarki'
      ]);
      return;
    case 'addOriginalInventoryCatalogBulk':
    case 'updateOriginalInventory':
    case 'removeOriginalInventory':
    case 'removeOriginalInventoryCatalog':
      requireTabWriteAccess(user, 'PRZEMIALY', ['spis-oryginalow']);
      return;
    case 'getCatalog':
      requireAnyTabAccess(user, 'PRZEMIALY', ALL_PRZEMIALY_TABS);
      return;
    case 'addMaterial':
      requireTabWriteAccess(user, 'PRZEMIALY', ['suszarki']);
      return;
    case 'getLocations':
    case 'getWarehouses':
    case 'getWarehouse':
    case 'getLocation':
    case 'getMaterials':
      requireWarehouseAccess(user, 'PRZEMIALY');
      return;
    case 'getAudit':
    case 'getLocationsAdmin':
    case 'getWarehousesAdmin':
    case 'addCatalog':
    case 'addMaterialCatalogBulk':
    case 'getCatalogs':
    case 'addMaterialBulk':
    case 'removeMaterial':
    case 'updateMaterialCatalog':
    case 'updateMaterial':
    case 'removeCatalog':
    case 'addWarehouse':
    case 'updateWarehouse':
    case 'removeWarehouse':
    case 'addLocation':
    case 'updateLocation':
    case 'removeLocation':
    case 'applyInventoryAdjustment':
    case 'getInventoryAdjustments':
    case 'addDryer':
    case 'updateDryer':
    case 'removeDryer':
      requireWarehouseAdminAccess(user, 'PRZEMIALY');
      return;
    case 'getSpareParts':
      requireAnyTabAccess(user, 'CZESCI', ['stany', 'pobierz', 'uzupelnij']);
      return;
    case 'getSparePartHistory':
      requireAnyTabAccess(user, 'CZESCI', ['historia']);
      return;
    case 'adjustSparePart':
      requireWarehouseWriteAccess(user, 'CZESCI');
      if (payload?.kind === 'OUT') {
        requireAnyTabAccess(user, 'CZESCI', ['pobierz']);
      } else {
        requireAnyTabAccess(user, 'CZESCI', ['uzupelnij']);
      }
      return;
    case 'addSparePart':
    case 'updateSparePart':
    case 'removeSparePart':
    case 'setSparePartQty':
      requireWarehouseAdminAccess(user, 'CZESCI');
      return;
    case 'getRaportZmianowySessions':
    case 'getRaportZmianowySession':
    case 'getRaportZmianowyEntries':
      requireAnyTabAccess(user, 'RAPORT_ZMIANOWY', ['raport-zmianowy']);
      return;
    case 'createRaportZmianowySession':
    case 'addRaportZmianowyItem':
    case 'updateRaportZmianowyItem':
    case 'addRaportZmianowyEntry':
    case 'updateRaportZmianowyEntry':
      requireTabWriteAccess(user, 'RAPORT_ZMIANOWY', ['raport-zmianowy']);
      return;
    case 'removeRaportZmianowySession':
    case 'removeRaportZmianowyEntry':
      requireWarehouseAdminAccess(user, 'RAPORT_ZMIANOWY');
      return;
    default:
      return;
  }
};

const AUDITABLE_ACTIONS = new Set<string>([
  'upsertEntry',
  'confirmNoChangeEntry',
  'confirmNoChangeLocation',
  'closeSpis',
  'addCatalog',
  'addMaterialCatalogBulk',
  'addMaterial',
  'addMaterialBulk',
  'removeMaterial',
  'updateMaterialCatalog',
  'updateMaterial',
  'removeCatalog',
  'addWarehouse',
  'updateWarehouse',
  'removeWarehouse',
  'addLocation',
  'updateLocation',
  'removeLocation',
  'addTransfer',
  'createWarehouseTransferDocument',
  'addWarehouseTransferItemIssue',
  'updateWarehouseTransferItemIssue',
  'markWarehouseTransferDocumentIssued',
  'addWarehouseTransferItemReceipt',
  'updateWarehouseTransferItemReceipt',
  'closeWarehouseTransferDocument',
  'removeWarehouseTransferDocument',
  'applyInventoryAdjustment',
  'addMixedMaterial',
  'removeMixedMaterial',
  'deleteMixedMaterial',
  'transferMixedMaterial',
  'addDryer',
  'updateDryer',
  'removeDryer',
  'setDryerMaterial',
  'addOriginalInventory',
  'addOriginalInventoryCatalog',
  'addOriginalInventoryCatalogBulk',
  'updateOriginalInventory',
  'removeOriginalInventory',
  'removeOriginalInventoryCatalog',
  'addSparePart',
  'updateSparePart',
  'removeSparePart',
  'setSparePartQty',
  'adjustSparePart',
  'createRaportZmianowySession',
  'removeRaportZmianowySession',
  'addRaportZmianowyItem',
  'updateRaportZmianowyItem',
  'addRaportZmianowyEntry',
  'updateRaportZmianowyEntry',
  'removeRaportZmianowyEntry'
]);

const CZESCI_AUDIT_ACTIONS = new Set<string>([
  'addSparePart',
  'updateSparePart',
  'removeSparePart',
  'setSparePartQty',
  'adjustSparePart'
]);

const RAPORT_ZMIANOWY_AUDIT_ACTIONS = new Set<string>([
  'createRaportZmianowySession',
  'removeRaportZmianowySession',
  'addRaportZmianowyItem',
  'updateRaportZmianowyItem',
  'addRaportZmianowyEntry',
  'updateRaportZmianowyEntry',
  'removeRaportZmianowyEntry'
]);

const ERP_AUDIT_ACTIONS = new Set<string>([
  'createWarehouseTransferDocument',
  'addWarehouseTransferItemIssue',
  'updateWarehouseTransferItemIssue',
  'markWarehouseTransferDocumentIssued',
  'addWarehouseTransferItemReceipt',
  'updateWarehouseTransferItemReceipt',
  'closeWarehouseTransferDocument',
  'removeWarehouseTransferDocument'
]);

const AUDIT_ACTION_LABELS: Partial<Record<string, string>> = {
  upsertEntry: 'Spis: zapis pozycji',
  confirmNoChangeEntry: 'Spis: potwierdzenie bez zmian',
  confirmNoChangeLocation: 'Spis: potwierdzenie lokalizacji',
  addTransfer: 'Przesuniecia: nowy ruch',
  createWarehouseTransferDocument: 'Przesuniecia magazynowe: nowy dokument',
  addWarehouseTransferItemIssue: 'Przesuniecia magazynowe: wydanie pozycji',
  updateWarehouseTransferItemIssue: 'Przesuniecia magazynowe: edycja wydania',
  markWarehouseTransferDocumentIssued: 'Przesuniecia magazynowe: wydano wszystkie pozycje',
  addWarehouseTransferItemReceipt: 'Przesuniecia magazynowe: przyjecie pozycji',
  updateWarehouseTransferItemReceipt: 'Przesuniecia magazynowe: edycja przyjecia',
  closeWarehouseTransferDocument: 'Przesuniecia magazynowe: zamkniecie dokumentu',
  removeWarehouseTransferDocument: 'Przesuniecia magazynowe: usuniecie dokumentu',
  applyInventoryAdjustment: 'Inwentaryzacja: korekta stanu',
  addMixedMaterial: 'Wymieszane: dodanie',
  removeMixedMaterial: 'Wymieszane: rozchod',
  transferMixedMaterial: 'Wymieszane: transfer',
  setDryerMaterial: 'Suszarki: przypisanie tworzywa',
  addOriginalInventory: 'Spis oryginalow: dodanie wpisu',
  updateOriginalInventory: 'Spis oryginalow: aktualizacja wpisu',
  removeOriginalInventory: 'Spis oryginalow: usuniecie wpisu',
  addSparePart: 'Czesci: dodanie pozycji',
  updateSparePart: 'Czesci: aktualizacja pozycji',
  removeSparePart: 'Czesci: usuniecie pozycji',
  setSparePartQty: 'Czesci: ustawienie stanu',
  adjustSparePart: 'Czesci: ruch magazynowy',
  createRaportZmianowySession: 'Raport zmianowy: utworzenie sesji',
  addRaportZmianowyEntry: 'Raport zmianowy: dodanie wpisu',
  updateRaportZmianowyEntry: 'Raport zmianowy: edycja wpisu',
  removeRaportZmianowyEntry: 'Raport zmianowy: usuniecie wpisu'
};

const toAuditText = (value: unknown) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, 240);
};

const toAuditNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getAuditWarehouse = (action: string): WarehouseKey => {
  if (CZESCI_AUDIT_ACTIONS.has(action)) return 'CZESCI';
  if (RAPORT_ZMIANOWY_AUDIT_ACTIONS.has(action)) return 'RAPORT_ZMIANOWY';
  if (ERP_AUDIT_ACTIONS.has(action)) return 'PRZESUNIECIA_ERP';
  return 'PRZEMIALY';
};

const getAuditLocation = (payload: any) => {
  const directLocation =
    toAuditText(payload?.locationId) ??
    toAuditText(payload?.location) ??
    toAuditText(payload?.warehouseId);
  if (directLocation) return directLocation;

  const fromLocation = toAuditText(payload?.fromLocationId);
  const toLocation = toAuditText(payload?.toLocationId);
  if (fromLocation || toLocation) {
    return `${fromLocation ?? '-'} -> ${toLocation ?? '-'}`;
  }

  const documentId = toAuditText(payload?.documentId);
  if (documentId) return `dokument:${documentId}`;

  const sessionId = toAuditText(payload?.sessionId);
  if (sessionId) return `sesja:${sessionId}`;
  const itemId = toAuditText(payload?.itemId);
  if (itemId) return `pozycja:${itemId}`;
  const entryId = toAuditText(payload?.entryId);
  if (entryId) return `wpis:${entryId}`;

  return null;
};

const getAuditMaterial = (action: string, payload: any) => {
  const materialId = toAuditText(payload?.materialId);
  if (materialId) return materialId;

  const partId = toAuditText(payload?.partId);
  if (partId) return `czesc:${partId}`;

  const indexCode = toAuditText(payload?.indexCode);
  if (indexCode) return indexCode;

  const transferItemId = toAuditText(payload?.itemId);
  if (transferItemId) return `pozycja:${transferItemId}`;

  const documentNumber = toAuditText(payload?.documentNumber);
  if (documentNumber) return `dok:${documentNumber}`;

  const name = toAuditText(payload?.name);
  if (name) return name;

  if (action === 'setDryerMaterial' && payload?.materialId === null) {
    return 'wyczyszczono';
  }

  return null;
};

const getAuditQty = (action: string, payload: any, data: unknown) => {
  if (action === 'applyInventoryAdjustment') {
    const entry = data as InventoryAdjustment | null | undefined;
    return {
      prevQty: toAuditNumber(entry?.prevQty),
      nextQty: toAuditNumber(entry?.nextQty)
    };
  }

  if (action === 'adjustSparePart') {
    const entry = data as SparePart | null | undefined;
    const delta = toAuditNumber(payload?.qty);
    const nextQty = toAuditNumber(entry?.qty);
    if (delta === null || nextQty === null) {
      return { prevQty: null, nextQty };
    }
    const prevQty = payload?.kind === 'OUT' ? nextQty + delta : nextQty - delta;
    return { prevQty, nextQty };
  }

  if (action === 'setSparePartQty') {
    return { prevQty: null, nextQty: toAuditNumber(payload?.qty) };
  }

  if (
    action === 'upsertEntry' ||
    action === 'addTransfer' ||
    action === 'addWarehouseTransferItemIssue' ||
    action === 'updateWarehouseTransferItemIssue' ||
    action === 'addWarehouseTransferItemReceipt' ||
    action === 'updateWarehouseTransferItemReceipt' ||
    action === 'addMixedMaterial' ||
    action === 'removeMixedMaterial' ||
    action === 'addOriginalInventory'
  ) {
    return { prevQty: null, nextQty: toAuditNumber(payload?.qty) };
  }

  return { prevQty: null, nextQty: null };
};

const writeAuditLog = async (
  action: string,
  payload: any,
  data: unknown,
  user: AppUser
) => {
  if (!AUDITABLE_ACTIONS.has(action)) return;

  const warehouse = getAuditWarehouse(action);
  const location = getAuditLocation(payload);
  const material = getAuditMaterial(action, payload);
  const qty = getAuditQty(action, payload, data);
  const actionLabel = AUDIT_ACTION_LABELS[action] ?? action;

  const auditPayload = {
    at: new Date().toISOString(),
    user_name: getActorName(user),
    action: actionLabel,
    warehouse,
    location,
    material,
    prev_qty: qty.prevQty,
    next_qty: qty.nextQty
  };

  const { error } = await supabaseAdmin.from('audit_logs').insert(auditPayload);
  if (error) {
    console.error('AUDIT_LOG_WRITE_FAILED', {
      action,
      message: error.message
    });
  }
};

const getActiveStatsLocations = (warehouses: Warehouse[], locations: Location[]) => {
  const allowed = new Set(
    warehouses.filter((warehouse) => warehouse.isActive && warehouse.includeInStats).map((item) => item.id)
  );
  return locations.filter((loc) => loc.isActive && allowed.has(loc.warehouseId));
};

const addComment = (target: Map<string, string[]>, label: string, comment?: string) => {
  const trimmed = comment?.trim();
  if (!trimmed) return;
  const existing = target.get(label) ?? [];
  if (!existing.includes(trimmed)) {
    existing.push(trimmed);
  }
  target.set(label, existing);
};

const applyExternalTransferTotalsToDiffs = (
  diffs: {
    addedTotals: Map<string, number>;
    removedTotals: Map<string, number>;
  },
  externalTotals: Record<string, TransferAdjustment> | undefined,
  materialMap: Map<string, Material>
) => {
  if (!externalTotals) return;
  Object.entries(externalTotals).forEach(([materialId, totals]) => {
    const label = materialMap.get(materialId)?.name ?? 'Nieznany';
    if (totals.added) {
      diffs.addedTotals.set(label, (diffs.addedTotals.get(label) ?? 0) + totals.added);
    }
    if (totals.removed) {
      diffs.removedTotals.set(label, (diffs.removedTotals.get(label) ?? 0) + totals.removed);
    }
  });
};

const buildTransferDeltasByDate = (
  transfers: Array<{
    at: string;
    kind: string;
    material_id: string;
    qty: number;
    from_location_id?: string | null;
    to_location_id?: string | null;
  }>
): TransferDeltasByDate => {
  const result: TransferDeltasByDate = {};
  transfers.forEach((transfer) => {
    const qty = toNumber(transfer.qty);
    if (!qty) return;
    const dateKey = formatDate(new Date(transfer.at));
    const materialId = String(transfer.material_id);
    if (
      (transfer.kind === 'INTERNAL' || transfer.kind === 'EXTERNAL_OUT') &&
      transfer.from_location_id
    ) {
      addTransferDelta(result, dateKey, transfer.from_location_id, materialId, -qty);
    }
    if (
      (transfer.kind === 'INTERNAL' || transfer.kind === 'EXTERNAL_IN') &&
      transfer.to_location_id
    ) {
      addTransferDelta(result, dateKey, transfer.to_location_id, materialId, qty);
    }
  });
  return result;
};

const buildExternalTotalsByDate = (
  transfers: Array<{
    at: string;
    kind: string;
    material_id: string;
    qty: number;
    from_location_id?: string | null;
    to_location_id?: string | null;
  }>,
  activeLocationIds: Set<string>
): TransferAdjustmentsByDate => {
  const result: TransferAdjustmentsByDate = {};
  transfers.forEach((transfer) => {
    const qty = toNumber(transfer.qty);
    if (!qty) return;
    const dateKey = formatDate(new Date(transfer.at));
    const materialId = String(transfer.material_id);
    if (transfer.kind === 'EXTERNAL_OUT' && transfer.from_location_id) {
      if (!activeLocationIds.has(transfer.from_location_id)) return;
      if (!result[dateKey]) result[dateKey] = {};
      const adjustment = ensureAdjustment(result[dateKey], materialId);
      adjustment.removed += qty;
    }
    if (transfer.kind === 'EXTERNAL_IN' && transfer.to_location_id) {
      if (!activeLocationIds.has(transfer.to_location_id)) return;
      if (!result[dateKey]) result[dateKey] = {};
      const adjustment = ensureAdjustment(result[dateKey], materialId);
      adjustment.added += qty;
    }
  });
  return result;
};

const buildExternalTotalsByWarehouse = (
  transfers: Array<{
    at: string;
    kind: string;
    material_id: string;
    qty: number;
    from_location_id?: string | null;
    to_location_id?: string | null;
  }>,
  locationWarehouseMap: Map<string, string>
): TransferAdjustmentsByWarehouse => {
  const result: TransferAdjustmentsByWarehouse = {};
  transfers.forEach((transfer) => {
    const qty = toNumber(transfer.qty);
    if (!qty) return;
    const dateKey = formatDate(new Date(transfer.at));
    if (transfer.kind === 'EXTERNAL_OUT' && transfer.from_location_id) {
      const warehouseId = locationWarehouseMap.get(transfer.from_location_id);
      if (!warehouseId) return;
      if (!result[dateKey]) result[dateKey] = {};
      const adjustment = ensureAdjustment(result[dateKey], warehouseId);
      adjustment.removed += qty;
    }
    if (transfer.kind === 'EXTERNAL_IN' && transfer.to_location_id) {
      const warehouseId = locationWarehouseMap.get(transfer.to_location_id);
      if (!warehouseId) return;
      if (!result[dateKey]) result[dateKey] = {};
      const adjustment = ensureAdjustment(result[dateKey], warehouseId);
      adjustment.added += qty;
    }
  });
  return result;
};

const buildExternalOutCommentsByDate = (
  transfers: Array<{
    at: string;
    kind: string;
    material_id: string;
    from_location_id?: string | null;
    partner?: string | null;
    note?: string | null;
  }>,
  activeLocationIds: Set<string>
): TransferCommentsByDate => {
  const result: TransferCommentsByDate = {};
  transfers.forEach((transfer) => {
    if (transfer.kind !== 'EXTERNAL_OUT') return;
    if (!transfer.from_location_id) return;
    if (!activeLocationIds.has(transfer.from_location_id)) return;
    const dateKey = formatDate(new Date(transfer.at));
    const materialId = String(transfer.material_id);
    const commentParts = [];
    if (transfer.partner && String(transfer.partner).trim()) {
      commentParts.push(`Kontrahent: ${String(transfer.partner).trim()}`);
    }
    if (transfer.note && String(transfer.note).trim()) {
      commentParts.push(String(transfer.note).trim());
    }
    if (commentParts.length === 0) return;
    if (!result[dateKey]) result[dateKey] = {};
    const list = result[dateKey][materialId] ?? [];
    commentParts.forEach((part) => {
      if (!list.includes(part)) list.push(part);
    });
    result[dateKey][materialId] = list;
  });
  return result;
};

const collectConfirmedDiffs = (
  dateKey: string,
  entriesByDate: EntriesByDate,
  materialMap: Map<string, Material>,
  activeLocations: Location[],
  transferDeltasByDate?: TransferDeltasByDate
) => {
  const addedTotals = new Map<string, number>();
  const removedTotals = new Map<string, number>();
  const addedComments = new Map<string, string[]>();
  const removedComments = new Map<string, string[]>();
  const yesterdayKey = addDays(dateKey, -1);
  const todayEntries = entriesByDate[dateKey] ?? {};
  const yesterdayEntries = entriesByDate[yesterdayKey] ?? {};
  const dayDeltas = transferDeltasByDate?.[dateKey] ?? {};

  activeLocations.forEach((loc) => {
    const today = todayEntries[loc.id] ?? {};
    const yesterday = yesterdayEntries[loc.id] ?? {};
    const union = new Set([...Object.keys(yesterday), ...Object.keys(today)]);
    union.forEach((materialId) => {
      const todayEntry = today[materialId];
      if (!todayEntry?.confirmed) return;
      const label = materialMap.get(materialId)?.name ?? 'Nieznany';
      const todayQty = todayEntry.qty ?? 0;
      const delta = dayDeltas[loc.id]?.[materialId] ?? 0;
      const adjustedTodayQty = todayQty - delta;
      const yesterdayQty = yesterday[materialId]?.qty ?? 0;
      const diff = adjustedTodayQty - yesterdayQty;
      if (diff > 0) {
        addedTotals.set(label, (addedTotals.get(label) ?? 0) + diff);
        addComment(addedComments, label, todayEntry.comment);
      }
      if (diff < 0) {
        removedTotals.set(label, (removedTotals.get(label) ?? 0) + Math.abs(diff));
        addComment(removedComments, label, todayEntry.comment);
      }
    });
  });

  return { addedTotals, removedTotals, addedComments, removedComments };
};

const fetchWarehouses = async () => {
  const { data, error } = await supabaseAdmin.from('warehouses').select('*');
  if (error) throw error;
  return (data ?? []).map(mapWarehouse);
};

const fetchLocations = async () => {
  const { data, error } = await supabaseAdmin.from('locations').select('*');
  if (error) throw error;
  return (data ?? []).map(mapLocation);
};

const fetchMaterials = async () => {
  const { data, error } = await supabaseAdmin
    .from('materials')
    .select('*, material_catalogs(name)');
  if (error) throw error;
  return (data ?? []).map(mapMaterial);
};

const fetchCatalogs = async () => {
  const { data, error } = await supabaseAdmin.from('material_catalogs').select('*');
  if (error) throw error;
  return (data ?? []).map(mapMaterialCatalog);
};

const fetchOriginalCatalog = async () => {
  const { data, error } = await supabaseAdmin
    .from('original_inventory_catalog')
    .select('*');
  if (error) throw error;
  return (data ?? []).map(mapOriginalInventoryCatalogEntry);
};

const isWarehouseTransferItemCompleted = (plannedQty: number, receivedQty: number) => {
  if (plannedQty <= 0) return receivedQty > 0;
  return receivedQty >= plannedQty;
};

const resolveWarehouseTransferItemStatus = (
  plannedQty: number,
  receivedQty: number
): WarehouseTransferItemStatus => {
  if (receivedQty <= 0) return 'PENDING';
  if (plannedQty <= 0) return 'OVER';
  const delta = receivedQty - plannedQty;
  if (Math.abs(delta) < 0.000001) return 'DONE';
  if (delta < 0) return 'PARTIAL';
  return 'OVER';
};

const buildWarehouseTransferDocumentSummary = (
  document: WarehouseTransferDocument,
  items: WarehouseTransferDocumentItemBase[],
  issuedByItem: Map<string, number>,
  receivedByItem: Map<string, number>
): WarehouseTransferDocumentSummary => {
  let plannedQtyTotal = 0;
  let issuedQtyTotal = 0;
  let receivedQtyTotal = 0;
  let completedItemsCount = 0;

  items.forEach((item) => {
    const issuedQty = issuedByItem.get(item.id) ?? 0;
    const receivedQty = receivedByItem.get(item.id) ?? 0;
    plannedQtyTotal += item.plannedQty;
    issuedQtyTotal += issuedQty;
    receivedQtyTotal += receivedQty;
    if (isWarehouseTransferItemCompleted(item.plannedQty, receivedQty)) {
      completedItemsCount += 1;
    }
  });

  return {
    ...document,
    itemsCount: items.length,
    completedItemsCount,
    plannedQtyTotal,
    issuedQtyTotal,
    receivedQtyTotal
  };
};

const fetchWarehouseTransferItemsByDocumentIds = async (
  documentIds: string[]
): Promise<WarehouseTransferDocumentItemBase[]> => {
  if (documentIds.length === 0) return [];
  const items: WarehouseTransferDocumentItemBase[] = [];
  const chunkSize = 500;
  for (let i = 0; i < documentIds.length; i += chunkSize) {
    const chunk = documentIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from('warehouse_transfer_document_items')
      .select('*')
      .in('document_id', chunk)
      .order('line_no', { ascending: true });
    if (error) throw error;
    items.push(...(data ?? []).map(mapWarehouseTransferDocumentItem));
  }
  return items;
};

const fetchWarehouseTransferIssuesByItemIds = async (
  itemIds: string[]
): Promise<WarehouseTransferItemIssue[]> => {
  if (itemIds.length === 0) return [];
  const issues: WarehouseTransferItemIssue[] = [];
  const chunkSize = 500;
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from('warehouse_transfer_item_issues')
      .select('*')
      .in('item_id', chunk)
      .order('created_at', { ascending: true });
    if (error) {
      if (error.code === '42P01') {
        return [];
      }
      throw error;
    }
    issues.push(...(data ?? []).map(mapWarehouseTransferItemIssue));
  }
  return issues;
};

const fetchWarehouseTransferReceiptsByItemIds = async (
  itemIds: string[]
): Promise<WarehouseTransferItemReceipt[]> => {
  if (itemIds.length === 0) return [];
  const receipts: WarehouseTransferItemReceipt[] = [];
  const chunkSize = 500;
  for (let i = 0; i < itemIds.length; i += chunkSize) {
    const chunk = itemIds.slice(i, i + chunkSize);
    const { data, error } = await supabaseAdmin
      .from('warehouse_transfer_item_receipts')
      .select('*')
      .in('item_id', chunk)
      .order('created_at', { ascending: true });
    if (error) throw error;
    receipts.push(...(data ?? []).map(mapWarehouseTransferItemReceipt));
  }
  return receipts;
};

const fetchWarehouseTransferDocumentDetails = async (
  documentId: string
): Promise<WarehouseTransferDocumentDetails> => {
  const { data: documentRow, error: documentError } = await supabaseAdmin
    .from('warehouse_transfer_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle();
  if (documentError) throw documentError;
  if (!documentRow) throw new Error('NOT_FOUND');
  const document = mapWarehouseTransferDocument(documentRow);

  const { data: itemRows, error: itemsError } = await supabaseAdmin
    .from('warehouse_transfer_document_items')
    .select('*')
    .eq('document_id', documentId)
    .order('line_no', { ascending: true });
  if (itemsError) throw itemsError;
  const itemBases = (itemRows ?? []).map(mapWarehouseTransferDocumentItem);
  const itemIds = itemBases.map((item) => item.id);
  const issues = await fetchWarehouseTransferIssuesByItemIds(itemIds);
  const receipts = await fetchWarehouseTransferReceiptsByItemIds(itemIds);

  const issueByItem = new Map<string, WarehouseTransferItemIssue[]>();
  const issuedByItem = new Map<string, number>();
  issues.forEach((issue) => {
    const existing = issueByItem.get(issue.itemId) ?? [];
    existing.push(issue);
    issueByItem.set(issue.itemId, existing);
    issuedByItem.set(issue.itemId, (issuedByItem.get(issue.itemId) ?? 0) + issue.qty);
  });

  const receiptByItem = new Map<string, WarehouseTransferItemReceipt[]>();
  const receivedByItem = new Map<string, number>();
  receipts.forEach((receipt) => {
    const existing = receiptByItem.get(receipt.itemId) ?? [];
    existing.push(receipt);
    receiptByItem.set(receipt.itemId, existing);
    receivedByItem.set(receipt.itemId, (receivedByItem.get(receipt.itemId) ?? 0) + receipt.qty);
  });

  const items: WarehouseTransferDocumentItem[] = itemBases.map((item) => {
    const itemIssues = issueByItem.get(item.id) ?? [];
    const itemReceipts = receiptByItem.get(item.id) ?? [];
    const issuedQty = issuedByItem.get(item.id) ?? 0;
    const receivedQty = receivedByItem.get(item.id) ?? 0;
    return {
      ...item,
      issuedQty,
      receivedQty,
      diffQty: receivedQty - item.plannedQty,
      status: resolveWarehouseTransferItemStatus(item.plannedQty, receivedQty),
      issues: itemIssues,
      receipts: itemReceipts
    };
  });

  return {
    document: buildWarehouseTransferDocumentSummary(
      document,
      itemBases,
      issuedByItem,
      receivedByItem
    ),
    items
  };
};

const fetchWarehouseTransferDocumentSummaries = async (): Promise<
  WarehouseTransferDocumentSummary[]
> => {
  const { data: documentRows, error: documentError } = await supabaseAdmin
    .from('warehouse_transfer_documents')
    .select('*')
    .order('created_at', { ascending: false });
  if (documentError) throw documentError;
  const documents = (documentRows ?? []).map(mapWarehouseTransferDocument);
  if (documents.length === 0) return [];

  const documentIds = documents.map((document) => document.id);
  const items = await fetchWarehouseTransferItemsByDocumentIds(documentIds);
  const itemIds = items.map((item) => item.id);
  const issues = await fetchWarehouseTransferIssuesByItemIds(itemIds);
  const receipts = await fetchWarehouseTransferReceiptsByItemIds(itemIds);

  const itemsByDocumentId = new Map<string, WarehouseTransferDocumentItemBase[]>();
  items.forEach((item) => {
    const existing = itemsByDocumentId.get(item.documentId) ?? [];
    existing.push(item);
    itemsByDocumentId.set(item.documentId, existing);
  });

  const issuedByItem = new Map<string, number>();
  issues.forEach((issue) => {
    issuedByItem.set(issue.itemId, (issuedByItem.get(issue.itemId) ?? 0) + issue.qty);
  });

  const receivedByItem = new Map<string, number>();
  receipts.forEach((receipt) => {
    receivedByItem.set(receipt.itemId, (receivedByItem.get(receipt.itemId) ?? 0) + receipt.qty);
  });

  return documents.map((document) =>
    buildWarehouseTransferDocumentSummary(
      document,
      itemsByDocumentId.get(document.id) ?? [],
      issuedByItem,
      receivedByItem
    )
  );
};

const fetchEntries = async (fromKey: string, toKey?: string) => {
  let query = supabaseAdmin.from('daily_entries').select('*');
  query = toKey ? query.gte('date_key', fromKey).lte('date_key', toKey) : query.eq('date_key', fromKey);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

const fetchTransfers = async (fromKey: string, toKey: string) => {
  const start = `${fromKey}T00:00:00.000Z`;
  const end = `${addDays(toKey, 1)}T00:00:00.000Z`;
  const { data, error } = await supabaseAdmin
    .from('transfers')
    .select('at, kind, material_id, qty, from_location_id, to_location_id, partner, note')
    .gte('at', start)
    .lt('at', end);
  if (error) throw error;
  return data ?? [];
};

const fetchLocationStatus = async (fromKey: string, toKey?: string) => {
  let query = supabaseAdmin.from('daily_location_status').select('*');
  query = toKey ? query.gte('date_key', fromKey).lte('date_key', toKey) : query.eq('date_key', fromKey);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
};

const normalizeLocationName = (value: string, type: Location['type']) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (type === 'wtr') {
    const numericOnly = trimmed.match(/^\d+$/);
    if (numericOnly) {
      return `WTR ${numericOnly[0]}`;
    }
    const normalized = trimmed.replace(/^wtr\s*/i, '').trim();
    return normalized ? `WTR ${normalized}` : trimmed;
  }
  return trimmed;
};

const normalizeMixedName = (value: string) => value.trim().toLowerCase();

const getTodayKey = () => formatDate(new Date());

const upsertTransferEntry = async (
  dateKey: string,
  locationId: string,
  materialId: string,
  delta: number
) => {
  const { data: todayEntry, error: todayError } = await supabaseAdmin
    .from('daily_entries')
    .select('qty, confirmed, comment')
    .eq('date_key', dateKey)
    .eq('location_id', locationId)
    .eq('material_id', materialId)
    .maybeSingle();
  if (todayError) throw todayError;
  let baseQty: number | null = todayEntry ? toNumber(todayEntry.qty) : null;
  let confirmed = todayEntry?.confirmed ?? false;
  let comment = todayEntry?.comment ?? null;
  if (baseQty === null) {
    const yesterdayKey = addDays(dateKey, -1);
    const { data: yesterdayEntry, error: yesterdayError } = await supabaseAdmin
      .from('daily_entries')
      .select('qty')
      .eq('date_key', yesterdayKey)
      .eq('location_id', locationId)
      .eq('material_id', materialId)
      .maybeSingle();
    if (yesterdayError) throw yesterdayError;
    baseQty = toNumber(yesterdayEntry?.qty);
    confirmed = false;
    comment = null;
  }
  const nextQty = Math.max(0, baseQty + delta);
  const { error: upsertError } = await supabaseAdmin
    .from('daily_entries')
    .upsert(
      {
        date_key: dateKey,
        location_id: locationId,
        material_id: materialId,
        qty: nextQty,
        confirmed,
        comment,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'date_key,location_id,material_id' }
    );
  if (upsertError) throw upsertError;
  await supabaseAdmin
    .from('daily_location_status')
    .delete()
    .eq('date_key', dateKey)
    .eq('location_id', locationId);
};

const handleAction = async (action: string, payload: any, currentUser: AppUser) => {
  switch (action) {
    case 'getDashboard': {
      const dateKey = String(payload?.date ?? getTodayKey());
      const [warehouses, locations] = await Promise.all([
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeStatsLocations = getActiveStatsLocations(warehouses, locations);
      const yesterdayKey = addDays(dateKey, -1);
      const [todayEntriesRows, yesterdayEntriesRows, todayStatusRows, yesterdayStatusRows, transferRows] =
        await Promise.all([
          fetchEntries(dateKey),
          fetchEntries(yesterdayKey),
          fetchLocationStatus(dateKey),
          fetchLocationStatus(yesterdayKey),
          fetchTransfers(dateKey, dateKey)
        ]);
      const todayEntriesByDate = buildEntriesByDate(todayEntriesRows);
      const todayEntries = todayEntriesByDate[dateKey] ?? {};
      const yesterdayEntries = buildEntriesByDate(yesterdayEntriesRows)[yesterdayKey] ?? {};
      const emptyConfirmedToday = new Set(todayStatusRows.map((row) => row.location_id));
      const emptyConfirmedYesterday = new Set(yesterdayStatusRows.map((row) => row.location_id));
      const locationWarehouseMap = new Map(activeStatsLocations.map((loc) => [loc.id, loc.warehouseId]));
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByWarehouse = buildExternalTotalsByWarehouse(
        transferRows,
        locationWarehouseMap
      );
      const externalTotalsForDay = externalTotalsByWarehouse[dateKey] ?? {};
      const dayDeltas = transferDeltasByDate[dateKey] ?? {};
      return warehouses
        .filter((warehouse) => warehouse.isActive && warehouse.includeInStats)
        .map((warehouse) => {
          const locs = activeStatsLocations.filter((loc) => loc.warehouseId === warehouse.id);
          let added = 0;
          let removed = 0;
          let confirmed = 0;

          locs.forEach((loc) => {
            const today = todayEntries[loc.id] ?? {};
            const yesterday = yesterdayEntries[loc.id] ?? {};
            const union = new Set([...Object.keys(yesterday), ...Object.keys(today)]);
            const allConfirmed =
              union.size > 0 && [...union].every((id) => today[id]?.confirmed);
            const isConfirmed =
              emptyConfirmedToday.has(loc.id) ||
              allConfirmed ||
              (union.size === 0 && emptyConfirmedYesterday.has(loc.id));

            if (isConfirmed) {
              confirmed += 1;
            }
            if (!isConfirmed || union.size === 0) return;

            union.forEach((materialId) => {
              const todayQty = today[materialId]?.qty ?? 0;
              const delta = dayDeltas[loc.id]?.[materialId] ?? 0;
              const adjustedTodayQty = todayQty - delta;
              const yesterdayQty = yesterday[materialId]?.qty ?? 0;
              const diff = adjustedTodayQty - yesterdayQty;
              if (diff > 0) added += diff;
              if (diff < 0) removed += Math.abs(diff);
            });
          });

          const externalTotals = externalTotalsForDay[warehouse.id];
          if (externalTotals) {
            added += externalTotals.added;
            removed += externalTotals.removed;
          }

          return {
            warehouseId: warehouse.id,
            warehouseName: warehouse.name,
            added,
            removed,
            confirmed,
            total: locs.length
          } satisfies DashboardSummary;
        });
    }
    case 'getLocationsOverview': {
      const warehouseId = String(payload?.warehouseId ?? '');
      const dateKey = String(payload?.date ?? getTodayKey());
      if (!warehouseId) throw new Error('WAREHOUSE_MISSING');
      const [locations, materials] = await Promise.all([fetchLocations(), fetchMaterials()]);
      const activeLocations = locations.filter(
        (loc) => loc.warehouseId === warehouseId && loc.isActive
      );
      const yesterdayKey = addDays(dateKey, -1);
      const [todayEntriesRows, yesterdayEntriesRows, todayStatusRows, yesterdayStatusRows] =
        await Promise.all([
          fetchEntries(dateKey),
          fetchEntries(yesterdayKey),
          fetchLocationStatus(dateKey),
          fetchLocationStatus(yesterdayKey)
        ]);
      const todayEntries = buildEntriesByDate(todayEntriesRows)[dateKey] ?? {};
      const yesterdayEntries = buildEntriesByDate(yesterdayEntriesRows)[yesterdayKey] ?? {};
      const emptyConfirmedToday = new Set(todayStatusRows.map((row) => row.location_id));
      const emptyConfirmedYesterday = new Set(yesterdayStatusRows.map((row) => row.location_id));
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));

      return activeLocations
        .sort((a, b) => a.orderNo - b.orderNo)
        .map((loc) => {
          const today = todayEntries[loc.id] ?? {};
          const yesterday = yesterdayEntries[loc.id] ?? {};
          const union = new Set([...Object.keys(today), ...Object.keys(yesterday)]);
          const confirmed = emptyConfirmedToday.has(loc.id)
            ? true
            : union.size > 0 && [...union].every((id) => today[id]?.confirmed);
          const source = confirmed || Object.keys(today).length > 0 ? 'TODAY' : 'LAST';
          const hasTodayEntries = Object.keys(today).length > 0;
          const previewSource = source === 'TODAY' ? today : yesterday;
          const preview = Object.entries(previewSource)
            .filter(([, entry]) => (entry?.qty ?? 0) > 0)
            .slice(0, 2)
            .map(([id, entry]) => ({
              label: materialMap.get(id)?.name ?? 'Nieznany',
              qty: entry?.qty ?? 0
            }));
          const lastTotal = Object.values(yesterday).reduce((sum, entry) => sum + (entry?.qty ?? 0), 0);
          const lastItems = Object.entries(yesterday)
            .filter(([, entry]) => (entry?.qty ?? 0) > 0)
            .map(([id, entry]) => ({
              label: materialMap.get(id)?.name ?? 'Nieznany',
              qty: entry?.qty ?? 0
            }));
          const currentSource = hasTodayEntries ? today : yesterday;
          const currentItems = Object.entries(currentSource)
            .filter(([, entry]) => (entry?.qty ?? 0) > 0)
            .map(([id, entry]) => ({
              label: materialMap.get(id)?.name ?? 'Nieznany',
              qty: entry?.qty ?? 0
            }));
          const allZeroConfirmed =
            union.size > 0 &&
            [...union].every(
              (id) => today[id]?.confirmed && (today[id]?.qty ?? 0) === 0
            );
          const empty =
            preview.length === 0 &&
            (emptyConfirmedToday.has(loc.id) ||
              emptyConfirmedYesterday.has(loc.id) ||
              allZeroConfirmed);

          return {
            id: loc.id,
            name: loc.name,
            status: confirmed ? 'DONE' : 'PENDING',
            source,
            preview,
            lastTotal,
            lastItems,
            currentItems,
            empty
          } satisfies LocationOverview;
        });
    }
    case 'getLocationDetail': {
      const locationId = String(payload?.locationId ?? '');
      const dateKey = String(payload?.date ?? getTodayKey());
      if (!locationId) throw new Error('NOT_FOUND');
      const [materials, todayEntriesRows, yesterdayEntriesRows] = await Promise.all([
        fetchMaterials(),
        fetchEntries(dateKey),
        fetchEntries(addDays(dateKey, -1))
      ]);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const todayEntries = buildEntriesByDate(todayEntriesRows)[dateKey]?.[locationId] ?? {};
      const yesterdayEntries =
        buildEntriesByDate(yesterdayEntriesRows)[addDays(dateKey, -1)]?.[locationId] ?? {};
      const union = new Set([...Object.keys(todayEntries), ...Object.keys(yesterdayEntries)]);
      return [...union].map((materialId) => {
        const material = materialMap.get(materialId);
        return {
          materialId,
          code: material?.code ?? 'Brak kartoteki',
          name: material?.name ?? 'Nieznany przemial',
          yesterdayQty: yesterdayEntries[materialId]?.qty ?? 0,
          todayQty: todayEntries[materialId]?.qty ?? null,
          confirmed: todayEntries[materialId]?.confirmed ?? false,
          comment: todayEntries[materialId]?.comment
        } satisfies LocationDetailItem;
      });
    }
    case 'upsertEntry': {
      const locationId = String(payload?.locationId ?? '');
      const materialId = String(payload?.materialId ?? '');
      const qty = toNumber(payload?.qty);
      if (!locationId || !materialId) throw new Error('NOT_FOUND');
      const dateKey = getTodayKey();
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('daily_entries')
        .select('comment')
        .eq('date_key', dateKey)
        .eq('location_id', locationId)
        .eq('material_id', materialId)
        .maybeSingle();
      if (existingError) throw existingError;
      let nextComment: string | null = existing?.comment ?? null;
      if (payload?.comment !== undefined) {
        const trimmed = String(payload.comment ?? '').trim();
        nextComment = trimmed ? trimmed : null;
      }
      const { error } = await supabaseAdmin
        .from('daily_entries')
        .upsert(
          {
            date_key: dateKey,
            location_id: locationId,
            material_id: materialId,
            qty,
            confirmed: true,
            comment: nextComment,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'date_key,location_id,material_id' }
        );
      if (error) throw error;
      await supabaseAdmin
        .from('daily_location_status')
        .delete()
        .eq('date_key', dateKey)
        .eq('location_id', locationId);
      return { ok: true };
    }
    case 'confirmNoChangeEntry': {
      const locationId = String(payload?.locationId ?? '');
      const materialId = String(payload?.materialId ?? '');
      if (!locationId || !materialId) throw new Error('NOT_FOUND');
      const dateKey = getTodayKey();
      const yesterdayKey = addDays(dateKey, -1);
      const { data: yesterdayEntry, error: yesterdayError } = await supabaseAdmin
        .from('daily_entries')
        .select('qty')
        .eq('date_key', yesterdayKey)
        .eq('location_id', locationId)
        .eq('material_id', materialId)
        .maybeSingle();
      if (yesterdayError) throw yesterdayError;
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('daily_entries')
        .select('comment')
        .eq('date_key', dateKey)
        .eq('location_id', locationId)
        .eq('material_id', materialId)
        .maybeSingle();
      if (existingError) throw existingError;
      const { error } = await supabaseAdmin
        .from('daily_entries')
        .upsert(
          {
            date_key: dateKey,
            location_id: locationId,
            material_id: materialId,
            qty: toNumber(yesterdayEntry?.qty),
            confirmed: true,
            comment: existing?.comment ?? null,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'date_key,location_id,material_id' }
        );
      if (error) throw error;
      return { ok: true };
    }
    case 'confirmNoChangeLocation': {
      const locationId = String(payload?.locationId ?? '');
      if (!locationId) throw new Error('NOT_FOUND');
      const dateKey = getTodayKey();
      const yesterdayKey = addDays(dateKey, -1);
      const { data: yesterdayEntries, error: yesterdayError } = await supabaseAdmin
        .from('daily_entries')
        .select('*')
        .eq('date_key', yesterdayKey)
        .eq('location_id', locationId);
      if (yesterdayError) throw yesterdayError;
      if (!yesterdayEntries || yesterdayEntries.length === 0) {
        const { error } = await supabaseAdmin
          .from('daily_location_status')
          .upsert(
            {
              date_key: dateKey,
              location_id: locationId,
              is_confirmed: true
            },
            { onConflict: 'date_key,location_id' }
          );
        if (error) throw error;
        return { ok: true };
      }
      await supabaseAdmin
        .from('daily_entries')
        .delete()
        .eq('date_key', dateKey)
        .eq('location_id', locationId);
      const { error: insertError } = await supabaseAdmin.from('daily_entries').insert(
        yesterdayEntries.map((entry) => ({
          date_key: dateKey,
          location_id: locationId,
          material_id: entry.material_id,
          qty: toNumber(entry.qty),
          confirmed: true,
          comment: null,
          updated_at: new Date().toISOString()
        }))
      );
      if (insertError) throw insertError;
      await supabaseAdmin
        .from('daily_location_status')
        .delete()
        .eq('date_key', dateKey)
        .eq('location_id', locationId);
      return { ok: true };
    }
    case 'closeSpis': {
      return true;
    }
    case 'getReports': {
      const dateKey = getTodayKey();
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeMaterials = materials.filter((mat) => mat.isActive);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const fromKey = addDays(dateKey, -1);
      const rows = await fetchEntries(fromKey, dateKey);
      const entriesByDate = buildEntriesByDate(rows);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const transferRows = await fetchTransfers(fromKey, dateKey);
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByDate = buildExternalTotalsByDate(
        transferRows,
        new Set(activeLocations.map((loc) => loc.id))
      );
      const diffs = collectConfirmedDiffs(
        dateKey,
        entriesByDate,
        materialMap,
        activeLocations,
        transferDeltasByDate
      );
      applyExternalTransferTotalsToDiffs(diffs, externalTotalsByDate[dateKey], materialMap);
      const result: ReportRow[] = activeMaterials.map((mat) => {
        const added = diffs.addedTotals.get(mat.name) ?? 0;
        const removed = diffs.removedTotals.get(mat.name) ?? 0;
        return {
          materialId: mat.id,
          code: mat.code,
          name: mat.name,
          added,
          removed,
          net: added - removed
        };
      });
      return result.filter((row) => row.added !== 0 || row.removed !== 0);
    }
    case 'getCatalog': {
      const materials = await fetchMaterials();
      return materials.filter((mat) => mat.isActive);
    }
    case 'getCatalogs': {
      const catalogs = await fetchCatalogs();
      return catalogs
        .filter((item) => item.isActive)
        .sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }));
    }
    case 'getTotalsHistory': {
      const days = Math.max(1, Number(payload?.days ?? 30));
      const todayKey = getTodayKey();
      const fromKey = addDays(todayKey, -Math.max(0, days - 1));
      const [warehouses, locations] = await Promise.all([
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const rows = await fetchEntries(fromKey, todayKey);
      const entriesByDate = buildEntriesByDate(rows);
      const dateKeys = buildDateKeys(fromKey, todayKey);
      const result: InventoryTotalPoint[] = dateKeys.map((key) => {
        const entries = entriesByDate[key] ?? {};
        const total = activeLocations.reduce((sum, loc) => {
          const locEntries = entries[loc.id];
          if (!locEntries) return sum;
          return (
            sum +
            Object.values(locEntries).reduce((inner, entry) => inner + (entry?.qty ?? 0), 0)
          );
        }, 0);
        return { date: key, total };
      });
      return result;
    }
    case 'getMonthlyDelta': {
      const todayKey = getTodayKey();
      const date = parseDateKey(todayKey);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const fromKey = formatDate(monthStart);
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const rows = await fetchEntries(addDays(fromKey, -1), todayKey);
      const entriesByDate = buildEntriesByDate(rows);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const transferRows = await fetchTransfers(fromKey, todayKey);
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByDate = buildExternalTotalsByDate(
        transferRows,
        new Set(activeLocations.map((loc) => loc.id))
      );
      const dateKeys = buildDateKeys(fromKey, todayKey);
      const addedTotals = new Map<string, number>();
      const removedTotals = new Map<string, number>();
      dateKeys.forEach((key) => {
        const diffs = collectConfirmedDiffs(
          key,
          entriesByDate,
          materialMap,
          activeLocations,
          transferDeltasByDate
        );
        applyExternalTransferTotalsToDiffs(diffs, externalTotalsByDate[key], materialMap);
        diffs.addedTotals.forEach((value, label) => {
          addedTotals.set(label, (addedTotals.get(label) ?? 0) + value);
        });
        diffs.removedTotals.forEach((value, label) => {
          removedTotals.set(label, (removedTotals.get(label) ?? 0) + value);
        });
      });
      const added = [...addedTotals.values()].reduce((sum, value) => sum + value, 0);
      const removed = [...removedTotals.values()].reduce((sum, value) => sum + value, 0);
      return { added, removed } satisfies MonthlyDelta;
    }
    case 'getMonthlyMaterialBreakdown': {
      const todayKey = getTodayKey();
      const date = parseDateKey(todayKey);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const fromKey = formatDate(monthStart);
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const rows = await fetchEntries(addDays(fromKey, -1), todayKey);
      const entriesByDate = buildEntriesByDate(rows);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const transferRows = await fetchTransfers(fromKey, todayKey);
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByDate = buildExternalTotalsByDate(
        transferRows,
        new Set(activeLocations.map((loc) => loc.id))
      );
      const dateKeys = buildDateKeys(fromKey, todayKey);
      const addedTotals = new Map<string, number>();
      const removedTotals = new Map<string, number>();
      dateKeys.forEach((key) => {
        const diffs = collectConfirmedDiffs(
          key,
          entriesByDate,
          materialMap,
          activeLocations,
          transferDeltasByDate
        );
        applyExternalTransferTotalsToDiffs(diffs, externalTotalsByDate[key], materialMap);
        diffs.addedTotals.forEach((value, label) => {
          addedTotals.set(label, (addedTotals.get(label) ?? 0) + value);
        });
        diffs.removedTotals.forEach((value, label) => {
          removedTotals.set(label, (removedTotals.get(label) ?? 0) + value);
        });
      });
      const added = [...addedTotals.entries()]
        .map(([label, total]) => ({ label, total }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total);
      const removed = [...removedTotals.entries()]
        .map(([label, total]) => ({ label, total }))
        .filter((item) => item.total > 0)
        .sort((a, b) => b.total - a.total);
      return { added, removed } satisfies MonthlyMaterialBreakdown;
    }
    case 'getDailyHistory': {
      const todayKey = getTodayKey();
      const fromKey = addDays(todayKey, -120);
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const { data: dateRows, error } = await supabaseAdmin
        .from('daily_entries')
        .select('date_key')
        .gte('date_key', fromKey)
        .lte('date_key', todayKey)
        .eq('confirmed', true);
      if (error) throw error;
      const dateKeys = Array.from(new Set((dateRows ?? []).map((row) => row.date_key))).sort(
        (a, b) => b.localeCompare(a)
      );
      if (dateKeys.length === 0) return [] satisfies DailyTotals[];
      const rows = await fetchEntries(addDays(fromKey, -1), todayKey);
      const entriesByDate = buildEntriesByDate(rows);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const transferRows = await fetchTransfers(fromKey, todayKey);
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByDate = buildExternalTotalsByDate(
        transferRows,
        new Set(activeLocations.map((loc) => loc.id))
      );
      return dateKeys.map((key) => {
        const diffs = collectConfirmedDiffs(
          key,
          entriesByDate,
          materialMap,
          activeLocations,
          transferDeltasByDate
        );
        applyExternalTransferTotalsToDiffs(diffs, externalTotalsByDate[key], materialMap);
        const added = [...diffs.addedTotals.values()].reduce((sum, value) => sum + value, 0);
        const removed = [...diffs.removedTotals.values()].reduce((sum, value) => sum + value, 0);
        return { date: key, added, removed, net: added - removed } satisfies DailyTotals;
      });
    }
    case 'getPeriodReport': {
      const rawFrom = String(payload?.from ?? '');
      const rawTo = String(payload?.to ?? '');
      if (!rawFrom || !rawTo) {
        return {
          from: rawFrom,
          to: rawTo,
          rows: [],
          totals: { added: 0, removed: 0, net: 0 }
        } satisfies PeriodReport;
      }
      const range = rawFrom <= rawTo ? { from: rawFrom, to: rawTo } : { from: rawTo, to: rawFrom };
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const rows = await fetchEntries(addDays(range.from, -1), range.to);
      const entriesByDate = buildEntriesByDate(rows);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const transferRows = await fetchTransfers(range.from, range.to);
      const activeLocationIds = new Set(activeLocations.map((loc) => loc.id));
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByDate = buildExternalTotalsByDate(transferRows, activeLocationIds);
      const transferExternalOutCommentsByDate = buildExternalOutCommentsByDate(
        transferRows,
        activeLocationIds
      );
      const dateKeys = buildDateKeys(range.from, range.to);
      const addedTotals = new Map<string, number>();
      const removedTotals = new Map<string, number>();
      const addedComments = new Map<string, string[]>();
      const removedComments = new Map<string, string[]>();
      dateKeys.forEach((key) => {
        const diffs = collectConfirmedDiffs(
          key,
          entriesByDate,
          materialMap,
          activeLocations,
          transferDeltasByDate
        );
        applyExternalTransferTotalsToDiffs(diffs, externalTotalsByDate[key], materialMap);
        diffs.addedTotals.forEach((value, label) => {
          addedTotals.set(label, (addedTotals.get(label) ?? 0) + value);
        });
        diffs.removedTotals.forEach((value, label) => {
          removedTotals.set(label, (removedTotals.get(label) ?? 0) + value);
        });
        diffs.addedComments.forEach((list, label) => {
          const existing = addedComments.get(label) ?? [];
          list.forEach((comment) => {
            if (!existing.includes(comment)) existing.push(comment);
          });
          addedComments.set(label, existing);
        });
        diffs.removedComments.forEach((list, label) => {
          const existing = removedComments.get(label) ?? [];
          list.forEach((comment) => {
            if (!existing.includes(comment)) existing.push(comment);
          });
          removedComments.set(label, existing);
        });
        const transferCommentsForDay = transferExternalOutCommentsByDate[key] ?? {};
        Object.entries(transferCommentsForDay).forEach(([materialId, comments]) => {
          const label = materialMap.get(materialId)?.name ?? 'Nieznany';
          const existing = removedComments.get(label) ?? [];
          comments.forEach((comment) => {
            if (!existing.includes(comment)) existing.push(comment);
          });
          removedComments.set(label, existing);
        });
      });
      const labels = new Set<string>([
        ...addedTotals.keys(),
        ...removedTotals.keys(),
        ...addedComments.keys(),
        ...removedComments.keys()
      ]);
      const reportRows: MaterialReportRow[] = [...labels]
        .map((label) => {
          const added = addedTotals.get(label) ?? 0;
          const removed = removedTotals.get(label) ?? 0;
          return {
            label,
            added,
            removed,
            net: added - removed,
            addedComments: addedComments.get(label) ?? [],
            removedComments: removedComments.get(label) ?? []
          };
        })
        .filter((row) => row.added > 0 || row.removed > 0 || row.addedComments?.length || row.removedComments?.length)
        .sort((a, b) => b.added + b.removed - (a.added + a.removed));
      const totals = {
        added: [...addedTotals.values()].reduce((sum, value) => sum + value, 0),
        removed: [...removedTotals.values()].reduce((sum, value) => sum + value, 0),
        net:
          [...addedTotals.values()].reduce((sum, value) => sum + value, 0) -
          [...removedTotals.values()].reduce((sum, value) => sum + value, 0)
      };
      return { from: range.from, to: range.to, rows: reportRows, totals } satisfies PeriodReport;
    }
    case 'getYearlyReport': {
      const rawFrom = String(payload?.from ?? '');
      const rawTo = String(payload?.to ?? '');
      if (!rawFrom || !rawTo) {
        return { year: 0, rows: [], totals: { added: 0, removed: 0, net: 0 } } satisfies YearlyReport;
      }
      const range = rawFrom <= rawTo ? { from: rawFrom, to: rawTo } : { from: rawTo, to: rawFrom };
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const rows = await fetchEntries(addDays(range.from, -1), range.to);
      const entriesByDate = buildEntriesByDate(rows);
      const materialMap = new Map(materials.map((mat) => [mat.id, mat]));
      const transferRows = await fetchTransfers(range.from, range.to);
      const transferDeltasByDate = buildTransferDeltasByDate(transferRows);
      const externalTotalsByDate = buildExternalTotalsByDate(
        transferRows,
        new Set(activeLocations.map((loc) => loc.id))
      );
      const dateKeys = buildDateKeys(range.from, range.to);
      const byMonth = new Map<string, { added: number; removed: number }>();
      dateKeys.forEach((key) => {
        const diffs = collectConfirmedDiffs(
          key,
          entriesByDate,
          materialMap,
          activeLocations,
          transferDeltasByDate
        );
        applyExternalTransferTotalsToDiffs(diffs, externalTotalsByDate[key], materialMap);
        const month = key.slice(0, 7);
        const current = byMonth.get(month) ?? { added: 0, removed: 0 };
        const added = [...diffs.addedTotals.values()].reduce((sum, value) => sum + value, 0);
        const removed = [...diffs.removedTotals.values()].reduce((sum, value) => sum + value, 0);
        current.added += added;
        current.removed += removed;
        byMonth.set(month, current);
      });
      const rowsOut: YearlyReportRow[] = [...byMonth.entries()]
        .map(([month, totals]) => ({
          month: month.slice(5),
          added: totals.added,
          removed: totals.removed,
          net: totals.added - totals.removed
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
      const totals = rowsOut.reduce(
        (acc, row) => ({
          added: acc.added + row.added,
          removed: acc.removed + row.removed,
          net: acc.net + row.net
        }),
        { added: 0, removed: 0, net: 0 }
      );
      const year = Number(range.from.slice(0, 4));
      return { year, rows: rowsOut, totals } satisfies YearlyReport;
    }
    case 'getCurrentMaterialTotals': {
      const scope = payload?.scope === 'all' ? 'all' : 'stats';
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const todayKey = getTodayKey();
      const yesterdayKey = addDays(todayKey, -1);
      const [todayEntriesRows, yesterdayEntriesRows] = await Promise.all([
        fetchEntries(todayKey),
        fetchEntries(yesterdayKey)
      ]);
      const todayEntries = buildEntriesByDate(todayEntriesRows)[todayKey] ?? {};
      const yesterdayEntries = buildEntriesByDate(yesterdayEntriesRows)[yesterdayKey] ?? {};
      const sourceLocations =
        scope === 'stats'
          ? getActiveStatsLocations(warehouses, locations)
          : locations.filter((loc) => loc.isActive);
      const totals = new Map<string, number>();
      sourceLocations.forEach((loc) => {
        const today = todayEntries[loc.id] ?? {};
        const yesterday = yesterdayEntries[loc.id] ?? {};
        const source = Object.keys(today).length > 0 ? today : yesterday;
        Object.entries(source).forEach(([materialId, entry]) => {
          const label = materials.find((mat) => mat.id === materialId)?.name ?? 'Nieznany';
          totals.set(label, (totals.get(label) ?? 0) + (entry?.qty ?? 0));
        });
      });
      materials
        .filter((mat) => mat.isActive)
        .forEach((mat) => {
          if (!totals.has(mat.name)) {
            totals.set(mat.name, 0);
          }
        });
      return [...totals.entries()]
        .map(([label, total]) => ({ label, total }))
        .sort((a, b) => b.total - a.total) satisfies MaterialTotal[];
    }
    case 'getMaterialLocations': {
      const [materials, locations, warehouses] = await Promise.all([
        fetchMaterials(),
        fetchLocations(),
        fetchWarehouses()
      ]);
      const todayKey = getTodayKey();
      const yesterdayKey = addDays(todayKey, -1);
      const [todayEntriesRows, yesterdayEntriesRows] = await Promise.all([
        fetchEntries(todayKey),
        fetchEntries(yesterdayKey)
      ]);
      const todayEntries = buildEntriesByDate(todayEntriesRows)[todayKey] ?? {};
      const yesterdayEntries = buildEntriesByDate(yesterdayEntriesRows)[yesterdayKey] ?? {};
      const result: MaterialLocationsMap = {};
      materials.forEach((mat) => {
        result[mat.id] = [];
      });
      locations
        .filter((loc) => loc.isActive)
        .forEach((loc) => {
          const today = todayEntries[loc.id] ?? {};
          const yesterday = yesterdayEntries[loc.id] ?? {};
          const source = Object.keys(today).length > 0 ? today : yesterday;
          Object.entries(source).forEach(([materialId, entry]) => {
            const qty = entry?.qty ?? 0;
            if (qty <= 0) return;
            const material = materials.find((mat) => mat.id === materialId);
            if (!material) return;
            const warehouseName =
              warehouses.find((warehouse) => warehouse.id === loc.warehouseId)?.name ??
              'Nieznany magazyn';
            if (!result[materialId]) {
              result[materialId] = [];
            }
            result[materialId].push({
              locationId: loc.id,
              locationName: loc.name,
              warehouseName,
              qty
            });
          });
        });
      Object.values(result).forEach((list) => {
        list.sort((a, b) => {
          const warehouseCompare = a.warehouseName.localeCompare(b.warehouseName, 'pl', {
            sensitivity: 'base'
          });
          if (warehouseCompare !== 0) return warehouseCompare;
          return a.locationName.localeCompare(b.locationName, 'pl', { sensitivity: 'base' });
        });
      });
      return result;
    }
    case 'getTopCatalogTotal': {
      const [materials, warehouses, locations] = await Promise.all([
        fetchMaterials(),
        fetchWarehouses(),
        fetchLocations()
      ]);
      const todayKey = getTodayKey();
      const yesterdayKey = addDays(todayKey, -1);
      const [todayEntriesRows, yesterdayEntriesRows] = await Promise.all([
        fetchEntries(todayKey),
        fetchEntries(yesterdayKey)
      ]);
      const todayEntries = buildEntriesByDate(todayEntriesRows)[todayKey] ?? {};
      const yesterdayEntries = buildEntriesByDate(yesterdayEntriesRows)[yesterdayKey] ?? {};
      const activeLocations = getActiveStatsLocations(warehouses, locations);
      const totals = new Map<string, number>();
      activeLocations.forEach((loc) => {
        const today = todayEntries[loc.id] ?? {};
        const yesterday = yesterdayEntries[loc.id] ?? {};
        const source = Object.keys(today).length > 0 ? today : yesterday;
        Object.entries(source).forEach(([materialId, entry]) => {
          const material = materials.find((mat) => mat.id === materialId);
          const catalog = material?.code ?? 'Brak kartoteki';
          totals.set(catalog, (totals.get(catalog) ?? 0) + (entry?.qty ?? 0));
        });
      });
      let top: CatalogTotal = { catalog: 'Brak danych', total: 0 };
      totals.forEach((total, catalog) => {
        if (total > top.total) {
          top = { catalog, total };
        }
      });
      return top;
    }
    case 'addCatalog': {
      const name = String(payload?.name ?? '').trim();
      if (!name) throw new Error('NAME_REQUIRED');
      const { data: existing, error } = await supabaseAdmin
        .from('material_catalogs')
        .select('id')
        .ilike('name', name);
      if (error) throw error;
      if (existing && existing.length > 0) throw new Error('DUPLICATE');
      const catalog: MaterialCatalog = {
        id: `cat-${Date.now()}`,
        name,
        isActive: true
      };
      const { error: insertError } = await supabaseAdmin
        .from('material_catalogs')
        .insert({ id: catalog.id, name: catalog.name, is_active: true });
      if (insertError) throw insertError;
      return catalog;
    }
    case 'addMaterialCatalogBulk': {
      const items: Array<{ name?: string }> = Array.isArray(payload?.items) ? payload.items : [];
      if (items.length === 0) throw new Error('EMPTY');

      const normalized: Array<{ name: string }> = [];
      const seen = new Set<string>();
      items.forEach((item: { name?: string }) => {
        const name = String(item?.name ?? '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push({ name });
      });

      if (normalized.length === 0) throw new Error('EMPTY');

      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from('material_catalogs')
        .select('name');
      if (existingError) throw existingError;
      const existingSet = new Set(
        (existingRows ?? []).map((row: any) => String(row.name ?? '').trim().toLowerCase())
      );
      const toInsert = normalized.filter(
        (item: { name: string }) => !existingSet.has(item.name.toLowerCase())
      );
      if (toInsert.length === 0) {
        return { total: normalized.length, inserted: 0, skipped: normalized.length };
      }

      let inserted = 0;
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize).map((item: { name: string }) => ({
          id: `cat-${randomUUID()}`,
          name: item.name,
          is_active: true
        }));
        const { error: insertError } = await supabaseAdmin
          .from('material_catalogs')
          .insert(chunk);
        if (insertError) throw insertError;
        inserted += chunk.length;
      }

      return {
        total: normalized.length,
        inserted,
        skipped: normalized.length - inserted
      };
    }
    case 'addMaterial': {
      const name = String(payload?.name ?? '').trim();
      if (!name) throw new Error('INVALID_NAME');
      let catalogId = payload?.catalogId ? String(payload.catalogId).trim() : '';
      let catalogName = '';
      if (catalogId) {
        const { data: catalogRow, error } = await supabaseAdmin
          .from('material_catalogs')
          .select('*')
          .eq('id', catalogId)
          .maybeSingle();
        if (error) throw error;
        if (!catalogRow || !catalogRow.is_active) throw new Error('CATALOG_REQUIRED');
        catalogName = String(catalogRow.name ?? '').trim();
      } else {
        const rawCatalogName = String(payload?.catalogName ?? payload?.code ?? '').trim();
        if (rawCatalogName) {
          const { data: existingCatalog, error } = await supabaseAdmin
            .from('material_catalogs')
            .select('*')
            .ilike('name', rawCatalogName)
            .maybeSingle();
          if (error) throw error;
          if (existingCatalog) {
            catalogId = existingCatalog.id;
            catalogName = String(existingCatalog.name ?? '').trim();
          } else {
            const newCatalogId = `cat-${Date.now()}`;
            const { error: insertCatalogError } = await supabaseAdmin
              .from('material_catalogs')
              .insert({ id: newCatalogId, name: rawCatalogName, is_active: true });
            if (insertCatalogError) throw insertCatalogError;
            catalogId = newCatalogId;
            catalogName = rawCatalogName;
          }
        }
      }

      let duplicateQuery = supabaseAdmin
        .from('materials')
        .select('id')
        .ilike('name', name);
      duplicateQuery = catalogId
        ? duplicateQuery.eq('catalog_id', catalogId)
        : duplicateQuery.is('catalog_id', null);
      const { data: existingMaterial, error: existingError } = await duplicateQuery;
      if (existingError) throw existingError;
      if (existingMaterial && existingMaterial.length > 0) throw new Error('DUPLICATE');

      const material: Material = {
        id: `mat-${Date.now()}`,
        code: catalogName || 'Brak kartoteki',
        name,
        catalogId: catalogId || null,
        catalogName: catalogName || null,
        isActive: true
      };
      const { error: insertError } = await supabaseAdmin.from('materials').insert({
        id: material.id,
        code: catalogName,
        name: material.name,
        catalog_id: catalogId || null,
        is_active: true
      });
      if (insertError) throw insertError;
      return material;
    }
    case 'addMaterialBulk': {
      const items: Array<{ name?: string; catalogName?: string; code?: string }> =
        Array.isArray(payload?.items) ? payload.items : [];
      if (items.length === 0) throw new Error('EMPTY');

      const normalized: Array<{ name: string; catalogName: string }> = [];
      const seen = new Set<string>();
      items.forEach((item: { name?: string; catalogName?: string; code?: string }) => {
        const name = String(item?.name ?? '').trim();
        if (!name) return;
        const catalogName = String(item?.catalogName ?? item?.code ?? '').trim();
        const key = `${name.toLowerCase()}|${catalogName.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push({ name, catalogName });
      });

      if (normalized.length === 0) throw new Error('EMPTY');

      const { data: catalogsRows, error: catalogsError } = await supabaseAdmin
        .from('material_catalogs')
        .select('id, name, is_active');
      if (catalogsError) throw catalogsError;
      const catalogMap = new Map<
        string,
        { id: string; name: string; isActive: boolean }
      >(
        (catalogsRows ?? []).map((row: any) => [
          String(row.name ?? '').trim().toLowerCase(),
          { id: row.id, name: row.name, isActive: row.is_active ?? true }
        ])
      );

      const catalogNames = Array.from(
        new Set(
          normalized
            .map((item: { catalogName: string }) => item.catalogName)
            .filter((name) => name)
            .map((name) => name.trim())
        )
      );

      const missingCatalogs = catalogNames.filter(
        (name: string) => !catalogMap.has(name.toLowerCase())
      );
      if (missingCatalogs.length > 0) {
        const now = new Date().toISOString();
        const inserts = missingCatalogs.map((name) => ({
          id: `cat-${randomUUID()}`,
          name,
          is_active: true,
          created_at: now
        }));
        const { error: insertCatalogError } = await supabaseAdmin
          .from('material_catalogs')
          .insert(inserts);
        if (insertCatalogError) throw insertCatalogError;
        inserts.forEach((row) => {
          catalogMap.set(row.name.toLowerCase(), {
            id: row.id,
            name: row.name,
            isActive: true
          });
        });
      }

      const inactiveCatalogs = catalogNames
        .map((name: string) => catalogMap.get(name.toLowerCase()))
        .filter((row): row is { id: string; name: string; isActive: boolean } =>
          Boolean(row && !row.isActive)
        );
      if (inactiveCatalogs.length > 0) {
        const ids = inactiveCatalogs.map((row) => row.id);
        await supabaseAdmin.from('material_catalogs').update({ is_active: true }).in('id', ids);
        inactiveCatalogs.forEach((row) => {
          catalogMap.set(row.name.toLowerCase(), { ...row, isActive: true });
        });
      }

      const { data: existingMaterials, error: existingError } = await supabaseAdmin
        .from('materials')
        .select('id, name, catalog_id');
      if (existingError) throw existingError;
      const existingSet = new Set(
        (existingMaterials ?? []).map((row: any) => {
          const name = String(row.name ?? '').trim().toLowerCase();
          const catalogId = String(row.catalog_id ?? '');
          return `${name}|${catalogId}`;
        })
      );

      const toInsert = normalized
        .map((item) => {
          const catalogEntry = item.catalogName
            ? catalogMap.get(item.catalogName.toLowerCase()) ?? null
            : null;
          const catalogId = catalogEntry?.id ?? null;
          const code = catalogEntry?.name ?? item.catalogName ?? '';
          const key = `${item.name.toLowerCase()}|${catalogId ?? ''}`;
          if (existingSet.has(key)) return null;
          existingSet.add(key);
          return {
            id: `mat-${randomUUID()}`,
            name: item.name,
            code,
            catalog_id: catalogId,
            is_active: true
          };
        })
        .filter(Boolean) as Array<{
        id: string;
        name: string;
        code: string;
        catalog_id: string | null;
        is_active: boolean;
      }>;

      if (toInsert.length === 0) {
        return { total: normalized.length, inserted: 0, skipped: normalized.length };
      }

      let inserted = 0;
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error: insertError } = await supabaseAdmin.from('materials').insert(chunk);
        if (insertError) throw insertError;
        inserted += chunk.length;
      }

      return {
        total: normalized.length,
        inserted,
        skipped: normalized.length - inserted
      };
    }
    case 'removeMaterial': {
      const materialId = String(payload?.materialId ?? payload?.id ?? '');
      if (!materialId) throw new Error('NOT_FOUND');
      const { data, error } = await supabaseAdmin
        .from('materials')
        .update({ is_active: false })
        .eq('id', materialId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return;
    }
    case 'updateMaterialCatalog': {
      const materialId = String(payload?.materialId ?? '').trim();
      if (!materialId) throw new Error('NOT_FOUND');
      const catalogId = payload?.catalogId ? String(payload.catalogId).trim() : '';
      let catalogName = '';
      if (catalogId) {
        const { data: catalogRow, error } = await supabaseAdmin
          .from('material_catalogs')
          .select('*')
          .eq('id', catalogId)
          .maybeSingle();
        if (error) throw error;
        if (!catalogRow || !catalogRow.is_active) throw new Error('CATALOG_REQUIRED');
        catalogName = String(catalogRow.name ?? '').trim();
      }
      const { data, error } = await supabaseAdmin
        .from('materials')
        .update({ catalog_id: catalogId || null, code: catalogName })
        .eq('id', materialId)
        .select('*, material_catalogs(name)')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapMaterial(data);
    }
    case 'updateMaterial': {
      const materialId = String(payload?.materialId ?? payload?.id ?? '').trim();
      if (!materialId) throw new Error('NOT_FOUND');

      const { data: current, error: currentError } = await supabaseAdmin
        .from('materials')
        .select('id, name, catalog_id')
        .eq('id', materialId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw new Error('NOT_FOUND');

      const updates: Record<string, unknown> = {};
      let nextName = String(current.name ?? '').trim();

      if (typeof payload?.name === 'string') {
        const trimmedName = payload.name.trim();
        if (!trimmedName) throw new Error('INVALID_NAME');
        nextName = trimmedName;
        updates.name = trimmedName;
      }

      let catalogIdProvided = false;
      let nextCatalogId: string | null = current.catalog_id ?? null;
      let catalogName = '';
      if (Object.prototype.hasOwnProperty.call(payload ?? {}, 'catalogId')) {
        catalogIdProvided = true;
        const rawCatalogId = payload?.catalogId ? String(payload.catalogId).trim() : '';
        if (rawCatalogId) {
          const { data: catalogRow, error: catalogError } = await supabaseAdmin
            .from('material_catalogs')
            .select('*')
            .eq('id', rawCatalogId)
            .maybeSingle();
          if (catalogError) throw catalogError;
          if (!catalogRow || !catalogRow.is_active) throw new Error('CATALOG_REQUIRED');
          nextCatalogId = catalogRow.id;
          catalogName = String(catalogRow.name ?? '').trim();
        } else {
          nextCatalogId = null;
          catalogName = '';
        }
        updates.catalog_id = nextCatalogId;
        updates.code = catalogName;
      }

      if (catalogIdProvided || typeof payload?.name === 'string') {
        let duplicateQuery = supabaseAdmin
          .from('materials')
          .select('id')
          .ilike('name', nextName)
          .neq('id', materialId);
        duplicateQuery = nextCatalogId
          ? duplicateQuery.eq('catalog_id', nextCatalogId)
          : duplicateQuery.is('catalog_id', null);
        const { data: existing, error: existingError } = await duplicateQuery;
        if (existingError) throw existingError;
        if (existing && existing.length > 0) throw new Error('DUPLICATE');
      }

      if (Object.keys(updates).length === 0) {
        const { data, error } = await supabaseAdmin
          .from('materials')
          .select('*, material_catalogs(name)')
          .eq('id', materialId)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('NOT_FOUND');
        return mapMaterial(data);
      }

      const { data, error } = await supabaseAdmin
        .from('materials')
        .update(updates)
        .eq('id', materialId)
        .select('*, material_catalogs(name)')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapMaterial(data);
    }
    case 'removeCatalog': {
      const catalogId = String(payload?.catalogId ?? '').trim();
      if (!catalogId) throw new Error('NOT_FOUND');
      const force = payload?.force === true;
      const { data: assigned, error: assignedError } = await supabaseAdmin
        .from('materials')
        .select('id')
        .eq('catalog_id', catalogId)
        .limit(1);
      if (assignedError) throw assignedError;
      if (assigned && assigned.length > 0) {
        if (!force) throw new Error('IN_USE');
        const { error: deactivateError } = await supabaseAdmin
          .from('materials')
          .update({ is_active: false })
          .eq('catalog_id', catalogId);
        if (deactivateError) throw deactivateError;
      }
      const { data, error } = await supabaseAdmin
        .from('material_catalogs')
        .update({ is_active: false })
        .eq('id', catalogId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapMaterialCatalog(data);
    }
    case 'addWarehouse': {
      const name = String(payload?.name ?? '').trim();
      if (!name) throw new Error('INVALID_NAME');
      const warehouses = await fetchWarehouses();
      const exists = warehouses.some(
        (item) => item.isActive && item.name.toLowerCase() === name.toLowerCase()
      );
      if (exists) throw new Error('DUPLICATE');
      const nextOrder =
        typeof payload?.orderNo === 'number' && !Number.isNaN(payload.orderNo)
          ? payload.orderNo
          : Math.max(0, ...warehouses.map((item) => item.orderNo)) + 1;
      const warehouse: Warehouse = {
        id: `wh-${Date.now()}`,
        name,
        orderNo: nextOrder,
        includeInSpis: payload?.includeInSpis ?? true,
        includeInStats: payload?.includeInStats ?? true,
        isActive: true
      };
      const { error } = await supabaseAdmin.from('warehouses').insert({
        id: warehouse.id,
        name: warehouse.name,
        order_no: warehouse.orderNo,
        include_in_spis: warehouse.includeInSpis,
        include_in_stats: warehouse.includeInStats,
        is_active: true
      });
      if (error) throw error;
      return warehouse;
    }
    case 'updateWarehouse': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const updates: Record<string, unknown> = {};
      if (typeof payload?.name === 'string') {
        const trimmed = payload.name.trim();
        if (!trimmed) throw new Error('INVALID_NAME');
        updates.name = trimmed;
      }
      if (typeof payload?.orderNo === 'number' && !Number.isNaN(payload.orderNo)) {
        updates.order_no = payload.orderNo;
      }
      if (typeof payload?.includeInSpis === 'boolean') {
        updates.include_in_spis = payload.includeInSpis;
      }
      if (typeof payload?.includeInStats === 'boolean') {
        updates.include_in_stats = payload.includeInStats;
      }
      if (Object.keys(updates).length === 0) {
        const { data, error } = await supabaseAdmin
          .from('warehouses')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('NOT_FOUND');
        return mapWarehouse(data);
      }
      const { data, error } = await supabaseAdmin
        .from('warehouses')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouse(data);
    }
    case 'removeWarehouse': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const { data, error } = await supabaseAdmin
        .from('warehouses')
        .update({ is_active: false })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      await supabaseAdmin.from('locations').update({ is_active: false }).eq('warehouse_id', id);
      return mapWarehouse(data);
    }
    case 'addLocation': {
      const warehouseId = String(payload?.warehouseId ?? '');
      const type = payload?.type === 'pole' ? 'pole' : 'wtr';
      const name = String(payload?.name ?? '');
      if (!warehouseId) throw new Error('WAREHOUSE_MISSING');
      const warehouses = await fetchWarehouses();
      const warehouse = warehouses.find((item) => item.id === warehouseId && item.isActive);
      if (!warehouse) throw new Error('WAREHOUSE_MISSING');
      const normalizedName = normalizeLocationName(name, type);
      if (!normalizedName) throw new Error('INVALID_NAME');
      const locations = await fetchLocations();
      const exists = locations.some(
        (item) =>
          item.isActive &&
          item.warehouseId === warehouseId &&
          item.name.toLowerCase() === normalizedName.toLowerCase()
      );
      if (exists) throw new Error('DUPLICATE');
      const nextOrder =
        typeof payload?.orderNo === 'number' && !Number.isNaN(payload.orderNo)
          ? payload.orderNo
          : Math.max(
              0,
              ...locations
                .filter((item) => item.warehouseId === warehouseId)
                .map((item) => item.orderNo)
            ) + 1;
      const location: Location = {
        id: `loc-${Date.now()}`,
        warehouseId,
        name: normalizedName,
        orderNo: nextOrder,
        type,
        isActive: true
      };
      const { error } = await supabaseAdmin.from('locations').insert({
        id: location.id,
        warehouse_id: warehouseId,
        name: location.name,
        order_no: location.orderNo,
        type: location.type,
        is_active: true
      });
      if (error) throw error;
      return location;
    }
    case 'updateLocation': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('locations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new Error('NOT_FOUND');
      const updates: Record<string, unknown> = {};
      if (typeof payload?.name === 'string') {
        const normalizedName = normalizeLocationName(payload.name, existing.type);
        if (!normalizedName) throw new Error('INVALID_NAME');
        updates.name = normalizedName;
      }
      if (typeof payload?.orderNo === 'number' && !Number.isNaN(payload.orderNo)) {
        updates.order_no = payload.orderNo;
      }
      const { data, error } = await supabaseAdmin
        .from('locations')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapLocation(data);
    }
    case 'removeLocation': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const { data, error } = await supabaseAdmin
        .from('locations')
        .update({ is_active: false })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapLocation(data);
    }
    case 'getAudit': {
      const retentionCutoff = new Date();
      retentionCutoff.setMonth(retentionCutoff.getMonth() - 2);
      const retentionCutoffIso = retentionCutoff.toISOString();

      const { error: purgeError } = await supabaseAdmin
        .from('audit_logs')
        .delete()
        .lt('at', retentionCutoffIso);
      if (purgeError) throw purgeError;

      const { data, error } = await supabaseAdmin
        .from('audit_logs')
        .select('*')
        .gte('at', retentionCutoffIso)
        .order('at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapAuditEvent);
    }
    case 'getLocations': {
      const [warehouses, locations] = await Promise.all([fetchWarehouses(), fetchLocations()]);
      const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
      return locations
        .filter((loc) => loc.isActive)
        .map((loc) => ({
          id: loc.id,
          warehouseId: loc.warehouseId,
          warehouseName: warehouseMap.get(loc.warehouseId)?.name ?? 'Nieznany magazyn',
          name: loc.name,
          orderNo: loc.orderNo,
          type: loc.type
        }))
        .sort((a, b) => {
          const warehouseOrder =
            (warehouseMap.get(a.warehouseId)?.orderNo ?? 0) -
            (warehouseMap.get(b.warehouseId)?.orderNo ?? 0);
          if (warehouseOrder !== 0) return warehouseOrder;
          return a.orderNo - b.orderNo;
        }) satisfies LocationOption[];
    }
    case 'getLocationsAdmin': {
      const [warehouses, locations] = await Promise.all([fetchWarehouses(), fetchLocations()]);
      const warehouseOrderMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.orderNo]));
      return [...locations].sort((a, b) => {
        const warehouseOrder =
          (warehouseOrderMap.get(a.warehouseId) ?? 0) -
          (warehouseOrderMap.get(b.warehouseId) ?? 0);
        if (warehouseOrder !== 0) return warehouseOrder;
        return a.orderNo - b.orderNo;
      });
    }
    case 'getWarehouseTransferDocuments': {
      return fetchWarehouseTransferDocumentSummaries();
    }
    case 'getWarehouseTransferDocument': {
      const documentId = String(payload?.documentId ?? '').trim();
      if (!documentId) throw new Error('NOT_FOUND');
      return fetchWarehouseTransferDocumentDetails(documentId);
    }
    case 'createWarehouseTransferDocument': {
      const documentNumber = String(payload?.documentNumber ?? '').trim();
      if (!documentNumber) throw new Error('DOCUMENT_NUMBER_REQUIRED');
      const rawItems: Array<{
        lineNo?: number;
        priority?: WarehouseTransferItemPriority;
        indexCode?: string;
        indexCode2?: string;
        name?: string;
        batch?: string;
        location?: string;
        unit?: string;
        plannedQty?: number;
        note?: string;
      }> = Array.isArray(payload?.items) ? payload.items : [];
      if (rawItems.length === 0) throw new Error('ITEMS_REQUIRED');

      const normalizedItems = rawItems.map((item, index) => {
        const lineNoCandidate = toNumber(item?.lineNo ?? index + 1);
        const lineNo =
          Number.isFinite(lineNoCandidate) && lineNoCandidate > 0
            ? Math.round(lineNoCandidate)
            : index + 1;
        const indexCode = String(item?.indexCode ?? '').trim();
        const name = String(item?.name ?? '').trim();
        const plannedQty = toNumber(item?.plannedQty);
        if (!indexCode || !name) throw new Error('INVALID_ITEM');
        if (!Number.isFinite(plannedQty) || plannedQty <= 0) throw new Error('INVALID_QTY');
        return {
          id: randomUUID(),
          document_id: '',
          line_no: lineNo,
          priority: normalizeWarehouseTransferItemPriority(item?.priority),
          index_code: indexCode,
          index_code2: item?.indexCode2 ? String(item.indexCode2).trim() || null : null,
          name,
          batch: item?.batch ? String(item.batch).trim() || null : null,
          location: item?.location ? String(item.location).trim() || null : null,
          unit: item?.unit ? String(item.unit).trim() || 'kg' : 'kg',
          planned_qty: plannedQty,
          note: item?.note ? String(item.note).trim() || null : null,
          created_at: new Date().toISOString()
        };
      });

      const nowIso = new Date().toISOString();
      const documentId = randomUUID();
      const documentPayload = {
        id: documentId,
        created_at: nowIso,
        created_by_id: currentUser.id ?? null,
        created_by_name: getActorName(currentUser),
        document_number: documentNumber,
        source_warehouse: payload?.sourceWarehouse
          ? String(payload.sourceWarehouse).trim() || null
          : null,
        target_warehouse: payload?.targetWarehouse
          ? String(payload.targetWarehouse).trim() || null
          : null,
        note: payload?.note ? String(payload.note).trim() || null : null,
        status: 'OPEN',
        closed_at: null,
        closed_by_name: null
      };

      const { error: insertDocumentError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .insert(documentPayload);
      if (insertDocumentError) throw insertDocumentError;

      const itemsPayload = normalizedItems.map((item) => ({
        ...item,
        document_id: documentId
      }));
      const { error: insertItemsError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .insert(itemsPayload);
      if (insertItemsError) {
        await supabaseAdmin.from('warehouse_transfer_documents').delete().eq('id', documentId);
        const insertErrorCode = String(insertItemsError.code ?? '');
        const insertErrorMessage = String(insertItemsError.message ?? '').toLowerCase();
        if (
          insertErrorCode === '42703' ||
          insertErrorCode === 'PGRST204' ||
          (insertErrorMessage.includes('priority') && insertErrorMessage.includes('column'))
        ) {
          throw new Error('MIGRATION_REQUIRED_PRIORITY');
        }
        throw insertItemsError;
      }

      const createdDocument = await fetchWarehouseTransferDocumentDetails(documentId);
      void sendWarehouseTransferDocumentCreatedPush({
        documentId: createdDocument.document.id,
        documentNumber: createdDocument.document.documentNumber,
        sourceWarehouse: createdDocument.document.sourceWarehouse,
        targetWarehouse: createdDocument.document.targetWarehouse,
        createdById: createdDocument.document.createdById ?? null
      });
      return createdDocument;
    }
    case 'markWarehouseTransferDocumentIssued': {
      const documentId = String(payload?.documentId ?? '').trim();
      if (!documentId) throw new Error('NOT_FOUND');

      const { data: existing, error: existingError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('*')
        .eq('id', documentId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new Error('NOT_FOUND');
      if (existing.status === 'ISSUED') {
        return mapWarehouseTransferDocument(existing);
      }
      if (existing.status === 'CLOSED') {
        throw new Error('DOCUMENT_CLOSED');
      }

      const { data: itemRows, error: itemsError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .select('id')
        .eq('document_id', documentId);
      if (itemsError) throw itemsError;
      const items = (itemRows ?? []) as Array<{ id: string }>;
      if (items.length === 0) throw new Error('ITEMS_REQUIRED');

      const issues = await fetchWarehouseTransferIssuesByItemIds(items.map((item) => item.id));
      const issuedByItem = new Map<string, number>();
      issues.forEach((issue) => {
        issuedByItem.set(issue.itemId, (issuedByItem.get(issue.itemId) ?? 0) + issue.qty);
      });

      const hasZeroIssuedItem = items.some((item) => {
        const issuedQty = issuedByItem.get(item.id) ?? 0;
        return issuedQty <= 0.000001;
      });
      if (hasZeroIssuedItem) {
        throw new Error('DOCUMENT_HAS_ZERO_ISSUE');
      }

      const { data, error } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .update({
          status: 'ISSUED',
          closed_at: null,
          closed_by_name: null
        })
        .eq('id', documentId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouseTransferDocument(data);
    }
    case 'addWarehouseTransferItemIssue': {
      const documentId = String(payload?.documentId ?? '').trim();
      const itemId = String(payload?.itemId ?? '').trim();
      const qty = toNumber(payload?.qty);
      if (!documentId || !itemId) throw new Error('NOT_FOUND');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('INVALID_QTY');

      const { data: documentRow, error: documentError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('id, status')
        .eq('id', documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!documentRow) throw new Error('NOT_FOUND');
      if (documentRow.status === 'CLOSED') throw new Error('DOCUMENT_CLOSED');
      if (documentRow.status !== 'OPEN') throw new Error('DOCUMENT_ALREADY_ISSUED');

      const { data: itemRow, error: itemError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .select('id, document_id')
        .eq('id', itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!itemRow || itemRow.document_id !== documentId) throw new Error('NOT_FOUND');

      const { data, error } = await supabaseAdmin
        .from('warehouse_transfer_item_issues')
        .insert({
          id: randomUUID(),
          item_id: itemId,
          created_at: new Date().toISOString(),
          issuer_id: currentUser.id ?? null,
          issuer_name: getActorName(currentUser),
          qty,
          note: payload?.note ? String(payload.note).trim() || null : null
        })
        .select('*')
        .maybeSingle();
      if (error) {
        if (error.code === '42P01') throw new Error('MIGRATION_REQUIRED');
        throw error;
      }
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouseTransferItemIssue(data);
    }
    case 'updateWarehouseTransferItemIssue': {
      const documentId = String(payload?.documentId ?? '').trim();
      const itemId = String(payload?.itemId ?? '').trim();
      const issueId = String(payload?.issueId ?? '').trim();
      const qty = toNumber(payload?.qty);
      if (!documentId || !itemId || !issueId) throw new Error('NOT_FOUND');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('INVALID_QTY');

      const { data: documentRow, error: documentError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('id, status')
        .eq('id', documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!documentRow) throw new Error('NOT_FOUND');
      if (documentRow.status === 'CLOSED') throw new Error('DOCUMENT_CLOSED');
      if (documentRow.status !== 'OPEN') throw new Error('DOCUMENT_ALREADY_ISSUED');

      const { data: itemRow, error: itemError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .select('id, document_id')
        .eq('id', itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!itemRow || itemRow.document_id !== documentId) throw new Error('NOT_FOUND');

      const { data: issueRow, error: issueError } = await supabaseAdmin
        .from('warehouse_transfer_item_issues')
        .select('*')
        .eq('id', issueId)
        .maybeSingle();
      if (issueError) {
        if (issueError.code === '42P01') throw new Error('MIGRATION_REQUIRED');
        throw issueError;
      }
      if (!issueRow || issueRow.item_id !== itemId) throw new Error('NOT_FOUND');

      const { data: issueRows, error: issueRowsError } = await supabaseAdmin
        .from('warehouse_transfer_item_issues')
        .select('id, qty')
        .eq('item_id', itemId);
      if (issueRowsError) {
        if (issueRowsError.code === '42P01') throw new Error('MIGRATION_REQUIRED');
        throw issueRowsError;
      }

      const { data: receiptRows, error: receiptRowsError } = await supabaseAdmin
        .from('warehouse_transfer_item_receipts')
        .select('qty')
        .eq('item_id', itemId);
      if (receiptRowsError) throw receiptRowsError;

      const issuedExcludingEdited = (issueRows ?? []).reduce((sum, row) => {
        if (String(row?.id ?? '') === issueId) return sum;
        return sum + toNumber(row?.qty);
      }, 0);
      const receivedQty = (receiptRows ?? []).reduce(
        (sum, row) => sum + toNumber(row?.qty),
        0
      );
      const nextIssuedQty = issuedExcludingEdited + qty;
      if (nextIssuedQty + 0.000001 < receivedQty) {
        throw new Error('ISSUE_BELOW_RECEIVED');
      }

      const { data, error } = await supabaseAdmin
        .from('warehouse_transfer_item_issues')
        .update({
          qty,
          note: payload?.note !== undefined ? String(payload.note).trim() || null : issueRow.note
        })
        .eq('id', issueId)
        .select('*')
        .maybeSingle();
      if (error) {
        if (error.code === '42P01') throw new Error('MIGRATION_REQUIRED');
        throw error;
      }
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouseTransferItemIssue(data);
    }
    case 'addWarehouseTransferItemReceipt': {
      const documentId = String(payload?.documentId ?? '').trim();
      const itemId = String(payload?.itemId ?? '').trim();
      const qty = toNumber(payload?.qty);
      if (!documentId || !itemId) throw new Error('NOT_FOUND');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('INVALID_QTY');

      const { data: documentRow, error: documentError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('id, status')
        .eq('id', documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!documentRow) throw new Error('NOT_FOUND');
      if (documentRow.status === 'CLOSED') throw new Error('DOCUMENT_CLOSED');
      if (documentRow.status !== 'ISSUED') throw new Error('DOCUMENT_NOT_ISSUED');

      const { data: itemRow, error: itemError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .select('id, document_id')
        .eq('id', itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!itemRow || itemRow.document_id !== documentId) throw new Error('NOT_FOUND');

      const { data, error } = await supabaseAdmin
        .from('warehouse_transfer_item_receipts')
        .insert({
          id: randomUUID(),
          item_id: itemId,
          created_at: new Date().toISOString(),
          receiver_id: currentUser.id ?? null,
          receiver_name: getActorName(currentUser),
          qty,
          note: payload?.note ? String(payload.note).trim() || null : null
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouseTransferItemReceipt(data);
    }
    case 'updateWarehouseTransferItemReceipt': {
      const documentId = String(payload?.documentId ?? '').trim();
      const itemId = String(payload?.itemId ?? '').trim();
      const receiptId = String(payload?.receiptId ?? '').trim();
      const qty = toNumber(payload?.qty);
      if (!documentId || !itemId || !receiptId) throw new Error('NOT_FOUND');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('INVALID_QTY');

      const { data: documentRow, error: documentError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('id, status')
        .eq('id', documentId)
        .maybeSingle();
      if (documentError) throw documentError;
      if (!documentRow) throw new Error('NOT_FOUND');
      if (documentRow.status === 'CLOSED') throw new Error('DOCUMENT_CLOSED');
      if (documentRow.status !== 'ISSUED') throw new Error('DOCUMENT_NOT_ISSUED');

      const { data: itemRow, error: itemError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .select('id, document_id')
        .eq('id', itemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!itemRow || itemRow.document_id !== documentId) throw new Error('NOT_FOUND');

      const { data: receiptRow, error: receiptError } = await supabaseAdmin
        .from('warehouse_transfer_item_receipts')
        .select('*')
        .eq('id', receiptId)
        .maybeSingle();
      if (receiptError) throw receiptError;
      if (!receiptRow || receiptRow.item_id !== itemId) throw new Error('NOT_FOUND');

      const actorName = getActorName(currentUser);
      const isAdmin = isWarehouseAdmin(currentUser, 'PRZESUNIECIA_ERP');
      const isOwnerById =
        Boolean(currentUser.id) &&
        Boolean(receiptRow.receiver_id) &&
        String(receiptRow.receiver_id) === String(currentUser.id);
      const isOwnerByName =
        !receiptRow.receiver_id &&
        Boolean(receiptRow.receiver_name) &&
        String(receiptRow.receiver_name) === actorName;
      if (!isAdmin && !isOwnerById && !isOwnerByName) {
        throw new Error('FORBIDDEN');
      }

      const { data, error } = await supabaseAdmin
        .from('warehouse_transfer_item_receipts')
        .update({
          qty,
          note:
            payload?.note !== undefined
              ? String(payload.note).trim() || null
              : receiptRow.note
        })
        .eq('id', receiptId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouseTransferItemReceipt(data);
    }
    case 'closeWarehouseTransferDocument': {
      const documentId = String(payload?.documentId ?? '').trim();
      if (!documentId) throw new Error('NOT_FOUND');
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('*')
        .eq('id', documentId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new Error('NOT_FOUND');
      if (existing.status === 'CLOSED') {
        return mapWarehouseTransferDocument(existing);
      }
      if (existing.status !== 'ISSUED') {
        throw new Error('DOCUMENT_NOT_ISSUED');
      }

      const updates: Record<string, unknown> = {
        status: 'CLOSED',
        closed_at: new Date().toISOString(),
        closed_by_name: getActorName(currentUser)
      };
      if (payload?.note !== undefined) {
        updates.note = payload.note ? String(payload.note).trim() || null : null;
      }

      const { data, error } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .update(updates)
        .eq('id', documentId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapWarehouseTransferDocument(data);
    }
    case 'removeWarehouseTransferDocument': {
      const documentId = String(payload?.documentId ?? '').trim();
      if (!documentId) throw new Error('NOT_FOUND');

      const { data: existing, error: existingError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .select('id')
        .eq('id', documentId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new Error('NOT_FOUND');

      const { data: itemRows, error: itemsError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .select('id')
        .eq('document_id', documentId);
      if (itemsError) throw itemsError;

      const itemIds = (itemRows ?? []).map((row) => String(row.id));
      const chunkSize = 500;
      for (let i = 0; i < itemIds.length; i += chunkSize) {
        const chunk = itemIds.slice(i, i + chunkSize);
        const { error: issuesError } = await supabaseAdmin
          .from('warehouse_transfer_item_issues')
          .delete()
          .in('item_id', chunk);
        if (issuesError && issuesError.code !== '42P01') throw issuesError;
        const { error: receiptsError } = await supabaseAdmin
          .from('warehouse_transfer_item_receipts')
          .delete()
          .in('item_id', chunk);
        if (receiptsError) throw receiptsError;
      }

      const { error: deleteItemsError } = await supabaseAdmin
        .from('warehouse_transfer_document_items')
        .delete()
        .eq('document_id', documentId);
      if (deleteItemsError) throw deleteItemsError;

      const { error: deleteDocumentError } = await supabaseAdmin
        .from('warehouse_transfer_documents')
        .delete()
        .eq('id', documentId);
      if (deleteDocumentError) throw deleteDocumentError;

      return;
    }
    case 'getTransfers': {
      const dateKey = payload?.dateKey ? String(payload.dateKey) : null;
      let query = supabaseAdmin.from('transfers').select('*');
      if (dateKey) {
        const start = `${dateKey}T00:00:00.000Z`;
        const end = `${addDays(dateKey, 1)}T00:00:00.000Z`;
        query = query.gte('at', start).lt('at', end);
      }
      const { data, error } = await query.order('at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapTransfer);
    }
    case 'addTransfer': {
      const kind = String(payload?.kind ?? '') as TransferKind;
      const materialId = String(payload?.materialId ?? '');
      const qty = toNumber(payload?.qty);
      const fromLocationId = payload?.fromLocationId ? String(payload.fromLocationId) : undefined;
      const toLocationId = payload?.toLocationId ? String(payload.toLocationId) : undefined;
      if (!materialId) throw new Error('MATERIAL_MISSING');
      if (!qty || qty <= 0) throw new Error('INVALID_QTY');
      const materials = await fetchMaterials();
      const material = materials.find((mat) => mat.id === materialId);
      if (!material) throw new Error('MATERIAL_MISSING');
      if (kind === 'INTERNAL') {
        if (!fromLocationId || !toLocationId) throw new Error('MISSING_LOCATIONS');
        if (fromLocationId === toLocationId) throw new Error('SAME_LOCATION');
      }
      if (kind === 'EXTERNAL_IN' && !toLocationId) throw new Error('MISSING_LOCATION');
      if (kind === 'EXTERNAL_OUT' && !fromLocationId) throw new Error('MISSING_LOCATION');
      if ((kind === 'INTERNAL' || kind === 'EXTERNAL_OUT') && fromLocationId) {
        const todayKey = getTodayKey();
        const yesterdayKey = addDays(todayKey, -1);
        const { data: todayEntry, error: todayError } = await supabaseAdmin
          .from('daily_entries')
          .select('qty')
          .eq('date_key', todayKey)
          .eq('location_id', fromLocationId)
          .eq('material_id', materialId)
          .maybeSingle();
        if (todayError) throw todayError;
        let availableQty = todayEntry ? toNumber(todayEntry.qty) : null;
        if (availableQty === null) {
          const { data: yesterdayEntry, error: yesterdayError } = await supabaseAdmin
            .from('daily_entries')
            .select('qty')
            .eq('date_key', yesterdayKey)
            .eq('location_id', fromLocationId)
            .eq('material_id', materialId)
            .maybeSingle();
          if (yesterdayError) throw yesterdayError;
          availableQty = toNumber(yesterdayEntry?.qty);
        }
        if (qty > availableQty) throw new Error('INSUFFICIENT_STOCK');
      }
      const transfer = {
        id: randomUUID(),
        at: new Date().toISOString(),
        kind,
        material_id: materialId,
        qty,
        from_location_id: fromLocationId ?? null,
        to_location_id: toLocationId ?? null,
        partner: payload?.partner ? String(payload.partner).trim() || null : null,
        note: payload?.note ? String(payload.note).trim() || null : null
      };
      const { data, error } = await supabaseAdmin
        .from('transfers')
        .insert(transfer)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      const dateKey = getTodayKey();
      if (fromLocationId) {
        await upsertTransferEntry(dateKey, fromLocationId, materialId, -qty);
      }
      if (toLocationId) {
        await upsertTransferEntry(dateKey, toLocationId, materialId, qty);
      }
      return mapTransfer(data);
    }
    case 'getInventoryAdjustments': {
      const { data, error } = await supabaseAdmin
        .from('inventory_adjustments')
        .select('*')
        .order('at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapInventoryAdjustment);
    }
    case 'applyInventoryAdjustment': {
      const locationId = String(payload?.locationId ?? '');
      const materialId = String(payload?.materialId ?? '');
      const qty = toNumber(payload?.qty);
      if (!locationId) throw new Error('LOCATION_MISSING');
      if (!materialId) throw new Error('MATERIAL_MISSING');
      if (qty < 0) throw new Error('INVALID_QTY');
      const [locations, materials] = await Promise.all([fetchLocations(), fetchMaterials()]);
      const location = locations.find((loc) => loc.id === locationId && loc.isActive);
      if (!location) throw new Error('LOCATION_MISSING');
      const material = materials.find((mat) => mat.id === materialId);
      if (!material) throw new Error('MATERIAL_MISSING');
      const todayKey = getTodayKey();
      const yesterdayKey = addDays(todayKey, -1);
      const { data: yesterdayEntry, error: yesterdayError } = await supabaseAdmin
        .from('daily_entries')
        .select('qty')
        .eq('date_key', yesterdayKey)
        .eq('location_id', locationId)
        .eq('material_id', materialId)
        .maybeSingle();
      if (yesterdayError) throw yesterdayError;
      const prevQty = toNumber(yesterdayEntry?.qty);
      const { error: upsertError } = await supabaseAdmin
        .from('daily_entries')
        .upsert(
          {
            date_key: yesterdayKey,
            location_id: locationId,
            material_id: materialId,
            qty,
            confirmed: true,
            comment: null,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'date_key,location_id,material_id' }
        );
      if (upsertError) throw upsertError;
      const { data: todayEntries, error: todayError } = await supabaseAdmin
        .from('daily_entries')
        .select('material_id')
        .eq('date_key', todayKey)
        .eq('location_id', locationId);
      if (todayError) throw todayError;
      if (todayEntries && todayEntries.length > 0) {
        const trimmedNote = payload?.note ? String(payload.note).trim() : '';
        const { error: todayUpsertError } = await supabaseAdmin
          .from('daily_entries')
          .upsert(
            {
              date_key: todayKey,
              location_id: locationId,
              material_id: materialId,
              qty,
              confirmed: true,
              comment: trimmedNote ? trimmedNote : null,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'date_key,location_id,material_id' }
          );
        if (todayUpsertError) throw todayUpsertError;
        await supabaseAdmin
          .from('daily_location_status')
          .delete()
          .eq('date_key', todayKey)
          .eq('location_id', locationId);
      }
      const adjustment = {
        id: randomUUID(),
        at: new Date().toISOString(),
        location_id: locationId,
        material_id: materialId,
        prev_qty: prevQty,
        next_qty: qty,
        note: payload?.note ? String(payload.note).trim() || null : null
      };
      const { data, error } = await supabaseAdmin
        .from('inventory_adjustments')
        .insert(adjustment)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return mapInventoryAdjustment(data);
    }
    case 'getMixedMaterials': {
      const { data, error } = await supabaseAdmin.from('mixed_materials').select('*');
      if (error) throw error;
      const list = (data ?? []).map(mapMixedMaterial);
      return list.sort((a, b) => {
        const nameCompare = a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' });
        if (nameCompare !== 0) return nameCompare;
        return a.locationId.localeCompare(b.locationId);
      });
    }
    case 'addMixedMaterial': {
      const name = String(payload?.name ?? '').trim();
      const qty = toNumber(payload?.qty);
      const locationId = String(payload?.locationId ?? '');
      if (!name) throw new Error('NAME_REQUIRED');
      if (!locationId) throw new Error('LOCATION_REQUIRED');
      if (!qty || qty <= 0) throw new Error('INVALID_QTY');
      const locations = await fetchLocations();
      if (!locations.some((loc) => loc.id === locationId)) throw new Error('LOCATION_UNKNOWN');
      const { data, error } = await supabaseAdmin
        .from('mixed_materials')
        .select('*')
        .eq('location_id', locationId);
      if (error) throw error;
      const existing = (data ?? [])
        .map(mapMixedMaterial)
        .find((item) => normalizeMixedName(item.name) === normalizeMixedName(name));
      if (existing) {
        const nextQty = existing.qty + qty;
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('mixed_materials')
          .update({ qty: nextQty })
          .eq('id', existing.id)
          .select('*')
          .maybeSingle();
        if (updateError) throw updateError;
        return mapMixedMaterial(updated);
      }
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('mixed_materials')
        .insert({
          id: randomUUID(),
          name,
          qty,
          location_id: locationId
        })
        .select('*')
        .maybeSingle();
      if (insertError) throw insertError;
      return mapMixedMaterial(inserted);
    }
    case 'removeMixedMaterial': {
      const name = String(payload?.name ?? '').trim();
      const qty = toNumber(payload?.qty);
      const locationId = String(payload?.locationId ?? '');
      if (!name) throw new Error('NAME_REQUIRED');
      if (!locationId) throw new Error('LOCATION_REQUIRED');
      if (!qty || qty <= 0) throw new Error('INVALID_QTY');
      const locations = await fetchLocations();
      if (!locations.some((loc) => loc.id === locationId)) throw new Error('LOCATION_UNKNOWN');
      const { data, error } = await supabaseAdmin
        .from('mixed_materials')
        .select('*')
        .eq('location_id', locationId);
      if (error) throw error;
      const existing = (data ?? [])
        .map(mapMixedMaterial)
        .find((item) => normalizeMixedName(item.name) === normalizeMixedName(name));
      if (!existing) throw new Error('NOT_FOUND');
      if (qty > existing.qty) throw new Error('INSUFFICIENT_QTY');
      const nextQty = Math.max(0, existing.qty - qty);
      if (nextQty === 0) {
        const { error: deleteError } = await supabaseAdmin
          .from('mixed_materials')
          .delete()
          .eq('id', existing.id);
        if (deleteError) throw deleteError;
        return existing;
      }
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('mixed_materials')
        .update({ qty: nextQty })
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();
      if (updateError) throw updateError;
      return mapMixedMaterial(updated);
    }
    case 'deleteMixedMaterial': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const { error } = await supabaseAdmin.from('mixed_materials').delete().eq('id', id);
      if (error) throw error;
      return;
    }
    case 'transferMixedMaterial': {
      const name = String(payload?.name ?? '').trim();
      const fromLocationId = String(payload?.fromLocationId ?? '');
      const toLocationId = String(payload?.toLocationId ?? '');
      const qty = toNumber(payload?.qty);
      if (!name) throw new Error('NAME_REQUIRED');
      if (!fromLocationId) throw new Error('FROM_REQUIRED');
      if (!toLocationId) throw new Error('TO_REQUIRED');
      if (!qty || qty <= 0) throw new Error('INVALID_QTY');
      if (fromLocationId === toLocationId) throw new Error('SAME_LOCATION');
      const locations = await fetchLocations();
      if (
        !locations.some((loc) => loc.id === fromLocationId) ||
        !locations.some((loc) => loc.id === toLocationId)
      ) {
        throw new Error('LOCATION_UNKNOWN');
      }
      const { data, error } = await supabaseAdmin
        .from('mixed_materials')
        .select('*')
        .in('location_id', [fromLocationId, toLocationId]);
      if (error) throw error;
      const entries = (data ?? []).map(mapMixedMaterial);
      const fromEntry = entries.find(
        (entry) => entry.locationId === fromLocationId && normalizeMixedName(entry.name) === normalizeMixedName(name)
      );
      if (!fromEntry) throw new Error('NOT_FOUND');
      if (qty > fromEntry.qty) throw new Error('INSUFFICIENT_QTY');
      const nextFromQty = Math.max(0, fromEntry.qty - qty);
      if (nextFromQty === 0) {
        await supabaseAdmin.from('mixed_materials').delete().eq('id', fromEntry.id);
      } else {
        await supabaseAdmin.from('mixed_materials').update({ qty: nextFromQty }).eq('id', fromEntry.id);
      }
      let toEntry = entries.find(
        (entry) => entry.locationId === toLocationId && normalizeMixedName(entry.name) === normalizeMixedName(name)
      );
      if (toEntry) {
        const nextToQty = toEntry.qty + qty;
        const { data: updated, error: updateError } = await supabaseAdmin
          .from('mixed_materials')
          .update({ qty: nextToQty })
          .eq('id', toEntry.id)
          .select('*')
          .maybeSingle();
        if (updateError) throw updateError;
        toEntry = mapMixedMaterial(updated);
      } else {
        const { data: inserted, error: insertError } = await supabaseAdmin
          .from('mixed_materials')
          .insert({
            id: randomUUID(),
            name,
            qty,
            location_id: toLocationId
          })
          .select('*')
          .maybeSingle();
        if (insertError) throw insertError;
        toEntry = mapMixedMaterial(inserted);
      }
      return { from: { ...fromEntry, qty: nextFromQty }, to: toEntry };
    }
    case 'getDryers': {
      const { data, error } = await supabaseAdmin.from('dryers').select('*');
      if (error) throw error;
      const list = (data ?? []).map(mapDryer);
      list.sort((a, b) => {
        const order = a.orderNo - b.orderNo;
        if (order !== 0) return order;
        return a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' });
      });
      return list;
    }
    case 'addDryer': {
      const name = String(payload?.name ?? '').trim();
      if (!name) throw new Error('NAME_REQUIRED');
      const { data, error } = await supabaseAdmin.from('dryers').select('*');
      if (error) throw error;
      const dryers = (data ?? []).map(mapDryer);
      const duplicate = dryers.some(
        (dryer) => dryer.isActive && dryer.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) throw new Error('DUPLICATE');
      const nextOrder =
        typeof payload?.orderNo === 'number' && !Number.isNaN(payload.orderNo)
          ? payload.orderNo
          : Math.max(0, ...dryers.map((dryer) => dryer.orderNo)) + 1;
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('dryers')
        .insert({
          id: randomUUID(),
          name,
          order_no: nextOrder,
          is_active: payload?.isActive ?? true,
          material_id: null
        })
        .select('*')
        .maybeSingle();
      if (insertError) throw insertError;
      return mapDryer(inserted);
    }
    case 'updateDryer': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('dryers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw new Error('NOT_FOUND');
      const updates: Record<string, unknown> = {};
      if (typeof payload?.name === 'string') {
        const nextName = payload.name.trim();
        if (!nextName) throw new Error('NAME_REQUIRED');
        const { data: allDryers, error } = await supabaseAdmin.from('dryers').select('*');
        if (error) throw error;
        const duplicate = (allDryers ?? []).some(
          (item) =>
            item.id !== id &&
            item.is_active &&
            String(item.name).toLowerCase() === nextName.toLowerCase()
        );
        if (duplicate) throw new Error('DUPLICATE');
        updates.name = nextName;
      }
      if (typeof payload?.orderNo === 'number' && !Number.isNaN(payload.orderNo)) {
        updates.order_no = payload.orderNo;
      }
      if (typeof payload?.isActive === 'boolean') {
        updates.is_active = payload.isActive;
      }
      if (payload?.materialId !== undefined) {
        if (!payload.materialId) {
          updates.material_id = null;
        } else {
          const materialId = String(payload.materialId);
          const [materials, originals] = await Promise.all([
            fetchMaterials(),
            fetchOriginalCatalog()
          ]);
          const isMaterial = materials.some((mat) => mat.id === materialId && mat.isActive);
          const isOriginal = originals.some((item) => item.id === materialId);
          if (!isMaterial && !isOriginal) {
            throw new Error('MATERIAL_MISSING');
          }
          updates.material_id = materialId;
        }
      }
      const { data, error } = await supabaseAdmin
        .from('dryers')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapDryer(data);
    }
    case 'removeDryer': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('NOT_FOUND');
      const { data, error } = await supabaseAdmin
        .from('dryers')
        .delete()
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapDryer(data);
    }
    case 'setDryerMaterial': {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('NOT_FOUND');
      const materialId =
        payload?.materialId === null ? null : String(payload?.materialId ?? '').trim() || null;
      const { data, error } = await supabaseAdmin
        .from('dryers')
        .update({ material_id: materialId })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapDryer(data);
    }
    case 'getSpareParts': {
      const { data, error } = await supabaseAdmin.from('spare_parts').select('*');
      if (error) throw error;
      return (data ?? []).map(mapSparePart).sort((a, b) =>
        a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' })
      );
    }
    case 'getSparePartHistory': {
      const { data, error } = await supabaseAdmin
        .from('spare_part_history')
        .select('*')
        .order('at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapSparePartHistory);
    }
    case 'getOriginalInventory': {
      const retentionCutoff = new Date();
      retentionCutoff.setMonth(retentionCutoff.getMonth() - 2);
      const retentionCutoffIso = retentionCutoff.toISOString();

      const { error: purgeError } = await supabaseAdmin
        .from('original_inventory_entries')
        .delete()
        .lt('at', retentionCutoffIso);
      if (purgeError) throw purgeError;

      const { data, error } = await supabaseAdmin
        .from('original_inventory_entries')
        .select('*')
        .gte('at', retentionCutoffIso)
        .order('at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapOriginalInventoryEntry);
    }
    case 'getOriginalInventoryCatalog': {
      const catalog = await fetchOriginalCatalog();
      return [...catalog].sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }));
    }
    case 'addOriginalInventory': {
      const warehouseId = String(payload?.warehouseId ?? '').trim();
      const name = String(payload?.name ?? '').trim();
      const unit = String(payload?.unit ?? '').trim() || 'kg';
      const qty = toNumber(payload?.qty);
      if (!warehouseId) throw new Error('WAREHOUSE_REQUIRED');
      if (!name) throw new Error('NAME_REQUIRED');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('QTY_REQUIRED');
      const now = new Date();
      let at = now.toISOString();
      if (typeof payload?.at === 'string') {
        const parsed = new Date(payload.at);
        if (!Number.isNaN(parsed.getTime())) {
          at = parsed.toISOString();
        }
      } else if (typeof payload?.dateKey === 'string') {
        const dateKey = payload.dateKey.trim();
        const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (match) {
          const year = Number(match[1]);
          const month = Number(match[2]);
          const day = Number(match[3]);
          const local = new Date(
            year,
            month - 1,
            day,
            now.getHours(),
            now.getMinutes(),
            now.getSeconds(),
            now.getMilliseconds()
          );
          if (!Number.isNaN(local.getTime())) {
            at = local.toISOString();
          }
        }
      }
      const { data, error } = await supabaseAdmin
        .from('original_inventory_entries')
        .insert({
          id: randomUUID(),
          at,
          warehouse_id: warehouseId,
          name,
          qty,
          unit,
          location: payload?.location ? String(payload.location).trim() || null : null,
          note: payload?.note ? String(payload.note).trim() || null : null,
          user_name: getActorName(currentUser)
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return mapOriginalInventoryEntry(data);
    }
    case 'addOriginalInventoryCatalog': {
      const name = String(payload?.name ?? '').trim();
      const unit = String(payload?.unit ?? '').trim() || 'kg';
      if (!name) throw new Error('NAME_REQUIRED');
      const { data: existing, error } = await supabaseAdmin
        .from('original_inventory_catalog')
        .select('id')
        .ilike('name', name);
      if (error) throw error;
      if (existing && existing.length > 0) throw new Error('DUPLICATE');
      const { data, error: insertError } = await supabaseAdmin
        .from('original_inventory_catalog')
        .insert({
          id: randomUUID(),
          name,
          unit,
          created_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();
      if (insertError) throw insertError;
      return mapOriginalInventoryCatalogEntry(data);
    }
    case 'addOriginalInventoryCatalogBulk': {
      const items: Array<{ name?: string; unit?: string }> =
        Array.isArray(payload?.items) ? payload.items : [];
      if (items.length === 0) throw new Error('EMPTY');

      const normalized: Array<{ name: string; unit: string }> = [];
      const seen = new Set<string>();
      items.forEach((item: { name?: string; unit?: string }) => {
        const name = String(item?.name ?? '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const unit = String(item?.unit ?? '').trim() || 'kg';
        normalized.push({ name, unit });
      });

      if (normalized.length === 0) throw new Error('EMPTY');

      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from('original_inventory_catalog')
        .select('name');
      if (existingError) throw existingError;
      const existingSet = new Set(
        (existingRows ?? []).map((row: any) => String(row.name ?? '').trim().toLowerCase())
      );
      const toInsert = normalized.filter(
        (item: { name: string }) => !existingSet.has(item.name.toLowerCase())
      );
      if (toInsert.length === 0) {
        return { total: normalized.length, inserted: 0, skipped: normalized.length };
      }

      const now = new Date().toISOString();
      let inserted = 0;
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize).map((item: { name: string; unit: string }) => ({
          id: randomUUID(),
          name: item.name,
          unit: item.unit,
          created_at: now
        }));
        const { error: insertError } = await supabaseAdmin
          .from('original_inventory_catalog')
          .insert(chunk);
        if (insertError) throw insertError;
        inserted += chunk.length;
      }

      return {
        total: normalized.length,
        inserted,
        skipped: normalized.length - inserted
      };
    }
    case 'updateOriginalInventory': {
      const id = String(payload?.id ?? '');
      const warehouseId = String(payload?.warehouseId ?? '').trim();
      const qty = toNumber(payload?.qty);
      if (!id) throw new Error('ENTRY_MISSING');
      if (!warehouseId) throw new Error('WAREHOUSE_REQUIRED');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('QTY_REQUIRED');
      const { data, error } = await supabaseAdmin
        .from('original_inventory_entries')
        .update({ warehouse_id: warehouseId, qty })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ENTRY_MISSING');
      return mapOriginalInventoryEntry(data);
    }
    case 'removeOriginalInventory': {
      const id = String(payload?.entryId ?? payload ?? '');
      if (!id) throw new Error('ENTRY_MISSING');
      const { error, data } = await supabaseAdmin
        .from('original_inventory_entries')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ENTRY_MISSING');
      return;
    }
    case 'removeOriginalInventoryCatalog': {
      const id = String(payload?.catalogId ?? payload ?? '');
      if (!id) throw new Error('ENTRY_MISSING');
      const { error, data } = await supabaseAdmin
        .from('original_inventory_catalog')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ENTRY_MISSING');
      return;
    }
    case 'addSparePart': {
      const code = String(payload?.code ?? '').trim();
      const name = String(payload?.name ?? '').trim();
      const unit = String(payload?.unit ?? '').trim();
      if (!code || !name || !unit) throw new Error('INVALID_PART');
      const { data, error } = await supabaseAdmin.from('spare_parts').select('*');
      if (error) throw error;
      const list = (data ?? []).map(mapSparePart);
      const duplicate = list.some(
        (part) =>
          part.code.toLowerCase() === code.toLowerCase() ||
          part.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) throw new Error('DUPLICATE');
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('spare_parts')
        .insert({
          id: randomUUID(),
          code,
          name,
          unit,
          qty: Math.max(0, toNumber(payload?.qty ?? 0)),
          location: payload?.location ? String(payload.location).trim() || null : null
        })
        .select('*')
        .maybeSingle();
      if (insertError) throw insertError;
      return mapSparePart(inserted);
    }
    case 'updateSparePart': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('PART_MISSING');
      const { data, error } = await supabaseAdmin.from('spare_parts').select('*');
      if (error) throw error;
      const list = (data ?? []).map(mapSparePart);
      const part = list.find((item) => item.id === id);
      if (!part) throw new Error('PART_MISSING');
      const updates: Record<string, unknown> = {};
      if (typeof payload?.code === 'string') {
        const code = payload.code.trim();
        if (!code) throw new Error('INVALID_PART');
        const duplicate = list.some(
          (item) => item.id !== id && item.code.toLowerCase() === code.toLowerCase()
        );
        if (duplicate) throw new Error('DUPLICATE');
        updates.code = code;
      }
      if (typeof payload?.name === 'string') {
        const name = payload.name.trim();
        if (!name) throw new Error('INVALID_PART');
        const duplicate = list.some(
          (item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase()
        );
        if (duplicate) throw new Error('DUPLICATE');
        updates.name = name;
      }
      if (typeof payload?.unit === 'string') {
        const unit = payload.unit.trim();
        if (!unit) throw new Error('INVALID_PART');
        updates.unit = unit;
      }
      if (payload?.location !== undefined) {
        updates.location = payload.location ? String(payload.location).trim() || null : null;
      }
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('spare_parts')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (updateError) throw updateError;
      return mapSparePart(updated);
    }
    case 'removeSparePart': {
      const id = String(payload?.id ?? '');
      if (!id) throw new Error('PART_MISSING');
      const { data, error } = await supabaseAdmin
        .from('spare_parts')
        .delete()
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('PART_MISSING');
      return mapSparePart(data);
    }
    case 'setSparePartQty': {
      const partId = String(payload?.partId ?? '');
      const qty = toNumber(payload?.qty);
      if (!partId) throw new Error('PART_MISSING');
      if (qty < 0) throw new Error('INVALID_QTY');
      const { data, error } = await supabaseAdmin
        .from('spare_parts')
        .select('*')
        .eq('id', partId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('PART_MISSING');
      const part = mapSparePart(data);
      const diff = qty - part.qty;
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('spare_parts')
        .update({ qty })
        .eq('id', partId)
        .select('*')
        .maybeSingle();
      if (updateError) throw updateError;
      if (diff !== 0) {
        await supabaseAdmin.from('spare_part_history').insert({
          id: randomUUID(),
          at: new Date().toISOString(),
          user_name: getActorName(currentUser),
          part_id: partId,
          part_name: part.name,
          qty: Math.abs(diff),
          kind: diff >= 0 ? 'IN' : 'OUT',
          note: payload?.note ? String(payload.note).trim() || 'Korekta stanu' : 'Korekta stanu'
        });
      }
      return mapSparePart(updated);
    }
    case 'adjustSparePart': {
      const partId = String(payload?.partId ?? '');
      const qty = toNumber(payload?.qty);
      const kind = payload?.kind === 'OUT' ? 'OUT' : 'IN';
      if (!partId) throw new Error('PART_MISSING');
      if (!qty || qty <= 0) throw new Error('INVALID_QTY');
      const { data, error } = await supabaseAdmin
        .from('spare_parts')
        .select('*')
        .eq('id', partId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('PART_MISSING');
      const part = mapSparePart(data);
      if (kind === 'OUT' && qty > part.qty) throw new Error('INSUFFICIENT_STOCK');
      const nextQty = kind === 'OUT' ? part.qty - qty : part.qty + qty;
      const { data: updated, error: updateError } = await supabaseAdmin
        .from('spare_parts')
        .update({ qty: Math.max(0, nextQty) })
        .eq('id', partId)
        .select('*')
        .maybeSingle();
      if (updateError) throw updateError;
      await supabaseAdmin.from('spare_part_history').insert({
        id: randomUUID(),
        at: new Date().toISOString(),
        user_name: getActorName(currentUser),
        part_id: partId,
        part_name: part.name,
        qty,
        kind,
        note: payload?.note ? String(payload.note).trim() || null : null
      });
      return mapSparePart(updated);
    }
    case 'getRaportZmianowySessions': {
      const dateKey = payload?.dateKey ? String(payload.dateKey).trim() : '';
      let query = supabaseAdmin.from('raport_zmianowy_sessions').select('*');
      if (dateKey) {
        query = query.eq('session_date', dateKey);
      }
      query = query.order('created_at', { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(mapRaportZmianowySession);
    }
    case 'getRaportZmianowySession': {
      const sessionId = String(payload?.sessionId ?? '').trim();
      if (!sessionId) throw new Error('NOT_FOUND');
      const { data: sessionRow, error: sessionError } = await supabaseAdmin
        .from('raport_zmianowy_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();
      if (sessionError) throw sessionError;
      if (!sessionRow) throw new Error('NOT_FOUND');
      const { data: itemRows, error: itemsError } = await supabaseAdmin
        .from('raport_zmianowy_items')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });
      if (itemsError) throw itemsError;
      const items = (itemRows ?? []).map(mapRaportZmianowyItem);
      const itemIds = items.map((item) => item.id);
      let entries: RaportZmianowyEntry[] = [];
      if (itemIds.length > 0) {
        const { data: entryRows, error: entriesError } = await supabaseAdmin
          .from('raport_zmianowy_entries')
          .select('*')
          .in('item_id', itemIds)
          .order('created_at', { ascending: true });
        if (entriesError) throw entriesError;
        entries = (entryRows ?? []).map(mapRaportZmianowyEntry);
      }
      const result: RaportZmianowySessionData = {
        session: mapRaportZmianowySession(sessionRow),
        items,
        entries
      };
      return result;
    }
    case 'getRaportZmianowyEntries': {
      const fromRaw = payload?.from ? String(payload.from).trim() : '';
      const toRaw = payload?.to ? String(payload.to).trim() : '';
      const indexCode = payload?.indexCode ? String(payload.indexCode).trim() : '';
      const station = payload?.station ? String(payload.station).trim() : '';
      let query = supabaseAdmin
        .from('raport_zmianowy_entries')
        .select(
          'id, item_id, note, created_at, author_id, author_name, edited_at, edited_by_id, edited_by_name, raport_zmianowy_items(id, index_code, station, description, session_id, raport_zmianowy_sessions(id, session_date))'
        )
        .order('created_at', { ascending: true });
      if (fromRaw) {
        const from = new Date(fromRaw);
        if (!Number.isNaN(from.getTime())) {
          query = query.gte('created_at', from.toISOString());
        }
      }
      if (toRaw) {
        const to = new Date(toRaw);
        if (!Number.isNaN(to.getTime())) {
          query = query.lte('created_at', to.toISOString());
        }
      }
      if (indexCode) {
        query = query.ilike('raport_zmianowy_items.index_code', `%${indexCode}%`);
      }
      if (station) {
        query = query.ilike('raport_zmianowy_items.station', `%${station}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      const mapped = (data ?? []).map((row: any) => {
        const entry = mapRaportZmianowyEntry(row);
        const item = row.raport_zmianowy_items;
        const session = item?.raport_zmianowy_sessions;
        return {
          ...entry,
          indexCode: item?.index_code ?? '',
          station: item?.station ?? null,
          description: item?.description ?? null,
          sessionId: item?.session_id ?? '',
          sessionDate: session?.session_date ?? formatDate(new Date(entry.createdAt))
        } satisfies RaportZmianowyEntryLog;
      });
      return mapped;
    }
    case 'createRaportZmianowySession': {
      const planSheet = String(payload?.planSheet ?? '').trim();
      const createdBy = getActorName(currentUser);
      const fileName = payload?.fileName ? String(payload.fileName).trim() : null;
      const dateKeyRaw = typeof payload?.dateKey === 'string' ? payload.dateKey.trim() : '';
      const dateKeyMatch = dateKeyRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const sessionDate = dateKeyMatch ? dateKeyRaw : formatDate(new Date());
      const items: Array<{ indexCode?: string; description?: string; station?: string }> =
        Array.isArray(payload?.items) ? payload.items : [];
      if (!planSheet) throw new Error('SHEET_REQUIRED');
      const normalizedItems = items
        .map((item) => ({
          indexCode: String(item?.indexCode ?? '').trim(),
          description: item?.description ? String(item.description).trim() : null,
          station: item?.station ? String(item.station).trim() : null
        }))
        .filter((item: { indexCode: string }) => item.indexCode);
      const now = new Date().toISOString();
      const sessionId = randomUUID();
      const sessionPayload = {
        id: sessionId,
        created_at: now,
        created_by: createdBy,
        session_date: sessionDate,
        plan_sheet: planSheet,
        file_name: fileName
      };
      let { data: sessionRow, error: sessionError } = await supabaseAdmin
        .from('raport_zmianowy_sessions')
        .insert(sessionPayload)
        .select('*')
        .maybeSingle();
      if (sessionError) {
        const message = String(sessionError.message ?? '');
        if (message.toLowerCase().includes('session_date')) {
          const fallbackPayload = { ...sessionPayload };
          delete (fallbackPayload as Record<string, unknown>).session_date;
          const fallback = await supabaseAdmin
            .from('raport_zmianowy_sessions')
            .insert(fallbackPayload)
            .select('*')
            .maybeSingle();
          sessionRow = fallback.data ?? null;
          sessionError = fallback.error ?? null;
        }
      }
      if (sessionError) throw sessionError;
      if (!sessionRow) throw new Error('NOT_FOUND');
      let createdItems: RaportZmianowyItem[] = [];
      if (normalizedItems.length > 0) {
        const itemsToInsert = normalizedItems.map((item) => ({
          id: randomUUID(),
          session_id: sessionId,
          index_code: item.indexCode,
          description: item.description,
          station: item.station,
          created_at: now
        }));
        const { data: itemRows, error: itemsError } = await supabaseAdmin
          .from('raport_zmianowy_items')
          .insert(itemsToInsert)
          .select('*');
        if (itemsError) throw itemsError;
        createdItems = (itemRows ?? []).map(mapRaportZmianowyItem);
      }
      const result: RaportZmianowySessionData = {
        session: mapRaportZmianowySession(sessionRow),
        items: createdItems,
        entries: []
      };
      return result;
    }
    case 'removeRaportZmianowySession': {
      const sessionId = String(payload?.sessionId ?? '').trim();
      if (!sessionId) throw new Error('NOT_FOUND');
      const { data, error } = await supabaseAdmin
        .from('raport_zmianowy_sessions')
        .delete()
        .eq('id', sessionId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return;
    }
    case 'addRaportZmianowyItem': {
      const sessionId = String(payload?.sessionId ?? '').trim();
      const indexCode = String(payload?.indexCode ?? '').trim();
      if (!sessionId) throw new Error('NOT_FOUND');
      if (!indexCode) throw new Error('INDEX_REQUIRED');
      const description = payload?.description ? String(payload.description).trim() : null;
      const station = payload?.station ? String(payload.station).trim() : null;
      const { data, error } = await supabaseAdmin
        .from('raport_zmianowy_items')
        .insert({
          id: randomUUID(),
          session_id: sessionId,
          index_code: indexCode,
          description,
          station,
          created_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapRaportZmianowyItem(data);
    }
    case 'updateRaportZmianowyItem': {
      const itemId = String(payload?.itemId ?? '').trim();
      if (!itemId) throw new Error('NOT_FOUND');
      const updates: Record<string, unknown> = {};
      if (payload?.station !== undefined) {
        const station = payload.station ? String(payload.station).trim() : '';
        updates.station = station || null;
      }
      if (payload?.description !== undefined) {
        const description = payload.description ? String(payload.description).trim() : '';
        updates.description = description || null;
      }
      if (payload?.indexCode !== undefined) {
        const indexCode = String(payload.indexCode ?? '').trim();
        if (!indexCode) throw new Error('INDEX_REQUIRED');
        updates.index_code = indexCode;
      }
      if (Object.keys(updates).length === 0) throw new Error('EMPTY');
      const { data, error } = await supabaseAdmin
        .from('raport_zmianowy_items')
        .update(updates)
        .eq('id', itemId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapRaportZmianowyItem(data);
    }
    case 'addRaportZmianowyEntry': {
      const itemId = String(payload?.itemId ?? '').trim();
      const note = payload?.note ? String(payload.note).trim() : '';
      const authorName = getActorName(currentUser);
      const authorId = currentUser.id;
      if (!itemId) throw new Error('NOT_FOUND');
      if (!note) throw new Error('NOTE_REQUIRED');
      const now = new Date().toISOString();
      const { data, error } = await supabaseAdmin
        .from('raport_zmianowy_entries')
        .insert({
          id: randomUUID(),
          item_id: itemId,
          note,
          created_at: now,
          author_id: authorId,
          author_name: authorName,
          edited_at: null,
          edited_by_id: null,
          edited_by_name: null
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapRaportZmianowyEntry(data);
    }
    case 'updateRaportZmianowyEntry': {
      const entryId = String(payload?.entryId ?? '').trim();
      const note = payload?.note ? String(payload.note).trim() : '';
      if (!entryId) throw new Error('NOT_FOUND');
      if (!note) throw new Error('NOTE_REQUIRED');
      const updates: Record<string, unknown> = {
        note,
        edited_at: new Date().toISOString(),
        edited_by_id: currentUser.id,
        edited_by_name: getActorName(currentUser)
      };
      const { data, error } = await supabaseAdmin
        .from('raport_zmianowy_entries')
        .update(updates)
        .eq('id', entryId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return mapRaportZmianowyEntry(data);
    }
    case 'removeRaportZmianowyEntry': {
      const entryId = String(payload?.entryId ?? '').trim();
      if (!entryId) throw new Error('NOT_FOUND');
      const { data, error } = await supabaseAdmin
        .from('raport_zmianowy_entries')
        .delete()
        .eq('id', entryId)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('NOT_FOUND');
      return;
    }
    case 'getWarehouses': {
      const warehouses = await fetchWarehouses();
      return warehouses
        .filter((item) => item.isActive && item.includeInSpis)
        .sort((a, b) => a.orderNo - b.orderNo);
    }
    case 'getWarehousesAdmin': {
      const warehouses = await fetchWarehouses();
      return [...warehouses].sort((a, b) => a.orderNo - b.orderNo);
    }
    case 'getWarehouse': {
      const id = String(payload?.id ?? '');
      if (!id) return null;
      const { data, error } = await supabaseAdmin
        .from('warehouses')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapWarehouse(data) : null;
    }
    case 'getLocation': {
      const id = String(payload?.id ?? '');
      if (!id) return null;
      const { data, error } = await supabaseAdmin
        .from('locations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapLocation(data) : null;
    }
    case 'getMaterials': {
      return fetchMaterials();
    }
    default:
      throw new Error('UNKNOWN_ACTION');
  }
};

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth.user) {
      const response = NextResponse.json({ code: auth.code }, { status: 401 });
      if (auth.code === 'SESSION_EXPIRED') {
        clearSessionCookie(response);
      }
      return response;
    }

    const body = (await request.json().catch(() => ({}))) as { action?: string; payload?: any };
    const action = body.action ?? '';
    if (!action) {
      return NextResponse.json({ code: 'UNKNOWN_ACTION' }, { status: 400 });
    }
    ensureActionAccess(action, auth.user, body.payload);
    const data = await handleAction(action, body.payload, auth.user);
    await writeAuditLog(action, body.payload, data, auth.user);
    return NextResponse.json(data ?? null);
  } catch (error) {
    const code = errorCodeFromError(error);
    const status = statusCodeFromError(code);
    return NextResponse.json({ code }, { status });
  }
}
