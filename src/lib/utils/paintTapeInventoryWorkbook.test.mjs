import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const ExcelJS = require('exceljs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true };
const cache = new Map();
function load(path) {
  const file = path.endsWith('.ts') ? path : `${path}.ts`;
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file); cache.set(file, mod);
  mod.require = name => name.startsWith('@/') ? load(resolve(root, name.slice(2))) : name.startsWith('.') ? load(resolve(dirname(file), name)) : require(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions }).outputText, file);
  return mod.exports;
}
const { buildPaintTapeInventoryExport, createPaintTapeInventoryWorkbook } = load(resolve(root, 'lib/utils/paintTapeInventoryWorkbook.ts'));
const date = '2026-10-20';
const item = (id, unit = 'kg') => ({ id, itemIndex: `000${id}`, itemCode: '0010', name: `FARBA ${id}`, category: 'FARBY', unit, isActive: true, sortOrder: 0 });
const entry = (id, catalogItemId, qty) => ({ id, catalogItemId, qty, sessionId: 'session', location: 'Hala 2', note: '=1+1', checkedAt: '2026-10-20T05:10:20Z', checkedBy: 'Operator' });
const fixture = () => ({
  catalog: [item('1'), item('2', 'litr'), item('3'), item('4'), item('5')], sessions: [],
  session: { id: 'session', inventoryDate: date, status: 'OPEN', expectedCount: 5, checkedCount: 4 },
  entries: [entry('one', '1', 2), entry('two', '1', 3), entry('three', '2', 0), entry('four', '3', 5), entry('five', '4', 10)]
});
const snapshots = () => [
  { name: 'FARBA 1', indexCode: '0001', unit: 'kg', realQty: 8, availableQty: 99, snapshotDate: date },
  { name: 'FARBA 2', indexCode: '0002', unit: 'l', realQty: 0, availableQty: 100, snapshotDate: date },
  { name: 'FARBA 4', indexCode: '0004', unit: 'litr', realQty: 2, availableQty: 99, snapshotDate: date }
];

test('export sums each item once, keeps zero and missing ERP distinct and refuses cross-unit subtraction', () => {
  const data = buildPaintTapeInventoryExport(fixture(), snapshots(), date);
  assert.deepEqual(data.rows.map(row => [row.physicalQty, row.erpQty, row.difference, row.measurements]), [[5, 8, -3, 2], [0, 0, 0, 1], [5, null, null, 1], [10, 2, null, 1]]);
  assert.deepEqual(data.rows.map(row => row.status), ['Niedobór fizyczny', 'Stan zgodny', 'Brak stanu ERP', 'Niezgodna jednostka']);
  assert.equal(data.measurements.length, 5);
  const zeroErp = snapshots(); zeroErp[0].realQty = 0;
  assert.equal(buildPaintTapeInventoryExport(fixture(), zeroErp, date).rows[0].difference, 5);
});

test('closed counts export frozen names, physical stock and ERP, including an explicit archived lack of ERP', () => {
  const f = fixture(); f.session.status = 'CLOSED';
  f.comparison = { version: 1, inventoryDate: date, rows: f.catalog.map(item => ({ item: { ...item, name: `ARCHIVE ${item.name}` }, physicalQty: item.id === '1' ? 1.5 : 0, erp: item.id === '1' ? { realQty: 1.7, availableQty: 100, unit: 'kg' } : null })) };
  const data = buildPaintTapeInventoryExport(f, snapshots().map(row => ({ ...row, realQty: 999, snapshotDate: '2026-10-21' })), date);
  assert.equal(data.rows[0].item.name, 'ARCHIVE FARBA 1');
  assert.equal(data.rows[0].physicalQty, 1.5);
  assert.equal(data.rows[0].erpQty, 1.7);
  assert.equal(data.rows[0].difference, -0.2);
  assert.equal(data.rows[1].erpQty, null);
  assert.match(data.erpSource, /Archiwum zamkniętego spisu/);
});

