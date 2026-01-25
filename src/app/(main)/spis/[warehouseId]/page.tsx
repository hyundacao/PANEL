'use client';



import { useEffect, useRef } from 'react';

import Link from 'next/link';

import { useParams } from 'next/navigation';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { confirmNoChangeLocation, getLocationsOverview, getTodayKey, getWarehouses } from '@/lib/api';

import { Card } from '@/components/ui/Card';

import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';

import { PageHeader } from '@/components/layout/PageHeader';

import { useUiStore } from '@/lib/store/ui';
import { isReadOnly } from '@/lib/auth/access';

import { useToastStore } from '@/components/ui/Toast';

import { formatKg } from '@/lib/utils/format';



export default function SpisWarehousePage() {

  const params = useParams();

  const warehouseId = params.warehouseId as string;

  const today = getTodayKey();

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: getWarehouses
  });
  const warehouse = warehouses?.find((item) => item.id === warehouseId);

  const { filters, setFilters, user } = useUiStore();

  const canEdit = !isReadOnly(user, 'PRZEMIALY');

  const toast = useToastStore((state) => state.push);

  const queryClient = useQueryClient();

  const scrollRestored = useRef(false);



  const { data, isLoading, refetch } = useQuery({
    queryKey: ['locations', warehouseId, today, filters.onlyPending],
    queryFn: () => getLocationsOverview(warehouseId, today)
  });


  const filtered = (data ?? []).filter((loc) => {
    if (filters.onlyPending && loc.status === 'DONE') return false;
    return true;
  });


  const confirmedCount = (data ?? []).filter((loc) => loc.status === 'DONE').length;

  const totalCount = (data ?? []).length;



  const scrollKey = `spis-scroll-${warehouseId}`;

  const returnKey = `spis-return-${warehouseId}`;

  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';



  useEffect(() => {

    scrollRestored.current = false;

  }, [warehouseId]);



  useEffect(() => {

    if (isLoading || scrollRestored.current) return;

    const shouldRestore = sessionStorage.getItem(returnKey) === '1';

    if (!shouldRestore) {

      sessionStorage.removeItem(scrollKey);

      return;

    }

    const stored = sessionStorage.getItem(scrollKey);

    const y = stored ? Number(stored) : 0;

    if (!Number.isNaN(y)) {

      requestAnimationFrame(() => window.scrollTo(0, y));

    }

    sessionStorage.removeItem(returnKey);

    scrollRestored.current = true;

  }, [isLoading, returnKey, scrollKey]);



  useEffect(() => {

    const handleScroll = () => {

      sessionStorage.setItem(scrollKey, String(window.scrollY));

    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);

  }, [scrollKey]);



  const invalidateDashboard = () => {

    queryClient.invalidateQueries({ queryKey: ['dashboard', today] });

    queryClient.invalidateQueries({ queryKey: ['monthly-delta', today] });

    queryClient.invalidateQueries({ queryKey: ['monthly-breakdown', today] });

    queryClient.invalidateQueries({ queryKey: ['material-totals'] });
    queryClient.invalidateQueries({ queryKey: ['top-catalog', today] });

    queryClient.invalidateQueries({ queryKey: ['totals-history'] });

    queryClient.invalidateQueries({ queryKey: ['daily-history'] });

    queryClient.invalidateQueries({ queryKey: ['report-period'] });

    queryClient.invalidateQueries({ queryKey: ['report-yearly'] });

  };



  const markReturn = () => {

    sessionStorage.setItem(returnKey, '1');

    sessionStorage.setItem(scrollKey, String(window.scrollY));

  };



  const handleNoChange = async (locationId: string) => {

    await confirmNoChangeLocation(locationId);

    invalidateDashboard();

    toast({ title: 'Zatwierdzono lokacj\u0119', description: 'Wpisy ustawione jako bez zmian.', tone: 'success' });
    refetch();

  };



  return (

    <div className="space-y-6">

      <PageHeader

        title={`Spis: ${warehouse?.name ?? 'Hala'}`}

        subtitle={`Dzi\u0144: ${today} - Post\u0119p ${confirmedCount}/${totalCount}`}
        titleColor="var(--location-blue)"

        actions={

          <>

            <Button variant="secondary" onClick={() => refetch()} className={glowClass}>
              {'Od\u015bwie\u017c'}
            </Button>
          </>

        }

      />



      <div className="space-y-4">

        <Card className="grid gap-4 lg:grid-cols-[1fr_2fr] lg:items-center">

          <div>

            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Postep spisu</p>

            <div className="mt-2 flex items-end gap-3">

              <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--brand)' }}>

                {confirmedCount}/{totalCount}

              </p>

              <p className="text-sm text-dim">lokacje zatwierdzone</p>

            </div>

          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Toggle
              checked={filters.onlyPending}
              onCheckedChange={(value) => setFilters({ onlyPending: value })}
              label="Tylko niezatwierdzone"
            />
          </div>
        </Card>



        <div className="flex flex-wrap items-center justify-between gap-3">

          <div>

            <p className="text-xs font-semibold uppercase tracking-wide text-dim">Lista lokacji</p>

            <p className="text-sm text-dim">Widoczne: {filtered.length}</p>

          </div>

        </div>



        <div className="mt-2 space-y-4">

          {isLoading && <Card>{'\u0141adowanie lokacji...'}</Card>}
          {filtered.map((loc) => (

            <Card key={loc.id} className="flex flex-col gap-4">

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold" style={{ color: 'var(--location-blue)' }}>
                    {loc.name}
                  </h3>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface2 p-4 shadow-[inset_0_1px_0_var(--inner-highlight)]">

                <p className="text-xs font-semibold uppercase tracking-wide text-dim">

                  {loc.source === 'TODAY' ? 'SPIS DZIS' : 'OSTATNI SPIS'}

                </p>

                {loc.currentItems.length === 0 ? (

                  <p className="text-sm text-muted">

                    {loc.empty ? 'Pusto (0 kg)' : 'Brak danych'}

                  </p>

                ) : (

                  <div className="space-y-1 text-left">

                    {loc.currentItems.map((item) => (

                      <p key={item.label} className="text-sm font-semibold" style={{ color: 'var(--value-purple)' }}>

                        -  {item.label} - {formatKg(item.qty)}

                      </p>

                    ))}

                  </div>

                )}

              </div>

              <div className="flex flex-wrap gap-3">

                {canEdit && (

                  <Button variant="secondary" onClick={() => handleNoChange(loc.id)} className={glowClass}>

                    Bez zmian

                  </Button>

                )}

                {canEdit ? (
                  <Button asChild variant="primaryEmber">
                    <Link href={`/spis/${warehouseId}/lokacja/${loc.id}`} onClick={markReturn}>
                      {'Zmie\u0144'}
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" disabled>
                    Podglad
                  </Button>
                )}

              </div>

            </Card>

          ))}

        </div>

      </div>

    </div>

  );

}

