import crypto from 'node:crypto';
import { diffDays, isRealDate } from './dates.js';

export type UnknownField = {
  path: string;
  valueType: string;
  preview?: string | number | boolean;
  length?: number;
  keys?: string[];
};

export type NotImported = { path: string; reason: string };

export type FloCycle = {
  periodStart: string;
  periodEnd: string | null;
  sourceAuthor: string | null;
  sourceKey: string;
};

export type FloLog = {
  date: string;
  symptoms: string[];
  mood: string | null;
  sleepHours: number | null;
  sleepQuality: string | null;
  energy: string | null;
  wellbeing: string | null;
  sexualActivity: string | null;
  notes: string | null;
  sourceAuthor: string | null;
  sourceKey: string;
};

export type FloParse = {
  cycles: FloCycle[];
  logs: FloLog[];
  unknownFields: UnknownField[];
  notImported: NotImported[];
  warnings: string[];
};

const CYCLE_LISTS = new Set(['cycles', 'periods', 'menstruations']);
const LOG_LISTS = new Set(['days', 'logs', 'daylogs', 'dailylogs', 'entries']);
const PROFILE_KEYS = new Set(['profile', 'user']);
const META_KEYS = new Set(['version', 'exportedat', 'exportdate']);
const START_KEYS = ['periodstart', 'period_start', 'periodstartdate', 'startdate', 'start_date', 'start'];
const END_KEYS = ['periodend', 'period_end', 'periodenddate', 'enddate', 'end_date', 'end'];
const AUTHOR_KEYS = ['author', 'authorname', 'recordedby'];

function sourceKey(kind: string, payload: unknown): string {
  return crypto.createHash('sha256').update(`${kind}:${JSON.stringify(payload)}`).digest('hex');
}

function summarize(path: string, value: unknown): UnknownField {
  if (typeof value === 'string') {
    if (value.length > 80) return { path, valueType: 'string', length: value.length };
    return { path, valueType: 'string', preview: value };
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { path, valueType: typeof value, preview: value };
  }
  if (value == null) return { path, valueType: 'null' };
  if (Array.isArray(value)) return { path, valueType: 'array', length: value.length };
  if (typeof value === 'object') return { path, valueType: 'object', keys: Object.keys(value).slice(0, 30) };
  return { path, valueType: typeof value };
}

export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso && isRealDate(iso[1])) return iso[1];
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(trimmed);
  if (ru) {
    const date = `${ru[3]}-${ru[2]}-${ru[1]}`;
    if (isRealDate(date)) return date;
  }
  return null;
}

function text(value: unknown, max = 2000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function symptomsOf(value: unknown): string[] | null {
  if (typeof value === 'string' && value.trim()) return [value.trim().slice(0, 40)];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim().slice(0, 40)).slice(0, 30);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value)
      .filter(([, flag]) => flag === true || flag === 'true')
      .map(([key]) => key.slice(0, 40))
      .slice(0, 30);
  }
  return null;
}

function hoursOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 24) return null;
  return Math.round(value * 10) / 10;
}

function findKey(record: Record<string, unknown>, names: string[]): { key: string; value: unknown } | null {
  for (const key of Object.keys(record)) {
    if (names.includes(key.toLowerCase())) return { key, value: record[key] };
  }
  return null;
}

function recordAuthor(record: Record<string, unknown>): { author: string | null; keys: string[] } {
  const found = findKey(record, AUTHOR_KEYS);
  if (!found) return { author: null, keys: [] };
  return { author: text(found.value, 120), keys: [found.key] };
}

