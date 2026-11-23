export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Display a calendar date. Navigation itself uses the dates returned by the API. */
export function label(day, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function clock(ts, tz) {
  if (ts == null) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(ts * 1000));
}

export function ago(ts) {
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  if (m < 90) return `${Math.max(m, 0)} min ago`;
  if (m < 60 * 36) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
