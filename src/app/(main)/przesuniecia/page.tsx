'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocationOption, TransferKind } from '@/lib/api/types';
import {
  addTransfer,
  getCatalog,
  getLocations,
  getMaterialLocations,
  getTodayKey,
  getTransfers
} from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToastStore } from '@/components/ui/Toast';
import { formatKg, parseQtyInput } from '@/lib/utils/format';

type TransferForm = {
  kind: TransferKind;
  material: string;
  qty: string;
  fromLocation: string;
  toLocation: string;
  partner: string;
  note: string;
};

const initialForm: TransferForm = {
  kind: 'INTERNAL',
  material: '',
  qty: '',
  fromLocation: '',
  toLocation: '',
  partner: '',
  note: ''
};

const kindConfig: Record<TransferKind, { label: string; tone: 'info' | 'success' | 'warning' }> = {
  INTERNAL: { label: 'Wewnętrzne', tone: 'info' },
  EXTERNAL_IN: { label: 'Przyjęcie zewnętrzne', tone: 'success' },
  EXTERNAL_OUT: { label: 'Wydanie zewnętrzne', tone: 'warning' }
};
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const materialLabel = (name: string, code: string) => `${name} (${code.trim()})`;
const locationLabel = (warehouse: string, name: string) => `${warehouse} - ${name}`;

