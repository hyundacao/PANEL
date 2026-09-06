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

test('product autocomplete selects the exact pressed suggestion', () => {
  const h = createHeaderFixture();
  const items = [
    { id: 'catalog-1', index: 'M-1-ETY-SEN-8434', name: 'ETYKIETA PLASTIK BORDER EDGE 45X80X1000 SENUKAI 4772013258278' },
    { id: 'catalog-2', index: 'M-1-ETY-SEN-8436', name: 'ETYKIETA PLASTIK BORDER EDGE 70X80X1000 SENUKAI 4772013258285' },
    { id: 'catalog-3', index: '8001128772', name: 'MAX BO VG1 CP BODY 07020 + HANDLE - LOGOCLIP' },
    { id: 'catalog-4', index: '1772', name: 'WPUST Z BOCZNYM ODPŁYWEM 150X150X86 BRĄZ' }
  ];
  let selected = null;
  const field = h.productCatalogField({
    label: 'Nazwa produktu', mode: 'name', value: '772 bo', items, loading: false,
    onChange: () => {}, onSelect: (item) => { selected = item; }
  });
  const options = nodes(field).filter((node) => node.type === 'button');
  assert.equal(options.length, 4);
  let prevented = false;
  options[3].props.onMouseDown({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(selected, items[3]);
});

test('technology editor starts with an empty unpersisted draft instead of the first library item', () => {
  const h = createHeaderFixture();
  const technologies = [{
    id: 'existing-tech', productIndex: '8001128772', productName: 'MAX BO VG1',
    variant: 'base', alternativeNo: 1, description: '', notes: '', shiftNorm: 700,
    materials: [], archived: false
  }];
  const initial = h.technologyEditorState(technologies, '');
  assert.equal(initial.selected, null);
  assert.equal(initial.draft.id, '');
  assert.equal(initial.draft.productIndex, '');
  assert.equal(initial.draft.productName, '');
  assert.equal(initial.draft.materials.length, 0);
  assert.equal(h.technologyEditorState(technologies, 'existing-tech').selected, technologies[0]);
});

test('technology editor draft detects nested material changes without mutating the saved source', () => {
  const h = createHeaderFixture();
  const technology = {
    id: 'existing-tech', productIndex: '8001128772', productName: 'MAX BO VG1',
    variant: 'base', alternativeNo: 0, description: '', notes: '', shiftNorm: 700,
    materials: [{ id: 'material-1', code: 'ABS-1', name: 'ABS BLACK', category: 'Tworzywo', usage: 0.064, unit: 'kg', logisticQty: 1 }],
    archived: false
  };
  const editor = h.technologyEditorState([technology], technology.id);
  const draft = editor.clone(technology);
  assert.equal(editor.isSame(draft, technology), true);
  draft.materials[0].usage = 0.072;
  assert.equal(editor.isSame(draft, technology), false);
  assert.equal(technology.materials[0].usage, 0.064);
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

test('one mould run is rendered as one group with separate detail technologies', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan = h.ctx.state.plan.slice(0, 2).map((item, index) => ({
    ...item,
    included: true,
    productionGroupId: 'production-1',
    productionOutputOrder: index,
    productionOutputCount: 2,
    shiftNorm: 1485
  }));
  const rendered = h.render();
  const html = h.html();
  assert.equal((html.match(/Wspólna forma/g) || []).length, 1);
  assert.match(html, /Technologie 0\/2/);
  assert.match(html, /1485 szt\. każdego detalu \/ zmianę/);
  const groupToggle = nodes(rendered).find((node) => node.props?.title === 'Wyłącz całą wspólną produkcję z obliczeń');
  assert.ok(groupToggle);
  groupToggle.props.onClick();
  assert.ok(h.ctx.state.plan.every((item) => !item.included));
});

test('expanded plan index has a visible bounded block and an end separator', () => {
  const h = createHeaderFixture();
  const item = h.ctx.state.plan[0];
  h.ctx.expandedPlan = item.id;
  const rendered = h.render();
  const row = nodes(rendered).find((node) => node.props?.['data-plan-item'] === item.id);
  const details = nodes(rendered).find((node) => node.props?.['data-plan-details'] === item.id);
  const separator = nodes(rendered).find((node) => node.props?.['data-plan-separator'] === item.id);
  assert.equal(row.props['data-expanded'], 'true');
  assert.match(row.props.className, /border-y/);
  assert.match(row.props.className, /rgba\(255,122,26,0\.58\)/);
  assert.match(details.props.className, /border-t/);
  assert.match(separator.props.className, /\bh-2\b/);
  assert.doesNotMatch(h.html(), /Indeks produkcyjny/);
});

test('expanded plan edits expose one explicit save action', () => {
  const h = createHeaderFixture({ calculationEditorDirty: true });
  h.ctx.expandedPlan = h.ctx.state.plan[0].id;
  const html = h.html();
  assert.match(html, /Niezapisane zmiany/);
  assert.equal(html.split('Zapisz zmiany').length - 1, 1);
  assert.match(html, /Odrzuć niezapisane zmiany/);
  assert.equal(html.split('>Odrzuć<').length - 1, 1);
});

test('expanded plan can start a described emergency variant from its working recipe', () => {
  const h = createHeaderFixture();
  const item = h.ctx.state.plan[0];
  const base = {
    id: 'base-tech', productIndex: item.index, productName: item.name,
    variant: 'base', alternativeNo: 0, description: '', notes: '', shiftNorm: 380,
    materials: [{ id: 'base-material', code: 'ABS-1', name: 'ABS BLACK', category: 'Tworzywo', usage: 0.12, unit: 'kg', logisticQty: 1 }],
    emergencyMaterials: [], archived: false
  };
  h.ctx.state.technologies = [base];
  h.ctx.state.plan[0] = { ...item, technologyId: base.id, workingMaterials: base.materials };
  h.ctx.expandedPlan = item.id;
  h.ctx.technologiesFor = () => [base];
  h.ctx.technologyForItem = () => base;
  h.ctx.materialsForItem = () => [];

  const addEmergency = button(h, 'Zapisz jako awaryjną');
  assert.ok(addEmergency);
  addEmergency.props.onClick();
  assert.match(h.html(), /Opis wariantu · Awaryjna 1/);
  assert.ok(control(h, 'Opis nowego wariantu awaryjnego'));
  assert.match(h.html(), /Utwórz wariant/);
});

test('working recipe becomes the next numbered emergency technology without changing earlier variants', () => {
  const h = createHeaderFixture();
  const materials = [{ id: 'working-material', code: 'KAR-2', name: 'Karton zastępczy', category: 'Karton', usage: 0.025, unit: 'szt.', logisticQty: 1 }];
  const technologies = [
    { id: 'base', productIndex: '8001', productName: 'DETAL', variant: 'base', alternativeNo: 0, description: '', notes: 'Uwaga', shiftNorm: 400, materials: [], emergencyMaterials: [], archived: false },
    { id: 'alt-1', productIndex: '8001', productName: 'DETAL', variant: 'alternative', alternativeNo: 1, description: 'Pierwsza', notes: '', shiftNorm: 400, materials: [], emergencyMaterials: [], archived: false }
  ];
  const result = h.createAlternative(technologies, 'base', materials, 450, '  Karton 600x400  ');

  assert.equal(result.technologies.length, 3);
  assert.equal(result.technology.variant, 'alternative');
  assert.equal(result.technology.alternativeNo, 2);
  assert.equal(result.technology.description, 'Karton 600x400');
  assert.equal(result.technology.shiftNorm, 450);
  assert.equal(result.technology.materials[0].name, 'Karton zastępczy');
  assert.notEqual(result.technology.materials[0].id, materials[0].id);
  assert.equal(technologies.length, 2);
});

test('header groups plan controls and source metadata without repeated statistics cards', () => {
  const h = createHeaderFixture();
  assert.ok(control(h, 'Dzień produkcji'));
  assert.ok(control(h, 'Zapotrzebowanie na'));
  assert.ok(control(h, 'Strefa planu'));
  assert.equal(control(h, 'Karta / arkusz Excela'), undefined);
  const html = h.html();
  assert.match(html, /Plan produkcyjny/);
  assert.match(html, /Wgrany plik|Arkusz|Ostatni import/);
  assert.equal((html.match(/Produkty do realizacji/g) || []).length, 1);
  assert.match(html, /Zapisano/);
  assert.doesNotMatch(html, /Osobny moduł produkcyjny|Globalny zakres obliczeń|Pokaż zmiany/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:[=>\s])/);
  assert.doesNotMatch(html, />Nowa</);
});

test('primary plan controls stay symmetrical and list tools stay beside the products', () => {
  const h = createHeaderFixture();
  for (const label of ['Dzień produkcji', 'Zapotrzebowanie na']) {
    assert.match(control(h, label).props.className, /h-\[52px\]/);
    assert.match(control(h, label).props.className, /min-h-\[52px\]/);
  }
  const documentAction = button(h, 'Utwórz dokument do wypisania');
  assert.match(documentAction.props.className, /h-\[52px\]/);
  assert.match(documentAction.props.className, /min-h-\[52px\]/);

  const listFilters = nodes(h.render()).find((node) => node.props?.['data-plan-list-filters']);
  assert.ok(listFilters);
  assert.ok(nodes(listFilters).some((node) => node.props?.['aria-label'] === 'Wyszukaj produkt w planie'));
  assert.ok(nodes(listFilters).some((node) => node.props?.['aria-label'] === 'Strefa planu'));
  assert.equal(control(h, 'Zaznacz wszystkie'), undefined);
  assert.equal(control(h, 'Odznacz wszystkie'), undefined);
  const includeAll = control(h, 'Zaznacz wszystkie widoczne pozycje');
  assert.ok(includeAll);
  assert.equal(includeAll.props.role, 'checkbox');
  assert.equal(includeAll.props['aria-checked'], 'mixed');
  assert.match(h.html(), /Produkty do realizacji.*3 pozycje/);
  assert.match(h.html(), /Stanowisko \/ strefa/);
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
  assert.equal(control(h, 'Strefa planu').props.value, 'all');

  h.ctx.editablePickingDocumentExists = true;
  control(h, 'Strefa planu').props.onChange({ target: { value: 'bakoma' } });
  assert.ok(button(h, 'Przelicz i pokaż dokument'));
});

test('document action explains when an active row has no usable quantity', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan[0].quantityStatus = 'missing';
  h.ctx.state.plan[0].sourceQuantity = '';
  const blocked = button(h, 'Uzupełnij ilości (1)');
  assert.ok(blocked);
  assert.equal(blocked.props.disabled, true);
  assert.equal(blocked.props.title, 'Najpierw uzupełnij ilości aktywnych pozycji');

  h.ctx.state.plan[0].included = false;
  assert.equal(button(h, 'Utwórz dokument do wypisania').props.disabled, false);
});

test('continuous production replaces a missing final quantity with output for the selected shift range', () => {
  const technology = {
    id: 'continuous-tray', productIndex: 'M-10-8001128941', productName: 'TRAY HANDLE BO CLIPPED VG1 VZF07020',
    productionMode: 'continuous', shiftNorm: 1600, materials: []
  };
  const h = createHeaderFixture({
    technologyForItem: (item) => item.technologyId === technology.id ? technology : undefined,
    technologiesFor: (item) => item.index === technology.productIndex ? [technology] : [],
    itemProductionQty: (item) => item.technologyId === technology.id ? 5600 : 0
  });
  h.ctx.state.plan = [{
    ...h.ctx.state.plan[0], id: 'tray', index: technology.productIndex, name: technology.productName,
    technologyId: technology.id, totalQty: 0, remainingQty: 0, shiftNorm: 0,
    sourceQuantity: '', quantityStatus: 'missing', included: true
  }];
  const html = h.html();
  assert.match(html, /Ciągła/);
  assert.match(html, /5[\s\u00a0]?600 szt\. w zakresie/);
  assert.doesNotMatch(html, /Brak ilości w pliku|Uzupełnij ilości \(1\)/);
  assert.ok(button(h, 'Utwórz dokument do wypisania'));
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

test('saved custom ranges stay visible without plan-version difference labels', () => {
  const h = createHeaderFixture({ state: { horizonShifts: 9.5 } });
  assert.equal(control(h, 'Zapotrzebowanie na').props.value, 'custom');
  assert.doesNotMatch(h.html(), />Nowa</);
  h.ctx.state.planVersions[0].versionNo = 2;
  assert.doesNotMatch(h.html(), />Nowa</);
});

test('read-only users can choose a day but cannot import or change range', () => {
  const h = createHeaderFixture({ readOnly: true });
  assert.equal(control(h, 'Zapotrzebowanie na').props.disabled, true);
  assert.equal(control(h, 'Status wersji'), undefined);
  assert.ok(!control(h, 'Dzień produkcji').props.disabled);
  assert.equal(control(h, 'Karta / arkusz Excela'), undefined);
  assert.doesNotMatch(h.html(), /Wgraj plan|Wgraj aktualizację|Wczytaj kartę|Zapisano/);
});

test('plan header keeps compact import metadata without differences or manual version statuses', () => {
  const h = createHeaderFixture();
  for (const status of ['draft', 'ready', 'active', 'superseded']) {
    h.ctx.state.planVersions[0].status = status;
    assert.equal(control(h, 'Status wersji'), undefined);
    const html = h.html();
    assert.doesNotMatch(html, /Status wersji|Roboczy|Gotowy|Aktywny|Zastąpiony/);
    assert.match(html, /Wersja 1/);
    assert.match(html, /31\.08\.2026, 08:15/);
    assert.match(html, /Plan produkcji 31\.08\.2026\.xlsx/);
    assert.doesNotMatch(html, /Szczegóły planu|Pierwsza wersja planu|legacy-new/);
  }
});

test('planning module does not expose the history tile or accept its query view', () => {
  const pageSource = readFileSync(new URL('../../app/(main)/planowanie-zapotrzebowania/page.tsx', import.meta.url), 'utf8');
  const desktopNavigation = readFileSync(new URL('../../components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  const mobileNavigation = readFileSync(new URL('../../app/(main)/layout.tsx', import.meta.url), 'utf8');
  const acceptedViews = pageSource.match(/requestedView && \[([^\]]+)]\.includes\(requestedView\)/)?.[1] ?? '';

  assert.doesNotMatch(acceptedViews, /historia/);
  assert.doesNotMatch(desktopNavigation, /planowanie-zapotrzebowania\?view=historia/);
  assert.doesNotMatch(mobileNavigation, /planowanie-zapotrzebowania\?view=historia/);
  assert.doesNotMatch(pageSource, /8\. Zwroty i historia/);
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
  assert.equal(Boolean(control(h, 'Karta / arkusz Excela').props.disabled), false);
  assert.equal(button(h, 'Wczytaj arkusz').props.disabled, true);
  control(h, 'Karta / arkusz Excela').props.onChange({ target: { value: '01.09' } });
  assert.equal(h.ctx.sheetName, '01.09');
  assert.equal(imported, 0);
  assert.equal(h.ctx.state.plan, originalPlan);
  assert.equal(button(h, 'Wczytaj arkusz').props.disabled, false);
  button(h, 'Wczytaj arkusz').props.onClick();
  assert.equal(imported, 1);
  button(h, 'Anuluj').props.onClick();
  assert.equal(h.ctx.pending, null);
  assert.equal(h.ctx.state.plan, originalPlan);
});

test('last imported workbook keeps its other cards available without uploading the file again', () => {
  const workbook = { purpose: 'plan', fileName: 'plans.xlsx', workbook: { SheetNames: ['31.08', '01.09'], Sheets: {} } };
  const h = createHeaderFixture({ lastPlanWorkbook: workbook });
  assert.equal(control(h, 'Karta / arkusz Excela').props.value, '31.08');
  assert.equal(button(h, 'Wczytaj arkusz'), undefined);
  control(h, 'Karta / arkusz Excela').props.onChange({ target: { value: '01.09' } });
  assert.equal(h.ctx.pending, workbook);
  assert.equal(button(h, 'Wczytaj arkusz').props.disabled, false);
});

test('zone filter keeps plan selections intact and counts only matching products', () => {
  const h = createHeaderFixture();
  h.ctx.state.plan[1].areaId = 'hala-1';
  h.ctx.state.plan[2].areaId = '';
  const plan = h.ctx.state.plan;
  const before = JSON.stringify(plan);
  h.ctx.updateState = () => { throw new Error('A view filter must not queue an autosave'); };
  const options = nodes(control(h, 'Strefa planu')).filter((node) => node.type === 'option').map((node) => node.props.value);
  assert.deepEqual(options, ['all', 'hala-1', 'hala-2', 'bakoma', 'lakiernia', 'narzedziownia']);
  assert.match(h.html(), /2 pozycje/);
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
  assert.match(h.html(), /1 pozycja/);
  assert.match(h.html(), /900197692/);
  assert.doesNotMatch(h.html(), /Bez przypisanej strefy/);
});

test('plan search requires every fragment and checks index, name and station', () => {
  const h = createHeaderFixture();
  const search = control(h, 'Wyszukaj produkt w planie');
  search.props.onChange({ target: { value: 'max 691' } });
  let html = h.html();
  assert.match(html, /900197691/);
  assert.doesNotMatch(html, /900197690|900197692/);
  assert.match(html, /1 pozycja/);

  control(h, 'Wyszukaj produkt w planie').props.onChange({ target: { value: 'st 1 maint' } });
  html = h.html();
  assert.match(html, /900197692/);
  assert.doesNotMatch(html, /900197690|900197691/);

  control(h, 'Wyszukaj produkt w planie').props.onChange({ target: { value: 'nieistniejący produkt' } });
  assert.match(h.html(), /Brak produktów pasujących do wyszukiwania/);
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
  assert.equal(allOption.props.children, 'Wszystkie strefy');
  const html = h.html();
  assert.match(html, /7 pozycji/);
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

test('returns have an independent zone filter with an all-zones overview', () => {
  const areaLabels = { 'hala-1': 'Hala 1', 'hala-2': 'Hala 2', bakoma: 'Bakoma', lakiernia: 'Lakiernia', narzedziownia: 'Narzędziownia' };
  const returnRows = [
    { id: 'return-h1', planDate: '2026-08-31', code: 'RETURN-H1', name: 'Zwrot z hali 1', category: 'Tworzywo', unit: 'kg', areaId: 'hala-1', surplus: 12, status: 'open' },
    { id: 'return-h2', planDate: '2026-08-31', code: 'RETURN-H2', name: 'Zwrot z hali 2', category: 'Karton', unit: 'szt.', areaId: 'hala-2', surplus: 8, status: 'completed' },
    { id: 'return-bakoma', planDate: '2026-08-31', code: 'RETURN-BAKOMA', name: 'Zwrot z Bakomy', category: 'Pozostałe', unit: 'szt.', areaId: 'bakoma', surplus: 4, status: 'open' }
  ];
  const h = createHeaderFixture({
    deriveReturnsForDate: () => returnRows,
    areaName: (areaId) => areaLabels[areaId] ?? 'Brak przypisu',
    state: {
      inventory: returnRows.map((row) => ({ ...row, qty: row.surplus })),
      inventorySourceDate: '2026-08-31',
      inventorySyncedAt: '31.08.2026, 12:00'
    }
  });
  h.ctx.materialsForItem = () => [{ code: 'USED', name: 'Materiał planowany' }];
  h.ctx.updateState = () => { throw new Error('A return view filter must not change saved planning data'); };

  const zoneFilter = () => nodes(h.render('zwroty')).find((node) => node.props?.['aria-label'] === 'Strefa zwrotów');
  assert.deepEqual(nodes(zoneFilter()).filter((node) => node.type === 'option').map((node) => node.props.value), [
    'all', 'hala-1', 'hala-2', 'bakoma', 'lakiernia', 'narzedziownia'
  ]);
  assert.equal(zoneFilter().props.value, 'all');
  let html = h.html('zwroty');
  for (const row of returnRows) assert.match(html, new RegExp(row.code));

  zoneFilter().props.onChange({ target: { value: 'hala-1' } });
  assert.equal(h.ctx.returnAreaFilter, 'hala-1');
  assert.equal(h.ctx.state.selectedAreaId, 'bakoma', 'return filtering must not replace the plan/document zone');
  html = h.html('zwroty');
  assert.match(html, /RETURN-H1/);
  assert.doesNotMatch(html, /RETURN-H2|RETURN-BAKOMA/);

  zoneFilter().props.onChange({ target: { value: 'narzedziownia' } });
  html = h.html('zwroty');
  assert.match(html, /Brak zwrotów w strefie: Narzędziownia/);
  assert.doesNotMatch(html, /RETURN-H1|RETURN-H2|RETURN-BAKOMA/);

  zoneFilter().props.onChange({ target: { value: 'all' } });
  assert.equal(zoneFilter().props.value, 'all');
  assert.match(h.html('zwroty'), /RETURN-H1/);
});

test('read-only users can show the whole plan and an empty plan remains empty', () => {
  const h = createHeaderFixture({ readOnly: true });
  control(h, 'Strefa planu').props.onChange({ target: { value: 'all' } });
  assert.equal(control(h, 'Strefa planu').props.value, 'all');
  assert.equal(h.ctx.state.selectedAreaId, 'bakoma');
  h.ctx.state.plan = [];
  assert.match(h.html(), /Brak planu na/);
  assert.equal(nodes(h.render()).filter((node) => node.props?.['data-plan-item']).length, 0);
});

test('each product remains individually included or excluded from calculations', () => {
  const h = createHeaderFixture();
  const rowButtons = () => nodes(h.render()).filter((node) => node.type === 'button' && typeof node.props?.['aria-pressed'] === 'boolean');
  rowButtons()[0].props.onClick();
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, false]);
  assert.equal(rowButtons()[0].props['aria-pressed'], false);
  control(h, 'Dzień produkcji').props.onChange({ target: { value: '2026-09-01' } });
  control(h, 'Dzień produkcji').props.onChange({ target: { value: '2026-08-31' } });
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, false]);
});

test('include-column checkbox selects or clears every currently visible product', () => {
  const h = createHeaderFixture();
  const partial = control(h, 'Zaznacz wszystkie widoczne pozycje');
  assert.equal(partial.props['aria-checked'], 'mixed');
  partial.props.onClick();
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [true, true, true]);

  const selected = control(h, 'Odznacz wszystkie widoczne pozycje');
  assert.equal(selected.props['aria-checked'], true);
  selected.props.onClick();
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, false, false]);

  control(h, 'Wyszukaj produkt w planie').props.onChange({ target: { value: '691' } });
  control(h, 'Zaznacz wszystkie widoczne pozycje').props.onClick();
  assert.deepEqual(Array.from(h.ctx.state.plan, (item) => item.included), [false, true, false]);
});

