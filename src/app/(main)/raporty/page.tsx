'use client';

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDailyHistory, getPeriodReport, getReports, getYearlyReport } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { formatKg } from '@/lib/utils/format';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const dailyReportExcludePatterns = [/^ABS\s*30\//i];
const REPORTS_TAB_STORAGE_KEY = 'raporty-tab';
const chartColors = [
  'var(--brand)',
  'var(--value-purple)',
  'var(--success)',
  'var(--danger)',
  '#38bdf8',
  '#f472b6',
  '#a3e635',
  '#f59e0b',
  '#94a3b8',
  '#22d3ee'
];

type SummaryMode = 'weekly' | 'monthly' | 'yearly';
type ReportTab = 'daily' | 'summary' | 'overall';
type SortKey = 'alpha' | 'added' | 'removed';
type FlowItem = {
  label: string;
  added: number;
  removed: number;
  net: number;
  addedComments?: string[];
  removedComments?: string[];
};
type PieItem = {
  label: string;
  value: number;
  color: string;
};

const parseDateKey = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekRange = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: formatDateKey(start), to: formatDateKey(end) };
};

const getMonthRange = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: formatDateKey(start), to: formatDateKey(end) };
};

const getYearRange = (dateKey: string) => {
  const date = parseDateKey(dateKey);
  const start = new Date(date.getFullYear(), 0, 1);
  const end = new Date(date.getFullYear(), 11, 31);
  return { from: formatDateKey(start), to: formatDateKey(end) };
};

const formatCompactKg = (value: number) => {
  const absValue = Math.abs(value);
  if (absValue >= 1000000) return `${(value / 1000000).toFixed(1).replace('.', ',')} mln`;
  if (absValue >= 1000) return `${Math.round(value / 1000).toLocaleString('pl-PL')} tys.`;
  return Math.round(value).toLocaleString('pl-PL');
};

const formatPercent = (value: number) => `${value.toFixed(1).replace('.', ',')}%`;

const formatDelta = (value: number) => `${value >= 0 ? '+' : '-'}${formatKg(Math.abs(value))}`;

