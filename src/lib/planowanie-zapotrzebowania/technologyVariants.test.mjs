import assert from 'node:assert/strict';
import test from 'node:test';
import { promoteTechnologyToBase, renameTechnologyProduct } from './technologyVariants.ts';
import { rebaseSharedPlanningChanges } from './stateScopes.ts';

const technology = (id, variant, alternativeNo, patch = {}) => ({
  id, productIndex: 'M-10-8001128928', productName: 'CPB NOT PRINTED BO VZF07020', variant, alternativeNo,
  description: variant === 'base' ? '' : `Wariant ${alternativeNo}`, archived: false,
  productionMode: 'planned', shiftNorm: 1250, notes: `Notatka ${id}`,
  materials: [{ id: `${id}-material`, code: `${id}-code`, usage: .125, unit: 'kg' }],
  linkedProducts: [{ id: `${id}-link`, productIndex: 'PART', usage: 1 }],
  surplusMaterials: [{ id: `${id}-box`, usage: .01 }], ...patch
});
const library = () => [technology('base', 'base', 0), technology('alt-1', 'alternative', 1),
  technology('alt-2', 'alternative', 2, { description: 'Turcja + NOVODUR' }), technology('alt-3', 'alternative', 3),
  technology('archived', 'alternative', 4, { archived: true }), technology('other', 'base', 0, { productIndex: 'OTHER' })];
const sameProduct = (left, right) => left.productIndex === right.productIndex;
const promote = (items, id = 'alt-2', description = 'Poprzednia bazowa', baseId = 'base') =>
  promoteTechnologyToBase(items, id, description, sameProduct, baseId);

const rename = (items, edited, source = items[0]) => renameTechnologyProduct(
  items, edited, source, sameProduct, link => link.productIndex.toLowerCase()
);

test('header rename preserves all variant IDs, roles, quantities and archived variants', () => {
  const items = library();
  const before = structuredClone(items);
  const renamed = rename(items, { ...items[0], productIndex: ' NEW-001 ', productName: ' New name ' });
  for (let index = 0; index < items.length - 1; index++) {
    assert.deepEqual(renamed[index], { ...items[index], productIndex: 'NEW-001', productName: 'New name' });
    for (const field of ['materials', 'linkedProducts', 'surplusMaterials']) assert.equal(renamed[index][field], items[index][field]);
  }
  assert.equal(renamed.at(-1), items.at(-1));
  assert.deepEqual(items, before);
});

test('header rename retargets only exact semi-finished references and preserves their source keys', () => {
  const source = technology('source', 'base', 0);
  const link = { id: 'link', productIndex: source.productIndex, productName: source.productName, usage: 2, unit: 'szt.', sourcePolicy: 'production' };
  const unrelated = { ...link, id: 'unrelated', productIndex: 'DIFFERENT' };
  const parent = technology('parent', 'base', 0, { productIndex: 'PARENT', linkedProducts: [link, unrelated] });
  const renamed = rename([source, parent], { ...source, productIndex: 'NEW', productName: 'New name' });
  assert.deepEqual(renamed[1].linkedProducts[0], { ...link, productIndex: 'NEW', productName: 'New name', sourceKeys: [link.productIndex.toLowerCase()] });
  assert.equal(renamed[1].linkedProducts[1], unrelated);
  assert.equal(renamed[1].materials, parent.materials);
  const repeated = rename(renamed, { ...renamed[0], productIndex: 'NEXT', productName: 'Next name' });
  assert.deepEqual(repeated[1].linkedProducts[0].sourceKeys, [link.productIndex.toLowerCase(), 'new']);
});

test('rename rejects occupied, missing, empty and concurrently changed identities without mutation', () => {
  const items = library();
  const before = structuredClone(items);
  assert.throws(() => rename(items, { ...items[0], productIndex: 'OTHER' }), /TECHNOLOGY_PRODUCT_CONFLICT/);
  assert.throws(() => rename(items, { ...items[0], id: 'missing' }), /TECHNOLOGY_NOT_FOUND/);
  assert.throws(() => rename(items, { ...items[0], productIndex: ' ' }), /TECHNOLOGY_PRODUCT_REQUIRED/);
  assert.throws(() => rename(items, { ...items[0], productName: ' ' }), /TECHNOLOGY_PRODUCT_REQUIRED/);
  assert.throws(() => rename(items, { ...items[0], productIndex: 'NEW' }, { ...items[0], productName: 'Stale' }), /TECHNOLOGY_PRODUCT_CHANGED/);
  assert.deepEqual(items, before);
});

test('renaming just the label keeps the recipe and selection IDs intact', () => {
  const items = library();
  const renamed = rename(items, { ...items[2], productName: 'Updated ERP name' }, items[2]);
  assert.deepEqual(renamed.map(item => item.id), items.map(item => item.id));
  assert.equal(renamed[2].description, 'Turcja + NOVODUR');
  assert.equal(renamed[2].materials, items[2].materials);
  assert.equal(renamed[0].productName, 'Updated ERP name');
});

