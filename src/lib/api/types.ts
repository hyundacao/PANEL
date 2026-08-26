export type Role = 'VIEWER' | 'USER' | 'ADMIN' | 'HEAD_ADMIN';

export type WarehouseKey =
  | 'PRZEMIALY'
  | 'FARBY_TASMY'
  | 'CZESCI'
  | 'RAPORT_ZMIANOWY'
  | 'RAPORT_BRAKOWOSCI'
  | 'BILANS_PRZEZBROJEN'
  | 'PRZYGOTOWANIE_PRODUKCJI'
  | 'PLANOWANIE_ZAPOTRZEBOWANIA'
  | 'PRZESUNIECIA_ERP';

export type WarehouseRole = 'ROZDZIELCA' | 'MECHANIK' | 'PODGLAD';

export type PrzemialyTab =
  | 'dashboard'
  | 'spis'
  | 'spis-oryginalow'
  | 'przesuniecia'
  | 'raporty'
  | 'kartoteka'
  | 'wymieszane'
  | 'suszarki';

export type CzesciTab = 'pobierz' | 'uzupelnij' | 'stany' | 'historia';

export type RaportZmianowyTab = 'raport-zmianowy';

export type RaportBrakowosciTab = 'raport-brakowosci';

export type BilansPrzezbrojenTab = 'bilans-przezbrojen';

export type PrzygotowanieProdukcjiTab = 'przygotowanie-produkcji';

export type PlanowanieZapotrzebowaniaTab = 'planowanie-zapotrzebowania';

export type FarbyTasmyTab = 'rozliczanie-farb-tasm';

export type ErpTransfersTab =
  | 'erp-magazynier'
  | 'erp-rozdzielca'
  | 'erp-rozdzielca-zmianowy'
  | 'erp-wypisz-dokument'
  | 'erp-historia-dokumentow';

export type WarehouseTab =
  | PrzemialyTab
  | FarbyTasmyTab
  | CzesciTab
  | RaportZmianowyTab
  | RaportBrakowosciTab
  | BilansPrzezbrojenTab
  | PrzygotowanieProdukcjiTab
  | PlanowanieZapotrzebowaniaTab
  | ErpTransfersTab;

export type WarehouseAccess = {
  role: WarehouseRole;
  readOnly: boolean;
  tabs: WarehouseTab[];
  admin?: boolean;
};

export type PaintTapePermissionKey =
  | 'create'
  | 'open'
  | 'details'
  | 'accounting'
  | 'accounted'
  | 'celebration';

export type PaintTapePermissions = Record<PaintTapePermissionKey, boolean>;

export type UserAccess = {
  admin: boolean;
  warehouses: Partial<Record<WarehouseKey, WarehouseAccess>>;
  paintTapePermissions?: Partial<PaintTapePermissions>;
};

export type PermissionGroup = {
  id: string;
  name: string;
  description?: string | null;
  access: UserAccess;
  isActive: boolean;
  createdAt: string;
  assignedUsersCount?: number;
};

export type UserPermissionGroup = {
  id: string;
  name: string;
  description?: string | null;
  access: UserAccess;
  isActive: boolean;
};

export type Warehouse = {
  id: string;
  name: string;
  orderNo: number;
  includeInSpis: boolean;
  includeInStats: boolean;
  isActive: boolean;
};

export type Location = {
  id: string;
  warehouseId: string;
  name: string;
  orderNo: number;
  type: 'wtr' | 'pole';
  isActive: boolean;
};

export type Material = {
  id: string;
  code: string;
  name: string;
  catalogId?: string | null;
  catalogName?: string | null;
  isActive: boolean;
};

export type MaterialCatalog = {
  id: string;
  name: string;
  isActive: boolean;
};

export type MaterialCatalogImportResult = {
  total: number;
  inserted: number;
  skipped: number;
};

export type MaterialImportResult = {
  total: number;
  inserted: number;
  skipped: number;
};

export type MixedMaterial = {
  id: string;
  name: string;
  qty: number;
  locationId: string;
};

export type Dryer = {
  id: string;
  name: string;
  orderNo: number;
  isActive: boolean;
  materialId?: string | null;
};

export type LocationOverview = {
  id: string;
  name: string;
  status: 'DONE' | 'PENDING';
  source: 'TODAY' | 'LAST';
  preview: Array<{ label: string; qty: number }>;
  lastTotal: number;
  lastItems: Array<{ label: string; qty: number }>;
  currentItems: Array<{ label: string; qty: number }>;
  empty: boolean;
};

export type LocationDetailItem = {
  materialId: string;
  code: string;
  name: string;
  yesterdayQty: number;
  todayQty: number | null;
  confirmed: boolean;
  comment?: string;
  measurements?: Array<{
    id: string;
    qty: number;
    comment?: string;
    createdAt: string;
  }>;
};

export type OriginalInventoryEntry = {
  id: string;
  at: string;
  warehouseId: string;
  name: string;
  qty: number;
  unit: string;
  location?: string;
  note?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  user: string;
};

