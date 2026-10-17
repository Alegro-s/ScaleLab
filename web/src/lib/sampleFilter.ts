import type { Sample } from '@masshtablab/shared';

export type SampleSort = 'date' | 'name' | 'area';

export interface SampleFilter {
  query: string;
  species: Set<string>;
  tags: Set<string>;
  maxAreaMm2: number;
  sort: SampleSort;
}

const matchesQuery = (s: Sample, query: string) =>
  !query || (s.name + s.species + s.tags.join(' ')).toLowerCase().includes(query.toLowerCase());

const matchesSpecies = (s: Sample, species: Set<string>) => !species.size || species.has(s.species);
const matchesTags = (s: Sample, tags: Set<string>) => !tags.size || s.tags.some((t) => tags.has(t));
const matchesArea = (s: Sample, maxAreaMm2: number) => s.area_mm2 == null || s.area_mm2 <= maxAreaMm2;

const comparators: Record<SampleSort, (a: Sample, b: Sample) => number> = {
  name: (a, b) => a.name.localeCompare(b.name, 'ru'),
  area: (a, b) => (b.area_mm2 ?? -1) - (a.area_mm2 ?? -1),
  date: (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
};

export function filterAndSortSamples(all: Sample[], f: SampleFilter): Sample[] {
  return all
    .filter((s) => matchesQuery(s, f.query) && matchesSpecies(s, f.species) && matchesTags(s, f.tags) && matchesArea(s, f.maxAreaMm2))
    .sort(comparators[f.sort]);
}
