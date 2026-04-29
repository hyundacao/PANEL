'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
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
import { Skeleton } from '@/components/ui/Skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { MetricPill } from '@/components/ui/MetricPill';
import { formatKg } from '@/lib/utils/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const rangeOptions = [
  { days: 30, label: '1 miesiac' },
  { days: 90, label: '3 miesiace' },
  { days: 365, label: 'Rok' }
];

const formatCompactKg = (value: number) => {
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return `${(value / 1000000).toFixed(1).replace('.', ',')} mln`;
  if (absValue >= 1000) return `${Math.round(value / 1000).toLocaleString('pl-PL')} tys.`;
  return Math.round(value).toLocaleString('pl-PL');
};

export default function DashboardPage() {
  const today = getTodayKey();
  const [rangeDays, setRangeDays] = useState(30);
  const [activeCompositionIndex, setActiveCompositionIndex] = useState(0);
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
    queryKey: ['material-totals', today, 'company'],
    queryFn: () => getCurrentMaterialTotals('company'),
    refetchInterval: 5000,
    refetchIntervalInBackground: true
  });
  const currentTotal = (currentTotals ?? []).reduce((sum, item) => sum + item.total, 0);
  const currentComposition = useMemo(() => {
    const positive = [...(currentTotals ?? [])]
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);
    const visible = positive.slice(0, 10);
    const remaining = positive.slice(10).reduce((sum, item) => sum + item.total, 0);
    return remaining > 0
      ? [...visible, { materialId: 'other', label: 'Pozostale', total: remaining }]
      : visible;
  }, [currentTotals]);
  const compositionTotal = currentComposition.reduce((sum, item) => sum + item.total, 0);
  const activeComposition = currentComposition[activeCompositionIndex] ?? currentComposition[0] ?? null;
  const activeCompositionPercent =
    activeComposition && compositionTotal > 0 ? (activeComposition.total / compositionTotal) * 100 : 0;
  const pieColors = [
    'var(--brand)',
    'var(--value-purple)',
    'var(--success)',
    'var(--warning)',
    'var(--danger)',
    '#38bdf8',
    '#f472b6',
    '#a3e635',
    '#f97316',
    '#94a3b8',
    '#22d3ee'
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Pulpit"
        subtitle={`Dzi\u015b: ${today}`}
      />

      <Card>
        <div className="grid gap-6 lg:grid-cols-[1.2fr_2fr] lg:gap-8">
          <div className="min-w-0">
            <div>
              <p className="text-lg font-semibold uppercase tracking-wide" style={{ color: 'var(--brand)' }}>
                {'Aktualna ilo\u015b\u0107 przemia\u0142\u00f3w'}
              </p>
              <p
                className="mt-3 break-words text-5xl font-semibold tabular-nums sm:text-6xl xl:text-7xl"
                style={{ color: 'var(--value-purple)' }}
              >
                {formatKg(currentTotal)}
              </p>
              <p className="text-lg">{'Suma stan\u00f3w z ca\u0142ej firmy.'}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-start sm:justify-end">
              <div className="inline-flex w-full rounded-md border border-border bg-[rgba(255,255,255,0.025)] p-1 sm:w-auto">
                {rangeOptions.map((option) => (
                  <button
                    key={option.days}
                    type="button"
                    onClick={() => setRangeDays(option.days)}
                    className={`flex-1 rounded px-3 py-2 text-sm font-semibold transition sm:flex-none ${
                      rangeDays === option.days
                        ? 'bg-[rgba(255,122,26,0.16)] text-title shadow-[inset_0_0_0_1px_rgba(255,122,26,0.55)]'
                        : 'text-dim hover:text-title'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-64 pl-1 pr-2 sm:h-[280px] sm:pr-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={totalsHistory ?? []} margin={{ top: 18, right: 12, left: 8, bottom: 2 }}>
                  <defs>
                    <linearGradient id="totalHistoryFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.34} />
                      <stop offset="70%" stopColor="var(--brand)" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 8" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="var(--t-dim)"
                    tickFormatter={(value) => String(value).slice(5)}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={22}
                  />
                  <YAxis
                    stroke="var(--t-dim)"
                    tickFormatter={(value) => formatCompactKg(typeof value === 'number' ? value : 0)}
                    tickLine={false}
                    axisLine={false}
                    width={54}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--t-title)',
                      boxShadow: '0 18px 45px rgba(0,0,0,0.32)'
                    }}
                    labelStyle={{ color: 'var(--t-muted)' }}
                    itemStyle={{ color: 'var(--t-title)' }}
                    formatter={(value) => formatKg(typeof value === 'number' ? value : 0)}
                    cursor={{ stroke: 'var(--brand)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="var(--brand)"
                    fill="url(#totalHistoryFill)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{
                      r: 5,
                      stroke: 'var(--t-title)',
                      strokeWidth: 2,
                      fill: 'var(--brand)'
                    }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
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
                  formatter={(value) => formatKg(typeof value === 'number' ? value : 0)}
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
                  formatter={(value) => formatKg(typeof value === 'number' ? value : 0)}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xl font-semibold" style={{ color: 'var(--brand)' }}>
                {'Przemia\u0142y - udzia\u0142 w stanie aktualnym'}
              </p>
              <p className="mt-1 text-sm text-dim">
                {'Najwi\u0119ksze pozycje w aktualnym stanie, udzia\u0142 liczony z ca\u0142ej firmy.'}
              </p>
            </div>
            <span className="rounded-[10px] border border-border bg-[rgba(255,255,255,0.03)] px-3 py-1 text-sm font-semibold tabular-nums text-title">
              {formatKg(compositionTotal)}
            </span>
          </div>
          <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(360px,0.95fr)_1.4fr] xl:items-center">
            <div className="relative h-[260px] min-w-0 overflow-hidden sm:h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart onMouseLeave={() => setActiveCompositionIndex(0)}>
                  <Pie
                    data={currentComposition}
                    dataKey="total"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    innerRadius={58}
                    outerRadius={98}
                    paddingAngle={3}
                    cornerRadius={8}
                    startAngle={90}
                    endAngle={-270}
                    stroke="var(--surface-1)"
                    strokeWidth={2}
                    onMouseEnter={(_, index) => setActiveCompositionIndex(index)}
                  >
                    {currentComposition.map((entry, idx) => (
                      <Cell
                        key={`current-${entry.materialId}`}
                        fill={pieColors[idx % pieColors.length]}
                        opacity={!activeComposition || activeCompositionIndex === idx ? 1 : 0.42}
                        stroke={activeCompositionIndex === idx ? 'var(--t-title)' : 'var(--surface-1)'}
                        strokeWidth={activeCompositionIndex === idx ? 3 : 2}
                      />
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
                    formatter={(value) => formatKg(typeof value === 'number' ? value : 0)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-lg font-semibold tabular-nums sm:mt-1 sm:text-sm" style={{ color: 'var(--brand)' }}>
                    {activeComposition ? `${activeCompositionPercent.toFixed(1).replace('.', ',')}%` : '0%'}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {currentComposition.map((entry, idx) => (
                <button
                  key={`legend-${entry.materialId}`}
                  type="button"
                  onMouseEnter={() => setActiveCompositionIndex(idx)}
                  onFocus={() => setActiveCompositionIndex(idx)}
                  className={`min-w-0 rounded-md border p-3 text-left transition ${
                    activeCompositionIndex === idx
                      ? 'border-[var(--brand)] bg-[rgba(255,122,26,0.08)]'
                      : 'border-border bg-[rgba(255,255,255,0.02)] hover:border-borderStrong'
                  }`}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ background: pieColors[idx % pieColors.length] }}
                      />
                      <span className="truncate text-sm font-semibold text-body">{entry.label}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-dim">
                      {compositionTotal > 0
                        ? `${((entry.total / compositionTotal) * 100).toFixed(1).replace('.', ',')}%`
                        : '0%'}
                    </span>
                  </span>
                  <span className="mt-2 block text-sm tabular-nums text-title">{formatKg(entry.total)}</span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${compositionTotal > 0 ? Math.max((entry.total / compositionTotal) * 100, 2) : 0}%`,
                        background: pieColors[idx % pieColors.length]
                      }}
                    />
                  </span>
                </button>
              ))}
              {currentComposition.length === 0 && (
                <p className="text-sm text-dim">Brak dodatnich stanow.</p>
              )}
            </div>
          </div>
        </Card>
      </div>

    </div>
  );
}

