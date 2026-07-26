'use client';

import type { FocusEvent } from 'react';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addInventoryMeasure,
  addMaterial,
  deleteInventoryMeasure,
  getCatalog,
  getLocations,
  getLocationDetail,
  getTodayKey,
  getWarehouses,
  removeMaterial,
  updateInventoryMeasure,
  upsertEntry
} from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';
import { useToastStore } from '@/components/ui/Toast';
import { formatKg, parseQtyInput } from '@/lib/utils/format';
import { ClipboardList, PackagePlus, Search, X } from 'lucide-react';

type MaterialFormState = {
  materialId: string | null;
  qty: string;
  comment: string;
  manualMode: boolean;
  manualCatalog: string;
  manualName: string;
};

const initialMaterialState: MaterialFormState = {
  materialId: null,
  qty: '',
  comment: '',
  manualMode: false,
  manualCatalog: '',
  manualName: ''
};

type MeasureDraft = {
  qty: string;
  comment: string;
};
const collator = new Intl.Collator('pl', { sensitivity: 'base' });

export default function LocationDetailPage() {
  const params = useParams();
  const warehouseId = params.warehouseId as string;
  const locationId = params.locationId as string;
  const today = getTodayKey();
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });
  const { data: locationOptions } = useQuery({
    queryKey: ['locations-options'],
    queryFn: getLocations
  });
  const warehouse = warehouses?.find((item) => item.id === warehouseId);
  const location = locationOptions?.find((item) => item.id === locationId);
  const { user } = useUiStore();
  const canEdit = !isReadOnly(user, 'PRZEMIALY');
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [showZero, setShowZero] = useState(false);
  const [inventoryQuery, setInventoryQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MaterialFormState>(initialMaterialState);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [measureDrafts, setMeasureDrafts] = useState<Record<string, MeasureDraft>>({});
  const [measurementEdits, setMeasurementEdits] = useState<Record<string, MeasureDraft>>({});
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [editingTotalMaterialId, setEditingTotalMaterialId] = useState<string | null>(null);
  const [totalEditDrafts, setTotalEditDrafts] = useState<Record<string, string>>({});
  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';

  const unlockInput = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.readOnly = false;
  };

  const relockInput = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.readOnly = true;
  };

  const { data: detail, isLoading } = useQuery({
    queryKey: ['location-detail', warehouseId, locationId, today],
    queryFn: () => getLocationDetail(warehouseId, locationId, today)
  });
  const { data: catalog } = useQuery({
    queryKey: ['catalog'],
    queryFn: getCatalog
  });

  const invalidateDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ['dashboard', today] });
    queryClient.invalidateQueries({ queryKey: ['monthly-delta', today] });
    queryClient.invalidateQueries({ queryKey: ['monthly-breakdown', today] });
    queryClient.invalidateQueries({ queryKey: ['material-totals'] });
    queryClient.invalidateQueries({ queryKey: ['material-locations', today] });
    queryClient.invalidateQueries({ queryKey: ['top-catalog', today] });
    queryClient.invalidateQueries({ queryKey: ['totals-history'] });
    queryClient.invalidateQueries({ queryKey: ['daily-history'] });
    queryClient.invalidateQueries({ queryKey: ['report-period'] });
    queryClient.invalidateQueries({ queryKey: ['report-yearly'] });
  };

  const mutation = useMutation({
    mutationFn: upsertEntry,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['location-detail', warehouseId, locationId, today] });
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId, today] });
      invalidateDashboard();
      if (variables.qty === 0) {
        toast({
          title: 'Wyzerowano pozycję',
          description: 'Ubytek został policzony w raporcie.',
          tone: 'success'
        });
        return;
      }
      toast({ title: 'Zapisano wpis', tone: 'success' });
    },
    onError: (err: Error) => {
      const conflict = err.message === 'CONFLICT';
      toast({
        title: conflict ? 'Konflikt danych' : 'Błąd zapisu',
        description: conflict ? 'Odśwież dane i spróbuj ponownie.' : 'Nie udało się zapisać wpisu.',
        tone: 'error'
      });
    }
  });

  const addMeasureMutation = useMutation({
    mutationFn: addInventoryMeasure,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['location-detail', warehouseId, locationId, today] });
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId, today] });
      invalidateDashboard();
      setMeasureDrafts((prev) => ({
        ...prev,
        [variables.materialId]: { qty: '', comment: '' }
      }));
      toast({ title: 'Dopisano pomiar', tone: 'success' });
    },
    onError: () => {
      toast({
        title: 'Nie dopisano pomiaru',
        description: 'Sprawdź ilość i spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const updateMeasureMutation = useMutation({
    mutationFn: updateInventoryMeasure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-detail', warehouseId, locationId, today] });
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId, today] });
      invalidateDashboard();
      setEditingMeasurementId(null);
      toast({ title: 'Poprawiono pomiar', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie poprawiono pomiaru', description: 'Sprawdź ilość i spróbuj ponownie.', tone: 'error' });
    }
  });

  const deleteMeasureMutation = useMutation({
    mutationFn: deleteInventoryMeasure,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['location-detail', warehouseId, locationId, today] });
      queryClient.invalidateQueries({ queryKey: ['locations', warehouseId, today] });
      invalidateDashboard();
      toast({ title: 'Usunięto pomiar', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunięto pomiaru', description: 'Spróbuj ponownie.', tone: 'error' });
    }
  });

  const addMaterialMutation = useMutation({
    mutationFn: addMaterial,
    onSuccess: (material) => {
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setForm((prev) => ({
        ...prev,
        materialId: material.id,
        manualMode: false,
        manualCatalog: '',
        manualName: ''
      }));
      toast({ title: 'Dodano do kartoteki', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Kartoteka już istnieje', description: 'Wybierz inną kartotekę.', tone: 'error' });
    }
  });

  const removeMaterialMutation = useMutation({
    mutationFn: removeMaterial,
    onSuccess: (_data, materialId) => {
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setForm((prev) => (prev.materialId === materialId ? { ...prev, materialId: null } : prev));
      toast({ title: 'Usunieto przemial', tone: 'success' });
    },
    onError: () => {
      toast({ title: 'Nie usunieto przemialu', tone: 'error' });
    }
  });

  const visibleItems = useMemo(() => {
    const query = inventoryQuery.trim().toLowerCase();
    const items = (detail ?? []).filter(
      (item) => !query || `${item.name} ${item.code}`.toLowerCase().includes(query)
    );
    if (showZero) return items;
    return items.filter((item) => (item.todayQty ?? item.yesterdayQty) !== 0);
  }, [detail, inventoryQuery, showZero]);

  const getMeasureDraft = (materialId: string): MeasureDraft =>
    measureDrafts[materialId] ?? { qty: '', comment: '' };

  const updateMeasureDraft = (materialId: string, patch: Partial<MeasureDraft>) => {
    setMeasureDrafts((prev) => ({
      ...prev,
      [materialId]: {
        ...(prev[materialId] ?? { qty: '', comment: '' }),
        ...patch
      }
    }));
  };

  const getMeasurementEdit = (measurement: { id: string; qty: number; comment?: string }): MeasureDraft =>
    measurementEdits[measurement.id] ?? { qty: String(measurement.qty), comment: measurement.comment ?? '' };

  const updateMeasurementEdit = (measurementId: string, patch: Partial<MeasureDraft>) => {
    setMeasurementEdits((prev) => ({
      ...prev,
      [measurementId]: { ...(prev[measurementId] ?? { qty: '', comment: '' }), ...patch }
    }));
  };

  const startEditingMeasurement = (measurement: { id: string; qty: number; comment?: string }) => {
    setMeasurementEdits((prev) => ({
      ...prev,
      [measurement.id]: { qty: String(measurement.qty), comment: measurement.comment ?? '' }
    }));
    setEditingMeasurementId(measurement.id);
  };

  const saveMeasurementEdit = async (materialId: string, measurement: { id: string; qty: number; comment?: string }) => {
    const draft = getMeasurementEdit(measurement);
    const qty = parseQtyInput(draft.qty);
    if (qty === null || qty <= 0) {
      toast({ title: 'Nieprawidłowa ilość', description: 'Wpisz ilość większą od zera.', tone: 'error' });
      return;
    }
    await updateMeasureMutation.mutateAsync({
      locationId,
      materialId,
      measurementId: measurement.id,
      qty,
      comment: draft.comment
    });
  };

  const startEditingTotal = (materialId: string, currentQty: number) => {
    setTotalEditDrafts((prev) => ({ ...prev, [materialId]: String(currentQty) }));
    setEditingTotalMaterialId(materialId);
  };

  const saveTotalEdit = async (item: { materialId: string; todayQty: number | null; comment?: string }) => {
    const qty = parseQtyInput(totalEditDrafts[item.materialId] ?? '');
    if (qty === null || qty < 0) {
      toast({ title: 'Nieprawidłowa ilość', description: 'Wpisz poprawną ilość w kg.', tone: 'error' });
      return;
    }
    await mutation.mutateAsync({ locationId, materialId: item.materialId, qty, comment: item.comment });
    setEditingTotalMaterialId(null);
  };

  const deleteMeasurement = async (materialId: string, measurementId: string) => {
    if (!window.confirm('Usunąć ten pomiar? Suma dzisiejszego spisu zostanie przeliczona.')) return;
    await deleteMeasureMutation.mutateAsync({ locationId, materialId, measurementId });
  };

  const deleteTotal = async (item: { materialId: string; comment?: string }) => {
    if (!window.confirm('Usunąć dzisiejszy wpis dla tego przemiału?')) return;
    await mutation.mutateAsync({ locationId, materialId: item.materialId, qty: 0, comment: item.comment });
  };

  const handleAddMeasure = async (item: { materialId: string }) => {
    const draft = getMeasureDraft(item.materialId);
    const qty = parseQtyInput(draft.qty);
    if (qty === null || qty <= 0) {
      toast({ title: 'Nieprawidłowa ilość', description: 'Wpisz ilość większą od zera.', tone: 'error' });
      return;
    }
    await addMeasureMutation.mutateAsync({
      locationId,
      materialId: item.materialId,
      qty,
      comment: draft.comment
    });
  };

  const catalogList = useMemo(() => catalog ?? [], [catalog]);
  const catalogGroups = useMemo(
    () =>
      Array.from(new Set((catalog ?? []).map((item) => item.code))).sort((a, b) =>
        collator.compare(a, b)
      ),
    [catalog]
  );
  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return catalogList;
    return catalogList.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)
    );
  }, [catalogList, catalogQuery]);

  const handleAddToLocation = async () => {
    if (!form.materialId) return;
    const qty = parseQtyInput(form.qty);
    if (qty === null) return;
    await mutation.mutateAsync({ locationId, materialId: form.materialId, qty, comment: form.comment });
    setForm(initialMaterialState);
    setCatalogQuery('');
    setDialogOpen(false);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setForm(initialMaterialState);
    setCatalogQuery('');
  };

  const handleAddManual = async () => {
    if (!form.manualCatalog.trim() || !form.manualName.trim()) return;
    await addMaterialMutation.mutateAsync({
      code: form.manualCatalog.trim().toUpperCase(),
      name: form.manualName.trim()
    });
  };
  const handleRemoveMaterial = async () => {
    if (!form.materialId) return;
    await removeMaterialMutation.mutateAsync(form.materialId);
  };

  const hasTodayEntries = (detail ?? []).some((item) => item.todayQty !== null);
  const totalItems = (detail ?? []).length;
  const countedItems = (detail ?? []).filter((item) => item.todayQty !== null).length;
  const remainingItems = Math.max(totalItems - countedItems, 0);
  const totalTodayQty = (detail ?? []).reduce((sum, item) => sum + (item.todayQty ?? 0), 0);
  const progressPercent = totalItems === 0 ? 0 : Math.round((countedItems / totalItems) * 100);

  return (
    <div className="min-w-0 space-y-4 pb-8 sm:space-y-6">
      <PageHeader
        title={`Spis zbiorczy: ${warehouse?.name ?? location?.name ?? 'Obszar'}`}
        subtitle={`Stan na dzień ${today}`}
        titleColor="var(--brand)"
        actions={
          <>
            <Button
              disabled={!canEdit}
              onClick={() => setDialogOpen(true)}
              className={`${glowClass} min-h-12 w-full px-3 text-xs sm:w-auto sm:text-sm`}
            >
              <PackagePlus className="mr-2 h-4 w-4" />
              Dodaj przemiał
            </Button>
            {dialogOpen && (
              <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:py-6">
                <div className="absolute inset-0 bg-[var(--scrim)]" onClick={closeDialog} />
                <div className="relative z-10 h-[100dvh] w-full overflow-y-auto border border-border bg-[var(--surface-1)] p-4 shadow-[inset_0_1px_0_var(--inner-highlight)] sm:h-auto sm:max-h-[94vh] sm:min-h-[80vh] sm:max-w-2xl sm:rounded-2xl sm:p-6">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="absolute right-4 top-4 text-dim hover:text-title"
                    aria-label="Zamknij"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-dim">Dodaj przemiał</p>
                      <h3 className="text-lg font-semibold text-title">Nowy wpis do lokacji</h3>
                    </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className={`${glowClass} ${!form.manualMode ? 'border-[rgba(255,106,0,0.55)] bg-brandSoft text-title' : ''}`}
                      onClick={() => setForm((prev) => ({ ...prev, manualMode: false }))}
                    >
                      Wybierz z listy
                    </Button>
                    <Button
                      variant="secondary"
                      className={`${glowClass} ${form.manualMode ? 'border-[rgba(255,106,0,0.55)] bg-brandSoft text-title' : ''}`}
                      onClick={() => setForm((prev) => ({ ...prev, manualMode: true }))}
                    >
                      Dodaj nowy
                    </Button>
                  </div>

                  {!form.manualMode && (
                    <div className="space-y-3">
                      <label className="text-xs uppercase tracking-wide text-dim">Nazwa przemiału</label>
                      <Input
                        value={catalogQuery}
                        readOnly
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        onFocus={unlockInput}
                        onBlur={relockInput}
                        onChange={(event) => setCatalogQuery(event.target.value)}
                        placeholder="Szukaj po nazwie lub kartotece"
                      />
                      <div className="max-h-80 min-h-[18rem] space-y-2 overflow-y-auto pr-2">
                        {filteredCatalog.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setForm((prev) => ({ ...prev, materialId: item.id }))}
                            className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                              form.materialId === item.id
                                ? 'relative overflow-hidden border-[rgba(255,106,0,0.85)] bg-[linear-gradient(180deg,rgba(255,106,0,0.10),rgba(255,106,0,0.04))] text-body shadow-[0_0_0_1px_rgba(255,106,0,0.25),0_12px_24px_-20px_rgba(255,106,0,0.8)]'
                                : 'border-border bg-surface2 text-muted hover:border-borderStrong'
                            }`}
                          >
                            {form.materialId === item.id && (
                              <span className="absolute left-0 top-0 h-full w-[3px] rounded-l-xl bg-brand" />
                            )}
                            <p className="text-sm font-semibold" style={{ color: 'var(--value-purple)' }}>
                              {item.name}
                            </p>
                            <p className="text-xs text-dim">{item.code}</p>
                          </button>
                        ))}
                        {filteredCatalog.length === 0 && (
                          <p className="text-sm text-muted">Brak wynikow dla podanej frazy.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {form.manualMode && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Nazwa przemiału</label>
                        <Input
                          value={form.manualName}
                          readOnly
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="characters"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          onFocus={unlockInput}
                          onBlur={relockInput}
                          onChange={(event) => setForm((prev) => ({ ...prev, manualName: event.target.value }))}
                          placeholder="np. Borealis HF700SA"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Kartoteka</label>
                        <SelectField
                          value={form.manualCatalog}
                          onChange={(event) =>
                            setForm((prev) => ({ ...prev, manualCatalog: event.target.value }))
                          }
                        >
                          <option value="" disabled>
                            Wybierz kartoteke
                          </option>
                          {catalogGroups.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </SelectField>
                      </div>
                      <div className="md:col-span-2">
                        <Button variant="primaryEmber" onClick={handleAddManual}>
                          DODAJ DO LISTY PRZEMIAŁÓW
                        </Button>
                      </div>
                    </div>
                  )}

                  {!form.manualMode && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Ilość (kg)</label>
                        <Input
                          value={form.qty}
                          readOnly
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          onFocus={unlockInput}
                          onBlur={relockInput}
                          onChange={(event) => setForm((prev) => ({ ...prev, qty: event.target.value }))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Komentarz</label>
                        <Input
                          value={form.comment}
                          readOnly
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="sentences"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-form-type="other"
                          onFocus={unlockInput}
                          onBlur={relockInput}
                          onChange={(event) => setForm((prev) => ({ ...prev, comment: event.target.value }))}
                          placeholder="Opcjonalnie"
                        />
                      </div>
                    </div>
                  )}

                  <div className="sticky bottom-0 z-20 -mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface2 px-4 py-3 sm:-mx-6 sm:-mb-6 sm:gap-3 sm:rounded-b-2xl sm:px-6 sm:py-4">
                    <Button variant="outline" onClick={closeDialog} className={`${glowClass} min-h-12 w-full sm:w-auto`}>
                      Anuluj
                    </Button>
                    {!form.manualMode && (
                      <Button
                        variant="outline"
                        onClick={handleRemoveMaterial}
                        disabled={!form.materialId}
                        className="min-h-12 w-full border-[rgba(170,24,24,0.65)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)] sm:w-auto"
                      >
                        Usun przemial
                      </Button>
                    )}
                    {!form.manualMode && (
                      <Button onClick={handleAddToLocation} disabled={!form.materialId} className="min-h-12 w-full sm:w-auto">
                        Dodaj do lokacji
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            )}
          </>
        }
      />

      <Card className="space-y-4 border-[rgba(255,106,0,0.24)] bg-[linear-gradient(135deg,rgba(255,106,0,0.08),rgba(18,19,26,0.94)_42%)] sm:space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-[var(--brand)]" />
              <p className="text-sm font-bold uppercase tracking-[0.14em] text-title">Postęp spisu</p>
            </div>
            <p className="mt-1 text-sm text-muted">
              {hasTodayEntries
                ? 'Dopisuj kolejne miejsca i pilnuj, zeby dzisiejsza suma zgadzala sie ze spisem hali.'
                : 'Rozpocznij od dodania lub przeliczenia pierwszego przemiału.'}
            </p>
          </div>
          <div className="w-full rounded-xl border border-borderStrong bg-surface2 px-4 py-2 text-center text-sm font-bold text-title sm:w-auto sm:rounded-full">
            {totalItems === 0
              ? 'Gotowy do rozpoczęcia'
              : remainingItems === 0
                ? 'Spis ukończony'
                : 'Spis w toku'}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          {[
            { label: 'Wszystkie pozycje', value: totalItems, color: 'text-title' },
            { label: 'Spisane dzisiaj', value: countedItems, color: 'text-success' },
            { label: 'Pozostało', value: remainingItems, color: 'text-warning' },
            { label: 'Stan łącznie', value: formatKg(totalTodayQty), color: 'text-[var(--value-purple)]' }
          ].map((metric) => (
            <div key={metric.label} className="min-w-0 rounded-xl border border-border bg-surface2 px-3 py-3 sm:px-4">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-dim sm:text-[11px]">{metric.label}</p>
              <p className={`mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl ${metric.color}`}>{metric.value}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-xs font-bold">
            <span className="text-muted">Wykonano {countedItems} z {totalItems}</span>
            <span className="text-title">{progressPercent}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-surface2">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),#ff9a52)] transition-[width] duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </Card>

      <Card className="flex min-w-0 flex-col gap-3 sm:gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <Input
            value={inventoryQuery}
            onChange={(event) => setInventoryQuery(event.target.value)}
            placeholder="Szukaj przemiału lub kartoteki"
            className="pl-10"
          />
        </div>
        <Toggle checked={showZero} onCheckedChange={setShowZero} label="Pokaż pozycje zerowe" />
      </Card>

      {isLoading && <Card>Ładowanie danych...</Card>}

      <Card className="min-w-0 space-y-4">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-bold text-title">Lista przemiałów</p>
            <p className="mt-1 text-xs text-dim">Widoczne pozycje: {visibleItems.length}</p>
          </div>
          <Button onClick={() => setDialogOpen(true)} disabled={!canEdit} variant="secondary" className="min-h-12 w-full sm:w-auto">
            <PackagePlus className="mr-2 h-4 w-4" />
            Dodaj pozycję
          </Button>
        </div>
        {visibleItems.length > 0 && (
        <div className="hidden grid-cols-[minmax(220px,1.7fr)_110px_150px_minmax(240px,1.7fr)_240px] gap-3 px-3 text-xs font-bold uppercase tracking-wide text-dim md:grid">
          <span>Przemial</span>
          <span>Ostatni spis</span>
          <span>Suma dzisiejszego spisu</span>
          <span>Dzisiejsze pomiary</span>
          <span>Dodaj ilosc</span>
        </div>
        )}
        {visibleItems.length === 0 && (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-borderStrong bg-surface2 px-6 py-10 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,106,0,0.28)] bg-brandSoft">
              <PackagePlus className="h-7 w-7 text-[var(--brand)]" />
            </div>
            <p className="mt-5 text-lg font-bold text-title">
              {inventoryQuery ? 'Brak pasujących pozycji' : 'Brak przemiałów w tym obszarze'}
            </p>
            <p className="mt-2 max-w-md text-sm text-muted">
              {inventoryQuery
                ? 'Zmień wyszukiwaną frazę albo wyczyść pole wyszukiwania.'
                : 'Dodaj pierwszy przemiał i wpisz jego rzeczywistą ilość w kilogramach.'}
            </p>
            {!inventoryQuery && canEdit && (
              <Button onClick={() => setDialogOpen(true)} className="mt-5">
                <PackagePlus className="mr-2 h-4 w-4" />
                Dodaj pierwszy przemiał
              </Button>
            )}
          </div>
        )}
        <div className="min-w-0 space-y-3 md:hidden">
          {visibleItems.map((item) => (
            <div
              key={`mobile-${item.materialId}`}
              className={`min-w-0 space-y-4 rounded-xl border p-3.5 ${
                item.todayQty !== null
                  ? 'border-[rgba(34,197,94,0.30)] bg-[rgba(34,197,94,0.05)]'
                  : 'border-border bg-surface2'
              }`}
            >
              <div className="min-w-0 border-b border-border pb-3">
                <p className="break-words text-base font-bold leading-snug" style={{ color: 'var(--value-purple)' }}>
                  {item.name}
                </p>
                <p className="mt-1 break-all text-xs text-dim">{item.code}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 rounded-lg border border-border bg-[var(--surface-1)] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Ostatni spis
                  </p>
                  <p className="mt-1 truncate text-base font-bold text-body tabular-nums">{formatKg(item.yesterdayQty)}</p>
                </div>
                <div className="min-w-0 rounded-lg border border-border bg-[var(--surface-1)] px-3 py-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Suma dzisiejszego spisu
                  </p>
                  {editingTotalMaterialId === item.materialId ? (
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Input
                        readOnly
                        value={totalEditDrafts[item.materialId] ?? ''}
                        inputMode="decimal"
                        onFocus={unlockInput}
                        onChange={(event) => setTotalEditDrafts((prev) => ({ ...prev, [item.materialId]: event.target.value }))}
                        onBlur={relockInput}
                      />
                      <Button
                        onClick={() => saveTotalEdit(item)}
                        disabled={mutation.isPending}
                        className="h-10 min-h-10 px-3 text-xs"
                      >
                        Zapisz
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <p className="truncate text-base font-bold text-title tabular-nums">{formatKg(item.todayQty ?? 0)}</p>
                      {canEdit && (item.measurements ?? []).length === 0 && (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditingTotal(item.materialId, item.todayQty ?? 0)}
                            className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                          >
                            Edytuj
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTotal(item)}
                            disabled={mutation.isPending}
                            className="text-xs font-semibold text-danger underline underline-offset-2"
                          >
                            Usuń
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>                <div className="col-span-2 min-w-0 rounded-lg border border-border bg-[var(--surface-1)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                      Dzisiejsze pomiary
                    </p>
                    <p className="text-sm font-bold text-title tabular-nums">
                      Suma: {formatKg(item.todayQty ?? 0)}
                    </p>
                  </div>
                  {item.measurements && item.measurements.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.measurements.map((measurement, index) =>
                        editingMeasurementId === measurement.id ? (
                          <div key={measurement.id} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                            <Input
                              readOnly
                              value={getMeasurementEdit(measurement).qty}
                              inputMode="decimal"
                              onFocus={unlockInput}
                              onChange={(event) => updateMeasurementEdit(measurement.id, { qty: event.target.value })}
                              onBlur={relockInput}
                            />
                            <Button
                              onClick={() => saveMeasurementEdit(item.materialId, measurement)}
                              disabled={updateMeasureMutation.isPending}
                              className="h-10 min-h-10 px-3 text-xs"
                            >
                              Zapisz
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setEditingMeasurementId(null)}
                              className="h-10 min-h-10 px-3 text-xs"
                            >
                              Anuluj
                            </Button>
                          </div>
                        ) : (
                          <span
                            key={measurement.id}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[rgba(255,106,0,0.24)] bg-brandSoft px-2 py-1 text-xs text-title"
                          >
                            <span className="font-bold">{index + 1}.</span>
                            <span className="font-bold tabular-nums">{formatKg(measurement.qty)}</span>
                            {measurement.comment && (
                              <span className="max-w-[11rem] truncate text-dim">- {measurement.comment}</span>
                            )}
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditingMeasurement(measurement)}
                                  className="ml-1 font-semibold text-[var(--brand)] underline underline-offset-2"
                                >
                                  Edytuj
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteMeasurement(item.materialId, measurement.id)}
                                  disabled={deleteMeasureMutation.isPending}
                                  className="font-semibold text-danger underline underline-offset-2"
                                >
                                  Usuń
                                </button>
                              </>
                            )}
                          </span>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-dim">Brak dopisanych pomiarów.</p>
                  )}
                </div>
                <div className="col-span-2 min-w-0 rounded-lg border border-[rgba(34,197,94,0.20)] bg-[rgba(34,197,94,0.05)] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Dopisz kolejną ilość
                  </p>
                  {!canEdit ? (
                    <p className="mt-2 text-sm text-dim">Brak uprawnień do edycji.</p>
                  ) : (
                    <div className="mt-2 grid gap-2">
                      <Input
                        readOnly
                        value={getMeasureDraft(item.materialId).qty}
                        placeholder="Ilość kg, np. 200"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        enterKeyHint="done"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        onFocus={unlockInput}
                        onChange={(event) => updateMeasureDraft(item.materialId, { qty: event.target.value })}
                        onBlur={relockInput}
                      />
                      <Input
                        readOnly
                        value={getMeasureDraft(item.materialId).comment}
                        placeholder="Miejsce/uwaga, np. przy WTR 04"
                        type="text"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="sentences"
                        spellCheck={false}
                        enterKeyHint="done"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-form-type="other"
                        onFocus={unlockInput}
                        onChange={(event) => updateMeasureDraft(item.materialId, { comment: event.target.value })}
                        onBlur={relockInput}
                      />
                      <Button
                        onClick={() => handleAddMeasure(item)}
                        disabled={!getMeasureDraft(item.materialId).qty || addMeasureMutation.isPending}
                        className={`${glowClass} h-12 min-h-12 w-full rounded-lg px-3`}
                      >
                        Dopisz do sumy
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        {visibleItems.map((item) => (
          <div
            key={item.materialId}
            className={`hidden grid-cols-[minmax(220px,1.7fr)_110px_150px_minmax(240px,1.7fr)_240px] items-center gap-3 rounded-xl border p-3 md:grid ${
              item.todayQty !== null
                ? 'border-[rgba(34,197,94,0.30)] bg-[rgba(34,197,94,0.05)]'
                : 'border-border bg-surface2'
            }`}
          >
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--value-purple)' }}>
                {item.name}
              </p>
              <p className="text-xs text-dim">{item.code}</p>
            </div>
            <div className="text-sm text-body tabular-nums">{formatKg(item.yesterdayQty)}</div>
            <div>
              {editingTotalMaterialId === item.materialId ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                  <Input
                    readOnly
                    value={totalEditDrafts[item.materialId] ?? ''}
                    inputMode="decimal"
                    onFocus={unlockInput}
                    onChange={(event) => setTotalEditDrafts((prev) => ({ ...prev, [item.materialId]: event.target.value }))}
                    onBlur={relockInput}
                  />
                  <Button
                    onClick={() => saveTotalEdit(item)}
                    disabled={mutation.isPending}
                    className="h-10 min-h-10 px-3 text-xs"
                  >
                    Zapisz
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-base font-bold text-title tabular-nums">{formatKg(item.todayQty ?? 0)}</p>
                  {canEdit && (item.measurements ?? []).length === 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEditingTotal(item.materialId, item.todayQty ?? 0)}
                        className="text-xs font-semibold text-[var(--brand)] underline underline-offset-2"
                      >
                        Edytuj
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTotal(item)}
                        disabled={mutation.isPending}
                        className="text-xs font-semibold text-danger underline underline-offset-2"
                      >
                        Usuń
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div>
              <div className="flex flex-wrap gap-1.5">
                    {(item.measurements ?? []).length > 0 ? (
                      item.measurements?.map((measurement, index) =>
                        editingMeasurementId === measurement.id ? (
                          <div key={measurement.id} className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                            <Input
                              readOnly
                              value={getMeasurementEdit(measurement).qty}
                              inputMode="decimal"
                              onFocus={unlockInput}
                              onChange={(event) => updateMeasurementEdit(measurement.id, { qty: event.target.value })}
                              onBlur={relockInput}
                            />
                            <Button
                              onClick={() => saveMeasurementEdit(item.materialId, measurement)}
                              disabled={updateMeasureMutation.isPending}
                              className="h-9 min-h-9 px-2 text-xs"
                            >
                              Zapisz
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setEditingMeasurementId(null)}
                              className="h-9 min-h-9 px-2 text-xs"
                            >
                              Anuluj
                            </Button>
                          </div>
                        ) : (
                          <span
                            key={measurement.id}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border border-[rgba(255,106,0,0.24)] bg-brandSoft px-2 py-1 text-[11px] text-title"
                          >
                            <span className="font-bold">{index + 1}.</span>
                            <span className="font-bold tabular-nums">{formatKg(measurement.qty)}</span>
                            {measurement.comment && (
                              <span className="max-w-[9rem] truncate text-dim">- {measurement.comment}</span>
                            )}
                            {canEdit && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEditingMeasurement(measurement)}
                                  className="ml-1 font-semibold text-[var(--brand)] underline underline-offset-2"
                                >
                                  Edytuj
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteMeasurement(item.materialId, measurement.id)}
                                  disabled={deleteMeasureMutation.isPending}
                                  className="font-semibold text-danger underline underline-offset-2"
                                >
                                  Usuń
                                </button>
                              </>
                            )}
                          </span>
                        )
                      )
                    ) : (
                      <span className="text-xs text-dim">Brak pomiarów</span>
                    )}
              </div>
            </div>
            <div>
              {canEdit && (
                <div className="grid gap-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input
                      readOnly
                      value={getMeasureDraft(item.materialId).qty}
                      placeholder="+ kg"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-form-type="other"
                      onFocus={unlockInput}
                      onChange={(event) => updateMeasureDraft(item.materialId, { qty: event.target.value })}
                      onBlur={relockInput}
                    />
                    <Button
                      onClick={() => handleAddMeasure(item)}
                      disabled={!getMeasureDraft(item.materialId).qty || addMeasureMutation.isPending}
                      className={`${glowClass} h-12 min-h-12 rounded-lg px-3 text-sm`}
                    >
                      Dodaj
                    </Button>
                  </div>
                  <Input
                    readOnly
                    value={getMeasureDraft(item.materialId).comment}
                    placeholder="Miejsce/uwaga"
                    type="text"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="sentences"
                    spellCheck={false}
                    enterKeyHint="done"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    data-form-type="other"
                    onFocus={unlockInput}
                    onChange={(event) => updateMeasureDraft(item.materialId, { comment: event.target.value })}
                    onBlur={relockInput}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}



