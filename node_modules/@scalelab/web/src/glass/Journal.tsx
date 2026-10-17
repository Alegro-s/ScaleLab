import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JournalEvent, ReportVersion, Session } from '@masshtablab/shared';
import { api, type DiffResult } from '../api';
import { useWs } from '../session';
import { errText, useToast } from '../state';
import { Badge, Btn, Empty, ErrorState, Icon, Loading, Modal, Notice, Select, Seg, download } from '../ui/atoms';
import { dateTime, num, pad3, time } from '../lib/fmt';
import { GlassFrame, GlobalBar } from './Shell';

const ICON: Record<string, string> = { version: 'description', export: 'download', calibration: 'grid_on', measurement: 'pentagon', segmentation: 'auto_fix_high', upload: 'upload', session: 'add_circle' };

export function JournalBody({ sessionId }: { sessionId: string }) {
  const { toast } = useToast();
  const [events, setEvents] = useState<JournalEvent[] | null>(null);
  const [vers, setVers] = useState<ReportVersion[]>([]);
  const [f, setF] = useState<'all' | 'version' | 'export' | 'calibration'>('all');
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [intact, setIntact] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [e, v] = await Promise.all([api.events(sessionId), api.versions(sessionId)]);
      setEvents(e); setVers(v); setErr('');
      setB((cur) => cur ?? v[0]?.number ?? null); setA((cur) => cur ?? v[1]?.number ?? v[0]?.number ?? null);
    } catch (x) { setErr(errText(x)); }
  }, [sessionId]);
  useEffect(() => { setEvents(null); setA(null); setB(null); void load(); }, [load]);
  useEffect(() => { setDiff(null); if (a && b) api.diff(sessionId, a, b).then(setDiff).catch(() => {}); }, [sessionId, a, b]);
  useEffect(() => { setIntact(null); if (b) api.version(sessionId, b).then((v) => setIntact(v.intact)).catch(() => setIntact(false)); }, [sessionId, b]);

  const cur = vers.find((v) => v.number === b);
  const shown = (events ?? []).filter((e) => f === 'all' || e.kind === f);
  const restore = async () => { if (!a) return; try { const r = await api.restore(sessionId, a); toast(`Создана версия v${r.number} (откат к v${a})`, 'ok'); setB(null); setA(null); await load(); } catch (e) { toast(errText(e), 'err'); } };

  if (err) return <ErrorState text={err} retry={load} />;
  if (!events) return <Loading />;
  return (
    <div className="g-jr">
      <section className="g-panel g-col">
        <div className="g-row g-between"><h2 className="g-h2">Журнал</h2><span className="bdg">сегодня</span></div>
        <Seg value={f} onChange={setF} options={[{ v: 'all', t: 'Все' }, { v: 'version', t: 'Версии' }, { v: 'export', t: 'Экспорт' }, { v: 'calibration', t: 'Калибровка' }]} />
        <div className="g-col" style={{ gap: 4, maxHeight: '62vh', overflow: 'auto' }}>
          {shown.length === 0 && <p className="g-dim" style={{ padding: 10 }}>Событий нет.</p>}
          {shown.map((e, i) => <div key={e._id ?? i} className="g-ev g-panel2"><Icon n={ICON[e.kind] ?? 'history'} /><span><b style={{ fontWeight: 500 }}>{e.text}</b><small className="g-dim" style={{ display: 'block' }}>{e.user || '—'}</small></span><time>{time(e.ts)}</time></div>)}
        </div>
      </section>
      <section className="g-panel g-col">
        <div className="g-row g-between g-wrap"><h2 className="g-h2">Сравнение версий</h2>
          {vers.length > 0 && <div className="g-row"><Select style={{ width: 100, height: 38 }} value={a ?? ''} onChange={(e) => setA(Number(e.target.value))} aria-label="Версия А">{vers.map((v) => <option key={v.id} value={v.number}>v{v.number}</option>)}</Select><Icon n="arrow_forward" /><Select style={{ width: 100, height: 38 }} value={b ?? ''} onChange={(e) => setB(Number(e.target.value))} aria-label="Версия Б">{vers.map((v) => <option key={v.id} value={v.number}>v{v.number}</option>)}</Select></div>}</div>
        {vers.length === 0 ? <Empty icon="history" title="Версий пока нет" /> : (
          <>
            <div className="g-3m">
              <div className="g-panel2"><small className="g-dim">Изменено</small><div style={{ fontSize: '2em', fontWeight: 500 }}>{diff?.changed ?? '—'}</div></div>
              <div className="g-panel2"><small className="g-dim">Добавлено</small><div style={{ fontSize: '2em', fontWeight: 500, color: 'var(--ok)' }}>{diff ? `+${diff.added}` : '—'}</div></div>
              <div className="g-panel2"><small className="g-dim">Удалено</small><div style={{ fontSize: '2em', fontWeight: 500, color: 'var(--err)' }}>{diff ? `−${diff.removed}` : '—'}</div></div>
            </div>
            <div className="g-diff g-panel2" style={{ padding: 0, minHeight: 120 }}>
              {diff && diff.rows.length === 0 && <div className="g-dim">Различий между v{a} и v{b} нет.</div>}
              {diff?.rows.map((r) => <div key={r.key} className={r.change === 'added' ? 'add' : r.change === 'removed' ? 'rem' : 'chg'}><Icon n={r.change === 'added' ? 'add' : r.change === 'removed' ? 'remove' : 'edit'} /><span>{r.key}</span><span style={{ marginLeft: 'auto' }}>{r.before != null ? num(r.before) : ''}{r.before != null && r.after != null ? ' → ' : ''}{r.after != null ? num(r.after) : ''} {r.unit}</span></div>)}
            </div>
            {cur && <div className="g-panel2 g-row"><Icon n={intact === false ? 'gpp_bad' : 'verified'} /><span className="g-grow"><b style={{ fontWeight: 500 }}>Контрольная сумма v{cur.number}</b><small className="g-dim" style={{ display: 'block', wordBreak: 'break-all' }}>SHA-256, {cur.sha256}</small></span><Badge tone={intact === false ? 'err' : intact ? 'ok' : 'mute'}>{intact === false ? 'изменена!' : intact ? 'цела' : 'проверка…'}</Badge></div>}
            <div className="g-row g-wrap" style={{ marginTop: 'auto' }}>
              <Btn icon="visibility" onClick={() => setOpen(true)} disabled={!b}>Открыть v{b}</Btn>
              <Btn icon="download" onClick={() => b && download(api.exportUrl(sessionId, ['pdf'], { version: b }))} disabled={!b}>Скачать v{b}</Btn>
              <Btn v="p" icon="undo" onClick={restore} disabled={!a || a === vers[0]?.number} title={a === vers[0]?.number ? 'Это уже последняя версия' : undefined}>Откатиться к v{a}</Btn>
            </div>
          </>
        )}
      </section>
      {open && b && <VersionModal sessionId={sessionId} n={b} onClose={() => setOpen(false)} />}
    </div>
  );
}

