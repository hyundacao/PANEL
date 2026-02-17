'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppUser, Role, WarehouseKey } from '@/lib/api/types';
import {
  ERP_PUSH_DEFAULT_DISPATCHER_TARGET_SELECTION,
  ERP_PUSH_DEFAULT_WAREHOUSEMAN_SOURCE_SELECTION,
  ERP_PUSH_DISPATCHER_TARGET_OPTIONS,
  ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS,
  normalizeDispatcherOptions,
  normalizeDispatcherSelection,
  normalizeWarehousemanOptions,
  normalizeWarehousemanSelection
} from '@/lib/push/preferences';

export type UiFilters = {
  onlyPending: boolean;
  search: string;
};

export type ErpWorkspaceTab =
  | 'issuer'
  | 'warehouseman'
  | 'dispatcher'
  | 'dispatcher-shift'
  | 'history'
  | 'management';

const normalizeErpWorkspaceTab = (value: unknown): ErpWorkspaceTab => {
  if (value === 'issuer') return 'issuer';
  if (value === 'warehouseman') return 'warehouseman';
  if (value === 'dispatcher') return 'dispatcher';
  if (value === 'dispatcher-shift') return 'dispatcher-shift';
  if (value === 'history') return 'history';
  if (value === 'management') return 'management';
  // Backward compatibility with previously persisted tab key.
  if (value === 'operator') return 'warehouseman';
  return 'issuer';
};

type UiState = {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  hydrated: boolean;
  setHydrated: (value: boolean) => void;
  user: AppUser | null;
  setUser: (user: AppUser | null) => void;
  logout: () => void;
  role: Role;
  activeWarehouse: WarehouseKey | null;
  setActiveWarehouse: (value: WarehouseKey) => void;
  clearActiveWarehouse: () => void;
  rememberMe: boolean;
  setRememberMe: (value: boolean) => void;
  filters: UiFilters;
  setFilters: (filters: Partial<UiFilters>) => void;
  erpWorkspaceTab: ErpWorkspaceTab;
  setErpWorkspaceTab: (value: ErpWorkspaceTab) => void;
  erpDocumentNotificationsEnabled: boolean;
  setErpDocumentNotificationsEnabled: (value: boolean) => void;
  erpPushWarehousemanOptions: string[];
  setErpPushWarehousemanOptions: (value: string[]) => void;
  erpPushWarehousemanSourceSelection: string[];
  setErpPushWarehousemanSourceSelection: (value: string[]) => void;
  erpPushDispatcherTargetOptions: string[];
  setErpPushDispatcherTargetOptions: (value: string[]) => void;
  erpPushDispatcherTargetSelection: string[];
  setErpPushDispatcherTargetSelection: (value: string[]) => void;
};

type PersistedUiState = Pick<
  UiState,
  | 'sidebarCollapsed'
  | 'user'
  | 'role'
  | 'activeWarehouse'
  | 'rememberMe'
  | 'filters'
  | 'erpWorkspaceTab'
  | 'erpDocumentNotificationsEnabled'
  | 'erpPushWarehousemanOptions'
  | 'erpPushWarehousemanSourceSelection'
  | 'erpPushDispatcherTargetOptions'
  | 'erpPushDispatcherTargetSelection'
>;

const roleFromUser = (user: AppUser | null): Role => {
  if (!user) return 'VIEWER';
  return user.role ?? 'VIEWER';
};
const storageKey = 'apka-ui';
const rememberKey = `${storageKey}:remember`;
const getRememberFlag = () => {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(rememberKey) !== '0';
};

