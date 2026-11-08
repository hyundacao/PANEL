import assert from 'node:assert/strict';
import { createRequire, Module } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const directory = path.dirname(fileURLToPath(import.meta.url));
const load = file => {
  const filename = path.join(directory, file);
  const mod = new Module(filename);
  mod.require = id => id.startsWith('.') ? load(`${id}.ts`) : require(id);
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText, filename);
  return mod.exports;
};
const transport = load('saveTransport.ts');
const bodyReader = load('saveBody.server.ts');

test('small legacy JSON and a new small save are both accepted unchanged', async () => {
  const value = { state: { technologies: [{ id: 'new', productIndex: '000703', shiftNorm: 0 }] }, expectedRevision: 8 };
  const encoded = await transport.encodePlanningSave(value);
  assert.equal(encoded.headers['content-type'], 'application/json');
  assert.equal(encoded.keepalive, true);
  assert.deepEqual(await bodyReader.readPlanningSaveBody(new Request('http://local/api', { method: 'PUT', ...encoded })), value);
});

test('a save above the web limit compresses below it and retains every technology, history row and baseline', async () => {
  const technology = { id: 'new', productIndex: '000703', productName: 'Zaślepka żółta', materials: [{ code: '001', usage: .248, unit: 'kg' }] };
  const value = { state: { technologies: [technology], archive: Array.from({ length: 5000 }, (_, id) => ({ id, notes: 'Produkcja i historia; zero to nie brak danych. '.repeat(28), qty: id === 0 ? 0 : 510 })) },
    expectedRevision: 964, expectedSharedRevision: 2339, changedSharedFields: ['technologies'], sharedBaseline: { technologies: [] } };
  assert.ok(Buffer.byteLength(JSON.stringify(value)) > 4_500_000);
  const encoded = await transport.encodePlanningSave(value);
  assert.equal(encoded.headers['content-type'], 'application/gzip');
  assert.ok(encoded.body.byteLength < 500_000);
  const decoded = await bodyReader.readPlanningSaveBody(new Request('http://local/api', { method: 'PUT', ...encoded }));
  assert.deepEqual(decoded, value);
});

test('unsupported compression falls back for smaller saves but never sends an oversized legacy body', async t => {
  const previous = globalThis.CompressionStream;
  globalThis.CompressionStream = undefined;
  t.after(() => { globalThis.CompressionStream = previous; });
  const encoded = await transport.encodePlanningSave({ notes: 'x'.repeat(300_000) });
  assert.equal(encoded.headers['content-type'], 'application/json');
  await assert.rejects(transport.encodePlanningSave({ notes: 'x'.repeat(4_500_000) }), error => error.code === 'PLANNING_PAYLOAD_TOO_LARGE');
});

test('malformed compressed data is rejected and compressed expansion is bounded', async () => {
  const request = bytes => new Request('http://local/api', { method: 'PUT', headers: { 'content-type': 'application/gzip' }, body: bytes });
  await assert.rejects(bodyReader.readPlanningSaveBody(request(Buffer.from('not gzip'))), error => error.code === 'INVALID_JSON' && error.status === 400);
  const bomb = gzipSync(Buffer.alloc(transport.PLANNING_SAVE_JSON_LIMIT + 1, 65));
  await assert.rejects(bodyReader.readPlanningSaveBody(request(bomb)), error => error.code === 'PLANNING_PAYLOAD_TOO_LARGE' && error.status === 413);
});

test('oversized compressed requests are bounded even without Content-Length', async () => {
  const request = new Request('http://local/api', {
    method: 'PUT', headers: { 'content-type': 'application/gzip' },
    body: Buffer.alloc(transport.PLANNING_SAVE_WIRE_LIMIT + 1)
  });
  assert.equal(request.headers.has('content-length'), false);
  await assert.rejects(bodyReader.readPlanningSaveBody(request), error => error.code === 'PLANNING_PAYLOAD_TOO_LARGE' && error.status === 413);
});

function clientWriter(fetch) {
  const filename = fileURLToPath(new URL('./usePlanningAutosave.ts', import.meta.url));
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  let write;
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'write' && ts.isArrowFunction(node.initializer)) write = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(write);
  const scopes = load('stateScopes.ts');
  const autosave = load('autosave.ts');
  const context = vm.createContext({ ...scopes, ...transport, PlanningSaveError: autosave.PlanningSaveError,
    writableRef: { current: true }, sharedBaselineRef: { current: { technologies: [] } },
    sharedRevisionRef: { current: 5 }, needsSharedRefreshRef: { current: false }, AbortSignal, fetch });
  vm.runInContext(ts.transpileModule(`this.write = ${write}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}

test('the actual client write callback sends compressed bytes and acknowledges both revisions', async () => {
  const value = { archive: [{ note: 'History '.repeat(750_000), qty: 0 }], technologies: [{ id: 'new', productIndex: '000703' }] };
  let decoded;
  const client = clientWriter(async (url, options) => {
    assert.equal(url, '/api/planowanie-zapotrzebowania');
    assert.equal(options.headers['content-type'], 'application/gzip');
    assert.ok(options.body.byteLength < 100_000);
    decoded = await bodyReader.readPlanningSaveBody(new Request('http://local/api', options));
    return Response.json({ revision: 965, sharedRevision: 6 });
  });
  assert.equal(await client.write(value, 964), 965);
  assert.deepEqual(decoded.state, value);
  assert.deepEqual(decoded.sharedBaseline, { technologies: [] });
  assert.equal(client.sharedRevisionRef.current, 6);
  assert.equal(client.needsSharedRefreshRef.current, true);
});

test('actual client distinguishes proxy payload and HTML server errors from loss of connection', async () => {
  for (const [status, code] of [[413, 'PLANNING_PAYLOAD_TOO_LARGE'], [502, 'HTTP_502']]) {
    const client = clientWriter(async () => new Response('upstream error, not JSON', { status }));
    await assert.rejects(client.write({ technologies: [{ id: 'new' }] }, 4), error => error.code === code);
    assert.equal(client.sharedRevisionRef.current, 5);
  }
});
