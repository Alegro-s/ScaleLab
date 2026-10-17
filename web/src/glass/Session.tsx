import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Step } from '@masshtablab/shared';
import { useWs } from '../session';
import { GlassFrame, SessionBar } from './Shell';
import { GlassUpload } from './Upload';
import { GlassCalibration } from './Calibration';
import { GlassMeasure } from './Measure';
import { GlassCompare } from './Compare';
import { GlassTable } from './Table';
import { GlassReport, ExportModal } from './Report';
import { GlassVersions } from './Journal';

export function GlassSession({ step }: { step: Step | 'table' | 'versions' }) {
  const ws = useWs();
  const nav = useNavigate();
  const [exp, setExp] = useState(false);
  const go = (s: Step | 'table' | 'versions') => nav(`/session/${ws.session!.id}/${s}`);
  const body = step === 'upload' ? <GlassUpload go={go} />
    : step === 'calibration' ? <GlassCalibration go={go} />
    : step === 'measurement' ? <GlassMeasure go={go} />
    : step === 'comparison' ? <GlassCompare go={go} />
    : step === 'table' ? <GlassTable go={go} />
    : step === 'report' ? <GlassReport go={go} openExport={() => setExp(true)} />
    : <GlassVersions />;
  return (
    <GlassFrame bar={<SessionBar ws={ws} step={step} onExport={() => setExp(true)} />}>
      {body}
      {exp && <ExportModal onClose={() => setExp(false)} />}
    </GlassFrame>
  );
}
export type Go = (s: Step | 'table' | 'versions') => void;
