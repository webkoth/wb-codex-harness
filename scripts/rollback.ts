/**
 * Откат изменений в кабинете WB по журналу data/changes.jsonl.
 *
 *   npx tsx scripts/rollback.ts --list          последние 20 записей
 *   npx tsx scripts/rollback.ts <id>            что будет восстановлено (ничего не меняет)
 *   npx tsx scripts/rollback.ts <id> --yes      восстановить БЫЛО
 *
 * Откатываются: цена и скидка, карточка (целиком, как была до правки),
 * ставка CPM, пауза/запуск кампании. Ответ на отзыв, пополнение бюджета и
 * операции с поставками откатить нельзя — они помечены reversible:false.
 */
import { existsSync, readFileSync } from 'fs';
import { journalPath, journalWrite, JournalEntry } from '../mcp/wb-mcp/src/utils/logger.js';
import { updatePrice, UpdatePriceInputSchema } from '../mcp/wb-mcp/src/tools/prices.js';
import { fetchRawCard, postCardUpdate, toUpdatePayload, RawCard } from '../mcp/wb-mcp/src/tools/cards.js';
import {
  updateCampaignCpm,
  UpdateCampaignCpmInputSchema,
  pauseCampaign,
  PauseCampaignInputSchema,
} from '../mcp/wb-mcp/src/tools/campaigns.js';

function readJournal(): JournalEntry[] {
  const file = journalPath();
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as JournalEntry);
}

function short(v: unknown, n = 80): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + '…' : s ?? '';
}

function list(entries: JournalEntry[]): void {
  const last = entries.slice(-20);
  if (last.length === 0) {
    console.log(`Журнал пуст: ${journalPath()}`);
    return;
  }
  console.log('| id | время | инструмент | объект | ok | откат |');
  console.log('|---|---|---|---|---|---|');
  for (const e of last) {
    const rb = e.rollbackOf ? `откат ${e.rollbackOf}` : e.reversible ? 'можно' : 'нельзя';
    console.log(`| ${e.id} | ${e.ts} | ${e.tool} | ${e.entity.type} ${e.entity.id} | ${e.ok ? 'да' : 'нет'} | ${rb} |`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const entries = readJournal();

  if (args.length === 0 || args.includes('--list')) {
    list(entries);
    return;
  }

  const id = args.find((a) => !a.startsWith('--'))!;
  const yes = args.includes('--yes');
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error(`Запись ${id} не найдена в ${journalPath()}`);
  if (!entry.ok) throw new Error(`Запись ${id} — неуспешная операция, в кабинете она ничего не поменяла.`);
  if (!entry.reversible) throw new Error(`Запись ${id} (${entry.tool}) откатить нельзя.`);
  if (entries.some((e) => e.rollbackOf === id && e.ok)) {
    throw new Error(`Запись ${id} уже откатывали. Смотрите --list.`);
  }

  const before = entry.before as Record<string, unknown>;

  switch (entry.tool) {
    case 'wb_update_price': {
      console.log(`Цена nmId ${before.nmId}: вернуть price=${before.price}, discount=${before.discount}%`);
      console.log(`(сейчас по журналу: ${short(entry.after)})`);
      if (!yes) break;
      await updatePrice(
        UpdatePriceInputSchema.parse({ nmId: before.nmId, price: before.price, discount: before.discount, confirm: true })
      );
      break;
    }

    case 'wb_update_card': {
      const raw = before as RawCard;
      const current = await fetchRawCard(raw.nmID);
      console.log(`Карточка ${raw.nmID} (${raw.vendorCode}) вернётся к состоянию на ${entry.ts}:`);
      for (const f of ['title', 'description', 'dimensions', 'characteristics'] as const) {
        const was = JSON.stringify(current[f] ?? null);
        const becomes = JSON.stringify(raw[f] ?? null);
        if (was !== becomes) console.log(`  ${f}: ${short(current[f])}  →  ${short(raw[f])}`);
      }
      console.log('  Внимание: карточка перезапишется целиком — правки, сделанные после этой записи, тоже откатятся.');
      if (!yes) break;
      const { response, errors } = await postCardUpdate(toUpdatePayload(raw));
      journalWrite({
        tool: 'wb_update_card',
        entity: { type: 'card', id: raw.nmID },
        before: current,
        after: toUpdatePayload(raw),
        response: { response, errors },
        ok: errors.length === 0,
        reversible: true,
        rollbackOf: id,
      });
      if (errors.length > 0) console.log(`WB вернул ошибки:\n${JSON.stringify(errors, null, 2)}`);
      console.log('Готово.');
      return;
    }

    case 'wb_update_campaign_cpm': {
      console.log(`Кампания ${before.campaignId}: вернуть CPM ${before.cpm} ₽`);
      if (!yes) break;
      await updateCampaignCpm(
        UpdateCampaignCpmInputSchema.parse({
          campaignId: before.campaignId,
          cpm: before.cpm,
          type: before.type,
          param: before.param ?? undefined,
          confirm: true,
        })
      );
      break;
    }

    case 'wb_pause_campaign': {
      console.log(`Кампания ${before.campaignId}: ${before.action === 'pause' ? 'поставить на паузу' : 'запустить'}`);
      if (!yes) break;
      await pauseCampaign(PauseCampaignInputSchema.parse({ campaignId: before.campaignId, action: before.action, confirm: true }));
      break;
    }

    default:
      throw new Error(`Откат для ${entry.tool} не реализован.`);
  }

  if (!yes) {
    console.log('\nЭто preview. Чтобы выполнить, добавьте --yes');
    return;
  }

  // Сам инструмент уже записал свою строку; отмечаем, что это откат
  journalWrite({
    tool: `rollback:${entry.tool}`,
    entity: entry.entity,
    before: entry.after,
    after: entry.before,
    ok: true,
    reversible: false,
    rollbackOf: id,
  });
  console.log('Готово.');
}

main().catch((err) => {
  console.error(`Ошибка: ${(err as Error).message}`);
  process.exit(1);
});
