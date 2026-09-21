import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { readProductionPlanSheet, readProductionPlanWorkbook } from './productionPlanWorkbook.ts';
import { isToolroomReturnTask, withToolroomReturnTasks } from './productionToolroomTasks.ts';

const makeWorkbook = (bookType = 'xlsx') => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['', 'OTHER SHEET DETAIL', 999, 'WTR 99', 50]
  ]), 'Monday');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['', 'NAZWA INDEKSU', 'ILOSC', 'ST\u00d3\u0141 LUB MASZYNA', 'NORMA'],
    ['', 'CURRENT DETAIL', 300, 'WTR 1', 100],
    ['', 'AWARYJNIE'],
    ['', 'EMERGENCY DETAIL', 200, 'WTR 2', 100],
    ['', 'PLANOWANE ZMIANY FORM'],
    ['01.09', 'PLANNED DETAIL', 150, 'WTR 3', 50]
  ]), 'Tuesday');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Empty');
  return XLSX.write(workbook, { type: 'array', bookType });
};

for (const bookType of ['xlsx', 'biff8']) {
  test(bookType + ': file preparation returns sheet names without loading row data', () => {
    const buffer = makeWorkbook(bookType);
    const source = readProductionPlanWorkbook(buffer, 'plan.' + bookType);
    assert.deepEqual(source.sheetNames, ['Monday', 'Tuesday', 'Empty']);
    assert.deepEqual(Object.keys(source).sort(), ['buffer', 'fileName', 'sheetNames']);
    assert.equal(source.buffer, buffer);
  });

  test(bookType + ': only the explicitly selected sheet is available for import', () => {
    const source = readProductionPlanWorkbook(makeWorkbook(bookType), 'plan.' + bookType);
    const workbook = readProductionPlanSheet(source, 'Tuesday');
    assert.deepEqual(Object.keys(workbook.Sheets), ['Tuesday']);
    assert.deepEqual(workbook.SheetNames, ['Tuesday']);
    assert.equal(workbook.Sheets.Tuesday.B2.v, 'CURRENT DETAIL');
    assert.equal(workbook.Sheets.Monday, undefined);
    assert.equal(workbook.Sheets.Empty, undefined);
  });
}

test('a missing or unknown selection cannot fall back to another worksheet', () => {
  const source = readProductionPlanWorkbook(makeWorkbook(), 'plan.xlsx');
  for (const selection of ['', 'Missing', 'tuesday']) {
    assert.throws(() => readProductionPlanSheet(source, selection), /Wybierz arkusz/);
  }
});

// Exercise the actual page handlers without React, authentication, or database writes.
const pageText = await readFile(new URL('../../app/(main)/przygotowanie-produkcji/page.tsx', import.meta.url), 'utf8');
const page = ts.createSourceFile('page.tsx', pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlerNames = [
  'cellText', 'normalize', 'isManualTask', 'hasYellowFill', 'parseTasks',
  'assignedForTheDay', 'ensureUniqueTaskIds', 'mergeImportedTasks',
  'preparePlanImport', 'cancelPlanImport', 'importSelectedSheet'
];
const declarations = new Map();
const collect = (node) => {
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && handlerNames.includes(declaration.name.text)) {
        declarations.set(declaration.name.text, node.getText(page));
      }
    }
  }
  ts.forEachChild(node, collect);
};
collect(page);
assert.equal(declarations.size, handlerNames.length);
const handlerCode = ts.transpileModule(
  [...declarations.values()].join('\n') + '\nexports.handlers = { preparePlanImport, cancelPlanImport, importSelectedSheet, parseTasks, mergeImportedTasks };',
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
).outputText;

const createHarness = () => {
  const saves = [];
  const cached = [];
  const context = {
    XLSX, Error, readProductionPlanWorkbook, readProductionPlanSheet, isToolroomReturnTask, withToolroomReturnTasks, exports: {},
    RECURRING_TASK_STATION: 'ZADANIE CYKLICZNE',
    loadProductionPlanWorkbookTools: async () => ({ productionPlanXlsx: XLSX, readProductionPlanWorkbook, readProductionPlanSheet }),
    workbookSource: null, selectedSheetName: '', readingWorkbook: false,
    loadingSavedPlan: false, saveState: 'saved', importing: false, importError: null,
    fileName: 'previous.xlsx', sheetName: 'Previous', tasks: [],
    workbookReadVersionRef: { current: 0 },
    planImportInFlightRef: { current: false },
    planImportVersionRef: { current: 0 },
    pendingSaveTotalRef: { current: 0 },
    savePlan: async (...args) => { saves.push(args); return true; },
    saveWorkbookLocally: async (...args) => { cached.push(args); }
  };
  for (const key of [
    'workbookSource', 'selectedSheetName', 'readingWorkbook', 'importError', 'importing',
    'fileName', 'sheetName', 'tasks', 'expandedPlannedTasks'
  ]) {
    context['set' + key[0].toUpperCase() + key.slice(1)] = (value) => { context[key] = value; };
  }
  runInNewContext(handlerCode, context);
  return { context, saves, cached, ...context.exports.handlers };
};

