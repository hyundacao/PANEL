import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function load(file) {
  const mod = new Module(file);
  mod.require = (name) => name.startsWith('@/')
    ? load(resolve(root, 'src', `${name.slice(2)}.ts`))
    : require(name);
  mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText, file);
  return mod.exports;
}

const { parseOriginalInventoryErpSnapshotPdfFile: parsePdf } = load(
  resolve(root, 'src/lib/utils/originalInventoryErpPdf.ts')
);

const text = (x, y, value) => {
  const hex = [...value].map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  return `BT /F1 10 Tf 1 0 0 -1 ${x} ${y} Tm <${hex}> Tj ET`;
};
const separator = (y) => `37 ${y} m 751 ${y} l S`;
const cells = (y, code, index, name, real, available, unit = 'szt.') => [
  text(34, y, code), text(74, y, index), text(182, y, name),
  text(446, y, unit), text(535, y, real), text(707, y, available)
];

function pdfFile(pages, compressed = false) {
  const stream = (value) => {
    const raw = Buffer.from(value, 'ascii');
    const bytes = compressed ? require('node:zlib').deflateSync(raw) : raw;
    return Buffer.concat([
      Buffer.from(`<< /Length ${bytes.length}${compressed ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
      bytes, Buffer.from('\nendstream')
    ]);
  };
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${7 + i * 2} 0 R`).join(' ')}] >>`,
    '<< /Font << /F1 4 0 R >> >>',
    '<< /Type /Font /Subtype /Type0 /ToUnicode 5 0 R /W 6 0 R >>',
    stream(`beginbfchar\n${Array.from({ length: 95 }, (_, i) => {
      const hex = (i + 32).toString(16).padStart(4, '0');
      return `<${hex}> <${hex}>`;
    }).join('\n')}\nendbfchar`),
    '[32 126 500]'
  ];
  pages.forEach((commands, i) => objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 1200] /Resources 3 0 R /Contents [${8 + i * 2} 0 R] >>`,
    stream(commands.join('\n'))
  ));
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(parts.reduce((sum, part) => sum + part.length, 0));
    parts.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(object) ? object : Buffer.from(object), Buffer.from('\nendobj\n'));
  });
  const xref = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(Buffer.from(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new File([Buffer.concat(parts)], 'erp.pdf', { type: 'application/pdf' });
}

test('keeps the next index multiline name out of the preceding grate row', async () => {
  const items = await parsePdf(pdfFile([[
    separator(175),
    ...cells(185, '9417', '1598-7', 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO', '1200,000', '1100,000'),
    separator(195),
    text(182, 205, 'SYSTEM 1000X63X98X148'),
    ...cells(217, '9876', '1700', 'KRATA STALOWA 1 M A15', '296,000', '200,000'),
    separator(225)
  ]]));
  assert.deepEqual(items.map(({ name, indexCode, realQty, availableQty }) => ({ name, indexCode, realQty, availableQty })), [
    { name: 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO', indexCode: '1598-7', realQty: 1200, availableQty: 1100 },
    { name: 'SYSTEM 1000X63X98X148 KRATA STALOWA 1 M A15', indexCode: '1700', realQty: 296, availableQty: 200 }
  ]);
});

test('reads the whole bounded row including long names and wrapped indices', async () => {
  const items = await parsePdf(pdfFile([[
    separator(175),
    ...cells(185, '111', 'M-1-LONG-', 'FIRST LINE', '1,000', '0,000', 'kg'),
    text(74, 197, 'INDEX'), text(182, 197, 'SECOND LINE'),
    text(182, 209, 'THIRD LINE'), text(182, 221, 'FOURTH LINE'),
    text(182, 233, 'FIFTH LINE'), separator(245),
    ...cells(255, '222', 'SECOND-INDEX', 'SEPARATE MATERIAL', '7,000', '5,000'), separator(265)
  ]], true));
  assert.equal(items.length, 2);
  assert.equal(items[0].name, 'FIRST LINE SECOND LINE THIRD LINE FOURTH LINE FIFTH LINE');
  assert.equal(items[0].indexCode, 'M-1-LONG- INDEX');
  assert.equal(items[0].availableQty, 0);
  assert.equal(items[1].name, 'SEPARATE MATERIAL');
  assert.equal(items[1].indexCode, 'SECOND-INDEX');
});

test('preserves SYSTEM when it is a continuation inside the grate row as in the 21 October report', async () => {
  const items = await parsePdf(pdfFile([[
    separator(175),
    ...cells(185, '9417', '1598-7', 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO', '740,000', '740,000'),
    text(182, 197, 'SYSTEM 1000X63X98X148'), separator(205),
    ...cells(215, '10906', 'M-1-KAR-BSHTR-', 'KRATOWNICA 1118X764X670 3W SZARY', '6,000', '6,000'),
    text(74, 227, '10906'), text(182, 227, 'KOMPLETNA'), separator(235)
  ]]));
  assert.equal(items.length, 2);
  assert.equal(items[0].indexCode, '1598-7');
  assert.equal(items[0].name, 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO SYSTEM 1000X63X98X148');
  assert.equal(items[0].availableQty, 740);
  assert.equal(items[1].name, 'KRATOWNICA 1118X764X670 3W SZARY KOMPLETNA');
  assert.equal(items[1].availableQty, 6);
});

test('keeps table bounds separate between PDF pages', async () => {
  const items = await parsePdf(pdfFile([
    [separator(175), ...cells(185, '1', 'A', 'LAST ON PAGE ONE', '10', '9'), separator(195)],
    [separator(175), text(182, 185, 'FIRST ON'), ...cells(197, '2', 'B', 'PAGE TWO', '20', '19'), separator(205)]
  ]));
  assert.deepEqual(items.map((item) => item.name), ['LAST ON PAGE ONE', 'FIRST ON PAGE TWO']);
  assert.deepEqual(items.map((item) => item.availableQty), [9, 19]);
});

test('preserves the previous fallback for reports without table rules', async () => {
  const items = await parsePdf(pdfFile([[
    ...cells(185, '1', 'A', 'FIRST', '10', '9'), text(182, 197, 'CONTINUATION'),
    ...cells(215, '2', 'B', 'SECOND', '20', '19')
  ]]));
  assert.deepEqual(items.map((item) => item.name), ['FIRST CONTINUATION', 'SECOND']);
});

test('different indices with identical names remain separate', async () => {
  const items = await parsePdf(pdfFile([[
    separator(175), ...cells(185, '1', 'A', 'SAME NAME', '10', '9'), separator(195),
    ...cells(205, '2', 'B', 'SAME NAME', '20', '19'), separator(215)
  ]]));
  assert.deepEqual(items.map((item) => [item.indexCode, item.availableQty]), [['A', 9], ['B', 19]]);
});

test('parses the checked-in stock report without losing rows or multiline names', async () => {
  const items = await parsePdf(new File([readFileSync(resolve(root, 'stanyna dzienpdf.pdf'))], 'stock.pdf', { type: 'application/pdf' }));
  assert.equal(items.length, 379);
  const grate = items.find((item) => item.indexCode === '1598-7');
  assert.equal(grate.name, 'KRATA STALOWA 1M IMPORT Z LOGO DOMELO');
  assert.equal(grate.realQty, 71);
  assert.equal(grate.availableQty, 71);
  assert.equal(items.find((item) => item.indexCode === '1901-BSH-005- P649070').name,
    'PEHACRYL-U LAKIER METALICZNY SILBER (VZF 3 9171) MAINTENANCE DOOR INOX');
  assert.ok(items.every((item) => !item.indexCode?.includes('18.03.2026')),
    'Page footer dates must not be appended to material indices');
  assert.ok(items.some((item) => item.indexCode === '547-8'));
  assert.ok(items.some((item) => item.indexCode === 'TP101351'));
});
