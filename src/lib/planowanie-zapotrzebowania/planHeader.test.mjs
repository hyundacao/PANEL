import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHeaderFixture } from './planHeader.fixture.mjs';

const nodes = (node) => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
};
const control = (fixture, label) => nodes(fixture.render()).find((node) => node.props?.['aria-label'] === label);
const button = (fixture, label) => nodes(fixture.render()).find((node) => (
  typeof node.props?.onClick === 'function' && nodes(node).some((child) => (
    Array.isArray(child.props?.children) && child.props.children.includes(label)
  ))
));

test('plan row renders an unresolved identical index and name only once', () => {
  const h = createHeaderFixture();
  const raw = 'UNRESOLVED PRODUCT (R4 600)';
  h.ctx.state.plan = [{ ...h.ctx.state.plan[0], index: raw, name: raw }];
  assert.equal(h.html().split(raw).length - 1, 1);
  h.ctx.state.plan[0].name = 'unresolved product (r4 600)';
  assert.equal(h.html().split(raw).length - 1, 1);
  assert.ok(!h.html().includes('>unresolved product (r4 600)<'));
});

test('plan emphasizes the product name in bold orange and keeps the index and notes lighter', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan = [{ ...h.ctx.state.plan[0], index: '8001227999', name: 'T27SC1R LID HEX NUPS COMPLETE', notes: 'Uwagi bez zmian' }];
  const textNode = (text) => nodes(h.render()).find((node) => node.type === 'p' && node.props?.children === text);
  assert.match(textNode('8001227999').props.className, /\bfont-normal\b/);
  assert.doesNotMatch(textNode('8001227999').props.className, /\bfont-bold\b/);
  assert.match(textNode('T27SC1R LID HEX NUPS COMPLETE').props.className, /\bfont-bold\b/);
  assert.match(textNode('T27SC1R LID HEX NUPS COMPLETE').props.className, /\bcatalog-label\b/);
  const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.catalog-label\s*\{\s*color:\s*var\(--brand\)/);
  assert.match(css, /--brand:\s*#ff6a00\s*;/i);
  assert.match(textNode('Uwagi bez zmian').props.className, /\btext-muted\b/);
  assert.doesNotMatch(textNode('Uwagi bez zmian').props.className, /\bfont-bold\b|\bcatalog-label\b/);
});

test('plan row keeps a distinct product index above its full qualified name', () => {
  const h = createHeaderFixture();
  for (const [index, name] of [
    ['303022445', 'T27SC1R LID HEX NUPS WELDED (MUCELL)'],
    ['8001382818', 'DOCKING STATION SET MUH NG (CARRIER PART BASIS STATION)']
  ]) {
    h.ctx.state.plan = [{ ...h.ctx.state.plan[0], index, name }];
    const html = h.html();
    assert.equal(html.split(index).length - 1, 1);
    assert.equal(html.split(name).length - 1, 1);
    assert.ok(html.indexOf(index) < html.indexOf(name));
  }
});

test('header keeps date, range and workbook selectors without repeated statistics cards', () => {
  const h = createHeaderFixture();
  assert.ok(control(h, 'Dzień produkcji'));
  assert.ok(control(h, 'Zapotrzebowanie na'));
  assert.ok(control(h, 'Strefa planu'));
  assert.ok(control(h, 'Karta / arkusz Excela'));
  const html = h.html();
  assert.match(html, /Plan produkcyjny/);
  assert.match(html, /Zapisano/);
  assert.doesNotMatch(html, /Osobny moduł produkcyjny|Pozycje planu|Globalny zakres obliczeń|Pokaż zmiany/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[=>\s])/);
  assert.doesNotMatch(html, />Nowa</);
});

