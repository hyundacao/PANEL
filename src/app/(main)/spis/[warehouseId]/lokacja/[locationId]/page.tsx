'use client';

import type { FocusEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addInventoryMeasure,
  addMaterial,
  deleteInventoryMeasure,
  getCatalog,
  getLocationDetail,
  getTodayKey,
  getWarehouses,
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
import { getRegrindStockWrite } from '@/lib/utils/regrindStockInput';
import { Check, ChevronRight, PackagePlus, Search, X } from 'lucide-react';

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

const getNoChangeStorageKey = (dateKey: string, locationId: string) =>
  `spis-przemialow:no-change:${dateKey}:${locationId}`;

const readNoChangeMaterialIds = (storageKey: string) => {
  if (typeof window === 'undefined') return new Set<string>();
  try {
    const stored = window.localStorage.getItem(storageKey);
    const materialIds = stored ? JSON.parse(stored) : [];
    return new Set<string>(Array.isArray(materialIds) ? materialIds.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set<string>();
  }
};

export default function LocationDetailPage() {
  const params = useParams();
  const warehouseId = params.warehouseId as string;
  const locationId = params.locationId as string;
  const [today, setToday] = useState(() => getTodayKey());
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });
  const warehouse = warehouses?.find((item) => item.id === warehouseId);
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
  const noChangeStorageKey = getNoChangeStorageKey(today, locationId);
  const [noChangeState, setNoChangeState] = useState<{ scope: string; materialIds: Set<string> }>(() => ({
    scope: noChangeStorageKey,
    materialIds: readNoChangeMaterialIds(noChangeStorageKey)
  }));
  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';
  const noChangeMaterialIds = noChangeState.scope === noChangeStorageKey
    ? noChangeState.materialIds
    : readNoChangeMaterialIds(noChangeStorageKey);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setToday((current) => {
        const next = getTodayKey();
        return current === next ? current : next;
      });
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

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
    queryClient.invalidateQueries({ queryKey: ['dashboard-month-stats'] });
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['report-period-overall'] });
    queryClient.invalidateQueries({ queryKey: ['report-yearly-overall'] });
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
        setMeasureDrafts((prev) => ({ ...prev, [variables.materialId]: { qty: '', comment: '' } }));
        setEditingMeasurementId(null);
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

  const visibleItems = useMemo(() => {
    const query = inventoryQuery.trim().toLowerCase();
    const items = (detail ?? []).filter(
      (item) => !query || `${item.name} ${item.code}`.toLowerCase().includes(query)
    );
    const filtered = showZero
      ? items
      : items.filter((item) => (item.todayQty ?? item.yesterdayQty) !== 0);
    return [...filtered].sort((a, b) => {
      const skipOrder = Number(noChangeMaterialIds.has(a.materialId)) - Number(noChangeMaterialIds.has(b.materialId));
      return skipOrder !== 0 ? skipOrder : collator.compare(a.name, b.name);
    });
  }, [detail, inventoryQuery, noChangeMaterialIds, showZero]);

  const toggleNoChangeToday = (materialId: string) => {
    if (!canEdit) return;
    const currentIds = noChangeState.scope === noChangeStorageKey
      ? noChangeState.materialIds
      : readNoChangeMaterialIds(noChangeStorageKey);
    const materialIds = new Set(currentIds);
    const wasSkipped = materialIds.has(materialId);
    if (wasSkipped) materialIds.delete(materialId);
    else materialIds.add(materialId);
    try {
      window.localStorage.setItem(noChangeStorageKey, JSON.stringify([...materialIds]));
    } catch {
      // The marker remains available for this open view when browser storage is unavailable.
    }
    setNoChangeState({ scope: noChangeStorageKey, materialIds });
    toast({
      title: wasSkipped ? 'Przywrócono pozycję do spisu' : 'Oznaczono: bez zmian dziś',
      description: wasSkipped ? undefined : 'Pozycja została przeniesiona na dół listy.',
      tone: 'success'
    });
  };

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

  const handleAddMeasure = async (item: { materialId: string; todayQty: number | null }) => {
    const draft = getMeasureDraft(item.materialId);
    const write = getRegrindStockWrite(draft.qty);
    if (!write) {
      toast({ title: 'Nieprawidłowa ilość', description: 'Wpisz poprawną ilość w kg: zero lub więcej.', tone: 'error' });
      return;
    }
    const payload = {
      locationId,
      materialId: item.materialId,
      qty: write.qty,
      comment: draft.comment
    };
    if (write.action === 'upsertEntry') {
      if ((item.todayQty ?? 0) > 0 && !window.confirm(
        `Ustawić dzisiejszy stan tej pozycji na 0 kg? Zastąpi to dotychczasowe dzisiejsze pomiary (${formatKg(item.todayQty ?? 0)}).`
      )) return;
      await mutation.mutateAsync(payload);
      return;
    }
    await addMeasureMutation.mutateAsync(payload);
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
    if (!query) return [];
    return catalogList.filter(
      (item) =>
        item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)
    ).slice(0, 8);
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
  return (
    <div className="min-w-0 space-y-4 pb-8 sm:space-y-6">
      <PageHeader
        title={`Spis magazynu: ${warehouse?.name ?? 'Magazyn'}`}
        subtitle={`Stan na dzień ${today}`}
        titleColor="var(--brand)"
        className="relative [&>div:first-child]:text-center [&>div:first-child>h2]:text-2xl sm:!block sm:min-h-12 sm:[&>div:first-child>h2]:text-3xl sm:[&>div:last-child]:absolute sm:[&>div:last-child]:right-0 sm:[&>div:last-child]:top-1/2 sm:[&>div:last-child]:-translate-y-1/2"
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
            {dialogOpen && typeof document !== 'undefined' && createPortal(
              <div
                className="fixed inset-0 z-50 flex items-start justify-center sm:px-4 sm:py-6"
                style={{ position: 'fixed', inset: 0 }}
              >
                <div className="absolute inset-0 bg-[var(--scrim)]" onClick={closeDialog} />
                <div className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden border border-border bg-[var(--surface-1)] shadow-[inset_0_1px_0_var(--inner-highlight)] sm:h-[calc(100dvh-3rem)] sm:max-w-2xl sm:rounded-2xl">
                  <div className="relative shrink-0 border-b border-border px-12 py-5 sm:px-16 sm:py-6">
                    <div className="min-w-0 text-center">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand)]">Dodaj nowy przemiał</p>
                      <h3 className="mt-1 text-xl font-bold text-title sm:text-2xl">Wpis do magazynu</h3>
                    </div>
                    <button
                      type="button"
                      onClick={closeDialog}
                      className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-2 text-dim transition hover:bg-[var(--surface-3)] hover:text-title sm:right-6"
                      aria-label="Zamknij"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                    <div className="space-y-4 pb-4">
                  <div className="mx-auto grid w-full max-w-md grid-cols-2 rounded-xl border border-borderStrong bg-[var(--surface-2)] p-1">
                    <Button
                      variant="secondary"
                      className={`min-h-11 w-full rounded-lg border-transparent bg-transparent px-3 text-sm shadow-none ring-0 hover:border-transparent hover:bg-[var(--surface-3)] ${!form.manualMode ? '!border-[rgba(255,122,26,0.75)] !bg-[linear-gradient(180deg,#FF9F52_0%,#E85F00_100%)] !text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_16px_-12px_rgba(255,106,0,0.9)]' : 'text-muted'}`}
                      onClick={() => setForm((prev) => ({ ...prev, manualMode: false }))}
                    >
                      Wybierz z listy
                    </Button>
                    <Button
                      variant="secondary"
                      className={`min-h-11 w-full rounded-lg border-transparent bg-transparent px-3 text-sm shadow-none ring-0 hover:border-transparent hover:bg-[var(--surface-3)] ${form.manualMode ? '!border-[rgba(255,122,26,0.75)] !bg-[linear-gradient(180deg,#FF9F52_0%,#E85F00_100%)] !text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_6px_16px_-12px_rgba(255,106,0,0.9)]' : 'text-muted'}`}
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
                      {catalogQuery.trim() && (
                        <div className="-mt-1 overflow-hidden rounded-xl border border-borderStrong bg-[var(--surface-2)] shadow-[0_14px_28px_-22px_rgba(0,0,0,0.95)]" aria-label="Podpowiedzi materiałów">
                          <div className="border-b border-border bg-[var(--surface-1)] px-3 py-2">
                            <p className="text-xs font-semibold text-title">Wybierz przemiał z listy</p>
                            <p className="text-[11px] text-dim">Kliknij cały wiersz, aby przejść do wpisania ilości.</p>
                          </div>
                          {filteredCatalog.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setForm((prev) => ({ ...prev, materialId: item.id }));
                                setCatalogQuery('');
                              }}
                              className={`flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition last:border-b-0 active:bg-brandSoft ${
                                form.materialId === item.id
                                  ? 'relative overflow-hidden bg-brandSoft text-body'
                                  : 'bg-[var(--surface-2)] text-muted hover:bg-[var(--surface-3)] hover:text-title'
                              }`}
                            >
                              {form.materialId === item.id && (
                                <span className="absolute left-0 top-0 h-full w-[3px] bg-brand" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="material-label block text-sm font-semibold">
                                  {item.name}
                                </span>
                                <span className="catalog-label mt-0.5 block text-xs font-medium">{item.code}</span>
                              </span>
                              <ChevronRight className="h-5 w-5 shrink-0 text-dim" aria-hidden="true" />
                            </button>
                          ))}
                          {filteredCatalog.length === 0 && (
                            <p className="px-3 py-3 text-sm text-muted">
                              Brak materiału pasującego do tej frazy.
                            </p>
                          )}
                        </div>
                      )}
                      {form.materialId && (
                        <div className="rounded-xl border border-[rgba(255,106,0,0.3)] bg-brandSoft p-3">
                          <div className="mb-3 min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">Wybrany przemiał</p>
                            <p className="mt-1 truncate text-sm font-semibold text-title">
                              {catalogList.find((item) => item.id === form.materialId)?.name}
                            </p>
                            <p className="catalog-label text-xs font-medium">
                              {catalogList.find((item) => item.id === form.materialId)?.code}
                            </p>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
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
                          <Button
                            onClick={handleAddToLocation}
                            className={`${glowClass} mt-3 min-h-12 w-full sm:w-auto`}
                          >
                            Dodaj do magazynu
                          </Button>
                        </div>
                      )}
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

                    </div>
                  </div>
                  <div className="flex shrink-0 justify-end border-t border-border bg-surface2 px-4 py-3 sm:px-6 sm:py-4">
                    <Button
                      variant="primaryEmber"
                      onClick={closeDialog}
                      className="min-h-12 w-full px-6 text-sm font-semibold !text-white sm:w-auto"
                    >
                      Anuluj
                    </Button>
                  </div>
              </div>
            </div>
            , document.body)}
          </>
        }
      />

      {isLoading && <Card>Ładowanie danych...</Card>}

      <section className="relative z-10 -mx-[17px] min-w-0 bg-[var(--bg-0)] px-[17px] md:mx-0 md:bg-transparent md:px-0">
        <div className="-mx-[17px] mb-4 rounded-b-xl border border-borderStrong bg-[var(--bg-0)] px-4 py-4 md:mx-0 md:rounded-xl">
          <div>
            <div className="min-w-0">
              <p className="text-base font-bold text-title">Lista przemiałów</p>
              <p className="mt-1 text-xs text-dim">Widoczne pozycje: {visibleItems.length}</p>
            </div>
          </div>
          <div className="mt-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
          </div>
        </div>
        {visibleItems.length > 0 && (
        <div className="hidden grid-cols-[minmax(220px,1.7fr)_110px_150px_minmax(240px,1.7fr)_240px] gap-3 px-3 text-xs font-bold uppercase tracking-wide text-dim md:grid">
          <span>Przemial</span>
          <span>Ostatni spis</span>
          <span>Suma dzisiejszego spisu</span>
          <span>Dzisiejszy spis</span>
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
              style={noChangeMaterialIds.has(item.materialId) ? { borderColor: '#4ade80' } : undefined}
              className={`min-w-0 space-y-4 overflow-hidden rounded-2xl border px-4 py-4 ${
                noChangeMaterialIds.has(item.materialId)
                  ? 'border-[rgba(74,222,128,0.95)] bg-[linear-gradient(135deg,rgba(22,163,74,0.52),rgba(6,78,59,0.96))] shadow-[0_14px_30px_-20px_rgba(34,197,94,0.95)]'
                  : 'border-borderStrong bg-[var(--surface-1)]'
              }`}
            >
              <div className="min-w-0 text-center">
                <p className={`${noChangeMaterialIds.has(item.materialId) ? 'text-white' : 'material-label'} break-words text-base font-bold leading-snug`}>
                  {item.name}
                </p>
                <p className={`${noChangeMaterialIds.has(item.materialId) ? 'text-emerald-100' : 'catalog-label'} mt-1 break-all text-xs font-medium`}>{item.code}</p>
                <button
                  type="button"
                  aria-label={`Bez zmian dziś: ${item.name}`}
                  aria-pressed={noChangeMaterialIds.has(item.materialId)}
                  disabled={!canEdit}
                  onClick={() => toggleNoChangeToday(item.materialId)}
                  className={`mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    noChangeMaterialIds.has(item.materialId)
                      ? 'border-white/80 bg-[rgba(0,0,0,0.22)] text-white'
                      : 'border-borderStrong bg-[var(--surface-2)] text-muted hover:border-[rgba(34,197,94,0.55)] hover:text-success'
                  }`}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Bez zmian dziś
                </button>
              </div>

              <div className="grid grid-cols-2 border-y border-borderStrong">
                <div className="min-w-0 border-r border-border px-3 py-3 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Ostatni spis
                  </p>
                  <p className="mt-1 truncate text-base font-bold text-body tabular-nums">{formatKg(item.yesterdayQty)}</p>
                </div>
                <div className="min-w-0 px-3 py-3 text-center">
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
                    <div className="mt-1 flex items-center justify-center gap-2">
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
                </div>
                <div className="col-span-2 min-w-0 border-t border-border px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Dzisiejszy spis
                  </p>
                  {item.measurements && item.measurements.length > 0 ? (
                    <div className="mt-2 divide-y divide-border">
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
                          <div
                            key={measurement.id}
                            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0 text-xs text-title"
                          >
                            <span className="font-bold">{index + 1}.</span>
                            <span className="font-bold tabular-nums">{formatKg(measurement.qty)}</span>
                            {measurement.comment && (
                              <span className="min-w-0 flex-1 truncate text-dim">{measurement.comment}</span>
                            )}
                            {canEdit && (
                              <span className="ml-auto inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditingMeasurement(measurement)}
                                  className="font-semibold text-[var(--brand)] underline underline-offset-2"
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
                              </span>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-dim">Brak dopisanych pomiarów.</p>
                  )}
                </div>
                <div className="col-span-2 min-w-0 border-t border-border px-3 py-3">
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
                        placeholder="Uwaga, np. do przeliczenia"
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
                        disabled={!getMeasureDraft(item.materialId).qty || addMeasureMutation.isPending || mutation.isPending}
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
            style={noChangeMaterialIds.has(item.materialId) ? { borderColor: '#4ade80' } : undefined}
            className={`mb-3 hidden grid-cols-[minmax(220px,1.7fr)_110px_150px_minmax(240px,1.7fr)_240px] items-center divide-x divide-border rounded-xl border py-4 last:mb-0 [&>div]:px-3 md:grid ${
              noChangeMaterialIds.has(item.materialId)
                ? 'border-[rgba(74,222,128,0.95)] bg-[linear-gradient(135deg,rgba(22,163,74,0.52),rgba(6,78,59,0.96))] shadow-[0_14px_30px_-20px_rgba(34,197,94,0.95)]'
                : 'border-borderStrong bg-[var(--surface-1)]'
            }`}
          >
            <div>
              <p className={`${noChangeMaterialIds.has(item.materialId) ? 'text-white' : 'material-label'} text-sm font-semibold`}>
                {item.name}
              </p>
              <p className={`${noChangeMaterialIds.has(item.materialId) ? 'text-emerald-100' : 'catalog-label'} text-xs font-medium`}>{item.code}</p>
              <button
                type="button"
                aria-label={`Bez zmian dziś: ${item.name}`}
                aria-pressed={noChangeMaterialIds.has(item.materialId)}
                disabled={!canEdit}
                onClick={() => toggleNoChangeToday(item.materialId)}
                className={`mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  noChangeMaterialIds.has(item.materialId)
                    ? 'border-white/80 bg-[rgba(0,0,0,0.22)] text-white'
                    : 'border-borderStrong bg-[var(--surface-2)] text-muted hover:border-[rgba(34,197,94,0.55)] hover:text-success'
                }`}
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Bez zmian dziś
              </button>
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
              <div className="divide-y divide-border">
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
                          <div
                            key={measurement.id}
                            className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0 text-[11px] text-title"
                          >
                            <span className="font-bold">{index + 1}.</span>
                            <span className="font-bold tabular-nums">{formatKg(measurement.qty)}</span>
                            {measurement.comment && (
                              <span className="min-w-0 flex-1 truncate text-dim">{measurement.comment}</span>
                            )}
                            {canEdit && (
                              <span className="ml-auto inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => startEditingMeasurement(measurement)}
                                  className="font-semibold text-[var(--brand)] underline underline-offset-2"
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
                              </span>
                            )}
                          </div>
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
                      disabled={!getMeasureDraft(item.materialId).qty || addMeasureMutation.isPending || mutation.isPending}
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
      </section>
    </div>
  );
}



