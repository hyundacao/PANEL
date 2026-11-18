import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTechnologyIndexCatalog, normalizeTechnologyMaterialIndices } from './technologyMaterialIndices.ts';

const pair = (indexCode = 'M-1-TW-001', indexCode2 = '000123', name = 'Material') => ({ indexCode, indexCode2, name });
const material = (code = 'M-1-TW-001', name = 'Material', id = 'material') => ({ id, code, name, usage: .248, unit: 'kg', logisticQty: 25, category: 'Tworzywo', note: 'keep' });
const technology = (patch = {}) => ({ id: 'base', productIndex: 'PRODUCT-INDEX1', productName: 'Product', variant: 'base',
  materials: [material()], shiftNorm: 550, notes: 'keep notes', archived: false, ...patch });
const catalog = (items = [pair()], blocked = [], rows = []) => buildTechnologyIndexCatalog({ register: { items, blocked }, rows });
const normalize = (items = [technology()], c = catalog()) => normalizeTechnologyMaterialIndices(items, c);

test('normalizes only the material code, keeping product headers, units, usage, IDs and arbitrary fields', () => {
  const before = [technology()];
  const frozen = structuredClone(before);
  const result = normalize(before);
  assert.deepEqual(result.technologies, [{ ...before[0], materials: [{ ...before[0].materials[0], code: '000123' }] }]);
  assert.deepEqual(before, frozen);
  assert.equal(result.counts.changed, 1);
  assert.deepEqual(result.changedTechnologyIds, ['base']);
  assert.equal(result.findings[0].from, 'M-1-TW-001');
  assert.equal(result.findings[0].to, '000123');
});

test('covers base, alternative, archived, surplus, legacy emergency and linked components', () => {
  const link = { id: 'link', productIndex: 'M-1-TW-001', productName: 'Material', usage: 1, unit: 'szt.', sourcePolicy: 'select' };
  const before = [technology({ surplusMaterials: [material()], emergencyMaterials: [material()], linkedProducts: [link] }),
    technology({ id: 'alternative', variant: 'alternative', archived: true })];
  const result = normalize(before);
  assert.equal(result.counts.changed, 5);
  assert.equal(result.technologies[0].surplusMaterials[0].code, '000123');
  assert.equal(result.technologies[0].emergencyMaterials[0].code, '000123');
  assert.deepEqual(result.technologies[0].linkedProducts[0], { ...link, productIndex: '000123', sourceKeys: ['m-1-tw-001'] });
  assert.equal(result.technologies[1].materials[0].code, '000123');
  assert.equal(result.technologies[1].archived, true);
});

test('linked source keys preserve existing choices and use the planning screen canonical M-10 key', () => {
  const before = technology({ materials: [], linkedProducts: [{ id: 'link', productIndex: 'M-10-PWY-001', productName: 'Material',
    sourceKeys: ['older-source'], usage: 1, unit: 'szt.', sourcePolicy: 'production' }] });
  const result = normalize([before], catalog([pair('M-10-PWY-001', 'M-10-8000001')]));
  assert.deepEqual(result.technologies[0].linkedProducts[0].sourceKeys, ['older-source', 'pwy-001']);
  assert.equal(result.technologies[0].linkedProducts[0].sourcePolicy, 'production');
});

test('manually added components stay without indices even when their names exactly match a catalog entry', () => {
  const before = technology({ materials: [material(''), material('   ', 'Material', 'second')] });
  const result = normalize([before]);
  assert.equal(result.technologies[0], before);
  assert.equal(result.counts['without-index'], 2);
});

test('missing pairs, blocked identifiers and unknown codes are reported without deleting or guessing', () => {
  const before = technology({ materials: [material('NO-SECOND'), material('UNKNOWN', 'Material', 'unknown'), material('BLOCKED', 'Material', 'blocked')] });
  const result = normalize([before], catalog([pair('NO-SECOND', null)], [pair('BLOCKED', 'BLOCKED2')]));
  assert.equal(result.technologies[0], before);
  assert.equal(result.counts['missing-index2'], 1);
  assert.equal(result.counts.unmatched, 1);
  assert.equal(result.counts.blocked, 1);
});

test('the source columns define index roles across all warehouses, including nonnumeric index 2', () => {
  for (const prefix of ['M-1', 'M-4', 'M-10', 'M-11', 'M-51', 'CUSTOM']) {
    const code = `${prefix}-PRIMARY`;
    const second = `${prefix}-SECONDARY-00`;
    const result = normalize([technology({ materials: [material(code)] })], catalog([pair(code, second)]));
    assert.equal(result.technologies[0].materials[0].code, second);
  }
});

test('does not infer index 2 from a suffix, a name, a warehouse or an unconfirmed M-10 alias', () => {
  const result = normalize([technology({ materials: [material('123'), material('M-10-8000001', 'Material', 'm10')] })],
    catalog([pair('M-1-TW-123', '00123'), pair('M-10-PWY-0001', '8000001')]));
  assert.equal(result.counts.unmatched, 2);
  assert.equal(result.counts.changed, 0);
});

