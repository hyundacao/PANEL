import type {
  AuditEvent,
  AppUser,
  CatalogTotal,
  DailyTotals,
  DashboardSummary,
  Dryer,
  ErpTargetLocation,
  InventoryAdjustment,
  InventoryTotalPoint,
  Location,
  LocationDetailItem,
  LocationOption,
  LocationOverview,
  Material,
  MaterialCatalog,
  MaterialCatalogImportResult,
  MaterialImportResult,
  MaterialLocationsMap,
  MaterialTotal,
  MixedMaterial,
  MonthlyDelta,
  MonthlyMaterialBreakdown,
  OriginalInventoryCatalogEntry,
  OriginalInventoryCatalogImportResult,
  OriginalInventoryEntry,
  PermissionGroup,
  PeriodReport,
  ReportRow,
  Role,
  RaportZmianowyEntry,
  RaportZmianowyEntryLog,
  RaportZmianowyItem,
  RaportZmianowySession,
  RaportZmianowySessionData,
  SparePart,
  SparePartHistory,
  Transfer,
  TransferKind,
  WarehouseTransferDocument,
  WarehouseTransferDocumentDetails,
  WarehouseTransferDocumentSummary,
  WarehouseTransferItemIssue,
  WarehouseTransferItemPriority,
  WarehouseTransferItemReceipt,
  UserAccess,
  Warehouse,
  YearlyReport
} from './types';
import { formatDate } from '../utils/format';

const apiRequest = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });
  if (!response.ok) {
    let code = 'UNKNOWN';
    try {
      const data = await response.json();
      if (data?.code) code = String(data.code);
    } catch {
      // ignore
    }
    if (
      typeof window !== 'undefined' &&
      (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED')
    ) {
      window.dispatchEvent(new CustomEvent('apka:auth-expired'));
    }
    throw new Error(code);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
};

const appRequest = async <T,>(action: string, payload?: unknown): Promise<T> =>
  apiRequest<T>('/api/app', {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify({ action, payload })
  });

export type ErpPushStatus = {
  enabled: boolean;
  configured: boolean;
  publicKey: string | null;
};

export type ErpPushPreferences = {
  warehousemanSourceWarehouses?: string[] | null;
  dispatcherTargetLocations?: string[] | null;
};

export type WarehouseAdminScope = 'PRZEMIALY' | 'ERP';

export const getErpPushStatus = async (): Promise<ErpPushStatus> =>
  apiRequest('/api/push/status', { cache: 'no-store' });

export const subscribeErpPush = async (
  subscription: PushSubscriptionJSON,
  preferences?: ErpPushPreferences
): Promise<{ enabled: boolean }> =>
  apiRequest('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(preferences ? { subscription, preferences } : { subscription })
  });

export const unsubscribeErpPush = async (
  endpoint?: string
): Promise<{ enabled: boolean }> =>
  apiRequest('/api/push/unsubscribe', {
    method: 'POST',
    body: JSON.stringify(endpoint ? { endpoint } : {})
  });

export const getDashboard = async (date: string): Promise<DashboardSummary[]> =>
  appRequest('getDashboard', { date });

export const getLocationsOverview = async (
  warehouseId: string,
  date: string
): Promise<LocationOverview[]> => appRequest('getLocationsOverview', { warehouseId, date });

export const getLocationDetail = async (
  _warehouseId: string,
  locationId: string,
  date: string
): Promise<LocationDetailItem[]> => appRequest('getLocationDetail', { locationId, date });

export const upsertEntry = async (payload: {
  locationId: string;
  materialId: string;
  qty: number;
  comment?: string;
}) => appRequest('upsertEntry', payload);

export const confirmNoChangeEntry = async (payload: {
  locationId: string;
  materialId: string;
}) => appRequest('confirmNoChangeEntry', payload);

export const confirmNoChangeLocation = async (locationId: string) =>
  appRequest('confirmNoChangeLocation', { locationId });

export const closeSpis = async () => appRequest('closeSpis');

export const getReports = async (): Promise<ReportRow[]> => appRequest('getReports');

export const getCatalog = async (): Promise<Material[]> => appRequest('getCatalog');

export const getCatalogs = async (): Promise<MaterialCatalog[]> => appRequest('getCatalogs');

export const getTotalsHistory = async (days = 30): Promise<InventoryTotalPoint[]> =>
  appRequest('getTotalsHistory', { days });

export const getMonthlyDelta = async (): Promise<MonthlyDelta> =>
  appRequest('getMonthlyDelta');

