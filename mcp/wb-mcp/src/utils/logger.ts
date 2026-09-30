import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

export type Marketplace = 'wb' | 'ozon' | 'ym';

export interface LogParams {
  marketplace: Marketplace;
  domain: string;
  action: string;
  toolName: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  success: boolean;
  confirmedBy?: string;
  previewShown?: Record<string, unknown>;
}

/**
 * Log a tool operation.
 *
 * Ранее писало в Postgres (operations_log). БД выведена из проекта,
 * поэтому read-логирование — no-op, а ошибки уходят в stderr (виден в логах MCP).
 * Сигнатуры функций сохранены, чтобы не трогать места вызова в инструментах.
 */
export async function log(_params: LogParams): Promise<void> {
  // no-op
}

/**
 * Log a successful read operation
 */
export async function logRead(
  _toolName: string,
  _domain: string,
  _params?: Record<string, unknown>,
  _result?: Record<string, unknown>
): Promise<void> {
  // no-op
}

/**
 * Log a write operation with preview
 */
export async function logWriteWithPreview(
  _toolName: string,
  _domain: string,
  _params: Record<string, unknown>,
  _preview: Record<string, unknown>
): Promise<void> {
  // no-op
}

/**
 * Журнал изменений в кабинете: data/changes.jsonl в корне репозитория.
 * Одна строка — одна запись в WB (успешная или нет). По полю before
 * scripts/rollback.ts возвращает прежнее состояние.
 */
export interface JournalEntry {
  id: string;
  ts: string;
  tool: string;
  entity: { type: string; id: string | number };
  before: unknown;
  after: unknown;
  response?: unknown;
  ok: boolean;
  reversible: boolean;
  error?: string;
  rollbackOf?: string;
}

// Корень репозитория: 4 уровня вверх от dist/utils (или src/utils под tsx) — как в utils/auth.ts
const projectRoot = join(dirname(import.meta.url.replace('file://', '')), '../../../../');

export function journalPath(): string {
  return process.env.WB_JOURNAL_PATH || join(projectRoot, 'data', 'changes.jsonl');
}

/**
 * Записать строку журнала. Ошибка записи журнала не роняет операцию,
 * но уходит в stderr (stdout занят протоколом MCP).
 */
export function journalWrite(
  entry: Omit<JournalEntry, 'id' | 'ts'> & { id?: string; ts?: string }
): JournalEntry {
  const full: JournalEntry = {
    id: entry.id || `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`,
    ts: entry.ts || new Date().toISOString(),
    ...entry,
  } as JournalEntry;
  try {
    const file = journalPath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(full) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[journal] не удалось записать ${full.tool}: ${(err as Error).message}`);
  }
  return full;
}

/**
 * Log a confirmed write operation.
 * Общий случай: БЫЛО/СТАЛО берём из preview. Инструменты, которым нужен
 * точный откат, пишут журнал сами через journalWrite.
 */
export async function logWriteConfirmed(
  toolName: string,
  domain: string,
  params: Record<string, unknown>,
  result: Record<string, unknown>,
  preview: Record<string, unknown>
): Promise<void> {
  journalWrite({
    tool: toolName,
    entity: { type: domain, id: String(params.id ?? params.supplyId ?? params.nmId ?? params.campaignId ?? '') },
    before: preview,
    after: params,
    response: result,
    ok: true,
    reversible: false,
  });
}

/**
 * Log an error (to stderr — safe for stdio MCP transport)
 */
export async function logError(
  toolName: string,
  domain: string,
  _params: Record<string, unknown>,
  error: Error
): Promise<void> {
  console.error(`[${domain}] ${toolName} failed: ${error.message}`);
}
