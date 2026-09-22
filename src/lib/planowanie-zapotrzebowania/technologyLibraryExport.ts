export type ExportMaterial = {
  code: string;
  name: string;
  category: string;
  usage: number;
  unit: string;
  logisticQty: number;
};

export type ExportLinkedProduct = {
  productIndex: string;
  productName: string;
  usage: number;
  unit: string;
  sourcePolicy?: 'select' | 'warehouse' | 'production';
};

export type ExportTechnology = {
  id: string;
  productIndex: string;
  productName: string;
  variant: 'base' | 'alternative';
  alternativeNo: number;
  description: string;
  notes: string;
  productionMode?: 'planned' | 'continuous' | 'linked';
  shiftNorm: number;
  materials: readonly ExportMaterial[];
  linkedProducts?: readonly ExportLinkedProduct[];
  surplusMaterials?: readonly ExportMaterial[];
  emergencyMaterials?: readonly ExportMaterial[];
  archived: boolean;
};

type Source = 'warehouse' | 'production' | 'select';
type Component = {
  code: string;
  name: string;
  category: string;
  usage: number;
  unit: string;
  logisticQty: number | null;
  section: string;
  basis: string;
  source: Source;
  requiresTechnology: boolean;
};

export type TechnologyExportEntry = {
  number: number;
  technology: ExportTechnology;
  label: string;
};

export type TechnologyExportRow = {
  root: TechnologyExportEntry;
  parent: TechnologyExportEntry;
  depth: number;
  path: string;
  stage: string;
  code: string;
  name: string;
  category: string;
  section: string;
  basis: string;
  source: string;
  usage: number | null;
  unit: string;
  logisticQty: number | null;
  target?: TechnologyExportEntry;
  note: string;
  warning: boolean;
};

