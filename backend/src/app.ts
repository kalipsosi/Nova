import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { audit } from './audit.js';
import { CATEGORIES, isCategory, projectDaily, type Category, type DailyRecord } from './categories.js';
import { type AppConfig } from './config.js';
import { buildForecast, cycleStats, type CycleSpan } from './forecast.js';
import { resolveToday, isRealDate, HttpError } from './dates.js';
import { isUniqueViolation, withTransaction } from './db.js';
import { parseFlo, type FloParse } from './flo.js';
import { hashToken, newToken, rateLimit, validateInitData } from './security.js';
import type { AuthContext, AuthedRequest } from './types.js';

const dateSchema = z.string().refine(isRealDate, 'Дата должна быть в формате YYYY-MM-DD');
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const dailySchema = z.object({
  symptoms: z.array(z.string().trim().min(1).max(80)).max(30).optional().default([]),
  mood: text(400),
  sleepHours: z.number().min(0).max(24).nullable().optional(),
  sleepQuality: text(120),
  energy: text(120),
  wellbeing: text(120),
  sexualActivity: text(400),
  notes: text(4000),
});
const cycleSchema = z.object({ periodStart: dateSchema, periodEnd: dateSchema.nullable().optional() });
const observationSchema = z.object({
  observedOn: dateSchema,
  mood: text(120),
  fatigue: text(120),
  sleepiness: text(120),
  appetite: text(120),
  behaviorChanges: text(500),
  note: text(4000),
});
const prefsSchema = z.object({
  period: z.boolean().optional(),
  forecast: z.boolean().optional(),
  reminder: z.boolean().optional(),
  tips: z.boolean().optional(),
}).strict();

function route(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function one(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function bodyOf<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, 'Некорректные данные запроса', 'invalid_request');
  return parsed.data;
}

function jsonError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code ?? 'request_failed' });
    return;
  }
  if (isUniqueViolation(error)) {
    res.status(409).json({ error: 'Такая запись уже существует', code: 'conflict' });
    return;
  }
  next(error);
}

function authFrom(req: Request): AuthContext {
  const auth = (req as AuthedRequest).auth;
  if (!auth) throw new HttpError(401, 'Требуется вход', 'unauthorized');
  return auth;
}

function activePair(req: Request): AuthContext {
  const auth = authFrom(req);
  if (!auth.pairId || auth.pairStatus !== 'active' || !auth.role) {
    throw new HttpError(409, 'Нет активной пары', 'pair_required');
  }
  return auth;
}

function owner(req: Request): AuthContext {
  const auth = activePair(req);
  if (auth.role !== 'owner') throw new HttpError(403, 'Доступно только владелице данных', 'owner_required');
  return auth;
}

function partner(req: Request): AuthContext {
  const auth = activePair(req);
  if (auth.role !== 'partner') throw new HttpError(403, 'Доступно только партнёру', 'partner_required');
  return auth;
}

function cookieValue(req: Request, name: string): string | null {
  const header = req.header('cookie') ?? '';
  const found = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

async function loadAuth(pool: Pool, req: Request): Promise<AuthContext> {
  const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const rawToken = bearer ?? cookieValue(req, 'nova_session');
  if (!rawToken) throw new HttpError(401, 'Требуется вход', 'unauthorized');
  const result = await pool.query(
    `SELECT u.id AS user_id, u.telegram_id, u.username, u.display_name,
            u.notifications_consented_at, u.notification_prefs,
            pm.pair_id, pm.role, p.status AS pair_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN pair_members pm ON pm.user_id = u.id AND pm.left_at IS NULL
       LEFT JOIN pairs p ON p.id = pm.pair_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      LIMIT 1`,
    [hashToken(rawToken)],
  );
  if (!result.rowCount) throw new HttpError(401, 'Сессия истекла или отозвана', 'unauthorized');
  const row = result.rows[0] as Record<string, unknown>;
  return {
    userId: String(row.user_id),
    telegramId: String(row.telegram_id),
    username: (row.username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    pairId: (row.pair_id as string | null) ?? null,
    pairStatus: (row.pair_status as 'active' | 'dissolved' | null) ?? null,
    role: (row.role as 'owner' | 'partner' | null) ?? null,
    notificationsConsentedAt: row.notifications_consented_at ? new Date(String(row.notifications_consented_at)).toISOString() : null,
    notificationPrefs: (row.notification_prefs as Record<string, boolean>) ?? {},
  };
}

async function createSession(pool: Pool, userId: string, ttlHours: number): Promise<string> {
  const token = newToken();
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(token), new Date(Date.now() + ttlHours * 60 * 60 * 1000)],
  );
  return token;
}

