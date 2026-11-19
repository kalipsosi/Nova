export type TelegramWebApp = { initData: string; ready: () => void; expand: () => void; close: () => void; MainButton?: { setText: (text: string) => void; show: () => void; hide: () => void; onClick: (fn: () => void) => void }; }

declare global { interface Window { Telegram?: { WebApp: TelegramWebApp } } }

export function telegramWebApp(): TelegramWebApp | null { return window.Telegram?.WebApp ?? null; }
