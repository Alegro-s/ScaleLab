import { createContext, useContext } from 'react';
import { STEPS, type Step } from '@masshtablab/shared';
import type { Workspace } from './useWorkspace';

export const WsContext = createContext<Workspace>(null!);
export const useWs = () => useContext(WsContext);

export function stepBlock(ws: Workspace, step: Step): string | null {
  const n = ws.samples.length;
  if (step === 'upload') return null;
  if (step === 'calibration') return n ? null : 'Сначала загрузите снимок';
  if (!n) return 'Сначала загрузите снимок';
  if (!ws.calibrated) return 'Сначала откалибруйте все образцы';
  if (step === 'measurement') return null;
  if (!ws.measurementsCount) return 'Сначала сделайте хотя бы один замер';
  if (step === 'comparison') return n >= 2 ? null : 'Для сравнения нужны два образца';
  return null;
}
export const stepDone = (ws: Workspace, step: Step): boolean => {
  const n = ws.samples.length;
  switch (step) {
    case 'upload': return n > 0;
    case 'calibration': return n > 0 && ws.calibrated;
    case 'measurement': return ws.measurementsCount > 0;
    case 'comparison': return n >= 2 && ws.measurementsCount > 0 && ws.session?.step === 'report';
    case 'report': return (ws.session?.version_count ?? 0) > 0;
  }
};
export const nextStep = (s: Step): Step | null => STEPS[STEPS.indexOf(s) + 1] ?? null;
export const prevStep = (s: Step): Step | null => STEPS[STEPS.indexOf(s) - 1] ?? null;
export const isStep = (s: string | undefined): s is Step => !!s && (STEPS as string[]).includes(s);
