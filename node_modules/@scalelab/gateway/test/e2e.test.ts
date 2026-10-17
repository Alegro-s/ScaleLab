import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.NOSQL = 'memory';
process.env.DATA_DIR ??= path.join(os.tmpdir(), 'sl_shared');
process.env.DEMO_DIR = path.resolve(__dirname, '../../../data/demo');
process.env.MIGRATIONS_DIR = path.resolve(__dirname, '../../../db/postgres');
process.env.DATABASE_URL ??= 'postgres://masshtablab:masshtablab@localhost:5433/masshtablab';
process.env.CORE_URL ??= 'http://127.0.0.1:8000';

let app: FastifyInstance; let cookie = ''; let pool: any;
const j = (r: any) => JSON.parse(r.body);
const req = (method: string, url: string, payload?: any) => app.inject({ method: method as any, url: '/api' + url, payload, headers: { cookie } });

beforeAll(async () => {
  const { makePool, migrate } = await import('../src/db.js');
  const { memoryNoSql } = await import('../src/nosql.js');
  const { buildApp } = await import('../src/app.js');
  pool = makePool();
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  await migrate(pool);
  app = await buildApp({ pool, nosql: memoryNoSql() });
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('МасштабЛаб · сквозной сценарий', () => {
  it('требует вход', async () => { expect((await req('GET', '/sessions')).statusCode).toBe(401); });

  it('регистрация, вход, неверный пароль', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'Op@Lab.ru', password: 'secret1', full_name: 'Оператор' } });
    expect(r.statusCode).toBe(200);
    cookie = (r.headers['set-cookie'] as string).split(';')[0];
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'op@lab.ru', password: 'bad-pass' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'op@lab.ru', password: 'secret1' } })).statusCode).toBe(409);
  });

  let sid = ''; let samples: any[] = [];
  it('демо-сессия: два снимка и авто-калибровка 12 и 15 px/мм', async () => {
    const r = await req('POST', '/demo/seed');
    expect(r.statusCode).toBe(201); sid = j(r).id;
    const s = j(await req('GET', `/sessions/${sid}`));
    samples = s.samples;
    expect(samples).toHaveLength(2);
    expect(samples[0].calibration.px_per_mm).toBeCloseTo(12, 0);
    expect(samples[1].calibration.px_per_mm).toBeCloseTo(15, 0);
  });

  it('замер полигона: площадь = шнуровка / K²', async () => {
    const k = samples[0].calibration.px_per_mm;
    const v = [[300, 100], [700, 100], [700, 500], [300, 500]];
    const r = await req('POST', `/samples/${samples[0].id}/measurements`, { kind: 'polygon', vertices: v });
    expect(r.statusCode).toBe(201);
    const m = j(r);
    expect(m.value).toBeCloseTo(160000 / (k * k), 3);
    expect(m.perimeter_mm).toBeCloseTo(1600 / k, 3);
    expect(m.label).toBe('К1');
    const m2 = j(await req('POST', `/samples/${samples[1].id}/measurements`, { kind: 'polygon', vertices: [[300, 100], [900, 100], [900, 500], [300, 500]] }));
    expect(m2.value).toBeGreaterThan(0);
    const ang = j(await req('POST', `/samples/${samples[0].id}/measurements`, { kind: 'angle', vertices: [[0, 0], [10, 0], [10, 10]] }));
    expect(ang.value).toBeCloseTo(90);
    expect((await req('POST', `/samples/${samples[0].id}/measurements`, { kind: 'angle', vertices: [[0, 0], [1, 1]] })).statusCode).toBe(422);
  });

  it('сегментация сохраняет области как замеры', async () => {
    const r = j(await req('POST', `/samples/${samples[0].id}/segment`, { channel: 'g', apply: true, min_area_mm2: 20 }));
    expect(r.histogram.length).toBe(64);
    expect(Array.isArray(r.applied)).toBe(true);
  });

  it('волшебная стёрка: стёртая область не попадает в замеры', async () => {
    const { pointInPolygon } = await import('../src/routes/samples.js');
    const body = { channel: 'g', min_area_mm2: 20 };
    const preview = j(await req('POST', `/samples/${samples[0].id}/segment`, body));
    expect(preview.regions.length).toBeGreaterThan(0);
    const probe = preview.regions.map((r: any) => r.vertices.find((p: number[]) => pointInPolygon(p, r.vertices)) ?? null);
    const reg = preview.regions[0];
    const c = reg.vertices.reduce((a: number[], p: number[]) => [a[0] + p[0] / reg.vertices.length, a[1] + p[1] / reg.vertices.length], [0, 0]);
    const inside = reg.vertices.map((p: number[]) => [(p[0] + c[0] * 3) / 4, (p[1] + c[1] * 3) / 4]).find((p: number[]) => pointInPolygon(p, reg.vertices));
    expect(probe.length).toBe(preview.regions.length);
    expect(inside).toBeTruthy();
    const all = j(await req('POST', `/samples/${samples[0].id}/segment`, { ...body, apply: true }));
    const kept = j(await req('POST', `/samples/${samples[0].id}/segment`, { ...body, apply: true, drop: [inside] }));
    expect(kept.applied.length).toBeLessThan(all.applied.length);
    const brushed = j(await req('POST', `/samples/${samples[0].id}/segment`, { ...body, erase: [[...(inside as number[]), 30]] }));
    expect(brushed.total_area_mm2).toBeLessThan(preview.total_area_mm2);
    for (const m of [...all.applied, ...kept.applied]) await req('DELETE', `/measurements/${m.id}`);
  });

  it('мобильный API: пошаговый сценарий как на сайте', async () => {
    const m = async (method: string, url: string, body?: unknown) => app.inject({ method: method as any, url: `/api/m/x${url}`, payload: body === undefined ? undefined : (body as any) });
    const s = j(await m('POST', '/sessions', { title: 'Мобильный пошаговый' }));
    const ids: string[] = [];
    for (const [i, f] of ['sample_01.png', 'sample_02.png'].entries()) {
      const b = 'xBx';
      const payload = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="slot"\r\n\r\n${i + 1}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="${f}"\r\nContent-Type: image/png\r\n\r\n`),
        fs.readFileSync(path.join(process.env.DEMO_DIR!, f)), Buffer.from(`\r\n--${b}--\r\n`)]);
      const up = await app.inject({ method: 'POST', url: `/api/m/upload/${s.id}`, payload, headers: { 'content-type': `multipart/form-data; boundary=${b}` } });
      expect(up.statusCode).toBe(201);
      const sample = j(up);
      ids.push(sample.id);
      const cal = j(await m('POST', `/samples/${sample.id}/calibrate`, { side_mm: 10, save: false }));
      expect(cal.candidates[0].corners).toHaveLength(4);
      const put = await m('PUT', `/samples/${sample.id}/calibration`, { corners: cal.candidates[0].corners, side_mm: 10, method: 'manual' });
      expect(put.statusCode).toBe(200);
      expect(j(put).px_per_mm).toBeGreaterThan(1);
      const png = await m('GET', `/samples/${sample.id}/standardized.png?ppm=20`);
      expect(png.headers['content-type']).toBe('image/png');
      const seg = j(await m('POST', `/samples/${sample.id}/segment`, { channel: 'g', apply: false, min_area_mm2: 0.5 }));
      const poly = await m('POST', `/samples/${sample.id}/measurements`, { kind: 'polygon', vertices: seg.regions[0].vertices });
      expect(poly.statusCode).toBe(201);
      expect(j(poly).value).toBeGreaterThan(0);
    }
    expect(j(await m('GET', `/sessions/${s.id}/compare`)).verdict).toBeTruthy();
    expect((await m('POST', `/sessions/${s.id}/report`, { operator: 'Мобильное приложение' })).statusCode).toBe(201);
    const detail = j(await app.inject({ method: 'GET', url: `/api/m/reports/${s.id}` }));
    expect(detail.samples).toHaveLength(2);
    expect((await m('GET', '/auth/me')).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/m/reports/${s.id}` })).statusCode).toBe(200);
  });

  it('мобильный API: фото → отчёт без входа, история, файлы', async () => {
    const mp = (files: string[]) => {
      const b = 'xBOUNDARYx';
      const parts: Buffer[] = [Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="title"\r\n\r\nМобильный тест\r\n`)];
      for (const f of files) {
        parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="photos"; filename="${f}"\r\nContent-Type: image/png\r\n\r\n`), fs.readFileSync(path.join(process.env.DEMO_DIR!, f)), Buffer.from('\r\n'));
      }
      parts.push(Buffer.from(`--${b}--\r\n`));
      return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
    };
    const r = await app.inject({ method: 'POST', url: '/api/m/reports', ...mp(['sample_01.png', 'sample_02.png']) });
    expect(r.statusCode).toBe(201);
    const rep = j(r);
    expect(rep.samples).toHaveLength(2);
    expect(rep.samples[0].area_mm2).toBeGreaterThan(0);
    expect(rep.compare.verdict).toMatch(/больше|равны/);
    expect(rep.checks.find((c: any) => c.key === 'hash').status).toBe('ok');
    const list = j(await app.inject({ method: 'GET', url: '/api/m/reports' }));
    expect(list.some((x: any) => x.id === rep.id)).toBe(true);
    const detail = j(await app.inject({ method: 'GET', url: `/api/m/reports/${rep.id}` }));
    expect(detail.sha256).toBe(rep.sha256);
    const pdf = await app.inject({ method: 'GET', url: `/api/m/reports/${rep.id}/file?format=pdf` });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const png = await app.inject({ method: 'GET', url: `/api/m/reports/${rep.id}/preview/1` });
    expect(png.headers['content-type']).toBe('image/png');
    expect((await app.inject({ method: 'POST', url: '/api/m/reports', ...mp([]) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/m/reports/${rep.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/api/m/reports/${rep.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/sessions' })).statusCode).toBe(401);
  });

  it('сравнение двух образцов', async () => {
    const c = j(await req('GET', `/sessions/${sid}/compare`));
    expect(c.area_mm2.delta_pct).not.toBeNull();
    expect(c.scales_match).toBe(false);
  });

  it('версии отчёта: v1, v2, различия, откат, целостность', async () => {
    const r1 = await req('POST', `/sessions/${sid}/report`, { title: 'Тест', operator: 'И. Виноградов' });
    expect(r1.statusCode).toBe(201);
    expect(j(r1).number).toBe(1);
    await req('POST', `/samples/${samples[0].id}/measurements`, { kind: 'line', vertices: [[0, 0], [120, 0]] });
    const r2 = j(await req('POST', `/sessions/${sid}/report`, { summary: 'Добавлена линия' }));
    expect(r2.number).toBe(2);
    const d = j(await req('GET', `/sessions/${sid}/versions-diff?a=1&b=2`));
    expect(d.added).toBe(1);
    const v = j(await req('GET', `/sessions/${sid}/versions/1`));
    expect(v.intact).toBe(true);
    const rb = await req('POST', `/sessions/${sid}/versions/1/restore`);
    expect(j(rb).number).toBe(3);
    expect(j(await req('GET', `/sessions/${sid}/versions`)).map((x: any) => x.number)).toEqual([3, 2, 1]);
    expect(j(await req('GET', `/sessions/${sid}/events`)).length).toBeGreaterThan(5);
  });

  it('экспорт PDF, CSV, ZIP', async () => {
    const pdf = await req('GET', `/sessions/${sid}/export?formats=pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await req('GET', `/sessions/${sid}/export?formats=csv`)).payload).toContain('Образец');
    const z = await req('GET', `/sessions/${sid}/export?formats=pdf,csv,png,json`);
    expect(z.headers['content-type']).toBe('application/zip');
    expect(z.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await req('GET', `/sessions/${sid}/export?formats=exe`)).statusCode).toBe(400);
  });

  it('экспорт работает и после потери документного хранилища (перезапуск без Mongo)', async () => {
    await app.ctx.nosql.deleteMany('report_payloads', {});
    const pdf = await req('GET', `/sessions/${sid}/export?formats=pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    await pool.query('UPDATE report_versions SET payload=NULL');
    expect((await req('GET', `/sessions/${sid}/export?formats=csv`)).statusCode).toBe(200);
  });

  it('изоляция пользователей', async () => {
    const o = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'other@lab.ru', password: 'secret2' } });
    const other = (o.headers['set-cookie'] as string).split(';')[0];
    const r = await app.inject({ method: 'GET', url: `/api/sessions/${sid}`, headers: { cookie: other } });
    expect(r.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/samples/${samples[0].id}/image`, headers: { cookie: other } })).statusCode).toBe(404);
  });

  it('загрузка файла: тип, содержимое, дубликаты слотов', async () => {
    const sess = j(await req('POST', '/sessions', { title: 'Загрузка' }));
    const png = fs.readFileSync(path.join(process.env.DEMO_DIR!, 'sample_01.png'));
    const boundary = 'xBOUNDARYx';
    const body = (name: string, type: string, data: Buffer) => Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const up = (b: Buffer) => app.inject({ method: 'POST', url: `/api/sessions/${sess.id}/images`, headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: b });
    expect((await up(body('a.png', 'image/png', png))).statusCode).toBe(201);
    expect((await up(body('x.exe', 'application/octet-stream', Buffer.from('MZ')))).statusCode).toBe(415);
    expect((await up(body('fake.png', 'image/png', Buffer.from('not an image')))).statusCode).toBe(422);
    expect((await up(body('b.png', 'image/png', png))).statusCode).toBe(201);
    expect((await up(body('c.png', 'image/png', png))).statusCode).toBe(409);
  });

  it('настройки: режим дизайна и тема', async () => {
    const p = j(await req('PUT', '/prefs', { ui_mode: 'classic', theme: 'light' }));
    expect(p.ui_mode).toBe('classic'); expect(p.theme).toBe('light');
    expect((await req('PUT', '/prefs', { ui_mode: 'neon' })).statusCode).toBe(400);
    expect(j(await req('GET', '/prefs')).ui_mode).toBe('classic');
  });

  it('эталоны: встроенные не редактируются', async () => {
    const list = j(await req('GET', '/standards'));
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect((await req('DELETE', `/standards/${list[0].id}`)).statusCode).toBe(404);
    const c = j(await req('POST', '/standards', { name: 'Пластина А', kind: 'custom', width_mm: 20, height_mm: 10 }));
    expect((await req('DELETE', `/standards/${c.id}`)).statusCode).toBe(200);
  });

  it('тип эталона: ручная калибровка хранит выбранный вид, а не всегда «checker»', async () => {
    const corners = [[100, 100], [250, 100], [250, 250], [100, 250]];
    const rows = async () => (await pool.query('SELECT reference_type, side_mm FROM calibrations WHERE sample_id=$1', [samples[1].id])).rows[0];
    await req('PUT', `/samples/${samples[1].id}/calibration`, { corners, side_mm: 50, kind: 'marker' });
    expect(await rows()).toMatchObject({ reference_type: 'marker' });
    const std = (await pool.query(`SELECT id FROM reference_standards WHERE owner_id IS NULL AND kind='ruler' LIMIT 1`)).rows[0];
    await req('PUT', `/samples/${samples[1].id}/calibration`, { corners, side_mm: 30, reference_id: std.id });
    expect(await rows()).toMatchObject({ reference_type: 'ruler' });
    await req('PUT', `/samples/${samples[1].id}/calibration`, { corners, side_mm: 10 });
    expect(await rows()).toMatchObject({ reference_type: 'checker' });
    expect((await req('PUT', `/samples/${samples[1].id}/calibration`, { corners, side_mm: 10, kind: 'neon' })).statusCode).toBe(400);
  });

  it('ручные поправки углов попадают в набор для оценки поиска маркера', async () => {
    const corners = [[110, 100], [260, 100], [260, 250], [110, 250]];
    await req('PUT', `/samples/${samples[0].id}/calibration`, { corners, side_mm: 50, kind: 'marker' });
    const list = j(await req('GET', '/corrections'));
    const mine = list.find((d: any) => d.sample_id === samples[0].id);
    expect(mine).toMatchObject({ kind: 'marker', side_mm: 50 });
    expect(mine.corners).toHaveLength(4);
    expect(mine.image_path).toBeTruthy();
  });

  it('сторона маркера берётся из встроенного эталона', async () => {
    const { markerSideMm } = await import('../src/routes/samples.js');
    expect(await markerSideMm(pool)).toBe(50);
    await pool.query(`UPDATE reference_standards SET width_mm=40,height_mm=40 WHERE owner_id IS NULL AND name ILIKE 'Квадратный маркер%'`);
    expect(await markerSideMm(pool)).toBe(40);
    await pool.query(`DELETE FROM reference_standards WHERE owner_id IS NULL AND name ILIKE 'Квадратный маркер%'`);
    expect(await markerSideMm(pool)).toBe(50);
  });
});
