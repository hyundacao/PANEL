import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyTechnologyIndexMigration, assertNoCommittedIndexReferences, digest, planTechnologyIndexMigration,
  previewTechnologyIndexMigration, rollbackTechnologyIndexMigration } from '../../../scripts/normalize-technology-material-indices.mjs';

const fixture = () => {
  const source = { generation: '7', rows: [], register: { items: [{ indexCode: 'PRIMARY', indexCode2: '000123', name: 'Material' }], blocked: [] } };
  let record = { id: 'main', revision: 12, state: { technologies: [{ id: 'base', productIndex: 'PRODUCT', productName: 'Product', variant: 'base',
    archived: false, shiftNorm: 550, materials: [{ id: 'm', code: 'PRIMARY', name: 'Material', usage: .248, unit: 'kg', logisticQty: 25 }] }],
  plan: [{ id: 'plan', technologyId: 'base', manualOverride: true, workingMaterials: [{ code: 'PRIMARY', usage: .3 }] }],
  documents: [{ id: 'doc', rows: [{ code: 'PRIMARY', qty: 400 }] }], returnStatuses: { x: 'completed' }, inventory: [{ code: 'PRIMARY', qty: 123 }],
  fixedDevices: [], palletSets: [], custom: { keep: true }, __sharedFieldRevisions: { technologies: 11, documents: 10 }, __documentAreaRevisions: { hall1: 10 } } };
  const otherRecords = { workspace: { plan: ['unchanged'] }, register: structuredClone(source.register) };
  const writes = [];
  const store = {
    read: async () => structuredClone(record),
    source: async () => structuredClone(source),
    generation: async () => source.generation,
    references: async () => [],
    save: async (state, expectedRevision, actor) => {
      writes.push({ expectedRevision, actor, state: structuredClone(state) });
      if (record.revision !== expectedRevision) return { revision: record.revision, conflict: true };
      record = { ...record, revision: record.revision + 1, state: structuredClone(state) };
      return { revision: record.revision, conflict: false };
    }
  };
  return { store, source, writes, otherRecords, get record() { return record; }, mutate: fn => fn(record) };
};

async function workspace(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-technology-index2-test-'));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('preview is read-only and includes an integrity fingerprint and a human report', async t => {
  const root = await workspace(t), f = fixture();
  const before = structuredClone(f.record);
  const result = await previewTechnologyIndexMigration(f.store, root);
  const report = JSON.parse(await readFile(result.reportPath, 'utf8'));
  assert.equal(report.expectedRevision, 12);
  assert.equal(report.counts.changed, 1);
  assert.match(report.planDigest, /^[a-f0-9]{64}$/);
  assert.match(await readFile(path.join(path.dirname(result.reportPath), 'report.md'), 'utf8'), /Naglowki/);
  assert.deepEqual(f.record, before);
  assert.equal(f.writes.length, 0);
});

test('apply verifies a durable library backup before one CAS save and preserves all unrelated state', async t => {
  const root = await workspace(t), f = fixture(), before = structuredClone(f.record), others = structuredClone(f.otherRecords);
  const preview = await previewTechnologyIndexMigration(f.store, root);
  const save = f.store.save;
  f.store.save = async (...args) => {
    const directories = await readdir(root);
    const backups = await Promise.all(directories.map(dir => readFile(path.join(root, dir, 'backup.json'), 'utf8').catch(() => null)));
    assert.equal(backups.filter(Boolean).length, 1, 'backup must already be readable when saving');
    assert.deepEqual(JSON.parse(backups.find(Boolean)).technologies, before.state.technologies);
    return save(...args);
  };
  const result = await applyTechnologyIndexMigration(f.store, root, preview.reportPath);
  assert.equal(result.revision, 13);
  assert.equal(result.counts.changed, 1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].expectedRevision, 12);
  assert.equal(f.record.state.technologies[0].materials[0].code, '000123');
  const restored = structuredClone(f.record.state);
  restored.technologies = before.state.technologies;
  restored.__sharedFieldRevisions = before.state.__sharedFieldRevisions;
  assert.deepEqual(restored, before.state);
  assert.equal(f.record.state.__sharedFieldRevisions.technologies, 13);
  assert.equal(f.record.state.__sharedFieldRevisions.documents, 10);
  assert.deepEqual(f.otherRecords, others);
});

