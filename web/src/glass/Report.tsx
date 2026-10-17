import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_SECTIONS, type ReportSections } from '@masshtablab/shared';
import { api } from '../api';
import { useWs } from '../session';
import { useAuth, useToast, errText } from '../state';
import { Badge, Btn, Check, Empty, Field, Icon, Input, Modal, Select, Toggle, download } from '../ui/atoms';
import { pathOf } from '../lib/geom';
import { dateTime, num, plural } from '../lib/fmt';
import type { Go } from './Session';

export const SECTION_LABELS: [keyof ReportSections, string, string][] = [
  ['title', 'Титульный лист', 'description'], ['images', 'Снимки с контурами', 'image'], ['calibration', 'Данные калибровки', 'grid_on'], ['table', 'Таблица измерений', 'table_chart'],
  ['formulas', 'Формулы расчёта', 'functions'], ['conclusions', 'Выводы', 'fact_check'], ['checksum', 'Контрольная сумма', 'verified'], ['signature', 'Подпись оператора', 'draw'],
];
export const TEMPLATES = ['Научный протокол (А4)', 'Краткая справка (А4)', 'Таблица значений'];

export function useReportOpts() {
  const { user } = useAuth();
  const ws = useWs();
  const [o, setO] = useState({ title: 'Измерение площади в едином масштабе', template: TEMPLATES[0]!, language: 'ru', format: 'А4, книжная', operator: '', sections: { ...DEFAULT_SECTIONS } as ReportSections });
  useEffect(() => { setO((p) => ({ ...p, operator: p.operator || user?.full_name || '' })); }, [user]);
  const preset = (t: string) => setO((p) => ({ ...p, template: t, sections: t === 'Краткая справка (А4)' ? { ...DEFAULT_SECTIONS, images: false, formulas: false, calibration: false } : t === 'Таблица значений' ? { ...DEFAULT_SECTIONS, images: false, formulas: false, title: false, conclusions: false } : { ...DEFAULT_SECTIONS } }));
  return { o, setO, preset, ws };
}

