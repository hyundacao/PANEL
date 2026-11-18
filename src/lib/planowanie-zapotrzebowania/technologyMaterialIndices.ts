export type TechnologyIndexPair = {
  indexCode: string;
  indexCode2?: string | null;
  name: string;
  previousNames?: readonly string[];
};

export type TechnologyIndexSource = {
  rows: readonly { index_code?: string | null; index_code2?: string | null; name: string }[];
  register?: { items: readonly TechnologyIndexPair[]; blocked: readonly TechnologyIndexPair[] } | null;
};

type Material = { id: string; code: string; name: string };
type LinkedProduct = { id: string; productIndex: string; productName: string; sourceKeys?: string[] };
type Technology = {
  id: string;
  productIndex: string;
  productName: string;
  materials: Material[];
  surplusMaterials?: Material[];
  emergencyMaterials?: Material[];
  linkedProducts?: LinkedProduct[];
};
type Status = 'changed' | 'already-index2' | 'without-index' | 'missing-index2' | 'unmatched' | 'ambiguous' | 'blocked';
type Field = 'materials' | 'surplusMaterials' | 'emergencyMaterials' | 'linkedProducts';
export type TechnologyIndexFinding = {
  technologyId: string;
  productIndex: string;
  productName: string;
  field: Field;
  position: number;
  componentId: string;
  name: string;
  from: string;
  to: string;
  status: Status;
  candidates: Array<{ index1: string; index2: string; name: string }>;
};

const indexKey = (value: unknown) => String(value ?? '').trim().replace(/\s*([-\/])\s*/g, '$1').toUpperCase();
const nameKey = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const codes = (pair: TechnologyIndexPair) => [...new Set([indexKey(pair.indexCode), indexKey(pair.indexCode2)].filter(Boolean))];

export const buildTechnologyIndexCatalog = (source: TechnologyIndexSource) => {
  const active = [...source.register?.items ?? []];
  const blocked = [...source.register?.blocked ?? []];
  const registeredCodes = new Set([...active, ...blocked].flatMap(codes));
  // The imported two-column register is authoritative; raw aliases cannot invent a second pair.
  for (const row of source.rows) {
    if (!indexKey(row.index_code) || registeredCodes.has(indexKey(row.index_code))) continue;
    active.push({ indexCode: row.index_code!, indexCode2: row.index_code2, name: row.name });
  }
  return { active, blocked };
};

export const normalizeTechnologyMaterialIndices = <T extends Technology>(
  technologies: readonly T[], catalog: ReturnType<typeof buildTechnologyIndexCatalog>
) => {
  const byCode = new Map<string, TechnologyIndexPair[]>();
  const byTarget = new Map<string, TechnologyIndexPair[]>();
  for (const pair of catalog.active) {
    for (const code of codes(pair)) byCode.set(code, [...byCode.get(code) ?? [], pair]);
    const target = indexKey(pair.indexCode2);
    if (target) byTarget.set(target, [...byTarget.get(target) ?? [], pair]);
  }
  const blockedCodes = new Set(catalog.blocked.flatMap(codes));
  const findings: TechnologyIndexFinding[] = [];
  const changedTechnologyIds = new Set<string>();
  const resolve = (code: string, name: string) => {
    const key = indexKey(code);
    if (!key) return { status: 'without-index' as Status, to: code, candidates: [] };
    let matches = byCode.get(key) ?? [];
    const named = matches.filter(pair => [pair.name, ...pair.previousNames ?? []].some(value => nameKey(value) === nameKey(name)));
    if (named.length) matches = named;
    const candidates = matches.map(pair => ({ index1: pair.indexCode, index2: pair.indexCode2 ?? '', name: pair.name }));
    if (!matches.length) return { status: (blockedCodes.has(key) ? 'blocked' : 'unmatched') as Status, to: code, candidates };
    const primaries = new Set(matches.map(pair => indexKey(pair.indexCode)));
    const targets = new Set(matches.map(pair => indexKey(pair.indexCode2)));
    if (primaries.size !== 1 || targets.size !== 1) return { status: 'ambiguous' as Status, to: code, candidates };
    const target = [...targets][0];
    if (!target) return { status: 'missing-index2' as Status, to: code, candidates };
    // A shared target code would merge different materials in demand grouping (code + unit).
    const targetMatches = [...new Set([...(byTarget.get(target) ?? []), ...(byCode.get(target) ?? [])])];
    const targetOwners = new Set(targetMatches.map(pair => indexKey(pair.indexCode)));
    if (targetOwners.size !== 1) return { status: 'ambiguous' as Status, to: code,
      candidates: targetMatches.map(pair => ({ index1: pair.indexCode, index2: pair.indexCode2 ?? '', name: pair.name })) };
    if (key === target) return { status: 'already-index2' as Status, to: code, candidates };
    return { status: 'changed' as Status, to: matches[0].indexCode2!.trim(), candidates };
  };
  const seenIds = new Set<string>();
  const normalized = technologies.map(technology => {
    if (!technology.id || seenIds.has(technology.id)) throw new Error('TECHNOLOGY_ID_INVALID');
    seenIds.add(technology.id);
    let next = technology;
    for (const field of ['materials', 'surplusMaterials', 'emergencyMaterials', 'linkedProducts'] as const) {
      const entries = technology[field];
      if (entries === undefined) continue;
      if (!Array.isArray(entries)) throw new Error('TECHNOLOGY_COMPONENTS_INVALID');
      let changed = false;
      const values = entries.map((entry, position) => {
        if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') throw new Error('TECHNOLOGY_COMPONENT_INVALID');
        const linked = field === 'linkedProducts';
        const code = linked ? (entry as LinkedProduct).productIndex : (entry as Material).code;
        const name = linked ? (entry as LinkedProduct).productName : (entry as Material).name;
        if (typeof code !== 'string' || typeof name !== 'string') throw new Error('TECHNOLOGY_COMPONENT_IDENTITY_INVALID');
        const result = resolve(code, name);
        findings.push({ technologyId: technology.id, productIndex: technology.productIndex, productName: technology.productName,
          field, position, componentId: entry.id, name, from: code, ...result });
        if (result.status !== 'changed') return entry;
        changed = true;
        changedTechnologyIds.add(technology.id);
        if (!linked) return { ...entry, code: result.to };
        const link = entry as LinkedProduct;
        // Match linkedProductKey in the planning screen so old machine/warehouse selections survive.
        const oldKey = code.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replaceAll('\u0142', 'l').trim().replace(/^m\s*-\s*10\s*-\s*/, '');
        return { ...link, productIndex: result.to, sourceKeys: [...new Set([...link.sourceKeys ?? [], oldKey])].filter(Boolean) };
      });
      if (changed) next = { ...next, [field]: values };
    }
    return next;
  });
  const counts = Object.fromEntries((['changed', 'already-index2', 'without-index', 'missing-index2', 'unmatched', 'ambiguous', 'blocked'] as const)
    .map(status => [status, findings.filter(finding => finding.status === status).length])) as Record<Status, number>;
  return { technologies: normalized, findings, counts, changedTechnologyIds: [...changedTechnologyIds] };
};
