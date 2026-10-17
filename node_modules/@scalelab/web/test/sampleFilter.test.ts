import { describe, expect, it } from 'vitest';
import type { Sample } from '@masshtablab/shared';
import { filterAndSortSamples, type SampleFilter } from '../src/lib/sampleFilter';

const sample = (o: Partial<Sample>) => ({ id: 'x', name: 'Образец', species: '', tags: [], area_mm2: null, created_at: '2026-01-01T00:00:00Z', ...o }) as unknown as Sample;
const base: SampleFilter = { query: '', species: new Set(), tags: new Set(), maxAreaMm2: 300, sort: 'date' };

describe('фильтр и сортировка библиотеки', () => {
  const list = [
    sample({ id: 'a', name: 'Лист', species: 'Бук', tags: ['срез'], area_mm2: 120, created_at: '2026-01-02T00:00:00Z' }),
    sample({ id: 'b', name: 'Ветка', species: 'Дуб', tags: [], area_mm2: 400, created_at: '2026-01-03T00:00:00Z' }),
    sample({ id: 'c', name: 'Арка', species: 'Бук', tags: ['срез', 'свежий'], area_mm2: null, created_at: '2026-01-01T00:00:00Z' }),
  ];
  it('по умолчанию: новые первыми, площадь до лимита, без площади остаётся', () => {
    expect(filterAndSortSamples(list, base).map((s) => s.id)).toEqual(['a', 'c']);
  });
  it('поиск, вид и теги', () => {
    expect(filterAndSortSamples(list, { ...base, query: 'ЛИСТ' }).map((s) => s.id)).toEqual(['a']);
    expect(filterAndSortSamples(list, { ...base, species: new Set(['Бук']) }).map((s) => s.id)).toEqual(['a', 'c']);
    expect(filterAndSortSamples(list, { ...base, tags: new Set(['свежий']) }).map((s) => s.id)).toEqual(['c']);
  });
  it('сортировка по имени и по площади, исходный список не меняется', () => {
    const copy = [...list];
    expect(filterAndSortSamples(list, { ...base, maxAreaMm2: 1000, sort: 'name' }).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(filterAndSortSamples(list, { ...base, maxAreaMm2: 1000, sort: 'area' }).map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(list).toEqual(copy);
  });
});
