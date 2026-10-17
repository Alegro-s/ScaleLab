import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { useToast } from '../state';

const UI: Record<string, string> = { add: 'plus', add_circle: 'plus', arrow_back: 'arrow-left', arrow_forward: 'arrow-right', auto_fix_high: 'magic-wand', autorenew: 'refresh', balance: 'scale', block: 'ban', check: 'check', check_circle: 'check-circle', circle: 'circle', close: 'cross', compare: 'scale-comparison', content_copy: 'copy', crop_free: 'expand', dark_mode: 'moon', light_mode: 'sun', delete: 'trash', description: 'document', download: 'download', edit: 'pencil', error: 'exclamation', expand_more: 'angle-small-down', fact_check: 'list-check', eraser: 'eraser', expand: 'expand', object_subtract: 'object-subtract', ruler_combined: 'ruler-combined', file_code: 'file-code', file_csv: 'file-csv', file_image: 'file-image', file_pdf: 'file-pdf', fit_screen: 'expand', folder: 'folder', folder_open: 'folder-open', folder_zip: 'file-zipper', gpp_bad: 'shield-exclamation', grid_on: 'grid', help: 'question', history: 'time-past', home: 'home', image: 'picture', info: 'info', label: 'label', layers: 'layers', lightbulb: 'bulb', logout: 'sign-out-alt', menu: 'menu-burger', near_me: 'location-arrow', open_in_new: 'arrow-up-right-from-square', open_with: 'expand-arrows', pan_tool: 'hand-back-fist', pentagon: 'draw-polygon', photo_library: 'gallery', play_arrow: 'play', radio_button_unchecked: 'circle', refresh: 'refresh', remove: 'minus', save: 'disk', science: 'flask', search: 'search', settings: 'settings', show_chart: 'chart-line-up', sort: 'sort', square_foot: 'ruler-triangle', straighten: 'ruler-horizontal', table_chart: 'table', tune: 'settings-sliders', undo: 'undo', upload: 'upload', verified: 'shield-check', visibility: 'eye', visibility_off: 'eye-crossed', warning: 'triangle-warning', web_asset: 'browser' };
export const Icon = ({ n, className = '' }: { n: string; className?: string }) => <span className={`ms ui-${UI[n] ?? 'circle'} ${className}`} aria-hidden="true" />;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { v?: 'p' | 'g' | 'd'; icon?: string; wide?: boolean; sm?: boolean };
export function Btn({ v = 'g', icon, wide, sm, className = '', children, ...r }: BtnProps) {
  return (
    <button type="button" {...r} className={`btn btn-${v}${wide ? ' wide' : ''}${sm ? ' sm' : ''} ${className}`}>
      {icon && <Icon n={icon} />}{children}
    </button>
  );
}

export function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="tgl-row">
      {(label || hint) && <div className="tgl-t"><b>{label}</b>{hint && <small>{hint}</small>}</div>}
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`tgl${on ? ' on' : ''}`} onClick={() => onChange(!on)}><i /></button>
    </div>
  );
}

export function Check({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return <label className="chk"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /><span className="chk-b" aria-hidden="true" /><span>{children}</span></label>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="fld"><span className="fld-l">{label}</span>{children}{hint && <small className="fld-h">{hint}</small>}</label>;
}
export const Input = ({ className = '', ...r }: InputHTMLAttributes<HTMLInputElement>) => <input {...r} className={`inp ${className}`} />;
export const Select = ({ className = '', children, ...r }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...r} className={`sel ${className}`}>{children}</select>;

export function Slider({ label, value, min, max, step = 1, onChange, fmt }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="sld">
      <span className="sld-h"><span>{label}</span><b>{fmt ? fmt(value) : value}</b></span>
      <input type="range" className="rng" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </label>
  );
}

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'mute';
export const Badge = ({ tone = 'mute', icon, children }: { tone?: Tone; icon?: string; children: ReactNode }) => <span className={`bdg bdg-${tone}`}>{icon && <Icon n={icon} />}{children}</span>;

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; t: string; icon?: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" role="tab" aria-selected={value === o.v} className={`pill${value === o.v ? ' on' : ''}`} onClick={() => onChange(o.v)}>
          {o.icon && <Icon n={o.icon} />}{o.t}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, foot, tone, wide }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode; tone?: 'err'; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${tone ? ' modal-' + tone : ''}${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <header className="modal-h"><h2>{tone === 'err' && <Icon n="error" />}{title}</h2><button className="icbtn" aria-label="Закрыть" onClick={onClose}><Icon n="close" /></button></header>
        <div className="modal-b">{children}</div>
        {foot && <footer className="modal-f">{foot}</footer>}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} onClick={() => dismiss(t.id)}>
          <Icon n={t.tone === 'ok' ? 'check_circle' : t.tone === 'err' ? 'error' : 'info'} />{t.text}
        </div>
      ))}
    </div>
  );
}

export const Empty = ({ icon = 'photo_library', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) =>
  <div className="state"><Icon n={icon} className="state-i" /><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>;
export const Loading = ({ text = 'Загрузка…' }: { text?: string }) => <div className="state" role="status"><span className="spin" aria-hidden="true" /><p>{text}</p></div>;
export const ErrorState = ({ title = 'Не получилось', text, retry }: { title?: string; text: string; retry?: () => void }) =>
  <div className="state state-err" role="alert"><Icon n="error" className="state-i" /><h3>{title}</h3><p>{text}</p>{retry && <Btn icon="refresh" onClick={retry}>Повторить</Btn>}</div>;
export const Notice = ({ tone = 'info', icon, children }: { tone?: Tone; icon?: string; children: ReactNode }) =>
  <div className={`notice notice-${tone}`}><Icon n={icon ?? (tone === 'warn' ? 'warning' : tone === 'err' ? 'error' : tone === 'ok' ? 'check_circle' : 'info')} /><span>{children}</span></div>;

export function Metric({ label, value, unit, sub, spark }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; spark?: number[] }) {
  return (
    <div className="metric">
      <span className="metric-l">{label}</span>
      <span className="metric-v">{value}{unit && <small>{unit}</small>}</span>
      {sub && <span className="metric-s">{sub}</span>}
      {spark && spark.length > 1 && <Spark data={spark} />}
    </div>
  );
}
export function Spark({ data }: { data: number[] }) {
  const mn = Math.min(...data), mx = Math.max(...data), r = mx - mn || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 28 - ((v - mn) / r) * 24]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><path d={`${d} L100 32 L0 32 Z`} className="spark-f" /><path d={d} className="spark-l" /></svg>;
}

export function download(url: string) { const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); }
