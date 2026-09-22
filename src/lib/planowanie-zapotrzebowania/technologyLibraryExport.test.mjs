import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTechnologyLibraryExport, exportTechnologyLabel } from './technologyLibraryExport.ts';

const material = (code, usage = 1, category = 'Półwyrób', unit = 'szt.') => ({ code, name: code, usage, category, unit, logisticQty: 1 });
const tech = (productIndex, materials = [], patch = {}) => ({
  id: productIndex, productIndex, productName: productIndex, variant: 'base', alternativeNo: 0,
  description: '', notes: '', productionMode: 'planned', shiftNorm: 0, materials, archived: false, ...patch
});
const link = (code, sourcePolicy, usage = 1) => ({ productIndex: code, productName: code, usage, unit: 'szt.', sourcePolicy });

test('exports every variant and archived technology without modifying input', () => {
  const library = [tech('B'), tech('A'), tech('A', [], { id: 'alt', variant: 'alternative', alternativeNo: 1, description: 'Novodur' }), tech('C', [], { archived: true })];
  const before = JSON.stringify(library);
  const data = buildTechnologyLibraryExport(library);
  assert.equal(data.entries.length, 4);
  assert.equal(data.tree.filter((row) => row.depth === 0).length, 4);
  assert.equal(JSON.stringify(library), before);
  assert.equal(data.entries[0].label, 'Bazowa');
  assert.equal(exportTechnologyLabel(library[2]), 'Awaryjna 1 · Novodur');
});

test('warehouse chains retain multiple earlier stages and local quantities, never flattened demand', () => {
  const data = buildTechnologyLibraryExport([
    tech('FINAL', [material('ASSEMBLY', 2)]), tech('ASSEMBLY', [material('PART', 3)]),
    tech('PART', [material('RESIN', 0.125, 'Tworzywo', 'kg')])
  ]);
  const rows = data.tree.filter((row) => row.root.technology.productIndex === 'FINAL');
  assert.deepEqual(rows.map((row) => [row.depth, row.path, row.code, row.usage]), [
    [0, '1', 'FINAL', 1], [1, '1.1', 'ASSEMBLY', 2], [2, '1.1.1', 'PART', 3], [3, '1.1.1.1', 'RESIN', 125]
  ]);
  assert.match(rows[2].stage, /Etapy magazynowe: 1/);
  assert.match(rows[3].stage, /Etapy magazynowe: 2/);
  assert.equal(data.direct.filter((row) => row.parent.technology.productIndex === 'FINAL').length, 1);
  assert.equal(rows[3].unit, 'g');
  assert.equal(data.issues.length, 0);
});

test('direct machine handle and warehouse lid remain distinct', () => {
  const data = buildTechnologyLibraryExport([
    tech('BASKET', [material('LID', 2)], { linkedProducts: [link('HANDLE', 'production', 2)] }),
    tech('HANDLE', [material('COMPOUND', .03865, 'Tworzywo', 'kg')], { productionMode: 'linked', surplusMaterials: [material('BOX', 1 / 328, 'Karton')] }),
    tech('LID', [material('RESIN', .02, 'Tworzywo', 'kg')])
  ]);
  const rows = data.tree.filter((row) => row.root.technology.productIndex === 'BASKET');
  assert.equal(rows.find((row) => row.code === 'HANDLE').usage, 2);
  assert.equal(rows.find((row) => row.code === 'HANDLE').source, 'Bezpośrednio z maszyny');
  assert.equal(rows.find((row) => row.code === 'COMPOUND').stage, 'Produkcja bezpośrednio powiązana');
  assert.equal(rows.find((row) => row.code === 'LID').source, 'Z magazynu');
  assert.match(rows.find((row) => row.code === 'RESIN').stage, /Wcześniejsza/);
  assert.equal(rows.find((row) => row.code === 'BOX').basis, 'Tylko na 1 szt. wydawaną na magazyn');
});

test('unselected source is never silently changed to warehouse or machine', () => {
  const data = buildTechnologyLibraryExport([
    tech('FINAL', [], { linkedProducts: [link('PART', undefined)] }), tech('PART', [material('RESIN', .02, 'Tworzywo', 'kg')])
  ]);
  const rows = data.tree.filter((row) => row.root.technology.productIndex === 'FINAL');
  assert.equal(rows[1].source, 'Wybór w planie: magazyn / maszyna + zabezpieczenie');
  assert.match(rows[2].stage, /zależny od wyboru źródła/);
  assert.ok(data.issues.some((issue) => issue.message.includes('Źródło ustalane')));
});

test('subrecipe uses only a unique active base and does not sum alternatives', () => {
  const data = buildTechnologyLibraryExport([
    tech('FINAL', [material('PART')]), tech('PART', [material('BASE_RESIN', 1, 'Tworzywo')]),
    tech('PART', [material('ALT_RESIN', 1, 'Tworzywo')], { id: 'ALT', variant: 'alternative', alternativeNo: 1 })
  ]);
  const rows = data.tree.filter((row) => row.root.technology.productIndex === 'FINAL');
  assert.ok(rows.some((row) => row.code === 'BASE_RESIN'));
  assert.ok(!rows.some((row) => row.code === 'ALT_RESIN'));
  assert.match(rows.find((row) => row.code === 'PART').note, /warianty: 2/);
});

