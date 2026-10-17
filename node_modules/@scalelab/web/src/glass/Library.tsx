import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReferenceStandard, Sample, Session } from '@masshtablab/shared';
import { api, type BatchResult } from '../api';
import { errText, useToast } from '../state';
import { Badge, Btn, Check, Empty, ErrorState, Field, Icon, Input, Loading, Modal, Select, Seg, Slider, download } from '../ui/atoms';
import { dayShort, num, pad3 } from '../lib/fmt';
import { filterAndSortSamples } from '../lib/sampleFilter';
import { GlassFrame, GlobalBar } from './Shell';
import { statusLabel, statusTone } from './Home';

export function GlassLibrary() {
  const nav = useNavigate(); const { toast } = useToast();
  const [all, setAll] = useState<Sample[] | null>(null);
  const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const [species, setSpecies] = useState<Set<string>>(new Set()); const [tags, setTags] = useState<Set<string>>(new Set());
  const [maxA, setMaxA] = useState(300); const [sort, setSort] = useState<'date' | 'name' | 'area'>('date');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set()); const [tagModal, setTagModal] = useState(false); const [tag, setTag] = useState('');
  const [batchOpen, setBatchOpen] = useState(false); const [folder, setFolder] = useState('batch'); const [bres, setBres] = useState<BatchResult | null>(null); const [bbusy, setBbusy] = useState(false);
  const runBatch = async () => { setBbusy(true); setBres(null); try { setBres(await api.batch(folder.trim())); } catch (e) { toast(errText(e), 'err'); } finally { setBbusy(false); } };
  const batchCsv = () => {
    if (!bres) return;
    const rows = [['файл', 'статус', 'px/мм', 'уверенность', 'погрешность масштаба, %'], ...bres.items.map((i) => [i.file, i.status === 'ok' ? 'эталон найден' : i.status === 'no_reference' ? 'эталон не найден' : 'не читается', i.px_per_mm?.toFixed(3) ?? '', i.confidence?.toFixed(2) ?? '', i.rel_error != null ? (i.rel_error * 100).toFixed(2) : ''])];
    const url = URL.createObjectURL(new Blob(['\ufeff' + rows.map((r) => r.join(';')).join('\n')], { type: 'text/csv;charset=utf-8' }));
    download(url); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const load = () => api.samples().then((l) => { setAll(l); setErr(''); }).catch((e) => setErr(errText(e)));
  useEffect(() => { void load(); }, []);

  const spec = useMemo(() => [...new Set((all ?? []).map((s) => s.species).filter(Boolean))], [all]);
  const tgs = useMemo(() => [...new Set((all ?? []).flatMap((s) => s.tags))], [all]);
  const shown = useMemo(() => filterAndSortSamples(all ?? [], { query: q, species, tags, maxAreaMm2: maxA, sort }), [all, q, species, tags, maxA, sort]);
  const flip = (s: Set<string>, v: string, set: (x: Set<string>) => void) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); set(n); };
  const picked = (all ?? []).filter((s) => sel.has(s.id));

  const addTag = async () => { const t = tag.trim(); if (!t) return; try { for (const s of picked) await api.patchSample(s.id, { tags: [...new Set([...s.tags, t])] }); toast('Тег добавлен', 'ok'); setTagModal(false); setTag(''); await load(); } catch (e) { toast(errText(e), 'err'); } };
  const del = async () => { if (!confirm(`Удалить выбранные образцы (${picked.length})? Замеры и калибровка будут удалены.`)) return; try { for (const s of picked) await api.deleteSample(s.id); setSel(new Set()); await load(); toast('Удалено', 'ok'); } catch (e) { toast(errText(e), 'err'); } };

  return (
    <GlassFrame bar={<GlobalBar onSearch={setQ} />}>
      <div className="g-lib">
        <aside className={`g-panel g-col g-fpanel${filtersOpen ? ' open' : ''}`} style={{ alignSelf: 'start' }}>
          <h2 className="g-h2">Фильтры</h2>
          <div className="g-col" style={{ gap: 8 }}><b style={{ fontWeight: 500 }}>Вид</b>{spec.length ? spec.map((s) => <Check key={s} checked={species.has(s)} onChange={() => flip(species, s, setSpecies)}>{s}</Check>) : <span className="g-dim">Не указан</span>}</div>
          <div className="g-col" style={{ gap: 8 }}><b style={{ fontWeight: 500 }}>Теги</b><div className="g-row g-wrap">{tgs.length ? tgs.map((t) => <button key={t} className={`pill${tags.has(t) ? ' on' : ''}`} onClick={() => flip(tags, t, setTags)}>{t}</button>) : <span className="g-dim">Тегов нет</span>}</div></div>
          <Slider label="Площадь, мм² (до)" value={maxA} min={10} max={1000} step={10} onChange={setMaxA} />
          <Btn wide onClick={() => { setSpecies(new Set()); setTags(new Set()); setMaxA(300); setQ(''); }}>Сбросить</Btn>
          <Btn v="p" wide className="g-only-m" onClick={() => setFiltersOpen(false)}>Готово</Btn>
        </aside>
        <div className="g-col" style={{ minWidth: 0 }}>
          <div className="g-only-m g-col" style={{ gap: 10 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по образцам" aria-label="Поиск по образцам" /><Btn icon="tune" onClick={() => setFiltersOpen(!filtersOpen)}>{filtersOpen ? 'Скрыть фильтры' : 'Фильтры'}</Btn></div>
          <div className="g-row g-between g-wrap"><h1 className="g-h2" style={{ fontSize: '1.8em' }}>Библиотека образцов <span className="bdg" style={{ marginLeft: 8 }}>{shown.length}</span></h1>
            <div className="g-row"><Btn sm icon="folder_open" onClick={() => setBatchOpen(true)}>Пакетная обработка</Btn>
            <Seg value={sort} onChange={setSort} options={[{ v: 'date', t: 'Новые' }, { v: 'name', t: 'По имени' }, { v: 'area', t: 'По площади' }]} /></div></div>
          {err ? <ErrorState text={err} retry={load} /> : !all ? <Loading /> : shown.length === 0 ? <Empty icon="photo_library" title="Образцов не найдено" text={all.length ? 'Ослабьте фильтры.' : 'Загрузите снимки в любой сессии — они появятся здесь.'} /> : (
            <div className="g-lib-grid">{shown.map((s) => (
              <button key={s.id} className={`g-lcard${sel.has(s.id) ? ' on' : ''}`} onClick={() => flip(sel, s.id, setSel)} onDoubleClick={() => nav(`/session/${s.session_id}`)} aria-pressed={sel.has(s.id)}>
                <img src={api.imageUrl(s.id)} alt={s.name} loading="lazy" /><div><div className="g-row g-between"><b style={{ fontWeight: 500 }}>{s.name}</b><small className="g-hl">{s.area_mm2 != null ? `${num(s.area_mm2)} мм²` : ''}</small></div>
                  <small>№{pad3(s.session_number ?? 0)}, {s.species || 'вид не указан'}</small><small>{s.calibration ? `${num(s.calibration.px_per_mm, 1)} px/мм` : 'не откалиброван'}, {dayShort(s.created_at)}</small></div>
              </button>))}</div>)}
          {picked.length > 0 && (
            <div className="g-panel g-row g-between g-wrap" style={{ position: 'sticky', bottom: 12 }}><span>Выбрано {picked.length} из {shown.length}</span>
              <div className="g-row g-wrap"><Btn sm icon="label" onClick={() => setTagModal(true)}>Добавить тег</Btn><Btn sm icon="open_in_new" disabled={picked.length !== 1} onClick={() => nav(`/session/${picked[0]!.session_id}`)}>Открыть сессию</Btn><Btn sm v="d" icon="delete" onClick={del}>Удалить</Btn></div></div>)}
        </div>
      </div>
      {batchOpen && (
        <Modal wide title="Пакетная обработка папки" onClose={() => setBatchOpen(false)} foot={<><Btn onClick={() => setBatchOpen(false)}>Закрыть</Btn>{bres && <Btn icon="download" onClick={batchCsv}>Скачать CSV</Btn>}<Btn v="p" icon="play_arrow" disabled={bbusy || !folder.trim()} onClick={runBatch}>{bbusy ? 'Обработка…' : 'Запустить'}</Btn></>}>
          <p className="g-dim">Папка внутри каталога данных сервера (по умолчанию localdata\batch). Для каждого снимка находится эталон 1×1 см и считается масштаб.</p>
          <Field label="Папка"><Input value={folder} onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runBatch()} /></Field>
          {bres && (bres.items.length === 0 ? <p className="g-dim">В папке нет снимков.</p> : (
            <div className="g-list" style={{ maxHeight: 320, overflow: 'auto' }}>{bres.items.map((i) => (
              <div key={i.file} className={`g-check${i.status === 'ok' ? '' : ' no'}`}><Icon n={i.status === 'ok' ? 'check_circle' : 'error'} /><span>{i.file}</span><span>{i.status === 'ok' ? `${num(i.px_per_mm!, 1)} px/мм, ${Math.round(i.confidence! * 100)}%` : i.status === 'no_reference' ? 'эталон не найден' : 'не читается'}</span></div>))}</div>))}
        </Modal>)}
      {tagModal && <Modal title="Добавить тег" onClose={() => setTagModal(false)} foot={<><Btn onClick={() => setTagModal(false)}>Отмена</Btn><Btn v="p" onClick={addTag}>Добавить</Btn></>}><Field label="Тег"><Input autoFocus value={tag} maxLength={40} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} /></Field></Modal>}
    </GlassFrame>
  );
}

