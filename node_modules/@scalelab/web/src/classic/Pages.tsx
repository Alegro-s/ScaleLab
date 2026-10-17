import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_SECTIONS, STATUS_RU, type CompareResult, type Measurement, type Pt, type ReferenceStandard, type ReportSections, type ReportVersion, type Sample, type Session, type Step } from '@masshtablab/shared';
import { api } from '../api';
import { useAuth, errText, useExtra, usePrefs, useToast } from '../state';
import { useWs, nextStep, prevStep } from '../session';
import { Btn, Check, Empty, Field, Input, Loading, Modal, Notice, Select, ErrorState, download } from '../ui/atoms';
import { Stage } from '../ui/Stage';
import { areaMm2, perimeterMm, shoelace } from '../lib/geom';
import { dateTime, date, num, pad3, pct, sign } from '../lib/fmt';
import { Window } from './Window';

const Row = ({ l, children }: { l: string; children: ReactNode }) => <div className="c-row"><span>{l}</span><div>{children}</div></div>;
const Val = ({ children, tone, b }: { children: ReactNode; tone?: 'ok' | 'err'; b?: boolean }) => <div className={`c-val${b ? ' b' : ''}${tone ? ' ' + tone : ''}`}>{children}</div>;

export function ClassicLogin() {
  const { login, register, demo, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [name, setName] = useState(''); const [reg, setReg] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [remember, setRemember] = useState(true);
  useEffect(() => { if (user) nav('/', { replace: true }); }, [user, nav]);
  const go = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  const submit = () => { if (!email.trim() || pw.length < 6) return setErr('Введите почту и пароль (не короче 6 символов)'); void go(() => (reg ? register(email, pw, name) : login(email, pw))); };
  return (
    <Window title="МасштабЛаб — вход" noMenu status={err ? 'Ошибка входа' : 'Введите почту и пароль'}
      foot={<><Btn className="grow" onClick={() => setReg(!reg)}>{reg ? 'Я уже зарегистрирован' : 'Регистрация'}</Btn><Btn disabled={busy} onClick={() => go(demo)}>Демо-вход</Btn><Btn v="p" disabled={busy} onClick={submit}>{reg ? 'Создать' : 'Войти'}</Btn></>}>
      <form className="c-center" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <fieldset className="c-fs"><legend>{reg ? 'Регистрация' : 'Вход'}</legend>
          {reg && <Row l="Имя"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Row>}
          <Row l="Электронная почта"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Row>
          <Row l="Пароль"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={reg ? 'new-password' : 'current-password'} /></Row>
          <Check checked={remember} onChange={setRemember}>Запомнить меня</Check>
          {err && <p className="c-err" role="alert" style={{ marginTop: 12 }}>{err}</p>}
        </fieldset>
        <button type="submit" hidden />
      </form>
    </Window>
  );
}

export function ClassicSessions() {
  const nav = useNavigate(); const { toast } = useToast();
  const [list, setList] = useState<Session[] | null>(null); const [err, setErr] = useState(''); const [sel, setSel] = useState<string | null>(null);
  const load = () => api.sessions().then((l) => { setList(l); setSel((s) => s ?? l[0]?.id ?? null); }).catch((e) => setErr(errText(e)));
  useEffect(() => { void load(); }, []);
  const cur = list?.find((s) => s.id === sel);
  const create = async () => { try { const s = await api.createSession(`Сессия ${date(new Date().toISOString())}`); nav(`/session/${s.id}/upload`); } catch (e) { toast(errText(e), 'err'); } };
  const demo = async () => { try { const s = await api.seedDemo(); nav(`/session/${s.id}/calibration`); } catch (e) { toast(errText(e), 'err'); } };
  return (
    <Window title="МасштабЛаб — сессии" status={cur ? `Выбрана сессия №${pad3(cur.number)}` : 'Нет выбранной сессии'}
      foot={<><Btn className="grow" onClick={demo}>Демо-данные</Btn><Btn disabled={!cur} onClick={async () => { if (cur && confirm(`Удалить сессию «${cur.title}»?`)) { await api.deleteSession(cur.id); setSel(null); await load(); } }}>Удалить</Btn><Btn disabled={!cur} onClick={() => cur && nav(`/session/${cur.id}`)}>Открыть</Btn><Btn v="p" onClick={create}>Новая сессия</Btn></>}>
      <fieldset className="c-fs"><legend>Мои сессии</legend>
        {err ? <ErrorState text={err} retry={load} /> : !list ? <Loading /> : list.length === 0 ? <p>Сессий пока нет. Нажмите «Новая сессия» или «Демо-данные».</p> : (
          <table className="c-tbl"><thead><tr><th>№</th><th>Название</th><th>Образцов</th><th>Состояние</th><th>Дата</th></tr></thead>
            <tbody>{list.map((s) => <tr key={s.id} className={sel === s.id ? 'sel' : ''} onClick={() => setSel(s.id)} onDoubleClick={() => nav(`/session/${s.id}`)}><td>{pad3(s.number)}</td><td>{s.title}</td><td>{s.sample_count}</td><td>{STATUS_RU[s.status]}</td><td>{date(s.updated_at)}</td></tr>)}</tbody></table>)}
      </fieldset>
    </Window>
  );
}

export function ClassicSession({ step }: { step: Step | 'table' | 'versions' }) {
  const ws = useWs();
  const nav = useNavigate();
  const s = ws.session!;
  const st: Step = step === 'table' || step === 'versions' ? 'measurement' : step;
  const go = (x: Step) => nav(`/session/${s.id}/${x}`);
  const common = { go };
  return (
    <Window title={`МасштабЛаб — сессия №${pad3(s.number)}`} ws={ws} tab={st} status={ws.busy ? 'Выполняется…' : `${s.title}, образцов: ${ws.samples.length}`}
      foot={null}>
      {st === 'upload' ? <UploadTab {...common} /> : st === 'calibration' ? <CalibTab {...common} /> : st === 'measurement' ? <MeasureTab {...common} /> : st === 'comparison' ? <CompareTab {...common} /> : <ReportTab {...common} />}
    </Window>
  );
}

const Nav = ({ step, go, nextOk = true, extra }: { step: Step; go: (s: Step) => void; nextOk?: boolean; extra?: ReactNode }) => {
  const n = nextStep(step), p = prevStep(step);
  return <div className="c-btns" style={{ justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 12 }}>{extra}{p && <Btn onClick={() => go(p)}>← Назад</Btn>}{n && <Btn v="p" disabled={!nextOk} onClick={() => go(n)}>Далее →</Btn>}</div>;
};

function UploadTab({ go }: { go: (s: Step) => void }) {
  const ws = useWs(); const { toast } = useToast();
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const [std, setStd] = useState<ReferenceStandard[]>([]);
  const { extra } = useExtra();
  useEffect(() => { api.standards().then(setStd).catch(() => {}); }, []);
  const take = async (f: File | undefined, slot: number) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/tiff', 'image/webp'].includes(f.type)) return toast('Допустимы PNG, JPEG, TIFF, WebP', 'err');
    const s = await ws.upload(f, slot); if (s) await ws.autoCalibrate(s, true);
  };
  const slot = (n: 1 | 2) => { const s = ws.samples.find((x) => x.slot === n); return (
    <Row l={`Снимок ${n}`}><div className="c-btns"><Val>{s ? `${s.filename} — ${s.width}×${s.height} px${s.calibration ? ', эталон найден' : ', эталон не найден'}` : 'Файл не выбран'}</Val>
      <Btn onClick={() => refs[n - 1]!.current?.click()}>Обзор…</Btn>{s && <Btn onClick={() => ws.removeSample(s.id)}>Убрать</Btn>}</div>
      <input ref={refs[n - 1]} type="file" accept="image/png,image/jpeg,image/tiff,image/webp" hidden onChange={(e) => { void take(e.target.files?.[0], n); e.target.value = ''; }} /></Row>); };
  return (<>
    <fieldset className="c-fs"><legend>Файлы снимков</legend>{slot(1)}{slot(2)}</fieldset>
    <fieldset className="c-fs"><legend>Эталон</legend><Row l="Тип эталона"><Select value={extra.default_side} disabled aria-label="Тип эталона">{(std.filter((s) => s.kind === 'checker').length ? std.filter((s) => s.kind === 'checker') : [{ id: 'x', width_mm: 10, height_mm: 10 } as ReferenceStandard]).map((s) => <option key={s.id} value={s.width_mm}>Квадрат {s.width_mm} × {s.height_mm} мм</option>)}</Select></Row></fieldset>
    {ws.samples.length > 0 && !ws.calibrated && <Notice tone="warn">Эталон найден не на всех снимках. Длину стороны можно ввести вручную на вкладке «Калибровка».</Notice>}
    <Nav step="upload" go={go} nextOk={ws.samples.length > 0} extra={<span className="c-status" style={{ border: 0, background: 'none', marginRight: 'auto' }}>Выбрано файлов: {ws.samples.length}</span>} />
  </>);
}

