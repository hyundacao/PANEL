'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { useSearchParams } from 'next/navigation';
import {
  addLocation,
  addCatalog,
  addMaterialBulk,
  addMaterialCatalogBulk,
  addMaterial,
  addSparePart,
  addPermissionGroup,
  addUser,
  addWarehouse,
  addDryer,
  applyInventoryAdjustment,
  getAudit,
  getCatalog,
  getCatalogs,
  getDryers,
  getPermissionGroups,
  getLocationsAdmin,
  getLocationDetail,
  getOriginalInventoryCatalog,
  getUsers,
  getSparePartHistory,
  getSpareParts,
  getWarehousesAdmin,
  getTodayKey,
  getInventoryAdjustments,
  removeCatalog,
  removeLocation,
  removeMaterial,
  removeSparePart,
  removeDryer,
  removePermissionGroup,
  removeUser,
  removeWarehouse,
  updateMaterial,
  updateDryer,
  setSparePartQty,
  updateSparePart,
  updateLocation,
  updatePermissionGroup,
  updateUser,
  updateWarehouse
} from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toggle } from '@/components/ui/Toggle';
import { SelectField } from '@/components/ui/Select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { DataTable } from '@/components/ui/DataTable';
import { useUiStore } from '@/lib/store/ui';
import { useToastStore } from '@/components/ui/Toast';
import { cn } from '@/lib/utils/cn';
import { formatKg, parseQtyInput } from '@/lib/utils/format';
import type {
  AppUser,
  Role,
  UserAccess,
  WarehouseKey,
  WarehouseRole,
  WarehouseTab
} from '@/lib/api/types';
import { getRolePreset, isHeadAdmin, isWarehouseAdmin } from '@/lib/auth/access';

type WarehouseDraft = {
  name: string;
  orderNo: string;
  includeInSpis: boolean;
  includeInStats: boolean;
};

type LocationDraft = {
  name: string;
  orderNo: string;
};

type SparePartDraft = {
  code: string;
  name: string;
  unit: string;
  qty: string;
  location: string;
};

type UserDraft = {
  name: string;
  username: string;
  role: Role;
  access: UserAccess;
  groupIds: string[];
  isActive: boolean;
};

type PermissionGroupDraft = {
  name: string;
  description: string;
  access: UserAccess;
  isActive: boolean;
};

type MaterialEditDraft = {
  name: string;
  catalogId: string;
};

type DryerDraft = {
  name: string;
  orderNo: string;
  isActive: boolean;
};

type PrzemialyAdminTab =
  | 'warehouses'
  | 'locations'
  | 'inventory'
  | 'audit'
  | 'positions'
  | 'dryers';

type AccountsAdminTab = 'users' | 'add-user' | 'groups';
const DEFAULT_RESET_PASSWORD = 'MAX123';

const isAccountsAdminTab = (value: string | null): value is AccountsAdminTab =>
  value === 'users' || value === 'add-user' || value === 'groups';

const roleOptions = [
  { value: 'HEAD_ADMIN', label: 'Head admin' },
  { value: 'ADMIN', label: 'Administrator' },
  { value: 'USER', label: 'Uzytkownik' }
] as const;
const przemialyTabOptions: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'dashboard', label: 'Pulpit' },
  { key: 'spis', label: 'Spis przemialow' },
  { key: 'spis-oryginalow', label: 'Spis oryginalow' },
  { key: 'przesuniecia', label: 'Przesuniecia przemialowe' },
  { key: 'raporty', label: 'Raporty' },
  { key: 'kartoteka', label: 'Stany magazynowe' },
  { key: 'wymieszane', label: 'Wymieszane tworzywa' },
  { key: 'suszarki', label: 'Suszarki' }
];
const czesciTabOptions: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'pobierz', label: 'Pobierz' },
  { key: 'uzupelnij', label: 'Uzupelnij' },
  { key: 'stany', label: 'Stany magazynowe' },
  { key: 'historia', label: 'Historia (head admin lub admin modulu)' }
];
const raportZmianowyTabOptions: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'raport-zmianowy', label: 'Raport zmianowy' }
];
const erpModuleTabOptions: Array<{ key: WarehouseTab; label: string }> = [
  { key: 'erp-magazynier', label: 'Magazynier' },
  { key: 'erp-rozdzielca', label: 'Rozdzielca' },
  { key: 'erp-wypisz-dokument', label: 'Wypisz dokument' },
  { key: 'erp-historia-dokumentow', label: 'Historia dokumentow' }
];
const warehouseLabels: Record<WarehouseKey, string> = {
  PRZEMIALY: 'Zarządzanie przemiałami i przygotowaniem produkcji',
  CZESCI: 'Magazyn czesci zamiennych',
  RAPORT_ZMIANOWY: 'Raport zmianowy',
  PRZESUNIECIA_ERP: 'Przesuniecia magazynowe ERP'
};
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const compareByName = (a: { name: string }, b: { name: string }) =>
  collator.compare(a.name, b.name);
const PRZEMIALY_TAB_STORAGE_KEY = 'admin-przemialy-tab';
const roleOptionsSorted = [...roleOptions].sort((a, b) => collator.compare(a.label, b.label));
const cloneAccess = (access: UserAccess): UserAccess => ({
  admin: access.admin,
  warehouses: Object.fromEntries(
    Object.entries(access.warehouses).map(([key, value]) => [
      key,
      value ? { ...value, tabs: [...value.tabs] } : value
    ])
  ) as UserAccess['warehouses']
});

const isRecordEqual = <T,>(
  left: Record<string, T>,
  right: Record<string, T>,
  isItemEqual: (leftItem: T, rightItem: T) => boolean
) => {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!(key in right)) return false;
    if (!isItemEqual(left[key], right[key])) return false;
  }
  return true;
};

const accessKey = (access: UserAccess) => {
  const warehouseKeys = Object.keys(access.warehouses).sort();
  const warehouseKey = warehouseKeys
    .map((key) => {
      const entry = access.warehouses[key as WarehouseKey];
      if (!entry) return `${key}:none`;
      const tabsKey = [...entry.tabs].sort().join(',');
      const adminKey = entry.admin ? 1 : 0;
      return `${key}:${entry.role}:${entry.readOnly ? 1 : 0}:${adminKey}:${tabsKey}`;
    })
    .join('|');
  return `${access.admin ? 1 : 0}|${warehouseKey}`;
};

const groupIdsKey = (groupIds: string[]) =>
  [...new Set(groupIds.map((item) => item.trim()).filter(Boolean))]
    .sort((a, b) => collator.compare(a, b))
    .join('|');

const isWarehouseDraftEqual = (left: WarehouseDraft, right: WarehouseDraft) =>
  left.name === right.name &&
  left.orderNo === right.orderNo &&
  left.includeInSpis === right.includeInSpis &&
  left.includeInStats === right.includeInStats;

const isLocationDraftEqual = (left: LocationDraft, right: LocationDraft) =>
  left.name === right.name && left.orderNo === right.orderNo;

const isDryerDraftEqual = (left: DryerDraft, right: DryerDraft) =>
  left.name === right.name && left.orderNo === right.orderNo && left.isActive === right.isActive;

const isSparePartDraftEqual = (left: SparePartDraft, right: SparePartDraft) =>
  left.code === right.code &&
  left.name === right.name &&
  left.unit === right.unit &&
  left.qty === right.qty &&
  left.location === right.location;

const isUserDraftEqual = (left: UserDraft, right: UserDraft) =>
  left.name === right.name &&
  left.username === right.username &&
  left.role === right.role &&
  left.isActive === right.isActive &&
  groupIdsKey(left.groupIds) === groupIdsKey(right.groupIds) &&
  accessKey(left.access) === accessKey(right.access);

const isPermissionGroupDraftEqual = (
  left: PermissionGroupDraft,
  right: PermissionGroupDraft
) =>
  left.name === right.name &&
  left.description === right.description &&
  left.isActive === right.isActive &&
  accessKey(left.access) === accessKey(right.access);

const AdminToggle = ({
  checked,
  onCheckedChange,
  label,
  disabled
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
}) => (
  <label className={cn('flex items-center gap-3 text-sm text-body', disabled && 'opacity-60')}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative h-7 w-12 rounded-full border border-[rgba(255,122,26,0.45)] bg-[rgba(10,10,12,0.65)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.35)] transition',
        checked &&
          'border-[rgba(255,122,26,0.95)] bg-[linear-gradient(180deg,rgba(255,186,122,0.55),rgba(255,122,26,0.55))] shadow-[0_0_0_2px_rgba(255,122,26,0.25)]'
      )}
    >
      <span
        className={cn(
          'block h-4.5 w-4.5 translate-x-1 rounded-full bg-[rgba(255,255,255,0.9)] shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition',
          checked && 'translate-x-6 bg-[#FF7A1A] shadow-[0_0_0_2px_rgba(255,255,255,0.6)]'
        )}
      />
    </button>
    {label && <span>{label}</span>}
  </label>
);


