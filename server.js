const express = require('express');
const crypto = require('crypto');
const { Pool } = require('pg');

const TOKEN = process.env.BOT_TOKEN;
const OWNER = String(process.env.OWNER_ID || '');
const PARTNER = String(process.env.PARTNER_ID || '');
const BASE = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const HOOK = crypto.createHash('sha256').update(TOKEN || '').digest('hex').slice(0, 32);

const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const tg = (method, body) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// Проверка, что запрос действительно пришёл из телеграма, и от кого именно
function userFrom(initData) {
  const p = new URLSearchParams(initData || '');
  const hash = p.get('hash');
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(str).digest('hex');
  if (!hash || calc !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return String(JSON.parse(p.get('user')).id); } catch { return null; }
}

function auth(req, res, next) {
  const id = userFrom(req.get('x-init'));
  if (!id || (id !== OWNER && id !== PARTNER)) return res.status(403).json({ error: 'forbidden' });
  req.role = id === OWNER ? 'owner' : 'viewer';
  next();
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/api/data', auth, async (req, res) => {
  const { rows } = await db.query('SELECT day, period, sex, symptoms, note FROM entries');
  const data = {};
  rows.forEach(r => { data[r.day] = { period: r.period, sex: r.sex, symptoms: JSON.parse(r.symptoms), note: r.note }; });
  res.json({ role: req.role, data });
});

app.post('/api/day', auth, async (req, res) => {
  if (req.role !== 'owner') return res.status(403).json({ error: 'read only' });
  const { date, period, sex, symptoms, note } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'bad date' });
  const syms = Array.isArray(symptoms) ? symptoms.slice(0, 30).map(String) : [];
  const text = String(note || '').slice(0, 1000);
  if (!period && !sex && !syms.length && !text) {
    await db.query('DELETE FROM entries WHERE day = $1', [date]);
  } else {
    await db.query(
      `INSERT INTO entries (day, period, sex, symptoms, note) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (day) DO UPDATE SET period=$2, sex=$3, symptoms=$4, note=$5`,
      [date, !!period, !!sex, JSON.stringify(syms), text]
    );
  }
  res.json({ ok: true });
});

// Сообщения от телеграма
app.post(`/webhook/${HOOK}`, async (req, res) => {
  res.sendStatus(200);
  const m = req.body.message;
  if (!m || !m.text) return;
  const id = String(m.from.id);
  const chat = m.chat.id;
  if (m.text.startsWith('/id')) {
    return tg('sendMessage', { chat_id: chat, text: `Твой id: ${id}` });
  }
  if (id !== OWNER && id !== PARTNER) {
    return tg('sendMessage', { chat_id: chat, text: 'Этот бот приватный.' });
  }
  tg('sendMessage', {
    chat_id: chat,
    text: 'Открой календарь кнопкой ниже.',
    reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: BASE } }]] },
  });
});

(async () => {
  await db.query(`CREATE TABLE IF NOT EXISTS entries (
    day TEXT PRIMARY KEY, period BOOLEAN, sex BOOLEAN, symptoms TEXT, note TEXT)`);
  const port = process.env.PORT || 3000;
  app.listen(port, async () => {
    console.log('Nova запущена');
    if (TOKEN && BASE) await tg('setWebhook', { url: `${BASE}/webhook/${HOOK}` });
  });
})();
