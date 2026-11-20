export type TelegramWebApp = { initData: string; initDataUnsafe?: { user?: { first_name?: string; photo_url?: string } }; ready: () => void; expand: () => void; close: () => void; MainButton?: { setText: (text: string) => void; show: () => void; hide: () => void; onClick: (fn: () => void) => void }; }

declare global { interface Window { Telegram?: { WebApp: TelegramWebApp } } }

export function telegramWebApp(): TelegramWebApp | null { return window.Telegram?.WebApp ?? null; }
