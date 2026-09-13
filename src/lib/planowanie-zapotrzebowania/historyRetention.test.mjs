import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMaterialPlanningDateRetained,
  materialPlanningHistoryCutoffDateKey,
  pruneMaterialPlanningHistory
} from './historyRetention.ts';

test('planning history keeps seven previous calendar days and all future dates', () => {
  assert.equal(materialPlanningHistoryCutoffDateKey('2026-09-11'), '2026-09-04');
  assert.equal(isMaterialPlanningDateRetained('2026-09-03', '2026-09-11'), false);
  assert.equal(isMaterialPlanningDateRetained('2026-09-04', '2026-09-11'), true);
  assert.equal(isMaterialPlanningDateRetained('2026-09-18', '2026-09-11'), true);
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
      '2026-09-04': [{ id: 'boundary-plan' }],
      '2026-09-11': [{ id: 'today-plan' }],
      '2026-09-12': [{ id: 'future-plan' }]
    },
    planVersions: [
      { id: 'v-old', planDate: '2026-09-03', versionNo: 1, importedAt: 'old', fileName: 'old.xlsx', sheetName: 'old', items: [{ id: 'old-plan' }] },
      { id: 'v-boundary', planDate: '2026-09-04', versionNo: 1, importedAt: 'boundary', fileName: 'boundary.xlsx', sheetName: 'boundary', items: [{ id: 'boundary-plan' }] },
      { id: 'v-today-1', planDate: '2026-09-11', versionNo: 1, importedAt: 'today-1', fileName: 'today-1.xlsx', sheetName: 'today-1', items: [{ id: 'today-plan-1' }] },
      { id: 'v-today-2', planDate: '2026-09-11', versionNo: 2, importedAt: 'today-2', fileName: 'today-2.xlsx', sheetName: 'today-2', items: [{ id: 'today-plan-2' }] }
    ],
    quantityCorrections: [
      { id: 'correction-old', planDate: '2026-09-03' },
      { id: 'correction-boundary', planDate: '2026-09-04' }
    ],
    documents: [
      { id: 'document-old', planDate: '2026-09-03' },
      { id: 'document-today', planDate: '2026-09-11' }
    ],
    returnStatuses: {
      '2026-09-03|hall|material': 'completed',
      '2026-09-04|hall|material': 'open',
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
  assert.deepEqual(Object.keys(result.dailyPlans), ['2026-09-04', '2026-09-11', '2026-09-12']);
  assert.deepEqual(result.planVersions.map((version) => version.id), ['v-boundary', 'v-today-1', 'v-today-2']);
  assert.deepEqual(result.quantityCorrections.map((row) => row.id), ['correction-boundary']);
  assert.deepEqual(result.documents.map((row) => row.id), ['document-today']);
  assert.deepEqual(result.returnStatuses, {
    '2026-09-04|hall|material': 'open',
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
