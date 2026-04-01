const ORIGINAL_INVENTORY_NAME_CHARS =
  'A-Za-z0-9膭膯臉艁艃脫艢殴呕膮膰臋艂艅贸艣藕偶';

const collapseNameSeparatedHyphens = (value: string) =>
  value.replace(
    new RegExp(
      `([${ORIGINAL_INVENTORY_NAME_CHARS}])\\s*-\\s*([${ORIGINAL_INVENTORY_NAME_CHARS}])`,
      'g'
    ),
    '$1-$2'
  );

export const normalizeOriginalInventoryName = (value: unknown) =>
  collapseNameSeparatedHyphens(
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  );

export const normalizeOriginalInventoryNameKey = (value: unknown) =>
  normalizeOriginalInventoryName(value).toLowerCase();
