import { Grid, Stars as DreiStars } from '@react-three/drei';

/** Deep space behind the graph: a slow starfield and a faint perspective grid floor (sc-datav demo 0). */
export function Backdrop({ floorY, reach }: { floorY: number; reach: number }) {
  return (
    <>
      <color attach="background" args={['#07090b']} />
      <fog attach="fog" args={['#07090b', 420, 1100]} />
      <DreiStars radius={300} depth={60} count={4000} factor={3} saturation={0} fade speed={0.3} />
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
