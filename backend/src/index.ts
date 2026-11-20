import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { startBot } from './bot.js';
import { startTipScheduler } from './digest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: process.env.NOVA_ENV_FILE ?? path.resolve(here, '../../.env') });

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);

if (config.devAuthBypass) {
  console.warn('DEV_AUTH_BYPASS is enabled. Telegram login can be skipped. This must stay off in production.');
}

const app = createApp(config, pool);
const server = app.listen(config.port, config.bindHost, () => {
  console.log(`Nova API listening on http://${config.bindHost}:${config.port}`);
});

let stopBot = () => {};
let stopTips = () => {};
if (config.enableBot) {
  stopBot = startBot(config);
  stopTips = startTipScheduler(config, pool);
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopBot();
  stopTips();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
