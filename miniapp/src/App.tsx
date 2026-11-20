import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api';
import { telegramWebApp } from './telegram';
import { TIPS, PHASE_NAMES, GUIDE, guide, phaseOf, pickTip } from './tips';
import { split, hasSex, logsFromShared, cyclesFromShared, estimateForecast } from './logic';

type View = 'today' | 'calendar' | 'pair' | 'settings';
const categories = [['cycle', 'Цикл'], ['symptoms', 'Симптомы'], ['mood', 'Настроение'], ['sleep', 'Сон'], ['energy', 'Энергия'], ['wellbeing', 'Самочувствие'], ['sexual_activity', 'Сексуальная активность'], ['notes', 'Заметки']];
const ruMonths = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const letters = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
const MOOD = [['Спокойствие', '😌'], ['Радость', '🙂'], ['Много энергии', '🤩'], ['Игривость', '😜'], ['Перепады настроения', '🥲'], ['Раздражение', '😠'], ['Грусть', '😟'], ['Тревога', '😰'], ['Подавленность', '😞'], ['Чувство вины', '😔'], ['Мало энергии', '😴'], ['Апатия', '😑'], ['Растерянность', '😕']];
const SYMPT = [['Всё в порядке', '👍'], ['Боли внизу живота', '🎯'], ['Чувствительная грудь', '💗'], ['Головная боль', '🤕'], ['Прыщи', '😖'], ['Боль в спине', '🧍'], ['Усталость', '🔋'], ['Повышенный аппетит', '🍔'], ['Бессонница', '🌙'], ['Тошнота', '🤢'], ['Вздутие', '🎈'], ['Отёки', '💧']];
const SEX = [['Секса не было', '💔'], ['Секс с защитой', '🔒'], ['Секс без защиты', '🔓'], ['Оральный секс', '💋'], ['Анальный секс', '🍑'], ['Мастурбация', '💞'], ['Интимные прикосновения', '🤍'], ['Секс-игрушки', '🎀'], ['Оргазм', '✨'], ['Сильное желание', '❤️'], ['Среднее желание', '🧡'], ['Слабое желание', '💛']];
const pad = (n: number) => String(n).padStart(2, '0');
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function iso(date: Date) { return date.toISOString().slice(0, 10); }
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const diff = (a: string, b: string) => Math.round((parse(a).getTime() - parse(b).getTime()) / 864e5);
const fmt = (s: string, o: Intl.DateTimeFormatOptions) => parse(s).toLocaleDateString('ru-RU', { ...o, timeZone: 'UTC' });
const range = (a: string | null | undefined, b: string | null | undefined) => { const s = new Set<string>(); if (!a || !b) return s; for (let d = a, i = 0; d <= b && i < 40; d = addDays(d, 1), i++) s.add(d); return s; };
function monthDays(base: Date) { const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)); const offset = (start.getUTCDay() + 6) % 7; const count = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate(); return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, i) => `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(i + 1)}`)] as (string | null)[]; }

