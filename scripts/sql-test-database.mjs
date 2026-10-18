import { readFileSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { PGlite } from '@electric-sql/pglite';
import { projectRoot } from './sql-files.mjs';

export const readSqlBackup = async () => JSZip.loadAsync(
  readFileSync(path.join(projectRoot, 'docs/archiwum-sql-przed-porzadkowaniem.zip')),
  { checkCRC32: true }
);

// Isolated PostgreSQL engine. Never reads credentials or connects to Supabase.
export const createSqlTestDatabase = async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema extensions;
    create function auth.role() returns text language sql as $$ select current_user::text $$;
  `);
  return db;
};

export const withoutUnavailableTestExtension = (sql) => sql.replace(
  /create extension if not exists "pgcrypto" with schema extensions;/g,
  '-- pgcrypto is supplied by Supabase; not available in the isolated test engine.'
);

export const loadSuppliedDatabase = async (db) => {
  const zip = await readSqlBackup();
  await db.exec(withoutUnavailableTestExtension(await zip.file('wklejony_sql.sql').async('string')));
  for (const name of ['04_spis_farb_i_tasm.sql', '05_planowanie_zapotrzebowania.sql', '06_anulowanie_przesuniec.sql']) {
    await db.exec(await zip.file(`zakladki_supabase/${name}`).async('string'));
  }
  // Legacy objects visible in the live API but absent from the newer installer.
  await db.exec(`
    create table public.halls (id uuid primary key default gen_random_uuid(), name text not null,
      order_no integer not null, is_active boolean not null default true);
    alter table public.original_inventory_erp_snapshots add column qty numeric;
  `);
};
