import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskTechnologyReference, buildSelectedTaskTechnologyReference, buildTechnologyPreviewProjection, isProductionTaskReferenceTeam, normalizeProductionHallAssignment, productionHallLabel, productionHallMatchesFilter, productionTaskHall, taskProductIndexes, taskReferenceUsage } from './productionTaskReference.ts';

test('hall and technology features are limited to distribution and startup technicians', () => {
  assert.equal(isProductionTaskReferenceTeam('distribution'), true);
  assert.equal(isProductionTaskReferenceTeam('technician'), true);
  for (const team of ['mechanics', 'process', 'graphics', 'additional', 'unknown', '']) {
    assert.equal(isProductionTaskReferenceTeam(team), false);
  }
});

const mappings = [{station:'WTR 1',areaId:'hala-1'},{station:'WTR 40',areaId:'hala-2'},{station:'ST 1',areaId:'bakoma'}];
const task = (station, hall) => ({ station, notes: hall ? {productionHall:hall} : {} });

test('one shared task matches both halls without duplicating it in the all-halls list', () => {
  const shared = task('ZADANIE DODATKOWE', 'both');
  assert.equal(normalizeProductionHallAssignment('both'), 'both');
  assert.equal(productionTaskHall(shared, mappings), 'both');
  assert.equal(productionTaskHall(task('WTR 1', 'both'), mappings), 'both');
  assert.equal(productionHallLabel('both'), 'Hala 1 i Hala 2');
  for (const filter of ['hala-1', 'hala-2', 'all']) {
    assert.equal([shared].filter(item => productionHallMatchesFilter(productionTaskHall(item, mappings), filter)).length, 1);
  }
  assert.equal(productionHallMatchesFilter('both', 'unassigned'), false);
  assert.equal(productionHallMatchesFilter('hala-1', 'hala-2'), false);
  assert.equal(productionHallMatchesFilter('unassigned', 'hala-1'), false);
  assert.equal(productionHallMatchesFilter('unassigned', 'unassigned'), true);
});
test('hall is mapped by station, not by product or arbitrary task text', () => {
  assert.equal(productionTaskHall(task('wtr. 01'),mappings),'hala-1');
  assert.equal(productionTaskHall(task('WTR 40'),mappings),'hala-2');
  assert.equal(productionTaskHall(task('ZADANIE CYKLICZNE'),mappings),'unassigned');
  assert.equal(productionTaskHall(task('ST 1'),mappings),'unassigned');
});
test('requester assignment overrides station and persists via notes serialization', () => {
  assert.equal(productionTaskHall(JSON.parse(JSON.stringify(task('WTR 1','hala-2'))),mappings),'hala-2');
  assert.equal(productionTaskHall(task('WTR 1','unassigned'),mappings),'unassigned');
  assert.equal(productionTaskHall(task('WTR 40'),[...mappings,{station:'WTR40',areaId:'hala-1'}]),'unassigned');
});
const makeTech=(id,index,name,extra={})=>({id,productIndex:index,productName:name,variant:'base',materials:[{name:'Resin',code:'R1',category:'Tworzywo',usage:0.0528,unit:'kg'}],...extra});
const technologies=[makeTech('old','8001184023','DISC PRO GS41 BLACK + PR PRO ANIMAL'),makeTech('new','8001339182','DISC PRO GS41 BLACK + PR PRO ANIMAL'),makeTech('alt','8001339182','DISC PRO GS41 BLACK + PR PRO ANIMAL',{variant:'alternative',alternativeNo:1,description:'GP-35',materials:[{name:'Black resin',usage:0.0544,unit:'kg'}]})];
test('exact index resolves duplicate product names and sorts base before alternatives', () => {
  const result=buildTaskTechnologyReference('DISC PRO GS41 BLACK + PR PRO ANIMAL (8001339182)',[...technologies].reverse());
  assert.equal(result.status,'matched');
  assert.deepEqual(result.items.map(t=>t.id),['new','alt']);
  assert.equal(result.items[1].label,'Awaryjna 1 · GP-35');
});
test('unknown explicit index never falls back to the same name for a different index', () => {
  assert.equal(buildTaskTechnologyReference('DISC PRO GS41 BLACK + PR PRO ANIMAL (8000000000)',technologies).status,'missing');
  assert.equal(buildTaskTechnologyReference('DISC PRO GS41 BLACK + PR PRO ANIMAL',technologies).status,'ambiguous');
});
test('name-only exact match works; archived recipes and substring matches do not', () => {
  assert.equal(buildTaskTechnologyReference('  disc pro gs41 black + pr pro animal ',technologies.slice(0,1)).status,'matched');
  assert.equal(buildTaskTechnologyReference('DISC PRO',technologies).status,'missing');
  assert.equal(buildTaskTechnologyReference('Product (A18208401)',[makeTech('archived','A18208401','Product',{archived:true})]).status,'missing');
  assert.deepEqual(taskProductIndexes('Product (MUCELL) (M-10-8001128941)'),['M-10-8001128941']);
});
test('preview includes linked products and separate packaging without mutating the library', () => {
  const library=[makeTech('basket','A1000','Basket',{linkedProducts:[{productIndex:'A1001',productName:'Handle',usage:2,unit:'szt.'}],surplusMaterials:[{code:'C',name:'Carton',usage:0.1,unit:'szt.'}],emergencyMaterials:[{name:'Box',usage:0.05,unit:'szt.'}]})];
  const before=JSON.stringify(library);
  const result=buildTaskTechnologyReference('Basket (A1000)',library).items[0];
  assert.equal(result.linkedProducts[0].usage,2);
  assert.equal(result.surplusMaterials[0].name,'Carton');
  assert.equal(result.emergencyMaterials[0].name,'Box');
  assert.equal(JSON.stringify(library),before);
});
test('material mass is displayed as grams per piece; packaging retains its coefficient', () => {
  assert.equal(taskReferenceUsage({usage:0.0544,unit:'kg'}),'54,4 g/szt.');
  assert.equal(taskReferenceUsage({usage:0.0119,unit:'szt.'}),'0,0119 szt./szt.');
});

