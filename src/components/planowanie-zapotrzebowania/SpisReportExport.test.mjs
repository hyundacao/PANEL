import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ExcelJS from 'exceljs';
import { QueryClient } from '@tanstack/react-query';
import { normalizeOriginalInventoryName } from '../../lib/utils/originalInventoryName.ts';
import {
  buildOriginalInventoryReportErpHistory,
  buildOriginalInventoryReportRows
} from '../../lib/utils/originalInventoryReport.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('./SpisRzeczywisty.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SpisRzeczywisty.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map();
let historyQuery;
const visit = node => {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    initializers.set(node.name.getText(ast), node.initializer.getText(ast));
  }
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useQuery'
    && node.arguments[0]?.getText(ast).includes("queryKey: ['spis-oryginalow-erp-snapshot-history'")) {
    historyQuery = node.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
const compile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const handler = compile([
  'normalizeCatalogNameKey', 'formatCompactDate', 'formatExcelQty',
  'formatExcelSignedQty', 'formatExcelDiffHistoryCell', 'handleExportDaily'
].map(name => {
  assert.ok(initializers.has(name), name);
  return `const ${name} = ${initializers.get(name)};`;
}).join('\n') + '\nmodule.exports = handleExportDaily;');
const dateKeys = Array.from({ length: 60 }, (_, index) =>
  new Date(Date.UTC(2026, 10, 16 - index)).toISOString().slice(0, 10)
);
const snapshots = dates => dates.map((snapshotDate, index) => ({
  id: snapshotDate, snapshotDate, name: 'KARTON', unit: 'szt.',
  realQty: 100 + index, availableQty: 90 + index,
  importedAt: `${snapshotDate}T08:00:00Z`, importedBy: 'test'
}));

const createExport = ({ dates = dateKeys, loadHistory, busy = false, loading = false, error = false } = {}) => {
  const calls = { dates: [], states: [], toasts: [], downloads: [], queryOptions: [] };
  const client = new QueryClient();
  const ref = { current: busy };
  const context = {
    module: { exports: {} }, require, Blob,
    normalizeOriginalInventoryName, buildOriginalInventoryReportErpHistory, buildOriginalInventoryReportRows,
    spisDate: '2026-11-17', reportSourceEntries: [{ key: 'karton', name: 'KARTON', unit: 'szt.', qty: 200 }],
    inventoryHistoryByMaterial: new Map([['karton', dates.map(dateKey => ({ dateKey, qty: 150 }))]]),
    reportHistoryDatesForExport: dates,
    effectiveErpSnapshotEntries: snapshots(['2026-11-17']),
    erpSnapshotMap: new Map([['karton', { realQty: 170, availableQty: 160 }]]),
    currentErpSnapshotMeta: { importedAt: '2026-11-17T08:00:00Z' },
    visibleReportModes: [
      { key: 'real', shortLabel: 'rzecz.', fullLabel: 'rzeczywisty' },
      { key: 'available', shortLabel: 'dysp.', fullLabel: 'do dyspozycji' }
    ],
    showReportIndex2: true, resolveReportIndex2: () => '001-00',
    isReportDataLoading: loading, isReportDataError: error, reportErpSnapshotMigrationRequired: false,
    reportExportInFlightRef: ref,
    setIsExportingReport: value => calls.states.push(value),
    ERP_SNAPSHOT_MIGRATION_REQUIRED: 'MIGRATION_REQUIRED',
    getOriginalInventoryErpSnapshotsByDates: async requested => {
      calls.dates.push([...requested]);
      return loadHistory ? loadHistory(requested) : snapshots(requested);
    },
    queryClient: { fetchQuery: options => {
      calls.queryOptions.push(options);
      return client.fetchQuery(options);
    } },
    toast: value => calls.toasts.push(value),
    URL: {
      createObjectURL: blob => { calls.blob = blob; return 'blob:report'; },
      revokeObjectURL: () => {}
    },
    document: { createElement: () => {
      const link = { click: () => calls.downloads.push(link.download) };
      return link;
    } }
  };
  vm.runInNewContext(handler, context);
  return { run: context.module.exports, calls, ref, context, client };
};
const getSheet = async calls => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await calls.blob.arrayBuffer()));
  return workbook.getWorksheet('Raport');
};

test('opening reports requests only the four visible history dates, not the 60-day export', async () => {
  assert.ok(historyQuery);
  const requested = [];
  const context = {
    module: { exports: {} }, activeTab: 'raporty', reportHistoryDates: dateKeys.slice(0, 4),
    reportHistoryDatesTwoMonths: dateKeys,
    getOriginalInventoryErpSnapshotsByDates: async dates => { requested.push([...dates]); return []; },
    isErpSnapshotMigrationError: () => false
  };
  vm.runInNewContext(compile(`module.exports = (${historyQuery});`), context);
  const options = context.module.exports;
  assert.equal(options.enabled, true);
  await options.queryFn();
  assert.deepEqual(requested, [dateKeys.slice(0, 4)]);
  assert.deepEqual(Array.from(options.queryKey[1]), dateKeys.slice(0, 4));
  assert.equal(initializers.get('reportRowsForExport').startsWith('useMemo'), false);
  assert.equal(initializers.get('reportExportHistoryDateLabels').startsWith('useMemo'), false);
});