test('reopened old counts keep archived ERP when live data was purged but use the current saved measurements', () => {
  const f = fixture();
  f.comparison = { inventoryDate: date, rows: [{ item: f.catalog[0], physicalQty: 1, erp: { realQty: 8, availableQty: 0, unit: 'kg' } }] };
  const data = buildPaintTapeInventoryExport(f, [], date);
  assert.equal(data.rows[0].physicalQty, 5);
  assert.equal(data.rows[0].erpQty, 8);
  assert.equal(data.rows[0].difference, -3);
  assert.match(data.erpSource, /Archiwum ERP/);
});

test('export rejects wrong dates and orphan measurements instead of silently mixing or dropping data', () => {
  assert.throws(() => buildPaintTapeInventoryExport(fixture(), snapshots(), '2026-10-19'), /DATE_MISMATCH/);
  assert.throws(() => buildPaintTapeInventoryExport(fixture(), [{ ...snapshots()[0], snapshotDate: '2026-10-21' }], date), /DATE_MISMATCH/);
  const f = fixture(); f.entries.push(entry('bad', 'unknown', 10));
  assert.throws(() => buildPaintTapeInventoryExport(f, snapshots(), date), /INCOMPLETE/);
});

test('saved Excel contains two filterable native tables, typed numbers, text indices, formulas and Warsaw measurement dates', async () => {
  const workbook = await createPaintTapeInventoryWorkbook(fixture(), snapshots(), date);
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(saved.worksheets.map(sheet => sheet.name), ['Spis', 'Pomiary']);
  const main = saved.getWorksheet('Spis'), details = saved.getWorksheet('Pomiary');
  assert.ok(main.getTable('SpisFarbITasm')); assert.ok(details.getTable('PomiarySpisu'));
  assert.equal(main.getTable('SpisFarbITasm').table.tableRef, 'A4:K8');
  assert.equal(details.getTable('PomiarySpisu').table.tableRef, 'A4:I9');
  assert.ok(main.getTable('SpisFarbITasm').table.columns.every(column => column.filterButton));
  for (const table of [main.getTable('SpisFarbITasm'), details.getTable('PomiarySpisu')]) {
    assert.ok(table.table.columns.every(column => !/[\r\n]/.test(column.name)), 'table column names must open without repair in Excel');
  }
  assert.equal(main.getCell('B5').value, '0001'); assert.equal(main.getCell('C5').value, '0010');
  assert.equal(main.getCell('E5').value, 5); assert.equal(main.getCell('G5').value, 8);
  assert.deepEqual(main.getCell('I5').value, { formula: 'ROUND(E5-G5,3)', result: -3 });
  assert.equal(main.getCell('I6').result, 0);
  assert.equal(main.getCell('G7').value, null); assert.equal(main.getCell('I7').value, null);
  assert.equal(main.getCell('I8').value, null);
  assert.match(main.getCell('I5').numFmt, /^\+/);
  for (const sheet of [main, details]) {
    assert.equal(sheet.views[0].ySplit, 4);
    assert.equal(sheet.views[0].xSplit, 0);
    assert.equal(sheet.views[0].topLeftCell, 'A5');
    assert.equal(sheet.views[0].activeCell, 'A5');
    assert.equal(sheet.views[0].zoomScale, 100);
    assert.equal(sheet.getRow(4).height, 36);
    assert.equal(sheet.pageSetup.printTitlesRow, '1:4');
  }
  assert.equal(main.getCell('A5').font.color.argb, 'FFC45100');
  assert.equal(main.getCell('B5').font.color.argb, 'FF5B45D6');
  assert.equal(main.getCell('E5').font.size, 12);
  assert.equal(main.getCell('E5').fill.fgColor.argb, 'FFEDF7F1');
  assert.equal(main.getCell('G5').fill.fgColor.argb, 'FFEDF6FC');
  assert.equal(main.getCell('I5').font.color.argb, 'FFAE2536');
  assert.equal(main.getCell('I7').fill.fgColor.argb, 'FFFFF6DD');
  assert.equal(main.getCell('A5').border.right.style, 'thin');
  assert.equal(main.getCell('B2').value.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(details.getCell('I5').value.toISOString(), '2026-10-20T07:10:20.000Z');
  assert.equal(details.getCell('G5').value, '=1+1', 'notes remain literal text, not Excel formulas');
  assert.equal(details.getCell('D5').value, 2);
});

const comment = (catalogItemId, text, sessionId = 'session') => ({
  sessionId, catalogItemId, text, revision: 1, updatedAt: '2026-10-22T10:00:00Z', updatedBy: 'Accountant'
});

test('authorized Excel export includes saved comments once per item, with multiline text and literal formula-like content', async () => {
  const text = '=1+1\nSecond line\n\nFourth line';
  const workbook = await createPaintTapeInventoryWorkbook(fixture(), snapshots(), date, [
    comment('1', text), comment('2', '+10'), comment('3', '@SUM(A1)'), comment('4', ''),
    comment('5', 'NOT COUNTED'), comment('unknown', 'ORPHAN COMMENT')
  ]);
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await workbook.xlsx.writeBuffer());
  const main = saved.getWorksheet('Spis');
  assert.equal(main.getTable('SpisFarbITasm').table.tableRef, 'A4:L8');
  assert.equal(main.getCell('L4').value, 'Komentarz do rozliczenia');
  assert.equal(main.getCell('L5').value, text);
  assert.equal(main.getCell('L6').value, '+10');
  assert.equal(main.getCell('L7').value, '@SUM(A1)');
  assert.equal(main.getCell('L5').type, ExcelJS.ValueType.String);
  assert.equal(main.getCell('L5').numFmt, '@');
  assert.equal(main.getCell('L5').alignment.wrapText, true);
  assert.equal(main.getColumn('L').width, 52);
  assert.ok(main.getRow(5).height >= 72, 'explicit line breaks and blank lines must increase row height');
  assert.equal(main.pageSetup.printArea, 'A1:L8');
  assert.equal(main.views[0].topLeftCell, 'A5');
  assert.equal(main.getTable('SpisFarbITasm').table.columns.at(-1).filterButton, true);
  const allCells = saved.worksheets.flatMap(sheet => sheet.getSheetValues()).flat(2);
  assert.ok(!allCells.includes('NOT COUNTED'));
  assert.ok(!allCells.includes('ORPHAN COMMENT'));
  assert.equal(allCells.filter(value => value === text).length, 1, 'do not repeat private comments for each measurement');
  assert.equal(saved.getWorksheet('Pomiary').getTable('PomiarySpisu').table.tableRef, 'A4:I9');
});

