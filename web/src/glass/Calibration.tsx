import { useCallback, useEffect, useRef, useState } from 'react';
import type { Pt, Sample } from '@masshtablab/shared';
import { api, type AutoCalResult, type CalCandidate } from '../api';
import { useWs, stepBlock } from '../session';
import { Badge, Btn, Empty, Icon, Loading, Notice, Seg, download } from '../ui/atoms';
import { Handle, Stage, type StageHandle } from '../ui/Stage';
import { dist, pathOf } from '../lib/geom';
import { num } from '../lib/fmt';
import type { Go } from './Session';
import { useExtra } from '../state';

const DEF_SIDE = 10;
export function sides(c: Pt[]) {
  const w = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2, h = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
  return { w, h, skew: Math.abs(w - h) / Math.max(w, h) * 100, side: (w + h) / 2 };
}
const initial = (s: Sample): Pt[] => {
  const m = Math.min(s.width, s.height) * 0.12, x = s.width * 0.08, y = s.height * 0.72;
  return [[x, y], [x + m, y], [x + m, y + m], [x, y + m]];
};

export function RefOverlay({ corners, onChange, onActive, editable, labels = true }: { corners: Pt[]; onChange?: (c: Pt[]) => void; onActive?: (i: number | null) => void; editable?: boolean; labels?: boolean }) {
  const [act, setAct] = useState<number | null>(null);
  const set = (i: number, p: Pt) => onChange?.(corners.map((c, k) => (k === i ? p : c)) as Pt[]);
  return (
    <>
      <path d={pathOf(corners)} className="ov-ref" strokeWidth={3} vectorEffect="non-scaling-stroke" />
      {editable && corners.map((c, i) => (
        <Handle key={i} p={c} label={labels ? `0${i + 1}` : undefined} active={act === i} onDrag={(p) => { setAct(i); onActive?.(i); set(i, p); }} onEnd={() => { setAct(null); onActive?.(null); }} />
      ))}
    </>
  );
}

