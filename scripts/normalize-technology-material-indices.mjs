import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildTechnologyIndexCatalog, normalizeTechnologyMaterialIndices } from '../src/lib/planowanie-zapotrzebowania/technologyMaterialIndices.ts';
import { prepareSharedPlanningUpdate } from '../src/lib/planowanie-zapotrzebowania/stateScopes.ts';

const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const assertRecord = record => {
  assert.equal(record?.id, 'main', 'ONLY_MAIN_LIBRARY_ALLOWED');
  assert.ok(Number.isSafeInteger(record.revision) && record.revision >= 0, 'REVISION_INVALID');
  assert.ok(record.state && typeof record.state === 'object' && !Array.isArray(record.state), 'STATE_INVALID');
  assert.ok(Array.isArray(record.state.technologies), 'LIBRARY_INVALID');
};
const reportIdentity = report => ({ version: report.version, moduleId: report.moduleId,
  expectedRevision: report.expectedRevision, catalogGeneration: report.catalogGeneration, catalogDigest: report.catalogDigest,
  beforeDigest: report.beforeDigest, afterDigest: report.afterDigest, counts: report.counts,
  changedTechnologyIds: report.changedTechnologyIds, findings: report.findings });

const referenceKey = value => String(value ?? '').toLocaleLowerCase('pl-PL').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replaceAll('\u0142', 'l').trim();
const codeFromMaterialKey = value => {
  const key = String(value ?? '');
  const separator = key.lastIndexOf('|');
  return referenceKey(separator < 0 ? key : key.slice(0, separator));
};
export const assertNoCommittedIndexReferences = (state, workspaces, findings) => {
  const oldCodes = new Set(findings.filter(row => row.status === 'changed').map(row => referenceKey(row.from)));
  const matches = value => oldCodes.has(referenceKey(value));
  for (const document of state.documents ?? []) for (const row of document.rows ?? []) {
    const committed = document.status === 'issued' || document.status === 'handed'
      || (document.status !== 'cancelled' && row.confirmed);
    if (committed && (matches(row.code) || oldCodes.has(codeFromMaterialKey(row.key)))) {
      throw new Error('COMMITTED_DOCUMENT_USES_OLD_INDEX_NO_WRITE');
    }
  }
  for (const workspace of [{ plan: state.plan }, ...workspaces]) for (const item of workspace.plan ?? []) {
    if (Object.keys(item.issueQuantityOverrides ?? {}).some(key => oldCodes.has(codeFromMaterialKey(key)))) {
      throw new Error('MANUAL_ISSUE_OVERRIDE_USES_OLD_INDEX_NO_WRITE');
    }
  }
  if (Object.entries(state.returnStatuses ?? {}).some(([key, value]) => value === 'completed' && key.split('|').some(matches))) {
    throw new Error('COMPLETED_RETURN_USES_OLD_INDEX_NO_WRITE');
  }
};

export const planTechnologyIndexMigration = (record, source) => {
  assertRecord(record);
  assert.ok(/^\d+$/.test(String(source?.generation)), 'CATALOG_GENERATION_INVALID');
  assert.ok(Array.isArray(source.rows), 'CATALOG_SOURCE_INVALID');
  const result = normalizeTechnologyMaterialIndices(record.state.technologies, buildTechnologyIndexCatalog(source));
  assertNoCommittedIndexReferences(record.state, [], result.findings);
  const restored = structuredClone(result.technologies);
  for (const finding of result.findings.filter(item => item.status === 'changed')) {
    const technology = restored.find(item => item.id === finding.technologyId);
    const original = record.state.technologies.find(item => item.id === finding.technologyId);
    const entry = technology[finding.field][finding.position];
    assert.equal(entry.id, finding.componentId);
    if (finding.field === 'linkedProducts') {
      entry.productIndex = finding.from;
      const originalLink = original[finding.field][finding.position];
      if (Object.hasOwn(originalLink, 'sourceKeys')) entry.sourceKeys = originalLink.sourceKeys;
      else delete entry.sourceKeys;
    } else entry.code = finding.from;
  }
  assert.deepEqual(restored, record.state.technologies, 'NON_INDEX_CHANGE_REJECTED');
  const report = { version: 1, moduleId: 'main', expectedRevision: record.revision,
    catalogGeneration: String(source.generation), catalogDigest: digest(source),
    beforeDigest: digest(record.state.technologies), afterDigest: digest(result.technologies),
    technologyCount: record.state.technologies.length, componentCount: result.findings.length,
    counts: result.counts, changedTechnologyIds: result.changedTechnologyIds, findings: result.findings };
  report.planDigest = digest(reportIdentity(report));
  return { report, technologies: result.technologies };
};

