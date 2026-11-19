import { useEffect, useMemo, useState } from 'react';
import * as api from './api';
import { telegramWebApp } from './telegram';

type View = 'calendar' | 'diary' | 'pair' | 'settings';
const categories = [['cycle', 'Цикл'], ['symptoms', 'Симптомы'], ['mood', 'Настроение'], ['sleep', 'Сон'], ['energy', 'Энергия'], ['wellbeing', 'Самочувствие'], ['sexual_activity', 'Сексуальная активность'], ['notes', 'Заметки']];
const ruMonths = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
function iso(date: Date) { return date.toISOString().slice(0, 10); }
function monthDays(base: Date) { const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)); const offset = (start.getUTCDay() + 6) % 7; const count = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate(); return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)]; }

export default function App() {
  const [user, setUser] = useState<api.User | null>(null);
  const [cycles, setCycles] = useState<api.Cycle[]>([]);
  const [logs, setLogs] = useState<api.Log[]>([]);
  const [forecast, setForecast] = useState<api.Forecast | null>(null);
  const [pairInfo, setPairInfo] = useState<any>(null);
  const [view, setView] = useState<View>('calendar');
  const [selected, setSelected] = useState(iso(new Date()));
  const [month, setMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await api.me();
      setUser(profile.user);
      const [cycleData, logData, prediction, pairData] = await Promise.all([api.cycles(), api.diary(), api.forecast(), api.pair()]);
      setCycles(cycleData.cycles); setLogs(logData.logs); setForecast(prediction); setPairInfo(pairData);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить Nova'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const tg = telegramWebApp(); tg?.ready(); tg?.expand();
    void (async () => {
      try { if (!api.getToken()) { if (import.meta.env.DEV) await api.signInDev(); else await api.signIn(tg?.initData); } await load(); }
      catch (e) { setError(e instanceof Error ? e.message : 'Не удалось войти'); setLoading(false); }
    })();
  }, []);

  const selectedLog = logs.find((log) => log.log_date === selected);
  const cycleDates = useMemo(() => new Set(cycles.flatMap((cycle) => {
    const dates: string[] = []; const end = cycle.period_end ?? cycle.period_start;
    const cursor = new Date(`${cycle.period_start}T00:00:00Z`); const finish = new Date(`${end}T00:00:00Z`);
    while (cursor <= finish) { dates.push(iso(cursor)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    return dates;
  })), [cycles]);
  const save = async (value: Partial<api.Log>) => { await api.saveDiary(selected, value); setNotice('День сохранён'); await load(); };
  const markPeriod = async () => { await api.saveCycle(selected, null); setNotice('Начало менструации отмечено'); await load(); };

  if (loading) return <main className="shell loading"><span className="orb" /><p>Nova загружается</p></main>;
  if (error) return <main className="shell centered"><span className="eyebrow">Nova</span><h1>Нужен вход из Telegram</h1><p className="muted">{error}</p>{import.meta.env.DEV && <button className="button" onClick={async () => { await api.signInDev(); await load(); }}>Войти локально</button>}</main>;

  return <main className="shell">
    <header className="topbar"><div><span className="eyebrow">{user?.role === 'partner' ? 'кабинет партнёра' : 'личный календарь'}</span><h1>Nova</h1></div><span className="avatar">{(user?.displayName ?? 'N').slice(0, 1)}</span></header>
    {notice && <div className="notice" role="status">{notice}</div>}
    {view === 'calendar' && <Calendar month={month} setMonth={setMonth} selected={selected} setSelected={setSelected} days={monthDays(month)} cycleDates={cycleDates} logs={logs} forecast={forecast} onOpenDiary={() => setView('diary')} onMarkPeriod={markPeriod} isOwner={user?.role !== 'partner'} />}
    {view === 'diary' && <Diary date={selected} log={selectedLog} onSave={save} />}
    {view === 'pair' && <Pair user={user!} pairInfo={pairInfo} onNotice={setNotice} onReload={load} />}
    {view === 'settings' && <Settings onNotice={setNotice} onLogout={async () => { await api.logout(); location.reload(); }} />}
    {user?.role === 'partner' && view === 'calendar' && <PartnerPanel onNotice={setNotice} />}
    <nav className="bottomnav"><button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>Календарь</button><button className={view === 'diary' ? 'active' : ''} onClick={() => setView('diary')}>Дневник</button><button className={view === 'pair' ? 'active' : ''} onClick={() => setView('pair')}>Пара</button><button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>Настройки</button></nav>
  </main>;
}

function Calendar({ month, setMonth, selected, setSelected, days, cycleDates, logs, forecast, onOpenDiary, onMarkPeriod, isOwner }: any) {
  const logDates = new Set(logs.map((log: api.Log) => log.log_date));
  return <section className="page"><div className="monthline"><button className="round" aria-label="Предыдущий месяц" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}>‹</button><h2>{ruMonths[month.getUTCMonth()]} <span>{month.getUTCFullYear()}</span></h2><button className="round" aria-label="Следующий месяц" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}>›</button></div>
    <div className="calendar"><div className="week">{dayNames.map((day) => <span key={day}>{day}</span>)}</div><div className="days">{days.map((day: string | null, index: number) => day ? <button key={day} className={`day ${selected === day ? 'selected' : ''} ${cycleDates.has(day) ? 'period' : ''} ${logDates.has(day) ? 'haslog' : ''} ${forecast?.nextPeriodStart === day ? 'projected' : ''}`} onClick={() => setSelected(day)}><span>{Number(day.slice(-2))}</span></button> : <i key={`empty-${index}`} />)}</div></div>
    <div className="legend"><span><i className="legend-period" />отмечено</span><span><i className="legend-projected" />прогноз</span><span><i className="legend-dot" />дневник</span></div>
    <div className="selected-day"><div><span className="eyebrow">выбранный день</span><h3>{new Date(`${selected}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</h3><p className="muted">{logs.find((log: api.Log) => log.log_date === selected) ? 'Есть запись в дневнике' : 'День пока без записи'}</p></div><div className="selected-actions"><button className="button small" onClick={onOpenDiary}>Дневник</button>{isOwner && <button className="button small secondary" onClick={onMarkPeriod}>Начало цикла</button>}</div></div>
    {forecast && <div className="forecast"><span className="eyebrow">примерный прогноз</span><strong>{forecast.nextPeriodStart ? `Следующая менструация — ${new Date(`${forecast.nextPeriodStart}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}` : 'Добавьте первую отметку'}</strong><p>{forecast.basis}</p><small>{forecast.disclaimer}</small></div>}
  </section>;
}

function Diary({ date, log, onSave }: { date: string; log?: api.Log; onSave: (value: Partial<api.Log>) => Promise<void> }) {
  const [form, setForm] = useState({ mood: log?.mood ?? '', energy: log?.energy ?? '', sleep_hours: log?.sleep_hours?.toString() ?? '', notes: log?.notes ?? '', symptoms: log?.symptoms?.join(', ') ?? '' });
  useEffect(() => setForm({ mood: log?.mood ?? '', energy: log?.energy ?? '', sleep_hours: log?.sleep_hours?.toString() ?? '', notes: log?.notes ?? '', symptoms: log?.symptoms?.join(', ') ?? '' }), [date, log]);
  return <section className="page"><span className="eyebrow">дневник</span><h2>{new Date(`${date}T00:00:00Z`).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</h2><div className="form"><label>Настроение<input value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} placeholder="Как вы себя чувствуете?" /></label><label>Энергия<input value={form.energy} onChange={(e) => setForm({ ...form, energy: e.target.value })} placeholder="Например, спокойно" /></label><label>Сон, часов<input type="number" min="0" max="24" step="0.5" value={form.sleep_hours} onChange={(e) => setForm({ ...form, sleep_hours: e.target.value })} placeholder="8" /></label><label>Симптомы<input value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} placeholder="Через запятую" /></label><label>Заметка<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Что хочется запомнить" /></label><button className="button" onClick={() => onSave({ mood: form.mood, energy: form.energy, sleep_hours: form.sleep_hours ? Number(form.sleep_hours) : null, notes: form.notes, symptoms: form.symptoms.split(',').map((s) => s.trim()).filter(Boolean) })}>Сохранить день</button></div></section>;
}

