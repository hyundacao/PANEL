import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const ORIGINAL_CATALOG_PAGE_SIZE = 1000;

const normalizeImportCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeCatalogNameKey = (value: unknown) => normalizeImportCell(value).toLowerCase();

const isCatalogHeaderRow = (name: string, unit: string) => {
  const normalizedName = name.toLowerCase();
  const normalizedUnit = unit.toLowerCase().replace(/\./g, '');
  const nameHeaders = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
  const unitHeaders = new Set(['jedn', 'jm', 'jednostka', 'unit']);
  return nameHeaders.has(normalizedName) && (!normalizedUnit || unitHeaders.has(normalizedUnit));
};

const parseCatalogImportFile = async (file: File): Promise<Array<{ name: string; unit: string }>> => {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', raw: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: ''
  }) as unknown[][];

  const items: Array<{ name: string; unit: string }> = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = normalizeImportCell(row?.[0]);
    const unitCell = normalizeImportCell(row?.[1]);
    if (!name) return;
    if (index === 0 && isCatalogHeaderRow(name, unitCell)) return;
    const key = normalizeCatalogNameKey(name);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, unit: unitCell || 'kg' });
  });

  return items;
};

const fetchAllOriginalCatalogNames = async () => {
  const names: string[] = [];
  for (let from = 0; ; from += ORIGINAL_CATALOG_PAGE_SIZE) {
    const to = from + ORIGINAL_CATALOG_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('original_inventory_catalog')
      .select('name')
      .range(from, to);
    if (error) throw error;
    const page = data ?? [];
    names.push(...page.map((row: { name: string | null }) => row.name ?? ''));
    if (page.length < ORIGINAL_CATALOG_PAGE_SIZE) {
      break;
    }
  }
  return names;
};

export async function POST(request: Request) {
  try {
    const auth = await getAuthenticatedUser(request);
    if (!auth.user) {
      const response = NextResponse.json({ code: auth.code }, { status: 401 });
      if (auth.code === 'SESSION_EXPIRED') {
        clearSessionCookie(response);
      }
      return response;
    }

    if (
      !canSeeTab(auth.user, 'PRZEMIALY', 'spis-oryginalow') ||
      isReadOnly(auth.user, 'PRZEMIALY')
    ) {
      return NextResponse.json({ code: 'FORBIDDEN' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 'FILE_REQUIRED' }, { status: 400 });
    }

    const normalized = await parseCatalogImportFile(file);
    if (normalized.length === 0) {
      return NextResponse.json({ code: 'EMPTY' }, { status: 400 });
    }

    const existingSet = new Set(
      (await fetchAllOriginalCatalogNames()).map((name) => normalizeCatalogNameKey(name))
    );

    const toInsert = normalized.filter(
      (item) => !existingSet.has(normalizeCatalogNameKey(item.name))
    );
    if (toInsert.length === 0) {
      return NextResponse.json({
        total: normalized.length,
        inserted: 0,
        skipped: normalized.length
      });
    }

    const now = new Date().toISOString();
    const chunkSize = 500;
    let inserted = 0;

    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize).map((item) => ({
        id: randomUUID(),
        name: item.name,
        unit: item.unit,
        created_at: now
      }));
      const { error } = await supabaseAdmin.from('original_inventory_catalog').insert(chunk);
      if (error) throw error;
      inserted += chunk.length;
    }

    return NextResponse.json({
      total: normalized.length,
      inserted,
      skipped: normalized.length - inserted
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message
        ? error.message
        : 'UNKNOWN';
    const status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'EMPTY' || code === 'FILE_REQUIRED'
        ? 400
        : 500;
    return NextResponse.json({ code }, { status });
  }
}
