import { esc, label } from './dom.js';

const MODALITY = {
  walk: 'Walk', incline_walk: 'Incline walk', hike: 'Hike', bike: 'Bike', elliptical: 'Elliptical',
};

export function sessionHtml(session) {
  if (!session) return '<p class="empty">No session on this day.</p>';
  const bits = [];
  if (session.warmup_min) bits.push(`${session.warmup_min} min warm-up`);
  if (session.finisher) bits.push(`finish with a ${session.finisher}`);
  if (session.rest_label) bits.push(session.rest_label);
  const intro = bits.length ? `<p class="lede">${esc(bits.join(' · '))}</p>` : '';
  const notes = session.notes ? `<p class="hint">${esc(session.notes)}</p>` : '';
  const status = session.log?.status ? `<p class="badge">${esc(session.log.status)}</p>` : '';
  if (session.preview) {
    return `<article class="hero">
      <p class="kicker">Coming up · ${esc(label(session.preview_day, { weekday: 'long', month: 'short', day: 'numeric' }))}</p>
      <h2>${esc(session.name)}</h2>
      ${intro}${notes}
      ${planList(session)}
      <button type="button" data-day="${esc(session.preview_day)}">Open that day</button>
    </article>`;
  }
  return `<article class="hero">
    <p class="kicker">${esc(session.line || session.kind)}</p>
    <h2>${esc(session.name)}</h2>
    ${status}${intro}${notes}
    ${session.kind === 'cardio' ? cardioForm(session) : session.checklist ? recoveryForm(session) : strengthForm(session)}
  </article>`;
}