async function authenticateTelegram(pool: Pool, config: AppConfig, initData: string): Promise<{ token: string; userId: string }> {
  const parsed = validateInitData(initData, config.botToken, config.initDataMaxAgeSeconds);
  return withTransaction(pool, async (client) => {
    const used = await client.query(
      `INSERT INTO telegram_init_data_uses (data_hash, expires_at)
       VALUES ($1, $2) ON CONFLICT (data_hash) DO NOTHING RETURNING data_hash`,
      [parsed.hash, new Date(parsed.authDate * 1000 + config.initDataMaxAgeSeconds * 1000)],
    );
    if (!used.rowCount) throw new HttpError(409, 'Эти данные Telegram уже использованы', 'init_data_replayed');
    const user = await client.query(
      `INSERT INTO users (telegram_id, username, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name
       RETURNING id`,
      [parsed.telegramId, parsed.username, parsed.displayName],
    );
    const token = newToken();
    await client.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, hashToken(token), new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000)],
    );
    return { token, userId: String(user.rows[0].id) };
  });
}

async function currentPair(pool: Pool, userId: string) {
  const result = await pool.query(
    `SELECT p.id, p.status, p.created_at, pm.role,
            partner.id AS partner_id, partner.display_name AS partner_display_name,
            partner.username AS partner_username
       FROM pair_members pm
       JOIN pairs p ON p.id = pm.pair_id
       LEFT JOIN pair_members partner_member ON partner_member.pair_id = p.id AND partner_member.left_at IS NULL AND partner_member.role <> pm.role
       LEFT JOIN users partner ON partner.id = partner_member.user_id
      WHERE pm.user_id = $1 LIMIT 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

function dailyRecord(row: Record<string, unknown>): DailyRecord {
  return {
    logDate: String(row.log_date),
    symptoms: Array.isArray(row.symptoms) ? row.symptoms.filter((item): item is string => typeof item === 'string') : [],
    mood: (row.mood as string | null) ?? null,
    sleepHours: row.sleep_hours == null ? null : Number(row.sleep_hours),
    sleepQuality: (row.sleep_quality as string | null) ?? null,
    energy: (row.energy as string | null) ?? null,
    wellbeing: (row.wellbeing as string | null) ?? null,
    sexualActivity: (row.sexual_activity as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
  };
}

async function permission(pool: Pool, pairId: string, category: Category): Promise<boolean> {
  const result = await pool.query('SELECT granted FROM sharing_permissions WHERE pair_id = $1 AND category = $2', [pairId, category]);
  return result.rowCount === 1 && result.rows[0].granted === true;
}

export function createApp(config: AppConfig, pool: Pool): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ? 1 : false);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const origin = req.header('origin');
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(rateLimit({ windowMs: config.limits.windowMs, max: config.limits.global, name: 'global' }));

  app.get('/health', route(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'nova-api' });
  }));

  app.post('/api/auth/telegram', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.auth, name: 'auth' }), route(async (req, res) => {
    const body = bodyOf(z.object({ initData: z.string().min(1).max(10000) }), req.body);
    try {
      const result = await authenticateTelegram(pool, config, body.initData);
      res.json({ token: result.token, userId: result.userId });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const code = error instanceof Error && error.message === 'expired_init_data' ? 'expired_init_data' : 'invalid_init_data';
      throw new HttpError(401, code === 'expired_init_data' ? 'Данные Telegram устарели' : 'Некорректные данные Telegram', code);
    }
  }));

  app.post('/api/auth/dev', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.auth, name: 'dev-auth' }), route(async (req, res) => {
    if (!config.devAuthBypass) throw new HttpError(404, 'Маршрут не найден', 'not_found');
    const body = bodyOf(z.object({ telegramId: z.string().regex(/^\d{1,20}$/), username: z.string().max(64).optional(), displayName: z.string().max(120).optional() }), req.body);
    const user = await pool.query(
      `INSERT INTO users (telegram_id, username, display_name) VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name RETURNING id`,
      [body.telegramId, body.username ?? null, body.displayName ?? null],
    );
    const token = await createSession(pool, String(user.rows[0].id), config.sessionTtlHours);
    res.json({ token, userId: String(user.rows[0].id) });
  }));

  app.use('/api', async (req, _res, next) => {
    try {
      (req as AuthedRequest).auth = await loadAuth(pool, req);
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me', route(async (req, res) => {
    const auth = authFrom(req);
    res.json({ user: auth, pair: await currentPair(pool, auth.userId) });
  }));

  app.post('/api/auth/logout', route(async (req, res) => {
    const bearer = req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? cookieValue(req, 'nova_session');
    if (bearer) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(bearer)]);
    res.setHeader('Set-Cookie', 'nova_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    res.status(204).end();
  }));

  app.get('/api/pair', route(async (req, res) => {
    const auth = authFrom(req);
    const pair = await currentPair(pool, auth.userId);
    const permissions = pair ? await pool.query('SELECT category, granted, changed_by, updated_at FROM sharing_permissions WHERE pair_id = $1 ORDER BY category', [pair.id]) : { rows: [] };
    res.json({ pair, permissions: permissions.rows });
  }));

  app.post('/api/pair', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'pair-create' }), route(async (req, res) => {
    const auth = authFrom(req);
    const existing = await currentPair(pool, auth.userId);
    if (existing) throw new HttpError(409, 'У пользователя уже есть пара', 'pair_exists');
    const pair = await withTransaction(pool, async (client) => {
      const created = await client.query('INSERT INTO pairs DEFAULT VALUES RETURNING id, status, created_at');
      const pairId = String(created.rows[0].id);
      await client.query('INSERT INTO pair_members (pair_id, user_id, role) VALUES ($1, $2, \'owner\')', [pairId, auth.userId]);
      for (const category of CATEGORIES) await client.query('INSERT INTO sharing_permissions (pair_id, category, changed_by) VALUES ($1, $2, $3)', [pairId, category, auth.userId]);
      await audit(client, { actorUserId: auth.userId, eventType: 'pair_created', objectType: 'pair', objectId: pairId });
      return created.rows[0];
    });
    res.status(201).json({ pair, role: 'owner', permissions: CATEGORIES.map((category) => ({ category, granted: false })) });
  }));

  app.post('/api/pair/invites', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.invite, name: 'invite' }), route(async (req, res) => {
    const auth = owner(req);
    const token = newToken(24);
    const expiresAt = new Date(Date.now() + config.inviteTtlHours * 60 * 60 * 1000);
    const result = await pool.query(
      `INSERT INTO pair_invites (pair_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, expires_at`,
      [auth.pairId, hashToken(token), expiresAt, auth.userId],
    );
    await audit(pool, { actorUserId: auth.userId, eventType: 'invite_created', objectType: 'pair_invite', objectId: result.rows[0].id });
    res.status(201).json({ id: result.rows[0].id, token, expiresAt: result.rows[0].expires_at });
  }));

  app.post('/api/pair/invites/redeem', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.invite, name: 'invite-redeem' }), route(async (req, res) => {
    const auth = authFrom(req);
    const body = bodyOf(z.object({ token: z.string().min(20).max(200) }), req.body);
    const pair = await withTransaction(pool, async (client) => {
      const member = await client.query('SELECT 1 FROM pair_members WHERE user_id = $1 AND left_at IS NULL', [auth.userId]);
      if (member.rowCount) throw new HttpError(409, 'У пользователя уже есть пара', 'pair_exists');
      const invite = await client.query(
        `SELECT id, pair_id, created_by, expires_at, used_at, revoked_at FROM pair_invites WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(body.token)],
      );
      if (!invite.rowCount) throw new HttpError(404, 'Приглашение не найдено', 'invite_not_found');
      const row = invite.rows[0];
      if (row.used_at || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'Приглашение больше не действует', 'invite_expired');
      const pairRow = await client.query('SELECT id, status FROM pairs WHERE id = $1 FOR UPDATE', [row.pair_id]);
      if (!pairRow.rowCount || pairRow.rows[0].status !== 'active') throw new HttpError(410, 'Пара больше не активна', 'pair_inactive');
      await client.query(`INSERT INTO pair_members (pair_id, user_id, role)
         VALUES ($1, $2, 'partner')
         ON CONFLICT (pair_id, user_id) DO UPDATE SET role = 'partner', left_at = NULL, joined_at = now()`, [row.pair_id, auth.userId]);
      await client.query('UPDATE pair_invites SET used_at = now(), used_by = $1 WHERE id = $2', [auth.userId, row.id]);
      for (const category of CATEGORIES) await client.query('INSERT INTO sharing_permissions (pair_id, category, changed_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [row.pair_id, category, row.created_by]);
      await audit(client, { actorUserId: auth.userId, eventType: 'invite_redeemed', objectType: 'pair_invite', objectId: row.id, metadata: { pairId: row.pair_id } });
      return pairRow.rows[0];
    });
    res.status(200).json({ pair, role: 'partner', permissions: CATEGORIES.map((category) => ({ category, granted: false })) });
  }));

  app.post('/api/pair/invites/:id/revoke', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.invite, name: 'invite-revoke' }), route(async (req, res) => {
    const auth = owner(req);
    const result = await pool.query('UPDATE pair_invites SET revoked_at = now() WHERE id = $1 AND pair_id = $2 AND used_at IS NULL AND revoked_at IS NULL RETURNING id', [req.params.id, auth.pairId]);
    if (!result.rowCount) throw new HttpError(404, 'Приглашение не найдено или уже недействительно', 'invite_not_found');
    await audit(pool, { actorUserId: auth.userId, eventType: 'invite_revoked', objectType: 'pair_invite', objectId: req.params.id });
    res.status(204).end();
  }));

  app.post('/api/pair/leave', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.permission, name: 'pair-leave' }), route(async (req, res) => {
    const auth = partner(req);
    await withTransaction(pool, async (client) => {
      await client.query('UPDATE pair_members SET left_at = now() WHERE pair_id = $1 AND user_id = $2 AND left_at IS NULL', [auth.pairId, auth.userId]);
      await audit(client, { actorUserId: auth.userId, eventType: 'pair_left', objectType: 'pair', objectId: auth.pairId });
    });
    res.status(204).end();
  }));

  app.post('/api/pair/dissolve', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.permission, name: 'pair-dissolve' }), route(async (req, res) => {
    const auth = owner(req);
    await withTransaction(pool, async (client) => {
      await client.query('UPDATE pairs SET status = \'dissolved\' WHERE id = $1', [auth.pairId]);
      await client.query('UPDATE pair_invites SET revoked_at = now() WHERE pair_id = $1 AND used_at IS NULL AND revoked_at IS NULL', [auth.pairId]);
      await audit(client, { actorUserId: auth.userId, eventType: 'pair_dissolved', objectType: 'pair', objectId: auth.pairId });
      await client.query('DELETE FROM pair_members WHERE pair_id = $1', [auth.pairId]);
    });
    res.status(204).end();
  }));

  app.get('/api/pair/permissions', route(async (req, res) => {
    const auth = owner(req);
    const result = await pool.query('SELECT category, granted, changed_by, updated_at FROM sharing_permissions WHERE pair_id = $1 ORDER BY category', [auth.pairId]);
    res.json({ permissions: result.rows });
  }));

  app.patch('/api/pair/permissions', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.permission, name: 'permission' }), route(async (req, res) => {
    const auth = owner(req);
    const body = bodyOf(z.object({ category: z.string(), granted: z.boolean() }), req.body);
    if (!isCategory(body.category) || body.category === 'cycle' && false) throw new HttpError(400, 'Неизвестная категория', 'invalid_category');
    await withTransaction(pool, async (client) => {
      await client.query('UPDATE sharing_permissions SET granted = $1, changed_by = $2 WHERE pair_id = $3 AND category = $4', [body.granted, auth.userId, auth.pairId, body.category]);
      await audit(client, { actorUserId: auth.userId, eventType: 'permission_changed', objectType: 'sharing_permission', objectId: auth.pairId, metadata: { category: body.category, granted: body.granted } });
    });
    res.json({ category: body.category, granted: body.granted });
  }));

  app.get('/api/cycles', route(async (req, res) => {
    const auth = authFrom(req);
    const from = one(req.query.from);
    const to = one(req.query.to);
    const params: unknown[] = [auth.userId];
    const filters = ['owner_user_id = $1'];
    if (from && isRealDate(from)) { params.push(from); filters.push(`period_start >= $${params.length}`); }
    if (to && isRealDate(to)) { params.push(to); filters.push(`period_start <= $${params.length}`); }
    const result = await pool.query(`SELECT id, period_start, period_end, source, source_author, created_at, updated_at FROM cycle_entries WHERE ${filters.join(' AND ')} ORDER BY period_start DESC LIMIT 500`, params);
    res.json({ cycles: result.rows });
  }));

  app.post('/api/cycles', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'cycle-write' }), route(async (req, res) => {
    const auth = ownerOrUnpaired(req);
    const body = bodyOf(cycleSchema, req.body);
    if (body.periodEnd && body.periodEnd < body.periodStart) throw new HttpError(400, 'Дата окончания раньше даты начала', 'invalid_date_range');
    const result = await pool.query(
      `INSERT INTO cycle_entries (owner_user_id, period_start, period_end) VALUES ($1, $2, $3)
       ON CONFLICT (owner_user_id, period_start) DO UPDATE SET period_end = EXCLUDED.period_end, source = 'manual', updated_at = now()
       RETURNING *`,
      [auth.userId, body.periodStart, body.periodEnd ?? null],
    );
    res.status(201).json({ cycle: result.rows[0] });
  }));

  app.delete('/api/cycles/:id', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'cycle-delete' }), route(async (req, res) => {
    const auth = ownerOrUnpaired(req);
    const result = await pool.query('DELETE FROM cycle_entries WHERE id = $1 AND owner_user_id = $2 RETURNING id', [req.params.id, auth.userId]);
    if (!result.rowCount) throw new HttpError(404, 'Запись не найдена', 'not_found');
    res.status(204).end();
  }));

  app.get('/api/diary', route(async (req, res) => {
    const auth = authFrom(req);
    const from = one(req.query.from);
    const to = one(req.query.to);
    const params: unknown[] = [auth.userId];
    const filters = ['owner_user_id = $1'];
    if (from && isRealDate(from)) { params.push(from); filters.push(`log_date >= $${params.length}`); }
    if (to && isRealDate(to)) { params.push(to); filters.push(`log_date <= $${params.length}`); }
    const result = await pool.query(`SELECT * FROM daily_logs WHERE ${filters.join(' AND ')} ORDER BY log_date DESC LIMIT 500`, params);
    res.json({ logs: result.rows });
  }));

  app.put('/api/diary/:date', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'diary-write' }), route(async (req, res) => {
    const auth = ownerOrUnpaired(req);
    if (!isRealDate(req.params.date)) throw new HttpError(400, 'Некорректная дата', 'invalid_date');
    const body = bodyOf(dailySchema, req.body);
    const result = await pool.query(
      `INSERT INTO daily_logs (owner_user_id, log_date, symptoms, mood, sleep_hours, sleep_quality, energy, wellbeing, sexual_activity, notes)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (owner_user_id, log_date) DO UPDATE SET symptoms = EXCLUDED.symptoms, mood = EXCLUDED.mood, sleep_hours = EXCLUDED.sleep_hours, sleep_quality = EXCLUDED.sleep_quality, energy = EXCLUDED.energy, wellbeing = EXCLUDED.wellbeing, sexual_activity = EXCLUDED.sexual_activity, notes = EXCLUDED.notes, source = 'manual', updated_at = now()
       RETURNING *`,
      [auth.userId, req.params.date, JSON.stringify(body.symptoms), body.mood ?? null, body.sleepHours ?? null, body.sleepQuality ?? null, body.energy ?? null, body.wellbeing ?? null, body.sexualActivity ?? null, body.notes ?? null],
    );
    res.json({ log: result.rows[0] });
  }));

  app.delete('/api/diary/:date', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'diary-delete' }), route(async (req, res) => {
    const auth = ownerOrUnpaired(req);
    const result = await pool.query('DELETE FROM daily_logs WHERE owner_user_id = $1 AND log_date = $2 RETURNING id', [auth.userId, req.params.date]);
    if (!result.rowCount) throw new HttpError(404, 'Запись не найдена', 'not_found');
    res.status(204).end();
  }));

  app.get('/api/stats', route(async (req, res) => {
    const auth = authFrom(req);
    const result = await pool.query('SELECT period_start, period_end FROM cycle_entries WHERE owner_user_id = $1 ORDER BY period_start', [auth.userId]);
    res.json({ stats: cycleStats(result.rows.map((row) => ({ periodStart: String(row.period_start), periodEnd: row.period_end ? String(row.period_end) : null }))) });
  }));

  app.get('/api/forecast', route(async (req, res) => {
    const auth = authFrom(req);
    const result = await pool.query('SELECT period_start, period_end FROM cycle_entries WHERE owner_user_id = $1 ORDER BY period_start', [auth.userId]);
    const today = resolveToday(one(req.query.today));
    res.json(buildForecast(result.rows.map((row) => ({ periodStart: String(row.period_start), periodEnd: row.period_end ? String(row.period_end) : null })), today));
  }));

  app.get('/api/shared', route(async (req, res) => {
    const auth = partner(req);
    const requested = one(req.query.category);
    if (requested && !isCategory(requested)) throw new HttpError(400, 'Неизвестная категория', 'invalid_category');
    const categories: Category[] = requested ? [requested as Category] : [...CATEGORIES];
    const granted: Category[] = (await Promise.all(categories.map(async (category) => ({ category, ok: await permission(pool, auth.pairId as string, category) })))).filter((item) => item.ok).map((item) => item.category);
    const result: Record<string, unknown> = { categories: granted };
    const ownerRow = await pool.query("SELECT user_id FROM pair_members WHERE pair_id = $1 AND role = 'owner' AND left_at IS NULL", [auth.pairId]);
    if (!ownerRow.rowCount) {
      res.json(result);
      return;
    }
    const ownerId = ownerRow.rows[0].user_id;
    const from = one(req.query.from);
    const to = one(req.query.to);
    if (granted.includes('cycle')) {
      const cycles = await pool.query('SELECT period_start, period_end, source, source_author FROM cycle_entries WHERE owner_user_id = $1 ORDER BY period_start DESC LIMIT 500', [ownerId]);
      result.cycles = cycles.rows;
    }
    const dailyCategories = granted.filter((category) => category !== 'cycle');
    if (dailyCategories.length) {
      const logs = await pool.query('SELECT * FROM daily_logs WHERE owner_user_id = $1 AND ($2::date IS NULL OR log_date >= $2) AND ($3::date IS NULL OR log_date <= $3) ORDER BY log_date DESC LIMIT 500', [ownerId, from && isRealDate(from) ? from : null, to && isRealDate(to) ? to : null]);
      result.logs = logs.rows.map((row) => {
        const record = dailyRecord(row as Record<string, unknown>);
        const values = dailyCategories.map((category) => projectDaily(category, record)).filter(Boolean);
        return { date: record.logDate, values };
      });
    }
    res.json(result);
  }));

  app.get('/api/partner/observations', route(async (req, res) => {
    const auth = partner(req);
    const result = await pool.query('SELECT * FROM partner_observations WHERE pair_id = $1 AND author_user_id = $2 ORDER BY observed_on DESC, created_at DESC LIMIT 500', [auth.pairId, auth.userId]);
    res.json({ observations: result.rows });
  }));

  app.post('/api/partner/observations', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'observation-write' }), route(async (req, res) => {
    const auth = partner(req);
    const body = bodyOf(observationSchema, req.body);
    const result = await pool.query(
      `INSERT INTO partner_observations (pair_id, author_user_id, observed_on, mood, fatigue, sleepiness, appetite, behavior_changes, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [auth.pairId, auth.userId, body.observedOn, body.mood ?? null, body.fatigue ?? null, body.sleepiness ?? null, body.appetite ?? null, body.behaviorChanges ?? null, body.note ?? null],
    );
    res.status(201).json({ observation: result.rows[0] });
  }));

  app.delete('/api/partner/observations/:id', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.write, name: 'observation-delete' }), route(async (req, res) => {
    const auth = partner(req);
    const result = await pool.query('DELETE FROM partner_observations WHERE id = $1 AND pair_id = $2 AND author_user_id = $3 RETURNING id', [req.params.id, auth.pairId, auth.userId]);
    if (!result.rowCount) throw new HttpError(404, 'Наблюдение не найдено', 'not_found');
    res.status(204).end();
  }));

  app.patch('/api/settings/notifications', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.permission, name: 'settings' }), route(async (req, res) => {
    const auth = authFrom(req);
    const body = bodyOf(z.object({ consent: z.boolean(), preferences: prefsSchema.optional() }), req.body);
    const result = await pool.query(
      'UPDATE users SET notifications_consented_at = CASE WHEN $1 THEN COALESCE(notifications_consented_at, now()) ELSE NULL END, notification_prefs = $2::jsonb WHERE id = $3 RETURNING notifications_consented_at, notification_prefs',
      [body.consent, JSON.stringify(body.preferences ?? {}), auth.userId],
    );
    res.json({ consentedAt: result.rows[0].notifications_consented_at, preferences: result.rows[0].notification_prefs });
  }));

  app.post('/api/imports/preview', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.import, name: 'import' }), route(async (req, res) => {
    owner(req);
    const payload = req.body && typeof req.body === 'object' && 'data' in req.body ? (req.body as { data: unknown }).data : req.body;
    const report = parseFlo(payload);
    const auth = owner(req);
    const result = await pool.query(
      `INSERT INTO imports (owner_user_id, status, unknown_fields_report, not_imported_report, preview, expires_at)
       VALUES ($1, 'preview', $2::jsonb, $3::jsonb, $4::jsonb, now() + interval '30 minutes') RETURNING id, status, created_at, expires_at`,
      [auth.userId, JSON.stringify(report.unknownFields), JSON.stringify(report.notImported), JSON.stringify(report)],
    );
    res.status(201).json({ import: result.rows[0], report });
  }));

  app.post('/api/imports/:id/confirm', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.import, name: 'import-confirm' }), route(async (req, res) => {
    const auth = owner(req);
    const result = await withTransaction(pool, async (client) => {
      const rowResult = await client.query('SELECT * FROM imports WHERE id = $1 AND owner_user_id = $2 FOR UPDATE', [req.params.id, auth.userId]);
      if (!rowResult.rowCount) throw new HttpError(404, 'Импорт не найден', 'not_found');
      const row = rowResult.rows[0] as { status: string; expires_at: string; preview: FloParse | null };
      if (row.status !== 'preview') throw new HttpError(409, 'Импорт уже обработан', 'import_already_processed');
      if (!row.preview || new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE imports SET status = 'expired', preview = NULL WHERE id = $1", [req.params.id]);
        throw new HttpError(410, 'Предпросмотр импорта истёк', 'import_expired');
      }
      let added = 0;
      let skipped = 0;
      for (const cycle of row.preview.cycles) {
        const inserted = await client.query(
          `INSERT INTO cycle_entries (owner_user_id, period_start, period_end, source, source_author, source_record_key)
           VALUES ($1, $2, $3, 'flo', $4, $5)
           ON CONFLICT DO NOTHING RETURNING id`,
          [auth.userId, cycle.periodStart, cycle.periodEnd, cycle.sourceAuthor, cycle.sourceKey],
        );
        if (inserted.rowCount) added += 1; else skipped += 1;
      }
      for (const log of row.preview.logs) {
        const inserted = await client.query(
          `INSERT INTO daily_logs (owner_user_id, log_date, symptoms, mood, sleep_hours, sleep_quality, energy, wellbeing, sexual_activity, notes, source, source_author, source_record_key)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, 'flo', $11, $12)
           ON CONFLICT DO NOTHING RETURNING id`,
          [auth.userId, log.date, JSON.stringify(log.symptoms), log.mood, log.sleepHours, log.sleepQuality, log.energy, log.wellbeing, log.sexualActivity, log.notes, log.sourceAuthor, log.sourceKey],
        );
        if (inserted.rowCount) added += 1; else skipped += 1;
      }
      await client.query("UPDATE imports SET status = 'confirmed', added_count = $2, skipped_count = $3, preview = NULL WHERE id = $1", [req.params.id, added, skipped]);
      await audit(client, { actorUserId: auth.userId, eventType: 'import_confirmed', objectType: 'import', objectId: req.params.id, metadata: { added, skipped } });
      return { added, skipped };
    });
    res.json({ importId: req.params.id, ...result });
  }));

  app.delete('/api/account', rateLimit({ windowMs: config.limits.windowMs, max: config.limits.delete, name: 'account-delete' }), route(async (req, res) => {
    const auth = authFrom(req);
    const body = bodyOf(z.object({ confirm: z.literal(true) }), req.body);
    void body;
    await withTransaction(pool, async (client) => {
      const member = await client.query('SELECT pair_id FROM pair_members WHERE user_id = $1 FOR UPDATE', [auth.userId]);
      if (member.rowCount) {
        const pairId = member.rows[0].pair_id;
        await client.query("UPDATE pairs SET status = 'dissolved' WHERE id = $1", [pairId]);
        await client.query('UPDATE pair_invites SET revoked_at = now() WHERE pair_id = $1 AND used_at IS NULL', [pairId]);
        await audit(client, { actorUserId: auth.userId, eventType: 'account_deleted', objectType: 'user', objectId: auth.userId, metadata: { pairId } });
        await client.query('DELETE FROM pair_members WHERE pair_id = $1', [pairId]);
      } else {
        await audit(client, { actorUserId: auth.userId, eventType: 'account_deleted', objectType: 'user', objectId: auth.userId });
      }
      await client.query('DELETE FROM users WHERE id = $1', [auth.userId]);
    });
    res.setHeader('Set-Cookie', 'nova_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
    res.status(204).end();
  }));

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => jsonError(error, res, next));
  app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера', code: 'internal_error' });
  });
  return app;
}

function ownerOrUnpaired(req: Request): AuthContext {
  const auth = authFrom(req);
  if (auth.role === 'partner') throw new HttpError(403, 'Партнёр не может изменять дневник владелицы', 'owner_required');
  if (auth.role === 'owner' && auth.pairStatus !== 'active') throw new HttpError(409, 'Пара не активна', 'pair_inactive');
  return auth;
}
