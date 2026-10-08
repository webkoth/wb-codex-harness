import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominantPattern, reviewPlan, type CardPlan } from '../scripts/lib/card-plan.js';

const plan = (patch: Partial<CardPlan> = {}): CardPlan => ({
  nmId: 1,
  photoHypothesis: 'Крупнее на светлом фоне, как у лидеров запроса',
  edit: 'крупность',
  title: 'Браслет с метеоритом серебро',
  description: 'Браслет из серебра с вставкой из метеорита. Застёжка карабин.',
  characteristics: [{ name: 'Материал', value: 'серебро', source: 'card' }],
  competitors: [{ query: 'браслет', position: 1, pattern: 'предметка' }],
  ...patch,
});

test('годный черновик проходит', () => {
  assert.equal(reviewPlan(plan()).ok, true);
});

test('длинное название и маркетинговое слово не проходят', () => {
  const r = reviewPlan(plan({ title: 'Лучший браслет №1 / серебро хипстерский очень длинное название товара' }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
});

test('характеристику без источника карточки или человека нельзя', () => {
  const bad = plan();
  (bad.characteristics[0] as { source: string }).source = 'model';
  const r = reviewPlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /источник/);
});

test('правку фото без топа выдачи выбирать нельзя', () => {
  const r = reviewPlan(plan({ edit: 'крупность', competitors: [] }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /без топа выдачи/);
});

test('приём лидеров — тот, что встречается чаще, ничья даёт предметку', () => {
  assert.equal(dominantPattern([
    { query: 'браслет', position: 1, pattern: 'на человеке' },
    { query: 'браслет', position: 2, pattern: 'на человеке' },
    { query: 'браслет', position: 3, pattern: 'предметка' },
  ]), 'на человеке');
  assert.equal(dominantPattern([
    { query: 'кулон', position: 1, pattern: 'сцена' },
    { query: 'кулон', position: 2, pattern: 'предметка' },
  ]), 'предметка');
});
