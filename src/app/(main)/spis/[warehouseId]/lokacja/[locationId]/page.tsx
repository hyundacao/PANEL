'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addMaterial,
  confirmNoChangeEntry,
  confirmNoChangeLocation,
  getCatalog,
  getLocations,
  getLocationDetail,
  getTodayKey,
  getWarehouses,
  removeMaterial,
  upsertEntry
} from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';
import { useToastStore } from '@/components/ui/Toast';
import { formatKg, parseQtyInput } from '@/lib/utils/format';

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MaterialFormState>(initialMaterialState);
  const [catalogQuery, setCatalogQuery] = useState('');
  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';

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
    const items = detail ?? [];
    if (showZero) return items;
    return items.filter((item) => !(item.confirmed && item.todayQty === 0));
  }, [detail, showZero]);

  const handleSave = (materialId: string, value: string) => {
    const qty = parseQtyInput(value);
    if (qty === null) return;
    mutation.mutate({ locationId, materialId, qty });
  };

  const handleCommentSave = (
    materialId: string,
    comment: string,
    todayQty: number | null,
    fallbackQty: number
  ) => {
    const qtyValue = typeof todayQty === 'number' ? todayQty : fallbackQty;
    const qty = parseQtyInput(String(qtyValue));
    if (qty === null) return;
    mutation.mutate({ locationId, materialId, qty, comment });
  };

  const handleNoChange = async (materialId: string) => {
    await confirmNoChangeEntry({ locationId, materialId });
    queryClient.invalidateQueries({ queryKey: ['location-detail', warehouseId, locationId, today] });
    invalidateDashboard();
    toast({ title: 'Ustawiono bez zmian', tone: 'success' });
  };

  const handleNoChangeLocation = async () => {
    await confirmNoChangeLocation(locationId);
    queryClient.invalidateQueries({ queryKey: ['location-detail', warehouseId, locationId, today] });
    queryClient.invalidateQueries({ queryKey: ['locations', warehouseId, today] });
    invalidateDashboard();
    toast({ title: 'Zatwierdzono lokację', tone: 'success' });
  };

  const catalogList = catalog ?? [];
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={location?.name ?? 'Lokacja'}
        subtitle={`${warehouse?.name ?? ''} | Dzień: ${today}`}
        titleColor="var(--location-blue)"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={handleNoChangeLocation}
              disabled={!canEdit}
              className={glowClass}
            >
              Bez zmian (lokacja)
            </Button>
            <Button disabled={!canEdit} onClick={() => setDialogOpen(true)} className={glowClass}>
              Dodaj przemiał
            </Button>
            {dialogOpen && (
              <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-6">
                <div className="absolute inset-0 bg-[var(--scrim)]" onClick={closeDialog} />
                <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-[var(--surface-1)] p-6 shadow-[inset_0_1px_0_var(--inner-highlight)] max-h-[98vh] min-h-[80vh] overflow-y-auto">
                  <button
                    type="button"
                    onClick={closeDialog}
                    className="absolute right-4 top-4 text-dim hover:text-title"
                    aria-label="Zamknij"
                  >
                    ×
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
                          onChange={(event) => setForm((prev) => ({ ...prev, qty: event.target.value }))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-wide text-dim">Komentarz</label>
                        <Input
                          value={form.comment}
                          onChange={(event) => setForm((prev) => ({ ...prev, comment: event.target.value }))}
                          placeholder="Opcjonalnie"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 border-t border-border bg-surface2 px-6 py-4 -mx-6 -mb-6 rounded-b-2xl">
                    <Button variant="outline" onClick={closeDialog} className={glowClass}>
                      Anuluj
                    </Button>
                    {!form.manualMode && (
                      <Button
                        variant="outline"
                        onClick={handleRemoveMaterial}
                        disabled={!form.materialId}
                        className="border-[rgba(170,24,24,0.65)] text-danger hover:bg-[color:color-mix(in_srgb,var(--danger)_14%,transparent)]"
                      >
                        Usun przemial
                      </Button>
                    )}
                    {!form.manualMode && (
                      <Button onClick={handleAddToLocation} disabled={!form.materialId}>
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

      {!hasTodayEntries && (
        <Card className="border-[rgba(255,106,0,0.55)] bg-brandSoft">
          <p className="text-sm text-body">
            Brak wpisu dziś. Pokazuję ostatni spis jako punkt odniesienia.
          </p>
        </Card>
      )}

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted">Status</p>
          <p className="text-lg font-semibold text-title">W trakcie</p>
        </div>
        <Toggle checked={showZero} onCheckedChange={setShowZero} label="Pokaż wyzerowane" />
      </Card>

      {isLoading && <Card>Ładowanie danych...</Card>}

      <Card className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Pozycje w lokacji</p>
        <div className="hidden grid-cols-8 gap-3 text-xs font-semibold text-dim md:grid">
          <span className="col-span-2">Przemiał</span>
          <span>Wczoraj</span>
          <span>Dziś</span>
          <span className="col-span-2">Komentarz</span>
          <span>Status</span>
          <span>Akcje</span>
        </div>
        <div className="space-y-3 md:hidden">
          {visibleItems.map((item) => (
            <div
              key={`mobile-${item.materialId}`}
              className="space-y-3 rounded-xl border border-border bg-surface2 p-3"
            >
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--value-purple)' }}>
                  {item.name}
                </p>
                <p className="text-xs text-dim">{item.code}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Wczoraj
                  </p>
                  <p className="text-sm text-body tabular-nums">{formatKg(item.yesterdayQty)}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Dzis
                  </p>
                  {!canEdit ? (
                    <p className="text-sm text-body">{item.todayQty ?? '-'} kg</p>
                  ) : (
                    <Input
                      defaultValue={item.todayQty ?? ''}
                      placeholder="0"
                      onBlur={(event) => handleSave(item.materialId, event.target.value)}
                    />
                  )}
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Komentarz
                  </p>
                  {!canEdit ? (
                    <p className="text-sm text-body">{item.comment ?? '-'}</p>
                  ) : (
                    <Input
                      defaultValue={item.comment ?? ''}
                      placeholder="Komentarz"
                      onBlur={(event) =>
                        handleCommentSave(
                          item.materialId,
                          event.target.value,
                          item.todayQty,
                          item.yesterdayQty
                        )
                      }
                    />
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-dim">
                    Status
                  </p>
                  <Badge tone={item.confirmed ? 'success' : 'warning'}>
                    {item.confirmed ? 'Zatwierdzone' : 'Do wpisania'}
                  </Badge>
                </div>
                {canEdit && (
                  <Button
                    variant="secondary"
                    onClick={() => handleNoChange(item.materialId)}
                    className={`${glowClass} w-full sm:w-auto`}
                  >
                    Bez zmian
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
        {visibleItems.map((item) => (
          <div
            key={item.materialId}
            className="hidden grid-cols-8 gap-3 rounded-xl border border-border bg-surface2 p-3 md:grid"
          >
            <div className="col-span-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--value-purple)' }}>
                {item.name}
              </p>
              <p className="text-xs text-dim">{item.code}</p>
            </div>
            <div className="text-sm text-body tabular-nums">{formatKg(item.yesterdayQty)}</div>
            <div>
              {!canEdit ? (
                <p className="text-sm text-body">{item.todayQty ?? '-'} kg</p>
              ) : (
                <Input
                  defaultValue={item.todayQty ?? ''}
                  placeholder="0"
                  onBlur={(event) => handleSave(item.materialId, event.target.value)}
                />
              )}
            </div>
            <div className="col-span-2">
              {!canEdit ? (
                <p className="text-sm text-body">{item.comment ?? '-'}</p>
              ) : (
                <Input
                  defaultValue={item.comment ?? ''}
                  placeholder="Komentarz"
                  onBlur={(event) =>
                    handleCommentSave(item.materialId, event.target.value, item.todayQty, item.yesterdayQty)
                  }
                />
              )}
            </div>
            <div>
              <Badge tone={item.confirmed ? 'success' : 'warning'}>
                {item.confirmed ? 'Zatwierdzone' : 'Do wpisania'}
              </Badge>
            </div>
            <div>
              {canEdit && (
                <Button variant="secondary" onClick={() => handleNoChange(item.materialId)} className={glowClass}>
                  Bez zmian
                </Button>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