test('main plan exposes a direct picking document action for a concrete zone', () => {
  let created = 0;
  const h = createHeaderFixture({ createPickingDocumentFromPlan: () => { created += 1; } });
  const action = button(h, 'Utwórz dokument do wypisania');
  assert.ok(action);
  assert.equal(action.props.disabled, false);
  action.props.onClick();
  assert.equal(created, 1);

  control(h, 'Strefa planu').props.onChange({ target: { value: 'all' } });
  assert.equal(button(h, 'Utwórz dokument do wypisania').props.disabled, true);
  assert.match(h.html(), /Wybierz konkretną strefę, aby przygotować jej dokument/);

  h.ctx.editablePickingDocumentExists = true;
  control(h, 'Strefa planu').props.onChange({ target: { value: 'bakoma' } });
  assert.ok(button(h, 'Przelicz i pokaż dokument'));
});

test('today, tomorrow, saved dates and custom calendar select the matching daily plan', () => {
  const h = createHeaderFixture();
  const original = h.ctx.state.plan;
  const select = control(h, 'Dzień produkcji');
  assert.ok(nodes(select).some((node) => node.props?.value === '2026-08-30'));
  select.props.onChange({ target: { value: '2026-09-01' } });
  assert.equal(h.ctx.state.selectedPlanDate, '2026-09-01');
  assert.equal(h.ctx.state.plan.length, 0);
  assert.equal(h.ctx.state.dailyPlans['2026-08-31'].length, original.length);
  control(h, 'Dzień produkcji').props.onChange({ target: { value: '2026-08-31' } });
  assert.equal(h.ctx.state.plan.length, original.length);
  control(h, 'Dzień produkcji').props.onChange({ target: { value: 'custom' } });
  assert.ok(control(h, 'Wybrana data produkcji'));
});

test('range presets, entire production and a custom 9.5 shifts preserve individual overrides', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan[0].scopeMode = 'quantity';
  h.ctx.state.plan[0].scopeQuantity = 12;
  control(h, 'Zapotrzebowanie na').props.onChange({ target: { value: '9' } });
  assert.equal(h.ctx.state.horizonShifts, 9);
  assert.equal(h.ctx.state.calculationMode, 'horizon');
  control(h, 'Zapotrzebowanie na').props.onChange({ target: { value: 'all' } });
  assert.equal(h.ctx.state.calculationMode, 'all');
  control(h, 'Zapotrzebowanie na').props.onChange({ target: { value: 'custom' } });
  const amount = nodes(h.render()).find((node) => node.props?.label === 'Liczba zmian');
  amount.props.onChange(9.5);
  assert.equal(h.ctx.state.horizonShifts, 9.5);
  assert.equal(control(h, 'Zapotrzebowanie na').props.value, 'custom');
  assert.equal(h.ctx.state.plan[0].scopeQuantity, 12);
});

test('saved custom ranges stay visible and first-version new labels are suppressed only for the baseline', () => {
  const h = createHeaderFixture({ state: { horizonShifts: 9.5 } });
  assert.equal(control(h, 'Zapotrzebowanie na').props.value, 'custom');
  assert.doesNotMatch(h.html(), />Nowa</);
  h.ctx.state.planVersions[0].versionNo = 2;
  assert.match(h.html(), />Nowa</);
});

test('read-only users can choose a day but cannot import or change range', () => {
  const h = createHeaderFixture({ readOnly: true });
  assert.equal(control(h, 'Zapotrzebowanie na').props.disabled, true);
  assert.equal(control(h, 'Status wersji'), undefined);
  assert.ok(!control(h, 'Dzień produkcji').props.disabled);
  assert.equal(control(h, 'Karta / arkusz Excela').props.disabled, true);
  assert.doesNotMatch(h.html(), /Wgraj plan|Wgraj aktualizację|Wczytaj kartę|Zapisano/);
});

