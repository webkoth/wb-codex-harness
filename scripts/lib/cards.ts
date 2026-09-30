/** Все карточки продавца: nmID, артикул продавца, баркоды, предмет. Курсор updatedAt+nmID. */
import { WB, cached, wbFetch } from './wb.js';

export interface CardRef {
  nmId: number;
  vendorCode: string;
  title: string;
  subjectName: string;
  barcodes: string[];
  /** Сырая карточка из API: описание, характеристики, фото, габариты. */
  raw: Record<string, unknown>;
}

interface CardsResponse {
  cards?: Array<{
    nmID: number;
    vendorCode: string;
    title?: string;
    subjectName?: string;
    sizes?: Array<{ skus?: string[] }>;
  }>;
  cursor?: { updatedAt?: string; nmID?: number; total?: number };
}

export async function fetchAllCards(fresh = false): Promise<CardRef[]> {
  const day = new Date().toISOString().slice(0, 10);
  return cached(['cards', day], fresh, async () => {
    const out: CardRef[] = [];
    let cursor: Record<string, unknown> = { limit: 100 };
    for (let page = 0; page < 200; page++) {
      const res = await wbFetch<CardsResponse>(`${WB.content}/content/v2/get/cards/list`, {
        body: { settings: { sort: { ascending: true }, cursor, filter: { withPhoto: -1 } } },
      });
      const cards = res?.cards ?? [];
      for (const c of cards) {
        out.push({
          nmId: c.nmID,
          vendorCode: String(c.vendorCode ?? '').trim(),
          title: c.title ?? '',
          subjectName: c.subjectName ?? '',
          barcodes: (c.sizes ?? []).flatMap((s) => s.skus ?? []).map(String),
          raw: c as unknown as Record<string, unknown>,
        });
      }
      const total = res?.cursor?.total ?? 0;
      if (cards.length === 0 || total < 100) break;
      cursor = { limit: 100, updatedAt: res?.cursor?.updatedAt, nmID: res?.cursor?.nmID };
    }
    return out;
  });
}
