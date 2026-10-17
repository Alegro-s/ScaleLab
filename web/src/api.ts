import type { Calibration, CompareResult, JournalEvent, Measurement, Pt, Prefs, ReferenceStandard, ReportOptions, ReportVersion,
  Sample, SegmentResult, Session, Stats, User } from '@masshtablab/shared';

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const noDots = (v: unknown): unknown => typeof v === 'string' ? v.replaceAll(' · ', ', ') : Array.isArray(v) ? v.map(noDots) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noDots(x)])) : v;

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { (init.headers as Record<string, string>)['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  let r: Response;
  try { r = await fetch('/api' + url, init); } catch { throw new ApiError(0, 'Нет связи с сервером'); }
  if (!r.ok) {
    let msg = `Ошибка ${r.status}`;
    try { msg = ((await r.json()) as { error?: string }).error ?? msg; } catch { }
    throw new ApiError(r.status, msg);
  }
  const ct = r.headers.get('content-type') ?? '';
  return (ct.includes('json') ? r.json().then(noDots) : r.blob()) as Promise<T>;
}
const get = <T,>(u: string) => req<T>('GET', u);
const post = <T,>(u: string, b?: unknown) => req<T>('POST', u, b ?? {});
const put = <T,>(u: string, b?: unknown) => req<T>('PUT', u, b ?? {});
const patch = <T,>(u: string, b?: unknown) => req<T>('PATCH', u, b ?? {});
const del = <T,>(u: string) => req<T>('DELETE', u);

export interface CalCandidate { corners: Pt[]; side_px: number; px_per_mm: number; squareness: number; pattern_score?: number; confidence: number; kind?: 'checker' | 'marker'; side_mm?: number; reliable?: boolean }
export interface SceneObject { bbox: number[]; centroid: number[]; area_frac: number; color_rgb: number[]; confidence: number; regions: number[][][]; area_mm2?: number }
export interface AutoCalResult { found: boolean; candidates: CalCandidate[]; saved: boolean; image: { width: number; height: number }; perspective?: { mode: string; tilt_pct: number | null }; object?: SceneObject | null; warnings?: string[] }
export interface DiffResult { a: number; b: number; changed: number; added: number; removed: number; rows: { key: string; change: 'added' | 'changed' | 'removed'; before?: number; after?: number; unit: string }[] }
export interface PayloadSample { slot: number; name: string; px_per_mm: number; side_mm: number; confidence: number; measurements: Pick<Measurement, 'label' | 'kind' | 'value' | 'unit' | 'perimeter_mm' | 'error' | 'vertices'>[] }
export interface ReportPayload {
  title: string; operator: string; generated_at: string; version: number; sha256: string; template: string; language: string; format: string;
  session: { number: number; title: string }; sections: Record<string, boolean>; samples: PayloadSample[]; compare: CompareResult | null; conclusions: string[];
}
export interface Health { ok: boolean; postgres: boolean; nosql: boolean; nosql_kind: string; core: boolean }

export interface BatchItem { file: string; status: 'ok' | 'no_reference' | 'unreadable'; width?: number; height?: number; px_per_mm?: number; confidence?: number; squareness?: number; rel_error?: number }
export interface BatchResult { folder: string; items: BatchItem[] }

export const api = {
  login: (email: string, password: string) => post<{ user: User }>('/auth/login', { email, password }),
  register: (email: string, password: string, full_name: string) => post<{ user: User }>('/auth/register', { email, password, full_name }),
  demo: () => post<{ user: User }>('/auth/demo'),
  logout: () => post('/auth/logout'),
  me: () => get<User>('/auth/me'),
  prefs: () => get<Prefs>('/prefs'),
  savePrefs: (p: Partial<Prefs>) => put<Prefs>('/prefs', p),
  stats: () => get<Stats>('/stats'),
  health: () => get<Health>('/health'),
  sessions: (q: { status?: string; q?: string } = {}) => get<Session[]>('/sessions?' + new URLSearchParams(q as Record<string, string>)),
  session: (id: string) => get<Session>(`/sessions/${id}`),
  createSession: (title: string) => post<Session>('/sessions', { title }),
  patchSession: (id: string, b: Partial<Pick<Session, 'title' | 'status' | 'step'>>) => patch<Session>(`/sessions/${id}`, b),
  deleteSession: (id: string) => del(`/sessions/${id}`),
  seedDemo: () => post<Session>('/demo/seed'),
  upload: (sid: string, file: File, slot?: number) => {
    const f = new FormData();
    if (slot) f.append('slot', String(slot));
    f.append('file', file);
    return req<Sample>('POST', `/sessions/${sid}/images`, f);
  },
  standardizedUrl: (sampleId: string, ppm = 20) => `/api/samples/${sampleId}/standardized.png?ppm=${ppm}`,
  batch: (folder: string, side_mm = 10) => post<BatchResult>('/batch', { folder, side_mm }),
  imageUrl: (sampleId: string) => `/api/samples/${sampleId}/image`,
  samples: (q: Record<string, string> = {}) => get<Sample[]>('/samples?' + new URLSearchParams(q)),
  patchSample: (id: string, b: Partial<Pick<Sample, 'name' | 'species' | 'tags'>>) => patch<Sample>(`/samples/${id}`, b),
  deleteSample: (id: string) => del(`/samples/${id}`),
  autoCalibrate: (id: string, o: { side_mm?: number; save?: boolean; min_confidence?: number } = {}) => post<AutoCalResult>(`/samples/${id}/calibrate`, o),
  setCalibration: (id: string, corners: Pt[], side_mm = 10, method: 'auto' | 'manual' = 'manual', kind?: CalCandidate['kind']) => put<Calibration>(`/samples/${id}/calibration`, { corners, side_mm, method, kind }),
  addMeasurement: (id: string, kind: 'polygon' | 'line' | 'angle' | 'circle', vertices: Pt[], label?: string) => post<Measurement>(`/samples/${id}/measurements`, { kind, vertices, label }),
  updateMeasurement: (id: string, b: { vertices?: Pt[]; label?: string; in_table?: boolean }) => put<Measurement>(`/measurements/${id}`, b),
  deleteMeasurement: (id: string) => del(`/measurements/${id}`),
  segment: (id: string, b: { channel?: string; low?: number; high?: number; smooth_px?: number; min_area_mm2?: number; fill_holes?: boolean; apply?: boolean; erase?: number[][]; drop?: Pt[] }) =>
    post<SegmentResult & { applied: Measurement[] }>(`/samples/${id}/segment`, b),
  compare: (sid: string) => get<CompareResult>(`/sessions/${sid}/compare`),
  saveReport: (sid: string, o: ReportOptions) => post<ReportVersion & { payload: ReportPayload }>(`/sessions/${sid}/report`, o),
  versions: (sid: string) => get<ReportVersion[]>(`/sessions/${sid}/versions`),
  version: (sid: string, n: number) => get<ReportVersion & { payload: ReportPayload; intact: boolean }>(`/sessions/${sid}/versions/${n}`),
  diff: (sid: string, a: number, b: number) => get<DiffResult>(`/sessions/${sid}/versions-diff?a=${a}&b=${b}`),
  restore: (sid: string, n: number) => post<ReportVersion>(`/sessions/${sid}/versions/${n}/restore`),
  exportUrl: (sid: string, formats: string[], o: { version?: number; filename?: string } = {}) => {
    const p = new URLSearchParams({ formats: formats.join(',') });
    if (o.version) p.set('version', String(o.version));
    if (o.filename) p.set('filename', o.filename);
    return `/api/sessions/${sid}/export?${p}`;
  },
  events: (sid: string) => get<JournalEvent[]>(`/sessions/${sid}/events`),
  standards: () => get<ReferenceStandard[]>('/standards'),
  addStandard: (b: Omit<ReferenceStandard, 'id' | 'owner_id'>) => post<ReferenceStandard>('/standards', b),
  deleteStandard: (id: string) => del(`/standards/${id}`),
  uiState: () => get<Record<string, unknown>>('/ui-state'),
  saveUiState: (s: Record<string, unknown>) => put('/ui-state', s),
};