function CalibTab({ go }: { go: (s: Step) => void }) {
  const ws = useWs(); const { extra } = useExtra();
  const [side, setSide] = useState(String(extra.default_side));
  const [px, setPx] = useState<Record<string, string>>({});
  const [dlg, setDlg] = useState<Sample | null>(null);
  useEffect(() => { const p: Record<string, string> = {}; ws.samples.forEach((s) => { if (s.calibration) p[s.id] = String(Math.round(s.calibration.px_per_mm * s.calibration.side_mm * 10) / 10); }); setPx((o) => ({ ...p, ...o })); }, [ws.samples]);
  const sm = Number(side.replace(',', '.'));
  const apply = async (s: Sample) => {
    const v = Number((px[s.id] ?? '').replace(',', '.'));
    if (!(v > 0) || !(sm > 0)) return;
    await ws.saveCalibration(s, [[0, 0], [v, 0], [v, v], [0, v]], sm, 'manual');
  };
  const [a, b] = ws.samples; const ka = a?.calibration?.px_per_mm, kb = b?.calibration?.px_per_mm;
  const same = ka && kb ? Math.abs(ka - kb) / Math.max(ka, kb) <= 0.005 : null;
  return (<>
    <fieldset className="c-fs"><legend>Данные эталона</legend>
      <Row l="Размер стороны, мм"><Input inputMode="decimal" value={side} onChange={(e) => setSide(e.target.value)} aria-label="Размер стороны эталона, мм" /></Row>
      {ws.samples.map((s) => <Row key={s.id} l={`Длина стороны на снимке ${s.slot}, px`}><div className="c-btns"><Input style={{ flex: 1, minWidth: 120 }} inputMode="decimal" value={px[s.id] ?? ''} onChange={(e) => setPx({ ...px, [s.id]: e.target.value })} aria-label={`Длина стороны на снимке ${s.slot}`} />
        <Btn onClick={async () => { const r = await ws.autoCalibrate(s, true); if (!r?.found) setDlg(s); }}>Найти</Btn><Btn onClick={() => apply(s)}>Применить</Btn></div></Row>)}
    </fieldset>
    <fieldset className="c-fs"><legend>Результат</legend>
      {ws.samples.map((s) => <Row key={s.id} l={`Масштаб снимка ${s.slot}`}><Val b>{s.calibration ? `${num(s.calibration.px_per_mm, 1)} px/мм${s.calibration.method === 'auto' ? ' (найден автоматически)' : ''}` : 'не определён'}</Val></Row>)}
      <Row l="Состояние"><Val tone={same === null ? undefined : same ? 'ok' : 'err'}>{same === null ? (ws.calibrated ? 'Масштаб определён' : 'Задайте масштаб для каждого снимка') : same ? 'Масштабы совпадают' : 'Масштабы различаются — значения приводятся к мм'}</Val></Row>
    </fieldset>
    <Nav step="calibration" go={go} nextOk={ws.calibrated} />
    {dlg && <Modal tone="err" title="Эталон не найден" onClose={() => setDlg(null)} foot={<><Btn onClick={() => { setDlg(null); go('upload'); }}>Другой снимок</Btn><Btn v="p" onClick={() => setDlg(null)}>Ввести вручную</Btn></>}>
      <p><b>Квадрат {side} × {side} мм не виден на снимке «{dlg.filename}».</b></p><p>Введите длину его стороны в пикселях вручную или выберите другой снимок.</p></Modal>}
  </>);
}

