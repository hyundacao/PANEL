export const PRODUCTION_HALL_NOTE = 'productionHall';
export type ProductionHall = 'hala-1' | 'hala-2';
export type ProductionHallSelection = ProductionHall | 'both';
export type ProductionHallAssignment = ProductionHallSelection | 'unassigned' | '';
export type ProductionHallFilter = ProductionHall | 'unassigned' | 'all';
export type ProductionStationMapping = { station: string; areaId: string };

export const isProductionTaskReferenceTeam = (team: string) => team === 'distribution' || team === 'technician';
export const isProductionHall = (value: unknown): value is ProductionHall => value === 'hala-1' || value === 'hala-2';
export const isProductionHallSelection = (value: unknown): value is ProductionHallSelection => isProductionHall(value) || value === 'both';
export const productionHallLabel = (value: unknown) => value === 'both' ? 'Hala 1 i Hala 2' : value === 'hala-1' ? 'Hala 1' : value === 'hala-2' ? 'Hala 2' : 'Nieprzypisane';
export const normalizeProductionHallFilter = (value: unknown): ProductionHallFilter => isProductionHall(value) || value === 'unassigned' ? value : 'all';
export const normalizeProductionHallAssignment = (value: unknown): ProductionHallAssignment => isProductionHallSelection(value) || value === 'unassigned' ? value : '';
export const productionHallMatchesFilter = (assignment: ProductionHallAssignment | undefined, filter: ProductionHallFilter) =>
  filter === 'all' || assignment === filter || (assignment === 'both' && isProductionHall(filter));

const stationKey = (value: string) => value.toUpperCase().replace(/[.\s-]+/g, '').replace(/^(WTR|ST)0+(\d)/, '$1$2');
export const productionTaskHall = (
  task: { station: string; notes: Record<string, string | undefined> },
  mappings: readonly ProductionStationMapping[]
): ProductionHallSelection | 'unassigned' => {
  const explicit = normalizeProductionHallAssignment(task.notes[PRODUCTION_HALL_NOTE]);
  if (explicit) return explicit;
  const areas = new Set(mappings.filter(m => stationKey(m.station) === stationKey(task.station)).map(m => m.areaId));
  const [area] = areas;
  return areas.size === 1 && isProductionHall(area) ? area : 'unassigned';
};

export type TaskReferenceMaterial = { code: string; name: string; category: string; usage: number; unit: string };
export type TaskReferenceTechnology = {
  id: string; productIndex: string; productName: string; label: string;
  materials: TaskReferenceMaterial[];
  linkedProducts: TaskReferenceMaterial[];
  surplusMaterials: TaskReferenceMaterial[];
  emergencyMaterials: TaskReferenceMaterial[];
};
export type TaskTechnologyReference = {
  status: 'matched' | 'partial' | 'missing' | 'ambiguous' | 'unselected' | 'conflict' | 'unavailable';
  items: TaskReferenceTechnology[];
  source?: 'planning';
  changedAt?: string;
  issues?: { productIndex: string; productName: string; status: TaskTechnologyReference['status'] }[];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const normalize = (value: unknown) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/gi, 'l').replace(/\s+/g, ' ').toUpperCase();
const array = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
const indexKey = (value: unknown) => {
  const key = normalize(value);
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
};
const nameKey = (value: unknown) => normalize(value).replace(/[,;]+/g, ' ')
  .replace(/[.,;:\s]+$/, '').replace(/\s*([()+])\s*/g, '$1').replace(/\s+/g, ' ').trim();
const isIndex = (value: string) => /^[A-Z0-9]+(?:[._/-][A-Z0-9]+)*$/.test(value) && /\d{3}/.test(value);
const materials = (value: unknown): TaskReferenceMaterial[] => array(value).map(m => ({
  code: text(m.code), name: text(m.name), category: text(m.category), usage: Number(m.usage) || 0, unit: text(m.unit)
}));

