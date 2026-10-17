import { useCallback, useEffect, useRef, useState } from 'react';
import type { Measurement, Pt, Sample, Session } from '@masshtablab/shared';
import { api, ApiError, type CalCandidate } from './api';
import { errText, useExtra, useToast } from './state';

export function useWorkspace(sessionId: string | undefined) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useToast();
  const { extra } = useExtra();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = useCallback(async () => {
    if (!sessionId) return null;
    try {
      const s = await api.session(sessionId);
      if (alive.current) { setSession(s); setError(null); }
      return s;
    } catch (e) {
      if (alive.current) setError(e instanceof ApiError && e.status === 404 ? 'Сессия не найдена' : errText(e));
      return null;
    } finally { if (alive.current) setLoading(false); }
  }, [sessionId]);
  useEffect(() => { setLoading(true); void reload(); }, [reload]);

  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
    setBusy(label);
    try { const r = await fn(); await reload(); if (okText) toast(okText, 'ok'); return r; }
    catch (e) { toast(errText(e), 'err'); return undefined; }
    finally { if (alive.current) setBusy(null); }
  }, [reload, toast]);

  const samples: Sample[] = session?.samples ?? [];
  const calibrated = samples.length > 0 && samples.every((s) => s.calibration);
  const measurementsCount = samples.reduce((n, s) => n + (s.measurements?.length ?? 0), 0);

  return {
    session, samples, loading, error, busy, reload, calibrated, measurementsCount,
    upload: (file: File, slot?: number) => run('upload', () => api.upload(session!.id, file, slot), 'Снимок загружен'),
    removeSample: (id: string) => run('remove', () => api.deleteSample(id), 'Образец удалён'),
    autoCalibrate: (s: Sample, save = true) => run('calibrate', () => api.autoCalibrate(s.id, { save: save && !extra.require_review, side_mm: extra.default_side, min_confidence: extra.min_confidence })),
    saveCalibration: (s: Sample, corners: Pt[], side = 10, method: 'auto' | 'manual' = 'manual', kind?: CalCandidate['kind']) =>
      run('calibrate', () => api.setCalibration(s.id, corners, side, method, kind), 'Калибровка сохранена'),
    addMeasurement: (s: Sample, kind: Measurement['kind'] & ('polygon' | 'line' | 'angle' | 'circle'), v: Pt[]) =>
      run('measure', () => api.addMeasurement(s.id, kind, v)),
    updateMeasurement: (id: string, b: { vertices?: Pt[]; label?: string; in_table?: boolean }) => run('measure', () => api.updateMeasurement(id, b)),
    removeMeasurement: (id: string) => run('measure', () => api.deleteMeasurement(id)),
    setStep: (step: Session['step']) => api.patchSession(session!.id, { step }).catch(() => undefined),
    rename: (title: string) => run('rename', () => api.patchSession(session!.id, { title })),
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
