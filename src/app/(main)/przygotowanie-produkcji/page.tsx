'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Wrench } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils/cn';

type Team = 'mechanics' | 'process' | 'distribution' | 'graphics' | 'technician' | 'additional';
type WorkKind = 'zmiana-formy' | 'rozruch' | 'zmiana-koloru' | 'zmiana-grafiki' | 'regulacja' | 'proby' | 'przeglad-a' | 'inne';

type Task = {
  id: string;
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
  { id: 'rozruch', label: 'Rozruch' },
  { id: 'zmiana-koloru', label: 'Zmiana koloru' },
  { id: 'zmiana-grafiki', label: 'Zmiana grafiki' },
  { id: 'regulacja', label: 'Regulacja' },
  { id: 'proby', label: 'Próby' },
  { id: 'przeglad-a', label: 'Przegląd A' },
  { id: 'inne', label: 'Inne' }
];

const automaticTeams: Partial<Record<WorkKind, Team[]>> = {
  rozruch: ['process', 'distribution'],
  'zmiana-koloru': ['process', 'distribution', 'technician'],
  'zmiana-grafiki': ['process', 'distribution', 'graphics'],
  'zmiana-formy': ['mechanics', 'process', 'distribution', 'technician'],
  regulacja: ['process'],
  proby: ['process'],
  'przeglad-a': ['process']
};

const teamsWith5s: Team[] = ['mechanics', 'process', 'distribution', 'technician'];
const standard5s = 'Po wykonanym zadaniu poprawnie ustaw tabliczkę 5S.';

const cellText = (value: unknown) => (value == null ? '' : String(value).replace(/\s+/g, ' ').trim());
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toUpperCase();

const temperatureFor = (type: string) => {
  const normalized = type.trim().toUpperCase();
  if (normalized === 'PC' || normalized === 'PET') return '120';
  if (['PP', 'ABS', 'PA', 'PS', 'PMMA', 'SAN', 'PC+ABS'].includes(normalized)) return '80';
  return '';
};

const inferWorkKind = (value: string): WorkKind | null => {
  const text = value.toUpperCase();
  if (text.includes('FORM')) return 'zmiana-formy';
  if (text.includes('ROZRUCH') || text.includes('URUCH')) return 'rozruch';
  if (text.includes('REGUL')) return 'regulacja';
  if (text.includes('PROB')) return 'proby';
  if (text.includes('PRZEGL')) return 'przeglad-a';
  return null;
};

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
    if (direct) return direct;
    const merge = merges.find((item) => row >= item.s.r && row <= item.e.r && column >= item.s.c && column <= item.e.c);
    return merge ? sheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })] : undefined;
  };
  const valueAt = (row: number, column: number) => cellText(cellAt(row, column)?.w ?? cellAt(row, column)?.v);
  const rows = data.flatMap((_, row) => {
    const detail = valueAt(row, 1);
    const values = Array.from({ length: 8 }, (_, column) => valueAt(row, column));
    const station = values.find((value) => /\bWTR\s*\d+\b|\bST\.?\s*\d+\b|\bMASZYNA\b/i.test(value)) ?? valueAt(row, 3);
    const header = `${detail} ${station}`.toUpperCase();
    if (!detail || !station || header.includes('NAZWA INDEKSU') || header.includes('STÓŁ LUB MASZYNA')) return [];
    const highlighted = Array.from({ length: 8 }, (_, column) => hasYellowFill(cellAt(row, column))).some(Boolean);
    return [{ id: `${sheetName}-${row}`, station, detail, quantity: valueAt(row, 2), norm: valueAt(row, 4), highlighted }];
  });

  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const nextOnSameStation = Boolean(previous && normalize(previous.station) === normalize(row.station) && normalize(previous.detail) !== normalize(row.detail));
    return {
      ...row,
      highlighted: row.highlighted || nextOnSameStation,
      kinds: [],
      teams: [],
      notes: {},
      done: false,
      material: '',
      materialType: '',
      source: '',
      dryer: '',
      temperature: ''
    };
  });
};

