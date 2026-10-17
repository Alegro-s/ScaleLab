import { describe, expect, it } from 'vitest';
import { interiorPoint, pointInPolygon } from '../src/lib/geom';
import type { Pt } from '@masshtablab/shared';

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const gamma: Pt[] = [[0, 0], [20, 0], [20, 4], [4, 4], [4, 20], [0, 20]];

describe('геометрия для волшебной стёрки', () => {
  it('точка внутри и снаружи многоугольника', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });
  it('внутренняя точка вогнутого контура лежит внутри него', () => {
    const p = interiorPoint(gamma);
    expect(pointInPolygon(p, gamma)).toBe(true);
  });
});
