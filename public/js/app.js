import { $, ago, clock, esc, label } from './dom.js';
import { attachTooltip, glucoseChart, progressSvg, ringSvg, spark, stagesHtml } from './charts.js';
import { readSession, sessionHtml } from './session.js';

const state = { day: null, data: null, range: null, progress: null, authed: false };
let toastTimer, syncing = false, trendTab = 'habits';

async function api(path, opts = {}) {
  const headers = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  if (res.status === 401) {
    state.authed = false;
    if (!opts.quiet) openSettings('Enter your access token to continue.');
    throw new Error('Not authorized');
  }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || res.statusText);
  }
  return res;
}
const getJson = async (p) => (await api(p)).json();
const send = (method, path, body, opts = {}) => api(path, { method, body: body ? JSON.stringify(body) : undefined, ...opts });

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); await refresh(); }
  catch (e) { if (e.message !== 'Not authorized') toast(e.message); }
}

async function load(day) {
  const data = await getJson('/api/day' + (day ? `?day=${encodeURIComponent(day)}` : ''));
  state.day = data.day; state.data = data; state.authed = true;
  render();
  const [range, progress] = await Promise.all([
    getJson(`/api/range?days=14&to=${state.day}`),
    getJson(`/api/progress?days=180&to=${state.day}`),
  ]);
  state.range = range; state.progress = progress;
  renderOverview(); renderTrend(); renderProgress();
}
const refresh = () => load(state.day);
const tz = () => state.data?.settings?.tz || 'America/New_York';

function render() {
  const d = state.data;
  $('#dayTitle').textContent = d.nav.title;
  $('#dayTitle').title = d.nav.title_long;
  $('#programLine').textContent = d.program?.line || '';
  $('#next').disabled = !d.nav.next;
  $('#todayBtn').hidden = d.nav.is_today;
  $('#scoreText').textContent = `${d.score.done} of ${d.score.total}`;
  $('#scoreMeter').value = d.score.total ? d.score.done / d.score.total : 0;
  $('#session').innerHTML = sessionHtml(d.session);
  renderHabits(); renderFuel(); renderBody(); renderVitals(); renderGlucose(); renderEvents(); renderOverview();
}

function renderHabits() {
  const { habits, habit_order } = state.data;
  $('#habitList').innerHTML = habit_order.length ? habit_order.map((h) => {
    const x = habits[h];
    const src = x.overridden ? x.source : (x.state === 'done' || x.state === 'missed' ? 'auto' : '');
    return `<li class="habit" data-state="${esc(x.state)}">
      <button class="habit-btn" role="checkbox" aria-checked="${x.state === 'done'}" data-habit="${esc(h)}" data-done="${x.state === 'done'}">
        <span class="box" aria-hidden="true"></span>
        <span class="habit-text"><span class="habit-name">${esc(x.label || h)}</span><span class="habit-detail">${esc(x.detail)}</span></span>
      </button>
      <span class="src">${esc(src)}</span>
      ${x.overridden ? `<button class="link" data-reset="${esc(h)}" aria-label="Reset ${esc(x.label)}">Reset</button>` : ''}
    </li>`;
  }).join('') : '<li class="empty">No habits are turned on. Choose some in Settings.</li>';
}

