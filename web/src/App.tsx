import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, PrefsProvider, ToastProvider, useAuth, usePrefs } from './state';
import { Toasts, Loading, ErrorState } from './ui/atoms';
import { useWorkspace } from './useWorkspace';
import { isStep, WsContext } from './session';
import { GlassLogin } from './glass/Login';
import { GlassHome } from './glass/Home';
import { GlassSession } from './glass/Session';
import { GlassLibrary, GlassReports, GlassStandards } from './glass/Library';
import { GlassSettings } from './glass/Settings';
import { GlassJournal } from './glass/Journal';
import { GlassFrame } from './glass/Shell';
import { ClassicLogin, ClassicSessions, ClassicSession, ClassicSettings, ClassicVersions, ClassicLibrary, ClassicStandards } from './classic/Pages';

function Guard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Loading text="Запуск…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function SessionRoute() {
  const { id, step } = useParams();
  const { prefs } = usePrefs();
  const ws = useWorkspace(id);
  if (ws.loading && !ws.session) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><Loading /></div>;
  if (ws.error || !ws.session) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><ErrorState text={ws.error ?? 'Сессия не найдена'} retry={() => void ws.reload()} /></div>;
  const s = isStep(step) || step === 'table' || step === 'versions' ? step : ws.session.step;
  return <WsContext.Provider value={ws}>{prefs.ui_mode === 'glass' ? <GlassSession step={s} /> : s === 'versions' ? <ClassicVersions /> : <ClassicSession step={s} />}</WsContext.Provider>;
}

const pick = (glass: ReactNode, classic: ReactNode, mode: string) => (mode === 'glass' ? glass : classic);

function Routing() {
  const { prefs } = usePrefs();
  const m = prefs.ui_mode;
  return (
    <Routes>
      <Route path="/login" element={pick(<GlassLogin />, <ClassicLogin />, m)} />
      <Route path="/" element={<Guard>{pick(<GlassHome />, <ClassicSessions />, m)}</Guard>} />
      <Route path="/library" element={<Guard>{pick(<GlassLibrary />, <ClassicLibrary />, m)}</Guard>} />
      <Route path="/standards" element={<Guard>{pick(<GlassStandards />, <ClassicStandards />, m)}</Guard>} />
      <Route path="/reports" element={<Guard>{pick(<GlassReports />, <ClassicSessions />, m)}</Guard>} />
      <Route path="/journal" element={<Guard>{pick(<GlassJournal />, <ClassicSessions />, m)}</Guard>} />
      <Route path="/settings" element={<Guard>{pick(<GlassSettings />, <ClassicSettings />, m)}</Guard>} />
      <Route path="/session/:id" element={<Guard><SessionRoute /></Guard>} />
      <Route path="/session/:id/:step" element={<Guard><SessionRoute /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <PrefsProvider><ToastProvider><AuthProvider>
      <Routing /><Toasts />
    </AuthProvider></ToastProvider></PrefsProvider>
  );
}
export { GlassFrame };