const buildPieItems = <T extends { label: string }>(
  rows: T[],
  getValue: (row: T) => number,
  limit = 8
): PieItem[] => {
  const sorted = rows
    .map((row) => ({ label: row.label, value: Math.max(0, getValue(row)) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const visible = sorted.slice(0, limit);
  const other = sorted.slice(limit).reduce((sum, row) => sum + row.value, 0);
  const output = other > 0 ? [...visible, { label: 'Pozostałe', value: other }] : visible;
  return output.map((row, index) => ({
    ...row,
    color: chartColors[index % chartColors.length]
  }));
};

const EmptyState = ({ children }: { children: ReactNode }) => (
  <Card className="border-dashed bg-[rgba(255,255,255,0.015)]">
    <p className="text-sm text-muted">{children}</p>
  </Card>
);

const MetricTile = ({
  label,
  value,
  tone = 'neutral',
  note
}: {
  label: string;
  value: string;
  tone?: 'added' | 'removed' | 'net' | 'neutral';
  note?: string;
}) => {
  const color =
    tone === 'added'
      ? 'var(--danger)'
      : tone === 'removed'
        ? 'var(--success)'
        : tone === 'net'
          ? 'var(--brand)'
          : 'var(--t-title)';
  return (
    <div className="rounded-xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.055),rgba(255,255,255,0.018))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tabular-nums text-title sm:text-3xl" style={{ color }}>
        {value}
      </p>
      {note && <p className="mt-2 text-xs text-dim">{note}</p>}
    </div>
  );
};

const ReportToolbar = ({
  summaryMode,
  summaryRange,
  rangeFrom,
  rangeTo,
  canExport,
  onPreset,
  onFromChange,
  onToChange,
  onCsv,
  onExcel,
  onPdf
}: {
  summaryMode: SummaryMode;
  summaryRange: string;
  rangeFrom: string;
  rangeTo: string;
  canExport: boolean;
  onPreset: (mode: SummaryMode) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onCsv: () => void;
  onExcel: () => void;
  onPdf: () => void;
}) => (
  <Card className="overflow-hidden p-0">
    <div className="border-b border-border bg-[linear-gradient(135deg,rgba(255,122,26,0.16),rgba(124,90,255,0.08)_42%,rgba(255,255,255,0.02))] p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-dim">Kreator raportu</p>
          <h2 className="mt-1 text-2xl font-semibold text-title">Zakres i eksport</h2>
        </div>
        {summaryRange && (
          <span className="rounded-lg border border-[rgba(255,122,26,0.35)] bg-[rgba(255,122,26,0.08)] px-3 py-2 text-sm font-semibold text-title">
            {summaryRange}
          </span>
        )}
      </div>
    </div>
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex flex-wrap gap-2">
        {[
          { mode: 'weekly' as const, label: 'Tydzień' },
          { mode: 'monthly' as const, label: 'Miesiąc' },
          { mode: 'yearly' as const, label: 'Rok' }
        ].map((option) => (
          <Button
            key={option.mode}
            variant={summaryMode === option.mode ? 'secondary' : 'outline'}
            onClick={() => onPreset(option.mode)}
            className={
              summaryMode === option.mode
                ? 'min-h-[44px] rounded-lg bg-[rgba(255,122,26,0.18)] text-title ring-2 ring-[rgba(255,122,26,0.45)]'
                : 'min-h-[44px] rounded-lg'
            }
          >
            {option.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-dim">Od</span>
            <Input type="date" value={rangeFrom} onChange={(event) => onFromChange(event.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-dim">Do</span>
            <Input type="date" value={rangeTo} onChange={(event) => onToChange(event.target.value)} />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:w-[520px]">
          <Button variant="primaryEmber" onClick={onCsv} disabled={!canExport} className="min-h-[46px]">
            CSV
          </Button>
          <Button variant="primaryEmber" onClick={onExcel} disabled={!canExport} className="min-h-[46px]">
            Excel
          </Button>
          <Button variant="primaryEmber" onClick={onPdf} disabled={!canExport} className="min-h-[46px]">
            PDF
          </Button>
        </div>
      </div>
    </div>
  </Card>
);

const DonutPanel = ({
  title,
  subtitle,
  items,
  total,
  emptyLabel
}: {
  title: string;
  subtitle: string;
  items: PieItem[];
  total: number;
  emptyLabel: string;
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeItem = items[activeIndex] ?? items[0] ?? null;
  const activePercent = activeItem && total > 0 ? (activeItem.value / total) * 100 : 0;

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-title">{title}</h3>
            <p className="mt-1 text-sm text-dim">{subtitle}</p>
          </div>
          <span className="rounded-lg border border-border bg-[rgba(255,255,255,0.035)] px-3 py-1.5 text-sm font-semibold tabular-nums text-title">
            {formatKg(total)}
          </span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="p-5 text-sm text-muted">{emptyLabel}</div>
      ) : (
        <div className="grid min-w-0 gap-4 p-4 md:p-5 xl:grid-cols-[320px_1fr] xl:items-center">
          <div className="relative h-[260px] min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart onMouseLeave={() => setActiveIndex(0)}>
                <Pie
                  data={items}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={102}
                  paddingAngle={3}
                  cornerRadius={9}
                  startAngle={90}
                  endAngle={-270}
                  stroke="var(--surface-1)"
                  strokeWidth={2}
                  onMouseEnter={(_, index) => setActiveIndex(index)}
                  isAnimationActive={false}
                >
                  {items.map((entry, index) => (
                    <Cell
                      key={`${title}-${entry.label}`}
                      fill={entry.color}
                      opacity={activeIndex === index ? 1 : 0.48}
                      stroke={activeIndex === index ? 'var(--t-title)' : 'var(--surface-1)'}
                      strokeWidth={activeIndex === index ? 3 : 2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--t-title)',
                    boxShadow: '0 18px 45px rgba(0,0,0,0.32)'
                  }}
                  formatter={(value) => formatKg(typeof value === 'number' ? value : 0)}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="max-w-[150px] text-center">
                <p className="truncate text-xs font-semibold uppercase text-dim">{activeItem?.label ?? 'Brak danych'}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-title">{formatKg(activeItem?.value ?? 0)}</p>
                <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--brand)' }}>
                  {formatPercent(activePercent)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-2">
            {items.map((entry, index) => {
              const percent = total > 0 ? (entry.value / total) * 100 : 0;
              return (
                <button
                  key={`${title}-legend-${entry.label}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onFocus={() => setActiveIndex(index)}
                  className={`min-w-0 rounded-lg border p-3 text-left transition ${
                    activeIndex === index
                      ? 'border-[var(--brand)] bg-[rgba(255,122,26,0.1)]'
                      : 'border-border bg-[rgba(255,255,255,0.025)] hover:border-borderStrong'
                  }`}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: entry.color }} />
                      <span className="truncate text-sm font-semibold text-body">{entry.label}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-dim">{formatPercent(percent)}</span>
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.max(percent, 2)}%`, background: entry.color }}
                    />
                  </span>
                  <span className="mt-1 block text-sm font-semibold tabular-nums text-title">{formatKg(entry.value)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};

const FlowList = ({
  title,
  rows,
  emptyLabel,
  maxRows = 18
}: {
  title: string;
  rows: FlowItem[];
  emptyLabel: string;
  maxRows?: number;
}) => {
  const visibleRows = rows.slice(0, maxRows);
  const maxValue = Math.max(1, ...visibleRows.map((row) => Math.max(row.added, row.removed, Math.abs(row.net))));

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4 md:p-5">
        <h3 className="text-lg font-semibold text-title">{title}</h3>
        <p className="mt-1 text-sm text-dim">Materiały posortowane po największym ruchu.</p>
      </div>
      {visibleRows.length === 0 ? (
        <div className="p-5 text-sm text-muted">{emptyLabel}</div>
      ) : (
        <div className="divide-y divide-border">
          {visibleRows.map((row, index) => {
            const leading = Math.max(row.added, row.removed, Math.abs(row.net));
            return (
              <div key={`${row.label}-${index}`} className="grid gap-3 p-4 md:grid-cols-[minmax(220px,1.3fr)_1fr] md:items-center md:p-5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-title" title={row.label}>
                    {row.label}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--value-purple))]"
                      style={{ width: `${Math.max((leading / maxValue) * 100, 3)}%` }}
                    />
                  </div>
                  {(row.addedComments?.length || row.removedComments?.length) ? (
                    <p className="mt-2 line-clamp-2 text-xs text-dim">
                      {[...(row.addedComments ?? []), ...(row.removedComments ?? [])].join(', ')}
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2 text-right">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Przybyło</p>
                    <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--danger)' }}>
                      {formatKg(row.added)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Wyrobiono</p>
                    <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--success)' }}>
                      {formatKg(row.removed)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">Wynik</p>
                    <p className="text-sm font-semibold tabular-nums text-title">{formatKg(row.net)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default function ReportsPage() {
  const { data } = useQuery({ queryKey: ['reports'], queryFn: getReports });
  const { data: history } = useQuery({ queryKey: ['daily-history'], queryFn: getDailyHistory });
  const [summaryMode, setSummaryMode] = useState<SummaryMode>('weekly');
  const [activeTab, setActiveTab] = useState<ReportTab>(() => {
    if (typeof window === 'undefined') return 'daily';
    const saved = window.localStorage.getItem(REPORTS_TAB_STORAGE_KEY);
    return saved === 'daily' || saved === 'summary' || saved === 'overall' ? saved : 'daily';
  });
  const [dailySort, setDailySort] = useState<{
    key: SortKey;
    direction: 'asc' | 'desc';
  }>({ key: 'alpha', direction: 'asc' });
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [overallYear, setOverallYear] = useState(() => new Date().getFullYear());
  const collator = useMemo(() => new Intl.Collator('pl', { sensitivity: 'base' }), []);
  const { data: periodReport } = useQuery({
    queryKey: ['report-period', rangeFrom, rangeTo],
    queryFn: () => getPeriodReport(rangeFrom, rangeTo),
    enabled: Boolean(rangeFrom && rangeTo)
  });
  const { data: yearlyReport } = useQuery({
    queryKey: ['report-yearly', rangeFrom, rangeTo],
    queryFn: () => getYearlyReport(rangeFrom, rangeTo),
    enabled: summaryMode === 'yearly' && Boolean(rangeFrom && rangeTo)
  });
  const overallYearFrom = `${overallYear}-01-01`;
  const overallYearTo = `${overallYear}-12-31`;
  const previousYear = overallYear - 1;
  const previousYearFrom = `${previousYear}-01-01`;
  const previousYearTo = `${previousYear}-12-31`;
  const { data: overallYearReport } = useQuery({
    queryKey: ['report-yearly-overall', overallYear],
    queryFn: () => getYearlyReport(overallYearFrom, overallYearTo)
  });
  const { data: overallYearMaterialReport } = useQuery({
    queryKey: ['report-period-overall', overallYearFrom, overallYearTo],
    queryFn: () => getPeriodReport(overallYearFrom, overallYearTo)
  });
  const { data: previousYearReport } = useQuery({
    queryKey: ['report-yearly-overall', previousYear],
    queryFn: () => getYearlyReport(previousYearFrom, previousYearTo)
  });

  const summaryRows = periodReport?.rows ?? [];
  const summaryTotals = periodReport?.totals;
  const summaryRange =
    rangeFrom && rangeTo ? (rangeFrom <= rangeTo ? `${rangeFrom} - ${rangeTo}` : `${rangeTo} - ${rangeFrom}`) : '';
  const latestDate = history?.[0]?.date;
  const exportTitle =
    summaryMode === 'weekly' ? 'Raport tygodniowy' : summaryMode === 'monthly' ? 'Raport miesięczny' : 'Raport roczny';

  const applyPreset = (mode: SummaryMode) => {
    setSummaryMode(mode);
    const anchor = latestDate ?? formatDateKey(new Date());
    const range =
      mode === 'weekly' ? getWeekRange(anchor) : mode === 'monthly' ? getMonthRange(anchor) : getYearRange(anchor);
    setRangeFrom(range.from);
    setRangeTo(range.to);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(REPORTS_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (rangeFrom || rangeTo || !latestDate) return;
    const timer = setTimeout(() => {
      const range = getWeekRange(latestDate);
      setSummaryMode('weekly');
      setRangeFrom(range.from);
      setRangeTo(range.to);
    }, 0);
    return () => clearTimeout(timer);
  }, [latestDate, rangeFrom, rangeTo]);

  const safeFilename = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  const escapeHtml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  const buildCsv = (headers: string[], rows: string[][]) => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    return [headers, ...rows].map((row) => row.map(escape).join(';')).join('\r\n');
  };

  const buildHtmlTable = (headers: string[], rows: string[][], subtitle?: string) => {
    const head = headers
      .map((col) => `<th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">${escapeHtml(col)}</th>`)
      .join('');
    const body = rows
      .map(
        (row) =>
          `<tr>${row
            .map((cell) => `<td style="padding:6px 8px;border:1px solid #ddd;">${escapeHtml(cell)}</td>`)
            .join('')}</tr>`
      )
      .join('');
    const subtitleHtml = subtitle ? `<p style="margin:0 0 12px 0;color:#666;">${escapeHtml(subtitle)}</p>` : '';
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(exportTitle)}</title>
  </head>
  <body style="font-family:Arial, sans-serif;margin:24px;">
    <h2 style="margin:0 0 8px 0;">${escapeHtml(exportTitle)}</h2>
    ${subtitleHtml}
    <table style="border-collapse:collapse;width:100%;">${`<tr>${head}</tr>`}${body}</table>
  </body>
</html>`;
  };

  const downloadFile = (content: string, mime: string, filename: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const yearlyRows = yearlyReport?.rows ?? [];
  const canExport = summaryMode === 'yearly' ? yearlyRows.length > 0 : summaryRows.length > 0;

  const getExportData = () => {
    if (summaryMode === 'yearly') {
      const rows = yearlyRows.map((row) => [row.month, String(row.added), String(row.removed), String(row.net)]);
      const totalsRow = [
        'SUMA',
        String(yearlyReport?.totals.added ?? 0),
        String(yearlyReport?.totals.removed ?? 0),
        String(yearlyReport?.totals.net ?? 0)
      ];
      return {
        headers: ['Miesiąc', 'Przybyło (kg)', 'Wyrobiono (kg)', 'Wynik (kg)'],
        rows: [...rows, totalsRow]
      };
    }

    const rows = summaryRows.map((row) =>
      summaryMode === 'weekly'
        ? [
            row.label,
            String(row.added),
            String(row.removed),
            String(row.net),
            (row.addedComments ?? []).join(', '),
            (row.removedComments ?? []).join(', ')
          ]
        : [row.label, String(row.added), String(row.removed), String(row.net)]
    );
    const totalsRow =
      summaryMode === 'weekly'
        ? [
            'SUMA',
            String(summaryTotals?.added ?? 0),
            String(summaryTotals?.removed ?? 0),
            String(summaryTotals?.net ?? 0),
            '',
            ''
          ]
        : [
            'SUMA',
            String(summaryTotals?.added ?? 0),
            String(summaryTotals?.removed ?? 0),
            String(summaryTotals?.net ?? 0)
          ];
    return {
      headers:
        summaryMode === 'weekly'
          ? ['Przemiał', 'Przybyło (kg)', 'Wyrobiono (kg)', 'Wynik (kg)', 'Komentarze przybyło', 'Komentarze wyrobiono']
          : ['Przemiał', 'Przybyło (kg)', 'Wyrobiono (kg)', 'Wynik (kg)'],
      rows: [...rows, totalsRow]
    };
  };

  const handleExportCsv = () => {
    if (!canExport) return;
    const { headers, rows } = getExportData();
    const suffix = safeFilename(summaryRange || summaryMode || 'raport');
    downloadFile(buildCsv(headers, rows), 'text/csv;charset=utf-8', `raport_${summaryMode}_${suffix}.csv`);
  };

  const handleExportExcel = () => {
    if (!canExport) return;
    const { headers, rows } = getExportData();
    const suffix = safeFilename(summaryRange || summaryMode || 'raport');
    downloadFile(
      buildHtmlTable(headers, rows, summaryRange ? `Zakres: ${summaryRange}` : undefined),
      'application/vnd.ms-excel;charset=utf-8',
      `raport_${summaryMode}_${suffix}.xls`
    );
  };

  const handleExportPdf = () => {
    if (!canExport) return;
    const { headers, rows } = getExportData();
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;
    printWindow.document.write(buildHtmlTable(headers, rows, summaryRange ? `Zakres: ${summaryRange}` : undefined));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };

  const dailyRows = useMemo(() => {
    const rows = [...(data ?? [])]
      .filter((row) => !dailyReportExcludePatterns.some((pattern) => pattern.test(row.name)))
      .map((row) => ({
        label: row.name,
        added: row.added,
        removed: row.removed,
        net: row.net
      }));
    const compareAlpha = (a: FlowItem, b: FlowItem) => collator.compare(a.label, b.label);
    if (dailySort.key === 'added') {
      const dir = dailySort.direction === 'asc' ? 1 : -1;
      rows.sort((a, b) => dir * (a.added - b.added) || compareAlpha(a, b));
      return rows;
    }
    if (dailySort.key === 'removed') {
      const dir = dailySort.direction === 'asc' ? 1 : -1;
      rows.sort((a, b) => dir * (a.removed - b.removed) || compareAlpha(a, b));
      return rows;
    }
    rows.sort(dailySort.direction === 'asc' ? compareAlpha : (a, b) => compareAlpha(b, a));
    return rows;
  }, [collator, dailySort, data]);

  const handleDailySort = (key: SortKey) => {
    setDailySort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'alpha' ? 'asc' : 'desc' };
    });
  };

  const dailyTotals = dailyRows.reduce(
    (acc, row) => ({
      added: acc.added + row.added,
      removed: acc.removed + row.removed,
      net: acc.net + row.net
    }),
    { added: 0, removed: 0, net: 0 }
  );
  const dailyAddedPie = buildPieItems(dailyRows, (row) => row.added);
  const dailyRemovedPie = buildPieItems(dailyRows, (row) => row.removed);
  const dailyTopRows = [...dailyRows].sort(
    (a, b) => Math.max(b.added, b.removed, Math.abs(b.net)) - Math.max(a.added, a.removed, Math.abs(a.net))
  );
  const summaryAddedPie = buildPieItems(summaryRows, (row) => row.added);
  const summaryRemovedPie = buildPieItems(summaryRows, (row) => row.removed);
  const summaryTopRows = [...summaryRows].sort(
    (a, b) => Math.max(b.added, b.removed, Math.abs(b.net)) - Math.max(a.added, a.removed, Math.abs(a.net))
  );

  const overallYearMaterialRows = overallYearMaterialReport?.rows ?? [];
  const topAdded = [...overallYearMaterialRows].sort((a, b) => b.added - a.added).slice(0, 10);
  const topRemoved = [...overallYearMaterialRows].sort((a, b) => b.removed - a.removed).slice(0, 10);
  const overallYearTotals = overallYearReport?.totals ?? { added: 0, removed: 0, net: 0 };
  const previousYearTotals = previousYearReport?.totals ?? { added: 0, removed: 0, net: 0 };
  const monthlySeries = (() => {
    const rows = overallYearReport?.rows ?? [];
    const byMonth = new Map(rows.map((row) => [row.month.slice(5), row]));
    return Array.from({ length: 12 }, (_, index) => {
      const key = String(index + 1).padStart(2, '0');
      const entry = byMonth.get(key);
      return {
        month: key,
        added: entry?.added ?? 0,
        removed: entry?.removed ?? 0,
        net: entry?.net ?? 0
      };
    });
  })();
  const yearlyComparisonRows = [
    { label: String(previousYear), added: previousYearTotals.added, removed: previousYearTotals.removed },
    { label: String(overallYear), added: overallYearTotals.added, removed: overallYearTotals.removed }
  ];
  const addedDelta = overallYearTotals.added - previousYearTotals.added;
  const removedDelta = overallYearTotals.removed - previousYearTotals.removed;
  const yearlyAddedPie = buildPieItems(overallYearMaterialRows, (row) => row.added);
  const yearlyRemovedPie = buildPieItems(overallYearMaterialRows, (row) => row.removed);

  const handleOverallYearChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (Number.isNaN(value)) return;
    setOverallYear(value);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Raporty" subtitle="Nowoczesny przegląd zmian, udziałów i rocznych trendów przemiałów" />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ReportTab)}>
        <TabsList>
          <TabsTrigger value="daily">Dzienny</TabsTrigger>
          <TabsTrigger value="summary">Podsumowania</TabsTrigger>
          <TabsTrigger value="overall">Ogólny</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-6 space-y-5">
          <div className="grid gap-3 md:grid-cols-4">
            <MetricTile label="Przybyło dzisiaj" value={formatKg(dailyTotals.added)} tone="added" />
            <MetricTile label="Wyrobiono dzisiaj" value={formatKg(dailyTotals.removed)} tone="removed" />
            <MetricTile label="Wynik dnia" value={formatKg(dailyTotals.net)} tone="net" />
            <MetricTile label="Pozycje z ruchem" value={String(dailyRows.length)} note="Materiały po filtrach raportu" />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <DonutPanel
              title="Przybyło - udział materiałów"
              subtitle="Największe dopływy z dzisiejszego spisu."
              items={dailyAddedPie}
              total={dailyTotals.added}
              emptyLabel="Brak przyrostów dla dzisiejszego raportu."
            />
            <DonutPanel
              title="Wyrobiono - udział materiałów"
              subtitle="Największe ubytki z dzisiejszego spisu."
              items={dailyRemovedPie}
              total={dailyTotals.removed}
              emptyLabel="Brak ubytków dla dzisiejszego raportu."
            />
          </div>

          <Card className="p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-title">Sortowanie dziennego raportu</h3>
                <p className="text-sm text-dim">Ranking poniżej zmienia kolejność bez przeładowania danych.</p>
              </div>
              <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
                {[
                  { key: 'alpha' as const, label: 'A-Z' },
                  { key: 'added' as const, label: 'Przybyło' },
                  { key: 'removed' as const, label: 'Wyrobiono' }
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleDailySort(option.key)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                      dailySort.key === option.key
                        ? 'border-[var(--brand)] bg-[rgba(255,122,26,0.14)] text-title'
                        : 'border-border bg-[rgba(255,255,255,0.025)] text-dim hover:text-title'
                    }`}
                  >
                    {option.label}
                    {dailySort.key === option.key ? (dailySort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <FlowList title="Dzienny ranking materiałów" rows={dailyTopRows} emptyLabel="Brak danych dziennych." />
        </TabsContent>

        <TabsContent value="summary" className="mt-6 space-y-5">
          <ReportToolbar
            summaryMode={summaryMode}
            summaryRange={summaryRange}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            canExport={canExport}
            onPreset={applyPreset}
            onFromChange={setRangeFrom}
            onToChange={setRangeTo}
            onCsv={handleExportCsv}
            onExcel={handleExportExcel}
            onPdf={handleExportPdf}
          />

          {summaryMode !== 'yearly' && summaryRows.length === 0 && <EmptyState>Brak danych do raportu.</EmptyState>}

          {summaryMode !== 'yearly' && summaryRows.length > 0 && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <MetricTile label="Przybyło w zakresie" value={formatKg(summaryTotals?.added ?? 0)} tone="added" />
                <MetricTile label="Wyrobiono w zakresie" value={formatKg(summaryTotals?.removed ?? 0)} tone="removed" />
                <MetricTile label="Wynik zakresu" value={formatKg(summaryTotals?.net ?? 0)} tone="net" />
              </div>
              <div className="grid gap-5 xl:grid-cols-2">
                <DonutPanel
                  title="Przybyło - struktura raportu"
                  subtitle="Udział materiałów w przyrostach dla wybranego zakresu."
                  items={summaryAddedPie}
                  total={summaryTotals?.added ?? 0}
                  emptyLabel="Brak przyrostów w wybranym zakresie."
                />
                <DonutPanel
                  title="Wyrobiono - struktura raportu"
                  subtitle="Udział materiałów w ubytkach dla wybranego zakresu."
                  items={summaryRemovedPie}
                  total={summaryTotals?.removed ?? 0}
                  emptyLabel="Brak ubytków w wybranym zakresie."
                />
              </div>
              <FlowList title="Ranking materiałów w zakresie" rows={summaryTopRows} emptyLabel="Brak pozycji w zakresie." />
            </>
          )}

          {summaryMode === 'yearly' && yearlyRows.length === 0 && <EmptyState>Brak danych do raportu.</EmptyState>}

          {summaryMode === 'yearly' && yearlyRows.length > 0 && (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <MetricTile label="Przybyło w roku" value={formatKg(yearlyReport?.totals.added ?? 0)} tone="added" />
                <MetricTile label="Wyrobiono w roku" value={formatKg(yearlyReport?.totals.removed ?? 0)} tone="removed" />
                <MetricTile label="Wynik roku" value={formatKg(yearlyReport?.totals.net ?? 0)} tone="net" />
              </div>
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-title">Roczny puls miesiąc po miesiącu</h3>
                    <p className="mt-1 text-sm text-dim">Przybyło, wyrobiono i wynik netto w wybranym roku.</p>
                  </div>
                </div>
                <div className="mt-5 h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={yearlyRows} margin={{ top: 12, right: 12, left: 4, bottom: 8 }}>
                      <defs>
                        <linearGradient id="yearlyAddedFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--danger)" stopOpacity={0.24} />
                          <stop offset="100%" stopColor="var(--danger)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="yearlyRemovedFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--success)" stopOpacity={0.24} />
                          <stop offset="100%" stopColor="var(--success)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 8" vertical={false} />
                      <XAxis dataKey="month" stroke="var(--t-dim)" tickLine={false} axisLine={false} minTickGap={14} />
                      <YAxis
                        stroke="var(--t-dim)"
                        tickFormatter={(value) => formatCompactKg(Number(value))}
                        tickLine={false}
                        axisLine={false}
                        width={58}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          color: 'var(--t-title)'
                        }}
                        formatter={(value) => formatKg(Number(value))}
                      />
                      <Area
                        type="monotone"
                        dataKey="added"
                        name="Przybyło"
                        stroke="var(--danger)"
                        fill="url(#yearlyAddedFill)"
                        strokeWidth={3}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="removed"
                        name="Wyrobiono"
                        stroke="var(--success)"
                        fill="url(#yearlyRemovedFill)"
                        strokeWidth={3}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="overall" className="mt-6 space-y-5">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border bg-[linear-gradient(135deg,rgba(255,122,26,0.14),rgba(34,211,238,0.06))] p-4 md:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-dim">Panel roczny</p>
                  <h2 className="mt-1 text-2xl font-semibold text-title">Raport strategiczny {overallYear}</h2>
                </div>
                <label className="w-36 space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-dim">Rok</span>
                  <Input
                    type="number"
                    value={overallYear}
                    onChange={handleOverallYearChange}
                    min={2000}
                    max={2100}
                    className="min-h-[44px]"
                  />
                </label>
              </div>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-4 md:p-5">
              <MetricTile
                label={`${overallYear} przybyło`}
                value={formatKg(overallYearTotals.added)}
                tone="added"
                note={`vs ${previousYear}: ${formatDelta(addedDelta)}`}
              />
              <MetricTile
                label={`${overallYear} wyrobiono`}
                value={formatKg(overallYearTotals.removed)}
                tone="removed"
                note={`vs ${previousYear}: ${formatDelta(removedDelta)}`}
              />
              <MetricTile label="Wynik netto" value={formatKg(overallYearTotals.net)} tone="net" />
              <MetricTile
                label="Aktywne pozycje"
                value={String(overallYearMaterialRows.length)}
                note="Materiały z ruchem w roku"
              />
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-title">Miesięczny trend</h3>
                <p className="mt-1 text-sm text-dim">Linia pokazuje przepływ w roku, słupki porównują przybyło i wyrobiono.</p>
              </div>
            </div>
            <div className="mt-5 h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySeries} margin={{ top: 12, right: 12, left: 4, bottom: 8 }} barGap={6}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 8" vertical={false} />
                  <XAxis dataKey="month" stroke="var(--t-dim)" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="var(--t-dim)"
                    tickFormatter={(value) => formatCompactKg(Number(value))}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--t-title)'
                    }}
                    formatter={(value) => formatKg(Number(value))}
                  />
                  <Bar dataKey="added" fill="var(--danger)" name="Przybyło" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="removed" fill="var(--success)" name="Wyrobiono" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <DonutPanel
              title={`Top przybyło ${overallYear}`}
              subtitle="Materiały z największym dodatnim ruchem rocznym."
              items={yearlyAddedPie}
              total={overallYearTotals.added}
              emptyLabel="Brak przyrostów w tym roku."
            />
            <DonutPanel
              title={`Top wyrobiono ${overallYear}`}
              subtitle="Materiały z największym ubytkiem rocznym."
              items={yearlyRemovedPie}
              total={overallYearTotals.removed}
              emptyLabel="Brak ubytków w tym roku."
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <FlowList
              title={`Największe wyrobienia ${overallYear}`}
              rows={topRemoved.map((row) => ({ ...row, net: row.net }))}
              emptyLabel="Brak danych rocznych."
              maxRows={10}
            />
            <FlowList
              title={`Największe przyrosty ${overallYear}`}
              rows={topAdded.map((row) => ({ ...row, net: row.net }))}
              emptyLabel="Brak danych rocznych."
              maxRows={10}
            />
          </div>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-title">Porównanie rok do roku</h3>
                <p className="mt-1 text-sm text-dim">{previousYear} kontra {overallYear} w jednej osi.</p>
              </div>
            </div>
            <div className="mt-5 h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yearlyComparisonRows} margin={{ top: 12, right: 12, left: 4, bottom: 8 }} barGap={10}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 8" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--t-dim)" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="var(--t-dim)"
                    tickFormatter={(value) => formatCompactKg(Number(value))}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--t-title)'
                    }}
                    formatter={(value) => formatKg(Number(value))}
                  />
                  <Bar dataKey="added" fill="var(--danger)" name="Przybyło" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="removed" fill="var(--success)" name="Wyrobiono" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
