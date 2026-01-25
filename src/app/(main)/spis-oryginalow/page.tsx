'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import {
  addOriginalInventory,
  addOriginalInventoryCatalog,
  addOriginalInventoryCatalogBulk,
  getOriginalInventory,
  getOriginalInventoryCatalog,
  getWarehouses,
  removeOriginalInventory,
  removeOriginalInventoryCatalog,
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
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const dailyReportExcludePatterns = [/^ABS\s*30\//i];

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [expandedMaterialKey, setExpandedMaterialKey] = useState<string | null>(null);
  const [quickQty, setQuickQty] = useState('');
  const [quickWarehouseId, setQuickWarehouseId] = useState('');
  const [editDrafts, setEditDrafts] = useState<
    Record<string, { qty: string; warehouseId: string }>
  >({});
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);
  const [reportMaterialKey, setReportMaterialKey] = useState('');
  const [reportQuery, setReportQuery] = useState('');
  const [showReportSuggestions, setShowReportSuggestions] = useState(false);
  const [reportDate, setReportDate] = useState(getLocalDateValue());
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogForm, setCatalogForm] = useState({ name: '', unit: 'kg' });
  const [catalogImporting, setCatalogImporting] = useState(false);
  const [catalogImportSummary, setCatalogImportSummary] = useState<{
    total: number;
    inserted: number;
    skipped: number;
  } | null>(null);
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
  const { data: catalog = [] } = useQuery({
    queryKey: ['spis-oryginalow-catalog'],
    queryFn: getOriginalInventoryCatalog
  });

  useEffect(() => {
    if (warehouses.length === 0) return;
    setSelectedWarehouseId((prev) => {
      if (prev && warehouses.some((warehouse) => warehouse.id === prev)) {
        return prev;
      }
      const saved = localStorage.getItem(WAREHOUSE_STORAGE_KEY);
      if (saved && warehouses.some((warehouse) => warehouse.id === saved)) {
        return saved;
      }
      return warehouses[0].id;
    });
  }, [warehouses]);

  useEffect(() => {
    if (!selectedWarehouseId) return;
    localStorage.setItem(WAREHOUSE_STORAGE_KEY, selectedWarehouseId);
  }, [selectedWarehouseId]);

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
  const addCatalogMutation = useMutation({
    mutationFn: addOriginalInventoryCatalog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-catalog'] });
      setCatalogForm({ name: '', unit: 'kg' });
      toast({ title: 'Dodano pozycje do kartoteki', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwe pozycji.',
        DUPLICATE: 'Taka pozycja juz istnieje.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie dodano pozycji.', tone: 'error' });
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
  const removeCatalogMutation = useMutation({
    mutationFn: removeOriginalInventoryCatalog,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-catalog'] });
      toast({ title: 'Usunieto pozycje z kartoteki', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        ENTRY_MISSING: 'Nie znaleziono pozycji.'
      };
      toast({ title: messageMap[err.message] ?? 'Nie usunieto pozycji.', tone: 'error' });
    }
  });

  const handleAdd = () => {
    const name = form.name.trim();
    const qtyValue = parseQtyInput(form.qty);
    if (!selectedWarehouseId) {
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
      warehouseId: selectedWarehouseId,
      name,
      qty: qtyValue,
      unit: form.unit.trim() || 'kg',
      user: user?.username ?? user?.name ?? 'nieznany'
    });
  };

  const handleCatalogAdd = () => {
    const name = catalogForm.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe pozycji.', tone: 'error' });
      return;
    }
    addCatalogMutation.mutate({
      name,
      unit: catalogForm.unit.trim() || 'kg'
    });
  };

  const handleCatalogAddFromForm = () => {
    const name = form.name.trim();
    if (!name) {
      toast({ title: 'Podaj nazwe pozycji.', tone: 'error' });
      return;
    }
    addCatalogMutation.mutate({
      name,
      unit: form.unit.trim() || 'kg'
    });
  };
  const parseCatalogRows = (rows: Array<Array<unknown>>) => {
    const normalize = (value: unknown) => String(value ?? '').trim();
    const lower = (value: unknown) => normalize(value).toLowerCase();
    const headerRow = rows[0] ?? [];
    const headerLabels = headerRow.map((cell) => lower(cell));
    const nameHeaders = ['nazwa', 'name', 'material', 'tworzywo', 'pozycja', 'kartoteka'];
    const unitHeaders = ['jednostka', 'unit', 'jm', 'j.m.', 'j.m', 'j m'];
    const nameIndex = headerLabels.findIndex((label) =>
      nameHeaders.some((key) => label.includes(key))
    );
    const unitIndex = headerLabels.findIndex((label) =>
      unitHeaders.some((key) => label.includes(key))
    );
    const startIndex = nameIndex >= 0 ? 1 : 0;

    const items: Array<{ name: string; unit?: string }> = [];
    for (let i = startIndex; i < rows.length; i += 1) {
      const row = rows[i] ?? [];
      const name = normalize(row[nameIndex >= 0 ? nameIndex : 0]);
      if (!name) continue;
      const unit = normalize(row[unitIndex >= 0 ? unitIndex : 1]);
      items.push({ name, unit: unit || 'kg' });
    }
    return items;
  };

  const handleCatalogFile = async (file: File) => {
    setCatalogImportSummary(null);
    setCatalogImporting(true);
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
      const items = parseCatalogRows(rows);
      if (items.length === 0) {
        toast({ title: 'Nie znaleziono nazw kartotek w pliku', tone: 'error' });
        return;
      }
      const result = await addOriginalInventoryCatalogBulk({ items });
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-catalog'] });
      setCatalogImportSummary(result);
      toast({
        title: 'Import zakonczony',
        description: `Dodano: ${result.inserted}, pominieto: ${result.skipped}.`,
        tone: 'success'
      });
    } catch (err) {
      toast({ title: 'Nie udalo sie zaimportowac pliku', tone: 'error' });
    } finally {
      setCatalogImporting(false);
    }
  };

  const handleCatalogFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleCatalogFile(file);
    event.target.value = '';
  };
  const handleQuickAdd = () => {
    if (!selectedGroup) return;
    const qtyValue = parseQtyInput(quickQty);
    const warehouseId = quickWarehouseId || selectedWarehouseId;
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
  const entriesForWarehouse = useMemo(() => entries, [entries]);

  const matchedCatalog = useMemo(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return null;
    return catalog.find((item) => item.name.toLowerCase() === needle) ?? null;
  }, [catalog, form.name]);
  const existingByName = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; total: number }>();
    entriesForWarehouse.forEach((entry) => {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      if (current) {
        current.total += entry.qty;
      } else {
        map.set(key, { name: entry.name, unit: entry.unit, total: entry.qty });
      }
    });
    return map;
  }, [entriesForWarehouse]);
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

  useEffect(() => {
    const matched = matchedExisting ?? matchedCatalog;
    if (!matched) return;
    setForm((prev) =>
      prev.unit === matched.unit && prev.name === matched.name
        ? prev
        : { ...prev, name: matched.name, unit: matched.unit }
    );
  }, [matchedCatalog, matchedExisting]);

  const materialGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; unit: string; entries: typeof entriesForWarehouse }
    >();
    entriesForWarehouse.forEach((entry) => {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      if (current) {
        current.entries.push(entry);
      } else {
        map.set(key, { key, name: entry.name, unit: entry.unit, entries: [entry] });
      }
    });
    return map;
  }, [entriesForWarehouse]);

  const reportOptions = useMemo(
    () =>
      [...materialGroups.values()].sort((a, b) => collator.compare(a.name, b.name)),
    [materialGroups]
  );
  const reportEntries = useMemo(() => {
    if (!reportMaterialKey) return [];
    return entriesForWarehouse
      .filter((entry) => entry.name.toLowerCase() === reportMaterialKey)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [entriesForWarehouse, reportMaterialKey]);
  const reportSuggestions = useMemo(() => {
    const needle = reportQuery.trim().toLowerCase();
    if (!needle) return [];
    return reportOptions
      .map((option) => option.name)
      .filter((name) => name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [reportOptions, reportQuery]);

  const dailyEntries = useMemo(() => {
    if (!reportDate) return [];
    return entriesForWarehouse
      .filter((entry) => entry.at.slice(0, 10) === reportDate)
      .filter(
        (entry) => !dailyReportExcludePatterns.some((pattern) => pattern.test(entry.name))
      )
      .sort((a, b) => {
        const nameCompare = collator.compare(a.name, b.name);
        if (nameCompare !== 0) return nameCompare;
        return a.at.localeCompare(b.at);
      });
  }, [entriesForWarehouse, reportDate]);
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
    if (!reportDate) return;
    const rows = [
      ['Dzien', 'Material', 'Ilosc', 'Jedn.'],
      ...dailySummary.map((row) => [reportDate, row.name, String(row.qty), row.unit])
    ];
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spis-oryginalow-${reportDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (reportOptions.length === 0) return;
    if (reportMaterialKey && reportOptions.some((opt) => opt.key === reportMaterialKey)) {
      return;
    }
    setReportMaterialKey(reportOptions[0].key);
  }, [reportMaterialKey, reportOptions]);

  useEffect(() => {
    if (!reportQuery.trim()) return;
    const match = reportOptions.find(
      (option) => option.name.toLowerCase() === reportQuery.trim().toLowerCase()
    );
    if (!match) return;
    setReportMaterialKey(match.key);
  }, [reportOptions, reportQuery]);

  useEffect(() => {
    const needle = form.name.trim().toLowerCase();
    if (!needle) return;
    const group = materialGroups.get(needle);
    if (!group) return;
    setExpandedMaterialKey(group.key);
    setForm((prev) => ({ ...prev, name: '', qty: '' }));
  }, [form.name, materialGroups]);

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
  const selectedGroup = useMemo(() => {
    if (!expandedMaterialKey) return null;
    return materialGroups.get(expandedMaterialKey) ?? null;
  }, [expandedMaterialKey, materialGroups]);
  const selectedEntries = useMemo(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.entries].sort((a, b) => b.at.localeCompare(a.at));
  }, [selectedGroup]);
  const historyLine = useMemo(() => {
    if (!selectedGroup) return '';
    const parts = [...selectedGroup.entries]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((entry) => {
        const warehouseLabel = warehouseNameMap.get(entry.warehouseId);
        return warehouseLabel ? `${entry.qty} (${warehouseLabel})` : String(entry.qty);
      });
    return parts.join(' + ');
  }, [selectedGroup, warehouseNameMap]);

  useEffect(() => {
    if (!selectedGroup) return;
    setQuickQty('');
    setQuickWarehouseId(selectedWarehouseId || warehouses[0]?.id || '');
    setEditDrafts((prev) => {
      const next = { ...prev };
      selectedGroup.entries.forEach((entry) => {
        if (!next[entry.id]) {
          next[entry.id] = { qty: String(entry.qty), warehouseId: entry.warehouseId };
        }
      });
      return next;
    });
  }, [selectedGroup, selectedWarehouseId, warehouses]);


  return (
    <div className="space-y-4">
      <Tabs defaultValue="spis" className="space-y-4">
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
                  value={selectedWarehouseId}
                  onChange={(event) => setSelectedWarehouseId(event.target.value)}
                  disabled={warehouses.length === 0}
                >
                  {!selectedWarehouseId && <option value="">Wybierz hale</option>}
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
                      setForm((prev) => ({ ...prev, name: event.target.value }));
                      setShowNameSuggestions(true);
                    }}
                    placeholder="np. BOREALIS HF700SA"
                    className="min-h-[46px]"
                    onFocus={() => setShowNameSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowNameSuggestions(false), 120);
                    }}
                  />
                  {showNameSuggestions && filteredNameSuggestions.length > 0 && (
                    <div className="absolute z-20 mt-2 w-full rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                      {filteredNameSuggestions.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setForm((prev) => ({ ...prev, name }));
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
              <div className="flex items-end justify-end lg:col-span-3">
                <Button
                  variant="secondary"
                  type="submit"
                  disabled={addMutation.isPending}
                  className="w-full"
                >
                  {matchedExisting ? 'Dodaj ilosc' : 'Dodaj wpis'}
                </Button>
              </div>
              <div className="flex items-end justify-end lg:col-span-2">
                <Button
                  variant="secondary"
                  onClick={handleCatalogAddFromForm}
                  disabled={!form.name.trim() || addCatalogMutation.isPending || Boolean(matchedCatalog)}
                  className="w-full"
                  type="button"
                >
                  {matchedCatalog ? 'Juz w kartotece' : 'Dodaj do kartoteki'}
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
                  setExpandedMaterialKey((prev) => (prev === group.key ? null : group.key));
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
                            value={quickWarehouseId || selectedWarehouseId}
                            onChange={(event) => setQuickWarehouseId(event.target.value)}
                            disabled={warehouses.length === 0}
                          >
                            {!quickWarehouseId && !selectedWarehouseId && (
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
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Import kartotek (Excel/CSV)
            </p>
            <div className="grid gap-3 md:grid-cols-3 md:items-end">
              <div className="md:col-span-2">
                <p className="text-xs text-dim">
                  Format: kolumna A = nazwa, kolumna B = jednostka (opcjonalnie). Pierwszy
                  arkusz w pliku.
                </p>
              </div>
              <div className="flex items-center justify-end gap-3">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleCatalogFileChange}
                  className="text-xs text-dim file:mr-3 file:rounded-lg file:border file:border-[rgba(255,122,26,0.45)] file:bg-[rgba(255,255,255,0.06)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-body hover:file:border-[rgba(255,122,26,0.75)]"
                  disabled={catalogImporting}
                />
              </div>
              {catalogImportSummary && (
                <div className="md:col-span-3">
                  <p className="text-xs text-dim">
                    Wczytano: {catalogImportSummary.total}, dodano:{' '}
                    {catalogImportSummary.inserted}, pominieto: {catalogImportSummary.skipped}.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Kartoteki</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-wide text-dim">Nazwa pozycji</label>
                <Input
                  value={catalogForm.name}
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="np. BOREALIS HF700SA"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-dim">Jednostka</label>
                <Input
                  value={catalogForm.unit}
                  onChange={(event) => setCatalogForm((prev) => ({ ...prev, unit: event.target.value }))}
                  placeholder="kg"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button
                  onClick={handleCatalogAdd}
                  disabled={addCatalogMutation.isPending}
                >
                  Dodaj do kartoteki
                </Button>
              </div>
            </div>
          </Card>

          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Wyszukiwarka kartotek</p>
            <Input
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder="Szukaj po nazwie"
            />
            <DataTable
              columns={['Nazwa', 'Jedn.', 'Utworzono', 'Akcje']}
              rows={filteredCatalog.map((item) => [
                item.name,
                item.unit,
                new Date(item.createdAt).toLocaleString('pl-PL'),
                <Button
                  key={`${item.id}-remove`}
                  variant="outline"
                  onClick={() => removeCatalogMutation.mutate(item.id)}
                  disabled={removeCatalogMutation.isPending}
                  className="h-8 w-8 border-[rgba(170,24,24,0.45)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                >
                  X
                </Button>
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
                    className="min-h-[46px]"
                    onFocus={() => setShowReportSuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowReportSuggestions(false), 120);
                    }}
                  />
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
            {reportMaterialKey && (
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
                  value={reportDate}
                  onChange={(event) => setReportDate(event.target.value)}
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
