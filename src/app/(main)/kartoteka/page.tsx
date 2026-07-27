'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { getCatalog, getCurrentMaterialTotals, getMaterialLocations, getTodayKey } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { SearchInput } from '@/components/ui/SearchInput';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { formatKg } from '@/lib/utils/format';

type ViewMode = 'materials' | 'catalogs';
const KARTOTEKA_TAB_STORAGE_KEY = 'kartoteka-tab';
const normalizeSearch = (value: string) => value.trim().toLowerCase();

export default function CatalogPage() {
  const today = getTodayKey();
  const { data } = useQuery({ queryKey: ['catalog'], queryFn: getCatalog });
  const { data: currentTotals } = useQuery({
    queryKey: ['material-totals', today, 'all'],
    queryFn: () => getCurrentMaterialTotals('all')
  });
  const { data: materialLocations } = useQuery({
    queryKey: ['material-locations', today],
    queryFn: getMaterialLocations
  });
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'materials';
    const saved = window.localStorage.getItem(KARTOTEKA_TAB_STORAGE_KEY);
    return saved === 'materials' || saved === 'catalogs' ? saved : 'materials';
  });
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedCatalogs, setExpandedCatalogs] = useState<Record<string, boolean>>({});
  const searchQuery = normalizeSearch(search);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KARTOTEKA_TAB_STORAGE_KEY, view);
  }, [view]);

  const totalsByMaterial = useMemo(() => {
    const totals = new Map<string, number>();
    (currentTotals ?? []).forEach((item) => {
      totals.set(item.materialId, item.total);
    });
    return totals;
  }, [currentTotals]);

  const sortedCatalog = useMemo(
    () =>
      [...(data ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' })
      ),
    [data]
  );

  const filteredCatalog = useMemo(() => {
    if (!searchQuery) return sortedCatalog;
    return sortedCatalog.filter((material) => {
      const name = normalizeSearch(material.name);
      const code = normalizeSearch(material.code);
      return name.includes(searchQuery) || code.includes(searchQuery);
    });
  }, [searchQuery, sortedCatalog]);


  const catalogTotals = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>();
    (data ?? []).forEach((material) => {
      const catalog = material.code.trim();
      const entry = totals.get(catalog) ?? { total: 0, count: 0 };
      const materialTotal = totalsByMaterial.get(material.id) ?? 0;
      totals.set(catalog, {
        total: entry.total + materialTotal,
        count: entry.count + 1
      });
    });
    return [...totals.entries()]
      .map(([catalog, stats]) => ({ catalog, total: stats.total, count: stats.count }))
      .sort((a, b) => a.catalog.localeCompare(b.catalog, 'pl', { sensitivity: 'base' }));
  }, [data, totalsByMaterial]);

  const materialsByCatalog = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; total: number }>>();
    (data ?? []).forEach((material) => {
      const catalog = material.code.trim();
      const total = totalsByMaterial.get(material.id) ?? 0;
      const list = map.get(catalog) ?? [];
      list.push({ id: material.id, name: material.name, total });
      map.set(catalog, list);
    });
    map.forEach((list, key) => {
      list.sort((a, b) => a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' }));
      map.set(key, list);
    });
    return map;
  }, [data, totalsByMaterial]);

  const filteredCatalogTotals = useMemo(() => {
    if (!searchQuery) return catalogTotals;
    return catalogTotals.filter((row) => {
      if (normalizeSearch(row.catalog).includes(searchQuery)) return true;
      const items = materialsByCatalog.get(row.catalog) ?? [];
      return items.some((item) => normalizeSearch(item.name).includes(searchQuery));
    });
  }, [catalogTotals, materialsByCatalog, searchQuery]);

  const getVisibleCatalogItems = (catalog: string) => {
    const items = materialsByCatalog.get(catalog) ?? [];
    if (!searchQuery || normalizeSearch(catalog).includes(searchQuery)) return items;
    return items.filter((item) => normalizeSearch(item.name).includes(searchQuery));
  };



  const toggleExpanded = (materialId: string) => {
    setExpanded((prev) => ({ ...prev, [materialId]: !prev[materialId] }));
  };

  const toggleCatalogExpanded = (catalog: string) => {
    setExpandedCatalogs((prev) => ({ ...prev, [catalog]: !prev[catalog] }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stany magazynowe"
        subtitle="Lista przemiałów"
      />

      <Card className="space-y-4">
        <Tabs value={view} onValueChange={(value) => setView(value as ViewMode)}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger
                value="materials"
                className="data-[state=active]:bg-[var(--value-purple)] data-[state=active]:text-bg"
              >
                Przemiały
              </TabsTrigger>
              <TabsTrigger
                value="catalogs"
                className="data-[state=active]:bg-[#ff6a00] data-[state=active]:text-bg"
              >
                Kartoteki
              </TabsTrigger>
            </TabsList>
            <div className="w-full sm:max-w-sm">
              <SearchInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                clearable
                onClear={() => setSearch('')}
                placeholder="Szukaj po nazwie lub kartotece"
              />
            </div>
          </div>

          <TabsContent value="materials" className="mt-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[inset_0_1px_0_var(--inner-highlight)]">
              <div className="hidden gap-4 bg-surface2 px-4 py-3 text-sm font-semibold text-dim sm:grid sm:grid-cols-[minmax(0,1fr)_160px]">
                <span>Przemiał</span>
                <span className="text-right">Stan ogólny</span>
              </div>
              {filteredCatalog.map((row) => {
                const isExpanded = !!expanded[row.id];
                const total = totalsByMaterial.get(row.id) ?? 0;
                const locations = materialLocations?.[row.id] ?? [];
                return (
                  <div key={row.id} className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(row.id)}
                      aria-expanded={isExpanded}
                      className="grid w-full gap-2 px-4 py-3 text-left transition hover:bg-[rgba(255,255,255,0.03)] sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center sm:gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronDown
                          className={`h-4 w-4 transition ${
                            isExpanded ? 'rotate-180 text-brand' : 'text-dim'
                          }`}
                        />
                        <div>
                          <p className="material-label text-base font-semibold">
                            {row.name}
                          </p>
                          <p className="catalog-label text-sm font-medium">Kartoteka {row.code.trim()}</p>
                        </div>
                      </div>
                      <span
                        className="text-left text-base font-semibold tabular-nums sm:text-right"
                        style={{ color: 'var(--value-purple)' }}
                      >
                        {formatKg(total)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <div className="rounded-xl border border-border bg-surface2 px-4 py-3">
                          <div className="hidden gap-4 text-sm font-semibold text-dim sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                            <span>Magazyn</span>
                            <span>Lokalizacja</span>
                            <span className="text-right">Ilość (kg)</span>
                          </div>
                          {locations.length === 0 ? (
                            <p className="mt-2 text-xs text-dim">Brak stanu w magazynach.</p>
                          ) : (
                            locations.map((location) => (
                              <div
                                key={`${row.id}-${location.locationId}`}
                                className="grid gap-2 border-t border-border py-2 text-base sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] sm:gap-4"
                              >
                                <span className="text-body">{location.warehouseName}</span>
                                <span
                                  className="text-left font-semibold tabular-nums sm:text-right"
                                  style={{ color: 'var(--value-purple)' }}
                                >
                                  {formatKg(location.qty)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredCatalog.length === 0 && (
                <p className="border-t border-border px-4 py-4 text-sm text-dim">
                  Brak wynikow dla podanej frazy.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="catalogs" className="mt-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[inset_0_1px_0_var(--inner-highlight)]">
              <div className="hidden gap-4 bg-surface2 px-4 py-3 text-sm font-semibold text-dim sm:grid sm:grid-cols-[minmax(0,1fr)_160px]">
                <span>Kartoteka</span>
                <span className="text-right">Suma (kg)</span>
              </div>
              {filteredCatalogTotals.map((row) => {
                const isExpanded = !!expandedCatalogs[row.catalog];
                const items = getVisibleCatalogItems(row.catalog);
                return (
                  <div key={row.catalog} className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => toggleCatalogExpanded(row.catalog)}
                      aria-expanded={isExpanded}
                      className="grid w-full gap-2 px-4 py-3 text-left transition hover:bg-[rgba(255,255,255,0.03)] sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center sm:gap-4"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronDown
                          className={`h-4 w-4 transition ${
                            isExpanded ? 'rotate-180 text-brand' : 'text-dim'
                          }`}
                        />
                        <div>
                          <p className="catalog-label text-base font-semibold">
                            KARTOTEKA WEDŁUG ERP {row.catalog}
                          </p>
                          <p className="text-sm text-dim">{row.count} przemiałów</p>
                        </div>
                      </div>
                      <span
                        className="text-left text-base font-semibold tabular-nums sm:text-right"
                        style={{ color: 'var(--value-purple)' }}
                      >
                        {formatKg(row.total)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <div className="rounded-xl border border-border bg-surface2 px-4 py-3">
                          <div className="hidden gap-4 text-sm font-semibold text-dim sm:grid sm:grid-cols-[minmax(0,1fr)_120px]">
                            <span>Przemiał</span>
                            <span className="text-right">Ilość (kg)</span>
                          </div>
                          {items.length === 0 ? (
                            <p className="mt-2 text-xs text-dim">Brak przemiałów w kartotece.</p>
                          ) : (
                            items.map((item) => (
                              <div
                                key={`${row.catalog}-${item.id}`}
                                className="grid gap-2 border-t border-border py-2 text-base sm:grid-cols-[minmax(0,1fr)_120px] sm:gap-4"
                              >
                                <span className="material-label font-medium">{item.name}</span>
                                <span
                                  className="text-left font-semibold tabular-nums sm:text-right"
                                  style={{ color: 'var(--value-purple)' }}
                                >
                                  {formatKg(item.total)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {filteredCatalogTotals.length === 0 && (
                <p className="border-t border-border px-4 py-4 text-sm text-dim">
                  Brak wynikow dla podanej frazy.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
