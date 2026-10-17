import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Measurement, Pt, Region, SegmentResult } from '@masshtablab/shared';
import { api } from '../api';
import { useWs, stepBlock } from '../session';
import { useToast, errText, useExtra } from '../state';
import { Btn, Empty, Icon, Metric, Notice, Seg, Slider, Toggle } from '../ui/atoms';
import { Handle, Stage, useStage, type StageHandle } from '../ui/Stage';
import { angleDeg, areaMm2, centroid, dist, interiorPoint, pathOf, perimeterMm, pointInPolygon } from '../lib/geom';
import { num, sign } from '../lib/fmt';
import { RefOverlay } from './Calibration';
import type { Go } from './Session';

type Tool = 'select' | 'polygon' | 'line' | 'angle' | 'circle' | 'auto' | 'eraser' | 'ruler' | 'pan';
type Draw = 'polygon' | 'line' | 'angle' | 'circle' | 'ruler';
const NEED: Record<Draw, number> = { polygon: 3, line: 2, angle: 3, circle: 2, ruler: 2 };
const TOOLS: { t: Tool; icon: string; title: string; key: string }[] = [
  { t: 'select', icon: 'near_me', title: 'Выбор', key: 'V' }, { t: 'polygon', icon: 'pentagon', title: 'Контур', key: 'P' }, { t: 'line', icon: 'show_chart', title: 'Линия', key: 'L' },
  { t: 'angle', icon: 'square_foot', title: 'Угол', key: 'A' }, { t: 'circle', icon: 'circle', title: 'Окружность', key: 'C' }, { t: 'auto', icon: 'auto_fix_high', title: 'Авто-контур', key: 'M' }, { t: 'eraser', icon: 'eraser', title: 'Волшебная стёрка', key: 'E' },
  { t: 'ruler', icon: 'straighten', title: 'Линейка (без сохранения)', key: 'R' }, { t: 'pan', icon: 'pan_tool', title: 'Перемещение', key: 'H' },
];
const KIND_ICON: Record<string, string> = { polygon: 'pentagon', mask: 'auto_fix_high', line: 'show_chart', angle: 'square_foot', circle: 'circle' };
const KIND_RU: Record<string, string> = { polygon: 'Контур', mask: 'Область', line: 'Линия', angle: 'Угол', circle: 'Окружность' };