function MeasureTab({ go }: { go: (s: Step) => void }) {
  const ws = useWs(); const { toast } = useToast();
  const [idx, setIdx] = useState(0);
  const s = ws.samples[Math.min(idx, ws.samples.length - 1)]!;
  const poly = s.measurements?.find((m) => m.kind === 'polygon' || m.kind === 'mask');
  const [v, setV] = useState<Pt[]>(poly?.vertices ?? []);
  const [row, setRow] = useState<number | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => { setV(poly?.vertices ?? []); setRow(null); }, [s.id, poly?.id]);
  const k = s.calibration?.px_per_mm ?? 1;
  const dirty = JSON.stringify(v) !== JSON.stringify(poly?.vertices ?? []);
  const upd = (i: number, axis: 0 | 1, val: string) => setV(v.map((p, j) => (j === i ? (axis === 0 ? [Number(val) || 0, p[1]] : [p[0], Number(val) || 0]) : p)) as Pt[]);
  const save = async () => {
    if (v.length < 3) return toast('Для контура нужно минимум 3 вершины', 'err');
    if (poly) await ws.updateMeasurement(poly.id, { vertices: v }); else await ws.addMeasurement(s, 'polygon', v);
  };
  const live = { px: shoelace(v), mm: areaMm2(v, k), per: perimeterMm(v, k) };
  const others = (s.measurements ?? []).filter((m) => m.id !== poly?.id);
  return (<>
    <Row l="Образец"><Select value={idx} onChange={(e) => setIdx(Number(e.target.value))} aria-label="Образец">{ws.samples.map((x, i) => <option key={x.id} value={i}>{x.name}</option>)}</Select></Row>
    <fieldset className="c-fs"><legend>Вершины контура ({s.name.toLowerCase()})</legend>
      <table className="c-tbl"><thead><tr><th>№</th><th>X, px</th><th>Y, px</th></tr></thead>
        <tbody>{v.map((p, i) => <tr key={i} className={row === i ? 'sel' : ''} onClick={() => setRow(i)}><td>{i + 1}</td>
          <td><input className="inp" style={{ height: 28 }} aria-label={`X вершины ${i + 1}`} value={p[0]} onChange={(e) => upd(i, 0, e.target.value)} /></td><td><input className="inp" style={{ height: 28 }} aria-label={`Y вершины ${i + 1}`} value={p[1]} onChange={(e) => upd(i, 1, e.target.value)} /></td></tr>)}
          {v.length === 0 && <tr><td colSpan={3}>Вершин нет. Нажмите «Добавить» или отметьте точки на снимке.</td></tr>}</tbody></table>
      <div className="c-btns" style={{ marginTop: 10 }}>
        <Btn onClick={() => { setV([...v, v.length ? [v[v.length - 1]![0] + 10, v[v.length - 1]![1] + 10] : [100, 100]]); setRow(v.length); }}>Добавить</Btn>
        <Btn disabled={row === null} onClick={() => { setV(v.filter((_, i) => i !== row)); setRow(null); }}>Удалить</Btn>
        <Btn onClick={() => setShow(!show)}>{show ? 'Скрыть снимок' : 'Показать снимок'}</Btn>
        <Btn v="p" disabled={!dirty || v.length < 3 || ws.busy === 'measure'} onClick={save}>Сохранить контур</Btn></div>
      {show && <div className="c-canvas" style={{ marginTop: 12 }}><Stage src={api.imageUrl(s.id)} width={s.width} height={s.height} onPoint={(p) => setV([...v, [Math.round(p[0]), Math.round(p[1])]])} pad={0.96}>
        {v.length > 0 && <path d={v.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') + (v.length > 2 ? ' Z' : '')} className="ov-line" strokeWidth={3} vectorEffect="non-scaling-stroke" fill="none" />}
        {v.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={5 / 1} className="hnd" />)}</Stage></div>}
    </fieldset>
    <fieldset className="c-fs"><legend>Результат</legend>
      <Row l="Площадь, px²"><Val>{num(live.px, 0)}</Val></Row><Row l="Площадь, мм²"><Val b>{num(live.mm)}</Val></Row><Row l="Периметр, мм"><Val>{num(live.per)}</Val></Row>
      <Row l="Погрешность, мм²"><Val>{poly && !dirty ? `± ${num(poly.error)}` : dirty ? 'сохраните контур' : '—'}</Val></Row>
      {others.length > 0 && <Row l="Другие замеры"><Val>{others.map((m) => `${m.label}: ${num(m.value)} ${m.unit}`).join(', ')}</Val></Row>}
    </fieldset>
    <Nav step="measurement" go={go} nextOk={ws.measurementsCount > 0 && !dirty} />
  </>);
}