test('promotion atomically swaps roles and reuses the former alternative number', () => {
  const items = library();
  const before = structuredClone(items);
  const result = promote(items);
  assert.equal(result.promoted.id, 'alt-2');
  assert.equal(result.promoted.variant, 'base');
  assert.equal(result.promoted.alternativeNo, 0);
  assert.equal(result.promoted.description, '');
  assert.equal(result.demoted.id, 'base');
  assert.equal(result.demoted.variant, 'alternative');
  assert.equal(result.demoted.alternativeNo, 2);
  assert.equal(result.demoted.description, 'Poprzednia bazowa');
  assert.equal(result.technologies.filter(item => sameProduct(item, items[0]) && !item.archived && item.variant === 'base').length, 1);
  assert.deepEqual(result.technologies.map(item => item.id), items.map(item => item.id));
  assert.deepEqual(items, before);
  for (const previous of items) {
    const next = result.technologies.find(item => item.id === previous.id);
    for (const field of ['materials', 'linkedProducts', 'surplusMaterials', 'shiftNorm', 'productionMode', 'notes', 'productIndex', 'productName', 'archived']) {
      assert.equal(next[field], previous[field], `${previous.id}: ${field}`);
    }
    if (!['base', 'alt-2'].includes(previous.id)) assert.equal(next, previous);
  }
});

test('existing plan and document references still point to the same recipes after promotion', () => {
  const items = library();
  const state = { technologies: items, plan: [{ technologyId: 'base' }, { technologyId: 'alt-2' }],
    documents: [{ id: 'document', rows: [{ technologyId: 'base', qty: 250 }] }], dailyPlans: { '2026-11-01': [{ technologyId: 'alt-2' }] }, archive: [{ technologyId: 'base' }] };
  const next = { ...state, technologies: promote(state.technologies).technologies };
  for (const field of ['plan', 'documents', 'dailyPlans', 'archive']) assert.equal(next[field], state[field]);
  for (const row of next.plan) assert.equal(next.technologies.find(item => item.id === row.technologyId).materials,
    items.find(item => item.id === row.technologyId).materials);
});

test('roles can be swapped back without changing IDs or recipes', () => {
  const items = library();
  const first = promote(items);
  const second = promoteTechnologyToBase(first.technologies, 'base', 'Turcja + NOVODUR', sameProduct, 'alt-2');
  assert.deepEqual(second.technologies, items);
});

test('invalid, archived, missing and ambiguous variants are rejected without mutation', () => {
  const items = library();
  const before = structuredClone(items);
  for (const id of ['missing', 'base', 'archived']) assert.throws(() => promote(items, id), /TECHNOLOGY_ALTERNATIVE_REQUIRED/);
  assert.throws(() => promote(items, 'alt-2', ' '), /TECHNOLOGY_ALTERNATIVE_DESCRIPTION_REQUIRED/);
  assert.throws(() => promote(items, 'alt-2', 'Nazwa', 'changed-base'), /TECHNOLOGY_BASE_CHANGED/);
  assert.throws(() => promote(items.filter(item => item.id !== 'base')), /TECHNOLOGY_BASE_AMBIGUOUS/);
  assert.throws(() => promote([...items, technology('duplicate-base', 'base', 0)]), /TECHNOLOGY_BASE_AMBIGUOUS/);
  assert.deepEqual(items, before);
});

test('invalid or already occupied alternative numbers do not create a duplicate slot', () => {
  for (const alternativeNo of [0, -1, 1, NaN, 1.5]) {
    const items = library().map(item => item.id === 'alt-2' ? { ...item, alternativeNo } : item);
    const result = promote(items);
    assert.equal(result.demoted.alternativeNo, 5);
    assert.equal(result.technologies.filter(item => item.variant === 'alternative' && item.alternativeNo === 5).length, 1);
  }
});

test('normal concurrent promotions of different alternatives conflict rather than create two bases', () => {
  const baseline = { technologies: library() };
  const first = { technologies: promote(baseline.technologies, 'alt-1').technologies };
  const second = { technologies: promote(baseline.technologies, 'alt-2').technologies };
  assert.equal(rebaseSharedPlanningChanges(baseline, first, second), null);
});

test('promotion can merge an unrelated concurrent note without losing either role change', () => {
  const baseline = { technologies: library() };
  const local = { technologies: promote(baseline.technologies).technologies };
  const remote = { technologies: baseline.technologies.map(item => item.id === 'other' ? { ...item, notes: 'Nowa uwaga' } : item) };
  const result = rebaseSharedPlanningChanges(baseline, local, remote);
  assert.equal(result.technologies.find(item => item.id === 'alt-2').variant, 'base');
  assert.equal(result.technologies.find(item => item.id === 'base').variant, 'alternative');
  assert.equal(result.technologies.find(item => item.id === 'other').notes, 'Nowa uwaga');
});
