export const PRODUCTION_TEAMS = ['mechanics', 'process', 'distribution', 'graphics', 'technician', 'additional'] as const;
export type ProductionTeam = typeof PRODUCTION_TEAMS[number];
export type TeamComment = { enabled: boolean; text: string; showQuantity: boolean };
export type TeamComments = Record<ProductionTeam, TeamComment>;

export const TEAM_COMMENT_MAX_LENGTH = 2000;
export const TEAM_COMMENT_KEY_PREFIX = '__team_comment__:';
const STANDARD_5S = 'Po wykonanym zadaniu poprawnie ustaw tabliczkę 5S.';
const DEFAULT_ENABLED_TEAMS: readonly ProductionTeam[] = ['mechanics', 'process', 'distribution', 'technician'];
const DEFAULT_QUANTITY_TEAMS: readonly ProductionTeam[] = ['distribution', 'graphics', 'additional'];

export const isProductionTeam = (value: unknown): value is ProductionTeam =>
  typeof value === 'string' && PRODUCTION_TEAMS.includes(value as ProductionTeam);

export const defaultTeamComments = (): TeamComments => Object.fromEntries(
  PRODUCTION_TEAMS.map((team) => [team, {
    enabled: DEFAULT_ENABLED_TEAMS.includes(team),
    text: DEFAULT_ENABLED_TEAMS.includes(team) ? STANDARD_5S : '',
    showQuantity: DEFAULT_QUANTITY_TEAMS.includes(team)
  }])
) as TeamComments;

export const normalizeTeamComment = (value: unknown, team: ProductionTeam, previous?: unknown): TeamComment => {
  const fallback = defaultTeamComments()[team];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === 'string'
    ? record.text.replace(/\r\n?/g, '\n').trim().slice(0, TEAM_COMMENT_MAX_LENGTH)
    : fallback.text;
  const stored = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous as Record<string, unknown> : {};
  return {
    enabled: (typeof record.enabled === 'boolean' ? record.enabled : fallback.enabled) && Boolean(text),
    text,
    showQuantity: typeof record.showQuantity === 'boolean' ? record.showQuantity
      : typeof stored.showQuantity === 'boolean' ? stored.showQuantity : fallback.showQuantity
  };
};

export const normalizeTeamComments = (value: unknown): TeamComments => {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(PRODUCTION_TEAMS.map((team) => [team, normalizeTeamComment(source[team], team)])) as TeamComments;
};

export const validateTeamComment = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Nieprawidłowe ustawienie komentarza.';
  const record = value as Record<string, unknown>;
  if (typeof record.enabled !== 'boolean' || typeof record.text !== 'string') return 'Nieprawidłowe ustawienie komentarza.';
  if (record.showQuantity !== undefined && typeof record.showQuantity !== 'boolean') return 'Nieprawidłowe ustawienie widoczności ilości.';
  if (record.text.length > TEAM_COMMENT_MAX_LENGTH) return `Komentarz może mieć maksymalnie ${TEAM_COMMENT_MAX_LENGTH} znaków.`;
  if (record.enabled && !record.text.trim()) return 'Wpisz treść komentarza albo go wyłącz.';
  return null;
};

export const teamCommentForTask = (settings: TeamComments, team: ProductionTeam, station: string): string => {
  if (station === 'ZADANIE DODATKOWE') return '';
  return settings[team].enabled ? settings[team].text : '';
};

export const productionMetricsForTask = (
  settings: TeamComments,
  team: ProductionTeam,
  task: { station: string; quantity: string; norm: string }
): string => {
  if (task.station === 'ZADANIE DODATKOWE' || !settings[team].showQuantity) return '';
  return `Ilość: ${task.quantity || '---'} | Norma: ${task.norm || '---'}`;
};
