import assert from 'node:assert/strict';
import test from 'node:test';
import { keepsProductionCompletedWorkInQueue, productionWorkQueueForTeam, setProductionTeamCompletion } from './productionWorkProgress.ts';

test('each team shows open additional tasks before recurring work without changing stored order', () => {
  for (const team of ['mechanics', 'distribution', 'technician', 'process', 'graphics', 'additional']) {
    const task = (id, station, completed = false) => ({ id, station, teams: [team], kinds: ['inne'],
      teamProgress: completed ? setProductionTeamCompletion({}, team, true) : {} });
    const input = [
      task('recurring-1', 'ZADANIE CYKLICZNE'),
      task('done-additional', 'ZADANIE DODATKOWE', true),
      task('production', 'WTR 1'),
      task('additional-1', 'ZADANIE DODATKOWE'),
      task('done-recurring', 'ZADANIE CYKLICZNE', true),
      task('recurring-2', 'ZADANIE CYKLICZNE'),
      task('additional-2', 'ZADANIE DODATKOWE'),
      { ...task('cancelled', 'ZADANIE DODATKOWE'), kinds: ['anulowane'] },
      { ...task('foreign', 'ZADANIE DODATKOWE'), teams: ['another-team'] }
    ];
    const before = JSON.stringify(input);
    const result = productionWorkQueueForTeam(input, team);
    assert.deepEqual(result.map(row => row.id), ['additional-1', 'additional-2', 'recurring-1', 'production', 'recurring-2',
      ...(keepsProductionCompletedWorkInQueue(team) ? ['done-additional', 'done-recurring'] : [])], team);
    assert.equal(JSON.stringify(input), before);
    assert.ok(result.every(row => input.includes(row)));
  }
});

test('queues without additional tasks keep their original order', () => {
  const input = ['ZADANIE CYKLICZNE', 'WTR 2', undefined].map((station, id) => ({ id, station, teams: ['mechanics'], kinds: ['inne'] }));
  assert.deepEqual(productionWorkQueueForTeam(input, 'mechanics'), input);
});
