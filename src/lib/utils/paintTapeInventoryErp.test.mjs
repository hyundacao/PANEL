import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ReactDOM = require('react-dom/server');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = new Map();
const compilerOptions = {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
};
const load = (path) => {
  const file = /\.tsx?$/.test(path) ? path : `${path}.ts`;
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file);
  cache.set(file, mod);
  mod.require = (name) => name.startsWith('@/') ? load(resolve(root, name.slice(2)))
    : name.startsWith('.') ? load(resolve(dirname(file), name)) : require(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions }).outputText, file);
  return mod.exports;
};
const { buildPaintTapeInventoryErpLookup, findPaintTapeInventoryErpSnapshot } =
  load(resolve(root, 'lib/utils/paintTapeInventoryErp.ts'));
const { PAINT_TAPE_INVENTORY_SEED } = load(resolve(root, 'lib/data/paintTapeInventorySeed.ts'));
const foil = { id: 'foil', ...PAINT_TAPE_INVENTORY_SEED.find((item) => item.itemIndex === '10060') };
const erp = {
  name: 'FOLIA EXTERIOR GLC73725_05-20MMX305M',
  indexCode: 'M-51-FO-PCP-10060', warehouseCode: 'M-51',
  unit: 'ro', realQty: 28.549, availableQty: 28.549
};
const match = (entries, item = foil) => findPaintTapeInventoryErpSnapshot(
  buildPaintTapeInventoryErpLookup(entries), item
);

test('paint inventory links the September 24 seed index to the full ERP foil code', () => {
  const result = match([erp]);
  assert.equal(result?.realQty, 28.549);
  assert.equal(result?.unit, 'ro');
});

test('paint inventory keeps full index and secondary item code matching', () => {
  assert.equal(match([erp], { ...foil, itemIndex: erp.indexCode, name: 'Old name' })?.realQty, 28.549);
  assert.equal(match([erp], { ...foil, itemIndex: 'OLD', itemCode: '10060', name: 'Old name' })?.realQty, 28.549);
});

test('paint inventory normalizes name spacing around hyphens as a fallback', () => {
  assert.equal(match([erp], { ...foil, itemIndex: 'OLD', itemCode: null })?.realQty, 28.549);
});

test('paint inventory recognizes an explicit secondary ERP index', () => {
  assert.equal(match([{ ...erp, indexCode: 'M-51-FO-PCP-OTHER', indexCode2: '10060' }])?.realQty, 28.549);
});

test('a warehouse code cannot identify a different paint inventory material', () => {
  assert.equal(match([erp], { itemIndex: 'M-51', itemCode: null, name: 'OTHER MATERIAL' }), undefined);
});

test('ambiguous short indexes fall back to the name instead of the first ERP row', () => {
  const other = { ...erp, name: 'OTHER FOIL', indexCode: 'M-52-FO-PCP-10060', realQty: 50 };
  const lookup = buildPaintTapeInventoryErpLookup([erp, other]);
  assert.equal(findPaintTapeInventoryErpSnapshot(lookup, { ...foil, name: 'UNKNOWN' }), undefined);
  assert.equal(findPaintTapeInventoryErpSnapshot(lookup, foil)?.realQty, 28.549);
  assert.equal(findPaintTapeInventoryErpSnapshot(lookup, { ...foil, name: 'OTHER FOIL' })?.realQty, 50);
  assert.equal(findPaintTapeInventoryErpSnapshot(lookup, { ...foil, itemIndex: erp.indexCode })?.realQty, 28.549);
});

test('paint inventory keeps summing ERP rows for the same normalized material', () => {
  const rows = [
    { ...erp, realQty: 10, availableQty: 5 },
    { ...erp, name: foil.name, indexCode: 'M-52-FO-PCP-10060', realQty: 18.549, availableQty: 20 }
  ];
  const result = match(rows);
  assert.ok(Math.abs(result.realQty - 28.549) < 0.000001);
  assert.equal(result.availableQty, 25);
  assert.equal(rows[0].realQty, 10);
});

const pageFile = resolve(root, 'app/(main)/rozliczanie-farb-rozcienczalnikow/PaintTapeInventoryPanel.tsx');
const page = readFileSync(pageFile, 'utf8');
const ast = ts.createSourceFile(pageFile, page, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declarations = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    declarations.set(node.name.text, node.getText(ast));
  }
  ts.forEachChild(node, visit);
};
visit(ast);
const rowCode = ['normalizeSearch', 'normalizeUnit', 'formatQuantity', 'renderInventoryRow']
  .map((name) => `const ${declarations.get(name)};`).join('\n');
const compiledRow = ts.transpileModule(`${rowCode}\nexports.renderRow = renderInventoryRow;`, { compilerOptions }).outputText;
const ui = {
  ...require('lucide-react'),
  ...load(resolve(root, 'components/ui/Badge.tsx')),
  ...load(resolve(root, 'lib/utils/cn.ts'))
};
const renderRow = (snapshots, qty = 17.2, archiveRow = null) => {
  const context = {
    ...ui, exports: {}, require,
    findPaintTapeInventoryErpSnapshot,
    erpSnapshotLookup: buildPaintTapeInventoryErpLookup(snapshots),
    archivedComparisonByItem: archiveRow ? new Map([[foil.id, archiveRow]]) : null,
    isComparisonFrozen: Boolean(archiveRow),
    erpSnapshotQuery: { isLoading: false },
    entriesByItem: new Map([[foil.id, [{ qty }]]]),
    selectedDate: '2026-09-24', drafts: {}, saveMutation: { isPending: false },
    expandedItems: new Set(), highlightedItemId: null,
    showErpComparison: true, locked: true, categoryLabels: { FOLIE: 'Folia' },
    setExpandedItems() {}
  };
  vm.runInNewContext(compiledRow, context);
  return ReactDOM.renderToStaticMarkup(context.exports.renderRow(foil));
};

