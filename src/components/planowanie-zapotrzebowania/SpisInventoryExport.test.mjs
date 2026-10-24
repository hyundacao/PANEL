import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { getOriginalInventorySpisIndex2 } from '../../lib/utils/originalInventorySpisSearch.ts';
import { normalizeOriginalInventoryName } from '../../lib/utils/originalInventoryName.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('./SpisRzeczywisty.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SpisRzeczywisty.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    initializers.set(node.name.getText(ast), node.initializer.getText(ast));
  }
  ts.forEachChild(node, visit);
};
visit(ast);
const compiled = ts.transpileModule(
  ['exportCatalogCollator', 'normalizeCatalogNameKey', 'buildInventoryIndex2ByName', 'handleExportInventoryByLocation']
    .map(name => {
      assert.ok(initializers.has(name), name);
      return `const ${name} = ${initializers.get(name)};`;
    }).join('\n') + '\nmodule.exports = handleExportInventoryByLocation;',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

const runExport = async ({
  rows = [{ materialName: 'KARTON', areaName: 'H1', qty: 200, unit: 'szt.' }],
  catalog = [], erpCatalog = [], erpSnapshot = [],
  catalogError = false, busy = false, date = '2026-10-23'
} = {}) => {
  const mod = { exports: {} };
  const calls = { queries: [], saving: [], toasts: [], clicks: 0, revoked: [] };
  const link = { click: () => { calls.clicks += 1; } };
  let blob;
  vm.runInNewContext(compiled, {
    module: mod, require, Blob,
    getOriginalInventorySpisIndex2, normalizeOriginalInventoryName,
    spisDate: date, inventoryExportRows: rows, isExportingInventory: busy,
    setIsExportingInventory: value => calls.saving.push(value),
    erpCatalogItems: erpCatalog, erpSnapshotEntries: erpSnapshot,
    getOriginalInventoryCatalog: async () => {
      if (catalogError) throw new Error('CATALOG_UNAVAILABLE');
      return catalog;
    },
    queryClient: { fetchQuery: async options => {
      calls.queries.push([...options.queryKey]);
      return options.queryFn();
    } },
    toast: value => calls.toasts.push(value),
    URL: {
      createObjectURL: value => { blob = value; return 'blob:inventory-export'; },
      revokeObjectURL: value => calls.revoked.push(value)
    },
    document: { createElement: tag => { assert.equal(tag, 'a'); return link; } }
  });
  await mod.exports();
  let workbook;
  if (blob) {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await blob.arrayBuffer()));
  }
  return { calls, link, sheet: workbook?.getWorksheet('Spis sumaryczny') };
};

test('inventory XLSX replaces the date with index 2 and keeps all other columns', async () => {
  const { calls, link, sheet } = await runExport({
    catalog: [{ name: 'KARTON', indexCode: 'M-1-KAR-001-00', indexCode2: '001-00' }]
  });
  assert.deepEqual(sheet.getRow(1).values.slice(1), [
    'Indeks 2', 'Tworzywo', 'Obszar', 'Komora', 'Nape\u0142nienie silosa [%]',
    'Przelicznik 1% [kg]', 'Lejek [kg]', 'Ilo\u015b\u0107', 'Jednostka'
  ]);
  assert.equal(sheet.getCell('A2').value, '001-00');
  assert.equal(sheet.getCell('A2').numFmt, '@');
  assert.equal(sheet.getCell('B2').value, 'KARTON');
  assert.equal(sheet.getCell('C2').value, 'H1');
  assert.equal(sheet.getCell('H2').value, 200);
  assert.equal(sheet.getCell('I2').value, 'szt.');
  assert.equal(sheet.autoFilter, 'A1:I1');
  assert.equal(sheet.views[0].ySplit, 1);
  assert.equal(link.download, 'spis-rzeczywisty-podsumowanie-2026-10-23.xlsx');
  assert.deepEqual(calls.queries, [['spis-oryginalow-catalog-local']]);
  assert.deepEqual(calls.saving, [true, false]);
  assert.equal(calls.clicks, 1);
  assert.deepEqual(calls.toasts, []);
});

test('index 2 uses catalog and ERP values, deduplicates codes and preserves long and slash identifiers as text', async () => {
  const { sheet } = await runExport({
    catalog: [
      { name: 'KARTON', indexCode: 'M-1-KAR-001-00', indexCode2: '001-00' },
      { name: 'DETAL', indexCode2: '00012345678901234567' }
    ],
    erpCatalog: [{ name: ' karton ', indexCode: 'M-1-KAR-001-00' }],
    erpSnapshot: [{ name: 'KARTON', indexCode: 'M-1-KAR-002/03' }],
    rows: [
      { materialName: 'KARTON', areaName: 'Bakoma', qty: 3, unit: 'szt.' },
      { materialName: 'DETAL', areaName: 'H2', qty: 5, unit: 'szt.' }
    ]
  });
  assert.equal(sheet.getCell('A2').value, '001-00 / 002/03');
  assert.equal(sheet.getCell('A3').value, '00012345678901234567');
  assert.equal(sheet.getCell('A3').numFmt, '@');
});

test('unmatched materials remain blank instead of receiving a similar material index', async () => {
  const { sheet } = await runExport({
    catalog: [{ name: 'KARTON INNY', indexCode2: '1234' }]
  });
  assert.ok(sheet.getCell('A2').value == null || sheet.getCell('A2').value === '');
  assert.equal(sheet.getCell('B2').value, 'KARTON');
});

test('silo export preserves its measurements and quantities alongside index 2', async () => {
  const { sheet } = await runExport({
    catalog: [{ name: 'ABS', indexCode: 'M-1-TW-5949' }],
    rows: [{ materialName: 'ABS', areaName: 'Silosy', qty: 15680.1234, unit: 'kg',
      siloChamber: 'E', siloPercent: 46, siloPercentKg: 330, siloHopperKg: 500 }]
  });
  assert.deepEqual(sheet.getRow(2).values.slice(1), ['5949', 'ABS', 'Silosy', 'E', 0.46, 330, 500, 15680.123, 'kg']);
  assert.equal(sheet.getCell('E2').numFmt, '0.##%');
});

test('catalog failure aborts the export and releases the busy state', async () => {
  const { calls, sheet } = await runExport({ catalogError: true });
  assert.equal(sheet, undefined);
  assert.equal(calls.clicks, 0);
  assert.equal(calls.toasts[0]?.tone, 'error');
  assert.deepEqual(calls.saving, [true, false]);
});

test('empty, undated and already running exports do not fetch or download', async () => {
  for (const options of [{ rows: [] }, { date: '' }, { busy: true }]) {
    const { calls } = await runExport(options);
    assert.deepEqual(calls.queries, []);
    assert.deepEqual(calls.saving, []);
    assert.equal(calls.clicks, 0);
  }
});
