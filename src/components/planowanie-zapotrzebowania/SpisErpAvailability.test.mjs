import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { applyPieceGrindingReservations } from '../../lib/utils/originalInventoryGrinding.ts';
import { searchOriginalInventorySpisSuggestions } from '../../lib/utils/originalInventorySpisSearch.ts';
import { normalizeOriginalInventoryIndex } from '../../lib/utils/originalInventoryIndex.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const load = (file) => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(readFileSync(file, 'utf8')), {
    module: mod, exports: mod.exports,
    require: (name) => name.startsWith('@/')
      ? load(path.join(root, 'src', `${name.slice(2)}.ts`))
      : require(name)
  });
  return mod.exports;
};
const { SpisErpAvailability } = load(path.join(directory, 'SpisErpAvailability.tsx'));
const { matchOriginalInventoryErpStock, findOriginalInventoryCatalogMaterial, buildOriginalInventoryNameResolver } = load(path.join(root, 'src/lib/utils/originalInventoryErpMatch.ts'));
const source = readFileSync(path.join(directory, 'SpisRzeczywisty.tsx'), 'utf8');
const ast = ts.createSourceFile('SpisRzeczywisty.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const queryNodes = new Map();
let availabilityNode;
const visit = (node) => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useQuery') {
    const options = node.arguments[0];
    const key = options.properties.find((property) => property.name?.getText(ast) === 'queryKey');
    if (key && ts.isArrayLiteralExpression(key.initializer)) {
      queryNodes.set(key.initializer.elements[0].text, options.getText(ast));
    }
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'SpisErpAvailability') availabilityNode = node.getText(ast);
  ts.forEachChild(node, visit);
};
visit(ast);

const initializer = (name) => {
  let result;
  const find = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  };
  find(ast);
  assert.ok(result, name);
  return result;
};
const normalizeCatalogNameKey = (value) => value.trim().toLowerCase();
const grateName = 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO';
const grateStock = (extra = {}) => ({
  name: `${grateName} SYSTEM 1000X63X98X148`, indexCode: '1598-7',
  unit: 'szt.', realQty: 740, availableQty: 740, ...extra
});

test('actual Spis suggestions prefer the selected day ERP index while retaining both IRIS catalog choices', () => {
  for (const activeCode of ['A22154704', 'A22154703', null]) {
    const mod = { exports: {} };
    vm.runInNewContext(compile(`
      const erpSuggestionIndexKeys = ${initializer('erpSuggestionIndexKeys')};
      const erpIndexKeys = erpSuggestionIndexKeys;
      const toOriginalInventoryNameSuggestion = ${initializer('toOriginalInventoryNameSuggestion')};
      module.exports = ${initializer('suggestions')};
    `), {
      module: mod, useMemo: calculate => calculate(), normalizeOriginalInventoryIndex,
      searchOriginalInventorySpisSuggestions,
      getOriginalInventorySpisIndex2: (index, explicit) => explicit || index || '',
      erpSnapshotEntries: activeCode ? [{ indexCode: activeCode }] : [],
      existingSuggestions: [{ name: 'IRIS LR WHEEL', unit: 'szt.', indexCode: null }],
      remoteCatalogSuggestions: ['A22154703', 'A22154704'].map(indexCode => ({
        id: indexCode, name: 'IRIS LR WHEEL', unit: 'szt.', indexCode
      })),
      inventoriedNames: ['IRIS LR WHEEL'],
      query: 'iris', normalizedQuery: 'iris', normalizedDebouncedQuery: 'iris'
    });
    assert.equal(mod.exports.length, 2);
    assert.equal(mod.exports[0].indexCode, activeCode || 'A22154703');
    assert.equal(mod.exports[0].catalogId, activeCode || 'A22154703');
    assert.equal(mod.exports.filter(item => item.inErp).length, activeCode ? 1 : 0);
  }
});

