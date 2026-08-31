import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const modules = new Map();
const compile = (source, fileName) => ts.transpileModule(source, {
  fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
}).outputText;
const load = (request) => {
  const base = path.isAbsolute(request) ? request : path.join(root, 'src', request.replace(/^@\//, ''));
  const file = ['', '.tsx', '.ts'].map((extension) => base + extension).find((candidate) => existsSync(candidate));
  if (!file) throw new Error('Missing test module: ' + request);
  if (modules.has(file)) return modules.get(file).exports;
  const loadedModule = { exports: {} };
  modules.set(file, loadedModule);
  vm.runInNewContext(compile(readFileSync(file, 'utf8'), file), {
    module: loadedModule, exports: loadedModule.exports, require: (name) => name.startsWith('@/') ? load(name)
      : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name)
  });
  return loadedModule.exports;
};

const sourceFile = path.join(root, 'src/app/(main)/planowanie-zapotrzebowania/page.tsx');
const source = readFileSync(sourceFile, 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = [
  'uid', 'normalize', 'clonePlanItems', 'selectPlanDate', 'currentPlanVersion', 'currentPlanChanges',
  'tomorrow', 'savedPlanDates', 'customRangeVisible', 'globalRangeChoice', 'PlanAmountField',
  'pendingPlanWorkbook', 'planImportWorkbook', 'planImportSheet',
  'areaName', 'selectPlanningArea', 'selectPlanAreaFilter', 'selectedAreaPlan', 'visibleAreaPlan', 'setVisiblePlanIncluded', 'unassignedPlan', 'missingTechnologyCount', 'unassignedCount',
  'renderPlanTable', 'renderPlan', 'SectionTitle', 'renderHeader', 'renderHistoryV2'
];
const definitions = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) {
    definitions.set(node.name.getText(ast), 'const ' + node.getText(ast) + ';');
  }
  ts.forEachChild(node, visit);
};
visit(ast);
for (const name of names) if (!definitions.has(name)) throw new Error('Missing fixture function: ' + name);
const compiled = compile('{\n' + [...definitions.values()].join('\n') + '\nObject.assign(exports, { renderPlan, renderHistoryV2 });\n}', 'fixture.tsx');

export const createHeaderFixture = (overrides = {}) => {
  const plan = ['MAX CP+TH PRINTED F1_WQ35G2D0ES_A', 'MAX CP+TH PRINTED F1_WQ33G2D00', 'MAINT. DOOR CUBIC POPIEL'].map((name, index) => ({
    id: 'item-' + index, runId: 'run-' + index, index: '90019769' + index, name,
    station: 'ST 1', areaId: 'bakoma', included: index < 2, technologyId: '',
    totalQty: 30 + index * 30, remainingQty: 30 + index * 30, shiftNorm: 380,
    workingMaterials: null, notes: '', manualOverride: false, planGroup: 'standard'
  }));
  const state = {
    selectedPlanDate: '2026-08-31', calculationMode: 'horizon', horizonShifts: 3.5, planName: 'Plan produkcji 31.08.2026.xlsx', planSheet: '31.08',
    selectedAreaId: 'bakoma',
    areas: [
      { id: 'hala-1', name: 'Hala 1' }, { id: 'hala-2', name: 'Hala 2' },
      { id: 'bakoma', name: 'Bakoma' }, { id: 'lakiernia', name: 'Lakiernia' },
      { id: 'narzedziownia', name: 'Narzędziownia' }, { id: 'shared', name: 'Wspólne', shared: true }
    ],
    plan, dailyPlans: { '2026-08-31': plan, '2026-08-30': [] }, quantityCorrections: [], documents: [], archive: [],
    planVersions: [{ id: 'v1', planDate: '2026-08-31', versionNo: 1, status: 'active',
      fileName: 'Plan produkcji 31.08.2026.xlsx', sheetName: '31.08', importedAt: '31.08.2026, 08:15', importedBy: 'Test',
      items: plan, differences: [{ id: 'legacy-new', kind: 'new', itemId: 'item-0', index: plan[0].index, name: plan[0].name }] }],
    ...overrides.state
  };
  const ctx = vm.createContext({
    exports: {}, require, React, Fragment: React.Fragment, useState: React.useState, useRef: React.useRef,
    ...require('lucide-react'),
    ...load('@/components/ui/Button'), ...load('@/components/ui/Badge'),
    ...load('@/components/ui/Card'), ...load('@/lib/planowanie-zapotrzebowania/domain'),
    ...load('@/components/ui/EmptyState'), ...load('@/components/ui/Select'),
    ...load('@/components/planowanie-zapotrzebowania/PlanningSaveStatus'),
    ...load('@/components/planowanie-zapotrzebowania/PlanQuantity'),
    ...load('@/lib/planowanie-zapotrzebowania/planImport'), ...load('@/lib/utils/cn'),
    BaseInput: load('@/components/ui/Input').Input, Input: load('@/components/ui/Input').Input,
    today: '2026-08-31', dateOffsetKey: () => '2026-09-01',
    formatPlanDate: (date) => date.split('-').reverse().join('.'),
    fmt: (value) => String(value).replace('.', ','),
    readOnly: false, showChanges: false, showDatePicker: false, customHorizon: false, showAllPlanAreas: false, view: 'plan', deriveReturnsForDate: () => [],
    saveInfo: { status: 'saved', pending: false, backupAvailable: true, error: '' },
    missingTechnologyCount: 2, unassignedCount: 0, fileInputRef: { current: null }, expandedPlan: '',
    pending: null, sheetName: '', lastPlanWorkbook: null, planUploadModeRef: { current: 'plan' }, importSelectedSheet: () => {},
    renderPendingImport: () => null, renderCalculationDetails: () => null, technologiesFor: () => [],
    areaName: () => 'Bakoma', handleWorkbook: () => {}, selectTechnology: () => {}, addTechnology: () => {},
    differenceLabel: { new: 'Nowa', removed: 'Usunięta', quantity_increased: 'Zwiększona', quantity_decreased: 'Zmniejszona' },
    ...overrides, state
  });
  ctx.setState = ctx.updateState = (updater) => { ctx.state = updater(ctx.state); };
  ctx.setShowChanges = (value) => { ctx.showChanges = value; };
  ctx.setShowDatePicker = (value) => { ctx.showDatePicker = value; };
  ctx.setCustomHorizon = (value) => { ctx.customHorizon = value; };
  ctx.setExpandedPlan = (value) => { ctx.expandedPlan = value; };
  ctx.setShowAllPlanAreas = (value) => { ctx.showAllPlanAreas = value; };
  ctx.setExpandedCalculation = (value) => { ctx.expandedCalculation = value; };
  ctx.setPending = (value) => { ctx.pending = value; };
  ctx.setSheetName = (value) => { ctx.sheetName = value; };
  const render = (view = 'plan') => { vm.runInContext('{\n' + compiled + '\n}', ctx); return view === 'historia' ? ctx.exports.renderHistoryV2() : ctx.exports.renderPlan(); };
  return { ctx, render, html: (view) => renderToStaticMarkup(render(view)) };
};

export const headerPreview = (overrides = {}) => '<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#0c0d10;color:#dce1e7;font-family:Arial,sans-serif;letter-spacing:0}main{max-width:1440px;margin:auto;padding:24px}@media(max-width:600px){main{padding:16px}}</style></head><body><main>'
  + createHeaderFixture(overrides).html(overrides.view) + '</main></body></html>';
