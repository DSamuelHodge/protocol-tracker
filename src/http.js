import { DAY_RE } from './lib/dates.js';

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
export const bad = (msg) => new HttpError(400, msg);
export function validDay(d) {
  if (!DAY_RE.test(d || '')) throw bad('day must be YYYY-MM-DD');
  return d;
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });
}
