import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updatePrice, formatUpdateResult } from '../mcp/wb-mcp/src/tools/prices.js';

type Scenario = {
  upload?: unknown;
  uploadStatus?: number;
  uploadError?: boolean;
  applied?: boolean;
  readError?: boolean;
  readApiError?: boolean;
  readDiscount?: number;
};

function setup(t: TestContext, scenario: Scenario = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-price-test-'));
  const file = join(dir, 'journal.jsonl');
  const previousToken = process.env.WB_API_TOKEN;
  const previousJournal = process.env.WB_JOURNAL_PATH;
  process.env.WB_API_TOKEN = 'test-token-not-a-real-credential';
  process.env.WB_JOURNAL_PATH = file;
  let posts = 0;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    if (url.includes('/api/v2/list/goods/filter')) {
      reads++;
      if (reads > 1 && scenario.readError) throw new Error('readback unavailable');
      if (reads > 1 && scenario.readApiError) return Response.json({ error: true, errorText: 'Read rejected' });
      const price = reads > 1 && scenario.applied ? 900 : 1000;
      return Response.json({ data: { listGoods: [{ nmID: 1, discount: reads > 1 ? scenario.readDiscount ?? 0 : 0, sizes: [{ price, discountedPrice: price }] }] } });
    }
    if (url.endsWith('/api/v2/upload/task')) {
      assert.equal(options?.method, 'POST');
      posts++;
      if (scenario.uploadError) throw new Error('connection lost');
      return Response.json(scenario.upload ?? { data: { id: 42 }, error: false, errorText: '' }, { status: scenario.uploadStatus ?? 200 });
    }
    throw new Error(`Unexpected HTTP blocked: ${url}`);
  });
  t.mock.method(console, 'error', () => {});
  t.after(() => {
    if (previousToken === undefined) delete process.env.WB_API_TOKEN;
    else process.env.WB_API_TOKEN = previousToken;
    if (previousJournal === undefined) delete process.env.WB_JOURNAL_PATH;
    else process.env.WB_JOURNAL_PATH = previousJournal;
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    posts: () => posts,
    entries: (): Array<Record<string, unknown>> => existsSync(file)
      ? readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [],
  };
}

test('цена: preview не отправляет запрос записи и не создаёт запись журнала', async (t) => {
  const state = setup(t);
  const result = await updatePrice({ nmId: 1, price: 900, confirm: false });
  assert.equal(result.confirmed, false);
  assert.equal(state.posts(), 0);
  assert.deepEqual(state.entries(), []);
});

test('цена: error:true при HTTP 200 отклоняется и не помечается успешным', async (t) => {
  const state = setup(t, { upload: { error: true, errorText: 'Synthetic rejection', data: null } });
  await assert.rejects(updatePrice({ nmId: 1, price: 900, confirm: true }), /Synthetic rejection/);
  const [entry] = state.entries();
  assert.equal(entry.ok, false);
  assert.equal(entry.status, 'rejected');
  assert.equal(entry.reversible, false);
  assert.equal(state.posts(), 1);
});

test('цена: принятие задачи без изменения цены остаётся pending', async (t) => {
  const state = setup(t);
  const result = await updatePrice({ nmId: 1, price: 900, confirm: true });
  assert.ok(result.confirmed);
  assert.equal(result.result.success, false);
  assert.equal('status' in result.result && result.result.status, 'pending');
  assert.equal('taskId' in result.result && result.result.taskId, 42);
  assert.doesNotMatch(formatUpdateResult(result), /успешно обновлена/);
  assert.equal(state.entries()[0].ok, false);
  assert.equal(state.entries()[0].status, 'pending');
});

test('цена: повторное чтение подтверждает цену и сохраняет applied', async (t) => {
  const state = setup(t, { applied: true });
  const result = await updatePrice({ nmId: 1, price: 900, confirm: true });
  assert.ok(result.confirmed);
  assert.equal(result.result.success, true);
  assert.equal('status' in result.result && result.result.status, 'applied');
  assert.equal(state.entries()[0].status, 'applied');
  assert.equal(state.entries()[0].ok, true);
  assert.equal(state.posts(), 1);
});

for (const scenario of [{ readError: true }, { readApiError: true }]) {
  test(`цена: ошибка повторного чтения сохраняет pending (${JSON.stringify(scenario)})`, async (t) => {
    const state = setup(t, scenario);
    const result = await updatePrice({ nmId: 1, price: 900, confirm: true });
    assert.ok(result.confirmed);
    assert.equal(result.result.success, false);
    assert.equal('status' in result.result && result.result.status, 'pending');
    assert.equal(state.entries()[0].status, 'pending');
    assert.equal(state.posts(), 1);
  });
}

test('цена: потеря соединения при записи сохраняет неизвестный исход без повтора', async (t) => {
  const state = setup(t, { uploadError: true });
  await assert.rejects(updatePrice({ nmId: 1, price: 900, confirm: true }), /connection lost/);
  assert.equal(state.entries()[0].status, 'unknown');
  assert.equal(state.entries()[0].ok, false);
  assert.equal(state.posts(), 1);
});

test('цена: некорректный ответ записи не превращается в подтверждённый успех', async (t) => {
  const state = setup(t, { upload: {} });
  await assert.rejects(updatePrice({ nmId: 1, price: 900, confirm: true }));
  assert.equal(state.entries()[0].status, 'unknown');
  assert.equal(state.entries()[0].ok, false);
});

for (const upload of [{ error: false, data: { id: -1 } }, { error: false, data: { id: 1.5 } }]) {
  test(`цена: некорректный taskId ${upload.data.id} означает unknown`, async t => {
    const state = setup(t, { upload });
    await assert.rejects(updatePrice({ nmId: 1, price: 900, confirm: true }), /неизвестен/);
    assert.equal(state.entries()[0].status, 'unknown');
  });
}
test('цена: ошибка сети сообщает unknown и ID журнала', async t => {
  const state = setup(t, { uploadError: true });
  await assert.rejects(updatePrice({ nmId: 1, price: 900, confirm: true }), error => {
    assert.match(String(error), /connection lost/); assert.match(String(error), /неизвестен/);
    assert.ok(String(error).includes(String(state.entries()[0].id))); return true;
  });
});
test('цена: несовпадающая скидка оставляет pending', async t => {
  const state = setup(t, { applied: true, readDiscount: 10 });
  const result = await updatePrice({ nmId: 1, price: 900, discount: 5, confirm: true });
  assert.ok(result.confirmed); assert.equal(result.result.status, 'pending');
  assert.equal(state.entries()[0].ok, false);
});
test('цена: HTTP 500 оставляет unknown и не повторяет запись', async t => {
  const state = setup(t, { uploadStatus: 500 });
  await assert.rejects(updatePrice({ nmId: 1, price: 900, confirm: true }), /500/);
  assert.equal(state.entries()[0].status, 'unknown'); assert.equal(state.posts(), 1);
});