export const getMonthlyMaterialBreakdown = async (): Promise<MonthlyMaterialBreakdown> =>
  appRequest('getMonthlyMaterialBreakdown');

export const getDailyHistory = async (): Promise<DailyTotals[]> => appRequest('getDailyHistory');

export const getPeriodReport = async (from: string, to: string): Promise<PeriodReport> =>
  appRequest('getPeriodReport', { from, to });

export const getYearlyReport = async (from: string, to: string): Promise<YearlyReport> =>
  appRequest('getYearlyReport', { from, to });

export const getCurrentMaterialTotals = async (
  scope: 'stats' | 'all' = 'stats'
): Promise<MaterialTotal[]> => appRequest('getCurrentMaterialTotals', { scope });

export const getMaterialLocations = async (): Promise<MaterialLocationsMap> =>
  appRequest('getMaterialLocations');

export const getTopCatalogTotal = async (): Promise<CatalogTotal> =>
  appRequest('getTopCatalogTotal');

export const addMaterial = async (payload: {
  name: string;
  catalogId?: string | null;
  catalogName?: string;
  code?: string;
}): Promise<Material> => appRequest('addMaterial', payload);

export const addMaterialBulk = async (payload: {
  items: Array<{ name: string; catalogName?: string }>;
}): Promise<MaterialImportResult> => appRequest('addMaterialBulk', payload);

export const addCatalog = async (payload: { name: string }): Promise<MaterialCatalog> =>
  appRequest('addCatalog', payload);

export const addMaterialCatalogBulk = async (payload: {
  items: Array<{ name: string }>;
}): Promise<MaterialCatalogImportResult> => appRequest('addMaterialCatalogBulk', payload);

export const removeMaterial = async (materialId: string): Promise<void> =>
  appRequest('removeMaterial', { materialId });

export const removeCatalog = async (
  payload: string | { catalogId: string; force?: boolean }
): Promise<void> => {
  if (typeof payload === 'string') {
    return appRequest('removeCatalog', { catalogId: payload });
  }
  return appRequest('removeCatalog', payload);
};

export const updateMaterialCatalog = async (payload: {
  materialId: string;
  catalogId: string | null;
}): Promise<Material> => appRequest('updateMaterialCatalog', payload);

export const updateMaterial = async (payload: {
  materialId: string;
  name?: string;
  catalogId?: string | null;
}): Promise<Material> => appRequest('updateMaterial', payload);

export const addWarehouse = async (payload: {
  name: string;
  orderNo?: number;
  includeInSpis?: boolean;
  includeInStats?: boolean;
  scope?: WarehouseAdminScope;
}): Promise<Warehouse> => appRequest('addWarehouse', payload);

export const updateWarehouse = async (payload: {
  id: string;
  name?: string;
  orderNo?: number;
  includeInSpis?: boolean;
  includeInStats?: boolean;
  scope?: WarehouseAdminScope;
}): Promise<Warehouse> => appRequest('updateWarehouse', payload);

export const removeWarehouse = async (
  id: string,
  scope?: WarehouseAdminScope
): Promise<Warehouse> =>
  appRequest('removeWarehouse', scope ? { id, scope } : { id });

export const addLocation = async (payload: {
  warehouseId: string;
  name: string;
  type: Location['type'];
  orderNo?: number;
  scope?: WarehouseAdminScope;
}): Promise<Location> => appRequest('addLocation', payload);

export const updateLocation = async (payload: {
  id: string;
  name?: string;
  orderNo?: number;
  scope?: WarehouseAdminScope;
}): Promise<Location> => appRequest('updateLocation', payload);

export const removeLocation = async (
  id: string,
  scope?: WarehouseAdminScope
): Promise<Location> =>
  appRequest('removeLocation', scope ? { id, scope } : { id });

export const getAudit = async (): Promise<AuditEvent[]> => appRequest('getAudit');

export const getLocations = async (): Promise<LocationOption[]> => appRequest('getLocations');

export const getLocationsAdmin = async (scope?: WarehouseAdminScope): Promise<Location[]> =>
  appRequest('getLocationsAdmin', scope ? { scope } : undefined);

export const getTransfers = async (dateKey?: string): Promise<Transfer[]> =>
  appRequest('getTransfers', { dateKey });

export const addTransfer = async (payload: {
  kind: TransferKind;
  materialId: string;
  qty: number;
  fromLocationId?: string;
  toLocationId?: string;
  partner?: string;
  note?: string;
}): Promise<Transfer> => appRequest('addTransfer', payload);