const fileFor = (name = 'new.xlsx', buffer = makeWorkbook()) => ({
  name, arrayBuffer: async () => buffer
});

const coloredWorkbook = async () => {
  const workbook = new ExcelJS.Workbook();
  for (const name of ['Yellow', 'Clear']) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRows([
      ['', 'FIRST DETAIL', 300, 'WTR 41', 460],
      ['', 'PACE SEAT STRUCTURE COOL GREY (Z11111846)', 384, 'WTR 41', 400],
      ['', 'INHERITED STATION DETAIL', 200, '', 400],
      ['', 'GREEN DETAIL', 100, 'WTR 42', 300]
    ]);
    if (name === 'Yellow') sheet.getCell('B2').fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' }
    };
    sheet.getCell('B4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } };
  }
  return readProductionPlanWorkbook(await workbook.xlsx.writeBuffer(), 'colors.xlsx');
};

test('adjacent details on the same or inherited station stay clear without yellow Excel fill', () => {
  const h = createHarness();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['', 'FIRST DETAIL', 300, 'WTR 41', 460],
    ['', 'SECOND DETAIL', 384, 'WTR 41', 400],
    ['', 'THIRD DETAIL', 200, '', 400]
  ]), 'Clear');
  const tasks = h.parseTasks(workbook, 'Clear');
  assert.deepEqual(Array.from(tasks, task => task.station), ['WTR 41', 'WTR 41', 'WTR 41']);
  assert.deepEqual(Array.from(tasks, task => task.highlighted), [false, false, false]);
});

test('only yellow fill from the selected worksheet is imported, never another sheet or green fill', async () => {
  const h = createHarness();
  const source = await coloredWorkbook();
  const yellow = h.parseTasks(readProductionPlanSheet(source, 'Yellow'), 'Yellow');
  const clear = h.parseTasks(readProductionPlanSheet(source, 'Clear'), 'Clear');
  assert.deepEqual(Array.from(yellow, task => task.highlighted), [false, true, false, false]);
  assert.deepEqual(Array.from(clear, task => task.highlighted), [false, false, false, false]);
});

test('reimport replaces saved highlighting in both directions without losing assigned work', async () => {
  const h = createHarness();
  const source = await coloredWorkbook();
  const previous = h.parseTasks(readProductionPlanSheet(source, 'Yellow'), 'Yellow');
  const assigned = previous[1];
  assigned.kinds = ['zmiana-formy'];
  assigned.teams = ['mechanics'];
  assigned.notes = { mechanics: 'Keep this comment' };
  assigned.teamProgress = { mechanics: { done: true, completedBy: 'Operator' } };
  assigned.done = true;
  assigned.material = 'ABS';
  h.context.tasks = previous;
  for (const [sheetName, highlighted] of [['Clear', false], ['Yellow', true], ['Clear', false]]) {
    h.context.workbookSource = source;
    h.context.setSelectedSheetName(sheetName);
    await h.importSelectedSheet();
    const current = h.context.tasks[1];
    assert.equal(current.id, assigned.id);
    assert.equal(current.highlighted, highlighted);
    assert.deepEqual(current.kinds, assigned.kinds);
    assert.deepEqual(current.teams, assigned.teams);
    assert.deepEqual(current.notes, assigned.notes);
    assert.deepEqual(current.teamProgress, assigned.teamProgress);
    assert.equal(current.done, true);
    assert.equal(current.material, 'ABS');
    assert.equal(h.saves.at(-1)[0][1].highlighted, highlighted);
    assert.equal(h.saves.at(-1)[2], sheetName);
    // Restoring the stored payload needs no workbook read and preserves its color.
    const reopened = createHarness();
    reopened.context.tasks = JSON.parse(JSON.stringify(h.saves.at(-1)[0]));
    assert.equal(reopened.context.tasks[1].highlighted, highlighted);
    assert.equal(reopened.saves.length, 0);
  }
});

