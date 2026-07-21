'use client';

import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Download,
  Factory,
  FileSpreadsheet,
  FileText,
  Gauge,
  UploadCloud
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils/cn';

type BrakowoscRow = {
  sheet: string;
  machine: string;
  detail: string;
  index: string;
  brigadierShifts?: BrigadierShiftScrap[];
  brigadierScrapQty: number | null;
  brigadierScrapPct: number | null;
  brigadierReasons: string;
  brigadierNote: string;
  mesScrapQty: number;
  mesScrapPct: number;
  mesReasons: string;
  mesIgnoredReasons: string;
};

type BrigadierShiftScrap = {
  shift: 'I' | 'II' | 'III';
  label: string;
  scrapQty: number | null;
  scrapPct: number | null;
  reasons: string;
  note: string;
};

type BrakowoscSummary = {
  rowCount: number;
  machineCount: number;
  mesScrapTotal: number;
  brigadierScrapTotal: number;
};

type LatestBrakowoscReport = {
  sheets: string[];
  selectedSheet?: string;
  updatedAt?: string;
  rows: BrakowoscRow[];
  summary: BrakowoscSummary | null;
};

const formatQty = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString('pl-PL');
};

const formatPct = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(2).replace('.', ',')}%`;
};

const formatDateTime = (value: string) => {
  if (!value) return '';
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
};

const reasonParts = (value: string) =>
  value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);

const stripReasonPercentages = (value: string) =>
  reasonParts(value)
    .map((part) => {
      const match = part.match(/^(.+?)\s+\((.+)\)$/);
      if (!match) return part;
      const qty = match[2].match(/\d[\d\s]*\s*szt\.?/i)?.[0] ?? match[2];
      return `${match[1]} (${qty})`;
    })
    .join('; ');

const parseReasonChip = (part: string, showQty = false) => {
  const mesMatch = part.match(/^(.+?)\s+\((.+)\)$/);
  if (mesMatch) {
    const qty = mesMatch[2].match(/\d[\d\s]*\s*szt\.?/i)?.[0] ?? mesMatch[2];
    return { label: mesMatch[1], amount: qty };
  }
  if (!showQty) return { label: part, amount: '' };

  const reasonThenQty = part.match(/^(.+?)[\s:-]+(\d{1,6})(?:\s*szt\.?)?$/i);
  if (reasonThenQty) return { label: reasonThenQty[1].trim(), amount: `${reasonThenQty[2]} szt.` };

  const qtyThenReason = part.match(/^(\d{1,6})\s*(?:szt\.?)\s*(.+)$/i);
  if (qtyThenReason) return { label: qtyThenReason[2].trim(), amount: `${qtyThenReason[1]} szt.` };

  return { label: part, amount: '' };
};

const ReasonChips = ({
  value,
  muted = false,
  showQty = false,
  tone = 'amber'
}: {
  value: string;
  muted?: boolean;
  showQty?: boolean;
  tone?: 'amber' | 'cyan' | 'green' | 'slate';
}) => {
  const parts = reasonParts(value);
  if (parts.length === 0) return <p className="text-sm text-dim">Brak wpisu</p>;

  const toneClass = {
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-100',
    cyan: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
    green: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    slate: 'border-slate-400/20 bg-slate-400/10 text-slate-100'
  }[muted ? 'slate' : tone];

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(128px,1fr))] gap-2">
      {parts.map((part) => {
        const { label, amount } = parseReasonChip(part, showQty);
        return (
          <span
            key={part}
            className={cn(
              'flex min-h-[52px] w-full max-w-full min-w-0 flex-col justify-center rounded-md border px-2 py-1.5 text-xs',
              toneClass
            )}
          >
            <strong className="break-words text-title">{label}</strong>
            {amount && <span className="mt-0.5 text-[11px] font-black tabular-nums opacity-90">{amount}</span>}
          </span>
        );
      })}
    </div>
  );
};

const Metric = ({
  label,
  value,
  icon: Icon,
  tone = 'slate'
}: {
  label: string;
  value: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: 'orange' | 'cyan' | 'emerald' | 'violet' | 'slate';
}) => {
  const toneClass = {
    orange: 'from-orange-500/20 to-orange-500/5 text-orange-200 ring-orange-400/25',
    cyan: 'from-cyan-500/20 to-cyan-500/5 text-cyan-200 ring-cyan-400/25',
    emerald: 'from-emerald-500/20 to-emerald-500/5 text-emerald-200 ring-emerald-400/25',
    violet: 'from-violet-500/20 to-violet-500/5 text-violet-200 ring-violet-400/25',
    slate: 'from-slate-500/14 to-slate-500/5 text-slate-200 ring-white/10'
  }[tone];

  return (
    <div className={cn('rounded-lg bg-gradient-to-br px-3 py-2.5 ring-1', toneClass)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-wide text-dim">{label}</p>
        <p className="text-xl font-black tabular-nums text-title sm:text-2xl">{value}</p>
        {Icon && <Icon className="h-4 w-4 opacity-80" />}
      </div>
    </div>
  );
};

const BrigadierShiftBox = ({ shift }: { shift: BrigadierShiftScrap }) => (
  <div className="border-t border-white/10 py-2 first:border-t-0 first:pt-0 last:pb-0">
    <div className="min-w-0 rounded-lg border border-emerald-400/10 bg-black/10 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="rounded-md bg-emerald-400/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-emerald-200">
        {shift.label}
      </p>
        <div className="inline-flex h-8 items-center gap-2 rounded-md border border-emerald-400/15 bg-emerald-400/8 px-2.5">
          <span className="text-[10px] font-black uppercase tracking-wide text-dim">Braki</span>
          <span className="text-lg font-black tabular-nums text-title">{formatQty(shift.scrapQty)}</span>
          <span className="text-[11px] font-semibold text-dim">szt.</span>
        </div>
      </div>
      <ReasonChips value={shift.note || shift.reasons} showQty tone="green" />
    </div>
  </div>
);

const readJsonResponse = async (response: Response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    if (text.includes('<!DOCTYPE')) {
      throw new Error('Serwer zwrocil strone bledu zamiast danych. Odswiez strone i sprobuj ponownie.');
    }
    throw new Error(text || 'Serwer zwrocil nieprawidlowa odpowiedz.');
  }
  return response.json();
};

export default function RaportBrakowosciPage() {
  const [mesPdf, setMesPdf] = useState<File | null>(null);
  const [brigadierExcel, setBrigadierExcel] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [rows, setRows] = useState<BrakowoscRow[]>([]);
  const [summary, setSummary] = useState<BrakowoscSummary | null>(null);
  const [latestUpdatedAt, setLatestUpdatedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canLoadSheets = Boolean(mesPdf && brigadierExcel);
  const canAnalyze = Boolean(mesPdf && brigadierExcel && selectedSheet);

  const csvHref = useMemo(() => {
    if (rows.length === 0) return '';
    const headers = [
      'Wtryskarka',
      'Detal',
      'Indeks',
      'Braki brygadzisty',
      'Na co braki brygadzisty',
      'I zmiana braki',
      'I zmiana na co',
      'II zmiana braki',
      'II zmiana na co',
      'III zmiana braki',
      'III zmiana na co',
      'Braki MES',
      'Brakowosc MES %',
      'Na co braki MES',
      'Braki ignorowane MES',
      'Wpis brygadzisty',
      'Arkusz'
    ];
    const escape = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const shiftValue = (row: BrakowoscRow, index: number, key: keyof BrigadierShiftScrap) =>
      row.brigadierShifts?.[index]?.[key] ?? '';
    const body = rows.map((row) =>
      [
        row.machine,
        row.detail,
        row.index,
        row.brigadierScrapQty,
        row.brigadierReasons,
        shiftValue(row, 0, 'scrapQty'),
        shiftValue(row, 0, 'note'),
        shiftValue(row, 1, 'scrapQty'),
        shiftValue(row, 1, 'note'),
        shiftValue(row, 2, 'scrapQty'),
        shiftValue(row, 2, 'note'),
        row.mesScrapQty,
        row.mesScrapPct,
        stripReasonPercentages(row.mesReasons),
        stripReasonPercentages(row.mesIgnoredReasons),
        row.brigadierNote,
        row.sheet
      ]
        .map(escape)
        .join(';')
    );
    return `data:text/csv;charset=utf-8,${encodeURIComponent([headers.map(escape).join(';'), ...body].join('\n'))}`;
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/raport-brakowosci')
      .then(readJsonResponse)
      .then((payload: { latest?: LatestBrakowoscReport | null }) => {
        if (cancelled || !payload.latest) return;
        setSheets(payload.latest.sheets ?? []);
        setSelectedSheet(payload.latest.selectedSheet ?? payload.latest.sheets?.[0] ?? '');
        setRows(payload.latest.rows ?? []);
        setSummary(payload.latest.summary ?? null);
        setLatestUpdatedAt(payload.latest.updatedAt ?? '');
      })
      .catch(() => {
        if (!cancelled) setLatestUpdatedAt('');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>, mode: 'sheets' | 'analyze') => {
    event.preventDefault();
    if (!mesPdf || !brigadierExcel) return;
    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('mesPdf', mesPdf);
    formData.append('brigadierExcel', brigadierExcel);
    if (mode === 'analyze') formData.append('sheet', selectedSheet);

    try {
      const response = await fetch('/api/raport-brakowosci', {
        method: 'POST',
        body: formData
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(payload.error ?? 'Nie udało się przetworzyć raportu.');
      }
      setSheets(payload.sheets ?? []);
      if (mode === 'sheets' && payload.sheets?.length) {
        setSelectedSheet(payload.sheets[0]);
      }
      if (mode === 'analyze') {
        setRows(payload.rows ?? []);
        setSummary(payload.summary ?? null);
        setLatestUpdatedAt(payload.updatedAt ?? new Date().toISOString());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się przetworzyć raportu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(34,197,94,0.08)_42%,rgba(255,122,26,0.12))] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <PageHeader
          title="Raport brakowosci"
          subtitle="Porownanie raportu MES z raportem brygadzisty. Jeden aktualny wynik, nadpisywany po kolejnym przeliczeniu."
        />
        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
            <span className="inline-flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 ring-1 ring-white/10">
              <CalendarClock className="h-4 w-4 text-cyan-200" />
              Aktualny raport: <strong className="text-title">{latestUpdatedAt ? formatDateTime(latestUpdatedAt) : 'brak zapisu'}</strong>
            </span>
            {selectedSheet && (
              <span className="inline-flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 ring-1 ring-white/10">
                <ClipboardList className="h-4 w-4 text-emerald-200" />
                Arkusz: <strong className="text-title">{selectedSheet}</strong>
              </span>
            )}
          </div>
          {rows.length > 0 && (
            <Button asChild variant="outline" className="border-cyan-400/45 text-cyan-100 hover:bg-cyan-400/10">
              <a href={csvHref} download="raport-brakowosci.csv">
                <Download className="mr-2 h-4 w-4" />
                Pobierz CSV
              </a>
            </Button>
          )}
        </div>
      </div>

      <Card className="space-y-4 border-white/10 bg-[rgba(8,10,14,0.76)] p-3 sm:space-y-5 sm:p-5">
        <form className="grid gap-4 xl:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => submit(event, 'sheets')}>
          <label className="min-w-0 space-y-2">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-dim">
              <FileText className="h-4 w-4" />
              PDF MES
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                setMesPdf(event.target.files?.[0] ?? null);
                setSheets([]);
              }}
              className="w-full rounded-xl border border-border bg-[rgba(0,0,0,0.36)] px-3 py-3 text-sm text-body file:mr-3 file:rounded-lg file:border-0 file:bg-[rgba(255,122,26,0.18)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-title"
            />
          </label>
          <label className="min-w-0 space-y-2">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-dim">
              <FileSpreadsheet className="h-4 w-4" />
              Raport brygadzisty XLSX
            </span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setBrigadierExcel(event.target.files?.[0] ?? null);
                setSheets([]);
              }}
              className="w-full rounded-xl border border-border bg-[rgba(0,0,0,0.36)] px-3 py-3 text-sm text-body file:mr-3 file:rounded-lg file:border-0 file:bg-[rgba(255,122,26,0.18)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-title"
            />
          </label>
          <Button type="submit" disabled={!canLoadSheets || loading} className="w-full self-end xl:w-auto">
            <UploadCloud className="mr-2 h-4 w-4" />
            Wczytaj arkusze
          </Button>
        </form>

        {sheets.length > 0 && (
          <form className="flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-end" onSubmit={(event) => submit(event, 'analyze')}>
            <label className="w-full space-y-2 md:max-w-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-dim">Arkusz z Excela</span>
              <select
                value={selectedSheet}
                onChange={(event) => setSelectedSheet(event.target.value)}
                className="w-full rounded-xl border border-border bg-[rgba(0,0,0,0.40)] px-3 py-3 text-sm text-body focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={!canAnalyze || loading} className="w-full md:w-auto">
              Pokaż raport
            </Button>
          </form>
        )}

        {error && (
          <div className="flex gap-3 rounded-xl border border-[rgba(255,82,82,0.35)] bg-[rgba(255,82,82,0.10)] p-3 text-sm text-title">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
            {error}
          </div>
        )}
      </Card>

      {summary && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Wyniki" value={formatQty(summary.rowCount)} icon={BarChart3} tone="violet" />
          <Metric label="Wtryskarki" value={formatQty(summary.machineCount)} icon={Factory} tone="slate" />
          <Metric label="Braki MES" value={formatQty(summary.mesScrapTotal)} icon={Gauge} tone="cyan" />
          <Metric label="Braki brygadzisty" value={formatQty(summary.brigadierScrapTotal)} icon={ClipboardList} tone="emerald" />
        </div>
      )}

      <div className="space-y-4">
        {rows.map((row) => (
          <Card
            key={`${row.sheet}-${row.machine}-${row.detail}`}
            className="grid min-w-0 gap-2.5 border-white/10 bg-[rgba(8,10,14,0.84)] p-2.5 sm:gap-3 sm:p-3 xl:grid-cols-2"
          >
            <div className="min-w-0 rounded-lg border border-orange-400/20 bg-orange-400/5 p-2.5 sm:p-3 xl:col-span-2">
              <div className="grid gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                <span className="flex h-12 w-fit items-center rounded-lg bg-orange-500/18 px-3 text-lg font-black text-orange-200 sm:text-xl">
                  {row.machine}
                </span>
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-black leading-snug text-title sm:text-base">{row.detail}</h2>
                  <p className="mt-1 text-xs text-dim">
                    Indeks: <span className="break-all font-semibold text-body">{row.index || '-'}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="inline-flex h-12 items-center gap-3 rounded-lg border border-red-400/45 bg-red-500/20 px-3.5 text-red-100 shadow-[0_10px_24px_-20px_rgba(248,113,113,0.9)]">
                    <span className="text-[10px] font-black uppercase tracking-wide opacity-85">Brakowosc</span>
                    <span className="text-xl font-black tabular-nums leading-none sm:text-[26px]">
                      {formatPct(row.mesScrapPct)}
                    </span>
                  </span>
                  <span className="inline-flex h-9 items-center rounded-full border border-border px-3 text-xs font-semibold text-dim">
                    {row.sheet}
                  </span>
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-xl border-l-4 border-emerald-400 bg-emerald-400/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Brygadzista</p>
              <div className="mt-2">
                <Metric label="Braki" value={formatQty(row.brigadierScrapQty)} />
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-dim">Zmiany</p>
              <div className="mt-2 space-y-2">
                {(row.brigadierShifts?.length
                  ? row.brigadierShifts.filter((shift) => shift.scrapQty || shift.note || shift.reasons)
                  : [
                      {
                        shift: 'I' as const,
                        label: 'Razem',
                        scrapQty: row.brigadierScrapQty,
                        scrapPct: row.brigadierScrapPct,
                        reasons: row.brigadierReasons,
                        note: row.brigadierNote
                      }
                    ].filter((shift) => shift.scrapQty || shift.note || shift.reasons)
                ).map((shift) => (
                  <BrigadierShiftBox key={`${row.machine}-${row.detail}-${shift.shift}`} shift={shift} />
                ))}
                {(row.brigadierShifts?.length
                  ? row.brigadierShifts.filter((shift) => shift.scrapQty || shift.note || shift.reasons)
                  : [
                      {
                        shift: 'I' as const,
                        label: 'Razem',
                        scrapQty: row.brigadierScrapQty,
                        scrapPct: row.brigadierScrapPct,
                        reasons: row.brigadierReasons,
                        note: row.brigadierNote
                      }
                    ].filter((shift) => shift.scrapQty || shift.note || shift.reasons)
                ).length === 0 && <p className="text-sm text-dim">Brak wpisu</p>}
              </div>
            </div>

            <div className="min-w-0 rounded-xl border-l-4 border-cyan-400 bg-cyan-400/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">MES</p>
              <div className="mt-2">
                <Metric label="Braki" value={formatQty(row.mesScrapQty)} />
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-dim">Na co</p>
              <div className="mt-2">
                <ReasonChips value={row.mesReasons} />
              </div>
              {row.mesIgnoredReasons && (
                <>
                  <p className="mt-3 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-dim">
                    Ignorowane
                  </p>
                  <div className="mt-2">
                    <ReasonChips value={row.mesIgnoredReasons} muted />
                  </div>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
