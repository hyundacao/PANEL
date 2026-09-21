import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Module, createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as reference from './productionTaskReference.ts';
import { splitPlanningRowOutputs } from '../planowanie-zapotrzebowania/planImport.ts';

const detail = 'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010), QUICKLIFT DORIS RIGHT ASSEMBLY (D0159752_010) (A18192709, A18192710)';
const resin = { code: 'R1', name: 'TWORZYWO NATURALNE', category: 'Tworzywo', usage: 0.1, unit: 'kg' };
const color = { code: 'B1', name: 'BARWNIK CZARNY', category: 'Barwnik', usage: 0.002, unit: 'kg' };
const leftBox = { code: 'C1', name: 'KARTON LEWY 600X400X300', category: 'Karton', usage: 0.01, unit: 'szt.' };
const rightBox = { code: 'C2', name: 'KARTON PRAWY 700X400X300', category: 'Karton', usage: 0.01, unit: 'szt.' };
const tech = (id, index, name, materials, extra = {}) => ({ id, productIndex: index, productName: name, variant: 'base', materials, linkedProducts: [], surplusMaterials: [], emergencyMaterials: [], ...extra });
const library = [
  tech('left-base', 'A18192709', 'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010)', [{ ...resin, code: 'OTHER', name: 'NIEWYBRANE TWORZYWO' }]),
  tech('left-alt', 'A18192709', 'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010)', [resin, color, leftBox], { variant: 'alternative', alternativeNo: 1 }),
  tech('right-base', 'A18192710', 'QUICKLIFT DORIS RIGHT ASSEMBLY (D0159752_010)', [{ ...resin, usage: 0.25 }, color, rightBox]),
  tech('drawing-decoy', 'D0159752_010', 'NIE WYBIERAJ KODU RYSUNKU', [{ ...resin, code: 'WRONG' }])
];
const selection = (index, technologyId, extra = {}) => ({ index, technologyId, station: 'WTR 34', areaId: 'hala-2', changedAt: '2026-09-21T08:00:00.000Z', ...extra });
const choices = [selection('A18192709', 'left-alt'), selection('A18192710', 'right-base', { changedAt: '2026-09-21T09:00:00.000Z' })];
const resolve = (selected = choices, technologies = library, text = detail) => reference.buildSelectedTaskTechnologyReference(text, 'WTR 34', 'hala-2', technologies, selected);

test('screenshot row splits into the same two product outputs as demand planning, not drawing codes', () => {
  const expected = splitPlanningRowOutputs({ name: detail, index: '', sourceQuantity: '7 776, 7 776', quantityStatus: 'parsed', totalQty: 15552, station: 'WTR 34', norm: 1485, notes: '', planGroup: 'standard', plannedDate: '' });
  assert.deepEqual(reference.taskTechnologyProducts(detail), expected.map(({ index, name }) => ({ index, name })));
  assert.deepEqual(reference.taskTechnologyProducts('- WTR 34 ' + detail), reference.taskTechnologyProducts(detail));
});

test('each output resolves its own chosen version; the newer right choice does not hide the left', () => {
  const result = resolve();
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.items.map(item => item.id), ['left-alt', 'right-base']);
  assert.equal(result.items[0].label, 'Awaryjna 1');
  assert.equal(result.items[1].label, 'Bazowa');
  assert.equal(result.items.some(item => item.id === 'drawing-decoy'), false);
});

test('legacy blanks cannot hide either output of a shared mould or duplicate common materials', () => {
  const selected = choices.map(item => ({ ...item, changedAt: '' }));
  const blanks = selected.map(item => ({ ...item, technologyId: '', workingMaterials: [], manualOverride: false }));
  for (const rows of [[...blanks, ...selected], [...selected, ...blanks]]) {
    const result = resolve(rows);
    assert.equal(result.status, 'matched');
    assert.deepEqual(result.items.map(item => item.id), ['left-alt', 'right-base']);
    assert.deepEqual(reference.buildTaskPreparationList(result.items).map(item => item.code), ['R1', 'B1', 'C1', 'C2']);
  }
});

test('combined outputs also accept exact alphabetic catalogue indexes without treating qualifiers as indexes', () => {
  const library = [tech('left', 'DCD-GP-GS', 'LEFT (MUCELL)', [resin]), tech('right', 'DCD-GP-PL', 'RIGHT (WHITE)', [color])];
  const selected = [selection('DCD-GP-GS', 'left'), selection('DCD-GP-PL', 'right')];
  for (const detail of ['LEFT (MUCELL), RIGHT (WHITE) (DCD-GP-GS, DCD-GP-PL)', 'LEFT (MUCELL) (DCD-GP-GS), RIGHT (WHITE) (DCD-GP-PL)']) {
    const result = reference.buildSelectedTaskTechnologyReference(detail, 'WTR 34', 'hala-2', library, selected);
    assert.equal(result.status, 'matched');
    assert.deepEqual(result.items.map(item => item.id), ['left', 'right']);
  }
});