function Thumb({ id, w, h, vs }: { id: string; w: number; h: number; vs: number[][][] }) {
  return <div style={{ position: 'relative', aspectRatio: '4/3', overflow: 'hidden', borderRadius: 3, background: '#111' }}><img src={api.imageUrl(id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>{vs.map((v, i) => <path key={i} d={pathOf(v as [number, number][])} fill="rgba(47,114,174,.2)" stroke="#2F72AE" strokeWidth={Math.max(w, h) / 220} />)}</svg></div>;
}

type Blk = { key: string; el: ReactNode; mb: number; head?: string };
const PAGE_W = 560, PAGE_H = Math.round((560 * 297) / 210), PAD_Y = 28;

function Tbl({ cw, head, row }: { cw: number[]; head?: ReactNode; row?: ReactNode }) {
  return <table className="fx"><colgroup>{cw.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>{head ? <thead>{head}</thead> : <tbody>{row}</tbody>}</table>;
}

function Pages({ blocks, signature }: { blocks: Blk[]; signature: ReactNode }) {
  const meas = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[][]>([[]]);
  const [zoom, setZoom] = useState(1);
  const sig = useRef<HTMLDivElement>(null);
  const keys = blocks.map((b) => b.key).join('|');

  useLayoutEffect(() => {
    const m = meas.current; if (!m) return;
    const h = new Map<string, number>();
    m.querySelectorAll<HTMLElement>('[data-k]').forEach((e) => h.set(e.dataset.k!, e.offsetHeight));
    const sigH = (sig.current?.offsetHeight ?? 0) + 10;
    const room = PAGE_H - 2 * PAD_Y;
    const out: string[][] = [[]];
    let used = 0;
    const put = (k: string, mb: number) => { out[out.length - 1]!.push(k); used += (h.get(k) ?? 0) + mb; };
    for (const b of blocks) {
      const need = (h.get(b.key) ?? 0) + b.mb;
      const headH = b.head && used === 0 ? (h.get(b.head) ?? 0) : 0;
      if (used + need + headH > room && used > 0) { out.push([]); used = 0; }
      if (b.head && used === 0) put(b.head, 0);
      put(b.key, b.mb);
    }
    if (used + sigH > room && used > 0 && signature) out.push([]);
    setPages(out);
  }, [keys, !!signature]);

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const f = () => setZoom(Math.min(1, el.clientWidth / PAGE_W));
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect();
  }, []);

  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const mb = (k: string) => byKey.get(k)?.mb ?? 0;
  return (
    <div ref={box} className="g-pages" aria-label="Предпросмотр листов А4">
      <div className="g-a4 g-a4-meas" ref={meas} aria-hidden="true">{blocks.map((b) => <div key={b.key} data-k={b.key}>{b.el}</div>)}</div>
      <div className="g-a4 g-a4-meas" aria-hidden="true"><div ref={sig}>{signature}</div></div>
      {pages.map((pg, i) => (
        <figure key={i} className="g-a4-wrap" style={{ zoom }}>
          <div className="g-a4">
            {pg.map((k) => <div key={k} style={{ marginBottom: mb(k) }}>{byKey.get(k)?.el}</div>)}
            {i === pages.length - 1 && signature && <div style={{ marginTop: 'auto' }}>{signature}</div>}
          </div>
          <figcaption>Лист {i + 1} из {pages.length}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export function GlassReport({ go, openExport }: { go: Go; openExport: () => void }) {
  const { o, setO, preset, ws } = useReportOpts();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [last, setLast] = useState<{ number: number; sha: string; at: string } | null>(null);
  useEffect(() => { api.versions(ws.session!.id).then((v) => { if (v[0]) setLast({ number: v[0].number, sha: v[0].sha256, at: v[0].created_at }); }).catch(() => {}); }, [ws.session]);

  const sm = ws.samples;
  const preview = useMemo(() => sm.map((s) => ({ s, ms: (s.measurements ?? []).filter((m) => m.in_table) })), [sm]);
  if (!sm.length || !ws.measurementsCount) return <Empty icon="description" title="В отчёте пока нечего показывать" text="Сделайте хотя бы один замер." action={<Btn v="p" onClick={() => go('measurement')}>К измерению</Btn>} />;
  const sec = o.sections;
  const blocks: Blk[] = [];
  const add = (key: string, el: ReactNode, mb = 10, head?: string) => blocks.push({ key, el, mb, head });
  if (sec.title) add('title', <div className="g-a4-t"><small>ПРОТОКОЛ № {ws.session!.number}, МасштабЛаб</small><h1>{o.title}</h1><small>{new Date().toLocaleDateString('ru-RU')}, Оператор: {o.operator || '—'}, Версия v{(last?.number ?? 0) + 1}</small></div>);
  if (sec.images) add('images', <div className="imgs">{preview.map(({ s, ms }) => <Thumb key={s.id} id={s.id} w={s.width} h={s.height} vs={ms.filter((m) => m.kind === 'polygon' || m.kind === 'mask').map((m) => m.vertices)} />)}</div>);
  if (sec.calibration) {
    const cw = [50, 25, 25];
    add('cal-h', <Tbl cw={cw} head={<tr><th>Образец</th><th className="r">px/мм</th><th className="r">Эталон</th></tr>} />, 0);
    sm.forEach((s, i) => add(`cal-${s.id}`, <Tbl cw={cw} row={<tr><td>{s.name}</td><td className="r">{num(s.calibration?.px_per_mm, 1)}</td><td className="r">{s.calibration?.side_mm} мм</td></tr>} />, i === sm.length - 1 ? 10 : 0, 'cal-h'));
  }
  if (sec.table) {
    const cw = [28, 16, 30, 26];
    const rows = preview.flatMap(({ s, ms }) => ms.map((m) => ({ s, m })));
    add('tbl-h', <Tbl cw={cw} head={<tr><th>Образец</th><th>Замер</th><th className="r">Значение</th><th className="r">Периметр, мм</th></tr>} />, 0);
    rows.forEach(({ s, m }, i) => add(`tbl-${m.id}`, <Tbl cw={cw} row={<tr><td>{s.name}</td><td>{m.label}</td><td className="r">{num(m.value)} {m.unit}</td><td className="r">{num(m.perimeter_mm)}</td></tr>} />, i === rows.length - 1 ? 10 : 0, 'tbl-h'));
  }
  if (sec.formulas) add('formulas', <div className="frm">S, мм² = S, px / K², K = сторона эталона, px / мм, P = Σ|vᵢvᵢ₊₁| / K</div>);
  if (sec.conclusions) add('concl', <small>Выводы формируются автоматически при сохранении версии.</small>);
  if (sec.checksum) add('sum', <small>Контрольная сумма: {last ? last.sha.slice(0, 24) + '…' : 'будет рассчитана при сохранении'}</small>);

  const save = async () => {
    setSaving(true);
    try { const r = await api.saveReport(ws.session!.id, { title: o.title, template: o.template, language: o.language, format: o.format, operator: o.operator, sections: o.sections }); setLast({ number: r.number, sha: r.sha256, at: r.created_at }); await ws.reload(); toast(`Сохранена версия v${r.number}`, 'ok'); }
    catch (e) { toast(errText(e), 'err'); } finally { setSaving(false); }
  };
  return (
    <div className="g-report">
      <aside className="g-panel g-col">
        <div className="g-row g-between"><h2 className="g-h2">Разделы</h2><span className="g-dim">{Object.values(sec).filter(Boolean).length} из {SECTION_LABELS.length}</span></div>
        <div className="g-list">{SECTION_LABELS.map(([k, t, ic]) => <div key={k} className="g-sec-i"><Icon n={ic} /><span>{t}</span><button className={`tgl${sec[k] ? ' on' : ''}`} role="switch" aria-checked={sec[k]} aria-label={t} onClick={() => setO({ ...o, sections: { ...sec, [k]: !sec[k] } })}><i /></button></div>)}</div>
      </aside>
      <section className="g-panel" style={{ background: 'var(--glass2)' }}>
        <Pages blocks={blocks} signature={sec.signature ? <small>Подпись оператора: ________________</small> : null} />
      </section>
      <aside className="g-panel g-col">
        <h2 className="g-h2">Настройки отчёта</h2>
        <Field label="Шаблон"><Select value={o.template} onChange={(e) => preset(e.target.value)}>{TEMPLATES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Заголовок"><Input value={o.title} maxLength={200} onChange={(e) => setO({ ...o, title: e.target.value })} /></Field>
        <div className="g-row"><div className="g-grow"><Field label="Язык"><Select value={o.language} onChange={(e) => setO({ ...o, language: e.target.value })}><option value="ru">Русский</option></Select></Field></div>
          <div className="g-grow"><Field label="Формат"><Select value={o.format} onChange={(e) => setO({ ...o, format: e.target.value })}><option>А4, книжная</option></Select></Field></div></div>
        <Field label="Оператор"><Input value={o.operator} maxLength={120} onChange={(e) => setO({ ...o, operator: e.target.value })} /></Field>
        <div className="g-panel2 g-row"><Icon n="history" /><span className="g-grow"><b style={{ fontWeight: 500 }}>{last ? `Версия v${last.number} сохранена` : 'Версий пока нет'}</b><small className="g-dim" style={{ display: 'block' }}>{last ? dateTime(last.at) : 'Сохраните первую версию'}</small></span>{last && <Badge tone="ok" icon="check">есть</Badge>}</div>
        <div style={{ flex: 1 }} />
        <Btn v="p" wide icon="save" disabled={saving} onClick={save}>{saving ? 'Сохраняем…' : 'Сохранить версию'}</Btn>
        <Btn wide icon="download" onClick={openExport} disabled={!last}>Экспорт отчёта</Btn>
        <Btn wide icon="history" onClick={() => go('versions')} disabled={!last}>Журнал версий</Btn>
      </aside>
    </div>
  );
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const ws = useWs();
  const { toast } = useToast();
  const [fm, setFm] = useState<Record<string, boolean>>({ pdf: true, csv: true, png: false, json: false });
  const [name, setName] = useState(`protokol_${String(ws.session!.number).padStart(3, '0')}_${new Date().toISOString().slice(0, 10)}`);
  const [ver, setVer] = useState<number | undefined>();
  const [vers, setVers] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.versions(ws.session!.id).then((v) => { setVers(v.map((x) => x.number)); setVer(v[0]?.number); }).catch(() => {}); }, [ws.session]);
  const FM: [string, string, string][] = [['pdf', 'PDF', 'file_pdf'], ['csv', 'CSV', 'file_csv'], ['png', 'PNG', 'file_image'], ['json', 'JSON', 'file_code']];
  const chosen = Object.keys(fm).filter((k) => fm[k]);
  const go = async () => {
    setBusy(true);
    try {
      if (!vers.length) { const r = await api.saveReport(ws.session!.id, {}); setVer(r.number); download(api.exportUrl(ws.session!.id, chosen, { version: r.number, filename: name })); }
      else download(api.exportUrl(ws.session!.id, chosen, { version: ver, filename: name }));
      toast(chosen.length > 1 ? 'Архив ZIP формируется…' : 'Файл формируется…', 'ok'); onClose();
    } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Экспорт" onClose={onClose} foot={<><Btn onClick={onClose}>Отмена</Btn><Btn v="p" icon="download" disabled={!chosen.length || busy} onClick={go}>Экспортировать</Btn></>}>
      <p className="g-dim">Сессия №{ws.session!.number}, {ws.samples.length} {plural(ws.samples.length, 'образец', 'образца', 'образцов')}, {ws.measurementsCount} {plural(ws.measurementsCount, 'замер', 'замера', 'замеров')}</p>
      <div className="g-expo">
        <div className="g-col" style={{ gap: 8 }}><b style={{ fontWeight: 500 }}>Форматы</b>
          {FM.map(([k, t, ic]) => <div key={k} className={`g-fmt${fm[k] ? '' : ' off'}`} onClick={() => setFm({ ...fm, [k]: !fm[k] })}><Check checked={fm[k]!} onChange={(v) => setFm({ ...fm, [k]: v })}><span className="sr">{t}</span></Check><Icon n={ic} /><span className="g-grow"><b style={{ fontWeight: 500 }}>{t}</b></span></div>)}</div>
        <div className="g-col"><b style={{ fontWeight: 500 }}>Параметры</b>
          <Field label="Имя файла"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
          <Field label="Версия отчёта"><Select value={ver ?? ''} onChange={(e) => setVer(Number(e.target.value))} disabled={!vers.length}>{vers.length ? vers.map((v) => <option key={v} value={v}>v{v}{v === vers[0] ? ' (последняя)' : ''}</option>) : <option>Будет создана новая</option>}</Select></Field>
        </div>
      </div>
    </Modal>
  );
}
export { Toggle };
