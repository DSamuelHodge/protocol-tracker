'use strict';
// Dietary and fitness tips page. No dependencies.
// Content comes from /tips.json; insights are computed client-side from
// GET /api/range?days=14 plus per-day details, using the same bearer token
// as the tracker (localStorage key pt_token).

// ---------- insight thresholds (tune here) ----------
const WEIGHT_UNIT = 'lb';       // unit used for weigh-ins on the tracker page
const LB_TO_KG = 0.4536;
const PROTEIN_PER_KG = 1.6;     // g per kg body weight per day
const PROTEIN_RATIO = 0.9;      // insight when average is below 90% of target
const CARB_OVER_DAYS = 3;       // insight when over the cap this many days in 14
const WINDOW_MISSED_DAYS = 4;   // insight when the window is missed this often
const WALKS_RATIO = 0.6;        // insight when walks are done less often than this
const TRAINING_RATIO = 0.6;     // insight when scheduled training is done less often
const SLEEP_RATIO = 0.5;        // insight when sleep rows meet the goal less often
const POSITIVE_RATIO = 0.85;    // praise when a habit is met at least this often
const MIN_LOGGED_DAYS = 5;      // need this many days with both meals logged
const LOW_GLUCOSE = 70;         // mg/dL floor for the low-readings insight
const RISE_NOTE = 30;           // mg/dL median meal rise worth mentioning
const EVENING_DELTA = 10;       // mg/dL by which meal 2 must exceed meal 1 to call out
const RANGE_DAYS = 14;
const MAX_INSIGHTS = 4;

const HABIT_LABELS = {
  window: 'Eating window',
  protein: 'Protein at both meals',
  carbs: 'Carbs under the cap',
  walks: 'Post-meal walks',
  training: 'Strength or HIIT',
  sleep: 'Sleep goal',
  screens: 'Screens off before bed',
};

const DOTS = { strong: '●●●', moderate: '●●○', limited: '●○○', practical: '○○○' };
const EVIDENCE_LABEL = { strong: 'Strong', moderate: 'Moderate', limited: 'Limited', practical: 'Practical' };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

let token = '';
try { token = localStorage.getItem('pt_token') || ''; } catch { /* storage blocked */ }

async function getJson(path, auth) {
  const headers = auth ? { Authorization: 'Bearer ' + token } : {};
  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(res.status === 401 ? 'Not authorized' : res.statusText);
  return res.json();
}

// ---------- static tips rendering ----------
function evidenceLine(tip) {
  const label = EVIDENCE_LABEL[tip.evidence] || 'Moderate';
  const dots = DOTS[tip.evidence] || DOTS.moderate;
  const note = tip.evidence_note ? `, ${esc(tip.evidence_note)}` : '';
  return `<p class="evidence">Evidence: ${label} <span aria-hidden="true">${dots}</span>${note}</p>`;
}

