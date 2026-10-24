// PDF line wrapping can add spaces around index separators. Keep all segments intact.
export const normalizeOriginalInventoryIndex = (value: unknown) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*([-\/])\s*/g, '$1')
    .replace(/^M\s*-?\s*(\d+)/i, 'M-$1')
    .toUpperCase();
