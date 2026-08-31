import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { getRegrindStockWrite } from './regrindStockInput.ts';

test('zero sets the stock to zero instead of appending an empty measurement', () => {
  for (const input of ['0', '0,0', '0.000', '+0', ' 0 ']) {
    assert.deepEqual(getRegrindStockWrite(input), { action: 'upsertEntry', qty: 0 });
  }
});

test('positive measurements are still additive', () => {
  for (const [input, qty] of [['1', 1], ['300', 300], ['30,5', 30.5], ['0.125', 0.125], ['1 000', 1000]]) {
    assert.deepEqual(getRegrindStockWrite(input), { action: 'addInventoryMeasure', qty });
  }
});

test('invalid or negative inputs cannot accidentally clear existing stock', () => {
  for (const input of ['', ' ', '-1', '-0.5', 'abc', '30kg', 'Infinity', 'NaN', '0x0', '1,2,3', '1000000']) {
    assert.equal(getRegrindStockWrite(input), null, input);
  }
});

test('the existing report counts 300 to zero as consumed once, not as a missing count', async () => {
  // Load only the pure reporting functions, without initializing the API database client.
  const sourceText = await readFile(new URL('../../app/api/app/route.ts', import.meta.url), 'utf8');
  const source = ts.createSourceFile('route.ts', sourceText, ts.ScriptTarget.Latest, true);
  const names = new Set(['addComment', 'collectConfirmedDiffs', 'cloneEntryBucket', 'buildPreviousEntriesForStats']);
  const functions = source.statements.filter((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
      && names.has(declaration.name.text)));
  assert.equal(functions.length, names.size);
  const compiled = ts.transpileModule(
    functions.map((statement) => statement.getText(source)).join('\n') + '\nexports.calculate = collectConfirmedDiffs;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  );
  const exports = {};
  runInNewContext(compiled.outputText, { exports });
  const previousDay = '2026-08-30';
  const today = '2026-08-31';
  const nextDay = '2026-09-01';
  const location = { id: 'stock' };
  const materials = new Map([['pp', { name: 'PP' }]]);
  const entries = {
    [previousDay]: { stock: { pp: { qty: 300, confirmed: true } } },
    [today]: { stock: { pp: { qty: 0, confirmed: true } } }
  };
  const result = exports.calculate(today, entries, materials, [location]);
  assert.equal(result.removedTotals.get('PP'), 300);
  assert.equal(result.addedTotals.size, 0);

  const missingCount = exports.calculate(today, { [previousDay]: entries[previousDay] }, materials, [location]);
  assert.equal(missingCount.removedTotals.size, 0);

  entries[nextDay] = { stock: { pp: { qty: 0, confirmed: true } } };
  assert.equal(exports.calculate(nextDay, entries, materials, [location]).removedTotals.size, 0);
});
