type TechnologyVariant = {
  id: string;
  variant: 'base' | 'alternative';
  alternativeNo: number;
  description: string;
  archived: boolean;
};

export const promoteTechnologyToBase = <T extends TechnologyVariant>(
  technologies: readonly T[],
  alternativeId: string,
  formerBaseDescription: string,
  sameProduct: (candidate: T, selected: T) => boolean,
  expectedBaseId?: string
) => {
  const selected = technologies.filter(item => item.id === alternativeId);
  if (selected.length !== 1 || selected[0].archived || selected[0].variant !== 'alternative') {
    throw new Error('TECHNOLOGY_ALTERNATIVE_REQUIRED');
  }
  const alternative = selected[0];
  const variants = technologies.filter(item => sameProduct(item, alternative));
  const bases = variants.filter(item => !item.archived && item.variant === 'base');
  if (bases.length !== 1) throw new Error('TECHNOLOGY_BASE_AMBIGUOUS');
  const base = bases[0];
  if (expectedBaseId && base.id !== expectedBaseId) throw new Error('TECHNOLOGY_BASE_CHANGED');
  const description = formerBaseDescription.trim();
  if (!description) throw new Error('TECHNOLOGY_ALTERNATIVE_DESCRIPTION_REQUIRED');

  const takenNumbers = new Set(variants.filter(item => item.id !== alternative.id && item.variant === 'alternative')
    .map(item => item.alternativeNo).filter(number => Number.isSafeInteger(number) && number > 0));
  const alternativeNo = Number.isSafeInteger(alternative.alternativeNo) && alternative.alternativeNo > 0
    && !takenNumbers.has(alternative.alternativeNo)
    ? alternative.alternativeNo : Math.max(0, ...takenNumbers) + 1;
  const promoted = { ...alternative, variant: 'base' as const, alternativeNo: 0, description: '' };
  const demoted = { ...base, variant: 'alternative' as const, alternativeNo, description };
  return {
    promoted,
    demoted,
    technologies: technologies.map(item => item.id === alternative.id ? promoted : item.id === base.id ? demoted : item)
  };
};
