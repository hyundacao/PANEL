export type PalletSetComponent = {
  catalogId: string;
  name: string;
  indexCode: string;
  indexCode2: string;
  warehouseCode: string;
  unit: string;
  qty: number;
};

export type PalletSet = {
  id: string;
  name: string;
  active: boolean;
  primaryCatalogId: string;
  components: PalletSetComponent[];
};

export const PALLET_SET_SOURCE_TYPE = 'PALLET_SET';
export const isPieceUnit = (unit: string) => /^(szt\.?|sztuk[ai]?|pcs\.?)$/i.test(unit.trim());
export const isPalletCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000;

export const palletSetError = (set: PalletSet): string | null => {
  if (!set.name.trim()) return 'Podaj nazwę zestawu.';
  if (!set.components.length) return 'Dodaj składniki zestawu.';
  if (!set.components.some((item) => item.catalogId === set.primaryCatalogId)) return 'Wybierz indeks wyszukiwany.';
  if (set.components.some((item) => !item.catalogId || !item.name.trim())) return 'Wybierz składniki z katalogu.';
  if (new Set(set.components.map((item) => item.catalogId)).size !== set.components.length) return 'Ten sam indeks występuje więcej niż raz.';
  if (set.components.some((item) => !isPieceUnit(item.unit))) return 'Składniki zestawu muszą być liczone w sztukach.';
  if (set.components.some((item) => !isPalletCount(item.qty))) return 'Podaj dodatnią, całkowitą liczbę sztuk każdego składnika.';
  return null;
};

export const normalizePalletSets = (value: unknown): PalletSet[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === 'object' && typeof item.id === 'string').map((item) => ({
    id: item.id,
    name: String(item.name ?? ''),
    active: item.active === true,
    primaryCatalogId: String(item.primaryCatalogId ?? ''),
    components: Array.isArray(item.components) ? item.components.filter((part: unknown) => part && typeof part === 'object').map((part: Record<string, unknown>) => ({
      catalogId: String(part.catalogId ?? ''), name: String(part.name ?? ''),
      indexCode: String(part.indexCode ?? ''), indexCode2: String(part.indexCode2 ?? ''),
      warehouseCode: String(part.warehouseCode ?? ''), unit: String(part.unit ?? ''), qty: Number(part.qty) || 0
    })) : []
  }));
};

export const validPalletSetsState = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 200) return false;
  const sets = normalizePalletSets(value);
  if (sets.length !== value.length || new Set(sets.map((set) => set.id)).size !== sets.length) return false;
  return sets.every((set) => set.id.length > 0 && set.id.length <= 100 && set.name.length <= 300 &&
    set.components.length <= 20 && set.components.every((item) => item.catalogId.length <= 200 && item.name.length <= 500) &&
    (!set.active || !palletSetError(set)));
};

export const palletSetFingerprint = (set: PalletSet) => JSON.stringify({
  id: set.id, name: set.name, active: set.active, primaryCatalogId: set.primaryCatalogId,
  components: [...set.components].sort((a, b) => a.catalogId.localeCompare(b.catalogId))
});

export const palletSetTotals = (set: PalletSet, count: number) => {
  if (palletSetError(set) || !isPalletCount(count)) return [];
  return set.components.map((item) => ({ ...item, total: item.qty * count }));
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const palletBatchPrefix = (batchId: string) => {
  if (!uuidPattern.test(batchId)) throw new Error('INVALID_PALLET_BATCH');
  return `pallet:v1:${batchId}:`;
};

type PalletSource = { batchId: string; catalogId: string; qtyPerSet: number };

// The source key keeps the original ratio with each stock row, independently of later profile edits.
export const palletSourceId = (source: PalletSource) => palletBatchPrefix(source.batchId) + encodeURIComponent(JSON.stringify({
  catalogId: source.catalogId, qtyPerSet: source.qtyPerSet
}));

export const parsePalletSource = (sourceId?: string | null): PalletSource | null => {
  const match = /^pallet:v1:([0-9a-f-]{36}):(.+)$/i.exec(sourceId ?? '');
  if (!match || !uuidPattern.test(match[1])) return null;
  try {
    const value = JSON.parse(decodeURIComponent(match[2]));
    if (typeof value?.catalogId !== 'string' || !value.catalogId || !isPalletCount(value.qtyPerSet)) return null;
    return { batchId: match[1], catalogId: value.catalogId, qtyPerSet: value.qtyPerSet };
  } catch { return null; }
};

export const palletInventoryError = (code: string) => ({
  PALLET_SET_CHANGED: 'Zestaw został zmieniony w ustawieniach. Wybierz go ponownie.',
  PALLET_SET_NOT_FOUND: 'Zestaw nie istnieje lub jest nieaktywny.',
  PALLET_CATALOG_CHANGED: 'Składnik zestawu zmienił się w katalogu. Popraw zestaw w ustawieniach.',
  PALLET_COUNT_REQUIRED: 'Wpisz dodatnią, całkowitą liczbę pełnych zestawów.',
  PALLET_GROUP_REQUIRED: 'Ten wpis należy do zestawu. Edytuj cały zestaw.',
  PALLET_BATCH_CONFLICT: 'Ten zapis zestawu już istnieje. Odśwież spis.',
  WAREHOUSE_REQUIRED: 'Wybierz halę do spisu.',
  DATE_REQUIRED: 'Wybierz poprawny dzień spisu.',
  ENTRY_MISSING: 'Nie znaleziono wpisu zestawu.',
  FORBIDDEN: 'Brak uprawnień do zmiany spisu.'
} as Record<string, string>)[code] ?? 'Nie zapisano zestawu. Spróbuj ponownie.';