const KIND_ICON: Record<string, string> = { checker: 'grid_on', ruler: 'straighten', coin: 'circle', custom: 'crop_free' };
const KIND_RU: Record<string, string> = { checker: 'шахматный', ruler: 'линейка', coin: 'круг', custom: 'свой' };

export function GlassStandards() {
  const { toast } = useToast();
  const [list, setList] = useState<ReferenceStandard[] | null>(null); const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', kind: 'custom' as ReferenceStandard['kind'], width_mm: 10, height_mm: 10, tolerance_mm: 0.05, note: '' });
  const load = () => api.standards().then(setList).catch((e) => setErr(errText(e)));
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!f.name.trim() || f.width_mm <= 0 || f.height_mm <= 0) return toast('Укажите название и положительные размеры', 'err');
    try { await api.addStandard({ ...f, name: f.name.trim() }); toast('Эталон сохранён', 'ok'); setF({ ...f, name: '', note: '' }); await load(); } catch (e) { toast(errText(e), 'err'); }
  };
  return (
    <GlassFrame bar={<GlobalBar />}>
      <div className="g-std">
        {err ? <ErrorState text={err} retry={load} /> : !list ? <Loading /> : (
          <div className="g-std-grid">{list.map((s) => (
            <div key={s.id} className="g-std-card"><div className="g-std-ico"><Icon n={KIND_ICON[s.kind] ?? 'crop_free'} /></div>
              <b className="g-std-name"><span>{s.name.replace(/\s*\d+([.,]\d+)?\s*[×x]\s*\d+([.,]\d+)?\s*мм$/i, '')}</span></b>{s.owner_id && <Badge tone="info">свой</Badge>}
              <div className="g-std-rows"><div><small>Размер</small><b>{s.width_mm} × {s.height_mm} мм</b></div><div><small>Допуск</small><b>±{s.tolerance_mm} мм</b></div></div>
              {s.owner_id && <Btn sm v="d" icon="delete" onClick={async () => { await api.deleteStandard(s.id); await load(); }}>Удалить</Btn>}</div>))}</div>)}
        <aside className="g-panel g-col" style={{ alignSelf: 'start' }}>
          <h2 className="g-h2">Свой эталон</h2>
          <Field label="Название"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Калибровочная пластина А" maxLength={120} /></Field>
          <Field label="Форма"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ReferenceStandard['kind'] })}>{Object.entries(KIND_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <div className="g-row"><div className="g-grow"><Field label="Ширина, мм"><Input type="number" min={0.1} step={0.1} value={f.width_mm} onChange={(e) => setF({ ...f, width_mm: Number(e.target.value) })} /></Field></div><div className="g-grow"><Field label="Высота, мм"><Input type="number" min={0.1} step={0.1} value={f.height_mm} onChange={(e) => setF({ ...f, height_mm: Number(e.target.value) })} /></Field></div></div>
          <Field label="Допуск размера, мм" hint="Размер эталона"><Input type="number" min={0} step={0.01} value={f.tolerance_mm} onChange={(e) => setF({ ...f, tolerance_mm: Number(e.target.value) })} /></Field>
          <Field label="Заметка"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></Field>
          <Btn v="p" wide icon="save" onClick={save}>Сохранить эталон</Btn>
        </aside>
      </div>
    </GlassFrame>
  );
}