test('reimport still cancels missing assigned work and restores it when the detail returns', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  const source = h.context.workbookSource;
  const missing = h.parseTasks(readProductionPlanSheet(source, 'Monday'), 'Monday')[0];
  missing.kinds = ['zmiana-formy'];
  missing.teams = ['mechanics'];
  missing.notes = { mechanics: 'Keep missing work' };
  missing.teamProgress = { mechanics: { done: true } };
  h.context.tasks = [missing];
  h.context.setSelectedSheetName('Tuesday');
  await h.importSelectedSheet();
  const cancelled = h.context.tasks.find(task => task.id === missing.id);
  assert.equal(cancelled.isCurrentPlan, false);
  assert.ok(cancelled.kinds.includes('anulowane'));
  assert.deepEqual(cancelled.notes, missing.notes);
  assert.deepEqual(cancelled.teams, missing.teams);
  assert.deepEqual(cancelled.teamProgress, missing.teamProgress);
  h.context.workbookSource = source;
  h.context.setSelectedSheetName('Monday');
  await h.importSelectedSheet();
  const restored = h.context.tasks.find(task => task.id === missing.id);
  assert.equal(restored.isCurrentPlan, true);
  assert.ok(!restored.kinds.includes('anulowane'));
  assert.deepEqual(restored.notes, missing.notes);
  assert.deepEqual(restored.teams, missing.teams);
});

test('reimport still protects manual, recurring and planned work from automatic cancellation', () => {
  const h = createHarness();
  const current = h.parseTasks(readProductionPlanSheet(readProductionPlanWorkbook(makeWorkbook(), 'plan.xlsx'), 'Tuesday'), 'Tuesday')[0];
  const retained = [
    { ...current, id: 'manual', station: 'ZADANIE DODATKOWE' },
    { ...current, id: 'recurring', station: 'ZADANIE CYKLICZNE' },
    { ...current, id: 'planned', planGroup: 'planned' }
  ].map(task => ({ ...task, kinds: ['inne'], teams: ['mechanics'], notes: { mechanics: 'Keep' } }));
  const merged = h.mergeImportedTasks([], retained);
  assert.equal(merged.length, 3);
  for (const task of merged) {
    assert.equal(task.isCurrentPlan, false);
    assert.ok(!task.kinds.includes('anulowane'));
    assert.equal(task.notes.mechanics, 'Keep');
  }
});

test('choosing a file or a sheet never changes or saves the current plan', async () => {
  const h = createHarness();
  const originalTasks = [{ id: 'existing' }];
  h.context.tasks = originalTasks;
  await h.preparePlanImport(fileFor());
  assert.equal(h.context.selectedSheetName, '');
  assert.deepEqual(h.context.workbookSource.sheetNames, ['Monday', 'Tuesday', 'Empty']);
  h.context.setSelectedSheetName('Tuesday');
  assert.equal(h.context.tasks, originalTasks);
  assert.equal(h.context.fileName, 'previous.xlsx');
  assert.equal(h.context.sheetName, 'Previous');
  assert.equal(h.saves.length, 0);
  assert.equal(h.cached.length, 0);
  h.cancelPlanImport();
  assert.equal(h.context.workbookSource, null);
  assert.equal(h.context.selectedSheetName, '');
  assert.equal(h.context.tasks, originalTasks);
  assert.equal(h.saves.length, 0);
});

test('confirmation imports only selected rows and keeps their three plan sections', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  h.context.setSelectedSheetName('Tuesday');
  await h.importSelectedSheet();
  assert.deepEqual(Array.from(h.context.tasks, (task) => task.detail), ['CURRENT DETAIL', 'EMERGENCY DETAIL', 'PLANNED DETAIL']);
  assert.deepEqual(Array.from(h.context.tasks, (task) => task.planGroup), ['standard', 'emergency', 'planned']);
  assert.equal(h.context.tasks[2].material, '01.09');
  assert.equal(h.context.fileName, 'new.xlsx');
  assert.equal(h.context.sheetName, 'Tuesday');
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0][2], 'Tuesday');
  assert.equal(h.cached.length, 1);
  assert.equal(h.context.selectedSheetName, '');
  assert.equal(h.context.importing, false);
  assert.equal(h.context.planImportInFlightRef.current, false);
});