export default function App() {
  const [user, setUser] = useState<api.User | null>(null);
  const [cycles, setCycles] = useState<api.Cycle[]>([]);
  const [logs, setLogs] = useState<api.Log[]>([]);
  const [forecast, setForecast] = useState<api.Forecast | null>(null);
  const [pairInfo, setPairInfo] = useState<any>(null);
  const [sharedCats, setSharedCats] = useState<string[]>([]);
  const today = localIso(new Date());
  const [view, setView] = useState<View>('today');
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(new Date());
  const tgUser = telegramWebApp()?.initDataUnsafe?.user;
  const [photoFailed, setPhotoFailed] = useState(false);
  const [sheet, setSheet] = useState<null | 'all' | 'sex'>(null);
  const swipe = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const profile = await api.me();
      setUser(profile.user);
      if (profile.user.role === 'partner') {
        const [sharedData, pairData] = await Promise.all([api.shared(), api.pair()]);
        const shared = cyclesFromShared(sharedData.cycles);
        setCycles(shared); setLogs(logsFromShared(sharedData.logs)); setSharedCats(sharedData.categories);
        setForecast(shared.length ? estimateForecast(shared, localIso(new Date())) : null); setPairInfo(pairData);
      } else {
        const [cycleData, logData, prediction, pairData] = await Promise.all([api.cycles(), api.diary(), api.forecast(), api.pair()]);
        setCycles(cycleData.cycles); setLogs(logData.logs); setForecast(prediction); setPairInfo(pairData);
      }
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
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(t); }, [notice]);

  const isOwner = user?.role !== 'partner';
  const avg = forecast?.averagePeriodLength ?? 5;
  const { periods, starts } = useMemo(() => {
    const periods = new Map<string, number>();
    cycles.forEach((c) => {
      const end = c.period_end ?? addDays(c.period_start, Math.min(avg - 1, Math.max(0, diff(today, c.period_start))));
      for (let i = 0; i < 20 && addDays(c.period_start, i) <= end; i++) periods.set(addDays(c.period_start, i), i + 1);
    });
    return { periods, starts: cycles.map((c) => c.period_start).sort() };
  }, [cycles, avg, today]);
  const predicted = useMemo(() => range(forecast?.nextPeriodStart, forecast?.nextPeriodStart ? addDays(forecast.nextPeriodStart, avg - 1) : null), [forecast, avg]);
  const fertile = useMemo(() => range(forecast?.fertileStart, forecast?.fertileEnd), [forecast]);
  const cycleDay = (d: string) => { const s = [...starts].reverse().find((x) => x <= d); if (!s) return null; const n = diff(d, s) + 1; return n <= 60 ? n : null; };
  const kind = (d: string) => periods.has(d) ? 'period' : predicted.has(d) ? 'pred' : fertile.has(d) ? 'fert' : '';
  const logOf = (d: string) => logs.find((l) => l.log_date === d);
  const status = (d: string): [string, string] => {
    const p = periods.get(d); if (p) return ['Месячные:', `${p}-й день`];
    if (predicted.has(d)) return ['Прогноз месячных:', 'ожидаются'];
    if (forecast?.ovulation === d) return ['Фертильное окно:', 'овуляция'];
    if (fertile.has(d)) return ['Фертильное окно:', 'высокий шанс'];
    const next = forecast?.nextPeriodStart; if (next && diff(next, d) > 0) return ['Месячные через:', `${diff(next, d)} дн.`];
    const cd = cycleDay(d); return ['День цикла:', cd ? `${cd}-й` : '–'];
  };
  const togglePeriod = async () => {
    try {
      const open = periods.has(selected) ? [...starts].reverse().find((s) => s <= selected) : null;
      if (open) { await api.saveCycle(open, selected); setNotice('Месячные закончились'); } else { await api.saveCycle(selected, null); setNotice('Начало месячных отмечено'); }
      await load(true);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось сохранить'); }
  };
  const save = async (value: Partial<api.Log>) => {
    try { await api.saveDiary(selected, value); setNotice('День сохранён'); setSheet(null); await load(true); }
    catch (e) { setNotice(e instanceof Error ? e.message : 'Не удалось сохранить'); }
  };

  if (loading) return <main className="shell loading"><span className="orb" /><p>Nova загружается</p></main>;
  if (error) return <main className="shell centered"><span className="eyebrow">Nova</span><h1>Нужен вход из Telegram</h1><p className="muted">{error}</p>{import.meta.env.DEV && <button className="button" onClick={async () => { await api.signInDev(); await load(); }}>Войти локально</button>}</main>;

  const dayLog = logOf(selected);
  const tokens = [...split(dayLog?.sexual_activity), ...split(dayLog?.mood), ...(dayLog?.symptoms ?? [])];
  const [label, big] = status(selected);
  const cd = cycleDay(selected);
  const wd = (parse(selected).getUTCDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, i) => addDays(selected, i - wd));
  const len = forecast?.averageCycleLength ?? 28;
  const phase = phaseOf(cd, len, avg);
  const tip = phase ? TIPS[isOwner ? 'owner' : 'partner'][phase] : null;
  const tipsCard = tip && <div className="glass tips"><span className="eyebrow">{isOwner ? 'советы для тебя' : 'как сейчас лучше быть рядом'} · {PHASE_NAMES[phase!]}{cd ? `, ${cd}-й день цикла` : ''}</span><h3>{tip.title}</h3><ul>{pickTip(tip.items, cd ?? 0, 4).map((t) => <li key={t}>{t}</li>)}</ul><p className="ahead"><b>Что дальше:</b> {tip.ahead}</p><small>Общие подсказки, у каждого цикла свои особенности.</small></div>;
  const guideCard = <details className="glass tips guide"><summary>Как устроен цикл</summary>{guide(len, avg).map((g) => <p key={g.phase}><b>{PHASE_NAMES[g.phase]}</b> · {g.days}<br />{GUIDE[g.phase]}</p>)}<small>Это усреднённая схема, у каждого человека цикл идёт по-своему.</small></details>;
  const noCycle = !isOwner && !sharedCats.includes('cycle') && <div className="glass tips"><h3>Доступ к циклу не открыт</h3><p className="muted">Попроси её открыть категорию «Цикл» в разделе «Пара», и здесь появятся прогноз и советы.</p></div>;
  const shiftWeek = (n: number) => setSelected(addDays(selected, n * 7));
  const summary = <div className="chips ro">{tokens.length ? tokens.map((t) => <span className="chip on" key={t}>{t}</span>) : <p className="muted">Пока без записей</p>}</div>;
  const forecastCard = forecast && <div className="glass forecast"><span className="eyebrow">примерный прогноз</span><strong>{forecast.nextPeriodStart ? `Следующие месячные – ${fmt(forecast.nextPeriodStart, { day: 'numeric', month: 'long' })}` : 'Отметьте первые месячные, и появится прогноз'}</strong><p>{forecast.basis}</p><small>{forecast.disclaimer}</small></div>;

  return <main className="shell">
    {notice && <div className="notice" role="status">{notice}</div>}
    {view === 'today' && <section className="page">
      <header className="top"><span className="avatar">{tgUser?.photo_url && !photoFailed ? <img src={tgUser.photo_url} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(true)} /> : (tgUser?.first_name ?? user?.displayName ?? 'N').slice(0, 1)}</span><h1>{fmt(selected, { day: 'numeric', month: 'long' })}</h1><button className="icon" aria-label="Календарь" onClick={() => setView('calendar')}>▦</button></header>
      <div className="wknav"><button aria-label="Прошлая неделя" onClick={() => shiftWeek(-1)}>‹</button><div><span>{fmt(week[0], { day: 'numeric', month: 'short' })} – {fmt(week[6], { day: 'numeric', month: 'short' })}</span>{!week.includes(today) && <button className="tdy" onClick={() => setSelected(today)}>к сегодня</button>}</div><button aria-label="Следующая неделя" onClick={() => shiftWeek(1)}>›</button></div>
      <div className="strip" onTouchStart={(e) => { swipe.current = e.touches[0].clientX; }} onTouchEnd={(e) => { if (swipe.current === null) return; const dx = e.changedTouches[0].clientX - swipe.current; swipe.current = null; if (Math.abs(dx) > 50) shiftWeek(dx < 0 ? 1 : -1); }}>{week.map((d) => { const k = kind(d); const n = k === 'period' || k === 'pred' ? cycleDay(d) : null; return <button key={d} className={`sd ${d === selected ? 'sel' : ''}`} onClick={() => setSelected(d)}><em>{d === today ? 'СЕГОДНЯ' : letters[(parse(d).getUTCDay() + 6) % 7]}</em><span className={`c ${k}`}>{Number(d.slice(-2))}{hasSex(logOf(d)) && <u className="hrt">♥</u>}{n && <b>{n}</b>}</span></button>; })}</div>
      <div className="hero"><span>{label}</span><strong>{big}</strong></div>
      {isOwner ? <div className="acts"><button onClick={togglePeriod}><i className="hot">✎</i>{periods.has(selected) ? 'Месячные закончились' : 'Месячные начались'}</button><button onClick={() => setSheet('all')}><i>＋</i>Симптомы</button><button onClick={() => setSheet('sex')}><i>♡</i>Секс</button></div> : <div className="acts one"><button onClick={() => setSheet('all')}><i>☰</i>Записи дня</button></div>}
      {noCycle}{tipsCard}{guideCard}<div className="glass tags"><span className="eyebrow">записи дня</span>{summary}</div>
      {forecastCard}
    </section>}
    {view === 'calendar' && <section className="page">
      <div className="monthline"><button className="round" aria-label="Предыдущий месяц" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 1, 1)))}>‹</button><h2>{ruMonths[month.getUTCMonth()]} <span>{month.getUTCFullYear()}</span></h2><button className="round" aria-label="Следующий месяц" onClick={() => setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)))}>›</button></div>
      <div className="glass cal"><div className="wk">{dayNames.map((d) => <span key={d}>{d}</span>)}</div><div className="grid">{monthDays(month).map((d, i) => { if (!d) return <i key={`e${i}`} />; const l = logOf(d); return <button key={d} className={`cell ${d === selected ? 'sel' : ''} ${d === today ? 'tod' : ''}`} onClick={() => setSelected(d)}><span className={`c ${kind(d)}`}>{Number(d.slice(-2))}</span><small>{hasSex(l) && <u>♥</u>}{l && (l.symptoms.length > 0 || l.mood || l.notes) && <s />}</small></button>; })}</div></div>
      <div className="legend"><span><i className="period" />месячные</span><span><i className="pred" />прогноз</span><span><i className="fert" />фертильные дни</span></div>
      <div className="glass calpanel"><div className="row"><div><h3>{fmt(selected, { day: 'numeric', month: 'long' })}</h3><p className="muted">{cd ? `${cd}-й день цикла` : 'вне цикла'}</p></div><button className="button small" onClick={() => setSheet('all')}>{isOwner ? 'Записать' : 'Открыть'}</button></div>{summary}{isOwner && <button className="button secondary small" onClick={togglePeriod}>{periods.has(selected) ? 'Месячные закончились' : 'Месячные начались'}</button>}</div>
      {!isOwner && <PartnerPanel onNotice={setNotice} />}
    </section>}
    {view === 'pair' && <Pair user={user!} pairInfo={pairInfo} onNotice={setNotice} onReload={load} />}
    {view === 'settings' && <Settings user={user} onReload={() => load(true)} onNotice={setNotice} onLogout={async () => { await api.logout(); location.reload(); }} />}
    {sheet && <DaySheet key={`${selected}${sheet}`} date={selected} today={today} cd={cd} log={dayLog} readOnly={!isOwner} focus={sheet} onClose={() => setSheet(null)} onSave={save} />}
    <nav className="bottomnav">{([['today', '◉', 'Сегодня'], ['calendar', '▦', 'Календарь'], ['pair', '♡', 'Пара'], ['settings', '⚙', 'Настройки']] as const).map(([v, ic, t]) => <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}><i>{ic}</i>{t}</button>)}</nav>
  </main>;
}

