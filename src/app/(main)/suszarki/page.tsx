'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
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

const normalizeDryerQrBaseUrl = (value: string) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const parsed = new URL(text);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = pathname.toLowerCase().endsWith('/suszarki')
      ? pathname || '/suszarki'
      : `${pathname}/suszarki`.replace(/\/{2,}/g, '/');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return text.replace(/\/+$/, '');
  }
};

const buildDryerQrUrl = (baseUrl: string, dryerId: string) => {
  const encodedDryerId = encodeURIComponent(dryerId);
  const normalizedBase = normalizeDryerQrBaseUrl(baseUrl);
  if (normalizedBase) return `${normalizedBase}?dryer=${encodedDryerId}`;
  return `/suszarki?dryer=${encodedDryerId}`;
};

const formatDryerQrCode = (dryerOrderNo: number) =>
  `SUSZ-${String(Math.max(0, dryerOrderNo)).padStart(2, '0')}`;

const FIXED_QR_APP_ORIGIN = String(process.env.NEXT_PUBLIC_QR_APP_ORIGIN ?? '').trim();

export default function DryersPage() {
  const toast = useToastStore((state) => state.push);
  const queryClient = useQueryClient();
  const { user } = useUiStore();
  const readOnly = isReadOnly(user, 'PRZEMIALY');
  const searchParams = useSearchParams();
  const qrDryerParam = searchParams.get('dryer')?.trim() ?? '';
  const qrParamHandledRef = useRef('');

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
  const [appOrigin, setAppOrigin] = useState(FIXED_QR_APP_ORIGIN);

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
  const qrSelectedDryer = useMemo(
    () => sortedDryers.find((dryer) => dryer.id === qrDryerParam) ?? null,
    [sortedDryers, qrDryerParam]
  );
  const dryerQrItems = useMemo(
    () =>
      sortedDryers.map((dryer) => ({
        dryer,
        code: formatDryerQrCode(dryer.orderNo),
        url: buildDryerQrUrl(appOrigin, dryer.id),
        materialLabel: materialLabels.get(dryer.materialId ?? '') ?? null
      })),
    [sortedDryers, appOrigin, materialLabels]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (FIXED_QR_APP_ORIGIN) return;
    setAppOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!qrDryerParam) return;
    if (qrParamHandledRef.current === qrDryerParam) return;
    if (sortedDryers.length === 0) return;
    qrParamHandledRef.current = qrDryerParam;
    const matchedDryer = sortedDryers.find((dryer) => dryer.id === qrDryerParam);
    if (!matchedDryer) {
      toast({
        title: 'Kod QR wskazuje nieznana suszarke',
        description: 'Sprawdz etykiete QR lub liste suszarek.',
        tone: 'error'
      });
      return;
    }
    setAssignDryerId(matchedDryer.id);
    toast({
      title: `Otwarto suszarke: ${matchedDryer.name}`,
      description: 'Wybierz tworzywo i zapisz przypisanie.',
      tone: 'info'
    });
  }, [qrDryerParam, sortedDryers, toast]);

  useEffect(() => {
    if (!assignDryerId) {
      const timer = setTimeout(() => {
        setAssignMaterialId('');
        setMaterialSearch('');
      }, 0);
      return () => clearTimeout(timer);
    }
    const current = dryers.find((dryer) => dryer.id === assignDryerId);
    const materialId = current?.materialId ?? '';
    const timer = setTimeout(() => {
      setAssignMaterialId(materialId);
      setMaterialSearch(materialId ? materialLabels.get(materialId) ?? '' : '');
    }, 0);
    return () => clearTimeout(timer);
  }, [assignDryerId, dryers, materialLabels]);

  useEffect(() => {
    if (!materialSearch.trim()) return;
    const timer = setTimeout(() => {
      setNewMaterialName((prev) => (prev ? prev : materialSearch));
    }, 0);
    return () => clearTimeout(timer);
  }, [materialSearch]);

  const assignMutation = useMutation({
    mutationFn: setDryerMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dryers'] });
      setMaterialSearch('');
      setNewMaterialName('');
      setAssignDryerId(qrSelectedDryer?.id ?? '');
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

  const handleCopyQrLink = async (url: string, dryerName: string) => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('CLIPBOARD_NOT_AVAILABLE');
      }
      await navigator.clipboard.writeText(url);
      toast({
        title: `Skopiowano link QR: ${dryerName}`,
        tone: 'success'
      });
    } catch {
      toast({
        title: 'Nie udalo sie skopiowac linku QR',
        description: 'Skopiuj link recznie z etykiety.',
        tone: 'error'
      });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suszarki"
        subtitle="Przypisuj tworzywa do suszarek przed startem produkcji."
      />

      <div className="grid gap-6">
        {qrDryerParam && (
          <Card className="space-y-2 border-[rgba(255,122,26,0.45)]">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Tryb skanu QR</p>
            {qrSelectedDryer ? (
              <div className="space-y-1">
                <p className="text-sm text-body">
                  Otwarta suszarka: <span className="font-semibold text-title">{qrSelectedDryer.name}</span>
                </p>
                <p className="text-xs text-dim">
                  Zeskanowany kod otworzyl te suszarke. Ustaw tworzywo i zapisz przypisanie.
                </p>
              </div>
            ) : (
              <p className="text-sm text-danger">
                Nie znaleziono suszarki dla kodu QR: {qrDryerParam}
              </p>
            )}
          </Card>
        )}

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
              clearable
              onClear={() => setMaterialSearch('')}
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

        <Card className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Etykiety QR suszarek</p>
            <p className="mt-1 text-xs text-dim">
              Skan kodu QR otwiera bezposrednio wybrana suszarke i formularz przypisania tworzywa.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {dryerQrItems.map(({ dryer, code, url, materialLabel }) => (
              <div
                key={`dryer-qr-${dryer.id}`}
                className="rounded-2xl border border-white/10 bg-black/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-title">{dryer.name}</p>
                    <p className="text-[11px] text-dim">{code}</p>
                  </div>
                  <Badge tone={dryer.isActive ? 'success' : 'warning'}>
                    {dryer.isActive ? 'Aktywna' : 'Nieaktywna'}
                  </Badge>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <div className="rounded-lg bg-white p-2">
                    <QRCodeSVG value={url} size={112} bgColor="#ffffff" fgColor="#111111" level="M" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <p className="text-[11px] uppercase tracking-wide text-dim">Aktualne tworzywo</p>
                    <p className="text-sm text-body">{materialLabel ?? '-'}</p>
                  </div>
                </div>

                <p className="mt-3 break-all text-[11px] text-dim">{url}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="min-h-[40px] px-3 py-2 text-xs"
                    onClick={() => setAssignDryerId(dryer.id)}
                  >
                    Otworz suszarke
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-[40px] px-3 py-2 text-xs"
                    onClick={() => handleCopyQrLink(url, dryer.name)}
                  >
                    Kopiuj link QR
                  </Button>
                </div>
              </div>
            ))}
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
