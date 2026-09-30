/**
 * Проверка окружения перед работой: токен, доступ к категориям WB, сборка MCP, конфиг Codex, себестоимость.
 *
 *   npx tsx scripts/check.ts
 *
 * Доступ проверяется через GET /ping каждого домена WB: он отвечает 200 только при токене нужной категории.
 */
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { DATA, ROOT, describeToken, wbToken } from './lib/env.js';
import { WB } from './lib/wb.js';

const ok = (s: string) => console.log(`🟢 ${s}`);
const warn = (s: string) => console.log(`🟡 ${s}`);
const bad = (s: string) => console.log(`🔴 ${s}`);
let failed = 0;

const [major] = process.versions.node.split('.').map(Number);
major >= 20 ? ok(`Node.js ${process.versions.node}`) : (bad(`Node.js ${process.versions.node} — нужен 20+`), failed++);

try {
  const v = execSync('codex --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  ok(`Codex: ${v}`);
} catch {
  warn('Codex CLI не найден в PATH (для скриптов не нужен, для работы агента — нужен)');
}

existsSync(join(ROOT, 'mcp/wb-mcp/dist/index.js')) ? ok('MCP-сервер WB собран') : (bad('MCP не собран: npm run build'), failed++);
existsSync(join(ROOT, '.codex/config.toml')) ? ok('Конфиг Codex: .codex/config.toml') : (bad('Нет .codex/config.toml: запустите ./setup.sh'), failed++);

let token = '';
try {
  token = wbToken();
  const t = describeToken(token);
  if (t.exp) {
    const days = Math.round((t.exp.getTime() - Date.now()) / 86400_000);
    days > 14 ? ok(`Токен WB действует до ${t.exp.toLocaleDateString('ru-RU')} (${days} дн.)`) : warn(`Токен WB истекает через ${days} дн. — выпустите новый`);
  } else ok('Токен WB найден');
  if (t.readOnly) warn('Токен «только на чтение»: запись в кабинет (цены, карточки, ставки) не пройдёт');
} catch (e) {
  bad((e as Error).message);
  failed++;
}

if (token) {
  const categories: [string, string][] = [
    ['Контент (карточки)', WB.content],
    ['Статистика', WB.statistics],
    ['Цены и скидки', WB.prices],
    ['Продвижение (реклама)', WB.advert],
    ['Аналитика (воронка, хранение, поиск)', WB.analytics],
    ['Финансы (детализация реализации)', WB.finance],
    ['Вопросы и отзывы', WB.feedbacks],
  ];
  for (const [name, base] of categories) {
    try {
      const res = await fetch(`${base}/ping`, { headers: { Authorization: token } });
      if (res.ok) ok(`Доступ: ${name}`);
      else if (res.status === 401) { bad(`Нет доступа: ${name} (401 — категория не выбрана в токене или токен неверный)`); failed++; }
      else if (res.status === 429) warn(`${name}: 429, лимит проверки — повторите через минуту`);
      else warn(`${name}: ответ ${res.status}`);
    } catch (e) {
      bad(`${name}: сеть недоступна (${(e as Error).message})`);
      failed++;
    }
  }
}

existsSync(join(DATA, 'cost.csv')) ? ok('Себестоимость: data/cost.csv') : warn('Себестоимости нет: $cost-import <таблица> (без неё $profit не запустится)');

console.log(failed ? `\nПроблем: ${failed}. Исправьте и повторите.` : '\nГотово к работе.');
process.exit(failed ? 1 : 0);