test('ERP priority keeps meaningful index characters and normalizes PDF separator spaces', () => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(`const erpIndexKeys = new Set(['M-1-KAR-001-00']);
    const toOriginalInventoryNameSuggestion = ${initializer('toOriginalInventoryNameSuggestion')};
    module.exports = ${initializer('suggestions')};`), {
    module: mod, useMemo: calculate => calculate(), normalizeOriginalInventoryIndex,
    searchOriginalInventorySpisSuggestions,
    getOriginalInventorySpisIndex2: index => index || '',
    existingSuggestions: [], inventoriedNames: [],
    remoteCatalogSuggestions: ['M-1-KAR-001-01', 'M-1-KAR- 001 - 00'].map(indexCode => ({
      name: 'KARTON', unit: 'szt.', indexCode
    })),
    query: 'karton', normalizedQuery: 'karton', normalizedDebouncedQuery: 'karton'
  });
  assert.equal(mod.exports.length, 2);
  assert.equal(mod.exports[0].indexCode, 'M-1-KAR- 001 - 00');
  assert.equal(mod.exports[0].inErp, true);
  assert.equal(mod.exports[1].inErp, false);
});

test('Spis uses the selected exact index when the PDF contains a longer name', () => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(`const selectedErpIndex = ${initializer('selectedErpIndex')}; module.exports = ${initializer('matchedErpSnapshot')};`), {
    module: mod, useMemo: (calculate) => calculate(), matchOriginalInventoryErpStock,
    normalizeCatalogNameKey, form: { name: grateName, unit: 'szt.' },
    selectedErpMaterial: { name: grateName, indexCode: '1598-7' },
    resolvedErpMaterial: undefined,
    effectiveErpSnapshotEntries: [grateStock(), grateStock({ indexCode: '1700', availableQty: 999 })]
  });
  assert.equal(mod.exports.availableQty, 740);
  assert.match(render({ name: grateName, snapshot: mod.exports }), /740 szt\./);
});

test('known different indices never fall back to the same or similar name', () => {
  const material = { name: grateName, unit: 'szt.', indexCode: '1598-7' };
  assert.equal(matchOriginalInventoryErpStock([
    grateStock({ name: grateName, indexCode: '1598-70' }),
    grateStock({ name: grateName, indexCode: '1700' })
  ], material, normalizeCatalogNameKey), null);
});

test('Spis matches catalog indices to existing ERP imports with PDF spacing around separators', () => {
  const name = 'PRZEKŁADKA 380X400';
  const indexCode = 'M-1-KAR-BSHŁ-10081';
  for (const importedIndex of ['M-1-KAR-BSHŁ- 10081', ' m - 1 - kar - bshł - 10081 ', 'M-1-KAR-BSHŁ-\n10081', 'M-1-KAR-BSHŁ-\u00a010081', 'M1-KAR-BSHŁ-10081']) {
    const stock = { name, unit: 'szt.', indexCode: importedIndex, realQty: 1713.6, availableQty: 1713.6 };
    const mod = { exports: {} };
    vm.runInNewContext(compile(`const selectedErpIndex = ${initializer('selectedErpIndex')}; module.exports = ${initializer('matchedErpSnapshot')};`), {
      module: mod, useMemo: calculate => calculate(), matchOriginalInventoryErpStock,
      normalizeCatalogNameKey, form: { name, unit: 'szt.' },
      selectedErpMaterial: { name, indexCode }, resolvedErpMaterial: undefined,
      effectiveErpSnapshotEntries: [stock, { ...stock, indexCode: 'M-4-KAR-BSHŁ-10081', availableQty: 9000 }]
    });
    assert.equal(mod.exports?.availableQty, 1713.6, importedIndex);
    assert.match(render({ name, snapshot: mod.exports }), /1[\s\u00a0]?713,6 szt\./);
    assert.equal(stock.indexCode, importedIndex, 'lookup must not rewrite saved data');
  }
});

test('spacing normalization never merges different warehouses, suffixes, index segments or meaningful spaces', () => {
  const name = 'PRZEKŁADKA 380X400';
  const material = { name, unit: 'szt.', indexCode: 'M-1-KAR-BSHŁ-10081' };
  for (const indexCode of ['M-4-KAR-BSHŁ- 10081', 'M-1-KAR-BSHŁ- 100810', 'M-1-KAR-BSHŁ- 10081-01', 'M-1-KAR-BSHL- 10081', '10081']) {
    const stock = { ...material, indexCode, realQty: 5, availableQty: 5 };
    assert.equal(matchOriginalInventoryErpStock([stock], material, normalizeCatalogNameKey), null, indexCode);
  }
  assert.equal(matchOriginalInventoryErpStock([{ name, unit: 'szt.', indexCode: 'AB12', realQty: 5, availableQty: 5 }],
    { ...material, indexCode: 'AB 12' }, normalizeCatalogNameKey), null);
  const stock = { ...material, indexCode: 'M-1-KAR-BSHŁ- 10081', unit: 'kg', realQty: 5, availableQty: 5 };
  assert.equal(matchOriginalInventoryErpStock([stock], material, normalizeCatalogNameKey), null, 'unit mismatch remains blocked');
});

