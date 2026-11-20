export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseUtcDate(value: string): Date {
  if (!isRealDate(value)) throw new HttpError(400, 'Некорректная дата');
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(value: string, days: number): string {
  const date = parseUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

export function diffDays(from: string, to: string): number {
  const ms = parseUtcDate(to).getTime() - parseUtcDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function serverToday(now = new Date()): string {
  return formatUtcDate(now);
}

export function resolveToday(input: unknown, now = new Date()): string {
  const server = serverToday(now);
  if (typeof input === 'string' && isRealDate(input) && Math.abs(diffDays(server, input)) <= 1) {
    return input;
  }
  return server;
}

export function eachDate(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = start;
  while (cursor <= end) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}
