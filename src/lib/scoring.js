import { addDays, hoursBeforeBed, hhmmIn, isoWeekday } from './dates.js';
import { ALL_HABITS, HABIT_LABELS, SCORED_HABITS } from './habits.js';
import { round1 } from './units.js';

const KINDS_MEAL = ['first_meal', 'last_meal'];

function settle(state, day, today) {
  if (state !== 'pending') return state;
  if (!today || day >= today) return 'pending';
  return 'missed';
}

function rangeDetail(value, low, high, unit) {
  const v = round1(value);
  return `${v} ${unit} (target ${low}–${high})`;
}

/**
 * Resolve one day. `today` is the calendar day in the user's zone; days before it
 * that are still pending become missed, except yesterday's sleep (Withings often
 * lands on the next sync). A habit_log row always wins over the derivation.
 */
export function buildDay(S, day, ctx) {
  const meals = ctx.meals || [];
  const events = ctx.events || [];
  const rows = ctx.rows || [];
  const vitals = ctx.vitals || {};
  const checkin = ctx.checkin || null;
  const scheduled = ctx.scheduled || null; // materialized session or null
  const logged = ctx.logged || null;
  const today = ctx.today || null;
  const row = Object.fromEntries(rows.map((r) => [r.habit, r]));
  const ev = (k) => events.filter((e) => e.kind === k);
  const hm = (ts) => hhmmIn(ts, S.tz);
  const H = {};

  // --- legacy habits (hidden by default, history preserved) ---
  const fEv = ev('first_meal')[0], lEv = ev('last_meal').at(-1);
  const firstTs = fEv?.ts ?? meals[0]?.ts;
  const lastTs = lEv?.ts ?? (meals.length >= 2 ? meals.at(-1).ts : undefined);
  if (firstTs && lastTs) {
    const hrs = (lastTs - firstTs) / 3600;
    H.window = { state: hrs <= S.window_hours ? 'done' : 'missed', source: 'auto', detail: `${round1(hrs)} h (${hm(firstTs)}–${hm(lastTs)}), limit ${S.window_hours} h` };
  } else if (firstTs) H.window = { state: 'pending', source: 'auto', detail: `open since ${hm(firstTs)}` };
  else H.window = { state: 'pending', source: 'auto', detail: 'tap First meal, then Meal closed' };

  if (meals.length >= 2) {
    const ok = meals.slice(0, 2).every((m) => m.protein_g >= S.protein_per_meal);
    H.protein = { state: ok ? 'done' : 'missed', source: 'auto', detail: `${meals.slice(0, 2).map((m) => m.protein_g + ' g').join(' / ')}, target ${S.protein_per_meal} g each` };
  } else H.protein = { state: 'pending', source: 'auto', detail: meals.length ? `${meals[0].protein_g} g logged, one meal to go` : `log both meals, ${S.protein_per_meal} g each` };

  const mealCarbs = meals.reduce((s, m) => s + (m.carbs_g || 0), 0);
  const mealProtein = meals.reduce((s, m) => s + (m.protein_g || 0), 0);
  const mealKcal = meals.some((m) => m.kcal != null) ? meals.reduce((s, m) => s + (m.kcal || 0), 0) : null;
  const mealFat = meals.some((m) => m.fat_g != null) ? meals.reduce((s, m) => s + (m.fat_g || 0), 0) : null;
  if (mealCarbs > S.carb_cap) H.carbs = { state: 'missed', source: 'auto', detail: `${round1(mealCarbs)} g of ${S.carb_cap} g cap` };
  else if (meals.length >= 2) H.carbs = { state: 'done', source: 'auto', detail: `${round1(mealCarbs)} g of ${S.carb_cap} g cap` };
  else H.carbs = { state: 'pending', source: 'auto', detail: meals.length ? `${round1(mealCarbs)} g so far, cap ${S.carb_cap} g` : `cap ${S.carb_cap} g` };

  const walks = ev('walk').length;
  H.walks = { state: walks >= S.walks_needed ? 'done' : 'pending', source: 'auto', detail: `${walks} of ${S.walks_needed}` };

  const trained = ev('training').length > 0;
  const legacyScheduled = (S.training_days || []).includes(isoWeekday(day));
  if (trained) H.training = { state: 'done', source: 'auto', detail: 'logged' };
  else if (!legacyScheduled) H.training = { state: 'na', source: 'auto', detail: 'rest day' };
  else H.training = { state: 'pending', source: 'auto', detail: 'scheduled today' };

  H.screens = { state: 'pending', source: 'auto', detail: 'off 90 min before bed' };

  // --- L.I.T. habits ---
  if (!scheduled) {
    H.session = { state: 'na', source: 'auto', detail: 'no session scheduled' };
  } else if (logged?.status === 'completed' || logged?.status === 'partial') {
    H.session = { state: 'done', source: logged.source || 'manual', detail: `${scheduled.name}${logged.status === 'partial' ? ' (partial)' : ''}` };
  } else if (logged?.status === 'skipped') {
    H.session = { state: 'missed', source: logged.source || 'manual', detail: `${scheduled.name} skipped` };
  } else {
    H.session = { state: 'pending', source: 'auto', detail: scheduled.name };
  }

  const steps = vitals.steps == null ? null : +vitals.steps;
  if (steps == null) H.steps = { state: 'pending', source: 'auto', detail: `goal ${S.steps_goal.toLocaleString('en-US')}` };
  else if (steps >= S.steps_goal) H.steps = { state: 'done', source: 'auto', detail: `${Math.round(steps).toLocaleString('en-US')} of ${S.steps_goal.toLocaleString('en-US')}` };
  else H.steps = { state: day >= (today || '9999') ? 'pending' : 'missed', source: 'auto', detail: `${Math.round(steps).toLocaleString('en-US')} of ${S.steps_goal.toLocaleString('en-US')}` };

  const sleepHours = row.sleep?.value != null ? +row.sleep.value : (vitals.sleep_hours == null ? null : +vitals.sleep_hours);
  if (sleepHours == null) H.sleep = { state: 'pending', source: 'auto', detail: `${S.sleep_hours}–${S.sleep_hours_high} h` };
  else if (sleepHours >= S.sleep_hours) H.sleep = { state: 'done', source: row.sleep ? row.sleep.source : 'auto', detail: `${round1(sleepHours)} h (goal ${S.sleep_hours}–${S.sleep_hours_high})` };
  else H.sleep = { state: 'missed', source: row.sleep ? row.sleep.source : 'auto', detail: `${round1(sleepHours)} h (goal ${S.sleep_hours}–${S.sleep_hours_high})` };

  const protein = checkin?.protein_g != null ? +checkin.protein_g : (meals.length ? mealProtein : null);
  H.protein_day = scoreBand(protein, S.protein_day_low, S.protein_day_high, 'g', 'auto');
  const kcal = checkin?.kcal != null ? +checkin.kcal : mealKcal;
  H.calories = scoreBand(kcal, S.kcal_low, S.kcal_high, 'kcal', 'auto');

  const water = checkin?.water_oz == null ? null : +checkin.water_oz;
  if (water == null) H.water = { state: 'pending', source: 'auto', detail: `${S.water_oz_low}–${S.water_oz_high} oz` };
  else if (water >= S.water_oz_low) {
    const extra = water > S.water_oz_high ? `, above the ${S.water_oz_high} oz guide` : '';
    H.water = { state: 'done', source: 'auto', detail: `${round1(water)} oz (goal ${S.water_oz_low}–${S.water_oz_high}${extra})` };
  } else H.water = { state: 'missed', source: 'auto', detail: `${round1(water)} oz (goal ${S.water_oz_low}–${S.water_oz_high})` };

  H.sun = flagHabit(checkin?.morning_sun, '10–15 min outside', 'no morning sun', 'not logged');
  // Stored 1 means a sugary drink was logged (miss). Stored 0 means none (hit).
  H.sugar = flagHabit(
    checkin?.sugary_drinks == null ? null : (checkin.sugary_drinks ? 0 : 1),
    'none today',
    'had a sugary drink',
    'not logged',
  );

  const lastClock = checkin?.last_meal_time || (lastMealTs(meals, events) != null ? hm(lastMealTs(meals, events)) : null);
  const bedClock = checkin?.bed_time || S.typical_bedtime;
  if (!lastClock) H.last_meal = { state: 'pending', source: 'auto', detail: `stop 2–3 h before bed (${bedClock})` };
  else {
    const gap = hoursBeforeBed(lastClock, bedClock);
    if (gap == null) H.last_meal = { state: 'pending', source: 'auto', detail: 'set a last-meal time' };
    else if (gap >= 2) H.last_meal = { state: 'done', source: 'auto', detail: `${round1(gap)} h before ${bedClock}` };
    else H.last_meal = { state: 'missed', source: 'auto', detail: `${round1(gap)} h before ${bedClock}, need 2+` };
  }

  // End of day: pending work that can no longer happen today is missed.
  // Yesterday's sleep stays pending so the next Withings sync can fill it.
  if (today && day < today) {
    for (const h of [...SCORED_HABITS, 'window', 'protein', 'carbs', 'walks', 'training', 'screens']) {
      if (!H[h] || H[h].state !== 'pending') continue;
      if (h === 'sleep' && day >= addDays(today, -1)) continue;
      H[h] = { ...H[h], state: 'missed' };
    }
  }

  for (const h of ALL_HABITS) {
    const r = row[h];
    if (!r || !H[h]) continue;
    // Sleep rows written by Withings are the measurement, not a manual override of a different value.
    const manual = r.source && r.source !== 'withings' && r.source !== 'auto';
    if (h === 'sleep' && !manual) continue;
    const extra = h === 'sleep' && r.value != null ? `${round1(r.value)} h` : null;
    H[h] = { ...H[h], state: r.done ? 'done' : 'missed', source: r.source, overridden: true, detail: extra || H[h].detail };
  }

  for (const h of ALL_HABITS) if (H[h]) H[h].label = HABIT_LABELS[h];

  const active = S.active_habits || [];
  const counted = active.filter((h) => H[h] && H[h].state !== 'na');
  const done = counted.filter((h) => H[h].state === 'done').length;
  const habit_order = ALL_HABITS.filter((h) => active.includes(h));

  return {
    day,
    habits: H,
    habit_order,
    score: { done, total: counted.length },
    meals,
    events,
    protein_total: round1(protein != null ? protein : mealProtein),
    carbs_total: round1(checkin?.carbs_g != null ? +checkin.carbs_g : mealCarbs),
    kcal_total: kcal == null ? null : round1(kcal),
    fat_total: round1(checkin?.fat_g != null ? +checkin.fat_g : mealFat),
    water_oz: water == null ? null : round1(water),
  };
}

function scoreBand(value, low, high, unit) {
  if (value == null || Number.isNaN(+value)) return { state: 'pending', source: 'auto', detail: `${low}–${high} ${unit}` };
  const ok = value >= low && value <= high;
  return { state: ok ? 'done' : 'missed', source: 'auto', detail: rangeDetail(value, low, high, unit) };
}

function flagHabit(value, yesDetail, noDetail, pendingDetail) {
  if (value == null || value === '') return { state: 'pending', source: 'auto', detail: pendingDetail };
  const on = value === true || value === 1 || value === '1';
  return { state: on ? 'done' : 'missed', source: 'auto', detail: on ? yesDetail : noDetail };
}

function lastMealTs(meals, events) {
  const ev = events.filter((e) => e.kind === 'last_meal').at(-1)?.ts;
  const meal = meals.length ? Math.max(...meals.map((m) => m.ts)) : null;
  if (ev == null) return meal;
  if (meal == null) return ev;
  return Math.max(ev, meal);
}