export const getWarehouseTransferDocuments = async (): Promise<WarehouseTransferDocumentSummary[]> =>
  appRequest('getWarehouseTransferDocuments');

export const getWarehouseTransferDocument = async (
  documentId: string
): Promise<WarehouseTransferDocumentDetails> =>
  appRequest('getWarehouseTransferDocument', { documentId });

export const getErpTargetLocations = async (): Promise<ErpTargetLocation[]> =>
  appRequest('getErpTargetLocations');

export const addErpTargetLocation = async (payload: {
  name: string;
  orderNo?: number;
}): Promise<ErpTargetLocation> => appRequest('addErpTargetLocation', payload);

export const updateErpTargetLocation = async (payload: {
  id: string;
  name?: string;
  orderNo?: number;
}): Promise<ErpTargetLocation> => appRequest('updateErpTargetLocation', payload);

export const removeErpTargetLocation = async (payload: {
  id: string;
}): Promise<ErpTargetLocation> => appRequest('removeErpTargetLocation', payload);

export const createWarehouseTransferDocument = async (payload: {
  documentNumber: string;
  sourceWarehouse?: string;
  targetWarehouse?: string;
  note?: string;
  items: Array<{
    lineNo?: number;
    priority?: WarehouseTransferItemPriority;
    indexCode: string;
    indexCode2?: string;
    name: string;
    batch?: string;
    location?: string;
    unit?: string;
    plannedQty: number;
    note?: string;
  }>;
}): Promise<WarehouseTransferDocumentDetails> =>
  appRequest('createWarehouseTransferDocument', payload);

export const addWarehouseTransferItemIssue = async (payload: {
  documentId: string;
  itemId: string;
  qty: number;
  note?: string;
}): Promise<WarehouseTransferItemIssue> =>
  appRequest('addWarehouseTransferItemIssue', payload);

export const updateWarehouseTransferItemIssue = async (payload: {
  documentId: string;
  itemId: string;
  issueId: string;
  qty: number;
  note?: string;
}): Promise<WarehouseTransferItemIssue> =>
  appRequest('updateWarehouseTransferItemIssue', payload);

export const removeWarehouseTransferItemIssue = async (payload: {
  documentId: string;
  itemId: string;
  issueId: string;
}): Promise<void> => appRequest('removeWarehouseTransferItemIssue', payload);

export const addWarehouseTransferItemReceipt = async (payload: {
  documentId: string;
  itemId: string;
  qty: number;
  note?: string;
}): Promise<WarehouseTransferItemReceipt> =>
  appRequest('addWarehouseTransferItemReceipt', payload);

export const updateWarehouseTransferItemReceipt = async (payload: {
  documentId: string;
  itemId: string;
  receiptId: string;
  qty: number;
  note?: string;
}): Promise<WarehouseTransferItemReceipt> =>
  appRequest('updateWarehouseTransferItemReceipt', payload);

export const removeWarehouseTransferItemReceipt = async (payload: {
  documentId: string;
  itemId: string;
  receiptId: string;
}): Promise<void> => appRequest('removeWarehouseTransferItemReceipt', payload);

export const closeWarehouseTransferDocument = async (payload: {
  documentId: string;
}): Promise<WarehouseTransferDocument> =>
  appRequest('closeWarehouseTransferDocument', payload);

export const markWarehouseTransferDocumentIssued = async (payload: {
  documentId: string;
}): Promise<WarehouseTransferDocument> =>
  appRequest('markWarehouseTransferDocumentIssued', payload);

export const requestWarehouseTransferPackage = async (payload: {
  documentId: string;
}): Promise<WarehouseTransferDocument> =>
  appRequest('requestWarehouseTransferPackage', payload);

export const removeWarehouseTransferDocument = async (payload: {
  documentId: string;
}): Promise<void> => appRequest('removeWarehouseTransferDocument', payload);

export const getInventoryAdjustments = async (): Promise<InventoryAdjustment[]> =>
  appRequest('getInventoryAdjustments');

export const applyInventoryAdjustment = async (payload: {
  locationId: string;
  materialId: string;
  qty: number;
  note?: string;
}): Promise<InventoryAdjustment> => appRequest('applyInventoryAdjustment', payload);

export const getMixedMaterials = async (): Promise<MixedMaterial[]> =>
  appRequest('getMixedMaterials');

export const addMixedMaterial = async (payload: {
  name: string;
  qty: number;
  locationId: string;
}): Promise<MixedMaterial> => appRequest('addMixedMaterial', payload);