const writeJson = async (filename, value) => {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assert.equal(digest(JSON.parse(await readFile(filename, 'utf8'))), digest(value), 'BACKUP_READBACK_FAILED');
};
const newDirectory = async root => {
  const directory = path.join(root, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
};
const withoutLibraryMetadata = state => Object.fromEntries(Object.entries(state)
  .filter(([key]) => !['technologies', '__sharedFieldRevisions', '__documentAreaRevisions'].includes(key)));
const nextState = (record, technologies) => {
  const state = prepareSharedPlanningUpdate(record.state, record.revision, record.revision,
    ['technologies'], { technologies }, null, { technologies: record.state.technologies });
  assert.ok(state, 'LIBRARY_CONFLICT');
  assert.deepEqual(withoutLibraryMetadata(state), withoutLibraryMetadata(record.state), 'UNRELATED_STATE_CHANGE_REJECTED');
  assert.deepEqual(state.__documentAreaRevisions, record.state.__documentAreaRevisions ?? {});
  return state;
};

const saveAndVerify = async (store, record, state, actor) => {
  let saved;
  let transportError;
  try { saved = await store.save(state, record.revision, actor); } catch (error) { transportError = error; }
  if (saved?.conflict) throw new Error('REVISION_CONFLICT_NO_OVERWRITE');
  const actual = await store.read();
  assertRecord(actual);
  if (transportError) {
    if (actual.revision !== record.revision + 1 || digest(actual.state) !== digest(state)) throw transportError;
  } else {
    assert.equal(saved?.revision, record.revision + 1, 'UNEXPECTED_SAVED_REVISION');
    assert.equal(actual.revision, saved.revision, 'CONCURRENT_CHANGE_DURING_VERIFICATION');
    assert.equal(digest(actual.state), digest(state), 'SAVED_STATE_MISMATCH');
  }
  return { revision: actual.revision, verifiedDigest: digest(actual.state.technologies), recoveredResponse: Boolean(transportError) };
};

const reportMarkdown = report => {
  const clean = value => String(value ?? '').replace(/[\r\n|]/g, ' ');
  const unresolved = report.findings.filter(item => ['missing-index2', 'unmatched', 'ambiguous', 'blocked'].includes(item.status));
  return ['# Indeks 2 - skladniki technologii', '',
    `Technologie: ${report.technologyCount}; skladniki: ${report.componentCount}; zmieniane technologie: ${report.changedTechnologyIds.length}.`,
    ...Object.entries(report.counts).map(([key, count]) => `- ${key}: ${count}`), '',
    'Naglowki produktow, przeliczniki, jednostki, normy, plany robocze i dokumenty pozostaja bez zmian.', '',
    '## Pozostawione do sprawdzenia', '', '| Produkt | Skladnik | Kod | Powod |', '| --- | --- | --- | --- |',
    ...unresolved.map(row => `| ${clean(row.productIndex)} | ${clean(row.name)} | ${clean(row.from)} | ${clean(row.status)} |`), ''
  ].join('\n');
};

export const previewTechnologyIndexMigration = async (store, artifactsRoot) => {
  const source = await store.source();
  const record = await store.read();
  const { report } = planTechnologyIndexMigration(record, source);
  assertNoCommittedIndexReferences(record.state, await store.references(), report.findings);
  const directory = await newDirectory(artifactsRoot);
  const reportPath = path.join(directory, 'preview.json');
  await writeJson(reportPath, report);
  await writeFile(path.join(directory, 'report.md'), reportMarkdown(report), { flag: 'wx', mode: 0o600 });
  return { reportPath, technologyCount: report.technologyCount, changedTechnologies: report.changedTechnologyIds.length, counts: report.counts };
};

export const applyTechnologyIndexMigration = async (store, artifactsRoot, reportPath) => {
  const expected = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(expected.version, 1, 'REPORT_VERSION_INVALID');
  assert.equal(expected.planDigest, digest(reportIdentity(expected)), 'REPORT_CHANGED');
  const source = await store.source();
  const record = await store.read();
  const { report, technologies } = planTechnologyIndexMigration(record, source);
  assert.equal(report.planDigest, expected.planDigest, 'DATA_CHANGED_CREATE_NEW_PREVIEW');
  if (!report.counts.changed) return { unchanged: true, counts: report.counts };
  const state = nextState(record, technologies);
  const directory = await newDirectory(artifactsRoot);
  const backupPath = path.join(directory, 'backup.json');
  await writeJson(backupPath, { version: 1, moduleId: 'main', beforeRevision: record.revision,
    beforeDigest: report.beforeDigest, afterDigest: report.afterDigest, catalogGeneration: report.catalogGeneration,
    planDigest: report.planDigest, technologies: record.state.technologies });
  await writeJson(path.join(directory, 'applied-plan.json'), report);
  await writeFile(path.join(directory, 'report.md'), reportMarkdown(report), { flag: 'wx', mode: 0o600 });
  assertNoCommittedIndexReferences(record.state, await store.references(), report.findings);
  assert.equal(String(await store.generation()), report.catalogGeneration, 'CATALOG_CHANGED_NO_WRITE');
  const result = await saveAndVerify(store, record, state, 'maintenance:technology-index2');
  assert.equal(result.verifiedDigest, report.afterDigest, 'LIBRARY_VERIFICATION_FAILED');
  await writeJson(path.join(directory, 'result.json'), { ...result, backupPath, counts: report.counts,
    changedTechnologies: report.changedTechnologyIds.length });
  return { ...result, backupPath, counts: report.counts, changedTechnologies: report.changedTechnologyIds.length };
};

export const rollbackTechnologyIndexMigration = async (store, artifactsRoot, backupPath) => {
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.version, 1, 'BACKUP_VERSION_INVALID');
  assert.equal(backup.moduleId, 'main', 'ONLY_MAIN_LIBRARY_ALLOWED');
  assert.equal(digest(backup.technologies), backup.beforeDigest, 'BACKUP_CHANGED');
  const record = await store.read();
  assertRecord(record);
  assert.equal(digest(record.state.technologies), backup.afterDigest, 'LIBRARY_CHANGED_MANUAL_RESTORE_REQUIRED');
  const forward = JSON.parse(await readFile(path.join(path.dirname(backupPath), 'applied-plan.json'), 'utf8'));
  assert.equal(forward.planDigest, backup.planDigest, 'BACKUP_PLAN_MISMATCH');
  assertNoCommittedIndexReferences(record.state, await store.references(), forward.findings
    .map(row => ({ ...row, from: row.to, to: row.from })));
  const state = nextState(record, backup.technologies);
  const directory = await newDirectory(artifactsRoot);
  await writeJson(path.join(directory, 'before-rollback.json'), { version: 1, technologies: record.state.technologies, revision: record.revision });
  const result = await saveAndVerify(store, record, state, 'maintenance:technology-index2-rollback');
  await writeJson(path.join(directory, 'result.json'), { ...result, restoredFrom: backupPath });
  return { ...result, restoredFrom: backupPath };
};

