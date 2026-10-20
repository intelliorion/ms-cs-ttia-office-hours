import { useLayoutEffect, useRef } from 'react';
import { Grid, Stars as DreiStars } from '@react-three/drei';
import type { Points } from 'three';

/** Lite: a sixth of the starfield, each point a little larger and dimmer, so the sky reads the same for less work. */
export const STARFIELD = { full: { count: 4000, factor: 3 }, lite: { count: Math.round(4000 / 6), factor: 4.2 } };
const LITE_DIM = 0.6;

/** Deep space behind the graph: a slow starfield and a faint perspective grid floor (sc-datav demo 0). */
export function Backdrop({ floorY, reach, lite = false }: { floorY: number; reach: number; lite?: boolean }) {
  const field = lite ? STARFIELD.lite : STARFIELD.full;
  const sky = useRef<Points>(null);
  useLayoutEffect(() => {
    const g = sky.current?.geometry; const c = g?.getAttribute('color');
    if (!lite || !g || !c || g.userData.dimmed) return; // once per geometry (StrictMode runs effects twice)
    g.userData.dimmed = true;
    for (let i = 0; i < c.array.length; i++) (c.array as Float32Array)[i] *= LITE_DIM;
    c.needsUpdate = true;
  }, [lite, field.count]);
  return (
    <>
      <color attach="background" args={['#07090b']} />
      <fog attach="fog" args={['#07090b', 420, 1100]} />
      <DreiStars key={field.count} ref={sky} radius={300} depth={60} count={field.count} factor={field.factor} saturation={0} fade speed={0.3} />
      <Grid
        position={[0, floorY, 0]}
        args={[10, 10]}
        infiniteGrid
        fadeDistance={Math.max(260, reach)}
        fadeFrom={0}
        fadeStrength={1.6}
        cellSize={12}
        cellThickness={0.55}
        cellColor="#1a2a29"
        sectionSize={60}
        sectionThickness={1.05}
        sectionColor="#2b4a48"
      />
    </>
  );
}