export const removeMixedMaterial = async (payload: {
  name: string;
  qty: number;
  locationId: string;
}): Promise<MixedMaterial> => appRequest('removeMixedMaterial', payload);

export const deleteMixedMaterial = async (id: string): Promise<void> =>
  appRequest('deleteMixedMaterial', { id });

export const transferMixedMaterial = async (payload: {
  name: string;
  fromLocationId: string;
  toLocationId: string;
  qty: number;
}): Promise<{ from: MixedMaterial; to: MixedMaterial }> =>
  appRequest('transferMixedMaterial', payload);

export const getDryers = async (): Promise<Dryer[]> => appRequest('getDryers');

export const addDryer = async (payload: {
  name: string;
  orderNo?: number;
  isActive?: boolean;
}): Promise<Dryer> => appRequest('addDryer', payload);

export const updateDryer = async (payload: {
  id: string;
  name?: string;
  orderNo?: number;
  isActive?: boolean;
  materialId?: string | null;
}): Promise<Dryer> => appRequest('updateDryer', payload);

export const removeDryer = async (id: string): Promise<Dryer> =>
  appRequest('removeDryer', { id });

export const setDryerMaterial = async (payload: {
  id: string;
  materialId: string | null;
}): Promise<Dryer> => appRequest('setDryerMaterial', payload);

export const getUsers = async (): Promise<AppUser[]> =>
  apiRequest('/api/users', { cache: 'no-store' });

