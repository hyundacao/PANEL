import { isPieceGrindingUnit } from '@/lib/utils/originalInventoryGrinding';

type SpisErpAvailabilityProps = {
  name: string;
  date: string;
  snapshot: { availableQty: number; unit: string } | null;
  hasSnapshot: boolean;
  loading: boolean;
  error: boolean;
  migrationRequired: boolean;
  reservationsLoading: boolean;
  reservationsError: boolean;
  onRetry: () => void;
};

const quantityFormatter = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 });

export function SpisErpAvailability({
  name, date, snapshot, hasSnapshot, loading, error, migrationRequired,
  reservationsLoading, reservationsError, onRetry
}: SpisErpAvailabilityProps) {
  if (!name.trim() || !date) return null;

  const needsReservations = Boolean(snapshot && isPieceGrindingUnit(snapshot.unit));
  const failed = error || (needsReservations && reservationsError);
  const pending = loading || (needsReservations && reservationsLoading);
  let message = '';
  if (migrationRequired) message = 'Nie można odczytać stanów ERP. Wymagana aktualizacja bazy.';
  else if (failed) message = 'Nie udało się pobrać danych ERP lub rezerwacji.';
  else if (pending) message = 'Wczytywanie danych ERP…';
  else if (!hasSnapshot) message = 'Brak danych ERP dla tego dnia. Wgraj stany w zakładce „Stany ERP”.';
  else if (!snapshot) message = 'Brak danych ERP dla wybranego materiału.';

  return (
    <p className={message ? 'mt-1 text-xs text-dim' : 'mt-1 whitespace-nowrap text-xs text-violet-300'} role="status" aria-live="polite">
      ERP —{' '}
      {message ? (
        <span className={failed || migrationRequired ? 'text-danger' : undefined}>{message}</span>
      ) : snapshot ? (
        <span className="font-bold tabular-nums">
          {quantityFormatter.format(snapshot.availableQty)} {snapshot.unit}
        </span>
      ) : null}
      {failed && !migrationRequired && (
        <button type="button" onClick={onRetry}
          className="ml-2 font-semibold text-brandHover underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          Spróbuj ponownie
        </button>
      )}
    </p>
  );
}
