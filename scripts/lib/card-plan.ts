/**
 * Проверка черновика карточки до записи в кабинет.
 * Свойства товара модель не выдумывает: у характеристики источник «карточка» или «человек».
 */
export type PhotoEdit = 'фон' | 'крупность' | 'свет' | 'инфографика';
export type CharSource = 'card' | 'human';

export interface Characteristic {
  name: string;
  value: string;
  source: CharSource;
}

export interface CardPlan {
  nmId: number;
  photoHypothesis: string;
  /** Нет поля — приём кадра не выбран. С полем — только если в competitors есть топ выдачи. */
  edit?: PhotoEdit;
  competitors?: CompetitorShot[];
  title: string;
  description: string;
  characteristics: Characteristic[];
}

const BANNED = /хит|лучший|лучшая|лучшее|скидк|распродаж|\bnew\b|\bsale\b|\bhit\b/i;

export function reviewPlan(plan: CardPlan): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const title = plan.title.trim();
  if (!title) errors.push('Название пустое');
  if (title.length > 60) errors.push(`Название ${title.length} знаков, лимит 60`);
  if (/[№/]/.test(title)) errors.push('В названии нельзя «№» и «/»');
  if (BANNED.test(title)) errors.push('В названии маркетинговое слово, WB за него понижает');
  const description = plan.description.trim();
  if (!description) errors.push('Описание пустое');
  if (description.length > 5000) errors.push(`Описание ${description.length} знаков, лимит 5000`);
  if (BANNED.test(description)) errors.push('В описании маркетинговое слово');
  if (!plan.photoHypothesis.trim()) errors.push('Нет гипотезы для фото');
  if (plan.edit && !(plan.competitors && plan.competitors.length > 0)) {
    errors.push('Правку фото нельзя выбрать без топа выдачи');
  }
  if (!plan.characteristics.length) errors.push('Нет характеристик');
  for (const c of plan.characteristics) {
    if (!c.name.trim() || !c.value.trim()) errors.push('Пустая характеристика');
    if (c.source !== 'card' && c.source !== 'human') errors.push(`«${c.name}»: источник только карточка или человек, не модель`);
  }
  return { ok: errors.length === 0, errors };
}

export type ShotPattern = 'предметка' | 'на человеке' | 'инфографика' | 'сцена';

export interface CompetitorShot {
  query: string;
  position: number;
  pattern: ShotPattern;
}

/** Какой приём чаще у лидеров выдачи. Ничья — предметка: товар на кадре проще сверить. */
export function dominantPattern(shots: CompetitorShot[]): ShotPattern {
  const tally = new Map<ShotPattern, number>();
  for (const s of shots) {
    if (s.position < 1 || s.position > 10) continue;
    tally.set(s.pattern, (tally.get(s.pattern) ?? 0) + 1);
  }
  let best: ShotPattern = 'предметка';
  let n = 0;
  for (const [pattern, count] of tally) {
    const preferProduct = count === n && pattern === 'предметка';
    if (count > n || preferProduct) {
      best = pattern;
      n = count;
    }
  }
  return best;
}
