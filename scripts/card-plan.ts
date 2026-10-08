/**
 * Проверить черновик карточки до записи в кабинет.
 *   npx tsx scripts/card-plan.ts drafts/<nmID>/plan.json
 * Код выхода 1 — в кабинет этот черновик писать нельзя.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from './lib/args.js';
import { reviewPlan, type CardPlan } from './lib/card-plan.js';

const file = parseArgs().positional[0];
if (!file) {
  console.error('Укажите файл черновика: npx tsx scripts/card-plan.ts drafts/<nmID>/plan.json');
  process.exit(1);
}
const plan = JSON.parse(readFileSync(file, 'utf8')) as CardPlan;
const { ok, errors } = reviewPlan(plan);
if (ok) {
  const photo = plan.edit ? `правка фото: ${plan.edit}` : 'правка фото не назначена: топа выдачи нет';
  console.log(`Черновик ${plan.nmId} можно показывать человеку. ${photo}.`);
} else {
  console.error(`Черновик ${plan.nmId} в кабинет писать нельзя:`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