export const taskProductIndexes = (detail: string, knownIndexes: readonly string[] = []) => {
  const known = new Set(knownIndexes.map(normalize).filter(Boolean));
  const groups = [...detail.matchAll(/\(([^()]+)\)/g)].map(match => match[1]);
  const indexes = groups.flatMap(group => group.split(/[,;]/)).map(normalize)
    .filter(value => isIndex(value) || known.has(value));
  const leading = /^\s*([A-Z]*\d{4,}[A-Z0-9._/-]*)\s+/i.exec(detail);
  if (leading) indexes.push(normalize(leading[1]));
  const trailing = /\s+([A-Z0-9][A-Z0-9._/-]*)\s*[.,;]?$/i.exec(detail);
  if (trailing && isIndex(normalize(trailing[1])) && trailing[1].replace(/\D/g, '').length >= 7) indexes.push(normalize(trailing[1]));
  return [...new Set(indexes)];
};

const taskProductName = (detail: string, knownIndexes: readonly string[] = []) => {
  const indexes = taskProductIndexes(detail, knownIndexes);
  return detail.replace(/\(([^()]+)\)/g, (whole, inner: string) =>
    inner.split(/[,;]/).every(part => indexes.includes(normalize(part))) ? '' : whole)
    .replace(/^\s*[-–—]?\s*(?:WTR|ST)\.?\s*\d+\s+/i, '')
    .split(/\s+/).filter(part => !indexes.includes(normalize(part))).join(' ');
};

export const buildTaskTechnologyReference = (detail: string, raw: unknown): TaskTechnologyReference => {
  const technologies = array(raw).filter(t => t.archived !== true && text(t.id) && text(t.productIndex));
  // Accept catalogue-confirmed letter-only/short-digit codes as well. Do not
  // loosen the generic parser: qualifiers such as (MUCELL) remain part of names.
  const knownIndexes = technologies.map(t => text(t.productIndex));
  const indexes = taskProductIndexes(detail, knownIndexes).map(indexKey);
  const productName = nameKey(taskProductName(detail, knownIndexes));
  // An explicit index must never fall back to a different product with the same name.
  let matches = indexes.length
    ? technologies.filter(t => indexes.includes(indexKey(t.productIndex)))
    : technologies.filter(t => nameKey(t.productName) === productName);
  if (!matches.length) return { status: 'missing', items: [] };
  if (new Set(matches.map(t => indexKey(t.productIndex))).size > 1) return { status: 'ambiguous', items: [] };
  // Some catalogue indexes are reused. A name may disambiguate that collision,
  // but must never redirect an explicit index to another product.
  if (new Set(matches.map(t => nameKey(t.productName))).size > 1) {
    matches = matches.filter(t => nameKey(t.productName) === productName);
    if (!matches.length) return { status: 'ambiguous', items: [] };
  }
  const sorted = [...matches].sort((a, b) => Number(a.variant !== 'base') - Number(b.variant !== 'base') || Number(a.alternativeNo || 0) - Number(b.alternativeNo || 0));
  return { status: 'matched', items: sorted.map(t => ({
    id: text(t.id), productIndex: text(t.productIndex), productName: text(t.productName),
    label: `${t.variant === 'alternative' ? `Awaryjna ${Number(t.alternativeNo) || 1}` : 'Bazowa'}${text(t.description) ? ` · ${text(t.description)}` : ''}`,
    materials: materials(t.materials), surplusMaterials: materials(t.surplusMaterials), emergencyMaterials: materials(t.emergencyMaterials),
    linkedProducts: array(t.linkedProducts).map(m => ({
      code: text(m.productIndex), name: text(m.productName), category: 'Powiązany półwyrób', usage: Number(m.usage) || 0, unit: text(m.unit) || 'szt.'
    }))
  })) };
};

