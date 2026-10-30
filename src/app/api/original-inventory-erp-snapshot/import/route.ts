import { randomUUID } from 'crypto';
import { assertImportFile, assertImportRequest } from '@/lib/security/import-limits';
import { assertWorksheetLimits, IMPORT_SHEET_ROWS } from '@/lib/utils/spreadsheetLimits';
import { after, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncOriginalInventoryCatalogFromSnapshot } from '@/lib/utils/originalInventoryCatalogSync';
import { assertOriginalInventoryImportIndices, ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR } from '@/lib/utils/originalInventoryIndex';
import { originalErpRetentionCutoff } from '@/lib/utils/paintTapeInventoryArchive';
import { getInventoryImportIndexColumns, normalizeInventoryImportHeader } from '@/lib/utils/originalInventoryImportColumns';
import {
  normalizeOriginalInventoryName,
  normalizeOriginalInventoryNameKey
} from '@/lib/utils/originalInventoryName';
import {
  isOriginalInventoryErpSnapshotPdfFile,
  parseOriginalInventoryErpSnapshotPdfFile
} from '@/lib/utils/originalInventoryErpPdf';

export const dynamic = 'force-dynamic';

const SNAPSHOT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const normalizeImportCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeNameKey = (value: unknown) => normalizeOriginalInventoryNameKey(value);

const normalizeSnapshotIndexCode = (value: unknown) => normalizeImportCell(value) || null;

const extractSnapshotWarehouseCode = (value: unknown) => {
  const text = normalizeImportCell(value);
  if (!text) return null;
  const match = text.match(/M[-\s]?\d+/i);
  if (!match) return null;
  return match[0].replace(/\s+/g, '-').toUpperCase();
};

const parseSnapshotQty = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = normalizeImportCell(value).replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isSnapshotHeaderRow = (name: string, availableQty: unknown, realQty: unknown) => {
  const normalizedName = name.toLowerCase();
  const availableQtyText = normalizeImportCell(availableQty).toLowerCase();
  const realQtyText = normalizeImportCell(realQty).toLowerCase();
  const nameHeaders = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
  const availableQtyHeaders = new Set([
    'stan do dyspozycji erp',
    'stan do dyspozycji',
    'dostepne',
    'dostępne',
    'available',
    'available qty',
    'stan dostepny',
    'stan dostępny',
    'ilosc',
    'ilość',
    'qty',
    'quantity',
    'stan'
  ]);
  const realQtyHeaders = new Set(['stan rzeczywisty erp', 'stan rzeczywisty']);
  return (
    nameHeaders.has(normalizedName) &&
    availableQtyHeaders.has(availableQtyText) &&
    (realQtyText === '' || realQtyHeaders.has(realQtyText))
  );
};

const isMissingSnapshotsTableError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(candidate.code ?? '').trim();
  if (code === '42P01') return true;
  const text = [String(candidate.message ?? ''), String(candidate.details ?? '')]
    .join(' ')
    .toLowerCase();
  return (
    text.includes('original_inventory_erp_snapshots') ||
    text.includes('real_qty') ||
    text.includes('available_qty') ||
    text.includes('index_code') ||
    text.includes('warehouse_code') ||
    text.includes('original_inventory_erp_snapshots_date_name_idx') ||
    text.includes('duplicate key value violates unique constraint')
  );
};

const snapshotHeaderLayout = (row: unknown[]) => {
  const headers = row.map(normalizeInventoryImportHeader);
  const find = (...names: string[]) => headers.findIndex(header => names.includes(header));
  const name = find('nazwa', 'material', 'tworzywo', 'kartoteka', 'name');
  const available = find('stan do dyspozycji erp', 'stan do dyspozycji', 'dostepne', 'available', 'available qty', 'stan dostepny', 'ilosc', 'qty', 'quantity', 'stan');
  if (name < 0 || available < 0) return null;
  return { name, available, real: find('stan rzeczywisty erp', 'stan rzeczywisty', 'real qty'),
    unit: find('jednostka', 'jedn', 'jm', 'j m', 'unit'), ...getInventoryImportIndexColumns(row) };
};

