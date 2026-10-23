import { Grid } from '@react-three/drei';

/** Blueprint: drafting blue, a fine grid floor with stronger section lines, a little haze far off. No stars, no glow. */
export function DraftingTable({ floorY, reach }: { floorY: number; reach: number }) {
  return (
    <>
      <color attach="background" args={['#2b5f96']} />
      <fog attach="fog" args={['#2b5f96', 560, 1500]} />
      <Grid
        position={[0, floorY, 0]} args={[10, 10]} infiniteGrid fadeDistance={Math.max(320, reach * 1.2)} fadeFrom={0} fadeStrength={1.2}
        cellSize={10} cellThickness={0.6} cellColor="#4d80b6" sectionSize={50} sectionThickness={1.2} sectionColor="#8fb6e0"
      />
    </>
  );
}
