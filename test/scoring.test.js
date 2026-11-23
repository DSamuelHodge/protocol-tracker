import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDay } from '../src/lib/scoring.js';
import { DEFAULTS } from '../src/lib/settings.js';
import { resolveScheduledSession } from '../src/lib/schedule.js';

const S = DEFAULTS;
const planned = resolveScheduledSession('2026-11-24', S).session;

function day(overrides = {}, ctx = {}) {
  return buildDay(S, overrides.day || '2026-11-24', {
    scheduled: planned,
    today: '2026-11-24',
    ...ctx,
  });
}

test('a completed session, steps, protein, and an early last meal score done', () => {
  const d = day({}, {
    logged: { status: 'completed', source: 'manual' },
    vitals: { steps: 12000, sleep_hours: 7.6 },
    checkin: {
      protein_g: 195, kcal: 2300, water_oz: 110, morning_sun: 1, sugary_drinks: 0,
      last_meal_time: '19:00', bed_time: '22:30',
    },
  });
  for (const h of ['session', 'steps', 'sleep', 'protein_day', 'calories', 'water', 'sun', 'sugar', 'last_meal']) {
    assert.equal(d.habits[h].state, 'done', h);
  }
  assert.equal(d.score.done, 9);
  assert.equal(d.score.total, 9);
  assert.equal(d.habit_order.includes('window'), false);
});

test('today stays pending and a past day becomes missed', () => {
  const today = day();
  assert.equal(today.habits.session.state, 'pending');
  assert.equal(today.habits.steps.state, 'pending');
  const past = buildDay(S, '2026-11-24', { scheduled: planned, today: '2026-11-25' });
  assert.equal(past.habits.session.state, 'missed');
  assert.equal(past.habits.protein_day.state, 'missed');
  assert.equal(past.habits.walks.state, 'missed');
});

test('yesterday sleep stays pending so the next sync can fill it', () => {
  const y = buildDay(S, '2026-11-23', { today: '2026-11-24', scheduled: null });
  assert.equal(y.habits.sleep.state, 'pending');
  const older = buildDay(S, '2026-11-21', { today: '2026-11-24', scheduled: null });
  assert.equal(older.habits.sleep.state, 'missed');
});

test('ranges and the water floor', () => {
  const low = day({}, { checkin: { protein_g: 100, kcal: 2600, water_oz: 80, sugary_drinks: 1, morning_sun: 0 }, vitals: { sleep_hours: 7.2, steps: 4000 } });
  assert.equal(low.habits.protein_day.state, 'missed');
  assert.equal(low.habits.calories.state, 'missed');
  assert.equal(low.habits.water.state, 'missed');
  assert.equal(low.habits.sugar.state, 'missed');
  assert.equal(low.habits.sun.state, 'missed');
  assert.equal(low.habits.sleep.state, 'missed');
  assert.equal(low.habits.steps.state, 'pending');

  const extraWater = day({}, { checkin: { water_oz: 140 } });
  assert.equal(extraWater.habits.water.state, 'done');
  assert.match(extraWater.habits.water.detail, /above/);
});

test('last meal uses the 2 hour rule, including a bedtime after midnight', () => {
  const late = day({}, { checkin: { last_meal_time: '21:00', bed_time: '22:30' } });
  assert.equal(late.habits.last_meal.state, 'missed');
  const overnight = day({}, { checkin: { last_meal_time: '21:00', bed_time: '00:30' } });
  assert.equal(overnight.habits.last_meal.state, 'done');
});

test('a manual habit row wins and a Withings sleep row does not freeze the old 7 hour goal', () => {
  const manual = day({}, {
    rows: [{ habit: 'sleep', done: 1, value: 6.5, source: 'manual' }],
    vitals: { sleep_hours: 6.5 },
  });
  assert.equal(manual.habits.sleep.state, 'done');
  assert.equal(manual.habits.sleep.overridden, true);

  const watch = day({}, {
    rows: [{ habit: 'sleep', done: 1, value: 7.2, source: 'withings' }],
    vitals: { sleep_hours: 7.2 },
  });
  assert.equal(watch.habits.sleep.state, 'missed');
  assert.equal(watch.habits.sleep.overridden, undefined);
});

test('daily protein prefers the check-in over the old two meal cards', () => {
  const d = day({}, {
    meals: [{ slot: 1, protein_g: 40, carbs_g: 10, ts: 1 }, { slot: 2, protein_g: 40, carbs_g: 10, ts: 2 }],
    checkin: { protein_g: 190 },
  });
  assert.equal(d.habits.protein_day.state, 'done');
  assert.equal(d.habits.protein.state, 'done');
  assert.equal(d.protein_total, 190);
});

test('skipped session is missed and a partial session counts', () => {
  assert.equal(day({}, { logged: { status: 'skipped' } }).habits.session.state, 'missed');
  assert.equal(day({}, { logged: { status: 'partial' } }).habits.session.state, 'done');
});
