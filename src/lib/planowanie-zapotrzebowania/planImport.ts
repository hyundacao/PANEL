export type PlanQuantityStatus = 'parsed' | 'missing' | 'unrecognized' | 'manual';
export type PlanQuantityPart = { label: string; quantity: number };
export type PlanSourceFields = {
  sourceRow?: number;
  sourceSection?: string;
  sourceLabel?: string;
  sourceDetail?: string;
  sourceQuantity?: string;
  sourceStation?: string;
  sourceNorm?: string;
  sourceNotes?: string;
  quantityStatus?: PlanQuantityStatus;
  quantityParts?: PlanQuantityPart[];
  productionOutputOrder?: number;
  productionOutputCount?: number;
  productionSourceQuantity?: string;
};

const text = (value: unknown) => String(value ?? '');
const normalized = (value: unknown) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l').replace(/\s+/g, ' ').trim().toLowerCase();

// Only accept complete, unambiguous amounts. Never turn partially readable text into a quantity.
const numericQuantity = (value: string): number | null => {
  const number = value.trim().replace(/\s*szt\.?$/i, '').trim();
  if (!/^\d+(?:[ \t\u00a0\u202f]+\d{3})*(?:[,.]\d+)?$/.test(number)) return null;
  const parsed = Number(number.replace(/[ \t\u00a0\u202f]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const additiveQuantity = (value: string): number | null => {
  const parts = value.split(/\s*\+\s*/);
  const quantities = parts.map(numericQuantity);
  if (!parts.length || quantities.some((quantity) => quantity === null)) return null;
  return quantities.reduce<number>((sum, quantity) => sum + quantity!, 0);
};

export const parsePlanQuantity = (value: unknown): {
  sourceQuantity: string; totalQty: number; quantityStatus: PlanQuantityStatus; quantityParts: PlanQuantityPart[];
} => {
  const sourceQuantity = text(value);
  const trimmed = sourceQuantity.trim();
  const result = (totalQty: number, quantityStatus: PlanQuantityStatus, quantityParts: PlanQuantityPart[] = []) =>
    ({ sourceQuantity, totalQty, quantityStatus, quantityParts });
  if (!trimmed) return result(0, 'missing');
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0
    ? result(value, 'parsed') : result(0, 'unrecognized');
  const single = numericQuantity(trimmed);
  if (single !== null) return result(single, 'parsed');

  const markers = [...trimmed.matchAll(/(?:^|[\s,;/+]+)(LEFT|RIGHT|LEWA|PRAWA|LEWY|PRAWY|L|P)\s*[-–—:=]?\s*/gi)];
  if (markers.length && markers[0].index === 0) {
    const parts: PlanQuantityPart[] = [];
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const raw = trimmed.slice(marker.index! + marker[0].length, markers[index + 1]?.index).trim().replace(/[,;/+]$/, '').trim();
      const quantity = additiveQuantity(raw);
      const label = /^(L|LEFT|LEWA|LEWY)$/i.test(marker[1]) ? 'L' : 'P';
      if (quantity === null || parts.some((part) => part.label === label)) return result(0, 'unrecognized');
      parts.push({ label, quantity });
    }
    const sum = parts.reduce((total, part) => total + part.quantity, 0);
    return Number.isFinite(sum) ? result(sum, 'parsed', parts) : result(0, 'unrecognized');
  }

  const rawParts = trimmed.split(/,\s+|\s*\+\s*|\s*;\s*|\r?\n+/);
  if (rawParts.length > 1) {
    const parts = rawParts.map(numericQuantity);
    if (parts.every((part) => part !== null)) {
      const sum = parts.reduce<number>((total, part) => total + part!, 0);
      if (Number.isFinite(sum)) return result(sum, 'parsed', parts.map((quantity) => ({ label: '', quantity: quantity! })));
    }
  }
  return result(0, 'unrecognized');
};

export const quantityNeedsReview = (item: Pick<PlanSourceFields, 'quantityStatus'>) =>
  item.quantityStatus === 'missing' || item.quantityStatus === 'unrecognized';

export const knownRemainingQuantity = (item: PlanSourceFields & { totalQty: number; remainingQty?: number }) => {
  if (quantityNeedsReview(item)) return 0;
  const quantity = item.remainingQty ?? item.totalQty;
  return Math.max(0, Number.isFinite(quantity) ? quantity : 0);
};

export const quantityIssueLabel = (item: Pick<PlanSourceFields, 'quantityStatus'>) =>
  item.quantityStatus === 'missing' ? 'Brak ilości w pliku' : 'Nie odczytano ilości';

type ImportGroup = 'standard' | 'emergency' | 'planned';
export type ImportedPlanningRow = PlanSourceFields & {
  name: string; index: string; station: string; norm: unknown; notes: string;
  totalQty: number; planGroup: ImportGroup; plannedDate: string;
};

const isProductIndex = (value: string) =>
  /^[a-z0-9]+(?:[._/-][a-z0-9]+)*$/i.test(value) && /\d{3}/.test(value);

const readIndexList = (value: string) => {
  const parts = value.trim().replace(/^\(|\)$/g, '').split(/\s*[,;+]\s*/).map((part) => part.trim());
  return parts.length > 1 && parts.every(isProductIndex) ? parts : [];
};

const findIndexGroup = (value: string) => {
  const groups = [...value.matchAll(/\(([^()]*)\)/g)];
  for (let position = groups.length - 1; position >= 0; position -= 1) {
    const indices = readIndexList(groups[position][1]);
    if (indices.length > 1) return { match: groups[position], indices };
  }
  return null;
};

const splitTopLevelNamesBy = (value: string, separator: (character: string, position: number) => boolean) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let position = 0; position < value.length; position += 1) {
    const character = value[position];
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && separator(character, position)) {
      const part = value.slice(start, position).trim();
      if (part) parts.push(part);
      start = position + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) parts.push(last);
  return parts;
};