test('plan details keep import metadata without manual version statuses', () => {
  const h = createHeaderFixture({ showChanges: true });
  for (const status of ['draft', 'ready', 'active', 'superseded']) {
    h.ctx.state.planVersions[0].status = status;
    assert.equal(control(h, 'Status wersji'), undefined);
    const html = h.html();
    assert.doesNotMatch(html, /Status wersji|Roboczy|Gotowy|Aktywny|Zastąpiony/);
    assert.match(html, /Wersja 1/);
    assert.match(html, /31\.08\.2026, 08:15/);
    assert.match(html, /Plan produkcji 31\.08\.2026\.xlsx/);
    assert.match(html, /Pierwsza wersja planu/);
  }
});

test('history marks newest version separately for each day and preserves differences', () => {
  const h = createHeaderFixture();
  const original = h.ctx.state.planVersions[0];
  h.ctx.state.planVersions = [
    { ...original, id: 'old', versionNo: 1, status: 'active' },
    { ...original, id: 'tomorrow', planDate: '2026-09-01', versionNo: 1, status: 'draft' },
    { ...original, id: 'latest', versionNo: 2, status: 'superseded', differences: [{ ...original.differences[0], index: 'ADDED-123' }] }
  ];
  const text = (node) => typeof node === 'string' || typeof node === 'number' ? String(node)
    : Array.isArray(node) ? node.map(text).join(' ') : node?.props ? text(node.props.children) : '';
  const rows = nodes(h.render('historia')).filter((node) => node.type === 'tr' && node.key);
  for (const row of rows) assert.match(text(row), row.key === 'old' ? /Poprzednia wersja/ : /Aktualna wersja/);
  const html = h.html('historia');
  assert.doesNotMatch(html, /Roboczy|Gotowy|Aktywny|Zastąpiony/);
  assert.equal((html.match(/Aktualna wersja/g) || []).length, 2);
  assert.equal((html.match(/Poprzednia wersja/g) || []).length, 1);
  assert.match(html, /ADDED-123/);
});

test('upload plan stays available beside update and each action opens the file chooser', () => {
  let opened = 0;
  const uploads = [];
  const h = createHeaderFixture({
    fileInputRef: { current: { click: () => { opened += 1; } } },
    handleWorkbook: (...args) => uploads.push(args)
  });
  button(h, 'Wgraj plan').props.onClick();
  const fileInput = nodes(h.render()).find((node) => node.props?.type === 'file');
  fileInput.props.onChange({ target: { files: [{ name: 'new.xlsx' }], value: 'new.xlsx' } });
  assert.equal(uploads[0][2], undefined);
  button(h, 'Wgraj aktualizację').props.onClick();
  fileInput.props.onChange({ target: { files: [{ name: 'update.xlsx' }], value: 'update.xlsx' } });
  assert.equal(uploads[1][2], '31.08');
  assert.equal(opened, 2);
});

test('choosing a workbook card waits for explicit import and can be cancelled', () => {
  const workbook = { purpose: 'plan', fileName: 'plans.xlsx', workbook: { SheetNames: ['31.08', '01.09'], Sheets: {} } };
  let imported = 0;
  const h = createHeaderFixture({ pending: workbook, importSelectedSheet: () => { imported += 1; } });
  const originalPlan = h.ctx.state.plan;
  assert.equal(control(h, 'Karta / arkusz Excela').props.disabled, false);
  assert.equal(button(h, 'Wczytaj kartę').props.disabled, true);
  control(h, 'Karta / arkusz Excela').props.onChange({ target: { value: '01.09' } });
  assert.equal(h.ctx.sheetName, '01.09');
  assert.equal(imported, 0);
  assert.equal(h.ctx.state.plan, originalPlan);
  assert.equal(button(h, 'Wczytaj kartę').props.disabled, false);
  button(h, 'Wczytaj kartę').props.onClick();
  assert.equal(imported, 1);
  nodes(h.render()).find((node) => node.props?.children === 'Anuluj').props.onClick();
  assert.equal(h.ctx.pending, null);
  assert.equal(h.ctx.state.plan, originalPlan);
});

