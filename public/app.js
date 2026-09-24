'use strict';
// Protocol tracker front end. No dependencies. Talks to /api/* with a bearer token.

const HABIT_ORDER = ['window', 'protein', 'carbs', 'walks', 'training', 'sleep', 'screens'];
const HABIT_LABELS = {
  window: 'Eating window held',
  protein: 'Protein at both meals',
  carbs: 'Carbs under the cap',
  walks: 'Post-meal walks',
  training: 'Strength or HIIT',
  sleep: 'Sleep goal met',
  screens: 'Screens off before bed',
};
const EVENT_LABELS = { first_meal: 'First meal', last_meal: 'Meal closed', walk: 'Walk', training: 'Trained' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let token = '';
try { token = localStorage.getItem('pt_token') || ''; } catch { /* storage blocked: token lasts for this session only */ }
const state = { day: null, data: null, range: null };

// ---------- api ----------
async function api(path, opts = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { openSettings('Enter your access token to continue.'); throw new Error('Not authorized'); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  return res;
}
const getJson = async (p) => (await api(p)).json();
const send = (method, path, body) => api(path, { method, body: body ? JSON.stringify(body) : undefined });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); await refresh(); }
  catch (e) { if (e.message !== 'Not authorized') toast(e.message); }
}

// ---------- date helpers ----------
const tzOf = () => state.data?.settings?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: tzOf() }).format(new Date());
function shiftDay(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const dayLong = (day) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
const dayShort = (day) => new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const hhmm = (ts) => new Intl.DateTimeFormat('en-GB', { timeZone: tzOf(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ts * 1000));
const clock = (ts) => new Intl.DateTimeFormat('en-US', { timeZone: tzOf(), hour: 'numeric', minute: '2-digit' }).format(new Date(ts * 1000));
function ago(ts) {
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  if (m < 90) return `${Math.max(m, 0)} min ago`;
  if (m < 60 * 36) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

// ---------- load ----------
async function load(day) {
  const data = await getJson('/api/day' + (day ? `?day=${day}` : ''));
  state.day = data.day; state.data = data;
  render();
  state.range = await getJson(`/api/range?days=14&to=${state.day}`);
  renderTrend();
}
const refresh = () => load(state.day);

// ---------- render ----------
function render() {
  const d = state.data, isToday = d.day === todayStr();
  $('#dayTitle').textContent = isToday ? 'Today' : dayShort(d.day);
  $('#dayTitle').title = dayLong(d.day);
  $('#next').disabled = isToday;
  $('#todayBtn').hidden = isToday;
  $('#scoreText').textContent = `${d.score.done} of ${d.score.total}`;
  $('#scoreMeter').value = d.score.total ? d.score.done / d.score.total : 0;
  renderHabits(); renderQuick(); renderMeals(); renderGlucose(); renderWithings(); renderOverview();
  const w = d.weight, f = $('#weightForm');
  f.weight.value = w?.weight ?? ''; f.waist.value = w?.waist ?? '';
}

function renderHabits() {
  const { habits, settings } = state.data;
  const shown = HABIT_ORDER.filter((h) => settings.active_habits.includes(h));
  $('#habitList').innerHTML = shown.length ? shown.map((h) => {
    const x = habits[h], done = x.state === 'done';
    const src = x.overridden ? x.source : (done || x.state === 'missed' ? 'auto' : '');
    return `<li class="habit" data-state="${x.state}">
      <button class="habit-btn" role="checkbox" aria-checked="${done}" data-habit="${h}" data-done="${done}">
        <span class="box" aria-hidden="true"></span>
        <span class="habit-text"><span class="habit-name">${HABIT_LABELS[h]}</span><span class="habit-detail">${esc(x.detail)}</span></span>
      </button>
      <span class="src">${esc(src)}</span>
      ${x.overridden ? `<button class="link" data-reset="${h}" aria-label="Reset ${HABIT_LABELS[h]} to automatic">Reset</button>` : ''}
    </li>`;
  }).join('') : '<li class="empty">No habits are being tracked. Turn some on in Settings.</li>';
}

function renderQuick() {
  const d = state.data, isToday = d.day === todayStr();
  document.querySelectorAll('#quick button').forEach((b) => { b.disabled = !isToday; });
  $('#quickNote').hidden = isToday;
  $('#eventList').innerHTML = d.events.map((e) =>
    `<li>${EVENT_LABELS[e.kind] || esc(e.kind)} ${clock(e.ts)}${e.source !== 'manual' ? ` (${esc(e.source)})` : ''}<button data-del-event="${e.id}" aria-label="Remove ${EVENT_LABELS[e.kind]} at ${clock(e.ts)}">&times;</button></li>`).join('');
}

function renderMeals() {
  const d = state.data, isToday = d.day === todayStr(), s = d.settings;
  const nowT = hhmm(Date.now() / 1000);
  $('#mealForms').innerHTML = [1, 2].map((slot) => {
    const m = d.meals.find((x) => x.slot === slot);
    const time = m ? hhmm(m.ts) : (isToday ? nowT : slot === 1 ? '12:00' : '18:00');
    return `<form class="meal" data-slot="${slot}">
      <h3>Meal ${slot}</h3>
      <label>Time <input name="time" type="time" value="${time}" required></label>
      <label>Protein (g) <input name="protein_g" type="number" inputmode="decimal" min="0" step="1" value="${m ? m.protein_g : ''}" placeholder="${s.protein_per_meal}" required></label>
      <label>Carbs (g) <input name="carbs_g" type="number" inputmode="decimal" min="0" step="1" value="${m ? m.carbs_g : ''}" placeholder="0" required></label>
      <div class="actions"><button type="submit">${m ? 'Update' : 'Save'} meal ${slot}</button>${m ? `<button type="button" class="link" data-del-meal="${slot}">Remove</button>` : ''}</div>
    </form>`;
  }).join('');
  $('#mealTotals').textContent = d.meals.length
    ? `Protein ${d.protein_total} g. Carbs ${d.carbs_total} g of ${s.carb_cap} g.` : `Carb cap ${s.carb_cap} g. Protein target ${s.protein_per_meal} g per meal.`;
}

// glucose chart -------------------------------------------------------------
function renderGlucose() {
  const g = state.data.glucose, box = $('#glucoseBody');
  const lastNote = g.last_ts ? `Newest reading in the database: ${ago(g.last_ts)}.` : 'No readings imported yet.';
  if (!g.series.length) {
    box.innerHTML = `<p class="empty">No glucose readings for this day. Import a Dexcom Clarity CSV in Settings. ${lastNote}</p>`;
    return;
  }
  const { start, end } = state.data, st = g.stats;
  const W = 640, H = 230, L = 38, R = 10, T = 12, B = 26;
  const vals = g.series.map((p) => p[1]);
  const lo = Math.min(60, Math.floor(Math.min(...vals) / 10) * 10 - 5), hi = Math.max(160, Math.ceil(Math.max(...vals) / 10) * 10 + 5);
  const x = (ts) => L + ((ts - start) / (end - start)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  let path = '', prev = null;
  for (const [ts, v] of g.series) {
    path += (prev === null || ts - prev > 1200 ? 'M' : 'L') + x(ts).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
    prev = ts;
  }
  const yTicks = []; for (let v = Math.ceil(lo / 20) * 20; v <= hi; v += 20) yTicks.push(v);
  const xTicks = [[0, '12a'], [0.25, '6a'], [0.5, '12p'], [0.75, '6p'], [1, '12a']];
  const markers = state.data.meals.map((m) =>
    `<line class="marker" x1="${x(m.ts)}" x2="${x(m.ts)}" y1="${T}" y2="${H - B}"/><text class="marker-label" x="${x(m.ts) + 4}" y="${T + 10}">M${m.slot}</text>`).join('');

  box.innerHTML = `
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Glucose for ${esc(dayLong(state.day))}: average ${st.avg}, lowest ${st.min}, highest ${st.max} mg/dL">
      <rect class="band" x="${L}" y="${y(g.band[1])}" width="${W - L - R}" height="${y(g.band[0]) - y(g.band[1])}"/>
      ${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      ${xTicks.map(([f, l]) => `<text x="${L + f * (W - L - R)}" y="${H - 8}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${l}</text>`).join('')}
      ${markers}
      <path class="line" d="${path}"/>
    </svg>
    <p class="stats">
      <span>Average <b>${st.avg}</b> mg/dL</span>
      ${st.fasting_avg != null ? `<span>Fasting (6a to first meal) <b>${st.fasting_avg}</b></span>` : ''}
      <span>Within ${g.band[0]}-${g.band[1]} <b>${st.in_range_pct}%</b></span>
      <span class="${st.min < 70 ? 'warn' : ''}">Lowest <b>${st.min}</b>${st.min < 70 ? ' (under 70)' : ''}</span>
    </p>
    ${st.per_meal.length ? `<div class="tablewrap"><table>
      <thead><tr><th scope="col">Meal</th><th scope="col">Before</th><th scope="col">Peak</th><th scope="col">Rise</th><th scope="col">Peak at</th></tr></thead>
      <tbody>${st.per_meal.map((m) => m.rise == null
        ? `<tr><th scope="row">Meal ${m.slot}<small>${clock(m.ts)}</small></th><td colspan="4">not enough readings around this meal</td></tr>`
        : `<tr><th scope="row">Meal ${m.slot}<small>${clock(m.ts)}</small></th><td>${m.baseline}</td><td>${m.peak}</td><td>+${m.rise}</td><td>${m.minutes_to_peak} min</td></tr>`).join('')}</tbody>
    </table></div>` : '<p class="hint">Log your meals to see how glucose responded to each one.</p>'}
    <p class="hint">${lastNote} All values are mg/dL. Meal analysis uses the time you entered for each meal: Before is the 15 minutes leading up to it, Peak is the highest reading in the 2 hours after.</p>`;
}

// withings ------------------------------------------------------------------
function renderWithings() {
  const box = $('#withingsBody'), v = state.data.vitals || {}, w = state.data.weight;
  const tiles = [];
  if (w?.weight != null) tiles.push(tile('Weight', `${w.weight}<small> lb</small>`, w.source === 'withings' ? 'scale' : 'manual'));
  if (w?.body_fat_pct != null) tiles.push(tile('Body fat', `${w.body_fat_pct}<small> %</small>`));
  if (v.steps != null) tiles.push(tile('Steps', Number(v.steps).toLocaleString()));
  if (v.hr_avg != null) tiles.push(tile('Heart rate avg', `${v.hr_avg}<small> bpm</small>`));
  if (v.hr_min != null && v.hr_max != null) tiles.push(tile('HR range', `${v.hr_min}&ndash;${v.hr_max}<small> bpm</small>`));
  if (v.sleep_hours != null) tiles.push(tile('Sleep', `${v.sleep_hours}<small> h</small>`, v.sleep_score != null ? `score ${v.sleep_score}` : null));
  else if (v.sleep_score != null) tiles.push(tile('Sleep score', v.sleep_score));
  if (v.sleep_efficiency_pct != null) tiles.push(tile('Sleep efficiency', `${v.sleep_efficiency_pct}<small> %</small>`));

  if (!tiles.length) {
    box.innerHTML = '<p class="hint">No scale, activity, or sleep data for this day yet. Connect Withings in Settings, or log a weigh-in below.</p>';
    return;
  }
  box.innerHTML = `<div class="tiles">${tiles.join('')}</div>${renderStages(v)}`;
}
function tile(label, value, sub) {
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}
function renderStages(v) {
  const segs = [['deep', v.sleep_deep_min], ['light', v.sleep_light_min], ['rem', v.sleep_rem_min], ['awake', v.sleep_awake_min]];
  const total = segs.reduce((s, [, m]) => s + (m || 0), 0);
  if (!total) return '';
  const label = (k) => ({ deep: 'Deep', light: 'Light', rem: 'REM', awake: 'Awake' }[k]);
  return `<div class="stages">
    <div class="bar-track">${segs.map(([k, m]) => m ? `<span class="seg-${k}" style="width:${(100 * m / total).toFixed(1)}%"></span>` : '').join('')}</div>
    <div class="legend">${segs.filter(([, m]) => m).map(([k, m]) => `<span><i class="seg-${k}"></i>${label(k)} <b>${Math.floor(m / 60)}h ${m % 60}m</b></span>`).join('')}</div>
  </div>`;
}

// overview: Apple-Health-style ring strip at the top of the dashboard --------
function ringSvg(pct, centerText, size = 52, stroke = 5) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/>
    <text x="${size / 2}" y="${size / 2}">${esc(centerText)}</text>
  </svg>`;
}
function deltaHtml(diff, fmt, higherIsGood) {
  if (diff == null || Number.isNaN(diff)) return '';
  const flat = Math.abs(diff) < 0.05;
  const cls = flat ? 'flat' : (diff > 0) === higherIsGood ? 'good' : 'bad';
  const arrow = flat ? '&ndash;' : diff > 0 ? '&#9650;' : '&#9660;';
  return `<div class="delta ${cls}">${arrow} ${fmt(Math.abs(diff))} vs 7-day avg</div>`;
}
function renderOverview() {
  const d = state.data, r = state.range, box = $('#overview');
  if (!box || !d) return;
  const cards = [];
  cards.push(`<div class="stat-card">${ringSvg(d.score.total ? d.score.done / d.score.total : 0, `${d.score.done}/${d.score.total}`)}
    <div class="body"><div class="label">Habits today</div><div class="value">${d.score.total ? Math.round((100 * d.score.done) / d.score.total) : 0}<small>%</small></div></div></div>`);

  const sGoal = d.settings.sleep_hours, sH = d.vitals?.sleep_hours;
  if (sH != null) cards.push(`<div class="stat-card">${ringSvg(sGoal ? sH / sGoal : 0, `${sH}h`)}
    <div class="body"><div class="label">Sleep</div><div class="value">${sH}<small> h</small></div><div class="sub" style="font-size:12px;color:var(--text-2)">goal ${sGoal} h</div></div></div>`);

  if (r) {
    const days = r.days;
    const w = days.map((x) => x.weight), wTodayRaw = w[w.length - 1] ?? d.weight?.weight ?? null;
    const wToday = wTodayRaw == null ? null : Math.round(wTodayRaw * 10) / 10;
    const wPrev = w.slice(0, -1).filter((v) => v != null);
    const wAvg7 = wPrev.length ? wPrev.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, wPrev.length) : null;
    if (wToday != null) cards.push(`<div class="stat-card"><div class="body"><div class="label">Weight</div>
      <div class="value">${wToday}<small> lb</small></div>${wAvg7 != null ? deltaHtml(wToday - wAvg7, (v) => v.toFixed(1) + ' lb', false) : ''}</div></div>`);

    const st = days.map((x) => x.steps), stToday = st[st.length - 1];
    const stPrev = st.slice(0, -1).filter((v) => v != null);
    const stAvg7 = stPrev.length ? stPrev.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, stPrev.length) : null;
    if (stToday != null) cards.push(`<div class="stat-card"><div class="body"><div class="label">Steps</div>
      <div class="value">${Number(stToday).toLocaleString()}</div>${stAvg7 != null ? deltaHtml(stToday - stAvg7, (v) => Math.round(v).toLocaleString(), true) : ''}</div></div>`);
  }
  box.innerHTML = cards.join('');
}

// sync status -----------------------------------------------------------------
let syncing = false;
function renderSyncBar(status, opts = {}) {
  const bar = $('#syncBar'), text = $('#syncText'), btn = $('#syncNow');
  if (!bar) return;
  btn.hidden = false;
  if (opts.checking) { bar.dataset.state = 'checking'; text.textContent = 'Checking Withings\u2026'; btn.hidden = true; return; }
  if (opts.error) { bar.dataset.state = 'error'; text.textContent = opts.error; btn.disabled = false; btn.textContent = 'Try again'; return; }
  if (!status.connected) { bar.dataset.state = 'off'; text.textContent = 'Withings not connected'; btn.hidden = true; return; }
  if (syncing) { bar.dataset.state = 'syncing'; text.textContent = 'Syncing\u2026'; btn.disabled = true; btn.textContent = 'Syncing\u2026'; return; }
  const staleMs = status.last_sync ? (Date.now() / 1000 - status.last_sync) : Infinity;
  bar.dataset.state = staleMs > 36 * 3600 ? 'stale' : 'ok';
  text.textContent = status.last_sync ? `Withings \u2022 synced ${ago(status.last_sync)}` : 'Withings connected \u2022 never synced';
  btn.disabled = false; btn.textContent = 'Sync now';
}
async function loadSyncStatus() {
  if (!token) return;
  renderSyncBar(null, { checking: true });
  try { const s = await getJson('/api/withings/status'); renderSyncBar(s); return s; }
  catch (e) { if (e.message !== 'Not authorized') renderSyncBar(null, { error: 'Couldn\u2019t check sync status' }); }
}
async function doSync() {
  if (syncing) return;
  syncing = true; renderSyncBar(null, {});
  const bar = $('#syncBar'); if (bar) bar.dataset.state = 'syncing';
  const btn = $('#syncNow'); if (btn) { btn.disabled = true; btn.textContent = 'Syncing\u2026'; }
  try {
    const r = await (await send('POST', '/api/withings/sync')).json();
    toast(`Synced: ${r.weight_days} weigh-in${r.weight_days === 1 ? '' : 's'}, ${r.activity_days} activity day${r.activity_days === 1 ? '' : 's'}, ${r.sleep_nights} night${r.sleep_nights === 1 ? '' : 's'} of sleep`);
    await refresh();
  } catch (e) { if (e.message !== 'Not authorized') toast(e.message); }
  finally { syncing = false; await loadSyncStatus(); }
}

// trend ---------------------------------------------------------------------
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
function spark(values, avg, days, unit) {
  values = values.map(r1);
  const pts = values.map((v, i) => [i, v]).filter((p) => p[1] != null);
  if (pts.length < 2) return null;
  const all = pts.map((p) => p[1]).concat((avg || []).filter((v) => v != null));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const W = 300, H = 130, P = 10, n = values.length - 1;
  const X = (i) => P + (i / n) * (W - 2 * P), Y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const line = (arr) => arr.map(([i, v], k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const avgPts = (avg || []).map((v, i) => [i, v]).filter((p) => p[1] != null);
  const points = values.map((v, i) => [Number(X(i).toFixed(1)), v == null ? null : Number(Y(v).toFixed(1)), v, days ? dayShort(days[i]) : '']);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-points='${esc(JSON.stringify(points))}' data-unit="${esc(unit || '')}">
    ${avgPts.length > 1 ? `<path class="avg" d="${line(avgPts)}"/>` : ''}
    <path class="line" d="${line(pts)}"/>
    ${pts.map(([i, v]) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.5"/>`).join('')}
    <line class="hoverline" x1="0" y1="${P}" x2="0" y2="${H - P}" opacity="0"/>
    <circle class="hoverdot" r="4" opacity="0"/>
    <rect class="tooltip-bg" y="4" height="16" rx="4" opacity="0"/>
    <text class="tooltip-text" y="15" text-anchor="middle" opacity="0"></text>
  </svg>`;
}
function attachTooltip(svg) {
  let pts; try { pts = JSON.parse(svg.dataset.points || '[]'); } catch { return; }
  const unit = svg.dataset.unit || '';
  const [hoverline, hoverdot, tipBg, tipText] = ['.hoverline', '.hoverdot', '.tooltip-bg', '.tooltip-text'].map((s) => svg.querySelector(s));
  const vb = () => svg.viewBox.baseVal;
  function move(clientX) {
    const rect = svg.getBoundingClientRect(), b = vb();
    const relX = ((clientX - rect.left) / rect.width) * b.width;
    let nearest = null, nd = Infinity;
    for (const p of pts) { if (p[1] == null) continue; const d = Math.abs(p[0] - relX); if (d < nd) { nd = d; nearest = p; } }
    if (!nearest) return hide();
    const [x, y, v, label] = nearest;
    hoverline.setAttribute('x1', x); hoverline.setAttribute('x2', x); hoverline.setAttribute('opacity', 1);
    hoverdot.setAttribute('cx', x); hoverdot.setAttribute('cy', y); hoverdot.setAttribute('opacity', 1);
    const txt = `${label ? label + ': ' : ''}${v}${unit}`;
    tipText.textContent = txt;
    const tw = Math.max(34, txt.length * 5.6 + 12);
    const tx = Math.max(2, Math.min(x - tw / 2, b.width - tw - 2));
    tipBg.setAttribute('x', tx); tipBg.setAttribute('width', tw); tipBg.setAttribute('opacity', 0.94);
    tipText.setAttribute('x', tx + tw / 2); tipText.setAttribute('opacity', 1);
  }
  function hide() { [hoverline, hoverdot, tipBg, tipText].forEach((el) => el.setAttribute('opacity', 0)); }
  svg.addEventListener('pointermove', (e) => move(e.clientX));
  svg.addEventListener('pointerdown', (e) => move(e.clientX));
  svg.addEventListener('pointerleave', hide);
}

const TREND_TAB_LABELS = { habits: 'Habits', weight: 'Weight', glucose: 'Glucose', steps: 'Steps', sleep: 'Sleep', stages: 'Sleep stages' };
let trendTab = 'habits';

function renderTrend() {
  const days = state.range.days;
  const sumDone = days.reduce((s, d) => s + d.score.done, 0), sumTotal = days.reduce((s, d) => s + d.score.total, 0);
  const pct = sumTotal ? Math.round((100 * sumDone) / sumTotal) : 0;
  const bars = days.map((d) => {
    const h = d.score.total ? Math.round((100 * d.score.done) / d.score.total) : 0;
    const wd = new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
    return `<button class="bar" data-day="${d.day}" ${d.day === state.day ? 'aria-current="date"' : ''} aria-label="${esc(dayShort(d.day))}: ${d.score.done} of ${d.score.total}"><span style="--h:${h}%"></span><em>${wd}</em></button>`;
  }).join('');

  const dayList = days.map((d) => d.day);
  const weights = days.map((d) => d.weight);
  const wAvg = weights.map((_, i) => { const w = weights.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null); return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  const wLast = r1([...weights].reverse().find((v) => v != null));
  const wSpark = spark(weights, wAvg, dayList, ' lb');
  const fast = days.map((d) => d.glucose_fasting_avg);
  const fLast = r1([...fast].reverse().find((v) => v != null));
  const fSpark = spark(fast, null, dayList, ' mg/dL');
  const steps = days.map((d) => d.steps);
  const stLast = [...steps].reverse().find((v) => v != null);
  const stSpark = spark(steps, null, dayList, ' steps');
  const sleep = days.map((d) => d.sleep_hours);
  const slLast = r1([...sleep].reverse().find((v) => v != null));
  const slSpark = spark(sleep, null, dayList, ' h');
  const stagesRows = days.map((d) => d.vitals || {});
  const hasStages = stagesRows.some((v) => v.sleep_deep_min || v.sleep_light_min || v.sleep_rem_min);

  const minis = {
    habits: `<div class="mini"><h3>Habits completed <small>${pct}% over 14 days</small></h3><div class="bars">${bars}</div></div>`,
    weight: `<div class="mini"><h3>Weight <small>${wLast != null ? `${wLast} latest, dashed = 7-day average` : ''}</small></h3>${wSpark || '<p class="hint">Log two or more weigh-ins to see a trend. Judge the dashed average, not single days.</p>'}</div>`,
    glucose: `<div class="mini"><h3>Fasting glucose <small>${fLast != null ? `${fLast} mg/dL latest` : ''}</small></h3>${fSpark || '<p class="hint">Needs glucose readings on two or more days.</p>'}</div>`,
    steps: `<div class="mini"><h3>Steps <small>${stLast != null ? `${Number(stLast).toLocaleString()} latest` : ''}</small></h3>${stSpark || '<p class="hint">Needs synced activity on two or more days.</p>'}</div>`,
    sleep: `<div class="mini"><h3>Sleep <small>${slLast != null ? `${slLast} h latest` : ''}</small></h3>${slSpark || '<p class="hint">Needs synced sleep on two or more nights.</p>'}</div>`,
    stages: hasStages ? `<div class="mini"><h3>Sleep stages <small>last 14 nights</small></h3><div class="trend">${days.map((d) => {
      const v = d.vitals || {}; return `<div><p class="hint" style="margin:0 0 4px">${esc(dayShort(d.day))}</p>${renderStages(v) || '<p class="hint" style="margin:0">No sleep synced</p>'}</div>`;
    }).join('')}</div></div>` : '',
  };

  const tabsAvail = TREND_TAB_ORDER().filter((k) => minis[k]);
  if (!tabsAvail.includes(trendTab)) trendTab = tabsAvail[0] || 'habits';
  $('#trendTabs').innerHTML = tabsAvail.map((k) =>
    `<button type="button" role="tab" aria-selected="${k === trendTab}" data-tab="${k}">${TREND_TAB_LABELS[k]}</button>`).join('');
  $('#trendBody').innerHTML = minis[trendTab] || '';
  $('#trendBody').querySelectorAll('svg[data-points]').forEach(attachTooltip);
  renderOverview();
}
function TREND_TAB_ORDER() { return ['habits', 'weight', 'glucose', 'steps', 'sleep', 'stages']; }

// ---------- events ----------
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('button'); if (!t) return;
  if (t.id === 'prev') return load(shiftDay(state.day, -1));
  if (t.id === 'next') return load(shiftDay(state.day, 1));
  if (t.id === 'todayBtn') return load(todayStr());
  if (t.id === 'openSettings') return openSettings('');
  if (t.id === 'closeSettings') return $('#settingsDlg').close();
  if (t.id === 'syncNow') return doSync();
  if (t.dataset.tab) { trendTab = t.dataset.tab; return renderTrend(); }
  if (t.dataset.day) return load(t.dataset.day);
  if (t.dataset.habit) {
    return act(() => send('PUT', '/api/habit', { day: state.day, habit: t.dataset.habit, done: t.dataset.done !== 'true', source: 'manual' }));
  }
  if (t.dataset.reset) return act(() => send('DELETE', `/api/habit?day=${state.day}&habit=${t.dataset.reset}`), 'Back to automatic');
  if (t.dataset.kind) return act(() => send('POST', '/api/event', { kind: t.dataset.kind }), `${EVENT_LABELS[t.dataset.kind]} recorded`);
  if (t.dataset.delEvent) return act(() => send('DELETE', `/api/event?id=${t.dataset.delEvent}`), 'Removed');
  if (t.dataset.delMeal) return act(() => send('DELETE', `/api/meal?day=${state.day}&slot=${t.dataset.delMeal}`), 'Meal removed');
});

$('#mealForms').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target, slot = +f.dataset.slot;
  act(() => send('POST', '/api/meal', { day: state.day, slot, time: f.time.value, protein_g: +f.protein_g.value, carbs_g: +f.carbs_g.value }), `Meal ${slot} saved`);
});
$('#weightForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target;
  act(() => send('POST', '/api/weight', { day: state.day, weight: +f.weight.value, waist: f.waist.value === '' ? null : +f.waist.value }), 'Weigh-in saved');
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && token && state.day) { refresh().catch(() => {}); loadSyncStatus(); } });

// ---------- settings ----------
async function openSettings(msg) {
  const dlg = $('#settingsDlg');
  $('#settingsMsg').textContent = msg || '';
  $('#tokenInput').value = token;
  $('#importMsg').textContent = '';
  if (token) {
    try {
      const s = await getJson('/api/settings');
      const f = $('#settingsForm');
      for (const k of ['carb_cap', 'protein_per_meal', 'window_hours', 'sleep_hours', 'walks_needed', 'tz']) f.elements[k].value = s[k];
      $('#trainingDays').innerHTML = WEEKDAYS.map((n, i) => `<label><input type="checkbox" name="td" value="${i + 1}" ${s.training_days.includes(i + 1) ? 'checked' : ''}>${n}</label>`).join('');
      $('#activeHabits').innerHTML = HABIT_ORDER.map((h) => `<label><input type="checkbox" name="ah" value="${h}" ${s.active_habits.includes(h) ? 'checked' : ''}>${HABIT_LABELS[h]}</label>`).join('');
    } catch { /* a 401 already re-opened the dialog with a message */ }
  }
  if (!dlg.open) dlg.showModal();
}

$('#saveToken').addEventListener('click', async () => {
  token = $('#tokenInput').value.trim();
  try { localStorage.setItem('pt_token', token); } catch { /* session only */ }
  try { await load(state.day); loadSyncStatus(); $('#settingsMsg').textContent = 'Token accepted.'; await openSettings('Token accepted.'); }
  catch (e) { $('#settingsMsg').textContent = e.message === 'Not authorized' ? 'That token was rejected.' : e.message; }
});

$('#settingsForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const f = ev.target, num = (k) => +f.elements[k].value;
  const body = {
    carb_cap: num('carb_cap'), protein_per_meal: num('protein_per_meal'), window_hours: num('window_hours'),
    sleep_hours: num('sleep_hours'), walks_needed: num('walks_needed'), tz: f.elements.tz.value.trim(),
    training_days: [...f.querySelectorAll('input[name=td]:checked')].map((i) => +i.value),
    active_habits: [...f.querySelectorAll('input[name=ah]:checked')].map((i) => i.value),
  };
  act(() => send('PUT', '/api/settings', body), 'Settings saved');
});

// Dexcom Clarity CSV -> chunks of 2000 readings ------------------------------
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
    if (iE >= 0 && c[iE] && c[iE].trim().toUpperCase() !== 'EGV') continue; // skip insulin/carb/alert rows
    const t = (c[iT] || '').trim(), v = (c[iG] || '').trim();
    if (!t || !v) continue;
    let mg;
    if (/^low$/i.test(v)) mg = 40;          // sensor floor: "Low" means at or below the display limit
    else if (/^high$/i.test(v)) mg = 400;   // sensor ceiling
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
      msg.textContent = `Uploading ${Math.min(i + 2000, rows.length)} of ${rows.length} readings...`;
      const res = await (await send('POST', '/api/glucose', { source: 'clarity', readings: rows.slice(i, i + 2000) })).json();
      inserted += res.inserted; valid += res.valid;
    }
    msg.textContent = `Done. ${inserted} new readings added, ${valid - inserted} were already stored, ${rows.length - valid} skipped as invalid.`;
    await refresh();
  } catch (e) { msg.textContent = e.message; }
  ev.target.value = '';
});

$('#exportBtn').addEventListener('click', async () => {
  try {
    const blob = await (await api('/api/export.csv?days=28')).blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `protocol-${todayStr()}.csv` });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { $('#importMsg').textContent = e.message; }
});

// ---------- boot ----------
if (token) { load().catch((e) => { if (e.message !== 'Not authorized') toast(e.message); }); loadSyncStatus(); }
else openSettings('Enter the access token you set on the Worker to begin.');
