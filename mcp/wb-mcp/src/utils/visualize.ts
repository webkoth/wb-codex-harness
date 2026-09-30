/**
 * Unicode visualization utilities for markdown output
 * No external dependencies - pure TypeScript
 */

// Sparkline characters (8 levels)
const SPARK_CHARS = '▁▂▃▄▅▆▇█';

// Status indicators (no emoji)
export const STATUS = {
  good: '●',
  warning: '◐',
  bad: '○',
  neutral: '·',
} as const;

// Trend indicators
export const TREND = {
  up: '↑',
  down: '↓',
  stable: '→',
} as const;

/**
 * Generate sparkline from array of values
 * @example sparkline([10, 20, 30, 25, 40]) → "▁▃▅▄█"
 */
export function sparkline(values: number[]): string {
  if (!values || values.length === 0) return '';
  if (values.length === 1) return SPARK_CHARS[4]; // Middle value

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((v) => {
      const index = Math.min(Math.floor(((v - min) / range) * 7), 7);
      return SPARK_CHARS[index];
    })
    .join('');
}

/**
 * Generate progress bar
 * @example progressBar(75, 100) → "███████████████░░░░░"
 */
export function progressBar(value: number, max: number, width = 20): string {
  const ratio = Math.min(Math.max(value / (max || 1), 0), 1);
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Generate horizontal bar chart
 * @example
 * horizontalBars([{label: 'A', value: 100}, {label: 'B', value: 50}])
 * → "A  ████████████████████  100"
 *   "B  ██████████░░░░░░░░░░   50"
 */
export interface BarItem {
  label: string;
  value: number;
}

export function horizontalBars(items: BarItem[], width = 20): string {
  if (!items || items.length === 0) return '';

  const max = Math.max(...items.map((i) => i.value), 1);
  const maxLabel = Math.max(...items.map((i) => i.label.length), 1);
  const maxValue = Math.max(...items.map((i) => i.value.toLocaleString('ru-RU').length), 1);

  return items
    .map((item) => {
      const barLen = Math.round((item.value / max) * width);
      const label = item.label.padEnd(maxLabel);
      const bar = '█'.repeat(barLen) + '░'.repeat(width - barLen);
      const valueStr = item.value.toLocaleString('ru-RU').padStart(maxValue);
      return `${label}  ${bar}  ${valueStr}`;
    })
    .join('\n');
}

/**
 * Generate funnel chart (vertical stages)
 * @example
 * funnelChart([{name: 'Views', value: 1000}, {name: 'Clicks', value: 300}])
 * → "Просмотры  ████████████████████  1 000  100%"
 *   "Клики      ██████░░░░░░░░░░░░░░    300   30%"
 */
export interface FunnelStage {
  name: string;
  value: number;
}

export function funnelChart(stages: FunnelStage[], width = 20): string {
  if (!stages || stages.length === 0) return '';

  const max = stages[0]?.value || 1;
  const maxName = Math.max(...stages.map((s) => s.name.length), 1);
  const maxValue = Math.max(...stages.map((s) => s.value.toLocaleString('ru-RU').length), 1);

  return stages
    .map((stage) => {
      const ratio = stage.value / max;
      const barLen = Math.round(ratio * width);
      const bar = '█'.repeat(barLen) + '░'.repeat(width - barLen);
      const pct = (ratio * 100).toFixed(0).padStart(3) + '%';
      const name = stage.name.padEnd(maxName);
      const valueStr = stage.value.toLocaleString('ru-RU').padStart(maxValue);
      return `${name}  ${bar}  ${valueStr}  ${pct}`;
    })
    .join('\n');
}

/**
 * Get status indicator based on thresholds
 * @example statusIndicator(85, 30, 70) → "●" (good)
 */
export function statusIndicator(value: number, low: number, high: number): string {
  if (value >= high) return STATUS.good;
  if (value >= low) return STATUS.warning;
  return STATUS.bad;
}

/**
 * Get trend indicator and formatted change
 * @example trendIndicator(15) → "↑+15%"
 */
export function trendIndicator(change: number): string {
  const icon = change > 0 ? TREND.up : change < 0 ? TREND.down : TREND.stable;
  const sign = change > 0 ? '+' : '';
  return `${icon}${sign}${change.toFixed(0)}%`;
}

/**
 * Format number with Russian locale
 */
export function formatNumber(value: number): string {
  return value.toLocaleString('ru-RU');
}

/**
 * Format currency (rubles)
 */
export function formatRub(value: number): string {
  return `${value.toLocaleString('ru-RU')}₽`;
}

/**
 * Format percentage
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Create a simple ASCII table row
 */
export function tableRow(cells: string[], widths: number[]): string {
  return (
    '│ ' +
    cells.map((cell, i) => cell.toString().padEnd(widths[i] || 10)).join(' │ ') +
    ' │'
  );
}

/**
 * Create table separator
 */
export function tableSeparator(widths: number[], type: 'top' | 'middle' | 'bottom'): string {
  const chars = {
    top: { left: '┌', mid: '┬', right: '┐', line: '─' },
    middle: { left: '├', mid: '┼', right: '┤', line: '─' },
    bottom: { left: '└', mid: '┴', right: '┘', line: '─' },
  };
  const c = chars[type];
  return c.left + widths.map((w) => c.line.repeat(w + 2)).join(c.mid) + c.right;
}

/**
 * Conversion rate status with indicator
 * @example conversionStatus(25, 20, 30) → "● 25% (норма)"
 */
export function conversionStatus(
  value: number,
  low: number,
  high: number,
  showLabel = true
): string {
  const indicator = statusIndicator(value, low, high);
  const label = showLabel
    ? value >= high
      ? ' (хорошо)'
      : value >= low
        ? ' (норма)'
        : ' (низко)'
    : '';
  return `${indicator} ${value.toFixed(1)}%${label}`;
}

/**
 * ROI status with indicator
 * @example roiStatus(150) → "● +150%"
 */
export function roiStatus(roi: number): string {
  const indicator = statusIndicator(roi, 0, 100);
  const sign = roi > 0 ? '+' : '';
  return `${indicator} ${sign}${roi.toFixed(0)}%`;
}