test('read-only users cannot change individual calculation inclusion', () => {
  const readOnly = createHeaderFixture({ readOnly: true });
  for (const node of nodes(readOnly.render()).filter((node) => typeof node.props?.['aria-pressed'] === 'boolean')) {
    assert.equal(node.props.disabled, true);
  }
  const includeAll = control(readOnly, 'Zaznacz wszystkie widoczne pozycje');
  assert.equal(includeAll.props.disabled, true);
  assert.equal(includeAll.props['aria-checked'], 'mixed');
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
  assert.match(html, /Brak ilości: 1/);
  const rows = nodes(h.render()).filter((node) => node.props?.['data-plan-item']);
  assert.equal(rows.length, 1, 'one unassigned detail block');
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
  assert.doesNotMatch(html, /OTHER_ZONE|Brak ilości:/);
  assert.match(html, /3 pozycje/);
  assert.match(html, /Produkty do realizacji/);
});

test('read-only users can filter zones, but shared storage and invalid zones cannot be selected', () => {
  const h = createHeaderFixture({ readOnly: true });
  assert.ok(!control(h, 'Strefa planu').props.disabled);
  control(h, 'Strefa planu').props.onChange({ target: { value: 'narzedziownia' } });
  assert.equal(h.ctx.state.selectedAreaId, 'narzedziownia');
  for (const value of ['shared', 'missing']) control(h, 'Strefa planu').props.onChange({ target: { value } });
  assert.equal(h.ctx.state.selectedAreaId, 'narzedziownia');
});