test('catalog identity and current-name resolution use the same separator normalization as ERP matching', () => {
  const item = { name: 'PRZEKŁADKA 380X400', unit: 'szt.', indexCode: 'M-1-KAR-BSHŁ-10081', previousNames: ['OLD NAME'] };
  const selected = { name: 'OLD NAME', unit: 'szt.', indexCode: 'M-1-KAR-BSHŁ- 10081' };
  assert.equal(findOriginalInventoryCatalogMaterial([item], selected), item);
  assert.equal(buildOriginalInventoryNameResolver([item])(selected), item.name);
  assert.equal(buildOriginalInventoryNameResolver([item])({ ...selected, indexCode: 'M-4-KAR-BSHŁ- 10081' }), 'OLD NAME');
  const duplicates = [item, { ...item, indexCode: selected.indexCode }];
  assert.equal(findOriginalInventoryCatalogMaterial(duplicates, { name: item.name, unit: item.unit }), item);
  assert.equal(findOriginalInventoryCatalogMaterial([...duplicates, { ...item, indexCode: 'M-4-KAR-BSHŁ-10081' }],
    { name: item.name, unit: item.unit }), null, 'genuinely ambiguous names must not guess an index');
});

test('unindexed ERP fallback tolerates formatting variants of one index but not different indices', () => {
  const material = { name: 'PRZEKŁADKA 380X400', unit: 'szt.' };
  const first = { ...material, indexCode: 'M-1-KAR-BSHŁ-10081', realQty: 10, availableQty: 8 };
  const second = { ...first, indexCode: 'M - 1 - KAR - BSHŁ - 10081', realQty: 20, availableQty: 17 };
  assert.equal(matchOriginalInventoryErpStock([first, second], material, normalizeCatalogNameKey)?.availableQty, 25);
  assert.equal(matchOriginalInventoryErpStock([first, { ...second, indexCode: 'M-4-KAR-BSHŁ-10081' }], material, normalizeCatalogNameKey), null);
  const slash = { ...first, indexCode: 'ABC-01 / 02' };
  assert.equal(matchOriginalInventoryErpStock([slash], { ...material, indexCode: 'ABC-01/02' }, normalizeCatalogNameKey)?.availableQty, 8);
  assert.equal(matchOriginalInventoryErpStock([slash], { ...material, indexCode: 'ABC-01/2' }, normalizeCatalogNameKey), null);
});

test('legacy names still work only when the stock identity and unit are unambiguous', () => {
  const material = { name: grateName, unit: 'szt.' };
  const legacy = grateStock({ name: grateName, indexCode: null });
  assert.equal(matchOriginalInventoryErpStock([legacy], material, normalizeCatalogNameKey).availableQty, 740);
  assert.equal(matchOriginalInventoryErpStock([legacy], { ...material, indexCode: '1598-7' }, normalizeCatalogNameKey).availableQty, 740);
  assert.equal(matchOriginalInventoryErpStock([
    grateStock({ name: grateName }), grateStock({ name: grateName, indexCode: '1700' })
  ], material, normalizeCatalogNameKey), null);
  assert.equal(matchOriginalInventoryErpStock([legacy], { ...material, unit: 'kg' }, normalizeCatalogNameKey), null);
});

test('indexed matching preserves zero, negatives and already deducted grinding reservations', () => {
  const material = { name: grateName, unit: 'szt', indexCode: '1598-7' };
  for (const availableQty of [0, -5, 700]) {
    assert.equal(matchOriginalInventoryErpStock([grateStock({ availableQty })], material, normalizeCatalogNameKey).availableQty, availableQty);
  }
  const result = matchOriginalInventoryErpStock([
    grateStock({ availableQty: 700 }), grateStock({ availableQty: 30 }),
    grateStock({ indexCode: '1700', availableQty: 900 })
  ], material, normalizeCatalogNameKey);
  assert.equal(result.availableQty, 730);
});

