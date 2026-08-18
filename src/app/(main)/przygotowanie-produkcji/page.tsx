'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import * as XLSX from 'xlsx';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Copy, Pencil, Plus, Trash2, Upload, Wrench, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils/cn';

type Team = 'mechanics' | 'process' | 'distribution' | 'graphics' | 'technician' | 'additional';
type WorkKind = 'zmiana-formy' | 'forma-narzedziownia' | 'rozruch' | 'wznowienie' | 'zmiana-koloru' | 'zmiana-grafiki' | 'regulacja' | 'proby' | 'przeglad-a' | 'anulowane' | 'inne';
type ReportKind = WorkKind | 'przygotowanie-stanowiska' | 'wznowienie-procesu';
type PlanGroup = 'standard' | 'emergency' | 'planned';

type Task = {
  id: string;
  isCurrentPlan: boolean;
  planGroup: PlanGroup;
  station: string;
  detail: string;
  quantity: string;
  norm: string;
  highlighted: boolean;
  kinds: WorkKind[];
  teams: Team[];
  notes: Partial<Record<Team, string>>;
  done: boolean;
  material: string;
  materialType: string;
  source: string;
  dryer: string;
  temperature: string;
};

type StoredPlan = {
  session: { file_name?: string | null; plan_sheet?: string | null; updated_at?: string | null } | null;
  tasks: Task[];
};

type PlanHistory = {
  plan_date: string;
  file_name?: string | null;
  plan_sheet?: string | null;
  tasks: Task[];
  archived_at: string;
};

type WorkKindSeries = {
  id: ReportKind;
  label: string;
  total: number;
  data: Array<{ date: string; value: number }>;
};

const teamOptions: Array<{ id: Team; label: string; color: string }> = [
  { id: 'mechanics', label: 'Mechanik', color: '#ff7900' },
  { id: 'process', label: 'Inżynier procesu', color: '#2fb5f0' },
  { id: 'distribution', label: 'Rozdzielca', color: '#36c875' },
  { id: 'graphics', label: 'Grafik', color: '#a969ef' },
  { id: 'technician', label: 'Technik uruchomienia', color: '#20c8cc' },
  { id: 'additional', label: 'Informacja dodatkowa', color: '#f2c14a' }
];

const workKinds: Array<{ id: WorkKind; label: string }> = [
  { id: 'zmiana-formy', label: 'Zmiana formy' },
  { id: 'forma-narzedziownia', label: 'Forma na narzędziownię' },
  { id: 'rozruch', label: 'Rozruch' },
  { id: 'wznowienie', label: 'Wznowienie' },
  { id: 'zmiana-koloru', label: 'Zmiana koloru' },
  { id: 'zmiana-grafiki', label: 'Zmiana grafiki' },
  { id: 'regulacja', label: 'Regulacja' },
  { id: 'proby', label: 'Próby' },
  { id: 'przeglad-a', label: 'Przegląd A' },
  { id: 'anulowane', label: 'Anulowane' },
  { id: 'inne', label: 'Inne' }
];

const reportKinds: Array<{ id: ReportKind; label: string }> = [
  ...workKinds,
  { id: 'przygotowanie-stanowiska', label: 'Przygotowanie stanowiska' },
  { id: 'wznowienie-procesu', label: 'Wznowienie procesu po narzędziowni' }
];

const automaticTeams: Partial<Record<WorkKind, Team[]>> = {
  rozruch: ['process', 'distribution'],
  wznowienie: ['process'],
  'zmiana-koloru': ['process', 'distribution', 'technician'],
  'zmiana-grafiki': ['process', 'distribution', 'graphics'],
  'zmiana-formy': ['mechanics', 'process', 'distribution', 'technician'],
  'forma-narzedziownia': ['mechanics', 'process'],
  regulacja: ['process'],
  proby: ['process'],
  'przeglad-a': ['process']
};

const teamsWith5s: Team[] = ['mechanics', 'process', 'distribution', 'technician'];
const standard5s = 'Po wykonanym zadaniu poprawnie ustaw tabliczkę 5S.';
const isManualTask = (task: Pick<Task, 'station'>) => task.station === 'ZADANIE DODATKOWE';
const isPanelGroupHeader = (task: Pick<Task, 'station' | 'detail'>) =>
  /^ST\s*[12]$/.test(normalize(task.station)) && /^PANELE\s+(SE|BO)$/.test(normalize(task.detail));
const preparesDistributionStation = (task: Pick<Task, 'teams' | 'notes'>) =>
  task.teams.includes('distribution') && task.notes.distribution?.trim().toLocaleLowerCase().includes('przygotowa') === true;
const restartsProcessAfterToolroom = (task: Pick<Task, 'kinds' | 'teams' | 'notes'>) =>
  task.kinds.includes('forma-narzedziownia') && task.teams.includes('process');
const kindsForTeam = (task: Task, team: Team) => team === 'mechanics'
  ? task.kinds.filter((kind) => kind === 'zmiana-formy' || kind === 'forma-narzedziownia' || kind === 'anulowane')
  : task.kinds;
const planGroupLabel: Record<PlanGroup, string> = {
  standard: 'Plan bieżący',
  emergency: 'Awaryjnie',
  planned: 'Planowane zmiany'
};

const cellText = (value: unknown) => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toUpperCase();

const dateKeyFrom = (value: string) => {
  const match = value.match(/(\d{1,2})[.-](\d{1,2})(?:[.-]\d{2,4})?/);
  if (!match) return '';
  return `${match[1].padStart(2, '0')}.${match[2].padStart(2, '0')}`;
};

const defaultSheetName = (sheetNames: string[], fileName: string) => {
  const fileDate = dateKeyFrom(fileName);
  if (fileDate) {
    const matchingFileDate = sheetNames.find((name) => dateKeyFrom(name) === fileDate);
    if (matchingFileDate) return matchingFileDate;
  }
  const todayParts = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit' })
    .formatToParts(new Date());
  const todayKey = `${todayParts.find((part) => part.type === 'day')?.value ?? ''}.${todayParts.find((part) => part.type === 'month')?.value ?? ''}`;
  return sheetNames.find((name) => dateKeyFrom(name) === todayKey) ?? sheetNames[sheetNames.length - 1] ?? '';
};

const workbookDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('przygotowanie-produkcji', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('workbooks');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const saveWorkbookLocally = async (buffer: ArrayBuffer, fileName: string) => {
  const database = await workbookDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('workbooks', 'readwrite');
    transaction.objectStore('workbooks').put({ buffer, fileName }, 'active');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

const loadWorkbookLocally = async (): Promise<{ buffer: ArrayBuffer; fileName: string } | null> => {
  const database = await workbookDatabase();
  const item = await new Promise<{ buffer: ArrayBuffer; fileName: string } | null>((resolve, reject) => {
    const request = database.transaction('workbooks', 'readonly').objectStore('workbooks').get('active');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return item;
};

const temperatureFor = (type: string) => {
  const normalized = type.trim().toUpperCase();
  if (normalized === 'PC' || normalized === 'PET') return '120';
  if (['PP', 'ABS', 'PA', 'PS', 'PMMA', 'SAN', 'PC+ABS'].includes(normalized)) return '80';
  return '';
};

const taskChoiceBackground = (active: boolean) => ({
  backgroundImage: active
    ? "linear-gradient(100deg, rgba(255,122,0,0.28), rgba(7,8,12,0.58)), url('/profil-panel-bg.png')"
    : "linear-gradient(100deg, rgba(7,8,12,0.7), rgba(7,8,12,0.5)), url('/profil-panel-bg.png')",
  backgroundPosition: 'center',
  backgroundSize: 'cover'
});

const WorkReportDashboard = ({
  period,
  onPeriodChange,
  dayCount,
  report,
  chart,
  series
}: {
  period: 'week' | 'month' | 'all';
  onPeriodChange: (period: 'week' | 'month' | 'all') => void;
  dayCount: number;
  report: Record<ReportKind, { total: number; done: number }>;
  chart: Array<{ date: string; prace: number }>;
  series: WorkKindSeries[];
}) => {
  const total = Object.values(report).reduce((sum, item) => sum + item.total, 0);
  const done = Object.values(report).reduce((sum, item) => sum + item.done, 0);
  const breakdown = reportKinds.map((kind) => ({ label: kind.label, value: report[kind.id].total }));
  const maxValue = Math.max(1, ...breakdown.map((item) => item.value));
  const periodLabel = period === 'week' ? 'Ostatnie 7 dni' : period === 'month' ? 'Ostatnie 30 dni' : 'Cała historia';

  return <div className="work-report-dashboard space-y-4">
    <section className="overflow-hidden rounded-xl border border-[rgba(255,122,0,0.3)] bg-[#0c0e13]" style={{ backgroundImage: "linear-gradient(100deg, rgba(255,122,0,0.16), rgba(7,8,12,0.72)), url('/profil-panel-bg.png')", backgroundPosition: 'center', backgroundSize: 'cover' }}>
      <div className="flex flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--brand)]">Przygotowanie produkcji</p><h2 className="mt-1 text-2xl font-semibold text-title">Raport prac</h2><p className="mt-1 text-sm text-dim">{periodLabel}</p></div><div className="grid grid-cols-3 gap-2">{([{ id: 'week', label: 'Tydzień' }, { id: 'month', label: 'Miesiąc' }, { id: 'all', label: 'Wszystko' }] as const).map((item) => <Button className={cn('min-h-10 px-3 py-2 text-xs', period === item.id && 'bg-[rgba(255,122,0,0.18)] text-title')} key={item.id} onClick={() => onPeriodChange(item.id)} type="button" variant={period === item.id ? 'secondary' : 'outline'}>{item.label}</Button>)}</div></div>
    </section>
    <div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-[rgba(255,122,0,0.3)] bg-[linear-gradient(135deg,rgba(255,122,0,0.15),rgba(255,255,255,0.02))] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-dim">Prace w okresie</p><p className="mt-2 text-4xl font-bold text-[var(--brand)]">{total}</p></div><div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs font-semibold uppercase tracking-wide text-dim">Dni z planem</p><p className="mt-2 text-4xl font-bold text-title">{dayCount}</p></div><div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs font-semibold uppercase tracking-wide text-dim">Wykonane</p><p className="mt-2 text-4xl font-bold text-title">{done}</p></div></div>
    <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]"><section className="rounded-xl border border-border bg-surface p-5"><div className="mb-5 flex items-center justify-between"><div><p className="font-semibold text-title">Rozkład prac</p><p className="mt-1 text-sm text-dim">Najczęściej planowane działania</p></div><span className="text-sm font-semibold text-[var(--brand)]">{total}</span></div>{breakdown.length === 0 ? <p className="py-10 text-center text-sm text-dim">Brak prac w wybranym okresie.</p> : <div className="space-y-4">{breakdown.map((item) => <div key={item.label}><div className="mb-1.5 flex items-center justify-between text-sm"><span className="font-semibold text-title">{item.label}</span><span className="font-bold text-[var(--brand)]">{item.value}</span></div><div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]"><div className="h-full rounded-full bg-[linear-gradient(90deg,#ff7a00,#ffad4d)]" style={{ width: `${(item.value / maxValue) * 100}%` }} /></div></div>)}</div>}</section><section className="rounded-xl border border-border bg-surface p-5"><p className="font-semibold text-title">Aktywność w czasie</p><p className="mt-1 text-sm text-dim">Liczba prac przypisanych każdego dnia</p>{chart.length < 2 ? <div className="flex h-64 flex-col items-center justify-center text-center"><p className="text-5xl font-bold text-[var(--brand)]">{total}</p><p className="mt-2 text-sm text-dim">Zbieramy kolejne dni, aby pokazać trend.</p></div> : <div className="mt-4 h-60"><ResponsiveContainer height="100%" width="100%"><BarChart data={chart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" stroke="var(--t-dim)" tickLine={false} /><YAxis allowDecimals={false} stroke="var(--t-dim)" tickLine={false} /><Tooltip contentStyle={{ background: '#0b0c10', border: '1px solid rgba(255,122,0,0.45)', borderRadius: 8 }} cursor={{ fill: 'rgba(255,122,0,0.08)' }} /><Bar dataKey="prace" fill="var(--brand)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>}</section></div>
    <WorkKindTrendCharts series={series} />
  </div>;
};

const WorkKindTrendCharts = ({ series }: { series: WorkKindSeries[] }) => <section className="rounded-xl border border-border bg-surface p-5">
  <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold text-title">Zadania w czasie</p><p className="mt-1 text-sm text-dim">Liczba poszczególnych prac w kolejnych dniach.</p></div><span className="text-xs font-semibold text-dim">Według wybranego okresu</span></div>
  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{series.map((item) => <div className="overflow-hidden rounded-lg border border-border bg-bg" key={item.id}><div className="flex items-center justify-between border-b border-border px-4 py-3"><p className="text-sm font-semibold text-title">{item.label}</p><span className="rounded border border-[rgba(255,122,0,0.55)] bg-[rgba(7,8,12,0.9)] px-2 py-0.5 text-sm font-bold text-[var(--brand)]">{item.total}</span></div><div className="h-36 px-2 py-2"><ResponsiveContainer height="100%" width="100%"><BarChart data={item.data} margin={{ top: 4, right: 2, left: -24, bottom: -4 }}><CartesianGrid stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" stroke="var(--t-dim)" tick={{ fontSize: 10 }} tickLine={false} /><YAxis allowDecimals={false} stroke="var(--t-dim)" tick={{ fontSize: 10 }} tickLine={false} /><Tooltip contentStyle={{ background: '#0b0c10', border: '1px solid rgba(255,122,0,0.45)', borderRadius: 8 }} cursor={{ fill: 'rgba(255,122,0,0.08)' }} /><Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></div>)}</div>
</section>;

const WorkHistoryDashboard = ({ history }: { history: PlanHistory[] }) => <section className="work-history-dashboard space-y-4">
  <div className="border-b border-border pb-4"><p className="font-semibold text-title">Historia przypisanych prac</p><p className="mt-1 text-sm text-dim">Snapshoty zadań dla zespołów. Nie jest to historia plików Excel.</p></div>
  {history.length === 0 ? <Card><p className="text-sm text-dim">Brak zapisanych prac. Snapshot pojawi się po pierwszym przypisaniu zadania.</p></Card> : history.map((entry) => <Card className="overflow-hidden p-0" key={entry.plan_date}><div className="border-b border-border px-5 py-4"><p className="font-semibold text-title">{new Date(`${entry.plan_date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</p><p className="mt-1 text-sm text-dim">{entry.tasks.length} przypisanych prac</p></div><div className="grid gap-px bg-border xl:grid-cols-3">{teamOptions.map((team) => { const queue = entry.tasks.filter((task) => task.teams.includes(team.id)); return <div className="min-h-28 bg-surface p-4" key={team.id}><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold" style={{ color: team.color }}>{team.label}</p><Badge>{queue.length}</Badge></div>{queue.length === 0 ? <p className="text-xs text-dim">Brak przypisanych prac.</p> : <div className="space-y-2">{queue.map((task, index) => { const labels = [...new Set(kindsForTeam(task, team.id))].map((id) => workKinds.find((kind) => kind.id === id)?.label).filter(Boolean).join(', '); return <div className="rounded border border-border bg-bg p-2.5" key={`${task.station}-${task.detail}-${index}`}><p className="text-xs font-semibold text-[var(--brand)]">- {task.station} {task.detail}</p><p className="mt-1 text-xs text-body">{labels || 'Zadanie'}{task.notes[team.id] ? `: ${task.notes[team.id]}` : ''}</p>{task.done && <p className="mt-1 text-xs font-semibold text-emerald-400">Wykonane</p>}</div>; })}</div>}</div>; })}</div></Card>)}</section>;

const hasYellowFill = (cell: XLSX.CellObject | undefined) => {
  const style = cell?.s as { fill?: { fgColor?: { rgb?: string } }; fgColor?: { rgb?: string } } | undefined;
  return [style?.fill?.fgColor?.rgb, style?.fgColor?.rgb].some((color) => color?.toUpperCase().endsWith('FFFF00'));
};

const parseTasks = (workbook: XLSX.WorkBook, sheetName: string): Task[] => {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const merges = sheet['!merges'] ?? [];
  const cellAt = (row: number, column: number) => {
    const direct = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
    const merge = merges.find((item) => row >= item.s.r && row <= item.e.r && column >= item.s.c && column <= item.e.c);
    return merge ? sheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })] : direct;
  };
  const valueAt = (row: number, column: number) => cellText(cellAt(row, column)?.w ?? cellAt(row, column)?.v);
  let planGroup: PlanGroup = 'standard';
  let lastProductionStation = '';
  let lastPanelNorm = '';
  let lastPlannedDate = '';
  const rows = data.flatMap((_, row) => {
    const detail = valueAt(row, 1);
    const sectionLabel = normalize(detail);
    if (sectionLabel === 'AWARYJNIE') {
      planGroup = 'emergency';
      lastProductionStation = '';
      lastPanelNorm = '';
      return [];
    }
    if (sectionLabel === 'NARZĘDZIOWNIA' || sectionLabel === 'LAKIERNIA') {
      planGroup = 'standard';
      lastProductionStation = '';
      lastPanelNorm = '';
      return [];
    }
    if (sectionLabel.includes('PLANOWANE ZMIANY FORM')) {
      planGroup = 'planned';
      lastProductionStation = '';
      lastPanelNorm = '';
      lastPlannedDate = '';
      return [];
    }
    const explicitStation = valueAt(row, 3);
    const quantity = valueAt(row, 2);
    const explicitNorm = valueAt(row, 4);
    const hasProductionValues = Boolean(quantity && explicitNorm);
    const plannedDate = planGroup === 'planned' ? valueAt(row, 0) : '';
    const continuesPlannedStation = Boolean(plannedDate && plannedDate === lastPlannedDate);
    const continuesPanelStation = Boolean(quantity && /^ST\s*[12]$/.test(normalize(lastProductionStation)));
    const station = explicitStation || (hasProductionValues || continuesPlannedStation || continuesPanelStation ? lastProductionStation : '');
    const norm = explicitNorm || (continuesPanelStation ? lastPanelNorm : '');
    if (explicitStation) {
      lastProductionStation = explicitStation;
      lastPanelNorm = /^ST\s*[12]$/.test(normalize(explicitStation)) ? explicitNorm : '';
    }
    if (plannedDate) lastPlannedDate = plannedDate;
    if (/^PANELE\s+(SE|BO)$/.test(sectionLabel)) return [];
    const header = `${detail} ${station}`.toUpperCase();
    if (!detail || !station || header.includes('NAZWA INDEKSU') || header.includes('STÓŁ LUB MASZYNA')) return [];
    const highlighted = Array.from({ length: 8 }, (_, column) => hasYellowFill(cellAt(row, column))).some(Boolean);
    return [{ id: `${sheetName}-${row}`, isCurrentPlan: true, planGroup, station, detail, quantity, norm, plannedDate, highlighted }];
  });

  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const nextOnSameStation = Boolean(previous && normalize(previous.station) === normalize(row.station) && normalize(previous.detail) !== normalize(row.detail));
    return {
      ...row,
      isCurrentPlan: true,
      planGroup: row.planGroup,
      highlighted: row.highlighted || nextOnSameStation,
      kinds: [],
      teams: [],
      notes: {},
      done: false,
      // Planned rows are informational and do not enter the material schedule.
      material: row.plannedDate,
      materialType: '',
      source: '',
      dryer: '',
      temperature: ''
    };
  });
};

const assignedForTheDay = (task: Task) => task.kinds.length > 0 || task.teams.length > 0 || Object.keys(task.notes).length > 0 || task.done;

const ensureUniqueTaskIds = (items: Task[]) => {
  const used = new Set<string>();
  return items.map((task, index) => {
    const baseId = String(task.id || `pozycja-${index + 1}`);
    const id = used.has(baseId) ? `${baseId}-pozycja-${index + 1}` : baseId;
    used.add(id);
    return id === task.id ? task : { ...task, id };
  });
};

const mergeImportedTasks = (importedTasks: Task[], existingTasks: Task[]) => {
  const remaining = [...existingTasks];
  const currentTasks = importedTasks.map((imported) => {
    const matchIndex = imported.planGroup === 'planned' ? -1 : remaining.findIndex((task) => task.planGroup !== 'planned' && normalize(task.station) === normalize(imported.station) && normalize(task.detail) === normalize(imported.detail));
    if (matchIndex < 0) return imported;
    const previous = remaining.splice(matchIndex, 1)[0];
    return {
      ...previous,
      ...imported,
      id: previous.id,
      isCurrentPlan: true,
      highlighted: previous.highlighted || imported.highlighted,
      kinds: previous.isCurrentPlan ? previous.kinds : previous.kinds.filter((kind) => kind !== 'anulowane'),
      teams: previous.teams,
      notes: previous.notes,
      done: previous.done,
      material: previous.material,
      materialType: previous.materialType,
      source: previous.source,
      dryer: previous.dryer,
      temperature: previous.temperature
    };
  });
  const retainedWork = remaining
    .filter((task) => assignedForTheDay(task) && task.planGroup !== 'planned')
    .map((task) => isManualTask(task) ? { ...task, isCurrentPlan: false } : { ...task, isCurrentPlan: false, kinds: [...new Set([...task.kinds, 'anulowane' as WorkKind])] });
  return ensureUniqueTaskIds([...currentTasks, ...retainedWork]);
};

export default function PrzygotowanieProdukcjiPage() {
  const searchParams = useSearchParams();
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<PlanHistory[]>([]);
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month' | 'all'>('month');
  const [importing, setImporting] = useState(false);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedQueueTask, setCopiedQueueTask] = useState<string | null>(null);
  const [editingQueueTask, setEditingQueueTask] = useState<string | null>(null);
  const [showManualTaskForm, setShowManualTaskForm] = useState(false);
  const [manualTaskText, setManualTaskText] = useState('');
  const [manualTaskTeams, setManualTaskTeams] = useState<Team[]>([]);
  const sheetNames = workbook?.SheetNames ?? [];
  const activeView = searchParams.get('view') === 'material' ? 'material' : searchParams.get('view') === 'work-plan' ? 'work-plan' : searchParams.get('view') === 'history' ? 'history' : searchParams.get('view') === 'report' ? 'report' : 'plan';

  const apiRequest = async <T,>(body?: unknown) => {
    const response = await fetch('/api/przygotowanie-produkcji', body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    } : undefined);
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(error?.message ?? 'Nie udało się zapisać przygotowania produkcji.');
    }
    return response.json() as Promise<T>;
  };

  useEffect(() => {
    let active = true;
    fetch('/api/przygotowanie-produkcji')
      .then((response) => response.ok ? response.json() as Promise<StoredPlan> : Promise.reject())
      .then((data) => {
        if (!active || !data.session) return;
        setFileName(data.session.file_name ?? '');
        setSheetName(data.session.plan_sheet ?? '');
        setTasks(data.tasks ?? []);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoadingSavedPlan(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    fetch('/api/przygotowanie-produkcji?history=1')
      .then((response) => response.ok ? response.json() as Promise<{ history: PlanHistory[] }> : Promise.reject())
      .then((data) => setHistory(data.history ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    loadWorkbookLocally()
      .then((savedWorkbook) => {
        if (!active || !savedWorkbook) return;
        const restoredWorkbook = XLSX.read(savedWorkbook.buffer, { type: 'array', cellStyles: true });
        setWorkbook(restoredWorkbook);
        setFileName((current) => current || savedWorkbook.fileName);
        setSheetName((current) => restoredWorkbook.SheetNames.includes(current) ? current : defaultSheetName(restoredWorkbook.SheetNames, savedWorkbook.fileName));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const savePlan = async (nextTasks: Task[], nextFileName: string, nextSheetName: string) => {
    setSaveState('saving');
    setSaveError(null);
    try {
      await apiRequest({ action: 'savePlan', tasks: nextTasks, fileName: nextFileName, sheetName: nextSheetName });
      const historyResponse = await fetch('/api/przygotowanie-produkcji?history=1');
      if (historyResponse.ok) {
        const data = await historyResponse.json() as { history: PlanHistory[] };
        setHistory(data.history ?? []);
      }
      setSaveState('saved');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Nie udało się zapisać przygotowania produkcji.');
      setSaveState('error');
    }
  };

  const saveTask = async (task: Task) => {
    setSaveState('saving');
    setSaveError(null);
    try {
      await apiRequest({ action: 'updateTask', task });
      const historyResponse = await fetch('/api/przygotowanie-produkcji?history=1');
      if (historyResponse.ok) {
        const data = await historyResponse.json() as { history: PlanHistory[] };
        setHistory(data.history ?? []);
      }
      setSaveState('saved');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Nie udało się zapisać przygotowania produkcji.');
      setSaveState('error');
    }
  };

  const selectSheet = (nextSheet: string) => {
    if (!workbook) return;
    const nextTasks = mergeImportedTasks(parseTasks(workbook, nextSheet), tasks);
    setSheetName(nextSheet);
    setTasks(nextTasks);
    void savePlan(nextTasks, fileName, nextSheet);
  };

  const importPlan = async (file: File | null) => {
    if (!file) return;
    if (loadingSavedPlan) return;
    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const nextWorkbook = XLSX.read(buffer, { type: 'array', cellStyles: true });
      const nextSheet = defaultSheetName(nextWorkbook.SheetNames, file.name);
      const nextTasks = mergeImportedTasks(parseTasks(nextWorkbook, nextSheet), tasks);
      setWorkbook(nextWorkbook);
      setFileName(file.name);
      setSheetName(nextSheet);
      setTasks(nextTasks);
      await saveWorkbookLocally(buffer, file.name);
      await savePlan(nextTasks, file.name, nextSheet);
    } finally {
      setImporting(false);
    }
  };

  const updateTask = (id: string, patch: Partial<Task>) => setTasks((current) => current.map((task) => {
    if (task.id !== id) return task;
    const next = { ...task, ...patch };
    void saveTask(next);
    return next;
  }));
  const addManualTask = () => {
    const detail = manualTaskText.trim();
    if (!detail || manualTaskTeams.length === 0) return;
    const nextTasks = [...tasks, {
      id: `zadanie-reczne-${Date.now()}`,
      isCurrentPlan: false,
      planGroup: 'standard' as PlanGroup,
      station: 'ZADANIE DODATKOWE',
      detail,
      quantity: '',
      norm: '',
      highlighted: false,
      kinds: ['inne' as WorkKind],
      teams: manualTaskTeams,
      notes: {},
      done: false,
      material: '',
      materialType: '',
      source: '',
      dryer: '',
      temperature: ''
    }];
    setTasks(nextTasks);
    setManualTaskText('');
    setManualTaskTeams([]);
    setShowManualTaskForm(false);
    void savePlan(nextTasks, fileName, sheetName);
  };
  const toggleKind = (task: Task, kind: WorkKind) => {
    const adding = !task.kinds.includes(kind);
    const addedKinds = adding && kind === 'zmiana-formy' ? [kind, 'rozruch' as WorkKind] : [kind];
    const kinds = [...new Set(adding ? [...task.kinds, ...addedKinds] : task.kinds.filter((item) => item !== kind))];
    const addedTeams = adding ? addedKinds.flatMap((item) => automaticTeams[item] ?? []) : [];
    const teams = [...new Set([...task.teams, ...addedTeams])];
    let notes = addedTeams.includes('distribution') && !task.notes.distribution ? { ...task.notes, distribution: 'Przygotować stanowisko' } : task.notes;
    if (adding && kind === 'forma-narzedziownia' && !notes.process) {
      notes = { ...notes, process: 'Wznowienie procesu po powrocie z narzędziowni.' };
    }
    updateTask(task.id, { kinds, teams, notes });
  };
  const toggleTeam = (task: Task, team: Team) => {
    const adding = !task.teams.includes(team);
    const teams = adding ? [...task.teams, team] : task.teams.filter((item) => item !== team);
    const notes = adding && team === 'distribution' && !task.notes.distribution ? { ...task.notes, distribution: 'Przygotować stanowisko' } : task.notes;
    updateTask(task.id, { teams, notes });
  };
  const activeTasks = useMemo(() => tasks.filter((task) => task.isCurrentPlan && task.station && task.planGroup !== 'planned' && !isPanelGroupHeader(task)), [tasks]);
  const plannedTasks = useMemo(() => tasks.filter((task) => task.isCurrentPlan && task.station && task.planGroup === 'planned'), [tasks]);
  const reportDays = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const allDays = [
      ...history
        .filter((entry) => entry.plan_date !== today)
        .map((entry) => ({ date: entry.plan_date, tasks: entry.tasks })),
      { date: today, tasks }
    ];
    if (reportPeriod === 'all') return allDays;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (reportPeriod === 'week' ? 6 : 29));
    return allDays.filter((entry) => new Date(`${entry.date}T12:00:00`) >= from);
  }, [history, reportPeriod, tasks]);

  const workReport = useMemo(() => {
    const totals = Object.fromEntries(reportKinds.map((kind) => [kind.id, { total: 0, done: 0 }])) as Record<ReportKind, { total: number; done: number }>;
    reportDays.flatMap((entry) => entry.tasks).forEach((task) => {
      (task.kinds ?? []).forEach((kind) => {
        if (!Object.prototype.hasOwnProperty.call(totals, kind)) return;
        totals[kind as WorkKind].total += 1;
        if (task.done) totals[kind as WorkKind].done += 1;
      });
      if (preparesDistributionStation(task)) {
        totals['przygotowanie-stanowiska'].total += 1;
        if (task.done) totals['przygotowanie-stanowiska'].done += 1;
      }
      if (restartsProcessAfterToolroom(task)) {
        totals['wznowienie-procesu'].total += 1;
        if (task.done) totals['wznowienie-procesu'].done += 1;
      }
    });
    return totals;
  }, [reportDays]);

  const reportChart = useMemo(() => reportDays
    .map((entry) => ({
      dateKey: entry.date,
      date: new Date(`${entry.date}T12:00:00`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }),
      prace: entry.tasks.reduce((total, task) => total + (task.kinds?.length ?? 0) + (preparesDistributionStation(task) ? 1 : 0) + (restartsProcessAfterToolroom(task) ? 1 : 0), 0)
    }))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey)), [reportDays]);

  const workKindSeries = useMemo<WorkKindSeries[]>(() => reportKinds.map((kind) => {
    const data = reportDays
      .map((entry) => ({
        dateKey: entry.date,
        date: new Date(`${entry.date}T12:00:00`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }),
        value: entry.tasks.reduce((total, task) => {
          if (kind.id === 'przygotowanie-stanowiska') {
            return total + (preparesDistributionStation(task) ? 1 : 0);
          }
          if (kind.id === 'wznowienie-procesu') return total + (restartsProcessAfterToolroom(task) ? 1 : 0);
          return total + (task.kinds?.includes(kind.id) ? 1 : 0);
        }, 0)
      }))
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
    return { id: kind.id, label: kind.label, total: data.reduce((sum, item) => sum + item.value, 0), data };
  }), [reportDays]);

  const removeTaskFromTeam = (task: Task, team: Team) => {
    const notes = { ...task.notes };
    delete notes[team];
    updateTask(task.id, { teams: task.teams.filter((item) => item !== team), notes });
  };

  const clearTaskWork = (task: Task) => {
    updateTask(task.id, { kinds: [], teams: [], notes: {} });
  };

  const clearAllAssignments = () => {
    if (!window.confirm('Usunąć wszystkie przypisania, uwagi i statusy wykonania z bieżącego planu?')) return;
    const nextTasks = tasks.map((task) => ({ ...task, kinds: [], teams: [], notes: {}, done: false }));
    setTasks(nextTasks);
    void savePlan(nextTasks, fileName, sheetName);
  };

  const copyQueueTask = async (task: Task, team: Team) => {
    const kindLabels = [...new Set(kindsForTeam(task, team))]
      .map((id) => workKinds.find((item) => item.id === id)?.label)
      .filter(Boolean)
      .join(', ');
    const lines = [
      `- ${task.station} ${task.detail}`,
      !isManualTask(task) ? `Ilość: ${task.quantity || '---'} | Norma: ${task.norm || '---'}` : '',
      [kindLabels, task.notes[team]].filter(Boolean).join(': '),
      !isManualTask(task) && teamsWith5s.includes(team) ? standard5s : ''
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join('\n'));
    const copyId = `${team}-${task.id}`;
    setCopiedQueueTask(copyId);
    window.setTimeout(() => setCopiedQueueTask((current) => current === copyId ? null : current), 1800);
  };

  const copyTeamQueue = async (team: Team, queue: Task[]) => {
    if (!queue.length) return;
    const rows = queue.map((task) => {
      const kindLabels = [...new Set(kindsForTeam(task, team))]
        .map((id) => workKinds.find((item) => item.id === id)?.label)
        .filter(Boolean)
        .join(', ');
      return [
        `- ${task.station} ${task.detail}`,
        !isManualTask(task) ? `Ilość: ${task.quantity || '---'} | Norma: ${task.norm || '---'}` : '',
        [kindLabels, task.notes[team]].filter(Boolean).join(': '),
        !isManualTask(task) && teamsWith5s.includes(team) ? standard5s : ''
      ].filter(Boolean).join(' | ');
    });
    await navigator.clipboard.writeText(rows.join('\r\n'));
    const copyId = `column-${team}`;
    setCopiedQueueTask(copyId);
    window.setTimeout(() => setCopiedQueueTask((current) => current === copyId ? null : current), 1800);
  };

  return (
    <div className="production-preparation w-full max-w-none space-y-4">
      <style jsx>{`
        .production-preparation article input[type='checkbox'] {
          accent-color: #ff7a00;
        }

        .production-queues > div > div:last-child {
          padding: 0.25rem;
        }

        .production-queues > div {
          padding: 0 !important;
        }

        .production-queues > div > div:last-child > div > button {
          padding: 0.75rem;
        }

        .production-queues > div > div:last-child > div {
          position: relative;
          border-color: rgba(255, 255, 255, 0.12);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
        }

        .production-queues > div > div:last-child > div > button:first-child {
          padding: 0.65rem 3.25rem 0.65rem 0.7rem !important;
        }

        .production-queues > div > div:last-child > div > div:nth-child(2) {
          position: absolute;
          top: 0.45rem;
          right: 0.45rem;
          gap: 0.25rem;
          border: 0;
          padding: 0;
        }

        .production-queues > div > div:last-child > div > div:nth-child(2) button {
          width: 1.55rem;
          height: 1.55rem;
        }

        .production-queues > div > div:last-child > div > div:nth-child(2) svg {
          width: 0.8rem;
          height: 0.8rem;
        }

        .production-queues .space-y-2 > div {
          position: relative;
        }

        .production-queues .space-y-2 > div > button:first-child {
          padding-right: 2.35rem !important;
        }

        .production-queues .flex.justify-end {
          position: absolute !important;
          top: 0.45rem;
          right: 0.45rem;
          flex-direction: column;
          gap: 0.25rem !important;
          border: 0 !important;
          padding: 0 !important;
        }

        .production-queues .flex.justify-end button {
          width: 1.55rem !important;
          height: 1.55rem !important;
        }

        .production-queues .flex.justify-end svg {
          width: 0.8rem !important;
          height: 0.8rem !important;
        }

        @media (max-width: 767px) {
          .production-preparation article {
            padding: 0.75rem;
          }

          .production-preparation article > div:first-child {
            display: block;
          }

          .production-preparation article section {
            border: 0;
            border-radius: 0;
            background: transparent;
            padding: 0.8rem 0;
          }

          .production-preparation article section + section {
            border-top: 1px solid var(--border);
          }

          .production-preparation article section:nth-child(2) > div {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .production-preparation article section:nth-child(3) > div {
            grid-template-columns: minmax(0, 1fr);
          }

          .production-preparation article section:nth-child(2) label,
          .production-preparation article section:nth-child(3) label {
            border-left: 0;
            border-right: 0;
            border-top: 0;
            border-radius: 0;
            padding-left: 0.15rem;
            padding-right: 0.15rem;
          }

          .production-queues {
            width: 100%;
          }

          .production-queues > div {
            min-width: 0;
            width: 100%;
          }

          .production-queues > div > div:last-child {
            padding: 0.25rem;
          }

          .production-queues > div > div:last-child > div > button {
            padding: 0.625rem;
          }
        }
      `}</style>
      <Tabs value={activeView} className="space-y-4">
        {(activeView === 'plan' || activeView === 'material') && <div className="w-full">
          <label className="block w-full">
            <input className="hidden" accept=".xlsx,.xls" onChange={(event) => importPlan(event.target.files?.[0] ?? null)} type="file" />
            <Button asChild className="w-full" disabled={importing || loadingSavedPlan} variant="primaryEmber"><span><Upload className="mr-2 h-4 w-4" />{loadingSavedPlan ? 'Wczytywanie zapisanych danych...' : importing ? 'Wczytywanie...' : 'Wgraj plan Excel'}</span></Button>
          </label>
        </div>}
        {(activeView === 'plan' || activeView === 'material') && sheetNames.length > 0 && <label className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-dim">
          Arkusz planu
          <select className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-2 font-semibold text-title outline-none focus:border-[rgba(255,122,0,0.65)]" onChange={(event) => selectSheet(event.target.value)} value={sheetName}>
            {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>}
        {saveState === 'error' && <div className="rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">Plan nie został zapisany. {saveError ?? 'Spróbuj ponownie.'}</div>}

        <TabsContent value={activeView === 'work-plan' ? 'work-plan' : 'plan'} className="space-y-4">
          {(activeView === 'work-plan' || activeTasks.length > 0 || plannedTasks.length > 0) && <>
            {activeView === 'plan' && activeTasks.length > 0 && <Card className="border-0 bg-transparent p-0 shadow-none">
              <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-title">Pozycje do omówienia</p><p className="mt-1 text-sm text-dim">Wybierz rodzaj pracy, a właściwe zespoły zostaną zaznaczone automatycznie.</p></div><Button className="min-h-10 px-3 py-2 text-xs" onClick={clearAllAssignments} type="button" variant="ghost"><Trash2 className="mr-1.5 h-4 w-4" />Kasuj przypisania</Button></div>
              <div className="space-y-3 p-0">
                {activeTasks.map((task, index) => {
                  const startsGroup = index === 0 || activeTasks[index - 1].planGroup !== task.planGroup;
                  return <div className="space-y-3" key={task.id}>
                  {startsGroup && task.planGroup !== 'standard' && <div className={cn('rounded-lg border px-3 py-2 text-sm font-bold uppercase tracking-wide', task.planGroup === 'emergency' ? 'border-[rgba(239,68,68,0.65)] bg-[rgba(239,68,68,0.12)] text-red-300' : 'border-[rgba(183,122,255,0.65)] bg-[rgba(183,122,255,0.12)] text-[#debaff]')}>{planGroupLabel[task.planGroup]}</div>}
                <article className={cn('rounded-lg border border-border bg-surface2 p-4', task.highlighted && 'border-[rgba(245,197,66,0.65)] bg-[rgba(245,197,66,0.07)]', task.done && 'border-[rgba(34,197,94,0.65)] bg-[rgba(34,197,94,0.07)]', task.kinds.includes('anulowane') && 'border-slate-400/70 bg-slate-400/10')}>
                  <div className="grid gap-3 xl:grid-cols-[minmax(280px,1fr)_minmax(420px,1.3fr)_minmax(420px,1.3fr)]">
                    <section className={cn('space-y-2 rounded-lg border border-[rgba(255,122,0,0.35)] bg-[rgba(255,122,0,0.045)] p-3', task.highlighted && 'border-yellow-400 bg-yellow-300')}>
                      <p className={cn('text-[10px] font-bold uppercase tracking-wide text-[var(--brand)]', task.highlighted && 'text-zinc-800')}>Indeks</p>
                      <div className={cn('flex min-h-11 w-full items-center justify-center rounded-lg border border-[rgba(255,122,0,0.55)] bg-bg px-3 text-center text-base font-bold text-[var(--brand)]', task.highlighted && 'border-yellow-500 bg-yellow-200 text-zinc-950')}>{task.station}</div>
                      <div><textarea className={cn('min-h-14 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm font-semibold text-[var(--brand)] outline-none focus:border-[rgba(255,122,0,0.65)]', task.highlighted && 'border-yellow-500 bg-yellow-100 text-zinc-950 focus:border-yellow-600')} value={task.detail} onChange={(event) => updateTask(task.id, { detail: event.target.value })} /><p className={cn('mt-1 text-xs text-dim', task.highlighted && 'text-zinc-700')}>Ilość: <strong className={cn('text-title', task.highlighted && 'text-zinc-950')}>{task.quantity || '---'}</strong> &nbsp; Norma: <strong className={cn('text-title', task.highlighted && 'text-zinc-950')}>{task.norm || '---'}</strong></p></div>
                    </section>
                    <section className="rounded-lg border border-border p-3" style={{ backgroundImage: 'linear-gradient(rgba(10,11,15,0.87), rgba(10,11,15,0.87)), url(/przygotowanie-produkcji-techniczne-tlo.png)', backgroundPosition: 'center', backgroundSize: 'cover' }}>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--brand)]">Praca</p>
                      <div className="grid grid-cols-3 gap-1.5">{workKinds.map((kind) => <label className={cn('flex min-h-10 items-center justify-start gap-2 rounded-lg border border-border px-3 text-left text-[11px] font-semibold text-dim transition-colors hover:border-[rgba(255,122,0,0.5)]', task.kinds.includes(kind.id) && 'border-[rgba(255,122,0,0.85)] text-title')} key={kind.id} style={taskChoiceBackground(task.kinds.includes(kind.id))}><input checked={task.kinds.includes(kind.id)} onChange={() => toggleKind(task, kind.id)} type="checkbox" />{kind.label}</label>)}</div>
                    </section>
                    <section className="rounded-lg border border-border p-3" style={{ backgroundImage: 'linear-gradient(rgba(10,11,15,0.87), rgba(10,11,15,0.87)), url(/przygotowanie-produkcji-techniczne-tlo.png)', backgroundPosition: 'right center', backgroundSize: 'cover' }}>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--brand)]">Osoby</p>
                      <div className="grid grid-cols-2 gap-1.5">{teamOptions.map((team) => <label className={cn('flex min-h-10 w-full items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-dim transition-colors hover:border-[rgba(255,122,0,0.5)]', task.teams.includes(team.id) && 'border-[rgba(255,122,0,0.85)] text-title')} key={team.id} style={taskChoiceBackground(task.teams.includes(team.id))}><input checked={task.teams.includes(team.id)} onChange={() => toggleTeam(task, team.id)} type="checkbox" />{team.label}</label>)}</div>
                    </section>
                  </div>
                  {task.teams.length > 0 && <div className="mt-3 grid gap-2 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-3">{teamOptions.filter((team) => task.teams.includes(team.id)).map((team) => <label className="text-xs text-dim" key={team.id}>{team.id === 'additional' ? 'Informacja dodatkowa' : `Uwagi dla: ${team.label}`}<Input className="mt-1" value={task.notes[team.id] ?? ''} onChange={(event) => updateTask(task.id, { notes: { ...task.notes, [team.id]: event.target.value } })} placeholder="Dodaj ustalenie" /></label>)}</div>}
                </article>
                  </div>;
                })}
              </div>
            </Card>}
            {activeView === 'plan' && plannedTasks.length > 0 && <Card className="overflow-hidden border-[rgba(183,122,255,0.45)] bg-[rgba(183,122,255,0.055)] p-0"><div className="border-b border-[rgba(183,122,255,0.3)] px-4 py-3"><p className="font-semibold text-[#debaff]">Planowane zmiany form</p><p className="mt-1 text-xs text-dim">Informacja na kolejne dni. Te pozycje nie trafiają do dzisiejszego planu pracy.</p></div><div className="divide-y divide-border">{plannedTasks.map((task) => <div className="grid gap-1 px-4 py-3 sm:grid-cols-[90px_90px_minmax(0,1fr)_auto] sm:items-center" key={task.id}><p className="text-xs font-semibold text-[#debaff]">{task.material || 'Termin —'}</p><p className="text-xs font-bold text-[var(--brand)]">{task.station}</p><p className="text-sm font-semibold text-title">{task.detail}</p><p className="text-xs text-dim">Ilość: <strong className="text-title">{task.quantity || '—'}</strong>{task.norm ? <> · Norma: <strong className="text-title">{task.norm}</strong></> : null}</p></div>)}</div></Card>}
            {activeView === 'work-plan' && <Card className="border-border bg-surface2 p-3"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-title">Zadania dodatkowe</p><p className="mt-0.5 text-xs text-dim">Dodaj pracę niezwiązaną z konkretnym planem lub maszyną.</p></div><Button className="min-h-9 shrink-0 px-3 py-2 text-xs" onClick={() => setShowManualTaskForm((current) => !current)} type="button" variant="outline"><Plus className="mr-1.5 h-3.5 w-3.5" />Dodaj zadanie</Button></div>{showManualTaskForm && <div className="mt-3 grid gap-2 border-t border-border pt-3 lg:grid-cols-[minmax(0,1fr)_auto]"><textarea className="min-h-20 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm text-title outline-none focus:border-[rgba(255,122,0,0.65)]" onChange={(event) => setManualTaskText(event.target.value)} placeholder="Np. Posprzątać magazyn lub przekazać formę do narzędziowni" value={manualTaskText} /><div className="space-y-2"><div className="grid grid-cols-2 gap-1.5">{teamOptions.map((team) => <label className={cn('flex min-h-9 items-center gap-2 rounded border border-border px-2 text-xs font-semibold text-dim', manualTaskTeams.includes(team.id) && 'border-[rgba(255,122,0,0.85)] bg-[rgba(255,122,0,0.12)] text-title')} key={team.id}><input checked={manualTaskTeams.includes(team.id)} onChange={() => setManualTaskTeams((current) => current.includes(team.id) ? current.filter((item) => item !== team.id) : [...current, team.id])} type="checkbox" />{team.label}</label>)}</div><div className="flex justify-end gap-2"><Button className="min-h-9 px-3 py-2 text-xs" onClick={() => { setShowManualTaskForm(false); setManualTaskText(''); setManualTaskTeams([]); }} type="button" variant="ghost">Anuluj</Button><Button className="min-h-9 px-3 py-2 text-xs" disabled={!manualTaskText.trim() || manualTaskTeams.length === 0} onClick={addManualTask} type="button" variant="primaryEmber">Dodaj</Button></div></div></div>}</Card>}
            {activeView === 'work-plan' && <div className="production-queues grid w-full gap-2 text-[11px] lg:grid-cols-6">{teamOptions.map((team) => {
              const queue = tasks.filter((task) => {
                if (isPanelGroupHeader(task)) return false;
                if (!task.teams.includes(team.id)) return false;
                return !(task.kinds.length === 1 && task.kinds[0] === 'przeglad-a' && ['mechanics', 'distribution', 'technician'].includes(team.id));
              });
              const columnCopyId = `column-${team.id}`;
              return <Card className="overflow-hidden p-0" key={team.id}><div className="h-[3px]" style={{ backgroundColor: team.color }} /><div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2"><Wrench className="h-4 w-4" style={{ color: team.color }} /><h2 className="font-semibold text-title">{team.label}</h2></div><div className="flex items-center gap-2"><button aria-label={`Kopiuj wszystkie zadania: ${team.label}`} className="flex h-8 w-8 items-center justify-center rounded border border-border text-dim transition hover:border-[rgba(255,122,0,0.65)] hover:text-[var(--brand)] disabled:cursor-not-allowed disabled:opacity-40" disabled={queue.length === 0} onClick={() => void copyTeamQueue(team.id, queue)} title="Kopiuj całą kolumnę" type="button"><Copy className="h-4 w-4" /></button><Badge>{queue.filter((task) => !task.done).length}</Badge></div></div>{copiedQueueTask === columnCopyId && <p className="border-b border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-400">Skopiowano całą kolumnę.</p>}<div className="space-y-2 p-3">{queue.length === 0 ? <p className="text-sm text-dim">Brak przypisanych prac.</p> : queue.map((task) => { const copyId = `${team.id}-${task.id}`; const kindLabels = [...new Set(kindsForTeam(task, team.id))].map((id) => workKinds.find((item) => item.id === id)?.label).filter(Boolean).join(', '); const editing = editingQueueTask === copyId; const showProductionMetrics = !isManualTask(task) && !['mechanics', 'process', 'technician'].includes(team.id); return <div className={cn('rounded-lg border border-border bg-bg', task.kinds.includes('anulowane') && 'border-slate-400/70 bg-slate-400/10')} key={task.id}><button aria-label={`Kopiuj zadanie ${task.station}`} className={cn('w-full select-text p-3 text-left hover:bg-surface2', task.done && 'border-[rgba(34,197,94,0.65)]')} onClick={() => void copyQueueTask(task, team.id)} type="button"><p className="font-semibold text-[var(--brand)]">- {task.station} {task.detail}</p>{showProductionMetrics && <p className="mt-1 text-xs text-body">Ilość: {task.quantity || '---'} | Norma: {task.norm || '---'}</p>}<p className="mt-1 text-xs text-body">{kindLabels}{task.notes[team.id] ? `: ${task.notes[team.id]}` : ''}</p>{!isManualTask(task) && teamsWith5s.includes(team.id) && <p className="mt-1 text-xs text-body">{standard5s}</p>}{copiedQueueTask === copyId && <p className="mt-2 text-xs font-semibold text-emerald-400">Skopiowano do schowka.</p>}</button><div className="flex justify-end gap-1.5 border-t border-border p-2"><button aria-label={editing ? 'Zamknij edycję' : 'Edytuj zadanie'} className="flex h-8 w-8 items-center justify-center rounded border border-border text-dim hover:border-[rgba(255,122,0,0.65)] hover:text-title" onClick={() => setEditingQueueTask(editing ? null : copyId)} title={editing ? 'Zamknij edycję' : 'Edytuj zadanie'} type="button"><Pencil className="h-4 w-4" /></button><button aria-label="Usuń zadanie z tego działu" className="flex h-8 w-8 items-center justify-center rounded border border-red-500/45 text-red-300 hover:bg-red-500/10" onClick={() => { removeTaskFromTeam(task, team.id); setEditingQueueTask(null); }} title="Usuń zadanie z tego działu" type="button"><X className="h-4 w-4" /></button></div>{editing && <div className="space-y-3 border-t border-border p-3"><div className="grid grid-cols-2 gap-1.5">{workKinds.map((kind) => <label className={cn('flex min-h-8 items-center gap-2 rounded border border-border px-2 text-[11px] font-semibold text-dim', task.kinds.includes(kind.id) && 'border-[rgba(255,122,0,0.65)] bg-[rgba(255,122,0,0.12)] text-title')} key={kind.id}><input checked={task.kinds.includes(kind.id)} onChange={() => toggleKind(task, kind.id)} type="checkbox" />{kind.label}</label>)}</div><label className="block text-xs font-semibold text-dim">Uwagi dla: {team.label}<Input className="mt-1" value={task.notes[team.id] ?? ''} onChange={(event) => updateTask(task.id, { notes: { ...task.notes, [team.id]: event.target.value } })} placeholder="Dodaj ustalenie" /></label><button className="flex w-full items-center justify-center gap-2 rounded border border-red-500/45 px-3 py-2 text-xs font-semibold text-red-300" onClick={() => { clearTaskWork(task); setEditingQueueTask(null); }} type="button"><Trash2 className="h-3.5 w-3.5" />Usuń całą pracę z kolejek</button></div>}</div>; })}</div></Card>;
            })}</div>}
          </>}
        </TabsContent>

        <TabsContent value="material" className="space-y-4">
          {!activeTasks.length ? <EmptyState title="Brak rozpiski" description="Wgraj plan produkcyjny, aby przygotować rozpiszę materiałową." /> : <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><p className="font-semibold text-title">Rozpiska materiałowa</p><p className="mt-1 text-sm text-dim">Materiał, źródło i suszarkę uzupełniasz dla pozycji z importowanego planu.</p></div><div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-left text-sm"><thead className="bg-surface2 text-xs uppercase text-dim"><tr>{['Stanowisko', 'Indeks', 'Materiał', 'Rodzaj', 'Źródło', 'Suszarka', 'Temp.'].map((label) => <th className="border-b border-border px-4 py-3 font-semibold" key={label}>{label}</th>)}</tr></thead><tbody>{activeTasks.map((task) => <tr className={cn('border-b border-border/80', task.highlighted && 'bg-[rgba(245,197,66,0.06)]')} key={task.id}><td className="px-4 py-3 font-bold text-[var(--brand)]">{task.station}</td><td className="max-w-[290px] px-4 py-3 font-semibold text-title">{task.detail}</td><td className="px-2 py-2"><Input value={task.material} onChange={(event) => updateTask(task.id, { material: event.target.value })} /></td><td className="px-2 py-2"><Input value={task.materialType} onChange={(event) => updateTask(task.id, { materialType: event.target.value, temperature: temperatureFor(event.target.value) || task.temperature })} /></td><td className="px-2 py-2"><Input value={task.source} onChange={(event) => updateTask(task.id, { source: event.target.value })} /></td><td className="px-2 py-2"><Input value={task.dryer} onChange={(event) => updateTask(task.id, { dryer: event.target.value })} /></td><td className="px-2 py-2"><Input value={task.temperature} onChange={(event) => updateTask(task.id, { temperature: event.target.value })} /></td></tr>)}</tbody></table></div></Card>}
        </TabsContent>
        <TabsContent value="history" className="work-history space-y-4">
          <WorkHistoryDashboard history={history} />
          <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><p className="font-semibold text-title">Historia planów</p><p className="mt-1 text-sm text-dim">Końcowe przypisania z każdego dnia, gotowe do późniejszych analiz.</p></div>{history.length === 0 ? <div className="px-5 py-8 text-sm text-dim">Brak zapisanych dni. Pierwszy snapshot pojawi się po rozpoczęciu kolejnego dnia.</div> : <div className="divide-y divide-border">{history.map((entry) => { const counts = entry.tasks.flatMap((task) => Array.isArray(task.kinds) ? task.kinds : []).reduce<Record<string, number>>((result, kind) => ({ ...result, [kind]: (result[kind] ?? 0) + 1 }), {}); return <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between" key={entry.plan_date}><div><p className="font-semibold text-title">{new Date(`${entry.plan_date}T12:00:00`).toLocaleDateString('pl-PL')}</p><p className="mt-1 text-xs text-dim">{entry.file_name || 'Plan produkcyjny'}{entry.plan_sheet ? ` · arkusz ${entry.plan_sheet}` : ''} · {entry.tasks.length} przypisań</p></div><div className="flex flex-wrap gap-2">{Object.entries(counts).map(([kind, count]) => <Badge key={kind}>{workKinds.find((item) => item.id === kind)?.label ?? kind}: {count}</Badge>)}</div></div>; })}</div>}</Card>
        </TabsContent>
        <TabsContent value="report" className="production-report space-y-4">
          <WorkReportDashboard chart={reportChart} dayCount={reportDays.length} onPeriodChange={setReportPeriod} period={reportPeriod} report={workReport} series={workKindSeries} />
          <Card className="overflow-hidden p-0"><div className="border-b border-border bg-[linear-gradient(135deg,rgba(255,122,0,0.16),rgba(255,255,255,0.02))] px-5 py-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-dim">Podsumowanie przygotowania produkcji</p><p className="mt-1 text-2xl font-semibold text-title">Raport prac</p></div><div className="flex flex-wrap gap-2">{([{ id: 'week', label: 'Tydzień' }, { id: 'month', label: 'Miesiąc' }, { id: 'all', label: 'Wszystko' }] as const).map((period) => <Button className={cn('min-h-10 px-4 py-2 text-xs', reportPeriod === period.id && 'bg-[rgba(255,122,0,0.18)] text-title')} key={period.id} onClick={() => setReportPeriod(period.id)} type="button" variant={reportPeriod === period.id ? 'secondary' : 'outline'}>{period.label}</Button>)}</div></div></div><div className="grid gap-px bg-border sm:grid-cols-3"><div className="bg-surface px-5 py-4"><p className="text-xs font-semibold uppercase text-dim">Wszystkie prace</p><p className="mt-2 text-3xl font-bold text-[var(--brand)]">{Object.values(workReport).reduce((sum, item) => sum + item.total, 0)}</p></div><div className="bg-surface px-5 py-4"><p className="text-xs font-semibold uppercase text-dim">Dni w okresie</p><p className="mt-2 text-3xl font-bold text-title">{reportDays.length}</p></div><div className="bg-surface px-5 py-4"><p className="text-xs font-semibold uppercase text-dim">Wykonane</p><p className="mt-2 text-3xl font-bold text-title">{Object.values(workReport).reduce((sum, item) => sum + item.done, 0)}</p></div></div></Card><div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]"><Card className="p-4"><p className="mb-4 font-semibold text-title">Prace w czasie</p><div className="h-72"><ResponsiveContainer height="100%" width="100%"><BarChart data={reportChart}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" stroke="var(--t-dim)" tickLine={false} /><YAxis allowDecimals={false} stroke="var(--t-dim)" tickLine={false} width={28} /><Tooltip contentStyle={{ background: '#0b0c10', border: '1px solid rgba(255,122,0,0.45)', borderRadius: 8 }} cursor={{ fill: 'rgba(255,122,0,0.08)' }} /><Bar dataKey="prace" fill="var(--brand)" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></Card><Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><p className="font-semibold text-title">Rodzaje prac</p></div><div className="divide-y divide-border">{workKinds.map((kind) => <div className="flex items-center justify-between px-5 py-3" key={kind.id}><p className="text-sm font-semibold text-title">{kind.label}</p><div className="text-right"><p className="text-xl font-bold text-[var(--brand)]">{workReport[kind.id].total}</p>{workReport[kind.id].done > 0 && <p className="text-xs text-dim">Wykonane: {workReport[kind.id].done}</p>}</div></div>)}</div></Card></div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