test('last imported workbook keeps its other cards available without uploading the file again', () => {
  const workbook = { purpose: 'plan', fileName: 'plans.xlsx', workbook: { SheetNames: ['31.08', '01.09'], Sheets: {} } };
  const h = createHeaderFixture({ lastPlanWorkbook: workbook });
  assert.equal(control(h, 'Karta / arkusz Excela').props.value, '31.08');
  assert.equal(button(h, 'Wczytaj kartę').props.disabled, true);
  control(h, 'Karta / arkusz Excela').props.onChange({ target: { value: '01.09' } });
  assert.equal(h.ctx.pending, workbook);
  assert.equal(button(h, 'Wczytaj kartę').props.disabled, false);
});

test('zone filter keeps plan selections intact and counts only the chosen zone', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan[1].areaId = 'hala-1';
  h.ctx.state.plan[2].areaId = '';
  const plan = h.ctx.state.plan;
  const before = JSON.stringify(plan);
  h.ctx.updateState = () => { throw new Error('A view filter must not queue an autosave'); };
  const options = nodes(control(h, 'Strefa planu')).filter((node) => node.type === 'option').map((node) => node.props.value);
  assert.deepEqual(options, ['all', 'hala-1', 'hala-2', 'bakoma', 'lakiernia', 'narzedziownia']);
  assert.match(h.html(), /1 z 1/);
  assert.doesNotMatch(h.html(), /900197691/);
  assert.match(h.html(), /900197692/);
  assert.doesNotMatch(h.html(), /Bez przypisanej strefy/);
  control(h, 'Strefa planu').props.onChange({ target: { value: 'hala-1' } });
  assert.equal(h.ctx.state.selectedAreaId, 'hala-1');
  assert.match(h.html(), /900197691/);
  assert.doesNotMatch(h.html(), /900197690/);
  assert.equal(h.ctx.state.plan, plan);
  assert.equal(JSON.stringify(h.ctx.state.plan), before);
  control(h, 'Strefa planu').props.onChange({ target: { value: 'hala-2' } });
  assert.doesNotMatch(h.html(), /Brak pozycji w strefie: Hala 2/);
  assert.match(h.html(), /0 z 0/);
  assert.match(h.html(), /900197692/);
  assert.doesNotMatch(h.html(), /Bez przypisanej strefy/);
});

test('all-zone view shows the entire plan once without changing production or document zone', () => {
  const h = createHeaderFixture();
  const base = h.ctx.state.plan[0];
  const areas = ['hala-1', 'hala-2', 'hala-3', 'bakoma', 'lakiernia', 'narzedziownia', ''];
  h.ctx.state.areas.push({ id: 'hala-3', name: 'Hala 3' });
  h.ctx.state.plan = areas.map((areaId, index) => ({ ...base, id: `all-${index}`, index: `ALL_ZONE_ROW_${index}`, areaId,
    included: index !== 5, planGroup: index === 5 ? 'planned' : index === 4 ? 'emergency' : 'standard' }));
  const before = JSON.stringify(h.ctx.state);
  h.ctx.updateState = () => { throw new Error('A view filter must not save production changes'); };
  control(h, 'Strefa planu').props.onChange({ target: { value: 'all' } });
  assert.equal(control(h, 'Strefa planu').props.value, 'all');
  const allOption = nodes(control(h, 'Strefa planu')).find((node) => node.type === 'option' && node.props.value === 'all');
  assert.equal(allOption.props.children, 'Ogół — cały plan');
  const html = h.html();
  assert.match(html, /6 z 7/);
  assert.match(html, /pozycji całego planu zaznaczonych/);
  for (let index = 0; index < areas.length; index += 1) {
    assert.equal(html.split(`ALL_ZONE_ROW_${index}`).length - 1, 1);
    if (index > 0) assert.ok(html.indexOf(`ALL_ZONE_ROW_${index - 1}`) < html.indexOf(`ALL_ZONE_ROW_${index}`));
  }
  assert.equal(JSON.stringify(h.ctx.state), before, 'all is only a view, never a production/document area');
  control(h, 'Strefa planu').props.onChange({ target: { value: 'hala-2' } });
  assert.equal(control(h, 'Strefa planu').props.value, 'hala-2');
  assert.equal(h.ctx.state.selectedAreaId, 'hala-2');
  const filtered = h.html();
  assert.match(filtered, /ALL_ZONE_ROW_1/);
  assert.match(filtered, /ALL_ZONE_ROW_6/);
  for (const index of [0, 2, 3, 4, 5]) assert.ok(!filtered.includes(`ALL_ZONE_ROW_${index}`));
});