test('selecting a suggestion retains its full ERP index and editing the name clears it', () => {
  let selected = null;
  let aliases = [];
  const context = {
    module: { exports: {} }, selectedCatalogRef: { current: { id: '', name: '' } },
    setSelectedErpMaterial: (value) => { selected = value; },
    setSelectedCatalogId() {}, setSelectedPalletSetId() {}, setInventoryMode() {}, setForm() {},
    setSelectedCatalogAliases: value => { aliases = value; },
    qtyInputRef: { current: null }
  };
  vm.runInNewContext(compile(`module.exports = { select: ${initializer('applyNameSuggestionToForm')}, commit: ${initializer('applyNameToForm')} };`), context);
  context.module.exports.select({ name: grateName, indexCode: '1598-7', catalogId: 'catalog-grate', catalogIds: ['catalog-grate','catalog-grate-legacy'], unit: 'szt.' });
  assert.equal(selected.indexCode, '1598-7');
  assert.deepEqual(aliases,['catalog-grate','catalog-grate-legacy']);
  context.module.exports.commit(grateName);
  assert.equal(selected.indexCode, '1598-7');
  context.module.exports.commit('OTHER MATERIAL');
  assert.equal(selected, null);
  assert.equal(aliases.length,0);
});

test('linking two catalog indices keeps pallet profiles attached to either original record ID available', () => {
  const context = {
    module:{exports:{}}, selectedCatalogId:'primary',selectedCatalogAliases:['primary','secondary'],
    palletSets:[
      {id:'set-primary',primaryCatalogId:'primary',active:true},
      {id:'set-secondary',primaryCatalogId:'secondary',active:true},
      {id:'other',primaryCatalogId:'unrelated',active:true},
      {id:'inactive',primaryCatalogId:'secondary',active:false}
    ],palletSetError:()=>null
  };
  vm.runInNewContext(compile(`const selectedCatalogIds = ${initializer('selectedCatalogIds')}; module.exports = ${initializer('matchingPalletSets')};`),context);
  assert.deepEqual(Array.from(context.module.exports,item=>item.id),['set-primary','set-secondary']);
});

test('an old selected index cannot supply stock after the form name was cleared or changed', () => {
  for (const name of ['', 'OTHER MATERIAL']) {
    const mod = { exports: {} };
    vm.runInNewContext(compile(`const selectedErpIndex = ${initializer('selectedErpIndex')}; module.exports = ${initializer('matchedErpSnapshot')};`), {
      module: mod, useMemo: (calculate) => calculate(), matchOriginalInventoryErpStock,
      normalizeCatalogNameKey, form: { name, unit: 'szt.' },
      selectedErpMaterial: { name: grateName, indexCode: '1598-7' },
      resolvedErpMaterial: undefined,
      effectiveErpSnapshotEntries: [grateStock()]
    });
    assert.equal(mod.exports, null);
  }
});

test('an already counted suggestion without an index resolves the grate without adding another SYSTEM stock', () => {
  const catalog = [{ name: grateName, unit: 'szt.', indexCode: '1598-7' }];
  for (const selectedErpMaterial of [null, { name: grateName, indexCode: null }]) {
    const form = { name: grateName, unit: 'szt.' };
    const mod = { exports: {} };
    vm.runInNewContext(compile(`const selectedErpIndex = ${initializer('selectedErpIndex')}; module.exports = ${initializer('matchedErpSnapshot')};`), {
      module: mod, useMemo: (calculate) => calculate(), matchOriginalInventoryErpStock,
      normalizeCatalogNameKey, form, selectedErpMaterial,
      resolvedErpMaterial: findOriginalInventoryCatalogMaterial(catalog, form),
      effectiveErpSnapshotEntries: [grateStock(), grateStock({ name: 'SYSTEM 1000X63X98X148', indexCode: '1700', availableQty: 300 })]
    });
    assert.equal(mod.exports.availableQty, 740);
    assert.match(render({ name: grateName, snapshot: mod.exports }), /740 szt\./);
  }
});

