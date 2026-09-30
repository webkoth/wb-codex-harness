import { z } from 'zod';
import { createWBHeaders, WB_API_URLS } from '../utils/auth.js';
import { logRead } from '../utils/logger.js';

// Input schema for wb_get_warehouses
export const GetWarehousesInputSchema = z.object({
  type: z.enum(['fbo', 'fbs', 'all']).optional().default('all').describe('Warehouse type filter'),
});

export type GetWarehousesInput = z.infer<typeof GetWarehousesInputSchema>;

// Warehouse data interface
interface WarehouseData {
  id: number;
  name: string;
  city?: string;
  address?: string;
  type: 'fbo' | 'fbs';
  acceptsCargoType?: number;
  deliveryType?: number;
}

// Fetch helper
async function fetchWB<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...createWBHeaders(),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WB API Error ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

/**
 * Get WB warehouses (FBO)
 */
async function getFBOWarehouses(): Promise<WarehouseData[]> {
  const url = `${WB_API_URLS.marketplace}/api/v3/warehouses`;

  const result = await fetchWB<
    Array<{
      ID: number;
      name: string;
      city?: string;
      address?: string;
      acceptsQR?: boolean;
    }>
  >(url);

  return (result || []).map((w) => ({
    id: w.ID,
    name: w.name,
    city: w.city,
    address: w.address,
    type: 'fbo' as const,
  }));
}

/**
 * Get seller warehouses (FBS)
 */
async function getFBSWarehouses(): Promise<WarehouseData[]> {
  const url = `${WB_API_URLS.marketplace}/api/v3/offices`;

  const result = await fetchWB<
    Array<{
      id: number;
      name: string;
      city?: string;
      address?: string;
      cargoType?: number;
      deliveryType?: number;
    }>
  >(url);

  return (result || []).map((w) => ({
    id: w.id,
    name: w.name,
    city: w.city,
    address: w.address,
    type: 'fbs' as const,
    acceptsCargoType: w.cargoType,
    deliveryType: w.deliveryType,
  }));
}

/**
 * Get all warehouses
 */
export async function getWarehouses(input: GetWarehousesInput): Promise<{
  warehouses: WarehouseData[];
  total: number;
  byType: {
    fbo: number;
    fbs: number;
  };
}> {
  const { type } = input;

  let warehouses: WarehouseData[] = [];

  if (type === 'fbo' || type === 'all') {
    const fboWarehouses = await getFBOWarehouses();
    warehouses = [...warehouses, ...fboWarehouses];
  }

  if (type === 'fbs' || type === 'all') {
    const fbsWarehouses = await getFBSWarehouses();
    warehouses = [...warehouses, ...fbsWarehouses];
  }

  const fboCount = warehouses.filter((w) => w.type === 'fbo').length;
  const fbsCount = warehouses.filter((w) => w.type === 'fbs').length;

  await logRead('wb_get_warehouses', 'warehouses', input, {
    total: warehouses.length,
    fbo: fboCount,
    fbs: fbsCount,
  });

  return {
    warehouses,
    total: warehouses.length,
    byType: {
      fbo: fboCount,
      fbs: fbsCount,
    },
  };
}

/**
 * Format warehouses as markdown
 */
export function formatWarehousesAsMarkdown(
  warehouses: WarehouseData[],
  byType: { fbo: number; fbs: number }
): string {
  const lines: string[] = [
    '## Склады Wildberries',
    '',
    `**FBO (склады WB):** ${byType.fbo} | **FBS (ваши склады):** ${byType.fbs}`,
    '',
  ];

  // Group by type
  const fboWarehouses = warehouses.filter((w) => w.type === 'fbo');
  const fbsWarehouses = warehouses.filter((w) => w.type === 'fbs');

  if (fboWarehouses.length > 0) {
    lines.push('### FBO — Склады Wildberries');
    lines.push('');
    lines.push('| ID | Название | Город |');
    lines.push('|----|----------|-------|');

    for (const w of fboWarehouses) {
      lines.push(`| ${w.id} | ${w.name} | ${w.city || '-'} |`);
    }
    lines.push('');
  }

  if (fbsWarehouses.length > 0) {
    lines.push('### FBS — Ваши склады');
    lines.push('');
    lines.push('| ID | Название | Город | Адрес |');
    lines.push('|----|----------|-------|-------|');

    for (const w of fbsWarehouses) {
      lines.push(`| ${w.id} | ${w.name} | ${w.city || '-'} | ${w.address || '-'} |`);
    }
    lines.push('');
  }

  lines.push(`\n**Всего складов:** ${warehouses.length}`);

  return lines.join('\n');
}