test('read-only users can show the whole plan and an empty plan remains empty', () => {
  const h = createHeaderFixture({ readOnly: true });
  control(h, 'Strefa planu').props.onChange({ target: { value: 'all' } });
  assert.equal(control(h, 'Strefa planu').props.value, 'all');
  assert.equal(h.ctx.state.selectedAreaId, 'bakoma');
  h.ctx.state.plan = [];
  assert.match(h.html(), /Brak planu na/);
  assert.doesNotMatch(h.html(), /<tbody>/);
});

test('bulk selection changes only visible rows, including unassigned, in one update', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan[1].areaId = 'hala-1';
  h.ctx.state.plan[2].areaId = '';
  h.ctx.state.plan[0].workingMaterials = [{ id: 'material', name: 'Test', qtyPerUnit: 0.5 }];
  const original = JSON.parse(JSON.stringify(h.ctx.state));
  const hidden = h.ctx.state.plan[1];
  const update = h.ctx.updateState;
  let writes = 0;
  h.ctx.updateState = (updater) => { writes += 1; update(updater); };
  control(h, 'Odznacz wszystkie').props.onClick();
  assert.equal(writes, 1);
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, false]);
  assert.equal(h.ctx.state.plan[1], hidden);
  assert.equal(control(h, 'Odznacz wszystkie').props.disabled, true);
  assert.equal(control(h, 'Zaznacz wszystkie').props.disabled, false);
  control(h, 'Odznacz wszystkie').props.onClick();
  assert.equal(writes, 1, 'no redundant save when every visible row is already cleared');
  control(h, 'Zaznacz wszystkie').props.onClick();
  assert.equal(writes, 2);
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [true, true, true]);
  assert.equal(control(h, 'Zaznacz wszystkie').props.disabled, true);
  control(h, 'Zaznacz wszystkie').props.onClick();
  assert.equal(writes, 2);
  assert.equal(h.ctx.state.plan[1], hidden);
  const withoutSelection = (plan) => JSON.stringify(plan.map(({ included, ...item }) => item));
  assert.equal(withoutSelection(h.ctx.state.plan), withoutSelection(original.plan));
  assert.equal(h.ctx.state.selectedAreaId, original.selectedAreaId);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ctx.state.dailyPlans)), original.dailyPlans);
  assert.deepEqual(JSON.parse(JSON.stringify(h.ctx.state.planVersions)), original.planVersions);
});