export function GlassReports() {
  const nav = useNavigate();
  const [rows, setRows] = useState<{ s: Session; v: number; sha: string }[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { (async () => { try { const ss = (await api.sessions()).filter((s) => (s.version_count ?? 0) > 0); setRows(await Promise.all(ss.map(async (s) => { const v = (await api.versions(s.id))[0]!; return { s, v: v.number, sha: v.sha256 }; }))); } catch (e) { setErr(errText(e)); } })(); }, []);
  return (
    <GlassFrame bar={<GlobalBar />}>
      {err ? <ErrorState text={err} /> : !rows ? <Loading /> : rows.length === 0 ? <Empty icon="description" title="Сохранённых отчётов пока нет" /> : (
        <section className="g-panel g-twrap"><table className="g-tbl"><thead><tr><th>Сессия</th><th>Состояние</th><th>Версий</th><th>Контрольная сумма</th><th>Изменена</th><th /></tr></thead>
          <tbody>{rows.map(({ s, v, sha }) => <tr key={s.id}><td><b style={{ fontWeight: 500 }}>№{pad3(s.number)}, {s.title}</b></td><td><Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge></td><td>{s.version_count} (v{v})</td><td className="g-dim">{sha.slice(0, 16)}…</td><td>{dayShort(s.updated_at)}</td>
            <td className="r"><div className="g-row" style={{ justifyContent: 'flex-end' }}><Btn sm icon="history" onClick={() => nav(`/session/${s.id}/versions`)}>Версии</Btn><Btn sm v="p" icon="download" onClick={() => download(api.exportUrl(s.id, ['pdf'], { version: v }))}>PDF</Btn></div></td></tr>)}</tbody></table></section>)}
    </GlassFrame>
  );
}
