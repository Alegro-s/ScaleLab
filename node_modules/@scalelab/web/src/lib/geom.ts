import type { Pt } from '@masshtablab/shared';

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function shoelace(v: Pt[]): number {
  if (v.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < v.length; i++) { const [x1, y1] = v[i], [x2, y2] = v[(i + 1) % v.length]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
export const perimeter = (v: Pt[], closed = true) => { let s = 0; for (let i = 0; i < v.length - (closed ? 0 : 1); i++) s += dist(v[i], v[(i + 1) % v.length]); return s; };
export const areaMm2 = (v: Pt[], k: number) => shoelace(v) / (k * k);
export const perimeterMm = (v: Pt[], k: number, closed = true) => perimeter(v, closed) / k;
export function angleDeg(a: Pt, b: Pt, c: Pt) {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  return n ? (Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / n))) * 180) / Math.PI : 0;
}
export const centroid = (v: Pt[]): Pt => [v.reduce((s, p) => s + p[0], 0) / v.length, v.reduce((s, p) => s + p[1], 0) / v.length];
export const pathOf = (v: Pt[], close = true) => v.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') + (close ? ' Z' : '');

export const pointInPolygon = (p: Pt, v: Pt[]): boolean => {
  let inside = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const [xi, yi] = v[i]!, [xj, yj] = v[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const interiorPoint = (v: Pt[]): Pt => {
  const c = centroid(v);
  if (pointInPolygon(c, v)) return c;
  const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best: Pt = v[0]!, bd = Infinity;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
    const q: Pt = [x0 + ((x1 - x0) * i) / 24, y0 + ((y1 - y0) * j) / 24];
    const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d < bd && pointInPolygon(q, v)) { bd = d; best = q; }
  }
  return best;
};