test('resin and color appear once despite different usage; differing boxes keep product attribution', () => {
  const rows = reference.buildTaskPreparationList(resolve().items);
  assert.deepEqual(rows.map(row => row.code), ['R1', 'B1', 'C1', 'C2']);
  assert.deepEqual(rows[0].products.map(item => item.index), ['A18192709', 'A18192710']);
  assert.deepEqual(rows[1].products.map(item => item.index), ['A18192709', 'A18192710']);
  assert.deepEqual(rows[2].products.map(item => item.index), ['A18192709']);
  assert.deepEqual(rows[3].products.map(item => item.index), ['A18192710']);
  assert.ok(rows.every(row => !('usage' in row) && !('quantity' in row)));
});

test('working recipe overrides participate in the common list without reviving unused base materials', () => {
  const result = resolve([{ ...choices[0], manualOverride: true, workingMaterials: [color, leftBox] }, choices[1]]);
  const rows = reference.buildTaskPreparationList(result.items);
  assert.equal(rows.find(row => row.code === 'R1').products.length, 1);
  assert.equal(rows.find(row => row.code === 'B1').products.length, 2);
  assert.equal(rows.some(row => row.code === 'OTHER'), false);
});

test('explicit unknown second index produces an incomplete preview, not a silently complete left-only list', () => {
  const result = resolve(choices.filter(item => item.index !== 'A18192710'));
  assert.equal(result.status, 'partial');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.issues.map(issue => [issue.productIndex, issue.status]), [['A18192710', 'unselected']]);
  const missing = resolve(choices, library.filter(item => item.productIndex !== 'A18192710'));
  assert.equal(missing.status, 'partial');
  assert.equal(missing.issues[0].status, 'missing');
});

test('conflict, unavailable and removed technology on one output remain visible as warnings', () => {
  for (const extra of [
    selection('A18192710', 'deleted', { changedAt: '2026-09-21T10:00:00.000Z' }),
    selection('A18192710', 'right-base', { changedAt: '2026-09-21T10:00:00.000Z', removed: true }),
    selection('A18192710', 'another', { changedAt: choices[1].changedAt })
  ]) {
    const result = resolve([...choices, extra]);
    assert.equal(result.status, 'partial');
    assert.equal(result.items[0].id, 'left-alt');
    assert.equal(result.issues[0].productIndex, 'A18192710');
  }
});

test('two unavailable outputs report both product identities and no invented base fallback', () => {
  const result = resolve([]);
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.issues.map(issue => issue.productIndex), ['A18192709', 'A18192710']);
});

test('combined parsing accepts semicolons, plus signs, separate index groups and three products', () => {
  for (const text of [
    'LEFT, RIGHT (A18192709; A18192710)',
    'LEFT + RIGHT (A18192709 + A18192710)',
    'LEFT (A18192709), RIGHT (A18192710)',
    'LEFT (A18192709) + RIGHT (A18192710)',
    '(A18192709, A18192710)'
  ]) assert.deepEqual(resolve(choices, library, text).items.map(item => item.id), ['left-alt', 'right-base']);
  assert.equal(reference.taskTechnologyProducts('One, Two, Three (A1000, A2000, A3000)').length, 3);
  assert.deepEqual(reference.taskTechnologyProducts('Product (MUCELL) (R4 600) (A18192709)'), []);
  assert.deepEqual(reference.taskTechnologyProducts('MAX BODY + HANDLE (A18192709)'), []);
});

test('the same material repeated within one recipe, as linked item and as surplus is still one row', () => {
  const source = tech('test', 'A1', 'Product', [resin, { ...resin, usage: 1 }], {
    linkedProducts: [{ ...resin }], surplusMaterials: [{ ...resin }]
  });
  const rows = reference.buildTaskPreparationList([source]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].products.length, 1);
  assert.deepEqual(rows[0].purposes, ['production', 'surplus']);
});

test('deduplication tolerates case and spaces but never merges different codes, colors, sizes or units', () => {
  const materials = [resin, { ...resin, code: ' r1 ', name: 'tworzywo  naturalne ', usage: 99 },
    { ...resin, code: 'R2' }, { ...resin, name: 'TWORZYWO CZARNE' }, { ...resin, unit: 'szt.' }, leftBox, rightBox];
  assert.equal(reference.buildTaskPreparationList([tech('test', 'A1', 'Product', materials)]).length, 6);
});

