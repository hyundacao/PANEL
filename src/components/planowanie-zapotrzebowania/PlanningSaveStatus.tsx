'use client';

import { AlertTriangle, Check, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PlanningSaveInfo } from '@/lib/planowanie-zapotrzebowania/autosave';

export const PlanningSaveStatus = ({ info }: { info: PlanningSaveInfo }) => {
  const busy = info.status === 'pending' || info.status === 'saving' || info.status === 'loading';
  const failed = ['offline', 'conflict', 'error'].includes(info.status);
  return <span className={'inline-flex items-center gap-2 text-xs font-semibold ' + (failed ? 'text-red-300' : busy ? 'text-dim' : 'text-emerald-300')} role="status" aria-live="polite">
    {busy ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : failed ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
    {info.status === 'loading' ? 'Wczytywanie...' : busy ? 'Zapisywanie...' : info.status === 'conflict' ? 'Konflikt zmian' : failed ? 'Nie zapisano w bazie' : 'Zapisano'}
  </span>;
};

export const PlanningSaveNotice = ({ info, retry, downloadDraft, loadLatest }: {
  info: PlanningSaveInfo;
  retry: () => void;
  downloadDraft: () => void;
  loadLatest: () => Promise<void>;
}) => {
  if (!['offline', 'conflict', 'error'].includes(info.status)) return null;
  const conflict = info.status === 'conflict';
  const migration = info.error === 'CONCURRENCY_MIGRATION_REQUIRED' || info.error === 'MIGRATION_REQUIRED';
  const message = info.error === 'RELOAD_FAILED' ? 'Nie udało się wczytać wersji z bazy. Twoje zmiany nie zostały usunięte.'
    : conflict ? 'Inna osoba zapisała nowszą wersję. Autozapis jest wstrzymany, aby nie nadpisać jej zmian.'
      : migration ? 'Autozapis wymaga istniejącej migracji zapisu planowania zapotrzebowania.'
        : info.error === 'UNAUTHORIZED' || info.error === 'FORBIDDEN' ? 'Sesja wygasła lub nie masz prawa do zapisu. Zaloguj się ponownie.'
          : info.error === 'LOAD_FAILED' ? 'Nie udało się pobrać aktualnego planu z bazy.'
            : info.error === 'RETRY_PAUSED' ? 'Kolejne próby zapisu nie powiodły się. Sprawdź połączenie i ponów próbę.'
              : info.status === 'error' ? 'Nie udało się zapisać zmian w bazie. Autozapis jest wstrzymany; pobierz kopię zmian i ponów próbę.'
                : 'Nie udało się zapisać zmian w bazie. Autozapis ponowi próbę po przerwie.';
  return <div className="flex flex-col gap-3 border-y border-red-500/40 bg-red-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
    <div className="min-w-0 text-sm text-red-200"><p>{message}</p>{info.pending && <p className="mt-1 text-xs text-dim">{info.backupAvailable ? 'Twoje zmiany są zachowane na tym urządzeniu.' : 'Nie udało się utworzyć kopii lokalnej. Nie zamykaj strony; pobierz kopię zmian.'}</p>}</div>
    <div className="flex shrink-0 flex-wrap gap-2">
      {info.pending && <Button variant="outline" className="min-h-10 text-xs" onClick={downloadDraft}><Download className="mr-2 h-4 w-4" />Pobierz kopię zmian</Button>}
      {conflict ? <Button variant="outline" className="min-h-10 text-xs" onClick={() => void loadLatest()}><RefreshCw className="mr-2 h-4 w-4" />Wczytaj wersję z bazy</Button>
        : <Button variant="outline" className="min-h-10 text-xs" onClick={retry}><RefreshCw className="mr-2 h-4 w-4" />Ponów próbę</Button>}
    </div>
  </div>;
};
