const { chromium } = require('C:/Users/hyund/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const path = require('node:path');

const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
const material = { id: 'pp', code: 'M-1-TW-MAX-2045-00', name: 'REGRANULAT POLIPROPYLENU CZARNY GBX', category: 'Tworzywo', usage: 0.02, unit: 'kg', logisticQty: 1 };
const tech = (id, index, name) => ({ id, productIndex: index, productName: name, variant: 'base', alternativeNo: 0, description: '', notes: '', shiftNorm: 1300, materials: [material, { id: 'box', code: 'KAR-1', name: 'KARTON 435X240X145', category: 'Karton', usage: 1 / 45, unit: 'szt.', logisticQty: 1 }], archived: false });
const plan = (id, index, name, remainingQty, areaId = 'hala-1') => ({ id, runId: id, index, name, station: 'WTR ' + (id === 'A' ? '12' : '15'), areaId, totalQty: remainingQty, remainingQty, shiftNorm: 1300, notes: '', included: true, technologyId: 'tech-' + id, workingMaterials: null, manualOverride: false, continuationCandidateId: '', scopeMode: 'all', quantityStatus: 'parsed' });
const items = [plan('A', '01744', 'SYSTEM 1000X98 ZASLEPKA', 1000), plan('B', '01745', 'SYSTEM 1000X98 NAROZNIK', 2400), plan('C', '01746', 'SYSTEM NA INNEJ HALI', 10000, 'hala-2'), plan('D', '01747', 'SYSTEM NA HALI 3', 5000, 'hala-3')];
items[2].station = 'WTR 40';
items[3].station = 'WTR 60';
const state = { version: 1, planName: 'Plan testowy.xlsx', planSheet: date, planImportedAt: date, selectedPlanDate: date, activePlanVersionId: '', horizonShifts: 3.5, calculationMode: 'all', continuationBufferPercent: 0, selectedAreaId: 'hala-1', areas: [{ id: 'hala-1', name: 'Hala 1' }, { id: 'hala-2', name: 'Hala 2' }, { id: 'silosy', name: 'Silosy', shared: true }], stationMappings: [], fixedDevices: [], palletSets: [], technologies: items.map(item => tech(item.technologyId, item.index, item.name)), plan: items, dailyPlans: { [date]: items }, planVersions: [], quantityCorrections: [], documents: [], returnStatuses: {}, returnExclusions: [], inventory: [], inventorySourceDate: '', inventorySyncedAt: '', pickingDone: {}, archive: [], updatedAt: date };
const user = { id: 'test-user', name: 'Test', username: 'test', role: 'HEAD_ADMIN', isActive: true, access: { admin: true, warehouses: {} } };
state.stationMappings = items.map(item => ({ station: item.station, areaId: item.areaId }));
state.areas.push({ id: 'hala-3', name: 'Hala 3' });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [label, viewport, mobile, theme] of [['desktop', { width: 1700, height: 1050 }, false, 'dark'], ['mobile', { width: 390, height: 844 }, true, 'dark'], ['desktop-intermediate', { width: 1440, height: 1000 }, false, 'light']]) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
      const errors = [];
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await context.addInitScript(({ user, theme }) => {
        localStorage.setItem('apka-ui', JSON.stringify({ state: { user, theme, role: user.role, activeWarehouse: 'PLANOWANIE_ZAPOTRZEBOWANIA', sidebarCollapsed: true }, version: 0 }));
      }, { user, theme });
      // All API traffic is isolated from the real database, including accidental saves.
      await context.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data = [];
        if (url.pathname === '/api/auth/session') data = user;
        if (url.pathname === '/api/planowanie-zapotrzebowania') {
          if (url.searchParams.get('source') === 'original-inventory') data = { dateKey: date, syncedAt: new Date().toISOString(), rows: [
            { ...material, areaId: 'hala-1', qty: 50 }, { ...material, id: 'other-zone', areaId: 'hala-2', qty: 999 },
            { ...material, id: 'silo', areaId: 'silosy', qty: 5000 }
          ] };
          else if (url.searchParams.has('source')) data = { items: [], state, sharedRevision: 1 };
          else if (route.request().method() === 'PUT') data = { revision: Number(route.request().postDataJSON().expectedRevision) + 1, sharedRevision: 1 };
          else data = { state, revision: 1, sharedRevision: 1 };
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto('http://127.0.0.1:3000/planowanie-zapotrzebowania?view=plan', { waitUntil: 'networkidle', timeout: 120000 });
      await page.getByTitle('Rozwiń pozycję', { exact: true }).first().click();
      console.log(label, await page.locator('button[aria-label^="Stan strefy"]').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label'))));
      await page.screenshot({ path: path.join(__dirname, 'zone-stock-' + label + '-before.png'), fullPage: true });
      const stock = page.getByRole('button', { name: 'Stan strefy Hala 1: 50 kg. Silosy wspólne: 5000 kg. Szczegóły zapotrzebowania', exact: true });
      await stock.waitFor();
      if (mobile) await stock.tap(); else await stock.click();
      const popup = page.getByRole('dialog', { name: 'Stan strefy: ' + material.name, exact: true });
      await popup.waitFor({ state: 'visible' });
      const text = await popup.innerText();
      assert.ok(text.includes('50 kg') && text.includes('20 kg') && text.includes('48 kg'), text);
      assert.ok(text.includes('5000 kg') && text.includes('348 kg'), text);
      assert.ok(text.includes('01745') && text.includes('01746') && text.includes('01747') && text.includes('Hala 2') && text.includes('Hala 3') && !text.includes('999 kg'), text);
      const rect = await popup.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width + 1, JSON.stringify(rect));
      assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height + 1, JSON.stringify(rect));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'page must not overflow horizontally');
      await page.screenshot({ path: path.join(__dirname, 'zone-stock-' + label + '.png'), fullPage: true });
      await popup.getByRole('button', { name: 'Zamknij szczegóły stanu', exact: true }).click();
      await popup.waitFor({ state: 'hidden' });
      await stock.focus();
      await page.keyboard.press('Enter');
      await popup.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await popup.waitFor({ state: 'hidden' });
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ label, popup: rect, consoleErrors: errors.length, success: true }));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
