import { useMemo, useState } from 'react';
import type { Measurement } from '@masshtablab/shared';
import { useWs } from '../session';
import { useToast } from '../state';
import { Btn, Check, Empty, Icon, Metric, Seg } from '../ui/atoms';
import { num, plural } from '../lib/fmt';
import type { Go } from './Session';

type Row = Measurement & { sample: string; slot: number };
const KIND: Record<string, string> = { polygon: 'Площадь', mask: 'Площадь', line: 'Длина', angle: 'Угол', circle: 'Диаметр' };
const KIND_ICON: Record<string, string> = { polygon: 'pentagon', mask: 'auto_fix_high', line: 'show_chart', angle: 'square_foot', circle: 'circle' };

export const toCsv = (rows: Row[]) => '﻿' + ['Образец;Метка;Тип;Значение;Ед.;Периметр, мм;px/мм;Погрешность',
  ...rows.map((r) => [r.sample, r.label, KIND[r.kind], num(r.value, 3), r.unit, num(r.perimeter_mm, 3), num(r.px_per_mm, 2), num(r.error, 3)].join(';'))].join('\r\n');

export function GlassTable({ go }: { go: Go }) {
  const ws = useWs();
  const { toast } = useToast();
  const [f, setF] = useState<'all' | 'area' | 'len' | 'ang'>('all');
  const [sort, setSort] = useState<'sample' | 'value'>('sample');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const rows = useMemo<Row[]>(() => ws.samples.flatMap((s) => (s.measurements ?? []).map((m) => ({ ...m, sample: s.name, slot: s.slot }))), [ws.samples]);
  const shown = rows.filter((r) => f === 'all' || (f === 'area' ? r.unit === 'мм²' : f === 'len' ? r.unit === 'мм' : r.unit === '°')).sort((a, b) => (sort === 'value' ? b.value - a.value : a.slot - b.slot));
  const areas = rows.filter((r) => r.unit === 'мм²');
  const avg = areas.length ? areas.reduce((s, r) => s + r.value, 0) / areas.length : null;
  const max = Math.max(1, ...areas.map((r) => r.value));
  const target = sel.size ? shown.filter((r) => sel.has(r.id)) : shown;

  const csv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(target)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `izmereniya_${ws.session!.number}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(target.map((r) => [r.sample, r.label, num(r.value), r.unit].join('\t')).join('\n')); toast('Скопировано в буфер обмена', 'ok'); } catch { toast('Не удалось скопировать', 'err'); } };

  if (!rows.length) return <Empty icon="table_chart" title="Замеров пока нет" text="Обведите образец на шаге «Измерение» — значения появятся здесь." action={<Btn v="p" onClick={() => go('measurement')}>К измерению</Btn>} />;
  return (
    <div className="g-table-page">
      <section className="g-panel g-col">
        <div className="g-row g-between g-wrap"><h2 className="g-h2">Таблица измерений <span className="bdg" style={{ marginLeft: 8 }}>{rows.length} {plural(rows.length, 'замер', 'замера', 'замеров')}</span></h2>
          <div className="g-row g-wrap"><Seg value={f} onChange={setF} options={[{ v: 'all', t: 'Все' }, { v: 'area', t: 'Площади' }, { v: 'len', t: 'Длины' }, { v: 'ang', t: 'Углы' }]} />
            <Btn sm icon="sort" onClick={() => setSort(sort === 'sample' ? 'value' : 'sample')}>{sort === 'sample' ? 'По образцам' : 'По значению'}</Btn></div></div>
        <div className="g-twrap">
          <table className="g-tbl">
            <thead><tr><th style={{ width: 36 }}><span className="sr">Выбор</span></th><th>Образец</th><th>Замер</th><th>Тип</th><th className="r">Значение</th><th className="r">Периметр, мм</th><th className="r">px/мм</th><th className="r">Погрешность</th><th>В отчёте</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? 'sel' : ''}>
                <td><Check checked={sel.has(r.id)} onChange={(v) => setSel((s) => { const n = new Set(s); v ? n.add(r.id) : n.delete(r.id); return n; })}><span className="sr">Выбрать {r.label}</span></Check></td>
                <td>{r.sample}</td><td><Icon n={KIND_ICON[r.kind] ?? 'pentagon'} /> {r.label}</td><td>{KIND[r.kind]}</td>
                <td className="r"><b>{num(r.value)}</b> {r.unit}</td><td className="r">{num(r.perimeter_mm)}</td><td className="r">{num(r.px_per_mm, 1)}</td><td className="r">±{num(r.error)}</td>
                <td><button className={`tgl${r.in_table ? ' on' : ''}`} role="switch" aria-checked={r.in_table} aria-label={`Включить ${r.label} в отчёт`} onClick={() => ws.updateMeasurement(r.id, { in_table: !r.in_table })}><i /></button></td>
              </tr>))}</tbody>
          </table>
        </div>
        <div className="g-row g-between g-wrap"><span className="g-dim">{sel.size ? `Выбрано ${sel.size} из ${shown.length}` : `Показано ${shown.length}`}</span>
          <div className="g-row"><Btn sm icon="content_copy" onClick={copy}>Копировать</Btn><Btn sm v="p" icon="download" onClick={csv}>Экспорт CSV</Btn></div></div>
      </section>
      <aside className="g-col">
        <div className="g-panel"><Metric label="Средняя площадь" value={num(avg)} unit="мм²" sub={`${areas.length} ${plural(areas.length, 'замер', 'замера', 'замеров')} площади`} /></div>
        <div className="g-panel g-col"><h2 className="g-h3">Площадь по контурам</h2>
          <div className="g-bars">{areas.map((r) => <div key={r.id}><i style={{ height: `${(r.value / max) * 100}%` }} title={`${r.sample}, ${r.label}: ${num(r.value)} мм²`} /><small>{r.sample.replace('Образец ', 'О')}, {r.label}</small></div>)}</div>
          <div className="g-row g-between g-dim" style={{ fontSize: '.88em' }}><span>Мин. {num(Math.min(...areas.map((r) => r.value)))}</span><span>Макс. {num(Math.max(...areas.map((r) => r.value)))}</span></div></div>
        <Btn v="p" wide icon="arrow_forward" onClick={() => go(ws.samples.length >= 2 ? 'comparison' : 'report')}>{ws.samples.length >= 2 ? 'К сравнению' : 'К отчёту'}</Btn>
      </aside>
    </div>
  );
}
