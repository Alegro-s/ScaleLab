import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { STEPS, STEP_RU, type Step } from '@masshtablab/shared';
import { api } from '../api';
import { useAuth, usePrefs } from '../state';
import { Btn, Icon } from '../ui/atoms';
import { stepBlock, stepDone } from '../session';
import type { Workspace } from '../useWorkspace';

export const initials = (n?: string) => (n ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || 'ОП';

function useOutside(open: boolean, close: () => void) {
  const r = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!r.current?.contains(e.target as Node)) close(); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open, close]);
  return r;
}

export function AvatarMenu() {
  const { user, logout } = useAuth();
  const { prefs, setPrefs } = usePrefs();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div className="g-rel" ref={ref}>
      <button className="g-ava" aria-label="Профиль" aria-expanded={open} onClick={() => setOpen(!open)}>{initials(user?.full_name || user?.email)}</button>
      {open && (
        <div className="g-menu" role="menu">
          <div className="g-dim" style={{ padding: '8px 12px', fontSize: '.85em' }}>{user?.full_name || user?.email}</div>
          <button role="menuitem" onClick={() => { setOpen(false); nav('/settings'); }}><Icon n="settings" />Настройки</button>
          <button role="menuitem" onClick={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })}><Icon n={prefs.theme === 'dark' ? 'light_mode' : 'dark_mode'} />{prefs.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}</button>
          <button role="menuitem" onClick={() => setPrefs({ ui_mode: 'classic' })}><Icon n="web_asset" />Классический дизайн</button>
          <button role="menuitem" onClick={async () => { await logout(); nav('/login'); }}><Icon n="logout" />Выйти</button>
        </div>
      )}
    </div>
  );
}

const NAV = [{ to: '/', t: 'Главная', icon: 'home', end: true }, { to: '/library', t: 'Образцы', icon: 'photo_library' }, { to: '/standards', t: 'Эталоны', icon: 'grid_on' },
  { to: '/reports', t: 'Отчёты', icon: 'description' }, { to: '/journal', t: 'Журнал', icon: 'history' }];

export function GlobalBar({ onSearch }: { onSearch?: (q: string) => void }) {
  const nav = useNavigate();
  return (
    <header className="g-top">
      <button className="icbtn" aria-label="На главную" onClick={() => nav('/')}><Icon n="home" /></button>
      <div className="g-logo">МасштабЛаб</div>
      <nav className="g-nav" aria-label="Разделы">
        {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `pill${isActive ? ' on' : ''}`}>{n.t}</NavLink>)}
      </nav>
      <div className="g-top-r">
        {onSearch && <label className="g-search"><Icon n="search" /><input className="inp" placeholder="Поиск по образцам" aria-label="Поиск по образцам" onChange={(e) => onSearch(e.target.value)} /></label>}
        <button className="icbtn hide-s" aria-label="Настройки" onClick={() => nav('/settings')}><Icon n="settings" /></button>
        <NewSession />
        <AvatarMenu />
      </div>
    </header>
  );
}

export function NewSession() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return <Btn v="p" icon="add" disabled={busy} onClick={async () => {
    setBusy(true);
    try { const n = (await api.sessions()).length + 1; const s = await api.createSession(`Сессия ${new Date().toLocaleDateString('ru-RU')}, ${n}`); nav(`/session/${s.id}/upload`); } finally { setBusy(false); }
  }}>Новая сессия</Btn>;
}

