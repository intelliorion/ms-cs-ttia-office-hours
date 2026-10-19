import { CanvasTexture, SRGBColorSpace } from 'three';

let tex: CanvasTexture | null = null;

/** A soft radial glow drawn in code (no image asset), shared by every halo and pulse. */
export function haloTexture(): CanvasTexture {
  if (tex) return tex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.12, 'rgba(255,255,255,0.75)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.22)');
  r.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
