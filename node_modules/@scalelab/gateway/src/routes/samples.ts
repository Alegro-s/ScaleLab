import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { core } from '../core.js';
import { buildCompare } from '../compare.js';
import { event, HttpError, mapCal, mapMeas, ownSample, ownSession, pt, touch, uuid } from '../util.js';

const DEFAULT_MARKER_SIDE_MM = 50;

export async function markerSideMm(pool: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }): Promise<number> {
  const { rows } = await pool.query(
    `SELECT width_mm FROM reference_standards WHERE owner_id IS NULL AND kind='custom' AND name ILIKE 'Квадратный маркер%' AND width_mm=height_mm ORDER BY created_at LIMIT 1`);
  const side = rows[0] ? Number(rows[0].width_mm) : NaN;
  return Number.isFinite(side) && side > 0 ? side : DEFAULT_MARKER_SIDE_MM;
}

const REFERENCE_KINDS = ['checker', 'marker', 'ruler', 'coin', 'custom'] as const;

async function resolveReferenceType(pool: { query(sql: string, params: unknown[]): Promise<{ rows: any[] }> }, kind: string | undefined, referenceId: string | null | undefined): Promise<string> {
  if (kind) return kind;
  if (referenceId) {
    const { rows } = await pool.query('SELECT kind FROM reference_standards WHERE id=$1', [referenceId]);
    if (rows[0]) return rows[0].kind;
  }
  return 'checker';
}

interface CalibrationCandidate { corners: number[][]; px_per_mm: number; confidence: number; kind?: string; side_mm?: number; reliable?: boolean }

export function canAutoSave(candidate: CalibrationCandidate, minConfidence: number): boolean {
  if (candidate.reliable === false) return false;
  return candidate.kind === 'marker' || candidate.confidence >= minConfidence;
}

async function logAnalysis(nosql: { insert(col: string, doc: Record<string, unknown>): Promise<string> }, sample: { id: string; session_id: string }, analysis: any) {
  try {
    await nosql.insert('analyses', {
      sample_id: sample.id, session_id: sample.session_id, reference: analysis.reference, perspective: analysis.perspective,
      segmentation: analysis.segmentation, object: analysis.object ? { ...analysis.object, regions: undefined } : null,
      warnings: analysis.warnings, ts: new Date().toISOString(),
    });
  } catch { }
}

async function logCorrection(nosql: { insert(col: string, doc: Record<string, unknown>): Promise<string> }, ownerId: string,
  sample: { id: string; session_id: string; image_path: string }, manual: unknown, previous: { corners: unknown; method: string } | undefined, kind: string, sideMm: number) {
  try {
    await nosql.insert('corrections', {
      owner_id: ownerId, sample_id: sample.id, session_id: sample.session_id, image_path: sample.image_path, kind, side_mm: sideMm,
      corners: manual, auto_corners: previous?.method === 'auto' ? previous.corners : null, ts: new Date().toISOString(),
    });
  } catch { }
}

async function upsertAutoCalibration(pool: { query(sql: string, params: unknown[]): Promise<unknown> }, sampleId: string, candidate: CalibrationCandidate, requestedSideMm: number) {
  await pool.query(
    `INSERT INTO calibrations(sample_id,reference_type,side_mm,corners,px_per_mm,confidence,method) VALUES ($1,$6,$2,$3,$4,$5,'auto')
     ON CONFLICT (sample_id) DO UPDATE SET reference_type=$6,side_mm=$2,corners=$3,px_per_mm=$4,confidence=$5,method='auto',updated_at=now()`,
    [sampleId, candidate.side_mm ?? requestedSideMm, JSON.stringify(candidate.corners), candidate.px_per_mm, candidate.confidence, candidate.kind ?? 'checker']);
}

export function pointInPolygon(p: number[], v: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i]!, [xj, yj] = v[j]!;
    if ((yi! > p[1]!) !== (yj! > p[1]!) && p[0]! < ((xj! - xi!) * (p[1]! - yi!)) / (yj! - yi!) + xi!) inside = !inside;
  }
  return inside;
}

export const relError = (k: number, side_mm: number) => 0.5 / (k * side_mm);

