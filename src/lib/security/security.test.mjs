import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, createECDH, randomBytes } from 'node:crypto';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
process.env.APP_SESSION_SECRET = 'synthetic-test-secret-never-production';

function loader(mocks = {}) {
  const cache = new Map();
  const load = file => {
    const full = [file, file + '.ts', file + '.tsx', join(file, 'index.ts')].find(existsSync);
    assert.ok(full, file);
    if (cache.has(full)) return cache.get(full).exports;
    const mod = new Module(full); cache.set(full, mod);
    mod.require = id => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id === '@/lib/supabase/admin') throw Error('Real database access forbidden in tests');
      if (id.startsWith('@/')) return load(join(root, id.slice(2)));
      if (id.startsWith('.')) return load(resolve(dirname(full), id));
      return require(id);
    };
    mod._compile(ts.transpileModule(readFileSync(full, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX
    } }).outputText, full);
    return mod.exports;
  };
  return relative => load(join(root, relative));
}

function sessionFixture(overrides = {}) {
  const row = { id: 'user-1', is_active: true, active_session_id: 'session-1', access: {}, ...overrides };
  const db = { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
    update: updates => ({ eq: () => ({ eq: async (_, sid) => {
      if (row.active_session_id === sid) Object.assign(row, updates);
      return { error: null };
    } }) })
  }) };
  const mocks = {
    '@/lib/supabase/admin': { supabaseAdmin: db },
    '@/lib/supabase/users': { mapDbUser: r => ({ id: r.id, isActive: r.is_active, mustChangePassword: !!r.access.mustChangePassword }) },
    '@/lib/supabase/permission-groups': { loadUserGroupsByUserIds: async () => new Map() }
  };
  const session = loader(mocks)('lib/auth/session.ts');
  let cookie;
  session.setSessionCookie({ cookies: { set: x => { cookie = x; } } }, row.id, 'session-1', true);
  const request = new Request('https://test.invalid', { headers: { cookie: cookie.name + '=' + cookie.value } });
  return { row, request, session, mocks };
}

test('existing signed v1 cookies remain valid without changing passwords', async () => {
  const f = sessionFixture();
  const now = Math.floor(Date.now()/1000);
  const body = Buffer.from(JSON.stringify({ v: 1, sub: f.row.id, sid: 'session-1', iat: now, exp: now+3600 })).toString('base64url');
  const token = body + '.' + createHmac('sha256', process.env.APP_SESSION_SECRET).update(body).digest('base64url');
  const result = await f.session.getAuthenticatedUser(new Request('https://test.invalid', { headers: { cookie: 'apka_session='+token } }));
  assert.equal(result.user.id, f.row.id);
});
test('logout revokes the token in persisted state, including a new server instance', async () => {
  const f = sessionFixture();
  assert.ok((await f.session.getAuthenticatedUser(f.request)).user);
  await f.session.revokeRequestSession(f.request);
  const secondServer = loader(f.mocks)('lib/auth/session.ts');
  assert.equal((await secondServer.getAuthenticatedUser(f.request)).code, 'SESSION_EXPIRED');
});
test('delayed logout does not revoke a new session', async () => {
  const f = sessionFixture(); f.row.active_session_id = 'new-login';
  await f.session.revokeRequestSession(f.request);
  assert.equal(f.row.active_session_id, 'new-login');
});
test('mandatory change blocks normal APIs but allows the explicit password flow', async () => {
  const f = sessionFixture({ access: { mustChangePassword: true } });
  assert.equal((await f.session.getAuthenticatedUser(f.request)).code, 'PASSWORD_CHANGE_REQUIRED');
  assert.ok((await f.session.getAuthenticatedUser(f.request, { allowPasswordChange: true })).user);
});
test('password reset timestamp invalidates earlier tokens', async () => {
  const f = sessionFixture(); f.row.access.passwordChangedAt = new Date(Date.now() + 1).toISOString();
  assert.equal((await f.session.getAuthenticatedUser(f.request, { allowPasswordChange: true })).code, 'SESSION_EXPIRED');
});
test('expired temporary password session is rejected', async () => {
  const f = sessionFixture({ access: { mustChangePassword: true, passwordResetExpiresAt: new Date(0).toISOString() } });
  assert.equal((await f.session.getAuthenticatedUser(f.request, { allowPasswordChange: true })).code, 'SESSION_EXPIRED');
});
test('inactive users cannot authenticate', async () => {
  const f = sessionFixture({ is_active: false });
  assert.equal((await f.session.getAuthenticatedUser(f.request)).code, 'UNAUTHORIZED');
});
test('wrong signature is rejected', async () => {
  const f = sessionFixture();
  assert.equal((await f.session.getAuthenticatedUser(new Request('https://test.invalid', { headers: { cookie: 'apka_session=invalid.signature' } }))).user, null);
});

