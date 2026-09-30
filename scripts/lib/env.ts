/**
 * Корень репозитория, .env и токен WB для скриптов.
 * MCP-сервер читает тот же .env сам (mcp/wb-mcp/src/utils/auth.ts).
 */
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
config({ path: join(ROOT, '.env'), quiet: true });

export const DATA = join(ROOT, 'data');
export const REPORTS = join(ROOT, 'reports');
export const DRAFTS = join(ROOT, 'drafts');
export const CACHE = join(DATA, 'cache');

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function wbToken(): string {
  const t = (process.env.WB_API_TOKEN || '').replace(/^["']|["']$/g, '').trim();
  if (!t) {
    throw new Error('Нет WB_API_TOKEN. Скопируйте .env.example в .env и вставьте токен (Настройки → Доступ к API).');
  }
  return t;
}

/** Разбор JWT токена WB без проверки подписи: срок, категории, «только чтение». */
export function describeToken(token: string): { exp?: Date; readOnly?: boolean; scopeBits?: number } {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const s = typeof payload.s === 'number' ? payload.s : undefined;
    return {
      exp: payload.exp ? new Date(payload.exp * 1000) : undefined,
      scopeBits: s,
      // бит 30 поля s — токен «только на чтение» (dev.wildberries.ru/openapi/api-information)
      readOnly: s !== undefined ? Boolean(s & (1 << 30)) : undefined,
    };
  } catch {
    return {};
  }
}
