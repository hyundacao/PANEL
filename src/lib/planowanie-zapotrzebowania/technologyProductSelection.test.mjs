import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { productCatalogIndexMatches, productCatalogSelectionIndex } from './productCatalogSearch.ts';
import { renameTechnologyProduct } from './technologyVariants.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = ts.createSourceFile('page.tsx', readFileSync(new URL('../../app/(main)/planowanie-zapotrzebowania/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['normalize', 'productIdentityMatches', 'technologyMatchesProduct', 'canonicalProductIndex', 'linkedProductKey', 'linkedSourceSelectionForItem', 'linkedProductMatchesPlanItem', 'technologiesFor', 'linkedProducerCandidates', 'planShiftNormForProduct', 'selectTechnologyEditorProduct', 'saveTechnologyEditor',
  'CATEGORIES', 'normalizedMaterialUnit', 'isKilogramUnit', 'isGramUnit', 'isThousandPiecesUnit', 'technologyUsageForEditor', 'technologyUsageFromEditor', 'technologyMaterialWithUnit', 'inferCategory', 'catalogMaterialPatch', 'selectEditorLink'];
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
    declarations.set(node.name.text, `const ${node.name.text} = ${node.initializer.getText(source)};`);
  }
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule(names.map(name => declarations.get(name)).join('\n') + '\nthis.select = selectTechnologyEditorProduct; this.save = saveTechnologyEditor; this.materialPatch = catalogMaterialPatch; this.selectLink = selectEditorLink; this.variantsFor = technologiesFor; this.producersFor = linkedProducerCandidates; this.sourceFor = linkedSourceSelectionForItem;', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const technology = (index = '', patch = {}) => ({ id: '', productIndex: index, productName: '', variant: 'base', alternativeNo: 0, description: '', notes: '', shiftNorm: 0, productionMode: 'planned', materials: [], linkedProducts: [], surplusMaterials: [], archived: false, ...patch });
const catalogItem = { id: 'paired', name: 'MAINT. DOOR CUBIC INOX DO MONTAZU', index: 'M-10-PWY-BSHL-10595', index2: 'M-10-10595', unit: 'szt.' };
function editor(technologies = [], draft = technology()) {
  const messages = [];
  const context = vm.createContext({
    productCatalogIndexMatches, productCatalogSelectionIndex, renameTechnologyProduct,
    readOnly: false, hydrated: true, state: { technologies, plan: [] }, technologyDraft: draft, technologyEditorCatalogItem: null, editingTechnologyId: '',
    setEditingTechnologyHeader: () => {},
    cloneMaterials: structuredClone, cloneTechnologyForEditor: structuredClone,
    cleanImportedTechnologyDescription: value => value, selectedTechnologyForEditor: (items, id) => items.find(item => item.id === id), uid: () => 'new-technology',
    flash: text => messages.push(text)
  });
  context.setTechnologyDraft = value => { context.technologyDraft = typeof value === 'function' ? value(context.technologyDraft) : value; };
  context.setTechnologyEditorCatalogItem = value => { context.technologyEditorCatalogItem = value; };
  context.setEditingTechnologyId = value => { context.editingTechnologyId = value; };
  context.updateState = updater => { context.state = updater(context.state); };
  context.technologyForItem = item => context.state.technologies.find(row => row.id === item.technologyId);
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

test('editing a saved product from the catalog preserves its recipe, role, norm and notes', () => {
  const saved = technology('OLD', { id: 'saved', productName: 'Old name', variant: 'alternative', alternativeNo: 3,
    description: 'Emergency', notes: 'Keep notes', shiftNorm: 550, materials: [{ id: 'keep', usage: .248 }], linkedProducts: [{ id: 'link', productIndex: 'CHILD' }] });
  const { context } = editor([saved], structuredClone(saved));
  context.editingTechnologyId = saved.id;
  context.select(catalogItem);
  assert.equal(context.technologyDraft.productIndex, catalogItem.index2);
  assert.equal(context.technologyDraft.productName, catalogItem.name);
  for (const key of ['variant', 'alternativeNo', 'description', 'notes', 'shiftNorm', 'materials', 'linkedProducts']) {
    assert.deepEqual(context.technologyDraft[key], saved[key], key);
  }
});

test('saving a changed header renames the whole family without rewriting plans or documents', () => {
  const base = technology('OLD', { id: 'base', productName: 'Old', materials: [{ id: 'raw', usage: .248 }] });
  const alt = technology('OLD', { id: 'alt', productName: 'Old', variant: 'alternative', alternativeNo: 1, description: 'Other material' });
  const { context } = editor([base, alt], { ...structuredClone(alt), productIndex: 'NEW', productName: 'New label' });
  context.editingTechnologyId = alt.id;
  const plan = [{ id: 'plan', index: 'OLD', name: 'Old', technologyId: 'base' }];
  const documents = [{ rows: [{ index: 'OLD', qty: 123 }] }];
  context.state.plan = plan;
  context.state.documents = documents;
  context.save();
  assert.deepEqual(context.state.technologies.map(item => item.productIndex), ['NEW', 'NEW']);
  assert.deepEqual(context.state.technologies.map(item => item.productName), ['New label', 'New label']);
  assert.equal(context.state.plan, plan);
  assert.equal(context.state.documents, documents);
  assert.equal(context.state.technologies[0].materials, base.materials);
  assert.deepEqual(Array.from(context.variantsFor(plan[0]), item => item.id), ['base', 'alt']);
});

test('header rename refuses a different existing product and leaves the library intact', () => {
  const source = technology('OLD', { id: 'source', productName: 'Old' });
  const other = technology(catalogItem.index, { id: 'other', productName: catalogItem.name, archived: true });
  const { context, messages } = editor([source, other], { ...source, productIndex: catalogItem.index2, productName: catalogItem.name });
  context.editingTechnologyId = source.id;
  context.technologyEditorCatalogItem = catalogItem;
  const before = context.state.technologies;
  context.save();
  assert.equal(context.state.technologies, before);
  assert.match(messages.at(-1), /Nie połączono/);
});

test('read-only and not-yet-loaded editors cannot save header changes', () => {
  for (const patch of [{ readOnly: true }, { hydrated: false }]) {
    const source = technology('OLD', { id: 'source', productName: 'Old' });
    const { context } = editor([source], { ...source, productIndex: 'NEW' });
    Object.assign(context, patch, { editingTechnologyId: source.id });
    const before = context.state.technologies;
    context.save();
    assert.equal(context.state.technologies, before);
  }
});

test('renamed semi-finished links retain previous source selections and assigned producers', () => {
  const producer = technology('NEW', { id: 'producer', productName: 'New name' });
  const { context } = editor([producer]);
  const selection = { mode: 'mixed', producerPlanItemId: 'producer-plan', productionQuantity: 0 };
  const link = { id: 'link', productIndex: 'NEW', productName: 'New name', sourceKeys: ['old'], sourcePolicy: 'select' };
  const planItem = { id: 'producer-plan', index: 'OLD', name: 'Old name', included: true, technologyId: producer.id };
  context.state.plan = [planItem];
  assert.equal(context.sourceFor({ linkedSources: { old: selection } }, link), selection);
  assert.deepEqual(Array.from(context.producersFor(link, 'consumer'), item => item.id), [planItem.id]);
  const current = { ...selection, mode: 'warehouse' };
  assert.equal(context.sourceFor({ linkedSources: { old: selection, new: current } }, link), current);
});
