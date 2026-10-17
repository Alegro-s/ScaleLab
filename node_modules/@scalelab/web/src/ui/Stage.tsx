import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Pt } from '@masshtablab/shared';

interface StageCtx { scale: number; px: number; toImg: (cx: number, cy: number) => Pt }
const Ctx = createContext<StageCtx>({ scale: 1, px: 1, toImg: () => [0, 0] });
export const useStage = () => useContext(Ctx);

export interface StageHandle { zoomBy: (f: number) => void; fit: () => void; actual: () => void; scale: number }
interface Props {
  src: string; width: number; height: number; alt?: string;
  onPoint?: (p: Pt) => void; onDouble?: (p: Pt) => void; onHover?: (p: Pt | null) => void;
  cursor?: string; loupeAt?: Pt | null; className?: string; children?: ReactNode; onScale?: (s: number) => void; pad?: number;
}

export const Stage = forwardRef<StageHandle, Props>(function Stage({ src, width, height, alt = 'Снимок образца', onPoint, onDouble, onHover, cursor, loupeAt, className = '', children, onScale, pad = 0.94 }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view); viewRef.current = view;
  const fitted = useRef(false);

  const fit = useCallback(() => {
    const b = box.current; if (!b || !b.clientWidth) return;
    const s = Math.min(b.clientWidth / width, b.clientHeight / height) * pad;
    setView({ s, x: (b.clientWidth - width * s) / 2, y: (b.clientHeight - height * s) / 2 });
  }, [width, height, pad]);
  useLayoutEffect(() => { fitted.current = false; fit(); }, [fit, src]);
  useEffect(() => {
    const b = box.current; if (!b || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (!fitted.current) fit(); });
    ro.observe(b); return () => ro.disconnect();
  }, [fit]);
  useEffect(() => { onScale?.(view.s); }, [view.s, onScale]);

  const zoomAt = useCallback((f: number, cx?: number, cy?: number) => {
    const b = box.current; if (!b) return;
    const v = viewRef.current; const s = Math.min(20, Math.max(0.05, v.s * f));
    const ox = cx ?? b.clientWidth / 2, oy = cy ?? b.clientHeight / 2;
    fitted.current = true;
    setView({ s, x: ox - ((ox - v.x) / v.s) * s, y: oy - ((oy - v.y) / v.s) * s });
  }, []);

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(f), fit: () => { fitted.current = false; fit(); },
    actual: () => { const b = box.current!; fitted.current = true; setView({ s: 1, x: (b.clientWidth - width) / 2, y: (b.clientHeight - height) / 2 }); },
    get scale() { return viewRef.current.s; },
  }), [zoomAt, fit, width, height]);

  const toImg = useCallback((cx: number, cy: number): Pt => {
    const r = box.current!.getBoundingClientRect(); const v = viewRef.current;
    return [(cx - r.left - v.x) / v.s, (cy - r.top - v.y) / v.s];
  }, []);

  useEffect(() => {
    const b = box.current; if (!b) return;
    const w = (e: WheelEvent) => { e.preventDefault(); const r = b.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); };
    b.addEventListener('wheel', w, { passive: false }); return () => b.removeEventListener('wheel', w);
  }, [zoomAt]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    if ((e.target as Element).closest('[data-handle]')) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.moved || Math.hypot(dx, dy) > 4) { d.moved = true; fitted.current = true; setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy })); }
    }
    onHover?.(toImg(e.clientX, e.clientY));
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved && e.button === 0) onPoint?.(toImg(e.clientX, e.clientY));
  };

  const ctx = useMemo<StageCtx>(() => ({ scale: view.s, px: 1 / view.s, toImg }), [view.s, toImg]);
  const L = 150, Z = 6;
  let loupe: ReactNode = null;
  if (loupeAt) {
    const sx = view.x + loupeAt[0] * view.s, sy = view.y + loupeAt[1] * view.s;
    const right = box.current ? sx + L + 40 > box.current.clientWidth : false;
    loupe = (
      <div className="loupe" style={{ width: L, height: L, left: right ? sx - L - 30 : sx + 30, top: Math.max(8, sy - L / 2),
        backgroundImage: `url(${src})`, backgroundSize: `${width * Z}px ${height * Z}px`, backgroundPosition: `${-loupeAt[0] * Z + L / 2}px ${-loupeAt[1] * Z + L / 2}px` }}>
        <i className="loupe-h" /><i className="loupe-v" />
      </div>
    );
  }

  return (
    <div ref={box} className={`stage ${className}`} style={{ cursor: cursor ?? 'crosshair' }} onPointerDown={down} onPointerMove={move} onPointerUp={up}
      onPointerLeave={() => onHover?.(null)} onDoubleClick={(e) => onDouble?.(toImg(e.clientX, e.clientY))}>
      <div className="stage-in" style={{ width, height, transform: `translate(${view.x}px,${view.y}px) scale(${view.s})` }}>
        <img src={src} alt={alt} width={width} height={height} draggable={false} />
        <Ctx.Provider value={ctx}>
          <svg className="stage-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>{children}</svg>
        </Ctx.Provider>
      </div>
      {loupe}
    </div>
  );
});

export function Handle({ p, onDrag, onEnd, label, active, r = 8, shape = 'circle' }: { p: Pt; onDrag: (p: Pt) => void; onEnd?: () => void; label?: string; active?: boolean; r?: number; shape?: 'circle' | 'ring' }) {
  const { px, toImg } = useStage();
  const on = useRef(false);
  return (
    <g data-handle className="handle" transform={`translate(${p[0]} ${p[1]})`}
      onPointerDown={(e) => { e.stopPropagation(); on.current = true; (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (on.current) { e.stopPropagation(); onDrag(toImg(e.clientX, e.clientY)); } }}
      onPointerUp={(e) => { if (on.current) { on.current = false; e.stopPropagation(); onEnd?.(); } }}>
      <circle r={r * px * 2.2} fill="transparent" />
      <circle r={r * px} className={`hnd${active ? ' act' : ''}${shape === 'ring' ? ' ring' : ''}`} strokeWidth={2 * px} />
      {label && <text x={r * px * 1.4} y={-r * px * 1.2} fontSize={13 * px} className="hnd-t">{label}</text>}
    </g>
  );
}