export const addUser = async (payload: {
  name: string;
  username: string;
  password: string;
  role: Role;
  access?: UserAccess;
  groupIds?: string[];
}): Promise<AppUser> =>
  apiRequest('/api/users', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const updateUser = async (payload: {
  id: string;
  name?: string;
  username?: string;
  password?: string;
  role?: Role;
  access?: UserAccess;
  groupIds?: string[];
  isActive?: boolean;
}): Promise<AppUser> =>
  apiRequest(`/api/users/${payload.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const getPermissionGroups = async (): Promise<PermissionGroup[]> =>
  apiRequest('/api/permission-groups', { cache: 'no-store' });

export const addPermissionGroup = async (payload: {
  name: string;
  description?: string | null;
  access?: UserAccess;
  isActive?: boolean;
}): Promise<PermissionGroup> =>
  apiRequest('/api/permission-groups', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const updatePermissionGroup = async (payload: {
  id: string;
  name?: string;
  description?: string | null;
  access?: UserAccess;
  isActive?: boolean;
}): Promise<PermissionGroup> =>
  apiRequest(`/api/permission-groups/${payload.id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const removePermissionGroup = async (id: string): Promise<PermissionGroup> =>
  apiRequest(`/api/permission-groups/${id}`, {
    method: 'DELETE'
  });

export const removeUser = async (id: string): Promise<AppUser> =>
  apiRequest(`/api/users/${id}`, {
    method: 'DELETE'
  });

export const authenticateUser = async (payload: {
  username: string;
  password: string;
  rememberMe?: boolean;
}): Promise<AppUser> =>
  apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const changeOwnPassword = async (payload: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: boolean }> =>
  apiRequest('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const logoutUser = async (): Promise<void> =>
  apiRequest('/api/auth/logout', {
    method: 'POST'
  });

export const getCurrentSessionUser = async (): Promise<AppUser> =>
  apiRequest('/api/auth/session', {
    cache: 'no-store'
  });

export const getSpareParts = async (): Promise<SparePart[]> => appRequest('getSpareParts');

export const getSparePartHistory = async (): Promise<SparePartHistory[]> =>
  appRequest('getSparePartHistory');

export const getOriginalInventory = async (): Promise<OriginalInventoryEntry[]> =>
  appRequest('getOriginalInventory');

export const getOriginalInventoryCatalog = async (): Promise<OriginalInventoryCatalogEntry[]> =>
  appRequest('getOriginalInventoryCatalog');

export const getOriginalInventoryCatalogFromErp = async (): Promise<OriginalInventoryCatalogEntry[]> =>
  appRequest('getOriginalInventoryCatalogFromErp');

export const addOriginalInventory = async (payload: {
  warehouseId: string;
  name: string;
  qty: number;
  unit: string;
  location?: string;
  note?: string;
  at?: string;
  dateKey?: string;
  user?: string;
}): Promise<OriginalInventoryEntry> => appRequest('addOriginalInventory', payload);

export const addOriginalInventoryCatalog = async (payload: {
  name: string;
  unit: string;
}): Promise<OriginalInventoryCatalogEntry> =>
  appRequest('addOriginalInventoryCatalog', payload);

export const addOriginalInventoryCatalogBulk = async (payload: {
  items: Array<{ name: string; unit?: string }>;
}): Promise<OriginalInventoryCatalogImportResult> =>
  appRequest('addOriginalInventoryCatalogBulk', payload);

export const updateOriginalInventory = async (payload: {
  id: string;
  qty: number;
  warehouseId: string;
}): Promise<OriginalInventoryEntry> => appRequest('updateOriginalInventory', payload);

export const removeOriginalInventory = async (entryId: string) =>
  appRequest('removeOriginalInventory', { entryId });

export const removeOriginalInventoryCatalog = async (catalogId: string) =>
  appRequest('removeOriginalInventoryCatalog', { catalogId });

export const addSparePart = async (payload: {
  code: string;
  name: string;
  unit: string;
  qty?: number;
  location?: string;
}): Promise<SparePart> => appRequest('addSparePart', payload);

export const updateSparePart = async (payload: {
  id: string;
  code?: string;
  name?: string;
  unit?: string;
  location?: string;
}): Promise<SparePart> => appRequest('updateSparePart', payload);

export const removeSparePart = async (id: string): Promise<SparePart> =>
  appRequest('removeSparePart', { id });

export const setSparePartQty = async (payload: {
  partId: string;
  qty: number;
  user?: string;
  note?: string;
}): Promise<SparePart> => appRequest('setSparePartQty', payload);

export const adjustSparePart = async (payload: {
  partId: string;
  qty: number;
  kind: 'IN' | 'OUT';
  user?: string;
  note?: string;
}): Promise<SparePart> => appRequest('adjustSparePart', payload);

export const getWarehouses = async (): Promise<Warehouse[]> => appRequest('getWarehouses');

export const getWarehousesAdmin = async (scope?: WarehouseAdminScope): Promise<Warehouse[]> =>
  appRequest('getWarehousesAdmin', scope ? { scope } : undefined);

export const getWarehouse = async (id: string): Promise<Warehouse | null> =>
  appRequest('getWarehouse', { id });

export const getLocation = async (id: string): Promise<Location | null> =>
  appRequest('getLocation', { id });

export const getMaterials = async (): Promise<Material[]> => appRequest('getMaterials');

export const getTodayKey = () => formatDate(new Date());

export const getRaportZmianowySessions = async (
  dateKey?: string
): Promise<RaportZmianowySession[]> =>
  appRequest('getRaportZmianowySessions', dateKey ? { dateKey } : undefined);

export const getRaportZmianowySession = async (
  sessionId: string
): Promise<RaportZmianowySessionData> =>
  appRequest('getRaportZmianowySession', { sessionId });

export const getRaportZmianowyEntries = async (payload: {
  from?: string;
  to?: string;
  indexCode?: string;
  station?: string;
}): Promise<RaportZmianowyEntryLog[]> => appRequest('getRaportZmianowyEntries', payload);

export const createRaportZmianowySession = async (payload: {
  dateKey?: string;
  planSheet: string;
  fileName?: string | null;
  createdBy?: string;
  items?: Array<{
    indexCode: string;
    description?: string | null;
    station?: string | null;
  }>;
}): Promise<RaportZmianowySessionData> =>
  appRequest('createRaportZmianowySession', payload);

export const removeRaportZmianowySession = async (sessionId: string): Promise<void> =>
  appRequest('removeRaportZmianowySession', { sessionId });

export const addRaportZmianowyItem = async (payload: {
  sessionId: string;
  indexCode: string;
  description?: string | null;
  station?: string | null;
}): Promise<RaportZmianowyItem> => appRequest('addRaportZmianowyItem', payload);

export const updateRaportZmianowyItem = async (payload: {
  itemId: string;
  indexCode?: string;
  station?: string | null;
  description?: string | null;
}): Promise<RaportZmianowyItem> => appRequest('updateRaportZmianowyItem', payload);

export const addRaportZmianowyEntry = async (payload: {
  itemId: string;
  note: string;
  authorId?: string | null;
  authorName?: string;
}): Promise<RaportZmianowyEntry> => appRequest('addRaportZmianowyEntry', payload);

export const updateRaportZmianowyEntry = async (payload: {
  entryId: string;
  note: string;
  editedById?: string | null;
  editedByName?: string | null;
}): Promise<RaportZmianowyEntry> => appRequest('updateRaportZmianowyEntry', payload);

export const removeRaportZmianowyEntry = async (entryId: string): Promise<void> =>
  appRequest('removeRaportZmianowyEntry', { entryId });
