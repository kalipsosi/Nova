import type { Pool } from 'pg';
import type { AppConfig } from './config.js';
import { diffDays } from './dates.js';
import { cycleStats } from './forecast.js';
import { deliverNotification } from './notifications.js';
import { PHASE_NAMES, TIPS, phaseOf, pickTip } from './tips.js';

function localParts(timeZone: string, now = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function sendMessage(config: AppConfig, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!response.ok) throw new Error(`telegram_sendMessage_failed:${response.status}`);
}

// Раз в день отправляет партнёру совет по текущему дню цикла владелицы.
// Условия: партнёр сам включил советы, владелица открыла ему категорию «Цикл».
export async function sendDailyTips(config: AppConfig, pool: Pool, today: string): Promise<number> {
  const rows = await pool.query(
    `SELECT pm.pair_id, pu.id AS partner_id, pu.telegram_id, pu.notifications_consented_at, pu.notification_prefs, om.user_id AS owner_id
       FROM pair_members pm
       JOIN users pu ON pu.id = pm.user_id
       JOIN pairs p ON p.id = pm.pair_id AND p.status = 'active'
       JOIN pair_members om ON om.pair_id = pm.pair_id AND om.role = 'owner' AND om.left_at IS NULL
      WHERE pm.role = 'partner' AND pm.left_at IS NULL
        AND pu.notifications_consented_at IS NOT NULL
        AND pu.notification_prefs->>'tips' = 'true'
        AND NOT EXISTS (SELECT 1 FROM tip_deliveries d WHERE d.user_id = pu.id AND d.sent_on = $1)`,
    [today],
  );
  let sent = 0;
  for (const row of rows.rows as Record<string, unknown>[]) {
    try {
      const granted = await pool.query("SELECT granted FROM sharing_permissions WHERE pair_id = $1 AND category = 'cycle'", [row.pair_id]);
      if (granted.rows[0]?.granted !== true) continue;
      const cycles = await pool.query('SELECT period_start, period_end FROM cycle_entries WHERE owner_user_id = $1', [row.owner_id]);
      const stats = cycleStats(cycles.rows.map((c) => ({ periodStart: String(c.period_start), periodEnd: c.period_end ? String(c.period_end) : null })));
      if (!stats.lastPeriodStart) continue;
      const cd = diffDays(stats.lastPeriodStart, today) + 1;
      const phase = phaseOf(cd, stats.averageCycleLength ?? 28, stats.averagePeriodLength ?? 5);
      if (!phase) continue;
      const pack = TIPS.partner[phase];
      const text = [
        `Nova · ${PHASE_NAMES[phase]}, ${cd}-й день цикла`,
        '',
        pack.title,
        ...pickTip(pack.items, cd, 3).map((item) => `• ${item}`),
        '',
        `Что дальше: ${pack.ahead}`,
      ].join('\n');
      const decision = await deliverNotification({
        consented: true,
        prefs: row.notification_prefs as Record<string, boolean>,
        send: () => sendMessage(config, String(row.telegram_id), text),
      });
      if (decision === 'sent') sent += 1;
    } catch (error) {
      console.error('Tip delivery failed:', error instanceof Error ? error.message : 'unknown');
    }
    // Одна попытка в день, чтобы не засыпать повторами, если бот заблокирован.
    await pool.query('INSERT INTO tip_deliveries (user_id, sent_on) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.partner_id, today]);
  }
  return sent;
}

export function startTipScheduler(config: AppConfig, pool: Pool): () => void {
  const tick = async () => {
    try {
      const { date, hour } = localParts(config.tipsTimezone);
      if (hour >= config.tipsHour) await sendDailyTips(config, pool, date);
    } catch (error) {
      console.error('Tip scheduler error:', error instanceof Error ? error.message : 'unknown');
    }
  };
  const first = setTimeout(() => void tick(), 30_000);
  const timer = setInterval(() => void tick(), 10 * 60_000);
  return () => { clearTimeout(first); clearInterval(timer); };
}
