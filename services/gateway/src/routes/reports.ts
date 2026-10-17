import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { z } from 'zod';
import { config } from '../config.js';
import { buildCompare } from '../compare.js';
import { core } from '../core.js';
import { event, HttpError, mapCal, mapMeas, ownSession, touch } from '../util.js';
import { DEFAULT_SECTIONS } from '@masshtablab/shared';

const fmt = (v: number, d = 2) => v.toFixed(d).replace('.', ',');
const opts = z.object({
  title: z.string().max(200).optional(), template: z.string().max(80).default('Научный протокол (А4)'), language: z.string().max(10).default('ru'),
  format: z.string().max(40).default('А4, книжная'), operator: z.string().max(120).optional(), summary: z.string().max(300).optional(), notes: z.string().max(2000).optional(),
  sections: z.record(z.boolean()).optional(),
});

export async function reportRoutes(app: FastifyInstance) {
  const { pool, nosql } = app.ctx;
  const A = { preHandler: app.auth };

  async function buildPayload(sess: any, userName: string, o: z.infer<typeof opts>, version: number) {
    const sm = (await pool.query('SELECT sa.*, im.path, im.filename FROM samples sa JOIN images im ON im.id=sa.image_id WHERE sa.session_id=$1 ORDER BY sa.slot', [sess.id])).rows;
    if (!sm.length) throw new HttpError(409, 'В сессии нет образцов');
    const samples: any[] = [];
    for (const s of sm) {
      const c = mapCal((await pool.query('SELECT * FROM calibrations WHERE sample_id=$1', [s.id])).rows[0]);
      if (!c) throw new HttpError(409, `Образец «${s.name}» не откалиброван`);
      const ms = (await pool.query('SELECT * FROM measurements WHERE sample_id=$1 AND in_table ORDER BY created_at', [s.id])).rows.map(mapMeas);
      samples.push({ slot: s.slot, name: s.name, species: s.species, filename: s.filename, image: s.path, px_per_mm: c.px_per_mm, side_mm: c.side_mm,
        confidence: c.confidence, method: c.method, corners: c.corners,
        measurements: ms.map((m) => ({ label: m.label, kind: m.kind, value: m.value, unit: m.unit, perimeter_mm: m.perimeter_mm, error: m.error, vertices: m.vertices })) });
    }
    const compare = samples.length === 2 ? await buildCompare(app, sess.id).catch(() => null) : null;
    const conclusions: string[] = [];
    for (const s of samples) {
      const a = s.measurements.find((m: any) => m.kind === 'polygon' || m.kind === 'mask');
      if (a) conclusions.push(`${s.name}: площадь ${fmt(a.value)} мм² при масштабе ${fmt(s.px_per_mm, 1)} px/мм (±${fmt(a.error)} мм²).`);
    }
    if (compare) conclusions.push(compare.verdict + (compare.scales_match ? '; снимки приведены к одной шкале.' : '; масштабы снимков различаются — сравнение приведено к мм.'));
    if (o.notes) conclusions.push(o.notes);
    const payload: any = {
      title: o.title || 'Измерение площади в едином масштабе', template: o.template, language: o.language, format: o.format,
      operator: o.operator || userName, generated_at: new Date().toLocaleDateString('ru-RU'), version,
      session: { id: sess.id, number: sess.number, title: sess.title }, sections: { ...DEFAULT_SECTIONS, ...(o.sections ?? {}) },
      samples, compare, conclusions,
    };
    payload.sha256 = (await core.hash(payload)).sha256;
    return payload;
  }

  app.post('/sessions/:id/report', A, async (req, rep) => {
    const sess = await ownSession(app, req, (req.params as any).id);
    const o = opts.parse(req.body ?? {});
    const u = (await pool.query('SELECT full_name,email FROM users WHERE id=$1', [req.user.id])).rows[0];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM sessions WHERE id=$1 FOR UPDATE', [sess.id]);
      const next = Number((await client.query('SELECT COALESCE(max(number),0)+1 AS n FROM report_versions WHERE session_id=$1', [sess.id])).rows[0].n);
      const payload = await buildPayload(sess, u.full_name || u.email, o, next);
      const ref = await nosql.insert('report_payloads', { session_id: sess.id, number: next, payload, ts: new Date().toISOString() });
      const row = (await client.query(
        'INSERT INTO report_versions(session_id,number,payload_ref,sha256,summary,author_id,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,session_id,number,sha256,summary,created_at',
        [sess.id, next, ref, payload.sha256, o.summary ?? (next === 1 ? 'Первая версия' : 'Сохранена версия отчёта'), req.user.id, JSON.stringify(payload)])).rows[0];
      await client.query('COMMIT');
      await touch(app, sess.id, 'report', 'ready');
      await event(app, sess.id, 'version', `Сохранена версия отчёта v${next}`, u.email, { number: next });
      return rep.code(201).send({ ...row, payload });
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  });

  app.get('/sessions/:id/versions', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    return (await pool.query(
      `SELECT v.id,v.session_id,v.number,v.sha256,v.summary,v.created_at, COALESCE(u.full_name,u.email) AS author FROM report_versions v LEFT JOIN users u ON u.id=v.author_id
        WHERE v.session_id=$1 ORDER BY v.number DESC`, [s.id])).rows;
  });

  async function loadPayload(sessionId: string, number: number) {
    const v = (await pool.query('SELECT * FROM report_versions WHERE session_id=$1 AND number=$2', [sessionId, number])).rows[0];
    if (!v) throw new HttpError(404, 'Версия не найдена');
    let payload = (await nosql.findOne('report_payloads', { session_id: sessionId, number }))?.payload ?? v.payload;
    if (payload) return { v, payload, intact: (await core.hash(stripHash(payload))).sha256 === v.sha256 };
    const sess = (await pool.query('SELECT * FROM sessions WHERE id=$1', [sessionId])).rows[0];
    const author = (await pool.query('SELECT full_name,email FROM users WHERE id=$1', [v.author_id])).rows[0];
    payload = await buildPayload(sess, author?.full_name || author?.email || '', opts.parse({}), number);
    return { v, payload, intact: false };
  }
  const stripHash = (p: any) => { const { sha256, ...rest } = p; return rest; };

  app.get('/sessions/:id/versions/:n', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const { v, payload, intact } = await loadPayload(s.id, Number((req.params as any).n));
    return { ...v, payload, intact };
  });

  app.get('/sessions/:id/versions-diff', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const q = z.object({ a: z.coerce.number().int(), b: z.coerce.number().int() }).parse(req.query);
    const [A_, B_] = [await loadPayload(s.id, q.a), await loadPayload(s.id, q.b)];
    const flat = (p: any) => new Map<string, any>(p.samples.flatMap((sm: any) => sm.measurements.map((m: any) => [`${sm.name}, ${m.label}`, m])));
    const fa = flat(A_.payload), fb = flat(B_.payload);
    const rows: any[] = [];
    for (const [k, m] of fb) {
      if (!fa.has(k)) rows.push({ key: k, change: 'added', after: m.value, unit: m.unit });
      else if (Math.abs(fa.get(k).value - m.value) > 1e-9) rows.push({ key: k, change: 'changed', before: fa.get(k).value, after: m.value, unit: m.unit });
    }
    for (const [k, m] of fa) if (!fb.has(k)) rows.push({ key: k, change: 'removed', before: m.value, unit: m.unit });
    return { a: q.a, b: q.b, changed: rows.filter((r) => r.change === 'changed').length, added: rows.filter((r) => r.change === 'added').length,
      removed: rows.filter((r) => r.change === 'removed').length, rows };
  });

  app.post('/sessions/:id/versions/:n/restore', A, async (req, rep) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const n = Number((req.params as any).n);
    const { payload } = await loadPayload(s.id, n);
    const next = Number((await pool.query('SELECT max(number)+1 AS n FROM report_versions WHERE session_id=$1', [s.id])).rows[0].n);
    const np = { ...stripHash(payload), version: next };
    np.sha256 = (await core.hash(np)).sha256;
    const ref = await nosql.insert('report_payloads', { session_id: s.id, number: next, payload: np, ts: new Date().toISOString() });
    const row = (await pool.query('INSERT INTO report_versions(session_id,number,payload_ref,sha256,summary,author_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,session_id,number,sha256,summary,created_at',
      [s.id, next, ref, np.sha256, `Откат к v${n}`, req.user.id])).rows[0];
    await event(app, s.id, 'version', `Откат к v${n} → v${next}`, req.user.email, { from: n, to: next });
    return rep.code(201).send(row);
  });

  app.get('/sessions/:id/export', A, async (req, rep) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const q = z.object({ formats: z.string().default('pdf'), version: z.coerce.number().int().optional(), filename: z.string().max(100).optional(), slot: z.coerce.number().int().min(1).max(2).default(1) }).parse(req.query);
    const fm = q.formats.split(',').map((x) => x.trim()).filter(Boolean);
    if (!fm.every((f) => ['pdf', 'csv', 'png', 'json'].includes(f))) throw new HttpError(400, 'Форматы: pdf, csv, png, json');
    const last = Number((await pool.query('SELECT max(number) AS n FROM report_versions WHERE session_id=$1', [s.id])).rows[0].n || 0);
    if (!last) throw new HttpError(409, 'Сначала сохраните версию отчёта');
    const { payload } = await loadPayload(s.id, q.version ?? last);
    const withPaths = { ...payload, samples: payload.samples.map((x: any) => ({ ...x, image_path: path.join(config.dataDir, x.image) })) };
    const base = (q.filename || `protokol_${String(s.number).padStart(3, '0')}`).replace(/[^\w.\-а-яА-ЯёЁ]/g, '_').replace(/\.(pdf|csv|png|json|zip)$/i, '');
    const mk = async (f: string): Promise<{ name: string; type: string; data: Buffer }> => {
      if (f === 'pdf') return { name: `${base}.pdf`, type: 'application/pdf', data: await core.pdf(withPaths) };
      if (f === 'csv') return { name: `${base}.csv`, type: 'text/csv; charset=utf-8', data: await core.csv(payload) };
      if (f === 'json') return { name: `${base}.json`, type: 'application/json', data: Buffer.from(JSON.stringify(payload, null, 2)) };
      const smp = payload.samples.find((x: any) => x.slot === q.slot) ?? payload.samples[0];
      return { name: `${base}_obrazec${smp.slot}.png`, type: 'image/png', data: await core.overlay(smp.image, smp.measurements) };
    };
    await event(app, s.id, 'export', `Экспорт: ${fm.join(', ').toUpperCase()}`, req.user.email);
    if (fm.length === 1) {
      const f = await mk(fm[0]);
      rep.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
      return rep.type(f.type).send(f.data);
    }
    const files: Record<string, Uint8Array> = {};
    for (const f of fm) { const r = await mk(f); files[r.name] = new Uint8Array(r.data); }
    files['README.txt'] = strToU8(`МасштабЛаб, сессия №${s.number}, контрольная сумма версии: ${payload.sha256}\n`);
    rep.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base + '.zip')}`);
    return rep.type('application/zip').send(Buffer.from(zipSync(files)));
  });
}
