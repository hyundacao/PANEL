import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const sqlModuleFiles = [
  '01_konta_i_uprawnienia.sql',
  '02_magazyn_przemialow.sql',
  '03_przesuniecia_erp.sql',
  '04_spis_rzeczywisty_i_stany_erp.sql',
  '05_farby_i_tasmy.sql',
  '06_przygotowanie_produkcji.sql',
  '07_planowanie_zapotrzebowania.sql',
  '08_raporty.sql',
  '09_powiadomienia.sql'
];

export const readSqlModule = (file, root = projectRoot) => {
  if (!sqlModuleFiles.includes(file)) throw new Error(`Unknown SQL module: ${file}`);
  return readFileSync(path.join(root, 'supabase', file), 'utf8');
};

export const listSqlSources = (root = projectRoot) => {
  const sources = new Map();
  for (const file of sqlModuleFiles) {
    const text = readSqlModule(file, root);
    const begin = /^-- SQL_SOURCE_BEGIN: ([^\r\n]+)\r?\n/gm;
    let match;
    while ((match = begin.exec(text))) {
      const name = match[1];
      const start = begin.lastIndex;
      const endMarker = `\n-- SQL_SOURCE_END: ${name}\n`;
      const end = text.indexOf(endMarker, start);
      if (end < 0) throw new Error(`Unclosed SQL section: ${name}`);
      if (sources.has(name)) throw new Error(`Duplicate SQL section: ${name}`);
      sources.set(name, { file, sql: text.slice(start, end) });
      begin.lastIndex = end + endMarker.length;
    }
  }
  return sources;
};

// These are current install sections, not byte-for-byte historical migrations.
export const readSqlSource = (name, root = projectRoot) => {
  const source = listSqlSources(root).get(name);
  if (!source) throw new Error(`Unknown SQL section: ${name}`);
  return source.sql;
};
