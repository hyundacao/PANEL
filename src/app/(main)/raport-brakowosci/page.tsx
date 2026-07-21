'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, FileSpreadsheet, FileText, UploadCloud } from 'lucide-react';
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
  showQty = false
}: {
  value: string;
  muted?: boolean;
  showQty?: boolean;
}) => {
  const parts = reasonParts(value);
  if (parts.length === 0) return <p className="text-sm text-dim">Brak wpisu</p>;

  return (
    <div className="flex flex-wrap gap-2">
      {parts.map((part) => {
        const { label, amount } = parseReasonChip(part, showQty);
        return (
          <span
            key={part}
            className={cn(
              'inline-flex max-w-full flex-col rounded-xl border px-3 py-2 text-sm',
              muted
                ? 'border-borderStrong bg-[rgba(148,163,184,0.10)]'
                : 'border-[rgba(255,122,26,0.35)] bg-[rgba(255,122,26,0.10)]'
            )}
          >
            <strong className="text-title">{label}</strong>
            {amount && <span className="mt-1 text-xs font-semibold text-brandHover">{amount}</span>}
          </span>
        );
      })}
    </div>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-border bg-[rgba(255,255,255,0.045)] p-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</p>
    <p className="mt-2 text-3xl font-semibold tabular-nums text-title">{value}</p>
  </div>
);

const BrigadierShiftBox = ({ shift }: { shift: BrigadierShiftScrap }) => (
  <div className="rounded-xl border border-border bg-[rgba(255,255,255,0.035)] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="text-sm font-black uppercase tracking-wide text-title">{shift.label}</p>
      <div className="text-right">
        <p className="text-lg font-black tabular-nums text-title">{formatQty(shift.scrapQty)}</p>
        <p className="text-xs font-semibold text-dim">{formatPct(shift.scrapPct)}</p>
      </div>
    </div>
    <div className="mt-3">
      <ReasonChips value={shift.note || shift.reasons} showQty />
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
    <div className="space-y-5">
      <PageHeader
        title="Porownanie brakow MES i raportu brygadzisty"
        subtitle="Wgraj PDF z MES oraz XLSX z raportem brygadzisty, wybierz arkusz i sprawdz wtryskarke, detal oraz wartosci brakow. Ostatni wynik jest trzymany roboczo i nadpisuje sie przy kolejnym raporcie."
      />

      {latestUpdatedAt && (
        <div className="rounded-xl border border-border bg-[rgba(255,255,255,0.035)] px-4 py-3 text-sm text-dim">
          Aktualny zapisany raport: <span className="font-semibold text-title">{formatDateTime(latestUpdatedAt)}</span>
        </div>
      )}

      <Card className="space-y-4">
        <form className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => submit(event, 'sheets')}>
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
          <Button type="submit" disabled={!canLoadSheets || loading} className="self-end">
            <UploadCloud className="mr-2 h-4 w-4" />
            Wczytaj arkusze
          </Button>
        </form>

        {sheets.length > 0 && (
          <form className="flex flex-col gap-3 md:flex-row md:items-end" onSubmit={(event) => submit(event, 'analyze')}>
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
            <Button type="submit" disabled={!canAnalyze || loading}>
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
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Wyniki" value={formatQty(summary.rowCount)} />
          <Metric label="Wtryskarki" value={formatQty(summary.machineCount)} />
          <Metric label="Braki MES" value={formatQty(summary.mesScrapTotal)} />
          <Metric label="Braki brygadzisty" value={formatQty(summary.brigadierScrapTotal)} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex justify-end">
          <Button asChild variant="outline">
            <a href={csvHref} download="raport-brakowosci.csv">
              Pobierz CSV
            </a>
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {rows.map((row) => (
          <Card
            key={`${row.sheet}-${row.machine}-${row.detail}`}
            className="grid gap-4 border-borderStrong bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] xl:grid-cols-[1fr_0.75fr_1.1fr]"
          >
            <div className="rounded-xl border-l-4 border-brand bg-[rgba(0,0,0,0.18)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-xl bg-[rgba(255,122,26,0.16)] px-3 py-2 text-2xl font-black text-brandHover">
                  {row.machine}
                </span>
                <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-dim">
                  {row.sheet}
                </span>
              </div>
              <h2 className="mt-4 text-xl font-semibold leading-snug text-title">{row.detail}</h2>
              <p className="mt-2 text-sm text-dim">
                Indeks: <span className="font-semibold text-body">{row.index || '-'}</span>
              </p>
            </div>

            <div className="rounded-xl border-l-4 border-[var(--success)] bg-[rgba(0,0,0,0.18)] p-4">
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

            <div className="rounded-xl border-l-4 border-[#38bdf8] bg-[rgba(0,0,0,0.18)] p-4">
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