export type OriginalInventoryCatalogEntry = {
  id: string;
  name: string;
  unit: string;
  createdAt: string;
  indexCode?: string | null;
  warehouseCode?: string | null;
};

export type OriginalInventorySiloConfig = {
  id: string;
  name: string;
  chamber: string;
  materialName: string;
  warehouseId?: string | null;
  percentKg: number;
  hopperKg: number;
  isActive: boolean;
  orderNo: number;
  updatedAt: string;
};

export type OriginalInventorySiloEntry = {
  id: string;
  configId: string;
  dateKey: string;
  percent: number;
  hopperPresent: boolean;
  calculatedQty: number;
  generatedEntryId?: string | null;
  user: string;
  updatedAt: string;
};

export type OriginalInventoryGrindTaskStatus = 'PENDING' | 'DONE';

export type OriginalInventoryGrindTask = {
  id: string;
  materialName: string;
  targetMaterialName?: string | null;
  qty: number;
  unit: string;
  status: OriginalInventoryGrindTaskStatus;
  sourceReportDate?: string | null;
  createdBy: string;
  createdAt: string;
  completedBy?: string | null;
  completedAt?: string | null;
};

export type OriginalInventoryCatalogImportResult = {
  total: number;
  inserted: number;
  skipped: number;
};

export type OriginalInventoryErpSnapshotEntry = {
  id: string;
  snapshotDate: string;
  name: string;
  realQty: number;
  availableQty: number;
  unit: string;
  indexCode?: string | null;
  warehouseCode?: string | null;
  importedAt: string;
  importedBy: string;
  sourceFileName?: string | null;
};

export type OriginalInventoryErpSnapshotImportResult = {
  total: number;
  inserted: number;
  replaced: number;
  snapshotDate: string;
};

export type PaintTapeSettlementStatus = 'OPEN' | 'DETAILS_REQUIRED' | 'DONE';

export type PaintTapeSettlementIssue = {
  id: string;
  createdAt: string;
  createdBy: string;
  qty: number;
};

export type PaintTapeTechnologyUsage = {
  indexCode: string;
  itemName: string;
  usagePerPiece: number;
  unit: string;
  updatedAt: string;
  updatedBy: string;
};

export type PaintTapeInventoryCategory =
  | 'FARBY'
  | 'FOLIE'
  | 'ROZCIENCZALNIKI'
  | 'TASMY'
  | 'DODATKI';

export type PaintTapeInventoryCatalogItem = {
  id: string;
  itemIndex: string;
  itemCode?: string | null;
  name: string;
  category: PaintTapeInventoryCategory;
  unit: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
};

export type PaintTapeInventorySession = {
  id: string;
  inventoryDate: string;
  status: 'OPEN' | 'CLOSED';
  expectedCount: number;
  checkedCount: number;
  createdAt: string;
  createdBy: string;
  completedAt?: string | null;
  completedBy?: string | null;
};

export type PaintTapeInventoryEntry = {
  id: string;
  sessionId: string;
  catalogItemId: string;
  qty: number;
  location?: string | null;
  note?: string | null;
  checkedAt: string;
  checkedBy: string;
};

export type PaintTapeInventoryData = {
  catalog: PaintTapeInventoryCatalogItem[];
  sessions: PaintTapeInventorySession[];
  session: PaintTapeInventorySession | null;
  entries: PaintTapeInventoryEntry[];
};

export type PaintTapeSettlement = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  orderNumber: string;
  detailName: string;
  itemName: string;
  itemIndexCode?: string | null;
  unit: string;
  startQty: number;
  warehouseIssuedQty: number;
  warehouseIssuedIssues: PaintTapeSettlementIssue[];
  endQty?: number | null;
  producedQty?: number | null;
  usageQty?: number | null;
  usagePerPiece?: number | null;
  orderNote?: string | null;
  usageCheckNote?: string | null;
  status: PaintTapeSettlementStatus;
  productionCompletedAt?: string | null;
  accountedAt?: string | null;
  accountedBy?: string | null;
};

export type DashboardSummary = {
  warehouseId: string;
  warehouseName: string;
  added: number;
  removed: number;
  confirmed: number;
  total: number;
};

export type ReportRow = {
  materialId: string;
  code: string;
  name: string;
  added: number;
  removed: number;
  net: number;
};

export type AuditEvent = {
  id: string;
  at: string;
  user: string;
  action: string;
  warehouse?: string;
  location?: string;
  material?: string;
  prevQty?: number | null;
  nextQty?: number | null;
};

export type InventoryTotalPoint = {
  date: string;
  total: number;
};

export type CatalogTotal = {
  catalog: string;
  total: number;
};

export type MonthlyDelta = {
  added: number;
  removed: number;
};

export type DashboardMonthStats = {
  from: string;
  to: string;
  added: number;
  removed: number;
  net: number;
  daily: Array<{
    date: string;
    added: number;
    removed: number;
    net: number;
  }>;
};

export type MonthlyMaterialBreakdown = {
  added: Array<{ label: string; total: number }>;
  removed: Array<{ label: string; total: number }>;
};

export type DailyTotals = {
  date: string;
  added: number;
  removed: number;
  net: number;
};

