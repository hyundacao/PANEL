const normalizeOptionToken = (value: string) =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');

export const ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS = [
  '1',
  '4',
  '10',
  '11',
  '13',
  '40',
  '41',
  '51',
  '55',
  '56'
] as const;

export const ERP_PUSH_DISPATCHER_TARGET_OPTIONS = [
  'HALA 1',
  'HALA 2',
  'HALA 3',
  'BAKOMA',
  'PACZKA',
  'LAKIERNIA',
  'INNA LOKALIZACJA'
] as const;

export const normalizeWarehousemanOptionLabel = (value: string) =>
  normalizeOptionToken(value);

export const normalizeDispatcherOptionLabel = (value: string) =>
  normalizeOptionToken(value);

const dedupeOptions = (
  values: string[],
  normalizer: (value: string) => string
) => {
  const unique = new Set<string>();
  values.forEach((item) => {
    const normalized = normalizer(item);
    if (!normalized) return;
    unique.add(normalized);
  });
  return [...unique];
};

export const normalizeWarehousemanOptions = (value: unknown) => {
  if (!Array.isArray(value)) return [...ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS];
  const deduped = dedupeOptions(value.map((item) => String(item ?? '')), normalizeWarehousemanOptionLabel);
  if (deduped.length === 0) return [...ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS];
  return deduped;
};

export const normalizeDispatcherOptions = (value: unknown) => {
  if (!Array.isArray(value)) return [...ERP_PUSH_DISPATCHER_TARGET_OPTIONS];
  const deduped = dedupeOptions(value.map((item) => String(item ?? '')), normalizeDispatcherOptionLabel);
  if (deduped.length === 0) return [...ERP_PUSH_DISPATCHER_TARGET_OPTIONS];
  return deduped;
};

const normalizedPaczkaToken = normalizeDispatcherOptionLabel('PACZKA');
const isPaczkaTargetLocation = (value: string) =>
  normalizeDispatcherOptionLabel(value).includes(normalizedPaczkaToken);

export const getDefaultDispatcherSelection = (options: readonly string[]) => {
  const defaultOptions = options.filter((option) => !isPaczkaTargetLocation(option));
  if (defaultOptions.length > 0) return [...defaultOptions];
  return [...options];
};

export const ERP_PUSH_DEFAULT_WAREHOUSEMAN_SOURCE_SELECTION = [
  ...ERP_PUSH_WAREHOUSEMAN_SOURCE_OPTIONS
];

export const ERP_PUSH_DEFAULT_DISPATCHER_TARGET_SELECTION = getDefaultDispatcherSelection(
  ERP_PUSH_DISPATCHER_TARGET_OPTIONS
);

const normalizeSelection = (
  value: string[],
  options: readonly string[],
  normalizer: (value: string) => string
) => {
  const allowed = new Map(
    options.map((option) => [normalizer(option), option])
  );
  const unique = new Set<string>();
  value.forEach((option) => {
    const canonical = allowed.get(normalizer(option));
    if (canonical) unique.add(canonical);
  });
  return [...unique];
};

export const normalizeWarehousemanSelection = (
  value: string[],
  options: readonly string[]
) => normalizeSelection(value, options, normalizeWarehousemanOptionLabel);

export const normalizeDispatcherSelection = (
  value: string[],
  options: readonly string[]
) => normalizeSelection(value, options, normalizeDispatcherOptionLabel);
