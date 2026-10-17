import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useWs, stepBlock } from '../session';
import { useToast } from '../state';
import { Badge, Btn, Icon, Notice } from '../ui/atoms';
import type { Go } from './Session';

const MAX_MB = 50, OK = ['image/png', 'image/jpeg', 'image/tiff', 'image/webp'];
const MIN_W = 1000, MIN_H = 700;

export function GlassUpload({ go }: { go: Go }) {
  const ws = useWs();
  const { toast } = useToast();
  const [over, setOver] = useState<number | null>(null);
  const [auto, setAuto] = useState<Record<string, 'run' | 'ok' | 'no'>>({});
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  const take = async (file: File | undefined, slot: number) => {
    if (!file) return;
    if (!OK.includes(file.type)) return toast('Допустимы PNG, JPEG, TIFF и WebP', 'err');
    if (file.size > MAX_MB * 1024 * 1024) return toast(`Файл больше ${MAX_MB} МБ`, 'err');
    const s = await ws.upload(file, slot);
    if (s) {
      setAuto((a) => ({ ...a, [s.id]: 'run' }));
      const r = await ws.autoCalibrate(s, true);
      setAuto((a) => ({ ...a, [s.id]: r?.saved ? 'ok' : 'no' }));
    }
  };
  useEffect(() => {
    const a: Record<string, 'ok'> = {}; ws.samples.forEach((s) => { if (s.calibration) a[s.id] = 'ok'; }); setAuto((p) => ({ ...a, ...p }));
  }, [ws.samples.length]);

  const slot = (n: 1 | 2) => {
    const s = ws.samples.find((x) => x.slot === n);
    return (
      <section className="g-panel g-slot" aria-label={`Образец ${n}`}>
        <div className="g-row g-between"><b style={{ textTransform: 'uppercase' }}>Образец 0{n}</b>{s && (auto[s.id] === 'ok' ? <Badge tone="ok" icon="check">эталон найден</Badge> : auto[s.id] === 'run' ? <Badge>поиск эталона…</Badge> : <Badge tone="warn" icon="warning">эталон не найден</Badge>)}</div>
        {s ? (
          <div className="g-prev"><img src={api.imageUrl(s.id)} alt={s.name} /><button className="icbtn" aria-label="Убрать снимок" onClick={() => ws.removeSample(s.id)}><Icon n="close" /></button></div>
        ) : (
          <div className={`g-drop${over === n ? ' over' : ''}`} role="button" tabIndex={0} aria-label={`Выбрать файл для образца ${n}`}
            onClick={() => refs[n - 1]!.current?.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && refs[n - 1]!.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(n); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); void take(e.dataTransfer.files[0], n); }}>
            <Icon n="upload" /><span><b>Перетащите снимок или выберите файл</b></span><small>PNG, JPEG, TIFF, WebP, до {MAX_MB} МБ</small>
          </div>
        )}
        <input ref={refs[n - 1]} type="file" accept={OK.join(',')} hidden onChange={(e) => { void take(e.target.files?.[0], n); e.target.value = ''; }} />
        {s && <div className="g-row g-between g-dim" style={{ fontSize: '.88em' }}><span>{s.filename}</span><span>{s.width} × {s.height} px</span></div>}
      </section>
    );
  };

  const n = ws.samples.length;
  const lowRes = ws.samples.some((s) => s.width < MIN_W || s.height < MIN_H);
  const checks: [boolean, string, string][] = [
    [n >= 1, 'Загружен хотя бы один снимок', `${n} из 2`],
    [n > 0 && !lowRes, `Разрешение не ниже ${MIN_W}×${MIN_H}`, n ? (lowRes ? 'мало' : 'хорошо') : '—'],
    [n > 0 && ws.samples.every((s) => s.calibration), 'Эталон 1×1 см найден в кадре', n ? `${ws.samples.filter((s) => s.calibration).length} из ${n}` : '—'],
    [n === 2, 'Загружены оба образца (для сравнения)', n === 2 ? 'да' : 'по желанию'],
  ];
  const block = stepBlock(ws, 'calibration');
  return (
    <>
      <div><h1 className="g-hi" style={{ fontSize: '2.2em' }}>Одна шкала. <em>Каждый образец.</em></h1></div>
      <div className="g-upload">
        {slot(1)}{slot(2)}
        <aside className="g-panel g-col" style={{ alignSelf: 'start' }}>
          <h2 className="g-h2">Проверка снимков</h2>
          <div className="g-list">{checks.map(([ok, t, v]) => <div key={t} className={`g-check${ok ? '' : ' no'}`}><Icon n={ok ? 'check_circle' : 'radio_button_unchecked'} /><span>{t}</span><span>{v}</span></div>)}</div>
          {lowRes && <Notice tone="warn">Низкое разрешение снижает точность. Рекомендуется снимать не ниже {MIN_W}×{MIN_H} px.</Notice>}
          {n > 0 && !ws.calibrated && <Notice tone="warn">Эталон найден не везде. На следующем шаге его можно указать вручную.</Notice>}
          <Notice icon="lightbulb">Держите эталон и образец на одной высоте — так измерение точнее.</Notice>
          <Btn v="p" wide disabled={!!block || ws.busy === 'upload'} title={block ?? undefined} onClick={() => go('calibration')} icon="arrow_forward">Продолжить к калибровке</Btn>
        </aside>
      </div>
    </>
  );
}