test('reset preserves the user-requested default and atomically saves revocation metadata', async () => {
  const calls = [];
  const route = loader({
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: { role: 'HEAD_ADMIN' } }) },
    '@/lib/supabase/admin': { supabaseAdmin: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { access: { admin: false } } }) }) }) }),
      rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; }
    } }
  })('app/api/users/[id]/reset-password/route.ts');
  const first = await route.POST(new Request('https://test.invalid'), { params: Promise.resolve({ id: 'u' }) });
  const a = await first.json();
  const b = await (await route.POST(new Request('https://test.invalid'), { params: Promise.resolve({ id: 'u' }) })).json();
  assert.equal(first.status, 200); assert.match(first.headers.get('cache-control'), /no-store/);
  assert.equal(a.temporaryPassword, b.temporaryPassword);
  assert.equal(a.temporaryPassword, loader()('lib/auth/password.ts').DEFAULT_RESET_PASSWORD);
  assert.equal(calls[0].args.p_password, a.temporaryPassword);
  assert.equal(calls[0].args.p_access.mustChangePassword, true);
  assert.ok(calls[0].args.p_access.passwordChangedAt);
});

for (const role of [null, 'USER', 'ADMIN']) {
  test(`reset denied for ${role} before touching database`, async () => {
    const route = loader({ '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: role ? { role } : null, code: 'UNAUTHORIZED' }) },
      '@/lib/supabase/admin': { supabaseAdmin: { from: () => { throw Error('Database reached'); } } }
    })('app/api/users/[id]/reset-password/route.ts');
    assert.equal((await route.POST(new Request('https://test.invalid'), { params: Promise.resolve({ id: 'u' }) })).status, role ? 403 : 401);
  });
}

const reportUser = readOnly => ({ role: 'USER', access: { warehouses: { RAPORT_BRAKOWOSCI: { tabs: ['raport-brakowosci'], readOnly } } } });
for (const [name, user, getStatus, postStatus] of [['anonymous', null,401,401], ['other module', {role:'USER',access:{}},403,403], ['read only',reportUser(true),200,403]]) {
  test(`report authorization: ${name}`, async () => {
    const route = loader({ '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user, code: 'UNAUTHORIZED' }) },
      '@/lib/supabase/admin': { supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { payload: {} }, error: null }) }) }) }) } }
    })('app/api/raport-brakowosci/route.ts');
    const request = { formData: () => { throw Error('Parsing before permission check'); } };
    assert.equal((await route.GET(request)).status, getStatus);
    assert.equal((await route.POST(request)).status, postStatus);
  });
}