export const TECHNOLOGY_PREVIEW_FIELD = '__technologyPreview';
type PreviewSelection = {
  index: string; name: string; station: string; areaId: string;
  technologyId: string; manualOverride: boolean;
  workingMaterials: TaskReferenceMaterial[] | null;
  changedAt: string; removed?: boolean;
};
export type TechnologyPreviewProjection = { version: 1; days: Record<string, PreviewSelection[]> };
const dateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const selectionKey = (item: Record<string, unknown> | PreviewSelection) => JSON.stringify([
  indexKey(item.index) || nameKey(item.name), stationKey(text(item.station)), text(item.areaId)
]);
const recipeKey = (item: Record<string, unknown> | PreviewSelection) => JSON.stringify([
  text(item.technologyId), item.manualOverride === true, item.removed === true,
  item.workingMaterials ?? null
]);
const groupSelections = (items: PreviewSelection[]) => {
  const groups = new Map<string, PreviewSelection[]>();
  for (const item of items) {
    const key = selectionKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

// Small server-generated projection saved atomically with the existing workspace.
// Only recipe/location changes advance the timestamp; quantity, checkboxes, notes
// and unrelated saves must not take ownership of another planner's selection.
export const buildTechnologyPreviewProjection = (
  state: Record<string, unknown>, previous: unknown, changedAt: string,
  today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date())
): TechnologyPreviewProjection => {
  const plans = { ...record(state.dailyPlans) };
  if (dateKey(text(state.selectedPlanDate))) plans[text(state.selectedPlanDate)] = state.plan ?? [];
  const before = record(record(previous).days);
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const days: Record<string, PreviewSelection[]> = {};
  for (const day of new Set([...Object.keys(plans), ...Object.keys(before)])) {
    if (!dateKey(day) || day < cutoffKey) continue;
    const next = array(plans[day]).filter(item => text(item.index) || text(item.name)).map(item => ({
      index: text(item.index), name: text(item.name), station: text(item.station), areaId: text(item.areaId),
      technologyId: text(item.technologyId), manualOverride: item.manualOverride === true,
      workingMaterials: (item.manualOverride === true || !text(item.technologyId)) && Array.isArray(item.workingMaterials)
        ? materials(item.workingMaterials) : null,
      changedAt
    }));
    const oldGroups = groupSelections(array(before[day]) as PreviewSelection[]);
    const newGroups = groupSelections(next);
    const result: PreviewSelection[] = [];
    for (const key of new Set([...oldGroups.keys(), ...newGroups.keys()])) {
      const old = oldGroups.get(key) ?? [];
      const current = newGroups.get(key) ?? [];
      const signature = (rows: PreviewSelection[]) => JSON.stringify([...new Set(rows.map(recipeKey))].sort());
      if (current.length) {
        const timestamp = signature(old) === signature(current) ? old[0].changedAt : changedAt;
        result.push(...current.map(item => ({ ...item, changedAt: timestamp })));
      } else if (old.length) {
        // Tombstones stop an older workspace resurrecting a removed selection.
        result.push(...old.map(item => ({ ...item, removed: true, changedAt: item.removed ? item.changedAt : changedAt })));
      }
    }
    if (result.length) days[day] = result;
  }
  return { version: 1, days };
};

const buildSingleSelectedTaskTechnologyReference = (
  detail: string, station: string, areaId: string, rawTechnologies: unknown, rawSelections: unknown
): TaskTechnologyReference => {
  const knownIndexes = array(rawTechnologies).filter(t => t.archived !== true).map(t => text(t.productIndex));
  const productName = nameKey(taskProductName(detail, knownIndexes));
  let library = buildTaskTechnologyReference(detail, rawTechnologies);
  if (library.status === 'ambiguous' && !taskProductIndexes(detail, knownIndexes).length) {
    const planMatches = array(rawSelections).filter(item => stationKey(text(item.station)) === stationKey(station)
      && (!areaId || text(item.areaId) === areaId) && nameKey(item.name) === productName);
    const planIndexes = new Set(planMatches.map(item => indexKey(item.index)));
    if (planIndexes.size === 1 && !planIndexes.has('')) {
      library = buildTaskTechnologyReference(`${detail} (${text(planMatches[0].index)})`, rawTechnologies);
    }
  }
  if (library.status !== 'matched') return library;
  const indexes = new Set(library.items.map(item => indexKey(item.productIndex)));
  const matches = array(rawSelections).filter(item => stationKey(text(item.station)) === stationKey(station)
    && (!areaId || text(item.areaId) === areaId)
    && (text(item.index) ? indexes.has(indexKey(item.index)) : nameKey(item.name) === productName));
  if (!matches.length) return { status: 'unselected', items: [] };
  // Legacy workspaces have no per-recipe timestamp. An untouched blank choice
  // is not a competing recipe. Keep dated clears, tombstones and manual recipes:
  // ignoring those could resurrect an intentionally removed selection.
  const choices = matches.filter(item => text(item.changedAt) || text(item.technologyId)
    || item.removed === true || item.manualOverride === true || array(item.workingMaterials).length > 0);
  if (!choices.length) return { status: 'unselected', items: [] };
  const latest = choices.reduce((time, item) => text(item.changedAt) > time ? text(item.changedAt) : time, '');
  const selected = choices.filter(item => text(item.changedAt) === latest);
  if (new Set(selected.map(recipeKey)).size > 1) return { status: 'conflict', items: [] };
  const choice = selected[0];
  if (choice.removed || !text(choice.technologyId)) return { status: 'unselected', items: [] };
  const technology = library.items.find(item => item.id === choice.technologyId);
  if (!technology) return { status: 'unavailable', items: [] };
  return {
    status: 'matched', source: 'planning', changedAt: latest,
    items: [{ ...technology,
      label: choice.manualOverride ? `Robocza · ${technology.label}` : technology.label,
      materials: choice.manualOverride && Array.isArray(choice.workingMaterials) ? materials(choice.workingMaterials) : technology.materials,
      // Alternative packaging is not an operator-selectable recipe.
      emergencyMaterials: []
    }]
  };
};

// Like the planning import, a final list of indexes describes separate outputs
// of one machine/mould. Other parenthesized numbers may only be drawing codes.
const splitTopLevelTaskNames = (value: string, usePlus = false) => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let position = 0; position < value.length; position += 1) {
    const character = value[position];
    if (character === '(') depth += 1;
    else if (character === ')') depth = Math.max(0, depth - 1);
    const separator = usePlus
      ? character === '+' && /\s/.test(value[position - 1] ?? '') && /\s/.test(value[position + 1] ?? '')
      : character === ',' || character === ';';
    if (depth === 0 && separator) {
      parts.push(value.slice(start, position).trim());
      start = position + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
};

export const taskTechnologyProducts = (detail: string, knownIndexes: readonly string[] = []): { index: string; name: string }[] => {
  const known = new Set(knownIndexes.map(normalize).filter(Boolean));
  const recognizedIndex = (value: string) => isIndex(normalize(value)) || known.has(normalize(value));
  const groups = [...detail.matchAll(/\(([^()]*)\)/g)];
  for (const group of groups.reverse()) {
    const indexes = group[1].split(/\s*[,;+]\s*/).map(text);
    if (indexes.length < 2 || !indexes.every(recognizedIndex)) continue;
    const namesSource = `${detail.slice(0, group.index)} ${detail.slice(group.index! + group[0].length)}`
      .replace(/^\s*[-–—]?\s*(?:WTR|ST)\.?\s*\d+\s+/i, '').trim();
    let names = splitTopLevelTaskNames(namesSource);
    if (names.length === 1) names = splitTopLevelTaskNames(namesSource, true);
    // The explicit index is sufficient even when the row doesn't list separate
    // names. Never assign mismatched names to indexes by a guessed position.
    return indexes.map((index, position) => ({ index, name: names.length === indexes.length ? names[position] : '' }));
  }
  // Also support "LEFT (A123), RIGHT (B456)" without a trailing combined group.
  let parts = splitTopLevelTaskNames(detail);
  if (parts.length === 1) parts = splitTopLevelTaskNames(detail, true);
  if (parts.length < 2) return [];
  const products = parts.map(part => {
    const group = /\(([^()]*)\)\s*[.;]?\s*$/.exec(part);
    if (!group || !recognizedIndex(group[1])) return null;
    return { index: text(group[1]), name: part.slice(0, group.index).trim() };
  });
  return products.every(product => product !== null) ? products as { index: string; name: string }[] : [];
};

export const buildSelectedTaskTechnologyReference = (
  detail: string, station: string, areaId: string, rawTechnologies: unknown, rawSelections: unknown
): TaskTechnologyReference => {
  const knownIndexes = array(rawTechnologies).filter(t => t.archived !== true).map(t => text(t.productIndex));
  const products = taskTechnologyProducts(detail, knownIndexes);
  if (!products.length) return buildSingleSelectedTaskTechnologyReference(detail, station, areaId, rawTechnologies, rawSelections);
  const items: TaskReferenceTechnology[] = [];
  const issues: NonNullable<TaskTechnologyReference['issues']> = [];
  let changedAt = '';
  for (const product of products) {
    // Restrict the library before matching: drawing codes inside a product name
    // must not compete with its explicit index from the combined output group.
    const library = array(rawTechnologies).filter(item => indexKey(item.productIndex) === indexKey(product.index));
    const result = buildSingleSelectedTaskTechnologyReference(`${product.name} (${product.index})`, station, areaId, library, rawSelections);
    if (result.status !== 'matched') {
      issues.push({ productIndex: product.index, productName: product.name, status: result.status });
      continue;
    }
    for (const item of result.items) if (!items.some(existing => existing.id === item.id)) items.push(item);
    if ((result.changedAt ?? '') > changedAt) changedAt = result.changedAt!;
  }
  return {
    status: issues.length ? items.length ? 'partial' : issues[0].status : 'matched',
    items, source: 'planning', changedAt, ...(issues.length ? { issues } : {})
  };
};

export type TaskPreparationMaterial = {
  code: string; name: string; unit: string;
  products: { index: string; name: string }[];
  purposes: ('production' | 'surplus' | 'emergency')[];
};

// This is a list of things to prepare, not a demand calculation. In particular,
// different usage coefficients do not create duplicate material rows.
export const buildTaskPreparationList = (technologies: readonly TaskReferenceTechnology[]): TaskPreparationMaterial[] => {
  const entries = technologies.flatMap(technology => {
    const product = { index: technology.productIndex, name: technology.productName };
    return [
      ...[...technology.materials, ...technology.linkedProducts].map(material => ({ material, product, purpose: 'production' as const })),
      ...technology.surplusMaterials.map(material => ({ material, product, purpose: 'surplus' as const })),
      ...technology.emergencyMaterials.map(material => ({ material, product, purpose: 'emergency' as const }))
    ];
  }).filter(({ material }) => text(material.name) || text(material.code));
  const unitKey = (unit: string) => {
    const value = normalize(unit).replace(/[.\s]+/g, '');
    return ['SZT', 'SZTUK', 'SZTUKI', 'SZTUKA'].includes(value) ? 'SZT' : value;
  };
  const nameUnitKey = (material: TaskReferenceMaterial) => JSON.stringify([nameKey(material.name), unitKey(material.unit)]);
  const codesByName = new Map<string, Map<string, string>>();
  for (const { material } of entries) {
    if (!text(material.code) || !text(material.name)) continue;
    const key = nameUnitKey(material);
    const codes = codesByName.get(key) ?? new Map<string, string>();
    codes.set(normalize(material.code), material.code);
    codesByName.set(key, codes);
  }
  const rows = new Map<string, TaskPreparationMaterial>();
  for (const { material, product, purpose } of entries) {
    const codes = codesByName.get(nameUnitKey(material));
    // Name-only duplicates may join a coded row only if that name identifies one
    // code. Different indexes with identical names stay separate.
    const code = text(material.code) || (codes?.size === 1 ? [...codes.values()][0] : '');
    const key = JSON.stringify([normalize(code), nameKey(material.name), unitKey(material.unit)]);
    const row = rows.get(key) ?? { code, name: material.name, unit: material.unit, products: [], purposes: [] };
    if (!row.products.some(item => indexKey(item.index) === indexKey(product.index) && nameKey(item.name) === nameKey(product.name))) row.products.push(product);
    if (!row.purposes.includes(purpose)) row.purposes.push(purpose);
    rows.set(key, row);
  }
  return [...rows.values()];
};

export const taskReferenceUsage = (material: TaskReferenceMaterial) => {
  const mass = material.unit.toLowerCase().replace(/\./g, '') === 'kg';
  return `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 6 }).format(material.usage * (mass ? 1000 : 1))} ${mass ? 'g' : material.unit}/szt.`;
};
