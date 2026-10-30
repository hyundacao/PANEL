import { randomUUID } from 'crypto';
import { assertImportFile, assertImportRequest } from '@/lib/security/import-limits';
import { assertWorksheetLimits, IMPORT_SHEET_ROWS } from '@/lib/utils/spreadsheetLimits';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseOriginalInventoryCatalogRows } from '@/lib/utils/originalInventoryCatalog';
import { syncOriginalInventoryCatalogFromSnapshot } from '@/lib/utils/originalInventoryCatalogSync';
import { assertOriginalInventoryImportIndices, ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR } from '@/lib/utils/originalInventoryIndex';

export const dynamic = 'force-dynamic';

const parseCatalogImportFile = async (
  file: File
): Promise<Array<{ name: string; unit: string; indexCode: string | null; indexCode2?: string | null; warehouseCode: string | null }>> => {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', raw: false, sheetRows: IMPORT_SHEET_ROWS });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  assertWorksheetLimits(sheet);
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: ''
  }) as unknown[][];

  return parseOriginalInventoryCatalogRows(rows);
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

    assertImportRequest(request);
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 'FILE_REQUIRED' }, { status: 400 });
    }

    await assertImportFile(file, ['xlsx', 'xls', 'csv']);
    const normalized = await parseCatalogImportFile(file);
    if (normalized.length === 0) {
      return NextResponse.json({ code: 'EMPTY' }, { status: 400 });
    }

    assertOriginalInventoryImportIndices(normalized);
    if (normalized.some(item => item.indexCode2)) {
      const { error } = await supabaseAdmin.from('original_inventory_catalog').select('index_code2').range(0, 0);
      if (error) throw new Error(error.code === '42703' || error.code === 'PGRST204' ? 'MIGRATION_REQUIRED_INVENTORY_INDICES' : 'IMPORT_FAILED');
    }
    const catalogSync = await syncOriginalInventoryCatalogFromSnapshot(supabaseAdmin, normalized);
    return NextResponse.json({
      total: normalized.length,
      inserted: catalogSync.added,
      updated: catalogSync.updated,
      skipped: normalized.length - catalogSync.added - catalogSync.updated,
      catalogSync,
      catalogRefreshToken: randomUUID()
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message
        ? error.message
        : 'UNKNOWN';
    const status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'EMPTY' || code === 'FILE_REQUIRED' || code === ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR || code === 'AMBIGUOUS_INDEX_COLUMNS'
        ? 400
        : code === 'MIGRATION_REQUIRED_INVENTORY_INDICES' ? 503
        : 500;
    return NextResponse.json({ code }, { status });
  }
}