function parseCycle(record: Record<string, unknown>, path: string, report: FloParse): FloCycle | null {
  const start = findKey(record, START_KEYS);
  const end = findKey(record, END_KEYS);
  const startDate = start ? normalizeDate(start.value) : null;
  if (!start || !startDate) {
    report.warnings.push(`${path}: нет даты начала менструации`);
    return null;
  }
  const endDate = end ? normalizeDate(end.value) : null;
  if (end && end.value != null && end.value !== '' && !endDate) {
    report.unknownFields.push(summarize(`${path}.${end.key}`, end.value));
  }
  if (endDate && (endDate < startDate || diffDays(startDate, endDate) > 14)) {
    report.warnings.push(`${path}: окончание менструации не похоже на дату цикла, запись пропущена`);
    return null;
  }
  const { author, keys: authorKeys } = recordAuthor(record);
  const used = new Set([start.key, end?.key, ...authorKeys].filter(Boolean) as string[]);
  const knownIgnored = new Set(['id', 'cycleid', 'cyclelength', 'periodlength', 'ovulation', 'ovulationdate', 'fertilewindow']);
  for (const key of Object.keys(record)) {
    if (used.has(key)) continue;
    if (knownIgnored.has(key.toLowerCase())) {
      const reason = key.toLowerCase().includes('ovul') || key.toLowerCase().includes('fertile')
        ? 'Чужая оценка овуляции не переносится. Nova считает только свой приблизительный прогноз.'
        : 'Служебное поле Flo не переносится.';
      report.notImported.push({ path: `${path}.${key}`, reason });
      continue;
    }
    report.unknownFields.push(summarize(`${path}.${key}`, record[key]));
  }
  const cycle: FloCycle = {
    periodStart: startDate,
    periodEnd: endDate,
    sourceAuthor: author,
    sourceKey: '',
  };
  cycle.sourceKey = sourceKey('cycle', {
    periodStart: cycle.periodStart,
    periodEnd: cycle.periodEnd,
    sourceAuthor: cycle.sourceAuthor,
  });
  return cycle;
}

function parseLog(record: Record<string, unknown>, path: string, report: FloParse): FloLog | null {
  const dateField = findKey(record, ['date', 'day', 'logdate', 'log_date']);
  const date = dateField ? normalizeDate(dateField.value) : null;
  if (!dateField || !date) {
    report.warnings.push(`${path}: нет даты дневной записи`);
    return null;
  }
  const used = new Set<string>([dateField.key]);
  const { author, keys: authorKeys } = recordAuthor(record);
  authorKeys.forEach((key) => used.add(key));

  const takeText = (names: string[], max = 200): string | null => {
    const found = findKey(record, names);
    if (!found) return null;
    used.add(found.key);
    const value = text(found.value, max);
    if (found.value != null && found.value !== '' && value == null) {
      report.unknownFields.push(summarize(`${path}.${found.key}`, found.value));
    }
    return value;
  };

  let symptoms: string[] = [];
  const symptomField = findKey(record, ['symptoms', 'symptom', 'symptomslist']);
  if (symptomField) {
    used.add(symptomField.key);
    const parsed = symptomsOf(symptomField.value);
    if (parsed) symptoms = parsed;
    else if (symptomField.value != null) report.unknownFields.push(summarize(`${path}.${symptomField.key}`, symptomField.value));
  }

  let sleepHours: number | null = null;
  let sleepQuality: string | null = null;
  const sleepField = findKey(record, ['sleephours', 'sleep_hours', 'sleep']);
  if (sleepField) {
    used.add(sleepField.key);
    if (typeof sleepField.value === 'number') sleepHours = hoursOf(sleepField.value);
    else if (sleepField.value && typeof sleepField.value === 'object' && !Array.isArray(sleepField.value)) {
      const sleep = sleepField.value as Record<string, unknown>;
      const hours = findKey(sleep, ['hours', 'sleephours', 'duration']);
      const quality = findKey(sleep, ['quality', 'sleepquality']);
      if (hours) sleepHours = hoursOf(hours.value);
      if (quality) sleepQuality = text(quality.value, 80);
      const usedSleep = new Set([hours?.key, quality?.key].filter(Boolean));
      for (const key of Object.keys(sleep)) {
        if (!usedSleep.has(key)) report.unknownFields.push(summarize(`${path}.${sleepField.key}.${key}`, sleep[key]));
      }
    } else if (typeof sleepField.value === 'string') {
      sleepQuality = text(sleepField.value, 80);
    } else if (sleepField.value != null) {
      report.unknownFields.push(summarize(`${path}.${sleepField.key}`, sleepField.value));
    }
  }
  const qualityField = findKey(record, ['sleepquality', 'sleep_quality']);
  if (qualityField && !used.has(qualityField.key)) {
    used.add(qualityField.key);
    sleepQuality = text(qualityField.value, 80) ?? sleepQuality;
  }

  const log: FloLog = {
    date,
    symptoms,
    mood: takeText(['mood', 'moods'], 80),
    sleepHours,
    sleepQuality,
    energy: takeText(['energy'], 80),
    wellbeing: takeText(['wellbeing', 'wellness', 'feeling'], 80),
    sexualActivity: takeText(['sexualactivity', 'sexual_activity', 'sex', 'intercourse'], 200),
    notes: takeText(['notes', 'note', 'diary', 'comment'], 4000),
    sourceAuthor: author,
    sourceKey: '',
  };
  for (const key of Object.keys(record)) {
    if (!used.has(key)) report.unknownFields.push(summarize(`${path}.${key}`, record[key]));
  }
  log.sourceKey = sourceKey('log', {
    date: log.date,
    symptoms: log.symptoms,
    mood: log.mood,
    sleepHours: log.sleepHours,
    sleepQuality: log.sleepQuality,
    energy: log.energy,
    wellbeing: log.wellbeing,
    sexualActivity: log.sexualActivity,
    notes: log.notes,
    sourceAuthor: log.sourceAuthor,
  });
  return log;
}

