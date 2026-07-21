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
    <div className="flex flex-wrap gap-2">
      {parts.map((part) => {
        const { label, amount } = parseReasonChip(part, showQty);
        return (
          <span
            key={part}
            className={cn('inline-flex max-w-full flex-col rounded-lg border px-2.5 py-2 text-sm', toneClass)}
          >
            <strong className="text-title">{label}</strong>
            {amount && <span className="mt-1 text-xs font-black tabular-nums opacity-90">{amount}</span>}
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
    <div className={cn('rounded-xl bg-gradient-to-br p-4 ring-1', toneClass)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-wide text-dim">{label}</p>
        {Icon && <Icon className="h-4 w-4 opacity-80" />}
      </div>
      <p className="mt-2 text-2xl font-black tabular-nums text-title sm:mt-3 sm:text-3xl">{value}</p>
    </div>
  );
};

const MiniMetric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[11px] font-black uppercase tracking-wide text-dim">{label}</p>
    <p className="mt-1 text-2xl font-black tabular-nums text-title">{value}</p>
  </div>
);

const BrigadierShiftBox = ({ shift }: { shift: BrigadierShiftScrap }) => (
  <div className="border-t border-white/10 py-3 first:border-t-0 first:pt-0 last:pb-0">
    <div className="grid gap-3 md:grid-cols-[96px_92px_92px_1fr] md:items-start">
      <p className="rounded-md bg-emerald-400/10 px-2 py-1 text-xs font-black uppercase tracking-wide text-emerald-200">
        {shift.label}
      </p>
      <MiniMetric label="Braki" value={formatQty(shift.scrapQty)} />
      <MiniMetric label="Brakowosc" value={formatPct(shift.scrapPct)} />
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
      'Brakowosc brygadzisty %',
      'Na co braki brygadzisty',
      'I zmiana braki',
      'I zmiana brakowosc %',
      'I zmiana na co',
      'II zmiana braki',
      'II zmiana brakowosc %',
      'II zmiana na co',
      'III zmiana braki',
      'III zmiana brakowosc %',
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
        row.brigadierScrapPct,
        row.brigadierReasons,
        shiftValue(row, 0, 'scrapQty'),
        shiftValue(row, 0, 'scrapPct'),
        shiftValue(row, 0, 'note'),
        shiftValue(row, 1, 'scrapQty'),
        shiftValue(row, 1, 'scrapPct'),
        shiftValue(row, 1, 'note'),
        shiftValue(row, 2, 'scrapQty'),
        shiftValue(row, 2, 'scrapPct'),
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
          <label className="space-y-2">
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
          <label className="space-y-2">
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
            className="grid gap-3 border-white/10 bg-[rgba(8,10,14,0.84)] p-3 sm:gap-4 sm:p-4 xl:grid-cols-[1fr_0.85fr_1fr]"
          >
            <div className="rounded-xl border-l-4 border-orange-400 bg-orange-400/5 p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-lg bg-orange-500/18 px-3 py-2 text-xl font-black text-orange-200 sm:text-2xl">
                  {row.machine}
                </span>
                <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-dim">
                  {row.sheet}
                </span>
              </div>
              <h2 className="mt-3 text-base font-black leading-snug text-title sm:mt-4 sm:text-xl">{row.detail}</h2>
              <p className="mt-2 text-sm text-dim">
                Indeks: <span className="font-semibold text-body">{row.index || '-'}</span>
              </p>
            </div>

            <div className="rounded-xl border-l-4 border-emerald-400 bg-emerald-400/5 p-3 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">Brygadzista</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric label="Braki" value={formatQty(row.brigadierScrapQty)} />
                <Metric label="Brakowość" value={formatPct(row.brigadierScrapPct)} />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-dim">Zmiany</p>
              <div className="mt-2 space-y-3">
                {(row.brigadierShifts?.length
                  ? row.brigadierShifts
                  : [
                      {
                        shift: 'I' as const,
                        label: 'Razem',
                        scrapQty: row.brigadierScrapQty,
                        scrapPct: row.brigadierScrapPct,
                        reasons: row.brigadierReasons,
                        note: row.brigadierNote
                      }
                    ]
                ).map((shift) => (
                  <BrigadierShiftBox key={`${row.machine}-${row.detail}-${shift.shift}`} shift={shift} />
                ))}
              </div>
            </div>

            <div className="rounded-xl border-l-4 border-cyan-400 bg-cyan-400/5 p-3 sm:p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-dim">MES</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Metric label="Braki" value={formatQty(row.mesScrapQty)} />
                <Metric label="Brakowość" value={formatPct(row.mesScrapPct)} />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-dim">Na co</p>
              <div className="mt-2">
                <ReasonChips value={row.mesReasons} />
              </div>
              {row.mesIgnoredReasons && (
                <>
                  <p className="mt-4 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-dim">
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
