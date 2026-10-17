import { config } from './config.js';

export class CoreError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function call(path: string, body: unknown, raw = false): Promise<any> {
  let r: Response;
  try {
    r = await fetch(config.coreUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new CoreError(503, 'Сервис вычислений недоступен');
  }
  if (!r.ok) {
    let msg = 'Ошибка сервиса вычислений';
    try { const j: any = await r.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail); } catch { }
    throw new CoreError(r.status === 422 ? 422 : 502, msg);
  }
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}

export const core = {
  health: async () => { try { return (await fetch(config.coreUrl + '/health')).ok; } catch { return false; } },
  calibrate: (image_path: string, side_mm: number) => call('/calibrate', { image_path, side_mm }),
  analyze: (image_path: string, side_mm: number, marker_side_mm?: number) => call('/analyze', { image_path, side_mm, ...(marker_side_mm ? { marker_side_mm } : {}) }),
  manualCalibration: (corners: number[][], side_mm: number) => call('/calibration/manual', { corners, side_mm }),
  standardize: (b: { image_path: string; corners: number[][]; side_mm: number; target_px_per_mm: number }) => call('/standardize', b, true) as Promise<Buffer>,
  batch: (folder: string, side_mm: number) => call('/batch', { folder, side_mm }),
  measure: (b: { kind: string; vertices: number[][]; px_per_mm: number; rel_error?: number }) => call('/measure', b),
  segment: (b: Record<string, unknown>) => call('/segment', b),
  compare: (a: unknown, b: unknown) => call('/compare', { a, b }),
  pdf: (payload: unknown) => call('/report/pdf', payload, true) as Promise<Buffer>,
  csv: (payload: unknown) => call('/report/csv', payload, true) as Promise<Buffer>,
  hash: (payload: unknown) => call('/report/hash', payload) as Promise<{ sha256: string }>,
  overlay: (image_path: string, measurements: unknown[]) => call('/report/overlay', { image_path, measurements }, true) as Promise<Buffer>,
};
