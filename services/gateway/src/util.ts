import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

export const uuid = z.string().uuid();
export const pt = z.tuple([z.number().finite(), z.number().finite()]);

export async function event(app: FastifyInstance, session_id: string, kind: string, text: string, user?: string, meta?: Record<string, unknown>) {
  await app.ctx.nosql.insert('events', { session_id, kind, text, user: user ?? '', meta: meta ?? {}, ts: new Date().toISOString() });
}

export class HttpError extends Error { constructor(public statusCode: number, msg: string) { super(msg); } }

export async function ownSession(app: FastifyInstance, req: FastifyRequest, id: string) {
  uuid.parse(id);
  const { rows } = await app.ctx.pool.query('SELECT * FROM sessions WHERE id=$1 AND owner_id=$2', [id, req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Сессия не найдена');
  return rows[0];
}

export async function ownSample(app: FastifyInstance, req: FastifyRequest, id: string) {
  uuid.parse(id);
  const { rows } = await app.ctx.pool.query(
    `SELECT sa.*, im.path AS image_path, im.width, im.height, im.filename, s.owner_id, s.title AS session_title, s.number AS session_number
       FROM samples sa JOIN sessions s ON s.id=sa.session_id JOIN images im ON im.id=sa.image_id
      WHERE sa.id=$1 AND s.owner_id=$2`, [id, req.user.id]);
  if (!rows[0]) throw new HttpError(404, 'Образец не найден');
  return rows[0];
}

export const touch = (app: FastifyInstance, sessionId: string, step?: string, status?: string) =>
  app.ctx.pool.query(
    `UPDATE sessions SET updated_at=now(), step=COALESCE($2,step), status=COALESCE($3,status) WHERE id=$1`, [sessionId, step ?? null, status ?? null]);

export const num = (v: any) => (v === null || v === undefined ? null : Number(v));

export function mapCal(r: any) {
  if (!r) return null;
  return {
    sample_id: r.sample_id, reference_type: r.reference_type, reference_id: r.reference_id, side_mm: Number(r.side_mm), corners: r.corners,
    px_per_mm: r.px_per_mm, confidence: r.confidence, method: r.method,
  };
}
export function mapMeas(r: any) {
  return { ...r, perimeter_mm: num(r.perimeter_mm), area_px: num(r.area_px), px_per_mm: num(r.px_per_mm) };
}