function Layer({ ms, hidden, sel, setSel, edit, setEdit, commit, showLabels, k, draft, hover, tool, regions, showMask, brush }: {
  ms: Measurement[]; hidden: Set<string>; sel: string | null; setSel: (id: string | null) => void; edit: Record<string, Pt[]>; setEdit: (e: Record<string, Pt[]>) => void;
  commit: (id: string, v: Pt[]) => void; showLabels: boolean; k: number; draft: Pt[]; hover: Pt | null; tool: Tool; regions: Region[]; showMask: boolean; brush: { p: Pt; r: number } | null;
}) {
  const { px } = useStage();
  const fs = 14 * px, sw = 2.5;
  const lbl = (p: Pt, t: string) => <text x={p[0] + 8 * px} y={p[1] - 8 * px} fontSize={fs} className="ov-t" strokeWidth={3.5 * px}>{t}</text>;
  const draw = tool as Draw;
  const dv = hover && draft.length ? [...draft, hover] : draft;
  let live = '';
  if (draft.length && hover && tool in NEED) {
    if (draw === 'polygon' && dv.length >= 3) live = `${num(areaMm2(dv, k))} мм²`;
    else if (draw === 'line' || draw === 'ruler') live = `${num(dist(draft[0]!, hover) / k)} мм`;
    else if (draw === 'angle' && dv.length === 3) live = `${num(angleDeg(dv[0]!, dv[1]!, dv[2]!), 1)}°`;
    else if (draw === 'circle') live = `Ø ${num((2 * dist(draft[0]!, hover)) / k)} мм`;
  }
  return (
    <>
      {showMask && regions.map((r, i) => <g key={i}><path d={pathOf(r.vertices)} className="ov-mask" strokeWidth={2} vectorEffect="non-scaling-stroke" />{lbl(centroid(r.vertices), `О${i + 1}, ${num(r.area_mm2)} мм²`)}</g>)}
      {brush && <circle cx={brush.p[0]} cy={brush.p[1]} r={Math.max(brush.r, 4 * px)} className="ov-brush" vectorEffect="non-scaling-stroke" />}
      {ms.filter((m) => !hidden.has(m.id)).map((m) => {
        const v = edit[m.id] ?? m.vertices; const on = sel === m.id;
        const click = { 'data-handle': true, onClick: (e: React.MouseEvent) => { e.stopPropagation(); setSel(m.id); }, style: { cursor: 'pointer' } } as const;
        let body, label = '';
        if (m.kind === 'circle') { const r = dist(v[0]!, v[1]!); body = <circle cx={v[0]![0]} cy={v[0]![1]} r={r} className="ov-fill ov-line" strokeWidth={on ? 4 : sw} vectorEffect="non-scaling-stroke" {...click} />; label = `Ø ${num((2 * r) / k)} мм`; }
        else if (m.kind === 'line') { body = <path d={pathOf(v, false)} className="ov-line" strokeWidth={on ? 4 : sw} vectorEffect="non-scaling-stroke" {...click} />; label = `${num(perimeterMm(v, k, false))} мм`; }
        else if (m.kind === 'angle') { body = <path d={pathOf(v, false)} className="ov-line" strokeWidth={on ? 4 : sw} vectorEffect="non-scaling-stroke" {...click} />; label = `${num(angleDeg(v[0]!, v[1]!, v[2]!), 1)}°`; }
        else { body = <path d={pathOf(v)} className="ov-fill ov-line" strokeWidth={on ? 4 : sw} vectorEffect="non-scaling-stroke" {...click} />; label = `${num(areaMm2(v, k))} мм²`; }
        const anchor = m.kind === 'angle' ? v[1]! : m.kind === 'circle' ? v[0]! : centroid(v);
        return (
          <g key={m.id}>{body}{showLabels && lbl(anchor, `${m.label}, ${label}`)}
            {on && tool === 'select' && v.map((p, i) => <Handle key={i} p={p} r={6} onDrag={(q) => setEdit({ ...edit, [m.id]: v.map((c, j) => (j === i ? q : c)) as Pt[] })} onEnd={() => commit(m.id, edit[m.id] ?? v)} />)}
          </g>
        );
      })}
      {draft.length > 0 && (
        <g>
          {draw === 'circle' && hover ? <circle cx={draft[0]![0]} cy={draft[0]![1]} r={dist(draft[0]!, hover)} className="ov-fill ov-line" strokeDasharray={`${6 * px} ${5 * px}`} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
            : <path d={pathOf(dv, false)} className={`ov-line`} strokeDasharray={`${6 * px} ${5 * px}`} strokeWidth={sw} vectorEffect="non-scaling-stroke" fill="none" />}
          {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={5 * px} className="hnd" strokeWidth={2 * px} />)}
          {live && hover && lbl(hover, live)}
        </g>
      )}
    </>
  );
}

