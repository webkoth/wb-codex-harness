import { getPrices, updatePrice, UpdatePriceInputSchema } from '../../mcp/wb-mcp/src/tools/prices.js';
import { journalWrite, type JournalEntry } from '../../mcp/wb-mcp/src/utils/logger.js';

/** Reconcile an outstanding rollback before considering another write. */
export async function rollbackPrice(entry: JournalEntry, entries: JournalEntry[]) {
  if (entry.tool !== 'wb_update_price' || entry.status === 'rejected' || !entry.reversible) {
    throw new Error(`Запись ${entry.id} откатить нельзя.`);
  }
  const previous = entries.filter(e => e.rollbackOf === entry.id);
  if (previous.some(e => e.ok)) throw new Error(`Запись ${entry.id} уже откатывали.`);
  const pending = previous.find(e => e.status === 'pending' || e.status === 'unknown');
  const before = UpdatePriceInputSchema.parse({ ...(entry.before as object), confirm: true });
  if (pending || entry.status === 'pending' || entry.status === 'unknown') {
    const expected = (pending ? entry.before : entry.after) as { price: number; discount: number };
    const { products } = await getPrices({ nmIds: [before.nmId], limit: 1, offset: 0 });
    const observed = products[0];
    if (!observed || observed.price !== expected.price || observed.discount !== expected.discount) {
      throw new Error(pending
        ? 'Предыдущий откат ожидает подтверждения. Повторная запись не отправлена.'
        : 'Текущее состояние цены и скидки не совпадает с ожидаемым после исходной операции. Откат остановлен.');
    }
    if (pending) {
      const resolution = journalWrite({ tool: 'rollback:wb_update_price', entity: entry.entity,
        before: pending.before, after: entry.before, response: { observed, resolves: pending.id },
        ok: true, status: 'applied', reversible: false, rollbackOf: entry.id });
      return { success: true, status: 'applied' as const, journalId: resolution.id };
    }
  } else if (!entry.ok) {
    throw new Error('Исходная операция не подтверждена; автоматический откат недоступен.');
  }
  const result = await updatePrice(before, { rollbackOf: entry.id });
  if (!result.confirmed) throw new Error('Откат не подтверждён.');
  return result.result;
}