test('comment column is opt-in, supports empty authorized comments and refuses comments from a different count', async () => {
  const f = fixture();
  f.comments = [comment('1', 'PRIVATE')]; // Extra cached data must never opt the export in.
  const plain = await createPaintTapeInventoryWorkbook(f, snapshots(), date);
  assert.equal(plain.getWorksheet('Spis').columnCount, 11);
  assert.doesNotMatch(JSON.stringify(plain.model), /PRIVATE|Komentarz do rozliczenia/);
  const empty = await createPaintTapeInventoryWorkbook(f, snapshots(), date, []);
  assert.equal(empty.getWorksheet('Spis').getCell('L4').value, 'Komentarz do rozliczenia');
  assert.equal(empty.getWorksheet('Spis').getCell('L5').value, '');
  await assert.rejects(createPaintTapeInventoryWorkbook(f, snapshots(), date, [comment('1', 'WRONG DAY', 'other-session')]), /COMMENTS_SESSION_MISMATCH/);
  const long = 'x'.repeat(4000);
  const full = await createPaintTapeInventoryWorkbook(f, snapshots(), date, [comment('1', long)]);
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await full.xlsx.writeBuffer());
  assert.equal(saved.getWorksheet('Spis').getCell('L5').value, long, 'long comments must not be truncated');
  assert.ok(saved.getWorksheet('Spis').getRow(5).height <= 409);
});