function VersionModal({ sessionId, n, onClose }: { sessionId: string; n: number; onClose: () => void }) {
  const [v, setV] = useState<Awaited<ReturnType<typeof api.version>> | null>(null);
  useEffect(() => { api.version(sessionId, n).then(setV).catch(() => {}); }, [sessionId, n]);
  return (
    <Modal title={`Версия v${n}`} onClose={onClose} foot={<Btn onClick={onClose}>Закрыть</Btn>}>
      {!v ? <Loading /> : <>
        <p className="g-dim">{dateTime(v.created_at)}, {v.payload.operator}</p><h3>{v.payload.title}</h3>
        {v.payload.samples.map((s) => <div key={s.slot} className="g-panel2"><b>{s.name}</b>, {num(s.px_per_mm, 1)} px/мм{s.measurements.map((m) => <div key={m.label} className="g-kv"><span>{m.label}</span><b>{num(m.value)} {m.unit}</b></div>)}</div>)}
        {v.payload.conclusions.map((c, i) => <Notice key={i} icon="fact_check">{c}</Notice>)}
      </>}
    </Modal>
  );
}

export function GlassVersions() { const ws = useWs(); return <JournalBody sessionId={ws.session!.id} />; }

export function GlassJournal() {
  const nav = useNavigate();
  const [list, setList] = useState<Session[] | null>(null);
  const [sid, setSid] = useState('');
  useEffect(() => { api.sessions().then((l) => { setList(l); setSid(l[0]?.id ?? ''); }).catch(() => setList([])); }, []);
  return (
    <GlassFrame bar={<GlobalBar />}>
      {!list ? <Loading /> : list.length === 0 ? <Empty icon="history" title="Журнал пуст" action={<Btn v="p" onClick={() => nav('/')}>На главную</Btn>} /> : (
        <>
          <div className="g-row g-wrap"><h1 className="g-h2" style={{ fontSize: '1.8em' }}>Журнал</h1><Select style={{ maxWidth: 360 }} value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Сессия">{list.map((s) => <option key={s.id} value={s.id}>№{pad3(s.number)}, {s.title}</option>)}</Select></div>
          {sid && <JournalBody sessionId={sid} />}
        </>
      )}
    </GlassFrame>
  );
}
