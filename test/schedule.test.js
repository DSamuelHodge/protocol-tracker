import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { isoWeekday } from '../src/lib/dates.js';
import { DEFAULTS } from '../src/lib/settings.js';
import {
  chooseWeightAnchor, describeProgram, lookupSchedule, programMeta, resolveScheduledSession, scheduleSeedRows, TEMPLATES, weightGuide,
} from '../src/lib/schedule.js';

const S = DEFAULTS;
const seed = scheduleSeedRows();

function at(day) {
  return resolveScheduledSession(day, S, seed);
}

test('weekdays for the offset week', () => {
  assert.equal(isoWeekday('2026-11-23'), 1);
  assert.equal(isoWeekday('2026-11-24'), 2);
  assert.equal(isoWeekday('2026-11-26'), 4);
  assert.equal(isoWeekday('2026-11-29'), 7);
  assert.equal(isoWeekday('2026-11-30'), 1);
  assert.equal(isoWeekday('2026-12-06'), 7);
  assert.equal(isoWeekday('2026-12-07'), 1);
});

test('offset week plays the previous weekday session, and Thanksgiving is Strength B', () => {
  assert.equal(at('2026-11-23').active, false);
  assert.equal(at('2026-11-23').session, null);

  const tue = at('2026-11-24');
  assert.equal(tue.offset, true);
  assert.equal(tue.week, 1);
  assert.equal(tue.session.session_type, 'strength_a');
  assert.equal(tue.session.name, 'Full Body Strength A');
  assert.equal(tue.session.rounds, 2);
  assert.equal(tue.session.exercises[0].name, 'Sit-to-stand squats');
  assert.equal(tue.session.exercises[0].sets, 2);
  assert.equal(tue.session.exercises[0].reps, 12);
  assert.equal(tue.session.exercises[3].each_side, true);
  assert.match(describeProgram(tue, tue.session, S), /Offset week/);

  assert.equal(at('2026-11-25').session.session_type, 'zone2');
  assert.deepEqual(at('2026-11-25').session.hr_zone, [110, 130]);

  const thanks = at('2026-11-26');
  assert.equal(thanks.offset, true);
  assert.equal(thanks.session.session_type, 'strength_b');
  assert.equal(thanks.session.name, 'Full Body Strength B');
  assert.equal(thanks.session.rounds, 2);
  assert.equal(thanks.session.exercises.map((e) => e.name).includes('Band Romanian deadlift'), true);

  assert.equal(at('2026-11-27').session.session_type, 'recovery');
  assert.equal(at('2026-11-28').session.session_type, 'circuit');
  assert.equal(at('2026-11-28').session.rounds, 3);
  assert.equal(at('2026-11-29').session.session_type, 'long_cardio');
  assert.equal(at('2026-11-29').session.duration_min, 75);
});

test('standard week starts Monday Nov 30 and the third week uses 3 sets', () => {
  const mon = at('2026-11-30');
  assert.equal(mon.offset, false);
  assert.equal(mon.week, 2);
  assert.equal(mon.session.session_type, 'strength_a');
  assert.equal(mon.session.rounds, 2);

  assert.equal(at('2026-12-01').session.session_type, 'zone2');
  assert.equal(at('2026-12-02').session.rounds, 2);
  assert.equal(at('2026-12-02').session.session_type, 'strength_b');
  assert.equal(at('2026-12-05').session.session_type, 'long_cardio');
  assert.equal(at('2026-12-06').session.session_type, 'mobility');
  assert.equal(at('2026-12-06').week, 2);

  const week3 = at('2026-12-07');
  assert.equal(week3.week, 3);
  assert.equal(week3.ramp, false);
  assert.equal(week3.session.rounds, 3);
  assert.equal(at('2026-12-09').session.session_type, 'strength_b');
  assert.equal(at('2026-12-09').session.rounds, 3);
});

test('seed rows and the resolver agree for every day through mid-December', () => {
  let day = '2026-11-23';
  for (let i = 0; i < 22; i++) {
    const resolved = at(day);
    const row = lookupSchedule(day, seed);
    const meta = programMeta(day, S);
    if (!meta.active) assert.equal(resolved.session, null);
    else assert.equal(resolved.session_type || null, row?.session_type || null);
    day = next(day);
  }
});

test('migration SQL names every exercise and the offset dates', () => {
  const sql = fs.readFileSync(new URL('../migrations/0001_lit_program.sql', import.meta.url), 'utf8');
  for (const template of Object.values(TEMPLATES)) {
    assert.match(sql, new RegExp(template.id));
    for (const ex of template.exercises || []) assert.match(sql, new RegExp(ex.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(sql, /2026-11-24/);
  assert.match(sql, /2026-11-26/);
  assert.match(sql, /2026-11-29/);
  assert.match(sql, /2026-11-30/);
  assert.match(sql, /strength_b/);
  assert.match(sql, /legacy_training/);
  assert.match(sql, /Walk taps stay events/);
});

test('the guide anchor does not backdate the program onto an older weigh-in', () => {
  const weights = [
    { day: '2026-10-20', weight: 238.4 },
    { day: '2026-11-23', weight: 235.1 },
  ];
  assert.deepEqual(chooseWeightAnchor(weights, DEFAULTS), { day: '2026-11-24', weight: 235.1 });
  assert.deepEqual(chooseWeightAnchor([{ day: '2026-12-01', weight: 234 }], DEFAULTS), { day: '2026-12-01', weight: 234 });
  assert.deepEqual(chooseWeightAnchor(weights, { ...DEFAULTS, start_weight: 236 }), { day: '2026-11-24', weight: 236 });
});

test('weight guide is 1 and 2 pounds per week from the anchor', () => {
  const g = weightGuide(238, '2026-11-24', '2026-12-01', 1, 2);
  assert.equal(g.gentle, 237);
  assert.equal(g.fast, 236);
  assert.equal(weightGuide(238, '2026-11-24', '2026-11-24').gentle, 238);
});

function next(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
