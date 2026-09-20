import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const path = [file, `${file}.ts`, `${file}.tsx`, join(file, 'index.ts')].find(existsSync);
    assert.ok(path, `Missing module ${file}`);
    if (cache.has(path)) return cache.get(path).exports;
    const mod = new Module(path);
    cache.set(path, mod);
    mod.require = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('@/')) return load(join(root, id.slice(2)));
      if (id.startsWith('.')) return load(resolve(dirname(path), id));
      return require(id);
    };
    mod._compile(ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }
    }).outputText, path);
    return mod.exports;
  }
  return (relative) => load(join(root, relative));
}

const access = loader()('lib/auth/access.ts');
const moduleKeys = Object.keys(access.WAREHOUSE_TABS_BY_KEY);
const makeUser = (role, modules = moduleKeys) => ({
  id: 'test-user', name: 'Test', username: 'test', role, isActive: true,
  access: { admin: true, warehouses: Object.fromEntries(modules.map((key) =>
    [key, { admin: true, readOnly: false, role: 'ADMIN', tabs: access.WAREHOUSE_TABS_BY_KEY[key] }])) }
});

const apiRoutes = [
  ['users', 'GET'], ['users', 'POST'], ['users/[id]', 'PATCH'], ['users/[id]', 'DELETE'],
  ['users/[id]/reset-password', 'POST'], ['permission-groups', 'GET'],
  ['permission-groups', 'POST'], ['permission-groups/[id]', 'PATCH'], ['permission-groups/[id]', 'DELETE']
];

for (const role of [null, 'ADMIN', 'USER', 'VIEWER']) {
  for (const [route, method] of apiRoutes) {
    test(`${role ?? 'anonymous'} cannot ${method} /api/${route}, even with all module admin flags`, async () => {
      let databaseCalls = 0;
      const denyDatabase = () => { databaseCalls += 1; throw new Error('Unexpected database call'); };
      const load = loader({
        '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: role ? makeUser(role) : null, code: role ? null : 'UNAUTHORIZED' }), clearSessionCookie() {} },
        '@/lib/supabase/admin': { supabaseAdmin: { from: denyDatabase, rpc: denyDatabase } },
        '@/lib/supabase/users': {},
        '@/lib/supabase/permission-groups': {}
      });
      const handler = load(`app/api/${route}/route.ts`)[method];
      const request = new Request(`http://localhost/api/${route}`, {
        method, ...(method === 'GET' ? {} : { body: JSON.stringify({ role: 'HEAD_ADMIN', access: { admin: true }, groupIds: ['admin-group'] }) })
      });
      const response = await handler(request, { params: Promise.resolve({ id: 'other-user' }) });
      assert.equal(response.status, role ? 403 : 401);
      assert.equal((await response.json()).code, role ? 'FORBIDDEN' : 'UNAUTHORIZED');
      assert.equal(databaseCalls, 0);
    });
  }
}

test('HEAD_ADMIN can read accounts and permission groups through the protected APIs', async () => {
  const load = loader({
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: makeUser('HEAD_ADMIN'), code: null }) },
    '@/lib/supabase/admin': { supabaseAdmin: { rpc: async () => ({ data: [], error: null }) } },
    '@/lib/supabase/users': {},
    '@/lib/supabase/permission-groups': { loadUserGroupsByUserIds: async () => new Map(), listPermissionGroups: async () => [] }
  });
  for (const route of ['users', 'permission-groups']) {
    const response = await load(`app/api/${route}/route.ts`).GET(new Request('http://localhost'));
    assert.equal(response.status, 200);
  }
});

for (const role of [null, 'ADMIN', 'USER', 'VIEWER', 'HEAD_ADMIN']) {
  test(`server /admin gate: ${role ?? 'anonymous'}`, async () => {
    const load = loader({
      'next/headers': { headers: async () => new Headers({ cookie: 'apka_session=test' }) },
      'next/navigation': { redirect: (path) => { throw new Error(`REDIRECT:${path}`); } },
      '@/lib/auth/session': { getAuthenticatedUser: async (request) => {
        assert.equal(request.headers.get('cookie'), 'apka_session=test');
        return { user: role ? makeUser(role) : null };
      } }
    });
    const render = () => load('app/(main)/admin/layout.tsx').default({ children: 'PRIVATE PANEL' });
    if (role === 'HEAD_ADMIN') assert.equal(await render(), 'PRIVATE PANEL');
    else await assert.rejects(render, new RegExp(`REDIRECT:${role ? '/magazyny' : '/login'}`));
  });
}