test('numeric indexes ignore leading zeros, but warehouse prefixes are not discarded', () => {
  const library = [makeTech('system', '1830', 'SYSTEM 300X300 OBUDOWA WYCIERACZKI')];
  assert.equal(buildTaskTechnologyReference('SYSTEM 300X300 OBUDOWA WYCIERACZKI (01830)', library).items[0].id, 'system');
  assert.equal(buildTaskTechnologyReference('SYSTEM 300X300 OBUDOWA WYCIERACZKI,', library).status, 'matched');
  assert.equal(buildTaskTechnologyReference('- WTR 21 SYSTEM 300X300 OBUDOWA WYCIERACZKI (01830)', library).status, 'matched');
  assert.equal(buildTaskTechnologyReference('SYSTEM 300X300 OBUDOWA WYCIERACZKI (M-10-1830)', library).status, 'missing');
});

test('name normalization keeps dimensions, color and technical qualifiers', () => {
  const library = [makeTech('system', '1830', 'SYSTEM 300X300 (MUCELL) WHITE')];
  assert.equal(buildTaskTechnologyReference(' system 300x300 ( mucell ) white, ', library).status, 'matched');
  for (const detail of ['SYSTEM 300X300 WHITE', 'SYSTEM 300X400 (MUCELL) WHITE', 'SYSTEM 300X300 (MUCELL) BLACK']) {
    assert.equal(buildTaskTechnologyReference(detail, library).status, 'missing');
  }
  assert.deepEqual(taskProductIndexes('Product (R4 600) (MUCELL) (M-10-8001128941)'), ['M-10-8001128941']);
});

test('a duplicated numeric index requires an unambiguous product name', () => {
  const library = [makeTech('system', '1830', 'SYSTEM'), makeTech('tank', '01830', 'ZBIORNIK')];
  assert.equal(buildTaskTechnologyReference('SYSTEM (01830)', library).items[0].id, 'system');
  assert.equal(buildTaskTechnologyReference('UNKNOWN (01830)', library).status, 'ambiguous');
});

