const { chromium } = require('C:/Users/hyund/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const XLSX = require('xlsx');

const date = '2026-10-19';
const material = { id: 'pp', code: 'M-1-PP', name: 'TWORZYWO TESTOWE', category: 'Tworzywo', usage: 0.02, unit: 'kg', logisticQty: 1 };
const items = ['A', 'B'].map(id => ({ id, runId: id, index: id, name: 'DETAL ' + id, station: 'WTR ' + (id === 'A' ? 1 : 2),
  areaId: 'hala-1', totalQty: 1000, remainingQty: 1000, shiftNorm: 1000, notes: '', included: true, technologyId: 'tech-' + id,
  workingMaterials: null, manualOverride: false, scopeMode: 'all', quantityStatus: 'parsed' }));
const initial = { version: 1, selectedPlanDate: date, selectedAreaId: 'hala-1', planName: 'Test.xlsx', planSheet: date,
  planImportedAt: date, activePlanVersionId: '', horizonShifts: 3.5, calculationMode: 'all', continuationBufferPercent: 0,
  areas: [{ id: 'hala-1', name: 'Hala 1' }], stationMappings: items.map(item => ({ station: item.station, areaId: item.areaId })),
  technologies: items.map(item => ({ id: item.technologyId, productIndex: item.index, productName: item.name, variant: 'base',
    alternativeNo: 0, description: '', notes: '', shiftNorm: 1000, materials: [material], archived: false })),
  plan: items, dailyPlans: { [date]: items }, fixedDevices: [], palletSets: [], planVersions: [], quantityCorrections: [], documents: [],
  returnStatuses: {}, returnExclusions: [], inventory: [], inventorySourceDate: '', inventorySyncedAt: '', pickingDone: {}, archive: [], updatedAt: date };
const user = { id: 'test-user', name: 'Test', username: 'test', role: 'HEAD_ADMIN', isActive: true, access: { admin: true, warehouses: {} } };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [label, viewport, mobile, theme] of [['desktop', { width: 1700, height: 1050 }, false, 'dark'], ['mobile', { width: 390, height: 844 }, true, 'dark'], ['light', { width: 1440, height: 1000 }, false, 'light']]) {
      let state = structuredClone(initial);
      let revision = 1;
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', acceptDownloads: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await context.addInitScript(({ user, theme }) => localStorage.setItem('apka-ui', JSON.stringify({ state: {
        user, theme, role: user.role, activeWarehouse: 'PLANOWANIE_ZAPOTRZEBOWANIA', sidebarCollapsed: true }, version: 0 })), { user, theme });
      // Every API request is intercepted. All saves stay in this in-memory fixture.
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data = [];
        if (url.pathname === '/api/auth/session') data = user;
        if (url.pathname === '/api/planowanie-zapotrzebowania') {
          if (url.searchParams.get('source') === 'original-inventory') data = { dateKey: date, syncedAt: new Date().toISOString(), rows: [{ ...material, areaId: 'hala-1', qty: 0 }] };
          else if (url.searchParams.has('source')) data = { items: [], state, sharedRevision: revision };
          else if (route.request().method() === 'PUT') {
            const payload = route.request().postDataJSON();
            state = { ...state, ...payload.state };
            revision = payload.expectedRevision + 1;
            data = { revision, sharedRevision: revision };
          } else data = { state, revision, sharedRevision: revision };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      const open = async () => {
        await page.goto('http://127.0.0.1:3000/planowanie-zapotrzebowania?view=plan', { waitUntil: 'networkidle', timeout: 120000 });
        await page.getByTitle('Rozwiń pozycję', { exact: true }).first().click();
      };
      const field = page.getByRole('textbox', { name: 'Do wypisania: TWORZYWO TESTOWE (kg)', exact: true });
      const save = async () => {
        await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
        await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Zapisz zmiany' && button.disabled));
      };
      await open();
      assert.equal(await field.inputValue(), '20');
      await field.fill('40');
      assert.equal(state.plan[0].issueQuantityOverrides, undefined, 'editing must wait for explicit save');
      await save();
      assert.equal(state.plan[0].issueQuantityOverrides['m-1-pp|kg'].quantity, 40);
      assert.equal(state.technologies[0].materials[0].usage, 0.02);
      assert.equal(state.plan[0].manualOverride, false);
      await field.fill('99');
      await page.getByRole('button', { name: 'Odrzuć niezapisane zmiany', exact: true }).click();
      assert.equal(await field.inputValue(), '40');
      await page.getByRole('button', { name: 'Przywróć wyliczenie automatyczne: Do wypisania: TWORZYWO TESTOWE (kg)', exact: true }).click();
      assert.equal(await field.inputValue(), '20');
      await save();
      assert.equal(state.plan[0].issueQuantityOverrides['m-1-pp|kg'], undefined);
      await field.fill('40,5');
      await save();
      assert.equal(state.plan[0].issueQuantityOverrides['m-1-pp|kg'].quantity, 40.5);
      await field.fill('100');
      await save();
      await open();
      assert.equal(await field.inputValue(), '100');
      await field.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow');
      await page.screenshot({ path: path.join(__dirname, 'manual-issue-' + label + '.png'), fullPage: true });
      await page.getByRole('button', { name: 'Utwórz dokument do wypisania', exact: true }).click();
      const documentRow = page.locator('tr').filter({ has: page.getByText(material.code, { exact: true }) });
      await page.getByRole('button', { name: new RegExp(date.replaceAll('-', '')) }).waitFor();
      if (!await documentRow.isVisible()) await page.getByRole('button', { name: new RegExp(date.replaceAll('-', '')) }).click();
      await documentRow.waitFor();
      assert.deepEqual((await documentRow.locator('td').allTextContents()).slice(4), ['40', '0', '120', 'kg']);
      const downloadPromise = page.waitForEvent('download');
      await page.getByTitle('Eksportuj widoczne pozycje do Excel', { exact: true }).click();
      const download = await downloadPromise;
      const workbook = XLSX.readFile(await download.path());
      const exported = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
      assert.equal(exported[1][14], 120);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ label, editSaveDiscardResetReload: true, manual: 100, documentAndExcel: 120, consoleErrors: 0 }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