function Chips({ list, on, setOn, readOnly }: { list: string[][]; on: string[]; setOn: (v: string[]) => void; readOnly: boolean }) {
  const all = [...list, ...on.filter((t) => !list.some(([l]) => l === t)).map((t) => [t, '•'])];
  return <div className="chips">{all.filter(([l]) => !readOnly || on.includes(l)).map(([l, e]) => <button type="button" key={l} className={`chip ${on.includes(l) ? 'on' : ''}`} disabled={readOnly} onClick={() => setOn(on.includes(l) ? on.filter((x) => x !== l) : [...on, l])}><i>{e}</i>{l}</button>)}{readOnly && !on.length && <p className="muted">Ничего не отмечено</p>}</div>;
}

function DaySheet({ date, today, cd, log, readOnly, focus, onClose, onSave }: { date: string; today: string; cd: number | null; log?: api.Log; readOnly: boolean; focus: 'all' | 'sex'; onClose: () => void; onSave: (v: Partial<api.Log>) => Promise<void> }) {
  const [mood, setMood] = useState(split(log?.mood));
  const [sym, setSym] = useState(log?.symptoms ?? []);
  const [sex, setSex] = useState(split(log?.sexual_activity));
  const [sleep, setSleep] = useState(log?.sleep_hours?.toString() ?? '');
  const [notes, setNotes] = useState(log?.notes ?? '');
  const sexRef = useRef<HTMLElement>(null);
  useEffect(() => { if (focus === 'sex') sexRef.current?.scrollIntoView({ block: 'start' }); }, [focus]);
  return <div className="scrim" onClick={onClose}><div className="sheet" onClick={(e) => e.stopPropagation()}>
    <i className="grab" />
    <div className="sh"><button className="icon" aria-label="Закрыть" onClick={onClose}>✕</button><div><h2>{date === today ? 'Сегодня' : fmt(date, { day: 'numeric', month: 'long' })}</h2>{cd && <p>{cd}-й день цикла</p>}</div><span /></div>
    <div className="body">
      <section className="card"><h3>Настроение</h3><Chips list={MOOD} on={mood} setOn={setMood} readOnly={readOnly} /></section>
      <section className="card"><h3>Симптомы</h3><Chips list={SYMPT} on={sym} setOn={setSym} readOnly={readOnly} /></section>
      <section className="card" ref={sexRef}><h3>Секс и сексуальное желание</h3><Chips list={SEX} on={sex} setOn={setSex} readOnly={readOnly} /></section>
      <section className="card form"><h3>Сон и заметка</h3><label>Сон, часов<input type="number" min="0" max="24" step="0.5" value={sleep} readOnly={readOnly} onChange={(e) => setSleep(e.target.value)} placeholder="8" /></label><label>Заметка<textarea value={notes} readOnly={readOnly} onChange={(e) => setNotes(e.target.value)} placeholder="Что хочется запомнить" /></label></section>
    </div>
    {!readOnly && <button className="button save" onClick={() => onSave({ mood: mood.join(', ') || null, symptoms: sym, sexual_activity: sex.join(', ') || null, sleep_hours: sleep ? Number(sleep) : null, notes: notes || null, energy: log?.energy ?? null, sleep_quality: log?.sleep_quality ?? null, wellbeing: log?.wellbeing ?? null })}>Сохранить</button>}
  </div></div>;
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

function Settings({ user, onReload, onNotice, onLogout }: { user: api.User | null; onReload: () => Promise<void>; onNotice: (value: string) => void; onLogout: () => Promise<void> }) {
  const prefs = user?.notificationPrefs ?? {};
  const tipsOn = !!prefs.tips;
  const setTips = async (on: boolean) => {
    const next = { ...prefs, tips: on };
    const res = await fetch('/api/settings/notifications', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${api.getToken()}` }, body: JSON.stringify({ consent: Object.values(next).some(Boolean), preferences: next }) });
    if (!res.ok) { onNotice('Не удалось сохранить'); return; }
    onNotice(on ? 'Советы в Telegram включены' : 'Советы выключены'); await onReload();
  };
  const [busy, setBusy] = useState(false); const [importId, setImportId] = useState(''); const [report, setReport] = useState<any>(null);
  return <section className="page"><span className="eyebrow">настройки</span><h2>Тихое пространство</h2><p className="muted">Уведомления включаются только после отдельного согласия.</p><button className="button secondary" onClick={async () => { setBusy(true); await fetch('/api/settings/notifications', { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${api.getToken()}` }, body: JSON.stringify({ consent: true, preferences: { ...prefs, reminder: true } }) }); setBusy(false); onNotice('Уведомления включены'); }}>{busy ? 'Сохраняем…' : 'Разрешить напоминания'}</button>{user?.role === 'partner' ? <div className="import-box"><h3>Советы в Telegram</h3><p className="muted">Раз в день бот пришлёт сообщение с советом по текущему дню цикла. Один раз нажмите /start в чате с ботом, иначе он не сможет написать первым. Работает, если в разделе «Пара» открыта категория «Цикл».</p><button className="button" onClick={() => setTips(!tipsOn)}>{tipsOn ? 'Выключить советы' : 'Включить советы'}</button></div> : <p className="muted">Партнёр может включить ежедневные советы в своих настройках. Для этого в разделе «Пара» должна быть открыта категория «Цикл».</p>}<div className="import-box"><h3>Импорт истории Flo</h3><p className="muted">Файл остаётся в приложении до предварительного просмотра и не отправляется во внешние сервисы.</p><input type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file || file.size > 1_000_000) { onNotice('Файл должен быть меньше 1 МБ'); return; } try { const parsed = JSON.parse(await file.text()); const result = await api.previewImport(parsed); setImportId(result.import.id); setReport(result.report); onNotice('Предпросмотр готов'); } catch (e) { onNotice(e instanceof Error ? e.message : 'Не удалось прочитать JSON'); } }} />{report && <><p>Циклов: {report.cycles.length}, дневных записей: {report.logs.length}</p><small>{report.warnings.join(' ')}</small><button className="button" onClick={async () => { await api.confirmImport(importId); setReport(null); setImportId(''); onNotice('История импортирована'); }}>Подтвердить импорт</button></>}</div><button className="text-button" onClick={onLogout}>Выйти</button><button className="text-button danger" onClick={async () => { if (window.confirm('Удалить аккаунт и связанные данные?')) { await api.deleteAccount(); await onLogout(); } }}>Удалить аккаунт</button></section>;
}
