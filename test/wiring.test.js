import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the client does not keep a second copy of the habit list or date shifting', () => {
  const app = read('public/js/app.js');
  assert.equal(app.includes('shiftDay'), false);
  assert.equal(app.includes('HABIT_ORDER'), false);
  assert.equal(app.includes('function addDays'), false);
  assert.equal(fs.existsSync(new URL('../public/app.js', import.meta.url)), false);
});

test('writes and the sync use the tested SQL, and the status route does not select a userid', () => {
  assert.match(read('src/writes.js'), /MANUAL_WEIGHT_UPSERT/);
  assert.match(read('src/writes.js'), /glucoseInsertSql/);
  assert.match(read('src/withings.js'), /SLEEP_HABIT_UPSERT/);
  assert.match(read('src/withings.js'), /WITHINGS_WEIGHT_UPSERT/);
  assert.match(read('src/withings.js'), /remsleepduration/);
  assert.match(read('src/withings.js'), /publicWithingsStatus/);
  assert.doesNotMatch(read('src/worker.js'), /userid/);
});

test('the README does not publish the workers.dev host', () => {
  const readme = read('README.md');
  assert.doesNotMatch(readme, /workers\.dev/i);
  assert.match(readme, /backup\/pre-lit-reorg/);
  assert.match(readme, /d1 export/);
  assert.match(readme, /time-travel/);
  assert.match(readme, /migrations apply/);
});
