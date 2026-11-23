import assert from 'node:assert/strict';
import test from 'node:test';
import { activityWindow, hoursBeforeBed } from '../src/lib/dates.js';
import { applyRemFallback, normalizeSleepNight, remSecondsFromStages, SLEEP_STATE } from '../src/lib/sleep.js';
import { kgToLb } from '../src/lib/units.js';

test('activity window stays 14 days ending today', () => {
  assert.deepEqual(activityWindow('2026-11-23'), { fromDay: '2026-11-10', toDay: '2026-11-23' });
});

test('kilograms from the scale become pounds at one decimal', () => {
  assert.equal(kgToLb(100), 220.5);
  assert.equal(kgToLb(80), 176.4);
});

test('summary REM is read from remsleepduration, including older aliases', () => {
  const night = normalizeSleepNight({
    date: '2026-11-22', startdate: 100, enddate: 200,
    data: { deepsleepduration: 3600, lightsleepduration: 12000, remsleepduration: 5400, total_sleep_time: 21000 },
  });
  assert.equal(night.remSeconds, 5400);
  assert.equal(night.deepSeconds, 3600);
  const alias = normalizeSleepNight({ date: '2026-11-21', data: { rem_sleep_duration: 600 } });
  assert.equal(alias.remSeconds, 600);
});

test('a missing REM summary is filled from state 3 stage segments and a real zero is kept', () => {
  const nights = [normalizeSleepNight({
    date: '2026-11-22', startdate: 1000, enddate: 5000,
    data: { deepsleepduration: 100, lightsleepduration: 100 },
  })];
  assert.equal(nights[0].remSeconds, null);
  const filled = applyRemFallback(nights, [
    { state: SLEEP_STATE.rem, startdate: 1100, enddate: 1700 },
    { state: SLEEP_STATE.deep, startdate: 1700, enddate: 2000 },
    { state: SLEEP_STATE.light, startdate: 900, enddate: 1100 },
  ]);
  assert.equal(filled[0].remSeconds, 600);
  assert.equal(filled[0].remSource, 'stages');

  const zero = applyRemFallback([
    normalizeSleepNight({ date: '2026-11-22', startdate: 1, enddate: 9, data: { remsleepduration: 0, deepsleepduration: 10 } }),
  ], [{ state: 3, startdate: 1, enddate: 9 }]);
  assert.equal(zero[0].remSeconds, 0);
  assert.equal(remSecondsFromStages([{ state: 3, startdate: 0, enddate: 50 }], 10, 40), 30);
});

test('hours before bed treats a post-midnight bedtime as the same night', () => {
  assert.equal(hoursBeforeBed('19:00', '22:30'), 3.5);
  assert.equal(hoursBeforeBed('21:00', '00:30'), 3.5);
  assert.ok(hoursBeforeBed('21:30', '22:30') < 2);
});
