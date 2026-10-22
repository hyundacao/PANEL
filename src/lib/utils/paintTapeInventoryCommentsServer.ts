import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaintTapeInventoryComment, SavePaintTapeInventoryComment } from '@/lib/api/types';

const table = 'paint_tape_inventory_comments';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checkResult = (error: { code?: string; message: string } | null) => {
  if (!error) return;
  if (error.code === '42P01' || error.code === 'PGRST205') {
    throw new Error('MIGRATION_REQUIRED_PAINT_TAPE_INVENTORY_COMMENTS');
  }
  if (error.code === '23505') throw new Error('INVENTORY_COMMENT_CONFLICT');
  throw error;
};
const mapComment = (row: Record<string, unknown>): PaintTapeInventoryComment => ({
  sessionId: String(row.session_id), catalogItemId: String(row.catalog_item_id),
  text: String(row.comment_text), revision: Number(row.revision),
  updatedAt: String(row.updated_at), updatedBy: String(row.updated_by)
});

export const fetchPaintTapeInventoryComments = async (db: SupabaseClient, sessionId: string) => {
  if (!uuid.test(sessionId)) throw new Error('NOT_FOUND');
  const comments: PaintTapeInventoryComment[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from(table).select('*').eq('session_id', sessionId)
      .order('catalog_item_id').range(offset, offset + 999);
    checkResult(result.error);
    const page = result.data ?? [];
    comments.push(...page.map(mapComment));
    if (page.length < 1000) return comments;
  }
};

export const savePaintTapeInventoryComment = async (
  db: SupabaseClient, input: SavePaintTapeInventoryComment, actor: string
) => {
  if (!input || !uuid.test(input.sessionId) || !uuid.test(input.catalogItemId)) throw new Error('NOT_FOUND');
  if (typeof input.text !== 'string' || input.text.length > 4000 || input.text.includes('\0') ||
    !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision >= 2147483647) {
    throw new Error('INVENTORY_COMMENT_INVALID');
  }
  const entry = await db.from('paint_tape_inventory_entries').select('id')
    .eq('session_id', input.sessionId).eq('catalog_item_id', input.catalogItemId).limit(1).maybeSingle();
  checkResult(entry.error);
  if (!entry.data) throw new Error('NOT_FOUND');
  const row = {
    session_id: input.sessionId, catalog_item_id: input.catalogItemId,
    comment_text: input.text.trim(), revision: input.expectedRevision + 1,
    updated_at: new Date().toISOString(), updated_by: actor
  };
  // Clearing text keeps its revision so an outdated editor cannot silently recreate it.
  const result = input.expectedRevision === 0
    ? await db.from(table).insert(row).select('*').single()
    : await db.from(table).update(row).eq('session_id', input.sessionId)
      .eq('catalog_item_id', input.catalogItemId).eq('revision', input.expectedRevision).select('*').maybeSingle();
  checkResult(result.error);
  if (!result.data) throw new Error('INVENTORY_COMMENT_CONFLICT');
  return mapComment(result.data);
};