test('catalog resolution requires an exact name or full index, compatible unit and one unambiguous identity', () => {
  const item = { name: grateName, unit: 'szt.', indexCode: '1598-7' };
  assert.equal(findOriginalInventoryCatalogMaterial([item], { name: `  ${grateName.toLowerCase()}  `, unit: 'szt' }), item);
  assert.equal(findOriginalInventoryCatalogMaterial([item, { ...item }], item), item);
  assert.equal(findOriginalInventoryCatalogMaterial([item], { name: 'KRATA STALOWA', unit: item.unit }), null);
  assert.equal(findOriginalInventoryCatalogMaterial([item], { ...item, name: 'OLD NAME' }), item);
  assert.equal(findOriginalInventoryCatalogMaterial([item], { ...item, indexCode: '1598-70' }), null);
  assert.equal(findOriginalInventoryCatalogMaterial([item], { ...item, unit: 'kg' }), null);
  assert.equal(findOriginalInventoryCatalogMaterial([item], { ...item, name: '' }), null);
  assert.equal(findOriginalInventoryCatalogMaterial([{ ...item, indexCode: null }], item), null);
  assert.equal(findOriginalInventoryCatalogMaterial([
    ...Array.from({ length: 40 }, () => item), { ...item, indexCode: '1700' }
  ], { name: item.name, unit: item.unit }), null, 'a different index after the suggestion limit must still prevent guessing');
  assert.equal(findOriginalInventoryCatalogMaterial([item, { ...item, name: 'CONFLICTING NAME' }], item), null);
});

const identityOptions = (name, unit, fetcher, selectedErpIndex = null, tab = 'spis', hasStock = true) => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(`const needsErpCatalogIdentity = ${initializer('needsErpCatalogIdentity')}; module.exports = (${queryNodes.get('spis-oryginalow-catalog-material')});`), {
    module: mod, form: { name, unit }, selectedErpIndex, activeTab: tab,
    erpSnapshotEntries: hasStock ? [grateStock()] : [], resolveOriginalInventoryCatalogMaterial: fetcher
  });
  return mod.exports;
};

test('identity requests refresh canonical names even for indexed choices and without ERP stock', async () => {
  let calls = 0;
  const fetcher = async (name, unit, signal) => {
    calls++;
    assert.equal(name, grateName);
    assert.equal(unit, 'szt.');
    assert.ok(signal instanceof AbortSignal);
    return { name, unit, indexCode: '1598-7' };
  };
  const options = identityOptions(grateName, 'szt.', fetcher);
  assert.equal(options.enabled, true);
  assert.equal(identityOptions(grateName, 'szt.', fetcher, '1598-7').enabled, true);
  assert.equal(identityOptions('', 'szt.', fetcher).enabled, false);
  assert.equal(identityOptions(grateName, 'szt.', fetcher, null, 'kartoteki').enabled, false);
  assert.equal(identityOptions(grateName, 'szt.', fetcher, null, 'spis', false).enabled, true);
  const client = new QueryClient();
  try {
    assert.equal((await client.fetchQuery(options)).indexCode, '1598-7');
    await client.fetchQuery(identityOptions(grateName, 'szt.', fetcher));
    assert.equal(calls, 1);
  } finally { client.clear(); }
});

test('changing the form name or unit cannot reuse an index resolved for the previous material', async () => {
  const client = new QueryClient();
  const first = identityOptions(grateName, 'szt.', async () => ({ indexCode: '1598-7' }));
  const observer = new QueryObserver(client, first);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(first);
    assert.equal(observer.getCurrentResult().data.indexCode, '1598-7');
    for (const [name, unit] of [['OTHER MATERIAL', 'szt.'], [grateName, 'kg']]) {
      observer.setOptions(identityOptions(name, unit, async () => null));
      assert.equal(observer.getCurrentResult().data, undefined);
      assert.equal(observer.getCurrentResult().isPending, true);
      await setImmediate();
    }
  } finally { unsubscribe(); client.clear(); }
});

