import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { projectRoot, readSqlModule, readSqlSource, sqlModuleFiles } from '../../../scripts/sql-files.mjs';

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const backup = async () => JSZip.loadAsync(
  readFileSync(path.join(projectRoot, 'docs', 'archiwum-sql-przed-porzadkowaniem.zip')),
  { checkCRC32: true }
);

test('SQL has one flat authoritative directory with nine module files', () => {
  const entries = readdirSync(path.join(projectRoot, 'supabase'), { withFileTypes: true });
  assert.ok(entries.every((entry) => entry.isFile()));
  assert.deepEqual(entries.map((entry) => entry.name).sort(),
    [...sqlModuleFiles, '.gitattributes', 'CZYTAJ_NAJPIERW.md'].sort());
});

test('SQL module lookup rejects unknown files and section names', () => {
  assert.throws(() => readSqlModule('../package.json'), /Unknown SQL module/);
  assert.throws(() => readSqlSource('unknown.sql'), /Unknown SQL section/);
});

test('backup preserves all original SQL files and their checksums', async () => {
  const zip = await backup();
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.databaseExecution, 'not-performed');
  assert.equal(manifest.files.length, 33);
  for (const entry of manifest.files) {
    const buffer = await zip.file(entry.path).async('nodebuffer');
    assert.equal(buffer.length, entry.bytes, entry.path);
    assert.equal(hash(buffer), entry.sha256, entry.path);
  }
});

test('archive preserves all six Supabase tabs and all 60 historical source fragments', async () => {
  const zip = await backup();
  const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
  assert.equal(manifest.sections.length, 60);
  assert.equal(manifest.savedQueries.length, 6);
  for (const entry of manifest.savedQueries) {
    const content = await zip.file(entry.path).async('nodebuffer');
    assert.equal(content.length, entry.bytes, entry.path);
    assert.equal(hash(content), entry.sha256, entry.path);
  }
  for (const section of manifest.sections) {
    const original = await zip.file(section.archivePath).async('nodebuffer');
    const expected = section.startByte === undefined ? original : original.subarray(section.startByte, section.endByte);
    assert.equal(hash(expected), section.sha256, section.sourceId);
  }
  const pasted = manifest.sections.filter((section) => section.archivePath === 'wklejony_sql.sql')
    .sort((a, b) => a.startByte - b.startByte);
  assert.equal(pasted.length, 31);
  const original = await zip.file('wklejony_sql.sql').async('nodebuffer');
  assert.deepEqual(Buffer.concat(pasted.map((section) => original.subarray(section.startByte, section.endByte))), original);
});
