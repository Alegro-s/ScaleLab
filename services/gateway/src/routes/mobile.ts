import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { core } from '../core.js';
import { HttpError, uuid } from '../util.js';

const SERVICE_EMAIL = 'mobile@masshtablab.local';
const AREA_KINDS = ['polygon', 'mask'];
const MIN_REGION_SHARE = 0.02;
const MIN_CONFIDENCE = 0.6;
const SIDE_MM = 10;
const MIME = new Set(['image/png', 'image/jpeg', 'image/tiff', 'image/webp']);
const BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp' };

function imageType(mime: string, filename: string) {
  if (MIME.has(mime)) return mime;
  return BY_EXT[(filename.split('.').pop() ?? '').toLowerCase()] ?? '';
}

type Check = { key: string; title: string; status: 'ok' | 'warn' | 'fail'; detail: string };

const fmt = (v: number, d = 1) => v.toFixed(d).replace('.', ',');

function multipart(fields: Record<string, string>, file: { name: string; type: string; data: Buffer }) {
  const boundary = `----sl${randomUUID().replace(/-/g, '')}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name.replace(/"/g, '')}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

export function buildChecks(payload: any, intact: boolean): Check[] {
  const out: Check[] = [];
  for (const s of payload.samples) {
    const conf = Number(s.confidence ?? 0);
    out.push({
      key: `cal-${s.slot}`, title: `Эталон: ${s.name}`,
      status: conf >= 0.75 ? 'ok' : conf >= MIN_CONFIDENCE ? 'warn' : 'fail',
      detail: `${fmt(s.px_per_mm)} px/мм, уверенность ${Math.round(conf * 100)} %`,
    });
    const area = s.measurements.find((m: any) => AREA_KINDS.includes(m.kind));
    out.push({
      key: `area-${s.slot}`, title: `Площадь: ${s.name}`, status: area ? 'ok' : 'fail',
      detail: area ? `${fmt(area.value, 2)} мм², погрешность ±${fmt(area.error, 2)} мм²` : 'объект на снимке не выделен',
    });
  }
  if (payload.compare) {
    out.push({
      key: 'scale', title: 'Единый масштаб', status: payload.compare.scales_match ? 'ok' : 'warn',
      detail: payload.compare.scales_match ? 'масштабы снимков совпадают' : 'масштабы различаются, сравнение пересчитано в мм',
    });
  }
  out.push({ key: 'hash', title: 'Целостность отчёта', status: intact ? 'ok' : 'fail', detail: intact ? 'контрольная сумма совпала' : 'контрольная сумма не совпала' });
  return out;
}

export function summarize(session: any, version: any, payload: any, intact: boolean) {
  const samples = payload.samples.map((s: any) => {
    const a = s.measurements.find((m: any) => AREA_KINDS.includes(m.kind));
    return {
      slot: s.slot, name: s.name, filename: s.filename, px_per_mm: s.px_per_mm, confidence: s.confidence, method: s.method,
      area_mm2: a?.value ?? null, perimeter_mm: a?.perimeter_mm ?? null, error_mm2: a?.error ?? null, regions: s.measurements.length,
    };
  });
  const cmp = payload.compare;
  return {
    id: session.id, number: session.number, title: session.title, created_at: version.created_at, version: version.number, sha256: version.sha256,
    samples,
    compare: cmp ? { verdict: cmp.verdict, scales_match: cmp.scales_match, area: cmp.area_mm2 ?? null, perimeter: cmp.perimeter_mm ?? null } : null,
    conclusions: payload.conclusions ?? [],
    checks: buildChecks(payload, intact),
  };
}

export async function mobileRoutes(app: FastifyInstance) {
  const { pool } = app.ctx;

  async function serviceUser() {
    const found = await pool.query('SELECT * FROM users WHERE email=$1', [SERVICE_EMAIL]);
    if (found.rows[0]) return found.rows[0];
    const row = (await pool.query(
      'INSERT INTO users(email,full_name,password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING *',
      [SERVICE_EMAIL, 'Мобильное приложение', randomUUID()])).rows[0];
    await pool.query('INSERT INTO user_prefs(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [row.id]);
    return row;
  }

  const gate = async (req: any, rep: any) => {
    if (config.mobileKey && (req.headers['x-api-key'] ?? (req.query as any)?.key) !== config.mobileKey) rep.code(401).send({ error: 'Неверный ключ приложения' });
  };
  const G = { preHandler: gate };

  async function inner(token: string, method: string, url: string, payload?: any, extra?: { body: Buffer; type: string }) {
    const res = await app.inject({
      method: method as any, url: `/api${url}`,
      headers: { authorization: `Bearer ${token}`, ...(extra ? { 'content-type': extra.type } : {}) },
      payload: extra ? extra.body : payload,
    });
    if (res.statusCode >= 400) {
      let msg = 'Ошибка обработки';
      try { msg = JSON.parse(res.body).error ?? msg; } catch { msg = res.body || msg; }
      throw new HttpError(res.statusCode === 401 ? 500 : res.statusCode, msg);
    }
    return res;
  }

  async function ownedSession(id: string, userId: string) {
    uuid.parse(id);
    const row = (await pool.query('SELECT * FROM sessions WHERE id=$1 AND owner_id=$2', [id, userId])).rows[0];
    if (!row) throw new HttpError(404, 'Отчёт не найден');
    return row;
  }

  async function latestVersion(sessionId: string) {
    return (await pool.query('SELECT * FROM report_versions WHERE session_id=$1 ORDER BY number DESC LIMIT 1', [sessionId])).rows[0];
  }

  async function describe(session: any) {
    const v = await latestVersion(session.id);
    if (!v?.payload) return null;
    const { sha256, ...rest } = v.payload;
    const intact = (await core.hash(rest)).sha256 === v.sha256;
    return { v, payload: v.payload, summary: summarize(session, v, v.payload, intact) };
  }

  app.get('/m/health', async () => ({ ok: true, core: await core.health() }));

  app.post('/m/reports', G, async (req, rep) => {
    const user = await serviceUser();
    const token = app.jwt.sign({ id: user.id, email: user.email });
    const files: { name: string; type: string; data: Buffer }[] = [];
    let title = '';
    for await (const part of req.parts({ limits: { files: 2, fileSize: config.maxUploadMb * 1024 * 1024 } })) {
      if (part.type === 'file') {
        const type = imageType(part.mimetype, part.filename ?? '');
        if (!type) throw new HttpError(415, 'Допустимы PNG, JPEG, TIFF, WebP');
        const data = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, `Файл больше ${config.maxUploadMb} МБ`);
        files.push({ name: part.filename || `photo${files.length + 1}.jpg`, type, data });
      } else if (part.fieldname === 'title') title = String(part.value).slice(0, 200);
    }
    if (!files.length) throw new HttpError(400, 'Нужна хотя бы одна фотография');

    const stamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
    const session = JSON.parse((await inner(token, 'POST', '/sessions', { title: title.trim() || `Фото-отчёт ${stamp}` })).body);
    const notes: string[] = [];
    try {
      const sampleIds: { id: string; name: string }[] = [];
      for (const [i, f] of files.entries()) {
        const name = `Фото ${i + 1}`;
        const mp = multipart({ slot: String(i + 1), name }, f);
        const sample = JSON.parse((await inner(token, 'POST', `/sessions/${session.id}/images`, undefined, mp)).body);
        const cal = JSON.parse((await inner(token, 'POST', `/samples/${sample.id}/calibrate`, { side_mm: SIDE_MM, save: true, min_confidence: MIN_CONFIDENCE })).body);
        const best = cal.found ? cal.candidates?.[0] : null;
        if (!best) {
          notes.push(`${name}: эталон на снимке не найден, снимок исключён.`);
          await inner(token, 'DELETE', `/samples/${sample.id}`);
          continue;
        }
        if (!cal.saved) {
          await inner(token, 'PUT', `/samples/${sample.id}/calibration`, { corners: best.corners, side_mm: best.side_mm ?? SIDE_MM, method: 'auto', kind: best.kind });
          notes.push(`${name}: эталон найден с низкой уверенностью (${Math.round((best.confidence ?? 0) * 100)} %), проверьте результат.`);
        }
        sampleIds.push({ id: sample.id, name });
      }
      if (!sampleIds.length) throw new HttpError(422, 'Эталон не найден ни на одном снимке. Положите рядом с образцом квадратный маркер или шахматку и снимите ещё раз.');

      for (const s of sampleIds) {
        const preview = JSON.parse((await inner(token, 'POST', `/samples/${s.id}/segment`, { channel: 'g', apply: false, min_area_mm2: 0.5 })).body);
        const regions: any[] = preview.regions ?? [];
        if (!regions.length) {
          notes.push(`${s.name}: объект на снимке не выделен.`);
          continue;
        }
        const largest = Math.max(...regions.map((r) => r.area_mm2));
        await inner(token, 'POST', `/samples/${s.id}/segment`, { channel: 'g', apply: true, min_area_mm2: Math.max(0.5, largest * MIN_REGION_SHARE) });
      }

      const report = JSON.parse((await inner(token, 'POST', `/sessions/${session.id}/report`, {
        title: session.title, operator: 'Мобильное приложение', notes: notes.length ? notes.join(' ') : undefined,
      })).body);
      const fresh = (await pool.query('SELECT * FROM sessions WHERE id=$1', [session.id])).rows[0];
      const d = await describe(fresh);
      return rep.code(201).send(d?.summary ?? { id: session.id, version: report.number });
    } catch (e) {
      await pool.query('DELETE FROM sessions WHERE id=$1', [session.id]);
      await app.ctx.nosql.deleteMany('events', { session_id: session.id });
      throw e;
    }
  });


  const ALLOW = /^(sessions|samples|measurements)(\/|$)/;

  app.route({
    method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/m/x/*',
    preHandler: gate,
    handler: async (req, rep) => {
      const rest = String((req.params as any)['*'] ?? '');
      if (!ALLOW.test(rest) || rest.includes('..') || /\/images\/?$/.test(rest)) throw new HttpError(404, 'Метод недоступен');
      const user = await serviceUser();
      const token = app.jwt.sign({ id: user.id, email: user.email });
      const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const hasBody = req.method !== 'GET' && req.method !== 'DELETE';
      const res = await inner(token, req.method, `/${rest}${query}`, hasBody ? (req.body ?? {}) : undefined);
      const disposition = res.headers['content-disposition'];
      if (disposition) rep.header('content-disposition', String(disposition));
      return rep.code(res.statusCode).type(String(res.headers['content-type'] ?? 'application/json')).send(res.rawPayload);
    },
  });

  app.post('/m/upload/:sid', G, async (req, rep) => {
    const user = await serviceUser();
    const sid = (req.params as any).sid;
    await ownedSession(sid, user.id);
    const token = app.jwt.sign({ id: user.id, email: user.email });
    const fields: Record<string, string> = {};
    let file: { name: string; type: string; data: Buffer } | null = null;
    for await (const part of req.parts({ limits: { files: 1, fileSize: config.maxUploadMb * 1024 * 1024 } })) {
      if (part.type === 'file') {
        const type = imageType(part.mimetype, part.filename ?? '');
        if (!type) throw new HttpError(415, 'Допустимы PNG, JPEG, TIFF, WebP');
        const data = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, `Файл больше ${config.maxUploadMb} МБ`);
        file = { name: part.filename || 'photo.jpg', type, data };
      } else fields[part.fieldname] = String(part.value).slice(0, 200);
    }
    if (!file) throw new HttpError(400, 'Нужна фотография');
    const res = await inner(token, 'POST', `/sessions/${sid}/images`, undefined, multipart(fields, file));
    return rep.code(201).type('application/json').send(res.rawPayload);
  });

  app.get('/m/reports', G, async () => {
    const user = await serviceUser();
    const sessions = (await pool.query(
      `SELECT s.* FROM sessions s WHERE s.owner_id=$1 AND EXISTS (SELECT 1 FROM report_versions v WHERE v.session_id=s.id) ORDER BY s.created_at DESC LIMIT 200`, [user.id])).rows;
    const out = [];
    for (const s of sessions) {
      const d = await describe(s);
      if (!d) continue;
      const { id, number, title, created_at, samples, compare, checks } = d.summary;
      out.push({ id, number, title, created_at, samples: samples.map((x: any) => ({ slot: x.slot, name: x.name, area_mm2: x.area_mm2 })), verdict: compare?.verdict ?? null,
        problems: checks.filter((c: Check) => c.status !== 'ok').length });
    }
    return out;
  });

  app.get('/m/reports/:id', G, async (req) => {
    const user = await serviceUser();
    const s = await ownedSession((req.params as any).id, user.id);
    const d = await describe(s);
    if (!d) throw new HttpError(404, 'Отчёт не найден');
    return d.summary;
  });

  app.get('/m/reports/:id/file', G, async (req, rep) => {
    const user = await serviceUser();
    const s = await ownedSession((req.params as any).id, user.id);
    const q = z.object({ format: z.enum(['pdf', 'csv', 'json', 'zip']).default('pdf') }).parse(req.query);
    const token = app.jwt.sign({ id: user.id, email: user.email });
    const formats = q.format === 'zip' ? 'pdf,csv,json,png' : q.format;
    const res = await inner(token, 'GET', `/sessions/${s.id}/export?formats=${formats}&filename=report_${String(s.number).padStart(3, '0')}`);
    rep.header('content-disposition', String(res.headers['content-disposition'] ?? ''));
    return rep.type(String(res.headers['content-type'] ?? 'application/octet-stream')).send(res.rawPayload);
  });

  app.get('/m/reports/:id/preview/:slot', G, async (req, rep) => {
    const user = await serviceUser();
    const p = req.params as any;
    const s = await ownedSession(p.id, user.id);
    const slot = z.coerce.number().int().min(1).max(2).parse(p.slot);
    const token = app.jwt.sign({ id: user.id, email: user.email });
    const res = await inner(token, 'GET', `/sessions/${s.id}/export?formats=png&slot=${slot}`);
    rep.header('cache-control', 'private, max-age=86400');
    return rep.type('image/png').send(res.rawPayload);
  });

  app.delete('/m/reports/:id', G, async (req) => {
    const user = await serviceUser();
    const s = await ownedSession((req.params as any).id, user.id);
    await pool.query('DELETE FROM sessions WHERE id=$1', [s.id]);
    await app.ctx.nosql.deleteMany('events', { session_id: s.id });
    await app.ctx.nosql.deleteMany('report_payloads', { session_id: s.id });
    return { ok: true };
  });
}
