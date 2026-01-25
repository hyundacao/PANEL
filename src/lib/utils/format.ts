export const formatKg = (value: number) =>
  new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  }).format(value) + ' kg';

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);

export const formatDate = (date: Date) =>
  new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(date)
    .split('.')
    .reverse()
    .join('-');

export const parseQtyInput = (raw: string) => {
  const normalized = raw.replace(/\s+/g, '').replace(/_/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.min(value, 999999));
};
