import { useEffect, useState } from 'react';
import type { ReferenceStandard, Stats, UiMode } from '@masshtablab/shared';
import { api, type Health } from '../api';
import { useAuth, useExtra, usePrefs } from '../state';
import { Badge, Btn, Icon, Loading, Select, Seg, Slider, Toggle } from '../ui/atoms';
import { GlassFrame, GlobalBar } from './Shell';

const SECTIONS = [['main', 'Основные', 'settings'], ['calib', 'Калибровка', 'straighten'], ['store', 'Хранилище', 'folder'], ['about', 'О системе', 'help']] as const;

export function DesignSwitch() {
  const { prefs, setPrefs } = usePrefs();
  const opt = (m: UiMode, t: string) => (
    <button type="button" className={`g-dopt${prefs.ui_mode === m ? ' on' : ''}`} aria-pressed={prefs.ui_mode === m} onClick={() => setPrefs({ ui_mode: m })}>
      <span className="mini" style={m === 'glass' ? { background: 'linear-gradient(135deg,#0c2a30,#10161c)', borderRadius: 14 } : { background: 'var(--fld)', borderTop: '14px solid #2F72AE', borderRadius: 0 }} />
      <b style={{ fontWeight: 500 }}>{t}</b>
    </button>);
  return (
    <>
      <div className="g-design">{opt('glass', 'Современный')}{opt('classic', 'Классический')}</div>
      <div className="g-row g-between g-wrap"><span>Тема</span><Seg value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ v: 'dark', t: 'Тёмная', icon: 'dark_mode' }, { v: 'light', t: 'Светлая', icon: 'light_mode' }]} /></div>
    </>
  );
}

export function GlassSettings() {
  const { prefs, setPrefs } = usePrefs();
  const { extra, setExtra } = useExtra();
  const { user } = useAuth();
  const [sec, setSec] = useState<(typeof SECTIONS)[number][0]>('main');
  const [std, setStd] = useState<ReferenceStandard[]>([]);
  const [st, setSt] = useState<Stats | null>(null);
  const [h, setH] = useState<Health | null | undefined>(undefined);
  useEffect(() => { api.standards().then(setStd).catch(() => {}); api.stats().then(setSt).catch(() => {}); api.health().then(setH).catch(() => setH(null)); }, []);
  const squares = std.filter((s) => s.kind === 'checker' && s.width_mm === s.height_mm);

  return (
    <GlassFrame bar={<GlobalBar />}>
      <div className="g-set">
        <nav className="g-panel g-set-nav" aria-label="Разделы настроек"><h2 className="g-h2" style={{ marginBottom: 6 }}>Настройки</h2>
          {SECTIONS.map(([k, t, ic]) => <button key={k} className={sec === k ? 'on' : ''} onClick={() => setSec(k)}><Icon n={ic} />{t}</button>)}</nav>
        <section className="g-panel g-col">
          {sec === 'main' && <>
            <div><h2 className="g-h2">Основные</h2><p className="g-dim">Вывод чисел и поведение редактора</p></div>
            <div className="g-row"><div className="g-grow fld"><span className="fld-l">Язык</span><Select value="ru" disabled aria-label="Язык"><option value="ru">Русский</option></Select></div>
              <div className="g-grow fld"><span className="fld-l">Точность вывода</span><Select value={prefs.decimals} onChange={(e) => setPrefs({ decimals: Number(e.target.value) })} aria-label="Точность вывода">{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} зн.</option>)}</Select></div></div>
            <div className="g-set-row"><Toggle on={extra.snap} onChange={(v) => setExtra({ snap: v })} label="Привязка к вершинам" hint="Курсор прилипает к ближайшей вершине контура" /></div>
            <div className="g-set-row"><Toggle on={extra.labels} onChange={(v) => setExtra({ labels: v })} label="Показывать подписи на снимке" hint="Значения рядом с замерами" /></div>
            <div className="g-set-row"><Toggle on={prefs.hints} onChange={(v) => setPrefs({ hints: v })} label="Показывать подсказки" hint="Знакомство при первом запуске" /></div>
          </>}
          {sec === 'calib' && <CalibPanel squares={squares} />}
          {sec === 'store' && <Storage st={st} />}
          {sec === 'about' && <About h={h} email={user?.email} />}
        </section>
        <aside className="g-col">
          <div className="g-panel g-col"><h2 className="g-h2">Дизайн интерфейса</h2><DesignSwitch /></div>
          {sec !== 'calib' && <div className="g-panel g-col"><CalibPanel squares={squares} compact /></div>}
        </aside>
      </div>
    </GlassFrame>
  );
}

function CalibPanel({ squares, compact }: { squares: ReferenceStandard[]; compact?: boolean }) {
  const { extra, setExtra } = useExtra();
  const sides = [...new Set([...squares.map((s) => s.width_mm), extra.default_side])];
  return (
    <>
      <h2 className="g-h2">Калибровка по умолчанию</h2>
      <div className="fld"><span className="fld-l">Эталон по умолчанию</span><Select value={extra.default_side} onChange={(e) => setExtra({ default_side: Number(e.target.value) })} aria-label="Эталон по умолчанию">{sides.map((v) => <option key={v} value={v}>Шахматный квадрат {v} × {v} мм</option>)}</Select></div>
      <Slider label="Порог уверенности автопоиска" value={extra.min_confidence} min={0.3} max={1} step={0.01} fmt={(v) => v.toFixed(2)} onChange={(v) => setExtra({ min_confidence: v })} />
      <Slider label="Допустимый перекос эталона, %" value={extra.skew_tol} min={0.5} max={10} step={0.5} fmt={(v) => `${v} %`} onChange={(v) => setExtra({ skew_tol: v })} />
      <Toggle on={extra.warn_plane} onChange={(v) => setExtra({ warn_plane: v })} label="Предупреждать о перекосе эталона" />
      <Toggle on={extra.require_review} onChange={(v) => setExtra({ require_review: v })} label="Требовать ручную проверку эталона" hint={compact ? undefined : 'Автопоиск не сохраняет калибровку без вашего подтверждения'} />
    </>
  );
}

function Storage({ st }: { st: Stats | null }) {
  return (<><h2 className="g-h2">Хранилище</h2>{!st ? <Loading /> : <div className="g-panel2"><div className="g-kv"><span>Образцов</span><b>{st.samples_total}</b></div><div className="g-kv"><span>Версий отчётов</span><b>{st.versions_total}</b></div><div className="g-kv"><span>Сессий за неделю</span><b>{st.sessions_week}</b></div></div>}
  </>);
}
function About({ h, email }: { h: Health | null | undefined; email?: string }) {
  const b = (ok: boolean | undefined, t: string) => <div className="g-kv"><span>{t}</span><Badge tone={ok ? 'ok' : 'err'} icon={ok ? 'check' : 'error'}>{ok ? 'работает' : 'недоступно'}</Badge></div>;
  return (<><h2 className="g-h2">О системе</h2><p className="g-dim">Метрологически прослеживаемая морфометрия биологических препаратов: калибровка по эталонной мере и оценка неопределённости измерения площади.</p><div className="g-panel2"><div className="g-kv"><span>Версия</span><b>1.0.0</b></div><div className="g-kv"><span>Пользователь</span><b>{email}</b></div>
    {h === undefined ? <Loading /> : <>{b(h?.postgres, 'PostgreSQL')}{b(h?.nosql, `Документное хранилище (${h?.nosql_kind ?? 'MongoDB'})`)}{b(h?.core, 'Ядро вычислений (Python)')}</>}</div></>);
}
export { Btn };
