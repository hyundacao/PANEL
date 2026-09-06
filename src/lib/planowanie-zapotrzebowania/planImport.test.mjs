import assert from 'node:assert/strict';
import test from 'node:test';
import { knownRemainingQuantity, parsePlanQuantity, planningSections, quantityNeedsReview, readPlanningRows, splitPlanningRowOutputs } from './planImport.ts';

const header = ['Data / Lp.', '', 'ILOŚĆ:', 'ST.', 'NORMA', 'CZĘŚĆ DNIÓWKI', 'UWAGI:'];
const detail = 'QUICK LIFT ADJUSTER SIDE LEFT, QUICK LIFT ADJUSTER SIDE RIGHT (A28963702, A28963701 )';

for (const input of ['L - 3 594                       P - 3 775', 'L - 3 594\nP - 3 775', 'L:3594, P:3775', 'LEFT 3594 / RIGHT 3775', 'L – 3 594; P — 3 775']) {
  test(`recognizes the entire labelled amount: ${input}`, () => {
    const parsed = parsePlanQuantity(input);
    assert.equal(parsed.sourceQuantity, input);
    assert.equal(parsed.totalQty, 7369);
    assert.equal(parsed.quantityStatus, 'parsed');
    assert.deepEqual(parsed.quantityParts, [{label:'L',quantity:3594},{label:'P',quantity:3775}]);
  });
}

test('keeps all detail rows including missing, zero, invalid amounts and missing stations', () => {
  const rows = [header,
    ['1',detail,'L - 3 594                       P - 3 775','WTR 34','1400','2','DOPAKOWAĆ NIEPEŁNE PALETY'],
    ['2','HOUSING EASY SANDER (16058066AP)','','WTR 40',612,'1','WYBIĆ DETALE SPOD MASZYNY'],
    ['3','Detal bez ilości','DO RANA','WTR 20'],
    ['4','Detal z zerem',0,'WTR 21'],
    ['','AWARYJNIE'],
    ['','Detal bez stanowiska','',''],
    ['','NARZĘDZIOWNIA'],
    ['','Naprawa (123)',100,'ST 56'],
    ['','LAKIERNIA'],
    ['','Lakierowanie (456)',200,'ST 55'],
    ['','PLANOWANE ZMIANY FORM'],
    ['1.09','Przyszły detal (789)','','WTR 24'],
  ];
  const imported = readPlanningRows(rows);
  assert.equal(imported.length, 8);
  assert.deepEqual(imported.map(row=>row.sourceRow), [2,3,4,5,7,9,11,13]);
  assert.deepEqual(imported.map(row=>row.quantityStatus), ['parsed','missing','unrecognized','parsed','missing','parsed','parsed','missing']);
  assert.equal(imported[4].station,'');
  assert.equal(imported[1].sourceNotes, 'WYBIĆ DETALE SPOD MASZYNY');
  assert.equal(imported[2].notes,'');
  assert.equal(imported[0].sourceDetail,detail);
  assert.deepEqual(planningSections(imported).flatMap(section=>section.items),imported);
  assert.deepEqual(planningSections(imported).map(section=>section.title), ['Plan bieżący','AWARYJNIE','NARZĘDZIOWNIA','LAKIERNIA','PLANOWANE ZMIANY FORM']);
});

test('splits one mould run into independently calculated products in source order', () => {
  const source = 'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010), QUICKLIFT DORIS RIGHT ASSEMBLY (D0159752_010) (A18192709, A18192710)';
  const [row] = readPlanningRows([header, ['1', source, '9 720, 9 720', 'WTR 34', 1485]]);
  const outputs = splitPlanningRowOutputs(row);

  assert.deepEqual(outputs.map((output) => ({
    index: output.index,
    name: output.name,
    quantity: output.totalQty,
    order: output.productionOutputOrder,
    count: output.productionOutputCount
  })), [
    { index: 'A18192709', name: 'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010)', quantity: 9720, order: 0, count: 2 },
    { index: 'A18192710', name: 'QUICKLIFT DORIS RIGHT ASSEMBLY (D0159752_010)', quantity: 9720, order: 1, count: 2 }
  ]);
  assert.deepEqual(outputs.map((output) => output.sourceQuantity), ['9720', '9720']);
  assert.ok(outputs.every((output) => output.productionSourceQuantity === '9 720, 9 720'));
});

