'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Clock3, Save, Trash2, UsersRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils/cn';

type RoleKey = 'mechanics' | 'setters' | 'technicians' | 'dispatchers';

type RoleLoad = {
  people: number;
  changeovers: number;
  minutesPerChangeover: number;
};

type BalanceEntry = {
  id: string;
  date: string;
  hoursPerPerson: number;
  efficiencyPercent: number;
  roles: Record<RoleKey, RoleLoad>;
};

type LegacyBalanceEntry = Partial<BalanceEntry> & {
  people?: number;
  changeovers?: number;
  minutesPerChangeover?: number;
};

type RoleResult = RoleLoad & {
  key: RoleKey;
  label: string;
  description: string;
  availableHours: number;
  requiredHours: number;
  balanceHours: number;
  utilization: number;
  peopleNeeded: number;
};

type BalanceStatus = {
  label: string;
  tone: 'success' | 'warning' | 'danger';
  description: string;
};

const STORAGE_KEY = 'bilans-przezbrojen-entries';

const roleDefinitions: Array<{ key: RoleKey; label: string; shortLabel: string; description: string }> = [
  {
    key: 'mechanics',
    label: 'Mechanicy',
    shortLabel: 'M',
    description: 'Zmiana form i prace mechaniczne przy przezbrojeniu.'
  },
  {
    key: 'setters',
    label: 'Ustawiacze',
    shortLabel: 'U',
    description: 'Ustawianie maszyny, procesu i regulacje.'
  },
  {
    key: 'technicians',
    label: 'Technik uruchomienia',
    shortLabel: 'T',
    description: 'Czyszczenie osprzętu i przygotowanie produkcji.'
  },
  {
    key: 'dispatchers',
    label: 'Rozdzielca Wydziałowy',
    shortLabel: 'R',
    description: 'Koordynacja materiałów, kolejności i gotowości przezbrojeń.'
  }
];

const defaultRoles: Record<RoleKey, RoleLoad> = {
  mechanics: { people: 2, changeovers: 20, minutesPerChangeover: 45 },
  setters: { people: 1, changeovers: 20, minutesPerChangeover: 30 },
  technicians: { people: 1, changeovers: 20, minutesPerChangeover: 25 },
  dispatchers: { people: 1, changeovers: 20, minutesPerChangeover: 15 }
};

const pad = (value: number) => String(value).padStart(2, '0');

const getTodayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const numberValue = (value: FormDataEntryValue | null, fallback: number) => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const round = (value: number, digits = 1) => {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
};

const formatHours = (value: number) => `${round(value, 1).toLocaleString('pl-PL')} h`;

const normalizeEntry = (entry: LegacyBalanceEntry): BalanceEntry => ({
  id: entry.id ?? createId(),
  date: entry.date ?? getTodayKey(),
  hoursPerPerson: entry.hoursPerPerson ?? 8,
  efficiencyPercent: entry.efficiencyPercent ?? 85,
  roles: {
    mechanics: {
      people: entry.roles?.mechanics?.people ?? entry.people ?? defaultRoles.mechanics.people,
      changeovers:
        entry.roles?.mechanics?.changeovers ??
        entry.changeovers ??
        defaultRoles.mechanics.changeovers,
      minutesPerChangeover:
        entry.roles?.mechanics?.minutesPerChangeover ??
        entry.minutesPerChangeover ??
        defaultRoles.mechanics.minutesPerChangeover
    },
    setters: {
      people: entry.roles?.setters?.people ?? defaultRoles.setters.people,
      changeovers:
        entry.roles?.setters?.changeovers ?? entry.changeovers ?? defaultRoles.setters.changeovers,
      minutesPerChangeover:
        entry.roles?.setters?.minutesPerChangeover ?? defaultRoles.setters.minutesPerChangeover
    },
    technicians: {
      people: entry.roles?.technicians?.people ?? defaultRoles.technicians.people,
      changeovers:
        entry.roles?.technicians?.changeovers ??
        entry.changeovers ??
        defaultRoles.technicians.changeovers,
      minutesPerChangeover:
        entry.roles?.technicians?.minutesPerChangeover ?? defaultRoles.technicians.minutesPerChangeover
    },
    dispatchers: {
      people: entry.roles?.dispatchers?.people ?? defaultRoles.dispatchers.people,
      changeovers:
        entry.roles?.dispatchers?.changeovers ??
        entry.changeovers ??
        defaultRoles.dispatchers.changeovers,
      minutesPerChangeover:
        entry.roles?.dispatchers?.minutesPerChangeover ?? defaultRoles.dispatchers.minutesPerChangeover
    }
  }
});