export function GlassMeasure({ go }: { go: Go }) {
  const ws = useWs();
  const { toast } = useToast();
  const [idx, setIdx] = useState(0);
  const s = ws.samples[Math.min(idx, ws.samples.length - 1)];
  const [tool, setTool] = useState<Tool>('polygon');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Record<string, Pt[]>>({});
  const { extra } = useExtra();
  const [layers, setLayers] = useState({ contours: true, ref: true, grid: false, labels: extra.labels, ruler: true, snap: extra.snap });
  const [zoom, setZoom] = useState(1);
  const stage = useRef<StageHandle>(null);
  const k = s?.calibration?.px_per_mm ?? 1;
  const ms = useMemo(() => s?.measurements ?? [], [s]);
  const cur = ms.find((m) => m.id === sel) ?? null;

  const [seg, setSeg] = useState<SegmentResult | null>(null);
  const [sp, setSp] = useState({ channel: 'g' as 'rgb' | 'g' | 'lab', low: 0, high: 255, smooth_px: 2, min_area_mm2: 1, fill_holes: true });
  const [segView, setSegView] = useState<'orig' | 'mask'>('mask');
  const [segBusy, setSegBusy] = useState(false);
  const [segErr, setSegErr] = useState('');
  const spInit = useRef(false);
  const [ops, setOps] = useState<({ c: number[] } | { p: Pt })[]>([]);
  const [center, setCenter] = useState<Pt | null>(null);
  const segTool = tool === 'auto' || tool === 'eraser';
  const erased = useMemo(() => ops.flatMap((o) => ('c' in o ? [o.c] : [])), [ops]);
  const dropped = useMemo(() => ops.flatMap((o) => ('p' in o ? [o.p] : [])), [ops]);
  useEffect(() => { setSeg(null); spInit.current = false; setDraft([]); setSel(null); setOps([]); setCenter(null); }, [s?.id]);
  const regions = useMemo(() => (seg?.regions ?? []).filter((r) => !dropped.some((p) => pointInPolygon(p, r.vertices))), [seg, dropped]);
  const totalArea = regions.reduce((a, r) => a + r.area_mm2, 0);
  useEffect(() => {
    if (!segTool || !s?.calibration) return;
    const t = setTimeout(async () => {
      setSegBusy(true);
      try {
        const body = { ...(spInit.current ? sp : { channel: sp.channel, smooth_px: sp.smooth_px, min_area_mm2: sp.min_area_mm2, fill_holes: sp.fill_holes }), erase: erased };
        const r = await api.segment(s.id, body);
        setSeg(r); setSegErr('');
        if (!spInit.current) { spInit.current = true; setSp((p) => ({ ...p, low: r.low, high: r.high })); }
      } catch (e) { setSegErr(errText(e)); toast(errText(e), 'err'); } finally { setSegBusy(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [segTool, s?.id, erased, sp.channel, sp.low, sp.high, sp.smooth_px, sp.min_area_mm2, sp.fill_holes]);

  const finish = useCallback(async (verts: Pt[]) => {
    if (!s || !(tool in NEED) || tool === 'ruler') return;
    const kind = tool as 'polygon' | 'line' | 'angle' | 'circle';
    setDraft([]);
    const r = await ws.addMeasurement(s, kind, verts);
    if (r) { setSel(r.id); setTool('select'); }
  }, [s, tool, ws]);

  const snap = (p: Pt): Pt => {
    if (!layers.snap) return p;
    const th = 10 / (stage.current?.scale ?? 1);
    let best: Pt | null = null, bd = th;
    for (const m of ms) for (const v of m.vertices) { const d = dist(v, p); if (d < bd) { bd = d; best = v; } }
    for (const v of draft.slice(0, 1)) { const d = dist(v, p); if (d < bd) { bd = d; best = v; } }
    return best ?? p;
  };

  const onPoint = (raw: Pt) => {
    if (!s || !s.calibration) return;
    if (tool === 'select') { setSel(null); return; }
    if (tool === 'auto') return;
    if (tool === 'eraser') {
      if (!center) { setCenter(raw); return; }
      const r = dist(center, raw);
      if (r >= 2) setOps((o) => [...o, { c: [Math.round(center[0]), Math.round(center[1]), Math.round(r)] }]);
      setCenter(null); return;
    }
    if (!(tool in NEED)) return;
    const t = tool as Draw;
    const p = snap(raw);
    if (t === 'polygon' && draft.length >= 3 && dist(p, draft[0]!) < 12 / (stage.current?.scale ?? 1)) { void finish(draft); return; }
    const next = [...draft, p];
    if (t === 'polygon') { setDraft(next); return; }
    if (next.length >= NEED[t]) { if (t === 'ruler') { setDraft(next); } else void finish(next); } else setDraft(next);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement; if (el.closest('input,textarea,select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && segTool) { e.preventDefault(); setOps((x) => x.slice(0, -1)); }
      else if (e.key === 'Escape') { setDraft([]); setSel(null); setCenter(null); }
      else if (e.key === 'Enter' && tool === 'polygon' && draft.length >= 3) void finish(draft);
      else if (e.key === 'Backspace' && draft.length) setDraft((d) => d.slice(0, -1));
      else if ((e.key === 'Delete') && sel) { void ws.removeMeasurement(sel); setSel(null); }
      else { const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase() && !e.ctrlKey && !e.metaKey); if (t) { setTool(t.t); setDraft([]); } }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [tool, segTool, draft, sel, finish, ws]);

  if (!s) return <Empty title="Нет образцов" action={<Btn v="p" onClick={() => go('upload')}>К загрузке</Btn>} />;
  if (!s.calibration) return <Empty icon="grid_on" title="Образец не откалиброван" text="Без эталона миллиметры посчитать нельзя." action={<Btn v="p" onClick={() => go('calibration')}>К калибровке</Btn>} />;

  const commit = async (id: string, v: Pt[]) => { await ws.updateMeasurement(id, { vertices: v }); setEdit((e) => { const { [id]: _, ...rest } = e; return rest; }); };
  const rulerLen = draft.length === 2 && tool === 'ruler' ? dist(draft[0]!, draft[1]!) / k : null;
  const gridStep = [1, 2, 5, 10, 20, 50].find((st) => st * k * zoom >= 22) ?? 100;
  const nCal = ws.samples.filter((x) => x.calibration).length;

  return (
    <div className="g-meas">
      <div className="g-view">
        <Stage ref={stage} src={api.imageUrl(s.id)} width={s.width} height={s.height} onPoint={onPoint} onDouble={() => tool === 'polygon' && draft.length >= 3 && void finish(draft)} onHover={setHover} onScale={setZoom}
          cursor={tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair'} loupeAt={null} pad={0.82}>
          {layers.grid && <><defs><pattern id="pg" width={gridStep * k} height={gridStep * k} patternUnits="userSpaceOnUse"><path d={`M${gridStep * k} 0H0V${gridStep * k}`} fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth={1} vectorEffect="non-scaling-stroke" /></pattern></defs><rect width={s.width} height={s.height} fill="url(#pg)" pointerEvents="none" /></>}
          {layers.ref && <RefOverlay corners={s.calibration.corners} />}
          <Layer ms={layers.contours ? ms : []} hidden={hidden} sel={sel} setSel={setSel} edit={edit} setEdit={setEdit} commit={commit} showLabels={layers.labels} k={k} draft={draft} hover={hover} tool={tool}
            regions={regions} brush={tool === 'eraser' && center ? { p: center, r: hover ? dist(center, hover) : 0 } : null} showMask={segTool && segView === 'mask'} />
        </Stage>
        {layers.ruler && <div className="g-hint" style={{ left: 'auto', right: 300, top: 'auto', bottom: 18, transform: 'none' }} aria-hidden="true"><div style={{ width: Math.max(20, 10 * k * zoom), height: 6, borderLeft: '2px solid #fff', borderRight: '2px solid #fff', borderBottom: '2px solid #fff', margin: '0 auto 4px' }} /> 10 мм</div>}
      </div>

      <div className="g-meas-l">
        {segTool ? (
          <div className="g-panel g-col">
            <div className="g-row g-between"><h2 className="g-h2">Авто-сегментация</h2><span className="bdg">{sp.channel === 'rgb' ? 'RGB' : sp.channel === 'g' ? 'G' : 'Lab'}</span></div>
            <Seg value={sp.channel} onChange={(v) => { spInit.current = false; setSp({ ...sp, channel: v }); }} options={[{ v: 'rgb', t: 'RGB' }, { v: 'g', t: 'Канал G' }, { v: 'lab', t: 'Lab' }]} />
            <div className="g-hist" aria-label="Гистограмма яркости">{(seg?.histogram ?? new Array(64).fill(0)).map((h, i, a) => <i key={i} style={{ height: `${(Math.log1p(h) / Math.log1p(Math.max(...a, 1))) * 100}%`, opacity: i * 4 >= sp.low && i * 4 <= sp.high ? 0.9 : 0.25 }} />)}</div>
            <Slider label="Нижний порог" value={sp.low} min={0} max={255} onChange={(v) => setSp({ ...sp, low: Math.min(v, sp.high) })} />
            <Slider label="Верхний порог" value={sp.high} min={0} max={255} onChange={(v) => setSp({ ...sp, high: Math.max(v, sp.low) })} />
            <Slider label="Сглаживание контура" value={sp.smooth_px} min={0} max={10} step={0.5} fmt={(v) => `${v} px`} onChange={(v) => setSp({ ...sp, smooth_px: v })} />
            <Slider label="Мин. размер области" value={sp.min_area_mm2} min={0} max={50} step={0.5} fmt={(v) => `${v} мм²`} onChange={(v) => setSp({ ...sp, min_area_mm2: v })} />
            <Toggle on={sp.fill_holes} onChange={(v) => setSp({ ...sp, fill_holes: v })} label="Заполнить отверстия" />
            <div className="g-row g-between" style={{ gap: 8 }}>
<span className="g-dim">{segErr ? <span style={{ color: 'var(--err, #d93025)' }}>Ошибка: {segErr}</span> : erased.length && seg && seg.erase_applied !== erased.length ? <span style={{ color: 'var(--err, #d93025)' }}>Сервер не применил стёрку: перезапустите ядро и шлюз</span> : `Стёрка: ${erased.length ? `стёртых мест — ${erased.length}` : 'поставьте центр, затем радиус'}`}</span>
              <button className="icbtn" aria-label="Вернуть стёртое" title="Вернуть стёртое (Ctrl+Z)" disabled={!ops.length} onClick={() => setOps((o) => o.slice(0, -1))}><Icon n="undo" /></button>
            </div>
            <Notice icon="info">Маска — это предположение. Проверьте границы и при необходимости поправьте контуры вручную.</Notice>
          </div>
        ) : (
          <>
            <div className="g-panel g-col" style={{ gap: 10 }}>
              <div className="g-row g-between"><h2 className="g-h2">Контуры</h2><span className="bdg">{s.name}</span></div>
              <div className="g-col" style={{ gap: 4, maxHeight: 260, overflow: 'auto' }}>
                {ms.length === 0 && <p className="g-dim" style={{ padding: '6px 2px' }}>Замеров нет. Выберите инструмент и обведите образец.</p>}
                {ms.map((m) => (
                  <div key={m.id} className="g-row" style={{ gap: 4 }}>
                    <button className={`g-contour${sel === m.id ? ' on' : ''}`} onClick={() => { setSel(m.id); setTool('select'); }}>
                      <Icon n={KIND_ICON[m.kind] ?? 'pentagon'} /><span><b style={{ fontWeight: 500 }}>{KIND_RU[m.kind]} {m.label}</b><small>{m.kind === 'angle' ? '3 вершины' : `${m.vertices.length} вершин`}</small></span><span className="v">{num(m.value)}</span>
                    </button>
                    <button className="icbtn" style={{ width: 34, height: 34 }} aria-label={hidden.has(m.id) ? 'Показать' : 'Скрыть'} onClick={() => setHidden((h) => { const n = new Set(h); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n; })}><Icon n={hidden.has(m.id) ? 'visibility_off' : 'visibility'} /></button>
                  </div>
                ))}
              </div>
              <button className="g-contour" style={{ border: '1px dashed var(--bd)' }} onClick={() => { setTool('polygon'); setDraft([]); }}><Icon n="add" />Новый контур</button>
              {cur && <Btn v="d" sm icon="delete" onClick={() => { void ws.removeMeasurement(cur.id); setSel(null); }}>Удалить «{cur.label}»</Btn>}
            </div>
            <div className="g-panel g-col" style={{ gap: 12 }}>
              <h2 className="g-h2">Слои и параметры</h2>
              <Toggle on={layers.contours} onChange={(v) => setLayers({ ...layers, contours: v })} label="Контуры" />
              <Toggle on={layers.ref} onChange={(v) => setLayers({ ...layers, ref: v })} label="Рамка эталона" />
              <Toggle on={layers.grid} onChange={(v) => setLayers({ ...layers, grid: v })} label="Физическая сетка" />
              <Toggle on={layers.labels} onChange={(v) => setLayers({ ...layers, labels: v })} label="Подписи значений" />
              <Toggle on={layers.ruler} onChange={(v) => setLayers({ ...layers, ruler: v })} label="Линейка" />
              <Toggle on={layers.snap} onChange={(v) => setLayers({ ...layers, snap: v })} label="Привязка к вершинам" hint="Курсор прилипает к ближайшей вершине" />
            </div>
          </>
        )}
      </div>

      <div className="g-tools" role="toolbar" aria-label="Инструменты">
        {TOOLS.map((t) => <button key={t.t} className={`g-tool${tool === t.t ? ' on' : ''}`} title={`${t.title} (${t.key})`} aria-label={t.title} aria-pressed={tool === t.t} onClick={() => { setTool(t.t); setDraft([]); setCenter(null); }}><Icon n={t.icon} /></button>)}
      </div>

      <div className="g-meas-r">
        {segTool ? (
          <div className="g-panel g-col">
            <h2 className="g-h2">Найдено {regions.length} {(regions.length % 10 === 1 && regions.length !== 11) ? 'область' : 'областей'}</h2>
            <div className="g-regs">{regions.map((r, i) => <div key={i} className="g-reg"><i>{i + 1}</i><span>Область</span><b>{num(r.area_mm2)} мм²</b><button className="icbtn" aria-label={`Убрать область ${i + 1}`} title="Убрать область" onClick={() => setOps((o) => [...o, { p: interiorPoint(r.vertices) }])}><Icon n="close" /></button></div>)}</div>
            <div className="g-kv"><span>Суммарная площадь</span><b>{num(totalArea)} мм²</b></div>
            <div className="g-kv"><span>Покрытие кадра</span><b>{seg ? num(seg.coverage * 100 * (seg.total_area_mm2 ? totalArea / seg.total_area_mm2 : 1), 1) : '—'} %</b></div>
            <Seg value={segView} onChange={setSegView} options={[{ v: 'orig', t: 'Оригинал' }, { v: 'mask', t: 'Маска' }]} />
            <Btn v="p" wide icon="check" disabled={!regions.length || segBusy} onClick={async () => { const r = await ws.reload().then(() => api.segment(s.id, { ...sp, apply: true, erase: erased, drop: dropped })).catch((e) => { toast(errText(e), 'err'); return null; }); if (r) { await ws.reload(); toast(`Применено областей: ${r.applied.length}`, 'ok'); setTool('select'); } }}>Применить как контуры</Btn>
            <Btn wide onClick={() => { spInit.current = false; setSp({ ...sp, low: 0, high: 255 }); setOps([]); }}>Сбросить пороги и стёртое</Btn>
          </div>
        ) : (
          <>
            <div className="g-mcard"><Metric label={cur ? (cur.kind === 'angle' ? 'Угол' : cur.kind === 'line' ? 'Длина' : cur.kind === 'circle' ? 'Диаметр' : 'Площадь') : 'Выберите замер'} value={cur ? num(cur.value) : rulerLen != null ? num(rulerLen) : '—'} unit={cur ? cur.unit : rulerLen != null ? 'мм' : ''} sub={cur ? cur.label : undefined} /></div>
            <div className="g-mcard"><Metric label={cur?.kind === 'circle' ? 'Длина окружности' : 'Периметр'} value={cur?.perimeter_mm != null ? num(cur.perimeter_mm) : '—'} unit="мм" sub={cur ? `${cur.vertices.length} точек` : undefined} /></div>
            <div className="g-mcard"><Metric label="Погрешность" value={cur ? `±${num(cur.error)}` : '—'} unit={cur?.unit} sub="по точности эталона ±0,5 px" /></div>
            <div className="g-mcard"><Metric label="Масштаб" value={num(k, 1)} unit="px/мм" sub={`Эталон ${s.calibration.side_mm}×${s.calibration.side_mm} мм, ${s.calibration.method === 'auto' ? 'авто' : 'вручную'}`} /></div>
          </>
        )}
      </div>

      <div className="g-dock">
        {ws.samples.map((x, i) => <button key={x.id} className={`pill${x.id === s.id ? ' on' : ''}`} onClick={() => setIdx(i)}>{x.name}{x.measurements?.length ? `, ${x.measurements.length}` : ''}</button>)}
        <Btn sm v="p" icon="table_chart" onClick={() => go('table')}>Таблица</Btn>
        <Btn sm icon="arrow_forward" disabled={!!stepBlock(ws, ws.samples.length >= 2 ? 'comparison' : 'report')} onClick={() => go(ws.samples.length >= 2 ? 'comparison' : 'report')}>{ws.samples.length >= 2 ? 'Сравнение' : 'Отчёт'}</Btn>
      </div>
      <div className="g-floatzoom">
        <Btn aria-label="Увеличить" onClick={() => stage.current?.zoomBy(1.25)}><Icon n="add" /></Btn>
        <Btn aria-label="Уменьшить" onClick={() => stage.current?.zoomBy(1 / 1.25)}><Icon n="remove" /></Btn>
        <Btn onClick={() => stage.current?.fit()} aria-label="Вписать">{Math.round(zoom * 100)}%</Btn>
      </div>
      {nCal < ws.samples.length && <span className="sr">Не все образцы откалиброваны</span>}
    </div>
  );
}
export { sign };