export default function TransfersPage() {
  const today = getTodayKey();
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TransferForm>(initialForm);
  const [selectedToWarehouseId, setSelectedToWarehouseId] = useState<string | null>(null);
  const [showMaterialSuggestions, setShowMaterialSuggestions] = useState(false);
  const [showFromSuggestions, setShowFromSuggestions] = useState(false);
  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';

  const { data: catalog = [] } = useQuery({
    queryKey: ['catalog'],
    queryFn: getCatalog
  });
  const { data: materialLocations = {} } = useQuery({
    queryKey: ['material-locations', today],
    queryFn: getMaterialLocations
  });
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations
  });
  const { data: transfers = [], isLoading: transfersLoading } = useQuery({
    queryKey: ['transfers'],
    queryFn: () => getTransfers()
  });


  const resolveMaterial = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    return (
      catalog.find((item) => item.name.toLowerCase() === normalized) ||
      catalog.find((item) => item.code.toLowerCase() === normalized) ||
      catalog.find((item) => materialLabel(item.name, item.code).toLowerCase() === normalized) ||
      null
    );
  };

  const resolveLocation = (value: string, list: typeof locations) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    const byLabel = list.find(
      (item) => locationLabel(item.warehouseName, item.name).toLowerCase() === normalized
    );
    if (byLabel) return byLabel;
    const byId = list.find((item) => item.id.toLowerCase() === normalized);
    if (byId) return byId;
    const byName = list.filter((item) => item.name.toLowerCase() === normalized);
    if (byName.length === 1) return byName[0];
    return null;
  };

  const mutation = useMutation({
    mutationFn: addTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({ queryKey: ['material-locations'] });
      queryClient.invalidateQueries({ queryKey: ['material-totals'] });
      setForm(initialForm);
      toast({ title: 'Zapisano przesunięcie.', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        MATERIAL_MISSING: 'Wybierz poprawny przemiał z listy.',
        INVALID_QTY: 'Podaj ilość większą od zera.',
        MISSING_LOCATIONS: 'Wybierz lokację źródłową i docelową.',
        SAME_LOCATION: 'Lokacje źródłowa i docelowa nie mogą być takie same.',
        MISSING_LOCATION: 'Wybierz lokację dla przesunięcia.',
        INSUFFICIENT_STOCK: 'Brak wystarczającego stanu w lokacji źródłowej.'
      };
      toast({
        title: 'Nie zapisano przesunięcia.',
        description: messageMap[err.message] ?? 'Sprawdź dane i spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const handleKindChange = (value: TransferKind) => {
    setForm((prev) => ({
      ...prev,
      kind: value,
      fromLocation: value === 'EXTERNAL_IN' ? '' : prev.fromLocation,
      toLocation: value === 'EXTERNAL_OUT' ? '' : prev.toLocation
    }));
  };

  const handleLocationBlur = (
    value: string,
    field: 'fromLocation' | 'toLocation',
    list: typeof locations
  ) => {
    const normalized = value.trim();
    if (!normalized) return;
    const resolved = resolveLocation(normalized, list);
    if (!resolved) {
      toast({ title: 'Wybierz lokację z listy', tone: 'error' });
      setForm((prev) => ({ ...prev, [field]: '' }));
      return;
    }
    const label = locationLabel(resolved.warehouseName, resolved.name);
    if (label !== value) {
      setForm((prev) => ({ ...prev, [field]: label }));
    }
  };

  const handleMaterialBlur = (value: string) => {
    const normalized = value.trim();
    if (!normalized) return;
    const resolved = resolveMaterial(normalized);
    if (!resolved) return;
    const label = materialLabel(resolved.name, resolved.code);
    if (label !== value) {
      setForm((prev) => ({ ...prev, material: label }));
    }
  };

  const selectedMaterial = resolveMaterial(form.material);
  const filteredLocations = useMemo(() => {
    if (!selectedMaterial) return locations;
    const allowed = new Set(
      (materialLocations[selectedMaterial.id] ?? []).map((item) => item.locationId)
    );
    return locations.filter((item) => allowed.has(item.id));
  }, [locations, materialLocations, selectedMaterial]);
  const locationQtyMap = useMemo(() => {
    if (!selectedMaterial) return new Map<string, number>();
    return new Map(
      (materialLocations[selectedMaterial.id] ?? []).map((item) => [item.locationId, item.qty])
    );
  }, [materialLocations, selectedMaterial]);
  const fromLocationResolved = resolveLocation(form.fromLocation, filteredLocations);
  const fromLocationQty = fromLocationResolved ? locationQtyMap.get(fromLocationResolved.id) : null;
  const catalogOptions = useMemo(() => {
    const list = [...catalog];
    list.sort((a, b) => {
      const nameCompare = collator.compare(a.name, b.name);
      if (nameCompare !== 0) return nameCompare;
      return collator.compare(a.code.trim(), b.code.trim());
    });
    return list;
  }, [catalog]);
  const filteredLocationOptions = useMemo(() => {
    const list = [...filteredLocations];
    list.sort((a, b) => {
      const warehouseCompare = collator.compare(a.warehouseName, b.warehouseName);
      if (warehouseCompare !== 0) return warehouseCompare;
      return collator.compare(a.name, b.name);
    });
    return list;
  }, [filteredLocations]);
  const fromLocationSuggestions = useMemo(() => {
    const needle = form.fromLocation.trim().toLowerCase();
    if (!needle) return filteredLocationOptions;
    return filteredLocationOptions.filter((item) =>
      locationLabel(item.warehouseName, item.name).toLowerCase().includes(needle)
    );
  }, [filteredLocationOptions, form.fromLocation]);
  const materialSuggestions = useMemo(() => {
    const needle = form.material.trim().toLowerCase();
    if (!needle) return catalogOptions;
    return catalogOptions.filter((item) => {
      const name = item.name.toLowerCase();
      const code = item.code.toLowerCase();
      return (
        name.includes(needle) ||
        code.includes(needle) ||
        materialLabel(item.name, item.code).toLowerCase().includes(needle)
      );
    });
  }, [catalogOptions, form.material]);
  const warehouseGroups = useMemo(() => {
    const groups: Array<{ id: string; name: string; locations: LocationOption[] }> = [];
    const index = new Map<string, number>();
    locations.forEach((loc) => {
      const position = index.get(loc.warehouseId);
      if (position === undefined) {
        index.set(loc.warehouseId, groups.length);
        groups.push({ id: loc.warehouseId, name: loc.warehouseName, locations: [loc] });
        return;
      }
      groups[position].locations.push(loc);
    });
    return groups;
  }, [locations]);
  const activeToWarehouseId = selectedToWarehouseId;
  const activeToGroup = useMemo(
    () => warehouseGroups.find((group) => group.id === activeToWarehouseId) ?? null,
    [warehouseGroups, activeToWarehouseId]
  );
  const toWarehouseWtr = useMemo(
    () => activeToGroup?.locations.filter((item) => item.type === 'wtr') ?? [],
    [activeToGroup]
  );
  const toWarehousePole = useMemo(
    () => activeToGroup?.locations.filter((item) => item.type === 'pole') ?? [],
    [activeToGroup]
  );

  const handleSelectToWarehouse = (warehouseId: string) => {
    setSelectedToWarehouseId(warehouseId);
    if (form.toLocation) {
      const resolved = resolveLocation(form.toLocation, locations);
      if (!resolved || resolved.warehouseId !== warehouseId) {
        setForm((prev) => ({ ...prev, toLocation: '' }));
      }
    }
  };

  const handleSelectToLocation = (location: LocationOption) => {
    setSelectedToWarehouseId(location.warehouseId);
    setForm((prev) => ({
      ...prev,
      toLocation: locationLabel(location.warehouseName, location.name)
    }));
  };

  const handleAdd = () => {
    const qtyValue = parseQtyInput(form.qty);
    if (!qtyValue || qtyValue <= 0) {
      toast({ title: 'Podaj ilość', description: 'Wpisz ilość większą od zera.', tone: 'error' });
      return;
    }
    const material = resolveMaterial(form.material);
    if (!material) {
      toast({ title: 'Brak przemiału', description: 'Wybierz przemiał z listy.', tone: 'error' });
      return;
    }

    const fromLocation =
      form.kind === 'EXTERNAL_IN' ? null : resolveLocation(form.fromLocation, filteredLocations);
    const toLocation =
      form.kind === 'EXTERNAL_OUT' ? null : resolveLocation(form.toLocation, locations);

    if (form.kind === 'INTERNAL') {
      if (!fromLocation || !toLocation) {
        toast({
          title: 'Uzupełnij lokacje',
          description: 'Wybierz lokację źródłową i docelową.',
          tone: 'error'
        });
        return;
      }
      if (fromLocation.id === toLocation.id) {
        toast({
          title: 'Niepoprawne lokacje',
          description: 'Lokacje źródłowa i docelowa muszą się różnić.',
          tone: 'error'
        });
        return;
      }
    }

    if (form.kind === 'EXTERNAL_IN' && !toLocation) {
      toast({ title: 'Wybierz lokację docelową', tone: 'error' });
      return;
    }

    if (form.kind === 'EXTERNAL_OUT' && !fromLocation) {
      toast({ title: 'Wybierz lokację źródłową', tone: 'error' });
      return;
    }

    mutation.mutate({
      kind: form.kind,
      materialId: material.id,
      qty: qtyValue,
      fromLocationId: fromLocation?.id,
      toLocationId: toLocation?.id,
      partner: form.partner.trim() || undefined,
      note: form.note.trim() || undefined
    });
  };

  const transferRows = useMemo(() => {
    const materialMap = new Map(catalog.map((item) => [item.id, item]));
    const locationMap = new Map(locations.map((item) => [item.id, item]));
    const formatDateTime = (value: string) =>
      new Intl.DateTimeFormat('pl-PL', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(value));

    return transfers.map((transfer) => {
      const material = materialMap.get(transfer.materialId);
      const kindMeta = kindConfig[transfer.kind];
      const fromLabel =
        transfer.kind === 'EXTERNAL_IN'
          ? 'Z zewnatrz'
          : transfer.fromLocationId
          ? locationLabel(
              locationMap.get(transfer.fromLocationId)?.warehouseName ?? 'Nieznany magazyn',
              locationMap.get(transfer.fromLocationId)?.name ?? 'Nieznana lokacja'
            )
          : '-';
      const toLabel =
        transfer.kind === 'EXTERNAL_OUT'
          ? 'Na zewnatrz'
          : transfer.toLocationId
          ? locationLabel(
              locationMap.get(transfer.toLocationId)?.warehouseName ?? 'Nieznany magazyn',
              locationMap.get(transfer.toLocationId)?.name ?? 'Nieznana lokacja'
            )
          : '-';
      const noteParts = [transfer.partner && `Kontrahent: ${transfer.partner}`, transfer.note]
        .filter(Boolean)
        .join(' | ');

      return [
        formatDateTime(transfer.at),
        <Badge key={`${transfer.id}-type`} tone={kindMeta.tone}>
          {kindMeta.label}
        </Badge>,
        material ? (
          <span style={{ color: 'var(--value-purple)' }}>{material.name}</span>
        ) : (
          'Nieznany przemiał'
        ),
        <span key={`${transfer.id}-qty`} className="font-semibold tabular-nums">
          {formatKg(transfer.qty)}
        </span>,
        fromLabel,
        toLabel,
        noteParts || '-'
      ];
    });
  }, [catalog, locations, transfers]);

  return (
    <div className="space-y-6">
      <PageHeader title="Przesunięcia przemiałowe" subtitle={`Dziś: ${today}`} />

      <Card className="border-[rgba(255,106,0,0.35)] bg-brandSoft">
        <p className="text-sm text-body">
          Przesunięcia służą do rejestrowania transferów między lokacjami oraz wydań i przyjęć
          zewnętrznych. Nie wpływają na podsumowanie &quot;Przybyło/Wyrobiono&quot;.
        </p>
      </Card>

      <Card className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-dim">Nowe przesunięcie</p>

        <div className="flex flex-wrap gap-2">
          {(['INTERNAL', 'EXTERNAL_IN', 'EXTERNAL_OUT'] as TransferKind[]).map((kind) => (
            <Button
              key={kind}
              variant="secondary"
              className={
                form.kind === kind
                  ? `${glowClass} border-[rgba(255,106,0,0.55)] bg-brandSoft text-title`
                  : ''
              }
              onClick={() => handleKindChange(kind)}
            >
              {kindConfig[kind].label}
            </Button>
          ))}
        </div>

        <div className="grid gap-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-dim">Przemiał</label>
            <div className="relative">
              <Input
                value={form.material}
                onChange={(event) => {
                  setForm((prev) => ({ ...prev, material: event.target.value }));
                  setShowMaterialSuggestions(true);
                }}
                onFocus={() => setShowMaterialSuggestions(true)}
                onBlur={(event) => {
                  handleMaterialBlur(event.target.value);
                  setTimeout(() => setShowMaterialSuggestions(false), 120);
                }}
                placeholder="np. ABS 9203"
                className={form.material ? 'pr-10' : undefined}
              />
              {form.material && (
                <button
                  type="button"
                  aria-label="Wyczyść pole przemiału"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface2 px-2 py-1 text-xs font-semibold text-dim transition hover:border-borderStrong hover:text-title"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setForm((prev) => ({ ...prev, material: '' }));
                    setShowMaterialSuggestions(false);
                  }}
                >
                  X
                </button>
              )}
              {showMaterialSuggestions && materialSuggestions.length > 0 && (
                <div className="absolute z-20 mt-2 w-full max-h-72 overflow-y-auto rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                  {materialSuggestions.map((item) => {
                    const label = materialLabel(item.name, item.code);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setForm((prev) => ({ ...prev, material: label }));
                          setShowMaterialSuggestions(false);
                        }}
                        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                      >
                        <span className="font-semibold" style={{ color: 'var(--value-purple)' }}>
                          {item.name}
                        </span>
                        <span className="text-xs font-semibold text-dim">
                          {item.code.trim() || 'Brak kartoteki'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          {form.kind !== 'EXTERNAL_IN' && (
            <div>
              <label className="text-xs uppercase tracking-wide text-dim">Z lokacji</label>
              <div className="relative">
                <Input
                  value={form.fromLocation}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, fromLocation: event.target.value }));
                    setShowFromSuggestions(true);
                  }}
                  onFocus={() => setShowFromSuggestions(true)}
                  onBlur={(event) => {
                    handleLocationBlur(event.target.value, 'fromLocation', filteredLocations);
                    setTimeout(() => setShowFromSuggestions(false), 120);
                  }}
                  placeholder="Hala 1 - WTR 1"
                  className={form.fromLocation ? 'pr-10' : undefined}
                />
                {form.fromLocation && (
                  <button
                    type="button"
                    aria-label="Wyczyść pole lokacji"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface2 px-2 py-1 text-xs font-semibold text-dim transition hover:border-borderStrong hover:text-title"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setForm((prev) => ({ ...prev, fromLocation: '' }));
                      setShowFromSuggestions(false);
                    }}
                  >
                    X
                  </button>
                )}

                {showFromSuggestions && fromLocationSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-2 w-full rounded-xl border border-border bg-[var(--bg-0)] shadow-[0_12px_30px_rgba(0,0,0,0.35)]">
                    {fromLocationSuggestions.map((location) => {
                      const label = locationLabel(location.warehouseName, location.name);
                      const qty = locationQtyMap.get(location.id);
                      return (
                        <button
                          key={location.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setForm((prev) => ({ ...prev, fromLocation: label }));
                            setShowFromSuggestions(false);
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-body transition hover:bg-[rgba(255,255,255,0.06)]"
                        >
                          <span>{label}</span>
                          {typeof qty === 'number' && (
                            <span className="text-xs font-semibold text-dim">
                              {formatKg(qty)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {typeof fromLocationQty === 'number' && (
                <p className="mt-2 text-xs text-dim">
                  Stan w lokacji:{' '}
                  <span className="font-semibold text-title">{formatKg(fromLocationQty)}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-dim">Ilość (kg)</label>
            <Input
              value={form.qty}
              onChange={(event) => setForm((prev) => ({ ...prev, qty: event.target.value }))}
              placeholder="0"
              inputMode="decimal"
            />
          </div>
          {form.kind !== 'EXTERNAL_OUT' && (
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-dim">Do lokacji</label>
              <Input value={form.toLocation} readOnly placeholder="Wybierz magazyn i lokacje" />
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  {warehouseGroups.map((group) => {
                    const active = selectedToWarehouseId === group.id;
                    return (
                      <Button
                        key={group.id}
                        variant="secondary"
                        className={
                          active
                            ? `${glowClass} w-full border-[rgba(255,106,0,0.55)] bg-brandSoft text-title`
                            : 'w-full'
                        }
                        onClick={() => handleSelectToWarehouse(group.id)}
                      >
                        {group.name}
                      </Button>
                    );
                  })}
                </div>

                {!activeToGroup && (
                  <p className="text-sm text-dim">Najpierw wybierz magazyn.</p>
                )}

                {activeToGroup && (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-border bg-surface2 px-4 py-3 shadow-[inset_0_1px_0_var(--inner-highlight)]">
                      <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                        Wtryskarki
                      </p>
                      {toWarehouseWtr.length === 0 ? (
                        <p className="mt-2 text-sm text-dim">Brak lokacji WTR.</p>
                      ) : (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {toWarehouseWtr.map((location) => {
                            const label = locationLabel(location.warehouseName, location.name);
                            const isSelected = form.toLocation === label;
                            return (
                              <button
                                key={location.id}
                                type="button"
                                onClick={() => handleSelectToLocation(location)}
                                className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                                  isSelected
                                    ? 'border-[rgba(255,106,0,0.55)] bg-brandSoft text-title shadow-[0_0_0_1px_rgba(255,106,0,0.25)]'
                                    : 'border-border bg-surface text-body hover:border-borderStrong hover:bg-[rgba(255,255,255,0.04)]'
                                }`}
                              >
                                {location.name}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {toWarehousePole.length > 0 && (
                      <div className="rounded-2xl border border-border bg-surface2 px-4 py-3 shadow-[inset_0_1px_0_var(--inner-highlight)]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                          Pole odkladcze
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {toWarehousePole.map((location) => {
                            const label = locationLabel(location.warehouseName, location.name);
                            const isSelected = form.toLocation === label;
                            return (
                              <button
                                key={location.id}
                                type="button"
                                onClick={() => handleSelectToLocation(location)}
                                className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                                  isSelected
                                    ? 'border-[rgba(255,106,0,0.55)] bg-brandSoft text-title shadow-[0_0_0_1px_rgba(255,106,0,0.25)]'
                                    : 'border-border bg-surface text-body hover:border-borderStrong hover:bg-[rgba(255,255,255,0.04)]'
                                }`}
                              >
                                {location.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {form.kind !== 'INTERNAL' && (
          <div>
            <label className="text-xs uppercase tracking-wide text-dim">Kontrahent (opcjonalnie)</label>
            <Input
              value={form.partner}
              onChange={(event) => setForm((prev) => ({ ...prev, partner: event.target.value }))}
              placeholder="np. Dostawca X"
            />
          </div>
        )}

        <div>
          <label className="text-xs uppercase tracking-wide text-dim">Uwagi</label>
          <Input
            value={form.note}
            onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
            placeholder="Opcjonalnie"
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => setForm(initialForm)}
            className={glowClass}
            disabled={mutation.isPending}
          >
            Wyczyść
          </Button>
          <Button onClick={handleAdd} disabled={mutation.isPending}>
            Zapisz przesunięcie
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Historia przesuniec</p>
          <p className="text-sm text-dim">Liczba wpisów: {transfers.length}</p>
        </div>
        {transfersLoading ? (
          <p className="text-sm text-dim">Ładowanie...</p>
        ) : transfers.length === 0 ? (
          <EmptyState
            title="Brak przesunięć"
            description="Dodaj pierwsze przesunięcie, aby śledzić transfery."
          />
        ) : (
          <DataTable
            columns={['Data', 'Typ', 'Przemiał', 'Ilość', 'Skąd', 'Dokąd', 'Uwagi']}
            rows={transferRows}
          />
        )}
      </Card>
    </div>
  );
}



