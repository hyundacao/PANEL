'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addOriginalInventory,
  getOriginalInventory,
  getOriginalInventoryCatalogFromErp,
  getWarehouses,
  removeOriginalInventory,
  updateOriginalInventory
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { SelectField } from '@/components/ui/Select';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { parseQtyInput } from '@/lib/utils/format';

const WAREHOUSE_STORAGE_KEY = 'spis-oryginalow-warehouse';
const TAB_STORAGE_KEY = 'spis-oryginalow-tab';
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const dailyReportExcludePatterns = [/^ABS\s*30\//i];
const ERP_ORIGINALS_INTEGRATION_PLACEHOLDER =
  [
    'Source: ERP proxy API (aktywny)',
    'Action: getOriginalInventoryCatalogFromErp',
    'ENV: ERP_ORIGINALS_PROXY_URL',
    'ENV: ERP_ORIGINALS_PROXY_TOKEN (opcjonalny)',
    'ENV: ERP_ORIGINALS_PROXY_TIMEOUT_MS (opcjonalny, domyslnie 10000 ms)',
    'Response: [] lub { items: [] }, pola: id/name/unit/createdAt'
  ].join('\n');

const getInitialTabValue = (): 'spis' | 'kartoteki' | 'raporty' => {
  if (typeof window === 'undefined') return 'spis';
  const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
  if (saved === 'spis' || saved === 'kartoteki' || saved === 'raporty') {
    return saved;
  }
  return 'spis';
};

const getInitialWarehouseValue = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(WAREHOUSE_STORAGE_KEY) ?? '';
};

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

const toCsv = (rows: string[][]) =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          const safe = String(cell ?? '');
          if (safe.includes('"') || safe.includes(';') || safe.includes('\n')) {
            return `"${safe.replace(/"/g, '""')}"`;
          }
          return safe;
        })
        .join(';')
    )
    .join('\n');