function parseList(value: unknown, path: string, kind: 'cycle' | 'log', report: FloParse) {
  if (!Array.isArray(value)) {
    report.unknownFields.push(summarize(path, value));
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      report.unknownFields.push(summarize(itemPath, item));
      return;
    }
    if (kind === 'cycle') {
      const cycle = parseCycle(item as Record<string, unknown>, itemPath, report);
      if (cycle) report.cycles.push(cycle);
    } else {
      const log = parseLog(item as Record<string, unknown>, itemPath, report);
      if (log) report.logs.push(log);
    }
  });
}

function walkObject(record: Record<string, unknown>, prefix: string, report: FloParse) {
  for (const key of Object.keys(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const lower = key.toLowerCase();
    const value = record[key];
    if (lower === 'data' && value && typeof value === 'object' && !Array.isArray(value)) {
      walkObject(value as Record<string, unknown>, path, report);
      continue;
    }
    if (CYCLE_LISTS.has(lower)) {
      parseList(value, path, 'cycle', report);
      continue;
    }
    if (LOG_LISTS.has(lower)) {
      parseList(value, path, 'log', report);
      continue;
    }
    if (PROFILE_KEYS.has(lower)) {
      report.notImported.push({ path, reason: 'Профиль Flo не переносится в Nova.' });
      continue;
    }
    if (META_KEYS.has(lower)) {
      report.notImported.push({ path, reason: 'Служебное поле экспорта не переносится.' });
      continue;
    }
    report.unknownFields.push(summarize(path, value));
  }
}

export function parseFlo(input: unknown): FloParse {
  const report: FloParse = { cycles: [], logs: [], unknownFields: [], notImported: [], warnings: [] };
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        report.unknownFields.push(summarize(`[${index}]`, item));
        return;
      }
      const record = item as Record<string, unknown>;
      if (findKey(record, START_KEYS)) {
        const cycle = parseCycle(record, `[${index}]`, report);
        if (cycle) report.cycles.push(cycle);
        return;
      }
      const log = parseLog(record, `[${index}]`, report);
      if (log) report.logs.push(log);
    });
  } else if (input && typeof input === 'object') {
    walkObject(input as Record<string, unknown>, '', report);
  } else {
    report.warnings.push('JSON должен быть объектом или массивом записей.');
  }
  if (report.cycles.length === 0 && report.logs.length === 0) {
    report.warnings.push('Не удалось распознать даты менструации или дневные записи.');
  }
  if (report.unknownFields.length > 200) {
    report.warnings.push('Неизвестных полей больше 200. В отчёте показаны первые 200.');
    report.unknownFields = report.unknownFields.slice(0, 200);
  }
  return report;
}
