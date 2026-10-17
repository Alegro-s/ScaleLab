import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { core } from '../core.js';
import { HttpError, ownSession, uuid } from '../util.js';

export async function miscRoutes(app: FastifyInstance) {
  const { pool, nosql } = app.ctx;
  const A = { preHandler: app.auth };

  app.get('/health', async (_req, rep) => {
    const pg = await pool.query('SELECT 1').then(() => true, () => false);
    const no = await nosql.ping();
    const c = await core.health();
    return rep.code(pg && no && c ? 200 : 503).send({ ok: pg && no && c, postgres: pg, nosql: no, nosql_kind: nosql.kind, core: c });
  });

  const prefsSchema = z.object({
    ui_mode: z.enum(['glass', 'classic']), theme: z.enum(['dark', 'light']), language: z.string().max(10), units: z.enum(['mm', 'um', 'cm']),
    decimals: z.number().int().min(0).max(4), autosave: z.boolean(), hints: z.boolean(), sounds: z.boolean(), extra: z.record(z.any()),
  }).partial();
  app.get('/prefs', A, async (req) => {
    await pool.query('INSERT INTO user_prefs(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
    const { user_id, ...rest } = (await pool.query('SELECT * FROM user_prefs WHERE user_id=$1', [req.user.id])).rows[0];
    return rest;
  });
  app.put('/prefs', A, async (req) => {
    const b = prefsSchema.parse(req.body);
    await pool.query('INSERT INTO user_prefs(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.user.id]);
    const cols = Object.keys(b);
    if (cols.length) {
      const set = cols.map((c, i) => `${c}=$${i + 2}`).join(',');
      await pool.query(`UPDATE user_prefs SET ${set} WHERE user_id=$1`, [req.user.id, ...cols.map((c) => (c === 'extra' ? JSON.stringify((b as any)[c]) : (b as any)[c]))]);
    }
    const { user_id, ...rest } = (await pool.query('SELECT * FROM user_prefs WHERE user_id=$1', [req.user.id])).rows[0];
    return rest;
  });

  app.get('/ui-state', A, async (req) => (await nosql.findOne('ui_state', { user_id: req.user.id }))?.state ?? {});
  app.put('/ui-state', A, async (req) => {
    const state = z.record(z.any()).parse(req.body);
    if (JSON.stringify(state).length > 64_000) throw new HttpError(413, 'Слишком большое состояние');
    await nosql.upsert('ui_state', { user_id: req.user.id }, { state, ts: new Date().toISOString() });
    return state;
  });

  app.get('/sessions/:id/events', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    return nosql.find('events', { session_id: s.id }, { sort: { ts: -1 }, limit: 200 });
  });

  const stdIn = z.object({ name: z.string().trim().min(1).max(120), kind: z.enum(['checker', 'ruler', 'coin', 'custom']), width_mm: z.number().positive().max(1000),
    height_mm: z.number().positive().max(1000), tolerance_mm: z.number().min(0).max(10).default(0.05), note: z.string().max(300).default('') });
  const mapStd = (r: any) => ({ ...r, width_mm: Number(r.width_mm), height_mm: Number(r.height_mm), tolerance_mm: Number(r.tolerance_mm) });
  app.get('/standards', A, async (req) =>
    (await pool.query('SELECT * FROM reference_standards WHERE owner_id IS NULL OR owner_id=$1 ORDER BY owner_id NULLS FIRST, created_at', [req.user.id])).rows.map(mapStd));
  app.post('/standards', A, async (req, rep) => {
    const b = stdIn.parse(req.body);
    const { rows } = await pool.query('INSERT INTO reference_standards(owner_id,name,kind,width_mm,height_mm,tolerance_mm,note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.user.id, b.name, b.kind, b.width_mm, b.height_mm, b.tolerance_mm, b.note]);
    return rep.code(201).send(mapStd(rows[0]));
  });
  app.put('/standards/:id', A, async (req) => {
    const b = stdIn.parse(req.body);
    const { rows } = await pool.query('UPDATE reference_standards SET name=$3,kind=$4,width_mm=$5,height_mm=$6,tolerance_mm=$7,note=$8 WHERE id=$1 AND owner_id=$2 RETURNING *',
      [uuid.parse((req.params as any).id), req.user.id, b.name, b.kind, b.width_mm, b.height_mm, b.tolerance_mm, b.note]);
    if (!rows[0]) throw new HttpError(404, 'Эталон не найден или встроенный (не редактируется)');
    return mapStd(rows[0]);
  });
  app.delete('/standards/:id', A, async (req) => {
    const { rowCount } = await pool.query('DELETE FROM reference_standards WHERE id=$1 AND owner_id=$2', [uuid.parse((req.params as any).id), req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Эталон не найден или встроенный');
    return { ok: true };
  });

  app.get('/stats', A, async (req) => {
    const r = (await pool.query(
      `SELECT (SELECT count(*) FROM sessions WHERE owner_id=$1 AND updated_at > now() - interval '7 days')::int AS sessions_week,
              (SELECT count(*) FROM samples sa JOIN sessions s ON s.id=sa.session_id WHERE s.owner_id=$1)::int AS samples_total,
              (SELECT avg(m.error) FROM measurements m JOIN samples sa ON sa.id=m.sample_id JOIN sessions s ON s.id=sa.session_id WHERE s.owner_id=$1 AND m.kind IN ('polygon','mask')) AS avg_error_mm2,
              (SELECT count(*) FROM report_versions v JOIN sessions s ON s.id=v.session_id WHERE s.owner_id=$1)::int AS versions_total`, [req.user.id])).rows[0];
    return { ...r, avg_error_mm2: r.avg_error_mm2 === null ? null : Number(r.avg_error_mm2) };
  });
}