test('push permits real providers and rejects private URLs, credentials and suffix attacks', () => {
  const push = loader({ '@/lib/supabase/admin': { supabaseAdmin: {} } })('lib/push/server.ts');
  const ec = createECDH('prime256v1'); ec.generateKeys();
  const keys = { p256dh: ec.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  assert.ok(push.normalizePushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', keys }));
  for (const endpoint of ['https://127.0.0.1/', 'https://10.0.0.1/', 'http://fcm.googleapis.com/', 'https://fcm.googleapis.com.evil.invalid/', 'https://u:p@fcm.googleapis.com/', 'https://fcm.googleapis.com:9443/']) {
    assert.equal(push.normalizePushSubscription({ endpoint, keys }), null, endpoint);
  }
});
test('normal XLSX passes the archive limits, corrupt ZIP and oversized uploads fail', async () => {
  const limits = loader()('lib/security/import-limits.ts');
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Index','Qty'],['A',2]]), 'Sheet1');
  const bytes = XLSX.write(wb, { type: 'buffer', compression: true, bookType: 'xlsx' });
  await limits.assertImportFile(new File([bytes], 'normal.xlsx'), ['xlsx']);
  await assert.rejects(limits.assertImportFile(new File(['bad'], 'bad.xlsx'), ['xlsx']));
  assert.throws(() => limits.assertImportRequest(new Request('https://test.invalid', { headers: { 'content-length': '999999999' } })), /IMPORT_TOO_LARGE/);
});
test('password validation prevents weak and bcrypt-truncated new passwords', () => {
  const { getPasswordValidationError } = loader()('lib/auth/password.ts');
  assert.equal(getPasswordValidationError('short'), 'PASSWORD_POLICY');
  assert.equal(getPasswordValidationError('x'.repeat(73)), 'PASSWORD_POLICY');
  assert.equal(getPasswordValidationError('a long passphrase 123'), null);
});

test('normal existing login still verifies credentials and issues a signed cookie', async () => {
  const row = { id: 'u', username: 'existing', access: {}, is_active: true };
  let verified = false;
  const route = loader({
    '@/lib/auth/shared-rate-limit': { consumeSharedLoginLimit: async () => 0 },
    '@/lib/supabase/permission-groups': { loadUserGroupsByUserIds: async () => new Map() },
    '@/lib/supabase/users': { mapDbUser: r => ({ id: r.id, username: r.username, mustChangePassword: false }), getErrorCode: () => 'INVALID_CREDENTIALS' },
    '@/lib/supabase/admin': { supabaseAdmin: {
      rpc: async (name, p) => { assert.equal(name, 'authenticate_user'); assert.equal(p.p_password, 'existing-password'); verified = true; return { data: row, error: null }; },
      from: () => { const q = { update: () => q, eq: (key,value) => { if (key === 'access') assert.equal(value, '{}'); return q; }, select: () => q, maybeSingle: async () => ({ data: {id: 'u'}, error: null }) }; return q; }
    } }
  })('app/api/auth/login/route.ts');
  const response = await route.POST(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ username: 'existing', password: 'existing-password' }) }));
  assert.equal(response.status, 200); assert.equal(verified, true);
  assert.match(response.headers.get('set-cookie'), /apka_session=/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
});

for (const [limitResult, expected] of [[90, 429], ['failure', 503]]) {
  test(`shared login limit denies before password verification: ${expected}`, async () => {
    const route = loader({
      '@/lib/auth/shared-rate-limit': { consumeSharedLoginLimit: async () => { if (limitResult === 'failure') throw Error('down'); return limitResult; } },
      '@/lib/supabase/admin': { supabaseAdmin: { rpc: () => { throw Error('Should not verify password'); } } }
    })('app/api/auth/login/route.ts');
    const response = await route.POST(new Request('https://test.invalid', { method: 'POST', body: JSON.stringify({ username: 'u', password: 'p' }) }));
    assert.equal(response.status, expected);
  });
}

test('shared limits use hashed buckets and fail closed if the migration is missing', async () => {
  const calls = [];
  let fail = false;
  const rate = loader({ '@/lib/supabase/admin': { supabaseAdmin: { rpc: async (name, args) => {
    calls.push({ name, args }); return fail ? { error: {code:'PGRST202'} } : { data: 0, error: null };
  } } } })('lib/auth/shared-rate-limit.ts');
  assert.equal(await rate.consumeSharedLoginLimit('test-user', '192.0.2.1'), 0);
  assert.equal(calls.length, 2);
  assert.match(calls[0].args.p_bucket, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].args.p_limit, 60);
  assert.equal(calls[1].args.p_limit, 12);
  fail = true;
  await assert.rejects(rate.consumeSharedLoginLimit('test-user', '192.0.2.1'), /RATE_LIMIT_UNAVAILABLE/);
});