test('unknown semi-finished goods are reported, ordinary raw materials are leaves', () => {
  const data = buildTechnologyLibraryExport([tech('A', [material('UNKNOWN'), material('RESIN', 1, 'Tworzywo')])]);
  assert.equal(data.issues.length, 1);
  assert.equal(data.issues[0].componentCode, 'UNKNOWN');
  assert.match(data.issues[0].message, /Brak technologii/);
});

test('cycles are cut, reported once per relation and do not freeze the export', () => {
  const data = buildTechnologyLibraryExport([tech('A', [material('B')]), tech('B', [material('A')])]);
  assert.equal(data.tree.length, 6);
  assert.equal(data.issues.length, 2);
  assert.ok(data.issues.every((issue) => issue.message.includes('Pętla')));
});

test('ambiguous bases, absent bases and archived-only matches are not guessed', () => {
  for (const variants of [
    [tech('PART'), tech('PART', [], { id: 'duplicate' })],
    [tech('PART', [], { variant: 'alternative', alternativeNo: 1 })],
    [tech('PART', [], { archived: true })]
  ]) {
    const data = buildTechnologyLibraryExport([tech('A', [material('PART')]), ...variants]);
    const row = data.direct.find((row) => row.parent.technology.productIndex === 'A');
    assert.equal(row.target, undefined);
    assert.equal(row.warning, true);
  }
});

test('index matching preserves zeros and supports existing M-10 alias without fuzzy names', () => {
  const data = buildTechnologyLibraryExport([
    tech('FINAL', [material('M-10-001234'), { ...material('WRONG'), name: 'PART' }]),
    tech('001234', [], { productName: 'PART' })
  ]);
  const rows = data.direct.filter((row) => row.parent.technology.productIndex === 'FINAL');
  assert.equal(rows[0].target.technology.productIndex, '001234');
  assert.equal(rows[1].target, undefined);
  assert.match(rows[0].note, /prefiksu M-10/);
});

test('missing component index allows exact unique name only, duplicate names are ambiguous', () => {
  const part = { ...material(''), name: 'Part' };
  const base = [tech('FINAL', [part]), tech('A', [], { productName: 'Part' })];
  let row = buildTechnologyLibraryExport(base).direct[0];
  assert.equal(row.target.technology.productIndex, 'A');
  assert.match(row.note, /dokładnej nazwie/);
  row = buildTechnologyLibraryExport([...base, tech('B', [], { productName: 'Part' })]).direct[0];
  assert.equal(row.target, undefined);
  assert.equal(row.warning, true);
});

test('quantity units follow the editor and bad quantities remain unavailable', () => {
  const data = buildTechnologyLibraryExport([tech('A', [
    material('KG', .5998, 'Tworzywo', 'kg'), material('G', 45.2, 'Barwnik', 'g'),
    material('THOUSAND', .001, 'Opakowanie', '1000 szt.'), material('ZERO', 0, 'Karton'),
    material('INVALID', NaN, 'Karton')
  ])]);
  assert.deepEqual(data.direct.map((row) => [row.usage, row.unit]), [[599.8, 'g'], [45.2, 'g'], [1, 'szt.'], [0, 'szt.'], [null, 'szt.']]);
  assert.equal(data.issues.length, 2);
});

test('unnumbered custom packaging remains without a fabricated index', () => {
  const data = buildTechnologyLibraryExport([tech('8001356944', [{ ...material('', 2 / 32, 'Opakowanie'), name: 'POKRYWA TOP SECTION' }])]);
  assert.equal(data.direct[0].code, '');
  assert.equal(data.direct[0].usage, .0625);
  assert.equal(data.issues.length, 0);
});

test('shared dependencies are expanded for each branch, not dropped by a global visited set', () => {
  const data = buildTechnologyLibraryExport([
    tech('FINAL', [material('A'), material('B')]), tech('A', [material('C')]), tech('B', [material('C')]),
    tech('C', [material('RESIN', 1, 'Tworzywo')])
  ]);
  assert.equal(data.tree.filter((row) => row.root.technology.productIndex === 'FINAL' && row.code === 'RESIN').length, 2);
});

test('legacy alternative packaging is explicitly conditional', () => {
  const data = buildTechnologyLibraryExport([tech('A', [material('CONTAINER', .01, 'Opakowanie')], {
    emergencyMaterials: [material('CARTON', .1, 'Karton')]
  })]);
  assert.match(data.direct[1].basis, /Zamiast.*nie łącznie/);
});

test('deep graphs stop with a visible warning rather than silently truncating', () => {
  const data = buildTechnologyLibraryExport(Array.from({ length: 34 }, (_, i) => tech(`P${i}`, i < 33 ? [material(`P${i + 1}`)] : [])));
  assert.ok(data.issues.some((issue) => issue.message.includes('32 poziomów')));
});

test('empty library has valid empty result', () => {
  assert.deepEqual(buildTechnologyLibraryExport([]), { entries: [], direct: [], tree: [], issues: [] });
});
