import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STATUS_RU, STEP_RU, type JournalEvent, type Sample, type Session, type Stats } from '@masshtablab/shared';
import { api } from '../api';
import { useAuth, errText, useToast } from '../state';
import { Badge, Empty, ErrorState, Icon, Loading, Metric, Seg, type Tone } from '../ui/atoms';
import { date, dayShort, greeting, num, pad3, time, weekdayLong } from '../lib/fmt';
import { useTip } from '../lib/tips';
import { GlassFrame, GlobalBar, NewSession } from './Shell';

export const statusTone = (s: Session['status']): Tone => (s === 'ready' ? 'info' : s === 'review' ? 'warn' : s === 'in_progress' ? 'mute' : 'mute');
export const statusLabel = (s: Session['status']) => (s === 'ready' ? 'отчёт готов' : s === 'in_progress' ? 'в работе' : s === 'review' ? 'нужна проверка' : 'черновик');

export function GlassHome() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, Sample[]>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [events, setEvents] = useState<JournalEvent[]>([]);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'all' | 'work' | 'ready'>('all');
  const [q, setQ] = useState('');
  const tip = useTip();

  const load = async () => {
    try {
      const list = await api.sessions();
      setSessions(list); setErr('');
      api.stats().then(setStats).catch(() => {});
      if (list[0]) api.events(list[0].id).then(setEvents).catch(() => {});
      const all = await api.samples();
      const by: Record<string, Sample[]> = {};
      for (const s of all) (by[s.session_id] ??= []).push(s);
      setThumbs(by);
    } catch (e) { setErr(errText(e)); }
  };
  useEffect(() => { void load(); }, []);

  const shown = useMemo(() => (sessions ?? []).filter((s) => (filter === 'all' || (filter === 'ready' ? s.status === 'ready' : s.status !== 'ready')) && (!q || s.title.toLowerCase().includes(q.toLowerCase()))), [sessions, filter, q]);
  const cur = sessions?.find((s) => s.status === 'in_progress') ?? sessions?.[0];
  const first = (user?.full_name || '').split(' ')[0] || 'коллега';

  const demo = async () => { try { const s = await api.seedDemo(); nav(`/session/${s.id}/calibration`); } catch (e) { toast(errText(e), 'err'); } };

  return (
    <GlassFrame bar={<GlobalBar onSearch={setQ} />}>
      <div className="g-home">
        <div className="g-col" style={{ gap: 24 }}>
          <div style={{ paddingTop: 9 }}><h1 className="g-hi">{greeting()}, <em>{first}</em></h1><p className="g-dim" style={{ marginTop: 15 }}>{weekdayLong()}, {sessions?.filter((s) => s.status === 'in_progress').length ?? 0} сессии в работе</p></div>
          <div className="g-quick">
            <NewCard />
            <button className="g-qcard" disabled={!cur} onClick={() => cur && nav(`/session/${cur.id}`)}><span className="g-qico"><Icon n="history" /></span><b>{cur ? `Продолжить №${pad3(cur.number)}` : 'Нет сессий'}</b><small>{cur ? `Шаг ${['upload', 'calibration', 'measurement', 'comparison', 'report'].indexOf(cur.step) + 1}, ${STEP_RU[cur.step]}` : 'Создайте первую'}</small></button>
            <button className="g-qcard" onClick={demo}><span className="g-qico"><Icon n="layers" /></span><b>Демо-образцы</b><small>Синтетические срезы с эталоном</small></button>
          </div>
          <div className="g-row g-between g-wrap"><h2 className="g-h2">Последние сессии</h2><Seg value={filter} onChange={setFilter} options={[{ v: 'all', t: 'Все' }, { v: 'work', t: 'В работе' }, { v: 'ready', t: 'Готовые' }]} /></div>
          {err ? <ErrorState text={err} retry={load} /> : !sessions ? <Loading /> : shown.length === 0 ? (
            <Empty icon="photo_library" title={sessions.length ? 'Ничего не найдено' : 'Пока нет сессий'} text={sessions.length ? 'Измените фильтр или строку поиска.' : 'Создайте сессию или откройте демо-образцы'} />
          ) : (
            <div className="g-sessions">
              {shown.map((s) => {
                const sm = (thumbs[s.id] ?? []).sort((a, b) => a.slot - b.slot);
                const area = sm.map((x) => x.area_mm2).find((v) => v != null);
                return (
                  <button key={s.id} className="g-scard" onClick={() => nav(`/session/${s.id}`)}>
                    <div className="g-thumbs">{[0, 1].map((i) => sm[i] ? <img key={i} src={api.imageUrl(sm[i]!.id)} alt={sm[i]!.name} loading="lazy" /> : <div key={i} className="ph"><Icon n="image" /></div>)}</div>
                    <div className="g-scard-b">
                      <div className="g-row g-between"><b>{s.title}</b><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge></div>
                      <div className="g-row g-between"><small>№{pad3(s.number)}</small><small className="g-hl">{area != null ? `${num(area)} мм²` : '— мм²'}</small><small>{dayShort(s.updated_at)}</small></div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <aside className="g-col" style={{ gap: 14 }}>
          <div className="g-metrics2">
            <div className="g-panel"><Metric label="Сессий за неделю" value={stats?.sessions_week ?? '—'} unit="шт" /></div>
            <div className="g-panel"><Metric label="Погрешность" value={stats?.avg_error_mm2 != null ? num(stats.avg_error_mm2) : '—'} unit="мм²" sub="средняя по замерам площади" /></div>
          </div>
          <div className="g-panel">
            <div className="g-row g-between"><h2 className="g-h3">Активность</h2><span className="g-dim" style={{ fontSize: '.85em' }}>последняя сессия</span></div>
            <div className="g-list" style={{ marginTop: 8 }}>
              {events.length === 0 && <p className="g-dim" style={{ padding: '14px 0' }}>Событий пока нет.</p>}
              {events.slice(0, 5).map((e, i) => <div key={i} className="g-act-i"><Icon n={e.kind === 'calibration' ? 'check' : e.kind === 'measurement' ? 'pentagon' : e.kind === 'upload' ? 'upload' : e.kind === 'export' ? 'download' : 'description'} /><span>{e.text}</span><time>{time(e.ts)}</time></div>)}
            </div>
          </div>
          <button className="g-panel g-tipcard" onClick={tip.next} aria-label="Следующий совет"><div className="g-row g-between"><h2 className="g-h3">Совет</h2><Icon n="autorenew" /></div><p className={`g-dim g-tip${tip.out ? ' out' : ''}`} style={{ marginTop: 8 }}>{tip.text}</p></button>
        </aside>
      </div>
    </GlassFrame>
  );
}

function NewCard() {
  return <div style={{ display: 'contents' }}><NewCardInner /></div>;
}
function NewCardInner() {
  const nav = useNavigate(); const { toast } = useToast();
  return (
    <button className="g-qcard pri" onClick={async () => { try { const s = await api.createSession(`Сессия ${date(new Date().toISOString())}`); nav(`/session/${s.id}/upload`); } catch (e) { toast(errText(e), 'err'); } }}>
      <span className="g-qico"><Icon n="add" /></span><b>Новая сессия</b><small>Два снимка и эталон</small>
    </button>
  );
}
export { STATUS_RU, NewSession };
