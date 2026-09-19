import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('all six scenes average about 2.5 driven miles, with each discovery near its editable target across seeds', () => {
  const totals = new Map();
  let miles = 0;
  for (const seed of [4817, 12345, 8675309, 42, 2026]) {
    const result = spawnSync(process.execPath, ['scripts/discovery-frequency.mjs', '1000', '--json'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, TEST_WORLD_SEED: String(seed) }, encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const sample = JSON.parse(result.stdout);
    miles += sample.drivenMiles;
    for (const row of sample.rows) {
      const key = `${row.scene}: ${row.discovery}`;
      const total = totals.get(key) ?? { target: row.target, count: 0, overall: row.discovery.startsWith('ANY') };
      total.count += row.count;
      totals.set(key, total);
      if (total.overall) assert.ok(row['average miles'] > 2.1 && row['average miles'] < 3,
        `${key}, seed ${seed}: ${row['average miles']} miles`);
    }
  }
  assert.equal(totals.size, 25, 'all 19 special discovery types and all six scene totals are measured');
  for (const [key, { count, target, overall }] of totals) {
    const actual = miles / count;
    if (overall) assert.ok(actual > 2.25 && actual < 2.8, `${key}: ${actual} miles`);
    else assert.ok(actual > target * .75 && actual < target * 1.25, `${key}: ${actual} miles, target ${target}`);
  }
});