test('sums each additive quantity separately when one mould produces two products', () => {
  const source = 'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010), QUICKLIFT DORIS RIGHT ASSEMBLY (D0159752_010) (A18192709, A18192710)';
  const [row] = readPlanningRows([header, ['1', source, '5 960 + 7 776, 5 960 + 7 776', 'WTR 34', 1485]]);
  const outputs = splitPlanningRowOutputs(row);

  assert.deepEqual(outputs.map((output) => output.index), ['A18192709', 'A18192710']);
  assert.deepEqual(outputs.map((output) => output.totalQty), [13736, 13736]);
  assert.ok(outputs.every((output) => output.quantityStatus === 'parsed'));
  assert.deepEqual(outputs.map((output) => output.name), [
    'QUICKLIFT DORIS LEFT ASSEMBLY (D0159752_010)',
    'QUICKLIFT DORIS RIGHT ASSEMBLY (D0159752_010)'
  ]);
  const [restoredOutput] = splitPlanningRowOutputs({ ...outputs[0], quantityStatus: 'unrecognized' });
  assert.equal(restoredOutput.quantityStatus, 'parsed');
});

test('keeps plus signs inside product names when commas separate mould outputs', () => {
  const [row] = readPlanningRows([header, [
    '1',
    'PLV QUICK LIFT SLIDER LEFT + WHEEL DORIS 229, PLV QUICK LIFT SLIDER RIGHT + WHEEL DORIS 229 (A18208403, A18208404)',
    '10 950, 10 950',
    'WTR 18',
    1300
  ]]);
  const outputs = splitPlanningRowOutputs(row);
  assert.deepEqual(outputs.map((output) => output.index), ['A18208403', 'A18208404']);
  assert.deepEqual(outputs.map((output) => output.name), [
    'PLV QUICK LIFT SLIDER LEFT + WHEEL DORIS 229',
    'PLV QUICK LIFT SLIDER RIGHT + WHEEL DORIS 229'
  ]);
  assert.deepEqual(outputs.map((output) => output.totalQty), [10950, 10950]);
  const recovered = splitPlanningRowOutputs({ ...row, totalQty: 0, quantityStatus: 'unrecognized' });
  assert.deepEqual(recovered.map((output) => output.index), ['A18208403', 'A18208404']);
});

test('adds exact quantity components separately for each labelled mould output', () => {
  const source = 'L - 234 + 1 560                    P - 420 + 2 400';
  const parsed = parsePlanQuantity(source);
  assert.equal(parsed.quantityStatus, 'parsed');
  assert.deepEqual(parsed.quantityParts, [
    { label: 'L', quantity: 1794 },
    { label: 'P', quantity: 2820 }
  ]);
  assert.equal(parsed.totalQty, 4614);
});

test('splits three simultaneous outputs and never sums them into one product', () => {
  const [row] = readPlanningRows([header, [
    '1',
    'DETAL LEFT, DETAL CENTER, DETAL RIGHT (A100, A200, A300)',
    '9 700, 9 700, 9 700',
    'WTR 12',
    1485
  ]]);
  const outputs = splitPlanningRowOutputs(row);
  assert.deepEqual(outputs.map((output) => output.index), ['A100', 'A200', 'A300']);
  assert.deepEqual(outputs.map((output) => output.totalQty), [9700, 9700, 9700]);
  assert.ok(outputs.every((output) => output.norm === 1485));
});

