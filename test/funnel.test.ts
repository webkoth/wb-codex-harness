import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, type FunnelCard } from '../scripts/lib/funnel.js';

const card = (nmId: number, open: number, cartPct: number, orderPct: number, buyoutPct: number, profitPerBuyout?: number): FunnelCard => {
  const cart = Math.round((open * cartPct) / 100);
  const orders = Math.round((cart * orderPct) / 100);
  return { nmId, vendorCode: `A${nmId}`, title: '', open, cart, orders, buyouts: Math.round((orders * buyoutPct) / 100), orderSum: orders * 3000, cartPct, orderPct, buyoutPct, profitPerBuyout };
};

test('слабый этап и потеря в прибыли относительно медианы магазина', () => {
  const cards = [card(1, 1000, 10, 40, 80, 1000), card(2, 1000, 10, 40, 80, 1000), card(3, 1000, 5, 40, 80, 1000)];
  const { rows, med } = diagnose(cards);
  assert.equal(med.cartPct, 10);
  const worst = rows[0];
  assert.equal(worst.nmId, 3);
  assert.equal(worst.weakest, 'карточка → корзина');
  // 1000 переходов × 5 п.п. × 40% × 80% × 1000 ₽ = 16 000 ₽
  assert.equal(Math.round(worst.loss), 16000);
  assert.equal(worst.valueBasis, 'прибыль');
});

test('убыточную карточку не разгоняем', () => {
  const cards = [card(1, 1000, 10, 40, 80, 500), card(2, 1000, 10, 40, 80, 500), card(3, 1000, 5, 40, 80, -200)];
  const r = diagnose(cards).rows.find((x) => x.nmId === 3)!;
  assert.equal(r.loss, 0);
  assert.match(r.note!, /не разгонять/);
});

test('без прибыли — потери в выручке, подписано', () => {
  const r = diagnose([card(1, 500, 10, 40, 80), card(2, 500, 6, 40, 80)]).rows[0];
  assert.equal(r.valueBasis, 'выручка');
});
