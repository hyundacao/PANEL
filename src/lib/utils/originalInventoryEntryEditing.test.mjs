import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { parseQtyInput } from './format.ts';

const source = readFileSync(new URL('../../components/planowanie-zapotrzebowania/SpisRzeczywisty.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('SpisRzeczywisty.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['updateEditDraft', 'handleEditSave'];
const definitions = new Map();
const visit = node => {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) {
    definitions.set(node.name.getText(ast), `const ${node.getText(ast)};`);
  }
  ts.forEachChild(node, visit);
};
visit(ast);
assert.equal(definitions.size, names.length);
const compiled = ts.transpileModule([...definitions.values()].join('\n') + '\nObject.assign(exports, { updateEditDraft, handleEditSave });', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

const harness = () => {
  const writes = [], messages = [];
  const context = {
    exports: {}, readOnly: false, editDrafts: {}, parseQtyInput,
    entries: [{ id: 'entry-1', qty: 250, warehouseId: 'hall-2', canModify: true }],
    updateMutation: { mutate: payload => writes.push(payload) },
    toast: message => messages.push(message)
  };
  context.setEditDrafts = update => { context.editDrafts = update(context.editDrafts); };
  vm.runInNewContext(compiled, context);
  return { ...context.exports, context, writes, messages };
};

test('changing only the hall retains the recorded quantity and saves both fields', () => {
  const h = harness();
  h.updateEditDraft('entry-1', { warehouseId: 'hall-3' });
  assert.equal(h.context.editDrafts['entry-1'].qty, '250');
  h.handleEditSave('entry-1');
  assert.equal(h.messages.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{ id: 'entry-1', qty: 250, warehouseId: 'hall-3' }]);
});

test('editing quantity first preserves the hall and subsequent hall changes preserve typed quantity', () => {
  const h = harness();
  h.updateEditDraft('entry-1', { qty: '300,5' });
  assert.equal(h.context.editDrafts['entry-1'].warehouseId, 'hall-2');
  h.updateEditDraft('entry-1', { warehouseId: 'hall-1' });
  h.handleEditSave('entry-1');
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{ id: 'entry-1', qty: 300.5, warehouseId: 'hall-1' }]);
});

test('a partial draft from an older client still saves the unchanged recorded quantity', () => {
  const h = harness();
  h.context.editDrafts['entry-1'] = { warehouseId: 'hall-3' };
  h.handleEditSave('entry-1');
  assert.equal(h.writes[0].qty, 250);
  assert.equal(h.writes[0].warehouseId, 'hall-3');
});

test('read-only and foreign entries cannot be changed and an invalid quantity remains rejected', () => {
  const h = harness();
  h.updateEditDraft('entry-1', { warehouseId: 'hall-3' });
  h.context.readOnly = true;
  h.handleEditSave('entry-1');
  h.context.readOnly = false;
  h.context.entries[0].canModify = false;
  h.handleEditSave('entry-1');
  assert.equal(h.writes.length, 0);
  h.context.entries[0].canModify = true;
  h.updateEditDraft('entry-1', { qty: '' });
  h.handleEditSave('entry-1');
  assert.equal(h.writes.length, 0);
  assert.equal(h.messages.length, 1);
});
