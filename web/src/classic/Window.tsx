import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { STEPS, STEP_RU, type Step } from '@masshtablab/shared';
import { api } from '../api';
import { useAuth, usePrefs, useToast, errText } from '../state';
import { Icon, Modal, Btn } from '../ui/atoms';
import { stepBlock } from '../session';
import type { Workspace } from '../useWorkspace';

export function Window({ title, ws, tab, children, foot, status, noMenu }: { title: string; ws?: Workspace; tab?: Step | 'versions'; children: ReactNode; foot?: ReactNode; status?: string; noMenu?: boolean }) {
  const nav = useNavigate();
  const { logout } = useAuth();
  const { prefs, setPrefs } = usePrefs();
  const { toast } = useToast();
  const [menu, setMenu] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const s = ws?.session;
  const go = (to: string) => { setMenu(null); nav(to); };
  const newSession = async () => { setMenu(null); try { const x = await api.createSession(`Сессия ${new Date().toLocaleDateString('ru-RU')}`); nav(`/session/${x.id}/upload`); } catch (e) { toast(errText(e), 'err'); } };
  const M = (name: string, items: ReactNode) => (
    <div key={name}><button className={`c-mi${menu === name ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={menu === name} onClick={() => setMenu(menu === name ? null : name)}>{name}</button>{menu === name && <div className="c-drop" role="menu">{items}</div>}</div>
  );
  const It = ({ t, k, f, off }: { t: string; k?: string; f: () => void; off?: boolean }) => <button role="menuitem" disabled={off} style={off ? { opacity: .5 } : undefined} onClick={() => { setMenu(null); f(); }}><span>{t}</span><span>{k}</span></button>;
  return (
    <div className="c-win" onClick={(e) => { if (!(e.target as HTMLElement).closest('.c-menu')) setMenu(null); }}>
      <div className="c-title"><Icon n="science" />{title}</div>
      {!noMenu && (
        <div className="c-menu" role="menubar">
          {M('Файл', <><It t="Новая сессия" f={newSession} /><It t="Мои сессии" f={() => go('/')} /><hr /><It t="Образцы" f={() => go('/library')} /><It t="Эталоны" f={() => go('/standards')} /><hr /><It t="Настройки" f={() => go('/settings')} /><It t="Выход" f={async () => { await logout(); nav('/login'); }} /></>)}
          {M('Правка', <><It t="Удалить сессию" off={!s} f={async () => { if (s && confirm(`Удалить сессию «${s.title}» со всеми данными?`)) { await api.deleteSession(s.id); toast('Сессия удалена', 'ok'); nav('/'); } }} /><It t="Переименовать сессию" off={!s} f={() => { const t = prompt('Название сессии', s?.title); if (t?.trim()) void ws?.rename(t.trim()); }} /></>)}
          {M('Вид', <><It t={prefs.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} f={() => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' })} /><It t="Новый дизайн" f={() => setPrefs({ ui_mode: 'glass' })} /></>)}
          {M('Справка', <><It t="Журнал версий" off={!s} f={() => s && nav(`/session/${s.id}/versions`)} /><It t="О программе" f={() => setAbout(true)} /></>)}
        </div>
      )}
      {ws && s && (
        <div className="c-tabs" role="tablist">
          {STEPS.map((st, i) => { const b = stepBlock(ws, st); return <button key={st} role="tab" aria-selected={tab === st} className={`c-tab${tab === st ? ' on' : ''}`} disabled={!!b} title={b ?? undefined} onClick={() => nav(`/session/${s.id}/${st}`)}>{i + 1}. {STEP_RU[st]}</button>; })}
        </div>
      )}
      <main className="c-body">{children}</main>
      {foot && <div className="c-foot">{foot}</div>}
      <div className="c-status" role="status">{status ?? 'Готово'}</div>
      {about && <Modal title="О программе" onClose={() => setAbout(false)} foot={<Btn v="p" onClick={() => setAbout(false)}>Закрыть</Btn>}><p><b>МасштабЛаб 1.0.0</b></p><p>Метрологически прослеживаемая морфометрия биологических препаратов: калибровка по эталонной мере и оценка неопределённости измерения площади.</p></Modal>}
    </div>
  );
}
