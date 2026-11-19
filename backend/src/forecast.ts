import { addDays, diffDays } from './dates.js';

export const FORECAST_DISCLAIMER =
  'Прогноз приблизительный и не гарантирует наступление или отсутствие овуляции. Nova не является средством контрацепции, диагностики или лечения.';

export type CycleSpan = {
  periodStart: string;
  periodEnd: string | null;
};

export type Forecast = {
  approximate: true;
  notForContraception: true;
  disclaimer: string;
  available: boolean;
  basis: string;
  nextPeriodStart: string | null;
  ovulation: string | null;
  fertileStart: string | null;
  fertileEnd: string | null;
  averageCycleLength: number | null;
  averagePeriodLength: number | null;
  cycleLengthSource: 'history' | 'default' | 'none';
  assumedLutealDays: 14;
};

export type CycleStats = {
  cycleCount: number;
  averageCycleLength: number | null;
  averagePeriodLength: number | null;
  lastPeriodStart: string | null;
  lastPeriodEnd: string | null;
};

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function cycleStats(cycles: CycleSpan[]): CycleStats {
  const ordered = [...cycles].sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
  const lengths: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const days = diffDays(ordered[i - 1].periodStart, ordered[i].periodStart);
    if (days >= 15 && days <= 60) lengths.push(days);
  }
  const periodLengths = ordered
    .filter((cycle) => cycle.periodEnd)
    .map((cycle) => diffDays(cycle.periodStart, cycle.periodEnd as string) + 1)
    .filter((days) => days >= 1 && days <= 14);
  const last = ordered[ordered.length - 1];
  const recent = lengths.slice(-6);
  return {
    cycleCount: ordered.length,
    averageCycleLength: recent.length ? Math.round(average(recent)) : null,
    averagePeriodLength: periodLengths.length ? Math.round(average(periodLengths.slice(-6))) : null,
    lastPeriodStart: last?.periodStart ?? null,
    lastPeriodEnd: last?.periodEnd ?? null,
  };
}

export function buildForecast(cycles: CycleSpan[], today: string): Forecast {
  const base = {
    approximate: true as const,
    notForContraception: true as const,
    disclaimer: FORECAST_DISCLAIMER,
    assumedLutealDays: 14 as const,
  };
  const stats = cycleStats(cycles);
  if (!stats.lastPeriodStart) {
    return {
      ...base,
      available: false,
      basis: 'Пока нет отметок менструации, поэтому прогноз не строится.',
      nextPeriodStart: null,
      ovulation: null,
      fertileStart: null,
      fertileEnd: null,
      averageCycleLength: null,
      averagePeriodLength: null,
      cycleLengthSource: 'none',
    };
  }
  const source = stats.averageCycleLength == null ? 'default' : 'history';
  const length = stats.averageCycleLength ?? 28;
  let next = addDays(stats.lastPeriodStart, length);
  let guard = 0;
  while (next < today && guard < 24) {
    next = addDays(next, length);
    guard += 1;
  }
  const ovulation = addDays(next, -14);
  const basis = source === 'history'
    ? `Средняя длина цикла по вашим датам: ${length} дней. Овуляция условно за 14 дней до ожидаемой менструации. Это не измерение овуляции.`
    : 'Пока мало интервалов между циклами, поэтому взята типичная длина 28 дней. Овуляция условно за 14 дней до ожидаемой менструации. Это не измерение овуляции.';
  return {
    ...base,
    available: true,
    basis,
    nextPeriodStart: next,
    ovulation,
    fertileStart: addDays(ovulation, -5),
    fertileEnd: addDays(ovulation, 1),
    averageCycleLength: length,
    averagePeriodLength: stats.averagePeriodLength,
    cycleLengthSource: source,
  };
}