function renderFuel() {
  const d = state.data, s = d.settings, c = d.checkin || {};
  $('#fuelLede').textContent = `Calories ${s.kcal_low}–${s.kcal_high}, protein ${s.protein_day_low}–${s.protein_day_high} g, fat ${s.fat_low}–${s.fat_high} g, water ${s.water_oz_low}–${s.water_oz_high} oz. Stop eating 2–3 hours before bed.`;
  const form = $('#checkinForm');
  if (!form.contains(document.activeElement)) {
    form.kcal.value = c.kcal ?? '';
    form.protein_g.value = c.protein_g ?? '';
    form.fat_g.value = c.fat_g ?? '';
    form.carbs_g.value = c.carbs_g ?? '';
    form.water_oz.value = c.water_oz ?? '';
    form.last_meal_time.value = c.last_meal_time || '';
    form.bed_time.value = c.bed_time || s.typical_bedtime || '';
    form.morning_sun.value = c.morning_sun == null ? '' : String(c.morning_sun);
    form.sugary_drinks.value = c.sugary_drinks == null ? '' : String(c.sugary_drinks);
  }
  const parts = [];
  if (d.kcal_total != null) parts.push(`${d.kcal_total} kcal`);
  if (d.protein_total != null) parts.push(`${d.protein_total} g protein`);
  if (d.fat_total != null) parts.push(`${d.fat_total} g fat`);
  if (d.carbs_total != null) parts.push(`${d.carbs_total} g carbs`);
  if (d.water_oz != null) parts.push(`${d.water_oz} oz water`);
  $('#fuelSummary').textContent = parts.length ? parts.join(' · ') : 'Nothing logged for this day yet.';
  renderMeals();
}

function renderMeals() {
  const d = state.data;
  if (!d.meals.length) { $('#mealForms').innerHTML = '<p class="hint">Optional. The fuel form above is the daily total.</p>'; return; }
  $('#mealForms').innerHTML = d.meals.map((m) => `<form class="meal" data-slot="${m.slot}">
    <h3>Meal ${m.slot}</h3>
    <label>Time <input name="time" type="time" value="${esc(hhmm(m.ts))}" required></label>
    <label>Protein <input name="protein_g" type="number" inputmode="decimal" min="0" value="${esc(m.protein_g)}" required></label>
    <label>Carbs <input name="carbs_g" type="number" inputmode="decimal" min="0" value="${esc(m.carbs_g)}" required></label>
    <label>Calories <input name="kcal" type="number" inputmode="decimal" min="0" value="${esc(m.kcal ?? '')}"></label>
    <label>Fat <input name="fat_g" type="number" inputmode="decimal" min="0" value="${esc(m.fat_g ?? '')}"></label>
    <div class="actions"><button type="submit">Update</button><button type="button" class="link" data-del-meal="${m.slot}">Remove</button></div>
  </form>`).join('');
}

function renderBody() {
  const d = state.data, w = d.weight, form = $('#weightForm');
  if (!form.contains(document.activeElement)) {
    form.weight.value = w?.weight ?? '';
    form.waist.value = w?.waist ?? '';
    form.body_fat_pct.value = w?.body_fat_pct ?? '';
  }
  const tiles = [];
  if (w?.weight != null) tiles.push(tile('Weight', `${w.weight}<small> lb</small>`, w.source === 'withings' ? 'scale' : 'manual'));
  if (w?.waist != null) tiles.push(tile('Waist', `${w.waist}<small> in</small>`));
  if (w?.body_fat_pct != null) tiles.push(tile('Body fat', `${w.body_fat_pct}<small> %</small>`));
  const bp = d.bp?.[0];
  if (bp) tiles.push(tile('Blood pressure', `${bp.systolic}/${bp.diastolic}`, bp.pulse ? `${bp.pulse} bpm` : null));
  $('#bodyTiles').innerHTML = tiles.length ? `<div class="tiles">${tiles.join('')}</div>` : '';
  $('#bpList').innerHTML = (d.bp || []).map((r) => `<li>${r.systolic}/${r.diastolic}${r.pulse ? ` · ${r.pulse} bpm` : ''} ${esc(clock(r.ts, tz()))}<button data-del-bp="${r.id}" aria-label="Remove reading">&times;</button></li>`).join('');
}