test('mixing settlement fields cannot borrow another field permission', () => {
  const source = readFileSync(join(root, 'app/api/app/route.ts'), 'utf8');
  const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const names = new Set(['ensureActionAccess','requireWarehouseAccess','requireAnyTabAccess','requireTabWriteAccess']);
  const nodes = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.has(d.name.getText(ast))));
  assert.equal(nodes.length, names.size);
  const access = loader()('lib/auth/access.ts');
  const context = { ...access };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(nodes.map(n=>n.getText(ast)).join('\n')+'\nglobalThis.guard=ensureActionAccess;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const user = { role:'USER',access:{warehouses:{FARBY_TASMY:{tabs:['rozliczanie-farb-tasm'],readOnly:false}},paintTapePermissions:{details:true,open:false,accounting:false}} };
  context.guard('updatePaintTapeSettlement', user, {id:'test',producedQty:10});
  assert.throws(()=>context.guard('updatePaintTapeSettlement',user,{id:'test',producedQty:10,startQty:50}), /FORBIDDEN/);
  assert.throws(()=>context.guard('updatePaintTapeSettlement',user,{id:'test',producedQty:10,unexpectedField:true}), /FORBIDDEN/);
});

test('API proxy rejects cross-site writes but accepts normal same-origin requests', () => {
  const { NextRequest } = require('next/server');
  const { proxy } = loader()('proxy.ts');
  const request = origin => new NextRequest('https://app.example/api/app', { method: 'POST', headers: { origin } });
  assert.equal(proxy(request('https://evil.example')).status, 403);
  assert.equal(proxy(request('null')).status, 403);
  assert.equal(proxy(request('https://app.example')).status, 200);
});

test('own password change verifies the old password and revokes the session', async () => {
  const calls = [];
  let revoked = false;
  const route = loader({
    '@/lib/auth/session': {
      getAuthenticatedUser: async (_, options) => {
        assert.equal(options.allowPasswordChange, true);
        return { user: { id: 'u', username: 'test' } };
      },
      revokeRequestSession: async () => { revoked = true; },
      clearSessionCookie: response => response.cookies.set('apka_session', '', { maxAge: 0 })
    },
    '@/lib/supabase/admin': { supabaseAdmin: { rpc: async (name, args) => {
      calls.push({ name, args });
      return name === 'authenticate_user'
        ? { data: { id: 'u', access: { mustChangePassword: true, warehouses: { test: {} } } } }
        : { error: null };
    } } }
  })('app/api/auth/password/route.ts');
  const response = await route.POST(new Request('https://test.invalid', {
    method: 'POST', body: JSON.stringify({ currentPassword: 'old', newPassword: 'a long password 123' })
  }));
  assert.equal(response.status, 200);
  assert.equal(calls[0].name, 'authenticate_user');
  assert.equal(calls[0].args.p_password, 'old');
  assert.equal(calls[1].args.p_access.mustChangePassword, false);
  assert.deepEqual(calls[1].args.p_access.warehouses, { test: {} });
  assert.equal(calls[1].args.p_access.passwordResetExpiresAt, null);
  assert.equal(revoked, true);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('administrator custom reset atomically replaces expired reset metadata', async () => {
  const calls = [];
  const route = loader({
    '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user: { id: 'admin', role: 'HEAD_ADMIN' } }) },
    '@/lib/supabase/permission-groups': { loadUserGroupsByUserIds: async () => new Map() },
    '@/lib/supabase/users': { normalizeAccessForDb: x => x, mapDbUser: x => x },
    '@/lib/supabase/admin': { supabaseAdmin: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { access: {
        mustChangePassword: true, passwordResetExpiresAt: new Date(0).toISOString(), warehouses: { test: {} }
      } } }) }) }) }),
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: { id: 'u', access: args.p_access }, error: null };
      }
    } }
  })('app/api/users/[id]/route.ts');
  const response = await route.PATCH(new Request('https://test.invalid', {
    method: 'PATCH', body: JSON.stringify({ password: 'admin-chosen-password' })
  }), { params: Promise.resolve({ id: 'u' }) });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'update_app_user');
  assert.equal(calls[0].args.p_access.mustChangePassword, true);
  assert.ok(Date.parse(calls[0].args.p_access.passwordResetExpiresAt) > Date.now());
  assert.deepEqual(calls[0].args.p_access.warehouses, { test: {} });
});
