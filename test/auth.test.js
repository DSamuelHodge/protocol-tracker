import assert from 'node:assert/strict';
import test from 'node:test';
import { publicWithingsStatus, readCookie, tokensEqual } from '../src/lib/auth.js';
import { cleanSource, glucoseBinds, glucoseInsertSql } from '../src/lib/sql.js';
import { validateSettings, DEFAULTS } from '../src/lib/settings.js';

test('token compare hashes both sides', async () => {
  assert.equal(await tokensEqual('devtoken', 'devtoken'), true);
  assert.equal(await tokensEqual('devtoken', 'devtoken '), false);
  assert.equal(await tokensEqual('', 'devtoken'), false);
  assert.equal(await tokensEqual('short', 'a-much-longer-token-value'), false);
});

test('cookie reader and withings status omit the userid', () => {
  assert.equal(readCookie('a=1; pt_session=abc%2B; b=2', 'pt_session'), 'abc+');
  const status = publicWithingsStatus({ userid: 'should-not-leak', updated_at: 1 }, 2);
  assert.deepEqual(status, { connected: true, last_sync: 2 });
  assert.equal('userid' in status, false);
  assert.deepEqual(publicWithingsStatus(null, null), { connected: false, last_sync: null });
});

test('glucose source is bound, not interpolated', () => {
  const nasty = "import'); DROP TABLE glucose;--";
  const source = cleanSource(nasty);
  const sql = glucoseInsertSql(2);
  assert.equal(sql.includes(nasty), false);
  assert.match(sql, /\(\?, \?, \?\),\s*\(\?, \?, \?\)/);
  assert.deepEqual(glucoseBinds([[1, 90], [2, 100]], nasty), [1, 90, source, 2, 100, source]);
  assert.equal(source.includes("'"), false);
});

test('settings accept the new protocol fields and reject a bad date', () => {
  const ok = validateSettings({
    sleep_hours: 7.5, steps_goal: 10000, kcal_low: 2100, program_start: '2026-11-24',
    show_glucose: false, active_habits: DEFAULTS.active_habits, typical_bedtime: '22:30',
  });
  assert.equal(ok.error, undefined);
  assert.equal(ok.values.steps_goal, 10000);
  assert.equal(validateSettings({ program_start: '11/24/2026' }).error.includes('program_start'), true);
  assert.equal(validateSettings({ active_habits: ['nope'] }).error.includes('active_habits'), true);
});