test('preserves significant leading zeroes and never converts 123 to catalog 00123', () => {
  const result = normalize([technology({ materials: [material('123')] })], catalog([pair('00123', 'OTHER')]));
  assert.equal(result.counts.unmatched, 1);
});

test('existing index 2 is idempotent and already-correct objects are not rewritten', () => {
  const first = normalize();
  const second = normalize(first.technologies);
  assert.equal(second.counts.changed, 0);
  assert.equal(second.counts['already-index2'], 1);
  assert.equal(second.technologies[0], first.technologies[0]);
  assert.deepEqual(second.technologies, first.technologies);
});

test('one index 1 with conflicting index 2 values stays unchanged', () => {
  const result = normalize(undefined, catalog([pair('M-1-TW-001', '123'), pair('M-1-TW-001', '456')]));
  assert.equal(result.counts.ambiguous, 1);
  assert.equal(result.counts.changed, 0);
});

test('shared target index 530 cannot merge two different cartons even when the source name is exact', () => {
  const pairs = [pair('531', '530', 'KARTON 705X562X540'), pair('M-1-KAR-MAX-1344-00', '530', 'KARTON 525X265X215')];
  const result = normalize([technology({ materials: [material('531', pairs[0].name), material('M-1-KAR-MAX-1344-00', pairs[1].name, 'other')] })], catalog(pairs));
  assert.equal(result.counts.ambiguous, 2);
  assert.equal(result.counts.changed, 0);
  assert.equal(result.findings[0].candidates.length, 2);
});

test('a target that is another material index 1 is also a collision and cannot be converted', () => {
  const result = normalize([technology({ materials: [material('PRIMARY')] })],
    catalog([pair('PRIMARY', 'SECONDARY'), pair('SECONDARY', 'DIFFERENT', 'Other')]));
  assert.equal(result.counts.changed, 0);
  assert.equal(result.counts.ambiguous, 1);
});

test('an existing ambiguous secondary code remains untouched and is flagged, not silently treated as resolved', () => {
  const result = normalize([technology({ materials: [material('530', 'Small carton')] })],
    catalog([pair('BIG', '530', 'Big carton'), pair('SMALL', '530', 'Small carton')]));
  assert.equal(result.counts.ambiguous, 1);
  assert.equal(result.technologies[0].materials[0].code, '530');
});

test('confirmed previous names can disambiguate a code without changing the component name', () => {
  const first = { ...pair('A', 'SHARED', 'Renamed'), previousNames: ['Old name'] };
  const result = normalize([technology({ materials: [material('A', 'Old name')] })], catalog([first]));
  assert.equal(result.technologies[0].materials[0].name, 'Old name');
  assert.equal(result.technologies[0].materials[0].code, 'SHARED');
});

test('register pairs and block list take precedence over stale raw catalog aliases', () => {
  const c = catalog([pair('PRIMARY', '123')], [pair('BLOCKED', '666')], [
    { index_code: 'PRIMARY', index_code2: 'WRONG', name: 'Material' },
    { index_code: '123', index_code2: null, name: 'Material' },
    { index_code: 'BLOCKED', index_code2: '777', name: 'Material' },
    { index_code: 'EXTRA', index_code2: '0099', name: 'Extra' }
  ]);
  assert.equal(c.active.length, 2);
  const result = normalize([technology({ materials: [material('PRIMARY'), material('EXTRA', 'Extra', 'extra'), material('BLOCKED', 'Material', 'blocked')] })], c);
  assert.equal(result.counts.changed, 2);
  assert.equal(result.counts.blocked, 1);
  assert.equal(result.technologies[0].materials[1].code, '0099');
});

test('invalid technology or component structure fails before any write can be prepared', () => {
  assert.throws(() => normalize([technology(), technology()]), /TECHNOLOGY_ID_INVALID/);
  assert.throws(() => normalize([technology({ materials: {} })]), /TECHNOLOGY_COMPONENTS_INVALID/);
  assert.throws(() => normalize([technology({ materials: [{ name: 'bad' }] })]), /TECHNOLOGY_COMPONENT_INVALID/);
  assert.throws(() => normalize([technology({ materials: [{ id: 'bad', name: 'bad' }] })]), /TECHNOLOGY_COMPONENT_IDENTITY_INVALID/);
});

test('only code fields differ in a mixed library, while quantity results remain identical for several production sizes', () => {
  const before = [technology({ materials: [material(), material('', 'Handmade', 'manual'), material('UNKNOWN', 'Unknown', 'unknown')] }),
    technology({ id: 'alt', variant: 'alternative', materials: [material('M-1-TW-001', 'Material', 'other')], surplusMaterials: [material()] })];
  const result = normalize(before);
  for (let i = 0; i < before.length; i++) {
    const restored = structuredClone(result.technologies[i]);
    for (const field of ['materials', 'surplusMaterials', 'emergencyMaterials']) {
      restored[field]?.forEach((m, j) => { m.code = before[i][field][j].code; });
    }
    assert.deepEqual(restored, before[i]);
    for (const qty of [0, 1, 1960, 3300, 5000]) {
      assert.deepEqual(result.technologies[i].materials.map(m => qty * m.usage), before[i].materials.map(m => qty * m.usage));
    }
  }
});