const storage = createJSONStorage<PersistedUiState>(() => ({
  getItem: (name: string) => {
    if (typeof window === 'undefined') return null;
    const remember = getRememberFlag();
    const source = remember ? window.localStorage : window.sessionStorage;
    return source.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (typeof window === 'undefined') return;
    const remember = getRememberFlag();
    const target = remember ? window.localStorage : window.sessionStorage;
    const other = remember ? window.sessionStorage : window.localStorage;
    target.setItem(name, value);
    other.removeItem(name);
  },
  removeItem: (name: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(name);
    window.sessionStorage.removeItem(name);
    window.localStorage.removeItem(rememberKey);
  }
}));

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
      hydrated: false,
      setHydrated: (value) => set({ hydrated: value }),
      user: null,
      setUser: (user) => set({ user, role: roleFromUser(user) }),
      logout: () => set({ user: null, role: 'VIEWER', activeWarehouse: null }),
      role: 'VIEWER',
      activeWarehouse: null,
      setActiveWarehouse: (value) => set({ activeWarehouse: value }),
      clearActiveWarehouse: () => set({ activeWarehouse: null }),
      rememberMe: true,
      setRememberMe: (value) => {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(rememberKey, value ? '1' : '0');
        }
        set({ rememberMe: value });
      },
      filters: { onlyPending: false, search: '' },
      setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
      erpWorkspaceTab: 'issuer',
      setErpWorkspaceTab: (value) => set({ erpWorkspaceTab: normalizeErpWorkspaceTab(value) }),
      erpDocumentNotificationsEnabled: false,
      setErpDocumentNotificationsEnabled: (value) =>
        set({ erpDocumentNotificationsEnabled: value }),
      erpPushWarehousemanOptions: [...ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS],
      setErpPushWarehousemanOptions: (value) =>
        set((state) => {
          const options = normalizeWarehousemanOptions(value);
          return {
            erpPushWarehousemanOptions: options,
            erpPushWarehousemanSourceSelection: normalizeWarehousemanSelection(
              state.erpPushWarehousemanSourceSelection,
              options
            )
          };
        }),
      erpPushWarehousemanSourceSelection: [...ERP_PUSH_DEFAULT_WAREHOUSEMAN_SOURCE_SELECTION],
      setErpPushWarehousemanSourceSelection: (value) =>
        set((state) => ({
          erpPushWarehousemanSourceSelection: normalizeWarehousemanSelection(
            value,
            state.erpPushWarehousemanOptions
          )
        })),
      erpPushDispatcherTargetOptions: [...ERP_PUSH_DISPATCHER_TARGET_OPTIONS],
      setErpPushDispatcherTargetOptions: (value) =>
        set((state) => {
          const options = normalizeDispatcherOptions(value);
          return {
            erpPushDispatcherTargetOptions: options,
            erpPushDispatcherTargetSelection: normalizeDispatcherSelection(
              state.erpPushDispatcherTargetSelection,
              options
            )
          };
        }),
      erpPushDispatcherTargetSelection: [...ERP_PUSH_DEFAULT_DISPATCHER_TARGET_SELECTION],
      setErpPushDispatcherTargetSelection: (value) =>
        set((state) => ({
          erpPushDispatcherTargetSelection: normalizeDispatcherSelection(
            value,
            state.erpPushDispatcherTargetOptions
          )
        }))
    }),
    {
      name: storageKey,
      storage,
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        user: state.user,
        role: state.role,
        activeWarehouse: state.activeWarehouse,
        rememberMe: state.rememberMe,
        filters: state.filters,
        erpWorkspaceTab: state.erpWorkspaceTab,
        erpDocumentNotificationsEnabled: state.erpDocumentNotificationsEnabled,
        erpPushWarehousemanOptions: state.erpPushWarehousemanOptions,
        erpPushWarehousemanSourceSelection: state.erpPushWarehousemanSourceSelection,
        erpPushDispatcherTargetOptions: state.erpPushDispatcherTargetOptions,
        erpPushDispatcherTargetSelection: state.erpPushDispatcherTargetSelection
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (state) {
          state.setRememberMe(getRememberFlag());
          state.setErpWorkspaceTab(normalizeErpWorkspaceTab(state.erpWorkspaceTab));
          state.setErpPushWarehousemanOptions(
            Array.isArray(state.erpPushWarehousemanOptions)
              ? state.erpPushWarehousemanOptions
              : [...ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS]
          );
          state.setErpPushDispatcherTargetOptions(
            Array.isArray(state.erpPushDispatcherTargetOptions)
              ? state.erpPushDispatcherTargetOptions
              : [...ERP_PUSH_DISPATCHER_TARGET_OPTIONS]
          );
          state.setErpPushWarehousemanSourceSelection(
            Array.isArray(state.erpPushWarehousemanSourceSelection)
              ? state.erpPushWarehousemanSourceSelection
              : [...ERP_PUSH_DEFAULT_WAREHOUSEMAN_SOURCE_SELECTION]
          );
          state.setErpPushDispatcherTargetSelection(
            Array.isArray(state.erpPushDispatcherTargetSelection)
              ? state.erpPushDispatcherTargetSelection
              : [...ERP_PUSH_DEFAULT_DISPATCHER_TARGET_SELECTION]
          );
        }
      }
    }
  )
);
