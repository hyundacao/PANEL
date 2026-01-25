'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addMaterial,
  addOriginalInventoryCatalog,
  getCatalog,
  getDryers,
  getOriginalInventoryCatalog,
  setDryerMaterial
} from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectField } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { DataTable } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { SearchInput } from '@/components/ui/SearchInput';
import { useToastStore } from '@/components/ui/Toast';
import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';

const collator = new Intl.Collator('pl', { sensitivity: 'base' });
const compareByName = (a: { name: string }, b: { name: string }) =>
  collator.compare(a.name, b.name);
const toSearchText = (value: string) => value.trim().toLocaleLowerCase('pl');

type AssignableMaterial = {
  id: string;
  label: string;
  search: string;
  group: 'PRZEMIAL' | 'ORYGINAL';
};

export default function DryersPage() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'PRZEMIALY');

  const { data: dryers = [], isLoading } = useQuery({
    queryKey: ['dryers'],
    queryFn: getDryers
  });
  const { data: materials = [] } = useQuery({
    queryKey: ['catalog'],
    queryFn: getCatalog
  });
  const { data: originalCatalog = [] } = useQuery({
    queryKey: ['spis-oryginalow-catalog'],
    queryFn: getOriginalInventoryCatalog
  });

  const [assignDryerId, setAssignDryerId] = useState('');
  const [assignMaterialId, setAssignMaterialId] = useState('');
  const [materialSearch, setMaterialSearch] = useState('');
  const [newMaterialType, setNewMaterialType] = useState<'PRZEMIAL' | 'ORYGINAL'>('PRZEMIAL');
  const [newMaterialName, setNewMaterialName] = useState('');

  const sortedDryers = useMemo(
    () =>
      [...dryers].sort((a, b) => {
        const order = a.orderNo - b.orderNo;
        if (order !== 0) return order;
        return a.name.localeCompare(b.name, 'pl', { sensitivity: 'base' });
      }),
    [dryers]
  );
  const sortedMaterials = useMemo(() => [...materials].sort(compareByName), [materials]);
  const sortedOriginals = useMemo(
    () => [...originalCatalog].sort((a, b) => collator.compare(a.name, b.name)),
    [originalCatalog]
  );
  const allAssignableMaterials = useMemo<AssignableMaterial[]>(() => {
    const list: AssignableMaterial[] = [];
    sortedMaterials.forEach((mat) => {
      list.push({
        id: mat.id,
        label: mat.name,
        search: toSearchText(mat.name),
        group: 'PRZEMIAL'
      });
    });
    sortedOriginals.forEach((item) => {
      list.push({
        id: item.id,
        label: item.name,
        search: toSearchText(item.name),
        group: 'ORYGINAL'
      });
    });
    return list;
  }, [sortedMaterials, sortedOriginals]);
  const filteredAssignableMaterials = useMemo(() => {
    const needle = toSearchText(materialSearch);
    if (!needle) return allAssignableMaterials;
    return allAssignableMaterials.filter((item) => item.search.includes(needle));
  }, [allAssignableMaterials, materialSearch]);
  const assignableByGroup = useMemo(() => {
    const przemialy: AssignableMaterial[] = [];
    const oryginaly: AssignableMaterial[] = [];
    filteredAssignableMaterials.forEach((item) => {
      if (item.group === 'PRZEMIAL') {
        przemialy.push(item);
      } else {
        oryginaly.push(item);
      }
    });
    przemialy.sort((a, b) => collator.compare(a.label, b.label));
    oryginaly.sort((a, b) => collator.compare(a.label, b.label));
    return { przemialy, oryginaly };
  }, [filteredAssignableMaterials]);
  const materialLabels = useMemo(() => {
    const map = new Map<string, string>();
    sortedMaterials.forEach((mat) => map.set(mat.id, mat.name));
    sortedOriginals.forEach((item) => map.set(item.id, item.name));
    return map;
  }, [sortedMaterials, sortedOriginals]);

  useEffect(() => {
    if (!assignDryerId) {
      setAssignMaterialId('');
      setMaterialSearch('');
      return;
    }
    const current = dryers.find((dryer) => dryer.id === assignDryerId);
    const materialId = current?.materialId ?? '';
    setAssignMaterialId(materialId);
    setMaterialSearch(materialId ? materialLabels.get(materialId) ?? '' : '');
  }, [assignDryerId, dryers, materialLabels]);

  useEffect(() => {
    if (!materialSearch.trim()) return;
    setNewMaterialName((prev) => (prev ? prev : materialSearch));
  }, [materialSearch]);

  const assignMutation = useMutation({
    mutationFn: setDryerMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dryers'] });
      setMaterialSearch('');
      setNewMaterialName('');
      setAssignDryerId('');
      setAssignMaterialId('');
      setNewMaterialType('PRZEMIAL');
      toast({ title: 'Zapisano przypisanie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono suszarki.',
        MATERIAL_MISSING: 'Wybierz poprawne tworzywo.'
      };
      toast({
        title: 'Nie zapisano przypisania',
        description: messageMap[err.message] ?? 'Spróbuj ponownie.',
        tone: 'error'
      });
    }
  });
  const clearMutation = useMutation({
    mutationFn: setDryerMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dryers'] });
      setAssignMaterialId('');
      setMaterialSearch('');
      toast({ title: 'Wyczyszczono przypisanie', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NOT_FOUND: 'Nie znaleziono suszarki.'
      };
      toast({
        title: 'Nie wyczyszczono przypisania',
        description: messageMap[err.message] ?? 'Spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const addMaterialMutation = useMutation({
    mutationFn: addMaterial,
    onSuccess: (material) => {
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      setAssignMaterialId(material.id);
      setMaterialSearch(material.name);
      setNewMaterialName('');
      toast({ title: 'Dodano przemiał', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        INVALID_NAME: 'Podaj nazwę przemiału.',
        DUPLICATE: 'Taki przemiał już istnieje.'
      };
      toast({
        title: 'Nie dodano przemiału',
        description: messageMap[err.message] ?? 'Spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const addOriginalMutation = useMutation({
    mutationFn: addOriginalInventoryCatalog,
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: ['spis-oryginalow-catalog'] });
      setAssignMaterialId(entry.id);
      setMaterialSearch(entry.name);
      setNewMaterialName('');
      toast({ title: 'Dodano oryginał', tone: 'success' });
    },
    onError: (err: Error) => {
      const messageMap: Record<string, string> = {
        NAME_REQUIRED: 'Podaj nazwę oryginału.',
        DUPLICATE: 'Taki oryginał już istnieje.'
      };
      toast({
        title: 'Nie dodano oryginału',
        description: messageMap[err.message] ?? 'Spróbuj ponownie.',
        tone: 'error'
      });
    }
  });

  const handleAssign = () => {
    if (readOnly) return;
    if (!assignDryerId) {
      toast({ title: 'Wybierz suszarkę', tone: 'error' });
      return;
    }
    assignMutation.mutate({
      id: assignDryerId,
      materialId: assignMaterialId || null
    });
  };

  const handleAddMaterial = () => {
    if (readOnly) return;
    const name = newMaterialName.trim();
    if (!name) {
      toast({ title: 'Podaj nazwę tworzywa', tone: 'error' });
      return;
    }
    if (newMaterialType === 'PRZEMIAL') {
      addMaterialMutation.mutate({ name });
    } else {
      addOriginalMutation.mutate({ name, unit: 'kg' });
    }
  };

  const handleClearAssignment = () => {
    if (readOnly) return;
    if (!assignDryerId) {
      toast({ title: 'Wybierz suszarkę', tone: 'error' });
      return;
    }
    clearMutation.mutate({ id: assignDryerId, materialId: null });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suszarki"
        subtitle="Przypisuj tworzywa do suszarek przed startem produkcji."
      />

      <div className="grid gap-6">
        <Card className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Przypisz tworzywo</p>
          <div className="space-y-3">
            <SelectField
              value={assignDryerId}
              onChange={(event) => setAssignDryerId(event.target.value)}
              disabled={readOnly || sortedDryers.length === 0}
            >
              <option value="">Wybierz suszarkę</option>
              {sortedDryers.map((dryer) => (
                <option key={dryer.id} value={dryer.id}>
                  {dryer.name}
                  {!dryer.isActive ? ' (nieaktywna)' : ''}
                </option>
              ))}
            </SelectField>
            <SearchInput
              value={materialSearch}
              onChange={(event) => setMaterialSearch(event.target.value)}
              placeholder="Szukaj tworzywa (oryginały i przemiał)"
              disabled={readOnly || allAssignableMaterials.length === 0}
            />
            {materialSearch.trim().length > 0 && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-black/30 p-3">
                <p className="text-xs uppercase tracking-wide text-dim">
                  Podpowiedzi z kartotek
                </p>
                {assignableByGroup.przemialy.length === 0 &&
                assignableByGroup.oryginaly.length === 0 ? (
                  <p className="text-sm text-dim">Brak dopasowań.</p>
                ) : (
                  <div className="space-y-2">
                    {assignableByGroup.przemialy.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-dim">Przemiał</p>
                        <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                          {assignableByGroup.przemialy.map((material) => (
                            <button
                              key={`hint-${material.id}`}
                              type="button"
                              className="rounded-lg px-3 py-2 text-left text-sm text-title transition hover:bg-white/10"
                              onClick={() => {
                                setAssignMaterialId(material.id);
                                setMaterialSearch(material.label);
                              }}
                              disabled={readOnly}
                            >
                              {material.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {assignableByGroup.oryginaly.length > 0 && (
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-dim">Oryginały</p>
                        <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
                          {assignableByGroup.oryginaly.map((material) => (
                            <button
                              key={`hint-${material.id}`}
                              type="button"
                              className="rounded-lg px-3 py-2 text-left text-sm text-title transition hover:bg-white/10"
                              onClick={() => {
                                setAssignMaterialId(material.id);
                                setMaterialSearch(material.label);
                              }}
                              disabled={readOnly}
                            >
                              {material.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-dim">
              <span>
                Wybrane tworzywo:{' '}
                <span className="text-title">
                  {assignMaterialId ? materialLabels.get(assignMaterialId) ?? '-' : '-'}
                </span>
              </span>
              {assignMaterialId && (
                <button
                  type="button"
                  className="text-xs uppercase tracking-wide text-brand hover:text-brandHover"
                  onClick={handleClearAssignment}
                  disabled={readOnly || clearMutation.isPending}
                >
                  Wyczyść przypisanie
                </button>
              )}
            </div>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                Nie ma na liście? Dodaj z tego poziomu
              </p>
              <div className="grid gap-3 md:grid-cols-[180px_1fr]">
                <SelectField
                  value={newMaterialType}
                  onChange={(event) =>
                    setNewMaterialType(event.target.value === 'ORYGINAL' ? 'ORYGINAL' : 'PRZEMIAL')
                  }
                  disabled={readOnly}
                >
                  <option value="PRZEMIAL">Przemiał</option>
                  <option value="ORYGINAL">Oryginał</option>
                </SelectField>
                <Input
                  value={newMaterialName}
                  onChange={(event) => setNewMaterialName(event.target.value)}
                  placeholder="Nazwa tworzywa"
                  disabled={readOnly}
                />
              </div>
              {newMaterialType === 'PRZEMIAL' ? (
                <p className="text-xs text-dim">
                  Dodasz przemiał tylko po nazwie (kod ERP nie jest wymagany).
                </p>
              ) : (
                <p className="text-xs text-dim">
                  Dodasz oryginał tylko po nazwie (jednostka nie jest wymagana).
                </p>
              )}
              <div className="flex justify-end">
                <Button
                  onClick={handleAddMaterial}
                  disabled={
                    readOnly ||
                    addMaterialMutation.isPending ||
                    addOriginalMutation.isPending
                  }
                >
                  Dodaj tworzywo
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleAssign}
              disabled={readOnly || assignMutation.isPending || !assignDryerId}
            >
              Zapisz przypisanie
            </Button>
            <Button
              variant="secondary"
              onClick={handleClearAssignment}
              disabled={readOnly || clearMutation.isPending}
            >
              Wyczyść dane
            </Button>
          </div>
        </Card>
      </div>

      {isLoading ? (
        <p className="text-sm text-dim">Wczytywanie...</p>
      ) : sortedDryers.length === 0 ? (
        <EmptyState
          title="Brak suszarek"
          description="Brak zdefiniowanych suszarek w systemie."
        />
      ) : (
        <Card>
          <DataTable
            columns={['Suszarka', 'Tworzywo', 'Status', 'Kolejność']}
            rows={sortedDryers.map((dryer) => [
              dryer.name,
              materialLabels.get(dryer.materialId ?? '') ?? '-',
              <Badge
                key={`${dryer.id}-status`}
                tone={dryer.isActive ? 'success' : 'warning'}
              >
                {dryer.isActive ? 'Aktywna' : 'Nieaktywna'}
              </Badge>,
              <span key={`${dryer.id}-order`} className="font-semibold tabular-nums">
                {dryer.orderNo}
              </span>
            ])}
          />
        </Card>
      )}
    </div>
  );
}