export default function OriginalInventoryPage() {
  const toast = useToastStore((state) => state.push);
  const { user } = useUiStore();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'spis' | 'kartoteki' | 'raporty'>(() =>
    getInitialTabValue()
  );
  const [selectedWarehouseId, setSelectedWarehouseId] = useState(() =>
    getInitialWarehouseValue()
  );
  const [expandedMaterialKey, setExpandedMaterialKey] = useState<string | null>(null);
  const [quickQty, setQuickQty] = useState('');
  const [quickWarehouseId, setQuickWarehouseId] = useState('');
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { qty: string; warehouseId: string }>
  >({});
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [reportQuery, setReportQuery] = useState('');
  const [showReportSuggestions, setShowReportSuggestions] = useState(false);
  const [spisDate, setSpisDate] = useState(getLocalDateValue());
  const [catalogSearch, setCatalogSearch] = useState('');
  const [form, setForm] = useState({
    name: '',
    qty: '',
    unit: 'kg'
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['spis-oryginalow'],
    queryFn: getOriginalInventory
  });
  const { data: catalog = [], error: catalogError } = useQuery({
    queryKey: ['spis-oryginalow-catalog'],
    queryFn: getOriginalInventoryCatalogFromErp
  });
  const catalogErrorCode = catalogError instanceof Error ? catalogError.message : '';
  const effectiveSelectedWarehouseId = useMemo(() => {
    if (selectedWarehouseId && warehouses.some((warehouse) => warehouse.id === selectedWarehouseId)) {
      return selectedWarehouseId;
    }
    return warehouses[0]?.id ?? '';
  }, [selectedWarehouseId, warehouses]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!effectiveSelectedWarehouseId) return;
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, effectiveSelectedWarehouseId);
  }, [effectiveSelectedWarehouseId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

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
  const handleAdd = () => {
    const name = form.name.trim();
    const qtyValue = parseQtyInput(form.qty);
    if (!effectiveSelectedWarehouseId) {
      toast({ title: 'Wybierz hale do spisu.', tone: 'error' });
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
    addMutation.mutate({
      warehouseId: effectiveSelectedWarehouseId,
      name,
      qty: qtyValue,
      unit: form.unit.trim() || 'kg',
      at: buildEntryTimestamp(spisDate),
      user: user?.username ?? user?.name ?? 'nieznany'
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
        if (expandedMaterialKey === entryName.toLowerCase() && selectedEntries.length === 1) {
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
    if (!spisDate) return entries;
    return entries.filter((entry) => getEntryDateKey(entry.at) === spisDate);
  }, [entries, spisDate]);

  const existingByName = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; total: number }>();
    entriesForDate.forEach((entry) => {
      const key = entry.name.toLowerCase();
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
    const needle = form.name.trim().toLowerCase();
    if (!needle) return null;
    return existingByName.get(needle) ?? null;
  }, [existingByName, form.name]);
  const nameSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    existingList.forEach((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push(item.name);
    });
    catalog.forEach((item) => {
      const key = item.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push(item.name);
    });
    return list;
  }, [catalog, existingList]);
  const filteredNameSuggestions = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return [];
    return nameSuggestions
      .filter((item) => item.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [form.name, nameSuggestions]);
  const filteredCatalog = useMemo(() => {
    const needle = catalogSearch.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter((item) => item.name.toLowerCase().includes(needle));
  }, [catalog, catalogSearch]);
  const applyNameToForm = (rawName: string) => {
    const needle = rawName.trim().toLowerCase();
    if (!needle) {
      setForm((prev) => ({ ...prev, name: rawName }));
      return;
    }
    const matched =
      existingByName.get(needle) ??
      catalog.find((item) => item.name.toLowerCase() === needle) ??
      null;
    if (matched) {
      setForm((prev) => ({ ...prev, name: matched.name, unit: matched.unit }));
      return;
    }
    setForm((prev) => ({ ...prev, name: rawName }));
  };

  const materialGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; unit: string; entries: typeof entriesForDate }
    >();
    entriesForDate.forEach((entry) => {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      if (current) {
        current.entries.push(entry);
      } else {
        map.set(key, { key, name: entry.name, unit: entry.unit, entries: [entry] });
      }
    });
    return map;
  }, [entriesForDate]);

  const reportOptions = useMemo(() => {
    const map = new Map<string, { key: string; name: string }>();
    entries.forEach((entry) => {
      const key = entry.name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, { key, name: entry.name });
      }
    });
    return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [entries]);
  const selectedReportMaterialKey = useMemo(() => {
    if (reportOptions.length === 0) return '';
    const query = reportQuery.trim().toLowerCase();
    if (query) {
      const exactMatch = reportOptions.find((option) => option.name.toLowerCase() === query);
      if (exactMatch) return exactMatch.key;
    }
    return reportOptions[0].key;
  }, [reportOptions, reportQuery]);
  const reportEntries = useMemo(() => {
    if (!selectedReportMaterialKey) return [];
    return entries
      .filter((entry) => entry.name.toLowerCase() === selectedReportMaterialKey)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [entries, selectedReportMaterialKey]);
  const reportSuggestions = useMemo(() => {
    const needle = reportQuery.trim().toLowerCase();
    if (!needle) return [];
    return reportOptions
      .map((option) => option.name)
      .filter((name) => name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [reportOptions, reportQuery]);

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
    const map = new Map<string, { name: string; unit: string; qty: number }>();
    dailyEntries.forEach((entry) => {
      const key = `${entry.name.toLowerCase()}|${entry.unit.toLowerCase()}`;
      const current = map.get(key);
      if (current) {
        current.qty += entry.qty;
      } else {
        map.set(key, { name: entry.name, unit: entry.unit, qty: entry.qty });
      }
    });
    return [...map.values()].sort((a, b) => collator.compare(a.name, b.name));
  }, [dailyEntries]);

  const handleExportDaily = () => {
    if (!spisDate) return;
    const rows = [
      ['Dzien', 'Material', 'Ilosc', 'Jedn.'],
      ...dailySummary.map((row) => [spisDate, row.name, String(row.qty), row.unit])
    ];
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spis-oryginalow-${spisDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const materialGroupList = useMemo(() => {
    const list = [...materialGroups.values()].map((group) => {
      const total = group.entries.reduce((sum, entry) => sum + entry.qty, 0);
      const lastEntry = [...group.entries].sort((a, b) => b.at.localeCompare(a.at))[0];
      const hallIds = Array.from(new Set(group.entries.map((entry) => entry.warehouseId)));
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
        halls,
        lastUser: lastEntry?.user ?? '-'
      };
    });
    return list.sort((a, b) => collator.compare(a.name, b.name));
  }, [materialGroups, warehouseNameMap, warehouseOrderMap]);
  const selectedGroup = expandedMaterialKey ? materialGroups.get(expandedMaterialKey) ?? null : null;
  const selectedEntries = selectedGroup
    ? [...selectedGroup.entries].sort((a, b) => b.at.localeCompare(a.at))
    : [];
  const historyLine = selectedGroup
    ? [...selectedGroup.entries]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((entry) => {
          const warehouseLabel = warehouseNameMap.get(entry.warehouseId);
          return warehouseLabel ? `${entry.qty} (${warehouseLabel})` : String(entry.qty);
        })
        .join(' + ')
    : '';


  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="space-y-4">
        <TabsList>
          <TabsTrigger
            value="spis"
            className="data-[state=active]:bg-[var(--brand)] data-[state=active]:text-bg"
          >
            SPIS
          </TabsTrigger>
          <TabsTrigger
            value="kartoteki"
            className="data-[state=active]:bg-[#ff6a00] data-[state=active]:text-bg"
          >
            KARTOTEKI
          </TabsTrigger>
          <TabsTrigger
            value="raporty"
            className="data-[state=active]:bg-[var(--value-purple)] data-[state=active]:text-bg"
          >
            RAPORTY
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spis" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Spis oryginalow</p>
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
                  onChange={(event) => setSelectedWarehouseId(event.target.value)}
                  disabled={warehouses.length === 0}
                >
                  {!effectiveSelectedWarehouseId && <option value="">Wybierz hale</option>}
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="lg:col-span-2">
                <label className="text-xs uppercase tracking-wide text-dim">
                  Wyszukiwarka / nazwa
                </label>
                <div className="relative">
                  <Input
                    value={form.name}
                    onChange={(event) => {
                      applyNameToForm(event.target.value);
                      setShowNameSuggestions(true);
                    }}
                    placeholder="np. BOREALIS HF700SA"
                    className={form.name ? 'min-h-[46px] pr-10' : 'min-h-[46px]'}
                    onFocus={() => setShowNameSuggestions(true)}
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
                      {filteredNameSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyNameToForm(name);
                            setShowNameSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <span>{name}</span>
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
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Ilosc</label>
                <Input
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
            </form>
          </Card>

          {isLoading ? (
            <p className="text-sm text-dim">Wczytywanie...</p>
          ) : (
            <Card>
              <DataTable
                columns={['Nazwa', 'Suma', 'Jedn.', 'Hale', 'Kto']}
                rows={materialGroupList.map((group) => {
                  const isActive = expandedMaterialKey === group.key;
                  return [
                    <span
                      key={`${group.key}-name`}
                      className={`text-sm font-semibold transition ${
                        isActive ? 'text-brand' : 'text-title'
                      }`}
                    >
                      {group.name}
                    </span>,
                    group.total,
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
                    setQuickWarehouseId(effectiveSelectedWarehouseId || warehouses[0]?.id || '');
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
                            disabled={warehouses.length === 0}
                          >
                            {!quickWarehouseId && !effectiveSelectedWarehouseId && (
                              <option value="">Wybierz hale</option>
                            )}
                            {warehouses.map((warehouse) => (
                              <option key={warehouse.id} value={warehouse.id}>
                                {warehouse.name}
                              </option>
                            ))}
                          </SelectField>
                        </div>
                        <div className="flex items-end justify-end">
                          <Button
                            type="submit"
                            disabled={addMutation.isPending}
                            className="w-full"
                          >
                            Dodaj ilosc
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
                              {warehouses.map((warehouse) => (
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

        <TabsContent value="kartoteki" className="space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Integracja ERP</p>
            <p className="text-sm text-dim">
              W tym module reczne dodawanie/usuwanie kartotek i import plikow zostaly celowo
              wylaczone. Kartoteki maja byc dostarczane z systemu ERP przez API aplikacji
              posredniej.
            </p>
            {catalogErrorCode && (
              <p className="text-xs text-danger">
                Blad zrodla ERP: {catalogErrorCode}
              </p>
            )}
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
              Kartoteki (tylko odczyt)
            </p>
            <Input
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder="Szukaj po nazwie"
            />
            <DataTable
              columns={['Nazwa', 'Jedn.', 'Utworzono']}
              rows={filteredCatalog.map((item) => [
                item.name,
                item.unit,
                new Date(item.createdAt).toLocaleString('pl-PL')
              ])}
            />
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
                      {reportSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setReportQuery(name);
                            setShowReportSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {selectedReportMaterialKey && (
              <DataTable
                columns={['Kiedy', 'Ilosc', 'Jedn.', 'Hala', 'Kto']}
                rows={reportEntries.map((entry) => [
                  new Date(entry.at).toLocaleString('pl-PL'),
                  entry.qty,
                  entry.unit,
                  warehouseNameMap.get(entry.warehouseId) ?? '-',
                  entry.user
                ])}
              />
            )}
          </Card>
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Raport dzienny
            </p>
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Dzien</label>
                <Input
                  type="date"
                  value={spisDate}
                  onChange={(event) => setSpisDate(event.target.value)}
                  className="min-h-[46px]"
                />
              </div>
              <div className="md:col-span-2 flex items-end justify-end">
                <Button
                  variant="secondary"
                  onClick={handleExportDaily}
                  disabled={dailySummary.length === 0}
                >
                  Eksportuj do Excel (CSV)
                </Button>
              </div>
            </div>
            {dailySummary.length === 0 ? (
              <p className="text-sm text-dim">Brak wpisow dla wybranego dnia.</p>
            ) : (
              <DataTable
                columns={['Material', 'Ilosc', 'Jedn.']}
                rows={dailySummary.map((row) => [row.name, row.qty, row.unit])}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
