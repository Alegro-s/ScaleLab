import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Prefs, User } from '@masshtablab/shared';
import { api, ApiError } from './api';
import { setDecimals } from './lib/fmt';

export const DEFAULT_PREFS: Prefs = { ui_mode: 'glass', theme: 'dark', language: 'ru', units: 'mm', decimals: 2, autosave: true, hints: true, sounds: false, extra: {} };
const LS = 'sl_prefs';
const readLocal = (): Partial<Prefs> => { try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; } };
const writeLocal = (p: Prefs) => { try { localStorage.setItem(LS, JSON.stringify({ ui_mode: p.ui_mode, theme: p.theme })); } catch { } };

export function applyDesign(ui: Prefs['ui_mode'], theme: Prefs['theme'], animate: boolean) {
  const root = document.documentElement;
  const apply = () => { root.dataset.ui = ui; root.dataset.theme = theme; };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!animate || reduce || root.dataset.ui === ui) { apply(); return; }
  const dark = theme === 'dark';
  const ov = document.createElement('div');
  ov.className = 'sl-switch';
  ov.setAttribute('aria-hidden', 'true');
  ov.style.setProperty('--sw-bg', dark ? 'linear-gradient(135deg,#0c2a30,#10161c)' : 'linear-gradient(135deg,#e9edf4,#cdd6e2)');
  ov.style.setProperty('--sw-tx', dark ? '#eaf3f8' : '#14183a');
  ov.innerHTML = '<div class="sl-sw-logo">МасштабЛаб</div><div class="sl-sw-bar"><i></i></div>';
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('in'));
  window.setTimeout(apply, 380);
  window.setTimeout(() => ov.classList.remove('in'), 1250);
  window.setTimeout(() => ov.remove(), 1700);
}

interface PrefsCtx { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void; loadServer: () => Promise<void> }
const PrefsContext = createContext<PrefsCtx>(null!);
export const usePrefs = () => useContext(PrefsContext);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setP] = useState<Prefs>({ ...DEFAULT_PREFS, ...readLocal() });
  const authed = useRef(false);
  const first = useRef(true);
  useEffect(() => { applyDesign(prefs.ui_mode, prefs.theme, !first.current); first.current = false; writeLocal(prefs); }, [prefs.ui_mode, prefs.theme]);
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setP((cur) => ({ ...cur, ...p }));
    if (authed.current) api.savePrefs(p).catch(() => { });
  }, []);
  const loadServer = useCallback(async () => {
    authed.current = true;
    try { const s = await api.prefs(); setP((cur) => ({ ...cur, ...s })); } catch { }
  }, []);
  useEffect(() => { setDecimals(prefs.decimals); }, [prefs.decimals]);
  const v = useMemo(() => ({ prefs, setPrefs, loadServer }), [prefs, setPrefs, loadServer]);
  return <PrefsContext.Provider value={v}>{children}</PrefsContext.Provider>;
}

interface AuthCtx {
  user: User | null; loading: boolean;
  login: (e: string, p: string) => Promise<void>; register: (e: string, p: string, n: string) => Promise<void>; demo: () => Promise<void>; logout: () => Promise<void>;
}
const AuthContext = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { loadServer } = usePrefs();
  useEffect(() => {
    api.me().then((u) => { setUser(u); return loadServer(); }).catch(() => setUser(null)).finally(() => setLoading(false));
  }, [loadServer]);
  const done = async (r: { user: User }) => { setUser(r.user); await loadServer(); };
  const v = useMemo<AuthCtx>(() => ({
    user, loading,
    login: async (e, p) => done(await api.login(e, p)),
    register: async (e, p, n) => done(await api.register(e, p, n)),
    demo: async () => done(await api.demo()),
    logout: async () => { await api.logout().catch(() => {}); setUser(null); },
  }), [user, loading]);
  return <AuthContext.Provider value={v}>{children}</AuthContext.Provider>;
}

export interface ToastItem { id: number; text: string; tone: 'ok' | 'err' | 'info' }
const ToastContext = createContext<{ toasts: ToastItem[]; toast: (t: string, tone?: ToastItem['tone']) => void; dismiss: (id: number) => void }>(null!);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setT] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setT((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text: string, tone: ToastItem['tone'] = 'info') => {
    const id = ++seq.current; setT((t) => [...t.slice(-3), { id, text, tone }]); setTimeout(() => dismiss(id), 4500);
  }, [dismiss]);
  const v = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);
  return <ToastContext.Provider value={v}>{children}</ToastContext.Provider>;
}
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Что-то пошло не так');

export const EXTRA_DEFAULTS = { snap: true, labels: true, min_confidence: 0.6, skew_tol: 2, warn_plane: true, require_review: false, default_side: 10 };
export function useExtra() {
  const { prefs, setPrefs } = usePrefs();
  const extra = { ...EXTRA_DEFAULTS, ...(prefs.extra as Partial<typeof EXTRA_DEFAULTS>) };
  return { extra, setExtra: (p: Partial<typeof EXTRA_DEFAULTS & { onboarded: boolean }>) => setPrefs({ extra: { ...prefs.extra, ...p } }) };
}