function CompareTab({ go }: { go: (s: Step) => void }) {
  const ws = useWs(); const [c, setC] = useState<CompareResult | null>(null); const [err, setErr] = useState('');
  const key = ws.samples.map((s) => `${s.id}${s.measurements?.length}${s.calibration?.px_per_mm}`).join();
  useEffect(() => { setC(null); setErr(''); if (ws.samples.length >= 2) api.compare(ws.session!.id).then(setC).catch((e) => setErr(errText(e))); }, [key]);
  if (ws.samples.length < 2) return <><Notice>Для сравнения нужны два образца. Загрузите второй снимок на вкладке «Загрузка».</Notice><Nav step="comparison" go={go} nextOk /></>;
  return (<>
    <fieldset className="c-fs"><legend>Сравнение образцов</legend>
      {err ? <p className="c-err">{err}</p> : !c ? <Loading /> : (
        <table className="c-tbl"><thead><tr><th>Показатель</th><th>Образец 1</th><th>Образец 2</th><th>Разница</th></tr></thead><tbody>
          <tr><td>Площадь, мм²</td><td>{num(c.area_mm2?.a)}</td><td>{num(c.area_mm2?.b)}</td><td>{c.area_mm2 ? sign(c.area_mm2.delta) : '—'}</td></tr>
          <tr><td>Периметр, мм</td><td>{num(c.perimeter_mm?.a)}</td><td>{num(c.perimeter_mm?.b)}</td><td>{c.perimeter_mm ? sign(c.perimeter_mm.delta) : '—'}</td></tr>
          <tr><td>Масштаб, px/мм</td><td>{num(c.a?.px_per_mm, 1)}</td><td>{num(c.b?.px_per_mm, 1)}</td><td>{c.scales_match ? '0' : `${num(c.scale_ratio, 2)}×`}</td></tr></tbody></table>)}
    </fieldset>
    {c && <p className="c-bigline">{c.verdict}{c.area_mm2?.delta_pct != null ? ` (${pct(c.area_mm2.delta_pct)})` : ''}</p>}
    {c && !c.scales_match && <Notice>Масштабы снимков различаются — значения приведены к миллиметрам.</Notice>}
    <Nav step="comparison" go={go} nextOk={!!c} />
  </>);
}