test('the real history row shows the correct ERP and discrepancy for September 24', () => {
  const html = renderRow([erp]);
  assert.match(html, /17,2 ro/);
  assert.match(html, /28,549 ro/);
  assert.match(html, /Do rozpisania: 11,349 ro/);
  assert.doesNotMatch(html, /Brak danych|Mamy wi\u0119cej/);
});

test('missing ERP data does not become a false surplus in the history row', () => {
  const html = renderRow([]);
  assert.match(html, /Brak danych/);
  assert.match(html, /Brak stanu ERP/);
  assert.doesNotMatch(html, /Mamy wi\u0119cej|Do rozpisania/);
});

test('a real zero ERP stock still produces the actual surplus', () => {
  const html = renderRow([{ ...erp, realQty: 0, availableQty: 0 }]);
  assert.match(html, /Mamy wi\u0119cej fizycznie: \+17,2 ro/);
  assert.doesNotMatch(html, /Brak stanu ERP/);
});

test('incompatible units do not produce a misleading discrepancy', () => {
  const html = renderRow([{ ...erp, unit: 'kg' }]);
  assert.match(html, /Niezgodna jednostka/);
  assert.doesNotMatch(html, /Mamy wi\u0119cej|Do rozpisania/);
});

test('equal recorded inventory and ERP stock still show a matching state', () => {
  assert.match(renderRow([erp], 28.549), /Stan zgodny/);
});

test('archived history row still shows physical and ERP quantities after live ERP deletion', () => {
  const html = renderRow([], 999, { physicalQty: 17.2, erp: { realQty: 28.549, availableQty: 25, unit: 'ro' } });
  assert.match(html, /17,2 ro/);
  assert.match(html, /28,549 ro/);
  assert.match(html, /Do rozpisania: 11,349 ro/);
  assert.doesNotMatch(html, /999 ro|Brak danych/);
});

test('archived ERP does not change when newer live values are returned', () => {
  const html = renderRow([{ ...erp, realQty: 999 }], 17.2,
    { physicalQty: 17.2, erp: { realQty: 28.549, availableQty: 25, unit: 'ro' } });
  assert.match(html, /28,549 ro/);
  assert.doesNotMatch(html, /999 ro/);
});

test('archive explicitly remembers missing ERP instead of silently using a later import', () => {
  const html = renderRow([erp], 17.2, { physicalQty: 17.2, erp: null });
  assert.match(html, /Brak stanu ERP/);
  assert.doesNotMatch(html, /28,549 ro|Do rozpisania/);
});

const settlementFile = resolve(root, 'app/(main)/rozliczanie-farb-rozcienczalnikow/page.tsx');
const settlementSource = ts.createSourceFile(settlementFile, readFileSync(settlementFile, 'utf8'),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const settlementDeclarations = new Map();
const collectSettlementDeclarations = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    settlementDeclarations.set(node.name.text, node.getText(settlementSource));
  }
  ts.forEachChild(node, collectSettlementDeclarations);
};
collectSettlementDeclarations(settlementSource);
const settlementCode = ['getWarsawDateValue', 'normalizeKey', 'getErpSnapshotForSettlement', 'completedSnapshotDates']
  .map((name) => `const ${settlementDeclarations.get(name)};`).join('\n');
const settlementCompiled = ts.transpileModule(`${settlementCode}
exports.get = getErpSnapshotForSettlement; exports.dates = completedSnapshotDates;`, { compilerOptions }).outputText;
const settlementContext = (settlements) => {
  const context = { exports: {}, filteredSettlements: settlements, useMemo: (fn) => fn(),
    completedSnapshotStates: new Map(), snapshotMap: new Map(), snapshotDate: '2026-10-14' };
  vm.runInNewContext(settlementCompiled, context);
  return context.exports;
};

test('settlement history uses its frozen ERP with no live stock request or loading state', () => {
  const settlement = { productionCompletedAt: '2025-01-01T12:00:00Z',
    erpArchive: { date: '2025-01-01', entry: { ...erp, realQty: 28.549 } } };
  const result = settlementContext([settlement]);
  assert.equal(result.dates.length, 0);
  const info = result.get(settlement);
  assert.equal(info.entry.realQty, 28.549);
  assert.equal(info.loading, false);
  assert.equal(info.historical, true);
  assert.equal(info.date, '2025-01-01');
});

test('settlement history freezes an explicit missing ERP and only fetches legacy unarchived dates', () => {
  const archived = { productionCompletedAt: '2025-01-01T12:00:00Z',
    erpArchive: { date: '2025-01-01', entry: null } };
  const legacy = { productionCompletedAt: '2026-10-01T12:00:00Z' };
  const result = settlementContext([archived, legacy, legacy]);
  assert.equal(JSON.stringify(result.dates), '["2026-10-01"]');
  assert.equal(result.get(archived).entry, null);
  assert.equal(result.get(archived).loading, false);
});
