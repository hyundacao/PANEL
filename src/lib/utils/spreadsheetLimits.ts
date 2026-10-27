import { utils, type WorkSheet } from 'xlsx';

export const IMPORT_SHEET_ROWS = 100001;
export const assertWorksheetLimits = (sheet: WorkSheet) => {
  const ref = sheet['!fullref'] || sheet['!ref'];
  if (!ref) return;
  const range = utils.decode_range(ref);
  if (range.e.r >= 100000 || range.e.c >= 512 ||
      (range.e.r + 1) * (range.e.c + 1) > 2000000) throw new Error('IMPORT_TOO_LARGE');
};
