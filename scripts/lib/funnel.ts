/**
 * Где карточка теряет деньги. Чистая логика — покрыта тестами.
 * База — медиана своего магазина (бенчмарков по категориям в открытых источниках нет).
 * Потеря этапа = трафик этапа × (конверсия медианы − конверсия карточки) × дальнейшие конверсии × прибыль на выкуп.
 */
export interface FunnelCard {
  nmId: number; vendorCode: string; title: string;
  open: number; cart: number; orders: number; buyouts: number; orderSum: number;
  cartPct: number; orderPct: number; buyoutPct: number;
  profitPerBuyout?: number;
}

export type Stage = 'карточка → корзина' | 'корзина → заказ' | 'заказ → выкуп';

export interface Diagnosis extends FunnelCard {
  lossCart: number; lossOrder: number; lossBuyout: number;
  weakest?: Stage; loss: number; valueBasis: 'прибыль' | 'выручка';
  note?: string;
}

const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function medians(cards: FunnelCard[], minOpen = 50) {
  const base = cards.filter((c) => c.open >= minOpen);
  return {
    cartPct: median(base.map((c) => c.cartPct)),
    orderPct: median(base.filter((c) => c.cart > 0).map((c) => c.orderPct)),
    buyoutPct: median(base.filter((c) => c.orders > 0 && c.buyoutPct > 0).map((c) => c.buyoutPct)),
    n: base.length,
  };
}

export function diagnose(cards: FunnelCard[], minOpen = 50): { rows: Diagnosis[]; med: ReturnType<typeof medians> } {
  const med = medians(cards, minOpen);
  const rows = cards.map((c): Diagnosis => {
    const avgCheck = c.orders ? c.orderSum / c.orders : 0;
    const value = c.profitPerBuyout ?? avgCheck;
    const basis: Diagnosis['valueBasis'] = c.profitPerBuyout !== undefined ? 'прибыль' : 'выручка';
    const orderPct = (c.cart > 0 ? c.orderPct : med.orderPct) / 100;
    const buyPct = (c.buyoutPct > 0 ? c.buyoutPct : med.buyoutPct) / 100;
    const gap = (m: number, x: number) => Math.max(0, m - x) / 100;
    const lossCart = c.open * gap(med.cartPct, c.cartPct) * orderPct * buyPct * value;
    const lossOrder = c.cart * gap(med.orderPct, c.orderPct) * buyPct * value;
    const lossBuyout = c.buyoutPct > 0 ? c.orders * gap(med.buyoutPct, c.buyoutPct) * value : 0;
    const stages: [Stage, number][] = [['карточка → корзина', lossCart], ['корзина → заказ', lossOrder], ['заказ → выкуп', lossBuyout]];
    stages.sort((a, b) => b[1] - a[1]);
    const d: Diagnosis = { ...c, lossCart, lossOrder, lossBuyout, loss: Math.max(0, stages[0][1]), weakest: stages[0][1] > 0 ? stages[0][0] : undefined, valueBasis: basis };
    if (c.open < minOpen) d.note = `мало переходов (${c.open} < ${minOpen}) — выводы ненадёжны`;
    if (c.profitPerBuyout !== undefined && c.profitPerBuyout <= 0) {
      d.note = 'прибыль на выкуп ≤ 0 — не разгонять воронку, сначала экономика (цена/себестоимость/логистика)';
      d.loss = 0;
    }
    return d;
  });
  rows.sort((a, b) => b.loss - a.loss);
  return { rows, med };
}