function ui(user, activeWarehouse = 'PRZEMIALY') {
  const queries = [];
  const store = { user, activeWarehouse, hydrated: true, sidebarCollapsed: false, theme: 'dark' };
  const container = ({ children }) => React.createElement('div', null, children);
  const mocks = {
    '@/lib/store/ui': { useUiStore: (selector) => selector ? selector(store) : store },
    '@/components/ui/Toast': { useToastStore: () => () => {} },
    '@/lib/api': new Proxy({}, { get: (_, name) => name === 'getTodayKey' ? () => '2026-09-19' : () => [] }),
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/przemialy/zarzadzanie', useSearchParams: () => new URLSearchParams('section=users&tab=users') },
    'next/image': { default: () => null, __esModule: true },
    'next/link': { default: ({ href, children }) => React.createElement('a', { href }, children), __esModule: true },
    '@tanstack/react-query': {
      useQuery: (options) => { if (options.enabled !== false) queries.push(options.queryKey); return { data: [] }; },
      useQueryClient: () => ({}), useMutation: () => ({})
    },
    '@/components/layout/PageHeader': { PageHeader: ({ title }) => React.createElement('h1', null, title) }
  };
  for (const name of ['Card', 'Button', 'Badge', 'EmptyState', 'Input', 'Toggle', 'SearchInput', 'DataTable']) {
    mocks[`@/components/ui/${name}`] = { [name]: container };
  }
  mocks['@/components/ui/Select'] = { SelectField: () => null };
  mocks['@/components/ui/Tabs'] = Object.fromEntries(['Tabs', 'TabsContent', 'TabsList', 'TabsTrigger'].map((name) => [name, container]));
  const load = loader(mocks);
  return { queries, render: (path, props = {}) => renderToStaticMarkup(React.createElement(load(path).default, props)), load };
}

for (const role of ['ADMIN', 'USER', 'VIEWER', 'HEAD_ADMIN']) {
  test(`module selector shows central admin card only to HEAD_ADMIN: ${role}`, () => {
    const html = ui(makeUser(role)).render('app/magazyny/page.tsx');
    assert.equal(html.includes('Panel administratora'), role === 'HEAD_ADMIN');
  });
}

test('unauthorized admin workspace does not mount its content or issue any queries', () => {
  for (const user of [null, makeUser('ADMIN'), makeUser('USER'), makeUser('VIEWER')]) {
    const view = ui(user);
    assert.match(view.render('components/admin/AdministrationWorkspace.tsx', { scope: 'system' }), /Brak dostepu/);
    assert.deepEqual(view.queries, []);
  }
});

test('central admin scope ignores stale active module and queries only accounts and groups', () => {
  const view = ui(makeUser('HEAD_ADMIN'));
  const html = view.render('components/admin/AdministrationWorkspace.tsx', { scope: 'system' });
  assert.match(html, /Konta i uprawnienia/);
  assert.deepEqual(view.queries, [['users'], ['permission-groups']]);
});

for (const scope of ['PRZEMIALY', 'CZESCI']) {
  for (const role of ['ADMIN', 'HEAD_ADMIN']) {
    test(`${role} can manage ${scope} without account controls or account queries`, () => {
      const view = ui(makeUser(role, [scope]), scope === 'CZESCI' ? 'PRZEMIALY' : 'CZESCI');
      const html = view.render('components/admin/AdministrationWorkspace.tsx', { scope });
      assert.match(html, /Zarządzanie modułem/);
      assert.doesNotMatch(html, /Konta i uprawnienia|Administracja kont|Brak dostepu/);
      assert.ok(view.queries.length > 0);
      assert.ok(view.queries.every(([key]) => key !== 'users' && key !== 'permission-groups'));
    });
  }
  test(`admin of a different module cannot manage ${scope} by changing activeWarehouse`, () => {
    const view = ui(makeUser('ADMIN', ['PLANOWANIE_ZAPOTRZEBOWANIA']), scope);
    assert.match(view.render('components/admin/AdministrationWorkspace.tsx', { scope }), /Brak dostepu/);
    assert.deepEqual(view.queries, []);
  });
}

test('module admin capabilities remain scoped to the assigned module', () => {
  for (const moduleKey of moduleKeys) {
    const user = makeUser('ADMIN', [moduleKey]);
    assert.equal(access.isHeadAdmin(user), false);
    assert.equal(access.isWarehouseAdmin(user, moduleKey), true);
    assert.equal(access.canAccessWarehouse(user, moduleKey), true);
    assert.equal(access.isReadOnly(user, moduleKey), false);
    for (const tab of access.WAREHOUSE_TABS_BY_KEY[moduleKey]) {
      assert.equal(access.canSeeTab(user, moduleKey, tab), true);
    }
  }
});

test('desktop and mobile module management links never point to the central admin route', () => {
  for (const file of ['components/layout/Sidebar.tsx', 'app/(main)/layout.tsx']) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.match(source, /href: '\/przemialy\/zarzadzanie'/);
    assert.match(source, /href: '\/czesci\/zarzadzanie'/);
    assert.doesNotMatch(source, /href: '\/admin/);
  }
});

test('production preparation management keeps module settings without account administration links', () => {
  const source = readFileSync(join(root, 'app/(main)/przygotowanie-produkcji/page.tsx'), 'utf8');
  assert.doesNotMatch(source, /Otwórz zarządzanie kontami|router\.push\('\/admin'\)|centralnym panelu użytkowników/);
  for (const title of ['Zadania cykliczne', 'Komentarze i ilości', 'Skład inżynierów procesu', 'Dostępy do sekcji']) {
    assert.ok(source.includes(`title="${title}"`));
  }
});