const createStore = async root => {
  const require = createRequire(path.join(root, 'package.json'));
  require('@next/env').loadEnvConfig(root);
  const { createClient } = require('@supabase/supabase-js');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(30000) }) }
  });
  const checked = async query => { const result = await query; if (result.error) throw result.error; return result.data; };
  return {
    source: () => checked(db.rpc('get_original_inventory_search_source')),
    read: () => checked(db.from('material_planning_state').select('id,state,revision,updated_at,updated_by').eq('id', 'main').single()),
    references: () => checked(db.from('material_planning_state').select('id,revision,plan:state->plan').like('id', 'workspace:%')),
    generation: async () => (await checked(db.from('original_inventory_search_meta').select('generation').eq('id', true).single())).generation,
    save: async (state, revision, actor) => {
      const rows = await checked(db.rpc('save_material_planning_state', { p_module_id: 'main', p_state: state,
        p_expected_revision: revision, p_updated_by: actor }));
      assert.equal(rows?.length, 1, 'SAVE_RESULT_INVALID');
      return { revision: Number(rows[0].new_revision), conflict: rows[0].has_conflict === true };
    }
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const args = process.argv.slice(2);
    assert.ok((args.length === 0 || (args.length === 1 && args[0] === '--preview')) ||
      (args.length === 2 && ['--apply', '--rollback'].includes(args[0])),
    'Usage: node --experimental-strip-types scripts/normalize-technology-material-indices.mjs [--preview | --apply preview.json | --rollback backup.json]');
    const store = await createStore(root);
    const output = path.join(root, '.runtime', 'technology-index2');
    const result = args[0] === '--apply' ? await applyTechnologyIndexMigration(store, output, path.resolve(args[1]))
      : args[0] === '--rollback' ? await rollbackTechnologyIndexMigration(store, output, path.resolve(args[1]))
        : await previewTechnologyIndexMigration(store, output);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('TECHNOLOGY_INDEX2_MIGRATION_STOPPED', error.code ?? '', error.message);
    process.exitCode = 1;
  }
}