const splitTopLevelNames = (value: string, expectedCount: number) => {
  const commaSeparated = splitTopLevelNamesBy(value, (character) => character === ',' || character === ';');
  if (commaSeparated.length > 1) return commaSeparated;
  const plusSeparated = splitTopLevelNamesBy(value, (character, position) => character === '+'
    && /\s/.test(value[position - 1] ?? '') && /\s/.test(value[position + 1] ?? ''));
  return plusSeparated.length === expectedCount ? plusSeparated : commaSeparated;
};

const groupedOutputQuantities = (value: unknown, expectedCount: number): PlanQuantityPart[] => {
  const groups = text(value).trim().split(/,\s+|\s*;\s*|\r?\n+/).map((part) => part.trim()).filter(Boolean);
  if (groups.length !== expectedCount) return [];
  const quantities = groups.map(additiveQuantity);
  if (quantities.some((quantity) => quantity === null)) return [];
  return quantities.map((quantity) => ({ label: '', quantity: quantity! }));
};

// A single mould run may produce several different details at once. Preserve one
// production row, but expose every output as an independently calculated product.
export const splitPlanningRowOutputs = (row: ImportedPlanningRow): ImportedPlanningRow[] => {
  const directIndices = readIndexList(text(row.index));
  const namedIndexGroup = findIndexGroup(text(row.name));
  const indexedIndexGroup = findIndexGroup(text(row.index));
  const indices = directIndices.length
    ? directIndices
    : namedIndexGroup?.indices ?? indexedIndexGroup?.indices ?? [];
  if (indices.length < 2) {
    const reparsedQuantity = parsePlanQuantity(row.sourceQuantity);
    return row.quantityStatus === 'unrecognized' &&
      reparsedQuantity.quantityStatus === 'parsed' &&
      reparsedQuantity.totalQty === row.totalQty
      ? [{ ...row, quantityStatus: 'parsed' }]
      : [row];
  }

  let namesSource = text(row.name).trim();
  if (namedIndexGroup && namedIndexGroup.indices.join('|') === indices.join('|')) {
    const match = namedIndexGroup.match;
    namesSource = `${namesSource.slice(0, match.index)} ${namesSource.slice(match.index! + match[0].length)}`
      .replace(/\s+/g, ' ').trim();
  }
  const names = splitTopLevelNames(namesSource, indices.length);
  const reparsedQuantity = parsePlanQuantity(row.sourceQuantity);
  const groupedQuantities = groupedOutputQuantities(row.sourceQuantity, indices.length);
  const quantities = groupedQuantities.length ? groupedQuantities : reparsedQuantity.quantityStatus === 'parsed'
    ? reparsedQuantity.quantityParts
    : row.quantityParts ?? [];
  if (row.quantityStatus === 'manual') return [row];
  if (row.quantityStatus !== 'parsed' && reparsedQuantity.quantityStatus !== 'parsed') return [row];
  if (names.length !== indices.length || quantities.length !== indices.length) {
    return [{ ...row, totalQty: 0, quantityStatus: 'unrecognized' }];
  }

  return indices.map((index, position) => {
    const quantity = quantities[position];
    const formattedQuantity = quantity.quantity.toLocaleString('pl-PL', { maximumFractionDigits: 3 });
    return {
      ...row,
      name: names[position],
      index,
      totalQty: quantity.quantity,
      quantityStatus: 'parsed',
      sourceQuantity: quantity.label ? `${quantity.label} - ${formattedQuantity}` : formattedQuantity,
      quantityParts: [],
      productionOutputOrder: position,
      productionOutputCount: indices.length,
      productionSourceQuantity: row.sourceQuantity
    };
  });
};