test('changed main revision stops application of a previously prepared report', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  f.mutate(record => { record.revision++; record.state.documents.push({ id: 'new-doc' }); });
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /DATA_CHANGED/);
  assert.equal(f.writes.length, 0);
});

test('changed register content or catalog generation stops a stale preview', async t => {
  for (const mutate of [f => { f.source.register.items[0].indexCode2 = 'OTHER'; }, f => { f.source.generation = '8'; }]) {
    const root = await workspace(t), f = fixture();
    const preview = await previewTechnologyIndexMigration(f.store, root);
    mutate(f);
    await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /DATA_CHANGED/);
    assert.equal(f.writes.length, 0);
  }
});

test('catalog change immediately before saving stops after backup without database changes', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  f.store.generation = async () => '8';
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /CATALOG_CHANGED_NO_WRITE/);
  assert.equal(f.writes.length, 0);
});

test('a concurrent library save causes a conflict with no retry or overwrite', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  f.store.save = async () => { f.mutate(record => { record.revision++; record.state.technologies[0].notes = 'someone else'; });
    return { revision: 13, conflict: true }; };
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /REVISION_CONFLICT_NO_OVERWRITE/);
  assert.equal(f.record.state.technologies[0].notes, 'someone else');
  assert.equal(f.record.state.technologies[0].materials[0].code, 'PRIMARY');
});

test('a changed or corrupt report and an unwritable backup destination never reach save', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  const report = JSON.parse(await readFile(preview.reportPath, 'utf8'));
  report.findings[0].to = 'MALICIOUS';
  await writeFile(preview.reportPath, JSON.stringify(report));
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /REPORT_CHANGED/);
  assert.equal(f.writes.length, 0);
  const fresh = await previewTechnologyIndexMigration(f.store, root);
  const notDirectory = path.join(root, 'not-directory');
  await writeFile(notDirectory, 'file');
  await assert.rejects(applyTechnologyIndexMigration(f.store, notDirectory, fresh.reportPath));
  assert.equal(f.writes.length, 0);
});

test('a lost successful response is confirmed by readback, never retried', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root), save = f.store.save;
  f.store.save = async (...args) => { await save(...args); throw new Error('NETWORK_RESPONSE_LOST'); };
  const result = await applyTechnologyIndexMigration(f.store, root, preview.reportPath);
  assert.equal(f.writes.length, 1);
  assert.equal(result.recoveredResponse, true);
  assert.equal(f.record.state.technologies[0].materials[0].code, '000123');
});

test('an uncommitted save failure is not mistaken for success', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  f.store.save = async () => { throw new Error('NETWORK_FAILED'); };
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /NETWORK_FAILED/);
  assert.equal(f.record.revision, 12);
});

test('readback mismatch is detected rather than reported as a successful migration', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root), save = f.store.save;
  f.store.save = async (...args) => { const result = await save(...args); f.mutate(record => { record.state.custom.keep = false; }); return result; };
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /SAVED_STATE_MISMATCH/);
});

test('a second preview after normalization is a no-op and does not add an event or revision', async t => {
  const root = await workspace(t), f = fixture();
  const first = await previewTechnologyIndexMigration(f.store, root);
  await applyTechnologyIndexMigration(f.store, root, first.reportPath);
  const second = await previewTechnologyIndexMigration(f.store, root);
  const result = await applyTechnologyIndexMigration(f.store, root, second.reportPath);
  assert.equal(result.unchanged, true);
  assert.equal(f.writes.length, 1);
});

test('rollback restores only the library and retains documents added after migration', async t => {
  const root = await workspace(t), f = fixture(), original = structuredClone(f.record.state.technologies);
  const preview = await previewTechnologyIndexMigration(f.store, root);
  const applied = await applyTechnologyIndexMigration(f.store, root, preview.reportPath);
  f.mutate(record => { record.revision++; record.state.documents.push({ id: 'later-doc' }); });
  const result = await rollbackTechnologyIndexMigration(f.store, root, applied.backupPath);
  assert.equal(result.revision, 15);
  assert.deepEqual(f.record.state.technologies, original);
  assert.equal(f.record.state.documents.at(-1).id, 'later-doc');
  assert.equal(f.writes.length, 2);
});

