import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeProfit } from '../scripts/lib/profit.js';

const { rows } = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'realization.json'), 'utf8'));
const vendors = [...new Set(rows.map((r: any) => r.vendorCode).filter(Boolean))] as string[];
const costs = new Map(vendors.map((v, i) => [v, 1000 + i * 100]));

test('сверка: выплата по строкам = по артикулам + не распределено', () => {
  const r = computeProfit({ rows, costs });
  assert.ok(Math.abs(r.totals.payout - r.totals.payoutCheck) < 0.01, `${r.totals.payout} vs ${r.totals.payoutCheck}`);
  assert.equal(r.missingCost.length, 0);
});

test('удержание «Продвижение» не попадает в артикулы', () => {
  const r = computeProfit({ rows, costs });
  const promo = r.unallocated.find((u) => u.label.startsWith('Реклама «ВБ.Продвижение»'));
  assert.ok(promo && promo.amount < 0);
  assert.ok(Math.abs(-promo.amount - r.totals.promotionInReport) < 0.01);
});

test('нет себестоимости у проданного → стоп-список', () => {
  const soldOne = computeProfit({ rows, costs }).skus.find((s) => s.netUnits > 0)!;
  const partial = new Map([...costs].filter(([k]) => k !== soldOne.vendorCode));
  const r = computeProfit({ rows, costs: partial });
  assert.ok(r.missingCost.some((m) => m.vendorCode === soldOne.vendorCode));
  const sold = r.skus.filter((s) => s.netUnits !== 0 && !partial.has(s.vendorCode));
  assert.equal(r.missingCost.length, sold.length);
});

test('с рекламой fullstats: Σ артикулов + не распределено (без удержания рекламы) = итог', () => {
  const sold = computeProfit({ rows, costs }).skus.filter((s) => s.netUnits > 0);
  const ads = new Map<number, number>([[sold[0].nmId, 5000], [999999, 700]]);
  const r = computeProfit({ rows, costs, adsByNm: ads });
  const skuSum = r.skus.reduce((a, s) => a + s.profit, 0);
  const rest = r.unallocated.filter((u) => !u.label.startsWith('Реклама «ВБ.Продвижение»')).reduce((a, u) => a + u.amount, 0);
  assert.ok(Math.abs(skuSum + rest - r.totals.profit) < 0.01, `${skuSum + rest} vs ${r.totals.profit}`);
  assert.equal(r.totals.adsFullstats, 5700);
  assert.equal(r.skus.find((s) => s.nmId === sold[0].nmId)!.ads, 5000);
});

test('хранение по отчёту paid_storage раскладывается и не теряется', () => {
  const withStorage = rows.concat([{ nmId: 0, vendorCode: '', docTypeName: '', sellerOperName: 'Хранение', paidStorage: '300' }]);
  const sold = computeProfit({ rows, costs }).skus.slice(0, 2);
  const r = computeProfit({ rows: withStorage, costs, storageByNm: new Map([[sold[0].nmId, 1], [sold[1].nmId, 2]]) });
  const st = r.skus.reduce((a, s) => a + s.storage, 0);
  assert.ok(Math.abs(st - 300) < 0.01);
  assert.ok(Math.abs(r.totals.payout - r.totals.payoutCheck) < 0.01);
});

test('прибыль на заказ и потолок CPO из доли выкупа', () => {
  const base = computeProfit({ rows, costs });
  const s0 = base.skus.find((s) => s.netUnits > 0)!;
  const r = computeProfit({ rows, costs, funnelByNm: new Map([[s0.nmId, { orders: 10, buyouts: 8 }]]) });
  const s = r.skus.find((x) => x.nmId === s0.nmId)!;
  assert.equal(s.buyoutRate, 0.8);
  assert.ok(Math.abs(s.profitPerOrder! - s.profitPerUnit * 0.8) < 0.01);
});
