const { chromium } = require('C:/Users/hyund/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const XLSX = require('xlsx');

const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
const name = 'METAL BOX 1230X830X730';
const code = 'M-4-BSHL-786-015';
const user = { id: 'test-user', name: 'Test', username: 'test', role: 'HEAD_ADMIN', isActive: true, access: { admin: true, warehouses: {} } };
const items = [6, 18].map((qty, index) => ({ id: 'detail-' + index, runId: 'run-' + index, index: 'DETAIL-' + index, name: 'Detal ' + index,
  station: 'WTR ' + (index + 1), areaId: 'hala-1', totalQty: 1, remainingQty: 1, shiftNorm: 1000, notes: '', included: true,
  technologyId: 'tech-' + index, workingMaterials: null, manualOverride: false, continuationCandidateId: '', scopeMode: 'all', quantityStatus: 'parsed' }));
const rows = [6, 18].map((qty, index) => ({ key: code.toLowerCase() + '|' + (index ? 'szt.' : 'szt'), code, name, warehouseCode: 'M-4',
  category: 'Inne', unit: index ? 'szt.' : 'szt', demand: qty, areaStock: index ? 6 : 0, issuedBefore: 0, pendingBefore: 0,
  toIssue: index ? 12 : 6, confirmed: index === 0, sources: [{ planItemId: items[index].id, index: items[index].index, name: items[index].name, demand: qty }] }));
const document = { id: 'document-1', documentNo: 'TEST-METAL-BOX', planDate: date, areaId: 'hala-1', planVersionId: '', planVersionNo: 1,
  status: 'draft', kind: 'base', scopeLabel: 'Caly plan', createdBy: 'Test', createdAt: date, rows };
const state = { version: 1, planName: 'Test.xlsx', planSheet: date, planImportedAt: date, selectedPlanDate: date,
  activePlanVersionId: '', horizonShifts: 3.5, calculationMode: 'all', continuationBufferPercent: 0, selectedAreaId: 'hala-1',
  areas: [{ id: 'hala-1', name: 'Hala 1' }], stationMappings: items.map(item => ({ station: item.station, areaId: item.areaId })),
  fixedDevices: [], palletSets: [], technologies: items.map((item, index) => ({ id: item.technologyId, productIndex: item.index,
    productName: item.name, variant: 'base', alternativeNo: 0, description: '', notes: '', shiftNorm: 1000,
    materials: [{ id: 'metal', code, name, category: 'Inne', unit: rows[index].unit, usage: rows[index].demand, logisticQty: 1 }], archived: false })),
  plan: items, dailyPlans: { [date]: items }, planVersions: [], quantityCorrections: [], documents: [document], returnStatuses: {},
  returnExclusions: [], inventory: [], inventorySourceDate: '', inventorySyncedAt: '', pickingDone: {}, archive: [], updatedAt: date };

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [label, viewport, mobile, theme] of [['desktop', { width: 1700, height: 1050 }, false, 'dark'], ['mobile', { width: 390, height: 844 }, true, 'dark'], ['light', { width: 1440, height: 1000 }, false, 'light']]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', acceptDownloads: true });
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await context.addInitScript(({ user, theme }) => {
        localStorage.setItem('apka-ui', JSON.stringify({ state: { user, theme, role: user.role, activeWarehouse: 'PLANOWANIE_ZAPOTRZEBOWANIA', sidebarCollapsed: true }, version: 0 }));
      }, { user, theme });
      // Never read or mutate production data during this browser check.
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data = [];
        if (url.pathname === '/api/auth/session') data = user;
        if (url.pathname === '/api/planowanie-zapotrzebowania') {
          if (url.searchParams.get('source') === 'original-inventory') data = { dateKey: date, syncedAt: new Date().toISOString(), rows: [{ code, name, unit: 'szt.', qty: 6, areaId: 'hala-1' }] };
          else if (url.searchParams.has('source')) data = { items: [], state, sharedRevision: 1 };
          else if (route.request().method() === 'PUT') data = { revision: Number(route.request().postDataJSON().expectedRevision) + 1, sharedRevision: 1 };
          else data = { state, revision: 1, sharedRevision: 1 };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto('http://127.0.0.1:3000/planowanie-zapotrzebowania?view=dokument', { waitUntil: 'networkidle', timeout: 120000 });
      await page.getByRole('button', { name: /TEST-METAL-BOX/ }).click();
      const materialRows = page.locator('tr').filter({ has: page.getByText(code, { exact: true }) });
      assert.equal(await materialRows.count(), 1);
      const cells = await materialRows.locator('td').allTextContents();
      assert.deepEqual(cells.slice(4), ['24', '6', '18', 'szt.']);
      await page.getByText('Pozycje do wypisania: 1/1', { exact: true }).waitFor();
      await page.getByTitle('Pokaż indeksy źródłowe', { exact: true }).click();
      await page.getByText('DETAIL-0', { exact: true }).waitFor();
      await page.getByText('DETAIL-1', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Zaznacz jako wypisane: ' + name, exact: true }).click();
      await page.getByText('Wszystko wypisane · 1/1', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Odznacz jako wypisane: ' + name, exact: true }).click();
      await page.getByText('Wypisano 0/1', { exact: true }).waitFor();
      const downloadPromise = page.waitForEvent('download');
      await page.getByTitle('Eksportuj widoczne pozycje do Excel', { exact: true }).click();
      const download = await downloadPromise;
      const workbook = XLSX.readFile(await download.path());
      const exported = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
      assert.equal(exported.length, 2);
      assert.deepEqual(exported[1].slice(10, 16), [24, 6, 0, 0, 18, 'szt.']);
      assert.ok(exported[1][16].includes('DETAIL-0') && exported[1][16].includes('DETAIL-1'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'page must not overflow horizontally');
      await page.screenshot({ path: path.join(__dirname, 'picking-document-' + label + '.png'), fullPage: true });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ label, rows: 1, demand: 24, stock: 6, toIssue: 18, exportedRows: 1, consoleErrors: errors.length, success: true }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
