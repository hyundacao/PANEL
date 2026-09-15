import assert from 'node:assert/strict';
import test from 'node:test';
import * as comments from './productionWorkComments.ts';

test('work comments round-trip with author and timestamp', () => {
  const notes = comments.withProductionWorkComment(
    { distribution: 'Przygotuj stanowisko' },
    'distribution',
    '  Suszarka gotowa o 10:35\r\nMożna pobrać.  ',
    'Anna',
    '2026-09-15T08:35:00.000Z'
  );

  assert.equal(notes.distribution, 'Przygotuj stanowisko');
  assert.deepEqual(comments.productionWorkCommentFromNotes(notes, 'distribution'), {
    text: 'Suszarka gotowa o 10:35\nMożna pobrać.',
    author: 'Anna',
    updatedAt: '2026-09-15T08:35:00.000Z'
  });
});

test('empty work comment removes only its own metadata', () => {
  const withComment = comments.withProductionWorkComment(
    { process: 'Uruchom maszynę' },
    'distribution',
    'Gotowe',
    'Anna',
    '2026-09-15T08:35:00.000Z'
  );
  const cleared = comments.withProductionWorkComment(
    withComment,
    'distribution',
    '   ',
    'Anna',
    '2026-09-15T08:36:00.000Z'
  );

  assert.equal(comments.productionWorkCommentFromNotes(cleared, 'distribution'), null);
  assert.equal(cleared.process, 'Uruchom maszynę');
});

test('work comment validation enforces a bounded string payload', () => {
  assert.match(comments.validateProductionWorkCommentText(null), /Nieprawidłowa/);
  assert.equal(comments.validateProductionWorkCommentText(''), null);
  assert.equal(comments.validateProductionWorkCommentText('x'.repeat(500)), null);
  assert.match(comments.validateProductionWorkCommentText('x'.repeat(501)), /500/);
  assert.equal(comments.productionWorkCommentFromNotes({ '__workComment:distribution': '{broken' }, 'distribution'), null);
});
