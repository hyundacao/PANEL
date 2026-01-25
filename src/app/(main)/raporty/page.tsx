'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDailyHistory, getPeriodReport, getReports, getYearlyReport } from '@/lib/api';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { formatKg } from '@/lib/utils/format';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const dailyReportExcludePatterns = [/^ABS\s*30\//i];

export default function ReportsPage() {
  const { data } = useQuery({ queryKey: ['reports'], queryFn: getReports });
  const { data: history } = useQuery({ queryKey: ['daily-history'], queryFn: getDailyHistory });
  const [summaryMode, setSummaryMode] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [dailySort, setDailySort] = useState<{
    key: 'alpha' | 'added' | 'removed';
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
    summaryMode === 'weekly' ? 'Raport tygodniowy' : summaryMode === 'monthly' ? 'Raport miesieczny' : 'Raport roczny';
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
  const applyPreset = (mode: 'weekly' | 'monthly' | 'yearly') => {
    setSummaryMode(mode);
    const anchor = latestDate ?? formatDateKey(new Date());
    const range =
      mode === 'weekly' ? getWeekRange(anchor) : mode === 'monthly' ? getMonthRange(anchor) : getYearRange(anchor);
    setRangeFrom(range.from);
    setRangeTo(range.to);
  };

  useEffect(() => {
    if (rangeFrom || rangeTo || !latestDate) return;
    applyPreset('weekly');
  }, [latestDate, rangeFrom, rangeTo]);

  const safeFilename = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  const formatDelta = (value: number) => `${value >= 0 ? '+' : '-'}${formatKg(Math.abs(value))}`;

  const buildCsv = (headers: string[], rows: string[][]) => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    return [headers, ...rows].map((row) => row.map(escape).join(';')).join('\r\n');
  };

  const buildHtmlTable = (headers: string[], rows: string[][], subtitle?: string) => {
    const head = headers.map((col) => `<th style="text-align:left;padding:6px 8px;border:1px solid #ddd;">${col}</th>`).join('');
    const body = rows
      .map(
        (row) =>
          `<tr>${row
            .map((cell) => `<td style="padding:6px 8px;border:1px solid #ddd;">${cell}</td>`)
            .join('')}</tr>`
      )
      .join('');
    const subtitleHtml = subtitle ? `<p style="margin:0 0 12px 0;color:#666;">${subtitle}</p>` : '';
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${exportTitle}</title>
  </head>
  <body style="font-family:Arial, sans-serif;margin:24px;">
    <h2 style="margin:0 0 8px 0;">${exportTitle}</h2>
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

  const getExportData = () => {
    if (summaryMode === 'yearly') {
      const rows = yearlyRows.map((row) => [
        row.month,
        String(row.added),
        String(row.removed),
        String(row.net)
      ]);
      const totalsRow = [
        'SUMA',
        String(yearlyReport?.totals.added ?? 0),
        String(yearlyReport?.totals.removed ?? 0),
        String(yearlyReport?.totals.net ?? 0)
      ];
      return {
        headers: ['Miesiac', 'Przybylo (kg)', 'Wyrobiono (kg)', 'Netto (kg)'],
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
          ? ['Przemial', 'Przybylo (kg)', 'Wyrobiono (kg)', 'Netto (kg)', 'Komentarze przybylo', 'Komentarze wyrobiono']
          : ['Przemial', 'Przybylo (kg)', 'Wyrobiono (kg)', 'Netto (kg)'],
      rows: [...rows, totalsRow]
    };
  };

  const handleExportCsv = () => {
    const hasData = summaryMode === 'yearly' ? yearlyRows.length > 0 : summaryRows.length > 0;
    if (!hasData) return;
    const { headers, rows } = getExportData();
    const content = buildCsv(headers, rows);
    const suffix = safeFilename(summaryRange || summaryMode || 'raport');
    downloadFile(content, 'text/csv;charset=utf-8', `raport_${summaryMode}_${suffix}.csv`);
  };

  const handleExportExcel = () => {
    const hasData = summaryMode === 'yearly' ? yearlyRows.length > 0 : summaryRows.length > 0;
    if (!hasData) return;
    const { headers, rows } = getExportData();
    const html = buildHtmlTable(headers, rows, summaryRange ? `Zakres: ${summaryRange}` : undefined);
    const suffix = safeFilename(summaryRange || summaryMode || 'raport');
    downloadFile(html, 'application/vnd.ms-excel;charset=utf-8', `raport_${summaryMode}_${suffix}.xls`);
  };

  const handleExportPdf = () => {
    const hasData = summaryMode === 'yearly' ? yearlyRows.length > 0 : summaryRows.length > 0;
    if (!hasData) return;
    const { headers, rows } = getExportData();
    const html = buildHtmlTable(headers, rows, summaryRange ? `Zakres: ${summaryRange}` : undefined);
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  };
  const summaryColumns =
    summaryMode === 'weekly'
      ? [
          'Przemial',
          <span key="added" className="text-danger">
            Przybylo
          </span>,
          <span key="removed" className="text-success">
            Wyrobiono
          </span>,
          'Netto',
          'Komentarze przybylo',
          'Komentarze wyrobiono'
        ]
      : [
          'Przemial',
          <span key="added" className="text-danger">
            Przybylo
          </span>,
          <span key="removed" className="text-success">
            Wyrobiono
          </span>,
          'Netto'
        ];
  const summaryTableRows = summaryRows.map((row) =>
    summaryMode === 'weekly'
      ? [
          row.label,
          formatKg(row.added),
          formatKg(row.removed),
          formatKg(row.net),
          (row.addedComments ?? []).join(', ') || '-',
          (row.removedComments ?? []).join(', ') || '-'
        ]
      : [row.label, formatKg(row.added), formatKg(row.removed), formatKg(row.net)]
  );
  const dailyRows = useMemo(() => {
    const rows = [...(data ?? [])].filter(
      (row) => !dailyReportExcludePatterns.some((pattern) => pattern.test(row.name))
    );
    const compareAlpha = (a: (typeof rows)[number], b: (typeof rows)[number]) => {
      const nameCompare = collator.compare(a.name, b.name);
      if (nameCompare !== 0) return nameCompare;
      return collator.compare(a.code ?? '', b.code ?? '');
    };
    const alphaCompare =
      dailySort.direction === 'asc'
        ? compareAlpha
        : (a: (typeof rows)[number], b: (typeof rows)[number]) => compareAlpha(b, a);
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
    rows.sort(alphaCompare);
    return rows;
  }, [collator, dailySort, data]);

  const handleDailySort = (key: 'alpha' | 'added' | 'removed') => {
    setDailySort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'alpha' ? 'asc' : 'desc' };
    });
  };

  const dailySortArrow = (key: 'alpha' | 'added' | 'removed') =>
    dailySort.key === key ? (dailySort.direction === 'asc' ? '↑' : '↓') : '';
  const yearlyRows = yearlyReport?.rows ?? [];
  const canExport = summaryMode === 'yearly' ? yearlyRows.length > 0 : summaryRows.length > 0;
  const overallYearMaterialRows = overallYearMaterialReport?.rows ?? [];
  const topAdded = [...overallYearMaterialRows]
    .sort((a, b) => b.added - a.added)
    .slice(0, 10);
  const topRemoved = [...overallYearMaterialRows]
    .sort((a, b) => b.removed - a.removed)
    .slice(0, 10);
  const overallYearTotals = overallYearReport?.totals ?? { added: 0, removed: 0, net: 0 };
  const previousYearTotals = previousYearReport?.totals ?? { added: 0, removed: 0, net: 0 };
  const yearlyComparisonRows = [
    {
      label: String(previousYear),
      added: previousYearTotals.added,
      removed: previousYearTotals.removed
    },
    {
      label: String(overallYear),
      added: overallYearTotals.added,
      removed: overallYearTotals.removed
    }
  ];
  const monthlySeries = (() => {
    const rows = overallYearReport?.rows ?? [];
    const byMonth = new Map(rows.map((row) => [row.month.slice(5), row]));
    return Array.from({ length: 12 }, (_, index) => {
      const key = String(index + 1).padStart(2, '0');
      const entry = byMonth.get(key);
      return {
        month: key,
        added: entry?.added ?? 0,
        removed: entry?.removed ?? 0
      };
    });
  })();
  const addedDelta = overallYearTotals.added - previousYearTotals.added;
  const removedDelta = overallYearTotals.removed - previousYearTotals.removed;
  const handleOverallYearChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (Number.isNaN(value)) return;
    setOverallYear(value);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Raporty" subtitle="Podsumowania na podstawie spisu" />

      <Tabs defaultValue="daily">
        <TabsList>
          <TabsTrigger value="daily">Dzienny</TabsTrigger>
          <TabsTrigger value="summary">Podsumowania</TabsTrigger>
          <TabsTrigger value="overall">Ogólny</TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="mt-6 space-y-4">
          <Card className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-dim">
              Dzienny material
            </p>
            <DataTable
              columns={[
                <button
                  key="material"
                  type="button"
                  onClick={() => handleDailySort('alpha')}
                  className="flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide"
                >
                  Materiał
                  <span className={dailySort.key === 'alpha' ? 'text-title' : 'text-dim'}>
                    {dailySortArrow('alpha')}
                  </span>
                </button>,
                <span key="added" className="text-danger">
                  <button
                    type="button"
                    onClick={() => handleDailySort('added')}
                    className="flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Przybyło
                    <span className={dailySort.key === 'added' ? 'text-title' : 'text-dim'}>
                      {dailySortArrow('added')}
                    </span>
                  </button>
                </span>,
                <span key="removed" className="text-success">
                  <button
                    type="button"
                    onClick={() => handleDailySort('removed')}
                    className="flex items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide"
                  >
                    Wyrobiono
                    <span className={dailySort.key === 'removed' ? 'text-title' : 'text-dim'}>
                      {dailySortArrow('removed')}
                    </span>
                  </button>
                </span>,
                'Netto'
              ]}
              rows={dailyRows.slice(0, 8).map((row) => [
                row.name,
                formatKg(row.added),
                formatKg(row.removed),
                formatKg(row.net)
              ])}
            />
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="mt-6 space-y-4">
          <Card className="space-y-2 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">Ustawienia raportu</p>
                <p className="text-sm text-dim">Wybierz tryb i zakres dat.</p>
              </div>
              {summaryRange && (
                <div className="rounded-lg border border-border bg-surface2 px-2 py-1.5 text-xs text-dim">
                  {`Zakres: ${summaryRange}`}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={summaryMode === 'weekly' ? 'secondary' : 'outline'}
                    onClick={() => applyPreset('weekly')}
                    className={
                      summaryMode === 'weekly'
                        ? 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]'
                        : undefined
                    }
                  >
                    Tygodniowy
                  </Button>
                  <Button
                    variant={summaryMode === 'monthly' ? 'secondary' : 'outline'}
                    onClick={() => applyPreset('monthly')}
                    className={
                      summaryMode === 'monthly'
                        ? 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]'
                        : undefined
                    }
                  >
                    Miesieczny
                  </Button>
                  <Button
                    variant={summaryMode === 'yearly' ? 'secondary' : 'outline'}
                    onClick={() => applyPreset('yearly')}
                    className={
                      summaryMode === 'yearly'
                        ? 'ring-2 ring-[rgba(255,122,26,0.45)] shadow-[0_0_0_3px_rgba(255,122,26,0.18)]'
                        : undefined
                    }
                  >
                    Roczny
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-44">
                    <label className="text-xs uppercase tracking-wide text-dim">Od</label>
                    <Input
                      type="date"
                      value={rangeFrom}
                      onChange={(event) => setRangeFrom(event.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                  <div className="w-44">
                    <label className="text-xs uppercase tracking-wide text-dim">Do</label>
                    <Input
                      type="date"
                      value={rangeTo}
                      onChange={(event) => setRangeTo(event.target.value)}
                      className="min-h-[44px]"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2 shrink-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">Eksport</p>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button
                    variant="primaryEmber"
                    onClick={handleExportCsv}
                    disabled={!canExport}
                    className="w-44 justify-center"
                  >
                    Eksport CSV
                  </Button>
                  <Button
                    variant="primaryEmber"
                    onClick={handleExportExcel}
                    disabled={!canExport}
                    className="w-44 justify-center"
                  >
                    Eksport Excel
                  </Button>
                  <Button
                    variant="primaryEmber"
                    onClick={handleExportPdf}
                    disabled={!canExport}
                    className="w-44 justify-center"
                  >
                    Eksport PDF
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {summaryMode !== 'yearly' && summaryTableRows.length === 0 && (
            <Card>
              <p className="text-sm text-muted">Brak danych do raportu.</p>
            </Card>
          )}

          {summaryMode !== 'yearly' && summaryTableRows.length > 0 && (
            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Wynik raportu</p>
              <DataTable columns={summaryColumns} rows={summaryTableRows} />
              <div className="flex flex-wrap items-center justify-end gap-6 text-sm text-muted">
                <span>
                  Przybylo: <span className="text-body">{formatKg(summaryTotals?.added ?? 0)}</span>
                </span>
                <span>
                  Wyrobiono: <span className="text-body">{formatKg(summaryTotals?.removed ?? 0)}</span>
                </span>
                <span>
                  Netto: <span className="text-body">{formatKg(summaryTotals?.net ?? 0)}</span>
                </span>
              </div>
            </Card>
          )}

          {summaryMode === 'yearly' && yearlyRows.length === 0 && (
            <Card>
              <p className="text-sm text-muted">Brak danych do raportu.</p>
            </Card>
          )}

          {summaryMode === 'yearly' && yearlyRows.length > 0 && (
            <Card className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Wynik raportu</p>
              <DataTable
                columns={['Miesiac', 'Przybylo', 'Wyrobiono', 'Netto']}
                rows={yearlyRows.map((row) => [
                  row.month,
                  formatKg(row.added),
                  formatKg(row.removed),
                  formatKg(row.net)
                ])}
              />
              <div className="flex flex-wrap items-center justify-end gap-6 text-sm text-muted">
                <span>
                  Przybylo: <span className="text-body">{formatKg(yearlyReport?.totals.added ?? 0)}</span>
                </span>
                <span>
                  Wyrobiono: <span className="text-body">{formatKg(yearlyReport?.totals.removed ?? 0)}</span>
                </span>
                <span>
                  Netto: <span className="text-body">{formatKg(yearlyReport?.totals.net ?? 0)}</span>
                </span>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="overall" className="mt-6 space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-dim">Statystyki roczne</p>
                <p className="text-sm text-dim">
                  Miesieczne przybylo/wyrobiono oraz porownanie z rokiem poprzednim.
                </p>
              </div>
              <div className="w-32">
                <label className="text-xs uppercase tracking-wide text-dim">Rok</label>
                <Input
                  type="number"
                  value={overallYear}
                  onChange={handleOverallYearChange}
                  min={2000}
                  max={2100}
                  className="min-h-[44px]"
                />
              </div>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Rok {overallYear} przybylo</p>
              <p className="text-2xl font-semibold text-title">{formatKg(overallYearTotals.added)}</p>
              <p className="text-xs text-dim">Porownanie z {previousYear}: {formatDelta(addedDelta)}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Rok {overallYear} wyrobiono</p>
              <p className="text-2xl font-semibold text-title">{formatKg(overallYearTotals.removed)}</p>
              <p className="text-xs text-dim">Porownanie z {previousYear}: {formatDelta(removedDelta)}</p>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-lg font-semibold text-title">Miesiecznie {overallYear}</h3>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlySeries} barGap={6}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis dataKey="month" stroke="var(--t-dim)" />
                    <YAxis stroke="var(--t-dim)" />
                    <Tooltip formatter={(value) => formatKg(Number(value))} />
                    <Legend />
                    <Bar dataKey="added" fill="var(--danger)" name="Przybylo" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="removed" fill="var(--success)" name="Wyrobiono" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold text-title">Porownanie {previousYear} vs {overallYear}</h3>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={yearlyComparisonRows} barGap={10}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis dataKey="label" stroke="var(--t-dim)" />
                    <YAxis stroke="var(--t-dim)" />
                    <Tooltip formatter={(value) => formatKg(Number(value))} />
                    <Legend />
                    <Bar dataKey="added" fill="var(--danger)" name="Przybylo" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="removed" fill="var(--success)" name="Wyrobiono" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="text-lg font-semibold text-title">Top 10 wyrobiono ({overallYear})</h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topRemoved}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis dataKey="label" stroke="var(--t-dim)" />
                    <YAxis stroke="var(--t-dim)" />
                    <Tooltip formatter={(value) => formatKg(Number(value))} />
                    <Bar dataKey="removed" fill="var(--success)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <h3 className="text-lg font-semibold text-title">Top 10 przybylo ({overallYear})</h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topAdded}>
                    <CartesianGrid stroke="var(--border)" />
                    <XAxis dataKey="label" stroke="var(--t-dim)" />
                    <YAxis stroke="var(--t-dim)" />
                    <Tooltip formatter={(value) => formatKg(Number(value))} />
                    <Bar dataKey="added" fill="var(--danger)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