const defaultEntry = (): BalanceEntry => ({
  id: createId(),
  date: getTodayKey(),
  hoursPerPerson: 8,
  efficiencyPercent: 85,
  roles: defaultRoles
});

const getStoredEntries = () => {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LegacyBalanceEntry[];
    return Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return [];
  }
};

const getInitialDraft = () => {
  const stored = getStoredEntries();
  return stored.find((entry) => entry.date === getTodayKey()) ?? defaultEntry();
};

const calculateRole = (entry: BalanceEntry, key: RoleKey): RoleResult => {
  const role = entry.roles[key];
  const definition = roleDefinitions.find((item) => item.key === key);
  const availableHours = role.people * entry.hoursPerPerson * (entry.efficiencyPercent / 100);
  const requiredHours = (role.changeovers * role.minutesPerChangeover) / 60;
  const balanceHours = availableHours - requiredHours;
  const utilization = availableHours > 0 ? (requiredHours / availableHours) * 100 : requiredHours > 0 ? 999 : 0;
  const peopleNeeded =
    entry.hoursPerPerson > 0 && entry.efficiencyPercent > 0
      ? Math.ceil(requiredHours / (entry.hoursPerPerson * (entry.efficiencyPercent / 100)))
      : 0;

  return {
    key,
    label: definition?.label ?? key,
    description: definition?.description ?? '',
    people: role.people,
    changeovers: role.changeovers,
    minutesPerChangeover: role.minutesPerChangeover,
    availableHours,
    requiredHours,
    balanceHours,
    utilization,
    peopleNeeded
  };
};

const calculateBalance = (entry: BalanceEntry) => {
  const roles = roleDefinitions.map((role) => calculateRole(entry, role.key));
  const availableHours = roles.reduce((sum, role) => sum + role.availableHours, 0);
  const requiredHours = roles.reduce((sum, role) => sum + role.requiredHours, 0);
  const balanceHours = availableHours - requiredHours;
  const utilization = availableHours > 0 ? (requiredHours / availableHours) * 100 : requiredHours > 0 ? 999 : 0;
  const blockingRoles = roles.filter((role) => role.balanceHours < 0);

  return {
    roles,
    availableHours,
    requiredHours,
    balanceHours,
    utilization,
    blockingRoles
  };
};

const getStatus = (result: ReturnType<typeof calculateBalance>): BalanceStatus => {
  if (result.blockingRoles.length > 0) {
    return {
      label: 'Brak ludzi',
      tone: 'danger',
      description: `Brakuje czasu w grupie: ${result.blockingRoles.map((role) => role.label).join(', ')}.`
    };
  }
  if (result.roles.some((role) => role.utilization >= 85)) {
    return {
      label: 'Na styk',
      tone: 'warning',
      description: 'Plan jest wykonalny, ale jedno ze stanowisk ma mały zapas czasu.'
    };
  }
  return {
    label: 'OK',
    tone: 'success',
    description: 'Każde stanowisko ma wystarczający czas na zaplanowane przezbrojenia.'
  };
};

