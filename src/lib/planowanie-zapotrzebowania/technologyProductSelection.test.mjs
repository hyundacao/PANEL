import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { productCatalogIndexMatches, productCatalogSelectionIndex } from './productCatalogSearch.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('../../app/(main)/planowanie-zapotrzebowania/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['normalize', 'productIdentityMatches', 'technologyMatchesProduct', 'planShiftNormForProduct', 'selectTechnologyEditorProduct', 'saveTechnologyEditor',
  'CATEGORIES', 'normalizedMaterialUnit', 'isKilogramUnit', 'isGramUnit', 'isThousandPiecesUnit', 'technologyUsageForEditor', 'technologyUsageFromEditor', 'technologyMaterialWithUnit', 'inferCategory', 'catalogMaterialPatch', 'selectEditorLink'];
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
    declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(source)};`);
  }
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule(names.map(name => declarations.get(name)).join('\n') + '\nthis.select = selectTechnologyEditorProduct; this.save = saveTechnologyEditor; this.materialPatch = catalogMaterialPatch; this.selectLink = selectEditorLink;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const technology = (index = '', patch = {}) => ({ id: '', productIndex: index, productName: '', variant: 'base', alternativeNo: 0, description: '', notes: '', shiftNorm: 0, productionMode: 'planned', materials: [], linkedProducts: [], surplusMaterials: [], archived: false, ...patch });
const catalogItem = { id: 'paired', name: 'MAINT. DOOR CUBIC INOX DO MONTAZU', index: 'M-10-PWY-BSHL-10595', index2: 'M-10-10595', unit: 'szt.' };
function editor(technologies = [], draft = technology()) {
  const messages = [];
  const context = vm.createContext({
    productCatalogIndexMatches, productCatalogSelectionIndex,
    readOnly: false, state: { technologies, plan: [] }, technologyDraft: draft, technologyEditorCatalogItem: null, editingTechnologyId: '',
    cloneMaterials: structuredClone, cloneTechnologyForEditor: structuredClone,
    cleanImportedTechnologyDescription: value => value, selectedTechnologyForEditor: (items, id) => items.find(item => item.id === id), uid: () => 'new-technology',
    flash: text => messages.push(text)
  });
  context.setTechnologyDraft = value => { context.technologyDraft = typeof value === 'function' ? value(context.technologyDraft) : value; };
  context.setTechnologyEditorCatalogItem = value => { context.technologyEditorCatalogItem = value; };
  context.setEditingTechnologyId = value => { context.editingTechnologyId = value; };
  context.updateState = updater => { context.state = updater(context.state); };
  context.editorLinks = [];
  context.updateEditorLinks = updater => { context.editorLinks = updater(context.editorLinks); };
  vm.runInContext(compiled, context);
  return { context, messages };
}

test('technology product selection and save use explicit index 2 without changing the catalog', () => {
  const before = structuredClone(catalogItem);
  const { context } = editor();
  context.select(catalogItem);
  assert.equal(context.technologyDraft.productIndex, 'M-10-10595');
  assert.equal(context.technologyDraft.productName, catalogItem.name);
  context.save();
  assert.equal(context.state.technologies[0].productIndex, 'M-10-10595');
  assert.deepEqual(catalogItem, before);
});

test('existing primary-index base remains recognized after choosing its second index', () => {
  const base = technology(catalogItem.index, { id: 'base', productName: catalogItem.name, shiftNorm: 1250, materials: [{ id: 'material', usage: .1 }] });
  const before = structuredClone(base);
  const { context, messages } = editor([base]);
  context.select(catalogItem);
  assert.equal(context.technologyDraft.productIndex, catalogItem.index2);
  assert.equal(context.technologyDraft.variant, 'alternative');
  assert.equal(context.technologyDraft.alternativeNo, 1);
  assert.equal(context.technologyDraft.shiftNorm, 1250);
  assert.equal(context.technologyDraft.materials[0].usage, .1);
  context.technologyDraft = { ...context.technologyDraft, variant: 'base' };
  context.save();
  assert.equal(context.state.technologies.length, 1);
  assert.match(messages.at(-1), /bazowa ju/);
  assert.deepEqual(base, before);
});

test('choosing the other identifier of the same draft preserves its working recipe', () => {
  const { context } = editor([], technology(catalogItem.index, { productName: catalogItem.name, shiftNorm: 700, materials: [{ id: 'working', usage: .25 }] }));
  context.select(catalogItem);
  assert.equal(context.technologyDraft.productIndex, catalogItem.index2);
  assert.equal(context.technologyDraft.materials[0].id, 'working');
  assert.equal(context.technologyDraft.shiftNorm, 700);
});

test('same names on unrelated indices do not become the selected product', () => {
  const other = technology('OTHER', { id: 'other', productName: catalogItem.name, materials: [{ id: 'unrelated' }] });
  const { context } = editor([other]);
  context.select(catalogItem);
  assert.equal(context.technologyDraft.variant, 'base');
  assert.equal(context.technologyDraft.materials.length, 0);
});

test('missing index 2 keeps the existing index and preserves leading zeros when present', () => {
  const { context } = editor();
  context.select({ ...catalogItem, index2: '' });
  assert.equal(context.technologyDraft.productIndex, catalogItem.index);
  context.select({ ...catalogItem, index2: '0000123' });
  assert.equal(context.technologyDraft.productIndex, '0000123');
});

test('technology materials prefer index 2 in every warehouse without changing usage or packaging', () => {
  const { context } = editor();
  const material = { id: 'material', code: 'OLD', name: 'OLD', category: 'Półwyrób', unit: 'szt.', usage: 1, logisticQty: 24 };
  for (const warehouse of ['M-1', 'M-4', 'M-10', 'M-11', 'M-51']) {
    const selected = { ...catalogItem, index: `${warehouse}-PWY-BSHL-8563`, index2: '8563', warehouseCode: warehouse };
    const result = { ...material, ...context.materialPatch(material, selected) };
    assert.equal(result.code, '8563');
    assert.equal(result.name, selected.name);
    assert.equal(result.usage, 1);
    assert.equal(result.unit, 'szt.');
    assert.equal(result.logisticQty, 24);
  }
  assert.equal(context.materialPatch(material, { ...catalogItem, index2: '' }).code, catalogItem.index);
});

test('index 2 selection keeps existing mass conversion and leading zeros', () => {
  const { context } = editor();
  const material = { id: 'material', code: 'OLD', name: 'OLD', category: 'Tworzywo', unit: 'g', usage: 38, logisticQty: 1 };
  const result = context.materialPatch(material, { ...catalogItem, index2: '0008563', unit: 'kg' });
  assert.equal(result.code, '0008563');
  assert.equal(result.unit, 'kg');
  assert.equal(result.usage, .038);
});

test('linked semi-finished product selection also prefers index 2', () => {
  const { context } = editor();
  context.editorLinks = [{ id: 'link', productIndex: 'OLD', productName: 'OLD', usage: 2, unit: 'szt.', sourcePolicy: 'warehouse' }];
  context.selectLink('link', { ...catalogItem, index2: '8563' });
  assert.equal(context.editorLinks[0].productIndex, '8563');
  assert.equal(context.editorLinks[0].productName, catalogItem.name);
  assert.equal(context.editorLinks[0].usage, 2);
  assert.equal(context.editorLinks[0].sourcePolicy, 'warehouse');
});