const optionsFor = (key, tab = 'spis', date = '2026-09-28', fetcher = async () => []) => {
  assert.ok(queryNodes.has(key));
  const mod = { exports: {} };
  vm.runInNewContext(compile(`module.exports = (${queryNodes.get(key)});`), {
    module: mod, activeTab: tab, spisDate: date,
    getOriginalInventoryErpSnapshot: fetcher,
    getOriginalInventoryGrindTasks: fetcher,
    isErpSnapshotMigrationError: (error) => error.message === 'MIGRATION_REQUIRED'
  });
  return mod.exports;
};
const erpKey = 'spis-oryginalow-erp-snapshot';
const grindKey = 'original-inventory-grind-tasks';
const baseProps = {
  name: 'METAL BOX 1230X830X730', date: '2026-09-28', snapshot: { availableQty: 250, unit: 'szt.' },
  hasSnapshot: true, loading: false, error: false, migrationRequired: false,
  reservationsLoading: false, reservationsError: false, onRetry: () => {}
};
const render = (props = {}) => renderToStaticMarkup(React.createElement(SpisErpAvailability, { ...baseProps, ...props }));

test('a cold Spis tab loads ERP for its day and grinding reservations without visiting reports', async () => {
  let calls = 0;
  const options = optionsFor(erpKey, 'spis', '2026-09-28', async (date) => {
    assert.equal(date, '2026-09-28');
    calls++;
    return [{ name: 'METAL BOX', availableQty: 250, unit: 'szt.' }];
  });
  assert.equal(options.enabled, true);
  assert.equal(optionsFor(grindKey).enabled, true);
  const client = new QueryClient();
  try {
    const data = await client.fetchQuery(options);
    assert.equal(data.items[0].availableQty, 250);
    assert.equal(calls, 1);
  } finally { client.clear(); }
});

test('ERP is scoped by date, not search text, and unrelated tabs do not load daily stock', () => {
  const options = optionsFor(erpKey);
  assert.equal(JSON.stringify(options.queryKey), JSON.stringify([erpKey, '2026-09-28']));
  assert.equal(options.staleTime, 300_000);
  assert.equal(options.gcTime, 1_800_000);
  assert.equal(optionsFor(grindKey).staleTime, 60_000);
  assert.equal(options.refetchInterval, undefined);
  for (const tab of ['spis', 'stany-erp', 'raporty', 'alerty']) assert.equal(optionsFor(erpKey, tab).enabled, true);
  for (const tab of ['kartoteki', 'do-zmielenia']) assert.equal(optionsFor(erpKey, tab).enabled, false);
  assert.equal(optionsFor(erpKey, 'spis', '').enabled, false);
  assert.doesNotMatch(queryNodes.get(erpKey), /form\.name|debouncedQuery|normalizedQuery/);
});

test('rerenders and repeated material searches reuse the same daily request and fresh cache', async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetcher = async () => { calls++; return [{ name: 'METAL BOX', availableQty: 250 }]; };
  const options = optionsFor(erpKey, 'spis', '2026-09-28', fetcher);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    for (let index = 0; index < 50; index++) observer.setOptions(optionsFor(erpKey, 'spis', '2026-09-28', fetcher));
    await setImmediate();
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    assert.equal(observer.getCurrentResult().data.items[0].availableQty, 250);
  } finally { unsubscribe(); client.clear(); }
});

test('changing days never displays the previous day stock and returning reuses that day cache', async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetcher = async (date) => { calls++; return date === '2026-09-28' ? [{ availableQty: 250 }] : []; };
  const first = optionsFor(erpKey, 'spis', '2026-09-28', fetcher);
  const second = optionsFor(erpKey, 'spis', '2026-09-29', fetcher);
  const observer = new QueryObserver(client, first);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(first);
    observer.setOptions(second);
    assert.equal(observer.getCurrentResult().data, undefined);
    assert.equal(observer.getCurrentResult().isPending, true);
    await client.fetchQuery(second);
    assert.equal(observer.getCurrentResult().data.items.length, 0);
    observer.setOptions(first);
    assert.equal(observer.getCurrentResult().data.items[0].availableQty, 250);
    assert.equal(calls, 2);
  } finally { unsubscribe(); client.clear(); }
});