function planList(session) {
  if (session.checklist) return `<ul class="plan">${session.checklist.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
  if (!session.exercises?.length) return '';
  return `<ul class="plan">${session.exercises.map((ex) => `<li><b>${esc(ex.name)}</b> ${esc(targetText(ex))}</li>`).join('')}</ul>`;
}

function targetText(ex) {
  const amount = ex.reps != null ? `${ex.reps}${ex.each_side ? ' / side' : ''}` : `${ex.seconds}s`;
  return `${ex.sets} × ${amount}`;
}

function loggedSet(session, name, setNo) {
  return (session.log?.sets || []).find((s) => s.exercise_name === name && s.set_no === setNo);
}

function strengthForm(session) {
  const exercises = session.exercises.map((ex) => {
    const sets = [];
    for (let n = 1; n <= ex.sets; n++) {
      const prev = loggedSet(session, ex.name, n);
      const reps = prev?.reps ?? ex.reps ?? '';
      const seconds = prev?.seconds ?? ex.seconds ?? '';
      const tul = prev?.tul_seconds ?? ex.suggested_tul ?? '';
      const tempo = prev ? prev.tempo_ok !== 0 : true;
      sets.push(`<div class="set">
        <span class="set-label">Set ${n}</span>
        ${ex.reps != null
          ? `<label>Reps <input data-reps type="number" inputmode="numeric" min="0" step="1" value="${esc(reps)}"></label>`
          : `<label>Seconds <input data-seconds type="number" inputmode="numeric" min="0" step="1" value="${esc(seconds)}"></label>`}
        <label>TUL s <input data-tul type="number" inputmode="decimal" min="0" step="1" value="${esc(tul)}"></label>
        <label class="checkline"><input data-tempo type="checkbox" ${tempo ? 'checked' : ''}> 3s/3s</label>
      </div>`);
    }
    const band = (session.log?.sets || []).find((s) => s.exercise_name === ex.name && s.band_level)?.band_level || '';
    const hint = session.progression?.[ex.name]?.hint;
    return `<section class="exercise" data-name="${esc(ex.name)}" data-seq="${ex.seq}">
      <header><h3>${esc(ex.name)}</h3><p>${esc(targetText(ex))}${ex.each_side ? ' each side' : ''}</p></header>
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}
      <label>Band <input data-band list="bands" value="${esc(band)}" placeholder="red, heavy…" autocomplete="off"></label>
      ${sets.join('')}
    </section>`;
  }).join('');
  return `<form id="sessionForm" data-kind="${esc(session.kind)}">
    ${exercises}
    <label>Notes <textarea name="notes" maxlength="500">${esc(session.log?.notes || '')}</textarea></label>
    ${actions()}
  </form>`;
}

function cardioForm(session) {
  const log = session.log || {};
  const options = (session.modalities || ['walk']).map((m) => `<option value="${esc(m)}" ${log.modality === m ? 'selected' : ''}>${esc(MODALITY[m] || m)}</option>`).join('');
  const zone = session.hr_zone ? `<p class="hint">Stay between ${session.hr_zone[0]} and ${session.hr_zone[1]} bpm.</p>` : '';
  const duration = log.duration_min ?? (Array.isArray(session.duration_min) ? '' : session.duration_min ?? '');
  const placeholder = Array.isArray(session.duration_min) ? `${session.duration_min[0]}–${session.duration_min[1]}` : '';
  return `<form id="sessionForm" data-kind="cardio">${zone}
    <div class="form-grid">
      <label>How <select name="modality">${options}</select></label>
      <label>Minutes <input name="duration_min" type="number" inputmode="decimal" min="0" step="1" value="${esc(duration)}" placeholder="${esc(placeholder)}"></label>
      <label>Avg HR <input name="hr_avg" type="number" inputmode="numeric" min="30" max="230" value="${esc(log.hr_avg ?? '')}"></label>
      <label>Min HR <input name="hr_min" type="number" inputmode="numeric" min="30" max="230" value="${esc(log.hr_min ?? '')}"></label>
      <label>Max HR <input name="hr_max" type="number" inputmode="numeric" min="30" max="230" value="${esc(log.hr_max ?? '')}"></label>
      <label>Effort 1–10 <input name="perceived_effort" type="number" inputmode="numeric" min="1" max="10" value="${esc(log.perceived_effort ?? '')}"></label>
    </div>
    <label>Notes <textarea name="notes" maxlength="500">${esc(log.notes || '')}</textarea></label>
    ${actions()}
  </form>`;
}

function recoveryForm(session) {
  const log = session.log || {};
  const checks = (session.checklist || []).map((item, i) => {
    const prev = (log.sets || []).find((s) => s.exercise_name === item);
    const on = prev ? !prev.skipped : true;
    return `<label class="checkline"><input data-check="${esc(item)}" data-seq="${i + 1}" type="checkbox" ${on ? 'checked' : ''}>${esc(item)}</label>`;
  }).join('');
  return `<form id="sessionForm" data-kind="${esc(session.kind)}">
    <div class="checks">${checks}</div>
    <label>Minutes <input name="duration_min" type="number" inputmode="decimal" min="0" step="1" value="${esc(log.duration_min ?? session.duration_min ?? '')}"></label>
    <label>Notes <textarea name="notes" maxlength="500">${esc(log.notes || '')}</textarea></label>
    ${actions()}
  </form>`;
}

function actions() {
  return `<div class="actions">
    <button type="submit" data-status="completed">Save and complete</button>
    <button type="button" class="ghost" data-status="partial">Save progress</button>
    <button type="button" class="ghost" data-status="skipped">Skip today</button>
  </div>`;
}

export function readSession(form, status) {
  const kind = form.dataset.kind;
  const notes = form.querySelector('[name=notes]')?.value?.trim() || null;
  if (kind === 'cardio' || kind === 'recovery' || kind === 'mobility') {
    const num = (name) => {
      const v = form.querySelector(`[name=${name}]`)?.value;
      return v === '' || v == null ? null : +v;
    };
    const sets = [...form.querySelectorAll('[data-check]')].map((el) => ({
      exercise_name: el.dataset.check,
      seq: +el.dataset.seq,
      set_no: 1,
      skipped: el.checked ? 0 : 1,
    }));
    return {
      status,
      notes,
      modality: form.querySelector('[name=modality]')?.value || null,
      duration_min: num('duration_min'),
      hr_avg: num('hr_avg'),
      hr_min: num('hr_min'),
      hr_max: num('hr_max'),
      perceived_effort: num('perceived_effort'),
      sets: sets.length ? sets : undefined,
    };
  }
  const sets = [];
  let rounds = 0;
  form.querySelectorAll('.exercise').forEach((block) => {
    const name = block.dataset.name;
    const seq = +block.dataset.seq;
    const band = block.querySelector('[data-band]')?.value?.trim() || null;
    let n = 0;
    block.querySelectorAll('.set').forEach((row) => {
      n += 1;
      const reps = row.querySelector('[data-reps]');
      const seconds = row.querySelector('[data-seconds]');
      const tul = row.querySelector('[data-tul]');
      sets.push({
        exercise_name: name,
        seq,
        set_no: n,
        reps: reps && reps.value !== '' ? +reps.value : null,
        seconds: seconds && seconds.value !== '' ? +seconds.value : null,
        tul_seconds: tul && tul.value !== '' ? +tul.value : null,
        band_level: band,
        tempo_ok: row.querySelector('[data-tempo]')?.checked ? 1 : 0,
        skipped: 0,
      });
    });
    rounds = Math.max(rounds, n);
  });
  return { status, notes, sets, rounds_completed: rounds };
}
