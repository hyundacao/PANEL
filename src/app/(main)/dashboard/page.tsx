'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  getCurrentMaterialTotals,
  getDashboard,
  getMonthlyDelta,
  getMonthlyMaterialBreakdown,
  getTodayKey,
  getTopCatalogTotal,
  getTotalsHistory
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { MetricPill } from '@/components/ui/MetricPill';
import { formatKg } from '@/lib/utils/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Bar,
  BarChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

export default function DashboardPage() {
  const today = getTodayKey();
  const queryClient = useQueryClient();
  const [rangeDays, setRangeDays] = useState(30);
  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard', today],
    queryFn: () => getDashboard(today)
  });
  const { data: totalsHistory } = useQuery({
    queryKey: ['totals-history', today, rangeDays],
    queryFn: () => getTotalsHistory(rangeDays)
  });
  const { data: topCatalog } = useQuery({
    queryKey: ['top-catalog', today],
    queryFn: getTopCatalogTotal
  });
  const { data: monthlyDelta } = useQuery({
    queryKey: ['monthly-delta', today],
    queryFn: getMonthlyDelta
  });
  const { data: monthlyBreakdown } = useQuery({
    queryKey: ['monthly-breakdown', today],
    queryFn: getMonthlyMaterialBreakdown
  });
  const { data: currentTotals } = useQuery({
    queryKey: ['material-totals', today, 'stats'],
    queryFn: () => getCurrentMaterialTotals('stats')
  });
  const currentTotal = totalsHistory?.[totalsHistory.length - 1]?.total ?? 0;
  const pieColors = [
    'var(--brand)',
    'var(--value-purple)',
    'var(--success)',
    'var(--warning)',
    'var(--danger)',
    'var(--t-muted)'
  ];
  const glowClass = 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pulpit"
        subtitle={`Dzi\u015b: ${today}`}
        actions={
          <Button
            variant="secondary"
            onClick={() => queryClient.invalidateQueries()}
            className={glowClass}
          >
            {'Od\u015bwie\u017c'}
          </Button>
        }
      />

      <Card>
        <div className="grid gap-8 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <div>
            <p className="text-lg font-semibold uppercase tracking-wide" style={{ color: 'var(--brand)' }}>
              {'Aktualna ilo\u015b\u0107 przemia\u0142\u00f3w'}
            </p>
            <p className="mt-3 text-7xl font-semibold tabular-nums" style={{ color: 'var(--value-purple)' }}>
              {formatKg(currentTotal)}
            </p>
              <p className="text-lg">{'Suma stan\u00f3w z ca\u0142ej firmy.'}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1.4fr_auto] sm:items-center">
            <div className="h-56 pr-10">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={totalsHistory ?? []} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    stroke="var(--t-dim)"
                    tickFormatter={(value) => String(value).slice(5)}
                  />
                  <YAxis stroke="var(--t-dim)" tickFormatter={(value) => `${value}`} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border)',
                      color: 'var(--t-body)'
                    }}
                    labelStyle={{ color: 'var(--t-muted)' }}
                    formatter={(value: number) => formatKg(value)}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--brand)"
                    fill="var(--brand-soft)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <Button
                variant={rangeDays === 30 ? 'secondary' : 'outline'}
                onClick={() => setRangeDays(30)}
                className={`${rangeDays === 30 ? glowClass : ''} w-36 justify-center`}
              >
                1 miesiac
              </Button>
              <Button
                variant={rangeDays === 90 ? 'secondary' : 'outline'}
                onClick={() => setRangeDays(90)}
                className={`${rangeDays === 90 ? glowClass : ''} w-36 justify-center`}
              >
                3 miesiace
              </Button>
              <Button
                variant={rangeDays === 365 ? 'secondary' : 'outline'}
                onClick={() => setRangeDays(365)}
                className={`${rangeDays === 365 ? glowClass : ''} w-36 justify-center`}
              >
                Ostatni rok
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {isLoading &&
          Array.from({ length: 2 }).map((_, idx) => (
            <Card key={`s-${idx}`}>
              <Skeleton className="h-28 w-full" />
            </Card>
          ))}

        {dashboard?.map((item) => {
          const ready = item.confirmed === item.total && item.total > 0;
          return (
            <Card key={item.warehouseId} className="text-center">
              <div className="flex flex-col items-center">
                <div>
                  <p className="text-xl font-semibold" style={{ color: 'var(--location-blue)' }}>
                    {item.warehouseName}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">
                    Spis dzisiejszy
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-6">
                    <div>
                      <p className="text-xs font-semibold tracking-wide" style={{ color: 'var(--danger)' }}>
                        {'PRZYBY\u0141O'}
                      </p>
                      <MetricPill tone="success" className="mt-2 text-2xl font-semibold tabular-nums">
                        {formatKg(item.added)}
                      </MetricPill>
                    </div>
                    <div>
                      <p
                        className="text-xs font-semibold tracking-wide"
                        style={{ color: 'var(--success)' }}
                      >
                        WYROBIONO
                      </p>
                      <MetricPill tone="danger" className="mt-2 text-2xl font-semibold tabular-nums">
                        {formatKg(item.removed)}
                      </MetricPill>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>








      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="flex flex-col items-center text-center">
          <p className="text-xl font-semibold" style={{ color: 'var(--brand)' }}>
            {'Najwi\u0119ksza kartoteka'}
          </p>
          <p className="mt-2 text-xl font-semibold" style={{ color: 'var(--value-purple)' }}>
            {topCatalog?.catalog ?? 'Brak danych'}
          </p>
          <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--value-purple)' }}>
            {formatKg(topCatalog?.total ?? 0)}
          </p>
        </Card>
        <Card className="flex flex-col items-center text-center">
          <p className="text-xl font-semibold" style={{ color: 'var(--danger)' }}>
            {'Przyby\u0142o w miesi\u0105cu'}
          </p>
          <MetricPill tone="success" className="mt-2 text-xl font-semibold tabular-nums">
            {formatKg(monthlyDelta?.added ?? 0)}
          </MetricPill>
        </Card>
        <Card className="flex flex-col items-center text-center">
          <p className="text-xl font-semibold" style={{ color: 'var(--success)' }}>
            {'Wyrobiono w miesi\u0105cu'}
          </p>
          <MetricPill tone="danger" className="mt-2 text-xl font-semibold tabular-nums">
            {formatKg(monthlyDelta?.removed ?? 0)}
          </MetricPill>
        </Card>
      </div>


      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col items-center text-center">
          <p className="text-xl font-semibold" style={{ color: 'var(--brand)' }}>
            {'Przemia\u0142y przyby\u0142e w miesi\u0105cu'}
          </p>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={monthlyBreakdown?.added ?? []}
                  dataKey="total"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={95}
                  paddingAngle={2}
                >
                  {(monthlyBreakdown?.added ?? []).map((entry, idx) => (
                    <Cell key={`add-${entry.label}`} fill={pieColors[idx % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--t-title)'
                  }}
                  labelStyle={{ color: 'var(--t-muted)' }}
                  itemStyle={{ color: 'var(--t-title)' }}
                  formatter={(value: number) => formatKg(value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="flex flex-col items-center text-center">
          <p className="text-xl font-semibold" style={{ color: 'var(--brand)' }}>
            {'Przemia\u0142y wyrobione w miesi\u0105cu'}
          </p>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={monthlyBreakdown?.removed ?? []}
                  dataKey="total"
                  nameKey="label"
                  innerRadius={50}
                  outerRadius={95}
                  paddingAngle={2}
                >
                  {(monthlyBreakdown?.removed ?? []).map((entry, idx) => (
                    <Cell key={`rem-${entry.label}`} fill={pieColors[idx % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--t-title)'
                  }}
                  labelStyle={{ color: 'var(--t-muted)' }}
                  itemStyle={{ color: 'var(--t-title)' }}
                  formatter={(value: number) => formatKg(value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <p className="text-xl font-semibold" style={{ color: 'var(--brand)' }}>
          {'Przemia\u0142y - stan aktualny'}
        </p>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={currentTotals ?? []} margin={{ top: 10, right: 20, left: 0, bottom: 40 }}>
              <CartesianGrid stroke="var(--border)" />
              <XAxis
                dataKey="label"
                stroke="var(--t-dim)"
                interval={0}
                angle={-20}
                textAnchor="end"
                height={60}
              />
              <YAxis stroke="var(--t-dim)" tickFormatter={(value) => `${value}`} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: 'var(--t-title)'
                }}
                labelStyle={{ color: 'var(--t-muted)' }}
                itemStyle={{ color: 'var(--t-title)' }}
                formatter={(value: number) => formatKg(value)}
                cursor={false}
              />
              <Bar dataKey="total" fill="var(--value-purple)" radius={[4, 4, 0, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

    </div>
  );
}