function tipCard(tip) {
  const sources = tip.sources && tip.sources.length
    ? `<ul class="sources">${tip.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
    : '<p class="hint">No specific source cited.</p>';
  return `<article class="tip" id="tip-${esc(tip.id)}">
    <h3>${esc(tip.title)}</h3>
    <p class="tip-summary">${esc(tip.summary)}</p>
    <ul class="how">${tip.how.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
    ${evidenceLine(tip)}
    ${tip.caution ? `<p class="caution">Caution: ${esc(tip.caution)}</p>` : ''}
    <details><summary>Why, and sources</summary><p>${esc(tip.why)}</p>${sources}</details>
  </article>`;
}

function renderTips(data) {
  const legend = ['strong', 'moderate', 'limited', 'practical']
    .map((k) => `<li><span>${EVIDENCE_LABEL[k]} <span aria-hidden="true">${DOTS[k]}</span></span> ${esc(data.evidence_legend[k])}</li>`)
    .join('');
  $('#tipSections').innerHTML = data.sections.map((sec, i) => `
    <section aria-labelledby="h-${esc(sec.id)}" id="${esc(sec.id)}">
      <h2 id="h-${esc(sec.id)}">${esc(sec.title)}</h2>
      <p class="lede">${esc(sec.lede)}</p>
      ${i === 0 ? `<ul class="legend" aria-label="Evidence legend">${legend}</ul>` : ''}
      ${sec.tips.map(tipCard).join('')}
    </section>`).join('');
  const titles = {};
  for (const sec of data.sections) for (const tip of sec.tips) titles[tip.id] = tip.title;
  return titles;
}

// ---------- insights ----------
function insightCard(obs, action, tipIds, titles) {
  const links = (tipIds || [])
    .filter((id) => titles[id])
    .map((id) => `<a href="#tip-${esc(id)}">${esc(titles[id])}</a>`)
    .join(' ');
  return `<article class="insight"><p>${esc(obs)}</p><p class="insight-action">${esc(action)}</p>${links ? `<p class="insight-links">Related: ${links}</p>` : ''}</article>`;
}

function buildInsights(days, settings, loggedDays, titles) {
  const out = [];   // { gap, html } for gap-ordered insights
  const S = settings;

  // Safety first: low glucose readings.
  const lowDays = days.filter((d) => d.glucose_min != null && d.glucose_min < LOW_GLUCOSE);
  let safety = null;
  if (lowDays.length) {
    const lowest = Math.min(...lowDays.map((d) => d.glucose_min));
    safety = insightCard(
      `Glucose dipped under ${LOW_GLUCOSE} mg/dL on ${lowDays.length} of the last ${RANGE_DAYS} days, lowest ${lowest} mg/dL. Brief overnight dips are common sensor artifacts.`,
      'Tell your doctor if lows come with symptoms, and review the stop signs below.',
      ['stop-signs', 'electrolytes-from-food'],
      titles,
    );
  }

  // Protein below target.
  const avgProtein = mean(loggedDays.map((d) => d.protein_total));
  const latestWeight = [...days].reverse().map((d) => d.weight).find((w) => w != null);
  const weightTarget = latestWeight != null ? latestWeight * (WEIGHT_UNIT === 'lb' ? LB_TO_KG : 1) * PROTEIN_PER_KG : 0;
  const proteinTarget = Math.max(S.protein_per_meal * 2, weightTarget);
  if (avgProtein != null && avgProtein < PROTEIN_RATIO * proteinTarget) {
    out.push({
      gap: (proteinTarget - avgProtein) / proteinTarget,
      html: insightCard(
        `Average protein on days with both meals logged is ${round1(avgProtein)} g, below your ${round1(proteinTarget)} g target.`,
        'Split the target across both meals and log grams at each meal.',
        ['protein-target'],
        titles,
      ),
    });
  }

  // Carbs over cap.
  const overDays = days.filter((d) => d.carbs_total != null && d.carbs_total > S.carb_cap);
  if (overDays.length >= CARB_OVER_DAYS) {
    out.push({
      gap: overDays.length / RANGE_DAYS,
      html: insightCard(
        `Carbs were over your ${S.carb_cap} g cap on ${overDays.length} of the last ${RANGE_DAYS} days.`,
        'Pick total or net carbs and log sauces, dairy, nuts and drinks the same way each day.',
        ['carb-counting-consistency'],
        titles,
      ),
    });
  }

  // Window slipping.
  const missedWindow = days.filter((d) => d.habits.window === 'missed').length;
  if (missedWindow >= WINDOW_MISSED_DAYS) {
    out.push({
      gap: missedWindow / RANGE_DAYS,
      html: insightCard(
        `The eating window was missed on ${missedWindow} of the last ${RANGE_DAYS} days.`,
        'Aim to close the window at least 2 to 3 hours before bed and use the Meal closed button.',
        ['early-last-meal'],
        titles,
      ),
    });
  }

  // Few walks.
  const walksDone = days.filter((d) => d.habits.walks === 'done').length / RANGE_DAYS;
  if (walksDone < WALKS_RATIO) {
    out.push({
      gap: WALKS_RATIO - walksDone,
      html: insightCard(
        `Walks were logged on ${Math.round(walksDone * 100)}% of the last ${RANGE_DAYS} days.`,
        'Take a 10 minute easy walk after the larger meal, starting within 15 minutes of finishing.',
        ['post-meal-walk'],
        titles,
      ),
    });
  }

  // Lifting gaps.
  const scheduled = days.filter((d) => d.habits.training !== 'na');
  const trainedRatio = scheduled.length ? scheduled.filter((d) => d.habits.training === 'done').length / scheduled.length : 1;
  if (scheduled.length && trainedRatio < TRAINING_RATIO) {
    out.push({
      gap: TRAINING_RATIO - trainedRatio,
      html: insightCard(
        `Training was logged on ${scheduled.filter((d) => d.habits.training === 'done').length} of ${scheduled.length} scheduled days.`,
        'Plan two full-body sessions a week and log them with the Trained button.',
        ['strength-2-3x'],
        titles,
      ),
    });
  }

  // Big meal rise.
  const r1 = days.map((d) => d.meal1_rise).filter((v) => v != null);
  const r2 = days.map((d) => d.meal2_rise).filter((v) => v != null);
  const m1 = median(r1), m2 = median(r2);
  const big = Math.max(m1 ?? -Infinity, m2 ?? -Infinity);
  if (big >= RISE_NOTE) {
    const which = m2 != null && m2 >= RISE_NOTE && (m1 == null || m2 - m1 >= EVENING_DELTA)
      ? `The evening meal is the bigger one (median rise ${round1(m2)} mg/dL).`
      : `Median rise is ${round1(big)} mg/dL.`;
    out.push({
      gap: Math.min(1, (big - RISE_NOTE) / 60),
      html: insightCard(
        `${which} This is a comparison against your own baseline, not a diagnosis.`,
        'Eat protein and vegetables before the starchy part, and walk for 10 minutes after the meal.',
        ['protein-first-plate', 'post-meal-walk'],
        titles,
      ),
    });
  }

  // Sleep gaps (sleep states only come from a logged row, so done/missed means a row exists).
  const sleepRows = days.filter((d) => d.habits.sleep === 'done' || d.habits.sleep === 'missed');
  const sleepRatio = sleepRows.length ? sleepRows.filter((d) => d.habits.sleep === 'done').length / sleepRows.length : 1;
  if (sleepRows.length && sleepRatio < SLEEP_RATIO) {
    out.push({
      gap: SLEEP_RATIO - sleepRatio,
      html: insightCard(
        `The sleep goal was met on ${sleepRows.filter((d) => d.habits.sleep === 'done').length} of ${sleepRows.length} logged nights.`,
        'Keep a steady bedtime in a cool, dark room and protect one full rest day a week.',
        ['recovery-sleep'],
        titles,
      ),
    });
  }

  // One positive insight when a habit is met almost every counted day.
  const denom = (h) => (h === 'training' ? scheduled.length : h === 'sleep' ? sleepRows.length : RANGE_DAYS);
  const positiveHabit = ['window', 'protein', 'carbs', 'walks', 'training', 'sleep', 'screens'].find((h) => {
    const n = denom(h);
    return n > 0 && days.filter((d) => d.habits[h] === 'done').length / n >= POSITIVE_RATIO;
  });
  let positive = null;
  if (positiveHabit) {
    const n = denom(positiveHabit);
    const done = days.filter((d) => d.habits[positiveHabit] === 'done').length;
    positive = insightCard(
      `${HABIT_LABELS[positiveHabit]} was met on ${done} of ${n} days. Keep going.`,
      'No change needed; consistency is the whole game.',
      [],
      titles,
    );
  }

  out.sort((a, b) => b.gap - a.gap);
  const slots = MAX_INSIGHTS - (positive ? 1 : 0);
  const picked = [...(safety ? [safety] : []), ...out.map((o) => o.html)].slice(0, Math.max(slots, safety ? 1 : 0));
  if (positive && picked.length < MAX_INSIGHTS) picked.push(positive);
  return picked;
}

async function loadInsights(titles) {
  const box = $('#insights');
  if (!token) {
    box.innerHTML = '<p class="hint">Add your access token in the tracker settings to see insights from your data.</p>';
    return;
  }
  let range;
  try {
    range = await getJson(`/api/range?days=${RANGE_DAYS}`, true);
  } catch {
    box.innerHTML = '<p class="hint">Add your access token in the tracker settings to see insights from your data.</p>';
    return;
  }
  const days = range.days, settings = range.settings;
  // Exact "both meals logged" check needs per-day meal counts.
  const details = await Promise.all(
    days.filter((d) => d.protein_total > 0).map((d) => getJson(`/api/day?day=${d.day}`, true).catch(() => null)),
  );
  const twoMeals = new Set(details.filter((d) => d && d.meals && d.meals.length >= 2).map((d) => d.day));
  const loggedDays = days.filter((d) => twoMeals.has(d.day));
  if (loggedDays.length < MIN_LOGGED_DAYS) {
    box.innerHTML = '<p class="hint">Log both meals for five days and this panel will fill in.</p>';
    return;
  }
  const picked = buildInsights(days, settings, loggedDays, titles);
  box.innerHTML = picked.length
    ? picked.join('')
    : '<p class="hint">Nothing stands out in the last 14 days. Keep logging.</p>';
}

// ---------- boot ----------
(async () => {
  try {
    const data = await getJson('/tips.json', false);
    const titles = renderTips(data);
    await loadInsights(titles);
  } catch (e) {
    $('#tipSections').innerHTML = '<p class="empty">Could not load the tips. Check your connection and reload.</p>';
    $('#insights').innerHTML = '<p class="hint">Add your access token in the tracker settings to see insights from your data.</p>';
  }
})();