const SEC: [keyof ReportSections, string][] = [['title', 'Титульный лист'], ['images', 'Снимки с контурами'], ['calibration', 'Данные калибровки'], ['table', 'Таблица измерений'], ['formulas', 'Формулы расчёта'], ['conclusions', 'Выводы'], ['checksum', 'Контрольная сумма'], ['signature', 'Подпись оператора']];
function ReportTab({ go }: { go: (s: Step) => void }) {
  const ws = useWs(); const { user } = useAuth(); const { toast } = useToast(); const nav = useNavigate();
  const [sec, setSec] = useState<ReportSections>({ ...DEFAULT_SECTIONS });
  const [name, setName] = useState(`protokol_${pad3(ws.session!.number)}`);
  const [busy, setBusy] = useState(false);
  const save = async (fmt: 'pdf' | 'csv' | null) => {
    setBusy(true);
    try { const r = await api.saveReport(ws.session!.id, { sections: sec, operator: user?.full_name || user?.email }); await ws.reload(); toast(`Сохранена версия v${r.number}`, 'ok'); if (fmt) download(api.exportUrl(ws.session!.id, [fmt], { version: r.number, filename: name })); }
    catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  return (<>
    <fieldset className="c-fs"><legend>Что включить в отчёт</legend><div style={{ display: 'grid', gap: 8 }}>{SEC.map(([k, t]) => <Check key={k} checked={sec[k]} onChange={(v) => setSec({ ...sec, [k]: v })}>{t}</Check>)}</div></fieldset>
    <fieldset className="c-fs"><legend>Сохранить как</legend><Row l="Имя файла"><Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} aria-label="Имя файла" /></Row></fieldset>
    <div className="c-btns" style={{ justifyContent: 'flex-end', marginTop: 'auto' }}>
      <Btn onClick={() => go('comparison')}>← Назад</Btn><Btn disabled={busy} onClick={() => save(null)}>Сохранить версию</Btn><Btn disabled={busy || !ws.measurementsCount} onClick={() => save('csv')}>Сохранить CSV</Btn><Btn v="p" disabled={busy || !ws.measurementsCount} onClick={() => save('pdf')}>Сохранить PDF</Btn>
      <Btn disabled={!(ws.session!.version_count ?? 0)} onClick={() => nav(`/session/${ws.session!.id}/versions`)}>Версии…</Btn></div>
  </>);
}