export async function sampleRoutes(app: FastifyInstance) {
  const { pool, nosql } = app.ctx;
  const A = { preHandler: app.auth };
  const id = (req: any) => req.params.id as string;

  app.get('/samples', A, async (req) => {
    const q = z.object({ q: z.string().optional(), species: z.string().optional(), tag: z.string().optional(),
      min_area: z.coerce.number().optional(), max_area: z.coerce.number().optional(), sort: z.enum(['date', 'name', 'area']).default('date') }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT sa.*, im.width, im.height, im.filename, s.title AS session_title, s.number AS session_number,
                (SELECT jsonb_build_object('sample_id',c.sample_id,'px_per_mm',c.px_per_mm,'confidence',c.confidence,'method',c.method,'side_mm',c.side_mm::float8,
                        'reference_type',c.reference_type,'corners',c.corners) FROM calibrations c WHERE c.sample_id=sa.id) AS calibration,
                (SELECT m.value FROM measurements m WHERE m.sample_id=sa.id AND m.kind IN ('polygon','mask') ORDER BY m.created_at LIMIT 1) AS area_mm2
           FROM samples sa JOIN sessions s ON s.id=sa.session_id JOIN images im ON im.id=sa.image_id WHERE s.owner_id=$1) t
        WHERE ($2::text IS NULL OR name ILIKE '%'||$2||'%' OR species ILIKE '%'||$2||'%')
          AND ($3::text IS NULL OR species=$3) AND ($4::text IS NULL OR $4=ANY(tags))
          AND ($5::float8 IS NULL OR area_mm2>=$5) AND ($6::float8 IS NULL OR area_mm2<=$6)
        ORDER BY ${q.sort === 'name' ? 'name' : q.sort === 'area' ? 'area_mm2 DESC NULLS LAST' : 'created_at DESC'}`,
      [req.user.id, q.q ?? null, q.species ?? null, q.tag ?? null, q.min_area ?? null, q.max_area ?? null]);
    return rows;
  });

  app.get('/samples/:id', A, async (req) => {
    const s = await ownSample(app, req, id(req));
    const cal = (await pool.query('SELECT * FROM calibrations WHERE sample_id=$1', [s.id])).rows[0];
    const ms = (await pool.query('SELECT * FROM measurements WHERE sample_id=$1 ORDER BY created_at', [s.id])).rows;
    delete s.image_path;
    return { ...s, calibration: mapCal(cal), measurements: ms.map(mapMeas) };
  });

  app.patch('/samples/:id', A, async (req) => {
    const s = await ownSample(app, req, id(req));
    const b = z.object({ name: z.string().trim().min(1).max(120).optional(), species: z.string().max(120).optional(), tags: z.array(z.string().max(40)).max(20).optional() }).parse(req.body);
    const { rows } = await pool.query('UPDATE samples SET name=COALESCE($2,name), species=COALESCE($3,species), tags=COALESCE($4,tags) WHERE id=$1 RETURNING *',
      [s.id, b.name ?? null, b.species ?? null, b.tags ?? null]);
    return rows[0];
  });

  app.delete('/samples/:id', A, async (req) => {
    const s = await ownSample(app, req, id(req));
    await pool.query('DELETE FROM samples WHERE id=$1', [s.id]);
    return { ok: true };
  });

  app.post('/samples/:id/calibrate', A, async (req) => {
    const s = await ownSample(app, req, id(req));
    const b = z.object({ side_mm: z.number().positive().default(10), save: z.boolean().default(true), min_confidence: z.number().min(0).max(1).default(0.6) }).parse(req.body ?? {});
    const r = await core.analyze(s.image_path, b.side_mm, await markerSideMm(pool));
    await logAnalysis(nosql, s, r);
    const best = r.found ? r.candidates[0] : null;
    let saved = false;
    if (b.save && best && canAutoSave(best, b.min_confidence)) {
      await upsertAutoCalibration(pool, s.id, best, b.side_mm);
      await touch(app, s.session_id, 'calibration');
      await event(app, s.session_id, 'calibration', `Калибровка ${s.name}: ${best.px_per_mm.toFixed(1)} px/мм`, req.user.email);
      saved = true;
    }
    return { ...r, saved };
  });

  app.put('/samples/:id/calibration', A, async (req) => {
    const s = await ownSample(app, req, id(req));
    const b = z.object({ corners: z.array(pt).length(4), side_mm: z.number().positive().default(10), reference_id: uuid.nullish(), method: z.enum(['auto', 'manual']).default('manual'), kind: z.enum(REFERENCE_KINDS).optional() }).parse(req.body);
    const c = await core.manualCalibration(b.corners, b.side_mm);
    const referenceType = await resolveReferenceType(pool, b.kind, b.reference_id);
    const previous = (await pool.query('SELECT corners, method FROM calibrations WHERE sample_id=$1', [s.id])).rows[0];
    await pool.query(
      `INSERT INTO calibrations(sample_id,reference_id,reference_type,side_mm,corners,px_per_mm,confidence,method) VALUES ($1,$2,$8,$3,$4,$5,$6,$7)
       ON CONFLICT (sample_id) DO UPDATE SET reference_id=$2,reference_type=$8,side_mm=$3,corners=$4,px_per_mm=$5,confidence=$6,method=$7,updated_at=now()`,
      [s.id, b.reference_id ?? null, b.side_mm, JSON.stringify(c.corners), c.px_per_mm, c.confidence, b.method, referenceType]);
    if (b.method === 'manual') await logCorrection(nosql, req.user.id, s, c.corners, previous, referenceType, b.side_mm);
    const ms = (await pool.query('SELECT * FROM measurements WHERE sample_id=$1', [s.id])).rows;
    for (const m of ms) if (m.kind !== 'angle') {
      const r = await core.measure({ kind: m.kind === 'mask' ? 'polygon' : m.kind, vertices: m.vertices, px_per_mm: c.px_per_mm, rel_error: c.rel_error });
      await pool.query('UPDATE measurements SET value=$2,perimeter_mm=$3,area_px=$4,error=$5,px_per_mm=$6,updated_at=now() WHERE id=$1',
        [m.id, r.value, r.perimeter_mm ?? null, r.area_px ?? null, r.error, c.px_per_mm]);
    }
    await touch(app, s.session_id, 'calibration');
    await event(app, s.session_id, 'calibration', `Ручная калибровка ${s.name}: ${c.px_per_mm.toFixed(1)} px/мм`, req.user.email);
    return mapCal((await pool.query('SELECT * FROM calibrations WHERE sample_id=$1', [s.id])).rows[0]);
  });

  app.get('/corrections', A, async (req) => {
    const rows = await nosql.find('corrections', { owner_id: req.user.id }, { sort: { ts: -1 }, limit: 1000 });
    return rows.map((d) => ({ sample_id: d.sample_id, image_path: d.image_path, kind: d.kind, side_mm: d.side_mm, corners: d.corners, auto_corners: d.auto_corners, ts: d.ts }));
  });

  async function calOf(sampleId: string) {
    const c = (await pool.query('SELECT * FROM calibrations WHERE sample_id=$1', [sampleId])).rows[0];
    if (!c) throw new HttpError(409, 'Сначала выполните калибровку образца');
    return c;
  }

  const measIn = z.object({ kind: z.enum(['polygon', 'line', 'angle', 'circle']), vertices: z.array(pt).min(2).max(2000), label: z.string().max(20).optional(), in_table: z.boolean().default(true) });
  const prefix: Record<string, string> = { polygon: 'К', line: 'L', angle: 'A', circle: 'D' };

  app.post('/samples/:id/measurements', A, async (req, rep) => {
    const s = await ownSample(app, req, id(req));
    const b = measIn.parse(req.body);
    const cal = await calOf(s.id);
    const r = await core.measure({ kind: b.kind, vertices: b.vertices, px_per_mm: cal.px_per_mm, rel_error: relError(cal.px_per_mm, Number(cal.side_mm)) });
    const n = Number((await pool.query('SELECT count(*) FROM measurements WHERE sample_id=$1 AND kind=$2', [s.id, b.kind])).rows[0].count) + 1;
    const label = b.label ?? `${prefix[b.kind]}${n}`;
    const { rows } = await pool.query(
      `INSERT INTO measurements(sample_id,label,kind,vertices,value,unit,perimeter_mm,area_px,error,px_per_mm,in_table) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [s.id, label, b.kind, JSON.stringify(b.vertices), r.value, r.unit, r.perimeter_mm ?? null, r.area_px ?? null, r.error, cal.px_per_mm, b.in_table]);
    await touch(app, s.session_id, 'measurement', 'in_progress');
    await event(app, s.session_id, 'measurement', `${s.name}: ${label} = ${r.value.toFixed(2)} ${r.unit}`, req.user.email);
    return rep.code(201).send(mapMeas(rows[0]));
  });

  app.put('/measurements/:id', A, async (req) => {
    const mid = uuid.parse(id(req));
    const cur = (await pool.query('SELECT m.* FROM measurements m JOIN samples sa ON sa.id=m.sample_id JOIN sessions s ON s.id=sa.session_id WHERE m.id=$1 AND s.owner_id=$2', [mid, req.user.id])).rows[0];
    if (!cur) throw new HttpError(404, 'Замер не найден');
    const b = z.object({ vertices: z.array(pt).min(2).max(2000).optional(), label: z.string().max(20).optional(), in_table: z.boolean().optional() }).parse(req.body);
    const cal = await calOf(cur.sample_id);
    let r: any = { value: cur.value, unit: cur.unit, perimeter_mm: cur.perimeter_mm, area_px: cur.area_px, error: cur.error };
    const verts = b.vertices ?? cur.vertices;
    if (b.vertices) r = await core.measure({ kind: cur.kind === 'mask' ? 'polygon' : cur.kind, vertices: verts, px_per_mm: cal.px_per_mm, rel_error: relError(cal.px_per_mm, Number(cal.side_mm)) });
    const { rows } = await pool.query(
      `UPDATE measurements SET vertices=$2,label=COALESCE($3,label),in_table=COALESCE($4,in_table),value=$5,unit=$6,perimeter_mm=$7,area_px=$8,error=$9,px_per_mm=$10,updated_at=now() WHERE id=$1 RETURNING *`,
      [mid, JSON.stringify(verts), b.label ?? null, b.in_table ?? null, r.value, r.unit, r.perimeter_mm ?? null, r.area_px ?? null, r.error, cal.px_per_mm]);
    return mapMeas(rows[0]);
  });

  app.delete('/measurements/:id', A, async (req) => {
    const mid = uuid.parse(id(req));
    const { rowCount } = await pool.query('DELETE FROM measurements m USING samples sa, sessions s WHERE m.id=$1 AND sa.id=m.sample_id AND s.id=sa.session_id AND s.owner_id=$2', [mid, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Замер не найден');
    return { ok: true };
  });

  app.post('/samples/:id/segment', A, async (req) => {
    const s = await ownSample(app, req, id(req));
    const b = z.object({ channel: z.enum(['rgb', 'g', 'lab']).default('g'), low: z.number().int().min(0).max(255).optional(), high: z.number().int().min(0).max(255).optional(),
      smooth_px: z.number().min(0).max(20).default(2), min_area_mm2: z.number().min(0).default(0.5), fill_holes: z.boolean().default(true), apply: z.boolean().default(false),
      erase: z.array(z.tuple([z.number(), z.number(), z.number().positive()])).max(300).default([]), drop: z.array(pt).max(500).default([]) }).parse(req.body ?? {});
    const cal = await calOf(s.id);
    const r = await core.segment({ image_path: s.image_path, px_per_mm: cal.px_per_mm, channel: b.channel, low: b.low, high: b.high, smooth_px: b.smooth_px,
      min_area_mm2: b.min_area_mm2, fill_holes: b.fill_holes, exclude_corners: cal.corners, erase: b.erase });
    await nosql.insert('segmentations', { sample_id: s.id, session_id: s.session_id, params: b, regions: r.regions, low: r.low, high: r.high, ts: new Date().toISOString() });
    let created: any[] = [];
    if (b.apply) {
      const kept = r.regions.filter((reg: { vertices: number[][] }) => !b.drop.some((p) => pointInPolygon(p, reg.vertices)));
      for (const [i, reg] of kept.entries()) {
        const m = await core.measure({ kind: 'polygon', vertices: reg.vertices, px_per_mm: cal.px_per_mm, rel_error: relError(cal.px_per_mm, Number(cal.side_mm)) });
        const row = (await pool.query(
          `INSERT INTO measurements(sample_id,label,kind,vertices,value,unit,perimeter_mm,area_px,error,px_per_mm) VALUES ($1,$2,'mask',$3,$4,'мм²',$5,$6,$7,$8) RETURNING *`,
          [s.id, `О${i + 1}`, JSON.stringify(reg.vertices), m.value, m.perimeter_mm, m.area_px, m.error, cal.px_per_mm])).rows[0];
        created.push(mapMeas(row));
      }
      await touch(app, s.session_id, 'measurement', 'in_progress');
      await event(app, s.session_id, 'segmentation', `${s.name}: принято областей — ${created.length}`, req.user.email);
    }
    return { ...r, applied: created };
  });

  app.get('/samples/:id/standardized.png', A, async (req, rep) => {
    const s = await ownSample(app, req, id(req));
    const q = z.object({ ppm: z.coerce.number().min(1).max(200).default(20) }).parse(req.query);
    const cal = await calOf(s.id);
    const png = await core.standardize({ image_path: s.image_path, corners: cal.corners, side_mm: Number(cal.side_mm), target_px_per_mm: q.ppm });
    const base = String(s.name).replace(/[^\p{L}\p{N}._-]+/gu, '_');
    await event(app, s.session_id, 'standardize', `${s.name}: стандартизированный снимок, ${q.ppm} px/мм`, req.user.email);
    return rep.header('content-type', 'image/png').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}_${q.ppm}pxmm.png`).send(png);
  });

  app.post('/batch', A, async (req) => {
    const b = z.object({ folder: z.string().trim().min(1).max(200), side_mm: z.number().positive().default(10) }).parse(req.body);
    return core.batch(b.folder, b.side_mm);
  });

  app.get('/sessions/:id/compare', A, async (req) => {
    const sess = await ownSession(app, req, id(req));
    const out = await buildCompare(app, sess.id);
    if (!out) throw new HttpError(409, 'Для сравнения нужны два откалиброванных образца с замерами');
    await touch(app, sess.id, 'comparison');
    return out;
  });

}
