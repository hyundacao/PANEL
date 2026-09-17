export type GrindingTechnology = {
  id: string;
  productIndex: string;
  productName: string;
  variant: 'base' | 'alternative';
  archived: boolean;
  materials: Array<{ category: string; usage: number; unit: string }>;
};

export type GrindingMassMatch =
  | { status: 'ready'; technology: GrindingTechnology; kgPerPiece: number }
  | { status: 'ambiguous' | 'not-found' | 'no-mass' };

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[łŁ]/g, 'l')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const normalizeIndex = (value: string) => {
  const key = normalize(value);
  return /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, '') : key;
};

export const grindingMassPerPieceKg = (technology: GrindingTechnology): number | null => {
  const kg = technology.materials.reduce((total, material) => {
    const category = normalize(material.category);
    if (category !== 'tworzywo' && category !== 'barwnik') return total;
    if (!Number.isFinite(material.usage) || material.usage <= 0) return total;
    const unit = normalize(material.unit).replaceAll('.', '');
    if (['kg', 'kilogram', 'kilogramy', 'kilograma'].includes(unit)) return total + material.usage;
    if (['g', 'gram', 'gramy', 'grama'].includes(unit)) return total + material.usage / 1000;
    return total;
  }, 0);
  return kg > 0 && Number.isFinite(kg) ? kg : null;
};

/** Never infer a weight from a similarly named product with a different index. */
export const matchGrindingTechnologyMass = (
  materialName: string,
  catalogIndices: readonly string[],
  technologies: readonly GrindingTechnology[]
): GrindingMassMatch => {
  const activeBase = technologies.filter((technology) => technology.variant === 'base' && !technology.archived);
  const indices = [...new Set(catalogIndices.map(normalizeIndex).filter(Boolean))];
  if (indices.length > 1) return { status: 'ambiguous' };
  const matches = indices.length === 1
    ? activeBase.filter((technology) => normalizeIndex(technology.productIndex) === indices[0])
    : activeBase.filter((technology) => normalize(technology.productName) === normalize(materialName));
  if (matches.length > 1) return { status: 'ambiguous' };
  const technology = matches[0];
  if (!technology) return { status: 'not-found' };
  const kgPerPiece = grindingMassPerPieceKg(technology);
  return kgPerPiece === null ? { status: 'no-mass' } : { status: 'ready', technology, kgPerPiece };
};