export function SessionBar({ ws, step, onExport }: { ws: Workspace; step: Step | 'table' | 'versions'; onExport: () => void }) {
  const nav = useNavigate();
  const s = ws.session!;
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ id: string; number: number; title: string }[]>([]);
  const ref = useOutside(open, () => setOpen(false));
  const cal = ws.samples.filter((x) => x.calibration).length;
  return (
    <header className="g-top">
      <button className="icbtn" aria-label="К списку сессий" onClick={() => nav('/')}><Icon n="arrow_back" /></button>
      <div className="g-rel" ref={ref}>
        <button className="g-chip" aria-expanded={open} onClick={async () => { setOpen(!open); if (!open) setList(await api.sessions()); }}>
          Сессия №{String(s.number).padStart(3, '0')}, {s.title}<Icon n="expand_more" />
        </button>
        {open && <div className="g-menu l" role="menu">{list.map((x) => <button key={x.id} role="menuitem" className={x.id === s.id ? 'cur' : ''} onClick={() => { setOpen(false); nav(`/session/${x.id}`); }}>№{String(x.number).padStart(3, '0')}, {x.title}</button>)}</div>}
      </div>
      <nav className="g-steps" aria-label="Шаги">
        {STEPS.map((st) => {
          const block = stepBlock(ws, st);
          const done = stepDone(ws, st) && step !== st;
          return <button key={st} className={`g-step${step === st ? ' on' : ''}${done ? ' done' : ''}`} disabled={!!block} title={block ?? undefined} aria-current={step === st ? 'step' : undefined}
            onClick={() => nav(`/session/${s.id}/${st}`)}>{done && <Icon n="check" />}{STEP_RU[st]}</button>;
        })}
      </nav>
      <div className="g-top-r">
        <span className="g-chip info hide-s" style={{ cursor: 'default' }}>{cal}/{ws.samples.length || 2} откалибровано</span>
        <Btn icon="download" onClick={onExport} className="hide-s">Экспорт</Btn>
        <AvatarMenu />
      </div>
    </header>
  );
}

export function BottomNav() {
  const nav = useNavigate(); const loc = useLocation();
  const items = [{ to: '/', t: 'Главная', icon: 'home' }, { to: '/library', t: 'Образцы', icon: 'photo_library' }, { to: '/standards', t: 'Эталоны', icon: 'grid_on' }, { to: '/reports', t: 'Отчёты', icon: 'description' }, { to: '/settings', t: 'Ещё', icon: 'tune' }];
  return <nav className="g-bottomnav" aria-label="Нижняя навигация">{items.map((i) => <button key={i.to} className={loc.pathname === i.to ? 'on' : ''} onClick={() => nav(i.to)}><Icon n={i.icon} />{i.t}</button>)}</nav>;
}

export function GlassFrame({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  return <div className="g-app">{bar}<main className="g-page">{children}</main><BottomNav /><Onboarding /></div>;
}

const TIPS = [
  { icon: 'upload', t: 'Загрузите два снимка', x: 'В каждом кадре должен быть эталон — квадрат 10 × 10 мм. Снимайте эталон и образец на одной высоте.' },
  { icon: 'grid_on', t: 'Откалибруйте масштаб', x: 'Эталон находится автоматически. Если не нашёлся — перетащите четыре угла вручную, лупа поможет попасть точно.' },
  { icon: 'pentagon', t: 'Обведите образец', x: 'Площадь и периметр считаются в миллиметрах. Все замеры собираются в таблицу.' },
  { icon: 'description', t: 'Соберите отчёт', x: 'Каждое сохранение — новая версия с контрольной суммой. К любой версии можно вернуться.' },
];
export function Onboarding() {
  const { prefs, setPrefs } = usePrefs();
  const [i, setI] = useState(0);
  const done = !!prefs.extra.onboarded;
  if (done || !prefs.hints) return null;
  const t = TIPS[i]!;
  const close = () => setPrefs({ extra: { ...prefs.extra, onboarded: true } });
  return (
    <div className="g-onb" role="dialog" aria-modal="true" aria-label="Знакомство">
      <div className="g-panel g-onb-card">
        <div className="g-row g-between"><span className="g-dim">Шаг {i + 1} из {TIPS.length}</span><button className="icbtn" aria-label="Пропустить" onClick={close}><Icon n="close" /></button></div>
        <Icon n={t.icon} className="g-hl" /><h2>{t.t}</h2><p className="g-dim">{t.x}</p>
        <div className="g-row g-between">
          <span />
          <div className="g-row">{i > 0 && <Btn sm onClick={() => setI(i - 1)}>Назад</Btn>}<Btn v="p" sm onClick={() => (i < TIPS.length - 1 ? setI(i + 1) : close())}>{i < TIPS.length - 1 ? 'Далее' : 'Начать'}</Btn></div>
        </div>
      </div>
    </div>
  );
}