test('catalogue-confirmed alphabetic indexes resolve without stripping technical name qualifiers', () => {
  const library = [
    makeTech('fan', 'M-10-TMW1TDB', 'PRZEWIETRZNIK W1TDB DE 225SN A10376 PÓŁWYRÓB'),
    makeTech('steel', 'DCD-GP-GS', 'DEK-DRAIN GARAGE PACK (3 X CHANNEL WITH GALV GRATE + ACCESS BAG)'),
    makeTech('plastic', 'DCD-GP-PL', 'DEK-DRAIN GARAGE PACK (3 X CHANNEL WITH PLASTIC GRATE + ACCESS BAG)')
  ];
  for (const tech of library) {
    const detail = `${tech.productName} (${tech.productIndex.toLowerCase()})`;
    assert.equal(buildTaskTechnologyReference(detail, library).items[0].id, tech.id);
    for (const index of [tech.productIndex, '']) {
      const choice = { index, name: tech.productName, station: 'WTR 1', areaId: 'hala-1', technologyId: tech.id, changedAt: '' };
      const result = buildSelectedTaskTechnologyReference(detail, 'WTR 1', 'hala-1', library, [choice]);
      assert.equal(result.status, 'matched');
      assert.equal(result.items[0].id, tech.id);
    }
  }
  assert.equal(buildTaskTechnologyReference(`${library[1].productName} (UNKNOWN-CODE)`, library).status, 'missing');
  assert.equal(buildTaskTechnologyReference('DEK-DRAIN GARAGE PACK (DCD-GP-GS)', [{ ...library[1], archived: true }]).status, 'missing');
  const qualified = [makeTech('qualified', 'AB-CD', 'PRODUCT (MUCELL) (BLACK-WHITE)')];
  assert.equal(buildTaskTechnologyReference('PRODUCT (MUCELL) (BLACK-WHITE) (AB-CD)', qualified).items[0].id, 'qualified');
  assert.equal(buildTaskTechnologyReference('PRODUCT (MUCELL) (WHITE-BLACK)', qualified).status, 'missing');
  assert.deepEqual(taskProductIndexes('PRODUCT (MUCELL) (AB-CD)'), []);
});

const date = '2026-09-21';
const planItem = (extra = {}) => ({ id: 'plan1', index: '8001339182', name: 'DISC PRO GS41 BLACK + PR PRO ANIMAL', station: 'WTR 21', areaId: 'hala-1', technologyId: 'alt', ...extra });
const stateWith = (items) => ({ selectedPlanDate: date, plan: items, dailyPlans: { [date]: items } });
const project = (state, previous = null, timestamp = '2026-09-21T08:00:00.000Z') => buildTechnologyPreviewProjection(state, previous, timestamp, date);
const preview = (selections, station = 'WTR 21', area = 'hala-1') => buildSelectedTaskTechnologyReference('DISC PRO GS41 BLACK + PR PRO ANIMAL (8001339182)', station, area, technologies, selections);

test('readonly preview uses the selected alternative, not the first base variant', () => {
  const projection = project(stateWith([planItem()]));
  const result = preview(projection.days[date]);
  assert.equal(result.status, 'matched');
  assert.equal(result.source, 'planning');
  assert.deepEqual(result.items.map(t => t.id), ['alt']);
  assert.equal(result.items[0].materials[0].name, 'Black resin');
  assert.equal(preview(projection.days[date], 'WTR 22').status, 'unselected');
  assert.equal(preview(projection.days[date], 'WTR 21', 'hala-2').status, 'unselected');
  assert.equal(preview(projection.days['2026-09-22']).status, 'unselected');
});

test('working recipe is reflected exactly, including an intentionally empty recipe', () => {
  for (const workingMaterials of [[], [{ code: 'R2', name: 'Custom resin', usage: 0.5, unit: 'kg' }]]) {
    const projection = project(stateWith([planItem({ manualOverride: true, workingMaterials })]));
    const result = preview(projection.days[date]).items[0];
    assert.equal(result.label, 'Robocza · Awaryjna 1 · GP-35');
    assert.equal(result.materials.length, workingMaterials.length);
    if (workingMaterials.length) assert.equal(result.materials[0].name, 'Custom resin');
  }
});

test('a name-only task may use an unambiguous product identity from that station plan', () => {
  const selections = project(stateWith([planItem()])).days[date];
  const result = buildSelectedTaskTechnologyReference('DISC PRO GS41 BLACK + PR PRO ANIMAL', 'WTR 21', 'hala-1', technologies, selections);
  assert.equal(result.items[0].id, 'alt');
  assert.equal(buildSelectedTaskTechnologyReference('DISC PRO GS41 BLACK + PR PRO ANIMAL', 'WTR 21', 'hala-1', technologies, [...selections, { ...selections[0], index: '8001184023', technologyId: 'old' }]).status, 'ambiguous');
});

test('a library snapshot is not mistaken for a manual override, library stays live', () => {
  const projection = project(stateWith([planItem({ workingMaterials: [{ name: 'Old stale resin' }], manualOverride: false })]));
  assert.equal(projection.days[date][0].workingMaterials, null);
  assert.equal(preview(projection.days[date]).items[0].materials[0].name, 'Black resin');
});