test('reimport preserves assignments but drops unrelated unassigned plan rows', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  const source = h.context.workbookSource;
  const current = h.parseTasks(readProductionPlanSheet(source, 'Tuesday'), 'Tuesday')[0];
  current.kinds = ['rozruch'];
  current.teams = ['process'];
  current.notes = { processAssignee: 'Adam' };
  h.context.tasks = [current, ...h.parseTasks(readProductionPlanSheet(source, 'Monday'), 'Monday')];
  h.context.setSelectedSheetName('Tuesday');
  await h.importSelectedSheet();
  assert.equal(h.context.tasks.length, 3);
  assert.equal(h.context.tasks[0].notes.processAssignee, 'Adam');
  assert.deepEqual(h.context.tasks[0].kinds, ['rozruch']);
});

test('reimport preserves work and comments when a planned form change enters the production plan', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  const planned = h.parseTasks(readProductionPlanSheet(h.context.workbookSource, 'Tuesday'), 'Tuesday')[2];
  planned.kinds = ['zmiana-formy', 'rozruch'];
  planned.teams = ['mechanics', 'process', 'distribution', 'technician'];
  planned.notes = {
    mechanics: 'Przygotować formę przed zmianą.',
    process: 'Sprawdzić parametry po uruchomieniu.',
    processAssignee: 'Adam'
  };
  planned.teamProgress = { mechanics: { done: true, completedBy: 'Kamil' } };
  const previousId = planned.id;
  h.context.tasks = [planned];

  const updatedWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(updatedWorkbook, XLSX.utils.aoa_to_sheet([
    ['', 'NAZWA INDEKSU', 'ILOSC', 'STÓŁ LUB MASZYNA', 'NORMA'],
    ['', 'PLANNED DETAIL', 150, 'WTR 3', 50]
  ]), 'Updated');
  h.context.workbookSource = readProductionPlanWorkbook(
    XLSX.write(updatedWorkbook, { type: 'array', bookType: 'xlsx' }),
    'updated.xlsx'
  );
  h.context.setSelectedSheetName('Updated');
  await h.importSelectedSheet();

  assert.equal(h.context.tasks.length, 1);
  const current = h.context.tasks[0];
  assert.equal(current.id, previousId);
  assert.equal(current.planGroup, 'standard');
  assert.deepEqual(current.kinds, ['zmiana-formy', 'rozruch']);
  assert.deepEqual(current.teams, ['mechanics', 'process', 'distribution', 'technician']);
  assert.equal(current.notes.mechanics, 'Przygotować formę przed zmianą.');
  assert.equal(current.notes.process, 'Sprawdzić parametry po uruchomieniu.');
  assert.equal(current.notes.processAssignee, 'Adam');
  assert.equal(current.teamProgress.mechanics.done, true);
  assert.equal(current.material, '');
});

test('reimport keeps a separate toolroom return with its own notes without duplicating production', async () => {
  const h=createHarness();
  await h.preparePlanImport(fileFor());
  const source=h.context.workbookSource;
  const current=h.parseTasks(readProductionPlanSheet(source,'Tuesday'),'Tuesday')[0];
  current.kinds=['forma-narzedziownia'];current.teams=['mechanics','process'];
  const paired=withToolroomReturnTasks([current]);
  paired[1].notes.mechanics='Własna uwaga do powrotu';
  paired[1].teams=[];
  h.context.tasks=paired;
  for(let i=0;i<2;i++) {
    h.context.workbookSource=source;h.context.setSelectedSheetName('Tuesday');
    await h.importSelectedSheet();
    const tasks=Array.from(h.context.tasks);
    assert.equal(tasks.length,4);
    assert.equal(tasks[0].id,current.id);assert.equal(tasks[1].id,paired[1].id);
    assert.equal(tasks[1].notes.mechanics,'Własna uwaga do powrotu');assert.deepEqual(tasks[1].teams,[]);
    assert.equal(tasks.filter(task=>task.isCurrentPlan).length,3);
    assert.ok(!tasks[1].kinds.includes('anulowane'));
  }
});

test('an empty sheet leaves the existing plan and cached workbook untouched', async () => {
  const h = createHarness();
  const originalTasks = [{ id: 'existing' }];
  h.context.tasks = originalTasks;
  await h.preparePlanImport(fileFor());
  h.context.setSelectedSheetName('Empty');
  await h.importSelectedSheet();
  assert.equal(h.context.tasks, originalTasks);
  assert.equal(h.context.fileName, 'previous.xlsx');
  assert.match(h.context.importError, /nie zawiera pozycji planu/);
  assert.equal(h.saves.length, 0);
  assert.equal(h.cached.length, 0);
  assert.equal(h.context.importing, false);
});