export function ClassicVersions() {
  const ws = useWs(); const { toast } = useToast(); const nav = useNavigate();
  const [v, setV] = useState<ReportVersion[] | null>(null); const [sel, setSel] = useState<number | null>(null); const [open, setOpen] = useState(false);
  const load = () => api.versions(ws.session!.id).then((l) => { setV(l); setSel((s) => s ?? l[0]?.number ?? null); });
  useEffect(() => { void load(); }, []);
  const det = useMemo(() => v?.find((x) => x.number === sel), [v, sel]);
  const [pl, setPl] = useState<Awaited<ReturnType<typeof api.version>> | null>(null);
  useEffect(() => { setPl(null); if (open && sel) api.version(ws.session!.id, sel).then(setPl); }, [open, sel]);
  return (
    <Window title="МасштабЛаб — журнал" ws={ws} tab="versions" status={sel ? `Выбрана версия v${sel}` : 'Версий нет'}
      foot={<><Btn className="grow" onClick={() => nav(`/session/${ws.session!.id}/report`)}>← К отчёту</Btn><Btn disabled={!sel} onClick={() => setOpen(true)}>Открыть</Btn><Btn disabled={!sel} onClick={() => sel && download(api.exportUrl(ws.session!.id, ['pdf'], { version: sel }))}>Скачать PDF</Btn>
        <Btn v="p" disabled={!sel || sel === v?.[0]?.number} onClick={async () => { try { const r = await api.restore(ws.session!.id, sel!); toast(`Создана версия v${r.number}`, 'ok'); setSel(null); await load(); } catch (e) { toast(errText(e), 'err'); } }}>Вернуться к версии</Btn></>}>
      <fieldset className="c-fs"><legend>История версий отчёта</legend>
        {!v ? <Loading /> : v.length === 0 ? <p>Версий пока нет.</p> : <table className="c-tbl"><thead><tr><th>Версия</th><th>Дата и время</th><th>Автор</th><th>Что изменено</th></tr></thead><tbody>{v.map((x) => <tr key={x.id} className={sel === x.number ? 'sel' : ''} onClick={() => setSel(x.number)}><td>v{x.number}</td><td>{dateTime(x.created_at)}</td><td>{x.author}</td><td>{x.summary}</td></tr>)}</tbody></table>}
        {det && <p style={{ marginTop: 10, wordBreak: 'break-all' }}>Контрольная сумма SHA-256: {det.sha256}</p>}
      </fieldset>
      {open && <Modal title={`Версия v${sel}`} onClose={() => setOpen(false)} foot={<Btn v="p" onClick={() => setOpen(false)}>Закрыть</Btn>}>{!pl ? <Loading /> : <>{pl.payload.samples.map((s) => <p key={s.slot}><b>{s.name}</b>: {s.measurements.map((m) => `${m.label} = ${num(m.value)} ${m.unit}`).join('; ') || 'замеров нет'}</p>)}{pl.payload.conclusions.map((c, i) => <p key={i}>• {c}</p>)}<p>Целостность: {pl.intact ? 'контрольная сумма совпадает' : 'КОНТРОЛЬНАЯ СУММА НЕ СОВПАДАЕТ'}</p></>}</Modal>}
    </Window>
  );
}

