import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { QueryClient } = require('@tanstack/react-query');
const source = ts.createSourceFile('panel.tsx', readFileSync(new URL('../../app/(main)/rozliczanie-farb-rozcienczalnikow/PaintTapeInventoryPanel.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declarations = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);
const code = ts.transpileModule(
  ['formatDate', 'removeSessionMutation', 'sessionActionPending', 'handleRemoveSession']
    .map((name) => `const ${declarations.get(name)};`).join('\n') +
    '\nexports.mutation = removeSessionMutation; exports.remove = handleRemoveSession;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }
).outputText;
const day = (id, date, status = 'CLOSED') => ({ id, inventoryDate: date, status, checkedCount: 1, expectedCount: 75 });
const recent = day('recent', '2026-10-20');
const target = day('target', '2026-10-19', 'OPEN');
const old = day('old', '2026-08-21');
const inventory = (session, sessions) => ({
  session, sessions, catalog: [{ id: 'paint', unit: 'kg' }],
  entries: [{ id: `${session.id}-entry`, sessionId: session.id, qty: 1.52 }],
  comparison: { inventoryDate: session.inventoryDate, rows: [{ physicalQty: 1.52, erp: { realQty: 1.3, unit: 'kg' } }] }
});

function setup(options = {}) {
  const historySessions = options.sessions ?? [recent, target, old];
  const queryClient = new QueryClient();
  for (const session of historySessions) queryClient.setQueryData(['paint-tape-inventory', session.inventoryDate], inventory(session, historySessions));
  const state = { date: target.inventoryDate, history: historySessions, drafts: { '2026-10-19:paint': { qty: '3' }, '2026-10-20:paint': { qty: '5' } }, edits: { 'target-entry': '2' }, expanded: new Set(['paint']) };
  const calls = [], confirmations = [], toasts = [];
  const idle = { isPending: false };
  const context = {
    exports: {}, queryClient, historySessions, today: '2026-10-22', user: { id: 'test' },
    session: target, selectedDate: target.inventoryDate, checkedItemCount: 1, entries: [{ id: 'target-entry' }],
    canRemoveSessions: true, exporting: false, inventoryQuery: { isSuccess: true, isFetching: false },
    closeMutation: idle, reopenMutation: idle, saveMutation: idle, updateEntryMutation: idle, removeEntryMutation: idle,
    removePaintTapeInventorySession() {},
    useMutation: (config) => ({ ...config, isPending: options.pending ?? false, mutate: (id) => calls.push(id) }),
    setLastHistorySessions: (sessions) => { state.history = sessions; },
    setSelectedDate: (updater) => { state.date = updater(state.date); },
    setDrafts: (updater) => { state.drafts = updater(state.drafts); },
    setEntryEditDrafts: (edits) => { state.edits = edits; },
    setExpandedItems: (expanded) => { state.expanded = expanded; },
    toast: (message) => toasts.push(message),
    window: { confirm: (message) => { confirmations.push(message); return options.confirm ?? true; } },
    ...options.context
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, context, state, calls, confirmations, toasts, queryClient };
}

test('deleting a history count requires confirmation with its date, counts and permanent consequences', () => {
  const cancelled = setup({ confirm: false });
  cancelled.remove();
  assert.equal(cancelled.confirmations.length, 1);
  assert.match(cancelled.confirmations[0], /19\.10\.2026/);
  assert.match(cancelled.confirmations[0], /pozycje: 1, pomiary: 1/);
  assert.match(cancelled.confirmations[0], /nie mo\u017cna cofn\u0105\u0107/);
  assert.deepEqual(cancelled.calls, []);
  const accepted = setup();
  accepted.remove();
  assert.deepEqual(accepted.calls, ['target']);
});

test('unauthorized, loading, stale, exporting and pending states cannot delete a count', () => {
  for (const context of [
    { canRemoveSessions: false }, { session: null }, { selectedDate: recent.inventoryDate },
    { inventoryQuery: { isSuccess: false, isFetching: false } },
    { inventoryQuery: { isSuccess: true, isFetching: true } },
    { exporting: true }, { saveMutation: { isPending: true } },
    { updateEntryMutation: { isPending: true } }, { removeEntryMutation: { isPending: true } },
    { closeMutation: { isPending: true } }, { reopenMutation: { isPending: true } }
  ]) {
    const result = setup({ context });
    result.remove();
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.confirmations, []);
  }
  const pending = setup({ pending: true });
  pending.remove();
  assert.deepEqual(pending.calls, []);
});

test('successful deletion clears only that day from every cached history and selects another count', async () => {
  const result = setup();
  const original = structuredClone(result.queryClient.getQueryData(['paint-tape-inventory', recent.inventoryDate]));
  await result.mutation.onSuccess({ id: target.id, inventoryDate: target.inventoryDate });
  for (const session of [recent, target, old]) {
    assert.deepEqual(result.queryClient.getQueryData(['paint-tape-inventory', session.inventoryDate]).sessions.map(s => s.id), ['recent', 'old']);
  }
  const deleted = result.queryClient.getQueryData(['paint-tape-inventory', target.inventoryDate]);
  assert.equal(deleted.session, null);
  assert.equal(deleted.entries.length, 0);
  assert.equal(deleted.comparison, null);
  const remaining = result.queryClient.getQueryData(['paint-tape-inventory', recent.inventoryDate]);
  assert.deepEqual(remaining.catalog, original.catalog);
  assert.deepEqual(remaining.entries, original.entries);
  assert.deepEqual(remaining.comparison, original.comparison);
  assert.equal(result.state.date, recent.inventoryDate);
  assert.deepEqual(result.state.history.map(s => s.id), ['recent', 'old']);
  assert.equal(JSON.stringify(result.state.drafts), JSON.stringify({ '2026-10-20:paint': { qty: '5' } }));
  assert.equal(result.toasts[0].tone, 'success');
});

test('deleting the last count leaves an empty history with no stale measurements', async () => {
  const result = setup({ sessions: [target] });
  await result.mutation.onSuccess({ id: target.id, inventoryDate: target.inventoryDate });
  assert.equal(result.state.date, '2026-10-22');
  assert.equal(result.state.history.length, 0);
  assert.equal(result.queryClient.getQueryData(['paint-tape-inventory', target.inventoryDate]).entries.length, 0);
});

test('a failed deletion leaves history, measurements and selection untouched', () => {
  const result = setup();
  const before = JSON.stringify(result.queryClient.getQueryData(['paint-tape-inventory', target.inventoryDate]));
  result.mutation.onError(new Error('NETWORK_ERROR'));
  assert.equal(JSON.stringify(result.queryClient.getQueryData(['paint-tape-inventory', target.inventoryDate])), before);
  assert.equal(result.state.date, target.inventoryDate);
  assert.equal(result.state.history.length, 3);
  assert.equal(result.toasts[0].tone, 'error');
});

const extractDeclaration = (path, name) => {
  const ast = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let declaration;
  const find = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) declaration = node.getText(ast);
    ts.forEachChild(node, find);
  };
  find(ast);
  assert.ok(declaration, `${name} is present in ${path}`);
  return `const ${declaration};`;
};
const permissionsSource = [
  extractDeclaration('../auth/access.ts', 'isHeadAdmin'),
  extractDeclaration('../auth/access.ts', 'isWarehouseAdmin'),
  extractDeclaration('../../app/api/app/route.ts', 'requireWarehouseAdminAccess'),
  extractDeclaration('../../app/api/app/route.ts', 'ensureActionAccess'),
  `const canRemoveInHistory = (user, readOnly = false) => { const ${declarations.get('canRemoveSessions')}; return canRemoveSessions; };`,
  `const canRemoveInManagement = (user) => { ${extractDeclaration('../../app/(main)/spis-farb-tasm/zarzadzanie/page.tsx', 'canRemoveSessions')} return canRemoveSessions; };`,
  'exports.check = ensureActionAccess; exports.history = canRemoveInHistory; exports.management = canRemoveInManagement;'
].join('\n');
const permissions = { exports: {} };
vm.runInNewContext(ts.transpileModule(permissionsSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, permissions);
const userWithRole = (role, warehouses = {}) => ({ role, access: { admin: true, warehouses } });

test('only HEAD_ADMIN can delete counts through the API and both UI entry points', () => {
  const headAdmin = userWithRole('HEAD_ADMIN');
  assert.doesNotThrow(() => permissions.exports.check('removePaintTapeInventorySession', headAdmin, {}));
  assert.equal(permissions.exports.history(headAdmin), true);
  assert.equal(permissions.exports.management(headAdmin), true);
  assert.equal(permissions.exports.history(headAdmin, true), false);
  for (const user of [
    userWithRole('ADMIN', { FARBY_TASMY: { admin: true } }),
    userWithRole('ADMIN', { PRZEMIALY: { admin: true } }),
    userWithRole('ADMIN'), userWithRole('USER'), userWithRole('VIEWER')
  ]) {
    assert.throws(() => permissions.exports.check('removePaintTapeInventorySession', user, {}), /FORBIDDEN/);
    assert.equal(permissions.exports.history(user), false);
    assert.equal(permissions.exports.management(user), false);
  }
});

test('module administrators keep their existing catalog and inventory management permissions', () => {
  for (const user of [
    userWithRole('ADMIN', { FARBY_TASMY: { admin: true } }),
    userWithRole('ADMIN', { PRZEMIALY: { admin: true } })
  ]) {
    for (const action of ['getPaintTapeInventoryCatalogAdmin', 'getPaintTapeInventorySessionsAdmin', 'setPaintTapeInventoryCatalogItemActive']) {
      assert.doesNotThrow(() => permissions.exports.check(action, user, {}));
    }
  }
});
