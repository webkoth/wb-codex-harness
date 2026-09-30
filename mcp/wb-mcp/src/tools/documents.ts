/**
 * Documents tools for Wildberries MCP
 * Работа с финансовыми документами из ЛК
 * API: https://documents-api.wildberries.ru
 */

import { z } from 'zod';
import * as XLSX from 'xlsx';
import { createWBHeaders } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';

// ==================== Constants ====================

const DOCUMENTS_API_URL = 'https://documents-api.wildberries.ru';

// ==================== Input Schemas ====================

export const GetDocumentsListInputSchema = z.object({
  dateFrom: z.string().optional().describe('Дата начала (YYYY-MM-DD)'),
  dateTo: z.string().optional().describe('Дата конца (YYYY-MM-DD)'),
  category: z.string().optional().describe('ID категории документа'),
  limit: z.number().optional().default(50).describe('Максимальное количество документов (до 50)'),
  offset: z.number().optional().default(0).describe('Смещение для пагинации'),
});

export const GetDocumentCategoriesInputSchema = z.object({
  locale: z.string().optional().default('ru').describe('Язык (ru, en, zh)'),
});

export const DownloadDocumentInputSchema = z.object({
  serviceName: z.string().describe('ID документа (serviceName)'),
  extension: z.string().optional().default('xlsx').describe('Формат: xlsx, pdf, zip'),
});

export const GetNPDReportInputSchema = z.object({
  year: z.number().describe('Год для расчета НПД (например, 2025)'),
});

export type GetDocumentsListInput = z.infer<typeof GetDocumentsListInputSchema>;
export type GetDocumentCategoriesInput = z.infer<typeof GetDocumentCategoriesInputSchema>;
export type DownloadDocumentInput = z.infer<typeof DownloadDocumentInputSchema>;
export type GetNPDReportInput = z.infer<typeof GetNPDReportInputSchema>;

// ==================== Interfaces ====================

export interface DocumentCategory {
  id: string;
  name: string;
}

export interface Document {
  serviceName: string;
  name: string;
  category: string;
  categoryId: string;
  date: string;
  extensions: string[];
}

export interface DocumentsSummary {
  total: number;
  categories: { [key: string]: number };
  periodFrom?: string;
  periodTo?: string;
}

// NPD Report interfaces
export interface NPDMonthData {
  month: string;           // "2025-01"
  physicalAmount: number;  // Сумма физ.лица (из еженедельных отчетов)
  legalAmount: number;     // Сумма юр.лица (из уведомлений о выкупе)
  physicalTax: number;     // physicalAmount * 0.04
  legalTax: number;        // legalAmount * 0.06
  totalTax: number;        // physicalTax + legalTax
  documentsCount: number;  // Количество обработанных документов
}

export interface NPDReport {
  year: number;
  months: NPDMonthData[];
  totalPhysical: number;
  totalLegal: number;
  totalPhysicalTax: number;
  totalLegalTax: number;
  totalTax: number;
  documentsProcessed: number;
  errors: string[];
}

// ==================== Fetch Helper ====================

async function fetchDocumentsAPI<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...createWBHeaders(),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WB Documents API Error ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

// ==================== Functions ====================

/**
 * Получить категории документов
 */
export async function getDocumentCategories(input: GetDocumentCategoriesInput): Promise<{
  categories: DocumentCategory[];
}> {
  const { locale } = input;
  const url = `${DOCUMENTS_API_URL}/api/v1/documents/categories?locale=${locale}`;

  interface CategoriesResponse {
    data?: {
      categories?: Array<{
        name: string;
        title: string;
      }>;
    };
  }

  const result = await fetchDocumentsAPI<CategoriesResponse>(url);

  // WB возвращает data.categories[{ name: слаг, title: отображаемое имя }]
  const categories = (result.data?.categories || []).map(c => ({
    id: c.name,
    name: c.title,
  }));

  await logRead('wb_get_document_categories', 'documents', input, { count: categories.length });

  return { categories };
}

/**
 * Получить список документов
 */
