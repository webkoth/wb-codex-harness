import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTest, tick, type AbTest, type VariantStats } from '../scripts/lib/ab.js';

const z = (impressions: number, clicks = 0, opens = 0, orders = 0): VariantStats =>
  ({ impressions, clicks, opens, orders });

function run(start: AbTest, steps: VariantStats[], now = '2026-10-03'): AbTest {
  return steps.reduce((t, step) => tick(t, step, now).test, start);
}

test('до 2 000 показов фото не меняется', () => {
  const r = tick(newTest(1, '2026-10-01'), z(1500, 30), '2026-10-01');
  assert.deepEqual(r.actions, [{ type: 'hold' }]);
  assert.equal(r.test.active, 'A');
  assert.equal(r.test.stats.A.impressions, 1500);
});

test('на 2 000 показах смена на Б', () => {
  const r = tick(newTest(1, '2026-10-01'), z(2000, 40), '2026-10-01');
  assert.equal(r.actions.some((a) => a.type === 'switch' && a.to === 'B'), true);
  assert.equal(r.test.active, 'B');
  assert.equal(r.test.turns.B, 1);
  assert.equal(r.test.status, 'running');
});

test('большой пакет показов режется по 2 000', () => {
  const r = tick(newTest(1, '2026-10-01'), z(5000, 100), '2026-10-01');
  assert.equal(r.test.stats.A.impressions, 3000);
  assert.equal(r.test.stats.B.impressions, 2000);
  assert.equal(r.test.stats.A.clicks + r.test.stats.B.clicks, 100);
  assert.equal(r.test.active, 'A');
});

test('Б побеждает, когда CTR выше и заказы на переход не ниже', () => {
  const a = z(2000, 40, 100, 5);
  const b = z(2000, 60, 100, 5);
  const t = run(newTest(7, '2026-10-01'), [a, b, a, b, a, b, a, b, a, b]);
  assert.equal(t.stats.A.impressions, 10_000);
  assert.equal(t.stats.B.impressions, 10_000);
  assert.equal(t.status, 'winner_b');
  assert.equal(t.active, 'B');
});

test('высокий CTR при просевших заказах откатывает на А', () => {
  const a = z(2000, 20, 100, 10);
  const b = z(2000, 80, 100, 2);
  const t = run(newTest(7, '2026-10-01'), [a, b, a, b, a, b, a, b, a, b]);
  assert.equal(t.status, 'rolled_back');
  assert.equal(t.active, 'A');
});

test('на 7-й день без выборки остаётся А', () => {
  const r = tick(newTest(3, '2026-10-01'), z(500, 10, 10, 1), '2026-10-08');
  assert.equal(r.test.status, 'inconclusive');
  assert.match(r.test.reason!, /остаётся А/);
});
