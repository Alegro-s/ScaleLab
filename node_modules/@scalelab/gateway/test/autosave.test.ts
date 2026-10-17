import { describe, expect, it } from 'vitest';
import { canAutoSave } from '../src/routes/samples.js';

const candidate = (o: Record<string, unknown>) => ({ corners: [], px_per_mm: 10, confidence: 0.5, ...o });

describe('автосохранение калибровки', () => {
  it('ненадёжного кандидата ядра не сохраняет никогда', () => {
    expect(canAutoSave(candidate({ kind: 'marker', reliable: false, confidence: 0.99 }), 0)).toBe(false);
    expect(canAutoSave(candidate({ kind: 'checker', reliable: false, confidence: 0.99 }), 0)).toBe(false);
  });
  it('маркер сохраняется, когда ядро считает его надёжным, независимо от пользовательского порога', () => {
    expect(canAutoSave(candidate({ kind: 'marker', reliable: true, confidence: 0.5 }), 0.6)).toBe(true);
  });
  it('шахматка сравнивается с пользовательским порогом', () => {
    expect(canAutoSave(candidate({ kind: 'checker', reliable: true, confidence: 0.5 }), 0.6)).toBe(false);
    expect(canAutoSave(candidate({ kind: 'checker', reliable: true, confidence: 0.7 }), 0.6)).toBe(true);
    expect(canAutoSave(candidate({ confidence: 0.7 }), 0.6)).toBe(true);
  });
});
