import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { applyDesign } from '../src/state';
import { num, plural, setDecimals } from '../src/lib/fmt';

describe('переключение дизайна', () => {
  it('ставит data-ui и data-theme', () => {
    applyDesign('classic', 'light', false);
    expect(document.documentElement.dataset.ui).toBe('classic');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyDesign('glass', 'dark', false);
    expect(document.documentElement.dataset.ui).toBe('glass');
  });
  it('при смене дизайна показывает экран загрузки и переключает режим под ним', () => {
    vi.useFakeTimers();
    applyDesign('glass', 'dark', false);
    applyDesign('classic', 'dark', true);
    expect(document.querySelector('.sl-switch')).not.toBeNull();
    expect(document.documentElement.dataset.ui).toBe('glass');
    vi.advanceTimersByTime(400);
    expect(document.documentElement.dataset.ui).toBe('classic');
    vi.advanceTimersByTime(1500);
    expect(document.querySelector('.sl-switch')).toBeNull();
    vi.useRealTimers();
  });
});

describe('простой дизайн без анимаций', () => {
  const css = readFileSync('src/styles/classic.css', 'utf8');
  it('глобально отключает transition и animation', () => {
    expect(css).toMatch(/animation:\s*none\s*!important/);
    expect(css).toMatch(/transition:\s*none\s*!important/);
    expect(css).toMatch(/scroll-behavior:\s*auto/);
  });
});

describe('форматирование', () => {
  it('запятая и склонения', () => {
    setDecimals(2);
    expect(num(1.5)).toBe('1,50');
    expect(num(null)).toBe('—');
    expect([1, 2, 5, 11, 21].map((n) => plural(n, 'замер', 'замера', 'замеров'))).toEqual(['замер', 'замера', 'замеров', 'замеров', 'замер']);
  });
});
