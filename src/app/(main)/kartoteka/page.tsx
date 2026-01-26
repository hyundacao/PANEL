'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { getCatalog, getCurrentMaterialTotals, getMaterialLocations, getTodayKey } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { formatKg } from '@/lib/utils/format';

type ViewMode = 'materials' | 'catalogs';
const KARTOTEKA_TAB_STORAGE_KEY = 'kartoteka-tab';

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
  const [view, setView] = useState<ViewMode>('materials');
  const [tabReady, setTabReady] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedCatalogs, setExpandedCatalogs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(KARTOTEKA_TAB_STORAGE_KEY);
    if (saved === 'materials' || saved === 'catalogs') {
      setView(saved);
    }
    setTabReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !tabReady) return;
    window.localStorage.setItem(KARTOTEKA_TAB_STORAGE_KEY, view);
  }, [tabReady, view]);

  const totalsByMaterial = useMemo(() => {
    const totals = new Map<string, number>();
    (currentTotals ?? []).forEach((item) => {
      totals.set(item.label, item.total);
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


  const catalogTotals = useMemo(() => {
    const totals = new Map<string, { total: number; count: number }>();
    (data ?? []).forEach((material) => {
      const catalog = material.code.trim();
      const entry = totals.get(catalog) ?? { total: 0, count: 0 };
      const materialTotal = totalsByMaterial.get(material.name) ?? 0;
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
      const total = totalsByMaterial.get(material.name) ?? 0;
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
          </div>

          <TabsContent value="materials" className="mt-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[inset_0_1px_0_var(--inner-highlight)]">
              <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-4 bg-surface2 px-4 py-3 text-sm font-semibold text-dim">
                <span>Przemiał</span>
                <span className="text-right">Stan ogólny</span>
              </div>
              {sortedCatalog.map((row) => {
                const isExpanded = !!expanded[row.id];
                const total = totalsByMaterial.get(row.name) ?? 0;
                const locations = materialLocations?.[row.id] ?? [];
                return (
                  <div key={row.id} className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(row.id)}
                      aria-expanded={isExpanded}
                      className="grid w-full grid-cols-[minmax(0,1fr)_160px] items-center gap-4 px-4 py-3 text-left transition hover:bg-[rgba(255,255,255,0.03)]"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronDown
                          className={`h-4 w-4 transition ${
                            isExpanded ? 'rotate-180 text-brand' : 'text-dim'
                          }`}
                        />
                        <div>
                          <p className="text-base font-semibold" style={{ color: 'var(--value-purple)' }}>
                            {row.name}
                          </p>
                          <p className="text-sm text-dim">(Kartoteka {row.code.trim()})</p>
                        </div>
                      </div>
                      <span
                        className="text-right text-base font-semibold tabular-nums"
                        style={{ color: 'var(--value-purple)' }}
                      >
                        {formatKg(total)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <div className="rounded-xl border border-border bg-surface2 px-4 py-3">
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-4 text-sm font-semibold text-dim">
                            <span>Magazyn</span>
                            <span>Lokalizacja</span>
                            <span className="text-right">Ilość (kg)</span>
                          </div>
                          {locations.length === 0 ? (
                            <p className="mt-2 text-xs text-dim">Brak stanu w lokacjach.</p>
                          ) : (
                            locations.map((location) => (
                              <div
                                key={`${row.id}-${location.locationId}`}
                                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px] gap-4 border-t border-border py-2 text-base"
                              >
                                <span className="text-body">{location.warehouseName}</span>
                                <span className="text-body">{location.locationName}</span>
                                <span
                                  className="text-right font-semibold tabular-nums"
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
            </div>
          </TabsContent>

          <TabsContent value="catalogs" className="mt-4">
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[inset_0_1px_0_var(--inner-highlight)]">
              <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-4 bg-surface2 px-4 py-3 text-sm font-semibold text-dim">
                <span>Kartoteka</span>
                <span className="text-right">Suma (kg)</span>
              </div>
              {catalogTotals.map((row) => {
                const isExpanded = !!expandedCatalogs[row.catalog];
                const items = materialsByCatalog.get(row.catalog) ?? [];
                return (
                  <div key={row.catalog} className="border-t border-border">
                    <button
                      type="button"
                      onClick={() => toggleCatalogExpanded(row.catalog)}
                      aria-expanded={isExpanded}
                      className="grid w-full grid-cols-[minmax(0,1fr)_160px] items-center gap-4 px-4 py-3 text-left transition hover:bg-[rgba(255,255,255,0.03)]"
                    >
                      <div className="flex items-center gap-3">
                        <ChevronDown
                          className={`h-4 w-4 transition ${
                            isExpanded ? 'rotate-180 text-brand' : 'text-dim'
                          }`}
                        />
                        <div>
                          <p className="text-base font-semibold" style={{ color: 'var(--brand)' }}>
                            KARTOTEKA WEDŁUG ERP {row.catalog}
                          </p>
                          <p className="text-sm text-dim">{row.count} przemiałów</p>
                        </div>
                      </div>
                      <span
                        className="text-right text-base font-semibold tabular-nums"
                        style={{ color: 'var(--value-purple)' }}
                      >
                        {formatKg(row.total)}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4">
                        <div className="rounded-xl border border-border bg-surface2 px-4 py-3">
                          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-4 text-sm font-semibold text-dim">
                            <span>Przemiał</span>
                            <span className="text-right">Ilość (kg)</span>
                          </div>
                          {items.length === 0 ? (
                            <p className="mt-2 text-xs text-dim">Brak przemiałów w kartotece.</p>
                          ) : (
                            items.map((item) => (
                              <div
                                key={`${row.catalog}-${item.id}`}
                                className="grid grid-cols-[minmax(0,1fr)_120px] gap-4 border-t border-border py-2 text-base"
                              >
                                <span className="text-body">{item.name}</span>
                                <span
                                  className="text-right font-semibold tabular-nums"
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
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
