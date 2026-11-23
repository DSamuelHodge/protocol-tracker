// L.I.T. week. Canonical rules live here; migrations/0001 seeds the same rows into program_schedule.
// The Worker prefers database rows when they exist and falls back to scheduleSeedRows().

import { addDays, daysBetween, isoWeekday } from './dates.js';

export const SESSION_TYPES = {
  strength_a: { template_id: 'strength_a_v1', weekday: 1 },
  zone2: { template_id: 'zone2_v1', weekday: 2 },
  strength_b: { template_id: 'strength_b_v1', weekday: 3 },
  recovery: { template_id: 'recovery_v1', weekday: 4 },
  circuit: { template_id: 'circuit_v1', weekday: 5 },
  long_cardio: { template_id: 'long_cardio_v1', weekday: 6 },
  mobility: { template_id: 'mobility_v1', weekday: 7 },
};

const TEMPO = '3s down / 3s up';
const STRENGTH_NOTE = 'Slow 3-second lower, 3-second lift, short rests. Log the band and the time under load for each set. Progress by a heavier band or +2 reps when the last two reps feel easy.';

export const TEMPLATES = {
  strength_a_v1: {
    id: 'strength_a_v1',
    name: 'Full Body Strength A',
    kind: 'strength',
    session_type: 'strength_a',
    warmup_min: 10,
    finisher: '15 min walk',
    default_rounds: 3,
    ramp_rounds: 2,
    tempo: TEMPO,
    notes: STRENGTH_NOTE,
    exercises: [
      { name: 'Sit-to-stand squats', reps: 12 },
      { name: 'Incline push-ups', reps: 10 },
      { name: 'Band rows', reps: 15 },
      { name: 'Assisted reverse lunges', reps: 10, each_side: true },
      { name: 'Band suitcase hold', seconds: 40 },
      { name: 'Plank', seconds: 30 },
    ],
  },
  strength_b_v1: {
    id: 'strength_b_v1',
    name: 'Full Body Strength B',
    kind: 'strength',
    session_type: 'strength_b',
    warmup_min: 10,
    finisher: '15 min walk',
    default_rounds: 3,
    ramp_rounds: 2,
    tempo: TEMPO,
    notes: STRENGTH_NOTE,
    exercises: [
      { name: 'Band squat', reps: 10 },
      { name: 'Band chest press', reps: 15 },
      { name: 'Band Romanian deadlift', reps: 12 },
      { name: 'Seated band shoulder press', reps: 12 },
      { name: 'Band pull-aparts', reps: 20 },
      { name: 'Dead bugs', reps: 12, each_side: true },
    ],
  },
  circuit_v1: {
    id: 'circuit_v1',
    name: 'Full Body Circuit',
    kind: 'circuit',
    session_type: 'circuit',
    warmup_min: 10,
    finisher: null,
    default_rounds: 3,
    ramp_rounds: 3, // circuit stays 3 rounds, including the first two weeks
    tempo: TEMPO,
    rest_label: 'Rest 60–90s between rounds',
    notes: 'Three rounds. Rest 60–90 seconds between rounds. Same slow tempo on the strength moves.',
    exercises: [
      { name: 'Squats', reps: 15 },
      { name: 'Elevated push-ups', reps: 12 },
      { name: 'Band rows', reps: 15 },
      { name: 'Step-ups', reps: 12, each_side: true },
      { name: 'Band hold / march', seconds: 60 },
      { name: 'Plank', seconds: 45 },
    ],
  },
  zone2_v1: {
    id: 'zone2_v1',
    name: 'Zone 2 cardio',
    kind: 'cardio',
    session_type: 'zone2',
    notes: 'Easy conversation pace. Stay in the heart-rate zone for the whole bout.',
    modalities: ['walk', 'incline_walk', 'hike', 'bike', 'elliptical'],
    uses_hr_zone: true,
  },
  long_cardio_v1: {
    id: 'long_cardio_v1',
    name: 'Long fat-burn',
    kind: 'cardio',
    session_type: 'long_cardio',
    notes: 'Long easy walk, hike, or bike. Keep it conversational.',
    modalities: ['walk', 'hike', 'bike'],
    uses_hr_zone: false,
  },
  recovery_v1: {
    id: 'recovery_v1',
    name: 'Recovery',
    kind: 'recovery',
    session_type: 'recovery',
    notes: 'A walk plus mobility and stretching. No strength work today.',
    checklist: ['Walk', 'Mobility', 'Stretching'],
  },
  mobility_v1: {
    id: 'mobility_v1',
    name: 'Mobility and recovery',
    kind: 'mobility',
    session_type: 'mobility',
    notes: 'Easy movement, joints, and stretching. Leave the bands alone.',
    checklist: ['Easy walk', 'Mobility', 'Stretching'],
  },
};

/** Rows mirrored by migrations/0001_lit_program.sql. */
export function scheduleSeedRows() {
  const rows = [];
  for (const [session_type, spec] of Object.entries(SESSION_TYPES)) {
    const weekday = spec.weekday + 1; // offset week: Tuesday plays Monday's session
    if (weekday <= 7) {
      rows.push({
        effective_from: '2026-11-24',
        effective_to: '2026-11-29',
        weekday,
        session_type,
        template_id: spec.template_id,
      });
    }
  }
  for (const [session_type, spec] of Object.entries(SESSION_TYPES)) {
    rows.push({
      effective_from: '2026-11-30',
      effective_to: null,
      weekday: spec.weekday,
      session_type,
      template_id: spec.template_id,
    });
  }
  return rows;
}

