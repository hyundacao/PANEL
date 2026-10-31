import { randomUUID } from 'crypto';
import { assertImportFile, assertImportRequest } from '@/lib/security/import-limits';
import { assertWorksheetLimits, IMPORT_SHEET_ROWS } from '@/lib/utils/spreadsheetLimits';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseOriginalInventoryCatalogRows } from '@/lib/utils/originalInventoryCatalog';
import { normalizeInventoryImportHeader, getInventoryImportIndexColumns } from '@/lib/utils/originalInventoryImportColumns';
import { importOriginalInventoryCatalogRegister, normalizeCatalogRegisterItem } from '@/lib/utils/originalInventoryCatalogRegisterServer';
import { syncOriginalInventoryCatalogFromSnapshot } from '@/lib/utils/originalInventoryCatalogSync';
import { assertOriginalInventoryImportIndices, ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR } from '@/lib/utils/originalInventoryIndex';

export const dynamic = 'force-dynamic';

const parseCatalogImportFile = async (
  file: File
) => {
  const bytes = await file.arrayBuffer();
  const workbook = XLSX.read(bytes, { type: 'array', raw: false, sheetRows: IMPORT_SHEET_ROWS });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { items: [], registerFormat: false };

  const sheet = workbook.Sheets[firstSheetName];
  assertWorksheetLimits(sheet);
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: ''
  }) as unknown[][];

  const headers = (rows[0] ?? []).map(normalizeInventoryImportHeader);
  const columns = getInventoryImportIndexColumns(rows[0] ?? []);
  const registerFormat = columns.index1 >= 0 && columns.index2 >= 0 && headers.includes('nazwa artykulu (materialu)');
  if (registerFormat && !headers.some(header => ['jm', 'j m', 'jedn', 'jednostka', 'unit'].includes(header))) {
    throw new Error('CATALOG_REGISTER_UNIT_REQUIRED');
  }
  if (registerFormat) {
    const nameColumn = headers.indexOf('nazwa artykulu (materialu)');
    const unitColumn = headers.findIndex(header => ['jm', 'j m', 'jedn', 'jednostka', 'unit'].includes(header));
    if (rows.slice(1).some(row => row.some(cell => String(cell).trim()) &&
      [columns.index1, nameColumn, unitColumn].some(column => !String(row[column] ?? '').trim()))) {
      throw new Error('CATALOG_REGISTER_INVALID');
    }
  }
  return { items: parseOriginalInventoryCatalogRows(rows), registerFormat };
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
    const parsed = await parseCatalogImportFile(file);
    const normalized = parsed.items;
    if (normalized.length === 0) {
      return NextResponse.json({ code: 'EMPTY' }, { status: 400 });
    }

    assertOriginalInventoryImportIndices(normalized);
    if (parsed.registerFormat) {
      const result = await importOriginalInventoryCatalogRegister(supabaseAdmin,
        normalized.map(normalizeCatalogRegisterItem), file.name, auth.user.username || auth.user.name);
      return NextResponse.json({ total: normalized.length, inserted: result.added, updated: Math.max(0, result.processed - result.added),
        skipped: result.blocked, linked: result.linked, blocked: result.blocked, catalogRefreshToken: randomUUID() });
    }
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
        : code === 'REVISION_CONFLICT' ? 409
        : code === 'CATALOG_REGISTER_INVALID' || code === 'CATALOG_REGISTER_UNIT_REQUIRED' || code === 'CONFLICTING_INDEX_COLUMNS' ? 400
        : code === 'MIGRATION_REQUIRED_INVENTORY_INDICES' ? 503
        : 500;
    return NextResponse.json({ code }, { status });
  }
}
