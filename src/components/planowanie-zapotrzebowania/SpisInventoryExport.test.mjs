import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import {
  getOriginalInventorySpisIndex2,
  rankOriginalInventorySpisSuggestions,
  searchOriginalInventorySpisSuggestions
} from '../../lib/utils/originalInventorySpisSearch.ts';
import { normalizeOriginalInventoryName } from '../../lib/utils/originalInventoryName.ts';
import { normalizeOriginalInventoryIndex } from '../../lib/utils/originalInventoryIndex.ts';
import { isPieceGrindingUnit } from '../../lib/utils/originalInventoryGrinding.ts';

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
  ['normalizeCatalogNameKey', 'buildInventoryIndex2Resolver', 'handleExportInventoryByLocation']
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
    rankOriginalInventorySpisSuggestions, normalizeOriginalInventoryIndex, isPieceGrindingUnit,
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

test('index 2 selects one ERP-backed code and preserves long and slash identifiers as text', async () => {
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
  assert.equal(sheet.getCell('A2').value, '002/03');
  assert.equal(sheet.getCell('A3').value, '00012345678901234567');
  assert.equal(sheet.getCell('A3').numFmt, '@');
});

test('IRIS exports only the index preferred by search for the selected ERP day', async () => {
  const catalog = [
    { name: 'IRIS LR WHEEL', indexCode: 'A22154703', unit: 'szt.' },
    { name: 'IRIS LR WHEEL', indexCode: 'A22154704', unit: 'szt.' }
  ];
  for (const indexCode of ['A22154704', 'A22154703']) {
    const erpSnapshot = [{ name: 'IRIS LR WHEEL', indexCode, unit: 'szt.' }];
    const suggestions = catalog.map(item => ({
      ...item,
      indexCode2: getOriginalInventorySpisIndex2(item.indexCode),
      inErp: item.indexCode === indexCode
    }));
    const firstSuggestion = searchOriginalInventorySpisSuggestions(suggestions, 'IRIS LR WHEEL', [])[0];
    const { sheet } = await runExport({ catalog, erpSnapshot,
      rows: [{ materialName: 'IRIS LR WHEEL', areaName: 'Bakoma', qty: 19444, unit: 'szt.' }]
    });
    assert.equal(sheet.getCell('A2').value, firstSuggestion.indexCode2);
    assert.equal(sheet.getCell('A2').value, indexCode);
    assert.equal(sheet.getCell('H2').value, 19444);
  }
});

test('lid indices match the single index 2 shown by search, not other warehouse aliases', async () => {
  const catalog = [
    { name: 'POKRYWA 1200X800 S99', indexCode: 'M-4-OP-786-002-01', warehouseCode: 'M-4' },
    { name: 'POKRYWA 1200X800 S99', indexCode2: '786-002-01' },
    { name: 'POKRYWA PALETY PLASTIKOWEJ 1200X800 ZWROTNA ELUX', indexCode: 'M-4-OP-8900', warehouseCode: 'M-4' },
    { name: 'POKRYWA WYMIENNIKOW CIEPLA T27SC0', indexCode: '8001312050', warehouseCode: 'M-10', indexCode2: '2050' },
    { name: 'POKRYWA 176.8001', indexCode: 'M-1-OP-006-00', warehouseCode: 'M-1' },
    { name: 'POKRYWA 176.8001', indexCode: 'M-40-OP-9900', warehouseCode: 'M-40' }
  ];
  const names = [...new Set(catalog.map(item => item.name))];
  const { sheet } = await runExport({ catalog,
    rows: names.map(materialName => ({ materialName, areaName: 'H1', qty: 12, unit: 'szt.' }))
  });
  const expected = ['786-002-01', '8900', '8001312050', '006-00'];
  const suggestions = catalog.map(item => ({ ...item,
    indexCode2: getOriginalInventorySpisIndex2(item.indexCode, item.indexCode2)
  }));
  names.forEach((name, i) => {
    const firstSuggestion = searchOriginalInventorySpisSuggestions(suggestions, name, [])[0];
    assert.equal(sheet.getCell(`A${i + 2}`).value, expected[i]);
    assert.equal(sheet.getCell(`A${i + 2}`).value, firstSuggestion.indexCode2);
    assert.equal(sheet.getCell(`H${i + 2}`).value, 12);
  });
});

test('equal names with incompatible units do not receive each others indices', async () => {
  const { sheet } = await runExport({
    catalog: [
      { name: 'MATERIAL', indexCode: 'M-1-OP-001', unit: 'kg' },
      { name: 'MATERIAL', indexCode: 'M-4-OP-002', unit: 'szt.' }
    ],
    rows: [
      { materialName: 'MATERIAL', areaName: 'H1', qty: 20, unit: 'szt' },
      { materialName: 'MATERIAL', areaName: 'H2', qty: 7, unit: 'kg' },
      { materialName: 'MATERIAL', areaName: 'H3', qty: 3, unit: 'litr' }
    ]
  });
  assert.equal(sheet.getCell('A2').value, '002');
  assert.equal(sheet.getCell('A3').value, '001');
  assert.ok(!sheet.getCell('A4').value);
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
