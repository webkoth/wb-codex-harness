/**
 * Разбор произвольной таблицы себестоимости. Чистая логика без сети — её покрывают тесты.
 * Выход всегда один: строки { key, cost } + описание, какие колонки взяты.
 */
import { parseNumber } from './table.js';

export type KeyKind = 'vendorCode' | 'nmId' | 'barcode';

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s_\-.()]+/g, ' ').trim();

export const KEY_SYNONYMS: Record<KeyKind, string[]> = {
  vendorCode: ['артикул продавца', 'артикул поставщика', 'vendorcode', 'vendor code', 'sa name', 'sa', 'артикул', 'арт', 'sku продавца', 'код товара'],
  nmId: ['nmid', 'nm id', 'артикул wb', 'артикул вб', 'арт wb', 'арт вб', 'номенклатура', 'код номенклатуры', 'nm'],
  barcode: ['баркод', 'штрихкод', 'штрих код', 'barcode', 'ean', 'шк'],
};

export const COST_SYNONYMS = ['себестоимость', 'себес', 'с/с', 'сс', 'cost', 'cogs', 'закупка', 'закупочная цена', 'цена закупки', 'закуп', 'себестоимость ед', 'себестоимость за шт'];

function matches(header: unknown, synonyms: string[]): boolean {
  const h = norm(header);
  if (!h) return false;
  return synonyms.some((s) => h === norm(s) || h.startsWith(norm(s) + ' ') || h.includes(norm(s)) && norm(s).length >= 5);
}

export interface Detected {
  headerRow: number;
  headers: string[];
  keyCol?: number;
  keyKind?: KeyKind;
  costCols: number[];
  /** Если не удалось выбрать однозначно — что спросить у человека. */
  problems: string[];
}

/** Найти строку шапки и колонки. Явные --sku-col/--cost-col имеют приоритет. */
export function detectColumns(
  rows: unknown[][],
  opts: { skuCol?: string; costCol?: string; keyKind?: KeyKind } = {},
): Detected {
  const colIndex = (headers: string[], name: string) => {
    const byLetter = /^[A-Z]{1,2}$/.test(name) ? XLSXcol(name) : -1;
    if (byLetter >= 0) return byLetter;
    const i = headers.findIndex((h) => norm(h) === norm(name));
    return i;
  };

  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const headers = (rows[r] ?? []).map((h) => String(h ?? '').trim());
    const problems: string[] = [];
    let keyCol: number | undefined;
    let keyKind: KeyKind | undefined = opts.keyKind;
    let costCols: number[] = [];

    if (opts.skuCol) {
      const i = colIndex(headers, opts.skuCol);
      if (i < 0) continue;
      keyCol = i;
      if (!keyKind) keyKind = guessKindByHeader(headers[i]) ?? 'vendorCode';
    } else {
      // порядок важен: артикул продавца — основной ключ, nmID и баркод — запасные
      for (const kind of ['vendorCode', 'nmId', 'barcode'] as KeyKind[]) {
        if (keyKind && kind !== keyKind) continue;
        const cands = headers.map((h, i) => [h, i] as const).filter(([h]) => matches(h, KEY_SYNONYMS[kind]) && guessKindByHeader(h) === kind);
        if (cands.length === 1) { keyCol = cands[0][1]; keyKind = kind; break; }
        if (cands.length > 1) {
          problems.push(`Несколько колонок похожи на ключ (${kind}): ${cands.map(([h]) => `«${h}»`).join(', ')}. Укажите --sku-col.`);
          keyCol = cands[0][1]; keyKind = kind;
          break;
        }
      }
    }

    if (opts.costCol) {
      costCols = opts.costCol.split('+').map((c) => colIndex(headers, c.trim()));
      if (costCols.some((i) => i < 0)) continue;
    } else {
      costCols = headers.map((h, i) => [h, i] as const).filter(([h]) => matches(h, COST_SYNONYMS)).map(([, i]) => i);
      if (costCols.length > 1) {
        problems.push(
          `Несколько колонок похожи на себестоимость: ${costCols.map((i) => `«${headers[i]}»`).join(', ')}. ` +
            `Укажите одну (--cost-col "Себестоимость") или сумму частей (--cost-col "Закупка+Упаковка").`,
        );
      }
    }

    if (keyCol !== undefined && costCols.length > 0) {
      return { headerRow: r, headers, keyCol, keyKind, costCols, problems };
    }
  }
  return { headerRow: -1, headers: (rows[0] ?? []).map(String), costCols: [], problems: ['Не нашёл шапку с артикулом и себестоимостью. Укажите --sku-col и --cost-col (название колонки или буква: A, B, …).'] };
}

function guessKindByHeader(h: string): KeyKind | undefined {
  const n = norm(h);
  if (KEY_SYNONYMS.barcode.some((s) => n.includes(norm(s)))) return 'barcode';
  if (KEY_SYNONYMS.nmId.some((s) => n === norm(s) || n.includes(norm(s)) && norm(s).length > 2)) return 'nmId';
  if (KEY_SYNONYMS.vendorCode.some((s) => n === norm(s) || n.includes(norm(s)))) return 'vendorCode';
  return undefined;
}

function XLSXcol(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface CostRow { key: string; cost: number; row: number }

export function extractCosts(rows: unknown[][], d: Detected): { items: CostRow[]; skipped: { row: number; reason: string }[]; conflicts: string[] } {
  const items: CostRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Map<string, CostRow>();
  const conflicts: string[] = [];
  for (let r = d.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const rawKey = row[d.keyCol!];
    const key = normalizeKey(rawKey, d.keyKind!);
    if (!key) { if (row.some((c) => String(c).trim())) skipped.push({ row: r + 1, reason: 'пустой ключ' }); continue; }
    const parts = d.costCols.map((c) => parseNumber(row[c]));
    if (parts.some((p) => !Number.isFinite(p))) { skipped.push({ row: r + 1, reason: `нет числа в себестоимости («${d.costCols.map((c) => row[c]).join(' + ')}»)` }); continue; }
    const cost = parts.reduce((a, b) => a + b, 0);
    if (cost <= 0) { skipped.push({ row: r + 1, reason: `себестоимость ${cost} ≤ 0` }); continue; }
    const prev = seen.get(key);
    if (prev) {
      if (Math.abs(prev.cost - cost) > 0.005) conflicts.push(`${key}: строка ${prev.row} = ${prev.cost}, строка ${r + 1} = ${cost}`);
      continue;
    }
    const item = { key, cost, row: r + 1 };
    seen.set(key, item);
    items.push(item);
  }
  return { items, skipped, conflicts };
}

export function normalizeKey(v: unknown, kind: KeyKind): string {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(Math.round(v)) : String(v).trim();
  if (kind !== 'vendorCode') s = s.replace(/\s/g, '').replace(/\.0+$/, '');
  return s;
}
