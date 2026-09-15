import type { ProductionTeam } from './productionTeamComments';

export const PRODUCTION_WORK_COMMENT_NOTE_PREFIX = '__workComment:';
export const PRODUCTION_WORK_COMMENT_MAX_LENGTH = 500;

export type ProductionWorkComment = {
  text: string;
  author: string;
  updatedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const productionWorkCommentNoteKey = (team: ProductionTeam) =>
  `${PRODUCTION_WORK_COMMENT_NOTE_PREFIX}${team}`;

export const normalizeProductionWorkCommentText = (value: string) =>
  value.replace(/\r\n?/g, '\n').trim();

export const validateProductionWorkCommentText = (value: unknown): string | null => {
  if (typeof value !== 'string') return 'Nieprawidłowa treść komentarza.';
  if (value.length > PRODUCTION_WORK_COMMENT_MAX_LENGTH) {
    return `Komentarz może mieć maksymalnie ${PRODUCTION_WORK_COMMENT_MAX_LENGTH} znaków.`;
  }
  return null;
};

export const productionWorkCommentFromNotes = (
  notes: unknown,
  team: ProductionTeam
): ProductionWorkComment | null => {
  if (!isRecord(notes)) return null;
  const encoded = notes[productionWorkCommentNoteKey(team)];
  if (typeof encoded !== 'string') return null;

  try {
    const parsed = JSON.parse(encoded) as unknown;
    if (!isRecord(parsed)) return null;
    const text = typeof parsed.text === 'string'
      ? normalizeProductionWorkCommentText(parsed.text)
      : '';
    if (!text) return null;
    return {
      text,
      author: typeof parsed.author === 'string' ? parsed.author.trim() : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : ''
    };
  } catch {
    return null;
  }
};

export const withProductionWorkComment = (
  notes: Record<string, string | undefined>,
  team: ProductionTeam,
  text: string,
  author: string,
  updatedAt: string
) => {
  const next = Object.fromEntries(
    Object.entries(notes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
  const key = productionWorkCommentNoteKey(team);
  const normalizedText = normalizeProductionWorkCommentText(text);
  if (!normalizedText) {
    delete next[key];
    return next;
  }
  next[key] = JSON.stringify({
    text: normalizedText,
    author: author.trim(),
    updatedAt
  } satisfies ProductionWorkComment);
  return next;
};
