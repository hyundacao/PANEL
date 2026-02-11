'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AppUser, Role, WarehouseKey } from '@/lib/api/types';

export type UiFilters = {
  onlyPending: boolean;
  search: string;
};

export type ErpWorkspaceTab = 'issuer' | 'warehouseman' | 'dispatcher' | 'history';

const normalizeErpWorkspaceTab = (value: unknown): ErpWorkspaceTab => {
  if (value === 'issuer') return 'issuer';
  if (value === 'warehouseman') return 'warehouseman';
  if (value === 'dispatcher') return 'dispatcher';
  if (value === 'history') return 'history';
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
        set({ erpDocumentNotificationsEnabled: value })
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
        erpDocumentNotificationsEnabled: state.erpDocumentNotificationsEnabled
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
        if (state) {
          state.setRememberMe(getRememberFlag());
          state.setErpWorkspaceTab(normalizeErpWorkspaceTab(state.erpWorkspaceTab));
        }
      }
    }
  )
);