export type MaterialReportRow = {
  label: string;
  added: number;
  removed: number;
  net: number;
  addedComments?: string[];
  removedComments?: string[];
};

export type PeriodReport = {
  from: string;
  to: string;
  rows: MaterialReportRow[];
  totals: {
    added: number;
    removed: number;
    net: number;
  };
};

export type YearlyReportRow = {
  month: string;
  added: number;
  removed: number;
  net: number;
};

export type YearlyReport = {
  year: number;
  rows: YearlyReportRow[];
  totals: {
    added: number;
    removed: number;
    net: number;
  };
};

export type MaterialTotal = {
  materialId: string;
  label: string;
  total: number;
};

export type MaterialLocation = {
  locationId: string;
  locationName: string;
  warehouseName: string;
  qty: number;
};

export type MaterialLocationsMap = Record<string, MaterialLocation[]>;

export type RaportZmianowySession = {
  id: string;
  createdAt: string;
  createdBy: string;
  dateKey: string;
  planSheet: string;
  fileName?: string | null;
};

export type RaportZmianowyItem = {
  id: string;
  sessionId: string;
  indexCode: string;
  description?: string | null;
  station?: string | null;
  createdAt: string;
};

export type RaportZmianowyEntry = {
  id: string;
  itemId: string;
  note: string;
  createdAt: string;
  authorId?: string | null;
  authorName: string;
  editedAt?: string | null;
  editedById?: string | null;
  editedByName?: string | null;
};

export type RaportZmianowySessionData = {
  session: RaportZmianowySession;
  items: RaportZmianowyItem[];
  entries: RaportZmianowyEntry[];
};

export type RaportZmianowyEntryLog = RaportZmianowyEntry & {
  indexCode: string;
  station?: string | null;
  description?: string | null;
  sessionId: string;
  sessionDate: string;
};

export type AppUser = {
  id: string;
  name: string;
  username: string;
  role: Role;
  access: UserAccess;
  directAccess?: UserAccess;
  mustChangePassword?: boolean;
  groups?: UserPermissionGroup[];
  groupIds?: string[];
  isActive: boolean;
  createdAt: string;
  lastLogin?: string | null;
};

export type SparePart = {
  id: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  location?: string;
};

export type SparePartHistory = {
  id: string;
  at: string;
  user: string;
  partId: string;
  partName: string;
  qty: number;
  kind: 'IN' | 'OUT';
  note?: string;
};

export type TransferKind = 'INTERNAL' | 'EXTERNAL_IN' | 'EXTERNAL_OUT';

export type Transfer = {
  id: string;
  at: string;
  kind: TransferKind;
  materialId: string;
  qty: number;
  fromLocationId?: string;
  toLocationId?: string;
  partner?: string;
  note?: string;
};

export type WarehouseTransferDocumentStatus = 'OPEN' | 'ISSUED' | 'CLOSED';

export type WarehouseTransferItemStatus = 'PENDING' | 'PARTIAL' | 'DONE' | 'OVER';

export type WarehouseTransferItemPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export type WarehouseTransferDocument = {
  id: string;
  createdAt: string;
  createdById?: string | null;
  createdByName: string;
  documentNumber: string;
  sourceWarehouse?: string;
  targetWarehouse?: string;
  note?: string;
  status: WarehouseTransferDocumentStatus;
  closedAt?: string | null;
  closedByName?: string | null;
};

export type WarehouseTransferDocumentSummary = WarehouseTransferDocument & {
  itemsCount: number;
  completedItemsCount: number;
  plannedQtyTotal: number;
  issuedQtyTotal: number;
  receivedQtyTotal: number;
  searchText?: string;
};

export type ErpTargetLocation = {
  id: string;
  name: string;
  orderNo: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WarehouseTransferItemIssue = {
  id: string;
  itemId: string;
  createdAt: string;
  issuerId?: string | null;
  issuerName: string;
  qty: number;
  note?: string;
};

export type WarehouseTransferItemReceipt = {
  id: string;
  itemId: string;
  createdAt: string;
  receiverId?: string | null;
  receiverName: string;
  qty: number;
  note?: string;
};

export type WarehouseTransferDocumentItem = {
  id: string;
  documentId: string;
  lineNo: number;
  priority: WarehouseTransferItemPriority;
  indexCode: string;
  indexCode2?: string;
  name: string;
  batch?: string;
  location?: string;
  unit: string;
  plannedQty: number;
  note?: string;
  issuedQty: number;
  receivedQty: number;
  diffQty: number;
  status: WarehouseTransferItemStatus;
  issues: WarehouseTransferItemIssue[];
  receipts: WarehouseTransferItemReceipt[];
};

export type WarehouseTransferDocumentDetails = {
  document: WarehouseTransferDocumentSummary;
  items: WarehouseTransferDocumentItem[];
};

export type LocationOption = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  name: string;
  orderNo: number;
  type: 'wtr' | 'pole';
};

export type InventoryAdjustment = {
  id: string;
  at: string;
  locationId: string;
  materialId: string;
  prevQty: number;
  nextQty: number;
  note?: string;
};