export async function getDocumentsList(input: GetDocumentsListInput): Promise<{
  documents: Document[];
  summary: DocumentsSummary;
}> {
  const { dateFrom, dateTo, category, limit, offset } = input;

  let url = `${DOCUMENTS_API_URL}/api/v1/documents/list?locale=ru&limit=${limit}&offset=${offset}`;

  if (dateFrom && dateTo) {
    // API требует формат YYYY-MM-DD (без времени)
    url += `&beginTime=${dateFrom}&endTime=${dateTo}`;
  }

  if (category) {
    url += `&category=${category}`;
  }

  url += '&sort=date&order=desc';

  interface DocumentsResponse {
    data: {
      documents: Array<{
        serviceName: string;
        name: string;
        category: string;
        categoryId?: string;
        creationTime: string;
        extensions: string[];
        viewed?: boolean;
      }>;
    };
    total?: number;
  }

  const result = await fetchDocumentsAPI<DocumentsResponse>(url);

  const documents: Document[] = (result.data?.documents || []).map(d => ({
    serviceName: d.serviceName,
    name: d.name,
    category: d.category,
    categoryId: d.categoryId || '',
    date: d.creationTime,
    extensions: d.extensions || [],
  }));

  // Группируем по категориям
  const categoryStats: { [key: string]: number } = {};
  for (const doc of documents) {
    categoryStats[doc.category] = (categoryStats[doc.category] || 0) + 1;
  }

  const summary: DocumentsSummary = {
    total: result.total || documents.length,
    categories: categoryStats,
    periodFrom: dateFrom,
    periodTo: dateTo,
  };

  await logRead('wb_get_documents_list', 'documents', input, { count: documents.length });

  return { documents, summary };
}

/**
 * Скачать документ и вернуть ссылку/содержимое
 */
export async function downloadDocument(input: DownloadDocumentInput): Promise<{
  serviceName: string;
  extension: string;
  downloadUrl: string;
  message: string;
}> {
  const { serviceName, extension } = input;

  // Формируем URL для скачивания
  const downloadUrl = `${DOCUMENTS_API_URL}/api/v1/documents/download?serviceName=${encodeURIComponent(serviceName)}&extension=${extension}`;

  await logRead('wb_download_document', 'documents', input, { serviceName, extension });

  return {
    serviceName,
    extension,
    downloadUrl,
    message: `Для скачивания документа используйте URL с вашим API токеном:\n\ncurl -H "Authorization: ${process.env.WB_API_TOKEN?.substring(0, 10)}..." "${downloadUrl}" -o "${serviceName}.${extension}"`,
  };
}

// ==================== NPD Report Functions ====================

const RATE_LIMIT_DELAY = 10000; // 10 seconds between downloads

/**
 * Sleep для rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Скачать документ как Buffer
 */
async function downloadDocumentContent(serviceName: string, extension: string = 'xlsx'): Promise<Buffer> {
  const url = `${DOCUMENTS_API_URL}/api/v1/documents/download?serviceName=${encodeURIComponent(serviceName)}&extension=${extension}`;

  const response = await fetch(url, {
    headers: createWBHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download failed ${response.status}: ${text}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Парсить "Еженедельный отчет реализации" — найти строку "Всего реализовано"
 */
function parseWeeklyReport(buffer: Buffer): number {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Конвертируем в массив строк (header: 1 возвращает массив массивов)
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  // Ищем строку "Всего реализовано" и берём значение из соседней колонки
  for (const row of data) {
    if (!Array.isArray(row)) continue;

    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] || '').toLowerCase();
      if (cell.includes('всего реализовано') || cell.includes('итого реализовано')) {
        // Ищем числовое значение в следующих ячейках
        for (let j = i + 1; j < row.length; j++) {
          const value = row[j];
          if (typeof value === 'number' && value > 0) {
            return value;
          }
          // Попробуем распарсить строку как число
          if (typeof value === 'string') {
            const parsed = parseFloat(value.replace(/\s/g, '').replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) {
              return parsed;
            }
          }
        }
      }
    }
  }

  return 0;
}

/**
 * Парсить "Уведомление о выкупе" — найти строку "Итого"
 */
function parseRedeemNotification(buffer: Buffer): number {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

  // Ищем строку "Итого" и берём значение
  for (const row of data) {
    if (!Array.isArray(row)) continue;

    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] || '').toLowerCase().trim();
      if (cell === 'итого' || cell === 'итого:') {
        // Ищем числовое значение в следующих ячейках
        for (let j = i + 1; j < row.length; j++) {
          const value = row[j];
          if (typeof value === 'number' && value > 0) {
            return value;
          }
          if (typeof value === 'string') {
            const parsed = parseFloat(value.replace(/\s/g, '').replace(',', '.'));
            if (!isNaN(parsed) && parsed > 0) {
              return parsed;
            }
          }
        }
      }
    }
  }

  return 0;
}

/**
 * Получить месяц из даты документа
 */
