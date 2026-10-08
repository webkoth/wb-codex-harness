/**
 * Прототип ротации: прогон на вымышленных показах, без кабинета WB.
 *   npx tsx scripts/ab-run.ts --demo
 * Запись фото в кабинет этим скриптом не делается.
 */
import { newTest, tick, type AbTest, type VariantStats } from './lib/ab.js';
import { parseArgs } from './lib/args.js';

const { flag } = parseArgs();

const chunk = (impressions: number, clicks: number, opens: number, orders: number): VariantStats =>
  ({ impressions, clicks, opens, orders });

function story(title: string, steps: VariantStats[]): void {
  console.log(`\n${title}`);
  let t: AbTest = newTest(731567520, '2026-10-01');
  for (const step of steps) {
    const r = tick(t, step, '2026-10-03');
    t = r.test;
    for (const a of r.actions) {
      if (a.type === 'switch') console.log(`  смена фото → ${a.to}`);
      if (a.type === 'finish') console.log(`  итог ${a.outcome}: ${a.reason}`);
    }
  }
  console.log(`  статус: ${t.status}, активно фото ${t.active}`);
}

if (!flag('demo')) {
  console.log('Прототип ротации. Запуск: npx tsx scripts/ab-run.ts --demo');
  console.log('В кабинет WB этот скрипт не пишет.');
  process.exit(0);
}

const aWin = chunk(2000, 40, 100, 5);
const bWin = chunk(2000, 60, 100, 5);
story('Кейс 1. Б кликают чаще, заказы на переход те же → остаётся Б', [aWin, bWin, aWin, bWin, aWin, bWin, aWin, bWin, aWin, bWin]);

const aSafe = chunk(2000, 20, 100, 10);
const bClickbait = chunk(2000, 80, 100, 2);
story('Кейс 2. Б кликают чаще, заказы просели → откат на А', [aSafe, bClickbait, aSafe, bClickbait, aSafe, bClickbait, aSafe, bClickbait, aSafe, bClickbait]);