test('a failed save keeps the previous plan and allows retrying the same sheet', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  h.context.tasks = h.parseTasks(readProductionPlanSheet(h.context.workbookSource, 'Monday'), 'Monday');
  const previous = h.context.tasks;
  h.context.setSelectedSheetName('Tuesday');
  h.context.savePlan = async () => false;
  await h.importSelectedSheet();
  assert.equal(h.context.tasks, previous);
  assert.equal(h.context.fileName, 'previous.xlsx');
  assert.equal(h.context.sheetName, 'Previous');
  assert.equal(h.context.selectedSheetName, 'Tuesday');
  assert.equal(h.cached.length, 0);
  assert.equal(h.context.importing, false);
});

test('single-sheet workbooks also require an explicit selection and confirmation', async () => {
  const h = createHarness();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['', 'DETAIL', 10, 'WTR 1', 20]]), 'Only');
  await h.preparePlanImport(fileFor('only.xlsx', XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })));
  await h.importSelectedSheet();
  assert.equal(h.context.selectedSheetName, '');
  assert.equal(h.saves.length, 0);
  h.context.setSelectedSheetName('Only');
  await h.importSelectedSheet();
  assert.equal(h.saves.length, 1);
  assert.equal(h.context.tasks.length, 1);
});

test('late file reads cannot replace a newer file or undo cancellation', async () => {
  const h = createHarness();
  let finishRead;
  const pending = h.preparePlanImport({ name: 'old.xlsx', arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; }) });
  await h.preparePlanImport(fileFor('newer.xlsx'));
  finishRead(makeWorkbook());
  await pending;
  assert.equal(h.context.workbookSource.fileName, 'newer.xlsx');
  const cancelled = h.preparePlanImport({ name: 'cancelled.xlsx', arrayBuffer: () => new Promise((resolve) => { finishRead = resolve; }) });
  h.cancelPlanImport();
  finishRead(makeWorkbook());
  await cancelled;
  assert.equal(h.context.workbookSource, null);
  assert.equal(h.saves.length, 0);
});

test('a duplicate confirmation cannot send two saves', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  h.context.setSelectedSheetName('Tuesday');
  let finishSave;
  let saves = 0;
  h.context.savePlan = () => { saves += 1; return new Promise((resolve) => { finishSave = resolve; }); };
  const importing = h.importSelectedSheet();
  await h.importSelectedSheet();
  assert.equal(saves, 1);
  assert.equal(h.context.planImportInFlightRef.current, true);
  finishSave(true);
  await importing;
  assert.equal(h.context.planImportInFlightRef.current, false);
});

test('file read errors do not change the current plan', async () => {
  const h = createHarness();
  const previous = [{ id: 'existing' }];
  h.context.tasks = previous;
  await h.preparePlanImport({ name: 'broken.xlsx', arrayBuffer: async () => { throw new Error('FILE_READ_FAILED'); } });
  assert.equal(h.context.tasks, previous);
  assert.equal(h.context.fileName, 'previous.xlsx');
  assert.equal(h.context.workbookSource, null);
  assert.equal(h.context.readingWorkbook, false);
  assert.equal(h.context.importError, 'FILE_READ_FAILED');
  assert.equal(h.saves.length, 0);
});

test('pending task changes must finish saving before importing a sheet', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  h.context.setSelectedSheetName('Tuesday');
  h.context.pendingSaveTotalRef.current = 1;
  await h.importSelectedSheet();
  assert.equal(h.saves.length, 0);
  assert.match(h.context.importError, /Poczekaj/);
  h.context.pendingSaveTotalRef.current = 0;
  await h.importSelectedSheet();
  assert.equal(h.saves.length, 1);
});

test('local workbook cache failure does not undo a successful central save', async () => {
  const h = createHarness();
  await h.preparePlanImport(fileFor());
  h.context.setSelectedSheetName('Tuesday');
  h.context.saveWorkbookLocally = async () => { throw new Error('CACHE_UNAVAILABLE'); };
  await h.importSelectedSheet();
  assert.equal(h.saves.length, 1);
  assert.equal(h.context.fileName, 'new.xlsx');
  assert.equal(h.context.sheetName, 'Tuesday');
  assert.equal(h.context.tasks.length, 3);
  assert.match(h.context.importError, /Plan zosta/);
  assert.equal(h.context.importing, false);
});