test('stops calculation when names, indices and quantities do not align', () => {
  const [row] = readPlanningRows([header, [
    '1',
    'DETAL LEFT, DETAL RIGHT (A100, A200)',
    '9 700, 9 700, 9 700',
    'WTR 12',
    1485
  ]]);
  const [output] = splitPlanningRowOutputs(row);
  assert.equal(output.totalQty, 0);
  assert.equal(output.quantityStatus, 'unrecognized');
  assert.equal(output.sourceQuantity, row.sourceQuantity);
});

test('preserves panel context, sheet row offsets and does not move later standard sections', () => {
  const rows=[header,['','PANELE SE','','ST 1',380],['','Panel (A1)',90],['1','Detal (A2)',100,'WTR 3',500],['','AWARYJNIE'],['','Awaria (A3)',100,'WTR 9'],['','LAKIERNIA'],['','Detal (A4)',100,'ST 55']];
  const imported=readPlanningRows(rows,10);
  assert.equal(imported[0].sourceRow,13);
  assert.equal(imported[0].station,'ST 1');
  assert.equal(imported[0].norm,380);
  assert.equal(imported[0].sourceStation,'');
  assert.deepEqual(planningSections(imported).map(section=>section.title),['PANELE SE','Plan bieżący','AWARYJNIE','LAKIERNIA']);
});

test('generic indexed tables preserve a named Detal and a blank name with a valid index',()=>{
  const result=readPlanningRows([['Indeks','Nazwa','Ilość','Stanowisko'],['A1','Detal','tekst',''],['A2','','', 'WTR 2']]);
  assert.equal(result.length,2);
  assert.equal(result[0].name,'Detal');
  assert.equal(result[1].index,'A2');
  assert.equal(result[1].name,'A2');
});

test('plain numbers, decimal commas, sums, spaces and explicit zero retain valid totals',()=>{
  for(const [value,expected] of [[0,0],['0',0],['3 594',3594],['3\u00a0594',3594],['3594,5',3594.5],['14 848, 14 848',29696],['100 + 200',300],['100; 200',300],['100 szt.',100],['L 3500',3500]]){
    const parsed=parsePlanQuantity(value);
    assert.equal(parsed.totalQty,expected,`${value}`);
    assert.equal(parsed.quantityStatus,'parsed',`${value}`);
  }
});

test('no partial quantities guessed from instructions, malformed L/P or negative values',()=>{
  for(const value of ['DO RANA','około 3500','L 3500 P brak','L 3500 P - 20 dodatkowo','L 3500 L 20','L 3500 P -20 extra','100 + abc','-50','3500-3775','120 szt. + do rana',Infinity,-1]){
    const parsed=parsePlanQuantity(value);
    assert.equal(parsed.quantityStatus,'unrecognized',String(value));
    assert.equal(parsed.totalQty,0,String(value));
    assert.equal(parsed.sourceQuantity,String(value));
  }
  for(const value of [null,undefined,'','  ']) assert.equal(parsePlanQuantity(value).quantityStatus,'missing');
});

test('unknown quantities differ from explicit zero and known remaining zero never falls back to total',()=>{
  assert.equal(quantityNeedsReview(parsePlanQuantity('')),true);
  assert.equal(quantityNeedsReview(parsePlanQuantity(0)),false);
  assert.equal(knownRemainingQuantity({totalQty:100,remainingQty:0,quantityStatus:'parsed'}),0);
  assert.equal(knownRemainingQuantity({totalQty:100,remainingQty:100,quantityStatus:'unrecognized'}),0);
  assert.equal(knownRemainingQuantity({totalQty:100,remainingQty:100,quantityStatus:'manual'}),100);
});

test('source text, warnings and split parts survive the JSON persistence format unchanged',()=>{
  const imported=readPlanningRows([header,['1',detail,'L - 3 594\nP - 3 775','WTR 34'],['2','Other','DO RANA','WTR 40']]);
  assert.deepEqual(JSON.parse(JSON.stringify(imported)),imported);
});
