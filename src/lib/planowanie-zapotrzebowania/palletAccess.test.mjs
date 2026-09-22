import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let user = null;
let writes = 0;
const mocks = {
  '@/lib/auth/session': { getAuthenticatedUser: async () => ({ user, code: user ? null : 'UNAUTHORIZED' }), clearSessionCookie() {} },
  '@/lib/supabase/admin': { supabaseAdmin: { from: (table) => {
    if (table === 'app_users') return { select: () => ({ order: () => ({ range: async () => ({ data: [user], error: null }) }) }) };
    assert.equal(table, 'audit_logs');
    return { insert: async () => ({ error: null }) };
  } } },
  '@/lib/push/server': {},
  '@/lib/planowanie-zapotrzebowania/palletInventoryServer': {
    addPalletInventory: async () => { writes++; return []; },
    updatePalletInventory: async () => { writes++; return []; },
    removePalletInventory: async () => { writes++; }
  }
};
const cache = new Map();
function load(file) {
  const path = [file, `${file}.ts`, join(file, 'index.ts')].find(existsSync);
  assert.ok(path, `Missing module ${file}`);
  if(cache.has(path)) return cache.get(path).exports;
  const mod = new Module(path);cache.set(path,mod);
  mod.require = id => Object.hasOwn(mocks,id) ? mocks[id] : id.startsWith('@/') ? load(join(root,id.slice(2))) : id.startsWith('.') ? load(resolve(dirname(path),id)) : require(id);
  mod._compile(ts.transpileModule(readFileSync(path,'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true } }).outputText,path);
  return mod.exports;
}
const app = load(join(root,'app/api/app/route.ts'));
const planning = load(join(root,'app/api/planowanie-zapotrzebowania/route.ts'));
const writer = (readOnly=false, admin=false) => ({id:'test-user',name:'Test',username:'test',role:admin?'ADMIN':'USER',access:{warehouses:{PLANOWANIE_ZAPOTRZEBOWANIA:{admin,readOnly,tabs:['planowanie-zapotrzebowania']}}}});
const post = (action) => app.POST(new Request('http://localhost/api/app',{method:'POST',body:JSON.stringify({action,payload:{batchId:'test'}})}));

test('pallet inventory actions enforce the existing inventory write permission on the server', async () => {
  for(const candidate of [null, {...writer(),access:{warehouses:{}}},writer(true)]) {
    user=candidate;writes=0;
    for(const action of ['addOriginalInventoryPalletSet','updateOriginalInventoryPalletSet','removeOriginalInventoryPalletSet']) {
      const response=await post(action);
      assert.equal(response.status,candidate?403:401);
    }
    assert.equal(writes,0);
  }
  for(const candidate of [writer(),writer(false,true),{...writer(),role:'HEAD_ADMIN'}]) {
    user=candidate;writes=0;
    for(const action of ['addOriginalInventoryPalletSet','updateOriginalInventoryPalletSet','removeOriginalInventoryPalletSet']) assert.equal((await post(action)).status,200);
    assert.equal(writes,3);
  }
});

test('only the module administrator or head admin may configure pallet sets, and invalid definitions are rejected', async () => {
  const request = () => new Request('http://localhost/api/planowanie-zapotrzebowania',{method:'PUT',body:JSON.stringify({state:{palletSets:[{id:'bad',active:true}]},expectedRevision:0,expectedSharedRevision:0,changedSharedFields:['palletSets']})});
  user=writer();assert.equal((await planning.PUT(request())).status,403);
  for(const candidate of [writer(false,true),{...writer(),role:'HEAD_ADMIN'}]) {
    user=candidate;
    const response=await planning.PUT(request());
    assert.equal(response.status,400);
    assert.equal((await response.json()).code,'INVALID_PALLET_SETS');
  }
});