export default function AdminPage() {
  const searchParams = useSearchParams();
  const { user: currentUser, activeWarehouse } = useUiStore();
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const today = getTodayKey();
  const canManageAccounts = Boolean(currentUser && isHeadAdmin(currentUser));
  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';
  const { data: auditData } = useQuery({ queryKey: ['audit'], queryFn: getAudit });
  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-admin'],
    queryFn: () => getWarehousesAdmin()
  });
  const { data: catalogData } = useQuery({
    queryKey: ['catalog'],
    queryFn: getCatalog
  });
  const { data: catalogsData } = useQuery({
    queryKey: ['material-catalogs'],
    queryFn: getCatalogs
  });
  const { data: originalCatalogData } = useQuery({
    queryKey: ['spis-oryginalow-catalog'],
    queryFn: getOriginalInventoryCatalog
  });
  const { data: locationsData } = useQuery({
    queryKey: ['locations-admin'],
    queryFn: () => getLocationsAdmin()
  });
  const { data: inventoryAdjustmentsData } = useQuery({
    queryKey: ['inventory-adjustments'],
    queryFn: getInventoryAdjustments
  });
  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts'],
    queryFn: getSpareParts
  });
  const { data: spareHistoryData } = useQuery({
    queryKey: ['spare-parts-history'],
    queryFn: getSparePartHistory
  });
  const { data: dryersData, isLoading: dryersLoading } = useQuery({
    queryKey: ['dryers'],
    queryFn: getDryers
  });
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: canManageAccounts
  });
  const { data: permissionGroupsData } = useQuery({
    queryKey: ['permission-groups'],
    queryFn: getPermissionGroups,
    enabled: canManageAccounts
  });

  const audit = useMemo(() => auditData ?? [], [auditData]);
  const warehouses = useMemo(() => warehousesData ?? [], [warehousesData]);
  const catalog = useMemo(() => catalogData ?? [], [catalogData]);
  const catalogs = useMemo(() => catalogsData ?? [], [catalogsData]);
  const originalCatalog = useMemo(() => originalCatalogData ?? [], [originalCatalogData]);
  const locations = useMemo(() => locationsData ?? [], [locationsData]);
  const inventoryAdjustments = useMemo(
    () => inventoryAdjustmentsData ?? [],
    [inventoryAdjustmentsData]
  );
  const spareParts = useMemo(() => sparePartsData ?? [], [sparePartsData]);
  const spareHistory = useMemo(() => spareHistoryData ?? [], [spareHistoryData]);
  const users = useMemo(() => usersData ?? [], [usersData]);
  const permissionGroups = useMemo(
    () => permissionGroupsData ?? [],
    [permissionGroupsData]
  );
  const dryers = useMemo(() => dryersData ?? [], [dryersData]);

  const activeWarehouses = useMemo(
    () => warehouses.filter((item) => item.isActive),
    [warehouses]
  );
  const activeLocations = useMemo(
    () => locations.filter((item) => item.isActive),
    [locations]
  );
  const warehouseNameMap = useMemo(
    () => new Map(warehouses.map((item) => [item.id, item.name])),
    [warehouses]
  );
  const activeWarehouseOptions = useMemo(
    () => [...activeWarehouses].sort(compareByName),
    [activeWarehouses]
  );
  const materialOptions = useMemo(() => [...catalog].sort(compareByName), [catalog]);
  const erpCatalogOptions = useMemo(() => [...catalogs].sort(compareByName), [catalogs]);
  const materialGroups = useMemo(
    () =>
      Array.from(new Set(materialOptions.map((item) => item.code))).sort((a, b) =>
        collator.compare(a, b)
      ),
    [materialOptions]
  );
  const materialOptionsByGroup = useMemo(() => {
    const map = new Map<string, typeof materialOptions>();
    materialOptions.forEach((mat) => {
      const key = mat.code.trim();
      const list = map.get(key);
      if (list) {
        list.push(mat);
      } else {
        map.set(key, [mat]);
      }
    });
    map.forEach((list) => list.sort(compareByName));
    return map;
  }, [materialOptions]);
  const dryerMaterialMap = useMemo(() => {
    const map = new Map<string, string>();
    catalog.forEach((item) => map.set(item.id, item.name));
    originalCatalog.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [catalog, originalCatalog]);
  const sortedDryers = useMemo(() => {
    const list = [...dryers];
    list.sort((a, b) => {
      const order = a.orderNo - b.orderNo;
      if (order !== 0) return order;
      return collator.compare(a.name, b.name);
    });
    return list;
  }, [dryers]);

  const [warehouseForm, setWarehouseForm] = useState<{
    name: string;
    orderNo: string;
    includeInSpis: boolean;
    includeInStats: boolean;
  }>({
    name: '',
    orderNo: '',
    includeInSpis: true,
    includeInStats: true
  });
  const [locationForm, setLocationForm] = useState<{
    warehouseId: string;
    type: 'wtr' | 'pole';
    name: string;
    orderNo: string;
  }>({
    warehouseId: '',
    type: 'wtr',
    name: '',
    orderNo: ''
  });
  const [warehouseDrafts, setWarehouseDrafts] = useState<Record<string, WarehouseDraft>>({});
  const [locationDrafts, setLocationDrafts] = useState<Record<string, LocationDraft>>({});
  const [inventoryForm, setInventoryForm] = useState({
    warehouseId: '',
    locationId: '',
    materialId: '',
    qty: '',
    note: ''
  });
  const [inventoryDrafts, setInventoryDrafts] = useState<Record<string, string>>({});
  const [inventoryFilters, setInventoryFilters] = useState({
    dateFrom: '',
    dateTo: '',
    warehouseId: '',
    locationId: '',
    materialId: '',
    qtyMin: '',
    qtyMax: ''
  });
  const [inventorySort, setInventorySort] = useState<{
    key: 'date' | 'warehouse' | 'location' | 'material' | 'prev' | 'next';
    direction: 'asc' | 'desc';
  }>({ key: 'date', direction: 'desc' });
  const [positionsAction, setPositionsAction] = useState<
    'addCatalog' | 'addMaterial' | 'removeCatalog' | 'removeMaterial' | null
  >(null);
  const [catalogForm, setCatalogForm] = useState({ name: '' });
  const [materialForm, setMaterialForm] = useState({ catalogId: '', name: '' });
  const [removeCatalogId, setRemoveCatalogId] = useState('');
  const [removeCatalogWithMaterials, setRemoveCatalogWithMaterials] = useState(false);
  const [removeMaterialId, setRemoveMaterialId] = useState('');
  const [materialCatalogImporting, setMaterialCatalogImporting] = useState(false);
  const [materialCatalogImportSummary, setMaterialCatalogImportSummary] = useState<{
    total: number;
    inserted: number;
    skipped: number;
  } | null>(null);
  const [materialImporting, setMaterialImporting] = useState(false);
  const [materialImportSummary, setMaterialImportSummary] = useState<{
    total: number;
    inserted: number;
    skipped: number;
  } | null>(null);
  const [materialEdits, setMaterialEdits] = useState<Record<string, MaterialEditDraft>>({});
  const [dryerDrafts, setDryerDrafts] = useState<Record<string, DryerDraft>>({});
  const [sparePartForm, setSparePartForm] = useState({
    code: '',
    name: '',
    unit: 'szt',
    qty: '',
    location: ''
  });
  const [sparePartDrafts, setSparePartDrafts] = useState<Record<string, SparePartDraft>>({});
  const [sparePartSearch, setSparePartSearch] = useState('');
  const [spareHistorySearch, setSpareHistorySearch] = useState('');
  const [userForm, setUserForm] = useState<{
    name: string;
    username: string;
    password: string;
    role: Role;
    access: UserAccess;
    groupIds: string[];
  }>({
    name: '',
    username: '',
    password: '',
    role: 'USER',
    access: { admin: false, warehouses: {} },
    groupIds: []
  });
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});
  const [permissionGroupForm, setPermissionGroupForm] = useState<PermissionGroupDraft>({
    name: '',
    description: '',
    access: { admin: false, warehouses: {} },
    isActive: true
  });
  const [permissionGroupDrafts, setPermissionGroupDrafts] = useState<
    Record<string, PermissionGroupDraft>
  >({});
  const [selectedAccessUserId, setSelectedAccessUserId] = useState<string | null>(null);
  const [selectedPermissionGroupId, setSelectedPermissionGroupId] = useState<string | null>(null);
  const [accountsTab, setAccountsTab] = useState<AccountsAdminTab>('users');
  const [przemialyTab, setPrzemialyTab] = useState<PrzemialyAdminTab>('warehouses');
  const [tabReady, setTabReady] = useState(false);
  const [dryerForm, setDryerForm] = useState({
    name: '',
    orderNo: '',
    isActive: true
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const urlTab = params.get('tab');
    const saved = window.localStorage.getItem(PRZEMIALY_TAB_STORAGE_KEY);
    const candidate = urlTab || saved;
    if (
      candidate === 'warehouses' ||
      candidate === 'locations' ||
      candidate === 'inventory' ||
      candidate === 'audit' ||
      candidate === 'positions' ||
      candidate === 'dryers'
    ) {
      setPrzemialyTab(candidate);
    }
    setTabReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !tabReady) return;
    window.localStorage.setItem(PRZEMIALY_TAB_STORAGE_KEY, przemialyTab);
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') !== przemialyTab) {
      url.searchParams.set('tab', przemialyTab);
      window.history.pushState(null, '', url.toString());
    }
  }, [przemialyTab, tabReady]);

  const updateUserFormAccess = (updater: (current: UserAccess) => UserAccess) => {
    setUserForm((prev) => ({ ...prev, access: updater(cloneAccess(prev.access)) }));
  };

  const updatePermissionGroupFormAccess = (updater: (current: UserAccess) => UserAccess) => {
    setPermissionGroupForm((prev) => ({
      ...prev,
      access: updater(cloneAccess(prev.access))
    }));
  };

  const updateUserDraftAccess = (userId: string, updater: (current: UserAccess) => UserAccess) => {
    setUserDrafts((prev) => {
      const draft = prev[userId];
      if (!draft) return prev;
      return { ...prev, [userId]: { ...draft, access: updater(cloneAccess(draft.access)) } };
    });
  };

  const updatePermissionGroupDraftAccess = (
    groupId: string,
    updater: (current: UserAccess) => UserAccess
  ) => {
    setPermissionGroupDrafts((prev) => {
      const draft = prev[groupId];
      if (!draft) return prev;
      return { ...prev, [groupId]: { ...draft, access: updater(cloneAccess(draft.access)) } };
    });
  };

  const toggleUserFormGroup = (groupId: string, checked: boolean) => {
    setUserForm((prev) => {
      const nextSet = new Set(prev.groupIds);
      if (checked) {
        nextSet.add(groupId);
      } else {
        nextSet.delete(groupId);
      }
      return { ...prev, groupIds: Array.from(nextSet) };
    });
  };

  const toggleUserDraftGroup = (userId: string, groupId: string, checked: boolean) => {
    setUserDrafts((prev) => {
      const draft = prev[userId];
      if (!draft) return prev;
      const nextSet = new Set(draft.groupIds);
      if (checked) {
        nextSet.add(groupId);
      } else {
        nextSet.delete(groupId);
      }
      return { ...prev, [userId]: { ...draft, groupIds: Array.from(nextSet) } };
    });
  };

  const formatAccessSummary = (access: UserAccess, role: Role, groupIds: string[] = []) => {
    if (role === 'HEAD_ADMIN') {
      return 'Head admin (pelny dostep)';
    }
    const assignedGroupNames = permissionGroups
      .filter((group) => groupIds.includes(group.id))
      .map((group) => group.name);
    const entries = Object.entries(access.warehouses)
      .map(([key, value]) => {
        if (!value) return null;
        const label = warehouseLabels[key as WarehouseKey] ?? key;
        const roleLabel = role === 'ADMIN' && value.admin ? 'Administrator modulu' : 'Uzytkownik';
        return `${label}: ${roleLabel}`;
      })
      .filter(Boolean);
    if (entries.length === 0) {
      if (assignedGroupNames.length === 0) {
        return 'Brak przypisanych uprawnien';
      }
      return `Grupy: ${assignedGroupNames.join(', ')}`;
    }
    if (assignedGroupNames.length === 0) {
      return entries.join(', ');
    }
    return `Grupy: ${assignedGroupNames.join(', ')} | Ręczne: ${entries.join(', ')}`;
  };

  const renderWarehouseAccess = (
    warehouseKey: WarehouseKey,
    access: UserAccess,
    onChange: (updater: (current: UserAccess) => UserAccess) => void,
    userRole: Role
  ) => {
    const warehouseAccess = access.warehouses[warehouseKey];
    const enabled = Boolean(warehouseAccess);
    const defaultRole: WarehouseRole =
      warehouseKey === 'CZESCI' ? 'MECHANIK' : 'ROZDZIELCA';
    const isHeadAdminUser = userRole === 'HEAD_ADMIN';
    const canAssignAdmin = userRole === 'ADMIN';
    const canSeeHistory =
      userRole === 'HEAD_ADMIN' ||
      (userRole === 'ADMIN' && Boolean(warehouseAccess?.admin));
    const tabOptions =
      warehouseKey === 'PRZEMIALY'
        ? przemialyTabOptions
        : warehouseKey === 'RAPORT_ZMIANOWY'
          ? raportZmianowyTabOptions
          : czesciTabOptions;
    const visibleTabs =
      warehouseKey === 'CZESCI' && !canSeeHistory
        ? tabOptions.filter((tab) => tab.key !== 'historia')
        : tabOptions;
    const blockEditing = isHeadAdminUser;
    const readOnlyValue = enabled && warehouseAccess ? warehouseAccess.readOnly : false;
    const adminValue = enabled && warehouseAccess ? Boolean(warehouseAccess.admin) : false;

    return (
      <Card key={warehouseKey} className={`space-y-3 ${blockEditing ? 'opacity-70' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dostep</p>
            <p className="text-sm font-semibold text-title">{warehouseLabels[warehouseKey]}</p>
          </div>
          <AdminToggle
            checked={enabled}
            onCheckedChange={(value) => {
              if (blockEditing) return;
              onChange((current) => {
                const next = cloneAccess(current);
                if (!value) {
                  delete next.warehouses[warehouseKey];
                  return next;
                }
                next.warehouses[warehouseKey] = getRolePreset(warehouseKey, defaultRole);
                return next;
              });
            }}
            disabled={blockEditing}
          />
        </div>

        <div
          className={`space-y-3 ${blockEditing ? 'pointer-events-none' : ''} ${
            !enabled ? 'opacity-70' : ''
          }`}
        >
          {canAssignAdmin && (
            <AdminToggle
              checked={adminValue}
              onCheckedChange={(value) =>
                onChange((current) => {
                  const next = cloneAccess(current);
                  const currentAccess = next.warehouses[warehouseKey];
                  if (!currentAccess) return next;
                  currentAccess.admin = value;
                  return next;
                })
              }
              label="Administrator modulu"
              disabled={blockEditing || !enabled}
            />
          )}
          <AdminToggle
            checked={readOnlyValue}
            onCheckedChange={(value) =>
              onChange((current) => {
                const next = cloneAccess(current);
                const currentAccess = next.warehouses[warehouseKey];
                if (!currentAccess) return next;
                currentAccess.readOnly = value;
                return next;
              })
            }
            label="Tylko do odczytu"
            disabled={blockEditing || !enabled}
          />

          <div className="grid gap-2 sm:grid-cols-2">
            {visibleTabs.map((tab) => (
              <AdminToggle
                key={`${warehouseKey}-${tab.key}`}
                checked={enabled && warehouseAccess ? warehouseAccess.tabs.includes(tab.key) : false}
                onCheckedChange={(value) =>
                  onChange((current) => {
                    const next = cloneAccess(current);
                    const currentAccess = next.warehouses[warehouseKey];
                    if (!currentAccess) return next;
                    const set = new Set(currentAccess.tabs);
                    if (value) {
                      set.add(tab.key);
                    } else {
                      set.delete(tab.key);
                    }
                    currentAccess.tabs = Array.from(set);
                    return next;
                  })
                }
                label={tab.label}
                disabled={blockEditing || !enabled}
              />
            ))}
          </div>
          {!enabled && (
            <p className="text-xs text-dim">
              Wlacz dostep, aby aktywowac uprawnienia i zakladki tego modulu.
            </p>
          )}
          {warehouseKey === 'CZESCI' && !canSeeHistory && (
            <p className="text-xs text-dim">
              Historia ruchow jest dostepna tylko dla head admina lub administratora modulu.
            </p>
          )}
        </div>
        {blockEditing && (
          <p className="text-xs text-dim">Head admin ma pelny dostep do wszystkich magazynow.</p>
        )}
      </Card>
    );
  };

  const renderErpModuleAccess = (
    access: UserAccess,
    onChange: (updater: (current: UserAccess) => UserAccess) => void,
    userRole: Role
  ) => {
    const warehouseAccess = access.warehouses.PRZESUNIECIA_ERP;
    const enabled = Boolean(warehouseAccess);
    const blockEditing = userRole === 'HEAD_ADMIN';
    const readOnlyValue = enabled && warehouseAccess ? warehouseAccess.readOnly : false;

    return (
      <Card className={`space-y-3 ${blockEditing ? 'opacity-70' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dostep</p>
            <p className="text-sm font-semibold text-title">Przesuniecia magazynowe ERP</p>
          </div>
          <AdminToggle
            checked={enabled}
            onCheckedChange={(value) => {
              if (blockEditing) return;
              onChange((current) => {
                const next = cloneAccess(current);
                const currentAccess = next.warehouses.PRZESUNIECIA_ERP;

                if (value) {
                  if (!currentAccess) {
                    next.warehouses.PRZESUNIECIA_ERP = {
                      role: 'ROZDZIELCA',
                      readOnly: false,
                      tabs: erpModuleTabOptions.map((tab) => tab.key),
                      admin: false
                    };
                    return next;
                  }
                  currentAccess.readOnly = false;
                  currentAccess.tabs = Array.from(
                    new Set([...currentAccess.tabs, ...erpModuleTabOptions.map((tab) => tab.key)])
                  );
                  return next;
                }

                delete next.warehouses.PRZESUNIECIA_ERP;
                return next;
              });
            }}
            disabled={blockEditing}
          />
        </div>
        <div className={cn('grid gap-2 sm:grid-cols-2', !enabled && 'opacity-70')}>
          <AdminToggle
            checked={readOnlyValue}
            onCheckedChange={(value) => {
              if (blockEditing || !enabled) return;
              onChange((current) => {
                const next = cloneAccess(current);
                const currentAccess = next.warehouses.PRZESUNIECIA_ERP;
                if (!currentAccess) return next;
                currentAccess.readOnly = value;
                return next;
              });
            }}
            label="Tylko do odczytu"
            disabled={blockEditing || !enabled}
          />
          {erpModuleTabOptions.map((tab) => (
            <AdminToggle
              key={`erp-module-${tab.key}`}
              checked={enabled && Boolean(warehouseAccess?.tabs.includes(tab.key))}
              onCheckedChange={(value) => {
                if (blockEditing || !enabled) return;
                onChange((current) => {
                  const next = cloneAccess(current);
                  const currentAccess = next.warehouses.PRZESUNIECIA_ERP;
                  if (!currentAccess) return next;
                  const set = new Set(currentAccess.tabs);
                  if (value) {
                    set.add(tab.key);
                  } else {
                    set.delete(tab.key);
                  }
                  currentAccess.tabs = Array.from(set);
                  return next;
                });
              }}
              label={tab.label}
              disabled={blockEditing || !enabled}
            />
          ))}
        </div>
        {!enabled && (
          <p className="text-xs text-dim">
            Wlacz dostep, aby aktywowac uprawnienia modulu ERP.
          </p>
        )}
        {blockEditing && (
          <p className="text-xs text-dim">Head admin ma pelny dostep do wszystkich magazynow.</p>
        )}
      </Card>
    );
  };

  useEffect(() => {
    const next: Record<string, WarehouseDraft> = {};
    activeWarehouses.forEach((warehouse) => {
      next[warehouse.id] = {
        name: warehouse.name,
        orderNo: String(warehouse.orderNo),
        includeInSpis: warehouse.includeInSpis,
        includeInStats: warehouse.includeInStats
      };
    });
    setWarehouseDrafts((prev) =>
      isRecordEqual(prev, next, isWarehouseDraftEqual) ? prev : next
    );
  }, [activeWarehouses]);

  useEffect(() => {
    const next: Record<string, LocationDraft> = {};
    activeLocations.forEach((location) => {
      next[location.id] = { name: location.name, orderNo: String(location.orderNo) };
    });
    setLocationDrafts((prev) =>
      isRecordEqual(prev, next, isLocationDraftEqual) ? prev : next
    );
  }, [activeLocations]);

  useEffect(() => {
    const next: Record<string, UserDraft> = {};
    users.forEach((user) => {
      next[user.id] = {
        name: user.name,
        username: user.username,
        role: user.role,
        access: cloneAccess(user.directAccess ?? user.access),
        groupIds: [...(user.groupIds ?? [])],
        isActive: user.isActive
      };
    });
    setUserDrafts((prev) => (isRecordEqual(prev, next, isUserDraftEqual) ? prev : next));
  }, [users]);

  useEffect(() => {
    const next: Record<string, PermissionGroupDraft> = {};
    permissionGroups.forEach((group) => {
      next[group.id] = {
        name: group.name,
        description: group.description ?? '',
        access: cloneAccess(group.access),
        isActive: group.isActive
      };
    });
    setPermissionGroupDrafts((prev) =>
      isRecordEqual(prev, next, isPermissionGroupDraftEqual) ? prev : next
    );
  }, [permissionGroups]);

  useEffect(() => {
    const section = searchParams.get('section');
    const next = isAccountsAdminTab(section) ? section : 'users';
    setAccountsTab((prev) => (prev === next ? prev : next));
  }, [searchParams]);

  useEffect(() => {
    if (!selectedPermissionGroupId) return;
    if (!permissionGroups.some((group) => group.id === selectedPermissionGroupId)) {
      setSelectedPermissionGroupId(null);
    }
  }, [permissionGroups, selectedPermissionGroupId]);

  useEffect(() => {
    const next: Record<string, SparePartDraft> = {};
    spareParts.forEach((part) => {
      next[part.id] = {
        code: part.code,
        name: part.name,
        unit: part.unit,
        qty: String(part.qty),
        location: part.location ?? ''
      };
    });
    setSparePartDrafts((prev) =>
      isRecordEqual(prev, next, isSparePartDraftEqual) ? prev : next
    );
  }, [spareParts]);

  useEffect(() => {
    if (!locationForm.warehouseId && activeWarehouses.length > 0) {
      setLocationForm((prev) => ({ ...prev, warehouseId: activeWarehouses[0].id }));
    }
  }, [activeWarehouses, locationForm.warehouseId]);

  useEffect(() => {
    if (!inventoryForm.warehouseId && activeWarehouses.length > 0) {
      setInventoryForm((prev) => ({ ...prev, warehouseId: activeWarehouses[0].id }));
    }
  }, [activeWarehouses, inventoryForm.warehouseId]);

  const inventoryLocations = useMemo(() => {
    if (!inventoryForm.warehouseId) return [];
    return activeLocations
      .filter((loc) => loc.warehouseId === inventoryForm.warehouseId)
      .sort(compareByName);
  }, [activeLocations, inventoryForm.warehouseId]);

  useEffect(() => {
    if (!inventoryForm.warehouseId) return;
    const exists = inventoryLocations.some((loc) => loc.id === inventoryForm.locationId);
    if (!exists) {
      setInventoryForm((prev) => ({
        ...prev,
        locationId: inventoryLocations[0]?.id ?? ''
      }));
    }
  }, [inventoryForm.warehouseId, inventoryForm.locationId, inventoryLocations]);

  const { data: inventoryDetail = [] } = useQuery({
    queryKey: ['inventory-detail', inventoryForm.warehouseId, inventoryForm.locationId, today],
    queryFn: () =>
      getLocationDetail(inventoryForm.warehouseId, inventoryForm.locationId, today),
    enabled: Boolean(inventoryForm.warehouseId && inventoryForm.locationId)
  });

  useEffect(() => {
    if (!inventoryForm.locationId) {
      setInventoryDrafts((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const next: Record<string, string> = {};
    inventoryDetail.forEach((row) => {
      const currentQty =
        typeof row.todayQty === 'number' ? row.todayQty : row.yesterdayQty;
      if (currentQty > 0) {
        next[row.materialId] = String(currentQty);
      }
    });
    setInventoryDrafts((prev) =>
      isRecordEqual(prev, next, (left, right) => left === right) ? prev : next
    );
  }, [inventoryDetail, inventoryForm.locationId]);

  const currentInventoryRow = useMemo(
    () => inventoryDetail.find((item) => item.materialId === inventoryForm.materialId) ?? null,
    [inventoryDetail, inventoryForm.materialId]
  );
  const currentInventoryQty =
    currentInventoryRow === null
      ? null
      : typeof currentInventoryRow.todayQty === 'number'
      ? currentInventoryRow.todayQty
      : currentInventoryRow.yesterdayQty;

  const invalidateMaterialQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['catalog'] });
    queryClient.invalidateQueries({ queryKey: ['material-catalogs'] });
    queryClient.invalidateQueries({ queryKey: ['material-totals'] });
    queryClient.invalidateQueries({ queryKey: ['material-locations', today] });
    queryClient.invalidateQueries({ queryKey: ['top-catalog', today] });
    queryClient.invalidateQueries({ queryKey: ['monthly-delta', today] });
    queryClient.invalidateQueries({ queryKey: ['monthly-breakdown', today] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['daily-history'] });
    queryClient.invalidateQueries({ queryKey: ['report-period'] });
    queryClient.invalidateQueries({ queryKey: ['report-yearly'] });
  };

  const addMaterialMutation = useMutation({
    mutationFn: addMaterial,
    onSuccess: () => {
      invalidateMaterialQueries();
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        DUPLICATE: 'Pozycja juz istnieje.',
        CATALOG_REQUIRED: 'Wybierz poprawna kartoteke.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie dodano czesci.',
        tone: 'error'
      });
    }
  });

  const addCatalogMutation = useMutation({
    mutationFn: addCatalog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['material-catalogs'] });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        DUPLICATE: 'Kartoteka juz istnieje.',
        NAME_REQUIRED: 'Podaj nazwe kartoteki ERP.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie dodano kartoteki.',
        tone: 'error'
      });
    }
  });

  const updateMaterialMutation = useMutation({
    mutationFn: updateMaterial,
    onSuccess: (_data, variables) => {
      setMaterialEdits((prev) => {
        const next = { ...prev };
        delete next[variables.materialId];
        return next;
      });
      invalidateMaterialQueries();
      queryClient.invalidateQueries({ queryKey: ['material-catalogs'] });
      toast({ title: 'Zapisano przemial', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_NAME: 'Podaj nazwe przemialu.',
        CATALOG_REQUIRED: 'Wybierz poprawna kartoteke.',
        NOT_FOUND: 'Nie znaleziono przemialu.',
        DUPLICATE: 'Przemial o tej nazwie jest juz w tej kartotece.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie zapisano przemialu.', tone: 'error' });
    }
  });

  const removeMaterialMutation = useMutation({
    mutationFn: removeMaterial,
    onSuccess: () => {
      invalidateMaterialQueries();
    },
    onError: () => {
      toast({ title: 'Nie usunieto przemialu.', tone: 'error' });
    }
  });

  const removeCatalogMutation = useMutation({
    mutationFn: removeCatalog,
    onSuccess: () => {
      invalidateMaterialQueries();
      queryClient.invalidateQueries({ queryKey: ['material-catalogs'] });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        IN_USE: 'Kartoteka ma przypisane przemialy. Zaznacz usuniecie razem z przemialami.',
        NOT_FOUND: 'Nie znaleziono kartoteki.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie usunieto kartoteki.', tone: 'error' });
    }
  });

  const addWarehouseMutation = useMutation({
    mutationFn: addWarehouse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses-admin'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      toast({ title: 'Dodano magazyn', tone: 'success' });
      setWarehouseForm({ name: '', orderNo: '', includeInSpis: true, includeInStats: true });
    },
    onError: (err: Error) => {
      const message = err.message === 'DUPLICATE' ? 'Magazyn juz istnieje.' : 'Nie udalo sie dodac.';
      toast({ title: message, tone: 'error' });
    }
  });

  const updateWarehouseMutation = useMutation({
    mutationFn: updateWarehouse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses-admin'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-delta'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['material-totals'] });
      queryClient.invalidateQueries({ queryKey: ['top-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['totals-history'] });
      queryClient.invalidateQueries({ queryKey: ['daily-history'] });
      queryClient.invalidateQueries({ queryKey: ['report-period'] });
      queryClient.invalidateQueries({ queryKey: ['report-yearly'] });
      toast({ title: 'Zapisano magazyn', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie zapisano magazynu', tone: 'error' });
    }
  });

  const removeWarehouseMutation = useMutation({
    mutationFn: removeWarehouse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warehouses-admin'] });
      queryClient.invalidateQueries({ queryKey: ['locations-admin'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-delta'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['material-totals'] });
      queryClient.invalidateQueries({ queryKey: ['top-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['totals-history'] });
      queryClient.invalidateQueries({ queryKey: ['daily-history'] });
      queryClient.invalidateQueries({ queryKey: ['report-period'] });
      queryClient.invalidateQueries({ queryKey: ['report-yearly'] });
      toast({ title: 'Usunieto magazyn', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunieto magazynu', tone: 'error' });
    }
  });

  const addLocationMutation = useMutation({
    mutationFn: addLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations-admin'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      toast({ title: 'Dodano lokacje', tone: 'success' });
      setLocationForm((prev) => ({ ...prev, name: '', orderNo: '' }));
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        DUPLICATE: 'Lokacja juz istnieje.',
        WAREHOUSE_MISSING: 'Wybierz magazyn.',
        INVALID_NAME: 'Podaj nazwe lokacji.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udalo sie dodac lokacji.',
        tone: 'error'
      });
    }
  });

  const updateLocationMutation = useMutation({
    mutationFn: updateLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations-admin'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      toast({ title: 'Zapisano lokacje', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie zapisano lokacji', tone: 'error' });
    }
  });

  const removeLocationMutation = useMutation({
    mutationFn: removeLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations-admin'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      toast({ title: 'Usunieto lokacje', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunieto lokacji', tone: 'error' });
    }
  });

  const addDryerMutation = useMutation({
    mutationFn: addDryer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dryers'] });
      toast({ title: 'Dodano suszarke', tone: 'success' });
      setDryerForm({ name: '', orderNo: '', isActive: true });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwe suszarki.',
        DUPLICATE: 'Taka suszarka juz istnieje.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udalo sie dodac suszarki.',
        tone: 'error'
      });
    }
  });

  const updateDryerMutation = useMutation({
    mutationFn: updateDryer,
    onSuccess: (_data, variables) => {
      setDryerDrafts((prev) => {
        const next = { ...prev };
        delete next[variables.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['dryers'] });
      toast({ title: 'Zapisano suszarke', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwe suszarki.',
        DUPLICATE: 'Taka suszarka juz istnieje.',
        NOT_FOUND: 'Nie znaleziono suszarki.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie zapisano suszarki.', tone: 'error' });
    }
  });

  const removeDryerMutation = useMutation({
    mutationFn: removeDryer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dryers'] });
      toast({ title: 'Usunieto suszarke', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono suszarki.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie usunieto suszarki.', tone: 'error' });
    }
  });

  const addPermissionGroupMutation = useMutation({
    mutationFn: addPermissionGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission-groups'] });
      toast({ title: 'Dodano grupe uprawnien', tone: 'success' });
      setPermissionGroupForm({
        name: '',
        description: '',
        access: { admin: false, warehouses: {} },
        isActive: true
      });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwe grupy.',
        DUPLICATE: 'Grupa o takiej nazwie juz istnieje.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udalo sie dodac grupy uprawnien.',
        tone: 'error'
      });
    }
  });

  const updatePermissionGroupMutation = useMutation({
    mutationFn: updatePermissionGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission-groups'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'Zapisano grupe uprawnien', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwe grupy.',
        DUPLICATE: 'Grupa o takiej nazwie juz istnieje.',
        NOT_FOUND: 'Nie znaleziono grupy.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie zapisano grupy uprawnien.', tone: 'error' });
    }
  });

  const removePermissionGroupMutation = useMutation({
    mutationFn: removePermissionGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission-groups'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({ title: 'Usunieto grupe uprawnien', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono grupy.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie usunieto grupy uprawnien.', tone: 'error' });
    }
  });

  const addUserMutation = useMutation({
    mutationFn: addUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['permission-groups'] });
      toast({ title: 'Dodano uzytkownika', tone: 'success' });
      setUserForm({
        name: '',
        username: '',
        password: '',
        role: 'USER',
        access: { admin: false, warehouses: {} },
        groupIds: []
      });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj imie i nazwisko.',
        USERNAME_REQUIRED: 'Podaj login.',
        PASSWORD_REQUIRED: 'Podaj haslo.',
        DUPLICATE: 'Login jest juz zajety.',
        GROUP_NOT_FOUND: 'Jedna z wybranych grup nie istnieje.',
        GROUPS_SCHEMA_MISSING: 'Najpierw uruchom migracje grup uprawnien w bazie.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udalo sie dodac uzytkownika.',
        tone: 'error'
      });
    }
  });

  const updateUserMutation = useMutation({
    mutationFn: updateUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['permission-groups'] });
      toast({ title: 'Zapisano uzytkownika', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj imie i nazwisko.',
        USERNAME_REQUIRED: 'Podaj login.',
        DUPLICATE: 'Login jest juz zajety.',
        GROUP_NOT_FOUND: 'Jedna z wybranych grup nie istnieje.',
        GROUPS_SCHEMA_MISSING: 'Najpierw uruchom migracje grup uprawnien w bazie.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie zapisano uzytkownika.',
        tone: 'error'
      });
    }
  });

  const resetUserPasswordMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      updateUser({ id: userId, password: DEFAULT_RESET_PASSWORD }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast({
        title: `Haslo zresetowane do ${DEFAULT_RESET_PASSWORD}`,
        tone: 'success'
      });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono uzytkownika.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udalo sie zresetowac hasla.',
        tone: 'error'
      });
    }
  });


  const parseOrderNo = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const inventoryMutation = useMutation({
    mutationFn: applyInventoryAdjustment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['locations-admin'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-detail'] });
      queryClient.invalidateQueries({ queryKey: ['location-detail'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-delta'] });
      queryClient.invalidateQueries({ queryKey: ['monthly-breakdown'] });
      queryClient.invalidateQueries({ queryKey: ['material-totals'] });
      queryClient.invalidateQueries({ queryKey: ['top-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['totals-history'] });
      queryClient.invalidateQueries({ queryKey: ['daily-history'] });
      queryClient.invalidateQueries({ queryKey: ['report-period'] });
      queryClient.invalidateQueries({ queryKey: ['report-yearly'] });
      toast({ title: 'Zapisano inwentaryzacje', tone: 'success' });
      setInventoryForm((prev) => ({ ...prev, qty: '', note: '' }));
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        LOCATION_MISSING: 'Wybierz lokacje.',
        MATERIAL_MISSING: 'Wybierz przemial.',
        INVALID_QTY: 'Podaj poprawna ilosc.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie udalo sie zapisac inwentaryzacji.',
        tone: 'error'
      });
    }
  });

  const addSparePartMutation = useMutation({
    mutationFn: addSparePart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      toast({ title: 'Dodano czesc zamienna', tone: 'success' });
      setSparePartForm({ code: '', name: '', unit: 'szt', qty: '', location: '' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_PART: 'Podaj kod, nazwe i jednostke.',
        DUPLICATE: 'Czesc o takim kodzie lub nazwie juz istnieje.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie dodano czesci.',
        tone: 'error'
      });
    }
  });

  const removeUserMutation = useMutation({
    mutationFn: removeUser,
    onSuccess: (removedUser) => {
      queryClient.setQueryData<AppUser[]>(['users'], (current = []) =>
        current.filter((user) => user.id !== removedUser.id)
      );
      setUserDrafts((prev) => {
        if (!(removedUser.id in prev)) return prev;
        const next = { ...prev };
        delete next[removedUser.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['permission-groups'] });
      toast({ title: 'Usunieto uzytkownika', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono uzytkownika.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie usunieto uzytkownika.', tone: 'error' });
    }
  });

  const updateSparePartMutation = useMutation({
    mutationFn: updateSparePart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      toast({ title: 'Zapisano czesc zamienna', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_PART: 'Uzupelnij poprawnie dane czesci.',
        DUPLICATE: 'Kod lub nazwa juz istnieje.',
        PART_MISSING: 'Nie znaleziono czesci.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie zapisano czesci.',
        tone: 'error'
      });
    }
  });

  const removeSparePartMutation = useMutation({
    mutationFn: removeSparePart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      toast({ title: 'Usunieto czesc zamienna', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunieto czesci zamiennej', tone: 'error' });
    }
  });

  const setSparePartQtyMutation = useMutation({
    mutationFn: setSparePartQty,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spare-parts'] });
      queryClient.invalidateQueries({ queryKey: ['spare-parts-history'] });
      toast({ title: 'Zmieniono stan', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        PART_MISSING: 'Nie znaleziono czesci.',
        INVALID_QTY: 'Podaj poprawny stan.'
      };
      toast({
        title: messageMap[err.message] ?? 'Nie zapisano stanu.',
        tone: 'error'
      });
    }
  });

  const handleAddWarehouse = () => {
    const name = warehouseForm.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe magazynu', tone: 'error' });
      return;
    }
    addWarehouseMutation.mutate({
      name,
      orderNo: parseOrderNo(warehouseForm.orderNo),
      includeInSpis: warehouseForm.includeInSpis,
      includeInStats: warehouseForm.includeInStats
    });
  };

  const handleAddLocation = () => {
    const name = locationForm.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe lokacji', tone: 'error' });
      return;
    }
    if (!locationForm.warehouseId) {
      toast({ title: 'Wybierz magazyn', tone: 'error' });
      return;
    }
    addLocationMutation.mutate({
      warehouseId: locationForm.warehouseId,
      type: locationForm.type,
      name,
      orderNo: parseOrderNo(locationForm.orderNo)
    });
  };

  const handleAddDryer = () => {
    const name = dryerForm.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe suszarki', tone: 'error' });
      return;
    }
    addDryerMutation.mutate({
      name,
      orderNo: parseOrderNo(dryerForm.orderNo),
      isActive: dryerForm.isActive
    });
  };

  const openPositionsAction = (
    action: 'addCatalog' | 'addMaterial' | 'removeCatalog' | 'removeMaterial'
  ) => {
    setPositionsAction(action);
    if (action === 'addCatalog') {
      setCatalogForm({ name: '' });
      return;
    }
    if (action === 'addMaterial') {
      setMaterialForm((prev) => ({
        catalogId: prev.catalogId || erpCatalogOptions[0]?.id || '',
        name: ''
      }));
      return;
    }
    if (action === 'removeCatalog') {
      setRemoveCatalogId((prev) => prev || erpCatalogOptions[0]?.id || '');
      setRemoveCatalogWithMaterials(false);
      return;
    }
    setRemoveMaterialId((prev) => prev || materialOptions[0]?.id || '');
  };

  const handleAddCatalog = async () => {
    const name = catalogForm.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe kartoteki ERP', tone: 'error' });
      return;
    }
    try {
      await addCatalogMutation.mutateAsync({ name });
      toast({ title: 'Dodano kartoteke ERP', tone: 'success' });
      setPositionsAction(null);
    } catch {
      return;
    }
  };

  const handleAddMaterial = async () => {
    const catalogId = materialForm.catalogId.trim();
    const name = materialForm.name.trim();
    if (!catalogId) {
      toast({ title: 'Wybierz kartoteke', tone: 'error' });
      return;
    }
    if (!name) {
      toast({ title: 'Podaj nazwe przemialu', tone: 'error' });
      return;
    }
    try {
      await addMaterialMutation.mutateAsync({ name, catalogId });
      toast({ title: 'Dodano przemial', tone: 'success' });
      setPositionsAction(null);
    } catch {
      return;
    }
  };

  const handleRemoveCatalog = async () => {
    const catalogId = removeCatalogId.trim();
    if (!catalogId) {
      toast({ title: 'Wybierz kartoteke', tone: 'error' });
      return;
    }
    try {
      await removeCatalogMutation.mutateAsync({
        catalogId,
        force: removeCatalogWithMaterials
      });
      toast({ title: 'Usunieto kartoteke', tone: 'success' });
      setPositionsAction(null);
    } catch {
      return;
    }
  };

  const handleRemoveMaterial = async () => {
    if (!removeMaterialId) {
      toast({ title: 'Wybierz przemial', tone: 'error' });
      return;
    }
    try {
      await removeMaterialMutation.mutateAsync(removeMaterialId);
      toast({ title: 'Usunieto przemial', tone: 'success' });
      setPositionsAction(null);
    } catch {
      return;
    }
  };

  const parseMaterialCatalogRows = (rows: Array<Array<unknown>>) => {
    const normalize = (value: unknown) => String(value ?? '').trim();
    const lower = (value: unknown) => normalize(value).toLowerCase();
    const headerRow = rows[0] ?? [];
    const headerLabels = headerRow.map((cell) => lower(cell));
    const nameHeaders = ['nazwa', 'name', 'material', 'tworzywo', 'pozycja', 'kartoteka'];
    const nameIndex = headerLabels.findIndex((label) =>
      nameHeaders.some((key) => label.includes(key))
    );
    const startIndex = nameIndex >= 0 ? 1 : 0;
    const items: Array<{ name: string }> = [];
    for (let i = startIndex; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const name = normalize(row[nameIndex >= 0 ? nameIndex : 0]);
      if (!name) continue;
      items.push({ name });
    }
    return items;
  };

  const handleMaterialCatalogFile = async (file: File) => {
    setMaterialCatalogImportSummary(null);
    setMaterialCatalogImporting(true);
    try {
      let workbook: XLSX.WorkBook;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        workbook = XLSX.read(text, { type: 'string' });
      } else {
        const buffer = await file.arrayBuffer();
        workbook = XLSX.read(buffer, { type: 'array' });
      }
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        toast({ title: 'Brak arkusza w pliku', tone: 'error' });
        return;
      }
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as Array<
        Array<unknown>
      >;
      if (!rows || rows.length === 0) {
        toast({ title: 'Plik jest pusty', tone: 'error' });
        return;
      }
      const items = parseMaterialCatalogRows(rows);
      if (items.length === 0) {
        toast({ title: 'Nie znaleziono nazw kartotek w pliku', tone: 'error' });
        return;
      }
      const result = await addMaterialCatalogBulk({ items });
      queryClient.invalidateQueries({ queryKey: ['material-catalogs'] });
      setMaterialCatalogImportSummary(result);
      toast({
        title: 'Import zakonczony',
        description: `Dodano: ${result.inserted}, pominieto: ${result.skipped}.`,
        tone: 'success'
      });
    } catch {
      toast({ title: 'Nie udalo sie zaimportowac pliku', tone: 'error' });
    } finally {
      setMaterialCatalogImporting(false);
    }
  };

  const handleMaterialCatalogFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleMaterialCatalogFile(file);
    event.target.value = '';
  };

  const parseMaterialRows = (rows: Array<Array<unknown>>) => {
    const normalize = (value: unknown) => String(value ?? '').trim();
    const lower = (value: unknown) => normalize(value).toLowerCase();
    const headerRow = rows[0] ?? [];
    const headerLabels = headerRow.map((cell) => lower(cell));
    const nameHeaders = [
      'nazwa przemia',
      'przemial',
      'przemialu',
      'nazwa',
      'name',
      'material',
      'tworzywo'
    ];
    const catalogHeaders = [
      'kartoteka',
      'kartoteka erp',
      'erp',
      'catalog',
      'kod',
      'code'
    ];
    const nameIndex = headerLabels.findIndex((label) =>
      nameHeaders.some((key) => label.includes(key))
    );
    const catalogIndex = headerLabels.findIndex((label) =>
      catalogHeaders.some((key) => label.includes(key))
    );
    const startIndex = nameIndex >= 0 ? 1 : 0;

    const items: Array<{ name: string; catalogName?: string }> = [];
    for (let i = startIndex; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const name = normalize(row[nameIndex >= 0 ? nameIndex : 0]);
      if (!name) continue;
      const catalogName = normalize(row[catalogIndex >= 0 ? catalogIndex : 1]);
      items.push({ name, catalogName: catalogName || undefined });
    }
    return items;
  };

  const handleMaterialFile = async (file: File) => {
    setMaterialImportSummary(null);
    setMaterialImporting(true);
    try {
      let workbook: XLSX.WorkBook;
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = await file.text();
        workbook = XLSX.read(text, { type: 'string' });
      } else {
        const buffer = await file.arrayBuffer();
        workbook = XLSX.read(buffer, { type: 'array' });
      }
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        toast({ title: 'Brak arkusza w pliku', tone: 'error' });
        return;
      }
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as Array<
        Array<unknown>
      >;
      if (!rows || rows.length === 0) {
        toast({ title: 'Plik jest pusty', tone: 'error' });
        return;
      }
      const items = parseMaterialRows(rows);
      if (items.length === 0) {
        toast({ title: 'Nie znaleziono nazw przemialow w pliku', tone: 'error' });
        return;
      }
      const result = await addMaterialBulk({ items });
      invalidateMaterialQueries();
      queryClient.invalidateQueries({ queryKey: ['material-catalogs'] });
      setMaterialImportSummary(result);
      toast({
        title: 'Import zakonczony',
        description: `Dodano: ${result.inserted}, pominieto: ${result.skipped}.`,
        tone: 'success'
      });
    } catch {
      toast({ title: 'Nie udalo sie zaimportowac pliku', tone: 'error' });
    } finally {
      setMaterialImporting(false);
    }
  };

  const handleMaterialFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleMaterialFile(file);
    event.target.value = '';
  };

  const handleSaveMaterial = (materialId: string) => {
    const draft = materialEdits[materialId];
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe przemialu', tone: 'error' });
      return;
    }
    const catalogId = draft.catalogId.trim();
    updateMaterialMutation.mutate({
      materialId,
      name,
      catalogId: catalogId ? catalogId : null
    });
  };

  const normalizeGroupIds = (groupIds: string[]) =>
    Array.from(
      new Set(
        groupIds
          .map((value) => value.trim())
          .filter(Boolean)
      )
    );

  const handleAddPermissionGroup = () => {
    const name = permissionGroupForm.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe grupy', tone: 'error' });
      return;
    }
    addPermissionGroupMutation.mutate({
      name,
      description: permissionGroupForm.description.trim() || null,
      access: permissionGroupForm.access,
      isActive: permissionGroupForm.isActive
    });
  };

  const handleSavePermissionGroup = (groupId: string) => {
    const draft = permissionGroupDrafts[groupId];
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe grupy', tone: 'error' });
      return;
    }
    updatePermissionGroupMutation.mutate({
      id: groupId,
      name,
      description: draft.description.trim() || null,
      access: draft.access,
      isActive: draft.isActive
    });
  };

  const handleRemovePermissionGroup = (groupId: string, name: string) => {
    if (!confirm(`Usunac grupe uprawnien ${name}?`)) return;
    removePermissionGroupMutation.mutate(groupId);
  };

  const handleAddUser = () => {
    const name = userForm.name.trim();
    const username = userForm.username.trim();
    const password = userForm.password.trim();
    if (!name) {
      toast({ title: 'Podaj imie i nazwisko', tone: 'error' });
      return;
    }
    if (!username) {
      toast({ title: 'Podaj login', tone: 'error' });
      return;
    }
    if (!password) {
      toast({ title: 'Podaj haslo', tone: 'error' });
      return;
    }
    addUserMutation.mutate({
      name,
      username,
      password,
      role: userForm.role,
      access: userForm.access,
      groupIds: normalizeGroupIds(userForm.groupIds)
    });
  };

  const handleSaveUser = (userId: string) => {
    const draft = userDrafts[userId];
    if (!draft) return;
    updateUserMutation.mutate({
      id: userId,
      name: draft.name,
      username: draft.username,
      role: draft.role,
      access: draft.access,
      groupIds: normalizeGroupIds(draft.groupIds),
      isActive: draft.isActive
    });
  };

  const handleToggleUserStatus = (userId: string, nextActive: boolean) => {
    setUserDrafts((prev) => {
      const draft = prev[userId];
      if (!draft) return prev;
      return { ...prev, [userId]: { ...draft, isActive: nextActive } };
    });
    updateUserMutation.mutate({ id: userId, isActive: nextActive });
  };

  const handleRemoveUser = (userId: string, name: string) => {
    if (!confirm(`Usunac uzytkownika ${name} na stale?`)) return;
    removeUserMutation.mutate(userId);
  };

  const handleResetUserPassword = (userId: string, name: string) => {
    const isSelfTarget = currentUser?.id === userId;
    const suffix = isSelfTarget ? ' Twoja aktywna sesja zostanie wylogowana.' : '';
    if (
      !confirm(
        `Zresetowac haslo uzytkownika ${name} do domyslnego ${DEFAULT_RESET_PASSWORD}?${suffix}`
      )
    ) {
      return;
    }
    resetUserPasswordMutation.mutate({ userId });
  };

  const handleApplyInventory = () => {
    const qtyValue = parseQtyInput(inventoryForm.qty);
    if (qtyValue === null) {
      toast({ title: 'Podaj ilosc', tone: 'error' });
      return;
    }
    if (!inventoryForm.locationId) {
      toast({ title: 'Wybierz lokacje', tone: 'error' });
      return;
    }
    if (!inventoryForm.materialId) {
      toast({ title: 'Wybierz przemial', tone: 'error' });
      return;
    }
    inventoryMutation.mutate({
      locationId: inventoryForm.locationId,
      materialId: inventoryForm.materialId,
      qty: qtyValue,
      note: inventoryForm.note
    });
  };
  const handleApplyInventoryRow = (materialId: string, qtyRaw: string) => {
    const qtyValue = parseQtyInput(qtyRaw);
    if (qtyValue === null) {
      toast({ title: 'Podaj ilosc', tone: 'error' });
      return;
    }
    if (!inventoryForm.locationId) {
      toast({ title: 'Wybierz lokacje', tone: 'error' });
      return;
    }
    inventoryMutation.mutate({
      locationId: inventoryForm.locationId,
      materialId,
      qty: qtyValue
    });
  };

  const handleAddSparePart = () => {
    const code = sparePartForm.code.trim();
    const name = sparePartForm.name.trim();
    const unit = sparePartForm.unit.trim();
    const qtyValue = sparePartForm.qty.trim() ? parseQtyInput(sparePartForm.qty) : 0;
    if (!code || !name || !unit) {
      toast({ title: 'Podaj kod, nazwe i jednostke', tone: 'error' });
      return;
    }
    if (qtyValue === null || qtyValue < 0) {
      toast({ title: 'Podaj poprawny stan', tone: 'error' });
      return;
    }
    addSparePartMutation.mutate({
      code,
      name,
      unit,
      qty: qtyValue ?? 0,
      location: sparePartForm.location
    });
  };

  const handleSaveSparePart = (partId: string) => {
    const draft = sparePartDrafts[partId];
    if (!draft) return;
    updateSparePartMutation.mutate({
      id: partId,
      code: draft.code,
      name: draft.name,
      unit: draft.unit,
      location: draft.location
    });
  };

  const handleSetSparePartQty = (partId: string) => {
    const draft = sparePartDrafts[partId];
    if (!draft) return;
    const qtyValue = parseQtyInput(draft.qty);
    if (qtyValue === null) {
      toast({ title: 'Podaj poprawny stan', tone: 'error' });
      return;
    }
    setSparePartQtyMutation.mutate({
      partId,
      qty: qtyValue,
      user: currentUser?.username ?? currentUser?.name ?? 'nieznany',
      note: 'Korekta admin'
    });
  };
  const locationPlaceholder = locationForm.type === 'wtr' ? 'WTR 1' : 'Pole odkladcze';
  const inventoryPreviewQty = parseQtyInput(inventoryForm.qty);
  const inventoryDiff =
    inventoryPreviewQty === null || currentInventoryQty === null
      ? null
      : inventoryPreviewQty - currentInventoryQty;
  const inventorySuggestions = useMemo(
    () =>
      inventoryDetail
        .map((row) => {
          const currentQty =
            typeof row.todayQty === 'number' ? row.todayQty : row.yesterdayQty;
          return { ...row, currentQty };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' })),
    [inventoryDetail]
  );

  const inventoryFilterLocations = useMemo(() => {
    const list = inventoryFilters.warehouseId
      ? locations.filter((loc) => loc.warehouseId === inventoryFilters.warehouseId)
      : [...locations];
    const compare =
      inventoryFilters.warehouseId === ''
        ? (a: typeof locations[number], b: typeof locations[number]) => {
            const aWarehouse = warehouseNameMap.get(a.warehouseId) ?? a.warehouseId;
            const bWarehouse = warehouseNameMap.get(b.warehouseId) ?? b.warehouseId;
            const warehouseCompare = collator.compare(aWarehouse, bWarehouse);
            if (warehouseCompare !== 0) return warehouseCompare;
            return collator.compare(a.name, b.name);
          }
        : compareByName;
    return list.sort(compare);
  }, [inventoryFilters.warehouseId, locations, warehouseNameMap]);

  useEffect(() => {
    if (!inventoryFilters.warehouseId) {
      return;
    }
    const exists = inventoryFilterLocations.some((loc) => loc.id === inventoryFilters.locationId);
    if (!exists && inventoryFilters.locationId) {
      setInventoryFilters((prev) => ({ ...prev, locationId: '' }));
    }
  }, [inventoryFilterLocations, inventoryFilters.locationId, inventoryFilters.warehouseId]);

  const filteredInventoryAdjustments = useMemo(() => {
    const minQty = parseQtyInput(inventoryFilters.qtyMin);
    const maxQty = parseQtyInput(inventoryFilters.qtyMax);
    return inventoryAdjustments.filter((entry) => {
      const entryDate = entry.at.slice(0, 10);
      if (inventoryFilters.dateFrom && entryDate < inventoryFilters.dateFrom) {
        return false;
      }
      if (inventoryFilters.dateTo && entryDate > inventoryFilters.dateTo) {
        return false;
      }
      if (inventoryFilters.materialId && entry.materialId !== inventoryFilters.materialId) {
        return false;
      }
      if (inventoryFilters.locationId && entry.locationId !== inventoryFilters.locationId) {
        return false;
      }
      if (inventoryFilters.warehouseId) {
        const loc = locations.find((item) => item.id === entry.locationId);
        if (!loc || loc.warehouseId !== inventoryFilters.warehouseId) {
          return false;
        }
      }
      if (minQty !== null && entry.nextQty < minQty) {
        return false;
      }
      if (maxQty !== null && entry.nextQty > maxQty) {
        return false;
      }
      return true;
    });
  }, [inventoryAdjustments, inventoryFilters, locations]);

  const sortedInventoryAdjustments = useMemo(() => {
    const list = [...filteredInventoryAdjustments];
    const dir = inventorySort.direction === 'asc' ? 1 : -1;
    const getWarehouseName = (entry: typeof inventoryAdjustments[number]) => {
      const loc = locations.find((item) => item.id === entry.locationId);
      return loc ? warehouseNameMap.get(loc.warehouseId) ?? '' : '';
    };
    const getLocationName = (entry: typeof inventoryAdjustments[number]) => {
      const loc = locations.find((item) => item.id === entry.locationId);
      return loc?.name ?? '';
    };
    const getMaterialName = (entry: typeof inventoryAdjustments[number]) => {
      const mat = catalog.find((item) => item.id === entry.materialId);
      return mat?.name ?? '';
    };
    list.sort((a, b) => {
      switch (inventorySort.key) {
        case 'date':
          return a.at.localeCompare(b.at) * dir;
        case 'warehouse':
          return getWarehouseName(a).localeCompare(getWarehouseName(b), 'pl', { sensitivity: 'base' }) * dir;
        case 'location':
          return getLocationName(a).localeCompare(getLocationName(b), 'pl', { sensitivity: 'base' }) * dir;
        case 'material':
          return getMaterialName(a).localeCompare(getMaterialName(b), 'pl', { sensitivity: 'base' }) * dir;
        case 'prev':
          return (a.prevQty - b.prevQty) * dir;
        case 'next':
          return (a.nextQty - b.nextQty) * dir;
        default:
          return 0;
      }
    });
    return list;
  }, [catalog, filteredInventoryAdjustments, inventorySort, locations, warehouseNameMap]);

  const handleInventorySort = (
    key: 'date' | 'warehouse' | 'location' | 'material' | 'prev' | 'next'
  ) => {
    setInventorySort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
  };

  const sortIndicator = (key: typeof inventorySort.key) => {
    if (inventorySort.key !== key) return '';
    return inventorySort.direction === 'asc' ? '^' : 'v';
  };

  const isHead = isHeadAdmin(currentUser);
  const canAccessModule = Boolean(
    activeWarehouse && isWarehouseAdmin(currentUser, activeWarehouse)
  );

  if (!isHead && !canAccessModule) {
    return (
      <Card>
        <p className="text-sm text-muted">Brak dostepu.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Zarządzanie"
        subtitle="Konfiguracja i ustawienia"
      />

      <div className="space-y-10">
        {isHead && activeWarehouse !== 'PRZEMIALY' && (
        <section className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Konta</p>
            <h2 className="text-xl font-semibold text-title">Konta i uprawnienia</h2>
            <p className="text-sm text-dim">
              Tworzenie kont, przypisy magazynow i zarządzanie rolami.
            </p>
          </div>
          <div className="space-y-4">
              <div className={cn(accountsTab !== 'groups' && 'hidden')}>
                <Card className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Grupy uprawnien
                </p>
                <p className="text-sm text-dim">
                  Tworzysz raz grupe i przypisujesz ja do wielu kont.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Nazwa grupy</label>
                  <Input
                    value={permissionGroupForm.name}
                    onChange={(event) =>
                      setPermissionGroupForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="np. Przemialy - Brygada A"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">
                    Opis (opcjonalnie)
                  </label>
                  <Input
                    value={permissionGroupForm.description}
                    onChange={(event) =>
                      setPermissionGroupForm((prev) => ({
                        ...prev,
                        description: event.target.value
                      }))
                    }
                    placeholder="Krotki opis zakresu grupy"
                  />
                </div>
              </div>
              <AdminToggle
                checked={permissionGroupForm.isActive}
                onCheckedChange={(value) =>
                  setPermissionGroupForm((prev) => ({ ...prev, isActive: value }))
                }
                label="Grupa aktywna"
                disabled={addPermissionGroupMutation.isPending}
              />
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Uprawnienia grupy
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  {renderWarehouseAccess(
                    'PRZEMIALY',
                    permissionGroupForm.access,
                    updatePermissionGroupFormAccess,
                    'ADMIN'
                  )}
                  {renderErpModuleAccess(
                    permissionGroupForm.access,
                    updatePermissionGroupFormAccess,
                    'ADMIN'
                  )}
                  {renderWarehouseAccess(
                    'CZESCI',
                    permissionGroupForm.access,
                    updatePermissionGroupFormAccess,
                    'ADMIN'
                  )}
                  {renderWarehouseAccess(
                    'RAPORT_ZMIANOWY',
                    permissionGroupForm.access,
                    updatePermissionGroupFormAccess,
                    'ADMIN'
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleAddPermissionGroup}
                  disabled={addPermissionGroupMutation.isPending}
                >
                  Dodaj grupe
                </Button>
              </div>
            </Card>
            {permissionGroups.length === 0 ? (
              <EmptyState
                title="Brak grup uprawnien"
                description="Dodaj pierwsza grupe, aby szybko przypisywac dostepy."
              />
            ) : (
              <Card>
                <DataTable
                  columns={['Nazwa', 'Opis', 'Uzytkownicy', 'Status', 'Akcje']}
                  rows={permissionGroups.map((group) => {
                    const draft = permissionGroupDrafts[group.id] ?? {
                      name: group.name,
                      description: group.description ?? '',
                      access: cloneAccess(group.access),
                      isActive: group.isActive
                    };
                    const isSelected = selectedPermissionGroupId === group.id;
                    return [
                      <Input
                        key={`${group.id}-name`}
                        value={draft.name}
                        onChange={(event) =>
                          setPermissionGroupDrafts((prev) => ({
                            ...prev,
                            [group.id]: { ...draft, name: event.target.value }
                          }))
                        }
                      />,
                      <Input
                        key={`${group.id}-description`}
                        value={draft.description}
                        onChange={(event) =>
                          setPermissionGroupDrafts((prev) => ({
                            ...prev,
                            [group.id]: { ...draft, description: event.target.value }
                          }))
                        }
                        placeholder="Opis"
                      />,
                      <span key={`${group.id}-count`} className="text-sm text-dim">
                        {group.assignedUsersCount ?? 0}
                      </span>,
                      <AdminToggle
                        key={`${group.id}-active`}
                        checked={draft.isActive}
                        onCheckedChange={(value) =>
                          setPermissionGroupDrafts((prev) => ({
                            ...prev,
                            [group.id]: { ...draft, isActive: value }
                          }))
                        }
                        label={draft.isActive ? 'Aktywna' : 'Nieaktywna'}
                        disabled={updatePermissionGroupMutation.isPending}
                      />,
                      <div key={`${group.id}-actions`} className="grid grid-cols-2 gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => handleSavePermissionGroup(group.id)}
                          disabled={updatePermissionGroupMutation.isPending}
                          className="w-full"
                        >
                          Zapisz
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setSelectedPermissionGroupId((prev) =>
                              prev === group.id ? null : group.id
                            )
                          }
                          disabled={updatePermissionGroupMutation.isPending}
                          className="w-full"
                        >
                          {isSelected ? 'Zamknij uprawnienia' : 'Uprawnienia'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleRemovePermissionGroup(group.id, group.name)}
                          disabled={removePermissionGroupMutation.isPending}
                          className="col-span-2 w-full border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                        >
                          Usuń
                        </Button>
                      </div>
                    ];
                  })}
                  renderRowDetails={(rowIndex) => {
                    const group = permissionGroups[rowIndex];
                    if (!group || selectedPermissionGroupId !== group.id) return null;
                    const draft = permissionGroupDrafts[group.id] ?? {
                      name: group.name,
                      description: group.description ?? '',
                      access: cloneAccess(group.access),
                      isActive: group.isActive
                    };

                    return (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                              Uprawnienia grupy
                            </p>
                            <p className="text-sm font-semibold text-title">{draft.name}</p>
                          </div>
                          <Button
                            variant="outline"
                            onClick={() => setSelectedPermissionGroupId(null)}
                            disabled={updatePermissionGroupMutation.isPending}
                          >
                            Zamknij
                          </Button>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                          {renderWarehouseAccess(
                            'PRZEMIALY',
                            draft.access,
                            (updater) => updatePermissionGroupDraftAccess(group.id, updater),
                            'ADMIN'
                          )}
                          {renderErpModuleAccess(
                            draft.access,
                            (updater) => updatePermissionGroupDraftAccess(group.id, updater),
                            'ADMIN'
                          )}
                          {renderWarehouseAccess(
                            'CZESCI',
                            draft.access,
                            (updater) => updatePermissionGroupDraftAccess(group.id, updater),
                            'ADMIN'
                          )}
                          {renderWarehouseAccess(
                            'RAPORT_ZMIANOWY',
                            draft.access,
                            (updater) => updatePermissionGroupDraftAccess(group.id, updater),
                            'ADMIN'
                          )}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="secondary"
                            onClick={() => handleSavePermissionGroup(group.id)}
                            disabled={updatePermissionGroupMutation.isPending}
                            className="w-full sm:w-auto"
                          >
                            Zapisz uprawnienia grupy
                          </Button>
                        </div>
                      </div>
                    );
                  }}
                />
              </Card>
            )}
              </div>
              <div className={cn(accountsTab !== 'add-user' && 'hidden')}>
                <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dodaj uzytkownika</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Imie i nazwisko</label>
                  <Input
                    value={userForm.name}
                    onChange={(event) => setUserForm((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Jan Kowalski"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Login</label>
                  <Input
                    value={userForm.username}
                    onChange={(event) =>
                      setUserForm((prev) => ({ ...prev, username: event.target.value }))
                    }
                    placeholder="np. operator.anna"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Haslo</label>
                  <Input
                    type="password"
                    value={userForm.password}
                    onChange={(event) =>
                      setUserForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                    placeholder="******"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Rola</label>
                  <SelectField
                    value={userForm.role}
                    onChange={(event) => {
                      const nextRole = event.target.value as Role;
                      setUserForm((prev) => {
                        const nextAccess = cloneAccess(prev.access);
                        nextAccess.admin = nextRole === 'HEAD_ADMIN';
                        if (nextRole !== 'ADMIN') {
                          Object.values(nextAccess.warehouses).forEach((entry) => {
                            if (entry) entry.admin = false;
                          });
                        }
                        if (nextRole === 'HEAD_ADMIN') {
                          nextAccess.warehouses.PRZEMIALY = getRolePreset('PRZEMIALY', 'ROZDZIELCA');
                          nextAccess.warehouses.CZESCI = getRolePreset('CZESCI', 'MECHANIK');
                          nextAccess.warehouses.RAPORT_ZMIANOWY = getRolePreset(
                            'RAPORT_ZMIANOWY',
                            'ROZDZIELCA'
                          );
                          nextAccess.warehouses.PRZESUNIECIA_ERP = getRolePreset(
                            'PRZESUNIECIA_ERP',
                            'ROZDZIELCA'
                          );
                        }
                        return { ...prev, role: nextRole, access: nextAccess };
                      });
                    }}
                  >
                    {roleOptionsSorted.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Grupy uprawnien
                </p>
                {permissionGroups.length === 0 ? (
                  <p className="text-xs text-dim">
                    Brak skonfigurowanych grup. Dodaj grupy uprawnien ponizej.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {permissionGroups.map((group) => (
                      <AdminToggle
                        key={`user-form-group-${group.id}`}
                        checked={userForm.groupIds.includes(group.id)}
                        onCheckedChange={(value) => toggleUserFormGroup(group.id, value)}
                        label={`${group.name}${group.isActive ? '' : ' (nieaktywna)'}`}
                        disabled={addUserMutation.isPending}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Reczne uprawnienia magazynow
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  {renderWarehouseAccess(
                    'PRZEMIALY',
                    userForm.access,
                    updateUserFormAccess,
                    userForm.role
                  )}
                  {renderErpModuleAccess(
                    userForm.access,
                    updateUserFormAccess,
                    userForm.role
                  )}
                  {renderWarehouseAccess(
                    'CZESCI',
                    userForm.access,
                    updateUserFormAccess,
                    userForm.role
                  )}
                  {renderWarehouseAccess(
                    'RAPORT_ZMIANOWY',
                    userForm.access,
                    updateUserFormAccess,
                    userForm.role
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button onClick={handleAddUser} disabled={addUserMutation.isPending}>
                  Dodaj uzytkownika
                </Button>
              </div>
                </Card>
              </div>
              <div className={cn(accountsTab !== 'users' && 'hidden')}>
                {users.length === 0 ? (
              <EmptyState
                title="Brak uzytkownikow"
                description="Dodaj pierwszego uzytkownika, aby nadac dostep."
              />
            ) : (
              <div className="space-y-4">
                  <DataTable
                    columns={[
                      'Imie i nazwisko',
                      'Login',
                      'Rola',
                      'Dostepy',
                      'Status',
                      'Ostatnie logowanie',
                      'Akcje'
                    ]}
                    rows={users.map((item) => {
                    const draft = userDrafts[item.id] ?? {
                      name: item.name,
                      username: item.username,
                      role: item.role,
                      access: cloneAccess(item.directAccess ?? item.access),
                      groupIds: [...(item.groupIds ?? [])],
                      isActive: item.isActive
                    };
                    const isSelf = currentUser?.id === item.id;
                    const isSelected = selectedAccessUserId === item.id;
                    return [
                      <Input
                        key={`${item.id}-name`}
                        value={draft.name}
                        onChange={(event) =>
                          setUserDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, name: event.target.value }
                          }))
                        }
                      />,
                      <Input
                        key={`${item.id}-username`}
                        value={draft.username}
                        onChange={(event) =>
                          setUserDrafts((prev) => ({
                            ...prev,
                            [item.id]: { ...draft, username: event.target.value }
                          }))
                        }
                      />,
                      <SelectField
                        key={`${item.id}-role`}
                        value={draft.role}
                        onChange={(event) => {
                          const nextRole = event.target.value as Role;
                          setUserDrafts((prev) => {
                            const existing = prev[item.id] ?? draft;
                            const nextAccess = cloneAccess(existing.access);
                            nextAccess.admin = nextRole === 'HEAD_ADMIN';
                            if (nextRole !== 'ADMIN') {
                              Object.values(nextAccess.warehouses).forEach((entry) => {
                                if (entry) entry.admin = false;
                              });
                            }
                            if (nextRole === 'HEAD_ADMIN') {
                              nextAccess.warehouses.PRZEMIALY = getRolePreset('PRZEMIALY', 'ROZDZIELCA');
                              nextAccess.warehouses.CZESCI = getRolePreset('CZESCI', 'MECHANIK');
                              nextAccess.warehouses.RAPORT_ZMIANOWY = getRolePreset(
                                'RAPORT_ZMIANOWY',
                                'ROZDZIELCA'
                              );
                              nextAccess.warehouses.PRZESUNIECIA_ERP = getRolePreset(
                                'PRZESUNIECIA_ERP',
                                'ROZDZIELCA'
                              );
                            }
                            return {
                              ...prev,
                              [item.id]: { ...existing, role: nextRole, access: nextAccess }
                            };
                          });
                        }}
                      >
                        {roleOptionsSorted.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </SelectField>,
                      <span key={`${item.id}-access`} className="text-sm text-dim">
                        {formatAccessSummary(draft.access, draft.role, draft.groupIds)}
                      </span>,
                      <Badge
                        key={`${item.id}-status`}
                        tone={draft.isActive ? 'success' : 'warning'}
                      >
                        {draft.isActive ? 'Aktywny' : 'Zablokowany'}
                      </Badge>,
                      <span key={`${item.id}-last`} className="text-sm text-dim">
                        {item.lastLogin ? new Date(item.lastLogin).toLocaleString('pl-PL') : '-'}
                      </span>,
                      <div
                        key={`${item.id}-actions`}
                        className="grid w-full grid-cols-2 gap-2 md:min-w-[18rem]"
                      >
                        <Button
                          variant="secondary"
                          onClick={() => handleSaveUser(item.id)}
                          disabled={updateUserMutation.isPending}
                          className="w-full"
                        >
                          Zapisz
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setSelectedAccessUserId((prev) => (prev === item.id ? null : item.id))
                          }
                          disabled={updateUserMutation.isPending}
                          className="w-full"
                        >
                          {isSelected ? 'Zamknij uprawnienia' : 'Uprawnienia'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleToggleUserStatus(item.id, !draft.isActive)}
                          disabled={updateUserMutation.isPending || isSelf}
                          className="w-full"
                        >
                          {draft.isActive ? 'Zablokuj' : 'Aktywuj'}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleRemoveUser(item.id, item.name)}
                          disabled={removeUserMutation.isPending || isSelf}
                          className="w-full border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                        >
                          Usuń
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleResetUserPassword(item.id, item.name)}
                          disabled={resetUserPasswordMutation.isPending}
                          className="col-span-2 w-full"
                        >
                          Reset hasla (MAX123)
                        </Button>
                      </div>
                    ];
                  })}
                    renderRowDetails={(rowIndex) => {
                      const item = users[rowIndex];
                      if (!item || selectedAccessUserId !== item.id) return null;
                      const draft = userDrafts[item.id] ?? {
                        name: item.name,
                        username: item.username,
                        role: item.role,
                        access: cloneAccess(item.directAccess ?? item.access),
                        groupIds: [...(item.groupIds ?? [])],
                        isActive: item.isActive
                      };

                      return (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                                Uprawnienia magazynow
                              </p>
                              <p className="text-sm font-semibold text-title">{draft.name}</p>
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => setSelectedAccessUserId(null)}
                              disabled={updateUserMutation.isPending}
                            >
                              Zamknij
                            </Button>
                          </div>
                          <Card className="space-y-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                              Grupy uprawnien
                            </p>
                            {permissionGroups.length === 0 ? (
                              <p className="text-xs text-dim">
                                Brak skonfigurowanych grup. Dodaj grupe w sekcji ponizej.
                              </p>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {permissionGroups.map((group) => (
                                  <AdminToggle
                                    key={`user-draft-group-${item.id}-${group.id}`}
                                    checked={draft.groupIds.includes(group.id)}
                                    onCheckedChange={(value) =>
                                      toggleUserDraftGroup(item.id, group.id, value)
                                    }
                                    label={`${group.name}${group.isActive ? '' : ' (nieaktywna)'}`}
                                    disabled={updateUserMutation.isPending}
                                  />
                                ))}
                              </div>
                            )}
                          </Card>
                          <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                            Reczne uprawnienia magazynow
                          </p>
                          <div className="grid gap-4 lg:grid-cols-2">
                            {renderWarehouseAccess(
                              'PRZEMIALY',
                              draft.access,
                              (updater) => updateUserDraftAccess(item.id, updater),
                              draft.role
                            )}
                            {renderErpModuleAccess(
                              draft.access,
                              (updater) => updateUserDraftAccess(item.id, updater),
                              draft.role
                            )}
                            {renderWarehouseAccess(
                              'CZESCI',
                              draft.access,
                              (updater) => updateUserDraftAccess(item.id, updater),
                              draft.role
                            )}
                            {renderWarehouseAccess(
                              'RAPORT_ZMIANOWY',
                              draft.access,
                              (updater) => updateUserDraftAccess(item.id, updater),
                              draft.role
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => handleSaveUser(item.id)}
                              disabled={updateUserMutation.isPending}
                              className="w-full sm:w-auto"
                            >
                              Zapisz uprawnienia
                            </Button>
                          </div>
                        </div>
                      );
                    }}
                  />
              </div>
            )}
              </div>
          </div>
        </section>
        )}

        {activeWarehouse === 'PRZEMIALY' && (
        <section className="space-y-4">
          <Tabs
            value={przemialyTab}
            onValueChange={(value) => setPrzemialyTab(value as PrzemialyAdminTab)}
          >
            <TabsList>
              <TabsTrigger value="warehouses">Magazyny</TabsTrigger>
              <TabsTrigger value="locations">Lokalizacje</TabsTrigger>
              <TabsTrigger value="inventory">Inwentaryzacja</TabsTrigger>
              <TabsTrigger value="audit">REJESTR DZIALAN</TabsTrigger>
              <TabsTrigger value="positions">KARTOTEKI/NAZWY PRZEMIALOW</TabsTrigger>
              <TabsTrigger value="dryers">Suszarki</TabsTrigger>
            </TabsList>

        <TabsContent value="warehouses" className="mt-6">
          <div className="space-y-4">
            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Magazyn to hala lub daszek
              </p>
              <div className="flex flex-wrap gap-4">
                <Toggle
                  checked={warehouseForm.includeInSpis}
                  onCheckedChange={(value) =>
                    setWarehouseForm((prev) => ({ ...prev, includeInSpis: value }))
                  }
                  label="Widoczny w spisie"
                />
                <Toggle
                  checked={warehouseForm.includeInStats}
                  onCheckedChange={(value) =>
                    setWarehouseForm((prev) => ({ ...prev, includeInStats: value }))
                  }
                  label="Wliczaj do statystyk"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Nazwa magazynu</label>
                  <Input
                    value={warehouseForm.name}
                    onChange={(event) =>
                      setWarehouseForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="Hala 4"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Kolejnosc</label>
                  <Input
                    value={warehouseForm.orderNo}
                    onChange={(event) =>
                      setWarehouseForm((prev) => ({ ...prev, orderNo: event.target.value }))
                    }
                    placeholder="np. 4"
                    inputMode="numeric"
                  />
                </div>
                <Button onClick={handleAddWarehouse} disabled={addWarehouseMutation.isPending}>
                  Dodaj magazyn
                </Button>
              </div>
            </Card>

            {activeWarehouses.length === 0 ? (
              <EmptyState
                title="Brak magazynow"
                description="Dodaj pierwszy magazyn, np. Hala 1 lub Daszek NR 1."
              />
            ) : (
              <Card>
                <DataTable
                  columns={['Magazyn', 'Kolejnosc', 'Spis', 'Statystyki', 'Status', 'Akcje']}
                  rows={activeWarehouses.map((warehouse) => {
                    const draft = warehouseDrafts[warehouse.id] ?? {
                      name: warehouse.name,
                      orderNo: String(warehouse.orderNo),
                      includeInSpis: warehouse.includeInSpis,
                      includeInStats: warehouse.includeInStats
                    };
                    return [
                      <Input
                        key={`${warehouse.id}-name`}
                        value={draft.name}
                        onChange={(event) =>
                          setWarehouseDrafts((prev) => ({
                            ...prev,
                            [warehouse.id]: { ...draft, name: event.target.value }
                          }))
                        }
                      />,
                      <Input
                        key={`${warehouse.id}-order`}
                        value={draft.orderNo}
                        onChange={(event) =>
                          setWarehouseDrafts((prev) => ({
                            ...prev,
                            [warehouse.id]: { ...draft, orderNo: event.target.value }
                          }))
                        }
                        inputMode="numeric"
                      />,
                      <Toggle
                        key={`${warehouse.id}-spis`}
                        checked={draft.includeInSpis}
                        onCheckedChange={(value) =>
                          setWarehouseDrafts((prev) => ({
                            ...prev,
                            [warehouse.id]: { ...draft, includeInSpis: value }
                          }))
                        }
                        label={draft.includeInSpis ? 'Tak' : 'Nie'}
                      />,
                      <Toggle
                        key={`${warehouse.id}-stats`}
                        checked={draft.includeInStats}
                        onCheckedChange={(value) =>
                          setWarehouseDrafts((prev) => ({
                            ...prev,
                            [warehouse.id]: { ...draft, includeInStats: value }
                          }))
                        }
                        label={draft.includeInStats ? 'Tak' : 'Nie'}
                      />,
                      <Badge key={`${warehouse.id}-status`} tone="success">
                        Aktywny
                      </Badge>,
                      <div key={`${warehouse.id}-actions`} className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            updateWarehouseMutation.mutate({
                              id: warehouse.id,
                              name: draft.name,
                              orderNo: parseOrderNo(draft.orderNo),
                              includeInSpis: draft.includeInSpis,
                              includeInStats: draft.includeInStats
                            })
                          }
                        >
                          Zapisz
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => removeWarehouseMutation.mutate(warehouse.id)}
                        >
                          Usun
                        </Button>
                      </div>
                    ];
                  })}
                />
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="locations" className="mt-6">
          <div className="space-y-4">
            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Lokacje w magazynie: WTR 1, WTR 2 oraz pole odkladcze
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Magazyn</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeWarehouses.map((warehouse) => {
                      const active = locationForm.warehouseId === warehouse.id;
                      return (
                        <Button
                          key={warehouse.id}
                          variant="secondary"
                          className={
                            active
                              ? `${glowClass} border-[rgba(255,106,0,0.55)] bg-brandSoft text-title`
                              : ''
                          }
                          onClick={() =>
                            setLocationForm((prev) => ({ ...prev, warehouseId: warehouse.id }))
                          }
                        >
                          {warehouse.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Typ lokacji</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['wtr', 'pole'] as const).map((type) => {
                      const active = locationForm.type === type;
                      const label = type === 'wtr' ? 'WTR' : 'Pole odkladcze';
                      return (
                        <Button
                          key={type}
                          variant="secondary"
                          className={
                            active
                              ? `${glowClass} border-[rgba(255,106,0,0.55)] bg-brandSoft text-title`
                              : ''
                          }
                          onClick={() => setLocationForm((prev) => ({ ...prev, type }))}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto] md:items-end">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Nazwa lokacji</label>
                    <Input
                      value={locationForm.name}
                      onChange={(event) =>
                        setLocationForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder={locationPlaceholder}
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Kolejnosc</label>
                    <Input
                      value={locationForm.orderNo}
                      onChange={(event) =>
                        setLocationForm((prev) => ({ ...prev, orderNo: event.target.value }))
                      }
                      placeholder="np. 10"
                      inputMode="numeric"
                    />
                  </div>
                  <Button onClick={handleAddLocation} disabled={addLocationMutation.isPending}>
                    Dodaj lokacje
                  </Button>
                </div>
              </div>
            </Card>

            {activeLocations.length === 0 ? (
              <EmptyState
                title="Brak lokacji"
                description="Dodaj lokacje dla wybranego magazynu."
              />
            ) : (
              <Card>
                <DataTable
                  columns={['Magazyn', 'Typ', 'Lokacja', 'Kolejnosc', 'Status', 'Akcje']}
                  rows={activeLocations.map((location) => {
                    const draft = locationDrafts[location.id] ?? {
                      name: location.name,
                      orderNo: String(location.orderNo)
                    };
                    const typeLabel = location.type === 'wtr' ? 'WTR' : 'Pole odkladcze';
                    return [
                      <span key={`${location.id}-warehouse`} className="text-body">
                        {warehouseNameMap.get(location.warehouseId) ?? location.warehouseId}
                      </span>,
                      <span key={`${location.id}-type`} className="text-body">
                        {typeLabel}
                      </span>,
                      <Input
                        key={`${location.id}-name`}
                        value={draft.name}
                        onChange={(event) =>
                          setLocationDrafts((prev) => ({
                            ...prev,
                            [location.id]: { ...draft, name: event.target.value }
                          }))
                        }
                      />,
                      <Input
                        key={`${location.id}-order`}
                        value={draft.orderNo}
                        onChange={(event) =>
                          setLocationDrafts((prev) => ({
                            ...prev,
                            [location.id]: { ...draft, orderNo: event.target.value }
                          }))
                        }
                        inputMode="numeric"
                      />,
                      <Badge key={`${location.id}-status`} tone="success">
                        Aktywna
                      </Badge>,
                      <div key={`${location.id}-actions`} className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            updateLocationMutation.mutate({
                              id: location.id,
                              name: draft.name,
                              orderNo: parseOrderNo(draft.orderNo)
                            })
                          }
                        >
                          Zapisz
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => removeLocationMutation.mutate(location.id)}
                        >
                          Usun
                        </Button>
                      </div>
                    ];
                  })}
                />
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="mt-6">
          <div className="space-y-4">
            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Inwentaryzacja koryguje stan bez zapisu w Przybylo/Wyrobiono
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Magazyn</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {activeWarehouses.map((warehouse) => {
                      const active = inventoryForm.warehouseId === warehouse.id;
                      return (
                        <Button
                          key={warehouse.id}
                          variant="secondary"
                          className={
                            active
                              ? `${glowClass} border-[rgba(255,106,0,0.55)] bg-brandSoft text-title`
                              : ''
                          }
                          onClick={() =>
                            setInventoryForm((prev) => ({
                              ...prev,
                              warehouseId: warehouse.id,
                              locationId: ''
                            }))
                          }
                        >
                          {warehouse.name}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Lokacja</label>
                    <SelectField
                      value={inventoryForm.locationId}
                      onChange={(event) =>
                        setInventoryForm((prev) => ({
                          ...prev,
                          locationId: event.target.value
                        }))
                      }
                      disabled={!inventoryForm.warehouseId}
                    >
                      <option value="">Wybierz lokacje</option>
                      {inventoryLocations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.name} ({loc.type.toUpperCase()})
                        </option>
                      ))}
                    </SelectField>
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Przemial</label>
                    <SelectField
                      value={inventoryForm.materialId}
                      onChange={(event) =>
                        setInventoryForm((prev) => ({
                          ...prev,
                          materialId: event.target.value
                        }))
                      }
                    >
                      <option value="">Wybierz przemial</option>
                      {materialGroups.map((group) => (
                        <optgroup key={`catalog-${group}`} label={group}>
                          {(materialOptionsByGroup.get(group) ?? []).map((mat) => (
                            <option key={mat.id} value={mat.id}>
                              {mat.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </SelectField>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[2fr_1fr] md:items-end">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Stan rzeczywisty (kg)</label>
                    <Input
                      value={inventoryForm.qty}
                      onChange={(event) =>
                        setInventoryForm((prev) => ({ ...prev, qty: event.target.value }))
                      }
                      placeholder="0"
                      inputMode="decimal"
                    />
                    {currentInventoryQty !== null && (
                      <p className="mt-2 text-xs text-dim">
                        Stan obecny: {formatKg(currentInventoryQty)}
                        {inventoryDiff !== null && (
                          <span className="ml-2">(roznica {inventoryDiff >= 0 ? '+' : ''}{formatKg(Math.abs(inventoryDiff))})</span>
                        )}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Uwagi</label>
                    <Input
                      value={inventoryForm.note}
                      onChange={(event) =>
                        setInventoryForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                      placeholder="Opcjonalnie"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setInventoryForm((prev) => ({ ...prev, qty: '', note: '' }))}
                    className={glowClass}
                  >
                    Wyczysc
                  </Button>
                  <Button onClick={handleApplyInventory} disabled={inventoryMutation.isPending}>
                    Zapisz inwentaryzacje
                  </Button>
                </div>
              </div>
            </Card>

            {inventoryForm.locationId && (
              <Card className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Pod maszyna (stan z systemu)
                </p>
                {inventorySuggestions.length === 0 ? (
                  <EmptyState
                    title="Brak przemialu na lokacji"
                    description="Dla tej lokacji nie ma dodatnich stanow w systemie."
                  />
                ) : (
                  <DataTable
                    columns={['Przemial', 'Stan teraz', 'Stan rzeczywisty', 'Akcje']}
                    rows={inventorySuggestions.map((row) => {
                      const draft = inventoryDrafts[row.materialId] ?? String(row.currentQty);
                      const parsed = parseQtyInput(draft);
                      const diff = parsed === null ? null : parsed - row.currentQty;
                      const isDiff = diff !== null && diff !== 0;
                      return [
                        <div key={`${row.materialId}-label`} className="text-body">
                          {row.name} ({row.code.trim()})
                        </div>,
                        <span key={`${row.materialId}-current`} className="text-body">
                          {formatKg(row.currentQty)}
                        </span>,
                        <div key={`${row.materialId}-actual`} className="space-y-1">
                          <Input
                            value={draft}
                            onChange={(event) =>
                              setInventoryDrafts((prev) => ({
                                ...prev,
                                [row.materialId]: event.target.value
                              }))
                            }
                            inputMode="decimal"
                          />
                          {diff !== null && diff !== 0 && (
                            <p className="text-xs text-dim">
                              roznica {diff > 0 ? '+' : ''}
                              {formatKg(Math.abs(diff))}
                            </p>
                          )}
                        </div>,
                        <div key={`${row.materialId}-actions`} className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => handleApplyInventoryRow(row.materialId, draft)}
                            disabled={inventoryMutation.isPending || parsed === null}
                          >
                            {isDiff ? 'Zapisz' : 'Zgodne'}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setInventoryDrafts((prev) => ({
                                ...prev,
                                [row.materialId]: String(row.currentQty)
                              }))
                            }
                          >
                            Reset
                          </Button>
                        </div>
                      ];
                    })}
                  />
                )}
              </Card>
            )}

            {inventoryAdjustments.length === 0 ? (
              <EmptyState
                title="Brak inwentaryzacji"
                description="Dodaj pierwszy wpis inwentaryzacji, aby skorygowac stany."
              />
            ) : (
              <>
                <Card className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                    Filtry historii
                  </p>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">Data od</label>
                      <Input
                        type="date"
                        value={inventoryFilters.dateFrom}
                        onChange={(event) =>
                          setInventoryFilters((prev) => ({
                            ...prev,
                            dateFrom: event.target.value
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">Data do</label>
                      <Input
                        type="date"
                        value={inventoryFilters.dateTo}
                        onChange={(event) =>
                          setInventoryFilters((prev) => ({
                            ...prev,
                            dateTo: event.target.value
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">Magazyn</label>
                      <SelectField
                        value={inventoryFilters.warehouseId}
                        onChange={(event) =>
                          setInventoryFilters((prev) => ({
                            ...prev,
                            warehouseId: event.target.value
                          }))
                        }
                      >
                        <option value="">Wszystkie</option>
                        {activeWarehouseOptions.map((warehouse) => (
                          <option key={warehouse.id} value={warehouse.id}>
                            {warehouse.name}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">Lokacja</label>
                      <SelectField
                        value={inventoryFilters.locationId}
                        onChange={(event) =>
                          setInventoryFilters((prev) => ({
                            ...prev,
                            locationId: event.target.value
                          }))
                        }
                      >
                        <option value="">Wszystkie</option>
                        {inventoryFilterLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {warehouseNameMap.get(loc.warehouseId) ?? loc.warehouseId} - {loc.name}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <div>
                      <label className="text-xs uppercase tracking-wide text-dim">Przemial</label>
                      <SelectField
                        value={inventoryFilters.materialId}
                        onChange={(event) =>
                          setInventoryFilters((prev) => ({
                            ...prev,
                            materialId: event.target.value
                          }))
                        }
                    >
                      <option value="">Wszystkie</option>
                      {materialGroups.map((group) => (
                        <optgroup key={`catalog-filter-${group}`} label={group}>
                          {(materialOptionsByGroup.get(group) ?? []).map((mat) => (
                            <option key={mat.id} value={mat.id}>
                              {mat.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </SelectField>
                  </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Kg od</label>
                        <Input
                          value={inventoryFilters.qtyMin}
                          onChange={(event) =>
                            setInventoryFilters((prev) => ({
                              ...prev,
                              qtyMin: event.target.value
                            }))
                          }
                          placeholder="0"
                          inputMode="decimal"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Kg do</label>
                        <Input
                          value={inventoryFilters.qtyMax}
                          onChange={(event) =>
                            setInventoryFilters((prev) => ({
                              ...prev,
                              qtyMax: event.target.value
                            }))
                          }
                          placeholder="0"
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button
                      variant="outline"
                      className={glowClass}
                      onClick={() =>
                        setInventoryFilters({
                          dateFrom: '',
                          dateTo: '',
                          warehouseId: '',
                          locationId: '',
                          materialId: '',
                          qtyMin: '',
                          qtyMax: ''
                        })
                      }
                    >
                      Wyczysc filtry
                    </Button>
                  </div>
                </Card>

                {filteredInventoryAdjustments.length === 0 ? (
                  <EmptyState
                    title="Brak danych po filtrach"
                    description="Zmien filtry, aby zobaczyc wpisy inwentaryzacji."
                  />
                ) : (
                  <Card>
                    <DataTable
                      columns={[
                        <button
                          key="inv-sort-date"
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={() => handleInventorySort('date')}
                        >
                          Data
                          <span className="text-[10px] text-dim">{sortIndicator('date')}</span>
                        </button>,
                        <button
                          key="inv-sort-warehouse"
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={() => handleInventorySort('warehouse')}
                        >
                          Magazyn
                          <span className="text-[10px] text-dim">{sortIndicator('warehouse')}</span>
                        </button>,
                        <button
                          key="inv-sort-location"
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={() => handleInventorySort('location')}
                        >
                          Lokacja
                          <span className="text-[10px] text-dim">{sortIndicator('location')}</span>
                        </button>,
                        <button
                          key="inv-sort-material"
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={() => handleInventorySort('material')}
                        >
                          Przemial
                          <span className="text-[10px] text-dim">{sortIndicator('material')}</span>
                        </button>,
                        <button
                          key="inv-sort-prev"
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={() => handleInventorySort('prev')}
                        >
                          Przed
                          <span className="text-[10px] text-dim">{sortIndicator('prev')}</span>
                        </button>,
                        <button
                          key="inv-sort-next"
                          type="button"
                          className="inline-flex items-center gap-2"
                          onClick={() => handleInventorySort('next')}
                        >
                          Po
                          <span className="text-[10px] text-dim">{sortIndicator('next')}</span>
                        </button>,
                        'Uwagi'
                      ]}
                      rows={sortedInventoryAdjustments.map((entry) => {
                        const loc = locations.find((item) => item.id === entry.locationId);
                        const mat = catalog.find((item) => item.id === entry.materialId);
                        const warehouseName = loc ? warehouseNameMap.get(loc.warehouseId) ?? '-' : '-';
                        return [
                          new Date(entry.at).toLocaleString('pl-PL'),
                          warehouseName,
                          loc?.name ?? '-',
                          mat?.name ?? 'Nieznany przemial',
                          formatKg(entry.prevQty),
                          formatKg(entry.nextQty),
                          entry.note ?? '-'
                        ];
                      })}
                    />
                  </Card>
                )}
              </>
            )}
          </div>
        </TabsContent>
<TabsContent value="audit" className="mt-6">
          <Card>
            <DataTable
              columns={['Data', 'Uzytkownik', 'Akcja', 'Lokalizacja']}
              rows={(audit ?? []).map((row) => [
                <span key={`${row.id}-date`} className="text-dim">
                  {new Date(row.at).toLocaleString('pl-PL')}
                </span>,
                <span key={`${row.id}-user`} className="text-body">
                  {row.user}
                </span>,
                <span key={`${row.id}-action`} className="text-body">
                  {row.action}
                </span>,
                <span key={`${row.id}-loc`} className="cursor-pointer text-body transition hover:text-brandHover">
                  {row.location ?? '-'}
                </span>
              ])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="positions" className="mt-6">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Import kartotek ERP (Excel/CSV)
            </p>
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <div className="md:col-span-2">
                <p className="text-xs text-dim">
                  Format: kolumna A = nazwa kartoteki. Pierwszy arkusz w pliku.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleMaterialCatalogFileChange}
                  className="text-xs text-dim file:mr-3 file:rounded-lg file:border file:border-[rgba(255,122,26,0.45)] file:bg-[rgba(255,255,255,0.06)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-body hover:file:border-[rgba(255,122,26,0.75)]"
                  disabled={materialCatalogImporting}
                />
              </div>
              {materialCatalogImportSummary && (
                <div className="md:col-span-3">
                  <p className="text-xs text-dim">
                    Wczytano: {materialCatalogImportSummary.total}, dodano:{' '}
                    {materialCatalogImportSummary.inserted}, pominieto:{' '}
                    {materialCatalogImportSummary.skipped}.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Import przemialow (Excel/CSV)
            </p>
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <div className="md:col-span-2">
                <p className="text-xs text-dim">
                  Format: kolumna A = nazwa przemialu, kolumna B = kartoteka ERP (opcjonalnie).
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleMaterialFileChange}
                  className="text-xs text-dim file:mr-3 file:rounded-lg file:border file:border-[rgba(255,122,26,0.45)] file:bg-[rgba(255,255,255,0.06)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-body hover:file:border-[rgba(255,122,26,0.75)]"
                  disabled={materialImporting}
                />
              </div>
              {materialImportSummary && (
                <div className="md:col-span-3">
                  <p className="text-xs text-dim">
                    Wczytano: {materialImportSummary.total}, dodano:{' '}
                    {materialImportSummary.inserted}, pominieto: {materialImportSummary.skipped}.
                  </p>
                </div>
              )}
            </div>
          </Card>
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              KARTOTEKI/NAZWY PRZEMIALOW
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Button
                variant="secondary"
                className="h-full w-full justify-start"
                onClick={() => openPositionsAction('addCatalog')}
              >
                Dodaj kartoteke
              </Button>
              <Button
                variant="secondary"
                className="h-full w-full justify-start"
                onClick={() => openPositionsAction('addMaterial')}
              >
                Dodaj przemial
              </Button>
<Button
                variant="outline"
                className="h-full w-full justify-start border-[rgba(170,24,24,0.4)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                onClick={() => openPositionsAction('removeCatalog')}
              >
                Usun kartoteke
              </Button>
              <Button
                variant="outline"
                className="h-full w-full justify-start border-[rgba(170,24,24,0.4)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                onClick={() => openPositionsAction('removeMaterial')}
              >
                Usun przemial
              </Button>
            </div>
          </Card>

          {positionsAction === 'addCatalog' && (
            <Card className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dodaj kartoteke</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Nazwa kartoteki ERP</label>
                  <Input
                    value={catalogForm.name}
                    onChange={(event) =>
                      setCatalogForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="np. PRZEMIAL PP"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setPositionsAction(null)}>
                  Anuluj
                </Button>
                <Button onClick={handleAddCatalog} disabled={addCatalogMutation.isPending}>
                  Dodaj kartoteke
                </Button>
              </div>
            </Card>
          )}

          {positionsAction === 'addMaterial' && (
            <Card className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dodaj przemial</p>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Kartoteka ERP</label>
                  <SelectField
                    value={materialForm.catalogId}
                    onChange={(event) =>
                      setMaterialForm((prev) => ({ ...prev, catalogId: event.target.value }))
                    }
                  >
                    <option value="">Wybierz kartoteke</option>
                    {erpCatalogOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Nazwa przemialu</label>
                  <Input
                    value={materialForm.name}
                    onChange={(event) =>
                      setMaterialForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="np. ABS 9203"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setPositionsAction(null)}>
                  Anuluj
                </Button>
                <Button onClick={handleAddMaterial} disabled={addMaterialMutation.isPending}>
                  Dodaj przemial
                </Button>
              </div>
            </Card>
          )}

          {positionsAction === 'removeCatalog' && (
            <Card className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Usun kartoteke</p>
              <div className="grid gap-3 md:grid-cols-3 md:items-end">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Kartoteka ERP</label>
                  <SelectField
                    value={removeCatalogId}
                    onChange={(event) => setRemoveCatalogId(event.target.value)}
                  >
                    <option value="">Wybierz kartoteke</option>
                    {erpCatalogOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="flex items-center gap-3">
                  <AdminToggle
                    checked={removeCatalogWithMaterials}
                    onCheckedChange={setRemoveCatalogWithMaterials}
                    label="Usun razem z przemialami"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button variant="outline" onClick={() => setPositionsAction(null)}>
                    Anuluj
                  </Button>
                  <Button
                    variant="outline"
                    className="border-[rgba(170,24,24,0.4)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                    onClick={handleRemoveCatalog}
                    disabled={removeCatalogMutation.isPending}
                  >
                    Usun kartoteke
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {positionsAction === 'removeMaterial' && (
            <Card className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Usun przemial</p>
              <div className="grid gap-3 md:grid-cols-2 md:items-end">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Przemial</label>
                  <SelectField
                    value={removeMaterialId}
                    onChange={(event) => setRemoveMaterialId(event.target.value)}
                  >
                    <option value="">Wybierz przemial</option>
                    {materialGroups.map((group) => (
                      <optgroup key={`catalog-remove-${group}`} label={group}>
                        {(materialOptionsByGroup.get(group) ?? []).map((mat) => (
                          <option key={mat.id} value={mat.id}>
                            {mat.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectField>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button variant="outline" onClick={() => setPositionsAction(null)}>
                    Anuluj
                  </Button>
                  <Button
                    variant="outline"
                    className="border-[rgba(170,24,24,0.4)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                    onClick={handleRemoveMaterial}
                    disabled={removeMaterialMutation.isPending}
                  >
                    Usun przemial
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <Card className="mt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Przypisania przemialow do kartotek ERP
            </p>
            {materialOptions.length === 0 ? (
              <EmptyState
                title="Brak przemialow"
                description="Dodaj przemial, aby moc go przypisac do kartoteki."
              />
            ) : (
              <DataTable
                columns={['Przemial', 'Kartoteka ERP', 'Akcje']}
                rows={materialOptions.map((mat) => {
                  const currentCatalogId = mat.catalogId ?? '';
                  const draft = materialEdits[mat.id];
                  const draftName = draft?.name ?? mat.name;
                  const draftCatalogId = draft?.catalogId ?? currentCatalogId;
                  const isDirty =
                    draftName.trim() !== mat.name ||
                    (draftCatalogId || '') !== (currentCatalogId || '');
                  return [
                    <Input
                      key={`${mat.id}-name`}
                      value={draftName}
                      onChange={(event) =>
                        setMaterialEdits((prev) => ({
                          ...prev,
                          [mat.id]: {
                            name: event.target.value,
                            catalogId: prev[mat.id]?.catalogId ?? currentCatalogId
                          }
                        }))
                      }
                    />,
                    <SelectField
                      key={`${mat.id}-catalog`}
                      value={draftCatalogId}
                      onChange={(event) =>
                        setMaterialEdits((prev) => ({
                          ...prev,
                          [mat.id]: {
                            name: prev[mat.id]?.name ?? mat.name,
                            catalogId: event.target.value
                          }
                        }))
                      }
                    >
                      <option value="">Brak kartoteki</option>
                      {erpCatalogOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </SelectField>,
                    <Button
                      key={`${mat.id}-save`}
                      variant="secondary"
                      onClick={() => handleSaveMaterial(mat.id)}
                      disabled={!isDirty || updateMaterialMutation.isPending}
                    >
                      Zapisz
                    </Button>
                  ];
                })}
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="dryers" className="mt-6">
          <div className="space-y-4">
            <div className="grid gap-4">
              <Card className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                  Nowa suszarka
                </p>
                <div className="grid gap-3 md:grid-cols-[1.2fr_0.6fr]">
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Nazwa suszarki</label>
                    <Input
                      value={dryerForm.name}
                      onChange={(event) =>
                        setDryerForm((prev) => ({ ...prev, name: event.target.value }))
                      }
                      placeholder="Suszarka A1"
                    />
                  </div>
                  <div>
                    <label className="text-xs uppercase tracking-wide text-dim">Kolejnosc</label>
                    <Input
                      value={dryerForm.orderNo}
                      onChange={(event) =>
                        setDryerForm((prev) => ({ ...prev, orderNo: event.target.value }))
                      }
                      placeholder="np. 1"
                      inputMode="numeric"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Toggle
                    checked={dryerForm.isActive}
                    onCheckedChange={(value) =>
                      setDryerForm((prev) => ({ ...prev, isActive: value }))
                    }
                    label="Aktywna"
                  />
                  <Button onClick={handleAddDryer} disabled={addDryerMutation.isPending}>
                    Dodaj suszarke
                  </Button>
                </div>
              </Card>
            </div>

            {dryersLoading ? (
              <p className="text-sm text-dim">Wczytywanie...</p>
            ) : sortedDryers.length === 0 ? (
              <EmptyState
                title="Brak suszarek"
                description="Dodaj suszarke, aby pojawila sie na liscie."
              />
            ) : (
              <Card>
                <DataTable
                  columns={['Suszarka', 'Tworzywo', 'Status', 'Kolejnosc', 'Akcje']}
                  rows={sortedDryers.map((dryer) => {
                    const draft = dryerDrafts[dryer.id] ?? {
                      name: dryer.name,
                      orderNo: String(dryer.orderNo),
                      isActive: dryer.isActive
                    };
                    const isDirty = !isDryerDraftEqual(draft, {
                      name: dryer.name,
                      orderNo: String(dryer.orderNo),
                      isActive: dryer.isActive
                    });
                    return [
                      <Input
                        key={`${dryer.id}-name`}
                        value={draft.name}
                        onChange={(event) =>
                          setDryerDrafts((prev) => ({
                            ...prev,
                            [dryer.id]: { ...draft, name: event.target.value }
                          }))
                        }
                      />,
                      dryerMaterialMap.get(dryer.materialId ?? '') ?? '-',
                      <Toggle
                        key={`${dryer.id}-status`}
                        checked={draft.isActive}
                        onCheckedChange={(value) =>
                          setDryerDrafts((prev) => ({
                            ...prev,
                            [dryer.id]: { ...draft, isActive: value }
                          }))
                        }
                        label={draft.isActive ? 'Aktywna' : 'Nieaktywna'}
                      />,
                      <Input
                        key={`${dryer.id}-order`}
                        value={draft.orderNo}
                        onChange={(event) =>
                          setDryerDrafts((prev) => ({
                            ...prev,
                            [dryer.id]: { ...draft, orderNo: event.target.value }
                          }))
                        }
                        inputMode="numeric"
                      />,
                      <div key={`${dryer.id}-actions`} className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            updateDryerMutation.mutate({
                              id: dryer.id,
                              name: draft.name,
                              orderNo: parseOrderNo(draft.orderNo),
                              isActive: draft.isActive
                            })
                          }
                          disabled={!isDirty || updateDryerMutation.isPending}
                        >
                          Zapisz
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => removeDryerMutation.mutate(dryer.id)}
                          disabled={removeDryerMutation.isPending}
                          className="border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                        >
                          Usun
                        </Button>
                      </div>
                    ];
                  })}
                />
              </Card>
            )}
          </div>
        </TabsContent>
          </Tabs>
        </section>
        )}

        {activeWarehouse === 'CZESCI' && (
        <section className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Czesci zamienne</p>
            <h2 className="text-xl font-semibold text-title">Magazyn czesci zamiennych</h2>
            <p className="text-sm text-dim">
              Zarządzanie katalogiem czesci i konfiguracja magazynu.
            </p>
          </div>
          <div className="space-y-4">
            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Dodaj czesc zamienna</p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Kod</label>
                  <Input
                    value={sparePartForm.code}
                    onChange={(event) =>
                      setSparePartForm((prev) => ({ ...prev, code: event.target.value }))
                    }
                    placeholder="np. 6204"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Nazwa</label>
                  <Input
                    value={sparePartForm.name}
                    onChange={(event) =>
                      setSparePartForm((prev) => ({ ...prev, name: event.target.value }))
                    }
                    placeholder="np. Lozysko 6204"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Jednostka</label>
                  <Input
                    value={sparePartForm.unit}
                    onChange={(event) =>
                      setSparePartForm((prev) => ({ ...prev, unit: event.target.value }))
                    }
                    placeholder="szt"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-dim">Stan startowy</label>
                  <Input
                    value={sparePartForm.qty}
                    onChange={(event) =>
                      setSparePartForm((prev) => ({ ...prev, qty: event.target.value }))
                    }
                    placeholder="0"
                    inputMode="numeric"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Lokalizacja</label>
                  <Input
                    value={sparePartForm.location}
                    onChange={(event) =>
                      setSparePartForm((prev) => ({ ...prev, location: event.target.value }))
                    }
                    placeholder="np. Szafka A1"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={handleAddSparePart} disabled={addSparePartMutation.isPending}>
                  Dodaj czesc zamienna
                </Button>
              </div>
            </Card>

            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Katalog czesci</p>
              <Input
                value={sparePartSearch}
                onChange={(event) => setSparePartSearch(event.target.value)}
                placeholder="Szukaj po kodzie lub nazwie"
              />
              {spareParts.length === 0 ? (
                <p className="text-sm text-dim">Brak czesci w katalogu.</p>
              ) : (
                <DataTable
                  columns={[
                    'Kod',
                    'Nazwa',
                    'Jedn.',
                    'Lokalizacja',
                    'Stan',
                    'Akcje'
                  ]}
                  rows={spareParts
                    .filter((part) => {
                      const needle = sparePartSearch.trim().toLowerCase();
                      if (!needle) return true;
                      return (
                        part.code.toLowerCase().includes(needle) ||
                        part.name.toLowerCase().includes(needle)
                      );
                    })
                    .map((part) => {
                      const draft = sparePartDrafts[part.id] ?? {
                        code: part.code,
                        name: part.name,
                        unit: part.unit,
                        qty: String(part.qty),
                        location: part.location ?? ''
                      };
                      return [
                        <Input
                          key={`${part.id}-code`}
                          value={draft.code}
                          onChange={(event) =>
                            setSparePartDrafts((prev) => ({
                              ...prev,
                              [part.id]: { ...draft, code: event.target.value }
                            }))
                          }
                        />,
                        <Input
                          key={`${part.id}-name`}
                          value={draft.name}
                          onChange={(event) =>
                            setSparePartDrafts((prev) => ({
                              ...prev,
                              [part.id]: { ...draft, name: event.target.value }
                            }))
                          }
                        />,
                        <Input
                          key={`${part.id}-unit`}
                          value={draft.unit}
                          onChange={(event) =>
                            setSparePartDrafts((prev) => ({
                              ...prev,
                              [part.id]: { ...draft, unit: event.target.value }
                            }))
                          }
                          className="w-20"
                        />,
                        <Input
                          key={`${part.id}-location`}
                          value={draft.location}
                          onChange={(event) =>
                            setSparePartDrafts((prev) => ({
                              ...prev,
                              [part.id]: { ...draft, location: event.target.value }
                            }))
                          }
                          placeholder="-"
                        />,
                        <Input
                          key={`${part.id}-qty`}
                          value={draft.qty}
                          onChange={(event) =>
                            setSparePartDrafts((prev) => ({
                              ...prev,
                              [part.id]: { ...draft, qty: event.target.value }
                            }))
                          }
                          inputMode="numeric"
                          className="w-24"
                        />,
                        <div key={`${part.id}-actions`} className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => handleSaveSparePart(part.id)}
                            disabled={updateSparePartMutation.isPending}
                          >
                            Zapisz
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => handleSetSparePartQty(part.id)}
                            disabled={setSparePartQtyMutation.isPending}
                          >
                            Ustaw stan
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => removeSparePartMutation.mutate(part.id)}
                            disabled={removeSparePartMutation.isPending}
                          >
                            Usun
                          </Button>
                        </div>
                      ];
                    })}
                />
              )}
            </Card>

            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Historia ruchow</p>
              <Input
                value={spareHistorySearch}
                onChange={(event) => setSpareHistorySearch(event.target.value)}
                placeholder="Szukaj po czesci lub uzytkowniku"
              />
              {spareHistory.length === 0 ? (
                <p className="text-sm text-dim">Brak historii ruchow</p>
              ) : (
                <DataTable
                  columns={['Kiedy', 'Kto', 'Co', 'Ile', 'Typ', 'Uwagi']}
                  rows={spareHistory
                    .filter((entry) => {
                      const needle = spareHistorySearch.trim().toLowerCase();
                      if (!needle) return true;
                      return (
                        entry.partName.toLowerCase().includes(needle) ||
                        entry.user.toLowerCase().includes(needle)
                      );
                    })
                    .map((entry) => [
                      new Date(entry.at).toLocaleString('pl-PL'),
                      entry.user,
                      entry.partName,
                      entry.qty,
                      entry.kind === 'IN' ? 'Uzupelnienie' : 'Pobranie',
                      entry.note ?? '-'
                    ])}
                />
              )}
            </Card>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}




