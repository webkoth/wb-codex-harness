/**
 * HTTP-клиент WB для скриптов: 429 с ожиданием по X-Ratelimit-Retry, повтор 5xx, кеш ответов.
 * Лимиты WB считаются на аккаунт продавца: детализация — 1 запрос в минуту,
 * fullstats — 3 в минуту, платное хранение — 1 задание в минуту.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, ensureDir, wbToken } from './env.js';

export const WB = {
  content: 'https://content-api.wildberries.ru',
  statistics: 'https://statistics-api.wildberries.ru',
  prices: 'https://discounts-prices-api.wildberries.ru',
  advert: 'https://advert-api.wildberries.ru',
  analytics: 'https://seller-analytics-api.wildberries.ru',
  finance: 'https://finance-api.wildberries.ru',
  common: 'https://common-api.wildberries.ru',
  feedbacks: 'https://feedbacks-api.wildberries.ru',
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WbRequest {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Сколько раз ждать и повторять на 429/5xx. */
  retries?: number;
  /** Не ждать дольше этого на один 429, секунд. */
  maxWaitSec?: number;
}

export class WbError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function wbFetch<T = unknown>(url: string, req: WbRequest = {}): Promise<T | null> {
  const retries = req.retries ?? 3;
  const maxWait = req.maxWaitSec ?? 75;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: req.method ?? (req.body ? 'POST' : 'GET'),
      headers: { Authorization: wbToken(), 'Content-Type': 'application/json' },
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
    if (res.status === 204) return null;
    if (res.ok) {
      const text = await res.text();
      return text.trim() ? (JSON.parse(text) as T) : null;
    }
    const text = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt >= retries) {
      throw new WbError(res.status, `WB ${res.status} ${url.replace(/\?.*/, '')}: ${text.slice(0, 300)}`);
    }
    const retry = Number(res.headers.get('X-Ratelimit-Retry') || '');
    const wait = Math.min(maxWait, Number.isFinite(retry) && retry > 0 ? retry : 5 * (attempt + 1));
    process.stderr.write(`  WB ${res.status}, жду ${wait} с (попытка ${attempt + 1}/${retries})\n`);
    await sleep(wait * 1000);
  }
}

/**
 * Кеш ответа на диске. Закрытые периоды WB не меняются, поэтому повторный расчёт
 * за тот же период идёт без запросов. `fresh` — игнорировать кеш.
 */
export async function cached<T>(key: unknown, fresh: boolean, fn: () => Promise<T>): Promise<T> {
  const name = createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16);
  const file = join(ensureDir(CACHE), `${name}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const value = await fn();
  writeFileSync(file, JSON.stringify(value));
  return value;
}

export { sleep };