test('all-plan bulk selection covers every zone and every plan section', () => {
  const h = createHeaderFixture();
  const base = h.ctx.state.plan[0];
  const areas = ['hala-1', 'hala-2', 'hala-3', 'bakoma', 'lakiernia', 'narzedziownia', ''];
  h.ctx.state.plan = areas.map((areaId, index) => ({ ...base, id: `bulk-${index}`, areaId,
    included: index % 2 === 0, planGroup: index === 5 ? 'planned' : index === 4 ? 'emergency' : 'standard' }));
  const order = Array.from(h.ctx.state.plan, (item) => item.id);
  control(h, 'Strefa planu').props.onChange({ target: { value: 'all' } });
  control(h, 'Odznacz wszystkie').props.onClick();
  assert.ok(h.ctx.state.plan.every((item) => item.included === false));
  assert.match(h.html(), /0 z 7/);
  assert.equal(nodes(h.render()).filter((node) => node.props?.['aria-pressed'] === false).length, 7);
  control(h, 'Zaznacz wszystkie').props.onClick();
  assert.ok(h.ctx.state.plan.every((item) => item.included === true));
  assert.match(h.html(), /7 z 7/);
  assert.equal(nodes(h.render()).filter((node) => node.props?.['aria-pressed'] === true).length, 7);
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.id), order);
  assert.equal(h.ctx.state.selectedAreaId, 'bakoma');
});

test('individual selection remains available after clearing or selecting every row', () => {
  const h = createHeaderFixture();
  const rowButtons = () => nodes(h.render()).filter((node) => node.type === 'button' && typeof node.props?.['aria-pressed'] === 'boolean');
  control(h, 'Odznacz wszystkie').props.onClick();
  rowButtons()[1].props.onClick();
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, false]);
  assert.equal(rowButtons()[1].props['aria-pressed'], true);
  control(h, 'Zaznacz wszystkie').props.onClick();
  rowButtons()[0].props.onClick();
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, true]);
  assert.equal(rowButtons()[0].props['aria-pressed'], false);
  control(h, 'Dzień produkcji').props.onChange({ target: { value: '2026-09-01' } });
  control(h, 'Dzień produkcji').props.onChange({ target: { value: '2026-08-31' } });
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, true]);
});

test('read-only and empty zone views cannot change selections in bulk', () => {
  const readOnly = createHeaderFixture({ readOnly: true });
  readOnly.ctx.updateState = () => { throw new Error('Read-only bulk selection must not write'); };
  for (const label of ['Zaznacz wszystkie', 'Odznacz wszystkie']) {
    assert.equal(control(readOnly, label).props.disabled, true);
    control(readOnly, label).props.onClick();
  }
  for (const node of nodes(readOnly.render()).filter((node) => typeof node.props?.['aria-pressed'] === 'boolean')) {
    assert.equal(node.props.disabled, true);
  }
  const empty = createHeaderFixture();
  control(empty, 'Strefa planu').props.onChange({ target: { value: 'hala-1' } });
  empty.ctx.updateState = () => { throw new Error('An empty view must not write'); };
  for (const label of ['Zaznacz wszystkie', 'Odznacz wszystkie']) {
    assert.equal(control(empty, label).props.disabled, true);
    control(empty, label).props.onClick();
  }
  empty.ctx.state.plan = [];
  assert.equal(control(empty, 'Zaznacz wszystkie'), undefined);
  assert.equal(control(empty, 'Odznacz wszystkie'), undefined);
});

test('a delayed bulk update cannot change another production day', () => {
  const h = createHeaderFixture();
  let queued;
  h.ctx.updateState = (updater) => { queued = updater; };
  control(h, 'Odznacz wszystkie').props.onClick();
  const otherDay = { ...h.ctx.state, selectedPlanDate: '2026-09-01' };
  assert.equal(queued(otherDay), otherDay);
});

