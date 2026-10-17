import { useEffect, useMemo, useState } from 'react';
import type { CompareResult, Measurement, Pt, Sample } from '@masshtablab/shared';
import { api } from '../api';
import { useWs } from '../session';
import { errText } from '../state';
import { Badge, Btn, Empty, ErrorState, Icon, Loading, Notice, Seg } from '../ui/atoms';
import { Stage } from '../ui/Stage';
import { centroid, pathOf } from '../lib/geom';
import { num, pct, sign } from '../lib/fmt';
import { RefOverlay } from './Calibration';
import type { Go } from './Session';

export const mainArea = (s: Sample): Measurement | undefined => s.measurements?.find((m) => m.kind === 'polygon' || m.kind === 'mask');

function Card({ s, n }: { s: Sample; n: number }) {
  const m = mainArea(s);
  return (
    <section className="g-panel g-cmp-card">
      <div className="g-cmp-h"><h3>Образец 0{n}</h3><span className="g-dim" style={{ fontSize: '.85em' }}>{num(s.calibration?.px_per_mm, 1)} px/мм</span><span style={{ marginLeft: 'auto' }}><Badge tone="ok" icon="check">откалиброван</Badge></span></div>
      <div className="g-cmp-img">
        <Stage src={api.imageUrl(s.id)} width={s.width} height={s.height} cursor="grab" pad={0.96}>
          {s.calibration && <RefOverlay corners={s.calibration.corners} />}
          {m && <path d={pathOf(m.vertices)} className="ov-fill ov-line" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
        </Stage>
      </div>
      <div className="g-cmp-m">
        <div className="g-panel2"><small>Площадь, мм²</small><b>{num(m?.value)}</b></div>
        <div className="g-panel2"><small>Периметр, мм</small><b>{num(m?.perimeter_mm)}</b></div>
        <div className="g-panel2"><small>px / мм</small><b>{num(s.calibration?.px_per_mm, 1)}</b></div>
      </div>
    </section>
  );
}

function Diff({ a, b }: { a: Sample; b: Sample }) {
  const ma = mainArea(a), mb = mainArea(b);
  if (!ma || !mb) return <Empty icon="pentagon" title="Нужны контуры" text="Обведите образцы на шаге «Измерение»." />;
  const conv = (m: Measurement, k: number): Pt[] => { const c = centroid(m.vertices); return m.vertices.map((p) => [(p[0] - c[0]) / k, (p[1] - c[1]) / k]); };
  const pa = conv(ma, a.calibration!.px_per_mm), pb = conv(mb, b.calibration!.px_per_mm);
  const all = [...pa, ...pb]; const R = Math.max(...all.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 1.15;
  return (
    <section className="g-panel" style={{ minHeight: 480, display: 'grid', placeItems: 'center' }}>
      <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} style={{ width: 'min(100%, 70vh)', height: 'auto' }} role="img" aria-label="Наложение контуров в миллиметрах">
        <defs><pattern id="mm" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="var(--bd)" strokeWidth=".02" /></pattern></defs>
        <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="url(#mm)" />
        <path d={pathOf(pa)} fill="var(--s1)" fillOpacity=".25" stroke="var(--s1)" strokeWidth={R / 120} />
        <path d={pathOf(pb)} fill="var(--pri)" fillOpacity=".25" stroke="var(--pri)" strokeWidth={R / 120} />
      </svg>
      <div className="g-row"><Badge>Образец 01</Badge><Badge tone="info">Образец 02</Badge><span className="g-dim">Контуры в мм, совмещены по центрам</span></div>
    </section>
  );
}

function Wipe({ a, b }: { a: Sample; b: Sample }) {
  const [x, setX] = useState(50);
  const ka = a.calibration!.px_per_mm, kb = b.calibration!.px_per_mm;
  const W = 900, H = 560;
  const extentMm = [[a, ka], [b, kb]].map(([smp, k]) => { const m = mainArea(smp as Sample); if (!m) return 0; const xs = m.vertices.map((p) => p[0]), ys = m.vertices.map((p) => p[1]); return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / (k as number); });
  const widest = Math.max(...extentMm);
  const f = widest > 0 ? Math.max(1, Math.round((Math.min(W, H) * 0.7) / widest * 10) / 10) : 8;
  const place = (s: Sample, k: number) => { const m = mainArea(s); const c = m ? centroid(m.vertices) : [s.width / 2, s.height / 2]; const sc = f / k; return { width: s.width * sc, height: s.height * sc, left: W / 2 - c[0]! * sc, top: H / 2 - c[1]! * sc }; };
  const pa = place(a, ka), pb = place(b, kb);
  return (
    <section className="g-panel g-col" style={{ minHeight: 480, alignItems: 'center' }}>
      <div className="g-wipe" style={{ width: W, maxWidth: '100%', aspectRatio: `${W}/${H}`, overflow: 'hidden', background: '#05070a', borderRadius: 12, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0, transformOrigin: '0 0' }}><img src={api.imageUrl(a.id)} alt="Образец 01" style={{ position: 'absolute', ...pa, maxWidth: 'none' }} /></div>
        <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${x}%)` }}><img src={api.imageUrl(b.id)} alt="Образец 02" style={{ position: 'absolute', ...pb, maxWidth: 'none' }} /></div>
        <div className="g-wipe-hand" style={{ left: `${x}%` }} />
      </div>
      <input className="rng" type="range" min={0} max={100} value={x} onChange={(e) => setX(Number(e.target.value))} aria-label="Положение шторки" style={{ maxWidth: 600, ['--p' as string]: `${x}%` }} />
      <span className="g-dim">Снимки приведены к одному масштабу ({f} px = 1 мм) и совмещены по центрам контуров</span>
    </section>
  );
}

export function GlassCompare({ go }: { go: Go }) {
  const ws = useWs();
  const [mode, setMode] = useState<'side' | 'diff' | 'wipe'>('side');
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [err, setErr] = useState('');
  const [a, b] = [...ws.samples].sort((x, y) => x.slot - y.slot);
  const key = ws.samples.map((s) => `${s.id}:${s.measurements?.length}:${s.calibration?.px_per_mm}`).join('|');
  useEffect(() => { setCmp(null); setErr(''); if (a && b) api.compare(ws.session!.id).then(setCmp).catch((e) => setErr(errText(e))); }, [key]);
  const ready = useMemo(() => !!(a && b && a.calibration && b.calibration), [a, b]);

  if (!a || !b) return <Empty icon="compare" title="Для сравнения нужны два образца" action={<Btn v="p" onClick={() => go('upload')}>Загрузить второй снимок</Btn>} />;
  if (!ready) return <Empty icon="grid_on" title="Один образец не откалиброван" text="Сравнение возможно после калибровки обоих снимков." action={<Btn v="p" onClick={() => go('calibration')}>К калибровке</Btn>} />;
  const A = cmp?.area_mm2;
  return (
    <div className="g-compare">
      <div className="g-cmp-main">
        <div style={{ alignSelf: 'center' }}><Seg value={mode} onChange={setMode} options={[{ v: 'side', t: 'Рядом' }, { v: 'diff', t: 'Разность', icon: 'object_subtract' }, { v: 'wipe', t: 'Шторка' }]} /></div>
        {mode === 'side' ? <div className="g-cmp-pair"><Card s={a} n={1} /><Card s={b} n={2} /></div> : mode === 'diff' ? <Diff a={a} b={b} /> : <Wipe a={a} b={b} />}
      </div>
      <aside className="g-panel g-col" style={{ alignSelf: 'stretch' }}>
        <h2 className="g-h2">Выравнивание шкал</h2>
        <div className="g-panel2">
          <div className="g-kv"><span>Эталон</span><b>{a.calibration!.side_mm} × {a.calibration!.side_mm} мм</b></div>
          <div className="g-kv"><span>Образец 01</span><b className="g-hl">{num(a.calibration!.px_per_mm, 1)} px/мм</b></div>
          <div className="g-kv"><span>Образец 02</span><b className="g-hl">{num(b.calibration!.px_per_mm, 1)} px/мм</b></div>
          <div className="g-kv"><span>Нормировка</span><b>{cmp ? (cmp.scales_match ? '1:1' : `${num(cmp.scale_ratio, 2)}×`) : '—'}</b></div>
        </div>
        {cmp && !cmp.scales_match && <Notice icon="info">Масштабы снимков разные — значения приведены к миллиметрам, сравнение корректно.</Notice>}
        <h2 className="g-h2" style={{ marginTop: 8 }}>Разница размеров</h2>
        {err ? <ErrorState title="Нет данных" text={err} /> : !cmp ? <Loading /> : (
          <>
            <div className="g-bigpair"><div><small>Образец 01</small><b>{num(A?.a, 1)}</b></div><div style={{ textAlign: 'right' }}><small>Образец 02</small><b className="g-hl">{num(A?.b, 1)}</b></div></div>
            {A && <div className="g-ratio" aria-hidden="true"><i style={{ width: `${(A.a / (A.a + A.b)) * 100}%` }} /></div>}
            <div className="g-kv"><span>Разность</span><b className="g-hl">{pct(A?.delta_pct)}</b></div>
            <div className="g-panel2">
              <div className="g-kv"><span><Icon n="expand" />Площадь</span><b className="g-delta">{A ? <><span>{sign(A.delta)}</span><span>мм²</span></> : '—'}</b></div>
              <div className="g-kv"><span><Icon n="ruler_combined" />Периметр</span><b className="g-delta">{cmp.perimeter_mm ? <><span>{sign(cmp.perimeter_mm.delta)}</span><span>мм</span></> : '—'}</b></div>
            </div>
            <Notice icon="balance">{cmp.verdict}</Notice>
          </>
        )}
        <div style={{ flex: 1 }} />
        <Btn v="p" wide icon="arrow_forward" onClick={() => go('report')}>Перейти к отчёту</Btn>
      </aside>
    </div>
  );
}
export { Icon };