function renderVitals() {
  const box = $('#withingsBody'), v = state.data.vitals || {}, w = state.data.weight;
  const tiles = [];
  if (w?.weight != null) tiles.push(tile('Weight', `${w.weight}<small> lb</small>`, w.source === 'withings' ? 'scale' : 'manual'));
  if (w?.waist != null) tiles.push(tile('Waist', `${w.waist}<small> in</small>`));
  if (w?.body_fat_pct != null) tiles.push(tile('Body fat', `${w.body_fat_pct}<small> %</small>`));
  if (v.steps != null) tiles.push(tile('Steps', Number(v.steps).toLocaleString()));
  if (v.hr_avg != null) tiles.push(tile('Heart rate avg', `${v.hr_avg}<small> bpm</small>`));
  if (v.hr_min != null && v.hr_max != null) tiles.push(tile('HR range', `${v.hr_min}–${v.hr_max}<small> bpm</small>`));
  if (v.sleep_hours != null) tiles.push(tile('Sleep', `${v.sleep_hours}<small> h</small>`, v.sleep_score != null ? `score ${v.sleep_score}` : null));
  if (v.sleep_efficiency_pct != null) tiles.push(tile('Sleep efficiency', `${v.sleep_efficiency_pct}<small> %</small>`));
  if (!tiles.length) {
    box.innerHTML = '<p class="hint">No scale, activity, or sleep data for this day yet. Connect Withings in Settings, or log a weigh-in in Body.</p>';
    return;
  }
  box.innerHTML = `<div class="tiles">${tiles.join('')}</div>${stagesHtml(v)}`;
}
function tile(labelText, value, sub) {
  return `<div class="tile"><div class="label">${esc(labelText)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}

function renderGlucose() {
  const section = $('#glucoseSection');
  const show = state.data.settings.show_glucose && !state.data.glucose.hidden;
  section.hidden = !show;
  if (!show) return;
  const g = state.data.glucose;
  const lastNote = g.last_ts ? `Newest reading: ${ago(g.last_ts)}.` : 'No readings imported yet.';
  $('#glucoseBody').innerHTML = g.series.length
    ? glucoseChart(state.data, state.data.meals, (ts) => clock(ts, tz())) + `<p class="hint">${lastNote}</p>`
    : `<p class="empty">No glucose readings for this day. ${lastNote}</p>`;
}

function renderEvents() {
  const events = state.data.events || [];
  const box = $('#legacyEvents');
  box.hidden = !events.length;
  const names = { first_meal: 'First meal', last_meal: 'Meal closed', walk: 'Walk', training: 'Trained' };
  $('#eventList').innerHTML = events.map((e) => `<li>${esc(names[e.kind] || e.kind)} ${esc(clock(e.ts, tz()))}<button data-del-event="${e.id}" aria-label="Remove">&times;</button></li>`).join('');
}

function renderOverview() {
  const d = state.data, box = $('#overview');
  if (!box || !d) return;
  const s = d.settings, cards = [];
  const pct = d.score.total ? d.score.done / d.score.total : 0;
  cards.push(card(ringSvg(pct, `${d.score.done}/${d.score.total}`), 'Today', `${d.score.total ? Math.round(pct * 100) : 0}<small>%</small>`));
  const steps = d.vitals?.steps;
  cards.push(card(ringSvg(steps == null ? 0 : steps / s.steps_goal, steps == null ? '–' : `${Math.round(steps / 1000)}k`), 'Steps', steps == null ? '–' : Number(steps).toLocaleString(), `goal ${s.steps_goal.toLocaleString()}`));
  const sleep = d.vitals?.sleep_hours;
  cards.push(card(ringSvg(sleep == null ? 0 : sleep / s.sleep_hours, sleep == null ? '–' : `${sleep}`), 'Sleep', sleep == null ? '–' : `${sleep}<small> h</small>`, `goal ${s.sleep_hours}–${s.sleep_hours_high}`));
  const protein = d.protein_total;
  cards.push(card(ringSvg(protein == null ? 0 : protein / s.protein_day_low, protein == null ? '–' : `${Math.round(protein)}`), 'Protein', protein == null ? '–' : `${protein}<small> g</small>`, `${s.protein_day_low}–${s.protein_day_high}`));
  const water = d.water_oz;
  cards.push(card(ringSvg(water == null ? 0 : water / s.water_oz_low, water == null ? '–' : `${Math.round(water)}`), 'Water', water == null ? '–' : `${water}<small> oz</small>`, `${s.water_oz_low}+`));
  if (d.weight?.weight != null) cards.push(card('', 'Weight', `${d.weight.weight}<small> lb</small>`, `goal ${s.goal_weight_low}–${s.goal_weight_high}`));
  if (d.weight?.waist != null) cards.push(card('', 'Waist', `${d.weight.waist}<small> in</small>`));
  if (d.kcal_total != null) {
    const inRange = d.kcal_total >= s.kcal_low && d.kcal_total <= s.kcal_high;
    cards.push(card(ringSvg(inRange ? 1 : 0.45, inRange ? 'ok' : ''), 'Calories', `${d.kcal_total}`, `${s.kcal_low}–${s.kcal_high}`));
  }
  box.innerHTML = cards.join('');
}
function card(ring, name, value, sub) {
  return `<div class="stat-card">${ring}<div class="body"><div class="label">${esc(name)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div></div>`;
}

function renderProgress() {
  const p = state.progress, box = $('#progress');
  if (!p || !box) return;
  const s = p.summary, phase = p.phase;
  const chart = progressSvg(p.weights, p.guide);
  const guide = p.guide_today && p.anchor
    ? (p.guide_today.weeks < 0.05
      ? `Guide starts at ${p.anchor.weight} lb on ${label(p.anchor.day)}, then drops about 1–2 lb a week.`
      : `From ${p.anchor.weight} lb on ${label(p.anchor.day)}, the 1–2 lb/week guide is ${p.guide_today.fast}–${p.guide_today.gentle} lb.`)
    : 'Log a weigh-in on or after the program start to draw the 1–2 lb/week guide.';
  const waist = s.waist == null ? 'Waist not logged yet.' : `Waist ${s.waist} in${s.waist_first != null && s.waist !== s.waist_first ? ` (first logged ${s.waist_first})` : ''}.`;
  const fat = s.body_fat_pct == null ? 'Body fat not logged yet.' : `Body fat ${s.body_fat_pct}% · goal ${phase.goal_bf[0]}–${phase.goal_bf[1]}%.`;
  const bp = s.bp ? `Latest blood pressure ${s.bp.systolic}/${s.bp.diastolic} on ${label(s.bp.day)}.` : 'No blood pressure logged in this window.';
  box.innerHTML = `<div class="mini">
    <h3>16 weeks, then 6 months <small>${phase.six_month_label ? `around ${esc(phase.six_month_label)}` : ''}</small></h3>
    <p class="hint">Goal ${phase.goal_weight[0]}–${phase.goal_weight[1]} lb and ${phase.goal_bf[0]}–${phase.goal_bf[1]}% body fat, about ${phase.weekly_loss[0]}–${phase.weekly_loss[1]} lb a week. Sessions logged: ${s.adherence.scheduled ? `${s.adherence.done} of ${s.adherence.scheduled}` : 'none yet'}. Average steps ${s.steps_avg == null ? '—' : Math.round(s.steps_avg).toLocaleString()}. Average sleep ${s.sleep_avg == null ? '—' : s.sleep_avg + ' h'}.</p>
    ${chart || '<p class="hint">Not enough weigh-ins for a chart yet.</p>'}
    <p class="legend-note"><i class="swatch ink"></i> Weight <i class="swatch wood"></i> 1 lb/week <i class="swatch sage"></i> 2 lb/week</p>
    <p class="hint">${esc(guide)} ${esc(waist)} ${esc(fat)} ${esc(bp)}</p>
  </div>`;
}

function renderTrend() {
  if (!state.range) return;
  const days = state.range.days;
  const sumDone = days.reduce((s, d) => s + d.score.done, 0), sumTotal = days.reduce((s, d) => s + d.score.total, 0);
  const pct = sumTotal ? Math.round((100 * sumDone) / sumTotal) : 0;
  const bars = days.map((d) => {
    const h = d.score.total ? Math.round((100 * d.score.done) / d.score.total) : 0;
    const wd = label(d.day, { weekday: 'narrow' });
    return `<button class="bar" data-day="${d.day}" ${d.day === state.day ? 'aria-current="date"' : ''} aria-label="${esc(label(d.day))}: ${d.score.done} of ${d.score.total}"><span style="--h:${h}%"></span><em>${esc(wd)}</em></button>`;
  }).join('');
  const dayList = days.map((d) => d.day);
  const series = (key, unit, title, empty) => {
    const values = days.map((d) => d[key]);
    const last = [...values].reverse().find((v) => v != null);
    const chart = spark(values, null, dayList, unit);
    return `<div class="mini"><h3>${title} <small>${last != null ? `${last}${unit}` : ''}</small></h3>${chart || `<p class="hint">${empty}</p>`}</div>`;
  };
  const weights = days.map((d) => d.weight);
  const wAvg = weights.map((_, i) => { const w = weights.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  const wSpark = spark(weights, wAvg, dayList, ' lb');
  const minis = {
    habits: `<div class="mini"><h3>Habits <small>${pct}% over 14 days</small></h3><div class="bars-wrap"><div class="bars">${bars}</div></div></div>`,
    weight: `<div class="mini"><h3>Weight <small>dashed = 7-day average</small></h3>${wSpark || '<p class="hint">Log two or more weigh-ins to see a trend.</p>'}</div>`,
    waist: series('waist', ' in', 'Waist', 'Waist shows up after two logged measurements.'),
    fat: series('body_fat_pct', '%', 'Body fat', 'Body fat shows up after two measurements.'),
    steps: series('steps', '', 'Steps', 'Needs activity on two or more days.'),
    sleep: series('sleep_hours', ' h', 'Sleep', 'Needs sleep on two or more nights.'),
    bp: series('bp_systolic', '', 'Systolic', 'Log blood pressure on two or more days.'),
  };
  if (state.data.settings.show_glucose) minis.glucose = series('glucose_fasting_avg', ' mg/dL', 'Fasting glucose', 'Needs readings on two or more days.');
  const order = ['habits', 'weight', 'waist', 'fat', 'steps', 'sleep', 'bp', 'glucose'].filter((k) => minis[k]);
  if (!order.includes(trendTab)) trendTab = 'habits';
  const labels = { habits: 'Habits', weight: 'Weight', waist: 'Waist', fat: 'Body fat', steps: 'Steps', sleep: 'Sleep', bp: 'BP', glucose: 'Glucose' };
  $('#trendTabs').innerHTML = order.map((k) => `<button type="button" role="tab" aria-selected="${k === trendTab}" data-tab="${k}">${labels[k]}</button>`).join('');
  $('#trendBody').innerHTML = minis[trendTab];
  $('#trendBody').querySelectorAll('svg[data-points]').forEach(attachTooltip);
}

function renderSyncBar(status, opts = {}) {
  const bar = $('#syncBar'), text = $('#syncText'), btn = $('#syncNow'), connect = $('#syncConnect');
  if (!bar) return;
  btn.hidden = false; connect.hidden = true;
  if (opts.checking) { bar.dataset.state = 'checking'; text.textContent = 'Checking Withings…'; btn.hidden = true; return; }
  if (opts.error) { bar.dataset.state = 'error'; text.textContent = opts.error; btn.disabled = false; btn.textContent = 'Try again'; return; }
  if (!status?.connected) { bar.dataset.state = 'off'; text.textContent = 'Withings not connected'; btn.hidden = true; connect.hidden = false; return; }
  if (syncing) { bar.dataset.state = 'syncing'; text.textContent = 'Syncing…'; btn.disabled = true; return; }
  const stale = status.last_sync ? (Date.now() / 1000 - status.last_sync) : Infinity;
  bar.dataset.state = stale > 36 * 3600 ? 'stale' : 'ok';
  text.textContent = status.last_sync ? `Withings · synced ${ago(status.last_sync)}` : 'Withings connected · never synced';
  btn.disabled = false; btn.textContent = 'Sync now';
}
async function loadSyncStatus() {
  if (!state.authed) return;
  renderSyncBar(null, { checking: true });
  try { renderSyncBar(await getJson('/api/withings/status')); }
  catch (e) { if (e.message !== 'Not authorized') renderSyncBar(null, { error: 'Couldn’t check sync status' }); }
}
async function doSync() {
  if (syncing) return;
  syncing = true; renderSyncBar(null, {});
  try {
    const r = await (await send('POST', '/api/withings/sync')).json();
    toast(`Synced ${r.weight_days} weigh-ins, ${r.activity_days} activity days, ${r.sleep_nights} nights`);
    await refresh();
  } catch (e) { if (e.message !== 'Not authorized') toast(e.message); }
  finally { syncing = false; await loadSyncStatus(); }
}
async function connectWithings() {
  try {
    const { url } = await (await send('POST', '/api/withings/connect')).json();
    location.assign(url);
  } catch (e) { if (e.message !== 'Not authorized') toast(e.message); }
}

function numOrNull(v) { return v === '' || v == null ? null : +v; }
function hhmm(ts) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000));
}

document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button'); if (!t) return;
  if (t.id === 'prev') return load(state.data.nav.prev);
  if (t.id === 'next' && state.data.nav.next) return load(state.data.nav.next);
  if (t.id === 'todayBtn') return load(state.data.nav.today);
  if (t.id === 'openSettings') return openSettings('');
  if (t.id === 'closeSettings') return $('#settingsDlg').close();
  if (t.id === 'syncNow') return doSync();
  if (t.id === 'syncConnect' || t.id === 'connectWithings') return connectWithings();
  if (t.id === 'signOut') {
    send('POST', '/api/auth/logout', null, { quiet: true }).finally(() => {
      state.authed = false;
      openSettings('Signed out of this browser.');
    });
    return;
  }
  if (t.dataset.tab) { trendTab = t.dataset.tab; return renderTrend(); }
  if (t.dataset.day) return load(t.dataset.day);
  if (t.dataset.habit) return act(() => send('PUT', '/api/habit', { day: state.day, habit: t.dataset.habit, done: t.dataset.done !== 'true', source: 'manual' }));
  if (t.dataset.reset) return act(() => send('DELETE', `/api/habit?day=${state.day}&habit=${encodeURIComponent(t.dataset.reset)}`), 'Back to automatic');
  if (t.dataset.delEvent) return act(() => send('DELETE', `/api/event?id=${t.dataset.delEvent}`), 'Removed');
  if (t.dataset.delMeal) return act(() => send('DELETE', `/api/meal?day=${state.day}&slot=${t.dataset.delMeal}`), 'Meal removed');
  if (t.dataset.delBp) return act(() => send('DELETE', `/api/bp?id=${t.dataset.delBp}`), 'Removed');
  if (t.dataset.status && t.dataset.status !== 'completed' && t.closest('#sessionForm')) {
    ev.preventDefault();
    saveSession(t.dataset.status);
  }
});

$('#session').addEventListener('submit', (ev) => {
  ev.preventDefault();
  saveSession('completed');
});
function saveSession(status) {
  const form = $('#sessionForm');
  if (!form || !state.data?.session) return;
  const body = readSession(form, status);
  body.day = state.day;
  body.session_type = state.data.session.session_type;
  body.template_id = state.data.session.template_id;
  act(() => send('POST', '/api/session', body), status === 'skipped' ? 'Marked skipped' : 'Session saved');
}

$('#checkinForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  act(() => send('PUT', '/api/checkin', {
    day: state.day,
    kcal: numOrNull(f.kcal.value), protein_g: numOrNull(f.protein_g.value), fat_g: numOrNull(f.fat_g.value),
    carbs_g: numOrNull(f.carbs_g.value), water_oz: numOrNull(f.water_oz.value),
    last_meal_time: f.last_meal_time.value || null, bed_time: f.bed_time.value || null,
    morning_sun: f.morning_sun.value === '' ? null : +f.morning_sun.value,
    sugary_drinks: f.sugary_drinks.value === '' ? null : +f.sugary_drinks.value,
  }), 'Fuel saved');
});
$('#weightForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  act(() => send('POST', '/api/weight', {
    day: state.day, weight: +f.weight.value,
    waist: numOrNull(f.waist.value), body_fat_pct: numOrNull(f.body_fat_pct.value),
  }), 'Weigh-in saved');
});
$('#bpForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  act(() => send('POST', '/api/bp', {
    day: state.day, systolic: +f.systolic.value, diastolic: +f.diastolic.value, pulse: numOrNull(f.pulse.value),
  }), 'Blood pressure saved');
});
$('#mealForms').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  act(() => send('POST', '/api/meal', {
    day: state.day, slot: +f.dataset.slot, time: f.time.value,
    protein_g: +f.protein_g.value, carbs_g: +f.carbs_g.value,
    kcal: numOrNull(f.kcal.value), fat_g: numOrNull(f.fat_g.value),
  }), 'Meal saved');
});
$('#addMeal').addEventListener('click', () => {
  const used = new Set((state.data.meals || []).map((m) => m.slot));
  let slot = 1; while (used.has(slot) && slot < 6) slot++;
  const wrap = document.createElement('form');
  wrap.className = 'meal'; wrap.dataset.slot = String(slot);
  wrap.innerHTML = `<h3>Meal ${slot}</h3>
    <label>Time <input name="time" type="time" required></label>
    <label>Protein <input name="protein_g" type="number" inputmode="decimal" min="0" required></label>
    <label>Carbs <input name="carbs_g" type="number" inputmode="decimal" min="0" value="0" required></label>
    <label>Calories <input name="kcal" type="number" inputmode="decimal" min="0"></label>
    <label>Fat <input name="fat_g" type="number" inputmode="decimal" min="0"></label>
    <div class="actions"><button type="submit">Save meal</button></div>`;
  $('#mealForms').append(wrap);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !state.authed || !state.day) return;
  const active = document.activeElement;
  if (active && active.closest && active.closest('#sessionForm, #checkinForm, #weightForm')) return;
  refresh().catch(() => {}); loadSyncStatus();
});

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
async function openSettings(msg) {
  const dlg = $('#settingsDlg');
  $('#settingsMsg').textContent = msg || '';
  $('#importMsg').textContent = '';
  if (state.authed) {
    try {
      const s = await getJson('/api/settings');
      const f = $('#settingsForm');
      for (const el of f.elements) {
        if (!el.name || el.type === 'checkbox' || !(el.name in s)) continue;
        if (s[el.name] == null) el.value = '';
        else el.value = s[el.name];
      }
      f.show_glucose.checked = !!s.show_glucose;
      $('#trainingDays').innerHTML = WEEKDAYS.map((n, i) => `<label><input type="checkbox" name="td" value="${i + 1}" ${s.training_days.includes(i + 1) ? 'checked' : ''}>${n}</label>`).join('');
      const habits = s.habit_catalog || [];
      const box = (list) => list.map((h) => `<label><input type="checkbox" name="ah" value="${esc(h.id)}" ${s.active_habits.includes(h.id) ? 'checked' : ''}>${esc(h.label)}</label>`).join('');
      $('#activeHabits').innerHTML = box(habits.filter((h) => !h.legacy));
      $('#legacyHabits').innerHTML = box(habits.filter((h) => h.legacy));
    } catch { /* 401 opens this dialog again */ }
  }
  if (!dlg.open) dlg.showModal();
}

$('#saveToken').addEventListener('click', async () => {
  const value = $('#tokenInput').value.trim();
  if (!value) { $('#settingsMsg').textContent = 'Paste a token first.'; return; }
  try {
    await send('POST', '/api/auth/login', { token: value }, { quiet: true });
    try { localStorage.removeItem('pt_token'); } catch { /* ignore */ }
    $('#tokenInput').value = '';
    state.authed = true;
    await load(state.day); await loadSyncStatus();
    $('#settingsMsg').textContent = 'Token saved in this browser.';
  } catch (e) {
    $('#settingsMsg').textContent = e.message === 'Not authorized' ? 'That token was rejected.' : e.message;
  }
});

$('#settingsForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!$('#activeHabits').children.length) { toast('Settings did not load. Open them again.'); return; }
  const f = ev.target;
  const body = { show_glucose: f.show_glucose.checked };
  for (const el of f.elements) {
    if (!el.name || el.type === 'checkbox' || el.name === 'show_glucose') continue;
    if (el.type === 'number') body[el.name] = el.value === '' ? null : +el.value;
    else if (el.type === 'time') body[el.name] = el.value.slice(0, 5);
    else body[el.name] = el.value.trim();
  }
  body.training_days = [...f.querySelectorAll('input[name=td]:checked')].map((i) => +i.value);
  body.active_habits = [...f.querySelectorAll('input[name=ah]:checked')].map((i) => i.value);
  if (body.start_weight == null) body.start_weight = null;
  act(() => send('PUT', '/api/settings', body), 'Settings saved');
});

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
function parseClarity(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const hi = lines.findIndex((l) => /timestamp/i.test(l) && /glucose/i.test(l));
  if (hi < 0) throw new Error('No header row with Timestamp and Glucose Value columns was found.');
  const head = splitCsv(lines[hi]).map((s) => s.trim().toLowerCase());
  const iT = head.findIndex((h) => h.startsWith('timestamp'));
  const iG = head.findIndex((h) => h.startsWith('glucose value'));
  const iE = head.findIndex((h) => h.startsWith('event type'));
  if (iT < 0 || iG < 0) throw new Error('Timestamp or Glucose Value column is missing.');
  const mmol = head[iG].includes('mmol');
  const out = [];
  for (const l of lines.slice(hi + 1)) {
    const c = splitCsv(l);
    if (iE >= 0 && c[iE] && c[iE].trim().toUpperCase() !== 'EGV') continue;
    const t = (c[iT] || '').trim(), v = (c[iG] || '').trim();
    if (!t || !v) continue;
    let mg;
    if (/^low$/i.test(v)) mg = 40;
    else if (/^high$/i.test(v)) mg = 400;
    else { mg = parseFloat(v); if (mmol) mg *= 18.016; }
    if (Number.isFinite(mg)) out.push({ local: t, mgdl: Math.round(mg * 10) / 10 });
  }
  return out;
}
$('#csvFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0], msg = $('#importMsg');
  if (!file) return;
  try {
    const rows = parseClarity(await file.text());
    if (!rows.length) throw new Error('No glucose rows found in that file.');
    let inserted = 0, valid = 0;
    for (let i = 0; i < rows.length; i += 2000) {
      msg.textContent = `Uploading ${Math.min(i + 2000, rows.length)} of ${rows.length} readings…`;
      const res = await (await send('POST', '/api/glucose', { source: 'clarity', readings: rows.slice(i, i + 2000) })).json();
      inserted += res.inserted; valid += res.valid;
    }
    msg.textContent = `Done. ${inserted} new readings added, ${valid - inserted} were already stored.`;
    await refresh();
  } catch (e) { msg.textContent = e.message; }
  ev.target.value = '';
});
$('#exportBtn').addEventListener('click', async () => {
  try {
    const blob = await (await api('/api/export.csv?days=180')).blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `protocol-${state.day || 'export'}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { $('#importMsg').textContent = e.message; }
});

async function boot() {
  let legacy = '';
  try { legacy = localStorage.getItem('pt_token') || ''; } catch { /* storage blocked */ }
  if (legacy) {
    try {
      await send('POST', '/api/auth/login', { token: legacy }, { quiet: true });
      localStorage.removeItem('pt_token');
    } catch (e) {
      openSettings(e.message === 'Not authorized' ? 'The token saved in this browser was rejected.' : e.message);
      return;
    }
  }
  try { await load(); loadSyncStatus(); }
  catch (e) { if (e.message !== 'Not authorized') toast(e.message); }
}
boot();
