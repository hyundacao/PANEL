import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMaterialPlanningDateRetained,
  materialPlanningHistoryCutoffDateKey,
  materialPlanningHistoryEntryDateKey,
  pruneMaterialPlanningRecord,
  pruneMaterialPlanningHistory
} from './historyRetention.ts';

test('planning history keeps today, yesterday and future plans only', () => {
  assert.equal(materialPlanningHistoryCutoffDateKey('2026-09-11'), '2026-09-10');
  assert.equal(isMaterialPlanningDateRetained('2026-09-09', '2026-09-11'), false);
  assert.equal(isMaterialPlanningDateRetained('2026-09-10', '2026-09-11'), true);
  assert.equal(isMaterialPlanningDateRetained('2026-09-11', '2026-09-11'), true);
  assert.equal(isMaterialPlanningDateRetained('2026-09-18', '2026-09-11'), true);
  assert.equal(materialPlanningHistoryCutoffDateKey('2027-01-01'), '2026-12-31');
  assert.equal(materialPlanningHistoryCutoffDateKey('2026-03-30'), '2026-03-29');
});

test('expired daily plans and their related records are removed together', () => {
  const state = {
    selectedPlanDate: '2026-09-03',
    activePlanVersionId: 'v-old',
    planName: 'old.xlsx',
    planSheet: 'old',
    planImportedAt: '03.09.2026',
    plan: [{ id: 'old-plan' }],
    dailyPlans: {
      '2026-09-03': [{ id: 'old-plan' }],
      '2026-09-10': [{ id: 'boundary-plan' }],
      '2026-09-11': [{ id: 'today-plan' }],
      '2026-09-12': [{ id: 'future-plan' }]
    },
    planVersions: [
      { id: 'v-old', planDate: '2026-09-03', versionNo: 1, importedAt: 'old', fileName: 'old.xlsx', sheetName: 'old', items: [{ id: 'old-plan' }] },
      { id: 'v-boundary', planDate: '2026-09-10', versionNo: 1, importedAt: 'boundary', fileName: 'boundary.xlsx', sheetName: 'boundary', items: [{ id: 'boundary-plan' }] },
      { id: 'v-today-1', planDate: '2026-09-11', versionNo: 1, importedAt: 'today-1', fileName: 'today-1.xlsx', sheetName: 'today-1', items: [{ id: 'today-plan-1' }] },
      { id: 'v-today-2', planDate: '2026-09-11', versionNo: 2, importedAt: 'today-2', fileName: 'today-2.xlsx', sheetName: 'today-2', items: [{ id: 'today-plan-2' }] }
    ],
    quantityCorrections: [
      { id: 'correction-old', planDate: '2026-09-03' },
      { id: 'correction-boundary', planDate: '2026-09-10' }
    ],
    documents: [
      { id: 'document-old', planDate: '2026-09-03' },
      { id: 'document-today', planDate: '2026-09-11' }
    ],
    returnStatuses: {
      '2026-09-03|hall|material': 'completed',
      '2026-09-10|hall|material': 'open',
      permanent: 'open'
    },
    pickingDone: {
      '2026-09-03|item': true,
      '2026-09-11|item': true
    },
    technologies: [{ id: 'technology-kept' }]
  };

  const result = pruneMaterialPlanningHistory(state, '2026-09-11');

  assert.equal(result.selectedPlanDate, '2026-09-11');
  assert.equal(result.activePlanVersionId, 'v-today-2');
  assert.equal(result.planName, 'today-2.xlsx');
  assert.deepEqual(result.plan, [{ id: 'today-plan' }]);
  assert.deepEqual(Object.keys(result.dailyPlans), ['2026-09-10', '2026-09-11', '2026-09-12']);
  assert.deepEqual(result.planVersions.map((version) => version.id), ['v-boundary', 'v-today-1', 'v-today-2']);
  assert.deepEqual(result.quantityCorrections.map((row) => row.id), ['correction-boundary']);
  assert.deepEqual(result.documents.map((row) => row.id), ['document-today']);
  assert.deepEqual(result.returnStatuses, {
    '2026-09-10|hall|material': 'open',
    permanent: 'open'
  });
  assert.deepEqual(result.pickingDone, { '2026-09-11|item': true });
  assert.equal(result.technologies, state.technologies);
});

