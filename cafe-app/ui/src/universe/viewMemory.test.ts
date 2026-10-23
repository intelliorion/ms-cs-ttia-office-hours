import { describe, it, expect, beforeEach } from 'vitest';
import { readCamera, saveCamera, readFlat, saveFlat, flushView, _resetViewMemory } from './viewMemory';

const cam = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number], spin: 0.5, selectedId: 'team:gss' };

describe('view memory', () => {
  beforeEach(() => { localStorage.clear(); _resetViewMemory(); });

  it('the camera and the flat view come back after a new canvas and after a reload', () => {
    expect(readCamera()).toBeUndefined();
    expect(readFlat()).toBeUndefined();
    saveCamera(cam); saveFlat({ k: 2.5, x: 10, y: -4 });
    expect(readCamera()).toEqual(cam);
    flushView(); // the page closes
    _resetViewMemory(); // a reload: only what was written to the browser is left
    expect(readCamera()).toEqual(cam);
    expect(readFlat()).toEqual({ k: 2.5, x: 10, y: -4 });
  });

  it('anything unreadable is forgotten, not used', () => {
    localStorage.setItem('cafe-view', JSON.stringify({ camera: { position: [1, 'x', 3], target: [0, 0, 0], spin: 0 }, flat: { k: 0, x: 0, y: 0 } }));
    expect(readCamera()).toBeUndefined();
    expect(readFlat()).toBeUndefined();
    _resetViewMemory(); localStorage.setItem('cafe-view', 'not json');
    expect(readCamera()).toBeUndefined();
  });
});