test('only an actual recipe change wins between planners; unrelated saves keep timestamps', () => {
  const first = project(stateWith([planItem({ technologyId: 'new' })]));
  const second = project(stateWith([planItem()]), first, '2026-09-21T09:00:00.000Z');
  const unrelated = project(stateWith([planItem({ technologyId: 'new', remainingQty: 100, notes: 'changed' })]), first, '2026-09-21T10:00:00.000Z');
  assert.equal(unrelated.days[date][0].changedAt, first.days[date][0].changedAt);
  assert.equal(preview([...unrelated.days[date], ...second.days[date]]).items[0].id, 'alt');
  assert.equal(preview([...first.days[date], ...project(stateWith([planItem()])).days[date]]).status, 'conflict');
});

test('removed or cleared choices never fall back to another planner or silently to base', () => {
  const first = project(stateWith([planItem()]));
  for (const nextPlan of [[], [planItem({ technologyId: '' })]]) {
    const second = project(stateWith(nextPlan), first, '2026-09-21T09:00:00.000Z');
    const result = preview([...first.days[date], ...second.days[date]]);
    assert.equal(result.status, 'unselected');
    assert.deepEqual(result.items, []);
  }
  assert.equal(preview([]).status, 'unselected');
  assert.equal(preview(project(stateWith([planItem({ technologyId: 'deleted' })])).days[date]).status, 'unavailable');
});

test('legacy blank selections do not conflict with a real selection, regardless of planner order', () => {
  for (const technologyId of ['new', 'alt']) {
    for (const workingMaterials of [undefined, null, []]) {
      const blank = project(stateWith([planItem({ technologyId: '', workingMaterials })]), null, '').days[date];
      const chosen = project(stateWith([planItem({ technologyId })]), null, '').days[date];
      for (const selections of [[...blank, ...chosen], [...chosen, ...blank, ...blank]]) {
        const snapshot = JSON.stringify(selections);
        const result = preview(selections);
        assert.equal(result.status, 'matched');
        assert.equal(result.items[0].id, technologyId);
        assert.equal(result.changedAt, '');
        assert.equal(JSON.stringify(selections), snapshot);
      }
    }
  }
});

test('all legacy blanks remain unselected and never invent a base selection', () => {
  const rows = [undefined, []].flatMap(workingMaterials =>
    project(stateWith([planItem({ technologyId: '', workingMaterials })]), null, '').days[date]);
  assert.equal(preview(rows).status, 'unselected');
  assert.deepEqual(preview(rows).items, []);
});

test('legacy blank filtering preserves real conflicts, removals, and manual recipes', () => {
  const blank = project(stateWith([planItem({ technologyId: '' })]), null, '').days[date][0];
  const chosen = project(stateWith([planItem()]), null, '').days[date][0];
  for (const competing of [
    { ...chosen, technologyId: 'new' },
    { ...blank, removed: true },
    { ...blank, manualOverride: true, workingMaterials: [] },
    { ...blank, workingMaterials: [{ name: 'Separate working recipe', unit: 'kg', usage: 1 }] },
    { ...chosen, manualOverride: true, workingMaterials: [] }
  ]) {
    assert.equal(preview([blank, chosen, competing]).status, 'conflict');
  }
});

test('timestamped clearing still wins over all older legacy choices and survives unrelated saves', () => {
  const legacy = project(stateWith([planItem()]), null, '');
  for (const plan of [[], [planItem({ technologyId: '' })]]) {
    const cleared = project(stateWith(plan), legacy);
    const later = project({ ...stateWith(plan), notes: 'unrelated save' }, cleared, '2026-09-21T10:00:00.000Z');
    assert.equal(preview([...legacy.days[date], ...later.days[date]]).status, 'unselected');
    assert.equal(later.days[date][0].changedAt, cleared.days[date][0].changedAt);
  }
});

test('first save of an unchanged legacy blank does not turn it into an intentional clear', () => {
  const blank = stateWith([planItem({ technologyId: '', workingMaterials: [] })]);
  const legacy = project(blank, null, '');
  const saved = project(blank, legacy);
  assert.equal(saved.days[date][0].changedAt, '');
  const chosen = project(stateWith([planItem()]), null, '');
  assert.equal(preview([...saved.days[date], ...chosen.days[date]]).status, 'matched');
});

test('projection retains multiple days, prunes old history, omits unrelated plan data and does not mutate state', () => {
  const state = { ...stateWith([planItem()]), inventory: ['private'], dailyPlans: { '2026-09-01': [planItem()], '2026-09-20': [planItem({ technologyId: 'new' })] } };
  const before = JSON.stringify(state);
  const result = project(state);
  assert.equal(result.days['2026-09-01'], undefined);
  assert.equal(result.days['2026-09-20'][0].technologyId, 'new');
  assert.equal(result.days[date][0].technologyId, 'alt');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(state), before);
});
