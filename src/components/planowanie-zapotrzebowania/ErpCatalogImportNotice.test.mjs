import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const source = readFileSync(new URL('./SpisRzeczywisty.tsx', import.meta.url), 'utf8');
const compile = (code) => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const noticeModule = { exports: {} };
vm.runInNewContext(compile(readFileSync(new URL('./ErpCatalogImportNotice.tsx', import.meta.url), 'utf8')), { module: noticeModule, exports: noticeModule.exports, require });
const { ErpCatalogImportNotice } = noticeModule.exports;
const result = { added: 5, existing: 200, failed: false, warningCount: 0, warnings: [] };
const render = (overrides = {}) => renderToStaticMarkup(React.createElement(ErpCatalogImportNotice, { result: { ...result, ...overrides }, date: '2026-09-28' }));

test('successful import has a compact permanent-catalog count and no blocking alert', () => {
  const html = render();
  assert.match(html, /Stany ERP wgrane \(2026-09-28\)/);
  assert.match(html, /Nowe kartoteki zapisane na stałe: 5/);
  assert.doesNotMatch(html, /<details|role="alert"|<dialog/);
});

test('catalog issues are initially collapsed, clearly separate from successful stock import and safely escaped', () => {
  const html = render({ warningCount: 2, warnings: [{ name: '<script>name</script>', indexCode: '123', reason: 'Brak jednostki' }], failed: true });
  assert.match(html, /Uwagi do kartotek: 2 — import stanów zakończony/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<details[^>]* open|<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Pokazano pierwsze 1 uwag z 2/);
});

test('actual import handler invalidates catalog suggestions and shows warnings without treating stock as failed', async () => {
  const ast = ts.createSourceFile('SpisRzeczywisty.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleErpSnapshotImport') declaration = node.getText(ast); ts.forEachChild(node, visit); };
  visit(ast);
  assert.ok(declaration);
  const invalidated = [];
  const toasts = [];
  let summary;
  let resetCount = 0;
  const mod = { exports: {} };
  const catalogSync = { ...result, failed: true, warningCount: 1, warnings: [{ name: '', indexCode: '', reason: 'Problem kartoteki' }] };
  vm.runInNewContext(compile(`const ${declaration}; module.exports = handleErpSnapshotImport;`), {
    module: mod, readOnly: false, spisDate: '2026-09-28', erpSnapshotImportFile: {},
    importErpSnapshotMutation: { mutateAsync: async () => ({ inserted: 500, replaced: 490, snapshotDate: '2026-09-28', catalogSync }) },
    queryClient: { invalidateQueries: ({ queryKey }) => invalidated.push([...queryKey]) },
    resetErpSnapshotImportState: () => { resetCount++; },
    setLastErpCatalogSync: (value) => { summary = value; }, toast: (value) => toasts.push(value)
  });
  await mod.exports();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].tone, 'success');
  assert.equal(toasts[0].title, 'Wgrano stany ERP');
  assert.match(toasts[0].description, /Uwagi do kartotek/);
  assert.equal(summary.result, catalogSync);
  assert.equal(resetCount, 1);
  assert.deepEqual(invalidated, [
    ['spis-oryginalow-erp-snapshot', '2026-09-28'],
    ['spis-oryginalow-catalog-local'], ['spis-oryginalow-catalog-search']
  ]);
});

test('browser API forwards import freshness token to later searches and catalog reads', async () => {
  const apiPath = new URL('../../lib/api/index.ts', import.meta.url);
  const requests = [];
  const mod = { exports: {} };
  const token = 'e47d8d87-0c1a-4d4e-9bba-123456789abc';
  vm.runInNewContext(compile(readFileSync(apiPath, 'utf8')), {
    module: mod, exports: mod.exports, FormData, File,
    require: (name) => name.startsWith('.') ? require(fileURLToPath(new URL(`${name}.ts`, apiPath))) : require(name),
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify(url.includes('snapshot/import') ? { catalogRefreshToken: token } : []), { status: 200 });
    }
  }, { filename: fileURLToPath(apiPath) });
  await mod.exports.importOriginalInventoryErpSnapshotFile(new File(['fixture'], 'stock.xlsx'), '2026-09-28');
  await mod.exports.searchOriginalInventoryCatalog('metal box');
  await mod.exports.getOriginalInventoryCatalog();
  assert.equal(requests.length, 3);
  for (const request of requests.slice(1)) assert.equal(JSON.parse(request.options.body).payload.catalogRefreshToken, token);
});
