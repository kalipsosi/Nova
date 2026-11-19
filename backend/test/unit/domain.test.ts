import assert from 'node:assert/strict';
import test from 'node:test';
import { projectDaily } from '../../src/categories.js';
import { buildForecast, cycleStats } from '../../src/forecast.js';
import { parseFlo } from '../../src/flo.js';

test('forecast always carries medical disclaimer', () => {
  const forecast = buildForecast([{ periodStart: '2026-01-01', periodEnd: '2026-01-05' }, { periodStart: '2026-01-29', periodEnd: null }], '2026-02-01');
  assert.equal(forecast.approximate, true);
  assert.equal(forecast.notForContraception, true);
  assert.match(forecast.disclaimer, /контрацепции/);
  assert.equal(cycleStats([{ periodStart: '2026-01-01', periodEnd: null }]).averageCycleLength, null);
});

test('daily projection exposes only the requested category', () => {
  const record = { logDate: '2026-02-01', symptoms: ['усталость'], mood: 'спокойно', sleepHours: 8, sleepQuality: 'хорошо', energy: 'средняя', wellbeing: 'нормально', sexualActivity: 'нет', notes: 'личное' };
  assert.deepEqual(projectDaily('mood', record), { date: '2026-02-01', mood: 'спокойно' });
  assert.equal(projectDaily('notes', { ...record, notes: null }), null);
});

test('Flo parser keeps unknown fields in a report and creates stable source keys', () => {
  const first = parseFlo({ cycles: [{ periodStart: '2026-01-02', periodEnd: '2026-01-05', strange: 'x' }], logs: [{ date: '2026-01-03', mood: 'спокойно', unknown: 2 }] });
  const second = parseFlo({ cycles: [{ periodStart: '2026-01-02', periodEnd: '2026-01-05', strange: 'x' }], logs: [{ date: '2026-01-03', mood: 'спокойно', unknown: 2 }] });
  assert.equal(first.cycles[0].sourceKey, second.cycles[0].sourceKey);
  assert.ok(first.unknownFields.length >= 2);
});
