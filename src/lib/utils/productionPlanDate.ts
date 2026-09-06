const PRODUCTION_PLAN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isProductionPlanDate = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const match = value.match(PRODUCTION_PLAN_DATE_PATTERN);
  if (!match) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const getWarsawProductionPlanDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const resolveProductionPlanDate = (value: unknown) => {
  const requested = String(value ?? '').trim();
  if (!requested) return getWarsawProductionPlanDate();
  return isProductionPlanDate(requested) ? requested : null;
};

export const withProductionPlanDate = (href: string, planDate: unknown) => {
  if (!href.startsWith('/przygotowanie-produkcji') || !isProductionPlanDate(planDate)) return href;
  const [path, rawQuery = ''] = href.split('?');
  const query = new URLSearchParams(rawQuery);
  query.set('date', planDate);
  return `${path}?${query.toString()}`;
};
