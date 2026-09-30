/** Минимальный разбор аргументов: --key value, --flag, позиционные. */
export function parseArgs(argv = process.argv.slice(2)) {
  const opts: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      if (v !== undefined) opts[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opts[k] = argv[++i];
      else opts[k] = true;
    } else positional.push(a);
  }
  const str = (k: string) => (typeof opts[k] === 'string' ? (opts[k] as string) : undefined);
  return { opts, positional, str, flag: (k: string) => opts[k] === true };
}

/** Прошлая полная неделя пн–вс по МСК. */
export function lastFullWeek(now = new Date()): { from: string; to: string } {
  const d = new Date(now.getTime() + 3 * 3600_000);
  const dow = (d.getUTCDay() + 6) % 7; // пн = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow - 7));
  const sunday = new Date(monday.getTime() + 6 * 86400_000);
  const f = (x: Date) => x.toISOString().slice(0, 10);
  return { from: f(monday), to: f(sunday) };
}
