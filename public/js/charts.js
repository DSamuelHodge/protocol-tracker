import { esc, label } from './dom.js';

export function ringSvg(pct, centerText, size = 52, stroke = 5) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, p = Math.max(0, Math.min(1, pct || 0));
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - p)).toFixed(1)}"/>
    <text x="${size / 2}" y="${size / 2}">${esc(centerText)}</text>
  </svg>`;
}

export function stagesHtml(v) {
  const segs = [['deep', v.sleep_deep_min], ['light', v.sleep_light_min], ['rem', v.sleep_rem_min], ['awake', v.sleep_awake_min]];
  const total = segs.reduce((s, [, m]) => s + (m || 0), 0);
  if (!total) return '';
  const name = { deep: 'Deep', light: 'Light', rem: 'REM', awake: 'Awake' };
  return `<div class="stages">
    <div class="bar-track">${segs.map(([k, m]) => m ? `<span class="seg-${k}" style="width:${(100 * m / total).toFixed(1)}%"></span>` : '').join('')}</div>
    <div class="legend">${segs.filter(([, m]) => m).map(([k, m]) => `<span><i class="seg-${k}"></i>${name[k]} <b>${Math.floor(m / 60)}h ${m % 60}m</b></span>`).join('')}</div>
  </div>`;
}

const r1 = (v) => (v == null || Number.isNaN(+v) ? null : Math.round(+v * 10) / 10);

export function spark(values, extra, days, unit) {
  values = values.map(r1);
  const pts = values.map((v, i) => [i, v]).filter((p) => p[1] != null);
  if (pts.length < 2) return '';
  const all = pts.map((p) => p[1]).concat((extra || []).filter((v) => v != null).map(r1));
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const W = 300, H = 130, P = 10, n = values.length - 1 || 1;
  const X = (i) => P + (i / n) * (W - 2 * P), Y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const line = (arr) => arr.map(([i, v], k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  const extraPts = (extra || []).map((v, i) => [i, r1(v)]).filter((p) => p[1] != null);
  const points = values.map((v, i) => [Number(X(i).toFixed(1)), v == null ? null : Number(Y(v).toFixed(1)), v, days ? label(days[i]) : '']);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-points='${esc(JSON.stringify(points))}' data-unit="${esc(unit || '')}">
    ${extraPts.length > 1 ? `<path class="avg" d="${line(extraPts)}"/>` : ''}
    <path class="line" d="${line(pts)}"/>
    ${pts.map(([i, v]) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.5"/>`).join('')}
    <line class="hoverline" x1="0" y1="${P}" x2="0" y2="${H - P}" opacity="0"/>
    <circle class="hoverdot" r="4" opacity="0"/>
    <rect class="tooltip-bg" y="4" height="16" rx="4" opacity="0"/>
    <text class="tooltip-text" y="15" text-anchor="middle" opacity="0"></text>
  </svg>`;
}

export function attachTooltip(svg) {
  let pts; try { pts = JSON.parse(svg.dataset.points || '[]'); } catch { return; }
  const unit = svg.dataset.unit || '';
  const [hoverline, hoverdot, tipBg, tipText] = ['.hoverline', '.hoverdot', '.tooltip-bg', '.tooltip-text'].map((s) => svg.querySelector(s));
  if (!hoverline) return;
  const vb = () => svg.viewBox.baseVal;
  function move(clientX) {
    const rect = svg.getBoundingClientRect(), b = vb();
    const relX = ((clientX - rect.left) / rect.width) * b.width;
    let nearest = null, nd = Infinity;
    for (const p of pts) { if (p[1] == null) continue; const d = Math.abs(p[0] - relX); if (d < nd) { nd = d; nearest = p; } }
    if (!nearest) return hide();
    const [x, y, v, text] = nearest;
    hoverline.setAttribute('x1', x); hoverline.setAttribute('x2', x); hoverline.setAttribute('opacity', 1);
    hoverdot.setAttribute('cx', x); hoverdot.setAttribute('cy', y); hoverdot.setAttribute('opacity', 1);
    const txt = `${text ? text + ': ' : ''}${v}${unit}`;
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

export function glucoseChart(day, meals, clockFn) {
  const g = day.glucose;
  if (!g || g.hidden || !g.series.length) return '';
  const { start, end } = day, st = g.stats;
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
  const markers = meals.map((m) => `<line class="marker" x1="${x(m.ts)}" x2="${x(m.ts)}" y1="${T}" y2="${H - B}"/><text class="marker-label" x="${x(m.ts) + 4}" y="${T + 10}">M${m.slot}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Glucose, average ${st.avg}">
    <rect class="band" x="${L}" y="${y(g.band[1])}" width="${W - L - R}" height="${y(g.band[0]) - y(g.band[1])}"/>
    ${yTicks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    ${xTicks.map(([f, l]) => `<text x="${L + f * (W - L - R)}" y="${H - 8}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${l}</text>`).join('')}
    ${markers}<path class="line" d="${path}"/>
  </svg>
  <p class="stats"><span>Average <b>${st.avg}</b></span><span>Within ${g.band[0]}–${g.band[1]} <b>${st.in_range_pct}%</b></span><span>Lowest <b>${st.min}</b></span></p>
  ${st.per_meal?.length ? `<div class="tablewrap"><table><thead><tr><th scope="col">Meal</th><th>Before</th><th>Peak</th><th>Rise</th><th>Peak at</th></tr></thead><tbody>
    ${st.per_meal.map((m) => m.rise == null
      ? `<tr><th scope="row">Meal ${m.slot}<small>${esc(clockFn(m.ts))}</small></th><td colspan="4">not enough readings</td></tr>`
      : `<tr><th scope="row">Meal ${m.slot}<small>${esc(clockFn(m.ts))}</small></th><td>${m.baseline}</td><td>${m.peak}</td><td>+${m.rise}</td><td>${m.minutes_to_peak} min</td></tr>`).join('')}
  </tbody></table></div>` : ''}`;
}

export function progressSvg(weights, guide) {
  const pts = [];
  const days = new Map();
  for (const g of guide || []) days.set(g.day, { guide: g });
  for (const w of weights || []) {
    if (w.weight == null) continue;
    const row = days.get(w.day) || {};
    row.weight = w.weight;
    days.set(w.day, row);
  }
  const keys = [...days.keys()].sort();
  if (keys.filter((k) => days.get(k).weight != null).length < 1 && keys.length < 2) return '';
  const values = keys.map((k) => days.get(k).weight ?? null);
  const gentle = keys.map((k) => days.get(k).guide?.gentle ?? null);
  const fast = keys.map((k) => days.get(k).guide?.fast ?? null);
  const nums = [...values, ...gentle, ...fast].filter((v) => v != null);
  if (nums.length < 2) return '';
  let lo = Math.min(...nums), hi = Math.max(...nums);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const W = 320, H = 150, P = 12, n = Math.max(keys.length - 1, 1);
  const X = (i) => P + (i / n) * (W - 2 * P);
  const Y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const path = (arr, cls) => {
    const seq = arr.map((v, i) => [i, v]).filter((p) => p[1] != null);
    if (seq.length < 2) return '';
    const d = seq.map(([i, v], k) => (k ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
    return `<path class="${cls}" d="${d}"/>`;
  };
  const dots = values.map((v, i) => v == null ? '' : `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.6"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight and the 1 to 2 pound per week guide">
    ${path(gentle, 'guide-gentle')}${path(fast, 'guide-fast')}${path(values, 'line')}${dots}
  </svg>`;
}