function exportHandlerHarness(canViewComments, commentsResult) {
  const file = resolve(root, 'app/(main)/rozliczanie-farb-rozcienczalnikow/PaintTapeInventoryPanel.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleExportHistory') handler = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(handler);
  const calls = { comments: 0, workbook: [], downloads: 0, toasts: [], exporting: [] };
  const data = fixture();
  const context = {
    exports: {}, Error, Blob, URL: { createObjectURL: () => 'blob:export', revokeObjectURL() {} }, setTimeout() {},
    canViewComments, data, session: data.session, entries: data.entries, selectedDate: date,
    isComparisonFrozen: true, exportBusy: { current: false },
    setExporting: value => calls.exporting.push(value),
    erpSnapshotQuery: { data: [], isSuccess: false },
    commentsQuery: { data: [comment('1', 'STALE CACHE')], refetch: async () => { calls.comments++; return commentsResult; } },
    document: { body: { appendChild() {} }, createElement: () => ({ click: () => calls.downloads++, remove() {} }) },
    toast: value => calls.toasts.push(value), formatDate: value => value,
    require: name => {
      assert.equal(name, '@/lib/utils/paintTapeInventoryWorkbook');
      return { createPaintTapeInventoryWorkbook: async (...args) => {
        calls.workbook.push(args);
        return { xlsx: { writeBuffer: async () => new Uint8Array([1, 2]) } };
      } };
    }
  };
  vm.runInNewContext(ts.transpileModule(`exports.run = ${handler};`, { compilerOptions }).outputText, context);
  return { calls, context, run: context.exports.run };
}

test('export action fetches current comments only with permission and never uses a stale cached version', async () => {
  for (const allowed of [true, false]) {
    const current = [comment('1', 'LATEST SAVED')];
    const h = exportHandlerHarness(allowed, { isError: false, data: current });
    await h.run();
    assert.equal(h.calls.comments, allowed ? 1 : 0);
    assert.equal(h.calls.workbook[0][3], allowed ? current : undefined);
    assert.equal(h.calls.downloads, 1);
    assert.equal(h.calls.toasts[0].tone, 'success');
    assert.deepEqual(h.calls.exporting, [true, false]);
    assert.equal(h.context.exportBusy.current, false);
  }
});

test('failed or unavailable comments block export instead of silently producing an incomplete file', async () => {
  for (const result of [
    { isError: true, error: new Error('FORBIDDEN'), data: [comment('1', 'STALE CACHE')] },
    { isError: true, error: new Error('MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_COMMENTS') },
    { isError: false, data: undefined }
  ]) {
    const h = exportHandlerHarness(true, result);
    await h.run();
    assert.equal(h.calls.workbook.length, 0);
    assert.equal(h.calls.downloads, 0);
    assert.equal(h.calls.toasts[0].tone, 'error');
    assert.match(h.calls.toasts[0].description, /komentarzy|05_farby_i_tasmy.sql/);
    assert.deepEqual(h.calls.exporting, [true, false]);
    assert.equal(h.context.exportBusy.current, false);
  }
});

test('inventory history reads all measurement pages for export, not only the first thousand', async () => {
  const file = resolve(root, 'app/api/app/route.ts');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let block;
  const visit = node => {
    if (ts.isCaseClause(node) && node.expression.getText(source) === "'getPaintTapeInventory'" && node.statements.length === 1 && ts.isBlock(node.statements[0])) block = node.statements[0].getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(block);
  const rawEntries = Array.from({ length: 1205 }, (_, i) => ({ id: String(i), qty: i }));
  const pages = [];
  class Query {
    constructor(table) { this.table = table; }
    select() { return this; } eq() { return this; } order() { return this; } limit() { return this; }
    range(start, end) { this.page = [start, end]; pages.push(this.page); return this; }
    async maybeSingle() { return { data: { id: 'session', status: 'OPEN' }, error: null }; }
    then(a, b) { return Promise.resolve({ data: this.table === 'paint_tape_inventory_entries' ? rawEntries.slice(this.page[0], this.page[1] + 1) : [], error: null }).then(a, b); }
  }
  const context = {
    exports: {}, payload: { dateKey: date }, supabaseAdmin: { from: table => new Query(table) },
    ensurePaintTapeInventorySeeded: async () => {}, scheduleOriginalErpHistoryPurge() {},
    mapPaintTapeInventoryCatalogItem: row => row, mapPaintTapeInventorySession: row => row, mapPaintTapeInventoryEntry: row => row,
    isMissingPaintTapeInventoryTableError: () => false
  };
  vm.runInNewContext(ts.transpileModule(`exports.run = async () => ${block};`, { compilerOptions }).outputText, context);
  const result = await context.exports.run();
  assert.equal(result.entries.length, 1205);
  assert.deepEqual(pages, [[0, 999], [1000, 1999]]);
  assert.equal(result.entries.at(-1).id, '1204');
});