export function GlassCalibration({ go }: { go: Go }) {
  const ws = useWs(); const { extra } = useExtra(); const tol = extra.skew_tol;
  const samples = ws.samples;
  const [idx, setIdx] = useState(0);
  const s = samples[Math.min(idx, samples.length - 1)];
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [cands, setCands] = useState<CalCandidate[] | null>(null);
  const [pick, setPick] = useState(0);
  const [corners, setCorners] = useState<Pt[] | null>(null);
  const [side, setSide] = useState(extra.default_side || DEF_SIDE);
  const [active, setActive] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const stage = useRef<StageHandle>(null);
  const [sides_, setSides] = useState<number[]>([DEF_SIDE]);
  const [scene, setScene] = useState<AutoCalResult | null>(null);

  useEffect(() => { api.standards().then((l) => { const v = l.filter((x) => (x.kind === 'checker' || x.kind === 'custom') && x.width_mm === x.height_mm).map((x) => x.width_mm); if (v.length) setSides(v); }).catch(() => {}); }, []);

  const latest = useRef(0);
  const search = useCallback(async (sm: Sample) => {
    const mine = ++latest.current;
    const fresh = () => mine === latest.current;
    setCands(null); setPick(0); setScene(null);
    try {
      const r = await api.autoCalibrate(sm.id, { save: false, side_mm: side });
      if (!fresh()) return;
      setCands(r.candidates); setScene(r);
      if (r.found && r.candidates[0]!.side_mm) setSide(r.candidates[0]!.side_mm);
      setCorners(r.found ? (r.candidates[0]!.corners as Pt[]) : (sm.calibration?.corners as Pt[] | undefined) ?? initial(sm));
    } catch {
      if (!fresh()) return;
      setCands([]); setCorners((sm.calibration?.corners as Pt[] | undefined) ?? initial(sm));
    }
  }, [side]);
  const sid = s?.id;
  useEffect(() => { if (s) { setCorners((s.calibration?.corners as Pt[] | undefined) ?? null); void search(s); } }, [sid]);

  if (!s) return <Empty title="Нет снимков" text="Сначала загрузите снимки на первом шаге." action={<Btn v="p" onClick={() => go('upload')}>К загрузке</Btn>} />;
  const c = corners ?? initial(s);
  const m = sides(c);
  const k = m.side / side;
  const otherK = samples.filter((x) => x.id !== s.id && x.calibration).map((x) => x.calibration!.px_per_mm)[0];
  const next = samples.find((x) => x.id !== s.id && !x.calibration);
  const done = ws.calibrated;

  const accept = async (manual: boolean) => {
    const r = await ws.saveCalibration(s, c, side, manual ? 'manual' : 'auto', cands?.[pick]?.corners === c ? cands[pick]!.kind : undefined);
    if (r && next) setIdx(samples.indexOf(next));
  };
  const pickCand = (i: number) => { setPick(i); setCorners(cands![i]!.corners as Pt[]); const sm_ = cands![i]!.side_mm; if (sm_) setSide(sm_); };

  return (
    <div className="g-cal">
      <div className="g-view">
        <Stage ref={stage} src={api.imageUrl(s.id)} width={s.width} height={s.height} onScale={setZoom} cursor={mode === 'manual' ? 'crosshair' : 'grab'} loupeAt={mode === 'manual' && active != null ? c[active] : null}>
          {mode === 'auto' && scene?.object?.regions.map((poly, i) => <path key={i} d={pathOf(poly as Pt[])} className="ov-obj" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
          <RefOverlay corners={c} editable={mode === 'manual'} onChange={setCorners} onActive={setActive} />
        </Stage>
        <div className="g-vbar">
          <div className="g-sample-sw">
            {samples.map((x, i) => <button key={x.id} className={`g-sw${x.id === s.id ? ' on' : ''}`} onClick={() => setIdx(i)}><img src={api.imageUrl(x.id)} alt="" /><span><b>{x.name}</b><small>{x.calibration ? 'Откалиброван' : x.id === s.id ? 'Калибровка' : 'Ожидает'}</small></span></button>)}
          </div>
          <div className="g-zoom"><button className="icbtn" aria-label="Уменьшить" onClick={() => stage.current?.zoomBy(1 / 1.25)}><Icon n="remove" /></button><b>{Math.round(zoom * 100)}%</b><button className="icbtn" aria-label="Увеличить" onClick={() => stage.current?.zoomBy(1.25)}><Icon n="add" /></button>
            <Btn sm icon="fit_screen" onClick={() => stage.current?.fit()}>По размеру</Btn></div>
        </div>
      </div>
      <aside className="g-panel g-col" style={{ alignSelf: 'stretch', overflow: 'auto' }}>
        <div className="g-row g-between"><h2 className="g-h2">{mode === 'auto' ? 'Поиск эталона' : 'Ручная калибровка'}</h2><Seg value={mode} onChange={setMode} options={[{ v: 'auto', t: 'Авто' }, { v: 'manual', t: 'Вручную' }]} /></div>
        {mode === 'auto' ? (
          <>
            {cands === null ? <Loading text="Ищем эталон…" /> : cands.length === 0 ? <Notice tone="warn">Эталон не найден. Проверьте, что квадрат целиком в кадре и контрастный, или укажите углы вручную.</Notice> : (
              <>
                <p className="g-dim">Найдено кандидатов: {cands.length}. Выберите подходящий.</p>
                <div className="g-col" style={{ gap: 8 }}>{cands.map((cd, i) => <button key={i} className={`g-cand${pick === i ? ' on' : ''}`} onClick={() => pickCand(i)}><Icon n="grid_on" /><span className="g-grow"><b>{cd.kind === 'marker' ? 'Квадратный маркер' : 'Шахматный квадрат'}</b><small>{num(cd.side_px, 0)} px, {num(cd.px_per_mm, 1)} px/мм</small></span><Badge tone={cd.reliable !== false && cd.confidence >= .8 ? 'ok' : 'warn'}>{cd.reliable === false ? 'проверьте' : `${Math.round(cd.confidence * 100)}%`}</Badge></button>)}</div>
                {scene?.object && <div className="g-kv"><span>Объект найден по цвету</span><b>{scene.object.area_mm2 ? `${num(scene.object.area_mm2 / 100, 1)} см²` : `${Math.round(scene.object.area_frac * 100)}% кадра`}</b></div>}
                {scene?.warnings?.map((w, i) => <Notice key={i} tone="warn">{w}</Notice>)}
              </>
            )}
          </>
        ) : (
          <>
            <p className="g-dim">Перетащите четыре точки на внешние углы эталона. Лупа покажет точное попадание.</p>
            <div className="g-col" style={{ gap: 8 }}>{c.map((p, i) => <div key={i} className="g-corner"><i>{i + 1}</i><span>X {num(p[0], 1)}, Y {num(p[1], 1)}</span><Icon n="check" /></div>)}</div>
          </>
        )}
        <h3 className="g-h3">Расчёт масштаба</h3>
        <div className="g-panel2">
          <div className="g-kv"><span>Размер эталона</span>
            <select className="sel" style={{ width: 130, height: 34 }} value={side} onChange={(e) => setSide(Number(e.target.value))} aria-label="Размер стороны эталона">{[...new Set([...sides_, side])].map((v) => <option key={v} value={v}>{v} × {v} мм</option>)}</select></div>
          <div className="g-kv"><span>Найденная ширина</span><b>{num(m.w, 0)} px</b></div>
          <div className="g-kv"><span>Найденная высота</span><b>{num(m.h, 0)} px</b></div>
          <div className="g-kv"><span>Перекос</span><b className={m.skew > tol ? '' : 'g-hl'} style={m.skew > tol ? { color: 'var(--warn)' } : undefined}>{num(m.skew, 1)} %</b></div>
          <div className="g-kv"><span>Пикселей на мм</span><b className="g-hl">{num(k, 1)}</b></div>
          {otherK && <div className="g-kv"><span>Отношение к другому образцу</span><b>{num(k / otherK, 2)}×</b></div>}
        </div>
        <div className="g-row g-wrap">{m.skew <= tol ? <Badge tone="ok" icon="check">Квадрат = 1:1</Badge> : <Badge tone="warn" icon="warning">Эталон перекошен</Badge>}{s.calibration && <Badge tone="info">Сохранено: {num(s.calibration.px_per_mm, 1)} px/мм</Badge>}</div>
        {extra.warn_plane && m.skew > tol && <Notice tone="warn">Перекос больше {tol} % — эталон и образец, вероятно, не в одной плоскости. Площадь может быть искажена.</Notice>}
        <div style={{ flex: 1 }} />
        <Btn v="p" wide icon="check" disabled={ws.busy === 'calibrate' || (mode === 'auto' && !cands?.length)} onClick={() => accept(mode === 'manual' || pick > 0)}>{mode === 'auto' ? 'Принять эталон' : 'Подтвердить калибровку'}</Btn>
        {mode === 'manual' ? <Btn wide onClick={() => setCorners(cands?.[0]?.corners as Pt[] ?? initial(s))}>Сбросить углы</Btn> : <Btn wide icon="open_with" onClick={() => setMode('manual')}>Указать вручную</Btn>}
        {s.calibration && <Btn wide icon="download" onClick={() => download(api.standardizedUrl(s.id))}>Скачать выпрямленный снимок 20 px/мм</Btn>}
        {done && <Btn v="p" wide icon="arrow_forward" onClick={() => go('measurement')} disabled={!!stepBlock(ws, 'measurement')}>Перейти к измерению</Btn>}
      </aside>
    </div>
  );
}
