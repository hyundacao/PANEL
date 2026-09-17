import assert from 'node:assert/strict';
import test from 'node:test';
import { grindingMassPerPieceKg, matchGrindingTechnologyMass } from './grindingTechnologyMass.ts';

const technology = (productIndex, productName, materials, extra = {}) => ({
  id: productIndex, productIndex, productName, variant: 'base', archived: false, materials, ...extra
});

test('sums plastic and colorant mass per piece without packaging', () => {
  const recipe = technology('123', 'Pokrywa', [
    { category: 'Tworzywo', usage: 0.33, unit: 'kg' },
    { category: 'Barwnik', usage: 5, unit: 'g' },
    { category: 'Karton', usage: 0.1, unit: 'kg' },
    { category: 'Element montażowy', usage: 2, unit: 'szt.' }
  ]);
  assert.equal(grindingMassPerPieceKg(recipe), 0.335);
  const match = matchGrindingTechnologyMass('Pokrywa', ['123'], [recipe]);
  assert.equal(match.status, 'ready');
  if (match.status === 'ready') assert.equal(match.kgPerPiece * 100, 33.5);
});

test('an index wins over a similar name, and different indexes do not merge', () => {
  const a = technology('123', 'Panel', [{ category: 'Tworzywo', usage: 0.1, unit: 'kg' }]);
  const b = technology('456', 'Panel', [{ category: 'Tworzywo', usage: 0.2, unit: 'kg' }]);
  const match = matchGrindingTechnologyMass('Panel', ['456'], [a, b]);
  assert.equal(match.status, 'ready');
  if (match.status === 'ready') assert.equal(match.kgPerPiece, 0.2);
  assert.equal(matchGrindingTechnologyMass('Panel', ['123', '456'], [a, b]).status, 'ambiguous');
  assert.equal(matchGrindingTechnologyMass('Panel', [], [a, b]).status, 'ambiguous');
  assert.equal(matchGrindingTechnologyMass('Panel', ['999'], [a, b]).status, 'not-found');
});

test('uses only an active base technology with an explicit plastic mass', () => {
  const archived = technology('1', 'Detal', [{ category: 'Tworzywo', usage: 0.5, unit: 'kg' }], { archived: true });
  const alternative = technology('1', 'Detal', [{ category: 'Tworzywo', usage: 0.4, unit: 'kg' }], { variant: 'alternative' });
  const base = technology('1', 'Detal', [{ category: 'Karton', usage: 1, unit: 'szt.' }]);
  assert.equal(matchGrindingTechnologyMass('Detal', ['1'], [archived, alternative, base]).status, 'no-mass');
});
