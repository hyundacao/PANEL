import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { FIXED_INVENTORY_DEVICE_SOURCE_TYPE } from './fixedInventoryDevices.ts';
import { buildProductCatalogChoices } from './productCatalogSearch.ts';
import { getOriginalInventorySpisIndex2 } from '../utils/originalInventorySpisSearch.ts';
import { linkOriginalInventoryM10Indices } from '../utils/originalInventoryM10Indices.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const text = readFileSync(new URL('../../app/api/planowanie-zapotrzebowania/route.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('route.ts', text, ts.ScriptTarget.Latest, true);
const names = new Set(['PRODUCT_CATALOG_PAGE_SIZE', 'PRODUCT_CATALOG_PAGE_CONCURRENCY', 'normalizeName', 'warsawDateKey',
  'queryProductCatalogRows', 'queryProductCatalog', 'inventoryAreaId', 'queryOriginalInventoryEntries', 'loadOriginalInventory']);
const definitions = [];
for (const statement of ast.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name) && names.delete(declaration.name.text)) definitions.push(`const ${declaration.getText(ast)};`);
  }
}
if (names.size) throw new Error(`Missing original inventory definitions: ${[...names].join(', ')}`);
const compiled = ts.transpileModule(definitions.join('\n') + '\nexports.loadOriginalInventory = loadOriginalInventory; exports.queryProductCatalog = queryProductCatalog;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;

export function createOriginalInventoryFixture(supabaseAdmin) {
  const context = { supabaseAdmin, FIXED_INVENTORY_DEVICE_SOURCE_TYPE, buildProductCatalogChoices, getOriginalInventorySpisIndex2, linkOriginalInventoryM10Indices, exports: {} };
  vm.runInNewContext(compiled, context);
  return {
    load: async date => structuredClone(await context.exports.loadOriginalInventory(date)),
    catalog: async () => structuredClone(await context.exports.queryProductCatalog())
  };
}
