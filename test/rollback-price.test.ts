import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalEntry } from '../mcp/wb-mcp/src/utils/logger.js';

const original: JournalEntry = { id: 'original', ts: '', tool: 'wb_update_price', entity: { type: 'product', id: 1 }, before: { nmId: 1, price: 1000, discount: 10 }, after: { nmId: 1, price: 900, discount: 5 }, ok: false, reversible: true, status: 'pending' };
function setup(t: TestContext, price = 900, discount = 5) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rollback-test-'));
  const file = join(dir, 'journal.jsonl');
  const token = process.env.WB_API_TOKEN, journal = process.env.WB_JOURNAL_PATH;
  process.env.WB_API_TOKEN = 'fake-token'; process.env.WB_JOURNAL_PATH = file;
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.includes('/api/v2/list/goods/filter')) return Response.json({ data: { listGoods: [{ nmID: 1, discount, sizes: [{ price, discountedPrice: price }] }] } });
    if (url.endsWith('/api/v2/upload/task')) { posts++; return Response.json({ error: false, data: { id: 42 } }); }
    throw new Error('Unexpected URL');
  });
  t.after(() => { if (token === undefined) delete process.env.WB_API_TOKEN; else process.env.WB_API_TOKEN = token; if (journal === undefined) delete process.env.WB_JOURNAL_PATH; else process.env.WB_JOURNAL_PATH = journal; rmSync(dir, { recursive: true, force: true }); });
  return { posts: () => posts, entries: (): JournalEntry[] => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [] };
}
async function rollback(entry: JournalEntry, entries: JournalEntry[]) {
  const { rollbackPrice } = await import('../scripts/lib/rollback-price.js');
  return rollbackPrice(entry, entries);
}
test('откат pending: несовпадающее текущее состояние блокирует запись', async t => {
  const s = setup(t, 1000, 10);
  await assert.rejects(rollback(original, [original]), /состояни/);
  assert.equal(s.posts(), 0);
});
test('откат pending: совпавшая цена при другой скидке блокирует запись', async t => {
  const s = setup(t, 900, 10);
  await assert.rejects(rollback(original, [original]), /состояни/);
  assert.equal(s.posts(), 0);
});
test('откат pending: принятый откат связан с исходной записью и остаётся pending', async t => {
  const s = setup(t);
  const result = await rollback(original, [original]);
  assert.equal(result.success, false); assert.equal(result.status, 'pending');
  assert.equal(s.entries()[0].rollbackOf, original.id); assert.equal(s.entries()[0].ok, false);
  assert.equal(s.posts(), 1);
});
const pendingRollback: JournalEntry = { ...original, id: 'rollback', rollbackOf: original.id, before: original.after, after: original.before };
test('повторный pending откат не отправляет новую запись', async t => {
  const s = setup(t);
  await assert.rejects(rollback(original, [original, pendingRollback]), /ожида|подтвержд/);
  assert.equal(s.posts(), 0); assert.equal(s.entries().length, 0);
});
test('повторный pending откат подтверждает целевое состояние один раз', async t => {
  const s = setup(t, 1000, 10);
  const result = await rollback(original, [original, pendingRollback]);
  assert.equal(result.success, true); assert.equal(s.posts(), 0);
  const entries = s.entries(); assert.equal(entries.length, 1); assert.equal(entries[0].rollbackOf, original.id); assert.equal(entries[0].ok, true);
  await assert.rejects(rollback(original, [original, pendingRollback, ...entries]), /уже/);
  assert.equal(s.entries().length, 1);
});
test('исторический успешный откат без status поддерживается', async t => {
  const s = setup(t);
  const result = await rollback({ ...original, status: undefined, ok: true }, []);
  assert.equal(result.status, 'pending'); assert.equal(s.posts(), 1);
});
