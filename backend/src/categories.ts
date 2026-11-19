export const CATEGORIES = [
  'cycle',
  'symptoms',
  'mood',
  'sleep',
  'energy',
  'wellbeing',
  'sexual_activity',
  'notes',
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

export type DailyRecord = {
  logDate: string;
  symptoms: string[];
  mood: string | null;
  sleepHours: number | null;
  sleepQuality: string | null;
  energy: string | null;
  wellbeing: string | null;
  sexualActivity: string | null;
  notes: string | null;
};

export function projectDaily(category: Category, log: DailyRecord): Record<string, unknown> | null {
  const date = log.logDate;
  switch (category) {
    case 'cycle':
      return null;
    case 'symptoms':
      return log.symptoms.length > 0 ? { date, symptoms: log.symptoms } : null;
    case 'mood':
      return log.mood ? { date, mood: log.mood } : null;
    case 'sleep':
      if (log.sleepHours == null && !log.sleepQuality) return null;
      return { date, sleep: { hours: log.sleepHours, quality: log.sleepQuality } };
    case 'energy':
      return log.energy ? { date, energy: log.energy } : null;
    case 'wellbeing':
      return log.wellbeing ? { date, wellbeing: log.wellbeing } : null;
    case 'sexual_activity':
      return log.sexualActivity ? { date, sexualActivity: log.sexualActivity } : null;
    case 'notes':
      return log.notes ? { date, notes: log.notes } : null;
    default: {
      const neverCategory: never = category;
      return neverCategory;
    }
  }
}