const getRoleStatus = (role: RoleResult): BalanceStatus['tone'] => {
  if (role.balanceHours < 0) return 'danger';
  if (role.utilization >= 85) return 'warning';
  return 'success';
};

const MetricTile = ({
  label,
  value,
  note,
  tone = 'default'
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) => {
  const toneClass = {
    default: 'border-border bg-[rgba(255,255,255,0.035)]',
    success:
      'border-[color:color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--success)_9%,transparent)]',
    warning:
      'border-[color:color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--warning)_9%,transparent)]',
    danger:
      'border-[color:color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--danger)_9%,transparent)]'
  };

  return (
    <div className={cn('rounded-lg border p-4 shadow-[inset_0_1px_0_var(--inner-highlight)]', toneClass[tone])}>
      <p className="text-xs font-semibold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-title">{value}</p>
      {note && <p className="mt-1 text-xs text-dim">{note}</p>}
    </div>
  );
};

export default function BilansPrzezbrojenPage() {
  const [entries, setEntries] = useState<BalanceEntry[]>(() => getStoredEntries());
  const [draft, setDraft] = useState<BalanceEntry>(() => getInitialDraft());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  const result = useMemo(() => calculateBalance(draft), [draft]);
  const status = getStatus(result);

  const updateDraft = (field: keyof BalanceEntry, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: field === 'date' ? value : Number(value)
    }));
  };

  const updateRole = (role: RoleKey, field: keyof RoleLoad, value: string) => {
    setDraft((current) => ({
      ...current,
      roles: {
        ...current.roles,
        [role]: {
          ...current.roles[role],
          [field]: Number(value)
        }
      }
    }));
  };

  const removeEntry = (id: string) => {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  };

  const loadEntry = (entry: BalanceEntry) => {
    setDraft(entry);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const next: BalanceEntry = {
      id: draft.id,
      date: String(formData.get('date') ?? getTodayKey()),
      hoursPerPerson: numberValue(formData.get('hoursPerPerson'), 0),
      efficiencyPercent: Math.min(100, numberValue(formData.get('efficiencyPercent'), 0)),
      roles: {
        mechanics: {
          people: numberValue(formData.get('mechanicsPeople'), 0),
          changeovers: numberValue(formData.get('mechanicsChangeovers'), 0),
          minutesPerChangeover: numberValue(formData.get('mechanicsMinutes'), 0)
        },
        setters: {
          people: numberValue(formData.get('settersPeople'), 0),
          changeovers: numberValue(formData.get('settersChangeovers'), 0),
          minutesPerChangeover: numberValue(formData.get('settersMinutes'), 0)
        },
        technicians: {
          people: numberValue(formData.get('techniciansPeople'), 0),
          changeovers: numberValue(formData.get('techniciansChangeovers'), 0),
          minutesPerChangeover: numberValue(formData.get('techniciansMinutes'), 0)
        },
        dispatchers: {
          people: numberValue(formData.get('dispatchersPeople'), 0),
          changeovers: numberValue(formData.get('dispatchersChangeovers'), 0),
          minutesPerChangeover: numberValue(formData.get('dispatchersMinutes'), 0)
        }
      }
    };
    setDraft(next);
    setEntries((current) => {
      const nextEntries = current.filter((entry) => entry.id !== next.id && entry.date !== next.date);
      return [next, ...nextEntries].sort((a, b) => b.date.localeCompare(a.date));
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bilans przezbrojeń"
        subtitle="Wpisz osobny plan pracy dla każdego stanowiska i sprawdź, czy obsada wystarczy."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(390px,0.95fr)_minmax(0,1.35fr)]">
        <Card className="rounded-lg">
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-[rgba(255,106,0,0.35)] bg-brandSoft p-2 text-brand">
              <Calculator size={20} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-title">Dane dnia</h2>
              <p className="text-sm text-dim">Każde stanowisko ma własną obsadę, liczbę przezbrojeń i czas pracy na jedno przezbrojenie.</p>
            </div>
          </div>

          <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-dim">Data</span>
                <Input name="date" type="date" value={draft.date} onChange={(event) => updateDraft('date', event.target.value)} />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-dim">Godzin pracy / osoba</span>
                <Input name="hoursPerPerson" type="number" min="0" step="0.5" value={draft.hoursPerPerson} onChange={(event) => updateDraft('hoursPerPerson', event.target.value)} />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-dim">Efektywność dnia (%)</span>
                <Input name="efficiencyPercent" type="number" min="0" max="100" step="1" value={draft.efficiencyPercent} onChange={(event) => updateDraft('efficiencyPercent', event.target.value)} />
              </label>
            </div>

            <div className="space-y-3">
              {roleDefinitions.map((role) => (
                <div key={role.key} className="rounded-lg border border-border bg-[rgba(255,255,255,0.025)] p-3">
                  <div className="mb-3">
                    <p className="font-semibold text-title">{role.label}</p>
                    <p className="text-xs text-dim">{role.description}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-dim">Liczba osób na stanowisku</span>
                      <Input
                        name={`${role.key}People`}
                        type="number"
                        min="0"
                        step="1"
                        value={draft.roles[role.key].people}
                        onChange={(event) => updateRole(role.key, 'people', event.target.value)}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-dim">Liczba przezbrojeń</span>
                      <Input
                        name={`${role.key}Changeovers`}
                        type="number"
                        min="0"
                        step="1"
                        value={draft.roles[role.key].changeovers}
                        onChange={(event) => updateRole(role.key, 'changeovers', event.target.value)}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-dim">Minut pracy na 1 przezbrojenie</span>
                      <Input
                        name={`${role.key}Minutes`}
                        type="number"
                        min="0"
                        step="5"
                        value={draft.roles[role.key].minutesPerChangeover}
                        onChange={(event) => updateRole(role.key, 'minutesPerChangeover', event.target.value)}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <Button type="submit" className="gap-2">
                <Save size={17} />
                Zapisz dzień
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDraft(defaultEntry())}>
                Nowy dzień
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-5">
          <Card className="rounded-lg">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="rounded-lg border border-[rgba(255,106,0,0.35)] bg-brandSoft p-2 text-brand">
                  <UsersRound size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-title">Wynik bilansu</h2>
                  <p className="text-sm text-dim">Każde stanowisko jest liczone osobno, bez mieszania ról.</p>
                </div>
              </div>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Dostępne łącznie" value={formatHours(result.availableHours)} note="po efektywności" />
              <MetricTile label="Potrzebne łącznie" value={formatHours(result.requiredHours)} note="suma stanowisk" />
              <MetricTile
                label="Bilans łączny"
                value={`${result.balanceHours >= 0 ? '+' : '-'}${formatHours(Math.abs(result.balanceHours))}`}
                tone={result.blockingRoles.length > 0 ? 'danger' : result.utilization >= 85 ? 'warning' : 'success'}
              />
              <MetricTile label="Stanowiska" value={result.roles.length.toLocaleString('pl-PL')} note="liczone osobno" tone={result.blockingRoles.length > 0 ? 'danger' : 'success'} />
            </div>

            <div className="mt-5 rounded-lg border border-border bg-[rgba(255,255,255,0.03)] p-4">
              <div className="flex items-start gap-3">
                {status.tone === 'danger' ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
                ) : (
                  <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                )}
                <div>
                  <p className="font-semibold text-title">{status.description}</p>
                  <p className="mt-1 text-sm text-dim">
                    Wykorzystanie łączne: {round(result.utilization, 0).toLocaleString('pl-PL')}%. O wykonalności decyduje stanowisko z najmniejszym zapasem.
                  </p>
                </div>
              </div>
            </div>
          </Card>

          <Card className="rounded-lg">
            <h2 className="text-lg font-semibold text-title">Rozbicie na stanowiska</h2>
            <div className="mt-4 grid gap-3">
              {result.roles.map((role) => {
                const tone = getRoleStatus(role);
                return (
                  <div key={role.key} className="rounded-lg border border-border bg-[rgba(255,255,255,0.025)] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-title">{role.label}</p>
                        <p className="text-xs text-dim">{role.description}</p>
                      </div>
                      <Badge tone={tone}>{role.balanceHours < 0 ? 'Brak' : role.utilization >= 85 ? 'Na styk' : 'OK'}</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-4">
                      <MetricTile label="Osoby" value={role.people.toLocaleString('pl-PL')} />
                      <MetricTile label="Przezbrojenia" value={role.changeovers.toLocaleString('pl-PL')} />
                      <MetricTile label="Potrzebne" value={formatHours(role.requiredHours)} note={`${role.minutesPerChangeover} min / przezbr.`} />
                      <MetricTile label="Wykorzystanie" value={`${round(role.utilization, 0).toLocaleString('pl-PL')}%`} tone={tone} />
                      <MetricTile
                        label="Bilans"
                        value={`${role.balanceHours >= 0 ? '+' : '-'}${formatHours(Math.abs(role.balanceHours))}`}
                        tone={tone}
                      />
                    </div>
                    <p className="mt-3 text-sm text-dim">
                      Potrzebna obsada dla tego planu: {role.peopleNeeded.toLocaleString('pl-PL')}.
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="rounded-lg">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-title">Zapisane dni</h2>
                <p className="text-sm text-dim">Kliknij dzień, żeby wrócić do jego założeń.</p>
              </div>
              <Badge tone="info">{entries.length}</Badge>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <div className="grid grid-cols-[1fr_88px_88px] gap-3 border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-dim md:grid-cols-[120px_160px_120px_110px_1fr_42px]">
                <span>Data</span>
                <span className="text-right">Plan</span>
                <span className="text-right">Status</span>
                <span className="hidden text-right md:block">Wykorz.</span>
                <span className="hidden text-right md:block">Bilans</span>
                <span className="hidden md:block" />
              </div>
              <div className="divide-y divide-border">
                {entries.map((entry) => {
                  const rowResult = calculateBalance(entry);
                  const rowStatus = getStatus(rowResult);
                  return (
                    <div key={entry.id} className="grid grid-cols-[1fr_88px_88px] items-center gap-3 px-3 py-2.5 text-sm md:grid-cols-[120px_160px_120px_110px_1fr_42px]">
                      <button type="button" onClick={() => loadEntry(entry)} className="truncate text-left font-semibold text-title hover:text-brand">
                        {entry.date}
                      </button>
                      <span className="text-right text-xs tabular-nums text-dim">
                        M{entry.roles.mechanics.changeovers} / U{entry.roles.setters.changeovers} / T{entry.roles.technicians.changeovers} / R{entry.roles.dispatchers.changeovers}
                      </span>
                      <span className="flex justify-end"><Badge tone={rowStatus.tone}>{rowStatus.label}</Badge></span>
                      <span className="hidden text-right tabular-nums md:block">{round(rowResult.utilization, 0).toLocaleString('pl-PL')}%</span>
                      <span className={cn('hidden text-right font-semibold tabular-nums md:block', rowResult.blockingRoles.length > 0 ? 'text-danger' : 'text-success')}>
                        {rowResult.balanceHours >= 0 ? '+' : '-'}{formatHours(Math.abs(rowResult.balanceHours))}
                      </span>
                      <button type="button" onClick={() => removeEntry(entry.id)} className="hidden justify-self-end rounded-lg border border-border p-2 text-dim transition hover:border-[rgba(239,68,68,0.5)] hover:text-danger md:inline-flex" aria-label="Usuń dzień">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  );
                })}
                {entries.length === 0 && (
                  <p className="px-3 py-6 text-center text-sm text-dim">Brak zapisanych dni.</p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
