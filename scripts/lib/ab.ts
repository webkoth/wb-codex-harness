/**
 * Ротация двух главных фото. Чистая логика, без API.
 * Смена каждые 2 000 рекламных показов, минимум два выхода каждого фото.
 * Решение — когда у каждого 10 000 показов, либо на 7-й день.
 * Победитель Б: CTR строго выше и заказы на 1 000 переходов не ниже.
 */
export const SWITCH_EVERY = 2_000;
export const DECIDE_AT = 10_000;
export const MAX_DAYS = 7;
export const MIN_TURNS = 2;

export type Variant = 'A' | 'B';
export type AbStatus = 'running' | 'winner_b' | 'kept_a' | 'rolled_back' | 'inconclusive';

export interface VariantStats {
  impressions: number;
  clicks: number;
  opens: number;
  orders: number;
}

export interface AbTest {
  nmId: number;
  startedAt: string;
  status: AbStatus;
  active: Variant;
  turns: Record<Variant, number>;
  stintImpressions: number;
  stats: Record<Variant, VariantStats>;
  reason?: string;
}

export type AbAction =
  | { type: 'hold' }
  | { type: 'switch'; to: Variant }
  | { type: 'finish'; outcome: Exclude<AbStatus, 'running'>; reason: string };

const empty = (): VariantStats => ({ impressions: 0, clicks: 0, opens: 0, orders: 0 });

export function newTest(nmId: number, startedAt: string): AbTest {
  return {
    nmId,
    startedAt,
    status: 'running',
    active: 'A',
    turns: { A: 1, B: 0 },
    stintImpressions: 0,
    stats: { A: empty(), B: empty() },
  };
}

export function ctr(s: VariantStats): number {
  return s.impressions > 0 ? s.clicks / s.impressions : 0;
}

export function ordersPer1000Opens(s: VariantStats): number | null {
  return s.opens > 0 ? (s.orders / s.opens) * 1000 : null;
}

export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms)) throw new Error(`Не дата: ${from} … ${to}`);
  return Math.floor(ms / 86_400_000);
}

function other(v: Variant): Variant {
  return v === 'A' ? 'B' : 'A';
}

function sampleReady(t: AbTest): boolean {
  return t.stats.A.impressions >= DECIDE_AT
    && t.stats.B.impressions >= DECIDE_AT
    && t.turns.A >= MIN_TURNS
    && t.turns.B >= MIN_TURNS;
}

export function decide(t: AbTest): { outcome: Exclude<AbStatus, 'running'>; reason: string } {
  const a = t.stats.A;
  const b = t.stats.B;
  const ctrA = ctr(a);
  const ctrB = ctr(b);
  const ordA = ordersPer1000Opens(a);
  const ordB = ordersPer1000Opens(b);
  const pct = (x: number) => `${(x * 100).toFixed(2)} %`;
  if (ctrB > ctrA && ordA !== null && ordB !== null && ordB >= ordA) {
    return {
      outcome: 'winner_b',
      reason: `CTR Б ${pct(ctrB)} выше А ${pct(ctrA)}, заказы на 1 000 переходов ${ordB.toFixed(1)} не ниже ${ordA.toFixed(1)}`,
    };
  }
  if (ctrB > ctrA) {
    return {
      outcome: 'rolled_back',
      reason: `CTR Б выше (${pct(ctrB)} против ${pct(ctrA)}), заказы на переход просели или их не с чем сравнить — остаётся А`,
    };
  }
  return {
    outcome: 'kept_a',
    reason: `CTR Б ${pct(ctrB)} не выше А ${pct(ctrA)} — остаётся А`,
  };
}

function finish(t: AbTest, outcome: Exclude<AbStatus, 'running'>, reason: string): AbTest {
  return { ...t, status: outcome, reason, active: outcome === 'winner_b' ? 'B' : 'A' };
}

export function tick(test: AbTest, delta: VariantStats, now: string): { test: AbTest; actions: AbAction[] } {
  if (test.status !== 'running') return { test, actions: [{ type: 'hold' }] };
  const day = daysBetween(test.startedAt, now);
  let t: AbTest = {
    ...test,
    turns: { ...test.turns },
    stats: { A: { ...test.stats.A }, B: { ...test.stats.B } },
  };
  const actions: AbAction[] = [];
  let left = { ...delta };

  const conclude = (forced: boolean): boolean => {
    if (sampleReady(t)) {
      const d = decide(t);
      t = finish(t, d.outcome, d.reason);
      actions.push({ type: 'finish', outcome: d.outcome, reason: d.reason });
      return true;
    }
    if (forced || day >= MAX_DAYS) {
      const reason = `7 дней, выборки нет (показы А ${t.stats.A.impressions}, Б ${t.stats.B.impressions}) — остаётся А`;
      t = finish(t, 'inconclusive', reason);
      actions.push({ type: 'finish', outcome: 'inconclusive', reason });
      return true;
    }
    return false;
  };

  if (day >= MAX_DAYS && left.impressions <= 0) {
    conclude(true);
    return { test: t, actions };
  }

  while (left.impressions > 0 && t.status === 'running') {
    const room = SWITCH_EVERY - t.stintImpressions;
    const take = Math.min(room, left.impressions);
    const frac = take / left.impressions;
    const part = (n: number) => Math.min(n, Math.round(n * frac));
    const slice: VariantStats = {
      impressions: take,
      clicks: part(left.clicks),
      opens: part(left.opens),
      orders: part(left.orders),
    };
    const s = t.stats[t.active];
    t.stats[t.active] = {
      impressions: s.impressions + slice.impressions,
      clicks: s.clicks + slice.clicks,
      opens: s.opens + slice.opens,
      orders: s.orders + slice.orders,
    };
    t.stintImpressions += take;
    left = {
      impressions: left.impressions - take,
      clicks: left.clicks - slice.clicks,
      opens: left.opens - slice.opens,
      orders: left.orders - slice.orders,
    };
    if (conclude(false)) break;
    if (t.stintImpressions >= SWITCH_EVERY) {
      const to = other(t.active);
      t = { ...t, active: to, stintImpressions: 0, turns: { ...t.turns, [to]: t.turns[to] + 1 } };
      actions.push({ type: 'switch', to });
    }
  }
  if (t.status === 'running' && day >= MAX_DAYS) conclude(true);
  if (!actions.length) actions.push({ type: 'hold' });
  return { test: t, actions };
}
