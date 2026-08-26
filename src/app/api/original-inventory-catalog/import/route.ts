import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  normalizeOriginalInventoryCatalogIdentityKey,
  parseOriginalInventoryCatalogRows
} from '@/lib/utils/originalInventoryCatalog';

export const dynamic = 'force-dynamic';
const ORIGINAL_CATALOG_PAGE_SIZE = 1000;

const parseCatalogImportFile = async (
  file: File
): Promise<Array<{ name: string; unit: string; indexCode: string | null; warehouseCode: string | null }>> => {
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

  return parseOriginalInventoryCatalogRows(rows);
};

const fetchAllOriginalCatalogRows = async () => {
  const rows: Array<{ name: string | null; index_code: string | null }> = [];
  for (let from = 0; ; from += ORIGINAL_CATALOG_PAGE_SIZE) {
    const to = from + ORIGINAL_CATALOG_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('original_inventory_catalog')
      .select('name, index_code')
      .range(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < ORIGINAL_CATALOG_PAGE_SIZE) {
      break;
    }
  }
  return rows;
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

    const canWriteOriginalInventory =
      (canSeeTab(
        auth.user,
        'PLANOWANIE_ZAPOTRZEBOWANIA',
        'planowanie-zapotrzebowania'
      ) && !isReadOnly(auth.user, 'PLANOWANIE_ZAPOTRZEBOWANIA')) ||
      (canSeeTab(auth.user, 'PRZEMIALY', 'spis-oryginalow') &&
        !isReadOnly(auth.user, 'PRZEMIALY'));

    if (!canWriteOriginalInventory) {
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
      (await fetchAllOriginalCatalogRows()).map((row) =>
        normalizeOriginalInventoryCatalogIdentityKey(row.name ?? '', row.index_code ?? '')
      )
    );

    const toInsert = normalized.filter(
      (item) => !existingSet.has(normalizeOriginalInventoryCatalogIdentityKey(item.name, item.indexCode))
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
        index_code: item.indexCode,
        warehouse_code: item.warehouseCode,
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
