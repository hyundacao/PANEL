const ORIGINAL_INVENTORY_NAME_LETTERS =
  'A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż';

const collapseLetterSeparatedHyphens = (value: string) =>
  value.replace(
    new RegExp(
      `([${ORIGINAL_INVENTORY_NAME_LETTERS}])\\s*-\\s*([${ORIGINAL_INVENTORY_NAME_LETTERS}])`,
      'g'
    ),
    '$1-$2'
  );

export const normalizeOriginalInventoryName = (value: unknown) =>
  collapseLetterSeparatedHyphens(
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  );

export const normalizeOriginalInventoryNameKey = (value: unknown) =>
  normalizeOriginalInventoryName(value).toLowerCase();