const parseSnapshotImportFile = async (file: File) => {
  if (isOriginalInventoryErpSnapshotPdfFile(file)) {
    return parseOriginalInventoryErpSnapshotPdfFile(file);
  }
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

  const merged = new Map<
    string,
    {
      name: string;
      realQty: number;
      availableQty: number;
      unit: string;
      indexCode: string | null;
      indexCode2?: string | null;
      warehouseCode: string | null;
      catalogIssue?: string;
    }
  >();
  const layout = snapshotHeaderLayout(rows[0] ?? []);

  rows.forEach((row, index) => {
    if (layout && index === 0) return;
    const name = normalizeOriginalInventoryName(row?.[layout?.name ?? 0]);
    const availableQty = parseSnapshotQty(row?.[layout?.available ?? 1]);
    const thirdCell = row?.[2];
    const thirdCellText = normalizeImportCell(thirdCell);
    const parsedRealQty = parseSnapshotQty(thirdCell);
    const fourthCellText = normalizeImportCell(row?.[3]);
    const usesNewLayout = fourthCellText.length > 0;
    const realQty = layout ? (layout.real >= 0 ? parseSnapshotQty(row[layout.real]) : availableQty)
      : usesNewLayout ? parsedRealQty : parsedRealQty ?? availableQty;
    const unitCell = layout ? normalizeImportCell(row[layout.unit]) : usesNewLayout ? fourthCellText : thirdCellText;
    const catalogIssue = /[\p{L}]/u.test(unitCell) ? undefined : 'Brak jednostki w pliku — nie dodano kartoteki.';

    if (!name) return;
    if (index === 0 && isSnapshotHeaderRow(name, row?.[1], row?.[2])) return;
    if (realQty === null || availableQty === null) return;

    const indexCode = normalizeSnapshotIndexCode(row?.[layout?.index1 ?? 4]);
    const indexCode2 = layout && layout.index2 >= 0 ? normalizeSnapshotIndexCode(row[layout.index2]) : null;
    const warehouseCode = extractSnapshotWarehouseCode(indexCode);
    const key = `${normalizeNameKey(name)}|${indexCode ?? ''}`;
    const existing = merged.get(key);
    if (existing) {
      if (existing.indexCode2 && indexCode2 && existing.indexCode2 !== indexCode2) throw new Error('CONFLICTING_INDEX_COLUMNS');
      if (indexCode2) existing.indexCode2 = indexCode2;
      existing.realQty += realQty;
      existing.availableQty += availableQty;
      if (catalogIssue) existing.catalogIssue = catalogIssue;
      if (existing.unit && unitCell && existing.unit.toLowerCase().replace(/\.$/, '') !== unitCell.toLowerCase().replace(/\.$/, '')) {
        existing.catalogIssue = 'Sprzeczne jednostki dla tego samego indeksu w pliku — nie dodano kartoteki.';
      }
      if (!existing.unit && unitCell) {
        existing.unit = unitCell;
      }
      if (!existing.indexCode && indexCode) {
        existing.indexCode = indexCode;
      }
      if (!existing.warehouseCode && warehouseCode) {
        existing.warehouseCode = warehouseCode;
      }
      return;
    }

    merged.set(key, {
      name,
      realQty,
      availableQty,
      unit: unitCell || 'kg',
      catalogIssue,
      indexCode,
      ...(indexCode2 ? { indexCode2 } : {}),
      warehouseCode
    });
  });

  return [...merged.values()];
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
    const snapshotDate = String(formData.get('snapshotDate') ?? '').trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 'FILE_REQUIRED' }, { status: 400 });
    }
    if (!SNAPSHOT_DATE_REGEX.test(snapshotDate)) {
      return NextResponse.json({ code: 'DATE_REQUIRED' }, { status: 400 });
    }

    await assertImportFile(file, ['pdf', 'xlsx', 'xls', 'csv']);
    const items = await parseSnapshotImportFile(file);
    if (items.length === 0) {
      return NextResponse.json({ code: 'EMPTY' }, { status: 400 });
    }

    // Validate the whole file before removing any previously imported stock.
    assertOriginalInventoryImportIndices(items);
    const hasSecondaryIndex = items.some(item => 'indexCode2' in item && Boolean(item.indexCode2));
    const { data: importResult, error: importError } = await supabaseAdmin.rpc(hasSecondaryIndex ? 'replace_original_inventory_erp_snapshot_v2' : 'replace_original_inventory_erp_snapshot', {
      p_date: snapshotDate,
      p_imported_by: auth.user.username ?? auth.user.name ?? 'nieznany',
      p_source_file: file.name?.trim() || null,
      p_rows: items.map(item => ({
        name: item.name, real_qty: item.realQty, available_qty: item.availableQty, unit: item.unit,
        index_code: normalizeSnapshotIndexCode(item.indexCode),
        ...(hasSecondaryIndex ? { index_code2: 'indexCode2' in item ? normalizeSnapshotIndexCode(item.indexCode2) : null } : {}),
        warehouse_code: item.warehouseCode ?? extractSnapshotWarehouseCode(item.indexCode)
      }))
    });
    if (importError) {
      if (importError.code === 'PGRST202') throw new Error(hasSecondaryIndex ? 'MIGRATION_REQUIRED_INVENTORY_INDICES' : 'MIGRATION_REQUIRED_SECURITY');
      if (isMissingSnapshotsTableError(importError)) throw new Error('MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS');
      if (importError.message?.includes('ERP_SNAPSHOT_ARCHIVE_REQUIRED')) throw new Error('ERP_SNAPSHOT_ARCHIVE_REQUIRED');
      throw new Error('IMPORT_FAILED');
    }
    const result = Array.isArray(importResult) ? importResult[0] : importResult;
    if (!result) throw new Error('IMPORT_FAILED');
    const { inserted, replaced } = result;

    // The daily stock is already saved; catalog issues are non-blocking warnings.
    const catalogSync = await syncOriginalInventoryCatalogFromSnapshot(supabaseAdmin, items).catch(() => ({
      added: 0, updated: 0, existing: 0, failed: true, warningCount: 1,
      warnings: [{ name: '', indexCode: '', reason: 'Stany ERP zostały wgrane. Nie udało się zakończyć dopisywania kartotek; ponów import, aby spróbować ponownie.' }]
    }));
    after(async () => {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
      const { error } = await supabaseAdmin.rpc('purge_original_inventory_erp_snapshots', {
        p_cutoff_date: originalErpRetentionCutoff(today)
      });
      if (error && error.code !== 'PGRST202') console.error('ORIGINAL_ERP_IMPORT_PURGE_FAILED', error);
    });
    return NextResponse.json({
      total: items.length,
      inserted,
      replaced,
      snapshotDate,
      catalogSync,
      catalogRefreshToken: randomUUID()
    });
  } catch (error) {
    const code = error instanceof Error && error.message ? error.message : 'UNKNOWN';
    const status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'FILE_REQUIRED' || code === 'DATE_REQUIRED' || code === 'EMPTY' || code === ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR || code === 'AMBIGUOUS_INDEX_COLUMNS' || code === 'CONFLICTING_INDEX_COLUMNS'
          ? 400
          : code === 'ERP_SNAPSHOT_ARCHIVE_REQUIRED'
            ? 409
          : code === 'MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS' || code === 'MIGRATION_REQUIRED_SECURITY' || code === 'MIGRATION_REQUIRED_INVENTORY_INDICES'
            ? 503
            : 500;
    return NextResponse.json({ code }, { status });
  }
}