test('screen and export keep identical comparisons for the visible dates, including zero and missing ERP', () => {
  const history = new Map([['karton', dateKeys.map(dateKey => ({ dateKey, qty: 150 }))]]);
  const erp = snapshots(dateKeys);
  erp[0].realQty = 0;
  erp[0].availableQty = 0;
  erp.splice(1, 1);
  const input = {
    sourceEntries: [{ key: 'karton', name: 'KARTON', unit: 'szt.', qty: 200 }],
    inventoryHistoryByMaterial: history,
    currentErp: new Map([['karton', { realQty: 0, availableQty: 0 }]])
  };
  const screen = buildOriginalInventoryReportRows({ ...input, historyDates: dateKeys.slice(0, 4),
    erpHistory: buildOriginalInventoryReportErpHistory(erp.slice(0, 3), name => name.toLowerCase()) })[0];
  const exported = buildOriginalInventoryReportRows({ ...input, historyDates: dateKeys,
    erpHistory: buildOriginalInventoryReportErpHistory(erp, name => name.toLowerCase()) })[0];
  assert.equal(screen.currentRealDiffQty, 200);
  assert.equal(screen.previousRealDiffs[0].diffQty, 150);
  assert.equal(screen.previousRealDiffs[1].diffQty, null);
  assert.deepEqual(screen.previousRealDiffs, exported.previousRealDiffs.slice(0, 4));
  assert.deepEqual(screen.previousAvailableDiffs, exported.previousAvailableDiffs.slice(0, 4));
  assert.equal(exported.previousRealDiffs[59].diffQty, -9);
});

test('Excel loads the entire history on demand and retains all columns, units, index 2 and values', async () => {
  const { run, calls, ref, client } = createExport();
  assert.equal(calls.dates.length, 0);
  await run();
  const sheet = await getSheet(calls);
  assert.deepEqual(calls.dates, [dateKeys]);
  assert.deepEqual(calls.states, [true, false]);
  assert.equal(ref.current, false);
  assert.equal(sheet.columnCount, 128);
  assert.equal(sheet.getCell('A5').value, '001-00');
  assert.equal(sheet.getCell('B5').value, 'KARTON');
  assert.equal(sheet.getCell('C5').value, '170');
  assert.equal(sheet.getCell('D5').value, '160');
  assert.equal(sheet.getCell('E5').value, '200');
  assert.equal(sheet.getCell('F5').value, '+30');
  assert.equal(sheet.getCell('G5').value, '+40');
  assert.equal(sheet.getCell('H5').value, '+50');
  assert.equal(sheet.getCell('I5').value, '+60');
  assert.equal(sheet.getCell(5, 126).value, '-9');
  assert.equal(sheet.getCell(5, 127).value, '+1');
  assert.equal(sheet.getCell(5, 128).value, 'szt.');
  assert.match(sheet.getCell('A3').value, /Historia: 60 dni/);
  assert.equal(sheet.views[0].ySplit, 4);
  assert.ok(sheet.autoFilter.startsWith('A4:'));
  assert.deepEqual(calls.downloads, ['spis-rzeczywisty-raport-2026-11-17.xlsx']);
  assert.deepEqual(calls.toasts, []);
  assert.equal(calls.queryOptions[0].gcTime, 0);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(client.getQueryCache().getAll().length, 0);
});

test('a second click cannot start another export while history is still loading', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const { run, calls } = createExport({ loadHistory: () => waiting });
  const first = run();
  await run();
  assert.equal(calls.dates.length, 1);
  assert.equal(calls.downloads.length, 0);
  assert.deepEqual(calls.states, [true]);
  release(snapshots(dateKeys));
  await first;
  assert.equal(calls.downloads.length, 1);
  assert.deepEqual(calls.states, [true, false]);
});

test('history failure never downloads an incomplete Excel and allows a retry', async () => {
  let fail = true;
  const { run, calls, ref } = createExport({ loadHistory: dates => {
    if (fail) throw new Error('NETWORK_ERROR');
    return snapshots(dates);
  } });
  await run();
  assert.equal(calls.downloads.length, 0);
  assert.equal(calls.toasts[0].tone, 'error');
  assert.equal(ref.current, false);
  fail = false;
  await run();
  assert.equal(calls.downloads.length, 1);
  assert.deepEqual(calls.states, [true, false, true, false]);
});

test('an empty history does not make an unnecessary request and still exports the current day', async () => {
  const { run, calls } = createExport({ dates: [] });
  await run();
  const sheet = await getSheet(calls);
  assert.equal(calls.dates.length, 0);
  assert.equal(sheet.columnCount, 8);
  assert.equal(sheet.getCell('F5').value, '+30');
  assert.match(sheet.getCell('A3').value, /Historia: 0 dni/);
});

test('unloaded or failed current data cannot be exported as missing ERP', async () => {
  for (const options of [{ busy: true }, { loading: true }, { error: true }]) {
    const { run, calls } = createExport(options);
    await run();
    assert.equal(calls.dates.length, 0);
    assert.equal(calls.downloads.length, 0);
    assert.deepEqual(calls.states, []);
  }
});

test('ERP history sums warehouses once and does not mutate imported stock', () => {
  const entries = snapshots([dateKeys[0], dateKeys[0]]);
  const before = structuredClone(entries);
  const history = buildOriginalInventoryReportErpHistory(entries, name => name.toLowerCase());
  assert.deepEqual(history.get(dateKeys[0]).get('karton'), { realQty: 201, availableQty: 181 });
  assert.deepEqual(entries, before);
});