test('rollback refuses to overwrite a library edited since migration', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  const applied = await applyTechnologyIndexMigration(f.store, root, preview.reportPath);
  f.mutate(record => { record.state.technologies[0].materials[0].usage = .5; });
  await assert.rejects(rollbackTechnologyIndexMigration(f.store, root, applied.backupPath), /LIBRARY_CHANGED_MANUAL_RESTORE_REQUIRED/);
  assert.equal(f.writes.length, 1);
  assert.equal(f.record.state.technologies[0].materials[0].usage, .5);
});

test('fingerprints are independent of JSON object key order, not array order', () => {
  assert.equal(digest({ b: [1, 2], a: 1 }), digest({ a: 1, b: [1, 2] }));
  assert.notEqual(digest([1, 2]), digest([2, 1]));
});

test('planning protects module boundary and rejects malformed source generations', () => {
  const f = fixture();
  assert.throws(() => planTechnologyIndexMigration({ ...f.record, id: 'workspace:user' }, f.source), /ONLY_MAIN_LIBRARY_ALLOWED/);
  assert.throws(() => planTechnologyIndexMigration(f.record, { ...f.source, generation: null }), /CATALOG_GENERATION_INVALID/);
});

test('committed documents, manual issue quantities and completed returns block code replacement', () => {
  const findings = [{ status: 'changed', from: 'PRIMARY', to: '000123' }];
  for (const status of ['handed', 'issued', 'outdated']) {
    const state = { documents: [{ status, rows: [{ code: 'PRIMARY', confirmed: status === 'outdated' }] }] };
    assert.throws(() => assertNoCommittedIndexReferences(state, [], findings), /COMMITTED_DOCUMENT/);
  }
  assert.throws(() => assertNoCommittedIndexReferences({ documents: [{ status: 'issued', rows: [{ key: 'primary|kg' }] }] }, [], findings), /COMMITTED_DOCUMENT/);
  assert.throws(() => assertNoCommittedIndexReferences({}, [{ plan: [{ issueQuantityOverrides: { 'primary|kg': { quantity: 1 } } }] }], findings), /MANUAL_ISSUE_OVERRIDE/);
  assert.throws(() => assertNoCommittedIndexReferences({ returnStatuses: { '2026-11-18|hall1|primary|kg': 'completed' } }, [], findings), /COMPLETED_RETURN/);
  assert.doesNotThrow(() => assertNoCommittedIndexReferences({ documents: [{ status: 'cancelled', rows: [{ code: 'PRIMARY', confirmed: true }] },
    { status: 'outdated', rows: [{ code: 'PRIMARY', confirmed: false }] }] }, [], findings));
});

test('a newly committed old-code document prevents apply even after a prior safe preview', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  f.mutate(record => { record.state.documents[0].status = 'issued'; });
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /COMMITTED_DOCUMENT/);
  assert.equal(f.writes.length, 0);
});

test('a newly added workspace override prevents apply before save', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  f.store.references = async () => [{ plan: [{ issueQuantityOverrides: { 'primary|kg': { quantity: 3 } } }] }];
  await assert.rejects(applyTechnologyIndexMigration(f.store, root, preview.reportPath), /MANUAL_ISSUE_OVERRIDE/);
  assert.equal(f.writes.length, 0);
});

test('rollback also refuses to lose a newly committed index 2 document', async t => {
  const root = await workspace(t), f = fixture();
  const preview = await previewTechnologyIndexMigration(f.store, root);
  const applied = await applyTechnologyIndexMigration(f.store, root, preview.reportPath);
  f.mutate(record => { record.state.documents.push({ status: 'issued', rows: [{ code: '000123' }] }); });
  await assert.rejects(rollbackTechnologyIndexMigration(f.store, root, applied.backupPath), /COMMITTED_DOCUMENT/);
  assert.equal(f.writes.length, 1);
});
