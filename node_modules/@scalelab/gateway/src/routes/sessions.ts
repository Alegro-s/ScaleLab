import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { imageSize } from 'image-size';
import { z } from 'zod';
import { config } from '../config.js';
import { core } from '../core.js';
import { event, HttpError, mapCal, mapMeas, ownSample, ownSession, touch } from '../util.js';

const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/tiff': 'tif', 'image/webp': 'webp' };

export async function sessionRoutes(app: FastifyInstance) {
  const { pool } = app.ctx;
  const A = { preHandler: app.auth };

  app.get('/sessions', A, async (req) => {
    const q = z.object({ status: z.string().optional(), q: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT s.*, (SELECT count(*) FROM samples WHERE session_id=s.id)::int AS sample_count,
              (SELECT count(*) FROM report_versions WHERE session_id=s.id)::int AS version_count
         FROM sessions s WHERE s.owner_id=$1 AND ($2::text IS NULL OR s.status=$2) AND ($3::text IS NULL OR s.title ILIKE '%'||$3||'%')
        ORDER BY s.updated_at DESC`, [req.user.id, q.status ?? null, q.q ?? null]);
    return rows;
  });

  app.post('/sessions', A, async (req, rep) => {
    const b = z.object({ title: z.string().trim().min(1).max(200) }).parse(req.body);
    const { rows } = await pool.query('INSERT INTO sessions(owner_id,title) VALUES ($1,$2) RETURNING *', [req.user.id, b.title]);
    await event(app, rows[0].id, 'session', 'Создана сессия', req.user.email);
    return rep.code(201).send(rows[0]);
  });

  app.get('/sessions/:id', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const sm = await pool.query(
      `SELECT sa.*, im.width, im.height, im.filename FROM samples sa JOIN images im ON im.id=sa.image_id WHERE sa.session_id=$1 ORDER BY sa.slot`, [s.id]);
    const ids = sm.rows.map((r) => r.id);
    const cal = ids.length ? (await pool.query('SELECT * FROM calibrations WHERE sample_id = ANY($1)', [ids])).rows : [];
    const ms = ids.length ? (await pool.query('SELECT * FROM measurements WHERE sample_id = ANY($1) ORDER BY created_at', [ids])).rows : [];
    s.samples = sm.rows.map((r) => ({ ...r, calibration: mapCal(cal.find((c) => c.sample_id === r.id)), measurements: ms.filter((m) => m.sample_id === r.id).map(mapMeas) }));
    return s;
  });

  app.patch('/sessions/:id', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const b = z.object({ title: z.string().trim().min(1).max(200).optional(), status: z.enum(['draft', 'in_progress', 'review', 'ready']).optional(),
      step: z.enum(['upload', 'calibration', 'measurement', 'comparison', 'report']).optional() }).parse(req.body);
    const { rows } = await pool.query('UPDATE sessions SET title=COALESCE($2,title), status=COALESCE($3,status), step=COALESCE($4,step), updated_at=now() WHERE id=$1 RETURNING *',
      [s.id, b.title ?? null, b.status ?? null, b.step ?? null]);
    return rows[0];
  });

  app.delete('/sessions/:id', A, async (req) => {
    const s = await ownSession(app, req, (req.params as any).id);
    await pool.query('DELETE FROM sessions WHERE id=$1', [s.id]);
    await app.ctx.nosql.deleteMany('events', { session_id: s.id });
    await app.ctx.nosql.deleteMany('report_payloads', { session_id: s.id });
    return { ok: true };
  });

  app.post('/sessions/:id/images', A, async (req, rep) => {
    const s = await ownSession(app, req, (req.params as any).id);
    const part = await req.file();
    if (!part) throw new HttpError(400, 'Файл не передан');
    const ext = ALLOWED[part.mimetype];
    if (!ext) throw new HttpError(415, 'Допустимы PNG, JPEG, TIFF, WebP');
    const buf = await part.toBuffer();
    if (part.file.truncated) throw new HttpError(413, `Файл больше ${config.maxUploadMb} МБ`);
    let dims;
    try { dims = imageSize(buf); } catch { throw new HttpError(422, 'Файл не похож на изображение'); }
    if (!dims.width || !dims.height) throw new HttpError(422, 'Не удалось определить размеры изображения');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const rel = path.posix.join('images', sha.slice(0, 2), `${sha}.${ext}`);
    const full = path.join(config.dataDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
    const f = (k: string) => (part.fields[k] as any)?.value as string | undefined;
    const slot = Math.min(2, Math.max(1, Number(f('slot') ?? 0) || 0));
    let useSlot = slot;
    if (!f('slot')) {
      const used = (await pool.query('SELECT slot FROM samples WHERE session_id=$1', [s.id])).rows.map((r) => r.slot);
      useSlot = [1, 2].find((x) => !used.includes(x)) ?? 0;
      if (!useSlot) throw new HttpError(409, 'В сессии уже два образца');
    }
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const im = (await c.query(
        `INSERT INTO images(path,filename,mime,size_bytes,width,height,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (sha256) DO UPDATE SET filename=images.filename RETURNING *`, [rel, part.filename, part.mimetype, buf.length, dims.width, dims.height, sha])).rows[0];
      await c.query('DELETE FROM samples WHERE session_id=$1 AND slot=$2', [s.id, useSlot]);
      const name = f('name') || `Образец ${String(useSlot).padStart(2, '0')}`;
      const sm = (await c.query('INSERT INTO samples(session_id,image_id,slot,name,species) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [s.id, im.id, useSlot, name, f('species') ?? ''])).rows[0];
      await c.query('COMMIT');
      await touch(app, s.id, 'upload', 'in_progress');
      await event(app, s.id, 'upload', `Загружен снимок ${part.filename}`, req.user.email);
      return rep.code(201).send({ ...sm, width: im.width, height: im.height, filename: part.filename, calibration: null, measurements: [] });
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  });

  app.get('/samples/:id/image', A, async (req, rep) => {
    const sm = await ownSample(app, req, (req.params as any).id);
    const full = path.join(config.dataDir, sm.image_path);
    if (!fs.existsSync(full)) throw new HttpError(404, 'Файл снимка не найден на диске');
    rep.header('cache-control', 'private, max-age=86400');
    return rep.type(path.extname(full) === '.png' ? 'image/png' : path.extname(full) === '.webp' ? 'image/webp' : path.extname(full) === '.jpg' ? 'image/jpeg' : 'image/tiff').send(fs.createReadStream(full));
  });

  app.post('/demo/seed', A, async (req, rep) => {
    const files = ['sample_01.png', 'sample_02.png'];
    if (!files.every((f) => fs.existsSync(path.join(config.demoDir, f)))) throw new HttpError(404, 'Демо-снимки не найдены');
    const { rows } = await pool.query('INSERT INTO sessions(owner_id,title,status) VALUES ($1,$2,$3) RETURNING *', [req.user.id, 'Демо, синтетические срезы', 'in_progress']);
    const sess = rows[0];
    for (const [i, f] of files.entries()) {
      const buf = fs.readFileSync(path.join(config.demoDir, f));
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      const rel = path.posix.join('images', sha.slice(0, 2), `${sha}.png`);
      const full = path.join(config.dataDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
      const d = imageSize(buf);
      const im = (await pool.query(`INSERT INTO images(path,filename,mime,size_bytes,width,height,sha256) VALUES ($1,$2,'image/png',$3,$4,$5,$6)
        ON CONFLICT (sha256) DO UPDATE SET filename=images.filename RETURNING *`, [rel, f, buf.length, d.width, d.height, sha])).rows[0];
      const sm = (await pool.query('INSERT INTO samples(session_id,image_id,slot,name,species,tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [sess.id, im.id, i + 1, `Образец 0${i + 1}`, 'Демо', ['синтетика']])).rows[0];
      const r = await core.calibrate(rel, 10);
      if (r.found) {
        const best = r.candidates[0];
        await pool.query(`INSERT INTO calibrations(sample_id,reference_type,side_mm,corners,px_per_mm,confidence,method) VALUES ($1,'checker',10,$2,$3,$4,'auto')`,
          [sm.id, JSON.stringify(best.corners), best.px_per_mm, best.confidence]);
      }
    }
    await touch(app, sess.id, 'calibration');
    await event(app, sess.id, 'session', 'Создана демо-сессия (синтетические данные)', req.user.email);
    return rep.code(201).send(sess);
  });
}
