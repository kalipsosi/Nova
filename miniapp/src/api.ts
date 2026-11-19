const tokenKey = 'nova_session_token';

export type User = { userId: string; telegramId: string; username: string | null; displayName: string | null; pairId: string | null; pairStatus: string | null; role: 'owner' | 'partner' | null; };
export type Cycle = { id: string; period_start: string; period_end: string | null; source: string; };
export type Log = { log_date: string; symptoms: string[]; mood: string | null; sleep_hours: number | null; sleep_quality: string | null; energy: string | null; wellbeing: string | null; sexual_activity: string | null; notes: string | null; };
export type Forecast = { available: boolean; nextPeriodStart: string | null; ovulation: string | null; fertileStart: string | null; fertileEnd: string | null; averageCycleLength: number | null; averagePeriodLength: number | null; disclaimer: string; basis: string; };

let sessionToken = sessionStorage.getItem(tokenKey);
export function getToken() { return sessionToken; }
function setToken(token: string) { sessionToken = token; sessionStorage.setItem(tokenKey, token); }
export function clearToken() { sessionToken = null; sessionStorage.removeItem(tokenKey); }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('content-type', 'application/json');
  if (sessionToken) headers.set('authorization', `Bearer ${sessionToken}`);
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? 'Не удалось выполнить запрос');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export async function signIn(initData?: string) {
  const telegramData = initData ?? '';
  if (!telegramData) throw new Error('Откройте Nova из Telegram');
  const result = await request<{ token: string }>('/api/auth/telegram', { method: 'POST', body: JSON.stringify({ initData: telegramData }) });
  setToken(result.token);
}
export async function signInDev() { const result = await request<{ token: string }>('/api/auth/dev', { method: 'POST', body: JSON.stringify({ telegramId: String(Date.now()), displayName: 'Локальная пользовательница' }) }); setToken(result.token); }
export const me = () => request<{ user: User; pair: unknown }>('/api/me');
export const cycles = () => request<{ cycles: Cycle[] }>('/api/cycles');
export const diary = () => request<{ logs: Log[] }>('/api/diary');
export const forecast = () => request<Forecast>('/api/forecast');
export const pair = () => request<{ pair: any; permissions: Array<{ category: string; granted: boolean }> }>('/api/pair');
export const shared = () => request<{ categories: string[]; cycles?: Cycle[]; logs?: Array<{ date: string; values: unknown[] }> }>('/api/shared');
export const stats = () => request<{ stats: { cycleCount: number; averageCycleLength: number | null; averagePeriodLength: number | null } }>('/api/stats');
export const saveDiary = (date: string, value: Partial<Log>) => request(`/api/diary/${date}`, { method: 'PUT', body: JSON.stringify({ symptoms: value.symptoms ?? [], mood: value.mood ?? null, sleepHours: value.sleep_hours ?? null, sleepQuality: value.sleep_quality ?? null, energy: value.energy ?? null, wellbeing: value.wellbeing ?? null, sexualActivity: value.sexual_activity ?? null, notes: value.notes ?? null }) });
export const saveCycle = (periodStart: string, periodEnd: string | null) => request('/api/cycles', { method: 'POST', body: JSON.stringify({ periodStart, periodEnd }) });
export const updatePermission = (category: string, granted: boolean) => request('/api/pair/permissions', { method: 'PATCH', body: JSON.stringify({ category, granted }) });
export const createPair = () => request('/api/pair', { method: 'POST', body: '{}' });
export const createInvite = () => request<{ token: string; expiresAt: string }>('/api/pair/invites', { method: 'POST', body: '{}' });
export const redeemInvite = (token: string) => request('/api/pair/invites/redeem', { method: 'POST', body: JSON.stringify({ token }) });
export const observations = () => request<{ observations: any[] }>('/api/partner/observations');
export const createObservation = (body: any) => request('/api/partner/observations', { method: 'POST', body: JSON.stringify(body) });
export const deleteObservation = (id: string) => request(`/api/partner/observations/${id}`, { method: 'DELETE' });
export const previewImport = (data: unknown) => request<{ import: { id: string }; report: any }>('/api/imports/preview', { method: 'POST', body: JSON.stringify({ data }) });
export const confirmImport = (id: string) => request(`/api/imports/${id}/confirm`, { method: 'POST', body: '{}' });
export const deleteAccount = () => request('/api/account', { method: 'DELETE', body: JSON.stringify({ confirm: true }) });
export const logout = async () => { await request('/api/auth/logout', { method: 'POST', body: '{}' }); clearToken(); };