test('unassigned rows stay in the main list, in source order, exactly once in every zone', () => {
  const h = createHeaderFixture();
  h.ctx.state.areas.push({ id: 'hala-3', name: 'Hala 3' });
  const base = h.ctx.state.plan[0];
  h.ctx.state.plan = [
    { ...base, id: 'first', index: 'FIRST_HALL_1', areaId: 'hala-1' },
    { ...base, id: 'unassigned', index: 'VISIBLE_UNASSIGNED', areaId: '', included: false },
    { ...base, id: 'last', index: 'LAST_HALL_1', areaId: 'hala-1' },
    { ...base, id: 'hall2', index: 'ONLY_HALL_2', areaId: 'hala-2' }
  ];
  const original = JSON.stringify(h.ctx.state.plan);
  for (const areaId of ['hala-1', 'hala-2', 'hala-3', 'bakoma', 'lakiernia', 'narzedziownia']) {
    control(h, 'Strefa planu').props.onChange({ target: { value: areaId } });
    const html = h.html();
    assert.equal(html.split('VISIBLE_UNASSIGNED').length - 1, 1, areaId);
    assert.doesNotMatch(html, /Bez przypisanej strefy|Brak pozycji w strefie/);
    for (const details of nodes(h.render()).filter((node) => node.type === 'details')) {
      assert.ok(!nodes(details).some((node) => node.props?.children === 'VISIBLE_UNASSIGNED'), 'unassigned row must not be collapsed');
    }
    if (areaId === 'hala-1') {
      assert.ok(html.indexOf('FIRST_HALL_1') < html.indexOf('VISIBLE_UNASSIGNED'));
      assert.ok(html.indexOf('VISIBLE_UNASSIGNED') < html.indexOf('LAST_HALL_1'));
      assert.doesNotMatch(html, /ONLY_HALL_2/);
    } else {
      assert.doesNotMatch(html, /FIRST_HALL_1|LAST_HALL_1/);
    }
    assert.equal(JSON.stringify(h.ctx.state.plan), original, 'filter does not assign, duplicate or toggle rows');
  }
  h.ctx.state.plan[1].areaId = 'hala-2';
  for (const areaId of ['hala-1', 'hala-2', 'hala-3', 'bakoma', 'lakiernia', 'narzedziownia']) {
    control(h, 'Strefa planu').props.onChange({ target: { value: areaId } });
    assert.equal(h.html().includes('VISIBLE_UNASSIGNED'), areaId === 'hala-2', 'assigned row belongs only to its zone');
  }
});

test('unassigned quantity warnings remain visible without a second copy of the plan row', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan = [{ ...h.ctx.state.plan[0], areaId: '', quantityStatus: 'missing' }];
  const html = h.html();
  assert.match(html, /Ilość do wyjaśnienia/);
  const rows = nodes(h.render()).filter((node) => node.type === 'tr');
  assert.equal(rows.length, 2, 'one table header and one unassigned detail');
  assert.doesNotMatch(html, /Bez przypisanej strefy/);
});

test('zone filtering retains emergency and unchecked planned rows, but excludes other zones warnings', () => {
  const h = createHeaderFixture();
  const base = h.ctx.state.plan[0];
  h.ctx.state.plan = [
    { ...base, id: 'a', index: 'ACTIVE', planGroup: 'standard' },
    { ...base, id: 'b', index: 'EMERGENCY', planGroup: 'emergency' },
    { ...base, id: 'c', index: 'PLANNED', planGroup: 'planned', included: false },
    { ...base, id: 'd', index: 'OTHER_ZONE', areaId: 'hala-1', quantityStatus: 'unrecognized' }
  ];
  const html = h.html();
  for (const index of ['ACTIVE', 'EMERGENCY', 'PLANNED']) assert.match(html, new RegExp(index));
  assert.doesNotMatch(html, /OTHER_ZONE|Ilość do wyjaśnienia/);
  assert.match(html, /2 z 3/);
  assert.match(html, /Brak technologii: 2/);
});

test('read-only users can filter zones, but shared storage and invalid zones cannot be selected', () => {
  const h = createHeaderFixture({ readOnly: true });
  assert.ok(!control(h, 'Strefa planu').props.disabled);
  control(h, 'Strefa planu').props.onChange({ target: { value: 'narzedziownia' } });
  assert.equal(h.ctx.state.selectedAreaId, 'narzedziownia');
  for (const value of ['shared', 'missing']) control(h, 'Strefa planu').props.onChange({ target: { value } });
  assert.equal(h.ctx.state.selectedAreaId, 'narzedziownia');
});
