import { CanvasTexture, SRGBColorSpace } from 'three';

let tex: CanvasTexture | null = null;
let soft: CanvasTexture | null = null;

/** Lite's halo: a broader, gentler glow that stands in for bloom (more light in the middle of the falloff). */
export function softHaloTexture(): CanvasTexture {
  if (soft) return soft;
  soft = radial([[0, 1], [0.15, 0.7], [0.35, 0.32], [0.6, 0.1], [0.82, 0.025], [1, 0]]);
  return soft;
}

function radial(stops: [number, number][]): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, a] of stops) r.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft radial glow drawn in code (no image asset), shared by every halo and pulse. */
export function haloTexture(): CanvasTexture {
  if (tex) return tex;
  tex = radial([[0, 1], [0.12, 0.75], [0.35, 0.22], [0.7, 0.05], [1, 0]]);
  return tex;
}
