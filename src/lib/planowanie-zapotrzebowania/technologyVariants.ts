type TechnologyVariant = {
  id: string;
  variant: 'base' | 'alternative';
  alternativeNo: number;
  description: string;
  archived: boolean;
};

type ProductIdentity = { productIndex: string; productName: string };
type ProductReference = ProductIdentity & { id: string; sourceKeys?: string[] };
type ProductTechnology = ProductIdentity & { id: string; linkedProducts?: ProductReference[] };

export const renameTechnologyProduct = <T extends ProductTechnology>(
  technologies: readonly T[],
  edited: T,
  expectedSource: ProductIdentity,
  sameProduct: (left: ProductIdentity, right: ProductIdentity) => boolean,
  referenceKey: (link: ProductReference) => string
) => {
  const source = technologies.find(item => item.id === edited.id);
  if (!source) throw new Error('TECHNOLOGY_NOT_FOUND');
  if (source.productIndex !== expectedSource.productIndex || source.productName !== expectedSource.productName) {
    throw new Error('TECHNOLOGY_PRODUCT_CHANGED');
  }
  const identity = { productIndex: edited.productIndex.trim(), productName: edited.productName.trim() };
  if (!identity.productIndex || !identity.productName) throw new Error('TECHNOLOGY_PRODUCT_REQUIRED');
  const familyIds = new Set(technologies.filter(item => sameProduct(item, source)).map(item => item.id));
  if (technologies.some(item => !familyIds.has(item.id) && sameProduct(item, identity))) {
    throw new Error('TECHNOLOGY_PRODUCT_CONFLICT');
  }
  return technologies.map(original => {
    const value = original.id === edited.id ? edited : original;
    const renamed = familyIds.has(original.id) ? { ...value, ...identity } : value;
    if (!renamed.linkedProducts?.some(link => sameProduct(link, source))) return renamed;
    return {
      ...renamed,
      linkedProducts: renamed.linkedProducts.map(link => {
        if (!sameProduct(link, source)) return link;
        // Old workspace selections remain usable without rewriting other users' plans.
        const sourceKeys = [...new Set([...(link.sourceKeys ?? []), referenceKey(link)])].filter(Boolean);
        return { ...link, ...identity, sourceKeys };
      })
    };
  });
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
