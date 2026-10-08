import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'data', 'cache');
const from = '2026-09-01';
const to = '2026-09-07';
const cacheFile = (key: unknown) => join(cache, createHash('sha1').update(JSON.stringify(key)).digest('hex').slice(0, 16) + '.json');

test('fetchAdsByNm integration with isolated filesystem and HTTP', async (t) => {
  // Keep the real HTTP client and cache logic; intercept only their external I/O.
  // Install before importing env.ts so even dotenv cannot read the seller token.
  const files = new Map<string, string>();
  const read = fs.readFileSync;
  const exists = fs.existsSync;
  const write = fs.writeFileSync;
  const mkdir = fs.mkdirSync;
  const isCache = (path: unknown) => String(path).startsWith(cache + '/');
  t.mock.method(fs, 'readFileSync', (...args: Parameters<typeof read>) => {
    if (String(args[0]) === join(root, '.env')) return '';
    if (isCache(args[0])) {
      assert.ok(files.has(String(args[0])), 'cache read must use the in-memory fixture');
      return files.get(String(args[0]));
    }
    return read(...args);
  });
  t.mock.method(fs, 'existsSync', (path: Parameters<typeof exists>[0]) => isCache(path) ? files.has(String(path)) : exists(path));
  t.mock.method(fs, 'writeFileSync', (...args: Parameters<typeof write>) => {
    if (isCache(args[0])) { files.set(String(args[0]), String(args[1])); return; }
    return write(...args);
  });
  t.mock.method(fs, 'mkdirSync', (...args: Parameters<typeof mkdir>) => String(args[0]) === cache ? undefined : mkdir(...args));
  syncBuiltinESMExports();
  const previousToken = process.env.WB_API_TOKEN;
  process.env.WB_API_TOKEN = 'fake-test-token';
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (previousToken === undefined) delete process.env.WB_API_TOKEN;
    else process.env.WB_API_TOKEN = previousToken;
  });
  const { fetchAdsByNm } = await import('../scripts/lib/sources.js');
  let groups: Array<{ status: number; advert_list: Array<{ advertId: number; changeTime?: string }> }> = [];
  let requested: number[][] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, 'fake-test-token');
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://advert-api.wildberries.ru');
    if (url.pathname === '/adv/v1/promotion/count') return Response.json({ adverts: groups });
    assert.equal(url.pathname, '/adv/v3/fullstats');
    assert.equal(url.searchParams.get('beginDate'), from);
    assert.equal(url.searchParams.get('endDate'), to);
    const ids = url.searchParams.get('ids')!.split(',').map(Number);
    requested.push(ids);
    return Response.json(ids.map((advertId) => ({ advertId, days: [
      { apps: [{ nms: [{ nmId: 100, sum: 10, views: 20, clicks: 3, orders: 2, atbs: 4 }] },
        { nms: [{ nmId: 100, sum: 5, views: 7, clicks: 1, orders: 1, atbs: 2 }] }] },
      { apps: [{ nms: [{ nmId: 200, sum: 1 }] }] },
    ] })));
  });

  await t.test('old active, paused and completed campaigns contribute to SKU totals', async () => {
    files.clear(); requested = [];
    groups = [9, 11, 7, 4].map((status) => ({ status, advert_list: [{ advertId: status, changeTime: '2020-01-01T00:00:00Z' }] }));
    const result = await fetchAdsByNm(from, to);
    assert.deepEqual(requested, [[9, 11, 7]]);
    assert.deepEqual([...result], [
      [100, { sum: 45, views: 81, clicks: 12, orders: 9, carts: 18 }],
      [200, { sum: 3, views: 0, clicks: 0, orders: 0, carts: 0 }],
    ]);
  });

  await t.test('duplicate campaign IDs are requested and counted once', async () => {
    files.clear(); requested = [];
    groups = [9, 11].map((status) => ({ status, advert_list: [{ advertId: 42 }, { advertId: 42 }] }));
    const result = await fetchAdsByNm(from, to);
    assert.deepEqual(requested, [[42]]);
    assert.equal(result.get(100)?.sum, 15);
  });

  await t.test('legacy ads cache is ignored and refreshed results are reused', async () => {
    files.clear(); requested = [];
    const legacy = cacheFile(['ads', from, to]);
    files.set(legacy, JSON.stringify({ 100: { sum: 999, views: 0, clicks: 0, orders: 0, carts: 0 } }));
    groups = [{ status: 9, advert_list: [{ advertId: 42 }] }];
    const result = await fetchAdsByNm(from, to);
    assert.equal(result.get(100)?.sum, 15);
    assert.deepEqual(requested, [[42]]);
    const again = await fetchAdsByNm(from, to);
    assert.deepEqual(again, result);
    assert.deepEqual(requested, [[42]]);
    assert.equal(JSON.parse(files.get(legacy)!)[100].sum, 999);
  });
});
