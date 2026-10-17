import type { FastifyInstance } from 'fastify';
import { core } from './core.js';
import { num } from './util.js';

export async function buildCompare(app: FastifyInstance, sessionId: string) {
  const { pool } = app.ctx;
    const rows = (await pool.query(
    `SELECT sa.id, sa.name, sa.slot, c.px_per_mm,
            (SELECT m.value FROM measurements m WHERE m.sample_id=sa.id AND m.kind IN ('polygon','mask') ORDER BY m.created_at LIMIT 1) AS area_mm2,
            (SELECT m.perimeter_mm FROM measurements m WHERE m.sample_id=sa.id AND m.kind IN ('polygon','mask') ORDER BY m.created_at LIMIT 1) AS perimeter_mm
       FROM samples sa JOIN calibrations c ON c.sample_id=sa.id WHERE sa.session_id=$1 ORDER BY sa.slot`, [sessionId])).rows;
  if (rows.length < 2) return null;
  const [a, b] = rows.map((r) => ({ id: r.id, name: r.name, px_per_mm: r.px_per_mm, area_mm2: num(r.area_mm2), perimeter_mm: num(r.perimeter_mm) }));
  const res = await core.compare(a, b);
  return { ...res, a, b };
}
