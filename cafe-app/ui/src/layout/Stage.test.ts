import { describe, expect, it } from 'vitest';
import { fitStage } from './Stage';

describe('fitStage', () => {
  it('a 16:9 window is the plain 1920×1080 frame, scaled to fit', () => {
    expect(fitStage(1920, 1080)).toEqual({ w: 1920, h: 1080, scale: 1 });
    expect(fitStage(960, 540)).toEqual({ w: 1920, h: 1080, scale: 0.5 });
  });
  it('a wider window widens the frame to the edges instead of leaving bands at the sides', () => {
    const s = fitStage(2560, 1080);
    expect(s.scale).toBe(1);
    expect(s.w).toBe(2560);
    expect(s.h).toBe(1080);
    const u = fitStage(3440, 1440); // ultrawide: scaled by height, then widened
    expect(u.h).toBe(1080);
    expect(Math.round(u.w * u.scale)).toBe(3440);
  });
  it('a taller window heightens the frame instead of leaving bands above and below', () => {
    const s = fitStage(1920, 1200);
    expect(s).toEqual({ w: 1920, h: 1200, scale: 1 });
  });
});
