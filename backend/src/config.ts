import { isPrivateDatabaseHost } from './security.js';

export type AppConfig = {
  nodeEnv: string;
  port: number;
  bindHost: string;
  databaseUrl: string;
  botToken: string;
  botUsername: string;
  webAppUrl: string;
  devAuthBypass: boolean;
  initDataMaxAgeSeconds: number;
  sessionTtlHours: number;
  inviteTtlHours: number;
  allowedOrigins: string[];
  trustProxy: boolean;
  enableBot: boolean;
  tipsHour: number;
  tipsTimezone: string;
  limits: {
    windowMs: number;
    global: number;
    auth: number;
    invite: number;
    import: number;
    delete: number;
    permission: number;
    write: number;
  };
};

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const devAuthBypass = env.DEV_AUTH_BYPASS === 'true';
  const bindHost = env.BIND_HOST ?? '127.0.0.1';
  const databaseUrl = env.DATABASE_URL ?? '';
  const botToken = env.BOT_TOKEN ?? '';
  const webAppUrl = env.WEBAPP_URL ?? '';
  const loopback = bindHost === '127.0.0.1' || bindHost === 'localhost' || bindHost === '::1';

  if (devAuthBypass && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('DEV_AUTH_BYPASS is allowed only when NODE_ENV is development or test');
  }
  if (devAuthBypass && !loopback) {
    throw new Error('DEV_AUTH_BYPASS cannot be used when BIND_HOST is not loopback');
  }
  if (nodeEnv === 'production') {
    if (!databaseUrl) throw new Error('DATABASE_URL is required in production');
    let databaseHost: string;
    try {
      databaseHost = new URL(databaseUrl).hostname;
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
    }
    if (!isPrivateDatabaseHost(databaseHost)) {
      throw new Error('In production DATABASE_URL must point at localhost or a private network');
    }
    if (botToken.length < 10) throw new Error('BOT_TOKEN is required in production');
    if (!webAppUrl.startsWith('https://')) throw new Error('WEBAPP_URL must use https in production');
  }

  const relaxed = nodeEnv === 'test';
  return {
    nodeEnv,
    port: intEnv(env, 'PORT', 3000),
    bindHost,
    databaseUrl,
    botToken,
    botUsername: env.BOT_USERNAME ?? '',
    webAppUrl,
    devAuthBypass,
    initDataMaxAgeSeconds: intEnv(env, 'INITDATA_MAX_AGE_SECONDS', 86_400),
    sessionTtlHours: intEnv(env, 'SESSION_TTL_HOURS', 720),
    inviteTtlHours: intEnv(env, 'INVITE_TTL_HOURS', 72),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    trustProxy: nodeEnv === 'production',
    enableBot: env.BOT_ENABLED === 'true',
    tipsHour: intEnv(env, 'TIPS_HOUR', 10),
    tipsTimezone: env.TIPS_TIMEZONE ?? 'Europe/Moscow',
    limits: {
      windowMs: 60 * 60 * 1000,
      global: relaxed ? 10_000 : 300,
      auth: relaxed ? 10_000 : 20,
      invite: relaxed ? 10_000 : 10,
      import: relaxed ? 10_000 : 15,
      delete: relaxed ? 10_000 : 5,
      permission: relaxed ? 10_000 : 60,
      write: relaxed ? 10_000 : 120,
    },
  };
}
