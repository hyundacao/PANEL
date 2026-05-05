'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, CalendarDays, Check, ChevronDown, ChevronUp, Cuboid, Factory, Layers3 } from 'lucide-react';
import {
  getCurrentMaterialTotals,
  getDashboard,
  getDashboardMonthStats,
  getTodayKey,
  getTopCatalogTotal,
  getTotalsHistory
} from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatKg } from '@/lib/utils/format';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const rangeOptions = [
  { days: 30, label: '1 miesiąc' },
  { days: 90, label: '3 miesiące' },
  { days: 365, label: 'Rok' }
];

const monthLabels = [
  'STYCZEŃ',
  'LUTY',
  'MARZEC',
  'KWIECIEŃ',
  'MAJ',
  'CZERWIEC',
  'LIPIEC',
  'SIERPIEŃ',
  'WRZESIEŃ',
  'PAŹDZIERNIK',
  'LISTOPAD',
  'GRUDZIEŃ'
];

const chartColors = [
  '#ff6a00',
  '#7c5cff',
  '#58d26d',
  '#19c9ff',
  '#ef4444',
  '#f6a600',
  '#268cff',
  '#6db85d',
  '#f472b6',
  '#94a3b8'
];

const hallColors = ['#a855f7', '#22a7ff', '#22c55e', '#22d3ee'];

const tooltipStyle = {
  background: 'rgba(6, 10, 18, 0.98)',
  border: '1px solid rgba(255, 106, 0, 0.35)',
  borderRadius: 8,
  color: 'var(--t-title)',
  boxShadow: '0 20px 55px rgba(0,0,0,0.45)'
};

const formatCompactKg = (value: number) => {
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return `${(value / 1000000).toFixed(1).replace('.', ',')} mln`;
  if (absValue >= 1000) return `${Math.round(value / 1000).toLocaleString('pl-PL')} tys.`;
  return Math.round(value).toLocaleString('pl-PL');
};

const formatPercent = (value: number) => `${value.toFixed(1).replace('.', ',')}%`;

const percentWidth = (value: number, total: number) => (total > 0 ? Math.max((value / total) * 100, 3) : 0);

const getMonthRange = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  const format = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { from: format(start), to: format(end) };
};

const formatMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return `${monthLabels[month - 1]} ${year}`;
};

const buildMonthOptions = (currentMonthKey: string) => {
  const [year, month] = currentMonthKey.split('-').map(Number);
  return Array.from({ length: 18 }, (_, index) => {
    const date = new Date(year, month - 1 - index, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: formatMonthLabel(key) };
  });
};

const GlowPanel = ({
  children,
  className = ''
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <Card
    className={`relative overflow-hidden rounded-lg border-[rgba(34,76,142,0.5)] bg-[linear-gradient(145deg,rgba(6,11,22,0.98),rgba(2,5,11,0.99))] p-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_22px_rgba(20,82,160,0.08),0_16px_60px_-54px_rgba(0,102,255,0.55)] hover:border-[rgba(255,106,0,0.36)] ${className}`}
  >
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(60,120,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,106,0,0.018)_1px,transparent_1px)] bg-[size:30px_30px] opacity-25" />
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,106,0,0.62),rgba(45,108,223,0.68),transparent)]" />
    <div className="pointer-events-none absolute left-0 top-0 h-9 w-9 border-l border-t border-[rgba(255,106,0,0.38)]" />
    <div className="pointer-events-none absolute bottom-0 right-0 h-9 w-9 border-b border-r border-[rgba(45,108,223,0.55)]" />
    <div className="relative h-full">{children}</div>
  </Card>
);