test('retention leaves an already clean state untouched', () => {
  const state = {
    selectedPlanDate: '2026-09-11',
    activePlanVersionId: '',
    planName: '',
    planSheet: '',
    planImportedAt: '',
    plan: [],
    dailyPlans: { '2026-09-11': [] },
    planVersions: [],
    quantityCorrections: [],
    documents: [],
    returnStatuses: {},
    pickingDone: {}
  };

  assert.equal(pruneMaterialPlanningHistory(state, '2026-09-11'), state);
});

test('an active plan survives when its imported version leaves one-day history', () => {
  const active = [{ id: 'run-1', technologyId: 'working', remainingQty: 800 }];
  const state = {
    selectedPlanDate: '2026-09-01', activePlanVersionId: 'v-old',
    planName: '01.09.xlsx', planSheet: 'Plan', planImportedAt: '2026-09-01',
    plan: active, dailyPlans: { '2026-09-01': active, '2026-09-12': [] },
    planVersions: [{ id: 'v-old', planDate: '2026-09-01', versionNo: 1, importedAt: '2026-09-01',
      fileName: '01.09.xlsx', sheetName: 'Plan', items: [{ id: 'run-1', technologyId: 'base' }] }],
    quantityCorrections: [], documents: [], returnStatuses: {}, pickingDone: {}
  };
  const result = pruneMaterialPlanningHistory(state, '2026-09-12');
  assert.equal(result.selectedPlanDate, '2026-09-12');
  assert.deepEqual(result.plan, active);
  assert.equal(result.plan[0].technologyId, 'working');
  assert.equal(result.planName, '01.09.xlsx');
  assert.deepEqual(result.planVersions, []);
  assert.deepEqual(Object.keys(result.dailyPlans), ['2026-09-12']);
  assert.deepEqual(result.dailyPlans['2026-09-12'], active);
});

test('dated production archive is pruned without changing permanent settings, stock or the working recipe', () => {
  const state = {
    selectedPlanDate: '2026-09-01', plan: [{ id: 'active', manualOverride: true, workingMaterials: [{ code: 'ALT', usage: 0.5 }] }],
    archive: [{ id: 'expired', at: '9.09.2026, 15:00' }, { id: 'yesterday', at: '10.09.2026, 09:30' },
      { id: 'today', at: '2026-09-11T07:00:00Z' }, { id: 'unknown-date' }],
    inventory: [{ qty: 7 }], technologies: [{ id: 'base' }], returnExclusions: [{ id: 'permanent' }],
    fixedDevices: [{ id: 'dryer' }], palletSets: [{ id: 'pallet' }]
  };
  const result = pruneMaterialPlanningRecord(state, '2026-09-11');
  assert.deepEqual(result.archive.map(row => row.id), ['yesterday', 'today', 'unknown-date']);
  for (const key of ['plan', 'inventory', 'technologies', 'returnExclusions', 'fixedDevices', 'palletSets']) assert.equal(result[key], state[key]);
  assert.equal(state.archive.length, 4, 'the input is never mutated');
  assert.equal(pruneMaterialPlanningRecord(result, '2026-09-11'), result);
});

test('archive timestamps use the Polish calendar day at midnight boundaries', () => {
  assert.equal(materialPlanningHistoryEntryDateKey('2026-11-07T23:30:00Z'), '2026-11-08');
  assert.equal(materialPlanningHistoryEntryDateKey('8.11.2026, 00:30:00'), '2026-11-08');
  assert.equal(materialPlanningHistoryEntryDateKey('unknown'), '');
});

test('partial shared records prune documents and return decisions without adding private plan fields', () => {
  const state = { technologies: [], documents: [{ id: 'old', planDate: '2026-11-06' }, { id: 'yesterday', planDate: '2026-11-07' }, { id: 'today', planDate: '2026-11-08' }],
    returnStatuses: { '2026-11-06|h|m': 'completed', '2026-11-07|h|m': 'open', permanent: 'open' } };
  const result = pruneMaterialPlanningRecord(state, '2026-11-08');
  assert.deepEqual(result.documents.map(row => row.id), ['yesterday', 'today']);
  assert.deepEqual(result.returnStatuses, { '2026-11-07|h|m': 'open', permanent: 'open' });
  assert.equal('plan' in result, false);
  assert.equal(result.technologies, state.technologies);
});