export default function PrzygotowanieProdukcjiPage() {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [importing, setImporting] = useState(false);
  const [loadingSavedPlan, setLoadingSavedPlan] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [copiedQueueTask, setCopiedQueueTask] = useState<string | null>(null);
  const sheetNames = workbook?.SheetNames ?? [];

  const apiRequest = async <T,>(body?: unknown) => {
    const response = await fetch('/api/przygotowanie-produkcji', body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    } : undefined);
    if (!response.ok) throw new Error('Nie udało się zapisać przygotowania produkcji.');
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

  const savePlan = async (nextTasks: Task[], nextFileName: string, nextSheetName: string) => {
    setSaveState('saving');
    try {
      await apiRequest({ action: 'savePlan', tasks: nextTasks, fileName: nextFileName, sheetName: nextSheetName });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const saveTask = async (task: Task) => {
    setSaveState('saving');
    try {
      await apiRequest({ action: 'updateTask', task });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const selectSheet = (nextSheet: string) => {
    if (!workbook) return;
    const nextTasks = parseTasks(workbook, nextSheet);
    setSheetName(nextSheet);
    setTasks(nextTasks);
    void savePlan(nextTasks, fileName, nextSheet);
  };

  const importPlan = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    try {
      const nextWorkbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellStyles: true });
      const nextSheet = nextWorkbook.SheetNames[nextWorkbook.SheetNames.length - 1] ?? '';
      const nextTasks = parseTasks(nextWorkbook, nextSheet);
      setWorkbook(nextWorkbook);
      setFileName(file.name);
      setSheetName(nextSheet);
      setTasks(nextTasks);
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
  const toggleKind = (task: Task, kind: WorkKind) => {
    const adding = !task.kinds.includes(kind);
    const kinds = adding ? [...task.kinds, kind] : task.kinds.filter((item) => item !== kind);
    const addedTeams = adding ? automaticTeams[kind] ?? [] : [];
    const teams = [...new Set([...task.teams, ...addedTeams])];
    const notes = addedTeams.includes('distribution') && !task.notes.distribution ? { ...task.notes, distribution: 'Przygotować stanowisko' } : task.notes;
    updateTask(task.id, { kinds, teams, notes });
  };
  const toggleTeam = (task: Task, team: Team) => {
    const adding = !task.teams.includes(team);
    const teams = adding ? [...task.teams, team] : task.teams.filter((item) => item !== team);
    const notes = adding && team === 'distribution' && !task.notes.distribution ? { ...task.notes, distribution: 'Przygotować stanowisko' } : task.notes;
    updateTask(task.id, { teams, notes });
  };
  const activeTasks = useMemo(() => tasks.filter((task) => task.station), [tasks]);

  const copyQueueTask = async (task: Task, team: Team) => {
    const kindLabels = task.kinds
      .map((id) => workKinds.find((item) => item.id === id)?.label)
      .filter(Boolean)
      .join(', ');
    const lines = [
      `- ${task.station} ${task.detail}`,
      `Ilość: ${task.quantity || '---'} | Norma: ${task.norm || '---'}`,
      [kindLabels, task.notes[team]].filter(Boolean).join(': '),
      teamsWith5s.includes(team) ? standard5s : ''
    ].filter(Boolean);
    await navigator.clipboard.writeText(lines.join('\n'));
    const copyId = `${team}-${task.id}`;
    setCopiedQueueTask(copyId);
    window.setTimeout(() => setCopiedQueueTask((current) => current === copyId ? null : current), 1800);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5">
      <PageHeader title="Przygotowanie produkcji" subtitle="Import planu, rozpiska materiałowa i zadania dla zespołów." />
      <Tabs defaultValue="plan" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="plan">Plan zmian</TabsTrigger>
          <TabsTrigger value="material">Rozpiska materiałowa</TabsTrigger>
        </TabsList>

        <Card className="space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-base font-semibold text-title">Plan produkcyjny</p>
              <p className="text-sm text-dim">Wgraj Excel i wybierz arkusz wykorzystywany do przygotowania produkcji.</p>
            </div>
            <label>
              <input className="hidden" accept=".xlsx,.xls" onChange={(event) => importPlan(event.target.files?.[0] ?? null)} type="file" />
              <Button asChild disabled={importing} variant="primaryEmber"><span><Upload className="mr-2 h-4 w-4" />{importing ? 'Wczytywanie...' : 'Wgraj plan Excel'}</span></Button>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm text-dim">
            <span>Plik: <strong className="text-title">{fileName || 'brak'}</strong></span>
            {sheetNames.length > 0 && <select className="rounded-lg border border-border bg-surface2 px-3 py-2 text-body" value={sheetName} onChange={(event) => selectSheet(event.target.value)}>
              {sheetNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>}
            {tasks.length > 0 && <Badge>{tasks.length} pozycji</Badge>}
            <span className={cn('ml-auto text-xs font-semibold', saveState === 'error' ? 'text-red-400' : saveState === 'saving' ? 'text-[var(--brand)]' : 'text-emerald-400')}>
              {loadingSavedPlan ? 'Odczytywanie zapisanego planu...' : saveState === 'saving' ? 'Zapisywanie...' : saveState === 'error' ? 'Błąd zapisu' : tasks.length ? 'Zapisano' : ''}
            </span>
          </div>
        </Card>

        <TabsContent value="plan" className="space-y-4">
          {!activeTasks.length ? <EmptyState title="Wgraj plan produkcyjny" description="Po imporcie pojawią się stanowiska, indeksy oraz zadania do przygotowania." /> : <>
            <Card className="p-0">
              <div className="border-b border-border px-5 py-4"><p className="font-semibold text-title">Pozycje do omówienia</p><p className="mt-1 text-sm text-dim">Wybierz rodzaj pracy, a właściwe zespoły zostaną zaznaczone automatycznie.</p></div>
              <div className="space-y-3 p-3">
                {activeTasks.map((task) => <article className={cn('rounded-lg border border-border bg-surface2 p-4', task.highlighted && 'border-[rgba(245,197,66,0.65)] bg-[rgba(245,197,66,0.07)]', task.done && 'border-[rgba(34,197,94,0.65)] bg-[rgba(34,197,94,0.07)]')} key={task.id}>
                  <div className="grid gap-4 xl:grid-cols-[minmax(310px,1.25fr)_minmax(250px,1fr)_minmax(360px,1.4fr)_120px] xl:items-center">
                    <div className="grid grid-cols-[92px_1fr] gap-3">
                      <div className="flex min-h-14 items-center justify-center rounded-lg border border-[rgba(255,122,0,0.48)] bg-[rgba(255,122,0,0.08)] px-2 text-center text-sm font-bold text-[var(--brand)]">{task.station}</div>
                      <div><textarea className="min-h-14 w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm font-semibold text-title outline-none focus:border-[rgba(255,122,0,0.65)]" value={task.detail} onChange={(event) => updateTask(task.id, { detail: event.target.value })} /><p className="mt-1 text-xs text-dim">Ilość: <strong className="text-title">{task.quantity || '---'}</strong> &nbsp; Norma: <strong className="text-title">{task.norm || '---'}</strong></p></div>
                    </div>
                    <fieldset className="rounded-lg border border-border p-2"><legend className="px-1 text-[10px] font-bold uppercase text-dim">Rodzaj pracy</legend><div className="grid grid-cols-2 gap-1.5">{workKinds.map((kind) => <label className={cn('flex min-h-8 items-center justify-center gap-1 rounded border border-border px-2 text-center text-[11px] font-semibold text-dim', task.kinds.includes(kind.id) && 'border-[rgba(255,122,0,0.65)] bg-[rgba(255,122,0,0.12)] text-title')} key={kind.id}><input checked={task.kinds.includes(kind.id)} onChange={() => toggleKind(task, kind.id)} type="checkbox" />{kind.label}</label>)}</div></fieldset>
                    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">{teamOptions.map((team) => <label className={cn('flex min-h-10 w-full items-center gap-2 rounded-lg border border-border bg-bg px-3 text-xs font-semibold text-dim', task.teams.includes(team.id) && 'text-title')} style={task.teams.includes(team.id) ? { borderColor: `${team.color}99`, backgroundColor: `${team.color}18` } : undefined} key={team.id}><input checked={task.teams.includes(team.id)} onChange={() => toggleTeam(task, team.id)} type="checkbox" />{team.label}</label>)}</div>
                    <label className="flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[rgba(34,197,94,0.55)] bg-[rgba(34,197,94,0.06)] px-2 text-xs font-bold text-[#9ee6b8]"><input checked={task.done} onChange={(event) => updateTask(task.id, { done: event.target.checked })} type="checkbox" />Wykonane</label>
                  </div>
                  {task.teams.length > 0 && <div className="mt-3 grid gap-2 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-3">{teamOptions.filter((team) => task.teams.includes(team.id)).map((team) => <label className="text-xs text-dim" key={team.id}>{team.id === 'additional' ? 'Informacja dodatkowa' : `Uwagi dla: ${team.label}`}<Input className="mt-1" value={task.notes[team.id] ?? ''} onChange={(event) => updateTask(task.id, { notes: { ...task.notes, [team.id]: event.target.value } })} placeholder="Dodaj ustalenie" /></label>)}</div>}
                </article>)}
              </div>
            </Card>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{teamOptions.map((team) => {
              const queue = activeTasks.filter((task) => task.teams.includes(team.id) && !(task.kinds.length === 1 && task.kinds[0] === 'przeglad-a' && ['mechanics', 'distribution', 'technician'].includes(team.id)));
              return <Card className="overflow-hidden p-0" key={team.id}><div className="h-[3px]" style={{ backgroundColor: team.color }} /><div className="flex items-center justify-between border-b border-border px-4 py-3"><div className="flex items-center gap-2"><Wrench className="h-4 w-4" style={{ color: team.color }} /><h2 className="font-semibold text-title">{team.label}</h2></div><Badge>{queue.filter((task) => !task.done).length}</Badge></div><div className="space-y-2 p-3">{queue.length === 0 ? <p className="text-sm text-dim">Brak przypisanych prac.</p> : queue.map((task) => { const copyId = `${team.id}-${task.id}`; return <button aria-label={`Kopiuj zadanie ${task.station}`} className={cn('w-full select-text rounded-lg border border-border bg-bg p-3 text-left hover:border-borderStrong', task.done && 'border-[rgba(34,197,94,0.65)]')} key={task.id} onClick={() => void copyQueueTask(task, team.id)} type="button"><p className="font-semibold text-[var(--brand)]">- {task.station} {task.detail}</p><p className="mt-1 text-xs text-body">Ilość: {task.quantity || '---'} | Norma: {task.norm || '---'}</p><p className="mt-1 text-xs text-body">{task.kinds.map((id) => workKinds.find((item) => item.id)?.label).filter(Boolean).join(', ')}{task.notes[team.id] ? `: ${task.notes[team.id]}` : ''}</p>{teamsWith5s.includes(team.id) && <p className="mt-1 text-xs text-body">{standard5s}</p>}{copiedQueueTask === copyId && <p className="mt-2 text-xs font-semibold text-emerald-400">Skopiowano do schowka.</p>}</button>; })}</div></Card>;
            })}</div>
          </>}
        </TabsContent>

        <TabsContent value="material" className="space-y-4">
          {!activeTasks.length ? <EmptyState title="Brak rozpiski" description="Wgraj plan produkcyjny, aby przygotować rozpiszę materiałową." /> : <Card className="overflow-hidden p-0"><div className="border-b border-border px-5 py-4"><p className="font-semibold text-title">Rozpiska materiałowa</p><p className="mt-1 text-sm text-dim">Materiał, źródło i suszarkę uzupełniasz dla pozycji z importowanego planu.</p></div><div className="overflow-x-auto"><table className="min-w-[1050px] w-full text-left text-sm"><thead className="bg-surface2 text-xs uppercase text-dim"><tr>{['Stanowisko', 'Indeks', 'Materiał', 'Rodzaj', 'Źródło', 'Suszarka', 'Temp.'].map((label) => <th className="border-b border-border px-4 py-3 font-semibold" key={label}>{label}</th>)}</tr></thead><tbody>{activeTasks.map((task) => <tr className={cn('border-b border-border/80', task.highlighted && 'bg-[rgba(245,197,66,0.06)]')} key={task.id}><td className="px-4 py-3 font-bold text-[var(--brand)]">{task.station}</td><td className="max-w-[290px] px-4 py-3 font-semibold text-title">{task.detail}</td><td className="px-2 py-2"><Input value={task.material} onChange={(event) => updateTask(task.id, { material: event.target.value })} /></td><td className="px-2 py-2"><Input value={task.materialType} onChange={(event) => updateTask(task.id, { materialType: event.target.value, temperature: temperatureFor(event.target.value) || task.temperature })} /></td><td className="px-2 py-2"><Input value={task.source} onChange={(event) => updateTask(task.id, { source: event.target.value })} /></td><td className="px-2 py-2"><Input value={task.dryer} onChange={(event) => updateTask(task.id, { dryer: event.target.value })} /></td><td className="px-2 py-2"><Input value={task.temperature} onChange={(event) => updateTask(task.id, { temperature: event.target.value })} /></td></tr>)}</tbody></table></div></Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