test('import and removal invalidation refresh daily stock despite its five minute cache', async () => {
  const client = new QueryClient();
  let stock = [{ availableQty: 250 }];
  let calls = 0;
  const options = optionsFor(erpKey, 'spis', '2026-09-28', async () => { calls++; return stock; });
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    stock = [{ availableQty: 340 }];
    await client.invalidateQueries({ queryKey: options.queryKey });
    assert.equal(observer.getCurrentResult().data.items[0].availableQty, 340);
    stock = [];
    await client.invalidateQueries({ queryKey: options.queryKey });
    assert.equal(observer.getCurrentResult().data.items.length, 0);
    assert.equal(calls, 3);
    assert.ok((source.match(/invalidateQueries\(\{ queryKey: \['spis-oryginalow-erp-snapshot', spisDate\]/g) ?? []).length >= 2);
  } finally { unsubscribe(); client.clear(); }
});

test('reusing stock from reports does not fetch it again when opening Spis', async () => {
  const client = new QueryClient();
  let calls = 0;
  const fetcher = async () => { calls++; return []; };
  try {
    await client.fetchQuery(optionsFor(erpKey, 'raporty', '2026-09-28', fetcher));
    await client.fetchQuery(optionsFor(erpKey, 'spis', '2026-09-28', fetcher));
    assert.equal(calls, 1);
  } finally { client.clear(); }
});

test('ERP query errors remain errors while a missing migration is reported separately', async () => {
  const failed = optionsFor(erpKey, 'spis', '2026-09-28', async () => { throw new Error('NETWORK_FAILURE'); });
  await assert.rejects(failed.queryFn, /NETWORK_FAILURE/);
  const migration = optionsFor(erpKey, 'spis', '2026-09-28', async () => { throw new Error('MIGRATION_REQUIRED'); });
  const result = await migration.queryFn();
  assert.equal(result.migrationRequired, true);
  assert.equal(result.items.length, 0);
});

test('grinding changes invalidate cached reservations without refetching the whole ERP snapshot', async () => {
  const client = new QueryClient();
  let calls = 0;
  let tasks = [];
  const options = optionsFor(grindKey, 'spis', '2026-09-28', async () => { calls++; return tasks; });
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    assert.equal(calls, 1);
    tasks = [{ materialName: 'METAL BOX', qty: 200 }];
    await client.invalidateQueries({ queryKey: [grindKey] });
    assert.equal(observer.getCurrentResult().data[0].qty, 200);
    assert.equal(calls, 2);
    assert.match(source, /invalidateQueries\(\{ queryKey: \['original-inventory-grind-tasks'\]/);
  } finally { unsubscribe(); client.clear(); }
});

test('availability renders only ERP and available quantity with unit in one compact unframed line', () => {
  const html = render({ snapshot: { availableQty: 125.625, realQty: 999, unit: 'kg' } });
  assert.equal(html.replace(/<[^>]+>/g, ''), 'ERP — 125,625 kg');
  assert.match(html, /whitespace-nowrap/);
  assert.match(html, /text-violet-300/);
  assert.match(html, /class="font-bold tabular-nums"/);
  assert.equal((html.match(/<p\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<div|<br|border|shadow|rounded|bg-|text-base|px-3|py-2/);
  assert.doesNotMatch(html, /999|28\.09\.2026|2026-09-28|do dyspozycji/);
  assert.match(render({ snapshot: { availableQty: 12.5, unit: 'l' } }), /12,5 l/);
  assert.equal(render({ name: '' }), '');
  assert.equal(render({ date: '' }), '');
});

test('real zero and negative availability are displayed and never called missing ERP', () => {
  for (const availableQty of [0, -15]) {
    const html = render({ snapshot: { availableQty, unit: 'szt.' } });
    assert.ok(html.includes(`${availableQty} szt.`));
    assert.doesNotMatch(html, /Brak danych|Wczytywanie/);
  }
});

test('missing day and missing material are distinct from a zero balance', () => {
  const missingDay = render({ snapshot: null, hasSnapshot: false });
  assert.match(missingDay, /Brak danych ERP dla tego dnia/);
  assert.match(missingDay, /Stany ERP/);
  const missingMaterial = render({ snapshot: null });
  assert.match(missingMaterial, /Brak danych ERP dla wybranego materiału/);
  assert.doesNotMatch(missingDay + missingMaterial, />0 szt\./);
});

test('loading, network failure and migration error never pretend stock is zero or available', () => {
  assert.match(render({ loading: true, snapshot: null, hasSnapshot: false }), /Wczytywanie danych ERP/);
  const failure = render({ error: true });
  assert.match(failure, /Nie udało się pobrać/);
  assert.match(failure, /Spróbuj ponownie/);
  assert.doesNotMatch(failure, /250 szt\./);
  assert.match(render({ migrationRequired: true }), /Wymagana aktualizacja bazy/);
});

test('pieces wait for reservations while kilograms and litres can already show ERP stock', () => {
  assert.match(render({ reservationsLoading: true }), /Wczytywanie danych ERP/);
  const failure = render({ reservationsError: true });
  assert.match(failure, /Nie udało się pobrać/);
  assert.doesNotMatch(failure, /250 szt\./);
  for (const unit of ['kg', 'l']) {
    const html = render({ snapshot: { availableQty: 75, unit }, reservationsError: true, reservationsLoading: true });
    assert.ok(html.includes(`75 ${unit}`));
    assert.doesNotMatch(html, /Nie udało|Wczytywanie/);
  }
});

test('Spis displays the same grinding-adjusted availability as reports without altering imported stock', () => {
  const entries = [{ name: 'METAL BOX', unit: 'szt.', availableQty: 500, importedAt: '2026-09-28T06:00:00Z' }];
  const tasks = [{ materialName: 'METAL BOX', unit: 'szt.', qty: 200, status: 'PENDING', sourceReportDate: '2026-09-28', createdAt: '2026-09-28T08:00:00Z' }];
  const [effective] = applyPieceGrindingReservations(entries, tasks, '2026-09-28', (name) => name.toLowerCase());
  assert.match(render({ snapshot: effective }), /300 szt\./);
  assert.equal(entries[0].availableQty, 500);
});

test('actual Spis JSX wires snapshot, date, loading states and both retry requests into the hint', () => {
  assert.ok(availabilityNode);
  const mod = { exports: {} };
  let erpRetries = 0;
  let reservationRetries = 0;
  let identityRetries = 0;
  vm.runInNewContext(compile(`module.exports = (${availabilityNode});`), {
    module: mod, exports: mod.exports, require, SpisErpAvailability,
    form: { name: baseProps.name }, spisDate: baseProps.date,
    matchedErpSnapshot: baseProps.snapshot, erpSnapshotEntries: [baseProps.snapshot],
    isErpSnapshotPending: false, isErpSnapshotError: true, erpSnapshotMigrationRequired: false,
    isGrindTasksPending: false, isGrindTasksError: false,
    needsErpCatalogIdentity: true, isErpMaterialPending: false, isErpMaterialError: false,
    refetchErpSnapshot: () => { erpRetries++; },
    refetchGrindTasks: () => { reservationRetries++; },
    refetchErpMaterial: () => { identityRetries++; }
  });
  assert.match(renderToStaticMarkup(mod.exports), /Spróbuj ponownie/);
  assert.equal(mod.exports.props.date, baseProps.date);
  assert.doesNotMatch(renderToStaticMarkup(mod.exports), /28\.09\.2026|2026-09-28/);
  mod.exports.props.onRetry();
  assert.equal(erpRetries, 1);
  assert.equal(reservationRetries, 1);
  assert.equal(identityRetries, 1);
});

test('the actual hint waits for identity resolution and offers retry when that lookup fails', () => {
  for (const failed of [false, true]) {
    const mod = { exports: {} };
    vm.runInNewContext(compile(`module.exports = (${availabilityNode});`), {
      module: mod, exports: mod.exports, require, SpisErpAvailability,
      form: { name: grateName }, spisDate: baseProps.date,
      matchedErpSnapshot: null, erpSnapshotEntries: [grateStock()],
      isErpSnapshotPending: false, isErpSnapshotError: false, erpSnapshotMigrationRequired: false,
      isGrindTasksPending: false, isGrindTasksError: false,
      needsErpCatalogIdentity: true, isErpMaterialPending: !failed, isErpMaterialError: failed
    });
    const html = renderToStaticMarkup(mod.exports);
    assert.match(html, failed ? /Spróbuj ponownie/ : /Wczytywanie danych ERP/);
    assert.doesNotMatch(html, /Brak danych ERP/);
  }
});