// Section headings are retained as sections, not artificial production tasks.
// Every detail row is retained, including blank/invalid quantities and missing stations.
export const readPlanningRows = (rows: unknown[][], rowOffset = 0): ImportedPlanningRow[] => {
  const normalizedRows = rows.map((row) => row.map(normalized));
  const scheduleHeader = normalizedRows.findIndex((row) => row.some((cell) => cell.includes('ilosc'))
    && row.some((cell) => cell.includes('norma')));
  const headerIndex = scheduleHeader >= 0 ? scheduleHeader : normalizedRows.findIndex((row) =>
    row.some((cell) => /indeks|detal|nazwa|produkt|kod/.test(cell)) && row.some((cell) => /ilosc|qty/.test(cell)));
  if (headerIndex < 0) return [];
  const headers = normalizedRows[headerIndex];
  const find = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  const qtyColumn = find(/ilosc|qty/);
  const indexColumn = find(/^(indeks|kod|symbol|index)(\s|$)/);
  const namedColumn = find(/detal|produkt|nazwa/);
  const nameColumn = namedColumn >= 0 ? namedColumn : scheduleHeader >= 0 ? Math.max(1, qtyColumn - 1) : indexColumn;
  const stationColumn = find(/^st\.?$|stanowisko|maszyna|wtryskarka|stol|^wtr$/);
  const normColumn = find(/norma|wydajnosc/);
  const notesColumn = find(/uwagi|komentarz/);
  const stationIndex = stationColumn >= 0 ? stationColumn : scheduleHeader >= 0 ? 3 : -1;
  const normIndex = normColumn >= 0 ? normColumn : scheduleHeader >= 0 ? 4 : -1;
  const notesIndex = notesColumn >= 0 ? notesColumn : scheduleHeader >= 0 ? 6 : -1;
  let planGroup: ImportGroup = 'standard';
  let section = 'Plan bieżący';
  let currentStation = '';
  let currentNorm: unknown = '';
  let lastPlannedDate = '';
  const result: ImportedPlanningRow[] = [];

  rows.slice(headerIndex + 1).forEach((row, position) => {
    const detail = text(row[nameColumn] || row[indexColumn]);
    const label = normalized(detail);
    const explicitStation = text(row[stationIndex]).trim();
    if (/^(awaryjnie|narzedziownia|lakiernia)$/.test(label) || label.includes('planowane zmiany form') || /^panele\s+(se|bo)$/.test(label)) {
      planGroup = label === 'awaryjnie' ? 'emergency' : label.includes('planowane zmiany form') ? 'planned' : 'standard';
      section = detail.trim();
      currentStation = explicitStation;
      currentNorm = row[normIndex];
      lastPlannedDate = '';
      return;
    }
    if (!detail.trim()) return;
    if (/^(nazwa indeksu|stol lub maszyna|detal|nazwa|produkt)$/.test(label) && /ilosc|qty/.test(normalized(row[qtyColumn]))) return;
    if (scheduleHeader >= 0 && planGroup !== 'planned' && /^panele\s+(se|bo)$/.test(normalized(section))
      && (row[0] || (explicitStation && !/^st\s*[12]$/i.test(explicitStation)))) section = 'Plan bieżący';
    const station = explicitStation || currentStation;
    const continuesPanel = !explicitStation && /^st\s*[12]$/i.test(currentStation);
    const norm = row[normIndex] || (continuesPanel ? currentNorm : '');
    if (explicitStation) {
      currentStation = explicitStation;
      currentNorm = row[normIndex];
    }
    const plannedDate = planGroup === 'planned' ? text(row[0]).trim() || lastPlannedDate : '';
    if (plannedDate) lastPlannedDate = plannedDate;
    result.push({
      name: detail, index: indexColumn >= 0 ? text(row[indexColumn]) : detail, station, norm,
      notes: text(row[notesIndex]), planGroup, plannedDate,
      ...parsePlanQuantity(row[qtyColumn]),
      sourceRow: rowOffset + headerIndex + position + 2,
      sourceSection: section, sourceLabel: scheduleHeader >= 0 ? text(row[0]) : '',
      sourceDetail: detail, sourceStation: text(row[stationIndex]), sourceNorm: text(row[normIndex]), sourceNotes: text(row[notesIndex])
    });
  });
  return result;
};

export const planningSections = <T extends { planGroup?: ImportGroup; sourceSection?: string }>(items: T[]) => {
  const sections: Array<{ title: string; group: ImportGroup; items: T[] }> = [];
  items.forEach((item) => {
    const group = item.planGroup ?? 'standard';
    const title = item.sourceSection || (group === 'planned' ? 'Planowane zmiany form — przyszłe' : group === 'emergency' ? 'Pozycje awaryjne' : 'Plan na dzisiaj');
    const previous = sections.at(-1);
    if (previous?.title === title && previous.group === group) previous.items.push(item);
    else sections.push({ title, group, items: [item] });
  });
  return sections;
};