export function programMeta(day, S) {
  const start = S.program_start;
  const phase_weeks = S.phase_weeks || 16;
  if (!start || day < start) {
    return { active: false, week: null, offset: false, ramp: false, phase_weeks, six_month: start ? addDays(start, S.horizon_days || 182) : null };
  }
  const offsetFrom = S.offset_from;
  const offsetTo = S.offset_to;
  const offset = !!(offsetFrom && offsetTo && day >= offsetFrom && day <= offsetTo);
  const standard = S.standard_start || start;
  let week;
  if (offset) week = 1;
  else if (offsetFrom && offsetTo && standard > offsetTo) week = 2 + Math.floor(Math.max(0, daysBetween(standard, day)) / 7);
  else week = 1 + Math.floor(daysBetween(start, day) / 7);
  const rampWeeks = S.strength_ramp_weeks ?? 2;
  return {
    active: true,
    week,
    offset,
    ramp: week <= rampWeeks,
    phase_weeks,
    six_month: addDays(start, S.horizon_days || 182),
  };
}

export function lookupSchedule(day, rows) {
  const weekday = isoWeekday(day);
  const hits = (rows || []).filter((r) =>
    r.weekday === weekday && r.effective_from <= day && (r.effective_to == null || r.effective_to >= day));
  hits.sort((a, b) => (a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0));
  return hits[0] || null;
}

export function roundsFor(template, meta, S) {
  if (!template) return null;
  if (template.kind !== 'strength' && template.kind !== 'circuit') return null;
  const rampWeeks = S?.strength_ramp_weeks ?? 2;
  if (template.kind === 'strength' && meta?.week != null && meta.week <= rampWeeks) return template.ramp_rounds ?? 2;
  return template.default_rounds;
}

export function materialize(template, rounds, S) {
  if (!template) return null;
  const exercises = (template.exercises || []).map((ex, i) => ({
    seq: i + 1,
    name: ex.name,
    sets: rounds || ex.sets || template.default_rounds || 1,
    reps: ex.reps ?? null,
    seconds: ex.seconds ?? null,
    each_side: !!ex.each_side,
    // A 3s/3s rep is about 6 seconds under load. Timed holds use their own duration.
    suggested_tul: ex.reps != null ? ex.reps * 6 : (ex.seconds ?? null),
  }));
  let duration = null;
  if (template.session_type === 'zone2') duration = [S.zone2_min_low, S.zone2_min_high];
  else if (template.session_type === 'long_cardio') duration = S.long_session_min;
  else if (template.session_type === 'recovery') duration = S.recovery_walk_min;
  return {
    template_id: template.id,
    session_type: template.session_type,
    name: template.name,
    kind: template.kind,
    warmup_min: template.warmup_min ?? null,
    finisher: template.finisher ?? null,
    tempo: template.tempo ?? null,
    rest_label: template.rest_label ?? null,
    notes: template.notes,
    rounds,
    exercises,
    checklist: template.checklist || null,
    modalities: template.modalities || null,
    hr_zone: template.uses_hr_zone ? [S.zone2_hr_low, S.zone2_hr_high] : null,
    duration_min: duration,
  };
}

export function describeProgram(meta, session, S) {
  if (!meta?.active) {
    const when = S?.program_start || 'the start date';
    return `Program starts ${when}`;
  }
  const bits = [];
  if (meta.offset) bits.push('Offset week');
  bits.push(`Week ${meta.week} of ${meta.phase_weeks}`);
  if (session?.kind === 'strength' && meta.ramp) bits.push(`${session.rounds} sets this week`);
  else if (session?.kind === 'circuit') bits.push(`${session.rounds} rounds`);
  return bits.join(' · ');
}

export function resolveScheduledSession(day, S, rows = scheduleSeedRows()) {
  const meta = programMeta(day, S);
  if (!meta.active) return { ...meta, session: null };
  const hit = lookupSchedule(day, rows);
  if (!hit) return { ...meta, session: null };
  const template = TEMPLATES[hit.template_id];
  const rounds = roundsFor(template, meta, S);
  const session = materialize(template, rounds, S);
  if (session) session.session_type = hit.session_type;
  return { ...meta, session_type: hit.session_type, session };
}

export function progressionHint(prev) {
  if (!prev) return null;
  const load = prev.band_level ? `${prev.band_level} band` : 'no band logged';
  const amount = prev.reps != null ? `${prev.reps} reps` : (prev.seconds != null ? `${prev.seconds}s` : 'logged');
  return `Last time (${prev.day}): ${load}, ${amount}. Add 2 reps or move up a band when the last two feel easy.`;
}

/**
 * Starting point for the 1–2 lb/week lines.
 * An explicit setting wins. Otherwise the first weigh-in on or after program_start.
 * If none exist yet, the latest earlier weigh-in is held as the weight on program_start.
 */
export function chooseWeightAnchor(weights, S) {
  const ordered = [...(weights || [])].filter((w) => w && w.weight != null).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  if (S?.start_weight) return { day: S.program_start, weight: +S.start_weight };
  const after = ordered.find((w) => S?.program_start && w.day >= S.program_start);
  if (after) return { day: after.day, weight: after.weight };
  const before = [...ordered].reverse().find((w) => S?.program_start && w.day < S.program_start);
  if (before) return { day: S.program_start, weight: before.weight };
  return ordered[0] ? { day: ordered[0].day, weight: ordered[0].weight } : null;
}

/** 1 lb/week and 2 lb/week guide weights from an anchor. Not clamped to the goal band. */
export function weightGuide(anchorWeight, anchorDay, day, lossLow = 1, lossHigh = 2) {
  if (anchorWeight == null || !anchorDay || !day) return null;
  const weeks = Math.max(0, daysBetween(anchorDay, day) / 7);
  const r = (n) => Math.round(n * 10) / 10;
  return { gentle: r(anchorWeight - lossLow * weeks), fast: r(anchorWeight - lossHigh * weeks), weeks: Math.round(weeks * 10) / 10 };
}
