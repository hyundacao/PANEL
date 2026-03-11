import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { canSeeTab, isReadOnly } from '@/lib/auth/access';
import { clearSessionCookie, getAuthenticatedUser } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const SNAPSHOT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SNAPSHOT_PAGE_SIZE = 1000;

const normalizeImportCell = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeNameKey = (value: unknown) => normalizeImportCell(value).toLowerCase();

const parseSnapshotQty = (value: unknown) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = normalizeImportCell(value).replace(/\s+/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const isSnapshotHeaderRow = (name: string, qty: unknown) => {
  const normalizedName = name.toLowerCase();
  const qtyText = normalizeImportCell(qty).toLowerCase();
  const nameHeaders = new Set(['nazwa', 'material', 'tworzywo', 'kartoteka', 'name']);
  const qtyHeaders = new Set(['ilosc', 'ilość', 'qty', 'quantity', 'stan']);
  return nameHeaders.has(normalizedName) && qtyHeaders.has(qtyText);
};

const isMissingSnapshotsTableError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = String(candidate.code ?? '').trim();
  if (code === '42P01') return true;
  const text = [String(candidate.message ?? ''), String(candidate.details ?? '')]
    .join(' ')
    .toLowerCase();
  return text.includes('original_inventory_erp_snapshots');
};

const parseSnapshotImportFile = async (file: File) => {
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

  const merged = new Map<string, { name: string; qty: number; unit: string }>();
  rows.forEach((row, index) => {
    const name = normalizeImportCell(row?.[0]);
    const qty = parseSnapshotQty(row?.[1]);
    const unitCell = normalizeImportCell(row?.[2]);
    if (!name) return;
    if (index === 0 && isSnapshotHeaderRow(name, row?.[1])) return;
    if (qty === null) return;
    const key = normalizeNameKey(name);
    const existing = merged.get(key);
    if (existing) {
      existing.qty += qty;
      if (!existing.unit && unitCell) {
        existing.unit = unitCell;
      }
      return;
    }
    merged.set(key, {
      name,
      qty,
      unit: unitCell || 'kg'
    });
  });

  return [...merged.values()];
};

const countExistingSnapshotRows = async (snapshotDate: string) => {
  let count = 0;
  for (let from = 0; ; from += SNAPSHOT_PAGE_SIZE) {
    const to = from + SNAPSHOT_PAGE_SIZE - 1;
    const { data, error } = await supabaseAdmin
      .from('original_inventory_erp_snapshots')
      .select('id')
      .eq('snapshot_date', snapshotDate)
      .range(from, to);
    if (error) {
      if (isMissingSnapshotsTableError(error)) {
        throw new Error('MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS');
      }
      throw error;
    }
    const page = data ?? [];
    count += page.length;
    if (page.length < SNAPSHOT_PAGE_SIZE) {
      break;
    }
  }
  return count;
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
    const snapshotDate = String(formData.get('snapshotDate') ?? '').trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 'FILE_REQUIRED' }, { status: 400 });
    }
    if (!SNAPSHOT_DATE_REGEX.test(snapshotDate)) {
      return NextResponse.json({ code: 'DATE_REQUIRED' }, { status: 400 });
    }

    const items = await parseSnapshotImportFile(file);
    if (items.length === 0) {
      return NextResponse.json({ code: 'EMPTY' }, { status: 400 });
    }

    const replaced = await countExistingSnapshotRows(snapshotDate);

    const { error: deleteError } = await supabaseAdmin
      .from('original_inventory_erp_snapshots')
      .delete()
      .eq('snapshot_date', snapshotDate);
    if (deleteError) {
      if (isMissingSnapshotsTableError(deleteError)) {
        throw new Error('MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS');
      }
      throw deleteError;
    }

    const importedAt = new Date().toISOString();
    const importedBy = auth.user.username ?? auth.user.name ?? 'nieznany';
    const sourceFileName = file.name?.trim() || null;

    const chunkSize = 500;
    let inserted = 0;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize).map((item) => ({
        id: randomUUID(),
        snapshot_date: snapshotDate,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        imported_at: importedAt,
        imported_by: importedBy,
        source_file_name: sourceFileName
      }));
      const { error } = await supabaseAdmin
        .from('original_inventory_erp_snapshots')
        .insert(chunk);
      if (error) {
        if (isMissingSnapshotsTableError(error)) {
          throw new Error('MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS');
        }
        throw error;
      }
      inserted += chunk.length;
    }

    return NextResponse.json({
      total: items.length,
      inserted,
      replaced,
      snapshotDate
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message
        ? error.message
        : 'UNKNOWN';
    const status =
      code === 'FORBIDDEN'
        ? 403
        : code === 'FILE_REQUIRED' || code === 'DATE_REQUIRED' || code === 'EMPTY'
        ? 400
        : code === 'MIGRATION_REQUIRED_ORIGINAL_INVENTORY_ERP_SNAPSHOTS'
        ? 503
        : 500;
    return NextResponse.json({ code }, { status });
  }
}
