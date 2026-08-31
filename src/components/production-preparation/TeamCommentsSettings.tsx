'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils/cn';
import { TEAM_COMMENT_MAX_LENGTH, validateTeamComment, type ProductionTeam, type TeamComment, type TeamComments } from '@/lib/utils/productionTeamComments';

type TeamOption = { id: ProductionTeam; label: string; color: string };
type Props = {
  teams: TeamOption[];
  settings: TeamComments;
  ready: boolean;
  loadError: string | null;
  onSave: (team: ProductionTeam, comment: TeamComment) => Promise<TeamComment>;
};

function TeamCommentEditor({ team, value, ready, onSave }: {
  team: TeamOption;
  value: TeamComment;
  ready: boolean;
  onSave: Props['onSave'];
}) {
  const [draft, setDraft] = useState(value);
  const [baseline, setBaseline] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = draft.enabled !== baseline.enabled || draft.text !== baseline.text || draft.showQuantity !== baseline.showQuantity;

  // Refresh shared settings without replacing text currently being edited.
  useEffect(() => {
    if (!dirty && !saving) {
      setDraft(value);
      setBaseline(value);
    }
  }, [value, dirty, saving]);

  const change = (next: TeamComment) => {
    setDraft(next);
    setSaved(false);
    setError(null);
  };
  const save = async () => {
    if (!ready || saving || !dirty) return;
    const validationError = validateTeamComment(draft);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await onSave(team.id, draft);
      setDraft(result);
      setBaseline(result);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ustawień grupy. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  return <fieldset className="min-w-0 rounded-xl border border-border bg-bg p-4" disabled={!ready || saving}>
    <legend className="px-1 text-sm font-semibold" style={{ color: team.color }}>{team.label}</legend>
    <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-3">
      <span className="text-xs text-dim" title="Pokazuje wiersz Ilość / Norma na kartach tej grupy i przy kopiowaniu zadań. Nie zmienia danych w planie produkcyjnym.">Ilość do wykonania / norma</span>
      <button
        aria-label={`Pokaż ilość i normę: ${team.label}`}
        aria-checked={draft.showQuantity}
        className="flex shrink-0 items-center gap-2 rounded-lg p-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-55"
        onClick={() => change({ ...draft, showQuantity: !draft.showQuantity })}
        role="switch"
        type="button"
      >
        <span>{draft.showQuantity ? 'Włączone' : 'Wyłączone'}</span>
        <span aria-hidden="true" className={cn('relative h-6 w-10 rounded-full border border-border bg-surface2 transition-colors', draft.showQuantity && 'border-[rgba(255,122,26,0.95)] bg-[rgba(255,122,26,0.45)]')}>
          <span className={cn('absolute left-1 top-1 h-3.5 w-3.5 rounded-full bg-slate-300 transition-transform', draft.showQuantity && 'translate-x-4 bg-[#FF7A1A]')} />
        </span>
      </button>
    </div>
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-xs text-dim">Automatyczny komentarz</span>
      <button
        aria-label={`Automatyczny komentarz: ${team.label}`}
        aria-checked={draft.enabled}
        className="flex shrink-0 items-center gap-2 rounded-lg p-1 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-55"
        onClick={() => change({ ...draft, enabled: !draft.enabled })}
        role="switch"
        type="button"
      >
        <span>{draft.enabled ? 'Włączony' : 'Wyłączony'}</span>
        <span aria-hidden="true" className={cn('relative h-6 w-10 rounded-full border border-border bg-surface2 transition-colors', draft.enabled && 'border-[rgba(255,122,26,0.95)] bg-[rgba(255,122,26,0.45)]')}>
          <span className={cn('absolute left-1 top-1 h-3.5 w-3.5 rounded-full bg-slate-300 transition-transform', draft.enabled && 'translate-x-4 bg-[#FF7A1A]')} />
        </span>
      </button>
    </div>
    <label className="block text-xs font-semibold text-dim" htmlFor={`team-comment-${team.id}`}>Treść komentarza</label>
    <textarea
      aria-describedby={error ? `team-comment-error-${team.id}` : undefined}
      aria-invalid={Boolean(error)}
      className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm text-body outline-none focus:border-[rgba(255,122,0,0.65)] disabled:opacity-55"
      id={`team-comment-${team.id}`}
      maxLength={TEAM_COMMENT_MAX_LENGTH}
      onChange={(event) => change({ ...draft, text: event.target.value })}
      placeholder="Wpisz komentarz dla tej grupy"
      rows={3}
      value={draft.text}
    />
    <div aria-live="polite" className="mt-2 min-h-5 text-xs">
      {error ? <p className="text-red-300" id={`team-comment-error-${team.id}`} role="alert">{error}</p>
        : dirty ? <p className="text-amber-300">Niezapisane zmiany</p>
          : saved ? <p className="text-emerald-400">Zapisano</p> : null}
    </div>
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      <Button aria-label={`Usuń treść komentarza: ${team.label}`} className="min-h-9 px-3 py-2 text-xs" disabled={!draft.text && !draft.enabled} onClick={() => change({ ...draft, enabled: false, text: '' })} title="Usuwa treść i wyłącza komentarz. Potwierdź przyciskiem Zapisz." type="button" variant="ghost"><Trash2 className="mr-1.5 h-3.5 w-3.5" />Usuń treść</Button>
      <Button aria-label={`Zapisz ustawienia: ${team.label}`} className="min-h-9 px-3 py-2 text-xs" disabled={!ready || saving || !dirty} onClick={() => void save()} type="button" variant="outline"><Save className="mr-1.5 h-3.5 w-3.5" />{saving ? 'Zapisywanie…' : 'Zapisz'}</Button>
    </div>
  </fieldset>;
}

export function TeamCommentsSettings({ teams, settings, ready, loadError, onSave }: Props) {
  return <Card className="overflow-hidden p-0">
    <div className="flex items-center gap-3 border-b border-border px-5 py-4">
      <MessageSquare aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--brand)]" />
      <h2 className="font-semibold text-title" title="Dla każdej grupy osobno ustaw widoczność ilości z normą oraz automatyczny komentarz. Dotyczy kart planu pracy i kopiowanych zadań. Ustawienia są wspólne dla użytkowników; ręczne uwagi i dane planu pozostają bez zmian.">Komentarze i ilości</h2>
    </div>
    {loadError && <p className="px-5 pt-4 text-sm text-red-300" role="alert">{loadError}</p>}
    {!ready && !loadError && <p className="px-5 pt-4 text-sm text-dim" role="status">Wczytywanie ustawień grup…</p>}
    <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
      {teams.map((team) => <TeamCommentEditor key={team.id} team={team} value={settings[team.id]} ready={ready} onSave={onSave} />)}
    </div>
  </Card>;
}