test('uncoded duplicates join a coded name only when the name has a unique code', () => {
  const one = reference.buildTaskPreparationList([tech('test', 'A1', 'Product', [{ ...resin, code: '' }, resin])]);
  assert.equal(one.length, 1);
  assert.equal(one[0].code, 'R1');
  const ambiguous = reference.buildTaskPreparationList([tech('test', 'A1', 'Product', [{ ...resin, code: '' }, resin, { ...resin, code: 'R2' }])]);
  assert.equal(ambiguous.length, 3);
});

test('listing material names never changes the plan, library or demand coefficients', () => {
  const before = JSON.stringify({ library, choices });
  const result = resolve();
  reference.buildTaskPreparationList(result.items);
  assert.equal(JSON.stringify({ library, choices }), before);
  assert.equal(result.items[0].materials[0].usage, 0.1);
  assert.equal(result.items[1].materials[0].usage, 0.25);
});

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function render(data) {
  const file = fileURLToPath(new URL('../../components/production-preparation/TaskTechnologyPreview.tsx', import.meta.url));
  const mod = new Module(file);
  mod.require = id => id === '@/lib/utils/productionTaskReference' ? reference
    : id === 'react' ? { ...React, useState: () => [true, () => {}] }
    : id === '@tanstack/react-query' ? { useQuery: () => ({ data, isPending: false, isError: false }) } : require(id);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  return renderToStaticMarkup(React.createElement(mod.exports.TaskTechnologyPreview, { detail, station: 'WTR 34', planDate: '2026-09-21', areaId: 'hala-2' }));
}

test('open UI shows only unique required material names without indexes, variants or product metadata', () => {
  const html = render(resolve());
  assert.equal(html.split('TWORZYWO NATURALNE').length - 1, 1);
  assert.equal(html.split('BARWNIK CZARNY').length - 1, 1);
  assert.match(html, /KARTON LEWY 600X400X300/);
  assert.match(html, /KARTON PRAWY 700X400X300/);
  assert.doesNotMatch(html, /A18192709|A18192710|D0159752_010|R1|B1|C1|C2|Bazowa|Awaryjna|Dotyczy:|Wspólne dla|QUICKLIFT|detale:|Z planowania|tylko podgląd/);
  assert.doesNotMatch(html, /NIEWYBRANE TWORZYWO|Niejednoznaczny wyrób|<select|<input|<option/);
  assert.equal((html.match(/<li\b/g) ?? []).length, 4);
});

test('partial UI keeps a short incomplete-list warning without showing product indexes or metadata', () => {
  const html = render(resolve([choices[0]]));
  assert.match(html, /Lista niepełna/);
  assert.match(html, /TWORZYWO NATURALNE/);
  assert.doesNotMatch(html, /A18192709|A18192710|D0159752_010|R1|B1|C1|Awaryjna|Bazowa|QUICKLIFT/);
});

test('single-product preview also hides indexes, version labels, quantities and surplus annotations', () => {
  const selected = reference.buildSelectedTaskTechnologyReference('LEFT (A18192709)', 'WTR 34', 'hala-2', library, choices);
  selected.items[0].surplusMaterials = [{ ...leftBox }];
  const html = render(selected);
  assert.match(html, /TWORZYWO NATURALNE/);
  assert.doesNotMatch(html, /A18192709|QUICKLIFT|R1|C1|Awaryjna|Bazowa|nadwyżki|Pakowanie|0[.,]1/);
  assert.equal(html.split('KARTON LEWY 600X400X300').length - 1, 1);
});

test('same display name under different codes is listed once without changing underlying identities', () => {
  const result = resolve();
  result.items[1].materials = [{ ...resin, code: 'SECOND-CODE', name: 'TWORZYWO  NATURALNE' }];
  const before = JSON.stringify(result);
  const html = render(result);
  assert.equal(html.split('TWORZYWO NATURALNE').length - 1, 1);
  assert.doesNotMatch(html, /SECOND-CODE/);
  assert.equal(JSON.stringify(result), before);
});

test('a required material without a name warns instead of displaying its code or silently omitting it', () => {
  const result = resolve();
  result.items[0].materials.push({ ...resin, code: 'SECRET-INDEX', name: '' });
  const html = render(result);
  assert.match(html, /Lista niepełna/);
  assert.match(html, /część pozycji nie ma nazwy/);
  assert.doesNotMatch(html, /SECRET-INDEX|Bez indeksu/);
});
