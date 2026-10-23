import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { StudioEnvironment } from './Snowfall';

/** Pegboard: warm hardboard with rows of holes, drawn once on a canvas (no image to download). */
function pegboard(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = 1600, h = 900, gap = 30;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); if (!g) return null;
  const grad = g.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, w * 0.7);
  grad.addColorStop(0, '#e2cba6'); grad.addColorStop(1, '#c9ab7f');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  for (let y = gap / 2; y < h; y += gap) {
    for (let x = gap / 2; x < w; x += gap) {
      g.fillStyle = 'rgba(70,48,24,.42)'; g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,240,215,.35)'; g.beginPath(); g.arc(x + 0.8, y + 1.2, 3.2, 0.2, Math.PI - 0.2); g.fill();
    }
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

/** Workshop: the gears hang in front of a pegboard wall, over a workbench grid, in warm shop light. */
export function Workshop({ floorY, reach }: { floorY: number; reach: number }) {
  const scene = useThree((s) => s.scene);
  const board = useMemo(pegboard, []);
  useEffect(() => {
    if (!board) return;
    const before = scene.background;
    scene.background = board;
    return () => { scene.background = before; board.dispose(); };
  }, [scene, board]);
  return (
    <>
      {!board && <color attach="background" args={['#d8bf98']} />}
      <fog attach="fog" args={['#d8bf98', 560, 1500]} />
      <StudioEnvironment />
      <hemisphereLight args={['#fff6e8', '#8a6a44', 0.35]} />
      <directionalLight position={[180, 260, 220]} intensity={1.05} color="#fff1dc" />
      <Grid
        position={[0, floorY, 0]} args={[10, 10]} infiniteGrid fadeDistance={Math.max(300, reach)} fadeFrom={0} fadeStrength={1.4}
        cellSize={14} cellThickness={0.6} cellColor="#b8955f" sectionSize={70} sectionThickness={1.2} sectionColor="#8a6a3f"
      />
    </>
  );
}
