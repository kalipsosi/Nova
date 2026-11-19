import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function isPrivateDatabaseHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === 'postgres') return true;
  if (!normalized.includes('.')) return false;
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(normalized);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export type ParsedInitData = {
  hash: string;
  authDate: number;
  telegramId: string;
  username: string | null;
  displayName: string | null;
  startParam: string | null;
};

export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowMs = Date.now(),
): ParsedInitData {
  if (!initData || !botToken) {
    throw new Error('invalid_init_data');
  }
  let pairs: readonly (readonly [string, string])[];
  try {
    pairs = initData.split('&').filter(Boolean).map((part) => {
      const eq = part.indexOf('=');
      const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq));
      const value = decodeURIComponent(eq === -1 ? '' : part.slice(eq + 1));
      return [key, value] as const;
    });
  } catch {
    throw new Error('invalid_init_data');
  }
  if (pairs.filter(([key]) => key === 'hash').length !== 1 || pairs.filter(([key]) => key === 'auth_date').length !== 1 || pairs.filter(([key]) => key === 'user').length !== 1) {
    throw new Error('invalid_init_data');
  }
  const hash = pairs.find(([key]) => key === 'hash')?.[1] ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('invalid_init_data');
  const data: [string, string][] = [];
  for (const [key, value] of pairs) {
    if (key === 'hash') continue;
    data.push([key, value]);
  }
  data.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = data.map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const left = Buffer.from(calculated, 'hex');
  const right = Buffer.from(hash, 'hex');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('invalid_init_data');
  }
  const authDate = Number(data.find(([key]) => key === 'auth_date')?.[1]);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0) throw new Error('invalid_init_data');
  if (authDate > nowSeconds + 60) throw new Error('invalid_init_data');
  if (nowSeconds - authDate > maxAgeSeconds) throw new Error('expired_init_data');

  const userRaw = data.find(([key]) => key === 'user')?.[1] ?? '';
  let username: string | null = null;
  let displayName: string | null = null;
  let telegramId: string;
  try {
    const user = JSON.parse(userRaw) as { id?: string | number; username?: string; first_name?: string; last_name?: string };
    if (typeof user.id !== 'string' && typeof user.id !== 'number') throw new Error('invalid_user');
    telegramId = String(user.id);
    if (!/^\d{1,20}$/.test(telegramId)) throw new Error('invalid_user');
    username = typeof user.username === 'string' ? user.username.slice(0, 64) : null;
    displayName = [user.first_name, user.last_name].filter((value): value is string => typeof value === 'string').join(' ').slice(0, 120) || null;
  } catch {
    throw new Error('invalid_init_data');
  }
  const startParam = data.find(([key]) => key === 'start_param')?.[1] ?? null;
  return { hash: hash.toLowerCase(), authDate, telegramId, username, displayName, startParam };
}

type Bucket = { resetAt: number; count: number };

export function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.name}:${req.ip ?? 'unknown'}`;
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { resetAt: now + options.windowMs, count: 1 });
      next();
      return;
    }
    if (current.count >= options.max) {
      const retry = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.', code: 'rate_limited' });
      return;
    }
    current.count += 1;
    next();
  };
}
