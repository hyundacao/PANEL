// PDF line wrapping can add spaces around index separators. Keep all segments intact.
export const normalizeOriginalInventoryIndex = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*([-\/])\s*/g, '$1')
    .replace(/^M\s*-?\s*(\d+)/i, 'M-$1')
    .toUpperCase();

export const ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR = 'INDEX_CONTAINS_REPORT_TIMESTAMP';
export const ORIGINAL_INVENTORY_INDEX_TIMESTAMP_MESSAGE =
  'Indeks zawiera datę i godzinę wydruku. Zapis przerwany; dotychczasowe dane pozostały bez zmian.';

// Report footers are metadata, never part of a material identity. Do not guess a corrected index.
const reportTimestampPattern = /(?:^|\s)((?:\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\s+\d{1,2}:\d{2}(?::\d{2})?)(?=$|\s)/;
const indexText = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const hasOriginalInventoryReportTimestamp = (value: unknown) =>
  reportTimestampPattern.test(indexText(value));

export const isOriginalInventoryReportTimestamp = (value: unknown) => {
  const text = indexText(value);
  return reportTimestampPattern.exec(text)?.[1] === text;
};

export const assertOriginalInventoryImportIndices = (items: readonly { indexCode?: unknown }[]) => {
  if (items.some(item => hasOriginalInventoryReportTimestamp(item?.indexCode))) {
    throw new Error(ORIGINAL_INVENTORY_INDEX_TIMESTAMP_ERROR);
  }
};