function Pair({ user, pairInfo, onNotice, onReload }: any) {
  const [invite, setInvite] = useState(''); const [token, setToken] = useState('');
  if (!pairInfo?.pair) return <section className="page"><span className="eyebrow">связь</span><h2>Создать пару</h2><p className="muted">Пара нужна, чтобы выборочно делиться данными с близким человеком.</p><button className="button" onClick={async () => { await api.createPair(); onNotice('Пара создана'); onReload(); }}>Создать пару</button><div className="join"><input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Токен приглашения" /><button className="button secondary" onClick={async () => { await api.redeemInvite(token); onNotice('Вы присоединились к паре'); onReload(); }}>Принять приглашение</button></div></section>;
  return <section className="page"><span className="eyebrow">связь</span><h2>{pairInfo.pair.partner_display_name ? `Пара с ${pairInfo.pair.partner_display_name}` : 'Пара создана'}</h2>{user.role === 'owner' ? <><button className="button" onClick={async () => { const result = await api.createInvite(); setInvite(result.token); }}>Создать приглашение</button>{invite && <div className="invite"><span>Передайте этот код партнёру</span><code>{invite}</code></div>}<h3>Доступ к данным</h3><div className="permissions">{pairInfo.permissions.map((item: any) => <label key={item.category}><span>{categories.find(([key]) => key === item.category)?.[1] ?? item.category}</span><input type="checkbox" checked={item.granted} onChange={async (e) => { await api.updatePermission(item.category, e.target.checked); onNotice('Разрешение обновлено'); onReload(); }} /></label>)}</div></> : <p className="muted">Владелица управляет категориями, которые вам доступны.</p>}</section>;
}

