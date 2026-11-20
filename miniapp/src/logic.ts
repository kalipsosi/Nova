import type { Cycle, Forecast, Log } from './api';

export const split = (v?: string | null) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// Сердечко ставится, если отмечено что-то из раздела «Секс», кроме «Секса не было» и пунктов про желание.
export const hasSex = (l?: Pick<Log, 'sexual_activity'> | null) =>
  split(l?.sexual_activity).some((t) => t !== 'Секса не было' && !t.endsWith('желание'));

const day = (v: unknown) => String(v).slice(0, 10);
const toMs = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const diff = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / 864e5);
const add = (s: string, n: number) => new Date(toMs(s) + n * 864e5).toISOString().slice(0, 10);

// Партнёр получает данные через /api/shared, их нужно привести к тому же виду, что и у владелицы.
export function logsFromShared(rows?: Array<{ date: string; values: unknown[] }>): Log[] {
  return (rows ?? []).map((row) => {
    const log: Log = { log_date: day(row.date), symptoms: [], mood: null, sleep_hours: null, sleep_quality: null, energy: null, wellbeing: null, sexual_activity: null, notes: null };
    for (const raw of row.values as Array<Record<string, any>>) {
      if (raw.symptoms) log.symptoms = raw.symptoms;
      if (raw.mood) log.mood = raw.mood;
      if (raw.sleep) { log.sleep_hours = raw.sleep.hours ?? null; log.sleep_quality = raw.sleep.quality ?? null; }
      if (raw.energy) log.energy = raw.energy;
      if (raw.wellbeing) log.wellbeing = raw.wellbeing;
      if (raw.sexualActivity) log.sexual_activity = raw.sexualActivity;
      if (raw.notes) log.notes = raw.notes;
    }
    return log;
  });
}

export const cyclesFromShared = (rows?: Array<{ period_start: string; period_end: string | null }>): Cycle[] =>
  (rows ?? []).map((c) => ({ id: day(c.period_start), period_start: day(c.period_start), period_end: c.period_end ? day(c.period_end) : null, source: 'shared' }));

// Та же логика, что в backend/src/forecast.ts, чтобы партнёр видел одинаковый прогноз.
export function estimateForecast(cycles: Cycle[], today: string): Forecast {
  const disclaimer = 'Прогноз приблизительный и не гарантирует наступление или отсутствие овуляции. Nova не является средством контрацепции, диагностики или лечения.';
  const ordered = [...cycles].sort((a, b) => (a.period_start < b.period_start ? -1 : 1));
  if (!ordered.length) return { available: false, nextPeriodStart: null, ovulation: null, fertileStart: null, fertileEnd: null, averageCycleLength: null, averagePeriodLength: null, disclaimer, basis: 'Пока нет отметок месячных, поэтому прогноз не строится.' };
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) { const d = diff(ordered[i - 1].period_start, ordered[i].period_start); if (d >= 15 && d <= 60) gaps.push(d); }
  const lens = ordered.filter((c) => c.period_end).map((c) => diff(c.period_start, c.period_end as string) + 1).filter((d) => d >= 1 && d <= 14);
  const mean = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) / a.length);
  const length = gaps.length ? mean(gaps.slice(-6)) : 28;
  let next = add(ordered[ordered.length - 1].period_start, length);
  for (let i = 0; next < today && i < 24; i += 1) next = add(next, length);
  const ovulation = add(next, -14);
  return { available: true, nextPeriodStart: next, ovulation, fertileStart: add(ovulation, -5), fertileEnd: add(ovulation, 1), averageCycleLength: length, averagePeriodLength: lens.length ? mean(lens.slice(-6)) : null, disclaimer, basis: gaps.length ? `Средняя длина цикла по датам: ${length} дней. Овуляция условно за 14 дней до ожидаемых месячных. Это не измерение овуляции.` : 'Пока мало данных, взята типичная длина цикла 28 дней. Овуляция условно за 14 дней до ожидаемых месячных.' };
}