export function ClassicSettings() {
  const { prefs, setPrefs } = usePrefs(); const { extra, setExtra } = useExtra(); const nav = useNavigate();
  return (
    <Window title="МасштабЛаб — настройки" status="Изменения применяются сразу" foot={<Btn v="p" onClick={() => nav(-1)}>Готово</Btn>}>
      <fieldset className="c-fs"><legend>Внешний вид</legend>
        <Row l="Дизайн"><div className="c-btns"><label className="chk"><input type="radio" name="ui" checked={prefs.ui_mode === 'classic'} onChange={() => setPrefs({ ui_mode: 'classic' })} /><span className="rad-b" aria-hidden="true" /><span>Классический</span></label>
          <label className="chk"><input type="radio" name="ui" checked={prefs.ui_mode === 'glass'} onChange={() => setPrefs({ ui_mode: 'glass' })} /><span className="rad-b" aria-hidden="true" /><span>Современный</span></label></div></Row>
        <Row l="Тема"><div className="c-btns"><label className="chk"><input type="radio" name="th" checked={prefs.theme === 'dark'} onChange={() => setPrefs({ theme: 'dark' })} /><span className="rad-b" aria-hidden="true" /><span>Тёмная</span></label>
          <label className="chk"><input type="radio" name="th" checked={prefs.theme === 'light'} onChange={() => setPrefs({ theme: 'light' })} /><span className="rad-b" aria-hidden="true" /><span>Светлая</span></label></div></Row>
      </fieldset>
      <fieldset className="c-fs"><legend>Основные</legend>
        <Row l="Язык"><Select value="ru" disabled aria-label="Язык"><option value="ru">Русский</option></Select></Row>
        <Row l="Знаков после запятой"><Select value={prefs.decimals} onChange={(e) => setPrefs({ decimals: Number(e.target.value) })} aria-label="Знаков после запятой">{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Row>
      </fieldset>
      <fieldset className="c-fs"><legend>Поведение</legend><div style={{ display: 'grid', gap: 8 }}>
        <Check checked={extra.snap} onChange={(v) => setExtra({ snap: v })}>Привязка к вершинам при рисовании</Check>
        <Check checked={extra.labels} onChange={(v) => setExtra({ labels: v })}>Показывать подписи на снимке</Check>
        <Check checked={prefs.hints} onChange={(v) => setPrefs({ hints: v })}>Показывать подсказки</Check>
        <Check checked={extra.require_review} onChange={(v) => setExtra({ require_review: v })}>Требовать ручную проверку эталона</Check>
        <Check checked={extra.warn_plane} onChange={(v) => setExtra({ warn_plane: v })}>Предупреждать о перекосе эталона</Check></div></fieldset>
    </Window>
  );
}

export function ClassicLibrary() {
  const nav = useNavigate(); const [l, setL] = useState<Sample[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { api.samples().then(setL).catch((e) => setErr(errText(e))); }, []);
  return (
    <Window title="МасштабЛаб — образцы" status={l ? `Образцов: ${l.length}` : ''} foot={<Btn v="p" onClick={() => nav('/')}>К сессиям</Btn>}>
      <fieldset className="c-fs"><legend>Образцы</legend>{err ? <p className="c-err">{err}</p> : !l ? <Loading /> : l.length === 0 ? <Empty title="Образцов нет" /> :
        <table className="c-tbl"><thead><tr><th>Образец</th><th>Сессия</th><th>Вид</th><th>Масштаб, px/мм</th><th>Площадь, мм²</th></tr></thead><tbody>{l.map((s) => <tr key={s.id} onDoubleClick={() => nav(`/session/${s.session_id}`)}><td>{s.name}</td><td>№{pad3(s.session_number ?? 0)}</td><td>{s.species || '—'}</td><td>{num(s.calibration?.px_per_mm, 1)}</td><td>{num(s.area_mm2)}</td></tr>)}</tbody></table>}</fieldset>
    </Window>
  );
}
export function ClassicStandards() {
  const nav = useNavigate(); const { toast } = useToast(); const [l, setL] = useState<ReferenceStandard[] | null>(null);
  const [f, setF] = useState({ name: '', w: '10', h: '10' });
  const load = () => api.standards().then(setL).catch(() => setL([]));
  useEffect(() => { void load(); }, []);
  const add = async () => { const w = Number(f.w.replace(',', '.')), h = Number(f.h.replace(',', '.')); if (!f.name.trim() || !(w > 0) || !(h > 0)) return toast('Укажите название и размеры', 'err'); try { await api.addStandard({ name: f.name.trim(), kind: 'custom', width_mm: w, height_mm: h, tolerance_mm: 0.05, note: '' }); setF({ ...f, name: '' }); await load(); } catch (e) { toast(errText(e), 'err'); } };
  return (
    <Window title="МасштабЛаб — эталоны" status={l ? `Эталонов: ${l.length}` : ''} foot={<Btn v="p" onClick={() => nav('/')}>К сессиям</Btn>}>
      <fieldset className="c-fs"><legend>Эталоны</legend>{!l ? <Loading /> : <table className="c-tbl"><thead><tr><th>Название</th><th>Размер, мм</th><th>Допуск, мм</th><th>Вид</th></tr></thead><tbody>{l.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.width_mm} × {s.height_mm}</td><td>±{s.tolerance_mm}</td><td>{s.owner_id ? 'свой' : ''}</td></tr>)}</tbody></table>}</fieldset>
      <fieldset className="c-fs"><legend>Свой эталон</legend><Row l="Название"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Название" /></Row>
        <Row l="Ширина, мм"><Input value={f.w} onChange={(e) => setF({ ...f, w: e.target.value })} aria-label="Ширина" /></Row><Row l="Высота, мм"><Input value={f.h} onChange={(e) => setF({ ...f, h: e.target.value })} aria-label="Высота" /></Row>
        <Btn v="p" onClick={add}>Добавить</Btn></fieldset>
    </Window>
  );
}
export { Field, Measurement };
