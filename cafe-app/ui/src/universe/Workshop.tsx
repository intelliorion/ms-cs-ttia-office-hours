import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { Grid } from '@react-three/drei';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { StudioEnvironment } from './Snowfall';

/** The shop wall: plain warm board, a little lighter in the middle, drawn once on a canvas (no image to download). */
function pegboard(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const w = 1600, h = 900;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); if (!g) return null;
  const grad = g.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, w * 0.7);
  grad.addColorStop(0, '#f3e9d8'); grad.addColorStop(1, '#e6d6bb');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

/** Workshop: the gears hang in front of a plain warm wall, over a workbench grid, in warm shop light. */
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
      {!board && <color attach="background" args={['#efe3cf']} />}
      <fog attach="fog" args={['#efe3cf', 560, 1500]} />
      <StudioEnvironment />
      <hemisphereLight args={['#fff6e8', '#8a6a44', 0.35]} />
      <directionalLight position={[180, 260, 220]} intensity={1.05} color="#fff1dc" />
      <Grid
        position={[0, floorY, 0]} args={[10, 10]} infiniteGrid fadeDistance={Math.max(300, reach)} fadeFrom={0} fadeStrength={1.4}
        cellSize={14} cellThickness={0.5} cellColor="#e0cfb2" sectionSize={70} sectionThickness={1} sectionColor="#cdb48c"
      />
    </>
  );
}
