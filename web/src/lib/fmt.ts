export let DEC = 2;
export const setDecimals = (n: number) => { DEC = n; };
export const num = (v: number | null | undefined, d = DEC) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d).replace('.', ','));
export const sign = (v: number, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d).replace('.', ',');
export const pct = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : sign(v, d) + ' %');
const D = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
const T = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const M = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
export const date = (s: string) => D.format(new Date(s));
export const time = (s: string) => T.format(new Date(s));
export const dateTime = (s: string) => `${D.format(new Date(s))} ${T.format(new Date(s))}`;
export const dayShort = (s: string) => M.format(new Date(s)).replace('.', '');
export const pad3 = (n: number) => String(n).padStart(3, '0');
export const greeting = () => { const h = new Date().getHours(); return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };
export const weekdayLong = () => new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).replace(/^./, (c) => c.toUpperCase());

export const plural = (n: number, one: string, few: string, many: string) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