const PanelTitle = ({
  icon,
  title,
  subtitle
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) => (
  <div className="flex min-w-0 items-center gap-2">
    <span className="shrink-0 text-[var(--brand)]">{icon}</span>
    <div className="min-w-0">
      <h2 className="truncate text-base font-semibold text-title md:text-lg">{title}</h2>
      {subtitle && <p className="truncate text-xs text-dim">{subtitle}</p>}
    </div>
  </div>
);

const KpiPanel = ({
  label,
  value,
  color,
  trend
}: {
  label: string;
  value: string;
  color: string;
  trend: 'up' | 'down';
}) => (
  <div
    className="relative overflow-hidden rounded-lg border p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] 2xl:p-3"
    style={{
      borderColor: `${color}66`,
      background: `linear-gradient(145deg, ${color}22, rgba(255,255,255,0.025))`
    }}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-dim">{label}</p>
        <p className="mt-1 truncate text-lg font-semibold tabular-nums text-title 2xl:text-2xl">{value}</p>
      </div>
      <span
        className="shrink-0 rounded-full border p-1"
        style={{ color, borderColor: `${color}70`, boxShadow: `0 0 20px ${color}33` }}
      >
        {trend === 'up' ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </span>
    </div>
  </div>
);

export default function DashboardPage() {
  const today = getTodayKey();
  const currentMonthKey = today.slice(0, 7);
  const [rangeDays, setRangeDays] = useState(30);
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [activeCompositionIndex, setActiveCompositionIndex] = useState(0);
  const selectedMonthRange = useMemo(() => getMonthRange(selectedMonth), [selectedMonth]);
  const monthOptions = useMemo(() => buildMonthOptions(currentMonthKey), [currentMonthKey]);
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
  const { data: monthStats } = useQuery({
    queryKey: ['dashboard-month-stats', selectedMonthRange.from, selectedMonthRange.to],
    queryFn: () => getDashboardMonthStats(selectedMonthRange.from, selectedMonthRange.to)
  });
  const { data: currentTotals } = useQuery({
    queryKey: ['material-totals', today, 'company'],
    queryFn: () => getCurrentMaterialTotals('company'),
    refetchInterval: 5000,
    refetchIntervalInBackground: true
  });

  const currentTotal = (currentTotals ?? []).reduce((sum, item) => sum + item.total, 0);
  const currentComposition = useMemo(() => {
    return [...(currentTotals ?? [])]
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [currentTotals]);
  const compositionTotal = currentComposition.reduce((sum, item) => sum + item.total, 0);
  const monthlyAdded = monthStats?.added ?? 0;
  const monthlyRemoved = monthStats?.removed ?? 0;
  const monthlyNet = monthStats?.net ?? monthlyAdded - monthlyRemoved;
  const maxHallMove = Math.max(1, ...(dashboard ?? []).map((item) => Math.max(item.added, item.removed)));
  const maxMaterialTotal = Math.max(1, ...currentComposition.map((item) => item.total));

  return (
    <div className="space-y-2 md:space-y-2.5">
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-45">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,106,0,0.12),transparent_28%),radial-gradient(circle_at_78%_18%,rgba(45,108,223,0.12),transparent_30%),linear-gradient(135deg,rgba(5,8,15,0.2),rgba(3,5,10,0.75))]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(60,120,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,106,0,0.026)_1px,transparent_1px)] bg-[size:58px_58px]" />
      </div>

      <div className="grid gap-2.5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1fr)] xl:items-stretch">
        <GlowPanel className="min-h-[320px] xl:h-[280px] 2xl:h-[310px]">
          <div className="flex h-full flex-col p-3 md:p-3.5">
            <PanelTitle icon={<Cuboid size={19} />} title="Stan aktualny" />
            <div className="relative mt-2 flex min-h-0 flex-1 flex-col justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgba(255,106,0,0.15),transparent_42%)] px-2 py-4 md:px-7">
              <div className="pointer-events-none absolute inset-x-16 bottom-2 h-[2px] bg-[linear-gradient(90deg,transparent,#ff6a00,transparent)] shadow-[0_0_16px_#ff6a00]" />
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_0,rgba(255,106,0,0.06)_48%,transparent_52%)]" />
              <p
                className="text-center text-6xl font-semibold leading-[1.08] tracking-wide tabular-nums text-[var(--brand)] sm:text-7xl xl:text-[82px] 2xl:text-[104px]"
                style={{ textShadow: '0 0 8px rgba(255,106,0,0.78), 0 0 22px rgba(255,106,0,0.38)' }}
              >
                {currentTotal.toLocaleString('pl-PL')}{' '}
                <span className="align-baseline text-3xl md:text-4xl">kg</span>
              </p>
              <div className="mt-3 flex flex-col items-center gap-1 text-[11px] text-dim sm:flex-row sm:justify-center sm:gap-5 2xl:text-xs">
                <span className="inline-flex items-center gap-2">
                  <Building2 size={15} /> Cała firma
                </span>
                <span className="min-w-0 text-center">
                  Największa kartoteka:{' '}
                  <span className="font-semibold text-[var(--brand)]">{topCatalog?.catalog ?? 'Brak danych'}</span>
                </span>
              </div>
            </div>
          </div>
        </GlowPanel>

        <GlowPanel className="xl:h-[280px] 2xl:h-[310px]">
          <div className="flex h-full flex-col p-3 md:p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <PanelTitle icon={<CalendarDays size={18} />} title="Historia stanu" />
              <div className="inline-flex w-full rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.028)] p-1 sm:w-auto">
                {rangeOptions.map((option) => (
                  <button
                    key={option.days}
                    type="button"
                    onClick={() => setRangeDays(option.days)}
                    className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition sm:flex-none ${
                      rangeDays === option.days
                        ? 'bg-[rgba(255,106,0,0.18)] text-title shadow-[inset_0_0_0_1px_rgba(255,106,0,0.65),0_0_18px_-8px_rgba(255,106,0,0.9)]'
                        : 'text-dim hover:text-title'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 h-[190px] min-h-0 xl:flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={totalsHistory ?? []} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashboardTotalFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ff6a00" stopOpacity={0.42} />
                      <stop offset="72%" stopColor="#ff6a00" stopOpacity={0.09} />
                      <stop offset="100%" stopColor="#ff6a00" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 8" vertical={false} />
                  <XAxis dataKey="date" stroke="var(--t-dim)" tickFormatter={(value) => String(value).slice(5)} tickLine={false} axisLine={false} minTickGap={18} />
                  <YAxis stroke="var(--t-dim)" tickFormatter={(value) => formatCompactKg(Number(value))} tickLine={false} axisLine={false} width={52} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => formatKg(typeof value === 'number' ? value : 0)} />
                  <Area type="monotone" dataKey="total" stroke="#ff6a00" fill="url(#dashboardTotalFill)" strokeWidth={3} dot={false} activeDot={{ r: 5, stroke: 'var(--t-title)', strokeWidth: 2, fill: '#ff6a00' }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </GlowPanel>
      </div>

      <div className="space-y-2.5">
        <GlowPanel className="xl:h-[226px] 2xl:h-[250px]">
          <div className="flex h-full flex-col p-3 md:p-3.5">
            <PanelTitle icon={<Building2 size={18} />} title="Dzisiaj - hale" />
            <div className="mt-3 grid min-h-0 flex-1 auto-rows-fr gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
              {isLoading &&
                Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`s-${idx}`} className="rounded-lg border border-border p-4">
                    <Skeleton className="h-28 w-full" />
                  </div>
                ))}
              {dashboard?.map((item, index) => {
                const color = hallColors[index % hallColors.length];
                const balance = item.added - item.removed;
                return (
                  <div
                    key={item.warehouseId}
                    className="relative flex h-full min-h-[118px] flex-col justify-between overflow-hidden rounded-lg border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] 2xl:min-h-[132px] 2xl:p-4"
                    style={{
                      borderColor: `${color}55`,
                      background: `linear-gradient(150deg, ${color}18, rgba(255,255,255,0.018))`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 42px -36px ${color}`
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Factory size={17} style={{ color }} />
                      <p className="truncate text-sm font-semibold text-title">{item.warehouseName}</p>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {[
                        { label: 'Przybyło', value: item.added, color },
                        { label: 'Wyrobiono', value: item.removed, color },
                        { label: 'Bilans', value: Math.abs(balance), color, prefix: balance >= 0 ? '+' : '-' }
                      ].map((row) => (
                        <div key={row.label}>
                          <div className="flex items-center justify-between gap-3 text-[11px] 2xl:text-xs">
                            <span className="text-dim">{row.label}</span>
                            <span className="font-semibold tabular-nums text-title">
                              {row.prefix}
                              {formatKg(row.value)}
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)] 2xl:h-2">
                            <div className="h-full rounded-full" style={{ width: `${percentWidth(row.value, maxHallMove)}%`, background: row.color, boxShadow: `0 0 16px ${row.color}` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </GlowPanel>

        <GlowPanel className="min-h-[210px] overflow-visible xl:h-[210px] 2xl:h-[230px]">
          <div className="flex h-full flex-col p-3 md:p-4">
            <div className="flex w-full justify-center">
              <details className="group relative z-20 w-full">
                <summary className="flex h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-lg border border-[rgba(255,106,0,0.32)] bg-[linear-gradient(145deg,rgba(255,106,0,0.14),rgba(45,108,223,0.06))] px-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_22px_55px_-38px_rgba(255,106,0,0.95)] transition hover:border-[rgba(255,106,0,0.6)]">
                  <span className="flex min-w-0 items-center gap-3">
                    <CalendarDays size={20} className="shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase text-dim">Miesiąc</span>
                      <span className="block truncate text-xl font-semibold text-title md:text-2xl">{formatMonthLabel(selectedMonth)}</span>
                    </span>
                  </span>
                  <ChevronDown size={22} className="shrink-0 text-[var(--brand)] transition group-open:rotate-180" />
                </summary>
                <div className="absolute left-0 top-[72px] max-h-[360px] w-full overflow-auto rounded-lg border border-[rgba(255,106,0,0.34)] bg-[rgba(5,9,17,0.98)] p-2 shadow-[0_26px_80px_rgba(0,0,0,0.66),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur">
                  {monthOptions.map((option) => {
                    const isActive = option.key === selectedMonth;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={(event) => {
                          setSelectedMonth(option.key);
                          event.currentTarget.closest('details')?.removeAttribute('open');
                        }}
                        className={`flex w-full items-center justify-between gap-3 rounded-md px-4 py-3 text-left text-base font-semibold transition ${
                          isActive
                            ? 'bg-[rgba(255,106,0,0.18)] text-[var(--brand)] shadow-[inset_3px_0_0_#ff6a00]'
                            : 'text-body hover:bg-[rgba(255,255,255,0.055)] hover:text-title'
                        }`}
                      >
                        <span>{option.label}</span>
                        {isActive && <Check size={15} />}
                      </button>
                    );
                  })}
                </div>
              </details>
            </div>

            <div className="mt-4 grid w-full gap-2.5 md:grid-cols-3">
              <KpiPanel label="Przybyło" value={formatKg(monthlyAdded)} color="#ef4444" trend="up" />
              <KpiPanel label="Wyrobiono" value={formatKg(monthlyRemoved)} color="#22c55e" trend="down" />
              <KpiPanel
                label="Bilans"
                value={`${monthlyNet >= 0 ? '+' : '-'}${formatKg(Math.abs(monthlyNet))}`}
                color={monthlyNet <= 0 ? '#22c55e' : '#ef4444'}
                trend={monthlyNet <= 0 ? 'down' : 'up'}
              />
            </div>
          </div>
        </GlowPanel>
      </div>

      <GlowPanel className="min-h-[430px]">
        <div className="flex h-full flex-col p-3 md:p-3.5">
          <PanelTitle icon={<Layers3 size={18} />} title="Struktura materiałów" subtitle="aktualny stan" />
          <div className="mt-3 min-h-0 flex-1">
            <div className="min-h-0 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.025)]">
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 border-b border-border px-3 py-2.5 text-[11px] font-semibold text-dim md:grid-cols-[minmax(260px,1.35fr)_minmax(180px,0.95fr)_120px_90px] md:gap-4 md:px-4 2xl:text-xs">
                <span>Materiał</span>
                <span className="text-right md:hidden">Kg</span>
                <span className="hidden md:block"></span>
                <span className="text-right">Ilość</span>
                <span className="text-right">Udział</span>
              </div>
              <div className="divide-y divide-border">
                {currentComposition.map((entry, index) => {
                  const percent = compositionTotal > 0 ? (entry.total / compositionTotal) * 100 : 0;
                  const color = chartColors[index % chartColors.length];
                  return (
                    <button
                      key={`row-${entry.materialId}`}
                      type="button"
                      onMouseEnter={() => setActiveCompositionIndex(index)}
                      onFocus={() => setActiveCompositionIndex(index)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_96px] items-center gap-3 px-3 py-2.5 text-left transition md:grid-cols-[minmax(260px,1.35fr)_minmax(180px,0.95fr)_120px_90px] md:gap-4 md:px-4 ${
                        activeCompositionIndex === index ? 'bg-[rgba(255,106,0,0.08)]' : 'hover:bg-[rgba(255,255,255,0.035)]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
                          <span className="truncate text-sm font-semibold text-body">{entry.label}</span>
                        </span>
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)] md:hidden">
                          <span className="block h-full rounded-full" style={{ width: `${percentWidth(entry.total, maxMaterialTotal)}%`, background: color, boxShadow: `0 0 14px ${color}` }} />
                        </span>
                      </span>
                      <span className="hidden h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)] md:block">
                        <span className="block h-full rounded-full" style={{ width: `${percentWidth(entry.total, maxMaterialTotal)}%`, background: color, boxShadow: `0 0 14px ${color}` }} />
                      </span>
                      <span className="text-right text-sm font-semibold tabular-nums text-title">{entry.total.toLocaleString('pl-PL')} kg</span>
                      <span className="hidden text-right text-sm font-semibold tabular-nums text-title md:block">{formatPercent(percent)}</span>
                    </button>
                  );
                })}
                {currentComposition.length === 0 && <p className="px-3 py-4 text-sm text-dim">Brak dodatnich stanów.</p>}
              </div>
            </div>
          </div>
        </div>
      </GlowPanel>
    </div>
  );
}