export type TechnologyExportIssue = {
  technology: TechnologyExportEntry;
  componentCode: string;
  componentName: string;
  message: string;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase('pl-PL')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('ł', 'l');
const indexKey = (value: string) => {
  const key = normalize(value);
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
};
// The planning module also treats M-10-prefixed indices as aliases of product indices.
const canonicalIndex = (value: string) => indexKey(normalize(value).replace(/^m\s*-\s*10\s*-\s*/, ''));
const sourceLabels: Record<Source, string> = {
  warehouse: 'Z magazynu',
  production: 'Bezpośrednio z maszyny',
  select: 'Wybór w planie: magazyn / maszyna + zabezpieczenie'
};

export const exportTechnologyLabel = (technology: ExportTechnology) => technology.variant === 'base'
  ? 'Bazowa'
  : [`Awaryjna ${technology.alternativeNo}`, technology.description.trim()].filter(Boolean).join(' · ');

export const exportProductionMode = (technology: ExportTechnology) => ({
  planned: 'Według planu', continuous: 'Ciągła', linked: 'Pod powiązaną produkcję'
}[technology.productionMode ?? 'planned']);

const componentsFor = (technology: ExportTechnology): Component[] => {
  const materialRows = (materials: readonly ExportMaterial[], section: string, basis: string) => materials.map((m) => ({
    code: m.code, name: m.name, usage: m.usage, unit: m.unit, category: m.category,
    logisticQty: m.logisticQty, section, basis, source: 'warehouse' as const,
    requiresTechnology: normalize(m.category) === 'polwyrob'
  }));
  return [
    ...materialRows(technology.materials, 'Materiały', 'Na 1 szt. produktu rodzica'),
    ...(technology.linkedProducts ?? []).map((link) => ({
      code: link.productIndex, name: link.productName, usage: link.usage, unit: link.unit,
      category: 'Półwyrób', logisticQty: null, section: 'Powiązany półwyrób',
      basis: 'Na 1 szt. produktu rodzica', source: link.sourcePolicy ?? 'select', requiresTechnology: true
    })),
    ...materialRows(technology.surplusMaterials ?? [], 'Pakowanie nadwyżki', 'Tylko na 1 szt. wydawaną na magazyn'),
    ...materialRows(technology.emergencyMaterials ?? [], 'Starszy zapis pakowania awaryjnego', 'Zamiast pakowania podstawowego, nie łącznie')
  ];
};

const displayQuantity = (usage: number, unit: string) => {
  const key = normalize(unit).replace(/[.\s]/g, '');
  const scale = ['kg', 'kilogram', 'kilogramy', 'kilograma', '1000szt', '1000sztuk', 'tysszt', 'tyssztuk'].includes(key) ? 1000 : 1;
  const displayUnit = ['kg', 'kilogram', 'kilogramy', 'kilograma', 'g', 'gram', 'gramy', 'grama'].includes(key)
    ? 'g' : ['1000szt', '1000sztuk', 'tysszt', 'tyssztuk'].includes(key) ? 'szt.' : unit;
  return { usage: Number.isFinite(usage) && usage >= 0 ? usage * scale : null, unit: displayUnit };
};

/** A recipe reference, not an issue document: warehouse boundaries must not be flattened into current demand. */
export const buildTechnologyLibraryExport = (technologies: readonly ExportTechnology[]) => {
  const entries: TechnologyExportEntry[] = [...technologies]
    .sort((a, b) => a.productName.localeCompare(b.productName, 'pl')
      || a.productIndex.localeCompare(b.productIndex, 'pl') || Number(a.archived) - Number(b.archived)
      || Number(a.variant !== 'base') - Number(b.variant !== 'base') || a.alternativeNo - b.alternativeNo
      || a.id.localeCompare(b.id))
    .map((technology, index) => ({ number: index + 1, technology, label: exportTechnologyLabel(technology) }));
  const byIndex = new Map<string, TechnologyExportEntry[]>();
  const byAlias = new Map<string, TechnologyExportEntry[]>();
  const byName = new Map<string, TechnologyExportEntry[]>();
  const add = (map: Map<string, TechnologyExportEntry[]>, key: string, entry: TechnologyExportEntry) => {
    if (key) map.set(key, [...(map.get(key) ?? []), entry]);
  };
  for (const entry of entries) {
    add(byIndex, indexKey(entry.technology.productIndex), entry);
    add(byAlias, canonicalIndex(entry.technology.productIndex), entry);
    add(byName, normalize(entry.technology.productName), entry);
  }
  const issues: TechnologyExportIssue[] = [];
  const issueKeys = new Set<string>();
  const report = (entry: TechnologyExportEntry, component: Pick<Component, 'code' | 'name'>, message: string) => {
    const key = JSON.stringify([entry.number, component.code, component.name, message]);
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push({ technology: entry, componentCode: component.code, componentName: component.name, message });
    }
  };
  const resolve = (component: Component) => {
    const exact = byIndex.get(indexKey(component.code));
    const candidates = component.code.trim()
      ? exact ?? byAlias.get(canonicalIndex(component.code)) ?? []
      : byName.get(normalize(component.name)) ?? [];
    if (!candidates.length) return {
      note: component.requiresTechnology ? 'Brak technologii półwyrobu w bibliotece. Skład nie został rozwinięty.' : '',
      warning: component.requiresTechnology, target: undefined
    };
    const productKeys = new Set(candidates.map((entry) => canonicalIndex(entry.technology.productIndex)
      || `name:${normalize(entry.technology.productName)}`));
    const active = candidates.filter((entry) => !entry.technology.archived);
    const bases = active.filter((entry) => entry.technology.variant === 'base');
    if (productKeys.size > 1 || bases.length > 1) return {
      note: 'Niejednoznaczne powiązanie: kilka produktów lub technologii bazowych. Skład nie został rozwinięty.',
      warning: true, target: undefined
    };
    if (bases.length === 0) return {
      note: active.length ? 'Brak aktywnej technologii bazowej. Warianty awaryjne są osobno w arkuszu Technologie.'
        : 'Tylko technologie archiwalne. Skład nie został rozwinięty.',
      warning: true, target: undefined
    };
    const notes = ['Podgląd aktywnej technologii bazowej półwyrobu.'];
    if (!component.code.trim()) notes.push('Powiązanie po dokładnej nazwie (brak indeksu składnika).');
    else if (!exact) notes.push('Powiązanie po indeksie z pominięciem prefiksu M-10.');
    if (active.length > 1) notes.push(`Dostępne warianty: ${active.length}. Awaryjnych nie sumuje się z bazową.`);
    return { target: bases[0], note: notes.join(' '), warning: false };
  };
  const direct: TechnologyExportRow[] = [];
  const directByEntry = new Map<number, TechnologyExportRow[]>();
  for (const entry of entries) {
    const rows = componentsFor(entry.technology).map((component, index) => {
      const resolution = resolve(component);
      const quantity = displayQuantity(component.usage, component.unit);
      const warnings = [
        resolution.warning ? resolution.note : '',
        quantity.usage === null ? 'Nieprawidłowy przelicznik zużycia.' : '',
        component.usage === 0 ? 'Zerowe zużycie. Sprawdź, czy przelicznik został uzupełniony.' : '',
        !component.unit.trim() ? 'Brak jednostki przelicznika.' : '',
        !component.code.trim() && !component.name.trim() ? 'Brak indeksu i nazwy składnika.' : '',
        component.source === 'select' ? 'Źródło ustalane w planie. Biblioteka nie określa, czy półwyrób jest z magazynu czy z maszyny.' : ''
      ].filter(Boolean);
      warnings.forEach((message) => report(entry, component, message));
      return {
        root: entry, parent: entry, depth: 1, path: `1.${index + 1}`, stage: 'Bieżący etap wyrobu',
        code: component.code, name: component.name, category: component.category,
        section: component.section, basis: component.basis, source: sourceLabels[component.source],
        ...quantity, logisticQty: component.logisticQty, target: resolution.target,
        note: [...new Set([resolution.note, ...warnings].filter(Boolean))].join(' '), warning: warnings.length > 0
      };
    });
    if (!rows.length) report(entry, { code: '', name: '' }, 'Technologia nie ma żadnych składników.');
    direct.push(...rows);
    directByEntry.set(entry.number, rows);
  }
  const tree: TechnologyExportRow[] = [];
  const push = (row: TechnologyExportRow) => {
    if (tree.length >= 50000) throw new Error('Drzewo przekracza 50 000 wierszy. Sprawdź rozbudowane powiązania w bibliotece.');
    tree.push(row);
  };
  const visit = (root: TechnologyExportEntry, entry: TechnologyExportEntry, path: string, ancestors: number[], warehouseSteps: number, undecided: boolean) => {
    for (const [index, row] of (directByEntry.get(entry.number) ?? []).entries()) {
      const current: TechnologyExportRow = {
        ...row, root, path: `${path}.${index + 1}`, depth: ancestors.length,
        stage: warehouseSteps > 0 ? `Wcześniejsza produkcja. Etapy magazynowe: ${warehouseSteps}${undecided ? '. Źródło części powiązań do wyboru' : ''}`
          : undecided ? 'Etap zależny od wyboru źródła w planie' : ancestors.length > 1 ? 'Produkcja bezpośrednio powiązana' : 'Bieżący etap wyrobu'
      };
      if (row.target && (ancestors.includes(row.target.number) || ancestors.length >= 32)) {
        const message = ancestors.includes(row.target.number)
          ? 'Pętla w powiązaniach. Zatrzymano rozwijanie tej gałęzi.'
          : 'Osiągnięto limit 32 poziomów. Dalszy skład w arkuszu Skład technologii.';
        current.note = `${current.note} ${message}`.trim();
        current.warning = true;
        report(entry, row, message);
        push(current);
        continue;
      }
      push(current);
      if (row.target) visit(root, row.target, current.path, [...ancestors, row.target.number],
        warehouseSteps + Number(row.source === sourceLabels.warehouse), undecided || row.source === sourceLabels.select);
    }
  };
  for (const entry of entries) {
    push({
      root: entry, parent: entry, depth: 0, path: '1', stage: 'Bieżący etap wyrobu',
      code: entry.technology.productIndex, name: entry.technology.productName, category: 'Produkt główny',
      section: 'Produkt główny', basis: 'Produkt główny', source: '', usage: 1, unit: 'szt.', logisticQty: null,
      target: entry, note: entry.technology.archived ? 'Wariant archiwalny. Rozwinięcia półwyrobów według obecnej biblioteki.' : '', warning: false
    });
    visit(entry, entry, '1', [entry.number], 0, false);
  }
  return { entries, direct, tree, issues };
};
