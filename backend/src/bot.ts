import type { AppConfig } from './config.js';

 type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };
 type Update = { update_id: number; message?: { chat: { id: number }; text?: string } };

async function telegram<T>(config: AppConfig, method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json() as TelegramResponse<T>;
  if (!response.ok || !payload.ok || payload.result === undefined) {
    throw new Error(`telegram_${method}_failed:${payload.description ?? response.status}`);
  }
  return payload.result;
}

async function sendWelcome(config: AppConfig, chatId: number): Promise<void> {
  await telegram(config, 'sendMessage', {
    chat_id: chatId,
    text: 'Откройте Nova, чтобы отмечать цикл и дневник. Ваши данные приватны по умолчанию.',
    reply_markup: {
      inline_keyboard: [[{ text: 'Открыть Nova', web_app: { url: config.webAppUrl } }]],
    },
  });
}

export function startBot(config: AppConfig): () => void {
  if (!config.botToken || !config.webAppUrl) {
    throw new Error('BOT_TOKEN and WEBAPP_URL are required when BOT_ENABLED=true');
  }
  const controller = new AbortController();
  let stopped = false;
  let offset = 0;
  let backoff = 1000;

  const poll = async (): Promise<void> => {
    while (!stopped) {
      try {
        const updates = await telegram<Update[]>(config, 'getUpdates', {
          offset,
          timeout: 25,
          allowed_updates: ['message'],
        }, controller.signal);
        backoff = 1000;
        for (const update of updates) {
          offset = update.update_id + 1;
          const message = update.message;
          if (!message?.text) continue;
          if (/^\/(start|app)(?:@\w+)?/.test(message.text) || /^\/help(?:@\w+)?/.test(message.text)) {
            await sendWelcome(config, message.chat.id);
          }
        }
      } catch (error) {
        if (stopped) break;
        console.error('Telegram polling error:', error instanceof Error ? error.message : 'unknown');
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  };
  void controller;
  void poll();
  return () => {
    stopped = true;
    controller.abort();
  };
}

const entry = process.argv[1]?.replaceAll('\\', '/');
if (entry?.endsWith('/src/bot.ts') || entry?.endsWith('/dist/bot.js')) {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dotenv = await import('dotenv');
  const { loadConfig } = await import('./config.js');
  const here = path.dirname(fileURLToPath(import.meta.url));
  dotenv.default.config({ path: process.env.NOVA_ENV_FILE ?? path.resolve(here, '../../.env') });
  const config = loadConfig();
  const stop = startBot(config);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