function getMonthFromDate(dateStr: string): string {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Получить НПД отчёт за год
 */
export async function getNPDReport(input: GetNPDReportInput): Promise<NPDReport> {
  const { year } = input;

  const dateFrom = `${year}-01-01`;
  const dateTo = `${year}-12-31`;

  // Получаем все документы за год
  const allDocuments: Document[] = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const result = await getDocumentsList({ dateFrom, dateTo, limit, offset });
    allDocuments.push(...result.documents);

    if (result.documents.length < limit) break;
    offset += limit;

    // Rate limit
    await sleep(1000);
  }

  // Фильтруем документы по типам
  const weeklyReports = allDocuments.filter(d =>
    d.name.toLowerCase().includes('еженедельный отчет') ||
    d.name.toLowerCase().includes('еженедельный отчёт') ||
    d.categoryId === 'weekly_report'
  );

  const redeemNotifications = allDocuments.filter(d =>
    d.name.toLowerCase().includes('уведомление о выкупе') ||
    d.categoryId === 'redeem_notification'
  );

  // Данные по месяцам
  const monthsMap: Map<string, NPDMonthData> = new Map();
  const errors: string[] = [];
  let documentsProcessed = 0;

  // Обрабатываем еженедельные отчёты (физ.лица)
  for (const doc of weeklyReports) {
    if (!doc.extensions.includes('xlsx')) {
      errors.push(`${doc.name}: нет xlsx формата`);
      continue;
    }

    try {
      const buffer = await downloadDocumentContent(doc.serviceName, 'xlsx');
      const amount = parseWeeklyReport(buffer);

      if (amount > 0) {
        const month = getMonthFromDate(doc.date);
        const existing = monthsMap.get(month) || {
          month,
          physicalAmount: 0,
          legalAmount: 0,
          physicalTax: 0,
          legalTax: 0,
          totalTax: 0,
          documentsCount: 0,
        };

        existing.physicalAmount += amount;
        existing.documentsCount += 1;
        monthsMap.set(month, existing);
        documentsProcessed++;
      }

      // Rate limit
      await sleep(RATE_LIMIT_DELAY);
    } catch (err) {
      errors.push(`${doc.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Обрабатываем уведомления о выкупе (юр.лица)
  for (const doc of redeemNotifications) {
    if (!doc.extensions.includes('xlsx')) {
      errors.push(`${doc.name}: нет xlsx формата`);
      continue;
    }

    try {
      const buffer = await downloadDocumentContent(doc.serviceName, 'xlsx');
      const amount = parseRedeemNotification(buffer);

      if (amount > 0) {
        const month = getMonthFromDate(doc.date);
        const existing = monthsMap.get(month) || {
          month,
          physicalAmount: 0,
          legalAmount: 0,
          physicalTax: 0,
          legalTax: 0,
          totalTax: 0,
          documentsCount: 0,
        };

        existing.legalAmount += amount;
        existing.documentsCount += 1;
        monthsMap.set(month, existing);
        documentsProcessed++;
      }

      // Rate limit
      await sleep(RATE_LIMIT_DELAY);
    } catch (err) {
      errors.push(`${doc.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Рассчитываем налоги
  for (const data of monthsMap.values()) {
    data.physicalTax = Math.round(data.physicalAmount * 0.04 * 100) / 100;
    data.legalTax = Math.round(data.legalAmount * 0.06 * 100) / 100;
    data.totalTax = data.physicalTax + data.legalTax;
  }

  // Сортируем по месяцам
  const months = Array.from(monthsMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Итоги
  const totalPhysical = months.reduce((sum, m) => sum + m.physicalAmount, 0);
  const totalLegal = months.reduce((sum, m) => sum + m.legalAmount, 0);
  const totalPhysicalTax = months.reduce((sum, m) => sum + m.physicalTax, 0);
  const totalLegalTax = months.reduce((sum, m) => sum + m.legalTax, 0);
  const totalTax = totalPhysicalTax + totalLegalTax;

  await logRead('wb_get_npd_report', 'documents', input, { documentsProcessed, year });

  return {
    year,
    months,
    totalPhysical,
    totalLegal,
    totalPhysicalTax,
    totalLegalTax,
    totalTax,
    documentsProcessed,
    errors,
  };
}

// ==================== Formatters ====================

/**
 * Форматировать категории как Markdown
 */
export function formatCategoriesAsMarkdown(categories: DocumentCategory[]): string {
  const lines: string[] = [
    '## Категории документов Wildberries',
    '',
    '| ID | Название |',
    '|-----|----------|',
  ];

  for (const cat of categories) {
    lines.push(`| ${cat.id} | ${cat.name} |`);
  }

  return lines.join('\n');
}

/**
 * Форматировать список документов как Markdown
 */
export function formatDocumentsAsMarkdown(documents: Document[], summary: DocumentsSummary): string {
  const lines: string[] = [
    '## Документы Wildberries',
    '',
  ];

  if (summary.periodFrom && summary.periodTo) {
    lines.push(`**Период:** ${summary.periodFrom} — ${summary.periodTo}`);
    lines.push('');
  }

  lines.push(`**Всего документов:** ${summary.total}`);
  lines.push('');

  // Статистика по категориям
  if (Object.keys(summary.categories).length > 0) {
    lines.push('### По категориям');
    lines.push('');
    lines.push('| Категория | Документов |');
    lines.push('|-----------|------------|');
    for (const [cat, count] of Object.entries(summary.categories)) {
      lines.push(`| ${cat} | ${count} |`);
    }
    lines.push('');
  }

  // Список документов
  if (documents.length > 0) {
    lines.push('### Список документов');
    lines.push('');
    lines.push('| Дата | Название | Категория | Форматы | ID |');
    lines.push('|------|----------|-----------|---------|-----|');

    for (const doc of documents) {
      const date = doc.date ? doc.date.split('T')[0] : '-';
      const name = doc.name.length > 40 ? doc.name.substring(0, 37) + '...' : doc.name;
      const formats = doc.extensions.join(', ');
      lines.push(`| ${date} | ${name} | ${doc.category} | ${formats} | \`${doc.serviceName}\` |`);
    }
  }

  lines.push('');
  lines.push('> Для скачивания документа используйте `wb_download_document` с параметром `serviceName`');

  return lines.join('\n');
}

/**
 * Форматировать НПД отчёт как Markdown
 */
export function formatNPDReportAsMarkdown(report: NPDReport): string {
  const monthNames: { [key: string]: string } = {
    '01': 'Январь',
    '02': 'Февраль',
    '03': 'Март',
    '04': 'Апрель',
    '05': 'Май',
    '06': 'Июнь',
    '07': 'Июль',
    '08': 'Август',
    '09': 'Сентябрь',
    '10': 'Октябрь',
    '11': 'Ноябрь',
    '12': 'Декабрь',
  };

  const formatMoney = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const lines: string[] = [
    `## Отчёт НПД за ${report.year} год`,
    '',
    `**Обработано документов:** ${report.documentsProcessed}`,
    '',
    '### Помесячная разбивка',
    '',
    '| Месяц | Физ.лица (4%) | Юр.лица (6%) | Налог физ. | Налог юр. | Итого налог |',
    '|-------|---------------|--------------|------------|-----------|-------------|',
  ];

  for (const m of report.months) {
    const monthNum = m.month.split('-')[1];
    const monthName = monthNames[monthNum] || m.month;
    lines.push(
      `| ${monthName} | ${formatMoney(m.physicalAmount)} ₽ | ${formatMoney(m.legalAmount)} ₽ | ${formatMoney(m.physicalTax)} ₽ | ${formatMoney(m.legalTax)} ₽ | ${formatMoney(m.totalTax)} ₽ |`
    );
  }

  lines.push('');
  lines.push('### Итого за год');
  lines.push('');
  lines.push(`- **Физ.лица (4%):** ${formatMoney(report.totalPhysical)} ₽ → налог **${formatMoney(report.totalPhysicalTax)} ₽**`);
  lines.push(`- **Юр.лица (6%):** ${formatMoney(report.totalLegal)} ₽ → налог **${formatMoney(report.totalLegalTax)} ₽**`);
  lines.push(`- **Общий НПД:** **${formatMoney(report.totalTax)} ₽**`);

  // Проверка лимита 2.4 млн
  const totalIncome = report.totalPhysical + report.totalLegal;
  const limit = 2400000;
  if (totalIncome > limit) {
    lines.push('');
    lines.push(`⚠️ **ВНИМАНИЕ:** Общий доход ${formatMoney(totalIncome)} ₽ превышает лимит НПД ${formatMoney(limit)} ₽!`);
  } else {
    const remaining = limit - totalIncome;
    lines.push('');
    lines.push(`✅ До лимита НПД осталось: ${formatMoney(remaining)} ₽ (${Math.round(remaining / limit * 100)}%)`);
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push('### Ошибки обработки');
    lines.push('');
    for (const err of report.errors.slice(0, 10)) {
      lines.push(`- ${err}`);
    }
    if (report.errors.length > 10) {
      lines.push(`- ...и ещё ${report.errors.length - 10} ошибок`);
    }
  }

  return lines.join('\n');
}
