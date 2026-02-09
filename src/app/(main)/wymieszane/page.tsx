'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addMixedMaterial,
  getLocations,
  getMixedMaterials,
  deleteMixedMaterial,
  transferMixedMaterial
} from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { SelectField } from '@/components/ui/Select';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';
import { formatKg, parseQtyInput } from '@/lib/utils/format';
import type { MixedMaterial } from '@/lib/api/types';

const glowClass =
  'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';
const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const normalizeName = (value: string) => value.trim().toLowerCase();
const compareByName = (a: { name: string }, b: { name: string }) =>
  collator.compare(a.name, b.name);
const sortMixedMaterials = (list: MixedMaterial[]) =>
  list.sort((a, b) => {
    const nameCompare = collator.compare(a.name, b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.locationId.localeCompare(b.locationId);
  });
const MIXED_TAB_STORAGE_KEY = 'wymieszane-tab';

export default function MixedMaterialsPage() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'PRZEMIALY');
  const { data: mixedMaterials = [], isLoading } = useQuery({
    queryKey: ['mixed-materials'],
    queryFn: getMixedMaterials
  });
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations
  });

  const [addName, setAddName] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addWarehouseId, setAddWarehouseId] = useState('');
  const [addLocationId, setAddLocationId] = useState('');
  const [transferName, setTransferName] = useState('');
  const [transferFromWarehouseId, setTransferFromWarehouseId] = useState('');
  const [transferFromLocationId, setTransferFromLocationId] = useState('');
  const [transferToWarehouseId, setTransferToWarehouseId] = useState('');
  const [transferToLocationId, setTransferToLocationId] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MixedMaterial | null>(null);
  const [confirmReady, setConfirmReady] = useState(false);
  const [activeTab, setActiveTab] = useState<'add' | 'transfer'>(() => {
    if (typeof window === 'undefined') return 'add';
    const saved = window.localStorage.getItem(MIXED_TAB_STORAGE_KEY);
    return saved === 'add' || saved === 'transfer' ? saved : 'add';
  });

  const locationLabel = (warehouse: string, name: string) => `${warehouse} - ${name}`;
  const locationMap = useMemo(() => {
    const map = new Map<string, string>();
    locations.forEach((loc) => {
      map.set(loc.id, locationLabel(loc.warehouseName, loc.name));
    });
    return map;
  }, [locations]);
  const warehouseOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; name: string }> = [];
    locations.forEach((loc) => {
      if (seen.has(loc.warehouseId)) return;
      seen.add(loc.warehouseId);
      list.push({ id: loc.warehouseId, name: loc.warehouseName });
    });
    return list.sort(compareByName);
  }, [locations]);
  const nameOptions = useMemo(() => {
    const unique = new Set(mixedMaterials.map((item) => item.name));
    return [...unique].sort((a, b) => a.localeCompare(b, 'pl', { sensitivity: 'base' }));
  }, [mixedMaterials]);
  const transferSourceLocationIds = useMemo(() => {
    const name = normalizeName(transferName);
    if (!name) return new Set<string>();
    return new Set(
      mixedMaterials
        .filter((item) => normalizeName(item.name) === name)
        .map((item) => item.locationId)
    );
  }, [mixedMaterials, transferName]);
  const transferSourceLocations = useMemo(
    () => locations.filter((loc) => transferSourceLocationIds.has(loc.id)),
    [locations, transferSourceLocationIds]
  );
  const transferSourceWarehouseOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ id: string; name: string }> = [];
    transferSourceLocations.forEach((loc) => {
      if (seen.has(loc.warehouseId)) return;
      seen.add(loc.warehouseId);
      list.push({ id: loc.warehouseId, name: loc.warehouseName });
    });
    return list.sort(compareByName);
  }, [transferSourceLocations]);
  const totalQty = useMemo(
    () => mixedMaterials.reduce((sum, item) => sum + item.qty, 0),
    [mixedMaterials]
  );
  const selectedItem = selectedId
    ? mixedMaterials.find((item) => item.id === selectedId) ?? null
    : null;

  const getLocationsForWarehouse = (warehouseId: string) =>
    locations.filter((loc) => loc.warehouseId === warehouseId).sort(compareByName);
  const getTransferSourceLocationsForWarehouse = (warehouseId: string) =>
    transferSourceLocations
      .filter((loc) => loc.warehouseId === warehouseId)
      .sort(compareByName);

  const addMutation = useMutation({
    mutationFn: addMixedMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mixed-materials'] });
      setAddName('');
      setAddQty('');
      setAddWarehouseId('');
      setAddLocationId('');
      toast({ title: 'Dodano mieszankę', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwę mieszanki.',
        LOCATION_REQUIRED: 'Wybierz lokalizację.',
        LOCATION_UNKNOWN: 'Wybierz poprawną lokalizację z listy.',
        INVALID_QTY: 'Wpisz ilość większą od zera.'
      };
      toast({
        title: 'Nie dodano mieszanki',
        description: messageMap[err.message] ?? 'Sprawdź dane i spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMixedMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mixed-materials'] });
      setSelectedId(null);
      setConfirmReady(false);
      setDeleteTarget(null);
      toast({ title: 'Usunięto pozycję', tone: 'success' });
    },
    onError: () => {
      toast({
        title: 'Nie usunięto pozycji',
        description: 'Spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MIXED_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (selectedId && !mixedMaterials.some((item) => item.id === selectedId)) {
      const timer = setTimeout(() => setSelectedId(null), 0);
      return () => clearTimeout(timer);
    }
  }, [mixedMaterials, selectedId]);

  useEffect(() => {
    if (!deleteTarget) return;
    const timer = setTimeout(() => setConfirmReady(true), 180);
    return () => clearTimeout(timer);
  }, [deleteTarget]);

  const handleOpenDelete = () => {
    if (readOnly) {
      toast({ title: 'Brak uprawnien do edycji', tone: 'error' });
      return;
    }
    const target = selectedId
      ? mixedMaterials.find((item) => item.id === selectedId) ?? null
      : null;
    if (!target) {
      toast({ title: 'Zaznacz pozycję do usunięcia', tone: 'error' });
      return;
    }
    setConfirmReady(false);
    setDeleteTarget(target);
  };

  const transferMutation = useMutation({
    mutationFn: transferMixedMaterial,
    onSuccess: (data) => {
      queryClient.setQueryData<MixedMaterial[]>(['mixed-materials'], (current = []) => {
        const next = current.filter(
          (item) => item.id !== data.from.id && item.id !== data.to.id
        );
        if (data.from.qty > 0) next.push(data.from);
        if (data.to.qty > 0) next.push(data.to);
        return sortMixedMaterials(next);
      });
      queryClient.invalidateQueries({ queryKey: ['mixed-materials'] });
      setTransferQty('');
      toast({ title: 'Zapisano transfer', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Wybierz mieszankę.',
        FROM_REQUIRED: 'Wybierz lokalizację źródłową.',
        TO_REQUIRED: 'Wybierz lokalizację docelową.',
        LOCATION_UNKNOWN: 'Wybierz poprawną lokalizację z listy.',
        NOT_FOUND: 'Brak mieszanki w lokalizacji źródłowej.',
        INVALID_QTY: 'Wpisz ilość większą od zera.',
        INSUFFICIENT_QTY: 'Brak wystarczającego stanu.',
        SAME_LOCATION: 'Lokalizacje muszą się różnić.'
      };
      toast({
        title: 'Nie zapisano transferu',
        description: messageMap[err.message] ?? 'Sprawdź dane i spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const name = addName.trim();
    if (!addWarehouseId) {
      toast({ title: 'Wybierz magazyn', tone: 'error' });
      return;
    }
    if (!addLocationId) {
      toast({ title: 'Wybierz lokalizację', description: 'Wybierz lokalizację z listy.', tone: 'error' });
      return;
    }
    const qtyValue = parseQtyInput(addQty);
    if (!name) {
      toast({ title: 'Podaj nazwę mieszanki', tone: 'error' });
      return;
    }
    if (!qtyValue || qtyValue <= 0) {
      toast({ title: 'Podaj ilość', description: 'Wpisz ilość większą od zera.', tone: 'error' });
      return;
    }
    addMutation.mutate({ name, qty: qtyValue, locationId: addLocationId });
  };

  const handleTransfer = (event: React.FormEvent) => {
    event.preventDefault();
    const name = transferName.trim();
    const qtyValue = parseQtyInput(transferQty);
    if (!name) {
      toast({ title: 'Wybierz mieszankę', tone: 'error' });
      return;
    }
    if (transferSourceLocations.length === 0) {
      toast({ title: 'Brak lokalizacji dla tej mieszanki', tone: 'error' });
      return;
    }
    if (!transferFromWarehouseId) {
      toast({ title: 'Wybierz magazyn źródłowy', tone: 'error' });
      return;
    }
    if (!transferFromLocationId) {
      toast({ title: 'Wybierz lokalizację źródłową', tone: 'error' });
      return;
    }
    if (!transferToWarehouseId) {
      toast({ title: 'Wybierz magazyn docelowy', tone: 'error' });
      return;
    }
    if (!transferToLocationId) {
      toast({ title: 'Wybierz lokalizację docelową', tone: 'error' });
      return;
    }
    if (transferFromLocationId === transferToLocationId) {
      toast({ title: 'Lokalizacje muszą się różnić', tone: 'error' });
      return;
    }
    if (!qtyValue || qtyValue <= 0) {
      toast({ title: 'Podaj ilość', description: 'Wpisz ilość większą od zera.', tone: 'error' });
      return;
    }
    transferMutation.mutate({
      name,
      fromLocationId: transferFromLocationId,
      toLocationId: transferToLocationId,
      qty: qtyValue
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wymieszane tworzywa"
        subtitle="Stan mieszanek (bez Przybyło/Wyrobiono)."
      />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Stan bieżący
              </p>
              <p className="text-sm font-semibold text-title">
                Łącznie: {formatKg(totalQty)}
              </p>
            </div>
            <Button
              variant={selectedItem && !readOnly ? 'primaryEmber' : 'outline'}
              className={`h-9 px-4 ${selectedItem && !readOnly ? glowClass : ''}`}
              disabled={!selectedItem || readOnly}
              onClick={handleOpenDelete}
            >
              Usuń zaznaczone
            </Button>
          </div>
          {isLoading ? (
            <p className="text-sm text-dim">Wczytywanie...</p>
          ) : mixedMaterials.length === 0 ? (
            <p className="text-sm text-dim">Brak mieszanek do wyświetlenia.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[inset_0_1px_0_var(--inner-highlight)]">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px] gap-4 bg-surface2 px-4 py-3 text-sm font-semibold text-dim">
                <span>Mieszanka</span>
                <span>Lokalizacja</span>
                <span className="text-right">Ilość</span>
              </div>
              {mixedMaterials.map((item, index) => {
                const isSelected = item.id === selectedId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => !readOnly && setSelectedId(item.id)}
                    disabled={readOnly}
                    className={[
                      'grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px] items-center gap-4 border-t border-border px-4 py-3 text-left text-sm text-body transition',
                      readOnly ? 'cursor-default' : 'cursor-pointer',
                      index % 2 === 1 ? 'bg-surface2' : '',
                      isSelected
                        ? 'bg-[rgba(255,106,0,0.12)] text-title shadow-[inset_2px_0_0_0_rgba(255,106,0,0.85)]'
                        : readOnly
                        ? ''
                        : 'hover:bg-[rgba(255,255,255,0.03)]'
                    ].join(' ')}
                  >
                    <span className="font-semibold">{item.name}</span>
                    <span className="text-body">
                      {locationMap.get(item.locationId) ?? 'Nieznana lokacja'}
                    </span>
                    <span className="text-right font-semibold tabular-nums">
                      {formatKg(item.qty)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        {readOnly ? (
          <Card className="space-y-2">
            <p className="text-sm font-semibold text-title">Tryb podgladu</p>
            <p className="text-sm text-dim">Brak uprawnien do edycji mieszanek.</p>
          </Card>
        ) : (
          <Card>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
            <TabsList>
              <TabsTrigger value="add" className="data-[state=active]:bg-[var(--brand)] data-[state=active]:text-bg">
                Dodaj
              </TabsTrigger>
              <TabsTrigger value="transfer" className="data-[state=active]:bg-[var(--value-purple)] data-[state=active]:text-bg">
                Transfer
              </TabsTrigger>
            </TabsList>

            <TabsContent value="add" className="mt-4">
              <form onSubmit={handleAdd} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Nazwa mieszanki</label>
                  <Input
                    value={addName}
                    onChange={(event) => setAddName(event.target.value)}
                    placeholder="np. ABS/PP mix"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Magazyn</label>
                  <SelectField
                    value={addWarehouseId}
                    onChange={(event) => {
                      setAddWarehouseId(event.target.value);
                      setAddLocationId('');
                    }}
                  >
                    <option value="">Wybierz magazyn</option>
                    {warehouseOptions.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Lokalizacja</label>
                  <SelectField
                    value={addLocationId}
                    onChange={(event) => setAddLocationId(event.target.value)}
                    disabled={!addWarehouseId}
                  >
                    <option value="">Wybierz lokalizację</option>
                    {getLocationsForWarehouse(addWarehouseId).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Ilość (kg)</label>
                  <Input
                    value={addQty}
                    onChange={(event) => setAddQty(event.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </div>
                <Button type="submit" disabled={addMutation.isPending}>
                  Dodaj stan
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="transfer" className="mt-4">
              <form onSubmit={handleTransfer} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Mieszanka</label>
                  <div className="relative">
                    <Input
                      value={transferName}
                      onChange={(event) => {
                        setTransferName(event.target.value);
                        setTransferFromWarehouseId('');
                        setTransferFromLocationId('');
                      }}
                      list="mixed-materials-names"
                      placeholder="Wybierz z listy"
                      className={transferName ? 'pr-10' : undefined}
                    />
                    {transferName && (
                      <button
                        type="button"
                        aria-label="Wyczysc mieszanke"
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border bg-surface2 px-2 py-1 text-xs font-semibold text-dim transition hover:border-borderStrong hover:text-title"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setTransferName('');
                          setTransferFromWarehouseId('');
                          setTransferFromLocationId('');
                        }}
                      >
                        X
                      </button>
                    )}
                  </div>
                </div>
                {transferName.trim() && transferSourceLocations.length === 0 && (
                  <p className="text-xs text-dim">
                    {'Brak lokalizacji dla tej mieszanki.'}
                  </p>
                )}
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Magazyn źródłowy</label>
                  <SelectField
                    value={transferFromWarehouseId}
                    onChange={(event) => {
                      setTransferFromWarehouseId(event.target.value);
                      setTransferFromLocationId('');
                    }}
                    disabled={transferSourceLocations.length === 0}
                  >
                    <option value="">Wybierz magazyn</option>
                    {transferSourceWarehouseOptions.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Z lokalizacji</label>
                  <SelectField
                    value={transferFromLocationId}
                    onChange={(event) => setTransferFromLocationId(event.target.value)}
                    disabled={!transferFromWarehouseId || transferSourceLocations.length === 0}
                  >
                    <option value="">Wybierz lokalizację</option>
                    {getTransferSourceLocationsForWarehouse(transferFromWarehouseId).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Magazyn docelowy</label>
                  <SelectField
                    value={transferToWarehouseId}
                    onChange={(event) => {
                      setTransferToWarehouseId(event.target.value);
                      setTransferToLocationId('');
                    }}
                  >
                    <option value="">Wybierz magazyn</option>
                    {warehouseOptions.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Do lokalizacji</label>
                  <SelectField
                    value={transferToLocationId}
                    onChange={(event) => setTransferToLocationId(event.target.value)}
                    disabled={!transferToWarehouseId}
                  >
                    <option value="">Wybierz lokalizację</option>
                    {getLocationsForWarehouse(transferToWarehouseId).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-dim">Ilość (kg)</label>
                  <Input
                    value={transferQty}
                    onChange={(event) => setTransferQty(event.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                  />
                </div>
                <Button type="submit" variant="outline" disabled={transferMutation.isPending}>
                  Zapisz transfer
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
        )}
      </div>

      <datalist id="mixed-materials-names">
        {nameOptions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[999] flex items-start justify-center bg-[rgba(5,6,10,0.78)] px-4 pt-[8vh]"
          onClick={() => {
            setConfirmReady(false);
            setDeleteTarget(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-[rgba(10,11,15,0.98)] p-6 shadow-[inset_0_1px_0_var(--inner-highlight)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-4">
              <div>
                <p className="text-lg font-semibold text-title">Usunąć pozycję?</p>
                <p className="mt-2 text-sm text-dim">
                  {`${deleteTarget.name} (${locationMap.get(deleteTarget.locationId) ?? 'Nieznana lokacja'})`}
                </p>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmReady(false);
                    setDeleteTarget(null);
                  }}
                >
                  Anuluj
                </Button>
                <Button
                  variant="primaryEmber"
                  onClick={() => confirmReady && deleteMutation.mutate(deleteTarget.id)}
                  disabled={deleteMutation.isPending || !confirmReady}
                >
                  Usuń
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