function PartnerPanel({ onNotice }: { onNotice: (value: string) => void }) {
  const [items, setItems] = useState<any[]>([]); const [note, setNote] = useState(''); const [mood, setMood] = useState('');
  const load = () => { void api.observations().then((data) => setItems(data.observations)).catch(() => undefined); };
  useEffect(load, []);
  return <section className="panel"><span className="eyebrow">наблюдения партнёра</span><div className="form"><label>Настроение<input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Например, спокойное" /></label><label>Заметка<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Свободное наблюдение" /></label><button className="button secondary" onClick={async () => { await api.createObservation({ observedOn: iso(new Date()), mood, note }); setMood(''); setNote(''); onNotice('Наблюдение сохранено'); load(); }}>Сохранить наблюдение</button></div>{items.map((item) => <div className="observation" key={item.id}><strong>{item.observed_on}</strong><p>{item.mood || item.note || 'Без текста'}</p><button className="text-button" onClick={async () => { await api.deleteObservation(item.id); onNotice('Наблюдение удалено'); load(); }}>Удалить</button></div>)}</section>;
}

function Settings({ onNotice, onLogout }: { onNotice: (value: string) => void; onLogout: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [importId, setImportId] = useState(''); const [report, setReport] = useState<any>(null);
  return <section className="page"><span className="eyebrow">настройки</span><h2>Тихое пространство</h2><p className="muted">Уведомления включаются только после отдельного согласия.</p><button className="button secondary" onClick={async () => { setBusy(true); await fetch('/api/settings/notifications', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${api.getToken()}` }, body: JSON.stringify({ consent: true, preferences: { reminder: true } }) }); setBusy(false); onNotice('Уведомления включены'); }}>{busy ? 'Сохраняем…' : 'Разрешить напоминания'}</button><div className="import-box"><h3>Импорт истории Flo</h3><p className="muted">Файл остаётся в приложении до предварительного просмотра и не отправляется во внешние сервисы.</p><input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file || file.size > 1_000_000) { onNotice('Файл должен быть меньше 1 МБ'); return; } try { const parsed = JSON.parse(await file.text()); const result = await api.previewImport(parsed); setImportId(result.import.id); setReport(result.report); onNotice('Предпросмотр готов'); } catch (e) { onNotice(e instanceof Error ? e.message : 'Не удалось прочитать JSON'); } }} />{report && <><p>Циклов: {report.cycles.length}, дневных записей: {report.logs.length}</p><small>{report.warnings.join(' ')}</small><button className="button" onClick={async () => { await api.confirmImport(importId); setReport(null); setImportId(''); onNotice('История импортирована'); }}>Подтвердить импорт</button></>}</div><button className="text-button" onClick={onLogout}>Выйти</button><button className="text-button danger" onClick={async () => { if (window.confirm('Удалить аккаунт и связанные данные?')) { await api.deleteAccount(); await onLogout(); } }}>Удалить аккаунт</button></section>;
}
